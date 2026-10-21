'use strict';
/* ============================================================
   "يبدأ من": 0 (الأصل) أو الكاملة — لكل مكوّنات الأداء: المشاركة والواجبات
   والمهام والمكوّنات الخاصة (عدّاد/حالة/درجة)
   - من الكاملة: الكل يبدأ بالدرجة الكاملة، والنقرة −1 (والصفر درجة حقيقية).
   - الواجبات من الكاملة: الكل "سلّم"، والنقرة الأولى "لم يسلّم".
   - تغيير الخيار يعيد الكل لنقطة البداية في كل الشعب — بعد تأكيد صريح.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const TOOL_ID = '11111111-2222-3333-4444-555555555555';

function fakeClient(seed, log, opts){
  opts = opts || {};
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = []; let op = 'select', values = null, options = null, single = false;
      const result = () => {
        if(op !== 'select'){
          log.push({ table, op, values, options, filters: f.slice() });
          if(op === 'update') return { data: match(seed[table], f), error: null };
          return { data: op === 'insert' ? (single ? { id: 'HW-NEW' } : [{ id: 'HW-NEW' }]) : null, error: null };
        }
        const rows = match(seed[table], f);
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; options = o; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); }, maybeSingle(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); } };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: opts.rpcValue !== undefined ? opts.rpcValue : 9, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
}

function appWith(seed, log, features, opts){
  const app = loadApp({ supabaseClient: fakeClient(seed || {}, log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__confirm = []; window.__answer = true; showConfirm = async m => { window.__confirm.push(m); return window.__answer; };
    window.__saved = 0; saveAppFeatures = async () => { window.__saved++; }; afterAppFeaturesChanged = () => {}; renderCrmGrades = () => {};
    afterCrmGradesChanged = () => {}; window.__synced = []; loadCrmGradeSheet = async id => { window.__synced.push(id); };
    crmCurrentTerm = () => (${JSON.stringify(TERM)}); crmSectionLabel = () => 'ش';
    crmSections = [{ id: 'S' }, { id: 'S2' }];
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }, { id: 'b', full_name: 'ب', section_id: 'S' }, { id: 'c', full_name: 'ج', section_id: 'S2' }];
    appFeatures = ${JSON.stringify(features || { sections: {}, tools: {} })};`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);
const col = (id, s, kind, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: s, academic_year: TERM.year, semester: 1, category: 'performance', kind, tool_id: null, name: kind, max_score: max }, extra || {});

test('normalizeFeatures — يحفظ "يبدأ من الكاملة" للمفاتيح الصالحة فقط', async () => {
  const app = loadApp();
  const out = app.normalizeFeatures({ startFull: { participation: true, homework: false, task: true, ['tool:' + TOOL_ID]: true, tasks: true, 'tool:x': true } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.startFull)), { participation: true, task: true, ['tool:' + TOOL_ID]: true });
  assert.equal(app.normalizeFeatures({}).startFull, undefined);
});

test('nextHomeworkState — من الكاملة: سلّم ← لم يسلّم ← ناقص ← متأخر ← سلّم؛ والأصل كما هو', async () => {
  const app = loadApp();
  assert.equal(app.nextHomeworkState('submitted', true), 'missing');
  assert.equal(app.nextHomeworkState('missing', true), 'partial');
  assert.equal(app.nextHomeworkState('late', true), 'submitted');
  assert.equal(app.nextHomeworkState('missing'), 'submitted');
});

async function partSheet(scores, opts){
  const log = [];
  const seed = { classroom_grade_columns: [col('P', 'S', 'participation', 10)], classroom_grade_scores: scores || [] };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { participation: true } }, opts);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 1, token: 1, mode: 'participation', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}

test('المشاركة من الكاملة — من لا درجة له يأخذ الكاملة باسم المعلم بلا كتابة فوق رصد قائم، والنقرة −1 والصفر يبقى', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6 }], { rpcValue: 5 });
  /* المشاركة بفترتين: الكاملة تُكتب في درجة الفترة الحالية (بلا تقويم = الأولى)، ولا تكتب فوق رصد قائم */
  const fills = log.filter(l => l.op === 'rpc' && l.name === 'set_period_score');
  assert.deepEqual(fills.map(l => JSON.parse(JSON.stringify(l.args))), [{ p_column_id: 'P', p_student_id: 'b', p_period: 1, p_score: 10, p_only_missing: true }]);
  assert.equal(log.filter(l => l.op === 'upsert').length, 0, 'لا كتابة مباشرة في الكشف');
  assert.equal(get(app, 'crmSheet.part.scores.get("b")'), 10);
  assert.match(get(app, `document.getElementById('crmLessonSheetBody').innerHTML`), /تبدأ الدرجة كاملة/);
  app.tapCrmParticipation('a');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 5);
  await get(app, 'crmSheet.part.queue.get("a")');
  const taps = () => log.filter(l => l.op === 'rpc' && l.name === 'increment_period_score');
  assert.deepEqual(JSON.parse(JSON.stringify(taps()[0].args)), { p_column_id: 'P', p_student_id: 'a', p_period: 1, p_delta: -1, p_full: true });
  app.undoCrmParticipation();
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 6, 'التراجع +1');
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(taps()[1].args.p_delta, 1);
});

