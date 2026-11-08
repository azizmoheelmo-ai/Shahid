/* ============================================================
   إرسال تقرير الطالب الفردي برابط مؤقت عبر واتساب
   ------------------------------------------------------------
   التقرير نفسه (srBuildReport، app-36): نسخة الدرجات أو التحليلية بتشخيص أو بدونه — لا تصميم جديد.
   التقرير لا يُخزَّن ملفًا في أي مكان (يُبنى عند الطلب)، فنحوّله هنا إلى ملف PDF ونرفعه مؤقتًا:
     1) PDF من نفس HTML التقرير (html2canvas + jsPDF كخطابات الإحالة)، ويُقسَّم صفحاتٍ عند حدود الأقسام والصفوف.
     2) حاوية خاصة report-shares (مجلد المعلم)، ورابط قصير /r/<رمز> (api/r.js) ينتهي بعد 3/7/14 يومًا (الافتراضي 7):
      الخادم يحوّل الرمز الصالح إلى رابط موقَّع قصير العمر (60 ثانية) للملف؛ الصلاحية الفعلية = expires_at بالسجل.
     3) صف بسجل student_report_shares لتنظيف المنتهي (يُحذف الملف عند فتح التطبيق بعد الانتهاء).
     4) زر «فتح واتساب» رابطٌ حقيقي (a href) على رقم الطالب/ولي الأمر المحفوظ: النقر عليه لمسة مستخدم فلا يحجبه المتصفح.
   لا يُرسل شيء تلقائيًا: المعلم يضغط إرسال داخل واتساب بنفسه. الأرقام وروابط المعلمين لا يراها المسؤول (بلا سياسة مسؤول).
   ============================================================ */

const REPORT_SHARE_BUCKET = 'report-shares';
const REPORT_SHARE_DAYS = [3, 7, 14];
const REPORT_SHARE_DEFAULT_DAYS = 7;
const REPORT_SHARE_MAX_BYTES = 8 * 1024 * 1024; /* سقف الحاوية نفسه */
/* حدود القص الآمنة بين الصفحات: الأقسام القصيرة والصناديق والتواقيع وصفوف الجداول (لا رأس الجدول فلا يُترك وحيدًا) */
const REPORT_SHARE_BREAKS = '.pdf-avoid-break,.sr .sec:not(.long),.sr .box,.sr .rc,.sr .sgn,.sr tbody tr';

let reportShareBusy = false;
let reportShareToken = 0;
let reportShareCleaned = false;

/* رمز الرابط القصير: 14 حرفًا من 31 (بلا الحروف الملتبسة) ≈ 70 بتًا، بسحب عشوائي آمن وبلا انحياز */
const REPORT_SHARE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function reportShareCode(){
  let out = '';
  while(out.length < 14){
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for(let i = 0; i < bytes.length && out.length < 14; i++){
      if(bytes[i] < 248) out += REPORT_SHARE_CODE_ALPHABET[bytes[i] % REPORT_SHARE_CODE_ALPHABET.length]; /* 248 = 31×8: نرفض الباقي فلا انحياز */
    }
  }
  return out;
}

function reportShareWho(who){ return who === 'student' ? 'student' : 'guardian'; }
function reportSharePhone(st, who){ return who === 'student' ? st.student_phone : st.guardian_phone; }

/* html التقرير → ملف PDF (Blob). العرض 700px كالطباعة فيخرج الخط بحجمه المقصود */
async function reportSharePdfBlob(html){
  await ensurePdfLibs();
  const area = document.getElementById('pdfRenderArea');
  if(!area) throw new Error('منطقة الإخراج غير موجودة');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const prevWidth = area.style.width;
  area.style.width = '700px';
  try{
    if(document.fonts && document.fonts.load){
      try{ await Promise.all(['400', '700'].map(w => document.fonts.load(`${w} 12px 'Helvetica Neue W23 for SKY'`, 'شاهد الأداء الوظيفي'))); } catch(e){ /* الاحتياطي Cairo */ }
    }
    await addPdfPagesMulti(pdf, area, html, { firstPage: true }, REPORT_SHARE_BREAKS);
  } finally {
    area.innerHTML = '';
    area.style.width = prevWidth;
  }
  return pdf.output('blob');
}

function reportShareMessage(st, version, url, expiresIso){
  const kind = version === 'analytical' ? 'التقرير التحليلي' : 'تقرير الدرجات';
  return `السلام عليكم، ${kind} للطالب ${st.full_name}:\n${url}\nالرابط صالح حتى ${expiresIso}.`;
}

