'use strict';
/* ============================================================
   (14) إدارة الصف — "اليوم" + الجدول الأسبوعي + ورقة رصد الحصة
   ------------------------------------------------------------
   الدفعة 2 من إعادة تصميم إدارة الصف:
   - الجدول الأسبوعي (اختياري): يوم + رقم حصة ← شعبة. بلا أوقات يُدخلها المعلم —
     أوقات الحصص تتغير (رمضان، الاختبارات، الأيام المختصرة)؛ "الحصة الآن" تُتعلَّم
     من وقت رصده المعتاد لكل حصة، وبدونه أول حصة لم تُرصد.
   - "اليوم": بطاقة الحصة الآن بمربّعات أدواتها، ثم المتبقية/المنجزة، وخططي وجدولي.
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
   "الحصة الآن" بلا أوقات يُدخلها المعلم: تُتعلَّم من وقت رصده المعتاد لكل حصة
   (created_at للحصص المرصودة في يومها). أوقات الجرس تتغير (رمضان، الاختبارات)
   فلا تُخزَّن أصلًا: آخر الرصدات تغلب، و"ليست هي؟" تصحّح اليوم بنقرة.
   بلا تعلّم كافٍ: أول حصة لم تُرصد بعد آخر حصة رُصدت اليوم.
   ============================================================ */
const LEARN_MIN_SAMPLES = 2;        /* رصدتان على الأقل لكل حصة */
const LEARN_RECENT_SAMPLES = 8;     /* آخر 8 رصدات فقط — تتكيّف مع تغيّر الجدول */
const LEARN_DAY_START = 5 * 60;     /* رصد خارج الدوام (ليلًا) لا يدل على وقت الحصة */
const LEARN_DAY_END = 16 * 60;
const FOCUS_BEFORE_DAY = 40;        /* قبل أول حصة بأكثر من هذا = "أول حصة اليوم" */
const FOCUS_AFTER_DAY = 45;         /* بعد آخر حصة بأكثر من هذا = انتهى اليوم */
const FOCUS_NOW_WINDOW = 30;        /* ضمن هذا من وقتها المعتاد = "الآن" */

function minutesOfDay(d){ return d.getHours() * 60 + d.getMinutes(); }

/* { رقم الحصة: دقيقة اليوم المعتادة } أو null إن لم يُعرف ما يكفي (أقل من حصتين) */
function learnPeriodTimes(lessons){
  const by = new Map();
  (lessons || []).forEach(l => {
    if(l.period == null || !l.created_at) return;
    const d = new Date(l.created_at);
    if(isNaN(d.getTime()) || localIsoDate(d) !== l.lesson_date) return; /* رُصدت في يوم آخر */
    const m = minutesOfDay(d);
    if(m < LEARN_DAY_START || m > LEARN_DAY_END) return;
    if(!by.has(l.period)) by.set(l.period, []);
    by.get(l.period).push({ at: d.getTime(), m });
  });
  const out = {};
  let prev = -1;
  [...by.keys()].sort((a, b) => a - b).forEach(p => {
    const xs = by.get(p).sort((a, b) => b.at - a.at).slice(0, LEARN_RECENT_SAMPLES).map(x => x.m).sort((a, b) => a - b);
    if(xs.length < LEARN_MIN_SAMPLES) return;
    const mid = xs.length >> 1;
    const med = xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
    if(med <= prev) return; /* يخالف ترتيب الحصص — لا يُعتمد */
    out[p] = med;
    prev = med;
  });
  return Object.keys(out).length >= 2 ? out : null;
}

/* وقت حصة لم يُتعلَّم مباشرة: بين جارتيها، أو بمتوسط طول الحصة من الطرف */
function estimatePeriodMinutes(period, learned){
  if(!learned) return null;
  if(learned[period] != null) return learned[period];
  const ps = Object.keys(learned).map(Number).sort((a, b) => a - b);
  const lo = ps.filter(x => x < period).pop();
  const hi = ps.find(x => x > period);
  if(lo != null && hi != null) return Math.round(learned[lo] + (learned[hi] - learned[lo]) * (period - lo) / (hi - lo));
  const gap = (learned[ps[ps.length - 1]] - learned[ps[0]]) / (ps[ps.length - 1] - ps[0]);
  return lo != null ? Math.round(learned[lo] + gap * (period - lo)) : Math.round(learned[hi] - gap * (hi - period));
}

/* الحصة المعروضة في البطاقة الكبيرة.
   pick = تصحيح المعلم اليوم { period, atMin }: مع الأوقات المتعلَّمة يُزاح اليوم كله
   (رمضان: كل الحصص متأخرة)، وبدونها تُثبَّت تلك الحصة حتى تُرصد.
   الحالة: now | near | first | next | over | done */
