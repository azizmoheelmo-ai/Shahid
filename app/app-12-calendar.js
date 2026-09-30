'use strict';
/* ============================================================
   (12) التقويم الدراسي — الدفعة الأولى (عرض قراءة فقط)
   ------------------------------------------------------------
   جداول مرجعية مشتركة بين كل المعلمين (academic_calendar_weeks/
   academic_calendar_holidays) — بلا user_id، قراءة فقط لأي معلم مسجَّل
   دخول (راجع RLS بـmigration create_academic_calendar_tables). المعلم
   يختار نطاقه الجغرافي مرة واحدة من الإعدادات > الملف الشخصي
   (profiles.calendar_region)، ونعرض له تقويم نطاقه فقط.

   القيمة الفعلية المضافة: activity_programs.sessions تُخزَّن فيها كل
   جلسة بـweek_label نصي فقط (مثل "الأسبوع الرابع") بلا أي تاريخ فعلي —
   هذا الملف يحوّله لتاريخ حقيقي عبر جدول الأسابيع، ويعرضه كنقطة بالتقويم.

   قيد معروف مقبول بهذه الدفعة: لا يوجد بجلسات activity_programs أي
   حقل يحدّد الفصل الدراسي، وweek_label نفسه يتكرر باسم واحد بكل فصل
   ("الأسبوع الأول" موجود بالفصلين). عند التحويل لتاريخ، نأخذ أول ظهور
   زمنيًا لهذا الاسم (الفصل الأول) — قد يكون غير دقيق لبرنامج فعليًا
   بالفصل الثاني. مجرد نقطة عرض تقريبية، لا تُستخدم بأي حساب حسّاس.

   ميزة "المهام" وربطها بالتقويم، وتصدير ICS، دفعة لاحقة منفصلة.
   ============================================================ */

const CALENDAR_ACADEMIC_YEAR = '1448-1449';
const CALENDAR_REGIONS = [
  { value: 'makkah_group', label: 'مكة – المدينة – جدة – الطائف' },
  { value: 'other_regions', label: 'بقية المناطق' },
];

let calendarViewMode = 'month'; // 'month' | 'week'
let calendarMonthCursor = null; // Date — أول يوم بالشهر المعروض حاليًا بالعرض الشهري
let calendarDataCache = null; // { region, weeks:[...], holidays:[...] } — يُعاد تحميله فقط لو تغيّر النطاق

/* ============ جلب بيانات التقويم المرجعية (بحسب نطاق المعلم) ============ */
async function loadCalendarData(region){
  if(calendarDataCache && calendarDataCache.region === region) return calendarDataCache;
  const [{ data: weeks, error: e1 }, { data: holidays, error: e2 }] = await Promise.all([
    sb.from('academic_calendar_weeks')
      .select('week_label, hijri_month, day_name, hijri_date, gregorian_date, note, semester')
      .eq('academic_year', CALENDAR_ACADEMIC_YEAR).eq('region_group', region)
      .order('gregorian_date'),
    sb.from('academic_calendar_holidays')
      .select('holiday_name, event_label, day_name, hijri_date, gregorian_date, semester')
      .eq('academic_year', CALENDAR_ACADEMIC_YEAR).eq('region_group', region)
      .order('gregorian_date'),
  ]);
  if(e1 || e2) throw (e1 || e2);
  const data = { region, weeks: weeks || [], holidays: holidays || [] };
  calendarDataCache = data;
  return data;
}

/* ============================================================
   دوال صرفة (pure) — قابلة للاختبار مباشرة بمعزل، بلا شبكة أو DOM
   ============================================================ */

/* هل يقع تاريخ (YYYY-MM-DD) داخل أي إجازة مُسجَّلة؟ يطابق صفّي "تبدأ..."
   و"تنتهي..."/"تنتهى..." لنفس holiday_name، ويُرجع اسمها أو null. */
