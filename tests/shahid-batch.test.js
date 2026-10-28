'use strict';
/* ============================================================
   تجهيز الشواهد دفعة واحدة (app-33-shahid-batch.js)
   ------------------------------------------------------------
   المسودة بجدول مستقل (shahid_drafts) ولا تصير شاهدًا إلا بإرفاق صورة:
   1) دوال صرفة: توزيع التواريخ، الاقتراح التلقائي بحد 4 للعنصر، بناء السجلات.
   2) التحويل: يحمل معرّف المسودة (لا تكرار)، يحذف المسودة، ينظّف الصور عند الفشل.
   3) عزل المستخدم: loadBatchDrafts لا تجلب مسودات غيره.
   4) التوصيل: view تُخفى، sw/index، المخطط والنسخ الاحتياطية.
   ============================================================ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/* ---------- 1) دوال صرفة ---------- */
test('batchSchoolDays — تستثني الجمعة والسبت', () => {
  const app = loadApp();
  // 2026-10-04 أحد … 2026-10-10 سبت
  const days = [...app.batchSchoolDays('2026-10-04', '2026-10-11')];
  assert.deepEqual(days, ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11']);
  assert.deepEqual([...app.batchSchoolDays('2026-10-11', '2026-10-04')], [], 'نطاق مقلوب = لا أيام');
});

test('batchSpreadDates — موزّعة تصاعديًا داخل النطاق وبأيام دراسة فقط', () => {
  const app = loadApp();
  const dates = [...app.batchSpreadDates(24, '2026-08-30', '2026-10-27')];
  assert.equal(dates.length, 24);
  assert.deepEqual([...dates].sort(), dates, 'مرتّبة تصاعديًا');
  assert.ok(dates.every(d => d >= '2026-08-30' && d <= '2026-10-27'));
  assert.ok(dates.every(d => ![5, 6].includes(app.weekdayOfIso(d))), 'لا جمعة ولا سبت');
  assert.ok(new Set(dates).size > 12, 'تواريخ متفاوتة وليست متطابقة');
  assert.deepEqual([...app.batchSpreadDates(1, '2026-10-04', '2026-10-08')], ['2026-10-08']);
  assert.deepEqual([...app.batchSpreadDates(0, '2026-10-04', '2026-10-08')], []);
});

/* ---------- توزيع التواريخ بحسب التقويم الرسمي (عيّنة من 1448-1449 لبقية المناطق) ---------- */
function calFixture(app){
  const weeks = [];
  const add = (iso, label, note, semester) => weeks.push({ gregorian_date: iso, week_label: label, note: note || null, semester: semester || 1 });
  // أيام عودة المعلمين قبل بدء الطلاب
  ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].forEach(d => add(d, 'عودة المعلمين والمعلمات'));
  // 23 أغسطس → 5 نوفمبر: أحد-خميس فقط، مع اليوم الوطني وإجازة إضافية
  let d = '2026-08-23';
  while(d <= '2026-11-05'){
    const wd = app.weekdayOfIso(d);
    if(wd <= 4){
      const note = (d === '2026-09-23' || d === '2026-09-24') ? 'اليوم الوطني' : (d === '2026-10-25' ? 'إجازة إضافية' : null);
      add(d, 'الأسبوع', note);
    }
    d = app.addDaysIso(d, 1);
  }
  // أيام اختبارات
  add('2026-11-08', 'الأسبوع', 'اختبارات نهاية الفصل');
  // الفصل الثاني
  add('2027-01-17', 'الأسبوع الأول', null, 2);
  add('2027-01-18', 'الأسبوع الأول', null, 2);
  const holidays = [
    { holiday_name: 'إجازة الخريف', event_label: 'تبدأ إجازة الخريف', gregorian_date: '2026-11-20' },
    { holiday_name: 'إجازة الخريف', event_label: 'تنتهي الاجازة', gregorian_date: '2026-11-28' }
  ];
  return { weeks, holidays };
}

test('batchDayStatus/batchCalendarDays — تستبعد اليوم الوطني والإجازة الإضافية وعودة المعلمين وأيام الاختبارات', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  const days = [...app.batchCalendarDays(weeks, holidays, '2026-08-16', '2026-11-10')];
  assert.ok(!days.includes('2026-09-23') && !days.includes('2026-09-24'), 'اليوم الوطني مستبعد');
  assert.ok(!days.includes('2026-10-25'), 'الإجازة الإضافية مستبعدة');
  assert.ok(!days.includes('2026-08-17'), 'أيام عودة المعلمين قبل الطلاب مستبعدة');
  assert.ok(!days.includes('2026-11-08'), 'أيام الاختبارات مستبعدة');
  assert.ok(days.includes('2026-08-23') && days.includes('2026-09-22') && days.includes('2026-10-26'));
  assert.ok(days.every(x => ![5, 6].includes(app.weekdayOfIso(x))));
  // إجازة طويلة من جدول holidays تُستبعد حتى لو وُجد صف أسبوع فيها
  const w2 = weeks.concat([{ gregorian_date: '2026-11-22', week_label: 'x', note: null, semester: 1 }]);
  assert.deepEqual([...app.batchCalendarDays(w2, holidays, '2026-11-22', '2026-11-22')], []);
  assert.deepEqual([...app.batchCalendarDays(weeks, holidays, '2026-11-10', '2026-08-16')], [], 'نطاق مقلوب');
});

test('batchSpreadDates بأيام التقويم — لا تقع على إجازة، تغطي الفترة، بلا تكرار، وتبقى مرتّبة', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  const days = [...app.batchCalendarDays(weeks, holidays, '2026-09-02', '2026-10-28')];
  for(const rng of [() => 0, () => 0.999999, Math.random]){
    const dates = [...app.batchSpreadDates(24, '2026-09-02', '2026-10-28', { days, rng })];
    assert.equal(dates.length, 24);
    assert.deepEqual([...dates].sort(), dates, 'مرتّبة تصاعديًا');
    assert.ok(dates.every(d => days.includes(d)), 'كلها أيام دراسة فعلية');
    assert.ok(!dates.includes('2026-09-23') && !dates.includes('2026-09-24') && !dates.includes('2026-10-25'));
    assert.equal(new Set(dates).size, 24, 'بلا تكرار يوم ما دامت الأيام أكثر من البطاقات');
  }
  // الجيتر: نتيجتان مختلفتان بـ rng مختلفين (ليست مسافات متطابقة ثابتة)
  const a = app.batchSpreadDates(24, '2026-09-02', '2026-10-28', { days, rng: () => 0 });
  const b = app.batchSpreadDates(24, '2026-09-02', '2026-10-28', { days, rng: () => 0.999999 });
  assert.notDeepEqual([...a], [...b]);
  // بطاقات أكثر من الأيام: تتكرر بالتساوي ولا تخرج عن الأيام
  const few = [...app.batchSpreadDates(10, 'a', 'b', { days: ['2026-10-04', '2026-10-05', '2026-10-06'] })];
  assert.equal(few.length, 10);
  assert.ok(few.every(x => ['2026-10-04', '2026-10-05', '2026-10-06'].includes(x)));
});

test('batchPeriodRange/batchCurrentSemester — فصول جاهزة من أول يوم طلاب إلى آخر يوم دراسة (بلا قصّ عند اليوم)', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  const s1 = app.batchPeriodRange(weeks, holidays, 'sem1');
  assert.deepEqual({ ...s1 }, { available: true, from: '2026-08-23', to: '2026-11-05', startsOn: '2026-08-23' }, 'لا يبدأ بأيام المعلمين ولا ينتهي بيوم اختبار');
  const s2 = app.batchPeriodRange(weeks, holidays, 'sem2');
  assert.deepEqual([s2.available, s2.from, s2.to], [true, '2027-01-17', '2027-01-18'], 'الفصل الثاني متاح دائمًا');
  const year = app.batchPeriodRange(weeks, holidays, 'year');
  assert.deepEqual([year.from, year.to], ['2026-08-23', '2027-01-18'], 'العام كاملًا حتى آخر يوم دراسة');
  assert.equal(app.batchPeriodRange([], [], 'sem1').available, false);
  assert.equal(app.batchCurrentSemester(weeks, holidays, '2026-10-28'), 1);
  assert.equal(app.batchCurrentSemester(weeks, holidays, '2027-01-17'), 2);
  assert.equal(app.batchCurrentSemester(weeks, holidays, '2026-08-18'), null);
});

test('batchWeekRows — أسابيع المعاينة: إجازات بأسمائها، شواهد بعددها، وما خارج الفترة فارغ', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  // 2026-09-20 أحد … 2026-09-24 خميس (اليوم الوطني 23-24) + 2026-09-27 أحد
  const rows = app.batchWeekRows('2026-09-21', '2026-09-27', weeks, holidays, ['2026-09-21', '2026-09-22', '2026-09-22'], true);
  assert.equal(rows.length, 2);
  const c = rows[0].cells;
  assert.equal(c[0].status, 'out', 'الأحد 20 قبل بداية الفترة');
  assert.equal(c[1].status, 'pick');
  assert.equal(c[2].status, 'pick'); assert.equal(c[2].count, 2);
  assert.deepEqual([c[3].status, c[3].reason], ['off', 'اليوم الوطني']);
  assert.equal(c[4].status, 'off');
  assert.equal(rows[1].cells[0].status, 'study', 'الأحد 27 يوم دراسة بلا شاهد');
  assert.equal(rows[1].cells[1].status, 'out');
  // بلا تقويم: لا إجازات، فقط تعليم الشواهد
  const noCal = app.batchWeekRows('2026-09-21', '2026-09-24', [], [], [], false);
  assert.ok(noCal[0].cells.slice(1).every(x => x.status === 'study'));
  // الفترة تبدأ يوم جمعة: تُرحَّل لأحد التالي
  const fri = app.batchWeekRows('2026-10-02', '2026-10-05', weeks, holidays, [], true);
  assert.equal(fri.length, 1);
  assert.equal(fri[0].cells[0].iso, '2026-10-04');
  assert.deepEqual([...app.batchWeekRows('2026-10-10', '2026-10-04', weeks, holidays, [], true)], []);
  const fut = app.batchWeekRows('2026-09-27', '2026-10-01', weeks, holidays, ['2026-10-01'], true, '2026-09-29');
  assert.deepEqual([...fut[0].cells.map(c => !!c.future)], [false, false, false, true, true], 'ما بعد اليوم يُعلَّم future');
  assert.equal(fut[0].cells[4].status, 'pick');
});

