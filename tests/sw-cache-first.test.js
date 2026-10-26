'use strict';
/* Service Worker "الكاش أولًا بإصدار": فتح فوري + تحديث ذري بلا خليط نسخ.
   يُحاكى هنا caches وfetch وأحداث التثبيت/الجلب بالكامل. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function fakeEnv({ failUrl } = {}){
  const stores = new Map();
  const handlers = {};
  const fetched = [];
  const mkCache = name => {
    if(!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const keyOf = r => (typeof r === 'string' ? new URL(r, 'https://x/').href : r.url);
    return {
      put: async (r, res) => { m.set(keyOf(r), res); },
      match: async (r, opts) => {
        let k = keyOf(r);
        if(opts && opts.ignoreSearch) k = k.split('?')[0];
        return m.get(k);
      }
    };
  };
  const ctx = {
    URL, Response: class { constructor(b, init){ Object.assign(this, init); this.body = b; this.ok = true; } },
    Request: class { constructor(u, o){ this.url = new URL(u, 'https://x/').href; this.cache = o && o.cache; } },
    self: { addEventListener: (t, fn) => { handlers[t] = fn; }, location: { origin: 'https://x' }, skipWaiting(){}, clients: { claim(){} } },
    caches: {
      open: async n => mkCache(n),
      keys: async () => [...stores.keys()],
      delete: async n => stores.delete(n)
    },
    fetch: async req => {
      const u = typeof req === 'string' ? new URL(req, 'https://x/').href : req.url;
      fetched.push({ u, cache: req.cache });
      if(failUrl && u.endsWith(failUrl)) return { ok: false, status: 500, redirected: false };
      return { ok: true, status: 200, redirected: false, url: u, type: 'basic', clone(){ return this; } };
    }
  };
  vm.runInNewContext(swSrc, ctx);
  return { ctx, handlers, stores, fetched };
}
const runInstall = async env => { let p; env.handlers.install({ waitUntil: x => { p = x; } }); return p; };
const runFetch = (env, req) => { let p = null; env.handlers.fetch({ request: req, respondWith: x => { p = x; } }); return p; };

test('sw: كل سكربتات index.html وstyle.css ضمن قائمة التخزين (وإلا فتح ناقص بلا اتصال)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shell = vm.runInNewContext(swSrc.slice(swSrc.indexOf('const APP_SHELL'), swSrc.indexOf('];', swSrc.indexOf('const APP_SHELL')) + 2) + '; APP_SHELL');
  for(const m of html.matchAll(/<script src="(app\/[^"]+)"/g)) assert.ok(shell.includes('./' + m[1]), m[1]);
  for(const f of fs.readdirSync(path.join(root, 'app'))) assert.ok(shell.includes('./app/' + f), f);
  for(const f of ['./index.html', './style.css', './manifest.json', './icon-192.png']) assert.ok(shell.includes(f), f);
});

test('sw: رقم الإصدار داخل sw.js يطابق version.json (يُرفعان معًا)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
  assert.match(swSrc, new RegExp("APP_VERSION_SW = '" + v.replace(/\./g, '\\.') + "'"));
});

test('sw: التثبيت يجلب كل الملفات من الشبكة مباشرة (no-store) إلى كاش الإصدار', async () => {
  const env = fakeEnv();
  await runInstall(env);
  const name = [...env.stores.keys()].find(k => k.startsWith('shahid-shell-v'));
  assert.ok(name);
  assert.ok(env.stores.get(name).size >= 30);
  assert.ok(env.fetched.every(f => f.cache === 'no-store'));
});

test('انحدار: فشل أي ملف أثناء التثبيت يفشل التثبيت ويُحذف الكاش الناقص (لا خليط نسخ)', async () => {
  const env = fakeEnv({ failUrl: 'app/app-17-grades.js' });
  await assert.rejects(runInstall(env));
  assert.ok(![...env.stores.keys()].some(k => k.startsWith('shahid-shell-v')));
});

test('sw: الملف المخزّن يُخدَّم من الكاش بلا شبكة، والتنقّل يتجاهل ?query', async () => {
  const env = fakeEnv();
  await runInstall(env);
  env.fetched.length = 0;
  const res = await runFetch(env, { method: 'GET', mode: 'no-cors', url: 'https://x/app/app-01-core.js' });
  assert.ok(res);
  const nav = await runFetch(env, { method: 'GET', mode: 'navigate', url: 'https://x/index.html?ref=1' });
  assert.ok(nav);
  assert.equal(env.fetched.length, 0, 'لا طلب شبكة');
});

test('sw: غير المخزّن (كاستدعاء api) وكل ما ليس GET وversion.json وSupabase يمرّ للشبكة بلا تدخل', async () => {
  const env = fakeEnv();
  await runInstall(env);
  assert.equal(runFetch(env, { method: 'POST', url: 'https://x/app/app-01-core.js' }), null);
  assert.equal(runFetch(env, { method: 'GET', url: 'https://x/version.json?t=1' }), null);
  assert.equal(runFetch(env, { method: 'GET', url: 'https://abc.supabase.co/rest/v1/students' }), null);
  env.fetched.length = 0;
  await runFetch(env, { method: 'GET', mode: 'cors', url: 'https://x/api/anything' });
  assert.equal(env.fetched.length, 1);
  assert.ok(![...env.stores.values()].some(m => [...m.keys()].some(k => k.includes('/api/anything'))), 'لا يُخزَّن');
});

test('sw: التفعيل يحذف كاش الإصدارات القديمة ويُبقي الحالي والخارجي', async () => {
  const env = fakeEnv();
  await runInstall(env);
  await env.ctx.caches.open('shahid-shell-v1.0');
  await env.ctx.caches.open('shahid-ext-v1');
  let p; env.handlers.activate({ waitUntil: x => { p = x; } }); await p;
  const keys = [...env.stores.keys()];
  assert.ok(!keys.includes('shahid-shell-v1.0'));
  assert.ok(keys.includes('shahid-ext-v1'));
  assert.ok(keys.some(k => k === 'shahid-shell-v' + JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version));
});

test('sw: الخطوط فقط تُخدم من كاش خارجي (المكتبات صارت محلية)؛ غيرها من الخارج يُترك', () => {
  const env = fakeEnv();
  assert.equal(runFetch(env, { method: 'GET', url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js' }), null);
  assert.ok(runFetch(env, { method: 'GET', url: 'https://fonts.gstatic.com/s/cairo/x.woff2' }));
  assert.equal(runFetch(env, { method: 'GET', url: 'https://evil.example/x.js' }), null);
});
