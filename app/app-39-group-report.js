/* ============================================================
   تقرير مقارنة شعب الصف — بهوية وزارة التعليم (REPORTS.md §4.2.2، ق9، م10)
   ------------------------------------------------------------
   - النطاق: شعب المعلم نفسه من المرحلة الدراسية نفسها (شعبتان فأكثر لهما درجات)، ويُذكر في الترويسة.
   - الغرض: تحسين الممارسات التعليمية لا ترتيب الشعب: ضعف مشترك، قوة مشتركة، ضعف أو قوة في بعض الشعب، وتباين بين الشعب.
     لا أحكام على الشعب، والشعب مرتّبة بترتيب المعلم في التطبيق (لا بالمتوسط).
   - الجمهور داخلي (معلم، وكيل، إدارة، لجنة) — ليس لولي الأمر؛ ولا أسماء طلاب في هذا التقرير.
   - المعيار محكي (م10): كل طالب بالحدّين الثابتين، وتُقارَن الشعب بحصة طلابها في كل مستوى (لا بالأعداد).
   - بند يُحكم عليه في شعبة إذا رُصد لـSS_MIN_STUDENTS طلاب فأكثر؛ ويدخل المقارنة إن وُجد بالاسم في شعبتين فأكثر.
   - ضعف شعبة في بند = SS_SHARE% فأكثر من طلابها دون حدّ الضعف؛ قوتها = SS_SHARE% فأكثر بمستوى «متقن» (ودون SS_SHARE% دون الحدّ).
   - الفترات كجدول الشعبة: صف لكل فترة منتهية، وصف «الداخل في المجموع» الذي يُلوَّن ويُبنى عليه التشخيص.
   - لا تفسير سببي: البيانات تبيّن الفرق ولا تحدّد سببه.
   - كل نص من المستخدم/القاعدة يمرّ عبر escapeHtml.
   ============================================================ */

/* ============ دوال صرفة ============ */

/* تصنيف البنود المشتركة بين الشعب. secs = [{ label, items: [ssBuildItems…] }] (بترتيب العرض)
   الناتج: [{ name, measures, domain, per: [{ label, it, t, weak, strong }], kind, weak, strong }]
   kind: sharedWeak | sharedStrong | contrast | weakSome | strongSome | null */
function sgClassify(secs){
  const byName = new Map();
  (secs || []).forEach(sc => (sc.items || []).forEach(it => {
    if(it.total.n < SS_MIN_STUDENTS) return;
    const k = normalizeGradeColumnName(it.name);
    if(!byName.has(k)) byName.set(k, { name: it.name, measures: it.measures, domain: it.domain, per: [] });
    byName.get(k).per.push({ label: sc.label, it, t: it.total, weak: it.total.belowShare >= SS_SHARE, strong: it.total.topShare >= SS_SHARE && it.total.belowShare < SS_SHARE });
  }));
  return [...byName.values()].filter(x => x.per.length >= 2).map(x => {
    const weak = x.per.filter(p => p.weak), strong = x.per.filter(p => p.strong);
    let kind = null;
    if(x.domain){
      if(weak.length === x.per.length) kind = 'sharedWeak';
      else if(strong.length === x.per.length) kind = 'sharedStrong';
      else if(weak.length && strong.length) kind = 'contrast';
      else if(weak.length) kind = 'weakSome';
      else if(strong.length) kind = 'strongSome';
    }
    return Object.assign(x, { kind, weak, strong });
  });
}

const sgName = c => c.measures ? `${c.measures} (${c.name})` : c.name;
const sgList = (list, f) => list.map(f).join('، ');

