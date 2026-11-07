'use strict';
/* ============================================================
   تقرير الطالب الفردي (app-36): المستوى، تصنيف المكوّنات، صفوف الفترات، سلّم الأدلة والتوصيات،
   الحضور، الصفحة (نسختان)، الأمان، والتسجيل بـindex.html وsw.js
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const R = { pass: 50, edge: 10, top: 90, severe: 30 };
const J = v => JSON.parse(JSON.stringify(v));

/* صف مكوّن: بند أو مجموعه */
const row = (name, score, max, o) => Object.assign({
  id: name, name, label: name, score, max, pct: 100 * score / max, row: 'item', kind: 'manual', domain: 'tahsili', category: 'tests', live: false, classPct: null
}, o || {});

test('srLevel: متقن · جيد · يحتاج تحسين بحدّي المعلم', () => {
  const app = loadApp();
  assert.equal(app.srLevel(49.9, R).label, 'يحتاج تحسين');
  assert.equal(app.srLevel(50, R).label, 'جيد');
  assert.equal(app.srLevel(89.9, R).label, 'جيد');
  assert.equal(app.srLevel(90, R).label, 'متقن');
  assert.equal(app.srLevel(null, R), null);
  assert.equal(app.srLevel(70, { pass: 70, top: 95 }).label, 'جيد', 'حدود المعلم لا الافتراضية');
  assert.equal(app.srLevel(69, { pass: 70, top: 95 }).label, 'يحتاج تحسين');
});

test('srSevereOf: الافتراضي 30، وإعداد المعلم، ولا يزيد عن حدّ الضعف', () => {
  const app = loadApp();
  assert.equal(app.srSevereOf({ pass: 50 }), 30);
  assert.equal(app.srSevereOf({ pass: 50, severe: 20 }), 20);
  assert.equal(app.srSevereOf({ pass: 50, severe: 80 }), 50);
  assert.equal(app.srSevereOf({ pass: 50, severe: 'x' }), 30);
});

test('srDomainOf: التصنيف تلقائي بنوع المكوّن، وغير المصنَّف لا يُحكم عليه', () => {
  const app = loadApp();
  const tool = { t1: 'score', t2: 'status', t3: 'counter' };
  const of = c => app.srDomainOf(c, id => tool[id] || null);
  assert.equal(of({ category: 'tests' }), 'tahsili');
  assert.equal(of({ category: 'performance', kind: 'task' }), 'tahsili');
  assert.equal(of({ category: 'performance', kind: 'homework' }), 'taalumi');
  assert.equal(of({ category: 'performance', kind: 'participation' }), 'taalumi');
  assert.equal(of({ category: 'performance', tool_id: 't1' }), 'tahsili');
  assert.equal(of({ category: 'performance', tool_id: 't2' }), 'taalumi');
  assert.equal(of({ category: 'performance', tool_id: 't3' }), 'taalumi');
  assert.equal(of({ category: 'performance', kind: 'manual' }), null, 'عمود يدوي غير مصنَّف');
  assert.equal(of({ category: 'performance', tool_id: 'غير-معروف' }), null);
});

/* ============ صفوف الفترات ============ */
function buildRows(items, cfgs, bd){
  const app = loadApp();
  return J(runInAppContext(app, `
    const bd = new Map(Object.entries(${JSON.stringify(bd || {})}).map(([k, v]) => [k, new Map([['s', v]])]));
    const cfgs = ${JSON.stringify(cfgs || {})};
    srBuildRows(${JSON.stringify(items)}, 's', bd, x => cfgs[x.id] || { n: 1, starts: [] }, id => null, () => null)`));
}
const item = (id, name, max, score, o) => Object.assign({ id, name, max, score, kind: 'manual', tool_id: null, category: 'performance' }, o || {});

test('صفوف الفترات: صف لكل فترة منتهية فقط + «المحسوب في المجموع» عند اثنتين فأكثر؛ وما لم يبدأ أو لم ينتهِ لا يظهر (م9، ق5)', () => {
  const out = buildRows([
    item('m', 'المشاركة', 10, 9, { kind: 'participation' }),
    item('h', 'الواجبات', 15, 6, { kind: 'homework' }),
    item('t', 'الاختبار الأول', 10, 9, { category: 'tests' }),
    item('x', 'مهمة', 15, 12, { kind: 'task' })
  ], {
    m: { n: 3, starts: ['2026-10-01', '2026-11-01'] },
    h: { n: 2, starts: ['2026-10-01'], ended: false },
    x: { n: 1, starts: [] }
  }, { m: { p1: 8, p2: 10, p3: 2 }, h: { p1: 5, p2: 7, p3: null } });
  assert.deepEqual(out.rows.map(r => r.label), [
    'المشاركة — الفترة الأولى', 'المشاركة — الفترة الثانية', 'المشاركة — المحسوب في المجموع',
    'الواجبات — الفترة الأولى',
    'الاختبار الأول', 'مهمة'
  ], 'الثالثة جارية للمشاركة والثانية جارية للواجبات: لا تُعرضان');
  const byLabel = Object.fromEntries(out.rows.map(r => [r.label, r]));
  assert.equal(byLabel['المشاركة — المحسوب في المجموع'].row, 'sub');
  assert.equal(byLabel['الواجبات — الفترة الأولى'].row, 'item', 'فترة واحدة معدودة: صف واحد بلا مجموع مكرَّر');
  assert.equal(byLabel['الواجبات — الفترة الأولى'].score, 6, 'درجة المكوّن المحسوبة');
  assert.equal(byLabel['مهمة'].row, 'item', 'فترة واحدة: صف واحد بلا ذكر فترات');
  assert.equal(byLabel['الاختبار الأول'].row, 'item', 'الاختبارات بلا فترات');
  assert.ok(!out.rows.some(r => 'live' in r && r.live), 'لا صفوف جارية');
  /* الفترة الثانية لم تبدأ أصلًا: لا صف لها ولا إشارة */
  const notStarted = buildRows([item('h', 'الواجبات', 15, 6, { kind: 'homework' })], { h: { n: 2, starts: [] } }, { h: { p1: 6, p2: null, p3: null } });
  assert.deepEqual(notStarted.rows.map(r => r.label), ['الواجبات — الفترة الأولى']);
  /* بعد «أنهِ الفترة الأخيرة» تُعرض كلها */
  const ended = buildRows([item('m', 'المشاركة', 10, 6, { kind: 'participation' })], { m: { n: 3, starts: ['2026-10-01', '2026-11-01'], ended: true } }, { m: { p1: 8, p2: 10, p3: 2 } });
  assert.deepEqual(ended.rows.map(r => r.label), ['المشاركة — الفترة الأولى', 'المشاركة — الفترة الثانية', 'المشاركة — الفترة الثالثة', 'المشاركة — المحسوب في المجموع']);
});

