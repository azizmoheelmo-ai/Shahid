'use strict';
/* ============================================================
   (14) إدارة الصف — "اليوم" + الجدول الأسبوعي + ورقة رصد الحصة
   ------------------------------------------------------------
   الدفعة 2 من إعادة تصميم إدارة الصف:
   - الجدول الأسبوعي (اختياري): يوم + رقم حصة ← شعبة. بلا أوقات عمدًا —
     أوقات الحصص تتغير (رمضان، الاختبارات، الأيام المختصرة) فتصير "الحصة
     الآن" خاطئة؛ بدلها نُبرز أول حصة لم تُرصد اليوم.
   - "اليوم": حصص اليوم بحالتها، الحصص غير المرصودة آخر 7 أيام، وشعبي.
   - ورقة الحصة: الأصل "حاضر"، نقرة تبدّل الحالة (غائب ← متأخر ← مستأذن)،
     والحفظ عملية واحدة بالقاعدة (save_lesson_attendance) حتى لا تبقى حصة
     "مرصودة" بلا غيابها. الحصة غير المحفوظة ليست "حضورًا".
   - مسودة محلية لكل حصة: الاتصال بالفصول ضعيف غالبًا، ولا يجوز أن يضيع رصد
     حصة لأن الحفظ فشل. تُخزَّن معرّفات الطلاب وحالاتهم فقط (لا أسماء)،
     مربوطة بالمستخدم الحالي، وتُحذف فور نجاح الحفظ أو بعد 3 أيام.

   كل استعلام هنا مُقيَّد صراحة بـ.eq('teacher_id', currentUser.id) — لا
   اعتماد على RLS وحدها (هذه الجداول بلا سياسة للمسؤول أصلًا، لكن الانضباط
   نفسه يمنع أي تسرّب لو أُضيفت سياسة كهذه لاحقًا).
   ============================================================ */