test('batchWeekNumbers — ترقيم الأسابيع بالتقويم الرسمي: يبدأ من ١ في كل فصل ولا يعدّ عودة المعلمين', () => {
  const app = loadApp();
  const { weeks } = calFixture(app);
  const nums = app.batchWeekNumbers(weeks);
  assert.equal(nums['2026-08-16'], undefined, 'أسبوع عودة المعلمين بلا رقم');
  assert.deepEqual({ ...nums['2026-08-23'] }, { semester: 1, n: 1 });
  assert.deepEqual({ ...nums['2026-09-20'] }, { semester: 1, n: 5 });
  assert.deepEqual({ ...nums['2026-11-08'] }, { semester: 1, n: 12 });
  assert.deepEqual({ ...nums['2027-01-17'] }, { semester: 2, n: 1 }, 'الفصل الثاني يبدأ من ١');
  assert.equal(nums['2026-11-15'], undefined, 'أسبوع الإجازة (بلا صفوف) بلا رقم');
});

test('batchPreviewSections — المعاينة فصلًا فصلًا، أسبوع الإجازة يتبع الفصل السابق، وبلا تقويم قسم واحد', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  const secs = app.batchPreviewSections('2026-11-02', '2027-01-20', weeks, holidays, [], true, '2026-10-28');
  assert.deepEqual([...secs.map(s => s.semester)], [1, 2], 'قسمان: الأول ثم الثاني');
  assert.equal(secs[1].weeks.length, 1);
  assert.equal(secs[1].weeks[0].n, 1, 'الفصل الثاني يبدأ ترقيمه من ١');
  assert.equal(secs[0].weeks[0].n, 11, 'ترقيم الفصل الأول رسمي حتى لو بدأت الفترة بعد بدايته');
  const brk = secs[0].weeks.filter(w => w.n === null);
  assert.ok(brk.length >= 5, 'أسابيع الإجازة بلا رقم وتبقى ضمن الفصل الأول');
  assert.ok(brk.every(w => w.cells.every(c => c.status === 'off')));
  const noCal = app.batchPreviewSections('2026-10-04', '2026-10-15', [], [], [], false, '2026-10-28');
  assert.equal(noCal.length, 1);
  assert.equal(noCal[0].semester, 0);
  assert.deepEqual([...noCal[0].weeks.map(w => w.n)], [1, 2]);
  assert.deepEqual([...app.batchPreviewSections('2026-10-10', '2026-10-04', weeks, holidays, [], true, 'x')], []);
});

/* ---------- صفوف المعلم (من إدارة الصف) ---------- */
const CLS = [
  { id: 'a', gradeName: 'أول ثانوي', secName: '3', label: 'أول ثانوي — الشعبة 3' },
  { id: 'b', gradeName: 'ثاني ثانوي', secName: '1', label: 'ثاني ثانوي — الشعبة 1' },
  { id: 'c', gradeName: 'ثالث متوسط', secName: '2', label: 'ثالث متوسط — الشعبة 2' }
];
// أ: أحد وثلاثاء، ب: اثنين وأربعاء، ج: ثلاثاء وخميس (الفصل الأول)
const TT = [
  [0, 'a'], [2, 'a'], [1, 'b'], [3, 'b'], [2, 'c'], [4, 'c']
].map(([weekday, section_id], i) => ({ section_id, weekday, period: i + 1, semester: 1 }));

test('batchSemesterOf/batchTeachesOn/batchTeachDays — الفصل بالتاريخ والتدريس باليوم', () => {
  const app = loadApp();
  const { weeks } = calFixture(app);
  assert.equal(app.batchSemesterOf(weeks, '2026-09-06'), 1);
  assert.equal(app.batchSemesterOf(weeks, '2027-01-18'), 2);
  assert.equal(app.batchSemesterOf(weeks, '2026-12-01'), 1, 'يوم بلا صف يتبع آخر صف قبله');
  assert.equal(app.batchSemesterOf([], '2026-09-06'), 1);
  // 2026-10-04 أحد، 2026-10-05 اثنين
  assert.equal(app.batchTeachesOn(TT, 'a', 1, '2026-10-04'), true);
  assert.equal(app.batchTeachesOn(TT, 'a', 1, '2026-10-05'), false);
  assert.equal(app.batchTeachesOn(TT, 'a', 2, '2027-01-17'), null, 'لا جدول لهذا الفصل فلا حكم');
  assert.deepEqual([...app.batchTeachDays(TT, 'a', 1)], [0, 2]);
  assert.deepEqual([...app.batchTeachPeriods(TT, 'a', 1, 2)], [2]);
});

test('batchAssignClasses — حسب الجدول: لا صف في يوم لا يدرّسه، والتوزيع متقارب، وبالتساوي دون جدول', () => {
  const app = loadApp();
  const days = [];
  for(let d = '2026-09-06'; d <= '2026-10-22'; d = app.addDaysIso(d, 1)){ if(app.weekdayOfIso(d) <= 4) days.push(d); }
  const picks = [...app.batchSpreadDates(24, days[0], days[days.length - 1], { days })];
  const labels = [...app.batchAssignClasses(picks, CLS, { mode: 'timetable', timetable: TT, semesterOf: () => 1 })];
  assert.equal(labels.length, 24);
  labels.forEach((lab, i) => {
    const c = CLS.find(x => x.label === lab);
    assert.equal(app.batchTeachesOn(TT, c.id, 1, picks[i]), true, `${lab} يوم ${picks[i]}`);
  });
  // بالتساوي: يتناوب بين الصفوف مهما كان اليوم
  const eq = [...app.batchAssignClasses(Array(9).fill('2026-10-05'), CLS, { mode: 'equal', timetable: TT, semesterOf: () => 1 })];
  CLS.forEach(c => assert.equal(eq.filter(l => l === c.label).length, 3));
  // صف واحد وبلا صفوف
  assert.deepEqual([...app.batchAssignClasses(['2026-10-05'], [CLS[0]], {})], [CLS[0].label]);
  assert.deepEqual([...app.batchAssignClasses(['2026-10-05'], [], {})], ['']);
  // صف بلا جدول بالفصل يصلح أي يوم (لا يُحرَم)
  const partial = TT.filter(sl => sl.section_id !== 'c');
  const withC = [...app.batchAssignClasses(Array(12).fill('2026-10-04'), CLS, { mode: 'timetable', timetable: partial, semesterOf: () => 1 })];
  assert.ok(withC.includes(CLS[2].label), 'الصف الذي بلا جدول يأخذ حصته');
  // جدول لا يغطي اليوم: رجوع لكل الصفوف بدل فراغ
  const fri = [...app.batchAssignClasses(['2026-10-09', '2026-10-09'], CLS, { mode: 'timetable', timetable: TT, semesterOf: () => 1 })];
  assert.ok(fri.every(l => l));
});

test('batchSpreadWithClasses — تواريخ وصفوف معًا: متوازنة، ولا صف بيوم لا يدرّسه، ومرتّبة، وبلا تكرار يوم', () => {
  const app = loadApp();
  const days = [];
  for(let d = '2026-09-06'; d <= '2026-10-22'; d = app.addDaysIso(d, 1)){ if(app.weekdayOfIso(d) <= 4 && d !== '2026-09-23' && d !== '2026-09-24') days.push(d); }
  for(let run = 0; run < 150; run++){
    const r = app.batchSpreadWithClasses(24, days, CLS, { mode: 'timetable', timetable: TT, semesterOf: () => 1 });
    assert.equal(r.dates.length, 24); assert.equal(r.classes.length, 24);
    assert.deepEqual([...r.dates].sort(), [...r.dates], 'مرتّبة');
    assert.equal(new Set(r.dates).size, 24, 'بلا تكرار يوم');
    r.dates.forEach((d, i) => assert.equal(app.batchTeachesOn(TT, CLS.find(c => c.label === r.classes[i]).id, 1, d), true));
    const n = lab => r.classes.filter(l => l === lab).length;
    const sizes = CLS.map(c => n(c.label));
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 2, 'تقارب أعداد الصفوف: ' + sizes);
    assert.ok(r.dates[0] <= days[3] && r.dates[23] >= days[days.length - 4], 'تغطي الفترة كلها');
  }
  const eq = app.batchSpreadWithClasses(24, days, CLS, { mode: 'equal', timetable: TT, semesterOf: () => 1 });
  CLS.forEach(c => assert.equal(eq.classes.filter(l => l === c.label).length, 8, 'بالتساوي تمامًا'));
  // فروع بديلة: بطاقة واحدة، بطاقات أكثر من الأيام، صف واحد
  assert.equal(app.batchSpreadWithClasses(1, days, CLS, { mode: 'equal' }).dates.length, 1);
  assert.equal(app.batchSpreadWithClasses(50, days, CLS, { mode: 'equal' }).dates.length, 50);
  assert.equal(app.batchSpreadWithClasses(5, days, [CLS[0]], {}).classes.every(l => l === CLS[0].label), true);
});

