/* ============================================================
   كشف الدرجات — "الكشف الثابت"
   ------------------------------------------------------------
   - لكل شعبة ولكل فصل دراسي: الأداء 40 (أعمدته هي مكوّناته: مشاركة 10،
     واجبات 10، مهام 20 — مجموعها لا يتجاوز وزن الأداء)، والاختبارات 20.
   - الاختبارات بلا سقف ولا عدد محدد: كل عمود فيها اختبار بدرجته الكاملة،
     والمحصلة = مجموع ما أخذه ÷ مجموع الدرجات الكاملة لما رُصد له × 20.
   - الكشف المبسّط سطر لكل طالب (الأداء/الاختبارات/المجموع) والتفاصيل
     بالضغط عليه؛ وكل الأعمدة للتعديل اليدوي في "الكشف التفصيلي".
   - الخانة الفارغة "لم تُرصد" لا صفر: النسبة من الأعمدة المرصودة فقط.
   - الإدخال بالعمود: افتح عمودًا، ارصد درجات الشعبة كلها، Enter ينقل للتالي.
   - الحماية مكررة في قاعدة البيانات (trigger): السقف، والدرجة لا تتجاوز
     القصوى، ولا تُخفض القصوى تحت درجة مرصودة — لا يكسرها جهاز ثانٍ.
   ============================================================ */

/* التوزيع الرسمي 40/20 (المجموع 60)، وللمعلم تقسيمه بحرية بشرط المجموع 60
   (تخصيص التطبيق) — القاعدة تفرض نفس السقف من نفس الإعداد */
const GRADE_CAPS_DEFAULT = { performance: 40, tests: 20 };
const GRADE_CAPS_TOTAL = 60;
const GRADE_COLUMN_MAX = 40; /* حد العمود الواحد في القاعدة */
function gradeCap(category){
  const caps = typeof appGradeCaps === 'function' ? appGradeCaps() : GRADE_CAPS_DEFAULT;
  return caps[category];
}
const GRADE_CATEGORY_LABELS = { performance: 'المهام الأدائية والمشاركة والتفاعل', tests: 'التقويمات الشفهية والتحريرية' };
const GRADE_CATEGORY_SHORT = { performance: 'أدائي', tests: 'اختبارات' };
const DEFAULT_GRADE_COLUMNS = [
  { category: 'performance', name: 'مشاركة', max_score: 10, kind: 'participation' },
  { category: 'performance', name: 'واجبات', max_score: 10, kind: 'homework' },
  { category: 'performance', name: 'مهام أدائية', max_score: 20, kind: 'task' }
];
/* الاختبارات يضيفها المعلم بنفسه (لا هيكل افتراضي)؛ الدرجة الكاملة للاختبار الواحد حتى 40 */
const GRADE_TEST_DEFAULT_MAX = 20;
/* نوع العمود: يدوي، أو مشاركة (نقرات ورقة الحصة +1)، أو واجبات/مهام أدائية (محسوبان تلقائيًا ولا يُعدَّلان يدويًا) */
const GRADE_KIND_LABELS = { manual: 'يدوي', participation: 'مشاركة — +1 بنقرة من ورقة الحصة', homework: 'واجبات — يُحسب تلقائيًا من رصد التسليم', task: 'مهام أدائية — يُحسب تلقائيًا من درجات المهام' };
function isComputedGradeKind(kind){ return kind === 'homework' || kind === 'task'; }

/* ============ دوال صرفة ============ */

function formatScore(n){
  if(n === null || n === undefined || n === '') return '';
  return String(Math.round(Number(n) * 100) / 100);
}

/* نص الإدخال → درجة. فارغ = لم تُرصد (null). يقبل الأرقام العربية و"٫" و"," */
function parseScoreInput(text, max){
  const raw = String(text == null ? '' : text).trim()
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/g, '.');
  if(!raw) return { ok: true, value: null };
  if(!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: 'رقم غير صالح' };
  const value = Number(raw);
  if(value > Number(max)) return { ok: false, error: 'أكبر من ' + formatScore(max) };
  return { ok: true, value };
}

function gradeCategoryTotal(columns, category, exceptId){
  return (columns || []).filter(c => c.category === category && c.id !== exceptId)
    .reduce((s, c) => s + Number(c.max_score), 0);
}

/* خطأ نصي أو null. draft = { id?, category, name, max_score } */
function validateGradeColumn(columns, draft, scores){
  const name = String(draft.name || '').trim();
  if(!name) return 'اكتب اسم العمود';
  if(name.length > 60) return 'الاسم طويل (60 حرفًا كحد أقصى)';
  const max = Number(draft.max_score);
  if(!(max > 0)) return 'الدرجة القصوى يجب أن تكون أكبر من صفر';
  if(!/^\d+(\.\d{1,2})?$/.test(String(draft.max_score).trim())) return 'الدرجة القصوى رقم بمنزلتين عشريتين كحد أقصى';
  if(max > GRADE_COLUMN_MAX) return `الدرجة القصوى للعمود الواحد ${GRADE_COLUMN_MAX} كحد أقصى`;
  const cap = gradeCap(draft.category);
  const others = gradeCategoryTotal(columns, draft.category, draft.id);
  if(draft.category === 'performance' && others + max > cap){
    return `يتجاوز سقف ${GRADE_CATEGORY_LABELS[draft.category]} (${cap}): الموزّع على الأعمدة الأخرى ${formatScore(others)}، المتبقي ${formatScore(cap - others)}`;
  }
  if(draft.id){
    const over = (scores || []).filter(s => s.column_id === draft.id && Number(s.score) > max).length;
    if(over) return `لا يمكن خفض الدرجة القصوى إلى ${formatScore(max)}: ${arabicCountPhrase(over, CRM_STUDENT_COUNT_FORMS)} ${over === 1 ? 'درجته أعلى' : 'درجاتهم أعلى'} منها. عدّل درجاتهم أولًا.`;
  }
  return null;
}

/* مجموع الطالب ونسبته في كل فئة — من الأعمدة المرصودة له فقط */
function studentGradeSummary(columns, scores, studentId){
  const mine = new Map((scores || []).filter(s => s.student_id === studentId).map(s => [s.column_id, Number(s.score)]));
  const out = {};
  ['performance', 'tests'].forEach(cat => {
    let sum = 0, recordedMax = 0, count = 0;
    (columns || []).filter(c => c.category === cat).forEach(c => {
      if(!mine.has(c.id)) return;
      sum += mine.get(c.id); recordedMax += Number(c.max_score); count++;
    });
    out[cat] = { sum, recordedMax, count, pct: recordedMax ? Math.round(100 * sum / recordedMax) : null };
  });
  return out;
}

/* نتيجة الطالب في الكشف الثابت:
   - الأداء: مجموع درجات مكوّناته (كل عمود أداء درجته من وزنه).
   - الاختبارات: مجموع ما أخذه ÷ مجموع الدرجات الكاملة لما رُصد له × وزن الاختبارات.
   ما لم يُرصد لا يُحسب (لا صفر). points = null لفئة بلا أي رصد. */
