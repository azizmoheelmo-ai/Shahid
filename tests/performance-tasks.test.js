'use strict';
/* ============================================================
   المهام الأدائية (app-21-performance-tasks.js)
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - المعلم يحدد بالاسم من يُكلَّف بالمهمة — لا أحد مختار تلقائيًا.
   - المهمة لا تُحسب للطالب حتى تُرصد درجته (لا صفر صامت).
   - عمود "مهام أدائية" بالوزن: مجموع ما حصّله ÷ مجموع درجات مهامه المقيَّمة.
   - من لم يُكلَّف بمهمة لا تُحسب عليه.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };

/* عميل وهمي: يطبّق فلاتر eq/in على بيانات seed، ويسجّل كل كتابة */
function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = [];
      let op = 'select', values = null, single = false, maybe = false;
      const result = () => {
        if(opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom' } };
        if(op === 'insert'){
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          const out = rows.map((r, i) => Object.assign({ id: 'NEW' + i }, r));
          return { data: single ? out[0] : out, error: null };
        }
        if(op === 'upsert'){ log.push({ table, op, rows: Array.isArray(values) ? values : [values] }); return { data: null, error: null }; }
        const rows = match(seed[table], f);
        if(op === 'update' || op === 'delete'){ log.push({ table, op, filters: f.slice(), values }); return { data: rows, error: null }; }
        log.push({ table, op: 'select', filters: f.slice() });
        if(single || maybe) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; },
        insert(r){ op = 'insert'; values = r; return api; },
        upsert(r){ op = 'upsert'; values = r; return api; },
        update(r){ op = 'update'; values = r; return api; },
        delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); },
        maybeSingle(){ maybe = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); },
      };
      return api;
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

