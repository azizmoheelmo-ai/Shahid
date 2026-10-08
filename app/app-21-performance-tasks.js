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
   - المهمة الجماعية: يقسّم المعلم المكلَّفين مجموعات (group_no)، ويرصد
     درجة واحدة للمجموعة تُعطى لكل أعضائها، ثم يعدّل درجة أي فرد منفردًا.
     الدرجة تبقى لكل طالب في صفه، فالعمود المحسوب لا يتغيّر منطقه.
   ============================================================ */

const TASK_QUICK_FRACTIONS = [['كاملة', 1], ['¾', 0.75], ['½', 0.5], ['¼', 0.25], ['0', 0]];
const TASK_GROUP_COUNT_FORMS = { one: 'مجموعة واحدة', two: 'مجموعتان', few: '{n} مجموعات', many: '{n} مجموعة' };

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

/* ============ المجموعات (دوال صرفة) ============ */
function taskGroupIndex(rows){
  const idx = new Map();
  (rows || []).forEach(r => {
    if(!idx.has(r.task_id)) idx.set(r.task_id, new Map());
    idx.get(r.task_id).set(r.student_id, r.group_no ? Number(r.group_no) : null);
  });
  return idx;
}

/* [{ no, members }] بترتيب أرقام المجموعات — لطلاب القائمة فقط وبترتيبها */
function taskGroupsList(groupMap, studentIds){
  const by = new Map();
  (studentIds || []).forEach(id => {
    const g = groupMap && groupMap.get(id);
    if(!g) return;
    if(!by.has(g)) by.set(g, []);
    by.get(g).push(id);
  });
  return [...by.keys()].sort((a, b) => a - b).map(no => ({ no, members: by.get(no) }));
}

