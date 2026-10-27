/* ============================================================
   سلة المحذوفات (30 يومًا)
   ------------------------------------------------------------
   قبل أي حذف ثقيل نحفظ بجدول deleted_items لقطة من السجل وكل ما يُحذف معه
   (cascade) وما يُفك ربطه (set null)، ثم نحذف. الاسترجاع كله بدالة واحدة بالقاعدة
   (restore_deleted_item) في معاملة واحدة: ينجح كاملًا أو لا يتغيّر شيء.

   قواعد لا تُكسر:
   - لا حذف قبل نجاح حفظ اللقطة؛ فإن تعذّر الحفظ يُسأل المعلم صراحةً هل يتابع
     بحذف نهائي (مثلًا قبل تشغيل ملف SQL على القاعدة).
   - لقطات الصفوف تُقرأ من القاعدة (كل الصفحات عبر fetchAllRows) لا من نسخة
     الذاكرة، وبفلترة صريحة بمالك السجل (لا نعتمد على RLS وحدها).
   - صور الشواهد لا تُمسح من التخزين عند الحذف؛ تُمسح عند انتهاء المدة أو
     عند «حذف نهائي» من السلة.
   ============================================================ */

const TRASH_DAYS = 30;
const TRASH_UNDO_SECONDS = 8;
const TRASH_IN_CHUNK = 100; /* حد آمن لطول رابط الطلب عند in(...) */

const TRASH_KIND_LABELS = {
  student: 'طالب', shahid: 'شاهد', program: 'برنامج', goal: 'هدف', task: 'مهمة (مهامّي)',
  academic_case: 'حالة أكاديمية', incident: 'حادثة', positive_note: 'ملاحظة إيجابية', private_note: 'ملاحظة خاصة',
  grade_columns: 'عمود/اختبار درجات', custom_tool: 'أداة مخصصة', perf_task: 'مهمة أدائية', homework: 'واجب', lesson: 'رصد حصة'
};

function trashKindLabel(kind){ return TRASH_KIND_LABELS[kind] || kind || 'عنصر'; }

/* أيام متبقية قبل الحذف النهائي (دالة صرفة). now اختياري للاختبار. */
function trashDaysLeft(expiresAt, now){
  const ms = new Date(expiresAt).getTime() - (now === undefined ? Date.now() : now);
  if(!isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 86400000));
}

/* مسارات ملفات الصور داخل مخزن shawahid-photos من روابط photo_urls (دالة صرفة) */
function trashPhotoPaths(urls){
  const marker = '/shawahid-photos/';
  return (Array.isArray(urls) ? urls : []).map(u => {
    if(typeof u !== 'string') return null;
    const i = u.indexOf(marker);
    return i > -1 ? decodeURIComponent(u.slice(i + marker.length).split('?')[0]) : null;
  }).filter(Boolean);
}

/* ---------- قراءة اللقطة ---------- */

/* filters: [['eq', col, val] | ['in', col, [vals]]] — كل الصفحات، و in(...) مقسّمة */
async function trashRows(table, filters){
  const inIdx = filters.findIndex(f => f[0] === 'in');
  const chunks = [];
  if(inIdx === -1) chunks.push(filters);
  else {
    const vals = filters[inIdx][2];
    if(!vals.length) return [];
    for(let i = 0; i < vals.length; i += TRASH_IN_CHUNK){
      chunks.push(filters.map((f, k) => k === inIdx ? ['in', f[1], vals.slice(i, i + TRASH_IN_CHUNK)] : f));
    }
  }
  let out = [];
  for(const fl of chunks){
    const { data, error } = await fetchAllRows((from, to) => {
      let q = sb.from(table).select('*');
      fl.forEach(f => { q = f[0] === 'in' ? q.in(f[1], f[2]) : q.eq(f[1], f[2]); });
      return q.order('id', { ascending: true }).range(from, to);
    });
    if(error) throw error;
    out = out.concat(data);
  }
  return out;
}

const trashIds = rows => rows.map(r => r.id);

