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

const IDS = ['classroomNavTab', 'academicNavTab', 'classroomHomeBtn', 'academicHomeBtn', 'myProgramsBtn'];

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