function findHolidayForDate(holidayRows, isoDate){
  const byName = {};
  (holidayRows || []).forEach(r => {
    if(!r || !r.holiday_name) return;
    (byName[r.holiday_name] = byName[r.holiday_name] || []).push(r);
  });
  for(const name in byName){
    const rows = byName[name];
    const start = rows.find(r => r.event_label && r.event_label.indexOf('تبدأ') !== -1);
    const end = rows.find(r => r.event_label && (r.event_label.indexOf('تنتهي') !== -1 || r.event_label.indexOf('تنتهى') !== -1));
    if(start && end && start.gregorian_date <= isoDate && isoDate <= end.gregorian_date) return name;
  }
  return null;
}

/* يحدّد "الأسبوع الحالي" لتاريخ مُعطى ضمن نطاق واحد:
   - إجازة حالية → {status:'holiday', holidayName}
   - آخر صف تاريخه ≤ اليوم وله week_label → {status:'ok', weekLabel, semester}
   - اليوم قبل أول يوم مسجَّل بالتقويم كله → {status:'before_start'} */
function resolveCurrentWeekInfo(weekRows, holidayRows, isoDate){
  const holidayName = findHolidayForDate(holidayRows, isoDate);
  if(holidayName) return { status: 'holiday', holidayName };

  const withLabel = (weekRows || []).filter(r => r && r.week_label);
  let match = null;
  for(const r of withLabel){ // مُفترَض مُرتَّبة تصاعديًا بالتاريخ (نفس ترتيب استعلام loadCalendarData)
    if(r.gregorian_date <= isoDate) match = r; else break;
  }
  if(!match) return { status: 'before_start' };
  return { status: 'ok', weekLabel: match.week_label, semester: match.semester };
}

/* يبني خريطة "اسم الأسبوع → أول تاريخ (الأحد) ظهر فيه هذا الاسم" — أول
   ظهور زمنيًا فقط (راجع القيد المعروف أعلى الملف بخصوص تكرار الاسم بين
   الفصلين). weekRows يجب أن تكون مُرتَّبة تصاعديًا بالتاريخ. */
function buildWeekLabelDateIndex(weekRows){
  const index = {};
  (weekRows || []).forEach(w => {
    if(w && w.week_label && !index[w.week_label]) index[w.week_label] = w.gregorian_date;
  });
  return index;
}

/* ============ ويدجت "الأسبوع الحالي" بالشاشة الرئيسية ============ */
async function renderCurrentWeekWidget(){
  const card = document.getElementById('currentWeekCard');
  if(!card) return;
  if(!calendarRegion){
    card.style.display = 'block';
    card.textContent = '📅 حدّد نطاقك الجغرافي لعرض الأسبوع الدراسي الحالي — اضغط هنا';
    card.onclick = () => showSettings('profile');
    return;
  }
  const regionAtCallTime = calendarRegion; // احتياطًا: لو تغيّر النطاق أثناء الانتظار، لا نطبّق نتيجة النطاق القديم
  try{
    const { weeks, holidays } = await loadCalendarData(regionAtCallTime);
    if(calendarRegion !== regionAtCallTime) return;
    const today = new Date().toISOString().slice(0, 10);
    const info = resolveCurrentWeekInfo(weeks, holidays, today);
    card.onclick = () => showCalendar();
    if(info.status === 'holiday'){ card.style.display = 'block'; card.textContent = `📅 إجازة حاليًا: ${info.holidayName}`; }
    else if(info.status === 'ok'){ card.style.display = 'block'; card.textContent = `📅 ${info.weekLabel}`; }
    else card.style.display = 'none';
  } catch(e){
    card.style.display = 'none';
  }
}

/* ============ الإعدادات: اختيار النطاق الجغرافي ============
   تحديث مباشر بـ.eq('id', uid) صريحًا (لا اعتماد على RLS وحدها) — نفس
   نمط saveDutyType. */
