'use strict';
/* ============================================================
   تقارير الدرجات PDF (app-34): خيارات المعلم، التعليق الشرطي، الأقسام، الأمان
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const C = (id, category, name, max) => ({ id, section_id: 'S', category, name, max_score: max, kind: 'manual' });
const S = (column_id, student_id, score) => ({ column_id, student_id, score });
/* الأداء من 40، والاختبار من 20 (الاختبارات مفعّلة) */
const COLS = [C('p', 'performance', 'المشاركة', 40), C('t', 'tests', 'الاختبار الأول', 20)];
const NAMES = { a: 'أحمد', b: 'بدر', c: 'جاسر', d: 'دخيل', e: 'عادل' };
/* نسب الأداء: 25% · 55% · 75% · 90% · 100% */
const SCORES = [S('p', 'a', 10), S('p', 'b', 22), S('p', 'c', 30), S('p', 'd', 36), S('p', 'e', 40),
  S('t', 'a', 4), S('t', 'b', 11), S('t', 'c', 15), S('t', 'd', 18), S('t', 'e', 20)];

function opened(extra, features){
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'عبدالعزيز المطيري' } } });
  runInAppContext(app, `
    crmStudents = ${JSON.stringify(Object.entries(NAMES).map(([id, full_name]) => ({ id, full_name, section_id: 'S' })))};
    crmSections = [{ id: 'S', grade_level_id: 'G' }, { id: 'S2', grade_level_id: 'G' }];
    crmGradeLevels = [{ id: 'G', name: 'ثاني ثانوي' }];
    crmSectionById = id => crmSections.find(s => s.id === id) || null;
    crmSectionLabel = id => id === 'S' ? 'ثاني ثانوي / 6' : 'ثاني ثانوي / 7';
    appGradeCaps = () => ({ performance: 40, tests: 20 }); appToolOn = () => true;
    appFeatures = ${JSON.stringify(features || {})};
    crmGrades = { sectionId: 'S', year: '2025-2026', semester: 1, columns: ${JSON.stringify(COLS)}, allColumns: ${JSON.stringify(COLS)}, hiddenColumns: [], scores: ${JSON.stringify(SCORES)} };
    window.__modal = []; showInfoModal = h => window.__modal.push(h); openCrmGradeAnalysis(); ${extra || ''}`);
  return app;
}
const CTX = "{ date: '2026-11-05', withNames: false }";
/* التعليق التربوي مطفأ افتراضيًا؛ هذه خيارات معلم فعّله كله */
const NOTES_ON = { reportPrefs: { notes: { reading: true, strengths: true, weaknesses: true, plans: true } } };

test('normalizeReportPrefs — الافتراضي = null، وتُنقَّى القيم، وتُقصّ الأسماء', async () => {
  const app = loadApp();
  assert.equal(app.normalizeReportPrefs(null), null);
  assert.equal(app.normalizeReportPrefs({ school: '  ', show: { levels: true } }), null, 'مطابق للافتراضي');
  const n = JSON.parse(JSON.stringify(app.normalizeReportPrefs({ school: '  ثانوية   بدر  ', vice: 5, teacher: 'س'.repeat(200), show: { names: true, levels: 'no', hack: true }, notes: { plans: false } })));
  assert.equal(n.school, 'ثانوية بدر');
  assert.equal(n.vice, '', 'غير النص يُهمَل');
  assert.equal(n.teacher.length, 80);
  assert.equal(n.show.names, true);
  assert.equal(n.show.levels, true, 'قيمة غير منطقية = الافتراضي');
  assert.equal(n.show.hack, undefined);
  assert.equal(n.notes.plans, false);
  assert.equal(n.notes.reading, false, 'التعليق التربوي مطفأ افتراضيًا');
  const on = JSON.parse(JSON.stringify(app.normalizeReportPrefs({ notes: { plans: true } })));
  assert.equal(on.notes.plans, true);
  assert.equal(on.notes.reading, false);
});

