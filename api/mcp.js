/* ============================================================
   موصل الذكاء الاصطناعي (MCP Server) — قراءة فقط
   ============================================================
   يعرض بيانات "خطتي، شواهدي، تقييمي الذاتي، وإدارة صفي (طلابي، مخالفاتهم
   السلوكية، حالات ضعفهم الأكاديمي)" لصاحب الرمز فقط. لا يضيف ولا يعدّل أي
   شيء بقاعدة البيانات — أدوات القراءة SELECT فقط (التعديل: رمز خاص، انظر أدناه).

   النطاق: يغطي الموصل أيضًا (قراءة فقط) الدرجات والحضور والواجبات والمهام
   الأدائية وأدوات التقويم والمتابعات والملاحظات والجدول والدروس والبرامج وخطط
   الدروس والمهام الشخصية (المرحلة 1). التعديل (المرحلة 2) محصور برمز
   "قراءة وتعديل" shahid_rw_ وأدوات محدّدة بمعاينة وتأكيد وتدقيق (api/_mcp-write.js).

   تنبيه: أدوات "إدارة الصف" (list_my_students وlist_my_incidents
   وlist_my_academic_cases) تعرض بيانات تخص طلابًا قاصرين لا صاحب الرمز
   نفسه فقط — أُضيفت بطلب صريح من المستخدم بعد تنبيهه على هذا الفرق تحديدًا.

   المصادقة: رمز شخصي (Bearer token) يولّده المعلم من إعدادات شاهد
   ("موصل الذكاء الاصطناعي")، يُخزَّن بالقاعدة كـ SHA-256 hash فقط (لا نص
   صريح)، ونطابقه هنا بنفس الطريقة. الخادم يستخدم مفتاح Supabase الخدمي
   (service role) الذي يتجاوز RLS تمامًا — لذلك **كل استعلام هنا مُقيَّد
   صراحة بـ user_id صاحب الرمز**، ولا نعتمد على RLS إطلاقًا بهذا الملف
   (نفس انضباط "لا تعتمد على RLS وحدها" بقية أرجاء المشروع، وهنا أكثر
   إلزامًا لأن RLS أصلًا متجاوَزة بالكامل بهذا المسار).

   متغيرات البيئة المطلوبة على Vercel (تُضاف يدويًا، لا تُحفظ بالكود):
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY  (مفتاح service_role من إعدادات Supabase —
     سرّي جدًا، لا يظهر بأي كود أو سجلّ)
   ============================================================ */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod/v4');
