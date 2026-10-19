/* ورقة الحصة: ما يُرصد في أوضاع الأدوات (مشاركة/واجب/مهام/أدوات) يُحفظ فورًا في الكشف،
   لكن الحصة تبقى "غير مرصودة" حتى يُحفظ حضورها. لا نحفظ الحضور بصمت: نسأل عند
   الرجوع ونعرض زر حفظ في أوضاع الأدوات. */
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
const sheet = (app, over) => runInAppContext(app, `crmSheet = Object.assign({ sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'participation', states: { a: 'present', b: 'absent' }, lessonId: null, activity: false }, ${JSON.stringify(over || {})});`);
const get = (app, expr) => runInAppContext(app, expr);

test('رجوع بلا رصد في الأدوات، أو لحصة محفوظة، أو والحضور مخفي: يُغلق مباشرة بلا سؤال', async () => {
  for(const over of [{ activity: false }, { activity: true, lessonId: 'L1' }]){
    const app = appWith(); sheet(app, over);
    app.leaveCrmLessonSheet();
    assert.equal(get(app, 'window.__closed'), 1);
    assert.equal(get(app, 'window.__modal.length'), 0);
  }
  const off = appWith([], 'appToolOn = k => k !== "attendance";'); sheet(off, { activity: true });
  off.leaveCrmLessonSheet();
  assert.equal(get(off, 'window.__closed'), 1);
});

test('رجوع بعد رصد في حصة لم يُحفظ حضورها: يسأل ولا يُغلق، ويذكر الحضور الحالي', async () => {
  const app = appWith(); sheet(app, { activity: true });
  app.leaveCrmLessonSheet();
  assert.equal(get(app, 'window.__closed'), 0);
  const html = get(app, 'window.__modal[0]');
  assert.match(html, /الحصة لم تُرصد بعد/);
  assert.match(html, /غائب 1 · متأخر 0 · مستأذن 0/);
  assert.match(html, /حفظ الحصة وإغلاق/);
  assert.match(html, /إغلاق الحصة بدون حفظ/);
  sheet(app, { activity: true, states: { a: 'present' } });
  app.leaveCrmLessonSheet();
  assert.match(get(app, 'window.__modal[1]'), /\(<b>الكل حاضر<\/b>\)/);
});

test('كل كتابة في الأدوات تُعلّم الورقة "رُصد فيها" (مشاركة، واجب، أداة خاصة)', async () => {
  const app = appWith();
  sheet(app, {});
  runInAppContext(app, `crmSheet.part = { column: { id: 'c', max_score: 10, name: 'مشاركة' }, scores: new Map(), today: {}, undo: [], queue: new Map(), toolId: null };
    queueCrmParticipation = () => {}; paintCrmParticipation = () => {};`);
  app.tapCrmParticipation('a');
  assert.equal(get(app, 'crmSheet.activity'), true);

  sheet(app, { mode: 'homework' });
  runInAppContext(app, `crmSheet.hw = { selectedId: 'h1', statuses: new Map(), queue: new Map(), data: { statusRows: [] } };
    persistCrmHomework = () => {}; paintCrmHomework = () => {}; paintCrmHomeworkCounts = () => {};`);
  app.tapCrmHomework('a');
  assert.equal(get(app, 'crmSheet.activity'), true);

  sheet(app, { mode: 'tool:T' });
  runInAppContext(app, `crmSheet.tool = { tool: { id: 'T', tool_type: 'status', max_score: 5 }, column: null, values: new Map(), queue: new Map(), term: { year: 'y', semester: 1 }, period: 2 };
    paintCrmTool = () => {}; paintCrmToolCounts = () => {}; syncToolColumn = async () => {};`);
  app.setCrmToolValue('a', 1);
  assert.equal(get(app, 'crmSheet.activity'), true);
});

