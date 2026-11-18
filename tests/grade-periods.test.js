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
const SQL_ALL = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sql-updates-run-in-supabase.sql'), 'utf8');

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
    window.__v2 = a => { const all = JSON.parse(JSON.stringify(gradePeriodLocks || {})); const t = Object.assign({}, all[a.p_term]);
      if(a.p_value && a.p_value.periods) t[a.p_key] = a.p_value; else delete t[a.p_key]; all[a.p_term] = t; return all; };
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

test('المشاركة بفترتين — المبدّل على «الثانية»، ودرجة الفترة لا معدّل الكشف، والنقرة على الثانية', async () => {
  const seed = {
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 5 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 6 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 2, score: 4 },
      { teacher_id: 'u2', column_id: 'P', student_id: 'c', period: 2, score: 9 }],
  };
  const { app, log } = await partSheet('2026-10-27', seed, PART2, { rpc: { increment_period_score: 1 } });
  assert.match(sheetHtml(app), /class="is-on" aria-pressed="true" onclick="setCrmSheetPeriod\(2\)">الثانية<small>جارية<\/small>/);
  assert.match(sheetHtml(app), /onclick="setCrmSheetPeriod\(1\)">الأولى<small>منتهية<\/small>/);
  assert.doesNotMatch(sheetHtml(app), /crm-per-gear/, '⚙ لم يعد في الورقة اليومية');
  app.toggleCrmSheetHelp();
  assert.match(get(app, `document.getElementById('crmSheetHelp').innerHTML`), /onclick="openCrmPeriodPicker\(\)">⚙ إدارة الفترات/, 'داخل «؟»');
  assert.match(get(app, 'crmSheet.card.help.join()'), /الرصد الآن في <b>الفترة الثانية<\/b>/);
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
  assert.doesNotMatch(sheetHtml(app), /crm-per-bar|الفترة/);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(log.find(l => l.op === 'rpc').args.p_period, 1);
});

test('ثلاث فترات — حصة قديمة تُرصد في فترتها بتاريخها، والمبدّل على «الثالثة» للحصة الحالية', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-01', '2026-10-20'] } });
  const old = await partSheet('2026-10-05', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f);
  assert.equal(get(old.app, 'crmSheet.part.period'), 2);
  const now = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f);
  assert.match(sheetHtml(now.app), /class="is-on" aria-pressed="true" onclick="setCrmSheetPeriod\(3\)">الثالثة/);
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
  assert.doesNotMatch(sheetHtml(a.app), /crm-per-bar/);
  assert.equal(a.rpc.name, 'increment_period_score');
  assert.equal(a.rpc.args.p_period, 1);
  const b = await run(withPeriods({ ['tool:' + TOOL_ID]: { n: 2, starts: ['2026-10-25'] } }));
  assert.match(sheetHtml(b.app), /aria-pressed="true" onclick="setCrmSheetPeriod\(2\)">الثانية/);
  assert.equal(b.rpc.args.p_period, 2);
});

test('⚙ بجانب المبدّل يفتح نافذة «الفترات» (3.61) — والنافذة لا تغيّر بدايات الفترات بنقرة، ولا تواريخ داخل الحصة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const { app, log } = await partSheet('2026-10-26', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f, { code: TODAY });
  app.openCrmPeriodPicker();
  await new Promise(r => setTimeout(r, 0));
  const modal = get(app, 'window.__modal');
  assert.match(modal, /فترات «المشاركة»[\s\S]*الفترة الأولى[\s\S]*مفتوحة للتعديل[\s\S]*الفترة الثانية[\s\S]*جارية[\s\S]*الفترة الثالثة[\s\S]*لم تبدأ/);
  assert.match(modal, /openPeriodTransition\(\)">أنهِ الفترة الثانية وأقفلها ← ابدأ الفترة الثالثة/);
  assert.match(modal, /lockNextEndedPeriod\(1\)">🔒 أقفلها/, 'المنتهية غير المقفلة: زر قفل');
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
  await app.setComponentPeriodCount('kind:homework', 2);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 2, starts: ['2026-10-27'] });
  assert.equal(get(app, 'window.__confirm.length'), 0, 'حذف فترة لم تبدأ: بلا سؤال');
  assert.ok(get(app, 'window.__resync').every(k => k === 'homework') && get(app, 'window.__resync').length === 5);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
});

test('تقليل فترات الواجبات تحت الجارية — بسؤال ولا يُحذف شيء؛ وفترة فيها واجبات لا تُلغى (لا دمج صامت)', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-01', '2026-10-20'] } }), {}, log);
  assert.equal(await app.setComponentPeriodCount('kind:homework', 2), true);
  assert.match(get(app, 'window.__confirm[0]'), /تقليل فترات «الواجبات» إلى[\s\S]*الفترة الثانية تعود جارية/);
  const busy = settingsApp(withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-01', '2026-10-20'] } }),
    { classroom_homework: [Object.assign(HW('h3', '2026-10-05'), { grade_period: 3 }), HW('hd', '2026-10-25')] }, []);
  assert.equal(await busy.setComponentPeriodCount('kind:homework', 2), false);
  assert.match(get(busy, 'window.__toasts.join("|")'), /لا تقليل: بعد الفترة الثانية واجبان — انقلها لفترة أخرى أو احذفها أولًا/, 'المحفوظ في الثالثة والقديم بتاريخه في الثالثة');
  assert.equal(cfgOf(busy, 'kind:homework').n, 3);
  assert.deepEqual(cfgOf(app, 'kind:homework'), { n: 2, starts: ['2026-10-01'] });
  assert.equal(log.filter(l => l.op === 'delete' || l.op === 'insert').length, 0);
  const no = settingsApp(withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-01'], ended: true } }), {}, [], false);
  assert.equal(await no.setComponentPeriodCount('kind:homework', 1), false, 'الإلغاء لا يغيّر');
  assert.deepEqual(cfgOf(no, 'kind:homework'), { n: 2, starts: ['2026-10-01'], ended: true });
});

const LATER = { classroom_grade_period_scores: [
  { id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 14 }, { id: 'r2', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 1 },
  { id: 'r3', teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 8 }, { id: 'rx', teacher_id: 'u2', column_id: 'P', student_id: 'x', period: 2, score: 1 }] };

test('انحدار: تقليل فترات المرصود (3.62) — رصد الفترات المحذوفة يُحفظ في «المحذوفات» قبل حذفه، لمعلمه فقط، و«تراجع» يعيد الفترات', async () => {
  const log = [];
  const app = settingsApp(PART2, JSON.parse(JSON.stringify(LATER)), log);
  runInAppContext(app, `showUndoToast = async () => false; trashAfterRestore = async () => {};
    { const _s = trashSave; trashSave = async cap => { await _s(cap).catch(() => {}); return 'T1'; }; }`);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 1), true);
  assert.match(get(app, 'window.__confirm[0]'), /يُحذف رصد الفترة الثانية \(طالب واحد\) ويبقى في «المحذوفات» 30 يومًا[\s\S]*الفترة الأولى تعود جارية/);
  const ins = log.find(l => l.op === 'insert' && l.table === 'deleted_items');
  assert.equal(ins.values.kind, 'period_scores');
  assert.equal(ins.values.label, 'رصد الفترة الثانية — المشاركة');
  assert.deepEqual(ins.values.payload.tables[0].rows.map(r => r.id), ['r2'], 'لقطة رصد الثانية لمعلمه فقط');
  const iIns = log.indexOf(ins);
  const del = log.find(l => l.op === 'delete' && l.table === 'classroom_grade_period_scores');
  assert.ok(log.indexOf(del) > iIns, 'اللقطة قبل الحذف');
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries(del.filters))), { teacher_id: 'u1', id: ['r2'] });
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.ok(log.some(l => l.op === 'rpc' && l.name === 'restore_deleted_item'), '«تراجع» = استرجاع من السلة');
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-25'] }, 'وعادت الفترات');
  /* الإلغاء: لا لقطة ولا حذف */
  const log2 = [];
  const no = settingsApp(PART2, JSON.parse(JSON.stringify(LATER)), log2, false);
  assert.equal(await no.setComponentPeriodCount('kind:participation', 1), false);
  assert.equal(log2.filter(l => l.op !== 'select').length, 0);
});

test('تقليل الفترات — بلا رصد في الفترات التي لم تبدأ: يُقلَّل بلا سؤال', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-25'] } }), { classroom_grade_period_scores: [] }, log);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 2), true);
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-25'] });
  assert.equal(get(app, 'window.__confirm.length'), 0);
  assert.equal(log.filter(l => l.op === 'delete').length, 0);
});

