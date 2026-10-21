'use strict';
/* ============================================================
   فترتا المشاركة والواجبات (app-27) + أقسام "إعداد الدرجات" المطوية
   - الأصل فترة واحدة؛ المعلم يفعّل "فترتان"، وينتقل للثانية بزر (لا تقويم ولا تاريخ).
   - المشاركة: درجة لكل فترة، والقاعدة تكتب في الكشف معدّل ما رُصد منهما.
     الرصد القديم بلا فترات = الفترة الأولى (لا يظهر كأنه الثانية).
   - الواجبات: كل واجب في فترة موعده، والعمود = معدّل الفترتين.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const TERM = { year: '1448-1449', semester: 1 };
const OFF = { sections: {}, tools: {} };
const ON_P1 = { sections: {}, tools: {}, periods: { '1448-1449|1': 'later' } };
const ON_P2 = { sections: {}, tools: {}, periods: { '1448-1449|1': '2026-10-25' } };
const WEEKS = [
  { academic_year: '1448-1449', region_group: 'other_regions', semester: 1, week_label: 'الأسبوع التاسع', gregorian_date: '2026-10-18' },
  { academic_year: '1448-1449', region_group: 'other_regions', semester: 1, week_label: 'الأسبوع العاشر', gregorian_date: '2026-10-25' },
  { academic_year: '1448-1449', region_group: 'other_regions', semester: 1, week_label: 'الأسبوع العاشر', gregorian_date: '2026-10-26' },
  { academic_year: '1448-1449', region_group: 'other_regions', semester: 2, week_label: 'الأسبوع العاشر', gregorian_date: '2027-04-04' },
];

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
  const app = loadApp({ supabaseClient: fakeClient(Object.assign({ academic_calendar_weeks: WEEKS, academic_calendar_holidays: [] }, seed || {}), log || [], extra && extra.rpc), currentUser: { id: 'u1' } });
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
const col = (id, kind, max, extra) => Object.assign({ id, teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, category: 'performance', kind, tool_id: null, name: kind === 'participation' ? 'مشاركة' : 'واجبات', max_score: max }, extra || {});

/* ============ دوال صرفة ============ */
test('gradePeriodsState / periodOfDate — غياب الاختيار = فترة واحدة، "later" = الأولى جارية، تاريخ = الثانية بدأت', () => {
  const app = loadApp();
  assert.deepEqual(JSON.parse(JSON.stringify(app.gradePeriodsState(null))), { on: false, override: null, start: null });
  assert.deepEqual(JSON.parse(JSON.stringify(app.gradePeriodsState('later'))), { on: true, override: 'later', start: null });
  assert.equal(app.gradePeriodsState('2026-10-25').start, '2026-10-25');
  assert.equal(app.periodOfDate('2026-10-24', '2026-10-25'), 1);
  assert.equal(app.periodOfDate('2026-10-25', '2026-10-25'), 2);
  assert.equal(app.periodOfDate('2026-12-01', null), 1);
});

test('انحدار: currentPeriodScores — الرصد القديم بلا فترات هو الأولى، ولا يظهر كأنه الثانية', () => {
  const app = loadApp();
  const main = new Map([['a', 9], ['b', 6]]);
  const rows = [{ student_id: 'b', period: 1, score: 6 }, { student_id: 'b', period: 2, score: 3 }];
  const p1 = app.currentPeriodScores(main, rows, 1);
  const p2 = app.currentPeriodScores(main, rows, 2);
  assert.deepEqual([...p1].sort(), [['a', 9], ['b', 6]]);
  assert.deepEqual([...p2], [['b', 3]], 'أحمد لم يُرصد له في الثانية بعد — لا تُعرض له 9');
});

