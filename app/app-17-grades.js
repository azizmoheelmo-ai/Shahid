/* ============================================================
   كشف الدرجات (الإصدار الثاني — الدفعة 1)
   ------------------------------------------------------------
   - لكل شعبة ولكل فصل دراسي: فئتان بسقف ثابت — أعمال أدائية 40، واختبارات
     وتقييمات 20 (والاختبار النهائي 40 لا يُرصد هنا). المعلم يضيف أعمدته
     ويعدّلها؛ أقل من السقف مسموح ("موزّع X من 40")، وتجاوزه ممنوع.
   - الخانة الفارغة "لم تُرصد" لا صفر: النسبة من الأعمدة المرصودة فقط.
   - الإدخال بالعمود: افتح عمودًا، ارصد درجات الشعبة كلها، Enter ينقل للتالي.
   - الحماية مكررة في قاعدة البيانات (trigger): السقف، والدرجة لا تتجاوز
     القصوى، ولا تُخفض القصوى تحت درجة مرصودة — لا يكسرها جهاز ثانٍ.
   ============================================================ */

const GRADE_CAPS = { performance: 40, tests: 20 };
const GRADE_CATEGORY_LABELS = { performance: 'الأعمال الأدائية', tests: 'الاختبارات والتقييمات' };
const GRADE_CATEGORY_SHORT = { performance: 'أدائي', tests: 'اختبارات' };
const DEFAULT_GRADE_COLUMNS = [
  { category: 'performance', name: 'مشاركة', max_score: 10 },
  { category: 'performance', name: 'واجبات', max_score: 10 },
  { category: 'performance', name: 'مهام أدائية', max_score: 20 },
  { category: 'tests', name: 'الفترة الأولى', max_score: 10 },
  { category: 'tests', name: 'الفترة الثانية', max_score: 10 }
];

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
  const cap = GRADE_CAPS[draft.category];
  const others = gradeCategoryTotal(columns, draft.category, draft.id);
  if(others + max > cap){
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
function gradeSheetSeed(prevColumns){
  if(prevColumns && prevColumns.length){
    return prevColumns.map(c => ({ category: c.category, name: c.name, max_score: Number(c.max_score), measures: c.measures || null, position: c.position || 0 }));
  }
  return DEFAULT_GRADE_COLUMNS.map((c, i) => ({ category: c.category, name: c.name, max_score: c.max_score, measures: null, position: i }));
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

/* ============ الحالة والتحميل ============ */
let crmGradesToken = 0;
let crmGrades = null;      /* { sectionId, year, semester, columns, scores } */
let crmGradeEntry = null;  /* { columnId, saving } */
let crmGradeColumnDraft = null; /* { id?, category, saving } */
let crmGradeBusy = false;

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
  let scores = [];
  if((columns || []).length){
    const { data, error: sErr } = await sb.from('classroom_grade_scores').select('id, column_id, student_id, score')
      .eq('teacher_id', uid).in('column_id', columns.map(c => c.id));
    if(sErr) return { error: sErr };
    scores = data || [];
  }
  return { sectionId, year, semester, columns: sortGradeColumns(columns || []), scores };
}

/* ============ الكشف ============ */
async function renderCrmGrades(){
  const box = document.getElementById('crmGradesBody');
  if(!box) return;
  const token = ++crmGradesToken;
  crmGradeEntry = null;
  if(!crmSections.length){
    box.innerHTML = '<div class="empty-state">أضف شعبك أولًا من تبويب "الطلاب".</div>';
    return;
  }
  const sectionId = crmGradesSectionId();
  box.innerHTML = crmGradesSectionPickerHtml(sectionId) + '<div class="loading-state">جارٍ التحميل...</div>';
  const res = await loadCrmGradeSheet(sectionId);
  if(token !== crmGradesToken) return; /* تغيّرت الشعبة أو الفصل أثناء التحميل */
  if(res.error){
    box.innerHTML = crmGradesSectionPickerHtml(sectionId) + `<div class="empty-state">تعذّر تحميل الكشف. <button class="btn btn-outline crm-mini-btn" onclick="renderCrmGrades()">إعادة المحاولة</button></div>`;
    return;
  }
  crmGrades = res;
  box.innerHTML = crmGradesSectionPickerHtml(sectionId) + crmGradeSheetHtml(res);
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

function crmGradeSheetHtml(g){
  if(!g.columns.length){
    const term = crmCurrentTerm();
    return `<div class="crm-today-card">
      <div class="crm-today-title">لا كشف درجات لهذه الشعبة في ${escapeHtml(getCrmSemesterLabel())}</div>
      <p style="font-size:12px;color:var(--muted);line-height:1.8;margin:0 0 10px;">يُنشأ الكشف بهيكل فصلك السابق لهذه الشعبة إن وُجد، وإلا بالهيكل الافتراضي: مشاركة 10 · واجبات 10 · مهام أدائية 20 · الفترة الأولى 10 · الفترة الثانية 10. تعدّل الأعمدة متى شئت.</p>
      <button class="btn btn-primary" id="crmGradesCreateBtn" onclick="createCrmGradeSheet()" data-year="${escapeHtml(term.year)}">إنشاء الكشف</button>
    </div>`;
  }
  const students = crmStudentsOfSection(g.sectionId);
  const ids = students.map(s => s.id);
  const scoreOf = new Map(g.scores.map(s => [s.column_id + '|' + s.student_id, Number(s.score)]));

  let html = '<div class="crm-grade-caps">';
  ['performance', 'tests'].forEach(cat => {
    const used = gradeCategoryTotal(g.columns, cat);
    const full = used >= GRADE_CAPS[cat];
    html += `<div class="crm-grade-cap"><span><b>${GRADE_CATEGORY_LABELS[cat]}</b> · موزّع ${formatScore(used)} من ${GRADE_CAPS[cat]}</span>
      ${full ? '' : `<button class="crm-skip-btn" onclick="openCrmGradeColumnEditor('${cat}', null)">+ عمود</button>`}</div>`;
  });
  html += '</div>';

  if(!students.length){
    return html + '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>';
  }

  html += '<div class="crm-grade-wrap"><table class="crm-grade-table"><thead><tr><th class="crm-grade-name">الطالب</th>';
  g.columns.forEach(c => {
    const st = gradeColumnStats(c.id, g.scores, ids);
    html += `<th class="crm-grade-col cat-${c.category}" onclick="openCrmGradeColumnMenu('${c.id}')" title="${escapeHtml(c.measures || '')}">
      ${escapeHtml(c.name)}<span class="crm-grade-max">من ${formatScore(c.max_score)}</span>${st.missing ? `<span class="crm-grade-missing">${st.missing} بلا درجة</span>` : ''}</th>`;
  });
  html += `<th class="crm-grade-total">${GRADE_CATEGORY_SHORT.performance}<span class="crm-grade-max">${formatScore(gradeCategoryTotal(g.columns, 'performance'))}</span></th>
    <th class="crm-grade-total">${GRADE_CATEGORY_SHORT.tests}<span class="crm-grade-max">${formatScore(gradeCategoryTotal(g.columns, 'tests'))}</span></th></tr></thead><tbody>`;
  students.forEach(s => {
    const sum = studentGradeSummary(g.columns, g.scores, s.id);
    html += `<tr><td class="crm-grade-name" onclick="openCrmStudentProfile('${s.id}', { type: 'tab', tab: 'grades' })">${escapeHtml(s.full_name)}</td>`;
    g.columns.forEach(c => {
      const k = c.id + '|' + s.id;
      html += `<td>${scoreOf.has(k) ? formatScore(scoreOf.get(k)) : '<span class="crm-grade-empty">—</span>'}</td>`;
    });
    html += `<td class="crm-grade-total">${sum.performance.count ? formatScore(sum.performance.sum) : ''}</td>
      <td class="crm-grade-total">${sum.tests.count ? formatScore(sum.tests.sum) : ''}</td></tr>`;
  });
  html += '</tbody></table></div>';
  html += '<p style="font-size:11px;color:var(--muted);margin:8px 0 0;">اضغط رأس العمود لرصد درجاته أو تعديله. "—" = لم تُرصد (لا تُحسب صفرًا).</p>';
  return html;
}

async function createCrmGradeSheet(){
  if(crmGradeBusy || !crmGrades || crmGrades.columns.length) return;
  crmGradeBusy = true;
  const btn = document.getElementById('crmGradesCreateBtn');
  if(btn) btn.disabled = true;
  const { sectionId, year, semester } = crmGrades;
  try{
    const prev = previousGradeTerm(year, semester);
    let prevColumns = [];
    if(prev){
      const { data } = await sb.from('classroom_grade_columns').select('category, name, max_score, measures, position')
        .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('academic_year', prev.year).eq('semester', prev.semester);
      prevColumns = data || [];
    }
    /* أُنشئ من جهاز آخر أثناء ذلك؟ لا نكرر الأعمدة */
    const { data: existing } = await sb.from('classroom_grade_columns').select('id')
      .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('academic_year', year).eq('semester', semester).limit(1);
    if(!(existing || []).length){
      const rows = gradeSheetSeed(prevColumns).map(c => Object.assign({ teacher_id: currentUser.id, section_id: sectionId, academic_year: year, semester }, c));
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
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px;" onclick="closeCrmModal();openCrmGradeEntry('${c.id}')">رصد الدرجات</button>
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
  const remaining = GRADE_CAPS[category] - gradeCategoryTotal(crmGrades.columns, category, columnId);
  crmGradeColumnDraft = { id: columnId || null, category, saving: false };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${c ? 'تعديل عمود' : 'عمود جديد'} · ${GRADE_CATEGORY_LABELS[category]}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">المتاح من السقف (${GRADE_CAPS[category]}): ${formatScore(remaining)}</div>
      <label class="crm-field-label">الاسم</label>
      <input class="goal-input" id="crmGradeColName" maxlength="60" value="${c ? escapeHtml(c.name) : ''}" placeholder="مثال: اختبار قصير 1" style="margin-bottom:8px;">
      <label class="crm-field-label">الدرجة القصوى</label>
      <input class="goal-input" id="crmGradeColMax" inputmode="decimal" value="${c ? formatScore(c.max_score) : (remaining > 0 ? formatScore(remaining) : '')}" style="margin-bottom:8px;">
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
  const errBox = document.getElementById('crmGradeColError');
  const err = validateGradeColumn(crmGrades.columns, draft, crmGrades.scores);
  if(err){ errBox.textContent = err; errBox.style.display = 'block'; return; }
  d.saving = true;
  const btn = document.getElementById('crmGradeColSaveBtn');
  if(btn) btn.disabled = true;
  const g = crmGrades;
  const payload = { name: draft.name, max_score: Number(draft.max_score), measures: draft.measures };
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
  renderCrmGrades();
}

/* ============ رصد عمود ============ */
function openCrmGradeEntry(columnId){
  const box = document.getElementById('crmGradesBody');
  const c = crmGrades && crmGrades.columns.find(x => x.id === columnId);
  if(!box || !c) return;
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
  if(crmGradeEntry === entry) renderCrmGrades(); /* لم ينتقل لشاشة أخرى أثناء الحفظ */
}