test('تقليل الفترات وفيها فترة مقفلة — السؤال ينبّه، ويُفتح القفل قبل الحذف (وإلا رفضت القاعدة)', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20', '2026-10-25'] } }), { classroom_grade_period_scores: [
    { id: 'q3', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 3, score: 5 }] }, log);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 2, before: '2026-10-25' } } }; showUndoToast = async () => true;`);
  assert.equal(await app.setComponentPeriodCount('kind:participation', 2), true);
  assert.match(get(app, 'window.__confirm[0]'), /وتُفتح الفترات المقفلة التي تتغيّر/);
  const lk = log.findIndex(l => l.op === 'rpc' && l.name === 'set_period_lock_v2');
  assert.deepEqual([L(log[lk].args), R(log[lk].args, 1).before], ['1', '2026-10-20'], 'الأولى تبقى مقفلة، والثانية (تعود جارية) تُفتح');
  assert.ok(lk < log.findIndex(l => l.op === 'delete' && l.table === 'classroom_grade_period_scores'), 'فتح القفل قبل الحذف');
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-20'] });
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



test('انحدار: لا رجوع يُخفي رصدًا (3.61) — التراجع عن بدء فترة فيها رصد مرفوض؛ وفارغة: يعيد السابقة جارية ومفتوحة (البدء أقفلها)', async () => {
  const later = [{ id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 7 }];
  const log = [];
  const app = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: later }, log);
  assert.equal(await app.goToComponentPeriod('kind:participation', 1), false);
  assert.equal(get(app, 'window.__confirm.length'), 0, 'لا سؤال يُفهم منه أن الرصد سيختفي');
  assert.match(get(app, 'window.__toasts.join()'), /لا رجوع: في الفترة الثانية رصد محفوظ/);
  assert.deepEqual([...get(app, `appFeatures.periods['${TK}']['kind:participation'].starts`)], ['2026-10-25']);
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  const lockLog = [];
  const locked = settingsApp(FULL_PART(['2026-10-25']), { classroom_grade_period_scores: [] }, lockLog);
  runInAppContext(locked, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 1, before: '2026-10-25' } } };
    { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? (window.__lk = a, Promise.resolve({ data: window.__v2(a), error: null })) : _r(n, a); }`);
  assert.equal(await locked.goToComponentPeriod('kind:participation', 1), true, 'التراجع عن بدء الثانية (فارغة)');
  assert.equal(L(get(locked, 'window.__lk')), '', 'الأولى تعود جارية ومفتوحة كما كانت قبل البدء');
  assert.deepEqual([...get(locked, `appFeatures.periods['${TK}']['kind:participation'].starts`)], []);
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
/* القفل لكل فترة (3.71): الفترات المقفلة في نداء set_period_lock_v2 ("1,2")، ومدى فترة منها */
const L = a => Object.keys((a.p_value && a.p_value.periods) || {}).sort().join(',');
const R = (a, p) => a.p_value.periods[p];
const V2 = `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? (window.__v2calls = (window.__v2calls || []).concat([a]), Promise.resolve({ data: window.__v2(a), error: null })) : _r(n, a); }`;
const v2calls = app => JSON.parse(get(app, 'JSON.stringify(window.__v2calls || [])'));
const LOCKED_DATA = { [TK]: { 'kind:participation': { p: 1, before: '2026-10-27' } } };

test('الانتقال — يبلّغ بمن بلا درجة في المنتهية (لا يكتب لهم شيئًا)، ويسأل عن بداية الجديدة؛ ثم: حفظ ← قفل ← بداية', async () => {
  const log = [];
  const seed = { classroom_grade_period_scores: [{ id: 'r1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 6 }] };
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] } }), seed, log);
  app.__log = log; runInAppContext(app, 'window.__log = __log;');
  runInAppContext(app, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? (window.__log.push({ op: 'rpc', name: n, args: a }), Promise.resolve({ data: window.__v2(a), error: null })) : _r(n, a); }
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
  const writes = log.slice(before).filter(l => l.op === 'rpc').map(l => l.name === 'set_period_score' ? `fill:${l.args.p_student_id}:${l.args.p_period}:${l.args.p_score}:${l.args.p_only_missing}` : l.name === 'set_period_lock_v2' ? `lock:${l.args.p_term}:${l.args.p_key}:${L(l.args)}:${R(l.args, 1).before}` : l.name);
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
  assert.deepEqual(rpcs(log, 'set_period_lock_v2').map(a => L(a) + ':' + R(a, 2).from + ':' + R(a, 2).before), ['2:2026-10-01:9999-12-31'], 'الأخيرة وحدها، بمداها');
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
  runInAppContext(app, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: null, error: { message: 'function not found' } }) : _r(n, a); } periodWinCtx = { key: 'kind:participation' };`);
  await app.openPeriodTransition();
  assert.equal(await app.applyPeriodTransition(), true);
  assert.deepEqual(cfgOf(app, 'kind:participation').starts, ['2026-10-27']);
  assert.match(get(app, 'window.__toasts.join()'), /تعذّر القفل/);
});

test('نافذة الفترات (3.71) — «فتح للتعديل» على كل مقفلة، يفتحها وحدها بعد تأكيد؛ و«أقفلها» على كل منتهية مفتوحة', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20', '2026-10-25'] } }), { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 2, before: '2026-10-25' } } }; ${V2}`);
  await app.openPeriodsWindow('kind:participation');
  const m = get(app, 'window.__modal');
  assert.equal((m.match(/🔒 مقفلة/g) || []).length, 2);
  assert.match(m, /unlockLatestPeriod\(1\)[\s\S]*unlockLatestPeriod\(2\)/, 'كل مقفلة تُفتح (لا آخرها فقط)');
  await app.unlockLatestPeriod(1);
  assert.match(get(app, 'window.__confirm[0]'), /فتح الفترة الأولى في «المشاركة» للتعديل/);
  assert.deepEqual(v2calls(app).map(L), ['2'], 'الأولى وحدها تُفتح، والثانية تبقى مقفلة');
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 1 })`), false);
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 2 })`), true);
  await app.openPeriodsWindow('kind:participation');
  assert.match(get(app, 'window.__modal'), /lockNextEndedPeriod\(1\)">🔒 أقفلها/);
  await app.lockNextEndedPeriod(1);
  assert.deepEqual(v2calls(app).map(L), ['2', '1,2']);
  const r = v2calls(app)[1];
  assert.deepEqual([R(r, 1).from, R(r, 1).before, R(r, 2).from, R(r, 2).before], [null, '2026-10-20', '2026-10-20', '2026-10-25'], 'مدى كل فترة للمؤرَّخ');
  const no = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } }), {}, [], false);
  runInAppContext(no, `gradePeriodLocks = ${JSON.stringify({ [TK]: { 'kind:participation': { p: 1, before: '2026-10-20' } } })}; periodWinCtx = { key: 'kind:participation' };`);
  await no.unlockLatestPeriod(1);
  assert.equal(get(no, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 1 })`), true, 'الإلغاء لا يفتح');
});

test('ورقة الحصة في فترة مقفلة — شريط «مقفلة» بدل أزرار التعبئة، والنقر والتراجع لا يكتبان شيئًا', async () => {
  const f = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-27'] } });
  const { app, log } = await partSheet('2026-10-20', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, f,
    { code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};` });
  const html = sheetHtml(app);
  assert.match(html, /🔒 الفترة الأولى مقفلة — للعرض فقط\.<button[^>]*onclick="quickUnlockPeriod\('kind:participation', 1\)">فتح للتعديل</);
  assert.equal(get(app, `document.getElementById('crmCardFill').innerHTML`), '', 'المقفلة: لا زر تعبئة');
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
  assert.match(get(cur.app, `document.getElementById('crmCardFill').innerHTML`), /openCrmFillPanel/);
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

