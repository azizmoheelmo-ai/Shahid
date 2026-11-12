/* ============================================================
   متابعة مؤشرات القيادة المدرسية: /f/<رمز>  (التصميم: LEADER-FOLLOWUP.md)
   ------------------------------------------------------------
   GET  يعرض المؤشرات وأوقات اللقاء المقترحة (لا يستهلك الرابط؛ معاينة واتساب آمنة).
   POST يستقبل الإجابة { a: { i1: { s, r } }, slot } ويمرّرها للدالة الذرّية submit_leader_followup بمفتاح service_role.
   - الرابط شخصي ويُستعمل مرة واحدة: عند الإجابة يصير code = null بالقاعدة، فيُعامل كالرابط الخاطئ.
   - الرمز الخاطئ والمنتهي والمستخدَم: الرد نفسه تمامًا (لا يُكشف السبب).
   - التحقق من الصيغة بالخادم بمدقق leader-kit.js المشترك (نفس قواعد leader_answers_clean بالـSQL)، وسقف حجم الطلب.
   - الأوقات المحجوزة لمسؤول آخر لدى المعلم نفسه تظهر «محجوز» بلا كشف لمن؛ والفيصل الفهرس الفريد بالقاعدة (409 slot_taken).
   - بلا تخزين مؤقت ولا فهرسة ولا Referer ولا كوكيز ولا سكربتات خارجية، وCSP بـnonce.
   - المسودة تُحفظ بمتصفح المسؤول وحده (localStorage) ولا تصل الخادم قبل «إرسال».
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/s.js).
   ============================================================ */

const nodeCrypto = require('crypto');
/* مساراتان حرفيتان ثابتتان: متتبّع ملفات Vercel يجمع الملفات مع الدالة تلقائيًا. */
const kit = require('../leader-kit.js');
const survey = require('./s.js');

const { leaderValidateIndicators, leaderValidateSlots, leaderValidateAnswers, leaderSlotLabel, leaderRoleLabel,
  LEADER_ANSWER_STATES, LEADER_SLOT_NONE, LEADER_LIMITS } = kit;
const { createFailureLimiter, clientIp, readJsonBody, BodyError, escapeHtml, sendHtml, sendJson, buildMessagePage,
  GONE_TITLE, GONE_MSG, BUSY_TITLE, BUSY_MSG } = survey;
const CODE_RE = survey.CODE_RE;
const BODY_MAX_BYTES = 16384;
const COLS = 'teacher_id, leader_role, leader_name, cycle_label, sender_name, indicators, slots, closes_at, answered_at';

/* يرجع { ok: true, req, taken } أو { ok: false }؛ لا يميّز بين الخاطئ والمنتهي والمستخدَم. يرمي عند فشل القاعدة (503). */
async function resolveLeaderCode(code, supabase, now){
  if(typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false };
  const r = await supabase.from('leader_followups').select(COLS).eq('code', code).maybeSingle();
  if(r.error) throw r.error;
  const row = r.data;
  if(!row || row.answered_at) return { ok: false };
  const closes = new Date(row.closes_at).getTime();
  if(!(closes > (now || Date.now()))) return { ok: false };
  const iv = leaderValidateIndicators(row.indicators);
  const sv = leaderValidateSlots(row.slots);
  if(!iv.ok || !sv.ok || typeof row.cycle_label !== 'string') return { ok: false };
  let taken = [];
  if(sv.value.length){
    const t = await supabase.from('leader_followups').select('chosen_slot').eq('teacher_id', row.teacher_id).in('chosen_slot', sv.value);
    if(t.error) throw t.error;
    taken = (t.data || []).map(x => x.chosen_slot);
  }
  return { ok: true, req: {
    role: leaderRoleLabel(row.leader_role), name: row.leader_name || '', cycle: row.cycle_label, sender: row.sender_name || '',
    indicators: iv.value, slots: sv.value
  }, taken };
}

const CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F6F4EE;color:#1B3245;margin:0;padding:0 16px 28px;line-height:1.8}'
  + 'main{max-width:560px;margin:0 auto}h1{font-size:1.35rem;margin:14px 0 6px}h2{font-size:1.05rem;margin:22px 0 6px}'
  + '.note{background:#fff;border:1px solid #E4DFD2;border-radius:10px;padding:10px 12px;font-size:.92rem;color:#3d5466}'
  + '.meta{color:#55697a;font-size:.9rem;margin:2px 0}'
  + 'fieldset{border:1px solid #E4DFD2;border-radius:12px;background:#fff;margin:12px 0;padding:10px 12px;min-width:0;scroll-margin-top:12px}'
  + 'legend{font-weight:700;padding:0 6px}fieldset.miss{border-color:#c2410c;box-shadow:0 0 0 2px #fdba74}'
  + '.opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.opts.col{grid-template-columns:1fr}'
  + '.opt{position:relative;display:block;cursor:pointer}.opt input{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
  + '.opt span{display:block;min-height:46px;text-align:center;border:1.5px solid #CFC8B6;border-radius:10px;padding:8px 4px;font-size:.88rem;background:#fff}'
  + '.opts.col .opt span{text-align:start;padding:10px 12px;font-size:.95rem}'
  + '.opt input:checked+span{color:#fff;font-weight:700}.opt .s-done:checked+span{background:#2E7D4F;border-color:#2E7D4F}'
  + '.opt .s-wip:checked+span{background:#A66A00;border-color:#A66A00}.opt .s-no:checked+span{background:#B3382C;border-color:#B3382C}'
  + '.opt .s-slot:checked+span{background:#1B3245;border-color:#1B3245}.opt input:disabled+span{opacity:.5;background:#ECE8DC;cursor:not-allowed}'
  + '.opt input:focus-visible+span{outline:3px solid #f59e0b;outline-offset:2px}'
  + 'textarea{width:100%;box-sizing:border-box;min-height:70px;border:1px solid #CFC8B6;border-radius:10px;padding:8px;font:inherit;margin-top:8px}'
  + '.cnt{display:block;direction:ltr;text-align:left;font-size:.78rem;color:#55697a}'
  + 'button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:12px;background:#1B3245;color:#fff;font:inherit;font-size:1.05rem;font-weight:700;cursor:pointer}'
  + 'button[disabled]{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}'
  + '.msg{margin-top:12px;font-weight:600;color:#9a3b1f}.center{text-align:center;padding-top:12vh}[hidden]{display:none!important}'
  + '.copy{background:#fff;border:1px solid #E4DFD2;border-radius:12px;padding:6px 12px;text-align:start}.copy li{margin:8px 0;list-style:none}'
  + '.copy b{display:block}.copy small{color:#55697a;display:block}';

