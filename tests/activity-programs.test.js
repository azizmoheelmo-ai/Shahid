'use strict';
/* اختبارات ميزة "برامج الأنشطة الطلابية متعددة الحصص" (app-10-programs.js):

   1) عزل بيانات المستخدم: loadActivityPrograms() يجب ألا يعرض برامج معلم
      آخر — نفس فئة الخلل المُصلَحة سابقًا بـ loadMyShawahid/buildAdminRisks
      (راجع tests/data-scoping-regression.test.js).

   2) تحديث تقدّم البرنامج: markProgramSessionDone() (تُستدعى من saveShahid
      بعد حفظ شاهد يوثّق حصة من برنامج) يجب أن تُحدِّث حالة الحصة المحدَّدة
      فقط دون التأثير على حالة/بيانات باقي الحصص الموثَّقة سابقًا أو
      اللاحقة. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

/* عميل وهمي يطبّق فلاتر .eq() فعليًا (كما بـ data-scoping-regression)،
   مع دعم إضافي لـ update()/delete() اللازمين لاختبار markProgramSessionDone —
   update() يُحدِّث الصفوف المطابقة للفلاتر الحالية في مكانها (mutation)،
   تمامًا كتحديث حقيقي بقاعدة بيانات. */
function makeProgramsClient(seedByTable){
  function chain(table){
    const filters = [];
    let mode = 'select';
    let updatePayload = null;
    const rowsFor = () => (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const api = {
      select(){ return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      order(){ return api; },
      limit(){ return api; },
      range(){ return api; },
      update(payload){ mode = 'update'; updatePayload = payload; return api; },
      delete(){ mode = 'delete'; return api; },
      maybeSingle: async () => {
        const rows = rowsFor();
        return { data: rows[0] || null, error: null };
      },
      then(resolve){
        let result;
        if(mode === 'update'){
          rowsFor().forEach(r => Object.assign(r, updatePayload));
          result = { data: null, error: null };
        } else if(mode === 'delete'){
          const toRemove = rowsFor();
          seedByTable[table] = (seedByTable[table] || []).filter(r => !toRemove.includes(r));
          result = { data: null, error: null };
        } else {
          result = { data: rowsFor(), error: null };
        }
        resolve(result);
        return Promise.resolve(result);
      },
    };
    return api;
  }
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: chain,
    storage: { from: () => ({}) },
    rpc: async () => ({ data: null, error: null }),
  };
}

/* نفس أداة "DOM حيّة" المستخدمة بـ data-scoping-regression.test.js — تحتفظ
   بحالة العناصر بين نداءات getElementById المتكررة لنفس id، فتُتيح قراءة
   innerHTML الذي تكتبه دوال العرض المختبَرة. */
function makeLiveElement(){
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelector: () => makeLiveElement(),
    querySelectorAll: () => [], setAttribute(){}, getAttribute: () => null };
}
function installLiveDom(app){
  const registry = {};
  app.document.getElementById = (id) => (registry[id] = registry[id] || makeLiveElement());
}

describe('برامج الأنشطة الطلابية متعددة الحصص', () => {
  test('loadActivityPrograms(): لا يعرض برامج معلم آخر ضمن "برامجي" الخاصة بالمستخدم الحالي', async () => {
    const seed = {
      activity_programs: [
        {
          id: 'p-u1', user_id: 'u1', name: 'برنامج الإسعافات الأولية', total_sessions: 2,
          sessions: [
            { session_no: 1, week_label: 'الأسبوع الأول', done: false, done_date: null, shahid_id: null },
            { session_no: 2, week_label: 'الأسبوع الخامس', done: false, done_date: null, shahid_id: null },
          ],
        },
        {
          id: 'p-u2', user_id: 'u2', name: 'برنامج معلم آخر', total_sessions: 1,
          sessions: [{ session_no: 1, week_label: 'الأسبوع الأول', done: false, done_date: null, shahid_id: null }],
        },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.loadActivityPrograms();
    app.renderProgramsList();

    const html = app.document.getElementById('programsListBody').innerHTML;
    assert.match(html, /برنامج الإسعافات الأولية/, 'يجب أن يظهر برنامج المستخدم الحالي (u1)');
    assert.doesNotMatch(html, /برنامج معلم آخر/, 'لا يجب أن يظهر برنامج معلم آخر (u2)');
  });

  test('markProgramSessionDone(): تُحدِّث حالة الحصة المحدَّدة فقط وتحافظ على باقي الحصص', async () => {
    const seed = {
      activity_programs: [
        {
          id: 'p1', user_id: 'u1', name: 'برنامج الإسعافات الأولية', total_sessions: 3,
          element_key: null, student_count: 25, cycle_year: '2025/2026',
          sessions: [
            { session_no: 1, week_label: 'الأسبوع الأول', done: true, done_date: '2025-09-01', shahid_id: 'sh-1' },
            { session_no: 2, week_label: 'الأسبوع الخامس', done: false, done_date: null, shahid_id: null },
            { session_no: 3, week_label: 'الأسبوع العاشر', done: false, done_date: null, shahid_id: null },
          ],
        },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.loadActivityPrograms();
    await app.markProgramSessionDone('p1', 2, 'sh-2');
    app.renderProgramDetail('p1');

    const html = app.document.getElementById('programDetailBody').innerHTML;
    const doneCount = (html.match(/✓ وُثّقت/g) || []).length;
    assert.equal(doneCount, 2, 'يجب أن تظهر حصتان موثَّقتان (الأولى القديمة + الثانية المحدَّثة الآن)');
    assert.match(html, /لم تُوثَّق بعد/, 'الحصة الثالثة يجب أن تبقى غير موثَّقة');
    assert.match(html, /الأسبوع الأول/, 'بيانات الحصة الأولى (غير المُعدَّلة) يجب أن تبقى كما هي');
    assert.match(html, /2025-09-01/, 'تاريخ توثيق الحصة الأولى يجب ألا يتأثر بتحديث الحصة الثانية');
  });
});