async function saveCalendarRegion(region){
  const sel = document.getElementById('calRegionSelect');
  const uid = currentUser.id;
  const previous = calendarRegion;
  if(sel) sel.disabled = true;
  try{
    const { error } = await sb.from('profiles').update({ calendar_region: region || null }).eq('id', uid);
    if(error) throw error;
    if(!currentUser || currentUser.id !== uid) return; // تغيّر المستخدم الحالي أثناء الانتظار
    calendarRegion = region || null;
    calendarDataCache = null;
    showToast('تم حفظ نطاقك الجغرافي', 'ok');
    renderCurrentWeekWidget();
  } catch(err){
    if(sel && currentUser && currentUser.id === uid) sel.value = previous || '';
    showToast('تعذّر الحفظ: ' + err.message, 'error');
  } finally {
    if(sel) sel.disabled = false;
  }
}

/* ============ شاشة "التقويم الدراسي" ============ */
async function showCalendar(){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('calendarView').style.display = 'block';
  document.getElementById('calRegionMissingNote').style.display = calendarRegion ? 'none' : 'block';
  if(!calendarMonthCursor) calendarMonthCursor = new Date();
  switchCalendarViewMode(calendarViewMode);
}

function switchCalendarViewMode(mode){
  calendarViewMode = mode;
  document.getElementById('calTabBtnMonth').className = mode === 'month' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('calTabBtnWeek').className = mode === 'week' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('calMonthSection').style.display = mode === 'month' ? 'block' : 'none';
  document.getElementById('calWeekSection').style.display = mode === 'week' ? 'block' : 'none';
  renderCalendarBody();
}

function changeCalendarMonth(delta){
  const d = new Date(calendarMonthCursor);
  d.setMonth(d.getMonth() + delta);
  calendarMonthCursor = d;
  renderCalendarBody();
}

async function renderCalendarBody(){
  const monthGrid = document.getElementById('calMonthGrid');
  const weekList = document.getElementById('calWeekList');
  if(!calendarRegion){
    monthGrid.innerHTML = '';
    weekList.innerHTML = '';
    return;
  }
  const regionAtCallTime = calendarRegion;
  let data;
  try{
    data = await loadCalendarData(regionAtCallTime);
  } catch(e){
    monthGrid.innerHTML = `<p style="grid-column:1/-1;padding:0 32px;color:#8A2C2C;">تعذّر تحميل التقويم: ${escapeHtml(e.message || '')}</p>`;
    return;
  }
  if(calendarRegion !== regionAtCallTime) return; // تغيّر النطاق أثناء الانتظار — لا نعرض بيانات نطاق قديم

  const markers = await loadUserCalendarMarkers(data);
  if(calendarRegion !== regionAtCallTime) return;

  if(calendarViewMode === 'month') renderCalendarMonthGrid(data, markers);
  else renderCalendarWeekList(data, markers);
}

/* ============ جلب علامات المستخدم الشخصية (شواهد + جلسات برامج) ============ */
async function loadUserCalendarMarkers(calendarData){
  const markers = {}; // isoDate -> { shahid: string[], program: string[] }
  if(!currentUser) return markers;

  const [{ data: shawahid }, { data: programs }] = await Promise.all([
    sb.from('shawahid').select('lesson_title, lesson_date').eq('user_id', currentUser.id).not('lesson_date', 'is', null),
    sb.from('activity_programs').select('name, sessions').eq('user_id', currentUser.id),
  ]);

  (shawahid || []).forEach(s => {
    if(!s.lesson_date) return;
    (markers[s.lesson_date] = markers[s.lesson_date] || { shahid: [], program: [] }).shahid.push(s.lesson_title || 'شاهد');
  });

  const weekLabelDateIndex = buildWeekLabelDateIndex(calendarData.weeks);
  (programs || []).forEach(p => {
    (p.sessions || []).forEach(s => {
      const date = weekLabelDateIndex[s.week_label];
      if(!date) return;
      (markers[date] = markers[date] || { shahid: [], program: [] }).program.push(`${p.name || 'برنامج'} — جلسة ${s.session_no || ''}`);
    });
  });

  return markers;
}

