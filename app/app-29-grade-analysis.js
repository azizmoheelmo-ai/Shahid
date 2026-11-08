/* ============================================================
   تحليل درجات الشعبة — يُفتح بالضغط على شريط الملخص أعلى الكشف
   ------------------------------------------------------------
   - نافذة بثلاث تبويبات: «نظرة عامة» (جملة خلاصة + شريط المستويات + أربع بطاقات)،
     «الطلاب» (أسماء كل مستوى)، «مقارنات» (app-30)، وزر تصدير واحد ثابت أسفل النافذة.
   - ثلاثة مستويات تغطي كل من رُصد له: ضعاف (أقل من حدّ المستوى) · متوسطون · متفوقون (حد المتفوق فأكثر).
   - الأرقام المعروضة صحيحة (بلا كسور)؛ الكسور في ملف Excel فقط. التصنيف دائمًا بالرقم الدقيق،
     والتقريب لا يُظهر رقمًا يوحي بتجاوز حدّ لم يبلغه الطالب (49.6 لا تُعرض 50%).
   - ما لم يُرصد لا يُحسب (لا صفر)؛ ومن رُصد له جزء من الأعمدة يُحسب بنسبته مما رُصد له.
   - الأسماء من طلاب الشعبة المحمَّلة فقط (فلترة صريحة بـ teacher_id في تحميل الكشف نفسه)،
     والتصدير بلا أسماء ما لم يُحدَّد غير ذلك، وبلا تعليق تربوي ما لم يُطلب.
   ============================================================ */

const GRADE_ANALYSIS_RULES = {
  edgeAbovePct: 10, /* هامش داخلي بعد حدّ الضعاف (لم يعد مستوى ظاهرًا) */
  topPct: 90        /* متفوق: 90% فأكثر */
};
const GRADE_ANALYSIS_BANDS = ['أقل من 50%', '50–59%', '60–69%', '70–79%', '80–89%', '90% فأكثر'];
const GRADE_ANALYSIS_GROUPS = [
  { key: 'low', label: 'يحتاج دعمًا', tone: 'lo' },
  { key: 'edge', label: 'على الحافة', tone: 'mid' },
  { key: 'top', label: 'متفوقون', tone: 'hi' }
];
/* مستويات النافذة (الأخطر أولًا): تغطي كل من رُصد له بلا تداخل */
const GRADE_ANALYSIS_LEVELS = [
  { key: 'low', label: 'ضعاف', tone: 'lo' },
  { key: 'mid', label: 'متوسطون', tone: 'mid' },
  { key: 'top', label: 'متفوقون', tone: 'hi' }
];
const GRADE_ANALYSIS_NAMES_PREVIEW = 5; /* أسماء كل مستوى قبل «عرض الكل» */

/* ============ دوال صرفة ============ */

/* الحدود الفعلية: ما ضبطه المعلم (app-31) وإلا الافتراضي */
function gradeAnalysisRulesNow(){
  return typeof gradeRulesNow === 'function' ? gradeRulesNow() : { pass: 50, edge: GRADE_ANALYSIS_RULES.edgeAbovePct, top: GRADE_ANALYSIS_RULES.topPct, fallback: false };
}

function gradeAnalysisPassPct(){ return gradeAnalysisRulesNow().pass; }

/* «تحت النصف» ما دام الحدّ 50، وإلا «تحت 60%» مثلًا */
function gradeAnalysisLowLabel(){
  const p = gradeAnalysisPassPct();
  return p === 50 ? 'تحت النصف' : `تحت ${p}%`;
}

function gradeAnalysisBandIndex(pct){
  return pct < 50 ? 0 : pct < 60 ? 1 : pct < 70 ? 2 : pct < 80 ? 3 : pct < 90 ? 4 : 5;
}

/* الأعمدة «المُجرَاة»: ما رُصدت له درجة لطالب واحد على الأقل. بند لم يُرصد لأحد لا يدخل في التقرير (لم يُختبر بعد). */
function gradeAdministeredColumns(columns, scores, testsOn){
  const withScores = new Set((scores || []).map(x => x.column_id));
  return (columns || []).filter(c => withScores.has(c.id) && (c.category !== 'tests' || testsOn));
}

/* صفوف الطلاب لعمود التحليل: key = 'total' أو id عمود.
   points = درجة الطالب، pct = نسبته مما رُصد له (null = لم يُرصد). displayMax = السلّم المعروض.
   قاعدة الرصد: ما رُصد لغيره ولم يُرصد له = «رصد غير مكتمل» (incomplete): لا يُصنَّف ولا يدخل في المتوسط
   ولا يُعدّ صفرًا؛ والصفر الذي يُدخله المعلم يُحسب صفرًا. missing = أسماء البنود الناقصة. */
