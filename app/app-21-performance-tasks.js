/* ============================================================
   المهام الأدائية — وضع "مهمة" في ورقة الحصة
   ------------------------------------------------------------
   باتفاق مع المعلم:
   - المعلم يحدد بالاسم من يُكلَّف بكل مهمة (لا أحد مختار تلقائيًا).
   - لكل مهمة درجتها؛ الرصد بأزرار سريعة (كاملة، ¾، ½، ¼، 0) أو رقم دقيق.
   - المهمة لا تُحسب للطالب حتى تُرصد درجته (لا صفر صامت). من لم يسلّم
     فعلًا يُرصد له 0 صراحةً.
   - عمود "مهام أدائية" يُحسب تلقائيًا بالوزن: مجموع ما حصّله الطالب ÷
     مجموع درجات مهامه المقيَّمة × حد العمود. من لم يُكلَّف بمهمة لا تُحسب
     عليه.
   - يُحسب الطالب على كل مهامه في الفصل الدراسي ولو في شعبة سابقة، فلا
     تضيع درجاته إن نُقل لشعبة أخرى.
   ============================================================ */

const TASK_QUICK_FRACTIONS = [['كاملة', 1], ['¾', 0.75], ['½', 0.5], ['¼', 0.25], ['0', 0]];

/* ============ دوال صرفة ============ */
function taskRowsIndex(rows){
  const idx = new Map();
  (rows || []).forEach(r => {
    if(!idx.has(r.task_id)) idx.set(r.task_id, new Map());
    idx.get(r.task_id).set(r.student_id, r.score === null || r.score === undefined ? null : Number(r.score));
  });
  return idx;
}

/* درجة الطالب في عمود المهام: بالوزن، على مهامه المقيَّمة فقط */
function taskColumnScoreFor(tasks, rows, studentId, colMax){
  const maxById = new Map((tasks || []).map(t => [t.id, Number(t.max_score)]));
  let earned = 0, possible = 0;
  (rows || []).forEach(r => {
    if(r.student_id !== studentId || r.score === null || r.score === undefined) return;
    const m = maxById.get(r.task_id);
    if(!m) return;
    earned += Number(r.score);
    possible += m;
  });
  if(!possible) return null;
  return Math.round(100 * Math.min(1, earned / possible) * Number(colMax)) / 100;
}

function planTaskScoreSync(studentIds, tasks, rows, colMax, existing){
  return planComputedScoreSync(studentIds, id => taskColumnScoreFor(tasks, rows, id, colMax), existing);
}

function taskQuickScores(max){
  return TASK_QUICK_FRACTIONS.map(([label, f]) => ({ label, value: Math.round(Number(max) * f * 100) / 100 }));
}

