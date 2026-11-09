/* ============================================================
   تقرير نتائج استبانة رضا المستفيدين (PDF) — REPORTS.md §4.8، ق28
   ------------------------------------------------------------
   - بهوية وزارة التعليم (ترويسة moeHeaderHtml وألوان MOE_*، الخط الاحتياطي Cairo): أنماط مضمَّنة بعرض 794px،
     فلا أصناف جديدة بـstyle.css (م5). يخرج عبر printPages (fit:'width': ينساب على صفحات بلا قصّ).
   - لا يُصدَّر إلا ما تعرضه الشاشة: بعد بلوغ عتبة الردود، وبالمدقّق المشترك نفسه (الردود غير الصالحة تُستبعد ويُذكر عددها).
   - لا حكم دون دليل (م1): «أضعف محور» لا يُكتب إلا بأكثر من تقييم؛ ولا توصيات مخترَعة.
   - الردود مجهولة الربط أصلًا: لا أسماء طلاب ولا مستلمين هنا، والتعليقات الحرة مخلوطة الترتيب.
   - كل نص من المعلم أو من المستفيدين يمرّ عبر escapeHtml. الزر يتعطل أثناء التجهيز (beginExportBusy).
   ============================================================ */

const SVR_MAX_COMMENTS = 8; /* تعليقات الحرّ لكل سؤال بالتقرير؛ الباقي يُعدّ ولا يُسرد (م8: صفحة قصيرة) */

/* ============ دوال صرفة ============ */

function svrPctText(v){ return v == null ? '—' : Math.round(v) + '%'; }

/* شريط نسبة بسيط (للطباعة: ألوان مثبَّتة) */
function svrBarHtml(pct, color){
  const w = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return `<div style="height:8px;background:#e8eef2;border-radius:4px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><div style="height:8px;width:${w}%;background:${color || MOE_BLUE};border-radius:4px;"></div></div>`;
}

function svrQuestionHtml(a, weak){
  const lab = `<div style="font-size:13px;color:${MOE_NAVY};line-height:1.8;overflow-wrap:anywhere;">${escapeHtml(a.label)}</div>`;
  const box = inner => `<div style="padding:9px 12px;border-bottom:1px solid ${MOE_LINE};break-inside:avoid;">${inner}</div>`;
  if(a.type === 'rating'){
    const isWeak = !!weak && weak.id === a.id;
    return box(`<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">${lab}<b style="font-size:14px;color:${isWeak ? '#7258a4' : MOE_NAVY};">${escapeHtml(svFmtAvg(a.avg))} من 5</b></div>${svrBarHtml(a.avg == null ? 0 : a.avg / 5 * 100, isWeak ? '#7258a4' : MOE_BLUE)}`);
  }
  if(a.type === 'truefalse'){
    return box(`<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">${lab}<b style="font-size:14px;color:#07a869;">${escapeHtml(svrPctText(a.pct))} صح</b></div>${svrBarHtml(a.pct || 0, '#07a869')}`);
  }
  if(a.type === 'choice'){
    const max = Math.max(1, ...a.counts.map(c => c.count));
    return box(`${lab}${a.counts.map(c => `<div style="display:flex;align-items:center;gap:10px;font-size:12px;margin-top:6px;"><span style="width:130px;flex:none;color:${MOE_NAVY};">${escapeHtml(c.label)}</span><div style="flex:1;">${svrBarHtml(100 * c.count / max, MOE_BLUE)}</div><b style="width:26px;text-align:left;color:${MOE_NAVY};">${c.count}</b></div>`).join('')}`);
  }
  if(a.type === 'text'){
    if(!a.texts.length) return '';
    const shown = a.texts.slice(0, SVR_MAX_COMMENTS);
    const more = a.texts.length - shown.length;
    return box(`${lab}${shown.map(t => `<div style="margin-top:6px;padding:6px 10px;background:${MOE_TINT};font-size:12px;line-height:1.9;color:#232323;overflow-wrap:anywhere;border-right:3px solid ${MOE_BLUE};">${escapeHtml(t)}</div>`).join('')}${more > 0 ? `<div style="margin-top:6px;font-size:11px;color:${MOE_MUTED};">و ${more} ${more === 1 ? 'تعليق آخر' : 'تعليقات أخرى'} لم تُسرد</div>` : ''}`);
  }
  return '';
}

