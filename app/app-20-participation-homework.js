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

/* الفترات (app-27): كل واجب في فترة موعده، ودرجة الفترة من واجباتها، والعمود = معدّل
   الفترات التي فيها واجب محسوب. starts فارغة = فترة واحدة (الحساب القديم تمامًا) */
function homeworkPeriodScores(counted, statusIdx, studentId, max, cfg){
  return periodSplitScores(counted, h => h.due_date, list => homeworkScoreFor(list, statusIdx, studentId, max), cfg);
}

function planHomeworkScoreSync(studentIds, counted, statusIdx, max, existing, cfg){
  return planComputedScoreSync(studentIds, id => homeworkPeriodScores(counted, statusIdx, id, max, cfg).final, existing);
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
  return { homeworks: homeworks || [], statusRows, term };
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
  const plan = planHomeworkScoreSync(ids, counted, homeworkStatusIndex(hw.statusRows), column.max_score, existing, periodCfg(hw.term || crmCurrentTerm(), 'kind:homework'));
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

function setCrmSheetMode(mode, selectId){
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
  if(mode === 'test') return renderCrmTestMode(students, selectId);
  renderCrmLessonSheet(students, false);
}

function crmSheetHeaderText(s){
  return `${escapeHtml(crmSectionLabel(s.sectionId))} · ${CRM_WEEKDAY_NAMES[weekdayOfIso(s.dateIso)]} ${s.dateIso.slice(5).replace('-', '/')}${s.period ? ' · الحصة ' + s.period : ''}`;
}

/* ============ وضع المشاركة ============ */
/* toolId: أداة "عدّاد" خاصة (app-23) — لكل أداة سجلها؛ المفتاح ينتهي دومًا بـ شعبة|تاريخ|حصة */
function participationTodayKey(s, toolId, period){
  /* كل فترة بعد الأولى لها سجل نقرات وتراجع مستقل */
  const per = period > 1 ? 'p' + period + ':' : '';
  return 'crm_part:' + (currentUser && currentUser.id) + ':' + per + (toolId ? toolId + ':' : '') + lessonKey(s.sectionId, s.dateIso, s.period);
}

/* حالة المشاركة لكل حصة على هذا الجهاز: عدّاد اليوم + سجل التراجع، فيبقى
   التراجع بعد إغلاق الورقة أو تبديل الوضع ويعود عند فتح نفس الحصة.
   (الصيغة القديمة كانت العدّاد وحده: { studentId: n }) */
const PARTICIPATION_UNDO_MAX = 200;
const PARTICIPATION_KEEP_DAYS = 14;

function readParticipationState(s, toolId, period){
  let raw = null;
  try{ raw = JSON.parse(localStorage.getItem(participationTodayKey(s, toolId, period)) || 'null'); } catch(e){}
  if(raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object'){
    return { counts: raw.counts, undo: Array.isArray(raw.undo) ? raw.undo.filter(x => typeof x === 'string') : [] };
  }
  return { counts: (raw && typeof raw === 'object') ? raw : {}, undo: [] };
}

function writeParticipationState(s, p){
  try{
    localStorage.setItem(participationTodayKey(s, p.toolId, p.period), JSON.stringify({ counts: p.today, undo: p.undo.slice(-PARTICIPATION_UNDO_MAX) }));
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
  /* الرصد دائمًا بدرجة فترة (app-27) — بفترة واحدة: الأولى؛ وفترة الحصة من إعداد المكوّن */
  const pinfo = sheetPeriodInfo(s);
  const period = pinfo ? pinfo.period : 1;
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
      /* فتح الورقة لا يكتب أي درجة: الفارغ يبقى فارغًا حتى يُرصد أو يُعبَّأ بزر صريح */
      scores = currentPeriodScores(new Map((data || []).map(r => [r.student_id, Number(r.score)])), await loadPeriodRows(column.id), period);
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
  const saved = readParticipationState(s, tool ? tool.id : null, period);
  s.part = { column, scores, today: saved.counts, undo: saved.undo, queue: new Map(), toolId: tool ? tool.id : null, full: false, step: 1, period,
    chgKey: `part:${tool ? tool.id : column.id}:${lessonKey(s.sectionId, s.dateIso, s.period)}:${period}` };
  /* الشارة والشرح للمكوّن الذي له أكثر من فترة */
  const shown = pinfo && pinfo.cfg.n > 1 ? period : null;
  const lockKey = crmSheetLockedKey(s, period);
  s.part.locked = !!lockKey;
  const max = formatScore(column.max_score);
  const counted = shown && shown <= (countedPeriodsOf(pinfo.cfg) || pinfo.cfg.n);
  s.card = { kind: 'part', fill: [[Number(column.max_score), `الدرجة كاملة (${max})`], [0, '0']], help: [
    '<b>+</b> يزيد درجة، و<b>−</b> ينقص درجة، ويُحفظ فورًا.',
    `الدرجة من <b>${max}</b>، و«—» يعني لم يُرصد له بعد.`,
    shown ? `الرصد اليوم في <b>${PERIOD_NAMES[shown]}</b>، و${counted ? `درجة «${escapeHtml(column.name)}» في الكشف = معدّل الفترات.` : 'تدخل درجة الكشف عند انتهائها.'}`
      : `ما ترصده هنا هو درجة «${escapeHtml(column.name)}» في الكشف.`,
    '«تعبئة الباقين» تعطي من بلا درجة فقط، ولا تغيّر من له درجة.',
    ...(shown ? [`لتغيير الفترة أو إنهائها: اضغط «📅 ${PERIOD_NAMES[shown]}».`] : [])] };
  body.innerHTML = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}
    ${crmSheetCardHtml(s, lockKey, shown)}
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
  crmPartCardPaint();
}

function paintCrmParticipation(studentId){
  const s = crmSheet;
  const btn = document.getElementById('crmPart_' + studentId);
  if(!btn || !s || !s.part) return;
  /* من الكاملة ولم يُرصد له في هذه الفترة: يُعرض كاملًا (لا يُكتب حتى تنتهي) */
  const score = s.part.scores.has(studentId) ? s.part.scores.get(studentId) : (s.part.full ? Number(s.part.column.max_score) : null);
  /* صافي تغيّر اليوم: today يعدّ النقرات باتجاه الوضع (+1، أو −1 لمن يبدأ من الكاملة) */
  const net = (s.part.today[studentId] || 0) * (s.part.step || 1);
  btn.querySelector('.crm-part-val').innerHTML =
    `<b>${score === null ? '—' : formatScore(score)}</b><span class="crm-grade-max"> / ${formatScore(s.part.column.max_score)}</span>`;
  const chip = btn.querySelector('.crm-part-chip');
  if(chip) chip.innerHTML = net ? `<b class="crm-part-today${net < 0 ? ' is-minus' : ''}" dir="ltr">${net < 0 ? '−' : '+'}${Math.abs(net)}</b>` : '';
  btn.classList.toggle('is-full', score !== null && score >= Number(s.part.column.max_score));
  btn.classList.toggle('is-absent', !!crmAbsentClass(s, studentId));
  const undo = document.getElementById('crmPartUndoBtn');
  if(undo) undo.disabled = !s.part.undo.length;
  crmPartCardPaint(); /* كم رُصد وزر «تعبئة الباقين» */
}

/* النقرات على نفس الطالب تُرسل بالتتابع (لا تتقاطع) — والقاعدة تجمعها ذرّيًا */
/* kind: 'tap' (نقرة + أو −) أو 'undo' (تراجع عنها) — لإرجاع العرض والسجل بدقة عند الفشل */
function queueCrmParticipation(studentId, delta, kind){
  const s = crmSheet;
  const p = s.part;
  const prev = p.queue.get(studentId) || Promise.resolve();
  const next = prev.then(async () => {
    /* "يبدأ من الكاملة": الصفر درجة حقيقية لا "لم تُرصد" (وإلا أُعيد للكاملة).
       المشاركة: النقرة على درجة الفترة، والقاعدة تحدّث معدّل الكشف */
    const { data, error } = p.period
      ? await sb.rpc('increment_period_score', { p_column_id: p.column.id, p_student_id: studentId, p_period: p.period, p_delta: delta, p_full: !!p.full })
      : await sb.rpc('increment_grade_score', p.full
        ? { p_column_id: p.column.id, p_student_id: studentId, p_delta: delta, p_keep_zero: true }
        : { p_column_id: p.column.id, p_student_id: studentId, p_delta: delta });
    if(error) throw error;
    crmLogSaved(p, [studentId]);
    crmLogTouch(p, studentId);
    if(typeof invalidateAttention === 'function') invalidateAttention(); /* الدرجة تغيّرت: بطاقات الدرجات تُحسب من جديد عند الحاجة */
    if(crmSheet === s && s.part === p){
      const v = Number(data);
      if(v === 0 && delta < 0 && !p.full) p.scores.delete(studentId); else p.scores.set(studentId, v);
      paintCrmParticipation(studentId);
    }
  }).catch(e => {
    markCrmSheetFailure();
    const isTap = kind !== 'undo';
    crmLogFailed(p, [studentId], (isTap ? 'نقرة لم تُحفظ' : 'تراجع لم يُحفظ') + ' (' + (e.message || 'خطأ بالاتصال') + ')');
    showToast((isTap ? 'لم تُحفظ النقرة: ' : 'لم يُحفظ التراجع: ') + gradeSaveErrorText(e), 'error');
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
/* سطر التعبئة الصريحة (بدل «يبدأ من» الملغى) — يُستعمل في كل أوراق الرصد. buttons: [[نص، استدعاء]] */
function crmFillRowHtml(label, buttons){
  return `<div class="crm-fill-row"><span>${escapeHtml(label)}:</span>${buttons.map(([t, call]) =>
    `<button type="button" class="btn btn-outline crm-mini-btn crm-fill-btn" onclick="${call}">${escapeHtml(t)}</button>`).join('')}</div>`;
}
/* ============ بطاقة أعلى ورقة الرصد (3.62) ============
   الفترة (تفتح نافذة الفترات) · كم رُصد · زر واحد «تعبئة الباقين» (يظهر فقط إن بقي أحد) · «؟» للشرح بدل نصوص دائمة.
   s.card = { help: [html…], fill: [[value, label]…], kind: 'part'|'tool', total } */
function crmSheetCardHtml(s, lockKey, lockPeriod, subId){
  const info = sheetPeriodInfo(s);
  const chip = info && info.cfg.n > 1
    ? `<button type="button" class="csc-period" onclick="openCrmPeriodPicker()" aria-label="الفترات">📅 ${PERIOD_NAMES[info.period]}${info.cfg.ended ? ' ✓' : ''} ▾</button>` : '<span></span>';
  return `<div class="csc" id="crmSheetCard">
    <div class="csc-l1">${chip}<button type="button" class="csc-q" aria-label="كيف تعمل هذه الورقة؟" aria-expanded="false" onclick="toggleCrmSheetHelp()">؟</button></div>
    <div class="csc-l2"><div class="csc-cnt" id="crmCardCount"></div><span id="crmCardFill"></span></div>
    <div class="csc-sub" id="${subId || 'crmToolCounts'}"></div>
    <div class="csc-bar"><i id="crmCardBar"></i></div>
    ${lockKey ? crmLockBannerHtml(lockKey, lockPeriod) : ''}
  </div>
  <div id="crmSheetHelp" class="csc-help" style="display:none;"></div>
  <div id="crmFillPanel" class="csc-fill" style="display:none;"></div>`;
}

function paintCrmSheetCard(recorded, total, locked){
  const s = crmSheet;
  const cnt = document.getElementById('crmCardCount');
  if(!cnt || !s || !s.card) return;
  const missing = Math.max(0, total - recorded);
  cnt.innerHTML = `<small>${s.card.countLabel || 'رُصد'}</small> ${recorded} <small>من ${total}</small>${missing ? '' : ' <small class="csc-ok">✓</small>'}`;
  const bar = document.getElementById('crmCardBar');
  if(bar) bar.style.width = (total ? Math.round(100 * recorded / total) : 0) + '%';
  const fill = document.getElementById('crmCardFill');
  if(fill) fill.innerHTML = !locked && missing
    ? `<button type="button" class="csc-fillb crm-fill-btn" onclick="openCrmFillPanel()">${missing === 1 ? 'تعبئة الطالب الباقي' : `تعبئة الـ${missing} الباقين`}</button>` : '';
  s.card.missing = missing;
  if(!missing || locked) closeCrmFillPanel();
}

function toggleCrmSheetHelp(){
  const s = crmSheet;
  const box = document.getElementById('crmSheetHelp');
  if(!box || !s || !s.card) return;
  const open = !s.card.helpOpen; /* حالة صريحة (لا يُعتمد على style قبل أول رسم) */
  s.card.helpOpen = open;
  box.innerHTML = open ? `<button type="button" class="csc-x" aria-label="إغلاق" onclick="toggleCrmSheetHelp()">✕</button><b>كيف تعمل هذه الورقة؟</b>
    <ul>${s.card.help.map(h => `<li>${h}</li>`).join('')}</ul>` : '';
  box.style.display = open ? 'block' : 'none';
  const q = document.querySelector('.csc-q');
  if(q) q.setAttribute('aria-expanded', String(open));
}

function openCrmFillPanel(){
  const s = crmSheet;
  const box = document.getElementById('crmFillPanel');
  if(!box || !s || !s.card || !s.card.missing) return;
  s.card.pick = s.card.fill[0][0];
  const n = s.card.missing;
  const who = n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : n + ' طلاب';
  const noun = s.card.kind === 'tool' && s.tool && s.tool.tool.tool_type === 'status' ? 'رصد' : 'درجة';
  box.innerHTML = `<div class="csc-fill-t">${s.card.fillTitle ? s.card.fillTitle(who, n) : `${who} بلا ${noun} — ${n === 1 ? 'أعطِه' : 'أعطِهم'}:`}</div>
    <div class="tlx-seg" id="crmFillSeg">${s.card.fill.map(([v, l], i) => `<button type="button" class="${i ? '' : 'is-on'}" aria-pressed="${!i}" onclick="pickCrmFill(${i})">${escapeHtml(l)}</button>`).join('')}</div>
    <button type="button" class="tlx-btn is-navy crm-fill-btn" style="margin-top:8px;" onclick="confirmCrmFill()">تأكيد</button>
    <button type="button" class="tlx-btn is-ghost" style="margin-top:6px;" onclick="closeCrmFillPanel()">إلغاء</button>
    <div class="csc-fill-n">${s.card.fillNote || `من له ${noun} لا يتغيّر.`}</div>`;
  box.style.display = 'block';
}
function pickCrmFill(i){
  const s = crmSheet;
  if(!s || !s.card || !s.card.fill[i]) return;
  s.card.pick = s.card.fill[i][0];
  document.querySelectorAll('#crmFillSeg button').forEach((b, j) => { b.className = j === i ? 'is-on' : ''; b.setAttribute('aria-pressed', String(j === i)); });
}
function closeCrmFillPanel(){
  const box = document.getElementById('crmFillPanel');
  if(box){ box.style.display = 'none'; box.innerHTML = ''; }
}
async function confirmCrmFill(){
  const s = crmSheet;
  if(!s || !s.card || s.card.pick === undefined) return;
  const v = s.card.pick;
  closeCrmFillPanel();
  if(s.card.kind === 'part') await fillCrmParticipationEmpty(v, true);
  else if(s.card.kind === 'tool' && typeof fillCrmToolEmpty === 'function') await fillCrmToolEmpty(v);
  else if(s.card.kind === 'hw') await markAllCrmHomeworkSubmitted(v);
  else if(s.card.kind === 'task' && typeof fillCrmTaskEmpty === 'function') await fillCrmTaskEmpty(v);
}

function crmPartCardPaint(){
  const s = crmSheet, p = s && s.part;
  if(!p) return;
  const ids = crmStudentsOfSection(s.sectionId).map(x => x.id);
  paintCrmSheetCard(ids.filter(id => p.scores.has(id)).length, ids.length, p.locked);
}

function setCrmFillBusy(on){
  document.querySelectorAll('.crm-fill-btn').forEach(b => { b.disabled = on; });
}

/* «أعطِه 10 / 0» لمن لا درجة له في فترة الورقة: كأنه رصد يدوي (لا يمسّ من له درجة، ويُحفظ في سجل الدرجات) */
let crmPartFillBusy = false;
async function fillCrmParticipationEmpty(value, confirmed){
  const s = crmSheet;
  const p = s && s.part;
  if(!p || crmPartFillBusy) return;
  if(p.locked){ crmLockedToast(); return; }
  const ids = crmStudentsOfSection(s.sectionId).map(x => x.id).filter(id => !p.scores.has(id));
  if(!ids.length){ showToast('لا أحد بلا درجة', 'ok'); return; }
  const where = p.period > 1 ? ' في ' + PERIOD_NAMES[p.period] : '';
  if(!confirmed && !(await showConfirm(`أعطِ ${ids.length === 1 ? 'طالبًا واحدًا' : ids.length + ' طلاب'} بلا درجة${where} ${formatScore(value)} من ${formatScore(p.column.max_score)} في "${p.column.name}"؟ تُكتب كأنك رصدتها بيدك، ولا تمسّ من له درجة.`))) return;
  if(crmSheet !== s || s.part !== p || crmPartFillBusy) return; /* أُغلقت الورقة أو تغيّرت أثناء السؤال */
  crmPartFillBusy = true;
  setCrmFillBusy(true);
  try{
    await Promise.all(ids.map(id => p.queue.get(id)).filter(Boolean)); /* نقرة معلّقة لنفس الطالب تسبق التعبئة */
    const missing = ids.filter(id => !p.scores.has(id));
    const done = await fillPeriodScoresMissing(p.column, missing, p.period, value);
    if(crmSheet === s && s.part === p){ done.forEach(id => { p.scores.set(id, Number(value)); paintCrmParticipation(id); }); crmPartCardPaint(); }
    if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
    showToast(`سُجّل ${formatScore(value)} لمن لا درجة له (${done.length}) ✓`, 'ok');
  } catch(e){
    markCrmSheetFailure();
    showToast('تعذّر الحفظ: ' + gradeSaveErrorText(e), 'error');
    if(crmSheet === s) setCrmSheetMode(s.mode);
  } finally {
    crmPartFillBusy = false;
    setCrmFillBusy(false);
  }
}

function tapCrmParticipation(studentId, dir){
  const s = crmSheet;
  if(!s || !s.part) return;
  const p = s.part;
  if(p.locked){ crmLockedToast(); return; }
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
  if(p.locked){ crmLockedToast(); return; }
  const entry = p.undo.pop();
  const opposite = entry.charAt(0) === '~';
  const studentId = opposite ? entry.slice(1) : entry;
  const step = p.step || 1;
  const dir = opposite ? -step : step; /* اتجاه النقرة التي نتراجع عنها */
  const cur = p.scores.has(studentId) ? p.scores.get(studentId) : (p.full ? Number(p.column.max_score) : 0);
  const back = cur - dir;
  if(back <= 0 && dir > 0 && !p.full) p.scores.delete(studentId); else p.scores.set(studentId, Math.max(0, Math.min(Number(p.column.max_score), back)));
  p.today[studentId] = (p.today[studentId] || 0) - (opposite ? -1 : 1);
  writeParticipationState(s, p);
  paintCrmParticipation(studentId);
  queueCrmParticipation(studentId, -dir, 'undo');
}

/* ============ الطالب الغائب (المشاركة والأدوات) ============ */
/* مسجّل غائب في الحصة: عليه "غائب" بلون واضح، ويُرصد له + و− عاديًا بلا سؤال
   (حضوره يُغيَّر من تبويب "حضور" فقط) */
function crmAbsentClass(s, studentId){
  return s && s.states && s.states[studentId] === 'absent' ? ' is-absent' : '';
}

/* ============ وضع الواجب ============ */
/* ============ قائمة الواجبات: بطاقات مجمّعة بالفترة (3.64) ============
   الفترة الجارية مفتوحة، والمنتهية مطوية (تُفتح بنقرة). كل بطاقة: العنوان، والموعد، و«سلّم X من Y». */
let crmHwOpenPeriods = null; /* { key: 'section|term', open: Set } — يبقى أثناء الجلسة */
function crmHwListHtml(s, hw, selectedId, students, term){
  const cfg = periodCfg(term, 'kind:homework');
  const now = currentPeriodOf(cfg);
  const ids = students.map(st => st.id);
  const idSet = new Set(ids);
  const done = new Map();
  (hw.statusRows || []).forEach(r => { if(idSet.has(r.student_id)) done.set(r.homework_id, (done.get(r.homework_id) || 0) + 1); });
  const perOf = h => cfg.n > 1 ? Math.min(cfg.n, periodOfDateFor(h.due_date, cfg.starts)) : 1;
  const sel = hw.homeworks.find(h => h.id === selectedId);
  const k = s.sectionId + '|' + termPeriodKey(term);
  if(!crmHwOpenPeriods || crmHwOpenPeriods.key !== k) crmHwOpenPeriods = { key: k, open: new Set([now]) };
  if(sel) crmHwOpenPeriods.open.add(perOf(sel));
  const card = h => {
    const n = done.get(h.id) || 0;
    const on = h.id === selectedId;
    return `<div class="hwc${on ? ' is-on' : ''}" role="button" tabindex="0" aria-pressed="${on}" onclick="selectCrmHomework('${h.id}')">
      <div class="hwc-t"><span>${escapeHtml(h.title)}</span>${on ? `<button type="button" class="hwc-edit" aria-label="تعديل الواجب" onclick="event.stopPropagation();openCrmHomeworkEditor('${h.id}')">✎</button>` : ''}</div>
      <div class="hwc-m"><span>${escapeHtml(shortDateAr(h.due_date))}</span><span${on ? ' id="crmHwSelCount"' : ''}>سلّم ${n} من ${ids.length}</span></div>
      <div class="hwc-b"><i${on ? ' id="crmHwSelBar"' : ''} style="width:${ids.length ? Math.round(100 * n / ids.length) : 0}%"></i></div></div>`;
  };
  const add = '<button type="button" class="btn btn-outline crm-mini-btn" onclick="openCrmHomeworkModal()">+ واجب</button>';
  if(cfg.n < 2){
    return `<div class="hwg-h"><span>الواجبات</span>${add}</div><div class="hwl">${hw.homeworks.slice().reverse().map(card).join('')}</div>`;
  }
  const lock = periodLockOf(term, 'kind:homework');
  const groups = [];
  for(let p = cfg.n; p >= 1; p--){
    const list = hw.homeworks.filter(h => perOf(h) === p).slice().reverse();
    if(p > now && !list.length) continue;
    const state = lock && p <= lock.p ? '🔒 ' : '';
    const label = `${state}${PERIOD_NAMES[p]}${p === now && !cfg.ended ? ' · جارية' : ''}`;
    const open = crmHwOpenPeriods.open.has(p);
    if(p === now){
      groups.push(`<div class="hwg-h"><span>${label}</span>${add}</div><div class="hwl">${list.length ? list.map(card).join('') : '<div class="hwl-empty">لا واجبات في هذه الفترة بعد.</div>'}</div>`);
    } else {
      groups.push(`<button type="button" class="hwg-c" aria-expanded="${open}" onclick="toggleCrmHwPeriod(${p})"><span>${label} · ${list.length === 1 ? 'واجب واحد' : list.length === 2 ? 'واجبان' : list.length + ' واجبات'}</span><span>${open ? '▾' : '◂'}</span></button>
        ${open ? `<div class="hwl">${list.map(card).join('')}</div>` : ''}`);
    }
  }
  return groups.join('');
}
function selectCrmHomework(id){
  const s = crmSheet;
  if(!s || !s.hw || s.mode !== 'homework') return;
  renderCrmHomework(crmStudentsOfSection(s.sectionId), id);
}
function toggleCrmHwPeriod(p){
  const s = crmSheet;
  if(!s || !s.hw || !crmHwOpenPeriods) return;
  if(crmHwOpenPeriods.open.has(p)) crmHwOpenPeriods.open.delete(p); else crmHwOpenPeriods.open.add(p);
  renderCrmHomework(crmStudentsOfSection(s.sectionId), s.hw.selectedId);
}

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
  s.hw = { data: hw, column, selectedId, queue: new Map(), term, chgKey: 'hw:' + selectedId };
  if(!hw.homeworks.length){
    body.innerHTML = head + `<div class="empty-state">لا واجبات لهذه الشعبة بعد.</div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="openCrmHomeworkModal()">+ واجب جديد</button>
      <div class="crm-sheet-bar"><button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button></div>`;
    return;
  }
  const statuses = homeworkStatusIndex(hw.statusRows).get(selectedId) || new Map();
  const hcfg = periodCfg(term, 'kind:homework'), perOn = hcfg.n > 1;
  const selHw = hw.homeworks.find(h => h.id === selectedId);
  const hwLocked = isLockableKey('kind:homework') && isPeriodLocked(term, 'kind:homework', { date: selHw.due_date });
  s.hw.locked = hwLocked;
  const hwPer = perOn ? Math.min(hcfg.n, periodOfDateFor(selHw.due_date, hcfg.starts)) : null;
  s.card = { kind: 'hw', countLabel: 'سلّم',
    fill: [['submitted', 'سلّم'], ['late', 'متأخر'], ['partial', 'ناقص']],
    fillTitle: (who, n) => `${who} «لم ${n === 1 ? 'يسلّم' : 'يسلّموا'}» — ${n === 1 ? 'اجعله' : 'اجعلهم'}:`,
    fillNote: 'من رُصد له لا يتغيّر.',
    help: ['الأصل «لم يسلّم». اضغط على الطالب: سلّم ← ناقص ← متأخر ← لم يسلّم. يُحفظ فورًا.',
      column ? `يُحسب في عمود «${escapeHtml(column.name)}» في الكشف (سلّم كاملة، متأخر ثلاثة أرباع، ناقص نصف).` : 'أضف عمود واجبات في الكشف ليُحسب تلقائيًا.',
      ...(perOn ? [`كل واجب في فترة موعد تسليمه — هذا الواجب في <b>${PERIOD_NAMES[hwPer]}</b>.`] : []),
      '«تعبئة الباقين» تغيّر من «لم يسلّم» فقط، ولا تمسّ من رُصد له.',
      'لإضافة واجب: «+ واجب». ولتعديله أو حذفه: ✎ على بطاقته.'] };
  body.innerHTML = `<div class="crm-sheet-head">${crmSheetHeaderText(s)}</div>${crmSheetModeSwitchHtml()}` + `
    ${crmHwListHtml(s, hw, selectedId, students, term)}
    ${crmSheetCardHtml(s, hwLocked ? 'kind:homework' : null, hwPer, 'crmHwCounts')}
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn" id="crmHw_${st.id}" onclick="tapCrmHomework('${st.id}')">
          <span class="crm-att-name">${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      ${crmSheetFinishBtnHtml()}
      <button class="btn btn-outline" style="flex:1;" onclick="closeCrmLessonSheet()">رجوع</button>
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
  const ids = crmStudentsOfSection(crmSheet.sectionId).map(x => x.id);
  const c = homeworkCounts(crmSheet.hw.statuses, ids);
  el.textContent = [c.partial ? `ناقص ${c.partial}` : '', c.late ? `متأخر ${c.late}` : '', c.missing ? `لم يسلّم ${c.missing}` : ''].filter(Boolean).join(' · ');
  if(crmSheet.card && crmSheet.card.kind === 'hw') paintCrmSheetCard(ids.length - c.missing, ids.length, crmSheet.hw.locked);
  const selCount = document.getElementById('crmHwSelCount'), selBar = document.getElementById('crmHwSelBar');
  if(selCount) selCount.textContent = `سلّم ${ids.length - c.missing} من ${ids.length}`;
  if(selBar) selBar.style.width = (ids.length ? Math.round(100 * (ids.length - c.missing) / ids.length) : 0) + '%';
}

/* حفظ حالة طالب ثم إعادة حساب درجته — بالتتابع لكل طالب */
function persistCrmHomework(studentId, state, prevState){
  const s = crmSheet;
  const h = s.hw;
  const hwId = h.selectedId;
  const prev = h.queue.get(studentId) || Promise.resolve();
  let stored = false; /* الحالة حُفظت (فشل تحديث العمود بعدها لا يجعلها "لم تُحفظ") */
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
    stored = true;
    crmLogSaved(h, [studentId]);
    crmLogChange(h, studentId, prevState || 'missing', state);
    await syncHomeworkColumn(h.column, s.sectionId, h.data, [studentId]);
  }).catch(e => { markCrmSheetFailure(); if(!stored) crmLogFailed(h, [studentId], e.message || 'خطأ بالاتصال'); showToast('لم يُحفظ الواجب: ' + (e.message || 'خطأ بالاتصال') + ' — أعد النقر', 'error'); });
  h.queue.set(studentId, next);
  return next;
}

function tapCrmHomework(studentId){
  const s = crmSheet;
  if(!s || !s.hw || !s.hw.selectedId) return;
  if(s.hw.locked){ crmLockedToast(); return; }
  const before = s.hw.statuses.get(studentId) || 'missing';
  const st = nextHomeworkState(before);
  if(st === 'missing') s.hw.statuses.delete(studentId); else s.hw.statuses.set(studentId, st);
  paintCrmHomework(studentId);
  paintCrmHomeworkCounts();
  persistCrmHomework(studentId, st, before);
}

let crmHwBulkBusy = false;
async function markAllCrmHomeworkSubmitted(status){
  const s = crmSheet;
  status = status || 'submitted';
  if(!s || !s.hw || !s.hw.selectedId || crmHwBulkBusy || status === 'missing' || HOMEWORK_CYCLE.indexOf(status) === -1) return;
  if(s.hw.locked){ crmLockedToast(); return; }
  const ids = crmStudentsOfSection(s.sectionId).map(x => x.id).filter(id => !s.hw.statuses.has(id));
  if(!ids.length) return;
  crmHwBulkBusy = true;
  const uid = currentUser.id, hwId = s.hw.selectedId;
  const h = s.hw;
  let stored = false;
  ids.forEach(id => { s.hw.statuses.set(id, status); paintCrmHomework(id); });
  paintCrmHomeworkCounts();
  try{
    const { error } = await sb.from('classroom_homework_status').upsert(
      ids.map(id => ({ teacher_id: uid, homework_id: hwId, student_id: id, status, updated_at: new Date().toISOString() })),
      { onConflict: 'homework_id,student_id', ignoreDuplicates: true }); /* لا يكتب فوق رصد متزامن */
    if(error) throw error;
    ids.forEach(id => s.hw.data.statusRows.push({ homework_id: hwId, student_id: id, status }));
    stored = true;
    crmLogSaved(h, ids);
    ids.forEach(id => crmLogChange(h, id, 'missing', status));
    await syncHomeworkColumn(s.hw.column, s.sectionId, s.hw.data, ids);
    showToast(`سُجّل "${HOMEWORK_LABELS[status]}" للباقين ✓`, 'ok');
  } catch(e){
    markCrmSheetFailure();
    if(!stored) crmLogFailed(h, ids, e.message || 'خطأ بالاتصال');
    showToast('تعذّر الحفظ: ' + gradeSaveErrorText(e), 'error');
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
      ${edit ? '' : `<label class="crm-field-label">يبدأ الطلاب</label>
      <div class="crm-seg" style="margin-bottom:10px;">
        <button type="button" id="crmHwStart0" class="is-on" aria-pressed="true" onclick="setCrmHwStart(false)">لم يُرصد</button>
        <button type="button" id="crmHwStart1" aria-pressed="false" onclick="setCrmHwStart(true)">الجميع سلّم</button>
      </div>`}
      <button class="btn btn-primary" id="crmHwSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmHomework()">${edit ? 'حفظ التعديل' : 'حفظ الواجب'}</button>
      ${edit ? `<button class="btn btn-outline" id="crmHwDeleteBtn" style="width:100%;justify-content:center;margin-top:8px;color:#8A2C2C;" onclick="deleteCrmHomework('${h.id}', '${sectionId}')">حذف الواجب</button>` : ''}
    </div>`;
}

/* سؤال الإنشاء: «الجميع سلّم» يُكتب مرة واحدة عند الحفظ (ثم تضغط على المقصّرين) */
function setCrmHwStart(on){
  if(!crmHomeworkDraft || crmHomeworkDraft.editId) return;
  crmHomeworkDraft.startSubmitted = !!on;
  [['crmHwStart0', !on], ['crmHwStart1', !!on]].forEach(([id, v]) => {
    const b = document.getElementById(id);
    if(b){ b.className = v ? 'is-on' : ''; b.setAttribute('aria-pressed', String(v)); }
  });
}

function openCrmHomeworkModal(sectionIdArg){
  const sectionId = sectionIdArg || (crmSheet && crmSheet.sectionId) || (crmGrades && crmGrades.sectionId);
  if(!sectionId) return;
  crmHomeworkDraft = { sectionId, saving: false, startSubmitted: false };
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
  /* سؤال الإنشاء (بدل «يبدأ من» الملغى): «الجميع سلّم» تُكتب مرة واحدة كأنها رصد يدوي */
  if(!d.editId && id && d.startSubmitted === true){
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
  const ok = await showConfirm('حذف هذا الواجب؟ يُحذف معه رصد تسليمه، وتُعاد حساب درجات الواجبات. يبقى في «المحذوفات» ' + TRASH_DAYS + ' يومًا.');
  if(!ok) return;
  if(crmHwDeleting) return;
  crmHwDeleting = true;
  try{
    /* نقرات تسليم معلّقة على هذا الواجب تنتهي أولًا، لا تصطدم بحذفه */
    const s = crmSheet;
    if(s && s.hw && s.hw.queue) await Promise.all([...s.hw.queue.values()]);
    const uid = currentUser.id;
    const prot = await trashProtect(() => trashCaptureHomework(id, uid));
    if(!prot) return;
    const { data, error } = await sb.from('classroom_homework').delete()
      .eq('teacher_id', uid).eq('id', id).select('id');
    if(error){ await trashDiscard(prot.id); throw error; }
    if((data || []).length) trashOfferUndo('حُذف الواجب', prot.id, async () => { await afterCrmHomeworkChanged(sectionId, null, true); });
    else { await trashDiscard(prot.id); showToast('الواجب محذوف مسبقًا', 'ok'); }
  } catch(e){
    showToast('تعذّر الحذف: ' + (e.message || ''), 'error');
    return;
  } finally {
    crmHwDeleting = false;
  }
  await afterCrmHomeworkChanged(sectionId, null, true);
}