/* توصيات لتحسين الممارسة: الدليل ← التشخيص ← الإجراء (بلا تفسير سببي) */
function sgRecommendations(cls){
  const recs = [];
  const pct = n => Math.round(n);
  cls.forEach(c => {
    const nm = sgName(c);
    const ev = c.per.map(p => `${p.label}: ${pct(p.t.belowShare)}% دون الحدّ`).join('، ');
    const what = c.measures || nm;
    if(c.kind === 'sharedWeak'){
      recs.push({ evidence: `${nm} — ${ev}`, diagnosis: 'ضعف مشترك بين الشعب في هذا البند', action: `إعادة تدريس ${what} لكل شعب الصف، ومراجعة أنشطة التقويم المتصلة به` });
    } else if(c.kind === 'weakSome'){
      const w = c.weak.map(p => p.label).join('، ');
      recs.push({ evidence: `${nm} — ${ev}`, diagnosis: `ضعف خاص بـ${w}`, action: `دعم موجَّه لـ${w} في ${what} (جلسات علاجية قصيرة)` });
    } else if(c.kind === 'contrast'){
      const s = c.strong.map(p => p.label).join('، '), w = c.weak.map(p => p.label).join('، ');
      recs.push({ evidence: `${nm} — قوة في ${s}، وضعف في ${w}`, diagnosis: 'فرق ملحوظ بين الشعب في البند نفسه؛ والبيانات لا تحدّد سببه',
        action: `مقارنة ما اختلف في تدريس ${what} بين ${s} و${w} (الأنشطة، والتقويم، والتغذية الراجعة)، ونقل الممارسة الأنسب` });
    }
  });
  return recs;
}

/* ============ HTML ============ */
const SG_CSS = `
.sr .sgstk{display:flex;height:9px;border-radius:5px;overflow:hidden;background:#e8eef1}.sr .sgstk i{display:block;height:100%}
.sr .sgleg{font-size:9px;color:#51636d;margin-top:3px;display:flex;gap:10px}.sr .sgleg s{display:inline-block;width:9px;height:9px;border-radius:2px;margin-left:3px;vertical-align:middle}
.sr .sgleg s.m{background:#07a869}.sr .sgleg s.j{background:#3d7eb9}.sr .sgleg s.w{background:#7258a4}
.sr .sgtot td{color:#51636d}
`;

function sgLevelsHtml(secs, max){
  const e = escapeHtml;
  const pc = (n, t) => t ? srNum(Math.round(100 * n / t) + '%') : '—';
  const stack = s => { const t = s.recorded || 1; return `<div class="sgstk"><i class="m" style="width:${100 * s.top / t}%"></i><i class="j" style="width:${100 * s.mid / t}%"></i><i class="w" style="width:${100 * s.low / t}%"></i></div>`; };
  return `<table><thead><tr><th>الشعبة</th><th class="n">الطلاب</th><th class="n">متوسط الشعبة</th><th class="n">متقن</th><th class="n">جيد</th><th class="n">يحتاج تحسين</th><th style="width:26%">توزيع المستويات</th></tr></thead><tbody>${secs.map(s =>
    `<tr><td><b>${e(s.label)}</b></td><td class="n">${srNum(s.recorded)}</td><td class="n">${s.avg === null ? '—' : srScore(Math.round(s.avg * 10) / 10, max)} <span class="nd">(${s.avgPct === null ? '—' : srNum(s.avgPct + '%')})</span></td><td class="n">${pc(s.top, s.recorded)}</td><td class="n">${pc(s.mid, s.recorded)}</td><td class="n">${pc(s.low, s.recorded)}</td><td>${stack(s)}</td></tr>`).join('')}</tbody></table>
    <div class="sgleg"><span><s class="m"></s>متقن</span><span><s class="j"></s>جيد</span><span><s class="w"></s>يحتاج تحسين</span></div>`;
}

