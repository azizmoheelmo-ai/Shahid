/* ورقة الحصة: الحضور مستقل عن أوضاع الأدوات (مشاركة/واجب/مهام/أدوات خاصة).
   ما يُرصد في الأدوات يُحفظ بنقرته؛ وزر "حفظ" في شريطها يؤكد اكتماله فقط ولا يمسّ حضور الحصة. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function fakeClient(log, failRpc){
  const api = () => {
    const a = { select: () => a, eq: () => a, in: () => a, order: () => a, limit: () => a,
      insert: () => a, upsert: () => a, update: () => a, delete: () => a,
      maybeSingle: () => Promise.resolve({ data: null, error: null }), single: () => Promise.resolve({ data: null, error: null }),
      then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej) };
    return a;
  };
  return { from: () => api(), rpc(name, args){ log.push({ name, args }); return Promise.resolve(failRpc === name ? { data: null, error: { message: 'boom' } } : { data: 1, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) } };
}

function appWith(log, extra, failRpc){
  const app = loadApp({ supabaseClient: fakeClient(log || [], failRpc), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__closed = 0; window.__modal = []; window.__toasts = [];
    closeCrmLessonSheet = () => { window.__closed++; crmSheet = null; };
    showInfoModal = h => window.__modal.push(h); closeCrmModal = () => {};
    showToast = (m, k) => window.__toasts.push(k + ':' + m);
    invalidateAttention = () => {}; refreshAttention = () => {};
    ${extra || ''}`);
  return app;
}
const sheet = (app, over) => runInAppContext(app, `crmSheet = Object.assign({ sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'participation', states: { a: 'present', b: 'absent' }, lessonId: null }, ${JSON.stringify(over || {})});`);
const get = (app, expr) => runInAppContext(app, expr);

const later = (ms, fn) => new Promise(r => setTimeout(() => { if(fn) fn(); r(); }, ms));

test('زر "حفظ" في أوضاع الأدوات: ينتظر اكتمال الحفظ المعلّق، ثم "تم الحفظ" ويبقى في الورقة', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'participation', lessonId: 'L1' });
  runInAppContext(app, `window.__done = false; crmSheet.part = { queue: new Map([['a', new Promise(r => setTimeout(() => { window.__done = true; r(); }, 30))]]) };`);
  const p = app.finishCrmLessonSheet();
  assert.equal(get(app, 'window.__closed'), 0);
  await p;
  assert.equal(get(app, 'window.__done'), true);
  assert.equal(get(app, 'window.__closed'), 0, 'يبقى في مكانه');
  assert.match(get(app, 'window.__toasts.join("|")'), /ok:تم الحفظ/);
  assert.equal(log.filter(l => l.name === 'save_lesson_attendance').length, 0);
});

test('زر "حفظ" لا يمسّ الحضور حتى لو الحصة غير محفوظة، ولو نُقر مرتين لا يتكرر', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'homework' });
  runInAppContext(app, `crmSheet.hw = { queue: new Map([['a', new Promise(r => setTimeout(r, 20))]]) };`);
  await Promise.all([app.finishCrmLessonSheet(), app.finishCrmLessonSheet()]);
  assert.equal(log.filter(l => l.name === 'save_lesson_attendance').length, 0);
  assert.equal(get(app, 'window.__closed'), 0);
  assert.equal(get(app, 'window.__toasts.filter(t => t.startsWith("ok:تم الحفظ")).length'), 1);
});

test('زر "حفظ": فشل أثناء الانتظار = لا يُغلق ولا يحفظ الحضور ويُنبّه', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'participation' });
  runInAppContext(app, `crmSheet.part = { queue: new Map([['a', new Promise(r => setTimeout(() => { markCrmSheetFailure(); r(); }, 20))]]) };`);
  await app.finishCrmLessonSheet();
  assert.equal(get(app, 'window.__closed'), 0);
  assert.equal(log.filter(l => l.name === 'save_lesson_attendance').length, 0);
  assert.match(get(app, 'window.__toasts.join("|")'), /error:لم يكتمل الحفظ/);
});

test('نقرة مشاركة فشل حفظها تُعلّم الورقة "فشل" (حتى لا يقول زر حفظ: تم)', async () => {
  const app = appWith([], '', 'increment_grade_score');
  sheet(app, {});
  runInAppContext(app, `crmSheet.part = { column: { id: 'c', max_score: 10, name: 'مشاركة' }, scores: new Map(), today: {}, undo: [], queue: new Map(), toolId: null };
    paintCrmParticipation = () => {}; writeParticipationState = () => {};`);
  app.tapCrmParticipation('a');
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(get(app, 'crmSheet.failed'), true);
});

test('كل أوضاع الأدوات فيها زر "حفظ" في شريطها السفلي', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const count = f => (fs.readFileSync(path.join(__dirname, '..', 'app', f), 'utf8').match(/crmSheetFinishBtnHtml\(\)/g) || []).length;
  assert.equal(count('app-20-participation-homework.js'), 2); /* مشاركة + واجب */
  assert.equal(count('app-21-performance-tasks.js'), 1);
  assert.equal(count('app-23-custom-tools.js'), 1);
  assert.match(loadApp().crmSheetFinishBtnHtml(), /finishCrmLessonSheet\(\)/);
});

test('الحضور مستقل: لا شريط "حضور لم يُحفظ" ولا سؤال عند الرجوع في أوضاع الأدوات', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'app', f), 'utf8');
  for(const f of ['app-14-classroom-today.js', 'app-20-participation-homework.js', 'app-21-performance-tasks.js', 'app-23-custom-tools.js']){
    assert.doesNotMatch(src(f), /leaveCrmLessonSheet|crmSheetUnsavedBannerHtml|markCrmSheetActivity/, f);
  }
  const app = appWith(); sheet(app, { mode: 'participation' });
  assert.doesNotMatch(app.crmSheetModeSwitchHtml(), /لم يُحفظ/);
});
