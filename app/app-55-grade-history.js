/* ============================================================
   سجل الدرجات والاستعادة (30 يومًا)
   ------------------------------------------------------------
   كل تغيير في درجات المعلم يحفظه مشغّل في القاعدة نفسها (جدول grade_history): القيمة قبل
   التغيير وبعده — فلا يتجاوزه خطأ في التطبيق ولا جهاز قديم ولا إعداد. من هنا يختار المعلم
   لحظة من سجل الشعبة فيرى ما سيرجع (معاينة لا تكتب شيئًا)، ثم «استعادة» تعيد الشعبة كما كانت
   قبلها، في معاملة واحدة بالقاعدة (grade_history_restore). والاستعادة نفسها تُسجَّل، فيُتراجع
   عنها من السجل نفسه. سبب الإنشاء: مسح «يبدأ من» القديم لدرجات معلمين (2026-11-17)، وخطة
   Supabase المجانية بلا نسخ احتياطية.

   قواعد:
   - كل نص من القاعدة (أسماء الطلاب، عناوين البنود) يمرّ بـescapeHtml.
   - اللحظة المختارة تُمرَّر برقمها في القائمة المحمّلة، لا بنص داخل onclick.
   - زر الاستعادة يتعطّل أثناء العملية (لا نقرة مزدوجة)، والشعبة تُثبَّت وقت المعاينة؛ بعد
     الاستعادة يُعاد رسم الكشف فقط إن كان الظاهر هو نفس الشعبة.
   ============================================================ */

const GRADE_HISTORY_DAYS = 30;
const GRADE_HISTORY_TBL_LABELS = {
  classroom_grade_scores: 'الكشف', classroom_grade_period_scores: 'الفترات', classroom_homework_status: 'الواجبات',
  classroom_task_students: 'المهام الأدائية', classroom_tool_marks: 'المكوّنات الخاصة'
};
const GRADE_HISTORY_STATUS = { submitted: 'سلّم', partial: 'ناقص', late: 'متأخر' };
const GRADE_HISTORY_PREVIEW_ROWS = 60;

let gradeHistoryCtx = null; /* { sectionId, moments: [...], at? } */
let gradeHistoryBusy = false;

/* ============ دوال صرفة ============ */
function gradeHistoryWhen(iso){
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '';
  return d.toLocaleString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
}

/* القيمة كما يفهمها المعلم */
function gradeHistoryValue(tbl, v){
  const empty = v === null || v === undefined || v === '';
  if(tbl === 'classroom_homework_status') return empty ? 'لم يسلّم' : (GRADE_HISTORY_STATUS[v] || String(v));
  if(tbl === 'classroom_task_students'){
    const s = empty ? '' : String(v).split('|')[0];
    return s === '' ? 'لم يُقيَّم' : formatScore(Number(s));
  }
  return empty ? 'لا درجة' : formatScore(Number(v));
}

function gradeHistoryMomentsHtml(moments){
  if(!(moments || []).length){
    return `<div class="tlx-box tlx-empty" style="padding:14px;text-align:center;"><b>لا تغييرات مسجّلة لهذه الشعبة بعد</b>
      <small style="display:block;color:var(--ui-body);margin-top:4px;">من الآن يُحفظ كل تغيير في درجاتها ${GRADE_HISTORY_DAYS} يومًا.</small></div>`;
  }
  return `<div class="tlx-box">${moments.map((m, i) => {
    const tbls = (m.tbls || []).map(t => GRADE_HISTORY_TBL_LABELS[t] || '').filter(Boolean).join('، ');
    const del = Number(m.deletes) > 0 ? `<span class="tlx-pill is-red">حذف ${Number(m.deletes)}</span>` : '';
    return `<button type="button" class="tlx-row" onclick="previewGradeRestore(${i})">
      <span class="tlx-row-main"><b>${escapeHtml(gradeHistoryWhen(m.at))}</b><small>${Number(m.changes)} تغيير · ${escapeHtml(tbls)}</small></span>${del}<span class="tlx-chev" aria-hidden="true">‹</span></button>`;
  }).join('')}</div>`;
}

function gradeHistoryPreviewHtml(res, sectionLabel, when){
  const items = (res && res.items) || [];
  const n = Number(res && res.changes) || 0;
  const head = `<h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">استعادة ${escapeHtml(sectionLabel)}</h3>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">كما كانت قبل: <b>${escapeHtml(when)}</b></div>`;
  if(!n){
    return head + `<p class="tlx-note">لا فرق: درجات الشعبة الآن كما كانت قبل هذه اللحظة.</p>
      <button type="button" class="tlx-btn is-ghost" style="margin-top:8px;" onclick="openGradeHistory()">→ رجوع للسجل</button>`;
  }
  const rows = items.slice(0, GRADE_HISTORY_PREVIEW_ROWS).map(x => `<div class="tlx-row" style="cursor:default;">
      <span class="tlx-row-main"><b>${escapeHtml(x.student || 'طالب محذوف')}</b><small>${escapeHtml(x.item || GRADE_HISTORY_TBL_LABELS[x.tbl] || '')}</small></span>
      <span class="gh-change"><span class="gh-now">${escapeHtml(gradeHistoryValue(x.tbl, x.now))}</span> ← <b class="gh-then">${escapeHtml(gradeHistoryValue(x.tbl, x.then))}</b></span></div>`).join('');
  const more = n > GRADE_HISTORY_PREVIEW_ROWS ? `<div class="gh-more">و${n - GRADE_HISTORY_PREVIEW_ROWS} تغييرًا آخر</div>` : '';
  return head + `<div class="tlx-sec" style="margin-top:0;">سيرجع ${n} ${n === 1 ? 'تغيير' : 'تغييرًا'} (الآن ← بعد الاستعادة)</div>
    <div class="tlx-box gh-list">${rows}${more}</div>
    <p class="tlx-note" style="margin:10px 0;">الاستعادة نفسها تُحفظ في السجل، فتستطيع التراجع عنها من هنا متى شئت.</p>
    <button type="button" class="tlx-btn is-navy" id="gradeRestoreBtn" onclick="applyGradeRestore()">استعادة</button>
    <button type="button" class="tlx-btn is-ghost" style="margin-top:8px;" onclick="openGradeHistory()">→ رجوع للسجل</button>`;
}

