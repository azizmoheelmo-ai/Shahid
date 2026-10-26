/* ============================================================
   تحليل درجات الشعبة — يُفتح بالضغط على شريط الملخص أعلى الكشف
   ------------------------------------------------------------
   - نافذة واحدة بلا تبويب: اختيار العمود (المجموع أو أي عمود)، أرقام أساسية،
     توزيع الطلاب، ثلاث فئات بأسماء (يحتاج دعمًا · على الحافة · متفوقون)، وزر تصدير واحد.
   - ما لم يُرصد لا يُحسب (لا صفر): التحليل لمن رُصد له فقط، والعدد مذكور صراحةً.
   - «المجموع» يطابق شريط الكشف: نفس النقاط، والنسبة مما رُصد للطالب فعلًا.
   - الأسماء من طلاب الشعبة المحمَّلة فقط (فلترة صريحة بـ teacher_id في تحميل الكشف نفسه)،
     والتصدير بلا أسماء ما لم يُحدَّد غير ذلك.
   ============================================================ */

const GRADE_ANALYSIS_RULES = {
  edgeAbovePct: 10, /* «على الحافة»: نجح بهامش أقل من 10 نقاط مئوية فوق حد النجاح */
  topPct: 90        /* متفوق: 90% فأكثر */
};
const GRADE_ANALYSIS_BANDS = ['أقل من 50', '50–59', '60–69', '70–79', '80–89', '90 فأكثر'];
const GRADE_ANALYSIS_GROUPS = [
  { key: 'low', label: 'يحتاج دعمًا', tone: 'lo' },
  { key: 'edge', label: 'على الحافة', tone: 'mid' },
  { key: 'top', label: 'متفوقون', tone: 'hi' }
];

/* ============ دوال صرفة ============ */

function gradeAnalysisPassPct(){
  return typeof ATTENTION_RULES !== 'undefined' ? ATTENTION_RULES.gradeLowPct : 50;
}

function gradeAnalysisBandIndex(pct){
  return pct < 50 ? 0 : pct < 60 ? 1 : pct < 70 ? 2 : pct < 80 ? 3 : pct < 90 ? 4 : 5;
}

/* صفوف الطلاب لعمود التحليل: key = 'total' أو id عمود.
   points = درجة الطالب، pct = نسبته مما رُصد له (null = لم يُرصد). displayMax = السلّم المعروض. */
function gradeAnalysisRows(g, students, key, caps, testsOn){
  const columns = g.columns || [];
  if(key === 'total'){
    const perfMax = columns.filter(c => c.category === 'performance').reduce((a, c) => a + Number(c.max_score), 0);
    const displayMax = perfMax + (testsOn ? Number(caps.tests) : 0);
    const rows = (students || []).map(st => {
      const t = studentGradeTotal(studentGradeResult(columns, g.scores, st.id, caps), testsOn, caps);
      const has = t.points !== null && t.recordedMax > 0;
      return { id: st.id, name: st.full_name, points: has ? t.points : null, pct: has ? 100 * t.points / t.recordedMax : null, recordedMax: t.recordedMax, partial: has && t.recordedMax < displayMax };
    });
    return { rows, displayMax };
  }
  const col = columns.find(c => c.id === key);
  if(!col) return { rows: [], displayMax: 0 };
  const max = Number(col.max_score);
  const byStudent = new Map((g.scores || []).filter(s => s.column_id === col.id).map(s => [s.student_id, Number(s.score)]));
  return {
    displayMax: max,
    rows: (students || []).map(st => {
      const has = byStudent.has(st.id);
      return { id: st.id, name: st.full_name, points: has ? byStudent.get(st.id) : null, pct: has ? 100 * byStudent.get(st.id) / max : null, recordedMax: max, partial: false };
    })
  };
}

/* أرقام وفئات من الصفوف: لمن رُصد له فقط */
function analyzeGradeRows(rows, displayMax){
  const rec = rows.filter(r => r.points !== null);
  const pass = gradeAnalysisPassPct();
  const r2 = n => Math.round(n * 100) / 100;
  const pts = rec.map(r => r.points).sort((a, b) => a - b);
  const mid = pts.length >> 1;
  const sum = pts.reduce((a, b) => a + b, 0);
  const bands = GRADE_ANALYSIS_BANDS.map(() => 0);
  rec.forEach(r => { bands[gradeAnalysisBandIndex(r.pct)]++; });
  const byPct = (a, b) => a.pct - b.pct || a.name.localeCompare(b.name, 'ar');
  const groups = {
    low: rec.filter(r => r.pct < pass).sort(byPct),
    edge: rec.filter(r => r.pct >= pass && r.pct < pass + GRADE_ANALYSIS_RULES.edgeAbovePct).sort(byPct),
    top: rec.filter(r => r.pct >= GRADE_ANALYSIS_RULES.topPct).sort((a, b) => -byPct(a, b))
  };
  return {
    total: rows.length, recorded: rec.length, missing: rows.length - rec.length,
    partial: rec.filter(r => r.partial).length,
    avg: pts.length ? r2(sum / pts.length) : null,
    avgPct: pts.length && displayMax > 0 ? Math.round(100 * sum / pts.length / displayMax) : null,
    median: pts.length ? r2(pts.length % 2 ? pts[mid] : (pts[mid - 1] + pts[mid]) / 2) : null,
    min: pts.length ? pts[0] : null, max: pts.length ? pts[pts.length - 1] : null,
    passed: rec.length - groups.low.length,
    passRate: rec.length ? Math.round(100 * (rec.length - groups.low.length) / rec.length) : null,
    bands, groups, passPct: pass
  };
}