test('المشاركة من الكاملة — عند الصفر لا تُرسل نقرة، والصفر المحفوظ لا يُحذف', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 1 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 0 }], { rpcValue: 0 });
  app.tapCrmParticipation('b');
  assert.equal(log.filter(l => l.op === 'rpc').length, 0);
  assert.match(get(app, 'window.__toasts.join("|")'), /صفر/);
  app.tapCrmParticipation('a');
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 0, 'صفر حقيقي لا "لم تُرصد"');
});

test('واجب جديد والواجبات من الكاملة — كل طلاب الشعبة "سلّم" باسم المعلم', async () => {
  const log = [];
  const app = appWith({}, log, { sections: {}, tools: {}, startFull: { homework: true } });
  runInAppContext(app, `crmHomeworkDraft = { sectionId: 'S', saving: false }; afterCrmHomeworkChanged = async () => {}; closeCrmModal = () => {};
    { const _g = document.getElementById; document.getElementById = id => id === 'crmHwTitle' ? { value: 'تمارين' } : id === 'crmHwDue' ? { value: '2026-10-25' } : _g(id); }`);
  await app.saveCrmHomework();
  const up = log.find(l => l.table === 'classroom_homework_status' && l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.status + ':' + r.teacher_id + ':' + r.homework_id), ['a:submitted:u1:HW-NEW', 'b:submitted:u1:HW-NEW']);
});

test('تغيير "يبدأ من" للمشاركة — بعد تأكيد: يُمسح المرصود في كل الشعب ويأخذ الكل الكاملة، ويُحفظ الخيار؛ والإلغاء لا يكتب', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('P', 'S', 'participation', 10), col('P2', 'S2', 'participation', 5), col('H', 'S', 'homework', 10), col('X', 'S', 'participation', 10, { teacher_id: 'u2' })] };
  const app = appWith(seed, log);
  runInAppContext(app, 'window.__answer = false;');
  await app.setGradeStartMode('participation', true);
  assert.equal(log.filter(l => l.op !== 'select').length, 0, 'الإلغاء لا يكتب');
  assert.match(get(app, 'window.__confirm[0]'), /يأخذ كل الطلاب الدرجة الكاملة الآن في كل شعبك لهذا الفصل، ويُمسح ما رصدته/);
  runInAppContext(app, 'window.__answer = true;');
  await app.setGradeStartMode('participation', true);
  const del = log.find(l => l.op === 'delete');
  assert.deepEqual(Object.fromEntries(del.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v].sort() : v])), { teacher_id: 'u1', column_id: ['P', 'P2'] });
  const up = log.find(l => l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => r.column_id + ':' + r.student_id + ':' + r.score + ':' + r.teacher_id), ['P:a:10:u1', 'P:b:10:u1', 'P2:c:5:u1']);
  assert.equal(get(app, 'appFeatures.startFull.participation'), true);
  assert.equal(get(app, 'window.__saved'), 1);
  assert.deepEqual([...get(app, 'window.__synced')], [], 'لا إعادة تحميل للكشف كله — المشاركة لا عمود محسوب لها');
});

