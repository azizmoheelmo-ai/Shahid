/* ============================================================
   رابط اشتراك التقويم (ICS/webcal) — قراءة فقط
   ============================================================
   يولّد ملف تقويم (RFC 5545) يجمع: الإجازات الرسمية (حسب نطاق المعلم
   الجغرافي)، شواهده (بتاريخ الدرس)، مهامه غير المُنجَزة (بتاريخ
   الاستحقاق)، وجلسات برامج أنشطته (بتاريخ محلول من week_label). مصمَّم
   ليُضاف كرابط اشتراك دائم بتقويم جوجل/أوتلوك (يتحدّث تلقائيًا كل ما
   يفتحه العميل، بخلاف ملف .ics يُنزَّل مرة واحدة ويصبح قديمًا فورًا).

   المصادقة: برامج تقويم خارجية (جوجل) تجلب الرابط بطلب GET مباشر بلا
   إمكانية إرفاق ترويسة Authorization — فالرمز جزء من الرابط نفسه
   (?token=...)، بنفس بنية personal_access_tokens المستخدمة أصلًا
   لموصل الذكاء الاصطناعي (api/mcp.js) لكن بتصنيف (label) مختلف تمامًا
   ["رابط تقويم ICS"]: رمز موصل الذكاء الاصطناعي لا يعمل هنا والعكس، حتى
   لو سُرِّب أحدهما لا يمنح صلاحية الآخر. الرابط نفسه سرّي (يجب معاملته
   كسرّ لا يُشارَك) — قابل للإلغاء والتوليد من جديد في أي وقت من الإعدادات.

   متغيرات البيئة المطلوبة (نفس متغيرات api/mcp.js):
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CALENDAR_FEED_TOKEN_LABEL = 'رابط تقويم ICS';
const CALENDAR_ACADEMIC_YEAR = '1448-1449';

/* نفس حد الاستخدام المطبَّق على موصل الذكاء الاصطناعي، ونفس دالة قاعدة
   البيانات check_mcp_rate_limit (عامة لأي رمز بصرف النظر عن تصنيفه) —
   عملاء التقويم يجلبون الرابط كل بضع ساعات عادة، سخي بما يكفي لذلك. */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECONDS = 300;

