'use strict';
/* ============================================================
   التعبئة الصريحة (بدل «يبدأ من الكاملة» الملغى — 3.61)
   - فتح ورقة الحصة/الكشف/حصة الأداة لا يكتب أي درجة، ولو بقي الإعداد القديم محفوظًا.
   - «من بلا درجة: أعطِه الكاملة/0» في المشاركة والعدّاد والحالة والدرجة والمهام: كأنه رصد يدوي، لا يمسّ من رُصد له.
   - الواجب/المهمة الجديدة: سؤال صريح عند الإنشاء (الجميع سلّم / الجميع الكاملة أو 0 / بلا رصد).
   - الفترة المقفلة: رسالة بلغة المعلم.
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
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve(opts.rpcError ? { data: null, error: opts.rpcError } : { data: opts.rpcValue !== undefined ? opts.rpcValue : 9, error: null }); },
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

const STATUS_ID = '22222222-3333-4444-5555-666666666666';
const SCORE_ID = '33333333-4444-5555-6666-777777777777';
const NEW_ID = '44444444-5555-6666-7777-888888888888';
const TOOLS = `[{ id: '${TOOL_ID}', name: 'قراءة', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false },
  { id: '${STATUS_ID}', name: 'بحوث', tool_type: 'status', category: 'performance', max_score: 2, hidden: false },
  { id: '${SCORE_ID}', name: 'شفهي', tool_type: 'score', category: 'performance', max_score: 4, hidden: false }]`;

const OLD_FULL = { sections: {}, tools: {}, startFull: { participation: true, homework: true, task: true, ['tool:' + TOOL_ID]: true } };

async function partSheet(scores, opts, features){
  const log = [];
  const seed = { classroom_grade_columns: [col('P', 'S', 'participation', 10)], classroom_grade_scores: scores || [] };
  const app = appWith(seed, log, features || OLD_FULL, opts);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 1, token: 1, mode: 'participation', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}
const sheetBody = app => get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
const writes = log => log.filter(l => (l.op === 'rpc' && l.name !== 'increment_period_score') || (l.op && l.op !== 'select' && l.op !== 'rpc'));

test('انحدار: الإعداد القديم المحفوظ لا يعمل — فتح ورقة المشاركة لا يكتب أي درجة، والنقرة +1 عادية', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6 }]);
  assert.equal(get(app, 'gradeStartsFull("participation")'), false);
  assert.deepEqual(writes(log), [], 'لا كتابة عند الفتح');
  assert.equal(get(app, 'crmSheet.part.scores.has("b")'), false, 'الفارغ يبقى فارغًا');
  assert.equal(get(app, 'crmSheet.part.step'), 1);
  assert.doesNotMatch(sheetBody(app), /تبدأ الدرجة كاملة/);
});

test('المشاركة: بطاقة الورقة — «رُصد 1 من 2» وزر «تعبئة الطالب الباقي» يفتح اختيارًا (الكاملة / 0) ثم «تأكيد»: لمن لا درجة له فقط، والإلغاء لا يكتب', async () => {
  const { app, log } = await partSheet([{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6 }], { rpcValue: 10 });
  const el = id => get(app, `document.getElementById('${id}').innerHTML`);
  assert.match(sheetBody(app), /id="crmSheetCard"[\s\S]*onclick="toggleCrmSheetHelp\(\)">؟/);
  assert.doesNotMatch(sheetBody(app), /crm-fill-row|يزيد درجة و/, 'لا نصوص دائمة ولا سطر تعبئة');
  assert.match(el('crmCardCount'), /رُصد<\/small> 1 <small>من 2/);
  assert.match(el('crmCardFill'), /onclick="openCrmFillPanel\(\)">تعبئة الطالب الباقي</);
  app.openCrmFillPanel();
  assert.match(el('crmFillPanel'), /طالب واحد بلا درجة — أعطِه:[\s\S]*الدرجة كاملة \(10\)[\s\S]*>0<[\s\S]*confirmCrmFill\(\)">تأكيد[\s\S]*closeCrmFillPanel\(\)">إلغاء[\s\S]*من له درجة لا يتغيّر/);
  app.closeCrmFillPanel();
  assert.deepEqual(writes(log), [], 'الإلغاء لا يكتب');
  app.openCrmFillPanel();
  app.pickCrmFill(0);
  await app.confirmCrmFill();
  assert.equal(get(app, 'window.__confirm.length'), 0, 'التأكيد في اللوحة نفسها (لا سؤال ثانٍ)');
  const fills = log.filter(l => l.op === 'rpc' && l.name === 'set_period_score');
  assert.deepEqual(fills.map(l => JSON.parse(JSON.stringify(l.args))), [{ p_column_id: 'P', p_student_id: 'b', p_period: 1, p_score: 10, p_only_missing: true }]);
  assert.equal(get(app, 'crmSheet.part.scores.get("b")'), 10);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 6, 'من له درجة لم يتغيّر');
  assert.match(el('crmCardCount'), /رُصد<\/small> 2 <small>من 2<\/small> <small class="csc-ok">✓/);
  assert.equal(el('crmCardFill'), '', 'رُصد للجميع: لا زر');
  app.toggleCrmSheetHelp();
  assert.match(el('crmSheetHelp'), /كيف تعمل هذه الورقة؟[\s\S]*يزيد درجة[\s\S]*الدرجة من <b>10<\/b>[\s\S]*لا تغيّر من له درجة/);
  /* النداء المباشر (بلا لوحة) ما زال يسأل */
  runInAppContext(app, 'window.__answer = false; crmSheet.part.scores.delete("b");');
  await app.fillCrmParticipationEmpty(0);
  assert.equal(get(app, 'window.__confirm.length'), 1);
});

