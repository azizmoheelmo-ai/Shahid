/* ============================================================
   استبانة رضا المستفيدين: /s/<رمز>  (التصميم: SURVEYS.md)
   ------------------------------------------------------------
   GET  يعرض نموذج الاستبانة (لا يستهلك التذكرة؛ معاينة واتساب للرابط آمنة).
   POST يستقبل الرد (JSON) ويمرّره للدالة الذرّية submit_survey بمفتاح service_role.
   - الصفحة مبهمة: لا اسم طالب ولا رقم ولا أي بيانات من القاعدة؛ الرمز لا يُطبع فيها (الإرسال لنفس المسار).
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا (لا يُكشف السبب).
   - التحقق من الصيغة بالخادم لكل نوع سؤال (تقييم/صح-خطأ/اختيار/نص مقصوص ≤300)، سقف حجم، المفاتيح الزائدة تُهمل،
     ثم مرة ثانية داخل الدالة نفسها.
   - بلا تخزين مؤقت ولا فهرسة ولا Referer ولا كوكيز ولا سكربتات خارجية، وCSP بـnonce.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/r.js).
   ============================================================ */

const nodeCrypto = require('crypto');

const CODE_RE = /^[a-z2-9]{12,32}$/;
const TEXT_MAX = 300;
const BODY_MAX_BYTES = 4096;
const QUESTION_TYPES = Object.freeze(['rating', 'truefalse', 'choice', 'text']);

/* القالب ثابت بالكود (لا منشئ أسئلة)؛ اسم الإصدار يُخزَّن بالحملة (survey_campaigns.template).
   الإجابات تُخزَّن كائنًا بمفاتيح معرّفات الأسئلة (q1..q9) لا بالموضع.
   نسخة من المعرّفات والأنواع وعدد الخيارات داخل submit_survey بالـSQL — اختبار يتحقق من تطابقهما.
   بعد التشغيل الفعلي: لا تُغيّر معنى معرّف قائم ولا ترتيب خيارات؛ أنشئ إصدارًا جديدًا بدلًا من ذلك. */
const SURVEY_TEMPLATES = deepFreeze({
  v1: {
    questions: [
      { id: 'q1', type: 'rating', label: 'وضوح شرح المعلم للدرس', required: true },
      { id: 'q2', type: 'rating', label: 'أسلوب تعامل المعلم مع الطالب', required: true },
      { id: 'q3', type: 'rating', label: 'متابعة المعلم لمستوى الطالب', required: true },
      { id: 'q4', type: 'truefalse', label: 'يتواصل المعلم مع ولي الأمر عند الحاجة', required: true },
      { id: 'q5', type: 'truefalse', label: 'الواجبات مناسبة وتفيد الطالب', required: true },
      { id: 'q6', type: 'choice', label: 'أفضل وسيلة للتواصل مع المعلم', options: ['واتساب', 'اتصال هاتفي', 'لقاء في المدرسة', 'رسالة من المدرسة'], required: true },
      { id: 'q7', type: 'rating', label: 'رضاكم العام عن المعلم', required: true },
      { id: 'q8', type: 'text', label: 'ما الذي أعجبكم؟', required: false },
      { id: 'q9', type: 'text', label: 'ما اقتراحكم للتحسين؟', required: false }
    ],
    scale: ['ضعيف جدًا', 'ضعيف', 'مقبول', 'جيد', 'ممتاز'],
    textMax: TEXT_MAX
  }
});
const SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATES.v1;
const TRUEFALSE_LABELS = Object.freeze(['صح', 'خطأ']);

