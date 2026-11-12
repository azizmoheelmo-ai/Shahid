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
   - المسودة: تُحفظ تلقائيًا بمتصفح المسؤول (localStorage)، وبزر «حفظ والإكمال لاحقًا» بالخادم (POST { draft: true, a, slot }
     ← save_leader_draft، لا يستهلك الرابط) فيكمل لاحقًا من أي جهاز؛ الصفحة تُعبّأ من مسودة الخادم، ومسودة الجهاز تغلبها إن كانت أحدث.
   متغيرات البيئة: SUPABASE_URL وSUPABASE_SERVICE_ROLE_KEY (نفس api/s.js).
   ============================================================ */

const nodeCrypto = require('crypto');
/* مساراتان حرفيتان ثابتتان: متتبّع ملفات Vercel يجمع الملفات مع الدالة تلقائيًا. */
const kit = require('../leader-kit.js');
const survey = require('./s.js');

const { leaderValidateIndicators, leaderValidateSlots, leaderValidateAnswers, leaderValidateDraft, leaderValidateMeeting, leaderSlotLabel, leaderDateLabel, leaderRoleLabel,
  LEADER_ANSWER_STATES, LEADER_SLOT_NONE, LEADER_LIMITS } = kit;
const { createFailureLimiter, clientIp, readJsonBody, BodyError, escapeHtml, sendHtml, sendJson, buildMessagePage,
  GONE_TITLE, GONE_MSG, BUSY_TITLE, BUSY_MSG } = survey;