function head(title, nonce){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style nonce="${escapeHtml(nonce)}">${CSS}</style></head>`;
}

/* لا alert. الحالة والسبب لكل مؤشر، والموعد، ثم POST. المسودة بـlocalStorage (try/catch: قد يكون محجوبًا). */
function buildScript(){
  const labels = JSON.stringify(LEADER_ANSWER_STATES).replace(/</g, '\\u003c');
  return `(function(){
var L=${labels},NONE=${JSON.stringify(LEADER_SLOT_NONE)},MAXR=${LEADER_LIMITS.maxReason};
var f=document.getElementById('lf'),b=document.getElementById('sb'),m=document.getElementById('sm'),busy=false,KEY='lfd:'+location.pathname;
var items=Array.prototype.slice.call(f.querySelectorAll('fieldset[data-i]')),slotFs=f.querySelector('fieldset[data-slots]');
function say(t){m.textContent=t;m.hidden=!t;}
function len(s){return Array.from(s).length;}
function st(fs){var x=fs.querySelector('input:checked');return x?x.value:'';}
function sync(fs){var s=st(fs),box=fs.querySelector('.rs'),ta=fs.querySelector('textarea');box.hidden=!s;
ta.placeholder=s==='done'?'ملاحظة (اختياري)':'اكتب السبب (مطلوب)';}
function save(){try{var a={};items.forEach(function(fs){a[fs.getAttribute('data-i')]={s:st(fs),r:fs.querySelector('textarea').value};});
var sl=slotFs&&slotFs.querySelector('input:checked');localStorage.setItem(KEY,JSON.stringify({a:a,slot:sl?sl.value:null}));}catch(e){}}
function restore(){try{var d=JSON.parse(localStorage.getItem(KEY)||'null');if(!d||!d.a)return;
items.forEach(function(fs){var x=d.a[fs.getAttribute('data-i')];if(!x)return;
if(x.s){var r=fs.querySelector('input[value="'+x.s+'"]');if(r)r.checked=true;}
if(typeof x.r==='string')fs.querySelector('textarea').value=x.r.slice(0,MAXR);sync(fs);});
if(slotFs&&typeof d.slot==='string'){var q=Array.prototype.slice.call(slotFs.querySelectorAll('input')).filter(function(i){return i.value===d.slot&&!i.disabled;})[0];if(q)q.checked=true;}}catch(e){}}
function clear(){try{localStorage.removeItem(KEY);}catch(e){}}
items.forEach(function(fs){var ta=fs.querySelector('textarea'),c=fs.querySelector('.cnt');
ta.addEventListener('input',function(){if(len(ta.value)>MAXR)ta.value=Array.from(ta.value).slice(0,MAXR).join('');c.textContent=len(ta.value)+' / '+MAXR;fs.classList.remove('miss');save();});
fs.addEventListener('change',function(){fs.classList.remove('miss');sync(fs);save();});sync(fs);});
if(slotFs)slotFs.addEventListener('change',function(){slotFs.classList.remove('miss');save();});
restore();
function done(a,slotText){var ul=document.getElementById('cp');ul.textContent='';
items.forEach(function(fs){var li=document.createElement('li'),t=document.createElement('b'),s=document.createElement('small'),x=a[fs.getAttribute('data-i')];
t.textContent=fs.querySelector('legend').textContent;s.textContent=L[x.s]+(x.r?' — '+x.r:'');li.appendChild(t);li.appendChild(s);ul.appendChild(li);});
if(slotText){var li=document.createElement('li'),t=document.createElement('b'),s=document.createElement('small');t.textContent='موعد اللقاء';s.textContent=slotText;li.appendChild(t);li.appendChild(s);ul.appendChild(li);}
f.hidden=true;document.getElementById('hd').hidden=true;document.getElementById('st').hidden=false;window.scrollTo(0,0);}
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;
var a={},miss=[];
items.forEach(function(fs){fs.classList.remove('miss');var s=st(fs),r=fs.querySelector('textarea').value.trim();
if(!s||(s!=='done'&&!r)){miss.push(fs);return;}a[fs.getAttribute('data-i')]=r?{s:s,r:r}:{s:s};});
var slot=null,slotText='';
if(slotFs){slotFs.classList.remove('miss');var sx=slotFs.querySelector('input:checked');if(!sx)miss.push(slotFs);else{slot=sx.value;slotText=slot===NONE?'لا يناسبني أي موعد':sx.parentNode.textContent;}}
if(miss.length){miss.forEach(function(fs){fs.classList.add('miss');});say('فضلًا اختر حالة كل مؤشر واكتب السبب لما لم يُنفَّذ أو قيد التنفيذ، ثم اختر موعدًا. المميَّز باللون ينقصه شيء.');
miss[0].scrollIntoView({behavior:'smooth',block:'center'});return;}
busy=true;b.disabled=true;b.textContent='جارٍ الإرسال…';say('');
fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:a,slot:slot}),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});})
.then(function(o){if(o.j&&o.j.ok){clear();done(a,slotText);return;}
if(o.s===409){busy=false;b.disabled=false;b.textContent='إرسال الإجابة';
var bad=slotFs&&slotFs.querySelector('input:checked');if(bad){bad.checked=false;bad.disabled=true;}
say('هذا الموعد حُجز للتو لشخص آخر. اختر موعدًا آخر ثم أرسل مرة أخرى (إجاباتك محفوظة).');slotFs.classList.add('miss');slotFs.scrollIntoView({behavior:'smooth',block:'center'});return;}
if(o.s===404){b.textContent='تعذّر الإرسال';say('لا يمكن استلام إجابة عبر هذا الرابط: ربما أُرسلت إجابة سابقًا أو انتهت مدته.');return;}
if(o.s===429){b.textContent='تعذّر الإرسال';say('محاولات كثيرة من هذا الجهاز. انتظر بضع دقائق ثم أعد فتح الرابط.');return;}
busy=false;b.disabled=false;b.textContent='إرسال الإجابة';say('تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.');})
.catch(function(){busy=false;b.disabled=false;b.textContent='إرسال الإجابة';say('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');});});})();`;
}

function radio(name, value, cls, text, disabled){
  return `<label class="opt"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}" class="${cls}"${disabled ? ' disabled' : ''}><span>${text}</span></label>`;
}

function indicatorHtml(ind, k){
  const states = Object.keys(LEADER_ANSWER_STATES).map(s => radio('s-' + ind.id, s, 's-' + s, escapeHtml(LEADER_ANSWER_STATES[s]))).join('');
  return `<fieldset data-i="${escapeHtml(ind.id)}"><legend>${k + 1}. <bdi>${escapeHtml(ind.label)}</bdi></legend>`
    + `<div class="opts">${states}</div>`
    + `<div class="rs" hidden><textarea maxlength="${LEADER_LIMITS.maxReason}" aria-label="سبب أو ملاحظة"></textarea><small class="cnt" aria-live="polite">0 / ${LEADER_LIMITS.maxReason}</small></div></fieldset>`;
}

