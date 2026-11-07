'use strict';
/* ============================================================
   تقرير الشعبة (app-38، ق8، م10): مستويات محكية، تشخيص بمعيار 30% وحدّ 5 طلاب، جدول الفترات (ج)، الرصد والنقص، الأمان
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const R = { pass: 50, edge: 10, top: 90, severe: 30 };

/* ============ إحصاء بند ============ */
test('ssStat: العدد والمتوسط والنسبة، ودون حدّ الضعف وبحدّ متقن بالحدّين', () => {
  const app = loadApp();
  const st = J(app.ssStat([5, 9, 10, 4, 8], 10, R));
  assert.equal(st.n, 5);
  assert.equal(st.avg, 7.2);
  assert.equal(st.avgPct, 72);
  assert.equal(st.below, 1, '4 من 10 = 40% دون 50%');
  assert.equal(st.top, 2, '9 و10 ≥ 90%');
  assert.equal(st.belowShare, 20);
  assert.equal(st.topShare, 40);
  assert.equal(app.ssStat([], 10, R), null);
  assert.equal(app.ssStat([5], 0, R), null, 'درجة كاملة صفر');
  assert.equal(J(app.ssStat([5, 'x', null, 9], 10, R)).n, 2, 'غير الرقم يُهمَل');
  assert.equal(J(app.ssStat([5, 5], 10, { pass: 50, top: 90 })).below, 0, '50% ليس دون حدّ الضعف (حدّ شامل)');
});

/* ============ بنود الشعبة (والفترات) ============ */
const COL = (id, name, max, o) => Object.assign({ id, name, max_score: max, category: 'performance', kind: 'manual', measures: null }, o || {});
function items(cols, scores, bd, cfgs, ids){
  const app = loadApp();
  return J(runInAppContext(app, `
    const bd = new Map(Object.entries(${JSON.stringify(bd || {})}).map(([k, v]) => [k, new Map(Object.entries(v))]));
    const cfgs = ${JSON.stringify(cfgs || {})};
    ssBuildItems(${JSON.stringify(cols)}, ${JSON.stringify(scores)}, ${JSON.stringify(ids || ['a', 'b', 'c', 'd', 'e'])}, bd, c => cfgs[c.id] || null, ${JSON.stringify(R)}, id => null)`));
}
const S = (col, st, score) => ({ column_id: col, student_id: st, score });
const ALL = ['a', 'b', 'c', 'd', 'e'];

test('ssBuildItems: ما لم يُرصد لأحد لا يظهر، والمصنَّف بنوعه، والطلاب غير شعبة التقرير لا يدخلون', () => {
  const out = items([COL('t', 'اختبار', 10, { category: 'tests' }), COL('m', 'غير مرصود', 10, { kind: 'participation' }), COL('h', 'واجبات', 10, { kind: 'homework' })],
    ALL.map(i => S('t', i, 6)).concat(ALL.map(i => S('h', i, 8)), [S('t', 'غريب', 0)]));
  assert.deepEqual(out.map(i => i.name), ['اختبار', 'واجبات'], 'غير المرصود لا يُسمّى (م9)');
  assert.equal(out[0].domain, 'tahsili');
  assert.equal(out[1].domain, 'taalumi');
  assert.equal(out[0].total.n, 5, 'درجة «غريب» (طالب من شعبة أخرى) لا تدخل');
  assert.equal(out[0].total.avgPct, 60);
});