/* ============ النافذة ============ */
function openReportShare(studentId, who){
  const st = srStudentById(studentId);
  who = reportShareWho(who);
  if(!st || !currentUser) return;
  const phone = reportSharePhone(st, who);
  if(!phone){ showToast('أضف رقم ' + (who === 'student' ? 'الطالب' : 'ولي الأمر') + ' أولًا', 'error'); return; }
  const token = ++reportShareToken;
  const dxOn = typeof reportDxOn === 'function' ? reportDxOn() : true;
  showInfoModal(`<div id="reportShareBody" data-token="${token}" style="text-align:right;">
    <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">إرسال تقرير ${escapeHtml(st.full_name)} إلى ${who === 'student' ? 'الطالب' : 'ولي الأمر'}</h3>
    <div dir="ltr" style="text-align:right;font-size:12px;color:var(--muted);margin-bottom:8px;">إلى: ${escapeHtml(phoneDisplay(phone))}</div>
    <div id="reportShareForm">
      <div class="crm-ct-picks" style="flex-direction:column;">
        <label class="crm-ct-pick"><input type="radio" name="rsVer" value="grades" checked onchange="paintReportShareOpts()"><span>نسخة الدرجات</span></label>
        <label class="crm-ct-pick"><input type="radio" name="rsVer" value="analytical" onchange="paintReportShareOpts()"><span>النسخة التحليلية (كل ما يخص الطالب)</span></label>
      </div>
      <label id="rsDxWrap" class="crm-ga-chk" style="display:none;"><input type="checkbox" id="rsDx"${dxOn ? ' checked' : ''} onchange="if(typeof setReportDx === 'function') setReportDx(this.checked)"> مع التشخيص والتوصيات</label>
      <label class="crm-field-label" style="margin-top:8px;">ينتهي الرابط بعد</label>
      <select class="goal-input" id="rsDays" style="margin-bottom:8px;">${REPORT_SHARE_DAYS.map(d => `<option value="${d}"${d === REPORT_SHARE_DEFAULT_DAYS ? ' selected' : ''}>${d} أيام</option>`).join('')}</select>
      <p style="font-size:11.5px;color:var(--muted);margin:0 0 10px;line-height:1.7;">يُرفع التقرير مؤقتًا ويصل ولي الأمر رابطًا؛ من يملك الرابط يفتحه حتى ينتهي ثم يُحذف الملف. لا يُرسل شيء حتى تضغط إرسال في واتساب.</p>
      <button type="button" class="btn btn-primary" id="rsGoBtn" style="width:100%;justify-content:center;" onclick="buildReportShare('${escapeHtml(st.id)}','${who}','${token}')">إنشاء الرابط ←</button>
    </div>
    <div id="reportShareResult" style="display:none;"></div>
  </div>`, '400px');
  paintReportShareOpts();
}

function paintReportShareOpts(){
  const ver = document.querySelector ? document.querySelector('input[name="rsVer"]:checked') : null;
  const wrap = document.getElementById('rsDxWrap');
  if(wrap) wrap.style.display = ver && ver.value === 'analytical' ? 'flex' : 'none';
}

/* السباق: النافذة قد تُغلق أو تُستبدل أثناء التجهيز الطويل */
function reportShareStillOpen(token){
  const box = document.getElementById('reportShareBody');
  return !!box && box.dataset && String(box.dataset.token) === String(token);
}

