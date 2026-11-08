// Заглушки внешних сервисов для тестов: Buffer (GraphQL), Meta Graph, Telegram Bot API, Google (OAuth + YouTube), Threads.
// Каждая слушает свободный порт и пишет журнал запросов.
import http from "node:http";

function serve(handler) {
  return new Promise((resolve) => {
    const log = [];
    const srv = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const url = new URL(req.url, "http://x");
        const json = (o, status = 200, headers = {}) => {
          res.writeHead(status, { "content-type": "application/json", ...headers });
          res.end(JSON.stringify(o));
        };
        try {
          handler({ req, res, url, body, json, log });
        } catch (e) {
          json({ error: { message: String(e) } }, 500);
        }
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${srv.address().port}`, log, close: () => (srv.closeAllConnections(), srv.close()) }));
  });
}

const iso = (t) => new Date(t).toISOString();
const sched = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, times: ["10:00", "19:00"], paused: false }));
const channel = (id, name, service) => ({ id, name, displayName: name, service, avatar: "", timezone: "Asia/Tbilisi", isQueuePaused: false, isDisconnected: false, isLocked: false, postingSchedule: sched });

export function bufferMock() {
  const now = Date.now();
  const channels = [channel("ch_ig", "airfixer.ge", "instagram"), channel("ch_g", "AirfixerG", "googlebusiness"), channel("ch_yt", "Airfixer", "youtube")];
  let posts = [
    { id: "p_old", channelId: "ch_yt", channelService: "youtube", status: "sent", text: "Старый пост", dueAt: iso(now - 2 * 864e5), sentAt: iso(now - 2 * 864e5), isCustomScheduled: true, externalLink: "https://youtube.com/x", error: null, assets: [] },
  ];
  let snippets = [{ id: "s1", name: "Хэштеги", text: "#тбилиси" }];
  let seq = 1;
  return serve(({ body, json, log }) => {
    const { query = "", variables = {} } = JSON.parse(body.toString() || "{}");
    log.push(query.slice(0, 40));
    let data = {};
    if (query.includes("organizations") && !query.includes("limits")) data = { account: { organizations: [{ id: "org1" }] } };
    else if (query.includes("channels(")) data = { channels };
    else if (query.includes("posts(")) {
      const f = variables.filter || {};
      let list = posts;
      if (f.dueAt) list = list.filter((p) => p.dueAt && Date.parse(p.dueAt) >= Date.parse(f.dueAt.start) && Date.parse(p.dueAt) < Date.parse(f.dueAt.end));
      if (f.status) list = list.filter((p) => f.status.includes(p.status));
      if (query.includes("metrics")) list = list.map((p) => ({ ...p, metrics: [{ type: "views", name: "Views", value: 1234, unit: "count" }], metricsUpdatedAt: iso(Date.now()) }));
      data = { posts: { edges: list.map((n) => ({ node: n })), pageInfo: { hasNextPage: false, endCursor: null } } };
    } else if (query.includes("snippets(")) data = { snippets: { edges: snippets.map((n) => ({ node: n })) } };
    else if (query.includes("createPost")) {
      const i = variables.input;
      const ch = channels.find((c) => c.id === i.channelId);
      const p = { id: `p${seq++}`, channelId: i.channelId, channelService: ch.service, status: i.saveToDraft ? "draft" : "scheduled", text: i.text, dueAt: i.dueAt ?? iso(now + 864e5), sentAt: null, isCustomScheduled: true, externalLink: null, error: null, assets: [{ thumbnail: null }] };
      posts.push(p);
      data = { createPost: { __typename: "PostActionSuccess", post: p } };
    }
    json({ data });
  });
}

export function graphMock() {
  const status = {};
  return serve(({ req, url, body, json, log }) => {
    const q = Object.fromEntries(url.searchParams);
    const b = Object.fromEntries(new URLSearchParams(body.toString()));
    const p = url.pathname;
    log.push({ m: req.method, p, q, b });
    let m;
    if (p === "/oauth/access_token" && q.code === "iguni") return json({ access_token: "SUAT" });
    if (p === "/oauth/access_token") return json({ access_token: q.fb_exchange_token ? "LONG" : "SHORT", expires_in: 5000 });
    if (p === "/me/assigned_instagram_accounts") return json({ data: [{ id: "ig9", username: "airfixertbls" }] });
    if (p === "/me/accounts")
      return json({ data: [{ id: "p1", name: "AirFixer", access_token: "PT1", instagram_business_account: { id: "ig1", username: "airfixer.ge" } }] });
    if ((m = p.match(/^\/(ig\d)\/media$/))) {
      const id = `c${log.length}`;
      status[id] = 0;
      return json({ id });
    }
    if ((m = p.match(/^\/(c\d+)$/))) {
      status[m[1]] = (status[m[1]] || 0) + 1;
      return json({ status_code: status[m[1]] > 1 ? "FINISHED" : "IN_PROGRESS" });
    }
    if ((m = p.match(/^\/(ig\d)\/media_publish$/))) return json({ id: `m_${b.creation_id}` });
    if ((m = p.match(/^\/(m_c\d+)\/comments$/))) return json({ id: "cm1" });
    if ((m = p.match(/^\/(m_c\d+)\/insights$/))) return json({ data: [{ name: "views", values: [{ value: 500 }] }, { name: "likes", values: [{ value: 20 }] }, { name: "comments", values: [{ value: 2 }] }] });
    if ((m = p.match(/^\/(m_c\d+)$/))) return json({ permalink: `https://instagram.com/reel/${m[1]}` });
    if ((m = p.match(/^\/(p\d)\/video_reels$/))) return json(b.upload_phase === "start" ? { video_id: `v_${m[1]}` } : { success: true });
    if (p.startsWith("/rupload/")) return json({ success: true });
    if ((m = p.match(/^\/(v_p\d)$/))) return json({ status: { video_status: "ready", publishing_phase: { status: "complete" } }, permalink_url: "/reel/123" });
    json({ error: { message: `not mocked ${p}` } }, 404);
  });
}

