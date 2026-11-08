/* ============================================================
   تقارير الدرجات PDF: التصدير والطباعة وإعدادات الترويسة (المنشئات في app-36/38/39، وهويتها في REPORTS.md)
   ------------------------------------------------------------
   - المعلم يختار ما يُطبع (الأقسام)، وبياناته (المدرسة · المعلم · وكيل شؤون الطلاب) — كلها في features.reportPrefs
     (user_app_settings) وتُطبَّق على كل تقاريره. غياب المفتاح = الافتراضي.
   - ما لم يُرصد لا يُحسب (لا صفر) — كما في تحليل الدرجات (app-29).
   - كل استعلام لشعب أخرى/فصل سابق يمرّ عبر loadGradeSheetsRaw (فلترة teacher_id صريحة)،
     وكل نص من المستخدم/القاعدة يمرّ عبر escapeHtml.
   ============================================================ */

const GRADE_REPORT_DEFAULT = {
  school: '', logo: '', teacher: '', vice: '', staff: '', counselor: '', subject: '', /* vice = وكيل شؤون الطلاب · staff = وكيل شؤون المعلمين · counselor = الموجه الطلابي */
  show: { levels: true, items: true, names: false, compare: false }
};
const GRADE_REPORT_SHOW_LABELS = {
  levels: 'توزيع الطلاب على المستويات',
  items: 'درجات البنود',
  names: 'أسماء الطلاب (ضعاف · متوسطون · متفوقون)',
  compare: 'مقارنة بالفصل السابق (تقرير الشعبة)'
};
const GRADE_REPORT_NAME_MAX = 80;
/* شعار المدرسة: لا يدخل features (قيد القاعدة < 4000 بايت)؛ يُرفع لحاوية الصور بمجلد المستخدم ويُحفظ مساره فقط:
   <uid>/school-logo-<ts>.png. وللطباعة يُحمَّل ويُحوَّل data URL (GRADE_REPORT_DATA_RE) */
const GRADE_REPORT_LOGO_MAX = 60000; /* حدّ حجم الصورة بعد التصغير */
const GRADE_REPORT_LOGO_RE = /^[0-9a-f-]{36}\/school-logo-\d{10,16}\.png$/;
const GRADE_REPORT_DATA_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}$/;

/* ============ دوال صرفة: الإعدادات ============ */

function gradeReportDefaultCopy(){ return JSON.parse(JSON.stringify(GRADE_REPORT_DEFAULT)); }

/* ما يُقرأ من القاعدة لا يُوثق بشكله. null = الافتراضي (لا يُخزَّن) */
function normalizeReportPrefs(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = gradeReportDefaultCopy();
  ['school', 'teacher', 'vice', 'staff', 'counselor', 'subject'].forEach(k => {
    if(typeof raw[k] === 'string') out[k] = raw[k].replace(/\s+/g, ' ').trim().slice(0, GRADE_REPORT_NAME_MAX);
  });
  /* شعار المدرسة: مسار ملفه بمجلد المستخدم فقط؛ غير ذلك يُهمَل (ما يُقرأ من القاعدة لا يُوثق به) */
  if(typeof raw.logo === 'string' && GRADE_REPORT_LOGO_RE.test(raw.logo)) out.logo = raw.logo;
  [['show', GRADE_REPORT_SHOW_LABELS]].forEach(([grp, labels]) => {
    Object.keys(labels).forEach(k => {
      const v = raw[grp] && raw[grp][k];
      if(v === true || v === false) out[grp][k] = v;
    });
  });
  return JSON.stringify(out) === JSON.stringify(GRADE_REPORT_DEFAULT) ? null : out;
}

/* خيار «مع التشخيص / بدون تشخيص» (ق18): تفضيل الجهاز، الأصل مع التشخيص؛ يحدّد إن كانت التقارير تتضمن الأقسام التحليلية */
const REPORT_DX_KEY = 'shahid_report_dx';
function reportDxOn(){ try{ return localStorage.getItem(REPORT_DX_KEY) !== 'without'; } catch(e){ return true; } }
function setReportDx(on){ try{ localStorage.setItem(REPORT_DX_KEY, on ? 'with' : 'without'); } catch(e){ /* بلا حفظ */ } }

function gradeReportPrefsNow(){
  return normalizeReportPrefs(typeof appFeatures !== 'undefined' && appFeatures && appFeatures.reportPrefs) || gradeReportDefaultCopy();
}

