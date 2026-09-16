'use strict';
/* اختبارات انحدار (regression) لثلاثة مواضع فعلية اكتُشفت بمراجعة شاملة
   للكود: استعلامات كانت تعتمد على RLS وحدها بدل فلترة صريحة بمعرّف
   المستخدم/المعلم الحالي، فتُظهر لحساب المسؤول بيانات كل المعلمين مجتمعة
   في شاشاته الشخصية هو (لا شاشة "لوحة التحكم" التي يُقصد منها فعلاً رؤية
   الكل) — نفس فئة الخلل الذي عولج سابقًا في loadPlan (راجع
   tests/plan-user-scoping.test.js لتفاصيل آلية الفلترة والسبب الجذري):

   1) loadMyShawahid()  (app-09): شاشة "شواهدي المحفوظة" الخاصة بالمستخدم.
   2) buildAdminRisks()  (app-03): تنبيهات "إدارة الصف" في الرئيسية.
   3) buildAcademicRisks() (app-03): تنبيهات "المتابعة الأكاديمية" بالرئيسية.

   (exportBackup/exportPortfolio في app-08 أُصلحا بنفس المنطق أيضًا، لكن
   لا يمكن اختبارهما هنا لأنهما يحمّلان مكتبات PDF/Excel من CDN خارجي عبر
   عنصر <script> حقيقي ينتظر حدث load — بيئة الاختبار هذه (DOM وهمي متسامح)
   لا تُطلق هذا الحدث إطلاقًا فتُعلّق الدالة للأبد؛ صحّتهما تحقّقت بالمراجعة
   اليدوية المباشرة للكود بدل اختبار آلي.) */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

/* عميل وهمي يطبّق فلاتر .eq()/.range() فعليًا على بيانات مزروعة لأكثر من
   مستخدم — يحاكي RLS + "المسؤول يشوف الكل" معًا، تمامًا كحال حساب مسؤول
   بالتطبيق الحقيقي (راجع نفس الفكرة في tests/plan-user-scoping.test.js). */
