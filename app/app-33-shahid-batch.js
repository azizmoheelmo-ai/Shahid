/* ============================================
   تجهيز الشواهد دفعة واحدة
   ============================================
   المعلم يختار 20-30 شاهدًا (حتى 4 للعنصر) من النماذج الجاهزة مرة واحدة،
   فتتحوّل لبطاقات مسودة بجدول مستقل (shahid_drafts) — ثم يضيف الصور فقط.

   المسودة ليست شاهدًا: لا تُحتسب بالتقدم ولا التغطية ولا التصدير ولا لوحة
   المسؤول (هي بجدول منفصل، فلا استعلام بالتطبيق يحتاج استثناءها). وتصير شاهدًا
   حقيقيًا بجدول shawahid لحظة إرفاق صورتها فقط — الصورة هي الدليل على أن
   الإجراء حدث فعلًا. نفس معرّف المسودة يصير معرّف الشاهد، فلو تكرر الحفظ
   (نقرة مزدوجة/تبويبان) يرفضه المفتاح الأساسي بدل أن يُنشئ شاهدًا مكررًا. */

const BATCH_MAX_PER_ELEMENT = 4;   // أقصى عدد شواهد قيد التجهيز للعنصر الواحد
const BATCH_PHOTOS_PER_CARD = 4;   // أقصى صور تُرفع دفعة واحدة لبطاقة
const BATCH_DEPTH_CHOICES = [1, 2, 3, 4];   // شواهد لكل عنصر — الأساس: العدد يُشتق من عدد العناصر لا أرقامًا اعتباطية
const BATCH_DEPTH_LABELS = { 1: 'شاهد', 2: 'شاهدان', 3: 'ثلاثة', 4: 'أربعة' };

let batchDrafts = [];              // مسودات المستخدم الحالية (بانتظار صورة)
let batchDone = [];                // أُنجزت بهذه الجلسة: { id, title, label, thumb, count }
let batchPick = {};                // { element_key: [template_name, ...] } اختيارات الشاشة الأولى
let batchOpenEl = new Set();       // العناصر المفتوحة بشاشة الاختيار
let batchExisting = {};            // { element_key: عدد شواهده الموثّقة بالدورة الحالية }
let batchUsedTpl = {};             // { element_key: [أسماء نماذج وُثّقت فعلًا بالدورة الحالية] }
let batchAutoNames = {};           // اختيارات جاءت من «الاقتراح» (مفتاحها key||name) — تُستبدل عند إعادته، واليدوية تبقى
let batchAutoDone = false;         // هل سُحب اقتراح بهذه الجلسة (يبدّل نص الزر لـ«غيّر الاقتراح»)
let batchElems = [];               // لقطة عناصر الأداء المعروضة (الفهرس ← العنصر) لأزرار الشاشة
let batchDepth = 2;                // عدد الشواهد المطلوب لكل عنصر
let batchCountExisting = false;    // «احسب ما وثّقته سابقًا»: الهدف = ما ينقص كل عنصر بعد الموثّق بالدورة الحالية
let batchTarget = 22;              // مجموع الاقتراح التلقائي — يُشتق من العمق والعناصر (batchSyncTarget)
let batchPeriod = 'custom';        // الفترة المختارة: sem1 | sem2 | year (من التقويم) | custom | single
let batchFrom = '', batchTo = '', batchOne = ''; // التواريخ المختارة (YYYY-MM-DD)
let batchPeriodTouched = false;    // هل اختار المعلم الفترة بنفسه (فلا نستبدلها بفصله الحالي)
let batchPreviewOpen = false;      // معاينة الأسابيع مفتوحة
let batchPreviewSem = null;        // الفصل المعروض بالمعاينة (1 | 2 | 0 = بلا تقويم)
let batchClasses = null;           // صفوف المعلم المسجَّلة بإدارة الصف [{ id, label, gradeName, secName }] — null = لا صفوف/لم تُحمَّل
let batchTimetable = [];           // حصصه الأسبوعية [{ section_id, weekday, period, semester }]
let batchClassSel = new Set();     // معرّفات الصفوف المحدَّدة لهذه الدفعة
let batchClassMode = 'timetable';  // توزيع الصفوف: timetable (حسب جدوله) | equal (بالتساوي)
let batchClassFree = new Set();    // بطاقات يكتب المعلم صفّها يدويًا (صف آخر)
let batchMoveFrom = null;          // يوم المعاينة المحدَّد لنقل شاهده (YYYY-MM-DD)
let batchTip = '';                 // نص شريط الشرح بالمعاينة (يبقى بعد إعادة الرسم)
let batchCapToday = true;          // «لا تضع تواريخ بعد اليوم» (مفعّل افتراضيًا؛ يُوقَف لتواريخ قادمة حتى آخر يوم دراسة)
let batchPlanned = null;           // آخر توزيع معروض بالمعاينة { from, to, count, ndays, dates } — يُعتمد عند الإنشاء
let batchBusyIds = new Set();      // بطاقات يجري رفع صورتها الآن
let batchStep = 'pick';            // pick | setup | board
let batchViewSeq = 0;              // يلغي نتيجة تحميل قديم لو فُتحت الشاشة ثانية
let batchFilter = 'all';           // فلتر قائمة العناصر: all | needs (بلا شواهد) | sel (فيها اختيار)
let batchQuery = '';               // بحث الشاشة (اسم عنصر أو نموذج)
let batchInnerQ = '';              // بحث داخل العنصر المفتوح
let batchShowAll = new Set();      // عناصر عُرضت كل نماذجها (الافتراضي أول BATCH_ROWS_FIRST)
let batchSheetOpen = false;        // ورقة «مراجعة اختياراتك»
let batchCal = null;               // تقويم نطاق المعلم { weeks, holidays } لشاشة البيانات — null لو غير متاح
const BATCH_ROWS_FIRST = 6;
const BATCH_STEPS = ['الاختيار', 'بياناتك', 'الصور'];
const BATCH_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
function batchAr(n){ return String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]); }
/* عدد الشواهد بصياغة عربية سليمة: شاهد واحد، شاهدان، ٣-١٠ شواهد، ١١+ شاهدًا */
function batchCountLabel(n){
  if(n === 1) return 'شاهد واحد';
  if(n === 2) return 'شاهدان';
  return batchAr(n) + (n >= 3 && n <= 10 ? ' شواهد' : ' شاهدًا');
}
function batchDateLabel(iso){ return batchAr(+iso.slice(8)) + ' ' + BATCH_MONTHS[+iso.slice(5, 7) - 1]; }

/* تصفير حالة الدفعة — يُستدعى عند دخول حساب (onLoggedIn) كي لا تبقى بطاقات
   مستخدم سابق على نفس الصفحة بعد تسجيل خروج/دخول */
function batchResetState(){
  batchDrafts = [];
  batchDone = [];
  batchPick = {};
  batchOpenEl = new Set();
  batchExisting = {};
  batchUsedTpl = {};
  batchAutoNames = {};
  batchAutoDone = false;
  batchElems = [];
  batchDepth = 2;
  batchCountExisting = false;
  batchTarget = 22;
  batchBusyIds = new Set();
  batchStep = 'pick';
  batchViewSeq++;
  batchFilter = 'all';
  batchQuery = '';
  batchInnerQ = '';
  batchShowAll = new Set();
  batchSheetOpen = false;
  batchCal = null;
  batchPeriod = 'custom';
  batchFrom = batchTo = batchOne = '';
  batchPeriodTouched = false;
  batchPreviewOpen = false;
  batchCapToday = true;
  batchPreviewSem = null;
  batchClasses = null;
  batchTimetable = [];
  batchClassSel = new Set();
  batchClassMode = 'timetable';
  batchClassFree = new Set();
  batchMoveFrom = null;
  batchTip = '';
  batchPlanned = null;
}

/* ============ دوال صرفة (قابلة للاختبار) ============ */

/* أيام الدراسة بين تاريخين (شاملة)، دون الجمعة والسبت */
function batchSchoolDays(startIso, endIso){
  const days = [];
  if(!startIso || !endIso || startIso > endIso) return days;
  let d = startIso;
  for(let i = 0; i < 400 && d <= endIso; i++){
    const wd = weekdayOfIso(d);
    if(wd !== 5 && wd !== 6) days.push(d);
    d = addDaysIso(d, 1);
  }
  return days;
}

/* فهرس صفوف التقويم الرسمي (academic_calendar_weeks) بحسب التاريخ */
function batchWeekIndex(weekRows){
  const idx = {};
  (weekRows || []).forEach(r => { if(r && r.gregorian_date) idx[r.gregorian_date] = r; });
  return idx;
}

/* هل هذا اليوم يوم دراسة فعلي للطلاب؟ { ok:true } أو { ok:false, reason }.
   التقويم فيه صف لكل يوم دراسة (أحد-خميس) فقط؛ فالإجازات الطويلة بلا صفوف،
   والإجازات المنفردة (اليوم الوطني، إجازة إضافية، يوم التأسيس) وأيام الاختبارات
   تحمل note، وأيام عودة المعلمين قبل بدء الطلاب تحمل week_label يبدأ بـ«عودة» */
function batchDayStatus(idx, holidayRows, iso){
  const wd = weekdayOfIso(iso);
  if(wd === 5 || wd === 6) return { ok: false, reason: 'عطلة نهاية الأسبوع' };
  const holiday = findHolidayForDate(holidayRows, iso);
  if(holiday) return { ok: false, reason: holiday };
  const row = idx[iso];
  if(!row) return { ok: false, reason: 'لا دراسة' };
  if(row.note) return { ok: false, reason: row.note };
  if(row.week_label && String(row.week_label).indexOf('عودة') === 0) return { ok: false, reason: 'قبل بدء الدراسة' };
  return { ok: true };
}

/* أيام الدراسة الفعلية بين تاريخين (شاملة) بحسب التقويم الرسمي */
function batchCalendarDays(weekRows, holidayRows, startIso, endIso){
  const days = [];
  if(!startIso || !endIso || startIso > endIso) return days;
  const idx = batchWeekIndex(weekRows);
  let d = startIso;
  for(let i = 0; i < 400 && d <= endIso; i++){
    if(batchDayStatus(idx, holidayRows, d).ok) days.push(d);
    d = addDaysIso(d, 1);
  }
  return days;
}

/* حدود فترة جاهزة من التقويم الرسمي. key: sem1 | sem2 | year.
   from = أول يوم دراسة فعلي بها، to = آخر يوم دراسة فعلي بها (لا يُقصّ عند اليوم —
   القصّ عند اليوم قرار مفتاح «لا تضع تواريخ بعد اليوم» بـ batchPeriodInfo).
   available=false لو لا بيانات لها. «العام كاملًا».to = آخر يوم دراسة بالعام */
function batchPeriodRange(weekRows, holidayRows, key){
  const idx = batchWeekIndex(weekRows);
  const valid = (weekRows || []).filter(r => r && r.gregorian_date && batchDayStatus(idx, holidayRows, r.gregorian_date).ok)
    .sort((a, b) => a.gregorian_date.localeCompare(b.gregorian_date));
  const rows = key === 'year' ? valid : valid.filter(r => r.semester === (key === 'sem2' ? 2 : 1));
  if(!rows.length) return { available: false, from: null, to: null, startsOn: null };
  const first = rows[0].gregorian_date, last = rows[rows.length - 1].gregorian_date;
  return { available: true, from: first, to: last, startsOn: first };
}

/* آخر يوم دراسة بالعام — الحد الأقصى للتواريخ القادمة؛ null لو لا تقويم */
function batchYearEnd(){
  if(!batchCal) return null;
  const r = batchPeriodRange(batchCal.weeks, batchCal.holidays, 'year');
  return r.available ? r.to : null;
}

/* أقصى تاريخ يُقبل لبطاقة منفردة: آخر يوم دراسة لو التقويم متاح، وإلا اليوم */
function batchDateLimit(){
  const today = localIsoDate(), end = batchYearEnd();
  return end && end > today ? end : today;
}

/* الفصل الدراسي الحالي (1 أو 2) = فصل آخر يوم دراسة ≤ اليوم؛ null لو لم يبدأ العام */
function batchCurrentSemester(weekRows, holidayRows, todayIso){
  const idx = batchWeekIndex(weekRows);
  let best = null;
  (weekRows || []).forEach(r => {
    if(!r || !r.gregorian_date || r.gregorian_date > todayIso) return;
    if(!batchDayStatus(idx, holidayRows, r.gregorian_date).ok) return;
    if(!best || r.gregorian_date > best.gregorian_date) best = r;
  });
  return best ? best.semester : null;
}

/* ============ صفوف المعلم (من إدارة الصف) ============ */
const BATCH_CLASS_COLORS = ['#1B3245', '#A9852E', '#2F7D5B', '#6B4E9B', '#1F7A8C', '#8A4B2D'];

/* الفصل الدراسي (1|2) لتاريخ: صفّه بالتقويم، وإلا آخر صف قبله، وإلا أول صف، وإلا 1 */
function batchSemesterOf(weekRows, iso){
  const rows = (weekRows || []).filter(r => r && r.gregorian_date && r.semester);
  if(!rows.length) return 1;
  const exact = rows.find(r => r.gregorian_date === iso);
  if(exact) return exact.semester;
  let prev = null, first = rows[0];
  rows.forEach(r => {
    if(r.gregorian_date < first.gregorian_date) first = r;
    if(r.gregorian_date < iso && (!prev || r.gregorian_date > prev.gregorian_date)) prev = r;
  });
  return (prev || first).semester;
}

/* رمز مختصر لكل صف (أول كلمة من المرحلة + رقم الشعبة)؛ لو تكرّر رمز بين صفين نستخدم ص١ ص٢... */
function batchClassCodes(classes){
  const out = {};
  const base = c => ((c.gradeName || '').trim().split(/\s+/)[0] || '') + ' ' + batchAr(crmDigits(c.secName || ''));
  const seen = {};
  classes.forEach(c => { const b = base(c).trim(); seen[b] = (seen[b] || 0) + 1; });
  classes.forEach((c, i) => { const b = base(c).trim(); out[c.id] = (b && seen[b] === 1) ? b : 'ص' + batchAr(i + 1); });
  return out;
}

