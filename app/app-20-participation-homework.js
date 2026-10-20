/* ============================================================
   أوضاع ورقة الحصة: [حضور | مشاركة | واجب | مهمة] (المهمة في app-21)
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
/* "يبدأ من الكاملة" (إعداد الدرجات): الكل سلّم، والنقرة الأولى = لم يسلّم */
const HOMEWORK_CYCLE_FULL = ['submitted', 'missing', 'partial', 'late'];
const HOMEWORK_LABELS = { missing: 'لم يسلّم', submitted: 'سلّم', partial: 'ناقص', late: 'متأخر' };
const HOMEWORK_CREDIT = { submitted: 1, late: 0.75, partial: 0.5, missing: 0 };

/* ============ دوال صرفة ============ */
function nextHomeworkState(state, full){
  const cycle = full ? HOMEWORK_CYCLE_FULL : HOMEWORK_CYCLE;
  const i = cycle.indexOf(state || 'missing');
  return cycle[(i + 1) % cycle.length];
}

/* "يبدأ من الكاملة": من لا درجة له في العمود يأخذ الكاملة (لا يكتب فوق رصد قائم أو متزامن) */
async function fillStartFullScores(column, studentIds, existing){
  const missing = (studentIds || []).filter(id => !existing.has(id));
  if(!missing.length) return [];
  const { error } = await sb.from('classroom_grade_scores').upsert(
    missing.map(id => ({ teacher_id: currentUser.id, column_id: column.id, student_id: id, score: Number(column.max_score) })),
    { onConflict: 'column_id,student_id', ignoreDuplicates: true });
  if(error) throw error;
  return missing;
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

/* ما يُكتب وما يُحذف في عمود محسوب (واجبات/مهام): wantFn(id) = الدرجة المطلوبة أو null */
function planComputedScoreSync(studentIds, wantFn, existing){
  const upserts = [], deletes = [];
  (studentIds || []).forEach(id => {
    const want = wantFn(id);
    const has = existing.has(id) ? Number(existing.get(id)) : null;
    if(want === null){ if(has !== null) deletes.push(id); return; }
    if(has === null || Math.abs(has - want) > 0.001) upserts.push({ student_id: id, score: want });
  });
  return { upserts, deletes };
}

function planHomeworkScoreSync(studentIds, counted, statusIdx, max, existing){
  return planComputedScoreSync(studentIds, id => homeworkScoreFor(counted, statusIdx, id, max), existing);
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
const CRM_SHEET_MODE_LABELS = { attendance: 'حضور', participation: 'مشاركة', homework: 'واجب', task: 'مهمة', test: 'اختبار' };
/* الأدوات المفعّلة فقط (تخصيص التطبيق)؛ أداة واحدة = لا حاجة لمفتاح */
function crmSheetModeSwitchHtml(){
  const m = (crmSheet && crmSheet.mode) || 'attendance';
  const modes = enabledSheetModes();
  if(modes.length < 2) return '';
  /* أسماء الأدوات الخاصة من المعلم — تُهرَّب */
  return `<div class="crm-seg${modes.length > 4 ? ' is-wrap' : ''}">${modes.map(k => `<button class="${m === k ? 'is-on' : ''}" onclick="setCrmSheetMode('${k}')">${escapeHtml(sheetModeLabel(k))}</button>`).join('')}</div>`;
}

function setCrmSheetMode(mode){
  if(!crmSheet) return;
  if(!enabledSheetModes().includes(mode)) mode = enabledSheetModes()[0] || 'none';
  crmSheet.mode = mode;
  if(mode === 'none'){
    document.getElementById('crmLessonSheetBody').innerHTML = `<div class="crm-sheet-head">${crmSheetHeaderText(crmSheet)}</div>
      <div class="empty-state">كل أدوات ورقة الحصة مخفية. فعّل ما تحتاجه من الإعدادات ← تخصيص التطبيق.</div>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  const students = crmStudentsOfSection(crmSheet.sectionId);
  if(mode.indexOf('tool:') === 0) return renderCrmToolMode(students, customToolById(mode.slice(5)));
  if(mode === 'participation') return renderCrmParticipation(students);
  if(mode === 'homework') return renderCrmHomework(students);
  if(mode === 'task') return renderCrmTasks(students);
  if(mode === 'test') return renderCrmTestMode(students);
  renderCrmLessonSheet(students, false);
}

function crmSheetHeaderText(s){
  return `${escapeHtml(crmSectionLabel(s.sectionId))} · ${CRM_WEEKDAY_NAMES[weekdayOfIso(s.dateIso)]} ${s.dateIso.slice(5).replace('-', '/')}${s.period ? ' · الحصة ' + s.period : ''}`;
}

/* ============ وضع المشاركة ============ */
/* toolId: أداة "عدّاد" خاصة (app-23) — لكل أداة سجلها؛ المفتاح ينتهي دومًا بـ شعبة|تاريخ|حصة */
function participationTodayKey(s, toolId){
  /* "يبدأ من الكاملة" له سجل نقرات وتراجع مستقل (اتجاه النقرة مختلف) */
  const full = gradeStartsFull(toolId ? 'tool:' + toolId : 'participation') ? 'full:' : '';
  return 'crm_part:' + (currentUser && currentUser.id) + ':' + full + (toolId ? toolId + ':' : '') + lessonKey(s.sectionId, s.dateIso, s.period);
}

/* حالة المشاركة لكل حصة على هذا الجهاز: عدّاد اليوم + سجل التراجع، فيبقى
   التراجع بعد إغلاق الورقة أو تبديل الوضع ويعود عند فتح نفس الحصة.
   (الصيغة القديمة كانت العدّاد وحده: { studentId: n }) */
const PARTICIPATION_UNDO_MAX = 200;
const PARTICIPATION_KEEP_DAYS = 14;

function readParticipationState(s, toolId){
  let raw = null;
  try{ raw = JSON.parse(localStorage.getItem(participationTodayKey(s, toolId)) || 'null'); } catch(e){}
  if(raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object'){
    return { counts: raw.counts, undo: Array.isArray(raw.undo) ? raw.undo.filter(x => typeof x === 'string') : [] };
  }
  return { counts: (raw && typeof raw === 'object') ? raw : {}, undo: [] };
}

function writeParticipationState(s, p){
  try{
    localStorage.setItem(participationTodayKey(s, p.toolId), JSON.stringify({ counts: p.today, undo: p.undo.slice(-PARTICIPATION_UNDO_MAX) }));
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

/* tool: أداة "عدّاد" خاصة (app-23) — نفس المحرّك على عمودها */
async function renderCrmParticipation(students, tool){
  const s = crmSheet;
  const mode = tool ? 'tool:' + tool.id : 'participation';
  const body = document.getElementById('crmLessonSheetBody');
  const head = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}`;
  body.innerHTML = head + '<div class="loading-state">جارٍ التحميل...</div>';
  const token = s.token;
  let column = null, scores = new Map(), capError = null;
  try{
    if(tool){
      const r = await ensureToolColumn(tool, s.sectionId, crmCurrentTerm());
      column = r.column || null;
      capError = r.error ? r : null;
    } else {
      column = await findKindColumn(s.sectionId, crmCurrentTerm(), 'participation');
    }
    if(column){
      const { data, error } = await sb.from('classroom_grade_scores').select('student_id, score')
        .eq('teacher_id', currentUser.id).eq('column_id', column.id);
      if(error) throw error;
      scores = new Map((data || []).map(r => [r.student_id, Number(r.score)]));
      if(gradeStartsFull(tool ? 'tool:' + tool.id : 'participation')){
        (await fillStartFullScores(column, students.map(st => st.id), scores)).forEach(id => scores.set(id, Number(column.max_score)));
      }
    }
  } catch(e){
    if(crmSheet !== s || s.token !== token || s.mode !== mode) return;
    body.innerHTML = head + `<div class="empty-state">تعذّر التحميل. <button class="btn btn-outline crm-mini-btn" onclick="setCrmSheetMode('${mode}')">إعادة المحاولة</button></div>`;
    return;
  }
  if(crmSheet !== s || s.token !== token || s.mode !== mode) return; /* غيّر الوضع أو أغلق الورقة أثناء التحميل */
  if(!column && capError){
    body.innerHTML = head + `<div class="empty-state">${toolCapMessage(tool, capError.remaining).replace('الرصد يُحفظ ولا يُحسب في الكشف حتى', 'لا يمكن الرصد حتى')}</div>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  if(!column){
    body.innerHTML = head + `<div class="empty-state">لا عمود "مشاركة" في كشف درجات هذه الشعبة لهذا الفصل.
      <button class="btn btn-outline crm-mini-btn" onclick="closeCrmLessonSheet();switchCrmTab('grades')">فتح كشف الدرجات</button></div>`;
    return;
  }
  const saved = readParticipationState(s, tool ? tool.id : null);
  const full = gradeStartsFull(tool ? 'tool:' + tool.id : 'participation');
  s.part = { column, scores, today: saved.counts, undo: saved.undo, queue: new Map(), toolId: tool ? tool.id : null, full, step: full ? -1 : 1 };
  body.innerHTML = head + `
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">${full ? `تبدأ الدرجة كاملة (${formatScore(column.max_score)}). ` : ''}<b style="color:#2F6B3A;">+</b> يزيد درجة و<b style="color:#8A2C2C;">−</b> ينقص درجة في "${escapeHtml(column.name)}" (من ${formatScore(column.max_score)}) — تُحفظ فورًا.</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <div class="crm-att-btn crm-part-tile${crmAbsentClass(s, st.id)}" id="crmPart_${st.id}">
          <span class="crm-att-name"><span class="crm-att-nm">${escapeHtml(st.full_name)}</span><span class="crm-absent-badge">غائب</span><span class="crm-part-chip"></span></span>
          <span class="crm-part-step">
            <button type="button" class="crm-part-plus" aria-label="+1 ${escapeHtml(st.full_name)}" onclick="tapCrmParticipation('${st.id}', 1)">+</button>
            <span class="crm-part-val"></span>
            <button type="button" class="crm-part-minus" aria-label="−1 ${escapeHtml(st.full_name)}" onclick="tapCrmParticipation('${st.id}', -1)">−</button>
          </span>
        </div>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      ${crmSheetFinishBtnHtml()}
      <button class="btn btn-outline" id="crmPartUndoBtn" style="flex:1;" onclick="undoCrmParticipation()" disabled>↶ تراجع</button>
      <button class="btn btn-outline" onclick="closeCrmLessonSheet()">رجوع</button>
    </div>`;
  students.forEach(st => paintCrmParticipation(st.id));
}

function paintCrmParticipation(studentId){
  const s = crmSheet;
  const btn = document.getElementById('crmPart_' + studentId);
  if(!btn || !s || !s.part) return;
  const score = s.part.scores.has(studentId) ? s.part.scores.get(studentId) : null;
  /* صافي تغيّر اليوم: today يعدّ النقرات باتجاه الوضع (+1، أو −1 لمن يبدأ من الكاملة) */
  const net = (s.part.today[studentId] || 0) * (s.part.step || 1);
  btn.querySelector('.crm-part-val').innerHTML =
    `<b>${score === null ? '—' : formatScore(score)}</b><span class="crm-grade-max"> / ${formatScore(s.part.column.max_score)}</span>`;
  const chip = btn.querySelector('.crm-part-chip');
  if(chip) chip.innerHTML = net ? `<b class="crm-part-today${net < 0 ? ' is-minus' : ''}" dir="ltr">${net < 0 ? '−' : '+'}${Math.abs(net)}</b>` : '';
  btn.classList.toggle('is-full', score !== null && score >= Number(s.part.column.max_score));
  const am = crmAbsentMode(s, studentId);
  btn.classList.toggle('is-absent', am === 'absent');
  btn.classList.toggle('is-absent-ok', am === 'ok');
  const undo = document.getElementById('crmPartUndoBtn');
  if(undo) undo.disabled = !s.part.undo.length;
}

/* النقرات على نفس الطالب تُرسل بالتتابع (لا تتقاطع) — والقاعدة تجمعها ذرّيًا */
/* kind: 'tap' (نقرة + أو −) أو 'undo' (تراجع عنها) — لإرجاع العرض والسجل بدقة عند الفشل */
function queueCrmParticipation(studentId, delta, kind){
  const s = crmSheet;
  const p = s.part;
  const prev = p.queue.get(studentId) || Promise.resolve();
  const next = prev.then(async () => {
    /* "يبدأ من الكاملة": الصفر درجة حقيقية لا "لم تُرصد" (وإلا أُعيد للكاملة) */
    const { data, error } = await sb.rpc('increment_grade_score', p.full
      ? { p_column_id: p.column.id, p_student_id: studentId, p_delta: delta, p_keep_zero: true }
      : { p_column_id: p.column.id, p_student_id: studentId, p_delta: delta });
    if(error) throw error;
    if(typeof invalidateAttention === 'function') invalidateAttention(); /* الدرجة تغيّرت: بطاقات الدرجات تُحسب من جديد عند الحاجة */
    if(crmSheet === s && s.part === p){
      const v = Number(data);
      if(v === 0 && delta < 0 && !p.full) p.scores.delete(studentId); else p.scores.set(studentId, v);
      paintCrmParticipation(studentId);
    }
  }).catch(e => {
    markCrmSheetFailure();
    const isTap = kind !== 'undo';
    showToast((isTap ? 'لم تُحفظ النقرة: ' : 'لم يُحفظ التراجع: ') + (e.message || 'خطأ بالاتصال'), 'error');
    /* إرجاع كل أثر العرض المتفائل: الدرجة والعدّاد وسجل التراجع. لو بقيت نقرة
       فاشلة في السجل، أنقص "تراجع" لاحقًا درجة حقيقية لم تُضف أصلًا */
    const cur = p.scores.has(studentId) ? p.scores.get(studentId) : 0;
    const back = cur - delta;
    if(back <= 0 && delta > 0 && !p.full) p.scores.delete(studentId); else p.scores.set(studentId, Math.max(0, Math.min(Number(p.column.max_score), back)));
    /* اتجاه النقرة الأصلية: النقرة نفسها، أو عكس التراجع */
    const dir = isTap ? delta : -delta;
    const entry = participationUndoEntry(p, studentId, dir);
    p.today[studentId] = (p.today[studentId] || 0) + (isTap ? -1 : 1) * (dir === (p.step || 1) ? 1 : -1);
    if(isTap){
      const i = p.undo.lastIndexOf(entry);
      if(i !== -1) p.undo.splice(i, 1);
    } else {
      p.undo.push(entry);
    }
    writeParticipationState(s, p);
    if(crmSheet === s && s.part === p) paintCrmParticipation(studentId);
  });
  p.queue.set(studentId, next);
  return next;
}

/* سجل التراجع: النقرة باتجاه الوضع تُحفظ بمعرّف الطالب وحده (كالصيغة القديمة المحفوظة على
   الأجهزة)، والنقرة المعاكسة بـ"~" قبله — فيُعرف عند التراجع ماذا يُعكس */
function participationUndoEntry(p, studentId, dir){
  return dir === (p.step || 1) ? studentId : '~' + studentId;
}

/* dir: +1 أو −1 (زرّا المستطيل)؛ بلا dir = اتجاه الوضع */
function tapCrmParticipation(studentId, dir){
  const s = crmSheet;
  if(!s || !s.part) return;
  if(crmAbsentGate(studentId)) return; /* غائب: "حضر" أو "تجاوز" أولًا — النقرة لا تُحسب */
  const p = s.part;
  const max = Number(p.column.max_score);
  const step = p.step || 1; /* اتجاه الوضع: +1 (يبدأ من 0) أو −1 (يبدأ من الكاملة) */
  dir = dir === 1 || dir === -1 ? dir : step;
  const cur = p.scores.has(studentId) ? p.scores.get(studentId) : (p.full ? max : 0);
  if(dir > 0 && cur >= max){ showToast(`اكتملت درجة "${p.column.name}" لهذا الطالب`, 'ok'); return; }
  if(dir < 0 && cur <= 0){ showToast(`درجة "${p.column.name}" لهذا الطالب صفر`, 'ok'); return; }
  p.scores.set(studentId, Math.max(0, Math.min(max, cur + dir))); /* عرض فوري */
  p.today[studentId] = (p.today[studentId] || 0) + (dir === step ? 1 : -1);
  p.undo.push(participationUndoEntry(p, studentId, dir));
  writeParticipationState(s, p);
  paintCrmParticipation(studentId);
  queueCrmParticipation(studentId, dir, 'tap');
}

function undoCrmParticipation(){
  const s = crmSheet;
  if(!s || !s.part || !s.part.undo.length) return;
  const p = s.part;
  const entry = p.undo.pop();
  const opposite = entry.charAt(0) === '~';
  const studentId = opposite ? entry.slice(1) : entry;
  const step = p.step || 1;
  const dir = opposite ? -step : step; /* اتجاه النقرة التي نتراجع عنها */
  const cur = p.scores.has(studentId) ? p.scores.get(studentId) : 0;
  const back = cur - dir;
  if(back <= 0 && dir > 0 && !p.full) p.scores.delete(studentId); else p.scores.set(studentId, Math.max(0, Math.min(Number(p.column.max_score), back)));
  p.today[studentId] = (p.today[studentId] || 0) - (opposite ? -1 : 1);
  writeParticipationState(s, p);
  paintCrmParticipation(studentId);
  queueCrmParticipation(studentId, -dir, 'undo');
}

/* ============ الطالب الغائب (المشاركة والأدوات) ============ */
/* مسجّل غائب في الحصة: باهت وعليه "غائب"، والضغط عليه يسأل "حضر" أو "تجاوز" أولًا
   (النقرة نفسها لا تُحسب). "تجاوز" يبقيه غائبًا ويفتح له الرصد في هذه الورقة. */
function crmAbsentMode(s, studentId){
  if(!s || !s.states || s.states[studentId] !== 'absent') return '';
  return s.absentOk && s.absentOk.has(studentId) ? 'ok' : 'absent';
}

function crmAbsentClass(s, studentId){
  const m = crmAbsentMode(s, studentId);
  return m === 'absent' ? ' is-absent' : m === 'ok' ? ' is-absent-ok' : '';
}

/* true = أُوقفت النقرة وظهرت نافذة الاختيار */
function crmAbsentGate(studentId){
  const s = crmSheet;
  if(crmAbsentMode(s, studentId) !== 'absent') return false;
  const st = crmStudents.find(x => x.id === studentId);
  s.absentAsk = studentId;
  showInfoModal(`<div style="text-align:center;">
    <h3 style="margin:0 0 4px;font-size:16px;color:var(--navy);">${escapeHtml(st ? st.full_name : '')}</h3>
    <p style="margin:0 0 14px;font-size:13px;color:var(--muted);">مسجّل غائب في هذه الحصة</p>
    <div class="crm-absent-two">
      <button type="button" class="btn btn-primary" onclick="chooseCrmAbsent('present')">حضر<small>تروح كلمة «غائب»</small></button>
      <button type="button" class="btn btn-outline" onclick="chooseCrmAbsent('skip')">تجاوز<small>يبقى غائبًا</small></button>
    </div></div>`, '380px');
  /* خياران فقط: لا "إغلاق" (يعود ظاهرًا عند إغلاق النافذة) */
  const cancel = document.getElementById('confirmCancelBtn');
  if(cancel) cancel.style.display = 'none';
  return true;
}

function repaintCrmSheetStudent(studentId){
  const s = crmSheet;
  if(!s) return;
  if(s.part) paintCrmParticipation(studentId);
  if(s.tool && typeof paintCrmTool === 'function') paintCrmTool(studentId);
}

function chooseCrmAbsent(kind){
  const s = crmSheet;
  const id = s && s.absentAsk;
  closeCrmModal();
  if(!id) return;
  s.absentAsk = null;
  if(kind === 'skip'){
    s.absentOk = s.absentOk || new Set();
    s.absentOk.add(id);
    repaintCrmSheetStudent(id);
    return;
  }
  return markCrmStudentPresent(s, id);
}

/* "حضر": يُحفظ حاضرًا في حضور الحصة. يُقرأ حضور الحصة من القاعدة مباشرة ويُغيَّر هذا
   الطالب وحده — فلا تُحفظ ضمنًا تغييرات حضور أخرى لم يحفظها المعلم بعد */
let crmAbsentBusy = false;
async function markCrmStudentPresent(s, id){
  if(crmAbsentBusy) return;
  crmAbsentBusy = true;
  const st = crmStudents.find(x => x.id === id);
  const first = String((st && st.full_name) || '').split(' ')[0];
  try{
    if(s.lessonId){
      const uid = currentUser.id;
      const { data: rows, error } = await sb.from('classroom_attendance').select('student_id, status').eq('teacher_id', uid).eq('lesson_id', s.lessonId);
      if(error) throw error;
      const states = {};
      (rows || []).forEach(r => { if(r.student_id !== id) states[r.student_id] = r.status; });
      const { error: sErr } = await sb.rpc('save_lesson_attendance', {
        p_section_id: s.sectionId, p_lesson_date: s.dateIso, p_period: s.period, p_exceptions: exceptionsFromStates(states)
      });
      if(sErr) throw sErr;
    }
    if(crmSheet !== s) return; /* أُغلقت الورقة: الحضور حُفظ ولا شيء يُرسم */
    s.states[id] = 'present';
    if(s.dirty) writeLessonDraft(s.sectionId, s.dateIso, s.period, s.states);
    showToast(`«${first}» صار حاضرًا ✓` + (s.lessonId ? '' : ' — احفظ الحضور من تبويب "حضور"'), 'ok');
    repaintCrmSheetStudent(id);
  } catch(e){
    showToast('تعذّر تسجيله حاضرًا: ' + (e.message || 'خطأ بالاتصال'), 'error');
  } finally {
    crmAbsentBusy = false;
  }
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
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">${gradeStartsFull('homework') ? 'الأصل "سلّم" — اضغط: <b style="color:#8A2C2C;">لم يسلّم</b> ← ناقص ← متأخر ← سلّم' : 'الأصل "لم يسلّم" — اضغط: سلّم ← ناقص ← متأخر ← لم يسلّم'}. يُحفظ فورًا${column ? ' ويُحسب في عمود "' + escapeHtml(column.name) + '"' : ' (أضف عمود واجبات في الكشف ليُحسب تلقائيًا)'}.</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn" id="crmHw_${st.id}" onclick="tapCrmHomework('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      ${crmSheetFinishBtnHtml()}
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
  }).catch(e => { markCrmSheetFailure(); showToast('لم يُحفظ الواجب: ' + (e.message || 'خطأ بالاتصال') + ' — أعد النقر', 'error'); });
  h.queue.set(studentId, next);
  return next;
}

function tapCrmHomework(studentId){
  const s = crmSheet;
  if(!s || !s.hw || !s.hw.selectedId) return;
  const st = nextHomeworkState(s.hw.statuses.get(studentId) || 'missing', gradeStartsFull('homework'));
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
    markCrmSheetFailure();
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
  /* "يبدأ من الكاملة": كل طلاب الشعبة "سلّم" في الواجب الجديد */
  if(!d.editId && id && gradeStartsFull('homework')){
    const ids = crmStudentsOfSection(d.sectionId).map(st => st.id);
    if(ids.length){
      const { error: sErr } = await sb.from('classroom_homework_status').upsert(
        ids.map(sid => ({ teacher_id: currentUser.id, homework_id: id, student_id: sid, status: 'submitted', updated_at: new Date().toISOString() })),
        { onConflict: 'homework_id,student_id' });
      if(sErr) showToast('أُضيف الواجب، وتعذّر تسجيل "سلّم" للكل — استخدم "الكل سلّم"', 'error');
    }
  }
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