function taskApp(seed, log, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed, log, opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; window.__renders = [];
    showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showConfirm = async () => true;
    showInfoModal = () => {};
    crmCurrentTerm = () => (${JSON.stringify(TERM)});
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }, { id: 'b', full_name: 'ب', section_id: 'S' }, { id: 'c', full_name: 'ج', section_id: 'S' }];
    renderCrmTasks = (st, sel) => window.__renders.push('sheet:' + sel);
    renderCrmGrades = async () => window.__renders.push('grades');
  `);
  return app;
}
const writes = (log, table, op) => log.filter(l => l.table === table && l.op === op);
const filtersOf = e => Object.fromEntries(e.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v] : v]));

/* ============ الدوال الصرفة ============ */
test('taskColumnScoreFor — بالوزن، على المقيَّم فقط', async (t) => {
  const app = loadApp();
  const tasks = [{ id: 'big', max_score: 10 }, { id: 'small', max_score: 5 }, { id: 'pending', max_score: 10 }];
  const rows = [
    { task_id: 'big', student_id: 'a', score: 8 },
    { task_id: 'small', student_id: 'a', score: 5 },
    { task_id: 'pending', student_id: 'a', score: null },
    { task_id: 'big', student_id: 'b', score: 0 },
  ];
  await t.test('(8+5)/(10+5) × 20 = 17.33 — والمهمة غير المقيَّمة لا تُحسب صفرًا', () => {
    assert.equal(app.taskColumnScoreFor(tasks, rows, 'a', 20), 17.33);
  });
  await t.test('صفر مرصود صراحة = صفر حقيقي', () => {
    assert.equal(app.taskColumnScoreFor(tasks, rows, 'b', 20), 0);
  });
  await t.test('من لم يُكلَّف أو لم يُقيَّم بعد = لا درجة (لا صفر)', () => {
    assert.equal(app.taskColumnScoreFor(tasks, rows, 'c', 20), null);
    assert.equal(app.taskColumnScoreFor(tasks, [{ task_id: 'pending', student_id: 'c', score: null }], 'c', 20), null);
  });
  await t.test('مهمة خارج الفصل (غير موجودة بالقائمة) لا تُحسب', () => {
    assert.equal(app.taskColumnScoreFor(tasks, [{ task_id: 'other', student_id: 'c', score: 3 }], 'c', 20), null);
  });
});

test('planTaskAssigneeChange — الإزالة تخص طلاب الشعبة الحالية فقط', async () => {
  const app = loadApp();
  const cur = [{ student_id: 'a', score: 7 }, { student_id: 'b', score: null }, { student_id: 'moved', score: 9 }];
  const plan = app.planTaskAssigneeChange(cur, ['b', 'c'], ['a', 'b', 'c']);
  assert.deepEqual([...plan.add], ['c']);
  assert.deepEqual([...plan.remove], ['a'], 'الطالب المنقول لشعبة أخرى لا يُزال');
  assert.deepEqual([...plan.removeScored], ['a']);
});

test('parseTaskScore و taskQuickScores', async () => {
  const app = loadApp();
  assert.equal(app.parseTaskScore('٧٫٥', 10).value, 7.5);
  assert.match(app.parseTaskScore('11', 10).error, /أكبر/);
  assert.ok(app.parseTaskScore('-1', 10).error);
  assert.ok(app.parseTaskScore('', 10).error);
  assert.deepEqual([...app.taskQuickScores(5)].map(q => q.value), [5, 3.75, 2.5, 1.25, 0]);
});

/* ============ المزامنة ============ */
test('syncTaskColumn — باسم المعلم، وتُحسب مهام الطالب في شعبته السابقة بنفس الفصل', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [
      { id: 'T1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, max_score: 10 },
      { id: 'OLD', teacher_id: 'u1', section_id: 'S0', academic_year: TERM.year, semester: 1, max_score: 10 },
      { id: 'LAST', teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 2, max_score: 10 },
      { id: 'X', teacher_id: 'u2', section_id: 'S', academic_year: TERM.year, semester: 1, max_score: 10 },
    ],
    classroom_task_students: [
      { teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 10 },
      { teacher_id: 'u1', task_id: 'OLD', student_id: 'a', score: 5 },
      { teacher_id: 'u1', task_id: 'LAST', student_id: 'a', score: 0 },
      { teacher_id: 'u2', task_id: 'X', student_id: 'a', score: 0 },
      { teacher_id: 'u1', task_id: 'T1', student_id: 'b', score: null },
    ],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'TC', student_id: 'b', score: 4 }],
  };
  const app = taskApp(seed, log);
  await app.syncTaskColumn({ id: 'TC', max_score: 20 }, 'S', TERM, ['a', 'b']);
  const up = writes(log, 'classroom_grade_scores', 'upsert')[0];
  assert.deepEqual([...up.rows].map(r => ({ ...r })), [{ teacher_id: 'u1', column_id: 'TC', student_id: 'a', score: 15 }], '(10+5)/20 × 20 — لا مهمة فصل سابق ولا مهمة معلم آخر');
  const del = writes(log, 'classroom_grade_scores', 'delete')[0];
  assert.deepEqual(filtersOf(del), { teacher_id: 'u1', column_id: 'TC', student_id: ['b'] }, 'لم يُقيَّم بعد = تُمسح الدرجة المحسوبة سابقًا');
  assert.ok(log.filter(l => l.op === 'select').every(l => filtersOf(l).teacher_id === 'u1'), 'كل قراءة مقيّدة بالمعلم الحالي');
});

/* ============ الرصد من ورقة الحصة ============ */
function sheetWithTask(app, scores, groups){
  runInAppContext(app, `
    crmSheet = { sectionId: 'S', dateIso: '2026-10-08', mode: 'task', token: 1,
      task: { data: { tasks: [{ id: 'T1', title: 'تقرير', max_score: 10 }], rows: ${JSON.stringify(scores.map(([id, v]) => ({ task_id: 'T1', student_id: id, score: v })))} },
        column: { id: 'TC', max_score: 20 }, selectedId: 'T1', scores: new Map(${JSON.stringify(scores)}), groups: new Map(${JSON.stringify(groups || [])}),
        queue: new Map(), term: ${JSON.stringify(TERM)}, pick: null } };
  `);
}

test('applyCrmTaskScore — يحفظ الدرجة باسم المعلم ثم يعيد حساب عمود الطالب', async () => {
  const log = [];
  const seed = { classroom_task_students: [{ id: 'r1', teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: null }], classroom_tasks: [], classroom_grade_scores: [] };
  const app = taskApp(seed, log);
  sheetWithTask(app, [['a', null]]);
  app.openCrmTaskScorePicker('a');
  app.applyCrmTaskScore(7.5);
  assert.equal(runInAppContext(app, 'crmSheet.task.scores.get("a")'), 7.5, 'العرض الفوري');
  await runInAppContext(app, 'crmSheet.task.queue.get("a")');
  const upd = writes(log, 'classroom_task_students', 'update')[0];
  assert.deepEqual(filtersOf(upd), { teacher_id: 'u1', task_id: 'T1', student_id: 'a' });
  assert.deepEqual({ ...upd.values }, { score: 7.5 });
  assert.ok(log.some(l => l.table === 'classroom_grade_scores'), 'أُعيد حساب العمود');
});

test('انحدار: نافذة رصد فُتحت لمهمة ثم تغيّرت المهمة المختارة — لا تُكتب الدرجة على الأخرى', async () => {
  const log = [];
  const app = taskApp({ classroom_task_students: [] }, log);
  sheetWithTask(app, [['a', null]]);
  app.openCrmTaskScorePicker('a');
  runInAppContext(app, `crmSheet.task.selectedId = 'T2'; crmSheet.task.data.tasks.push({ id: 'T2', title: 'أخرى', max_score: 10 });`);
  app.applyCrmTaskScore(10);
  await Promise.all([...runInAppContext(app, 'crmSheet.task.queue.values()')]);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(writes(log, 'classroom_task_students', 'update').length, 0);
});

test('درجة فشل حفظها تعود في العرض لما كانت', async () => {
  const log = [];
  const app = taskApp({ classroom_task_students: [] }, log);
  sheetWithTask(app, [['a', 4]]);
  app.openCrmTaskScorePicker('a');
  app.applyCrmTaskScore(9);
  await runInAppContext(app, 'crmSheet.task.queue.get("a")');
  assert.equal(runInAppContext(app, 'crmSheet.task.scores.get("a")'), 4, 'لم يعد مكلّفًا (0 صفوف) = تُعاد الدرجة السابقة');
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /error:لم تُحفظ الدرجة/);
});

/* ============ إضافة/تعديل/حذف مهمة ============ */
function fillTaskForm(app, title, max){
  runInAppContext(app, `
    document.getElementById('crmTaskTitle').value = ${JSON.stringify(title)};
    document.getElementById('crmTaskDesc').value = '';
    document.getElementById('crmTaskMax').value = ${JSON.stringify(max)};
    document.getElementById('crmTaskDue').value = '';
  `);
}

test('مهمة جديدة — لا أحد مختار تلقائيًا، فلا تُحفظ بلا اختيار', async () => {
  const log = [];
  const app = taskApp({}, log);
  runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 };`);
  app.openCrmTaskModal();
  assert.equal(runInAppContext(app, 'crmTaskDraft.selected.size'), 0);
  fillTaskForm(app, 'تقرير', '10');
  await app.saveCrmTask();
  assert.equal(writes(log, 'classroom_tasks', 'insert').length, 0);
  assert.match(String(runInAppContext(app, `document.getElementById('crmTaskError').textContent`)), /اختر طالبًا/);
});

