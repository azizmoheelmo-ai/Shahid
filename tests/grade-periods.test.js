'use strict';
/* ============================================================
   الفترات لكل مكوّن (app-27) + أقسام "إعداد الدرجات" المطوية
   - الأصل فترة واحدة لكل مكوّن؛ المعلم يختار لأي مكوّن ٢ أو ٣ فترات، وينتقل
     للفترة التالية بزر (لا تقويم ولا تاريخ يُعرض).
   - المرصود مباشرة (المشاركة/العدّاد/اليدوي): درجة لكل فترة، والقاعدة تكتب
     في الكشف معدّل ما رُصد. الرصد القديم بلا فترات = الأولى.
   - المحسوب (الواجبات/المهام/الحالة والدرجة): كل رصد في فترة تاريخه،
     والعمود = معدّل الفترات.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const TK = '1448-1449|1';
const TOOL_ID = '11111111-2222-3333-4444-555555555555';
const STATUS_ID = '22222222-3333-4444-5555-666666666666';
const WEEKS = [];
const OFF = { sections: {}, tools: {} };
const withPeriods = (cfg, extra) => Object.assign({ sections: {}, tools: {}, periods: { [TK]: cfg } }, extra || {});
const PART2 = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-25'] } });

function fakeClient(seed, log, rpcValues){
  const match = (rows, f) => (rows || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
  return {
    from(table){
      const f = []; let op = 'select', values = null, options = null, single = false;
      const result = () => {
        if(op !== 'select'){
          log.push({ table, op, values, options, filters: f.slice() });
          if(op === 'update'){ match(seed[table], f).forEach(r => Object.assign(r, values)); }
          return { data: op === 'insert' ? [{ id: 'NEW' }] : null, error: null };
        }
        const rows = match(seed[table], f);
        log.push({ table, op: 'select', filters: f.slice() });
        return { data: single ? rows[0] || null : rows, error: null };
      };
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; },
        insert(r){ op = 'insert'; values = r; return api; }, upsert(r, o){ op = 'upsert'; values = r; options = o; return api; },
        update(r){ op = 'update'; values = r; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return Promise.resolve(result()); }, maybeSingle(){ single = true; return Promise.resolve(result()); },
        then(res, rej){ return Promise.resolve(result()).then(res, rej); } };
      return api;
    },
    rpc(name, args){ log.push({ op: 'rpc', name, args }); return Promise.resolve({ data: (rpcValues || {})[name] !== undefined ? rpcValues[name] : 7, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
}

function appWith(seed, log, features, extra){
  const client = fakeClient(Object.assign({ academic_calendar_weeks: WEEKS, academic_calendar_holidays: [] }, seed || {}), log || [], extra && extra.rpc);
  const app = loadApp({ supabaseClient: extra && extra.wrap ? extra.wrap(client) : client, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__saved = 0; saveAppFeatures = async () => { window.__saved++; }; afterAppFeaturesChanged = () => {};
    afterCrmGradesChanged = () => {}; showInfoModal = h => { window.__modal = h; }; closeCrmModal = () => {};
    crmCurrentTerm = () => (${JSON.stringify(TERM)}); crmSectionLabel = () => 'ش';
    crmSections = [{ id: 'S' }];
    crmStudents = [{ id: 'a', full_name: 'أحمد', section_id: 'S' }, { id: 'b', full_name: 'بدر', section_id: 'S' }, { id: 'c', full_name: 'جابر', section_id: 'S' }];
    calendarRegion = null;
    appFeatures = ${JSON.stringify(features || { sections: {}, tools: {} })};
    ${(extra && extra.code) || ''}`);
  return app;
}
const get = (app, e) => runInAppContext(app, e);
const col = (id, kind, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'performance', kind, tool_id: null, name: { participation: 'مشاركة', homework: 'واجبات', task: 'مهام أدائية' }[kind] || 'يدوي', max_score: max }, extra || {});
const TOOLS = `[{ id: '${TOOL_ID}', name: 'قراءة', tool_type: 'counter', category: 'performance', max_score: 5, hidden: false },
  { id: '${STATUS_ID}', name: 'بحوث', tool_type: 'status', category: 'performance', max_score: 2, hidden: false }]`;
const TODAY = `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-27'; }`;

/* ============ دوال صرفة ============ */
test('periodOfDateFor / currentPeriodOf — الفترة = ١ + ما بدأ في يومها أو قبله', () => {
  const app = loadApp();
  assert.equal(app.periodOfDateFor('2026-10-24', ['2026-10-25']), 1);
  assert.equal(app.periodOfDateFor('2026-10-25', ['2026-10-25']), 2);
  assert.equal(app.periodOfDateFor('2026-12-01', ['2026-10-25', '2026-11-20']), 3);
  assert.equal(app.periodOfDateFor('2026-12-01', []), 1);
  assert.equal(app.currentPeriodOf({ n: 3, starts: ['2026-10-25'] }), 2);
  assert.equal(app.currentPeriodOf({ n: 1, starts: [] }), 1);
});

test('normalizeFeatures — إعداد فترات صالح لكل مكوّن فقط، والقيمة القديمة (1.5) = المشاركة والواجبات بفترتين', () => {
  const app = loadApp();
  const out = JSON.parse(JSON.stringify(app.normalizeFeatures({ periods: {
    [TK]: { 'kind:participation': { n: 3, starts: ['2026-11-20', '2026-10-25', 'x'] }, 'kind:homework': { n: 1 }, ['tool:' + TOOL_ID]: { n: 2 }, 'name:بحث': { n: 2, starts: ['2026-10-01', '2026-10-02'] }, 'evil': { n: 2 }, 'kind:task': { n: 5 } },
    '1448-1449|2': 'later', 'x|9': { 'kind:task': { n: 2 } } } }).periods));
  assert.deepEqual(out[TK], { 'kind:participation': { n: 3, starts: ['2026-10-25', '2026-11-20'] }, ['tool:' + TOOL_ID]: { n: 2, starts: [] }, 'name:بحث': { n: 2, starts: ['2026-10-01'] } });
  assert.deepEqual(out['1448-1449|2'], { 'kind:participation': { n: 2, starts: [] }, 'kind:homework': { n: 2, starts: [] } });
  assert.equal(out['x|9'], undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(app.normalizeFeatures({ periods: { [TK]: '2026-10-25' } }).periods[TK]['kind:homework'])), { n: 2, starts: ['2026-10-25'] });
  assert.equal(app.normalizeFeatures({}).periods, undefined);
});

test('periodCompKeyOfColumn — هوية المكوّن كما في إعداد الدرجات، والاختبارات بلا فترات', () => {
  const app = loadApp();
  assert.equal(app.periodCompKeyOfColumn(col('P', 'participation', 10)), 'kind:participation');
  assert.equal(app.periodCompKeyOfColumn(col('R', 'manual', 5, { tool_id: TOOL_ID })), 'tool:' + TOOL_ID);
  assert.equal(app.periodCompKeyOfColumn(col('M', 'manual', 5, { name: 'بحث  علمي' })), 'name:بحث علمي');
  assert.equal(app.periodCompKeyOfColumn(col('T', 'manual', 20, { category: 'tests' })), null);
});

