/* ============================================================
   ورقة الحصة ← "اختبار" (الكشف الثابت — الدفعة 2)
   ------------------------------------------------------------
   - الاختبار = عمود في فئة الاختبارات (اسم ودرجة كاملة)، بلا سقف ولا عدد.
   - تختار الاختبار (أو "+ اختبار")، وتكتب درجة كل طالب في خانته؛ كل خانة
     تُحفظ فور الخروج منها أو Enter. الفارغة = لم يُرصد (لا تُحسب صفرًا).
   - التعديل والحذف من الكشف (بطاقة الاختبارات) — الورقة للرصد فقط.
   ============================================================ */

/* اختبارات الشعبة القابلة للرصد يدويًا (أعمدة أدوات "حالة/درجة" تُرصد من أوضاعها) */
function sheetTestColumns(columns){
  return sortGradeColumns((columns || []).filter(c => c.category === 'tests' && !c.tool_id && gradeColumnVisible(c)));
}

/* الاختبار المختار افتراضيًا: آخر اختبار أُضيف */
function defaultSheetTestId(tests){
  const list = (tests || []).slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return list.length ? list[list.length - 1].id : null;
}

async function renderCrmTestMode(students, selectId){
  const s = crmSheet;
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  const term = crmCurrentTerm();
  const uid = currentUser.id;
  let tests, scores = [];
  try{
    const { data, error } = await sb.from('classroom_grade_columns').select('id, name, max_score, category, kind, tool_id, position, created_at')
      .eq('teacher_id', uid).eq('section_id', s.sectionId).eq('academic_year', term.year).eq('semester', term.semester).eq('category', 'tests');
    if(error) throw error;
    tests = sheetTestColumns(data);
    const selectedId = (selectId && tests.some(t => t.id === selectId)) ? selectId : defaultSheetTestId(tests);
    if(selectedId){
      const { data: sc, error: sErr } = await sb.from('classroom_grade_scores').select('student_id, score')
        .eq('teacher_id', uid).eq('column_id', selectedId);
      if(sErr) throw sErr;
      scores = sc || [];
    }
    if(crmSheet !== s || s.token !== token || s.mode !== 'test') return;
    s.test = { tests, selectedId, values: new Map(scores.map(r => [r.student_id, Number(r.score)])), queue: new Map(), term };
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== 'test') return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('test')">إعادة المحاولة</button></div>`;
    return;
  }
  const t = s.test;
  const test = t.tests.find(x => x.id === t.selectedId);
  if(!test){
    body.innerHTML = head + `<div class="empty-state">لا اختبارات لهذه الشعبة بعد — أضف اختبارًا بأي اسم ودرجة كاملة، ويدخل محصلة الاختبارات تلقائيًا.</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="openCrmSheetTestModal()">+ اختبار</button>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  body.innerHTML = head + `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="goal-input" style="margin:0;flex:1;" onchange="renderCrmTestMode(crmStudentsOfSection(crmSheet.sectionId), this.value)">
        ${t.tests.map(x => `<option value="${x.id}"${x.id === t.selectedId ? ' selected' : ''}>${escapeHtml(x.name)} · من ${formatScore(x.max_score)}</option>`).join('')}
      </select>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmSheetTestModal()">+ اختبار</button>
    </div>
    <div id="crmTestCounts" class="crm-sheet-counts"></div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">اكتب درجة كل طالب (من ${formatScore(test.max_score)}) — تُحفظ فور الانتقال للخانة التالية. اترك الغائب فارغًا فلا يُحسب عليه. التعديل والحذف من الكشف.</p>
    <div class="crm-grade-entry">
      ${students.map((st, i) => `<label class="crm-grade-entry-row">
        <span>${escapeHtml(st.full_name)}${s.states && s.states[st.id] === 'absent' ? ' <small style="color:#8A2C2C;">غائب</small>' : ''}</span>
        <input class="goal-input crm-grade-input crm-test-input" inputmode="decimal" autocomplete="off" data-student="${st.id}" data-index="${i}"
          value="${t.values.has(st.id) ? formatScore(t.values.get(st.id)) : ''}" onkeydown="onCrmTestInputKey(event, ${i})" onchange="saveCrmTestInput(this)" oninput="this.classList.remove('is-invalid')">
      </label>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      ${crmSheetFinishBtnHtml()}
      <button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button>
    </div>`;
  paintCrmTestCounts();
}

function paintCrmTestCounts(){
  const el = document.getElementById('crmTestCounts');
  const t = crmSheet && crmSheet.test;
  if(!el || !t) return;
  const ids = crmStudentsOfSection(crmSheet.sectionId).map(x => x.id);
  const vals = ids.filter(id => t.values.has(id)).map(id => t.values.get(id));
  const avg = vals.length ? Math.round(100 * vals.reduce((a, b) => a + b, 0) / vals.length) / 100 : null;
  el.textContent = `رُصد ${vals.length} من ${ids.length}` + (avg === null ? '' : ` · المتوسط ${formatScore(avg)}`);
}

function onCrmTestInputKey(e, index){
  if(e.key !== 'Enter') return;
  e.preventDefault();
  saveCrmTestInput(e.target);
  const next = document.querySelector(`.crm-test-input[data-index="${index + 1}"]`);
  if(next){ next.focus(); next.select && next.select(); }
}

/* حفظ خانة طالب: بالتتابع لكل طالب، والفشل يعيد الخانة لما كانت */
function saveCrmTestInput(input){
  const s = crmSheet;
  const t = s && s.test;
  if(!t || !input) return;
  const test = t.tests.find(x => x.id === t.selectedId);
  if(!test) return;
  const studentId = input.dataset.student;
  const parsed = parseScoreInput(input.value, test.max_score);
  if(!parsed.ok){
    input.classList.add('is-invalid');
    showToast(`${parsed.error} (الدرجة الكاملة ${formatScore(test.max_score)})`, 'error');
    return;
  }
  const prev = t.values.has(studentId) ? t.values.get(studentId) : null;
  const value = parsed.value;
  if(prev === value) return;
  if(value === null) t.values.delete(studentId); else t.values.set(studentId, value);
  paintCrmTestCounts();
  const columnId = test.id;
  const before = t.queue.get(studentId) || Promise.resolve();
  const next = before.then(async () => {
    const uid = currentUser.id;
    const { error } = value === null
      ? await sb.from('classroom_grade_scores').delete().eq('teacher_id', uid).eq('column_id', columnId).eq('student_id', studentId)
      : await sb.from('classroom_grade_scores').upsert({ teacher_id: uid, column_id: columnId, student_id: studentId, score: value }, { onConflict: 'column_id,student_id' });
    if(error) throw error;
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  }).catch(e => {
    markCrmSheetFailure();
    showToast('لم تُحفظ الدرجة: ' + (typeof gradeDbErrorMessage === 'function' ? gradeDbErrorMessage(e) : (e.message || 'خطأ بالاتصال')), 'error');
    /* يُعاد العرض لما كان، ما لم تتغيّر الخانة بإدخال أحدث أو يتبدّل الاختبار */
    if(crmSheet !== s || s.test !== t || t.selectedId !== columnId) return;
    const cur = t.values.has(studentId) ? t.values.get(studentId) : null;
    if(cur !== value) return;
    if(prev === null) t.values.delete(studentId); else t.values.set(studentId, prev);
    if(input.isConnected) input.value = prev === null ? '' : formatScore(prev);
    paintCrmTestCounts();
  });
  t.queue.set(studentId, next);
  return next;
}

/* ============ + اختبار من ورقة الحصة ============ */
let crmSheetTestDraft = null; /* { sectionId, term, saving } */

function openCrmSheetTestModal(){
  const s = crmSheet;
  if(!s) return;
  crmSheetTestDraft = { sectionId: s.sectionId, term: crmCurrentTerm(), position: s.test ? s.test.tests.length : 0, saving: false };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">اختبار جديد</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(crmSectionLabel(s.sectionId))} · يدخل محصلة الاختبارات (من ${formatScore(gradeCap('tests'))}) تلقائيًا</div>
      <label class="crm-field-label">اسم الاختبار</label>
      <input class="goal-input" id="crmSheetTestName" maxlength="60" placeholder="مثال: الفترة الأولى، اختبار قصير 1" style="margin-bottom:8px;">
      <label class="crm-field-label">الدرجة الكاملة</label>
      <input class="goal-input" id="crmSheetTestMax" inputmode="decimal" value="${GRADE_TEST_DEFAULT_MAX}" style="margin-bottom:8px;">
      <div id="crmSheetTestError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:8px;"></div>
      <button class="btn btn-primary" id="crmSheetTestSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmSheetTest()">إضافة الاختبار</button>
    </div>`, '400px');
}

async function saveCrmSheetTest(){
  const d = crmSheetTestDraft;
  if(!d || d.saving || !currentUser) return;
  const err = document.getElementById('crmSheetTestError');
  const fail = m => { err.textContent = m; err.style.display = 'block'; };
  const toLatin = v => String(v || '').trim().replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.');
  const draft = { category: 'tests', name: document.getElementById('crmSheetTestName').value.trim(), max_score: toLatin(document.getElementById('crmSheetTestMax').value) };
  const msg = validateGradeColumn([], draft, []);
  if(msg) return fail(msg);
  d.saving = true;
  const btn = document.getElementById('crmSheetTestSaveBtn');
  if(btn) btn.disabled = true;
  const uid = currentUser.id;
  const { data, error } = await sb.from('classroom_grade_columns').insert({
    teacher_id: uid, section_id: d.sectionId, academic_year: d.term.year, semester: d.term.semester,
    category: 'tests', kind: 'manual', name: draft.name, max_score: Number(draft.max_score), position: d.position
  }).select('id').single();
  if(error || !data){
    d.saving = false;
    if(btn) btn.disabled = false;
    return fail('تعذّر الحفظ: ' + (error ? gradeDbErrorMessage(error) : ''));
  }
  crmSheetTestDraft = null;
  closeCrmModal();
  showToast('أُضيف الاختبار — اكتب الدرجات', 'ok');
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  /* الورقة ما زالت على نفس الشعبة ووضع الاختبار: تُفتح على الاختبار الجديد */
  if(crmSheet && crmSheet.sectionId === d.sectionId && crmSheet.mode === 'test') renderCrmTestMode(crmStudentsOfSection(d.sectionId), data.id);
}