/* أيام تدريس صف (أرقام الأيام) بفصل معيّن؛ semester=null = كل الفصول */
function batchTeachDays(timetable, sectionId, semester){
  const set = {};
  (timetable || []).forEach(sl => { if(sl.section_id === sectionId && (semester == null || sl.semester === semester)) set[sl.weekday] = true; });
  return Object.keys(set).map(Number).sort((a, b) => a - b);
}

/* حصص صف بيوم وفصل معيّنين مرتّبة */
function batchTeachPeriods(timetable, sectionId, semester, weekday){
  return (timetable || []).filter(sl => sl.section_id === sectionId && sl.weekday === weekday && sl.semester === semester)
    .map(sl => sl.period).sort((a, b) => a - b);
}

/* هل يدرّس هذا الصف في هذا التاريخ؟ true | false | null (لا جدول لهذا الصف بهذا الفصل فلا حكم) */
function batchTeachesOn(timetable, sectionId, semester, iso){
  const slots = (timetable || []).filter(sl => sl.section_id === sectionId && sl.semester === semester);
  if(!slots.length) return null;
  const wd = weekdayOfIso(iso);
  return slots.some(sl => sl.weekday === wd);
}

/* توزيع الصفوف المحدّدة على التواريخ (مرتّبة): نفس الطول، قيمها أسماء الصفوف.
   mode=timetable: لكل تاريخ تُفضَّل الصفوف التي تدرّسها ذلك اليوم (الصف بلا جدول بالفصل يصلح أي يوم)،
   فإن لم يوجد أحد رجعنا لكل الصفوف. وبين المرشّحين نأخذ الأقل شواهد حتى يتساوى التوزيع. rng قابل للحقن */
function batchAssignClasses(dates, classes, opts){
  if(!classes || !classes.length) return (dates || []).map(() => '');
  if(classes.length === 1) return dates.map(() => classes[0].label);
  const rng = (opts && opts.rng) || Math.random;
  const tt = (opts && opts.timetable) || [];
  const semesterOf = (opts && opts.semesterOf) || (() => 1);
  const useTt = !!(opts && opts.mode === 'timetable') && classes.some(c => tt.some(sl => sl.section_id === c.id));
  const counts = {};
  classes.forEach(c => { counts[c.id] = 0; });
  return dates.map(iso => {
    let pool = classes;
    if(useTt){
      const sem = semesterOf(iso);
      const allowed = classes.filter(c => batchTeachesOn(tt, c.id, sem, iso) !== false);
      if(allowed.length) pool = allowed;
    }
    const min = Math.min(...pool.map(c => counts[c.id]));
    const cands = pool.filter(c => counts[c.id] === min);
    const pick = cands[Math.floor(rng() * cands.length)];
    counts[pick.id]++;
    return pick.label;
  });
}

/* توزيع تواريخ وصفوف معًا: لكل بطاقة شريحتها من أيام الدراسة (كالتوزيع العادي) مع نافذة تمتد يومًا
   على جانبيها، ويُختار (يوم، صف) بحيث يكون الصف المسموح ذلك اليوم هو الأقل شواهد حتى الآن —
   فيتساوى توزيع الصفوف بدل أن يتبع تكرار أيام الأسبوع. تُرتَّب النتيجة بالتاريخ.
   تتطلب صفّين فأكثر وأيامًا لا تقلّ عن البطاقات؛ وإلا يرجع التوزيع العادي ثم تعيين الصفوف */
function batchSpreadWithClasses(count, days, classes, opts){
  const o = opts || {};
  const rng = o.rng || Math.random;
  const fallback = () => {
    const dates = batchSpreadDates(count, null, null, { days, rng });
    return { dates, classes: batchAssignClasses(dates, classes, o) };
  };
  if(count <= 0 || !days || !days.length || !classes || classes.length < 2 || count > days.length || count === 1) return fallback();
  const tt = o.timetable || [];
  const semesterOf = o.semesterOf || (() => 1);
  const useTt = o.mode === 'timetable' && classes.some(c => tt.some(sl => sl.section_id === c.id));
  const allowedOn = iso => {
    if(!useTt) return classes;
    const sem = semesterOf(iso);
    const al = classes.filter(c => batchTeachesOn(tt, c.id, sem, iso) !== false);
    return al.length ? al : classes;
  };
  const L = days.length, counts = {}, usedDay = {};
  classes.forEach(c => { counts[c.id] = 0; });
  const pairs = [];
  for(let i = 0; i < count; i++){
    const lo = Math.floor(i * L / count), hi = Math.floor((i + 1) * L / count) - 1;
    let win = [];
    for(let k = Math.max(0, lo - 1); k <= Math.min(L - 1, hi + 1); k++) if(!usedDay[days[k]]) win.push(k);
    if(!win.length) for(let k = lo; k <= hi; k++) win.push(k);
    let best = null;
    win.forEach(k => allowedOn(days[k]).forEach(c => {
      const core = k >= lo && k <= hi ? 0 : 1;
      const score = counts[c.id] * 10 + core;
      if(!best || score < best.score) best = { score, list: [{ k, c }] };
      else if(score === best.score) best.list.push({ k, c });
    }));
    const pick = best.list[Math.floor(rng() * best.list.length)];
    counts[pick.c.id]++;
    usedDay[days[pick.k]] = true;
    pairs.push({ date: days[pick.k], label: pick.c.label });
  }
  pairs.sort((a, b) => a.date.localeCompare(b.date));
  return { dates: pairs.map(x => x.date), classes: pairs.map(x => x.label) };
}

/* نقل شاهد من يوم إلى يوم داخل خطة { dates, classes }: ينقل أول شاهد بـ fromIso إلى toIso ويُبقي صفّه،
   ثم يعيد ترتيب الأزواج بالتاريخ. يرجع { ok, label (صف الشاهد المنقول) } أو { ok:false }.
   validDays: أيام الدراسة المسموحة (وجهة النقل تُقبل فقط منها). يجوز أكثر من شاهد باليوم */
function batchMovePlanned(plan, fromIso, toIso, validDays){
  if(!plan || !plan.dates || fromIso === toIso || !(validDays || []).includes(toIso)) return { ok: false };
  const i = plan.dates.indexOf(fromIso);
  if(i < 0) return { ok: false };
  const label = plan.classes ? plan.classes[i] : '';
  const pairs = plan.dates.map((d, k) => ({ d: k === i ? toIso : d, c: plan.classes ? plan.classes[k] : null, k }));
  pairs.sort((a, b) => a.d.localeCompare(b.d) || a.k - b.k);
  plan.dates = pairs.map(x => x.d);
  if(plan.classes) plan.classes = pairs.map(x => x.c);
  return { ok: true, label };
}

/* رقم كل أسبوع دراسة بالتقويم الرسمي، يبدأ من ١ في كل فصل ولا تُعدّ فيه أسابيع الإجازات
   الطويلة (لا صفوف لها) ولا أيام عودة المعلمين. يرجع { 'أحد الأسبوع YYYY-MM-DD': { semester, n } } */
function batchWeekNumbers(weekRows){
  const sundays = {};
  (weekRows || []).forEach(r => {
    if(!r || !r.gregorian_date) return;
    if(r.week_label && String(r.week_label).indexOf('عودة') === 0) return;
    const sun = addDaysIso(r.gregorian_date, -weekdayOfIso(r.gregorian_date));
    if(!sundays[sun]) sundays[sun] = r.semester;
  });
  const out = {}, counters = {};
  Object.keys(sundays).sort().forEach(sun => {
    const sem = sundays[sun];
    counters[sem] = (counters[sem] || 0) + 1;
    out[sun] = { semester: sem, n: counters[sem] };
  });
  return out;
}

/* معاينة الفترة مقسّمة بالفصول: [{ semester, weeks:[{ n|null, cells }] }].
   كل أسبوع يتبع فصل صفوفه بالتقويم، وأسبوع الإجازة (بلا صفوف) يتبع الفصل السابق له.
   بلا تقويم: قسم واحد semester=0 بترقيم تسلسلي من ١ */
function batchPreviewSections(fromIso, toIso, weekRows, holidayRows, pickedDates, hasCal, todayIso, pickedClasses){
  const rows = batchWeekRows(fromIso, toIso, weekRows, holidayRows, pickedDates, hasCal, todayIso, pickedClasses);
  if(!rows.length) return [];
  if(!hasCal) return [{ semester: 0, weeks: rows.map(r => ({ n: r.n, cells: r.cells })) }];
  const nums = batchWeekNumbers(weekRows);
  const weeks = rows.map(r => {
    const info = nums[r.cells[0].iso];
    return { n: info ? info.n : null, sem: info ? info.semester : null, cells: r.cells };
  });
  let last = null;
  weeks.forEach(w => { if(w.sem != null) last = w.sem; else w.sem = last; });
  let next = null;
  for(let i = weeks.length - 1; i >= 0; i--){ if(weeks[i].sem != null) next = weeks[i].sem; else weeks[i].sem = next; }
  const sections = [];
  weeks.forEach(w => {
    let sec = sections[sections.length - 1];
    if(!sec || sec.semester !== w.sem){ sec = { semester: w.sem, weeks: [] }; sections.push(sec); }
    sec.weeks.push({ n: w.n, cells: w.cells });
  });
  return sections;
}

/* أسابيع (أحد-خميس) تغطي الفترة للمعاينة. pickedDates: التواريخ الموزَّعة.
   حالة الخلية: out (خارج الفترة) | off (إجازة/ليس يوم دراسة + reason) | pick (+count) | study،
   وfuture=true لو التاريخ بعد todayIso */
function batchWeekRows(fromIso, toIso, weekRows, holidayRows, pickedDates, hasCal, todayIso, pickedClasses){
  const rows = [];
  if(!fromIso || !toIso || fromIso > toIso) return rows;
  const idx = batchWeekIndex(weekRows);
  const counts = {};
  const classesOn = {};
  (pickedDates || []).forEach((d, i) => {
    counts[d] = (counts[d] || 0) + 1;
    const lab = pickedClasses && pickedClasses[i];
    if(lab){ (classesOn[d] = classesOn[d] || []); if(classesOn[d].indexOf(lab) === -1) classesOn[d].push(lab); }
  });
  const wd = weekdayOfIso(fromIso);
  let sunday = wd >= 5 ? addDaysIso(fromIso, 7 - wd) : addDaysIso(fromIso, -wd);
  let first = true;
  for(let w = 0; w < 60 && sunday <= toIso; w++){
    const cells = [];
    for(let k = 0; k < 5; k++){
      const iso = addDaysIso(sunday, k);
      if(iso < fromIso || iso > toIso){ cells.push({ iso, status: 'out' }); continue; }
      const cell = { iso, status: 'study', future: !!todayIso && iso > todayIso, month: (first || iso.slice(8) === '01') ? BATCH_MONTHS[+iso.slice(5, 7) - 1] : '' };
      first = false;
      const st = hasCal ? batchDayStatus(idx, holidayRows, iso) : { ok: true };
      if(!st.ok){ cell.status = 'off'; cell.reason = st.reason; }
      else if(counts[iso]){ cell.status = 'pick'; cell.count = counts[iso]; if(classesOn[iso]) cell.classes = classesOn[iso]; }
      cells.push(cell);
    }
    rows.push({ n: w + 1, cells });
    sunday = addDaysIso(sunday, 7);
  }
  return rows;
}

/* توزيع count تاريخًا على أيام الدراسة (مرتّبة تصاعديًا): تُقسَّم الفترة إلى count
   شريحة متساوية ويُسحب لكل بطاقة يوم عشوائي من شريحتها — فتغطي الفترة كلها دون
   تكرار يوم، ولا تبدو مسافاتها متطابقة بشكل مصطنع. إن زادت البطاقات عن الأيام
   تتكرر بعض الأيام بالتساوي. opts.days: أيام الدراسة من التقويم (وإلا دون
   الجمعة والسبت فقط)، opts.rng: قابل للحقن للاختبار */
function batchSpreadDates(count, startIso, endIso, opts){
  if(count <= 0) return [];
  const rng = (opts && opts.rng) || Math.random;
  const days = (opts && opts.days) || batchSchoolDays(startIso, endIso);
  if(!days.length) return Array(count).fill(endIso || startIso || null);
  if(count === 1) return [days[days.length - 1]];
  const L = days.length;
  const out = [];
  for(let i = 0; i < count; i++){
    if(count > L){ out.push(days[Math.round(i * (L - 1) / (count - 1))]); continue; }
    const lo = Math.floor(i * L / count);
    const hi = Math.floor((i + 1) * L / count) - 1;
    out.push(days[lo + Math.floor(rng() * (hi - lo + 1))]);
  }
  return out;
}

/* دمج مجموعات بالتناوب (واحد من كل مجموعة ثم الدورة التالية) كي لا تتجمّع
   شواهد عنصر واحد في أسبوع واحد عند توزيع التواريخ */
function batchInterleave(groups){
  const out = [];
  const max = Math.max(0, ...groups.map(g => g.length));
  for(let r = 0; r < max; r++){
    groups.forEach(g => { if(r < g.length) out.push(g[r]); });
  }
  return out;
}

