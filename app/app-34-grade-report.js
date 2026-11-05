/* ============================================================
   تقارير الدرجات PDF (شعبة · بند · مجموعة شعب · طالب) — بلا شعار ولا هوية جهة
   ------------------------------------------------------------
   - المعلم يختار ما يُطبع (الأقسام)، والتعليق التربوي (قراءة · قوة · ضعف · خطة) اختياري ومطفأ افتراضيًا،
     وبياناته (المدرسة · المعلم · وكيل شؤون الطلاب) — كلها في features.reportPrefs
     (user_app_settings) وتُطبَّق على كل تقاريره. غياب المفتاح = الافتراضي.
   - التعليق التربوي قواعد شرطية على الأرقام (بلا ذكاء اصطناعي): نفس الأرقام → نفس الكلام.
   - ما لم يُرصد لا يُحسب (لا صفر) — كما في تحليل الدرجات (app-29).
   - كل استعلام لشعب أخرى/فصل سابق يمرّ عبر loadGradeSheetsRaw (فلترة teacher_id صريحة)،
     وكل نص من المستخدم/القاعدة يمرّ عبر escapeHtml.
   ============================================================ */

const GRADE_REPORT_DEFAULT = {
  school: '', teacher: '', vice: '', staff: '', counselor: '', subject: '', /* vice = وكيل شؤون الطلاب · staff = وكيل شؤون المعلمين · counselor = الموجه الطلابي */
  show: { levels: true, stats: true, items: true, names: false, compare: false },
  notes: { reading: false, strengths: false, weaknesses: false, plans: false } /* الأصل: تقرير أرقام بلا تعليق تربوي */
};
const GRADE_REPORT_SHOW_LABELS = {
  levels: 'توزيع الطلاب على المستويات',
  stats: 'المؤشرات الإحصائية (أدنى · أعلى · وسيط)',
  items: 'درجات البنود',
  names: 'أسماء الطلاب (ضعاف · متوسطون · متفوقون)',
  compare: 'مقارنة بالفصل السابق (تقرير الشعبة)'
};
const GRADE_REPORT_NOTE_LABELS = {
  reading: 'القراءة التربوية',
  strengths: 'نقاط القوة',
  weaknesses: 'نقاط الضعف وفرص التحسين',
  plans: 'الخطط العلاجية والتوصيات'
};
const GRADE_REPORT_NAME_MAX = 80;
const GRADE_REPORT_BAND_LOWER = [0, 50, 60, 70, 80, 90];

/* ============ دوال صرفة: الإعدادات ============ */

/* هل في خيارات المعلم تعليق تربوي مفعَّل؟ (الأصل: لا) */
function gradeReportNotesAny(prefs){
  return Object.keys(GRADE_REPORT_NOTE_LABELS).some(k => prefs && prefs.notes && prefs.notes[k] === true);
}

/* خيارات هذا التصدير: بلا تعليق (الأصل)، أو مع التعليق — بما اختاره المعلم، وإلا بكل أقسامه */
function gradeReportPrefsForRun(prefs, withNotes){
  const notes = {};
  const any = gradeReportNotesAny(prefs);
  Object.keys(GRADE_REPORT_NOTE_LABELS).forEach(k => { notes[k] = !!withNotes && (any ? prefs.notes[k] === true : true); });
  return Object.assign({}, prefs, { notes });
}

function gradeReportDefaultCopy(){ return JSON.parse(JSON.stringify(GRADE_REPORT_DEFAULT)); }

/* ما يُقرأ من القاعدة لا يُوثق بشكله. null = الافتراضي (لا يُخزَّن) */
function normalizeReportPrefs(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = gradeReportDefaultCopy();
  ['school', 'teacher', 'vice', 'staff', 'counselor', 'subject'].forEach(k => {
    if(typeof raw[k] === 'string') out[k] = raw[k].replace(/\s+/g, ' ').trim().slice(0, GRADE_REPORT_NAME_MAX);
  });
  [['show', GRADE_REPORT_SHOW_LABELS], ['notes', GRADE_REPORT_NOTE_LABELS]].forEach(([grp, labels]) => {
    Object.keys(labels).forEach(k => {
      const v = raw[grp] && raw[grp][k];
      if(v === true || v === false) out[grp][k] = v;
    });
  });
  return JSON.stringify(out) === JSON.stringify(GRADE_REPORT_DEFAULT) ? null : out;
}

function gradeReportPrefsNow(){
  return normalizeReportPrefs(typeof appFeatures !== 'undefined' && appFeatures && appFeatures.reportPrefs) || gradeReportDefaultCopy();
}

/* اسم المعلم: ما كتبه، وإلا اسم حسابه تلقائيًا */
function gradeReportTeacherName(prefs){
  if(prefs && prefs.teacher) return prefs.teacher;
  const meta = (typeof currentUser !== 'undefined' && currentUser && currentUser.user_metadata) || {};
  return String(meta.full_name || '').trim();
}

/* المادة والمدرسة: ما كتبه المعلم، وإلا من حقول ملفه الشخصي تلقائيًا */
function gradeReportSubject(prefs){
  if(prefs && prefs.subject) return prefs.subject;
  return typeof getProfileSubject === 'function' ? String(getProfileSubject() || '').trim() : '';
}
function gradeReportSchool(prefs){
  if(prefs && prefs.school) return prefs.school;
  return typeof getProfileSchool === 'function' ? String(getProfileSchool() || '').trim() : '';
}

/* ============ دوال صرفة: الحساب ============ */

const grn = v => `<bdi dir="ltr">${v}</bdi>`;

function gradeReportCount(n){
  return n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : n <= 10 ? `${grn(n)} طلاب` : `${grn(n)} طالبًا`;
}

/* متوسط درجة كل بند مرصود (للشعبة): avg بدرجته، avgPct نسبة المتوسط من درجة البند */
function gradeReportItems(g, students){
  const ids = new Set((students || []).map(s => s.id));
  return (g.columns || []).map(c => {
    const rows = (g.scores || []).filter(s => s.column_id === c.id && ids.has(s.student_id));
    if(!rows.length) return null;
    const max = Number(c.max_score);
    const avg = rows.reduce((a, s) => a + Number(s.score), 0) / rows.length;
    return { id: c.id, name: c.name, category: c.category, avg: Math.round(avg * 10) / 10, max, avgPct: Math.round(100 * avg / max), recorded: rows.length };
  }).filter(Boolean);
}

/* مستويات ثلاثة (متفوق · متوسط · ضعيف) بحدود المعلم، لمن رُصد له فقط */
function gradeReportLevels(rows, rules){
  const rec = (rows || []).filter(r => r.pct !== null);
  return {
    top: rec.filter(r => r.pct >= rules.top).length,
    low: rec.filter(r => r.pct < rules.pass).length,
    mid: rec.filter(r => r.pct >= rules.pass && r.pct < rules.top).length
  };
}

function gradeReportBandTone(i, rules){
  const lo = GRADE_REPORT_BAND_LOWER[i];
  return lo < rules.pass ? 'tn' : lo >= rules.top ? 'g' : 'bl';
}

function gradeReportItemTone(pct, rules){
  return pct < rules.pass ? 'tn' : pct >= rules.top ? 'g' : 'bl';
}

/* ============ دوال صرفة: التعليق التربوي (قواعد، بلا ذكاء اصطناعي) ============ */