test('ssBuildItems: الفترات المنتهية فقط، ومتوسط الشعبة لكل فترة، وفترة واحدة معدودة بلا مجموعة', () => {
  const scores = ALL.map(i => S('m', i, 9)).concat(ALL.map(i => S('h', i, 6)));
  const bd = {
    m: Object.fromEntries(ALL.map((i, k) => [i, { p1: 8, p2: 10, p3: k === 0 ? 2 : null }])),
    h: Object.fromEntries(ALL.map(i => [i, { p1: 6, p2: 7, p3: null }]))
  };
  const out = items([COL('m', 'المشاركة', 10, { kind: 'participation' }), COL('h', 'الواجبات', 10, { kind: 'homework' })], scores, bd,
    { m: { n: 3, starts: ['2026-10-01', '2026-11-01'] }, h: { n: 2, starts: [] } });
  const m = out.find(i => i.id === 'm'), h = out.find(i => i.id === 'h');
  assert.deepEqual(m.periods.map(p => p.k), [1, 2], 'الثالثة جارية: لا تُعرض');
  assert.equal(m.periods[0].stat.avgPct, 80);
  assert.equal(m.periods[1].stat.avgPct, 100);
  assert.equal(m.total.avgPct, 90, 'الداخل في المجموع من كشف الشعبة');
  assert.deepEqual(h.periods, [], 'الثانية لم تبدأ: لا مجموعة');
  assert.equal(h.lonePeriod, 1, 'فترة واحدة معدودة تحمل رقمها');
});

/* ============ التشخيص ============ */
const IT = (name, pcts, o) => {
  const max = 10, vals = pcts.map(p => p / 10);
  const app = loadApp();
  return Object.assign({ id: name, name, measures: null, category: 'tests', kind: 'manual', tool_id: null, max, domain: 'tahsili', periods: [], lonePeriod: null,
    total: J(app.ssStat(vals, max, R)) }, o || {});
};
const dx = (its, groups) => J(loadApp().ssDiagnose(its, R, groups || []));

test('ضعف جماعي: 30% فأكثر من الطلاب دون حدّ الضعف (معيار واحد)', () => {
  const weak = dx([IT('اختبار', [30, 40, 45, 80, 90, 85, 70, 75, 60, 65])]);      /* 3 من 10 = 30% */
  assert.equal(weak.tahsili.weak.length, 1);
  assert.equal(weak.recs.length, 1);
  const ok = dx([IT('اختبار', [30, 40, 80, 90, 85, 70, 75, 60, 65, 70])]);        /* 2 من 10 = 20% */
  assert.equal(ok.tahsili.weak.length, 0);
  assert.deepEqual(ok.recs, [], 'بلا ضعف مثبت: لا توصيات (م1)');
});

test('قوة جماعية: 30% فأكثر بمستوى «متقن» وبشرط ألا يبلغ الضعف 30%', () => {
  assert.equal(dx([IT('أ', [95, 92, 91, 60, 70, 65, 62, 75, 80, 66])]).tahsili.strong.length, 1, '3 من 10 متقنون');
  assert.equal(dx([IT('أ', [95, 92, 91, 30, 20, 25, 62, 75, 80, 66])]).tahsili.strong.length, 0, 'وفيه ضعف جماعي أيضًا: ليس قوة');
  assert.equal(dx([IT('أ', [95, 60, 70, 65, 62, 75, 80, 66, 70, 72])]).tahsili.strong.length, 0, '10% فقط');
});

test('لا حكم على بند رُصد لأقل من 5 طلاب، ولا على غير المصنَّف', () => {
  const few = dx([IT('اختبار', [10, 20, 30, 15])]);
  assert.equal(few.tahsili.enough, false, '4 طلاب');
  assert.deepEqual(few.recs, []);
  assert.equal(dx([IT('اختبار', [10, 20, 30, 15, 20])]).tahsili.enough, true, '5 طلاب');
  const un = dx([IT('يدوي', [10, 20, 30, 15, 20, 10], { domain: null })]);
  assert.equal(un.tahsili.enough, false);
  assert.equal(un.taalumi.enough, false);
});

