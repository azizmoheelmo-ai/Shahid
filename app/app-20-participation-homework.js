/* ============================================================
   أوضاع ورقة الحصة: [حضور | مشاركة | واجب]
   ------------------------------------------------------------
   - المشاركة: نقرة على الطالب = +1 مباشرة على عمود "مشاركة" في كشف
     الدرجات (حتى حده)، تُحفظ فورًا بدالة ذرّية في القاعدة (لا تضيع نقرة
     سريعة ثانية ولا نقرة من جهاز آخر). "تراجع" يُلغي آخر نقرة.
   - الواجب: المعلم يضيف الواجب وموعد تسليمه. الأصل "لم يسلّم"، والنقر
     يبدّل: سلّم ← ناقص ← متأخر ← لم يسلّم. يُحفظ فورًا.
   - عمود "واجبات" يُحسب تلقائيًا (لا يُعدّل يدويًا): متوسط الواجبات
     المحسوبة × حد العمود. سلّم 100% · متأخر 75% · ناقص 50% · لم يسلّم 0.
   - الدرجة النهائية تُكتب في الكشف نفسه، فتعمل معها التنبيهات والملخص
     والتقرير ونقل الطالب كما هي.
   ============================================================ */

const HOMEWORK_CYCLE = ['missing', 'submitted', 'partial', 'late'];
const HOMEWORK_LABELS = { missing: 'لم يسلّم', submitted: 'سلّم', partial: 'ناقص', late: 'متأخر' };
const HOMEWORK_CREDIT = { submitted: 1, late: 0.75, partial: 0.5, missing: 0 };

/* ============ دوال صرفة ============ */
function nextHomeworkState(state){
  const i = HOMEWORK_CYCLE.indexOf(state || 'missing');
  return HOMEWORK_CYCLE[(i + 1) % HOMEWORK_CYCLE.length];
}

function homeworkStatusIndex(rows){
  const idx = new Map();
  (rows || []).forEach(r => {
    if(!idx.has(r.homework_id)) idx.set(r.homework_id, new Map());
    idx.get(r.homework_id).set(r.student_id, r.status);
  });
  return idx;
}

/* الواجب يُحسب بعد انقضاء موعده، أو متى بدأ رصده (ولو في يومه) */
function countedHomework(homeworks, statusRows, todayIso){
  const started = new Set((statusRows || []).map(r => r.homework_id));
  return (homeworks || []).filter(h => h.due_date < todayIso || started.has(h.id));
}

function homeworkScoreFor(counted, statusIdx, studentId, max){
  if(!(counted || []).length) return null;
  const sum = counted.reduce((s, h) => {
    const st = statusIdx.get(h.id) && statusIdx.get(h.id).get(studentId);
    return s + (HOMEWORK_CREDIT[st || 'missing'] || 0);
  }, 0);
  return Math.round(100 * (sum / counted.length) * Number(max)) / 100;
}

function planHomeworkScoreSync(studentIds, counted, statusIdx, max, existing){
  const upserts = [], deletes = [];
  (studentIds || []).forEach(id => {
    const want = homeworkScoreFor(counted, statusIdx, id, max);
    const has = existing.has(id) ? Number(existing.get(id)) : null;
    if(want === null){ if(has !== null) deletes.push(id); return; }
    if(has === null || Math.abs(has - want) > 0.001) upserts.push({ student_id: id, score: want });
  });
  return { upserts, deletes };
}

function defaultHomeworkId(homeworks, dateIso){
  const list = (homeworks || []).slice().sort((a, b) => a.due_date.localeCompare(b.due_date));
  const today = list.filter(h => h.due_date === dateIso);
  if(today.length) return today[today.length - 1].id;
  const past = list.filter(h => h.due_date < dateIso);
  if(past.length) return past[past.length - 1].id;
  return list.length ? list[0].id : null;
}