/* تعليق تقرير الشعبة/البند: ctx = { s, displayMax, items, isTotal, colLabel } */
function gradeReportSectionNotes(c){
  const s = c.s, r = s.rules, f = formatScore;
  const reading = [], strengths = [], weaknesses = [], plans = [];
  const pct = n => grn(Math.round(100 * n / s.recorded) + '%');
  if(s.avg !== null && s.avgPct !== null) reading.push(`يشير المتوسط (${grn(f(s.avg))}) إلى تحقق نحو ${grn(s.avgPct + '%')} من الدرجة الكاملة.`);
  if(s.avg !== null && s.median !== null && Math.abs(s.avg - s.median) >= 0.05 * c.displayMax){
    reading.push(s.avg > s.median
      ? `المتوسط أعلى من الوسيط (${grn(f(s.median))}): درجات مرتفعة لدى فئة محدودة ترفع المتوسط فوق مستوى نصف الشعبة.`
      : `الوسيط (${grn(f(s.median))}) أعلى من المتوسط: درجات منخفضة جدًا لدى فئة محدودة تسحب المتوسط للأسفل.`);
  }
  if(s.max !== null && s.min !== null && s.max - s.min >= 0.5 * c.displayMax) reading.push(`المدى (${grn(f(Math.round((s.max - s.min) * 100) / 100))}) كبير، وهذا تباين واضح بين الطلاب يستدعي تنويع التعليم.`);
  reading.push(s.groups.low.length
    ? `وجود ${gradeReportCount(s.groups.low.length)} أقل من ${grn(r.pass + '%')} يستدعي متابعة علاجية.`
    : `لا طالب أقل من ${grn(r.pass + '%')}.`);

  if(!s.topIsFallback && s.groups.top.length) strengths.push(`حقق ${gradeReportCount(s.groups.top.length)} ${grn(r.top + '%')} فأكثر.`);
  const best = c.isTotal && c.items.length > 1 ? c.items.reduce((m, x) => x.avgPct > m.avgPct ? x : m) : null;
  const worst = c.isTotal && c.items.length > 1 ? c.items.reduce((m, x) => x.avgPct < m.avgPct ? x : m) : null;
  if(best && best.avgPct >= r.pass && (!worst || best.id !== worst.id)) strengths.push(`أقوى البنود: ${escapeHtml(best.name)} (${grn(best.avgPct + '%')}).`);

  if(s.groups.low.length) weaknesses.push(`${gradeReportCount(s.groups.low.length)} (${pct(s.groups.low.length)}) أقل من ${grn(r.pass + '%')}.`);
  if(worst && worst.avgPct < r.pass + r.edge && (!best || best.id !== worst.id)) weaknesses.push(`أضعف البنود: ${escapeHtml(worst.name)} (${grn(worst.avgPct + '%')}).`);

  if(s.groups.low.length){
    plans.push(`مراجعة أوراق الطلاب الأقل من ${grn(r.pass + '%')} (${grn(s.groups.low.length)}) لتحديد مواطن التعثر لكل طالب.`);
    plans.push('تنفيذ نشاط علاجي قصير ثم اختبار تحقق مماثل في المهارات المستهدفة.');
  }
  if(!s.topIsFallback && s.groups.top.length) plans.push('تقديم مسائل إثرائية للمتفوقين مع الاستفادة منهم في تعليم الأقران.');
  if(worst && worst.avgPct < r.pass + r.edge && (!best || best.id !== worst.id)) plans.push(`إعادة شرح المهارات التي يقيسها «${escapeHtml(worst.name)}» قبل الانتقال لما بعده.`);
  plans.push('مقارنة نتائج التقييم التالي بهذه النتائج لقياس أثر التدخل.');
  return { reading, strengths, weaknesses, plans };
}

/* تعليق تقرير الطالب: ctx = { pts, max, pct, classPts, classPct, items:[{name,score,max,pct,classPct}], rules } */
function gradeReportStudentNotes(c){
  const r = c.rules, f = formatScore;
  const reading = [], strengths = [], weaknesses = [], plans = [];
  const recorded = c.items.filter(x => x.score !== null);
  if(c.pts === null){
    reading.push('لم تُرصد درجات لهذا الطالب بعد.');
    return { reading, strengths, weaknesses, plans };
  }
  const diff = c.classPts === null ? null : Math.round((c.pts - c.classPts) * 10) / 10;
  reading.push(`حقق الطالب ${grn(f(c.pts))} من ${grn(f(c.max))} (${grn(Math.round(c.pct) + '%')})${diff === null ? '' : diff >= 0 ? `، فوق متوسط الشعبة بـ ${grn(f(diff))} درجة` : `، دون متوسط الشعبة بـ ${grn(f(Math.abs(diff)))} درجة`}.`);
  reading.push(c.pct < r.pass ? `وهو أقل من ${grn(r.pass + '%')}، أي من الضعاف ويحتاج دعمًا.`
    : c.pct >= r.top ? 'وهو في فئة المتفوقين.' : 'وهو في مستوى المتوسطين.');
  const up = recorded.filter(x => x.classPct !== null && x.pct - x.classPct >= 10).sort((a, b) => (b.pct - b.classPct) - (a.pct - a.classPct));
  const down = recorded.filter(x => x.pct < r.pass || (x.classPct !== null && x.pct - x.classPct <= -10)).sort((a, b) => a.pct - b.pct);
  up.forEach(x => strengths.push(`${escapeHtml(x.name)} (${grn(Math.round(x.pct) + '%')}) أعلى من متوسط الشعبة (${grn(Math.round(x.classPct) + '%')}).`));
  down.forEach(x => weaknesses.push(`${escapeHtml(x.name)} (${grn(Math.round(x.pct) + '%')})${x.classPct !== null && x.pct < x.classPct ? ` دون متوسط الشعبة (${grn(Math.round(x.classPct) + '%')})` : ''}.`));
  down.slice(0, 2).forEach(x => plans.push(`مراجعة «${escapeHtml(x.name)}» لتحديد المهارات التي فقد فيها الدرجات، وتكليفه بتدريبات قصيرة عليها.`));
  if(c.pct < r.pass) plans.push('التواصل مع ولي الأمر ووضع خطة علاجية بمتابعة أسبوعية.');
  if(up.length) plans.push(`الإبقاء على مستواه في «${escapeHtml(up[0].name)}»، وإشراكه في تعليم الأقران.`);
  if(!plans.length) plans.push('الاستمرار على المستوى الحالي ومتابعة التقييم القادم.');
  return { reading, strengths, weaknesses, plans };
}

/* تعليق تقرير مجموعة الشعب: ctx = { secs: [{ label, s }] } — s من analyzeGradeRows */
function gradeReportGroupNotes(c){
  const reading = [], strengths = [], weaknesses = [], plans = [];
  const secs = c.secs.filter(x => x.s.avgPct !== null);
  if(secs.length < 2) return { reading, strengths, weaknesses, plans };
  const top = secs.reduce((m, x) => x.s.avgPct > m.s.avgPct ? x : m);
  const bot = secs.reduce((m, x) => x.s.avgPct < m.s.avgPct ? x : m);
  const gap = top.s.avgPct - bot.s.avgPct;
  if(top === bot){
    reading.push('متوسطات الشعب متقاربة جدًا.');
  } else {
    reading.push(`أعلى الشعب تحصيلًا ${escapeHtml(top.label)} (${grn(top.s.avgPct + '%')}) وأدناها ${escapeHtml(bot.label)} (${grn(bot.s.avgPct + '%')})، بفارق ${grn(gap)} نقطة مئوية.`);
    reading.push(gap >= 15 ? 'الفارق كبير، وهذا يرجّح أن السبب في الشعبة (التوزيع والتهيئة) لا في المحتوى.' : 'الفارق محدود، وهذا يرجّح أن مستوى الشعب متقارب في المحتوى نفسه.');
  }
  if(top !== bot) strengths.push(`${escapeHtml(top.label)}: الأعلى تحصيلًا (${grn(top.s.avgPct + '%')}).`);
  secs.filter(x => x.s.groups.low.length).sort((a, b) => b.s.groups.low.length / b.s.recorded - a.s.groups.low.length / a.s.recorded).slice(0, 3)
    .forEach(x => weaknesses.push(`${escapeHtml(x.label)}: ${gradeReportCount(x.s.groups.low.length)} ضعاف (${grn(Math.round(100 * x.s.groups.low.length / x.s.recorded) + '%')}).`));
  if(top !== bot && gap >= 15) plans.push(`عقد جلسة مراجعة لطلاب ${escapeHtml(bot.label)} ومقارنة طرائق التدريس بين الشعب.`);
  plans.push('تنفيذ أنشطة علاجية للضعاف في كل شعبة، بحسب قائمة كل شعبة.');
  plans.push('تبادل الأنشطة الفعّالة بين الشعب، ثم إعادة المقارنة بعد التقييم التالي.');
  return { reading, strengths, weaknesses, plans };
}