/* مدخلات: الاستبانة، وتحليلها (svAnalyze الصالح)، والعدّادات، وبيانات المعلم. تُرجع HTML بعرض 794px */
function svrReportHtml(c, an, counts, who){
  const pct = svOverallPct(an.items);
  const weak = svWeakestRating(an.items);
  const aud = TOOLS_AUDIENCES[c.audience] ? TOOLS_AUDIENCES[c.audience].group : '';
  const rate = counts.total ? Math.min(100, Math.round(100 * an.valid / counts.total)) : null;
  const dateText = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });
  const cell = (l, v) => `<div style="flex:1;min-width:0;"><div style="font-size:10.5px;color:${MOE_MUTED};">${escapeHtml(l)}</div><div style="font-size:13px;font-weight:700;color:${MOE_NAVY};margin-top:2px;overflow-wrap:anywhere;">${escapeHtml(v)}</div></div>`;
  const info = `<div style="display:flex;gap:14px;margin:14px 28px 0;padding:11px 14px;background:${MOE_TINT};border:1px solid ${MOE_LINE};border-radius:6px;">${cell('الاستبانة', c.title)}${cell('الجهة', aud)}${cell('عدد الردود', String(an.valid))}${rate == null ? '' : cell('نسبة الرد', rate + '%')}${cell('تاريخ التقرير', dateText)}</div>`;
  const headline = pct == null ? '' : `<div style="display:flex;align-items:center;gap:16px;margin:14px 28px 0;"><div style="font-size:40px;font-weight:700;color:${MOE_NAVY};line-height:1;">${pct}%</div><div style="font-size:12.5px;line-height:1.9;color:${MOE_MUTED};">متوسط التقييمات<br>${weak ? `<span style="color:#7258a4;">أضعف محور: ${escapeHtml(weak.label)} (${escapeHtml(svFmtAvg(weak.avg))} من 5)</span>` : ''}</div></div>`;
  const invalid = an.invalid ? `<div style="margin:10px 28px 0;font-size:11px;color:#7258a4;">${an.invalid} ${an.invalid === 1 ? 'رد' : 'ردود'} لا يطابق صيغة الأسئلة فاستُبعد من الحساب.</div>` : '';
  const blocks = an.items.map(a => svrQuestionHtml(a, weak)).join('');
  const few = svMinResults(c) < 5 ? ' العدد قليل وقد يُعرف صاحب الرد.' : '';
  return `<div dir="rtl" style="width:794px;box-sizing:border-box;background:#fff;font-family:${MOE_FONT};color:${MOE_NAVY};padding:22px 0 18px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    ${moeHeaderHtml('نتائج استبانة رضا المستفيدين', c.title, [who.name, who.org].filter(Boolean))}
    ${info}${headline}${invalid}
    <div style="margin:14px 28px 0;border:1px solid ${MOE_LINE};border-radius:6px;overflow:hidden;">${moeBarHtml('نتائج الأسئلة')}${blocks}</div>
    <div style="margin:12px 28px 0;font-size:11px;color:${MOE_MUTED};line-height:1.9;">الردود غير مربوطة بأسماء أصحابها.${few}</div>
    ${moeStripHtml('14px 28px 0')}
  </div>`;
}

/* ============ التصدير ============ */

let svReportBusy = false;

async function svExportReport(evt){
  if(svReportBusy || !svState || !svState.campaign) return;
  const btn = evt && evt.target && evt.target.closest ? evt.target.closest('button') : null;
  const token = svState.token;
  const c = svState.campaign;
  const an = svAnalyze(svState.responses, c.questions);
  /* لا يُصدَّر إلا ما تعرضه الشاشة: أسئلة سليمة وبلوغ العتبة */
  if(!an.ok || an.valid < svMinResults(c)){ showToast('لا نتائج للتصدير بعد', 'error'); return; }
  const counts = svCounts(svVisibleInvites());
  const meta = (currentUser && currentUser.user_metadata) || {};
  const who = { name: meta.full_name || '', org: [typeof getProfileSchool === 'function' ? getProfileSchool() : '', typeof getProfileSubject === 'function' ? getProfileSubject() : ''].filter(Boolean).join(' — ') };
  svReportBusy = true;
  beginExportBusy(btn, 'جارٍ التجهيز…');
  try{
    await shahidWarmLogos(); /* شعارا الوزارة والمدرسة (بلا شعار لو تعذّر) */
    if(!svStillOpen(token)) return; /* أُغلقت النافذة أثناء التجهيز */
    await printPages([{ html: svrReportHtml(c, an, counts, who), fit: 'width' }], printFileTitle('نتائج-استبانة'));
  } catch(err){
    showToast('تعذّر تجهيز التقرير: ' + (err && err.message ? err.message : 'خطأ'), 'error');
  } finally {
    svReportBusy = false;
    endExportBusy(btn);
  }
}