test('المستويان: تحصيلي وتعلّمي، والتوصية بسلسلة كاملة، و«يقيس» يدخل التسمية والإجراء', () => {
  const d = dx([IT('الاختبار الأول', [20, 30, 40, 80, 90, 85], { measures: 'القراءة' }),
    IT('الواجبات', [10, 20, 30, 40, 90, 95], { domain: 'taalumi', kind: 'homework', category: 'performance' })]);
  assert.equal(d.tahsili.weak.length, 1);
  assert.equal(d.taalumi.weak.length, 1);
  assert.equal(d.recs.length, 2);
  d.recs.forEach(r => assert.ok(r.evidence && r.diagnosis && r.action));
  const t = d.recs[0];
  assert.match(t.evidence, /3 من 6 طلاب|3 من 6 طالبًا/);
  assert.match(t.evidence, /القراءة \(الاختبار الأول\)/, 'يقيس + الاسم');
  assert.equal(t.diagnosis, 'ضعف جماعي في القراءة');
  assert.match(t.action, /إعادة تدريس القراءة/);
  assert.match(d.recs[1].action, /متابعة تسليم الواجبات|الواجبات/);
  assert.doesNotMatch(JSON.stringify(d.recs), /ضعاف|متفوقون/, 'لا تسميات نسبية (م10)');
});

test('التقدّم: فترات المكوّن، وبين اختبارات رُبطت أو تطابق «يقيس»، ولا بين اختبارات بلا علاقة (م2)', () => {
  const per = (k, pct) => ({ k, stat: J(loadApp().ssStat([pct / 10, pct / 10, pct / 10, pct / 10, pct / 10], 10, R)) });
  const withP = IT('المشاركة', [60, 60, 60, 60, 60], { domain: 'taalumi', kind: 'participation', category: 'performance', periods: [per(1, 80), per(2, 100)] });
  const a = dx([withP]);
  assert.equal(a.progress.length, 1);
  assert.equal(a.progress[0].trend, 'up');
  assert.equal(a.progress[0].from, 80);
  const t1 = IT('اختبار 1', [40, 40, 40, 40, 40], { measures: 'القراءة' }), t2 = IT('اختبار 2', [90, 90, 90, 90, 90], { measures: 'القراءة' });
  const same = dx([t1, t2]);
  assert.equal(same.progress.length, 1, 'تطابق يقيس');
  assert.equal(same.progress[0].label, 'كلاهما يقيس: القراءة');
  assert.equal(same.progress[0].from, 40);
  assert.equal(same.progress[0].to, 90);
  assert.equal(dx([IT('اختبار 1', [40, 40, 40, 40, 40]), IT('اختبار 2', [90, 90, 90, 90, 90])]).progress.length, 0, 'بلا علاقة');
  assert.equal(dx([IT('اختبار 1', [40, 40, 40, 40, 40]), IT('اختبار 2', [90, 90, 90, 90, 90])], [['اختبار 1', 'اختبار 2']]).progress[0].label, 'ربطهما المعلم');
});

/* ============ المستويات (محكية) ============ */
test('ssLevelCounts: بالحدّين فقط، لمكتملي الرصد، بلا بديل «الأعلى درجات» (م10)', () => {
  const app = loadApp();
  const rows = [95, 90, 89.9, 50, 49.9, 10].map((p, i) => ({ id: 'r' + i, name: 'ط' + i, points: p, pct: p, incomplete: false }))
    .concat([{ id: 'x', name: 'ناقص', points: 5, pct: 20, incomplete: true }, { id: 'y', name: 'فارغ', points: null, pct: null, incomplete: false }]);
  const c = J(app.ssLevelCounts(rows, R));
  assert.deepEqual(c, { recorded: 6, top: 2, mid: 2, low: 2 });
  /* لا أحد بلغ 90 والبديل مُفعَّل: يبقى top = 0 (لا «أعلى 3») */
  const none = J(app.ssLevelCounts([60, 70, 80].map((p, i) => ({ id: 'q' + i, name: 'ط', points: p, pct: p, incomplete: false })), Object.assign({ fallback: true }, R)));
  assert.equal(none.top, 0);
});

