'use strict';
/* ============================================================
   "أضف أداة بنفسك" (app-23-custom-tools.js)
   ------------------------------------------------------------
   باتفاق مع المعلم: عدّاد (+1) / حالة (تمّ ولم يتمّ) / درجة.
   - ما لم يُرصد لا يُحسب (لا صفر صامت).
   - الأداة المخفية: بياناتها باقية ولا تُحسب ولا تظهر.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };

function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = [];
      let op = 'select', values = null, single = false, cols = '', onConflict = null;
      const result = () => {
        if(opts.fail && opts.fail(table, op)) return { data: null, error: { message: 'boom', code: opts.code } };
        if(op === 'insert'){
          const rows = Array.isArray(values) ? values : [values];
          log.push({ table, op, rows });
          const out = rows.map((r, i) => Object.assign({ id: 'NEW' + i }, r));
          return { data: single ? out[0] : out, error: null };
        }
        if(op === 'upsert'){ log.push({ table, op, rows: Array.isArray(values) ? values : [values], onConflict }); return { data: null, error: null }; }
        if(op === 'update' || op === 'delete'){ log.push({ table, op, filters: f.slice(), values }); return { data: match(seed[table], f), error: null }; }
        log.push({ table, op: 'select', filters: f.slice(), cols });
        const rows = match(seed[table], f);
        return { data: single ? (rows[0] || null) : rows, error: null };
      };
      const api = {
        select(c){ if(op === 'select') cols = c || ''; return api; }, order(){ return api; }, limit(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; onConflict = o && o.onConflict; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        maybeSingle(){ single = true; return Promise.resolve(result()); }, single(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(opts.delay && opts.delay(table, op)).then(() => result()).then(res, rej); },
      };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: 1, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
    storage: { from: () => ({}) },
  };
}

const TOOLS = [
  { id: 'TC', name: 'قراءة', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false },
  { id: 'TS', name: 'إحضار الكتاب', tool_type: 'status', category: 'performance', max_score: 5, hidden: false },
  { id: 'TG', name: 'شفهي', tool_type: 'score', category: 'tests', max_score: 4, hidden: false },
];

function appWith(seed, log, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    showInfoModal = () => {}; showConfirm = async () => true; closeCrmModal = () => {};
    crmCurrentTerm = () => (${JSON.stringify(TERM)});
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }, { id: 'b', full_name: 'ب', section_id: 'S' }];
    crmCustomTools = ${JSON.stringify(TOOLS)}; crmCustomToolsLoaded = true;
  `);
  return app;
}
const filtersOf = e => Object.fromEntries(e.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v] : v]));
const writes = (log, table, op) => log.filter(l => l.table === table && l.op === op);

/* ============ الدوال الصرفة ============ */
test('toolColumnScoreFor — الحالة نسبة "تمّ"، والدرجة متوسط النسب، ولا رصد = لا درجة', async () => {
  const app = loadApp();
  assert.equal(app.toolColumnScoreFor({ tool_type: 'status' }, [1, 1, 0, 1], 10), 7.5);
  assert.equal(app.toolColumnScoreFor({ tool_type: 'score', max_score: 4 }, [4, 2], 10), 7.5);
  assert.equal(app.toolColumnScoreFor({ tool_type: 'score', max_score: 4 }, [], 10), null);
  assert.equal(app.toolColumnScoreFor({ tool_type: 'status' }, undefined, 10), null);
});

test('nextToolStatus — لم يُرصد ← تمّ ← لم يتمّ ← لم يُرصد', async () => {
  const app = loadApp();
  assert.equal(app.nextToolStatus(null), 1);
  assert.equal(app.nextToolStatus(1), 0);
  assert.equal(app.nextToolStatus(0), null);
});

test('isComputedGradeColumn — العدّاد يُعدَّل يدويًا، والحالة والدرجة محسوبتان', async () => {
  const app = appWith();
  assert.equal(app.isComputedGradeColumn({ kind: 'manual', tool_id: 'TC' }), false);
  assert.equal(app.isComputedGradeColumn({ kind: 'manual', tool_id: 'TS' }), true);
  assert.equal(app.isComputedGradeColumn({ kind: 'homework' }), true);
  assert.equal(app.isComputedGradeColumn({ kind: 'manual' }), false);
});