function homeworkCounts(statusMap, studentIds){
  const c = { submitted: 0, partial: 0, late: 0, missing: 0 };
  (studentIds || []).forEach(id => { c[(statusMap && statusMap.get(id)) || 'missing']++; });
  return c;
}

/* ============ تحميل ومزامنة عمود الواجبات ============ */
async function loadSectionHomework(sectionId, term){
  const uid = currentUser.id;
  const { data: homeworks, error } = await sb.from('classroom_homework').select('id, title, due_date, created_at')
    .eq('teacher_id', uid).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester)
    .order('due_date', { ascending: true });
  if(error) throw error;
  let statusRows = [];
  for(const ids of chunkArray((homeworks || []).map(h => h.id), 100)){
    const { data, error: sErr } = await sb.from('classroom_homework_status').select('homework_id, student_id, status')
      .eq('teacher_id', uid).in('homework_id', ids);
    if(sErr) throw sErr;
    statusRows = statusRows.concat(data || []);
  }
  return { homeworks: homeworks || [], statusRows };
}

/* يكتب درجات عمود "واجبات" المحسوبة لطلاب الشعبة الحاليين. studentIds
   اختياري لمزامنة طالب واحد بعد نقرة (أسرع). يرمي عند الفشل. */
async function syncHomeworkColumn(column, sectionId, hw, studentIds){
  if(!column) return;
  const uid = currentUser.id;
  const ids = studentIds || crmStudentsOfSection(sectionId).map(s => s.id);
  const { data: rows, error } = await sb.from('classroom_grade_scores').select('student_id, score')
    .eq('teacher_id', uid).eq('column_id', column.id);
  if(error) throw error;
  const existing = new Map((rows || []).map(r => [r.student_id, Number(r.score)]));
  const counted = countedHomework(hw.homeworks, hw.statusRows, localIsoDate());
  const plan = planHomeworkScoreSync(ids, counted, homeworkStatusIndex(hw.statusRows), column.max_score, existing);
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

async function findKindColumn(sectionId, term, kind){
  const { data, error } = await sb.from('classroom_grade_columns').select('id, name, max_score, kind')
    .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('academic_year', term.year).eq('semester', term.semester).eq('kind', kind).limit(1);
  if(error) throw error;
  return (data || [])[0] || null;
}

/* ============ مفتاح الأوضاع في ورقة الحصة ============ */
function crmSheetModeSwitchHtml(){
  const m = (crmSheet && crmSheet.mode) || 'attendance';
  const b = (k, t) => `<button class="${m === k ? 'is-on' : ''}" onclick="setCrmSheetMode('${k}')">${t}</button>`;
  return `<div class="crm-seg">${b('attendance', 'حضور')}${b('participation', 'مشاركة')}${b('homework', 'واجب')}</div>`;
}

function setCrmSheetMode(mode){
  if(!crmSheet) return;
  crmSheet.mode = mode;
  const students = crmStudentsOfSection(crmSheet.sectionId);
  if(mode === 'participation') return renderCrmParticipation(students);
  if(mode === 'homework') return renderCrmHomework(students);
  renderCrmLessonSheet(students, false);
}

function crmSheetHeaderText(s){
  return `${escapeHtml(crmSectionLabel(s.sectionId))} · ${CRM_WEEKDAY_NAMES[weekdayOfIso(s.dateIso)]} ${s.dateIso.slice(5).replace('-', '/')}${s.period ? ' · الحصة ' + s.period : ''}`;
}

/* ============ وضع المشاركة ============ */
function participationTodayKey(s){
  return 'crm_part:' + (currentUser && currentUser.id) + ':' + lessonKey(s.sectionId, s.dateIso, s.period);
}

/* حالة المشاركة لكل حصة على هذا الجهاز: عدّاد اليوم + سجل التراجع، فيبقى
   التراجع بعد إغلاق الورقة أو تبديل الوضع ويعود عند فتح نفس الحصة.
   (الصيغة القديمة كانت العدّاد وحده: { studentId: n }) */
const PARTICIPATION_UNDO_MAX = 200;
const PARTICIPATION_KEEP_DAYS = 14;

function readParticipationState(s){
  let raw = null;
  try{ raw = JSON.parse(localStorage.getItem(participationTodayKey(s)) || 'null'); } catch(e){}
  if(raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object'){
    return { counts: raw.counts, undo: Array.isArray(raw.undo) ? raw.undo.filter(x => typeof x === 'string') : [] };
  }
  return { counts: (raw && typeof raw === 'object') ? raw : {}, undo: [] };
}

function writeParticipationState(s, p){
  try{
    localStorage.setItem(participationTodayKey(s), JSON.stringify({ counts: p.today, undo: p.undo.slice(-PARTICIPATION_UNDO_MAX) }));
  } catch(e){}
}

/* تنظيف سجلات الحصص الأقدم من 14 يومًا (المفتاح ينتهي بـ شعبة|تاريخ|حصة) */
function pruneParticipationStates(todayIso){
  try{
    const limit = addDaysIso(todayIso || localIsoDate(), -PARTICIPATION_KEEP_DAYS);
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(!k || k.indexOf('crm_part:') !== 0) continue;
      const date = (k.split('|')[1] || '');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < limit) localStorage.removeItem(k);
    }
  } catch(e){}
}

