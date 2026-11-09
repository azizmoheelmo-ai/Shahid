/* ============================================================
   استبانة رضا المستفيدين: /s/<رمز>  (التصميم: SURVEYS.md)
   ------------------------------------------------------------
   GET  يعرض نموذج الاستبانة (لا يستهلك التذكرة؛ معاينة واتساب للرابط آمنة).
   POST يستقبل الرد (JSON) ويمرّره للدالة الذرّية submit_survey بمفتاح service_role.
   - القالب والتحقق من الإجابات من مصدر واحد: survey-templates.js بجذر المستودع (نفس ملف المتصفح).
   - الصفحة مبهمة: لا اسم طالب ولا رقم ولا أي بيانات من القاعدة؛ الرمز لا يُطبع فيها (الإرسال لنفس المسار).
     صياغتها محايدة لأن الرابط قد يصل ولي الأمر أو الطالب نفسه (تذكرتان مستقلتان لكل طالب).
   - الرمز الخاطئ والمنتهي والمستخدَم والمغلق: الرد نفسه تمامًا (لا يُكشف السبب).
   - التحقق من الصيغة بالخادم لكل نوع سؤال، سقف حجم، المفاتيح الزائدة تُهمل، ثم مرة ثانية داخل الدالة نفسها.
   - محدِّد للمحاولات الفاشلة لكل عنوان IP (انظر createFailureLimiter وحدوده).
   - بلا تخزين مؤقت ولا فهرسة ولا Referer ولا كوكيز ولا سكربتات خارجية، وCSP بـnonce.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/r.js).
   ============================================================ */

const nodeCrypto = require('crypto');
/* مسار حرفي ثابت: متتبّع ملفات Vercel يجمع الملف مع الدالة تلقائيًا (لا حاجة لـincludeFiles). */
const shared = require('../survey-templates.js');

const { SURVEY_TEMPLATES, surveyValidateAnswers, SURVEY_CODE_RE } = shared;
const CODE_RE = SURVEY_CODE_RE;
const SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATES.v1;
const BODY_MAX_BYTES = 4096;
const QUESTION_TYPES = Object.freeze(['rating', 'truefalse', 'choice', 'text']);
const TRUEFALSE_LABELS = Object.freeze(['صح', 'خطأ']);

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getTemplate(key){
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SURVEY_TEMPLATES, key) ? SURVEY_TEMPLATES[key] : null;
}

/* يرجع { ok: true, template } أو { ok: false }؛ لا يميّز بين الخاطئ والمنتهي والمستخدَم والمغلق.
   لا يُرجع أي معرّف (لا طالب ولا حملة ولا مستلم). */
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

/* توافق مع الاختبارات السابقة: نفس مدقق الملف المشترك بترتيب وسائط قديم. */
function validateAnswers(body, templateKey){
  const r = surveyValidateAnswers(templateKey, body);
  return r.ok ? { ok: true, answers: r.value } : { ok: false };
}

/* ---------- محدِّد المحاولات الفاشلة (أفضل جهد) ----------
   يحتسب فقط محاولات الرمز الفاشلة (شكل خاطئ، غير موجود، مستخدَم، منتهٍ، مغلق) لـGET وPOST معًا.
   من يتجاوز MAX فشلًا خلال WINDOW من نفس العنوان يُرد بـ429 (وRetry-After) على أي طلب حتى تنقضي النافذة،
   حتى لو كان رمزه صحيحًا (فلا يكتشف المخمِّن إصابة). الفتح والإرسال الناجحان لا يُحتسبان.
   حدوده بصراحة: الذاكرة لكل نسخة دافئة من الدالة (Vercel يشغّل نسخًا متعددة وتُعاد تهيئتها)، والعنوان
   قد يكون مشتركًا (شبكة مدرسة/مشغّل جوال) أو متبدّلًا عند مهاجم موزَّع. المكمّل الحقيقي للإنتاج قاعدة
   Rate Limit في Vercel WAF على المسار /s/ (تُضبط من لوحة Vercel، لا من هنا).
   لا مؤقتات دورية تُبقي العملية حية: التنظيف كسول عند الإضافة، وحجم الخريطة محدود. */
const LIMIT_MAX_FAILURES = 20;
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_MAX_KEYS = 5000;

