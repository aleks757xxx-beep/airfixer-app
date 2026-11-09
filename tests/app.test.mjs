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

describe("лучшее время", () => {
  test("«В очередь» ставит пост в лучший час канала (8:00–22:00), карта в статистике", async () => {
    // 16 прошлых постов Facebook: в 19:00 по Тбилиси — 1000 просмотров за сутки, в 10:00 — 100
    const day = 86400000;
    const tb = (daysAgo, hour) => {
      const d = new Date(Date.now() + 4 * 3600000 - daysAgo * day);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour) - 4 * 3600000;
    };
    const rows = [];
    for (let k = 2; k <= 9; k++) {
      for (const [h, v] of [[19, 1000], [10, 100]]) {
        const at = tb(k, h);
        rows.push(`('dp_seed_${k}_${h}', 'fb:p1', '${media.id}', 'старый', ${at}, 'sent', 'owner', ${at}, ${at}, ${at}, ${v}, 'sent')`);
      }
    }
    s.sql(`INSERT INTO direct_posts (id, account_id, media_id, text, due_at, status, author, created_at, updated_at, sent_at, views_24h, notified_status) VALUES ${rows.join(",")}`);
    const bt = await s.api("/api/v2/ingest/agent/publish/best-times", { agent: true });
    const fb = bt.data.items.find((i) => i.channelId === "fb:p1");
    assert.equal(fb.source, "own");
    assert.equal(fb.best[0].hour, 19, JSON.stringify(fb.best));
    assert.equal(bt.data.hourFrom, 8);
    assert.equal(bt.data.hourTo, 22);
    const r = await s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: media.id, mode: "queue", targets: [{ channelId: "fb:p1", text: "В очередь" }] } });
    const id = r.data.results[0].postId;
    const due = s.sql(`SELECT due_at FROM direct_posts WHERE id = '${id}'`)[0].due_at;
    assert.equal(new Date(due + 4 * 3600000).getUTCHours(), 19, "лучший час");
    assert.ok(due > Date.now() && due < Date.now() + 7 * day);
    s.sql(`DELETE FROM direct_posts WHERE id = '${id}'`);
  });

  test("«В очередь» в несколько соцсетей — по одной раз в 3 дня, сначала где больше просмотров", async () => {
    const targets = ["tg:-1001234567890", "fb:p1", "th:9988"].map((channelId) => ({ channelId, text: "Разнести" }));
    const r = await s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: media.id, mode: "queue", targets } });
    assert.ok(r.data.results.every((x) => x.ok), JSON.stringify(r.data));
    const ids = r.data.results.map((x) => `'${x.postId}'`).join(",");
    const rows = s.sql(`SELECT account_id, due_at FROM direct_posts WHERE id IN (${ids}) ORDER BY due_at`);
    const tb = (t) => new Date(t + 4 * 3600000);
    const days = rows.map((x) => tb(x.due_at).toISOString().slice(0, 10));
    assert.equal(new Set(days).size, 3, `разные дни: ${days}`);
    for (let i = 1; i < days.length; i++) assert.equal((Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000, 3, "раз в 3 дня");
    assert.ok(rows.every((x) => tb(x.due_at).getUTCHours() >= 8 && tb(x.due_at).getUTCHours() <= 22));
    assert.equal(rows[0].account_id, "fb:p1", "первой — соцсеть с наибольшими просмотрами");
    // точный час зависит от времени запуска (норма соцсети считается от постов прошлых тестов) — лучший час проверяет тест «лучшее время»
    s.sql(`DELETE FROM direct_posts WHERE id IN (${ids})`);
  });
});

