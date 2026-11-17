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

test('شارة الفترة — "ابدأها الآن" يبدأ التالية من اليوم (أو من الحصة الأقدم)، والرجوع يحذف البداية؛ بلا تواريخ تُعرض', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: [] } });
  const { app } = await partSheet('2026-10-26', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f, { code: TODAY });
  app.openCrmPeriodPicker();
  const modal = get(app, 'window.__modal');
  assert.match(modal, /فترات "المشاركة"[\s\S]*الفترة الأولى[\s\S]*الجارية الآن[\s\S]*الفترة الثانية[\s\S]*ابدأها الآن[\s\S]*الفترة الثالثة[\s\S]*لم تبدأ/);
  assert.doesNotMatch(modal, /\d{1,2}\/\d{1,2}|20\d\d/, 'لا تواريخ');
  assert.match(modal, /onclick="openGradeSettingsFromPeriodPicker\(\)"/, 'زر إعداد الدرجات بالنافذة');
  await app.pickCrmPeriod(2);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], ['2026-10-26'], 'حصة أمس تُرصد في الثانية');
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  await app.pickCrmPeriod(1);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], []);
  assert.equal(get(app, 'crmSheet.part.period'), 1);
});

test('انحدار: تغيير الفترة أثناء إغلاق الورقة لا يعيد رسم ورقة أخرى', async () => {
  const { app } = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, PART2);
  runInAppContext(app, `{ const _s = saveAppFeatures; saveAppFeatures = async () => { crmSheet = null; return _s(); }; }`);
  await app.pickCrmPeriod(1);
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

test('الكشف "يبدأ من الدرجة كاملة" — تُملأ الأولى لمن لا درجة له فيها؛ ومن الثانية لا تُملأ مقدّمًا (انحدار: 7 ثم 10 = 8.5)', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 8 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 2, score: 3 }],
  };
  const fillsOf = log => log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => l.args.p_student_id + ':' + l.args.p_period + ':' + l.args.p_only_missing).sort();
  const p2 = await gradeSheet(seed, Object.assign({}, PART2, { startFull: { participation: true } }));
  assert.deepEqual(fillsOf(p2.log), [], 'الثانية جارية: لا تُكتب الكاملة قبل انتهائها');
  const p1 = await gradeSheet(seed, withPeriods({ 'kind:participation': { n: 2, starts: [] } }, { startFull: { participation: true } }));
  assert.deepEqual(fillsOf(p1.log), ['b:1:true', 'c:1:true'], 'الأولى: من لا درجة له فيها (أحمد درجته القديمة = الأولى)');
  assert.equal(p1.log.filter(l => l.table === 'classroom_grade_scores' && l.op === 'upsert').length, 0);
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

test('انحدار: "يبدأ من" للمشاركة لا يمسح درجات الفترات ولا الكشف', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: [col('P', 'participation', 10)], classroom_grade_period_scores: [{ id: 1, teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 7 }] }, log, null, { code: 'showConfirm = async () => true; renderCrmGrades = () => {};' });
  await app.setGradeStartMode('participation', true);
  assert.deepEqual(log.filter(l => (l.table === 'classroom_grade_period_scores' || l.table === 'classroom_grade_scores') && l.op !== 'select'), []);
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
  assert.match(html, /data-comp="c:H"[\s\S]*?يبدأ من الدرجة كاملة/);
  assert.match(html, /class="crm-weight-input" data-key="c:P" value="10"/, 'الوزن محفوظ في البطاقة لحفظ واحد');
  runInAppContext(app, `crmGsOpen.comps = true;`);
  assert.match(app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] }), /data-gs="comps" open/);
  app.openCrmGradeSettings();
  assert.equal(get(app, 'crmGsOpen.comps'), false, 'فتح الشاشة من جديد = مطوية');
});

