'use strict';
/* ============================================================
   ملخص زر "حفظ" في ورقة الحصة (بطلب صاحب التطبيق):
   الرصد يُحفظ بخانته/نقرته، فيقول الملخص بعد "حفظ": كم حُفظ، وما لم يُحفظ بالاسم
   والسبب (ومنه رقم خاطئ بقي ظاهرًا في الخانة)، ومن بقي بلا رصد والغائبون على حدة.
   يبقى حتى يضغط المعلم "تم". والحضور له ملخصه (الأعداد وأسماء غير الحاضرين).
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

/* failFor: معرّف طالب يفشل حفظه */
function client(failFor){
  return {
    from(){
      let sid = null;
      const a = { select: () => a, in: () => a, order: () => a, limit: () => a, delete: () => a,
        eq(c, v){ if(c === 'student_id') sid = v; return a; },
        upsert(r){ sid = Array.isArray(r) ? r[0].student_id : r.student_id; return a; },
        then: (res, rej) => Promise.resolve(failFor && sid === failFor ? { data: null, error: { message: 'انقطع الاتصال' } } : { data: [], error: null }).then(res, rej) };
      return a;
    },
    rpc: () => Promise.resolve({ data: 1, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) }
  };
}

function appWith(failFor){
  const app = loadApp({ supabaseClient: client(failFor), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__modal = []; showInfoModal = h => window.__modal.push(h); window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    afterCrmGradesChanged = () => {}; invalidateAttention = () => {}; refreshAttention = () => {};
    crmSections = [{ id: 'S', name: '٦' }]; crmSectionLabel = () => 'ثاني/٦';
    crmStudents = [{ id: 'a', full_name: 'أحمد', section_id: 'S' }, { id: 'b', full_name: 'بدر <i>x</i>', section_id: 'S' },
                   { id: 'c', full_name: 'جابر', section_id: 'S' }, { id: 'd', full_name: 'داود', section_id: 'S' }];
    window.__input = (id, v) => ({ dataset: { student: id }, value: v, isConnected: true, classList: { add(){}, remove(){}, contains: () => false } });`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);
const testSheet = app => runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-11-16', period: 1, token: 1, mode: 'test', states: { d: 'absent' },
  test: { tests: [{ id: 'T', name: 'الاختبار الأول', max_score: 20 }], selectedId: 'T', values: new Map(), queue: new Map() } };`);
const modal = app => get(app, 'window.__modal[window.__modal.length - 1] || ""');

test('اختبار: يذكر عدد ما حُفظ، والرقم الخاطئ الباقي في الخانة بالاسم، ومن بلا درجة والغائب على حدة', async () => {
  const app = appWith();
  testSheet(app);
  await app.saveCrmTestInput(get(app, `__input('a', '12')`));
  app.saveCrmTestInput(get(app, `__input('b', '25')`)); /* أكبر من 20: لا يُحفظ */
  await app.finishCrmLessonSheet();
  const h = modal(app);
  assert.match(h, /لم يُحفظ كل شيء/);
  assert.match(h, /تم حفظ درجة واحدة/);
  assert.match(h, /الاختبار الأول · ثاني\/٦/);
  assert.match(h, /مرصود: 1 من 4/);
  assert.match(h, /لم يُحفظ \(1\)[\s\S]*بدر &lt;i&gt;x&lt;\/i&gt; — كُتب «25»: أكبر من 20/, 'الاسم مُهرَّب والرقم الخاطئ ظاهر');
  assert.match(h, /بلا درجة \(2\):<\/b> بدر &lt;i&gt;x&lt;\/i&gt;، جابر/);
  assert.match(h, /غائبون: داود/);
  assert.doesNotMatch(h, /<i>x<\/i>/);
});

test('اختبار: تصحيح الرقم الخاطئ يزيله من "لم يُحفظ"، والكل سليم = ملخص أخضر', async () => {
  const app = appWith();
  testSheet(app);
  app.saveCrmTestInput(get(app, `__input('b', '25')`));
  await app.saveCrmTestInput(get(app, `__input('b', '15')`));
  for(const id of ['a', 'c', 'd']) await app.saveCrmTestInput(get(app, `__input('${id}', '10')`));
  await app.finishCrmLessonSheet();
  const h = modal(app);
  assert.doesNotMatch(h, /is-fail/);
  assert.match(h, /✓ تم حفظ 4 درجات/);
  assert.doesNotMatch(h, /بلا درجة/);
});

test('اختبار: فشل الاتصال لطالب يُذكر باسمه وسببه ولا يُعدّ محفوظًا', async () => {
  const app = appWith('c');
  testSheet(app);
  await app.saveCrmTestInput(get(app, `__input('a', '12')`));
  await app.saveCrmTestInput(get(app, `__input('c', '9')`));
  await app.finishCrmLessonSheet();
  const h = modal(app);
  assert.match(h, /تم حفظ درجة واحدة/);
  assert.match(h, /جابر — انقطع الاتصال/);
  assert.match(h, /بلا درجة \(2\)/, 'الفاشل رجع فارغًا فيُعدّ بلا درجة');
});

test('اختبار: خانة ما زال المؤشر فيها تُحفظ عند "حفظ" قبل الملخص', async () => {
  const app = appWith();
  testSheet(app);
  runInAppContext(app, `window.__focused = __input('a', '7'); window.__focused.classList.contains = c => c === 'crm-test-input';
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => window.__focused });`);
  await app.finishCrmLessonSheet();
  assert.equal(get(app, 'crmSheet.test.values.get("a")'), 7);
  assert.match(modal(app), /تم حفظ درجة واحدة/);
});

test('مشاركة: لا قائمة "لم يشارك" — العدد فقط', async () => {
  const app = appWith();
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-11-16', period: 1, token: 1, mode: 'participation', states: {},
    part: { column: { id: 'C', name: 'المشاركة', max_score: 10 }, scores: new Map(), today: {}, undo: [], queue: new Map(), toolId: null, step: 1 } };
    paintCrmParticipation = () => {}; writeParticipationState = () => {};`);
  app.tapCrmParticipation('a'); app.tapCrmParticipation('b');
  await app.finishCrmLessonSheet();
  const h = modal(app);
  assert.match(h, /تم حفظ النقرات/);
  assert.match(h, /رُصد في هذه الحصة: 2 من 4/);
  assert.doesNotMatch(h, /crm-save-box/, 'لا قائمة "لم يشارك"');
});

test('واجب: يذكر الأعداد وأسماء من لم يسلّم', async () => {
  const app = appWith();
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-11-16', period: 1, token: 1, mode: 'homework', states: { d: 'absent' },
    hw: { selectedId: 'H', data: { homeworks: [{ id: 'H', title: 'واجب ١' }], statusRows: [] }, column: null, queue: new Map(),
      statuses: new Map([['a', 'submitted'], ['b', 'partial']]) } };
    syncHomeworkColumn = async () => {};`);
  await app.persistCrmHomework('a', 'submitted');
  await app.finishCrmLessonSheet();
  const h = modal(app);
  assert.match(h, /تم حفظ حالة واحدة/);
  assert.match(h, /سلّم 1 · ناقص 1 · متأخر 0 · لم يسلّم 2/);
  assert.match(h, /لم يسلّم \(1\):<\/b> جابر/);
  assert.match(h, /غائبون: داود/);
});