test('المشاركة: التعبئة في فترة مقفلة — رسالة واضحة ولا تُعرض قيمة لم تُحفظ', async () => {
  const { app } = await partSheet([], { rpcError: { message: 'grade_period_locked' } });
  runInAppContext(app, 'window.__answer = true; markCrmSheetFailure = () => {}; setCrmSheetMode = () => {};');
  await app.fillCrmParticipationEmpty(0);
  assert.match(get(app, 'window.__toasts.join("|")'), /error:تعذّر الحفظ: الفترة مقفلة — افتحها للتعديل من نافذة الفترات/);
  assert.equal(get(app, 'crmSheet.part.scores.size'), 0);
});

async function toolSheet(toolId, marks){
  const log = [];
  const seed = { classroom_grade_columns: [col('B', 'S', 'manual', 2, { tool_id: toolId })], classroom_tool_marks: marks || [], classroom_grade_scores: [] };
  const app = appWith(seed, log, OLD_FULL);
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true; appSectionOn = () => true; window.__toolSync = [];
    syncToolColumn = async (c, t, s, term, ids) => { window.__toolSync.push([...ids].join(',')); };
    crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 2, token: 1, mode: 'tool:${toolId}', states: {} };`);
  await app.renderCrmToolMode(get(app, 'crmStudentsOfSection("S")'), get(app, `customToolById('${toolId}')`));
  return { app, log };
}

test('أداة «حالة»: فتح الحصة لا يكتب، والتعبئة (تمّ / لم يتمّ) لمن لم يُرصد فقط وبلا كتابة فوق رصد متزامن', async () => {
  const { app, log } = await toolSheet(STATUS_ID, [{ teacher_id: 'u1', tool_id: STATUS_ID, student_id: 'a', section_id: 'S', mark_date: '2026-10-19', period: 2, value: 1 }]);
  assert.equal(log.filter(l => l.table === 'classroom_tool_marks' && l.op !== 'select').length, 0, 'لا كتابة عند الفتح');
  assert.match(get(app, `document.getElementById('crmCardCount').innerHTML`), /رُصد<\/small> 1 <small>من 2/);
  app.openCrmFillPanel();
  assert.match(get(app, `document.getElementById('crmFillPanel').innerHTML`), /طالب واحد بلا رصد — أعطِه:[\s\S]*>تمّ<[\s\S]*>لم يتمّ</);
  app.pickCrmFill(1);
  await app.confirmCrmFill();
  const up = log.find(l => l.op === 'upsert' && l.table === 'classroom_tool_marks');
  assert.deepEqual([...up.values].map(r => [r.student_id, r.value, r.teacher_id, r.mark_date, r.period].join(':')), ['b:0:u1:2026-10-19:2']);
  assert.equal(up.options.ignoreDuplicates, true);
  assert.equal(get(app, 'crmSheet.tool.values.get("a")'), 1, 'من رُصد له لم يتغيّر');
  assert.deepEqual([...get(app, 'window.__toolSync')], ['b']);
  await app.fillCrmToolEmpty(7);
  assert.equal(log.filter(l => l.op === 'upsert').length, 1, 'قيمة غير صالحة للحالة لا تُكتب');
});

test('أداة «درجة»: التعبئة بالكاملة أو 0', async () => {
  const { app, log } = await toolSheet(SCORE_ID, []);
  assert.match(get(app, `document.getElementById('crmCardFill').innerHTML`), /تعبئة الـ2 الباقين/);
  app.openCrmFillPanel();
  assert.match(get(app, `document.getElementById('crmFillPanel').innerHTML`), /طالبان بلا درجة — أعطِهم:[\s\S]*الدرجة كاملة \(4\)[\s\S]*>0</);
  await app.confirmCrmFill();
  const up = log.find(l => l.op === 'upsert' && l.table === 'classroom_tool_marks');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.value), ['a:4', 'b:4']);
});

function hwApp(start){
  const log = [];
  const app = appWith({}, log, OLD_FULL);
  runInAppContext(app, `afterCrmHomeworkChanged = async () => {}; closeCrmModal = () => {};
    { const _g = document.getElementById; document.getElementById = id => id === 'crmHwTitle' ? { value: 'تمارين' } : id === 'crmHwDue' ? { value: '2026-10-25' } : _g(id); }`);
  app.openCrmHomeworkModal('S');
  if(start) app.setCrmHwStart(true);
  return { app, log };
}

test('واجب جديد: يبدأ «لم يُرصد» ولو بقي الإعداد القديم؛ و«الجميع سلّم» باختيار صريح عند الإنشاء', async () => {
  const a = hwApp(false);
  await a.app.saveCrmHomework();
  assert.equal(a.log.filter(l => l.table === 'classroom_homework_status' && l.op !== 'select').length, 0);
  const b = hwApp(true);
  await b.app.saveCrmHomework();
  const up = b.log.find(l => l.table === 'classroom_homework_status' && l.op === 'upsert');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.status + ':' + r.teacher_id), ['a:submitted:u1', 'b:submitted:u1']);
});

test('نموذج الواجب: السؤال في الإنشاء فقط', () => {
  const app = loadApp();
  runInAppContext(app, `crmSectionLabel = () => 'ش'; crmSheet = null;`);
  assert.match(app.crmHomeworkFormHtml('S', null), /يبدأ الطلاب[\s\S]*onclick="setCrmHwStart\(false\)">لم يُرصد[\s\S]*onclick="setCrmHwStart\(true\)">الجميع سلّم/);
  assert.doesNotMatch(app.crmHomeworkFormHtml('S', { id: 'h1', title: 'x', due_date: '2026-10-10' }), /يبدأ الطلاب/);
});

function taskForm(app, title, max){
  runInAppContext(app, `
    document.getElementById('crmTaskTitle').value = ${JSON.stringify(title)};
    document.getElementById('crmTaskDesc').value = '';
    document.getElementById('crmTaskMax').value = ${JSON.stringify(max)};
    document.getElementById('crmTaskDue').value = '';
    afterCrmTaskChanged = async () => {}; closeCrmModal = () => {}; showInfoModal = () => {};`);
}

test('مهمة جديدة: «بلا تقييم» هو الأصل (ولو بقي الإعداد القديم)، و«الجميع الكاملة / 0» باختيار صريح', async () => {
  for(const [start, want] of [[null, ['a:-', 'b:-']], ['full', ['a:15', 'b:15']], ['zero', ['a:0', 'b:0']]]){
    const log = [];
    const app = appWith({}, log, OLD_FULL);
    runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1 }; showInfoModal = () => {};`);
    app.openCrmTaskModal();
    if(start) app.setCrmTaskStart(start);
    app.toggleCrmTaskPick('a'); app.toggleCrmTaskPick('b');
    taskForm(app, 'تقرير', '15');
    await app.saveCrmTask();
    const rows = log.find(l => l.table === 'classroom_task_students' && l.op === 'insert').values;
    assert.deepEqual([...rows].map(r => r.student_id + ':' + (r.score === undefined ? '-' : r.score)), want, String(start));
  }
});