export function telegramMock() {
  const chat = { id: -1001234567890, type: "channel", title: "AirFixer TG", username: "airfixer_tg" };
  return serve(({ url, body, json, log, req }) => {
    const m = /^\/bot([^/]+)\/(\w+)/.exec(url.pathname);
    const method = m?.[2];
    const s = body.toString("latin1");
    log.push({ method, caption: /name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(s)?.[1] ? Buffer.from(/name="caption"\r\n\r\n([\s\S]*?)\r\n--/.exec(s)[1], "latin1").toString() : null, markup: /name="reply_markup"\r\n\r\n([^\r]+)/.exec(s)?.[1], len: body.length, ct: req.headers["content-type"] });
    const ok = (result) => json({ ok: true, result });
    if (m?.[1] !== "tg-test-token") return json({ ok: false, description: "Unauthorized" }, 401);
    if (method === "getMe") return ok({ id: 777, username: "postfixer_test_bot" });
    if (method === "getUpdates") return ok([{ update_id: 1, my_chat_member: { chat, new_chat_member: { status: "administrator" } } }]);
    if (method === "getChat") return ok(chat);
    if (method === "getChatMember") return ok({ status: "administrator", can_post_messages: true });
    if (method === "sendVideo") return ok({ message_id: 42, chat });
    json({ ok: false, description: "unknown" }, 404);
  });
}

/** Google: OAuth, канал, «возобновляемая» загрузка (первый кусок принимается наполовину — проверка докачки), цифры ролика. */
export function googleMock() {
  const st = { received: 0, total: 0, puts: 0, meta: null };
  return serve(({ req, url, body, json, log, res }) => {
    const p = url.pathname;
    log.push({ m: req.method, p, cr: req.headers["content-range"], len: body.length });
    if (p === "/token") {
      const f = new URLSearchParams(body.toString());
      if (f.get("client_secret") !== "g-secret") return json({ error: "invalid_client" }, 401);
      if (f.get("grant_type") === "authorization_code") return json({ access_token: "acc1", refresh_token: "ref1" });
      return f.get("refresh_token") === "ref1" ? json({ access_token: "acc2" }) : json({ error: "invalid_grant" }, 400);
    }
    if (p === "/youtube/v3/channels") return json({ items: [{ id: "UCtest", snippet: { title: "Airfixer" } }] });
    if (p === "/youtube/v3/videos" && req.method === "GET") return json({ items: [{ statistics: { viewCount: "321", likeCount: "12", commentCount: "3" } }] });
    if (p === "/upload/youtube/v3/videos" && req.method === "POST") {
      st.meta = JSON.parse(body.toString());
      st.total = Number(req.headers["x-upload-content-length"]);
      st.received = 0;
      return json({}, 200, { Location: `${`http://127.0.0.1:${req.socket.localPort}`}/session/s1` });
    }
    if (p === "/session/s1" && req.method === "PUT") {
      st.puts++;
      const cr = req.headers["content-range"] || "";
      if (cr.startsWith("bytes */")) {
        if (st.received >= st.total && st.total > 0) return json({ id: "vid42" });
        res.writeHead(308, st.received ? { Range: `bytes=0-${st.received - 1}` } : {});
        return res.end();
      }
      const start = Number(/bytes (\d+)-/.exec(cr)?.[1]);
      if (start !== st.received) return json({ error: { message: "bad offset" } }, 400);
      st.received += st.puts <= 2 ? Math.floor(body.length / 2) : body.length;
      if (st.received >= st.total) return json({ id: "vid42" }, 201);
      res.writeHead(308, { Range: `bytes=0-${st.received - 1}` });
      return res.end();
    }
    json({ error: { message: `not mocked ${p}` } }, 404);
  }).then((m) => Object.assign(m, { state: st }));
}

export function threadsMock() {
  let polls = 0;
  return serve(({ req, url, body, json, log }) => {
    const p = req.method === "GET" ? url.searchParams : new URLSearchParams(body.toString());
    log.push({ m: req.method, p: url.pathname, text: p.get("text"), media_type: p.get("media_type"), tok: p.get("access_token") });
    if (url.pathname === "/oauth/access_token") return p.get("client_secret") === "th-secret" ? json({ access_token: "short1", user_id: 9988 }) : json({ error: { message: "Invalid client secret" } }, 400);
    if (url.pathname === "/access_token") return json({ access_token: "long1", expires_in: 5184000 });
    if (url.pathname === "/refresh_access_token") return json({ access_token: "long2", expires_in: 5184000 });
    if (!/^long/.test(p.get("access_token") || "")) return json({ error: { message: "Error validating access token" } }, 400);
    if (url.pathname === "/v1.0/me") return json({ id: "9988", username: "airfixertbls" });
    if (url.pathname === "/v1.0/9988/threads") return json({ id: "cont1" });
    if (url.pathname === "/v1.0/cont1") return json({ status: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
    if (url.pathname === "/v1.0/9988/threads_publish") return json({ id: "post77" });
    if (url.pathname === "/v1.0/post77/insights") return json({ data: [{ name: "views", values: [{ value: 900 }] }, { name: "likes", values: [{ value: 40 }] }, { name: "replies", values: [{ value: 5 }] }] });
    if (url.pathname === "/v1.0/post77") return json({ permalink: "https://www.threads.com/@airfixertbls/post/ABC" });
    json({ error: { message: `unknown ${url.pathname}` } }, 404);
  });
}
