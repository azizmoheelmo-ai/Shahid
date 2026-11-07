'use strict';
/* ============================================================
   تقرير مقارنة شعب الصف (app-39، ق9، م10): تصنيف مشترك/خاص/تباين، ترتيب المعلم، صفوف الفترات، بلا أسماء ولا أحكام
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

/* ============ التصنيف ============ */
const stat = (app, pcts) => J(app.ssStat(pcts.map(p => p / 10), 10, R));
function sec(app, label, spec){
  return { label, items: Object.entries(spec).map(([name, o]) => Object.assign({ name, measures: null, domain: 'tahsili', category: 'tests', periods: [], lonePeriod: null, total: stat(app, o.pcts) }, o.extra || {})) };
}
const W = [30, 40, 45, 35, 70, 75, 80, 85, 60, 65, 70, 55];   /* 4 من 12 = 33% دون الحدّ */
const S = [95, 92, 91, 90, 70, 75, 80, 65, 60, 85, 72, 68];   /* 4 من 12 = 33% متقنون */
const M = [70, 75, 80, 65, 60, 85, 72, 68, 78, 82, 55, 66];   /* لا هذا ولا ذاك */

test('sgClassify: ضعف مشترك، قوة مشتركة، ضعف/قوة في بعض الشعب، وتباين', () => {
  const app = loadApp();
  const kinds = secs => J(app.sgClassify(secs)).map(c => [c.name, c.kind]);
  const sw = kinds([sec(app, 'أ', { 'ب1': { pcts: W } }), sec(app, 'ب', { 'ب1': { pcts: W } })]);
  assert.deepEqual(sw, [['ب1', 'sharedWeak']]);
  assert.deepEqual(kinds([sec(app, 'أ', { 'ب1': { pcts: S } }), sec(app, 'ب', { 'ب1': { pcts: S } })]), [['ب1', 'sharedStrong']]);
  assert.deepEqual(kinds([sec(app, 'أ', { 'ب1': { pcts: M } }), sec(app, 'ب', { 'ب1': { pcts: W } }), sec(app, 'ج', { 'ب1': { pcts: M } })]), [['ب1', 'weakSome']]);
  assert.deepEqual(kinds([sec(app, 'أ', { 'ب1': { pcts: S } }), sec(app, 'ب', { 'ب1': { pcts: M } })]), [['ب1', 'strongSome']]);
  assert.deepEqual(kinds([sec(app, 'أ', { 'ب1': { pcts: S } }), sec(app, 'ب', { 'ب1': { pcts: W } })]), [['ب1', 'contrast']]);
  assert.deepEqual(kinds([sec(app, 'أ', { 'ب1': { pcts: M } }), sec(app, 'ب', { 'ب1': { pcts: M } })]), [['ب1', null]], 'لا قوة ولا ضعف: يبقى بالجدول بلا تشخيص');
});

test('sgClassify: بند في شعبة واحدة لا يُقارَن، وأقل من 5 طلاب لا يدخل، والمطابقة بالاسم المطبَّع، وغير المصنَّف بلا حكم', () => {
  const app = loadApp();
  const cls = secs => J(app.sgClassify(secs));
  assert.deepEqual(cls([sec(app, 'أ', { 'ب1': { pcts: W }, 'ب2': { pcts: W } }), sec(app, 'ب', { 'ب1': { pcts: W } })]).map(c => c.name), ['ب1'], 'ب2 في شعبة واحدة');
  assert.deepEqual(cls([sec(app, 'أ', { 'ب1': { pcts: [10, 20, 30, 15] } }), sec(app, 'ب', { 'ب1': { pcts: W } })]), [], 'شعبة بأقل من 5 طلاب: بند بشعبة واحدة فقط');
  assert.equal(cls([sec(app, 'أ', { 'اختبار  أول': { pcts: W } }), sec(app, 'ب', { 'اختبار أول': { pcts: W } })]).length, 1, 'فراغات مطبَّعة');
  const un = cls([sec(app, 'أ', { 'ب1': { pcts: W, extra: { domain: null } } }), sec(app, 'ب', { 'ب1': { pcts: W, extra: { domain: null } } })]);
  assert.equal(un.length, 1);
  assert.equal(un[0].kind, null, 'غير المصنَّف يظهر بلا حكم');
});