test('batchClassCodes — رمز مختصر ولا يتكرر', () => {
  const app = loadApp();
  const codes = app.batchClassCodes(CLS);
  assert.equal(codes.a, 'أول ٣');
  assert.equal(codes.b, 'ثاني ١');
  assert.equal(codes.c, 'ثالث ٢');
  const dup = app.batchClassCodes([{ id: 'x', gradeName: 'أول ثانوي', secName: '3' }, { id: 'y', gradeName: 'أول متوسط', secName: '3' }]);
  assert.notEqual(dup.x, dup.y, 'رموز مميّزة عند التكرار');
});

test('buildBatchDraftRows — صف لكل بطاقة من classNames وإلا النص العام', () => {
  const app = loadApp();
  const items = [{ element_key: 'E', template_name: 'a' }, { element_key: 'E', template_name: 'b' }, { element_key: 'E', template_name: 'c' }];
  const rows = app.buildBatchDraftRows(items, ['2026-10-04', '2026-10-05', '2026-10-06'], { userId: 'u1', className: 'عام', classNames: ['س1', 'س2', ''] });
  assert.deepEqual([...rows.map(r => r.class_name)], ['س1', 'س2', 'عام']);
  const plain = app.buildBatchDraftRows(items, [], { userId: 'u1', className: 'عام' });
  assert.ok(plain.every(r => r.class_name === 'عام'));
});

test('batchWeekRows — الخلية تحمل صف الشاهد', () => {
  const app = loadApp();
  const { weeks, holidays } = calFixture(app);
  const rows = app.batchWeekRows('2026-10-04', '2026-10-08', weeks, holidays, ['2026-10-04', '2026-10-06'], true, '2026-10-28', ['س1', 'س2']);
  assert.deepEqual([...rows[0].cells[0].classes], ['س1']);
  assert.deepEqual([...rows[0].cells[2].classes], ['س2']);
  assert.equal(rows[0].cells[1].classes, undefined);
});

function classApp() {
  const { app, reg } = periodApp();
  runInAppContext(app, `
    batchClasses = ${JSON.stringify(CLS)};
    batchTimetable = ${JSON.stringify(TT)};
    batchClassSel = new Set(['a', 'b', 'c']); batchClassMode = 'timetable';
    batchPick = { E1: Array.from({ length: 9 }, (_, i) => "نموذج " + i) };`);
  return { app, reg };
}

test('شاشة الصفوف: أزرار من إدارة الصف، توزيع حسب الجدول، وتعطيله بلا جدول', () => {
  const { app, reg } = classApp();
  app.renderBatchClasses();
  const html = reg.btClassBox.innerHTML;
  assert.match(html, /أول ثانوي — الشعبة 3/);
  assert.match(html, /أول ٣ · الأحد والثلاثاء/, 'الرمز وأيام التدريس');
  assert.match(html, /حسب جدولي <span class="bt-badge">موصى به/);
  assert.match(html, /جدولك الأسبوعي مسجَّل/);
  app.batchToggleClass('c');
  assert.deepEqual([...runInAppContext(app, '[...batchClassSel]')], ['a', 'b']);
  assert.match(reg.btClassBox.innerHTML, /bt-cchip off/);
  app.batchToggleClass('a'); app.batchToggleClass('b');
  assert.match(reg.btClassBox.innerHTML, /اختر صفًا واحدًا على الأقل/);
  // بلا جدول: يُعطَّل حسب جدولي
  runInAppContext(app, 'batchClassSel = new Set(["a", "b"]); batchTimetable = [];');
  app.renderBatchClasses();
  assert.match(reg.btClassBox.innerHTML, /disabled onclick="batchSetClassMode\('timetable'\)"/);
  assert.match(reg.btClassBox.innerHTML, /لم تسجّل جدولك الأسبوعي/);
  assert.equal(runInAppContext(app, 'batchEffectiveClassMode()'), 'equal');
});

test('بلا صفوف مسجَّلة: يبقى حقل النص الحرّ مع تلميح إدارة الصف', () => {
  const { app, reg } = classApp();
  runInAppContext(app, 'batchClasses = null;');
  app.renderBatchClasses();
  assert.match(reg.btClassBox.innerHTML, /id="btClass"/);
  assert.match(reg.btClassBox.innerHTML, /إدارة الصف/);
});

test('الملخص والمعاينة: أعداد الصفوف، وتُعتمد نفس خطة الصفوف بالتواريخ', () => {
  const { app, reg } = classApp();
  app.batchSetPeriod('sem1');
  assert.match(reg.btSum.innerHTML, /bt-ccount/);
  assert.match(reg.btSum.innerHTML, /أول ٣ : /);
  app.batchTogglePreview(true);
  assert.match(reg.btPreview.innerHTML, /style="background:#1B3245;border-color:#1B3245"|style="background:#A9852E;border-color:#A9852E"|style="background:#2F7D5B;border-color:#2F7D5B"/, 'لون الصف على الشاهد');
  assert.match(reg.btPreview.innerHTML, /أول ٣ أول ثانوي/, 'مفتاح الألوان بأسماء الصفوف');
  const plan = { ...runInAppContext(app, 'batchPlanned') };
  assert.equal(plan.classes.length, plan.dates.length);
  // كل شاهد في يوم يدرّس فيه صفه
  plan.dates.forEach((d, i) => {
    const c = CLS.find(x => x.label === plan.classes[i]);
    assert.notEqual(app.batchTeachesOn(TT, c.id, 1, d), false, `${plan.classes[i]} ${d}`);
  });
  // تغيير الصفوف يُبطل الخطة القديمة
  const sigBefore = plan.sig;
  app.batchToggleClass('c');
  app.batchRefreshPeriod();
  assert.notEqual(runInAppContext(app, 'batchPlanned.sig'), sigBefore);
  // تلميح اليوم يذكر الصف والحصة
  const d0 = runInAppContext(app, 'batchPlanned.dates[0]');
  app.batchShowDayTip(d0);
  assert.match(reg.btTip.textContent, /الصف: .+/);
});

