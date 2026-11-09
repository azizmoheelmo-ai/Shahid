/* ============================================================
   استبانة رضا المستفيدين: /s/<رمز>  (التصميم: SURVEYS.md)
   ------------------------------------------------------------
   GET  يعرض نموذج الاستبانة (لا يستهلك التذكرة؛ معاينة واتساب للرابط آمنة).
   POST يستقبل الرد (JSON) ويمرّره للدالة الذرّية submit_survey بمفتاح service_role.
   - الصفحة مبهمة: لا اسم طالب ولا رقم ولا أي بيانات من القاعدة؛ الرمز لا يُطبع فيها (الإرسال لنفس المسار).
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا (لا يُكشف السبب).
   - التحقق من الصيغة بالخادم (أعداد صحيحة 1..5 بطول القالب، تعليق مقصوص ≤300، سقف حجم، الحقول الزائدة تُهمل)،
     ثم مرة ثانية داخل الدالة نفسها.
   - بلا تخزين مؤقت ولا فهرسة ولا Referer ولا كوكيز ولا سكربتات خارجية، وCSP بـnonce.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/r.js).
   ============================================================ */

const nodeCrypto = require('crypto');

const CODE_RE = /^[a-z2-9]{12,32}$/;
const COMMENT_MAX = 300;
const BODY_MAX_BYTES = 4096;

/* القالب ثابت بالكود؛ اسم الإصدار يُخزَّن بالحملة (survey_campaigns.template).
   الإجابات تُخزَّن مصفوفةً بترتيب axes هنا — لا تُعد ترتيبها ولا تحذف محورًا من إصدار قائم؛ أنشئ v2 بدلًا من ذلك. */
const SURVEY_TEMPLATES = deepFreeze({
  v1: {
    axes: [
      { key: 'clarity', label: 'وضوح الشرح', hint: 'يشرح المعلم الدروس بطريقة مفهومة' },
      { key: 'respect', label: 'التعامل', hint: 'يتعامل المعلم مع الطلاب باحترام وعدل' },
      { key: 'followup', label: 'المتابعة', hint: 'يتابع المعلم مستوى الطالب ويساعده على التحسّن' },
      { key: 'homework', label: 'الواجبات', hint: 'الواجبات والمهام مناسبة وواضحة' },
      { key: 'communication', label: 'التواصل', hint: 'التواصل مع المعلم سهل والمعلومات تصل بوضوح' },
      { key: 'overall', label: 'الرضا العام', hint: 'رضاك العام عن تعليم المعلم' }
    ],
    scale: ['ضعيف جدًا', 'ضعيف', 'مقبول', 'جيد', 'ممتاز'],
    commentMax: COMMENT_MAX
  }
});
const SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATES.v1;