/* ملاحظة: كل capture يُرجع {kind, label, ownerId, tables:[{t, rows}] بترتيب الاسترجاع (الأب أولًا),
   relinks, meta, photoPaths} أو null إن لم يعد السجل موجودًا. ownerId = صاحب السجل (قد يكون
   غير المستخدم الحالي إن حذف المسؤول سجل معلم). */

async function trashCaptureStudent(studentId, ownerId){
  const stu = await trashRows('classroom_students', [['eq', 'id', studentId], ['eq', 'teacher_id', ownerId]]);
  if(!stu.length) return null;
  const f = [['eq', 'student_id', studentId], ['eq', 'teacher_id', ownerId]];
  const [incidents, cases, attendance, positives, privates, followups, grades, periods, homework, tasks, marks] = await Promise.all([
    trashRows('classroom_incidents', f), trashRows('academic_cases', f), trashRows('classroom_attendance', f),
    trashRows('classroom_positive_notes', f), trashRows('classroom_private_notes', f), trashRows('classroom_followups', f),
    trashRows('classroom_grade_scores', f), trashRows('classroom_grade_period_scores', f), trashRows('classroom_homework_status', f),
    trashRows('classroom_task_students', f), trashRows('classroom_tool_marks', f)
  ]);
  const actions = followups.length ? await trashRows('classroom_followup_actions', [['eq', 'teacher_id', ownerId], ['in', 'followup_id', trashIds(followups)]]) : [];
  return {
    kind: 'student', label: stu[0].full_name || 'طالب', ownerId,
    tables: [
      { t: 'classroom_students', rows: stu }, { t: 'classroom_incidents', rows: incidents }, { t: 'academic_cases', rows: cases },
      { t: 'classroom_attendance', rows: attendance }, { t: 'classroom_positive_notes', rows: positives },
      { t: 'classroom_private_notes', rows: privates }, { t: 'classroom_followups', rows: followups },
      { t: 'classroom_followup_actions', rows: actions }, { t: 'classroom_grade_scores', rows: grades },
      { t: 'classroom_grade_period_scores', rows: periods }, { t: 'classroom_homework_status', rows: homework },
      { t: 'classroom_task_students', rows: tasks }, { t: 'classroom_tool_marks', rows: marks }
    ]
  };
}

async function trashCaptureShahid(shahidId, ownerId, meta){
  const rows = await trashRows('shawahid', [['eq', 'id', shahidId], ['eq', 'user_id', ownerId]]);
  if(!rows.length) return null;
  const r = rows[0];
  return {
    kind: 'shahid', label: r.lesson_title || r.element_label || 'شاهد', ownerId,
    tables: [{ t: 'shawahid', rows }], meta: meta || {}, photoPaths: trashPhotoPaths(r.photo_urls)
  };
}

async function trashCaptureProgram(programId, ownerId){
  const rows = await trashRows('activity_programs', [['eq', 'id', programId], ['eq', 'user_id', ownerId]]);
  if(!rows.length) return null;
  const [secs, shw, tks] = await Promise.all([
    trashRows('program_sections', [['eq', 'program_id', programId], ['eq', 'teacher_id', ownerId]]),
    trashRows('shawahid', [['eq', 'program_id', programId], ['eq', 'user_id', ownerId]]),
    trashRows('tasks', [['eq', 'linked_program_id', programId], ['eq', 'user_id', ownerId]])
  ]);
  const relinks = [];
  if(shw.length) relinks.push({ t: 'shawahid', col: 'program_id', ids: trashIds(shw), val: programId });
  if(tks.length) relinks.push({ t: 'tasks', col: 'linked_program_id', ids: trashIds(tks), val: programId });
  return { kind: 'program', label: rows[0].name || 'برنامج', ownerId, tables: [{ t: 'activity_programs', rows }, { t: 'program_sections', rows: secs }], relinks };
}

