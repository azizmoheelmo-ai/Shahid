'use strict';
/* ============================================================
   (13) المهام — الدفعة الثانية من ميزة التقويم الدراسي
   ------------------------------------------------------------
   كيان شخصي بسيط (عنوان/وصف اختياري/أولوية/تاريخ استحقاق/حالة إنجاز)،
   مع ربط اختياري بهدف أداء أو برنامج نشاط — FK حقيقي بعمودين منفصلين
   (linked_goal_id/linked_program_id)، يُنظَّف تلقائيًا (on delete set
   null) لو حُذف الهدف/البرنامج المرتبط، بدل ترك مرجع يتيم.

   تظهر أيضًا كنقطة زرقاء على شاشة "التقويم الدراسي" (app-12-calendar.js)
   بتاريخ استحقاقها — راجع التعديل على loadUserCalendarMarkers هناك.
   ============================================================ */

let myTasks = [];
let editingTaskId = null;

const TASK_PRIORITY_LABELS = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' };

/* فلترة صريحة بـuser_id ضرورية — نفس سبب فلترة loadActivityPrograms/
   loadMyShawahid (tasks لا تحمل سياسة "المسؤول يشوف الكل" أصلًا، لكن
   الانضباط نفسه يُطبَّق دائمًا بلا استثناء بهذا المشروع). */
async function loadMyTasks(){
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('tasks')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .range(from, to));
  myTasks = error ? [] : (data || []);
  return !error;
}

async function showTasks(){
  hideAllMainViews();
  setActiveBottomTab('work');
  document.getElementById('tasksView').style.display = 'block';
  showTasksSection('list');
  closeProgramMenus();
  document.getElementById('tasksListBody').innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  await loadMyTasks();
  renderTasksList();
}

function showTasksSection(section){
  document.getElementById('tasksListSection').style.display = section === 'list' ? 'block' : 'none';
  document.getElementById('tasksFormSection').style.display = section === 'form' ? 'block' : 'none';
}

function formatTaskDueDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ترتيب العرض: غير المُنجَزة قبل المُنجَزة، والأقرب استحقاقًا أولًا ضمن
   كل مجموعة (بلا تاريخ استحقاق تُعرَض أخيرًا ضمن مجموعتها) — دالة صرفة
   قابلة للاختبار بمعزل. */
function sortTasksForDisplay(tasks){
  return [...(tasks || [])].sort((a, b) => {
    if(!!a.done !== !!b.done) return a.done ? 1 : -1;
    if(!a.due_date && !b.due_date) return 0;
    if(!a.due_date) return 1;
    if(!b.due_date) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });
}

/* مهام "تحتاج إجراء" لبطاقة "يحتاج إجراء الآن" بالرئيسية: غير منجزة ولها
   تاريخ استحقاق لا يتجاوز cutoffIso (يشمل المتأخرة فعلًا، لأن تاريخها
   أقدم من اليوم فهو بالتأكيد ≤ أي سقف لاحق). دالة صرفة: المستدعي يحسب
   cutoffIso (اليوم + مهلة الأيام) ويمرّره صراحة، بلا اعتماد على Date()
   الحقيقي داخلها، لتسهيل الاختبار. */
function countTasksNeedingAttention(tasks, cutoffIso){
  return (tasks || []).filter(t => !t.done && t.due_date && t.due_date <= cutoffIso).length;
}

let tasksFilter = 'all'; /* all | open | done */
function setTasksFilter(f){
  tasksFilter = f;
  renderTasksList();
}

/* نافذة "تستحق قريبًا" بالأيام (غير المتأخرة) لشريط التنبيه الذهبي */
const TASKS_SOON_DAYS = 3;