test('تغيير "يبدأ من" للواجبات إلى 0 — يُمسح التسليم في واجبات الفصل لشعب المعلم، ولا "سلّم" جديد', async () => {
  const log = [];
  const seed = { classroom_homework: [{ id: 'h1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1 }, { id: 'h9', teacher_id: 'u1', section_id: 'S', academic_year: '1447-1448', semester: 1 }] };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { homework: true } });
  await app.setGradeStartMode('homework', false);
  const del = log.find(l => l.op === 'delete');
  assert.deepEqual(Object.fromEntries(del.filters.map(([c, v]) => [c, Array.isArray(v) ? [...v] : v])), { teacher_id: 'u1', homework_id: ['h1'] });
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
  assert.equal(get(app, 'gradeStartsFull("homework")'), false);
});

const STATUS_ID = '22222222-3333-4444-5555-666666666666';
const SCORE_ID = '33333333-4444-5555-6666-777777777777';
const NEW_ID = '44444444-5555-6666-7777-888888888888';
const TOOLS = `[{ id: '${TOOL_ID}', name: 'قراءة', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false },
  { id: '${STATUS_ID}', name: 'بحوث', tool_type: 'status', category: 'performance', max_score: 2, hidden: false },
  { id: '${SCORE_ID}', name: 'شفهي', tool_type: 'score', category: 'performance', max_score: 4, hidden: false }]`;

test('إعداد الدرجات — "يبدأ من [0][الكاملة]" لكل مكوّنات الأداء، ومنها المكوّن الخاص الجديد قبل أول رصد', async () => {
  const app = appWith({}, [], { sections: {}, tools: {}, startFull: { homework: true } });
  runInAppContext(app, `crmCustomTools = ${TOOLS}.concat([{ id: '${NEW_ID}', name: 'دفتر', tool_type: 'status', category: 'performance', max_score: 2, hidden: false }]); crmCustomToolsLoaded = true;`);
  const cols = [col('P', 'S', 'participation', 10), col('H', 'S', 'homework', 10), col('K', 'S', 'task', 10),
    col('R', 'S', 'manual', 5, { tool_id: TOOL_ID, name: 'قراءة' }), col('B', 'S', 'manual', 2, { tool_id: STATUS_ID, name: 'بحوث' }), col('O', 'S', 'manual', 4, { tool_id: SCORE_ID, name: 'شفهي' })];
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  ['participation', 'task', 'tool:' + TOOL_ID, 'tool:' + STATUS_ID, 'tool:' + SCORE_ID, 'tool:' + NEW_ID]
    .forEach(k => assert.match(html, new RegExp(`setGradeStartMode\\('${k}', true\\)`), k));
  assert.match(html, /<button type="button" class="is-on" aria-pressed="true" onclick="setGradeStartMode\('homework', true\)">✓ الدرجة كاملة/, 'الواجبات على الكاملة وعليها ✓');
  assert.match(html, /aria-pressed="true" onclick="setGradeStartMode\('participation', false\)">✓ 0</, 'المشاركة على 0 وعليها ✓');
});

test('انحدار: الكشف لا يكتب "الكاملة" مباشرة في عمود محسوب (واجبات/مهام/حالة/درجة) — تُمحى عند المزامنة وتعطي من لا رصد له الكاملة', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('H', 'S', 'homework', 10), col('K', 'S', 'task', 10), col('B', 'S', 'manual', 2, { tool_id: STATUS_ID }), col('P', 'S', 'participation', 10)] };
  /* loadCrmGradeSheet الحقيقي (appWith يستبدله لاختبارات أخرى) */
  const appReal = loadApp({ supabaseClient: fakeClient(seed, log), currentUser: { id: 'u1' } });
  runInAppContext(appReal, `crmCurrentTerm = () => (${JSON.stringify(TERM)}); crmSections = [{ id: 'S' }];
    crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }]; crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true;
    appFeatures = ${JSON.stringify({ sections: {}, tools: {}, startFull: { homework: true, task: true, participation: true, ['tool:' + STATUS_ID]: true } })};
    syncHomeworkColumn = async () => {}; loadSectionHomework = async () => ({}); syncTaskColumn = async () => {}; syncToolColumn = async () => {};`);
  await appReal.loadCrmGradeSheet('S');
  const filled = log.filter(l => l.op === 'upsert' && l.table === 'classroom_grade_scores').flatMap(l => [...l.values].map(r => r.column_id));
  assert.deepEqual(filled, [], 'لا عمود يُملأ مباشرة في الكشف');
  /* المشاركة تُملأ في درجة الفترة (والقاعدة تحدّث المعدّل) */
  const perFill = log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => l.args.p_column_id + ':' + l.args.p_student_id);
  assert.deepEqual(perFill, ['P:a']);
  assert.equal(appReal.directStartFullKey({ kind: 'homework' }), null);
  assert.equal(appReal.directStartFullKey({ kind: 'manual', tool_id: TOOL_ID }), 'tool:' + TOOL_ID);
});

