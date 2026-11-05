/* ============================================================
   تحليل درجات الشعبة — يُفتح بالضغط على شريط الملخص أعلى الكشف
   ------------------------------------------------------------
   - نافذة بثلاث تبويبات: «نظرة عامة» (جملة خلاصة + شريط المستويات + أربع بطاقات)،
     «الطلاب» (أسماء كل مستوى)، «مقارنات» (app-30)، وزر تصدير واحد ثابت أسفل النافذة.
   - أربعة مستويات تغطي كل من رُصد له: يحتاجون دعمًا · على الحافة · جيد · متفوقون.
   - الأرقام المعروضة صحيحة (بلا كسور)؛ الكسور في ملف Excel فقط. التصنيف دائمًا بالرقم الدقيق،
     والتقريب لا يُظهر رقمًا يوحي بتجاوز حدّ لم يبلغه الطالب (49.6 لا تُعرض 50%).
   - ما لم يُرصد لا يُحسب (لا صفر)؛ ومن رُصد له جزء من الأعمدة يُحسب بنسبته مما رُصد له.
   - الأسماء من طلاب الشعبة المحمَّلة فقط (فلترة صريحة بـ teacher_id في تحميل الكشف نفسه)،
     والتصدير بلا أسماء ما لم يُحدَّد غير ذلك، وبلا تعليق تربوي ما لم يُطلب.
   ============================================================ */