test('participationPeriodBreakdown و periodAverage — معدّل ما رُصد', () => {
  const app = loadApp();
  const b = app.participationPeriodBreakdown(new Map([['a', 9], ['b', 4.5]]), [{ student_id: 'b', period: 1, score: 6 }, { student_id: 'b', period: 2, score: 3 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(b.get('a'))), { p1: 9, p2: null });
  assert.deepEqual(JSON.parse(JSON.stringify(b.get('b'))), { p1: 6, p2: 3 });
  assert.equal(app.periodAverage(9, 4), 6.5);
  assert.equal(app.periodAverage(9, null), 9);
  assert.equal(app.periodAverage(null, null), null);
});

test('normalizeFeatures — يحفظ تاريخ الفترة الصالح فقط', () => {
  const app = loadApp();
  const out = app.normalizeFeatures({ periods: { '1448-1449|1': '2026-10-25', '1448-1449|2': 'later', 'x|3': '2026-01-01', '1448-1449|9': 'later', 'y|1': 'غدًا' } });
  assert.deepEqual(JSON.parse(JSON.stringify(out.periods)), { '1448-1449|1': '2026-10-25', '1448-1449|2': 'later' });
  assert.equal(app.normalizeFeatures({}).periods, undefined);
});

test('الواجبات بفترتين — كل واجب في فترة موعده، والعمود = معدّل الفترتين؛ وبلا بداية للثانية كالسابق', () => {
  const app = loadApp();
  const hws = [{ id: 'h1', due_date: '2026-10-01' }, { id: 'h2', due_date: '2026-10-05' }, { id: 'h3', due_date: '2026-10-27' }];
  const idx = app.homeworkStatusIndex([
    { homework_id: 'h1', student_id: 'a', status: 'submitted' }, { homework_id: 'h2', student_id: 'a', status: 'submitted' },
    { homework_id: 'h3', student_id: 'a', status: 'partial' }]);
  const r = app.homeworkPeriodScores(hws, idx, 'a', 10, '2026-10-25');
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { p1: 10, p2: 5, final: 7.5 });
  const old = app.homeworkPeriodScores(hws, idx, 'a', 10, null);
  assert.equal(old.final, app.homeworkScoreFor(hws, idx, 'a', 10), 'بلا فترة ثانية = الحساب القديم تمامًا');
  assert.equal(old.p2, null);
  const plan = app.planHomeworkScoreSync(['a'], hws, idx, 10, new Map([['a', 8.33]]), '2026-10-25');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.upserts)), [{ student_id: 'a', score: 7.5 }]);
});

/* ============ ورقة الحصة ============ */
async function partSheet(dateIso, seed, features, extra){
  const log = [];
  const app = appWith(Object.assign({ classroom_grade_columns: [col('P', 'participation', 10)] }, seed), log, features, extra);
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '${dateIso}', period: 1, token: 1, mode: 'participation', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'));
  return { app, log };
}

test('المشاركة في الفترة الثانية — الشارة، ودرجة الفترة (لا معدّل الكشف)، والنقرة على الفترة الثانية', async () => {
  const seed = {
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 5 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 6 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 2, score: 4 },
      { teacher_id: 'u2', column_id: 'P', student_id: 'c', period: 2, score: 9 }],
  };
  const { app, log } = await partSheet('2026-10-27', seed, ON_P2, { rpc: { increment_period_score: 1 } });
  const html = get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
  assert.match(html, /class="crm-period-chip is-p2" onclick="openCrmPeriodPicker\(\)"[^>]*>📅 الفترة الثانية ▾</);
  assert.match(html, /الرصد في <b>الفترة الثانية<\/b>/);
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.equal(get(app, 'crmSheet.part.scores.get("b")'), 4);
  assert.equal(get(app, 'crmSheet.part.scores.has("a")'), false, 'رصد أحمد القديم للأولى');
  assert.equal(get(app, 'crmSheet.part.scores.has("c")'), false, 'رصد معلم آخر لا يُقرأ');
  const sel = log.find(l => l.table === 'classroom_grade_period_scores' && l.op === 'select');
  assert.ok(sel.filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'), 'فلترة صريحة بالمعلم الحالي');
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  const rpc = log.find(l => l.op === 'rpc');
  assert.deepEqual(JSON.parse(JSON.stringify(rpc.args)), { p_column_id: 'P', p_student_id: 'a', p_period: 2, p_delta: 1, p_full: false });
  assert.equal(rpc.name, 'increment_period_score');
  assert.match(app.participationTodayKey(get(app, 'crmSheet'), null, 2), /:p2:/, 'سجل نقرات الفترة الثانية مستقل');
});

test('فترتان والأولى جارية — الشارة "الفترة الأولى" حتى بعد الأسبوع العاشر، والرصد القديم ظاهر كما هو', async () => {
  const seed = { classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }], classroom_grade_period_scores: [] };
  const { app } = await partSheet('2026-10-27', seed, ON_P1);
  assert.equal(get(app, 'crmSheet.part.period'), 1);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
  assert.match(get(app, `document.getElementById('crmLessonSheetBody').innerHTML`), /📅 الفترة الأولى ▾/);
});

