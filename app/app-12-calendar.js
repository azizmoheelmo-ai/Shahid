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

   ميزة "المهام" بـapp-13-tasks.js (دفعة ثانية)، وتظهر مهامها غير
   المُنجَزة كنقطة زرقاء هنا أيضًا. تصدير ICS عبر رابط اشتراك دائم
   (api/calendar-feed.js) — أسفل هذا الملف — بدل ملف تنزيل ثابت يصبح
   قديمًا فورًا، بإعادة استخدام نظام personal_access_tokens الموجود أصلًا
   لموصل الذكاء الاصطناعي لكن بتصنيف (label) مختلف تمامًا، فلا يعمل رمز
   أحدهما مكان الآخر حتى لو تسرّب.
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
/* يكتب بشريط التاريخ أعلى الرئيسية (dateInfoWeek/dateInfoBar) لا ببطاقة
   منفصلة — كانا يظهران معًا بنفس الشاشة (شريط التاريخ + بطاقة الأسبوع)
   بمظهر تكرار، فدُمجا بعنصر واحد قابل للنقر (يفتح التقويم، أو إعدادات
   الملف الشخصي لو لم يُحدَّد النطاق بعد). */
async function renderCurrentWeekWidget(){
  const weekSpan = document.getElementById('dateInfoWeek');
  const bar = document.getElementById('dateInfoBar');
  if(!weekSpan || !bar) return;
  if(!calendarRegion){
    weekSpan.textContent = '📅 حدّد نطاقك لعرض الأسبوع الدراسي';
    bar.onclick = () => showSettings('profile');
    return;
  }
  const regionAtCallTime = calendarRegion; // احتياطًا: لو تغيّر النطاق أثناء الانتظار، لا نطبّق نتيجة النطاق القديم
  try{
    const { weeks, holidays } = await loadCalendarData(regionAtCallTime);
    if(calendarRegion !== regionAtCallTime) return;
    const today = new Date().toISOString().slice(0, 10);
    const info = resolveCurrentWeekInfo(weeks, holidays, today);
    bar.onclick = () => showCalendar();
    if(info.status === 'holiday'){ weekSpan.textContent = `📅 إجازة حاليًا: ${info.holidayName}`; }
    else if(info.status === 'ok'){ weekSpan.textContent = `📅 ${info.weekLabel}`; }
    else weekSpan.textContent = '';
  } catch(e){
    weekSpan.textContent = '';
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

/* ============ جلب علامات المستخدم الشخصية (شواهد + جلسات برامج + مهام) ============ */
function emptyMarkerBucket(){ return { shahid: [], program: [], task: [] }; }

async function loadUserCalendarMarkers(calendarData){
  const markers = {}; // isoDate -> { shahid: string[], program: string[], task: string[] }
  if(!currentUser) return markers;

  const [{ data: shawahid }, { data: programs }, { data: tasks }] = await Promise.all([
    sb.from('shawahid').select('lesson_title, lesson_date').eq('user_id', currentUser.id).not('lesson_date', 'is', null),
    sb.from('activity_programs').select('name, sessions').eq('user_id', currentUser.id),
    sb.from('tasks').select('title, due_date, done').eq('user_id', currentUser.id).not('due_date', 'is', null),
  ]);

  (shawahid || []).forEach(s => {
    if(!s.lesson_date) return;
    (markers[s.lesson_date] = markers[s.lesson_date] || emptyMarkerBucket()).shahid.push(s.lesson_title || 'شاهد');
  });

  const weekLabelDateIndex = buildWeekLabelDateIndex(calendarData.weeks);
  (programs || []).forEach(p => {
    (p.sessions || []).forEach(s => {
      const date = weekLabelDateIndex[s.week_label];
      if(!date) return;
      (markers[date] = markers[date] || emptyMarkerBucket()).program.push(`${p.name || 'برنامج'} — جلسة ${s.session_no || ''}`);
    });
  });

  (tasks || []).forEach(t => {
    if(!t.due_date || t.done) return; // لا نعلّم المهام المُنجَزة بالتقويم — لا تحتاج انتباهًا بعد
    (markers[t.due_date] = markers[t.due_date] || emptyMarkerBucket()).task.push(t.title || 'مهمة');
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
      if(m.task.length) dotsHtml += '<span class="cal-dot dot-task" title="مهمة مستحقة"></span>';
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
        ...m.task.map(t => '🔵 ' + escapeHtml(t)),
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

/* ============================================================
   رابط اشتراك التقويم (ICS/webcal) — الإعدادات > الاشتراك بالتقويم
   ============================================================
   نفس نمط generateConnectorToken/loadConnectorTokens (app-03) حرفيًا،
   لكن بتصنيف (label) مختلف كليًا — CALENDAR_FEED_TOKEN_LABEL أدناه يجب
   أن يطابق نفس الثابت بـapi/calendar-feed.js تمامًا، وإلا لن يعمل أي
   رابط جديد يُولَّد هنا. */
const CALENDAR_FEED_TOKEN_LABEL = 'رابط تقويم ICS';

function calendarFeedUrl(rawToken){
  return `${location.origin}/api/calendar-feed?token=${encodeURIComponent(rawToken)}`;
}

async function showCalendarFeedSettings(){
  showSettingsSection('calendarFeed');
  await loadCalendarFeedTokens();
}

async function loadCalendarFeedTokens(){
  const box = document.getElementById('calendarFeedTokensList');
  box.textContent = 'جارٍ التحميل...';
  const { data, error } = await sb.from('personal_access_tokens')
    .select('id, token_prefix, created_at, last_used_at, revoked_at, expires_at')
    .eq('user_id', currentUser.id)
    .eq('label', CALENDAR_FEED_TOKEN_LABEL)
    .order('created_at', { ascending: false });
  if(error){ box.textContent = 'تعذّر تحميل الروابط: ' + error.message; return; }
  renderCalendarFeedTokens(data || []);
}

function renderCalendarFeedTokens(tokens){
  const box = document.getElementById('calendarFeedTokensList');
  if(!tokens.length){ box.innerHTML = '<p style="margin:0;">لا يوجد أي رابط حتى الآن.</p>'; return; }
  box.innerHTML = tokens.map(t => {
    const revoked = !!t.revoked_at;
    const created = new Date(t.created_at).toLocaleDateString('ar-SA');
    const lastUsed = t.last_used_at ? new Date(t.last_used_at).toLocaleDateString('ar-SA') : 'لم يُستخدم بعد';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:700;color:var(--navy);font-family:monospace;">${escapeHtml(t.token_prefix)}…</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">أُنشئ: ${created} — آخر استخدام: ${escapeHtml(lastUsed)}${revoked ? ' — <b style="color:#B23A3A;">مُلغى</b>' : ''}</div>
      </div>
      ${revoked ? '' : `<button class="btn btn-outline" style="padding:5px 12px;font-size:11px;border-color:#B23A3A;color:#B23A3A;flex-shrink:0;" onclick="revokeCalendarFeedToken('${t.id}')">إلغاء</button>`}
    </div>`;
  }).join('');
}

async function generateCalendarFeedToken(){
  const btn = document.getElementById('genCalendarFeedBtn');
  btn.disabled = true;
  try{
    const raw = generateRandomToken();
    const hash = await sha256Hex(raw);
    const prefix = raw.slice(0, 18);
    const { error } = await sb.from('personal_access_tokens').insert({
      user_id: currentUser.id,
      label: CALENDAR_FEED_TOKEN_LABEL,
      token_hash: hash,
      token_prefix: prefix,
    });
    if(error) throw error;
    const url = calendarFeedUrl(raw);
    const webcalUrl = url.replace(/^https?:\/\//, 'webcal://');
    showInfoModal(`
      <div style="text-align:right;">
        <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">رابط تقويمك</h3>
        <p style="font-size:12px;color:#B23A3A;line-height:1.8;margin:0 0 10px;">
          احفظه الآن — لن يظهر كاملًا مرة أخرى. لو ضاع أو شككت بتسريبه، ألغه وولّد رابطًا جديدًا.
        </p>
        <div style="background:#F1EEE6;padding:10px;font-family:monospace;font-size:11px;word-break:break-all;user-select:all;margin-bottom:10px;">${escapeHtml(url)}</div>
        <button class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:8px;" onclick="navigator.clipboard.writeText('${url}').then(()=>showToast('تم النسخ','ok'))">نسخ الرابط</button>
        <a class="btn btn-primary" style="display:flex;justify-content:center;text-decoration:none;" href="${escapeHtml(webcalUrl)}">➕ إضافة مباشرة لتقويم الجهاز</a>
        <p style="font-size:10.5px;color:var(--muted);margin:10px 0 0;line-height:1.7;">جوجل تقويم: أضف بالرابط أعلاه عبر "إعدادات ← إضافة تقويم ← عبر الرابط". أوتلوك/آيفون: زر "إضافة لتقويم الجهاز" أعلاه يعمل مباشرة غالبًا.</p>
      </div>`, '440px');
    await loadCalendarFeedTokens();
  } catch(err){
    showToast('تعذّر إنشاء الرابط: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function revokeCalendarFeedToken(id){
  const ok = await showConfirm('إلغاء هذا الرابط؟ أي تقويم مشترك به سيتوقف عن التحديث فورًا.');
  if(!ok) return;
  /* .eq('user_id', ...) إضافية رغم اعتماد RLS أصلًا على auth.uid() = user_id
     — نفس نمط revokeConnectorToken بالضبط (app-03)، دفاع إضافي غير مكلف. */
  const { error } = await sb.from('personal_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', currentUser.id);
  if(error){ showToast('تعذّر الإلغاء: ' + error.message, 'error'); return; }
  showToast('تم إلغاء الرابط', 'ok');
  await loadCalendarFeedTokens();
}
