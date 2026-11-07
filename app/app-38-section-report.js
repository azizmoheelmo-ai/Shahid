/* ============================================================
   تقرير الشعبة (المجموع) — بهوية وزارة التعليم (REPORTS.md §4.2.1، ق8، م10)
   ------------------------------------------------------------
   - الجمهور غير محدد بجهة (معلم، وكيل، إدارة، لجنة، ولي أمر): لهجة تربوية.
   - المرجعية محكية: «متقن · جيد · يحتاج تحسين» بحدّي المعلم؛ والمعياري مقارنة فقط (م10).
   - تشخيص على مستويين (تحصيلي · تعلّمي) كتقرير الطالب، بمعيار واحد للصف:
     ضعف جماعي = SS_SHARE% فأكثر من الطلاب المرصود لهم دون حدّ الضعف؛ قوة جماعية = SS_SHARE% فأكثر منهم بمستوى «متقن».
   - لا حكم على بند رُصد لأقل من SS_MIN_STUDENTS طلاب. «يقيس» يدخل تسمية البند إن وُجد.
   - الفترات كجدول الطالب (ق7): فترات منتهية فقط، ومتوسط الشعبة لكل فترة، ثم «الداخل في المجموع».
   - يظهر الرصد غير المكتمل (استثناء من م9 لتقارير الصف)، والأسماء عند تشغيل خيار الأسماء فقط.
   - بدائل «الأعلى درجات» النسبية لا تُستعمل هنا (م10).
   - كل نص من المستخدم/القاعدة يمرّ عبر escapeHtml، والاستعلامات لا تُجرى هنا (من كشف الشعبة المحمَّل).
   ============================================================ */

const SS_MIN_STUDENTS = 5;
const SS_SHARE = 30;

/* ============ دوال صرفة ============ */

/* إحصاء قيم بند (درجات) لشعبة: n، المتوسط، النسبة، دون حدّ الضعف، بحدّ متقن */
function ssStat(values, max, rules){
  /* غير المرصود (null/فارغ) ليس صفرًا: لا يُحسب */
  const v = (values || []).filter(x => x !== null && x !== undefined && x !== '').map(Number).filter(Number.isFinite);
  if(!v.length || !(Number(max) > 0)) return null;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const pcts = v.map(x => 100 * x / Number(max));
  const below = pcts.filter(p => p < rules.pass).length, top = pcts.filter(p => p >= rules.top).length;
  return { n: v.length, avg, avgPct: 100 * avg / Number(max), below, top, belowShare: 100 * below / v.length, topShare: 100 * top / v.length, max: Number(max) };
}

/* بنود الشعبة المرصودة (ما لم يُرصد لأحد لا يظهر — م9)، والفترات المنتهية فقط للمكوّن متعدد الفترات.
   cols = أعمدة الكشف الظاهرة؛ scores = [{column_id, student_id, score}]؛ ids = طلاب الشعبة
   breakdown: Map(عمود ← Map(طالب ← {p1,p2,p3})) أو null؛ cfgOf(col) = إعداد الفترات */
function ssBuildItems(cols, scores, ids, breakdown, cfgOf, rules, toolTypeOf){
  const out = [];
  (cols || []).forEach(c => {
    const idset = new Set(ids);
    const vals = (scores || []).filter(s => s.column_id === c.id && idset.has(s.student_id)).map(s => Number(s.score));
    const total = ssStat(vals, c.max_score, rules);
    if(!total) return;
    const base = { id: c.id, name: c.name, measures: c.measures || null, category: c.category, kind: c.kind || 'manual', tool_id: c.tool_id || null, max: Number(c.max_score), total };
    base.domain = srDomainOf(c, toolTypeOf);
    const cfg = c.category === 'performance' && cfgOf ? cfgOf(c) : null;
    const bd = cfg && cfg.n > 1 && breakdown ? breakdown.get(c.id) : null;
    const periods = [];
    if(bd){
      const counted = countedPeriodsOf(cfg);
      for(let k = 1; k <= cfg.n; k++){
        if(counted !== null && k > counted) continue;
        const pv = [];
        bd.forEach((v, sid) => { if(idset.has(sid) && v && v['p' + k] !== null && v['p' + k] !== undefined) pv.push(Number(v['p' + k])); });
        const st = ssStat(pv, c.max_score, rules);
        if(st) periods.push({ k, stat: st });
      }
    }
    out.push(Object.assign(base, { periods: periods.length >= 2 ? periods : [], lonePeriod: periods.length === 1 ? periods[0].k : null }));
  });
  return out;
}