test('انحدار: الأصل فترة واحدة — لا شارة ولا انتقال تلقائي للثانية من التقويم، والرصد في الأولى', async () => {
  const seed = { classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 9 }], classroom_grade_period_scores: [] };
  const { app, log } = await partSheet('2026-11-15', seed, OFF);
  const html = get(app, `document.getElementById('crmLessonSheetBody').innerHTML`);
  assert.doesNotMatch(html, /crm-period-chip|الفترة/);
  assert.equal(get(app, 'crmSheet.part.period'), 1);
  assert.equal(get(app, 'crmSheet.part.scores.get("a")'), 9);
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(log.find(l => l.op === 'rpc').args.p_period, 1);
});

test('عدّاد المعلم الخاص يبقى بلا فترات (increment_grade_score كما كان)', async () => {
  const TID = '11111111-2222-3333-4444-555555555555';
  const log = [];
  const app = appWith({ classroom_grade_scores: [] }, log, null, { code: `ensureToolColumn = async () => ({ column: { id: 'T', name: 'قراءة', max_score: 5 } });` });
  runInAppContext(app, `crmSheet = { sectionId: 'S', dateIso: '2026-10-27', period: 1, token: 1, mode: 'tool:${TID}', states: {} };`);
  await app.renderCrmParticipation(get(app, 'crmStudentsOfSection("S")'), { id: TID, name: 'قراءة', max_score: 5 });
  assert.equal(get(app, 'crmSheet.part.period'), null);
  app.tapCrmParticipation('a', 1);
  await get(app, 'crmSheet.part.queue.get("a")');
  assert.equal(log.find(l => l.op === 'rpc').name, 'increment_grade_score');
});

test('شارة الفترة — "ابدأها الآن" يبدأ الثانية من اليوم (أو من الحصة الأقدم)، و"الأولى" ترجع إليها؛ بلا تاريخ يُعرض', async () => {
  const { app } = await partSheet('2026-10-26', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, ON_P1,
    { code: `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-27'; }` });
  app.openCrmPeriodPicker();
  assert.match(get(app, 'window.__modal'), /الفترة الأولى[\s\S]*الجارية الآن[\s\S]*✓[\s\S]*الفترة الثانية[\s\S]*ابدأها الآن/);
  assert.doesNotMatch(get(app, 'window.__modal'), /\d{1,2}\/\d{1,2}|التقويم/, 'لا تواريخ ولا تقويم');
  await app.pickCrmPeriod(2);
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), '2026-10-26', 'حصة أمس تُرصد في الثانية');
  assert.equal(get(app, 'crmSheet.part.period'), 2);
  assert.match(get(app, `document.getElementById('crmLessonSheetBody').innerHTML`), /class="crm-period-chip is-p2"[^>]*>📅 الفترة الثانية ▾</);
  await app.pickCrmPeriod(1);
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), 'later');
  assert.equal(get(app, 'crmSheet.part.period'), 1);
});

test('انحدار: تغيير الفترة أثناء إغلاق الورقة لا يعيد رسم ورقة أخرى', async () => {
  const { app } = await partSheet('2026-10-27', { classroom_grade_scores: [], classroom_grade_period_scores: [] }, ON_P2);
  runInAppContext(app, `{ const _s = saveAppFeatures; saveAppFeatures = async () => { crmSheet = null; return _s(); }; }`);
  await app.pickCrmPeriod(1);
  assert.equal(get(app, 'crmSheet'), null);
});

/* ============ الكشف ============ */
async function gradeSheet(seed, features){
  const log = [];
  const app = appWith(seed, log, features || ON_P2, { code: `{ const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-27'; } syncTaskColumn = async () => {}; syncToolColumn = async () => {};` });
  const g = await app.loadCrmGradeSheet('S');
  runInAppContext(app, 'crmGrades = null;');
  return { app, log, g };
}