const GRADE_ANALYSIS_RULES = {
  edgeAbovePct: 10, /* «على الحافة»: نجح بهامش أقل من 10 نقاط مئوية فوق حد النجاح */
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
  { key: 'low', label: 'يحتاجون دعمًا', tone: 'lo' },
  { key: 'edge', label: 'على الحافة', tone: 'mid' },
  { key: 'good', label: 'جيد', tone: 'good' },
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

/* صفوف الطلاب لعمود التحليل: key = 'total' أو id عمود.
   points = درجة الطالب، pct = نسبته مما رُصد له (null = لم يُرصد). displayMax = السلّم المعروض. */
function gradeAnalysisRows(g, students, key, caps, testsOn){
  const columns = g.columns || [];
  if(key === 'total'){
    const perfMax = columns.filter(c => c.category === 'performance').reduce((a, c) => a + Number(c.max_score), 0);
    const displayMax = perfMax + (testsOn ? Number(caps.tests) : 0);
    const rows = (students || []).map(st => {
      const t = studentGradeTotal(studentGradeResult(columns, g.scores, st.id, caps), testsOn, caps);
      const has = t.points !== null && t.recordedMax > 0;
      return { id: st.id, name: st.full_name, points: has ? t.points : null, pct: has ? 100 * t.points / t.recordedMax : null, recordedMax: t.recordedMax, partial: has && t.recordedMax < displayMax };
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
      return { id: st.id, name: st.full_name, points: has ? byStudent.get(st.id) : null, pct: has ? 100 * byStudent.get(st.id) / max : null, recordedMax: max, partial: false };
    })
  };
}

/* أرقام وفئات من الصفوف: لمن رُصد له فقط */
function analyzeGradeRows(rows, displayMax){
  const rec = rows.filter(r => r.points !== null);
  const rules = gradeAnalysisRulesNow();
  const pass = rules.pass;
  const r2 = n => Math.round(n * 100) / 100;
  const pts = rec.map(r => r.points).sort((a, b) => a - b);
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
  /* لا أحد بلغ حدّ المتفوق: اختياريًا تُعرض أعلى 3 (ممن نجحوا) باسم «الأعلى درجات» */
  const topIsFallback = !groups.top.length && rules.fallback;
  if(topIsFallback) groups.top = rec.filter(r => r.pct >= pass).sort((a, b) => -byPct(a, b)).slice(0, 3);
  /* «جيد»: من نجح بهامش كافٍ ولم يبلغ حدّ المتفوق (دون من عُرضوا بالبديل «الأعلى درجات») */
  const inTop = new Set(groups.top.map(r => r.id));
  const good = rec.filter(r => r.pct >= pass + rules.edge && r.pct < rules.top && !inTop.has(r.id)).sort((a, b) => -byPct(a, b));
  return {
    good,
    total: rows.length, recorded: rec.length, missing: rows.length - rec.length,
    partial: rec.filter(r => r.partial).length,
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
  crmGradeAnalysis = { g, students: crmStudentsOfSection(g.sectionId), key: 'total', open: null, showAll: null, tab: 'overview', detOpen: false, exportOpen: false, withNames: prefs.show.names, withNotes: gradeReportNotesAny(prefs), scope: 'section', reportEdit: null, mode: 'bands', rulesEdit: null, cmp: null, sib: null, prev: null, prevOpen: null, editing: null, label: crmSectionLabel(g.sectionId) };
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
  crmGradeAnalysis.key = key;
  crmGradeAnalysis.open = gradeAnalysisDefaultOpen(crmGradeAnalysis);
  crmGradeAnalysis.showAll = null;
  paintCrmGradeAnalysis();
}

function toggleCrmGaGroup(key){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.open = crmGradeAnalysis.open === key ? null : key;
  crmGradeAnalysis.showAll = null;
  paintCrmGradeAnalysis();
}

/* تبويب: نظرة عامة | الطلاب | مقارنات (مقارنة الشعب/الفصل السابق تُحمَّل عند فتح بطاقتها فقط) */
function setCrmGaTab(tab){
  const a = crmGradeAnalysis;
  if(!a) return;
  a.tab = tab === 'students' || tab === 'compare' ? tab : 'overview';
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
}

/* درجة صحيحة (2.6 ← 3) — الكسور في Excel فقط */
function gradeAnalysisPts(n){ return String(Math.round(Number(n))); }

/* نسبة صحيحة لا تتجاوز حدًّا لم يبلغه صاحبها: 49.6 تُعرض 49% لا 50% (التصنيف بالرقم الدقيق).
   bounds = حدود المستويات الصحيحة (النجاح، الحافة، المتفوق). */
function gradeAnalysisPctShown(pct, bounds){
  let r = Math.round(pct);
  (bounds || []).forEach(b => { if(pct < b && r >= b) r = b - 1; });
  return r;
}

function gradeAnalysisBounds(){
  const r = gradeAnalysisRulesNow();
  return [r.pass, r.pass + r.edge, r.top];
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
    : key === 'edge' ? `من ${r.pass}% إلى أقل من ${r.pass + r.edge}%`
    : key === 'good' ? `من ${r.pass + r.edge}% إلى أقل من ${r.top}%`
    : `${r.top}% فأكثر${topPts ? ` (${topPts} درجة فأكثر)` : ''}`;
  return `<small>${txt}</small>`;
}

/* قائمة أسماء مستوى: أول 5 ثم «عرض الكل» */
function gaNamesHtml(a, key, list){
  const all = a.showAll === key;
  const shown = all ? list : list.slice(0, GRADE_ANALYSIS_NAMES_PREVIEW);
  const bounds = gradeAnalysisBounds();
  let html = '<div class="crm-ga-names">' + shown.map(r => `<div class="crm-ga-rowwrap"><button type="button" class="crm-ga-name" onclick="openCrmGradeAnalysisStudent('${escapeHtml(r.id)}')"><span>${escapeHtml(r.name)}</span><span class="crm-ga-sc"><b class="gs-tone-${gradeAnalysisTone(r.pct)}"><bdi dir="ltr">${gradeAnalysisPctShown(r.pct, bounds)}%</bdi></b><small>${gradeAnalysisPts(r.points)} من ${formatScore(r.recordedMax)}</small></span></button><button type="button" class="crm-ga-rep" aria-label="تقرير الطالب ${escapeHtml(r.name)} لولي الأمر (PDF)" title="تقرير الطالب لولي الأمر" onclick="exportCrmStudentReportFor('${escapeHtml(r.id)}', this)">⤓</button></div>`).join('');
  if(list.length > GRADE_ANALYSIS_NAMES_PREVIEW) html += `<button type="button" class="crm-ga-more" onclick="toggleCrmGaShowAll('${key}')">${all ? 'عرض أقل ⌃' : `عرض الكل (${list.length}) ⌄`}</button>`;
  return html + '</div>';
}

/* الأعداد الصحيحة لكل مستوى بعد الاستبدال بالقائمة المعروضة (البديل «الأعلى درجات» يغيّر قائمة المتفوقين) */
function gaLevelLists(s){
  return { low: s.groups.low, edge: s.groups.edge, good: s.good, top: s.groups.top };
}

function gaLevelLabel(lv, s){ return lv.key === 'top' && s.topIsFallback ? 'الأعلى درجات' : lv.label; }

function gaTabsHtml(a){
  const tab = (k, label) => `<button type="button" role="tab" class="${a.tab === k ? 'is-on' : ''}" aria-selected="${a.tab === k}" onclick="setCrmGaTab('${k}')">${label}</button>`;
  return `<div class="crm-ga-tabs" role="tablist">${tab('overview', 'نظرة عامة')}${tab('students', 'الطلاب')}${tab('compare', 'مقارنات')}</div>`;
}

/* ملاحظات قصيرة: من لم يُرصد له شيء (خارج الحساب) ومن رُصد له جزء (داخل الحساب) */
function gaNotesHtml(s){
  const parts = [];
  if(s.missing) parts.push(`لم يُرصد لـ ${s.missing} من ${s.total} ${gaStudentsWord(s.total)} شيء بعد — لا يدخلون في الحساب (لا يُعدّون أصفارًا).`);
  if(s.partial) parts.push(`${s.partial} ${gaStudentsWord(s.partial)} لم تكتمل درجاتهم — حُسبت نتائجهم مما رُصد.`);
  return parts.length ? `<div class="crm-ga-note">${parts.join('<br>')}</div>` : '';
}

function gaOverviewHtml(a, v){
  const s = v.stats;
  const lists = gaLevelLists(s);
  const total = s.recorded;
  const rate = gaRateShown(s.passed, total);
  const segs = ['top', 'good', 'edge', 'low'].map(k => ({ k, n: lists[k].length })).filter(x => x.n);
  const bar = segs.map(x => `<i class="gs-lv-${x.k}" style="flex:${x.n}" title="${x.n}"></i>`).join('');
  let html = `<div class="crm-ga-hero"><div class="crm-ga-hero-t"><b>${s.passed} من ${total}</b> ${gaStudentsWord(total)} ناجحون (<bdi dir="ltr">${rate}%</bdi>)</div>
    <div class="crm-ga-hero-s">المتوسط <b>${gradeAnalysisPts(s.avg)} من ${formatScore(v.displayMax)}</b></div>
    <div class="crm-ga-stack">${bar}</div></div>` + gaNotesHtml(s);
  GRADE_ANALYSIS_LEVELS.forEach(lv => {
    const n = lists[lv.key].length;
    html += `<button type="button" class="crm-ga-lv gs-grp-${lv.tone}" ${n ? '' : 'disabled'} onclick="openCrmGaLevel('${lv.key}')"><b class="crm-ga-lvn">${n}</b><span class="crm-ga-lvt">${gaLevelLabel(lv, s)}${gaGroupRangeHtml(lv.key, s, v.displayMax)}</span><span class="crm-am-chev" aria-hidden="true">‹</span></button>`;
  });
  const tile = (val, label, sub) => `<div class="crm-ga-tile"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  html += `<button type="button" class="crm-ga-det${a.detOpen ? ' open' : ''}" aria-expanded="${!!a.detOpen}" onclick="toggleCrmGaDetails()"><span>تفاصيل إحصائية</span><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
  if(a.detOpen){
    html += `<div class="crm-ga-detbody"><div class="crm-ga-tiles">
      ${tile(gradeAnalysisPts(s.median), 'الوسيط', 'من ' + formatScore(v.displayMax))}
      ${tile(`${gradeAnalysisPts(s.min)} إلى ${gradeAnalysisPts(s.max)}`, 'أدنى وأعلى درجة', 'من ' + formatScore(v.displayMax))}
      ${tile(s.avgPct === null ? '—' : `<bdi dir="ltr">${s.avgPct}%</bdi>`, 'متوسط النسبة', '')}
    </div>${gaDistHtml(a, v)}<div class="crm-ga-sechead"><button type="button" class="crm-ga-link" onclick="openCrmGaRulesEditor()">⚙ تعديل حدود المستويات</button></div></div>`;
  }
  return html;
}

function gaStudentsHtml(a, v){
  const s = v.stats;
  const lists = gaLevelLists(s);
  let html = s.recorded ? `<button type="button" class="crm-ga-allrep" onclick="exportCrmAllStudentReports(this)">⤓ تقارير كل الطلاب (${s.recorded}) — ملف واحد</button>` : '';
  GRADE_ANALYSIS_LEVELS.forEach(lv => {
    const list = lists[lv.key];
    const on = a.open === lv.key && list.length;
    html += `<div class="crm-ga-grp gs-grp-${lv.tone}${on ? ' open' : ''}"><button type="button" class="crm-ga-ghead" aria-expanded="${!!on}" ${list.length ? '' : 'disabled'} onclick="toggleCrmGaGroup('${lv.key}')"><span>${gaLevelLabel(lv, s)}${gaGroupRangeHtml(lv.key, s, v.displayMax)}</span><b>${list.length}</b><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += gaNamesHtml(a, lv.key, list);
    html += '</div>';
  });
  return html + '<p class="crm-ga-fine">الأسماء من الأدنى إلى الأعلى نسبةً في المستويات الثلاثة الأولى، ومن الأعلى في «جيد» و«متفوقون». اضغط اسمًا لفتح صفحة الطالب، أو السهم ⤓ بجانبه لتقرير PDF لولي الأمر.</p>';
}

/* شريط التصدير: PDF وExcel زرّان ظاهران دائمًا (نقرتان من فتح التحليل)، والخيارات مطوية */
function gaExportHtml(a){
  const hasSib = gradeSiblingSectionIds(a.g).length > 0;
  const opts = a.exportOpen
    ? `<div class="crm-ga-exp"><label class="crm-ga-chk"><input type="checkbox" id="crmGaNames"${a.withNames ? ' checked' : ''} onchange="crmGradeAnalysis.withNames = this.checked"> مع أسماء الطلاب</label>
        <label class="crm-ga-chk"><input type="checkbox" id="crmGaNotes"${a.withNotes ? ' checked' : ''} onchange="crmGradeAnalysis.withNotes = this.checked"> مع ملاحظات تربوية (في PDF فقط)</label>
        <label class="gr-fld"><span>نطاق التقرير</span><select class="goal-input" id="crmGaScope" onchange="crmGradeAnalysis.scope = this.value">
          <option value="section"${a.scope !== 'group' ? ' selected' : ''}>الشعبة الحالية</option>
          <option value="group"${a.scope === 'group' && hasSib ? ' selected' : ''}${hasSib ? '' : ' disabled'}>كل شعب الصف${hasSib ? '' : ' (لا شعب أخرى)'}</option></select></label>
        <button type="button" class="crm-ga-link" onclick="openGradeReportEditor('ga')">ترويسة التقرير: المدرسة والمعلم</button></div>`
    : '';
  return `<div class="crm-ga-bot">${opts}<div class="crm-ga-acts"><button type="button" class="btn btn-primary" onclick="exportGradeReport(this)">⤓ PDF للطباعة</button><button type="button" class="btn btn-outline" onclick="exportCrmGradeAnalysis('xlsx', this)">Excel</button></div>
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
  const rows = [
    ['تحليل الدرجات'], ['الشعبة', a.label], ['العمود', v.colLabel], [],
    ['المرصود', s.recorded, 'من', s.total],
    ['المتوسط', s.avg === null ? '' : s.avg], ['الوسيط', s.median === null ? '' : s.median],
    ['الأعلى', s.max === null ? '' : s.max], ['الأدنى', s.min === null ? '' : s.min],
    ['ناجحون', s.passed], [gradeAnalysisLowLabel(), s.groups.low.length], ['على الحافة', s.groups.edge.length], [s.topIsFallback ? 'الأعلى درجات' : 'متفوقون', s.groups.top.length],
    [], ['الفئة', 'العدد']
  ].concat(GRADE_ANALYSIS_BANDS.map((b, i) => [b, s.bands[i]]));
  const letters = gradeLettersNow();
  const lc = gradeLetterCounts(v.rows, letters);
  rows.push([], ['التقدير', 'من %', 'العدد']);
  letters.forEach((l, i) => rows.push([l.label, l.min, lc[i]]));
  if(withNames){
    const grpOf = r => r.points === null ? 'لم يُرصد' : r.pct < s.passPct ? 'يحتاج دعمًا' : r.pct < s.passPct + s.rules.edge ? 'على الحافة' : r.pct >= s.rules.top ? 'متفوق' : '';
    rows.push([], ['الطالب', 'الدرجة', 'النسبة %', 'الفئة', 'التقدير']);
    v.rows.forEach(r => rows.push([r.name, r.points === null ? '' : r.points, r.pct === null ? '' : Math.round(r.pct), grpOf(r), r.pct === null ? '' : letters[gradeLetterIndex(r.pct, letters)].label]));
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