test('انحدار: currentPeriodScores — الرصد القديم بلا فترات هو الأولى، ولا يظهر في فترة لاحقة', () => {
  const app = loadApp();
  const main = new Map([['a', 9], ['b', 6]]);
  const rows = [{ student_id: 'b', period: 1, score: 6 }, { student_id: 'b', period: 3, score: 3 }];
  assert.deepEqual([...app.currentPeriodScores(main, rows, 1)].sort(), [['a', 9], ['b', 6]]);
  assert.deepEqual([...app.currentPeriodScores(main, rows, 3)], [['b', 3]]);
  assert.deepEqual([...app.currentPeriodScores(main, rows, 2)], []);
});

test('participationPeriodBreakdown و periodAverage — حتى ٣ فترات، ومعدّل ما رُصد', () => {
  const app = loadApp();
  const b = app.participationPeriodBreakdown(new Map([['a', 9], ['b', 6]]), [{ student_id: 'b', period: 1, score: 9 }, { student_id: 'b', period: 3, score: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(b.get('a'))), { p1: 9, p2: null, p3: null });
  assert.deepEqual(JSON.parse(JSON.stringify(b.get('b'))), { p1: 9, p2: null, p3: 3 });
  assert.equal(app.periodAverage(9, 4), 6.5);
  assert.equal(app.periodAverage(9, null, 6), 7.5);
  assert.equal(app.periodAverage([10, 5, 6]), 7);
  assert.equal(app.periodAverage(null, null), null);
});

test('المحسوب بالفترات — الواجبات والمهام والحالة: كل رصد في فترة تاريخه، والنهائي = معدّل الفترات؛ وبفترة واحدة كالسابق تمامًا', () => {
  const app = loadApp();
  const hws = [{ id: 'h0', due_date: '2026-09-20' }, { id: 'h1', due_date: '2026-10-01' }, { id: 'h2', due_date: '2026-10-27' }, { id: 'h3', due_date: '2026-11-25' }];
  const idx = app.homeworkStatusIndex([{ homework_id: 'h0', student_id: 'a', status: 'submitted' }, { homework_id: 'h1', student_id: 'a', status: 'submitted' }, { homework_id: 'h3', student_id: 'a', status: 'partial' }]);
  const r = app.homeworkPeriodScores(hws, idx, 'a', 10, ['2026-10-25', '2026-11-20']);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { p1: 10, p2: 0, p3: 5, final: 5 });
  assert.equal(app.homeworkPeriodScores(hws, idx, 'a', 10, []).final, app.homeworkScoreFor(hws, idx, 'a', 10), 'بلا فترات = الحساب القديم تمامًا');
  const plan = app.planHomeworkScoreSync(['a'], hws, idx, 10, new Map([['a', 6.25]]), ['2026-10-25', '2026-11-20']);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.upserts)), [{ student_id: 'a', score: 5 }]);
  /* المهام: الموعد، وإلا يوم الإنشاء */
  const tasks = [{ id: 't1', max_score: 10, due_date: '2026-10-01' }, { id: 't2', max_score: 10, due_date: null, created_at: '2026-10-30T08:00:00Z' }];
  const rows = [{ task_id: 't1', student_id: 'a', score: 10 }, { task_id: 't2', student_id: 'a', score: 5 }];
  assert.deepEqual(JSON.parse(JSON.stringify(app.taskPeriodScores(tasks, rows, 'a', 20, ['2026-10-25']))), { p1: 20, p2: 10, p3: null, final: 15 });
  assert.equal(app.taskPeriodScores(tasks, rows, 'a', 20, []).final, app.taskColumnScoreFor(tasks, rows, 'a', 20));
  /* أداة الحالة: تاريخ الرصد */
  const marks = [{ value: 1, mark_date: '2026-10-01' }, { value: 1, mark_date: '2026-10-05' }, { value: 0, mark_date: '2026-10-27' }];
  assert.deepEqual(JSON.parse(JSON.stringify(app.toolPeriodScores({ tool_type: 'status' }, marks, 4, ['2026-10-25']))), { p1: 4, p2: 0, p3: null, final: 2 });
});

/* ============ ورقة الحصة ============ */
async function partSheet(dateIso, seed, features, extra){
  const log = [];
  const app = appWith(Object.assign({ classroom_grade_columns: [col('P', 'participation', 10)] }, seed), log, features, extra);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '${dateIso}', period: 1, token: 1, mode: 'participation', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}
const sheetHtml = app => get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);

test('المشاركة بفترتين — الشارة "الفترة الثانية من 2"، ودرجة الفترة لا معدّل الكشف، والنقرة على الثانية', async () => {
  const seed = {
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 5 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 6 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 2, score: 4 },
      { teacher_id: 'u2', column_id: 'P', student_id: 'c', period: 2, score: 9 }],
  };
  const { app, log } = await partSheet('2026-10-27', seed, PART2, { rpc: { increment_period_score: 1 } });
  assert.match(sheetHtml(app), /class="crm-period-chip is-p2" onclick="openCrmPeriodPicker\(\)"[^>]*>📅 الفترة الثانية من 2 ▾</);
  assert.match(sheetHtml(app), /الرصد في <b>الفترة الثانية<\/b>/);
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.equal(get(app, 'crmSheet.part.scores.get("b")'), 4);
  assert.equal(get(app, 'crmSheet.part.scores.has("a")'), false, 'رصد أحمد القديم للأولى');
  assert.equal(get(app, 'crmSheet.part.scores.has("c")'), false, 'رصد معلم آخر لا يُقرأ');
  const sel = log.find(l => l.table === 'classroom_grade_period_scores' && l.op === 'select');
  assert.ok(sel.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'), 'فلترة صريحة بالمعلم الحالي');
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  const rpc = log.find(l => l.op === 'rpc');
  assert.equal(rpc.name, 'increment_period_score');
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.args)), { p_column_id: 'P', p_student_id: 'a', p_period: 2, p_delta: 1, p_full: false });
  assert.match(app.participationTodayKey(get(app, 'crmSheet'), null, 2), /:p2:/, 'سجل نقرات كل فترة مستقل');
});

test('انحدار: الأصل فترة واحدة — لا شارة ولا انتقال، والرصد في الأولى بدرجة فترة', async () => {
  const seed = { classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }], classroom_grade_period_scores: [] };
  const { app, log } = await partSheet('2026-11-15', seed, OFF);
  assert.doesNotMatch(sheetHtml(app), /crm-period-chip|الفترة/);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(log.find(l => l.op === 'rpc').args.p_period, 1);
});

test('ثلاث فترات — حصة قديمة تُرصد في فترتها بتاريخها، والشارة "الفترة الثالثة من 3" للحصة الحالية', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-01', '2026-10-20'] } });
  const old = await partSheet('2026-10-05', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f);
  assert.equal(get(old.app, 'crmSheet.part.period'), 2);
  const now = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f);
  assert.match(sheetHtml(now.app), /📅 الفترة الثالثة من 3 ▾/);
});

