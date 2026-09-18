'use strict';
/* اختبار انحدار لسباق في saveDutyType (app-03-auth-home-risk.js):
   الدالة تلتقط currentUser.id، تنتظر RPC، ثم تكتب dutyType عالميًا.
   لو سجّل المستخدم خروجًا ودخل مستخدم آخر أثناء انتظار الشبكة (نافذة واقعية:
   طلب بطيء، أو تبديل حساب سريع)، كانت النسخة القديمة (بلا الحارس) تكتب نتيجة
   تعديل تكليف المستخدم *السابق* فوق حالة المستخدم *الجديد* — بالضبط نمط
   الخلل الموصوف بـ CLAUDE.md (بند 4: حالات السباق). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runInAppContext } = require('./load-app.js');

function makeLiveElement(){
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, checked: false,
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, appendChild(){}, querySelector: () => makeLiveElement(),
    querySelectorAll: () => [], setAttribute(){}, getAttribute: () => null };
}
function installLiveDom(app){
  const registry = {};
  app.document.getElementById = (id) => (registry[id] = registry[id] || makeLiveElement());
}

describe('saveDutyType: سباق تبديل المستخدم أثناء انتظار الحفظ', () => {
  test('لا يكتب dutyType لو تبدّل currentUser قبل اكتمال طلب RPC', async () => {
    const app = loadApp({ currentUser: { id: 'u1' } });
    installLiveDom(app);
    app.showToast = () => {};
    runInAppContext(app, "dutyType = 'none';");

    /* لا ننتظر الحفظ فورًا — نبدأه لـ u1 (طلب تكليف='student_activity')، ثم
       نحاكي تبديل المستخدم لـ u2 قبل أن يصل رد RPC (بعد أول await بالدالة مباشرة) */
    const savePromise = app.saveDutyType('student_activity');
    runInAppContext(app, "currentUser = { id: 'u2' };");
    await savePromise;

    assert.equal(runInAppContext(app, 'dutyType'), 'none',
      'يجب ألا تُطبَّق نتيجة حفظ u1 (student_activity) على حالة المستخدم الحالي u2');
  });

  test('يطبّق النتيجة بشكل طبيعي لو لم يتغيّر المستخدم أثناء الانتظار', async () => {
    const app = loadApp({ currentUser: { id: 'u1' } });
    installLiveDom(app);
    app.showToast = () => {};
    runInAppContext(app, "dutyType = 'none';");

    await app.saveDutyType('health_guidance');

    assert.equal(runInAppContext(app, 'dutyType'), 'health_guidance');
  });
});