/* ============ النافذة ============ */
let crmGradeAnalysis = null; /* { g, students, key, open, exportOpen, label } — لقطة وقت الفتح */
let crmGradeAnalysisBusy = false;

function openCrmGradeAnalysis(){
  const g = crmGrades;
  if(!g || !hasBaseGradeColumns(g.allColumns || g.columns)) return;
  crmGradeAnalysis = { g, students: crmStudentsOfSection(g.sectionId), key: 'total', open: null, exportOpen: false, withNames: false, mode: 'bands', cmp: null, sib: null, prev: null, prevOpen: null, editing: null, label: crmSectionLabel(g.sectionId) };
  const a = crmGradeAnalysis;
  a.open = gradeAnalysisDefaultOpen(a);
  const opts = ['<option value="total">المجموع</option>'].concat(g.columns.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (من ${formatScore(c.max_score)})</option>`));
  showInfoModal(`<div class="crm-ga">
    <h3 class="crm-ga-h">تحليل الدرجات</h3>
    <div class="crm-gs-sub">${escapeHtml(a.label)}</div>
    <select class="crm-ga-sel" aria-label="العمود المراد تحليله" onchange="onCrmGradeAnalysisKey(this.value)">${opts.join('')}</select>
    <div id="crmGaBody"></div></div>`, '420px');
  paintCrmGradeAnalysis();
}

function gradeAnalysisView(a){
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const { rows, displayMax } = gradeAnalysisRows(a.g, a.students, a.key, caps, appToolOn('tests'));
  const col = a.key === 'total' ? null : a.g.columns.find(c => c.id === a.key);
  return { rows, displayMax, stats: analyzeGradeRows(rows, displayMax), colLabel: col ? col.name : 'المجموع' };
}

/* فئة «يحتاج دعمًا» مفتوحة من البداية إن وُجد فيها أحد — هي أول ما يبحث عنه المعلم */
function gradeAnalysisDefaultOpen(a){
  return gradeAnalysisView(a).stats.groups.low.length ? 'low' : null;
}

function onCrmGradeAnalysisKey(key){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.key = key;
  crmGradeAnalysis.open = gradeAnalysisDefaultOpen(crmGradeAnalysis);
  paintCrmGradeAnalysis();
}

function toggleCrmGaGroup(key){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.open = crmGradeAnalysis.open === key ? null : key;
  paintCrmGradeAnalysis();
}

function toggleCrmGaExport(){
  if(!crmGradeAnalysis) return;
  crmGradeAnalysis.exportOpen = !crmGradeAnalysis.exportOpen;
  paintCrmGradeAnalysis();
}

function paintCrmGradeAnalysis(){
  const box = document.getElementById('crmGaBody');
  if(box && crmGradeAnalysis) box.innerHTML = crmGradeAnalysisHtml(crmGradeAnalysis);
}

function gradeAnalysisTone(pct){
  const pass = gradeAnalysisPassPct();
  return pct < pass ? 'lo' : pct < GRADE_ANALYSIS_RULES.topPct ? 'mid' : 'hi';
}

function crmGradeAnalysisHtml(a){
  if(a.editing) return gaLettersEditorHtml(a); /* app-30 */
  const v = gradeAnalysisView(a);
  const s = v.stats;
  if(!s.total) return '<div class="empty-state">لا طلاب مربوطون بهذه الشعبة.</div>';
  if(!s.recorded) return '<div class="empty-state">لم تُرصد درجات لهذا العمود بعد.</div>';
  const tile = (val, label, sub, tone) => `<div class="crm-ga-tile${tone ? ' gs-tone-' + tone : ''}"><b>${val}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const pctOf = n => Math.round(100 * n / s.recorded) + '%';
  let notes = '';
  if(s.missing) notes += `المحلَّل ${s.recorded} من ${s.total} طالبًا — لم يُرصد لـ ${s.missing} فلا يدخلون في الحساب (لا يُعدّون أصفارًا). `;
  if(s.partial) notes += `${s.partial} طالبًا رُصد لهم جزء من الأعمدة فقط، ونسبة كل منهم مما رُصد له.`;
  let html = (notes ? `<div class="crm-ga-note">${notes}</div>` : '') + `<div class="crm-ga-tiles">
    ${tile(formatScore(s.avg), 'المتوسط', s.avgPct === null ? '' : s.avgPct + '%')}
    ${tile(formatScore(s.median), 'الوسيط')}
    ${tile(formatScore(s.min) + '–' + formatScore(s.max), 'أدنى – أعلى')}
    ${tile(s.passed, 'ناجحون', pctOf(s.passed), 'hi')}
    ${tile(s.groups.low.length, 'تحت النصف', pctOf(s.groups.low.length), s.groups.low.length ? 'lo' : '')}
    ${tile(s.groups.edge.length, 'على الحافة', 'نجحوا بهامش قليل')}
  </div>
  ${gaDistHtml(a, v)}
  <div class="crm-ga-sec">من هم؟</div>`;
  GRADE_ANALYSIS_GROUPS.forEach(gr => {
    const list = s.groups[gr.key];
    const on = a.open === gr.key && list.length;
    html += `<div class="crm-ga-grp gs-grp-${gr.tone}${on ? ' open' : ''}"><button type="button" class="crm-ga-ghead" aria-expanded="${!!on}" ${list.length ? '' : 'disabled'} onclick="toggleCrmGaGroup('${gr.key}')"><span>${gr.label}</span><b>${list.length}</b><span class="crm-am-chev" aria-hidden="true">⌄</span></button>`;
    if(on) html += '<div class="crm-ga-names">' + list.map(r => `<button type="button" class="crm-ga-name" onclick="openCrmGradeAnalysisStudent('${escapeHtml(r.id)}')"><span>${escapeHtml(r.name)}${r.partial ? `<small>رُصد من ${formatScore(r.recordedMax)} فقط</small>` : ''}</span><b class="gs-tone-${gradeAnalysisTone(r.pct)}">${formatScore(r.points)} · ${Math.round(r.pct)}%</b></button>`).join('') + '</div>';
    html += '</div>';
  });
  html += gaCompareHtml(a, v);
  html += a.exportOpen
    ? `<div class="crm-ga-exp"><label class="crm-ga-chk"><input type="checkbox" id="crmGaNames"${a.withNames ? ' checked' : ''} onchange="crmGradeAnalysis.withNames = this.checked"> مع أسماء الطلاب</label>
        <button type="button" class="crm-am-opt" onclick="exportCrmGradeAnalysis('pdf', this)">PDF صفحة واحدة</button>
        <button type="button" class="crm-am-opt" onclick="exportCrmGradeAnalysis('xlsx', this)">Excel</button></div>`
    : '<button type="button" class="btn btn-outline crm-ga-expbtn" onclick="toggleCrmGaExport()">⤓ تصدير</button>';
  return html;
}

/* الضغط على اسم: يفتح صفحة الطالب بالكشف (إن لم تتغيّر الشعبة المعروضة منذ فتح النافذة) */
function openCrmGradeAnalysisStudent(id){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId) return;
  closeCrmModal();
  openCrmGradeStudentDetail(id);
}