/* توزيع متوازن على count مجموعات: بالترتيب، أو عشوائي بتمرير rand */
function distributeTaskGroups(studentIds, count, rand){
  const ids = (studentIds || []).slice();
  if(rand){
    for(let i = ids.length - 1; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  }
  const n = Math.max(1, Math.min(count || 1, ids.length || 1));
  const map = new Map();
  ids.forEach((id, i) => map.set(id, Math.floor(i * n / ids.length) + 1));
  return map;
}

/* أصغر مجموعة (الأقل أعضاء، ثم الأصغر رقمًا) لإضافة طالب جديد */
function smallestTaskGroup(groupMap, count){
  const sizes = new Array(count + 1).fill(0);
  groupMap.forEach(g => { if(g >= 1 && g <= count) sizes[g]++; });
  let best = 1;
  for(let g = 2; g <= count; g++) if(sizes[g] < sizes[best]) best = g;
  return best;
}

/* أرقام متتالية 1..k (تُسقط المجموعات الفارغة)، للطلاب المختارين فقط */
function normalizeTaskGroups(groupMap, selectedIds){
  const sel = new Set(selectedIds || []);
  const used = [...new Set([...groupMap.entries()].filter(([id, g]) => sel.has(id) && g).map(([, g]) => g))].sort((a, b) => a - b);
  const renum = new Map(used.map((g, i) => [g, i + 1]));
  const out = new Map();
  groupMap.forEach((g, id) => { if(sel.has(id) && g) out.set(id, renum.get(g)); });
  return out;
}

/* من تغيّرت مجموعته من المكلَّفين الباقين (groupMap = null: فردية → بلا مجموعة) */
function planTaskRegroup(currentRows, keepIds, groupMap){
  const keep = new Set(keepIds || []);
  const out = [];
  (currentRows || []).forEach(r => {
    if(!keep.has(r.student_id)) return;
    const want = groupMap ? (groupMap.get(r.student_id) || null) : null;
    const has = r.group_no ? Number(r.group_no) : null;
    if(want !== has) out.push({ student_id: r.student_id, group_no: want });
  });
  return out;
}

/* حالة درجة المجموعة: موحّدة (value)، أو مختلفة بين أعضائها (mixed) */
function taskGroupScoreState(members, scores){
  const vals = (members || []).map(id => scores.get(id));
  const graded = vals.filter(v => v !== null && v !== undefined);
  if(!graded.length) return { value: null, mixed: false, graded: 0 };
  const same = graded.length === vals.length && graded.every(v => v === graded[0]);
  return { value: same ? graded[0] : null, mixed: !same, graded: graded.length };
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
  const { data: tasks, error } = await sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, created_at, shahid_id')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester)
    .order('created_at', { ascending: true });
  if(error) throw error;
  let rows = [];
  for(const ids of chunkArray((tasks || []).map(t => t.id), 100)){
    const { data, error: rErr } = await sb.from('classroom_task_students').select('task_id, student_id, score, group_no')
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
function crmTaskCellHtml(st){
  return `<div class="crm-att-cell">
    <button type="button" class="crm-att-btn" id="crmTask_${st.id}" onclick="openCrmTaskScorePicker('${st.id}')">
      <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
  </div>`;
}

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
  const gidx = taskGroupIndex(data.rows);
  if(!data.tasks.length){
    s.task = { data, column, selectedId: null, scores: new Map(), groups: new Map(), queue: new Map(), term };
    body.innerHTML = head + `<div class="empty-state">لا مهام أدائية لهذه الشعبة بعد.</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="openCrmTaskModal()">+ مهمة جديدة</button>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  const selectedId = (selectId && data.tasks.some(t => t.id === selectId)) ? selectId : data.tasks[data.tasks.length - 1].id;
  const task = data.tasks.find(t => t.id === selectedId);
  const scores = idx.get(selectedId) || new Map();
  const groups = gidx.get(selectedId) || new Map();
  const assigned = students.filter(st => scores.has(st.id));
  const glist = taskGroupsList(groups, assigned.map(st => st.id));
  const ungrouped = glist.length ? assigned.filter(st => !groups.get(st.id)) : assigned;
  const byId = new Map(students.map(st => [st.id, st]));
  const isGroupTask = id => [...(gidx.get(id) || new Map()).values()].some(Boolean);
  s.task = { data, column, selectedId, scores, groups, queue: new Map(), term, pick: null };
  body.innerHTML = head + `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="goal-input" style="margin:0;flex:1;" onchange="renderCrmTasks(crmStudentsOfSection(crmSheet.sectionId), this.value)">
        ${data.tasks.map(t => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${escapeHtml(t.title)} · من ${formatScore(t.max_score)} · ${isGroupTask(t.id) ? 'جماعية' : 'لـ ' + (idx.get(t.id) || new Map()).size}</option>`).join('')}
      </select>
      <button class="btn btn-outline crm-mini-btn" title="تعديل المهمة أو حذفها" onclick="openCrmTaskEditor(crmSheet.task && crmSheet.task.selectedId)">✎ تعديل</button>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmTaskModal()">+ مهمة</button>
    </div>
    ${task.description ? `<div class="crm-task-desc">${escapeHtml(task.description)}</div>` : ''}
    <div id="crmTaskCounts" class="crm-sheet-counts"></div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">${glist.length ? 'اضغط على المجموعة لرصد درجة واحدة لكل أعضائها، أو على اسم طالب لتعديل درجته وحده' : 'اضغط على الطالب لرصد درجته'} من ${formatScore(task.max_score)}${task.due_date ? ' · التسليم ' + shortDateAr(task.due_date) : ''}. لا تُحسب المهمة للطالب حتى تُرصد درجته${column ? '، وتُحسب في عمود "' + escapeHtml(column.name) + '"' : ' (أضف عمود مهام أدائية في الكشف ليُحسب تلقائيًا)'}.</p>
    ${glist.map(g => `<div class="crm-task-group">
      <button type="button" class="crm-att-btn crm-task-group-head" id="crmTaskGroup_${g.no}" onclick="openCrmTaskScorePicker(null, ${g.no})">
        <span class="crm-att-name">المجموعة ${g.no} · ${arabicCountPhrase(g.members.length, CRM_STUDENT_COUNT_FORMS)}</span><span class="crm-att-state"></span></button>
      <div class="crm-att-grid">${g.members.map(id => crmTaskCellHtml(byId.get(id))).join('')}</div>
    </div>`).join('')}
    ${ungrouped.length ? `${glist.length ? '<div class="crm-tl-meta" style="margin:4px 0;">بلا مجموعة</div>' : ''}<div class="crm-att-grid">${ungrouped.map(crmTaskCellHtml).join('')}</div>` : ''}
    ${assigned.length ? '' : '<div class="empty-state">لا أحد من طلاب الشعبة مكلّف بهذه المهمة — اضغط "✎ تعديل" لاختيار الطلاب.</div>'}
    <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
  paintCrmTaskAll(assigned.map(st => st.id));
  paintCrmTaskCounts();
}

function crmSelectedTask(){
  const t = crmSheet && crmSheet.task;
  return t && t.selectedId ? t.data.tasks.find(x => x.id === t.selectedId) : null;
}

/* أعضاء مجموعة من طلاب الشعبة الحاليين المكلَّفين */
function crmTaskGroupMembers(groupNo){
  const t = crmSheet && crmSheet.task;
  if(!t) return [];
  return crmStudentsOfSection(crmSheet.sectionId).map(x => x.id).filter(id => t.scores.has(id) && t.groups.get(id) === groupNo);
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

function paintCrmTaskGroup(groupNo){
  const task = crmSelectedTask();
  const btn = document.getElementById('crmTaskGroup_' + groupNo);
  if(!btn || !task) return;
  const members = crmTaskGroupMembers(groupNo);
  const st = taskGroupScoreState(members, crmSheet.task.scores);
  btn.className = 'crm-att-btn crm-task-group-head ' + (st.mixed ? 'tk-mixed' : taskScoreTone(st.value, task.max_score));
  btn.querySelector('.crm-att-state').textContent = st.value !== null ? `${formatScore(st.value)} / ${formatScore(task.max_score)}`
    : st.mixed ? `درجات مختلفة · قُيّم ${st.graded} من ${members.length}` : 'لم تُقيَّم';
}

/* يعيد رسم الطلاب ومجموعاتهم */
function paintCrmTaskAll(studentIds){
  const t = crmSheet && crmSheet.task;
  if(!t) return;
  const groups = new Set();
  (studentIds || []).forEach(id => { paintCrmTask(id); const g = t.groups.get(id); if(g) groups.add(g); });
  groups.forEach(paintCrmTaskGroup);
}

function paintCrmTaskCounts(){
  const el = document.getElementById('crmTaskCounts');
  const task = crmSelectedTask();
  if(!el || !task) return;
  const t = crmSheet.task;
  const ids = crmStudentsOfSection(crmSheet.sectionId).map(x => x.id).filter(id => t.scores.has(id));
  const c = taskGradeSummary(t.scores, ids);
  const k = taskGroupsList(t.groups, ids).length;
  el.textContent = `قُيّم ${c.graded} من ${c.total}` + (k ? ' · ' + arabicCountPhrase(k, TASK_GROUP_COUNT_FORMS) : '') + (c.avg === null ? '' : ` · المتوسط ${formatScore(c.avg)} من ${formatScore(task.max_score)}`);
}

/* نافذة الرصد: لطالب واحد (studentId) أو لكل أعضاء مجموعة (groupNo) */
function openCrmTaskScorePicker(studentId, groupNo){
  const t = crmSheet && crmSheet.task;
  const task = crmSelectedTask();
  if(!task) return;
  let ids, title, sub = '', cur;
  if(groupNo){
    ids = crmTaskGroupMembers(groupNo);
    if(!ids.length) return;
    title = 'المجموعة ' + groupNo;
    sub = ids.map(id => { const st = crmStudents.find(x => x.id === id); return escapeHtml(st ? st.full_name : ''); }).join('، ');
    cur = taskGroupScoreState(ids, t.scores).value;
  } else {
    if(!t.scores.has(studentId)) return;
    ids = [studentId];
    const st = crmStudents.find(x => x.id === studentId);
    title = st ? st.full_name : '';
    cur = t.scores.get(studentId);
  }
  const anyGraded = ids.some(id => t.scores.get(id) !== null && t.scores.get(id) !== undefined);
  t.pick = { taskId: task.id, studentIds: ids };
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${escapeHtml(title)}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:${groupNo ? 4 : 10}px;">${escapeHtml(task.title)} · من ${formatScore(task.max_score)}</div>
      ${groupNo ? `<div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;line-height:1.7;">تُعطى الدرجة لكل الأعضاء (${ids.length}): ${sub}. ثم اضغط على اسم أي طالب لتعديل درجته وحده.</div>` : ''}
      <div class="crm-task-chips">
        ${taskQuickScores(task.max_score).map(q => `<button type="button" class="btn btn-outline${cur === q.value ? ' is-on' : ''}" onclick="applyCrmTaskScore(${q.value})">${q.label}<small>${formatScore(q.value)}</small></button>`).join('')}
      </div>
      <label class="crm-field-label">أو درجة دقيقة</label>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <input class="goal-input" id="crmTaskScoreInput" inputmode="decimal" style="margin:0;flex:1;" value="${cur === null || cur === undefined ? '' : formatScore(cur)}" placeholder="من ${formatScore(task.max_score)}">
        <button class="btn btn-primary" onclick="saveCrmTaskScoreInput()">حفظ</button>
      </div>
      <div id="crmTaskScoreError" style="display:none;color:#8A2C2C;font-size:12px;margin-bottom:6px;"></div>
      ${anyGraded ? `<button class="btn btn-outline" style="width:100%;justify-content:center;" onclick="applyCrmTaskScore(null)">مسح التقييم (لم يُقيَّم)${groupNo ? ' لكل الأعضاء' : ''}</button>` : ''}
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
  /* المختار تغيّر بعد فتح النافذة: لا نكتب على مهمة أخرى */
  if(!p || t.selectedId !== p.taskId) return;
  t.pick = null;
  const ids = p.studentIds.filter(id => t.scores.has(id));
  const prev = new Map(ids.map(id => [id, t.scores.get(id)]));
  const changed = ids.filter(id => prev.get(id) !== score);
  if(!changed.length) return;
  changed.forEach(id => t.scores.set(id, score));
  paintCrmTaskAll(changed);
  paintCrmTaskCounts();
  persistCrmTaskScores(changed, score, prev);
}

/* حفظ درجة (طالب أو أعضاء مجموعة) ثم إعادة حساب عمودهم — بعد أي حفظ معلّق لهم */
function persistCrmTaskScores(ids, score, prev){
  const s = crmSheet;
  const t = s.task;
  const taskId = t.selectedId;
  /* يُعاد العرض لما كان، ما لم تتغيّر الدرجة بنقرة أحدث */
  const revert = list => {
    if(crmSheet !== s || t.selectedId !== taskId) return;
    const back = list.filter(id => t.scores.get(id) === score);
    back.forEach(id => t.scores.set(id, prev.get(id)));
    paintCrmTaskAll(back);
    paintCrmTaskCounts();
  };
  const before = Promise.all(ids.map(id => t.queue.get(id) || Promise.resolve()));
  const next = before.then(async () => {
    const uid = currentUser.id;
    let saved;
    try{
      let q = sb.from('classroom_task_students').update({ score }).eq('teacher_id', uid).eq('task_id', taskId);
      q = ids.length === 1 ? q.eq('student_id', ids[0]) : q.in('student_id', ids);
      const { data, error } = await q.select('student_id');
      if(error) throw error;
      saved = (data || []).map(r => r.student_id);
      if(!saved.length) throw new Error((ids.length === 1 ? 'الطالب لم يعد مكلّفًا' : 'الطلاب لم يعودوا مكلّفين') + ' بهذه المهمة — ربما عُدّلت من جهاز آخر');
    } catch(e){
      revert(ids);
      showToast('لم تُحفظ الدرجة: ' + taskDbErrorMessage(e), 'error');
      return;
    }
    const missing = ids.filter(id => !saved.includes(id));
    if(missing.length){
      revert(missing);
      showToast(`لم تُحفظ درجة ${missing.length} — لم يعودوا مكلّفين بهذه المهمة. حدّث الورقة.`, 'error');
    }
    t.data.rows.forEach(r => { if(r.task_id === taskId && saved.includes(r.student_id)) r.score = score; });
    try{ await syncTaskColumn(t.column, s.sectionId, t.term, saved); }
    catch(e){ showToast('حُفظت الدرجة، وتعذّر تحديث عمود المهام — يُحدَّث عند فتح الكشف', 'error'); }
  });
  ids.forEach(id => t.queue.set(id, next));
  return next;
}

/* ============ إضافة/تعديل مهمة ============ */
let crmTaskDraft = null; /* { sectionId, editId?, selected: Set, groups: Map|null, groupCount, saving, confirmRemoval? } */
const CRM_TASK_MAX_GROUPS = 20;

function crmTaskDraftOrdered(){
  const d = crmTaskDraft;
  return crmStudentsOfSection(d.sectionId).map(x => x.id).filter(id => d.selected.has(id));
}

function crmTaskGroupsHtml(){
  const d = crmTaskDraft;
  if(!d || !d.groups) return '';
  const ordered = crmTaskDraftOrdered();
  const nameOf = id => { const st = crmStudents.find(x => x.id === id); return escapeHtml(st ? st.full_name : ''); };
  let html = `<div style="display:flex;align-items:center;gap:6px;margin:10px 0 6px;">
      <span class="crm-field-label" style="margin:0;flex:1;">المجموعات</span>
      <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskGroupCount(-1)" aria-label="أقل">−</button>
      <b style="min-width:18px;text-align:center;">${d.groupCount}</b>
      <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskGroupCount(1)" aria-label="أكثر">+</button>
      <button type="button" class="btn btn-outline crm-mini-btn" onclick="shuffleCrmTaskGroups()">🔀 عشوائي</button>
    </div>`;
  if(!ordered.length) return html + '<div class="crm-today-empty">اختر الطلاب أولًا، ثم وزّعهم على المجموعات.</div>';
  for(let no = 1; no <= d.groupCount; no++){
    const members = ordered.filter(id => d.groups.get(id) === no);
    html += `<div class="crm-task-group-edit"><div class="crm-tl-meta">المجموعة ${no} · ${members.length ? arabicCountPhrase(members.length, CRM_STUDENT_COUNT_FORMS) : 'فارغة'}</div>
      ${members.map(id => `<button type="button" class="crm-task-pick is-on" onclick="cycleCrmTaskGroup('${id}')">${nameOf(id)}</button>`).join('')}
    </div>`;
  }
  return html + '<div style="font-size:11px;color:var(--muted);margin-top:4px;">اضغط على اسم الطالب لنقله للمجموعة التالية.</div>';
}

function paintCrmTaskGroupsBox(){
  const box = document.getElementById('crmTaskGroupsBox');
  if(box) box.innerHTML = crmTaskGroupsHtml();
  const d = crmTaskDraft;
  ['Ind', 'Grp'].forEach(k => {
    const b = document.getElementById('crmTaskMode' + k);
    if(b) b.className = (k === 'Grp') === !!(d && d.groups) ? 'is-on' : '';
  });
}

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
      <div class="crm-seg" style="margin-bottom:8px;">
        <button type="button" id="crmTaskModeInd" class="${d.groups ? '' : 'is-on'}" onclick="setCrmTaskGroupMode(false)">فردية</button>
        <button type="button" id="crmTaskModeGrp" class="${d.groups ? 'is-on' : ''}" onclick="setCrmTaskGroupMode(true)">جماعية</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <label class="crm-field-label" style="margin:0;flex:1;">الطلاب المكلّفون · <span id="crmTaskPickCount">${d.selected.size}</span></label>
        <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskPickAll(true)">الكل</button>
        <button type="button" class="btn btn-outline crm-mini-btn" onclick="setCrmTaskPickAll(false)">لا أحد</button>
      </div>
      ${students.length ? `<div class="crm-task-pick-grid">
        ${students.map(st => `<button type="button" class="crm-task-pick${d.selected.has(st.id) ? ' is-on' : ''}" id="crmTaskPick_${st.id}" onclick="toggleCrmTaskPick('${st.id}')">${escapeHtml(st.full_name)}</button>`).join('')}
      </div>` : '<div class="crm-today-empty">لا طلاب في هذه الشعبة.</div>'}
      <div id="crmTaskGroupsBox">${crmTaskGroupsHtml()}</div>
      <div id="crmTaskError" style="display:none;color:#8A2C2C;font-size:12px;margin:8px 0;line-height:1.7;"></div>
      <button class="btn btn-primary" id="crmTaskSaveBtn" style="width:100%;justify-content:center;margin-top:10px;" onclick="saveCrmTask()">${task ? 'حفظ التعديل' : 'حفظ المهمة'}</button>
      ${task ? `<button class="btn btn-outline" style="width:100%;justify-content:center;margin-top:8px;" onclick="openShahidDraftFromTask('${task.id}')">📄 حوّل إلى شاهد${task.shahid_id ? ' (موثّقة مسبقًا)' : ''}</button>` : ''}
      ${task ? `<button class="btn btn-outline" id="crmTaskDeleteBtn" style="width:100%;justify-content:center;margin-top:8px;color:#8A2C2C;" onclick="deleteCrmTask('${task.id}', '${sectionId}')">حذف المهمة</button>` : ''}
    </div>`;
}

function openCrmTaskModal(sectionIdArg){
  const sectionId = sectionIdArg || (crmSheet && crmSheet.sectionId) || (crmGrades && crmGrades.sectionId);
  if(!sectionId) return;
  crmTaskDraft = { sectionId, selected: new Set(), groups: null, groupCount: 2, saving: false };
  showInfoModal(crmTaskFormHtml(sectionId, null), '460px');
}

/* يقرأ المهمة ومكلَّفيها ومجموعاتهم من القاعدة مباشرة (لا من نسخة محلية قد تكون قديمة) */
let crmTaskEditorOpening = false;
async function openCrmTaskEditor(taskId){
  if(!taskId || crmTaskEditorOpening) return;
  crmTaskEditorOpening = true;
  let tRes, rRes;
  try{
    [tRes, rRes] = await Promise.all([
      sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, shahid_id').eq('teacher_id', currentUser.id).eq('id', taskId).maybeSingle(),
      sb.from('classroom_task_students').select('student_id, group_no').eq('teacher_id', currentUser.id).eq('task_id', taskId)
    ]);
  } catch(e){ tRes = { error: e }; }
  finally { crmTaskEditorOpening = false; }
  if(tRes.error || (rRes && rRes.error)){ showToast('تعذّر تحميل المهمة', 'error'); return; }
  if(!tRes.data){ showToast('المهمة غير موجودة — ربما حُذفت من جهاز آخر', 'error'); return; }
  const task = tRes.data;
  const rows = rRes.data || [];
  const grouped = rows.filter(r => r.group_no);
  closeCrmModal();
  crmTaskDraft = {
    sectionId: task.section_id, editId: task.id, selected: new Set(rows.map(r => r.student_id)), saving: false,
    groups: grouped.length ? new Map(grouped.map(r => [r.student_id, Number(r.group_no)])) : null,
    groupCount: grouped.length ? Math.max(...grouped.map(r => Number(r.group_no))) : 2
  };
  showInfoModal(crmTaskFormHtml(task.section_id, task), '460px');
}

function paintCrmTaskPickCount(){
  const el = document.getElementById('crmTaskPickCount');
  if(el && crmTaskDraft) el.textContent = crmTaskDraft.selected.size;
}

function toggleCrmTaskPick(studentId){
  const d = crmTaskDraft;
  if(!d || d.saving) return;
  if(d.selected.has(studentId)){
    d.selected.delete(studentId);
    if(d.groups) d.groups.delete(studentId);
  } else {
    d.selected.add(studentId);
    if(d.groups) d.groups.set(studentId, smallestTaskGroup(d.groups, d.groupCount));
  }
  d.confirmRemoval = null;
  const btn = document.getElementById('crmTaskPick_' + studentId);
  if(btn) btn.className = 'crm-task-pick' + (d.selected.has(studentId) ? ' is-on' : '');
  paintCrmTaskPickCount();
  if(d.groups) paintCrmTaskGroupsBox();
}

function setCrmTaskPickAll(on){
  const d = crmTaskDraft;
  if(!d || d.saving) return;
  crmStudentsOfSection(d.sectionId).forEach(st => {
    if(on){
      if(!d.selected.has(st.id)){
        d.selected.add(st.id);
        if(d.groups) d.groups.set(st.id, smallestTaskGroup(d.groups, d.groupCount));
      }
    } else {
      d.selected.delete(st.id);
      if(d.groups) d.groups.delete(st.id);
    }
    const btn = document.getElementById('crmTaskPick_' + st.id);
    if(btn) btn.className = 'crm-task-pick' + (on ? ' is-on' : '');
  });
  d.confirmRemoval = null;
  paintCrmTaskPickCount();
  if(d.groups) paintCrmTaskGroupsBox();
}

/* جماعية: توزيع المختارين بالترتيب على عدد مناسب (نحو 4 في كل مجموعة) */
function setCrmTaskGroupMode(on){
  const d = crmTaskDraft;
  if(!d || d.saving || on === !!d.groups) return;
  if(on){
    const ordered = crmTaskDraftOrdered();
    d.groupCount = Math.max(1, Math.min(CRM_TASK_MAX_GROUPS, Math.round(ordered.length / 4) || 1));
    d.groups = distributeTaskGroups(ordered, d.groupCount);
  } else {
    d.groups = null;
  }
  paintCrmTaskGroupsBox();
}

function setCrmTaskGroupCount(delta){
  const d = crmTaskDraft;
  if(!d || d.saving || !d.groups) return;
  const n = Math.max(1, Math.min(CRM_TASK_MAX_GROUPS, d.groupCount + delta));
  if(n === d.groupCount) return;
  d.groupCount = n;
  /* تغيير العدد يعيد التوزيع المتوازن بالترتيب — ثم يعدّل المعلم بالنقر على الأسماء */
  d.groups = distributeTaskGroups(crmTaskDraftOrdered(), n);
  paintCrmTaskGroupsBox();
}

function shuffleCrmTaskGroups(){
  const d = crmTaskDraft;
  if(!d || d.saving || !d.groups) return;
  d.groups = distributeTaskGroups(crmTaskDraftOrdered(), d.groupCount, Math.random);
  paintCrmTaskGroupsBox();
}

function cycleCrmTaskGroup(studentId){
  const d = crmTaskDraft;
  if(!d || d.saving || !d.groups || !d.selected.has(studentId)) return;
  d.groups.set(studentId, ((d.groups.get(studentId) || 0) % d.groupCount) + 1);
  paintCrmTaskGroupsBox();
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
  const groups = d.groups ? normalizeTaskGroups(d.groups, selected) : null;
  if(groups && selected.some(id => !groups.get(id))) return fail('وزّع كل الطلاب المختارين على المجموعات');
  const groupOf = id => (groups && groups.get(id)) || null;
  d.saving = true;
  const btns = ['crmTaskSaveBtn', 'crmTaskDeleteBtn'].map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; });
  const unlock = () => { d.saving = false; btns.forEach(b => { b.disabled = false; }); };
  const uid = currentUser.id;
  const payload = { title, description, max_score: Math.round(max * 100) / 100, due_date: due };
  let id = d.editId;
  try{
    if(d.editId){
      const { data: cur, error: cErr } = await sb.from('classroom_task_students').select('student_id, score, group_no').eq('teacher_id', uid).eq('task_id', d.editId);
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
      /* تغيير المجموعات لا يمسّ الدرجات المرصودة */
      const byGroup = new Map();
      planTaskRegroup(cur, selected, groups).forEach(r => {
        const k = r.group_no === null ? 'none' : r.group_no;
        if(!byGroup.has(k)) byGroup.set(k, []);
        byGroup.get(k).push(r.student_id);
      });
      for(const [k, ids] of byGroup){
        const { error: gErr } = await sb.from('classroom_task_students').update({ group_no: k === 'none' ? null : k })
          .eq('teacher_id', uid).eq('task_id', d.editId).in('student_id', ids);
        if(gErr) throw gErr;
      }
      if(plan.add.length){
        const { error: aErr } = await sb.from('classroom_task_students').upsert(
          plan.add.map(sid => ({ teacher_id: uid, task_id: d.editId, student_id: sid, group_no: groupOf(sid) })),
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
      const { error: aErr } = await sb.from('classroom_task_students').insert(selected.map(sid => ({ teacher_id: uid, task_id: id, student_id: sid, group_no: groupOf(sid) })));
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
  const gidx = taskGroupIndex(data.rows);
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">المهام الأدائية · ${escapeHtml(crmSectionLabel(sectionId))}</h3>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">العمود يُحسب تلقائيًا بالوزن: مجموع ما حصّله الطالب ÷ مجموع درجات مهامه المقيَّمة. من لم يُكلَّف بمهمة لا تُحسب عليه، والمهمة لا تُحسب حتى تُرصد درجتها. الرصد من ورقة الحصة ← "مهمة".</div>
      ${data.tasks.length ? data.tasks.slice().reverse().map(t => {
        const m = idx.get(t.id) || new Map();
        const c = taskGradeSummary(m, ids.filter(id => m.has(id)));
        const k = taskGroupsList(gidx.get(t.id) || new Map(), ids).length;
        return `<div class="crm-lesson-row"><span>${escapeHtml(t.title)} <span class="crm-tl-meta">· من ${formatScore(t.max_score)}${k ? ' · جماعية (' + arabicCountPhrase(k, TASK_GROUP_COUNT_FORMS) + ')' : ''}${t.due_date ? ' · ' + shortDateAr(t.due_date) : ''}</span>
          <div class="crm-tl-meta">مكلّف ${c.total} · قُيّم ${c.graded}${c.avg === null ? '' : ' · المتوسط ' + formatScore(c.avg)}${t.shahid_id ? ' · 📄 موثّقة كشاهد' : ''}</div></span>
          <span style="display:flex;gap:4px;">
            <button class="crm-icon-btn" title="حوّل إلى شاهد" onclick="openShahidDraftFromTask('${t.id}')">📄</button>
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

/* ============ المهمة شاهدًا (تنوع أساليب التقويم) ============ */
/* مسودة بلا أسماء طلاب: وصف المهمة، والمكلَّفون، وتوزيع الدرجات. الملاحظة
   النوعية والصورة يضيفهما المعلم. */
function buildTaskShahidDraft(o){
  const t = o.task;
  const rows = o.rows || [];
  const max = Number(t.max_score);
  const n = rows.length;
  const graded = rows.filter(r => r.score !== null && r.score !== undefined);
  const vals = graded.map(r => Number(r.score));
  const avg = vals.length ? Math.round(100 * vals.reduce((a, b) => a + b, 0) / vals.length) / 100 : null;
  const high = vals.filter(v => v / max >= 0.75).length;
  const mid = vals.filter(v => v / max >= 0.5 && v / max < 0.75).length;
  const low = vals.length - high - mid;
  const groupNos = [...new Set(rows.map(r => r.group_no).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const who = arabicCountPhrase(n, CRM_STUDENT_COUNT_FORMS) + (o.sectionLabel ? ' في ' + o.sectionLabel : '');
  const groupsPhrase = groupNos.length ? arabicCountPhrase(groupNos.length, TASK_GROUP_COUNT_FORMS) : '';
  let quant = `قُيّم ${vals.length} من ${n}` + (avg === null ? '' : ` · المتوسط ${formatScore(avg)} من ${formatScore(max)} (${Math.round(100 * avg / max)}%)`)
    + `\nأتقن (75% فأكثر): ${high} · متوسط (50–74%): ${mid} · يحتاج دعمًا (أقل من 50%): ${low}`;
  if(groupNos.length){
    quant += '\n' + groupNos.map(g => {
      const gv = graded.filter(r => Number(r.group_no) === g).map(r => Number(r.score));
      return `المجموعة ${g}: ${gv.length ? formatScore(Math.round(100 * gv.reduce((a, b) => a + b, 0) / gv.length) / 100) + ' من ' + formatScore(max) : 'لم تُقيَّم'}`;
    }).join(' · ');
  }
  const pending = n - vals.length;
  return {
    elementKey: 'تنوع أساليب التقويم',
    title: 'مهمة أدائية: ' + t.title,
    classLabel: o.sectionLabel || '',
    date: t.due_date && t.due_date <= o.todayIso ? t.due_date : o.todayIso,
    description: `نفّذتُ مع ${who} مهمة أدائية ${groupNos.length ? 'جماعية (' + groupsPhrase + ')' : 'فردية'}: ${t.title}.${t.description ? ' ' + t.description : ''}`,
    goal: 'تقويم أداء الطلاب بمهمة تطبيقية تقيس قدرتهم على توظيف ما تعلّموه، وتنويع مصادر الدرجة إلى جانب الاختبارات.',
    steps: [
      `تصميم المهمة وتحديد درجتها (${formatScore(max)})`,
      groupNos.length ? `توزيع ${who} على ${groupsPhrase}` : `تكليف ${who} بأسمائهم`,
      t.due_date ? `تحديد موعد التسليم ${t.due_date}` : null,
      'رصد درجات المهمة وتحليل توزيعها'
    ].filter(Boolean),
    quant,
    qual: '',
    reflection: [
      low ? `${arabicCountPhrase(low, CRM_STUDENT_COUNT_FORMS)} دون 50% — ${low === 1 ? 'يحتاج' : low === 2 ? 'يحتاجان' : 'يحتاجون'} دعمًا في هذه المهارة.` : '',
      pending ? `بقي ${arabicCountPhrase(pending, CRM_STUDENT_COUNT_FORMS)} ${pending === 1 ? 'لم يُقيَّم' : pending === 2 ? 'لم يُقيَّما' : 'لم يُقيَّموا'} بعد.` : ''
    ].filter(Boolean).join(' ')
  };
}

let crmTaskShahidBusy = false;
async function openShahidDraftFromTask(taskId){
  if(crmTaskShahidBusy || !taskId) return;
  crmTaskShahidBusy = true;
  const uid = currentUser.id;
  try{
    const [tRes, rRes] = await Promise.all([
      sb.from('classroom_tasks').select('id, section_id, title, description, max_score, due_date, shahid_id').eq('teacher_id', uid).eq('id', taskId).maybeSingle(),
      sb.from('classroom_task_students').select('student_id, score, group_no').eq('teacher_id', uid).eq('task_id', taskId)
    ]);
    if(tRes.error || rRes.error){ showToast('تعذّر تحميل المهمة', 'error'); return; }
    if(!tRes.data){ showToast('المهمة غير موجودة — ربما حُذفت من جهاز آخر', 'error'); return; }
    const task = tRes.data;
    const rows = rRes.data || [];
    if(!rows.some(r => r.score !== null && r.score !== undefined)){
      showToast('ارصد درجات المهمة أولًا — الشاهد يقوم على نتائجها', 'error');
      return;
    }
    closeCrmModal();
    if(task.shahid_id && !(await showConfirm('هذه المهمة موثّقة كشاهد مسبقًا. فتح مسودة شاهد جديد منها؟'))) return;
    const draft = buildTaskShahidDraft({ task, rows, sectionLabel: crmSectionById(task.section_id) ? crmSectionLabel(task.section_id) : '', todayIso: localIsoDate() });
    startNewShahid();
    taskShahidContext = { taskId: task.id };
    document.getElementById('mLesson').value = draft.title;
    document.getElementById('mClass').value = draft.classLabel;
    document.getElementById('mDate').value = draft.date;
    elementSelect.value = draft.elementKey;
    updateExample();
    fillShahidFields({ description: draft.description, goal: draft.goal, steps: draft.steps, quant: draft.quant, qual: draft.qual, reflection: draft.reflection });
    formDirty = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('مسودة الشاهد جاهزة — أضف ملاحظتك وصورة من عمل الطلاب ثم احفظ', 'ok');
  } catch(e){
    showToast('تعذّر إنشاء المسودة: ' + (e.message || ''), 'error');
  } finally {
    crmTaskShahidBusy = false;
  }
}

/* بعد حفظ الشاهد (من saveShahid) */
async function linkTaskToShahid(taskId, shahidId){
  const { error } = await sb.from('classroom_tasks').update({ shahid_id: shahidId }).eq('teacher_id', currentUser.id).eq('id', taskId);
  if(error) showToast('حُفظ الشاهد، لكن تعذّر ربطه بالمهمة', 'error');
}

/* ============ مهام الطالب (الملف والتقرير) ============ */
/* كل مهامه في الفصل المعروض — ولو في شعبة سابقة (نفس منطق العمود المحسوب) */
async function loadStudentTasks(studentId, term){
  const uid = currentUser.id;
  const { data: rows, error } = await sb.from('classroom_task_students').select('task_id, score, group_no')
    .eq('teacher_id', uid).eq('student_id', studentId);
  if(error) throw error;
  if(!(rows || []).length) return [];
  const { data: tasks, error: tErr } = await sb.from('classroom_tasks').select('id, title, max_score, due_date, created_at')
    .eq('teacher_id', uid).eq('academic_year', term.year).eq('semester', term.semester).in('id', rows.map(r => r.task_id));
  if(tErr) throw tErr;
  const byId = new Map(rows.map(r => [r.task_id, r]));
  return (tasks || []).map(t => Object.assign({}, t, {
    score: byId.get(t.id).score === null || byId.get(t.id).score === undefined ? null : Number(byId.get(t.id).score),
    group_no: byId.get(t.id).group_no || null
  })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

function studentTaskLines(tasks){
  return (tasks || []).map(t => ({
    title: t.title + (t.group_no ? ' (جماعية · المجموعة ' + t.group_no + ')' : ''),
    result: t.score === null ? 'لم يُقيَّم' : formatScore(t.score) + ' من ' + formatScore(t.max_score)
  }));
}