/* ============ الصفحة ============ */
function opened(extraSetup){
  const names = ['أحمد', 'بدر', 'جاسر', 'دخيل', 'عادل', 'فهد', 'ماجد', 'نواف'];
  const students = names.map((n, i) => ({ id: 's' + i, full_name: n, section_id: 'S' }));
  const cols = [COL('p', 'المشاركة', 20, { kind: 'participation' }), COL('h', 'الواجبات', 20, { kind: 'homework' }),
    COL('t1', 'الاختبار الأول', 20, { category: 'tests', measures: 'القراءة' }), COL('t2', 'الاختبار القصير', 10, { category: 'tests' })];
  const pcts = { p: [80, 85, 90, 70, 75, 60, 95, 65], h: [30, 40, 70, 45, 85, 60, 35, 90], t1: [30, 40, 45, 70, 48, 85, 60, 92], t2: [55, 62, 70, 58, 88, 75, 66, null] };
  const scores = [], bd = { p: {}, h: {} };
  students.forEach((st, i) => {
    ['p', 'h'].forEach(id => { const max = 20, a = pcts[id][i], b = Math.min(100, a + 6); bd[id][st.id] = { p1: max * a / 100, p2: max * b / 100, p3: null }; scores.push({ column_id: id, student_id: st.id, score: max * (a + b) / 200 }); });
    scores.push({ column_id: 't1', student_id: st.id, score: 20 * pcts.t1[i] / 100 });
    if(pcts.t2[i] !== null) scores.push({ column_id: 't2', student_id: st.id, score: 10 * pcts.t2[i] / 100 });
  });
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'معلم' } } });
  runInAppContext(app, `
    crmStudents = ${JSON.stringify(students)}; crmSections = [{ id: 'S', grade_level_id: 'G' }]; crmGradeLevels = [{ id: 'G', name: 'ثاني' }];
    crmSectionById = id => crmSections.find(s => s.id === id) || null; crmSectionLabel = () => 'ثاني متوسط — 3';
    appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => true;
    appFeatures = { periods: { '1448|1': { 'kind:participation': { n: 2, starts: ['2026-10-01'], ended: true }, 'kind:homework': { n: 2, starts: ['2026-10-01'], ended: true } } } };
    const bd = new Map(Object.entries(${JSON.stringify(bd)}).map(([k, v]) => [k, new Map(Object.entries(v))]));
    crmGrades = { sectionId: 'S', year: '1448', semester: 1, columns: ${JSON.stringify(cols)}, allColumns: ${JSON.stringify(cols)}, hiddenColumns: [], scores: ${JSON.stringify(scores)}, breakdown: bd };
    window.__modal = []; showInfoModal = h => window.__modal.push(h); openCrmGradeAnalysis(); ${extraSetup || ''}`);
  return app;
}
function build(app, ctxExtra, prefsOver){
  return runInAppContext(app, `ssBuildFromAnalysis(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis),
    Object.assign({}, gradeReportPrefsNow(), { school: 'مدرسة', teacher: 'معلم', vice: 'وكيل' }, ${JSON.stringify(prefsOver || {})}),
    Object.assign({ date: '2026-11-07', logo: '', schoolLogo: '' }, ${JSON.stringify(ctxExtra || {})}))`);
}

test('الصفحة: عنوان الشعبة، التسميات المحكية، ولا تسميات نسبية قديمة', async () => {
  const h = await build(opened());
  assert.match(h, /تقرير أداء الشعبة/);
  for(const l of ['متقن', 'جيد', 'يحتاج تحسين']) assert.match(h, new RegExp(l));
  assert.doesNotMatch(h, /ضعاف|متفوقون|متوسطون|الأعلى درجات/);
  assert.match(h, /font-family:'Helvetica Neue W23 for SKY'/);
  assert.match(h, /<div class="sgn"><div><small>معلم<\/small>معلم المادة<\/div><div><small>وكيل<\/small>وكيل شؤون الطلاب<\/div>/);
  assert.doesNotMatch(h, /class="gr"/, 'ليس تصميم تقارير الدرجات القديم');
  assert.match(h, /<div class="fin">[\s\S]*<div class="sgn">[\s\S]*<\/div><div class="strip">/, 'آخر قسم والتوقيع في كتلة لا تنقسم: لا ينزل التوقيع وحده لصفحة');
});

