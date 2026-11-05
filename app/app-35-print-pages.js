/* ============================================================
   طباعة صفحات HTML بنص حقيقي (خطة · تقييم ذاتي · ملخص برنامج · كل الشواهد · ملف الإنجاز)
   ------------------------------------------------------------
   بديل مسار «التقاط الصفحة صورةً ثم لصقها في PDF» (html2canvas + jsPDF):
   المتصفح نفسه يرسم العربية (تشكيل واتجاه صحيحان)، ويختار المعلم «حفظ كـPDF» من
   نافذة الطباعة، فيخرج نص قابل للتحديد والبحث بملف أصغر.
   - المنشئات القائمة (buildPlanHtml، buildPdfHtml...) مصمَّمة بعرض 794px ثابت للصورة؛
     نغلّف كل صفحة بـ zoom يضبطها على عرض A4 المطبوع (190مم ≈ 718px) فلا يُقص طرفها.
   - fit:'page' = صفحة واحدة كاملة (تُقاس وتُصغَّر لتتسع كما كان يفعل addPdfPage)؛
     fit:'width' = تنساب على عدة صفحات (تُصغَّر للعرض فقط).
   - بعد الطباعة تُفرَّغ #printArea ويُعاد عنوان الصفحة (اسم الملف المقترح عند الحفظ).
   ============================================================ */

const PRINT_PAGE_W = 718;     /* عرض محتوى A4 بهامش 10مم (190مم) */
const PRINT_PAGE_H = 1047;    /* ارتفاع محتوى A4 بهامش 10مم (277مم) */
const PRINT_DESIGN_W = 794;   /* عرض تصميم المنشئات القائمة */
const PRINT_PAGE_SLACK = 12;  /* هامش احتياطي: بدونه يسيل سطر من حدّ المحتوى لصفحة زائدة */

const PRINT_PAGES_CSS = '@page{size:A4;margin:10mm}'
  + '@media print{'
  + '#printArea.wrap{max-width:none;padding-bottom:0}'
  + '#printArea,#printArea *{-webkit-print-color-adjust:exact;print-color-adjust:exact}'
  + '#printArea .pp{break-after:page;page-break-after:always}'
  + '#printArea .pp:last-child{break-after:auto;page-break-after:auto}'
  + '#printArea .pp-in{margin:0 auto}'
  + '#printArea .pdf-avoid-break{break-inside:avoid;page-break-inside:avoid}'
  + '}';

/* ============ دوال صرفة ============ */

/* معامل التصغير: يضبط العرض دائمًا، وللصفحة الكاملة يضبط الارتفاع أيضًا (الأصغر منهما) */
function printFitZoom(fit, designW, contentH){
  const fw = Math.min(1, PRINT_PAGE_W / designW);
  if(fit !== 'page' || !(contentH > 0)) return fw;
  return Math.min(fw, (PRINT_PAGE_H - PRINT_PAGE_SLACK) / contentH);
}

/* pages: [{ html, fit, designWidth?, h? }] — h = ارتفاع المحتوى المقيس (لـ fit:'page') */
function printPagesHtml(pages){
  return pages.map(p => {
    const dw = p.designWidth || PRINT_DESIGN_W;
    const z = Math.round(printFitZoom(p.fit, dw, p.h) * 10000) / 10000;
    /* صفحة كاملة: ارتفاع ثابت وقصّ، فلا يسيل شيء لصفحة ثانية مهما تقرّب القياس */
    const box = p.fit === 'page' ? ` style="height:${PRINT_PAGE_H - 4}px;overflow:hidden"` : '';
    return `<section class="pp"${box}><div class="pp-in" style="width:${dw}px;zoom:${z}">${p.html}</div></section>`;
  }).join('');
}

const printFileTitle = prefix => `${prefix}-${new Date().toISOString().slice(0, 10)}`;

/* ============ الطباعة ============ */

/* ارتفاع HTML بعرض التصميم، بعد تحميل الخطوط وفكّ الصور (وإلا تُقاس الصور بلا ارتفاع) */
async function printMeasureHeight(html, designW){
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = `position:fixed;top:0;left:-99999px;width:${designW}px;visibility:hidden;`;
  box.innerHTML = html;
  document.body.appendChild(box);
  try{
    const imgs = Array.from(box.querySelectorAll('img'));
    await Promise.all(imgs.map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    return box.offsetHeight;
  } finally {
    box.remove();
  }
}

let printPagesSavedTitle = null;

async function printPages(pages, title){
  const area = document.getElementById('printArea');
  if(!area || !pages || !pages.length) return;
  if(document.fonts && document.fonts.ready){
    try{ await document.fonts.ready; } catch(e){ /* لا يمنع الطباعة */ }
  }
  const measured = [];
  for(const p of pages){
    measured.push(Object.assign({}, p, { h: p.fit === 'page' ? await printMeasureHeight(p.html, p.designWidth || PRINT_DESIGN_W) : 0 }));
  }
  area.innerHTML = `<style>${PRINT_PAGES_CSS}</style>` + printPagesHtml(measured);
  if(title){
    if(printPagesSavedTitle === null) printPagesSavedTitle = document.title;
    document.title = title;
  }
  const clear = () => {
    window.removeEventListener('afterprint', clear);
    if(area.querySelector('.pp')) area.innerHTML = '';
    if(printPagesSavedTitle !== null){ document.title = printPagesSavedTitle; printPagesSavedTitle = null; }
  };
  window.addEventListener('afterprint', clear);
  printNow();
}
