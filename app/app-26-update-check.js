/* ============================================================
   نافذة "تحديث جديد متاح" (بطلب صاحب التطبيق)
   ------------------------------------------------------------
   تطبيق الجوال يبقى مفتوحًا في الخلفية ساعات وأيامًا فلا يرى النسخة الجديدة.
   الحل: version.json (رقم الإصدار وما الجديد) يُقرأ من الشبكة مباشرة عند فتح
   التطبيق، وعند العودة إليه، وكل نصف ساعة؛ فإن كان أحدث من APP_VERSION تظهر
   نافذة من الأسفل بما الجديد و"تحديث الآن" / "لاحقًا".
   - لا تظهر أثناء ورقة رصد مفتوحة — تنتظر خروج المعلم منها.
   - "تحديث الآن" ينتظر اكتمال أي حفظ جارٍ ثم يعيد فتح التطبيق.
   - "لاحقًا" يؤجلها ساعة لنفس الإصدار.
   APP_VERSION يُرفع مع version.json في كل تحديث (اختبار يتحقق من تطابقهما).
   ============================================================ */
const APP_VERSION = '1.7';
const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
const UPDATE_SNOOZE_MS = 60 * 60 * 1000;
const UPDATE_SNOOZE_KEY = 'shahid_update_snooze';

let pendingUpdate = null;   /* { version, date, notes } أحدث من النسخة المفتوحة */
let updateSheetShown = false;
let updateApplying = false;

/* دالة صرفة: مقارنة "1.10" و"1.9" رقميًا جزءًا جزءًا */
function compareVersions(a, b){
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){
    const d = (pa[i] || 0) - (pb[i] || 0);
    if(d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate(){
  try{
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if(!res || !res.ok) return null;
    const info = await res.json();
    if(!info || typeof info.version !== 'string' || compareVersions(info.version, APP_VERSION) <= 0) return null;
    pendingUpdate = { version: info.version, date: String(info.date || ''), notes: Array.isArray(info.notes) ? info.notes.filter(n => typeof n === 'string').slice(0, 6) : [] };
    maybeShowUpdateSheet();
    return pendingUpdate;
  } catch(e){ return null; } /* بلا إنترنت: لا شيء — يُعاد الفحص لاحقًا */
}

function updateSnoozed(version){
  try{
    const s = JSON.parse(localStorage.getItem(UPDATE_SNOOZE_KEY) || 'null');
    return !!(s && s.version === version && Number(s.until) > Date.now());
  } catch(e){ return false; }
}

/* تظهر إن وُجد تحديث، ولم تُؤجَّل، ولا ورقة رصد مفتوحة (تُستدعى أيضًا عند إغلاق الورقة) */
function maybeShowUpdateSheet(){
  const u = pendingUpdate;
  if(!u || updateSheetShown || updateApplying || updateSnoozed(u.version)) return;
  if(typeof crmSheet !== 'undefined' && crmSheet) return;
  updateSheetShown = true;
  const box = document.createElement('div');
  box.id = 'updateSheet';
  box.className = 'upd-wrap';
  box.innerHTML = `<div class="upd-dim" onclick="snoozeUpdate()"></div>
    <div class="upd-sheet" role="dialog" aria-modal="true" aria-labelledby="updTitle">
      <div class="upd-grab"></div>
      <div class="upd-head"><div class="upd-ic" aria-hidden="true">🔄</div>
        <div><div class="upd-title" id="updTitle">تحديث جديد متاح</div>
          <span class="upd-ver">الإصدار ${escapeHtml(u.version)}</span> <span class="upd-sub">· إصدارك ${escapeHtml(APP_VERSION)}</span></div></div>
      ${u.notes.length ? `<div class="upd-new">ما الجديد:</div><ul class="upd-notes">${u.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      <div class="upd-btns">
        <button type="button" class="btn btn-primary" id="updNowBtn" onclick="applyUpdate()">تحديث الآن</button>
        <button type="button" class="btn btn-outline" onclick="snoozeUpdate()">لاحقًا</button>
      </div>
      <div class="upd-safe">رصدك محفوظ — التحديث لا يمسح شيئًا</div>
    </div>`;
  document.body.appendChild(box);
}

function closeUpdateSheet(){
  const el = document.getElementById('updateSheet');
  if(el && el.remove) el.remove();
  updateSheetShown = false;
}

function snoozeUpdate(){
  if(updateApplying) return;
  try{ if(pendingUpdate) localStorage.setItem(UPDATE_SNOOZE_KEY, JSON.stringify({ version: pendingUpdate.version, until: Date.now() + UPDATE_SNOOZE_MS })); } catch(e){}
  closeUpdateSheet();
}

/* ينتظر اكتمال أي حفظ جارٍ في ورقة الحصة (إن وُجد) ثم يعيد الفتح بالنسخة الجديدة.
   مسودة الحضور محفوظة على الجهاز أصلًا وتعود عند فتح نفس الحصة. */
async function applyUpdate(){
  if(updateApplying) return;
  updateApplying = true;
  const btn = document.getElementById('updNowBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ حفظ رصدك ثم التحديث…'; }
  try{
    if(typeof crmSheet !== 'undefined' && crmSheet && typeof crmSheetPendingWrites === 'function'){
      await Promise.allSettled(crmSheetPendingWrites(crmSheet));
    }
  } finally {
    location.reload();
  }
}

function initUpdateChecks(){
  setTimeout(checkForUpdate, 3000);
  setInterval(checkForUpdate, UPDATE_CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') checkForUpdate(); });
}
/* في المتصفح فقط (بيئة الاختبار لا تطلق DOMContentLoaded فلا مؤقّتات تبقى معلّقة) */
document.addEventListener('DOMContentLoaded', initUpdateChecks);