function studentGradeResult(columns, scores, studentId, caps){
  caps = caps || { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const mine = new Map((scores || []).filter(s => s.student_id === studentId).map(s => [s.column_id, Number(s.score)]));
  const r2 = n => Math.round(n * 100) / 100;
  const item = c => ({ id: c.id, name: c.name, max: Number(c.max_score), kind: c.kind || 'manual', tool_id: c.tool_id || null, score: mine.has(c.id) ? mine.get(c.id) : null });
  const parts = (columns || []).filter(c => c.category === 'performance').map(item);
  const tests = (columns || []).filter(c => c.category === 'tests').map(item);
  const pRec = parts.filter(x => x.score !== null);
  const tRec = tests.filter(x => x.score !== null);
  const earned = tRec.reduce((a, x) => a + x.score, 0), possible = tRec.reduce((a, x) => a + x.max, 0);
  const perf = {
    parts, count: pRec.length,
    max: r2(parts.reduce((a, x) => a + x.max, 0)),
    points: pRec.length ? r2(pRec.reduce((a, x) => a + x.score, 0)) : null
  };
  const t = {
    list: tests, count: tRec.length, earned: r2(earned), possible: r2(possible), max: Number(caps.tests),
    pct: possible ? Math.round(100 * Math.min(1, earned / possible)) : null,
    points: possible ? r2(Math.min(1, earned / possible) * Number(caps.tests)) : null
  };
  return { performance: perf, tests: t, total: (perf.points === null && t.points === null) ? null : r2((perf.points || 0) + (t.points || 0)) };
}

/* لعمود: كم طالبًا (من طلاب الشعبة الحاليين) بلا درجة، ومتوسط المرصود */
function gradeColumnStats(columnId, scores, studentIds){
  const ids = new Set(studentIds || []);
  const vals = (scores || []).filter(s => s.column_id === columnId && ids.has(s.student_id)).map(s => Number(s.score));
  return {
    missing: ids.size - vals.length,
    avg: vals.length ? Math.round(100 * vals.reduce((a, b) => a + b, 0) / vals.length) / 100 : null
  };
}

function previousGradeTerm(year, semester){
  if(Number(semester) === 2) return { year, semester: 1 };
  const m = /^(\d{4})-(\d{4})$/.exec(String(year || '').trim());
  if(!m) return null;
  return { year: (Number(m[1]) - 1) + '-' + (Number(m[2]) - 1), semester: 2 };
}

/* أعمدة الكشف الجديد: هيكل الفصل السابق لنفس الشعبة (بلا درجات)، وإلا الافتراضي */
function gradeSheetSeed(prevColumns, caps){
  caps = caps || { performance: gradeCap('performance'), tests: gradeCap('tests') };
  /* الاختبارات خاصة بكل فصل: لا تُنسخ من الفصل السابق */
  prevColumns = (prevColumns || []).filter(c => c.category !== 'tests');
  if(prevColumns.length){
    const prev = prevColumns.map(c => ({ category: c.category, name: c.name, max_score: Number(c.max_score), measures: c.measures || null, position: c.position || 0, kind: c.kind || 'manual', tool_id: c.tool_id || null }));
    return fitColumnsToCaps(prev, caps, false); /* يُصغَّر فقط إن تجاوز السقف الحالي */
  }
  const seed = DEFAULT_GRADE_COLUMNS.map((c, i) => ({ category: c.category, name: c.name, max_score: c.max_score, measures: null, position: i, kind: c.kind }));
  return fitColumnsToCaps(seed, caps, true); /* الافتراضي يملأ توزيع المعلم بنسبه */
}

/* يوزّع درجات أعمدة كل فئة على سقفها بالنسبة نفسها (بمنازل 0.5، والباقي على
   الأخير). exact=false: لا يمسّ فئة مجموعها ضمن السقف. سقف 0 = لا أعمدة للفئة. */
function fitColumnsToCaps(columns, caps, exact){
  const out = [];
  out.push(...columns.filter(c => c.category === 'tests')); /* الاختبارات بلا سقف */
  ['performance'].forEach(cat => {
    let cols = columns.filter(c => c.category === cat);
    const cap = Number(caps[cat]);
    const total = cols.reduce((t, c) => t + c.max_score, 0);
    if(!cols.length || (!exact && total <= cap)){ out.push(...cols); return; }
    if(!(cap > 0)) return;
    const n = Math.max(1, Math.min(cols.length, Math.floor(cap / 0.5))); /* لا عمود أقل من 0.5 */
    cols = cols.slice(0, n);
    const sub = cols.reduce((t, c) => t + c.max_score, 0) || n;
    const scaled = cols.map(c => Object.assign({}, c, { max_score: Math.max(0.5, Math.round(c.max_score * cap / sub * 2) / 2) }));
    const last = scaled[scaled.length - 1];
    last.max_score = Math.round((last.max_score + cap - scaled.reduce((t, c) => t + c.max_score, 0)) * 100) / 100;
    if(last.max_score <= 0 || scaled.some(c => c.max_score > GRADE_COLUMN_MAX)){
      /* حالة طرفية (نِسَب حادة): توزيع متساوٍ والباقي على الأخير */
      const each = Math.floor(cap / n * 2) / 2;
      const eq = cols.map(c => Object.assign({}, c, { max_score: each }));
      eq[n - 1].max_score = Math.round((cap - each * (n - 1)) * 100) / 100;
      out.push(...eq);
      return;
    }
    out.push(...scaled);
  });
  return out;
}

/* الكشف "موجود" بأعمدته الأساسية؛ أعمدة الأدوات الخاصة وحدها تُنشأ تلقائيًا عند الرصد ولا تكفي */
function hasBaseGradeColumns(columns){ return (columns || []).some(c => !c.tool_id); }

/* السقف المتبقي لكل فئة بعد أعمدة قائمة (أعمدة أدوات أُنشئت قبل الكشف) */
function capsAfterColumns(columns){
  const used = cat => (columns || []).filter(c => c.category === cat).reduce((t, c) => t + Number(c.max_score), 0);
  return { performance: Math.max(0, gradeCap('performance') - used('performance')), tests: Math.max(0, gradeCap('tests') - used('tests')) };
}

/* نص الهيكل الافتراضي كما سيُنشأ فعلًا بتوزيع المعلم */
function defaultGradeSeedText(){
  return gradeSheetSeed([]).map(c => `${c.name} ${formatScore(c.max_score)}`).join(' · ');
}

function sortGradeColumns(columns){
  const rank = { performance: 0, tests: 1 };
  return (columns || []).slice().sort((a, b) => rank[a.category] - rank[b.category] ||
    (a.position || 0) - (b.position || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/* رسالة مفهومة لأخطاء حماية قاعدة البيانات */
function gradeDbErrorMessage(error){
  const msg = (error && error.message) || '';
  if(msg.indexOf('grade_cap_exceeded') !== -1) return 'يتجاوز سقف الفئة — ربما عُدّل الكشف من جهاز آخر. حدّث الصفحة.';
  if(msg.indexOf('grade_score_above_max') !== -1) return 'درجة أكبر من الدرجة القصوى للعمود — ربما عُدّل العمود من جهاز آخر.';
  if(msg.indexOf('grade_max_below_scores') !== -1) return 'توجد درجات مرصودة أعلى من الدرجة القصوى الجديدة.';
  return msg;
}

/* أي تعديل على الدرجات يغيّر بطاقات الانتباه (القاعدتان 8 و9) */
function afterCrmGradesChanged(){
  if(typeof invalidateAttention === 'function'){ invalidateAttention(); refreshAttention(); }
}

/* ============ الحالة والتحميل ============ */
let crmGradesToken = 0;
let crmGrades = null;      /* { sectionId, year, semester, columns, scores } */
let crmGradeEntry = null;  /* { columnId, saving } */
let crmGradeColumnDraft = null; /* { id?, category, saving } */
let crmGradeBusy = false;
let crmGradesDetail = false; /* الكشف التفصيلي (كل الأعمدة للتعديل اليدوي) بدل المبسّط */

function crmGradesSectionId(){
  const sorted = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  let saved = null;
  try{ saved = localStorage.getItem('crm_grades_section'); } catch(e){}
  if(saved && crmSectionById(saved)) return saved;
  return sorted.length ? sorted[0].id : null;
}

async function loadCrmGradeSheet(sectionId){
  const { year, semester } = crmCurrentTerm();
  const uid = currentUser.id;
  const { data: columns, error } = await sb.from('classroom_grade_columns').select('*')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', year).eq('semester', semester);
  if(error) return { error };
  /* عمود الواجبات المحسوب يُحدَّث قبل العرض (واجب انقضى موعده منذ آخر فتح
     يُحسب الآن). فشل المزامنة لا يمنع عرض الكشف بآخر قيم محفوظة. */
  /* أداة مخفية: عمودها لا يُعاد حسابه ولا يُعرض ولا يُحسب — بياناته باقية */
  const visible = (columns || []).filter(gradeColumnVisible);
  const hwCol = visible.find(c => c.kind === 'homework');
  if(hwCol && typeof syncHomeworkColumn === 'function'){
    try{ await syncHomeworkColumn(hwCol, sectionId, await loadSectionHomework(sectionId, { year, semester })); } catch(e){}
  }
  const taskCol = visible.find(c => c.kind === 'task');
  if(taskCol && typeof syncTaskColumn === 'function'){
    try{ await syncTaskColumn(taskCol, sectionId, { year, semester }); } catch(e){}
  }
  /* أعمدة أدوات الحالة/الدرجة الخاصة */
  for(const tc of visible.filter(c => c.tool_id)){
    const tool = typeof customToolById === 'function' ? customToolById(tc.tool_id) : null;
    if(tool && tool.tool_type !== 'counter'){
      try{ await syncToolColumn(tc, tool, sectionId, { year, semester }); } catch(e){}
    }
  }
  let scores = [];
  if((columns || []).length){
    const { data, error: sErr } = await sb.from('classroom_grade_scores').select('id, column_id, student_id, score')
      .eq('teacher_id', uid).in('column_id', columns.map(c => c.id));
    if(sErr) return { error: sErr };
    scores = data || [];
  }
  return {
    sectionId, year, semester, scores,
    columns: sortGradeColumns(visible),
    allColumns: sortGradeColumns(columns || []), /* لسقف الفئة وفحص التكرار: القاعدة تعدّ المخفي أيضًا */
    hiddenColumns: sortGradeColumns((columns || []).filter(c => !gradeColumnVisible(c)))
  };
}

/* ============ الكشف ============ */
async function renderCrmGrades(){
  const box = document.getElementById('crmGradesBody');
  if(!box) return;
  const token = ++crmGradesToken;
  crmGradeEntry = null;
  crmGradeImport = null;
  if(!crmSections.length){
    box.innerHTML = '<div class="empty-state">أضف شعبك أولًا من تبويب "الطلاب".</div>';
    return;
  }
  const sectionId = crmGradesSectionId();
  const head = crmGradesSectionPickerHtml(sectionId) + crmGradesViewSwitchHtml();
  if(crmGradesView() === 'summary'){ renderCrmSectionSummary(sectionId, head); return; }
  crmSummaryToken++; /* ملخص قيد التحميل لا يكتب فوق الكشف */
  box.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const res = await loadCrmGradeSheet(sectionId);
  if(token !== crmGradesToken) return; /* تغيّرت الشعبة أو الفصل أثناء التحميل */
  if(res.error){
    box.innerHTML = head + `<div class="empty-state">تعذّر تحميل الكشف. <button class="btn btn-outline crm-mini-btn" onclick="renderCrmGrades()">إعادة المحاولة</button></div>`;
    return;
  }
  crmGrades = res;
  box.innerHTML = head + (crmGradesDetail ? crmGradeDetailHtml(res) : crmGradeSimpleHtml(res));
}

function setCrmGradesDetail(on){
  crmGradesDetail = !!on;
  renderCrmGrades();
}

/* لا كشف للشعبة في هذا الفصل بعد */
function crmGradeCreateCardHtml(){
  const term = crmCurrentTerm();
  return `<div class="crm-today-card">
      <div class="crm-today-title">لا كشف درجات لهذه الشعبة في ${escapeHtml(getCrmSemesterLabel())}</div>
      <p style="font-size:12px;color:var(--muted);line-height:1.8;margin:0 0 10px;">يُنشأ الكشف بمكوّنات الأداء: ${escapeHtml(defaultGradeSeedText())}${appToolOn('tests') ? '، والاختبارات تضيفها متى شئت بأي عدد' : ''}.</p>
      <button class="btn btn-primary" id="crmGradesCreateBtn" onclick="createCrmGradeSheet()" data-year="${escapeHtml(term.year)}">إنشاء الكشف</button>
    </div>`;
}

/* ============ الكشف المبسّط: سطر لكل طالب ============ */
function crmGradeSimpleHtml(g){
  if(!hasBaseGradeColumns(g.allColumns || g.columns)) return crmGradeCreateCardHtml();
  const testsOn = appToolOn('tests');
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const students = crmStudentsOfSection(g.sectionId);
  const ids = students.map(s => s.id);
  const perfCols = g.columns.filter(c => c.category === 'performance');
  const testCols = g.columns.filter(c => c.category === 'tests');
  const perfMax = perfCols.reduce((a, c) => a + Number(c.max_score), 0);
  const totalMax = perfMax + (testsOn ? caps.tests : 0);

  let html = `<div class="crm-today-card crm-gs-dist">التوزيع: <b>الأداء ${formatScore(perfMax)}</b>${perfCols.length ? ' = ' + perfCols.map(c => `${escapeHtml(c.name)} ${formatScore(c.max_score)}`).join(' + ') : ''}${testsOn ? ` &nbsp;|&nbsp; <b>الاختبارات ${formatScore(caps.tests)}</b> = محصلة كل الاختبارات` : ''}
    <div style="margin-top:4px;"><a href="#" onclick="event.preventDefault();openCrmWeightsEditor()">تعديل توزيع الأداء${typeof crmCustomTools !== 'undefined' && crmCustomTools.some(t => t.category === 'performance' && !t.hidden && !(g.allColumns || g.columns).some(c => c.tool_id === t.id)) ? ' (وإدخال أدواتك الخاصة)' : ''}</a></div></div>`;
  html += hiddenGradeColumnsLineHtml(g.hiddenColumns);
  if(!g.columns.length && !testsOn) return html + '<div class="empty-state">كل أعمدة هذا الكشف لأدوات مخفية.</div>';
  if(!students.length) return html + '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>' + crmGradeTestsCardHtml(g, testCols, ids);

  html += `<table class="crm-gs-table"><thead><tr><th class="crm-gs-name">الطالب</th><th>الأداء<small>من ${formatScore(perfMax)}</small></th>${testsOn ? `<th>الاختبارات<small>من ${formatScore(caps.tests)}</small></th>` : ''}<th class="crm-gs-tot">المجموع<small>من ${formatScore(totalMax)}</small></th></tr></thead><tbody>`;
  students.forEach(st => {
    const r = studentGradeResult(g.columns, g.scores, st.id, caps);
    const parts = r.performance.parts.map(x => `${escapeHtml(x.name)} ${x.score === null ? '—' : formatScore(x.score)}`).join(' · ');
    const total = testsOn ? r.total : r.performance.points;
    html += `<tr onclick="openCrmGradeStudentDetail('${st.id}')"><td class="crm-gs-name"><b>${escapeHtml(st.full_name)}</b>${parts ? `<small>${parts}</small>` : ''}</td>
      <td>${r.performance.points === null ? '<span class="crm-grade-empty">—</span>' : formatScore(r.performance.points)}</td>
      ${testsOn ? `<td>${r.tests.points === null ? '<span class="crm-gs-none">لم يُرصد</span>' : formatScore(r.tests.points)}</td>` : ''}
      <td class="crm-gs-tot">${total === null ? '<span class="crm-grade-empty">—</span>' : formatScore(total)}</td></tr>`;
  });
  html += '</tbody></table>';
  html += '<p class="crm-gs-note">اضغط على أي طالب لترى تفاصيل درجاته وكيف حُسبت. "—" = لم يُرصد بعد (لا يُحسب صفرًا).</p>';
  html += crmGradeTestsCardHtml(g, testCols, ids);
  html += `<p class="crm-gs-note" style="text-align:center;margin-top:14px;"><a href="#" onclick="event.preventDefault();setCrmGradesDetail(true)">الكشف التفصيلي (كل الأعمدة، والتعديل اليدوي، والاستيراد من Excel)</a></p>`;
  return html;
}

/* بطاقة الاختبارات: كل اختبار بدرجته الكاملة وعدد من رُصد لهم، و+ اختبار */
function crmGradeTestsCardHtml(g, testCols, ids){
  if(!appToolOn('tests')) return '';
  const rows = testCols.map(c => {
    const st = gradeColumnStats(c.id, g.scores, ids);
    return `<div class="crm-lesson-row" style="cursor:pointer;" onclick="openCrmGradeColumnMenu('${c.id}')">
      <span><b>${escapeHtml(c.name)}</b> · من ${formatScore(c.max_score)}${c.tool_id ? ' 🧩' : ''}</span>
      <span style="font-size:11.5px;color:var(--muted);">رُصد ${ids.length - st.missing} من ${ids.length}${st.avg === null ? '' : ' · المتوسط ' + formatScore(st.avg)}</span></div>`;
  }).join('');
  return `<div class="crm-today-card" style="margin-top:12px;">
    <div class="crm-today-title" style="display:flex;justify-content:space-between;align-items:center;">الاختبارات <button class="btn btn-outline crm-mini-btn" onclick="openCrmGradeColumnEditor('tests', null)">+ اختبار</button></div>
    ${rows || '<div class="crm-today-empty">لا اختبارات بعد — أضف اختبارًا بأي اسم ودرجة كاملة، ويدخل المحصلة تلقائيًا.</div>'}
    ${testCols.length ? '<p class="crm-gs-note" style="margin:6px 0 0;">اضغط على اختبار لرصد درجاته أو تعديله.</p>' : ''}
  </div>`;
}

/* تفاصيل طالب: كل اختبار ودرجته ونسبته، وطريقة الحساب، ومكوّنات الأداء */
function openCrmGradeStudentDetail(studentId){
  const g = crmGrades;
  const st = crmStudents.find(x => x.id === studentId);
  if(!g || !st) return;
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const r = studentGradeResult(g.columns, g.scores, studentId, caps);
  const pct = x => Math.round(100 * x.score / x.max);
  const line = (a, b) => `<div class="crm-gs-line"><span>${a}</span><span>${b}</span></div>`;
  let testsHtml = '';
  if(appToolOn('tests')){
    const rec = r.tests.list.filter(x => x.score !== null);
    testsHtml = `<div class="crm-today-card"><div class="crm-gs-line"><b>الاختبارات</b><span class="crm-gs-big">${r.tests.points === null ? '—' : formatScore(r.tests.points)} <small>من ${formatScore(caps.tests)}</small></span></div>
      ${r.tests.list.length ? r.tests.list.map(x => line(escapeHtml(x.name), x.score === null ? '<span class="crm-gs-none">لم يُرصد</span>' : `${formatScore(x.score)} من ${formatScore(x.max)} · <span class="crm-gs-chip">${pct(x)}%</span>`)).join('') : '<div class="crm-today-empty">لا اختبارات بعد.</div>'}
      ${rec.length ? `<p class="crm-gs-note">المحصلة: ${formatScore(r.tests.earned)} من ${formatScore(r.tests.possible)} = ${r.tests.pct}% × ${formatScore(caps.tests)} = <b>${formatScore(r.tests.points)}</b></p>` : ''}</div>`;
  }
  const perfHtml = `<div class="crm-today-card"><div class="crm-gs-line"><b>الأداء</b><span class="crm-gs-big">${r.performance.points === null ? '—' : formatScore(r.performance.points)} <small>من ${formatScore(r.performance.max)}</small></span></div>
    ${r.performance.parts.map(x => line(escapeHtml(x.name), x.score === null ? '<span class="crm-gs-none">لم يُرصد بعد</span>' : `${formatScore(x.score)} من ${formatScore(x.max)}`)).join('')}
    <p class="crm-gs-note">ما لم يُرصد لا يُحسب على الطالب.</p></div>`;
  showInfoModal(`<div style="text-align:right;">
    <h3 style="margin:0 0 2px;font-size:16px;color:var(--navy);">${escapeHtml(st.full_name)}</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">تفاصيل الدرجات — ${escapeHtml(crmSectionLabel(g.sectionId))}</div>
    ${testsHtml}${perfHtml}
    <button class="btn btn-outline" style="width:100%;justify-content:center;" onclick="closeCrmModal();openCrmStudentProfile('${st.id}', { type: 'tab', tab: 'grades' })">ملف الطالب</button>
  </div>`, '440px');
}

function crmGradesSectionPickerHtml(sectionId){
  const sorted = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  return `<select class="goal-input" id="crmGradesSection" style="margin-bottom:12px;" onchange="onCrmGradesSectionChange(this.value)">
    ${sorted.map(s => `<option value="${s.id}"${s.id === sectionId ? ' selected' : ''}>${escapeHtml(crmSectionOptionLabel(s))}</option>`).join('')}
  </select>`;
}

function onCrmGradesSectionChange(id){
  try{ localStorage.setItem('crm_grades_section', id); } catch(e){}
  renderCrmGrades();
}

/* ============ الكشف التفصيلي: كل الأعمدة (للتعديل اليدوي والاستيراد) ============ */
function crmGradeDetailHtml(g){
  if(!hasBaseGradeColumns(g.allColumns || g.columns)) return crmGradeCreateCardHtml();
  const students = crmStudentsOfSection(g.sectionId);
  const ids = students.map(s => s.id);
  const scoreOf = new Map(g.scores.map(s => [s.column_id + '|' + s.student_id, Number(s.score)]));

  let html = `<p class="crm-gs-note" style="margin:0 0 8px;"><a href="#" onclick="event.preventDefault();setCrmGradesDetail(false)">→ الكشف المبسّط</a></p><div class="crm-grade-caps">`;
  {
    const used = gradeCategoryTotal(g.columns, 'performance');
    const full = gradeCategoryTotal(g.allColumns || g.columns, 'performance') >= gradeCap('performance');
    html += `<div class="crm-grade-cap"><span><b>${GRADE_CATEGORY_LABELS.performance}</b> · موزّع ${formatScore(used)} من ${formatScore(gradeCap('performance'))}</span>
      ${full ? '' : `<button class="crm-skip-btn" onclick="openCrmGradeColumnEditor('performance', null)">+ عمود</button>`}</div>`;
  }
  if(appToolOn('tests')){
    const n = g.columns.filter(c => c.category === 'tests').length;
    html += `<div class="crm-grade-cap"><span><b>${GRADE_CATEGORY_LABELS.tests}</b> · ${n} ${n === 1 ? 'اختبار' : 'اختبارات'} — المحصلة من ${formatScore(gradeCap('tests'))}</span>
      <button class="crm-skip-btn" onclick="openCrmGradeColumnEditor('tests', null)">+ اختبار</button></div>`;
  }
  html += `<label class="crm-skip-btn" style="display:inline-block;margin-bottom:10px;">📥 استيراد من Excel<input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="startCrmGradeImport(event)"></label>`;
  html += '</div>';
  html += hiddenGradeColumnsLineHtml(g.hiddenColumns);
  if(!g.columns.length){
    return html + '<div class="empty-state">كل أعمدة هذا الكشف لأدوات مخفية.</div>';
  }

  if(!students.length){
    return html + '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>';
  }

  html += '<div class="crm-grade-wrap"><table class="crm-grade-table"><thead><tr><th class="crm-grade-name">الطالب</th>';
  g.columns.forEach(c => {
    const st = gradeColumnStats(c.id, g.scores, ids);
    html += `<th class="crm-grade-col cat-${c.category}" onclick="openCrmGradeColumnMenu('${c.id}')" title="${escapeHtml(c.measures || '')}">
      ${escapeHtml(c.name)}${c.tool_id ? ' <span title="أداة خاصة">🧩</span>' : c.kind === 'homework' ? ' <span title="محسوب من الواجبات">⚙</span>' : c.kind === 'task' ? ' <span title="محسوب من المهام">⚙</span>' : c.kind === 'participation' ? ' <span title="+1 من ورقة الحصة">👆</span>' : ''}<span class="crm-grade-max">من ${formatScore(c.max_score)}</span>${st.missing ? `<span class="crm-grade-missing">${st.missing} بلا درجة</span>` : ''}</th>`;
  });
  html += `<th class="crm-grade-total">${GRADE_CATEGORY_SHORT.performance}<span class="crm-grade-max">${formatScore(gradeCategoryTotal(g.columns, 'performance'))}</span></th>
    <th class="crm-grade-total">${GRADE_CATEGORY_SHORT.tests}<span class="crm-grade-max">${formatScore(gradeCap('tests'))}</span></th></tr></thead><tbody>`;
  students.forEach(s => {
    const sum = studentGradeSummary(g.columns, g.scores, s.id);
    const res = studentGradeResult(g.columns, g.scores, s.id);
    html += `<tr><td class="crm-grade-name" onclick="openCrmStudentProfile('${s.id}', { type: 'tab', tab: 'grades' })">${escapeHtml(s.full_name)}</td>`;
    g.columns.forEach(c => {
      const k = c.id + '|' + s.id;
      html += `<td>${scoreOf.has(k) ? formatScore(scoreOf.get(k)) : '<span class="crm-grade-empty">—</span>'}</td>`;
    });
    html += `<td class="crm-grade-total">${sum.performance.count ? formatScore(sum.performance.sum) : ''}</td>
      <td class="crm-grade-total">${res.tests.points === null ? '' : formatScore(res.tests.points)}</td></tr>`;
  });
  html += '</tbody></table></div>';
  html += '<p style="font-size:11px;color:var(--muted);margin:8px 0 0;">اضغط رأس العمود لرصد درجاته أو تعديله. "—" = لم تُرصد (لا تُحسب صفرًا).</p>';
  return html;
}

async function createCrmGradeSheet(){
  if(crmGradeBusy || !crmGrades || hasBaseGradeColumns(crmGrades.allColumns || crmGrades.columns)) return;
  crmGradeBusy = true;
  const btn = document.getElementById('crmGradesCreateBtn');
  if(btn) btn.disabled = true;
  const { sectionId, year, semester } = crmGrades;
  try{
    const prev = previousGradeTerm(year, semester);
    let prevColumns = [];
    if(prev){
      const { data } = await sb.from('classroom_grade_columns').select('category, name, max_score, measures, position, kind, tool_id')
        .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('academic_year', prev.year).eq('semester', prev.semester);
      prevColumns = data || [];
    }
    /* أُنشئ من جهاز آخر أثناء ذلك؟ لا نكرر الأعمدة. أعمدة أدوات قائمة تبقى، والهيكل يُملأ بما تبقّى من السقف */
    const { data: existing } = await sb.from('classroom_grade_columns').select('id, category, max_score, tool_id')
      .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('academic_year', year).eq('semester', semester);
    if(!hasBaseGradeColumns(existing)){
      const have = new Set((existing || []).map(c => c.tool_id));
      const rows = gradeSheetSeed(prevColumns.filter(c => !c.tool_id || !have.has(c.tool_id)), capsAfterColumns(existing))
        .map(c => Object.assign({ teacher_id: currentUser.id, section_id: sectionId, academic_year: year, semester }, c));
      const { error } = await sb.from('classroom_grade_columns').insert(rows);
      if(error){ showToast('تعذّر إنشاء الكشف: ' + gradeDbErrorMessage(error), 'error'); return; }
    }
  } finally {
    crmGradeBusy = false;
    if(btn) btn.disabled = false;
  }
  renderCrmGrades();
}

/* ============ قائمة العمود ============ */
function openCrmGradeColumnMenu(columnId){
  const c = crmGrades && crmGrades.columns.find(x => x.id === columnId);
  if(!c) return;
  const recorded = crmGrades.scores.filter(s => s.column_id === columnId).length;
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${escapeHtml(c.name)} · من ${formatScore(c.max_score)}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">${GRADE_CATEGORY_LABELS[c.category]}${c.measures ? ' · يقيس: ' + escapeHtml(c.measures) : ''} · مرصود ${recorded}</div>
      ${c.tool_id && isComputedGradeColumn(c)
        ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">يُحسب تلقائيًا من رصد الأداة (ورقة الحصة ← "${escapeHtml(c.name)}") — لا يُعدَّل يدويًا. ما لم يُرصد لا يُحسب.</div>`
        : c.kind === 'homework'
        ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">يُحسب تلقائيًا من رصد تسليم الواجبات (ورقة الحصة ← "واجب") — لا يُعدَّل يدويًا.</div>
           <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;" onclick="closeCrmModal();openCrmHomeworkManager()">الواجبات</button>`
        : c.kind === 'task'
        ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">يُحسب تلقائيًا من درجات المهام الأدائية (ورقة الحصة ← "مهمة") — لا يُعدَّل يدويًا. كل طالب يُحسب على المهام المسندة إليه والمقيَّمة فقط.</div>
           <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;" onclick="closeCrmModal();openCrmTaskManager()">المهام</button>`
        : `${c.kind === 'participation' ? '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">يُرصد بنقرة من ورقة الحصة ← "مشاركة"، ويمكن تعديله هنا يدويًا.</div>' : ''}
           <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;" onclick="closeCrmModal();openCrmGradeEntry('${c.id}')">رصد الدرجات</button>`}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="closeCrmModal();openCrmGradeColumnEditor('${c.category}', '${c.id}')">تعديل</button>
        <button class="btn btn-outline" style="flex:1;justify-content:center;color:#8A2C2C;" onclick="closeCrmModal();deleteCrmGradeColumn('${c.id}')">حذف</button>
      </div>
    </div>`, '400px');
}

/* ============ إضافة/تعديل عمود ============ */
function openCrmGradeColumnEditor(category, columnId){
  if(!crmGrades) return;
  const c = columnId ? crmGrades.columns.find(x => x.id === columnId) : null;
  if(columnId && !c) return;
  const allCols = crmGrades.allColumns || crmGrades.columns;
  const isTest = category === 'tests';
  const remaining = gradeCap(category) - gradeCategoryTotal(allCols, category, columnId);
  const hiddenHere = (crmGrades.hiddenColumns || []).filter(x => x.category === category);
  crmGradeColumnDraft = { id: columnId || null, category, saving: false };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${isTest ? (c ? 'تعديل اختبار' : 'اختبار جديد') : `${c ? 'تعديل عمود' : 'عمود جديد'} · ${GRADE_CATEGORY_LABELS[category]}`}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.7;">${isTest
        ? `يدخل محصلة الاختبارات (من ${formatScore(gradeCap('tests'))}) تلقائيًا — بلا حد لعدد الاختبارات.`
        : `المتاح من السقف (${formatScore(gradeCap(category))}): ${formatScore(remaining)}${hiddenHere.length ? ' · يشمل أعمدة مخفية: ' + hiddenHere.map(x => escapeHtml(x.name) + ' (' + formatScore(x.max_score) + ')').join('، ') : ''}`}</div>
      <label class="crm-field-label">${isTest ? 'اسم الاختبار' : 'الاسم'}</label>
      <input class="goal-input" id="crmGradeColName" maxlength="60" value="${c ? escapeHtml(c.name) : ''}" placeholder="${isTest ? 'مثال: الفترة الأولى، اختبار قصير 1' : 'مثال: مشروع'}" style="margin-bottom:8px;">
      <label class="crm-field-label">${isTest ? 'الدرجة الكاملة' : 'الدرجة القصوى'}</label>
      <input class="goal-input" id="crmGradeColMax" inputmode="decimal" value="${c ? formatScore(c.max_score) : isTest ? GRADE_TEST_DEFAULT_MAX : (remaining > 0 ? formatScore(remaining) : '')}" style="margin-bottom:8px;">
      ${category === 'performance' && !(c && c.tool_id) ? `<label class="crm-field-label">النوع</label>
      <select class="goal-input" id="crmGradeColKind" style="margin-bottom:8px;">${Object.keys(GRADE_KIND_LABELS).filter(k => k === 'manual' || (c && c.kind === k) || appToolOn(GRADE_KIND_TOOL[k])).map(k => `<option value="${k}"${(c ? (c.kind || 'manual') : 'manual') === k ? ' selected' : ''}>${GRADE_KIND_LABELS[k]}</option>`).join('')}</select>` : ''}
      <label class="crm-field-label">ماذا يقيس؟ (اختياري)</label>
      <input class="goal-input" id="crmGradeColMeasures" maxlength="120" value="${c && c.measures ? escapeHtml(c.measures) : ''}" placeholder="مثال: زمن الماضي البسيط" style="margin-bottom:10px;">
      <div id="crmGradeColError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:8px;line-height:1.7;"></div>
      <button class="btn btn-primary" id="crmGradeColSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmGradeColumn()">حفظ</button>
    </div>`, '420px');
}

async function saveCrmGradeColumn(){
  const d = crmGradeColumnDraft;
  if(!d || d.saving || !crmGrades) return;
  const toLatin = v => String(v || '').trim().replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.');
  const draft = {
    id: d.id, category: d.category,
    name: document.getElementById('crmGradeColName').value.trim(),
    max_score: toLatin(document.getElementById('crmGradeColMax').value),
    measures: document.getElementById('crmGradeColMeasures').value.trim().slice(0, 120) || null
  };
  const kindEl = document.getElementById('crmGradeColKind');
  const kind = kindEl ? kindEl.value : 'manual';
  const errBox = document.getElementById('crmGradeColError');
  const allCols = crmGrades.allColumns || crmGrades.columns;
  const dup = kind !== 'manual' && allCols.find(c => c.kind === kind && c.id !== d.id);
  if(dup){ errBox.textContent = `يوجد عمود من هذا النوع أصلًا ("${dup.name}") — عمود واحد لكل نوع.`; errBox.style.display = 'block'; return; }
  const before = d.id ? crmGrades.columns.find(c => c.id === d.id) : null;
  /* المحسوب يُعاد حسابه بعد الحفظ، فدرجاته القديمة لا تمنع خفض الحد */
  const computed = isComputedGradeKind(kind) || isComputedGradeColumn(before);
  const err = validateGradeColumn(allCols, draft, computed ? [] : crmGrades.scores);
  if(err){ errBox.textContent = err; errBox.style.display = 'block'; return; }
  d.saving = true;
  const btn = document.getElementById('crmGradeColSaveBtn');
  if(btn) btn.disabled = true;
  const g = crmGrades;
  const payload = { name: draft.name, max_score: Number(draft.max_score), measures: draft.measures, kind };
  if(d.id && computed && before && (before.kind !== kind || Number(before.max_score) !== payload.max_score)){
    /* تُحذف الدرجات المحسوبة ثم تُعاد بعد الحفظ بالحد الجديد (وإلا منعت القاعدة خفض الحد) */
    const { error: dErr } = await sb.from('classroom_grade_scores').delete().eq('teacher_id', currentUser.id).eq('column_id', d.id);
    if(dErr){ errBox.textContent = 'تعذّر الحفظ: ' + dErr.message; errBox.style.display = 'block'; d.saving = false; if(btn) btn.disabled = false; return; }
  }
  const { error } = d.id
    ? await sb.from('classroom_grade_columns').update(payload).eq('teacher_id', currentUser.id).eq('id', d.id)
    : await sb.from('classroom_grade_columns').insert(Object.assign({
        teacher_id: currentUser.id, section_id: g.sectionId, academic_year: g.year, semester: g.semester,
        category: d.category, position: g.columns.filter(c => c.category === d.category).length
      }, payload));
  if(error){
    errBox.textContent = 'تعذّر الحفظ: ' + gradeDbErrorMessage(error);
    errBox.style.display = 'block';
    d.saving = false;
    if(btn) btn.disabled = false;
    return;
  }
  closeCrmModal();
  crmGradeColumnDraft = null;
  afterCrmGradesChanged();
  renderCrmGrades();
}

async function deleteCrmGradeColumn(columnId){
  if(crmGradeBusy || !crmGrades) return;
  const c = crmGrades.columns.find(x => x.id === columnId);
  if(!c) return;
  const recorded = crmGrades.scores.filter(s => s.column_id === columnId).length;
  const ok = await showConfirm(`حذف عمود "${c.name}"؟` + (recorded ? ` ستُحذف معه ${recorded} درجة مرصودة نهائيًا.` : ''));
  if(!ok) return;
  crmGradeBusy = true;
  const { error } = await sb.from('classroom_grade_columns').delete().eq('teacher_id', currentUser.id).eq('id', columnId);
  crmGradeBusy = false;
  if(error){ showToast('تعذّر الحذف: ' + gradeDbErrorMessage(error), 'error'); return; }
  showToast('حُذف العمود', 'ok');
  afterCrmGradesChanged();
  renderCrmGrades();
}

/* ============ رصد عمود ============ */
function openCrmGradeEntry(columnId){
  const box = document.getElementById('crmGradesBody');
  const c = crmGrades && crmGrades.columns.find(x => x.id === columnId);
  if(!box || !c) return;
  if(c.kind === 'homework'){ showToast('عمود الواجبات يُحسب تلقائيًا — ارصد التسليم من ورقة الحصة', 'error'); return; }
  if(c.kind === 'task'){ showToast('عمود المهام يُحسب تلقائيًا — ارصد درجات المهام من ورقة الحصة', 'error'); return; }
  if(c.tool_id && isComputedGradeColumn(c)){ showToast(`عمود "${c.name}" يُحسب تلقائيًا — ارصده من ورقة الحصة`, 'error'); return; }
  crmGradeEntry = { columnId, saving: false };
  const students = crmStudentsOfSection(crmGrades.sectionId);
  const scoreOf = new Map(crmGrades.scores.filter(s => s.column_id === columnId).map(s => [s.student_id, Number(s.score)]));
  box.innerHTML = `
    <div class="crm-sheet-head">رصد: ${escapeHtml(c.name)} <span style="font-size:12px;color:var(--muted);font-weight:400;">من ${formatScore(c.max_score)}</span></div>
    <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">${escapeHtml(crmSectionLabel(crmGrades.sectionId))}${c.measures ? ' · يقيس: ' + escapeHtml(c.measures) : ''} · اتركها فارغة لمن لم يُرصد</div>
    <div class="crm-grade-entry">
      ${students.map((s, i) => `<label class="crm-grade-entry-row">
        <span>${escapeHtml(s.full_name)}</span>
        <input class="goal-input crm-grade-input" inputmode="decimal" autocomplete="off" data-student="${s.id}" data-index="${i}"
          value="${scoreOf.has(s.id) ? formatScore(scoreOf.get(s.id)) : ''}" onkeydown="onCrmGradeInputKey(event, ${i})" oninput="this.classList.remove('is-invalid')">
      </label>`).join('')}
    </div>
    <div class="crm-grade-entry-bar">
      <button class="btn btn-outline" onclick="renderCrmGrades()">رجوع</button>
      <button class="btn btn-primary" id="crmGradeEntrySaveBtn" onclick="saveCrmGradeEntry()">حفظ الدرجات</button>
    </div>`;
  const first = box.querySelector('.crm-grade-input');
  if(first) first.focus();
}

function onCrmGradeInputKey(e, index){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  const next = document.querySelector(`.crm-grade-input[data-index="${index + 1}"]`);
  if(next){ next.focus(); next.select && next.select(); }
  else { const btn = document.getElementById('crmGradeEntrySaveBtn'); if(btn) btn.focus(); }
}

/* دالة صرفة: ما يُحفظ وما يُحذف مقارنةً بالمحفوظ سابقًا */
function planGradeEntryChanges(entries, previous){
  const upserts = [], clears = [], invalid = [];
  entries.forEach(e => {
    if(!e.parsed.ok){ invalid.push(e.studentId); return; }
    const had = previous.has(e.studentId);
    if(e.parsed.value === null){ if(had) clears.push(e.studentId); return; }
    if(!had || previous.get(e.studentId) !== e.parsed.value) upserts.push({ student_id: e.studentId, score: e.parsed.value });
  });
  return { upserts, clears, invalid };
}

async function saveCrmGradeEntry(){
  const entry = crmGradeEntry;
  if(!entry || entry.saving || !crmGrades) return;
  const c = crmGrades.columns.find(x => x.id === entry.columnId);
  if(!c) return;
  const inputs = [...document.querySelectorAll('.crm-grade-input')];
  const entries = inputs.map(inp => ({ studentId: inp.dataset.student, input: inp, parsed: parseScoreInput(inp.value, c.max_score) }));
  const previous = new Map(crmGrades.scores.filter(s => s.column_id === c.id).map(s => [s.student_id, Number(s.score)]));
  const plan = planGradeEntryChanges(entries, previous);
  if(plan.invalid.length){
    entries.forEach(e => { if(!e.parsed.ok) e.input.classList.add('is-invalid'); });
    showToast(`${plan.invalid.length === 1 ? 'درجة غير صالحة' : plan.invalid.length + ' درجات غير صالحة'} (الحد ${formatScore(c.max_score)}) — صحّحها أولًا`, 'error');
    return;
  }
  if(!plan.upserts.length && !plan.clears.length){ renderCrmGrades(); return; }
  entry.saving = true;
  const btn = document.getElementById('crmGradeEntrySaveBtn');
  if(btn) btn.disabled = true;
  let error = null;
  if(plan.upserts.length){
    ({ error } = await sb.from('classroom_grade_scores').upsert(
      plan.upserts.map(u => ({ teacher_id: currentUser.id, column_id: c.id, student_id: u.student_id, score: u.score })),
      { onConflict: 'column_id,student_id' }
    ));
  }
  if(!error && plan.clears.length){
    ({ error } = await sb.from('classroom_grade_scores').delete()
      .eq('teacher_id', currentUser.id).eq('column_id', c.id).in('student_id', plan.clears));
  }
  if(error){
    /* الإدخالات تبقى في الشاشة — لا يضيع ما كُتب */
    showToast('تعذّر الحفظ: ' + gradeDbErrorMessage(error), 'error');
    entry.saving = false;
    if(btn) btn.disabled = false;
    return;
  }
  showToast('حُفظت درجات ' + c.name, 'ok');
  afterCrmGradesChanged();
  if(crmGradeEntry === entry) renderCrmGrades(); /* لم ينتقل لشاشة أخرى أثناء الحفظ */
}

/* ============================================================
   نقل درجات الطالب مع نقله لشعبة أخرى
   ------------------------------------------------------------
   الدرجات تراكمية للفصل (بخلاف الغياب والمخالفات التي تبقى حيث وقعت)،
   فتنتقل كل درجة لعمود الاسم والفئة والفصل نفسه في الشعبة الجديدة. ما لا
   يطابق يبقى في القديمة (لا يُحذف) ويُبلَّغ المعلم بسببه. فصل بلا كشف في
   الجديدة يُنشأ بهيكل القديمة. العملية قابلة للإعادة: ما نُقل لا يُنقل مرتين.
   ============================================================ */
function normalizeGradeColumnName(name){
  return String(name || '').replace(/ـ/g, '').replace(/\s+/g, ' ').trim();
}

function planGradeTransfer(studentScores, allColumns, targetSectionId, targetColumns){
  const colById = new Map((allColumns || []).map(c => [c.id, c]));
  const termKey = c => c.academic_year + '|' + c.semester;
  const targetTerms = new Set();
  const targetByKey = new Map();
  (targetColumns || []).forEach(c => {
    targetTerms.add(termKey(c));
    targetByKey.set(termKey(c) + '|' + c.category + '|' + normalizeGradeColumnName(c.name), c);
  });
  const taken = new Set((studentScores || []).filter(s => {
    const c = colById.get(s.column_id);
    return c && c.section_id === targetSectionId;
  }).map(s => s.column_id));
  const moves = [], stay = [], missing = new Map();
  let pendingCount = 0;
  (studentScores || []).forEach(s => {
    const c = colById.get(s.column_id);
    if(!c || c.section_id === targetSectionId) return;
    const tk = termKey(c);
    if(!targetTerms.has(tk)){
      if(!missing.has(tk)) missing.set(tk, { year: c.academic_year, semester: c.semester, sourceSectionId: c.section_id });
      pendingCount++;
      return;
    }
    const t = targetByKey.get(tk + '|' + c.category + '|' + normalizeGradeColumnName(c.name));
    if(!t){ stay.push({ scoreId: s.id, name: c.name, reason: 'لا عمود بنفس الاسم في الشعبة الجديدة' }); return; }
    if(taken.has(t.id)){ stay.push({ scoreId: s.id, name: c.name, reason: 'له درجة في هذا العمود بالشعبة الجديدة' }); return; }
    if(Number(s.score) > Number(t.max_score)){
      stay.push({ scoreId: s.id, name: c.name, reason: `درجته ${formatScore(s.score)} أعلى من حد العمود في الشعبة الجديدة (${formatScore(t.max_score)})` });
      return;
    }
    taken.add(t.id);
    moves.push({ scoreId: s.id, toColumnId: t.id });
  });
  return { moves, stay, missingTerms: [...missing.values()], pendingCount };
}

async function loadGradeTransferData(studentId, targetSectionId){
  const uid = currentUser.id;
  const [{ data: scores, error: e1 }, { data: target, error: e2 }] = await Promise.all([
    sb.from('classroom_grade_scores').select('id, column_id, score').eq('teacher_id', uid).eq('student_id', studentId),
    sb.from('classroom_grade_columns').select('id, section_id, academic_year, semester, category, name, max_score').eq('teacher_id', uid).eq('section_id', targetSectionId)
  ]);
  if(e1 || e2) throw (e1 || e2);
  let columns = [];
  const ids = [...new Set((scores || []).map(s => s.column_id))];
  if(ids.length){
    const { data, error } = await sb.from('classroom_grade_columns').select('id, section_id, academic_year, semester, category, name, max_score')
      .eq('teacher_id', uid).in('id', ids);
    if(error) throw error;
    columns = data || [];
  }
  return { scores: scores || [], allColumns: columns.concat(target || []), targetColumns: target || [] };
}

/* يرمي خطأ عند الفشل — المستدعي لا يكمل نقل الطالب، وإعادة المحاولة آمنة */
async function moveStudentGrades(studentId, targetSectionId){
  const uid = currentUser.id;
  let d = await loadGradeTransferData(studentId, targetSectionId);
  let plan = planGradeTransfer(d.scores, d.allColumns, targetSectionId, d.targetColumns);
  if(plan.missingTerms.length){
    for(const m of plan.missingTerms){
      const { data: exists } = await sb.from('classroom_grade_columns').select('id')
        .eq('teacher_id', uid).eq('section_id', targetSectionId).eq('academic_year', m.year).eq('semester', m.semester).limit(1);
      if((exists || []).length) continue; /* أُنشئ من جهاز آخر للتو */
      const { data: src, error: sErr } = await sb.from('classroom_grade_columns').select('category, name, max_score, measures, position, kind, tool_id')
        .eq('teacher_id', uid).eq('section_id', m.sourceSectionId).eq('academic_year', m.year).eq('semester', m.semester);
      if(sErr) throw sErr;
      const rows = gradeSheetSeed(src || []).map(c => Object.assign({ teacher_id: uid, section_id: targetSectionId, academic_year: m.year, semester: m.semester }, c));
      const { error } = await sb.from('classroom_grade_columns').insert(rows);
      if(error) throw error;
    }
    d = await loadGradeTransferData(studentId, targetSectionId);
    plan = planGradeTransfer(d.scores, d.allColumns, targetSectionId, d.targetColumns);
  }
  for(const mv of plan.moves){
    const { error } = await sb.from('classroom_grade_scores').update({ column_id: mv.toColumnId })
      .eq('teacher_id', uid).eq('id', mv.scoreId);
    if(error) throw error;
  }
  return { moved: plan.moves.length, stay: plan.stay };
}

/* ============================================================
   استيراد الدرجات من Excel
   ------------------------------------------------------------
   - المطابقة بالاسم داخل الشعبة: تام بعد التوحيد، أو الأول والأخير إذا
     كانا فريدين. الغامض وغير الموجود يُعرض على المعلم ليختار — لا يُنشأ
     طالب تلقائيًا.
   - أعمدة الملف تُربط بأعمدة الكشف بالاسم، والمجهول "تجاهل" — لا يُنشأ عمود.
   - الخانة الفارغة لا تمسح درجة موجودة؛ غير الصالح (نص، أكبر من الحد)
     يُعرض ويُتجاهل؛ المعلم يرى قبل التأكيد كم درجة ستُستبدل.
   ============================================================ */
function normalizeGradeHeader(h){
  return normalizeStudentName(normalizeGradeColumnName(h)).split(' ')
    .map(w => (w.length > 3 && w.startsWith('ال')) ? w.slice(2) : w).join(' ');
}

function matchImportStudent(name, students){
  const k = normalizeStudentName(name);
  if(!k) return null;
  const exact = (students || []).filter(s => normalizeStudentName(s.full_name) === k);
  if(exact.length === 1) return { id: exact[0].id, how: 'exact' };
  if(exact.length > 1) return null;
  const t = k.split(' ');
  if(t.length < 2) return null;
  const cands = (students || []).filter(s => {
    const st = normalizeStudentName(s.full_name).split(' ');
    return st.length >= 2 && st[0] === t[0] && st[st.length - 1] === t[t.length - 1];
  });
  return cands.length === 1 ? { id: cands[0].id, how: 'partial' } : null;
}

function autoMapGradeHeaders(headers, columns, nameKey){
  const map = {};
  const used = new Set();
  (headers || []).forEach(h => {
    if(h === nameKey) return;
    const k = normalizeGradeHeader(h);
    const c = (columns || []).find(col => !isComputedGradeColumn(col) && !used.has(col.id) && normalizeGradeHeader(col.name) === k);
    map[h] = c ? c.id : '';
    if(c) used.add(c.id);
  });
  return map;
}

/* manual: { rowIndex: studentId | '' } — اختيار المعلم لصف (فارغ = تجاهل) */
function planGradeImport(rows, nameKey, mapping, students, columns, existing, manual){
  const colById = new Map((columns || []).map(c => [c.id, c]));
  const had = new Map((existing || []).map(e => [e.column_id + '|' + e.student_id, Number(e.score)]));
  const upserts = [], invalid = [], unmatched = [], duplicates = [], partial = [];
  const seen = new Set();
  let unchanged = 0, overwrite = 0;
  (rows || []).forEach((r, i) => {
    const name = String(r[nameKey] == null ? '' : r[nameKey]).replace(/\s+/g, ' ').trim();
    if(!name) return;
    let sid;
    if(manual && Object.prototype.hasOwnProperty.call(manual, i)){
      sid = manual[i];
      if(!sid) return;
    } else {
      const m = matchImportStudent(name, students);
      if(!m){ unmatched.push({ row: i, name }); return; }
      if(m.how === 'partial') partial.push({ row: i, name, studentId: m.id });
      sid = m.id;
    }
    if(seen.has(sid)){ duplicates.push({ row: i, name }); return; }
    seen.add(sid);
    Object.keys(mapping || {}).forEach(h => {
      const c = colById.get(mapping[h]);
      if(!c) return;
      const raw = r[h];
      const parsed = parseScoreInput(raw == null ? '' : String(raw), c.max_score);
      if(!parsed.ok){ invalid.push({ row: i, name, header: h, text: String(raw), reason: parsed.error }); return; }
      if(parsed.value === null) return;
      const k = c.id + '|' + sid;
      if(had.has(k)){
        if(had.get(k) === parsed.value){ unchanged++; return; }
        overwrite++;
      }
      upserts.push({ student_id: sid, column_id: c.id, score: parsed.value });
    });
  });
  return { upserts, invalid, unmatched, duplicates, partial, unchanged, overwrite };
}

/* ============ شاشة الاستيراد ============ */
let crmGradeImport = null; /* { sectionId, fileName, headers, rows, nameKey, mapping, manual, saving } */
let crmGradeImportReading = false;

async function startCrmGradeImport(event){
  const input = event.target;
  const file = input.files && input.files[0];
  input.value = '';
  if(!file || crmGradeImportReading || !crmGrades || !crmGrades.columns.length) return;
  crmGradeImportReading = true;
  const g = crmGrades;
  try{
    showToast('جارٍ قراءة الملف...', 'ok');
    await ensureXlsxLib();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })[0] || []).map(h => String(h).trim()).filter(Boolean);
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if(crmGrades !== g) return; /* انتقل لشعبة أخرى أثناء القراءة */
    if(!rows.length || !headerRow.length){ showToast('الملف فارغ', 'error'); return; }
    const nameKey = headerRow.find(h => /اسم|name/i.test(h)) || headerRow[0];
    crmGradeImport = {
      sectionId: g.sectionId, fileName: file.name, headers: headerRow, rows, nameKey,
      mapping: autoMapGradeHeaders(headerRow, g.columns, nameKey), manual: {}, saving: false
    };
    renderCrmGradeImport();
  } catch(e){
    showToast('تعذّر قراءة الملف: ' + (e.message || ''), 'error');
  } finally {
    crmGradeImportReading = false;
  }
}