async function trashCaptureGoal(goalId, ownerId){
  const rows = await trashRows('performance_goals', [['eq', 'id', goalId], ['eq', 'user_id', ownerId]]);
  if(!rows.length) return null;
  const [shw, tks] = await Promise.all([
    trashRows('shawahid', [['eq', 'goal_id', goalId], ['eq', 'user_id', ownerId]]),
    trashRows('tasks', [['eq', 'linked_goal_id', goalId], ['eq', 'user_id', ownerId]])
  ]);
  const relinks = [];
  if(shw.length) relinks.push({ t: 'shawahid', col: 'goal_id', ids: trashIds(shw), val: goalId });
  if(tks.length) relinks.push({ t: 'tasks', col: 'linked_goal_id', ids: trashIds(tks), val: goalId });
  return { kind: 'goal', label: rows[0].goal_name || rows[0].element_label || 'هدف', ownerId, tables: [{ t: 'performance_goals', rows }], relinks };
}

/* سجل واحد بلا توابع: المهمة الشخصية، الحالة الأكاديمية، الحادثة، الملاحظات */
async function trashCaptureSingle(kind, table, ownColumn, id, ownerId, labelFn){
  const rows = await trashRows(table, [['eq', 'id', id], ['eq', ownColumn, ownerId]]);
  if(!rows.length) return null;
  return { kind, label: labelFn(rows[0]), ownerId, tables: [{ t: table, rows }] };
}

async function trashCaptureGradeColumns(columnIds, ownerId, label, meta){
  const cols = await trashRows('classroom_grade_columns', [['eq', 'teacher_id', ownerId], ['in', 'id', columnIds]]);
  if(!cols.length) return null;
  const ids = trashIds(cols);
  const [scores, periods] = await Promise.all([
    trashRows('classroom_grade_scores', [['eq', 'teacher_id', ownerId], ['in', 'column_id', ids]]),
    trashRows('classroom_grade_period_scores', [['eq', 'teacher_id', ownerId], ['in', 'column_id', ids]])
  ]);
  return {
    kind: 'grade_columns', label: label || cols[0].name || 'عمود درجات', ownerId, meta: meta || {},
    tables: [{ t: 'classroom_grade_columns', rows: cols }, { t: 'classroom_grade_scores', rows: scores }, { t: 'classroom_grade_period_scores', rows: periods }]
  };
}

async function trashCaptureCustomTool(toolId, ownerId){
  const tool = await trashRows('classroom_custom_tools', [['eq', 'id', toolId], ['eq', 'teacher_id', ownerId]]);
  if(!tool.length) return null;
  const cols = await trashRows('classroom_grade_columns', [['eq', 'teacher_id', ownerId], ['eq', 'tool_id', toolId]]);
  const colIds = trashIds(cols);
  const [scores, periods, marks] = await Promise.all([
    colIds.length ? trashRows('classroom_grade_scores', [['eq', 'teacher_id', ownerId], ['in', 'column_id', colIds]]) : [],
    colIds.length ? trashRows('classroom_grade_period_scores', [['eq', 'teacher_id', ownerId], ['in', 'column_id', colIds]]) : [],
    trashRows('classroom_tool_marks', [['eq', 'teacher_id', ownerId], ['eq', 'tool_id', toolId]])
  ]);
  return {
    kind: 'custom_tool', label: tool[0].name || 'أداة', ownerId,
    tables: [{ t: 'classroom_custom_tools', rows: tool }, { t: 'classroom_grade_columns', rows: cols },
      { t: 'classroom_grade_scores', rows: scores }, { t: 'classroom_grade_period_scores', rows: periods }, { t: 'classroom_tool_marks', rows: marks }]
  };
}

async function trashCapturePerfTask(taskId, ownerId){
  const task = await trashRows('classroom_tasks', [['eq', 'id', taskId], ['eq', 'teacher_id', ownerId]]);
  if(!task.length) return null;
  const studs = await trashRows('classroom_task_students', [['eq', 'teacher_id', ownerId], ['eq', 'task_id', taskId]]);
  return { kind: 'perf_task', label: task[0].title || 'مهمة أدائية', ownerId, meta: { sectionId: task[0].section_id },
    tables: [{ t: 'classroom_tasks', rows: task }, { t: 'classroom_task_students', rows: studs }] };
}