test('المهام: «من لم يُقيَّم: أعطِه الكاملة / 0» لغير المقيَّمين فقط، بمسار الرصد الفردي', async () => {
  const log = [];
  const app = appWith({ classroom_task_students: [] }, log, OLD_FULL);
  runInAppContext(app, `crmSheet = { sectionId: 'S', mode: 'task', token: 1, task: { selectedId: 'T1', queue: new Map(), scores: new Map([['a', 7], ['b', null]]),
      data: { tasks: [{ id: 'T1', max_score: 10 }], rows: [] }, column: null, term: ${JSON.stringify(TERM)} } };
    crmSelectedTask = () => ({ id: 'T1', max_score: 10 }); paintCrmTaskAll = () => {}; paintCrmTaskCounts = () => {};
    window.__persist = []; persistCrmTaskScores = (ids, score, prev) => { window.__persist.push([...ids].join(',') + ':' + score + ':' + [...prev.values()].join(',')); };`);
  app.fillCrmTaskEmpty(10);
  assert.deepEqual([...get(app, 'window.__persist')], ['b:10:']);
  assert.equal(get(app, 'crmSheet.task.scores.get("a")'), 7);
  app.fillCrmTaskEmpty(11);
  assert.equal(get(app, 'window.__persist.length'), 1, 'فوق درجة المهمة لا يُكتب');
});