test('صفوف الفترات: البند غير المرصود للطالب لا يظهر، والفترة بلا درجة لا تظهر', () => {
  const out = buildRows([item('a', 'أ', 10, null), item('m', 'المشاركة', 10, 8, { kind: 'participation' })],
    { m: { n: 3, starts: ['2026-10-01'] } }, { m: { p1: 8, p2: null, p3: null } });
  assert.deepEqual(out.rows.map(r => r.label), ['المشاركة — الفترة الأولى']);
  assert.deepEqual(out.missing, ['أ'], 'للفحص فقط ولا يُعرض (م9)');
});

/* ============ التقدّم ============ */
test('srProgress: بين فترات المكوّن المنتهية فقط (قياسان فأكثر)، والاختبارات لا تُقارَن إلا بربط أو «يقيس» (ق3، ق4، م2)', () => {
  const app = loadApp();
  const P = (id, n, k, score) => row(n + ' — ' + k, score, 10, { id, name: n, row: 'period', domain: 'taalumi' });
  const one = J(app.srProgress([P('m', 'المشاركة', 'الأولى', 8), P('m', 'المشاركة', 'الثانية', 10)]));
  assert.equal(one.length, 1);
  assert.equal(one[0].from, 80);
  assert.equal(one[0].to, 100);
  assert.equal(one[0].trend, 'up');
  assert.deepEqual(J(app.srProgress([P('m', 'المشاركة', 'الأولى', 8)])), [], 'قياس واحد لا يُحسب');
  assert.equal(app.srProgress([P('m', 'م', 'أ', 8), P('m', 'م', 'ب', 7.5)])[0].trend, 'flat', 'فارق أقل من 10 نقاط');
  assert.equal(app.srProgress([P('m', 'م', 'أ', 8), P('m', 'م', 'ب', 7)])[0].trend, 'down', '10 نقاط بالضبط = تراجع');
  /* انحدار من تقرير حقيقي: «الاختبار الأول» و«اختبار قراءة» اختباران مختلفان لا يُقارَنان */
  assert.deepEqual(J(app.srProgress([row('الاختبار الأول', 4, 10), row('اختبار قراءة', 9, 10)])), [], 'لا تقدّم بين اختبارين');
  assert.deepEqual(J(app.srProgress([row('الاختبار الأول', 12, 20), row('اختبار قراءة', 0, 5)])), [], 'لا «تراجع من 60% إلى 0%»');
  /* ق4: اختبار ربطه المعلم، أو تطابق «يقيس» فيه، يُقارَن؛ وسبب المقارنة يُذكر */
  const T = (n, sc, meas) => row(n, sc, 10, { measures: meas || null });
  const linked = J(app.srProgress([T('الاختبار الأول', 4), T('اختبار قراءة', 9)], [['الاختبار الأول', 'اختبار قراءة']]));
  assert.equal(linked.length, 1);
  assert.equal(linked[0].kind, 'tests');
  assert.equal(linked[0].label, 'ربطهما المعلم');
  assert.equal(linked[0].from, 40);
  assert.equal(linked[0].to, 90);
  assert.equal(linked[0].trend, 'up');
  const same = J(app.srProgress([T('قراءة 1', 4, 'القراءة'), T('نحو', 8, 'القواعد'), T('قراءة 2', 9, ' القراءة ')], []));
  assert.equal(same.length, 1, 'تطابق «يقيس» بعد تنظيف الفراغات');
  assert.equal(same[0].label, 'كلاهما يقيس: القراءة');
  assert.equal(same[0].fromLabel, 'قراءة 1');
  assert.equal(same[0].toLabel, 'قراءة 2');
  assert.deepEqual(J(app.srProgress([T('أ', 4, 'القراءة'), T('ب', 9, 'الكتابة')], [])), [], 'مقيسان مختلفان: لا مقارنة');
  assert.deepEqual(J(app.srProgress([T('أ', 4), T('ب', 9)], [])), [], '«يقيس» الفارغ لا يُطابق الفارغ');
  /* مكوّنان مختلفان بفترات: كلٌّ يُقاس بنفسه ولا يُخلط بالآخر */
  const two = J(app.srProgress([P('m', 'المشاركة', 'أ', 8), P('h', 'الواجبات', 'أ', 5), P('m', 'المشاركة', 'ب', 10), P('h', 'الواجبات', 'ب', 7)]));
  assert.equal(two.length, 2);
  assert.deepEqual(two.map(x => x.name).sort(), ['المشاركة', 'الواجبات']);
});

/* ============ سلّم الأدلة والتوصيات ============ */
const HW = { total: 6, submitted: 2, partial: 0, late: 0, missing: 4 };
const dx = (rows, extra) => J(loadApp().srDiagnose(Object.assign({ rows, rules: R, homework: null, lessonsHeld: 10, overall: { pct: 70, incomplete: false } }, extra || {})));
const hwRow = pct => row('الواجبات', pct * 15 / 100, 15, { kind: 'homework', domain: 'taalumi', category: 'performance' });
const partRow = pct => row('المشاركة', pct / 10, 10, { kind: 'participation', domain: 'taalumi', category: 'performance' });