async function trashCaptureHomework(hwId, ownerId){
  const hw = await trashRows('classroom_homework', [['eq', 'id', hwId], ['eq', 'teacher_id', ownerId]]);
  if(!hw.length) return null;
  const st = await trashRows('classroom_homework_status', [['eq', 'teacher_id', ownerId], ['eq', 'homework_id', hwId]]);
  return { kind: 'homework', label: hw[0].title || 'واجب', ownerId, meta: { sectionId: hw[0].section_id },
    tables: [{ t: 'classroom_homework', rows: hw }, { t: 'classroom_homework_status', rows: st }] };
}

async function trashCaptureLesson(lessonId, ownerId){
  const l = await trashRows('classroom_lessons', [['eq', 'id', lessonId], ['eq', 'teacher_id', ownerId]]);
  if(!l.length) return null;
  const att = await trashRows('classroom_attendance', [['eq', 'teacher_id', ownerId], ['eq', 'lesson_id', lessonId]]);
  return { kind: 'lesson', label: 'رصد حصة ' + (l[0].lesson_date || ''), ownerId,
    tables: [{ t: 'classroom_lessons', rows: l }, { t: 'classroom_attendance', rows: att }] };
}

/* يمنع تنفيذ نفس الحذف مرتين (نقرة مزدوجة أثناء التأكيد أو جلب اللقطة) فلا تتكرر عناصر السلة */
const trashRunning = new Set();
async function trashRunOnce(key, fn){
  if(trashRunning.has(key)) return;
  trashRunning.add(key);
  try{ return await fn(); } finally { trashRunning.delete(key); }
}

/* ---------- الحفظ والحذف ---------- */

async function trashSave(cap){
  const tables = (cap.tables || []).filter(x => x.rows && x.rows.length);
  const { data, error } = await sb.from('deleted_items').insert({
    teacher_id: cap.ownerId, kind: cap.kind, label: String(cap.label || '').slice(0, 300),
    payload: { tables, relinks: cap.relinks || [], meta: cap.meta || {} },
    photo_paths: cap.photoPaths || []
  }).select('id').single();
  if(error) throw error;
  return data.id;
}

/* يحفظ اللقطة قبل الحذف. يُرجع {id} (id=null: سيُحذف بلا سلة بموافقة المعلم)، أو null للإلغاء.
   لا يُنفَّذ الحذف أبدًا إلا بعد هذه الدالة. */
async function trashProtect(captureFn){
  try{
    const cap = await captureFn();
    if(!cap) return { id: null, gone: true }; /* السجل غير موجود أصلًا */
    return { id: await trashSave(cap), cap };
  } catch(e){
    const ok = await showConfirm('تعذّر حفظ نسخة من هذا العنصر في «المحذوفات» (' + ((e && e.message) || 'خطأ') + '). إن تابعت فسيُحذف نهائيًا ولا يمكن استرجاعه. هل تريد المتابعة بالحذف؟');
    return ok ? { id: null } : null;
  }
}

/* حذف فشل بعد حفظ اللقطة: لا نترك عنصرًا يُغري باسترجاع ما لم يُحذف */
async function trashDiscard(id){
  if(!id) return;
  try{ await sb.from('deleted_items').delete().eq('id', id); } catch(e){ /* غير حرج */ }
}

/* نافذة «تراجع» غير حاجزة بعد الحذف: التراجع = استرجاع من السلة */
function trashOfferUndo(msg, itemId, onRestored){
  if(!itemId){ showToast(msg, 'ok'); return; }
  const uid = currentUser && currentUser.id;
  Promise.resolve(showUndoToast(msg + ' — تجده في «المحذوفات» ' + TRASH_DAYS + ' يومًا', TRASH_UNDO_SECONDS)).then(async (finalize) => {
    if(finalize) return;
    const res = await trashRestoreItem(itemId);
    if(res.error){ showToast(res.error, 'error'); return; }
    showToast('تم التراجع عن الحذف', 'ok');
    if(currentUser && currentUser.id === uid && typeof onRestored === 'function'){ try{ await onRestored(res.data); } catch(e){ /* غير حرج */ } }
  }).catch(() => {});
}