test('الأصل في كل التقارير (شعبة · بند · مجموعة · طالب): بلا تعليق تربوي، وبلا شعار أو هوية جهة', async () => {
  const app = opened(`crmGradeAnalysis.key = 'p';
    window.__sec = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__stu = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { date: 'd' });
    window.__def = gradeReportPrefsNow().notes;`);
  assert.deepEqual(JSON.parse(JSON.stringify(app.__def)), { reading: false, strengths: false, weaknesses: false, plans: false });
  for(const html of [app.__sec, app.__stu]){
    for(const gone of ['قراءة تربوية', 'نقاط القوة', 'نقاط الضعف وفرص التحسين', 'الخطط العلاجية والتوصيات', 'التواصل مع ولي الأمر'])
      assert.doesNotMatch(html, new RegExp(gone), gone);
    assert.doesNotMatch(html, /<img/, 'لا شعار');
    assert.doesNotMatch(html, /#07a869\}\.gr \.hd|border-bottom:3px solid #07a869/, 'لا لون هوية الوزارة بالترويسة');
  }
  const group = runInAppContext(app, `gradeReportGroupHtml({ gradeName: 'ثاني', key: 'total', colLabel: 'المجموع', displayMax: 60, pooled: analyzeGradeRows([], 60),
    secs: [{ label: 'ش1', s: Object.assign(analyzeGradeRows([{ id: 'x', name: 'x', points: 30, pct: 50, recordedMax: 60, partial: false }], 60), {}), levels: { top: 0, mid: 0, low: 0 }, items: [] }, { label: 'ش2', s: analyzeGradeRows([{ id: 'y', name: 'y', points: 40, pct: 66, recordedMax: 60, partial: false }], 60), levels: { top: 0, mid: 1, low: 0 }, items: [] }] }, gradeReportPrefsNow(), { date: 'd' })`);
  assert.doesNotMatch(group, /قراءة تربوية|نقاط القوة|الخطط العلاجية/);
  assert.doesNotMatch(group, /<img/);
});

test('تصدير النافذة: «مع التعليق التربوي» مفتاح اختياري، وبدونه لا تعليق حتى لو ضبط المعلم خيارات سابقة', async () => {
  const app = opened(`window.__off = gradeReportPrefsForRun(gradeReportPrefsNow(), false).notes;
    window.__onDefault = gradeReportPrefsForRun(gradeReportPrefsNow(), true).notes;
    window.__initial = crmGradeAnalysis.withNotes;`);
  assert.deepEqual(JSON.parse(JSON.stringify(app.__off)), { reading: false, strengths: false, weaknesses: false, plans: false });
  assert.deepEqual(JSON.parse(JSON.stringify(app.__onDefault)), { reading: true, strengths: true, weaknesses: true, plans: true }, 'لم يختر المعلم أقسامًا: كلها عند الطلب');
  assert.equal(app.__initial, false);
  const mine = opened(`window.__off = gradeReportPrefsForRun(gradeReportPrefsNow(), false).notes; window.__on = gradeReportPrefsForRun(gradeReportPrefsNow(), true).notes; window.__initial = crmGradeAnalysis.withNotes;`,
    { reportPrefs: { notes: { plans: true } } });
  assert.deepEqual(JSON.parse(JSON.stringify(mine.__off)), { reading: false, strengths: false, weaknesses: false, plans: false });
  assert.deepEqual(JSON.parse(JSON.stringify(mine.__on)), { reading: false, strengths: false, weaknesses: false, plans: true }, 'ما اختاره المعلم فقط');
  assert.equal(mine.__initial, true, 'من فعّل قسمًا يبدأ المفتاح عنده مفعّلًا');
});

test('normalizeFeatures يحتفظ بخيارات التقارير، ويُسقط المفسود', async () => {
  const app = loadApp();
  const keep = JSON.parse(JSON.stringify(app.normalizeFeatures({ reportPrefs: { school: 'م', notes: { reading: false } } })));
  assert.equal(keep.reportPrefs.school, 'م');
  assert.equal(keep.reportPrefs.notes.reading, false);
  assert.equal(app.normalizeFeatures({ reportPrefs: 'x' }).reportPrefs, undefined);
});

test('اسم المعلم تلقائي من الحساب، ويغلبه ما كتبه المعلم', async () => {
  const app = opened('');
  assert.equal(app.gradeReportTeacherName({ teacher: '' }), 'عبدالعزيز المطيري');
  assert.equal(app.gradeReportTeacherName({ teacher: 'أ. فلان' }), 'أ. فلان');
});

test('التعليق التربوي شرطي على الأرقام: ضعف · هامش قليل · تفوق → خطة علاجية وإثرائية', async () => {
  const app = opened(`window.__v = gradeAnalysisView(crmGradeAnalysis);
    window.__n = gradeReportSectionNotes({ s: __v.stats, displayMax: __v.displayMax, items: gradeReportItems(crmGradeAnalysis.g, crmGradeAnalysis.students), isTotal: true });`);
  const n = app.__n;
  const flat = k => [...n[k]].join(' ');
  assert.match(flat('plans'), /مراجعة أوراق الطلاب/);
  assert.doesNotMatch(flat('plans') + flat('weaknesses') + flat('reading') + flat('strengths'), /على الحافة|نجاح|نجحوا|ناجح|رسوب/, 'لا لغة نجاح ولا «على الحافة» في التعليق');
  assert.match(flat('plans'), /إثرائية/);
  assert.match(flat('plans'), /مقارنة نتائج التقييم التالي/);
  assert.match(flat('weaknesses'), /أقل من <bdi dir="ltr">50%<\/bdi>/);
  assert.match(flat('strengths'), /90%/);
  assert.match(flat('reading'), /المتوسط/);
});

test('بلا ضعف: لا خطة علاجية ولا نقطة ضعف، والقراءة تقول لا طالب أقل من حدّ الضعاف', async () => {
  const app = opened('');
  const s = JSON.parse(JSON.stringify(runInAppContext(app, `analyzeGradeRows(gradeAnalysisRows(crmGradeAnalysis.g, crmGradeAnalysis.students.slice(2), 'p', { performance: 40, tests: 20 }, true).rows, 40)`)));
  app.__s = runInAppContext(app, `gradeAnalysisRows(crmGradeAnalysis.g, crmGradeAnalysis.students.slice(2), 'p', { performance: 40, tests: 20 }, true)`);
  runInAppContext(app, `window.__n = gradeReportSectionNotes({ s: analyzeGradeRows(__s.rows, 40), displayMax: 40, items: [], isTotal: false });`);
  assert.equal(s.groups.low.length, 0);
  assert.equal(app.__n.weaknesses.length, 0);
  assert.doesNotMatch([...app.__n.plans].join(' '), /مراجعة أوراق الطلاب/);
  assert.match([...app.__n.reading].join(' '), /لا طالب أقل من <bdi dir="ltr">50%<\/bdi>/);
});

test('تقرير الشعبة: العنوان عام (لا اسم عمود فيه)، وتفصيل البند في جسم التقرير', async () => {
  const app = opened(`crmGradeAnalysis.key = 'p'; window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    crmGradeAnalysis.key = 'total'; window.__t = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});`);
  const h1 = html => /<h1>(.*?)<\/h1>/.exec(html)[1];
  assert.equal(h1(app.__h), 'تحليل نتائج الدرجات — الشعبة');
  assert.doesNotMatch(h1(app.__h), /المشاركة/);
  assert.match(app.__h, /البند المحلَّل: المشاركة/);
  assert.match(app.__h, /المحلَّل/, 'البند المحلَّل مظلَّل في قائمة البنود');
  assert.doesNotMatch(app.__t, /البند المحلَّل:/);
  assert.match(app.__t, /تحليل نتائج الدرجات — الشعبة/);
  assert.match(app.__t, /متوسط درجات البنود/);
});

test('ما يُطبع بيد المعلم: الأقسام والتعليق يُحذفان بإيقافهما، والأسماء بطلب فقط', async () => {
  const off = { reportPrefs: { show: { levels: false, stats: false, items: false }, notes: { reading: false, strengths: false, weaknesses: false, plans: false } } };
  const app = opened(`window.__x = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});`, off);
  for(const gone of ['مستويات الطلاب', 'أدنى وأعلى درجة', 'الوسيط', 'متوسط درجات البنود', 'قراءة تربوية', 'نقاط القوة', 'نقاط الضعف', 'الخطط العلاجية'])
    assert.doesNotMatch(app.__x, new RegExp(gone), gone);
  const on = opened(`window.__x = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__n = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', withNames: true });`, NOTES_ON);
  for(const here of ['مستويات الطلاب', 'أدنى وأعلى درجة', 'قراءة تربوية', 'نقاط القوة', 'نقاط الضعف وفرص التحسين', 'الخطط العلاجية والتوصيات'])
    assert.match(on.__x, new RegExp(here), here);
  assert.doesNotMatch(on.__x, /<td>أحمد<\/td>/, 'بلا أسماء افتراضيًا');
  assert.match(on.__n, /<td>أحمد<\/td>/);
  assert.match(on.__n, /<div class="gh w"><b>الضعاف<\/b>/);
});

test('XSS: اسم المدرسة والمعلم والوكيل وأسماء الطلاب كلها بـ escapeHtml', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const prefs = { reportPrefs: { school: bad, teacher: bad, vice: bad, subject: bad } };
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', withNames: true });
    crmStudents[0].full_name = '${bad}'; crmGradeAnalysis.students = crmStudentsOfSection('S');
    window.__h2 = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', withNames: true });
    window.__sd = gradeReportStudentHtml(gradeReportStudentData(crmGrades, crmStudentsOfSection('S').find(x => x.full_name.startsWith('<')).id), gradeReportPrefsNow(), { date: 'd' });`, prefs);
  for(const h of [app.__h, app.__h2, app.__sd]) assert.doesNotMatch(h, /<img src=x/);
  assert.match(app.__h, /&lt;img src=x/);
});

test('التوقيع: المعلم (تلقائي) ووكيل شؤون الطلاب، وولي الأمر لتقرير الطالب فقط', async () => {
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__s = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'e'), gradeReportPrefsNow(), { date: 'd' });`, { reportPrefs: { school: 'ثانوية بدر', vice: 'أ. سامي' } });
  assert.match(app.__h, /ثانوية بدر/);
  assert.match(app.__h, /عبدالعزيز المطيري/);
  assert.match(app.__h, /وكيل شؤون الطلاب<b>أ\. سامي/);
  assert.doesNotMatch(app.__h, /ولي الأمر/);
  assert.match(app.__s, /ولي الأمر/);
});