async function renderCrmParticipation(students){
  const s = crmSheet;
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  let column = null, scores = new Map();
  try{
    column = await findKindColumn(s.sectionId, crmCurrentTerm(), 'participation');
    if(column){
      const { data, error } = await sb.from('classroom_grade_scores').select('student_id, score')
        .eq('teacher_id', currentUser.id).eq('column_id', column.id);
      if(error) throw error;
      scores = new Map((data || []).map(r => [r.student_id, Number(r.score)]));
    }
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== 'participation') return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('participation')">إعادة المحاولة</button></div>`;
    return;
  }
  if(crmSheet !== s || s.token !== token || s.mode !== 'participation') return; /* غيّر الوضع أو أغلق الورقة أثناء التحميل */
  if(!column){
    body.innerHTML = head + `<div class="empty-state">لا عمود "مشاركة" في كشف درجات هذه الشعبة لهذا الفصل.
      <button class="btn btn-outline crm-mini-btn" onclick="closeCrmLessonSheet();switchCrmTab('grades')">فتح كشف الدرجات</button></div>`;
    return;
  }
  const saved = readParticipationState(s);
  s.part = { column, scores, today: saved.counts, undo: saved.undo, queue: new Map() };
  body.innerHTML = head + `
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">نقرة = +1 في عمود "${escapeHtml(column.name)}" (من ${formatScore(column.max_score)}) — تُحفظ فورًا.</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn${s.states[st.id] === 'absent' ? ' is-absent' : ''}" id="crmPart_${st.id}" onclick="tapCrmParticipation('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-part-val"></span></button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      <button class="btn btn-outline" id="crmPartUndoBtn" style="flex:1;" onclick="undoCrmParticipation()" disabled>↶ تراجع عن آخر نقرة</button>
      <button class="btn btn-outline" onclick="closeCrmLessonSheet()">رجوع</button>
    </div>`;
  students.forEach(st => paintCrmParticipation(st.id));
}

function paintCrmParticipation(studentId){
  const s = crmSheet;
  const btn = document.getElementById('crmPart_' + studentId);
  if(!btn || !s || !s.part) return;
  const score = s.part.scores.has(studentId) ? s.part.scores.get(studentId) : null;
  const today = s.part.today[studentId] || 0;
  btn.querySelector('.crm-part-val').innerHTML =
    `${score === null ? '—' : formatScore(score)}<span class="crm-grade-max"> / ${formatScore(s.part.column.max_score)}</span>${today ? `<b class="crm-part-today">+${today}</b>` : ''}`;
  btn.classList.toggle('is-full', score !== null && score >= Number(s.part.column.max_score));
  const undo = document.getElementById('crmPartUndoBtn');
  if(undo) undo.disabled = !s.part.undo.length;
}