test('بطاقة اللوحة: قائمة الصف تعلّم أيام التدريس وتنبّه عند التعارض، وصف آخر يدويًا', () => {
  const { app } = classApp();
  runInAppContext(app, `batchDrafts = [{ id: 'd1', user_id: 'u1', element_key: 'E1', template_name: 'x', title: 'عنوان', planned_date: '2026-10-07', class_name: ${JSON.stringify(CLS[0].label)} }]; batchStep = 'board';`);
  // 2026-10-07 أربعاء: ب فقط يدرّس
  const html = runInAppContext(app, 'batchCardHtml(batchDrafts[0])');
  assert.match(html, /<select class="bt-date"/);
  assert.match(html, /الشعبة 3 — لا تدرّسه الأربعاء/);
  assert.match(html, /ثاني ثانوي — الشعبة 1 ✓/);
  assert.match(html, /bt-chint">⚠ لا تدرّس هذا الصف يوم الأربعاء/);
  assert.match(html, /صف آخر…/);
  // صف يدرّسه ذلك اليوم: لا تنبيه
  runInAppContext(app, `batchDrafts[0].class_name = ${JSON.stringify(CLS[1].label)};`);
  assert.doesNotMatch(runInAppContext(app, 'batchCardHtml(batchDrafts[0])'), /bt-chint/);
  // بلا صفوف مسجَّلة: لا قائمة
  runInAppContext(app, 'batchClasses = null;');
  assert.doesNotMatch(runInAppContext(app, 'batchCardHtml(batchDrafts[0])'), /<select/);
});

function periodApp() {
  const { app, reg } = pickApp();
  const { weeks, holidays } = calFixture(app);
  runInAppContext(app, `
    const realIso = localIsoDate; localIsoDate = (d) => d ? realIso(d) : '2026-10-28';
    batchPick = { E1: ['نموذج 0', 'نموذج 1', 'نموذج 2'] };
    batchCal = { weeks: ${JSON.stringify(weeks)}, holidays: ${JSON.stringify(holidays)} };
    batchStep = 'setup'; batchPeriod = 'custom'; batchFrom = '2026-09-20'; batchTo = '2026-09-27'; batchOne = '2026-10-28';`);
  return { app, reg };
}

test('شاشة الفترة: كل الفصول مفتوحة، والفصل الثاني يذكر بدايته، والملخص بالأرقام', () => {
  const { app, reg } = periodApp();
  app.renderBatchPeriod();
  const html = reg.btPeriod.innerHTML;
  assert.match(html, /الفصل الأول/);
  assert.match(html, /العام كاملًا/);
  assert.doesNotMatch(html, /bt-chip dis/, 'لا أزرار معطّلة');
  assert.match(html, /الفصل الثاني<small>يبدأ ١٧ يناير/);
  assert.match(html, /id="btCap" checked/, 'مفتاح «لا تضع تواريخ بعد اليوم» مفعّل افتراضيًا');
  app.batchSetPeriod('sem1');
  assert.equal(runInAppContext(app, 'batchFrom'), '2026-08-23');
  assert.match(reg.btSum.innerHTML, /٣ شواهد/);
  assert.match(reg.btSum.innerHTML, /٢٨ أكتوبر/, 'المفتاح مفعّل: الفصل الأول يُقصّ عند اليوم');
  assert.equal(app.batchCountLabel(1), 'شاهد واحد'); assert.equal(app.batchCountLabel(2), 'شاهدان');
  assert.equal(app.batchCountLabel(10), '١٠ شواهد'); assert.equal(app.batchCountLabel(24), '٢٤ شاهدًا');
});

test('المفتاح مفعّل: الفصل الثاني (لم يبدأ) يعطي رسالة تشرح كيف تفتحه، ولا يُنشئ تواريخ قادمة', () => {
  const { app, reg } = periodApp();
  app.batchSetPeriod('sem2');
  assert.equal(runInAppContext(app, 'batchPeriod'), 'sem2');
  assert.match(reg.btSum.innerHTML, /bt-sum bad/);
  assert.match(reg.btSum.innerHTML, /لم تبدأ بعد \(تبدأ ١٧ يناير\)/);
  assert.match(reg.btSum.innerHTML, /أوقف «لا تضع تواريخ بعد اليوم»/);
  assert.equal(runInAppContext(app, 'batchPeriodInfo().ok'), false);
  // فترة يدوية بعد اليوم مرفوضة والمفتاح مفعّل
  runInAppContext(app, 'batchPeriod = "custom"; batchFrom = "2026-10-01"; batchTo = "2026-11-03";');
  assert.equal(runInAppContext(app, 'batchPeriodInfo().ok'), false);
});

test('المفتاح موقوف: الفصل الثاني والعام كاملًا حتى آخر يوم دراسة، مع تحذير وتعليم المستقبل', () => {
  const { app, reg } = periodApp();
  runInAppContext(app, 'batchPick = { E1: Array.from({ length: 12 }, (_, i) => "نموذج " + i) };');
  app.batchToggleCap(false);
  assert.match(reg.btPeriod.innerHTML, /id="btCap"[^>]*>/);
  assert.doesNotMatch(reg.btPeriod.innerHTML, /id="btCap" checked/);
  app.batchSetPeriod('year');
  const info = { ...runInAppContext(app, 'batchPeriodInfo()') };
  assert.equal(info.ok, true);
  assert.equal(info.from, '2026-08-23');
  assert.equal(info.to, '2027-01-18', 'حتى آخر يوم دراسة بالتقويم لا اليوم');
  assert.equal(info.future, true);
  const dates = [...runInAppContext(app, 'batchPlanned.dates')];
  assert.equal(dates.length, 12);
  assert.ok(dates.every(d => d >= '2026-08-23' && d <= '2027-01-18'));
  assert.match(reg.btSum.innerHTML, /بتاريخ لم يحن بعد/);
  const lateDate = dates.filter(d => d > '2026-10-28').length;
  assert.match(reg.btSum.innerHTML, new RegExp('⚠ ' + app.batchAr(lateDate) + ' من ١٢ شاهدًا'));
  // الفصل الثاني وحده
  app.batchSetPeriod('sem2');
  assert.equal(runInAppContext(app, 'batchPeriodInfo().ok'), true);
  // يوم واحد بعد آخر يوم دراسة مرفوض حتى والمفتاح موقوف
  app.batchSetPeriod('single');
  runInAppContext(app, 'batchOne = "2027-02-01";');
  assert.equal(runInAppContext(app, 'batchPeriodInfo().ok'), false);
  runInAppContext(app, 'batchOne = "2027-01-18";');
  assert.equal(runInAppContext(app, 'batchPeriodInfo().ok'), true);
  // إعادة تفعيل المفتاح تعيد التواريخ القادمة إلى اليوم
  app.batchToggleCap(true);
  assert.equal(runInAppContext(app, 'batchOne'), '2026-10-28');
});

test('محرّر تاريخ البطاقة: الحدّ آخر يوم دراسة لو التقويم متاح، وإلا اليوم', () => {
  const { app } = periodApp();
  assert.equal(runInAppContext(app, 'batchDateLimit()'), '2027-01-18');
  runInAppContext(app, 'batchCal = null;');
  assert.equal(runInAppContext(app, 'batchDateLimit()'), '2026-10-28');
});

test('المعاينة: تُظهر الإجازة باسمها، والتلميح يشرح اليوم، والخلط يغيّر التوزيع، وتُعتمد عند الإنشاء', () => {
  const { app, reg } = periodApp();
  runInAppContext(app, 'batchPick = { E1: Array.from({ length: 4 }, (_, i) => "نموذج " + i) };');
  app.batchSetPeriod('sem1');
  app.batchTogglePreview(true);
  assert.match(reg.btPreview.innerHTML, /bt-cell off[^>]*>[^<]*٢٣<small>اليوم الوطني/);
  assert.match(reg.btPreview.innerHTML, /خلط التواريخ/);
  app.batchShowDayTip('2026-09-23');
  assert.match(reg.btTip.textContent, /ليس يوم دراسة: اليوم الوطني، لن يُوضع فيه شاهد/);
  app.batchShowDayTip('2026-09-27');
  assert.match(reg.btTip.textContent, /سيُوثَّق فيه|يوم دراسة بلا شاهد/, 'يوم دراسة عادي (بشاهد أو بلا)');
  assert.doesNotMatch(reg.btTip.textContent, /ليس يوم دراسة/);
  const before = [...runInAppContext(app, 'batchPlanned.dates')];
  assert.equal(before.length, 4);
  let changed = false;
  for(let i = 0; i < 6 && !changed; i++){ app.batchReshuffle(); changed = runInAppContext(app, 'batchPlanned.dates').join() !== before.join(); }
  assert.ok(changed, 'الخلط يعطي توزيعًا مختلفًا');
  // الفترة تتغيّر ⇒ يُعاد التوزيع لها (لا يُعتمد توزيع الفترة القديمة)
  runInAppContext(app, 'batchPeriod = "custom"; batchFrom = "2026-10-04"; batchTo = "2026-10-08"; batchPlanned = null; batchRefreshPeriod();');
  const re = { ...runInAppContext(app, 'batchPlanned') };
  assert.equal(re.from, '2026-10-04');
  assert.ok([...re.dates].every(d => d >= '2026-10-04' && d <= '2026-10-08'));
});

test('المعاينة فصلًا فصلًا: تبويب لكل فصل، ورقم الأسبوع يبدأ من ١ في الفصل الثاني', () => {
  const { app, reg } = periodApp();
  runInAppContext(app, 'batchPick = { E1: Array.from({ length: 12 }, (_, i) => "نموذج " + i) };');
  app.batchToggleCap(false);
  app.batchSetPeriod('year');
  app.batchTogglePreview(true);
  const html = reg.btPreview.innerHTML;
  assert.match(html, /bt-semtabs/);
  assert.match(html, /الفصل الأول<small>/);
  assert.match(html, /الفصل الثاني<small>/);
  assert.equal(runInAppContext(app, 'batchPreviewSem'), 1, 'يفتح على الفصل الحالي');
  assert.match(html, /<span class="bt-wk">١<\/span>/);
  assert.match(html, /<b>الفصل الأول<\/b>/);
  app.batchSetPreviewSem(2);
  const h2 = reg.btPreview.innerHTML;
  assert.match(h2, /<b>الفصل الثاني<\/b>/);
  assert.match(h2, /<span class="bt-wk">١<\/span>/, 'الفصل الثاني يبدأ ترقيمه من ١');
  assert.doesNotMatch(h2, /<span class="bt-wk">٢<\/span>/, 'فصل ثانٍ بأسبوع واحد فقط في العيّنة');
  assert.doesNotMatch(h2, /اليوم الوطني/, 'لا يظهر هنا ما يخص الفصل الأول');
});

test('batchMovePlanned — ينقل شاهدًا ليوم دراسي مسموح ويُبقي صفه ويرتّب بالتاريخ، ويرفض غير المسموح', () => {
  const app = loadApp();
  const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
  const mk = () => ({ dates: ['2026-10-04', '2026-10-06'], classes: ['س1', 'س2'] });
  const p = mk();
  const r = app.batchMovePlanned(p, '2026-10-04', '2026-10-07', days);
  assert.deepEqual({ ...r }, { ok: true, label: 'س1' });
  assert.deepEqual([...p.dates], ['2026-10-06', '2026-10-07'], 'مرتّبة بعد النقل');
  assert.deepEqual([...p.classes], ['س2', 'س1'], 'الصف يتبع شاهده');
  // يوم فيه شاهد أصلًا: يجوز (شاهدان باليوم)
  const q = mk();
  assert.equal(app.batchMovePlanned(q, '2026-10-04', '2026-10-06', days).ok, true);
  assert.deepEqual([...q.dates], ['2026-10-06', '2026-10-06']);
  // يوم غير مسموح، نفس اليوم، مصدر بلا شاهد: رفض بلا تغيير
  const z = mk();
  assert.equal(app.batchMovePlanned(z, '2026-10-04', '2026-10-09', days).ok, false);
  assert.equal(app.batchMovePlanned(z, '2026-10-04', '2026-10-04', days).ok, false);
  assert.equal(app.batchMovePlanned(z, '2026-10-05', '2026-10-07', days).ok, false);
  assert.deepEqual([...z.dates], ['2026-10-04', '2026-10-06']);
  // بلا صفوف
  const n = { dates: ['2026-10-04'], classes: null };
  assert.equal(app.batchMovePlanned(n, '2026-10-04', '2026-10-05', days).ok, true);
  assert.deepEqual([...n.dates], ['2026-10-05']);
});

test('المعاينة: نقل شاهد بنقرتين — تحديد، نقل، رفض الإجازة، إلغاء، وتنبيه الصف، وتُعتمد التعديلات', () => {
  const { app, reg } = classApp();
  runInAppContext(app, 'batchPick = { E1: Array.from({ length: 12 }, (_, i) => "نموذج " + i) };');
  app.batchSetPeriod('sem1');
  app.batchTogglePreview(true);
  const plan = () => runInAppContext(app, 'batchPlanned');
  const tipText = () => runInAppContext(app, 'batchTip');
  const pickDay = [...plan().dates][0];
  const classOf = d => plan().classes[plan().dates.indexOf(d)];
  // يوم بلا شاهد: شرح فقط ولا تحديد
  const free = [...runInAppContext(app, 'batchPeriodInfo().days')].find(d => !plan().dates.includes(d));
  app.batchOnDayTap(free);
  assert.equal(runInAppContext(app, 'batchMoveFrom'), null);
  assert.match(tipText(), /يوم دراسة بلا شاهد/);
  // تحديد يوم فيه شاهد
  app.batchOnDayTap(pickDay);
  assert.equal(runInAppContext(app, 'batchMoveFrom'), pickDay);
  assert.match(reg.btPreview.innerHTML, /bt-cell [^"]*sel/);
  assert.match(reg.btPreview.innerHTML, /dest/);
  assert.match(tipText(), /اختر يومًا دراسيًا لنقله إليه/);
  // الإجازة (اليوم الوطني) مرفوضة وتبقى حالة التحديد
  app.batchOnDayTap('2026-09-23');
  assert.match(tipText(), /ليس يوم دراسة \(اليوم الوطني\)، لا يمكن النقل إليه/);
  assert.equal(runInAppContext(app, 'batchMoveFrom'), pickDay);
  // الإلغاء بالضغط على اليوم نفسه
  app.batchOnDayTap(pickDay);
  assert.equal(runInAppContext(app, 'batchMoveFrom'), null);
  // النقل لليوم الحر
  const lab = classOf(pickDay);
  app.batchOnDayTap(pickDay);
  app.batchOnDayTap(free);
  assert.equal(runInAppContext(app, 'batchMoveFrom'), null);
  assert.ok(plan().dates.includes(free) && !plan().dates.includes(pickDay));
  assert.equal(classOf(free), lab, 'الصف يتبع الشاهد');
  assert.match(tipText(), /نُقل الشاهد إلى/);
  assert.deepEqual([...plan().dates].sort(), [...plan().dates], 'تبقى مرتّبة');
  assert.equal(plan().dates.length, 12, 'العدد ثابت');
  // الملخص يعكس الخطة بعد النقل
  assert.match(reg.btSum.innerHTML, /bt-ccount/);
  // تنبيه الصف: انقل إلى يوم لا يدرّس فيه صف الشاهد
  const wrongDay = [...runInAppContext(app, 'batchPeriodInfo().days')].find(d => d !== free && !plan().dates.includes(d) && app.batchTeachesOn(TT, CLS.find(c => c.label === classOf(free)).id, 1, d) === false);
  assert.ok(wrongDay, 'يوجد يوم دراسي لا يدرّس فيه صف الشاهد');
  app.batchOnDayTap(free);
  app.batchOnDayTap(wrongDay);
  assert.match(tipText(), /⚠ لا تدرّس .+ هذا اليوم — تأكد أنه مقصود/);
  // الخلط يمحو التحديد والرسالة
  app.batchOnDayTap(plan().dates[0]);
  app.batchReshuffle();
  assert.equal(runInAppContext(app, 'batchMoveFrom'), null);
  assert.equal(runInAppContext(app, 'batchTip'), '');
});

test('يوم واحد: تنبيه (لا منع) لو ليس يوم دراسة، ورفض تاريخ بعد اليوم', () => {
  const { app, reg } = periodApp();
  app.batchSetPeriod('single');
  runInAppContext(app, 'batchOne = "2026-09-23";');
  app.batchRefreshPeriod();
  assert.match(reg.btSum.innerHTML, /ليس يوم دراسة \(اليوم الوطني\)/);
  runInAppContext(app, 'batchOne = "2026-10-29";');
  app.batchRefreshPeriod();
  assert.match(reg.btSum.innerHTML, /bt-sum bad/);
  assert.deepEqual({ ...runInAppContext(app, 'batchPeriodInfo()') }.ok, false);
});

test('الفترة بلا تقويم: لا أزرار فصول، ويتجنّب الجمعة والسبت فقط مع تلميح مناسب', () => {
  const { app, reg } = periodApp();
  runInAppContext(app, 'batchCal = null; calendarRegion = null;');
  app.renderBatchPeriod();
  assert.doesNotMatch(reg.btPeriod.innerHTML, /الفصل الأول/);
  assert.match(reg.btPeriod.innerHTML, /فترة أخرى/);
  assert.match(reg.btHint.textContent, /حدّد نطاق التقويم/);
  const info = runInAppContext(app, 'batchPeriodInfo()');
  assert.equal(info.ok, true);
  assert.ok([...info.days].every(d => ![5, 6].includes(app.weekdayOfIso(d))));
});

test('تجهيز الدفعة — التوزيع يمرّ عبر التقويم الرسمي مع رجوع آمن عند غيابه', () => {
  const src = read('app/app-33-shahid-batch.js');
  assert.ok(/batchCalendarDays\(batchCal\.weeks, batchCal\.holidays, from, to\)/.test(src), 'يُستخرج أيام الدراسة من التقويم');
  assert.ok(/batchPlanDatesAndClasses\(items\.length, info\)/.test(src), 'الإنشاء يوزّع التواريخ والصفوف على أيام الدراسة');
  assert.ok(/calFallback = !batchCal;/.test(src), 'رجوع للجمعة والسبت عند غياب التقويم');
  assert.ok(/لا توجد أيام دراسة ضمن هذه الفترة/.test(src), 'فترة كلها إجازة تُرفض برسالة واضحة');
  assert.ok(/p\.from === info\.from && p\.to === info\.to && p\.count === items\.length/.test(src), 'يُعتمد التوزيع الذي رآه المعلم بالمعاينة');
  assert.ok(/onclick="batchOnDayTap\('\$\{c\.iso\}'\)"/.test(src), 'أيام المعاينة قابلة للنقل بالضغط');
  assert.ok(/seq !== batchViewSeq/.test(src.slice(src.indexOf('async function batchPrepareCalendar'))), 'حارس سباق بعد تحميل التقويم');
});

test('batchInterleave — تناوب بين المجموعات', () => {
  const app = loadApp();
  assert.deepEqual([...app.batchInterleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])], ['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
});

test('batchAutoDistribute — حد 4 للعنصر، تناوب عادل، يحترم السعة والنماذج المتاحة', async (t) => {
  const app = loadApp();
  const names = (n) => Array.from({ length: n }, (_, i) => 't' + i);
  const els = ['A', 'B', 'C', 'D', 'E', 'F'].map(k => ({ key: k, names: names(14) }));

  await t.test('24 على 6 عناصر = 4 لكل عنصر', () => {
    const r = app.batchAutoDistribute(els, 24, {});
    assert.ok(els.every(e => r[e.key].length === 4));
  });
  await t.test('20 على 6 عناصر = توزيع متقارب (3-4)', () => {
    const r = app.batchAutoDistribute(els, 20, {});
    const counts = els.map(e => r[e.key].length);
    assert.equal(counts.reduce((a, b) => a + b, 0), 20);
    assert.ok(counts.every(c => c >= 3 && c <= 4));
  });
  await t.test('لا يتجاوز مجموع السعات حتى لو الهدف أكبر', () => {
    const r = app.batchAutoDistribute(els, 30, {});
    assert.equal(els.reduce((n, e) => n + r[e.key].length, 0), 24);
  });
  await t.test('سعة عنصر مستنفدة (قيد التجهيز) تُحترم', () => {
    const r = app.batchAutoDistribute(els, 24, { A: 0, B: 1 });
    assert.equal(r.A.length, 0);
    assert.equal(r.B.length, 1);
  });
  await t.test('عنصر بنموذجين فقط لا يُعطى أكثر منهما', () => {
    const r = app.batchAutoDistribute([{ key: 'X', names: ['p', 'q'] }, { key: 'Y', names: names(14) }], 10, {});
    assert.deepEqual([...r.X].sort(), ['p', 'q']);
    assert.equal(r.Y.length, 4);
  });
});

/* مولّد عشوائي ثابت البذرة لاختبارات قابلة للتكرار */
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('batchAutoDistribute — عشوائي: لا يأخذ أول النماذج دائمًا ولا العناصر الأولى دائمًا', async (t) => {
  const app = loadApp();
  const names = Array.from({ length: 14 }, (_, i) => 't' + i);
  const els = ['A', 'B', 'C', 'D', 'E', 'F'].map(k => ({ key: k, names }));

  await t.test('بذور مختلفة = اختيارات مختلفة، وكلها ضمن الحدود', () => {
    const sigs = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const r = app.batchAutoDistribute(els, 18, {}, { rng: seeded(seed) });
      assert.equal(els.reduce((n, e) => n + r[e.key].length, 0), 18);
      els.forEach(e => {
        assert.ok(r[e.key].length <= 4);
        assert.equal(new Set(r[e.key]).size, r[e.key].length, 'بلا تكرار داخل العنصر');
      });
      sigs.add(JSON.stringify(els.map(e => [...r[e.key]])));
    }
    assert.ok(sigs.size >= 15, 'نتائج متنوعة وليست ثابتة');
  });
  await t.test('ليست دائمًا أول 3 نماذج بالترتيب (علّة الترتيب القديم)', () => {
    let allFirstThree = true;
    for (let seed = 1; seed <= 20; seed++) {
      const r = app.batchAutoDistribute(els, 18, {}, { rng: seeded(seed) });
      if (![...r.A].every((n, i) => n === 't' + i)) allFirstThree = false;
    }
    assert.equal(allFirstThree, false);
  });
  await t.test('النصيب الزائد (هدف لا يقبل القسمة) لا يقع دائمًا على العناصر الأولى', () => {
    const extra = new Set();
    for (let seed = 1; seed <= 30; seed++) {
      const r = app.batchAutoDistribute(els, 8, {}, { rng: seeded(seed) }); // 6 عناصر: عنصران بشاهدين والباقي بواحد
      els.forEach(e => { if (r[e.key].length === 2) extra.add(e.key); });
    }
    assert.ok(extra.size >= 4, 'كل العناصر تنال النصيب الزائد أحيانًا: ' + [...extra]);
  });
  await t.test('بذرة واحدة = نتيجة واحدة (قابل للتكرار بالاختبار)', () => {
    const a = app.batchAutoDistribute(els, 18, {}, { rng: seeded(7) });
    const b = app.batchAutoDistribute(els, 18, {}, { rng: seeded(7) });
    assert.equal(JSON.stringify(els.map(e => [...a[e.key]])), JSON.stringify(els.map(e => [...b[e.key]])));
  });
  await t.test('بلا rng (Math.random الحقيقي) يعمل وبحدود صحيحة', () => {
    const r = app.batchAutoDistribute(els, 24, {});
    assert.ok(els.every(e => r[e.key].length === 4));
  });
});

test('batchAutoDistribute — يفضّل النماذج غير المستخدمة، ويلجأ للمستخدمة عند الاستنفاد', async (t) => {
  const app = loadApp();
  await t.test('المستخدمة سابقًا لا تُقترح ما دام هناك بدائل', () => {
    const els = [{ key: 'A', names: ['n1', 'n2', 'n3', 'n4', 'n5'], used: ['u1', 'u2'] }];
    for (let seed = 1; seed <= 15; seed++) {
      const r = app.batchAutoDistribute(els, 4, {}, { rng: seeded(seed) });
      assert.ok([...r.A].every(n => n.startsWith('n')), 'لا نموذج مستخدم');
    }
  });
  await t.test('نماذج جديدة أقل من المطلوب: تُكمَّل بالمستخدمة بدل ترك العنصر ناقصًا', () => {
    const r = app.batchAutoDistribute([{ key: 'A', names: ['n1'], used: ['u1', 'u2', 'u3'] }], 4, {}, { rng: seeded(3) });
    assert.equal(r.A.length, 4);
    assert.equal(r.A[0], 'n1', 'الجديد أولًا');
  });
});

test('batchAutoDistribute — الاختيارات اليدوية (keep) تبقى وتُحسب ضمن العدد والسعة', () => {
  const app = loadApp();
  const names = Array.from({ length: 14 }, (_, i) => 't' + i);
  const els = ['A', 'B', 'C'].map(k => ({ key: k, names }));
  const r = app.batchAutoDistribute(els, 6, {}, { rng: seeded(5), keep: { A: ['t3', 't9', 't11'] } });
  assert.deepEqual([...r.A].slice(0, 3), ['t3', 't9', 't11'], 'اليدوية أولًا وكما هي');
  assert.equal(els.reduce((n, e) => n + r[e.key].length, 0), 6, 'العدد الكلي يشمل اليدوية');
  assert.ok(r.A.length <= 4);
  assert.equal(new Set(r.A).size, r.A.length, 'لا تكرار');
  const full = app.batchAutoDistribute(els, 3, {}, { rng: seeded(5), keep: { A: ['t1', 't2', 't3'] } });
  assert.equal(els.reduce((n, e) => n + full[e.key].length, 0), 3, 'اليدوية بلغت الهدف: لا إضافة');
});

test('buildBatchDraftRows / buildBatchShahidRecord', async (t) => {
  const app = loadApp();
  await t.test('صفوف المسودات تحمل المالك والتاريخ وسنة الدورة', () => {
    const rows = app.buildBatchDraftRows(
      [{ element_key: 'E1', template_name: 'نموذج 1' }, { element_key: 'E2', template_name: 'نموذج 2' }],
      ['2026-10-05', '2026-10-06'],
      { userId: 'u1', teacher: 'م', school: 'مدرسة', subject: 'مادة', className: 'ص' });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.user_id === 'u1' && r.school === 'مدرسة'));
    assert.equal(rows[0].title, 'نموذج 1');
    assert.equal(rows[1].planned_date, '2026-10-06');
    assert.equal(rows[0].cycle_year, '2026/2027');
  });
  await t.test('الشاهد الحقيقي: معرّفه معرّف المسودة، ونصه من النموذج، وصوره المرفوعة', () => {
    const draft = { id: 'd-1', user_id: 'u1', element_key: 'E1', title: 'نموذج 1', planned_date: '2026-10-05', school: 'م', subject: 'ع', class_name: '1', teacher_name: 'أ' };
    const tpl = { description: 'وصف', goal: 'هدف', steps: ['خ1', 'خ2'], quant: 'ك', qual: 'ن', reflection: 'ت' };
    const r = app.buildBatchShahidRecord(draft, tpl, ['https://x/y.jpg'], 'عنصر (10%)', 'a@b.c');
    assert.equal(r.id, 'd-1');
    assert.equal(r.user_id, 'u1');
    assert.equal(r.description, 'وصف');
    assert.deepEqual([...r.steps], ['خ1', 'خ2']);
    assert.deepEqual([...r.photo_urls], ['https://x/y.jpg']);
    assert.equal(r.element_label, 'عنصر (10%)');
    assert.equal(r.cycle_stage, 'planning');
    assert.equal(r.teacher_email, 'a@b.c');
  });
  await t.test('نموذج مفقود لا يكسر البناء', () => {
    const r = app.buildBatchShahidRecord({ id: 'd', user_id: 'u', element_key: 'E', title: 't' }, null, [], '', '');
    assert.equal(r.description, '');
    assert.deepEqual([...r.steps], []);
    assert.equal(r.element_label, 'E');
  });
});

