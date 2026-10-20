'use strict';
/* ============================================================
   نافذة "تحديث جديد متاح" — version.json أحدث من APP_VERSION:
   تظهر بما الجديد (مُهرَّبًا)، ولا تظهر أثناء ورقة رصد مفتوحة (تنتظر إغلاقها)،
   و"تحديث الآن" ينتظر اكتمال الحفظ الجاري ثم يعيد الفتح، و"لاحقًا" يؤجّل ساعة.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadApp, runInAppContext } = require('./load-app');

const get = (app, e) => runInAppContext(app, e);
/* أرقام نسبية للإصدار الحالي (لا تنكسر الاختبارات مع كل رفع للإصدار) */
const CURRENT = get(loadApp(), 'APP_VERSION');
const bump = (v, n) => { const p = v.split('.').map(Number); p[p.length - 1] += n; return p.join('.'); };
const NEXT = bump(CURRENT, 1), NEXT2 = bump(CURRENT, 2);
const esc = v => v.replace(/\./g, '\\.');

function appWith(info){
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__fetched = []; fetch = async url => { window.__fetched.push(url); return { ok: true, json: async () => (${JSON.stringify(info)}) }; };
    window.__appended = []; document.body.appendChild = el => { window.__appended.push(el); window.__sheetEl = el; };
    { const _g = document.getElementById; document.getElementById = id => id === 'updateSheet' ? (window.__sheetEl ? Object.assign(window.__sheetEl, { remove(){ window.__sheetEl = null; } }) : null) : _g(id); }
    window.__reloaded = 0; location.reload = () => { window.__reloaded++; };`);
  return app;
}

test('version.json وAPP_VERSION متطابقان (يُرفعان معًا في كل تحديث)، وملاحظاته نصوص', () => {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8'));
  const app = loadApp();
  assert.equal(info.version, get(app, 'APP_VERSION'));
  assert.ok(Array.isArray(info.notes) && info.notes.length && info.notes.every(n => typeof n === 'string'));
});

test('compareVersions — رقميًا جزءًا جزءًا (1.10 أحدث من 1.9)', () => {
  const app = loadApp();
  assert.equal(app.compareVersions('1.10', '1.9'), 1);
  assert.equal(app.compareVersions('1.0', '1'), 0);
  assert.equal(app.compareVersions('1.2', '1.2.1'), -1);
});

test('إصدار أحدث: نافذة بالإصدارين وما الجديد مُهرَّبًا، والطلب بلا كاش', async () => {
  const app = appWith({ version: NEXT, notes: ['زرّا + و − <img src=x>', 5] });
  await app.checkForUpdate();
  assert.match(get(app, 'window.__fetched[0]'), /^version\.json\?t=\d+$/);
  const h = get(app, 'window.__sheetEl.innerHTML');
  assert.match(h, new RegExp(`الإصدار ${esc(NEXT)}</span> <span class="upd-sub">· إصدارك ${esc(CURRENT)}`));
  assert.match(h, /<li>زرّا \+ و − &lt;img src=x&gt;<\/li>/);
  assert.doesNotMatch(h, /<img src=x>/);
  assert.doesNotMatch(h, /<li>5<\/li>/, 'غير النصوص تُتجاهل');
  assert.match(h, /رصدك محفوظ/);
});

test('نفس الإصدار أو أقدم: لا نافذة', async () => {
  for(const v of [CURRENT, '0.1']){
    const app = appWith({ version: v, notes: [] });
    assert.equal(await app.checkForUpdate(), null);
    assert.equal(get(app, 'window.__appended.length'), 0);
  }
});

test('أثناء ورقة رصد مفتوحة لا تظهر — وتظهر بعد إغلاقها', async () => {
  const app = appWith({ version: NEXT, notes: ['أ'] });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-20', period: 1 };
    showCrmLessonSheetPane = () => {}; renderCrmLinkBanner = () => {}; switchCrmTab = () => {};`);
  await app.checkForUpdate();
  assert.equal(get(app, 'window.__appended.length'), 0, 'لا مقاطعة أثناء الرصد');
  app.closeCrmLessonSheet();
  assert.equal(get(app, 'window.__appended.length'), 1);
});

test('"لاحقًا" يؤجّل ساعة لنفس الإصدار، وإصدار أحدث منه يظهر', async () => {
  const app = appWith({ version: NEXT, notes: [] });
  await app.checkForUpdate();
  app.snoozeUpdate();
  assert.equal(get(app, 'window.__sheetEl'), null);
  await app.checkForUpdate();
  assert.equal(get(app, 'window.__appended.length'), 1, 'مؤجّل');
  runInAppContext(app, `fetch = async () => ({ ok: true, json: async () => ({ version: '${NEXT2}', notes: [] }) });`);
  await app.checkForUpdate();
  assert.equal(get(app, 'window.__appended.length'), 2);
});

test('"تحديث الآن" ينتظر اكتمال الحفظ الجاري في الورقة ثم يعيد الفتح، ونقرتان = إعادة واحدة', async () => {
  const app = appWith({ version: NEXT, notes: [] });
  runInAppContext(app, `window.__done = false;
    crmSheet = { part: { queue: new Map([['a', new Promise(r => setTimeout(() => { window.__done = true; r(); }, 30))]]) } };`);
  const p = Promise.all([app.applyUpdate(), app.applyUpdate()]);
  assert.equal(get(app, 'window.__reloaded'), 0, 'لا إعادة قبل اكتمال الحفظ');
  await p;
  assert.equal(get(app, 'window.__done'), true);
  assert.equal(get(app, 'window.__reloaded'), 1);
});

test('بلا إنترنت: لا خطأ ولا نافذة', async () => {
  const app = appWith({});
  runInAppContext(app, `fetch = async () => { throw new Error('offline'); };`);
  assert.equal(await app.checkForUpdate(), null);
});

test('Service Worker لا يخزّن version.json ولا يخدمه من الكاش', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  let handler = null;
  const ctx = { self: { addEventListener: (t, fn) => { if(t === 'fetch') handler = fn; }, location: { origin: 'https://x' }, skipWaiting(){}, clients: { claim(){} } }, caches: {}, URL, fetch: () => Promise.resolve() };
  vm.runInNewContext(src, ctx);
  let responded = false;
  handler({ request: { method: 'GET', url: 'https://x/version.json?t=1' }, respondWith(){ responded = true; } });
  assert.equal(responded, false, 'يُترك للشبكة مباشرة');
  handler({ request: { method: 'GET', url: 'https://x/style.css' }, respondWith(){ responded = true; } });
  assert.equal(responded, true);
});