test('صفحة الطالب — شريط لكل فترة، وطريقة الحساب "(9 + 4) ÷ 2 = 6.5"', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6.5 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 }],
  };
  const { app, g } = await gradeSheet(seed);
  assert.equal(g.periods.start, '2026-10-25');
  /* فترة واحدة: صفحة الطالب والكشف بلا تفصيل الفترتين */
  const off = Object.assign({}, g, { periods: { on: false, override: null, start: null } });
  assert.doesNotMatch(app.crmGradeStudentPageHtml(off, 'a'), /الفترة الأولى|÷ 2/);
  assert.doesNotMatch(app.crmGradeDetailHtml(off), /crm-grade-per|معدّل الفترتين/);
  runInAppContext(app, `crmGrades = ${'null'};`);
  const html = app.crmGradeStudentPageHtml(g, 'a');
  assert.match(html, /الفترة الأولى[\s\S]*9 من 10[\s\S]*الفترة الثانية <small>\(جارية\)<\/small>[\s\S]*4 من 10/);
  assert.match(html, /<bdi dir="ltr">\(9 \+ 4\) ÷ 2 = <b>6\.5<\/b><\/bdi>/);
  const detail = app.crmGradeDetailHtml(g);
  assert.match(detail, /6\.5<small class="crm-grade-per">9 · 4<\/small>/);
});

test('الكشف — الواجبات تُفصَّل بفترتين ويُحسب عمودها بالمعدّل', async () => {
  const seed = {
    classroom_grade_columns: [col('H', 'homework', 10)],
    classroom_grade_scores: [],
    classroom_homework: [{ id: 'h0', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و0', due_date: '2026-09-20' },
      { id: 'h1', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و1', due_date: '2026-10-01' },
      { id: 'h2', teacher_id: 'u1', section_id: 'S', academic_year: TERM.year, semester: 1, title: 'و2', due_date: '2026-10-26' }],
    classroom_homework_status: [{ teacher_id: 'u1', homework_id: 'h0', student_id: 'a', status: 'submitted' }, { teacher_id: 'u1', homework_id: 'h1', student_id: 'a', status: 'submitted' }],
  };
  /* بلا فترات: 2 من 3 = 6.67؛ بالفترتين: (10 + 0) ÷ 2 = 5 */
  const { log, g } = await gradeSheet(seed);
  assert.deepEqual(JSON.parse(JSON.stringify(g.breakdown.get('H').get('a'))), { p1: 10, p2: 0, final: 5 });
  const up = log.find(l => l.table === 'classroom_grade_scores' && l.op === 'upsert');
  assert.deepEqual([...up.values].filter(r => r.student_id === 'a').map(r => r.score), [5]);
});

test('الكشف "يبدأ من الكاملة" — تُملأ الفترة الحالية لمن لا درجة له فيها (لا الكشف مباشرة)', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 8 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 2, score: 3 }],
  };
  const { log } = await gradeSheet(seed, Object.assign({}, ON_P2, { startFull: { participation: true } }));
  const fills = log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => l.args.p_student_id + ':' + l.args.p_period + ':' + l.args.p_only_missing);
  assert.deepEqual(fills.sort(), ['a:2:true', 'c:2:true'], 'أحمد (رصد قديم = الأولى) وجابر يأخذان الكاملة في الثانية؛ بدر له رصد فيها');
  assert.equal(log.filter(l => l.table === 'classroom_grade_scores' && l.op === 'upsert').length, 0);
});

test('الرصد اليدوي لعمود المشاركة — يكتب درجة الفترة الحالية عبر set_period_score', async () => {
  const seed = {
    classroom_grade_columns: [col('P', 'participation', 10)],
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 8 }],
    classroom_grade_period_scores: [],
  };
  const { app, log, g } = await gradeSheet(seed);
  runInAppContext(app, `crmGrades = ${'null'};`);
  app.__g = g;
  runInAppContext(app, `crmGrades = __g; renderCrmGrades = async () => {};
    window.__inputs = [{ dataset: { student: 'a' }, value: '', classList: { add(){} } }, { dataset: { student: 'b' }, value: '6', classList: { add(){} } }];
    document.querySelectorAll = q => q === '.crm-grade-input' ? window.__inputs : [];
    crmGradeEntry = { columnId: 'P', saving: false, period: crmGradeEntryPeriod(crmGrades, crmGrades.columns[0]) };`);
  assert.equal(get(app, 'crmGradeEntry.period'), 2);
  assert.equal(get(app, 'crmGradeEntryScores(crmGrades, crmGrades.columns[0], 2).size'), 0, 'رصد أحمد القديم في الأولى لا في الثانية');
  await app.saveCrmGradeEntry();
  const rpc = log.filter(l => l.op === 'rpc' && l.name === 'set_period_score').map(l => JSON.parse(JSON.stringify(l.args)));
  assert.deepEqual(rpc, [{ p_column_id: 'P', p_student_id: 'b', p_period: 2, p_score: 6, p_only_missing: false }]);
  assert.equal(log.filter(l => l.table === 'classroom_grade_scores' && (l.op === 'upsert' || l.op === 'delete')).length, 0);
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

