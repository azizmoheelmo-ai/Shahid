'use strict';
/* ============================================================
   أوضاع ورقة الحصة: المشاركة والواجب (app-20-participation-homework.js)
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - المشاركة: نقرة = +1 مباشرة على عمود "مشاركة" في الكشف (حتى حده).
   - الواجب: الأصل "لم يسلّم"، والنقر يبدّل: سلّم ← ناقص ← متأخر ← لم يسلّم.
     سلّم = كاملة، متأخر = 75%، ناقص = 50%، لم يسلّم = 0.
   - عمود "واجبات" يُحسب تلقائيًا: متوسط الواجبات المحسوبة × حد العمود.
   - الواجب يُحسب بعد انقضاء موعده، أو متى بدأ المعلم رصده — وإلا صار
     الجميع "صفرًا" صباح يوم التسليم فتظهر تنبيهات "تحت النصف" كاذبة.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('nextHomeworkState — الأصل لم يسلّم', async () => {
  const app = loadApp();
  assert.equal(app.nextHomeworkState('missing'), 'submitted');
  assert.equal(app.nextHomeworkState('submitted'), 'partial');
  assert.equal(app.nextHomeworkState('partial'), 'late');
  assert.equal(app.nextHomeworkState('late'), 'missing');
  assert.equal(app.nextHomeworkState(undefined), 'submitted');
});

test('countedHomework — بعد الموعد أو متى بدأ الرصد', async () => {
  const app = loadApp();
  const hws = [
    { id: 'past', due_date: '2026-10-05' },
    { id: 'today', due_date: '2026-10-07' },
    { id: 'todayStarted', due_date: '2026-10-07' },
    { id: 'future', due_date: '2026-10-12' },
  ];
  const rows = [{ homework_id: 'todayStarted', student_id: 'a', status: 'submitted' }];
  assert.deepEqual([...app.countedHomework(hws, rows, '2026-10-07')].map(h => h.id), ['past', 'todayStarted']);
});

test('homeworkScoreFor — متوسط الواجبات × حد العمود', async (t) => {
  const app = loadApp();
  const counted = [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }];
  const idx = app.homeworkStatusIndex([
    { homework_id: 'h1', student_id: 'a', status: 'submitted' },
    { homework_id: 'h2', student_id: 'a', status: 'submitted' },
    { homework_id: 'h3', student_id: 'a', status: 'late' },
    { homework_id: 'h4', student_id: 'a', status: 'partial' },
  ]);
  await t.test('سلّم 2 + متأخر + ناقص من 4 = (1+1+0.75+0.5)/4 × 10 = 8.13', () => {
    assert.equal(app.homeworkScoreFor(counted, idx, 'a', 10), 8.13);
  });
  await t.test('لم يسلّم شيئًا = صفر حقيقي (الواجبات استُحقت)', () => {
    assert.equal(app.homeworkScoreFor(counted, idx, 'b', 10), 0);
  });
  await t.test('لا واجبات محسوبة بعد = لا درجة (لا صفر)', () => {
    assert.equal(app.homeworkScoreFor([], idx, 'a', 10), null);
  });
});

test('planHomeworkScoreSync — ما يُكتب وما يُحذف في عمود الواجبات', async () => {
  const app = loadApp();
  const counted = [{ id: 'h1' }];
  const idx = app.homeworkStatusIndex([{ homework_id: 'h1', student_id: 'a', status: 'submitted' }]);
  const existing = new Map([['a', 10], ['b', 7], ['gone', 3]]);
  const plan = app.planHomeworkScoreSync(['a', 'b', 'c'], counted, idx, 10, existing);
  // a بلا تغيير، b من 7 إلى 0، c جديد 0؛ "gone" (ليس في الشعبة الآن) لا يُمس
  assert.deepEqual([...plan.upserts].map(u => u.student_id + ':' + u.score), ['b:0', 'c:0']);
  assert.equal(plan.deletes.length, 0);
  const none = app.planHomeworkScoreSync(['a', 'b'], [], idx, 10, existing);
  assert.deepEqual([...none.deletes].sort(), ['a', 'b'], 'لا واجبات محسوبة = تُمسح الدرجات المحسوبة سابقًا');
});

test('defaultHomeworkId — واجب اليوم، وإلا آخر مستحق، وإلا أقرب قادم', async () => {
  const app = loadApp();
  const hws = [{ id: 'old', due_date: '2026-10-01' }, { id: 'recent', due_date: '2026-10-05' }, { id: 'next', due_date: '2026-10-12' }];
  assert.equal(app.defaultHomeworkId(hws.concat([{ id: 'now', due_date: '2026-10-07' }]), '2026-10-07'), 'now');
  assert.equal(app.defaultHomeworkId(hws, '2026-10-07'), 'recent');
  assert.equal(app.defaultHomeworkId([{ id: 'next', due_date: '2026-10-12' }], '2026-10-07'), 'next');
  assert.equal(app.defaultHomeworkId([], '2026-10-07'), null);
});

test('homeworkCounts', async () => {
  const app = loadApp();
  const m = new Map([['a', 'submitted'], ['b', 'partial'], ['c', 'late']]);
  assert.deepEqual({ ...app.homeworkCounts(m, ['a', 'b', 'c', 'd', 'e']) }, { submitted: 1, partial: 1, late: 1, missing: 2 });
});

test('gradeSheetSeed — الأعمدة الافتراضية بنوعها', async () => {
  const app = loadApp();
  const seed = app.gradeSheetSeed([]);
  assert.deepEqual([...seed].map(c => c.name + ':' + c.kind), ['مشاركة:participation', 'واجبات:homework', 'مهام أدائية:manual', 'الفترة الأولى:manual', 'الفترة الثانية:manual']);
  const copied = app.gradeSheetSeed([{ category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation', position: 0 }]);
  assert.equal(copied[0].kind, 'participation', 'النوع يُنسخ من الفصل السابق');
});

const { runInAppContext } = require('./load-app');

function fakeClient(seed, log){
  return {
    from(table){
      const filters = [];
      const rows = () => (seed[table] || []).filter(r => filters.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, gte(){ return api; },
        eq(c, v){ filters.push([c, v]); return api; }, in(c, v){ filters.push([c, v]); return api; },
        upsert(r, o){ log.push({ table, op: 'upsert', rows: Array.isArray(r) ? r : [r], opts: o }); return Promise.resolve({ data: null, error: null }); },
        insert(r){ log.push({ table, op: 'insert', rows: r }); return Promise.resolve({ data: null, error: null }); },
        delete(){ const f = []; const ch = { eq(c, v){ f.push([c, v]); return ch; }, in(c, v){ f.push([c, v]); return ch; }, then(res){ log.push({ table, op: 'delete', filters: f }); res({ data: null, error: null }); } }; return ch; },
        then(res){ res({ data: rows(), error: null }); },
      };
      return api;
    },
    rpc(name, args){
      const entry = { op: 'rpc', name, args, done: false };
      log.push(entry);
      return new Promise(res => setTimeout(() => { entry.done = true; res({ data: args.__ret != null ? args.__ret : 1, error: null }); }, 15));
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

test('المشاركة — نقرتان سريعتان تُرسلان بالتتابع ولا تضيع إحداهما', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: fakeClient({}, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmSheet = { sectionId: 'S', dateIso: '2026-10-07', period: 1, states: {}, token: 1, mode: 'participation',
      part: { column: { id: 'C', max_score: 10 }, scores: new Map([['a', 5]]), today: {}, undo: [], queue: new Map() } };
  `);
  app.tapCrmParticipation('a');
  app.tapCrmParticipation('a');
  assert.equal(runInAppContext(app, 'crmSheet.part.scores.get("a")'), 7, 'العرض الفوري');
  await runInAppContext(app, 'crmSheet.part.queue.get("a")');
  const rpcs = log.filter(l => l.op === 'rpc');
  assert.equal(rpcs.length, 2);
  assert.ok(rpcs.every(r => r.name === 'increment_grade_score' && r.args.p_column_id === 'C' && r.args.p_delta === 1));
});

test('المشاركة — عند اكتمال الحد لا تُرسل نقرة', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: fakeClient({}, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmSheet = { sectionId: 'S', dateIso: '2026-10-07', period: 1, states: {}, token: 1, mode: 'participation',
      part: { column: { id: 'C', max_score: 10 }, scores: new Map([['a', 10]]), today: {}, undo: [], queue: new Map() } };
  `);
  app.tapCrmParticipation('a');
  assert.equal(log.filter(l => l.op === 'rpc').length, 0);
});

test('الواجب — النقرة تحفظ الحالة وتعيد حساب درجته، باسم المعلم الحالي', async () => {
  const log = [];
  const app = loadApp({ supabaseClient: fakeClient({ classroom_grade_scores: [] }, log), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    crmSheet = { sectionId: 'S', dateIso: '2026-10-07', period: 1, states: {}, token: 1, mode: 'homework',
      hw: { data: { homeworks: [{ id: 'H', due_date: '2026-10-07' }], statusRows: [] }, column: { id: 'HC', max_score: 10 },
        selectedId: 'H', statuses: new Map(), queue: new Map() } };
  `);
  app.tapCrmHomework('a');
  await runInAppContext(app, 'crmSheet.hw.queue.get("a")');
  const st = log.find(l => l.table === 'classroom_homework_status' && l.op === 'upsert');
  assert.deepEqual({ teacher_id: st.rows[0].teacher_id, status: st.rows[0].status, homework_id: st.rows[0].homework_id }, { teacher_id: 'u1', status: 'submitted', homework_id: 'H' });
  const sc = log.find(l => l.table === 'classroom_grade_scores' && l.op === 'upsert');
  assert.deepEqual({ ...sc.rows[0] }, { teacher_id: 'u1', column_id: 'HC', student_id: 'a', score: 10 }, 'سلّم الواجب الوحيد المستحق = 10/10');
});

test('loadSectionHomework — واجبات وتسليم المعلم الحالي فقط', async () => {
  const seed = {
    classroom_homework: [
      { id: 'h1', teacher_id: 'u1', section_id: 'S', academic_year: '1448-1449', semester: 1, title: 'أ', due_date: '2026-10-01' },
      { id: 'h2', teacher_id: 'u2', section_id: 'S', academic_year: '1448-1449', semester: 1, title: 'ب', due_date: '2026-10-01' },
    ],
    classroom_homework_status: [
      { teacher_id: 'u1', homework_id: 'h1', student_id: 'a', status: 'submitted' },
      { teacher_id: 'u2', homework_id: 'h1', student_id: 'x', status: 'late' },
    ],
  };
  const app = loadApp({ supabaseClient: fakeClient(seed, []), currentUser: { id: 'u1' } });
  const hw = await app.loadSectionHomework('S', { year: '1448-1449', semester: 1 });
  assert.deepEqual([...hw.homeworks].map(h => h.id), ['h1']);
  assert.deepEqual([...hw.statusRows].map(r => r.student_id), ['a']);
});

test('deleteCrmStudent — التراجع يعيد تسليم واجباته أيضًا', async () => {
  const log = [];
  const seed = { classroom_homework_status: [{ id: 'hs1', teacher_id: 'u1', homework_id: 'H', student_id: 'a', status: 'submitted' }] };
  const client = fakeClient(seed, log);
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    showConfirm = async () => true;
    showUndoToast = async () => false;
    loadCrmStudents = async () => {}; renderCrmStudentsList = () => {};
    refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};
  `);
  await app.deleteCrmStudent('a');
  const restored = log.find(l => l.op === 'insert' && l.table === 'classroom_homework_status');
  assert.ok(restored, 'تسليم الواجبات يُعاد مع التراجع');
  assert.equal(restored.rows[0].id, 'hs1');
});