/* ============ التصدير ============ */
function gradeAnalysisExportRows(a, v, withNames){
  const s = v.stats;
  const rows = [
    ['تحليل الدرجات'], ['الشعبة', a.label], ['العمود', v.colLabel], [],
    ['المرصود', s.recorded, 'من', s.total],
    ['المتوسط', s.avg === null ? '' : s.avg], ['الوسيط', s.median === null ? '' : s.median],
    ['الأعلى', s.max === null ? '' : s.max], ['الأدنى', s.min === null ? '' : s.min],
    ['ناجحون', s.passed], ['تحت النصف', s.groups.low.length], ['على الحافة', s.groups.edge.length], ['متفوقون', s.groups.top.length],
    [], ['الفئة', 'العدد']
  ].concat(GRADE_ANALYSIS_BANDS.map((b, i) => [b, s.bands[i]]));
  const letters = gradeLettersNow();
  const lc = gradeLetterCounts(v.rows, letters);
  rows.push([], ['التقدير', 'من %', 'العدد']);
  letters.forEach((l, i) => rows.push([l.label, l.min, lc[i]]));
  if(withNames){
    const grpOf = r => r.points === null ? 'لم يُرصد' : r.pct < s.passPct ? 'يحتاج دعمًا' : r.pct < s.passPct + GRADE_ANALYSIS_RULES.edgeAbovePct ? 'على الحافة' : r.pct >= GRADE_ANALYSIS_RULES.topPct ? 'متفوق' : '';
    rows.push([], ['الطالب', 'الدرجة', 'النسبة %', 'الفئة', 'التقدير']);
    v.rows.forEach(r => rows.push([r.name, r.points === null ? '' : r.points, r.pct === null ? '' : Math.round(r.pct), grpOf(r), r.pct === null ? '' : letters[gradeLetterIndex(r.pct, letters)].label]));
  }
  return rows;
}

