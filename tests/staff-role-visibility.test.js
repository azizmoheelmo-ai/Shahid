'use strict';
/* اختبار انحدار لـ applyStaffRoleVisibility (app-03-auth-home-risk.js) —
   وكيل/مدير المدرسة (STANDALONE_ROLES) دور مختلف كليًا عن المعلم (لا فصل ولا
   طلاب خاصين به)، فيجب إخفاء تبويبات/أزرار "إدارة الصف" و"المتابعة الأكاديمية"
   و"برامجي" عنهما، وإظهارها بشكل طبيعي لأي معلم (بأي نوع تكليف إضافي أو بدونه). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runInAppContext } = require('./load-app.js');

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

const IDS = ['classroomNavTab', 'academicNavTab', 'classroomHomeBtn', 'academicHomeBtn', 'workSubnavProgramsBtnTasks', 'workSubnavProgramsBtnPrograms'];

describe('applyStaffRoleVisibility', () => {
  ['vice_principal', 'school_principal', 'student_counselor', 'lab_technician'].forEach(role => {
    test(`دور مستقل (${role}): يُخفي ميزات إدارة الصف/المتابعة الأكاديمية/برامجي`, () => {
      const app = loadApp();
      installLiveDom(app);
      runInAppContext(app, `dutyType = '${role}';`);

      app.applyStaffRoleVisibility();

      IDS.forEach(id => {
        assert.equal(app.document.getElementById(id).style.display, 'none', `${id} يجب أن يكون مخفيًا لـ${role}`);
      });
    });
  });

  ['vice_principal', 'school_principal', 'student_counselor', 'lab_technician'].forEach(role => {
    test(`دور مستقل (${role}): تبويب "أعمالي" (workNavTab) يبقى ظاهرًا رغم إخفاء زر "البرامج" — مهامّي ليست خاصة بمن له فصل`, () => {
      /* خلل حقيقي كاد يقع أثناء إعادة تنظيم التنقّل: تبويب "البرامج" القديم
         (id=programsNavTab) كان يُخفى بالكامل لهذه الأدوار لأن البرامج ميزة
         خاصة بمعلم له فصل. لمّا دُمجت مهامّي والبرامج بتبويب سفلي واحد
         ("أعمالي")، إعادة استخدام نفس الـid على التبويب الجديد كانت ستُخفي
         مهامّي أيضًا عن هذه الأدوار بلا أي مبرر (المهام الشخصية لا تتطلب
         فصلًا). الإصلاح: تبويب "أعمالي" نفسه (workNavTab) لا يظهر إطلاقًا
         بقائمة applyStaffRoleVisibility، وفقط زرّا "البرامج" الفرعيّان
         (workSubnavProgramsBtnTasks/Programs) يُخفيان. */
      const app = loadApp();
      installLiveDom(app);
      runInAppContext(app, `dutyType = '${role}';`);

      app.applyStaffRoleVisibility();

      const workTab = app.document.getElementById('workNavTab');
      assert.notEqual(workTab.style.display, 'none', `workNavTab يجب أن يبقى ظاهرًا لـ${role} (مهامّي متاحة للجميع)`);
    });
  });

  test('تبويبات الشريط السفلي تبقى عمودية (أيقونة فوق النص) بعد إعادة إظهارها', () => {
    /* خلل حقيقي اكتُشف بلقطة شاشة للجوال: الدالة تُظهر تبويبَي إدارة الصف/
       المتابعة الأكاديمية بـstyle.display = ''، فيُمسح display:flex المكتوب
       inline بالزر، وتظهر الأيقونة بجانب النص لكل معلم. الضمان الوحيد بعد
       ذلك المسح: قاعدة CSS للصنف نفسه بـdisplay:flex واتجاه عمودي. */
    const fs = require('node:fs');
    const path = require('node:path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    const rule = (css.match(/\.bottom-tab-btn\{([^}]*)\}/) || [])[1] || '';
    assert.match(rule, /display:\s*flex/, 'قاعدة .bottom-tab-btn يجب أن تحدد display:flex');
    assert.match(rule, /flex-direction:\s*column/, 'قاعدة .bottom-tab-btn يجب أن تحدد flex-direction:column');
  });

  test('معلم (بأي نوع تكليف إضافي أو بدونه): تبقى الميزات ظاهرة', () => {
    const app = loadApp();
    installLiveDom(app);

    ['none', 'student_activity', 'health_guidance'].forEach(duty => {
      IDS.forEach(id => { app.document.getElementById(id).style.display = 'none'; }); // نبدأ من حالة مخفية للتأكد أن الدالة تُظهرها فعليًا
      runInAppContext(app, `dutyType = '${duty}';`);
      app.applyStaffRoleVisibility();
      IDS.forEach(id => {
        assert.notEqual(app.document.getElementById(id).style.display, 'none', `${id} يجب أن يظهر لمعلم (${duty})`);
      });
    });
  });
});
