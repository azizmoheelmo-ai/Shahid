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
  setActiveBottomTab(null);
  document.getElementById('tasksView').style.display = 'block';
  showTasksSection('list');
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

function renderTasksList(){
  const body = document.getElementById('tasksListBody');
  if(!myTasks.length){
    body.innerHTML = '<div class="empty-state">لا توجد مهام بعد. أضف مهمتك الأولى.</div>';
    return;
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  const sorted = sortTasksForDisplay(myTasks);
  body.innerHTML = sorted.map(t => {
    const overdue = !t.done && t.due_date && t.due_date < todayIso;
    const linkedLabel = t.linked_goal_id ? '🎯 مرتبطة بهدف أداء' : (t.linked_program_id ? '🟡 مرتبطة ببرنامج نشاط' : '');
    const dueLabel = t.due_date
      ? (overdue ? '⚠ تجاوز الاستحقاق: ' : 'الاستحقاق: ') + escapeHtml(formatTaskDueDate(t.due_date))
      : 'بلا تاريخ استحقاق';
    return `<div class="rec">
      <div class="rec-top">
        <span class="rec-title" style="${t.done ? 'text-decoration:line-through;color:var(--muted);' : ''}">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTaskDone('${t.id}', this.checked)" style="margin-left:6px;vertical-align:middle;">${escapeHtml(t.title)}
        </span>
        <span class="plan-badge-count" style="${overdue ? 'background:#B23A3A;color:#fff;' : ''}">${escapeHtml(TASK_PRIORITY_LABELS[t.priority] || t.priority)}</span>
      </div>
      <div class="plan-progress-text">
        <span>${dueLabel}</span>
        <span>${escapeHtml(linkedLabel)}</span>
      </div>
      <div class="rec-actions">
        <button class="btn btn-outline" onclick="editTask('${t.id}')">تعديل</button>
        <button class="btn btn-outline" onclick="deleteTask('${t.id}')">حذف</button>
      </div>
    </div>`;
  }).join('');
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

async function deleteTask(id){
  const ok = await showConfirm('حذف هذه المهمة؟');
  if(!ok) return;
  const { error } = await sb.from('tasks').delete().eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  myTasks = myTasks.filter(t => String(t.id) !== String(id));
  showToast('تم حذف المهمة', 'ok');
  renderTasksList();
}