test('الفترات لكل مكوّن — المشاركة بفترتين لا تجعل عدّاد "قراءة" بفترتين؛ والعدّاد بفترات يُرصد بدرجة فترة', async () => {
  const run = async features => {
    const log = [];
    const app = appWith({ classroom_grade_scores: [], classroom_grade_period_scores: [] }, log, features,
      { code: `ensureToolColumn = async () => ({ column: { id: 'T', name: 'قراءة', max_score: 5 } }); crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true;` });
    runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'tool:${TOOL_ID}', states: {} };`);
    await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'), { id: TOOL_ID, name: 'قراءة', max_score: 5 });
    app.tapCrmParticipation('a', 1);
    await get(app, 'crmSheet.part.queue.get("a")');
    return { app, rpc: log.find(l => l.op === 'rpc') };
  };
  const a = await run(PART2);
  assert.doesNotMatch(sheetHtml(a.app), /crm-period-chip/);
  assert.equal(a.rpc.name, 'increment_period_score');
  assert.equal(a.rpc.args.p_period, 1);
  const b = await run(withPeriods({ ['tool:' + TOOL_ID]: { n: 2, starts: ['2026-10-25'] } }));
  assert.match(sheetHtml(b.app), /📅 الفترة الثانية من 2/);
  assert.equal(b.rpc.args.p_period, 2);
});

test('شارة الفترة تفتح نافذة «الفترات» (3.61) — لا اختيار فترة سابقة بنقرة، ولا تواريخ داخل الحصة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const { app, log } = await partSheet('2026-10-26', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f, { code: TODAY });
  app.openCrmPeriodPicker();
  await new Promise(r => setTimeout(r, 0));
  const modal = get(app, 'window.__modal');
  assert.match(modal, /فترات «المشاركة»[\s\S]*الفترة الأولى[\s\S]*منتهية — غير مقفلة[\s\S]*الفترة الثانية[\s\S]*جارية[\s\S]*الفترة الثالثة[\s\S]*لم تبدأ/);
  assert.match(modal, /openPeriodTransition\(\)">أنهِ الفترة الثانية وأقفلها ← ابدأ الفترة الثالثة/);
  assert.match(modal, /lockNextEndedPeriod\(\)">🔒 أقفلها/, 'المنتهية غير المقفلة: زر قفل');
  assert.doesNotMatch(modal, /pickCrmPeriod|goToComponentPeriod\('kind:participation', 1\)/, 'لا رجوع بنقرة');
  assert.equal(get(app, 'typeof pickCrmPeriod'), 'undefined');
  assert.equal(log.filter(l => l.op !== 'select').length, 0, 'فتح النافذة لا يكتب شيئًا');
});

test('انحدار: الانتقال من النافذة أثناء إغلاق الورقة لا يعيد رسم ورقة أخرى', async () => {
  const { app } = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, PART2);
  runInAppContext(app, `{ const _s = saveAppFeatures; saveAppFeatures = async () => { crmSheet = null; return _s(); }; } periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  assert.equal(await app.applyPeriodTransition(), true);
  assert.equal(get(app, 'crmSheet'), null);
});

/* ============ الكشف ============ */
async function gradeSheet(seed, features){
  const log = [];
  const app = appWith(seed, log, features || PART2, { code: `${TODAY} crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true;` });
  const g = await app.loadCrmGradeSheet('S');
  return { app, log, g };
}

test('صفحة الطالب — الفترة الجارية تُرى ولا تُحسب حتى تنتهي؛ وبعد إنهائها المعدّل؛ وبفترة واحدة سطر عادي', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 }],
  };
  const { app, g } = await gradeSheet(seed);
  let html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /الفترة الأولى[\s\S]*9 من 10[\s\S]*الفترة الثانية <small>\(جارية — تُحسب عند انتهائها\)<\/small>[\s\S]*4 من 10/);
  assert.match(html, /الدرجة الآن = الفترة الأولى — والفترة الثانية تُحسب عند انتهائها/);
  assert.doesNotMatch(html, /÷ 2/, 'لا هبوط: الجارية خارج المعدّل');
  assert.match(app.crmGradeDetailHtml(g), /9<small class="crm-grade-per">9 · 4<\/small>/);
  runInAppContext(app, `appFeatures = ${JSON.stringify(withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-25'], ended: true } }))};`);
  html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /<bdi dir="ltr">\(9 \+ 4\) ÷ 2 = <b>6\.5<\/b><\/bdi>/, 'بعد إنهاء الأخيرة: معدّل الفترتين');
  assert.doesNotMatch(html, /جارية/);
  runInAppContext(app, `appFeatures = ${JSON.stringify(OFF)};`);
  assert.doesNotMatch(app.crmGradeStudentPageHtml(g, 'a'), /الفترة الأولى|÷ 2/);
  assert.doesNotMatch(app.crmGradeDetailHtml(g), /crm-grade-per|معدّل الفترات/);
});

test('صفحة الطالب بثلاث فترات — المنتهيتان في المعدّل، والثالثة جارية لا تُحسب', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 8 }],
    classroom_grade_period_scores: [1, 2, 3].map((p, i) => ({ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: p, score: [9, 7, 2][i] })),
  };
  const { app, g } = await gradeSheet(seed, withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-01', '2026-10-25'] } }));
  const html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /الفترة الثالثة <small>\(جارية — تُحسب عند انتهائها\)<\/small><\/span><span>2 من 10/);
  assert.match(html, /\(9 \+ 7\) ÷ 2 = <b>8<\/b><\/bdi> — والفترة الثالثة تُحسب عند انتهائها/);
});

test('الكشف — الواجبات بفترتين تُفصَّل ويُحسب عمودها بالمعدّل', async () => {
  const seed = {
    classroom_grade_columns: [col('H', 'homework', 10)], classroom_grade_scores: [],
    classroom_homework: [{ id: 'h0', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و0', due_date: '2026-09-20' },
      { id: 'h1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و1', due_date: '2026-10-01' },
      { id: 'h2', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و2', due_date: '2026-10-26' }],
    classroom_homework_status: [{ teacher_id: 'u1', homework_id: 'h0', student_id: 'a', status: 'submitted' }, { teacher_id: 'u1', homework_id: 'h1', student_id: 'a', status: 'submitted' }],
  };
  /* بلا فترات: 2 من 3 = 6.67. الثانية جارية: الدرجة = الأولى (10) بلا هبوط؛ وبعد إنهائها: (10 + 0) ÷ 2 = 5 */
  const run = await gradeSheet(JSON.parse(JSON.stringify(seed)), withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-25'] } }));
  assert.deepEqual(JSON.parse(JSON.stringify(run.g.breakdown.get('H').get('a'))), { p1: 10, p2: 0, p3: null, final: 10 });
  assert.deepEqual([...run.log.find(l => l.table === 'classroom_grade_scores' && l.op === 'upsert').values].filter(r => r.student_id === 'a').map(r => r.score), [10]);
  const { log, g } = await gradeSheet(seed, withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-25'], ended: true } }));
  assert.deepEqual(JSON.parse(JSON.stringify(g.breakdown.get('H').get('a'))), { p1: 10, p2: 0, p3: null, final: 5 });
  const up = log.find(l => l.table === 'classroom_grade_scores' && l.op === 'upsert');
  assert.deepEqual([...up.values].filter(r => r.student_id === 'a').map(r => r.score), [5]);
});


async function entry(features, seed){
  const { app, log, g } = await gradeSheet(Object.assign({ classroom_grade_columns: [col('P', 'participation', 10)], classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 8 }], classroom_grade_period_scores: [] }, seed || {}), features);
  app.__g = g;
  runInAppContext(app, `crmGrades = __g; renderCrmGrades = async () => {};
    window.__inputs = [{ dataset: { student: 'a' }, value: '', classList: { add(){} } }, { dataset: { student: 'b' }, value: '6', classList: { add(){} } }];
    document.querySelectorAll = q => q === '.crm-grade-input' ? window.__inputs : [];
    crmGradeEntry = { columnId: 'P', saving: false, period: crmGradeEntryPeriod(crmGrades, crmGrades.columns[0]) };`);
  return { app, log };
}

test('الرصد اليدوي لعمود يُرصد مباشرة — درجة الفترة الجارية عبر set_period_score (وبفترة واحدة: الأولى)', async () => {
  const two = await entry(PART2);
  assert.equal(get(two.app, 'crmGradeEntry.period'), 2);
  assert.equal(get(two.app, 'crmGradeEntryScores(crmGrades, crmGrades.columns[0], 2).size'), 0, 'رصد أحمد القديم في الأولى لا في الثانية');
  await two.app.saveCrmGradeEntry();
  assert.deepEqual(two.log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => JSON.parse(JSON.stringify(l.args))),
    [{ p_column_id: 'P', p_student_id: 'b', p_period: 2, p_score: 6, p_only_missing: false }]);
  assert.equal(two.log.filter(l => l.table === 'classroom_grade_scores' && (l.op === 'upsert' || l.op === 'delete')).length, 0);
  const one = await entry(OFF);
  assert.equal(get(one.app, 'crmGradeEntry.period'), 1);
  await one.app.saveCrmGradeEntry();
  const args = one.log.filter(l => l.op === 'rpc').map(l => l.args.p_student_id + ':' + l.args.p_period + ':' + l.args.p_score);
  assert.deepEqual(args.sort(), ['a:1:null', 'b:1:6'], 'أحمد مُسح (فارغ)، وبدر 6 — في الأولى');
});

/* ============ تغيير الأوزان ============ */
test('انحدار: تغيير وزن المشاركة يحوّل درجتي الفترتين، ولا يحوّل درجة الكشف لمن له فترات (وإلا تحوّلت مرتين)', async () => {
  const log = [];
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 4 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 8 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 }],
  };
  const app = appWith(seed, log, null, { code: 'loadCrmGradeSheet = async () => ({});' });
  await app.applySectionWeights('S', TERM, seed.classroom_grade_columns, { decrease: [{ column: seed.classroom_grade_columns[0], old: 10, max: 5 }], increase: [], create: [] });
  const per = log.find(l => l.table === 'classroom_grade_period_scores' && l.op === 'upsert');
  assert.deepEqual([...per.values].map(r => r.student_id + ':' + r.period + ':' + r.score + ':' + r.teacher_id), ['a:1:4:u1', 'a:2:2:u1']);
  const main = log.find(l => l.table === 'classroom_grade_scores' && l.op === 'upsert');
  assert.deepEqual([...main.values].map(r => r.student_id + ':' + r.score), ['b:2']);
  const order = log.filter(l => l.op !== 'select').map(l => l.table + ':' + l.op);
  assert.ok(order.indexOf('classroom_grade_columns:update') > order.indexOf('classroom_grade_period_scores:upsert'), 'الخفض: الدرجات قبل الحد');
});