test('عمود الأداة يتبع إخفاءها؛ والاختبارات تتبع أداة الاختبارات؛ وأداة لم تُحمَّل لا تُخفي بالخطأ', async () => {
  const app = appWith();
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'manual', tool_id: 'TS' }), true);
  runInAppContext(app, `crmCustomTools[1].hidden = true;`);
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'manual', tool_id: 'TS' }), false);
  runInAppContext(app, `appFeatures = { sections: {}, tools: { tests: false } };`);
  assert.equal(app.gradeColumnVisible({ category: 'tests', kind: 'manual', tool_id: 'TG' }), false);
  runInAppContext(app, `crmCustomToolsLoaded = false; crmCustomTools = [];`);
  assert.equal(app.gradeColumnVisible({ category: 'performance', kind: 'manual', tool_id: 'X' }), true);
});

test('ورقة الحصة — الأدوات الظاهرة أوضاع، واسم الأداة مُهرَّب', async () => {
  const app = appWith();
  runInAppContext(app, `crmCustomTools[0].name = '<img src=x onerror=alert(1)>'; crmCustomTools[1].hidden = true; crmSheet = { mode: 'attendance' };`);
  assert.deepEqual([...app.enabledSheetModes()], ['attendance', 'participation', 'homework', 'task', 'test', 'tool:TC', 'tool:TG']);
  const html = app.crmSheetModeSwitchHtml();
  assert.ok(!/<img/.test(html));
  assert.match(html, /&lt;img/);
});

/* ============ عمود الأداة ============ */
test('ensureToolColumn — يعيد القائم، وينشئ ضمن السقف باسم المعلم، ويرفض تجاوز السقف بلا إدراج', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [{ id: 'C1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'performance', max_score: 30, kind: 'manual' }] };
  const app = appWith(seed, log);
  const tool = runInAppContext(app, 'crmCustomTools[1]');
  const r = await app.ensureToolColumn(tool, 'S', TERM);
  const ins = writes(log, 'classroom_grade_columns', 'insert')[0];
  assert.deepEqual({ teacher_id: ins.rows[0].teacher_id, tool_id: ins.rows[0].tool_id, kind: ins.rows[0].kind, max_score: ins.rows[0].max_score, category: ins.rows[0].category }, { teacher_id: 'u1', tool_id: 'TS', kind: 'manual', max_score: 5, category: 'performance' });
  assert.ok(r.column);
  seed.classroom_grade_columns[0].max_score = 38;
  const r2 = await app.ensureToolColumn(tool, 'S', TERM);
  assert.equal(r2.error, 'cap');
  assert.equal(r2.remaining, 2);
  assert.equal(writes(log, 'classroom_grade_columns', 'insert').length, 1, 'لا إدراج ثانٍ');
  seed.classroom_grade_columns.push({ id: 'CT', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'performance', max_score: 5, kind: 'manual', tool_id: 'TS', name: 'إحضار الكتاب' });
  const r3 = await app.ensureToolColumn(tool, 'S', TERM);
  assert.equal(r3.column.id, 'CT');
});

test('ensureToolColumn — أداة في الاختبارات لا يمنعها سقف: اختبارات قائمة مجموعها 40 لا تمنع عمودها', async () => {
  const log = [];
  const t = (id, max) => ({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'tests', max_score: max, kind: 'manual' });
  const app = appWith({ classroom_grade_columns: [t('A', 20), t('B', 20)] }, log);
  const r = await app.ensureToolColumn(runInAppContext(app, 'crmCustomTools[2]'), 'S', TERM);
  assert.ok(r.column, 'أُنشئ العمود');
  assert.equal(writes(log, 'classroom_grade_columns', 'insert')[0].rows[0].category, 'tests');
});

test('syncToolColumn — رصد الفصل كله (ولو من شعبة سابقة) باسم المعلم، ولا رصد = تُمسح الدرجة', async () => {
  const log = [];
  const seed = {
    classroom_tool_marks: [
      { teacher_id: 'u1', tool_id: 'TS', student_id: 'a', academic_year: TERM.year, semester: 1, section_id: 'S', value: 1 },
      { teacher_id: 'u1', tool_id: 'TS', student_id: 'a', academic_year: TERM.year, semester: 1, section_id: 'OLD', value: 0 },
      { teacher_id: 'u1', tool_id: 'TS', student_id: 'a', academic_year: '1447-1448', semester: 2, section_id: 'S', value: 0 },
      { teacher_id: 'u2', tool_id: 'TS', student_id: 'a', academic_year: TERM.year, semester: 1, section_id: 'S', value: 0 },
    ],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'CT', student_id: 'b', score: 3 }],
  };
  const app = appWith(seed, log);
  await app.syncToolColumn({ id: 'CT', max_score: 10 }, runInAppContext(app, 'crmCustomTools[1]'), 'S', TERM);
  const up = writes(log, 'classroom_grade_scores', 'upsert')[0];
  assert.deepEqual([...up.rows].map(r => r.student_id + ':' + r.score + ':' + r.teacher_id), ['a:5:u1'], '(1+0)/2 × 10');
  const del = writes(log, 'classroom_grade_scores', 'delete')[0];
  assert.deepEqual(filtersOf(del), { teacher_id: 'u1', column_id: 'CT', student_id: ['b'] });
});

