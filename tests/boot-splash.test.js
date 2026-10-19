'use strict';
/* ============================================================
   دخول مباشر: من له جلسة محفوظة لا تظهر له شاشة الدخول أثناء التحقق منها —
   "جارٍ الدخول…" (html.booting) ثم التطبيق؛ وإن لم تصلح الجلسة فشاشة الدخول.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./load-app');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

function clientWith(session){
  const permissive = (p) => new Proxy(function(){}, {
    get: (t, k) => (k === 'then' ? (res, rej) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej) : permissive(p.concat(String(k)))),
    apply: () => {
      const last = p[p.length - 1];
      if(last === 'getSession') return session instanceof Error ? Promise.reject(session) : Promise.resolve({ data: { session }, error: null });
      if(last === 'onAuthStateChange') return { data: { subscription: { unsubscribe(){} } } };
      return permissive(p.concat('()'));
    }
  });
  return permissive([]);
}

async function boot(session){
  const a = loadApp({ supabaseClient: clientWith(session), location: { hash: '', pathname: '/index.html', search: '' } });
  a.document.documentElement.classList.add('booting');
  a.checkExistingSession();
  await new Promise(r => setTimeout(r, 50));
  return a;
}

test('سكربت الإقلاع في <head> قبل شاشة الدخول: يفحص جلسة Supabase المحفوظة ويضع booting، ومهلة احتياطية', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /sb-\.\+-auth-token/);
  assert.match(head, /classList\.add\('booting'\)/);
  assert.match(head, /setTimeout\(function\(\)\{ document\.documentElement\.classList\.remove\('booting'\); \}, 12000\)/);
  assert.match(head, /type=recovery/, 'رابط استعادة كلمة المرور لا يُخفي شاشة الدخول');
  assert.ok(html.indexOf('id="bootSplash"') < html.indexOf('id="authView"'));
  assert.match(css, /html\.booting #authView\{display:none !important;\}/);
  assert.match(css, /html\.booting \.boot-splash\{display:flex;/);
});

test('جلسة صالحة: "جارٍ الدخول…" يزول بعد إظهار التطبيق (لا قبله)', async () => {
  const a = await boot({ user: { id: 'u1', email: 't@x.sa', user_metadata: {} } });
  assert.equal(a.document.getElementById('appView').style.display, 'block');
  assert.equal(a.document.documentElement.classList.contains('booting'), false);
});

test('لا جلسة صالحة (منتهية مثلًا): يزول فتظهر شاشة الدخول', async () => {
  const a = await boot(null);
  assert.equal(a.document.documentElement.classList.contains('booting'), false);
  assert.notEqual(a.document.getElementById('appView').style.display, 'block');
});

test('فشل قراءة الجلسة: لا يعلق على "جارٍ الدخول…"', async () => {
  const a = await boot(new Error('offline'));
  assert.equal(a.document.documentElement.classList.contains('booting'), false);
});

test('رابط استعادة كلمة المرور: يزول فتظهر نافذة كلمة المرور الجديدة', () => {
  const a = loadApp();
  a.document.documentElement.classList.add('booting');
  a.showRecoveryUI();
  assert.equal(a.document.documentElement.classList.contains('booting'), false);
});