/* ---------- عميل وهمي بحالة (يطبّق eq/insert/delete/upsert فعليًا) ---------- */
function makeBatchClient(seed, opts = {}) {
  const log = [];
  const uploaded = [];
  const removed = [];
  function chain(table) {
    const filters = [];
    let mode = 'select', payload = null;
    const rows = () => (seed[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const exec = () => {
      if (mode === 'insert') {
        log.push({ op: 'insert', table, payload });
        if (opts.failInsert) return { data: null, error: opts.failInsert };
        const list = Array.isArray(payload) ? payload : [payload];
        const exists = (seed[table] || []).some(r => list.some(p => p.id && r.id === p.id));
        if (exists) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        seed[table] = (seed[table] || []).concat(list.map(p => Object.assign({ ref_number: 'SH-1' }, p)));
        return { data: list, error: null };
      }
      if (mode === 'delete') {
        log.push({ op: 'delete', table, filters: filters.slice() });
        const rm = rows();
        seed[table] = (seed[table] || []).filter(r => !rm.includes(r));
        return { data: null, error: null };
      }
      if (mode === 'update') {
        log.push({ op: 'update', table, payload });
        rows().forEach(r => Object.assign(r, payload));
        return { data: null, error: null };
      }
      log.push({ op: 'select', table, filters: filters.slice() });
      return { data: rows(), error: null };
    };
    const api = {
      select() { return api; },
      eq(c, v) { filters.push([c, v]); return api; },
      order() { return api; }, range() { return api; }, limit() { return api; },
      insert(p) { mode = 'insert'; payload = p; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      delete() { mode = 'delete'; return api; },
      single: async () => { const r = exec(); return r.error ? r : { data: r.data[0] ? (seed[table] || []).find(x => x.id === r.data[0].id) : null, error: null }; },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then(resolve) { const r = exec(); resolve(r); return Promise.resolve(r); },
    };
    return api;
  }
  return {
    log, uploaded, removed,
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) },
    from: chain,
    storage: {
      from: () => ({
        upload: async (p) => { if (opts.failUploadAt != null && uploaded.length === opts.failUploadAt) return { error: new Error('upload failed') }; uploaded.push(p); return { error: null }; },
        getPublicUrl: (p) => ({ data: { publicUrl: 'https://abc.supabase.co/storage/v1/object/public/shawahid-photos/' + p } }),
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }),
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

function prep(seed, opts) {
  const client = makeBatchClient(seed, opts);
  const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1', email: 'a@b.c' } });
  const registry = {};
  const live = () => ({ style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: () => live(), querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null });
  app.document.getElementById = (id) => (registry[id] = registry[id] || live());
  app.document.querySelectorAll = () => [];
  /* الضغط يحتاج FileReader/canvas غير المتوفرين بـNode — نمرّر الملف كما هو */
  runInAppContext(app, 'compressImage = (f) => Promise.resolve(f);');
  return { app, client, seed };
}
const file = (name) => ({ name, type: 'image/jpeg', size: 10 });
const DRAFT = (over) => Object.assign({ id: 'd1', user_id: 'u1', element_key: 'تحسين نتائج المتعلمين', template_name: 'x', title: 'عنوان', planned_date: '2026-10-05', school: 'م' }, over || {});

/* ---------- 3) عزل المستخدم ---------- */
test('loadBatchDrafts — لا تجلب مسودات معلم آخر (فلترة user_id صريحة)', async () => {
  const { app } = prep({ shahid_drafts: [DRAFT({ id: 'a' }), DRAFT({ id: 'b', user_id: 'u2' })] });
  assert.equal(await app.loadBatchDrafts(), true);
  const ids = runInAppContext(app, 'batchDrafts.map(d => d.id)');
  assert.deepEqual([...ids], ['a']);
});

/* ---------- 2) التحويل لشاهد ---------- */
test('batchPromote — يُنشئ الشاهد بمعرّف المسودة ويحذف المسودة ويسجّل المنجز', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "تحسين نتائج المتعلمين", template_name: "x", title: "عنوان", planned_date: "2026-10-05" }]; batchStep = "pick";');
  await app.batchPromote('d1', [file('1.jpg'), file('2.jpg')]);
  assert.equal(seed.shawahid.length, 1);
  assert.equal(seed.shawahid[0].id, 'd1', 'معرّف الشاهد = معرّف المسودة');
  assert.equal(seed.shawahid[0].user_id, 'u1');
  assert.equal(seed.shawahid[0].photo_urls.length, 2);
  assert.equal(seed.shahid_drafts.length, 0, 'المسودة حُذفت');
  assert.equal(runInAppContext(app, 'batchDone.length'), 1);
  assert.equal(runInAppContext(app, 'batchBusyIds.size'), 0, 'التعطيل يُرفع بعد الانتهاء');
  assert.ok(client.log.some(l => l.op === 'delete' && l.table === 'shahid_drafts' && l.filters.some(f => f[0] === 'user_id' && f[1] === 'u1')), 'الحذف مقيّد بالمالك');
});

test('batchPromote — شاهد بنفس المعرّف موجود (تبويب/جهاز آخر): لا تكرار وتُنظَّف الصور', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [{ id: 'd1', user_id: 'u1', photo_urls: ['old'] }] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg')]);
  assert.equal(seed.shawahid.length, 1, 'لا شاهد مكرر');
  assert.equal(seed.shahid_drafts.length, 0, 'المسودة العالقة تُنظَّف');
  assert.equal(client.removed.length, 1, 'الصورة المرفوعة حديثًا تُحذف من التخزين');
  assert.equal(runInAppContext(app, 'batchDone.length'), 0);
});