/* خلط عشوائي (Fisher-Yates) لنسخة من المصفوفة — rng قابل للحقن للاختبار */
function batchShuffle(arr, rng){
  const a = arr.slice();
  const r = rng || Math.random;
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(r() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* اقتراح توزيع عشوائي: يخلط نماذج كل عنصر وترتيب العناصر نفسه (فلا تأخذ العناصر
   الأولى النصيب الزائد دائمًا)، ثم يمرّ بالتناوب حتى يبلغ العدد المطلوب، دون
   تجاوز سعة العنصر (4 ناقص قيد التجهيز) ولا تكرار نموذج قيد التجهيز.
   elements: [{ key, names: [نماذج لم تُستخدم], used: [نماذج وُثّقت سابقًا — بديل أخير] }]
   capacity: { key: السعة المتبقية }
   opts.keep: { key: [اختيارات يدوية تبقى وتُحسب ضمن العدد والسعة] }، opts.rng
   opts.goal: { key: أقصى عدد مطلوب لهذا العنصر } — يحدّ السعة فيتساوى التوزيع بدل باقٍ عشوائي
   يرجع { key: [names] } شاملًا المحتفَظ بها أولًا. */
function batchAutoDistribute(elements, target, capacity, opts){
  const rng = (opts && opts.rng) || Math.random;
  const keep = (opts && opts.keep) || {};
  const goal = (opts && opts.goal) || {};
  const picked = {};
  const pools = {};
  elements.forEach(e => {
    const kept = (keep[e.key] || []).slice();
    picked[e.key] = kept;
    /* النماذج التي لم تُستخدم أولًا (مخلوطة)، ثم المستخدمة سابقًا كبديل أخير
       كي لا يبقى عنصر فارغًا لو استُنفدت نماذجه */
    pools[e.key] = batchShuffle(e.names.filter(n => kept.indexOf(n) < 0), rng)
      .concat(batchShuffle((e.used || []).filter(n => kept.indexOf(n) < 0 && e.names.indexOf(n) < 0), rng));
  });
  const order = batchShuffle(elements, rng);
  let total = elements.reduce((n, e) => n + picked[e.key].length, 0);
  const next = {};
  let progress = true;
  while(total < target && progress){
    progress = false;
    for(const e of order){
      if(total >= target) break;
      let cap = capacity[e.key] == null ? BATCH_MAX_PER_ELEMENT : capacity[e.key];
      if(goal[e.key] != null) cap = Math.min(cap, goal[e.key]);
      const i = next[e.key] || 0;
      if(picked[e.key].length < cap && i < pools[e.key].length){
        picked[e.key].push(pools[e.key][i]);
        next[e.key] = i + 1;
        total++;
        progress = true;
      }
    }
  }
  return picked;
}

/* صفوف المسودات من القائمة المختارة (مرتّبة أصلًا) وتواريخها المقابلة */
function buildBatchDraftRows(items, dates, ctx){
  return items.map((it, i) => ({
    user_id: ctx.userId,
    element_key: it.element_key,
    template_name: it.template_name,
    title: it.template_name,
    planned_date: dates[i] || null,
    teacher_name: ctx.teacher || '',
    school: ctx.school || '',
    subject: ctx.subject || '',
    class_name: (ctx.classNames && ctx.classNames[i]) || ctx.className || '',
    cycle_year: getCycleYear(dates[i] || undefined)
  }));
}

/* سجل الشاهد الحقيقي من مسودة + نموذجها + روابط الصور. المعرّف = معرّف المسودة */
function buildBatchShahidRecord(draft, tpl, photoUrls, elementLabel, email){
  const t = tpl || {};
  const date = draft.planned_date || null;
  return {
    id: draft.id,
    user_id: draft.user_id,
    teacher_name: draft.teacher_name || '',
    teacher_email: email || '',
    school: draft.school || '',
    subject: draft.subject || '',
    class_name: draft.class_name || '',
    lesson_title: draft.title || '',
    lesson_date: date,
    element_key: draft.element_key,
    element_label: elementLabel || draft.element_key,
    description: t.description || '',
    goal: t.goal || '',
    steps: Array.isArray(t.steps) ? t.steps : [],
    photo_urls: photoUrls,
    quant_impact: t.quant || '',
    qual_impact: t.qual || '',
    reflection: t.reflection || '',
    goal_id: null,
    cycle_year: getCycleYear(date || undefined),
    cycle_stage: getCycleStageKey(date ? new Date(date) : new Date())
  };
}

/* ============ تحميل ============ */
async function loadBatchDrafts(){
  if(!currentUser) return false;
  const uid = currentUser.id;
  /* فلترة صريحة بالمالك — نفس سبب فلترة loadMyShawahid */
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('shahid_drafts')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));
  if(error || !currentUser || currentUser.id !== uid) return false;
  batchDrafts = data || [];
  return true;
}

async function loadBatchExisting(){
  if(!currentUser) return;
  const uid = currentUser.id;
  const { data, error } = await fetchAllRows((from, to) => sb
    .from('shawahid')
    .select('id, element_key, cycle_year, lesson_date, created_at, lesson_title, description')
    .eq('user_id', uid)
    .order('id', { ascending: true })
    .range(from, to));
  if(error || !currentUser || currentUser.id !== uid) return;
  const cy = getCycleYear();
  const counts = {}, used = {};
  (data || []).forEach(r => {
    const y = r.cycle_year || getCycleYear(r.lesson_date || r.created_at || undefined);
    if(y !== cy) return;
    counts[r.element_key] = (counts[r.element_key] || 0) + 1;
    /* نموذج وُثّق فعلًا: عنوان الشاهد = اسم النموذج (من الدفعة)، أو وصفه = وصف
       النموذج (طُبّق من نموذج شاهد جديد) */
    (SHAHID_TEMPLATES[r.element_key] || []).forEach(t => {
      if(r.lesson_title === t.name || (t.description && String(r.description || '').trim() === t.description.trim())){
        (used[r.element_key] = used[r.element_key] || []).indexOf(t.name) < 0 && used[r.element_key].push(t.name);
      }
    });
  });
  batchExisting = counts;
  batchUsedTpl = used;
}

/* زر الدخول بأعلى شواهدي: يظهر فقط لو جدول المسودات جاهز بقاعدة البيانات
   (قبل تشغيل تحديث SQL يفشل الاستعلام فنُخفي الزر بدل أن نُظهر خطأ للمعلم) */