/* ============ دوال صرفة: بيانات التقارير ============ */

/* صفوف شعبة لعمود التحليل: المجموع، أو العمود بالاسم؛ null إن غاب العمود */
function gradeReportSheetRows(sheet, students, spec, caps, testsOn){
  let key = 'total';
  if(!spec.total){
    const col = (sheet.columns || []).find(c => normalizeGradeColumnName(c.name) === spec.name);
    if(!col) return null;
    key = col.id;
  }
  const res = gradeAnalysisRows(sheet, students, key, caps, testsOn);
  return res.rows.length ? res : null;
}

/* بيانات الطالب من الكشف المحمَّل */
function gradeReportStudentData(g, studentId){
  const students = crmStudentsOfSection(g.sectionId);
  const st = students.find(x => x.id === studentId);
  if(!st) return null;
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const resOf = id => studentGradeResult(g.columns, g.scores, id, caps);
  const r = resOf(studentId);
  const t = studentGradeTotal(r, testsOn, caps);
  const max = r.performance.max + (testsOn ? Number(caps.tests) : 0);
  const has = t.points !== null && t.recordedMax > 0;
  const totals = students.map(s => studentGradeTotal(resOf(s.id), testsOn, caps)).filter(x => x.points !== null && x.recordedMax > 0);
  const mean = fn => totals.length ? totals.reduce((a, x) => a + fn(x), 0) / totals.length : null;
  const colAvgPct = (id, mx) => {
    const rows = (g.scores || []).filter(s => s.column_id === id);
    return rows.length ? 100 * rows.reduce((a, s) => a + Number(s.score), 0) / rows.length / mx : null;
  };
  const items = r.performance.parts.concat(testsOn ? r.tests.list : []).map(x => ({
    name: x.name, score: x.score, max: x.max,
    pct: x.score === null ? null : 100 * x.score / x.max, classPct: colAvgPct(x.id, x.max)
  }));
  return {
    name: st.full_name, label: crmSectionLabel(g.sectionId), year: g.year, semester: g.semester,
    pts: has ? t.points : null, max, pct: has ? 100 * t.points / t.recordedMax : null,
    classPts: mean(x => x.points), classPct: mean(x => 100 * x.points / x.recordedMax),
    items, rules: gradeAnalysisRulesNow()
  };
}

/* ============ HTML التقرير (يُلتقط صورةً ثم يُوزَّع على صفحات A4) ============ */

const GRADE_REPORT_CSS = `
.gr,.gr *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.gr{font-family:'Cairo',sans-serif;color:#15445a;direction:rtl;padding:26px 34px 0;background:#fff;font-size:12.5px}
.gr *{box-sizing:border-box}
.gr .hd{position:relative;display:flex;align-items:center;justify-content:space-between;padding-bottom:7px;margin-bottom:12px}
.gr .hd:after{content:'';position:absolute;right:0;left:0;bottom:0;height:4px;border-radius:2px;background:linear-gradient(90deg,#3B83B7,#4CB176)}
.gr .hd img{height:54px}.gr .hd .lg{width:150px}
.gr .hd .t{text-align:center;flex:1}.gr .hd .t small{display:block;font-size:11px;color:#5b6b74}
.gr .hd .t h1{margin:0;font-size:20px;color:#351375;font-weight:800}.gr .hd .t .m{font-size:11px;color:#5b6b74}
.gr .hd .mt{width:150px;font-size:10.5px;color:#5b6b74;text-align:left;line-height:1.7}
.gr .kp{display:flex;gap:9px;margin-bottom:10px}.gr .kp>div{flex:1;border:1.5px solid #dfe6ea;border-radius:11px;padding:5px 4px;text-align:center;background:#fff}
.gr .kp b{display:block;font-size:20px;line-height:1.5;color:#15445a;font-weight:800}.gr .kp span{font-size:10.5px;color:#5b6b74}.gr .kp small{display:block;font-size:9.5px;color:#8a97a0}
.gr .kp .b b{color:#3d7eb9}.gr .kp .n b{color:#15445a}.gr .kp .r b{color:#7258a4}
.gr h2{display:flex;align-items:center;gap:8px;font-size:13.5px;color:#15445a;margin:10px 0 6px;font-weight:800}
.gr h2:before{content:'';width:5px;height:16px;border-radius:3px;background:linear-gradient(180deg,#3B83B7,#4CB176)}
.gr .tr{flex:1;height:13px;background:#e8eef1;border-radius:7px;position:relative}.gr .tr i{display:block;height:100%;border-radius:7px}
.gr .g{background:#07a869}.gr .bl{background:#3d7eb9}.gr .tn{background:#7258a4}
.gr .nb{background:#eef5f9;border-right:4px solid #3d7eb9;padding:6px 12px;font-size:11.5px;line-height:1.7;margin:5px 0}
.gr .nb.w{background:#f1eef7;border-color:#7258a4}.gr .nb.gr2{background:#e9f7f1;border-color:#07a869}
.gr .li{display:flex;gap:8px;align-items:flex-start;margin:1px 0}.gr .li .mk{flex:0 0 20px;color:#07a869;font-weight:800;text-align:right}.gr .li .tx{flex:1}
.gr .fn{font-size:9.5px;color:#7a8791;margin:4px 0;line-height:1.7}
.gr .sm{display:flex;gap:8px;margin:4px 0 5px}.gr .sm>div{flex:1;background:#f4f8f8;border-radius:8px;padding:3px 6px;text-align:center;font-size:10px;color:#5b6b74}
.gr .sm b{display:block;font-size:15px;color:#15445a}
.gr .it{display:flex;align-items:center;margin:3px 0;font-size:11.5px;padding:2px 8px;border-radius:6px}
.gr .it.on,.gr tr.on td{background:#e9f7f1}.gr .it .a{width:150px}
.gr .it .tr u{position:absolute;top:-3px;width:3px;height:19px;background:#15445a;border-radius:2px}
.gr .it .v{width:140px;text-align:left;font-weight:700;font-size:11px}
.gr .cn{display:inline-block;background:#e3f1ee;color:#0a6b4a;border-radius:10px;padding:0 9px;font-size:10px;font-weight:700}
.gr .cp{display:inline-block;border-radius:10px;padding:0 10px;font-size:10.5px;font-weight:700;color:#fff;line-height:1.7}.gr .cp.w{background:#7258a4}.gr .cp.m{background:#3d7eb9}.gr .cp.t{background:#07a869}
.gr .lb{display:flex;height:13px;border-radius:7px;overflow:hidden;margin-top:6px}.gr .lb i{display:block;height:100%}
.gr table{width:100%;border-collapse:collapse;font-size:11px;line-height:1.25}.gr th{background:#15445a;color:#fff;padding:3.5px 7px;font-weight:700;text-align:right}
.gr td{padding:2.5px 7px;border-bottom:1px solid #e3e9ec}.gr tr:nth-child(even) td{background:#f6f9fa}.gr td.n,.gr th.n{text-align:center}
.gr .mb{position:relative;height:9px;background:#e8eef1;border-radius:5px}.gr .mb i{display:block;height:100%;border-radius:5px}.gr .mb u{position:absolute;top:-3px;width:2px;height:15px;background:#15445a}
.gr .two{display:flex;gap:16px;align-items:flex-start}.gr .two>div{flex:1;min-width:0}
.gr .c3{display:flex;gap:10px;align-items:flex-start}.gr .c3>div{flex:1;min-width:0}.gr .c3 td,.gr .c3 th{padding-left:4px;padding-right:5px;white-space:nowrap}.gr .c3 td:first-child{white-space:normal}
.gr .gw{margin-bottom:8px}.gr .gh{display:flex;justify-content:space-between;align-items:center;padding:3px 9px;border-radius:7px 7px 0 0;color:#fff;font-size:12px;font-weight:700}
.gr .gh.w{background:#7258a4}.gr .gh.m{background:#3d7eb9}.gr .gh.t{background:#07a869}.gr .gh span{background:rgba(255,255,255,.28);border-radius:10px;padding:0 8px}
.gr .st{display:flex;height:13px;border-radius:7px;overflow:hidden}.gr .st i{display:block;height:100%}
.gr .leg{font-size:10px;color:#5b6b74;display:flex;gap:14px;margin:5px 0}.gr .leg s{display:inline-block;width:10px;height:10px;border-radius:2px;margin-left:4px;text-decoration:none}
.gr .nbox{min-height:64px;border:1.5px dashed #c2c1c1;border-radius:9px;padding:5px 12px;margin:6px 0;font-size:11.5px;color:#15445a}
.gr .sig{margin-top:10px;margin-bottom:0;padding-top:6px;border-top:1px solid #d5dde1;display:flex;justify-content:space-around;font-size:11px;color:#5b6b74;text-align:center}
.gr .sig>div{flex:1;padding:0 12px}.gr .sig b{display:block;color:#15445a;font-size:12.5px;margin-top:3px;min-height:18px}.gr .sig .ln{display:block;border-bottom:1px solid #8a979f;height:24px;margin:2px 0 3px}.gr .sig small{font-size:9px;color:#8a979f}
@media print{.gr{padding:0}.gr .pdf-avoid-break{break-inside:avoid;page-break-inside:avoid}.gr h2{break-after:avoid;page-break-after:avoid}}
`;