const { registerWriteTools } = require('./_mcp-write.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* حد الاستخدام: عدد الطلبات المسموحة لكل رمز خلال نافذة زمنية واحدة —
   سخي بما يكفي لاستخدام شخصي حقيقي (عدة أدوات باستدعاء واحد من المساعد
   الذكي)، ضيّق بما يكفي لإيقاف رمز مسروق يُستدعى بحلقة لا نهائية. */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_SECONDS = 300;

/* نفس أدوار STANDALONE_ROLES وcomputeEffectiveElements المعرَّفة بـ
   app/app-01-core.js — منسوخة هنا حرفيًا (لا استيراد، الملف الأصلي كود
   متصفح لا Node) لحساب "أي عناصر أداء مفترَض توثيقها فعليًا" حسب نوع تكليف
   المعلم، بنفس منطق شاشة "حالة التغطية" بالتطبيق. أي تعديل هناك يجب نقله هنا. */
const STANDALONE_ROLES = ['vice_principal', 'school_principal', 'student_counselor', 'lab_technician'];
function computeEffectiveElements(rawElements, forDutyType){
  const duty = forDutyType || 'none';
  if(STANDALONE_ROLES.includes(duty)){
    return (rawElements || []).filter(el => el.required_duty_type === duty);
  }
  const hasDuty = duty !== 'none';
  return (rawElements || [])
    .filter(el => !STANDALONE_ROLES.includes(el.required_duty_type) && (!el.required_duty_type || el.required_duty_type === duty))
    .map(el => {
      const w = (hasDuty && el.weight_with_duty != null) ? el.weight_with_duty : el.weight;
      return Object.assign({}, el, { weight: w });
    });
}

function hashToken(raw){
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/* يستخلص الرمز من الطلب: ترويسة Authorization: Bearer أولًا، وإلا من
   معامل ?key= بالرابط. السبب: خانة "إضافة موصل مخصص" بتطبيقات المساعد تقبل
   عنوان URL فقط ولا تقبل ترويسة — فبدون ?key= لا يستطيع المعلم ربط الموصل
   أصلًا (نفس نهج موصل مصحح). يقبل فقط رموزنا (shahid_pat_…) بالشكل
   الصحيح، ولا يُسجَّل الرابط أبدًا (logMcpAccess لا يخزّن إلا IP والنتيجة). */
const TOKEN_RE = /^shahid_(pat|rw)_[A-Za-z0-9_-]{20,}$/;

/* نوع الرمز يُستنتج من بادئته: shahid_pat_ = قراءة فقط، shahid_rw_ = قراءة وتعديل.
   البادئة جزء من النص المُجزَّأ (SHA-256) فلا يمكن ترقية رمز قراءة لتعديل. */
const WRITE_TOKEN_PREFIX = 'shahid_rw_';

/* رموز رابط التقويم (api/calendar-feed.js) بنفس شكل رمز القراءة shahid_pat_، فيميّزها التصنيف وحده.
   رابط التقويم يُعطى لتطبيقات تقويم خارجية (جوجل/آبل) ويُحفظ عندها كرابط قليل الحساسية،
   فلا يجوز أن يفتح بيانات الطلاب عبر الموصل: يُرفض هنا كأنه رمز غير موجود.
   يجب أن يطابق CALENDAR_FEED_TOKEN_LABEL في api/calendar-feed.js وapp/app-12-calendar.js (اختبار يتحقق). */
const CALENDAR_FEED_TOKEN_LABEL = 'رابط تقويم ICS';
const canWriteToken = raw => typeof raw === 'string' && raw.startsWith(WRITE_TOKEN_PREFIX);
function tokenFrom(req){
  const header = (req.headers && req.headers['authorization']) || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const bearer = m ? m[1].trim() : '';
  if(bearer) return bearer;
  try{
    const key = new URL(req.url || '', 'http://internal').searchParams.get('key') || '';
    return TOKEN_RE.test(key) ? key : '';
  } catch(e){ return ''; }
}

/* يتحقق من رمز الوصول ويرجع نتيجة مفصَّلة (لا user_id مجرَّد) — الحاجة
   لتمييز أسباب الرفض (مفقود/غير صالح/مُلغى/منتهي/تجاوز حد الاستخدام)
   مطلوبة لتسجيل audit_log بدقة، ولإرجاع رمز HTTP صحيح (429 لتجاوز الحد
   بدل 401 العام). لا يرمي خطأ أبدًا — أي حالة رفض تُرجَع لا تُستثنى.
   reason ∈ 'ok' | 'missing_token' | 'invalid_token' | 'revoked_token' |
            'expired_token' | 'rate_limited' | 'rate_limit_error' */
async function authenticate(req, supabase){
  const raw = tokenFrom(req);
  if(!raw) return { userId: null, reason: 'missing_token' };

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .select('id, user_id, label, revoked_at, expires_at')
    .eq('token_hash', hashToken(raw))
    .maybeSingle();
  if(error || !data || data.label === CALENDAR_FEED_TOKEN_LABEL) return { userId: null, reason: 'invalid_token' };
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

  /* تحديث آخر استخدام — لا ننتظره، مجرد سجلّ إعلامي، فشله لا يوقف الطلب */
  supabase.from('personal_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return { userId: data.user_id, reason: 'ok', canWrite: canWriteToken(raw) };
}

/* تسجيل كل محاولة استدعاء (ناجحة أو مرفوضة) بسجلّ التدقيق العام — لا
   ننتظره (fire-and-forget)، فشله لا يوقف الرد على الطلب. */
function logMcpAccess(supabase, req, auth){
  const performedBy = auth.userId || auth.ownerId || null;
  supabase.from('audit_log').insert({
    action: 'mcp_connector_request',
    table_name: 'personal_access_tokens',
    performed_by: performedBy,
    details: {
      outcome: auth.reason,
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null
    }
  }).then(() => {}, () => {});
}

const AUTH_FAILURE_MESSAGES = {
  missing_token: 'رمز غير صالح أو ملغى أو مفقود من ترويسة Authorization',
  invalid_token: 'رمز غير صالح أو ملغى أو مفقود من ترويسة Authorization',
  revoked_token: 'هذا الرمز مُلغى — ولّد رمزًا جديدًا من إعدادات شاهد',
  expired_token: 'هذا الرمز منتهي الصلاحية — ولّد رمزًا جديدًا من إعدادات شاهد',
  rate_limited: 'تجاوزت الحد المسموح من الطلبات لهذا الرمز — حاول بعد قليل',
  rate_limit_error: 'تعذّر التحقق من حد الاستخدام — حاول مرة أخرى'
};

function textResult(obj){
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}


/* ============ مساعدات أدوات "إدارة الصف الشاملة" (المرحلة 1: قراءة فقط) ============
   كل جلب هنا مقيّد صراحة بـ teacher_id/user_id صاحب الرمز (service role يتجاوز
   RLS). الجلب مُرقَّم (1000 صف بالصفحة) لأن Supabase يقصّ أي استعلام بلا
   range عند 1000 صف بصمت — وجداول الدرجات والحضور قد تتجاوزها. */
async function fetchAll(supabase, table, cols, ownerCol, userId){
  const out = [];
  for(let off = 0; ; off += 1000){
    const { data, error } = await supabase.from(table).select(cols)
      .eq(ownerCol, userId)
      .order('id', { ascending: true })
      .range(off, off + 999);
    if(error) throw new Error(error.message);
    out.push(...data);
    if(data.length < 1000 || out.length >= 50000) break;
  }
  return out;
}

/* يلفّ معالج الأداة: أي خطأ يرجع كـ{error} نصي بدل رمي استثناء */
function safeTool(fn){
  return async (args) => {
    try{ return textResult(await fn(args || {})); }
    catch(err){ return textResult({ error: err.message }); }
  };
}

/* خريطتا الطلاب والشعب — لازمتان لتحويل المعرّفات إلى أسماء مقروءة */
async function loadRoster(supabase, userId){
  const [students, sections, levels] = await Promise.all([
    fetchAll(supabase, 'classroom_students', 'id, full_name, student_number, section_id, is_active', 'teacher_id', userId),
    fetchAll(supabase, 'classroom_sections', 'id, name, grade_level_id, academic_year', 'teacher_id', userId),
    fetchAll(supabase, 'classroom_grade_levels', 'id, name', 'teacher_id', userId)
  ]);
  const levelName = new Map(levels.map(l => [l.id, l.name]));
  const sectionById = new Map(sections.map(sec => [sec.id, {
    id: sec.id,
    label: [levelName.get(sec.grade_level_id), sec.name].filter(Boolean).join(' / ') || sec.name,
    academic_year: sec.academic_year
  }]));
  const studentById = new Map(students.map(st => [st.id, st]));
  return { students, sections, levels, sectionById, studentById };
}
const sectionLabel = (roster, id) => (roster.sectionById.get(id) || {}).label || null;
const studentName = (roster, id) => (roster.studentById.get(id) || {}).full_name || null;

/* تطبيع بسيط لمطابقة الأسماء: يتجاهل الهمزات والتشكيل وحالة الحروف */
function normalizeAr(str){
  return String(str || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim();
}
const nameMatches = (full, query) => !query || normalizeAr(full).includes(normalizeAr(query));

function buildServer(userId, supabase, opts){
  const canWrite = !!(opts && opts.canWrite);
  const server = new McpServer({ name: 'shahid-connector', version: '1.1.0' });

  server.registerTool('get_my_profile', {
    title: 'ملفي الشخصي',
    description: 'يعرض الاسم والمدرسة والمادة ونوع التكليف الوظيفي — لصاحب هذا الرمز فقط.'
  }, async () => {
    const { data, error } = await supabase.from('profiles')
      .select('full_name, school, subject, duty_type')
      .eq('id', userId)
      .maybeSingle();
    return textResult(error ? { error: error.message } : (data || {}));
  });

  server.registerTool('get_my_plan', {
    title: 'خطة الأداء السنوية',
    description: 'يعرض خطة الأداء (المستهدفات لكل عنصر أداء) — لصاحب هذا الرمز فقط.',
    inputSchema: {
      cycle_year: z.string().optional().describe('سنة الدورة، مثل 1448-1449. اتركه فارغًا لأحدث سنة مسجَّلة.')
    }
  }, async ({ cycle_year }) => {
    let headerQuery = supabase.from('plan_header')
      .select('cycle_year, role_title, stage, extra_duties')
      .eq('user_id', userId)
      .order('cycle_year', { ascending: false });
    const { data: headers, error: e1 } = await headerQuery;
    if(e1) return textResult({ error: e1.message });

    const year = cycle_year || (headers[0] && headers[0].cycle_year);
    if(!year) return textResult({ header: null, goals: [] });

    const { data: goals, error: e2 } = await supabase.from('performance_goals')
      .select('element_label, goal_order, target_level, target_count, personal_note, target_performance')
      .eq('user_id', userId)
      .eq('cycle_year', year)
      .order('goal_order', { ascending: true });
    if(e2) return textResult({ error: e2.message });

    return textResult({ header: headers.find(h => h.cycle_year === year) || null, goals });
  });

  server.registerTool('list_my_shawahid', {
    title: 'شواهدي',
    description: 'يعرض شواهد الأداء الموثّقة، من الأحدث للأقدم — لصاحب هذا الرمز فقط. يتضمن الرد total_count (إجمالي المطابق فعليًا بالقاعدة) لأن النتائج قد تكون مقصوصة بحد limit — لا تفترض أن طول القائمة المُرجَعة هو العدد الكلي، اعتمد على total_count دومًا عند حساب أي عدّ إجمالي.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('الحد الأقصى لعدد العناصر المُرجَعة بالتفصيل، افتراضيًا 20 — لا يؤثر على total_count'),
      element_key: z.string().optional().describe('فلترة بعنصر أداء معيّن (اختياري)')
    }
  }, async ({ limit, element_key }) => {
    let countQuery = supabase.from('shawahid').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if(element_key) countQuery = countQuery.eq('element_key', element_key);
    const { count, error: eCount } = await countQuery;
    if(eCount) return textResult({ error: eCount.message });

    let q = supabase.from('shawahid')
      .select('lesson_title, element_label, lesson_date, description, quant_impact, qual_impact, reflection, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit || 20, 100));
    if(element_key) q = q.eq('element_key', element_key);
    const { data, error } = await q;
    if(error) return textResult({ error: error.message });

    return textResult({ total_count: count, returned_count: data.length, items: data });
  });

  server.registerTool('get_my_coverage_summary', {
    title: 'ملخص تغطية عناصر الأداء',
    description: 'يعرض كل عنصر أداء مفترَض توثيقه (حسب نوع تكليف هذا المعلم)، وعدد شواهده الفعلي لكل عنصر، وهل هو "مغطى" (عنده شاهد واحد على الأقل) أو لا — الطريقة الصحيحة للإجابة عن أسئلة العدّ الإجمالي أو "أي العناصر ينقصها توثيق"، بدل عدّ يدوي من list_my_shawahid.'
  }, async () => {
    const { data: profile, error: eProfile } = await supabase.from('profiles')
      .select('duty_type').eq('id', userId).maybeSingle();
    if(eProfile) return textResult({ error: eProfile.message });

    const { data: rawElements, error: eElements } = await supabase.from('performance_elements')
      .select('key, label, weight, weight_with_duty, required_duty_type')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if(eElements) return textResult({ error: eElements.message });

    const effectiveElements = computeEffectiveElements(rawElements, (profile && profile.duty_type) || 'none');

    const { data: shawahid, error: eShawahid } = await supabase.from('shawahid')
      .select('element_key').eq('user_id', userId);
    if(eShawahid) return textResult({ error: eShawahid.message });

    const countByKey = new Map();
    for(const s of shawahid) countByKey.set(s.element_key, (countByKey.get(s.element_key) || 0) + 1);

    const elements = effectiveElements.map(el => ({
      label: el.label,
      weight: el.weight,
      shawahid_count: countByKey.get(el.key) || 0,
      covered: (countByKey.get(el.key) || 0) > 0
    }));

    return textResult({
      total_shawahid: shawahid.length,
      total_elements: elements.length,
      covered_elements: elements.filter(e => e.covered).length,
      elements
    });
  });

  server.registerTool('get_my_self_assessment', {
    title: 'تقييمي الذاتي',
    description: 'يعرض التقييم الذاتي لكل عنصر أداء — لصاحب هذا الرمز فقط.',
    inputSchema: {
      cycle_year: z.string().optional().describe('سنة الدورة. اتركه فارغًا لكل السنوات.')
    }
  }, async ({ cycle_year }) => {
    let q = supabase.from('self_assessment')
      .select('cycle_year, element_label, self_level, self_note')
      .eq('user_id', userId)
      .order('cycle_year', { ascending: false });
    if(cycle_year) q = q.eq('cycle_year', cycle_year);
    const { data, error } = await q;
    return textResult(error ? { error: error.message } : data);
  });

  /* ============ إدارة الصف — بيانات طلاب قاصرين، أضيفت بطلب صريح من
     المستخدم بعد تنبيهه على حساسيتها الإضافية مقارنة ببيانات أدائه الشخصية.
     كل أداة هنا مُقيَّدة بـteacher_id صاحب الرمز بنفس الانضباط. ============ */

  server.registerTool('list_my_students', {
    title: 'طلابي',
    description: 'يعرض قائمة طلاب هذا المعلم بإدارة الصف — لصاحب هذا الرمز فقط. بيانات طلاب قاصرين، تعامل معها بحساسية.',
    inputSchema: {
      academic_year: z.string().optional().describe('فلترة بعام دراسي معيّن (اختياري)'),
      active_only: z.boolean().optional().describe('إظهار الطلاب النشطين فقط فقط — افتراضيًا true')
    }
  }, async ({ academic_year, active_only }) => {
    let q = supabase.from('classroom_students')
      .select('full_name, student_number, grade_level, section_number, academic_year, is_active')
      .eq('teacher_id', userId)
      .order('full_name', { ascending: true });
    if(academic_year) q = q.eq('academic_year', academic_year);
    if(active_only !== false) q = q.eq('is_active', true);
    const { data, error } = await q;
    return textResult(error ? { error: error.message } : { total_count: data.length, students: data });
  });

  server.registerTool('list_my_incidents', {
    title: 'المخالفات السلوكية المسجَّلة',
    description: 'يعرض المخالفات السلوكية التي سجّلها هذا المعلم لطلابه — لصاحب هذا الرمز فقط. بيانات حساسة تخص طلابًا قاصرين، تعامل معها بحساسية. يتضمن total_count لأن النتائج قد تكون مقصوصة بحد limit.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).optional().describe('الحد الأقصى لعدد النتائج، افتراضيًا 20'),
      semester_label: z.string().optional().describe('فلترة بفصل دراسي معيّن (اختياري)')
    }
  }, async ({ limit, semester_label }) => {
    let countQuery = supabase.from('classroom_incidents').select('*', { count: 'exact', head: true }).eq('teacher_id', userId);
    if(semester_label) countQuery = countQuery.eq('semester_label', semester_label);
    const { count, error: eCount } = await countQuery;
    if(eCount) return textResult({ error: eCount.message });

    let q = supabase.from('classroom_incidents')
      .select('incident_date, semester_label, occurrence_number, current_stage, notes, classroom_students(full_name), classroom_incident_types(problem_name, problem_degree)')
      .eq('teacher_id', userId)
      .order('incident_date', { ascending: false })
      .limit(Math.min(limit || 20, 100));
    if(semester_label) q = q.eq('semester_label', semester_label);
    const { data, error } = await q;
    if(error) return textResult({ error: error.message });

    const items = data.map(r => ({
      student_name: r.classroom_students && r.classroom_students.full_name,
      problem_name: r.classroom_incident_types && r.classroom_incident_types.problem_name,
      problem_degree: r.classroom_incident_types && r.classroom_incident_types.problem_degree,
      incident_date: r.incident_date,
      semester_label: r.semester_label,
      occurrence_number: r.occurrence_number,
      current_stage: r.current_stage,
      notes: r.notes
    }));

    return textResult({ total_count: count, returned_count: items.length, items });
  });

  server.registerTool('list_my_academic_cases', {
    title: 'حالات الضعف الأكاديمي',
    description: 'يعرض حالات الضعف الأكاديمي وخطط العلاج التي سجّلها هذا المعلم لطلابه — لصاحب هذا الرمز فقط. بيانات حساسة تخص طلابًا قاصرين، تعامل معها بحساسية.',
    inputSchema: {
      status: z.enum(['plan_active', 'referred']).optional().describe('فلترة بحالة المتابعة (اختياري)')
    }
  }, async ({ status }) => {
    let q = supabase.from('academic_cases')
      .select('subject, weakness_description, plan_description, plan_started_at, academic_year, status, session_type, classroom_students(full_name)')
      .eq('teacher_id', userId)
      .order('plan_started_at', { ascending: false });
    if(status) q = q.eq('status', status);
    const { data, error } = await q;
    if(error) return textResult({ error: error.message });

    const items = data.map(r => ({
      student_name: r.classroom_students && r.classroom_students.full_name,
      subject: r.subject,
      weakness_description: r.weakness_description,
      plan_description: r.plan_description,
      plan_started_at: r.plan_started_at,
      academic_year: r.academic_year,
      status: r.status,
      session_type: r.session_type
    }));

    return textResult({ total_count: items.length, items });
  });

  /* ============ المرحلة 1 (توسعة الموصل): قراءة شاملة لباقي إدارة الصف —
     الدرجات، الحضور، الواجبات، المهام، المتابعات، الملاحظات، الدروس، البرامج.
     قراءة فقط. بيانات طلاب قاصرين: نفس التنبيه والانضباط (teacher_id صريح). ============ */

  const SENSITIVE = ' بيانات حساسة تخص طلابًا قاصرين، تعامل معها بحساسية.';

  server.registerTool('get_my_overview', {
    title: 'نظرة شاملة على بياناتي',
    description: 'ابدأ بهذه الأداة: أعداد كل ما يملكه هذا المعلم (طلاب، شعب، أعمدة درجات، دروس، سجلات حضور، واجبات، مهام، متابعات، برامج، شواهد، خطط دروس) لتعرف أي أداة تستدعي بعدها. لصاحب هذا الرمز فقط.'
  }, safeTool(async () => {
    const count = async (table, col) => {
      const { count: c, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(col, userId);
      if(error) throw new Error(error.message);
      return c;
    };
    const [students, sections, grade_columns, lessons, attendance_records, homework, class_tasks, followups, programs, shawahid, lesson_plans, personal_tasks] = await Promise.all([
      count('classroom_students', 'teacher_id'), count('classroom_sections', 'teacher_id'),
      count('classroom_grade_columns', 'teacher_id'), count('classroom_lessons', 'teacher_id'),
      count('classroom_attendance', 'teacher_id'), count('classroom_homework', 'teacher_id'),
      count('classroom_tasks', 'teacher_id'), count('classroom_followups', 'teacher_id'),
      count('activity_programs', 'user_id'), count('shawahid', 'user_id'),
      count('lesson_plans', 'user_id'), count('tasks', 'user_id')
    ]);
    return { students, sections, grade_columns, lessons, attendance_records, homework, class_tasks, followups, programs, shawahid, lesson_plans, personal_tasks };
  }));

  server.registerTool('list_my_sections', {
    title: 'شعبي وصفوفي',
    description: 'يعرض الصفوف والشعب مع عدد الطلاب النشطين في كل شعبة. استعمل section_id من هنا لفلترة أدوات الدرجات والحضور والواجبات والمهام.',
  }, safeTool(async () => {
    const roster = await loadRoster(supabase, userId);
    return {
      total_count: roster.sections.length,
      sections: roster.sections.map(sec => ({
        section_id: sec.id,
        label: sectionLabel(roster, sec.id),
        academic_year: sec.academic_year,
        active_students: roster.students.filter(st => st.section_id === sec.id && st.is_active).length
      }))
    };
  }));

  server.registerTool('list_my_grades', {
    title: 'درجات طلابي',
    description: 'يعرض أعمدة الدرجات (اختبارات، مشاركة، واجبات...) مع إحصاءات كل عمود، ودرجات كل طالب إن مُرِّر section_id أو include_scores=true. يتضمن raw_sum/raw_max لكل طالب: مجموع درجاته الخام ومجموع الدرجات العظمى للأعمدة التي لها درجة عنده — ليست الدرجة النهائية الموزونة بالتطبيق، لا تعتمد عليها كنتيجة رسمية.' + SENSITIVE,
    inputSchema: {
      section_id: z.string().optional().describe('معرّف الشعبة من list_my_sections (اختياري)'),
      semester: z.string().optional().describe('الفصل الدراسي (اختياري)'),
      academic_year: z.string().optional().describe('العام الدراسي (اختياري)'),
      student_name: z.string().optional().describe('فلترة بالاسم أو جزء منه (اختياري)'),
      include_scores: z.boolean().optional().describe('إدراج درجات كل طالب بالتفصيل — افتراضيًا true فقط عند تحديد section_id أو student_name')
    }
  }, safeTool(async ({ section_id, semester, academic_year, student_name, include_scores }) => {
    const roster = await loadRoster(supabase, userId);
    let columns = await fetchAll(supabase, 'classroom_grade_columns', 'id, section_id, academic_year, semester, category, name, max_score, kind, counted_periods, position', 'teacher_id', userId);
    if(section_id) columns = columns.filter(c => c.section_id === section_id);
    if(semester) columns = columns.filter(c => String(c.semester) === String(semester));
    if(academic_year) columns = columns.filter(c => c.academic_year === academic_year);
    columns.sort((a, b) => (a.position || 0) - (b.position || 0));
    const colIds = new Set(columns.map(c => c.id));
    const detail = include_scores != null ? include_scores : !!(section_id || student_name);

    const scores = (await fetchAll(supabase, 'classroom_grade_scores', 'id, column_id, student_id, score', 'teacher_id', userId)).filter(r => colIds.has(r.column_id));
    const periodScores = detail ? (await fetchAll(supabase, 'classroom_grade_period_scores', 'id, column_id, student_id, period, score', 'teacher_id', userId)).filter(r => colIds.has(r.column_id)) : [];

    const byCol = new Map();
    scores.forEach(r => { if(!byCol.has(r.column_id)) byCol.set(r.column_id, []); byCol.get(r.column_id).push(r); });

    const colOut = columns.map(c => {
      const rows = (byCol.get(c.id) || []).filter(r => r.score != null);
      const nums = rows.map(r => Number(r.score));
      const item = {
        name: c.name, category: c.category, kind: c.kind, semester: c.semester, academic_year: c.academic_year,
        section: sectionLabel(roster, c.section_id), max_score: c.max_score,
        scored_count: nums.length,
        average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null
      };
      if(detail){
        item.scores = (byCol.get(c.id) || [])
          .filter(r => nameMatches(studentName(roster, r.student_id), student_name))
          .map(r => ({ student: studentName(roster, r.student_id), score: r.score }));
        const ps = periodScores.filter(r => r.column_id === c.id && nameMatches(studentName(roster, r.student_id), student_name));
        if(ps.length) item.period_scores = ps.map(r => ({ student: studentName(roster, r.student_id), period: r.period, score: r.score }));
      }
      return item;
    });

    const result = { total_columns: colOut.length, columns: colOut };
    if(detail){
      const totals = new Map();
      for(const c of columns){
        for(const r of (byCol.get(c.id) || [])){
          if(r.score == null || !nameMatches(studentName(roster, r.student_id), student_name)) continue;
          const t = totals.get(r.student_id) || { student: studentName(roster, r.student_id), raw_sum: 0, raw_max: 0 };
          t.raw_sum += Number(r.score); t.raw_max += Number(c.max_score || 0);
          totals.set(r.student_id, t);
        }
      }
      result.student_raw_totals = Array.from(totals.values());
    }
    return result;
  }));

  server.registerTool('list_my_attendance', {
    title: 'الحضور والغياب',
    description: 'يعرض سجلات الغياب/التأخر/الاستئذان المسجّلة، وملخصًا لكل طالب. الطالب الذي لا سجل له في حصة يُعدّ حاضرًا (التطبيق يخزّن غير الحاضر فقط). total_records هو العدد الفعلي بعد الفلترة قبل قصّ limit.' + SENSITIVE,
    inputSchema: {
      section_id: z.string().optional().describe('معرّف الشعبة (اختياري)'),
      from_date: z.string().optional().describe('من تاريخ YYYY-MM-DD (اختياري)'),
      to_date: z.string().optional().describe('إلى تاريخ YYYY-MM-DD (اختياري)'),
      student_name: z.string().optional().describe('اسم الطالب أو جزء منه (اختياري)'),
      status: z.string().optional().describe('absent | late | permitted_exit (اختياري)'),
      limit: z.number().int().min(1).max(200).optional().describe('الحد الأقصى للسجلات التفصيلية، افتراضيًا 50 — لا يؤثر على الملخص')
    }
  }, safeTool(async ({ section_id, from_date, to_date, student_name, status, limit }) => {
    const roster = await loadRoster(supabase, userId);
    let lessons = await fetchAll(supabase, 'classroom_lessons', 'id, section_id, lesson_date, period', 'teacher_id', userId);
    if(section_id) lessons = lessons.filter(l => l.section_id === section_id);
    if(from_date) lessons = lessons.filter(l => l.lesson_date >= from_date);
    if(to_date) lessons = lessons.filter(l => l.lesson_date <= to_date);
    const lessonById = new Map(lessons.map(l => [l.id, l]));

    let rows = (await fetchAll(supabase, 'classroom_attendance', 'id, lesson_id, student_id, status', 'teacher_id', userId)).filter(r => lessonById.has(r.lesson_id));
    if(status) rows = rows.filter(r => r.status === status);
    rows = rows.filter(r => nameMatches(studentName(roster, r.student_id), student_name));

    const perStudent = new Map();
    rows.forEach(r => {
      const t = perStudent.get(r.student_id) || { student: studentName(roster, r.student_id), absent: 0, late: 0, permitted_exit: 0, other: 0 };
      if(['absent', 'late', 'permitted_exit'].includes(r.status)) t[r.status]++; else t.other++;
      perStudent.set(r.student_id, t);
    });

    const detailed = rows.map(r => {
      const l = lessonById.get(r.lesson_id);
      return { date: l.lesson_date, period: l.period, section: sectionLabel(roster, l.section_id), student: studentName(roster, r.student_id), status: r.status };
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      lessons_in_range: lessons.length,
      total_records: rows.length,
      returned_count: Math.min(detailed.length, limit || 50),
      per_student_summary: Array.from(perStudent.values()).sort((a, b) => b.absent - a.absent),
      records: detailed.slice(0, limit || 50)
    };
  }));

  server.registerTool('list_my_homework', {
    title: 'الواجبات وتسليمها',
    description: 'يعرض واجبات المعلم مع حالة تسليم كل طالب (submitted/partial/late أو لا سجل = لم يُسلَّم) وملخصًا لكل واجب.' + SENSITIVE,
    inputSchema: {
      section_id: z.string().optional().describe('معرّف الشعبة (اختياري)'),
      semester: z.string().optional().describe('الفصل (اختياري)')
    }
  }, safeTool(async ({ section_id, semester }) => {
    const roster = await loadRoster(supabase, userId);
    let hw = await fetchAll(supabase, 'classroom_homework', 'id, section_id, academic_year, semester, title, due_date', 'teacher_id', userId);
    if(section_id) hw = hw.filter(h => h.section_id === section_id);
    if(semester) hw = hw.filter(h => String(h.semester) === String(semester));
    const ids = new Set(hw.map(h => h.id));
    const statuses = (await fetchAll(supabase, 'classroom_homework_status', 'id, homework_id, student_id, status', 'teacher_id', userId)).filter(r => ids.has(r.homework_id));
    const items = hw.sort((a, b) => (a.due_date < b.due_date ? 1 : -1)).map(h => {
      const rows = statuses.filter(r => r.homework_id === h.id);
      const summary = {};
      rows.forEach(r => { summary[r.status] = (summary[r.status] || 0) + 1; });
      return { title: h.title, due_date: h.due_date, semester: h.semester, section: sectionLabel(roster, h.section_id), status_summary: summary, students: rows.map(r => ({ student: studentName(roster, r.student_id), status: r.status })) };
    });
    return { total_count: items.length, items };
  }));

  server.registerTool('list_my_class_tasks', {
    title: 'المهام الأدائية للطلاب',
    description: 'يعرض المهام الأدائية الصفية (classroom_tasks) مع درجة كل طالب فيها. ليست المهام الشخصية للمعلم (تلك list_my_personal_tasks).' + SENSITIVE,
    inputSchema: { section_id: z.string().optional().describe('معرّف الشعبة (اختياري)'), semester: z.string().optional().describe('الفصل (اختياري)') }
  }, safeTool(async ({ section_id, semester }) => {
    const roster = await loadRoster(supabase, userId);
    let tasks = await fetchAll(supabase, 'classroom_tasks', 'id, section_id, academic_year, semester, title, description, max_score, due_date', 'teacher_id', userId);
    if(section_id) tasks = tasks.filter(t => t.section_id === section_id);
    if(semester) tasks = tasks.filter(t => String(t.semester) === String(semester));
    const ids = new Set(tasks.map(t => t.id));
    const scores = (await fetchAll(supabase, 'classroom_task_students', 'id, task_id, student_id, score, group_no', 'teacher_id', userId)).filter(r => ids.has(r.task_id));
    return {
      total_count: tasks.length,
      items: tasks.map(t => ({
        title: t.title, description: t.description, max_score: t.max_score, due_date: t.due_date, semester: t.semester, section: sectionLabel(roster, t.section_id),
        students: scores.filter(r => r.task_id === t.id).map(r => ({ student: studentName(roster, r.student_id), score: r.score, group_no: r.group_no }))
      }))
    };
  }));

  server.registerTool('list_my_tool_marks', {
    title: 'أدوات التقويم والمشاركة',
    description: 'يعرض أدوات التقويم المخصصة (مشاركة، سلوك...) وعلاماتها لكل طالب بالتاريخ والحصة.' + SENSITIVE,
    inputSchema: {
      section_id: z.string().optional().describe('معرّف الشعبة (اختياري)'),
      student_name: z.string().optional().describe('اسم الطالب أو جزء منه (اختياري)'),
      limit: z.number().int().min(1).max(200).optional().describe('الحد الأقصى للعلامات التفصيلية، افتراضيًا 50')
    }
  }, safeTool(async ({ section_id, student_name, limit }) => {
    const roster = await loadRoster(supabase, userId);
    const tools = await fetchAll(supabase, 'classroom_custom_tools', 'id, name, tool_type, category, max_score, hidden', 'teacher_id', userId);
    const toolById = new Map(tools.map(t => [t.id, t]));
    let marks = await fetchAll(supabase, 'classroom_tool_marks', 'id, tool_id, student_id, section_id, semester, mark_date, period, value', 'teacher_id', userId);
    if(section_id) marks = marks.filter(m => m.section_id === section_id);
    marks = marks.filter(m => nameMatches(studentName(roster, m.student_id), student_name));
    marks.sort((a, b) => (a.mark_date < b.mark_date ? 1 : a.mark_date > b.mark_date ? -1 : 0));
    return {
      tools: tools.map(t => ({ name: t.name, tool_type: t.tool_type, category: t.category, max_score: t.max_score, hidden: t.hidden })),
      total_marks: marks.length,
      returned_count: Math.min(marks.length, limit || 50),
      marks: marks.slice(0, limit || 50).map(m => ({ tool: (toolById.get(m.tool_id) || {}).name || null, student: studentName(roster, m.student_id), date: m.mark_date, period: m.period, value: m.value, section: sectionLabel(roster, m.section_id) }))
    };
  }));

  server.registerTool('list_my_followups', {
    title: 'المتابعات وإجراءاتها',
    description: 'يعرض متابعات الطلاب (غياب، تأخر، سلوك، درجات...) مع حالتها ونتيجتها والإجراءات المتخذة لكل متابعة.' + SENSITIVE,
    inputSchema: {
      status: z.string().optional().describe('فلترة بالحالة (اختياري)'),
      student_name: z.string().optional().describe('اسم الطالب أو جزء منه (اختياري)')
    }
  }, safeTool(async ({ status, student_name }) => {
    const roster = await loadRoster(supabase, userId);
    let fu = await fetchAll(supabase, 'classroom_followups', 'id, student_id, section_id, reason_type, reason_text, baseline, review_date, status, outcome, result, next_step, closed_at, created_at', 'teacher_id', userId);
    if(status) fu = fu.filter(f => f.status === status);
    fu = fu.filter(f => nameMatches(studentName(roster, f.student_id), student_name));
    const ids = new Set(fu.map(f => f.id));
    const actions = (await fetchAll(supabase, 'classroom_followup_actions', 'id, followup_id, action_type, note, action_date', 'teacher_id', userId)).filter(a => ids.has(a.followup_id));
    return {
      total_count: fu.length,
      items: fu.map(f => ({
        student: studentName(roster, f.student_id), section: sectionLabel(roster, f.section_id), reason_type: f.reason_type, reason_text: f.reason_text,
        baseline: f.baseline, review_date: f.review_date, status: f.status, outcome: f.outcome, result: f.result, next_step: f.next_step, created_at: f.created_at, closed_at: f.closed_at,
        actions: actions.filter(a => a.followup_id === f.id).map(a => ({ action_type: a.action_type, note: a.note, action_date: a.action_date }))
      }))
    };
  }));

  server.registerTool('list_my_notes', {
    title: 'ملاحظات الطلاب',
    description: 'يعرض الملاحظات الإيجابية على الطلاب. الملاحظات الخاصة (سرّية للمعلم) لا تُعرض إلا إن مُرِّر include_private=true صراحةً.' + SENSITIVE,
    inputSchema: {
      student_name: z.string().optional().describe('اسم الطالب أو جزء منه (اختياري)'),
      include_private: z.boolean().optional().describe('إدراج الملاحظات الخاصة — افتراضيًا false')
    }
  }, safeTool(async ({ student_name, include_private }) => {
    const roster = await loadRoster(supabase, userId);
    const positive = (await fetchAll(supabase, 'classroom_positive_notes', 'id, student_id, section_id, note_date, note_text', 'teacher_id', userId))
      .filter(n => nameMatches(studentName(roster, n.student_id), student_name))
      .sort((a, b) => (a.note_date < b.note_date ? 1 : -1))
      .map(n => ({ student: studentName(roster, n.student_id), section: sectionLabel(roster, n.section_id), date: n.note_date, note: n.note_text }));
    const out = { positive_count: positive.length, positive_notes: positive };
    if(include_private){
      const priv = (await fetchAll(supabase, 'classroom_private_notes', 'id, student_id, body, created_at', 'teacher_id', userId))
        .filter(n => nameMatches(studentName(roster, n.student_id), student_name))
        .map(n => ({ student: studentName(roster, n.student_id), created_at: n.created_at, note: n.body }));
      out.private_count = priv.length; out.private_notes = priv;
    }
    return out;
  }));

  server.registerTool('get_my_timetable', {
    title: 'جدولي الدراسي',
    description: 'يعرض الجدول الأسبوعي (اليوم والحصة والشعبة) ودروس الأيام الأخيرة المسجَّلة.',
    inputSchema: { lessons_limit: z.number().int().min(1).max(100).optional().describe('عدد الدروس المسجَّلة الأحدث، افتراضيًا 20') }
  }, safeTool(async ({ lessons_limit }) => {
    const roster = await loadRoster(supabase, userId);
    const slots = await fetchAll(supabase, 'classroom_timetable_slots', 'id, section_id, academic_year, semester, weekday, period', 'teacher_id', userId);
    const lessons = (await fetchAll(supabase, 'classroom_lessons', 'id, section_id, lesson_date, period', 'teacher_id', userId))
      .sort((a, b) => (a.lesson_date < b.lesson_date ? 1 : a.lesson_date > b.lesson_date ? -1 : 0));
    return {
      weekly_slots: slots.map(s => ({ weekday: s.weekday, period: s.period, semester: s.semester, academic_year: s.academic_year, section: sectionLabel(roster, s.section_id) })),
      lessons_total: lessons.length,
      recent_lessons: lessons.slice(0, lessons_limit || 20).map(l => ({ date: l.lesson_date, period: l.period, section: sectionLabel(roster, l.section_id) }))
    };
  }));

  server.registerTool('list_my_programs', {
    title: 'برامج الأنشطة',
    description: 'يعرض برامج الأنشطة (الاسم، عدد الجلسات والطلاب، عنصر الأداء المرتبط، سنة الدورة، جلسات البرنامج).',
    inputSchema: { cycle_year: z.string().optional().describe('سنة الدورة (اختياري)') }
  }, safeTool(async ({ cycle_year }) => {
    let rows = await fetchAll(supabase, 'activity_programs', 'id, name, total_sessions, student_count, element_key, cycle_year, sessions, created_at', 'user_id', userId);
    if(cycle_year) rows = rows.filter(r => r.cycle_year === cycle_year);
    return { total_count: rows.length, items: rows.map(r => ({ name: r.name, total_sessions: r.total_sessions, student_count: r.student_count, element_key: r.element_key, cycle_year: r.cycle_year, sessions: r.sessions })) };
  }));

  server.registerTool('list_my_lesson_plans', {
    title: 'خطط دروسي',
    description: 'يعرض خطط الدروس (العنوان، الهدف، الخطوات، التاريخ المخطَّط، الحالة planned/done).',
    inputSchema: { status: z.enum(['planned', 'done']).optional().describe('فلترة بالحالة (اختياري)') }
  }, safeTool(async ({ status }) => {
    let rows = await fetchAll(supabase, 'lesson_plans', 'id, element_key, template_name, title, description, goal, steps, planned_date, period, status', 'user_id', userId);
    if(status) rows = rows.filter(r => r.status === status);
    rows.sort((a, b) => (a.planned_date < b.planned_date ? 1 : -1));
    return { total_count: rows.length, items: rows.map(r => ({ title: r.title, goal: r.goal, description: r.description, steps: r.steps, planned_date: r.planned_date, period: r.period, status: r.status, element_key: r.element_key })) };
  }));

  server.registerTool('list_my_personal_tasks', {
    title: 'مهامي الشخصية',
    description: 'يعرض مهام المعلم الشخصية (العنوان، الأولوية، تاريخ الاستحقاق، منجزة أم لا) — وليست المهام الأدائية للطلاب.',
    inputSchema: { done: z.boolean().optional().describe('فلترة بالمنجز/غير المنجز (اختياري)') }
  }, safeTool(async ({ done }) => {
    let rows = await fetchAll(supabase, 'tasks', 'id, title, description, priority, due_date, done', 'user_id', userId);
    if(done != null) rows = rows.filter(r => r.done === done);
    return { total_count: rows.length, items: rows.map(r => ({ title: r.title, description: r.description, priority: r.priority, due_date: r.due_date, done: r.done })) };
  }));

  /* المرحلة 2: أدوات التعديل — تُسجَّل فقط لرمز "قراءة وتعديل" (shahid_rw_) */
  if(canWrite){
    registerWriteTools(server, { userId, supabase, z, textResult, fetchAll, loadRoster, normalizeAr, sectionLabel, signKey: SERVICE_ROLE_KEY });
  }

  return server;
}

function jsonRpcError(res, status, message){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function handler(req, res){
  /* CORS مفتوح مقبول: الدخول برمز (ترويسة أو ?key=) لا بكوكي، فلا يستفيد
     موقع آخر من جلسة المعلم. نردّ على OPTIONS قبل أي فحص للبيئة/الرمز. */
  Object.keys(CORS_HEADERS).forEach(k => res.setHeader(k, CORS_HEADERS[k]));
  if(req.method === 'OPTIONS'){
    res.statusCode = 204;
    res.end();
    return;
  }

  if(!SUPABASE_URL || !SERVICE_ROLE_KEY){
    jsonRpcError(res, 500, 'الخادم غير مُهيَّأ: أضف SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY بمتغيرات بيئة Vercel');
    return;
  }

  if(req.method !== 'POST'){
    jsonRpcError(res, 405, 'الطريقة غير مدعومة — هذا موصل بلا حالة، استخدم POST فقط');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const auth = await authenticate(req, supabase);
  logMcpAccess(supabase, req, auth);

  if(!auth.userId){
    const status = auth.reason === 'rate_limited' ? 429 : 401;
    jsonRpcError(res, status, AUTH_FAILURE_MESSAGES[auth.reason] || AUTH_FAILURE_MESSAGES.invalid_token);
    return;
  }

  try{
    const server = buildServer(auth.userId, supabase, { canWrite: auth.canWrite });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch(err){
    console.error('MCP request error:', err);
    if(!res.headersSent) jsonRpcError(res, 500, 'خطأ داخلي بالخادم');
  }
}

module.exports = handler;
/* مُصدَّرة أيضًا بأسمائها للاختبار الوحدوي (tests/mcp-connector.test.js)
   بحقن عميل Supabase وهمي، بلا أي اتصال شبكي حقيقي */
module.exports.hashToken = hashToken;
module.exports.authenticate = authenticate;
module.exports.tokenFrom = tokenFrom;
module.exports.canWriteToken = canWriteToken;
module.exports.CALENDAR_FEED_TOKEN_LABEL = CALENDAR_FEED_TOKEN_LABEL;
module.exports.buildServer = buildServer;