/* ============ تعديل فترة منتهية مفتوحة من الكشف (بعد «فتح للتعديل») ============ */
test('فترة منتهية مفتوحة — زر «عدّل درجاتها في الكشف» يظهر لها فقط (لا للمقفلة ولا للواجبات)', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] }, 'kind:homework': { n: 2, starts: ['2026-10-20'] } });
  const app = settingsApp(f, { classroom_grade_period_scores: [] }, []);
  await app.openPeriodsWindow('kind:participation');
  let m = get(app, 'window.__modal');
  assert.match(m, /مفتوحة للتعديل[\s\S]*startGradeEditPeriod\(1\)">✏️ عدّل درجات الأولى في الكشف ←[\s\S]*lockNextEndedPeriod/);
  assert.doesNotMatch(m, /startGradeEditPeriod\(2\)/, 'الجارية تُرصد عاديًا');
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 1, before: '2026-10-20' } } };`);
  await app.openPeriodsWindow('kind:participation');
  assert.doesNotMatch(get(app, 'window.__modal'), /startGradeEditPeriod/, 'المقفلة: افتحها أولًا');
  await app.openPeriodsWindow('kind:homework');
  assert.doesNotMatch(get(app, 'window.__modal'), /startGradeEditPeriod/, 'المحسوب: يُعدَّل من رصده بتاريخه');
});

test('وضع تعديل الأولى — رصد الكشف لعمود المكوّن يذهب للأولى، وشريط ظاهر، والأعمدة الأخرى كما هي؛ «انتهيت» يقفلها ويخرج', async () => {
  const seed = { classroom_grade_columns: [col('P', 'participation', 10), col('M', 'manual', 5)], classroom_grade_scores: [],
    classroom_grade_period_scores: [pRow('a', 1, 6), pRow('a', 2, 9)] };
  const f = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] } });
  const { app, log, g } = await gradeSheet(seed, f);
  app.__g = g; runInAppContext(app, 'crmGrades = __g;');
  const P = g.columns.find(c => c.id === 'P');
  assert.equal(app.crmGradeEntryPeriod(g, P), 2, 'عادةً: الجارية');
  runInAppContext(app, `periodWinCtx = { key: 'kind:participation' }; renderCrmGrades = async () => {}; switchCrmTab = () => {};`);
  await app.startGradeEditPeriod(1);
  assert.equal(app.crmGradeEntryPeriod(g, P), 1, 'في الوضع: الأولى');
  assert.equal(get(app, 'crmGradeEntryScores(crmGrades, crmGrades.columns.find(c => c.id === "P"), 1).get("a")'), 6);
  assert.equal(app.crmGradeEntryPeriod(g, g.columns.find(c => c.id === 'M')), 1, 'اليدوي بفترة واحدة كما هو');
  const banner = app.gradeEditBannerHtml();
  assert.match(banner, /تعرض درجات الفترة الأولى فقط[\s\S]*يُحفظ في الفترة الأولى[\s\S]*finishGradeEditPeriod\(false\)">عرض الكل/);
  assert.match(get(app, 'crmGradePeriodViewHtml(crmGrades, 1)'), /crm-open-banner[\s\S]*الفترة الأولى في «مشاركة» مفتوحة للتعديل[\s\S]*quickLockPeriod\('kind:participation', 1\)">🔒 أقفلها/, 'القفل بنقرة من الكشف');
  await app.finishGradeEditPeriod(true);
  assert.deepEqual(rpcs(log, 'set_period_lock_v2').map(a => a.p_key + ':' + L(a) + ':' + R(a, 1).before), ['kind:participation:1:2026-10-20']);
  assert.equal(get(app, 'gradeEditPeriod'), null);
  assert.equal(app.crmGradeEntryPeriod(g, P), 2, 'بعد الخروج: الجارية');
  assert.equal(app.gradeEditBannerHtml(), '');
});

test('وضع التعديل — «خروج بلا قفل» لا يكتب شيئًا، والفترة المقفلة لا تدخله، وتراجع الفترات يُبطله', async () => {
  const log = [];
  const app = settingsApp(withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] } }), { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `periodWinCtx = { key: 'kind:participation' }; renderCrmGrades = async () => {}; switchCrmTab = () => {};`);
  await app.startGradeEditPeriod(1);
  const n = log.filter(l => l.op !== 'select').length;
  await app.finishGradeEditPeriod(false);
  assert.equal(log.filter(l => l.op !== 'select').length, n, 'لا كتابة');
  assert.equal(get(app, 'gradeEditPeriod'), null);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 1, before: '2026-10-20' } } };`);
  await app.startGradeEditPeriod(1);
  assert.equal(get(app, 'gradeEditPeriod'), null);
  runInAppContext(app, `gradePeriodLocks = {};`);
  await app.startGradeEditPeriod(2);
  assert.equal(get(app, 'gradeEditPeriod'), null, 'الجارية ليست منتهية');
  runInAppContext(app, `gradeEditPeriod = { key: null, period: 2, term: '${TK}' };`);
  assert.equal(get(app, `gradeEditPeriodOf(${JSON.stringify(col('P', 'participation', 10))})`), 2, 'الجارية تُعرض وتُرصد من مبدّل الكشف');
  runInAppContext(app, `appFeatures = normalizeFeatures(Object.assign({}, appFeatures, { periods: { '${TK}': { 'kind:participation': { n: 2, starts: [] } } } }));`);
  assert.equal(get(app, `gradeEditPeriodOf(${JSON.stringify(col('P', 'participation', 10))})`), null, 'الثانية لم تعد بدأت (تراجع من جهاز آخر): يُبطل');
});

/* ============ التنقّل بين الفترات (مبدّل الفترة في ورقة الحصة والكشف وقوائم الواجبات والمهام) ============ */
const PART_SEED = () => ({
  classroom_grade_scores: [],
  classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 6 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 3 }],
});

test('ورقة الحصة — نقرة «الأولى» تعرضها وترصد فيها، بلا أي تغيير في إعداد الفترات؛ ونقرة «الثانية» تعيدها (بلا مربع شرح زائد)', async () => {
  const { app, log } = await partSheet('2026-10-27', PART_SEED(), PART2, { rpc: { increment_period_score: 7 } });
  const before = JSON.stringify(get(app, 'appFeatures.periods'));
  await app.setCrmSheetPeriod(1);
  assert.equal(get(app, 'crmSheet.part.period'), 1);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 6, 'درجة الأولى لا الثانية');
  assert.match(sheetHtml(app), /aria-pressed="true" onclick="setCrmSheetPeriod\(1\)">الأولى/);
  assert.doesNotMatch(sheetHtml(app), /crm-per-note|رجوع لفترة الحصة/, 'الزر المحدَّد يكفي');
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(rpcs(log, 'increment_period_score')[0].p_period, 1);
  assert.equal(JSON.stringify(get(app, 'appFeatures.periods')), before, 'العرض لا يغيّر بدايات الفترات');
  assert.equal(get(app, 'window.__saved'), 0);
  await app.setCrmSheetPeriod(2);
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 3);
  assert.doesNotMatch(sheetHtml(app), /crm-per-note/);
});

test('ورقة الحصة — فترة لم تبدأ معطّلة ولا تُختار، والمقفلة تُعرض للعرض فقط', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const { app } = await partSheet('2026-10-27', PART_SEED(), f, { code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};` });
  assert.match(sheetHtml(app), /<button type="button" class="is-next" aria-expanded="false" onclick="openCrmStartNext\(\)">الثالثة<small>＋ ابدأ<\/small>/, 'التالية مباشرة: «＋ ابدأ» لا «لم تبدأ»');
  assert.match(sheetHtml(app), /setCrmSheetPeriod\(1\)">الأولى<small>🔒<\/small>/);
  await app.setCrmSheetPeriod(3);
  assert.equal(get(app, 'crmSheet.part.period'), 2, 'الثالثة لم تبدأ');
  await app.setCrmSheetPeriod(1);
  assert.equal(get(app, 'crmSheet.part.locked'), true);
  assert.match(sheetHtml(app), /crm-lock-banner[\s\S]*الفترة الأولى مقفلة/);
});

test('انحدار: تبديل الفترة بسرعة — تحميل الفترة الأقدم إن تأخّر لا يرسم فوق الأحدث', async () => {
  const slow = `{ const _l = loadPeriodRows; let n = 0; loadPeriodRows = async id => { const k = ++n; if(k === 2) await new Promise(r => setTimeout(r, 30)); return _l(id); }; }`;
  const { app } = await partSheet('2026-10-27', PART_SEED(), PART2, { code: slow });
  const p1 = app.setCrmSheetPeriod(1);
  const p2 = app.setCrmSheetPeriod(2);
  await Promise.all([p1, p2]);
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 3);
  assert.match(sheetHtml(app), /aria-pressed="true" onclick="setCrmSheetPeriod\(2\)"/);
});

const HW = (id, due) => ({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'واجب ' + id, due_date: due, created_at: due });
const HW_PER = withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-20'] }, 'kind:task': { n: 2, starts: ['2026-10-20'] } });

test('ورقة الواجب — القائمة واجبات الفترة المعروضة فقط، والمبدّل يبدّلها، واختيار واجب من فترة أخرى ينقل إليها', async () => {
  const app = appWith({ classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [HW('h1', '2026-10-10'), HW('h2', '2026-10-25'), HW('h3', '2026-10-26')], classroom_homework_status: [] }, [], HW_PER);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} }; syncHomeworkColumn = async () => {};`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  let html = sheetHtml(app);
  assert.match(html, /واجب h2/); assert.match(html, /واجب h3/); assert.doesNotMatch(html, /واجب h1/);
  assert.equal(get(app, 'crmSheet.hw.selectedId'), 'h3');
  await app.setCrmSheetPeriod(1);
  html = sheetHtml(app);
  assert.match(html, /واجب h1/); assert.doesNotMatch(html, /واجب h2/);
  assert.match(html, /aria-pressed="true" onclick="setCrmSheetPeriod\(1\)">الأولى/);
  await app.setCrmSheetPeriod(2);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'), 'h1');
  assert.equal(get(app, 'crmSheet.hw.selectedId'), 'h1', 'واجب أُنشئ/اختير في الأولى: الورقة تنتقل لها');
  assert.match(sheetHtml(app), /aria-pressed="true" onclick="setCrmSheetPeriod\(1\)"/);
});

test('ورقة الواجب — فترة بلا واجبات: رسالة واضحة والمبدّل باقٍ؛ وبفترة واحدة لا مبدّل ولا فلترة', async () => {
  const seed = { classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [HW('h1', '2026-10-10')], classroom_homework_status: [] };
  const app = appWith(seed, [], HW_PER);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} }; syncHomeworkColumn = async () => {};`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  assert.match(sheetHtml(app), /لا واجبات في الفترة الثانية\.[\s\S]*\+ واجب جديد/);
  assert.match(sheetHtml(app), /setCrmSheetPeriod\(1\)">الأولى/);
  assert.equal(get(app, 'crmSheet.hw.selectedId'), null);
  const one = appWith(seed, [], OFF);
  runInAppContext(one, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} }; syncHomeworkColumn = async () => {};`);
  await one.renderCrmHomework(get(one, 'crmStudentsOfSection("S")'));
  assert.match(sheetHtml(one), /واجب h1/);
  assert.doesNotMatch(sheetHtml(one), /crm-per-seg/, 'لا مبدّل');
});