test('شريط "حضور الحصة لم يُحفظ" يظهر في أوضاع الأدوات للحصة غير المحفوظة فقط', async () => {
  const app = appWith();
  sheet(app, { mode: 'participation' });
  assert.match(app.crmSheetModeSwitchHtml(), /لم يُحفظ بعد/);
  assert.match(app.crmSheetModeSwitchHtml(), /حفظ الحصة \(غائب 1 · متأخر 0 · مستأذن 0\)/);
  sheet(app, { mode: 'attendance' });
  assert.doesNotMatch(app.crmSheetModeSwitchHtml(), /لم يُحفظ بعد/);
  sheet(app, { mode: 'participation', lessonId: 'L1' });
  assert.doesNotMatch(app.crmSheetModeSwitchHtml(), /لم يُحفظ بعد/);
  const off = appWith([], 'appToolOn = k => k !== "attendance";'); sheet(off, { mode: 'participation' });
  assert.doesNotMatch(off.crmSheetModeSwitchHtml(), /لم يُحفظ بعد/);
});

test('saveCrmLessonSheet — يعمل من وضع أداة (بلا زر الحضور): يحفظ الاستثناءات ويُغلق الورقة', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'participation' });
  /* لا يوجد في وضع الأداة إلا زر الشريط: زر الحضور غير مرسوم */
  runInAppContext(app, `window.__bar = { disabled: false, textContent: 'حفظ الحصة' }; window.__seen = [];
    document.getElementById = id => (id === 'crmModeSaveBtn' ? Object.defineProperty(window.__bar, 'disabled', { set(v){ window.__seen.push(v); }, get(){ return false; }, configurable: true }) : null);`);
  await app.saveCrmLessonSheet();
  assert.deepEqual([...get(app, 'window.__seen')], [true]);
  const call = log.find(l => l.name === 'save_lesson_attendance');
  assert.ok(call);
  assert.equal(call.args.p_section_id, 'S');
  assert.equal(call.args.p_lesson_date, '2026-10-19');
  assert.equal(call.args.p_period, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(call.args.p_exceptions)), [{ student_id: 'b', status: 'absent' }]);
  assert.equal(get(app, 'window.__closed'), 1);
  assert.match(get(app, 'window.__toasts.join("|")'), /تم رصد الحصة/);
});

const later = (ms, fn) => new Promise(r => setTimeout(() => { if(fn) fn(); r(); }, ms));

test('زر "حفظ" في أوضاع الأدوات: ينتظر اكتمال الحفظ المعلّق قبل أن يُنهي، وحصة محفوظة لا تُعاد', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'participation', lessonId: 'L1', activity: true });
  runInAppContext(app, `window.__done = false; crmSheet.part = { queue: new Map([['a', new Promise(r => setTimeout(() => { window.__done = true; r(); }, 30))]]) };`);
  const p = app.finishCrmLessonSheet();
  assert.equal(get(app, 'window.__closed'), 0);
  await p;
  assert.equal(get(app, 'window.__done'), true);
  assert.equal(get(app, 'window.__closed'), 1);
  assert.match(get(app, 'window.__toasts.join("|")'), /ok:تم الحفظ/);
  assert.equal(log.filter(l => l.name === 'save_lesson_attendance').length, 0);
});

test('زر "حفظ" في حصة لم يُحفظ حضورها: يحفظ الحضور بعد المعلّق مرة واحدة ولو نُقر مرتين', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'homework', activity: true });
  runInAppContext(app, `crmSheet.hw = { queue: new Map([['a', new Promise(r => setTimeout(r, 20))]]) };`);
  const p1 = app.finishCrmLessonSheet();
  const p2 = app.finishCrmLessonSheet();
  await Promise.all([p1, p2]);
  assert.equal(log.filter(l => l.name === 'save_lesson_attendance').length, 1);
  assert.equal(get(app, 'window.__closed'), 1);
});

test('زر "حفظ": فشل أثناء الانتظار = لا يُغلق ولا يحفظ الحضور ويُنبّه', async () => {
  const log = [];
  const app = appWith(log);
  sheet(app, { mode: 'participation', activity: true });
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
