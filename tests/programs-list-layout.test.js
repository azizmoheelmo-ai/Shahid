'use strict';
/* تنظيم صفحة البرامج (قائمة + تفاصيل): الحذف داخل قائمة ⋯ منفصلة (لا زر ملاصق
   لـ"عرض")، شريط "هذا الأسبوع"، فرز الجاري أولًا وطيّ المكتمل، وحارس الحذف المزدوج. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runInAppContext } = require('./load-app.js');

function liveEl(){
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelector: () => liveEl(),
    querySelectorAll: () => [], setAttribute(){}, getAttribute: () => null };
}
function setup(programs){
  const app = loadApp({ supabaseClient: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }), getSession: async () => ({ data: { session: null } }) }, from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) }, currentUser: { id: 'u1' } });
  const reg = {};
  app.document.getElementById = id => (reg[id] = reg[id] || liveEl());
  app.__progs = programs;
  runInAppContext(app, 'activityPrograms = __progs;');
  return { app, body: () => app.document.getElementById('programsListBody').innerHTML };
}
const S = (no, week, done) => ({ session_no: no, week_label: week, done: !!done, done_date: done ? '2026-10-01' : null, shahid_id: done ? 'x' + no : null });
const PROGS = [
  { id: 'a', name: 'برنامج أ', total_sessions: 2, sessions: [S(1, 'الأسبوع 3', true), S(2, 'الأسبوع 5')] },
  { id: 'b', name: 'برنامج ب', total_sessions: 1, sessions: [S(1, 'الأسبوع 5')] },
  { id: 'c', name: 'برنامج مكتمل', total_sessions: 1, sessions: [S(1, 'الأسبوع 1', true)] },
];

describe('صفحة البرامج: تنظيم القائمة', () => {
  test('الحذف داخل قائمة ⋯ فقط، والبطاقة كلها تفتح البرنامج', () => {
    const { app, body } = setup(PROGS.slice());
    app.renderProgramsList('');
    const html = body();
    assert.match(html, /class="pg-card"[^>]*onclick="showProgramDetail\('a'\)"/);
    assert.doesNotMatch(html, /class="btn btn-outline"[^>]*>حذف</, 'لا زر حذف مستقل بجانب عرض');
    const menu = html.match(/<div class="pg-menu" id="pgMenu-a"[\s\S]*?<\/div>/)[0];
    assert.match(menu, /deleteActivityProgram\('a'\)/, 'الحذف موجود داخل القائمة المنسدلة');
  });

  test('مع تحديد الأسبوع: شريط "هذا الأسبوع" ويتصدّر ما يحتاج توثيقًا', () => {
    const { app, body } = setup([PROGS[2], PROGS[0], PROGS[1]]);
    app.renderProgramsList('الأسبوع 5');
    const html = body();
    assert.match(html, /حصتان تنتظران التوثيق هذا الأسبوع/);
    assert.ok(html.indexOf('برنامج أ') < html.indexOf('برنامج مكتمل'), 'الجاري قبل المكتمل');
    assert.match(html, /documentProgramSession\('b', 1\)/, 'توثيق مباشر من القائمة لبرنامج بلا شُعب');
  });

  test('بلا أسبوع معروف: لا شريط ولا تحذير (اختفاء صامت كالرئيسية)', () => {
    const { app, body } = setup(PROGS.slice());
    app.renderProgramsList('');
    assert.doesNotMatch(body(), /pg-now|⏰/);
  });

  test('المكتمل يُطوى بعنوان "مكتملة"، والفلتر يعزل التصنيفات', () => {
    const { app, body } = setup(PROGS.slice());
    app.renderProgramsList('');
    assert.match(body(), /مكتملة \(1\)/);
    app.setProgramsFilter('done');
    assert.match(body(), /برنامج مكتمل/);
    assert.doesNotMatch(body(), /برنامج أ/);
    app.setProgramsFilter('active');
    assert.doesNotMatch(body(), /برنامج مكتمل/);
    app.setProgramsFilter('all');
  });

  test('حالة فارغة ودّية، وأسماء البرامج تمرّ عبر escapeHtml', () => {
    const { app, body } = setup([]);
    app.renderProgramsList('');
    assert.match(body(), /friendly-empty/);
    const x = setup([{ id: 'z', name: '<img src=x onerror=alert(1)>', total_sessions: 1, sessions: [S(1, 'w')] }]);
    x.app.renderProgramsList('');
    assert.doesNotMatch(x.body(), /<img src=x/);
  });

  test('deleteActivityProgram: نقرتان متتاليتان = حذف واحد فقط', async () => {
    const { app } = setup(PROGS.slice());
    let confirms = 0;
    app.showConfirm = () => { confirms++; return new Promise(r => setTimeout(() => r(false), 10)); };
    await Promise.all([app.deleteActivityProgram('a'), app.deleteActivityProgram('a')]);
    assert.equal(confirms, 1);
  });
});
