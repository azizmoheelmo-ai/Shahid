/* ============================================================
   لبنات مشتركة لمطبوعات المعلم بهوية وزارة التعليم (الخطة · التقييم الذاتي · ملف الإنجاز · ملخص البرنامج · الخطابات)
   ------------------------------------------------------------
   - المرجع: REPORTS.md (م8، ق14، ق15). أنماط مضمَّنة بعرض 794px كالشاهد (app-09)، والشعاران من shahidLogos
     (يُحمَّلان بـ shahidWarmLogos() قبل البناء). الصور تُقبل data:image فقط.
   - لا HTML من المستخدم هنا: كل نص يمرّ عبر escapeHtml.
   ============================================================ */
const MOE_FONT = "'Helvetica Neue W23 for SKY',Cairo,sans-serif";
const MOE_NAVY = '#15445a', MOE_BLUE = '#3d7eb9', MOE_LINE = '#d3dee6', MOE_TINT = '#f4f8fb', MOE_MUTED = '#51636d';
const MOE_GRAD = 'linear-gradient(90deg,#3B83B7,#4CB176)';

const moeImgOk = u => typeof u === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}$/.test(u);

function moeStripHtml(margin){
  return `<div style="margin:${margin || '16px 30px 0'};height:5px;border-radius:3px;background:${MOE_GRAD};"></div>`;
}

/* ترويسة: شعار الوزارة يمينًا، العنوان وسطًا (وسطر ثانوي)، شعار المدرسة يسارًا إن وُجد، وخط متدرج تحتها */
function moeHeaderHtml(title, sub, side){
  const moe = moeImgOk(shahidLogos.moe) ? `<img src="${escapeHtml(shahidLogos.moe)}" alt="" style="width:83px;display:block;">` : '';
  const sch = moeImgOk(shahidLogos.school) ? `<img src="${escapeHtml(shahidLogos.school)}" alt="" style="max-width:64px;max-height:64px;display:block;">` : '';
  const sideHtml = (side || []).filter(Boolean).map(t => `<div>${escapeHtml(t)}</div>`).join('');
  return `<div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 28px;padding-bottom:9px;">
      <div style="width:83px;flex:none;">${moe}</div>
      <div style="flex:1;text-align:center;">
        ${sub ? `<div style="font-size:11px;color:${MOE_MUTED};">${escapeHtml(sub)}</div>` : ''}
        ${title ? `<div style="font-size:21px;font-weight:700;color:${MOE_NAVY};line-height:1.4;margin-top:2px;">${escapeHtml(title)}</div>` : ''}
        ${sideHtml ? `<div style="font-size:10.5px;color:${MOE_MUTED};line-height:1.7;margin-top:2px;">${sideHtml}</div>` : ''}
      </div>
      <div style="width:83px;flex:none;display:flex;justify-content:flex-start;">${sch}</div>
      <div style="position:absolute;right:0;left:0;bottom:0;height:3px;border-radius:2px;background:${MOE_GRAD};"></div>
    </div>`;
}

/* غلاف: شعار الوزارة كبير (قرار المستخدم) في الأعلى، فاصل متدرج، العنوان، ثم بطاقة بيانات وشريط ختامي */
function moeCoverHtml(title, subtitle, rows, foot){
  const moe = moeImgOk(shahidLogos.moe) ? `<img src="${escapeHtml(shahidLogos.moe)}" alt="" style="width:300px;display:block;margin:0 auto;">` : '';
  const sch = moeImgOk(shahidLogos.school) ? `<img src="${escapeHtml(shahidLogos.school)}" alt="" style="max-height:80px;max-width:200px;display:block;margin:26px auto 0;">` : '';
  const cells = (rows || []).filter(r => r && r[1] !== undefined && r[1] !== '').map(([l, v]) =>
    `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid ${MOE_LINE};font-size:16px;"><span style="width:150px;color:${MOE_MUTED};">${escapeHtml(l)}</span><b style="flex:1;color:${MOE_NAVY};">${escapeHtml(String(v))}</b></div>`).join('');
  return `<div dir="rtl" style="width:794px;height:1000px;box-sizing:border-box;background:#fff;font-family:${MOE_FONT};color:${MOE_NAVY};display:flex;flex-direction:column;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="height:14px;background:${MOE_GRAD};"></div>
    <div style="padding:70px 60px 0;text-align:center;">${moe}${sch}</div>
    <div style="margin:60px 60px 0;height:3px;border-radius:2px;background:${MOE_GRAD};"></div>
    <div style="text-align:center;margin-top:46px;padding:0 60px;">
      <div style="font-size:40px;font-weight:700;line-height:1.4;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:17px;color:${MOE_BLUE};margin-top:10px;">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <div style="margin:50px 120px 0;">${cells}</div>
    ${foot ? `<div style="text-align:center;font-size:13px;color:${MOE_MUTED};margin-top:22px;">${escapeHtml(foot)}</div>` : ''}
    <div style="flex:1;"></div>
    <div style="height:14px;background:${MOE_GRAD};"></div>
  </div>`;
}

/* شريط عنوان قسم (بدل الشريط الكحلي ذي الخط الذهبي) */
function moeBarHtml(text){
  return `<div style="background:${MOE_NAVY};color:#fff;padding:7px 12px;font-size:11.5px;font-weight:700;border-radius:4px 4px 0 0;">${text}</div>`;
}

/* خانتا توقيع بخط علوي */
function moeSignHtml(labels, margin){
  return `<div style="display:flex;gap:40px;margin:${margin || '24px 28px 0'};">${labels.map(l =>
    `<div style="flex:1;border-top:1px solid ${MOE_NAVY};padding-top:6px;font-size:10px;color:${MOE_MUTED};">${escapeHtml(l)}</div>`).join('')}</div>`;
}

/* صفحة خطاب (نص الخطاب كما في المعاينة) بترويسة الوزارة وخط الوزارة؛ بنية الخطاب ونصه لا يتغيران */
function moeLetterPageHtml(letterHtml){
  return `<div dir="rtl" style="width:794px;box-sizing:border-box;font-family:${MOE_FONT};font-size:14px;line-height:2;color:#232323;background:#fff;padding-top:22px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    ${moeHeaderHtml('', '')}
    <div style="padding:18px 30px 0;">${letterHtml}</div>
    ${moeStripHtml('18px 30px 14px')}
  </div>`;
}
/* صفحة صورة إثبات التسليم */
function moeProofPageHtml(dataUrl){
  return `<div dir="rtl" style="width:794px;box-sizing:border-box;font-family:${MOE_FONT};color:${MOE_NAVY};background:#fff;padding-top:22px;text-align:center;">
    ${moeHeaderHtml('صورة إثبات التسليم الموقّع', '')}
    <div style="padding:20px 30px 0;"><img src="${escapeHtml(dataUrl)}" style="max-width:60%;border:1px solid ${MOE_LINE};"></div>
    ${moeStripHtml('18px 30px 14px')}
  </div>`;
}