function gradeAnalysisRows(g, students, key, caps, testsOn){
  const columns = g.columns || [];
  if(key === 'total'){
    const perfMax = columns.filter(c => c.category === 'performance').reduce((a, c) => a + Number(c.max_score), 0);
    const adm = gradeAdministeredColumns(columns, g.scores, testsOn);
    const baseMax = adm.filter(c => c.category === 'performance').reduce((a, c) => a + Number(c.max_score), 0)
      + (testsOn && adm.some(c => c.category === 'tests') ? Number(caps.tests) : 0);
    const displayMax = baseMax > 0 ? Math.round(baseMax * 100) / 100 : perfMax + (testsOn ? Number(caps.tests) : 0);
    const mine = new Map();
    (g.scores || []).forEach(x => { if(!mine.has(x.student_id)) mine.set(x.student_id, new Set()); mine.get(x.student_id).add(x.column_id); });
    const rows = (students || []).map(st => {
      const t = studentGradeTotal(studentGradeResult(columns, g.scores, st.id, caps), testsOn, caps);
      const has = t.points !== null && t.recordedMax > 0;
      const got = mine.get(st.id) || new Set();
      const missing = adm.filter(c => !got.has(c.id)).map(c => c.name);
      const incomplete = !has || missing.length > 0;
      return { id: st.id, name: st.full_name, points: has ? t.points : null, pct: has ? 100 * t.points / t.recordedMax : null, recordedMax: t.recordedMax, incomplete, partial: has && incomplete, missing };
    });
    return { rows, displayMax };
  }
  const col = columns.find(c => c.id === key);
  if(!col) return { rows: [], displayMax: 0 };
  const max = Number(col.max_score);
  const byStudent = new Map((g.scores || []).filter(s => s.column_id === col.id).map(s => [s.student_id, Number(s.score)]));
  return {
    displayMax: max,
    rows: (students || []).map(st => {
      const has = byStudent.has(st.id);
      return { id: st.id, name: st.full_name, points: has ? byStudent.get(st.id) : null, pct: has ? 100 * byStudent.get(st.id) / max : null, recordedMax: max, incomplete: !has, partial: false, missing: has ? [] : [col.name] };
    })
  };
}

/* أرقام وفئات من الصفوف: لمن رُصد له فقط */
function analyzeGradeRows(rows, displayMax){
  /* الإحصاء لمكتملي الرصد فقط؛ غير المكتملين يُعرضون منفصلين ولا يُصنَّفون */
  const rec = rows.filter(r => r.points !== null && !r.incomplete);
  const incList = rows.filter(r => r.incomplete || r.points === null).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  /* سلّم واحد: إن اختلف مقام صفّ عن المعروض (مجموعة شعب بأسس مختلفة) يُحوَّل بنسبته */
  const val = r => (r.recordedMax === displayMax || !(r.recordedMax > 0)) ? r.points : Math.round(r.pct * displayMax) / 100;
  const rules = gradeAnalysisRulesNow();
  const pass = rules.pass;
  const r2 = n => Math.round(n * 100) / 100;
  const pts = rec.map(val).sort((a, b) => a - b);
  const mid = pts.length >> 1;
  const sum = pts.reduce((a, b) => a + b, 0);
  const bands = GRADE_ANALYSIS_BANDS.map(() => 0);
  rec.forEach(r => { bands[gradeAnalysisBandIndex(r.pct)]++; });
  const byPct = (a, b) => a.pct - b.pct || a.name.localeCompare(b.name, 'ar');
  const groups = {
    low: rec.filter(r => r.pct < pass).sort(byPct),
    edge: rec.filter(r => r.pct >= pass && r.pct < pass + rules.edge).sort(byPct),
    top: rec.filter(r => r.pct >= rules.top).sort((a, b) => -byPct(a, b))
  };
  /* لا أحد بلغ حدّ المتفوق: اختياريًا تُعرض أعلى 3 (ممن بلغوا حدّ الضعاف فأعلى) باسم «الأعلى درجات» */
  const topIsFallback = !groups.top.length && rules.fallback;
  if(topIsFallback) groups.top = rec.filter(r => r.pct >= pass).sort((a, b) => -byPct(a, b)).slice(0, 3);
  /* «جيد»: من نجح بهامش كافٍ ولم يبلغ حدّ المتفوق (دون من عُرضوا بالبديل «الأعلى درجات») */
  const inTop = new Set(groups.top.map(r => r.id));
  const good = rec.filter(r => r.pct >= pass + rules.edge && r.pct < rules.top && !inTop.has(r.id)).sort((a, b) => -byPct(a, b));
  /* «متوسطون»: من نجح ولم يبلغ حدّ المتفوق (= الحافة + الجيد سابقًا، دون من عُرضوا بالبديل «الأعلى درجات») */
  const midLevel = rec.filter(r => r.pct >= pass && r.pct < rules.top && !inTop.has(r.id)).sort(byPct);
  return {
    good, mid: midLevel,
    total: rows.length, recorded: rec.length, missing: rows.filter(r => r.points === null).length,
    partial: incList.filter(r => r.points !== null).length, incomplete: incList,
    avg: pts.length ? r2(sum / pts.length) : null,
    avgPct: pts.length && displayMax > 0 ? Math.round(100 * sum / pts.length / displayMax) : null,
    median: pts.length ? r2(pts.length % 2 ? pts[mid] : (pts[mid - 1] + pts[mid]) / 2) : null,
    min: pts.length ? pts[0] : null, max: pts.length ? pts[pts.length - 1] : null,
    passed: rec.length - groups.low.length,
    passRate: rec.length ? Math.round(100 * (rec.length - groups.low.length) / rec.length) : null,
    bands, groups, passPct: pass, topIsFallback, rules
  };
}

/* ============ النافذة ============ */
let crmGradeAnalysis = null; /* { g, students, key, open, exportOpen, label } — لقطة وقت الفتح */
let crmGradeAnalysisBusy = false;