test('الأسماء الكثيرة تُختصر: أول 15 ثم "و N غيرهم"', () => {
  const app = appWith();
  const names = Array.from({ length: 20 }, (_, i) => 'ط' + i);
  assert.match(app.crmSummaryNames(names), /ط14 و5 غيرهم$/);
  assert.doesNotMatch(app.crmSummaryNames(names), /ط15/);
});

test('ماذا تغيّر؟ (اختبار): مطويّ، كانت ← صارت بالفرق، المعدّل والممسوح قبل الجديد، والعائد لقيمته لا يظهر', async () => {
  const app = appWith();
  testSheet(app);
  runInAppContext(app, `crmSheet.test.values = new Map([['a', 15], ['b', 6], ['c', 11]]);`);
  await app.saveCrmTestInput(get(app, `__input('d', '20')`));   /* جديدة */
  await app.saveCrmTestInput(get(app, `__input('a', '17')`));   /* +2 */
  await app.saveCrmTestInput(get(app, `__input('b', '4')`));    /* −2 */
  await app.saveCrmTestInput(get(app, `__input('c', '')`));     /* مُسحت */
  await app.saveCrmTestInput(get(app, `__input('a', '16')`));   /* ما زالت من 15 */
  const h = modal(app) || (await app.finishCrmLessonSheet(), modal(app));
  assert.match(h, /<details class="crm-ch"><summary><span>ماذا تغيّر؟ \(4\)<\/span><span class="crm-ch-brief">1 جديدة · 2 معدّلة · 1 مُسحت<\/span>/);
  assert.doesNotMatch(h, /<details[^>]*open/, 'مطويّ افتراضيًا');
  assert.match(h, /أحمد<\/span><span class="crm-ch-v"><span class="crm-ch-old">15<\/span>←<b>16<\/b><span class="crm-ch-tag is-up" dir="ltr">\+1</);
  assert.match(h, /بدر &lt;i&gt;x&lt;\/i&gt;<\/span>[\s\S]*?6<\/span>←<b>4<\/b><span class="crm-ch-tag is-down" dir="ltr">−2</);
  assert.match(h, /جابر[\s\S]*?11<\/span>←<b>—<\/b><span class="crm-ch-tag is-del">مُسحت/);
  assert.ok(h.indexOf('جابر') < h.indexOf('داود'), 'الممسوح قبل الجديد');
  assert.match(h, /داود<\/span><span class="crm-ch-v"><b>20<\/b><span class="crm-ch-tag is-new">جديدة/);
  runInAppContext(app, 'window.__modal = []');
  await app.saveCrmTestInput(get(app, `__input('a', '15')`));   /* رجعت كما كانت */
  await app.finishCrmLessonSheet();
  assert.match(modal(app), /ماذا تغيّر؟ \(3\)/);
});

