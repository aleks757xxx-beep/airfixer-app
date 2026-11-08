// Тесты PostFixer на локальной копии (Worker + D1 + R2 в памяти, соцсети — заглушки).
// Запуск: npm test. Перед выкладкой их запускает сборка (scripts/build.mjs): упали — выкладки нет.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, describe, test } from "node:test";
import { THREADS_SECRET, openSealed, seal, startStand } from "./harness.mjs";

let s;
let cookie;
let media;
before(async () => {
  s = await startStand();
});
after(() => s?.stop());

/** Уведомления, которые бот прислал владельцу. */
const messages = () => s.mocks.tg.log.filter((x) => x.method === "message");
const posts = async () => {
  const now = Date.now();
  const r = await s.api(`/api/v2/ingest/agent/publish/posts?from=${now - 86400000}&to=${now + 86400000}`, { agent: true });
  return [...r.data.items, ...r.data.drafts];
};
const post = async (id) => (await posts()).find((p) => p.id === id);
/** Прогнать минутный cron, пока пост не выйдет (или не упадёт). */
async function runUntilSent(id, maxTicks = 6, beforeTick) {
  for (let i = 0; i < maxTicks; i++) {
    if (beforeTick) beforeTick();
    await s.tick();
    const p = await post(id);
    if (p.status === "sent" || p.status === "error") return p;
  }
  return post(id);
}
const compose = (channelId, text, extra = {}) =>
  s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: media.id, mode: "now", targets: [{ channelId, text, ...extra }] } });

