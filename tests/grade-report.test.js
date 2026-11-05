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
const CTX = "{ logo: '', date: '2026-11-05', withNames: false }";

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
  assert.equal(n.notes.reading, true);
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

test('التعليق التربوي شرطي على الأرقام: ضعف · حافة · تفوق → خطة علاجية وإثرائية', async () => {
  const app = opened(`window.__v = gradeAnalysisView(crmGradeAnalysis);
    window.__n = gradeReportSectionNotes({ s: __v.stats, displayMax: __v.displayMax, items: gradeReportItems(crmGradeAnalysis.g, crmGradeAnalysis.students), isTotal: true });`);
  const n = app.__n;
  const flat = k => [...n[k]].join(' ');
  assert.match(flat('plans'), /مراجعة أوراق الطلاب/);
  assert.match(flat('plans'), /الحافة/);
  assert.match(flat('plans'), /إثرائية/);
  assert.match(flat('plans'), /مقارنة نتائج التقييم التالي/);
  assert.match(flat('weaknesses'), /دون حد النجاح/);
  assert.match(flat('strengths'), /90%/);
  assert.match(flat('reading'), /المتوسط/);
});

test('بلا ضعف: لا خطة علاجية ولا نقطة ضعف، والقراءة تقول لا طالب دون حد النجاح', async () => {
  const app = opened('');
  const s = JSON.parse(JSON.stringify(runInAppContext(app, `analyzeGradeRows(gradeAnalysisRows(crmGradeAnalysis.g, crmGradeAnalysis.students.slice(2), 'p', { performance: 40, tests: 20 }, true).rows, 40)`)));
  app.__s = runInAppContext(app, `gradeAnalysisRows(crmGradeAnalysis.g, crmGradeAnalysis.students.slice(2), 'p', { performance: 40, tests: 20 }, true)`);
  runInAppContext(app, `window.__n = gradeReportSectionNotes({ s: analyzeGradeRows(__s.rows, 40), displayMax: 40, items: [], isTotal: false });`);
  assert.equal(s.groups.low.length, 0);
  assert.equal(app.__n.weaknesses.length, 0);
  assert.doesNotMatch([...app.__n.plans].join(' '), /مراجعة أوراق الطلاب/);
  assert.match([...app.__n.reading].join(' '), /لا طالب دون حد النجاح/);
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
  for(const gone of ['توزيع الطلاب حسب مستوى الأداء', 'المؤشرات الإحصائية', 'متوسط درجات البنود', 'قراءة تربوية', 'نقاط القوة', 'نقاط الضعف', 'الخطط العلاجية'])
    assert.doesNotMatch(app.__x, new RegExp(gone), gone);
  const on = opened(`window.__x = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__n = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { logo: '', date: 'd', withNames: true });`);
  for(const here of ['توزيع الطلاب حسب مستوى الأداء', 'المؤشرات الإحصائية', 'قراءة تربوية', 'نقاط القوة', 'نقاط الضعف وفرص التحسين', 'الخطط العلاجية والتوصيات'])
    assert.match(on.__x, new RegExp(here), here);
  assert.doesNotMatch(on.__x, /<td>أحمد<\/td>/, 'بلا أسماء افتراضيًا');
  assert.match(on.__n, /<td>أحمد<\/td>/);
  assert.match(on.__n, /الطلاب المحتاجون إلى دعم علاجي/);
});