/* ============ إعداد الدرجات ============ */
test('إعداد الدرجات — الأقسام مطوية بملخص، وبطاقة لكل مكوّن أداء بشارات إعداده (لا للاختبارات)', async () => {
  const app = appWith({}, [], withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }, { startFull: { homework: true } }), { code: `crmCustomTools = []; crmCustomToolsLoaded = true; renderCrmGrades = () => {};` });
  const cols = [col('P', 'participation', 10), col('H', 'homework', 10), col('T1', 'manual', 20, { category: 'tests', name: 'اختبار' })];
  app.openCrmGradeSettings();
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  const det = html.match(/<details class="gs-acc"[^>]*>/g);
  assert.equal(det.length, 3);
  det.forEach(d => assert.doesNotMatch(d, /\sopen/), 'مطوية');
  assert.match(html, /class="gs-acc-s">مشاركة 10 · واجبات 10</);
  assert.equal((html.match(/class="gs-card[^"]*" role="button"/g) || []).length, 2, 'بطاقة لكل مكوّن أداء فقط');
  assert.match(html, /data-comp="c:P"[\s\S]*?📅 ثلاث فترات<\/span><span class="gs-chip now">الآن: الثانية/);
  assert.doesNotMatch(html, /يبدأ من/, '«يبدأ من» أُلغي (3.61)');
  assert.match(html, /class="crm-weight-input" data-key="c:P" value="10"/, 'الوزن محفوظ في البطاقة لحفظ واحد');
  runInAppContext(app, `crmGsOpen.comps = true;`);
  assert.match(app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] }), /data-gs="comps" open/);
  app.openCrmGradeSettings();
  assert.equal(get(app, 'crmGsOpen.comps'), false, 'فتح الشاشة من جديد = مطوية');
});