test('ورقة المهام — مهام الفترة المعروضة فقط (بموعدها أو يوم إنشائها)', async () => {
  const T = (id, due, created) => ({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'مهمة ' + id, description: '', max_score: 5, due_date: due, created_at: created, shahid_id: null });
  const app = appWith({ classroom_grade_columns: [col('K', 'task', 10)], classroom_tasks: [T('t1', null, '2026-10-05T08:00:00Z'), T('t2', '2026-10-15', '2026-10-21T08:00:00Z'), T('t3', null, '2026-10-22T08:00:00Z')], classroom_task_students: [] }, [], HW_PER);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'task', states: {} };`);
  await app.renderCrmTasks(get(app, 'crmStudentsOfSection("S")'));
  let html = sheetHtml(app);
  assert.match(html, /مهمة t3/); assert.doesNotMatch(html, /مهمة t1|مهمة t2/);
  await app.setCrmSheetPeriod(1);
  html = sheetHtml(app);
  assert.match(html, /مهمة t1/); assert.match(html, /مهمة t2/, 'موعدها في الأولى ولو أُنشئت في الثانية'); assert.doesNotMatch(html, /مهمة t3/);
});

test('قوائم إدارة الواجبات/المهام — مجمّعة تحت عنوان كل فترة (الأحدث أولًا)، وبفترة واحدة كما هي', () => {
  const app = appWith({}, [], HW_PER, { code: TODAY });
  const items = [HW('h3', '2026-10-26'), HW('h2', '2026-10-25'), HW('h1', '2026-10-10')];
  const html = app.periodGroupedListHtml('kind:homework', items, h => h.due_date, h => `<i>${h.id}</i>`);
  assert.match(html, /الفترة الثانية · جارية \(2\)<\/div><i>h3<\/i><i>h2<\/i><div class="tlx-sec crm-per-grp">الفترة الأولى · منتهية \(1\)<\/div><i>h1<\/i>/);
  const one = appWith({}, [], OFF);
  assert.equal(one.periodGroupedListHtml('kind:homework', items, h => h.due_date, h => h.id), 'h3h2h1');
});

test('الكشف — مبدّل «الكل / الأولى / الثانية»: الفترة تعرض درجاتها وحدها، والخانة و«رصد» يكتبان فيها؛ «الكل» يعيد القائمة', async () => {
  const seed = { classroom_grade_columns: [col('P', 'participation', 10), col('M', 'manual', 5)], classroom_grade_scores: [],
    classroom_grade_period_scores: [pRow('a', 1, 6), pRow('a', 2, 9), pRow('b', 1, 4)] };
  const { app, g } = await gradeSheet(seed, withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } }));
  app.__g = g; runInAppContext(app, 'crmGrades = __g; crmGradeScrollHint = () => {}; document.getElementById("crmGradesBody") || (() => { const d = document.createElement("div"); d.id = "crmGradesBody"; document.body.appendChild(d); })(); crmGradesSectionId = () => "S";');
  let page = get(app, 'crmGradesPageHtml(crmGrades)');
  assert.match(page, /class="is-on" aria-pressed="true" onclick="setCrmGradesPeriod\(0\)">الكل/);
  assert.match(page, /disabled>الثالثة<small>لم تبدأ/);
  assert.match(page, /crm-gs-list/, 'الأصل: قائمة المجاميع');
  app.setCrmGradesPeriod(1);
  page = get(app, 'crmGradesPageHtml(crmGrades)');
  assert.match(page, /تعرض درجات الفترة الأولى فقط/);
  assert.match(page, /crm-per-table/);
  assert.doesNotMatch(page, /crm-gs-list/);
  assert.match(page, /onclick="openCrmGradeCell\('P', 'a'\)">6</, 'درجة الأولى لا المعدّل');
  assert.match(page, /onclick="openCrmGradeCell\('P', 'b'\)">4</);
  assert.doesNotMatch(page, />يدوي</, 'المكوّن بفترة واحدة لا يظهر في عرض الفترة');
  assert.match(page, /رصد الأولى:[\s\S]*openCrmGradeEntry\('P'\)/);
  assert.equal(app.crmGradeEntryPeriod(g, g.columns.find(c => c.id === 'P')), 1);
  app.setCrmGradesPeriod(3);
  assert.equal(get(app, 'gradeEditPeriod.period'), 1, 'الثالثة لم تبدأ: لا تُختار');
  app.setCrmGradesPeriod(0);
  assert.equal(get(app, 'gradeEditPeriod'), null);
  assert.equal(app.crmGradeEntryPeriod(g, g.columns.find(c => c.id === 'P')), 2, '«الكل»: الرصد في الجارية');
});

test('الكشف بفترة مقفلة — للعرض فقط (لا خانة ولا «رصد»)، و🔒 يفتح نافذة الفترات؛ واسم العمود مهرَّب', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const seed = { classroom_grade_columns: [col('P', 'participation', 10), col('M', 'manual', 5, { name: evil })], classroom_grade_scores: [],
    classroom_grade_period_scores: [pRow('a', 1, 6)] };
  const f = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] }, ['name:' + evil]: { n: 2, starts: ['2026-10-20'] } });
  const { app, g } = await gradeSheet(seed, f);
  app.__g = g; runInAppContext(app, `crmGrades = __g; gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};`);
  app.setCrmGradesPeriod(1);
  const page = get(app, 'crmGradePeriodViewHtml(crmGrades, 1)');
  assert.doesNotMatch(page, /openCrmGradeCell\('P'/);
  assert.doesNotMatch(page, /openCrmGradeEntry\('P'\)/);
  assert.match(page, /class="crm-per-lock"[^>]*onclick="openPeriodsWindow\('kind:participation'\)">🔒/);
  assert.ok(!page.includes(evil), 'الاسم مهرَّب');
  assert.match(page, /openCrmGradeCell\('M', 'a'\)/, 'اليدوي غير المقفل يُرصد');
});

/* ============ فتح/قفل سريع من الورقة والكشف (بلا نافذة الفترات) ============ */
const lockRpc = (rpcLocks) => ({ wrap: c => Object.assign({}, c, { rpc(name, args){
  if(name === 'set_period_lock_v2'){ rpcLocks.push(args); const t = {}; if(args.p_value && args.p_value.periods) t[args.p_key] = args.p_value; return Promise.resolve({ data: { [args.p_term]: t }, error: null }); }
  return c.rpc(name, args); } }) });

test('ورقة الحصة — «فتح للتعديل» بنقرة يفتح الأولى ويبقى في الورقة، ثم «🔒 أقفلها» بنقرة يعيدها', async () => {
  const calls = [];
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const log = [];
  const { app } = await partSheet('2026-10-27', PART_SEED(), f, Object.assign({ code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)}; enabledSheetModes = () => ['participation'];` }, lockRpc(calls), { wrap: c => { const w = lockRpc(calls).wrap(c); const fr = w.from; w.from = t => { log.push(t); return fr.call(w, t); }; return w; } }));
  await app.setCrmSheetPeriod(1);
  assert.match(sheetHtml(app), /id="crmPerState"><div class="crm-lock-banner"[\s\S]*quickUnlockPeriod\('kind:participation', 1\)">فتح للتعديل</);
  const reads = log.length;
  await app.quickUnlockPeriod('kind:participation', 1);
  assert.deepEqual(calls.map(L), ['']);
  assert.equal(log.length, reads, 'فوري: لا يُعاد تحميل الورقة من القاعدة');
  assert.equal(get(app, 'crmSheet.part.locked'), false, 'الورقة نفسها صارت مفتوحة');
  assert.equal(get(app, 'crmSheet.part.period'), 1, 'بقيت على الأولى');
  assert.match(get(app, `document.getElementById('crmPerState').innerHTML`), /crm-open-banner[\s\S]*✏️ الفترة الأولى مفتوحة للتعديل[\s\S]*quickLockPeriod\('kind:participation', 1\)">🔒 أقفلها/);
  await app.quickLockPeriod('kind:participation', 1);
  assert.deepEqual(calls.map(a => L(a) + ':' + (L(a) ? R(a, 1).before : '')), [':', '1:2026-10-20']);
  assert.equal(get(app, 'crmSheet.part.locked'), true);
  assert.equal(JSON.stringify(get(app, 'periodReopened')), '{}');
});

test('قفل لكل فترة مستقل (3.71) — فتح الأولى والثانية مقفلة يفتح الأولى وحدها (بلا «معها»)، و«أقفلها» يقفلها وحدها؛ والجارية لا تُقفل', async () => {
  const calls = [];
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-10', '2026-10-20'] } });
  const locks = { [TK]: { 'kind:participation': { p: 2, before: '2026-10-20' } } };
  const app = appWith({}, [], f, Object.assign({ code: `${TODAY} gradePeriodLocks = ${JSON.stringify(locks)};` }, lockRpc(calls)));
  assert.match(app.crmLockBannerHtml('kind:participation', 1), /quickUnlockPeriod\('kind:participation', 1\)">فتح للتعديل<\/button>/);
  assert.doesNotMatch(app.crmLockBannerHtml('kind:participation', 1), /معها/);
  await app.quickUnlockPeriod('kind:participation', 1);
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 2 })`), true, 'الثانية باقية مقفلة');
  await app.quickLockPeriod('kind:participation', 1);
  assert.deepEqual(calls.map(L), ['2', '1,2']);
  assert.equal(await app.quickLockPeriod('kind:participation', 3), false, 'الثالثة جارية');
  assert.equal(calls.length, 2);
});

test('قفل لكل فترة — المؤرَّخ يُقفل بمدى فترته المقفلة فقط (الأولى مفتوحة والثانية مقفلة)', () => {
  const app = appWith({}, [], withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-10', '2026-10-20'] } }), {
    code: `gradePeriodLocks = { '${TK}': { 'kind:homework': { periods: { 2: { from: '2026-10-10', before: '2026-10-20' } } } } };` });
  const at = d => get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:homework', { date: '${d}' })`);
  assert.equal(at('2026-10-05'), false, 'الأولى مفتوحة');
  assert.equal(at('2026-10-10'), true); assert.equal(at('2026-10-19'), true);
  assert.equal(at('2026-10-20'), false, 'الثالثة');
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:homework', { period: 2 })`), true);
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:homework', { period: 1 })`), false);
});