/* شعار وزارة التعليم: يُقرأ مرة ويُخزَّن (data URL) ليُطبع مع النص؛ فشل تحميله لا يمنع التقرير (خانة فارغة) */
let gradeReportLogoCache = null;
async function gradeReportLogoData(){
  if(gradeReportLogoCache !== null) return gradeReportLogoCache;
  try{
    const res = await fetch('moe-logo.png');
    if(!res.ok) throw new Error('logo');
    const blob = await res.blob();
    gradeReportLogoCache = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob); });
  } catch(e){ gradeReportLogoCache = ''; }
  return gradeReportLogoCache;
}

function grBlock(inner){ return inner ? `<div class="pdf-avoid-break">${inner}</div>` : ''; }
const grH2 = t => `<h2>${t}</h2>`;

function grHead(ctx, prefs, title, sub){
  const semester = Number(ctx.semester) === 2 ? 'الثاني' : 'الأول';
  const school = gradeReportSchool(prefs) ? escapeHtml(gradeReportSchool(prefs)) : 'اسم المدرسة';
  const subject = gradeReportSubject(prefs);
  return `<div class="hd">${ctx.logo ? `<img src="${ctx.logo}" alt="">` : '<span class="lg"></span>'}
    <div class="t"><small>${school}</small><h1>${escapeHtml(title)}</h1><div class="m">${subject ? `<b>المادة: ${escapeHtml(subject)}</b> | ` : ''}${sub}</div></div>
    <div class="mt">${grn(ctx.date)}<br>الفصل الدراسي ${semester}<br>العام ${grn(escapeHtml(ctx.year || ''))}</div></div>`;
}

function grKpis(list){
  const val = v => /[\u0600-\u06FF]/.test(String(v)) ? v : grn(v);
  return `<div class="kp">${list.map(([v, l, s, c]) => `<div class="${c || ''}"><b>${val(v)}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;
}

/* مستويات الطلاب: جدول (الحد · العدد · النسبة) + شريط واحد — ضعاف · متوسطون · متفوقون */
function grLevels(s){
  const r = s.rules, t = s.recorded || 1;
  const lowN = s.groups.low.length, midN = s.mid.length, topN = s.groups.top.length;
  const pc = n => grn(Math.round(100 * n / t) + '%');
  const row = (cls, label, limit, n) => `<tr><td><span class="cp ${cls}">${label}</span></td><td class="n">${limit}</td><td class="n"><b>${grn(n)}</b></td><td class="n">${pc(n)}</td></tr>`;
  return `<table><tr><th>المستوى</th><th class="n">الحد</th><th class="n">العدد</th><th class="n">النسبة</th></tr>` +
    row('w', 'ضعاف', `أقل من ${r.pass}%`, lowN) + row('m', 'متوسطون', `من ${r.pass}% إلى أقل من ${r.top}%`, midN) +
    row('t', s.topIsFallback ? 'الأعلى درجات' : 'متفوقون', s.topIsFallback ? 'أعلى 3 درجات' : `${r.top}% فأكثر`, topN) +
    `</table><div class="lb"><i class="g" style="flex:${topN}"></i><i class="bl" style="flex:${midN}"></i><i class="tn" style="flex:${lowN}"></i></div>`;
}

/* البنود: جدول بمتوسط كل بند وشريط صغير مقابل خط حدّ الضعاف */
function grItemsTable(items, onId, rules){
  const tone = p => p < rules.pass ? 'tn' : p >= rules.top ? 'g' : 'bl';
  return `<table><tr><th>البند</th><th class="n">المتوسط</th><th class="n">النسبة</th><th>مقابل خط ${rules.pass}%</th></tr>` +
    items.map(x => `<tr${onId === x.id ? ' class="on"' : ''}><td>${escapeHtml(x.name)}${onId === x.id ? ' <span class="cn">المحلَّل</span>' : ''}</td><td class="n">${grn(formatScore(x.avg) + ' / ' + formatScore(x.max))}</td><td class="n"><b>${grn(x.avgPct + '%')}</b></td><td style="width:30%"><div class="mb"><i class="${tone(x.avgPct)}" style="width:${Math.min(100, x.avgPct)}%"></i><u style="right:${rules.pass}%"></u></div></td></tr>`).join('') + '</table>';
}

/* التعليق التربوي بحسب اختيار المعلم؛ فارغ = لا يُكتب */
function grNotes(notes, prefs){
  const list = arr => arr.map(x => `<div class="li"><span class="mk">•</span><span class="tx">${x}</span></div>`).join('');
  const nlist = arr => arr.map((x, i) => `<div class="li"><span class="mk">${grn((i + 1) + '.')}</span><span class="tx">${x}</span></div>`).join('');
  let html = '';
  if(prefs.notes.reading && notes.reading.length) html += grBlock(grH2('قراءة تربوية للنتائج') + `<div class="nb gr2">${notes.reading.join(' ')}</div>`);
  if(prefs.notes.strengths && notes.strengths.length) html += grBlock(grH2('نقاط القوة') + `<div class="nb gr2">${list(notes.strengths)}</div>`);
  if(prefs.notes.weaknesses && notes.weaknesses.length) html += grBlock(grH2('نقاط الضعف وفرص التحسين') + `<div class="nb w">${list(notes.weaknesses)}</div>`);
  if(prefs.notes.plans && notes.plans.length) html += grBlock(grH2('الخطط العلاجية والتوصيات') + `<div class="nb">${nlist(notes.plans)}</div>`);
  return html;
}

function grSig(prefs, third, thirdName){
  const cell = (label, name) => `<div>${escapeHtml(label)}<b>${name ? escapeHtml(name) : ''}</b><i class="ln"></i><small>التوقيع</small></div>`;
  return `<div class="sig pdf-avoid-break">${third ? cell(third, thirdName || '') : ''}${cell('معلم المادة', gradeReportTeacherName(prefs))}${cell('وكيل شؤون الطلاب', prefs.vice)}</div>`;
}

/* قوائم الأسماء بثلاثة أعمدة: الضعاف والمتفوقون في عمود، والمتوسطون في عمودين (عمود واحد إن قلّوا) */
function grNamesCols(low, mid, top){
  const rowOf = r => `<tr><td>${escapeHtml(r.name)}${r.partial ? ' <b style="color:#7258a4">*</b>' : ''}</td><td class="n">${grn(formatScore(r.points) + ' / ' + formatScore(r.recordedMax))}</td><td class="n">${grn(Math.round(r.pct) + '%')}</td></tr>`;
  const head = '<tr><th>اسم الطالب</th><th class="n">الدرجة</th><th class="n">النسبة</th></tr>';
  const tbl = (title, cls, list) => list.length ? `<div class="gw"><div class="gh ${cls}"><b>${title}</b><span>${grn(list.length)}</span></div><table>${head}${list.map(rowOf).join('')}</table></div>` : '';
  if(!low.length && !mid.length && !top.length) return '';
  const half = Math.ceil(mid.length / 2);
  const midCols = mid.length > 10 ? [mid.slice(0, half), mid.slice(half)] : [mid];
  const cols = [tbl('الضعاف', 'w', low) + tbl('المتفوقون', 't', top)].concat(midCols.map((l, i) => tbl(i ? 'المتوسطون (تابع)' : 'المتوسطون', 'm', l)));
  return grBlock(grH2('قوائم الطلاب') + `<div class="c3">${cols.map(c => `<div>${c}</div>`).join('')}</div>`);
}