test('نافذة المكوّن — الدرجة بـ − و +، والفترات ١/٢/٣ مع الانتقال، و"يبدأ من"، والإظهار، والحذف', async () => {
  const app = appWith({}, [], withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('P', 'participation', 10), col('H', 'homework', 10), col('K', 'task', 20)];
  app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [] });
  app.openGsCompSheet('c:P');
  const m = get(app, 'window.__modal');
  assert.match(m, /الدرجة[\s\S]*stepGsCompWeight\(-1\)[\s\S]*<b>10<\/b>[\s\S]*stepGsCompWeight\(1\)/);
  assert.match(m, /عدد الفترات[\s\S]*class="is-on" aria-pressed="true" onclick="setGsCompPeriods\(3\)">3/);
  assert.match(m, /الآن: <b>الفترة الثانية<\/b>[\s\S]*goToComponentPeriod\('kind:participation', 3\)">ابدأ الفترة الثالثة/);
  assert.match(m, /يبدأ الطالب من/);
  assert.match(m, /ظاهر في الكشف ونافذة الرصد/);
  assert.match(m, /deleteGradeComponent\('c:P'\)/);
  app.setGsCompPeriods(2);
  assert.doesNotMatch(get(app, 'window.__modal'), /ابدأ الفترة/, 'عدد الفترات تغيّر ولم يُحفظ: لا انتقال قبل الحفظ');
});