describe("безопасность", () => {
  test("заголовки: CSP (только свои скрипты, без встраивания), HSTS, nosniff, X-Frame-Options", async () => {
    for (const p of ["/", "/privacy.html", "/api/v2/auth/me", "/media/videos/x.mp4"]) {
      const h = (await s.api(p, { raw: true })).headers;
      const csp = h.get("content-security-policy") ?? "";
      assert.match(csp, /script-src 'self';/, p);
      assert.match(csp, /frame-ancestors 'none'/, p);
      assert.match(csp, /object-src 'none'/, p);
      assert.equal(h.get("x-frame-options"), "DENY", p);
      assert.equal(h.get("x-content-type-options"), "nosniff", p);
      assert.match(h.get("strict-transport-security") ?? "", /max-age=31536000/, p);
    }
  });

  test("без входа и без ключа API закрыт", async () => {
    for (const p of ["/api/v2/publish/channels", "/api/v2/media", "/api/v2/settings", "/api/v2/connect/accounts", "/api/v2/publish/stats?from=0&to=1", "/api/v2/ingest/media", "/api/v2/ingest/agent/audit"]) {
      assert.equal((await s.api(p)).status, 401, p);
    }
    assert.equal((await s.api("/api/v2/ingest/media", { headers: { Authorization: "Bearer wrong-token" } })).status, 401);
  });

  test("вход: пароль + код; cookie HttpOnly/Secure/SameSite=Strict; ключ кода зашифрован", async () => {
    const r = await fetch(`${s.base}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json", Origin: s.base }, body: JSON.stringify({ password: "test-password" }) });
    const sc = r.headers.getSetCookie().join("\n");
    assert.match(sc, /HttpOnly/);
    assert.match(sc, /Secure/);
    assert.match(sc, /SameSite=Strict/);
    cookie = await s.login();
    const stored = s.sql("SELECT totp_secret_enc AS s FROM auth_settings WHERE id = 1")[0].s;
    assert.ok(stored.startsWith("v1."), "ключ кода хранится зашифрованным");
    assert.match(openSealed(stored), /^[A-Z2-7]+$/);
    assert.equal((await s.api("/api/v2/settings", { cookie })).status, 200);
  });

  test("изменения с чужого сайта и без Origin — 403", async () => {
    const evil = await s.api("/api/v2/settings", { method: "PUT", headers: { cookie, Origin: "https://evil.example" }, body: { claudeUrl: "https://evil.example" } });
    assert.equal(evil.status, 403);
    const noOrigin = await s.api("/api/v2/settings", { method: "PUT", headers: { cookie }, body: { claudeUrl: "https://evil.example" } });
    assert.equal(noOrigin.status, 403);
  });

  test("адреса Meta для Threads принимают только подписанные запросы", async () => {
    const payload = Buffer.from(JSON.stringify({ user_id: "9988", algorithm: "HMAC-SHA256" })).toString("base64url");
    const sig = crypto.createHmac("sha256", THREADS_SECRET).update(payload).digest("base64url");
    const form = (sr) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `signed_request=${encodeURIComponent(sr)}` });
    assert.equal((await s.api("/api/v2/connect/threads/uninstall", form(`AAAA.${payload}`))).status, 400);
    assert.equal((await s.api("/api/v2/connect/threads/delete", { method: "POST" })).status, 400);
    const ok = await s.api("/api/v2/connect/threads/delete", form(`${sig}.${payload}`));
    assert.equal(ok.status, 200);
    assert.ok(ok.data.confirmation_code);
  });

  test("/media — только ролики; поддельный state OAuth не принимается", async () => {
    assert.equal((await s.api("/media/..%2F..%2Fwrangler.jsonc")).status, 404);
    assert.equal((await s.api("/media/other/x")).status, 404);
    for (const p of ["youtube", "threads", "meta"]) {
      const r = await s.api(`/api/v2/connect/${p}/callback?code=x&state=forged`);
      assert.match(r.headers.get("location") ?? "", /connect_error/, p);
    }
  });
});

describe("библиотека", () => {
  test("автозагрузка с Mac: части → ролик в библиотеке; повтор не грузится", async () => {
    media = await s.upload("Тест ролик.mp4");
    assert.ok(media.id);
    const again = await s.api("/api/v2/ingest", { method: "POST", agent: true, body: { name: "Тест ролик.mp4", size: 20_000 } });
    assert.equal(again.data.duplicate, true);
    const lib = await s.api("/api/v2/media", { cookie });
    assert.ok(lib.data.items.some((m) => m.id === media.id));
  });
});

describe("уведомления в Telegram", () => {
  test("чат владельца задаётся Claude, проверочное сообщение, выключение видов", async () => {
    assert.equal((await s.api("/api/v2/ingest/agent/notify-chat", { method: "PUT", agent: true, body: { chatId: "5550001" } })).status, 200);
    const st = await s.api("/api/v2/settings", { cookie });
    assert.equal(st.data.notify.connected, true);
    assert.equal((await s.api("/api/v2/settings/notify/test", { method: "POST", cookie, body: {} })).status, 200);
    const m = messages().at(-1);
    assert.equal(m.chat, "5550001");
    assert.match(m.text, /уведомления работают/);
    assert.equal((await s.api("/api/v2/settings/notify", { method: "PUT", cookie, body: { off: ["sent"] } })).status, 200);
    assert.deepEqual((await s.api("/api/v2/settings", { cookie })).data.notify.off, ["sent"]);
    assert.equal((await s.api("/api/v2/settings/notify", { method: "PUT", cookie, body: { off: [] } })).status, 200);
    assert.equal((await s.api("/api/v2/settings/notify", { method: "PUT", cookie, body: { chatId: "12ab" } })).status, 400, "ID чата — только цифры");
  });
});

describe("подключение и публикация напрямую", () => {
  test("Meta: Facebook-страница и привязанный Instagram", async () => {
    const u = await s.api("/api/v2/ingest/agent/connect/meta/url", { agent: true });
    const state = new URL(u.data.url).searchParams.get("state");
    const cb = await s.api(`/api/v2/connect/meta/callback?code=abc&state=${state}`);
    assert.match(cb.headers.get("location"), /connected=meta/);
    const acc = (await s.api("/api/v2/ingest/agent/publish/accounts", { agent: true })).data.items.map((a) => a.id);
    assert.ok(acc.includes("fb:p1") && acc.includes("ig:ig1"), acc.join());
  });

  test("Instagram без страницы (единый вход)", async () => {
    const u = await s.api("/api/v2/ingest/agent/connect/instagram/url", { agent: true });
    const state = new URL(u.data.url).searchParams.get("state");
    const cb = await s.api(`/api/v2/connect/meta/callback?code=iguni&state=${state}`);
    assert.match(cb.headers.get("location"), /connected=instagram&name=airfixertbls/);
  });

  test("Instagram: Reels + первый комментарий", async () => {
    const r = await compose("ig:ig1", "Чистка кондиционера", { firstComment: "#тбилиси" });
    const p = await runUntilSent(r.data.results[0].postId);
    assert.equal(p.status, "sent", p.error);
    assert.match(p.externalLink, /instagram\.com\/reel/);
    assert.ok(s.mocks.graph.log.some((x) => /\/comments$/.test(x.p) && x.b.message === "#тбилиси"));
    await s.tick();
    const m = messages().find((x) => /Вышло<\/b> — Instagram airfixer\.ge/.test(x.text));
    assert.ok(m, "уведомление «Вышло»");
    assert.match(m.button.url, /instagram\.com\/reel/);
  });

  test("Facebook Reels", async () => {
    const r = await compose("fb:p1", "Пост в Facebook");
    const p = await runUntilSent(r.data.results[0].postId);
    assert.equal(p.status, "sent", p.error);
    assert.match(p.externalLink, /facebook\.com\/reel/);
  });

  test("Telegram: канал по боту, ролик с кнопкой «Записаться»", async () => {
    const c = await s.api("/api/v2/connect/telegram", { method: "POST", cookie, body: {} });
    assert.equal(c.status, 200, JSON.stringify(c.data));
    const r = await compose("tg:-1001234567890", "Пост в Telegram");
    const p = await runUntilSent(r.data.results[0].postId, 2);
    assert.equal(p.status, "sent", p.error);
    const sent = s.mocks.tg.log.find((x) => x.method === "sendVideo");
    assert.equal(sent.caption, "Пост в Telegram");
    assert.match(sent.markup, /fixerairbot/);
  });

  test("YouTube: вход Google, загрузка частями с докачкой после обрыва", async () => {
    const u = await s.api("/api/v2/ingest/agent/connect/youtube/url", { agent: true });
    const q = new URL(u.data.url).searchParams;
    assert.equal(q.get("access_type"), "offline");
    const cb = await s.api(`/api/v2/connect/youtube/callback?code=abc&state=${q.get("state")}`);
    assert.match(cb.headers.get("location"), /connected=youtube/);
    const r = await compose("yt:UCtest", "Описание <ролика>", { title: "Чистка кондиционера" });
    const id = r.data.results[0].postId;
    // между кусками — пауза 50 с; в тесте сдвигаем время прошлого куска назад
    const p = await runUntilSent(id, 6, () => s.sql(`UPDATE direct_posts SET updated_at = updated_at - 60000 WHERE id = '${id}' AND status = 'processing'`));
    assert.equal(p.status, "sent", p.error);
    assert.equal(p.externalLink, "https://youtu.be/vid42");
    assert.equal(s.mocks.google.state.meta.snippet.title, "Чистка кондиционера");
    assert.equal(s.mocks.google.state.meta.snippet.description, "Описание ролика", "без < >");
    assert.equal(s.mocks.google.state.meta.status.privacyStatus, "public");
  });

  test("Threads: вход, лимит 500 знаков (эмодзи по байтам), публикация", async () => {
    const u = await s.api("/api/v2/ingest/agent/connect/threads/url", { agent: true });
    const state = new URL(u.data.url).searchParams.get("state");
    const cb = await s.api(`/api/v2/connect/threads/callback?code=abc&state=${state}`);
    assert.match(cb.headers.get("location"), /connected=threads/);
    const tooLong = await compose("th:9988", `${"а".repeat(480)}🙂🙂🙂🙂🙂🙂`);
    assert.equal(tooLong.data.results[0].ok, false);
    const r = await compose("th:9988", "Чистка ❄️ #airfixer");
    const p = await runUntilSent(r.data.results[0].postId);
    assert.equal(p.status, "sent", p.error);
    assert.match(p.externalLink, /threads\.com/);
  });
});

describe("статистика, история, вставки", () => {
  test("цифры прямых постов из Instagram, YouTube и Threads", async () => {
    s.sql("UPDATE direct_posts SET sent_at = sent_at - 3600000, metrics_updated_at = NULL WHERE status = 'sent'");
    await s.tick();
    await s.tick();
    const now = Date.now();
    const st = await s.api(`/api/v2/ingest/agent/publish/stats?from=${now - 7 * 86400000}&to=${now + 1}`, { agent: true });
    const views = (ch) => st.data.items.find((p) => p.channelId === ch)?.metrics.find((m) => m.type === "views")?.value;
    assert.equal(views("ig:ig1"), 500);
    assert.equal(views("yt:UCtest"), 321);
    assert.equal(views("th:9988"), 900);
  });

  test("история Buffer сохраняется и показывается под переехавшим каналом", async () => {
    const a = await s.api("/api/v2/ingest/agent/publish/archive?days=30", { method: "POST", agent: true });
    assert.equal(a.status, 200);
    assert.ok(a.data.total >= 1);
    const now = Date.now();
    const st = await s.api(`/api/v2/ingest/agent/publish/stats?from=${now - 7 * 86400000}&to=${now + 1}`, { agent: true });
    const old = st.data.items.find((p) => p.id === "p_old");
    assert.equal(old.channelId, "yt:UCtest", "канал Buffer YouTube заменён прямым");
  });

  test("вставки: перенос из Buffer один раз, создание, правка, удаление", async () => {
    const l = await s.api("/api/v2/ingest/agent/publish/snippets", { agent: true });
    assert.deepEqual(l.data.items.map((x) => x.name), ["Хэштеги"]);
    const c = await s.api("/api/v2/ingest/agent/publish/snippets", { method: "POST", agent: true, body: { name: "Тест", text: "текст" } });
    const id = c.data.snippet.id;
    assert.equal((await s.api(`/api/v2/ingest/agent/publish/snippets/${id}`, { method: "PUT", agent: true, body: { name: "Тест2", text: "т2" } })).status, 200);
    assert.equal((await s.api(`/api/v2/ingest/agent/publish/snippets/${id}`, { method: "DELETE", agent: true })).status, 200);
    assert.equal((await s.api("/api/v2/ingest/agent/publish/snippets", { agent: true })).data.items.length, 1);
  });

  test("ночной cron: продление Threads, копия истории — без ошибок", async () => {
    s.sql(`UPDATE direct_accounts SET token_expires_at = ${Date.now() + 40 * 86400000} WHERE id = 'th:9988'`);
    const r = await s.tick("0 3 * * *");
    assert.equal(r.status, 200);
    assert.ok(s.mocks.threads.log.some((x) => x.p === "/refresh_access_token"));
  });
});

describe("уведомления о сбоях и работе Claude", () => {
  test("пост не вышел — сообщение с причиной и кнопкой", async () => {
    const extra = await s.upload("Удалится.mp4", 12_000);
    const r = await s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: extra.id, mode: "now", targets: [{ channelId: "fb:p1", text: "Этот не выйдет" }] } });
    assert.equal((await s.api(`/api/v2/media/${extra.id}`, { method: "DELETE", cookie })).status, 200);
    const p = await runUntilSent(r.data.results[0].postId, 2);
    assert.equal(p.status, "error");
    await s.tick();
    const m = messages().find((x) => /Пост не вышел<\/b> — Facebook AirFixer/.test(x.text));
    assert.ok(m, "уведомление о сбое");
    assert.match(m.text, /Ролик удалён из библиотеки/);
    assert.match(m.button.url, /#\/posts$/);
  });

  test("Claude ответил на задание у ролика", async () => {
    assert.equal((await s.api(`/api/v2/media/${media.id}/note`, { method: "PUT", cookie, body: { note: "Сделай подпись" } })).status, 200);
    assert.equal((await s.api(`/api/v2/ingest/tasks/${media.id}`, { method: "POST", agent: true, body: { reply: "Подпись готова" } })).status, 200);
    await s.tick();
    assert.ok(messages().some((x) => /Claude выполнил задание<\/b> — ролик «Тест ролик\.mp4»/.test(x.text) && /Подпись готова/.test(x.text)));
  });

  test("подключение сломалось — сообщение раз в сутки", async () => {
    s.sql(`UPDATE direct_accounts SET token_enc = '${seal("broken-token")}', token_expires_at = ${Date.now() + 59 * 86400000} WHERE id = 'th:9988'`);
    await s.tick("0 3 * * *");
    await s.tick("0 3 * * *");
    const ms = messages().filter((x) => /Нужно переподключить<\/b> — Threads airfixertbls/.test(x.text));
    assert.equal(ms.length, 1, "одно сообщение в сутки");
    assert.match(ms[0].button.url, /#\/connections$/);
    assert.ok(!messages().some((x) => /переподключить<\/b> — (Instagram|Facebook|YouTube|Telegram)/.test(x.text)), "живые подключения не тревожат");
  });
});

describe("перебор пароля", () => {
  test("после 8 ошибок — блокировка (429)", async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${s.base}/api/v2/auth/login`, { method: "POST", headers: { "content-type": "application/json", Origin: s.base }, body: JSON.stringify({ password: `wrong${i}` }) });
      last = r.status;
    }
    assert.equal(last, 429);
  });
});