test('nextToolStatus — من الكاملة: تمّ ⇄ لم يتمّ (بلا "لم يُرصد")', async () => {
  const app = loadApp();
  assert.equal(app.nextToolStatus(1, true), 0);
  assert.equal(app.nextToolStatus(0, true), 1);
  assert.equal(app.nextToolStatus(0), null);
});

async function toolSheet(toolId, marks){
  const log = [];
  const seed = { classroom_grade_columns: [col('B', 'S', 'manual', 2, { tool_id: toolId })], classroom_tool_marks: marks || [], classroom_grade_scores: [] };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { ['tool:' + toolId]: true } });
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true; appSectionOn = () => true; window.__toolSync = [];
    syncToolColumn = async (c, t, s, term, ids) => { window.__toolSync.push([...ids].join(',')); };
    crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'tool:${toolId}', states: {} };`);
  await app.renderCrmToolMode(get(app, 'crmStudentsOfSection("S")'), get(app, `customToolById('${toolId}')`));
  return { app, log };
}

test('أداة "حالة" من الكاملة — الحصة تبدأ "تمّ" لمن لم يُرصد له (بلا كتابة فوق رصد قائم)، والنقرة "لم يتمّ"، وبلا "الكل تمّ"', async () => {
  const { app, log } = await toolSheet(STATUS_ID, [{ teacher_id: 'u1', tool_id: STATUS_ID, student_id: 'a', section_id: 'S', mark_date: '2026-10-19', period: 2, value: 0 }]);
  const up = log.find(l => l.op === 'upsert' && l.table === 'classroom_tool_marks');
  assert.deepEqual([...up.values].map(r => [r.student_id, r.value, r.teacher_id, r.mark_date, r.period].join(':')), ['b:1:u1:2026-10-19:2']);
  assert.equal(up.options.ignoreDuplicates, true);
  assert.deepEqual([...get(app, '[...crmSheet.tool.values.entries()]')], [['a', 0], ['b', 1]]);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual([...get(app, 'window.__toolSync')], ['b'], 'عمود الأداة يُحدَّث لمن مُلئ');
  assert.equal(get(app, 'crmSheet.tool.queue.has("b")'), true, 'نقرة "ب" التالية تنتظر مزامنة الملء');
  const body = get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
  assert.match(body, /تبدأ <b>"تمّ"<\/b> للجميع/);
  assert.doesNotMatch(body, /markAllCrmToolDone/);
  app.tapCrmTool('b');
  assert.equal(get(app, 'crmSheet.tool.values.get("b")'), 0);
  app.tapCrmTool('b');
  assert.equal(get(app, 'crmSheet.tool.values.get("b")'), 1, 'لا تمرّ بـ"لم يُرصد"');
});

test('أداة "درجة" من الكاملة — الكل يبدأ بدرجة الأداة كاملة، ولا "مسح الرصد"', async () => {
  const { app, log } = await toolSheet(SCORE_ID, []);
  const up = log.find(l => l.op === 'upsert' && l.table === 'classroom_tool_marks');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.value), ['a:4', 'b:4']);
  runInAppContext(app, `window.__modal = ''; showInfoModal = h => { window.__modal = h; };`);
  app.openCrmToolScorePicker('a');
  assert.doesNotMatch(get(app, 'window.__modal'), /مسح الرصد/);
});

test('أداة "حالة" بالأصل (0) — لا ملء تلقائي، و"الكل تمّ" ظاهر', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('B', 'S', 'manual', 2, { tool_id: STATUS_ID })], classroom_tool_marks: [], classroom_grade_scores: [] };
  const app = appWith(seed, log);
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true; appSectionOn = () => true;
    crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'tool:${STATUS_ID}', states: {} };`);
  await app.renderCrmToolMode(get(app, 'crmStudentsOfSection("S")'), get(app, `customToolById('${STATUS_ID}')`));
  assert.equal(log.filter(l => l.table === 'classroom_tool_marks' && l.op !== 'select').length, 0);
  assert.match(get(app, `document.getElementById('crmLessonSheetBody').innerHTML`), /markAllCrmToolDone/);
});