/* تنبيه ظاهر تحت قوائم الأسماء: ترتيبها بالنسبة، ومن رُصد له جزء من الأعمدة مقامه أقل */
function grNamesNote(lists, displayMax){
  const partial = [].concat.apply([], lists).filter(r => r.partial).length;
  return grBlock(`<div class="nb w">الأسماء مرتّبة بالنسبة المئوية من الأدنى.${partial ? ` <b style="color:#a85d3a">*</b> ${partial === 1 ? 'طالب واحد من المذكورين رُصد له' : `${grn(partial)} من المذكورين رُصد لهم`} جزء من الأعمدة فقط، فمقام درجته أقل من ${grn(formatScore(displayMax))} (الدرجة الكاملة)، ونسبته محسوبة مما رُصد له.` : ''}</div>`);
}

/* مقارنة بالفصل السابق: ctx.prev = { sum, names: Map } */
function grCompare(prev, withNames){
  if(!prev) return '';
  const sum = prev.sum;
  const stable = sum.compared - sum.up.length - sum.down.length;
  let html = grH2('مقارنة بالفصل السابق') + grKpis([
    [sum.up.length, 'تحسّنوا', '', ''], [stable, 'مستقرون', '', 'n'], [sum.down.length, 'تراجعوا', '', sum.down.length ? 'r' : 'n'],
    [(sum.avgDelta > 0 ? '+' : '') + sum.avgDelta, 'متوسط التغيّر', 'نقطة مئوية', 'b']]);
  if(withNames){
    const rowOf = r => `<tr><td>${escapeHtml(prev.names.get(r.id) || '')}</td><td class="n">${grn(Math.round(r.prev) + '% → ' + Math.round(r.now) + '%')}</td><td class="n">${grn((r.delta > 0 ? '+' : '') + r.delta)}</td></tr>`;
    const tbl = (t, list) => list.length ? `<div><table><tr><th>${t}</th><th class="n">من → إلى</th><th class="n">التغيّر</th></tr>${list.map(rowOf).join('')}</table></div>` : '';
    html += `<div class="two">${tbl('الأكثر تراجعًا', sum.down.slice(0, 8))}${tbl('الأكثر تحسنًا', sum.up.slice(0, 8))}</div>`;
  }
  return grBlock(html + `<div class="fn">قورن ${grn(sum.compared)} طالبًا؛ التغيّر المعتبر ${grn(GRADE_COMPARE_RULES.changePct)} نقاط مئوية فأكثر، والنسبة مما رُصد في كل فصل.</div>`);
}

function grFootnote(s){
  const r = s.rules;
  let t = `معيار المستويات: الضعاف أقل من ${r.pass}%، والمتفوقون ${r.top}% فأكثر، والمتوسطون ما بينهما. `;
  if(s.missing) t += `المحلَّل ${s.recorded} من ${s.total} طالبًا؛ من لم يُرصد له لا يدخل في الحساب (لا يُعدّ صفرًا). `;
  if(s.partial) t += `${s.partial} طالبًا رُصد لهم جزء من الأعمدة فنسبة كل منهم مما رُصد له. `;
  return `<div class="fn">${t}تحليل للدرجات المرصودة فقط.</div>`;
}

/* خانة «ملاحظات» بخط منقّط يكتب فيها المعلم أو الوكيل بيده */
function grNotesBox(){ return '<div class="nbox pdf-avoid-break"><b>ملاحظات</b></div>'; }

/* تقرير الشعبة (المجموع) أو بند واحد: a = crmGradeAnalysis، v = gradeAnalysisView(a) */
function gradeReportSectionHtml(a, v, prefs, ctx){
  const s = v.stats, r = s.rules;
  const isTotal = a.key === 'total';
  const items = gradeReportItems(a.g, a.students);
  const notes = gradeReportSectionNotes({ s, displayMax: v.displayMax, items, isTotal, colLabel: v.colLabel });
  const max = formatScore(v.displayMax);
  const kp = [[(s.avgPct === null ? '—' : s.avgPct + '%'), 'متوسط التحصيل', `${formatScore(s.avg)} من ${max}`, 'b']];
  if(prefs.show.stats) kp.push([formatScore(s.median), 'الوسيط', `من ${max}`, 'n'], [`${formatScore(s.min)} – ${formatScore(s.max)}`, 'أدنى وأعلى درجة', '', 'n']);
  kp.push([s.recorded, 'عدد الطلاب', [s.missing ? `من ${s.total} (لم يُرصد ${s.missing})` : '', s.partial ? `${s.partial} رُصد لهم جزء` : ''].filter(Boolean).join(' · '), 'n']);
  const lvBlock = prefs.show.levels ? `<div><h2>مستويات الطلاب</h2>${grLevels(s)}</div>` : '';
  const itBlock = prefs.show.items && items.length ? `<div><h2>${isTotal ? 'متوسط درجات البنود' : 'درجات البنود (متوسط الشعبة)'}</h2>${grItemsTable(items, isTotal ? null : a.key, r)}<div class="fn">الخط الأسود = ${r.pass}% من الدرجة.${isTotal ? ' المجموع بعد تطبيق أوزان الدرجات؛ لذلك لا يساوي مجموع الدرجات العظمى للبنود.' : ''}</div></div>` : '';
  const mid = lvBlock || itBlock ? grBlock(`<div class="two">${lvBlock}${itBlock}</div>`) : '';
  const analysed = isTotal ? '' : `<h2>البند المحلَّل: ${escapeHtml(v.colLabel)} (من ${grn(max)})</h2>`;
  const topList = s.topIsFallback ? [] : s.groups.top;
  const names = ctx.withNames ? grNamesNote([s.groups.low, s.mid, topList], v.displayMax) + grNamesCols(s.groups.low, s.mid, topList) : '';
  const sub = escapeHtml(a.label) + ' | ' + (isTotal ? `المجموع من ${grn(max)}` : 'تحليل بند واحد');
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج الدرجات — الشعبة', sub)}${analysed}${grKpis(kp)}${mid}${names}${prefs.show.compare ? grCompare(ctx.prev, ctx.withNames) : ''}${grNotes(notes, prefs)}${grFootnote(s)}${grNotesBox()}${grSig(prefs)}</div>`;
}