test('sgRecommendations: سلسلة كاملة بلا تفسير سببي، وللتباين «لا تحدّد سببه»، وبلا ضعف/تباين لا توصية', () => {
  const app = loadApp();
  const rc = secs => J(app.sgRecommendations(app.sgClassify(secs)));
  const shared = rc([sec(app, 'أ', { 'الواجبات': { pcts: W } }), sec(app, 'ب', { 'الواجبات': { pcts: W } })]);
  assert.equal(shared.length, 1);
  assert.match(shared[0].diagnosis, /ضعف مشترك بين الشعب/);
  assert.match(shared[0].action, /إعادة تدريس/);
  const some = rc([sec(app, 'أ', { 'ق': { pcts: M } }), sec(app, 'ب', { 'ق': { pcts: W } })]);
  assert.match(some[0].diagnosis, /ضعف خاص بـب/);
  assert.match(some[0].action, /دعم موجَّه لـب/);
  const con = rc([sec(app, 'أ', { 'القواعد': { pcts: S, extra: { measures: 'القواعد' } } }), sec(app, 'ب', { 'القواعد': { pcts: W, extra: { measures: 'القواعد' } } })]);
  assert.match(con[0].evidence, /قوة في أ، وضعف في ب/);
  assert.match(con[0].diagnosis, /لا تحدّد سببه/);
  assert.match(con[0].action, /مقارنة ما اختلف في تدريس القواعد بين أ وب/);
  [shared, some, con].flat().forEach(r => { assert.ok(r.evidence && r.diagnosis && r.action); assert.doesNotMatch(r.diagnosis + r.action, /غالبًا|بسبب|نتيجة لـ/, 'لا تفسير سببي (م1)'); });
  assert.deepEqual(rc([sec(app, 'أ', { 'ب': { pcts: M } }), sec(app, 'ب', { 'ب': { pcts: S } })]), [], 'قوة في بعض الشعب بلا توصية');
});