test('XSS: اسم المدرسة والمعلم والوكيل وأسماء الطلاب كلها بـ escapeHtml', async () => {
  const bad = '<img src=x onerror=alert(1)>';
  const prefs = { reportPrefs: { school: bad, teacher: bad, vice: bad } };
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { logo: '', date: 'd', withNames: true });
    crmStudents[0].full_name = '${bad}'; crmGradeAnalysis.students = crmStudentsOfSection('S');
    window.__h2 = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), { logo: '', date: 'd', withNames: true });
    window.__sd = gradeReportStudentHtml(gradeReportStudentData(crmGrades, crmStudentsOfSection('S').find(x => x.full_name.startsWith('<')).id), gradeReportPrefsNow(), { logo: '', date: 'd' });`, prefs);
  for(const h of [app.__h, app.__h2, app.__sd]) assert.doesNotMatch(h, /<img src=x/);
  assert.match(app.__h, /&lt;img src=x/);
});

test('التوقيع: المعلم (تلقائي) ووكيل شؤون الطلاب، وولي الأمر لتقرير الطالب فقط', async () => {
  const app = opened(`window.__h = gradeReportSectionHtml(crmGradeAnalysis, gradeAnalysisView(crmGradeAnalysis), gradeReportPrefsNow(), ${CTX});
    window.__s = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'e'), gradeReportPrefsNow(), { logo: '', date: 'd' });`, { reportPrefs: { school: 'ثانوية بدر', vice: 'أ. سامي' } });
  assert.match(app.__h, /ثانوية بدر/);
  assert.match(app.__h, /عبدالعزيز المطيري/);
  assert.match(app.__h, /وكيل شؤون الطلاب<b>أ\. سامي/);
  assert.doesNotMatch(app.__h, /ولي الأمر/);
  assert.match(app.__s, /ولي الأمر/);
});

test('تقرير الطالب: الدرجة والفارق عن متوسط الشعبة، ونقاط القوة/الضعف من الفروق', async () => {
  const app = opened(`window.__d = gradeReportStudentData(crmGrades, 'a'); window.__top = gradeReportStudentData(crmGrades, 'e');
    window.__h = gradeReportStudentHtml(__d, gradeReportPrefsNow(), { logo: '', date: 'd' });`);
  const d = JSON.parse(JSON.stringify(app.__d));
  assert.equal(d.name, 'أحمد');
  assert.equal(d.max, 60);
  assert.equal(d.items.length, 2);
  assert.ok(d.pts < d.classPts, 'الطالب a أدنى من متوسط الشعبة');
  assert.match(app.__h, /تقرير أداء طالب/);
  assert.match(app.__h, /يحتاج دعمًا/);
  assert.match(app.__h, /التواصل مع ولي الأمر/);
  const e = JSON.parse(JSON.stringify(app.__top));
  assert.ok(e.pts > e.classPts);
  const notes = JSON.parse(JSON.stringify(runInAppContext(app, `gradeReportStudentNotes({ pts: __top.pts, max: __top.max, pct: __top.pct, classPts: __top.classPts, classPct: __top.classPct, items: __top.items, rules: __top.rules })`)));
  assert.ok(notes.strengths.length >= 1);
  assert.equal(notes.weaknesses.length, 0);
});

test('تقرير الطالب: الفارق السالب بلون التحذير، والموجب بالأزرق', async () => {
  const app = opened(`window.__lo = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'a'), gradeReportPrefsNow(), { logo: '', date: 'd' });
    window.__hi = gradeReportStudentHtml(gradeReportStudentData(crmGrades, 'e'), gradeReportPrefsNow(), { logo: '', date: 'd' });`);
  assert.match(app.__lo, /<div class="r"><b><bdi dir="ltr">-/);
  assert.match(app.__hi, /<div class="b"><b><bdi dir="ltr">\+/);
});

test('مقارنة الفصل السابق: السهم من القديم إلى الجديد', async () => {
  const src = fs.readFileSync(path.join(root, 'app/app-34-grade-report.js'), 'utf8');
  assert.match(src, /Math\.round\(r\.prev\) \+ '% → ' \+ Math\.round\(r\.now\)/);
});

test('طالب بلا درجات: لا انهيار، ولا يُحسب صفرًا', async () => {
  const app = opened(`crmGrades = Object.assign({}, crmGrades, { scores: [] });
    window.__d = gradeReportStudentData(crmGrades, 'a'); window.__h = gradeReportStudentHtml(__d, gradeReportPrefsNow(), { logo: '', date: 'd' });`);
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

test('نافذة التحليل: نطاق التقرير، وزر PDF بهوية الوزارة، وخيارات التقرير', async () => {
  const app = opened(`crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(app.__d, /id="crmGaScope"/);
  assert.match(app.__d, /exportCrmGradeAnalysis\('pdf', this\)/);
  assert.match(app.__d, /openGradeReportEditor\('ga'\)/);
  assert.match(app.__d, /<option value="group"[^>]*>كل شعب الصف/);
  const solo = opened(`crmSections = [{ id: 'S', grade_level_id: 'G' }]; crmGradeAnalysis.exportOpen = true; window.__d = crmGradeAnalysisHtml(crmGradeAnalysis);`);
  assert.match(solo.__d, /<option value="group"[^>]*disabled[^>]*>/, 'بلا شعب أخرى: الخيار معطّل');
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
    window.__r2 = await persistGradeReportPrefs(${JSON.stringify({ school: '', teacher: '', vice: '', show: { levels: true, stats: true, items: true, names: false, compare: false }, notes: { reading: true, strengths: true, weaknesses: true, plans: true } })});
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

test('الملف والشعار في index.html وAPP_SHELL، والإصدارات متطابقة', async () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-34-grade-report\.js/);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /app-34-grade-report\.js/);
  assert.match(sw, /\.\/moe-logo\.png/);
  assert.ok(fs.existsSync(path.join(root, 'moe-logo.png')));
  assert.match(sw, new RegExp(`APP_VERSION_SW = '${v.version}'`));
  assert.match(fs.readFileSync(path.join(root, 'app/app-26-update-check.js'), 'utf8'), new RegExp(`APP_VERSION = '${v.version}'`));
  assert.ok(v.notes.length >= 1);
});