function createFailureLimiter(opts){
  opts = opts || {};
  const max = opts.max || LIMIT_MAX_FAILURES;
  const windowMs = opts.windowMs || LIMIT_WINDOW_MS;
  const maxKeys = opts.maxKeys || LIMIT_MAX_KEYS;
  const now = opts.now || Date.now;
  const store = opts.store || new Map(); /* ip -> [أزمنة الفشل داخل النافذة، الأقدم أولًا] */
  function live(ip, t){
    const arr = store.get(ip);
    if(!arr) return null;
    while(arr.length && arr[0] <= t - windowMs) arr.shift();
    if(!arr.length){ store.delete(ip); return null; }
    return arr;
  }
  return {
    /* يرجع 0 إن كان مسموحًا، أو عدد الثواني المتبقية للحظر */
    blockedFor(ip){
      const t = now(); const arr = live(ip, t);
      if(!arr || arr.length < max) return 0;
      return Math.max(1, Math.ceil((arr[arr.length - max] + windowMs - t) / 1000));
    },
    fail(ip){
      const t = now(); let arr = live(ip, t);
      if(!arr){
        if(store.size >= maxKeys){
          for(const k of Array.from(store.keys())) live(k, t); /* تنظيف كسول للمنتهي */
          while(store.size >= maxKeys) store.delete(store.keys().next().value); /* ثم الأقدم إدراجًا */
        }
        arr = []; store.set(ip, arr);
      }
      arr.push(t);
      if(arr.length > max) arr.splice(0, arr.length - max); /* يكفي آخر max زمنًا */
    },
    size(){ return store.size; }
  };
}

