/* ============================================================
   تقارير الدرجات PDF (شعبة · بند · مجموعة شعب · طالب) بهوية الوزارة
   ------------------------------------------------------------
   - المعلم يختار ما يُطبع (الأقسام) وما يُكتب من تعليق تربوي (قراءة · قوة · ضعف · خطة)،
     وبياناته (المدرسة · المعلم · وكيل شؤون الطلاب) — كلها في features.reportPrefs
     (user_app_settings) وتُطبَّق على كل تقاريره. غياب المفتاح = الافتراضي.
   - التعليق التربوي قواعد شرطية على الأرقام (بلا ذكاء اصطناعي): نفس الأرقام → نفس الكلام.
   - ما لم يُرصد لا يُحسب (لا صفر) — كما في تحليل الدرجات (app-29).
   - كل استعلام لشعب أخرى/فصل سابق يمرّ عبر loadGradeSheetsRaw (فلترة teacher_id صريحة)،
     وكل نص من المستخدم/القاعدة يمرّ عبر escapeHtml.
   ============================================================ */

const GRADE_REPORT_DEFAULT = {
  school: '', teacher: '', vice: '', subject: '',
  show: { levels: true, stats: true, items: true, names: false, compare: false },
  notes: { reading: true, strengths: true, weaknesses: true, plans: true }
};
const GRADE_REPORT_SHOW_LABELS = {
  levels: 'توزيع الطلاب على المستويات',
  stats: 'المؤشرات الإحصائية (أدنى · أعلى · وسيط)',
  items: 'درجات البنود',
  names: 'أسماء الطلاب (يحتاج دعمًا · الحافة · متفوقون)',
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

function gradeReportDefaultCopy(){ return JSON.parse(JSON.stringify(GRADE_REPORT_DEFAULT)); }

/* ما يُقرأ من القاعدة لا يُوثق بشكله. null = الافتراضي (لا يُخزَّن) */
function normalizeReportPrefs(raw){
  if(!raw || typeof raw !== 'object') return null;
  const out = gradeReportDefaultCopy();
  ['school', 'teacher', 'vice', 'subject'].forEach(k => {
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

/* مستويات ثلاثة (متقن · متوسط · دون النجاح) بحدود المعلم، لمن رُصد له فقط */
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
    ? `وجود ${gradeReportCount(s.groups.low.length)} دون حد النجاح (${grn(r.pass + '%')}) يستدعي متابعة علاجية.`
    : `لا طالب دون حد النجاح (${grn(r.pass + '%')}).`);

  if(s.passRate !== null && s.passRate >= 80) strengths.push(`نسبة النجاح مرتفعة (${grn(s.passRate + '%')}).`);
  if(!s.topIsFallback && s.groups.top.length) strengths.push(`حقق ${gradeReportCount(s.groups.top.length)} ${grn(r.top + '%')} فأكثر.`);
  const best = c.isTotal && c.items.length > 1 ? c.items.reduce((m, x) => x.avgPct > m.avgPct ? x : m) : null;
  const worst = c.isTotal && c.items.length > 1 ? c.items.reduce((m, x) => x.avgPct < m.avgPct ? x : m) : null;
  if(best && best.avgPct >= r.pass && (!worst || best.id !== worst.id)) strengths.push(`أقوى البنود: ${escapeHtml(best.name)} (${grn(best.avgPct + '%')}).`);

  if(s.groups.low.length) weaknesses.push(`${gradeReportCount(s.groups.low.length)} (${pct(s.groups.low.length)}) دون حد النجاح.`);
  if(s.groups.edge.length) weaknesses.push(`${gradeReportCount(s.groups.edge.length)} على الحافة بهامش نجاح أقل من ${grn(r.edge)} نقاط مئوية.`);
  if(worst && worst.avgPct < r.pass + r.edge && (!best || best.id !== worst.id)) weaknesses.push(`أضعف البنود: ${escapeHtml(worst.name)} (${grn(worst.avgPct + '%')}).`);

  if(s.groups.low.length){
    plans.push(`مراجعة أوراق الطلاب الأقل من حد النجاح (${grn(s.groups.low.length)}) لتحديد مواطن التعثر لكل طالب.`);
    plans.push('تنفيذ نشاط علاجي قصير ثم اختبار تحقق مماثل في المهارات المستهدفة.');
  }
  if(s.groups.edge.length) plans.push('متابعة الطلاب الواقعين على الحافة لئلا يهبطوا دون حد النجاح.');
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
  reading.push(c.pct < r.pass ? `وهو دون حد النجاح (${grn(r.pass + '%')}) ويحتاج دعمًا.`
    : c.pct < r.pass + r.edge ? 'ونجاحه بهامش قليل، فيحتاج متابعة لئلا يهبط.'
    : c.pct >= r.top ? 'وهو في فئة المتفوقين.' : 'وهو ضمن مستوى النجاح.');
  const up = recorded.filter(x => x.classPct !== null && x.pct - x.classPct >= 10).sort((a, b) => (b.pct - b.classPct) - (a.pct - a.classPct));
  const down = recorded.filter(x => x.pct < r.pass || (x.classPct !== null && x.pct - x.classPct <= -10)).sort((a, b) => a.pct - b.pct);
  up.forEach(x => strengths.push(`${escapeHtml(x.name)} (${grn(Math.round(x.pct) + '%')}) أعلى من متوسط الشعبة (${grn(Math.round(x.classPct) + '%')}).`));
  down.forEach(x => weaknesses.push(`${escapeHtml(x.name)} (${grn(Math.round(x.pct) + '%')})${x.classPct !== null && x.pct < x.classPct ? ` دون متوسط الشعبة (${grn(Math.round(x.classPct) + '%')})` : ''}.`));
  down.slice(0, 2).forEach(x => plans.push(`مراجعة «${escapeHtml(x.name)}» لتحديد المهارات التي فقد فيها الدرجات، وتكليفه بتدريبات قصيرة عليها.`));
  if(c.pct < r.pass) plans.push('التواصل مع ولي الأمر ووضع خطة علاجية بمتابعة أسبوعية.');
  else if(c.pct < r.pass + r.edge) plans.push('متابعة أدائه في التقييم القادم لئلا يهبط دون حد النجاح.');
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
  if(top !== bot) strengths.push(`${escapeHtml(top.label)}: الأعلى تحصيلًا، ونسبة نجاحها ${grn(top.s.passRate + '%')}.`);
  secs.filter(x => x.s.passRate >= 80 && x !== top).forEach(x => strengths.push(`${escapeHtml(x.label)}: نسبة نجاح مرتفعة (${grn(x.s.passRate + '%')}).`));
  secs.filter(x => x.s.groups.low.length).sort((a, b) => b.s.groups.low.length / b.s.recorded - a.s.groups.low.length / a.s.recorded).slice(0, 3)
    .forEach(x => weaknesses.push(`${escapeHtml(x.label)}: ${gradeReportCount(x.s.groups.low.length)} دون حد النجاح (${grn(Math.round(100 * x.s.groups.low.length / x.s.recorded) + '%')}).`));
  if(top !== bot && gap >= 15) plans.push(`عقد جلسة مراجعة لطلاب ${escapeHtml(bot.label)} ومقارنة طرائق التدريس بين الشعب.`);
  plans.push('تنفيذ أنشطة علاجية للطلاب دون حد النجاح في كل شعبة، بحسب قائمة كل شعبة.');
  plans.push('تبادل الأنشطة الناجحة بين الشعب، ثم إعادة المقارنة بعد التقييم التالي.');
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
.gr{font-family:'Cairo',sans-serif;color:#1b2a35;direction:rtl;padding:26px 34px 0;background:#fff;font-size:13px}
.gr *{box-sizing:border-box}
.gr .hd{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #07a869;padding-bottom:10px;margin-bottom:14px}
.gr .hd img{height:56px}.gr .hd .lg{width:150px}
.gr .hd .t{text-align:center;flex:1}.gr .hd .t small{display:block;font-size:11px;color:#55646f}
.gr .hd .t h1{margin:2px 0;font-size:21px;color:#15445a;font-weight:800}.gr .hd .t .m{font-size:11px;color:#55646f}
.gr .hd .mt{width:150px;font-size:10.5px;color:#55646f;text-align:left;line-height:1.7}
.gr .kp{display:flex;gap:9px;margin-bottom:12px}.gr .kp>div{flex:1;border:1px solid #b9e0d0;border-radius:10px;padding:9px 4px;text-align:center;background:#fbfefd}
.gr .kp b{display:block;font-size:22px;color:#0a8f5b;font-weight:800}.gr .kp span{font-size:10.5px;color:#55646f}.gr .kp small{display:block;font-size:9.5px;color:#8a97a0}
.gr .kp .b b{color:#3d7eb9}.gr .kp .n b{color:#15445a}.gr .kp .r b{color:#a85d3a}
.gr h2{font-size:14px;color:#15445a;margin:14px 0 7px;padding-right:9px;border-right:4px solid #07a869;font-weight:800}
.gr .hb{display:flex;align-items:center;margin:5px 0;font-size:11.5px}.gr .hb .a{width:96px;font-weight:700}
.gr .hb .tr{flex:1;height:14px;background:#e9efee;border-radius:8px;overflow:hidden}.gr .hb .tr i{display:block;height:100%;border-radius:8px}
.gr .hb .v{width:118px;text-align:left;font-size:11px;color:#40505b}
.gr .g{background:#07a869}.gr .bl{background:#3d7eb9}.gr .tn{background:#c1b489}
.gr .nb{background:#f1f6f9;border-right:4px solid #3d7eb9;padding:9px 13px;font-size:11.5px;line-height:1.9;margin:8px 0}
.gr .nb.w{background:#fbf6ea;border-color:#c1b489}.gr .nb.gr2{background:#effaf5;border-color:#07a869}
.gr .li{display:flex;gap:8px;align-items:flex-start;margin:1px 0}.gr .li .mk{flex:0 0 20px;color:#0a8f5b;font-weight:800;text-align:right}.gr .li .tx{flex:1}
.gr .fn{font-size:9.5px;color:#7a8791;margin:6px 0;line-height:1.7}
.gr .sm{display:flex;gap:8px;margin:5px 0 8px}.gr .sm>div{flex:1;background:#f4f8f8;border-radius:8px;padding:6px;text-align:center;font-size:10px;color:#55646f}
.gr .sm b{display:block;font-size:15px;color:#15445a}
.gr .it{display:flex;align-items:center;margin:5px 0;font-size:11.5px;padding:3px 8px;border-radius:6px}
.gr .it.on{background:#effaf5;outline:1px solid #b9e0d0}.gr .it .a{width:150px}
.gr .it .tr{flex:1;height:13px;background:#e9efee;border-radius:7px;position:relative}.gr .it .tr i{display:block;height:100%;border-radius:7px}
.gr .it .tr u{position:absolute;top:-3px;width:3px;height:19px;background:#15445a;border-radius:2px}
.gr .it .v{width:140px;text-align:left;font-weight:700;font-size:11px}
.gr .cn{display:inline-block;background:#e3f1ee;color:#0a6b4a;border-radius:10px;padding:0 9px;font-size:10px;font-weight:700}
.gr table{width:100%;border-collapse:collapse;font-size:11.5px}.gr th{background:#15445a;color:#fff;padding:5px 8px;font-weight:700;text-align:right}
.gr td{padding:4px 8px;border-bottom:1px solid #e6ecee}.gr tr:nth-child(even) td{background:#f7fafa}.gr td.n,.gr th.n{text-align:center}
.gr .two{display:flex;gap:16px}.gr .two>div{flex:1}
.gr .st{display:flex;height:15px;border-radius:8px;overflow:hidden}.gr .st i{display:block;height:100%}
.gr .leg{font-size:10px;color:#55646f;display:flex;gap:14px;margin:5px 0}.gr .leg s{display:inline-block;width:10px;height:10px;border-radius:2px;margin-left:4px;text-decoration:none}
.gr .sig{margin-top:18px;margin-bottom:0;padding-top:10px;border-top:1px solid #d5dbe3;display:flex;justify-content:space-around;font-size:11px;color:#55646f;text-align:center}
.gr .sig>div{flex:1;padding:0 12px}.gr .sig b{display:block;color:#15445a;font-size:12.5px;margin-top:4px;min-height:18px}.gr .sig .ln{display:block;border-bottom:1px solid #8a97a0;height:34px;margin:2px 0 3px}.gr .sig small{font-size:9px;color:#8a97a0}
@media print{.gr{padding:0}.gr .pdf-avoid-break{break-inside:avoid;page-break-inside:avoid}.gr h2{break-after:avoid;page-break-after:avoid}}
`;

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

function grBands(s){
  const rules = s.rules;
  const m = Math.max.apply(null, s.bands.concat(1));
  const t = s.recorded || 1;
  return s.bands.map((n, i) => `<div class="hb"><div class="a">${GRADE_ANALYSIS_BANDS[i]}</div><div class="tr"><i class="${gradeReportBandTone(i, rules)}" style="width:${n ? Math.max(2, 100 * n / m) : 0}%"></i></div><div class="v">${gradeReportCount(n)} · ${grn(Math.round(100 * n / t) + '%')}</div></div>`).join('');
}

function grItems(items, onId, rules){
  return items.map(x => `<div class="it${onId === x.id ? ' on' : ''}"><div class="a">${escapeHtml(x.name)}${onId === x.id ? ' <span class="cn">المحلَّل</span>' : ''}</div><div class="tr"><i class="${gradeReportItemTone(x.avgPct, rules)}" style="width:${Math.min(100, x.avgPct)}%"></i></div><div class="v">${grn(formatScore(x.avg) + ' / ' + formatScore(x.max))} <span style="font-weight:400;color:#7a8791">(${grn(x.avgPct + '%')})</span></div></div>`).join('');
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

function grSig(prefs, third){
  const cell = (label, name) => `<div>${label}<b>${name ? escapeHtml(name) : ''}</b><i class="ln"></i><small>التوقيع</small></div>`;
  return `<div class="sig pdf-avoid-break">${third ? cell(third, '') : ''}${cell('معلم المادة', gradeReportTeacherName(prefs))}${cell('وكيل شؤون الطلاب', prefs.vice)}</div>`;
}

function grNamesTable(title, list){
  if(!list.length) return '';
  const rowOf = r => `<tr><td>${escapeHtml(r.name)}${r.partial ? ' <b style="color:#a85d3a">*</b>' : ''}</td><td class="n">${grn(formatScore(r.points) + ' / ' + formatScore(r.recordedMax))}</td><td class="n">${grn(Math.round(r.pct) + '%')}</td></tr>`;
  const head = '<tr><th>اسم الطالب</th><th class="n">الدرجة</th><th class="n">النسبة</th></tr>';
  if(list.length > 8){
    const h = Math.ceil(list.length / 2);
    return grBlock(grH2(`${title} — ${grn(list.length)}`) + `<div class="two"><div><table>${head}${list.slice(0, h).map(rowOf).join('')}</table></div><div><table>${head}${list.slice(h).map(rowOf).join('')}</table></div></div>`);
  }
  return grBlock(grH2(`${title} — ${grn(list.length)}`) + `<table>${head}${list.map(rowOf).join('')}</table>`);
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
  let t = `معيار التحليل: الحاجة للدعم أقل من ${r.pass}%، والحافة حتى +${r.edge} نقاط، والمتفوق ${r.top}% فأكثر. `;
  if(s.missing) t += `المحلَّل ${s.recorded} من ${s.total} طالبًا؛ من لم يُرصد له لا يدخل في الحساب (لا يُعدّ صفرًا). `;
  if(s.partial) t += `${s.partial} طالبًا رُصد لهم جزء من الأعمدة فنسبة كل منهم مما رُصد له. `;
  return `<div class="fn">${t}هذه معايير تحليلية وليست حكمًا رسميًا على النجاح أو الرسوب.</div>`;
}

/* تقرير الشعبة (المجموع) أو بند واحد: a = crmGradeAnalysis، v = gradeAnalysisView(a) */
function gradeReportSectionHtml(a, v, prefs, ctx){
  const s = v.stats, r = s.rules;
  const isTotal = a.key === 'total';
  const items = gradeReportItems(a.g, a.students);
  const notes = gradeReportSectionNotes({ s, displayMax: v.displayMax, items, isTotal, colLabel: v.colLabel });
  const pctOf = n => Math.round(100 * n / s.recorded) + '%';
  const kpis = grKpis([
    [s.passRate + '%', 'نسبة النجاح', `(${r.pass}% فأكثر)`, ''],
    [(s.avgPct === null ? '—' : s.avgPct + '%'), 'متوسط نسبة التحصيل', '', 'b'],
    [formatScore(s.avg), `المتوسط من ${formatScore(v.displayMax)}`, '', 'n'],
    [s.recorded, 'عدد الطلاب', [s.missing ? `من ${s.total} (لم يُرصد ${s.missing})` : '', s.partial ? `${s.partial} رُصد لهم جزء` : ''].filter(Boolean).join(' · '), 'n']]);
  const levels = prefs.show.levels ? grBlock(grH2('توزيع الطلاب حسب مستوى الأداء') + grBands(s) +
    `<div class="nb">بلغ عدد الناجحين <b>${gradeReportCount(s.passed)} (${grn(s.passRate + '%')})</b>، ودون حد النجاح <b>${gradeReportCount(s.groups.low.length)} (${grn(pctOf(s.groups.low.length))})</b>، ويقف ${gradeReportCount(s.groups.edge.length)} على الحافة.</div>`) : '';
  const stats = prefs.show.stats ? grBlock(grH2('المؤشرات الإحصائية') + `<div class="sm"><div><b>${grn(formatScore(s.min))}</b>أقل درجة</div><div><b>${grn(formatScore(s.max))}</b>أعلى درجة</div><div><b>${grn(formatScore(s.median))}</b>الوسيط</div><div><b>${grn(formatScore(Math.round((s.max - s.min) * 100) / 100))}</b>المدى</div></div>`) : '';
  const itemsHtml = prefs.show.items && items.length ? grBlock(grH2(isTotal ? 'متوسط درجات البنود' : 'درجات البنود (متوسط الشعبة)') + grItems(items, isTotal ? null : a.key, r) +
    (isTotal ? '<div class="fn">المجموع بعد تطبيق أوزان الدرجات؛ لذلك لا يساوي مجموع الدرجات العظمى للبنود.</div>' : '')) : '';
  const analysed = isTotal ? '' : `<h2>البند المحلَّل: ${escapeHtml(v.colLabel)} (من ${grn(formatScore(v.displayMax))})</h2>`;
  const topList = s.topIsFallback ? [] : s.groups.top;
  const names = ctx.withNames ? grNamesNote([s.groups.low, s.groups.edge, topList], v.displayMax) + grNamesTable('الطلاب المحتاجون إلى دعم علاجي', s.groups.low) +
    grNamesTable('الطلاب على الحافة', s.groups.edge) + grNamesTable('المتفوقون', topList) : '';
  const sub = escapeHtml(a.label) + ' | ' + (isTotal ? `المجموع من ${grn(formatScore(v.displayMax))}` : 'تحليل بند واحد');
  const body = isTotal
    ? kpis + levels + stats + itemsHtml
    : itemsHtml + grBlock(analysed + kpis) + levels + stats;
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج الدرجات — الشعبة', sub)}${body}${names}${prefs.show.compare ? grCompare(ctx.prev, ctx.withNames) : ''}${grNotes(notes, prefs)}${grFootnote(s)}${grSig(prefs)}</div>`;
}

/* تقرير مجموعة الشعب: d = { gradeName, key, colLabel, secs:[{ label, s, levels, items }], pooled, displayMax } */
function gradeReportGroupHtml(d, prefs, ctx){
  const rules = d.pooled.rules;
  const p = d.pooled;
  const total = d.secs.reduce((a, x) => a + x.s.recorded, 0);
  const kpis = grKpis([
    [p.passRate + '%', 'نسبة النجاح العامة', `(${d.secs.length} شعب)`, ''],
    [(p.avgPct === null ? '—' : p.avgPct + '%'), 'متوسط نسبة التحصيل', '', 'b'],
    [total, 'عدد الطلاب', '', 'n'], [d.secs.length, 'عدد الشعب', '', 'n']]);
  const stk = lv => { const t = (lv.top + lv.mid + lv.low) || 1; return `<div class="st"><i class="g" style="width:${100 * lv.top / t}%"></i><i class="bl" style="width:${100 * lv.mid / t}%"></i><i class="tn" style="width:${100 * lv.low / t}%"></i></div>`; };
  const table = grBlock(grH2('مقارنة الشعب') + `<table><tr><th>الشعبة</th><th class="n">الطلاب</th><th class="n">المتوسط</th><th class="n">نسبة النجاح</th><th>توزيع المستويات</th><th class="n">دون النجاح</th></tr>${d.secs.map(x =>
    `<tr><td><b>${escapeHtml(x.label)}</b></td><td class="n">${grn(x.s.recorded)}</td><td class="n">${grn(formatScore(x.s.avg) + ' (' + x.s.avgPct + '%)')}</td><td class="n">${grn(x.s.passRate + '%')}</td><td style="width:170px">${stk(x.levels)}</td><td class="n">${grn(Math.round(100 * x.s.groups.low.length / x.s.recorded) + '%')}</td></tr>`).join('')}</table>` +
    '<div class="leg"><span><s class="g"></s>متقن</span><span><s class="bl"></s>متوسط</span><span><s class="tn"></s>دون حد النجاح</span></div>');
  const levels = prefs.show.levels ? grBlock(grH2('توزيع طلاب المجموعة حسب مستوى الأداء') + grBands(p)) : '';
  const stats = prefs.show.stats ? grBlock(grH2('المؤشرات الإحصائية للمجموعة') + `<div class="sm"><div><b>${grn(formatScore(p.min))}</b>أقل درجة</div><div><b>${grn(formatScore(p.max))}</b>أعلى درجة</div><div><b>${grn(formatScore(p.median))}</b>الوسيط</div><div><b>${grn(formatScore(p.avg))}</b>المتوسط</div></div>`) : '';
  let matrix = '';
  if(prefs.show.items){
    const names = [];
    d.secs.forEach(x => x.items.forEach(i => { if(!names.some(n => n.key === normalizeGradeColumnName(i.name))) names.push({ key: normalizeGradeColumnName(i.name), name: i.name }); }));
    if(names.length){
      const cell = (x, n) => { const i = x.items.find(q => normalizeGradeColumnName(q.name) === n.key); return i ? `<td class="n" style="color:${i.avgPct < rules.pass ? '#8a6d1d' : i.avgPct >= rules.top ? '#0a8f5b' : '#15445a'};font-weight:700">${grn(i.avgPct + '%')}</td>` : '<td class="n">—</td>'; };
      matrix = grBlock(grH2('مقارنة الشعب في كل بند (متوسط النسبة)') + `<table><tr><th>البند</th>${d.secs.map(x => `<th class="n">${escapeHtml(x.label)}</th>`).join('')}</tr>${names.map(n => `<tr><td>${escapeHtml(n.name)}</td>${d.secs.map(x => cell(x, n)).join('')}</tr>`).join('')}</table>`);
    }
  }
  const notes = gradeReportGroupNotes({ secs: d.secs });
  const sub = `${escapeHtml(d.gradeName)} | ${d.key === 'total' ? `المجموع من ${grn(formatScore(d.displayMax))}` : 'بند: ' + escapeHtml(d.colLabel)}`;
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج المجموعة — شعب الصف', sub)}${kpis}${table}${levels}${stats}${matrix}${grNotes(notes, prefs)}${grFootnote(p)}${grSig(prefs)}</div>`;
}

/* تقرير طالب: d من gradeReportStudentData */
function gradeReportStudentHtml(d, prefs, ctx){
  const r = d.rules;
  const diff = d.pts === null || d.classPts === null ? null : Math.round((d.pts - d.classPts) * 10) / 10;
  const state = d.pct === null ? '—' : d.pct < r.pass ? 'يحتاج دعمًا' : d.pct < r.pass + r.edge ? 'ناجح بهامش' : d.pct >= r.top ? 'متفوق' : 'ناجح';
  const kpis = grKpis([
    [d.pts === null ? '—' : formatScore(d.pts), `مجموع الدرجات من ${formatScore(d.max)}`, '', 'n'],
    [d.pct === null ? '—' : Math.round(d.pct) + '%', 'النسبة المئوية', '', ''],
    [diff === null ? '—' : (diff > 0 ? '+' : '') + formatScore(diff), 'الفارق عن متوسط الشعبة', d.classPts === null ? '' : `(${formatScore(Math.round(d.classPts * 100) / 100)})`, diff !== null && diff < 0 ? 'r' : 'b'],
    [state, 'الحالة', '', 'n']]);
  const itemsHtml = prefs.show.items ? grBlock(grH2('درجات البنود مقارنةً بمتوسط الشعبة') +
    '<div class="leg"><span><s class="g"></s>متفوق</span><span><s class="bl"></s>ناجح</span><span><s class="tn"></s>دون حد النجاح</span><span>▏ علامة متوسط الشعبة</span></div>' +
    d.items.map(x => {
      if(x.score === null) return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"></div><div class="v">لم يُرصد</div></div>`;
      const dl = x.classPct === null ? null : Math.round(x.pct - x.classPct);
      return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"><i class="${gradeReportItemTone(x.pct, r)}" style="width:${Math.min(100, x.pct)}%"></i>${x.classPct === null ? '' : `<u style="right:${Math.min(100, x.classPct)}%"></u>`}</div><div class="v">${grn(formatScore(x.score) + ' / ' + formatScore(x.max))} ${dl === null ? '' : `<span style="font-weight:700;color:${dl >= 0 ? '#0a8f5b' : '#a85d3a'}">${dl >= 0 ? '▲' : '▼'} ${grn(Math.abs(dl) + '%')}</span>`}</div></div>`;
    }).join('') + '<div class="fn">ما لم يُرصد لا يُحسب على الطالب.</div>') : '';
  const notes = gradeReportStudentNotes({ pts: d.pts, max: d.max, pct: d.pct, classPts: d.classPts, classPct: d.classPct, items: d.items, rules: r });
  const meta = { logo: ctx.logo, date: ctx.date, year: d.year, semester: d.semester };
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(meta, prefs, 'تقرير أداء طالب', `${escapeHtml(d.name)} | ${escapeHtml(d.label)} | المجموع من ${grn(formatScore(d.max))}`)}${kpis}${itemsHtml}${grNotes(notes, prefs)}<div class="fn">معيار التحليل: الحاجة للدعم أقل من ${r.pass}%، والحافة حتى +${r.edge} نقاط، والمتفوق ${r.top}% فأكثر. هذه معايير تحليلية وليست حكمًا رسميًا على النجاح أو الرسوب.</div>${grSig(prefs, 'ولي الأمر')}</div>`;
}

/* ============ التصدير ============ */
let gradeReportBusy = false;

/* ===== الطباعة / الحفظ كـPDF من المتصفح: نص حقيقي (يرسمه المتصفح بخطه) بدل صورة =====
   - الترويسة المصغّرة والترقيم في هوامش @page (يدعمها Chrome الحديث؛ غيره يتجاهلها).
   - تُنظَّف #printArea بعد الطباعة حتى لا يبقى @page هذا يؤثر في طباعة أخرى. */
function gradeReportPrintCss(mark){
  const q = t => String(t || '').replace(/[\\"]/g, '').replace(/[\r\n]+/g, ' ');
  const box = 'font-family:Cairo,sans-serif;font-size:8.5pt;color:#55646f';
  const top = mark && (mark.right || mark.left)
    ? `@top-right{content:"${q(mark.right)}";${box}}@top-left{content:"${q(mark.left)}";${box}}` : '';
  return `@page{size:A4;margin:14mm 10mm 14mm;${top}@bottom-center{content:"صفحة " counter(page) " / " counter(pages);${box}}}`
    + '@page :first{@top-right{content:none}@top-left{content:none}}'
    + '@media print{#printArea.wrap{max-width:none;padding-bottom:0}}';
}

function gradeReportPrint(html, mark){
  const area = document.getElementById('printArea');
  if(!area) return;
  area.innerHTML = `<style>${gradeReportPrintCss(mark)}</style>` + html;
  const clear = () => { window.removeEventListener('afterprint', clear); if(area.querySelector('.gr')) area.innerHTML = ''; };
  window.addEventListener('afterprint', clear);
  printNow();
}

/* ترويسة مصغّرة (من الصفحة 2) وترقيم «س / ص» على كل صفحة — في هامش الورقة، فلا تأخذ من مساحة المحتوى.
   mark = { right, left } نصان بسيطان (يُهرَّبان هنا) */
async function gradeReportAddMarks(pdf, mark){
  const area = document.getElementById('pdfRenderArea');
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const boxW = W - PDF_MARGIN_PT * 2, cssH = 24;
  let h = boxW * cssH / 800;
  const strip = async inner => {
    area.innerHTML = `<div dir="rtl" style="width:800px;height:${cssH}px;line-height:${cssH}px;box-sizing:border-box;padding:0 34px;display:flex;justify-content:space-between;font-family:'Cairo',sans-serif;font-size:11px;color:#55646f;background:#fff">${inner}</div>`;
    const canvas = await html2canvas(area, { scale: 2, backgroundColor: '#ffffff' });
    h = boxW * canvas.height / canvas.width; /* النسبة الفعلية للملتقَط، لا المفترضة: أي حشوة في الحاوية تُضغط الشريحة */
    return canvas.toDataURL('image/jpeg', 0.92);
  };
  const n = pdf.getNumberOfPages();
  const head = mark && (mark.right || mark.left) ? await strip(`<span>${escapeHtml(mark.right || '')}</span><span>${escapeHtml(mark.left || '')}</span>`) : null;
  for(let i = 1; i <= n; i++){
    pdf.setPage(i);
    if(head && i > 1) pdf.addImage(head, 'JPEG', PDF_MARGIN_PT, 6, boxW, h);
    const foot = await strip(`<span style="flex:1;text-align:center">صفحة <bdi dir="ltr">${i} / ${n}</bdi></span>`);
    pdf.addImage(foot, 'JPEG', PDF_MARGIN_PT, H - h - 4, boxW, h);
  }
}

function gradeReportMark(prefs, title, label){
  const subject = gradeReportSubject(prefs);
  return { right: `${title} · ${label}${subject ? ' · ' + subject : ''}`, left: gradeReportSchool(prefs) };
}

/* #pdfRenderArea عليه class="wrap" (padding-bottom:70px): يُلتقط معه فراغ أبيض يُنتج صفحة فارغة ويُضغط الترويسة والترقيم.
   نصفّر الحشوة أثناء تصوير التقرير فقط ثم نعيدها */
async function gradeReportWithFlatArea(area, fn){
  const prev = area.style.paddingBottom;
  area.style.paddingBottom = '0';
  try{ return await fn(); } finally { area.style.paddingBottom = prev; }
}

async function gradeReportRun(btn, build, filename, mode){
  if(gradeReportBusy) return;
  gradeReportBusy = true;
  beginExportBusy(btn, 'جارٍ التجهيز...');
  try{
    const out = await build();
    const html = out && typeof out === 'object' ? out.html : out;
    if(!html) return;
    if(mode === 'print'){ gradeReportPrint(html, out && typeof out === 'object' ? out.mark : null); return; }
    await ensurePdfLibs();
    if(document.fonts && document.fonts.load){
      try{ await Promise.all(['400', '700', '800'].map(w => document.fonts.load(`${w} 12px 'Cairo'`, 'شاهد الأداء الوظيفي'))); } catch(e){ /* لا يمنع التصدير */ }
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const area = document.getElementById('pdfRenderArea');
    await gradeReportWithFlatArea(area, async () => {
      await addPdfPagesMulti(pdf, area, html, { firstPage: true });
      await gradeReportAddMarks(pdf, out && typeof out === 'object' ? out.mark : null);
    });
    pdf.save(filename + '.pdf');
    showToast('تم التصدير', 'ok');
  } catch(err){
    showToast('تعذّر التصدير: ' + (err.message || ''), 'error');
  } finally {
    gradeReportBusy = false;
    endExportBusy(btn);
  }
}

const gradeReportFile = (prefix, label) => `${prefix}-${String(label).replace(/[\\\/:*?"<>|\s]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;

/* من نافذة التحليل: تقرير الشعبة/البند، أو مجموعة شعب الصف */
async function exportGradeReport(btn, mode){
  const a = crmGradeAnalysis;
  if(!a || gradeReportBusy) return;
  const prefs = gradeReportPrefsNow();
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
  }, scope === 'group' ? gradeReportFile('تقرير-مجموعة-شعب', gradeName) : gradeReportFile('تقرير-درجات', a.label), mode);
}

/* من صفحة الطالب في الكشف */
async function exportCrmStudentReport(btn, mode){
  const g = crmGrades, id = crmGradeStudentId;
  if(!g || !id || gradeReportBusy) return;
  const d = gradeReportStudentData(g, id);
  if(!d) return;
  const prefs = gradeReportPrefsNow();
  await gradeReportRun(btn, async () => {
    const logo = await gradeReportLogoData();
    return { html: gradeReportStudentHtml(d, prefs, { logo, date: new Date().toISOString().slice(0, 10) }), mark: gradeReportMark(prefs, 'تقرير أداء طالب', d.name) };
  }, gradeReportFile('تقرير-طالب', d.name), mode);
}

/* ============ خيارات التقارير (إعدادات المعلم) ============ */
let gradeReportDraft = null; /* { host: 'ga' | 'cust', school, teacher, vice, show, notes, error, saving } */

function openGradeReportEditor(host){
  const p = gradeReportPrefsNow();
  gradeReportDraft = { host, school: p.school, teacher: p.teacher, vice: p.vice, subject: p.subject, show: Object.assign({}, p.show), notes: Object.assign({}, p.notes), error: '', saving: false };
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
    ${fld('subject', 'المادة', gradeReportSubject({ subject: '' }) ? 'تلقائي: ' + gradeReportSubject({ subject: '' }) : 'مثال: الفيزياء')}
    ${fld('vice', 'وكيل شؤون الطلاب', 'يظهر في التوقيع')}
    <div class="crm-ga-sec" style="margin-top:12px">ما يُطبع في التقرير</div>
    ${Object.keys(GRADE_REPORT_SHOW_LABELS).map(k => chk('show', k, GRADE_REPORT_SHOW_LABELS[k])).join('')}
    <div class="crm-ga-sec" style="margin-top:12px">التعليق التربوي</div>
    ${Object.keys(GRADE_REPORT_NOTE_LABELS).map(k => chk('notes', k, GRADE_REPORT_NOTE_LABELS[k])).join('')}
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
  const p = { school: d.school, teacher: d.teacher, vice: d.vice, subject: d.subject, show: d.show, notes: d.notes };
  d.saving = true;
  const btn = document.getElementById('grEditorSave');
  if(btn) btn.disabled = true;
  const err = await persistGradeReportPrefs(p);
  if(gradeReportDraft !== d) return;
  d.saving = false;
  if(err){ d.error = err; paintGradeReportEditor(); return; }
  gradeReportDraft = null;
  if(d.host === 'ga'){
    if(crmGradeAnalysis === a && a){ a.reportEdit = null; a.withNames = gradeReportPrefsNow().show.names; paintCrmGradeAnalysis(); }
  } else {
    closeCrmModal();
  }
  showToast('حُفظت خيارات التقارير', 'ok');
}
