'use strict';
/* ============================================================
   رابط الاطلاع على الشواهد للإدارة (المرحلة الثالثة)
   ------------------------------------------------------------
   المعلم ينشئ رابط قراءة فقط /p/<رمز> (api/p.js) لشواهد دورة الأداء الحالية مرتبة بالعناصر،
   ويرسله لمديره أو مشرفه بنفسه (نسخ أو واتساب). لا يحتاج المستلم حسابًا ولا يستطيع التعديل.
   - الدخول: «⋯» بشاشة الشواهد ← «رابط اطلاع للإدارة».
   - المدة 7 أو 30 أو 90 يومًا (القاعدة تقبل حتى 120)، والإلغاء بحذف السجل (لا توابع: بلا سلة — DELETE-POLICY.md)
     بنقرتين داخل النافذة نفسها (تأكيد فوق النافذة كان يستبدلها: درس 3.38).
   - الروابط المنتهية تُحذف عند فتح النافذة. كل استعلام بتصفية المعلم صراحةً.
   ============================================================ */

const PORTFOLIO_DAYS = [7, 30, 90];
const PORTFOLIO_LABEL_MAX = 60;

let pfState = null;   /* { token, links, days, busy, confirmId } — null = النافذة مغلقة */
let pfToken = 0;

function portfolioResetState(){ pfState = null; pfToken++; }

function portfolioLinkUrl(code){
  const origin = (typeof location !== 'undefined' && location.origin && /^https?:/.test(location.origin)) ? location.origin : '';
  return origin + '/p/' + code;
}

/* دالة صرفة: نص رسالة واتساب للمستلم */
function portfolioWaText(url, cycle){
  return `السلام عليكم، هذا رابط للاطلاع على شواهد أدائي الوظيفي لدورة ${cycle} (للقراءة فقط):\n${url}`;
}

/* دالة صرفة: صف الرابط الجديد */
function buildPortfolioShareRow(o){
  const days = PORTFOLIO_DAYS.includes(o.days) ? o.days : 30;
  return {
    teacher_id: o.uid,
    code: o.code,
    label: String(o.label || '').trim().slice(0, PORTFOLIO_LABEL_MAX) || null,
    cycle_year: o.cycleYear,
    expires_at: new Date(o.nowMs + days * 86400000).toISOString()
  };
}

function pfOpen(){ return !!pfState && pfState.token === pfToken; }

async function showPortfolioLinks(){
  if(!currentUser) return;
  pfToken++;
  pfState = { token: pfToken, links: null, days: 30, busy: false, confirmId: null, error: false };
  showInfoModal('<div id="pfBody" style="text-align:right;"><div class="loading-state">جارِ التحميل...</div></div>', '460px');
  /* إغلاق النافذة ينهي الحالة: أي نتيجة متأخرة تُهمل */
  const cancel = document.getElementById('confirmCancelBtn');
  const tok = pfToken;
  const onClose = () => { if(pfState && pfState.token === tok) pfState = null; cancel.removeEventListener('click', onClose); };
  cancel.addEventListener('click', onClose);
  await pfLoad();
}

async function pfLoad(){
  const st = pfState;
  if(!st) return;
  const uid = currentUser.id;
  /* تنظيف المنتهي (غير حرج) ثم القائمة */
  try{ await sb.from('portfolio_shares').delete().eq('teacher_id', uid).lt('expires_at', new Date().toISOString()); } catch(e){}
  const { data, error } = await sb.from('portfolio_shares').select('id, code, label, cycle_year, expires_at, created_at')
    .eq('teacher_id', uid).order('created_at', { ascending: false });
  if(pfState !== st || !pfOpen() || !currentUser || currentUser.id !== uid) return;
  st.links = error ? [] : (data || []);
  st.error = !!error;
  pfRender();
}

function pfDateText(iso){
  const d = String(iso || '').slice(0, 10);
  return typeof shortDateAr === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? shortDateAr(d) : d;
}