test('نافذة المكوّن — الدرجة بـ − و +، والفترات ١/٢/٣ مع الانتقال، والإظهار، والحذف (بلا «يبدأ من»)', async () => {
  const app = appWith({}, [], withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('P', 'participation', 10), col('H', 'homework', 10), col('K', 'task', 20)];
  app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  app.openGsCompSheet('c:P');
  const m = get(app, 'window.__modal');
  assert.match(m, /الدرجة[\s\S]*stepGsCompWeight\(-1\)[\s\S]*<b>10<\/b>[\s\S]*stepGsCompWeight\(1\)/);
  assert.match(m, /عدد الفترات[\s\S]*class="is-on" aria-pressed="true" onclick="setGsCompPeriods\(3\)">3/);
  assert.match(m, /الآن: <b>الفترة الثانية<\/b>[\s\S]*openPeriodsWindow\('kind:participation'\)">الفترات ←/);
  assert.doesNotMatch(m, /رجوع|goToComponentPeriod|endComponentPeriods/, 'لا انتقال ولا رجوع مباشر من النافذة (3.61): نافذة الفترات وحدها');
  assert.doesNotMatch(m, /يبدأ الطالب من|الدرجة كاملة/, '«يبدأ من» أُلغي (3.61)');
  assert.match(m, /ظاهر في الكشف ونافذة الرصد/);
  assert.match(m, /deleteGradeComponent\('c:P'\)/);
  app.setGsCompPeriods(2);
  assert.doesNotMatch(get(app, 'window.__modal'), /الفترات ←/, 'عدد الفترات تغيّر ولم يُحفظ: لا انتقال قبل الحفظ');
});

function sheetApp(features, extra){
  const app = appWith({}, [], features || OFF, { code: `crmCustomTools = []; crmCustomToolsLoaded = true; window.__calls = [];
    renderCrmGrades = () => window.__calls.push('render');
    saveCrmGradeSettings = async o => { window.__calls.push('weights:' + window.__w.value + ':' + JSON.stringify(o)); return ${extra && extra.weightFails ? 'false' : 'true'}; };
    setAppToolOn = async (k, on) => window.__calls.push('tool:' + k + ':' + on);
    setComponentPeriodCount = async (k, n) => window.__calls.push('periods:' + k + ':' + n);
    window.__w = { value: '10', dataset: { key: 'c:P' } };
    document.querySelector = q => q.indexOf('c:P') !== -1 ? window.__w : null;
    document.querySelectorAll = q => q === '.crm-weight-input' ? [window.__w, { value: '10', dataset: { key: 'c:H' } }, { value: '15', dataset: { key: 'c:K' } }] : [];` });
  const cols = [col('P', 'participation', 10), col('H', 'homework', 10), col('K', 'task', 15)];
  app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  return app;
}

test('نافذة المكوّن — الدرجة لا تتجاوز المتاح في الأداء ولا تنزل عن نصف درجة', async () => {
  const app = sheetApp();
  app.openGsCompSheet('c:P');
  assert.match(get(app, 'window.__modal'), /المتاح 15 من 40/);
  for(let i = 0; i < 20; i++) app.stepGsCompWeight(1);
  assert.equal(get(app, 'gsCompDraft.weight'), 15);
  for(let i = 0; i < 40; i++) app.stepGsCompWeight(-1);
  assert.equal(get(app, 'gsCompDraft.weight'), 0.5);
});

test('نافذة المكوّن — "حفظ" يطبّق ما تغيّر فقط بالترتيب: الدرجة ← الإظهار ← الفترات', async () => {
  const app = sheetApp();
  app.openGsCompSheet('c:P');
  app.stepGsCompWeight(1);
  app.toggleGsCompVisible();
  app.setGsCompPeriods(2);
  await app.saveGsComp();
  assert.deepEqual([...get(app, 'window.__calls')], ['weights:10.5:{"stay":true}', 'tool:participation:false', 'periods:kind:participation:2', 'render']);
  assert.equal(get(app, 'gsCompDraft'), null);
  const app2 = sheetApp();
  app2.openGsCompSheet('c:P');
  await app2.saveGsComp();
  assert.deepEqual([...get(app2, 'window.__calls')], ['render'], 'بلا تغيير: لا كتابة');
});

test('انحدار: فشل حفظ الدرجة من النافذة — يعود الوزن كما كان ولا تُمحى رسالة الخطأ بإعادة الرسم', async () => {
  const app = sheetApp(OFF, { weightFails: true });
  app.openGsCompSheet('c:P');
  app.stepGsCompWeight(1);
  app.setGsCompPeriods(3);
  await app.saveGsComp();
  assert.deepEqual([...get(app, 'window.__calls')], ['weights:10.5:{"stay":true}'], 'لا خطوات بعد فشل الدرجة، ولا إعادة رسم');
  assert.equal(get(app, 'window.__w.value'), '10');
});

test('بطاقة المكوّن ونافذته تهرّبان اسم المكوّن اليدوي (في العنوان وفي أزرار الفترات)', () => {
  const evil = "x');alert(1);//<b>";
  const app = appWith({}, [], withPeriods({ ['name:' + evil]: { n: 2, starts: [] } }), { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('M', 'manual', 5, { name: evil })];
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  assert.ok(!html.includes(evil), 'البطاقة');
  app.openGsCompSheet('c:M');
  const m = get(app, 'window.__modal');
  assert.ok(!m.includes(evil), 'النافذة');
  assert.match(m, /openPeriodsWindow\('name:x&#39;\);alert\(1\);\/\/&lt;b&gt;'\)/);
});

test('ملخص المكوّنات يُهرَّب (اسم المكوّن من المعلم)', async () => {
  const app = appWith({}, [], null, { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('M', 'manual', 5, { name: '<img src=x onerror=alert(1)>' })];
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [], periods: null });
  assert.doesNotMatch(html, /<img src=x/);
});

/* ============ "عدد الفترات" لكل مكوّن ============ */
function settingsApp(features, seed, log, confirmAnswer){
  return appWith(Object.assign({ classroom_grade_columns: [col('P', 'participation', 10), col('H', 'homework', 10)] }, seed || {}), log, features,
    { code: `renderCrmGrades = () => {}; window.__confirm = []; showConfirm = async m => { window.__confirm.push(m); return ${confirmAnswer !== false}; };
      ${TODAY} window.__resync = []; resyncStartModeColumns = async k => { window.__resync.push(k); };` });
}
const cfgOf = (app, key) => JSON.parse(JSON.stringify(get(app, `periodCfg(${JSON.stringify(TERM)}, '${key}')`)));

test('عدد الفترات والانتقال — لكل مكوّن وحده؛ المحسوب يُعاد حسابه؛ الرجوع خطوة واحدة فقط (تراجع عن بدء)', async () => {
  const log = [];
  const app = settingsApp(OFF, {}, log);
  await app.setComponentPeriodCount('kind:homework', 3);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: [] });
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 1, starts: [] }, 'المشاركة لم تتغيّر');
  await app.goToComponentPeriod('kind:homework', 2);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: ['2026-10-27'] });
  await app.goToComponentPeriod('kind:homework', 3);
  assert.equal(cfgOf(app, 'kind:homework').starts.length, 2);
  assert.equal(await app.goToComponentPeriod('kind:homework', 1), false, 'لا قفز للخلف');
  assert.equal(cfgOf(app, 'kind:homework').starts.length, 2);
  assert.equal(await app.goToComponentPeriod('kind:homework', 2), true, 'تراجع عن بدء الثالثة');
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: ['2026-10-27'] });
  assert.equal(await app.setComponentPeriodCount('kind:homework', 1), false, 'لا تقليل تحت الجارية');
  await app.setComponentPeriodCount('kind:homework', 2);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 2, starts: ['2026-10-27'] });
  assert.equal(get(app, 'window.__confirm.length'), 0);
  assert.ok(get(app, 'window.__resync').every(k => k === 'homework') && get(app, 'window.__resync').length === 5);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
});

test('تقليل الفترات تحت الجارية مرفوض (3.61) — الفترات التي بدأت تبقى', async () => {
  const app = settingsApp(withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-01', '2026-10-20'] } }), {}, []);
  assert.equal(await app.setComponentPeriodCount('kind:homework', 2), false);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: ['2026-10-01', '2026-10-20'] });
  assert.match(get(app, 'window.__toasts.join()'), /الفترة الثالثة بدأت/);
  const ended = settingsApp(withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-01'], ended: true } }), {}, []);
  assert.equal(await ended.setComponentPeriodCount('kind:homework', 1), false);
  const up = settingsApp(withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-01'], ended: true } }), {}, []);
  assert.equal(await up.setComponentPeriodCount('kind:homework', 3), true, 'الزيادة مسموحة');
});

const LATER = { classroom_grade_period_scores: [
  { id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 14 }, { id: 'r2', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 1 },
  { id: 'r3', teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 8 }, { id: 'rx', teacher_id: 'u2', column_id: 'P', student_id: 'x', period: 2, score: 1 }] };

test('انحدار: تقليل الفترات لا يحذف رصدًا أبدًا — فترة لم تبدأ وفيها رصد (من رجوع قديم) ترفض التقليل', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 2, starts: [] } }), JSON.parse(JSON.stringify(LATER)), log);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 1), false);
  assert.match(get(app, 'window.__toasts.join()'), /في الفترة الثانية رصد محفوظ/);
  assert.equal(log.filter(l => l.op !== 'select').length, 0, 'لا حذف ولا كتابة');
  const sel = log.find(l => l.table === 'classroom_grade_period_scores');
  assert.deepEqual(sel.filters[0], ['teacher_id', 'u1'], 'الفحص لمعلمه فقط');
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: [] });
  assert.equal(get(app, 'typeof undoPeriodReduce'), 'undefined');
});

test('تقليل الفترات — بلا رصد في الفترات التي لم تبدأ: يُقلَّل بلا سؤال', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), { classroom_grade_period_scores: [] }, log);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 2), true);
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-25'] });
  assert.equal(get(app, 'window.__confirm.length'), 0);
  assert.equal(log.filter(l => l.op === 'delete').length, 0);
});

