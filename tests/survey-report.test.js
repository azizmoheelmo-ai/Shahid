'use strict';
/* تقرير نتائج الاستبانة PDF (app-47، REPORTS.md §4.8): لا يُصدَّر إلا ما تعرضه الشاشة،
   كل نص من المعلم/المستفيدين يمرّ بـescapeHtml، الزر يتعطل أثناء التجهيز، ولا أسماء مستفيدين. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { makeApp, runInAppContext, FUTURE, GOOD, J } = require('./survey-kit');
const { SURVEY_READY_TEMPLATES } = require('../survey-templates.js');
const root = path.join(__dirname, '..');
const GQ = J(SURVEY_READY_TEMPLATES.guardian_v1.questions);
const camp = o => Object.assign({ id: 'c1', teacher_id: 'u1', title: 'رضا أولياء الأمور', audience: 'guardian', template: 'guardian_v1', questions: J(GQ), status: 'open', closes_at: FUTURE(), sort_order: 0, min_results: 5, created_at: 'x' }, o || {});
const resp = (n, extra) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i, campaign_id: 'c1', teacher_id: 'u1', answers: Object.assign({}, GOOD, extra || {}) }));

async function setup(n, extra, cOpts){
  const m = makeApp({ campaigns: [camp(cOpts)], sections: [{ teacher_id: 'u1', campaign_id: 'c1', section_id: 'sec1' }], responses: resp(n, extra), invites: Array.from({ length: n }, (_, i) => ({ id: 'i' + i, campaign_id: 'c1', teacher_id: 'u1', student_id: 'a', recipient: 'guardian', code: 'abcdefghjk', sent_at: 'x', answered_on: '2026-11-09' })) });
  await runInAppContext(m.app, `
    window.__printed = []; window.__busy = [];
    shahidWarmLogos = async () => {}; printPages = async (p, t) => { window.__printed.push({ p, t }); };
    beginExportBusy = () => window.__busy.push('b'); endExportBusy = () => window.__busy.push('e');
    currentUser = { id: 'u1', user_metadata: { full_name: 'المعلم <b>س</b>' } };`);
  await runInAppContext(m.app, `openSurvey('c1')`);
  return m;
}

test('الزر يظهر في النتائج بعد العتبة فقط', async () => {
  const ok = await setup(5);
  await runInAppContext(ok.app, `svSetTab('results')`);
  assert.match(ok.app.__els.svSheet.innerHTML, /svReportBtn/);
  const few = await setup(2);
  await runInAppContext(few.app, `svSetTab('results')`);
  assert.doesNotMatch(few.app.__els.svSheet.innerHTML, /svReportBtn/);
});

test('التصدير: صفحة واحدة fit:width، زر يتعطل ويُفكّ، والتقرير بلا أسماء وبنص مُهرَّب', async () => {
  const m = await setup(6, { q8: '<img src=x onerror=1>' }, { title: 'استبانة <script>' });
  await runInAppContext(m.app, `svExportReport()`);
  const printed = J(await runInAppContext(m.app, `window.__printed`));
  assert.equal(printed.length, 1);
  assert.equal(printed[0].p[0].fit, 'width');
  const html = printed[0].p[0].html;
  assert.doesNotMatch(html, /<script>|<img src=x|<b>س<\/b>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /من 5/);
  assert.deepEqual(J(await runInAppContext(m.app, `window.__busy`)), ['b', 'e']);
});

test('لا تصدير قبل العتبة، ولا نقر مزدوج', async () => {
  const few = await setup(2);
  await runInAppContext(few.app, `svExportReport()`);
  assert.equal((await runInAppContext(few.app, `window.__printed`)).length, 0);
  const m = await setup(6);
  await runInAppContext(m.app, `Promise.all([svExportReport(), svExportReport()])`);
  assert.equal((await runInAppContext(m.app, `window.__printed`)).length, 1);
});

test('التعليقات الزائدة تُعدّ ولا تُسرد، والملف مسجَّل بالشل', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-47-survey-report.js'), 'utf8');
  assert.match(src, /SVR_MAX_COMMENTS/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app-47-survey-report\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-47-survey-report\.js/);
});
