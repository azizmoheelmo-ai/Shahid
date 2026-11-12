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

/* هوية واجهة التطبيق (DESIGN.md) — نفس الألوان والزوايا، بخط الجهاز (CSP: default-src 'none' بلا خطوط خارجية) */
const CSS = ':root{--navy:#1B3245;--gold:#A9852E;--gold-text:#876A25;--paper:#F7F5F0;--card:#fff;--line:#D8D2C4;--ink:#232323;--muted:#6B6659;'
  + '--div:#EEE9DF;--track:#F3F0E8;--tab:#6B6457;--icon:#F1ECDF;--ok:#2F6B4F;--warn:#876A25;--danger:#8A2C2C;--danger-bg:#FBE9E7;'
  + '--note-bg:#FBF6E8;--note-line:#E4D3A2;--note-ink:#5E4A16;--add:#FBFAF6;--r-card:14px;--r-btn:11px}'
  + 'body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:0 14px 24px;line-height:1.8}'
  + 'main{max-width:560px;margin:0 auto}[hidden]{display:none!important}'
  + '.hero{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:14px;margin-top:14px}'
  + '.kick{display:block;font-size:.78rem;font-weight:700;color:var(--gold-text)}'
  + 'h1{font-size:1.3rem;color:var(--navy);margin:0 0 8px;line-height:1.5}'
  + '.meta{display:flex;gap:8px;margin:0;padding:6px 0;border-top:1px solid var(--div);font-size:.92rem}'
  + '.meta span{flex:none;width:52px;color:var(--muted)}.meta bdi{color:var(--navy);font-weight:700}'
  + '.note{background:var(--note-bg);border:1px solid var(--note-line);border-radius:12px;padding:10px 12px;font-size:.9rem;color:var(--note-ink);margin:10px 0 0}'
  + '.pg{position:sticky;top:0;z-index:5;background:var(--paper);padding:10px 2px 8px;margin-top:4px}'
  + '.pg p{display:flex;justify-content:space-between;margin:0 0 4px;font-size:.85rem;color:var(--muted)}.pg b{color:var(--navy)}'
  + '.pg i{display:block;height:6px;background:var(--div);border-radius:4px;overflow:hidden}.pg i em{display:block;height:6px;width:0;background:var(--ok);border-radius:4px;transition:width .2s}'
  + 'fieldset{border:1px solid var(--line);border-radius:var(--r-card);background:var(--card);margin:10px 0;padding:12px;min-width:0;scroll-margin-top:70px}'
  + 'legend{float:right;width:100%;display:flex;align-items:flex-start;gap:8px;padding:0;margin:0 0 10px;font-weight:700;color:var(--navy);font-size:.98rem;line-height:1.6}'
  + 'legend+*{clear:both}.n{flex:none;min-width:24px;height:24px;border-radius:6px;background:var(--icon);color:var(--navy);font-size:.78rem;font-weight:800;display:grid;place-items:center;margin-top:1px}'
  /* البلاطة تنطوي (fieldset.cl): يبقى رأسها فقط — الرقم بلون الحالة، والمؤشر، وأول السبب، وشارة الحالة */
  + 'fieldset[data-i] legend{margin:0}button.tg{display:flex;align-items:flex-start;gap:8px;width:100%;min-height:0;margin:0;padding:2px 0;border:0;border-radius:8px;background:none;color:var(--navy);font:inherit;font-weight:700;font-size:.98rem;line-height:1.6;text-align:start;box-shadow:none}'
  + '.tx{flex:1;min-width:0}.tx bdi{display:block}.pr{display:none;font-weight:400;font-size:.8rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.pv{flex:none;font-size:.75rem;font-weight:700;border-radius:999px;padding:1px 9px;margin-top:3px}.pv:empty{display:none}'
  + '.pv.p-done{background:#E7F0EA;color:var(--ok)}.pv.p-wip{background:#F6EFD9;color:var(--warn)}.pv.p-no{background:var(--danger-bg);color:var(--danger)}'
  + '.n.n-done{background:var(--ok);color:#fff}.n.n-wip{background:var(--warn);color:#fff}.n.n-no{background:var(--danger);color:#fff}'
  + '.ch{flex:none;color:var(--muted);font-size:.85rem;margin-top:3px;transition:transform .2s}fieldset.cl .ch{transform:rotate(180deg)}'
  + '.bd{clear:both;padding-top:10px}fieldset.cl .bd{display:none}fieldset.cl .pr{display:block}fieldset.cl{padding:10px 12px}'
  /* 3.50: قائمة معايير المؤشر — يحدّد المسؤول ما نُفِّذ منها */
  + '.crh{margin:0 2px 6px;font-size:.8rem;font-weight:800;color:var(--gold-text)}.cr{border:1px solid var(--div);border-radius:var(--r-btn);overflow:hidden;margin-bottom:10px}'
  + '.ck{display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--div);cursor:pointer;font-size:.92rem;line-height:1.6}.ck:first-child{border-top:0}'
  + '.ck input{appearance:none;-webkit-appearance:none;flex:none;width:22px;height:22px;margin:0;border:1.5px solid var(--line);border-radius:6px;background:var(--card);display:grid;place-items:center;cursor:pointer}'
  + '.ck input:checked{background:var(--ok);border-color:var(--ok)}.ck input:checked::after{content:"\\2713";color:#fff;font-size:.8rem;font-weight:800}'
  + '.ck input:focus-visible{outline:3px solid var(--gold);outline-offset:2px}'
  + 'button.dn{display:block;width:auto;min-height:38px;margin:10px 0 0 auto;margin-inline-start:auto;padding:6px 18px;background:var(--card);color:var(--navy);border:1px solid var(--line);border-radius:10px;font-size:.9rem}'
  + 'fieldset.miss{border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-bg)}'
  + '.opts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;padding:3px;background:var(--track);border-radius:var(--r-btn)}'
  + '.opts.col{grid-template-columns:1fr;gap:6px;padding:0;background:none}'
  + '.opt{position:relative;display:block;cursor:pointer}.opt input{position:absolute;opacity:0;width:1px;height:1px;margin:0}'
  + '.opt span{display:flex;align-items:center;justify-content:center;min-height:42px;text-align:center;border-radius:9px;padding:6px 4px;font-size:.92rem;font-weight:700;color:var(--tab)}'
  + '.opts.col .opt span{justify-content:flex-start;text-align:start;padding:10px 12px;font-size:.95rem;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:var(--r-btn)}'
  + '.opt input:checked+span{color:#fff;box-shadow:0 2px 6px rgba(27,50,69,.25)}.opt .s-done:checked+span{background:var(--ok)}'
  + '.opt .s-wip:checked+span{background:var(--warn)}.opt .s-no:checked+span{background:var(--danger)}'
  + '.opts.col .opt .s-slot:checked+span{background:var(--navy);border-color:var(--navy);color:#fff}.opt input:disabled+span{opacity:.5;background:var(--track);cursor:not-allowed}'
  + '.opt input:focus-visible+span{outline:3px solid var(--gold);outline-offset:2px}'
  + 'textarea{width:100%;box-sizing:border-box;min-height:72px;border:1px solid var(--line);border-radius:var(--r-btn);padding:10px 12px;font:inherit;margin-top:10px;background:var(--card);color:var(--ink)}'
  + 'textarea:focus,.prop input:focus{outline:none;border-color:var(--gold)}'
  + '.cnt{display:block;direction:ltr;text-align:left;font-size:.75rem;color:var(--muted)}'
  + '.prop{margin-top:10px;padding:10px 12px;border:1px dashed var(--line);border-radius:var(--r-btn);background:var(--add)}.prop label{display:block;font-size:.88rem;font-weight:700;color:var(--navy);margin:6px 0 4px}'
  + '.prop input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:var(--r-btn);padding:9px 12px;font:inherit;background:var(--card)}'
  + '.acts{position:sticky;bottom:0;z-index:5;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--paper);padding:10px 0 calc(10px + env(safe-area-inset-bottom,0px));margin-top:8px;border-top:1px solid var(--div)}'
  + 'button{width:100%;margin:0;padding:12px;border:0;border-radius:12px;background:var(--navy);color:#fff;font:inherit;font-size:1rem;font-weight:700;cursor:pointer;min-height:48px}'
  + 'button.sec{background:var(--card);color:var(--navy);border:1px solid var(--line);font-size:.92rem}'
  + 'button[disabled]{opacity:.6;cursor:wait}button:focus-visible{outline:3px solid var(--gold);outline-offset:2px}'
  + '.msg{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:var(--danger-bg);font-weight:600;color:var(--danger)}'
  + '.ok{margin:10px 0 0;padding:10px 12px;border-radius:12px;background:#E7F0EA;font-weight:600;color:var(--ok)}'
  + '.center{text-align:center;padding-top:8vh}.center h1{margin-top:12px}.center p{color:var(--muted)}'
  + '.done-ic{width:56px;height:56px;margin:0 auto;border-radius:50%;background:#E7F0EA;color:var(--ok);display:grid;place-items:center;font-size:1.6rem;font-weight:800}'
  + '.copy{background:var(--card);border:1px solid var(--line);border-radius:var(--r-card);padding:0;margin:14px 0 0;text-align:start;overflow:hidden}'
  + '.copy li{margin:0;padding:10px 12px;list-style:none;border-bottom:1px solid var(--div)}.copy li:last-child{border-bottom:0}'
  + '.copy b{display:block;color:var(--navy)}.copy small{color:var(--muted);display:block}';

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
function st(fs){var x=fs.querySelector('input[type=radio]:checked');return x?x.value:'';}
function cs(fs){return Array.prototype.slice.call(fs.querySelectorAll('.ck input:checked')).map(function(i){return i.value;});}
function ct(fs){var t=fs.querySelectorAll('.ck input').length;return t?cs(fs).length+' من '+t:'';}
function sync(fs){var s=st(fs),box=fs.querySelector('.rs'),ta=fs.querySelector('textarea');box.hidden=!s&&!ta.value;
ta.placeholder=s==='done'?'ملاحظة (اختياري)':'اكتب السبب (مطلوب)';head(fs);prog();}
function head(fs){var s=st(fs),r=fs.querySelector('textarea').value.trim(),pv=fs.querySelector('.pv'),pr=fs.querySelector('.pr');
fs.querySelector('.n').className='n'+(s?' n-'+s:'');pv.className='pv'+(s?' p-'+s:'');pv.textContent=s?L[s]:'';pr.textContent=[s||cs(fs).length?ct(fs):'',r].filter(Boolean).join(' · ');fs.querySelector('.dn').hidden=!s;}
function fold(fs,c){fs.classList.toggle('cl',c);fs.querySelector('.tg').setAttribute('aria-expanded',c?'false':'true');}
function nextOpen(fs){var i=items.indexOf(fs),n=items.slice(i+1).concat(items.slice(0,i)).filter(function(x){return !st(x);})[0];
var t=n||slotFs||b;if(n)fold(n,false);t.scrollIntoView({behavior:'smooth',block:'start'});}
function finish(fs){var s=st(fs),ta=fs.querySelector('textarea');if(!s)return;if(s!=='done'&&!ta.value.trim()){fs.classList.add('miss');ta.focus();return;}
fs.classList.remove('miss');fold(fs,true);nextOpen(fs);}
function prog(){var n=items.filter(function(x){return !!st(x);}).length,e=document.getElementById('pgn'),g=document.getElementById('pgb');if(e)e.textContent=n;if(g)g.style.width=(items.length?Math.round(n*100/items.length):0)+'%';}
function collect(){var a={};items.forEach(function(fs){var s=st(fs),r=fs.querySelector('textarea').value,c=cs(fs),y={s:s};if(r.trim())y.r=r;if(c.length)y.c=c;
if(s||r.trim()||c.length)a[fs.getAttribute('data-i')]=y;});
var sl=slotFs&&slotFs.querySelector('input:checked');return {a:a,slot:sl?sl.value:null,p:ppd?ppd.value:'',n:ppn?ppn.value:''};}
function save(){try{var x=collect();x.t=Date.now();localStorage.setItem(KEY,JSON.stringify(x));}catch(e){}}
function restore(){try{var x=JSON.parse(localStorage.getItem(KEY)||'null');if(!x||!x.a||!(x.t>SAVED))return;
items.forEach(function(fs){var y=x.a[fs.getAttribute('data-i')];fs.querySelectorAll('input').forEach(function(i){i.checked=false;});fs.querySelector('textarea').value='';
if(y){if(y.s){var r=fs.querySelector('input[type=radio][value="'+y.s+'"]');if(r)r.checked=true;}
if(Array.isArray(y.c))fs.querySelectorAll('.ck input').forEach(function(i){i.checked=y.c.indexOf(i.value)>=0;});if(typeof y.r==='string')fs.querySelector('textarea').value=y.r.slice(0,MAXR);}
var c=fs.querySelector('.cnt');c.textContent=len(fs.querySelector('textarea').value)+' / '+MAXR;sync(fs);});
if(slotFs){var q=Array.prototype.slice.call(slotFs.querySelectorAll('input')).filter(function(i){return i.value===x.slot&&!i.disabled;})[0];
slotFs.querySelectorAll('input[name="slot"]').forEach(function(i){i.checked=false;});if(q)q.checked=true;
if(ppd&&typeof x.p==='string')ppd.value=x.p;if(ppn&&typeof x.n==='string')ppn.value=x.n;pTog();}}catch(e){}}
function clear(){try{localStorage.removeItem(KEY);}catch(e){}}
items.forEach(function(fs){var ta=fs.querySelector('textarea'),c=fs.querySelector('.cnt');
ta.addEventListener('input',function(){if(len(ta.value)>MAXR)ta.value=Array.from(ta.value).slice(0,MAXR).join('');c.textContent=len(ta.value)+' / '+MAXR;fs.classList.remove('miss');ok('');save();});
fs.addEventListener('change',function(e){fs.classList.remove('miss');sync(fs);ok('');save();if(e.target.type==='radio'&&st(fs)==='done')finish(fs);});
fs.querySelector('.tg').addEventListener('click',function(){fold(fs,!fs.classList.contains('cl'));});
fs.querySelector('.dn').addEventListener('click',function(){finish(fs);});sync(fs);});
if(slotFs){slotFs.addEventListener('change',function(){slotFs.classList.remove('miss');pTog();ok('');save();});
if(ppn)ppn.addEventListener('input',function(){ok('');save();});}
restore();
(function(){var first=items.filter(function(x){return !st(x);})[0];items.forEach(function(x){fold(x,x!==first);});})();
function lock(t,btn){busy=true;b.disabled=true;d.disabled=true;btn.textContent=t;}
function unlock(){busy=false;b.disabled=false;d.disabled=false;b.textContent='إرسال الإجابة';d.textContent='حفظ والإكمال لاحقًا';}
function post(body){return fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store'})
.then(function(res){return res.json().catch(function(){return {};}).then(function(j){return {s:res.status,j:j};});});}
function dead(o){if(o.s===404){b.textContent='تعذّر الإرسال';d.hidden=true;say('لا يمكن استلام إجابة عبر هذا الرابط: ربما أُرسلت إجابة سابقًا أو انتهت مدته.');return true;}
if(o.s===429){b.textContent='تعذّر الإرسال';d.hidden=true;say('محاولات كثيرة من هذا الجهاز. انتظر بضع دقائق ثم أعد فتح الرابط.');return true;}return false;}
d.addEventListener('click',function(){if(busy)return;say('');items.forEach(function(fs){fs.classList.remove('miss');});if(slotFs)slotFs.classList.remove('miss');var x=collect();
var a={};Object.keys(x.a).forEach(function(id){var y=x.a[id];a[id]=y.r?{s:y.s||null,r:y.r}:{s:y.s||null};if(y.c)a[id].c=y.c;});
lock('جارٍ الحفظ…',d);
post({draft:true,a:a,slot:x.slot}).then(function(o){if(o.j&&o.j.ok){unlock();save();
var n=items.filter(function(fs){return !!st(fs);}).length;ok('حُفظت إجاباتك ('+n+' من '+items.length+'). افتح الرابط نفسه لاحقًا من أي جهاز لتكملها، ثم اضغط «إرسال الإجابة».');return;}
if(dead(o))return;unlock();say(o.s===400?'تعذّر الحفظ: راجع النصوص المكتوبة (حتى '+MAXR+' حرف لكل سبب).':'تعذّر الحفظ الآن. حاول مرة أخرى بعد قليل (ما كتبته محفوظ على جهازك).');})
.catch(function(){unlock();say('تعذّر الاتصال. ما كتبته محفوظ على جهازك؛ حاول الحفظ مرة أخرى.');});});
function done(a,slotText){var ul=document.getElementById('cp');ul.textContent='';
items.forEach(function(fs){var li=document.createElement('li'),t=document.createElement('b'),s=document.createElement('small'),x=a[fs.getAttribute('data-i')];
t.textContent=fs.querySelector('.n').textContent+'. '+fs.querySelector('.tx bdi').textContent;s.textContent=L[x.s]+(ct(fs)?' · '+ct(fs):'')+(x.r?' — '+x.r:'');li.appendChild(t);li.appendChild(s);ul.appendChild(li);});
if(slotText){var li=document.createElement('li'),t=document.createElement('b'),s=document.createElement('small');t.textContent='موعد اللقاء';s.textContent=slotText;li.appendChild(t);li.appendChild(s);ul.appendChild(li);}
f.hidden=true;document.getElementById('hd').hidden=true;document.getElementById('pg').hidden=true;document.getElementById('st').hidden=false;window.scrollTo(0,0);}
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;
var a={},miss=[];
items.forEach(function(fs){fs.classList.remove('miss');var s=st(fs),r=fs.querySelector('textarea').value.trim();
if(!s||(s!=='done'&&!r)){miss.push(fs);return;}var y=r?{s:s,r:r}:{s:s};if(fs.querySelector('.ck'))y.c=cs(fs);a[fs.getAttribute('data-i')]=y;});
var slot=null,slotText='';
var prop=null,note='';
if(slotFs){slotFs.classList.remove('miss');var sx=slotFs.querySelector('input[name="slot"]:checked');if(!sx)miss.push(slotFs);else{slot=sx.value;slotText=sx.parentNode.textContent;
if(slot===NONE){prop=ppd&&ppd.value?ppd.value:null;note=ppn?ppn.value.trim():'';
slotText=prop?'اقترحتُ موعدًا آخر: '+lab(prop):'لا يناسبني أي موعد';if(note)slotText+=' — '+note;}}}
if(miss.length){miss.forEach(function(fs){fs.classList.add('miss');if(fs!==slotFs)fold(fs,false);});say('بقي '+miss.length+' مما يلزم قبل الإرسال (المميَّز باللون): حالة كل مؤشر، والسبب لما لم يُنفَّذ أو قيد التنفيذ، والموعد. إن أردت الإكمال لاحقًا اضغط «حفظ والإكمال لاحقًا».');
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
  /* 3.50: معايير المؤشر (إن وُجدت) — المحدَّد من مسودة الخادم يأتي مختارًا */
  const got = new Set(Array.isArray(x.c) ? x.c : []);
  const crit = (ind.criteria || []).length
    ? `<p class="crh">المعايير المطلوبة: حدّد ما نُفِّذ</p><div class="cr">${ind.criteria.map(c => `<label class="ck"><input type="checkbox" value="${escapeHtml(c.id)}"${got.has(c.id) ? ' checked' : ''}><span><bdi>${escapeHtml(c.label)}</bdi></span></label>`).join('')}</div>`
    : '';
  return `<fieldset data-i="${escapeHtml(ind.id)}"><legend><button type="button" class="tg" aria-expanded="true"><span class="n">${k + 1}</span> <span class="tx"><bdi>${escapeHtml(ind.label)}</bdi><small class="pr"></small></span><span class="pv"></span><span class="ch" aria-hidden="true">⌃</span></button></legend>`
    + `<div class="bd">${crit}<div class="opts">${states}</div>`
    + `<div class="rs"${x.s || r ? '' : ' hidden'}><textarea maxlength="${LEADER_LIMITS.maxReason}" aria-label="سبب أو ملاحظة">${escapeHtml(r)}</textarea><small class="cnt" aria-live="polite">${Array.from(r).length} / ${LEADER_LIMITS.maxReason}</small></div>`
    + `<button type="button" class="dn" hidden>تم</button></div></fieldset>`;
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
    + '<div id="hd"><div class="hero"><span class="kick">طلب متابعة</span><h1>متابعة مؤشرات الأداء</h1>'
    + `<p class="meta"><span>إلى</span><bdi>${escapeHtml(to)}</bdi></p>`
    + (req.sender ? `<p class="meta"><span>من</span><bdi>${escapeHtml(req.sender)}</bdi></p>` : '')
    + `<p class="meta"><span>الدورة</span><bdi>${escapeHtml(req.cycle)}</bdi></p></div>`
    + `<p class="note">اختر حالة كل مؤشر${req.indicators.some(i => (i.criteria || []).length) ? ' (وحدّد ما نُفِّذ من معاييره)' : ''}، واكتب السبب لما لم يُنفَّذ أو هو قيد التنفيذ. لا يلزمك الإكمال الآن: اضغط «حفظ والإكمال لاحقًا» ثم افتح الرابط نفسه متى شئت لتكمل. الرابط يقبل إرسالًا واحدًا وينتهي بعده`
    + (due ? `، ويبقى صالحًا حتى ${escapeHtml(due)}.` : '.') + '</p>'
    + (req.draft && Object.keys(draft.a).length ? `<p class="note">أكمل من حيث توقفت${n ? `: محفوظ ${n} من ${req.indicators.length}` : ''}.</p>` : '') + '</div>'
    + `<div class="pg" id="pg"><p><span>حدّدت <b id="pgn">${n}</b> من ${req.indicators.length}</span><span>مؤشرات</span></p><i><em id="pgb"></em></i></div>`
    + `<form id="lf" novalidate data-saved="${Number(req.savedAt) || 0}">${req.indicators.map((ind, k) => indicatorHtml(ind, k, draft.a[ind.id])).join('')}${slotsHtml(req.slots, found.taken, draft.slot)}`
    + '<p class="msg" id="sm" role="alert" hidden></p><p class="ok" id="sk" role="status" hidden></p>'
    + '<div class="acts"><button type="button" class="sec" id="sd">حفظ والإكمال لاحقًا</button><button type="submit" id="sb">إرسال الإجابة</button></div></form>'
    + '<div id="st" class="center" hidden><div class="done-ic" aria-hidden="true">✓</div><h1>شكرًا لك، وصلت إجابتك</h1><p>هذه نسخة من إجابتك. لن يقبل هذا الرابط إجابة أخرى.</p><ul class="copy" id="cp"></ul></div>'
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