test('batchPromote — فشل رفع صورة: لا شاهد، المسودة تبقى، وما رُفع يُنظَّف', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed, { failUploadAt: 1 });
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg'), file('2.jpg')]);
  assert.equal(seed.shawahid.length, 0);
  assert.equal(seed.shahid_drafts.length, 1, 'المسودة سليمة لإعادة المحاولة');
  assert.equal(client.removed.length, 1, 'الصورة الأولى المرفوعة نُظّفت');
  assert.equal(runInAppContext(app, 'batchBusyIds.size'), 0);
});

test('batchPromote — فشل إدراج الشاهد: المسودة تبقى والصور تُنظَّف', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed, { failInsert: { code: '42501', message: 'rls' } });
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchPromote('d1', [file('1.jpg')]);
  assert.equal(seed.shahid_drafts.length, 1);
  assert.equal(client.removed.length, 1);
});

test('batchOnPhotos — بطاقة قيد الرفع تتجاهل نقرة/اختيارًا ثانيًا (لا شاهد مكرر)', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }]; batchBusyIds.add("d1");');
  const input = { files: [file('1.jpg')], value: 'x' };
  await app.batchOnPhotos('d1', input);
  assert.equal(seed.shawahid.length, 0, 'لم يُنفَّذ تحويل ثانٍ');
});