const ssLabel = it => it.measures ? `${it.measures} (${it.name})` : it.name;

/* التشخيص على مستوى الصف: ضعف/قوة بحصة الطلاب، تقدّم بين فترات المكوّن أو اختبارات مرتبطة، توصيات بسلسلة كاملة */
function ssDiagnose(items, rules, groups){
  const sure = (items || []).filter(it => it.domain && it.total.n >= SS_MIN_STUDENTS);
  const dom = d => {
    const list = sure.filter(it => it.domain === d);
    const weak = list.filter(it => it.total.belowShare >= SS_SHARE).sort((a, b) => b.total.belowShare - a.total.belowShare);
    const strong = list.filter(it => it.total.topShare >= SS_SHARE && it.total.belowShare < SS_SHARE).sort((a, b) => b.total.topShare - a.total.topShare);
    return { enough: list.length > 0, weak, strong };
  };
  const tahsili = dom('tahsili'), taalumi = dom('taalumi');
  /* التقدّم: فترات المكوّن نفسه (متوسط الشعبة لأول وآخر فترة منتهية)، واختبارات رُبطت أو تطابق «يقيس» فيها */
  const progress = [];
  (items || []).filter(it => it.periods.length >= 2).forEach(it => {
    const a = it.periods[0], b = it.periods[it.periods.length - 1];
    const d = b.stat.avgPct - a.stat.avgPct;
    progress.push({ name: it.name, label: 'بين فترتين منتهيتين', from: a.stat.avgPct, to: b.stat.avgPct, kind: 'periods', trend: d >= SR_PROGRESS_DELTA ? 'up' : d <= -SR_PROGRESS_DELTA ? 'down' : 'flat' });
  });
  const tests = (items || []).filter(it => it.category === 'tests').map(it => ({ name: it.name, measures: it.measures, it }));
  tlComparableClasses(tests, groups).forEach(cl => {
    const a = cl.members[0].it, b = cl.members[cl.members.length - 1].it, d = b.total.avgPct - a.total.avgPct;
    progress.push({ name: '', label: cl.label, from: a.total.avgPct, to: b.total.avgPct, fromLabel: a.name, toLabel: b.name, kind: 'tests', trend: d >= SR_PROGRESS_DELTA ? 'up' : d <= -SR_PROGRESS_DELTA ? 'down' : 'flat' });
  });
  /* توصيات: الدليل (حصة الطلاب دون حدّ الضعف) ← التشخيص ← الإجراء */
  const recs = [];
  const pct = n => Math.round(n);
  tahsili.weak.forEach(it => recs.push({
    evidence: `${it.total.below} من ${it.total.n} طالبًا (${pct(it.total.belowShare)}%) دون ${rules.pass}% في ${ssLabel(it)}`,
    diagnosis: it.measures ? `ضعف جماعي في ${it.measures}` : `ضعف جماعي في ${it.name}`,
    action: it.measures ? `إعادة تدريس ${it.measures} بأنشطة قصيرة ثم إعادة تقييمها` : `مراجعة المهارات التي يقيسها «${it.name}» ثم إعادة تقييمها` }));
  taalumi.weak.forEach(it => recs.push({
    evidence: `${it.total.below} من ${it.total.n} طالبًا (${pct(it.total.belowShare)}%) دون ${rules.pass}% في ${it.name}`,
    diagnosis: `ضعف جماعي في ${it.name}`,
    action: it.kind === 'homework' ? 'تعزيز متابعة تسليم الواجبات وتذكير الطلاب بمواعيدها' : it.kind === 'participation' ? 'توزيع فرص المشاركة على الطلاب وتحفيزهم عليها' : `متابعة «${it.name}» مع الطلاب وتحفيزهم عليه` }));
  return { tahsili, taalumi, progress, recs };
}

/* مستويات الطلاب بالحدّين (محكية): لمكتملي الرصد فقط؛ بلا بديل «الأعلى درجات» (م10) */
function ssLevelCounts(rows, rules){
  const rec = (rows || []).filter(r => r.points !== null && r.points !== undefined && !r.incomplete && r.pct !== null && r.pct !== undefined);
  return {
    recorded: rec.length,
    top: rec.filter(r => r.pct >= rules.top).length,
    low: rec.filter(r => r.pct < rules.pass).length,
    mid: rec.filter(r => r.pct >= rules.pass && r.pct < rules.top).length
  };
}