function taskForm(app, title, max){
  runInAppContext(app, `
    document.getElementById('crmTaskTitle').value = ${JSON.stringify(title)};
    document.getElementById('crmTaskDesc').value = '';
    document.getElementById('crmTaskMax').value = ${JSON.stringify(max)};
    document.getElementById('crmTaskDue').value = '';
    afterCrmTaskChanged = async () => {}; closeCrmModal = () => {}; showInfoModal = () => {};`);
}

test('مهمة جديدة والمهام من الكاملة — كل المكلَّفين يبدؤون بدرجة المهمة كاملة؛ وبالأصل بلا درجة', async () => {
  for(const full of [true, false]){
    const log = [];
    const app = appWith({}, log, full ? { sections: {}, tools: {}, startFull: { task: true } } : undefined);
    runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 }; showInfoModal = () => {};`);
    app.openCrmTaskModal();
    app.toggleCrmTaskPick('a'); app.toggleCrmTaskPick('b');
    taskForm(app, 'تقرير', '15');
    await app.saveCrmTask();
    const rows = log.find(l => l.table === 'classroom_task_students' && l.op === 'insert').values;
    assert.deepEqual([...rows].map(r => r.student_id + ':' + (r.score === undefined ? '-' : r.score)), full ? ['a:15', 'b:15'] : ['a:-', 'b:-']);
  }
});

test('تعديل مهمة والمهام من الكاملة — المضاف يأخذ الكاملة، وتغيير درجة المهمة ينقل أصحاب الكاملة (التخفيض قبل تحديث المهمة)', async () => {
  const log = [];
  const seed = {
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'تقرير', description: null, max_score: 20, due_date: null, shahid_id: null }],
    classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 20, group_no: null }],
  };
  const app = appWith(seed, log, { sections: {}, tools: {}, startFull: { task: true } });
  runInAppContext(app, `showInfoModal = () => {};`);
  await app.openCrmTaskEditor('T1');
  app.toggleCrmTaskPick('b');
  taskForm(app, 'تقرير', '10');
  await app.saveCrmTask();
  const writes = log.filter(l => l.op !== 'select');
  const move = writes.findIndex(l => l.table === 'classroom_task_students' && l.op === 'update' && l.values.score === 10);
  const taskUpd = writes.findIndex(l => l.table === 'classroom_tasks' && l.op === 'update');
  assert.ok(move !== -1 && move < taskUpd, 'نقل الكاملة قبل تخفيض درجة المهمة');
  assert.deepEqual(Object.fromEntries(writes[move].filters), { teacher_id: 'u1', task_id: 'T1', score: 20 });
  const add = writes.find(l => l.table === 'classroom_task_students' && l.op === 'upsert');
  assert.deepEqual([...add.values].map(r => r.student_id + ':' + r.score), ['b:10']);
});

test('تغيير "يبدأ من" للمهام — الكاملة: كل مكلَّف درجة مهمته (مهام الفصل في شعبي فقط)؛ و0: "لم يُقيَّم"', async () => {
  const task = (id, s, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: s, academic_year: TERM.year, semester: 1, max_score: max }, extra || {});
  const seed = { classroom_tasks: [task('T1', 'S', 10), task('T2', 'S2', 10), task('T3', 'S', 5), task('T9', 'S', 10, { academic_year: '1447-1448' }), task('TZ', 'Z', 10)] };
  const log = [];
  const app = appWith(seed, log);
  await app.setGradeStartMode('task', true);
  assert.match(get(app, 'window.__confirm[0]'), /يأخذ كل المكلَّفين الدرجة الكاملة في كل المهام/);
  const ups = log.filter(l => l.table === 'classroom_task_students' && l.op === 'update')
    .map(l => l.values.score + ':' + [...l.filters.find(([c]) => c === 'task_id')[1]].sort().join(','));
  assert.deepEqual(ups.sort(), ['10:T1,T2', '5:T3']);
  assert.ok(log.filter(l => l.op === 'update').every(l => l.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1')));
  assert.equal(get(app, 'gradeStartsFull("task")'), true);
  log.length = 0;
  await app.setGradeStartMode('task', false);
  const back = log.filter(l => l.table === 'classroom_task_students' && l.op === 'update');
  assert.deepEqual(back.map(l => l.values.score), [null]);
});

test('تغيير "يبدأ من" لأداة "حالة" — يُمسح رصدها، ومن الكاملة يأخذ كل طلاب الشعبة "تمّ" في كل حصة سبق رصدها', async () => {
  const m = (id, st, s, d, p, extra) => Object.assign({ id, teacher_id: 'u1', tool_id: STATUS_ID, student_id: st, section_id: s, academic_year: TERM.year, semester: 1, mark_date: d, period: p, value: 0 }, extra || {});
  const seed = { classroom_tool_marks: [m('m1', 'a', 'S', '2026-10-01', 1), m('m2', 'b', 'S', '2026-10-01', 1), m('m3', 'c', 'S2', '2026-10-02', 3), m('m9', 'a', 'S', '2026-09-01', 1, { academic_year: '1447-1448' })] };
  const log = [];
  const app = appWith(seed, log);
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true;`);
  await app.setGradeStartMode('tool:' + STATUS_ID, true);
  assert.match(get(app, 'window.__confirm[0]'), /"بحوث" تبدأ من الدرجة كاملة؟ يصير كل الطلاب "تمّ" في كل حصة رُصدت/);
  const del = log.find(l => l.table === 'classroom_tool_marks' && l.op === 'delete');
  assert.deepEqual([...del.filters.find(([c]) => c === 'id')[1]].sort(), ['m1', 'm2', 'm3']);
  const up = log.find(l => l.table === 'classroom_tool_marks' && l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => [r.student_id, r.section_id, r.mark_date, r.period, r.value].join(':')), ['a:S:2026-10-01:1:1', 'b:S:2026-10-01:1:1', 'c:S2:2026-10-02:3:1']);
  assert.equal(log.filter(l => l.table === 'classroom_grade_scores' && l.op !== 'select').length, 0, 'العمود المحسوب لا يُكتب مباشرة');
  log.length = 0;
  await app.setGradeStartMode('tool:' + STATUS_ID, false);
  assert.equal(log.filter(l => l.op === 'upsert').length, 0);
  assert.equal(get(app, 'gradeStartsFull("tool:' + STATUS_ID + '")'), false);
});