test('batchOnPhotos — يرفض ما ليس صورة، ويحدّ العدد بـ4', async () => {
  const seed = { shahid_drafts: [DRAFT()], shawahid: [] };
  const { app, client } = prep(seed);
  runInAppContext(app, 'batchDrafts = [{ id: "d1", user_id: "u1", element_key: "k", template_name: "x", title: "t" }];');
  await app.batchOnPhotos('d1', { files: [{ name: 'a.pdf', type: 'application/pdf', size: 10 }], value: '' });
  assert.equal(client.uploaded.length, 0, 'مستند غير صورة لا يُرفع');
  const six = Array.from({ length: 6 }, (_, i) => file(i + '.jpg'));
  await app.batchOnPhotos('d1', { files: six, value: '' });
  assert.equal(client.uploaded.length, 4, 'أقصى 4 صور');
});

/* ---------- الاقتراح التلقائي على مستوى الشاشة ---------- */
test('الاقتراح التلقائي: يستبعد الموثّق فعلًا، ويعيد السحب عشوائيًا مع إبقاء اليدوي', async (t) => {
  const KEY = 'تحسين نتائج المتعلمين';
  const tplOf = (app) => JSON.parse(runInAppContext(app, `JSON.stringify(SHAHID_TEMPLATES[${JSON.stringify(KEY)}])`));
  const cy = (() => { const a = loadApp(); return a.getCycleYear(); })();
  const build = () => {
    const probe = loadApp();
    const tpls = tplOf(probe);
    const seed = {
      shahid_drafts: [],
      shawahid: [
        { id: 's1', user_id: 'u1', element_key: KEY, cycle_year: cy, lesson_title: tpls[0].name, description: 'x' },
        { id: 's2', user_id: 'u1', element_key: KEY, cycle_year: cy, lesson_title: 'عنوان آخر', description: tpls[1].description },
        { id: 's3', user_id: 'u1', element_key: KEY, cycle_year: '1999/2000', lesson_title: tpls[2].name, description: 'x' },
      ],
    };
    const { app } = prep(seed);
    return { app, tpls };
  };

  await t.test('loadBatchExisting تكشف النماذج الموثّقة (بالعنوان أو بالوصف) بالدورة الحالية فقط', async () => {
    const { app, tpls } = build();
    await app.loadBatchExisting();
    const used = JSON.parse(runInAppContext(app, 'JSON.stringify(batchUsedTpl)'));
    assert.deepEqual(used[KEY].sort(), [tpls[0].name, tpls[1].name].sort());
  });

  await t.test('الاقتراح لا يقترح نموذجًا موثّقًا، ونتائجه تتنوع بين الضغطات', async () => {
    const { app, tpls } = build();
    await app.loadBatchExisting();
    runInAppContext(app, `batchElems = [{ key: ${JSON.stringify(KEY)}, label: 'ع', weight: 9 }]; batchTarget = 4;`);
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      app.batchAutoPick();
      const pick = JSON.parse(runInAppContext(app, `JSON.stringify(batchPick[${JSON.stringify(KEY)}])`));
      assert.equal(pick.length, 4);
      assert.ok(!pick.includes(tpls[0].name) && !pick.includes(tpls[1].name), 'لا موثّق');
      seen.add(pick.slice().sort().join('|'));
    }
    assert.ok(seen.size > 1, 'اقتراحات مختلفة عند إعادة الضغط');
    assert.equal(runInAppContext(app, 'batchAutoDone'), true);
  });

  await t.test('إعادة الاقتراح تُبقي اختيار المعلم اليدوي وتستبدل ما اقترحه الزر', async () => {
    const { app, tpls } = build();
    await app.loadBatchExisting();
    runInAppContext(app, `batchElems = [{ key: ${JSON.stringify(KEY)}, label: 'ع', weight: 9 }]; batchTarget = 4; batchOpenEl.add(${JSON.stringify(KEY)});`);
    const manual = tpls[5].name;
    app.batchToggleTpl(0, 5); // اختيار يدوي
    for (let i = 0; i < 8; i++) {
      app.batchAutoPick();
      const pick = JSON.parse(runInAppContext(app, `JSON.stringify(batchPick[${JSON.stringify(KEY)}])`));
      assert.ok(pick.includes(manual), 'اليدوي باقٍ');
      assert.equal(pick.length, 4, 'العدد يشمل اليدوي');
    }
  });
});

/* ---------- زر الدخول يُخفى لو جدول المسودات غير جاهز ---------- */
test('refreshBatchEntry — يُخفى الزر عند غياب الجدول، ويظهر عند وجوده', async (t) => {
  const mk = (result) => {
    const c = makeBatchClient({});
    const q = { select() { return q; }, eq() { return q; }, limit() { return q; }, then(r) { r(result); return Promise.resolve(result); } };
    c.from = () => q;
    return c;
  };
  const run = async (result) => {
    const client = mk(result);
    const app = loadApp({ supabaseClient: client, currentUser: { id: 'u1' } });
    const registry = {};
    const live = () => ({ style: {}, textContent: '' });
    app.document.getElementById = (id) => (registry[id] = registry[id] || live());
    await app.refreshBatchEntry();
    return app.document.getElementById('batchEntry').style.display;
  };
  await t.test('خطأ صريح (الجدول غير موجود)', async () => assert.equal(await run({ count: null, error: { message: 'relation does not exist' } }), 'none'));
  await t.test('بلا عدّ وبلا خطأ (HEAD صامت)', async () => assert.equal(await run({ count: null, error: null }), 'none'));
  await t.test('الجدول جاهز', async () => assert.equal(await run({ count: 0, error: null }), 'block'));
});

/* ---------- 4) التوصيل ---------- */
test('التوصيل: الشاشة تُخفى مع بقية الشاشات، والملف بـindex/sw، والإصدار متطابق', () => {
  assert.match(read('app/app-04-academic-crm.js'), /getElementById\('batchView'\)\.style\.display = 'none'/);
  assert.match(read('index.html'), /id="batchView"/);
  assert.match(read('index.html'), /app\/app-33-shahid-batch\.js/);
  assert.match(read('sw.js'), /\.\/app\/app-33-shahid-batch\.js/);
  const showBatch = read('app/app-33-shahid-batch.js').match(/async function showBatch\(\)\{[\s\S]*?\n\}/)[0];
  assert.match(showBatch, /hideAllMainViews\(\)/);
  assert.match(showBatch, /getElementById\('batchView'\)\.style\.display = 'block'/);
});