/* ============ الصفحة (من مسار التحليل) ============ */
const DATA = {
  A: { p: [95, 92, 91, 90, 70, 75, 80, 65, 60, 85, 72, 68], h: [30, 40, 45, 35, 70, 75, 80, 85, 60, 65, 90, 55], t1: [70, 75, 80, 85, 60, 65, 90, 55, 72, 68, 78, 82], t2: [95, 92, 91, 90, 70, 75, 80, 65, 60, 85, 72, 68] },
  B: { p: [70, 75, 80, 65, 60, 85, 72, 68, 78, 82, 55, 66], h: [30, 40, 45, 35, 70, 75, 80, 85, 60, 65, 90, 55], t1: [70, 75, 80, 85, 60, 65, 90, 55, 72, 68, 78, 82], t2: [70, 60, 65, 72, 68, 75, 80, 66, 62, 64, 58, 77] },
  C: { p: [70, 75, 80, 65, 60, 85, 72, 68, 78, 82, 55, 66], h: [25, 30, 40, 35, 45, 70, 75, 80, 60, 65, 50, 55], t1: [30, 40, 45, 35, 70, 75, 80, 85, 60, 65, 90, 55], t2: [30, 40, 45, 35, 70, 75, 80, 85, 60, 65, 50, 55] }
};
function sheet(sid, only){
  const cols = [{ id: sid + 'p', section_id: sid, category: 'performance', name: 'المشاركة', max_score: 20, kind: 'participation', measures: null }, { id: sid + 'h', section_id: sid, category: 'performance', name: 'الواجبات', max_score: 20, kind: 'homework', measures: null },
    { id: sid + 't1', section_id: sid, category: 'tests', name: 'الاختبار الأول', max_score: 20, kind: 'manual', measures: 'القراءة' }, { id: sid + 't2', section_id: sid, category: 'tests', name: 'الاختبار القصير', max_score: 10, kind: 'manual', measures: 'القواعد' }];
  const students = [], scores = [], bd = { p: {}, h: {} };
  for(let i = 0; i < 12; i++){
    const id = sid + 's' + i; students.push({ id, full_name: 'طالب سري ' + sid + i, section_id: sid });
    ['p', 'h'].forEach(k => { const a = DATA[sid][k][i], b = Math.min(100, a + 8); bd[k][id] = { p1: +(20 * a / 100).toFixed(2), p2: +(20 * b / 100).toFixed(2), p3: null }; scores.push({ column_id: sid + k, student_id: id, score: +(20 * (a + b) / 200).toFixed(2) }); });
    ['t1', 't2'].forEach(k => scores.push({ column_id: sid + k, student_id: id, score: +((k === 't2' ? 10 : 20) * DATA[sid][k][i] / 100).toFixed(2) }));
  }
  return { sectionId: sid, year: '1448', semester: 1, columns: cols, allColumns: cols, hiddenColumns: [], scores: scores.filter(s => !only || only(s)), students, bd };
}
function groupEnv(opts){
  opts = opts || {};
  const sheets = (opts.ids || ['A', 'B', 'C']).map(id => sheet(id));
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'معلم' } } });
  runInAppContext(app, `
    const SH = ${JSON.stringify(sheets)};
    crmStudents = SH.flatMap(s => s.students);
    crmSections = ${JSON.stringify(opts.sections || sheets.map(s => ({ id: s.sectionId, grade_level_id: 'G' })))};
    crmGradeLevels = [{ id: 'G', name: 'ثاني متوسط' }];
    crmSectionById = id => crmSections.find(s => s.id === id) || null;
    crmSectionLabel = id => ({ A: 'ثانية أول', B: 'ثانية سادس', C: 'ثانية سابع' })[id] || id;
    appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => true;
    appFeatures = { periods: { '1448|1': { 'kind:participation': { n: 2, starts: ['2026-10-01'], ended: true }, 'kind:homework': { n: 2, starts: ['2026-10-01'], ended: true } } } };
    const mkG = s => Object.assign({}, s, { breakdown: new Map(Object.entries(s.bd).map(([k, v]) => [s.sectionId + k, new Map(Object.entries(v))])) });
    window.__loads = [];
    loadCrmGradeSheet = async id => { window.__loads.push(id); const s = SH.find(x => x.sectionId === id); return s ? mkG(s) : { error: new Error('لا كشف') }; };
    crmGrades = mkG(SH[0]); window.__modal = []; showInfoModal = h => window.__modal.push(h); openCrmGradeAnalysis(); ${opts.setup || ''}`);
  return app;
}
function build(app, prefsOver){
  return runInAppContext(app, `sgBuildFromAnalysis(crmGradeAnalysis, Object.assign({}, gradeReportPrefsNow(), { school: 'مدرسة', teacher: 'معلم', vice: 'وكيل' }, ${JSON.stringify(prefsOver || {})}), { date: '2026-11-07', logo: '', schoolLogo: '' })`);
}

test('الصفحة: ترتيب الشعب كترتيب المعلم لا بالحروف ولا بالمتوسط، والنطاق في الترويسة، وبلا أسماء طلاب', async () => {
  const app = groupEnv();
  const h = await build(app);
  assert.match(h, /تقرير مقارنة شعب الصف/);
  const i1 = h.indexOf('ثانية أول'), i2 = h.indexOf('ثانية سادس'), i3 = h.indexOf('ثانية سابع');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, 'أول ثم سادس ثم سابع (الأبجدية تضع سابع قبل سادس)');
  assert.match(h, /<small>شعب المعلم من الصف نفسه<\/small><b>ثانية أول، ثانية سادس، ثانية سابع<\/b>/);
  assert.doesNotMatch(h, /طالب سري/, 'لا أسماء طلاب');
  assert.doesNotMatch(h, /الأفضل|الأضعف|الأولى بين|المركز/, 'بلا ترتيب أو أحكام على الشعب');
  assert.match(h, /font-family:'Helvetica Neue W23 for SKY'/);
  assert.deepEqual(J(app.__loads).sort(), ['B', 'C'], 'الشعبة الحالية من الكشف المحمَّل، والأخريان فقط تُحمَّلان');
});