/* ============ HTML ============ */
const SS_CSS = `
.sr .lv .bw{width:34%}.sr .lv .bar{min-width:120px}
.sr table.rs2 td:nth-child(4){border-left:2px solid #c2c1c1}.sr table.rs2 th:nth-child(4){border-left:2px solid #fff}
.sr .pair{display:flex;gap:12px;align-items:flex-start;break-inside:avoid}.sr .pair>.sec{flex:1 1 0;min-width:0}
.sr table.rs2 td,.sr .fin table td{padding-top:1px;padding-bottom:1px}.sr table.rs2 .chip{line-height:1.5}
.sr .fin{break-inside:avoid}.sr .cmpw{display:flex;gap:10px}.sr .cmpw>div{flex:1;min-width:0}
`;

function ssLevelsHtml(counts, incompleteN, total, rules, compact){
  const rec = counts.recorded;
  if(compact){
    /* نسخة مدمجة (نصف عرض الصفحة): الحد بجانب المستوى، بلا عمود شريط */
    const crow = (lvKey, label, limit, n) => `<tr><td><span class="chip ${lvKey}">${label}</span> <span class="nd">${limit}</span></td><td class="n"><b>${srNum(n)}</b></td><td class="n">${rec ? srNum(Math.round(100 * n / rec) + '%') : '—'}</td></tr>`;
    return `<table class="lv"><thead><tr><th>المستوى</th><th class="n">عدد الطلاب</th><th class="n">النسبة</th></tr></thead><tbody>`
      + crow('m', 'متقن', `${rules.top}% فأكثر`, counts.top)
      + crow('j', 'جيد', `${rules.pass}% – أقل من ${rules.top}%`, counts.mid)
      + crow('w', 'يحتاج تحسين', `أقل من ${rules.pass}%`, counts.low)
      + (incompleteN ? `<tr><td><span class="nd">رصد غير مكتمل · لا يُصنَّفون</span></td><td class="n"><b>${srNum(incompleteN)}</b></td><td></td></tr>` : '')
      + `<tr class="sub"><td><b>المجموع</b></td><td class="n"><b>${srNum(total)}</b></td><td></td></tr></tbody></table>`;
  }
  const row = (lvKey, label, limit, n) => `<tr><td><span class="chip ${lvKey}">${label}</span></td><td>${limit}</td><td class="n"><b>${srNum(n)}</b></td><td class="n">${rec ? srNum(Math.round(100 * n / rec) + '%') : '—'}</td><td class="bw"><div class="bar"><i class="${lvKey}" style="width:${rec ? Math.round(100 * n / rec) : 0}%"></i></div></td></tr>`;
  return `<table class="lv"><thead><tr><th>المستوى</th><th>الحد</th><th class="n">عدد الطلاب</th><th class="n">النسبة</th><th></th></tr></thead><tbody>`
    + row('m', 'متقن', `${rules.top}% فأكثر`, counts.top)
    + row('j', 'جيد', `من ${rules.pass}% إلى أقل من ${rules.top}%`, counts.mid)
    + row('w', 'يحتاج تحسين', `أقل من ${rules.pass}%`, counts.low)
    + (incompleteN ? `<tr><td><span class="nd">رصد غير مكتمل</span></td><td class="nd">لا يُصنَّفون</td><td class="n"><b>${srNum(incompleteN)}</b></td><td></td><td></td></tr>` : '')
    + `<tr class="sub"><td><b>المجموع</b></td><td></td><td class="n"><b>${srNum(total)}</b></td><td></td><td></td></tr></tbody></table>`;
}

