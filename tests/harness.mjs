// Тестовый стенд: заглушки соцсетей + локальный Worker (wrangler dev) с чистой базой во временной папке.
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { bufferMock, googleMock, graphMock, telegramMock, threadsMock } from "./mocks.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const PASSWORD = "test-password";
export const UPLOAD_TOKEN = "test-upload-token-0123456789abcdef";
export const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
export const THREADS_SECRET = "th-secret";

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startStand() {
  const mocks = { buffer: await bufferMock(), graph: await graphMock(), tg: await telegramMock(), google: await googleMock(), threads: await threadsMock() };
  const port = await freePort();
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "postfixer-test-"));
  const vars = {
    APP_PASSWORD: PASSWORD,
    UPLOAD_TOKEN,
    TOKEN_KEY,
    BUFFER_API_KEY: "test-buffer-key",
    BUFFER_API_URL: mocks.buffer.url,
    META_APP_SECRET: "test-meta-secret",
    META_GRAPH_URL: mocks.graph.url,
    TG_BOT_TOKEN: "tg-test-token",
    TG_API_URL: mocks.tg.url,
    GOOGLE_CLIENT_SECRET: "g-secret",
    GOOGLE_API_URL: mocks.google.url,
    THREADS_APP_SECRET: THREADS_SECRET,
    THREADS_API_URL: mocks.threads.url,
  };
  const args = ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist, "--test-scheduled", "--show-interactive-dev-session=false"];
  for (const [k, v] of Object.entries(vars)) args.push("--var", `${k}:${v}`);
  const out = [];
  const proc = spawn("npx", args, {
    cwd: ROOT,
    env: { ...process.env, POSTFIXER_IN_TEST: "1", WRANGLER_SEND_METRICS: "false", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // своя группа процессов — в конце гасим npx, wrangler и workerd разом
  });
  proc.stdout.on("data", (d) => out.push(String(d)));
  proc.stderr.on("data", (d) => out.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev завершился:\n${out.join("").slice(-3000)}`);
    if (Date.now() > deadline) throw new Error(`wrangler dev не запустился за 2 мин:\n${out.join("").slice(-3000)}`);
    try {
      const r = await fetch(`${base}/api/v2/auth/me`);
      if (r.ok) break;
    } catch {
      /* ещё запускается */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  /** Запрос к API; agent: true — с ключом Claude; cookie — с входом владельца. */
  const api = async (p, { method = "GET", body, agent = false, cookie, headers = {}, raw = false } = {}) => {
    const h = { ...headers };
    if (agent) h.Authorization = `Bearer ${UPLOAD_TOKEN}`;
    if (cookie) {
      h.cookie = cookie;
      h.Origin = base;
    }
    if (body !== undefined && !(body instanceof Uint8Array) && typeof body !== "string") h["content-type"] = "application/json";
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body), redirect: "manual" });
    if (raw) return r;
    const t = await r.text();
    let data;
    try {
      data = JSON.parse(t);
    } catch {
      data = t;
    }
    return { status: r.status, data, headers: r.headers };
  };

  /** SQL к локальной базе стенда. */
  const sql = (q) =>
    JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "postfixer", "--local", "--persist-to", persist, "--json", "--command", q], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString())[0].results;

  const tick = (cron = "* * * * *") => fetch(`${base}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}`);

  /** Вход владельца: пароль → подключение кода (первый вход) или код → cookie. */
  const login = async () => {
    const cookies = new Map();
    const keep = (r) => {
      for (const c of r.headers.getSetCookie()) {
        const [kv] = c.split(";");
        const i = kv.indexOf("=");
        cookies.set(kv.slice(0, i), kv.slice(i + 1));
      }
    };
    const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    const post = async (p, body) => {
      const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", Origin: base, cookie: jar() }, body: JSON.stringify(body) });
      keep(r);
      return { status: r.status, data: await r.json() };
    };
    const l = await post("/api/v2/auth/login", { password: PASSWORD });
    if (l.data.state === "ok") return jar();
    let secret;
    if (l.data.state === "mfa_setup") secret = (await post("/api/v2/auth/totp/setup", {})).data.secret;
    else secret = openSealed(sql("SELECT totp_secret_enc AS s FROM auth_settings WHERE id = 1")[0].s);
    const step = Math.floor(Date.now() / 30000);
    const lastRow = sql("SELECT last_step AS s FROM auth_settings WHERE id = 1")[0];
    const use = lastRow && lastRow.s >= step ? step + 1 : step;
    const v = await post("/api/v2/auth/totp/verify", { code: totp(secret, use), trustDevice: true });
    if (v.data.state !== "ok") throw new Error(`вход: ${JSON.stringify(v.data)}`);
    return jar();
  };

  /** Загрузить «ролик» (случайные байты) через автозагрузку с Mac. */
  const upload = async (name, size = 20_000) => {
    const bytes = crypto.randomBytes(size);
    const s = await api("/api/v2/ingest", { method: "POST", agent: true, body: { name, size } });
    if (s.data.duplicate) return s.data.item;
    const part = await api(`/api/v2/ingest/${s.data.uploadId}/parts/1`, { method: "PUT", agent: true, body: new Uint8Array(bytes), headers: { "content-length": String(size) } });
    const done = await api(`/api/v2/ingest/${s.data.uploadId}/complete`, { method: "POST", agent: true, body: { parts: [part.data] } });
    return done.data.item;
  };

  const stop = () => {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
    proc.stdout.destroy();
    proc.stderr.destroy();
    for (const m of Object.values(mocks)) m.close();
    fs.rmSync(persist, { recursive: true, force: true });
  };
  return { base, api, sql, tick, login, upload, mocks, stop, logs: () => out.join("") };
}

function b32d(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let v = 0;
  const o = [];
  for (const c of s.replace(/[^A-Z2-7]/g, "")) {
    v = (v << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      o.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(o);
}
export function totp(secret, step) {
  const m = Buffer.alloc(8);
  m.writeUInt32BE(0, 0);
  m.writeUInt32BE(step >>> 0, 4);
  const h = crypto.createHmac("sha1", b32d(secret)).update(m).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
/** Расшифровать значение, зашифрованное TOKEN_KEY (формат v1.iv.ct). */
export function openSealed(v) {
  if (!v.startsWith("v1.")) return v;
  const [, iv, ct] = v.split(".");
  const buf = Buffer.from(ct, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(TOKEN_KEY, "base64"), Buffer.from(iv, "base64"));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString();
}
