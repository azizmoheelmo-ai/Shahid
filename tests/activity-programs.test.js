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

  test('clearProgramSessionLink(): تُعيد حصة موثَّقة إلى "لم تُوثَّق بعد" عند حذف شاهدها، دون التأثير على باقي الحصص', async () => {
    const seed = {
      activity_programs: [
        {
          id: 'p1', user_id: 'u1', name: 'برنامج الإسعافات الأولية', total_sessions: 2,
          sessions: [
            { session_no: 1, week_label: 'الأسبوع الأول', done: true, done_date: '2025-09-10', shahid_id: 'sh-1' },
            { session_no: 2, week_label: 'الأسبوع الخامس', done: true, done_date: '2025-10-08', shahid_id: 'sh-2' },
          ],
        },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.loadActivityPrograms();
    /* هذا بالضبط ما يستدعيه deleteRecord (app-09) عند حذف شاهد كان يوثّق حصة —
       يجب أن تعود الحصة "غير موثَّقة" (تُتاح لإعادة توثيقها) بدل أن تبقى
       عالقة للأبد على أنها موثَّقة بشاهد لم يعد موجودًا. */
    const previous = await app.clearProgramSessionLink('p1', 1);

    assert.ok(previous, 'يجب أن تُرجع الدالة بيانات الحصة كما كانت قبل التفريغ (للتراجع عن الحذف لاحقًا)');
    assert.equal(previous.done_date, '2025-09-10');

    app.renderProgramDetail('p1');
    const html = app.document.getElementById('programDetailBody').innerHTML;
    assert.match(html, /توثيق هذه الحصة/, 'الحصة الأولى يجب أن تصبح قابلة لإعادة التوثيق بعد حذف شاهدها');
    assert.match(html, /✓ وُثّقت.*2025-10-08|2025-10-08.*✓ وُثّقت/s, 'الحصة الثانية يجب أن تبقى موثَّقة كما كانت دون أي تأثير');
  });

  test('markProgramSessionDone(): يقبل تاريخ توثيق مخصص لاستعادته بنفس تاريخه الأصلي عند التراجع عن حذف', async () => {
    const seed = {
      activity_programs: [
        {
          id: 'p1', user_id: 'u1', name: 'برنامج القراءة الحرة', total_sessions: 1,
          sessions: [{ session_no: 1, week_label: 'الأسبوع الثاني', done: false, done_date: null, shahid_id: null }],
        },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.loadActivityPrograms();
    await app.markProgramSessionDone('p1', 1, 'sh-restored', '2025-09-15');
    app.renderProgramDetail('p1');

    const html = app.document.getElementById('programDetailBody').innerHTML;
    assert.match(html, /2025-09-15/, 'يجب أن يُستخدم التاريخ المُمرَّر صراحة، لا تاريخ اليوم');
  });

  test('showProgramDetail(): يُخفي الشاشة الحالية (نموذج الشاهد مثلاً) ويُظهر #programsView فعليًا — لا يكتفي بتبديل الأقسام الداخلية فقط', async () => {
    /* خلل حقيقي اكتُشف بعد الإطلاق: showProgramDetail كانت تستدعي فقط
       showProgramsSection('detail') (تبديل الأقسام الداخلية لـ #programsView)
       دون hideAllMainViews() ولا إظهار #programsView نفسها. يعمل هذا بالصدفة
       لو استُدعيت والمستخدم أصلًا داخل #programsView (كزر "عرض" بالقائمة)،
       لكنه يفشل تمامًا عند استدعائها من saveShahid (app-09) بعد توثيق حصة —
       يبقى نموذج الشاهد (#formView) ظاهرًا كما هو رغم نجاح الحفظ فعليًا،
       فيظن المستخدم أن الحفظ لم يتم ويضغط "حفظ" مرة أخرى فيُنشئ شاهدًا
       مكررًا (بالضبط ما أبلغ عنه المستخدم). */
    const seed = {
      activity_programs: [
        { id: 'p1', user_id: 'u1', name: 'برنامج الإسعافات الأولية', total_sessions: 1,
          sessions: [{ session_no: 1, week_label: 'الأسبوع الأول', done: true, done_date: '2025-09-10', shahid_id: 'sh-1' }] },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    /* محاكاة كون المستخدم حاليًا على نموذج الشاهد (كما يحصل فعليًا بعد
       الضغط على "توثيق هذه الحصة" ثم "حفظ الشاهد") */
    app.document.getElementById('formView').style.display = 'block';
    app.document.getElementById('programsView').style.display = 'none';

    await app.showProgramDetail('p1');

    assert.equal(app.document.getElementById('formView').style.display, 'none', 'نموذج الشاهد يجب أن يختفي فعليًا بعد الانتقال');
    assert.equal(app.document.getElementById('programsView').style.display, 'block', '#programsView يجب أن تظهر فعليًا، لا فقط أقسامها الداخلية');
  });

  test('deleteProgramSessionShahid(): يحذف الشاهد من "برامجي" مباشرة، ويُعيد رسم تفاصيل البرنامج فورًا لتصبح الحصة قابلة لإعادة التوثيق', async () => {
    const seed = {
      activity_programs: [
        { id: 'p1', user_id: 'u1', name: 'برنامج الإسعافات الأولية', total_sessions: 1,
          sessions: [{ session_no: 1, week_label: 'الأسبوع الأول', done: true, done_date: '2025-09-10', shahid_id: 'sh-1' }] },
      ],
      shawahid: [
        { id: 'sh-1', user_id: 'u1', program_id: 'p1', program_session_no: 1, element_key: 'classroom', lesson_title: 'الحصة 1', created_at: '2025-09-10' },
      ],
    };
    const app = loadApp({ supabaseClient: makeProgramsClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    /* showConfirm/showUndoToast نوافذ تفاعلية حقيقية بالتطبيق (تنتظر ضغط
       المستخدم) — نستبدلها هنا بموافقة تلقائية فورية لاختبار منطق الحذف
       نفسه دون الحاجة لمحاكاة DOM نوافذ حقيقية (نفس أسلوب تجاوز الدوال
       القابلة للاستبدال الموثَّق بهذا المستودع). */
    app.showConfirm = async () => true;
    app.showUndoToast = async () => true; // true = لم يتراجع المستخدم (تنفيذ الحذف كاملاً)

    await app.loadActivityPrograms();
    await app.loadMyShawahid();
    await app.showProgramDetail('p1');

    let html = app.document.getElementById('programDetailBody').innerHTML;
    assert.match(html, /✓ وُثّقت/, 'قبل الحذف: الحصة تظهر موثَّقة');
    assert.match(html, /حذف الشاهد/, 'زر حذف الشاهد يجب أن يظهر لحصة موثَّقة');

    await app.deleteProgramSessionShahid('sh-1', 'p1');

    assert.equal((seed.shawahid || []).length, 0, 'الشاهد يجب أن يُحذف فعليًا من قاعدة البيانات');

    html = app.document.getElementById('programDetailBody').innerHTML;
    assert.match(html, /لم تُوثَّق بعد/, 'بعد الحذف: الحصة يجب أن تعود "لم تُوثَّق بعد" فورًا دون انتظار');
    assert.match(html, /توثيق هذه الحصة/, 'زر توثيق الحصة يجب أن يظهر من جديد فورًا بعد الحذف');
  });
});