/* تقرير مجموعة الشعب: d = { gradeName, key, colLabel, secs:[{ label, s, levels, items }], pooled, displayMax } */
function gradeReportGroupHtml(d, prefs, ctx){
  const rules = d.pooled.rules;
  const p = d.pooled;
  const total = d.secs.reduce((a, x) => a + x.s.recorded, 0);
  const lowPct = p.recorded ? Math.round(100 * p.groups.low.length / p.recorded) : 0;
  const kpis = grKpis([
    [(p.avgPct === null ? '—' : p.avgPct + '%'), 'متوسط التحصيل العام', `(${d.secs.length} شعب)`, 'b'],
    [p.groups.low.length, 'عدد الضعاف', `${lowPct}% من الطلاب`, 'r'],
    [total, 'عدد الطلاب', '', 'n'], [d.secs.length, 'عدد الشعب', '', 'n']]);
  const stk = lv => { const t = (lv.top + lv.mid + lv.low) || 1; return `<div class="st"><i class="g" style="width:${100 * lv.top / t}%"></i><i class="bl" style="width:${100 * lv.mid / t}%"></i><i class="tn" style="width:${100 * lv.low / t}%"></i></div>`; };
  const table = grBlock(grH2('مقارنة الشعب') + `<table><tr><th>الشعبة</th><th class="n">الطلاب</th><th class="n">المتوسط</th><th>توزيع المستويات</th><th class="n">الضعاف</th></tr>${d.secs.map(x =>
    `<tr><td><b>${escapeHtml(x.label)}</b></td><td class="n">${grn(x.s.recorded)}</td><td class="n">${grn(formatScore(x.s.avg) + ' (' + x.s.avgPct + '%)')}</td><td style="width:170px">${stk(x.levels)}</td><td class="n">${grn(x.s.groups.low.length + ' (' + Math.round(100 * x.s.groups.low.length / x.s.recorded) + '%)')}</td></tr>`).join('')}</table>` +
    '<div class="leg"><span><s class="g"></s>متفوقون</span><span><s class="bl"></s>متوسطون</span><span><s class="tn"></s>ضعاف</span></div>');
  const levels = prefs.show.levels ? grBlock(grH2('مستويات طلاب المجموعة') + grLevels(p)) : '';
  const stats = prefs.show.stats ? grBlock(grH2('المؤشرات الإحصائية للمجموعة') + `<div class="sm"><div><b>${grn(formatScore(p.min))}</b>أقل درجة</div><div><b>${grn(formatScore(p.max))}</b>أعلى درجة</div><div><b>${grn(formatScore(p.median))}</b>الوسيط</div><div><b>${grn(formatScore(p.avg))}</b>المتوسط</div></div>`) : '';
  let matrix = '';
  if(prefs.show.items){
    const names = [];
    d.secs.forEach(x => x.items.forEach(i => { if(!names.some(n => n.key === normalizeGradeColumnName(i.name))) names.push({ key: normalizeGradeColumnName(i.name), name: i.name }); }));
    if(names.length){
      const cell = (x, n) => { const i = x.items.find(q => normalizeGradeColumnName(q.name) === n.key); return i ? `<td class="n" style="color:${i.avgPct < rules.pass ? '#7258a4' : i.avgPct >= rules.top ? '#0a8f5b' : '#15445a'};font-weight:700">${grn(i.avgPct + '%')}</td>` : '<td class="n">—</td>'; };
      matrix = grBlock(grH2('مقارنة الشعب في كل بند (متوسط النسبة)') + `<table><tr><th>البند</th>${d.secs.map(x => `<th class="n">${escapeHtml(x.label)}</th>`).join('')}</tr>${names.map(n => `<tr><td>${escapeHtml(n.name)}</td>${d.secs.map(x => cell(x, n)).join('')}</tr>`).join('')}</table>`);
    }
  }
  const notes = gradeReportGroupNotes({ secs: d.secs });
  const sub = `${escapeHtml(d.gradeName)} | ${d.key === 'total' ? `المجموع من ${grn(formatScore(d.displayMax))}` : 'بند: ' + escapeHtml(d.colLabel)}`;
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج المجموعة — شعب الصف', sub)}${kpis}${table}${levels}${stats}${matrix}${grNotes(notes, prefs)}${grFootnote(p)}${grNotesBox()}${grSig(prefs)}</div>`;
}

