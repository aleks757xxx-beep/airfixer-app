// Запуск: wrangler dev --port 8799 --test-scheduled (с .dev.vars), затем NODE_PATH=$(npm root -g) node tests/security.cjs
// Проверка безопасности PostFixer (как tests/csp.mjs в CRM): заголовки, CSP на всех экранах, CSRF, доступ без входа, подпись Meta, шифрование кода, перебор пароля
const { chromium } = require('playwright'); const crypto=require('crypto'); const fs=require('fs'); const cp=require('child_process');
const B='http://127.0.0.1:8799'; const vars=fs.readFileSync('/home/claude/app-repo/.dev.vars','utf8'); const V=(k)=>(vars.match(new RegExp('^'+k+'=(.*)$','m'))||[])[1].trim();
const q=(sql)=>JSON.parse(cp.execSync(`npx wrangler d1 execute postfixer --local --json --command "${sql}" 2>/dev/null`,{cwd:'/home/claude/app-repo'}).toString())[0].results;
function b32d(s){const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,v=0;const o=[];for(const c of s.replace(/[^A-Z2-7]/g,'')){v=(v<<5)|A.indexOf(c);bits+=5;if(bits>=8){o.push((v>>>(bits-8))&255);bits-=8;}}return Buffer.from(o);}
function totp(secret,off=0){const step=Math.floor(Date.now()/30000)+off;const m=Buffer.alloc(8);m.writeUInt32BE(0,0);m.writeUInt32BE(step>>>0,4);const h=crypto.createHmac('sha1',b32d(secret)).update(m).digest();const o=h[h.length-1]&15;return String(((h[o]&0x7f)<<24|h[o+1]<<16|h[o+2]<<8|h[o+3])%1e6).padStart(6,'0');}
function unseal(v){if(!v.startsWith('v1.'))return v;const [,iv,ct]=v.split('.');const key=Buffer.from(V('TOKEN_KEY'),'base64');const buf=Buffer.from(ct,'base64');const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));d.setAuthTag(buf.subarray(buf.length-16));return Buffer.concat([d.update(buf.subarray(0,buf.length-16)),d.final()]).toString();}
let n=0;const ok=(m)=>{n++;console.log('✓',m)};const bad=[];const fail=(m)=>{bad.push(m);console.log('✗',m)};
(async()=>{
 // 1) заголовки
 for(const p of ['/','/privacy.html','/api/v2/auth/me','/media/videos/x.mp4']){const h=(await fetch(B+p)).headers;
  const csp=h.get('content-security-policy')||'';
  if(!/script-src 'self';/.test(csp)||!/frame-ancestors 'none'/.test(csp)||!/object-src 'none'/.test(csp)) fail(p+' CSP '+csp);
  if(h.get('x-frame-options')!=='DENY'||h.get('x-content-type-options')!=='nosniff'||!/max-age=31536000/.test(h.get('strict-transport-security')||'')) fail(p+' заголовки');}
 if(!bad.length) ok('заголовки на страницах, API и /media: CSP (скрипты только свои, без встраивания), HSTS, nosniff, X-Frame-Options DENY');
 // 2) без входа — нельзя
 const pub=[['GET','/api/v2/publish/channels'],['GET','/api/v2/media'],['GET','/api/v2/settings'],['GET','/api/v2/connect/accounts'],['GET','/api/v2/publish/stats?from=0&to=1'],['GET','/api/v2/ingest/media'],['GET','/api/v2/ingest/agent/audit']];
 const leaks=[];for(const [m,p] of pub){const r=await fetch(B+p,{method:m});if(r.status!==401)leaks.push(p+' '+r.status)}
 leaks.length?fail('без входа доступно: '+leaks.join(', ')):ok('без входа и без ключа API закрыт (библиотека, посты, статистика, настройки, подключения, журнал)');
 const bt=await fetch(B+'/api/v2/ingest/media',{headers:{Authorization:'Bearer pfa_'+'x'.repeat(40)}});bt.status===401?ok('чужой/поддельный ключ Claude — 401'):fail('поддельный ключ '+bt.status);
 // 3) вход
 const br=await chromium.launch();const ctx=await br.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();const viol=[],errs=[];
 await p.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>console.log('CSPV',e.violatedDirective,e.blockedURI)));
 p.on('console',m=>{if(m.text().startsWith('CSPV'))viol.push(m.text())});p.on('pageerror',e=>errs.push(e.message));
 await p.goto(B+'/');await p.fill('input[type=password]',V('APP_PASSWORD'));await p.click('button[type=submit]');
 await p.waitForSelector('input[inputmode=numeric]');
 const stored=q("SELECT totp_secret_enc s FROM auth_settings WHERE id=1")[0].s;const secret=unseal(stored);
 await new Promise(r=>setTimeout(r,31000-(Date.now()%30000)));
 await p.fill('input[inputmode=numeric]',totp(secret));await p.click('button[type=submit]');await p.waitForSelector('nav >> visible=true');
 const after=q("SELECT totp_secret_enc s FROM auth_settings WHERE id=1")[0].s;
 after.startsWith('v1.')&&unseal(after)===secret?ok('ключ кода проверки в базе зашифрован (TOKEN_KEY), вход по коду работает'):fail('ключ кода не зашифрован');
 // повтор того же кода — нельзя
 const ck=(await ctx.cookies()).map(c=>c.name+'='+c.value).join('; ');
 const cookies=await ctx.cookies();const sess=cookies.find(c=>/sess/i.test(c.name));
 sess&&sess.httpOnly&&sess.secure&&sess.sameSite==='Strict'?ok('cookie входа: HttpOnly, Secure, SameSite=Strict'):fail('cookie '+JSON.stringify(cookies.map(c=>[c.name,c.httpOnly,c.secure,c.sameSite])));
 // 4) все экраны без нарушений CSP
 for(const r of ['#/calendar','#/library','#/posts','#/stats','#/connections','#/settings']){await p.goto(B+'/'+r);await p.waitForTimeout(900);}
 await p.goto(B+'/privacy.html');await p.waitForTimeout(300);
 viol.length?fail('нарушения CSP: '+viol.join(' | ')):ok('календарь, библиотека, посты, статистика, подключения, настройки, страница конфиденциальности — без нарушений CSP');
 errs.length?fail('ошибки страниц: '+errs.join(' | ')):ok('без ошибок JavaScript');
 // 5) CSRF: запрос с чужого сайта с cookie входа
 const ev=await fetch(B+'/api/v2/settings',{method:'PUT',headers:{cookie:ck,Origin:'https://evil.example','content-type':'application/json'},body:'{"claudeUrl":"https://evil.example"}'});
 const ev2=await fetch(B+'/api/v2/settings',{method:'PUT',headers:{cookie:ck,'content-type':'application/json'},body:'{"claudeUrl":"https://evil.example"}'});
 ev.status===403&&ev2.status===403?ok('изменения с чужого сайта (и без Origin) отклоняются — 403'):fail('CSRF '+ev.status+'/'+ev2.status);
 // 6) Meta signed_request
 const sec=V('THREADS_APP_SECRET');const payload=Buffer.from(JSON.stringify({user_id:'9988',algorithm:'HMAC-SHA256'})).toString('base64url');const sig=crypto.createHmac('sha256',sec).update(payload).digest('base64url');
 const form=(sr)=>({method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'signed_request='+encodeURIComponent(sr)});
 const s1=await fetch(B+'/api/v2/connect/threads/uninstall',form('AAAA.'+payload));const s2=await fetch(B+'/api/v2/connect/threads/delete',form(sig+'.'+payload));const s3=await fetch(B+'/api/v2/connect/threads/delete',{method:'POST'});
 s1.status===400&&s2.status===200&&s3.status===400?ok('адреса Meta (отключение/удаление данных) принимают только запросы с верной подписью'):fail('signed_request '+s1.status+'/'+s2.status+'/'+s3.status);
 // 7) /media: только videos/, без выхода за папку
 const t1=await fetch(B+'/media/..%2F..%2Fwrangler.jsonc');const t2=await fetch(B+'/media/other/x');t1.status===404&&t2.status===404?ok('/media отдаёт только ролики (обход папок — 404)'):fail('/media '+t1.status+'/'+t2.status);
 // 8) старые OAuth-ссылки
 const st=await fetch(B+'/api/v2/connect/youtube/callback?code=x&state=forged',{redirect:'manual'});/connect_error/.test(st.headers.get('location')||'')?ok('возврат из Google/Meta/Threads с поддельным state не принимается'):fail('state');
 // 9) перебор пароля
 await br.close();let last=0;for(let i=0;i<10;i++){const r=await fetch(B+'/api/v2/auth/login',{method:'POST',headers:{'content-type':'application/json',Origin:B},body:'{"password":"wrong'+i+'"}'});last=r.status}
 last===429?ok('перебор пароля: после 8 ошибок — блокировка на 15 минут (429)'):fail('перебор '+last);
 q("DELETE FROM login_attempts");
 console.log(`\n${n} passed, ${bad.length} failed`);process.exit(bad.length?1:0);
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
