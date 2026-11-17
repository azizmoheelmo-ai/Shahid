'use strict';
/* ============================================================
   «بطاقة الدليل»: صورة تتولّد من بيانات العمل نفسه (REPORTS.md ق30)
   ------------------------------------------------------------
   المعلم لا يملك دائمًا صورًا (تصوير الطلاب غير متاح أو غير مرغوب). فورقة «أعمال تنتظر التوثيق»
   (app-51) ترسم بطاقة بهوية الوزارة من أرقام العمل (معايير السلّم، مستويات الاختبار، محاور الاستبانة،
   أيام الرصد، توزيع درجات المهمة، قبل/بعد المتابعة، خطوات الخطة، تقدّم البرنامج) وتُرفق أول صورة
   تلقائيًا، ويستطيع المعلم إزالتها. قرارات المستخدم:
   - الإرفاق تلقائي، والإزالة بنقرة.
   - أسفلها دائمًا «مولّدة من بيانات التطبيق — بلا أسماء طلاب»: لا تُقدَّم كصورة من الحصة (م1).
   - بلا أسماء طلاب أبدًا (المتابعة الجماعية: «طالب 1، طالب 2»).
   - كل نص يمرّ عبر escapeHtml (أسماء المعايير والأسئلة والاختبارات من المعلم).
   - الرسم بـhtml2canvas (vendor) داخل المتصفح، بلا خادم؛ والفشل لا يمنع حفظ الشاهد.
   ============================================================ */

const EVC_W = 720;                       /* عرض البطاقة (بكسل) قبل التكبير ×2 */
const EVC_MAX_ROWS = 8;                  /* أقصى أشرطة/أسطر — الصورة تبقى مقروءة داخل إطار الشاهد */
const EVC_FONT = "'Helvetica Neue W23 for SKY',Cairo,sans-serif";
const EVC_NAVY = '#15445a', EVC_BLUE = '#3d7eb9', EVC_GREEN = '#4CB176', EVC_LINE = '#d3dee6', EVC_TINT = '#f4f8fb', EVC_MUTED = '#51636d';
const EVC_TONE = { lo: '#c0504d', mid: '#d9a43a', hi: '#4CB176' };
const EVC_FOOT = 'مولّدة من بيانات التطبيق — بلا أسماء طلاب';

/* ============ مواصفات البطاقة (دوال صرفة) ============
   الشكل الموحّد: { title, sub, kind, rows?, levels?, days?, items?, foot }
   kind: 'bars' أشرطة نسبة · 'levels' شريط مستويات · 'calendar' تقويم شهر · 'list' قائمة · 'pairs' قبل/بعد */

/* «17 طالبًا» لا «17 طلاب» */
function evcStudents(n){
  return typeof arabicCountPhrase === 'function' && typeof CRM_STUDENT_COUNT_FORMS !== 'undefined' ? arabicCountPhrase(n, CRM_STUDENT_COUNT_FORMS) : n + ' طلاب';
}

function evcPct(n, of){ return of > 0 ? Math.max(0, Math.min(100, Math.round(100 * n / of))) : 0; }

