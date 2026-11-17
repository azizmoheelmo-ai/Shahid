'use strict';
/* ============================================================
   «بطاقة الدليل» (app-53): صورة من بيانات العمل، بلا أسماء طلاب، ومكتوب عليها أنها مولّدة
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');
const J = x => JSON.parse(JSON.stringify(x));

test('سلّم التقدير: نسبة من أتقن (كامل أو كبير) لكل معيار بترتيبه', () => {
  const app = loadApp();
  const c = app.evidenceCardRubric({ name: 'قراءة', criteria: [{ id: 'a', name: 'الطلاقة', position: 1 }, { id: 'b', name: 'النطق', position: 0 }],
    marks: [{ criterion_id: 'a', level: 0 }, { criterion_id: 'a', level: 2 }, { criterion_id: 'b', level: 1 }, { criterion_id: 'b', level: 1 }] });
  assert.equal(c.kind, 'bars');
  assert.deepEqual(J(c.rows), [{ label: 'النطق', value: '2 من 2', pct: 100 }, { label: 'الطلاقة', value: '1 من 2', pct: 50 }]);
});

test('الاختبار: المستويات بحدود المعلم، والفارغ لا يُحسب', () => {
  const app = loadApp();
  const c = app.evidenceCardTest({ name: 'ت', max: 10, scores: [2, 5, 6, 9, 10, null, ''], rules: { pass: 60, top: 90 } });
  assert.deepEqual(J(c.levels.map(l => l.n)), [2, 1, 2]);
  assert.match(c.caption, /5 طلاب · المتوسط 64%/);
  assert.match(app.evidenceCardTest({ name: 'ت', max: 10, scores: Array(17).fill(5) }).caption, /17 طالبًا/, 'تمييز العدد');
});

test('المهمة: توزيع المقيَّمين فقط', () => {
  const app = loadApp();
  const c = app.evidenceCardTask({ title: 'م', max: 10, rows: [{ score: 9 }, { score: 6 }, { score: 2 }, { score: null }] });
  assert.deepEqual(J(c.levels.map(l => l.n)), [1, 1, 1]);
  assert.match(c.caption, /قُيّم 3 من 4/);
});

test('الاستبانة: محاور التقييم من 5', () => {
  const app = loadApp();
  const c = app.evidenceCardSurvey({ title: 'رضا', analysis: { valid: 6, items: [{ type: 'rating', label: 'التواصل', avg: 4.25 }, { type: 'text', label: 'ملاحظات' }] } });
  assert.deepEqual(J(c.rows), [{ label: 'التواصل', value: '4.3 من 5', pct: 85 }]);
});

test('رصد الشهر: تقويم بأيامه، وعدد الحصص في كل يوم', () => {
  const app = loadApp();
  const c = app.evidenceCardLessons({ month: '2026-09', lessons: [{ lesson_date: '2026-09-01' }, { lesson_date: '2026-09-01' }, { lesson_date: '2026-09-03' }] });
  assert.equal(c.days.daysIn, 30);
  assert.equal(c.days.firstDow, 2, '1 سبتمبر 2026 ثلاثاء');
  assert.deepEqual(J(c.days.counts), { 1: 2, 3: 1 });
  assert.match(c.caption, /3 حصة مرصودة في 2 يومًا/);
});

test('المتابعة: لا اسم طالب أبدًا في البطاقة (حتى لو أظهره المعلم في النص)', () => {
  const app = loadApp();
  const members = [{ followup: { reason_type: 'absence', baseline: { of: 8, count: 3 }, result: { sufficient: true, count: 0, of: 6 } }, studentName: 'سالم العتيبي' },
    { followup: { reason_type: 'absence', baseline: { of: 8, count: 4 }, result: {} }, studentName: 'فهد' }];
  const c = app.evidenceCardFollowup({ members, reason: 'غياب متكرر' });
  const html = app.buildEvidenceCardHtml(c);
  assert.doesNotMatch(html, /سالم|فهد/);
  assert.match(html, /طالب 1/);
  assert.match(html, /غاب 3 من 8 حصص/);
});

test('البرنامج والخطة', () => {
  const app = loadApp();
  assert.equal(app.evidenceCardProgram({ name: 'نادي', total: 6, done: 2, sessionNo: 3 }).rows[0].value, '3 من 6');
  assert.equal(app.evidenceCardProgram({ name: 'نادي', total: 6, done: 6, sessionNo: 6 }).rows[0].value, '6 من 6', 'لا يتجاوز الإجمالي');
  assert.deepEqual(J(app.evidenceCardPlan({ title: 'خ', steps: ['أ', '', 'ب'] }).items), ['أ', 'ب']);
});

test('الرسم: كل نص مهرّب، وعبارة «مولّدة من بيانات التطبيق — بلا أسماء طلاب» دائمًا', () => {
  const app = loadApp();
  for(const c of [
    app.evidenceCardRubric({ name: '<img src=x onerror=1>', criteria: [{ id: 'a', name: '<script>' }], marks: [{ criterion_id: 'a', level: 0 }] }),
    app.evidenceCardTest({ name: '<b>x</b>', max: 10, scores: [1, 2, 3, 4, 5] }),
    app.evidenceCardLessons({ month: '2026-09', lessons: [] }),
    app.evidenceCardPlan({ title: '"><svg onload=1>', steps: ['<i>'] })
  ]){
    const html = app.buildEvidenceCardHtml(c);
    assert.doesNotMatch(html, /<img src=x|<script>|<b>x<\/b>|<svg onload|<i>/);
    assert.match(html, /مولّدة من بيانات التطبيق — بلا أسماء طلاب/);
  }
  assert.equal(app.buildEvidenceCardHtml(null), '');
});