test('تقرير الطالب: الدرجة والفارق عن متوسط الشعبة، ونقاط القوة/الضعف من الفروق', async () => {
  const app = opened(`window.__d = gradeReportStudentData(crmGrades, 'a'); window.__top = gradeReportStudentData(crmGrades, 'e');
    window.__h = gradeReportStudentHtml(__d, gradeReportPrefsNow(), { date: 'd' });`, NOTES_ON);
  const d = JSON.parse(JSON.stringify(app.__d));
  assert.equal(d.name, 'أحمد');
  assert.equal(d.max, 60);
  assert.equal(d.items.length, 2);
  assert.ok(d.pts < d.classPts, 'الطالب a أدنى من متوسط الشعبة');
  assert.match(app.__h, /تقرير أداء طالب/);
  assert.match(app.__h, /ضعيف/);
  assert.match(app.__h, /التواصل مع ولي الأمر/);
  const e = JSON.parse(JSON.stringify(app.__top));
  assert.ok(e.pts > e.classPts);
  const notes = JSON.parse(JSON.stringify(runInAppContext(app, `gradeReportStudentNotes({ pts: __top.pts, max: __top.max, pct: __top.pct, classPts: __top.classPts, classPct: __top.classPct, items: __top.items, rules: __top.rules })`)));
  assert.ok(notes.strengths.length >= 1);
  assert.equal(notes.weaknesses.length, 0);
});

test('تقرير الطالب: الفارق السالب بلون التحذير، والموجب بالأزرق', async () => {
  const app = opened(`window.__lo = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { date: 'd' });
    window.__hi = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'e'), gradeReportPrefsNow(), { date: 'd' });`);
  assert.match(app.__lo, /<div class="r"><b><bdi dir="ltr">-/);
  assert.match(app.__hi, /<div class="b"><b><bdi dir="ltr">\+/);
});

test('مقارنة الفصل السابق: السهم من القديم إلى الجديد', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /Math\.round\(r\.prev\) \+ '% → ' \+ Math\.round\(r\.now\)/);
});

test('المادة: من حقل الملف الشخصي تلقائيًا، وما كتبه المعلم يغلبه، وتظهر في العنوان', async () => {
  const app = opened(`getProfileSubject = () => 'الفيزياء'; getProfileSchool = () => 'مدرسة الملف';
    window.__auto = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    appFeatures = { reportPrefs: { subject: 'الكيمياء', school: 'مدرستي' } };
    window.__own = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});`);
  assert.match(app.__auto, /<b>المادة: الفيزياء<\/b>/);
  assert.match(app.__auto, /<small>مدرسة الملف<\/small>/);
  assert.match(app.__own, /<b>المادة: الكيمياء<\/b>/);
  assert.doesNotMatch(app.__own, /الفيزياء/);
  assert.match(app.__own, /<small>مدرستي<\/small>/);
  const none = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});`);
  assert.doesNotMatch(none.__h, /المادة:/, 'بلا مادة: لا سطر فارغ');
});

test('قوائم الأسماء: ثلاثة أعمدة بالنسبة، ونجمة وتنبيه ظاهر قبل الجداول لمن رُصد له جزء', async () => {
  const app = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(s => !(s.student_id === 'a' && s.column_id === 't')) });
    crmGradeAnalysis.g = crmGrades;
    window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', withNames: true });`);
  const h = app.__h;
  assert.match(h, /<th>اسم الطالب<\/th><th class="n">الدرجة<\/th><th class="n">النسبة<\/th>/);
  assert.match(h, /<td>أحمد <b style="color:#7258a4">\*<\/b><\/td>/, 'النجمة بجانب الاسم');
  assert.doesNotMatch(h, /مرتّبة بالنسبة المئوية|الأسماء مرتبة/, 'لا سطر ترتيب فوق القوائم');
  assert.match(h, /رُصد لهم جزء من الأعمدة فنسبة كل منهم مما رُصد له \(يُشار إليهم بنجمة \*\)/, 'شرح النجمة في الحاشية');
  assert.ok(h.indexOf('<div class="c3">') < h.indexOf('معيار المستويات'), 'القوائم قبل الحاشية');
  assert.match(h, /1 رُصد لهم جزء|رُصد لهم جزء/, 'تنبيه تحت عدد الطلاب أيضًا');
  const full = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { date: 'd', withNames: true });`);
  assert.doesNotMatch(full.__h, /<b style="color:#7258a4">\*<\/b>/, 'بلا نقص: بلا نجمة');
  assert.doesNotMatch(full.__h, /رُصد له جزء من الأعمدة فقط/);
});

test('القوائم بعناصر يدوية (لا ul/ol) حتى لا ينقل html2canvas العلامات للجهة الخطأ', async () => {
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});`, NOTES_ON);
  assert.doesNotMatch(app.__h, /<(ul|ol|li)[ >]/);
  assert.match(app.__h, /class="li"><span class="mk"><bdi dir="ltr">1\.<\/bdi><\/span>/);
  assert.match(app.__h, /class="li"><span class="mk">•<\/span>/);
});