test('تقليل الفترات — فترة مقفلة لا تُلغى', async () => {
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), { classroom_grade_period_scores: [] }, []);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 3, before: '9999-12-31' } } };`);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 2), false);
  assert.match(get(app, 'window.__toasts.join()'), /فترة مقفلة/);
});

test('الفترة الجارية لا تُحسب حتى تنتهي — عدد الفترات المحسوبة يُرسل لأعمدة المكوّن عند كل انتقال', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), {}, log);
  const counted = () => log.filter(l => l.op === 'rpc' && l.name === 'set_column_counted_periods').map(l => l.args.p_column_id + ':' + l.args.p_counted);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: [] }), 1);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a'] }), 1);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a', 'b'] }), 2);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a', 'b'], ended: true }), 3);
  assert.equal(app.countedPeriodsOf({ n: 1, starts: [] }), null);
  await app.goToComponentPeriod('kind:participation', 2);
  await app.goToComponentPeriod('kind:participation', 3);
  await app.endComponentPeriods('kind:participation', true);
  assert.equal(get(app, `appFeatures.periods['${TERM.year}|1']['kind:participation'].ended`), true);
  await app.endComponentPeriods('kind:participation', false);
  assert.deepEqual(counted(), ['P:1', 'P:2', 'P:3', 'P:2'], 'الثانية جارية: 1 · الثالثة جارية: 2 · أُنهيت: 3 · رجوع: 2');
});

test('النسخ الاحتياطي — جدول الفترتين في الشاملة (ودليل الاستعادة بعد درجات الكشف) والشخصية والبنية', () => {
  const fs = require('fs');
  const a07 = fs.readFileSync(require('path').join(__dirname, '..', 'app', 'app-07-backup-export.js'), 'utf8');
  const a08 = fs.readFileSync(require('path').join(__dirname, '..', 'app', 'app-08-admin.js'), 'utf8');
  assert.match(a07, /'classroom_grade_scores', 'classroom_grade_period_scores'/);
  assert.match(a07, /40\. classroom_grade_period_scores\.csv \(لازم بعد classroom_grade_scores/);
  assert.match(a08, /sb\.from\('classroom_grade_period_scores'\)\.select\('\*'\)\.eq\('teacher_id', uid\)/);
  assert.match(a08, /classroom_grade_period_scores: periodScoresRes\.data/);
  const sql = loadApp().buildSchemaSql();
  assert.match(sql, /create table if not exists public\.classroom_grade_period_scores/);
  assert.match(sql, /create or replace function public\.increment_period_score/);
  assert.ok(sql.indexOf('create table if not exists public.classroom_grade_period_scores') > sql.indexOf('create table if not exists public.classroom_grade_scores'));
});

test('حذف طالب — لقطة السلة تحوي درجتي الفترتين بعد درجة الكشف (ترتيب الاسترجاع)، ولمعلمه فقط', async () => {
  const { withTrashSupport, tick, snapshotRows } = require('./trash-helpers');
  const store = {};
  const log = [];
  const seed = {
    classroom_students: [{ id: 'a', teacher_id: 'u1', full_name: 'أحمد', section_id: 'S' }],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6.5 }],
    classroom_grade_period_scores: [{ id: 'q1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 9 },
      { id: 'q2', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 },
      { id: 'qx', teacher_id: 'u2', column_id: 'P', student_id: 'a', period: 1, score: 1 }],
  };
  const app = appWith(seed, log, null, { wrap: c => withTrashSupport(c, store), code: `showUndoToast = async () => false; loadCrmStudents = async () => {}; renderCrmStudentsList = () => {}; refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {}; showConfirm = async () => true;` });
  await app.deleteCrmStudent('a');
  await tick();
  const order = [...store.items[0].payload.tables].map(t => t.t);
  assert.ok(order.indexOf('classroom_grade_period_scores') > order.indexOf('classroom_grade_scores'), 'الفترات بعد درجات الكشف (مشغّلها يكتب فوقها)');
  assert.deepEqual(snapshotRows(store.items[0], 'classroom_grade_period_scores').map(r => r.id), ['q1', 'q2']);
  assert.deepEqual(store.restored, ['T1']);
});


/* ============ انحدار: "يبدأ من الكاملة" + فترات — الكشف كان يبقى على الأولى (كاملة تلقائيًا)
   فيختفي كل إنقاص في الجارية ويظن المعلم أن الدرجة "رجعت كاملة" ============ */
const FULL_PART = (starts, n) => withPeriods({ 'kind:participation': { n: n || 3, starts } }, { startFull: { participation: true } });



test('انحدار: لا رجوع يُخفي رصدًا (3.61) — التراجع عن بدء فترة فيها رصد مرفوض، والسابقة المقفلة مرفوضة', async () => {
  const later = [{ id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 7 }];
  const log = [];
  const app = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: later }, log);
  assert.equal(await app.goToComponentPeriod('kind:participation', 1), false);
  assert.equal(get(app, 'window.__confirm.length'), 0, 'لا سؤال يُفهم منه أن الرصد سيختفي');
  assert.match(get(app, 'window.__toasts.join()'), /لا رجوع: في الفترة الثانية رصد محفوظ/);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], ['2026-10-25']);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  const locked = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: [] }, []);
  runInAppContext(locked, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 1, before: '2026-10-25' } } };`);
  assert.equal(await locked.goToComponentPeriod('kind:participation', 1), false);
  assert.match(get(locked, 'window.__toasts.join()'), /الفترة الأولى مقفلة/);
  /* بلا رصد لاحق ولا قفل: تراجع مسموح */
  const app2 = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: [] }, []);
  assert.equal(await app2.goToComponentPeriod('kind:participation', 1), true);
  assert.deepEqual([...get(app2, `appFeatures.periods['${TK}']['kind:participation'].starts`)], []);
});

/* ============ علامة «؟» في ترويسة الكشف — شرح الحساب (فرع تجربة) ============ */
test('علامة ؟: تظهر في ترويسة المكوّن ذي الفترات فقط، وتمنع فتح قائمة العمود', async () => {
  const seed = { classroom_grade_columns: [col('P', 'participation', 10), col('H', 'homework', 10), col('T', 'manual', 20, { category: 'tests', name: 'اختبار' })] };
  const { app, g } = await gradeSheet(seed, withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }));
  const html = app.crmGradeDetailHtml(g);
  assert.equal((html.match(/class="crm-period-q"/g) || []).length, 1, 'المشاركة فقط (الواجبات فترة واحدة، والاختبار بلا فترات)');
  assert.match(html, /مشاركة[\s\S]{0,40}class="crm-period-q"[^>]*onclick="event\.stopPropagation\(\);openCrmPeriodHelp\('P'\)"/);
  const off = await gradeSheet(seed, OFF);
  assert.doesNotMatch(off.app.crmGradeDetailHtml(off.g), /crm-period-q/, 'بلا فترات: لا علامة');
});