function makeScopedClient(seedByTable){
  function chain(table){
    const filters = [];
    const rowsFor = () => (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
    const api = {
      select(){ return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      order(){ return api; },
      limit(){ return api; },
      range(){ return api; },
      maybeSingle: async () => {
        const rows = rowsFor();
        return { data: rows[0] || null, error: null };
      },
      then(resolve){
        const result = { data: rowsFor(), error: null };
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

/* سجل عناصر DOM وهمية "حيّة" (تحتفظ بحالتها بين نداءات getElementById
   المتكررة لنفس id) — الفئة الافتراضية في load-app.js تُنشئ عنصرًا جديدًا
   فارغًا بكل نداء، فلا تصلح لقراءة innerHTML بعد تنفيذ الدالة المختبَرة. */
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

describe('عزل بيانات المستخدم في شاشاته الشخصية (لا شاشة لوحة تحكم المسؤول)', () => {
  test('loadMyShawahid(): لا يعرض شواهد معلم آخر ضمن "شواهدي" الخاصة بالمستخدم الحالي', async () => {
    const seed = {
      shawahid: [
        { id: 's-u1', user_id: 'u1', element_key: 'الإدارة الصفية', lesson_title: 'شاهد المعلم الأول', created_at: '2026-01-01' },
        { id: 's-u2-a', user_id: 'u2', element_key: 'الإدارة الصفية', lesson_title: 'شاهد المعلم الثاني أ', created_at: '2026-01-02' },
        { id: 's-u2-b', user_id: 'u2', element_key: 'الإدارة الصفية', lesson_title: 'شاهد المعلم الثاني ب', created_at: '2026-01-03' },
      ],
    };
    const app = loadApp({ supabaseClient: makeScopedClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    let captured = null;
    app.renderShawahidGroups = (records) => { captured = records; };

    await app.loadMyShawahid();

    assert.ok(captured, 'المفروض renderShawahidGroups يُستدعى بنتيجة التحميل');
    assert.equal(captured.length, 1, 'يجب أن يظهر شاهد المستخدم الحالي (u1) فقط، لا شواهد u2 أيضًا (2)');
    assert.equal(captured[0].id, 's-u1');
  });

  test('buildAdminRisks(): تنبيهات إدارة الصف تخص حوادث المعلم الحالي فقط', async () => {
    const seed = {
      classroom_students: [
        { id: 'st-u1', teacher_id: 'u1', full_name: 'طالب المعلم الأول' },
        { id: 'st-u2', teacher_id: 'u2', full_name: 'طالب المعلم الثاني' },
      ],
      classroom_incident_types: [
        { id: 't1', problem_name: 'مخالفة تجريبية', problem_degree: 5 },
      ],
      classroom_incidents: [
        { id: 'i-u1', teacher_id: 'u1', student_id: 'st-u1', incident_type_id: 't1', current_stage: 'referred', referral_letter_generated: false, referral_receipt_photo_url: null, created_at: '2026-01-01' },
        { id: 'i-u2', teacher_id: 'u2', student_id: 'st-u2', incident_type_id: 't1', current_stage: 'referred', referral_letter_generated: false, referral_receipt_photo_url: null, created_at: '2026-01-01' },
      ],
    };
    const app = loadApp({ supabaseClient: makeScopedClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.buildAdminRisks();

    const html = app.document.getElementById('riskAdminBody').innerHTML;
    assert.match(html, /طالب المعلم الأول/, 'يجب أن تظهر مخالفة طالب المعلم الحالي (u1)');
    assert.doesNotMatch(html, /طالب المعلم الثاني/, 'لا يجب أن تظهر مخالفة طالب معلم آخر (u2)');
  });

  test('buildAcademicRisks(): تنبيهات المتابعة الأكاديمية تخص حالات المعلم الحالي فقط', async () => {
    const seed = {
      classroom_students: [
        { id: 'st-u1', teacher_id: 'u1', full_name: 'طالب المعلم الأول' },
        { id: 'st-u2', teacher_id: 'u2', full_name: 'طالب المعلم الثاني' },
      ],
      academic_cases: [
        { id: 'c-u1', teacher_id: 'u1', student_id: 'st-u1', subject: 'رياضيات', status: 'referred', referral_letter_generated: false, referral_receipt_photo_url: null, created_at: '2026-01-01' },
        { id: 'c-u2', teacher_id: 'u2', student_id: 'st-u2', subject: 'علوم', status: 'referred', referral_letter_generated: false, referral_receipt_photo_url: null, created_at: '2026-01-01' },
      ],
    };
    const app = loadApp({ supabaseClient: makeScopedClient(seed), currentUser: { id: 'u1' } });
    installLiveDom(app);

    await app.buildAcademicRisks();

    const html = app.document.getElementById('riskAcademicBody').innerHTML;
    assert.match(html, /طالب المعلم الأول/, 'يجب أن تظهر حالة طالب المعلم الحالي (u1)');
    assert.doesNotMatch(html, /طالب المعلم الثاني/, 'لا يجب أن تظهر حالة طالب معلم آخر (u2)');
  });
});

describe('عزل مسودة الشاهد المحفوظة محليًا (localStorage) بين المستخدمين على نفس الجهاز', () => {
  /* خلل مكتشف بنفس المراجعة: DRAFT_KEY كان مفتاحًا واحدًا مشتركًا لكل من
     يستخدم نفس المتصفح — على جهاز مشترك بين أكثر من معلم (جهاز لوحي بغرفة
     المعلمين مثلًا)، معلم يبدأ شاهدًا ولا يحفظه ثم يدخل معلم آخر على نفس
     الجهاز، تُعرض عليه تلقائيًا (offerDraftRestore تعمل بعد كل تسجيل دخول)
     استعادة مسودة المعلم الأول الخاصة. */
  test('draftKey() يُنتج مفتاحًا مختلفًا لكل مستخدم — لا مفتاح مشترك', () => {
    const app1 = loadApp({ currentUser: { id: 'u1' } });
    const app2 = loadApp({ currentUser: { id: 'u2' } });
    const k1 = app1.draftKey();
    const k2 = app2.draftKey();
    assert.ok(k1 && k2, 'يجب أن يُرجع كل تطبيق مفتاحًا فعليًا لمستخدمه');
    assert.notEqual(k1, k2, 'مفتاح مسودة معلم يجب أن يختلف عن مفتاح معلم آخر');
    assert.ok(k1.includes('u1'), 'المفتاح يجب أن يتضمن معرّف المستخدم الحالي');
    assert.ok(k2.includes('u2'));
  });

  test('purgeLegacyUnscopedDraft(): يمسح المفتاح المشترك القديم دون المساس بمسودة المستخدم الحالي', () => {
    const app = loadApp({ currentUser: { id: 'u1' } });
    app.localStorage.setItem('shahid_draft_v1', JSON.stringify({ description: 'مسودة معلم سابق على جهاز مشترك' }));
    app.localStorage.setItem(app.draftKey(), JSON.stringify({ description: 'مسودتي أنا' }));

    app.purgeLegacyUnscopedDraft();

    assert.equal(app.localStorage.getItem('shahid_draft_v1'), null, 'المفتاح المشترك القديم يجب أن يُمسح صامتًا');
    assert.ok(app.localStorage.getItem(app.draftKey()), 'مسودة المستخدم الحالي بمفتاحها الجديد يجب ألا تتأثر');
  });
});