async function refreshBatchEntry(){
  const box = document.getElementById('batchEntry');
  if(!box || !currentUser) return;
  const uid = currentUser.id;
  /* بلا head:true — استعلام HEAD لا يُرجع خطأً عند غياب الجدول (404 بلا جسم)،
     فكان الزر يظهر قبل تشغيل SQL. هنا يفشل صراحةً، وغياب العدّ نفسه فشل أيضًا. */
  const { count, error } = await sb.from('shahid_drafts')
    .select('id', { count: 'exact' }).eq('user_id', uid).limit(1);
  if(!currentUser || currentUser.id !== uid) return;
  if(error || typeof count !== 'number'){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  const sub = document.getElementById('batchEntrySub');
  if(sub) sub.textContent = count
    ? `عندك ${count} بانتظار الصورة — أكمل من حيث توقفت`
    : 'اختر النماذج مرة واحدة، ثم أضف الصور فقط';
}

/* ============ الشاشة ============ */
function isBatchViewOpen(){
  const v = document.getElementById('batchView');
  return !!v && v.style.display === 'block';
}

async function showBatch(){
  hideAllMainViews();
  setActiveBottomTab('shahid');
  document.getElementById('batchView').style.display = 'block';
  const body = document.getElementById('batchBody');
  body.innerHTML = '<div class="loading-state">جارِ التحميل...</div>';
  const seq = ++batchViewSeq;
  const ok = await loadBatchDrafts();
  if(seq !== batchViewSeq || !isBatchViewOpen()) return;
  if(!ok){
    body.innerHTML = '<div class="empty-state">تعذّر تحميل المسودات. تأكد من الاتصال ثم حاول مجددًا.<br><button type="button" class="btn btn-outline" style="margin-top:14px;" onclick="showList()">→ شواهدي</button></div>';
    return;
  }
  batchPick = {};
  batchAutoNames = {};
  batchSheetOpen = false;
  renderBatchSheet();
  if(batchDrafts.length){
    renderBatchBoard();
    /* حدّ محرّر تاريخ البطاقة يحتاج التقويم: نجلبه ثم نعيد الرسم مرة لو تغيّر الحد */
    Promise.all([batchLoadCalendar(), batchLoadClasses()]).then(([cal, cls]) => {
      if(seq !== batchViewSeq || !isBatchViewOpen() || batchStep !== 'board') return;
      const before = batchDateLimit() + '|' + (batchClasses ? batchClasses.length : 0);
      if(cal) batchCal = cal;
      if(cls && cls.classes.length){ batchClasses = cls.classes; batchTimetable = cls.timetable; }
      if(batchDateLimit() + '|' + (batchClasses ? batchClasses.length : 0) !== before) renderBatchBoard();
    });
  } else await showBatchPick();
}

async function showBatchPick(){
  batchStep = 'pick';
  batchFilter = 'all';
  batchQuery = '';
  batchInnerQ = '';
  batchShowAll = new Set();
  const seq = ++batchViewSeq;
  const body = document.getElementById('batchBody');
  if(!DB_ELEMENTS || !DB_ELEMENTS.length){
    body.innerHTML = '<div class="empty-state">لم تُحمَّل عناصر الأداء بعد. أعد المحاولة بعد لحظات.</div>';
    return;
  }
  await loadBatchExisting();
  if(seq !== batchViewSeq || !isBatchViewOpen() || batchStep !== 'pick') return;
  batchElems = DB_ELEMENTS.slice();
  batchSyncTarget();
  renderBatchPick();
}

function batchPendingCount(key){
  return batchDrafts.filter(d => d.element_key === key).length;
}
function batchPickedTotal(){
  return Object.keys(batchPick).reduce((n, k) => n + batchPick[k].length, 0);
}
function batchCapacity(key){
  return Math.max(0, BATCH_MAX_PER_ELEMENT - batchPendingCount(key));
}

/* دالة صرفة: المطلوب لكل عنصر بعمق معيّن. info: { key: { cap: السعة المتبقية، existing: الموثّق بالدورة، tpl: عدد نماذجه } }.
   countExisting=false: الهدف = العمق؛ true: العمق ناقص الموثّق (لا يقلّ عن صفر). ويُحدّ بالسعة وبعدد النماذج المتاحة.
   يرجع { goals: { key: n }, total, covered: عناصر هدفها > 0, doneBefore: ما وُثّق وقُبل ضمن العمق } */
function batchGoals(keys, depth, countExisting, info){
  const goals = {};
  let total = 0, covered = 0, doneBefore = 0;
  keys.forEach(k => {
    const x = (info && info[k]) || {};
    const ex = countExisting ? Math.min(x.existing || 0, depth) : 0;
    const g = Math.max(0, Math.min(depth - ex, x.cap == null ? BATCH_MAX_PER_ELEMENT : x.cap, x.tpl == null ? Infinity : x.tpl));
    goals[k] = g;
    total += g;
    if(g > 0) covered++;
    doneBefore += ex;
  });
  return { goals, total, covered, doneBefore };
}

function batchGoalInfo(){
  const info = {};
  batchElems.forEach(el => {
    info[el.key] = { cap: batchCapacity(el.key), existing: batchExisting[el.key] || 0, tpl: (SHAHID_TEMPLATES[el.key] || []).length };
  });
  return info;
}

/* يحدّث batchTarget من العمق ومفتاح الموثّق */
function batchSyncTarget(){
  batchTarget = batchGoals(batchElems.map(e => e.key), batchDepth, batchCountExisting, batchGoalInfo()).total;
}

/* سطر الملخّص تحت الأزرار */
function batchDepthSummary(){
  const g = batchGoals(batchElems.map(e => e.key), batchDepth, batchCountExisting, batchGoalInfo());
  if(!batchCountExisting) return `${batchCountLabel(g.total)} موزعة على ${batchAr(g.covered)} ${g.covered === 1 ? 'عنصر' : 'عنصرًا'}`;
  if(!g.total) return `كل عناصرك بلغت ${BATCH_DEPTH_LABELS[batchDepth]} ✓`;
  return `وثّقتَ ${batchAr(g.doneBefore)} سابقًا ← ينقصك ${batchCountLabel(g.total)} لتبلغ ${BATCH_DEPTH_LABELS[batchDepth]} لكل عنصر`;
}

function batchHeader(stepNo, title, sub){
  const steps = BATCH_STEPS.map((label, k) => {
    const n = k + 1;
    const cls = n === stepNo ? ' on' : (n < stepNo ? ' past' : '');
    return `<div class="bt-stp${cls}"><b>${n < stepNo ? '✓' : n}</b>${label}</div>`;
  }).join('<span class="bt-stl"></span>');
  return `<div class="bt-head">
    <div class="bt-head-top">
      <button type="button" class="bt-back" aria-label="الرجوع إلى شواهدي" title="شواهدي" onclick="showList()">→</button>
      <span class="bt-stepno">الخطوة ${stepNo} من 3</span>
    </div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
    <div class="bt-stepper" role="list" aria-label="خطوات التجهيز">${steps}</div>
  </div>`;
}

/* ---------- 1) الاختيار ---------- */
function renderBatchPick(){
  const body = document.getElementById('batchBody');
  const chips = BATCH_DEPTH_CHOICES.map(n =>
    `<button type="button" class="bt-tchip${n === batchDepth ? ' on' : ''}" aria-pressed="${n === batchDepth}" onclick="batchSetDepth(${n})"><b>${BATCH_DEPTH_LABELS[n]}</b><i>${batchAr(n * batchElems.length)}</i></button>`).join('');
  body.innerHTML = `
    ${batchHeader(1, 'اختر شواهدك', 'اختر ما يناسب عملك — حتى ' + BATCH_MAX_PER_ELEMENT + ' شواهد لكل عنصر، ونعبّئ لك التفاصيل تلقائيًا')}
    <div class="bt-auto">
      <div class="bt-auto-top">
        <div class="bt-ring" id="btRing"><span id="btRingNum"></span></div>
        <div class="bt-auto-t"><b>كم شاهدًا لكل عنصر؟</b><small>اختر العمق، ثم دع التطبيق يوزّع بالتساوي</small></div>
      </div>
      <div class="bt-tchips" role="group" aria-label="عدد الشواهد لكل عنصر">${chips}</div>
      <div class="bt-dsum" id="btDepthSum">${escapeHtml(batchDepthSummary())}</div>
      <button type="button" class="bt-tog" role="switch" aria-checked="${batchCountExisting}" onclick="batchToggleExisting()">
        <span class="bt-sw${batchCountExisting ? '' : ' off'}" aria-hidden="true"></span>
        <span>احسب ما وثّقته سابقًا<small>نقترح فقط ما ينقص كل عنصر</small></span>
      </button>
      <button type="button" class="bt-auto-btn" id="btAutoBtn" onclick="batchAutoPick()">${batchAutoLabel()}</button>
      <p class="bt-auto-note">تعدّل الاقتراح بعدها كما تشاء — وما اخترته بنفسك يبقى</p>
    </div>
    <div class="bt-tools">
      <div class="bt-filters" id="btFilters"></div>
      <input type="search" id="btSearch" class="bt-search" placeholder="ابحث في العناصر والنماذج…" aria-label="ابحث في العناصر والنماذج" value="${escapeHtml(batchQuery)}" oninput="batchOnSearch(this.value)">
    </div>
    <div id="btElList">${batchListHtml()}</div>
    <div class="sh-fab-wrap bt-bar"><div id="btBar"></div></div>`;
  renderBatchBar();
}

function batchNorm(s){ return String(s || '').trim().toLowerCase(); }

function batchElMatches(el, q){
  const n = batchNorm(q);
  if(!n) return true;
  return batchNorm(el.label).includes(n) || (SHAHID_TEMPLATES[el.key] || []).some(t => batchNorm(t.name).includes(n));
}

function batchElVisible(el){
  if(!batchElMatches(el, batchQuery)) return false;
  if(batchFilter === 'needs') return !(batchExisting[el.key] || 0);
  if(batchFilter === 'sel') return (batchPick[el.key] || []).length > 0;
  return true;
}

function batchListHtml(){
  const idx = batchElems.map((el, i) => i).filter(i => batchElVisible(batchElems[i]));
  if(!idx.length) return '<div class="empty-state">لا عناصر مطابقة — غيّر الفلتر أو كلمة البحث.</div>';
  const lacks = i => !(batchExisting[batchElems[i].key] || 0);
  const needs = idx.filter(lacks), has = idx.filter(i => !lacks(i));
  /* العناصر الفارغة أولًا بعنوانَي قسم — فقط حين لا فلتر ولا بحث وللقسمين أعضاء */
  if(batchFilter === 'all' && !batchNorm(batchQuery) && needs.length && has.length){
    return `<div class="bt-sec">تحتاج شواهد أولًا</div>${needs.map(i => batchPickCardHtml(i)).join('')}
      <div class="bt-sec">لديها شواهد</div>${has.map(i => batchPickCardHtml(i)).join('')}`;
  }
  return idx.map(i => batchPickCardHtml(i)).join('');
}

function batchFiltersHtml(){
  const needs = batchElems.filter(el => !(batchExisting[el.key] || 0)).length;
  const sel = batchElems.filter(el => (batchPick[el.key] || []).length).length;
  const f = (key, label, n) =>
    `<button type="button" class="bt-fchip${batchFilter === key ? ' on' : ''}" aria-pressed="${batchFilter === key}" onclick="batchSetFilter('${key}')">${label} ${n}</button>`;
  return f('all', 'الكل', batchElems.length) + f('needs', 'ينقصها شواهد', needs) + f('sel', 'مختارة', sel);
}

function batchRenderList(){
  const box = document.getElementById('btElList');
  if(box) box.innerHTML = batchListHtml();
}

function batchSetFilter(f){
  batchFilter = (f === 'needs' || f === 'sel') ? f : 'all';
  batchRenderList();
  const fb = document.getElementById('btFilters');
  if(fb) fb.innerHTML = batchFiltersHtml();
}

function batchOnSearch(v){
  batchQuery = String(v || '');
  batchRenderList();
}

function batchPickCardHtml(i){
  const el = batchElems[i];
  const names = (SHAHID_TEMPLATES[el.key] || []).map(t => t.name);
  const picked = batchPick[el.key] || [];
  const pend = batchPendingCount(el.key);
  const cap = batchCapacity(el.key);
  const used = picked.length + pend;
  const existing = batchExisting[el.key] || 0;
  const open = batchOpenEl.has(el.key);
  const full = used >= BATCH_MAX_PER_ELEMENT;
  /* خانات العدّاد: الكحلي = قيد التجهيز سابقًا، الذهبي = اخترته الآن */
  const meter = Array.from({ length: BATCH_MAX_PER_ELEMENT }, (_, n) =>
    n < pend ? '<i class="g"></i>' : (n < pend + picked.length ? '<i class="f"></i>' : '<i></i>')).join('');
  const existingNote = existing ? `<span class="bt-note ok">● ${existing} موثّق</span>` : '<span class="bt-note warn">● لا شواهد بعد</span>';
  const pendingNote = pend ? `<span class="bt-note">${pend} قيد التجهيز</span>` : '';
  const pickedNote = picked.length ? `<span class="bt-note sel">اخترت ${picked.length} من ${cap}</span>` : '';
  const summary = (!open && picked.length)
    ? `<div class="bt-sel-sum">${picked.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>` : '';
  const bodyHtml = open ? batchOpenBodyHtml(i) : '';
  return `<div class="bt-el ${existing ? 'has' : 'lack'}${open ? ' open' : ''}" id="btEl-${i}">
    <button type="button" class="bt-el-h" onclick="batchToggleOpen(${i})" aria-expanded="${open}">
      <span class="bt-el-t">${escapeHtml(el.label)}<small>${existingNote}${pendingNote}${pickedNote}</small></span>
      <span class="bt-meter-w"><span class="bt-meter" aria-hidden="true">${meter}</span><span class="bt-count${full ? ' full' : (used ? ' on' : '')}">${used}/${BATCH_MAX_PER_ELEMENT}${full ? ' ✓' : ''}</span></span>
      <span class="bt-chev" aria-hidden="true">${open ? '⌃' : '⌄'}</span>
    </button>
    ${summary}${bodyHtml}
  </div>`;
}

function batchOpenBodyHtml(i){
  const el = batchElems[i];
  const names = (SHAHID_TEMPLATES[el.key] || []).length;
  if(!names) return '<div class="bt-chips"><span class="bt-note">لا توجد نماذج جاهزة لهذا العنصر — أضف شواهده من «شاهد جديد».</span></div>';
  const search = names > BATCH_ROWS_FIRST
    ? `<div class="bt-isearch-w"><input type="search" class="bt-isearch" placeholder="ابحث في نماذج هذا العنصر…" aria-label="ابحث في نماذج هذا العنصر" value="${escapeHtml(batchInnerQ)}" oninput="batchInnerSearch(${i}, this.value)"></div>` : '';
  return `${search}<div id="btRows-${i}">${batchRowsHtml(i)}</div>`;
}

/* صفوف النماذج: «اخترتها» أولًا ثم المتاحة (غير المستعملة قبل المستعملة)، وأول BATCH_ROWS_FIRST فقط ما لم يُطلب الباقي أو يوجد بحث */
function batchRowsHtml(i){
  const el = batchElems[i], key = el.key;
  const tpls = SHAHID_TEMPLATES[key] || [];
  const picked = batchPick[key] || [];
  const cap = batchCapacity(key);
  const usedNow = batchUsedTpl[key] || [];
  /* بحث الشاشة يُطبَّق على صفوف العنصر فقط لو طابق بعض نماذجه (وإلا فتح عنصر طابق باسمه يُخفي كل صفوفه) */
  const q = batchNorm(batchInnerQ) || (tpls.some(t => batchNorm(t.name).includes(batchNorm(batchQuery))) ? batchNorm(batchQuery) : '');
  const items = tpls.map((t, ti) => ({ n: t.name, ti }));
  const selItems = items.filter(it => picked.indexOf(it.n) > -1);
  let rest = items.filter(it => picked.indexOf(it.n) < 0 && (!q || batchNorm(it.n).includes(q)));
  rest = rest.filter(it => usedNow.indexOf(it.n) < 0).concat(rest.filter(it => usedNow.indexOf(it.n) > -1));
  const hidden = (!q && !batchShowAll.has(key)) ? Math.max(0, rest.length - BATCH_ROWS_FIRST) : 0;
  if(hidden) rest = rest.slice(0, BATCH_ROWS_FIRST);
  const row = (it) => {
    const sel = picked.indexOf(it.n) > -1;
    const pendingSame = batchDrafts.some(d => d.element_key === key && d.template_name === it.n);
    const off = !sel && (pendingSame || picked.length >= cap);
    const tag = pendingSame ? '<span class="bt-tg">قيد التجهيز</span>'
      : (usedNow.indexOf(it.n) > -1 ? '<span class="bt-tg ok">وُثّق سابقًا</span>' : '');
    return `<button type="button" class="bt-tp${sel ? ' sel' : ''}${off ? ' off' : ''}" role="checkbox" aria-checked="${sel}" ${off ? 'disabled' : ''} onclick="batchToggleTpl(${i}, ${it.ti})"><span class="bt-cb">${sel ? '✓' : ''}</span><span class="bt-tp-n">${escapeHtml(it.n)}</span>${tag}</button>`;
  };
  const limit = cap === 0 ? '<div class="bt-limit">كل شواهد هذا العنصر قيد التجهيز بالفعل</div>'
    : (picked.length >= cap ? `<div class="bt-limit">وصلت للحد الأقصى (${cap}) لهذا العنصر</div>` : '');
  return `${limit}
    ${selItems.length ? `<div class="bt-rsec">✓ اخترتها (${selItems.length})</div>${selItems.map(row).join('')}` : ''}
    <div class="bt-rsec">المتاحة (${rest.length + hidden})</div>
    ${rest.length ? rest.map(row).join('') : '<div class="bt-none">لا نتائج مطابقة</div>'}
    ${hidden ? `<button type="button" class="bt-more" onclick="batchShowMore(${i})">عرض باقي النماذج (${hidden}) ⌄</button>` : ''}`;
}

function batchInnerSearch(i, v){
  batchInnerQ = String(v || '');
  const node = document.getElementById('btRows-' + i);
  if(node) node.innerHTML = batchRowsHtml(i);
}

function batchShowMore(i){
  batchShowAll.add(batchElems[i].key);
  batchRedrawEl(i);
}

function batchRedrawEl(i){
  const node = document.getElementById('btEl-' + i);
  if(node) node.outerHTML = batchPickCardHtml(i);
  renderBatchBar();
}

/* شريط الإجراء السفلي: ثلاث حالات (لا شيء / في الطريق / بلغ الهدف) وحلقة الهدف بالأعلى */
function renderBatchBar(){
  const total = batchPickedTotal();
  const covered = Object.keys(batchPick).filter(k => batchPick[k].length).length;
  const target = batchTarget;
  const pct = Math.min(100, Math.round(total * 100 / (target || 1)));
  const ring = document.getElementById('btRing');
  if(ring) ring.style.background = `conic-gradient(var(--gold) 0 ${pct}%, #E8E3D4 0)`;
  const ringNum = document.getElementById('btRingNum');
  if(ringNum) ringNum.textContent = `${total}/${target}`;
  const fb = document.getElementById('btFilters');
  if(fb) fb.innerHTML = batchFiltersHtml();
  const bar = document.getElementById('btBar');
  if(bar){
    const reached = total >= target;
    bar.innerHTML = total === 0
      ? `<div class="bt-bar-in"><span class="bt-bar-t bt-bar-empty">اختر شاهدًا واحدًا على الأقل، أو اضغط «اقترح لي»</span>
          <button type="button" class="btn btn-primary bt-next" disabled>التالي ←</button></div>`
      : `<div class="bt-bar-in${reached ? ' done' : ''}">
          <button type="button" class="bt-bar-sum" onclick="batchOpenReview()" aria-label="مراجعة اختياراتك">
            <b>${reached ? `✓ اكتمل هدفك: ${total} شاهدًا` : `${total} من ${target}`}</b>
            <small>${covered} ${covered === 1 ? 'عنصر' : 'عناصر'} · مراجعة اختياراتك ⌃</small>
            <span class="bt-bar-prog"><i style="width:${pct}%"></i></span>
          </button>
          <button type="button" class="btn btn-primary bt-next" onclick="showBatchSetup()">التالي ←</button>
        </div>`;
  }
  if(batchSheetOpen) renderBatchSheet();
}

/* ورقة المراجعة: الاختيارات مجمّعة حسب العنصر، × لإزالة أي منها */
function batchOpenReview(){
  if(!batchPickedTotal()) return;
  batchSheetOpen = true;
  renderBatchSheet();
}
function batchCloseReview(){
  batchSheetOpen = false;
  renderBatchSheet();
}
function batchReviewNext(){
  batchCloseReview();
  showBatchSetup();
}
function renderBatchSheet(){
  const box = document.getElementById('btSheet');
  if(!box) return;
  const total = batchPickedTotal();
  if(!batchSheetOpen || !total || batchStep !== 'pick'){
    batchSheetOpen = false;
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  const target = batchTarget;
  const pct = Math.min(100, Math.round(total * 100 / (target || 1)));
  const groups = batchElems.map((el, i) => ({ el, i, list: batchPick[el.key] || [] })).filter(g => g.list.length);
  const groupsHtml = groups.map(g => {
    const names = (SHAHID_TEMPLATES[g.el.key] || []).map(t => t.name);
    return `<div class="bt-sg"><div class="bt-sg-h">${escapeHtml(g.el.label)}<span>${g.list.length} ${g.list.length === 1 ? 'شاهد' : 'شواهد'}</span></div>
      ${g.list.map(n => `<div class="bt-sr"><span>${escapeHtml(n)}</span><button type="button" class="bt-sx" aria-label="إزالة «${escapeHtml(n)}»" onclick="batchToggleTpl(${g.i}, ${names.indexOf(n)})">×</button></div>`).join('')}
    </div>`;
  }).join('');
  box.style.display = 'block';
  box.innerHTML = `<div class="bt-sheet-dim" onclick="batchCloseReview()"></div>
    <div class="bt-sheet" role="dialog" aria-modal="true" aria-label="مراجعة اختياراتك">
      <div class="bt-grip"></div>
      <div class="bt-sheet-top"><b>مراجعة اختياراتك</b><span class="bt-sheet-n">${total} من ${target}</span></div>
      <div class="bt-prog-bar"><i style="width:${pct}%"></i></div>
      ${total < target ? `<div class="bt-sheet-hint">ينقصك ${target - total} للوصول لهدفك — <button type="button" class="bt-linkbtn" onclick="batchAutoPick()">أضِفها تلقائيًا ✨</button></div>` : ''}
      <div class="bt-sheet-body">${groupsHtml}</div>
      <div class="bt-sheet-act">
        <button type="button" class="btn btn-outline" onclick="batchCloseReview()">→ رجوع للتعديل</button>
        <button type="button" class="btn btn-primary" onclick="batchReviewNext()">متابعة لبياناتك ←</button>
      </div>
    </div>`;
}

function batchToggleOpen(i){
  const key = batchElems[i].key;
  if(batchOpenEl.has(key)){
    batchOpenEl.delete(key);
    batchRedrawEl(i);
    return;
  }
  /* عنصر واحد مفتوح في كل مرة — وإلا تعود القائمة جدارًا طويلًا */
  const others = Array.from(batchOpenEl);
  batchOpenEl = new Set([key]);
  batchInnerQ = '';
  others.forEach(k => {
    const j = batchElems.findIndex(e => e.key === k);
    if(j > -1 && j !== i){
      const node = document.getElementById('btEl-' + j);
      if(node) node.outerHTML = batchPickCardHtml(j);
    }
  });
  batchRedrawEl(i);
  const me = document.getElementById('btEl-' + i);
  if(me && typeof me.scrollIntoView === 'function') me.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function batchToggleTpl(i, t){
  const key = batchElems[i].key;
  const name = ((SHAHID_TEMPLATES[key] || [])[t] || {}).name;
  if(!name) return;
  const list = batchPick[key] || (batchPick[key] = []);
  delete batchAutoNames[key + '||' + name]; /* لمسة يدوية = يصير اختيارًا يدويًا يبقى عند إعادة الاقتراح */
  const idx = list.indexOf(name);
  if(idx > -1) list.splice(idx, 1);
  else if(list.length < batchCapacity(key)) list.push(name);
  else showToast(`الحد الأقصى ${BATCH_MAX_PER_ELEMENT} شواهد للعنصر`, 'error');
  if(!list.length) delete batchPick[key];
  batchRedrawEl(i);
}

function batchAutoLabel(){
  return batchAutoDone ? '🎲 غيّر الاقتراح' : (batchCountExisting ? '✨ اقترح لي ما ينقصني' : '✨ اقترح لي توزيعًا عادلًا');
}

/* تغيير العمق أو مفتاح الموثّق يعيد رسم الشاشة كلها: الأزرار والملخّص ونص الزر والهدف بالشريط */
function batchSetDepth(n){
  batchDepth = n;
  batchSyncTarget();
  renderBatchPick();
}
function batchToggleExisting(){
  batchCountExisting = !batchCountExisting;
  batchSyncTarget();
  renderBatchPick();
}

function batchAutoPick(){
  const elements = batchElems.map(el => {
    const all = (SHAHID_TEMPLATES[el.key] || []).map(t => t.name);
    const usedNow = batchUsedTpl[el.key] || [];
    const notPending = all.filter(n => !batchDrafts.some(d => d.element_key === el.key && d.template_name === n));
    return {
      key: el.key,
      names: notPending.filter(n => usedNow.indexOf(n) < 0),
      used: notPending.filter(n => usedNow.indexOf(n) > -1)
    };
  }).filter(e => e.names.length || e.used.length);
  const capacity = {};
  elements.forEach(e => { capacity[e.key] = batchCapacity(e.key); });
  /* ما اختاره المعلم بنفسه يبقى، وما جاء من اقتراح سابق يُستبدل */
  const keep = {};
  Object.keys(batchPick).forEach(k => {
    const manual = batchPick[k].filter(n => !batchAutoNames[k + '||' + n]);
    if(manual.length) keep[k] = manual;
  });
  const keptCount = Object.keys(keep).reduce((n, k) => n + keep[k].length, 0);
  const goal = batchGoals(batchElems.map(e => e.key), batchDepth, batchCountExisting, batchGoalInfo()).goals;
  const picked = batchAutoDistribute(elements, batchTarget, capacity, { keep, goal });
  batchPick = {};
  batchAutoNames = {};
  Object.keys(picked).forEach(k => {
    if(!picked[k].length) return;
    batchPick[k] = picked[k];
    picked[k].forEach(n => { if(!(keep[k] || []).includes(n)) batchAutoNames[k + '||' + n] = true; });
  });
  const wasRoll = batchAutoDone;
  batchAutoDone = true;
  renderBatchPick();
  showToast(keptCount ? 'اقتراح جديد — احتفظت بما اخترته يدويًا' : (wasRoll ? 'اقتراح جديد' : 'اقتراح جاهز — عدّله كما تشاء'), 'ok');
}

/* ---------- 2) البيانات المشتركة ---------- */
function showBatchSetup(){
  if(!batchPickedTotal()) return;
  batchStep = 'setup';
  batchSheetOpen = false;
  renderBatchSheet();
  const meta = (currentUser && currentUser.user_metadata) || {};
  const today = localIsoDate();
  const total = batchPickedTotal();
  batchPeriod = 'custom';
  batchFrom = addDaysIso(today, -56);
  batchTo = batchOne = today;
  batchPeriodTouched = false;
  batchPreviewOpen = false;
  batchPreviewSem = null;
  batchPlanned = null;
  batchClasses = null;
  batchTimetable = [];
  batchClassSel = new Set();
  batchClassMode = 'timetable';
  batchMoveFrom = null;
  batchTip = '';
  batchApplyDefaultPeriod();
  document.getElementById('batchBody').innerHTML = `
    ${batchHeader(2, 'بياناتك تُعبّأ مرة واحدة', `تُطبَّق على الشواهد الـ${total} كلها`)}
    <div class="bt-form">
      <div class="bt-grid2">
        <label>المعلم<input type="text" id="btTeacher" maxlength="150" class="goal-input" value="${escapeHtml(meta.full_name || '')}"></label>
        <label>المدرسة<input type="text" id="btSchool" maxlength="150" class="goal-input" value="${escapeHtml(getProfileSchool())}"></label>
        <label>المادة<input type="text" id="btSubject" maxlength="150" class="goal-input" value="${escapeHtml(getProfileSubject())}"></label>
      </div>
      <div id="btClassBox" class="bt-classbox"></div>
      <div class="bt-sub">متى نفّذت هذه الشواهد؟</div>
      <div id="btPeriod"></div>
    </div>
    <div class="sh-fab-wrap bt-bar"><div class="bt-bar-in">
      <button type="button" class="btn btn-outline" onclick="renderBatchPick()">→ رجوع</button>
      <button type="button" class="btn btn-primary bt-next" id="btCreateBtn" onclick="batchCreateDrafts(this)">إنشاء البطاقات ✓</button>
    </div></div>`;
  window.scrollTo({ top: 0 });
  renderBatchClasses();
  renderBatchPeriod();
  batchPrepareCalendar();
  batchPrepareClasses();
}

/* تقويم نطاق المعلم الرسمي — null لو لا نطاق محدد أو فشل التحميل (فيعود التوزيع
   لتجنّب الجمعة والسبت فقط بدل أن تفشل الميزة) */
async function batchLoadCalendar(){
  if(typeof calendarRegion === 'undefined' || !calendarRegion || typeof loadCalendarData !== 'function') return null;
  const region = calendarRegion;
  try{
    const data = await loadCalendarData(region);
    return calendarRegion === region ? { weeks: data.weeks, holidays: data.holidays } : null;
  } catch(e){ return null; }
}

/* ============ صفوف الدفعة: التحميل والاختيار ============ */
function batchAcademicYear(){
  const el = document.getElementById('crmYearInput');
  let y = el && el.value;
  if(!y){ try{ y = localStorage.getItem('crm_year_part'); }catch(e){ y = null; } }
  return y || (typeof CALENDAR_ACADEMIC_YEAR !== 'undefined' ? CALENDAR_ACADEMIC_YEAR : '');
}

/* صفوف المعلم وحصصه للعام الحالي — يُرجع { classes, timetable } أو null عند الفشل.
   كل استعلام مقيّد بـ teacher_id للمعلم الحالي (سياسة «المسؤول يرى الكل» لا تُعتمد وحدها) */
async function batchLoadClasses(){
  if(!currentUser) return null;
  const uid = currentUser.id, year = batchAcademicYear();
  try{
    const [g, s, t] = await Promise.all([
      sb.from('classroom_grade_levels').select('id, name, created_at').eq('teacher_id', uid).eq('academic_year', year).order('created_at'),
      sb.from('classroom_sections').select('id, name, grade_level_id, created_at').eq('teacher_id', uid).eq('academic_year', year).order('created_at'),
      sb.from('classroom_timetable_slots').select('section_id, weekday, period, semester').eq('teacher_id', uid).eq('academic_year', year)
    ]);
    if(g.error || s.error || t.error) return null;
    const grades = g.data || [];
    const gOrder = id => { const i = grades.findIndex(x => x.id === id); return i < 0 ? 999 : i; };
    const classes = (s.data || []).slice().sort((a, b) => gOrder(a.grade_level_id) - gOrder(b.grade_level_id)).map(sec => {
      const grade = grades.find(x => x.id === sec.grade_level_id);
      return { id: sec.id, gradeName: grade ? grade.name : '', secName: sec.name, label: (grade ? grade.name + ' — ' : '') + 'الشعبة ' + crmDigits(sec.name) };
    });
    const ids = new Set(classes.map(c => c.id));
    return { classes, timetable: (t.data || []).filter(sl => ids.has(sl.section_id)) };
  } catch(e){ return null; }
}

/* بعد رسم شاشة البيانات: يجلب الصفوف ويحدّدها كلها مبدئيًا؛ يتجاهل النتيجة لو انتقل المعلم أو تبدّل الحساب */
async function batchPrepareClasses(){
  const seq = batchViewSeq, uid = currentUser && currentUser.id;
  const res = await batchLoadClasses();
  if(seq !== batchViewSeq || !isBatchViewOpen() || batchStep !== 'setup' || !currentUser || currentUser.id !== uid) return;
  if(!res || !res.classes.length){ batchClasses = null; batchTimetable = []; }
  else {
    batchClasses = res.classes;
    batchTimetable = res.timetable;
    batchClassSel = new Set(res.classes.map(c => c.id));
    batchClassMode = 'timetable';
  }
  batchPlanned = null;
  renderBatchClasses();
  batchRefreshPeriod();
}

/* أيام تدريس صف بنص مختصر، للفصل الحالي إن عُرف وإلا كل الفصول */
function batchTeachDaysText(sectionId){
  const sem = batchCal ? batchCurrentSemester(batchCal.weeks, batchCal.holidays, localIsoDate()) : null;
  let days = batchTeachDays(batchTimetable, sectionId, sem);
  if(!days.length) days = batchTeachDays(batchTimetable, sectionId, null);
  const names = days.map(d => CRM_WEEKDAY_NAMES[d]);
  return names.length > 2 ? names.join('، ') : names.join(' و');
}

function renderBatchClasses(){
  const box = document.getElementById('btClassBox');
  if(!box) return;
  if(!batchClasses){
    const prev = document.getElementById('btClass');
    const val = prev ? prev.value : getProfileClass();
    box.innerHTML = `<label>الصف / الفصل<input type="text" id="btClass" maxlength="100" class="goal-input" value="${escapeHtml(val)}"></label>
      <p class="bt-hint">أضف صفوفك مرة واحدة من «إدارة الصف ← المراحل والشعب» لتظهر هنا كأزرار وتُوزَّع تلقائيًا على شواهدك.</p>`;
    return;
  }
  const codes = batchClassCodes(batchClasses);
  const chips = batchClasses.map((c, i) => {
    const on = batchClassSel.has(c.id);
    const days = batchTeachDaysText(c.id);
    return `<button type="button" class="bt-cchip${on ? ' on' : ' off'}" onclick="batchToggleClass('${escapeHtml(c.id)}')"><i class="bt-cdot" style="background:${BATCH_CLASS_COLORS[i % BATCH_CLASS_COLORS.length]}"></i><span>${escapeHtml(c.label)}<small>${escapeHtml(codes[c.id])}${days ? ' · ' + escapeHtml(days) : ''}</small></span></button>`;
  }).join('');
  const sel = batchSelectedClasses();
  let modeHtml = '';
  if(sel.length > 1){
    const hasTt = batchHasTimetable();
    const m = batchEffectiveClassMode();
    modeHtml = `<div class="bt-sub" style="margin-top:12px">كيف نوزّع الصفوف على الشواهد؟</div>
      <div class="bt-radio">
        <button type="button" class="${m === 'timetable' ? 'on' : ''}"${hasTt ? '' : ' disabled'} onclick="batchSetClassMode('timetable')">حسب جدولي${hasTt ? ' <span class="bt-badge">موصى به</span>' : ''}<small>${hasTt ? 'كل شاهد في يوم تدرّس فيه هذا الصف فعلًا' : 'غير متاح'}</small></button>
        <button type="button" class="${m === 'equal' ? 'on' : ''}" onclick="batchSetClassMode('equal')">بالتساوي<small>بالتناوب بين الصفوف</small></button>
      </div>
      <p class="bt-hint${hasTt ? ' ok' : ''}">${hasTt ? '✓ جدولك الأسبوعي مسجَّل، فتتّسق التواريخ مع الصفوف.' : 'لم تسجّل جدولك الأسبوعي في «إدارة الصف»، فنوزّع الصفوف بالتساوي.'}</p>`;
  }
  box.innerHTML = `<div class="bt-sub">الصفوف التي نفّذت فيها هذه الشواهد</div><div class="bt-cchips">${chips}</div>${sel.length ? '' : '<p class="bt-warn2">اختر صفًا واحدًا على الأقل.</p>'}${modeHtml}`;
}

function batchToggleClass(id){
  if(batchClassSel.has(id)) batchClassSel.delete(id); else batchClassSel.add(id);
  batchPlanned = null;
  renderBatchClasses();
  batchRefreshPeriod();
}

function batchSetClassMode(mode){
  batchClassMode = mode === 'equal' ? 'equal' : 'timetable';
  batchPlanned = null;
  renderBatchClasses();
  batchRefreshPeriod();
}

/* لو التقويم متاح ولم يختر المعلم فترة بنفسه: الفصل الدراسي الحالي من أوله حتى اليوم */
function batchApplyDefaultPeriod(){
  if(!batchCal || batchPeriodTouched) return;
  const today = localIsoDate();
  const sem = batchCurrentSemester(batchCal.weeks, batchCal.holidays, today);
  if(!sem) return;
  const key = sem === 2 ? 'sem2' : 'sem1';
  const r = batchPeriodRange(batchCal.weeks, batchCal.holidays, key);
  if(!r.available) return;
  batchPeriod = key; batchFrom = r.from; batchTo = r.to;
}

/* بعد رسم شاشة البيانات: يحمّل التقويم ثم يعيد رسم قسم الفترة. يتجاهل النتيجة لو
   انتقل المعلم لخطوة أخرى أو تبدّل الحساب */
async function batchPrepareCalendar(){
  const seq = batchViewSeq, uid = currentUser && currentUser.id;
  const cal = await batchLoadCalendar();
  if(seq !== batchViewSeq || !isBatchViewOpen() || batchStep !== 'setup' || !currentUser || currentUser.id !== uid) return;
  batchCal = cal;
  batchApplyDefaultPeriod();
  renderBatchPeriod();
}

/* حالة الفترة الحالية: مصدر واحد للملخص والمعاينة والإنشاء.
   spread: { ok, from, to, days, future } | single: { ok, one, offReason, future } | ok=false + msg.
   مفتاح «لا تضع تواريخ بعد اليوم» يقصّ الفترات الجاهزة عند اليوم ويرفض ما بعده؛ وإيقافه
   (ويلزمه التقويم) يرفع الحد لآخر يوم دراسة بالعام */
function batchPeriodInfo(){
  const today = localIsoDate();
  const capped = batchCapToday || !batchCal;
  const limit = capped ? today : (batchYearEnd() || today);
  const limitMsg = capped ? 'اليوم' : 'آخر يوم دراسة بالتقويم';
  if(batchPeriod === 'single'){
    if(!batchOne || batchOne > limit) return { mode: 'single', ok: false, msg: 'اختر تاريخًا لا يتجاوز ' + limitMsg };
    let offReason = '';
    const wd = weekdayOfIso(batchOne);
    if(wd === 5 || wd === 6) offReason = 'عطلة نهاية الأسبوع';
    else if(batchCal){
      const st = batchDayStatus(batchWeekIndex(batchCal.weeks), batchCal.holidays, batchOne);
      if(!st.ok) offReason = st.reason;
    }
    return { mode: 'single', ok: true, one: batchOne, offReason, future: batchOne > today };
  }
  const from = batchFrom;
  let to = batchTo;
  if(!from || !to) return { mode: 'spread', ok: false, msg: 'اختر بداية الفترة ونهايتها' };
  if(batchPeriod !== 'custom'){
    if(capped && from > today) return { mode: 'spread', ok: false, msg: `هذه الفترة لم تبدأ بعد (تبدأ ${batchDateLabel(from)}). أوقف «لا تضع تواريخ بعد اليوم» إن أردت توزيع شواهدك عليها.` };
    if(capped && to > today) to = today;
  }
  if(from > to || to > limit) return { mode: 'spread', ok: false, msg: 'تحقق من الفترة: «من» قبل «إلى» ولا تتجاوز ' + limitMsg };
  const days = batchCal ? batchCalendarDays(batchCal.weeks, batchCal.holidays, from, to) : batchSchoolDays(from, to);
  if(!days.length) return { mode: 'spread', ok: false, msg: 'لا توجد أيام دراسة ضمن هذه الفترة حسب التقويم الرسمي — وسّع الفترة' };
  return { mode: 'spread', ok: true, from, to, days, future: to > today };
}

/* التوزيع المعروض بالمعاينة: يُعاد استخدامه عند الإنشاء كي يطابق ما رآه المعلم */
/* الصفوف المحدَّدة (بترتيبها بإدارة الصف) */
function batchSelectedClasses(){
  return batchClasses ? batchClasses.filter(c => batchClassSel.has(c.id)) : [];
}

/* هل لأحد الصفوف المحدَّدة جدول أسبوعي؟ (شرط وضع «حسب جدولي») */
function batchHasTimetable(){
  return batchSelectedClasses().some(c => batchTimetable.some(sl => sl.section_id === c.id));
}

function batchEffectiveClassMode(){
  return batchClassMode === 'timetable' && batchHasTimetable() ? 'timetable' : 'equal';
}

/* بصمة اختيار الصفوف بالخطة — تغيّرها يُبطل التوزيع المعروض */
function batchClassSig(){
  return batchEffectiveClassMode() + ':' + batchSelectedClasses().map(c => c.id).join(',');
}

function batchClassesForDates(dates){
  const sel = batchSelectedClasses();
  if(!sel.length) return null;
  return batchAssignClasses(dates, sel, {
    mode: batchEffectiveClassMode(),
    timetable: batchTimetable,
    semesterOf: iso => batchSemesterOf(batchCal && batchCal.weeks, iso)
  });
}

/* تواريخ الخطة وصفوفها معًا (الصفوف null لو لا صفوف محدَّدة) */
function batchPlanDatesAndClasses(count, info){
  const sel = batchSelectedClasses();
  if(sel.length > 1){
    return batchSpreadWithClasses(count, info.days, sel, {
      mode: batchEffectiveClassMode(),
      timetable: batchTimetable,
      semesterOf: iso => batchSemesterOf(batchCal && batchCal.weeks, iso)
    });
  }
  const dates = batchSpreadDates(count, info.from, info.to, { days: info.days });
  return { dates, classes: batchClassesForDates(dates) };
}

function batchEnsurePlan(info, count, reshuffle){
  const p = batchPlanned, sig = batchClassSig();
  if(!reshuffle && p && p.from === info.from && p.to === info.to && p.count === count && p.ndays === info.days.length && p.sig === sig) return p;
  const r = batchPlanDatesAndClasses(count, info);
  batchPlanned = { from: info.from, to: info.to, count, ndays: info.days.length, dates: r.dates, classes: r.classes, sig };
  return batchPlanned;
}

function renderBatchPeriod(){
  const box = document.getElementById('btPeriod');
  if(!box) return;
  const today = localIsoDate();
  const chip = (key, label, sub, disabled) =>
    `<button type="button" class="bt-chip${batchPeriod === key ? ' on' : ''}${disabled ? ' dis' : ''}" ${disabled ? 'disabled' : `onclick="batchSetPeriod('${key}')"`}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  let chips = '';
  if(batchCal){
    const rng = k => batchPeriodRange(batchCal.weeks, batchCal.holidays, k);
    const one = (k, label) => { const r = rng(k); return chip(k, label, r.available && r.startsOn > today ? 'يبدأ ' + batchDateLabel(r.startsOn) : '', !r.available); };
    chips = one('sem1', 'الفصل الأول') + one('sem2', 'الفصل الثاني') + one('year', 'العام كاملًا');
  }
  chips += chip('custom', 'فترة أخرى') + chip('single', 'يوم واحد');
  let fields = '';
  const maxDate = (batchCapToday || !batchCal) ? today : batchDateLimit();
  if(batchPeriod === 'custom'){
    fields = `<div class="bt-grid2">
      <label>من تاريخ<input type="date" id="btFrom" class="goal-input" value="${escapeHtml(batchFrom)}" max="${maxDate}" oninput="batchOnDates()"></label>
      <label>إلى تاريخ<input type="date" id="btTo" class="goal-input" value="${escapeHtml(batchTo)}" max="${maxDate}" oninput="batchOnDates()"></label>
    </div>`;
  } else if(batchPeriod === 'single'){
    fields = `<label>التاريخ<input type="date" id="btOne" class="goal-input" value="${escapeHtml(batchOne)}" max="${maxDate}" oninput="batchOnDates()"></label>`;
  }
  const sw = batchCal ? `<label class="bt-switch"><input type="checkbox" id="btCap" ${batchCapToday ? 'checked' : ''} onchange="batchToggleCap(this.checked)"><span><b>لا تضع تواريخ بعد اليوم</b><small>أوقفه لتوثّق بتواريخ قادمة حتى آخر يوم دراسة بالعام</small></span></label>` : '';
  box.innerHTML = `<div class="bt-chips">${chips}</div>${fields}${sw}<div id="btSum"></div><div id="btPreview"></div><p class="bt-hint" id="btHint"></p>`;
  batchRefreshPeriod();
}

/* الملخص والمعاينة والتلميح — دون إعادة رسم الحقول (فلا يضيع التركيز أثناء الكتابة) */
function batchRefreshPeriod(){
  const sum = document.getElementById('btSum'), prev = document.getElementById('btPreview'), hint = document.getElementById('btHint');
  if(!sum || !prev || !hint) return;
  const total = batchPickedTotal();
  const info = batchPeriodInfo();
  if(!info.ok){
    sum.innerHTML = `<div class="bt-sum bad">${escapeHtml(info.msg)}</div>`;
    prev.innerHTML = '';
  } else if(info.mode === 'single'){
    sum.innerHTML = `<div class="bt-sum">✓ كل الشواهد (<b>${batchAr(total)}</b>) بتاريخ <b>${batchDateLabel(info.one)}</b></div>`
      + (info.offReason ? `<p class="bt-warn2">⚠ هذا اليوم ليس يوم دراسة (${escapeHtml(info.offReason)}) — الأفضل اختيار يوم دراسة فعلي.</p>` : '')
      + (info.future ? '<p class="bt-warn2">⚠ هذا التاريخ لم يحن بعد — تأكد أنه مقصود.</p>' : '');
    prev.innerHTML = '';
    sum.innerHTML += batchClassCountsHtml(batchClassesForDates(Array(total).fill(info.one)));
  } else {
    sum.innerHTML = `<div class="bt-sum">✓ <b>${batchCountLabel(total)}</b> ستُوزَّع على <b>${batchAr(info.days.length)}</b> يوم دراسة<small>من ${batchDateLabel(info.from)} إلى ${batchDateLabel(info.to)}</small>${total > info.days.length ? '<small>الأيام أقل من الشواهد، فسيتكرر بعضها.</small>' : ''}</div>`;
    const plan = (batchPreviewOpen || info.future || batchSelectedClasses().length > 1) ? batchEnsurePlan(info, total, false) : null;
    if(batchMoveFrom && !(plan && plan.dates.includes(batchMoveFrom))){ batchMoveFrom = null; }
    if(plan && plan.classes) sum.innerHTML += batchClassCountsHtml(plan.classes);
    const futureN = plan ? plan.dates.filter(d => d > localIsoDate()).length : 0;
    if(futureN) sum.innerHTML += `<p class="bt-warn2">⚠ ${batchAr(futureN)} من ${batchCountLabel(total)} بتاريخ لم يحن بعد — تأكد أنه مقصود.</p>`;
    if(!batchPreviewOpen){
      prev.innerHTML = '<button type="button" class="btn btn-outline bt-prevbtn" onclick="batchTogglePreview(true)">👁 شاهد كيف ستُوزَّع</button>';
    } else {
      const sections = batchPreviewSections(info.from, info.to, batchCal && batchCal.weeks, batchCal && batchCal.holidays, plan.dates, !!batchCal, localIsoDate(), plan.classes);
      if(!sections.some(x => x.semester === batchPreviewSem)){
        const nowSem = batchCal ? batchCurrentSemester(batchCal.weeks, batchCal.holidays, localIsoDate()) : null;
        batchPreviewSem = (sections.find(x => x.semester === nowSem) || sections[0]).semester;
      }
      const sec = sections.find(x => x.semester === batchPreviewSem);
      const cellsOf = x => x.weeks.reduce((a, w) => a.concat(w.cells), []);
      const picksOf = x => cellsOf(x).reduce((n, c) => n + (c.status === 'pick' ? c.count : 0), 0);
      const daysOf = x => cellsOf(x).filter(c => c.status === 'pick' || c.status === 'study').length;
      const semName = x => x.semester === 1 ? 'الفصل الأول' : (x.semester === 2 ? 'الفصل الثاني' : 'الفترة');
      const tabs = sections.length > 1
        ? `<div class="bt-chips bt-semtabs">${sections.map(x => `<button type="button" class="bt-chip${x.semester === batchPreviewSem ? ' on' : ''}" onclick="batchSetPreviewSem(${x.semester})">${semName(x)}<small>${batchCountLabel(picksOf(x))}</small></button>`).join('')}</div>`
        : '';
      const title = `<div class="bt-mtitle"><div><b>${semName(sec)}</b><small>${batchCountLabel(picksOf(sec))} · ${batchAr(daysOf(sec))} يوم دراسة</small></div></div>`;
      const head = '<div class="bt-wrow bt-whd"><span class="bt-wk"></span>' + CRM_WEEKDAY_NAMES.slice(0, 5).map(n => `<span class="bt-cell0">${n}</span>`).join('') + '</div>';
      const body = sec.weeks.map(w => `<div class="bt-wrow"><span class="bt-wk">${w.n ? batchAr(w.n) : ''}</span>${w.cells.map(c => {
        if(c.status === 'out') return '<span class="bt-cell out"></span>';
        const reason = c.status === 'off' ? (c.reason.length > 12 ? c.reason.replace(/^إجازة\s+/, '') : c.reason) : '';
        const cl = c.status === 'pick' && c.classes ? batchClassInfo(c.classes[0]) : null;
        const sub = c.status === 'off' ? escapeHtml(reason) : (c.month || (c.status === 'pick' ? (c.count > 1 ? batchAr(c.count) + ' شواهد' : (cl ? escapeHtml(cl.code) : 'شاهد')) : ''));
        const sel = batchMoveFrom === c.iso ? ' sel' : '';
        const dest = batchMoveFrom && batchMoveFrom !== c.iso && (c.status === 'study' || c.status === 'pick') ? ' dest' : '';
        return `<button type="button" class="bt-cell ${c.status}${c.future ? ' fut' : ''}${sel}${dest}"${cl ? ` style="background:${cl.color};border-color:${cl.color}"` : ''} onclick="batchOnDayTap('${c.iso}')">${batchAr(+c.iso.slice(8))}${sub ? `<small>${sub}</small>` : ''}</button>`;
      }).join('')}</div>`).join('');
      prev.innerHTML = `<div class="bt-prev"><div class="bt-sub" style="margin-top:0">توزيع ${batchCountLabel(total)} على الفترة</div>
        ${tabs}${title}
        <p class="bt-hint bt-movehint">${batchMoveFrom ? 'اضغط على يوم دراسي لنقل الشاهد إليه، أو اضغط اليوم نفسه للإلغاء.' : 'لنقل شاهد: اضغط على يوم فيه شاهد، ثم على يوم دراسي آخر.'}</p>
        <div class="bt-tip" id="btTip"${batchTip ? '' : ' style="display:none"'}>${escapeHtml(batchTip)}</div>
        <div>${head}${body}</div>
        <div class="bt-leg">${batchSelectedClasses().length > 1 ? batchSelectedClasses().map(c => { const ci = batchClassInfo(c.label); return `<span><i style="background:${ci.color};border-color:${ci.color}"></i>${escapeHtml(ci.code)} ${escapeHtml(c.label)}</span>`; }).join('') : '<span><i class="pick"></i>شاهد</span>'}<span><i></i>يوم دراسة بلا شاهد</span><span><i class="off"></i>إجازة / اختبارات</span>${info.future ? '<span><i class="fut"></i>بعد اليوم</span>' : ''}</div>
        <div class="bt-prevbar"><button type="button" class="btn btn-outline" onclick="batchReshuffle()">🔀 خلط التواريخ</button><button type="button" class="btn btn-primary" onclick="batchTogglePreview(false)">تمام ✓</button></div></div>`;
    }
  }
  hint.textContent = batchCal
    ? 'نختار أيام دراسة فعلية فقط: دون الجمعة والسبت والإجازات الرسمية وأيام الاختبارات. لا نتجاوز اليوم، وتعدّل أي تاريخ لاحقًا من بطاقته.'
    : (typeof calendarRegion !== 'undefined' && calendarRegion
      ? 'تعذّر تحميل التقويم الدراسي، فنتجنّب الجمعة والسبت فقط. لا نتجاوز اليوم، وتعدّل أي تاريخ لاحقًا من بطاقته.'
      : 'حدّد نطاق التقويم الدراسي (من شاشة التقويم) كي نتجنّب الإجازات الرسمية أيضًا؛ نتجنّب الآن الجمعة والسبت فقط. لا نتجاوز اليوم، وتعدّل أي تاريخ لاحقًا من بطاقته.');
}

function batchSetPeriod(key){
  batchPeriodTouched = true;
  const today = localIsoDate();
  if(key === 'sem1' || key === 'sem2' || key === 'year'){
    const r = batchCal ? batchPeriodRange(batchCal.weeks, batchCal.holidays, key) : null;
    if(!r || !r.available) return;
    batchFrom = r.from; batchTo = r.to;
  } else if(batchCapToday || !batchCal){
    /* فترة يدوية/يوم واحد والمفتاح مفعّل: لا نُبقي تاريخًا قادمًا من فترة جاهزة سابقة */
    if(batchFrom > today) batchFrom = addDaysIso(today, -56);
    if(batchTo > today) batchTo = today;
    if(batchOne > today) batchOne = today;
  }
  batchPeriod = key;
  batchPlanned = null;
  renderBatchPeriod();
}

/* مفتاح «لا تضع تواريخ بعد اليوم» */
function batchToggleCap(on){
  batchCapToday = !!on;
  const today = localIsoDate();
  if(batchCapToday && batchPeriod === 'custom'){
    if(batchFrom > today) batchFrom = addDaysIso(today, -56);
    if(batchTo > today) batchTo = today;
  }
  if(batchCapToday && batchOne > today) batchOne = today;
  batchPlanned = null;
  renderBatchPeriod();
}

function batchOnDates(){
  batchPeriodTouched = true;
  const f = document.getElementById('btFrom'), t = document.getElementById('btTo'), o = document.getElementById('btOne');
  if(f) batchFrom = f.value;
  if(t) batchTo = t.value;
  if(o) batchOne = o.value;
  batchPlanned = null;
  batchRefreshPeriod();
}

/* التبديل بين فصلي المعاينة */
function batchSetPreviewSem(sem){
  batchPreviewSem = sem;
  batchRefreshPeriod();
}

function batchTogglePreview(open){
  batchPreviewOpen = !!open;
  batchMoveFrom = null;
  batchTip = '';
  batchRefreshPeriod();
}

function batchReshuffle(){
  const info = batchPeriodInfo();
  if(!info.ok || info.mode !== 'spread') return;
  batchMoveFrom = null;
  batchTip = '';
  batchEnsurePlan(info, batchPickedTotal(), true);
  batchRefreshPeriod();
}

/* شرح يوم بالمعاينة: يوم دراسة (بشاهد أو بلا) أو إجازة باسمها */
/* لون ورمز صف باسمه (من الصفوف المحمّلة)؛ null لو ليس منها */
function batchClassInfo(label){
  if(!batchClasses) return null;
  const i = batchClasses.findIndex(c => c.label === label);
  if(i < 0) return null;
  return { id: batchClasses[i].id, color: BATCH_CLASS_COLORS[i % BATCH_CLASS_COLORS.length], code: batchClassCodes(batchClasses)[batchClasses[i].id] };
}

/* سطر أعداد الشواهد لكل صف تحت الملخص (لو أكثر من صف) */
function batchClassCountsHtml(labels){
  const sel = batchSelectedClasses();
  if(!labels || sel.length < 2) return '';
  const counts = {};
  labels.forEach(l => { counts[l] = (counts[l] || 0) + 1; });
  return '<div class="bt-ccount">' + sel.map(c => { const ci = batchClassInfo(c.label); return `<span><i style="background:${ci.color}"></i>${escapeHtml(ci.code)} : ${batchAr(counts[c.label] || 0)}</span>`; }).join('') + '</div>';
}

/* نص شرح يوم بالمعاينة */
function batchDayTipText(iso){
  const label = `${CRM_WEEKDAY_NAMES[weekdayOfIso(iso)]} ${batchDateLabel(iso)}`;
  let text;
  const st = batchCal ? batchDayStatus(batchWeekIndex(batchCal.weeks), batchCal.holidays, iso) : { ok: true };
  if(!st.ok) text = `${label} — ليس يوم دراسة: ${st.reason}، لن يُوضع فيه شاهد.`;
  else {
    const n = ((batchPlanned && batchPlanned.dates) || []).filter(d => d === iso).length;
    text = n ? `${label} — سيُوثَّق فيه ${n > 1 ? batchAr(n) + ' شواهد' : 'شاهد'}.` : `${label} — يوم دراسة بلا شاهد.`;
    const pl = batchPlanned;
    if(n && pl && pl.classes){
      const labs = [];
      pl.dates.forEach((d, i) => { if(d === iso && pl.classes[i] && labs.indexOf(pl.classes[i]) === -1) labs.push(pl.classes[i]); });
      const sem = batchSemesterOf(batchCal && batchCal.weeks, iso);
      const parts = labs.map(lab => {
        const ci = batchClassInfo(lab);
        const per = ci ? batchTeachPeriods(batchTimetable, ci.id, sem, weekdayOfIso(iso)) : [];
        return lab + (per.length ? ` (الحصة ${per.map(batchAr).join(' و')})` : '');
      });
      if(parts.length) text += ' الصف: ' + parts.join('، ') + '.';
    }
  }
  return text;
}

function batchShowTip(text){
  batchTip = text || '';
  const tip = document.getElementById('btTip');
  if(!tip) return;
  tip.textContent = batchTip;
  tip.style.display = batchTip ? '' : 'none';
}

function batchShowDayTip(iso){
  batchShowTip(batchDayTipText(iso));
}

/* ضغط يوم بالمعاينة: يحدّد يومًا فيه شاهد ثم يُنقل الشاهد إلى يوم دراسي ثانٍ؛ وإلا يشرح اليوم فقط */
function batchOnDayTap(iso){
  const info = batchPeriodInfo();
  const plan = batchPlanned;
  if(!info.ok || info.mode !== 'spread' || !plan){ batchShowDayTip(iso); return; }
  const hasPick = plan.dates.includes(iso);
  if(!batchMoveFrom){
    if(!hasPick){ batchShowDayTip(iso); return; }
    batchMoveFrom = iso;
    batchTip = batchDayTipText(iso) + ' اختر يومًا دراسيًا لنقله إليه.';
    batchRefreshPeriod();
    return;
  }
  if(iso === batchMoveFrom){
    batchMoveFrom = null;
    batchTip = '';
    batchRefreshPeriod();
    return;
  }
  const from = batchMoveFrom;
  const r = batchMovePlanned(plan, from, iso, info.days);
  if(!r.ok){
    const st = batchCal ? batchDayStatus(batchWeekIndex(batchCal.weeks), batchCal.holidays, iso) : { ok: true };
    batchShowTip(`${CRM_WEEKDAY_NAMES[weekdayOfIso(iso)]} ${batchDateLabel(iso)} — ${st.ok ? 'خارج الفترة المختارة' : 'ليس يوم دراسة (' + st.reason + ')'}، لا يمكن النقل إليه.`);
    return;
  }
  batchMoveFrom = null;
  let msg = `نُقل الشاهد إلى ${CRM_WEEKDAY_NAMES[weekdayOfIso(iso)]} ${batchDateLabel(iso)}.`;
  const ci = r.label ? batchClassInfo(r.label) : null;
  if(ci && batchTeachesOn(batchTimetable, ci.id, batchSemesterOf(batchCal && batchCal.weeks, iso), iso) === false){
    msg += ` ⚠ لا تدرّس ${r.label} هذا اليوم — تأكد أنه مقصود.`;
  }
  batchTip = msg;
  batchRefreshPeriod();
}

async function batchCreateDrafts(btn){
  if(!currentUser || btn.disabled) return;
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  let dates, planned = null, classNames = null;
  let calFallback = false;
  /* السعة تُعاد قراءتها من القاعدة أولًا: جهاز/تبويب آخر قد يكون أضاف مسودات */
  beginExportBusy(btn, 'جارٍ الإنشاء...');
  try{
    if(!(await loadBatchDrafts())) throw new Error('تعذّر التحقق من المسودات الحالية');
    const groups = batchElems.filter(el => (batchPick[el.key] || []).length).map(el =>
      batchPick[el.key].slice(0, batchCapacity(el.key)).map(n => ({ element_key: el.key, template_name: n }))
        .filter(it => !batchDrafts.some(d => d.element_key === it.element_key && d.template_name === it.template_name)));
    const items = batchInterleave(groups);
    if(!items.length){ showToast('لا شيء جديد لإنشائه', 'error'); return; }

    if(batchClasses && batchClasses.length && !batchSelectedClasses().length){ showToast('اختر صفًا واحدًا على الأقل', 'error'); return; }
    /* التقويم يُعاد جلبه (مخزَّن غالبًا) كي لا نعتمد على لقطة قديمة، ثم المصدر الواحد للفترة */
    batchCal = await batchLoadCalendar();
    calFallback = !batchCal;
    const info = batchPeriodInfo();
    if(!info.ok){ showToast(info.msg, 'error'); return; }
    if(info.mode === 'single'){
      dates = Array(items.length).fill(info.one);
    } else {
      const p = batchPlanned;
      planned = (p && p.from === info.from && p.to === info.to && p.count === items.length && p.ndays === info.days.length && p.sig === batchClassSig()) ? p : null;
      if(!planned){ const r = batchPlanDatesAndClasses(items.length, info); planned = { dates: r.dates, classes: r.classes }; }
      dates = planned.dates.slice();
    }
    classNames = batchSelectedClasses().length ? ((planned && planned.classes) ? planned.classes.slice() : batchClassesForDates(dates)) : null;
    const rows = buildBatchDraftRows(items, dates, {
      classNames,
      userId: currentUser.id,
      teacher: document.getElementById('btTeacher').value.trim(),
      school: document.getElementById('btSchool').value.trim(),
      subject: document.getElementById('btSubject').value.trim(),
      className: (document.getElementById('btClass') || {}).value ? document.getElementById('btClass').value.trim() : ''
    });
    const { error } = await sb.from('shahid_drafts')
      .upsert(rows, { onConflict: 'user_id,element_key,template_name', ignoreDuplicates: true });
    if(error) throw error;
    batchPick = {};
    batchAutoNames = {};
    if(!(await loadBatchDrafts())) throw new Error('تعذّر تحميل البطاقات');
    if(!isBatchViewOpen()) return;
    showToast(`جُهّزت ${rows.length} بطاقة — أضف الصور الآن` + (calFallback ? ' (وُزّعت دون الجمعة والسبت فقط — التقويم غير متاح)' : ''), 'ok');
    renderBatchBoard();
  } catch(err){
    showToast('تعذّر الإنشاء: ' + (err.message || err), 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* ---------- 3) لوحة الصور ---------- */
function batchElementLabel(key){
  const el = (DB_ELEMENTS || []).find(e => e.key === key);
  return el ? el.label : key;
}
function batchElementOrder(key){
  const i = (DB_ELEMENTS || []).findIndex(e => e.key === key);
  return i < 0 ? 999 : i;
}

function renderBatchBoard(){
  batchStep = 'board';
  const body = document.getElementById('batchBody');
  const done = batchDone.length, pending = batchDrafts.length, total = done + pending;
  const pct = total ? Math.round(done * 100 / total) : 0;
  const sorted = batchDrafts.slice().sort((a, b) =>
    batchElementOrder(a.element_key) - batchElementOrder(b.element_key) ||
    String(a.planned_date || '').localeCompare(String(b.planned_date || '')));
  const cards = sorted.map(batchCardHtml).join('');
  const doneCards = batchDone.length ? `<div class="bt-sub">أُنجزت (${batchDone.length})</div><div class="bt-cards">${batchDone.map(batchDoneHtml).join('')}</div>` : '';
  body.innerHTML = `
    ${batchHeader(3, pending ? 'أضف الصور' : 'اكتملت كل البطاقات', pending ? 'صورة واحدة تكفي لتحويل البطاقة إلى شاهد مكتمل' : 'كل بطاقاتك تحوّلت إلى شواهد')}
    <div class="bt-prog">
      <div class="bt-prog-top"><b>${done} من ${total} مكتمل</b><span>${pct}%</span></div>
      <div class="bt-prog-bar"><i style="width:${pct}%"></i></div>
    </div>
    <p class="bt-warn">نصوص الشواهد مأخوذة من نماذج جاهزة. راجع كل شاهد بعد رفع صورته وعدّل نصه ليعكس عملك الفعلي.</p>
    ${pending ? `<div class="bt-cards">${cards}</div>` : '<div class="empty-state">🎉 أنجزت كل شواهد هذه الدفعة.</div>'}
    ${doneCards}
    <div class="bt-foot">
      <button type="button" class="btn btn-outline" onclick="showBatchPick()">+ أضف شواهد أخرى</button>
      ${pending ? '<button type="button" class="btn btn-danger" onclick="batchDeleteAll(this)">حذف المتبقي</button>' : ''}
    </div>`;
}

/* قائمة الصف بالبطاقة: صفوف المعلم المسجَّلة (مع تعليم ما يدرّسه بيوم البطاقة) + صف آخر بالكتابة.
   لا تظهر لمن لا صفوف مسجَّلة عنده (حقل الصف الواحد بشاشة البيانات يكفيه) */
function batchClassFieldHtml(d, busy){
  if(!batchClasses) return '';
  const id = escapeHtml(d.id);
  if(batchClassFree.has(d.id)){
    return `<label class="bt-date-l">الصف <input type="text" class="bt-date" maxlength="100" value="${escapeHtml(d.class_name || '')}" placeholder="اكتب الصف" ${busy ? 'disabled' : ''} onchange="batchSetClass('${id}', this.value)"></label>`;
  }
  const date = d.planned_date;
  const sem = date ? batchSemesterOf(batchCal && batchCal.weeks, date) : 1;
  const dayName = date ? CRM_WEEKDAY_NAMES[weekdayOfIso(date)] : '';
  const cur = d.class_name || '';
  const known = batchClasses.some(c => c.label === cur);
  const opts = batchClasses.map(c => {
    const t = date ? batchTeachesOn(batchTimetable, c.id, sem, date) : null;
    const suffix = t === true ? ' ✓' : (t === false ? ' — لا تدرّسه ' + dayName : '');
    return `<option value="${escapeHtml(c.label)}"${c.label === cur ? ' selected' : ''}>${escapeHtml(c.label)}${suffix}</option>`;
  }).join('');
  const extra = (!known && cur) ? `<option value="${escapeHtml(cur)}" selected>${escapeHtml(cur)}</option>` : '';
  const blank = !cur ? '<option value="" selected>اختر الصف</option>' : '';
  return `<label class="bt-date-l">الصف <select class="bt-date" ${busy ? 'disabled' : ''} onchange="batchSetClass('${id}', this.value)">${blank}${opts}${extra}<option value="__other__">صف آخر…</option></select></label>`;
}

/* تنبيه أصفر (لا منع) لو الصف المختار لا يدرّسه المعلم بيوم البطاقة حسب جدوله */
function batchClassHintHtml(d){
  if(!batchClasses || !d.planned_date || !d.class_name) return '';
  const c = batchClasses.find(x => x.label === d.class_name);
  if(!c) return '';
  const sem = batchSemesterOf(batchCal && batchCal.weeks, d.planned_date);
  if(batchTeachesOn(batchTimetable, c.id, sem, d.planned_date) !== false) return '';
  return `<div class="bt-chint">⚠ لا تدرّس هذا الصف يوم ${CRM_WEEKDAY_NAMES[weekdayOfIso(d.planned_date)]} — تأكد أنه مقصود.</div>`;
}

function batchCardHtml(d){
  const busy = batchBusyIds.has(d.id);
  const id = escapeHtml(d.id);
  return `<div class="bt-card${busy ? ' busy' : ''}" id="btCard-${id}">
    <div class="bt-card-top">
      <span class="bt-tag">${escapeHtml(batchElementLabel(d.element_key))}</span>
      <button type="button" class="bt-x" aria-label="حذف البطاقة" ${busy ? 'disabled' : ''} onclick="batchDeleteDraft('${id}')">×</button>
    </div>
    <div class="bt-title">${escapeHtml(d.title)}</div>
    <div class="bt-cardrow">
      <label class="bt-date-l">التاريخ <input type="date" class="bt-date" value="${escapeHtml(d.planned_date || '')}" max="${batchDateLimit()}" ${busy ? 'disabled' : ''} onchange="batchSetDate('${id}', this.value)"></label>
      ${batchClassFieldHtml(d, busy)}
    </div>
    ${batchClassHintHtml(d)}
    <div class="bt-drop${busy ? ' busy' : ''}">
      ${busy
        ? '<div class="bt-spin"></div><span>جارٍ الرفع والحفظ...</span>'
        : `<span class="bt-drop-t">أضف صورة الشاهد</span>
           <div class="bt-pbtns">
             <label class="bt-pbtn"><input type="file" accept="image/*" capture="environment" hidden onchange="batchOnPhotos('${id}', this)">📷 كاميرا</label>
             <label class="bt-pbtn"><input type="file" accept="image/*" multiple hidden onchange="batchOnPhotos('${id}', this)">🖼️ الألبوم</label>
           </div>`}
    </div>
  </div>`;
}

function batchDoneHtml(r){
  const thumb = r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="">` : '<span class="bt-ok-i">✓</span>';
  return `<div class="bt-card bt-doneCard">
    <div class="bt-thumb">${thumb}</div>
    <div class="bt-done-t"><span class="bt-tag">${escapeHtml(r.label)}</span><b>${escapeHtml(r.title)}</b><small>✓ ${r.count} ${r.count === 1 ? 'صورة' : 'صور'}</small></div>
    <button type="button" class="btn btn-outline bt-edit" onclick="batchEditDone('${escapeHtml(r.id)}')">مراجعة وتعديل</button>
  </div>`;
}

function batchRedrawCard(id){
  const d = batchDrafts.find(x => x.id === id);
  const node = document.getElementById('btCard-' + id);
  if(d && node) node.outerHTML = batchCardHtml(d);
}

function batchEditDone(id){
  if(!myRecords.some(r => String(r.id) === String(id))) return;
  editRecord(id);
}

async function batchSetClass(id, value){
  const d = batchDrafts.find(x => x.id === id);
  if(!d || !currentUser) return;
  if(value === '__other__'){
    batchClassFree.add(id);
    batchRedrawCard(id);
    return;
  }
  const v = String(value || '').trim().slice(0, 100);
  const before = d.class_name || '';
  d.class_name = v;
  batchClassFree.delete(id);
  batchRedrawCard(id);
  const { error } = await sb.from('shahid_drafts')
    .update({ class_name: v })
    .eq('id', id).eq('user_id', currentUser.id);
  if(error){
    showToast('تعذّر حفظ الصف', 'error');
    d.class_name = before;
    batchRedrawCard(id);
  }
}

async function batchSetDate(id, value){
  const d = batchDrafts.find(x => x.id === id);
  if(!d || !currentUser) return;
  const limit = batchDateLimit();
  if(!value || value > limit){
    showToast(limit === localIsoDate() ? 'اختر تاريخًا لا يتجاوز اليوم' : 'اختر تاريخًا لا يتجاوز آخر يوم دراسة بالتقويم', 'error');
    batchRedrawCard(id);
    return;
  }
  d.planned_date = value;
  d.cycle_year = getCycleYear(value);
  const { error } = await sb.from('shahid_drafts')
    .update({ planned_date: value, cycle_year: d.cycle_year })
    .eq('id', id).eq('user_id', currentUser.id);
  if(error) showToast('تعذّر حفظ التاريخ', 'error');
  batchRedrawCard(id); /* تنبيه الصف/اليوم يتبع التاريخ الجديد */
}

async function batchDeleteDraft(id){
  const d = batchDrafts.find(x => x.id === id);
  if(!d || batchBusyIds.has(id) || !currentUser) return;
  const ok = await showConfirm(`حذف بطاقة «${d.title}»؟ لم تُحوَّل لشاهد بعد، ويمكنك اختيارها مجددًا متى شئت.`);
  if(!ok) return;
  /* قد يكون رفع صورتها بدأ أثناء السؤال — لا نحذف بطاقة تُحوَّل الآن */
  if(batchBusyIds.has(id) || !batchDrafts.some(x => x.id === id)) return;
  const { error } = await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر الحذف', 'error'); return; }
  batchDrafts = batchDrafts.filter(x => x.id !== id);
  if(isBatchViewOpen() && batchStep === 'board') renderBatchBoard();
}

async function batchDeleteAll(btn){
  if(!currentUser || btn.disabled) return;
  if(batchBusyIds.size){ showToast('انتظر انتهاء الرفع الجاري', 'error'); return; }
  const ok = await showConfirm(`حذف كل البطاقات المتبقية (${batchDrafts.length})؟ لم تُحوَّل لشواهد بعد. الشواهد المكتملة لا تتأثر.`);
  if(!ok || batchBusyIds.size) return;
  beginExportBusy(btn);
  try{
    const { error } = await sb.from('shahid_drafts').delete().eq('user_id', currentUser.id);
    if(error) throw error;
    batchDrafts = [];
    if(isBatchViewOpen()) renderBatchBoard();
  } catch(err){
    showToast('تعذّر الحذف', 'error');
  } finally {
    endExportBusy(btn);
  }
}

/* ============ الصور ← شاهد مكتمل ============ */
async function batchOnPhotos(id, input){
  const picked = Array.from(input.files || []).slice(0, BATCH_PHOTOS_PER_CARD);
  input.value = '';
  if(!picked.length || batchBusyIds.has(id)) return;
  const files = [];
  for(const f of picked){
    if(!f.type.startsWith('image/')){ showToast('الصور فقط هنا — لإرفاق مستند استخدم «مراجعة وتعديل» بعد الحفظ', 'error'); return; }
    if(f.size > MAX_UPLOAD_MB * 1024 * 1024){ showToast(`حجم الصورة كبير جدًا (الحد ${MAX_UPLOAD_MB} ميجابايت).`, 'error'); return; }
    files.push(f);
  }
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  if(!batchDrafts.some(d => d.id === id)) return;
  /* التعطيل قبل أي await: نقرة ثانية على نفس البطاقة تُتجاهل أعلاه */
  batchBusyIds.add(id);
  batchRedrawCard(id);
  const compressed = await Promise.all(files.map(compressImage));
  await batchPromote(id, compressed);
}

async function batchPromote(id, files){
  const uid = currentUser && currentUser.id;
  const draft = batchDrafts.find(d => d.id === id);
  if(!uid || !draft){ batchBusyIds.delete(id); return; }
  const uploaded = [];
  const cleanup = () => { if(uploaded.length) sb.storage.from('shawahid-photos').remove(uploaded).catch(() => {}); };
  try{
    const urls = await Promise.all(files.map(async (file) => {
      const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : 'jpg';
      const path = `${uid}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, file);
      if(upErr) throw upErr;
      uploaded.push(path);
      return sb.storage.from('shawahid-photos').getPublicUrl(path).data.publicUrl;
    }));
    /* آخر نسخة من المسودة (التاريخ قد يُعدَّل أثناء الرفع) */
    const latest = batchDrafts.find(d => d.id === id) || draft;
    const tpl = (SHAHID_TEMPLATES[latest.element_key] || []).find(t => t.name === latest.template_name) || null;
    const label = (() => {
      const el = (DB_ELEMENTS || []).find(e => e.key === latest.element_key);
      return el ? `${el.label} (${el.weight}%)` : latest.element_key;
    })();
    const record = buildBatchShahidRecord(latest, tpl, urls, label, currentUser.email);
    const { data: inserted, error } = await sb.from('shawahid').insert(record).select().single();
    if(error){
      if(error.code === '23505'){
        /* حُوّلت هذه المسودة سابقًا (تبويب/جهاز آخر) — لا نكرر الشاهد */
        cleanup();
        await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', uid);
        batchDrafts = batchDrafts.filter(d => d.id !== id);
        showToast('هذه البطاقة تحوّلت إلى شاهد من قبل', 'ok');
        return;
      }
      throw error;
    }
    /* فشل حذف المسودة هنا غير حرج: ستعود عند التحميل التالي، وأي محاولة
       تحويل لها تصطدم بالمفتاح الأساسي أعلاه فتُنظَّف بلا تكرار. */
    await sb.from('shahid_drafts').delete().eq('id', id).eq('user_id', uid);
    batchDrafts = batchDrafts.filter(d => d.id !== id);
    if(currentUser && currentUser.id === uid){
      if(!myRecords.some(r => String(r.id) === String(inserted.id))) myRecords.unshift(inserted);
      batchDone.unshift({ id: inserted.id, title: latest.title, label: batchElementLabel(latest.element_key), thumb: urls[0], count: urls.length });
      if(typeof loadPlan === 'function') loadPlan();
    }
    showToast('تم حفظ الشاهد ✓' + (inserted.ref_number ? ` — ${inserted.ref_number}` : ''), 'ok');
  } catch(err){
    cleanup();
    showToast('تعذّر الحفظ: ' + (err.message || err), 'error');
  } finally {
    batchBusyIds.delete(id);
    if(isBatchViewOpen() && batchStep === 'board' && currentUser && currentUser.id === uid) renderBatchBoard();
  }
}