/* جدول البنود (الخيار ج بأرقام الشعبة): البند · الفترة · متوسط الشعبة · المستوى · دون حدّ الضعف · الداخل في المجموع */
function ssItemsHtml(items, rules, compact){
  const e = escapeHtml;
  const short = k => String(PERIOD_NAMES[k] || '').replace('الفترة ', '');
  const avgCell = st => `${srScore(Math.round(st.avg * 10) / 10, st.max)} <span class="nd">(${srNum(Math.round(st.avgPct) + '%')})</span>`;
  const lvCell = st => srChip(srLevel(st.avgPct, rules));
  const belowCell = st => `${srNum(st.below)} من ${srNum(st.n)}`;
  if(compact){
    /* نسخة مدمجة (كل البنود بفترة واحدة): «الفترة» فارغة و«الداخل في المجموع» يكرّر المتوسط فيُحذفان */
    const crow = it => `<tr><td><b>${e(it.name)}</b>${it.measures ? `<div class="ev">يقيس: ${e(it.measures)}</div>` : ''}</td><td class="n">${avgCell(it.total)}</td><td class="n">${lvCell(it.total)}</td><td class="n">${belowCell(it.total)}</td></tr>`;
    return `<table class="itm"><thead><tr><th>البند</th><th class="n">المتوسط</th><th class="n">المستوى</th><th class="n">دون حدّ الضعف</th></tr></thead><tbody>${items.map(crow).join('')}</tbody></table>`;
  }
  const head = '<tr><th>البند</th><th class="n">الفترة</th><th class="n">متوسط الشعبة</th><th class="n">المستوى</th><th class="n">دون حدّ الضعف</th><th class="n">الداخل في المجموع</th></tr>';
  const body = items.map(it => {
    const meas = it.measures ? `<div class="ev">يقيس: ${e(it.measures)}</div>` : '';
    if(it.periods.length >= 2){
      const n = it.periods.length, t = it.total;
      const cnt = `<td rowspan="${n}" class="n cnt"><b>${avgCell(t)}</b><div class="ev">${lvCell(t)}</div></td>`;
      return `<tbody class="grp">${it.periods.map((p, i) => `<tr>${i === 0 ? `<td rowspan="${n}" class="gn"><b>${e(it.name)}</b>${meas}</td>` : ''}<td class="n">${e(short(p.k))}</td><td class="n">${avgCell(p.stat)}</td><td class="n">${lvCell(p.stat)}</td><td class="n">${belowCell(p.stat)}</td>${i === 0 ? cnt : ''}</tr>`).join('')}</tbody>`;
    }
    const t = it.total;
    return `<tbody class="grp"><tr><td><b>${e(it.name)}</b>${meas}</td><td class="n">${it.lonePeriod ? e(short(it.lonePeriod)) : '—'}</td><td class="n">${avgCell(t)}</td><td class="n">${lvCell(t)}</td><td class="n">${belowCell(t)}</td><td class="n cnt"><b>${avgCell(t)}</b></td></tr></tbody>`;
  }).join('');
  return `<table class="itm"><thead>${head}</thead>${body}</table>`;
}

/* مستويات الطلاب + متوسط البنود: متجاورتان بنصف عرض إن ظهرتا معًا وكانت كل البنود بفترة واحدة (تتّسع الصفحة بصفحة واحدة)؛
   وإلا (بند متعدد الفترات، أو أحدهما مخفي) تبقى كل منهما بعرض كامل كما كانت */
function ssLevelsItemsHtml(ctx, show, counts, incN, total, rules){
  const showL = show.levels !== false, showI = show.items !== false && ctx.items.length > 0;
  const tL = ctx.itemName ? 'مستويات الطلاب في هذا البند' : 'مستويات الطلاب';
  const tI = ctx.itemName ? 'متوسط الشعبة في البند' : 'متوسط الشعبة في البنود';
  const compact = showL && showI && ctx.items.every(it => it.periods.length < 2);
  if(compact) return `<div class="pair"><div class="sec"><h2>${tL}</h2>${ssLevelsHtml(counts, incN, total, rules, true)}</div><div class="sec"><h2>${tI}</h2>${ssItemsHtml(ctx.items, rules, true)}</div></div>`;
  return (showL ? `<div class="sec"><h2>${tL}</h2>${ssLevelsHtml(counts, incN, total, rules)}</div>` : '')
    + (showI ? `<div class="sec long"><h2>${tI}</h2>${ssItemsHtml(ctx.items, rules)}</div>` : '');
}