test('مهمة جديدة — تُحفظ للمختارين باسم المعلم، ونقرة مزدوجة = مهمة واحدة', async () => {
  const log = [];
  const app = taskApp({}, log);
  runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 };`);
  app.openCrmTaskModal();
  app.toggleCrmTaskPick('a');
  app.toggleCrmTaskPick('c');
  fillTaskForm(app, ' تقرير الطاقة ', '١٠');
  await Promise.all([app.saveCrmTask(), app.saveCrmTask()]);
  const ins = writes(log, 'classroom_tasks', 'insert');
  assert.equal(ins.length, 1);
  assert.deepEqual({ ...ins[0].rows[0] }, { teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'تقرير الطاقة', description: null, max_score: 10, due_date: null });
  const rows = writes(log, 'classroom_task_students', 'insert')[0].rows;
  assert.deepEqual([...rows].map(r => r.teacher_id + ':' + r.task_id + ':' + r.student_id), ['u1:NEW0:a', 'u1:NEW0:c']);
  assert.deepEqual([...runInAppContext(app, 'window.__renders')], ['sheet:NEW0']);
});

test('تعديل المهمة — إزالة طالب له درجة تحتاج تأكيدًا بنقرة ثانية', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'تقرير', description: null, max_score: 10, due_date: null }],
    classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 8 }, { teacher_id: 'u1', task_id: 'T1', student_id: 'b', score: null }],
  };
  const app = taskApp(seed, log);
  await app.openCrmTaskEditor('T1');
  assert.deepEqual([...runInAppContext(app, '[...crmTaskDraft.selected]')].sort(), ['a', 'b']);
  app.toggleCrmTaskPick('a');
  fillTaskForm(app, 'تقرير', '10');
  await app.saveCrmTask();
  assert.equal(writes(log, 'classroom_task_students', 'delete').length, 0, 'النقرة الأولى تنبّه فقط');
  assert.match(String(runInAppContext(app, `document.getElementById('crmTaskError').textContent`)), /ستُحذف درجاتهم|ستُحذف درجته|ستُحذف/);
  await app.saveCrmTask();
  const del = writes(log, 'classroom_task_students', 'delete')[0];
  assert.deepEqual(filtersOf(del), { teacher_id: 'u1', task_id: 'T1', student_id: ['a'] });
  const upd = writes(log, 'classroom_tasks', 'update')[0];
  assert.deepEqual(filtersOf(upd), { teacher_id: 'u1', id: 'T1' });
});

test('openCrmTaskEditor — مهمة معلم آخر لا تُفتح', async () => {
  const log = [];
  const app = taskApp({ classroom_tasks: [{ id: 'X', teacher_id: 'u2', section_id: 'S', title: 'x', max_score: 5 }], classroom_task_students: [] }, log);
  await app.openCrmTaskEditor('X');
  assert.equal(runInAppContext(app, 'crmTaskDraft'), null);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /غير موجودة/);
});

test('deleteCrmTask — يعمل من ورقة الحصة بلا كشف محمَّل، باسم المعلم، ونقرة مزدوجة = حذف واحد', async () => {
  const log = [];
  const app = taskApp({ classroom_tasks: [{ id: 'T1', teacher_id: 'u1' }] }, log);
  runInAppContext(app, `crmGrades = null; crmSheet = { sectionId: 'S', mode: 'task', token: 1, task: { queue: new Map() } };`);
  await Promise.all([app.deleteCrmTask('T1', 'S'), app.deleteCrmTask('T1', 'S')]);
  const dels = writes(log, 'classroom_tasks', 'delete');
  assert.equal(dels.length, 1);
  assert.deepEqual(filtersOf(dels[0]), { teacher_id: 'u1', id: 'T1' });
  assert.deepEqual([...runInAppContext(app, 'window.__renders')], ['sheet:null']);
});

test('loadSectionTasks — مهام ودرجات المعلم الحالي فقط', async () => {
  const seed = {
    classroom_tasks: [
      { id: 'T1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1 },
      { id: 'T2', teacher_id: 'u2', section_id: 'S', academic_year: TERM.year, semester: 1 },
    ],
    classroom_task_students: [
      { teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 3 },
      { teacher_id: 'u2', task_id: 'T1', student_id: 'z', score: 1 },
    ],
  };
  const app = taskApp(seed, []);
  const r = await app.loadSectionTasks('S', TERM);
  assert.deepEqual([...r.tasks].map(t => t.id), ['T1']);
  assert.deepEqual([...r.rows].map(x => x.student_id), ['a']);
});

test('deleteCrmStudent — التراجع يعيد درجات مهامه أيضًا', async () => {
  const log = [];
  const seed = { classroom_task_students: [{ id: 'ts1', teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 6 }] };
  const app = taskApp(seed, log);
  runInAppContext(app, `
    showUndoToast = async () => false;
    loadCrmStudents = async () => {}; renderCrmStudentsList = () => {};
    refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};
  `);
  await app.deleteCrmStudent('a');
  const restored = writes(log, 'classroom_task_students', 'insert')[0];
  assert.ok(restored, 'درجات المهام تُعاد مع التراجع');
  assert.equal(restored.rows[0].id, 'ts1');
});

/* ============ المهام الجماعية ============ */
test('distributeTaskGroups — توزيع متوازن بالترتيب، وعشوائي عند الطلب', async () => {
  const app = loadApp();
  const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
  const m = app.distributeTaskGroups(ids, 4);
  assert.deepEqual(ids.map(id => m.get(id)), [1, 1, 1, 2, 2, 3, 3, 3, 4, 4], 'متتالية ومتوازنة (3،2،3،2)');
  const r = app.distributeTaskGroups(ids, 4, () => 0);
  const sizes = [1, 2, 3, 4].map(g => ids.filter(id => r.get(id) === g).length);
  assert.deepEqual(sizes, [3, 2, 3, 2], 'العشوائي متوازن أيضًا');
  assert.notDeepEqual(ids.map(id => r.get(id)), ids.map(id => m.get(id)));
  assert.equal(app.distributeTaskGroups(['a', 'b'], 5).get('b'), 2, 'لا مجموعات أكثر من الطلاب');
});

test('normalizeTaskGroups — تُسقط المجموعات الفارغة وغير المختارين وتعيد الترقيم', async () => {
  const app = loadApp();
  const m = app.normalizeTaskGroups(new Map([['a', 3], ['b', 3], ['c', 5], ['d', 1]]), ['a', 'b', 'c']);
  assert.deepEqual([...m.entries()], [['a', 1], ['b', 1], ['c', 2]]);
});

test('planTaskRegroup — المتغيّر فقط، والتحويل لفردية يمسح المجموعة', async () => {
  const app = loadApp();
  const cur = [{ student_id: 'a', group_no: 1 }, { student_id: 'b', group_no: 1 }, { student_id: 'moved', group_no: 2 }];
  assert.deepEqual([...app.planTaskRegroup(cur, ['a', 'b'], new Map([['a', 1], ['b', 2]]))].map(r => ({ ...r })), [{ student_id: 'b', group_no: 2 }]);
  assert.deepEqual([...app.planTaskRegroup(cur, ['a', 'b'], null)].map(r => r.student_id + ':' + r.group_no), ['a:null', 'b:null'], 'الطالب المنقول لا يُمس');
});

test('taskGroupScoreState — موحّدة / مختلفة / لم تُقيَّم', async () => {
  const app = loadApp();
  const sc = new Map([['a', 8], ['b', 8], ['c', 5], ['d', null]]);
  assert.deepEqual({ ...app.taskGroupScoreState(['a', 'b'], sc) }, { value: 8, mixed: false, graded: 2 });
  assert.deepEqual({ ...app.taskGroupScoreState(['a', 'c'], sc) }, { value: null, mixed: true, graded: 2 });
  assert.deepEqual({ ...app.taskGroupScoreState(['a', 'd'], sc) }, { value: null, mixed: true, graded: 1 }, 'عضو لم يُقيَّم = ليست موحّدة');
  assert.deepEqual({ ...app.taskGroupScoreState(['d'], sc) }, { value: null, mixed: false, graded: 0 });
});

test('درجة المجموعة — تحفظ لكل أعضائها بطلب واحد باسم المعلم، ولا تمسّ المجموعات الأخرى', async () => {
  const log = [];
  const seed = {
    classroom_task_students: [
      { teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: null }, { teacher_id: 'u1', task_id: 'T1', student_id: 'b', score: null },
      { teacher_id: 'u1', task_id: 'T1', student_id: 'c', score: null },
    ],
    classroom_tasks: [], classroom_grade_scores: [],
  };
  const app = taskApp(seed, log);
  sheetWithTask(app, [['a', null], ['b', null], ['c', null]], [['a', 1], ['b', 1], ['c', 2]]);
  app.openCrmTaskScorePicker(null, 1);
  app.applyCrmTaskScore(8);
  assert.deepEqual([...runInAppContext(app, '[...crmSheet.task.scores.entries()]')], [['a', 8], ['b', 8], ['c', null]]);
  await runInAppContext(app, 'crmSheet.task.queue.get("a")');
  const ups = writes(log, 'classroom_task_students', 'update');
  assert.equal(ups.length, 1, 'طلب واحد للمجموعة');
  assert.deepEqual(filtersOf(ups[0]), { teacher_id: 'u1', task_id: 'T1', student_id: ['a', 'b'] });
});

test('درجة المجموعة — عضو لم يعد مكلّفًا تُعاد درجته وحده', async () => {
  const log = [];
  const seed = { classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: null }], classroom_tasks: [], classroom_grade_scores: [] };
  const app = taskApp(seed, log);
  sheetWithTask(app, [['a', null], ['b', 3]], [['a', 1], ['b', 1]]);
  app.openCrmTaskScorePicker(null, 1);
  app.applyCrmTaskScore(10);
  await runInAppContext(app, 'crmSheet.task.queue.get("a")');
  assert.deepEqual([...runInAppContext(app, '[...crmSheet.task.scores.entries()]')], [['a', 10], ['b', 3]]);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /لم تُحفظ درجة 1/);
});

test('مهمة جماعية جديدة — تُحفظ أرقام المجموعات مع المكلَّفين', async () => {
  const log = [];
  const app = taskApp({}, log);
  runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 };`);
  app.openCrmTaskModal();
  app.toggleCrmTaskPick('a'); app.toggleCrmTaskPick('b'); app.toggleCrmTaskPick('c');
  app.setCrmTaskGroupMode(true);
  app.setCrmTaskGroupCount(1);
  assert.deepEqual([...runInAppContext(app, '[...crmTaskDraft.groups.entries()]')], [['a', 1], ['b', 1], ['c', 2]]);
  app.cycleCrmTaskGroup('b');
  fillTaskForm(app, 'مشروع', '10');
  await app.saveCrmTask();
  const rows = writes(log, 'classroom_task_students', 'insert')[0].rows;
  assert.deepEqual([...rows].map(r => r.student_id + ':' + r.group_no), ['a:1', 'b:2', 'c:2']);
});