/* جدول البنود بين الشعب: صف لكل فترة منتهية ثم «الداخل في المجموع» (وعليه التلوين)، وصف واحد لغير متعدد الفترات */
function sgMatrixHtml(cls, secs){
  const e = escapeHtml;
  const shortP = k => String(PERIOD_NAMES[k] || '').replace('الفترة ', '');
  const cell = (st, flag) => {
    const col = flag === 'w' ? 'color:#7258a4;font-weight:700' : flag === 's' ? 'color:#07a869;font-weight:700' : '';
    return `<td class="n"><span style="${col}">${srNum(Math.round(st.avgPct) + '%')}</span><div class="ev">${srNum(st.below)} من ${srNum(st.n)} دون الحدّ</div></td>`;
  };
  const flagOf = p => p.weak ? 'w' : p.strong ? 's' : '';
  const perOf = (c, sc) => c.per.find(q => q.label === sc.label);
  const body = cls.map(c => {
    const meas = c.measures ? `<div class="ev">يقيس: ${e(c.measures)}</div>` : '';
    const ks = [...new Set(c.per.flatMap(p => p.it.periods.map(q => q.k)))].sort((a, b) => a - b);
    if(ks.length >= 2){
      const rowsP = ks.map((k, i) => `<tr>${i === 0 ? `<td rowspan="${ks.length + 1}" class="gn"><b>${e(c.name)}</b>${meas}</td>` : ''}<td class="n">${e(shortP(k))}</td>${secs.map(sc => {
        const p = perOf(c, sc), pr = p && p.it.periods.find(q => q.k === k);
        return pr ? cell(pr.stat, '') : '<td class="n">—</td>';
      }).join('')}</tr>`).join('');
      const tot = `<tr class="sgtot"><td class="n">الداخل في المجموع</td>${secs.map(sc => { const p = perOf(c, sc); return p ? cell(p.t, flagOf(p)) : '<td class="n">—</td>'; }).join('')}</tr>`;
      return `<tbody class="grp">${rowsP}${tot}</tbody>`;
    }
    return `<tbody class="grp"><tr><td class="gn"><b>${e(c.name)}</b>${meas}</td><td class="n">${c.per.some(p => p.it.lonePeriod) ? e(shortP(c.per.find(p => p.it.lonePeriod).it.lonePeriod)) : '—'}</td>${secs.map(sc => { const p = perOf(c, sc); return p ? cell(p.t, flagOf(p)) : '<td class="n">—</td>'; }).join('')}</tr></tbody>`;
  }).join('');
  return `<table class="itm"><thead><tr><th>البند</th><th class="n">الفترة</th>${secs.map(sc => `<th class="n">${e(sc.label)}</th>`).join('')}</tr></thead>${body}</table>
    <div class="fn">اللون البنفسجي: ${srNum(SS_SHARE + '%')} فأكثر من طلاب الشعبة دون حدّ الضعف · الأخضر: ${srNum(SS_SHARE + '%')} فأكثر بمستوى «متقن» (على «الداخل في المجموع»). البنود تُطابَق بالاسم بين الشعب، ولا يظهر بند رُصد لأقل من ${srNum(SS_MIN_STUDENTS)} طلاب في شعبته.</div>`;
}

function sgDiagHtml(cls, domain, title){
  const e = escapeHtml;
  const lines = [];
  cls.filter(c => c.domain === domain && c.kind).forEach(c => {
    const nm = e(sgName(c));
    const wl = sgList(c.weak, p => `${e(p.label)} <span class="nd">(${srNum(Math.round(p.t.belowShare))}% دون الحدّ)</span>`);
    const sl = sgList(c.strong, p => `${e(p.label)} <span class="nd">(${srNum(Math.round(p.t.topShare))}% متقنون)</span>`);
    if(c.kind === 'sharedWeak') lines.push(`<div class="box p"><b>ضعف مشترك:</b> ${nm} — في كل الشعب: ${wl}.</div>`);
    else if(c.kind === 'sharedStrong') lines.push(`<div class="box s"><b>قوة مشتركة:</b> ${nm} — في كل الشعب: ${sl}.</div>`);
    else if(c.kind === 'contrast') lines.push(`<div class="box f"><b>تباين بين الشعب:</b> ${nm} — قوة في ${sl}، وضعف في ${wl}.</div>`);
    else if(c.kind === 'weakSome') lines.push(`<div class="box p"><b>ضعف في بعض الشعب:</b> ${nm} — ${wl}.</div>`);
    else if(c.kind === 'strongSome') lines.push(`<div class="box s"><b>قوة في بعض الشعب:</b> ${nm} — ${sl}.</div>`);
  });
  const has = cls.some(c => c.domain === domain);
  if(!lines.length) lines.push(`<div class="box"><span class="nd">${has ? 'لا نقاط قوة ولا ضعف مثبتة في المجموعة.' : 'لا بيانات كافية للمقارنة (لا بند مشترك رُصد لـ' + SS_MIN_STUDENTS + ' طلاب فأكثر في شعبتين).'}</span></div>`);
  return `<div class="sec"><h2>${title}</h2>${lines.join('')}</div>`;
}