/* ============ بطاقة الورقة في الواجب والمهام (3.64) ============ */
const HW_CARD_SEED = () => ({
  classroom_homework: [{ id: 'H', teacher_id: 'u1', section_id: 'S', title: 'تمارين', due_date: '2026-10-05', academic_year: TERM.year, semester: 1 }],
  classroom_homework_status: [{ teacher_id: 'u1', homework_id: 'H', student_id: 'a', status: 'late' }],
  classroom_grade_columns: [], classroom_grade_scores: [] });
async function hwSheet(code){
  const log = [];
  const app = appWith(HW_CARD_SEED(), log, { sections: {}, tools: {} });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-06', period: 1, token: 1, mode: 'homework', states: {} }; ${code || ''}`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}
const elHtml = (app, id) => get(app, `document.getElementById('${id}').innerHTML`);

test('الواجب: البطاقة «سلّم 1 من 2» وتفصيل الحالات، و«تعبئة الطالب الباقي» يختار الحالة (سلّم/متأخر/ناقص) ولا يكتب فوق رصد', async () => {
  const { app, log } = await hwSheet();
  const body = sheetBody(app);
  assert.match(body, /id="crmSheetCard"[\s\S]*toggleCrmSheetHelp/);
  assert.doesNotMatch(body, /markAllCrmHomeworkSubmitted\(\)|الأصل "لم يسلّم"/, 'لا زر «الكل سلّم» ولا نص دائم');
  assert.match(elHtml(app, 'crmCardCount'), /سلّم<\/small> 1 <small>من 2/);
  assert.equal(get(app, `document.getElementById('crmHwCounts').textContent`), 'متأخر 1 · لم يسلّم 1');
  app.openCrmFillPanel();
  assert.match(elHtml(app, 'crmFillPanel'), /طالب واحد «لم يسلّم» — اجعله:[\s\S]*>سلّم<[\s\S]*>متأخر<[\s\S]*>ناقص<[\s\S]*من رُصد له لا يتغيّر/);
  app.pickCrmFill(1);
  await app.confirmCrmFill();
  const up = log.find(l => l.op === 'upsert' && l.table === 'classroom_homework_status');
  assert.deepEqual([...up.values].map(r => r.student_id + ':' + r.status + ':' + r.teacher_id), ['b:late:u1']);
  assert.equal(up.options.ignoreDuplicates, true);
  assert.equal(get(app, 'crmSheet.hw.statuses.get("a")'), 'late');
  assert.equal(elHtml(app, 'crmCardFill'), '', 'رُصد للجميع');
  await app.markAllCrmHomeworkSubmitted('missing');
  assert.equal(log.filter(l => l.op === 'upsert').length, 1, '«لم يسلّم» ليست تعبئة');
});

test('الواجب في فترة مقفلة (بموعده): شريط القفل، ولا تعبئة، والنقر لا يكتب', async () => {
  const { app, log } = await hwSheet(`gradePeriodLocks = { '${TERM.year}|1': { 'kind:homework': { p: 1, before: '2026-10-10' } } };`);
  assert.match(sheetBody(app), /🔒[\s\S]*مقفلة/);
  assert.equal(elHtml(app, 'crmCardFill'), '');
  app.tapCrmHomework('b');
  await app.markAllCrmHomeworkSubmitted('submitted');
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.match(get(app, 'window.__toasts.join()'), /الفترة مقفلة/);
});

test('المهام: البطاقة «قُيّم 1 من 2»، والتعبئة لمن لم يُقيَّم فقط بالكاملة أو 0', async () => {
  const log = [];
  const seed = { classroom_tasks: [{ id: 'T1', teacher_id: 'u1', section_id: 'S', title: 'تقرير', max_score: 10, academic_year: TERM.year, semester: 1, created_at: '2026-10-01T08:00:00Z', due_date: null }],
    classroom_task_students: [{ teacher_id: 'u1', task_id: 'T1', student_id: 'a', score: 8 }, { teacher_id: 'u1', task_id: 'T1', student_id: 'b', score: null }],
    classroom_grade_columns: [], classroom_grade_scores: [] };
  const app = appWith(seed, log, { sections: {}, tools: {} });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-06', period: 1, token: 1, mode: 'task', states: {} };`);
  await app.renderCrmTasks(get(app, 'crmStudentsOfSection("S")'));
  assert.doesNotMatch(sheetBody(app), /crm-fill-row|اضغط على الطالب لرصد درجته/);
  assert.match(elHtml(app, 'crmCardCount'), /قُيّم<\/small> 1 <small>من 2/);
  app.openCrmFillPanel();
  assert.match(elHtml(app, 'crmFillPanel'), /طالب واحد لم يُقيَّم — أعطِه:[\s\S]*الدرجة كاملة \(10\)[\s\S]*>0<[\s\S]*من قُيّم لا يتغيّر/);
  await app.confirmCrmFill();
  await get(app, 'Promise.all([...crmSheet.task.queue.values()])');
  const upd = log.find(l => l.op === 'update' && l.table === 'classroom_task_students');
  assert.deepEqual({ ...upd.values }, { score: 10 });
  assert.deepEqual(Object.fromEntries(upd.filters), { teacher_id: 'u1', task_id: 'T1', student_id: 'b' });
  assert.equal(get(app, 'crmSheet.task.scores.get("a")'), 8);
  app.toggleCrmSheetHelp();
  assert.match(elHtml(app, 'crmSheetHelp'), /اضغط على الطالب لرصد درجته من <b>10<\/b>/);
});

test('الواجب: القائمة بطاقات مجمّعة بالفترة — الجارية مفتوحة، والمنتهية مطوية بعددها، والعنوان مهرَّب، و«سلّم X من Y» لكل واجب', async () => {
  const seed = HW_CARD_SEED();
  seed.classroom_homework.push(
    { id: 'H0', teacher_id: 'u1', section_id: 'S', title: '<img src=x onerror=alert(1)>', due_date: '2026-09-20', academic_year: TERM.year, semester: 1 },
    { id: 'H2', teacher_id: 'u1', section_id: 'S', title: 'واجب ثانٍ', due_date: '2026-10-06', academic_year: TERM.year, semester: 1 });
  const log = [];
  const app = appWith(seed, log, { sections: {}, tools: {}, periods: { [TERM.year + '|1']: { 'kind:homework': { n: 2, starts: ['2026-10-01'] } } } });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-06', period: 1, token: 1, mode: 'homework', states: {} }; crmHwOpenPeriods = null;`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  let body = sheetBody(app);
  assert.match(body, /الفترة الثانية · جارية[\s\S]*openCrmHomeworkModal\(\)[\s\S]*class="hwc is-on"[\s\S]*selectCrmHomework\('H2'\)[\s\S]*واجب ثانٍ[\s\S]*سلّم 0 من 2[\s\S]*selectCrmHomework\('H'\)[\s\S]*سلّم 1 من 2/);
  assert.match(body, /toggleCrmHwPeriod\(1\)[^>]*><span>الفترة الأولى · واجب واحد<\/span><span>◂/, 'المنتهية مطوية');
  assert.doesNotMatch(body, /selectCrmHomework\('H0'\)/);
  assert.doesNotMatch(body, /<select/, 'لا قائمة منسدلة');
  app.toggleCrmHwPeriod(1);
  await new Promise(r => setTimeout(r, 0));
  body = sheetBody(app);
  assert.match(body, /selectCrmHomework\('H0'\)/);
  assert.doesNotMatch(body, /<img src=x/, 'العنوان مهرَّب');
  app.selectCrmHomework('H');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(get(app, 'crmSheet.hw.selectedId'), 'H');
  assert.match(sheetBody(app), /class="hwc is-on"[^>]*onclick="selectCrmHomework\('H'\)"[\s\S]*openCrmHomeworkEditor\('H'\)/);
  app.tapCrmHomework('b');
  assert.equal(get(app, `document.getElementById('crmHwSelCount').textContent`), 'سلّم 2 من 2', 'تتحدّث فورًا');
});
