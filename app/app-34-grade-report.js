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
  school: '', logo: '', teacher: '', vice: '', staff: '', counselor: '', subject: '', /* vice = وكيل شؤون الطلاب · staff = وكيل شؤون المعلمين · counselor = الموجه الطلابي */
  show: { levels: true, stats: true, items: true, names: false, compare: false },
  notes: { reading: false, strengths: false, weaknesses: false, plans: false } /* الأصل: تقرير أرقام بلا تعليق تربوي */
};
const GRADE_REPORT_SHOW_LABELS = {
  levels: 'توزيع الطلاب على المستويات',
  stats: 'المؤشرات الإحصائية (أدنى · أعلى · وسيط — تقرير المجموعة)',
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
/* شعار المدرسة: لا يدخل features (قيد القاعدة < 4000 بايت)؛ يُرفع لحاوية الصور بمجلد المستخدم ويُحفظ مساره فقط:
   <uid>/school-logo-<ts>.png. وللطباعة يُحمَّل ويُحوَّل data URL (GRADE_REPORT_DATA_RE) */
const GRADE_REPORT_LOGO_MAX = 60000; /* حدّ حجم الصورة بعد التصغير */
const GRADE_REPORT_LOGO_RE = /^[0-9a-f-]{36}\/school-logo-\d{10,16}\.png$/;
const GRADE_REPORT_DATA_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}$/;
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
  /* شعار المدرسة: مسار ملفه بمجلد المستخدم فقط؛ غير ذلك يُهمَل (ما يُقرأ من القاعدة لا يُوثق به) */
  if(typeof raw.logo === 'string' && GRADE_REPORT_LOGO_RE.test(raw.logo)) out.logo = raw.logo;
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
  const rec = (rows || []).filter(r => r.pct !== null && !r.incomplete);
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
  if(c.incomplete){
    reading.push(`لم تكتمل درجات الطالب${c.missing && c.missing.length ? ' (الناقص: ' + c.missing.map(escapeHtml).join('، ') + ')' : ''}؛ لا يُصنَّف مستواه حتى تُرصد.`);
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
  /* الأساس نفسه كتحليل الشعبة: مقارنته بمكتملي الرصد فقط، وغير المكتمل يُعرض بما رُصد له ولا يُصنَّف */
  const res = gradeAnalysisRows(g, students, 'total', caps, testsOn);
  const row = res.rows.find(x => x.id === studentId);
  const comp = res.rows.filter(x => !x.incomplete && x.points !== null);
  const r = studentGradeResult(g.columns, g.scores, studentId, caps);
  const has = row.points !== null;
  const mean = fn => comp.length ? comp.reduce((a, x) => a + fn(x), 0) / comp.length : null;
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
    pts: has ? row.points : null, max: row.incomplete && row.recordedMax > 0 ? row.recordedMax : res.displayMax, pct: has ? row.pct : null,
    classPts: mean(x => x.points), classPct: mean(x => x.pct),
    incomplete: !!row.incomplete, missing: row.missing || [],
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
.gr .hd .lgb{width:120px;height:54px;display:flex;align-items:center;flex:none}.gr .hd .lgb img{max-height:54px;max-width:120px;height:auto;width:auto}
.gr .hd .t{text-align:center;flex:1;min-width:0}.gr .hd .t small{display:block;font-size:11px;color:#5b6b74}
.gr .nw{white-space:nowrap}.gr .hd .t h1 .sn{color:#15445a}.gr .hd .t h1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.5;margin:0;font-size:20px;color:#351375;font-weight:800}.gr .hd .t .m{font-size:11px;color:#5b6b74}
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
.gr .sig{margin-top:10px;margin-bottom:0;padding-top:6px;border-top:1px solid #d5dde1;display:flex;justify-content:space-around;font-size:11px;color:#5b6b74;text-align:center}
.gr .sig>div{flex:1;padding:0 12px}.gr .sig b{display:block;color:#15445a;font-size:12.5px;margin-top:3px;min-height:18px}.gr .sig .ln{display:block;border-bottom:1px solid #8a979f;height:24px;margin:2px 0 3px}.gr .sig small{font-size:9px;color:#8a979f}
/* ملخص + قائمة الطلاب + غير المكتملين (التصميم المعتمد) */
.gr .sx{border:1.5px solid #dfe6ea;border-radius:11px;padding:3px 12px;margin-bottom:9px}
.gr .sx .sl{display:flex;align-items:baseline;gap:10px;padding:3.5px 0;border-bottom:1px solid #eef2f4;font-size:12.5px;line-height:1.7}.gr .sx .sl:last-child{border-bottom:0}
.gr .sx .lb2{flex:0 0 92px;font-weight:800;color:#351375}.gr .sx .lb2.q{color:#7258a4}.gr .sx .tx{flex:1}
.gr tr.lowrow td{background:#f1eef7}
.gr td.mk{width:12px;padding:0}.gr td.mk i{display:block;width:6px;height:16px;border-radius:2px;margin-right:3px}.gr td.mk i.hol{background:#fff;border:1.5px solid #7a8791;width:5px;height:13px}
.gr .low-t{color:#7258a4;font-weight:800}
.gr .c3 table{font-size:12px}.gr .c3 td:nth-child(2){white-space:normal}.gr .c3 th{font-size:11px;padding-left:3px;padding-right:4px}.gr .c3 td{padding-top:2.5px;padding-bottom:2.5px}.gr .c3 td.mk{white-space:normal}
.gr .key{margin-right:auto;display:flex;gap:12px;font-size:11px;font-weight:600;color:#15445a}.gr .key span{display:flex;align-items:center;gap:5px}.gr .key i{display:inline-block;width:9px;height:12px;border-radius:2px}.gr .key i.hol{background:#fff;border:1.5px solid #7a8791;width:7px;height:10px}
.gr .cp.h{background:#fff;color:#4a5a63;border:1.5px solid #7a8791;line-height:1.5}
.gr .inc{margin-top:8px;border:1.5px dashed #9fb3bd;border-radius:9px;padding:3px 10px}.gr .inc table{font-size:12px}.gr .inc th{background:#eef2f4;color:#15445a}.gr .inc td{background:#fff !important}
/* ضغط تلقائي (gradeReportFit) حين يزيد التقرير قليلًا عن صفحة: مستويان */
.gr.cmp1 .hd{margin-bottom:8px}.gr.cmp1 .hd .lgb img{max-height:46px}.gr.cmp1 h2{margin:6px 0 4px;font-size:13px}
.gr.cmp1 .kp{margin-bottom:6px}.gr.cmp1 .kp>div{padding:3px 4px}.gr.cmp1 .kp b{font-size:17px;line-height:1.35}
.gr.cmp1 td{padding:1.5px 7px}.gr.cmp1 th{padding:2.5px 7px}.gr.cmp1 .gw{margin-bottom:5px}.gr.cmp1 .gh{padding:2px 9px}
.gr.cmp1 .nb{padding:4px 12px;margin:3px 0}.gr.cmp1 .sx .sl{padding:2px 0}.gr.cmp1 .c3 td{padding-top:1.5px;padding-bottom:1.5px}.gr.cmp1 .inc{margin-top:5px}.gr.cmp1 .sig{margin-top:6px}.gr.cmp1 .sig .ln{height:20px}
.gr.cmp2{font-size:11.5px}.gr.cmp2 table{font-size:10.5px}.gr.cmp2 td{padding:1px 6px}.gr.cmp2 .kp>div{padding:2px 4px}.gr.cmp2 .fn{margin:2px 0}
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
  } catch(e){ return ''; } /* الفشل لا يُخزَّن: التصدير التالي يعيد المحاولة */
  return gradeReportLogoCache;
}

/* شعار المدرسة للطباعة: يُحمَّل من حاوية الصور ويُخزَّن بالمسار (مسار جديد = شعار جديد)؛ الفشل = بلا شعار ولا يمنع التقرير */
let gradeReportSchoolLogoCache = { path: '', data: '' };
async function gradeReportSchoolLogoData(){
  const path = gradeReportPrefsNow().logo;
  if(!path || !GRADE_REPORT_LOGO_RE.test(path) || !currentUser || path.split('/')[0] !== currentUser.id) return '';
  if(gradeReportSchoolLogoCache.path === path && gradeReportSchoolLogoCache.data) return gradeReportSchoolLogoCache.data;
  try{
    const { data, error } = await sb.storage.from('shawahid-photos').download(path);
    if(error || !data) throw new Error('logo');
    const url = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(data); });
    if(!GRADE_REPORT_DATA_RE.test(url)) return '';
    gradeReportSchoolLogoCache = { path, data: url };
    return url;
  } catch(e){ return ''; }
}

function grBlock(inner){ return inner ? `<div class="pdf-avoid-break">${inner}</div>` : ''; }
const grH2 = t => `<h2>${t}</h2>`;

/* عنوان تقرير الطالب في سطر واحد: الخط يصغر بطول الاسم (22px ← 13px)، وما زاد يُقصّ بنقاط */
function gradeReportTitleSize(len){ return Math.max(13, Math.min(22, Math.floor(700 / Math.max(1, len)))); }

function grHead(ctx, prefs, title, sub, extra, titleHtml, titleLen){
  const semester = Number(ctx.semester) === 2 ? 'الثاني' : 'الأول';
  const school = gradeReportSchool(prefs) ? escapeHtml(gradeReportSchool(prefs)) : 'اسم المدرسة';
  const subject = gradeReportSubject(prefs);
  const when = `<span class="nw">| الفصل ${semester} ${grn(escapeHtml(ctx.year || ''))} | ${grn(escapeHtml(ctx.date || ''))}</span>`;
  const size = titleLen ? ` style="font-size:${gradeReportTitleSize(titleLen)}px"` : '';
  const schoolLogo = ctx.schoolLogo && GRADE_REPORT_DATA_RE.test(ctx.schoolLogo) ? `<img src="${ctx.schoolLogo}" alt="">` : '';
  return `<div class="hd"><div class="lgb">${ctx.logo ? `<img src="${ctx.logo}" alt="">` : ''}</div>
    <div class="t"><small>${school}</small><h1${size}>${titleHtml || escapeHtml(title)}</h1><div class="m">${subject ? `<b>المادة: ${escapeHtml(subject)}</b> | ` : ''}${sub} ${when}${extra || ''}</div></div>
    <div class="lgb">${schoolLogo}</div></div>`;
}

function grKpis(list){
  const val = v => /[\u0600-\u06FF]/.test(String(v)) ? v : grn(v);
  return `<div class="kp">${list.map(([v, l, s, c]) => `<div class="${c || ''}"><b>${val(v)}</b><span>${l}</span>${s ? `<small>${s}</small>` : ''}</div>`).join('')}</div>`;
}

/* مستويات الطلاب: ضعاف · متوسطون · متفوقون لمكتملي الرصد، وصف «رصد غير مكتمل» (لا يُصنَّفون)، ثم المجموع */
function grLevels(s){
  const r = s.rules;
  const incN = s.incomplete ? s.incomplete.length : 0;
  const row = (cls, label, limit, n) => `<tr><td><span class="cp ${cls}">${label}</span></td><td>${limit}</td><td class="n"><b>${grn(n)}</b></td></tr>`;
  return `<table><tr><th>المستوى</th><th>الحد</th><th class="n">العدد</th></tr>` +
    row('w', 'ضعاف', `أقل من ${r.pass}%`, s.groups.low.length) + row('m', 'متوسطون', `من ${r.pass}% إلى أقل من ${r.top}%`, s.mid.length) +
    row('t', s.topIsFallback ? 'الأعلى درجات' : 'متفوقون', s.topIsFallback ? 'أعلى 3 درجات' : `${r.top}% فأكثر`, s.groups.top.length) +
    (incN ? row('h', 'رصد غير مكتمل', 'لا يُصنَّفون', incN) : '') +
    `<tr><td><b>المجموع</b></td><td></td><td class="n"><b>${grn(s.total)}</b></td></tr></table>`;
}

/* البنود: متوسط كل بند لمن رُصد له (وما دون حدّ الضعاف بلون الخط) */
function grItemsTable(items, onId, rules){
  return `<table><tr><th>البند</th><th class="n">المتوسط (لمن رُصد له)</th><th class="n">النسبة</th></tr>` +
    items.map(x => `<tr${onId === x.id ? ' class="on"' : ''}><td>${escapeHtml(x.name)}${onId === x.id ? ' <span class="cn">المحلَّل</span>' : ''}</td><td class="n">${grn(formatScore(x.avg) + ' / ' + formatScore(x.max))}</td><td class="n"><b${x.avgPct < rules.pass ? ' class="low-t"' : ''}>${grn(x.avgPct + '%')}</b></td></tr>`).join('') + '</table>';
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

/* قائمة الطلاب: واحدة مرتبة من الأدنى نسبةً في 3 أعمدة (أقل إن قلّوا)، وعلامة لون للمستوى، ومفتاح الألوان،
   ثم جدول منفصل لغير المكتملين (لا يُصنَّفون) */
function grRoster(s){
  const topIds = new Set(s.groups.top.map(x => x.id)), lowIds = new Set(s.groups.low.map(x => x.id));
  const comp = [].concat(s.groups.low, s.mid, s.groups.top).sort((x, y) => x.pct - y.pct || x.name.localeCompare(y.name, 'ar'));
  const inc = s.incomplete || [];
  if(!comp.length && !inc.length) return '';
  const color = r => lowIds.has(r.id) ? '#7258a4' : topIds.has(r.id) ? '#07a869' : '#3d7eb9';
  const rowOf = r => `<tr${lowIds.has(r.id) ? ' class="lowrow"' : ''}><td class="mk"><i style="background:${color(r)}"></i></td><td>${escapeHtml(r.name)}</td><td class="n">${grn(formatScore(r.points))}</td><td class="n">${grn(Math.round(r.pct) + '%')}</td></tr>`;
  const head = '<tr><th class="mk"></th><th>اسم الطالب</th><th class="n">الدرجة</th><th class="n">النسبة</th></tr>';
  const k = comp.length > 12 ? 3 : comp.length > 6 ? 2 : 1;
  const base = Math.floor(comp.length / k), extra = comp.length % k;
  const cols = []; let i = 0;
  for(let c = 0; c < k; c++){ const n = base + (c < extra ? 1 : 0); cols.push(comp.slice(i, i + n)); i += n; }
  const key = `<span class="key"><span><i style="background:#7258a4"></i>ضعاف</span><span><i style="background:#3d7eb9"></i>متوسطون</span><span><i style="background:#07a869"></i>${s.topIsFallback ? 'الأعلى درجات' : 'متفوقون'}</span>${inc.length ? '<span><i class="hol"></i>رصد غير مكتمل</span>' : ''}</span>`;
  const list = comp.length ? `<h2>قائمة الطلاب (من الأدنى نسبةً)${key}</h2><div class="c3">${cols.map(c => `<div><table>${head}${c.map(rowOf).join('')}</table></div>`).join('')}</div>` : '';
  const incRow = r => `<tr><td class="mk"><i class="hol"></i></td><td>${escapeHtml(r.name)}</td><td class="n">${r.points === null ? '—' : grn(formatScore(r.points) + ' / ' + formatScore(r.recordedMax))}</td><td class="n">${r.points === null ? '—' : grn(Math.round(r.pct) + '%')}</td><td>${escapeHtml((r.missing || []).join('، ')) || '—'} غير مرصود</td></tr>`;
  const incHtml = inc.length ? `<div class="inc pdf-avoid-break"><table><tr><th class="mk"></th><th>رصد غير مكتمل</th><th class="n">الدرجة المرصودة</th><th class="n">النسبة</th><th>الناقص</th></tr>${inc.map(incRow).join('')}</table></div>` : '';
  return grBlock(list + incHtml);
}

/* ===== خلاصة تحليلية: أسطر قصيرة تُولَّد من الأرقام فقط (بلا أسباب ولا نصائح عامة) ===== */
function gradeReportSummary(a, v, items, withNames){
  const s = v.stats, r = s.rules, isTotal = a.key === 'total';
  const inc = s.incomplete || [];
  if(!s.recorded && !inc.length) return '';
  const lines = [];
  const lv = [['ضعاف', s.groups.low.length], ['متوسطون', s.mid.length], [s.topIsFallback ? 'الأعلى درجات' : 'متفوقون', s.groups.top.length]];
  if(s.recorded){
    const big = lv.reduce((m, x) => x[1] > m[1] ? x : m);
    const share = big[1] * 2 > s.recorded ? `أغلبهم ${big[0]} (<b>${grn(big[1])}</b>)` : `أكبر مستوى: ${big[0]} (<b>${grn(big[1])}</b>)`;
    const basis = inc.length ? ` لـ${gradeReportCount(s.recorded)} مكتملي الرصد` : '';
    lines.push(['الصورة العامة', `متوسط ${isTotal ? 'الشعبة' : escapeHtml(v.colLabel)} <b>${grn((s.avgPct === null ? '—' : s.avgPct) + '%')}</b> (${grn(formatScore(Math.round(s.avg * 10) / 10))} من ${grn(formatScore(v.displayMax))})${basis}. ${share}.`]);
  }
  if(isTotal && items.length > 1){
    const lowest = items.reduce((m, x) => x.avgPct < m.avgPct ? x : m);
    const below = items.filter(x => x.avgPct < r.pass);
    const one = x => `<b>${escapeHtml(x.name)}</b>`;
    const txt = below.length === 1 ? `${one(lowest)} أضعف البنود، ${grn(formatScore(lowest.avg) + ' / ' + formatScore(lowest.max))} (<b>${grn(lowest.avgPct + '%')}</b>)، والوحيد دون ${r.pass}%.`
      : below.length > 1 ? `${one(lowest)} أضعف البنود (<b>${grn(lowest.avgPct + '%')}</b>)، ومعه دون ${r.pass}%: ${below.filter(x => x !== lowest).map(x => escapeHtml(x.name)).join('، ')}.`
      : `لا بند دون ${r.pass}%؛ أضعفها ${one(lowest)} (<b>${grn(lowest.avgPct + '%')}</b>).`;
    lines.push(['موضع الاهتمام', txt]);
  }
  const lowN = s.groups.low.length;
  if(s.recorded) lines.push(['يحتاج متابعة', lowN ? `<b>${gradeReportCount(lowN)}</b> أقل من ${r.pass}%${withNames ? ' (في أول القائمة أدناه)' : ''}.` : `لا طالب أقل من ${r.pass}%.`]);
  let what = '';
  if(inc.length){
    const n = inc.length;
    const sigs = new Set(inc.map(x => x.points === null ? '*' : (x.missing || []).join('|')));
    const single = sigs.size === 1 && !sigs.has('*') ? (inc[0].missing || []).join(' و') : '';
    what = single ? `بلا درجة ${escapeHtml(single)}` : sigs.size === 1 && sigs.has('*') ? 'بلا أي درجة' : 'بدرجات ناقصة';
    const suf = n === 1 ? 'ه' : n === 2 ? 'هما' : 'هم', vb = n === 1 ? '' : n === 2 ? 'ا' : 'وا';
    lines.push(['رصد ناقص', `<b>${gradeReportCount(n)}</b> ${what}؛ تصنيف${suf} يتوقف عليها، فلم يُصنَّف${vb}.`, true]);
  }
  const act = [];
  if(inc.length){
    const n = inc.length;
    const who = n === 1 ? 'للطالب' : n === 2 ? 'للطالبين' : 'للطلاب';
    const single = what.indexOf('بلا درجة ') === 0 ? what.slice('بلا درجة '.length) : '';
    act.push(`أكمل ${single ? 'رصد ' + single : 'الدرجات الناقصة'} ${who} (أدخل 0 إن كان صفرًا)`);
  }
  if(lowN) act.push(inc.length ? `ثم تابع الأقل من ${r.pass}% من الأدنى` : `تابع الطلاب الأقل من ${r.pass}% من الأدنى نسبةً`);
  if(act.length) lines.push(['الإجراء', act.join('، ') + '.']);
  return `<div class="sx">${lines.map(([l, t, q]) => `<div class="sl"><span class="lb2${q ? ' q' : ''}">${l}</span><span class="tx">${t}</span></div>`).join('')}</div>`;
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
  const r = s.rules, n = s.incomplete ? s.incomplete.length : 0;
  let t = `معيار المستويات: الضعاف أقل من ${r.pass}%، والمتفوقون ${r.top}% فأكثر، والمتوسطون ما بينهما. `;
  if(n) t += `${n} طلاب لم تكتمل درجاتهم: لا يُصنَّفون ولا يدخلون في المتوسط. `;
  return `<div class="fn">${t}</div>`;
}

/* تقرير الشعبة (المجموع) أو بند واحد: a = crmGradeAnalysis، v = gradeAnalysisView(a) */
function gradeReportSectionHtml(a, v, prefs, ctx){
  const s = v.stats, r = s.rules;
  const isTotal = a.key === 'total';
  const items = gradeReportItems(a.g, a.students);
  const notes = gradeReportSectionNotes({ s, displayMax: v.displayMax, items, isTotal, colLabel: v.colLabel });
  const max = formatScore(v.displayMax);
  const lvBlock = prefs.show.levels ? `<div><h2>مستويات الطلاب</h2>${grLevels(s)}</div>` : '';
  const itBlock = prefs.show.items && items.length ? `<div><h2>${isTotal ? 'متوسط البنود' : 'درجات البنود'}</h2>${grItemsTable(items, isTotal ? null : a.key, r)}</div>` : '';
  const mid = lvBlock || itBlock ? grBlock(`<div class="two">${lvBlock}${itBlock}</div>`) : '';
  const analysed = isTotal ? '' : `<h2>البند المحلَّل: ${escapeHtml(v.colLabel)} (من ${grn(max)})</h2>`;
  const names = ctx.withNames ? grRoster(s) : '';
  const sub = escapeHtml(a.label) + ' | ' + (isTotal ? `المجموع من ${grn(max)}` : 'تحليل بند واحد');
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج الدرجات — الشعبة', sub)}${analysed}${gradeReportSummary(a, v, items, ctx.withNames)}${mid}${names}${prefs.show.compare ? grCompare(ctx.prev, ctx.withNames) : ''}${grNotes(notes, prefs)}${grSig(prefs)}</div>`;
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
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(ctx, prefs, 'تحليل نتائج المجموعة — شعب الصف', sub)}${kpis}${table}${levels}${stats}${matrix}${grNotes(notes, prefs)}${grFootnote(p)}${grSig(prefs)}</div>`;
}

/* تقرير طالب: d من gradeReportStudentData */
function gradeReportStudentHtml(d, prefs, ctx){
  const r = d.rules;
  const diff = d.pts === null || d.classPts === null || d.incomplete ? null : Math.round((d.pts - d.classPts) * 10) / 10;
  const state = d.incomplete ? 'رصد غير مكتمل' : d.pct === null ? '—' : d.pct < r.pass ? 'ضعيف' : d.pct >= r.top ? 'متفوق' : 'متوسط';
  const kpis = grKpis([
    [d.pts === null ? '—' : formatScore(d.pts), `${d.incomplete ? 'الدرجة المرصودة' : 'مجموع الدرجات'} من ${formatScore(d.max)}`, '', 'n'],
    [d.pct === null ? '—' : Math.round(d.pct) + '%', 'النسبة المئوية', '', ''],
    [diff === null ? '—' : (diff > 0 ? '+' : '') + formatScore(diff), 'الفارق عن متوسط الشعبة', d.classPts === null || d.incomplete ? '' : `(${formatScore(Math.round(d.classPts * 100) / 100)})`, diff !== null && diff < 0 ? 'r' : 'b'],
    [state, 'المستوى', '', 'n']]);
  const itemsHtml = prefs.show.items ? grBlock(grH2('درجات البنود مقارنةً بمتوسط الشعبة') +
    '<div class="leg"><span><s class="g"></s>متفوق</span><span><s class="bl"></s>متوسط</span><span><s class="tn"></s>ضعيف</span><span>▏ علامة متوسط الشعبة</span></div>' +
    d.items.map(x => {
      if(x.score === null) return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"></div><div class="v">لم يُرصد</div></div>`;
      const dl = x.classPct === null ? null : Math.round(x.pct - x.classPct);
      return `<div class="it"><div class="a">${escapeHtml(x.name)}</div><div class="tr"><i class="${gradeReportItemTone(x.pct, r)}" style="width:${Math.min(100, x.pct)}%"></i>${x.classPct === null ? '' : `<u style="right:${Math.min(100, x.classPct)}%"></u>`}</div><div class="v">${grn(formatScore(x.score) + ' / ' + formatScore(x.max))} ${dl === null ? '' : `<span style="font-weight:700;color:${dl >= 0 ? '#0a8f5b' : '#a85d3a'}">${dl >= 0 ? '▲' : '▼'} ${grn(Math.abs(dl) + '%')}</span>`}</div></div>`;
    }).join('') + '<div class="fn">ما لم يُرصد لا يُحسب على الطالب.</div>') : '';
  const notes = gradeReportStudentNotes({ incomplete: d.incomplete, missing: d.missing, pts: d.pts, max: d.max, pct: d.pct, classPts: d.classPts, classPct: d.classPct, items: d.items, rules: r });
  const meta = { logo: ctx.logo, schoolLogo: ctx.schoolLogo, date: ctx.date, year: d.year, semester: d.semester };
  const to = ctx.to ? String(ctx.to) : '';
  /* الجهة الموجَّه إليها: سطر تحت العنوان + خانة توقيعها (وكيل الشؤون له خانة ثابتة أصلًا) */
  const toLine = to ? ` | <b>موجّه إلى: ${escapeHtml(to)}</b>` : '';
  const sigTo = to === 'وكيل شؤون الطلاب' ? '' : (to || 'ولي الأمر');
  /* اسم الجهة في توقيعها إن كان المعلم أدخله مرة (الموجه الطلابي · وكيل شؤون المعلمين) */
  const sigName = to === 'الموجه الطلابي' ? prefs.counselor : to === 'وكيل شؤون المعلمين' ? prefs.staff : '';
  return `<style>${GRADE_REPORT_CSS}</style><div class="gr">${grHead(meta, prefs, 'تقرير أداء الطالب', `${escapeHtml(d.label)} | المجموع من ${grn(formatScore(d.max))}`, toLine, `تقرير أداء الطالب: <span class="sn">${escapeHtml(d.name)}</span>`, 'تقرير أداء الطالب: '.length + String(d.name).length)}${kpis}${itemsHtml}${grNotes(notes, prefs)}<div class="fn">معيار المستويات: الضعاف أقل من ${r.pass}%، والمتفوقون ${r.top}% فأكثر، والمتوسطون ما بينهما.</div>${grSig(prefs, sigTo, sigName)}</div>`;
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
  const box = "font-family:'Helvetica Neue W23 for SKY',Cairo,sans-serif;font-size:8.5pt;color:#55646f"; /* خط الوزارة (style.css) ثم Cairo احتياطًا */
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

/* عرض ارتفاع صفحة A4 المطبوعة بعد الهوامش (180×268 مم) بالبكسل، وهامش أمان */
const GR_FIT_W = 680, GR_FIT_H = 989;

/* إن زاد تقرير الشعبة قليلًا عن صفحة (جهاز بخط أطول مما نتوقع) نضغط التباعد تدريجيًا ليُطبع في صفحة واحدة بدل أن
   ينزل التوقيع وحده لصفحة ثانية. يُقاس على جهاز المعلم نفسه بعرض الطباعة؛ فإن لم ينفع الضغط يبقى التصميم الأصلي. */
function gradeReportFit(html){
  if(typeof document === 'undefined' || !document.createElement || html.indexOf('class="gr-pg"') !== -1 || html.indexOf('<div class="gr">') === -1) return html;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-10000px;top:0;width:${GR_FIT_W}px;visibility:hidden`;
  try{
    document.body.appendChild(probe);
    const heightOf = h => {
      probe.innerHTML = h;
      const gr = probe.querySelector('.gr');
      if(!gr) return 0;
      gr.style.padding = '0';
      return Number(gr.offsetHeight) || 0;
    };
    const h0 = heightOf(html);
    if(!(h0 > 0) || h0 <= GR_FIT_H || h0 > GR_FIT_H * 1.18) return html; /* يناسب صفحة، أو أطول من أن يُنقذه الضغط */
    for(const cls of ['cmp1', 'cmp2']){
      const cand = html.replace('<div class="gr">', `<div class="gr ${cls}">`);
      const h = heightOf(cand);
      if(h > 0 && h <= GR_FIT_H) return cand;
    }
    return html;
  } catch(e){
    return html;
  } finally {
    if(probe.remove) probe.remove();
  }
}

/* تُرجع وعدًا: لا تُطبع الصفحة قبل أن تُفكّ صورة الشعار (وإلا خرجت الترويسة بلا شعار في أول تصدير) */
function gradeReportPrint(html, mark, title){
  const area = document.getElementById('printArea');
  if(!area) return Promise.resolve();
  area.innerHTML = `<style>${gradeReportPrintCss(mark)}</style>` + gradeReportFit(html);
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
  const imgs = area.querySelectorAll ? Array.from(area.querySelectorAll('img')) : [];
  if(!imgs.length){ printNow(); return Promise.resolve(); }
  const decoded = Promise.all(imgs.map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => {})));
  return Promise.race([decoded, new Promise(r => setTimeout(r, 3000))]).then(() => { printNow(); });
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
    await gradeReportPrint(out.html, out.mark, filename);
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
    const base = { logo, schoolLogo: await gradeReportSchoolLogoData(), date: new Date().toISOString().slice(0, 10), year: a.g.year, semester: a.g.semester, withNames };
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
      /* تقرير الشعبة (المجموع أو بند واحد) بهوية الوزارة وتشخيص الصف (app-38، ق8، ق11) */
      return { html: await ssBuildFromAnalysis(a, v, prefs, Object.assign(base, { prev })), mark: gradeReportMark(prefs, 'تقرير أداء الشعبة', a.label) };
      return { html: gradeReportSectionHtml(a, v, prefs, Object.assign(base, { prev })), mark: gradeReportMark(prefs, 'تحليل نتائج الدرجات', a.label) };
    }
    /* مجموعة شعب الصف */
    const sibIds = gradeSiblingSectionIds(a.g);
    if(!sibIds.length){ showToast('لا شعب أخرى لهذا الصف', 'error'); return ''; }
    /* تقرير المقارنة بين الشعب (المجموع أو بند واحد) بهوية الوزارة (app-39، ق9، ق11) */
    {
      const html = await sgBuildFromAnalysis(a, prefs, base);
      return html ? { html, mark: gradeReportMark(prefs, 'تقرير مقارنة شعب الصف', gradeName) } : '';
    }
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
/* كل طلاب الشعبة في ملف PDF واحد: تقرير لكل طالب بصفحة جديدة، ومن لم تُرصد درجاته يُستثنى */
async function exportCrmAllStudentReports(btn, to, ids, scopeLabel){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId || gradeReportBusy) return;
  const g = a.g;
  const prefs = gradeReportPrefsNow();
  const date = new Date().toISOString().slice(0, 10);
  const pool = ids ? a.students.filter(st => ids.has(st.id)) : a.students;
  const list = pool.filter(st => { const d = gradeReportStudentData(g, st.id); return d && d.pts !== null; });
  if(!list.length){ showToast('لا طلاب لهم درجات مرصودة', 'error'); return; }
  const skipped = ids ? 0 : a.students.length - list.length;
  if(skipped) showToast(`${skipped} من الطلاب بلا درجات مرصودة — لم تُضمَّن تقاريرهم`, 'ok');
  await gradeReportRun(btn, async () => {
    /* تقرير الطالب الجديد (app-36، نسخة الدرجات): بنفس كشف الشعبة المحمَّل فلا استعلام إضافي لكل طالب */
    const pages = [];
    for(const st of list){
      const one = await srBuildReport(st.id, 'grades', to, { g });
      pages.push(`<div class="gr-pg">${one.html}</div>`);
    }
    return { html: pages.join(''), mark: gradeReportMark(prefs, 'تقارير أداء الطلاب', a.label + (scopeLabel ? ' · ' + scopeLabel : '')) };
  }, gradeReportFile(scopeLabel ? 'تقارير-' + scopeLabel : 'تقارير-الطلاب', a.label), btn && to ? '…' : undefined);
}

/* من صفحة الطالب في الكشف: نافذة اختيار النسخة (app-36) */
function exportCrmStudentReport(btn){
  return openStudentReportChooser(crmGradeStudentId);
}

/* من قائمة الطلاب داخل نافذة التحليل: نسخة الدرجات بنقرة، والجهة اسمها تحت التوقيع */
function exportCrmStudentReportFor(id, btn, to){
  const a = crmGradeAnalysis;
  if(!a || !crmGrades || crmGrades.sectionId !== a.g.sectionId) return;
  return srRun(id, 'grades', to, btn, a.g);
}

/* ============ خيارات التقارير (إعدادات المعلم) ============ */
let gradeReportDraft = null; /* { host: 'ga' | 'cust', school, teacher, vice, show, notes, error, saving } */

function openGradeReportEditor(host){
  const p = gradeReportPrefsNow();
  gradeReportDraft = { host, logo: p.logo, logoData: '',  school: p.school, teacher: p.teacher, vice: p.vice, staff: p.staff, counselor: p.counselor, subject: p.subject, show: Object.assign({}, p.show), notes: Object.assign({}, p.notes), error: '', saving: false };
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
  gradeReportLogoPreviewLoad();
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
    ${gradeReportLogoField(d)}
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

/* شعار المدرسة: خيار اختياري لكل معلم (يُحفظ مع خياراته). يُقصّ بياضه ويُصغَّر قبل الحفظ */
function gradeReportLogoField(d){
  return `<div class="gr-fld"><span>شعار المدرسة (اختياري — يظهر مقابل شعار الوزارة)</span>
    <div class="gr-logo">${gradeReportLogoPreview(d)}
    <label class="crm-ga-link" style="cursor:pointer">${d.logo || d.logoData ? 'تغيير' : 'رفع صورة'}<input type="file" accept="image/png,image/jpeg" style="display:none" onchange="gradeReportPickLogo(this)"></label>
    ${d.logo || d.logoData ? '<button type="button" class="crm-ga-link" onclick="gradeReportDraftLogo(\'\', true)">حذف</button>' : ''}</div></div>`;
}

/* معاينة: الصورة المختارة حديثًا، وإلا شعار محفوظ يُحمَّل بعد الرسم (لا رابط عام بالصفحة) */
function gradeReportLogoPreview(d){
  if(d.logoData) return `<img src="${d.logoData}" alt="">`;
  return d.logo ? '<img id="grLogoPrev" alt="">' : '';
}
async function gradeReportLogoPreviewLoad(){
  const d = gradeReportDraft, el = document.getElementById('grLogoPrev');
  if(!d || !el || !d.logo) return;
  const url = d.logo === gradeReportPrefsNow().logo ? await gradeReportSchoolLogoData() : '';
  const again = document.getElementById('grLogoPrev');
  if(gradeReportDraft === d && again && url) again.src = url;
}

function gradeReportDataToBlob(url){
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+\/]+={0,2})$/.exec(String(url));
  if(!m) throw new Error('logo');
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/* clear=true: حذف الشعار (المحفوظ والمختار حديثًا)؛ وإلا v = data URL لصورة جديدة تُرفع عند «حفظ» */
function gradeReportDraftLogo(v, clear){
  const d = gradeReportDraft;
  if(!d) return;
  if(clear){ d.logo = ''; d.logoData = ''; } else d.logoData = v;
  d.error = '';
  paintGradeReportEditor();
}

/* يقصّ الهوامش البيضاء/الشفافة ويصغّر إلى عرض أقصاه w؛ يرجع data URL (PNG) أو '' */
function gradeReportLogoShrink(img, w){
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for(let y = 0; y < c.height; y++) for(let x = 0; x < c.width; x++){
    const k = (y * c.width + x) * 4;
    if(px[k + 3] > 20 && (px[k] < 245 || px[k + 1] < 245 || px[k + 2] < 245)){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
  }
  if(x1 < 0) return '';
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, sc = Math.min(1, w / cw);
  const o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(cw * sc)); o.height = Math.max(1, Math.round(ch * sc));
  o.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

async function gradeReportPickLogo(input){
  const d = gradeReportDraft;
  const f = input && input.files && input.files[0];
  if(!d || !f) return;
  if(f.size > 8 * 1024 * 1024){ d.error = 'الصورة كبيرة جدًا'; paintGradeReportEditor(); return; }
  try{
    const url = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(f); });
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    let out = '';
    for(const w of [320, 220, 140]){ out = gradeReportLogoShrink(img, w); if(!out || out.length <= GRADE_REPORT_LOGO_MAX) break; }
    if(gradeReportDraft !== d) return;
    if(!out || out.length > GRADE_REPORT_LOGO_MAX || !GRADE_REPORT_DATA_RE.test(out)){ d.error = 'تعذّر استخدام هذه الصورة'; paintGradeReportEditor(); return; }
    gradeReportDraftLogo(out, false);
  } catch(e){ if(gradeReportDraft === d){ d.error = 'تعذّر قراءة الصورة'; paintGradeReportEditor(); } }
}

function gradeReportDraftText(k, value){ if(gradeReportDraft) gradeReportDraft[k] = value; }
function gradeReportDraftFlag(grp, k, on){ if(gradeReportDraft) gradeReportDraft[grp][k] = !!on; }

function gradeReportEditorReset(){
  const d = gradeReportDraft;
  if(!d) return;
  Object.assign(d, gradeReportDefaultCopy(), { host: d.host, logoData: '', error: '', saving: false });
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
  const uid = currentUser.id;
  const oldLogo = gradeReportPrefsNow().logo;
  d.saving = true;
  const btn = document.getElementById('grEditorSave');
  if(btn) btn.disabled = true;
  /* شعار جديد: يُرفع أولًا بمسار فريد بمجلد المستخدم، ويُحذف إن فشل حفظ الخيارات (لا ملفات يتيمة) */
  let newPath = '';
  if(d.logoData){
    try{
      const blob = gradeReportDataToBlob(d.logoData); /* لا fetch لـdata: — سياسة CSP (connect-src) تمنعه */
      const path = `${uid}/school-logo-${Date.now()}.png`;
      const { error: upErr } = await sb.storage.from('shawahid-photos').upload(path, blob, { contentType: 'image/png' });
      if(upErr) throw upErr;
      newPath = path;
    } catch(e){
      if(gradeReportDraft !== d) return;
      d.saving = false; d.error = 'تعذّر رفع الشعار'; paintGradeReportEditor(); return;
    }
  }
  const p = { school: d.school, logo: newPath || d.logo, teacher: d.teacher, vice: d.vice, staff: d.staff, counselor: d.counselor, subject: d.subject, show: d.show, notes: d.notes };
  const err = await persistGradeReportPrefs(p);
  if(err){
    if(newPath) sb.storage.from('shawahid-photos').remove([newPath]).catch(() => {});
    if(gradeReportDraft !== d) return;
    d.saving = false; d.error = err; paintGradeReportEditor(); return;
  }
  /* نجح الحفظ: الشعار القديم لم يعد مرتبطًا بشيء فيُحذف */
  if(oldLogo && oldLogo !== p.logo && oldLogo.split('/')[0] === uid) sb.storage.from('shawahid-photos').remove([oldLogo]).catch(() => {});
  if(gradeReportDraft !== d) return;
  d.saving = false;
  gradeReportDraft = null;
  if(d.host === 'ga'){
    if(crmGradeAnalysis === a && a){ a.reportEdit = null; a.withNames = gradeReportPrefsNow().show.names; a.withNotes = gradeReportNotesAny(gradeReportPrefsNow()); paintCrmGradeAnalysis(); }
  } else {
    closeCrmModal();
  }
  showToast('حُفظت خيارات التقارير', 'ok');
}