function sgStatsHtml(p){
  if(!p || p.min === null) return '';
  const k = (v, l) => `<div><b>${srNum(v)}</b><span>${l}</span></div>`;
  return `<div class="sec"><h2>المؤشرات الإحصائية للمجموعة</h2><div class="kp">${k(formatScore(p.min), 'أقل درجة')}${k(formatScore(p.max), 'أعلى درجة')}${k(formatScore(p.median), 'الوسيط')}${k(formatScore(p.avg), 'المتوسط')}</div></div>`;
}

/* ctx: { gradeName, term, date, prefs, logo, schoolLogo, rules, secs: [{ label, recorded, top, mid, low, avg, avgPct, items }], max, pooled: { avgPct, low, stats }, cls } */
function buildGroupReportHtml(ctx){
  const e = escapeHtml;
  const prefs = ctx.prefs || {};
  const show = prefs.show || { levels: true, items: true, stats: true };
  const school = gradeReportSchool(prefs), subject = gradeReportSubject(prefs), teacher = gradeReportTeacherName(prefs);
  const sem = Number(ctx.term.semester) === 2 ? 'الثاني' : 'الأول';
  const logo = ctx.logo && GRADE_REPORT_DATA_RE.test(ctx.logo) ? `<img src="${ctx.logo}" alt="">` : '';
  const slogo = ctx.schoolLogo && GRADE_REPORT_DATA_RE.test(ctx.schoolLogo) ? `<img src="${ctx.schoolLogo}" alt="">` : '';
  const secs = ctx.secs;
  const total = secs.reduce((a, s) => a + s.recorded, 0);
  const meta = (k, v) => `<div><small>${k}</small><b>${e(v || '—')}</b></div>`;
  const head = `<div class="hd"><div class="mo">${logo}</div><div class="tt"><div class="sch">${school ? e(school) : 'اسم المدرسة'}</div><h1>تقرير مقارنة شعب الصف</h1></div><div class="sl">${slogo}</div></div>`;
  const metaHtml = `<div class="mt">${meta('الصف', ctx.gradeName)}${meta('الفصل الدراسي', `${sem} ${ctx.term.year}`)}${meta('المادة', subject)}${meta('المعلم', teacher)}${meta('شعب المعلم من الصف نفسه', secs.map(s => s.label).join('، '))}${meta('التاريخ', ctx.date)}</div>`;
  const kp = `<div class="kp"><div><b>${srNum(secs.length)}</b><span>شعب</span></div><div><b>${srNum(total)}</b><span>طلاب مرصودة درجاتهم</span></div><div><b>${ctx.pooled.avgPct === null ? '—' : srNum(ctx.pooled.avgPct + '%')}</b><span>متوسط المجموعة</span></div><div><b>${total ? srNum(Math.round(100 * ctx.pooled.low / total) + '%') : '—'}</b><span>يحتاجون تحسين</span></div></div>`;
  const recs = sgRecommendations(ctx.cls);
  const recHtml = recs.length ? `<div class="sec"><h2>التوصيات لتحسين الممارسة</h2>${recs.map(r => `<div class="rc"><div><b>الدليل:</b> ${e(r.evidence)}</div><div><b>التشخيص:</b> ${e(r.diagnosis)}</div><div><b>الإجراء المقترح:</b> ${e(r.action)}</div></div>`).join('')}</div>` : '';
  const sign = `<div class="sgn"><div><small>${e(teacher)}</small>معلم المادة</div><div><small>${e(prefs.vice || '')}</small>وكيل شؤون الطلاب</div></div>`;
  const matrixCls = ctx.cls;
  return `<style>${SR_CSS}${SS_CSS}${SG_CSS}</style><div class="sr">${head}${metaHtml}${kp}
    ${show.levels === false ? '' : `<div class="sec"><h2>مقارنة مستويات الطلاب بين الشعب (حصة كل مستوى)</h2>${sgLevelsHtml(secs, ctx.max)}</div>`}
    ${show.items === false || !matrixCls.length ? '' : `<div class="sec long"><h2>مقارنة البنود بين الشعب (متوسط الشعبة)</h2>${sgMatrixHtml(matrixCls, secs)}</div>`}
    ${sgDiagHtml(ctx.cls, 'tahsili', 'التشخيص: ماذا يتقن الطلاب (التحصيل)')}${sgDiagHtml(ctx.cls, 'taalumi', 'التشخيص: كيف يتعلّم الطلاب (الإنجاز والمشاركة والالتزام)')}
    ${recHtml}${show.stats === false ? '' : sgStatsHtml(ctx.pooled.stats)}<div class="fin">${sign}</div><div class="strip"></div></div>`;
}