function gradeHistoryErrorText(error){
  const code = error && (error.code || '');
  if(code === 'PGRST202' || code === '42883' || code === '42P01') return 'سجل الدرجات يحتاج تحديث قاعدة البيانات أولًا (ملف التحديثات).';
  return 'تعذّر التحميل — أعد المحاولة';
}

/* ============ الشاشة ============ */
async function openGradeHistory(sectionIdArg){
  const sectionId = sectionIdArg || (gradeHistoryCtx && gradeHistoryCtx.sectionId) || (crmGrades && crmGrades.sectionId);
  if(!sectionId || !currentUser) return;
  const ctx = { sectionId, moments: [] };
  gradeHistoryCtx = ctx;
  const label = crmSectionLabel(sectionId);
  const head = `<h3 style="margin:0 0 2px;font-size:16px;color:var(--navy);">سجل الدرجات</h3>
    <div class="crm-gs-sub" style="margin-bottom:8px;">${escapeHtml(label)} · آخر ${GRADE_HISTORY_DAYS} يومًا</div>`;
  showInfoModal(`<div style="text-align:right;">${head}<div class="loading-state">جارٍ التحميل...</div></div>`, '440px');
  const { data, error } = await sb.rpc('grade_history_moments', { p_section: sectionId });
  if(gradeHistoryCtx !== ctx) return; /* فُتح سجل آخر أثناء التحميل */
  if(error){
    showInfoModal(`<div style="text-align:right;">${head}<p class="tlx-note">${escapeHtml(gradeHistoryErrorText(error))}</p></div>`, '440px');
    return;
  }
  ctx.moments = data || [];
  showInfoModal(`<div style="text-align:right;">${head}
    <p style="font-size:12px;color:var(--ui-body);line-height:1.8;margin:0 0 8px;">كل تغيير في درجات الشعبة محفوظ هنا. اختر لحظة لتعيد الشعبة كما كانت <b>قبلها</b> — ترى ما سيتغيّر قبل أي حفظ.</p>
    ${gradeHistoryMomentsHtml(ctx.moments)}</div>`, '440px');
}

async function previewGradeRestore(index){
  const ctx = gradeHistoryCtx;
  const m = ctx && ctx.moments[index];
  if(!m || gradeHistoryBusy) return;
  ctx.at = m.at;
  const label = crmSectionLabel(ctx.sectionId);
  const when = gradeHistoryWhen(m.at);
  showInfoModal('<div style="text-align:right;"><div class="loading-state">جارٍ تجهيز المعاينة...</div></div>', '440px');
  const { data, error } = await sb.rpc('grade_history_restore', { p_section: ctx.sectionId, p_at: m.at, p_apply: false });
  if(gradeHistoryCtx !== ctx || ctx.at !== m.at) return;
  if(error){
    showInfoModal(`<div style="text-align:right;"><p class="tlx-note">${escapeHtml(gradeHistoryErrorText(error))}</p>
      <button type="button" class="tlx-btn is-ghost" style="margin-top:8px;" onclick="openGradeHistory()">→ رجوع للسجل</button></div>`, '440px');
    return;
  }
  showInfoModal(`<div style="text-align:right;">${gradeHistoryPreviewHtml(data, label, when)}</div>`, '440px');
}

async function applyGradeRestore(){
  const ctx = gradeHistoryCtx;
  if(!ctx || !ctx.at || gradeHistoryBusy) return;
  gradeHistoryBusy = true;
  const btn = document.getElementById('gradeRestoreBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ الاستعادة...'; }
  const { sectionId, at } = ctx;
  let res = null, error = null;
  try{ ({ data: res, error } = await sb.rpc('grade_history_restore', { p_section: sectionId, p_at: at, p_apply: true })); }
  catch(e){ error = e; }
  finally { gradeHistoryBusy = false; }
  if(error){
    if(btn){ btn.disabled = false; btn.textContent = 'استعادة'; }
    showToast('تعذّرت الاستعادة — لم يتغيّر شيء', 'error');
    return;
  }
  closeCrmModal();
  const n = Number(res && res.changes) || 0;
  const skipped = Number(res && res.skipped) || 0;
  showToast(`استُعيد ${n} ${n === 1 ? 'تغيير' : 'تغييرًا'} ✓${skipped ? ` — وتُخطّي ${skipped} (طالب أو بند حُذف بعدها)` : ''}`, skipped ? 'error' : 'ok');
  if(typeof afterCrmGradesChanged === 'function') afterCrmGradesChanged();
  /* الشاشة الظاهرة الآن فقط، وللشعبة نفسها */
  if(crmGrades && crmGrades.sectionId === sectionId && typeof renderCrmGrades === 'function') await renderCrmGrades();
}

/* بعد الدخول: حذف ما مضى عليه 30 يومًا من سجل المعلم (لا يؤخّر شيئًا، والفشل لا يهم) */
async function gradeHistoryCleanup(){
  if(!currentUser) return;
  try{ await sb.rpc('grade_history_cleanup'); } catch(e){}
}