test('نتيجة منخفضة واحدة = واقعة فقط: لا ضعف مثبت ولا توصية', () => {
  const d = dx([row('أول', 9, 10), row('قصير', 4, 10), row('مهمة', 8, 10, { category: 'performance', kind: 'task' })]);
  assert.equal(d.tahsili.enough, true);
  assert.equal(d.tahsili.weak, null);
  assert.equal(d.tahsili.facts.length, 1);
  assert.match(d.tahsili.facts[0].text, /قصير 40%/);
  assert.deepEqual(d.recommendations, []);
  assert.equal(d.parentContact, false);
});

test('بندان تحصيليان أحدهما منخفض: واقعة فقط (الضعف المثبت يحتاج بندين منخفضين على الأقل)', () => {
  const d = dx([row('أول', 9, 10), row('قصير', 4, 10)]);
  assert.equal(d.tahsili.enough, true);
  assert.equal(d.tahsili.weak, null);
  assert.deepEqual(d.recommendations, []);
});

test('بيانات التحصيل غير الكافية (أقل من بندين): لا حكم ولا توصية', () => {
  const d = dx([row('قصير', 2, 10)]);
  assert.equal(d.tahsili.enough, false);
  assert.deepEqual(d.tahsili.strengths, []);
  assert.deepEqual(d.tahsili.facts, []);
  assert.equal(d.tahsili.weak, null);
  assert.deepEqual(d.recommendations, []);
});

test('ضعف تحصيلي مثبت: بندان دون حدّ الضعف بنصف المرصود فأكثر ← توصية بالدليل والتشخيص والإجراء', () => {
  const d = dx([row('أول', 4, 10), row('ثاني', 3, 10), row('ثالث', 9, 10)]);
  assert.ok(d.tahsili.weak);
  assert.equal(d.recommendations.length, 1);
  const r = d.recommendations[0];
  assert.match(r.evidence, /أول 40%/);
  assert.match(r.evidence, /ثاني 30%/);
  assert.ok(r.diagnosis && r.action);
  /* بندان منخفضان من خمسة (أقل من النصف): لا ضعف مثبت */
  assert.equal(dx([row('أ', 4, 10), row('ب', 3, 10), row('ج', 9, 10), row('د', 9, 10), row('هـ', 9, 10)]).tahsili.weak, null);
});

test('ضعف الواجبات: توصية بسلسلة كاملة؛ وأقل من 3 واجبات = لا بيانات كافية ولا توصية', () => {
  const ok = dx([hwRow(40)], { homework: HW });
  assert.equal(ok.recommendations.length, 1);
  assert.equal(ok.recommendations[0].evidence, 'لم يسلّم 4 من 6 واجبات (الواجبات 40%)');
  assert.equal(ok.recommendations[0].diagnosis, 'ضعف في انتظام إنجاز الواجبات');
  assert.match(ok.recommendations[0].action, /متابعة تسليم الواجبات/);
  const few = dx([hwRow(40)], { homework: { total: 2, submitted: 0, partial: 0, late: 0, missing: 2 } });
  assert.deepEqual(few.recommendations, []);
  assert.equal(few.taalumi.indicators[0].status, 'nodata');
  const none = dx([hwRow(40)], { homework: null });
  assert.equal(none.taalumi.indicators[0].status, 'nodata');
});

test('المشاركة: لا حكم إلا بعد 3 حصص منعقدة؛ والقوة بالمتقن', () => {
  assert.equal(dx([partRow(30)], { lessonsHeld: 2 }).taalumi.indicators[0].status, 'nodata');
  assert.equal(dx([partRow(30)], { lessonsHeld: 3 }).taalumi.indicators[0].status, 'weak');
  assert.equal(dx([partRow(95)], { lessonsHeld: 5 }).taalumi.indicators[0].status, 'strength');
  assert.equal(dx([partRow(70)], { lessonsHeld: 5 }).taalumi.indicators[0].status, 'ok');
  assert.deepEqual(dx([partRow(95)], { lessonsHeld: 5 }).recommendations, [], 'القوة بلا توصية');
});

test('التواصل مع ولي الأمر: ثلاثة شروط فقط، ولا يُولَّد لبند منخفض واحد', () => {
  const weakT = [row('أول', 4, 10), row('ثاني', 3, 10), row('ثالث', 9, 10)];
  /* (أ) ضعف مثبت تحصيلي وتعلّمي معًا */
  const a = dx(weakT.concat([hwRow(40)]), { homework: HW, overall: { pct: 70, incomplete: false } });
  assert.ok(a.recommendations.some(r => r.parent), 'ضعف المستويين');
  /* ضعف تحصيلي وحده ومستوى عام جيد: لا تواصل */
  const onlyT = dx(weakT, { overall: { pct: 70, incomplete: false } });
  assert.equal(onlyT.parentContact, false);
  /* (ب) المستوى العام يحتاج تحسين ببيانات كافية */
  const b = dx([row('أ', 3, 10), row('ب', 9, 10), row('ج', 9, 10)], { overall: { pct: 45, incomplete: false } });
  assert.ok(b.recommendations.some(r => r.parent && /المستوى العام 45%/.test(r.evidence)));
  /* المستوى العام منخفض لكن الرصد غير مكتمل: لا حكم */
  const inc = dx([row('أ', 3, 10), row('ب', 9, 10), row('ج', 9, 10)], { overall: { pct: 45, incomplete: true } });
  assert.equal(inc.parentContact, false);
  assert.equal(inc.overallJudged, false);
  /* (ج) ضعف تحصيلي مستمر شديد: متوسط التحصيل دون 30% — والاستمرار داخل سلسلة قابلة للمقارنة فقط (م2، ق4) */
  const G = { testGroups: [['أ', 'ب', 'ج']] };
  const c = dx([row('أ', 2, 10), row('ب', 2, 10), row('ج', 5, 10)], Object.assign({ overall: { pct: 70, incomplete: false } }, G));
  assert.equal(c.tahsili.persistent, true);
  assert.equal(c.tahsili.avg, 30);
  assert.equal(c.tahsili.severe, false, 'المتوسط 30% ليس دون العتبة 30%');
  const sev = dx([row('أ', 1, 10), row('ب', 2, 10), row('ج', 5, 10)], Object.assign({ overall: { pct: 70, incomplete: false } }, G));
  assert.equal(sev.tahsili.severe, true, 'متوسط 27% دون 30%');
  assert.ok(sev.recommendations.some(r => r.parent && /ضعف تحصيلي مستمر شديد/.test(r.evidence)));
  /* بلا ربط ولا «يقيس» متطابق: اختباران منخفضان متتاليان لا يُعدّان ضعفًا مستمرًا (انحدار ق4) */
  const unlinked = dx([row('أ', 1, 10), row('ب', 2, 10), row('ج', 5, 10)], { overall: { pct: 70, incomplete: false } });
  assert.equal(unlinked.tahsili.persistent, false, 'اختبارات بلا علاقة');
  assert.equal(unlinked.tahsili.severe, false);
  assert.ok(!unlinked.recommendations.some(r => r.parent && /مستمر/.test(r.evidence)));
  /* العتبة قابلة للتغيير من المعلم */
  const mk = sv => J(loadApp().srDiagnose({ rows: [row('أ', 3, 10), row('ب', 3, 10), row('ج', 5, 10)], rules: Object.assign({}, R, { severe: sv }), homework: null, lessonsHeld: 9, overall: { pct: 70, incomplete: false }, testGroups: [['أ', 'ب', 'ج']] }));
  assert.equal(mk(40).tahsili.severe, true, 'متوسط 37% دون عتبة 40%');
  assert.equal(mk(20).tahsili.severe, false);
});