test('إغلاق الورقة وفترة فُتحت سريعًا ما زالت مفتوحة — سؤال واحد «أقفلها؟»، و«لا» لا يكتب ولا يتكرر', async () => {
  for(const yes of [true, false]){
    const calls = [];
    const f = withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] } });
    const app = appWith({}, [], f, Object.assign({ code: `${TODAY} gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)}; window.__ask = []; showConfirm = async m => { window.__ask.push(m); return ${yes}; };` }, lockRpc(calls)));
    await app.quickUnlockPeriod('kind:participation', 1);
    await app.remindReopenedPeriods();
    assert.deepEqual(JSON.parse(get(app, 'JSON.stringify(window.__ask)')), ['الفترة الأولى في «المشاركة» ما زالت مفتوحة للتعديل — أقفلها الآن؟']);
    assert.deepEqual(calls.map(L), yes ? ['', '1'] : ['']);
    await app.remindReopenedPeriods();
    assert.equal(get(app, 'window.__ask.length'), 1, 'لا يتكرر');
  }
});

test('الفتح/القفل السريع — لا يعمل أثناء حفظ آخر (نقرة مزدوجة)، ولا لمكوّن يدوي بلا قفل', async () => {
  const calls = [];
  const app = appWith({}, [], withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] } }), Object.assign({ code: `${TODAY} gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)};` }, lockRpc(calls)));
  const a = app.quickUnlockPeriod('kind:participation', 1);
  const b = app.quickUnlockPeriod('kind:participation', 1);
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(await app.quickLockPeriod('name:يدوي', 1), false);
});

/* ============ فترة ثابتة لكل واجب ومهمة (3.66) ============ */
test('itemPeriodFor — الفترة المحفوظة تغلب التاريخ، والقديم (null) بتاريخه، ولا تتجاوز الجارية', () => {
  const app = loadApp();
  const cfg = { n: 3, starts: ['2026-11-18'] };
  const due = h => h.due_date;
  assert.equal(app.itemPeriodFor({ due_date: '2026-11-20', grade_period: 1 }, due, cfg), 1, 'أُنشئ في الأولى وموعده بعد بدء الثانية: يبقى في الأولى');
  assert.equal(app.itemPeriodFor({ due_date: '2026-11-10', grade_period: 2 }, due, cfg), 2);
  assert.equal(app.itemPeriodFor({ due_date: '2026-11-20', grade_period: null }, due, cfg), 2, 'القديم بتاريخه');
  assert.equal(app.itemPeriodFor({ due_date: '2026-11-20', grade_period: 3 }, due, cfg), 2, 'الثالثة لم تبدأ (تراجع): في آخر فترة بدأت');
  assert.equal(app.itemPeriodFor({ due_date: '2026-11-20', grade_period: 2 }, due, { n: 1, starts: [] }), 1, 'فترة واحدة');
  const s = app.periodSplitScores([{ due_date: '2026-11-20', grade_period: 1, v: 4 }, { due_date: '2026-11-25', grade_period: 2, v: 8 }], due,
    list => list.length ? list.reduce((a, x) => a + x.v, 0) : null, { n: 2, starts: ['2026-11-18'], ended: true });
  assert.equal(s.p1, 4); assert.equal(s.p2, 8, 'الدرجة تُحسب بفترة الواجب لا بموعده');
});

test('ورقة الواجب — واجب الأولى يبقى في الأولى ولو موعده بعد بدء الثانية (مشكلة «انتقلت واجبات الأولى للثانية»)', async () => {
  const f = withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-20'] } });
  const hw = [Object.assign(HW('h1', '2026-10-27'), { grade_period: 1 }), Object.assign(HW('h2', '2026-10-25'), { grade_period: 2 })];
  const app = appWith({ classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: hw, classroom_homework_status: [] }, [], f);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} }; syncHomeworkColumn = async () => {};`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  assert.match(sheetHtml(app), /واجب h2/); assert.doesNotMatch(sheetHtml(app), /واجب h1/);
  await app.setCrmSheetPeriod(1);
  assert.match(sheetHtml(app), /واجب h1/); assert.doesNotMatch(sheetHtml(app), /واجب h2/);
});

test('بدء فترة جديدة للواجبات — القديم بلا فترة يُثبَّت على فترته قبل البدء، فلا ينتقل للجديدة', async () => {
  const log = [];
  const hw = [HW('old1', '2026-10-30'), HW('old2', '2026-10-10'), Object.assign(HW('set', '2026-10-30'), { grade_period: 1 })];
  const app = settingsApp(withPeriods({ 'kind:homework': { n: 2, starts: [] } }), { classroom_homework: hw }, log);
  runInAppContext(app, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); }`);
  await app.openPeriodsWindow('kind:homework');
  await app.openPeriodTransition();
  assert.equal(await app.applyPeriodTransition(), true);
  const ups = log.filter(l => l.table === 'classroom_homework' && l.op === 'update');
  assert.equal(ups.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ups[0].values)), { grade_period: 1 });
  const ids = ups[0].filters.find(([c]) => c === 'id')[1];
  assert.deepEqual([...ids].sort(), ['old1', 'old2'], 'ما له فترة لا يُمسّ');
  assert.ok(ups[0].filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'), 'فلترة صريحة بالمعلم');
  const save = log.findIndex(l => l.table === 'classroom_homework' && l.op === 'update');
  assert.ok(save >= 0 && get(app, `periodCfg(${JSON.stringify(TERM)}, 'kind:homework').starts.length`) === 1, 'ثم بدأت الثانية');
});

test('واجب جديد — يحمل فترة الورقة المعروضة (غير المقفلة)، وإلا الجارية؛ ومن نافذة التعديل يُنقل لفترة مفتوحة فقط', async () => {
  const f = withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-20'] } });
  const log = [];
  const app = appWith({ classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [Object.assign(HW('h9', '2026-10-25'), { grade_period: 2 })], classroom_homework_status: [] }, log, f,
    { code: `${TODAY} afterCrmHomeworkChanged = async () => {};` });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {}, viewPeriods: { 'kind:homework': 1 } };
    document.getElementById('crmHwTitle').value = 'ت'; document.getElementById('crmHwDue').value = '2026-10-28';`);
  app.openCrmHomeworkModal();
  assert.match(get(app, 'window.__modal'), /id="crmItemPer_homework"[\s\S]*aria-pressed="true" onclick="setCrmItemPeriod\('homework', 1\)">الأولى[\s\S]*disabled>الثالثة<small>لم تبدأ/);
  await app.saveCrmHomework();
  let ins = log.filter(l => l.table === 'classroom_homework' && l.op === 'insert');
  assert.equal(ins[0].values.grade_period, 1, 'الورقة على الأولى: الواجب للأولى');
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:homework': { p: 1, before: '2026-10-20' } } };`);
  app.openCrmHomeworkModal();
  assert.equal(get(app, 'crmHomeworkDraft.gradePeriod'), 2, 'الأولى مقفلة: الجارية');
  app.setCrmItemPeriod('homework', 1);
  app.setCrmItemPeriod('homework', 3);
  assert.equal(get(app, 'crmHomeworkDraft.gradePeriod'), 2, 'لا مقفلة ولا لم تبدأ');
  await app.openCrmHomeworkEditor('h9');
  assert.equal(get(app, 'crmHomeworkDraft.originalPeriod'), 2);
  runInAppContext(app, `gradePeriodLocks = {};`);
  app.setCrmItemPeriod('homework', 1);
  await app.saveCrmHomework();
  const upd = log.filter(l => l.table === 'classroom_homework' && l.op === 'update').pop();
  assert.equal(upd.values.grade_period, 1);
  assert.ok(upd.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
});