test('مهمة جماعية — طالب يُضاف يذهب لأصغر مجموعة، وتغيير العدد يعيد التوزيع المتوازن', async () => {
  const app = taskApp({}, []);
  runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 };`);
  app.openCrmTaskModal();
  app.toggleCrmTaskPick('a'); app.toggleCrmTaskPick('b');
  app.setCrmTaskGroupMode(true);
  app.setCrmTaskGroupCount(1);
  assert.deepEqual([...runInAppContext(app, '[...crmTaskDraft.groups.entries()]')], [['a', 1], ['b', 2]]);
  app.toggleCrmTaskPick('c');
  assert.equal(runInAppContext(app, 'crmTaskDraft.groups.get("c")'), 1);
  app.setCrmTaskGroupCount(-1);
  assert.deepEqual([...runInAppContext(app, '[...crmTaskDraft.groups.values()]')], [1, 1, 1]);
});

test('تعديل مهمة جماعية — تغيير المجموعة يحدّث group_no فقط ولا يمسّ الدرجات', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'مشروع', description: null, max_score: 10, due_date: null }],
    classroom_task_students: [
      { teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 8, group_no: 1 },
      { teacher_id: 'u1', task_id: 'T1', student_id: 'b', score: 8, group_no: 1 },
    ],
  };
  const app = taskApp(seed, log);
  await app.openCrmTaskEditor('T1');
  assert.equal(runInAppContext(app, 'crmTaskDraft.groupCount'), 1);
  app.setCrmTaskGroupCount(1); // مجموعتان: a في 1، b في 2
  fillTaskForm(app, 'مشروع', '10');
  await app.saveCrmTask();
  const ups = writes(log, 'classroom_task_students', 'update');
  assert.equal(ups.length, 1);
  assert.deepEqual({ ...ups[0].values }, { group_no: 2 });
  assert.deepEqual(filtersOf(ups[0]), { teacher_id: 'u1', task_id: 'T1', student_id: ['b'] });
});

/* ============ المهمة شاهدًا، ومهام الطالب في ملفه وتقريره ============ */
test('buildTaskShahidDraft — تنوع أساليب التقويم، توزيع الدرجات بلا أسماء', async () => {
  const app = loadApp();
  const d = app.buildTaskShahidDraft({
    task: { title: 'مجلة الصف', description: 'عدد من 4 صفحات', max_score: 10, due_date: '2026-10-05' },
    rows: [
      { student_id: 'a', score: 9, group_no: 1 }, { student_id: 'b', score: 8, group_no: 1 },
      { student_id: 'c', score: 6, group_no: 2 }, { student_id: 'd', score: 3, group_no: 2 }, { student_id: 'e', score: null, group_no: 2 },
    ],
    sectionLabel: 'ثاني ثانوي — الشعبة ٦', todayIso: '2026-10-08',
  });
  assert.equal(d.elementKey, 'تنوع أساليب التقويم');
  assert.equal(d.title, 'مهمة أدائية: مجلة الصف');
  assert.equal(d.date, '2026-10-05', 'موعد التسليم إن مضى');
  assert.match(d.description, /5 طلاب في ثاني ثانوي — الشعبة ٦ مهمة أدائية جماعية \(مجموعتان\): مجلة الصف\. عدد من 4 صفحات/);
  assert.match(d.quant, /قُيّم 4 من 5 · المتوسط 6\.5 من 10 \(65%\)/);
  assert.match(d.quant, /أتقن \(75% فأكثر\): 2 · متوسط \(50–74%\): 1 · يحتاج دعمًا \(أقل من 50%\): 1/);
  assert.match(d.quant, /المجموعة 1: 8\.5 من 10 · المجموعة 2: 4\.5 من 10/);
  assert.match(d.reflection, /طالب واحد دون 50% — يحتاج دعمًا/);
  assert.match(d.reflection, /بقي طالب واحد لم يُقيَّم بعد/);
  assert.equal(d.qual, '', 'الملاحظة النوعية يكتبها المعلم');
  const all = JSON.stringify(d);
  assert.ok(!/"[a-e]"/.test(all), 'لا معرّفات طلاب في المسودة');
  const future = app.buildTaskShahidDraft({ task: { title: 'x', max_score: 5, due_date: '2026-12-01' }, rows: [{ student_id: 'a', score: 5 }], todayIso: '2026-10-08' });
  assert.equal(future.date, '2026-10-08', 'موعد لم يأتِ = تاريخ اليوم');
  assert.match(future.description, /فردية/);
});

test('openShahidDraftFromTask — لا مسودة لمهمة بلا أي درجة مرصودة، والقراءة باسم المعلم', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'x', max_score: 10 }],
    classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: null }],
  };
  const app = taskApp(seed, log);
  runInAppContext(app, `window.__started = 0; startNewShahid = () => { window.__started++; };`);
  await app.openShahidDraftFromTask('T1');
  assert.equal(runInAppContext(app, 'window.__started'), 0);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /ارصد درجات المهمة أولًا/);
  assert.ok(log.filter(l => l.op === 'select').every(l => filtersOf(l).teacher_id === 'u1'));
});

test('openShahidDraftFromTask — يفتح المسودة ويربطها بالمهمة؛ مهمة معلم آخر لا تُفتح', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'تقرير', max_score: 10 }, { id: 'X', teacher_id: 'u2', section_id: 'S', title: 'y', max_score: 10 }],
    classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 7 }, { teacher_id: 'u2', task_id: 'X', student_id: 'z', score: 7 }],
  };
  const app = taskApp(seed, log);
  runInAppContext(app, `window.__filled = null; startNewShahid = () => { taskShahidContext = null; }; updateExample = () => {}; fillShahidFields = f => { window.__filled = f; };`);
  await app.openShahidDraftFromTask('X');
  assert.equal(runInAppContext(app, 'window.__filled'), null);
  await app.openShahidDraftFromTask('T1');
  assert.equal(runInAppContext(app, 'taskShahidContext && taskShahidContext.taskId'), 'T1');
  assert.match(runInAppContext(app, 'window.__filled.quant'), /قُيّم 1 من 1/);
});

test('startNewShahid — يلغي سياق مسودة مهمة سابقة (لا يُربط شاهد آخر بها)', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `taskShahidContext = { taskId: 'T1' }; showForm = () => {};`);
  try{ app.startNewShahid(); } catch(e){ /* DOM وهمي */ }
  assert.equal(runInAppContext(app, 'taskShahidContext'), null);
});

test('linkTaskToShahid — باسم المعلم', async () => {
  const log = [];
  const app = taskApp({ classroom_tasks: [{ id: 'T1', teacher_id: 'u1' }] }, log);
  await app.linkTaskToShahid('T1', 'SH1');
  const u = writes(log, 'classroom_tasks', 'update')[0];
  assert.deepEqual(filtersOf(u), { teacher_id: 'u1', id: 'T1' });
  assert.deepEqual({ ...u.values }, { shahid_id: 'SH1' });
});

test('loadStudentTasks — مهامه في الفصل المعروض فقط وباسم المعلم، ولو من شعبة سابقة', async () => {
  const seed = {
    classroom_task_students: [
      { teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 7, group_no: 2 },
      { teacher_id: 'u1', task_id: 'OLD', student_id: 'a', score: null },
      { teacher_id: 'u1', task_id: 'PREV', student_id: 'a', score: 1 },
      { teacher_id: 'u2', task_id: 'X', student_id: 'a', score: 0 },
    ],
    classroom_tasks: [
      { id: 'T1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'مجلة', max_score: 10, created_at: '2026-10-02' },
      { id: 'OLD', teacher_id: 'u1', section_id: 'S0', academic_year: TERM.year, semester: 1, title: 'عرض', max_score: 5, created_at: '2026-09-20' },
      { id: 'PREV', teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 2, title: 'قديم', max_score: 5, created_at: '2026-03-01' },
      { id: 'X', teacher_id: 'u2', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'لغيره', max_score: 5, created_at: '2026-10-01' },
    ],
  };
  const app = taskApp(seed, []);
  const tasks = await app.loadStudentTasks('a', TERM);
  const lines = app.studentTaskLines(tasks);
  assert.deepEqual([...lines].map(l => l.title + ' = ' + l.result), ['عرض = لم يُقيَّم', 'مجلة (جماعية · المجموعة 2) = 7 من 10']);
});

test('تقرير الطالب — قسم المهام الأدائية بنص محمي', async () => {
  const app = loadApp();
  const html = app.buildStudentReportHtml({
    attendance: [], incidents: [], positives: [], followups: [], grades: { columns: [], scores: [] }, studentId: 'a',
    tasks: [{ title: '<b>x</b>', max_score: 10, score: 8, group_no: null }],
  }, { studentName: 'أ', sectionLabel: 'س', todayIso: '2026-10-08' });
  assert.match(html, /المهام الأدائية/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /8 من 10/);
  const none = app.buildStudentReportHtml({ attendance: [], incidents: [], positives: [], followups: [], grades: { columns: [], scores: [] }, studentId: 'a', tasks: [] },
    { studentName: 'أ', sectionLabel: 'س', todayIso: '2026-10-08' });
  assert.ok(!/المهام الأدائية/.test(none), 'لا قسم إن لم يُكلَّف بمهام');
});