function ssDiagHtml(dx){
  const e = escapeHtml;
  const sec = (title, d, extra) => {
    if(!d.enough) return `<div class="sec"><h2>${title}</h2><div class="box"><span class="nd">لا بيانات كافية للحكم (لا بند رُصد لـ${SS_MIN_STUDENTS} طلاب فأكثر).</span></div>${extra || ''}</div>`;
    const lines = [];
    d.strong.forEach(it => lines.push(`<div class="box s"><b>نقطة قوة:</b> ${e(ssLabel(it))} — ${srNum(it.total.top)} من ${srNum(it.total.n)} طالبًا (${srNum(Math.round(it.total.topShare) + '%')}) بمستوى «متقن».</div>`));
    d.weak.forEach(it => lines.push(`<div class="box p"><b>ضعف جماعي:</b> ${e(ssLabel(it))} — ${srNum(it.total.below)} من ${srNum(it.total.n)} طالبًا (${srNum(Math.round(it.total.belowShare) + '%')}) دون حدّ الضعف.</div>`));
    if(!lines.length) lines.push('<div class="box"><span class="nd">لا نقاط قوة ولا ضعف جماعية مثبتة.</span></div>');
    return `<div class="sec"><h2>${title}</h2>${lines.join('')}${extra || ''}</div>`;
  };
  const prog = dx.progress.map(p => {
    const t = p.trend === 'up' ? 'تحسّن' : p.trend === 'down' ? 'تراجع' : 'مستقر';
    const body = p.kind === 'tests' ? `من «${e(p.fromLabel)}» ${srNum(Math.round(p.from) + '%')} إلى «${e(p.toLabel)}» ${srNum(Math.round(p.to) + '%')}` : `${e(p.name)} من ${srNum(Math.round(p.from) + '%')} إلى ${srNum(Math.round(p.to) + '%')}`;
    return `<div class="box f"><b>التقدّم (${e(p.label)}):</b> متوسط الشعبة ${body} (${t})</div>`;
  }).join('');
  const recs = dx.recs.length ? `<div class="sec"><h2>التوصيات</h2>${dx.recs.map(r => `<div class="rc"><div><b>الدليل:</b> ${e(r.evidence)}</div><div><b>التشخيص:</b> ${e(r.diagnosis)}</div><div><b>الإجراء المقترح:</b> ${e(r.action)}</div></div>`).join('')}</div>` : '';
  return sec('التشخيص: ماذا يتقن الطلاب (التحصيل)', dx.tahsili) + sec('التشخيص: كيف يتعلّم الطلاب (الإنجاز والمشاركة والالتزام)', dx.taalumi, prog) + recs;
}

/* قائمة الطلاب (عند تشغيل الأسماء): من الأدنى نسبةً، قائمتان متجاورتان بجدول واحد (صف = سجلان) */
function ssRosterHtml(rows, rules){
  const e = escapeHtml;
  const rec = (rows || []).filter(r => r.points !== null && r.points !== undefined && !r.incomplete && r.pct !== null && r.pct !== undefined)
    .slice().sort((x, y) => x.pct - y.pct || String(x.name).localeCompare(String(y.name), 'ar'));
  if(!rec.length) return '';
  const half = Math.ceil(rec.length / 2);
  const cell = r => r ? `<td>${e(r.name)}</td><td class="n">${srNum(formatScore(r.points))}</td><td class="n">${srNum(Math.round(r.pct) + '%')}</td><td class="n">${srChip(srLevel(r.pct, rules))}</td>` : '<td></td><td></td><td></td><td></td>';
  const th = '<th>الطالب</th><th class="n">الدرجة</th><th class="n">النسبة</th><th class="n">المستوى</th>';
  const pairs = [];
  for(let i = 0; i < half; i++) pairs.push(`<tr>${cell(rec[i])}${cell(rec[i + half])}</tr>`);
  return `<div class="sec long"><h2>قائمة الطلاب (من الأدنى نسبةً)</h2><table class="rs2"><thead><tr>${th}${th}</tr></thead><tbody>${pairs.join('')}</tbody></table></div>`;
}