describe("повтор роликов", () => {
  test("только с галочкой; куда можно сразу, куда — через 90 дней; лучший результат", async () => {
    const day = 86400000;
    const fresh = await s.upload("Второй ролик.mp4");
    const list0 = await s.api("/api/v2/ingest/agent/publish/reposts", { agent: true });
    assert.equal(list0.data.items.length, 0, "без галочки ролика в списке нет");
    for (const id of [media.id, fresh.id]) assert.equal((await s.api(`/api/v2/media/${id}/repost`, { method: "PUT", cookie, body: { on: true } })).status, 200);
    const lib = await s.api("/api/v2/media", { cookie });
    assert.equal(lib.data.items.find((m) => m.id === media.id).repostable, true);
    // второй ролик выходил в Facebook 100 дней назад — уже можно снова
    const old = Date.now() - 100 * day;
    s.sql(`INSERT INTO direct_posts (id, account_id, media_id, text, due_at, status, author, created_at, updated_at, sent_at, views_24h, notified_status) VALUES ('dp_old_rep', 'fb:p1', '${fresh.id}', 'Старая подпись', ${old}, 'sent', 'owner', ${old}, ${old}, ${old}, 500, 'sent')`);
    const r = await s.api("/api/v2/ingest/agent/publish/reposts", { agent: true });
    assert.equal(r.status, 200);
    assert.equal(r.data.gapDays, 90);
    const a = r.data.items.find((i) => i.media.id === media.id);
    const b = r.data.items.find((i) => i.media.id === fresh.id);
    // первый ролик недавно выходил в Instagram и Facebook — туда позже
    assert.ok(!a.ready.includes("ig:ig1") && !a.ready.includes("fb:p1"), JSON.stringify(a.ready));
    const igLater = a.later.find((l) => l.channelId === "ig:ig1");
    assert.ok(igLater && igLater.from > Date.now() + 80 * day);
    assert.equal(a.best.channelId, "fb:p1");
    assert.equal(a.best.views, 1000);
    assert.ok(a.best.ratio > 1);
    // второй — везде сразу, подпись прошлого раза подставляется
    assert.ok(b.ready.includes("fb:p1") && b.ready.includes("ig:ig1"));
    assert.equal(b.later.length, 0);
    assert.equal(b.lastText, "Старая подпись");
    assert.equal((await s.api(`/api/v2/media/${fresh.id}/repost`, { method: "PUT", cookie, body: { on: false } })).status, 200);
    const r2 = await s.api("/api/v2/ingest/agent/publish/reposts", { agent: true });
    assert.ok(!r2.data.items.some((i) => i.media.id === fresh.id), "галочку сняли — из списка ушёл");
    s.sql("DELETE FROM direct_posts WHERE id = 'dp_old_rep'");
  });
});