/* النقرات على نفس الطالب تُرسل بالتتابع (لا تتقاطع) — والقاعدة تجمعها ذرّيًا */
function queueCrmParticipation(studentId, delta){
  const s = crmSheet;
  const p = s.part;
  const prev = p.queue.get(studentId) || Promise.resolve();
  const next = prev.then(async () => {
    const { data, error } = await sb.rpc('increment_grade_score', { p_column_id: p.column.id, p_student_id: studentId, p_delta: delta });
    if(error) throw error;
    if(typeof invalidateAttention === 'function') invalidateAttention(); /* الدرجة تغيّرت: بطاقات الدرجات تُحسب من جديد عند الحاجة */
    if(crmSheet === s && s.part === p){
      const v = Number(data);
      if(v === 0 && delta < 0) p.scores.delete(studentId); else p.scores.set(studentId, v);
      paintCrmParticipation(studentId);
    }
  }).catch(e => {
    showToast((delta > 0 ? 'لم تُحفظ النقرة: ' : 'لم يُحفظ التراجع: ') + (e.message || 'خطأ بالاتصال'), 'error');
    /* إرجاع كل أثر العرض المتفائل: الدرجة والعدّاد وسجل التراجع. لو بقيت نقرة
       فاشلة في السجل، أنقص "تراجع" لاحقًا درجة حقيقية لم تُضف أصلًا */
    const cur = p.scores.has(studentId) ? p.scores.get(studentId) : 0;
    const back = cur - delta;
    if(back <= 0 && delta > 0) p.scores.delete(studentId); else p.scores.set(studentId, Math.max(0, back));
    p.today[studentId] = Math.max(0, (p.today[studentId] || 0) - delta);
    if(delta > 0){
      const i = p.undo.lastIndexOf(studentId);
      if(i !== -1) p.undo.splice(i, 1);
    } else {
      p.undo.push(studentId);
    }
    writeParticipationState(s, p);
    if(crmSheet === s && s.part === p) paintCrmParticipation(studentId);
  });
  p.queue.set(studentId, next);
  return next;
}

function tapCrmParticipation(studentId){
  const s = crmSheet;
  if(!s || !s.part) return;
  const p = s.part;
  const cur = p.scores.has(studentId) ? p.scores.get(studentId) : 0;
  if(cur >= Number(p.column.max_score)){ showToast('اكتملت درجة المشاركة لهذا الطالب', 'ok'); return; }
  p.scores.set(studentId, Math.min(Number(p.column.max_score), cur + 1)); /* عرض فوري */
  p.today[studentId] = (p.today[studentId] || 0) + 1;
  p.undo.push(studentId);
  writeParticipationState(s, p);
  paintCrmParticipation(studentId);
  queueCrmParticipation(studentId, 1);
}

function undoCrmParticipation(){
  const s = crmSheet;
  if(!s || !s.part || !s.part.undo.length) return;
  const p = s.part;
  const studentId = p.undo.pop();
  const cur = p.scores.has(studentId) ? p.scores.get(studentId) : 0;
  if(cur - 1 <= 0) p.scores.delete(studentId); else p.scores.set(studentId, cur - 1);
  p.today[studentId] = Math.max(0, (p.today[studentId] || 0) - 1);
  writeParticipationState(s, p);
  paintCrmParticipation(studentId);
  queueCrmParticipation(studentId, -1);
}