test('ماذا تغيّر؟: الفاشل لا يُعدّ تغيّرًا', async () => {
  const app = appWith('c');
  testSheet(app);
  await app.saveCrmTestInput(get(app, `__input('c', '9')`));
  await app.finishCrmLessonSheet();
  assert.doesNotMatch(modal(app), /ماذا تغيّر/);
});

test('ماذا تغيّر؟ (واجب): الحالة كانت ← صارت', async () => {
  const app = appWith();
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-11-16', period: 1, token: 1, mode: 'homework', states: {},
    hw: { selectedId: 'H', data: { homeworks: [{ id: 'H', title: 'واجب ١' }], statusRows: [] }, column: null, queue: new Map(), statuses: new Map() } };
    syncHomeworkColumn = async () => {}; paintCrmHomework = () => {}; paintCrmHomeworkCounts = () => {}; gradeStartsFull = () => false;`);
  app.tapCrmHomework('a');
  await get(app, 'crmSheet.hw.queue.get("a")');
  await app.finishCrmLessonSheet();
  assert.match(modal(app), /أحمد<\/span><span class="crm-ch-v"><span class="crm-ch-old">لم يسلّم<\/span>←<b>سلّم<\/b>/);
});

test('ماذا تغيّر؟ (مشاركة): +عدد اليوم والدرجة الآن', async () => {
  const app = appWith();
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-11-16', period: 1, token: 1, mode: 'participation', states: {},
    part: { column: { id: 'C', name: 'المشاركة', max_score: 10 }, scores: new Map(), today: {}, undo: [], queue: new Map(), toolId: null, step: 1 } };
    paintCrmParticipation = () => {}; writeParticipationState = () => {};`);
  app.tapCrmParticipation('a'); app.tapCrmParticipation('a');
  await app.finishCrmLessonSheet();
  assert.match(modal(app), /أحمد<\/span><span class="crm-ch-v"><span class="crm-ch-tag is-up" dir="ltr">\+2<\/span><span class="crm-ch-old">الآن \d+ \/ 10/);
});