test('ترتيب المعلم يُتَّبع حتى لو اختلف (ج ثم أ ثم ب)', async () => {
  const app = groupEnv({ sections: [{ id: 'C', grade_level_id: 'G' }, { id: 'A', grade_level_id: 'G' }, { id: 'B', grade_level_id: 'G' }] });
  const h = await build(app);
  const i1 = h.indexOf('ثانية أول'), i2 = h.indexOf('ثانية سادس'), i3 = h.indexOf('ثانية سابع');
  assert.ok(i3 < i1 && i1 < i2);
});

test('جدول المستويات: حصة كل مستوى بالتسميات المحكية، ولا تسميات قديمة', async () => {
  const h = await build(groupEnv());
  assert.match(h, /<th class="n">متقن<\/th><th class="n">جيد<\/th><th class="n">يحتاج تحسين<\/th>/);
  assert.doesNotMatch(h, /ضعاف|متفوقون|متوسطون/);
  assert.match(h, /class="sgstk"/);
});

test('جدول البنود: صفوف الفترات ثم «الداخل في المجموع» (وعليه التلوين)، والبند بلا فترات صف واحد، و«يقيس»', async () => {
  const h = await build(groupEnv());
  assert.match(h, /<td rowspan="3" class="gn"><b>المشاركة<\/b><\/td><td class="n">الأولى<\/td>/, 'فترتان + صف المجموع');
  assert.match(h, /<td class="n">الثانية<\/td>/);
  assert.match(h, /<tr class="sgtot"><td class="n">الداخل في المجموع<\/td>/);
  assert.match(h, /<td class="gn"><b>الاختبار الأول<\/b><div class="ev">يقيس: القراءة<\/div><\/td><td class="n">—<\/td>/);
  assert.match(h, /color:#07a869;font-weight:700/, 'قوة (المشاركة في أول)');
  assert.match(h, /color:#7258a4;font-weight:700/, 'ضعف');
  assert.match(h, /<tbody class="grp">/);
});

test('التشخيص والتوصيات: مشترك، بعض الشعب، تباين — بصياغة محايدة بلا تفسير سببي', async () => {
  const h = await build(groupEnv());
  assert.match(h, /ضعف مشترك:<\/b> الواجبات — في كل الشعب/);
  assert.match(h, /قوة في بعض الشعب:<\/b> المشاركة — ثانية أول/);
  assert.match(h, /ضعف في بعض الشعب:<\/b> القراءة \(الاختبار الأول\) — ثانية سابع/);
  assert.match(h, /تباين بين الشعب:<\/b> القواعد \(الاختبار القصير\) — قوة في ثانية أول/);
  assert.match(h, /<b>التشخيص:<\/b> ضعف مشترك بين الشعب في هذا البند/);
  assert.match(h, /والبيانات لا تحدّد سببه/);
  assert.match(h, /<b>الإجراء المقترح:<\/b> مقارنة ما اختلف في تدريس القواعد بين ثانية أول وثانية سابع/);
  assert.doesNotMatch(h, /غالبًا في الدرس|بسبب/);
});

test('لا مؤشرات إحصائية مجمَّعة ولا تعليق عام (ق10)، وخيارا المستويات والبنود يُحترمان، وخيار التعليق لا يؤثر', async () => {
  const app = groupEnv();
  const h = await build(app);
  assert.doesNotMatch(h, /المؤشرات الإحصائية|أقل درجة|أعلى درجة|الوسيط/, 'حُذفت (لا تخدم تحسين الممارسة وتخفي الفروق بين الشعب)');
  const forced = await build(app, { show: { levels: true, items: true, stats: true, names: false, compare: false } });
  assert.doesNotMatch(forced, /المؤشرات الإحصائية|أقل درجة/, 'حتى لو شُغّل الخيار القديم');
  const none = await build(app, { show: { levels: false, items: false, stats: false, names: false, compare: false } });
  assert.doesNotMatch(none, /<h2>مقارنة مستويات الطلاب|<h2>مقارنة البنود بين الشعب/);
  assert.match(none, /التشخيص: ماذا يتقن الطلاب/);
  assert.doesNotMatch(h, /أعلى الشعب تحصيلًا|يرجّح أن السبب/, 'لا تعليق عام ولا ترتيب ولا سبب');
  runInAppContext(app, 'crmGradeAnalysis.withNotes = true;');
  const on = await build(app);
  runInAppContext(app, 'crmGradeAnalysis.withNotes = false;');
  assert.equal(on, await build(app));
});

test('XSS: اسم الشعبة واسم البند وما يقيسه والمدرسة والمعلم والوكيل كلها تُهرَّب', async () => {
  const X = '<img src=x onerror=alert(1)>';
  const app = groupEnv({ setup: `crmSectionLabel = id => ({ A: ${JSON.stringify(X)}, B: 'ب', C: 'ج' })[id];
    SH.forEach(s => { s.columns[2].name = ${JSON.stringify(X)}; s.columns[2].measures = ${JSON.stringify(X)}; }); crmGrades = mkG(SH[0]); crmGradeAnalysis = null; openCrmGradeAnalysis();` });
  const h = await build(app, { school: X, teacher: X, vice: X });
  assert.doesNotMatch(h, /<img src=x/);
  assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 6);
});

test('شعبة واحدة بدرجات أو شعبتان بلا درجات: تنبيه ولا تقرير، وخطأ تحميل شعبة يُرمى', async () => {
  const app = groupEnv({ ids: ['A', 'B'], setup: `window.__t = []; showToast = (m, k) => window.__t.push([m, k]); loadCrmGradeSheet = async id => id === 'A' ? crmGrades : Object.assign(mkG(SH[1]), { scores: [] });` });
  assert.equal(await build(app), '');
  assert.match(app.__t[0][0], /لا بيانات مرصودة كافية في شعب الصف للمقارنة/);
  const bad = groupEnv({ setup: `loadCrmGradeSheet = async id => id === 'A' ? crmGrades : { error: new Error('فشل') };` });
  await assert.rejects(() => build(bad), /فشل/);
});

/* ============ الدمج ============ */
test('التصدير: المجموع وبند واحد كلاهما بالتصميم الجديد (ق11)، وشعبة واحدة تنبيه كما كان', async () => {
  const run = (key, extra) => {
    const app = groupEnv({ ids: extra && extra.ids, setup: `crmGradeAnalysis.key = ${JSON.stringify(key)}; crmGradeAnalysis.scope = 'group'; window.__out = []; window.__t = []; window.__raw = 0; showToast = (m, k) => window.__t.push(m);
      loadGradeSheetsRaw = async ids => { window.__raw++; return []; };
      gradeReportRun = async (btn, build) => { window.__out.push(await build()); }; gradeReportLogoData = async () => ''; gradeReportSchoolLogoData = async () => ''; window.__p = exportGradeReport(null);` });
    return app.__p.then(() => app);
  };
  const total = await run('total');
  assert.match(total.__out[0].html, /تقرير مقارنة شعب الصف/);
  assert.match(total.__out[0].mark.right, /تقرير مقارنة شعب الصف/);
  assert.doesNotMatch(total.__out[0].html, /class="gr"/);
  assert.doesNotMatch(total.__out[0].html, /البند \(تقرير بند واحد\)/);
  assert.equal(total.__raw, 0, 'لا مسار الكشوف الخام القديم');
  const item = await run('At1');
  assert.equal(item.__raw, 0, 'البند الواحد أيضًا بالمسار الجديد');
  const h = item.__out[0].html;
  assert.match(h, /تقرير مقارنة شعب الصف/);
  assert.doesNotMatch(h, /class="gr"|تحليل نتائج المجموعة/, 'لا التصميم القديم');
  assert.match(h, /<small>البند \(تقرير بند واحد\)<\/small><b>الاختبار الأول<\/b>/);
  assert.match(h, /<h2>مقارنة مستويات الطلاب في هذا البند بين الشعب<\/h2>/);
  assert.match(h, /<td class="gn"><b>الاختبار الأول<\/b><div class="ev">يقيس: القراءة<\/div><\/td>/);
  assert.doesNotMatch(h, /<b>الواجبات<\/b>|<b>المشاركة<\/b>/, 'البند المختار وحده');
  assert.match(h, /ضعف في بعض الشعب:<\/b> القراءة \(الاختبار الأول\) — ثانية سابع/);
  assert.doesNotMatch(h, /<tr class="sgtot">/, 'بند بلا فترات: لا صف مجموع');
  const single = groupEnv({ sections: [{ id: 'A', grade_level_id: 'G' }, { id: 'B', grade_level_id: 'H' }, { id: 'C', grade_level_id: 'H' }], setup: `crmGradeAnalysis.scope = 'group'; window.__out = []; window.__t = []; showToast = (m, k) => window.__t.push(m);
    gradeReportRun = async (btn, build) => { window.__out.push(await build()); }; window.__p = exportGradeReport(null);` });
  await single.__p;
  assert.match(single.__t.join(' '), /لا شعب أخرى لهذا الصف/);
});

test('تقرير بند واحد لمجموعة الشعب: شعبة بلا هذا العمود لا تدخل، وبشعبة واحدة تنبيه ولا تقرير', async () => {
  const app = groupEnv({ setup: `SH[2].columns = SH[2].columns.filter(c => c.id !== 'Ct1'); SH[2].scores = SH[2].scores.filter(s => s.column_id !== 'Ct1');
    crmGradeAnalysis.key = 'At1'; window.__t = []; showToast = (m, k) => window.__t.push(m);` });
  const h = await build(app);
  assert.match(h, /ثانية أول/);
  assert.match(h, /ثانية سادس/);
  assert.doesNotMatch(h, /ثانية سابع/, 'شعبة بلا الاختبار الأول لا تدخل');
  const one = groupEnv({ setup: `SH[1].columns = SH[1].columns.filter(c => c.id !== 'Bt1'); SH[1].scores = SH[1].scores.filter(s => s.column_id !== 'Bt1');
    SH[2].columns = SH[2].columns.filter(c => c.id !== 'Ct1'); SH[2].scores = SH[2].scores.filter(s => s.column_id !== 'Ct1');
    crmGradeAnalysis.key = 'At1'; window.__t = []; showToast = (m, k) => window.__t.push(m);` });
  assert.equal(await build(one), '');
  assert.match(one.__t.join(' '), /لا بيانات مرصودة كافية في شعب الصف للمقارنة/);
});

/* ============ الأمان والتسجيل ============ */
test('أصناف الوحدة لا تتعارض مع style.css، ولا استعلام مباشر داخلها', () => {
  const src = read('app/app-39-group-report.js');
  const block = src.slice(src.indexOf('const SG_CSS = `'), src.indexOf('`;', src.indexOf('const SG_CSS = `')));
  const names = [...new Set([...block.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]))].filter(n => n !== 'sr');
  assert.ok(names.length >= 4);
  const clashes = [];
  read('style.css').split('\n').forEach((line, i) => {
    if(!line.includes('{')) return;
    line.split('{')[0].split(',').forEach(sel => names.forEach(n => { if(new RegExp('^\\s*(?:#printArea\\s+)?\\.' + n + '(?![A-Za-z0-9_-])').test(sel)) clashes.push(`.${n} @ style.css:${i + 1}`); }));
  });
  assert.deepEqual(clashes, []);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /sb\.from|\.rpc\(|fetch\(/, 'التحميل عبر loadCrmGradeSheet فقط');
});

test('الملف مسجَّل بـindex.html وAPP_SHELL', () => {
  assert.match(read('index.html'), /app\/app-39-group-report\.js/);
  assert.match(read('sw.js'), /\.\/app\/app-39-group-report\.js/);
});