test('"يبدأ من" للمشاركة — تُمسح درجتا الفترتين أولًا (وإلا عادت درجة الكشف منهما)', async () => {
  const log = [];
  const app = appWith({ classroom_grade_columns: [col('P', 'participation', 10)] }, log, null, { code: 'showConfirm = async () => true; renderCrmGrades = () => {};' });
  await app.setGradeStartMode('participation', true);
  const writes = log.filter(l => l.op !== 'select');
  assert.equal(writes[0].table, 'classroom_grade_period_scores');
  assert.equal(writes[0].op, 'delete');
  assert.ok(writes[0].filters.some(([c, v]) => c === 'teacher_id' && v === 'u1'));
});

/* ============ إعداد الدرجات ============ */
test('إعداد الدرجات — التوزيع والمكوّنات والاختبارات مطوية افتراضيًا بملخص، وسطر الفترتين ظاهر', async () => {
  const app = appWith({}, [], null, { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('P', 'participation', 10), col('H', 'homework', 10)];
  app.openCrmGradeSettings && runInAppContext(app, 'renderCrmGrades = () => {};');
  app.openCrmGradeSettings();
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [], periods: { on: true, override: '2026-01-01', start: '2026-01-01' } });
  const det = html.match(/<details class="gs-acc"[^>]*>/g);
  assert.equal(det.length, 3);
  det.forEach(d => assert.doesNotMatch(d, /\sopen/), 'مطوية');
  assert.match(html, /① التوزيع[\s\S]*class="gs-acc-s">الأداء 40 · الاختبارات 20</);
  assert.match(html, /class="gs-acc-s">مشاركة 10 · واجبات 10</);
  assert.match(html, /id="gsCapPerf"/, 'الحقول داخل المطوي موجودة فيقرؤها الحفظ');
  assert.match(html, /class="gs-periods"[\s\S]*✓ فترتان[\s\S]*الآن: <b>الفترة الثانية<\/b>[\s\S]*رجوع للفترة الأولى/);
  const offHtml = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [], periods: { on: false, override: null, start: null } });
  assert.match(offHtml, /aria-pressed="true" onclick="setCrmGradePeriods\('off'\)">✓ فترة واحدة/);
  assert.doesNotMatch(offHtml, /ابدأ الفترة الثانية/);
  runInAppContext(app, `crmGsOpen.comps = true;`);
  const html2 = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [], periods: null });
  assert.match(html2, /data-gs="comps" open/, 'المفتوح يبقى مفتوحًا عند إعادة الرسم');
  app.openCrmGradeSettings();
  assert.equal(get(app, 'crmGsOpen.comps'), false, 'فتح الشاشة من جديد = مطوية');
});

test('ملخص المكوّنات يُهرَّب (اسم المكوّن من المعلم)', async () => {
  const app = appWith({}, [], null, { code: `crmCustomTools = []; crmCustomToolsLoaded = true;` });
  const cols = [col('M', 'manual', 5, { name: '<img src=x onerror=alert(1)>' })];
  const html = app.crmGradeSettingsHtml({ sectionId: 'S', columns: cols, allColumns: cols, hiddenColumns: [], scores: [], periods: null });
  assert.doesNotMatch(html, /<img src=x/);
});

/* ============ النسخ الاحتياطي والحذف ============ */
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