/* اسم المعلم: ما كتبه، وإلا اسم حسابه تلقائيًا */
function gradeReportTeacherName(prefs){
  if(prefs && prefs.teacher) return prefs.teacher;
  const meta = (typeof currentUser !== 'undefined' && currentUser && currentUser.user_metadata) || {};
  return String(meta.full_name || '').trim();
}

/* المادة والمدرسة: ما كتبه المعلم، وإلا من حقول ملفه الشخصي تلقائيًا */
function gradeReportSubject(prefs){
  if(prefs && prefs.subject) return prefs.subject;
  return typeof getProfileSubject === 'function' ? String(getProfileSubject() || '').trim() : '';
}
function gradeReportSchool(prefs){
  if(prefs && prefs.school) return prefs.school;
  return typeof getProfileSchool === 'function' ? String(getProfileSchool() || '').trim() : '';
}

/* بيانات الطالب من الكشف المحمَّل */
function gradeReportStudentData(g, studentId){
  const students = crmStudentsOfSection(g.sectionId);
  const st = students.find(x => x.id === studentId);
  if(!st) return null;
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  /* الأساس نفسه كتحليل الشعبة: مقارنته بمكتملي الرصد فقط، وغير المكتمل يُعرض بما رُصد له ولا يُصنَّف */
  const res = gradeAnalysisRows(g, students, 'total', caps, testsOn);
  const row = res.rows.find(x => x.id === studentId);
  const comp = res.rows.filter(x => !x.incomplete && x.points !== null);
  const r = studentGradeResult(g.columns, g.scores, studentId, caps);
  const has = row.points !== null;
  const mean = fn => comp.length ? comp.reduce((a, x) => a + fn(x), 0) / comp.length : null;
  const colAvgPct = (id, mx) => {
    const rows = (g.scores || []).filter(s => s.column_id === id);
    return rows.length ? 100 * rows.reduce((a, s) => a + Number(s.score), 0) / rows.length / mx : null;
  };
  const items = r.performance.parts.concat(testsOn ? r.tests.list : []).map(x => ({
    name: x.name, score: x.score, max: x.max,
    pct: x.score === null ? null : 100 * x.score / x.max, classPct: colAvgPct(x.id, x.max)
  }));
  return {
    name: st.full_name, label: crmSectionLabel(g.sectionId), year: g.year, semester: g.semester,
    pts: has ? row.points : null, max: row.incomplete && row.recordedMax > 0 ? row.recordedMax : res.displayMax, pct: has ? row.pct : null,
    classPts: mean(x => x.points), classPct: mean(x => x.pct),
    incomplete: !!row.incomplete, missing: row.missing || [],
    items, rules: gradeAnalysisRulesNow()
  };
}

/* شعار وزارة التعليم: يُقرأ مرة ويُخزَّن (data URL) ليُطبع مع النص؛ فشل تحميله لا يمنع التقرير (خانة فارغة) */
let gradeReportLogoCache = null;
async function gradeReportLogoData(){
  if(gradeReportLogoCache !== null) return gradeReportLogoCache;
  try{
    const res = await fetch('moe-logo.png');
    if(!res.ok) throw new Error('logo');
    const blob = await res.blob();
    gradeReportLogoCache = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob); });
  } catch(e){ return ''; } /* الفشل لا يُخزَّن: التصدير التالي يعيد المحاولة */
  return gradeReportLogoCache;
}

/* شعار المدرسة للطباعة: يُحمَّل من حاوية الصور ويُخزَّن بالمسار (مسار جديد = شعار جديد)؛ الفشل = بلا شعار ولا يمنع التقرير */
let gradeReportSchoolLogoCache = { path: '', data: '' };
async function gradeReportSchoolLogoData(){
  const path = gradeReportPrefsNow().logo;
  if(!path || !GRADE_REPORT_LOGO_RE.test(path) || !currentUser || path.split('/')[0] !== currentUser.id) return '';
  if(gradeReportSchoolLogoCache.path === path && gradeReportSchoolLogoCache.data) return gradeReportSchoolLogoCache.data;
  try{
    const { data, error } = await sb.storage.from('shawahid-photos').download(path);
    if(error || !data) throw new Error('logo');
    const url = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(data); });
    if(!GRADE_REPORT_DATA_RE.test(url)) return '';
    gradeReportSchoolLogoCache = { path, data: url };
    return url;
  } catch(e){ return ''; }
}

