/* ============================================================
   موصل الذكاء الاصطناعي (MCP Server) — قراءة فقط
   ============================================================
   يعرض بيانات "خطتي، شواهدي، تقييمي الذاتي" لصاحب الرمز فقط. لا يضيف ولا
   يعدّل أي شيء بقاعدة البيانات — كل الأدوات هنا SELECT فقط.

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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

/* يرجع user_id صاحب الرمز، أو null لو الرمز مفقود/غير صالح/مُلغى.
   لا يرمي خطأ أبدًا — فشل التحقق يعني "غير مصرَّح"، لا خطأ خادم. */
async function authenticate(req, supabase){
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if(!match) return null;
  const raw = match[1].trim();
  if(!raw) return null;

  const { data, error } = await supabase
    .from('personal_access_tokens')
    .select('id, user_id, revoked_at')
    .eq('token_hash', hashToken(raw))
    .maybeSingle();
  if(error || !data || data.revoked_at) return null;

  /* تحديث آخر استخدام — لا ننتظره، مجرد سجلّ إعلامي، فشله لا يوقف الطلب */
  supabase.from('personal_access_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  return data.user_id;
}

function textResult(obj){
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function buildServer(userId, supabase){
  const server = new McpServer({ name: 'shahid-connector', version: '1.0.0' });

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

  return server;
}

function jsonRpcError(res, status, message){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_ROLE_KEY){
    jsonRpcError(res, 500, 'الخادم غير مُهيَّأ: أضف SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY بمتغيرات بيئة Vercel');
    return;
  }

  if(req.method !== 'POST'){
    jsonRpcError(res, 405, 'الطريقة غير مدعومة — هذا موصل بلا حالة، استخدم POST فقط');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const userId = await authenticate(req, supabase);
  if(!userId){
    jsonRpcError(res, 401, 'رمز غير صالح أو ملغى أو مفقود من ترويسة Authorization');
    return;
  }

  try{
    const server = buildServer(userId, supabase);
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
module.exports.buildServer = buildServer;