function crmGradeImportPlan(){
  const im = crmGradeImport;
  const mapping = {};
  Object.keys(im.mapping).forEach(h => { if(h !== im.nameKey && im.mapping[h]) mapping[h] = im.mapping[h]; });
  return planGradeImport(im.rows, im.nameKey, mapping, crmStudentsOfSection(im.sectionId), crmGrades.columns, crmGrades.scores, im.manual);
}

function renderCrmGradeImport(){
  const im = crmGradeImport;
  const box = document.getElementById('crmGradesBody');
  if(!im || !box || !crmGrades || crmGrades.sectionId !== im.sectionId) return;
  const plan = crmGradeImportPlan();
  const students = crmStudentsOfSection(im.sectionId);
  const colOpts = sel => '<option value="">تجاهل</option>' + crmGrades.columns.filter(c => !isComputedGradeColumn(c)).map(c =>
    `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${escapeHtml(c.name)} (من ${formatScore(c.max_score)})</option>`).join('');
  const stuOpts = sel => '<option value="">تجاهل هذا الصف</option>' + students.map(s =>
    `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${escapeHtml(s.full_name)}</option>`).join('');
  let html = `<div class="crm-sheet-head">استيراد درجات</div>
    <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">${escapeHtml(im.fileName)} · ${escapeHtml(crmSectionLabel(im.sectionId))} · ${im.rows.length} صفًا</div>
    <div class="crm-today-card">
      <div class="crm-today-title">ربط أعمدة الملف</div>
      <label class="crm-field-label">عمود أسماء الطلاب</label>
      <select class="goal-input" style="margin-bottom:10px;" onchange="onCrmImportNameKey(this.value)">
        ${im.headers.map((h, i) => `<option value="${i}"${h === im.nameKey ? ' selected' : ''}>${escapeHtml(h)}</option>`).join('')}
      </select>
      ${im.headers.map((h, i) => h === im.nameKey ? '' : `<div class="crm-import-map-row"><span>${escapeHtml(h)}</span>
        <select class="goal-input" onchange="onCrmImportMap(${i}, this.value)">${colOpts(im.mapping[h])}</select></div>`).join('')}
    </div>`;

  html += `<div class="crm-today-card"><div class="crm-today-title">قبل الاستيراد</div>
    <div class="crm-import-sum"><b>سيُرصد ${plan.upserts.length} ${plan.upserts.length === 1 ? 'درجة' : 'درجات'}</b>
      ${plan.overwrite ? `<div style="color:#8A6D1F;">منها ${plan.overwrite} تستبدل درجات مرصودة سابقًا بقيمة مختلفة</div>` : ''}
      ${plan.unchanged ? `<div style="color:var(--muted);">${plan.unchanged} مطابقة لما هو مرصود (لا تتغير)</div>` : ''}
      <div style="color:var(--muted);">الخانات الفارغة في الملف لا تمسح أي درجة موجودة.</div>
    </div>`;
  if(plan.unmatched.length){
    html += `<div class="crm-field-label" style="margin-top:10px;">أسماء لم تُطابَق (${plan.unmatched.length}) — اختر الطالب أو تجاهل:</div>` +
      plan.unmatched.map(u => `<div class="crm-import-map-row"><span>${escapeHtml(u.name)}</span>
        <select class="goal-input" onchange="onCrmImportManual(${u.row}, this.value)">${stuOpts('')}</select></div>`).join('');
  }
  if(plan.partial.length){
    html += `<div class="crm-field-label" style="margin-top:10px;">مطابقة تقريبية (${plan.partial.length}) — تحقق منها:</div>` +
      plan.partial.map(p => `<div class="crm-import-map-row"><span>${escapeHtml(p.name)}</span>
        <select class="goal-input" onchange="onCrmImportManual(${p.row}, this.value)">${stuOpts(p.studentId)}</select></div>`).join('');
  }
  if(plan.invalid.length){
    html += `<div class="crm-field-label" style="margin-top:10px;color:#8A2C2C;">خانات غير صالحة تُتجاهل (${plan.invalid.length}):</div>
      <div style="font-size:11.5px;color:#8A2C2C;line-height:1.8;">${plan.invalid.slice(0, 15).map(x => `${escapeHtml(x.name)} · ${escapeHtml(x.header)}: "${escapeHtml(x.text)}" — ${escapeHtml(x.reason)}`).join('<br>')}${plan.invalid.length > 15 ? '<br>…' : ''}</div>`;
  }
  if(plan.duplicates.length){
    html += `<div style="font-size:11.5px;color:#8A6D1F;margin-top:8px;">صفوف مكررة لنفس الطالب تُتجاهل (يُعتمد أول صف): ${plan.duplicates.map(d => escapeHtml(d.name)).join('، ')}</div>`;
  }
  html += `</div>
    <div class="crm-grade-entry-bar">
      <button class="btn btn-outline" onclick="crmGradeImport = null; renderCrmGrades()">إلغاء</button>
      <button class="btn btn-primary" id="crmGradeImportBtn" onclick="saveCrmGradeImport()"${plan.upserts.length ? '' : ' disabled'}>استيراد ${plan.upserts.length} ${plan.upserts.length === 1 ? 'درجة' : 'درجات'}</button>
    </div>`;
  box.innerHTML = html;
}