function pickTodayFocus(rows, nowMin, learned, pick){
  const open = (rows || []).map((r, i) => ({ r, i })).filter(x => !x.r.skip);
  if(!open.length) return { index: -1, state: 'done', byClock: false };
  const validPick = pick && rows.some(r => r.period === pick.period) ? pick : null;
  if(learned){
    let now = nowMin;
    if(validPick) now = nowMin + (estimatePeriodMinutes(validPick.period, learned) - validPick.atMin);
    const t = x => estimatePeriodMinutes(x.r.period, learned);
    const first = open[0], last = open[open.length - 1];
    if(now < t(first) - FOCUS_BEFORE_DAY) return { index: first.i, state: 'first', byClock: true };
    if(now > t(last) + FOCUS_AFTER_DAY) return { index: -1, state: 'over', byClock: true };
    let best = first;
    open.forEach(x => { if(Math.abs(now - t(x)) < Math.abs(now - t(best))) best = x; });
    return { index: best.i, state: Math.abs(now - t(best)) <= FOCUS_NOW_WINDOW ? 'now' : 'near', byClock: true };
  }
  if(validPick){
    const pi = rows.findIndex(r => r.period === validPick.period && !r.recorded && !r.skip);
    if(pi !== -1) return { index: pi, state: 'next', byClock: false };
  }
  const lastRec = rows.reduce((m, r, i) => (r.recorded ? i : m), -1);
  let idx = rows.findIndex((r, i) => i > lastRec && !r.recorded && !r.skip);
  if(idx === -1) idx = rows.findIndex(r => !r.recorded && !r.skip);
  return idx === -1 ? { index: -1, state: 'done', byClock: false } : { index: idx, state: 'next', byClock: false };
}

/* مربّعات الأدوات في البطاقة الكبيرة: 4 على الأكثر (الرابع "المزيد" إن زادت).
   الحضور ذهبي "ابدأ هنا" ما لم يُرصد، وبعده ✓ فقط — بلا توجيه لأداة "تالية" (بطلب صاحب التطبيق). */
const TODAY_TILE_LABELS = { attendance: 'الحضور', participation: 'المشاركة', homework: 'الواجب', task: 'المهام', test: 'الاختبار' };
const TODAY_TILE_ICONS = { attendance: '👥', participation: '👆', homework: '📝', task: '🎯', test: '🧪' };
const TODAY_TOOL_ICONS = { counter: '🔢', status: '✅', score: '💯' };

function todayToolTiles(modes, recorded){
  const list = modes.length > 4 ? modes.slice(0, 3) : modes.slice();
  const tiles = list.map(mode => ({ mode, more: false, gold: false, done: false, sub: '' }));
  if(modes.length > 4) tiles.push({ mode: modes[3], more: true, gold: false, done: false, sub: '', rest: modes.slice(3) });
  const att = tiles.find(t => t.mode === 'attendance' && !t.more);
  if(att && !recorded){ att.gold = true; att.sub = 'ابدأ هنا'; }
  else if(att) att.done = true;
  return tiles;
}

function todayTileLabel(mode){
  return TODAY_TILE_LABELS[mode] || (typeof sheetModeLabel === 'function' ? sheetModeLabel(mode) : mode);
}

function todayTileIcon(mode){
  if(String(mode).indexOf('tool:') === 0){
    const t = typeof customToolById === 'function' ? customToolById(mode.slice(5)) : null;
    return (t && TODAY_TOOL_ICONS[t.tool_type]) || '⭐';
  }
  return TODAY_TILE_ICONS[mode] || '•';
}

/* ---- تصحيح "ليست هي؟" (لهذا اليوم ولهذا المستخدم فقط) ---- */
const NOW_PICK_PREFIX = 'crm_now_pick:';

function readCrmNowPick(todayIso){
  try{
    const raw = localStorage.getItem(NOW_PICK_PREFIX + currentUser.id + ':' + todayIso);
    const v = raw ? JSON.parse(raw) : null;
    return v && Number.isInteger(v.period) && typeof v.atMin === 'number' ? v : null;
  } catch(e){ return null; }
}

function writeCrmNowPick(todayIso, pick){
  try{
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(k && k.indexOf(NOW_PICK_PREFIX) === 0) localStorage.removeItem(k); /* أيام سابقة لا قيمة لها */
    }
    if(pick) localStorage.setItem(NOW_PICK_PREFIX + currentUser.id + ':' + todayIso, JSON.stringify(pick));
  } catch(e){ /* تخزين غير متاح — التصحيح يبقى في الذاكرة لهذه الجلسة */ }
  crmNowPickMemo = { todayIso, uid: currentUser.id, pick };
}

let crmNowPickMemo = null;
function currentCrmNowPick(todayIso){
  if(crmNowPickMemo && crmNowPickMemo.todayIso === todayIso && crmNowPickMemo.uid === currentUser.id) return crmNowPickMemo.pick;
  return readCrmNowPick(todayIso);
}

/* ============================================================
   تبويب "اليوم"
   ============================================================ */
let crmTodayRenderToken = 0;
let crmTodayData = null;      /* آخر ما حُمّل — يُعاد الرسم منه كل دقيقة بلا شبكة */
let crmTodayListTab = null;   /* 'left' | 'done' */
let crmTodayPlansOpen = false;
let crmTodayTimer = null;

/* بطاقة "شعبي" في تبويب اليوم — موقوفة لتبسيط الصفحة (true يعيدها) */
const TODAY_SECTIONS_CARD_ON = false;