function slotsHtml(slots, taken){
  if(!slots.length) return '';
  const set = new Set(taken);
  const items = slots.map(s => radio('slot', s, 's-slot', escapeHtml(leaderSlotLabel(s)) + (set.has(s) ? ' (محجوز)' : ''), set.has(s)));
  items.push(radio('slot', LEADER_SLOT_NONE, 's-slot', 'لا يناسبني أي موعد منها'));
  return `<fieldset data-slots="1"><legend>اختر موعد اللقاء</legend><div class="opts col">${items.join('')}</div></fieldset>`;
}

/* الصفحة تُبنى من الطلب نفسه. نصوص المعلم (المؤشرات والاسم والدورة) غير موثوقة: تُهرَّب وتُعزل اتجاهيًا بـ<bdi>. */
function buildLeaderPage(found, nonce){
  const req = found.req;
  const to = (req.role || 'المسؤول') + (req.name ? ' — ' + req.name : '');
  return head('متابعة مؤشرات الأداء', nonce) + '<body><main>'
    + '<div id="hd"><h1>متابعة مؤشرات الأداء</h1>'
    + `<p class="meta">إلى: <bdi>${escapeHtml(to)}</bdi></p>`
    + (req.sender ? `<p class="meta">من: <bdi>${escapeHtml(req.sender)}</bdi></p>` : '')
    + `<p class="meta">الدورة: <bdi>${escapeHtml(req.cycle)}</bdi></p>`
    + '<p class="note">اختر حالة كل مؤشر، واكتب السبب لما لم يُنفَّذ أو هو قيد التنفيذ. يُحفظ ما تكتبه على جهازك إن أغلقت الصفحة، ولا يُرسل إلا عند الضغط على «إرسال الإجابة». الرابط يقبل إجابة واحدة وينتهي بعدها.</p></div>'
    + `<form id="lf" novalidate>${req.indicators.map((ind, k) => indicatorHtml(ind, k)).join('')}${slotsHtml(req.slots, found.taken)}`
    + '<button type="submit" id="sb">إرسال الإجابة</button><p class="msg" id="sm" role="alert" hidden></p></form>'
    + '<div id="st" class="center" hidden><h1>شكرًا لك، وصلت إجابتك</h1><p>هذه نسخة من إجابتك. لن يقبل هذا الرابط إجابة أخرى.</p><ul class="copy" id="cp"></ul></div>'
    + `</main><script nonce="${escapeHtml(nonce)}">${buildScript()}</script></body></html>`;
}

const defaultLimiter = createFailureLimiter();

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
    const gone = () => { limiter.fail(ip); return isPost ? sendJson(res, 404, { ok: false }) : sendHtml(res, 404, buildMessagePage(GONE_TITLE, 'هذا الرابط غير صالح أو انتهت مدته أو سبق استخدامه. شكرًا لك.', nonce), nonce); };
    if(typeof code !== 'string' || !CODE_RE.test(code)) return gone();

    let body = null;
    if(isPost){
      try { body = await readJsonBody(req); }
      catch(e){ return sendJson(res, e instanceof BodyError ? e.status : 400, { ok: false }); }
    }

    const createClient = opts.createClient || require('@supabase/supabase-js').createClient;
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    let found;
    try { found = await resolveLeaderCode(code, supabase); } catch(e){ found = null; }
    if(!found) return isPost ? sendJson(res, 503, { ok: false }) : sendHtml(res, 503, buildMessagePage('الخدمة غير متاحة', 'حاول لاحقًا.', nonce), nonce);
    if(!found.ok) return gone();

    if(!isPost) return sendHtml(res, 200, buildLeaderPage(found, nonce), nonce);

    const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const v = leaderValidateAnswers(found.req.indicators, b.a);
    if(!v.ok) return sendJson(res, 400, { ok: false });
    let slot = null;
    if(found.req.slots.length){
      if(typeof b.slot !== 'string' || !(b.slot === LEADER_SLOT_NONE || found.req.slots.indexOf(b.slot) >= 0)) return sendJson(res, 400, { ok: false });
      slot = b.slot;
    } else if(b.slot !== undefined && b.slot !== null) return sendJson(res, 400, { ok: false });
    let rpc;
    try { rpc = await supabase.rpc('submit_leader_followup', { p_code: code, p_answers: v.value, p_slot: slot }); } catch(e){ rpc = { error: e }; }
    if(rpc.error) return sendJson(res, 503, { ok: false });
    if(rpc.data === 'slot_taken') return sendJson(res, 409, { ok: false, error: 'slot_taken' });
    if(rpc.data !== 'ok') return gone();
    return sendJson(res, 200, { ok: true });
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.resolveLeaderCode = resolveLeaderCode;
module.exports.buildLeaderPage = buildLeaderPage;
module.exports.BODY_MAX_BYTES = BODY_MAX_BYTES;