function stubResync(app){
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true; window.__resync = []; window.__busy = [];
    syncToolColumn = async (c, t, s) => { window.__resync.push('tool:' + c.id + ':' + s); };
    syncTaskColumn = async (c, s) => { window.__resync.push('task:' + c.id + ':' + s); };
    syncHomeworkColumn = async (c, s) => { window.__resync.push('hw:' + c.id + ':' + s); }; loadSectionHomework = async () => ({});
    setStartModeBusy = (k, on) => { window.__busy.push(k + ':' + on); };`);
}

test('سرعة تغيير "يبدأ من": أداة بلا رصد سابق — لا مسح ولا إعادة حساب ولا تحميل للكشف، والخيار يُحفظ', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('B', 'S', 'manual', 2, { tool_id: STATUS_ID }), col('B2', 'S2', 'manual', 2, { tool_id: STATUS_ID })], classroom_tool_marks: [] };
  const app = appWith(seed, log);
  stubResync(app);
  await app.setGradeStartMode('tool:' + STATUS_ID, true);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.deepEqual([...get(app, 'window.__resync')], []);
  assert.deepEqual([...get(app, 'window.__synced')], []);
  assert.equal(get(app, 'gradeStartsFull("tool:' + STATUS_ID + '")'), true);
  assert.equal(get(app, 'window.__saved'), 1);
});

test('سرعة تغيير "يبدأ من": أداة لها رصد — يُعاد حساب عمودها فقط في شعبي (لا كشف كامل)، و"جارٍ التطبيق" يظهر ثم يزول', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [col('B', 'S', 'manual', 2, { tool_id: STATUS_ID }), col('B2', 'S2', 'manual', 2, { tool_id: STATUS_ID }), col('BZ', 'Z', 'manual', 2, { tool_id: STATUS_ID }), col('P', 'S', 'participation', 10)],
    classroom_tool_marks: [{ id: 'm1', teacher_id: 'u1', tool_id: STATUS_ID, student_id: 'a', section_id: 'S', academic_year: TERM.year, semester: 1, mark_date: '2026-10-01', period: 1, value: 0 }]
  };
  const app = appWith(seed, log);
  stubResync(app);
  runInAppContext(app, `window.__answer = false;`);
  await app.setGradeStartMode('tool:' + STATUS_ID, true);
  assert.deepEqual([...get(app, 'window.__busy')], [], 'الإلغاء لا يظهر "جارٍ"');
  runInAppContext(app, `window.__answer = true;`);
  await app.setGradeStartMode('tool:' + STATUS_ID, true);
  assert.deepEqual([...get(app, 'window.__resync')].sort(), ['tool:B2:S2', 'tool:B:S']);
  assert.deepEqual([...get(app, 'window.__synced')], []);
  assert.deepEqual([...get(app, 'window.__busy')], ['tool:' + STATUS_ID + ':true', 'tool:' + STATUS_ID + ':false']);
});

test('"جارٍ التطبيق" يزول حتى لو فشل الحفظ', async () => {
  const app = appWith({ classroom_tool_marks: [] }, []);
  stubResync(app);
  runInAppContext(app, `saveAppFeatures = async () => { throw new Error('net'); };`);
  await app.setGradeStartMode('tool:' + STATUS_ID, true);
  assert.deepEqual([...get(app, 'window.__busy')].map(x => x.split(':').pop()), ['true', 'false']);
  assert.match(get(app, 'window.__toasts.join("|")'), /error:تعذّر/);
});

test('سرعة تغيير "يبدأ من": المهام — يُعاد حساب عمود المهام فقط في كل شعبة', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [col('K', 'S', 'task', 10), col('K2', 'S2', 'task', 10), col('H', 'S', 'homework', 10)],
    classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, max_score: 10 }]
  };
  const app = appWith(seed, log);
  stubResync(app);
  await app.setGradeStartMode('task', true);
  assert.deepEqual([...get(app, 'window.__resync')].sort(), ['task:K2:S2', 'task:K:S']);
});

test('setStartModeBusy — يعطّل زرّي الخيار ويظهر "جارٍ التطبيق" ثم يعيدهما', async () => {
  const app = loadApp();
  runInAppContext(app, `
    const btns = [{ disabled: false }, { disabled: false }], note = { textContent: '' };
    window.__el = { querySelectorAll: () => btns, querySelector: () => note, btns, note };
    document.querySelector = sel => sel === '[data-start-key="task"]' ? window.__el : null;`);
  app.setStartModeBusy('task', true);
  assert.deepEqual([...get(app, 'window.__el.btns.map(b => b.disabled)')], [true, true]);
  assert.match(get(app, 'window.__el.note.textContent'), /جارٍ التطبيق/);
  app.setStartModeBusy('task', false);
  assert.deepEqual([...get(app, 'window.__el.btns.map(b => b.disabled)')], [false, false]);
  assert.equal(get(app, 'window.__el.note.textContent'), '');
});

test('انحدار: Service Worker يجلب style.css من الشبكة أولًا (لا تنسيق قديم مع كود جديد)', async () => {
  const vm = require('node:vm');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sw.js'), 'utf8');
  const ctx = { self: { addEventListener(){}, location: { origin: 'https://x' } }, caches: {}, URL };
  vm.runInNewContext(src, ctx);
  assert.equal(ctx.isAppLogicRequest(new URL('https://x/style.css')), true);
  assert.equal(ctx.isAppLogicRequest(new URL('https://x/app/app-25-grade-weights.js')), true);
  assert.equal(ctx.isAppLogicRequest(new URL('https://x/icon-192.png')), false);
});
