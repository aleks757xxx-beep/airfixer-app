// AirFixer — приложение для постинга (Cloudflare Worker)
// Нужно в настройках Worker:
//   R2 binding:  BUCKET  -> airfixer-video
//   Secret:      BUFFER_API_KEY  (ключ из Buffer → Settings → API)
//   Secret:      APP_PASSWORD    (пароль для входа в приложение)
//   Secret:      UPLOAD_TOKEN    (токен для автозагрузки из папки «Готовое»)

const BUFFER_API = "https://api.buffer.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Видео отдаются публично — их скачивает Buffer в момент публикации
    if (url.pathname.startsWith("/media/")) return serveMedia(request, env, url);

    // Автозагрузка из папки «Готовое» на Mac (по токену UPLOAD_TOKEN)
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!env.UPLOAD_TOKEN || !safeEqual(t, String(env.UPLOAD_TOKEN).trim())) return json({ error: "bad token" }, 401);
      try { return json(await ingest(request, env, url)); }
      catch (e) { return json({ error: String(e && e.message ? e.message : e) }, 500); }
    }

    // Вход / выход
    if (url.pathname === "/login" && request.method === "GET") return html(loginPage(""));
    if (url.pathname === "/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/logout") return redirect("/login", clearCookie());

    // Всё остальное — только после входа
    if (!(await checkAuth(request, env))) {
      if (url.pathname.startsWith("/api/")) return json({ error: "Нужно войти заново" }, 401);
      return redirect("/login");
    }

    try {
      if (url.pathname === "/" && request.method === "GET") return html(PAGE);
      if (url.pathname === "/api/channels" && request.method === "GET") return json(await getChannels(env));
      if (url.pathname === "/api/upload" && request.method === "POST") return json(await upload(request, env, url));
      if (url.pathname === "/api/library" && request.method === "GET") return json(await library(env, url));
      if (url.pathname === "/api/schedule" && request.method === "POST") return json(await schedule(request, env, url));
      return new Response("Not found", { status: 404 });
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500);
    }
  },

  // Автоочистка: удаляет ролики старше 30 дней (если включить Cron Trigger)
  async scheduled(event, env) {
    const limit = Date.now() - 30 * 24 * 3600 * 1000;
    let cursor;
    do {
      const list = await env.BUCKET.list({ prefix: "videos/", cursor });
      const old = list.objects.filter((o) => o.uploaded.getTime() < limit).map((o) => o.key);
      if (old.length) await env.BUCKET.delete(old);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  },
};

// ---------- auth ----------
const COOKIE = "af_session";
const SESSION_DAYS = 30;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function checkAuth(request, env) {
  if (!env.APP_PASSWORD) return false;
  const m = (request.headers.get("Cookie") || "").match(new RegExp(COOKIE + "=([^;]+)"));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.APP_PASSWORD, "airfixer-v1:" + exp));
}

async function login(request, env) {
  const form = await request.formData().catch(() => null);
  const pass = form ? String(form.get("password") || "").trim() : "";
  if (!env.APP_PASSWORD) return html(loginPage("В Cloudflare не задан секрет APP_PASSWORD"), 500);
  if (!safeEqual(pass, String(env.APP_PASSWORD).trim())) {
    await new Promise((r) => setTimeout(r, 800));
    return html(loginPage("Неверный пароль"), 401);
  }
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const token = exp + "." + (await hmac(env.APP_PASSWORD, "airfixer-v1:" + exp));
  return redirect("/", `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`);
}

const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

function redirect(to, cookie) {
  const h = new Headers({ Location: to });
  if (cookie) h.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers: h });
}