test('جدول البنود (ج بأرقام الشعبة): فترات منتهية مدمجة، دون حدّ الضعف، الداخل في المجموع، و«يقيس»', async () => {
  const h = await build(opened());
  assert.match(h, /<th class="n">دون حدّ الضعف<\/th><th class="n">الداخل في المجموع<\/th>/);
  assert.match(h, /<td rowspan="2" class="gn"><b>المشاركة<\/b><\/td><td class="n">الأولى<\/td>/);
  assert.match(h, /<td rowspan="2" class="gn"><b>الواجبات<\/b><\/td>/);
  assert.match(h, /<td><b>الاختبار الأول<\/b><div class="ev">يقيس: القراءة<\/div><\/td><td class="n">—<\/td>/);
  assert.match(h, /<tbody class="grp">/);
  assert.match(h, /دون حدّ الضعف|من <bdi dir="ltr">8<\/bdi>/);
});

test('الخلاصة: ضعف جماعي بمعيار 30% وتوصية بدليل، وحدّ 5 طلاب', async () => {
  const h = await build(opened());
  /* الواجبات: 4 من 8 دون 50% (50%) ← ضعف جماعي */
  assert.match(h, /ضعف جماعي:<\/b> الواجبات/);
  assert.match(h, /<b>الدليل:<\/b> 4 من 8 طالبًا \(50%\) دون 50% في الواجبات/);
  assert.match(h, /<b>التشخيص:<\/b> ضعف جماعي في الواجبات/);
  assert.match(h, /4 من 8 طالبًا \(50%\) دون 50% في القراءة \(الاختبار الأول\)/, '«يقيس» في الخلاصة');
  assert.match(h, /التقدّم \(بين فترتين منتهيتين\)/);
});

test('الرصد غير المكتمل يظهر عدده دائمًا، والأسماء بالخيار فقط (استثناء م9 لتقارير الصف)', async () => {
  const app = opened();
  const plain = await build(app);
  assert.match(plain, /الرصد غير المكتمل/);
  assert.match(plain, /<bdi dir="ltr">1<\/bdi> طالب لم تكتمل درجاته/);
  assert.doesNotMatch(plain, /نواف/, 'لا أسماء بلا الخيار');
  assert.doesNotMatch(plain, /قائمة الطلاب/);
  const named = await build(app, { withNames: true });
  assert.match(named, /لم تكتمل درجاتهم|لم تكتمل درجاته[^<]*: نواف|: نواف/);
  assert.match(named, /قائمة الطلاب \(من الأدنى نسبةً\)/);
  assert.match(named, /<table class="rs2">/);
  assert.match(named, /أحمد/);
});

test('خيارا المستويات والبنود في الإعدادات يُحترمان، والتشخيص دائم', async () => {
  const h = await build(opened(), {}, { show: { levels: false, items: false, stats: true, names: false, compare: false } });
  assert.doesNotMatch(h, /<h2>مستويات الطلاب<\/h2>/);
  assert.doesNotMatch(h, /<h2>متوسط الشعبة في البنود<\/h2>/);
  assert.match(h, /التشخيص: ماذا يتقن الطلاب/);
});

test('المقارنة بالفصل السابق بالهوية الجديدة، وأسماؤها بخيار الأسماء فقط، وتُهرَّب', async () => {
  const app = opened();
  const prev = { sum: { compared: 6, up: [{ id: 's0', prev: 40, now: 70, delta: 30 }], down: [{ id: 's1', prev: 80, now: 50, delta: -30 }], avgDelta: 2 }, names: new Map([['s0', '<b>أحمد</b>'], ['s1', 'بدر']]) };
  runInAppContext(app, `window.__prev = { sum: ${JSON.stringify(prev.sum)}, names: new Map([['s0', '<b>أحمد</b>'], ['s1', 'بدر']]) };`);
  const without = await runInAppContext(app, `ssBuildFromAnalysis(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', logo: '', schoolLogo: '', prev: window.__prev })`);
  assert.match(without, /<h2>مقارنة بالفصل السابق<\/h2>/);
  assert.match(without, /تحسّنوا/);
  assert.doesNotMatch(without, /الأكثر تراجعًا|أحمد/, 'بلا أسماء');
  const withN = await runInAppContext(app, `ssBuildFromAnalysis(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', logo: '', schoolLogo: '', withNames: true, prev: window.__prev })`);
  assert.match(withN, /الأكثر تراجعًا/);
  assert.match(withN, /&lt;b&gt;أحمد&lt;\/b&gt;/);
  assert.doesNotMatch(withN, /<b>أحمد<\/b>/);
  assert.equal((await build(app)).includes('مقارنة بالفصل السابق'), false);
});