async function renderCrmToday(){
  const box = document.getElementById('crmTodayBody');
  if(!box) return;
  const token = ++crmTodayRenderToken;
  const todayIso = localIsoDate();
  const uid = currentUser.id;
  box.innerHTML = '<div class="loading-state">جارٍ التحميل...</div>';

  const since = addDaysIso(todayIso, -7);
  const [ttOk, lessonsRes, holidayCheck, attention, skipsRes, plans, learnRes] = await Promise.all([
    loadCrmTimetable(),
    sb.from('classroom_lessons').select('id, section_id, lesson_date, period, updated_at')
      .eq('teacher_id', uid).gte('lesson_date', since).lte('lesson_date', todayIso),
    crmHolidayChecker(),
    getAttentionFresh(),
    sb.from('classroom_lesson_skips').select('id, section_id, lesson_date, period, note')
      .eq('teacher_id', uid).gte('lesson_date', since).lte('lesson_date', todayIso),
    appSectionOn('shahid') ? loadLessonPlans().catch(() => null) : Promise.resolve(null),
    /* أوقات الرصد للتعلّم — فشلها لا يعطّل شيئًا (نرجع لـ"أول غير مرصودة") */
    Promise.resolve(sb.from('classroom_lessons').select('period, lesson_date, created_at')
      .eq('teacher_id', uid).gte('lesson_date', addDaysIso(todayIso, -60)).lte('lesson_date', todayIso)
      .order('lesson_date', { ascending: false }).limit(800)).catch(() => null)
  ]);
  if(token !== crmTodayRenderToken) return; /* طُلب رسم أحدث أثناء الانتظار (تغيّر الفصل/السنة) */
  if(!currentUser || currentUser.id !== uid) return;
  if(!ttOk || lessonsRes.error){
    box.innerHTML = '<div class="empty-state">تعذّر تحميل بيانات اليوم. <button class="btn btn-outline" style="padding:3px 10px;font-size:11.5px;" onclick="renderCrmToday()">إعادة المحاولة</button></div>';
    return;
  }
  const lessons = (lessonsRes.data || []).filter(l => crmSectionById(l.section_id));
  /* فشل تحميل "لم أحضر" لا يعطّل التبويب: تظهر الحصص كغير مرصودة فقط */
  const skips = skipsRes && !skipsRes.error ? (skipsRes.data || []) : [];
  crmTodayLoaded = { lessons, skips };
  let attendance = [];
  if(TODAY_SECTIONS_CARD_ON && lessons.length){
    const { data: att, error: aErr } = await sb.from('classroom_attendance').select('lesson_id, status')
      .eq('teacher_id', uid).in('lesson_id', lessons.map(l => l.id));
    if(token !== crmTodayRenderToken) return;
    if(!aErr) attendance = att || [];
  }
  const learned = learnRes && !learnRes.error ? learnPeriodTimes(learnRes.data || []) : null;
  if(!crmTodayData || crmTodayData.todayIso !== todayIso){ crmTodayListTab = null; crmTodayPlansOpen = false; }
  crmTodayData = { token, todayIso, uid, lessons, skips, plans, attention, attendance, learned, holidayName: holidayCheck.nameFor(todayIso),
    unrecorded: ATTENTION_ALERTS_ON ? findUnrecordedLessons(crmTimetableSlots, lessons, todayIso, 7, d => !!holidayCheck.nameFor(d), skips) : [] };
  paintCrmToday();
  ensureCrmTodayTimer();
}

/* "الحصة الآن" تتبدّل مع الساعة: إعادة رسم من البيانات المحمّلة كل دقيقة،
   فقط والتبويب ظاهر، وفقط إن تغيّرت الحصة المعروضة */
function ensureCrmTodayTimer(){
  if(crmTodayTimer) return;
  crmTodayTimer = setInterval(() => {
    const d = crmTodayData;
    const tab = document.getElementById('crmTabToday');
    const view = document.getElementById('classroomView');
    if(!d || !currentUser || d.uid !== currentUser.id || !tab || tab.style.display === 'none' || !view || view.style.display === 'none') return;
    if(d.todayIso !== localIsoDate()){ renderCrmToday(); return; }
    const f = crmTodayFocus(d);
    if(!d.focus || f.index !== d.focus.index || f.state !== d.focus.state) paintCrmToday();
  }, 60000);
  if(crmTodayTimer && typeof crmTodayTimer.unref === 'function') crmTodayTimer.unref();
}

function crmTodayRows(d){
  return planDayLessons(crmTimetableSlots, d.todayIso, d.lessons, d.skips).rows;
}

function crmTodayFocus(d){
  return pickTodayFocus(crmTodayRows(d), minutesOfDay(new Date()), d.learned, currentCrmNowPick(d.todayIso));
}