function pfRender(){
  const st = pfState;
  const box = document.getElementById('pfBody');
  if(!st || !box) return;
  const cycle = getCycleYear();
  const links = st.links || [];
  const rows = links.map(l => {
    const url = portfolioLinkUrl(l.code);
    const confirming = st.confirmId === l.id;
    return `<div class="tlx-ans">
        <div class="tlx-ans-top"><span>${escapeHtml(l.label || 'رابط بلا اسم')}</span><span class="tlx-pill is-ok">حتى ${escapeHtml(pfDateText(l.expires_at))}</span></div>
        <small>دورة ${escapeHtml(l.cycle_year)}</small>
        <div class="tlx-link"><span>${escapeHtml(url)}</span><button type="button" onclick="pfCopy('${escapeHtml(l.id)}')">نسخ</button></div>
        <div class="tlx-btns pf-acts">
          <a class="tlx-btn is-wa" href="https://wa.me/?text=${encodeURIComponent(portfolioWaText(url, l.cycle_year))}" target="_blank" rel="noopener noreferrer">إرسال واتساب</a>
          <button type="button" class="tlx-btn is-ghost pf-revoke${confirming ? ' is-confirm' : ''}" ${st.busy ? 'disabled' : ''} onclick="pfRevoke('${escapeHtml(l.id)}')">${confirming ? 'تأكيد الإلغاء' : 'إلغاء الرابط'}</button>
        </div>
      </div>`;
  }).join('');
  box.innerHTML = `
    <h3 style="margin:0 0 6px;font-size:15px;color:var(--navy);">رابط اطلاع للإدارة</h3>
    <p class="tlx-note">رابط للقراءة فقط يفتح شواهد دورة ${escapeHtml(cycle)} مرتبة بعناصر الأداء، لمديرك أو مشرفك. لا يحتاج حسابًا، ولا يستطيع أحد التعديل، وتلغيه متى شئت. يرى المستلم شواهدك كما هي (بصورها ونصوصها).</p>
    ${st.error ? '<p class="tlx-note">تعذّر تحميل روابطك السابقة — تحقق من الاتصال.</p>' : ''}
    ${links.length ? `<div class="tlx-sec">روابطك الحالية (${links.length})</div><div class="tlx-box">${rows}</div>` : ''}
    <div class="tlx-sec">رابط جديد</div>
    <div class="tlx-lbl">لمن؟ <small>اختياري — يساعدك تميّز الروابط</small></div>
    <input id="pfLabel" class="tlx-inp" maxlength="${PORTFOLIO_LABEL_MAX}" placeholder="مثال: مدير المدرسة">
    <div class="tlx-lbl">مدة الرابط</div>
    <div class="tlx-seg">${PORTFOLIO_DAYS.map(d => `<button type="button" class="${st.days === d ? 'is-on' : ''}" onclick="pfSetDays(${d})">${d} يومًا</button>`).join('')}</div>
    <button type="button" id="pfCreateBtn" class="tlx-btn is-navy" style="margin-top:12px;" ${st.busy ? 'disabled' : ''} onclick="pfCreate()">إنشاء الرابط</button>`;
}

function pfSetDays(d){
  if(!pfState || !PORTFOLIO_DAYS.includes(d)) return;
  const lbl = document.getElementById('pfLabel');
  const keep = lbl ? lbl.value : '';
  pfState.days = d;
  pfRender();
  const l2 = document.getElementById('pfLabel');
  if(l2) l2.value = keep;
}

async function pfCreate(){
  const st = pfState;
  if(!st || st.busy || !currentUser) return;
  if(!navigator.onLine){ showToast('لا يوجد اتصال بالإنترنت', 'error'); return; }
  const uid = currentUser.id;
  const lbl = document.getElementById('pfLabel');
  const label = lbl ? lbl.value : '';
  /* التعطيل قبل أي await (CLAUDE.md §6) */
  st.busy = true;
  const btn = document.getElementById('pfCreateBtn');
  if(btn) btn.disabled = true;
  try{
    const row = () => buildPortfolioShareRow({ uid, code: reportShareCode(), label, cycleYear: getCycleYear(), days: st.days, nowMs: Date.now() });
    let ins = await sb.from('portfolio_shares').insert(row()).select('id, code, label, cycle_year, expires_at, created_at').single();
    if(ins.error && String(ins.error.code) === '23505') ins = await sb.from('portfolio_shares').insert(row()).select('id, code, label, cycle_year, expires_at, created_at').single();
    if(ins.error) throw ins.error;
    if(pfState !== st || !currentUser || currentUser.id !== uid) return;
    st.links = [ins.data].concat(st.links || []);
    showToast('أُنشئ الرابط — انسخه أو أرسله بواتساب', 'ok');
  } catch(e){
    const missing = /portfolio_shares/.test(String(e && e.message)) && /does not exist|schema cache/i.test(String(e && e.message));
    showToast(missing ? 'الميزة تحتاج تحديث قاعدة البيانات أولًا (تواصل مع المسؤول)' : 'تعذّر إنشاء الرابط: ' + ((e && e.message) || ''), 'error');
  } finally {
    st.busy = false;
    if(pfState === st) pfRender();
  }
}

async function pfCopy(id){
  const st = pfState;
  const l = st && (st.links || []).find(x => x.id === id);
  if(!l) return;
  const url = portfolioLinkUrl(l.code);
  try{
    await navigator.clipboard.writeText(url);
    showToast('نُسخ الرابط', 'ok');
  } catch(e){
    showToast('تعذّر النسخ — انسخ الرابط يدويًا', 'error');
  }
}

/* الإلغاء بنقرتين داخل النافذة: الأولى تحوّل الزر لـ«تأكيد الإلغاء»، والثانية تحذف */
async function pfRevoke(id){
  const st = pfState;
  if(!st || st.busy || !currentUser) return;
  if(st.confirmId !== id){ st.confirmId = id; pfRender(); return; }
  const uid = currentUser.id;
  st.busy = true;
  pfRender();
  const { error } = await sb.from('portfolio_shares').delete().eq('teacher_id', uid).eq('id', id);
  st.busy = false;
  st.confirmId = null;
  if(pfState !== st) return;
  if(error){ showToast('تعذّر الإلغاء: ' + error.message, 'error'); pfRender(); return; }
  st.links = (st.links || []).filter(x => x.id !== id);
  showToast('أُلغي الرابط — لم يعد يفتح', 'ok');
  pfRender();
}