/* مقارنة بالفصل السابق: prev = { sum, names: Map } (من gradeChangeSummary). المقارنة بمجموع الفصلين (معياري زمنيًا) */
const SS_PREV_MIN = 5; /* أقل عدد طلاب مقارَنين لعرض المقارنة بالفصل السابق (ق13) */
function ssCompareHtml(prev, withNames){
  if(!prev || !prev.sum || prev.sum.compared < SS_PREV_MIN) return '';
  const e = escapeHtml, sum = prev.sum;
  const stable = sum.compared - sum.up.length - sum.down.length;
  const kp = [[sum.up.length, 'تحسّنوا'], [stable, 'مستقرون'], [sum.down.length, 'تراجعوا'], [srNum(sum.avgPrev + '% ← ' + sum.avgNow + '%'), 'متوسط الشعبة: السابق ← الحالي']]
    .map(([v, l]) => `<div><b>${typeof v === 'string' ? v : srNum(v)}</b><span>${l}</span></div>`).join('');
  let names = '';
  if(withNames){
    const tbl = (t, list) => list.length ? `<div><table><thead><tr><th>${t}</th><th class="n">من ← إلى</th><th class="n">التغيّر</th></tr></thead><tbody>${list.map(r =>
      `<tr><td>${e(prev.names.get(r.id) || '')}</td><td class="n">${srNum(Math.round(r.prev) + '% ← ' + Math.round(r.now) + '%')}</td><td class="n">${srNum((r.delta > 0 ? '+' : '') + r.delta)}</td></tr>`).join('')}</tbody></table></div>` : '';
    names = `<div class="cmpw">${tbl('الأكثر تراجعًا', sum.down.slice(0, 8))}${tbl('الأكثر تحسنًا', sum.up.slice(0, 8))}</div>`;
  }
  return `<div class="sec"><h2>مقارنة بالفصل السابق</h2><div class="fn">مقارنة بمجموع النسبة لكل فصل؛ المحتوى يختلف بين الفصلين.</div><div class="kp">${kp}</div>${names}<div class="fn">قورن ${srNum(sum.compared)} طالبًا ممن لهم درجات في الفصلين؛ التغيّر المعتبر ${srNum(GRADE_COMPARE_RULES.changePct)} نقاط مئوية فأكثر.</div></div>`;
}

/* الرصد غير المكتمل (البند 5): العدد، «ما ينقص» مجمَّعًا بالبند، وعند الأسماء جدول بالدرجة المرصودة والناقص.
   لا سطر «أكمل الدرجات»: موجَّه للمعلم لا للقارئ (قرار المستخدم) */