/* تقرير طالب: d من gradeReportStudentData */
function gradeReportStudentHtml(d, prefs, ctx){
  const r = d.rules;
  const diff = d.pts === null || d.classPts === null ? null : Math.round((d.pts - d.classPts) * 10) / 10;
  const state = d.pct === null ? '—' : d.pct < r.pass ? 'ضعيف' : d.pct >= r.top ? 'متفوق' : 'متوسط';
  const kpis = grKpis([
    [d.pts === null ? '—' : formatScore(d.pts), `مجموع الدرجات من ${formatScore(d.max)}`, '', 'n'],
    [d.pct === null ? '—' : Math.round(d.pct) + '%', 'النسبة المئوية', '', ''],
    [diff === null ? '—' : (diff > 0 ? '+' : '') + formatScore(diff), 'الفارق عن متوسط الشعبة', d.classPts === null ? '' : `(${formatScore(Math.round(d.classPts * 100) / 100)})`, diff !== null && diff < 0 ? 'r' : 'b'],
    [state, 'المستوى', '', 'n']]);
  const itemsHtml = prefs.show.items ? grBlock(grH2('درجات البنود مقارنةً بمتوسط الشعبة') +
    '<div class="leg"><span><s class="g"></s>متفوق</span><span><s class="bl"></s>متوسط</span><span><s class="tn"></s>ضعيف</span><span>▏ علامة متوسط الشعبة</span></div>' +
    d.items.map(x => {
      if(x.score === null) return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"></div><div class="v">لم يُرصد</div></div>`;
      const dl = x.classPct === null ? null : Math.round(x.pct - x.classPct);
      return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"><i class="${gradeReportItemTone(x.pct, r)}" style="width:${Math.min(100, x.pct)}%"></i>${x.classPct === null ? '' : `<u style="right:${Math.min(100, x.classPct)}%"></u>`}</div><div class="v">${grn(formatScore(x.score) + ' / ' + formatScore(x.max))} ${dl === null ? '' : `<span style="font-weight:700;color:${dl >= 0 ? '#0a8f5b' : '#a85d3a'}">${dl >= 0 ? '▲' : '▼'} ${grn(Math.abs(dl) + '%')}</span>`}</div></div>`;
    }).join('') + '<div class="fn">ما لم يُرصد لا يُحسب على الطالب.</div>') : '';
  const notes = gradeReportStudentNotes({ pts: d.pts, max: d.max, pct: d.pct, classPts: d.classPts, classPct: d.classPct, items: d.items, rules: r });
  const meta = { logo: ctx.logo, date: ctx.date, year: d.year, semester: d.semester };
  const to = ctx.to ? String(ctx.to) : '';
  /* الجهة الموجَّه إليها: سطر تحت العنوان + خانة توقيعها (وكيل الشؤون له خانة ثابتة أصلًا) */
  const toLine = to ? `<br><b>موجّه إلى: ${escapeHtml(to)}</b>` : '';
  const sigTo = to === 'وكيل شؤون الطلاب' ? '' : (to || 'ولي الأمر');
  /* اسم الجهة في توقيعها إن كان المعلم أدخله مرة (الموجه الطلابي · وكيل شؤون المعلمين) */
  const sigName = to === 'الموجه الطلابي' ? prefs.counselor : to === 'وكيل شؤون المعلمين' ? prefs.staff : '';
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(meta, prefs, 'تقرير أداء طالب', `${escapeHtml(d.name)} | ${escapeHtml(d.label)} | المجموع من ${grn(formatScore(d.max))}${toLine}`)}${kpis}${itemsHtml}${grNotes(notes, prefs)}<div class="fn">معيار المستويات: الضعاف أقل من ${r.pass}%، والمتفوقون ${r.top}% فأكثر، والمتوسطون ما بينهما.</div>${grSig(prefs, sigTo, sigName)}</div>`;
}

/* ============ التصدير ============ */
let gradeReportBusy = false;

/* ===== الطباعة / الحفظ كـPDF من المتصفح: نص حقيقي (يرسمه المتصفح بخطه) =====
   - لا صورة ولا مكتبات PDF: المتصفح يرسم العربية بنفسه (تشكيل واتجاه صحيحان) والنص قابل للتحديد والبحث.
   - الترويسة المصغّرة (من الصفحة 2) والترقيم في هوامش @page (يدعمها Chrome الحديث؛ غيره يتجاهلها).
   - تُنظَّف #printArea بعد الطباعة حتى لا يبقى @page هذا يؤثر في طباعة أخرى.
   - عنوان الصفحة يصير اسم الملف المقترح عند «حفظ كـPDF»، ثم يُعاد. */
function gradeReportPrintCss(mark){
  const q = t => String(t || '').replace(/[\\"]/g, '').replace(/[\r\n]+/g, ' ');
  const box = 'font-family:Cairo,sans-serif;font-size:8.5pt;color:#55646f';
  const top = mark && (mark.right || mark.left)
    ? `@top-right{content:"${q(mark.right)}";${box}}@top-left{content:"${q(mark.left)}";${box}}` : '';
  return `@page{size:A4;margin:15mm 15mm 14mm;${top}@bottom-center{content:"صفحة " counter(page) " / " counter(pages);${box}}}`
    + '@page :first{@top-right{content:none}@top-left{content:none}}'
    + '@media print{#printArea.wrap{max-width:none;padding-bottom:0}.gr-pg{break-after:page;page-break-after:always}.gr-pg:last-child{break-after:auto;page-break-after:auto}}';
}

function gradeReportMark(prefs, title, label){
  const subject = gradeReportSubject(prefs);
  return { right: `${title} · ${label}${subject ? ' · ' + subject : ''}`, left: gradeReportSchool(prefs) };
}

let gradeReportSavedTitle = null;
function gradeReportPrint(html, mark, title){
  const area = document.getElementById('printArea');
  if(!area) return;
  area.innerHTML = `<style>${gradeReportPrintCss(mark)}</style>` + html;
  if(title){
    if(gradeReportSavedTitle === null) gradeReportSavedTitle = document.title;
    document.title = title;
  }
  const clear = () => {
    window.removeEventListener('afterprint', clear);
    if(area.querySelector('.gr')) area.innerHTML = '';
    if(gradeReportSavedTitle !== null){ document.title = gradeReportSavedTitle; gradeReportSavedTitle = null; }
  };
  window.addEventListener('afterprint', clear);
  printNow();
}

/* build() يُرجع { html, mark } أو '' (توقّف). التحميل غير المتزامن (شعب أخرى/فصل سابق) داخل build */
async function gradeReportRun(btn, build, filename, busyText){
  if(gradeReportBusy) return;
  gradeReportBusy = true;
  beginExportBusy(btn, busyText || 'جارٍ التجهيز...');
  try{
    const out = await build();
    if(!out || !out.html) return;
    if(document.fonts && document.fonts.load){
      try{ await Promise.all(['400', '700', '800'].map(w => document.fonts.load(`${w} 12px 'Cairo'`, 'شاهد الأداء الوظيفي'))); } catch(e){ /* لا يمنع الطباعة */ }
    }
    gradeReportPrint(out.html, out.mark, filename);
  } catch(err){
    showToast('تعذّر تجهيز التقرير: ' + (err.message || ''), 'error');
  } finally {
    gradeReportBusy = false;
    endExportBusy(btn);
  }
}

const gradeReportFile = (prefix, label) => `${prefix}-${String(label).replace(/[\\\/:*?"<>|\s]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;

/* من نافذة التحليل: تقرير الشعبة/البند، أو مجموعة شعب الصف */
async function exportGradeReport(btn){
  const a = crmGradeAnalysis;
  if(!a || gradeReportBusy) return;
  const prefs = gradeReportPrefsForRun(gradeReportPrefsNow(), a.withNotes);
  const scope = a.scope === 'group' ? 'group' : 'section';
  const withNames = !!a.withNames;
  const caps = { performance: gradeCap('performance'), tests: gradeCap('tests') };
  const testsOn = appToolOn('tests');
  const sec = crmSectionById(a.g.sectionId);
  const level = typeof crmGradeLevels !== 'undefined' && sec ? crmGradeLevels.find(x => x.id === sec.grade_level_id) : null;
  const gradeName = level ? level.name : 'الصف';
  await gradeReportRun(btn, async () => {
    const logo = await gradeReportLogoData();
    const base = { logo, date: new Date().toISOString().slice(0, 10), year: a.g.year, semester: a.g.semester, withNames };
    if(scope === 'section'){
      const v = gradeAnalysisView(a);
      if(!v.stats.recorded){ showToast('لا درجات مرصودة لتصديرها', 'error'); return ''; }
      let prev = null;
      if(prefs.show.compare){
        const term = previousGradeTerm(a.g.year, a.g.semester);
        const res = term ? (await loadGradeSheetsRaw([a.g.sectionId], term.year, term.semester))[0] : null;
        if(crmGradeAnalysis !== a) return '';
        const spec = gradeSpecOf(a);
        const prevMap = res && hasBaseGradeColumns(res.columns) ? gradePctMap(res, a.students, spec, caps, testsOn) : null;
        const nowMap = gradePctMap(a.g, a.students, spec, caps, testsOn);
        const sum = prevMap && prevMap.size && nowMap ? gradeChangeSummary(nowMap, prevMap) : null;
        if(sum && sum.compared) prev = { sum, names: new Map(a.students.map(s => [s.id, s.full_name])) };
        else showToast('لا كشف مقارن في الفصل السابق — حُذف قسم المقارنة', 'ok');
      }
      return { html: gradeReportSectionHtml(a, v, prefs, Object.assign(base, { prev })), mark: gradeReportMark(prefs, 'تحليل نتائج الدرجات', a.label) };
    }
    /* مجموعة شعب الصف */
    const sibIds = gradeSiblingSectionIds(a.g);
    if(!sibIds.length){ showToast('لا شعب أخرى لهذا الصف', 'error'); return ''; }
    const ids = [a.g.sectionId].concat(sibIds);
    const sheets = await loadGradeSheetsRaw(ids, a.g.year, a.g.semester);
    if(crmGradeAnalysis !== a) return '';
    const spec = gradeSpecOf(a);
    const secs = [];
    let allRows = [], displayMax = null;
    sheets.filter(sh => hasBaseGradeColumns(sh.columns)).forEach(sh => {
      const students = crmStudentsOfSection(sh.id);
      const res = gradeReportSheetRows(sh, students, spec, caps, testsOn);
      if(!res) return;
      const s = analyzeGradeRows(res.rows, res.displayMax);
      if(!s.recorded) return;
      if(displayMax === null) displayMax = res.displayMax;
      allRows = allRows.concat(res.rows);
      secs.push({ id: sh.id, label: crmSectionLabel(sh.id), s, levels: gradeReportLevels(res.rows, s.rules), items: gradeReportItems(sh, students) });
    });
    if(secs.length < 2){ showToast('لا بيانات مرصودة كافية في شعب الصف للمقارنة', 'error'); return ''; }
    secs.sort((p, q) => q.s.avgPct - p.s.avgPct);
    const col = spec.total ? null : a.g.columns.find(c => c.id === a.key);
    return { html: gradeReportGroupHtml({ gradeName, key: a.key, colLabel: col ? col.name : 'المجموع', secs, pooled: analyzeGradeRows(allRows, displayMax), displayMax }, prefs, base), mark: gradeReportMark(prefs, 'تحليل نتائج المجموعة', gradeName) };
  }, scope === 'group' ? gradeReportFile('تقرير-مجموعة-شعب', gradeName) : gradeReportFile('تقرير-درجات', a.label));
}

/* تقرير طالب واحد (لولي الأمر): من الكشف المحمَّل g — لا استعلام جديد */
async function gradeReportStudentRun(g, id, btn, busyText, to){
  if(!g || !id || gradeReportBusy) return;
  const d = gradeReportStudentData(g, id);
  if(!d) return;
  const prefs = gradeReportPrefsNow();
  await gradeReportRun(btn, async () => {
    return { html: gradeReportStudentHtml(d, prefs, { logo: await gradeReportLogoData(), date: new Date().toISOString().slice(0, 10), to }), mark: gradeReportMark(prefs, 'تقرير أداء طالب', d.name) };
  }, gradeReportFile('تقرير-طالب', d.name), busyText);
}

/* كل طلاب الشعبة في ملف PDF واحد: تقرير لكل طالب بصفحة جديدة، ومن لم تُرصد درجاته يُستثنى */
async function exportCrmAllStudentReports(btn, to, ids, scopeLabel){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId || gradeReportBusy) return;
  const g = a.g;
  const prefs = gradeReportPrefsNow();
  const date = new Date().toISOString().slice(0, 10);
  const pool = ids ? a.students.filter(st => ids.has(st.id)) : a.students;
  const list = pool.map(st => gradeReportStudentData(g, st.id)).filter(d => d && d.pts !== null);
  if(!list.length){ showToast('لا طلاب لهم درجات مرصودة', 'error'); return; }
  const skipped = ids ? 0 : a.students.length - list.length;
  if(skipped) showToast(`${skipped} من الطلاب بلا درجات مرصودة — لم تُضمَّن تقاريرهم`, 'ok');
  await gradeReportRun(btn, async () => {
    const logo = await gradeReportLogoData();
    return { html: list.map(d => `<div class="gr-pg">${gradeReportStudentHtml(d, prefs, { logo, date, to })}</div>`).join(''), mark: gradeReportMark(prefs, 'تقارير أداء الطلاب', a.label + (scopeLabel ? ' · ' + scopeLabel : '')) };
  }, gradeReportFile(scopeLabel ? 'تقارير-' + scopeLabel : 'تقارير-الطلاب', a.label), btn && to ? '…' : undefined);
}

/* من صفحة الطالب في الكشف */
function exportCrmStudentReport(btn){
  return gradeReportStudentRun(crmGrades, crmGradeStudentId, btn);
}

/* من قائمة الطلاب داخل نافذة التحليل: نقرة واحدة بجانب الاسم */
function exportCrmStudentReportFor(id, btn, to){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId) return;
  return gradeReportStudentRun(a.g, id, btn, '…', to);
}

/* ============ خيارات التقارير (إعدادات المعلم) ============ */
let gradeReportDraft = null; /* { host: 'ga' | 'cust', school, teacher, vice, show, notes, error, saving } */

function openGradeReportEditor(host){
  const p = gradeReportPrefsNow();
  gradeReportDraft = { host, school: p.school, teacher: p.teacher, vice: p.vice, staff: p.staff, counselor: p.counselor, subject: p.subject, show: Object.assign({}, p.show), notes: Object.assign({}, p.notes), error: '', saving: false };
  if(host === 'ga'){
    const a = crmGradeAnalysis;
    if(!a) return;
    a.reportEdit = true;
    paintCrmGradeAnalysis();
  } else {
    showInfoModal('<div id="grEditorBody" class="crm-ga"></div>', '420px');
    paintGradeReportEditor();
  }
}

function paintGradeReportEditor(){
  const d = gradeReportDraft;
  if(!d) return;
  if(d.host === 'ga') return paintCrmGradeAnalysis();
  const box = document.getElementById('grEditorBody');
  if(box) box.innerHTML = gradeReportEditorHtml();
}

function gradeReportEditorHtml(){
  const d = gradeReportDraft;
  if(!d) return '';
  const auto = gradeReportTeacherName({ teacher: '' });
  const fld = (k, label, ph) => `<label class="gr-fld"><span>${label}</span><input class="goal-input" type="text" maxlength="${GRADE_REPORT_NAME_MAX}" id="grFld_${k}" value="${escapeHtml(d[k])}" placeholder="${escapeHtml(ph || '')}" oninput="gradeReportDraftText('${k}', this.value)"></label>`;
  const chk = (grp, k, label) => `<label class="crm-ga-chk"><input type="checkbox"${d[grp][k] ? ' checked' : ''} onchange="gradeReportDraftFlag('${grp}', '${k}', this.checked)"> ${label}</label>`;
  return `<div class="crm-ga-sec">خيارات التقارير</div>
    <p class="crm-ga-fine" style="margin-top:0">تُطبَّق على كل تقاريرك: الشعبة والبند ومجموعة الشعب والطالب.</p>
    ${fld('school', 'اسم المدرسة', gradeReportSchool({ school: '' }) ? 'تلقائي: ' + gradeReportSchool({ school: '' }) : 'مثال: ثانوية بدر')}
    ${fld('teacher', 'اسم المعلم', auto ? 'تلقائي: ' + auto : 'اسم المعلم')}
    ${fld('vice', 'وكيل شؤون الطلاب', 'يظهر في التوقيع')}
    ${fld('staff', 'وكيل شؤون المعلمين', 'يظهر في توقيعه عند التوجيه إليه')}
    ${fld('counselor', 'الموجه الطلابي', 'يظهر في توقيعه عند التوجيه إليه')}
    <p class="crm-ga-fine">تُدخلها مرة واحدة فتُحفظ وتظهر في كل تقاريرك، وتعدّلها متى شئت.</p>
    <details class="gr-more"><summary>خيارات إضافية: المادة · ما يُطبع</summary>
    ${fld('subject', 'المادة', gradeReportSubject({ subject: '' }) ? 'تلقائي: ' + gradeReportSubject({ subject: '' }) : 'مثال: الفيزياء')}
    <div class="crm-ga-sec" style="margin-top:12px">ما يُطبع في التقرير</div>
    ${Object.keys(GRADE_REPORT_SHOW_LABELS).map(k => chk('show', k, GRADE_REPORT_SHOW_LABELS[k])).join('')}
    <div class="crm-ga-sec" style="margin-top:12px">التعليق التربوي (اختياري — مطفأ افتراضيًا)</div>
    ${Object.keys(GRADE_REPORT_NOTE_LABELS).map(k => chk('notes', k, GRADE_REPORT_NOTE_LABELS[k])).join('')}
    </details>
    <div class="crm-ga-err" id="grEditorErr">${escapeHtml(d.error)}</div>
    <button type="button" class="btn btn-primary" id="grEditorSave" style="width:100%" ${d.saving ? 'disabled' : ''} onclick="saveGradeReportPrefs()">حفظ</button>
    <div class="crm-ga-eacts"><button type="button" class="crm-ga-link" onclick="gradeReportEditorReset()">الافتراضي</button><button type="button" class="crm-ga-link" onclick="gradeReportEditorCancel()">إلغاء</button></div>`;
}

function gradeReportDraftText(k, value){ if(gradeReportDraft) gradeReportDraft[k] = value; }
function gradeReportDraftFlag(grp, k, on){ if(gradeReportDraft) gradeReportDraft[grp][k] = !!on; }

function gradeReportEditorReset(){
  const d = gradeReportDraft;
  if(!d) return;
  Object.assign(d, gradeReportDefaultCopy(), { host: d.host, error: '', saving: false });
  paintGradeReportEditor();
}

function gradeReportEditorCancel(){
  const d = gradeReportDraft;
  gradeReportDraft = null;
  if(d && d.host === 'ga' && crmGradeAnalysis){ crmGradeAnalysis.reportEdit = null; paintCrmGradeAnalysis(); }
  else if(d) closeCrmModal();
}

async function persistGradeReportPrefs(p){
  const uid = currentUser.id;
  const n = normalizeReportPrefs(p);
  const next = normalizeFeatures(appFeatures);
  /* الافتراضي لا يُخزَّن: غياب المفتاح = الافتراضي */
  if(n) next.reportPrefs = n; else delete next.reportPrefs;
  appFeatures = next;
  await saveAppFeatures();
  if(!currentUser || currentUser.id !== uid) return 'تغيّر الحساب';
  const saved = normalizeReportPrefs(appFeaturesSaved.reportPrefs) || GRADE_REPORT_DEFAULT;
  return JSON.stringify(saved) === JSON.stringify(n || GRADE_REPORT_DEFAULT) ? null : 'تعذّر حفظ الخيارات';
}

async function saveGradeReportPrefs(){
  const d = gradeReportDraft;
  if(!d || d.saving) return;
  const a = crmGradeAnalysis;
  const p = { school: d.school, teacher: d.teacher, vice: d.vice, staff: d.staff, counselor: d.counselor, subject: d.subject, show: d.show, notes: d.notes };
  d.saving = true;
  const btn = document.getElementById('grEditorSave');
  if(btn) btn.disabled = true;
  const err = await persistGradeReportPrefs(p);
  if(gradeReportDraft !== d) return;
  d.saving = false;
  if(err){ d.error = err; paintGradeReportEditor(); return; }
  gradeReportDraft = null;
  if(d.host === 'ga'){
    if(crmGradeAnalysis === a && a){ a.reportEdit = null; a.withNames = gradeReportPrefsNow().show.names; a.withNotes = gradeReportNotesAny(gradeReportPrefsNow()); paintCrmGradeAnalysis(); }
  } else {
    closeCrmModal();
  }
  showToast('حُفظت خيارات التقارير', 'ok');
}
