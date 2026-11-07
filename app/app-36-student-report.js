/* ============================================================
   تقرير الطالب الفردي — نسختان بهوية وزارة التعليم (انظر REPORTS.md §4.0)
   ------------------------------------------------------------
   - «الدرجات»: أرقام ومستويات (متقن · جيد · يحتاج تحسين) فقط.
   - «التحليلي»: كل ما يخص الطالب (حضور، مخالفات، متابعات، حالات أكاديمية، مهام، إيجابيات) + تشخيص
     على مستويين (تحصيلي · تعلّمي) + توصيات. كل قسم يظهر فقط إن وُجدت بياناته، بلا اختصار ولا حدّ للصفحات.
   - لا حكم دون دليل، ولا توصية دون تشخيص، ولا يُنسب للمعلم إجراء غير مسجَّل. ما لم يُرصد لا يُحسب.
   - ملاحظات المعلم الخاصة لا تدخل التقرير أبدًا.
   - الاستعلامات كلها بفلترة teacher_id صريحة، وكل نص من المستخدم/القاعدة يمرّ عبر escapeHtml.
   - الطباعة عبر gradeReportRun/gradeReportPrint (app-34): نص حقيقي، ترويسة/تذييل @page.
   ============================================================ */

const SR_MIN_TAHSILI = 2;       /* بنود تحصيلية مرصودة على الأقل للحكم على التحصيل */
const SR_MIN_HOMEWORK = 3;      /* واجبات محسوبة على الأقل للحكم على الإنجاز */
const SR_MIN_LESSONS = 3;       /* حصص منعقدة للشعبة على الأقل للحكم على المشاركة والالتزام */
const SR_MIN_OVERALL = 2;       /* بنود مرصودة على الأقل للحكم على المستوى العام */
const SR_PROGRESS_DELTA = 10;   /* نقاط مئوية فأكثر ليُسمّى تحسّنًا أو تراجعًا */
const SR_SEVERE_DEFAULT = 30;
const SR_NEAR_CLASS = 10;       /* فارق عن متوسط الشعبة */
const SR_DOMAIN_LABELS = { tahsili: 'تحصيلي', taalumi: 'تعلّمي' };
const SR_STAGE_LABELS = { warning_1: 'إنذار أول', warning_2: 'إنذار ثانٍ', referred: 'تحويل' };
const SR_ACASE_LABELS = { plan_active: 'خطة علاجية جارية', referred: 'محال للموجه' };
const SR_FOLLOWUP_OUTCOMES = { improved: 'تحسّن', partial: 'تحسّن جزئي', not_improved: 'لم يتحسّن' };
const SR_TO_LABELS = { guardian: 'ولي الأمر', counselor: 'الموجه الطلابي', vice: 'وكيل شؤون الطلاب', staff: 'وكيل شؤون المعلمين' };

/* ============ دوال صرفة: المستوى والتصنيف ============ */