const ATTENDANCE_CYCLE = ['present', 'absent', 'late', 'permitted_exit'];
const ATTENDANCE_LABELS = { present: 'حاضر', absent: 'غائب', late: 'متأخر', permitted_exit: 'مستأذن' };
const CRM_WEEKDAYS = [
  { value: 0, label: 'الأحد' }, { value: 1, label: 'الاثنين' }, { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' }, { value: 4, label: 'الخميس' }
];
const CRM_WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const CRM_MAX_PERIODS = 8;
const LESSON_DRAFT_PREFIX = 'crm_lesson_draft:';
const LESSON_DRAFT_MAX_AGE_MS = 3 * 86400000;

/* ============================================================
   دوال صرفة (قابلة للاختبار بمعزل عن الشبكة والـDOM)
   ============================================================ */

/* تاريخ محلي YYYY-MM-DD — لا toISOString (UTC): بين منتصف الليل والثالثة
   فجرًا بتوقيت السعودية يعطي تاريخ الأمس */
function localIsoDate(d){
  const x = d || new Date();
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}

function addDaysIso(iso, days){
  const [y, m, d] = iso.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

function weekdayOfIso(iso){
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function nextAttendanceState(state){
  const i = ATTENDANCE_CYCLE.indexOf(state);
  return ATTENDANCE_CYCLE[(i + 1) % ATTENDANCE_CYCLE.length];
}

/* الاستثناءات فقط تُرسَل للحفظ — "حاضر" هو غياب الصف أصلًا */
function exceptionsFromStates(states){
  return Object.keys(states || {})
    .filter(id => states[id] && states[id] !== 'present')
    .map(id => ({ student_id: id, status: states[id] }));
}

function attendanceCounts(states){
  const c = { absent: 0, late: 0, permitted_exit: 0 };
  Object.values(states || {}).forEach(s => { if(c[s] !== undefined) c[s]++; });
  return c;
}

function crmSemesterNumber(label){
  return String(label || '').indexOf('الثاني') !== -1 ? 2 : 1;
}

function lessonKey(sectionId, dateIso, period){
  return sectionId + '|' + dateIso + '|' + (period == null ? '' : period);
}

/* حصص يوم مُعطى من الجدول، مرتبة بالرقم، مع حالة الرصد. أول حصة لم تُرصد
   هي "التالية" المُبرزة (بدل "الحصة الآن" المعتمدة على الساعة). */
function planDayLessons(slots, dateIso, lessons, skips){
  const wd = weekdayOfIso(dateIso);
  const recorded = new Map((lessons || []).filter(l => l.lesson_date === dateIso)
    .map(l => [lessonKey(l.section_id, l.lesson_date, l.period), l]));
  const skipped = new Map((skips || []).filter(k => k.lesson_date === dateIso)
    .map(k => [lessonKey(k.section_id, k.lesson_date, k.period), k]));
  const rows = (slots || []).filter(s => s.weekday === wd)
    .sort((a, b) => a.period - b.period)
    .map(s => {
      const key = lessonKey(s.section_id, dateIso, s.period);
      const l = recorded.get(key);
      /* رُصدت بعد "لم أحضر" (رجع وحضرها) = الرصد يغلب */
      return { period: s.period, section_id: s.section_id, recorded: !!l, lessonId: l ? l.id : null, skip: l ? null : (skipped.get(key) || null) };
    });
  const next = rows.findIndex(r => !r.recorded && !r.skip);
  return { rows, nextIndex: next };
}

/* حصص الجدول خلال الأيام السابقة (لا اليوم) التي لم تُرصد ولم تُعلَّم "لم أحضر". لا نعدّ يومًا
   قبل إضافة الخانة للجدول (جدول أُدخل اليوم لا يجعل الأسبوع الماضي كله
   "غير مرصود")، ولا يوم إجازة رسمية. */
function findUnrecordedLessons(slots, lessons, todayIso, days, isHoliday, skips){
  /* "لم أحضر" تُعامل كالمرصودة هنا: ليست منسية */
  const recorded = new Set((lessons || []).concat(skips || []).map(l => lessonKey(l.section_id, l.lesson_date, l.period)));
  const out = [];
  for(let back = days; back >= 1; back--){
    const dateIso = addDaysIso(todayIso, -back);
    if(isHoliday && isHoliday(dateIso)) continue;
    const wd = weekdayOfIso(dateIso);
    (slots || []).forEach(s => {
      if(s.weekday !== wd) return;
      const createdIso = s.created_at ? localIsoDate(new Date(s.created_at)) : '';
      if(createdIso && dateIso < createdIso) return;
      if(!recorded.has(lessonKey(s.section_id, dateIso, s.period))){
        out.push({ date: dateIso, weekday: wd, period: s.period, section_id: s.section_id });
      }
    });
  }
  return out.sort((a, b) => (a.date + String(a.period).padStart(2, '0')).localeCompare(b.date + String(b.period).padStart(2, '0')));
}

/* نسبة حضور شعبة خلال حصص مرصودة: 1 − الغياب ÷ (عدد الحصص × عدد الطلاب).
   المتأخر والمستأذن حاضران هنا (حضرا الحصة). بلا حصص مرصودة = null، لا 100%. */
function sectionAttendanceRate(lessons, attendanceRows, studentCount){
  const n = (lessons || []).length;
  if(!n || !studentCount) return null;
  const ids = new Set(lessons.map(l => l.id));
  const absences = (attendanceRows || []).filter(a => ids.has(a.lesson_id) && a.status === 'absent').length;
  return Math.max(0, Math.round(100 * (1 - absences / (n * studentCount))));
}

/* مسودة صالحة = تخص طلابًا ما زالوا بالشعبة، وغير منتهية */
function sanitizeLessonDraft(draft, studentIds, nowMs){
  if(!draft || typeof draft !== 'object' || !draft.states || typeof draft.at !== 'number') return null;
  if(nowMs - draft.at > LESSON_DRAFT_MAX_AGE_MS) return null;
  const allowed = new Set(studentIds || []);
  const states = {};
  Object.keys(draft.states).forEach(id => {
    if(allowed.has(id) && ATTENDANCE_CYCLE.includes(draft.states[id])) states[id] = draft.states[id];
  });
  return { states, at: draft.at };
}

/* ============================================================
   المسودة المحلية
   ============================================================ */
function lessonDraftKey(sectionId, dateIso, period){
  return LESSON_DRAFT_PREFIX + currentUser.id + ':' + lessonKey(sectionId, dateIso, period);
}

function readLessonDraft(sectionId, dateIso, period){
  try{
    const raw = localStorage.getItem(lessonDraftKey(sectionId, dateIso, period));
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}

function writeLessonDraft(sectionId, dateIso, period, states){
  try{ localStorage.setItem(lessonDraftKey(sectionId, dateIso, period), JSON.stringify({ states, at: Date.now() })); }
  catch(e){ /* تخزين محلي غير متاح (وضع خاص/ممتلئ) — الرصد يبقى بالذاكرة حتى الحفظ */ }
}

function clearLessonDraft(sectionId, dateIso, period){
  try{ localStorage.removeItem(lessonDraftKey(sectionId, dateIso, period)); } catch(e){}
}

/* تنظيف المسودات المنتهية — أسماء الطلاب لا تُخزَّن أصلًا، لكن لا داعي
   لبقاء أي أثر قديم على جهاز قد يكون مشتركًا */
function pruneLessonDrafts(){
  try{
    const now = Date.now();
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(!k || k.indexOf(LESSON_DRAFT_PREFIX) !== 0) continue;
      try{
        const d = JSON.parse(localStorage.getItem(k));
        if(!d || typeof d.at !== 'number' || now - d.at > LESSON_DRAFT_MAX_AGE_MS) localStorage.removeItem(k);
      } catch(e){ localStorage.removeItem(k); }
    }
  } catch(e){}
}

/* ============================================================
   تحميل البيانات
   ============================================================ */
let crmTimetableSlots = [];

function crmCurrentTerm(){
  return {
    year: document.getElementById('crmYearInput').value,
    semester: crmSemesterNumber(document.getElementById('crmSemesterSelect').value)
  };
}

async function loadCrmTimetable(){
  const { year, semester } = crmCurrentTerm();
  const { data, error } = await sb.from('classroom_timetable_slots')
    .select('id, section_id, weekday, period, created_at')
    .eq('teacher_id', currentUser.id).eq('academic_year', year).eq('semester', semester);
  if(error){ showToast('تعذّر تحميل الجدول: ' + error.message, 'error'); return false; }
  /* الخانة لشعبة من سنة أخرى أو شعبة لم تعد محمّلة لا تُعرض */
  crmTimetableSlots = (data || []).filter(s => crmSections.some(sec => sec.id === s.section_id));
  return true;
}

function crmSectionById(id){ return crmSections.find(s => s.id === id) || null; }

function crmSectionLabel(id){
  const sec = crmSectionById(id);
  return sec ? crmSectionOptionLabel(sec) : 'شعبة محذوفة';
}

function crmStudentsOfSection(sectionId){
  return crmStudents.filter(s => s.section_id === sectionId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
}

/* ============================================================
   تبويب "اليوم"
   ============================================================ */
let crmTodayRenderToken = 0;

async function renderCrmToday(){
  const box = document.getElementById('crmTodayBody');
  if(!box) return;
  const token = ++crmTodayRenderToken;
  const todayIso = localIsoDate();
  box.innerHTML = '<div class="loading-state">جارٍ التحميل...</div>';

  const since = addDaysIso(todayIso, -7);
  const [ttOk, lessonsRes, holidayCheck, attention, skipsRes, plans] = await Promise.all([
    loadCrmTimetable(),
    sb.from('classroom_lessons').select('id, section_id, lesson_date, period, updated_at')
      .eq('teacher_id', currentUser.id).gte('lesson_date', since).lte('lesson_date', todayIso),
    crmHolidayChecker(),
    getAttentionFresh(),
    sb.from('classroom_lesson_skips').select('id, section_id, lesson_date, period, note')
      .eq('teacher_id', currentUser.id).gte('lesson_date', since).lte('lesson_date', todayIso),
    loadLessonPlans().catch(() => null)
  ]);
  if(token !== crmTodayRenderToken) return; /* طُلب رسم أحدث أثناء الانتظار (تغيّر الفصل/السنة) */
  if(!ttOk || lessonsRes.error){
    box.innerHTML = '<div class="empty-state">تعذّر تحميل بيانات اليوم. <button class="btn btn-outline" style="padding:3px 10px;font-size:11.5px;" onclick="renderCrmToday()">إعادة المحاولة</button></div>';
    return;
  }
  const lessons = (lessonsRes.data || []).filter(l => crmSectionById(l.section_id));
  /* فشل تحميل "لم أحضر" لا يعطّل التبويب: تظهر الحصص كغير مرصودة فقط */
  const skips = skipsRes && !skipsRes.error ? (skipsRes.data || []) : [];
  crmTodayLoaded = { lessons, skips };
  let attendance = [];
  if(lessons.length){
    const { data: att, error: aErr } = await sb.from('classroom_attendance').select('lesson_id, status')
      .eq('teacher_id', currentUser.id).in('lesson_id', lessons.map(l => l.id));
    if(token !== crmTodayRenderToken) return;
    if(!aErr) attendance = att || [];
  }

  const todayName = CRM_WEEKDAY_NAMES[weekdayOfIso(todayIso)];
  let dateText = todayIso;
  try{ dateText = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long' }).format(new Date()); } catch(e){}
  const holidayName = holidayCheck.nameFor(todayIso);

  let html = `<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:10px;">${todayName} ${escapeHtml(dateText)}</div>`;

  if(!crmSections.length){
    box.innerHTML = html + '<div class="empty-state">ابدأ من تبويب "الطلاب": أضف المرحلة والشعب، ثم طلابك. بعدها تستطيع رصد الحصص من هنا.</div>';
    return;
  }

  /* ---- حصص اليوم ---- */
  html += '<div class="crm-today-card"><div class="crm-today-title">حصص اليوم</div>';
  if(holidayName){
    html += `<div class="crm-today-empty">إجازة: ${escapeHtml(holidayName)}</div>`;
  } else if(!crmTimetableSlots.length){
    html += `<div class="crm-today-empty">لم تضبط جدولك الأسبوعي (اختياري — يجعل رصد حصة اليوم بنقرة). <a href="#" onclick="event.preventDefault();openCrmTimetableEditor()">ضبط الجدول</a></div>`;
    html += crmSectionButtonsHtml(todayIso);
  } else {
    const plan = planDayLessons(crmTimetableSlots, todayIso, lessons, skips);
    if(!plan.rows.length){
      html += '<div class="crm-today-empty">لا حصص في جدولك اليوم.</div>';
    } else {
      html += plan.rows.map((r, i) => {
        const label = escapeHtml(crmSectionLabel(r.section_id));
        const isNext = i === plan.nextIndex;
        const action = r.recorded
          ? `<span class="crm-lesson-done">مرصودة ✓</span><button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${r.section_id}','${todayIso}',${r.period})">تعديل</button>`
          : r.skip
            ? `<button class="btn btn-outline crm-mini-btn" onclick="undoCrmLessonSkip('${r.skip.id}')">تراجع</button>`
            : `<button class="crm-skip-btn" onclick="openCrmSkipModal('${r.section_id}','${todayIso}',${r.period})">لم أحضر</button><button class="btn ${isNext ? 'btn-primary' : 'btn-outline'} crm-mini-btn" onclick="openCrmLessonSheet('${r.section_id}','${todayIso}',${r.period})">رصد</button>`;
        const skipText = r.skip ? `<div class="crm-skip-note">لم تحضرها${r.skip.note ? ' — ' + escapeHtml(r.skip.note) : ''}</div>` : '';
        return `<div class="crm-lesson-row${isNext ? ' is-next' : ''}${r.skip ? ' is-skipped' : ''}">
          <span><b>الحصة ${r.period}</b> · ${label}${skipText}${planBadgeForLesson(plans, todayIso, r.section_id, r.period)}</span>
          <span class="crm-lesson-actions">${action}</span>
        </div>`;
      }).join('');
    }
  }
  html += `<div style="margin-top:8px;"><a href="#" style="font-size:11.5px;" onclick="event.preventDefault();toggleCrmExtraLesson()">+ رصد حصة خارج الجدول</a></div>
    <div id="crmExtraLessonBox" style="display:none;margin-top:6px;">${crmSectionButtonsHtml(todayIso)}</div>`;
  html += '</div>';

  /* ---- خططي (أخطط ← أنفّذ ← أوثّق) ---- */
  html += lessonPlansTodayHtml(plans, todayIso);

  /* ---- يحتاج انتباهي (أعلى 5) ---- */
  html += attentionTodaySectionHtml(attention);

  /* ---- غير المرصود ---- */
  const unrecorded = findUnrecordedLessons(crmTimetableSlots, lessons, todayIso, 7, d => !!holidayCheck.nameFor(d), skips);
  if(unrecorded.length){
    html += `<div class="crm-today-card crm-today-warn"><div class="crm-today-title">⚠ لم تُرصد (آخر 7 أيام): ${unrecorded.length}</div>`;
    html += unrecorded.map(u => `<div class="crm-lesson-row">
        <span>${CRM_WEEKDAY_NAMES[u.weekday]} ${u.date.slice(5).replace('-', '/')} · الحصة ${u.period} · ${escapeHtml(crmSectionLabel(u.section_id))}</span>
        <span class="crm-lesson-actions"><button class="crm-skip-btn" onclick="openCrmSkipModal('${u.section_id}','${u.date}',${u.period})">لم أحضر</button><button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${u.section_id}','${u.date}',${u.period})">رصد</button></span>
      </div>`).join('');
    html += '</div>';
  }

  /* ---- شعبي ---- */
  html += '<div class="crm-today-card"><div class="crm-today-title">شعبي</div>';
  const sortedSections = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  html += sortedSections.map(sec => {
    const studentCount = crmStudentsOfSection(sec.id).length;
    const secLessons = lessons.filter(l => l.section_id === sec.id);
    const rate = sectionAttendanceRate(secLessons, attendance, studentCount);
    const rateText = rate === null ? 'لا رصد هذا الأسبوع' : `حضور الأسبوع ${rate}%`;
    return `<div class="crm-lesson-row"><span>${escapeHtml(crmSectionOptionLabel(sec))}</span>
      <span style="font-size:11.5px;color:var(--muted);">${studentCount ? arabicCountPhrase(studentCount, CRM_STUDENT_COUNT_FORMS) : 'لا طلاب مربوطون'} · ${rateText}</span></div>`;
  }).join('');
  html += '</div>';

  box.innerHTML = html;
}

/* ============================================================
   "لم أحضر": حصة غبت عنها (مناسبة رسمية...). لا تُعدّ مرصودة ولا تدخل أي
   حساب للطلاب — فقط تُسكت "لم تُرصد" وتنقل الإبراز للحصة التالية.
   ============================================================ */
let crmTodayLoaded = { lessons: [], skips: [] };
let crmLessonSkip = null; /* { sectionId, dateIso, period, saving } */
let crmSkipUndoing = false;

function openCrmSkipModal(sectionId, dateIso, period){
  /* حصص نفس اليوم الأخرى غير المرصودة: تُحدَّد معًا (غبت عن الرابعة والخامسة) */
  const others = planDayLessons(crmTimetableSlots, dateIso, crmTodayLoaded.lessons, crmTodayLoaded.skips).rows
    .filter(r => !r.recorded && !r.skip && !(r.section_id === sectionId && r.period === period));
  crmLessonSkip = { sectionId, dateIso, period, saving: false };
  const dayLabel = dateIso === localIsoDate() ? 'اليوم' : CRM_WEEKDAY_NAMES[weekdayOfIso(dateIso)] + ' ' + dateIso.slice(5).replace('-', '/');
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">لم أحضر</h3>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${escapeHtml(dayLabel)} · الحصة ${period} · ${escapeHtml(crmSectionLabel(sectionId))}</div>
      ${others.length ? `<div style="font-size:12px;margin-bottom:6px;">وأيضًا من حصص ${escapeHtml(dayLabel)}:</div>
        ${others.map(r => `<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;padding:4px 0;">
          <input type="checkbox" class="crm-skip-extra" data-section="${r.section_id}" data-period="${r.period}"> الحصة ${r.period} · ${escapeHtml(crmSectionLabel(r.section_id))}</label>`).join('')}` : ''}
      <textarea class="goal-input" id="crmSkipNote" maxlength="300" rows="2" placeholder="ملاحظة (اختياري)" style="margin:8px 0;"></textarea>
      <button class="btn btn-primary" id="crmSkipSaveBtn" style="width:100%;justify-content:center;" onclick="saveCrmLessonSkip()">حفظ</button>
    </div>`, '400px');
}

async function saveCrmLessonSkip(){
  const sk = crmLessonSkip;
  if(!sk || sk.saving) return;
  const note = (document.getElementById('crmSkipNote').value || '').trim().slice(0, 300) || null;
  const targets = [{ section_id: sk.sectionId, period: sk.period }];
  document.querySelectorAll('.crm-skip-extra').forEach(cb => {
    if(cb.checked) targets.push({ section_id: cb.dataset.section, period: Number(cb.dataset.period) });
  });
  sk.saving = true;
  const btn = document.getElementById('crmSkipSaveBtn');
  if(btn) btn.disabled = true;
  /* upsert: لو علّمها من جهاز آخر قبلك لا يفشل الحفظ بتكرار */
  const { error } = await sb.from('classroom_lesson_skips').upsert(
    targets.map(t => ({ teacher_id: currentUser.id, section_id: t.section_id, lesson_date: sk.dateIso, period: t.period, note })),
    { onConflict: 'teacher_id,section_id,lesson_date,period', ignoreDuplicates: true }
  );
  if(error){
    showToast('تعذّر الحفظ: ' + error.message, 'error');
    sk.saving = false;
    if(btn) btn.disabled = false;
    return;
  }
  closeCrmModal();
  renderCrmToday();
}

async function undoCrmLessonSkip(skipId){
  if(crmSkipUndoing) return;
  crmSkipUndoing = true;
  const { error } = await sb.from('classroom_lesson_skips').delete().eq('teacher_id', currentUser.id).eq('id', skipId);
  crmSkipUndoing = false;
  if(error){ showToast('تعذّر التراجع: ' + error.message, 'error'); return; }
  renderCrmToday();
}

function crmSectionButtonsHtml(dateIso){
  const sorted = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${sorted.map(sec =>
    `<button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${sec.id}','${dateIso}',null)">رصد: ${escapeHtml(crmSectionOptionLabel(sec))}</button>`
  ).join('')}</div>`;
}

function toggleCrmExtraLesson(){
  const box = document.getElementById('crmExtraLessonBox');
  if(box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

/* فاحص الإجازات الرسمية لنطاق المعلم — بلا نطاق محدد أو عند فشل التحميل:
   لا إجازات (نُظهر حصصًا "غير مرصودة" زائدة أفضل من إخفاء حصص حقيقية) */
async function crmHolidayChecker(){
  const none = { nameFor: () => null };
  if(typeof calendarRegion === 'undefined' || !calendarRegion || typeof loadCalendarData !== 'function') return none;
  try{
    const { holidays } = await loadCalendarData(calendarRegion);
    return { nameFor: (iso) => findHolidayForDate(holidays, iso) };
  } catch(e){ return none; }
}

/* ============================================================
   الجدول الأسبوعي (محرّر)
   ============================================================ */
let crmTimetableDay = 0;

function setCrmTimetableDay(day){
  crmTimetableDay = day;
  renderCrmTimetableEditor();
}

function openCrmTimetableEditor(){
  switchCrmTab('students');
  const box = document.getElementById('crmTimetableBody');
  if(box){
    box.style.display = 'block';
    const arrow = document.getElementById('crmTimetableBody_arrow');
    if(arrow) arrow.textContent = '▾';
  }
  renderCrmTimetableEditor();
  const sec = document.getElementById('crmTimetableSection');
  if(sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderCrmTimetableEditor(){
  const box = document.getElementById('crmTimetableEditor');
  if(!box) return;
  if(!crmSections.length){
    box.innerHTML = '<div class="empty-state">أضف الشعب أولًا (القسم 1).</div>';
    return;
  }
  const ok = await loadCrmTimetable();
  if(!ok){ box.innerHTML = '<div class="empty-state">تعذّر تحميل الجدول.</div>'; return; }
  const { semester } = crmCurrentTerm();
  const sorted = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  const dayChips = CRM_WEEKDAYS.map(d => {
    const count = crmTimetableSlots.filter(s => s.weekday === d.value).length;
    return `<button class="btn ${d.value === crmTimetableDay ? 'btn-primary' : 'btn-outline'} crm-mini-btn" onclick="setCrmTimetableDay(${d.value})">${d.label}${count ? ' (' + count + ')' : ''}</button>`;
  }).join('');
  const rows = [];
  for(let p = 1; p <= CRM_MAX_PERIODS; p++){
    const slot = crmTimetableSlots.find(s => s.weekday === crmTimetableDay && s.period === p);
    rows.push(`<div class="crm-lesson-row">
      <span style="min-width:62px;"><b>الحصة ${p}</b></span>
      <select class="goal-input" style="margin:0;flex:1;" onchange="saveCrmTimetableSlot(${crmTimetableDay}, ${p}, this)">
        <option value="">— لا حصة —</option>
        ${sorted.map(sec => `<option value="${sec.id}"${slot && slot.section_id === sec.id ? ' selected' : ''}>${escapeHtml(crmSectionOptionLabel(sec))}</option>`).join('')}
      </select>
    </div>`);
  }
  box.innerHTML = `
    <p style="font-size:11.5px;color:var(--muted);margin:0 0 8px;line-height:1.8;">جدول ${semester === 2 ? 'الفصل الثاني' : 'الفصل الأول'} — اختر لكل حصة شعبتها. يُحفظ كل تغيير فورًا. الجدول اختياري: بدونه ترصد من أزرار الشعب مباشرة.</p>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${dayChips}</div>
    ${rows.join('')}`;
}

async function saveCrmTimetableSlot(weekday, period, selectEl){
  const sectionId = selectEl.value;
  const { year, semester } = crmCurrentTerm();
  const previous = crmTimetableSlots.find(s => s.weekday === weekday && s.period === period);
  selectEl.disabled = true;
  try{
    let error;
    if(sectionId){
      ({ error } = await sb.from('classroom_timetable_slots').upsert({
        teacher_id: currentUser.id, section_id: sectionId, academic_year: year, semester, weekday, period
      }, { onConflict: 'teacher_id,academic_year,semester,weekday,period' }));
    } else {
      ({ error } = await sb.from('classroom_timetable_slots').delete()
        .eq('teacher_id', currentUser.id).eq('academic_year', year).eq('semester', semester)
        .eq('weekday', weekday).eq('period', period));
    }
    if(error) throw error;
  } catch(e){
    selectEl.value = previous ? previous.section_id : '';
    showToast('تعذّر حفظ الجدول: ' + (e.message || e), 'error');
  } finally {
    selectEl.disabled = false;
  }
  /* إعادة التحميل والرسم: عدد الحصص بجانب كل يوم، وتصحيح أي اختلاف مع القاعدة */
  renderCrmTimetableEditor();
}

/* ============================================================
   ورقة رصد الحصة
   ============================================================ */
let crmSheet = null; /* { sectionId, dateIso, period, states, lessonId, updatedAt, token } */
let crmSheetToken = 0;
let crmSheetSaving = false;

async function openCrmLessonSheet(sectionId, dateIso, period){
  if(dateIso > localIsoDate()){ showToast('لا يمكن رصد حصة بتاريخ لم يأتِ بعد', 'error'); return; }
  /* لا نفترض أن شاشة إدارة الصف ظاهرة أصلًا (قد تُستدعى من شاشة أخرى
     مستقبلًا): نفتحها ونحمّل شعبها وطلابها أولًا ثم نعرض الورقة */
  if(document.getElementById('classroomView').style.display === 'none'){
    await showClassroomManagement();
  }
  const section = crmSectionById(sectionId);
  if(!section){ showToast('الشعبة غير موجودة', 'error'); return; }
  const token = ++crmSheetToken;
  showCrmLessonSheetPane(true);
  const body = document.getElementById('crmLessonSheetBody');
  body.innerHTML = '<div class="loading-state">جارٍ التحميل...</div>';

  const students = crmStudentsOfSection(sectionId);
  /* علامات الانتباه تُجلب بالتوازي (نسخة المحرك المحمّلة غالبًا) — فشلها لا
     يعطّل الرصد، فقط لا تظهر العلامات */
  const attentionPromise = (typeof getAttentionFresh === 'function' ? getAttentionFresh() : Promise.resolve(null)).catch(() => null);
  let q = sb.from('classroom_lessons').select('id, updated_at')
    .eq('teacher_id', currentUser.id).eq('section_id', sectionId).eq('lesson_date', dateIso);
  q = period == null ? q.is('period', null) : q.eq('period', period);
  const { data: lessonRows, error } = await q;
  if(token !== crmSheetToken) return;
  if(error){
    body.innerHTML = `<div class="empty-state">تعذّر التحميل: ${escapeHtml(error.message)}</div>`;
    return;
  }
  const lesson = (lessonRows || [])[0] || null;
  const states = {};
  students.forEach(s => { states[s.id] = 'present'; });
  if(lesson){
    const { data: att, error: aErr } = await sb.from('classroom_attendance').select('student_id, status')
      .eq('teacher_id', currentUser.id).eq('lesson_id', lesson.id);
    if(token !== crmSheetToken) return;
    if(aErr){ body.innerHTML = `<div class="empty-state">تعذّر تحميل الحضور: ${escapeHtml(aErr.message)}</div>`; return; }
    (att || []).forEach(a => { if(states[a.student_id] !== undefined) states[a.student_id] = a.status; });
  }

  let draftRestored = false;
  const draft = sanitizeLessonDraft(readLessonDraft(sectionId, dateIso, period), students.map(s => s.id), Date.now());
  if(draft && Object.keys(draft.states).some(id => draft.states[id] !== states[id])){
    Object.assign(states, draft.states);
    draftRestored = true;
  } else if(draft){
    clearLessonDraft(sectionId, dateIso, period);
  }

  const attention = await attentionPromise;
  if(token !== crmSheetToken) return;
  const markers = typeof sheetMarkersFor === 'function' ? sheetMarkersFor(attention, students.map(st => st.id), localIsoDate()) : new Map();

  crmSheet = { sectionId, dateIso, period, states, lessonId: lesson ? lesson.id : null, updatedAt: lesson ? lesson.updated_at : null, token, dirty: draftRestored, markers, markersLoaded: !!attention };
  renderCrmLessonSheet(students, draftRestored);
}

function showCrmLessonSheetPane(show){
  showCrmOverlayPane(show ? 'sheet' : null);
}

function renderCrmLessonSheet(students, draftRestored){
  const s = crmSheet;
  /* وضعا المشاركة والواجب يرسمان نفسيهما (app-20) — تحديث علامات الانتباه
     أثناءهما لا يعيد الورقة لوضع الحضور */
  if(s.mode === 'participation' || s.mode === 'homework') return;
  const body = document.getElementById('crmLessonSheetBody');
  const dayName = CRM_WEEKDAY_NAMES[weekdayOfIso(s.dateIso)];
  const header = `${escapeHtml(crmSectionLabel(s.sectionId))} · ${dayName} ${s.dateIso.slice(5).replace('-', '/')}${s.period ? ' · الحصة ' + s.period : ''}`;
  if(!students.length){
    body.innerHTML = `<div class="crm-sheet-head">${header}</div>
      <div class="empty-state">لا طلاب مربوطون بهذه الشعبة. أضفهم أو اربطهم من تبويب "الطلاب" أولًا.</div>
      <button class="btn btn-outline" onclick="closeCrmLessonSheet()">رجوع</button>`;
    return;
  }
  const notes = [];
  if(s.lessonId){
    let when = '';
    try{ when = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(s.updatedAt)); } catch(e){}
    notes.push(`رُصدت هذه الحصة سابقًا${when ? ' — آخر تعديل ' + escapeHtml(when) : ''}. أي تغيير هنا يُحفظ فوقها.`);
  }
  if(draftRestored) notes.push('استُعيدت تغييرات لم تُحفظ سابقًا على هذا الجهاز — راجعها ثم احفظ.');

  body.innerHTML = `
    <div class="crm-sheet-head">${header}</div>
    ${typeof crmSheetModeSwitchHtml === 'function' ? crmSheetModeSwitchHtml() : ''}
    ${notes.map(n => `<div class="crm-sheet-note">${n}</div>`).join('')}
    <div id="crmSheetCounts" class="crm-sheet-counts"></div>
    ${crmSheetMarkSummaryHtml(s)}
    <p style="font-size:11px;color:var(--muted);margin:0 0 8px;">الكل حاضر افتراضيًا — اضغط على الطالب لتبديل حالته: غائب ← متأخر ← مستأذن ← حاضر. و⋯ لموقف رسمي أو ⭐ أو ملف الطالب.</p>
    <div class="crm-att-grid">
      ${students.map(st => `<div class="crm-att-cell">
        <button type="button" class="crm-att-btn" id="crmAtt_${st.id}" onclick="cycleCrmAttendance('${st.id}')">
          <span class="crm-att-name">${crmSheetMarkHtml(s, st.id)}${escapeHtml(st.full_name)}</span><span class="crm-att-state"></span></button>
        <button type="button" class="crm-att-more" aria-label="خيارات ${escapeHtml(st.full_name)}" onclick="openCrmStudentActions('${st.id}')">⋯</button>
      </div>`).join('')}
    </div>
    <div class="crm-sheet-bar">
      <button class="btn btn-primary" id="crmSheetSaveBtn" style="flex:1;" onclick="saveCrmLessonSheet()">${s.lessonId ? 'حفظ التعديل' : 'حفظ الرصد'}</button>
      <button class="btn btn-outline" onclick="markAllCrmPresent()">الكل حاضر</button>
      <button class="btn btn-outline" onclick="closeCrmLessonSheet()">رجوع</button>
    </div>
    ${s.lessonId ? `<div style="margin-top:14px;text-align:center;"><a href="#" style="font-size:11.5px;color:#8A2C2C;" onclick="event.preventDefault();deleteCrmLesson()">حذف هذا الرصد (رُصد بالخطأ)</a></div>` : ''}`;
  students.forEach(st => paintCrmAttendance(st.id));
  paintCrmSheetCounts();
}

/* العلامة نقطة صغيرة بلا نص — السبب لا يظهر إلا عند الضغط على ⋯ (شاشة
   الجوال قد يراها الطلاب) */
function crmSheetMarkHtml(sheet, studentId){
  const m = sheet.markers && sheet.markers.get(studentId);
  return m ? `<span class="crm-mark mark-${m.priority}" aria-hidden="true"></span>` : '';
}

function crmSheetMarkSummaryHtml(sheet){
  if(!sheet.markersLoaded || !sheet.markers) return '';
  const n = [...sheet.markers.values()].filter(m => m.priority !== 'info').length;
  if(!n) return '';
  return `<div class="crm-mark-summary"><span class="crm-mark mark-important" aria-hidden="true"></span>${arabicCountPhrase(n, {
    one: 'طالب يحتاج انتباهك', two: 'طالبان يحتاجان انتباهك', few: '{n} طلاب يحتاجون انتباهك', many: '{n} طالبًا يحتاجون انتباهك'
  })} — اضغط ⋯ بجانبه لمعرفة السبب</div>`;
}

function paintCrmAttendance(studentId){
  const btn = document.getElementById('crmAtt_' + studentId);
  if(!btn || !crmSheet) return;
  const state = crmSheet.states[studentId] || 'present';
  btn.className = 'crm-att-btn state-' + state;
  btn.querySelector('.crm-att-state').textContent = state === 'present' ? '' : ATTENDANCE_LABELS[state];
  btn.setAttribute('aria-label', btn.querySelector('.crm-att-name').textContent + ': ' + ATTENDANCE_LABELS[state]);
}

function paintCrmSheetCounts(){
  const el = document.getElementById('crmSheetCounts');
  if(!el || !crmSheet) return;
  const c = attendanceCounts(crmSheet.states);
  el.textContent = `غائب ${c.absent} · متأخر ${c.late} · مستأذن ${c.permitted_exit}`;
}

function cycleCrmAttendance(studentId){
  if(!crmSheet || crmSheetSaving) return;
  crmSheet.states[studentId] = nextAttendanceState(crmSheet.states[studentId] || 'present');
  crmSheet.dirty = true;
  writeLessonDraft(crmSheet.sectionId, crmSheet.dateIso, crmSheet.period, crmSheet.states);
  paintCrmAttendance(studentId);
  paintCrmSheetCounts();
}

function markAllCrmPresent(){
  if(!crmSheet || crmSheetSaving) return;
  Object.keys(crmSheet.states).forEach(id => { crmSheet.states[id] = 'present'; paintCrmAttendance(id); });
  crmSheet.dirty = true;
  writeLessonDraft(crmSheet.sectionId, crmSheet.dateIso, crmSheet.period, crmSheet.states);
  paintCrmSheetCounts();
}

async function saveCrmLessonSheet(){
  if(!crmSheet || crmSheetSaving) return;
  const sheet = crmSheet;
  const btn = document.getElementById('crmSheetSaveBtn');
  crmSheetSaving = true;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'جارٍ الحفظ...';
  try{
    const { error } = await sb.rpc('save_lesson_attendance', {
      p_section_id: sheet.sectionId,
      p_lesson_date: sheet.dateIso,
      p_period: sheet.period,
      p_exceptions: exceptionsFromStates(sheet.states)
    });
    if(error) throw error;
    clearLessonDraft(sheet.sectionId, sheet.dateIso, sheet.period);
    sheet.dirty = false;
    invalidateAttention();
    refreshAttention();
    showToast('تم رصد الحصة ✓', 'ok');
    if(crmSheet === sheet) closeCrmLessonSheet();
  } catch(e){
    /* المسودة باقية على الجهاز — لا يضيع الرصد */
    showToast('لم يُحفظ الرصد (' + (e.message || 'خطأ بالاتصال') + ') — تغييراتك محفوظة على جهازك، أعد المحاولة.', 'error');
    btn.textContent = 'إعادة المحاولة';
    btn.disabled = false;
    crmSheetSaving = false;
    return;
  }
  crmSheetSaving = false;
  btn.textContent = label;
}

async function deleteCrmLesson(){
  if(!crmSheet || !crmSheet.lessonId || crmSheetSaving) return;
  const sheet = crmSheet;
  const ok = await showConfirm('حذف رصد هذه الحصة بالكامل؟ ستعود "غير مرصودة"، ويُحذف ما سُجّل فيها من غياب وتأخر واستئذان.');
  if(!ok || crmSheet !== sheet) return;
  crmSheetSaving = true;
  const { error } = await sb.from('classroom_lessons').delete().eq('teacher_id', currentUser.id).eq('id', sheet.lessonId);
  crmSheetSaving = false;
  if(error){ showToast('تعذّر الحذف: ' + error.message, 'error'); return; }
  clearLessonDraft(sheet.sectionId, sheet.dateIso, sheet.period);
  sheet.dirty = false;
  invalidateAttention();
  refreshAttention();
  showToast('حُذف رصد الحصة', 'ok');
  if(crmSheet === sheet) closeCrmLessonSheet();
}

/* تصفير حالة الورقة دون أي رسم — عند فتح شاشة إدارة الصف من جديد */
function resetCrmLessonSheet(){
  crmSheetToken++;
  crmSheet = null;
  crmSheetSaving = false;
}

function closeCrmLessonSheet(){
  if(crmSheet && crmSheet.dirty) showToast('لم تحفظ الرصد — تغييراتك باقية كمسودة على هذا الجهاز وتعود عند فتح نفس الحصة.', 'error');
  crmSheetToken++;
  crmSheet = null;
  crmSheetSaving = false;
  showCrmLessonSheetPane(false);
  renderCrmLinkBanner();
  switchCrmTab('today');
}