async function buildReportShare(studentId, who, token){
  if(reportShareBusy) return;
  const st = srStudentById(studentId);
  who = reportShareWho(who);
  if(!st || !currentUser) return;
  const phone = reportSharePhone(st, who);
  if(!phone){ showToast('لا رقم لهذا المستلم', 'error'); return; }
  const verEl = document.querySelector('input[name="rsVer"]:checked');
  const version = verEl && verEl.value === 'analytical' ? 'analytical' : 'grades';
  const noDx = version === 'analytical' ? !((document.getElementById('rsDx') || {}).checked) : false;
  const days = Math.max(1, Math.min(14, Number((document.getElementById('rsDays') || {}).value) || REPORT_SHARE_DEFAULT_DAYS));
  const uid = currentUser.id;
  const btn = document.getElementById('rsGoBtn');
  reportShareBusy = true;
  if(btn){ btn.disabled = true; btn.textContent = 'جارٍ تجهيز التقرير…'; }
  let path = null, uploaded = false;
  try{
    const out = await srBuildReport(studentId, version, version === 'grades' && who === 'guardian' ? 'ولي الأمر' : null, { noDx });
    if(!out || !out.html) throw new Error('تعذّر بناء التقرير');
    const blob = await reportSharePdfBlob(out.html);
    if(blob.size > REPORT_SHARE_MAX_BYTES) throw new Error('حجم الملف كبير');
    path = `${uid}/${studentId}/${crypto.randomUUID()}.pdf`;
    const up = await sb.storage.from(REPORT_SHARE_BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: false });
    if(up.error) throw up.error;
    uploaded = true;
    const exp = new Date(Date.now() + days * 86400000);
    /* رمز قصير فريد: تصادم (شبه مستحيل) يُعاد مرة بشفرة جديدة */
    let code = reportShareCode();
    const row = c => ({ teacher_id: uid, student_id: studentId, object_path: path, version, recipient: who, expires_at: exp.toISOString(), short_code: c });
    let ins = await sb.from('student_report_shares').insert(row(code));
    if(ins.error && String(ins.error.code) === '23505'){ code = reportShareCode(); ins = await sb.from('student_report_shares').insert(row(code)); }
    if(ins.error) throw ins.error;
    if(!reportShareStillOpen(token)){
      /* أُغلقت النافذة قبل الاكتمال: لا رابط يُعرض لأحد، فنزيل الملف والسجل بدل تركهما */
      await reportShareDiscard(uid, path);
      return;
    }
    const expIso = localIsoDate(exp);
    const shortUrl = location.origin + '/r/' + code; /* الرابط القصير على نطاق التطبيق (يفتحه الخادم api/r.js) */
    const wa = waChatUrl(phone, reportShareMessage(st, version, shortUrl, expIso));
    reportShareShowResult(wa, shortUrl, expIso);
    reportShareCleaned = false; reportShareCleanup();
  } catch(err){
    if(uploaded && path) await reportShareDiscard(uid, path);
    showToast('تعذّر تجهيز الرابط: ' + (err && err.message ? err.message : 'خطأ'), 'error');
    if(reportShareStillOpen(token) && btn){ btn.disabled = false; btn.textContent = 'إنشاء الرابط ←'; }
  } finally {
    reportShareBusy = false;
  }
}

function reportShareShowResult(waUrl, link, expIso){
  const form = document.getElementById('reportShareForm');
  const res = document.getElementById('reportShareResult');
  if(!res) return;
  if(form) form.style.display = 'none';
  res.style.display = 'block';
  res.dataset.link = link;
  res.innerHTML = `<div style="font-size:13px;margin:6px 0 10px;line-height:1.8;">✓ الرابط جاهز وينتهي في <b>${escapeHtml(expIso)}</b>. اضغط الزر لفتح واتساب على الرقم، ثم اضغط إرسال.</div>
    <a class="btn btn-primary" href="${escapeHtml(waUrl)}" target="_blank" rel="noopener" style="display:flex;width:100%;justify-content:center;text-decoration:none;margin-bottom:8px;background:#1FA855;border-color:#1FA855;">فتح واتساب ←</a>
    <button type="button" class="btn btn-outline" style="width:100%;justify-content:center;" onclick="copyReportShareLink()">نسخ الرابط</button>`;
}

async function copyReportShareLink(){
  const res = document.getElementById('reportShareResult');
  const link = res && res.dataset ? res.dataset.link : '';
  if(!link) return;
  try{ await navigator.clipboard.writeText(link); showToast('تم نسخ الرابط', 'ok'); }
  catch(e){ showToast('تعذّر النسخ — افتح واتساب بالزر الأخضر', 'error'); }
}

/* إزالة ملف وسجله (تراجع عن مشاركة لم تكتمل) — بتصفية المعلم */
async function reportShareDiscard(uid, path){
  try{
    await sb.storage.from(REPORT_SHARE_BUCKET).remove([path]);
    await sb.from('student_report_shares').delete().eq('teacher_id', uid).eq('object_path', path);
  } catch(e){ /* التنظيف الدوري يلتقط ما بقي */ }
}

/* ينظّف ملفات المنتهية روابطها (مرة بالجلسة، وبعد كل إرسال): الملف أولًا فإن نجح حُذف السجل */
async function reportShareCleanup(){
  if(reportShareCleaned || !currentUser) return;
  reportShareCleaned = true;
  try{
    const uid = currentUser.id;
    const { data, error } = await sb.from('student_report_shares').select('id, object_path')
      .eq('teacher_id', uid).lt('expires_at', new Date().toISOString()).limit(100);
    if(error || !data || !data.length) return;
    const rm = await sb.storage.from(REPORT_SHARE_BUCKET).remove(data.map(r => r.object_path));
    if(rm.error) return; /* يبقى السجل لتُعاد المحاولة لاحقًا */
    await sb.from('student_report_shares').delete().eq('teacher_id', uid).in('id', data.map(r => r.id));
  } catch(e){ /* لا يؤثر على عمل المعلم */ }
}