function ssIncompleteHtml(inc, withNames, itemMode){
  if(!inc || !inc.length) return '';
  const e = escapeHtml;
  const cnt = c => c === 1 ? 'طالب واحد' : c === 2 ? 'طالبان' : c <= 10 ? `${srNum(c)} طلاب` : `${srNum(c)} طالبًا`;
  const byItem = new Map();
  inc.forEach(r => (r.missing || []).forEach(n => byItem.set(n, (byItem.get(n) || 0) + 1)));
  const lack = [...byItem.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${e(n)}: ${cnt(c)}`);
  let html = itemMode
    ? `<div class="box f">${srNum(inc.length)} ${inc.length === 1 ? 'طالب بلا درجة في هذا البند' : 'طلاب بلا درجة في هذا البند'}، فلا يُصنَّفون ولا يدخلون في المتوسط.</div>`
    : `<div class="box f">${srNum(inc.length)} ${inc.length === 1 ? 'طالب لم تكتمل درجاته' : 'طلاب لم تكتمل درجاتهم'}، فلا يُصنَّفون ولا يدخلون في المتوسط.</div>`;
  if(lack.length && !itemMode) html += `<div class="box"><b>ما ينقص:</b> ${lack.join(' · ')}.</div>`;
  if(withNames){
    const row = r => `<tr><td>${e(r.name)}</td><td class="n">${r.points === null || r.points === undefined ? 'بلا أي درجة' : `${srNum(formatScore(r.points))} من ${srNum(formatScore(r.recordedMax))}`}</td><td>${(r.missing || []).map(e).join('، ') || '—'}</td></tr>`;
    html += itemMode
      ? `<table><thead><tr><th>الطالب</th></tr></thead><tbody>${inc.map(r => `<tr><td>${e(r.name)}</td></tr>`).join('')}</tbody></table>`
      : `<table><thead><tr><th>الطالب</th><th class="n">الدرجة المرصودة</th><th>الناقص</th></tr></thead><tbody>${inc.map(row).join('')}</tbody></table>`;
  }
  return `<div class="sec"><h2>الرصد غير المكتمل</h2>${html}</div>`;
}

/* ctx: { label, term, date, prefs, logo, schoolLogo, rules, rows, stats, max, items, dx, withNames, prev } */
function buildSectionReportHtml(ctx){
  const e = escapeHtml;
  const prefs = ctx.prefs || {};
  const show = prefs.show || { levels: true, items: true };
  const school = gradeReportSchool(prefs), subject = gradeReportSubject(prefs), teacher = gradeReportTeacherName(prefs);
  const sem = Number(ctx.term.semester) === 2 ? 'الثاني' : 'الأول';
  const logo = ctx.logo && GRADE_REPORT_DATA_RE.test(ctx.logo) ? `<img src="${ctx.logo}" alt="">` : '';
  const slogo = ctx.schoolLogo && GRADE_REPORT_DATA_RE.test(ctx.schoolLogo) ? `<img src="${ctx.schoolLogo}" alt="">` : '';
  const s = ctx.stats, rules = ctx.rules;
  const counts = ssLevelCounts(ctx.rows, rules);
  const meta = (k, v) => `<div><small>${k}</small><b>${e(v || '—')}</b></div>`;
  const share = n => counts.recorded ? ` (${srNum(Math.round(100 * n / counts.recorded) + '%')})` : '';
  const kp = [
    `<div><b>${s.avg === null ? '—' : srScore(s.avg, ctx.max)}</b><span>متوسط الشعبة</span></div>`,
    `<div><b>${s.avgPct === null ? '—' : srNum(s.avgPct + '%')}</b><span>النسبة المئوية</span></div>`,
    `<div><b>${srNum(counts.low)}</b><span>يحتاجون تحسين${share(counts.low)}</span></div>`,
    `<div><b>${srNum(counts.top)}</b><span>متقنون${share(counts.top)}</span></div>`
  ].join('');
  const head = `<div class="hd"><div class="mo">${logo}</div><div class="tt"><div class="sch">${school ? e(school) : 'اسم المدرسة'}</div><h1>تقرير أداء الشعبة</h1></div><div class="sl">${slogo}</div></div>`;
  const itemMeta = ctx.itemName ? meta('البند (تقرير بند واحد)', `${ctx.itemName} — من ${formatScore(ctx.max)}`) : '';
  const metaHtml = `<div class="mt">${meta('الصف والشعبة', ctx.label)}${meta('الفصل الدراسي', `${sem} ${ctx.term.year}`)}${meta('المادة', subject)}${meta('المعلم', teacher)}${itemMeta}${meta('عدد الطلاب', String(s.total))}${meta('التاريخ', ctx.date)}</div>`;
  const inc = s.incomplete || [];
  const incHtml = ssIncompleteHtml(inc, ctx.withNames, !!ctx.itemName);
  const sign = `<div class="sgn"><div><small>${e(teacher)}</small>معلم المادة</div><div><small>${e(prefs.vice || '')}</small>وكيل شؤون الطلاب</div></div>`;
  return `<style>${SR_CSS}${SS_CSS}</style><div class="sr">${head}${metaHtml}<div class="kp">${kp}</div>
    ${ssLevelsItemsHtml(ctx, show, counts, inc.length, s.total, rules)}
    ${ctx.noDx ? '' : ssDiagHtml(ctx.dx)}${ssCompareHtml(ctx.prev, ctx.withNames)}${ctx.withNames ? ssRosterHtml(ctx.rows, rules) : ''}<div class="fin">${incHtml}${sign}</div><div class="strip"></div></div>`;
}

/* من نافذة التحليل (تقرير المجموع): كل البيانات من كشف الشعبة المحمَّل a.g، بلا استعلام جديد */
async function ssBuildFromAnalysis(a, v, prefs, ctx){
  const g = a.g, term = { year: g.year, semester: g.semester };
  const rules = srRulesNow();
  const col = a.key === 'total' ? null : g.columns.find(c => c.id === a.key);
  let items = ssBuildItems(g.columns, g.scores, a.students.map(s => s.id), g.breakdown || null, c => periodCfg(term, periodCompKeyOfColumn(c)), rules, srToolTypeOf);
  if(col) items = items.filter(it => it.id === col.id); /* تقرير بند واحد (ق11) */
  const groups = typeof tlGroupsOf === 'function' ? tlGroupsOf(typeof appFeatures !== 'undefined' ? appFeatures : null, term) : [];
  const dx = ssDiagnose(items, rules, groups);
  await srEnsureFonts();
  return buildSectionReportHtml({ label: a.label, term, date: ctx.date, prefs, logo: ctx.logo, schoolLogo: ctx.schoolLogo, rules, rows: v.rows, stats: v.stats, max: v.displayMax, items, dx, withNames: !!ctx.withNames, prev: ctx.prev, noDx: !!ctx.noDx, itemName: col ? col.name : null });
}