/* ============ التصدير ============ */
let gradeReportBusy = false;

/* ===== الطباعة / الحفظ كـPDF من المتصفح: نص حقيقي (يرسمه المتصفح بخطه) =====
   - لا صورة ولا مكتبات PDF: المتصفح يرسم العربية بنفسه (تشكيل واتجاه صحيحان) والنص قابل للتحديد والبحث.
   - الترويسة المصغّرة (من الصفحة 2) والترقيم في هوامش @page (يدعمها Chrome الحديث؛ غيره يتجاهلها).
   - تُنظَّف #printArea بعد الطباعة حتى لا يبقى @page هذا يؤثر في طباعة أخرى.
   - عنوان الصفحة يصير اسم الملف المقترح عند «حفظ كـPDF»، ثم يُعاد. */
function gradeReportPrintCss(mark){
  const q = t => String(t || '').replace(/[\\"]/g, '').replace(/[\r\n]+/g, ' ');
  const box = "font-family:'Helvetica Neue W23 for SKY',Cairo,sans-serif;font-size:8.5pt;color:#55646f"; /* خط الوزارة (style.css) ثم Cairo احتياطًا */
  const top = mark && (mark.right || mark.left)
    ? `@top-right{content:"${q(mark.right)}";${box}}@top-left{content:"${q(mark.left)}";${box}}` : '';
  return `@page{size:A4;margin:15mm 15mm 14mm;${top}@bottom-center{content:"صفحة " counter(page) " / " counter(pages);${box}}}`
    + '@page :first{@top-right{content:none}@top-left{content:none}}'
    + '@media print{html{-webkit-text-size-adjust:none;text-size-adjust:none}#printArea.wrap{max-width:none;padding-bottom:0}.gr-pg{break-after:page;page-break-after:always}.gr-pg:last-child{break-after:auto;page-break-after:auto}}';
}

function gradeReportMark(prefs, title, label){
  const subject = gradeReportSubject(prefs);
  return { right: `${title} · ${label}${subject ? ' · ' + subject : ''}`, left: gradeReportSchool(prefs) };
}

let gradeReportSavedTitle = null;

/* تُرجع وعدًا: لا تُطبع الصفحة قبل أن تُفكّ صورة الشعار (وإلا خرجت الترويسة بلا شعار في أول تصدير) */
function gradeReportPrint(html, mark, title){
  const area = document.getElementById('printArea');
  if(!area) return Promise.resolve();
  printCleanupNow(); /* تنظيف طباعة سابقة معلَّق (app-01) قبل وضع المحتوى الجديد */
  area.innerHTML = `<style>${gradeReportPrintCss(mark)}</style>` + html;
  if(title){
    if(gradeReportSavedTitle === null) gradeReportSavedTitle = document.title;
    document.title = title;
  }
  const clear = () => {
    if(area.querySelector('.gr')) area.innerHTML = '';
    if(gradeReportSavedTitle !== null){ document.title = gradeReportSavedTitle; gradeReportSavedTitle = null; }
  };
  const imgs = area.querySelectorAll ? Array.from(area.querySelectorAll('img')) : [];
  if(!imgs.length){ printNow(clear); return Promise.resolve(); }
  const decoded = Promise.all(imgs.map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => {})));
  return Promise.race([decoded, new Promise(r => setTimeout(r, 3000))]).then(() => { printNow(clear); });
}

/* build() يُرجع { html, mark } أو '' (توقّف). التحميل غير المتزامن (شعب أخرى/فصل سابق) داخل build */
async function gradeReportRun(btn, build, filename, busyText){
  if(gradeReportBusy) return;
  gradeReportBusy = true;
  beginExportBusy(btn, busyText || 'جارٍ التجهيز...');
  try{
    const out = await build();
    if(!out || !out.html) return;
    if(document.fonts && document.fonts.load){
      try{ await Promise.all(['400', '700', '800'].map(w => document.fonts.load(`${w} 12px 'Cairo'`, 'شاهد الأداء الوظيفي'))); } catch(e){ /* لا يمنع الطباعة */ }
    }
    await gradeReportPrint(out.html, out.mark, filename);
  } catch(err){
    showToast('تعذّر تجهيز التقرير: ' + (err.message || ''), 'error');
  } finally {
    gradeReportBusy = false;
    endExportBusy(btn);
  }
}