function gradeAnalysisPdfHtml(a, v, withNames){
  const s = v.stats;
  const cell = (val, label) => `<td style="border:1px solid #D8D2C4;padding:10px;text-align:center;"><div style="font-size:20px;font-weight:800;color:#1B3245;">${val}</div><div style="font-size:11px;color:#6B6659;">${label}</div></td>`;
  const maxBand = Math.max.apply(null, s.bands.concat(1));
  const bars = s.bands.map((n, i) => `<tr><td style="width:90px;font-size:11px;padding:3px 0;">${GRADE_ANALYSIS_BANDS[i]}</td><td><div style="background:#1B3245;height:12px;width:${Math.round(100 * n / maxBand)}%;min-width:${n ? 2 : 0}px;"></div></td><td style="width:34px;font-size:11px;text-align:left;">${n}</td></tr>`).join('');
  const names = withNames ? ['low', 'edge'].map(k => {
    const gr = GRADE_ANALYSIS_GROUPS.find(x => x.key === k);
    return s.groups[k].length ? `<div style="margin-top:12px;"><b style="font-size:13px;color:#1B3245;">${gr.label} (${s.groups[k].length})</b><div style="font-size:11.5px;line-height:1.9;">${s.groups[k].map(r => `${escapeHtml(r.name)} (${formatScore(r.points)})`).join(' · ')}</div></div>` : '';
  }).join('') : '';
  return `<div dir="rtl" style="font-family:'Cairo',sans-serif;padding:28px 32px;color:#232323;">
    <div style="background:#1B3245;color:#fff;padding:14px 18px;"><div style="font-size:20px;font-weight:800;">تحليل الدرجات</div>
      <div style="font-size:12px;opacity:.9;margin-top:4px;">${escapeHtml(a.label)} · ${escapeHtml(v.colLabel)}</div></div>
    <p style="font-size:11.5px;color:#6B6659;margin:10px 0;">المحلَّل ${s.recorded} من ${s.total} طالبًا (لم يُرصد: ${s.missing}). نسبة النجاح من ${s.passPct}%.</p>
    <table style="width:100%;border-collapse:collapse;"><tr>${cell(formatScore(s.avg), 'المتوسط')}${cell(formatScore(s.median), 'الوسيط')}${cell(formatScore(s.min) + '–' + formatScore(s.max), 'أدنى – أعلى')}</tr>
    <tr>${cell(s.passed + ' (' + s.passRate + '%)', 'ناجحون')}${cell(s.groups.low.length, 'تحت النصف')}${cell(s.groups.edge.length, 'على الحافة')}</tr></table>
    <div style="font-size:13px;font-weight:800;color:#1B3245;margin:14px 0 6px;">توزيع الطلاب حسب النسبة</div>
    <table style="width:100%;border-collapse:collapse;">${bars}</table>${names}</div>`;
}

async function exportCrmGradeAnalysis(kind, btn){
  const a = crmGradeAnalysis;
  if(crmGradeAnalysisBusy || !a) return;
  const v = gradeAnalysisView(a);
  if(!v.stats.recorded){ showToast('لا درجات مرصودة لتصديرها', 'error'); return; }
  const withNames = !!a.withNames;
  crmGradeAnalysisBusy = true;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  const dateStr = new Date().toISOString().slice(0, 10);
  const base = `تحليل-درجات-${String(a.label).replace(/[\\\/:*?"<>|\s]+/g, '-')}-${dateStr}`;
  try{
    if(kind === 'pdf'){
      await ensurePdfLibs();
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'pt', 'a4');
      await addPdfPage(pdf, document.getElementById('pdfRenderArea'), gradeAnalysisPdfHtml(a, v, withNames), { firstPage: true });
      pdf.save(base + '.pdf');
    } else {
      await ensureXlsxLib();
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      const ws = XLSX.utils.aoa_to_sheet(gradeAnalysisExportRows(a, v, withNames));
      ws['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws, 'التحليل');
      const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = base + '.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    showToast('تم التصدير', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + (err.message || ''), 'error');
  } finally {
    crmGradeAnalysisBusy = false;
    endExportBusy(btn);
  }
}