function srLevel(pct, rules){
  if(pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  const r = rules || { pass: 50, top: 90 };
  return pct < r.pass ? { key: 'w', label: 'يحتاج تحسين' } : pct >= r.top ? { key: 'm', label: 'متقن' } : { key: 'j', label: 'جيد' };
}

function srPct(score, max){
  return score === null || score === undefined || !(Number(max) > 0) ? null : 100 * Number(score) / Number(max);
}

const srRound = n => Math.round(n);

/* عتبة التعثر الشديد: إعداد المعلم (app-31) وإلا 30%؛ لا تزيد عن حدّ الضعف */
function srSevereOf(rules){
  const v = Number(rules && rules.severe);
  const s = Number.isFinite(v) && v > 0 ? v : SR_SEVERE_DEFAULT;
  return rules && Number(rules.pass) ? Math.min(s, Number(rules.pass)) : s;
}

/* تصنيف المكوّن تلقائيًا بنوعه: tahsili | taalumi | null (غير مصنَّف فلا يُحكم عليه).
   toolTypeOf(toolId) = 'counter' | 'status' | 'score' | null */
function srDomainOf(c, toolTypeOf){
  if(!c) return null;
  if(c.category === 'tests') return 'tahsili';
  if(c.tool_id){
    const t = toolTypeOf ? toolTypeOf(c.tool_id) : null;
    return t === 'score' ? 'tahsili' : (t === 'status' || t === 'counter') ? 'taalumi' : null;
  }
  if(c.kind === 'task') return 'tahsili';
  if(c.kind === 'homework' || c.kind === 'participation') return 'taalumi';
  return null;
}

/* ============ دوال صرفة: صفوف البنود (والفترات) ============
   items: [{ id, name, max, score, kind, tool_id, category }]
   breakdown: Map(columnId → Map(studentId → {p1,p2,p3})) أو null
   cfgOf(item) → إعداد الفترات { n, starts, ended? } ؛ classPctOf(id) → متوسط الشعبة % أو null
   الناتج: { rows, missing } — البند غير المرصود للطالب لا يظهر في الجدول، وmissing للفحص فقط: لا يُعرض ولا يُسمّى بالتقرير (م9) */
function srBuildRows(items, studentId, breakdown, cfgOf, classPctOf, toolTypeOf){
  const rows = [], missing = [];
  (items || []).forEach(x => {
    if(x.score === null || x.score === undefined){ missing.push(x.name); return; }
    const domain = srDomainOf(x, toolTypeOf);
    const base = { id: x.id, name: x.name, max: Number(x.max), domain, category: x.category, kind: x.kind || 'manual', tool_id: x.tool_id || null, measures: x.measures || null };
    const cfg = x.category === 'performance' && cfgOf ? cfgOf(x) : null;
    const bd = cfg && cfg.n > 1 && breakdown && breakdown.get(x.id) ? breakdown.get(x.id).get(studentId) : null;
    const periodRows = [];
    if(bd){
      const counted = countedPeriodsOf(cfg);
      for(let k = 1; k <= cfg.n; k++){
        const sc = bd['p' + k];
        if(sc === null || sc === undefined) continue;
        if(counted !== null && k > counted) continue; /* فترة لم تبدأ/لم تنتهِ: لا أثر لها فلا تُعرض ولا يُشار إليها (م9) */
        periodRows.push(Object.assign({}, base, { row: 'period', period: k, label: `${x.name} — ${PERIOD_NAMES[k]}`, score: Number(sc), pct: srPct(sc, x.max), classPct: null }));
      }
    }
    const classPct = classPctOf ? classPctOf(x.id) : null;
    if(periodRows.length >= 2){
      periodRows.forEach(r => rows.push(r));
      rows.push(Object.assign({}, base, { row: 'sub', label: `${x.name} — المحسوب في المجموع`, score: Number(x.score), pct: srPct(x.score, x.max), classPct }));
    } else if(periodRows.length === 1){
      /* فترة واحدة معدودة: صف واحد باسم الفترة، بلا صف مجموع مكرَّر */
      rows.push(Object.assign({}, base, { row: 'item', label: periodRows[0].label, score: Number(x.score), pct: srPct(x.score, x.max), classPct }));
    } else {
      rows.push(Object.assign({}, base, { row: 'item', label: x.name, score: Number(x.score), pct: srPct(x.score, x.max), classPct }));
    }
  });
  return { rows, missing };
}

/* صفوف المكوّن الواحد (بند أو مجموعه): نستعملها في التشخيص بدل صفوف الفترات */
const srComponentRows = rows => (rows || []).filter(r => r.row === 'item' || r.row === 'sub');

/* ============ دوال صرفة: السلاسل القابلة للمقارنة والتقدّم ============
   م2 (قابلية المقارنة): لا يُقارَن إلا ما قاس الشيء نفسه:
   - فترات المكوّن نفسه (المنتهية).
   - اختبارات رُبطت أو تطابق «يقيس» فيها (app-37، ق4). الاختبارات بلا علاقة لا تُقارَن (ق3).
   سلسلة = { name, kind: 'periods'|'tests', label (سبب المقارنة)، domain, points: [{ label, pct }] } بترتيب الكشف/الفترات */
function srSeries(rows, groups){
  const series = [];
  const byComp = new Map();
  (rows || []).filter(r => r.row === 'period').forEach(r => {
    if(!byComp.has(r.id)) byComp.set(r.id, []);
    byComp.get(r.id).push(r);
  });
  byComp.forEach(list => {
    if(list.length < 2) return;
    series.push({ name: list[0].name, kind: 'periods', label: list.length === 2 ? 'بين فترتين منتهيتين' : 'بين فترات منتهية', domain: list[0].domain,
      points: list.map(r => ({ label: r.label, pct: srPct(r.score, r.max) })) });
  });
  if(typeof tlComparableClasses === 'function'){
    const tests = srComponentRows(rows).filter(r => r.category === 'tests').map(r => ({ name: r.name, measures: r.measures, row: r }));
    tlComparableClasses(tests, groups).forEach(cl => {
      series.push({ name: cl.members.map(m => m.name).join('، '), kind: 'tests', label: cl.label, domain: 'tahsili',
        points: cl.members.map(m => ({ label: m.name, pct: srPct(m.row.score, m.row.max) })) });
    });
  }
  return series.filter(x => x.points.every(p => p.pct !== null));
}

function srProgress(rows, groups){
  return srSeries(rows, groups).filter(x => x.points.length >= 2).map(x => {
    const a = x.points[0], b = x.points[x.points.length - 1];
    const d = b.pct - a.pct;
    return { name: x.name, kind: x.kind, label: x.label, domain: x.domain, from: a.pct, to: b.pct, fromLabel: a.label, toLabel: b.label, delta: d,
      trend: d >= SR_PROGRESS_DELTA ? 'up' : d <= -SR_PROGRESS_DELTA ? 'down' : 'flat' };
  });
}

/* ============ دوال صرفة: التشخيص (سلّم الأدلة) ============
   m = { rows, rules, homework: {total, submitted, partial, late, missing} | null, lessonsHeld, overall: { pct, incomplete } }
   الأحكام ثلاثة مختلفة: نتيجة منخفضة (واقعة) ← ضعف مثبت في مجال ← ضعف مستمر. التوصية لا تُبنى إلا على الأخيرين. */
function srDiagnose(m){
  const rules = m.rules || { pass: 50, top: 90 };
  const comps = srComponentRows(m.rows).filter(r => r.domain);
  const lvl = r => srLevel(r.pct, rules);
  const nearClass = r => r.classPct !== null && r.classPct !== undefined && r.pct !== null;

  /* ---- التحصيلي ---- */
  const tRows = comps.filter(r => r.domain === 'tahsili');
  const tah = { enough: tRows.length >= SR_MIN_TAHSILI, recorded: tRows.length, strengths: [], facts: [], weak: null, persistent: false, severe: false, avg: null };
  if(tRows.length) tah.avg = tRows.reduce((a, r) => a + r.pct, 0) / tRows.length;
  if(tah.enough){
    tRows.forEach(r => {
      const l = lvl(r);
      if(l.key === 'm') tah.strengths.push({ text: `${r.name} ${srRound(r.pct)}% (متقن)` });
      else if(nearClass(r) && r.pct - r.classPct >= SR_NEAR_CLASS && l.key !== 'w') tah.strengths.push({ text: `${r.name} ${srRound(r.pct)}% — أعلى من متوسط الشعبة (${srRound(r.classPct)}%)`, classOnly: true });
      if(l.key === 'w') tah.facts.push({ text: `${r.name} ${srRound(r.pct)}% — دون حدّ الضعف (${rules.pass}%)` });
      else if(nearClass(r) && r.classPct - r.pct >= SR_NEAR_CLASS) tah.facts.push({ text: `${r.name} ${srRound(r.pct)}% — دون متوسط الشعبة (${srRound(r.classPct)}%)`, classOnly: true });
    });
    const lows = tRows.filter(r => lvl(r).key === 'w');
    if(lows.length >= 2 && lows.length * 2 >= tRows.length){
      tah.weak = { names: lows.map(r => `${r.name} ${srRound(r.pct)}%`) };
    }
    /* ضعف مستمر: قياسان متتاليان دون حدّ الضعف داخل سلسلة قابلة للمقارنة فقط (م2) */
    srSeries(m.rows, m.testGroups).filter(x => x.domain === 'tahsili').forEach(sr => {
      for(let i = 0; i + 1 < sr.points.length && !tah.persistent; i++){
        const p = sr.points[i], q = sr.points[i + 1];
        if(lvl({ pct: p.pct }).key === 'w' && lvl({ pct: q.pct }).key === 'w'){
          tah.persistent = true;
          tah.persistentInfo = { text: `«${p.label}» ${srRound(p.pct)}% ثم «${q.label}» ${srRound(q.pct)}%`, label: sr.label };
        }
      }
    });
    tah.severe = tah.persistent && tah.avg !== null && tah.avg < srSevereOf(rules);
  }

  /* ---- التعلّمي: مؤشر لكل مكوّن ---- */
  const hw = m.homework || null;
  const lessonsOk = Number(m.lessonsHeld) >= SR_MIN_LESSONS;
  const indicators = [];
  comps.filter(r => r.domain === 'taalumi').forEach(r => {
    const l = lvl(r);
    const isHw = r.kind === 'homework';
    const ind = { name: r.name, pct: r.pct, kind: isHw ? 'homework' : r.kind === 'participation' ? 'participation' : 'tool', status: 'ok', text: '' };
    const enough = isHw ? !!hw && hw.total >= SR_MIN_HOMEWORK : lessonsOk;
    if(!enough){
      ind.status = 'nodata';
      ind.text = isHw ? `${r.name}: لا بيانات كافية للحكم (أقل من ${SR_MIN_HOMEWORK} واجبات محسوبة)` : `${r.name}: لا بيانات كافية للحكم (أقل من ${SR_MIN_LESSONS} حصص منعقدة)`;
    } else if(l.key === 'm'){
      ind.status = 'strength';
      ind.text = isHw ? `${r.name} ${srRound(r.pct)}% — سلّم ${hw.submitted} من ${hw.total} واجبات` : `${r.name} ${srRound(r.pct)}% (متقن)`;
    } else if(l.key === 'w'){
      ind.status = 'weak';
      if(isHw){
        const extra = [hw.partial ? `سلّم ${hw.partial} ناقصًا` : '', hw.late ? `${hw.late} متأخرًا` : ''].filter(Boolean).join('، ');
        ind.text = `${r.name} — لم يسلّم ${hw.missing} من ${hw.total} واجبات${extra ? '، و' + extra : ''} (${srRound(r.pct)}%)`;
        ind.evidence = `لم يسلّم ${hw.missing} من ${hw.total} واجبات (${r.name} ${srRound(r.pct)}%)`;
        ind.diagnosis = 'ضعف في انتظام إنجاز الواجبات';
        ind.action = 'متابعة تسليم الواجبات أسبوعيًا مع تذكير مبكر بموعد التسليم';
      } else if(r.kind === 'participation'){
        ind.text = `${r.name} ${srRound(r.pct)}% — دون حدّ الضعف (${rules.pass}%)`;
        ind.evidence = `${r.name} ${srRound(r.score)} من ${srRound(r.max)} (${srRound(r.pct)}%)`;
        ind.diagnosis = 'ضعف في المشاركة الصفية';
        ind.action = 'إتاحة فرص مشاركة قصيرة ومنتظمة داخل الحصة وتشجيعه عليها';
      } else {
        ind.text = `${r.name} ${srRound(r.pct)}% — دون حدّ الضعف (${rules.pass}%)`;
        ind.evidence = `${r.name} ${srRound(r.score)} من ${srRound(r.max)} (${srRound(r.pct)}%)`;
        ind.diagnosis = `ضعف في ${r.name}`;
        ind.action = `متابعة «${r.name}» مع تذكير مبكر وتعزيز عند الالتزام`;
      }
    } else {
      ind.text = `${r.name} ${srRound(r.pct)}%`;
    }
    indicators.push(ind);
  });
  const taal = { indicators, weak: indicators.filter(i => i.status === 'weak'), strengths: indicators.filter(i => i.status === 'strength') };

  /* ---- التقدّم ---- */
  const progress = srProgress(m.rows, m.testGroups);

  /* ---- التوصيات: الدليل ← التشخيص ← الإجراء؛ تُحذف إن تعذّر بناء أحدها ---- */
  const recs = [];
  if(tah.weak){
    recs.push({ evidence: tah.weak.names.join('، '), diagnosis: 'ضعف تحصيلي في البنود المذكورة', action: 'مراجعة المهارات التي فقد فيها الدرجات وتكليفه بتدريبات قصيرة عليها، ثم إعادة تقييمها' });
  }
  if(tah.persistent && !tah.weak){
    recs.push({ evidence: `${tah.persistentInfo.text} — دون حدّ الضعف في قياسين متتاليين (${tah.persistentInfo.label})`, diagnosis: 'ضعف تحصيلي مستمر', action: 'خطة علاجية قصيرة بمتابعة أسبوعية' });
  }
  taal.weak.forEach(i => recs.push({ evidence: i.evidence, diagnosis: i.diagnosis, action: i.action }));
  /* التواصل مع ولي الأمر: أحد ثلاثة شروط */
  const overall = m.overall || {};
  const overallJudged = overall.pct !== null && overall.pct !== undefined && !overall.incomplete && srComponentRows(m.rows).length >= SR_MIN_OVERALL;
  let parent = null;
  if(tah.weak && taal.weak.length) parent = 'ضعف مثبت في التحصيل وفي التعلّم معًا';
  else if(overallJudged && lvl({ pct: overall.pct }).key === 'w') parent = `المستوى العام ${srRound(overall.pct)}% (يحتاج تحسين) ببيانات كافية`;
  else if(tah.severe) parent = `ضعف تحصيلي مستمر شديد (متوسط البنود التحصيلية ${srRound(tah.avg)}%)`;
  if(parent) recs.push({ evidence: parent, diagnosis: 'يستدعي تدخلًا بالتعاون مع ولي الأمر', action: 'التواصل مع ولي الأمر ووضع خطة علاجية بمتابعة أسبوعية', parent: true });
  const valid = recs.filter(r => r.evidence && r.diagnosis && r.action);

  return { tahsili: tah, taalumi: taal, progress, recommendations: valid, overallJudged, parentContact: !!parent };
}

/* ============ دوال صرفة: الحضور ============
   att: [{ status, lesson: { lesson_date, period, section_id } | null }] — يُخزَّن الاستثناء فقط (غائب · متأخر · مستأذن)،
   وغيابُ السجل = حاضر؛ فالحاضر = الحصص المرصودة لشعبته الحالية − استثناءاته فيها (كما في ملف الطالب).
   استثناءات شعبة سابقة تُعرض بقائمتها وتُعدّ في prev ولا تُطرح من حصص شعبته الحالية. */
function srAttendanceSummary(att, currentSectionId, recorded){
  const counts = { present: null, absent: 0, late: 0, permitted_exit: 0 };
  const prev = { absent: 0, late: 0, permitted_exit: 0 };
  const list = [];
  (att || []).forEach(a => {
    if(a.status !== 'absent' && a.status !== 'late' && a.status !== 'permitted_exit') return;
    const isPrev = !!(currentSectionId && a.lesson && a.lesson.section_id && a.lesson.section_id !== currentSectionId);
    (isPrev ? prev : counts)[a.status]++;
    list.push({ status: a.status, date: a.lesson ? a.lesson.lesson_date : '', period: a.lesson ? a.lesson.period : null, prevSection: isPrev });
  });
  const n = Number(recorded) || 0;
  if(n > 0) counts.present = Math.max(0, n - counts.absent - counts.late - counts.permitted_exit);
  list.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  return { counts, prev, list };
}

/* ============ HTML ============ */
const SR_CSS = `
.sr,.sr *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sr{font-family:'Helvetica Neue W23 for SKY','Cairo',sans-serif;color:#15445a;direction:rtl;background:#fff;font-size:11px;line-height:1.65}
.sr *{box-sizing:border-box}
.sr .hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:6px;margin-bottom:8px;position:relative}
.sr .hd:after{content:'';position:absolute;right:0;left:0;bottom:0;height:3px;border-radius:2px;background:linear-gradient(90deg,#3B83B7,#4CB176)}
.sr .hd .mo{width:22mm;flex:none}.sr .hd .mo img{width:22mm;display:block}
.sr .hd .tt{flex:1;text-align:center;min-width:0}.sr .hd .sch{font-size:11px;color:#51636d}
.sr .hd h1{margin:2px 0 0;font-size:20px;font-weight:700;color:#15445a;line-height:1.4}
.sr .hd .sl{width:17mm;height:17mm;flex:none;display:flex;align-items:center;justify-content:center}.sr .hd .sl img{max-width:17mm;max-height:17mm}
.sr .mt{display:flex;flex-wrap:wrap;border:1px solid #c2c1c1;border-radius:6px;margin-bottom:8px}
.sr .mt div{flex:1 1 33%;padding:3px 8px;border-left:1px solid #c2c1c1}.sr .mt small{display:block;color:#6b7c86;font-size:9px}
.sr .kp{display:flex;gap:7px;margin-bottom:8px}.sr .kp>div{flex:1;border:1.5px solid #dfe6ea;border-radius:9px;text-align:center;padding:3px}
.sr .kp b{display:block;font-size:19px;line-height:1.4}.sr .kp span{font-size:10px;color:#51636d}.sr .kp .chip{color:#fff;font-size:13px;padding:1px 14px}
.sr h2{display:flex;align-items:center;gap:7px;font-size:12.5px;margin:10px 0 4px;font-weight:700;break-after:avoid}
.sr h2:before{content:'';width:4px;height:15px;border-radius:2px;background:linear-gradient(180deg,#3B83B7,#4CB176)}
.sr .sec{break-inside:avoid}.sr .sec.long{break-inside:auto}
.sr table{width:100%;border-collapse:collapse;font-size:10.5px}
.sr thead{display:table-header-group}.sr tr{break-inside:avoid}
.sr th{background:#15445a;color:#fff;padding:3px 7px;text-align:right;font-weight:700}
.sr td{padding:3px 7px;border-bottom:1px solid #e3e9ec;vertical-align:top}.sr tr:nth-child(even) td{background:#f3f6f8}
.sr .n{text-align:center}.sr table.two td:nth-child(3){border-left:2px solid #c2c1c1}.sr table.two th:nth-child(3){border-left:2px solid #fff}.sr tr.sub td{font-weight:700;background:#eaf1f5}
.sr .chip{display:inline-block;border-radius:9px;padding:0 9px;font-size:10px;color:#fff;font-weight:700;line-height:1.7}
.sr .m{background:#07a869}.sr .j{background:#3d7eb9}.sr .w{background:#7258a4}
.sr .bar{height:8px;background:#e8eef1;border-radius:4px;min-width:80px}.sr .bar i{display:block;height:100%;border-radius:4px}
.sr .box{border:1px solid #c2c1c1;border-radius:7px;padding:4px 9px;margin-bottom:4px;break-inside:avoid}
.sr .box.s{border-right:4px solid #07a869}.sr .box.p{border-right:4px solid #7258a4}.sr .box.f{border-right:4px solid #3d7eb9}
.sr .nd{color:#6b7c86}.sr .ev{font-size:9.5px;color:#51636d}
.sr .rc{border:1px solid #c2c1c1;border-radius:7px;margin-bottom:5px;break-inside:avoid}
.sr .rc div{padding:2px 9px;border-bottom:1px dashed #e3e9ec}.sr .rc div:last-child{border:0}.sr .rc b{color:#3d7eb9}
.sr .lines div{border-bottom:1px solid #c2c1c1;height:20px}
.sr .sgn{display:flex;gap:16px;margin-top:12px;text-align:center;break-inside:avoid}.sr .sgn div{flex:1;border-top:1px solid #15445a;padding-top:3px;font-size:10.5px}
.sr .sgn small{display:block;color:#51636d;min-height:14px;font-size:10px}
.sr .fn{font-size:9px;color:#6b7c86;margin-top:4px}
.sr .strip{height:5px;background:linear-gradient(90deg,#3B83B7,#4CB176);margin-top:10px;border-radius:3px}
`;

const srNum = v => `<bdi dir="ltr">${v}</bdi>`;
const srScore = (s, max) => srNum(`${formatScore(s)} / ${formatScore(max)}`);
const srChip = (lv, extra) => lv ? `<span class="chip ${lv.key}"${extra || ''}>${lv.label}</span>` : '';

function srItemsTableHtml(rows, rules, analytic){
  const e = escapeHtml;
  const head = analytic
    ? '<tr><th>البند</th><th class="n">الدرجة</th><th class="n">المستوى</th><th class="n">متوسط الشعبة</th><th class="n">المجال</th></tr>'
    : '<tr><th>البند</th><th class="n">الدرجة</th><th class="n">النسبة</th><th class="n">المستوى</th><th style="width:28%"></th></tr>';
  /* صف المكوّن الكلي (row: 'sub') بيانات داخلية للتشخيص ولا يُرسم (ق6) */
  const body = rows.filter(r => r.row !== 'sub').map(r => {
    const lv = srLevel(r.pct, rules);
    const cls = r.row === 'sub' ? ' class="sub"' : '';
    const levelCell = srChip(lv);
    if(analytic){
      const meas = r.measures && r.row !== 'period' ? `<div class="ev">يقيس: ${e(r.measures)}</div>` : '';
      return `<tr${cls}><td>${e(r.label)}${meas}</td><td class="n">${srScore(r.score, r.max)}</td><td class="n">${levelCell}</td><td class="n">${r.classPct === null || r.classPct === undefined ? '—' : srNum(srRound(r.classPct) + '%')}</td><td class="n">${r.domain ? SR_DOMAIN_LABELS[r.domain] : '—'}</td></tr>`;
    }
    const bar = !lv ? '' : `<div class="bar"><i class="${lv.key}" style="width:${Math.max(0, Math.min(100, r.pct))}%"></i></div>`;
    return `<tr${cls}><td>${e(r.label)}</td><td class="n">${srScore(r.score, r.max)}</td><td class="n">${srNum(srRound(r.pct) + '%')}</td><td class="n">${levelCell}</td><td>${bar}</td></tr>`;
  }).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function srBoxes(items, cls){ return items.map(t => `<div class="box ${cls}">${t}</div>`).join(''); }

function srDiagnosisHtml(dx, showClass){
  const e = escapeHtml;
  const tah = dx.tahsili;
  let tahHtml;
  if(!tah.recorded) tahHtml = '';
  else if(!tah.enough) tahHtml = `<div class="box"><span class="nd">لا بيانات كافية للحكم على التحصيل (أقل من ${SR_MIN_TAHSILI} بنود تحصيلية مرصودة).</span></div>`;
  else {
    const keep = x => showClass || !x.classOnly;
    const parts = [];
    tah.strengths.filter(keep).forEach(x => parts.push(`<div class="box s"><b>نقطة قوة:</b> ${e(x.text)}</div>`));
    if(tah.weak) parts.push(`<div class="box p"><b>ضعف مثبت:</b> ${e(tah.weak.names.join('، '))}</div>`);
    if(tah.persistent) parts.push(`<div class="box p"><b>ضعف مستمر (${e(tah.persistentInfo.label)}):</b> ${e(tah.persistentInfo.text)} — دون حدّ الضعف.</div>`);
    tah.facts.filter(keep).forEach(x => parts.push(`<div class="box f"><b>نتيجة منخفضة (واقعة لا حكم):</b> ${e(x.text)}</div>`));
    if(!parts.length) parts.push('<div class="box"><span class="nd">لا نقاط قوة ولا ضعف مثبتة في التحصيل.</span></div>');
    tahHtml = parts.join('');
  }
  const taal = dx.taalumi;
  const lines = [];
  taal.indicators.forEach(i => {
    if(i.status === 'strength') lines.push(`<div class="box s"><b>نقطة قوة:</b> ${e(i.text)}</div>`);
    else if(i.status === 'weak') lines.push(`<div class="box p"><b>ضعف مثبت:</b> ${e(i.text)}</div>`);
    else if(i.status === 'nodata') lines.push(`<div class="box"><span class="nd">${e(i.text)}</span></div>`);
  });
  dx.progress.forEach(p => {
    const t = p.trend === 'up' ? 'تحسّن' : p.trend === 'down' ? 'تراجع' : 'مستقر';
    const body = p.kind === 'tests'
      ? `من «${e(p.fromLabel)}» ${srNum(srRound(p.from) + '%')} إلى «${e(p.toLabel)}» ${srNum(srRound(p.to) + '%')}`
      : `${e(p.name)} من ${srNum(srRound(p.from) + '%')} إلى ${srNum(srRound(p.to) + '%')}`;
    lines.push(`<div class="box f"><b>التقدّم (${e(p.label)}):</b> ${body} (${t})</div>`);
  });
  const tahSection = tahHtml ? `<div class="sec"><h2>التشخيص: ماذا يتقن الطالب (التحصيل)</h2>${tahHtml}</div>` : '';
  const taalSection = lines.length ? `<div class="sec"><h2>التشخيص: كيف يتعلّم الطالب (الإنجاز والمشاركة والالتزام والتقدّم)</h2>${lines.join('')}</div>` : '';
  return tahSection + taalSection;
}

function srRecommendationsHtml(dx){
  const e = escapeHtml;
  if(!dx.recommendations.length) return '';
  return `<div class="sec"><h2>التوصيات</h2>${dx.recommendations.map(r =>
    `<div class="rc"><div><b>الدليل:</b> ${e(r.evidence)}</div><div><b>التشخيص:</b> ${e(r.diagnosis)}</div><div><b>الإجراء المقترح:</b> ${e(r.action)}</div></div>`).join('')}</div>`;
}

/* الجهة الموجَّه إليها: اسمها تحت خانة توقيعها فقط (لا في الترويسة) */
function srSignHtml(version, to, prefs, teacher){
  const e = escapeHtml;
  const cell = (role, name) => `<div><small>${e(name || '')}</small>${e(role)}</div>`;
  if(version === 'analytical'){
    return `<div class="sgn">${cell('المعلم', teacher)}${cell('الموجه الطلابي', prefs.counselor)}${cell('وكيل شؤون الطلاب', prefs.vice)}</div>`;
  }
  const t = to || 'ولي الأمر';
  const name = t === 'الموجه الطلابي' ? prefs.counselor : t === 'وكيل شؤون الطلاب' ? prefs.vice : t === 'وكيل شؤون المعلمين' ? prefs.staff : '';
  return `<div class="sgn">${cell('المعلم', teacher)}${cell(t, name)}</div>`;
}

/* ctx: { version, student:{name,label}, term:{year,semester}, date, prefs, logo, schoolLogo, to,
          rows, rules, overall:{pts,max,pct,incomplete,classPts}, dx,
          attendance:{counts,list,recorded}, incidents, positives, followups, tasks, cases } */
function buildStudentReportHtml2(ctx){
  const e = escapeHtml;
  const analytic = ctx.version === 'analytical';
  const prefs = ctx.prefs || {};
  const school = typeof gradeReportSchool === 'function' ? gradeReportSchool(prefs) : '';
  const subject = typeof gradeReportSubject === 'function' ? gradeReportSubject(prefs) : '';
  const teacher = typeof gradeReportTeacherName === 'function' ? gradeReportTeacherName(prefs) : '';
  const sem = Number(ctx.term && ctx.term.semester) === 2 ? 'الثاني' : 'الأول';
  const logo = ctx.logo && GRADE_REPORT_DATA_RE.test(ctx.logo) ? `<img src="${ctx.logo}" alt="">` : '';
  const slogo = ctx.schoolLogo && GRADE_REPORT_DATA_RE.test(ctx.schoolLogo) ? `<img src="${ctx.schoolLogo}" alt="">` : '';
  const title = analytic ? 'تقرير أداء الطالب التحليلي' : 'تقرير أداء الطالب';
  const meta = (k, v) => `<div><small>${k}</small><b>${e(v || '—')}</b></div>`;
  const o = ctx.overall || {};
  const dx = ctx.dx;
  const hasRows = ctx.rows && ctx.rows.length;
  const lv = dx && dx.overallJudged ? srLevel(o.pct, ctx.rules) : null;
  const diff = analytic && o.pts !== null && o.pts !== undefined && o.classPts !== null && o.classPts !== undefined && !o.incomplete ? Math.round((o.pts - o.classPts) * 10) / 10 : null;
  const kp = [];
  if(hasRows){
    kp.push(`<div><b>${o.pts === null || o.pts === undefined ? '—' : srScore(o.pts, o.max)}</b><span>${o.incomplete ? 'الدرجة المرصودة' : 'مجموع الدرجات'}</span></div>`);
    kp.push(`<div><b>${o.pct === null || o.pct === undefined ? '—' : srNum(srRound(o.pct) + '%')}</b><span>النسبة المئوية</span></div>`);
    kp.push(`<div><b>${lv ? srChip(lv) : '—'}</b><span>المستوى العام</span></div>`);
    if(analytic && diff !== null) kp.push(`<div><b>${srNum((diff > 0 ? '+' : '') + formatScore(diff))}</b><span>الفارق عن متوسط الشعبة (${srNum(formatScore(Math.round(o.classPts * 10) / 10))})</span></div>`);
  }
  let body = '';
  if(hasRows){
    body += `<div class="sec long"><h2>${analytic ? 'درجات البنود مقارنةً بمتوسط الشعبة' : 'درجات البنود'}</h2>${srItemsTableHtml(ctx.rows, ctx.rules, analytic)}`;
    const notes = ['ما لم يُرصد لا يُحسب على الطالب.'];
    if(dx && !dx.overallJudged) notes.push('لا أدلة كافية للحكم على المستوى العام' + (o.incomplete ? ' (الرصد غير مكتمل).' : '.'));
    notes.push(`المستوى: متقن ${srNum(ctx.rules.top + '%')} فأكثر · يحتاج تحسين أقل من ${srNum(ctx.rules.pass + '%')} (حدّان يضبطهما المعلم).`);
    body += `<div class="fn">${notes.join(' ')}</div></div>`;
  } else {
    body += '<div class="box"><span class="nd">لا درجات مرصودة لهذا الطالب في الفصل الحالي.</span></div>';
  }
  if(analytic){
    if(hasRows) body += srDiagnosisHtml(dx, true) + srRecommendationsHtml(dx);
    if(ctx.tasks && ctx.tasks.length){
      body += `<div class="sec long"><h2>المهام الأدائية</h2><table><thead><tr><th>المهمة</th><th class="n">الموعد</th><th class="n">النتيجة</th></tr></thead><tbody>${ctx.tasks.map(t =>
        `<tr><td>${e(t.title)}</td><td class="n">${e(t.due || '—')}</td><td class="n">${e(t.result)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const at = ctx.attendance;
    if(at && (at.recorded || at.list.length)){
      const c = at.counts;
      body += `<div class="sec long"><h2>الحضور</h2><table><thead><tr><th class="n">حاضر</th><th class="n">متأخر</th><th class="n">غائب</th><th class="n">مستأذن</th></tr></thead><tbody><tr><td class="n">${c.present === null || c.present === undefined ? '—' : srNum(c.present)}</td><td class="n">${srNum(c.late)}</td><td class="n">${srNum(c.absent)}</td><td class="n">${srNum(c.permitted_exit)}</td></tr></tbody></table>`;
      if(at.list.length){
        /* قائمتان متجاورتان بجدول واحد (صف = سجلان): توفّر نصف المساحة، ويبقى الجدول قابلًا للانقسام بين الصفحات */
        const half = Math.ceil(at.list.length / 2);
        const cells = a => a ? `<td>${e(a.date || '—')}</td><td class="n">${a.period ? srNum(a.period) : '—'}</td><td class="n">${e(ATTENDANCE_LABELS[a.status] || '')}${a.prevSection ? ' <span class="nd">(شعبة سابقة)</span>' : ''}</td>` : '<td></td><td></td><td></td>';
        const pair = [];
        for(let i = 0; i < half; i++) pair.push(`<tr>${cells(at.list[i])}${cells(at.list[i + half])}</tr>`);
        const th = '<th>التاريخ</th><th class="n">الحصة</th><th class="n">الحالة</th>';
        body += `<table class="two" style="margin-top:4px"><thead><tr>${th}${th}</tr></thead><tbody>${pair.join('')}</tbody></table>`;
      }
      const pv = at.prev ? [['absent', 'غاب'], ['late', 'تأخر'], ['permitted_exit', 'استأذن']].filter(([k]) => at.prev[k]).map(([k, w]) => `${w} ${srNum(at.prev[k])}`).join(' · ') : '';
      body += `<div class="fn">${at.recorded ? `وقائع من ${srNum(at.recorded)} حصة مرصودة لشعبته الحالية، دون حكم (الحاضر = الحصص المرصودة − الغياب والتأخر والاستئذان).` : 'وقائع من الرصد داخل الحصة، دون حكم.'}${pv ? ` وفي شعبة سابقة: ${pv}.` : ''}</div></div>`;
    }
    if(ctx.incidents && ctx.incidents.length){
      body += `<div class="sec long"><h2>المواقف السلوكية</h2><table><thead><tr><th>التاريخ</th><th>الموقف</th><th class="n">المرحلة</th></tr></thead><tbody>${ctx.incidents.map(i =>
        `<tr><td>${e(i.incident_date)}</td><td>${e(i.typeName || 'مخالفة')}${i.occurrence_number ? ' <span class="nd">(المرة ' + srNum(i.occurrence_number) + ')</span>' : ''}${i.notes ? ' — ' + e(i.notes) : ''}${i.referral_letter_generated ? ' <span class="nd">· صدر خطاب إحالة</span>' : ''}</td><td class="n">${e(SR_STAGE_LABELS[i.current_stage] || '')}</td></tr>`).join('')}</tbody></table><div class="fn">قسم مستقل، ولا يدخل في تحديد المستوى الدراسي.</div></div>`;
    }
    if(ctx.cases && ctx.cases.length){
      body += `<div class="sec long"><h2>حالات المتابعة الأكاديمية</h2><table><thead><tr><th>المادة</th><th>وصف الضعف والخطة</th><th class="n">الحالة</th></tr></thead><tbody>${ctx.cases.map(c =>
        `<tr><td>${e(c.subject)}</td><td>${e(c.weakness_description)}${c.plan_description ? '<div class="ev">الخطة: ' + e(c.plan_description) + '</div>' : ''}${c.plan_started_at ? '<div class="ev">بدأت: ' + e(c.plan_started_at) + '</div>' : ''}</td><td class="n">${e(SR_ACASE_LABELS[c.status] || '')}${c.referral_letter_generated ? '<div class="ev">صدر خطاب إحالة</div>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if(ctx.positives && ctx.positives.length){
      body += `<div class="sec long"><h2>الملاحظات الإيجابية</h2><table><tbody>${ctx.positives.map(p =>
        `<tr><td style="width:80px">${e(p.note_date)}</td><td>${e(p.note_text || 'ملاحظة إيجابية')}</td></tr>`).join('')}</tbody></table></div>`;
    }
    if(ctx.followups && ctx.followups.length){
      body += `<div class="sec long"><h2>المتابعات المسجلة</h2><table><thead><tr><th>التاريخ</th><th>السبب</th><th class="n">الحالة</th></tr></thead><tbody>${ctx.followups.map(f => {
        const ba = typeof followupBeforeAfter === 'function' ? followupBeforeAfter(f) : { before: null, after: null };
        const nums = (ba.before || ba.after) ? `<div class="ev">قبل: ${e(ba.before || '—')} · بعد: ${e(ba.after || 'لا بيانات كافية')}</div>` : '';
        const next = f.next_step ? `<div class="ev">الخطوة التالية: ${e(f.next_step)}</div>` : '';
        const st = f.status === 'open' ? 'مفتوحة · المراجعة ' + e(f.review_date || '') : e(SR_FOLLOWUP_OUTCOMES[f.outcome] || 'مغلقة');
        return `<tr><td>${e(String(f.created_at || '').slice(0, 10))}</td><td>${e(f.reason_text)}${nums}${next}</td><td class="n">${st}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    }
    body += `<div class="sec"><h2>الخطوة التالية المتفق عليها</h2><div class="lines"><div></div><div></div><div></div></div></div>`;
    body += srSignHtml('analytical', ctx.to, prefs, teacher);
    body += '<div class="fn">الأرقام وقائع من الرصد داخل الحصة. التغيّر بعد أي متابعة لا يثبت أنها سببه وحده.</div>';
  } else {
    body += srSignHtml('grades', ctx.to, prefs, teacher);
  }
  const head = `<div class="hd"><div class="mo">${logo}</div><div class="tt"><div class="sch">${school ? e(school) : 'اسم المدرسة'}</div><h1>${title}</h1></div><div class="sl">${slogo}</div></div>`;
  const metaHtml = `<div class="mt">${meta('الطالب', ctx.student.name)}${meta('الصف والشعبة', ctx.student.label)}${meta('الفصل الدراسي', `${sem} ${ctx.term ? ctx.term.year : ''}`)}${meta('المعلم', teacher)}${meta('المادة', subject)}${meta('التاريخ', ctx.date)}</div>`;
  return `<style>${SR_CSS}</style><div class="sr">${head}${metaHtml}${kp.length ? `<div class="kp">${kp.join('')}</div>` : ''}${body}<div class="strip"></div></div>`;
}

/* ============ التحميل والتجميع ============ */

/* حدّا الضعف والتفوق (app-29/31) + عتبة التعثر الشديد */
function srRulesNow(){
  const r = typeof gradeAnalysisRulesNow === 'function' ? gradeAnalysisRulesNow() : { pass: 50, edge: 10, top: 90 };
  const sv = typeof gradeSevereNow === 'function' ? gradeSevereNow() : SR_SEVERE_DEFAULT;
  return { pass: Number(r.pass), edge: Number(r.edge), top: Number(r.top), severe: srSevereOf({ pass: r.pass, severe: sv }) };
}

function srToolTypeOf(id){
  const t = typeof customToolById === 'function' ? customToolById(id) : null;
  return t ? t.tool_type : null;
}

/* الخط يُحمَّل عند أول استعمال؛ ننتظره قبل الطباعة وإلا خرج الخط البديل */
async function srEnsureFonts(){
  if(typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  try{ await Promise.all(['400', '700'].map(w => document.fonts.load(`${w} 12px 'Helvetica Neue W23 for SKY'`, 'شاهد الأداء الوظيفي'))); } catch(e){ /* الاحتياطي Cairo */ }
}

function srStudentById(id){
  const a = typeof crmStudents !== 'undefined' ? crmStudents.find(s => s.id === id) : null;
  if(a) return a;
  return typeof crmArchivedStudents !== 'undefined' ? (crmArchivedStudents.find(s => s.id === id) || null) : null;
}

/* عدّاد حالات واجبات الطالب المحسوبة (انقضى موعدها أو بدأ رصدها) */
async function srHomeworkCounts(sectionId, term, studentId){
  const hw = await loadSectionHomework(sectionId, term);
  const counted = countedHomework(hw.homeworks, hw.statusRows, localIsoDate());
  const idx = homeworkStatusIndex(hw.statusRows);
  const c = { total: counted.length, submitted: 0, partial: 0, late: 0, missing: 0 };
  counted.forEach(h => {
    const st = (idx.get(h.id) && idx.get(h.id).get(studentId)) || 'missing';
    c[st] = (c[st] || 0) + 1;
  });
  return c;
}

/* حالات المتابعة الأكاديمية للطالب — فلترة teacher_id صريحة */
async function srLoadCases(studentId){
  const { data, error } = await sb.from('academic_cases')
    .select('id, subject, weakness_description, plan_description, status, plan_started_at, referral_letter_generated')
    .eq('teacher_id', currentUser.id).eq('student_id', studentId).order('plan_started_at', { ascending: false });
  if(error) throw error;
  return data || [];
}

/* يبني HTML تقرير طالب واحد. opts.g = كشف درجات محمَّل (للدفعة)؛ وإلا يُحمَّل كشف شعبته.
   يرجع { html, mark } كما يتوقعه gradeReportRun */
async function srBuildReport(studentId, version, to, opts){
  opts = opts || {};
  const analytic = version === 'analytical';
  const student = srStudentById(studentId);
  if(!student) throw new Error('الطالب غير موجود في السنة المعروضة');
  if(typeof currentUser === 'undefined' || !currentUser) throw new Error('انتهت الجلسة');
  const prefs = gradeReportPrefsNow();
  const rules = srRulesNow();
  let g = opts.g || null;
  if(!g && student.section_id){
    g = await loadCrmGradeSheet(student.section_id);
    if(g && g.error) throw g.error;
  }
  const term = g ? { year: g.year, semester: g.semester } : crmCurrentTerm();
  const d = g ? gradeReportStudentData(g, studentId) : null;
  let rows = [], overall = {}, homework = null;
  if(d && d.pts !== null){
    const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
    const testsOn = appToolOn('tests');
    const res = studentGradeResult(g.columns, g.scores, studentId, caps);
    const adm = new Set(gradeAdministeredColumns(g.columns, g.scores, testsOn).map(c => c.id));
    const meas = new Map(g.columns.map(c => [c.id, c.measures || null]));
    const items = res.performance.parts.map(x => Object.assign({}, x, { category: 'performance' }))
      .concat(testsOn ? res.tests.list.map(x => Object.assign({}, x, { category: 'tests' })) : [])
      .map(x => Object.assign({}, x, { measures: meas.get(x.id) || null }))
      .filter(x => x.score !== null || adm.has(x.id));
    const classPctOf = id => {
      const col = g.columns.find(c => c.id === id);
      const list = (g.scores || []).filter(s => s.column_id === id);
      return col && list.length && Number(col.max_score) > 0 ? 100 * list.reduce((a, s) => a + Number(s.score), 0) / list.length / Number(col.max_score) : null;
    };
    rows = srBuildRows(items, studentId, g.breakdown || null, x => periodCfg(term, periodCompKeyOfColumn(x)), classPctOf, srToolTypeOf).rows;
    overall = { pts: d.pts, max: d.max, pct: d.pct, incomplete: d.incomplete, classPts: d.classPts };
    if(analytic && rows.some(r => r.kind === 'homework')) homework = await srHomeworkCounts(g.sectionId, term, studentId);
  }
  let extra = { attendance: null, incidents: [], positives: [], followups: [], tasks: [], cases: [] };
  let lessonsHeld = 0;
  if(analytic){
    if(!crmIncidentTypes.length) await loadCrmIncidentTypes();
    const data = await loadCrmStudentProfileData(student); /* ملاحظات المعلم الخاصة (privateNotes) لا تُستعمل هنا أبدًا */
    lessonsHeld = data.recordedLessons || 0;
    const sum = srAttendanceSummary(data.attendance, data.currentSectionId, data.recordedLessons);
    /* مفاتيح التشغيل كما في بقية التطبيق: أداة موقوفة (الحضور/السلوك) أو ميزة موقوفة (المتابعات/المتابعة الأكاديمية)
       لا يظهر شيء منها في التقرير، ولا يُقرأ جدول الموقوف */
    const toolOn = k => typeof appToolOn === 'function' ? appToolOn(k) : true;
    const follOn = typeof followupsOn === 'function' && followupsOn();
    const acadOn = typeof ACADEMIC_ON !== 'undefined' && ACADEMIC_ON === true;
    extra = {
      attendance: toolOn('attendance') ? { counts: sum.counts, prev: sum.prev, list: sum.list, recorded: data.recordedLessons || 0 } : null,
      incidents: toolOn('behavior') ? (data.incidents || []).slice().sort((a, b) => String(b.incident_date).localeCompare(String(a.incident_date))) : [],
      positives: (data.positives || []).slice().sort((a, b) => String(b.note_date).localeCompare(String(a.note_date))),
      followups: follOn ? (data.followups || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : [],
      tasks: (data.tasks || []).map(t => { const l = studentTaskLines([t])[0]; return { title: l.title, result: l.result, due: t.due_date || '' }; }),
      cases: acadOn ? await srLoadCases(studentId) : []
    };
  }
  const testGroups = typeof tlGroupsOf === 'function' ? tlGroupsOf(typeof appFeatures !== 'undefined' ? appFeatures : null, term) : [];
  const dx = srDiagnose({ rows, rules, homework, lessonsHeld, overall, testGroups });
  await srEnsureFonts();
  const label = studentClassLabel(student, crmGradeLevels, crmSections);
  const html = buildStudentReportHtml2(Object.assign({
    version, student: { name: student.full_name, label: label.grade + ' — الشعبة ' + label.section }, term, date: localIsoDate(), prefs,
    logo: await gradeReportLogoData(), schoolLogo: await gradeReportSchoolLogoData(), to, rows, rules, overall, dx
  }, extra));
  return { html, mark: gradeReportMark(prefs, analytic ? 'تقرير أداء الطالب التحليلي' : 'تقرير أداء الطالب', student.full_name) };
}

/* ============ التصدير والواجهة ============ */
async function srRun(studentId, version, to, btn, g){
  const st = srStudentById(studentId);
  if(!st) return;
  await gradeReportRun(btn, () => srBuildReport(studentId, version, to, { g }), gradeReportFile(version === 'analytical' ? 'تقرير-طالب-تحليلي' : 'تقرير-طالب', st.full_name));
}

/* نافذة اختيار النسخة (من ملف الطالب ومن صفحته في الكشف) */
function openStudentReportChooser(studentId){
  const st = srStudentById(studentId);
  if(!st) return;
  const toOpts = GA_REPORT_TO.map(f => `<option value="${escapeHtml(f[1])}">${escapeHtml(f[1])}</option>`).join('');
  showInfoModal(`<div class="crm-ga">
    <div style="font-weight:700;margin-bottom:8px;">تقرير الطالب: ${escapeHtml(st.full_name)}</div>
    <button type="button" class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:6px;" onclick="srChooserGo('${escapeHtml(st.id)}','analytical')">النسخة التحليلية — كل ما يخص الطالب</button>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">الدرجات والتشخيص والتوصيات، مع الحضور والمخالفات والمتابعات والحالات الأكاديمية.</div>
    <button type="button" class="btn btn-outline" style="width:100%;justify-content:center;margin-bottom:6px;" onclick="srChooserGo('${escapeHtml(st.id)}','grades')">نسخة الدرجات — أرقام ومستويات</button>
    <label style="font-size:12px;color:var(--muted);">الموجّه إليها (لنسخة الدرجات؛ اسمها تحت خانة توقيعها)</label>
    <select id="srToSel" class="crm-input" style="width:100%;margin-top:4px;">${toOpts}</select>
    ${srLinkHintHtml(st)}
  </div>`, '420px');
}

function srChooserGo(studentId, version){
  const sel = document.getElementById('srToSel');
  const to = version === 'grades' && sel && sel.value ? sel.value : null;
  const close = document.getElementById('confirmCancelBtn');
  if(close && close.click) close.click();
  showToast('جارٍ تجهيز التقرير...', 'ok');
  return srRun(studentId, version, to, null, null);
}

/* تنبيه للمعلم على الشاشة فقط (لا في الـPDF الذي قد يصل لولي الأمر): اختبارات الطالب بلا مقارنة بينها */
function srLinkHintHtml(st){
  try{
    if(typeof crmGrades === 'undefined' || !crmGrades || crmGrades.sectionId !== st.section_id || typeof tlComparableClasses !== 'function') return '';
    const mine = new Set((crmGrades.scores || []).filter(x => x.student_id === st.id).map(x => x.column_id));
    const tests = (crmGrades.columns || []).filter(c => c.category === 'tests' && mine.has(c.id)).map(c => ({ name: c.name, measures: c.measures }));
    if(tests.length < 2) return '';
    const groups = tlGroupsOf(appFeatures, { year: crmGrades.year, semester: crmGrades.semester });
    if(tlComparableClasses(tests, groups).length) return '';
    return '<div style="font-size:12px;color:var(--muted);margin-top:10px;line-height:1.7;">اختباراته غير مقارَنة ببعضها. لتظهر مقارنتها في التقرير: عدّل الاختبار واختر «قارنه مع»، أو اختر الشيء نفسه في «ماذا يقيس؟».</div>';
  } catch(e){ return ''; }
}