/* ============ العرض الشهري ============ */
function renderCalendarMonthGrid(data, markers){
  const grid = document.getElementById('calMonthGrid');
  const label = document.getElementById('calMonthLabel');
  const cursor = calendarMonthCursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-based

  label.textContent = cursor.toLocaleDateString('ar-SA', { year: 'numeric', month: 'long' });

  const byDate = {};
  data.weeks.forEach(w => { byDate[w.gregorian_date] = w; });

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=الأحد..6=السبت
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  let html = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    .map(d => `<div class="cal-day-head">${d}</div>`).join('');

  for(let i = 0; i < startOffset; i++) html += '<div class="cal-day empty"></div>';

  for(let day = 1; day <= daysInMonth; day++){
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekRow = byDate[iso];
    const holidayName = findHolidayForDate(data.holidays, iso);
    const dow = new Date(year, month, day).getDay();
    const isWeekend = dow === 5 || dow === 6; // الجمعة/السبت
    const m = markers[iso];

    let dotsHtml = '';
    if(m){
      if(m.shahid.length) dotsHtml += '<span class="cal-dot dot-shahid" title="شاهد مُضاف"></span>';
      if(m.program.length) dotsHtml += '<span class="cal-dot dot-program" title="جلسة برنامج نشاط"></span>';
    }

    const classes = ['cal-day'];
    if(holidayName) classes.push('is-holiday');
    else if(isWeekend) classes.push('is-weekend');
    if(iso === todayIso) classes.push('is-today');

    const titleText = holidayName || (weekRow && weekRow.week_label) || '';
    html += `<div class="${classes.join(' ')}" title="${escapeHtml(titleText)}">
      <div class="cal-day-num">${day}</div>
      <div class="cal-dot-row">${dotsHtml}</div>
    </div>`;
  }

  grid.innerHTML = html;
}

/* ============ العرض الأسبوعي (يطابق جدول "توزيع الأسابيع" الرسمي) ============ */
function renderCalendarWeekList(data, markers){
  const box = document.getElementById('calWeekList');
  const todayIso = new Date().toISOString().slice(0, 10);

  const groups = [];
  let current = null;
  data.weeks.forEach(w => {
    if(!current || current.week_label !== w.week_label || current.semester !== w.semester){
      current = { week_label: w.week_label, semester: w.semester, rows: [] };
      groups.push(current);
    }
    current.rows.push(w);
  });

  const holidaysHtml = data.holidays.length ? `
    <div class="cal-week-group">
      <h3>الإجازات</h3>
      ${data.holidays.map(h => `<div class="cal-week-day-row"><span>${escapeHtml(h.holiday_name)} — ${escapeHtml(h.event_label)}</span><span>${escapeHtml(h.day_name || '')} ${escapeHtml(h.hijri_date || '')}</span></div>`).join('')}
    </div>` : '';

  const weeksHtml = groups.map(g => {
    const rowsHtml = g.rows.map(r => {
      const m = markers[r.gregorian_date];
      const marks = m ? [
        ...m.shahid.map(t => '📗 ' + escapeHtml(t)),
        ...m.program.map(t => '🟡 ' + escapeHtml(t)),
      ] : [];
      const classes = ['cal-week-day-row'];
      if(r.note) classes.push('is-holiday');
      if(r.gregorian_date === todayIso) classes.push('is-today');
      const d = new Date(r.gregorian_date + 'T00:00:00');
      const gregLabel = d.toLocaleDateString('ar-SA-u-nu-latn', { day: 'numeric', month: 'short' });
      const rightCol = [escapeHtml(r.note || ''), ...marks].filter(Boolean).join('<br>');
      return `<div class="${classes.join(' ')}">
        <span>${escapeHtml(r.day_name)} ${escapeHtml(r.hijri_date || '')} (${gregLabel})</span>
        <span>${rightCol}</span>
      </div>`;
    }).join('');
    const semesterLabel = g.semester === 1 ? 'الفصل الأول' : 'الفصل الثاني';
    return `<div class="cal-week-group"><h3>${escapeHtml(g.week_label)} — ${semesterLabel}</h3>${rowsHtml}</div>`;
  }).join('');

  box.innerHTML = holidaysHtml + weeksHtml;
}