/* ---------- الاسترجاع ---------- */

function trashRestoreErrorMessage(error){
  const code = error && (error.code || '');
  const msg = (error && error.message) || '';
  if(code === '23505') return 'تعذّر الاسترجاع: يوجد سجل بنفس المعرّف (ربما استُرجع من قبل).';
  if(code === '23503') return 'تعذّر الاسترجاع: عنصر مرتبط به (مثل الطالب أو الشعبة أو العمود) لم يعد موجودًا. استرجع العنصر الأصلي أولًا.';
  if(code === 'P0002' || /deleted_item_not_found/.test(msg)) return 'هذا العنصر لم يعد في المحذوفات (استُرجع أو انتهت مدته).';
  if(code === '42501' || /forbidden|table_not_allowed|relink_not_allowed/.test(msg)) return 'لا تملك صلاحية استرجاع هذا العنصر.';
  if(code === 'PGRST202' || /restore_deleted_item/.test(msg) && /not find|does not exist/i.test(msg)) return 'ميزة الاسترجاع غير مفعّلة بعد في قاعدة البيانات (شغّل ملف SQL المرفق).';
  return 'تعذّر الاسترجاع: ' + (msg || 'خطأ غير متوقع');
}

let trashRestoring = new Set(); /* يمنع استرجاعًا مزدوجًا لنفس العنصر بنقرتين */
/* ownerId: صاحب العنصر (غير المستخدم الحالي عند استرجاع المسؤول لمعلم) */
async function trashRestoreItem(id, ownerId){
  if(trashRestoring.has(id)) return { error: 'جارٍ استرجاع هذا العنصر...' };
  trashRestoring.add(id);
  try{
    const { data, error } = await sb.rpc('restore_deleted_item', { p_id: id });
    if(error) return { error: trashRestoreErrorMessage(error) };
    await trashAfterRestore(data || {}, ownerId);
    return { data: data || {} };
  } finally {
    trashRestoring.delete(id);
  }
}

/* بعد الاسترجاع: ما يلزم لإعادة الحالة المشتقة (ربط حصة البرنامج، إعادة حساب أعمدة الواجبات/المهام)
   وتحديث القوائم المحمّلة. كله best-effort: الاسترجاع نفسه تم بالقاعدة. */
async function trashAfterRestore(res, ownerId){
  /* استرجاع المسؤول لمعلم: لا تحديثات على حساب غيره من هذا الجهاز (القاعدة استرجعت كل شيء) */
  if(ownerId && currentUser && ownerId !== currentUser.id) return;
  const meta = (res && res.meta) || {};
  const kind = res && res.kind;
  try{
    if(kind === 'shahid' && meta.programSession && typeof markProgramSessionDone === 'function'){
      const p = meta.programSession;
      await markProgramSessionDone(p.programId, p.sessionNo, meta.shahidId, p.doneDate, p.sectionId);
    }
    if(kind === 'homework' && meta.sectionId && typeof afterCrmHomeworkChanged === 'function') await afterCrmHomeworkChanged(meta.sectionId, null, true);
    if(meta.reenableTool && typeof setAppToolOn === 'function') await setAppToolOn(meta.reenableTool, true);
    if(kind === 'custom_tool' && typeof afterCustomToolsChanged === 'function' && currentUser) await afterCustomToolsChanged(currentUser.id);
    if(kind === 'perf_task' && meta.sectionId && typeof afterCrmTaskChanged === 'function') await afterCrmTaskChanged(meta.sectionId, null);
  } catch(e){ /* غير حرج */ }
  try{
    if(kind === 'student' && typeof loadCrmStudents === 'function'){ await loadCrmStudents(); if(typeof renderCrmStudentsList === 'function') renderCrmStudentsList(); }
    if(kind === 'shahid' && typeof loadMyShawahid === 'function') await loadMyShawahid();
    if(kind === 'program' && typeof loadActivityPrograms === 'function') await loadActivityPrograms();
    if(kind === 'task' && typeof loadMyTasks === 'function'){ await loadMyTasks(); if(typeof renderTasksList === 'function' && document.getElementById('tasksView').style.display !== 'none') renderTasksList(); }
    if(kind === 'academic_case' && typeof renderAcCases === 'function'){ await renderAcCases(); if(typeof refreshAcBadges === 'function') await refreshAcBadges(); }
    if(typeof invalidateAttention === 'function' && (kind === 'student' || kind === 'lesson')){ invalidateAttention(); if(typeof refreshAttention === 'function') refreshAttention(); }
  } catch(e){ /* غير حرج */ }
}