test('حذف طالب ثم التراجع — تعود درجتا الفترتين بعد درجة الكشف، ولمعلمه فقط', async () => {
  const log = [];
  const seed = {
    classroom_students: [{ id: 'a', teacher_id: 'u1', full_name: 'أحمد', section_id: 'S' }],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6.5 }],
    classroom_grade_period_scores: [{ id: 'q1', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 9 },
      { id: 'q2', teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 },
      { id: 'qx', teacher_id: 'u2', column_id: 'P', student_id: 'a', period: 1, score: 1 }],
  };
  const app = appWith(seed, log, null, { code: `showUndoToast = async () => false; loadCrmStudents = async () => {}; renderCrmStudentsList = () => {}; refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {}; showConfirm = async () => true;` });
  await app.deleteCrmStudent('a');
  const ins = log.filter(l => l.op === 'insert').map(l => l.table);
  assert.ok(ins.indexOf('classroom_grade_period_scores') > ins.indexOf('classroom_grade_scores'));
  const per = log.find(l => l.op === 'insert' && l.table === 'classroom_grade_period_scores');
  assert.deepEqual([...per.values].map(r => r.id), ['q1', 'q2']);
});

/* ============ "فترة واحدة / فترتان" من إعداد الدرجات ============ */
function settingsApp(features, seed, log, confirmAnswer){
  return appWith(Object.assign({ classroom_grade_columns: [col('P', 'participation', 10), col('H', 'homework', 10)] }, seed || {}), log, features,
    { code: `renderCrmGrades = () => {}; window.__confirm = []; showConfirm = async m => { window.__confirm.push(m); return ${confirmAnswer !== false}; };
      { const _l = localIsoDate; localIsoDate = d => d ? _l(d) : '2026-10-27'; } resyncStartModeColumns = async () => { window.__resync = (window.__resync || 0) + 1; };` });
}

test('فترتان: التفعيل يبدأ بالأولى، و"ابدأ الفترة الثانية" يحفظ اليوم، و"رجوع للأولى" — بلا تأكيد ولا مسح', async () => {
  const log = [];
  const app = settingsApp(OFF, {}, log);
  await app.setCrmGradePeriods('on');
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), 'later');
  await app.setCrmGradePeriods('start2');
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), '2026-10-27');
  await app.setCrmGradePeriods('back1');
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), 'later');
  await app.setCrmGradePeriods('off');
  assert.equal(get(app, 'appFeatures.periods'), undefined);
  assert.equal(get(app, 'window.__confirm.length'), 0, 'الثانية لم تبدأ: لا شيء يُدمج');
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.equal(get(app, 'window.__resync'), 4, 'الواجبات يُعاد حسابها بعد كل تغيير');
});

test('إيقاف الفترتين بعد بدء الثانية — بعد تأكيد: الأولى = المعدّل الحالي ثم يُحذف رصد الثانية (درجة الكشف لا تتغيّر)', async () => {
  const log = [];
  const seed = {
    classroom_grade_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', score: 6.5 }, { teacher_id: 'u1', column_id: 'P', student_id: 'b', score: 8 }],
    classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 1, score: 9 }, { teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 },
      { teacher_id: 'u1', column_id: 'P', student_id: 'b', period: 1, score: 8 }, { teacher_id: 'u2', column_id: 'P', student_id: 'x', period: 2, score: 1 }],
  };
  const app = settingsApp(ON_P2, seed, log);
  await app.setCrmGradePeriods('off');
  assert.match(get(app, 'window.__confirm[0]'), /تُدمج الفترتان/);
  const rpc = log.filter(l => l.op === 'rpc').map(l => JSON.parse(JSON.stringify(l.args)));
  assert.deepEqual(rpc, [{ p_column_id: 'P', p_student_id: 'a', p_period: 1, p_score: 6.5, p_only_missing: false }]);
  const del = log.find(l => l.op === 'delete' && l.table === 'classroom_grade_period_scores');
  assert.deepEqual(Object.fromEntries(del.filters), { teacher_id: 'u1', column_id: 'P', period: 2 });
  const order = log.filter(l => l.op !== 'select').map(l => l.op);
  assert.ok(order.indexOf('rpc') < order.indexOf('delete'), 'الأولى = المعدّل قبل حذف الثانية');
  assert.equal(get(app, 'appFeatures.periods'), undefined);
});

test('إيقاف الفترتين — الإلغاء لا يغيّر شيئًا', async () => {
  const log = [];
  const app = settingsApp(ON_P2, { classroom_grade_period_scores: [{ teacher_id: 'u1', column_id: 'P', student_id: 'a', period: 2, score: 4 }] }, log, false);
  await app.setCrmGradePeriods('off');
  assert.equal(log.filter(l => l.op !== 'select').length, 0);
  assert.equal(get(app, 'appFeatures.periods["1448-1449|1"]'), '2026-10-25');
});