test('قبل تشغيل ملف تحديث القاعدة (لا عمود grade_period) — القراءة والحفظ يعملان بدونه، ولا حقل فترة', async () => {
  const log = [];
  const errChain = msg => { const o = { then: (res, rej) => Promise.resolve({ data: null, error: { message: msg } }).then(res, rej) };
    ['select', 'eq', 'in', 'order', 'limit', 'range', 'maybeSingle', 'single'].forEach(k => { o[k] = () => o; }); return o; };
  const wrap = c => Object.assign({}, c, { from(t){ const q = c.from(t); const sel = q.select, ins = q.insert, upd = q.update;
    q.select = cols => String(cols || '').includes('grade_period') ? errChain('column ' + t + '.grade_period does not exist') : sel(cols);
    q.insert = r => r && r.grade_period !== undefined ? errChain("Could not find the 'grade_period' column") : ins(r);
    q.update = r => r && r.grade_period !== undefined ? errChain("Could not find the 'grade_period' column") : upd(r);
    return q; } });
  const app = appWith({ classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [HW('h1', '2026-10-10')], classroom_homework_status: [] }, log,
    withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-20'] } }), { wrap, code: `${TODAY} afterCrmHomeworkChanged = async () => {};` });
  const hw = await app.loadSectionHomework('S', TERM);
  assert.equal(hw.homeworks.length, 1);
  assert.equal(get(app, 'gradePeriodColMissing'), true);
  runInAppContext(app, `crmSheet = null; document.getElementById('crmHwTitle').value = 'ت'; document.getElementById('crmHwDue').value = '2026-10-28';`);
  app.openCrmHomeworkModal('S');
  assert.doesNotMatch(get(app, 'window.__modal'), /crmItemPer_/);
  await app.saveCrmHomework();
  const ins = log.filter(l => l.table === 'classroom_homework' && l.op === 'insert');
  assert.equal(ins.length, 1); assert.equal(ins[0].values.grade_period, undefined);
});

test('SQL: عمود grade_period بقيد ١–٣، والحارس يقفل الواجب/المهمة بفترته، ونقلها بين فترتين مقفلة مرفوض؛ والمرآة حرفية', () => {
  const sec = SQL_ALL.slice(SQL_ALL.indexOf('-- ============ فترة ثابتة لكل واجب ومهمة (3.66)')).trim();
  assert.match(sec, /alter table public\.classroom_homework add column if not exists grade_period smallint;/);
  assert.match(sec, /check \(grade_period is null or grade_period between 1 and 3\)/);
  assert.match(sec, /if old\.grade_period is null or new\.grade_period is not distinct from old\.grade_period then return new;/, 'التثبيت الأول مسموح');
  assert.match(sec, /before update of grade_period on public\.classroom_tasks for each row execute function public\.item_period_guard\(\)/);
  assert.match(sec, /revoke execute on function public\.item_period_guard\(\) from public, anon, authenticated;/);
  assert.match(SQL_ALL, /h\.due_date, h\.grade_period\s+into v_key, v_term, v_date, v_per from public\.classroom_homework/);
  assert.match(SQL_ALL, /coalesce\(t\.due_date, t\.created_at::date\), t\.grade_period\s+into v_key, v_term, v_date, v_per from public\.classroom_tasks/);
  assert.ok(loadApp().buildSchemaSql().includes(sec), 'المرآة حرفية');
});

/* ============ سيناريوهات المعلم الكاملة (فحص شامل 3.66 — PERIODS.md) ============ */
/* قاعدة وهمية تحفظ الواجبات المُنشأة (insert) لتظهر في التحميل التالي كما في القاعدة الحقيقية */
function persistingHomework(seed){
  let n = 0;
  return c => Object.assign({}, c, { from(t){
    const q = c.from(t);
    if(t !== 'classroom_homework') return q;
    const ins = q.insert;
    q.insert = r => {
      const row = Object.assign({ id: 'N' + (++n), created_at: '2026-10-27T08:00:00Z' }, r);
      seed.classroom_homework.push(row);
      ins(r);
      const o = { then: (res, rej) => Promise.resolve({ data: { id: row.id }, error: null }).then(res, rej) };
      o.select = () => o; o.single = () => o;
      return o;
    };
    return q;
  } });
}
async function hwSheetTitles(app, p){
  if(p) await app.setCrmSheetPeriod(p);
  else await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  return (sheetHtml(app).match(/<option[^>]*>([^<·]+)·/g) || []).map(x => x.replace(/<option[^>]*>/, '').replace('·', '').trim());
}

test('سيناريو فصل كامل: واجب في كل فترة — كل واجب يبقى في فترته وحدها عبر بدء الثانية والثالثة، ولو موعده بعد البدء', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [HW('قديم', '2026-12-30')], classroom_homework_status: [] };
  const app = appWith(seed, log, withPeriods({ 'kind:homework': { n: 3, starts: [] } }),
    { wrap: persistingHomework(seed), code: `${TODAY} afterCrmHomeworkChanged = async () => {}; syncHomeworkColumn = async () => {}; renderCrmGrades = () => {};
      { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); }` });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} };`);
  const create = async (title, due) => {
    app.openCrmHomeworkModal('S');
    runInAppContext(app, `document.getElementById('crmHwTitle').value = ${JSON.stringify(title)}; document.getElementById('crmHwDue').value = '${due}';`);
    await app.saveCrmHomework();
  };
  const startNext = async () => { runInAppContext(app, `periodWinCtx = { key: 'kind:homework' };`); await app.openPeriodTransition(); assert.equal(await app.applyPeriodTransition(), true); };
  await create('أ', '2026-12-30');            /* في الأولى، وموعده بعد كل البدايات */
  await startNext();                           /* تبدأ الثانية */
  runInAppContext(app, `crmSheet.viewPeriods = {};`);
  await create('ب', '2026-10-01');            /* في الثانية، وموعده قبل بدئها */
  await startNext();                           /* تبدأ الثالثة */
  runInAppContext(app, `crmSheet.viewPeriods = {};`);
  await create('ج', '2026-10-27');
  assert.deepEqual(seed.classroom_homework.map(h => h.title + ':' + h.grade_period), ['واجب قديم:1', 'أ:1', 'ب:2', 'ج:3'], 'القديم ثُبّت على الأولى قبل بدء الثانية');
  assert.deepEqual(await hwSheetTitles(app), ['ج']);
  assert.deepEqual(await hwSheetTitles(app, 2), ['ب']);
  assert.deepEqual((await hwSheetTitles(app, 1)).sort(), ['أ', 'واجب قديم'].sort());
  /* الدرجات منفصلة: كل فترة تُحسب من واجباتها وحدها */
  const idx = app.homeworkStatusIndex([{ homework_id: 'N1', student_id: 'a', status: 'submitted' }, { homework_id: 'N2', student_id: 'a', status: 'partial' }]);
  const counted = seed.classroom_homework.filter(h => h.title !== 'واجب قديم');
  const cfg = get(app, `periodCfg(${JSON.stringify(TERM)}, 'kind:homework')`);
  const sc = app.homeworkPeriodScores(counted, idx, 'a', 10, cfg);
  assert.equal(sc.p1, 10, 'الأولى: «أ» سلّم');
  assert.equal(sc.p2, 5, 'الثانية: «ب» ناقص');
  assert.equal(sc.p3, 0, 'الثالثة: «ج» لم يسلّم');
});

test('سيناريو «الجميع سلّم» عند الإنشاء — يُكتب مرة واحدة فقط: بدء الفترات وتبديل العرض وإعادة الفتح لا تمسّ التسليم', async () => {
  const log = [];
  const seed = { classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [], classroom_homework_status: [] };
  const app = appWith(seed, log, withPeriods({ 'kind:homework': { n: 3, starts: [] } }),
    { wrap: persistingHomework(seed), code: `${TODAY} afterCrmHomeworkChanged = async () => {}; syncHomeworkColumn = async () => {}; renderCrmGrades = () => {};
      { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); }` });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} };`);
  app.openCrmHomeworkModal('S');
  app.setCrmHwStart(true);
  runInAppContext(app, `document.getElementById('crmHwTitle').value = 'أ'; document.getElementById('crmHwDue').value = '2026-10-28';`);
  await app.saveCrmHomework();
  const statusWrites = () => log.filter(l => l.table === 'classroom_homework_status' && l.op !== 'select');
  assert.equal(statusWrites().length, 1);
  assert.equal(statusWrites()[0].values.length, 3, 'الثلاثة سلّموا، مرة واحدة');
  for(let i = 0; i < 2; i++){
    runInAppContext(app, `periodWinCtx = { key: 'kind:homework' };`);
    await app.openPeriodTransition(); await app.applyPeriodTransition();
  }
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  await app.setCrmSheetPeriod(1); await app.setCrmSheetPeriod(2); await app.setCrmSheetPeriod(1);
  app.openCrmHomeworkModal('S');
  assert.equal(statusWrites().length, 1, 'لا كتابة تلقائية بعد الإنشاء أبدًا');
  assert.equal(log.filter(l => l.table === 'classroom_homework_status' && l.op === 'delete').length, 0, 'ولا حذف');
});

test('سيناريو التراجع عن بدء فترة — مرفوض وفيها واجب (لا دمج صامت في السابقة)؛ ومسموح وهي فارغة', async () => {
  const f = withPeriods({ 'kind:homework': { n: 3, starts: ['2026-10-20'] } });
  const busy = settingsApp(f, { classroom_homework: [Object.assign(HW('ب', '2026-10-01'), { grade_period: 2 })] }, []);
  runInAppContext(busy, `periodWinCtx = { key: 'kind:homework' };`);
  await busy.undoPeriodStart();
  assert.equal(cfgOf(busy, 'kind:homework').starts.length, 1, 'لم يُتراجع');
  assert.match(get(busy, 'window.__toasts.join("|")'), /لا رجوع: في الفترة الثانية واجب واحد — انقلها لفترة أخرى أو احذفها أولًا/);
  const empty = settingsApp(f, { classroom_homework: [Object.assign(HW('أ', '2026-10-25'), { grade_period: 1 })] }, []);
  runInAppContext(empty, `periodWinCtx = { key: 'kind:homework' };`);
  await empty.undoPeriodStart();
  assert.equal(cfgOf(empty, 'kind:homework').starts.length, 0, 'تراجع: الثانية كانت فارغة');
});