test('علامة ؟: نص الشرح بحسب حالة الفترات — الجارية لا تُحسب بعد، وبعد الإنهاء الكل؛ والزر يفتح نافذة الفترات', () => {
  const app = loadApp();
  const html = cfg => app.periodHelpHtml('المشاركة', 'kind:participation', cfg);
  const zero = html({ n: 3, starts: ['a'] });
  assert.match(zero, /الفترة الثانية<\/span><span>جارية — لا تُحسب بعد/);
  assert.match(zero, /تدخل الفترة الثانية حين تبدأ الفترة الثالثة/);
  assert.match(zero, /openPeriodsWindow\('kind:participation'\)">الفترات ←/);
  const last = html({ n: 2, starts: ['a'] });
  assert.match(last, /تدخل الفترة الثانية حين تنهيها/);
  const done = html({ n: 2, starts: ['a'], ended: true });
  assert.match(done, /انتهت كل الفترات/);
  assert.doesNotMatch(done, /جارية/);
  [zero, last, done].forEach(h => assert.doesNotMatch(h, /goToComponentPeriod|endComponentPeriods/));
});

test('علامة ؟: اسم المكوّن ومفتاحه يُهرَّبان، والفتح يعرض النافذة، وعمود بلا فترات لا يفتح شيئًا', async () => {
  const bad = `x');alert(1);//<b>`;
  const seed = { classroom_grade_columns: [col('P', 'manual', 10, { name: bad }), col('H', 'homework', 10)] };
  const { app, g } = await gradeSheet(seed, withPeriods({ ['name:' + bad]: { n: 2, starts: ['2026-10-25'] } }));
  app.__g = g;
  runInAppContext(app, 'crmGrades = __g; window.__modal = null;');
  const head = app.crmGradeDetailHtml(g);
  assert.doesNotMatch(head, /<b>"|alert\(1\);\/\/<b>/, 'الاسم مهرَّب في الترويسة');
  assert.match(head, /aria-label="كيف تُحسب x(&#39;|&#039;|')?\)?;?alert/);
  app.openCrmPeriodHelp('P');
  const m = get(app, 'window.__modal');
  assert.match(m, /كيف تُحسب «x/);
  assert.doesNotMatch(m, /<b>/, 'لا وسم من الاسم');
  runInAppContext(app, 'window.__modal = null;');
  app.openCrmPeriodHelp('H');
  assert.equal(get(app, 'window.__modal'), null, 'فترة واحدة: لا نافذة');
  app.openCrmPeriodHelp('ZZZ');
  assert.equal(get(app, 'window.__modal'), null);
});

/* ============ انحدار — سيناريو المعلم: يبدأ من الكاملة، أنقص في الأولى (7 و6)، ثم انتقل للثانية ============ */
const LIVE3 = (starts, extra) => withPeriods({ 'kind:participation': Object.assign({ n: 3, starts }, extra || {}) }, { startFull: { participation: true } });
const pRow = (st, p, score) => ({ id: st + p, teacher_id: 'u1', column_id: 'P', student_id: st, period: p, score });
const fillsIn = log => log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => l.args.p_column_id + ':' + l.args.p_student_id + ':' + l.args.p_period + ':' + l.args.p_score + ':' + l.args.p_only_missing).sort();



test('انحدار: إعداد «يبدأ من الكاملة» القديم المحفوظ لا يعمل — الانتقال والرجوع بين الفترات لا يكتبان أي درجة', async () => {
  const log = [];
  const app = settingsApp(LIVE3([]), { classroom_grade_period_scores: [] }, log);
  assert.equal(get(app, 'gradeStartsFull("participation")'), false);
  assert.equal(get(app, `periodCfg(${JSON.stringify(TERM)}, 'kind:participation').live`), undefined);
  await app.goToComponentPeriod('kind:participation', 2);
  assert.deepEqual(fillsIn(log), []);
  const log2 = [];
  const app2 = settingsApp(LIVE3(['2026-10-01']), { classroom_grade_period_scores: [] }, log2);
  await app2.goToComponentPeriod('kind:participation', 1);
  assert.deepEqual(fillsIn(log2), []);
});


/* ============ نافذة «الفترات»: الانتقال بسؤال، والقفل (3.61) ============ */
const rpcs = (log, name) => log.filter(l => l.op === 'rpc' && l.name === name).map(l => l.args);
const LOCKED_DATA = { [TK]: { 'kind:participation': { p: 1, before: '2026-10-27' } } };

test('الانتقال — يبلّغ بمن بلا درجة في المنتهية (لا يكتب لهم شيئًا)، ويسأل عن بداية الجديدة؛ ثم: حفظ ← قفل ← بداية', async () => {
  const log = [];
  const seed = { classroom_grade_period_scores: [{ id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 6 }] };
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), seed, log);
  app.__log = log; runInAppContext(app, 'window.__log = __log;');
  runInAppContext(app, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock' ? (window.__log.push({ op: 'rpc', name: n, args: a }), Promise.resolve({ data: ${JSON.stringify(LOCKED_DATA)}, error: null })) : _r(n, a); }
    { const _q = document.getElementById; window.__sum = { innerHTML: '' }; document.getElementById = id => id === 'ptSummary' ? window.__sum : _q(id); }`);
  await app.openPeriodsWindow('kind:participation');
  await app.openPeriodTransition();
  const m = get(app, 'window.__modal');
  assert.match(m, /من الفترة الأولى إلى الفترة الثانية/);
  assert.match(m, /١<\/i>الفترة الأولى — تُغلق وتُقفل[\s\S]*راجع درجات الأولى في الكشف[\s\S]*٢<\/i>كيف تبدأ الفترة الثانية؟[\s\S]*فارغة[\s\S]*الجميع درجة كاملة[\s\S]*الجميع 0/);
  assert.doesNotMatch(m, /أعطِهم|اتركهم/, 'لا خيار يكتب لمن بلا درجة في المنتهية');
  const sum = get(app, 'window.__sum.innerHTML');
  assert.match(sum, /رُصد 1 من 3 · المتوسط 60٪[\s\S]*التطبيق لا يكتب لهم شيئًا[\s\S]*⚠ طالبان بلا درجة في الفترة الأولى[\s\S]*ارجع للكشف قبل القفل/);
  app.setPeriodTrans('start', 'full');
  app.setPeriodTrans('start', 'evil');
  app.setPeriodTrans('fill', 'full');
  assert.equal(get(app, 'periodTransDraft.start'), 'full', 'قيمة غير معروفة تُرفض');
  assert.equal(get(app, 'periodTransDraft.fill'), undefined);
  const before = log.length;
  assert.equal(await app.applyPeriodTransition(), true);
  const writes = log.slice(before).filter(l => l.op === 'rpc').map(l => l.name === 'set_period_score' ? `fill:${l.args.p_student_id}:${l.args.p_period}:${l.args.p_score}:${l.args.p_only_missing}` : l.name === 'set_period_lock' ? `lock:${l.args.p_term}:${l.args.p_key}:${l.args.p_period}:${l.args.p_before}` : l.name);
  assert.equal(writes.filter(w => w.startsWith('fill:') && w.includes(':1:')).length, 0, 'المنتهية: لا يُكتب فيها شيء');
  const iLock = writes.findIndex(w => w.startsWith('lock:'));
  assert.equal(writes[iLock], `lock:${TK}:kind:participation:1:2026-10-27`);
  assert.deepEqual(writes.slice(iLock + 1).filter(w => w.startsWith('fill:')).sort(), ['fill:a:2:10:true', 'fill:b:2:10:true', 'fill:c:2:10:true'], 'الجديدة: الجميع درجة كاملة بعد القفل');
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 3, starts: ['2026-10-27'] });
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 1 })`), true);
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 2 })`), false);
});

test('الانتقال — الكل مرصود: ملخص أخضر بلا تنبيه؛ والمحسوب (الواجبات) بلا سؤال بداية', async () => {
  const seed = { classroom_grade_period_scores: ['a', 'b', 'c'].map(st => ({ id: st, teacher_id: 'u1', column_id: 'P', student_id: st, period: 1, score: 10 })) };
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 2, starts: [] }, 'kind:homework': { n: 2, starts: [] } }), seed, []);
  runInAppContext(app, `{ const _q = document.getElementById; window.__sum = { innerHTML: '' }; document.getElementById = id => id === 'ptSummary' ? window.__sum : _q(id); } periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  const sum = get(app, 'window.__sum.innerHTML');
  assert.match(sum, /pt-sum is-ok[\s\S]*✓ رُصد 3 من 3 · المتوسط 100٪[\s\S]*لا أحد بلا درجة — تُقفل كما هي/);
  assert.doesNotMatch(sum, /⚠/);
  runInAppContext(app, `periodWinCtx = { key: 'kind:homework' };`);
  await app.openPeriodTransition();
  const hw = get(app, 'window.__modal');
  assert.match(hw, /ما تاريخه قبل اليوم يبقى في الفترة الأولى — تُقفل كما هي/);
  assert.doesNotMatch(hw, /كيف تبدأ/);
});