test('كل توصية لها دليل وتشخيص وإجراء، ولا توصية عامة أبدًا عند عدم وجود ضعف', () => {
  const none = dx([row('أ', 9, 10), row('ب', 9.5, 10), partRow(95), hwRow(95)], { homework: { total: 6, submitted: 6, partial: 0, late: 0, missing: 0 } });
  assert.deepEqual(none.recommendations, [], 'لا ضعف مثبت = تقرير مختصر بلا توصيات مخترَعة');
  const many = dx([row('أول', 4, 10), row('ثاني', 3, 10), hwRow(40), partRow(20)], { homework: HW });
  assert.ok(many.recommendations.length >= 3);
  many.recommendations.forEach(r => { assert.ok(r.evidence && r.diagnosis && r.action); });
});

test('المكوّن غير المصنَّف لا يدخل التشخيص', () => {
  const d = dx([row('أول', 4, 10), row('يدوي', 1, 10, { domain: null })]);
  assert.equal(d.tahsili.recorded, 1, 'بند واحد فقط معتبر');
  assert.equal(d.tahsili.enough, false);
});

/* ============ الحضور ============ */
test('srAttendanceSummary: يُخزَّن الاستثناء فقط، والحاضر = الحصص المرصودة − الاستثناءات (انحدار: كان يظهر «حاضر 0»)', () => {
  const app = loadApp();
  const att = [];
  for(let i = 1; i <= 30; i++) att.push({ status: 'absent', lesson: { lesson_date: '2026-10-' + String(i).padStart(2, '0'), period: 2, section_id: 'S' } });
  att.push({ status: 'late', lesson: { lesson_date: '2026-09-02', period: 1, section_id: 'S' } },
    { status: 'permitted_exit', lesson: { lesson_date: '2026-09-03', section_id: 'S' } },
    { status: 'absent', lesson: { lesson_date: '2026-08-01', section_id: 'OLD' } }, { status: 'junk', lesson: null }, { status: 'present', lesson: { lesson_date: '2026-09-01', section_id: 'S' } });
  const s = J(app.srAttendanceSummary(att, 'S', 36));
  assert.deepEqual(s.counts, { present: 4, absent: 30, late: 1, permitted_exit: 1 }, '36 − (30 + 1 + 1) = 4، وغياب الشعبة السابقة لا يُطرح');
  assert.deepEqual(s.prev, { absent: 1, late: 0, permitted_exit: 0 });
  assert.equal(s.list.length, 33, 'كل غياب وتأخر واستئذان (حتى السابقة)، وليس آخر 20 فقط');
  assert.equal(s.list[0].date, '2026-10-30', 'الأحدث أولًا');
  assert.equal(s.list.find(x => x.date === '2026-08-01').prevSection, true, 'شعبة سابقة');
  assert.equal(J(app.srAttendanceSummary([], 'S', 36)).counts.present, 36, 'بلا استثناءات = كل الحصص حضور');
  assert.equal(J(app.srAttendanceSummary(att, 'S', 0)).counts.present, null, 'بلا حصص مرصودة: لا نعرف الحاضر');
  assert.equal(J(app.srAttendanceSummary(att, 'S', 10)).counts.present, 0, 'لا يهبط تحت الصفر');
});

/* ============ الصفحة ============ */
const BASE = {
  version: 'grades', student: { name: 'طالب تجريبي', label: 'ثاني متوسط — الشعبة 3' }, term: { year: '1448', semester: 1 }, date: '2026-11-06',
  prefs: { school: 'مدرسة نموذجية', teacher: 'معلم', counselor: 'سعد', vice: 'ماجد', staff: 'فهد' }, logo: '', schoolLogo: '', to: null, rules: R,
  rows: [], overall: { pts: 40, max: 60, pct: 66.7, incomplete: false, classPts: 33.5 }, missing: [],
  attendance: null, incidents: [], positives: [], followups: [], tasks: [], cases: []
};
function html(version, over){
  const app = loadApp();
  const rows = [row('الاختبار الأول', 9, 10), row('الاختبار القصير', 4, 10)];
  const d = app.srDiagnose({ rows, rules: R, homework: null, lessonsHeld: 0, overall: { pct: 66.7, incomplete: false } });
  return runInAppContext(app, `buildStudentReportHtml2(Object.assign(${JSON.stringify(BASE)}, { version: ${JSON.stringify(version)}, rows: ${JSON.stringify(rows)}, dx: ${JSON.stringify(J(d))} }, ${JSON.stringify(over || {})}))`);
}