/* ============ الرصد من ورقة الحصة ============ */
function toolSheet(app, toolIdx, values){
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'tool:' + crmCustomTools[${toolIdx}].id, states: {},
    tool: { tool: crmCustomTools[${toolIdx}], column: { id: 'CT', max_score: 10 }, values: new Map(${JSON.stringify(values)}), queue: new Map(), term: ${JSON.stringify(TERM)}, period: 2 } };`);
}

test('حالة — النقرة تحفظ صف الحصة باسم المعلم، و"لم يُرصد" يحذفه', async () => {
  const log = [];
  const app = appWith({ classroom_tool_marks: [], classroom_grade_scores: [] }, log);
  toolSheet(app, 1, []);
  app.tapCrmTool('a');
  await runInAppContext(app, 'crmSheet.tool.queue.get("a")');
  const up = writes(log, 'classroom_tool_marks', 'upsert')[0];
  const r = up.rows[0];
  assert.deepEqual({ t: r.teacher_id, tool: r.tool_id, st: r.student_id, d: r.mark_date, p: r.period, v: r.value, y: r.academic_year }, { t: 'u1', tool: 'TS', st: 'a', d: '2026-10-19', p: 2, v: 1, y: TERM.year });
  assert.equal(up.onConflict, 'tool_id,student_id,mark_date,period');
  app.tapCrmTool('a'); app.tapCrmTool('a');
  await runInAppContext(app, 'crmSheet.tool.queue.get("a")');
  const del = writes(log, 'classroom_tool_marks', 'delete')[0];
  assert.deepEqual(filtersOf(del), { teacher_id: 'u1', tool_id: 'TS', student_id: 'a', mark_date: '2026-10-19', period: 2 });
  assert.equal(runInAppContext(app, 'crmSheet.tool.values.has("a")'), false);
});

test('رصد فشل حفظه يعود في العرض لما كان', async () => {
  const log = [];
  const app = appWith({}, log, { fail: (t, op) => t === 'classroom_tool_marks' && op === 'upsert' });
  toolSheet(app, 1, [['a', 0]]);
  app.setCrmToolValue('a', 1);
  await runInAppContext(app, 'crmSheet.tool.queue.get("a")');
  assert.equal(runInAppContext(app, 'crmSheet.tool.values.get("a")'), 0);
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /لم يُحفظ الرصد/);
});

test('انحدار: نافذة رصد درجة فُتحت لأداة ثم تبدّلت الأداة — لا يُكتب على الأخرى', async () => {
  const log = [];
  const app = appWith({}, log);
  toolSheet(app, 2, []);
  app.openCrmToolScorePicker('a');
  runInAppContext(app, `crmSheet.tool.tool = crmCustomTools[1];`);
  app.applyCrmToolScore(3);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(writes(log, 'classroom_tool_marks', 'upsert').length, 0);
});

test('انحدار: "الكل تمّ" ينتظر مسح رصد معلّق لنفس الطالب، ونقرة بعده تنتظر الحفظ الجماعي', async () => {
  const log = [];
  const later = ms => new Promise(r => setTimeout(r, ms));
  const app = appWith({ classroom_tool_marks: [], classroom_grade_scores: [] }, log,
    { delay: (t, op) => (t === 'classroom_tool_marks' ? later(op === 'delete' ? 30 : 15) : null) });
  toolSheet(app, 1, [['a', 1]]);
  app.setCrmToolValue('a', null);           /* مسح بطيء الحفظ */
  const bulk = app.markAllCrmToolDone();     /* يشمل "a" و"b" */
  app.tapCrmTool('b');                       /* تمّ ← لم يتمّ بعد الحفظ الجماعي */
  await bulk;
  await runInAppContext(app, 'crmSheet.tool.queue.get("b")');
  const order = log.filter(l => l.table === 'classroom_tool_marks' && l.op !== 'select')
    .map(l => l.op + ':' + (l.op === 'delete' ? filtersOf(l).student_id : l.rows.map(r => r.student_id + '=' + r.value).join(',')));
  assert.deepEqual(order, ['delete:a', 'upsert:a=1,b=1', 'upsert:b=0']);
  assert.equal(runInAppContext(app, 'crmSheet.tool.values.get("a")'), 1);
  assert.equal(runInAppContext(app, 'crmSheet.tool.values.get("b")'), 0);
});

test('العدّاد — نفس محرّك المشاركة على عمود الأداة، بسجل تراجع منفصل', async () => {
  const app = appWith();
  const s = { sectionId: 'S', dateIso: '2026-10-19', period: 1 };
  assert.notEqual(app.participationTodayKey(s, 'TC'), app.participationTodayKey(s));
  assert.match(app.participationTodayKey(s, 'TC'), /\|2026-10-19\|/, 'التنظيف بعد 14 يومًا يقرأ التاريخ منه');
});

/* ============ إدارة الأدوات ============ */
function fillToolForm(app, name, max, cat){
  runInAppContext(app, `
    document.getElementById('custToolName').value = ${JSON.stringify(name)};
    document.getElementById('custToolMax').value = ${JSON.stringify(max)};
    document.getElementById('custToolCat').value = ${JSON.stringify(cat || 'performance')};`);
}

test('saveCustomTool — يُضاف باسم المعلم، ويُرفض الاسم الفارغ والمكرر والدرجة غير الصالحة', async () => {
  const log = [];
  const app = appWith({ classroom_custom_tools: [] }, log);
  app.openCustomToolEditor(null);
  app.pickCustomToolType('status');
  fillToolForm(app, '', '5'); await app.saveCustomTool();
  fillToolForm(app, 'قراءة', '5'); await app.saveCustomTool();
  fillToolForm(app, 'دفتر', '45'); await app.saveCustomTool();
  assert.equal(writes(log, 'classroom_custom_tools', 'insert').length, 0);
  fillToolForm(app, 'دفتر', '٥', 'tests'); await app.saveCustomTool();
  const ins = writes(log, 'classroom_custom_tools', 'insert')[0].rows[0];
  assert.deepEqual({ t: ins.teacher_id, n: ins.name, ty: ins.tool_type, c: ins.category, m: ins.max_score }, { t: 'u1', n: 'دفتر', ty: 'status', c: 'tests', m: 5 });
});

test('customToolHintText — يشرح كيف يُحسب كل نوع بمثال بدرجة المعلم', async () => {
  const app = loadApp();
  assert.match(app.customToolHintText('score', 20, 'tests'), /متوسط درجات الطالب/);
  assert.match(app.customToolHintText('score', 20, 'tests'), /20 و 10 ← 15 من 20/);
  assert.match(app.customToolHintText('status', 10, 'performance'), /3 مرات من 4 ← 7\.5 من 10/);
  assert.match(app.customToolHintText('counter', 5, 'performance'), /يجمع النقرات \(حتى 5\)/);
  assert.equal(app.customToolHintText('score', 0, 'tests'), '');
});

test('toolCapRoom — أضيق كشف في الفئة، ويتجاهل عمود الأداة نفسها والفئة الأخرى', async () => {
  const app = loadApp();
  const cols = [
    { section_id: 'S1', category: 'tests', name: 'الفترة الأولى', max_score: 10 }, { section_id: 'S1', category: 'tests', name: 'الفترة الثانية', max_score: 10 },
    { section_id: 'S2', category: 'tests', name: 'اختبار', max_score: 5 },
    { section_id: 'S2', category: 'performance', name: 'مشاركة', max_score: 40 },
    { section_id: 'S2', category: 'tests', name: 'عمود أداتي', max_score: 5, tool_id: 'TG' },
  ];
  const r = app.toolCapRoom(cols, 'tests', 20, null);
  assert.equal(r.remaining, 0);
  assert.deepEqual([...r.names], ['الفترة الأولى', 'الفترة الثانية']);
  assert.equal(app.toolCapRoom(cols, 'tests', 20, 'TG').remaining, 0);
  assert.equal(app.toolCapRoom([cols[2], cols[4]], 'tests', 20, 'TG').remaining, 15);
  assert.equal(app.toolCapRoom([], 'tests', 20, null).remaining, 20);
});

test('نافذة الأداة — الشرح يتبع النوع، وينبّه حين لا يتسع سقف الأداء بقراءة باسم المعلم، والاختبارات بلا سقف', async () => {
  const log = [];
  const c = (name, max) => ({ section_id: 'S', category: 'performance', name, max_score: max, teacher_id: 'u1', academic_year: TERM.year, semester: TERM.semester });
  const app = appWith({ classroom_grade_columns: [c('مشاركة', 10), c('واجبات', 10), c('مهام أدائية', 20)] }, log);
  app.openCustomToolEditor(null);
  app.pickCustomToolType('score');
  fillToolForm(app, 'قراءة', '10', 'performance');
  await app.refreshCustomToolHint();
  const txt = id => runInAppContext(app, `document.getElementById('${id}').textContent`);
  assert.match(txt('custToolHint'), /متوسط درجات الطالب/);
  assert.match(txt('custToolRoom'), /لا يتسع الكشف/);
  assert.match(txt('custToolRoom'), /مهام أدائية/);
  const sel = log.filter(l => l.table === 'classroom_grade_columns' && l.op === 'select').pop();
  assert.equal(filtersOf(sel).teacher_id, 'u1');
  fillToolForm(app, 'اختبار قصير', '20', 'tests');
  await app.refreshCustomToolHint();
  assert.doesNotMatch(txt('custToolRoom'), /⚠/);
  assert.match(txt('custToolRoom'), /بلا حد لعدد الاختبارات/);
});

test('تعديل الأداة لا يغيّر نوعها، والإخفاء والحذف باسم المعلم', async () => {
  const log = [];
  const app = appWith({ classroom_custom_tools: TOOLS.map(t => Object.assign({ teacher_id: 'u1' }, t)) }, log);
  app.openCustomToolEditor('TG');
  app.pickCustomToolType('counter');
  fillToolForm(app, 'شفهي قصير', '4'); await app.saveCustomTool();
  const up = writes(log, 'classroom_custom_tools', 'update')[0];
  assert.deepEqual(filtersOf(up), { teacher_id: 'u1', id: 'TG' });
  assert.deepEqual({ ...up.values }, { name: 'شفهي قصير', max_score: 4 }, 'لا tool_type في التعديل');
  await app.toggleCustomToolHidden('TS');
  const hid = writes(log, 'classroom_custom_tools', 'update')[1];
  assert.deepEqual(filtersOf(hid), { teacher_id: 'u1', id: 'TS' });
  assert.deepEqual({ ...hid.values }, { hidden: true });
  await app.deleteCustomTool('TC');
  assert.deepEqual(filtersOf(writes(log, 'classroom_custom_tools', 'delete')[0]), { teacher_id: 'u1', id: 'TC' });
});

/* ============ الكشف ============ */
test('كشف لا فيه إلا عمود أداة: يُعرض "إنشاء الكشف"، والإنشاء يملأ ما تبقّى من السقف بلا تكرار عمود الأداة', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [{ id: 'CT', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'performance', max_score: 5, kind: 'manual', tool_id: 'TS', name: 'إحضار الكتاب' }] };
  const app = appWith(seed, log);
  const g = { sectionId: 'S', year: TERM.year, semester: 1, columns: seed.classroom_grade_columns, allColumns: seed.classroom_grade_columns, hiddenColumns: [], scores: [] };
  assert.match(app.crmGradeSimpleHtml(g), /إنشاء الكشف/);
  assert.match(app.crmGradeDetailHtml(g), /إنشاء الكشف/);
  runInAppContext(app, `crmGrades = ${JSON.stringify(g)}; renderCrmGrades = () => {}; previousGradeTerm = () => null;`);
  await app.createCrmGradeSheet();
  const rows = writes(log, 'classroom_grade_columns', 'insert')[0].rows;
  const perf = [...rows].filter(r => r.category === 'performance').reduce((t, r) => t + r.max_score, 0);
  assert.equal(perf, 35, '40 − 5 لعمود الأداة');
  assert.ok(![...rows].some(r => r.tool_id === 'TS'));
});

test('انحدار: إنشاء كشف الشعبة الجديدة عند نقل طالب ينسخ نوع العمود (مشاركة/واجبات) ورابط الأداة', async () => {
  const app = loadApp();
  assert.match(app.moveStudentGrades.toString(), /select\('category, name, max_score, measures, position, kind, tool_id'\)/);
});

test('deleteCrmStudent — التراجع يعيد رصد أدواته', async () => {
  const log = [];
  const seed = { classroom_tool_marks: [{ id: 'm1', teacher_id: 'u1', tool_id: 'TS', student_id: 'a', value: 1 }] };
  const app = appWith(seed, log);
  runInAppContext(app, `showUndoToast = async () => false; loadCrmStudents = async () => {}; renderCrmStudentsList = () => {}; refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};`);
  await app.deleteCrmStudent('a');
  const restored = writes(log, 'classroom_tool_marks', 'insert')[0];
  assert.ok(restored);
  assert.equal(restored.rows[0].id, 'm1');
});