function deepFreeze(o){
  Object.values(o).forEach(v => { if(v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* يرجع { ok: true, template } أو { ok: false }؛ لا يميّز بين الخاطئ والمنتهي والمستخدَم والمغلق.
   لا يُرجع أي معرّف (لا طالب ولا حملة). */
async function resolveSurveyCode(code, supabase, now){
  if(typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false };
  const inv = await supabase.from('survey_invites').select('campaign_id, answered_on').eq('code', code).maybeSingle();
  if(inv.error || !inv.data || !inv.data.campaign_id || inv.data.answered_on) return { ok: false };
  const camp = await supabase.from('survey_campaigns').select('status, closes_at, template').eq('id', inv.data.campaign_id).maybeSingle();
  const c = camp.data;
  if(camp.error || !c || c.status !== 'open') return { ok: false };
  const closes = new Date(c.closes_at).getTime();
  if(!(closes > (now || Date.now()))) return { ok: false };
  if(!Object.prototype.hasOwnProperty.call(SURVEY_TEMPLATES, c.template)) return { ok: false };
  return { ok: true, template: c.template };
}

/* تنظيف التعليق: محارف التحكم تُزال (عدا السطر الجديد)، وأنصاف الأزواج البديلة تُستبدل (القاعدة ترفضها)،
   ثم القص بعدد المحارف الفعلية (code points كما يعدّها char_length بالقاعدة). */
function cleanComment(s){
  const t = s.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
    .trim();
  return Array.from(t).slice(0, COMMENT_MAX).join('').trim();
}

/* يرجع { ok: true, answers: { ratings: [..], comment? } } أو { ok: false }. أي حقل غير ratings/comment يُهمل. */
function validateAnswers(body, templateKey){
  const tpl = Object.prototype.hasOwnProperty.call(SURVEY_TEMPLATES, templateKey) ? SURVEY_TEMPLATES[templateKey] : null;
  if(!tpl) return { ok: false };
  if(!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const r = body.ratings;
  if(!Array.isArray(r) || r.length !== tpl.axes.length) return { ok: false };
  if(!r.every(x => typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= 5)) return { ok: false };
  const answers = { ratings: r.slice() };
  const c = body.comment;
  if(c !== undefined && c !== null){
    if(typeof c !== 'string') return { ok: false };
    const cc = cleanComment(c);
    if(cc) answers.comment = cc;
  }
  return { ok: true, answers };
}

const CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F4EE;color:#1B3245;margin:0;padding:20px 16px;line-height:1.8}'
  + 'main{max-width:560px;margin:0 auto}h1{font-size:1.35rem;margin:0 0 6px}.note{background:#fff;border:1px solid #E4DFD2;border-radius:10px;padding:10px 12px;font-size:.92rem;color:#3d5466}'
  + 'fieldset{border:1px solid #E4DFD2;border-radius:12px;background:#fff;margin:14px 0;padding:10px 12px}legend{font-weight:700;padding:0 6px}.hint{font-size:.88rem;color:#55697a;margin:0 0 8px}'
  + '.scale{display:flex;gap:6px;flex-wrap:wrap}.scale label{flex:1 1 0;min-width:54px;text-align:center;border:1px solid #CFC8B6;border-radius:10px;padding:6px 2px;cursor:pointer;font-size:.82rem}'
  + '.scale input{display:block;margin:0 auto 2px}.scale b{display:block;font-size:1.05rem}textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #CFC8B6;border-radius:10px;padding:8px;font:inherit}'
  + 'button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:12px;background:#1B3245;color:#fff;font:inherit;font-size:1.05rem;cursor:pointer}button[disabled]{opacity:.6;cursor:wait}'
  + '.msg{margin-top:12px;font-weight:600;color:#9a3b1f}.center{text-align:center;padding-top:15vh}[hidden]{display:none!important}';

function head(title, nonce){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style nonce="${escapeHtml(nonce)}">${CSS}</style></head>`;
}

/* صفحة رسالة (رابط غير صالح، خطأ...). */
function buildMessagePage(title, message, nonce){
  return head(title, nonce) + `<body><main class="center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

const SCRIPT = `(function(){
var f=document.getElementById('sf'),b=document.getElementById('sb'),m=document.getElementById('sm'),n=+f.getAttribute('data-n'),busy=false;
function say(t){m.textContent=t;m.hidden=!t;}
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;
var r=[];for(var i=0;i<n;i++){var x=f.querySelector('input[name="r'+i+'"]:checked');if(!x){say('فضلًا أجب عن جميع المحاور قبل الإرسال.');return;}r.push(parseInt(x.value,10));}
var c=f.querySelector('textarea').value;busy=true;b.disabled=true;b.textContent='جارٍ الإرسال…';say('');
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ratings:r,comment:c}),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});})
.then(function(o){if(o.j&&o.j.ok){f.hidden=true;document.getElementById('st').hidden=false;return;}
if(o.s===404){b.textContent='تعذّر الإرسال';say('لا يمكن استلام ردّ عبر هذا الرابط: ربما أُرسل الرد سابقًا أو انتهت الاستبانة.');return;}
busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.');})
.catch(function(){busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');});});})();`;

/* نموذج الاستبانة: محتواه كله ثوابت القالب، فلا بيانات من القاعدة ولا من الرابط. */
function buildSurveyPage(templateKey, nonce){
  const tpl = SURVEY_TEMPLATES[templateKey];
  const axes = tpl.axes.map((a, i) => {
    const opts = tpl.scale.map((s, k) => `<label><input type="radio" name="r${i}" value="${k + 1}" required><b>${k + 1}</b>${escapeHtml(s)}</label>`).join('');
    return `<fieldset><legend>${escapeHtml(a.label)}</legend><p class="hint">${escapeHtml(a.hint)}</p><div class="scale">${opts}</div></fieldset>`;
  }).join('');
  return head('استبانة رضا', nonce) + '<body><main>'
    + '<h1>استبانة رضا عن التعليم</h1>'
    + '<p class="note">شكرًا لوقتك. الاستبانة قصيرة (دقيقة واحدة). ردّك لا يُربط باسمك: يعرف المعلم أنك أجبت، ويرى النتائج مجمَّعة فقط بعد اكتمال عدد كافٍ من الردود. الرابط يُستعمل مرة واحدة.</p>'
    + `<form id="sf" data-n="${tpl.axes.length}" novalidate>${axes}`
    + `<fieldset><legend>تعليق (اختياري)</legend><textarea name="comment" maxlength="${tpl.commentMax}" placeholder="اقتراح أو ملاحظة (حتى ${tpl.commentMax} حرف)"></textarea></fieldset>`
    + '<button type="submit" id="sb">إرسال</button><p class="msg" id="sm" role="status" hidden></p></form>'
    + '<div id="st" class="center" hidden><h1>شكرًا لك</h1><p>وصل ردّك. يمكنك إغلاق هذه الصفحة.</p></div>'
    + `</main><script nonce="${escapeHtml(nonce)}">${SCRIPT}</script></body></html>`;
}

function securityHeaders(res, nonce){
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; "
    + (nonce ? `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; ` : '')
    + "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

function sendHtml(res, status, body, nonce){
  res.status(status);
  securityHeaders(res, nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(body);
}

function sendJson(res, status, obj){
  res.status(status);
  securityHeaders(res, null);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(obj));
}

class BodyError extends Error { constructor(status){ super('body'); this.status = status; } }

/* يقرأ JSON بسقف حجم. يدعم req.body المحلَّل مسبقًا (Vercel) أو قراءة الدفق. */
async function readJsonBody(req){
  const len = Number(req.headers && req.headers['content-length']);
  if(len > BODY_MAX_BYTES) throw new BodyError(413);
  const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase();
  if(!ct.startsWith('application/json')) throw new BodyError(415);
  let pre;
  try { pre = req.body; } catch(e){ throw new BodyError(400); } /* Vercel يرمي عند JSON معطوب */
  let text;
  if(pre !== undefined && pre !== null){
    if(typeof pre === 'object' && !Buffer.isBuffer(pre)){
      if(JSON.stringify(pre).length > BODY_MAX_BYTES) throw new BodyError(413);
      return pre;
    }
    text = Buffer.isBuffer(pre) ? pre.toString('utf8') : String(pre);
  } else {
    if(typeof req.on !== 'function') throw new BodyError(400);
    text = await new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', ch => { size += ch.length; if(size > BODY_MAX_BYTES){ reject(new BodyError(413)); if(req.destroy) req.destroy(); return; } chunks.push(ch); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => reject(new BodyError(400)));
    });
  }
  if(Buffer.byteLength(text, 'utf8') > BODY_MAX_BYTES) throw new BodyError(413);
  try { return JSON.parse(text); } catch(e){ throw new BodyError(400); }
}

const GONE_TITLE = 'الرابط غير متاح';
const GONE_MSG = 'هذا الرابط غير صالح أو انتهت الاستبانة أو سبق استخدامه. شكرًا لك.';

/* opts: { createClient, url, key } للاختبار؛ الافتراضي: متغيرات البيئة والحزمة تُحمَّل عند الطلب فقط. */
function createHandler(opts){
  opts = opts || {};
  return async function handler(req, res){
    const url = opts.url !== undefined ? opts.url : process.env.SUPABASE_URL;
    const key = opts.key !== undefined ? opts.key : process.env.SUPABASE_SERVICE_ROLE_KEY;
    const method = req.method;
    if(method !== 'GET' && method !== 'HEAD' && method !== 'POST'){
      res.setHeader('Allow', 'GET, HEAD, POST');
      return sendJson(res, 405, { ok: false });
    }
    const isPost = method === 'POST';
    const nonce = nodeCrypto.randomBytes(16).toString('base64');
    if(!url || !key){
      return isPost ? sendJson(res, 503, { ok: false }) : sendHtml(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce);
    }
    const raw = req.query && req.query.c;
    const code = Array.isArray(raw) ? raw[0] : raw;
    const gone = () => isPost ? sendJson(res, 404, { ok: false }) : sendHtml(res, 404, buildMessagePage(GONE_TITLE, GONE_MSG, nonce), nonce);
    if(typeof code !== 'string' || !CODE_RE.test(code)) return gone(); /* لا يصل الشكل الخاطئ للقاعدة */

    let body = null;
    if(isPost){
      try { body = await readJsonBody(req); }
      catch(e){ return sendJson(res, e instanceof BodyError ? e.status : 400, { ok: false }); }
    }

    const createClient = opts.createClient || require('@supabase/supabase-js').createClient; /* هنا لا بأعلى الملف: الدوال الصرفة تُختبر بلا الحزمة */
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    let found;
    try { found = await resolveSurveyCode(code, supabase); } catch(e){ found = null; }
    if(!found) return isPost ? sendJson(res, 503, { ok: false }) : sendHtml(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce);
    if(!found.ok) return gone();

    if(!isPost) return sendHtml(res, 200, buildSurveyPage(found.template, nonce), nonce);

    const v = validateAnswers(body, found.template);
    if(!v.ok) return sendJson(res, 400, { ok: false });
    let rpc;
    try { rpc = await supabase.rpc('submit_survey', { p_code: code, p_answers: v.answers }); } catch(e){ rpc = { error: e }; }
    if(rpc.error) return sendJson(res, 503, { ok: false });
    if(rpc.data !== true) return gone(); /* استُخدم للتو (طلب متزامن)، أو أُغلقت الحملة: الرد الموحَّد نفسه */
    return sendJson(res, 200, { ok: true });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.resolveSurveyCode = resolveSurveyCode;
module.exports.validateAnswers = validateAnswers;
module.exports.cleanComment = cleanComment;
module.exports.buildSurveyPage = buildSurveyPage;
module.exports.buildMessagePage = buildMessagePage;
module.exports.SURVEY_TEMPLATES = SURVEY_TEMPLATES;
module.exports.SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATE_V1;
module.exports.CODE_RE = CODE_RE;
module.exports.COMMENT_MAX = COMMENT_MAX;
module.exports.BODY_MAX_BYTES = BODY_MAX_BYTES;