/* ============ وضع الواجب ============ */
async function renderCrmHomework(students, selectId){
  const s = crmSheet;
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  const term = crmCurrentTerm();
  let hw, column;
  try{
    [hw, column] = await Promise.all([loadSectionHomework(s.sectionId, term), findKindColumn(s.sectionId, term, 'homework')]);
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== 'homework') return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('homework')">إعادة المحاولة</button></div>`;
    return;
  }
  if(crmSheet !== s || s.token !== token || s.mode !== 'homework') return;
  const selectedId = (selectId && hw.homeworks.some(h => h.id === selectId)) ? selectId : defaultHomeworkId(hw.homeworks, s.dateIso);
  s.hw = { data: hw, column, selectedId, queue: new Map(), term };
  if(!hw.homeworks.length){
    body.innerHTML = head + `<div class="empty-state">لا واجبات لهذه الشعبة بعد.</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="openCrmHomeworkModal()">+ واجب جديد</button>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  const statuses = homeworkStatusIndex(hw.statusRows).get(selectedId) || new Map();
  body.innerHTML = head + `
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="goal-input" style="margin:0;flex:1;" onchange="renderCrmHomework(crmStudentsOfSection(crmSheet.sectionId), this.value)">
        ${hw.homeworks.map(h => `<option value="${h.id}"${h.id === selectedId ? ' selected' : ''}>${escapeHtml(h.title)} · ${shortDateAr(h.due_date)}</option>`).join('')}
      </select>
      <button class="btn btn-outline crm-mini-btn" title="تعديل أو حذف الواجب المختار" onclick="openCrmHomeworkEditor(crmSheet.hw && crmSheet.hw.selectedId)">✎ تعديل</button>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmHomeworkModal()">+ واجب</button>
    </div>
    <div id="crmHwCounts" class="crm-sheet-counts"></div>
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">الأصل "لم يسلّم" — اضغط: سلّم ← ناقص ← متأخر ← لم يسلّم. يُحفظ فورًا${column ? ' ويُحسب في عمود "' + escapeHtml(column.name) + '"' : ' (أضف عمود واجبات في الكشف ليُحسب تلقائيًا)'}.</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn" id="crmHw_${st.id}" onclick="tapCrmHomework('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      <button class="btn btn-outline" style="flex:1;" onclick="markAllCrmHomeworkSubmitted()">الكل سلّم</button>
      <button class="btn btn-outline" onclick="closeCrmLessonSheet()">رجوع</button>
    </div>`;
  s.hw.statuses = statuses;
  students.forEach(st => paintCrmHomework(st.id));
  paintCrmHomeworkCounts();
}

function paintCrmHomework(studentId){
  const s = crmSheet;
  const btn = document.getElementById('crmHw_' + studentId);
  if(!btn || !s || !s.hw) return;
  const st = s.hw.statuses.get(studentId) || 'missing';
  btn.className = 'crm-att-btn hw-' + st;
  btn.querySelector('.crm-att-state').textContent = HOMEWORK_LABELS[st];
}

function paintCrmHomeworkCounts(){
  const el = document.getElementById('crmHwCounts');
  if(!el || !crmSheet || !crmSheet.hw) return;
  const c = homeworkCounts(crmSheet.hw.statuses, crmStudentsOfSection(crmSheet.sectionId).map(x => x.id));
  el.textContent = `سلّم ${c.submitted} · ناقص ${c.partial} · متأخر ${c.late} · لم يسلّم ${c.missing}`;
}

/* حفظ حالة طالب ثم إعادة حساب درجته — بالتتابع لكل طالب */
function persistCrmHomework(studentId, state){
  const s = crmSheet;
  const h = s.hw;
  const hwId = h.selectedId;
  const prev = h.queue.get(studentId) || Promise.resolve();
  const next = prev.then(async () => {
    const uid = currentUser.id;
    const { error } = state === 'missing'
      ? await sb.from('classroom_homework_status').delete().eq('teacher_id', uid).eq('homework_id', hwId).eq('student_id', studentId)
      : await sb.from('classroom_homework_status').upsert({ teacher_id: uid, homework_id: hwId, student_id: studentId, status: state, updated_at: new Date().toISOString() },
          { onConflict: 'homework_id,student_id' });
    if(error) throw error;
    /* نسخة محلية لحساب الدرجة (لكل الواجبات، لا المختار وحده) */
    h.data.statusRows = h.data.statusRows.filter(r => !(r.homework_id === hwId && r.student_id === studentId));
    if(state !== 'missing') h.data.statusRows.push({ homework_id: hwId, student_id: studentId, status: state });
    await syncHomeworkColumn(h.column, s.sectionId, h.data, [studentId]);
  }).catch(e => showToast('لم يُحفظ الواجب: ' + (e.message || 'خطأ بالاتصال') + ' — أعد النقر', 'error'));
  h.queue.set(studentId, next);
  return next;
}

function tapCrmHomework(studentId){
  const s = crmSheet;
  if(!s || !s.hw || !s.hw.selectedId) return;
  const st = nextHomeworkState(s.hw.statuses.get(studentId) || 'missing');
  if(st === 'missing') s.hw.statuses.delete(studentId); else s.hw.statuses.set(studentId, st);
  paintCrmHomework(studentId);
  paintCrmHomeworkCounts();
  persistCrmHomework(studentId, st);
}

let crmHwBulkBusy = false;
async function markAllCrmHomeworkSubmitted(){
  const s = crmSheet;
  if(!s || !s.hw || !s.hw.selectedId || crmHwBulkBusy) return;
  const ids = crmStudentsOfSection(s.sectionId).map(x => x.id).filter(id => !s.hw.statuses.has(id));
  if(!ids.length) return;
  crmHwBulkBusy = true;
  const uid = currentUser.id, hwId = s.hw.selectedId;
  ids.forEach(id => { s.hw.statuses.set(id, 'submitted'); paintCrmHomework(id); });
  paintCrmHomeworkCounts();
  try{
    const { error } = await sb.from('classroom_homework_status').upsert(
      ids.map(id => ({ teacher_id: uid, homework_id: hwId, student_id: id, status: 'submitted', updated_at: new Date().toISOString() })),
      { onConflict: 'homework_id,student_id' });
    if(error) throw error;
    ids.forEach(id => s.hw.data.statusRows.push({ homework_id: hwId, student_id: id, status: 'submitted' }));
    await syncHomeworkColumn(s.hw.column, s.sectionId, s.hw.data, ids);
    showToast('سُجّل "سلّم" للباقين — اضغط على المقصّرين لتعديلهم', 'ok');
  } catch(e){
    showToast('تعذّر الحفظ: ' + (e.message || '') , 'error');
    if(crmSheet === s) setCrmSheetMode('homework');
  } finally {
    crmHwBulkBusy = false;
  }
}

/* ============ إضافة/تعديل واجب ============ */
let crmHomeworkDraft = null; /* { sectionId, editId?, saving } */

function crmHomeworkFormHtml(sectionId, h){
  const edit = !!h;
  return `
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">${edit ? 'تعديل الواجب' : 'واجب جديد'}</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(crmSectionLabel(sectionId))}</div>
      <label class="crm-field-label">الواجب</label>
      <input class="goal-input" id="crmHwTitle" maxlength="200" placeholder="مثال: تمارين الوحدة 2 صفحة 34" value="${edit ? escapeHtml(h.title) : ''}" style="margin-bottom:8px;">
      <label class="crm-field-label">موعد التسليم</label>
      <input type="date" class="goal-input" id="crmHwDue" value="${escapeHtml(h ? h.due_date : (crmSheet && crmSheet.sectionId === sectionId ? crmSheet.dateIso : localIsoDate()))}" style="margin-bottom:10px;">
      <button class="btn btn-primary" id="crmHwSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmHomework()">${edit ? 'حفظ التعديل' : 'حفظ الواجب'}</button>
      ${edit ? `<button class="btn btn-outline" id="crmHwDeleteBtn" style="width:100%;justify-content:center;margin-top:8px;color:#8A2C2C;" onclick="deleteCrmHomework('${h.id}', '${sectionId}')">حذف الواجب</button>` : ''}
    </div>`;
}

function openCrmHomeworkModal(sectionIdArg){
  const sectionId = sectionIdArg || (crmSheet && crmSheet.sectionId) || (crmGrades && crmGrades.sectionId);
  if(!sectionId) return;
  crmHomeworkDraft = { sectionId, saving: false };
  showInfoModal(crmHomeworkFormHtml(sectionId, null), '420px');
}

/* يقرأ الواجب من القاعدة مباشرة (لا من نسخة محلية قد تكون قديمة) */
let crmHwEditorOpening = false;
async function openCrmHomeworkEditor(hwId){
  if(!hwId || crmHwEditorOpening) return;
  crmHwEditorOpening = true;
  let res;
  try{
    res = await sb.from('classroom_homework').select('id, section_id, title, due_date')
      .eq('teacher_id', currentUser.id).eq('id', hwId).maybeSingle();
  } catch(e){ res = { error: e }; }
  finally { crmHwEditorOpening = false; }
  if(res.error){ showToast('تعذّر تحميل الواجب', 'error'); return; }
  if(!res.data){ showToast('الواجب غير موجود — ربما حُذف من جهاز آخر', 'error'); return; }
  const h = res.data;
  closeCrmModal();
  crmHomeworkDraft = { sectionId: h.section_id, editId: h.id, saving: false };
  showInfoModal(crmHomeworkFormHtml(h.section_id, h), '420px');
}

async function saveCrmHomework(){
  const d = crmHomeworkDraft;
  if(!d || d.saving) return;
  const title = document.getElementById('crmHwTitle').value.trim();
  const due = document.getElementById('crmHwDue').value;
  if(!title){ showToast('اكتب الواجب', 'error'); return; }
  if(!due){ showToast('اختر موعد التسليم', 'error'); return; }
  d.saving = true;
  const btns = ['crmHwSaveBtn', 'crmHwDeleteBtn'].map(id => document.getElementById(id)).filter(Boolean);
  btns.forEach(b => { b.disabled = true; });
  let res;
  if(d.editId){
    res = await sb.from('classroom_homework').update({ title, due_date: due })
      .eq('teacher_id', currentUser.id).eq('id', d.editId).select('id');
    if(!res.error && !(res.data || []).length) res = { error: { message: 'الواجب غير موجود — ربما حُذف' } };
  } else {
    const term = crmCurrentTerm();
    res = await sb.from('classroom_homework').insert({
      teacher_id: currentUser.id, section_id: d.sectionId, academic_year: term.year, semester: term.semester, title, due_date: due
    }).select('id').single();
  }
  if(res.error){
    showToast('تعذّر حفظ الواجب: ' + res.error.message, 'error');
    d.saving = false;
    btns.forEach(b => { b.disabled = false; });
    return;
  }
  const id = d.editId || (res.data && res.data.id);
  crmHomeworkDraft = null;
  closeCrmModal();
  showToast(d.editId ? 'عُدّل الواجب' : 'أُضيف الواجب', 'ok');
  /* موعد التسليم يحدّد هل يُحسب الواجب — فيُعاد حساب العمود بعد أي تغيير */
  await afterCrmHomeworkChanged(d.sectionId, id, !!d.editId || due < localIsoDate());
}

/* بعد إضافة/تعديل/حذف: إعادة حساب عمود الواجبات ثم تحديث الشاشة الظاهرة
   فعلًا الآن (ورقة الحصة بنفس الشعبة، أو الكشف) — لا الشاشة التي بدأت منها
   العملية، فالمعلم قد ينتقل أثناء الحفظ. */
async function afterCrmHomeworkChanged(sectionId, selectId, resync){
  if(resync){
    try{
      const term = crmCurrentTerm();
      const column = await findKindColumn(sectionId, term, 'homework');
      if(column) await syncHomeworkColumn(column, sectionId, await loadSectionHomework(sectionId, term));
    } catch(e){ showToast('تعذّر إعادة حساب عمود الواجبات — يُحدَّث عند فتح الكشف', 'error'); }
  }
  if(crmSheet && crmSheet.sectionId === sectionId && crmSheet.mode === 'homework'){
    renderCrmHomework(crmStudentsOfSection(sectionId), selectId);
  } else if(document.getElementById('crmTabGrades').style.display !== 'none'){
    await renderCrmGrades();
    if(crmGrades && crmGrades.sectionId === sectionId) openCrmHomeworkManager();
  }
}

/* ============ إدارة الواجبات (من عمود "واجبات" في الكشف) ============ */
async function openCrmHomeworkManager(){
  if(!crmGrades) return;
  const sectionId = crmGrades.sectionId;
  let hw;
  try{ hw = await loadSectionHomework(sectionId, crmCurrentTerm()); }
  catch(e){ showToast('تعذّر تحميل الواجبات', 'error'); return; }
  const ids = crmStudentsOfSection(sectionId).map(s => s.id);
  const idx = homeworkStatusIndex(hw.statusRows);
  const counted = new Set(countedHomework(hw.homeworks, hw.statusRows, localIsoDate()).map(h => h.id));
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">الواجبات · ${escapeHtml(crmSectionLabel(sectionId))}</h3>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.7;">العمود يُحسب تلقائيًا: سلّم 100% · متأخر 75% · ناقص 50% · لم يسلّم 0. الواجب يُحسب بعد موعده أو متى بدأت رصده. الرصد من ورقة الحصة ← "واجب".</div>
      ${hw.homeworks.length ? hw.homeworks.slice().reverse().map(h => {
        const c = homeworkCounts(idx.get(h.id) || new Map(), ids);
        return `<div class="crm-lesson-row"><span>${escapeHtml(h.title)} <span class="crm-tl-meta">· ${shortDateAr(h.due_date)}${counted.has(h.id) ? '' : ' · لم يُحسب بعد'}</span>
          <div class="crm-tl-meta">سلّم ${c.submitted} · ناقص ${c.partial} · متأخر ${c.late} · لم يسلّم ${c.missing}</div></span>
          <span style="display:flex;gap:4px;">
            <button class="crm-icon-btn" title="تعديل" onclick="openCrmHomeworkEditor('${h.id}')">✎</button>
            <button class="crm-icon-btn" title="حذف" onclick="deleteCrmHomework('${h.id}', '${sectionId}')">🗑</button>
          </span></div>`;
      }).join('') : '<div class="crm-today-empty">لا واجبات بعد.</div>'}
      <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:10px;" onclick="closeCrmModal();openCrmHomeworkModal('${sectionId}')">+ واجب جديد</button>
    </div>`, '460px');
}

/* يعمل من ورقة الحصة ومن الكشف — لا يعتمد على crmGrades */
let crmHwDeleting = false;
async function deleteCrmHomework(id, sectionId){
  if(crmHwDeleting || !id || !sectionId) return;
  closeCrmModal();
  const ok = await showConfirm('حذف هذا الواجب؟ يُحذف معه رصد تسليمه، وتُعاد حساب درجات الواجبات.');
  if(!ok) return;
  if(crmHwDeleting) return;
  crmHwDeleting = true;
  try{
    /* نقرات تسليم معلّقة على هذا الواجب تنتهي أولًا، لا تصطدم بحذفه */
    const s = crmSheet;
    if(s && s.hw && s.hw.queue) await Promise.all([...s.hw.queue.values()]);
    const { data, error } = await sb.from('classroom_homework').delete()
      .eq('teacher_id', currentUser.id).eq('id', id).select('id');
    if(error) throw error;
    showToast((data || []).length ? 'حُذف الواجب' : 'الواجب محذوف مسبقًا', 'ok');
  } catch(e){
    showToast('تعذّر الحذف: ' + (e.message || ''), 'error');
    return;
  } finally {
    crmHwDeleting = false;
  }
  await afterCrmHomeworkChanged(sectionId, null, true);
}
