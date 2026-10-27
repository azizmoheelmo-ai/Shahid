'use strict';
/* تنظيم صفحة مهامّي والنموذج: الحذف داخل قائمة ⋯، المتأخرة تُنبَّه، المنجزة تُطوى،
   الشُعب كبسولات بدل مربعات اختيار، وحارس الحذف المزدوج. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runInAppContext } = require('./load-app.js');

function liveEl(){
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelector: () => liveEl(),
    querySelectorAll: () => [], setAttribute(){}, getAttribute: () => null };
}
function setup(tasks){
  const app = loadApp({ supabaseClient: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }), getSession: async () => ({ data: { session: null } }) }, from: () => ({}), storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }) }, currentUser: { id: 'u1' } });
  const reg = {};
  app.document.getElementById = id => (reg[id] = reg[id] || liveEl());
  app.__t = tasks;
  runInAppContext(app, 'myTasks = __t;');
  return { app, body: () => app.document.getElementById('tasksListBody').innerHTML };
}
const T = (id, title, over) => ({ id, title, priority: 'medium', done: false, due_date: null, ...over });

describe('صفحة مهامّي: تنظيم القائمة', () => {
  test('البطاقة تفتح التعديل، والحذف داخل قائمة ⋯ فقط', () => {
    const { app, body } = setup([T('t1', 'مهمة 1')]);
    app.renderTasksList();
    const html = body();
    assert.match(html, /class="pg-card[^"]*" onclick="editTask\('t1'\)"/);
    assert.doesNotMatch(html, /class="btn btn-outline"/);
    assert.match(html.match(/id="tkMenu-t1"[\s\S]*?<\/div>/)[0], /deleteTask\('t1'\)/);
  });

  test('المتأخرة تُنبَّه، والمنجزة تُطوى تحت عنوان، والفلتر يعزل', () => {
    const { app, body } = setup([T('a', 'متأخرة', { due_date: '2020-01-01' }), T('b', 'منجزة', { done: true })]);
    app.renderTasksList();
    assert.match(body(), /مهمة واحدة تجاوزت الاستحقاق/);
    assert.match(body(), /منجزة \(1\)/);
    app.setTasksFilter('open');
    assert.doesNotMatch(body(), /منجزة<\/div>|>منجزة</);
    app.setTasksFilter('done');
    assert.doesNotMatch(body(), /متأخرة<\/div>/);
    app.setTasksFilter('all');
  });

  test('عنوان المهمة يمرّ عبر escapeHtml، والحالة الفارغة ودّية', () => {
    const { app, body } = setup([T('x', '<img src=x onerror=alert(1)>')]);
    app.renderTasksList();
    assert.doesNotMatch(body(), /<img src=x/);
    const e = setup([]); e.app.renderTasksList();
    assert.match(e.body(), /friendly-empty/);
  });

  test('deleteTask: نقرتان متتاليتان = تأكيد واحد فقط', async () => {
    const { app } = setup([T('a', 'م')]);
    let n = 0;
    app.showConfirm = () => { n++; return new Promise(r => setTimeout(() => r(false), 10)); };
    await Promise.all([app.deleteTask('a'), app.deleteTask('a')]);
    assert.equal(n, 1);
  });

  test('نموذج البرنامج: الشُعب كبسولات (لا مربعات اختيار)', () => {
    const { app } = setup([]);
    runInAppContext(app, "pgCrmGradeLevels=[{id:'g',name:'الخامس'}];pgCrmSections=[{id:'s1',grade_level_id:'g',name:'أ'}];pgSelectedSectionIds=['s1'];");
    app.renderProgramSectionPicker();
    const html = app.document.getElementById('pgSectionsPicker').innerHTML;
    assert.match(html, /class="pg-sp is-on"/);
    assert.doesNotMatch(html, /type="checkbox"/);
  });

  test('الموعد بلغة المعلم: اليوم/غدًا/بعد N أيام، وتاريخ كامل للأبعد', () => {
    const { app } = setup([]);
    assert.equal(app.taskDueText('2026-10-27', '2026-10-27'), 'اليوم');
    assert.equal(app.taskDueText('2026-10-28', '2026-10-27'), 'غدًا');
    assert.equal(app.taskDueText('2026-10-29', '2026-10-27'), 'بعد يومين');
    assert.equal(app.taskDueText('2026-11-01', '2026-10-27'), 'بعد 5 أيام');
    assert.notEqual(app.taskDueText('2026-12-30', '2026-10-27'), 'بعد 64 أيام');
    assert.equal(app.taskDaysUntil('2026-11-01', '2026-10-30'), 2, 'عبر حدود الشهر');
  });

  test('شريط "تستحق خلال 3 أيام" يعدّ القريبة فقط (لا المتأخرة ولا المنجزة ولا البعيدة)', () => {
    const { app, body } = setup([]);
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return app.localIsoDate(d); };
    app.__t2 = [T('a', 'اليوم', { due_date: day(0) }), T('b', 'بعد يومين', { due_date: day(2) }), T('c', 'بعيدة', { due_date: day(20) }),
      T('d', 'منجزة قريبة', { due_date: day(1), done: true }), T('e', 'متأخرة', { due_date: day(-2) })];
    runInAppContext(app, 'myTasks = __t2;');
    app.renderTasksList();
    assert.match(body(), /مهمتان تستحقان خلال 3 أيام/);
    assert.match(body(), /مهمة واحدة تجاوزت الاستحقاق/);
    assert.match(body(), /الاستحقاق: اليوم/);
  });
});