function deepFreeze(o){
  Object.values(o).forEach(v => { if(v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getTemplate(key){
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SURVEY_TEMPLATES, key) ? SURVEY_TEMPLATES[key] : null;
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
  if(!getTemplate(c.template)) return { ok: false };
  return { ok: true, template: c.template };
}

/* تنظيف النص الحر: محارف التحكم تُزال (عدا السطر الجديد)، وأنصاف الأزواج البديلة تُستبدل (القاعدة ترفضها)،
   ثم القص بعدد المحارف الفعلية (code points كما يعدّها char_length بالقاعدة). */
function cleanText(s){
  const t = s.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
    .trim();
  return Array.from(t).slice(0, TEXT_MAX).join('').trim();
}

/* يرجع { ok: true, answers } أو { ok: false }. answers مبني من أسئلة القالب وحدها (أي مفتاح زائد يُهمل):
   rating عدد صحيح 1..5، truefalse قيمة منطقية JSON، choice فهرس صحيح من الصفر ضمن الخيارات، text نص منظَّف
   (يُحذف المفتاح إن كان فارغًا). غير النصي إلزامي؛ النوع الخاطئ يُرفض ولا يُحوَّل. */
function validateAnswers(body, templateKey){
  const tpl = getTemplate(templateKey);
  if(!tpl) return { ok: false };
  if(!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const answers = {};
  for(const q of tpl.questions){
    const v = Object.prototype.hasOwnProperty.call(body, q.id) ? body[q.id] : undefined;
    if(q.type === 'text'){
      if(v === undefined || v === null) continue;
      if(typeof v !== 'string') return { ok: false };
      const t = cleanText(v);
      if(t) answers[q.id] = t;
      continue;
    }
    if(v === undefined || v === null) return { ok: false }; /* الإلزامي مفقود */
    if(q.type === 'rating'){
      if(!(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5)) return { ok: false };
    } else if(q.type === 'truefalse'){
      if(typeof v !== 'boolean') return { ok: false };
    } else if(q.type === 'choice'){
      if(!(typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < q.options.length)) return { ok: false };
    } else return { ok: false };
    answers[q.id] = v;
  }
  return { ok: true, answers };
}

const CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F4EE;color:#1B3245;margin:0;padding:20px 16px;line-height:1.8}'
  + 'main{max-width:560px;margin:0 auto}h1{font-size:1.35rem;margin:0 0 6px}.note{background:#fff;border:1px solid #E4DFD2;border-radius:10px;padding:10px 12px;font-size:.92rem;color:#3d5466}'
  + 'fieldset{border:1px solid #E4DFD2;border-radius:12px;background:#fff;margin:14px 0;padding:10px 12px;min-width:0}legend{font-weight:700;padding:0 6px}fieldset.miss{border-color:#c2410c;box-shadow:0 0 0 2px #fdba74}'
  + '.opts{display:flex;gap:8px;flex-wrap:wrap}.opts.col{flex-direction:column}.opts.rate{flex-wrap:nowrap;gap:5px}.opts.rate .opt{min-width:0}.opts.rate span{padding:6px 1px;font-size:.74rem;line-height:1.4}.opt{flex:1 1 0;min-width:56px;position:relative;display:block;cursor:pointer}'
  + '.opt input{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
  + '.opt span{display:block;min-height:48px;box-sizing:border-box;text-align:center;border:1.5px solid #CFC8B6;border-radius:12px;padding:8px 6px;font-size:.9rem;background:#fff}'
  + '.opt span b{display:block;font-size:1.2rem}.opt input:checked+span{background:#1B3245;border-color:#1B3245;color:#fff}'
  + '.opt input:focus-visible+span{outline:3px solid #f59e0b;outline-offset:2px}'
  + 'textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #CFC8B6;border-radius:10px;padding:8px;font:inherit}.cnt{display:block;text-align:left;font-size:.8rem;color:#55697a}.opt-tag{font-weight:400;font-size:.85rem;color:#55697a}'
  + 'button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#1B3245;color:#fff;font:inherit;font-size:1.05rem;cursor:pointer}button[disabled]{opacity:.6;cursor:wait}'
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

/* السكربت يقرأ نوع كل سؤال من data-* بالـfieldset، فيبني كائن الإجابات بالمعرّفات. لا alert. */
const SCRIPT = `(function(){
var f=document.getElementById('sf'),b=document.getElementById('sb'),m=document.getElementById('sm'),busy=false;
var qs=f.querySelectorAll('fieldset[data-q]');
function say(t){m.textContent=t;m.hidden=!t;}
function len(s){return Array.from(s).length;}
f.querySelectorAll('textarea').forEach(function(t){var c=document.getElementById('c-'+t.name),mx=+t.getAttribute('data-max');
t.addEventListener('input',function(){if(len(t.value)>mx)t.value=Array.from(t.value).slice(0,mx).join('');c.textContent=len(t.value)+' / '+mx;});});
f.addEventListener('change',function(e){var fs=e.target.closest('fieldset');if(fs)fs.classList.remove('miss');});
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;
var a={},miss=[];
qs.forEach(function(fs){var id=fs.getAttribute('data-q'),t=fs.getAttribute('data-t');fs.classList.remove('miss');
if(t==='text'){var v=fs.querySelector('textarea').value.trim();if(v)a[id]=v;return;}
var x=fs.querySelector('input:checked');if(!x){miss.push(fs);return;}
a[id]=t==='truefalse'?x.value==='true':parseInt(x.value,10);});
if(miss.length){miss.forEach(function(fs){fs.classList.add('miss');});
say('فضلًا أجب عن جميع الأسئلة المطلوبة (المميَّزة باللون) قبل الإرسال. الأسئلة النصية اختيارية.');
miss[0].scrollIntoView({behavior:'smooth',block:'center'});var i=miss[0].querySelector('input');if(i)i.focus({preventScroll:true});return;}
busy=true;b.disabled=true;b.textContent='جارٍ الإرسال…';say('');
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});})
.then(function(o){if(o.j&&o.j.ok){f.hidden=true;document.getElementById('st').hidden=false;window.scrollTo(0,0);return;}
if(o.s===404){b.textContent='تعذّر الإرسال';say('لا يمكن استلام ردّ عبر هذا الرابط: ربما أُرسل الرد سابقًا أو انتهت الاستبانة.');return;}
busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.');})
.catch(function(){busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');});});})();`;

function optionsHtml(name, items, cls){
  /* items: [{ value, html }] — أزرار كبيرة فوق راديو أصلي (قابل للوصول بلوحة المفاتيح وقارئ الشاشة) */
  return `<div class="opts${cls ? ' ' + cls : ''}">` + items.map(it =>
    `<label class="opt"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(it.value)}"><span>${it.html}</span></label>`).join('') + '</div>';
}

function questionHtml(q, tpl){
  const attrs = `data-q="${escapeHtml(q.id)}" data-t="${escapeHtml(q.type)}"`;
  const legend = `<legend>${escapeHtml(q.label)}${q.required ? '' : ' <span class="opt-tag">(اختياري)</span>'}</legend>`;
  let body;
  if(q.type === 'rating') body = optionsHtml(q.id, tpl.scale.map((s, k) => ({ value: String(k + 1), html: `<b>${k + 1}</b>${escapeHtml(s)}` })), 'rate');
  else if(q.type === 'truefalse') body = optionsHtml(q.id, [{ value: 'true', html: `<b>${escapeHtml(TRUEFALSE_LABELS[0])}</b>` }, { value: 'false', html: `<b>${escapeHtml(TRUEFALSE_LABELS[1])}</b>` }]);
  else if(q.type === 'choice') body = optionsHtml(q.id, q.options.map((o, k) => ({ value: String(k), html: escapeHtml(o) })), 'col');
  else body = `<textarea name="${escapeHtml(q.id)}" maxlength="${tpl.textMax}" data-max="${tpl.textMax}" aria-describedby="c-${escapeHtml(q.id)}" placeholder="اكتب هنا (حتى ${tpl.textMax} حرف)"></textarea>`
    + `<small class="cnt" id="c-${escapeHtml(q.id)}" aria-live="polite">0 / ${tpl.textMax}</small>`;
  return `<fieldset ${attrs}>${legend}${body}</fieldset>`;
}

/* نموذج الاستبانة: محتواه كله ثوابت القالب، فلا بيانات من القاعدة ولا من الرابط. */
function buildSurveyPage(templateKey, nonce){
  const tpl = SURVEY_TEMPLATES[templateKey];
  return head('استبانة رضا', nonce) + '<body><main>'
    + '<h1>استبانة رضا عن التعليم</h1>'
    + '<p class="note">شكرًا لوقتكم. الاستبانة قصيرة (دقيقتان). ردّك لا يُربط باسمك: يعرف المعلم أنك أجبت، ويرى النتائج مجمَّعة فقط بعد اكتمال عدد كافٍ من الردود. الرابط يُستعمل مرة واحدة.</p>'
    + `<form id="sf" novalidate>${tpl.questions.map(q => questionHtml(q, tpl)).join('')}`
    + '<button type="submit" id="sb">إرسال</button><p class="msg" id="sm" role="alert" hidden></p></form>'
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
module.exports.cleanText = cleanText;
module.exports.buildSurveyPage = buildSurveyPage;
module.exports.buildMessagePage = buildMessagePage;
module.exports.SURVEY_TEMPLATES = SURVEY_TEMPLATES;
module.exports.SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATE_V1;
module.exports.CODE_RE = CODE_RE;
module.exports.TEXT_MAX = TEXT_MAX;
module.exports.QUESTION_TYPES = QUESTION_TYPES;
module.exports.TRUEFALSE_LABELS = TRUEFALSE_LABELS;
module.exports.BODY_MAX_BYTES = BODY_MAX_BYTES;