test('الانتقال — «فارغة» لا تكتب أي درجة؛ والأخيرة تُنهى وتُقفل كلها', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-01'] } }), { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  assert.match(get(app, 'window.__modal'), /إنهاء الفترة الثانية/);
  assert.doesNotMatch(get(app, 'window.__modal'), /كيف تبدأ/, 'الأخيرة: لا فترة بعدها');
  await app.applyPeriodTransition();
  assert.deepEqual(rpcs(log, 'set_period_score'), []);
  assert.deepEqual(rpcs(log, 'set_period_lock').map(a => a.p_period + ':' + a.p_before), ['2:9999-12-31']);
  assert.equal(cfgOf(app, 'kind:participation').ended, true);
});

test('انحدار: تغيّرت الفترات من جهاز آخر أثناء السؤال — لا يُكتب شيء فوقها', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  app.setPeriodTrans('fill', 'full');
  runInAppContext(app, `appFeatures = normalizeFeatures(Object.assign({}, appFeatures, { periods: { '${TK}': { 'kind:participation': { n: 3, starts: ['2026-10-20'] } } } }));`);
  assert.equal(await app.applyPeriodTransition(), false);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.match(get(app, 'window.__toasts.join()'), /تغيّرت الفترات من جهاز آخر/);
});

test('الانتقال تمّ والقفل تعذّر (القاعدة قبل التحديث) — رسالة واضحة ولا يتعطّل شيء', async () => {
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), { classroom_grade_period_scores: [] }, []);
  runInAppContext(app, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock' ? Promise.resolve({ data: null, error: { message: 'function not found' } }) : _r(n, a); } periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  assert.equal(await app.applyPeriodTransition(), true);
  assert.deepEqual(cfgOf(app, 'kind:participation').starts, ['2026-10-27']);
  assert.match(get(app, 'window.__toasts.join()'), /تعذّر القفل/);
});

test('فتح للتعديل — يرجع القفل فترة واحدة بعد تأكيد، و«أقفلها» يعيده', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20', '2026-10-25'] } }), { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 2, before: '2026-10-25' } } };`);
  await app.openPeriodsWindow('kind:participation');
  const m = get(app, 'window.__modal');
  assert.equal((m.match(/🔒 مقفلة/g) || []).length, 2);
  assert.equal((m.match(/unlockLatestPeriod\(\)/g) || []).length, 1, 'آخر مقفلة فقط تُفتح');
  await app.unlockLatestPeriod();
  assert.match(get(app, 'window.__confirm[0]'), /فتح الفترة الثانية في «المشاركة» للتعديل/);
  assert.deepEqual(rpcs(log, 'set_period_lock').map(a => a.p_period + ':' + a.p_before), ['1:2026-10-20']);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 1, before: '2026-10-20' } } };`);
  await app.lockNextEndedPeriod();
  assert.deepEqual(rpcs(log, 'set_period_lock').map(a => a.p_period + ':' + a.p_before), ['1:2026-10-20', '2:2026-10-25']);
  const no = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } }), {}, [], false);
  runInAppContext(no, `gradePeriodLocks = ${JSON.stringify({ [TK]: { 'kind:participation': { p: 1, before: '2026-10-20' } } })}; periodWinCtx = { key: 'kind:participation' };`);
  const nlog = []; no.__l = nlog;
  await no.unlockLatestPeriod();
  assert.equal(get(no, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 1 })`), true, 'الإلغاء لا يفتح');
});

test('ورقة الحصة في فترة مقفلة — شريط «مقفلة» بدل أزرار التعبئة، والنقر والتراجع لا يكتبان شيئًا', async () => {
  const f = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-27'] } });
  const { app, log } = await partSheet('2026-10-20', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f,
    { code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};` });
  const html = sheetHtml(app);
  assert.match(html, /🔒 الفترة الأولى مقفلة — للعرض فقط[\s\S]*openPeriodsWindow\('kind:participation'\)/);
  assert.doesNotMatch(html, /fillCrmParticipationEmpty/);
  const before = log.length;
  app.tapCrmParticipation('a', 1);
  await app.fillCrmParticipationEmpty(10);
  app.undoCrmParticipation();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(log.slice(before).filter(l => l.op !== 'select').length, 0);
  assert.match(get(app, 'window.__toasts.join()'), /الفترة مقفلة/);
  /* اليوم في الثانية (غير مقفلة): الرصد عادي */
  const cur = await partSheet('2026-10-28', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f, { code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};` });
  assert.doesNotMatch(sheetHtml(cur.app), /مقفلة/);
  assert.match(sheetHtml(cur.app), /fillCrmParticipationEmpty/);
});

test('القفل بالتاريخ للمحسوب (واجبات/مهام/أداة) وبالفترة للمرصود — وقراءة الأقفال لحساب المعلم فقط', async () => {
  const log = [];
  const app = appWith({ user_app_settings: [{ user_id: 'u1', period_locks: { [TK]: { 'kind:homework': { p: 1, before: '2026-10-20' } } } }, { user_id: 'u2', period_locks: { [TK]: { 'kind:task': { p: 1, before: '2026-12-01' } } } }] }, log, OFF);
  await app.loadPeriodLocks('u1');
  assert.deepEqual(log.find(l => l.table === 'user_app_settings').filters, [['user_id', 'u1']]);
  const T = JSON.stringify(TERM);
  assert.equal(get(app, `isPeriodLocked(${T}, 'kind:homework', { date: '2026-10-19' })`), true);
  assert.equal(get(app, `isPeriodLocked(${T}, 'kind:homework', { date: '2026-10-20' })`), false, 'يوم بدء الفترة التالية غير مقفل');
  assert.equal(get(app, `isPeriodLocked(${T}, 'kind:task', { date: '2026-10-01' })`), false, 'قفل معلم آخر لا يُقرأ');
  assert.equal(get(app, `isLockableKey('name:x')`), false, 'اليدوي بلا قفل');
  assert.equal(get(app, `isLockableKey('tool:${TOOL_ID}')`), true);
});

test('نافذة الفترات تهرّب اسم المكوّن اليدوي، ولا قفل له', async () => {
  const evil = `x');alert(1);//<b>`;
  const app = appWith({}, [], withPeriods({ ['name:' + evil]: { n: 2, starts: [] } }), { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  await app.openPeriodsWindow('name:' + evil);
  const m = get(app, 'window.__modal');
  assert.ok(!m.includes(evil));
  assert.doesNotMatch(m, /<b>"|alert\(1\);\/\/<b>/);
  runInAppContext(app, `periodWinCtx = { key: ${JSON.stringify('name:' + evil)} };`);
  await app.openPeriodTransition();
  assert.doesNotMatch(get(app, 'window.__modal'), /تُقفل/, 'اليدوي: لا قفل');
});