/* فرق الأيام بين تاريخين YYYY-MM-DD (محلي بلا UTC). دالة صرفة. */
function taskDaysUntil(dueIso, todayIso){
  const [y1, m1, d1] = dueIso.split('-').map(Number);
  const [y2, m2, d2] = todayIso.split('-').map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

/* موعد بلغة المعلم: اليوم/غدًا/بعد N أيام للقريب (حتى 10 أيام)، وإلا التاريخ الكامل */
function taskDueText(dueIso, todayIso){
  const n = taskDaysUntil(dueIso, todayIso);
  if(n === 0) return 'اليوم';
  if(n === 1) return 'غدًا';
  if(n === 2) return 'بعد يومين';
  if(n >= 3 && n <= 10) return 'بعد ' + n + ' أيام';
  return formatTaskDueDate(dueIso);
}

function taskCardHtml(t, todayIso){
  const id = escapeHtml(String(t.id));
  const overdue = !t.done && t.due_date && t.due_date < todayIso;
  const prioCls = t.priority === 'high' ? 'high' : (t.priority === 'low' ? 'low' : 'med');
  const linkedLabel = t.linked_goal_id ? '🎯 مرتبطة بهدف أداء' : (t.linked_program_id ? '🟡 مرتبطة ببرنامج نشاط' : '');
  const dueLabel = t.due_date
    ? (overdue ? '⚠ تجاوز الاستحقاق: ' + escapeHtml(formatTaskDueDate(t.due_date)) : 'الاستحقاق: ' + escapeHtml(taskDueText(t.due_date, todayIso)))
    : 'بلا تاريخ استحقاق';
  return `<div class="pg-card ${t.done ? 'tk-done' : ''}" onclick="editTask('${id}')">
    <div class="pg-card-hd">
      <input type="checkbox" class="tk-chk" aria-label="تمّت" ${t.done ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleTaskDone('${id}', this.checked)">
      <div class="pg-card-ttl">${escapeHtml(t.title)}</div>
      ${t.done ? '' : `<span class="pg-chip ${overdue ? 'late' : prioCls}">${escapeHtml(TASK_PRIORITY_LABELS[t.priority] || t.priority)}</span>`}
      <div class="pg-menu-wrap">
        <button type="button" class="sh-icon-btn" style="width:34px;height:34px;" aria-label="المزيد" onclick="toggleProgramMenu('tkMenu-${id}', event)">⋯</button>
        <div class="pg-menu" id="tkMenu-${id}" style="display:none;" onclick="event.stopPropagation()">
          <button type="button" onclick="closeProgramMenus(); editTask('${id}')">✎ تعديل</button>
          <button type="button" class="dng" onclick="closeProgramMenus(); deleteTask('${id}')">🗑 حذف المهمة</button>
        </div>
      </div>
    </div>
    <div class="pg-meta" style="margin:4px 0 0 0;${overdue ? 'color:#B23A3A;font-weight:700;' : ''}">${dueLabel}${linkedLabel ? ' · ' + escapeHtml(linkedLabel) : ''}</div>
  </div>`;
}

function renderTasksList(){
  const body = document.getElementById('tasksListBody');
  if(!myTasks.length){
    body.innerHTML = `<div class="friendly-empty"><div class="fe-icon">✅</div>
      <div class="fe-title">لا توجد مهام بعد</div>
      <p class="fe-sub">أضف مهمتك الأولى وتابع إنجازها من هنا.</p></div>`;
    return;
  }
  const todayIso = localIsoDate(); /* محلي لا UTC: بعد منتصف الليل وقبل الثالثة فجرًا يعطي UTC تاريخ الأمس */
  const sorted = sortTasksForDisplay(myTasks);
  const open = sorted.filter(t => !t.done);
  const done = sorted.filter(t => t.done);
  const lateCount = open.filter(t => t.due_date && t.due_date < todayIso).length;

  /* قريبة = غير منجزة وغير متأخرة وتستحق خلال TASKS_SOON_DAYS (تشمل اليوم) */
  const soonCount = countTasksNeedingAttention(open, addDaysIso(todayIso, TASKS_SOON_DAYS)) - lateCount;
  const lateHtml = lateCount
    ? `<div class="pg-now" style="border-right-color:#B23A3A;"><div class="pg-now-t"><b>${lateCount === 1 ? 'مهمة واحدة تجاوزت الاستحقاق' : lateCount === 2 ? 'مهمتان تجاوزتا الاستحقاق' : lateCount + ' مهام تجاوزت الاستحقاق'}</b></div></div>`
    : '';
  const soonHtml = soonCount > 0
    ? `<div class="pg-now"><div class="pg-now-t"><b>${soonCount === 1 ? 'مهمة واحدة تستحق' : soonCount === 2 ? 'مهمتان تستحقان' : soonCount + ' مهام تستحق'} خلال ${TASKS_SOON_DAYS} أيام</b></div></div>`
    : '';
  const nowHtml = lateHtml + soonHtml;
  const pill = (key, label, n) => `<button type="button" class="pg-pill ${tasksFilter === key ? 'is-on' : ''}" onclick="setTasksFilter('${key}')">${label} ${n}</button>`;
  const pills = `<div class="pg-pills">${pill('all', 'الكل', myTasks.length)}${pill('open', 'مفتوحة', open.length)}${pill('done', 'منجزة', done.length)}</div>`;

  let cards = '';
  if(tasksFilter !== 'done') cards += open.map(t => taskCardHtml(t, todayIso)).join('');
  if(done.length && tasksFilter !== 'open'){
    if(tasksFilter === 'all') cards += `<div class="pg-sechd">منجزة (${done.length})</div>`;
    cards += done.map(t => taskCardHtml(t, todayIso)).join('');
  }
  if(!cards) cards = '<div class="empty-state">لا توجد مهام في هذا التصنيف.</div>';
  body.innerHTML = nowHtml + pills + cards;
}

async function toggleTaskDone(id, done){
  const { error } = await sb.from('tasks').update({ done }).eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر التحديث: ' + error.message, 'error'); return; }
  const t = myTasks.find(x => String(x.id) === String(id));
  if(t) t.done = done;
  renderTasksList();
}

/* تُجلَب فريش عند كل فتح للنموذج (لا اعتماد على حالة معلَّبة بموديولات
   أخرى مثل activityPrograms، قد تكون فارغة لو لم يفتح المعلم "برامجي" أو
   "خطتي" بهذه الجلسة أصلًا). */
async function populateTaskLinkSelects(){
  const goalSelect = document.getElementById('tkLinkedGoal');
  const programSelect = document.getElementById('tkLinkedProgram');
  goalSelect.innerHTML = '<option value="">— بلا ربط —</option>';
  programSelect.innerHTML = '<option value="">— بلا ربط —</option>';

  const [{ data: goals }, { data: programs }] = await Promise.all([
    sb.from('performance_goals').select('id, goal_name, element_label').eq('user_id', currentUser.id).eq('cycle_year', getCycleYear()),
    sb.from('activity_programs').select('id, name').eq('user_id', currentUser.id),
  ]);

  goalSelect.innerHTML += (goals || []).map(g => `<option value="${g.id}">${escapeHtml(g.goal_name || g.element_label || 'هدف')}</option>`).join('');
  programSelect.innerHTML += (programs || []).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

async function showNewTaskForm(){
  editingTaskId = null;
  document.getElementById('taskFormTitle').textContent = 'مهمة جديدة';
  document.getElementById('tkTitle').value = '';
  document.getElementById('tkDescription').value = '';
  document.getElementById('tkPriority').value = 'medium';
  document.getElementById('tkDueDate').value = '';
  document.getElementById('tkSaveMsg').textContent = '';
  document.getElementById('tkSaveMsg').className = 'save-msg';
  showTasksSection('form');
  await populateTaskLinkSelects();
  document.getElementById('tkLinkedGoal').value = '';
  document.getElementById('tkLinkedProgram').value = '';
}

async function editTask(id){
  const t = myTasks.find(x => String(x.id) === String(id));
  if(!t) return;
  editingTaskId = t.id;
  document.getElementById('taskFormTitle').textContent = 'تعديل المهمة';
  document.getElementById('tkTitle').value = t.title || '';
  document.getElementById('tkDescription').value = t.description || '';
  document.getElementById('tkPriority').value = t.priority || 'medium';
  document.getElementById('tkDueDate').value = t.due_date || '';
  document.getElementById('tkSaveMsg').textContent = '';
  document.getElementById('tkSaveMsg').className = 'save-msg';
  showTasksSection('form');
  await populateTaskLinkSelects();
  if(!currentUser || editingTaskId !== id) return; // تغيّر السياق أثناء انتظار تعبئة القوائم — لا نطبّق قيمًا على نموذج غير هذا
  document.getElementById('tkLinkedGoal').value = t.linked_goal_id || '';
  document.getElementById('tkLinkedProgram').value = t.linked_program_id || '';
}

function cancelTaskForm(){
  showTasksSection('list');
}

async function saveTaskForm(){
  const msg = document.getElementById('tkSaveMsg');
  msg.className = 'save-msg';
  msg.textContent = '';

  const title = document.getElementById('tkTitle').value.trim();
  if(!title){ msg.textContent = 'الرجاء كتابة عنوان المهمة.'; msg.className = 'save-msg error'; return; }

  const payload = {
    title,
    description: document.getElementById('tkDescription').value.trim() || null,
    priority: document.getElementById('tkPriority').value,
    due_date: document.getElementById('tkDueDate').value || null,
    linked_goal_id: document.getElementById('tkLinkedGoal').value || null,
    linked_program_id: document.getElementById('tkLinkedProgram').value || null,
  };

  const btn = document.getElementById('tkSaveBtn');
  btn.disabled = true;
  try{
    if(editingTaskId){
      const { error } = await sb.from('tasks').update(payload).eq('id', editingTaskId).eq('user_id', currentUser.id);
      if(error) throw error;
    } else {
      const { error } = await sb.from('tasks').insert({ ...payload, user_id: currentUser.id });
      if(error) throw error;
    }
    showToast('تم حفظ المهمة', 'ok');
    await showTasks();
  } catch(err){
    msg.textContent = 'تعذّر الحفظ: ' + err.message;
    msg.className = 'save-msg error';
  } finally {
    btn.disabled = false;
  }
}

let taskDeleting = false; /* يمنع حذفًا مزدوجًا بنقرتين متتاليتين */
async function deleteTask(id){
  if(taskDeleting) return;
  taskDeleting = true;
  try{ await deleteTaskConfirmed(id); } finally { taskDeleting = false; }
}
async function deleteTaskConfirmed(id){
  const ok = await showConfirm('حذف هذه المهمة؟');
  if(!ok) return;
  const { error } = await sb.from('tasks').delete().eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  myTasks = myTasks.filter(t => String(t.id) !== String(id));
  showToast('تم حذف المهمة', 'ok');
  renderTasksList();
}