test('انحدار (خطأ صامت): رفض القاعدة نقل واجب لفترة مقفلة «grade_period_locked» لا يُفهم «عمود مفقود» فيُحفظ بدون الفترة', async () => {
  const log = [];
  const lockedOnPeriod = c => Object.assign({}, c, { from(t){ const q = c.from(t); if(t !== 'classroom_homework') return q; const upd = q.update;
    q.update = r => { if(r && r.grade_period !== undefined){ const o = { then: (res, rej) => Promise.resolve({ data: null, error: { message: 'grade_period_locked', code: 'P0001' } }).then(res, rej) };
      ['eq', 'in', 'select'].forEach(k => { o[k] = () => o; }); return o; } return upd(r); }; return q; } });
  const app = appWith({ classroom_grade_columns: [col('H', 'homework', 10)], classroom_homework: [Object.assign(HW('h', '2026-10-25'), { grade_period: 2 })], classroom_homework_status: [] }, log,
    withPeriods({ 'kind:homework': { n: 2, starts: ['2026-10-20'] } }), { wrap: lockedOnPeriod, code: `${TODAY} afterCrmHomeworkChanged = async () => {};` });
  await app.openCrmHomeworkEditor('h');
  app.setCrmItemPeriod('homework', 1);
  runInAppContext(app, `document.getElementById('crmHwTitle').value = 'h'; document.getElementById('crmHwDue').value = '2026-10-25';`);
  await app.saveCrmHomework();
  assert.equal(get(app, 'gradePeriodColMissing'), false, 'الميزة لا تُطفأ');
  assert.equal(log.filter(l => l.table === 'classroom_homework' && l.op === 'update').length, 0, 'لا إعادة حفظ بدون الفترة');
  assert.match(get(app, 'window.__toasts.join("|")'), /error:تعذّر حفظ الواجب: الفترة مقفلة/);
  assert.equal(app.gradePeriodColError({ code: '42703', message: 'column classroom_homework.grade_period does not exist' }), true);
  assert.equal(app.gradePeriodColError({ code: 'PGRST204', message: "Could not find the 'grade_period' column of 'classroom_tasks' in the schema cache" }), true);
});

/* ============ بدء الفترة التالية من الورقة، والتراجع، و«احسب الجارية» (3.68) ============ */
test('«＋ ابدأ» — لوحة داخل الورقة (لا نافذة)، والبدء يقفل السابقة ويبدأ التالية، ويبقى في الورقة؛ ونقرة ثانية تغلق اللوحة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const log = [];
  const { app } = await partSheet('2026-10-27', PART_SEED(), f, { code: `${TODAY} enabledSheetModes = () => ['participation'];
    { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); }
    window.__undo = []; showUndoToast = (m, sec) => { window.__undo.push(m); return Promise.resolve(true); };` });
  runInAppContext(app, `{ const slot = { innerHTML: '' }; const _q = document.getElementById; document.getElementById = id => id === 'crmStartPanelSlot' ? slot : _q(id); window.__slot = slot; }`);
  const modalBefore = get(app, 'window.__modal');
  app.openCrmStartNext();
  assert.equal(get(app, 'window.__modal'), modalBefore, 'لا نافذة');
  const panel = get(app, 'window.__slot.innerHTML');
  assert.match(panel, /ابدأ الفترة الثالثة؟[\s\S]*كيف تبدأ الثالثة؟[\s\S]*فارغة[\s\S]*applyCrmStartNext\(\)">أقفل الثانية وابدأ الثالثة/);
  app.openCrmStartNext();
  assert.equal(get(app, 'window.__slot.innerHTML'), '', 'نقرة ثانية تغلق');
  app.openCrmStartNext();
  assert.equal(await app.applyCrmStartNext(), true);
  assert.equal(cfgOf(app, 'kind:participation').starts.length, 2, 'بدأت الثالثة');
  assert.equal(get(app, `isPeriodLocked(${JSON.stringify(TERM)}, 'kind:participation', { period: 2 })`), true, 'أُقفلت الثانية');
  assert.deepEqual(JSON.parse(get(app, 'JSON.stringify(window.__undo)')), ['أُقفلت الفترة الثانية وبدأت الفترة الثالثة ✓'], 'رسالة بزر «تراجع»');
  assert.equal(get(app, 'crmSheet.part.period'), 3, 'الورقة نفسها الآن على الثالثة');
});

/* انتظار شرط بدل مهلة ثابتة (مهلة 20ms كانت تفشل على أجهزة CI البطيئة) */
async function waitFor(cond, ms = 3000){
  const end = Date.now() + ms;
  while(Date.now() < end){ if(cond()) return; await new Promise(r => setTimeout(r, 5)); }
}
test('«تراجع» بعد البدء (فارغة) — تعود الثانية جارية ومفتوحة كما كانت؛ وبعد رصد في الجديدة يُرفض بلا دمج', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const make = async rows => {
    const { app } = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: rows }, f, { code: `${TODAY} enabledSheetModes = () => ['participation'];
      { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? (window.__lk = (window.__lk || []).concat(Object.keys((a.p_value && a.p_value.periods) || {}).sort().join(',')), Promise.resolve({ data: window.__v2(a), error: null })) : _r(n, a); }
      window.__u = null; showUndoToast = () => new Promise(r => { window.__u = r; });` });
    runInAppContext(app, `{ const slot = { innerHTML: '' }; const _q = document.getElementById; document.getElementById = id => id === 'crmStartPanelSlot' ? slot : _q(id); }`);
    app.openCrmStartNext();
    await app.applyCrmStartNext();
    return app;
  };
  const app = await make([]);
  runInAppContext(app, 'window.__u(false);');
  await waitFor(() => cfgOf(app, 'kind:participation').starts.length === 1 && get(app, 'gradePeriodSaving') === false && (get(app, 'window.__lk') || []).length === 2);
  assert.equal(cfgOf(app, 'kind:participation').starts.length, 1, 'رجعت الثانية جارية');
  assert.deepEqual(JSON.parse(get(app, 'JSON.stringify(window.__lk)')), ['2', ''], 'البدء أقفل الثانية وحدها، والتراجع أعادها مفتوحة كما كانت');
  const busy = await make([{ id: 'r9', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 3, score: 4 }]);
  runInAppContext(busy, 'window.__u(false);');
  await waitFor(() => /لا رجوع/.test(get(busy, 'window.__toasts.join("|")')));
  assert.equal(cfgOf(busy, 'kind:participation').starts.length, 2, 'فيها رصد: لا تراجع');
  assert.match(get(busy, 'window.__toasts.join("|")'), /لا رجوع: في الفترة الثالثة رصد محفوظ/);
});