describe("пометка исходников", () => {
  test("номер ролика и пометки исходников — когда запланирован; сняли пост — пометка уходит", async () => {
    const A = "/api/v2/ingest/agent";
    const renames = () => s.api(`${A}/sources/renames?gotovoeMax=18`, { agent: true }).then((r) => r.data);
    const m1 = await s.upload("Монтаж #7 v1 Тест исходников.mp4", 21_000);
    const bad = await s.api(`${A}/media/${m1.id}/sources`, { method: "PUT", agent: true, body: { items: [{ folder: "..", file: "x.MOV" }] } });
    assert.equal(bad.status, 400, "путь вне «Исходников» не принимается");
    const put = await s.api(`${A}/media/${m1.id}/sources`, {
      method: "PUT",
      agent: true,
      body: { items: [{ folder: "Чистка", file: "IMG_1.MOV" }, { folder: "Чистка", file: "IMG_2.MOV", from: 65, to: 70 }, { folder: "Чистка", file: "IMG_2.MOV", from: 12, to: 20 }] },
    });
    assert.equal(put.status, 200);
    assert.deepEqual(await renames(), { sources: [], gotovoe: [] }, "не запланирован — не трогаем");
    const post1 = (mode, extra = {}) =>
      s.api(`${A}/publish/posts`, { method: "POST", agent: true, body: { mediaId: m1.id, mode, ...extra, targets: [{ channelId: "fb:p1", text: "Исходники" }] } });
    await post1("draft");
    assert.deepEqual((await renames()).sources, [], "черновик — ещё не запланирован");
    const sched = await post1("schedule", { dueAt: Date.now() + 2 * 86400000 });
    assert.ok(sched.data.results[0].ok);
    const r1 = await renames();
    assert.deepEqual(r1.gotovoe, [{ mediaId: m1.id, number: 19, from: "Монтаж #7 v1 Тест исходников.mp4", to: "19 Тест исходников (заказ #7 v1).mp4" }]);
    const by = (r, f) => r.sources.find((x) => x.from === f)?.to;
    assert.equal(by(r1, "IMG_1.MOV"), "#19 IMG_1.MOV");
    assert.equal(by(r1, "IMG_2.MOV"), "#19 (0:12–0:20, 1:05–1:10) IMG_2.MOV");
    // Claude переименовал на Mac
    assert.equal((await s.api(`${A}/media/${m1.id}/rename`, { method: "POST", agent: true, body: { name: r1.gotovoe[0].to } })).status, 200);
    assert.equal((await s.api(`${A}/sources/renamed`, { method: "POST", agent: true, body: { folder: "Чистка", from: "IMG_1.MOV", to: "#19 IMG_1.MOV" } })).status, 200);
    const r2 = await renames();
    assert.deepEqual(r2.gotovoe, []);
    assert.deepEqual(r2.sources.map((x) => x.from), ["IMG_2.MOV"]);
    const again = await s.api("/api/v2/ingest", { method: "POST", agent: true, body: { name: "19 Тест исходников (заказ #7 v1).mp4", size: 21_000 } });
    assert.equal(again.data.duplicate, true, "переименованный файл не грузится заново");
    const lib = await s.api("/api/v2/media", { cookie });
    assert.equal(lib.data.items.find((m) => m.id === m1.id).number, 19);
    // второй ролик взял тот же файл целиком → «#19 #20»
    const m2 = await s.upload("Монтаж #8 v1 Второй.mp4", 22_000);
    await s.api(`${A}/media/${m2.id}/sources`, { method: "PUT", agent: true, body: { items: [{ folder: "Чистка", file: "#19 IMG_1.MOV" }] } });
    const p2 = await s.api(`${A}/publish/posts`, { method: "POST", agent: true, body: { mediaId: m2.id, mode: "queue", targets: [{ channelId: "fb:p1", text: "Второй" }] } });
    const r3 = await renames();
    assert.equal(by(r3, "#19 IMG_1.MOV"), "#19 #20 IMG_1.MOV");
    assert.equal(r3.gotovoe[0].to, "20 Второй (заказ #8 v1).mp4");
    // пост второго ролика сняли до выхода — пометка #20 не нужна
    assert.equal((await s.api(`${A}/publish/posts/${p2.data.results[0].postId}`, { method: "DELETE", agent: true })).status, 200);
    const r4 = await renames();
    assert.equal(by(r4, "#19 IMG_1.MOV"), undefined);
    assert.deepEqual(r4.gotovoe, []);
    // ролик, вышедший мимо PostFixer (как старый 18-й): номер задаёт Claude, исходники помечаются
    const m3 = await s.upload("18 Старый.mp4", 23_000);
    await s.api(`${A}/media/${m3.id}/sources`, { method: "PUT", agent: true, body: { items: [{ folder: "Установка", file: "DJI_1.mp4", from: 7, to: 10 }] } });
    assert.equal((await s.api(`${A}/media/${m3.id}/published`, { method: "PUT", agent: true, body: { number: 19 } })).status, 409, "номер занят");
    assert.equal((await s.api(`${A}/media/${m3.id}/published`, { method: "PUT", agent: true, body: { number: 18 } })).status, 200);
    const r5 = await renames();
    assert.equal(by(r5, "DJI_1.mp4"), "#18 (0:07–0:10) DJI_1.mp4");
    assert.ok(!r5.gotovoe.some((g) => g.mediaId === m3.id), "имя «18 …» уже с номером");
    // ролик уже назван с номером — номер берётся из имени, файл в «Готовом» не переименовывается
    const m4 = await s.upload("22 Уже с номером.mp4", 24_000);
    await s.api(`${A}/media/${m4.id}/sources`, { method: "PUT", agent: true, body: { items: [{ folder: "Чистка", file: "IMG_9.MOV" }] } });
    await s.api(`${A}/publish/posts`, { method: "POST", agent: true, body: { mediaId: m4.id, mode: "queue", targets: [{ channelId: "fb:p1", text: "С номером" }] } });
    const r6 = await renames();
    assert.equal(by(r6, "IMG_9.MOV"), "#22 IMG_9.MOV");
    assert.ok(!r6.gotovoe.some((g) => g.mediaId === m4.id), "«22 …» не превращается в «23 22 …»");
    s.sql(`DELETE FROM direct_posts WHERE media_id IN ('${m1.id}', '${m2.id}', '${m4.id}')`);
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

describe("правила публикации", () => {
  test("«В очередь» — только в часы для ответов (будни 18–22, выходные 10–22) и не чаще нормы соцсети", async () => {
    const r1 = await s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: media.id, mode: "queue", targets: [{ channelId: "th:9988", text: "Правило 1" }] } });
    const r2 = await s.api("/api/v2/ingest/agent/publish/posts", { method: "POST", agent: true, body: { mediaId: media.id, mode: "queue", targets: [{ channelId: "th:9988", text: "Правило 2" }] } });
    const ids = [r1, r2].map((r) => `'${r.data.results[0].postId}'`).join(",");
    const rows = s.sql(`SELECT due_at FROM direct_posts WHERE id IN (${ids}) ORDER BY due_at`);
    for (const { due_at } of rows) {
      const d = new Date(due_at + 4 * 3600000);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const h = d.getUTCHours();
      assert.ok(h >= (weekend ? 10 : 18) && h <= 22, `час ${h} в ${weekend ? "выходной" : "будний"}`);
    }
    assert.ok(rows[1].due_at - rows[0].due_at >= ((7 * 86400000) / 3) * 0.85, "посты одной соцсети — не чаще 3 в неделю");
    s.sql(`DELETE FROM direct_posts WHERE id IN (${ids})`);
  });

  test("соцсеть без постов 7 дней — напоминание раз в неделю", async () => {
    s.sql("UPDATE direct_posts SET sent_at = sent_at - 10 * 86400000 WHERE account_id = 'th:9988' AND status = 'sent'");
    const before = messages().length;
    await s.tick("0 3 * * *");
    const m = messages().slice(before).find((x) => /Давно не было постов/.test(x.text));
    assert.ok(m, "напоминание пришло");
    assert.match(m.text, /Threads/);
    assert.doesNotMatch(m.text, /Facebook AirFixer/, "где посты были недавно — не тревожим");
    await s.tick("0 3 * * *");
    assert.equal(messages().slice(before).filter((x) => /Давно не было постов/.test(x.text)).length, 1, "второй раз на этой неделе — нет");
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