/* ---------- الحذف النهائي وتنظيف المنتهي ---------- */

async function trashRemovePhotos(paths){
  if(!paths || !paths.length) return true;
  try{
    const { error } = await sb.storage.from('shawahid-photos').remove(paths);
    return !error;
  } catch(e){ return false; }
}

/* يحذف عناصر المعلم الحالي المنتهية فقط (مع صورها). للمسؤول: لا يحذف عناصر غيره (لا صلاحية بالقاعدة). */
async function trashPurgeExpired(){
  if(!currentUser) return 0;
  const uid = currentUser.id;
  let purged = 0;
  try{
    const { data, error } = await sb.from('deleted_items').select('id, photo_paths')
      .eq('teacher_id', uid).lt('expires_at', new Date().toISOString()).limit(50);
    if(error || !data) return 0;
    for(const it of data){
      if(!currentUser || currentUser.id !== uid) break;
      if(!(await trashRemovePhotos(it.photo_paths))) continue; /* تُعاد المحاولة لاحقًا، ولا نُيتّم الصور */
      const { error: dErr } = await sb.from('deleted_items').delete().eq('id', it.id).eq('teacher_id', uid);
      if(!dErr) purged++;
    }
  } catch(e){ /* غير حرج */ }
  return purged;
}

/* ---------- شاشة المحذوفات (داخل الإعدادات) ---------- */

let trashScope = 'mine'; /* 'mine' | 'others' (للمسؤول) */
let trashItems = [];
let trashLoadSeq = 0;

function showTrash(){
  showSettings('trash');
  loadTrash();
}

function setTrashScope(scope){
  trashScope = (scope === 'others' && isAdmin) ? 'others' : 'mine';
  loadTrash();
}

async function loadTrash(){
  const box = document.getElementById('trashList');
  if(!box || !currentUser) return;
  const uid = currentUser.id;
  const seq = ++trashLoadSeq;
  document.getElementById('trashScopeBar').style.display = isAdmin ? 'flex' : 'none';
  [['trashScopeMine', 'mine'], ['trashScopeOthers', 'others']].forEach(([btnId, scope]) => {
    const b = document.getElementById(btnId), on = trashScope === scope;
    b.classList.toggle('active', on);
    b.style.background = on ? '#1B3245' : '';
    b.style.color = on ? '#fff' : '';
  });
  box.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  await trashPurgeExpired();
  let q = sb.from('deleted_items').select('id, teacher_id, kind, label, deleted_at, expires_at, photo_paths');
  q = (trashScope === 'others' && isAdmin) ? q.neq('teacher_id', uid) : q.eq('teacher_id', uid);
  const { data, error } = await q.order('deleted_at', { ascending: false }).limit(200);
  if(seq !== trashLoadSeq || !currentUser || currentUser.id !== uid) return; /* تغيّرت الشاشة/الحساب أثناء الانتظار */
  if(error){
    box.innerHTML = '<div class="empty-state">' + escapeHtml(/deleted_items/.test(error.message || '') ? 'سلة المحذوفات غير مفعّلة بعد في قاعدة البيانات.' : 'تعذّر تحميل المحذوفات: ' + (error.message || '')) + '</div>';
    return;
  }
  trashItems = data || [];
  let names = {};
  if(trashScope === 'others' && trashItems.length){
    const ids = [...new Set(trashItems.map(i => i.teacher_id))];
    const { data: profs } = await sb.from('profiles').select('id, full_name, email').in('id', ids);
    (profs || []).forEach(p => { names[p.id] = p.full_name || p.email || ''; });
    if(seq !== trashLoadSeq) return;
  }
  renderTrashList(names);
}