function parseTaskNumber(text){
  const v = String(text === null || text === undefined ? '' : text).trim()
    .replace(/[٠-٩]/g, x => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[٫,]/g, '.');
  if(!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseTaskScore(text, max){
  const n = parseTaskNumber(text);
  if(n === null) return { error: 'اكتب الدرجة' };
  if(Number.isNaN(n) || n < 0) return { error: 'درجة غير صحيحة' };
  if(n > Number(max)) return { error: `أكبر من درجة المهمة (${formatScore(max)})` };
  return { value: Math.round(n * 100) / 100 };
}

/* تغيير المكلَّفين يمسّ طلاب الشعبة الحاليين فقط: من نُقل لشعبة أخرى تبقى
   مهمته ودرجته كما هي (لا يظهر في الاختيار فلا يُزال بالخطأ) */
function planTaskAssigneeChange(currentRows, selectedIds, sectionStudentIds){
  const inSection = new Set(sectionStudentIds || []);
  const selected = new Set(selectedIds || []);
  const current = new Map((currentRows || []).map(r => [r.student_id, r.score]));
  const add = [...selected].filter(id => !current.has(id));
  const remove = [...current.keys()].filter(id => inSection.has(id) && !selected.has(id));
  const removeScored = remove.filter(id => current.get(id) !== null && current.get(id) !== undefined);
  return { add, remove, removeScored };
}

function taskGradeSummary(scoreMap, studentIds){
  let graded = 0, sum = 0;
  (studentIds || []).forEach(id => {
    const v = scoreMap && scoreMap.get(id);
    if(v === null || v === undefined) return;
    graded++; sum += v;
  });
  return { graded, total: (studentIds || []).length, avg: graded ? Math.round(100 * sum / graded) / 100 : null };
}

function taskScoreTone(score, max){
  if(score === null || score === undefined) return 'tk-none';
  const r = Number(max) ? score / Number(max) : 0;
  return r >= 0.75 ? 'tk-high' : r >= 0.5 ? 'tk-mid' : 'tk-low';
}

function taskDbErrorMessage(error){
  const msg = (error && error.message) || '';
  if(msg.indexOf('task_score_above_max') !== -1) return 'الدرجة أكبر من درجة المهمة — ربما عُدّلت المهمة من جهاز آخر. حدّث الصفحة.';
  if(msg.indexOf('task_max_below_scores') !== -1) return 'توجد درجات مرصودة أعلى من درجة المهمة الجديدة — عدّلها أولًا.';
  return msg || 'خطأ بالاتصال';
}

/* ============ تحميل ومزامنة عمود المهام ============ */
async function loadSectionTasks(sectionId, term){
  const uid = currentUser.id;
  const { data: tasks, error } = await sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, created_at')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester)
    .order('created_at', { ascending: true });
  if(error) throw error;
  let rows = [];
  for(const ids of chunkArray((tasks || []).map(t => t.id), 100)){
    const { data, error: rErr } = await sb.from('classroom_task_students').select('task_id, student_id, score')
      .eq('teacher_id', uid).in('task_id', ids);
    if(rErr) throw rErr;
    rows = rows.concat(data || []);
  }
  return { tasks: tasks || [], rows };
}

/* كل مهام الفصل (أي شعبة) لهؤلاء الطلاب — الطالب المنقول يُحسب على مهامه السابقة */
async function loadTaskScoresForStudents(studentIds, term){
  const uid = currentUser.id;
  const { data: tasks, error } = await sb.from('classroom_tasks').select('id, max_score')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester);
  if(error) throw error;
  const inTerm = new Set((tasks || []).map(t => t.id));
  let rows = [];
  for(const ids of chunkArray(studentIds || [], 100)){
    const { data, error: rErr } = await sb.from('classroom_task_students').select('task_id, student_id, score')
      .eq('teacher_id', uid).in('student_id', ids);
    if(rErr) throw rErr;
    rows = rows.concat((data || []).filter(r => inTerm.has(r.task_id)));
  }
  return { tasks: tasks || [], rows };
}

/* يكتب درجات عمود "مهام أدائية" المحسوبة. studentIds اختياري (طالب واحد بعد رصد). يرمي عند الفشل. */
async function syncTaskColumn(column, sectionId, term, studentIds){
  if(!column) return;
  const uid = currentUser.id;
  const ids = studentIds || crmStudentsOfSection(sectionId).map(s => s.id);
  if(!ids.length) return;
  const [{ tasks, rows }, scoresRes] = await Promise.all([
    loadTaskScoresForStudents(ids, term),
    sb.from('classroom_grade_scores').select('student_id, score').eq('teacher_id', uid).eq('column_id', column.id)
  ]);
  if(scoresRes.error) throw scoresRes.error;
  const existing = new Map((scoresRes.data || []).map(r => [r.student_id, Number(r.score)]));
  const plan = planTaskScoreSync(ids, tasks, rows, column.max_score, existing);
  if(plan.upserts.length){
    const { error: uErr } = await sb.from('classroom_grade_scores').upsert(
      plan.upserts.map(u => ({ teacher_id: uid, column_id: column.id, student_id: u.student_id, score: u.score })),
      { onConflict: 'column_id,student_id' });
    if(uErr) throw uErr;
  }
  if(plan.deletes.length){
    const { error: dErr } = await sb.from('classroom_grade_scores').delete()
      .eq('teacher_id', uid).eq('column_id', column.id).in('student_id', plan.deletes);
    if(dErr) throw dErr;
  }
  if(plan.upserts.length || plan.deletes.length) afterCrmGradesChanged();
}

/* ============ وضع "مهمة" في ورقة الحصة ============ */
async function renderCrmTasks(students, selectId){
  const s = crmSheet;
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  const term = crmCurrentTerm();
  let data, column;
  try{
    [data, column] = await Promise.all([loadSectionTasks(s.sectionId, term), findKindColumn(s.sectionId, term, 'task')]);
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== 'task') return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('task')">إعادة المحاولة</button></div>`;
    return;
  }
  if(crmSheet !== s || s.token !== token || s.mode !== 'task') return;
  const idx = taskRowsIndex(data.rows);
  if(!data.tasks.length){
    s.task = { data, column, selectedId: null, scores: new Map(), queue: new Map(), term };
    body.innerHTML = head + `<div class="empty-state">لا مهام أدائية لهذه الشعبة بعد.</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="openCrmTaskModal()">+ مهمة جديدة</button>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  const selectedId = (selectId && data.tasks.some(t => t.id === selectId)) ? selectId : data.tasks[data.tasks.length - 1].id;
  const task = data.tasks.find(t => t.id === selectedId);
  const scores = idx.get(selectedId) || new Map();
  const assigned = students.filter(st => scores.has(st.id));
  s.task = { data, column, selectedId, scores, queue: new Map(), term, pick: null };
  body.innerHTML = head + `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="goal-input" style="margin:0;flex:1;" onchange="renderCrmTasks(crmStudentsOfSection(crmSheet.sectionId), this.value)">
        ${data.tasks.map(t => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${escapeHtml(t.title)} · من ${formatScore(t.max_score)} · لـ ${(idx.get(t.id) || new Map()).size}</option>`).join('')}
      </select>
      <button class="btn btn-outline crm-mini-btn" title="تعديل المهمة أو حذفها" onclick="openCrmTaskEditor(crmSheet.task && crmSheet.task.selectedId)">✎ تعديل</button>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmTaskModal()">+ مهمة</button>
    </div>
    ${task.description ? `<div class="crm-task-desc">${escapeHtml(task.description)}</div>` : ''}
    <div id="crmTaskCounts" class="crm-sheet-counts"></div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">اضغط على الطالب لرصد درجته من ${formatScore(task.max_score)}${task.due_date ? ' · التسليم ' + shortDateAr(task.due_date) : ''}. لا تُحسب المهمة للطالب حتى تُرصد درجته${column ? '، وتُحسب في عمود "' + escapeHtml(column.name) + '"' : ' (أضف عمود مهام أدائية في الكشف ليُحسب تلقائيًا)'}.</p>
    ${assigned.length ? `<div class="crm-att-grid">
      ${assigned.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn" id="crmTask_${st.id}" onclick="openCrmTaskScorePicker('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
      </div>`).join('')}
    </div>` : '<div class="empty-state">لا أحد من طلاب الشعبة مكلّف بهذه المهمة — اضغط "✎ تعديل" لاختيار الطلاب.</div>'}
    <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
  assigned.forEach(st => paintCrmTask(st.id));
  paintCrmTaskCounts();
}

function crmSelectedTask(){
  const t = crmSheet && crmSheet.task;
  return t && t.selectedId ? t.data.tasks.find(x => x.id === t.selectedId) : null;
}

function paintCrmTask(studentId){
  const t = crmSheet && crmSheet.task;
  const task = crmSelectedTask();
  const btn = document.getElementById('crmTask_' + studentId);
  if(!btn || !task) return;
  const v = t.scores.get(studentId);
  btn.className = 'crm-att-btn ' + taskScoreTone(v, task.max_score);
  btn.querySelector('.crm-att-state').textContent = v === null || v === undefined ? 'لم يُقيَّم' : `${formatScore(v)} / ${formatScore(task.max_score)}`;
}

function paintCrmTaskCounts(){
  const el = document.getElementById('crmTaskCounts');
  const task = crmSelectedTask();
  if(!el || !task) return;
  const ids = crmStudentsOfSection(crmSheet.sectionId).map(x => x.id).filter(id => crmSheet.task.scores.has(id));
  const c = taskGradeSummary(crmSheet.task.scores, ids);
  el.textContent = `قُيّم ${c.graded} من ${c.total}` + (c.avg === null ? '' : ` · المتوسط ${formatScore(c.avg)} من ${formatScore(task.max_score)}`);
}

function openCrmTaskScorePicker(studentId){
  const t = crmSheet && crmSheet.task;
  const task = crmSelectedTask();
  if(!task || !t.scores.has(studentId)) return;
  const st = crmStudents.find(x => x.id === studentId);
  const cur = t.scores.get(studentId);
  t.pick = { taskId: task.id, studentId };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${escapeHtml(st ? st.full_name : '')}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(task.title)} · من ${formatScore(task.max_score)}</div>
      <div class="crm-task-chips">
        ${taskQuickScores(task.max_score).map(q => `<button type="button" class="btn btn-outline${cur === q.value ? ' is-on' : ''}" onclick="applyCrmTaskScore(${q.value})">${q.label}<small>${formatScore(q.value)}</small></button>`).join('')}
      </div>
      <label class="crm-field-label">أو درجة دقيقة</label>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <input class="goal-input" id="crmTaskScoreInput" inputmode="decimal" style="margin:0;flex:1;" value="${cur === null || cur === undefined ? '' : formatScore(cur)}" placeholder="من ${formatScore(task.max_score)}">
        <button class="btn btn-primary" onclick="saveCrmTaskScoreInput()">حفظ</button>
      </div>
      <div id="crmTaskScoreError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:6px;"></div>
      ${cur === null || cur === undefined ? '' : '<button class="btn btn-outline" style="width:100%;justify-content:center;" onclick="applyCrmTaskScore(null)">مسح التقييم (لم يُقيَّم)</button>'}
    </div>`, '400px');
}

function saveCrmTaskScoreInput(){
  const task = crmSelectedTask();
  if(!task) return;
  const r = parseTaskScore(document.getElementById('crmTaskScoreInput').value, task.max_score);
  if(r.error){
    const box = document.getElementById('crmTaskScoreError');
    box.textContent = r.error;
    box.style.display = 'block';
    return;
  }
  applyCrmTaskScore(r.value);
}

function applyCrmTaskScore(score){
  const t = crmSheet && crmSheet.task;
  const p = t && t.pick;
  closeCrmModal();
  /* المختار تغيّر بعد فتح النافذة (أو الطالب أُزيل من المهمة): لا نكتب على مهمة أخرى */
  if(!p || t.selectedId !== p.taskId || !t.scores.has(p.studentId)) return;
  t.pick = null;
  const prev = t.scores.get(p.studentId);
  if(prev === score) return;
  t.scores.set(p.studentId, score);
  paintCrmTask(p.studentId);
  paintCrmTaskCounts();
  persistCrmTaskScore(p.studentId, score, prev);
}

/* حفظ درجة طالب ثم إعادة حساب عموده — بالتتابع لكل طالب */
function persistCrmTaskScore(studentId, score, prev){
  const s = crmSheet;
  const t = s.task;
  const taskId = t.selectedId;
  const before = t.queue.get(studentId) || Promise.resolve();
  const next = before.then(async () => {
    const uid = currentUser.id;
    try{
      const { data, error } = await sb.from('classroom_task_students').update({ score })
        .eq('teacher_id', uid).eq('task_id', taskId).eq('student_id', studentId).select('id');
      if(error) throw error;
      if(!(data || []).length) throw new Error('الطالب لم يعد مكلّفًا بهذه المهمة — ربما عُدّلت من جهاز آخر');
    } catch(e){
      /* يُعاد العرض لما كان، ما لم تتغيّر الدرجة بنقرة أحدث */
      if(crmSheet === s && t.selectedId === taskId && t.scores.get(studentId) === score){
        t.scores.set(studentId, prev);
        paintCrmTask(studentId);
        paintCrmTaskCounts();
      }
      showToast('لم تُحفظ الدرجة: ' + taskDbErrorMessage(e), 'error');
      return;
    }
    const row = t.data.rows.find(r => r.task_id === taskId && r.student_id === studentId);
    if(row) row.score = score;
    try{ await syncTaskColumn(t.column, s.sectionId, t.term, [studentId]); }
    catch(e){ showToast('حُفظت الدرجة، وتعذّر تحديث عمود المهام — يُحدَّث عند فتح الكشف', 'error'); }
  });
  t.queue.set(studentId, next);
  return next;
}

/* ============ إضافة/تعديل مهمة ============ */
let crmTaskDraft = null; /* { sectionId, editId?, selected: Set, saving, confirmRemoval? } */

function crmTaskFormHtml(sectionId, task){
  const d = crmTaskDraft;
  const students = crmStudentsOfSection(sectionId);
  return `
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${task ? 'تعديل المهمة' : 'مهمة أدائية جديدة'}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(crmSectionLabel(sectionId))}</div>
      <label class="crm-field-label">المهمة</label>
      <input class="goal-input" id="crmTaskTitle" maxlength="200" placeholder="مثال: تقرير عن الطاقة المتجددة" value="${task ? escapeHtml(task.title) : ''}" style="margin-bottom:8px;">
      <label class="crm-field-label">الوصف (اختياري)</label>
      <textarea class="goal-input" id="crmTaskDesc" maxlength="2000" rows="2" style="margin-bottom:8px;resize:vertical;">${task && task.description ? escapeHtml(task.description) : ''}</textarea>
      <div style="display:flex;gap:8px;">
        <div style="flex:1;"><label class="crm-field-label">درجة المهمة</label>
          <input class="goal-input" id="crmTaskMax" inputmode="decimal" value="${task ? formatScore(task.max_score) : '10'}" style="margin-bottom:8px;"></div>
        <div style="flex:1;"><label class="crm-field-label">التسليم (اختياري)</label>
          <input type="date" class="goal-input" id="crmTaskDue" value="${task && task.due_date ? escapeHtml(task.due_date) : ''}" style="margin-bottom:8px;"></div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <label class="crm-field-label" style="margin:0;flex:1;">الطلاب المكلّفون · <span id="crmTaskPickCount">${d.selected.size}</span></label>
        <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskPickAll(true)">الكل</button>
        <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskPickAll(false)">لا أحد</button>
      </div>
      ${students.length ? `<div class="crm-task-pick-grid">
        ${students.map(st => `<button type="button" class="crm-task-pick${d.selected.has(st.id) ? ' is-on' : ''}" id="crmTaskPick_${st.id}" onclick="toggleCrmTaskPick('${st.id}')">${escapeHtml(st.full_name)}</button>`).join('')}
      </div>` : '<div class="crm-today-empty">لا طلاب في هذه الشعبة.</div>'}
      <div id="crmTaskError" style="display:none;color:#8A2C2C;font-size:12px;margin:8px 0;line-height:1.7;"></div>
      <button class="btn btn-primary" id="crmTaskSaveBtn" style="width:100%;justify-content:center;margin-top:10px;" onclick="saveCrmTask()">${task ? 'حفظ التعديل' : 'حفظ المهمة'}</button>
      ${task ? `<button class="btn btn-outline" id="crmTaskDeleteBtn" style="width:100%;justify-content:center;margin-top:8px;color:#8A2C2C;" onclick="deleteCrmTask('${task.id}', '${sectionId}')">حذف المهمة</button>` : ''}
    </div>`;
}

function openCrmTaskModal(sectionIdArg){
  const sectionId = sectionIdArg || (crmSheet && crmSheet.sectionId) || (crmGrades && crmGrades.sectionId);
  if(!sectionId) return;
  crmTaskDraft = { sectionId, selected: new Set(), saving: false };
  showInfoModal(crmTaskFormHtml(sectionId, null), '460px');
}

/* يقرأ المهمة ومكلَّفيها من القاعدة مباشرة (لا من نسخة محلية قد تكون قديمة) */
let crmTaskEditorOpening = false;
async function openCrmTaskEditor(taskId){
  if(!taskId || crmTaskEditorOpening) return;
  crmTaskEditorOpening = true;
  let tRes, rRes;
  try{
    [tRes, rRes] = await Promise.all([
      sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date').eq('teacher_id', currentUser.id).eq('id', taskId).maybeSingle(),
      sb.from('classroom_task_students').select('student_id').eq('teacher_id', currentUser.id).eq('task_id', taskId)
    ]);
  } catch(e){ tRes = { error: e }; }
  finally { crmTaskEditorOpening = false; }
  if(tRes.error || (rRes && rRes.error)){ showToast('تعذّر تحميل المهمة', 'error'); return; }
  if(!tRes.data){ showToast('المهمة غير موجودة — ربما حُذفت من جهاز آخر', 'error'); return; }
  const task = tRes.data;
  closeCrmModal();
  crmTaskDraft = { sectionId: task.section_id, editId: task.id, selected: new Set((rRes.data || []).map(r => r.student_id)), saving: false };
  showInfoModal(crmTaskFormHtml(task.section_id, task), '460px');
}

function paintCrmTaskPickCount(){
  const el = document.getElementById('crmTaskPickCount');
  if(el && crmTaskDraft) el.textContent = crmTaskDraft.selected.size;
}

function toggleCrmTaskPick(studentId){
  const d = crmTaskDraft;
  if(!d || d.saving) return;
  if(d.selected.has(studentId)) d.selected.delete(studentId); else d.selected.add(studentId);
  d.confirmRemoval = null;
  const btn = document.getElementById('crmTaskPick_' + studentId);
  if(btn) btn.className = 'crm-task-pick' + (d.selected.has(studentId) ? ' is-on' : '');
  paintCrmTaskPickCount();
}

function setCrmTaskPickAll(on){
  const d = crmTaskDraft;
  if(!d || d.saving) return;
  crmStudentsOfSection(d.sectionId).forEach(st => {
    if(on) d.selected.add(st.id); else d.selected.delete(st.id);
    const btn = document.getElementById('crmTaskPick_' + st.id);
    if(btn) btn.className = 'crm-task-pick' + (on ? ' is-on' : '');
  });
  d.confirmRemoval = null;
  paintCrmTaskPickCount();
}

async function saveCrmTask(){
  const d = crmTaskDraft;
  if(!d || d.saving) return;
  const errBox = document.getElementById('crmTaskError');
  const fail = msg => { errBox.textContent = msg; errBox.style.display = 'block'; };
  const title = document.getElementById('crmTaskTitle').value.trim();
  const description = document.getElementById('crmTaskDesc').value.trim().slice(0, 2000) || null;
  const max = parseTaskNumber(document.getElementById('crmTaskMax').value);
  const due = document.getElementById('crmTaskDue').value || null;
  if(!title) return fail('اكتب المهمة');
  if(max === null || Number.isNaN(max) || max <= 0 || max > 100) return fail('درجة المهمة رقم أكبر من صفر وحتى 100');
  /* الطلاب المختارون من الشعبة الحالية فقط */
  const sectionIds = crmStudentsOfSection(d.sectionId).map(s => s.id);
  const selected = [...d.selected].filter(id => sectionIds.includes(id));
  if(!selected.length) return fail('اختر طالبًا واحدًا على الأقل');
  d.saving = true;
  const btns = ['crmTaskSaveBtn', 'crmTaskDeleteBtn'].map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; });
  const unlock = () => { d.saving = false; btns.forEach(b => { b.disabled = false; }); };
  const uid = currentUser.id;
  const payload = { title, description, max_score: Math.round(max * 100) / 100, due_date: due };
  let id = d.editId;
  try{
    if(d.editId){
      const { data: cur, error: cErr } = await sb.from('classroom_task_students').select('student_id, score').eq('teacher_id', uid).eq('task_id', d.editId);
      if(cErr) throw cErr;
      const plan = planTaskAssigneeChange(cur, selected, sectionIds);
      /* إزالة طالب له درجة تحذف درجته — تأكيد بنقرة ثانية على "حفظ" */
      const sig = plan.removeScored.slice().sort().join(',');
      if(plan.removeScored.length && d.confirmRemoval !== sig){
        d.confirmRemoval = sig;
        unlock();
        return fail(`أزلت ${plan.removeScored.length} ${plan.removeScored.length === 1 ? 'طالبًا له درجة مرصودة' : 'طلاب لهم درجات مرصودة'} في هذه المهمة — ستُحذف درجاتهم. اضغط "حفظ التعديل" مرة أخرى للتأكيد.`);
      }
      if(plan.remove.length){
        const { error: rErr } = await sb.from('classroom_task_students').delete().eq('teacher_id', uid).eq('task_id', d.editId).in('student_id', plan.remove);
        if(rErr) throw rErr;
      }
      const { data: upd, error: uErr } = await sb.from('classroom_tasks').update(payload).eq('teacher_id', uid).eq('id', d.editId).select('id');
      if(uErr) throw uErr;
      if(!(upd || []).length) throw new Error('المهمة غير موجودة — ربما حُذفت من جهاز آخر');
      if(plan.add.length){
        const { error: aErr } = await sb.from('classroom_task_students').upsert(
          plan.add.map(sid => ({ teacher_id: uid, task_id: d.editId, student_id: sid })),
          { onConflict: 'task_id,student_id', ignoreDuplicates: true });
        if(aErr) throw aErr;
      }
    } else {
      const term = crmCurrentTerm();
      const { data, error } = await sb.from('classroom_tasks').insert(Object.assign({
        teacher_id: uid, section_id: d.sectionId, academic_year: term.year, semester: term.semester
      }, payload)).select('id').single();
      if(error) throw error;
      id = data.id;
      const { error: aErr } = await sb.from('classroom_task_students').insert(selected.map(sid => ({ teacher_id: uid, task_id: id, student_id: sid })));
      if(aErr){
        /* مهمة بلا مكلَّفين لا فائدة منها — تُزال ليعيد المعلم المحاولة نظيفة */
        await sb.from('classroom_tasks').delete().eq('teacher_id', uid).eq('id', id);
        throw aErr;
      }
    }
  } catch(e){
    unlock();
    return fail('تعذّر الحفظ: ' + taskDbErrorMessage(e));
  }
  crmTaskDraft = null;
  closeCrmModal();
  showToast(d.editId ? 'عُدّلت المهمة' : 'أُضيفت المهمة', 'ok');
  await afterCrmTaskChanged(d.sectionId, id);
}

/* بعد إضافة/تعديل/حذف: إعادة حساب عمود المهام ثم تحديث الشاشة الظاهرة فعلًا الآن */
async function afterCrmTaskChanged(sectionId, selectId){
  try{
    const term = crmCurrentTerm();
    const column = await findKindColumn(sectionId, term, 'task');
    if(column) await syncTaskColumn(column, sectionId, term);
  } catch(e){ showToast('تعذّر إعادة حساب عمود المهام — يُحدَّث عند فتح الكشف', 'error'); }
  if(crmSheet && crmSheet.sectionId === sectionId && crmSheet.mode === 'task'){
    renderCrmTasks(crmStudentsOfSection(sectionId), selectId);
  } else if(document.getElementById('crmTabGrades').style.display !== 'none'){
    await renderCrmGrades();
    if(crmGrades && crmGrades.sectionId === sectionId) openCrmTaskManager();
  }
}

/* ============ إدارة المهام (من عمود "مهام أدائية" في الكشف) ============ */
async function openCrmTaskManager(){
  if(!crmGrades) return;
  const sectionId = crmGrades.sectionId;
  let data;
  try{ data = await loadSectionTasks(sectionId, crmCurrentTerm()); }
  catch(e){ showToast('تعذّر تحميل المهام', 'error'); return; }
  const ids = crmStudentsOfSection(sectionId).map(s => s.id);
  const idx = taskRowsIndex(data.rows);
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">المهام الأدائية · ${escapeHtml(crmSectionLabel(sectionId))}</h3>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">العمود يُحسب تلقائيًا بالوزن: مجموع ما حصّله الطالب ÷ مجموع درجات مهامه المقيَّمة. من لم يُكلَّف بمهمة لا تُحسب عليه، والمهمة لا تُحسب حتى تُرصد درجتها. الرصد من ورقة الحصة ← "مهمة".</div>
      ${data.tasks.length ? data.tasks.slice().reverse().map(t => {
        const m = idx.get(t.id) || new Map();
        const c = taskGradeSummary(m, ids.filter(id => m.has(id)));
        return `<div class="crm-lesson-row"><span>${escapeHtml(t.title)} <span class="crm-tl-meta">· من ${formatScore(t.max_score)}${t.due_date ? ' · ' + shortDateAr(t.due_date) : ''}</span>
          <div class="crm-tl-meta">مكلّف ${c.total} · قُيّم ${c.graded}${c.avg === null ? '' : ' · المتوسط ' + formatScore(c.avg)}</div></span>
          <span style="display:flex;gap:4px;">
            <button class="crm-icon-btn" title="تعديل" onclick="openCrmTaskEditor('${t.id}')">✎</button>
            <button class="crm-icon-btn" title="حذف" onclick="deleteCrmTask('${t.id}', '${sectionId}')">🗑</button>
          </span></div>`;
      }).join('') : '<div class="crm-today-empty">لا مهام بعد.</div>'}
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:10px;" onclick="closeCrmModal();openCrmTaskModal('${sectionId}')">+ مهمة جديدة</button>
    </div>`, '460px');
}

/* يعمل من ورقة الحصة ومن الكشف — لا يعتمد على crmGrades */
let crmTaskDeleting = false;
async function deleteCrmTask(id, sectionId){
  if(crmTaskDeleting || !id || !sectionId) return;
  closeCrmModal();
  const ok = await showConfirm('حذف هذه المهمة؟ تُحذف معها درجات الطلاب فيها، ويُعاد حساب عمود المهام.');
  if(!ok || crmTaskDeleting) return;
  crmTaskDeleting = true;
  try{
    /* درجات قيد الحفظ على هذه المهمة تنتهي أولًا، لا تصطدم بحذفها */
    const s = crmSheet;
    if(s && s.task && s.task.queue) await Promise.all([...s.task.queue.values()]);
    const { data, error } = await sb.from('classroom_tasks').delete().eq('teacher_id', currentUser.id).eq('id', id).select('id');
    if(error) throw error;
    showToast((data || []).length ? 'حُذفت المهمة' : 'المهمة محذوفة مسبقًا', 'ok');
  } catch(e){
    showToast('تعذّر الحذف: ' + taskDbErrorMessage(e), 'error');
    return;
  } finally {
    crmTaskDeleting = false;
  }
  await afterCrmTaskChanged(sectionId, null);
}