test('نسخة الدرجات: أرقام ومستويات فقط — بلا تشخيص ولا حضور ولا مخالفات ولا توصيات', () => {
  const h = html('grades', { incidents: [{ incident_date: '2026-10-01', typeName: 'x', current_stage: 'warning_1' }], attendance: { counts: { present: 1, absent: 1, late: 0, permitted_exit: 0 }, list: [], recorded: 5 }, positives: [{ note_date: '2026-10-02', note_text: 'ممتاز' }] });
  assert.match(h, /تقرير أداء الطالب</);
  assert.match(h, /متقن/);
  assert.match(h, /يحتاج تحسين/);
  for(const gone of ['التشخيص', 'التوصيات', 'الحضور', 'المواقف السلوكية', 'الملاحظات الإيجابية', 'الخطوة التالية', 'متوسط الشعبة']) assert.doesNotMatch(h, new RegExp(gone), gone);
  assert.match(h, /font-family:'Helvetica Neue W23 for SKY'/, 'خط الوزارة');
  assert.doesNotMatch(h, /موجّه إلى/, 'لا سطر جهة بالترويسة');
});

test('النسخة التحليلية: كل قسم يظهر فقط إن وُجدت بياناته، بلا اختصار', () => {
  const empty = html('analytical');
  for(const gone of ['الحضور', 'المواقف السلوكية', 'الملاحظات الإيجابية', 'المتابعات المسجلة', 'حالات المتابعة الأكاديمية', 'المهام الأدائية']) assert.doesNotMatch(empty, new RegExp(gone), gone + ' بلا بيانات');
  assert.match(empty, /التشخيص: ماذا يتقن الطالب/);
  assert.match(empty, /الخطوة التالية المتفق عليها/);
  assert.match(empty, /متوسط الشعبة/);
  const list = []; for(let i = 1; i <= 25; i++) list.push({ status: 'absent', date: '2026-10-' + String(i).padStart(2, '0'), period: 1, prevSection: false });
  const inc = []; for(let i = 1; i <= 15; i++) inc.push({ incident_date: '2026-10-' + String(i).padStart(2, '0'), typeName: 'مخالفة ' + i, current_stage: 'warning_1', occurrence_number: i, notes: 'ملاحظة ' + i, referral_letter_generated: i === 15 });
  const full = html('analytical', {
    attendance: { counts: { present: 20, absent: 25, late: 1, permitted_exit: 2 }, list, recorded: 48 },
    incidents: inc, positives: [{ note_date: '2026-10-02', note_text: 'ساعد زميله' }],
    followups: [{ created_at: '2026-10-21T10:00:00Z', reason_text: 'عدم تسليم الواجبات', status: 'open', review_date: '2026-11-20', next_step: 'اتصال' }],
    tasks: [{ title: 'عرض', result: '12 من 15', due: '2026-10-20' }],
    cases: [{ subject: 'إنجليزي', weakness_description: 'ضعف القراءة', plan_description: 'خطة', status: 'referred', plan_started_at: '2026-09-15', referral_letter_generated: true }]
  });
  for(const here of ['الحضور', 'المواقف السلوكية', 'الملاحظات الإيجابية', 'المتابعات المسجلة', 'حالات المتابعة الأكاديمية', 'المهام الأدائية', 'مستأذن']) assert.match(full, new RegExp(here), here);
  assert.equal((full.match(/>غائب</g) || []).length >= 1, true);
  assert.equal((full.match(/<td>2026-10-\d\d<\/td><td class="n"><bdi dir="ltr">1<\/bdi><\/td>/g) || []).length, 25, 'كل غياب موجود، ليس آخر 20');
  assert.match(full, /<table class="two"/, 'قائمة الحضور بعمودين متجاورين لتوفير المساحة');
  assert.equal((full.match(/<table class="two"[\s\S]*?<\/table>/)[0].match(/<tr><td>/g) || []).length, 13, '25 سجلًا = 13 صفًّا (صف = سجلان)');
  assert.equal((full.match(/مخالفة \d+/g) || []).length, 15, 'كل المخالفات');
  assert.match(full, /صدر خطاب إحالة/);
  assert.match(full, /الخطوة التالية: اتصال/);
  assert.match(full, /محال للموجه/);
});

test('الجهة الموجَّه إليها: اسمها تحت خانة توقيعها فقط، وتحليلي بتوقيعات المعلم والموجه والوكيل', () => {
  const g = html('grades', { to: 'وكيل شؤون الطلاب' });
  assert.match(g, /<div><small>ماجد<\/small>وكيل شؤون الطلاب<\/div>/);
  assert.match(g, /<div><small>معلم<\/small>المعلم<\/div>/);
  assert.match(html('grades', { to: null }), /<div><small><\/small>ولي الأمر<\/div>/);
  assert.match(html('grades', { to: 'الموجه الطلابي' }), /<small>سعد<\/small>الموجه الطلابي/);
  assert.match(html('grades', { to: 'وكيل شؤون المعلمين' }), /<small>فهد<\/small>وكيل شؤون المعلمين/);
  const a = html('analytical');
  assert.match(a, /<small>سعد<\/small>الموجه الطلابي/);
  assert.match(a, /<small>ماجد<\/small>وكيل شؤون الطلاب/);
});

test('XSS: كل نص من المستخدم/القاعدة يُهرَّب (اسم، مخالفة، متابعة، حالة، مهمة، إيجابية، مدرسة)', () => {
  const X = '<img src=x onerror=alert(1)>';
  const h = html('analytical', {
    student: { name: X, label: X }, prefs: Object.assign({}, BASE.prefs, { school: X, teacher: X, counselor: X }), to: null,
    incidents: [{ incident_date: '2026-10-01', typeName: X, notes: X, current_stage: 'warning_1' }],
    positives: [{ note_date: '2026-10-02', note_text: X }], tasks: [{ title: X, result: X, due: X }],
    followups: [{ created_at: '2026-10-21', reason_text: X, status: 'open', review_date: X, next_step: X }],
    cases: [{ subject: X, weakness_description: X, plan_description: X, status: 'plan_active', plan_started_at: X }]
  });
  assert.doesNotMatch(h, /<img src=x/);
  assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 10);
});

test('الأرقام تُعزل (bdi) فلا تنعكس «40 / 60» داخل النص العربي', () => {
  const h = html('grades');
  assert.match(h, /<bdi dir="ltr">9 \/ 10<\/bdi>/);
  assert.match(h, /<bdi dir="ltr">40 \/ 60<\/bdi>/);
});

