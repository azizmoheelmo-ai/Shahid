/* ============================================================
   رابط قصير لتقرير الطالب: /r/<رمز>  ←  الملف في التخزين الخاص
   ------------------------------------------------------------
   بدل رابط Supabase الموقَّع الطويل (مئات الأحرف) نُرسل لولي الأمر رابطًا قصيرًا على نطاق التطبيق نفسه.
   الصفحة تقرأ سجل student_report_shares بالرمز، فإن لم ينتهِ تُنشئ رابطًا موقَّعًا قصير العمر (60 ثانية)
   للملف وتحوّل المتصفح إليه (302). الصلاحية الحقيقية = expires_at بالسجل (ليس عمر الرابط الموقَّع).
   - الرمز عشوائي طويل غير قابل للتخمين (14 حرفًا من 31 = ≈70 بتًا)، ويُلغى بحذف السجل أو بانتهائه.
   - لا يُكشف سبب الرفض: «غير موجود» و«انتهى» بنفس الرد.
   - لا تخزين مؤقت، ولا فهرسة، ولا إرسال Referer.
   - مفتاح service_role يتجاوز RLS، فالقراءة هنا بالرمز وحده ومن جدول واحد؛ لا شيء غير ذلك.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/mcp.js).
   ============================================================ */


const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHARE_BUCKET = 'report-shares';
const CODE_RE = /^[a-z2-9]{12,32}$/;
const SIGNED_URL_SECONDS = 60;

function page(title, message){
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>`
    + '<style>body{font-family:system-ui,sans-serif;background:#F6F4EE;color:#1B3245;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}div{max-width:380px;line-height:1.9}</style></head>'
    + `<body><div><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/* يرجع { ok: true, path } أو { ok: false }؛ لا يميّز بين الرمز الخاطئ والمنتهي */
async function resolveShare(code, supabase, now){
  if(typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false };
  const { data, error } = await supabase.from('student_report_shares')
    .select('object_path, expires_at').eq('short_code', code).maybeSingle();
  if(error || !data || !data.object_path) return { ok: false };
  if(new Date(data.expires_at).getTime() <= (now || Date.now())) return { ok: false };
  return { ok: true, path: data.object_path };
}

function send(res, status, body){
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.send(body);
}

async function handler(req, res){
  if(req.method !== 'GET' && req.method !== 'HEAD'){ res.setHeader('Allow', 'GET, HEAD'); return send(res, 405, ''); }
  if(!SUPABASE_URL || !SERVICE_ROLE_KEY) return send(res, 500, page('الخدمة غير مهيّأة', 'حاول لاحقًا.'));
  const raw = req.query && req.query.c;
  const code = Array.isArray(raw) ? raw[0] : raw;
  const { createClient } = require('@supabase/supabase-js'); /* هنا لا بأعلى الملف: دوال الملف الصرفة تُختبر بلا الحزمة */
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const found = await resolveShare(code, supabase);
  const gone = () => send(res, 404, page('الرابط غير صالح', 'انتهت صلاحية هذا الرابط أو أنه غير صحيح. اطلب من المعلم إرسال رابط جديد.'));
  if(!found.ok) return gone();
  const { data, error } = await supabase.storage.from(SHARE_BUCKET).createSignedUrl(found.path, SIGNED_URL_SECONDS);
  if(error || !data || !data.signedUrl) return gone();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, data.signedUrl);
}

module.exports = handler;
module.exports.resolveShare = resolveShare;
module.exports.CODE_RE = CODE_RE;