test('التوقيع: خط توقيع لكل خانة', async () => {
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__s = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { date: 'd' });`);
  assert.equal((app.__h.match(/class="ln"/g) || []).length, 2);
  assert.equal((app.__s.match(/class="ln"/g) || []).length, 3, 'مع ولي الأمر');
  assert.match(app.__h, /<small>التوقيع<\/small>/);
});

test('gradeReportMark: العنوان والشعبة والمادة يمين، والمدرسة يسار', async () => {
  const app = opened(`window.__m = gradeReportMark({ subject: 'الفيزياء', school: 'ثانوية بدر' }, 'تحليل نتائج الدرجات', 'ثاني ثانوي / 6');`);
  assert.equal(app.__m.right, 'تحليل نتائج الدرجات · ثاني ثانوي / 6 · الفيزياء');
  assert.equal(app.__m.left, 'ثانوية بدر');
});

test('الطباعة بنص حقيقي: CSS الصفحة (ترويسة صفحات 2+، ترقيم، هامش) وتهريب النص', async () => {
  const app = opened(`window.__css = gradeReportPrintCss(${JSON.stringify({ right: 'تقرير "خطير" \\ سطر\nثانٍ', left: 'مدرسة' })}); window.__none = gradeReportPrintCss(null);`);
  const css = app.__css;
  assert.match(css, /@page\{size:A4;margin:/);
  assert.match(css, /@top-right\{content:"تقرير خطير  سطر ثانٍ"/, 'الاقتباس والشرطة المائلة تُحذف والسطر الجديد مسافة');
  assert.match(css, /@top-left\{content:"مدرسة"/);
  assert.match(css, /@page :first\{@top-right\{content:none\}@top-left\{content:none\}\}/, 'لا ترويسة مصغّرة بالصفحة 1');
  assert.match(css, /@bottom-center\{content:"صفحة " counter\(page\) " \/ " counter\(pages\)/);
  assert.match(css, /#printArea\.wrap\{max-width:none;padding-bottom:0\}/, 'padding-bottom:70px لـ.wrap يولّد صفحة فارغة');
  assert.doesNotMatch(app.__none, /@top-right\{content:"/);
});

test('CSS التقرير للطباعة: ألوان الأشرطة تُطبع، والكتل لا تُقسَم، والحشوة تُصفَّر', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /print-color-adjust:exact/);
  assert.match(src, /@media print\{\.gr\{padding:0\}\.gr \.pdf-avoid-break\{break-inside:avoid/);
});

test('gradeReportPrint: يضع التقرير في #printArea ويطبع، ويُنظَّف بعد الطباعة', async () => {
  const app = opened(`window.__printed = 0; window.__handlers = [];
    const area = { innerHTML: '', querySelector: sel => area.innerHTML.includes('class="gr"') ? {} : null };
    document.getElementById = id => id === 'printArea' ? area : null; window.__area = area;
    printNow = () => { window.__printed++; };
    window.addEventListener = (ev, fn) => window.__handlers.push([ev, fn]); window.removeEventListener = () => {};
    gradeReportPrint('<div class="gr">تقرير</div>', { right: 'ي', left: 'ش' });
    window.__during = area.innerHTML; window.__ev = window.__handlers[0] && window.__handlers[0][0]; window.__handlers[0][1]();`);
  assert.equal(app.__printed, 1);
  assert.match(app.__during, /^<style>@page\{/);
  assert.match(app.__during, /<div class="gr">تقرير<\/div>/);
  assert.equal(app.__ev, 'afterprint');
  assert.equal(app.__area.innerHTML, '', 'بعد الطباعة يُفرَّغ فلا يبقى @page يؤثر في طباعات أخرى');
});

test('gradeReportPrint: عنوان الصفحة اسم الملف المقترح أثناء الطباعة ثم يُعاد', async () => {
  const app = opened(`window.__printed = 0; window.__titles = []; window.__handlers = [];
    const area = { innerHTML: '', querySelector: () => ({}) };
    document.getElementById = id => id === 'printArea' ? area : null; document.title = 'شاهد';
    printNow = () => { window.__printed++; window.__titles.push(document.title); };
    window.addEventListener = (ev, fn) => window.__handlers.push(fn); window.removeEventListener = () => {};
    gradeReportPrint('<div class="gr">x</div>', null, 'تقرير-درجات-ثاني-6');
    window.__during = document.title; window.__handlers[0]();
    window.__after = document.title;
    gradeReportPrint('<div class="gr">y</div>', null, 'ثانٍ'); gradeReportPrint('<div class="gr">z</div>', null, 'ثالث');
    window.__handlers[window.__handlers.length - 1](); window.__final = document.title;`);
  assert.equal(app.__during, 'تقرير-درجات-ثاني-6');
  assert.equal(app.__after, 'شاهد');
  assert.equal(app.__final, 'شاهد', 'طباعتان متتاليتان بلا afterprint بينهما لا تُضيعان العنوان الأصلي');
});

test('التقرير يطبع بنص حقيقي فقط: لا html2canvas ولا jsPDF ولا صور للصفحات', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  for(const gone of ['html2canvas', 'jsPDF', 'jspdf', 'addPdfPagesMulti', 'ensurePdfLibs', 'toDataURL', 'gradeReportAddMarks'])
    assert.doesNotMatch(src, new RegExp(gone), gone);
});

test('gradeReportRun: يطبع الناتج، ويتوقف عند الفراغ، ويمنع النقر المزدوج، ويعيد الزر', async () => {
  const app = opened(`window.__n = 0; window.__args = null; gradeReportPrint = (h, m, t) => { window.__n++; if(window.__n === 1) window.__args = [h, m, t]; };
    window.__r = (async () => {
      await gradeReportRun(null, async () => ({ html: '<div class="gr">x</div>', mark: { right: 'ي' } }), 'اسم-الملف');
      window.__afterOk = gradeReportBusy;
      await gradeReportRun(null, async () => '', 'f'); window.__afterEmpty = window.__n;
      const first = gradeReportRun(null, async () => { await new Promise(r => setTimeout(r, 20)); return { html: '<b class="gr">1</b>' }; }, 'a');
      await gradeReportRun(null, async () => ({ html: '<b class="gr">2</b>' }), 'b');
      await first; window.__total = window.__n;
      await gradeReportRun(null, async () => { throw new Error('boom'); }, 'e'); window.__afterErr = gradeReportBusy; })();`);
  await app.__r;
  assert.match(app.__args[0], /class="gr">x</);
  assert.equal(app.__args[1].right, 'ي');
  assert.equal(app.__args[2], 'اسم-الملف', 'الاسم المقترح للملف يصل للطباعة');
  assert.equal(app.__afterOk, false);
  assert.equal(app.__afterEmpty, 1, 'فارغ لا يطبع');
  assert.equal(app.__total, 2, 'الطباعة الثانية أثناء الأولى لم تُنفَّذ');
  assert.equal(app.__afterErr, false, 'الخطأ لا يترك الحالة مشغولة');
});

test('زر واحد بدل زرين: PDF — طباعة / حفظ، في النافذة وصفحة الطالب', async () => {
  const app = opened(`crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.equal((app.__d.match(/exportGradeReport\(this\)/g) || []).length, 1);
  assert.doesNotMatch(app.__d, /exportCrmGradeAnalysis\('pdf'/, 'زر الصورة القديم أُزيل');
  assert.doesNotMatch(app.__d, /تجريبي/);
  assert.match(app.__d, /⤓ PDF للطباعة/);
  assert.doesNotMatch(app.__d, /الوزارة/, 'لا هوية وزارة في الأزرار');
  const grades = fs.readFileSync(path.join(root, 'app/app-17-grades.js'), 'utf8');
  assert.equal((grades.match(/exportCrmStudentReport\(this\)/g) || []).length, 1);
  assert.doesNotMatch(grades, /exportCrmStudentReport\(this, 'print'\)/);
});

test('شعار الوزارة: يظهر بترويسة كل التقارير حين يتوفر، وغيابه لا يمنع التقرير، وكل مسارات التصدير تمرّره', async () => {
  const app = opened(`const v = gradeAnalysisView(crmGradeAnalysis);
    window.__with = gradeReportSectionHtml(crmGradeAnalysis, v, gradeReportPrefsNow(), { logo: 'data:image/png;base64,AAAA', date: 'd' });
    window.__without = gradeReportSectionHtml(crmGradeAnalysis, v, gradeReportPrefsNow(), { date: 'd' });
    window.__stu = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { logo: 'data:image/png;base64,AAAA', date: 'd' });
    gradeReportLogoData = async () => 'data:image/png;base64,LOGO'; window.__runs = [];
    gradeReportRun = async (btn, build) => { window.__runs.push((await build()).html); };
    window.__p = Promise.all([exportGradeReport(null), exportCrmStudentReportFor('a', null, 'ولي الأمر'), (toggleCrmGaReportTo('*'), exportCrmAllStudentReports(null, 'ولي الأمر'))]);`);
  await app.__p;
  assert.match(app.__with, /<img src="data:image\/png;base64,AAAA" alt="">/);
  assert.doesNotMatch(app.__without, /<img/);
  assert.match(app.__without, /<span class="lg"><\/span>/, 'بلا شعار: خانة فارغة ولا انهيار');
  assert.match(app.__stu, /<img src="data:image\/png;base64,AAAA"/);
  assert.equal(app.__runs.length, 3);
  for(const h of app.__runs) assert.match(h, /<img src="data:image\/png;base64,LOGO"/, 'تقرير الشعبة والطالب والجماعي كلها بالشعار');
  const css = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(css, /\.gr \.hd img\{height:54px\}/);
});