test('المستوى العام لا يُحكم به بلا أدلة كافية، وتُذكر العلة', () => {
  const app = loadApp();
  const rows = [row('قصير', 4, 10)];
  const d = J(app.srDiagnose({ rows, rules: R, homework: null, lessonsHeld: 0, overall: { pct: 40, incomplete: false } }));
  const h = runInAppContext(app, `buildStudentReportHtml2(Object.assign(${JSON.stringify(BASE)}, { rows: ${JSON.stringify(rows)}, overall: { pts: 4, max: 10, pct: 40, incomplete: false, classPts: null }, dx: ${JSON.stringify(d)} }))`);
  assert.match(h, /لا أدلة كافية للحكم على المستوى العام/);
});

test('فترات المكوّن: نسخة الدرجات صف لكل فترة بلا صف مجموع (ق6)، والتشخيص يبقى معتمدًا على المكوّن الكلي', () => {
  const built = buildRows([item('h', 'الواجبات', 15, 6, { kind: 'homework' })], { h: { n: 2, starts: ['2026-10-01'], ended: true } }, { h: { p1: 5, p2: 7, p3: null } });
  assert.deepEqual(built.rows.map(r => r.row), ['period', 'period', 'sub'], 'الصف الكلي موجود كبيانات');
  const g = html('grades', { rows: built.rows });
  assert.match(g, /الواجبات — الفترة الأولى/);
  assert.match(g, /الواجبات — الفترة الثانية/);
  assert.doesNotMatch(g, /المحسوب في المجموع|الداخل في المجموع/, 'نسخة الدرجات: لا صف مجموع ولا نص بديل');
  /* التشخيص يستعمل صف المكوّن الكلي (6 من 15 = 40%) فيُنتج توصية الواجبات */
  const d = dx(built.rows.map(r => Object.assign({}, r, { kind: 'homework', domain: 'taalumi' })), { homework: { total: 6, submitted: 2, partial: 0, late: 0, missing: 4 } });
  assert.equal(d.recommendations.length, 1);
  assert.match(d.recommendations[0].evidence, /لم يسلّم 4 من 6/);
});

test('ما لم يُرصد لا يظهر ولا يُسمّى: لا بند ولا سطر «لم تُرصد بعد» (م9، ق5)', () => {
  const h = html('grades', { missing: ['النهائي'] });
  assert.doesNotMatch(h, /النهائي|لم تُرصد بعد/);
  const a = html('analytical', { missing: ['النهائي'] });
  assert.doesNotMatch(a, /النهائي|لم تُرصد بعد/);
});

test('الفترات التي لم تنتهِ لا تظهر في الصفحة ولا يُشار إليها (م9، ق5)', () => {
  const built = buildRows([item('m', 'المشاركة', 10, 9, { kind: 'participation' }), item('h', 'الواجبات', 15, 6, { kind: 'homework' })],
    { m: { n: 3, starts: ['2026-10-01', '2026-11-01'] }, h: { n: 2, starts: ['2026-10-01'] } }, { m: { p1: 8, p2: 10, p3: 2 }, h: { p1: 5, p2: 7, p3: null } });
  for(const v of ['grades', 'analytical']){
    const h = html(v, { rows: built.rows });
    assert.doesNotMatch(h, /جارية|لم تدخل|الفترة الثالثة|الثالثة/, v);
  }
  const g = html('grades', { rows: built.rows });
  assert.match(g, /المشاركة — الفترة الثانية/);
  assert.match(g, /الواجبات — الفترة الأولى/);
  assert.doesNotMatch(g, /الواجبات — الفترة الثانية/);
  const a = html('analytical', { rows: built.rows });
  assert.match(a, /<td rowspan="2" class="gn"><b>المشاركة<\/b><\/td>/, 'فترتان منتهيتان: خلية مدمجة');
  assert.match(a, /<td class="n">الثانية<\/td>/);
  assert.doesNotMatch(a, /<td rowspan="\d" class="gn"><b>الواجبات/, 'فترة واحدة معدودة: صف واحد لا مجموعة');
});

/* ============ الجدول التحليلي: الخيار ج (ق7) ============ */
test('srPeriodClassPct: متوسط الشعبة لفترة المكوّن من درجات كل الطلاب، وغير المرصود لا يُحسب', () => {
  const app = loadApp();
  const bd = new Map([['m', new Map([['a', { p1: 8, p2: 10 }], ['b', { p1: 6, p2: null }], ['c', { p1: null, p2: 5 }], ['d', null]])]]);
  const f = (id, k, max) => runInAppContext(app, `srPeriodClassPct(new Map([['m', new Map(${JSON.stringify([...bd.get('m')])})]]), ${JSON.stringify(id)}, ${k}, ${max})`);
  assert.equal(f('m', 1, 10), 70, '(8 + 6) / 2 / 10');
  assert.equal(f('m', 2, 10), 75, '(10 + 5) / 2 / 10');
  assert.equal(f('m', 3, 10), null, 'لا أحد');
  assert.equal(f('x', 1, 10), null, 'مكوّن غير موجود');
  assert.equal(f('m', 1, 0), null, 'درجة كاملة صفر');
  assert.equal(runInAppContext(app, 'srPeriodClassPct(null, "m", 1, 10)'), null);
});

test('صفوف الفترات تحمل متوسط شعبتها من breakdown، ومن لا فترات له لا يتأثر', () => {
  const app = loadApp();
  const out = J(runInAppContext(app, `
    const bd = new Map([['m', new Map([['s', { p1: 8, p2: 10, p3: null }], ['t', { p1: 6, p2: 5, p3: null }]])]]);
    srBuildRows(${JSON.stringify([item('m', 'المشاركة', 10, 9, { kind: 'participation' })])}, 's', bd, () => ({ n: 3, starts: ['2026-10-01', '2026-11-01'], ended: true }), () => 73, () => null)`));
  const by = Object.fromEntries(out.rows.map(r => [r.label, r]));
  assert.equal(by['المشاركة — الفترة الأولى'].classPct, 70);
  assert.equal(by['المشاركة — الفترة الثانية'].classPct, 75);
  assert.equal(by['المشاركة — المحسوب في المجموع'].classPct, 73, 'متوسط المكوّن الكلي من كشف الدرجات');
});