test('المخطط والنسخ الاحتياطية تشمل shahid_drafts مع RLS للمالك', () => {
  const app = loadApp();
  const sql = app.buildSchemaSql();
  assert.match(sql, /create table if not exists public\.shahid_drafts/);
  assert.match(sql, /alter table public\.shahid_drafts enable row level security/);
  assert.match(sql, /on public\.shahid_drafts for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
  assert.match(app.buildSchemaSql('staging'), /create table if not exists staging\.shahid_drafts/);
  assert.match(read('sql-updates-run-in-supabase.sql'), /create table if not exists public\.shahid_drafts/);
  assert.match(read('app/app-07-backup-export.js'), /'lesson_plans', 'shahid_drafts'/, 'النسخة الكاملة (المسؤول)');
  assert.match(read('app/app-08-admin.js'), /from\('shahid_drafts'\)\.select\('\*'\)\.eq\('user_id', uid\)/, 'النسخة الشخصية بفلترة المالك');
  assert.match(read('app/app-08-admin.js'), /shahid_drafts: shahidDraftsRes\.data/);
});

/* ---------- واجهة شاشة الاختيار (تحسينات 2.42) ---------- */
function pickApp() {
  const app = loadApp({ currentUser: { id: 'u1' } });
  const registry = {};
  const live = () => ({ style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {}, contains: () => false, toggle() {} }, setAttribute() {}, querySelectorAll: () => [] });
  app.document.getElementById = (id) => (registry[id] = registry[id] || live());
  app.document.querySelectorAll = () => [];
  runInAppContext(app, `
    SHAHID_TEMPLATES['E1'] = ${JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ name: 'نموذج ' + i })))};
    SHAHID_TEMPLATES['E2'] = [{ name: 'ب <img src=x onerror=alert(1)>' }];
    SHAHID_TEMPLATES['E3'] = [{ name: 'ج1' }, { name: 'ج2' }];
    batchElems = [{ key: 'E1', label: 'عنصر 1', weight: 10 }, { key: 'E2', label: 'عنصر 2 <b>', weight: 10 }, { key: 'E3', label: 'عنصر 3', weight: 10 }];
    batchExisting = { E1: 6 }; batchStep = 'pick'; batchTarget = 24;`);
  return { app, reg: registry };
}

test('عنوان الشريط العلوي لشاشة التجهيز مسجّل (لا يظهر «الرئيسية»)', () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `TOP_TITLE_VIEWS.forEach(id => { const v = document.getElementById(id); if(v) v.style.display = 'none'; });
    document.getElementById('batchView').style.display = 'block';`);
  app.syncTopTitle();
  assert.equal(runInAppContext(app, `document.getElementById('topTitle').textContent`), 'تجهيز الشواهد');
});

test('قائمة العناصر: الفارغ أولًا بعنوانَي قسم، والفلاتر والبحث يعملان', () => {
  const { app } = pickApp();
  const html = runInAppContext(app, 'batchListHtml()');
  assert.match(html, /تحتاج شواهد أولًا/);
  assert.match(html, /لديها شواهد/);
  assert.ok(html.indexOf('btEl-1') < html.indexOf('btEl-0'), 'العنصر بلا شواهد قبل الموثّق');
  runInAppContext(app, `batchFilter = 'needs'`);
  const needs = runInAppContext(app, 'batchListHtml()');
  assert.doesNotMatch(needs, /btEl-0"/, 'الموثّق مخفي بفلتر «ينقصها»');
  runInAppContext(app, `batchFilter = 'sel'`);
  assert.match(runInAppContext(app, 'batchListHtml()'), /لا عناصر مطابقة/);
  runInAppContext(app, `batchFilter = 'all'; batchQuery = 'نموذج 7'`);
  const q = runInAppContext(app, 'batchListHtml()');
  assert.match(q, /btEl-0"/);
  assert.doesNotMatch(q, /btEl-2"/);
});

test('عنصر واحد مفتوح في كل مرة', () => {
  const { app } = pickApp();
  app.batchToggleOpen(0);
  app.batchToggleOpen(2);
  assert.deepEqual([...runInAppContext(app, 'Array.from(batchOpenEl)')], ['E3']);
  app.batchToggleOpen(2);
  assert.equal(runInAppContext(app, 'batchOpenEl.size'), 0);
});

test('صفوف النماذج: المختارة أولًا، أول 6 فقط ثم «عرض الباقي»، والحد يعطّل الباقي', () => {
  const { app } = pickApp();
  runInAppContext(app, `batchOpenEl.add('E1')`);
  let rows = runInAppContext(app, 'batchRowsHtml(0)');
  assert.equal((rows.match(/class="bt-tp[ "]/g) || []).length, 6);
  assert.match(rows, /عرض باقي النماذج \(4\)/);
  app.batchShowMore(0);
  rows = runInAppContext(app, 'batchRowsHtml(0)');
  assert.equal((rows.match(/class="bt-tp[ "]/g) || []).length, 10);
  [9, 3, 5].forEach(t => app.batchToggleTpl(0, t));
  rows = runInAppContext(app, 'batchRowsHtml(0)');
  assert.match(rows, /اخترتها \(3\)/);
  assert.ok(rows.indexOf('نموذج 9') < rows.indexOf('نموذج 0'), 'المختار فوق المتاح');
  app.batchToggleTpl(0, 7);
  rows = runInAppContext(app, 'batchRowsHtml(0)');
  assert.match(rows, /وصلت للحد الأقصى \(4\)/);
  assert.match(rows, /class="bt-tp off"[^>]*disabled/);
});

test('فهرس النموذج بالصف ثابت رغم الترتيب والتصفية (اختيار الصف = النموذج نفسه)', () => {
  const { app } = pickApp();
  runInAppContext(app, `batchOpenEl.add('E1'); batchInnerQ = 'نموذج 8'`);
  const rows = runInAppContext(app, 'batchRowsHtml(0)');
  const m = rows.match(/onclick="batchToggleTpl\(0, (\d+)\)"/);
  assert.equal(m[1], '8');
  app.batchToggleTpl(0, Number(m[1]));
  assert.deepEqual([...runInAppContext(app, `batchPick['E1']`)], ['نموذج 8']);
});

test('XSS: أسماء العناصر والنماذج تُهرَّب في القائمة والصفوف وورقة المراجعة', () => {
  const { app, reg } = pickApp();
  runInAppContext(app, `batchOpenEl.add('E2')`);
  app.batchToggleTpl(1, 0);
  const card = runInAppContext(app, 'batchPickCardHtml(1)');
  assert.doesNotMatch(card, /<img src=x/);
  assert.doesNotMatch(card, /<b>/);
  runInAppContext(app, `batchSheetOpen = true`);
  app.renderBatchSheet();
  assert.doesNotMatch(reg.btSheet.innerHTML, /<img src=x/);
  assert.match(reg.btSheet.innerHTML, /&lt;img/);
});

test('الشريط السفلي: ثلاث حالات، وحلقة الهدف تتبع الاختيار', () => {
  const { app, reg } = pickApp();
  app.renderBatchBar();
  assert.match(reg.btBar.innerHTML, /اختر شاهدًا واحدًا على الأقل/);
  assert.match(reg.btBar.innerHTML, /bt-next[^>]*disabled/);
  assert.equal(reg.btRingNum.textContent, '0/24');
  app.batchToggleTpl(0, 0);
  app.batchToggleTpl(2, 1);
  assert.match(reg.btBar.innerHTML, /2 من 24/);
  assert.equal(reg.btRingNum.textContent, '2/24');
  runInAppContext(app, `batchTarget = 2`);
  app.renderBatchBar();
  assert.match(reg.btBar.innerHTML, /اكتمل هدفك: 2 شاهدًا/);
});

test('ورقة المراجعة: تجمع حسب العنصر، × تزيل الاختيار، وتُغلق عند الفراغ', () => {
  const { app, reg } = pickApp();
  app.batchToggleTpl(0, 0);
  app.batchToggleTpl(2, 1);
  app.batchOpenReview();
  assert.equal(reg.btSheet.style.display, 'block');
  assert.match(reg.btSheet.innerHTML, /عنصر 1/);
  assert.match(reg.btSheet.innerHTML, /عنصر 3/);
  assert.match(reg.btSheet.innerHTML, /ينقصك 22/);
  app.batchToggleTpl(0, 0); // ما يفعله زر ×
  assert.doesNotMatch(reg.btSheet.innerHTML, /نموذج 0/);
  app.batchToggleTpl(2, 1);
  assert.equal(reg.btSheet.style.display, 'none', 'تُغلق حين لا اختيارات');
  assert.equal(runInAppContext(app, 'batchSheetOpen'), false);
});

test('الشاشة: أزرار الاتجاه والرأس بخطوات مسمّاة، وحاوية الورقة داخل batchView', () => {
  const { app } = pickApp();
  const h = app.batchHeader(2, 'ع', 'ف');
  assert.match(h, /الاختيار/);
  assert.match(h, /بياناتك/);
  assert.match(h, /الخطوة 2 من 3/);
  const idx = read('index.html');
  assert.match(idx, /<div id="batchView"[\s\S]*?id="btSheet"[\s\S]*?<!-- -{10}/);
});