function onCrmImportNameKey(index){
  const im = crmGradeImport;
  if(!im) return;
  im.nameKey = im.headers[Number(index)];
  im.manual = {};
  im.mapping = autoMapGradeHeaders(im.headers, crmGrades.columns, im.nameKey);
  renderCrmGradeImport();
}

function onCrmImportMap(index, columnId){
  const im = crmGradeImport;
  if(!im) return;
  const h = im.headers[Number(index)];
  /* عمود الكشف الواحد لا يُربط بعمودين من الملف */
  Object.keys(im.mapping).forEach(k => { if(columnId && k !== h && im.mapping[k] === columnId) im.mapping[k] = ''; });
  im.mapping[h] = columnId;
  renderCrmGradeImport();
}

function onCrmImportManual(row, studentId){
  const im = crmGradeImport;
  if(!im) return;
  im.manual[row] = studentId;
  renderCrmGradeImport();
}

async function saveCrmGradeImport(){
  const im = crmGradeImport;
  if(!im || im.saving || !crmGrades || crmGrades.sectionId !== im.sectionId) return;
  const plan = crmGradeImportPlan();
  if(!plan.upserts.length) return;
  im.saving = true;
  const btn = document.getElementById('crmGradeImportBtn');
  if(btn) btn.disabled = true;
  for(const part of chunkArray(plan.upserts, 500)){
    const { error } = await sb.from('classroom_grade_scores').upsert(
      part.map(u => ({ teacher_id: currentUser.id, column_id: u.column_id, student_id: u.student_id, score: u.score })),
      { onConflict: 'column_id,student_id' });
    if(error){
      /* ما حُفظ قبل الخطأ يبقى؛ إعادة الاستيراد آمنة (المطابق للموجود لا يُعاد) */
      showToast('تعذّر إكمال الاستيراد: ' + gradeDbErrorMessage(error), 'error');
      im.saving = false;
      if(btn) btn.disabled = false;
      afterCrmGradesChanged();
      return;
    }
  }
  showToast(`استُوردت ${plan.upserts.length} ${plan.upserts.length === 1 ? 'درجة' : 'درجات'}`, 'ok');
  afterCrmGradesChanged();
  if(crmGradeImport === im){ crmGradeImport = null; renderCrmGrades(); }
}