test('الجدول التحليلي (ج): خلية مدمجة للمكوّن، متوسط شعبة لكل فترة، وعمود «الداخل في المجموع» مدمج بدرجة المكوّن ومستواه ومتوسطه', () => {
  const app = loadApp();
  const built = J(runInAppContext(app, `
    const bd = new Map([['m', new Map([['s', { p1: 8, p2: 10, p3: null }], ['t', { p1: 6, p2: 5, p3: null }]])]]);
    srBuildRows(${JSON.stringify([
      item('m', 'المشاركة', 10, 9, { kind: 'participation' }),
      item('t1', 'الاختبار الأول', 10, 9, { category: 'tests', measures: 'القراءة' })
    ])}, 's', bd, x => x.id === 'm' ? { n: 2, starts: ['2026-10-01'], ended: true } : null, id => id === 'm' ? 73 : 68, () => null)`));
  const a = html('analytical', { rows: built.rows });
  assert.match(a, /<th class="n">الفترة<\/th><th class="n">الدرجة<\/th><th class="n">المستوى<\/th><th class="n">متوسط الشعبة<\/th><th class="n">الداخل في المجموع<\/th>/);
  assert.doesNotMatch(a, /<th class="n">المجال<\/th>/, 'عمود المجال حُذف كما في الصورة المعتمدة');
  assert.match(a, /<td rowspan="2" class="gn"><b>المشاركة<\/b><\/td><td class="n">الأولى<\/td>/);
  assert.match(a, /<td class="n"><bdi dir="ltr">70%<\/bdi><\/td><td rowspan="2" class="n cnt"><b><bdi dir="ltr">9 \/ 10<\/bdi><\/b>/, 'متوسط الفترة الأولى 70% ثم الخلية المدمجة 9 / 10');
  assert.match(a, /<td class="n">الثانية<\/td>/);
  assert.match(a, /<bdi dir="ltr">75%<\/bdi>/, 'متوسط الفترة الثانية');
  assert.match(a, /الشعبة <bdi dir="ltr">73%<\/bdi>/, 'متوسط شعبة المكوّن الكلي بالخلية المدمجة');
  assert.equal((a.match(/rowspan="2"/g) || []).length, 2, 'خليتان مدمجتان فقط: اسم المكوّن، والداخل في المجموع');
  assert.match(a, /<tbody class="grp">/, 'كل مكوّن في tbody لا ينقسم بين صفحتين');
  /* الاختبار: صف واحد، الفترة «—»، ودرجته تتكرر بالعمود الأخير، و«يقيس» تحت اسمه */
  assert.match(a, /<td><b>الاختبار الأول<\/b><div class="ev">يقيس: القراءة<\/div><\/td><td class="n">—<\/td>/);
  assert.match(a, /<td class="n cnt"><b><bdi dir="ltr">9 \/ 10<\/bdi><\/b><\/td><\/tr><\/tbody>/);
  /* نسخة الدرجات بلا تغيير: لا أعمدة شعبة ولا «الداخل في المجموع» */
  const g = html('grades', { rows: built.rows });
  assert.doesNotMatch(g, /الداخل في المجموع|متوسط الشعبة|rowspan/);
});

/* ============ الدمج والأمان ============ */
const SRC = read('app/app-36-student-report.js');

test('الاستعلامات مفلترة بـteacher_id صراحةً، وملاحظات المعلم الخاصة لا تدخل التقرير', () => {
  assert.match(SRC, /sb\.from\('academic_cases'\)[\s\S]{0,200}\.eq\('teacher_id', currentUser\.id\)\.eq\('student_id', studentId\)/);
  assert.doesNotMatch(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /classroom_private_notes|privateNotes\s*[,.)\]]/, 'لا استعمال لملاحظات المعلم الخاصة');
  const app = loadApp();
  const h = runInAppContext(app, `buildStudentReportHtml2(Object.assign(${JSON.stringify(BASE)}, { version: 'analytical', dx: srDiagnose({ rows: [], rules: ${JSON.stringify(R)}, homework: null, lessonsHeld: 0, overall: {} }), privateNotes: [{ body: 'سر المعلم' }] }))`);
  assert.doesNotMatch(h, /سر المعلم/);
});

test('الملف مسجَّل بـindex.html وAPP_SHELL، والخط والشعار محليان، وخط الوزارة بـ@font-face', () => {
  assert.match(read('index.html'), /app\/app-36-student-report\.js/);
  const sw = read('sw.js');
  assert.match(sw, /\.\/app\/app-36-student-report\.js/);
  for(const f of ['HelveticaNeueW23forSKY-Regular.ttf', 'HelveticaNeueW23forSKY-Bold.ttf']){
    assert.ok(fs.existsSync(path.join(root, 'fonts', f)), f);
    assert.match(sw, new RegExp('\\./fonts/' + f.replace('.', '\\.')));
    assert.match(read('style.css'), new RegExp("url\\('fonts/" + f.replace('.', '\\.') + "'\\)"));
  }
  assert.match(read('style.css'), /font-family:'Helvetica Neue W23 for SKY';font-weight:400/);
  assert.match(read('style.css'), /font-family:'Helvetica Neue W23 for SKY';font-weight:700/);
  assert.match(read('index.html'), /font-src 'self'/, 'CSP يسمح بالخط المحلي');
});