const gradeReportFile = (prefix, label) => `${prefix}-${String(label).replace(/[\\\/:*?"<>|\s]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;

/* من نافذة التحليل: تقرير الشعبة/البند، أو مجموعة شعب الصف */
async function exportGradeReport(btn){
  const a = crmGradeAnalysis;
  if(!a || gradeReportBusy) return;
  const prefs = gradeReportPrefsNow();
  const scope = gaEffectiveScope(a);
  const withNames = !!a.withNames;
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const sec = crmSectionById(a.g.sectionId);
  const level = typeof crmGradeLevels !== 'undefined' && sec ? crmGradeLevels.find(x => x.id === sec.grade_level_id) : null;
  const gradeName = level ? level.name : 'الصف';
  await gradeReportRun(btn, async () => {
    const logo = await gradeReportLogoData();
    const base = { logo, schoolLogo: await gradeReportSchoolLogoData(), date: new Date().toISOString().slice(0, 10), year: a.g.year, semester: a.g.semester, withNames, noDx: !reportDxOn() };
    if(scope === 'section'){
      const v = gradeAnalysisView(a);
      if(!v.stats.recorded){ showToast('لا درجات مرصودة لتصديرها', 'error'); return ''; }
      let prev = null;
      if(prefs.show.compare || (a.tab === 'compare' && a.cmp === 'prev')){ /* داخل «الفصل السابق» يُضمَّن القسم ولو أُطفئ في الخيارات */
        const term = previousGradeTerm(a.g.year, a.g.semester);
        const res = term ? (await loadGradeSheetsRaw([a.g.sectionId], term.year, term.semester))[0] : null;
        if(crmGradeAnalysis !== a) return '';
        const spec = gradeSpecOf(a);
        const prevMap = res && hasBaseGradeColumns(res.columns) ? gradePctMap(res, a.students, spec, caps, testsOn) : null;
        const nowMap = gradePctMap(a.g, a.students, spec, caps, testsOn);
        const sum = prevMap && prevMap.size && nowMap ? gradeChangeSummary(nowMap, prevMap) : null;
        if(sum && sum.compared >= SS_PREV_MIN) prev = { sum, names: new Map(a.students.map(s => [s.id, s.full_name])) };
        else showToast('لا طلاب كافون للمقارنة بالفصل السابق (أقلهم 5 لهم درجات في الفصلين) — حُذف قسم المقارنة', 'ok');
      }
      /* تقرير الشعبة (المجموع أو بند واحد) بهوية الوزارة وتشخيص الصف (app-38، ق8، ق11) */
      return { html: await ssBuildFromAnalysis(a, v, prefs, Object.assign(base, { prev })), mark: gradeReportMark(prefs, 'تقرير أداء الشعبة', a.label) };
    }
    /* مجموعة شعب الصف */
    const sibIds = gradeSiblingSectionIds(a.g);
    if(!sibIds.length){ showToast('لا شعب أخرى لهذا الصف', 'error'); return ''; }
    /* تقرير المقارنة بين الشعب (المجموع أو بند واحد) بهوية الوزارة (app-39، ق9، ق11) */
    {
      const html = await sgBuildFromAnalysis(a, prefs, base);
      return html ? { html, mark: gradeReportMark(prefs, 'تقرير مقارنة شعب الصف', gradeName) } : '';
    }
  }, scope === 'group' ? gradeReportFile('تقرير-مجموعة-شعب', gradeName) : gradeReportFile('تقرير-درجات', a.label));
}

/* تقرير طالب واحد (لولي الأمر): من الكشف المحمَّل g — لا استعلام جديد */
/* كل طلاب الشعبة في ملف PDF واحد: تقرير لكل طالب بصفحة جديدة، ومن لم تُرصد درجاته يُستثنى */
async function exportCrmAllStudentReports(btn, to, ids, scopeLabel, version){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId || gradeReportBusy) return;
  const g = a.g;
  const analytic = version === 'analytical'; /* التحليلية: كل ما يخص الطالب، بتشخيص أو بدونه حسب الاختيار */
  const prefs = gradeReportPrefsNow();
  const date = new Date().toISOString().slice(0, 10);
  const pool = ids ? a.students.filter(st => ids.has(st.id)) : a.students;
  const list = pool.filter(st => { const d = gradeReportStudentData(g, st.id); return d && d.pts !== null; });
  if(!list.length){ showToast('لا طلاب لهم درجات مرصودة', 'error'); return; }
  const skipped = ids ? 0 : a.students.length - list.length;
  if(skipped) showToast(`${skipped} من الطلاب بلا درجات مرصودة — لم تُضمَّن تقاريرهم`, 'ok');
  await gradeReportRun(btn, async () => {
    /* تقرير الطالب الجديد (app-36، نسخة الدرجات): بنفس كشف الشعبة المحمَّل فلا استعلام إضافي لكل طالب */
    const pages = [];
    for(const st of list){
      const one = await srBuildReport(st.id, analytic ? 'analytical' : 'grades', to, { g });
      pages.push(`<div class="gr-pg">${one.html}</div>`);
    }
    return { html: pages.join(''), mark: gradeReportMark(prefs, analytic ? 'تقارير أداء الطلاب التحليلية' : 'تقارير أداء الطلاب', a.label + (scopeLabel ? ' · ' + scopeLabel : '')) };
  }, gradeReportFile((scopeLabel ? 'تقارير-' + scopeLabel : 'تقارير-الطلاب') + (analytic ? '-تحليلي' : ''), a.label), btn && to ? '…' : undefined);
}

/* من قائمة الطلاب داخل نافذة التحليل: نسخة الدرجات بنقرة، والجهة اسمها تحت التوقيع */
function exportCrmStudentReportFor(id, btn, to, version){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId) return;
  return srRun(id, version === 'analytical' ? 'analytical' : 'grades', to, btn, a.g);
}

/* ============ خيارات التقارير (إعدادات المعلم) ============ */
let gradeReportDraft = null; /* { host: 'ga' | 'cust', school, teacher, vice, show, error, saving } */

function openGradeReportEditor(host){
  const p = gradeReportPrefsNow();
  gradeReportDraft = { host, logo: p.logo, logoData: '',  school: p.school, teacher: p.teacher, vice: p.vice, staff: p.staff, counselor: p.counselor, subject: p.subject, show: Object.assign({}, p.show), error: '', saving: false };
  if(host === 'ga'){
    const a = crmGradeAnalysis;
    if(!a) return;
    a.reportEdit = true;
    paintCrmGradeAnalysis();
  } else {
    showInfoModal('<div id="grEditorBody" class="crm-ga"></div>', '420px');
    paintGradeReportEditor();
  }
}

function paintGradeReportEditor(){
  const d = gradeReportDraft;
  if(!d) return;
  if(d.host === 'ga') return paintCrmGradeAnalysis();
  const box = document.getElementById('grEditorBody');
  if(box) box.innerHTML = gradeReportEditorHtml();
  gradeReportLogoPreviewLoad();
}

function gradeReportEditorHtml(){
  const d = gradeReportDraft;
  if(!d) return '';
  const auto = gradeReportTeacherName({ teacher: '' });
  const fld = (k, label, ph) => `<label class="gr-fld"><span>${label}</span><input class="goal-input" type="text" maxlength="${GRADE_REPORT_NAME_MAX}" id="grFld_${k}" value="${escapeHtml(d[k])}" placeholder="${escapeHtml(ph || '')}" oninput="gradeReportDraftText('${k}', this.value)"></label>`;
  const chk = (grp, k, label) => `<label class="crm-ga-chk"><input type="checkbox"${d[grp][k] ? ' checked' : ''} onchange="gradeReportDraftFlag('${grp}', '${k}', this.checked)"> ${label}</label>`;
  return `<div class="crm-ga-sec">خيارات التقارير</div>
    <p class="crm-ga-fine" style="margin-top:0">تُطبَّق على كل تقاريرك: الشعبة والبند ومجموعة الشعب والطالب.</p>
    ${fld('school', 'اسم المدرسة', gradeReportSchool({ school: '' }) ? 'تلقائي: ' + gradeReportSchool({ school: '' }) : 'مثال: ثانوية بدر')}
    ${gradeReportLogoField(d)}
    ${fld('teacher', 'اسم المعلم', auto ? 'تلقائي: ' + auto : 'اسم المعلم')}
    ${fld('vice', 'وكيل شؤون الطلاب', 'يظهر في التوقيع')}
    ${fld('staff', 'وكيل شؤون المعلمين', 'يظهر في توقيعه عند التوجيه إليه')}
    ${fld('counselor', 'الموجه الطلابي', 'يظهر في توقيعه عند التوجيه إليه')}
    <p class="crm-ga-fine">تُدخلها مرة واحدة فتُحفظ وتظهر في كل تقاريرك، وتعدّلها متى شئت.</p>
    <details class="gr-more"><summary>خيارات إضافية: المادة · ما يُطبع</summary>
    ${fld('subject', 'المادة', gradeReportSubject({ subject: '' }) ? 'تلقائي: ' + gradeReportSubject({ subject: '' }) : 'مثال: الفيزياء')}
    <div class="crm-ga-sec" style="margin-top:12px">ما يُطبع في التقرير</div>
    ${Object.keys(GRADE_REPORT_SHOW_LABELS).map(k => chk('show', k, GRADE_REPORT_SHOW_LABELS[k])).join('')}
    </details>
    <div class="crm-ga-err" id="grEditorErr">${escapeHtml(d.error)}</div>
    <button type="button" class="btn btn-primary" id="grEditorSave" style="width:100%" ${d.saving ? 'disabled' : ''} onclick="saveGradeReportPrefs()">حفظ</button>
    <div class="crm-ga-eacts"><button type="button" class="crm-ga-link" onclick="gradeReportEditorReset()">الافتراضي</button><button type="button" class="crm-ga-link" onclick="gradeReportEditorCancel()">إلغاء</button></div>`;
}

/* شعار المدرسة: خيار اختياري لكل معلم (يُحفظ مع خياراته). يُقصّ بياضه ويُصغَّر قبل الحفظ */
function gradeReportLogoField(d){
  return `<div class="gr-fld"><span>شعار المدرسة (اختياري — يظهر مقابل شعار الوزارة)</span>
    <div class="gr-logo">${gradeReportLogoPreview(d)}
    <label class="crm-ga-link" style="cursor:pointer">${d.logo || d.logoData ? 'تغيير' : 'رفع صورة'}<input type="file" accept="image/png,image/jpeg" style="display:none" onchange="gradeReportPickLogo(this)"></label>
    ${d.logo || d.logoData ? '<button type="button" class="crm-ga-link" onclick="gradeReportDraftLogo(\'\', true)">حذف</button>' : ''}</div></div>`;
}

/* معاينة: الصورة المختارة حديثًا، وإلا شعار محفوظ يُحمَّل بعد الرسم (لا رابط عام بالصفحة) */
function gradeReportLogoPreview(d){
  if(d.logoData) return `<img src="${d.logoData}" alt="">`;
  return d.logo ? '<img id="grLogoPrev" alt="">' : '';
}
async function gradeReportLogoPreviewLoad(){
  const d = gradeReportDraft, el = document.getElementById('grLogoPrev');
  if(!d || !el || !d.logo) return;
  const url = d.logo === gradeReportPrefsNow().logo ? await gradeReportSchoolLogoData() : '';
  const again = document.getElementById('grLogoPrev');
  if(gradeReportDraft === d && again && url) again.src = url;
}

function gradeReportDataToBlob(url){
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+\/]+={0,2})$/.exec(String(url));
  if(!m) throw new Error('logo');
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/* clear=true: حذف الشعار (المحفوظ والمختار حديثًا)؛ وإلا v = data URL لصورة جديدة تُرفع عند «حفظ» */
function gradeReportDraftLogo(v, clear){
  const d = gradeReportDraft;
  if(!d) return;
  if(clear){ d.logo = ''; d.logoData = ''; } else d.logoData = v;
  d.error = '';
  paintGradeReportEditor();
}

/* يقصّ الهوامش البيضاء/الشفافة ويصغّر إلى عرض أقصاه w؛ يرجع data URL (PNG) أو '' */
function gradeReportLogoShrink(img, w){
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for(let y = 0; y < c.height; y++) for(let x = 0; x < c.width; x++){
    const k = (y * c.width + x) * 4;
    if(px[k + 3] > 20 && (px[k] < 245 || px[k + 1] < 245 || px[k + 2] < 245)){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  }
  if(x1 < 0) return '';
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, sc = Math.min(1, w / cw);
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(cw * sc)); o.height = Math.max(1, Math.round(ch * sc));
  o.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

async function gradeReportPickLogo(input){
  const d = gradeReportDraft;
  const f = input && input.files && input.files[0];
  if(!d || !f) return;
  if(f.size > 8 * 1024 * 1024){ d.error = 'الصورة كبيرة جدًا'; paintGradeReportEditor(); return; }
  try{
    const url = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(f); });
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    let out = '';
    for(const w of [320, 220, 140]){ out = gradeReportLogoShrink(img, w); if(!out || out.length <= GRADE_REPORT_LOGO_MAX) break; }
    if(gradeReportDraft !== d) return;
    if(!out || out.length > GRADE_REPORT_LOGO_MAX || !GRADE_REPORT_DATA_RE.test(out)){ d.error = 'تعذّر استخدام هذه الصورة'; paintGradeReportEditor(); return; }
    gradeReportDraftLogo(out, false);
  } catch(e){ if(gradeReportDraft === d){ d.error = 'تعذّر قراءة الصورة'; paintGradeReportEditor(); } }
}

function gradeReportDraftText(k, value){ if(gradeReportDraft) gradeReportDraft[k] = value; }
function gradeReportDraftFlag(grp, k, on){ if(gradeReportDraft) gradeReportDraft[grp][k] = !!on; }

function gradeReportEditorReset(){
  const d = gradeReportDraft;
  if(!d) return;
  Object.assign(d, gradeReportDefaultCopy(), { host: d.host, logoData: '', error: '', saving: false });
  paintGradeReportEditor();
}

function gradeReportEditorCancel(){
  const d = gradeReportDraft;
  gradeReportDraft = null;
  if(d && d.host === 'ga' && crmGradeAnalysis){ crmGradeAnalysis.reportEdit = null; paintCrmGradeAnalysis(); }
  else if(d) closeCrmModal();
}

async function persistGradeReportPrefs(p){
  const uid = currentUser.id;
  const n = normalizeReportPrefs(p);
  const next = normalizeFeatures(appFeatures);
  /* الافتراضي لا يُخزَّن: غياب المفتاح = الافتراضي */
  if(n) next.reportPrefs = n; else delete next.reportPrefs;
  appFeatures = next;
  await saveAppFeatures();
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  const saved = normalizeReportPrefs(appFeaturesSaved.reportPrefs) || GRADE_REPORT_DEFAULT;
  return JSON.stringify(saved) === JSON.stringify(n || GRADE_REPORT_DEFAULT) ? null : 'تعذّر حفظ الخيارات';
}

async function saveGradeReportPrefs(){
  const d = gradeReportDraft;
  if(!d || d.saving) return;
  const a = crmGradeAnalysis;
  const uid = currentUser.id;
  const oldLogo = gradeReportPrefsNow().logo;
  d.saving = true;
  const btn = document.getElementById('grEditorSave');
  if(btn) btn.disabled = true;
  /* شعار جديد: يُرفع أولًا بمسار فريد بمجلد المستخدم، ويُحذف إن فشل حفظ الخيارات (لا ملفات يتيمة) */
  let newPath = '';
  if(d.logoData){
    try{
      const blob = gradeReportDataToBlob(d.logoData); /* لا fetch لـdata: — سياسة CSP (connect-src) تمنعه */
      const path = `${uid}/school-logo-${Date.now()}.png`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, blob, { contentType: 'image/png' });
      if(upErr) throw upErr;
      newPath = path;
    } catch(e){
      if(gradeReportDraft !== d) return;
      d.saving = false; d.error = 'تعذّر رفع الشعار'; paintGradeReportEditor(); return;
    }
  }
  const p = { school: d.school, logo: newPath || d.logo, teacher: d.teacher, vice: d.vice, staff: d.staff, counselor: d.counselor, subject: d.subject, show: d.show };
  const err = await persistGradeReportPrefs(p);
  if(err){
    if(newPath) sb.storage.from('shawahid-photos').remove([newPath]).catch(() => {});
    if(gradeReportDraft !== d) return;
    d.saving = false; d.error = err; paintGradeReportEditor(); return;
  }
  /* نجح الحفظ: الشعار القديم لم يعد مرتبطًا بشيء فيُحذف */
  if(oldLogo && oldLogo !== p.logo && oldLogo.split('/')[0] === uid) sb.storage.from('shawahid-photos').remove([oldLogo]).catch(() => {});
  if(gradeReportDraft !== d) return;
  d.saving = false;
  gradeReportDraft = null;
  if(d.host === 'ga'){
    if(crmGradeAnalysis === a && a){ a.reportEdit = null; a.withNames = gradeReportPrefsNow().show.names; paintCrmGradeAnalysis(); }
  } else {
    closeCrmModal();
  }
  showToast('حُفظت خيارات التقارير', 'ok');
}