function loginPage(err) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AirFixer — вход</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#2D2C38;color:#fff;font-family:Inter,Helvetica,Arial,sans-serif;padding:16px}
form{width:100%;max-width:360px;background:#1f1e29;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:28px}
h1{margin:0 0 6px;font-size:26px;font-weight:800}p{margin:0 0 20px;color:#6E8BFF;font-weight:600}
input{width:100%;box-sizing:border-box;background:#10121A;border:1px solid rgba(255,255,255,.15);color:#fff;border-radius:12px;padding:14px;font:16px Inter,sans-serif;margin-bottom:14px}
button{width:100%;border:0;border-radius:999px;padding:15px;font:700 17px Inter,sans-serif;color:#fff;background:#2AABEE;cursor:pointer}
.err{color:#ff7b7b;margin-bottom:12px;font-weight:600}</style></head><body>
<form method="post" action="/login"><h1>🍁 AirFixer</h1><p>Постинг</p>
${err ? `<div class="err">${err}</div>` : ""}
<input type="password" name="password" placeholder="Пароль" autocomplete="current-password" autofocus required>
<button type="submit">Войти</button></form></body></html>`;
}

// ---------- media ----------
async function serveMedia(request, env, url) {
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  const obj = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
  if (obj === null) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=86400");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  let status = 200;
  if (obj.range && request.headers.has("range")) {
    const r = obj.range;
    const start = r.offset ?? (r.suffix !== undefined ? obj.size - r.suffix : 0);
    const len = r.length ?? (r.suffix !== undefined ? r.suffix : obj.size - start);
    headers.set("content-range", `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set("content-length", String(len));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  return new Response(request.method === "HEAD" ? null : obj.body, { status, headers });
}

const mediaUrl = (origin, key) => `${origin}/media/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
const asciiName = (n) => {
  const dot = n.lastIndexOf(".");
  const ext = dot > 0 ? n.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : ".mp4";
  return "video" + ext;
};
const contentTypeFor = (n, fallback) =>
  /\.mov$/i.test(n) ? "video/quicktime" : /\.mp4$/i.test(n) ? "video/mp4" : fallback || "video/mp4";

async function upload(request, env, url) {
  const display = (url.searchParams.get("name") || "video.mp4").slice(0, 120);
  const key = `videos/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${asciiName(display)}`;
  await env.BUCKET.put(key, request.body, {
    httpMetadata: { contentType: contentTypeFor(display, request.headers.get("content-type")) },
    customMetadata: { name: encodeURIComponent(display), source: "upload" },
  });
  return { key, url: mediaUrl(url.origin, key), name: display };
}

// Загрузка из папки «Готовое»: имя файла приходит в заголовке X-File-Name (base64, UTF-8)
async function ingest(request, env, url) {
  let display = "video.mp4";
  try {
    const b = request.headers.get("X-File-Name") || "";
    if (b) display = new TextDecoder().decode(Uint8Array.from(atob(b.trim()), (c) => c.charCodeAt(0))).trim();
  } catch {}
  display = display.normalize("NFC").slice(0, 120);
  const size = Number(request.headers.get("content-length") || 0);
  // Не загружать повторно тот же файл (то же имя и размер)
  const existing = await findByName(env, display);
  if (existing && size && existing.size === size) {
    if (request.body) await request.body.cancel();
    return { key: existing.key, url: mediaUrl(url.origin, existing.key), name: display, skipped: true };
  }
  const key = `videos/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${asciiName(display)}`;
  await env.BUCKET.put(key, request.body, {
    httpMetadata: { contentType: contentTypeFor(display) },
    customMetadata: { name: encodeURIComponent(display), source: "gotovoe" },
  });
  return { key, url: mediaUrl(url.origin, key), name: display };
}

async function listVideos(env) {
  const out = [];
  let cursor;
  do {
    const l = await env.BUCKET.list({ prefix: "videos/", cursor, include: ["customMetadata"] });
    out.push(...l.objects);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor && out.length < 1000);
  return out;
}

async function findByName(env, display) {
  const enc = encodeURIComponent(display);
  return (await listVideos(env)).find((o) => o.customMetadata && o.customMetadata.name === enc) || null;
}

async function library(env, url) {
  const items = (await listVideos(env))
    .sort((a, b) => b.uploaded - a.uploaded)
    .slice(0, 60)
    .map((o) => ({
      key: o.key,
      url: mediaUrl(url.origin, o.key),
      name: o.customMetadata && o.customMetadata.name ? decodeURIComponent(o.customMetadata.name) : o.key.split("/").pop(),
      size: o.size,
      uploaded: o.uploaded,
      source: (o.customMetadata && o.customMetadata.source) || "",
    }));
  return { items };
}

// ---------- Buffer ----------
async function buffer(env, query) {
  if (!env.BUFFER_API_KEY) throw new Error("Не задан секрет BUFFER_API_KEY");
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.BUFFER_API_KEY}` },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) throw new Error("Buffer: " + JSON.stringify(data.errors || data || res.status));
  return data.data;
}

async function getChannels(env) {
  const acc = await buffer(env, `query { account { organizations { id name } } }`);
  const out = [];
  for (const org of acc.account.organizations) {
    const ch = await buffer(env, `query { channels(input: { organizationId: ${s(org.id)} }) { id name service } }`);
    for (const c of ch.channels) out.push({ ...c, organization: org.name });
  }
  return { channels: out };
}

// GraphQL helpers: строка в кавычках / enum без кавычек
const s = (v) => JSON.stringify(String(v));

function metadataFor(service, opts) {
  switch (service) {
    case "instagram": return `instagram: { type: reel, shouldShareToFeed: true }`;
    case "facebook":  return `facebook: { type: reel }`;
    case "youtube":   return `youtube: { title: ${s(opts.ytTitle || "AirFixer")}, categoryId: "26", privacy: public, madeForKids: false }`;
    case "tiktok":    return `tiktok: { isAiGenerated: false }`;
    default: return "";
  }
}

async function schedule(request, env, url) {
  const b = await request.json();
  if (!b.mediaUrl) throw new Error("Нет видео");
  if (!b.channels || !b.channels.length) throw new Error("Не выбраны каналы");
  const when = b.dueAt
    ? `mode: customScheduled, dueAt: ${s(new Date(b.dueAt).toISOString())}`
    : `mode: addToQueue`;
  const results = [];
  for (const ch of b.channels) {
    const meta = metadataFor(ch.service, b);
    const q = `mutation { createPost(input: {
      text: ${s(b.text || "")},
      channelId: ${s(ch.id)},
      schedulingType: automatic,
      ${when},
      assets: [{ video: { url: ${s(b.mediaUrl)}, metadata: { thumbnailOffset: 1500 } } }]
      ${meta ? `, metadata: { ${meta} }` : ""}
    }) {
      ... on PostActionSuccess { post { id dueAt } }
      ... on MutationError { message }
    } }`;
    try {
      const d = await buffer(env, q);
      const r = d.createPost;
      results.push({ channel: ch.name, service: ch.service, ok: !!r.post, message: r.message || "", dueAt: r.post && r.post.dueAt });
    } catch (e) {
      results.push({ channel: ch.name, service: ch.service, ok: false, message: String(e.message || e) });
    }
  }
  return { results };
}

// ---------- utils ----------
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const html = (t, status = 200) => new Response(t, { status, headers: { "content-type": "text/html; charset=utf-8" } });

// ---------- страница приложения ----------
const PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AirFixer — Постинг</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#2D2C38;--dark:#10121A;--card:#1f1e29;--line:rgba(255,255,255,.12);--blue:#3763F4;--blueL:#6E8BFF;--tg:#2AABEE;--wa:#25D366;--text:#fff;--muted:rgba(255,255,255,.65)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,Helvetica,Arial,sans-serif}
header{position:sticky;top:0;background:rgba(16,18,26,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 16px;display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}
header span{color:var(--blueL);font-weight:600;font-size:14px;margin-left:auto}
main{max-width:640px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:30px;font-weight:800;margin:6px 0 4px}.sub{color:var(--blueL);font-weight:600;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:14px}
label{display:block;font-weight:600;margin-bottom:8px}
input[type=text],input[type=datetime-local],textarea{width:100%;background:var(--dark);border:1px solid var(--line);color:#fff;border-radius:12px;padding:12px;font:inherit}
textarea{min-height:130px;resize:vertical}
.drop{border:2px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--muted);cursor:pointer}
.drop.has{border-color:var(--blue);color:#fff}video{width:100%;max-height:420px;border-radius:12px;margin-top:12px;background:#000}
.bar{height:8px;background:var(--dark);border-radius:8px;overflow:hidden;margin-top:10px;display:none}.bar i{display:block;height:100%;width:0;background:var(--blue)}
.ch{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.ch:last-child{border:0}
.ch input{width:20px;height:20px}.tag{font-size:12px;color:var(--muted);margin-left:auto;text-transform:capitalize}
.btn{width:100%;border:0;border-radius:999px;padding:16px;font:700 17px Inter,sans-serif;color:#fff;background:var(--tg);cursor:pointer}
.btn:disabled{opacity:.5}.row{display:flex;gap:10px}.row>*{flex:1}
.small{font-size:13px;color:var(--muted);margin-top:6px}
.lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.it{background:var(--dark);border:2px solid transparent;border-radius:12px;overflow:hidden;cursor:pointer;color:#fff}
.it.sel{border-color:var(--blue)}.it video{width:100%;aspect-ratio:9/16;object-fit:cover;margin:0;border-radius:0;max-height:none;pointer-events:none}
.it div{font-size:12px;padding:6px 8px;line-height:1.3;word-break:break-word}.res div{padding:6px 0}.ok{color:var(--wa)}.err{color:#ff7b7b}
</style></head><body>
<header>🍁 AirFixer <span>Постинг · <a href="/logout" style="color:inherit">выйти</a></span></header>
<main>
<h1>Новый пост</h1><div class="sub">Видео · Подпись · Время · Все соцсети</div>

<div class="card"><label>1. Видео</label>
<div class="drop" id="drop">Нажмите или перетащите ролик сюда</div>
<input type="file" id="file" accept="video/*" hidden>
<video id="prev" controls hidden></video>
<div class="bar" id="bar"><i></i></div><div class="small" id="upInfo"></div>
<label style="margin-top:16px">или из библиотеки <span class="small" style="font-weight:400">(папка «Готовое»)</span></label>
<div id="lib" class="lib small">Загружаю…</div></div>

<div class="card"><label>2. Подпись</label>
<textarea id="text" placeholder="Текст поста и хэштеги"></textarea>
<label style="margin-top:14px">Название для YouTube</label>
<input type="text" id="yt" placeholder="Например: Монтаж кондиционера Midea в Тбилиси"></div>

<div class="card"><label>3. Когда</label>
<div class="row"><input type="datetime-local" id="when"></div>
<div class="small">Пусто — в ближайший свободный слот очереди Buffer. Время — по Тбилиси.</div></div>

<div class="card"><label>4. Куда</label><div id="chs" class="small">Загружаю каналы…</div></div>

<button class="btn" id="go" disabled>Запланировать</button>
<div class="card res" id="res" hidden></div>
</main>
<script>
const $=id=>document.getElementById(id);let media=null,channels=[];
fetch('/api/channels').then(r=>r.json()).then(d=>{
  if(d.error){$('chs').textContent='Ошибка: '+d.error;return}
  channels=d.channels;$('chs').className='';
  $('chs').innerHTML=channels.map((c,i)=>'<div class="ch"><input type="checkbox" id="c'+i+'" checked><label for="c'+i+'" style="margin:0;font-weight:600">'+c.name+'</label><span class="tag">'+c.service+'</span></div>').join('');
});
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('/api/library').then(r=>r.json()).then(d=>{
  if(d.error){$('lib').textContent='Ошибка: '+d.error;return}
  if(!d.items.length){$('lib').textContent='Пока пусто — ролики из папки «Готовое» появятся здесь';return}
  $('lib').innerHTML=d.items.map((x,i)=>'<div class="it" data-i="'+i+'"><video src="'+x.url+'#t=1" preload="metadata" muted playsinline></video><div>'+esc(x.name)+'<br><span style="color:var(--muted)">'+(x.size/1048576).toFixed(0)+' МБ · '+new Date(x.uploaded).toLocaleDateString('ru-RU')+'</span></div></div>').join('');
  [...document.querySelectorAll('.it')].forEach(el=>el.onclick=()=>{
    const x=d.items[+el.dataset.i];document.querySelectorAll('.it').forEach(e=>e.classList.remove('sel'));el.classList.add('sel');
    media=x.url;$('prev').src=x.url;$('prev').hidden=false;$('drop').textContent=x.name;$('drop').classList.add('has');
    $('bar').style.display='none';$('upInfo').textContent='Выбрано из библиотеки ✓';$('go').disabled=false;
  });
});
$('drop').onclick=()=>$('file').click();
$('drop').ondragover=e=>{e.preventDefault()};
$('drop').ondrop=e=>{e.preventDefault();if(e.dataTransfer.files[0])send(e.dataTransfer.files[0])};
$('file').onchange=()=>{if($('file').files[0])send($('file').files[0])};
function send(f){
  media=null;$('go').disabled=true;$('drop').textContent=f.name;$('drop').classList.add('has');
  $('prev').src=URL.createObjectURL(f);$('prev').hidden=false;
  if(f.size>95*1024*1024){$('upInfo').textContent='Файл больше 95 МБ — сожмите ролик';return}
  const x=new XMLHttpRequest();x.open('POST','/api/upload?name='+encodeURIComponent(f.name));
  x.setRequestHeader('content-type',f.type||'video/mp4');$('bar').style.display='block';
  x.upload.onprogress=e=>{$('bar').firstChild.style.width=(e.loaded/e.total*100)+'%';$('upInfo').textContent='Загрузка '+Math.round(e.loaded/e.total*100)+'%'};
  x.onload=()=>{const d=JSON.parse(x.responseText);if(d.error){$('upInfo').textContent='Ошибка: '+d.error;return}
    media=d.url;$('upInfo').textContent='Загружено ✓';$('go').disabled=false};
  x.onerror=()=>{$('upInfo').textContent='Ошибка загрузки'};x.send(f);
}
$('go').onclick=async()=>{
  const sel=channels.filter((c,i)=>$('c'+i)&&$('c'+i).checked);
  if(!sel.length){alert('Выберите каналы');return}
  if(sel.some(c=>c.service==='youtube')&&!$('yt').value.trim()){$('yt').focus();$('yt').placeholder='Нужно название для YouTube';return}
  const w=$('when').value;$('go').disabled=true;$('go').textContent='Отправляю…';
  const r=await fetch('/api/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    mediaUrl:media,text:$('text').value,ytTitle:$('yt').value,dueAt:w?new Date(w).toISOString():null,
    channels:sel.map(c=>({id:c.id,name:c.name,service:c.service}))})}).then(r=>r.json());
  $('res').hidden=false;$('go').textContent='Запланировать';$('go').disabled=false;
  if(r.error){$('res').innerHTML='<div class="err">'+r.error+'</div>';return}
  $('res').innerHTML=r.results.map(x=>'<div class="'+(x.ok?'ok':'err')+'">'+(x.ok?'✓ ':'✗ ')+x.channel+' ('+x.service+')'+(x.ok?(x.dueAt?' — '+new Date(x.dueAt).toLocaleString('ru-RU'):''):' — '+x.message)+'</div>').join('');
};
</script></body></html>`;