test('الأزرار: ملف الطالب والكشف يفتحان نافذة اختيار النسخة، وتقرير الاجتماع القديم أُزيل من ملف الطالب', () => {
  assert.match(read('app/app-15-student-profile.js'), /openStudentReportChooser\('\$\{student\.id\}'\)/);
  assert.doesNotMatch(read('app/app-15-student-profile.js'), /onclick="printCrmStudentReport/);
  assert.match(read('app/app-17-grades.js'), /openStudentReportChooser\('\$\{st\.id\}'\)/);
});

test('نافذة الاختيار: نسختان، وتهريب اسم الطالب، والجهة لنسخة الدرجات', () => {
  const app = loadApp();
  runInAppContext(app, `
    crmStudents = [{ id: 's1', full_name: '<b>x</b>', section_id: null }];
    window.__m = []; showInfoModal = h => window.__m.push(h);
    openStudentReportChooser('s1');`);
  const m = app.__m[0];
  assert.match(m, /srChooserGo\('s1','analytical'\)/);
  assert.match(m, /srChooserGo\('s1','grades'\)/);
  assert.doesNotMatch(m, /<b>x<\/b>/);
  assert.match(m, /&lt;b&gt;x&lt;\/b&gt;/);
  for(const t of ['ولي الأمر', 'الموجه الطلابي', 'وكيل شؤون الطلاب', 'وكيل شؤون المعلمين']) assert.match(m, new RegExp(t));
});

/* ============ مفاتيح التشغيل: الموقوف لا يظهر ولا يُقرأ ============ */
function e2e(setup){
  const app = loadApp({ currentUser: { id: 'u1', user_metadata: { full_name: 'م' } } });
  runInAppContext(app, `
    crmStudents = [{ id: 's', full_name: 'طالب', section_id: null }]; crmGradeLevels = []; crmSections = []; crmIncidentTypes = [{ id: 't' }];
    studentClassLabel = () => ({ grade: 'غ', section: 'ش' });
    window.__cases = 0; srLoadCases = async () => { window.__cases++; return [{ subject: 'مادة', weakness_description: 'ضعف', status: 'plan_active' }]; };
    loadCrmStudentProfileData = async () => ({ studentId: 's', currentSectionId: null, recordedLessons: 5,
      attendance: [{ status: 'absent', lesson: { lesson_date: '2026-10-01', period: 1, section_id: null } }],
      incidents: [{ incident_date: '2026-10-02', typeName: 'مخالفة س', current_stage: 'warning_1' }],
      positives: [{ note_date: '2026-10-03', note_text: 'إيجابي' }], tasks: [],
      followups: [{ created_at: '2026-10-04', reason_text: 'متابعة س', status: 'open', review_date: '2026-11-01' }],
      privateNotes: [{ body: 'سر المعلم' }] });
    gradeReportLogoData = async () => ''; gradeReportSchoolLogoData = async () => '';
    ${setup}
    window.__p = srBuildReport('s', 'analytical', null, {});`);
  return app;
}

test('الافتراضي (المتابعات والمتابعة الأكاديمية موقوفتان بالمنتج): لا تظهران ولا يُقرأ جدول الحالات', async () => {
  const app = e2e('appToolOn = () => true;');
  const out = await app.__p;
  assert.match(out.html, /الحضور/);
  assert.match(out.html, /<td class="n"><bdi dir="ltr">4<\/bdi><\/td><td class="n"><bdi dir="ltr">0<\/bdi><\/td><td class="n"><bdi dir="ltr">1<\/bdi>/, 'حاضر 4 = 5 حصص − غياب 1');
  assert.match(out.html, /المواقف السلوكية/);
  assert.match(out.html, /الملاحظات الإيجابية/);
  assert.doesNotMatch(out.html, /المتابعات المسجلة|متابعة س/, 'FOLLOWUPS_ON = false');
  assert.doesNotMatch(out.html, /حالات المتابعة الأكاديمية/, 'ACADEMIC_ON = false');
  assert.equal(app.__cases, 0, 'جدول academic_cases لا يُقرأ');
  assert.doesNotMatch(out.html, /سر المعلم/);
});

test('عند تشغيلهما: المتابعات والحالات الأكاديمية تظهر', async () => {
  const app = e2e('appToolOn = () => true; followupsOn = () => true; ACADEMIC_ON = true;');
  const out = await app.__p;
  assert.match(out.html, /المتابعات المسجلة/);
  assert.match(out.html, /متابعة س/);
  assert.match(out.html, /حالات المتابعة الأكاديمية/);
  assert.equal(app.__cases, 1);
});

test('أداة الحضور أو السلوك موقوفة: قسمها لا يظهر في التقرير', async () => {
  const off = await e2e("appToolOn = k => k !== 'attendance' && k !== 'behavior';").__p;
  assert.doesNotMatch(off.html, /<h2>الحضور<\/h2>/);
  assert.doesNotMatch(off.html, /المواقف السلوكية|مخالفة س/);
  assert.match(off.html, /الملاحظات الإيجابية/);
});

/* ============ تعارض الأصناف مع style.css (انحدار: .sign و.rec و.meta العامة شوّهت التقرير على الجهاز) ============ */
test('أصناف التقرير لا تتعارض مع أي قاعدة عامة في style.css (سرّبت .sign max-width و.rec padding سابقًا)', () => {
  const block = SRC.slice(SRC.indexOf('const SR_CSS = `'), SRC.indexOf('`;', SRC.indexOf('const SR_CSS = `')));
  const names = [...new Set([...block.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(m => m[1]))].filter(n => n !== 'sr');
  assert.ok(names.length > 20, 'استُخرجت أصناف التقرير');
  const css = read('style.css').split('\n');
  const clashes = [];
  /* قاعدة عامة تبدأ بالصنف نفسه (أو بعد #printArea) تطال عناصر التقرير؛ أما «.sign .box» فلا تطال إلا ما بداخل .sign */
  css.forEach((line, i) => {
    if(!line.includes('{')) return;
    line.split('{')[0].split(',').forEach(sel => {
      names.forEach(n => {
        if(new RegExp('^\\s*(?:#printArea\\s+)?\\.' + n + '(?![A-Za-z0-9_-])').test(sel)) clashes.push(`.${n} @ style.css:${i + 1}`);
      });
    });
  });
  assert.deepEqual(clashes, [], 'صنف التقرير يطابق قاعدة عامة: غيّر اسمه (استعمل أسماء فريدة)');
  for(const old of ['meta', 'rec', 'sign']) assert.ok(!names.includes(old), '.' + old + ' أُعيدت تسميته');
});