test('تقرير الشعبة بالأسماء (33 طالبًا) لا يتجاوز صفحتين: تباعد مضغوط وهوامش الشعار (1.5 سم)', async () => {
  const css = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  /* قيم القياس الفعلي (Chromium بخط Cairo، بتوزيع تقرير المعلم): 33 ← صفحتان، و45 ← صفحتان */
  assert.match(css, /\.gr h2\{[^}]*margin:10px 0 6px/);
  assert.match(css, /\.gr td\{padding:2\.5px 7px/);
  assert.match(css, /\.gr \.sig\{margin-top:10px/);
  assert.match(css, /\.gr \.kp>div\{[^}]*padding:5px 4px/);
  assert.match(css, /@page\{size:A4;margin:15mm 15mm 14mm;/, 'مسافة آمنة 1.5 سم حول الشعار');
});

test('هوية الوزارة: ألوان اللوحة فقط، «ضعاف» بنفسجي #7258a4 بلا بني، والتدرج أزرق يسارًا وأخضر يمينًا', async () => {
  const css = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  const block = css.slice(css.indexOf('const GRADE_REPORT_CSS'), css.indexOf('@media print{.gr{padding:0}'));
  assert.match(block, /\.gr \.tn\{background:#7258a4\}/, 'ضعاف بنفسجي');
  assert.match(block, /linear-gradient\(90deg,#3B83B7,#4CB176\)/);
  assert.match(block, /h1\{[^}]*color:#351375/);
  assert.doesNotMatch(block, /#A9852E|#a85d3a|#c1b489|#9c6a45|#8a6d1d/i, 'لا ذهبي ولا بني ولا رملي');
});

test('لا لغة نجاح ورسوب في أي تقرير: الشعبة (بالأسماء وبلا) والمجموعة والطالب', async () => {
  const app = opened(`const v = gradeAnalysisView(crmGradeAnalysis); const prefs = gradeReportPrefsNow();
    window.__a = gradeReportSectionHtml(crmGradeAnalysis, v, prefs, { date: 'd', withNames: true });
    window.__b = gradeReportSectionHtml(crmGradeAnalysis, v, prefs, { date: 'd', withNames: false });
    window.__s = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), prefs, { date: 'd' });
    const st = crmStudentsOfSection('S'); const res = gradeAnalysisRows(crmGrades, st, 'total', { performance: 40, tests: 20 }, true);
    const sec = { label: 'ش1', s: analyzeGradeRows(res.rows, res.displayMax), levels: gradeReportLevels(res.rows, v.stats.rules), items: gradeReportItems(crmGrades, st) };
    window.__g = gradeReportGroupHtml({ gradeName: 'ثاني', key: 'total', colLabel: 'المجموع', secs: [sec, Object.assign({}, sec, { label: 'ش2' })], pooled: sec.s, displayMax: res.displayMax }, prefs, { date: 'd' });
    window.__x = gradeAnalysisExportRows(crmGradeAnalysis, v, true);`, NOTES_ON);
  for(const k of ['__a', '__b', '__s', '__g']) assert.doesNotMatch(app[k], /نجاح|ناجح|نجحوا|رسوب|الحافة|جيد/, k);
  assert.doesNotMatch(JSON.stringify(app.__x), /ناجحون|نجاح/, 'Excel');
  for(const k of ['__a', '__b', '__g']) assert.doesNotMatch(app[k], /nbox|>ملاحظات</, 'لا خانة ملاحظات بالأسفل');
  assert.doesNotMatch(app.__a, /الأسماء مرتبة بالنسبة/, 'لا سطر ترتيب فوق القوائم');
  assert.match(app.__a, /<span class="cp w">ضعاف<\/span>/);
});

test('الطباعة تنتظر فكّ صورة الشعار (وإلا خرجت الترويسة بلا شعار)، وفشل تحميل الشعار لا يُخزَّن', async () => {
  const app = opened(`window.__printed = 0; let release; const gate = new Promise(r => { release = r; });
    const area = { innerHTML: '', querySelector: () => ({}), querySelectorAll: sel => sel === 'img' ? [{ decode: () => gate }] : [] };
    document.getElementById = id => id === 'printArea' ? area : null;
    printNow = () => { window.__printed++; };
    window.addEventListener = () => {}; window.removeEventListener = () => {};
    window.__p = gradeReportPrint('<div class="gr"><img src="data:image/png;base64,AA"></div>', null);
    window.__before = window.__printed; window.__release = release;`);
  assert.equal(app.__before, 0, 'لا طباعة قبل فكّ الصورة');
  app.__release();
  await app.__p;
  assert.equal(app.__printed, 1);
  const f = opened(`fetch = () => Promise.reject(new Error('x')); window.__r = gradeReportLogoData(); `);
  assert.equal(await f.__r, '');
  assert.equal(runInAppContext(f, 'gradeReportLogoCache'), null, 'الفشل لا يُخزَّن فيُعاد المحاولة بالتصدير التالي');
});

test('gradeReportFit: يضغط التباعد تدريجيًا فقط حين يزيد التقرير قليلًا عن صفحة، ولا يلمس ما يناسب أو ما يطول كثيرًا', async () => {
  const run = heights => {
    const app = opened(`const H = ${JSON.stringify(heights)};
      document.createElement = () => { const probe = { style: {}, remove() {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; },
        querySelector: () => ({ style: {}, get offsetHeight() { const m = /class="gr( (cmp\\d))?"/.exec(probe._h); return H[m && m[2] ? m[2] : 'base']; } }) }; return probe; };
      window.__r = gradeReportFit('<style>x</style><div class="gr">تقرير</div>');`);
    return (/class="gr( cmp\d)?"/.exec(app.__r) || [])[1] || '';
  };
  assert.equal(run({ base: 980, cmp1: 900, cmp2: 880 }), '', 'يناسب صفحة: لا ضغط');
  assert.equal(run({ base: 1060, cmp1: 970, cmp2: 940 }).trim(), 'cmp1');
  assert.equal(run({ base: 1100, cmp1: 1010, cmp2: 960 }).trim(), 'cmp2');
  assert.equal(run({ base: 1100, cmp1: 1050, cmp2: 1020 }), '', 'لا ينفع الضغط: يبقى التصميم الأصلي');
  assert.equal(run({ base: 1400, cmp1: 900, cmp2: 800 }), '', 'أطول من أن يُنقذه الضغط: صفحتان كما هو');
  const css = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(css, /\.gr\.cmp1 td\{padding:1\.5px 7px\}/);
});

test('طالب بلا درجات: لا انهيار، ولا يُحسب صفرًا', async () => {
  const app = opened(`crmGrades = Object.assign({}, crmGrades, { scores: [] });
    window.__d = gradeReportStudentData(crmGrades, 'a'); window.__h = gradeReportStudentHtml(__d, gradeReportPrefsNow(), { date: 'd' });`, NOTES_ON);
  assert.equal(app.__d.pts, null);
  assert.match(app.__h, /لم تُرصد درجات لهذا الطالب بعد/);
});

test('تقرير مجموعة الشعب: مقارنة الأعلى والأدنى وجملة السبب بحسب الفارق', async () => {
  const mk = (label, avgPct, low, rec) => `{ label: '${label}', s: { avgPct: ${avgPct}, passRate: ${100 - Math.round(100 * low / rec)}, recorded: ${rec}, groups: { low: new Array(${low}).fill(0) } } }`;
  const app = opened(`window.__big = gradeReportGroupNotes({ secs: [${mk('ش1', 70, 2, 30)}, ${mk('ش2', 50, 15, 30)}] });
    window.__small = gradeReportGroupNotes({ secs: [${mk('ش1', 62, 2, 30)}, ${mk('ش2', 55, 5, 30)}] });`);
  assert.match([...app.__big.reading].join(' '), /السبب في الشعبة/);
  assert.match([...app.__big.plans].join(' '), /جلسة مراجعة/);
  assert.match([...app.__small.reading].join(' '), /الفارق محدود/);
  assert.doesNotMatch([...app.__small.plans].join(' '), /جلسة مراجعة/);
});

test('تقرير المجموعة: الجداول بأسماء الشعب، ومصفوفة البنود تحترم خيار «درجات البنود»', async () => {
  const run = prefs => {
    const app = opened(`const st = crmStudentsOfSection('S'); const res = gradeAnalysisRows(crmGrades, st, 'total', { performance: 40, tests: 20 }, true);
      const s = analyzeGradeRows(res.rows, res.displayMax); const sec = { label: 'ش<1>', s, levels: gradeReportLevels(res.rows, s.rules), items: gradeReportItems(crmGrades, st) };
      const d = { gradeName: 'ثاني ثانوي', key: 'total', colLabel: 'المجموع', secs: [sec, Object.assign({}, sec, { label: 'ش2' })], pooled: s, displayMax: res.displayMax };
      window.__h = gradeReportGroupHtml(d, gradeReportPrefsNow(), ${CTX});`, prefs);
    return app.__h;
  };
  const on = run({});
  assert.match(on, /تحليل نتائج المجموعة — شعب الصف/);
  assert.match(on, /مقارنة الشعب في كل بند/);
  assert.match(on, /ش&lt;1&gt;/, 'اسم الشعبة مُهرَّب');
  assert.doesNotMatch(run({ reportPrefs: { show: { items: false } } }), /مقارنة الشعب في كل بند/);
});

test('نافذة التحليل: نطاق التقرير، وزر PDF، ومفتاح التعليق التربوي، وخيارات التقرير', async () => {
  const app = opened(`crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /id="crmGaScope"/);
  assert.match(app.__d, /id="crmGaNotes" onchange/, 'مفتاح التعليق التربوي غير مفعّل افتراضيًا');
  assert.match(app.__d, /exportGradeReport\(this\)/);
  assert.match(app.__d, /openGradeReportEditor\('ga'\)/);
  assert.match(app.__d, /<option value="group"[^>]*>كل شعب الصف/);
  const solo = opened(`crmSections = [{ id: 'S', grade_level_id: 'G' }]; crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(solo.__d, /<option value="group"[^>]*disabled[^>]*>/, 'بلا شعب أخرى: الخيار معطّل');
});

test('التصدير بنقرتين: PDF وExcel ظاهران دون فتح الخيارات، والخيارات مطوية افتراضيًا', async () => {
  const app = opened(`window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /onclick="exportGradeReport\(this\)"/, 'PDF ظاهر مباشرة');
  assert.match(app.__d, /exportCrmGradeAnalysis\('xlsx', this\)/, 'Excel ظاهر مباشرة');
  assert.doesNotMatch(app.__d, /id="crmGaScope"/, 'النطاق والخانات مطوية حتى يفتح المعلم الخيارات');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.crm-ga-bot\{position:sticky;bottom:-24px;/, 'الشريط يلتصق بحافة النافذة لا بحافة المحتوى (حشو confirm-box = 24px) فلا يظهر محتوى تحته');
});

test('تقرير ولي الأمر: زر «تقرير» بجانب كل اسم في قائمة الطلاب، ويُنتج تقرير ذلك الطالب وحده', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; crmGradeAnalysis.open = 'low'; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = exportCrmStudentReportFor('a', null);`);
  await app.__p;
  const shownNames = (app.__d.match(/class="crm-ga-name"/g) || []).length;
  assert.ok(shownNames >= 1);
  assert.equal((app.__d.match(/toggleCrmGaReportTo\('(?!\*)/g) || []).length, shownNames, 'سهم لكل اسم ظاهر');
  assert.equal(app.__calls.length, 1);
  assert.match(app.__calls[0].out.html, /أحمد/);
  assert.doesNotMatch(app.__calls[0].out.html, /بدر|جاسر|دخيل|عادل/, 'لا أسماء طلاب آخرين في تقرير ولي الأمر');
  assert.match(app.__calls[0].filename, /^تقرير-طالب-أحمد-/);
  assert.match(app.__d, /title="تنزيل تقرير الطالب"[^>]*onclick="toggleCrmGaReportTo\('a'\)">⤓<\/button>/, 'سهم فقط بلا نص');
});

test('تقارير كل الطلاب: ملف واحد، تقرير لكل طالب بصفحة، ومن بلا درجات يُستثنى', async () => {
  const app = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => x.student_id !== 'e') }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = exportCrmAllStudentReports(null);`);
  await app.__p;
  assert.match(app.__d, /toggleCrmGaReportTo\('\*'\)">⤓ تقارير الطلاب — ملفات PDF/);
  assert.equal(app.__calls.length, 1);
  const h = app.__calls[0].out.html;
  assert.equal((h.match(/class="gr-pg"/g) || []).length, 4, 'تقرير لكل طالب له درجات');
  assert.doesNotMatch(h, /عادل/, 'من بلا درجات لا يُضمَّن');
  for(const n of ['أحمد', 'بدر', 'جاسر', 'دخيل']) assert.match(h, new RegExp(n));
  assert.match(app.__calls[0].filename, /^تقارير-الطلاب-/);
  assert.match(app.__calls[0].out.mark.right, /تقارير أداء الطلاب/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8'), /\.gr-pg\{break-after:page/, 'فاصل صفحة بين التقارير عند الطباعة');
});

test('الجهة الموجَّه إليها: السهم يفتح الخيارات الأربعة، والاختيار ينزّل التقرير مكتوبًا عليه الجهة', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; crmGradeAnalysis.open = 'low';
    window.__before = crmGradeAnalysisHtml(crmGradeAnalysis);
    toggleCrmGaReportTo('a'); window.__open = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = pickCrmGaReportTo('vice', null);`);
  assert.doesNotMatch(app.__before, /crm-ga-pop"/, 'الخيارات مخفية قبل ضغط السهم');
  for(const k of ['guardian', 'vice', 'staff', 'counselor', 'other']) assert.match(app.__open, new RegExp(`pickCrmGaReportTo\\('${k}'`));
  for(const t of ['ولي الأمر', 'وكيل شؤون الطلاب', 'وكيل شؤون المعلمين', 'الموجه الطلابي', 'أخرى']) assert.match(app.__open, new RegExp(t));
  await app.__p;
  assert.equal(app.__calls.length, 1);
  const h = app.__calls[0].out.html;
  assert.match(h, /موجّه إلى: وكيل شؤون الطلاب/);
  assert.equal((h.match(/وكيل شؤون الطلاب/g) || []).length, 2, 'سطر الجهة + خانة توقيع واحدة (بلا تكرار)');
  const app2 = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a');
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    window.__p = pickCrmGaReportTo('counselor', null);`);
  await app2.__p;
  assert.match(app2.__calls[0].html, /موجّه إلى: الموجه الطلابي/);
  assert.match(app2.__calls[0].html, /<div>الموجه الطلابي<b>/, 'خانة توقيع للجهة');
  assert.equal(app2.__repFor, undefined);
});

test('الجهة «أخرى»: نص حرّ يُهرَّب ويُقصّ، والفارغ لا ينزّل، و«كل الطلاب» يحمل الجهة', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); pickCrmGaReportTo('other', null);
    window.__o = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    const orig = document.getElementById.bind(document); document.getElementById = id => id === 'crmGaToOther' ? { value: '  <img src=x onerror=1>  مدير ' + 'م'.repeat(80), focus(){} } : orig(id);
    window.__p = pickCrmGaReportTo('otherGo', null);`);
  assert.match(app.__o, /id="crmGaToOther"/);
  await app.__p;
  const h = app.__calls[0].html;
  assert.doesNotMatch(h, /<img src=x/, 'النص مُهرَّب');
  assert.match(h, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(h, /م{50}/, 'يُقصّ على 40 حرفًا');
  const empty = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); pickCrmGaReportTo('other', null);
    window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    const orig = document.getElementById.bind(document); document.getElementById = id => id === 'crmGaToOther' ? { value: '   ', focus(){} } : orig(id);
    window.__p = pickCrmGaReportTo('otherGo', null);`);
  await empty.__p;
  assert.equal(empty.__calls.length, 0);
  const all = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*');
    window.__calls = []; gradeReportRun = async (btn, build) => { window.__calls.push(await build()); };
    window.__p = pickCrmGaReportTo('guardian', null);`);
  await all.__p;
  assert.equal((all.__calls[0].html.match(/موجّه إلى: ولي الأمر/g) || []).length, 5, 'كل تقرير يحمل الجهة');
});

test('تقارير الطلاب (الزر العام): تختار الفئة ثم الجهة، والفئة تحدّد من يُنزَّل لهم', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__s1 = crmGradeAnalysisHtml(crmGradeAnalysis);
    pickCrmGaScope('mid'); window.__s2 = crmGradeAnalysisHtml(crmGradeAnalysis);
    window.__calls = []; gradeReportRun = async (btn, build, filename) => { window.__calls.push({ out: await build(), filename }); };
    window.__p = pickCrmGaReportTo('vice', null);`);
  await app.__p;
  for(const k of ['all', 'low', 'mid', 'top']) assert.match(app.__s1, new RegExp(`pickCrmGaScope\\('${k}'\\)`));
  assert.match(app.__s1, /الضعاف<\/span><b>1<\/b>/);
  assert.match(app.__s1, /المتوسطون<\/span><b>2<\/b>/);
  assert.match(app.__s1, /المتفوقون<\/span><b>2<\/b>/);
  assert.doesNotMatch(app.__s1, /pickCrmGaReportTo\('guardian'/, 'الخطوة الأولى فئات فقط، لا جهات');
  assert.match(app.__s2, /المتوسطون — موجّه إلى/);
  assert.match(app.__s2, /pickCrmGaScope\(null\)/, 'رجوع لاختيار الفئة');
  const c = app.__calls[0];
  assert.equal((c.out.html.match(/class="gr-pg"/g) || []).length, 2, 'المتوسطون اثنان فقط');
  assert.match(c.out.html, /بدر/);
  assert.match(c.out.html, /جاسر/);
  assert.doesNotMatch(c.out.html, /أحمد|دخيل|عادل/, 'لا طلاب من فئات أخرى');
  assert.match(c.out.html, /موجّه إلى: وكيل شؤون الطلاب/);
  assert.match(c.filename, /^تقارير-المتوسطون-/);
  assert.match(c.out.mark.right, /المتوسطون/);
  const none = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => !['d', 'e'].includes(x.student_id)) }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(none.__d, /disabled onclick="pickCrmGaScope\('top'\)"/, 'فئة فارغة معطّلة');
});

test('قائمة السهم تذكر اسم الطالب، وبديل «الأعلى درجات» لا يُسمّى «المتفوقون» في الفئات ولا Excel', async () => {
  const app = opened(`crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('a'); window.__n = crmGradeAnalysisHtml(crmGradeAnalysis); pickCrmGaReportTo('other', null); window.__h = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__n, /<span>أحمد — موجّه إلى<\/span>/);
  assert.match(app.__h, /onkeydown="if\(event\.key==='Enter'\)/, 'Enter في خانة «أخرى» ينزّل');
  const fb = opened(`crmGrades = Object.assign({}, crmGrades, { scores: crmGrades.scores.filter(x => x.student_id !== 'e') }); crmGradeAnalysis.g = crmGrades;
    crmGradeAnalysis.tab = 'students'; toggleCrmGaReportTo('*'); window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);
    const v = gradeAnalysisView(crmGradeAnalysis); window.__x = gradeAnalysisExportRows(crmGradeAnalysis, v, true);`, { analysisRules: { pass: 50, edge: 10, top: 95, fallback: true } });
  assert.match(fb.__d, /<span>الأعلى درجات<\/span><b>\d+<\/b>/, 'اسم الفئة بالبديل');
  assert.doesNotMatch(fb.__d, /<span>المتفوقون<\/span>/);
  assert.match(JSON.stringify(fb.__x), /"الأعلى درجات"/, 'Excel يوسم أصحاب البديل');
});

test('تقارير كل الطلاب: لا تعمل لو تبدّلت الشعبة المعروضة', async () => {
  const app = opened(`window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    crmGrades = Object.assign({}, crmGrades, { sectionId: 'S2' }); exportCrmAllStudentReports(null);`);
  assert.equal(app.__calls.length, 0);
});

test('تقرير ولي الأمر: لا يعمل لو تبدّلت الشعبة المعروضة، ولا لطالب ليس في الشعبة', async () => {
  const app = opened(`window.__calls = []; gradeReportRun = async () => { window.__calls.push(1); };
    exportCrmStudentReportFor('zzz', null);
    crmGrades = Object.assign({}, crmGrades, { sectionId: 'S2' }); exportCrmStudentReportFor('a', null);`);
  assert.equal(app.__calls.length, 0);
});

test('محرّر الخيارات: المدرسة والمعلم والوكيل ظاهرة (تُحفظ مرة واحدة)، والبقية داخل «خيارات إضافية»', async () => {
  const app = opened(`openGradeReportEditor('ga'); window.__d = gradeReportEditorHtml();`);
  const [head, more] = app.__d.split('<details class="gr-more">');
  assert.ok(more, 'قسم الخيارات الإضافية موجود');
  assert.match(head, /id="grFld_school"/);
  assert.match(head, /id="grFld_teacher"/);
  assert.match(head, /id="grFld_vice"/, 'وكيل الشؤون ظاهر بلا فتح خيارات إضافية');
  assert.match(head, /تُدخلها مرة واحدة فتُحفظ/);
  assert.doesNotMatch(head, /grFld_subject/);
  assert.doesNotMatch(more, /grFld_vice/);
  assert.match(more, /grFld_subject/);
  assert.match(more, /ما يُطبع في التقرير/);
});

test('وكيل شؤون المعلمين والموجه الطلابي: حقلان يُحفظان، واسم كل منهما في توقيعه عند التوجيه إليه فقط', async () => {
  const app = opened(`openGradeReportEditor('ga'); window.__e = gradeReportEditorHtml(); window.__n = normalizeReportPrefs({ staff: '  أ.  خالد ', counselor: 'م. سعد', vice: 'ف' });
    const html = to => gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { date: 'd', to });
    window.__c = html('الموجه الطلابي'); window.__s = html('وكيل شؤون المعلمين'); window.__g = html('ولي الأمر'); window.__v = html('وكيل شؤون الطلاب');`,
    { reportPrefs: { staff: 'أ. خالد', counselor: 'م. سعد', vice: 'أ. فهد' } });
  const head = app.__e.split('<details class="gr-more">')[0];
  for(const k of ['vice', 'staff', 'counselor']) assert.match(head, new RegExp(`id="grFld_${k}"`));
  assert.equal(app.__n.staff, 'أ. خالد', 'الحقل يُنقّى ويُحفظ');
  assert.equal(app.__n.counselor, 'م. سعد');
  assert.match(app.__c, /<div>الموجه الطلابي<b>م\. سعد<\/b>/);
  assert.match(app.__s, /<div>وكيل شؤون المعلمين<b>أ\. خالد<\/b>/);
  assert.doesNotMatch(app.__g, /م\. سعد|أ\. خالد/, 'لا تظهر أسماؤهما إلا عند التوجيه إليهما');
  assert.doesNotMatch(app.__v, /م\. سعد|أ\. خالد/);
  assert.match(app.__v, /أ\. فهد/, 'وكيل الطلاب كما كان');
});

test('خيار «الأسماء» الافتراضي يتبع إعداد المعلم', async () => {
  assert.equal(opened('').__modal.length, 1);
  const app = opened(`window.__w = crmGradeAnalysis.withNames;`, { reportPrefs: { show: { names: true } } });
  assert.equal(app.__w, true);
});

test('محرّر الخيارات: يُحفظ المخصَّص، والافتراضي لا يُخزَّن، وفشل الحفظ يُرجع رسالة', async () => {
  const app = opened(`saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };`);
  runInAppContext(app, `(async () => {
    window.__r1 = await persistGradeReportPrefs({ school: 'ثانوية بدر', teacher: '', vice: 'سامي', show: { levels: true, stats: true, items: true, names: true, compare: false }, notes: { reading: true, strengths: false, weaknesses: true, plans: true } });
    window.__saved = JSON.stringify(appFeatures.reportPrefs);
    window.__r2 = await persistGradeReportPrefs(${JSON.stringify({ school: '', teacher: '', vice: '', show: { levels: true, stats: true, items: true, names: false, compare: false }, notes: { reading: false, strengths: false, weaknesses: false, plans: false } })});
    window.__after = appFeatures.reportPrefs;
    saveAppFeatures = async () => {}; window.__r3 = await persistGradeReportPrefs({ school: 'س' }); })()`);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(app.__r1, null);
  assert.match(app.__saved, /ثانوية بدر/);
  assert.equal(app.__r2, null);
  assert.equal(app.__after, undefined);
  assert.equal(app.__r3, 'تعذّر حفظ الخيارات');
});

test('المحرّر من النافذة: يفتح، يحفظ، ويحدّث «مع أسماء الطلاب»، والإلغاء يعيد الشاشة', async () => {
  const app = opened(`saveAppFeatures = async () => { appFeaturesSaved = appFeatures; };
    openGradeReportEditor('ga'); window.__open = crmGradeAnalysis.reportEdit; window.__html = crmGradeAnalysisHtml(crmGradeAnalysis);
    gradeReportDraftText('school', 'مدرستي'); gradeReportDraftFlag('show', 'names', true); gradeReportDraftFlag('notes', 'plans', false);
    window.__p = saveGradeReportPrefs();`);
  await app.__p;
  assert.equal(app.__open, true);
  assert.match(app.__html, /خيارات التقارير/);
  assert.match(app.__html, /وكيل شؤون الطلاب/);
  assert.match(app.__html, /تلقائي: عبدالعزيز المطيري/);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.reportEdit'), null);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.withNames'), true);
  assert.equal(runInAppContext(app, 'gradeReportPrefsNow().school'), 'مدرستي');
  assert.equal(runInAppContext(app, 'gradeReportPrefsNow().notes.plans'), false);
  runInAppContext(app, `openGradeReportEditor('ga'); gradeReportEditorCancel();`);
  assert.equal(runInAppContext(app, 'crmGradeAnalysis.reportEdit'), null);
});

test('الإعدادات: زر خيارات التقارير في تخصيص التطبيق', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-22-customize.js'), 'utf8');
  assert.match(src, /openGradeReportEditor\('cust'\)/);
  assert.match(src, /normalizeReportPrefs/);
});

test('عزل البيانات: app-34 لا يستعلم القاعدة مباشرة (كل التحميل عبر loadGradeSheetsRaw المفلتر بـ teacher_id)', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.doesNotMatch(src, /\bsb\.from\(/);
  assert.match(src, /loadGradeSheetsRaw\(/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-30-grade-compare.js'), 'utf8'), /\.eq\('teacher_id', uid\)/);
});

test('أزرار التصدير: الطالب والتحليل يمرّان بـ beginExportBusy ومنع النقر المزدوج', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /if\(gradeReportBusy\) return;/);
  assert.match(src, /beginExportBusy\(btn/);
  assert.match(src, /endExportBusy\(btn\)/);
  assert.match(fs.readFileSync(path.join(root, 'app/app-17-grades.js'), 'utf8'), /exportCrmStudentReport\(this\)/);
});

test('الملف في index.html وAPP_SHELL، وشعار الوزارة في المشروع وAPP_SHELL، والإصدارات متطابقة', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-34-grade-report\.js/);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /app-34-grade-report\.js/);
  assert.match(sw, /\.\/moe-logo\.png/, 'الشعار في APP_SHELL ليعمل بلا اتصال');
  assert.ok(fs.existsSync(path.join(root, 'moe-logo.png')), 'ملف شعار الوزارة موجود');
  assert.match(fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8'), /fetch\('moe-logo\.png'\)/);
  assert.match(sw, new RegExp(`APP_VERSION_SW = '${v.version}'`));
  assert.match(fs.readFileSync(path.join(root, 'app/app-26-update-check.js'), 'utf8'), new RegExp(`APP_VERSION = '${v.version}'`));
  assert.ok(v.notes.length >= 1);
});