test('رابط «تراجع عن بدء…» — في نفس جلسة الورقة التي بدأت فيها فقط؛ يختفي بأول رصد أو ✕ أو بفتح ورقة جديدة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  const { app } = await partSheet('2026-10-27', PART_SEED(), f, { code: `${TODAY} enabledSheetModes = () => ['participation'];
    { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); }
    showUndoToast = () => Promise.resolve(true);`, rpc: { increment_period_score: 1 } });
  runInAppContext(app, `{ const slot = { innerHTML: '' }; const row = { innerHTML: 'x' }; const _q = document.getElementById; document.getElementById = id => id === 'crmStartPanelSlot' ? slot : id === 'crmPerUndoRow' ? row : _q(id); window.__row = row; }`);
  assert.doesNotMatch(sheetHtml(app), /undoCrmSheetPeriodStart/, 'قبل البدء: لا رابط');
  app.openCrmStartNext();
  await app.applyCrmStartNext();
  assert.match(sheetHtml(app), /undoCrmSheetPeriodStart\(\)">↶ تراجع عن بدء الفترة الثالثة[\s\S]*dismissCrmJustStarted\(\)">✕/);
  app.tapCrmParticipation('a', 1);
  assert.equal(get(app, 'crmSheet.justStarted'), null, 'أول رصد في الجديدة يخفيه');
  assert.equal(get(app, 'window.__row.innerHTML'), '');
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  assert.doesNotMatch(sheetHtml(app), /undoCrmSheetPeriodStart/, 'لا يعود بإعادة الرسم');
  /* ورقة جديدة (حصة أخرى/إعادة فتح) في نفس اليوم: لا رابط — التراجع من ⚙ */
  const again = await partSheet('2026-10-27', PART_SEED(), withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20', '2026-10-27'] } }), { code: TODAY });
  assert.doesNotMatch(sheetHtml(again.app), /undoCrmSheetPeriodStart/);
  const last = await partSheet('2026-10-27', PART_SEED(), withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-27'] } }), { code: TODAY });
  assert.doesNotMatch(sheetHtml(last.app), /is-next/, 'الأخيرة: إنهاؤها من ⚙');
});

test('«احسب الفترة الجارية في الكشف» — لكل مكوّن، مطفأ في الأصل؛ يغيّر الحساب فقط ويبقى عبر بدء الفترات', async () => {
  const app = loadApp();
  const cfg = { n: 3, starts: ['2026-10-20'] };
  assert.equal(app.countedPeriodsOf(cfg), 1, 'الأصل: الجارية (الثانية) لا تُحسب');
  assert.equal(app.countedPeriodsOf(Object.assign({ live: true }, cfg)), 2, 'مفعّل: تُحسب');
  assert.equal(app.normalizePeriodCfg({ n: 2, starts: [], live: true }).live, true);
  assert.equal(app.normalizePeriodCfg({ n: 2, starts: [], live: 'yes' }).live, undefined, 'قيمة غير صالحة تُهمل');
  const split = app.periodSplitScores([{ d: '2026-10-10', v: 10 }, { d: '2026-10-25', v: 2 }], x => x.d, l => l.length ? l[0].v : null, Object.assign({ live: true }, { n: 3, starts: ['2026-10-20'] }));
  assert.equal(split.final, 6, 'مثال الإعداد: 10 ثم 2 = 6');
  const log = [];
  const s = settingsApp(withPeriods({ 'kind:participation': { n: 3, starts: [] }, 'kind:homework': { n: 2, starts: [] } }), { classroom_grade_period_scores: [] }, log);
  assert.equal(await s.setComponentPeriodLive('kind:participation', true), true);
  assert.equal(cfgOf(s, 'kind:participation').live, true);
  assert.equal(cfgOf(s, 'kind:homework').live, undefined, 'لكل مكوّن على حدة');
  runInAppContext(s, `{ const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? Promise.resolve({ data: window.__v2(a), error: null }) : _r(n, a); } periodWinCtx = { key: 'kind:participation' };`);
  await s.openPeriodTransition(); await s.applyPeriodTransition();
  assert.equal(cfgOf(s, 'kind:participation').live, true, 'يبقى بعد بدء فترة');
  assert.equal(log.filter(l => ['insert', 'upsert', 'delete'].includes(l.op)).length, 0, 'لا رصد يُكتب ولا يُحذف');
  assert.equal(await s.setComponentPeriodLive('kind:participation', false), true);
  assert.equal(cfgOf(s, 'kind:participation').live, undefined);
});

test('ورقة الواجب — الشرح الدائم داخل «؟» (لا فقرة ظاهرة)، و«إدارة الفترات» في آخره؛ وتنبيه ظاهر فقط إن لم يكن عمود واجبات', async () => {
  const mk = async (cols) => {
    const app = appWith({ classroom_grade_columns: cols, classroom_homework: [HW('h1', '2026-10-25')], classroom_homework_status: [] }, [], HW_PER);
    runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'homework', states: {} }; syncHomeworkColumn = async () => {};`);
    await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
    return app;
  };
  const app = await mk([col('H', 'homework', 10, { name: '<b>واجبات</b>' })]);
  assert.doesNotMatch(sheetHtml(app), /الأصل «لم يسلّم»|الأصل "لم يسلّم"|crm-sheet-warn/);
  assert.match(sheetHtml(app), /crm-per-seg[\s\S]*onclick="toggleCrmSheetHelp\(\)">؟<\/button><\/div><div id="crmSheetHelp"/);
  app.toggleCrmSheetHelp();
  const help = get(app, `document.getElementById('crmSheetHelp').innerHTML`);
  assert.match(help, /كل واجب في الفترة التي أُنشئ فيها[\s\S]*الأصل «لم يسلّم»[\s\S]*يُحسب في عمود «&lt;b&gt;واجبات&lt;\/b&gt;»[\s\S]*⚙ إدارة الفترات/, 'اسم العمود مهرَّب');
  const none = await mk([]);
  assert.match(sheetHtml(none), /crm-sheet-warn">لا عمود واجبات في الكشف/, 'الحالة الاستثنائية تبقى ظاهرة');
});

test('انحدار: «؟» في ورقة الواجب بعد المشاركة في نفس الحصة — يعرض شرح الواجب لا شرح المشاركة', async () => {
  const app = appWith({ classroom_grade_columns: [col('P', 'participation', 30), col('H', 'homework', 10)], classroom_grade_scores: [], classroom_grade_period_scores: [],
    classroom_homework: [HW('h1', '2026-10-25')], classroom_homework_status: [] }, [], OFF);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'participation', states: {} }; syncHomeworkColumn = async () => {};`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  runInAppContext(app, `crmSheet.mode = 'homework';`);
  await app.renderCrmHomework(get(app, 'crmStudentsOfSection("S")'));
  app.toggleCrmSheetHelp();
  const help = get(app, `document.getElementById('crmSheetHelp').innerHTML`);
  assert.match(help, /الأصل «لم يسلّم»/);
  assert.doesNotMatch(help, /يزيد درجة|الدرجة من 30/, 'لا شرح المشاركة');
  runInAppContext(app, `crmSheet.mode = 'participation';`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  app.toggleCrmSheetHelp();
  assert.match(get(app, `document.getElementById('crmSheetHelp').innerHTML`), /يزيد درجة/, 'والعكس');
});

test('«اجعل الفترة الأخيرة جارية من جديد» (الإعدادات) — بسؤال يوضّح الأثر، لا يحذف رصدًا، ويفتحها إن كانت مقفلة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 2, ended: true, starts: ['2026-10-20'] } });
  const log = [];
  const app = settingsApp(f, { classroom_grade_period_scores: [] }, log);
  runInAppContext(app, `gradePeriodLocks = { '${TK}': { 'kind:participation': { p: 2, before: '9999-12-31' } } };
    { const _r = sb.rpc.bind(sb); sb.rpc = (n, a) => n === 'set_period_lock_v2' ? (window.__lk = Object.keys(a.p_value.periods || {}).join(',') + ':' + ((a.p_value.periods || {})[1] || {}).before, Promise.resolve({ data: window.__v2(a), error: null })) : _r(n, a); }`);
  assert.equal(await app.reopenLastPeriod('kind:participation'), true);
  assert.match(get(app, 'window.__confirm[0]'), /اجعل الفترة الثانية جارية من جديد في «المشاركة»؟ لا يُحذف أي رصد[\s\S]*لن تُحسب في الكشف حتى تنهيها — الدرجة الآن = الفترة الأولى وحدها[\s\S]*وتُفتح لأنها مقفلة/);
  assert.deepEqual(cfgOf(app, 'kind:participation'), { n: 2, starts: ['2026-10-20'] }, 'جارية: بلا ended');
  assert.equal(get(app, 'window.__lk'), '1:2026-10-20', 'القفل يعود للأولى فقط');
  assert.equal(log.filter(l => ['insert', 'upsert', 'delete'].includes(l.op)).length, 0, 'لا رصد يُكتب ولا يُحذف');
  const no = settingsApp(f, {}, [], false);
  assert.equal(await no.reopenLastPeriod('kind:participation'), false, 'الإلغاء لا يغيّر');
  assert.equal(cfgOf(no, 'kind:participation').ended, true);
  const live = settingsApp(withPeriods({ 'kind:participation': { n: 2, ended: true, live: true, starts: ['2026-10-20'] } }), {}, []);
  await live.reopenLastPeriod('kind:participation');
  assert.match(get(live, 'window.__confirm[0]'), /تبقى محسوبة في الكشف/);
  assert.equal(cfgOf(live, 'kind:participation').live, true, 'الخيار يبقى');
  const notEnded = settingsApp(withPeriods({ 'kind:participation': { n: 2, starts: ['2026-10-20'] } }), {}, []);
  assert.equal(await notEnded.reopenLastPeriod('kind:participation'), false, 'لا تعمل إلا إن انتهت كلها');
});

test('الفتح/القفل الفوري — الشاشة تتغيّر قبل رد القاعدة؛ وفشل الحفظ يعيدها كما كانت برسالة', async () => {
  const f = withPeriods({ 'kind:participation': { n: 3, starts: ['2026-10-20'] } });
  let release;
  const slow = c => Object.assign({}, c, { rpc(n, a){ if(n !== 'set_period_lock_v2') return c.rpc(n, a);
    return new Promise(r => { release = ok => r(ok ? { data: { [a.p_term]: a.p_value.periods ? { [a.p_key]: a.p_value } : {} }, error: null } : { data: null, error: { message: 'network' } }); }); } });
  const { app } = await partSheet('2026-10-27', PART_SEED(), f, { wrap: slow, code: `gradePeriodLocks = ${JSON.stringify(LOCKED_DATA)}; enabledSheetModes = () => ['participation'];` });
  await app.setCrmSheetPeriod(1);
  const pending = app.quickUnlockPeriod('kind:participation', 1);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(get(app, 'crmSheet.part.locked'), false, 'فوري قبل رد القاعدة');
  assert.match(get(app, `document.getElementById('crmPerState').innerHTML`), /مفتوحة للتعديل/);
  assert.equal(await app.quickUnlockPeriod('kind:participation', 1), false, 'لا نقرة مزدوجة أثناء الحفظ');
  release(false);
  assert.equal(await pending, false);
  assert.equal(get(app, 'crmSheet.part.locked'), true, 'فشل: عادت مقفلة');
  assert.match(get(app, `document.getElementById('crmPerState').innerHTML`), /الفترة الأولى مقفلة/);
  assert.match(get(app, 'window.__toasts.join("|")'), /error:تعذّر الحفظ/);
});