function paintCrmToday(){
  const box = document.getElementById('crmTodayBody');
  const d = crmTodayData;
  /* تحميل أحدث جارٍ (تغيّر الفصل/السنة): لا يُرسم القديم فوقه */
  if(!box || !d || !currentUser || d.uid !== currentUser.id || d.token !== crmTodayRenderToken) return;
  const todayIso = d.todayIso;
  const todayName = CRM_WEEKDAY_NAMES[weekdayOfIso(todayIso)];
  let dateText = todayIso;
  try{ dateText = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long' }).format(new Date()); } catch(e){}
  const dayLabel = `${todayName} ${escapeHtml(dateText)}`;

  if(!crmSections.length){
    box.innerHTML = `<div class="crm-hero is-off"><div class="crm-hero-k">${dayLabel}</div><div class="crm-hero-sub">ابدأ من تبويب "الطلاب": أضف المرحلة والشعب، ثم طلابك. بعدها تستطيع رصد الحصص من هنا.</div></div>`;
    return;
  }

  let html = '';
  const extraBtn = `<button type="button" class="crm-extra-btn" onclick="toggleCrmExtraLesson()">+ رصد حصة خارج الجدول</button>
    <div id="crmExtraLessonBox" style="display:none;margin:-4px 0 10px;">${crmSectionButtonsHtml(todayIso)}</div>`;

  if(d.holidayName){
    d.focus = null;
    html += `<div class="crm-hero is-off"><div class="crm-hero-k">${dayLabel}</div><b class="crm-hero-t">إجازة: ${escapeHtml(d.holidayName)}</b></div>`;
    html += extraBtn;
  } else if(!crmTimetableSlots.length){
    d.focus = null;
    html += `<div class="crm-hero is-off"><div class="crm-hero-k">${dayLabel}</div><b class="crm-hero-t">رصد حصة</b>
      <div class="crm-hero-sub">اختر الشعبة. ولتظهر حصصك هنا تلقائيًا كل يوم: <a href="#" onclick="event.preventDefault();openCrmTimetableEditor()">اضبط جدولك الأسبوعي</a> (اختياري).</div>
      ${crmSectionButtonsHtml(todayIso)}</div>`;
  } else {
    const rows = crmTodayRows(d);
    if(!rows.length){
      d.focus = null;
      html += `<div class="crm-hero is-off"><div class="crm-hero-k">${dayLabel}</div><b class="crm-hero-t">لا حصص في جدولك اليوم</b></div>`;
      html += extraBtn;
    } else {
      const focus = crmTodayFocus(d);
      d.focus = focus;
      html += crmTodayHeroHtml(d, rows, focus, dayLabel);
      html += crmTodayListsHtml(d, rows, focus);
      html += extraBtn;
    }
  }

  html += crmTodayMiniTilesHtml(d);

  /* ---- يحتاج انتباهي / غير المرصود ---- (موقوفان مع بقية التنبيهات) */
  html += attentionTodaySectionHtml(d.attention);
  if(d.unrecorded.length){
    html += `<div class="crm-today-card crm-today-warn"><div class="crm-today-title">⚠ حضور لم يُرصد (آخر 7 أيام): ${d.unrecorded.length}</div>`;
    html += d.unrecorded.map(u => `<div class="crm-lesson-row">
        <span>${CRM_WEEKDAY_NAMES[u.weekday]} ${u.date.slice(5).replace('-', '/')} · الحصة ${u.period} · ${escapeHtml(crmSectionLabel(u.section_id))}</span>
        <span class="crm-lesson-actions"><button class="crm-skip-btn" onclick="openCrmSkipModal('${u.section_id}','${u.date}',${u.period})">لم أحضر</button><button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${u.section_id}','${u.date}',${u.period})">رصد</button></span>
      </div>`).join('');
    html += '</div>';
  }

  /* ---- شعبي ---- (عدد الطلاب وحضور الأسبوع لكل شعبة — موقوف لتبسيط الصفحة؛ ملخص الشعبة في تبويب الدرجات) */
  if(TODAY_SECTIONS_CARD_ON){
    html += '<div class="crm-today-card"><div class="crm-today-title">شعبي</div>';
    const sortedSections = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
    html += sortedSections.map(sec => {
      const studentCount = crmStudentsOfSection(sec.id).length;
      const secLessons = d.lessons.filter(l => l.section_id === sec.id);
      const rate = sectionAttendanceRate(secLessons, d.attendance, studentCount);
      const rateText = rate === null ? 'لا رصد هذا الأسبوع' : `حضور الأسبوع ${rate}%`;
      return `<div class="crm-lesson-row"><span>${escapeHtml(crmSectionOptionLabel(sec))}</span>
        <span style="font-size:11.5px;color:var(--muted);">${studentCount ? arabicCountPhrase(studentCount, CRM_STUDENT_COUNT_FORMS) : 'لا طلاب مربوطون'} · ${rateText}</span></div>`;
    }).join('');
    html += '</div>';
  }

  box.innerHTML = html;
}

function crmTodayHeroHtml(d, rows, focus, dayLabel){
  const todayIso = d.todayIso;
  const active = rows.filter(r => !r.skip);
  const recCount = active.filter(r => r.recorded).length;
  const badge = `<span class="crm-hero-badge">${recCount}/${active.length} ✓</span>`;
  const pickLink = `<a href="#" onclick="event.preventDefault();toggleCrmNowPick()">ليست هي؟</a>`;
  const pickBox = crmNowPickBoxHtml(d, rows);

  if(focus.index === -1){
    const skipped = rows.length - active.length;
    const allDone = recCount === active.length;
    const title = focus.state === 'over' ? 'انتهت حصص اليوم' : (allDone ? '✓ رُصدت حصص اليوم' : 'حصص اليوم');
    return `<div class="crm-hero${allDone ? ' is-done' : ''}">
      <div class="crm-hero-top"><span class="crm-hero-k">${dayLabel}</span>${badge}</div>
      <b class="crm-hero-t">${title}</b>
      <div class="crm-hero-sub">رصدت ${recCount} من ${active.length}${skipped ? ' · لم تحضر ' + skipped : ''}</div>
      ${focus.byClock ? `<div class="crm-hero-why">⏱ حسب وقت رصدك المعتاد · ${pickLink}</div>${pickBox}` : ''}
    </div>`;
  }

  const r = rows[focus.index];
  const kicker = focus.state === 'now' ? `الحصة ${r.period} الآن`
    : focus.state === 'first' ? `أول حصة اليوم: ${r.period}`
    : focus.state === 'next' ? `الحصة التالية: ${r.period}`
    : `الحصة ${r.period}`;
  const studentCount = crmStudentsOfSection(r.section_id).length;
  const plan = typeof planBadgeForLesson === 'function' ? planBadgeForLesson(d.plans, todayIso, r.section_id, r.period) : '';
  const why = focus.byClock ? `⏱ حسب وقت رصدك المعتاد · ${pickLink}` : pickLink;
  return `<div class="crm-hero">
    <div class="crm-hero-top"><span class="crm-hero-k">${dayLabel} · ${kicker}</span>${badge}
      <button type="button" class="crm-hero-more" aria-label="خيارات الحصة" onclick="openCrmLessonActions('${r.section_id}','${todayIso}',${r.period})">⋯</button></div>
    <b class="crm-hero-t">${escapeHtml(crmSectionLabel(r.section_id))}</b>
    <div class="crm-hero-sub">${studentCount ? arabicCountPhrase(studentCount, CRM_STUDENT_COUNT_FORMS) : 'لا طلاب مربوطون'}</div>
    ${plan}
    ${crmTodayTilesHtml(r, todayIso)}
    <div class="crm-hero-why">${why}</div>
    ${pickBox}
  </div>`;
}

function crmTodayTilesHtml(r, todayIso){
  const modes = typeof enabledSheetModes === 'function' ? enabledSheetModes() : ['attendance'];
  const open = mode => `openCrmLessonSheet('${r.section_id}','${todayIso}',${r.period}${mode ? `,'${mode}'` : ''})`;
  if(modes.length <= 1){
    const label = modes.length ? `${todayTileIcon(modes[0])} رصد ${escapeHtml(todayTileLabel(modes[0]))} ←` : 'رصد ←';
    return `<button type="button" class="crm-hero-go" onclick="${open(modes[0])}">${label}</button>`;
  }
  const tiles = todayToolTiles(modes, r.recorded);
  return `<div class="crm-tiles">${tiles.map(t => {
    const cls = 'crm-tile' + (t.gold ? ' is-gold' : '') + (t.done ? ' is-done' : '') + (t.more ? ' is-more' : '');
    const name = t.more ? 'المزيد' : todayTileLabel(t.mode);
    const sub = t.more ? t.rest.map(todayTileLabel).join('، ') : t.sub;
    return `<button type="button" class="${cls}" onclick="${open(t.mode)}">
      <span class="crm-tile-ic">${t.more ? '＋' + t.rest.length : todayTileIcon(t.mode)}</span>
      <b>${escapeHtml(name)}</b><small>${escapeHtml(sub) || '&nbsp;'}</small></button>`;
  }).join('')}</div>`;
}

function crmNowPickBoxHtml(d, rows){
  const pick = currentCrmNowPick(d.todayIso);
  const chips = rows.filter(r => !r.skip).map(r =>
    `<button type="button" class="${pick && pick.period === r.period ? 'is-on' : ''}" onclick="pickCrmNowPeriod(${r.period})">${r.period}</button>`).join('');
  return `<div class="crm-nowpick" id="crmNowPickBox" style="display:none;">
    <div class="crm-nowpick-q">أي حصة الآن؟</div>
    <div class="crm-nowpick-cs">${chips}${pick ? '<button type="button" onclick="pickCrmNowPeriod(null)">تلقائي</button>' : ''}</div></div>`;
}

function toggleCrmNowPick(){
  const b = document.getElementById('crmNowPickBox');
  if(b) b.style.display = b.style.display === 'none' ? 'block' : 'none';
}

function pickCrmNowPeriod(period){
  const d = crmTodayData;
  if(!d || !currentUser || d.uid !== currentUser.id) return;
  writeCrmNowPick(d.todayIso, period == null ? null : { period: Number(period), atMin: minutesOfDay(new Date()) });
  paintCrmToday();
}

function crmTodayListsHtml(d, rows, focus){
  const todayIso = d.todayIso;
  /* حصة البطاقة الكبيرة لا تتكرر في القائمتين — عددها الكامل في شارة البطاقة */
  const focusRow = focus.index !== -1 ? rows[focus.index] : null;
  const left = rows.filter(r => r !== focusRow && !r.recorded && !r.skip);
  const done = rows.filter(r => r !== focusRow && (r.recorded || r.skip));
  if(!left.length && !done.length) return '';
  if(!crmTodayListTab) crmTodayListTab = left.length || !done.length ? 'left' : 'done';
  /* "بعدها" فقط إن كانت كل الباقية بعد حصة البطاقة (حصة سابقة لم تُرصد = "المتبقية") */
  const leftName = focusRow && left.every(r => r.period > focusRow.period) ? 'بعدها' : 'المتبقية';
  const label = r => escapeHtml(crmSectionLabel(r.section_id)); /* رقم الحصة في مربّعها */
  const more = r => `<button type="button" class="crm-lrow-more" aria-label="خيارات الحصة" onclick="openCrmLessonActions('${r.section_id}','${todayIso}',${r.period})">⋯</button>`;
  const plan = r => typeof planBadgeForLesson === 'function' ? planBadgeForLesson(d.plans, todayIso, r.section_id, r.period) : '';
  const leftHtml = left.length ? left.map(r => `<div class="crm-lrow"><span class="crm-lrow-no" aria-label="الحصة ${r.period}">${r.period}</span>
      <div class="crm-lrow-main"><b>${label(r)}</b>${plan(r)}</div>
      <button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${r.section_id}','${todayIso}',${r.period})">رصد</button>${more(r)}</div>`
  ).join('') : `<div class="crm-today-empty" style="padding:8px 2px;">${leftName === 'بعدها' ? 'لا حصص بعدها اليوم.' : 'لا حصص متبقية اليوم.'}</div>`;
  const doneHtml = done.length ? done.map(r => r.recorded
    ? `<div class="crm-lrow is-done"><span class="crm-lrow-no is-ok" aria-label="الحصة ${r.period}">${r.period}</span>
        <div class="crm-lrow-main"><b>${label(r)}</b><div class="gs-chips"><span class="gs-chip full">الحضور ✓</span></div>${plan(r)}</div>
        <button class="btn btn-outline crm-mini-btn" onclick="openCrmLessonSheet('${r.section_id}','${todayIso}',${r.period})">أكمل الرصد ←</button></div>`
    : `<div class="crm-lrow is-skipped"><span class="crm-lrow-no is-skip" aria-label="الحصة ${r.period}">${r.period}</span>
        <div class="crm-lrow-main"><b>${label(r)}</b><div class="crm-skip-note">لم تحضرها${r.skip.note ? ' — ' + escapeHtml(r.skip.note) : ''}</div></div>
        <button class="btn btn-outline crm-mini-btn" onclick="undoCrmLessonSkip('${r.skip.id}')">تراجع</button></div>`
  ).join('') : '<div class="crm-today-empty" style="padding:8px 2px;">لم تُرصد حصة اليوم بعد.</div>';
  const on = t => crmTodayListTab === t;
  return `<div class="crm-seg crm-today-seg">
      <button type="button" class="${on('left') ? 'is-on' : ''}" onclick="setCrmTodayList('left')">${leftName} (${left.length})</button>
      <button type="button" class="${on('done') ? 'is-on' : ''}" onclick="setCrmTodayList('done')">المنجزة (${done.length})</button></div>
    <div id="crmTodayLeft"${on('left') ? '' : ' style="display:none;"'}>${leftHtml}</div>
    <div id="crmTodayDone"${on('done') ? '' : ' style="display:none;"'}>${doneHtml}</div>`;
}

function setCrmTodayList(tab){
  crmTodayListTab = tab === 'done' ? 'done' : 'left';
  paintCrmToday();
}

/* خططي + جدولي: مربّعان صغيران بملخص — يفتح كل منهما محتواه */
function crmTodayMiniTilesHtml(d){
  const plansOn = appSectionOn('shahid');
  const slots = crmTimetableSlots.length;
  let plansSub = '—';
  if(plansOn && d.plans && typeof classifyPlans === 'function'){
    const c = classifyPlans(d.plans, d.todayIso);
    plansSub = c.today.length || c.upcoming.length ? `${c.today.length} اليوم · ${c.upcoming.length} قادمة` : 'لا خطط قادمة';
  }
  const tt = `<button type="button" class="crm-mtile" onclick="toggleCrmTimetable()"><span class="crm-mtile-ic">📅</span>
    <span><b>جدولي</b><small>${slots ? arabicCountPhrase(slots, { one: 'حصة واحدة', two: 'حصتان', few: '{n} حصص', many: '{n} حصة' }) : 'لم يُضبط بعد'}</small></span></button>`;
  if(!plansOn) return `<div class="crm-mtiles">${tt}</div>`;
  return `<div class="crm-mtiles">
      <button type="button" class="crm-mtile${crmTodayPlansOpen ? ' is-open' : ''}" onclick="toggleCrmTodayPlans()"><span class="crm-mtile-ic">📋</span>
        <span><b>خططي</b><small>${plansSub}</small></span></button>${tt}</div>
    <div id="crmTodayPlans"${crmTodayPlansOpen ? '' : ' style="display:none;"'}>${typeof lessonPlansTodayHtml === 'function' ? lessonPlansTodayHtml(d.plans, d.todayIso) : ''}</div>`;
}

function toggleCrmTodayPlans(){
  crmTodayPlansOpen = !crmTodayPlansOpen;
  paintCrmToday();
}

/* خيارات حصة (⋯): خطتها، و"لم أحضر" أو التراجع عنه — بعيدًا عن زر الرصد */
function openCrmLessonActions(sectionId, dateIso, period){
  const d = crmTodayData;
  if(!d) return;
  const r = planDayLessons(crmTimetableSlots, dateIso, d.lessons, d.skips).rows.find(x => x.section_id === sectionId && x.period === period);
  if(!r) return;
  const plan = (d.plans || []).find(x => x.status === 'planned' && x.planned_date === dateIso && x.section_id === sectionId && x.period === period);
  const opt = (ico, title, sub, onclick, cls) => `<button type="button" class="crm-act-opt${cls ? ' ' + cls : ''}" onclick="${onclick}">
    <span class="crm-act-ic">${ico}</span><span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  const opts = [];
  if(r.recorded) opts.push(opt('✎', 'أكمل الرصد / عدّله', 'الحضور والمشاركة والواجب…', `closeCrmModal();openCrmLessonSheet('${sectionId}','${dateIso}',${period})`));
  else if(!r.skip) opts.push(opt('✓', 'رصد الحصة', '', `closeCrmModal();openCrmLessonSheet('${sectionId}','${dateIso}',${period})`));
  if(plan) opts.push(opt('📋', 'خطة الحصة', escapeHtml(plan.title), `openLessonPlanView('${plan.id}')`));
  if(r.skip) opts.push(opt('↶', 'تراجع عن «لم أحضر»', '', `closeCrmModal();undoCrmLessonSkip('${r.skip.id}')`));
  else if(!r.recorded) opts.push(opt('⊘', 'لم أحضر هذه الحصة', 'انتظار، مناوبة، نشاط… (يمكن التراجع)', `openCrmSkipModal('${sectionId}','${dateIso}',${period})`, 'is-red'));
  showInfoModal(`<div style="text-align:right;">
      <h3 style="margin:0 0 2px;font-size:15px;color:var(--navy);">الحصة ${period} · ${escapeHtml(crmSectionLabel(sectionId))}</h3>
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">${r.recorded ? 'رُصد حضورها' : r.skip ? 'لم تحضرها' : 'لم تُرصد بعد'}</div>
      ${opts.join('')}</div>`, '400px');
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

/* الجدول في تبويب "اليوم" (منه تُبنى حصص اليوم) — مخفي حتى يُفتح من مربّع "جدولي" */
function openCrmTimetableEditor(){
  if(document.getElementById('crmTabToday').style.display === 'none') switchCrmTab('today');
  const sec = document.getElementById('crmTimetableSection');
  if(sec) sec.style.display = 'block';
  renderCrmTimetableEditor();
  if(sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeCrmTimetable(){
  const sec = document.getElementById('crmTimetableSection');
  if(sec) sec.style.display = 'none';
}

function toggleCrmTimetable(){
  const sec = document.getElementById('crmTimetableSection');
  if(sec && sec.style.display !== 'none') closeCrmTimetable();
  else openCrmTimetableEditor();
}

async function renderCrmTimetableEditor(){
  const box = document.getElementById('crmTimetableEditor');
  if(!box) return;
  if(!crmSections.length){
    box.innerHTML = '<div class="empty-state">أضف الشعب أولًا من تبويب "الطلاب" ← "⚙ المراحل والشعب".</div>';
    return;
  }
  const ok = await loadCrmTimetable();
  if(!ok){ box.innerHTML = '<div class="empty-state">تعذّر تحميل الجدول.</div>'; return; }
  const { semester } = crmCurrentTerm();
  const sorted = crmSections.slice().sort((a, b) => crmSectionOptionLabel(a).localeCompare(crmSectionOptionLabel(b), 'ar', { numeric: true }));
  const dayChips = CRM_WEEKDAYS.map(d => {
    const count = crmTimetableSlots.filter(s => s.weekday === d.value).length;
    return `<button type="button" class="crm-tt-day${d.value === crmTimetableDay ? ' is-on' : ''}" onclick="setCrmTimetableDay(${d.value})">${d.label}<small>${count ? count : '—'}</small></button>`;
  }).join('');
  const rows = [];
  for(let p = 1; p <= CRM_MAX_PERIODS; p++){
    const slot = crmTimetableSlots.find(s => s.weekday === crmTimetableDay && s.period === p);
    rows.push(`<div class="crm-tt-row${slot ? ' has-slot' : ''}">
      <span class="crm-tt-n" title="الحصة ${p}">${p}</span>
      <select class="goal-input crm-tt-sel" aria-label="الحصة ${p}" onchange="saveCrmTimetableSlot(${crmTimetableDay}, ${p}, this)">
        <option value="">— لا حصة —</option>
        ${sorted.map(sec => `<option value="${sec.id}"${slot && slot.section_id === sec.id ? ' selected' : ''}>${escapeHtml(crmSectionOptionLabel(sec))}</option>`).join('')}
      </select>
    </div>`);
  }
  box.innerHTML = `
    <p class="crm-tt-hint">${semester === 2 ? 'الفصل الثاني' : 'الفصل الأول'} · اختر شعبة كل حصة، ويُحفظ تلقائيًا.</p>
    <div class="crm-tt-days">${dayChips}</div>
    <div class="crm-tt-list">${rows.join('')}</div>`;
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

/* mode (اختياري): يفتح الورقة على أداة بعينها (مربّعات بطاقة اليوم) */
async function openCrmLessonSheet(sectionId, dateIso, period, mode){
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
  /* مسودة حضور مستعادة تُعرض أولًا (لا تُخفى خلف أداة أخرى) */
  if(mode && mode !== 'attendance' && !draftRestored && enabledSheetModes().includes(mode)){ setCrmSheetMode(mode); return; }
  /* الحضور مخفي (تخصيص التطبيق): تفتح الورقة على أول أداة مفعّلة */
  if(!appToolOn('attendance')){ setCrmSheetMode(enabledSheetModes()[0] || 'none'); return; }
  renderCrmLessonSheet(students, draftRestored);
}

function showCrmLessonSheetPane(show){
  showCrmOverlayPane(show ? 'sheet' : null);
}

function renderCrmLessonSheet(students, draftRestored){
  const s = crmSheet;
  /* وضعا المشاركة والواجب يرسمان نفسيهما (app-20) — تحديث علامات الانتباه
     أثناءهما لا يعيد الورقة لوضع الحضور */
  if(s.mode && s.mode !== 'attendance') return; /* الأوضاع الأخرى ترسم نفسها */
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
  if(s.justSaved){
    notes.push('حُفظ الحضور ✓ — أكمل المشاركة والواجب وغيرها من التبويبات أعلاه، أو "رجوع" لقائمة الحصص.');
  } else if(s.lessonId){
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

/* الحضور مستقل عن بقية أوضاع الورقة: الحصة "مرصودة" بحفظ حضورها وحده، وما يُرصد في
   المشاركة والواجب والمهام والأدوات يُحفظ بنقرته ولا يغيّر حالة الحضور. */
function markCrmSheetFailure(){
  if(crmSheet) crmSheet.failed = true;
}

function crmSheetFinishBtnHtml(){
  return '<button class="btn btn-primary" id="crmModeFinishBtn" onclick="finishCrmLessonSheet()">حفظ</button>';
}

/* كل ما أُرسل ولم يكتمل بعد من أوضاع الأدوات (طوابير الحفظ لكل طالب) */
function crmSheetPendingWrites(s){
  return [s.part, s.hw, s.tool, s.task, s.test].filter(x => x && x.queue).flatMap(x => [...x.queue.values()]);
}

/* زر "حفظ" في شريط أوضاع الأدوات: يؤكد اكتمال ما أُرسل — ينتظره ويتأكد من نجاحه،
   ويبقى المعلم في مكانه (لا تُغلق الورقة). لا يمسّ حضور الحصة. */
let crmSheetFinishing = false;
async function finishCrmLessonSheet(){
  const s = crmSheet;
  if(!s || crmSheetFinishing || crmSheetSaving) return;
  crmSheetFinishing = true;
  const btn = document.getElementById('crmModeFinishBtn');
  const label = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الحفظ...'; }
  try{
    s.failed = false;
    for(let i = 0; i < 100 && ((typeof crmHwBulkBusy !== 'undefined' && crmHwBulkBusy) || (typeof crmToolBulkBusy !== 'undefined' && crmToolBulkBusy)); i++){
      await new Promise(r => setTimeout(r, 50));
    }
    await Promise.allSettled(crmSheetPendingWrites(s));
    if(crmSheet !== s) return;
    if(s.failed){ showToast('لم يكتمل الحفظ — راجع الرسالة الحمراء ثم أعد المحاولة', 'error'); return; }
    showToast('تم الحفظ ✓', 'ok'); /* يبقى في مكانه — الخروج بـ"رجوع" */
  } finally {
    crmSheetFinishing = false;
    if(btn && btn.isConnected){ btn.disabled = false; btn.textContent = label; }
  }
}

async function saveCrmLessonSheet(){
  if(!crmSheet || crmSheetSaving) return;
  const sheet = crmSheet;
    const btns = [document.getElementById('crmSheetSaveBtn')].filter(Boolean);
  crmSheetSaving = true;
  const labels = btns.map(b => b.textContent);
  btns.forEach(b => { b.disabled = true; b.textContent = 'جارٍ الحفظ...'; });
  try{
    const { data: lessonId, error } = await sb.rpc('save_lesson_attendance', {
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
    showToast('تم حفظ الحضور ✓', 'ok');
    /* يبقى في الورقة (لا يعود للقائمة) — ليكمل المشاركة والواجب وغيرها بنقرة؛ الخروج بـ"رجوع" */
    if(crmSheet === sheet){
      if(lessonId) sheet.lessonId = lessonId;
      sheet.updatedAt = new Date().toISOString();
      sheet.justSaved = true;
      crmSheetSaving = false;
      renderCrmLessonSheet(crmStudentsOfSection(sheet.sectionId), false);
      return;
    }
  } catch(e){
    /* المسودة باقية على الجهاز — لا يضيع الرصد */
    showToast('لم يُحفظ الرصد (' + (e.message || 'خطأ بالاتصال') + ') — تغييراتك محفوظة على جهازك، أعد المحاولة.', 'error');
    btns.forEach(b => { b.textContent = 'إعادة المحاولة'; b.disabled = false; });
    crmSheetSaving = false;
    return;
  }
  crmSheetSaving = false;
  btns.forEach((b, i) => { b.textContent = labels[i]; });
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
  if(typeof maybeShowUpdateSheet === 'function') maybeShowUpdateSheet(); /* تحديث أُجِّل لأن الورقة كانت مفتوحة */
}