/* من نافذة التحليل (تقرير المجموعة، البند «المجموع»): كشف كل شعبة من loadCrmGradeSheet (به الفترات)؛
   الشعبة الحالية من a.g المحمَّل. يرجع html أو '' (مع تنبيه) */
async function sgBuildFromAnalysis(a, prefs, ctx){
  const g0 = a.g;
  const sibIds = gradeSiblingSectionIds(g0);
  const ids = crmSections.map(s => s.id).filter(id => id === g0.sectionId || sibIds.includes(id)); /* ترتيب المعلم لشعبه */
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const rules = srRulesNow();
  const term = { year: g0.year, semester: g0.semester };
  const secs = [];
  let allRows = [], displayMax = null;
  for(const id of ids){
    let g = id === g0.sectionId ? g0 : await loadCrmGradeSheet(id);
    if(g && g.error) throw g.error;
    if(crmGradeAnalysis !== a) return '';
    if(g.year !== g0.year || Number(g.semester) !== Number(g0.semester)) throw new Error('تغيّر الفصل أثناء التحميل');
    if(!hasBaseGradeColumns(g.columns)) continue;
    const students = crmStudentsOfSection(id);
    const res = gradeAnalysisRows(g, students, 'total', caps, testsOn);
    if(!res.rows.length) continue;
    const st = analyzeGradeRows(res.rows, res.displayMax);
    if(!st.recorded) continue;
    if(displayMax === null) displayMax = res.displayMax;
    allRows = allRows.concat(res.rows);
    const lc = ssLevelCounts(res.rows, rules);
    const items = ssBuildItems(g.columns, g.scores, students.map(s => s.id), g.breakdown || null, c => periodCfg(term, periodCompKeyOfColumn(c)), rules, srToolTypeOf);
    secs.push({ id, label: crmSectionLabel(id), recorded: lc.recorded, top: lc.top, mid: lc.mid, low: lc.low, avg: st.avg, avgPct: st.avgPct, items });
  }
  if(secs.length < 2){ showToast('لا بيانات مرصودة كافية في شعب الصف للمقارنة', 'error'); return ''; }
  const pst = analyzeGradeRows(allRows, displayMax);
  const lcp = ssLevelCounts(allRows, rules);
  const level = typeof crmGradeLevels !== 'undefined' && crmSectionById(g0.sectionId) ? crmGradeLevels.find(x => x.id === crmSectionById(g0.sectionId).grade_level_id) : null;
  await srEnsureFonts();
  return buildGroupReportHtml({ gradeName: level ? level.name : 'الصف', term, date: ctx.date, prefs, logo: ctx.logo, schoolLogo: ctx.schoolLogo, rules, secs, max: displayMax,
    pooled: { avgPct: pst.avgPct, low: lcp.low, stats: pst }, cls: sgClassify(secs) });
}