/* أول عنوان بـx-forwarded-for (يضبطه Vercel لعنوان العميل)، وإلا عنوان المقبس. */
function clientIp(req){
  const h = req.headers || {};
  const xff = h['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : String(xff || '')).split(',')[0].trim();
  if(first) return first.slice(0, 64);
  const s = req.socket || req.connection;
  return (s && s.remoteAddress) || 'unknown';
}

const CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F4EE;color:#1B3245;margin:0;padding:0 16px 24px;line-height:1.8}'
  + 'main{max-width:560px;margin:0 auto}h1{font-size:1.35rem;margin:14px 0 6px}.note{background:#fff;border:1px solid #E4DFD2;border-radius:10px;padding:10px 12px;font-size:.92rem;color:#3d5466}'
  + '.prog{position:sticky;top:0;z-index:5;background:#F6F4EE;margin:0 -16px;padding:8px 16px 6px;border-bottom:1px solid #E4DFD2;font-size:.85rem;font-weight:600}'
  + '.prog progress{display:block;width:100%;height:6px;margin-top:4px;border:0;border-radius:3px;background:#E4DFD2;appearance:none;-webkit-appearance:none;overflow:hidden}'
  + '.prog progress::-webkit-progress-bar{background:#E4DFD2}.prog progress::-webkit-progress-value{background:#1B3245}.prog progress::-moz-progress-bar{background:#1B3245}'
  + '.prog.done progress::-webkit-progress-value{background:#15803d}.prog.done progress::-moz-progress-bar{background:#15803d}.prog.done{color:#15803d}'
  + 'fieldset{border:1px solid #E4DFD2;border-radius:12px;background:#fff;margin:14px 0;padding:10px 12px;min-width:0;scroll-margin-top:64px}legend{font-weight:700;padding:0 6px}fieldset.miss{border-color:#c2410c;box-shadow:0 0 0 2px #fdba74}'
  + '.opts{display:flex;gap:8px;flex-wrap:wrap}.opts.col{flex-direction:column}.opts.rate{flex-wrap:nowrap;gap:5px}.opts.rate .opt{min-width:0}.opts.rate span{padding:6px 1px;font-size:.74rem;line-height:1.4}.opt{flex:1 1 0;min-width:56px;position:relative;display:block;cursor:pointer}'
  + '.opt input{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
  + '.opt span{display:block;min-height:48px;box-sizing:border-box;text-align:center;border:1.5px solid #CFC8B6;border-radius:12px;padding:8px 6px;font-size:.9rem;background:#fff}'
  + '.opt span b{display:block;font-size:1.2rem}.opt input:checked+span{background:#1B3245;border-color:#1B3245;color:#fff}'
  + '.opt input:focus-visible+span{outline:3px solid #f59e0b;outline-offset:2px}'
  + 'textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #CFC8B6;border-radius:10px;padding:8px;font:inherit}.cnt{display:block;text-align:left;font-size:.8rem;color:#55697a}.opt-tag{font-weight:400;font-size:.85rem;color:#55697a}'
  + 'button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:#64748b;color:#fff;font:inherit;font-size:1.05rem;cursor:pointer;scroll-margin-top:64px}'
  + 'button.ready{background:#15803d;font-weight:700;box-shadow:0 4px 14px rgba(21,128,61,.35)}button[disabled]{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}'
  + '.msg{margin-top:12px;font-weight:600;color:#9a3b1f}.center{text-align:center;padding-top:15vh}[hidden]{display:none!important}';

function head(title, nonce){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style nonce="${escapeHtml(nonce)}">${CSS}</style></head>`;
}

/* صفحة رسالة (رابط غير صالح، محاولات كثيرة، خطأ...). */
function buildMessagePage(title, message, nonce){
  return head(title, nonce) + `<body><main class="center"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

/* السكربت يقرأ نوع كل سؤال من data-* بالـfieldset، فيبني كائن الإجابات بالمعرّفات. لا alert.
   شريط التقدم يعدّ الأسئلة المطلوبة (data-req)، وبعد إجابة سؤال مطلوب لأول مرة ينتقل للسؤال التالي غير المُجاب
   (بلا حركة إن طلب المستخدم تقليل الحركة)، ويُبرز زر الإرسال عند اكتمال المطلوب. */
const SCRIPT = `(function(){
var f=document.getElementById('sf'),b=document.getElementById('sb'),m=document.getElementById('sm'),busy=false;
var qs=Array.prototype.slice.call(f.querySelectorAll('fieldset[data-q]'));
var req=qs.filter(function(fs){return fs.getAttribute('data-req')==='1';});
var pg=document.getElementById('pg'),pgt=document.getElementById('pgt'),pgb=document.getElementById('pgb');
var calm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function say(t){m.textContent=t;m.hidden=!t;}
function len(s){return Array.from(s).length;}
function answered(fs){return fs.getAttribute('data-t')==='text'?!!fs.querySelector('textarea').value.trim():!!fs.querySelector('input:checked');}
function go(el){el.scrollIntoView({behavior:calm?'auto':'smooth',block:'center'});}
function progress(){var n=req.filter(answered).length,all=n===req.length;
pgt.textContent=n+' من '+req.length+' أسئلة مطلوبة';pgb.value=n;pg.classList.toggle('done',all);b.classList.toggle('ready',all);return all;}
f.querySelectorAll('textarea').forEach(function(t){var c=document.getElementById('c-'+t.name),mx=+t.getAttribute('data-max');
t.addEventListener('input',function(){if(len(t.value)>mx)t.value=Array.from(t.value).slice(0,mx).join('');c.textContent=len(t.value)+' / '+mx;});});
f.addEventListener('change',function(e){var fs=e.target.closest('fieldset');if(!fs)return;fs.classList.remove('miss');progress();
if(fs.getAttribute('data-req')!=='1'||fs.getAttribute('data-seen')==='1')return;fs.setAttribute('data-seen','1');
var i=qs.indexOf(fs),next=null;for(var k=i+1;k<qs.length;k++){if(!answered(qs[k])){next=qs[k];break;}}
if(!next)next=req.filter(function(x){return !answered(x);})[0]||b;setTimeout(function(){go(next);},calm?0:220);});
progress();
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;
var a={},miss=[];
qs.forEach(function(fs){var id=fs.getAttribute('data-q'),t=fs.getAttribute('data-t');fs.classList.remove('miss');
if(t==='text'){var v=fs.querySelector('textarea').value.trim();if(v)a[id]=v;return;}
var x=fs.querySelector('input:checked');if(!x){miss.push(fs);return;}
a[id]=t==='truefalse'?x.value==='true':parseInt(x.value,10);});
if(miss.length){miss.forEach(function(fs){fs.classList.add('miss');});
say('فضلًا أجب عن جميع الأسئلة المطلوبة (المميَّزة باللون) قبل الإرسال. الأسئلة النصية اختيارية.');
go(miss[0]);var i=miss[0].querySelector('input');if(i)i.focus({preventScroll:true});return;}
busy=true;b.disabled=true;b.textContent='جارٍ الإرسال…';say('');
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(a),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});})
.then(function(o){if(o.j&&o.j.ok){f.hidden=true;pg.hidden=true;document.getElementById('st').hidden=false;window.scrollTo(0,0);return;}
if(o.s===404){b.textContent='تعذّر الإرسال';say('لا يمكن استلام ردّ عبر هذا الرابط: ربما أُرسل الرد سابقًا أو انتهت الاستبانة.');return;}
if(o.s===429){b.textContent='تعذّر الإرسال';say('محاولات كثيرة من هذا الجهاز. انتظر بضع دقائق ثم أعد فتح الرابط.');return;}
busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.');})
.catch(function(){busy=false;b.disabled=false;b.textContent='إرسال';say('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');});});})();`;

function optionsHtml(name, items, cls){
  /* items: [{ value, html }] — أزرار كبيرة فوق راديو أصلي (قابل للوصول بلوحة المفاتيح وقارئ الشاشة) */
  return `<div class="opts${cls ? ' ' + cls : ''}">` + items.map(it =>
    `<label class="opt"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(it.value)}"><span>${it.html}</span></label>`).join('') + '</div>';
}

function questionHtml(q, tpl){
  const attrs = `data-q="${escapeHtml(q.id)}" data-t="${escapeHtml(q.type)}" data-req="${q.required ? 1 : 0}"`;
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
  const nReq = tpl.questions.filter(q => q.required).length;
  return head('استبانة رضا', nonce) + '<body>'
    + `<div class="prog" id="pg"><span id="pgt" aria-live="polite">0 من ${nReq} أسئلة مطلوبة</span>`
    + `<progress id="pgb" max="${nReq}" value="0" aria-label="تقدّم الإجابة عن الأسئلة المطلوبة"></progress></div><main>`
    + '<h1>استبانة رضا عن التعليم</h1>'
    + '<p class="note">هذه الاستبانة لولي الأمر أو الطالب، وهي قصيرة (دقيقتان). ردّك لا يُربط باسمك: يعرف المعلم أن الرابط استُخدم، ويرى النتائج مجمَّعة فقط بعد اكتمال عدد كافٍ من الردود. الرابط يُستعمل مرة واحدة.</p>'
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
const BUSY_TITLE = 'محاولات كثيرة';
const BUSY_MSG = 'فُتحت روابط غير صالحة عدة مرات من هذا الجهاز أو الشبكة. انتظر بضع دقائق ثم أعد فتح الرابط الذي وصلك.';

const defaultLimiter = createFailureLimiter(); /* لكل نسخة دافئة من الدالة */

/* opts: { createClient, url, key, limiter } للاختبار؛ الافتراضي: متغيرات البيئة والحزمة تُحمَّل عند الطلب فقط. */
function createHandler(opts){
  opts = opts || {};
  const limiter = opts.limiter || defaultLimiter;
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
    const ip = clientIp(req);
    const wait = limiter.blockedFor(ip);
    if(wait){
      res.setHeader('Retry-After', String(wait));
      return isPost ? sendJson(res, 429, { ok: false }) : sendHtml(res, 429, buildMessagePage(BUSY_TITLE, BUSY_MSG, nonce), nonce);
    }
    if(!url || !key){
      return isPost ? sendJson(res, 503, { ok: false }) : sendHtml(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce);
    }
    const raw = req.query && req.query.c;
    const code = Array.isArray(raw) ? raw[0] : raw;
    /* كل رد «غير متاح» محاولةُ رمز فاشلة تُحتسب على العنوان */
    const gone = () => { limiter.fail(ip); return isPost ? sendJson(res, 404, { ok: false }) : sendHtml(res, 404, buildMessagePage(GONE_TITLE, GONE_MSG, nonce), nonce); };
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

    const v = surveyValidateAnswers(found.template, body);
    if(!v.ok) return sendJson(res, 400, { ok: false });
    let rpc;
    try { rpc = await supabase.rpc('submit_survey', { p_code: code, p_answers: v.value }); } catch(e){ rpc = { error: e }; }
    if(rpc.error) return sendJson(res, 503, { ok: false });
    if(rpc.data !== true) return gone(); /* استُخدم للتو (طلب متزامن)، أو أُغلقت الحملة: الرد الموحَّد نفسه */
    return sendJson(res, 200, { ok: true });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.createFailureLimiter = createFailureLimiter;
module.exports.clientIp = clientIp;
module.exports.resolveSurveyCode = resolveSurveyCode;
module.exports.validateAnswers = validateAnswers;
module.exports.buildSurveyPage = buildSurveyPage;
module.exports.buildMessagePage = buildMessagePage;
module.exports.SURVEY_TEMPLATES = SURVEY_TEMPLATES;
module.exports.SURVEY_TEMPLATE_V1 = SURVEY_TEMPLATE_V1;
module.exports.CODE_RE = CODE_RE;
module.exports.TEXT_MAX = SURVEY_TEMPLATE_V1.textMax;
module.exports.QUESTION_TYPES = QUESTION_TYPES;
module.exports.TRUEFALSE_LABELS = TRUEFALSE_LABELS;
module.exports.BODY_MAX_BYTES = BODY_MAX_BYTES;
module.exports.LIMIT_MAX_FAILURES = LIMIT_MAX_FAILURES;
module.exports.LIMIT_WINDOW_MS = LIMIT_WINDOW_MS;