test('XSS: اسم البند وما يقيسه والمدرسة والمعلم والوكيل وأسماء الطلاب كلها تُهرَّب', async () => {
  const X = '<img src=x onerror=alert(1)>';
  const app = opened(`crmGrades.columns[2].name = ${JSON.stringify(X)}; crmGrades.columns[2].measures = ${JSON.stringify(X)}; crmStudents[7].full_name = ${JSON.stringify(X)};
    crmGradeAnalysis = null; openCrmGradeAnalysis();`);
  const h = await build(app, { withNames: true }, { school: X, teacher: X, vice: X });
  assert.doesNotMatch(h, /<img src=x/);
  assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 4);
});

test('تشخيص الصف لا يتأثر بخيار «مع التعليق التربوي»، ولا استعلام داخل الوحدة', async () => {
  const app = opened();
  runInAppContext(app, 'crmGradeAnalysis.withNotes = true;');
  const on = await build(app);
  runInAppContext(app, 'crmGradeAnalysis.withNotes = false;');
  const off = await build(app);
  assert.equal(on, off);
  const src = read('app/app-38-section-report.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /sb\.from|\.rpc\(|fetch\(/, 'من الكشف المحمَّل فقط');
});

/* ============ الدمج ============ */
test('التصدير: المجموع بالتصميم الجديد، والبند الواحد بالقديم حتى يُناقش', async () => {
  const run = key => {
    const app = opened(`crmGradeAnalysis.key = ${JSON.stringify(key)}; window.__out = []; gradeReportRun = async (btn, build) => { window.__out.push(await build()); };
      gradeReportLogoData = async () => ''; gradeReportSchoolLogoData = async () => ''; window.__p = exportGradeReport(null);`);
    return app.__p.then(() => app.__out[0]);
  };
  const total = await run('total');
  assert.match(total.html, /تقرير أداء الشعبة/);
  assert.match(total.mark.right, /تقرير أداء الشعبة/);
  assert.doesNotMatch(total.html, /class="gr"/);
  const item = await run('t1');
  assert.match(item.html, /class="gr"/, 'تقرير البند الواحد بالتصميم القديم');
  assert.match(item.html, /تحليل نتائج الدرجات/);
});

/* ============ الأمان والتسجيل ============ */
test('أصناف الوحدة لا تتعارض مع style.css', () => {
  const src = read('app/app-38-section-report.js');
  const block = src.slice(src.indexOf('const SS_CSS = `'), src.indexOf('`;', src.indexOf('const SS_CSS = `')));
  const names = [...new Set([...block.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]))].filter(n => n !== 'sr');
  assert.ok(names.length >= 4);
  const clashes = [];
  read('style.css').split('\n').forEach((line, i) => {
    if(!line.includes('{')) return;
    line.split('{')[0].split(',').forEach(sel => names.forEach(n => { if(new RegExp('^\\s*(?:#printArea\\s+)?\\.' + n + '(?![A-Za-z0-9_-])').test(sel)) clashes.push(`.${n} @ style.css:${i + 1}`); }));
  });
  assert.deepEqual(clashes, []);
});

test('الملف مسجَّل بـindex.html وAPP_SHELL', () => {
  assert.match(read('index.html'), /app\/app-38-section-report\.js/);
  assert.match(read('sw.js'), /\.\/app\/app-38-section-report\.js/);
});