function renderTrashList(names){
  const box = document.getElementById('trashList');
  if(!trashItems.length){
    box.innerHTML = '<div class="empty-state">لا شيء في المحذوفات. ما تحذفه يبقى هنا ' + TRASH_DAYS + ' يومًا قبل أن يُمسح نهائيًا.</div>';
    return;
  }
  box.innerHTML = trashItems.map(it => {
    const days = trashDaysLeft(it.expires_at);
    const who = trashScope === 'others' ? ' — ' + escapeHtml((names && names[it.teacher_id]) || 'معلم') : '';
    const when = new Date(it.deleted_at).toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
    const photos = (it.photo_paths || []).length ? ' · ' + it.photo_paths.length + ' صورة' : '';
    const canPurge = trashScope === 'mine';
    return `<div class="trash-row" id="trashRow-${escapeHtml(it.id)}" style="border:1px solid var(--line,#D8D2C4);border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <div style="flex:1 1 200px;min-width:0;">
        <div style="font-weight:600;">${escapeHtml(it.label || '—')}<span style="font-weight:400;color:var(--muted,#6B6659);font-size:12px;"> · ${escapeHtml(trashKindLabel(it.kind))}${who}</span></div>
        <div style="font-size:12px;color:var(--muted,#6B6659);">حُذف ${escapeHtml(when)}${photos} · يُمسح نهائيًا بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}</div>
      </div>
      <button class="btn btn-primary" data-trash-restore="${escapeHtml(it.id)}" onclick="restoreTrashItem(this.getAttribute('data-trash-restore'), this)">استرجاع</button>
      ${canPurge ? `<button class="btn btn-outline" data-trash-purge="${escapeHtml(it.id)}" onclick="purgeTrashItem(this.getAttribute('data-trash-purge'), this)">حذف نهائي</button>` : ''}
    </div>`;
  }).join('');
}

function trashSetRowBusy(id, busy){
  const row = document.getElementById('trashRow-' + id);
  if(row) row.querySelectorAll('button').forEach(b => { b.disabled = busy; });
}

async function restoreTrashItem(id, btn){
  trashSetRowBusy(id, true);
  const item = trashItems.find(x => x.id === id);
  const res = await trashRestoreItem(id, item && item.teacher_id);
  if(res.error){ showToast(res.error, 'error'); trashSetRowBusy(id, false); return; }
  showToast('تم الاسترجاع', 'ok');
  await loadTrash();
}

async function purgeTrashItem(id, btn){
  const it = trashItems.find(x => x.id === id);
  if(!it || !currentUser) return;
  const ok = await showConfirm('حذف «' + (it.label || '') + '» نهائيًا؟' + ((it.photo_paths || []).length ? ' ستُمسح صوره أيضًا.' : '') + ' لا يمكن استرجاعه بعد ذلك.');
  if(!ok) return;
  trashSetRowBusy(id, true);
  if(!(await trashRemovePhotos(it.photo_paths))){ showToast('تعذّر مسح الصور، حاول لاحقًا', 'error'); trashSetRowBusy(id, false); return; }
  const { error } = await sb.from('deleted_items').delete().eq('id', id).eq('teacher_id', currentUser.id);
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); trashSetRowBusy(id, false); return; }
  showToast('حُذف نهائيًا', 'ok');
  await loadTrash();
}