function hashToken(raw){
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/* reason ∈ 'ok' | 'missing_token' | 'invalid_token' | 'revoked_token' |
            'expired_token' | 'rate_limited' | 'rate_limit_error' */
async function authenticateFeedToken(rawToken, supabase){
  if(!rawToken) return { userId: null, reason: 'missing_token' };

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .select('id, user_id, label, revoked_at, expires_at')
    .eq('token_hash', hashToken(rawToken))
    .maybeSingle();
  /* التحقق من التصنيف هنا صراحة (لا فلترة بالاستعلام) حتى نُميّز لاحقًا
     "رمز غير موجود" عن "رمز موصل ذكاء اصطناعي استُخدم هنا بالخطأ" لو
     احتجنا تشخيصًا أدق مستقبلاً — النتيجة النهائية invalid_token بكلتا
     الحالتين على أي حال. */
  if(error || !data || data.label !== CALENDAR_FEED_TOKEN_LABEL) return { userId: null, reason: 'invalid_token' };
  if(data.revoked_at) return { userId: null, reason: 'revoked_token', ownerId: data.user_id };
  if(data.expires_at && new Date(data.expires_at).getTime() < Date.now()){
    return { userId: null, reason: 'expired_token', ownerId: data.user_id };
  }

  const { data: allowed, error: rlError } = await supabase.rpc('check_mcp_rate_limit', {
    p_token_id: data.id,
    p_max_requests: RATE_LIMIT_MAX_REQUESTS,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS
  });
  if(rlError) return { userId: null, reason: 'rate_limit_error', ownerId: data.user_id };
  if(!allowed) return { userId: null, reason: 'rate_limited', ownerId: data.user_id };

  supabase.from('personal_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return { userId: data.user_id, reason: 'ok' };
}

/* ============================================================
   دوال صرفة (pure) لبناء نص ICS — قابلة للاختبار بمعزل بلا شبكة
   ============================================================ */

function formatIcsDate(isoDate){
  return isoDate.replace(/-/g, '');
}

/* iCal يعتبر DTEND لأي حدث "يوم كامل" حدًا غير شامل (اليوم التالي مباشرة) */
function addOneDay(isoDate){
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function escapeIcsText(str){
  /* \r\n|\r|\n معًا (لا \r?\n وحدها): سطر مُدخَل من المستخدم (عنوان شاهد/
     مهمة) قد يحوي \r منفردًا بلا \n تابع له — لو تُرك بلا تفليت، بعض
     عملاء iCal تتعامل معه كفاصل سطر فعلي، فيصير حقنًا قادرًا نظريًا على
     تزييف حقول/أحداث إضافية داخل ملف ICS واحد (نفس فئة "حقن عبر أسطر
     جديدة" الشهيرة بصيغ نصية أخرى مثل رؤوس HTTP). */
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/* طيّ الأسطر الطويلة حسب RFC 5545 (٧٥ محرفًا فأقل لكل سطر فعلي، وسطر
   المتابعة يبدأ بمسافة) — نحسب بعدد الأحرف لا البايتات (تبسيط مقصود:
   يطوي أبكر مما يلزم لنصوص عربية متعددة البايت، آمن دائمًا ولا يكسر أي
   عميل تقويم حقيقي، بخلاف حساب بايتات UTF-8 الدقيق الأكثر تعقيدًا). */
function foldIcsLine(line){
  if(line.length <= 75) return line;
  let result = '';
  let rest = line;
  let first = true;
  while(rest.length > 0){
    const chunkLen = first ? 75 : 74;
    result += (first ? '' : '\r\n ') + rest.slice(0, chunkLen);
    rest = rest.slice(chunkLen);
    first = false;
  }
  return result;
}

/* نفس منطق buildWeekLabelDateIndex بـapp/app-12-calendar.js (منسوخ هنا
   حرفيًا — كود متصفح هناك، لا يصلح استيراده مباشرة بكود Node). نفس القيد
   الموثَّق هناك: week_label يتكرر بنفس الاسم بين الفصلين، فنأخذ أول ظهور
   زمنيًا فقط (weekRows يجب أن تكون مُرتَّبة تصاعديًا بالتاريخ). */
function buildWeekLabelDateIndex(weekRows){
  const index = {};
  (weekRows || []).forEach(w => {
    if(w && w.week_label && !index[w.week_label]) index[w.week_label] = w.gregorian_date;
  });
  return index;
}

/* يبني قائمة أحداث (كائنات وسيطة، لا نص ICS بعد) من بيانات المستخدم
   المُجهَّزة مسبقًا — دالة صرفة بالكامل، هذا ما تختبره tests/calendar-feed.test.js. */
function buildIcsEvents({ weeks, holidays, shawahid, tasks, programs }){
  const events = [];

  const byHolidayName = {};
  (holidays || []).forEach(h => {
    if(!h.holiday_name) return;
    (byHolidayName[h.holiday_name] = byHolidayName[h.holiday_name] || []).push(h);
  });
  Object.keys(byHolidayName).forEach(name => {
    const rows = byHolidayName[name];
    const start = rows.find(r => r.event_label && r.event_label.indexOf('تبدأ') !== -1);
    const end = rows.find(r => r.event_label && (r.event_label.indexOf('تنتهي') !== -1 || r.event_label.indexOf('تنتهى') !== -1));
    if(start && end){
      events.push({ uid: `holiday-${encodeURIComponent(name)}-${start.gregorian_date}`, start: start.gregorian_date, endExclusive: addOneDay(end.gregorian_date), summary: name });
    }
  });

  (shawahid || []).forEach(s => {
    if(!s.lesson_date) return;
    events.push({ uid: `shahid-${s.id}`, start: s.lesson_date, endExclusive: addOneDay(s.lesson_date), summary: `شاهد: ${s.lesson_title || 'بلا عنوان'}` });
  });

  (tasks || []).forEach(t => {
    if(!t.due_date || t.done) return;
    events.push({ uid: `task-${t.id}`, start: t.due_date, endExclusive: addOneDay(t.due_date), summary: `مهمة: ${t.title}` });
  });

  const weekLabelDateIndex = buildWeekLabelDateIndex(weeks);
  (programs || []).forEach(p => {
    (p.sessions || []).forEach(s => {
      const date = weekLabelDateIndex[s.week_label];
      if(!date) return;
      events.push({ uid: `program-${p.id}-${s.session_no}`, start: date, endExclusive: addOneDay(date), summary: `${p.name || 'برنامج'} — جلسة ${s.session_no || ''}` });
    });
  });

  return events;
}

function renderIcs(events){
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shahid//Academic Calendar//AR', 'CALSCALE:GREGORIAN'];
  (events || []).forEach(e => {
    lines.push('BEGIN:VEVENT');
    lines.push(foldIcsLine(`UID:${e.uid}@shahid-app.vercel.app`));
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(e.start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(e.endExclusive)}`);
    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(e.summary)}`));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* ============================================================
   جلب بيانات المستخدم (I/O) — مفصولة عن بناء الأحداث الصرف أعلاه
   ============================================================ */
async function fetchFeedData(userId, supabase){
  const { data: profile } = await supabase.from('profiles').select('calendar_region').eq('id', userId).maybeSingle();
  const region = profile && profile.calendar_region;

  const queries = [
    supabase.from('shawahid').select('id, lesson_title, lesson_date').eq('user_id', userId).not('lesson_date', 'is', null),
    supabase.from('tasks').select('id, title, due_date, done').eq('user_id', userId).not('due_date', 'is', null),
    supabase.from('activity_programs').select('id, name, sessions').eq('user_id', userId),
  ];
  if(region){
    queries.push(
      supabase.from('academic_calendar_weeks').select('week_label, gregorian_date').eq('academic_year', CALENDAR_ACADEMIC_YEAR).eq('region_group', region).order('gregorian_date'),
      supabase.from('academic_calendar_holidays').select('holiday_name, event_label, gregorian_date').eq('academic_year', CALENDAR_ACADEMIC_YEAR).eq('region_group', region)
    );
  }

  const [shRes, tkRes, prRes, weeksRes, holRes] = await Promise.all(queries);

  return {
    shawahid: (shRes && shRes.data) || [],
    tasks: (tkRes && tkRes.data) || [],
    programs: (prRes && prRes.data) || [],
    weeks: (weeksRes && weeksRes.data) || [],
    holidays: (holRes && holRes.data) || [],
  };
}

const AUTH_FAILURE_MESSAGES = {
  missing_token: 'الرابط ناقص — يجب أن يتضمن ?token=... صحيحًا.',
  invalid_token: 'رابط تقويم غير صالح — ولّد رابطًا جديدًا من إعدادات شاهد.',
  revoked_token: 'أُلغي هذا الرابط — ولّد رابطًا جديدًا من إعدادات شاهد.',
  expired_token: 'انتهت صلاحية هذا الرابط — ولّد رابطًا جديدًا من إعدادات شاهد.',
  rate_limited: 'محاولات كثيرة جدًا خلال وقت قصير — حاول لاحقًا.',
  rate_limit_error: 'تعذّر التحقق من حد الاستخدام حاليًا.',
};

async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_ROLE_KEY){
    res.statusCode = 500;
    res.end('الخادم غير مُهيَّأ.');
    return;
  }
  if(req.method !== 'GET' && req.method !== 'HEAD'){
    res.statusCode = 405;
    res.end('الطريقة غير مدعومة.');
    return;
  }

  const url = new URL(req.url, 'http://internal');
  const rawToken = url.searchParams.get('token');

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const auth = await authenticateFeedToken(rawToken, supabase);

  supabase.from('audit_log').insert({
    action: 'calendar_feed_request',
    table_name: 'personal_access_tokens',
    performed_by: auth.userId || auth.ownerId || null,
    details: { outcome: auth.reason }
  }).then(() => {}, () => {});

  if(!auth.userId){
    res.statusCode = auth.reason === 'rate_limited' ? 429 : 401;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(AUTH_FAILURE_MESSAGES[auth.reason] || AUTH_FAILURE_MESSAGES.invalid_token);
    return;
  }

  try{
    const feedData = await fetchFeedData(auth.userId, supabase);
    const events = buildIcsEvents(feedData);
    const ics = renderIcs(events);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(ics);
  } catch(err){
    console.error('Calendar feed error:', err);
    res.statusCode = 500;
    res.end('تعذّر توليد التقويم.');
  }
}

module.exports = handler;
/* مُصدَّرة أيضًا بأسمائها للاختبار الوحدوي (tests/calendar-feed.test.js)
   بحقن عميل Supabase وهمي، بلا أي اتصال شبكي حقيقي */
module.exports.hashToken = hashToken;
module.exports.authenticateFeedToken = authenticateFeedToken;
module.exports.formatIcsDate = formatIcsDate;
module.exports.addOneDay = addOneDay;
module.exports.escapeIcsText = escapeIcsText;
module.exports.foldIcsLine = foldIcsLine;
module.exports.buildWeekLabelDateIndex = buildWeekLabelDateIndex;
module.exports.buildIcsEvents = buildIcsEvents;
module.exports.renderIcs = renderIcs;
module.exports.CALENDAR_FEED_TOKEN_LABEL = CALENDAR_FEED_TOKEN_LABEL;