function sheetApp(features, extra){
  const app = appWith({}, [], features || OFF, { code: `crmCustomTools = []; crmCustomToolsLoaded = true; window.__calls = [];
    renderCrmGrades = () => window.__calls.push('render');
    saveCrmGradeSettings = async o => { window.__calls.push('weights:' + window.__w.value + ':' + JSON.stringify(o)); return ${extra && extra.weightFails ? 'false' : 'true'}; };
    setAppToolOn = async (k, on) => window.__calls.push('tool:' + k + ':' + on);
    setGradeStartMode = async (k, f) => window.__calls.push('start:' + k + ':' + f);
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

test('نافذة المكوّن — "حفظ" يطبّق ما تغيّر فقط بالترتيب: الدرجة ← الإظهار ← "يبدأ من" ← الفترات', async () => {
  const app = sheetApp();
  app.openGsCompSheet('c:P');
  app.stepGsCompWeight(1);
  app.toggleGsCompVisible();
  app.setGsCompFull(true);
  app.setGsCompPeriods(2);
  await app.saveGsComp();
  assert.deepEqual([...get(app, 'window.__calls')], ['weights:10.5:{"stay":true}', 'tool:participation:false', 'start:participation:true', 'periods:kind:participation:2', 'render']);
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
  assert.match(m, /goToComponentPeriod\('name:x&#39;\);alert\(1\);\/\/&lt;b&gt;', 2\)/);
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

test('عدد الفترات والانتقال — لكل مكوّن وحده؛ المحسوب يُعاد حسابه بعد كل تغيير', async () => {
  const log = [];
  const app = settingsApp(OFF, {}, log);
  await app.setComponentPeriodCount('kind:homework', 3);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: [] });
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 1, starts: [] }, 'المشاركة لم تتغيّر');
  await app.goToComponentPeriod('kind:homework', 2);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: ['2026-10-27'] });
  await app.goToComponentPeriod('kind:homework', 3);
  assert.equal(cfgOf(app, 'kind:homework').starts.length, 2);
  await app.goToComponentPeriod('kind:homework', 1);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 3, starts: [] });
  await app.setComponentPeriodCount('kind:homework', 1);
  assert.equal(get(app, 'appFeatures.periods'), undefined, 'فترة واحدة = لا إعداد محفوظ');
  assert.equal(get(app, 'window.__confirm.length'), 0);
  assert.ok(get(app, 'window.__resync').every(k => k === 'homework') && get(app, 'window.__resync').length === 5);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
});

test('المحسوب: تقليل الفترات تحت الجارية بلا تأكيد — يُعاد توزيعه بتاريخه', async () => {
  const app = settingsApp(withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-01', '2026-10-20'] } }), {}, []);
  await app.setComponentPeriodCount('kind:homework', 2);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 2, starts: ['2026-10-01'] });
  assert.equal(get(app, 'window.__confirm.length'), 0);
});

const LATER = { classroom_grade_period_scores: [
  { id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 14 }, { id: 'r2', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 1 },
  { id: 'r3', teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 8 }, { id: 'rx', teacher_id: 'u2', column_id: 'P', student_id: 'x', period: 2, score: 1 }] };

test('انحدار: تقليل الفترات — يُحذف رصد ما بعدها فقط وترجع الدرجة لما قبلها (لا يُكتب المعدّل فوق الأولى)', async () => {
  const log = [];
  const app = settingsApp(PART2, JSON.parse(JSON.stringify(LATER)), log);
  runInAppContext(app, `showUndoToast = async () => true;`);
  await app.setComponentPeriodCount('kind:participation', 1);
  assert.match(get(app, 'window.__confirm[0]'), /يُحذف رصد الفترة الثانية \(لطالب واحد\)، وترجع درجاتهم لما قبلها/);
  assert.equal(log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').length, 0, 'لا كتابة فوق درجة الأولى');
  const del = log.find(l => l.op === 'delete' && l.table === 'classroom_grade_period_scores');
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(del.filters))), { teacher_id: 'u1', id: ['r2'] }, 'رصد الثانية لمعلمه فقط');
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 1, starts: [] });
});

test('تقليل الفترات — "تراجع" يعيد الرصد المحذوف والإعداد كما كانا', async () => {
  const log = [];
  const app = settingsApp(PART2, JSON.parse(JSON.stringify(LATER)), log);
  runInAppContext(app, `showUndoToast = async () => false;`);
  await app.setComponentPeriodCount('kind:participation', 1);
  const ins = log.find(l => l.op === 'insert' && l.table === 'classroom_grade_period_scores');
  assert.deepEqual([...ins.values].map(r => r.id + ':' + r.period + ':' + r.score), ['r2:2:1']);
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-25'] });
});

test('تقليل الفترات — إلغاء التأكيد لا يغيّر شيئًا، وبلا رصد بعدها لا سؤال', async () => {
  const log = [];
  const app = settingsApp(PART2, JSON.parse(JSON.stringify(LATER)), log, false);
  await app.setComponentPeriodCount('kind:participation', 1);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-25'] });
  const app2 = settingsApp(PART2, {}, [], false);
  await app2.setComponentPeriodCount('kind:participation', 1);
  assert.equal(get(app2, 'window.__confirm.length'), 0);
  assert.deepEqual(cfgOf(app2, 'kind:participation'), { n: 1, starts: [] });
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

test('انحدار: مع "يبدأ من الكاملة" الفترة الجارية تُحسب فورًا؛ وبدونه تبقى القاعدة القديمة', () => {
  const app = loadApp();
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a'], live: true }), 2);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: [], live: true }), 1);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a', 'b'], live: true }), 3);
  assert.equal(app.countedPeriodsOf({ n: 3, starts: ['a'] }), 1, 'من 0: الجارية لا تُحسب حتى تنتهي');
  const f = FULL_PART(['2026-10-25']);
  assert.equal(app.periodCfgOf(f, TERM, 'kind:participation').live, true);
  assert.equal(app.periodCfgOf(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), TERM, 'kind:participation').live, undefined);
  runInAppContext(app, `crmCustomTools = ${TOOLS}; crmCustomToolsLoaded = true;`);
  const tf = withPeriods({ ['tool:' + TOOL_ID]: { n: 2, starts: ['x'] }, ['tool:' + STATUS_ID]: { n: 2, starts: ['x'] }, 'kind:homework': { n: 2, starts: ['x'] } },
    { startFull: { ['tool:' + TOOL_ID]: true, ['tool:' + STATUS_ID]: true, homework: true } });
  assert.equal(app.periodCfgOf(tf, TERM, 'tool:' + TOOL_ID).live, true, 'العدّاد مرصود مباشرة');
  assert.equal(app.periodCfgOf(tf, TERM, 'tool:' + STATUS_ID).live, undefined, 'الحالة محسوبة: القاعدة الأصلية');
  assert.equal(app.periodCfgOf(tf, TERM, 'kind:homework').live, undefined, 'الواجبات محسوبة: القاعدة الأصلية');
  assert.equal(app.periodCfgOf(tf, TERM, 'kind:participation').live, undefined, 'فترة واحدة: لا شيء');
});

test('انحدار: الكشف يصحّح عدد الفترات المحسوبة ويعرض الجارية في المعدّل (10 ثم 7 = 8.5، لا 10)', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10, { counted_periods: 1 })],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 10 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 10 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 7 }],
  };
  const { app, log, g } = await gradeSheet(seed, FULL_PART(['2026-10-25']));
  const rpc = log.filter(l => l.op === 'rpc' && l.name === 'set_column_counted_periods').map(l => l.args.p_column_id + ':' + l.args.p_counted);
  assert.deepEqual(rpc, ['P:2']);
  const html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /\(10 \+ 7\) ÷ 2 = <b>8\.5<\/b>/);
  assert.doesNotMatch(html, /تُحسب عند انتهائها/);
});

test('انحدار: الرجوع لفترة سابقة يُنبّه أن رصد ما بعدها يُخفى (لا يُحذف)، والإلغاء لا يغيّر شيئًا', async () => {
  const later = [{ id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 7 }];
  const log = [];
  const app = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: later }, log, false);
  assert.equal(await app.goToComponentPeriod('kind:participation', 1), false);
  assert.equal(get(app, 'window.__confirm.length'), 1);
  assert.match(get(app, 'window.__confirm[0]'), /يُخفي ما رصدته في الفترة الثانية[\s\S]*لا يُحذف شيء/);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], ['2026-10-25']);
  assert.equal(log.filter(l => l.op === 'delete').length, 0);
  /* بلا رصد لاحق: لا سؤال */
  const app2 = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: [] }, [], false);
  await app2.goToComponentPeriod('kind:participation', 1);
  assert.equal(get(app2, 'window.__confirm.length'), 0);
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

test('علامة ؟: نص الشرح بحسب إعداد المكوّن — الكاملة تُحسب الجارية، والصفر لا، وبعد الإنهاء الكل', () => {
  const app = loadApp();
  const html = cfg => app.periodHelpHtml('المشاركة', 'kind:participation', cfg);
  const live = html({ n: 3, starts: ['a'], live: true });
  assert.match(live, /الفترة الأولى<\/span><span>تُحسب<\/span>[\s\S]*الفترة الثانية<\/span><span>جارية — يُحسب ما رصدته فيها[\s\S]*الفترة الثالثة<\/span><span>لم تبدأ/);
  assert.match(live, /ما تُنقصه في الفترة الثانية يُحسب فورًا، ومن لم تُنقص درجته يأخذ فيها الكاملة عند انتهائها — فبدء الفترة لا يغيّر أي درجة/);
  assert.doesNotMatch(live, /أنهِ|ابدأ الفترة/, 'لا زر انتقال: لا شيء معلّق');
  const zero = html({ n: 3, starts: ['a'] });
  assert.match(zero, /الفترة الثانية<\/span><span>جارية — لا تُحسب بعد/);
  assert.match(zero, /تدخل الفترة الثانية حين تبدأ الفترة الثالثة/);
  assert.match(zero, /goToComponentPeriod\('kind:participation', 3\)">ابدأ الفترة الثالثة/);
  const last = html({ n: 2, starts: ['a'] });
  assert.match(last, /تدخل الفترة الثانية حين تنهيها/);
  assert.match(last, /endComponentPeriods\('kind:participation', true\)">أنهِ الفترة الثانية/);
  const done = html({ n: 2, starts: ['a'], ended: true });
  assert.match(done, /انتهت كل الفترات/);
  assert.doesNotMatch(done, /جارية/);
  assert.match(done, /openGradeSettingsFromPeriodPicker\(\)">تغيير الفترات والإعدادات/);
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

test('انحدار: الانتقال للثانية لا يمسّ رصد الأولى — ومن لم يُرصد له فيها (لم تُفتح ورقته) يأخذ الكاملة فيها، ولا شيء يُكتب في الثانية', async () => {
  const log = [];
  const app = settingsApp(LIVE3([]), { classroom_grade_period_scores: [pRow('a', 1, 7), pRow('b', 1, 6)] }, log);
  assert.equal(await app.goToComponentPeriod('kind:participation', 2), true);
  assert.deepEqual(fillsIn(log), ['P:c:1:10:true'], 'جابر فقط: الأولى انتهت بلا رصد له');
  assert.equal(log.filter(l => l.table === 'classroom_grade_period_scores' && (l.op === 'delete' || l.op === 'update' || l.op === 'upsert')).length, 0);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], ['2026-10-27']);
});

test('انحدار: انتهاء الفترة الأخيرة يعطي الكاملة لمن لم يُرصد له فيها؛ والقفز من الأولى للثالثة يُنهي الأولى والثانية', async () => {
  const log = [];
  const app = settingsApp(LIVE3(['2026-10-01', '2026-10-20']), { classroom_grade_period_scores: [pRow('a', 3, 4)] }, log);
  await app.endComponentPeriods('kind:participation', true);
  assert.deepEqual(fillsIn(log), ['P:b:3:10:true', 'P:c:3:10:true']);
  const log2 = [];
  const app2 = settingsApp(LIVE3([]), { classroom_grade_period_scores: [pRow('a', 1, 7)] }, log2);
  await app2.goToComponentPeriod('kind:participation', 3);
  assert.deepEqual(fillsIn(log2), ['P:b:1:10:true', 'P:b:2:10:true', 'P:c:1:10:true', 'P:c:2:10:true', 'P:a:2:10:true'].sort());
});

test('انتهاء فترة بلا "يبدأ من الكاملة" لا يكتب شيئًا، والرجوع لفترة سابقة لا يكتب شيئًا', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), { classroom_grade_period_scores: [] }, log);
  await app.goToComponentPeriod('kind:participation', 2);
  assert.deepEqual(fillsIn(log), []);
  const log2 = [];
  const app2 = settingsApp(LIVE3(['2026-10-01']), { classroom_grade_period_scores: [] }, log2);
  await app2.goToComponentPeriod('kind:participation', 1);
  assert.deepEqual(fillsIn(log2), []);
});

test('انحدار: ورقة الحصة في الثانية (من الكاملة) — لا تُكتب الكاملة مقدّمًا، وتُعرض كاملة، والنقرة تُنقص منها', async () => {
  const seed = { classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 7 }], classroom_grade_period_scores: [pRow('a', 1, 7)] };
  const { app, log } = await partSheet('2026-10-27', seed, LIVE3(['2026-10-25']), { code: TODAY, rpc: { increment_period_score: 9 } });
  assert.deepEqual(fillsIn(log), [], 'لا ملء للفترة الثانية');
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.match(sheetHtml(app), /ما تُنقصه هنا يُحسب في الكشف فورًا، ومن لم تُنقصه يأخذ الكاملة عند انتهاء الفترة/);
  runInAppContext(app, `window.__painted = {}; document.getElementById = id => id.indexOf('crmPart_') === 0 ? { classList: { toggle(){} }, querySelector: q => q === '.crm-part-val' ? (window.__painted[id] = { set innerHTML(v){ window.__painted[id + ':v'] = v; } }) : null } : null;`);
  app.paintCrmParticipation('a');
  assert.match(get(app, "window.__painted['crmPart_a:v']"), /<b>10<\/b>/, 'يُعرض كاملًا في الفترة الجديدة');
  app.tapCrmParticipation('a', -1);
  await get(app, 'crmSheet.part.queue.get("a")');
  const inc = log.find(l => l.op === 'rpc' && l.name === 'increment_period_score');
  assert.equal(inc.args.p_period, 2);
  assert.equal(inc.args.p_delta, -1);
  assert.equal(inc.args.p_full, true, 'القاعدة تبدأ من الكاملة لمن لا صف له');
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
});