/* سلّم التقدير: نسبة من أتقن كل معيار (كامل أو كبير) */
function evidenceCardRubric(o){
  const crit = (o.criteria || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const marks = o.marks || [];
  const rows = crit.map(k => {
    const ms = marks.filter(m => m.criterion_id === k.id);
    const good = ms.filter(m => Number(m.level) <= 1).length;
    return { label: k.name, value: `${good} من ${ms.length}`, pct: evcPct(good, ms.length) };
  }).filter(r => r.value !== '0 من 0');
  return { title: 'سلّم تقدير: ' + o.name, sub: o.sectionLabel || '', kind: 'bars', caption: 'نسبة من أتقن كل معيار (كامل أو كبير)', rows: rows.slice(0, EVC_MAX_ROWS) };
}

/* تحليل اختبار: شريط المستويات بحدود المعلم */
function evidenceCardTest(o){
  const max = Number(o.max) || 1;
  const vals = (o.scores || []).filter(v => v !== null && v !== undefined && v !== '').map(Number).filter(isFinite);
  const pass = Number(o.rules && o.rules.pass) || 50, top = Number(o.rules && o.rules.top) || 90;
  const pcts = vals.map(v => 100 * v / max);
  const lo = pcts.filter(x => x < pass).length, hi = pcts.filter(x => x >= top).length;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return {
    title: 'نتائج اختبار: ' + o.name, sub: o.sectionLabel || '', kind: 'levels',
    caption: `${evcStudents(vals.length)} · المتوسط ${Math.round(100 * avg / max)}%`,
    levels: [
      { label: `ضعاف (دون ${pass}%)`, n: lo, tone: 'lo' },
      { label: 'متوسطون', n: vals.length - lo - hi, tone: 'mid' },
      { label: `متفوقون (${top}% فأكثر)`, n: hi, tone: 'hi' }
    ]
  };
}

/* مهمة أدائية: توزيع المقيَّمين على ثلاثة مستويات (كمسودة المهمة) */
function evidenceCardTask(o){
  const max = Number(o.max) || 1;
  const vals = (o.rows || []).filter(r => r.score !== null && r.score !== undefined).map(r => Number(r.score) / max);
  const hi = vals.filter(v => v >= 0.75).length, mid = vals.filter(v => v >= 0.5 && v < 0.75).length;
  return {
    title: 'مهمة أدائية: ' + o.title, sub: o.sectionLabel || '', kind: 'levels',
    caption: `قُيّم ${vals.length} من ${(o.rows || []).length}`,
    levels: [
      { label: 'يحتاج دعمًا (أقل من 50%)', n: vals.length - hi - mid, tone: 'lo' },
      { label: 'متوسط (50–74%)', n: mid, tone: 'mid' },
      { label: 'أتقن (75% فأكثر)', n: hi, tone: 'hi' }
    ]
  };
}

/* استبانة: متوسط كل محور تقييم من 5 */
function evidenceCardSurvey(o){
  const items = (o.analysis && o.analysis.items) || [];
  const rows = items.filter(a => a.type === 'rating' && a.avg != null)
    .map(a => ({ label: a.label, value: (Math.round(a.avg * 10) / 10).toFixed(1) + ' من 5', pct: evcPct(a.avg, 5) }));
  return { title: 'استبانة رضا: ' + o.title, sub: '', kind: 'bars', caption: `${(o.analysis && o.analysis.valid) || 0} ردًا (بلا أسماء أصحابها)`, rows: rows.slice(0, EVC_MAX_ROWS) };
}

/* رصد شهر: تقويم الشهر، واليوم المرصود مظلّل */
function evidenceCardLessons(o){
  const m = /^(\d{4})-(\d{2})$/.exec(String(o.month || ''));
  const y = m ? Number(m[1]) : 2000, mo = m ? Number(m[2]) : 1;
  const daysIn = new Date(y, mo, 0).getDate();
  const firstDow = new Date(y, mo - 1, 1).getDay(); /* الأحد = 0 */
  const counts = {};
  (o.lessons || []).forEach(l => { const d = Number(String(l.lesson_date || '').slice(8, 10)); if(d) counts[d] = (counts[d] || 0) + 1; });
  return {
    title: 'رصد الحصص — ' + (typeof inboxMonthLabel === 'function' ? inboxMonthLabel(o.month) : o.month), sub: '', kind: 'calendar',
    caption: `${(o.lessons || []).length} حصة مرصودة في ${Object.keys(counts).length} يومًا`,
    days: { daysIn, firstDow, counts }
  };
}

/* متابعة: قبل/بعد لكل طالب بلا اسم */
function evidenceCardFollowup(o){
  const members = o.members || [];
  const items = members.slice(0, EVC_MAX_ROWS).map((m, i) => {
    const ba = typeof followupBeforeAfter === 'function' ? followupBeforeAfter(m.followup) : { before: null, after: null };
    return { label: members.length > 1 ? 'طالب ' + (i + 1) : 'الطالب', before: ba.before || '—', after: ba.after || 'بحكم المعلم: تحسّن' };
  });
  return { title: (members.length > 1 ? 'متابعة جماعية: ' : 'متابعة طالب: ') + (o.reason || ''), sub: o.sectionLabel || '', kind: 'pairs', caption: 'قبل المتابعة ← بعدها', items };
}

/* خطة درس: خطواتها كما خُطّطت (لا أرقام في الخطة) */
function evidenceCardPlan(o){
  const steps = (o.steps || []).filter(s => typeof s === 'string' && s.trim()).slice(0, EVC_MAX_ROWS);
  return { title: 'خطة درس: ' + o.title, sub: o.sectionLabel || '', kind: 'list', caption: o.date ? 'موعد التنفيذ ' + o.date : '', items: steps.length ? steps : ['(لا خطوات مسجّلة في الخطة)'] };
}

/* حصة برنامج: تقدّم البرنامج بعد هذه الحصة */
function evidenceCardProgram(o){
  const total = Number(o.total) || 1;
  const done = Math.min(total, (Number(o.done) || 0) + 1);
  return { title: 'برنامج نشاط: ' + o.name, sub: o.sectionLabel || '', kind: 'bars', caption: `الحصة ${o.sessionNo} من ${total}`,
    rows: [{ label: 'التوثيق بعد هذه الحصة', value: `${done} من ${total}`, pct: evcPct(done, total) }] };
}

/* ============ الرسم (HTML ثابت بأنماط مضمَّنة) ============ */

function evcBarsHtml(card){
  return (card.rows || []).map(r => `<div style="margin:0 0 10px;">
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:15px;color:${EVC_NAVY};font-weight:700;"><span>${escapeHtml(r.label)}</span><span style="direction:rtl;white-space:nowrap;">${escapeHtml(r.value)}</span></div>
      <div style="height:12px;background:${EVC_TINT};border:1px solid ${EVC_LINE};border-radius:7px;overflow:hidden;margin-top:4px;"><div style="height:100%;width:${Number(r.pct) || 0}%;background:${EVC_BLUE};"></div></div>
    </div>`).join('') || `<div style="color:${EVC_MUTED};font-size:14px;">لا بيانات كافية</div>`;
}

function evcLevelsHtml(card){
  const lv = card.levels || [];
  const total = lv.reduce((a, l) => a + (Number(l.n) || 0), 0) || 1;
  const bar = lv.filter(l => l.n > 0).map(l => `<div style="width:${100 * l.n / total}%;background:${EVC_TONE[l.tone] || EVC_BLUE};"></div>`).join('');
  const legend = lv.map(l => `<div style="flex:1;text-align:center;border:1px solid ${EVC_LINE};border-radius:8px;padding:8px 4px;background:${EVC_TINT};">
      <div style="font-size:26px;font-weight:700;color:${EVC_TONE[l.tone] || EVC_NAVY};">${Number(l.n) || 0}</div>
      <div style="font-size:13px;color:${EVC_NAVY};">${escapeHtml(l.label)}</div></div>`).join('');
  return `<div style="display:flex;height:22px;border-radius:11px;overflow:hidden;border:1px solid ${EVC_LINE};margin-bottom:14px;">${bar}</div><div style="display:flex;gap:10px;">${legend}</div>`;
}

function evcCalendarHtml(card){
  const d = card.days || { daysIn: 30, firstDow: 0, counts: {} };
  const names = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  const cells = [];
  for(let i = 0; i < d.firstDow; i++) cells.push('<div></div>');
  for(let day = 1; day <= d.daysIn; day++){
    const n = d.counts[day] || 0;
    cells.push(`<div style="height:34px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;`
      + (n ? `background:${EVC_GREEN};color:#fff;` : `background:${EVC_TINT};color:${EVC_MUTED};border:1px solid ${EVC_LINE};`) + `">${day}${n > 1 ? `<span style="font-size:10px;margin-inline-start:3px;">×${n}</span>` : ''}</div>`);
  }
  const head = names.map(n => `<div style="text-align:center;font-size:12px;color:${EVC_MUTED};">${n}</div>`).join('');
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;">${head}${cells.join('')}</div>`;
}

function evcListHtml(card){
  return `<ol style="margin:0;padding-inline-start:22px;font-size:15px;color:${EVC_NAVY};line-height:1.9;">${(card.items || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
}

function evcPairsHtml(card){
  return (card.items || []).map(p => `<div style="display:flex;align-items:center;gap:10px;border:1px solid ${EVC_LINE};border-radius:8px;padding:8px 10px;margin-bottom:8px;background:${EVC_TINT};font-size:14px;color:${EVC_NAVY};">
      <b style="flex:none;min-width:58px;">${escapeHtml(p.label)}</b><span style="flex:1;">${escapeHtml(p.before)}</span><span style="color:${EVC_GREEN};font-weight:700;">←</span><span style="flex:1;font-weight:700;">${escapeHtml(p.after)}</span></div>`).join('');
}

function buildEvidenceCardHtml(card){
  if(!card) return '';
  const body = card.kind === 'levels' ? evcLevelsHtml(card) : card.kind === 'calendar' ? evcCalendarHtml(card)
    : card.kind === 'list' ? evcListHtml(card) : card.kind === 'pairs' ? evcPairsHtml(card) : evcBarsHtml(card);
  return `<div dir="rtl" style="width:${EVC_W}px;box-sizing:border-box;background:#fff;font-family:${EVC_FONT};color:${EVC_NAVY};padding:18px 22px 14px;border:1px solid ${EVC_LINE};">
    <div style="height:4px;border-radius:2px;background:linear-gradient(90deg,#3B83B7,${EVC_GREEN});margin-bottom:12px;"></div>
    <div style="font-size:20px;font-weight:700;line-height:1.5;">${escapeHtml(card.title || '')}</div>
    ${card.sub ? `<div style="font-size:13px;color:${EVC_MUTED};">${escapeHtml(card.sub)}</div>` : ''}
    ${card.caption ? `<div style="font-size:13px;color:${EVC_BLUE};font-weight:700;margin:4px 0 12px;">${escapeHtml(card.caption)}</div>` : '<div style="height:10px;"></div>'}
    ${body}
    <div style="margin-top:12px;padding-top:8px;border-top:1px solid ${EVC_LINE};font-size:12px;color:${EVC_MUTED};text-align:center;">${EVC_FOOT}</div>
  </div>`;
}

/* يرسم HTML صورة JPEG (File) عبر html2canvas داخل pdfRenderArea المخفي. يرمي عند الفشل.
   opts: { width (عرض التصميم)، name (اسم الملف)، maxHeight (قصّ الطول: الصفحة الأولى من تقرير طويل) } */
async function renderHtmlImageFile(html, opts){
  await ensurePdfLibs();
  const area = document.getElementById('pdfRenderArea');
  if(!area || typeof html2canvas !== 'function') throw new Error('no_renderer');
  const pad = Number(opts.pad) || 0; /* هامش أبيض حول تصميم صُمّم للطباعة بهوامش الورقة */
  const width = opts.width + 2 * pad;
  const holder = document.createElement('div');
  holder.style.width = width + 'px';
  holder.style.background = '#fff';
  holder.style.padding = pad + 'px';
  holder.style.boxSizing = 'border-box';
  holder.innerHTML = html;
  area.appendChild(holder);
  try{
    const full = holder.scrollHeight || holder.offsetHeight || 0;
    const height = opts.maxHeight && full > opts.maxHeight ? opts.maxHeight : undefined;
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width, height, windowWidth: width });
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    if(!blob) throw new Error('no_blob');
    return new File([blob], opts.name || 'image.jpg', { type: 'image/jpeg' });
  } finally {
    holder.remove();
  }
}

async function renderEvidenceCardFile(card){
  return renderHtmlImageFile(buildEvidenceCardHtml(card), { width: EVC_W, name: 'evidence-card.jpg' });
}

/* ============ صفحة التقرير الرسمي صورةً (الدفعة الثانية) ============
   - الاستبانة: تقرير نتائجها (svrReportHtml، app-47) بلا أسئلة النص الحر — قد يكتب ولي الأمر فيها اسم طالب.
   - الاختبار (تحليل/سلّم): تقرير الشعبة لهذا البند وحده (ssBuildFromAnalysis، app-38، ق11) بلا أسماء أبدًا
     (withNames: false = لا قائمة طلاب ولا أسماء في «الرصد غير المكتمل» ولا المقارنة).
   - الصفحة الأولى فقط (بنسبة A4)؛ والإرفاق باختيار المعلم (زر)، لا تلقائيًا. */
const EVR_PAGE_RATIO = 1.414;

/* تحليل الاستبانة بلا أسئلة النص الحر (دالة صرفة) */
function surveyAnalysisWithoutText(an){
  return Object.assign({}, an, { items: (an.items || []).filter(a => a.type !== 'text') });
}

/* HTML صفحة التقرير لبند في الورقة: report = { kind: 'survey', campaign, analysis, counts } | { kind: 'section', column, scores, students, sectionLabel } */
async function buildInboxReportHtml(report){
  if(report.kind === 'survey'){
    if(typeof shahidWarmLogos === 'function') await shahidWarmLogos();
    const meta = (currentUser && currentUser.user_metadata) || {};
    const who = { name: meta.full_name || '', org: [typeof getProfileSchool === 'function' ? getProfileSchool() : '', typeof getProfileSubject === 'function' ? getProfileSubject() : ''].filter(Boolean).join(' — ') };
    return { html: svrReportHtml(report.campaign, surveyAnalysisWithoutText(report.analysis), report.counts, who), width: 794 };
  }
  if(report.kind === 'section'){
    const col = report.column;
    const g = { sectionId: col.section_id, year: col.academic_year, semester: Number(col.semester), columns: [col], scores: report.scores, breakdown: null };
    const a = { g, students: report.students, key: col.id, label: report.sectionLabel || '' };
    const v = gradeAnalysisView(a);
    const html = await ssBuildFromAnalysis(a, v, gradeReportPrefsNow(), {
      date: localIsoDate(), logo: await gradeReportLogoData(), schoolLogo: await gradeReportSchoolLogoData(),
      withNames: false, prev: null, noDx: typeof reportDxOn === 'function' ? !reportDxOn() : false
    });
    return { html, width: typeof PRINT_DESIGN_W !== 'undefined' ? PRINT_DESIGN_W : 794, pad: 24 };
  }
  throw new Error('unknown_report');
}

async function renderInboxReportFile(report){
  const r = await buildInboxReportHtml(report);
  const pad = r.pad || 0;
  return renderHtmlImageFile(r.html, { width: r.width, pad, name: 'report-page.jpg', maxHeight: Math.round((r.width + 2 * pad) * EVR_PAGE_RATIO) });
}