function openCrmGradeAnalysis(){
  const g = crmGrades;
  if(!g || !hasBaseGradeColumns(g.allColumns || g.columns)) return;
  const prefs = gradeReportPrefsNow();
  crmGradeAnalysis = { g, students: crmStudentsOfSection(g.sectionId), key: 'total', open: null, showAll: null, tab: 'overview', detOpen: false, exportOpen: false, withNames: prefs.show.names, scope: 'section', cmpAuto: false, cmpTouched: false, repFor: null, repStep: 'to', repScope: 'all', repOther: false, reportEdit: null, mode: 'bands', rulesEdit: null, cmp: null, sib: null, prev: null, prevOpen: null, editing: null, label: crmSectionLabel(g.sectionId) };
  const a = crmGradeAnalysis;
  a.open = gradeAnalysisDefaultOpen(a);
  const opts = ['<option value="total">المجموع</option>'].concat(g.columns.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (من ${formatScore(c.max_score)})</option>`));
  showInfoModal(`<div class="crm-ga">
    <h3 class="crm-ga-h">تحليل الدرجات</h3>
    <div class="crm-ga-top"><div class="crm-gs-sub">${escapeHtml(a.label)}</div>
    <select class="crm-ga-sel" id="crmGaKey" aria-label="ماذا تريد أن تحلّل؟" onchange="onCrmGradeAnalysisKey(this.value)">${opts.join('')}</select></div>
    <div id="crmGaBody"></div></div>`, '420px');
  paintCrmGradeAnalysis();
}

function gradeAnalysisView(a){
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const { rows, displayMax } = gradeAnalysisRows(a.g, a.students, a.key, caps, appToolOn('tests'));
  const col = a.key === 'total' ? null : a.g.columns.find(c => c.id === a.key);
  return { rows, displayMax, stats: analyzeGradeRows(rows, displayMax), colLabel: col ? col.name : 'المجموع' };
}

/* مستوى «يحتاجون دعمًا» مفتوح من البداية إن وُجد فيه أحد — هو أول ما يبحث عنه المعلم */
function gradeAnalysisDefaultOpen(a){
  return gradeAnalysisView(a).stats.groups.low.length ? 'low' : null;
}

function onCrmGradeAnalysisKey(key){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.repFor = null;
  crmGradeAnalysis.key = key;
  crmGradeAnalysis.open = gradeAnalysisDefaultOpen(crmGradeAnalysis);
  crmGradeAnalysis.showAll = null;
  paintCrmGradeAnalysis();
}

function toggleCrmGaGroup(key){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.repFor = null;
  crmGradeAnalysis.open = crmGradeAnalysis.open === key ? null : key;
  crmGradeAnalysis.showAll = null;
  paintCrmGradeAnalysis();
}

/* تبويب: نظرة عامة | الطلاب | مقارنات (مقارنة الشعب/الفصل السابق تُحمَّل عند فتح بطاقتها فقط) */
function setCrmGaTab(tab){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.tab = tab === 'students' || tab === 'compare' ? tab : 'overview';
  a.repFor = null;
  if(a.tab === 'compare') autoOpenCrmGaCompare(a);
  paintCrmGradeAnalysis();
}

/* الضغط على بطاقة مستوى بنظرة عامة: ينقل لتبويب الطلاب والمستوى مفتوح */
function openCrmGaLevel(key){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.tab = 'students';
  a.open = key;
  a.showAll = null;
  paintCrmGradeAnalysis();
}

function toggleCrmGaShowAll(key){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.repFor = null;
  a.showAll = a.showAll === key ? null : key;
  paintCrmGradeAnalysis();
}

function toggleCrmGaDetails(){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.detOpen = !crmGradeAnalysis.detOpen;
  paintCrmGradeAnalysis();
}

function toggleCrmGaExport(){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.exportOpen = !crmGradeAnalysis.exportOpen;
  paintCrmGradeAnalysis();
}

function paintCrmGradeAnalysis(){
  const box = document.getElementById('crmGaBody');
  if(box && crmGradeAnalysis) box.innerHTML = crmGradeAnalysisHtml(crmGradeAnalysis);
  if(crmGradeAnalysis && crmGradeAnalysis.reportEdit && typeof gradeReportLogoPreviewLoad === 'function') gradeReportLogoPreviewLoad(); /* app-34: معاينة شعار محفوظ */
}

/* درجة صحيحة (2.6 ← 3) — الكسور في Excel فقط */
function gradeAnalysisPts(n){ return String(Math.round(Number(n))); }

/* نسبة صحيحة لا تتجاوز حدًّا لم يبلغه صاحبها: 49.6 تُعرض 49% لا 50% (التصنيف بالرقم الدقيق).
   bounds = حدود المستويات الصحيحة (الضعاف، المتفوق). */
function gradeAnalysisPctShown(pct, bounds){
  let r = Math.round(pct);
  (bounds || []).forEach(b => { if(pct < b && r >= b) r = b - 1; });
  return r;
}

function gradeAnalysisBounds(){
  const r = gradeAnalysisRulesNow();
  return [r.pass, r.top];
}

/* نسبة n من total صحيحة، دون أن تُظهر 100% وفيها من لم ينجح، ولا 0% وفيها من نجح */
function gaRateShown(n, total){
  if(!total) return 0;
  const r = Math.round(100 * n / total);
  return n < total && r >= 100 ? 99 : n > 0 && r <= 0 ? 1 : r;
}

function gradeAnalysisTone(pct){
  const pass = gradeAnalysisPassPct();
  return pct < pass ? 'lo' : pct < gradeAnalysisRulesNow().top ? 'mid' : 'hi';
}

/* تمييز العدد: 3 طلاب · 11 طالبًا */
function gaStudentsWord(n){ return n <= 10 ? 'طلاب' : 'طالبًا'; }

/* حدّ المستوى بالنسبة، وما يقابله بالدرجات إن كان عددًا صحيحًا فقط (لا نعرض تقريبًا غير دقيق) */
function gaGroupRangeHtml(key, s, displayMax){
  if(key === 'top' && s.topIsFallback) return '';
  const r = s.rules;
  const pts = p => { const v = p * displayMax / 100; return Number.isInteger(v) ? formatScore(v) : ''; };
  const lowPts = pts(r.pass), topPts = pts(r.top);
  const txt = key === 'low' ? `أقل من ${r.pass}%${lowPts ? ` (أقل من ${lowPts} درجة)` : ''}`
    : key === 'mid' ? `من ${r.pass}% إلى أقل من ${r.top}%`
    : `${r.top}% فأكثر${topPts ? ` (${topPts} درجة فأكثر)` : ''}`;
  return `<small>${txt}</small>`;
}

/* قائمة منبثقة عند السهم (ج): طالب واحد ← الجهة الموجَّه إليها. «كل الطلاب» ← الفئة المطلوبة ثم الجهة.
   الاختيار الأخير ينزّل التقرير مباشرة. */
const GA_REPORT_TO = [['guardian', 'ولي الأمر'], ['vice', 'وكيل شؤون الطلاب'], ['staff', 'وكيل شؤون المعلمين'], ['counselor', 'الموجه الطلابي']];
const GA_REPORT_SCOPES = [['all', 'كل الطلاب'], ['low', 'الضعاف'], ['mid', 'المتوسطون'], ['top', 'المتفوقون']];

/* طلاب الفئة المعروضة الآن (بالعمود المحلَّل نفسه): null = كل من لهم درجات */
function gaScopeIds(a, scope){
  if(!scope || scope === 'all') return null;
  const lists = gaLevelLists(gradeAnalysisView(a).stats);
  return new Set((lists[scope] || []).map(r => r.id));
}

/* نسخة التقرير المختارة بقائمة التنزيل: 'grades' (افتراضي) أو 'analytical' */
function gaRepVersion(a){ return a && a.repVer === 'analytical' ? 'analytical' : 'grades'; }
function setCrmGaRepVer(v){
  const a = crmGradeAnalysis;
  if(!a || !a.repFor) return;
  a.repVer = v === 'analytical' ? 'analytical' : 'grades';
  a.repOther = false;
  paintCrmGradeAnalysis();
}

function gaStudentName(a, id){
  const st = (a.students || []).find(x => x.id === id);
  return st ? st.full_name : '';
}

function gaPopHtml(a){
  const bulk = a.repFor === '*';
  const row = (label, click, extra) => `<button type="button" class="crm-ga-pop-row" role="menuitem" ${extra || ''} onclick="${click}">${label}</button>`;
  let head, body;
  if(bulk && a.repStep !== 'to'){
    const lists = gaLevelLists(gradeAnalysisView(a).stats);
    const st = gradeAnalysisView(a).stats;
    const n = k => k === 'all' ? gradeAnalysisView(a).stats.recorded : lists[k].length;
    head = '<span>أي فئة تريد؟</span>';
    body = GA_REPORT_SCOPES.map(([k, label]) => row(`<span>${k === 'top' && st.topIsFallback ? 'الأعلى درجات' : label}</span><b>${n(k)}</b>`, `pickCrmGaScope('${k}')`, n(k) ? '' : 'disabled')).join('');
  } else {
    const sc = bulk ? GA_REPORT_SCOPES.find(x => x[0] === (a.repScope || 'all')) : null;
    const analytic = gaRepVersion(a) === 'analytical';
    head = bulk ? `<button type="button" class="crm-ga-pop-back" aria-label="رجوع لاختيار الفئة" onclick="pickCrmGaScope(null)">‹</button><span>${sc ? sc[1] : ''} — ${analytic ? 'تحليلي' : 'موجّه إلى'}</span>` : `<span>${escapeHtml(gaStudentName(a, a.repFor))} — ${analytic ? 'تحليلي' : 'موجّه إلى'}</span>`;
    /* النسخة: الدرجات (موجَّهة لجهة) أو التحليلية (كل ما يخص الطالب، بتشخيص أو بدونه) — كانت التحليلية تُنزَّل من ملف الطالب فقط */
    const ver = (k, label) => `<button type="button" role="menuitemradio" aria-checked="${analytic === (k === 'analytical')}" class="${analytic === (k === 'analytical') ? 'is-on' : ''}" onclick="setCrmGaRepVer('${k}')">${label}</button>`;
    const verRow = `<div class="crm-ga-pop-ver">${ver('grades', 'نسخة الدرجات')}${ver('analytical', 'النسخة التحليلية')}</div>`;
    if(analytic){
      const dxOn = typeof reportDxOn === 'function' ? reportDxOn() : true;
      body = verRow + `<label class="crm-ga-chk crm-ga-pop-dx"><input type="checkbox" id="crmGaPopDx"${dxOn ? ' checked' : ''} onchange="gaSetDx(this.checked)"> مع التشخيص والتوصيات</label>`
        + `<p class="crm-ga-pop-note">كل ما يخص الطالب: الدرجات مع الحضور والمخالفات والمتابعات والحالات.</p>`
        + row('⤓ تنزيل التقرير التحليلي', "pickCrmGaReportTo('analytical', this)");
    } else {
      body = verRow + GA_REPORT_TO.map(([k, label]) => row(label, `pickCrmGaReportTo('${k}', this)`)).join('')
        + (a.repOther
          ? `<div class="crm-ga-to-other"><input class="goal-input" type="text" id="crmGaToOther" maxlength="40" placeholder="مثال: مدير المدرسة" aria-label="الجهة الموجّه إليها التقرير" onkeydown="if(event.key==='Enter'){event.preventDefault();pickCrmGaReportTo('otherGo', this.nextElementSibling);}"><button type="button" class="crm-ga-to-chip" onclick="pickCrmGaReportTo('otherGo', this)">تنزيل</button></div>`
          : row('أخرى…', "pickCrmGaReportTo('other', this)"));
    }
  }
  return `<div class="crm-ga-pop" role="menu"><div class="crm-ga-pop-h">${head}<button type="button" class="crm-ga-pop-x" aria-label="إغلاق" onclick="toggleCrmGaReportTo(crmGradeAnalysis.repFor)">✕</button></div>${body}</div>`;
}

function toggleCrmGaReportTo(id){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.repFor = a.repFor === id ? null : id;
  a.repStep = id === '*' ? 'scope' : 'to';
  a.repScope = 'all';
  a.repOther = false;
  paintCrmGradeAnalysis();
  if(a.repFor && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { const el = document.querySelector('.crm-ga-pop'); if(el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); });
}

/* «كل الطلاب»: اختيار الفئة، ثم تظهر الجهة (null = رجوع) */
function pickCrmGaScope(k){
  const a = crmGradeAnalysis;
  if(!a || a.repFor !== '*') return;
  if(k === null){ a.repStep = 'scope'; a.repOther = false; }
  else if(GA_REPORT_SCOPES.some(x => x[0] === k)){ a.repScope = k; a.repStep = 'to'; }
  paintCrmGradeAnalysis();
}

async function pickCrmGaReportTo(kind, btn){
  const a = crmGradeAnalysis;
  if(!a || !a.repFor) return;
  let to;
  const version = kind === 'analytical' ? 'analytical' : 'grades';
  if(kind === 'other'){
    a.repOther = true;
    paintCrmGradeAnalysis();
    const inp = document.getElementById('crmGaToOther');
    if(inp) inp.focus();
    return;
  }
  if(kind === 'analytical'){
    to = null; /* التحليلية بلا «موجّه إلى» */
  } else if(kind === 'otherGo'){
    const inp = document.getElementById('crmGaToOther');
    to = (inp ? inp.value : '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if(!to){ showToast('اكتب الجهة الموجّه إليها التقرير', 'error'); return; }
  } else {
    const f = GA_REPORT_TO.find(x => x[0] === kind);
    if(!f) return;
    to = f[1];
  }
  const target = a.repFor;
  if(target === '*'){
    const scope = a.repScope || 'all';
    const sc = GA_REPORT_SCOPES.find(x => x[0] === scope);
    await exportCrmAllStudentReports(btn, to, gaScopeIds(a, scope), scope === 'all' ? '' : sc[1], version);
  } else await exportCrmStudentReportFor(target, btn, to, version);
  if(crmGradeAnalysis === a && a.repFor === target){ a.repFor = null; a.repOther = false; paintCrmGradeAnalysis(); }
}

/* قائمة أسماء مستوى: أول 5 ثم «عرض الكل» */
function gaNamesHtml(a, key, list){
  const all = a.showAll === key;
  const shown = all ? list : list.slice(0, GRADE_ANALYSIS_NAMES_PREVIEW);
  const bounds = gradeAnalysisBounds();
  let html = '<div class="crm-ga-names">' + shown.map(r => `<div class="crm-ga-rowwrap"><button type="button" class="crm-ga-name" onclick="openCrmGradeAnalysisStudent('${escapeHtml(r.id)}')"><span>${escapeHtml(r.name)}${r.incomplete && r.missing && r.missing.length ? `<small>ناقص: ${escapeHtml(r.missing.join('، '))}</small>` : ''}</span><span class="crm-ga-sc">${r.incomplete ? (r.points === null ? '<b class="gs-tone-none">—</b><small>بلا درجات</small>' : `<b class="gs-tone-none"><bdi dir="ltr">${gradeAnalysisPts(r.points)}</bdi></b><small>من ${formatScore(r.recordedMax)}</small>`) : `<b class="gs-tone-${gradeAnalysisTone(r.pct)}"><bdi dir="ltr">${gradeAnalysisPctShown(r.pct, bounds)}%</bdi></b><small>${gradeAnalysisPts(r.points)} من ${formatScore(r.recordedMax)}</small>`}</span></button><button type="button" class="crm-ga-rep" aria-label="تنزيل تقرير الطالب ${escapeHtml(r.name)} (PDF)" title="تنزيل تقرير الطالب" aria-expanded="${a.repFor === r.id}" onclick="toggleCrmGaReportTo('${escapeHtml(r.id)}')">⤓</button>${a.repFor === r.id ? gaPopHtml(a) : ''}</div>`).join('');
  if(list.length > GRADE_ANALYSIS_NAMES_PREVIEW) html += `<button type="button" class="crm-ga-more" onclick="toggleCrmGaShowAll('${key}')">${all ? 'عرض أقل ⌃' : `عرض الكل (${list.length}) ⌄`}</button>`;
  return html + '</div>';
}

/* الأعداد الصحيحة لكل مستوى بعد الاستبدال بالقائمة المعروضة (البديل «الأعلى درجات» يغيّر قائمة المتفوقين) */
function gaLevelLists(s){
  return { low: s.groups.low, mid: s.mid, top: s.groups.top };
}

function gaLevelLabel(lv, s){ return lv.key === 'top' && s.topIsFallback ? 'الأعلى درجات' : lv.label; }

function gaTabsHtml(a){
  const tab = (k, label) => `<button type="button" role="tab" class="${a.tab === k ? 'is-on' : ''}" aria-selected="${a.tab === k}" onclick="setCrmGaTab('${k}')">${label}</button>`;
  return `<div class="crm-ga-tabs" role="tablist">${tab('overview', 'نظرة عامة')}${tab('students', 'الطلاب')}${tab('compare', 'مقارنات')}</div>`;
}

/* ملاحظات قصيرة: من لم يُرصد له شيء (خارج الحساب) ومن رُصد له جزء (داخل الحساب) */
function gaNotesHtml(s){
  const n = s.incomplete ? s.incomplete.length : 0;
  if(!n) return '';
  return `<div class="crm-ga-note">${n} ${gaStudentsWord(n)} لم تكتمل درجاتهم — لا يُصنَّفون ولا يدخلون في المتوسط. <button type="button" class="crm-ga-link" onclick="openCrmGaLevel('inc')">عرض الأسماء</button></div>`;
}

function gaOverviewHtml(a, v){
  const s = v.stats;
  const lists = gaLevelLists(s);
  const total = s.recorded;
  const segs = ['top', 'mid', 'low'].map(k => ({ k, n: lists[k].length })).filter(x => x.n);
  const bar = segs.map(x => `<i class="gs-lv-${x.k}" style="flex:${x.n}" title="${x.n}"></i>`).join('');
  let html = `<div class="crm-ga-hero"><div class="crm-ga-hero-t">متوسط الشعبة <b>${gradeAnalysisPts(s.avg)} من ${formatScore(v.displayMax)}</b> (<bdi dir="ltr">${s.avgPct === null ? '—' : s.avgPct + '%'}</bdi>)</div>
    <div class="crm-ga-hero-s">${total} ${gaStudentsWord(total)} · الوسيط <b>${gradeAnalysisPts(s.median)}</b> · من <b>${gradeAnalysisPts(s.min)}</b> إلى <b>${gradeAnalysisPts(s.max)}</b></div>
    <div class="crm-ga-stack">${bar}</div></div>` + gaNotesHtml(s);
  GRADE_ANALYSIS_LEVELS.forEach(lv => {
    const n = lists[lv.key].length;
    html += `<button type="button" class="crm-ga-lv gs-grp-${lv.tone}" ${n ? '' : 'disabled'} onclick="openCrmGaLevel('${lv.key}')"><b class="crm-ga-lvn">${n}</b><span class="crm-ga-lvt">${gaLevelLabel(lv, s)}${gaGroupRangeHtml(lv.key, s, v.displayMax)}</span><span class="crm-am-chev" aria-hidden="true">‹</span></button>`;
  });
  /* «أين الصعوبة؟» (كانت بطاقة في المقارنات وليست مقارنة): سطر واحد إن وُجد اختبار صعب، والتفصيل داخل «تفاصيل إحصائية» — للمجموع فقط */
  const diffList = a.key === 'total' ? gradeColumnDifficulty(a.g.columns, a.g.scores, a.students.map(x => x.id)) : [];
  const hardCol = hardestGradeColumn(diffList);
  if(hardCol) html += `<div class="crm-ga-card">⚠ أصعب اختبار: <b>${escapeHtml(hardCol.name)}</b> — ${hardCol.low} من ${hardCol.recorded} ${gradeAnalysisLowLabel()}</div>`;
  const tile = (val, label, sub) => `<div class="crm-ga-tile"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  html += `<button type="button" class="crm-ga-det${a.detOpen ? ' open' : ''}" aria-expanded="${!!a.detOpen}" onclick="toggleCrmGaDetails()"><span>تفاصيل إحصائية</span><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
  if(a.detOpen){
    html += `<div class="crm-ga-detbody"><div class="crm-ga-tiles">
      ${tile(gradeAnalysisPts(s.median), 'الوسيط', 'من ' + formatScore(v.displayMax))}
      ${tile(`${gradeAnalysisPts(s.min)} إلى ${gradeAnalysisPts(s.max)}`, 'أدنى وأعلى درجة', 'من ' + formatScore(v.displayMax))}
      ${tile(s.avgPct === null ? '—' : `<bdi dir="ltr">${s.avgPct}%</bdi>`, 'متوسط النسبة', '')}
    </div>${gaDistHtml(a, v)}${diffList.length ? `<div class="crm-ga-sec">أين الصعوبة؟ (متوسط كل عمود)</div>${gaDiffHtml(a)}` : ''}<div class="crm-ga-sechead"><button type="button" class="crm-ga-link" onclick="openCrmGaRulesEditor()">⚙ تعديل حدود المستويات</button></div></div>`;
  }
  return html;
}

function gaStudentsHtml(a, v){
  const s = v.stats;
  const lists = gaLevelLists(s);
  let html = s.recorded ? `<div class="crm-ga-allwrap"><button type="button" class="crm-ga-allrep" aria-expanded="${a.repFor === '*'}" onclick="toggleCrmGaReportTo('*')">⤓ تقارير الطلاب — ملفات PDF</button>${a.repFor === '*' ? gaPopHtml(a) : ''}</div>` : '';
  GRADE_ANALYSIS_LEVELS.forEach(lv => {
    const list = lists[lv.key];
    const on = a.open === lv.key && list.length;
    const hasPop = on && a.repFor && a.repFor !== '*' && list.some(r => r.id === a.repFor);
    html += `<div class="crm-ga-grp gs-grp-${lv.tone}${on ? ' open' : ''}${hasPop ? ' has-pop' : ''}"><button type="button" class="crm-ga-ghead" aria-expanded="${!!on}" ${list.length ? '' : 'disabled'} onclick="toggleCrmGaGroup('${lv.key}')"><span>${gaLevelLabel(lv, s)}${gaGroupRangeHtml(lv.key, s, v.displayMax)}</span><b>${list.length}</b><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += gaNamesHtml(a, lv.key, list);
    html += '</div>';
  });
  if(s.incomplete && s.incomplete.length){
    const inc = s.incomplete;
    const on = a.open === 'inc';
    const hasPop = on && a.repFor && a.repFor !== '*' && inc.some(r => r.id === a.repFor);
    html += `<div class="crm-ga-grp gs-grp-none${on ? ' open' : ''}${hasPop ? ' has-pop' : ''}"><button type="button" class="crm-ga-ghead" aria-expanded="${!!on}" onclick="toggleCrmGaGroup('inc')"><span>رصد غير مكتمل<small>لا يُصنَّفون ولا يدخلون في المتوسط</small></span><b>${inc.length}</b><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += gaNamesHtml(a, 'inc', inc);
    html += '</div>';
  }
  return html + '<p class="crm-ga-fine">الأسماء من الأدنى إلى الأعلى نسبةً في «ضعاف» و«متوسطون»، ومن الأعلى في «متفوقون»، وغير المكتملين بالاسم. اضغط اسمًا لفتح صفحة الطالب، أو السهم ⤓ بجانبه لتنزيل تقريره.</p>';
}

/* نطاق زر PDF: ما اختاره المعلم صراحةً في «نطاق التقرير» يغلب؛ وإلا يتبع الشاشة المفتوحة — داخل «مقارنة الشعب» يُنزَّل
   تقرير مقارنة شعب الصف (لا تقرير الشعبة)، وما عداها تقرير الشعبة. شكوى حقيقية: زر PDF في المقارنة كان يُنزّل تقرير الشعبة. */
function gaEffectiveScope(a){
  const hasSib = gradeSiblingSectionIds(a.g).length > 0;
  if(a.scopeTouched) return a.scope === 'group' ? 'group' : 'section'; /* بلا شعب أخرى يظهر تنبيه التصدير */
  return a.tab === 'compare' && a.cmp === 'sib' && hasSib ? 'group' : 'section';
}

/* خيار التشخيص (ق18): الضغط على PDF يفتح لوحة «مع التشخيص / بدون تشخيص» داخل الشريط ذاته (لا نافذة فوق نافذة التحليل) */
function gaSetDx(on){ if(typeof setReportDx === 'function') setReportDx(!!on); const a = crmGradeAnalysis; if(a) paintCrmGradeAnalysis(); }
function gaPdfAsk(){ const a = crmGradeAnalysis; if(!a) return; a.dxAsk = true; paintCrmGradeAnalysis(); }
function gaPdfCancel(){ const a = crmGradeAnalysis; if(!a) return; a.dxAsk = false; paintCrmGradeAnalysis(); }
async function gaPdfGo(btn){
  const a = crmGradeAnalysis;
  if(!a) return;
  await exportGradeReport(btn);
  if(crmGradeAnalysis === a && a.dxAsk){ a.dxAsk = false; paintCrmGradeAnalysis(); }
}

/* شريط التصدير: PDF وExcel زرّان ظاهران دائمًا (نقرتان من فتح التحليل)، والخيارات مطوية */
function gaExportHtml(a){
  const hasSib = gradeSiblingSectionIds(a.g).length > 0;
  const opts = a.exportOpen
    ? `<div class="crm-ga-exp"><label class="crm-ga-chk"><input type="checkbox" id="crmGaNames"${a.withNames ? ' checked' : ''} onchange="crmGradeAnalysis.withNames = this.checked"> مع أسماء الطلاب</label>
        <label class="gr-fld"><span>نطاق التقرير</span><select class="goal-input" id="crmGaScope" onchange="crmGradeAnalysis.scope = this.value; crmGradeAnalysis.scopeTouched = true">
          <option value="section"${gaEffectiveScope(a) !== 'group' ? ' selected' : ''}>الشعبة الحالية</option>
          <option value="group"${gaEffectiveScope(a) === 'group' ? ' selected' : ''}${hasSib ? '' : ' disabled'}>كل شعب الصف${hasSib ? '' : ' (لا شعب أخرى)'}</option></select></label>
        <button type="button" class="crm-ga-link" onclick="openGradeReportEditor('ga')">ترويسة التقرير: المدرسة والمعلم</button></div>`
    : '';
  const on = typeof reportDxOn === 'function' ? reportDxOn() : true;
  const radio = (v, label, note) => `<label class="gdx${(v === 'with') === on ? ' on' : ''}"><input type="radio" name="crmGaDx" value="${v}"${(v === 'with') === on ? ' checked' : ''} onchange="gaSetDx(this.value === 'with')"><span><b>${label}</b><small>${note}</small></span></label>`;
  const acts = a.dxAsk
    ? `<div class="crm-ga-dx">${radio('with', 'مع التشخيص', 'القوة والضعف والتوصيات مع البيانات')}${radio('without', 'بدون تشخيص', 'بيانات فقط، بلا أي كلام تحليلي')}<div class="crm-ga-acts"><button type="button" class="btn btn-primary" onclick="gaPdfGo(this)">⤓ طباعة / حفظ PDF</button><button type="button" class="btn btn-outline" onclick="gaPdfCancel()">إلغاء</button></div></div>`
    : `<div class="crm-ga-acts"><button type="button" class="btn btn-primary" onclick="gaPdfAsk()">⤓ PDF للطباعة</button><button type="button" class="btn btn-outline" onclick="exportCrmGradeAnalysis('xlsx', this)">Excel</button></div>`;
  return `<div class="crm-ga-bot">${opts}${acts}
    <button type="button" class="crm-ga-link crm-ga-optlink" aria-expanded="${!!a.exportOpen}" onclick="toggleCrmGaExport()">${a.exportOpen ? 'إخفاء خيارات التقرير ⌃' : 'خيارات التقرير ⌄'}</button></div>`;
}

function crmGradeAnalysisHtml(a){
  if(a.reportEdit) return gradeReportEditorHtml(); /* app-34 */
  if(a.editing) return gaLettersEditorHtml(a); /* app-30 */
  if(a.rulesEdit) return gaRulesEditorHtml(a); /* app-31 */
  const v = gradeAnalysisView(a);
  const s = v.stats;
  if(!s.total) return '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>';
  if(!s.recorded) return '<div class="empty-state">لم تُرصد درجات لهذا العمود بعد.</div>';
  const body = a.tab === 'students' ? gaStudentsHtml(a, v) : a.tab === 'compare' ? gaCompareHtml(a, v) : gaOverviewHtml(a, v);
  return gaTabsHtml(a) + `<div class="crm-ga-pane">${body}</div>` + gaExportHtml(a);
}

/* الضغط على اسم: يفتح صفحة الطالب بالكشف (إن لم تتغيّر الشعبة المعروضة منذ فتح النافذة) */
function openCrmGradeAnalysisStudent(id){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId) return;
  closeCrmModal();
  openCrmGradeStudentDetail(id);
}

/* ============ التصدير ============ */
function gradeAnalysisExportRows(a, v, withNames){
  const s = v.stats;
  const inc = s.incomplete || [];
  const rows = [
    ['تحليل الدرجات'], ['الشعبة', a.label], ['العمود', v.colLabel], ['الدرجة من', v.displayMax], [],
    ['مكتملو الرصد', s.recorded, 'من', s.total], ['رصد غير مكتمل (لا يُصنَّفون)', inc.length],
    ['المتوسط', s.avg === null ? '' : s.avg], ['الوسيط', s.median === null ? '' : s.median],
    ['الأعلى', s.max === null ? '' : s.max], ['الأدنى', s.min === null ? '' : s.min],
    ['ضعاف', s.groups.low.length], ['متوسطون', s.mid.length], [s.topIsFallback ? 'الأعلى درجات' : 'متفوقون', s.groups.top.length],
    [], ['الفئة', 'العدد']
  ].concat(GRADE_ANALYSIS_BANDS.map((b, i) => [b, s.bands[i]]));
  const letters = gradeLettersNow();
  const lc = gradeLetterCounts(v.rows.filter(r => !r.incomplete), letters);
  rows.push([], ['التقدير', 'من %', 'العدد']);
  letters.forEach((l, i) => rows.push([l.label, l.min, lc[i]]));
  if(withNames){
    const topIds = new Set(s.groups.top.map(x => x.id));
    const grpOf = r => r.incomplete ? 'رصد غير مكتمل' : r.pct < s.passPct ? 'ضعيف' : topIds.has(r.id) ? (s.topIsFallback ? 'الأعلى درجات' : 'متفوق') : 'متوسط';
    rows.push([], ['الطالب', 'الدرجة', 'النسبة %', 'الفئة', 'التقدير', 'الناقص']);
    v.rows.forEach(r => rows.push([r.name, r.points === null ? '' : r.points, r.pct === null || r.incomplete ? '' : Math.round(r.pct), grpOf(r), r.pct === null || r.incomplete ? '' : letters[gradeLetterIndex(r.pct, letters)].label, r.incomplete ? (r.missing || []).join('، ') : '']));
  }
  return rows;
}

async function exportCrmGradeAnalysis(kind, btn){
  const a = crmGradeAnalysis;
  if(kind === 'pdf') return exportGradeReport(btn); /* app-34: تقرير الشعبة/البند/مجموعة الشعب */
  if(crmGradeAnalysisBusy || !a) return;
  const v = gradeAnalysisView(a);
  if(!v.stats.recorded){ showToast('لا درجات مرصودة لتصديرها', 'error'); return; }
  const withNames = !!a.withNames;
  crmGradeAnalysisBusy = true;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  const dateStr = new Date().toISOString().slice(0, 10);
  const base = `تحليل-درجات-${String(a.label).replace(/[\\\/:*?"<>|\s]+/g, '-')}-${dateStr}`;
  try{
    {
      await ensureXlsxLib();
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      const ws = XLSX.utils.aoa_to_sheet(gradeAnalysisExportRows(a, v, withNames));
      ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, 'التحليل');
      const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = base + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    showToast('تم التصدير', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + (err.message || ''), 'error');
  } finally {
    crmGradeAnalysisBusy = false;
    endExportBusy(btn);
  }
}