const CODE_RE = survey.CODE_RE;
const BODY_MAX_BYTES = 16384;
const COLS = 'teacher_id, leader_role, leader_name, cycle_label, sender_name, indicators, slots, closes_at, answered_at, draft, draft_saved_at';

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
  /* مسودة الخادم: تُعاد للتحقق بنفس القواعد (لو تغيّرت القواعد بعد حفظها تُهمل بدل أن تكسر الصفحة) */
  let dv = row.draft ? leaderValidateDraft(iv.value, sv.value, row.draft) : null;
  /* عدّل المعلم الأوقات بعد أن حفظ المسؤول موعدًا: تبقى إجاباته ويُعاد اختيار الموعد فقط */
  if(dv && !dv.ok && row.draft && typeof row.draft === 'object') dv = leaderValidateDraft(iv.value, sv.value, { a: row.draft.a, slot: null });
  const savedAt = row.draft_saved_at ? new Date(row.draft_saved_at).getTime() : 0;
  return { ok: true, req: {
    role: leaderRoleLabel(row.leader_role), name: row.leader_name || '', cycle: row.cycle_label, sender: row.sender_name || '',
    indicators: iv.value, slots: sv.value, closesAt: row.closes_at,
    draft: dv && dv.ok ? dv.value : null, savedAt: isFinite(savedAt) ? savedAt : 0
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
  + '.prop{margin-top:10px;padding:10px;border:1px dashed #CFC8B6;border-radius:10px;background:#FBFAF6}.prop label{display:block;font-size:.88rem;margin:6px 0 4px}'
  + '.prop input{width:100%;box-sizing:border-box;border:1px solid #CFC8B6;border-radius:10px;padding:8px;font:inherit;background:#fff}'
  + 'button.sec{background:#fff;color:#1B3245;border:1.5px solid #1B3245;margin-top:10px}.ok{margin-top:12px;font-weight:600;color:#15803d}'
  + 'button[disabled]{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}'
  + '.msg{margin-top:12px;font-weight:600;color:#9a3b1f}.center{text-align:center;padding-top:12vh}[hidden]{display:none!important}'
  + '.copy{background:#fff;border:1px solid #E4DFD2;border-radius:12px;padding:6px 12px;text-align:start}.copy li{margin:8px 0;list-style:none}'
  + '.copy b{display:block}.copy small{color:#55697a;display:block}';

function head(title, nonce){
  return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
    + `<title>${escapeHtml(title)}</title><style nonce="${escapeHtml(nonce)}">${CSS}</style></head>`;
}

/* لا alert. الحالة والسبب لكل مؤشر، والموعد، ثم POST. المسودة بـlocalStorage (try/catch: قد يكون محجوبًا)
   بطابع زمني t، وتُطبَّق فقط إن كانت أحدث من مسودة الخادم (data-saved بالنموذج، والصفحة معبّأة منها أصلًا).
   «حفظ والإكمال لاحقًا» يرسل الإجابات الجزئية للخادم (draft: true) ولا يستهلك الرابط. */
function buildScript(){
  const labels = JSON.stringify(LEADER_ANSWER_STATES).replace(/</g, '\\u003c');
  return `(function(){
var L=${labels},NONE=${JSON.stringify(LEADER_SLOT_NONE)},MAXR=${LEADER_LIMITS.maxReason};
var D=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'],MO=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
function lab(v){var m=/^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})$/.exec(v||'');if(!m)return v;var h=+m[4],w=new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).getUTCDay();
return D[w]+' '+(+m[3])+' '+MO[+m[2]-1]+' '+(h%12===0?12:h%12)+':'+m[5]+(h<12?' ص':' م');}
var f=document.getElementById('lf'),b=document.getElementById('sb'),d=document.getElementById('sd'),m=document.getElementById('sm'),k=document.getElementById('sk'),busy=false,KEY='lfd:'+location.pathname;
var SAVED=+f.getAttribute('data-saved')||0;
var items=Array.prototype.slice.call(f.querySelectorAll('fieldset[data-i]')),slotFs=f.querySelector('fieldset[data-slots]');
var pp=document.getElementById('pp'),ppd=document.getElementById('ppd'),ppn=document.getElementById('ppn');
function pTog(){if(!pp)return;var x=slotFs.querySelector('input:checked');pp.hidden=!(x&&x.value===NONE);}
function say(t){m.textContent=t;m.hidden=!t;if(t)ok('');}
function ok(t){k.textContent=t;k.hidden=!t;}
function len(s){return Array.from(s).length;}
function st(fs){var x=fs.querySelector('input:checked');return x?x.value:'';}
function sync(fs){var s=st(fs),box=fs.querySelector('.rs'),ta=fs.querySelector('textarea');box.hidden=!s&&!ta.value;
ta.placeholder=s==='done'?'ملاحظة (اختياري)':'اكتب السبب (مطلوب)';}
function collect(){var a={};items.forEach(function(fs){var s=st(fs),r=fs.querySelector('textarea').value;if(s||r.trim())a[fs.getAttribute('data-i')]=r.trim()?{s:s,r:r}:{s:s};});
var sl=slotFs&&slotFs.querySelector('input:checked');return {a:a,slot:sl?sl.value:null,p:ppd?ppd.value:'',n:ppn?ppn.value:''};}
function save(){try{var x=collect();x.t=Date.now();localStorage.setItem(KEY,JSON.stringify(x));}catch(e){}}
function restore(){try{var x=JSON.parse(localStorage.getItem(KEY)||'null');if(!x||!x.a||!(x.t>SAVED))return;
items.forEach(function(fs){var y=x.a[fs.getAttribute('data-i')];fs.querySelectorAll('input').forEach(function(i){i.checked=false;});fs.querySelector('textarea').value='';
if(y){if(y.s){var r=fs.querySelector('input[value="'+y.s+'"]');if(r)r.checked=true;}if(typeof y.r==='string')fs.querySelector('textarea').value=y.r.slice(0,MAXR);}
var c=fs.querySelector('.cnt');c.textContent=len(fs.querySelector('textarea').value)+' / '+MAXR;sync(fs);});
if(slotFs){var q=Array.prototype.slice.call(slotFs.querySelectorAll('input')).filter(function(i){return i.value===x.slot&&!i.disabled;})[0];
slotFs.querySelectorAll('input[name="slot"]').forEach(function(i){i.checked=false;});if(q)q.checked=true;
if(ppd&&typeof x.p==='string')ppd.value=x.p;if(ppn&&typeof x.n==='string')ppn.value=x.n;pTog();}}catch(e){}}
function clear(){try{localStorage.removeItem(KEY);}catch(e){}}
items.forEach(function(fs){var ta=fs.querySelector('textarea'),c=fs.querySelector('.cnt');
ta.addEventListener('input',function(){if(len(ta.value)>MAXR)ta.value=Array.from(ta.value).slice(0,MAXR).join('');c.textContent=len(ta.value)+' / '+MAXR;fs.classList.remove('miss');ok('');save();});
fs.addEventListener('change',function(){fs.classList.remove('miss');sync(fs);ok('');save();});sync(fs);});
if(slotFs){slotFs.addEventListener('change',function(){slotFs.classList.remove('miss');pTog();ok('');save();});
if(ppn)ppn.addEventListener('input',function(){ok('');save();});}
restore();
function lock(t,btn){busy=true;b.disabled=true;d.disabled=true;btn.textContent=t;}
function unlock(){busy=false;b.disabled=false;d.disabled=false;b.textContent='إرسال الإجابة';d.textContent='حفظ والإكمال لاحقًا';}
function post(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});});}
function dead(o){if(o.s===404){b.textContent='تعذّر الإرسال';d.hidden=true;say('لا يمكن استلام إجابة عبر هذا الرابط: ربما أُرسلت إجابة سابقًا أو انتهت مدته.');return true;}
if(o.s===429){b.textContent='تعذّر الإرسال';d.hidden=true;say('محاولات كثيرة من هذا الجهاز. انتظر بضع دقائق ثم أعد فتح الرابط.');return true;}return false;}
d.addEventListener('click',function(){if(busy)return;say('');items.forEach(function(fs){fs.classList.remove('miss');});if(slotFs)slotFs.classList.remove('miss');var x=collect();
var a={};Object.keys(x.a).forEach(function(id){var y=x.a[id];a[id]=y.r?{s:y.s||null,r:y.r}:{s:y.s||null};});
lock('جارٍ الحفظ…',d);
post({draft:true,a:a,slot:x.slot}).then(function(o){if(o.j&&o.j.ok){unlock();save();
var n=items.filter(function(fs){return !!st(fs);}).length;ok('حُفظت إجاباتك ('+n+' من '+items.length+'). افتح الرابط نفسه لاحقًا من أي جهاز لتكملها، ثم اضغط «إرسال الإجابة».');return;}
if(dead(o))return;unlock();say(o.s===400?'تعذّر الحفظ: راجع النصوص المكتوبة (حتى '+MAXR+' حرف لكل سبب).':'تعذّر الحفظ الآن. حاول مرة أخرى بعد قليل (ما كتبته محفوظ على جهازك).');})
.catch(function(){unlock();say('تعذّر الاتصال. ما كتبته محفوظ على جهازك؛ حاول الحفظ مرة أخرى.');});});
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
var prop=null,note='';
if(slotFs){slotFs.classList.remove('miss');var sx=slotFs.querySelector('input[name="slot"]:checked');if(!sx)miss.push(slotFs);else{slot=sx.value;slotText=sx.parentNode.textContent;
if(slot===NONE){prop=ppd&&ppd.value?ppd.value:null;note=ppn?ppn.value.trim():'';
slotText=prop?'اقترحتُ موعدًا آخر: '+lab(prop):'لا يناسبني أي موعد';if(note)slotText+=' — '+note;}}}
if(miss.length){miss.forEach(function(fs){fs.classList.add('miss');});say('بقي '+miss.length+' مما يلزم قبل الإرسال (المميَّز باللون): حالة كل مؤشر، والسبب لما لم يُنفَّذ أو قيد التنفيذ، والموعد. إن أردت الإكمال لاحقًا اضغط «حفظ والإكمال لاحقًا».');
miss[0].scrollIntoView({behavior:'smooth',block:'center'});return;}
lock('جارٍ الإرسال…',b);say('');
post({a:a,slot:slot,proposed:prop,note:note||null}).then(function(o){if(o.j&&o.j.ok){clear();done(a,slotText);return;}
if(o.s===409){unlock();
var bad=slotFs&&slotFs.querySelector('input:checked');if(bad){bad.checked=false;bad.disabled=true;}save();
say('هذا الموعد حُجز للتو لشخص آخر. اختر موعدًا آخر ثم أرسل مرة أخرى (إجاباتك محفوظة).');slotFs.classList.add('miss');slotFs.scrollIntoView({behavior:'smooth',block:'center'});return;}
if(dead(o))return;unlock();say(o.s===400?'تعذّر الإرسال: ربما عدّل المعلم المؤشرات أو المواعيد للتو. أعد فتح الرابط (ما حفظته باقٍ) ثم أرسل.':'تعذّر الإرسال الآن. حاول مرة أخرى بعد قليل.');})
.catch(function(){unlock();say('تعذّر الاتصال. تحقق من الإنترنت وحاول مرة أخرى.');});});})();`;
}

function radio(name, value, cls, text, disabled, checked){
  return `<label class="opt"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}" class="${cls}"${disabled ? ' disabled' : ''}${checked ? ' checked' : ''}><span>${text}</span></label>`;
}

/* المؤشر معبّأ من مسودة الخادم (إن وُجدت): الحالة مختارة والسبب مكتوب (مهرَّب داخل textarea) */
function indicatorHtml(ind, k, saved){
  const x = saved || {};
  const states = Object.keys(LEADER_ANSWER_STATES).map(s => radio('s-' + ind.id, s, 's-' + s, escapeHtml(LEADER_ANSWER_STATES[s]), false, x.s === s)).join('');
  const r = typeof x.r === 'string' ? x.r : '';
  return `<fieldset data-i="${escapeHtml(ind.id)}"><legend>${k + 1}. <bdi>${escapeHtml(ind.label)}</bdi></legend>`
    + `<div class="opts">${states}</div>`
    + `<div class="rs"${x.s || r ? '' : ' hidden'}><textarea maxlength="${LEADER_LIMITS.maxReason}" aria-label="سبب أو ملاحظة">${escapeHtml(r)}</textarea><small class="cnt" aria-live="polite">${Array.from(r).length} / ${LEADER_LIMITS.maxReason}</small></div></fieldset>`;
}

function slotsHtml(slots, taken, savedSlot){
  if(!slots.length) return '';
  const set = new Set(taken);
  const items = slots.map(s => radio('slot', s, 's-slot', escapeHtml(leaderSlotLabel(s)) + (set.has(s) ? ' (محجوز)' : ''), set.has(s), savedSlot === s && !set.has(s)));
  items.push(radio('slot', LEADER_SLOT_NONE, 's-slot', 'لا يناسبني أي موعد منها (أقترح غيره)', false, savedSlot === LEADER_SLOT_NONE));
  return `<fieldset data-slots="1"><legend>اختر موعد اللقاء</legend><div class="opts col">${items.join('')}</div>`
    + `<div class="prop" id="pp"${savedSlot === LEADER_SLOT_NONE ? '' : ' hidden'}><label for="ppd">اقترح موعدًا يناسبك (اختياري)</label><input type="datetime-local" id="ppd">`
    + `<label for="ppn">ملاحظة (اختياري)</label><input type="text" id="ppn" maxlength="${LEADER_LIMITS.maxNote}" placeholder="مثل: بعد الحصة الرابعة"></div></fieldset>`;
}

/* الصفحة تُبنى من الطلب نفسه. نصوص المعلم (المؤشرات والاسم والدورة) ونص المسودة غير موثوقة: تُهرَّب وتُعزل اتجاهيًا بـ<bdi>. */
function buildLeaderPage(found, nonce){
  const req = found.req;
  const to = (req.role || 'المسؤول') + (req.name ? ' — ' + req.name : '');
  const draft = req.draft || { a: {}, slot: null };
  const due = req.closesAt ? leaderDateLabel(req.closesAt) : '';
  const n = Object.keys(draft.a).filter(id => draft.a[id].s).length;
  return head('متابعة مؤشرات الأداء', nonce) + '<body><main>'
    + '<div id="hd"><h1>متابعة مؤشرات الأداء</h1>'
    + `<p class="meta">إلى: <bdi>${escapeHtml(to)}</bdi></p>`
    + (req.sender ? `<p class="meta">من: <bdi>${escapeHtml(req.sender)}</bdi></p>` : '')
    + `<p class="meta">الدورة: <bdi>${escapeHtml(req.cycle)}</bdi></p>`
    + '<p class="note">اختر حالة كل مؤشر، واكتب السبب لما لم يُنفَّذ أو هو قيد التنفيذ. لا يلزمك الإكمال الآن: اضغط «حفظ والإكمال لاحقًا» ثم افتح الرابط نفسه متى شئت لتكمل. الرابط يقبل إرسالًا واحدًا وينتهي بعده'
    + (due ? `، ويبقى صالحًا حتى ${escapeHtml(due)}.` : '.') + '</p>'
    + (req.draft ? `<p class="note">أكمل من حيث توقفت: محفوظ ${n} من ${req.indicators.length}.</p>` : '') + '</div>'
    + `<form id="lf" novalidate data-saved="${Number(req.savedAt) || 0}">${req.indicators.map((ind, k) => indicatorHtml(ind, k, draft.a[ind.id])).join('')}${slotsHtml(req.slots, found.taken, draft.slot)}`
    + '<button type="submit" id="sb">إرسال الإجابة</button><button type="button" class="sec" id="sd">حفظ والإكمال لاحقًا</button>'
    + '<p class="msg" id="sm" role="alert" hidden></p><p class="ok" id="sk" role="status" hidden></p></form>'
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
    if(b.draft === true){
      /* حفظ مسودة جزئية: لا يستهلك الرابط؛ الدالة تتحقق مرة ثانية وترفض المُجاب عنه والمنتهي */
      const dv = leaderValidateDraft(found.req.indicators, found.req.slots, { a: b.a, slot: b.slot });
      if(!dv.ok) return sendJson(res, 400, { ok: false });
      let sr;
      try { sr = await supabase.rpc('save_leader_draft', { p_code: code, p_draft: dv.value }); } catch(e){ sr = { error: e }; }
      if(sr.error) return sendJson(res, 503, { ok: false });
      if(sr.data !== true) return gone();
      return sendJson(res, 200, { ok: true, saved: true });
    }
    const v = leaderValidateAnswers(found.req.indicators, b.a);
    if(!v.ok) return sendJson(res, 400, { ok: false });
    /* الموعد: من المقترحة، أو «لا يناسبني» مع اقتراح بديل وملاحظة اختياريين (نفس قواعد submit_leader_followup) */
    const mv = leaderValidateMeeting(found.req.slots, { slot: b.slot === undefined ? null : b.slot, proposed: b.proposed, note: b.note });
    if(!mv.ok) return sendJson(res, 400, { ok: false });
    let rpc;
    try { rpc = await supabase.rpc('submit_leader_followup', { p_code: code, p_answers: v.value, p_slot: mv.value.slot, p_proposed: mv.value.proposed, p_note: mv.value.note }); } catch(e){ rpc = { error: e }; }
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
