'use strict';
/* اختبار انحدار لسباق في saveStudentActivityFlag (app-03-auth-home-risk.js):
   الدالة تلتقط currentUser.id، تنتظر RPC، ثم تكتب hasStudentActivity عالميًا.
   لو سجّل المستخدم خروجًا ودخل مستخدم آخر أثناء انتظار الشبكة (نافذة واقعية:
   طلب بطيء، أو تبديل حساب سريع)، كانت النسخة القديمة (بلا الحارس) تكتب نتيجة
   تفعيل/إلغاء المستخدم *السابق* فوق حالة المستخدم *الجديد* — بالضبط نمط
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

describe('saveStudentActivityFlag: سباق تبديل المستخدم أثناء انتظار الحفظ', () => {
  test('لا يكتب hasStudentActivity لو تبدّل currentUser قبل اكتمال طلب RPC', async () => {
    const app = loadApp({ currentUser: { id: 'u1' } });
    installLiveDom(app);
    app.showToast = () => {};
    runInAppContext(app, 'hasStudentActivity = false;');

    /* لا ننتظر الحفظ فورًا — نبدأه لـ u1 (طلب تفعيل=true)، ثم نحاكي تبديل
       المستخدم لـ u2 قبل أن يصل رد RPC (بعد أول await بالدالة مباشرة) */
    const savePromise = app.saveStudentActivityFlag(true);
    runInAppContext(app, "currentUser = { id: 'u2' };");
    await savePromise;

    assert.equal(runInAppContext(app, 'hasStudentActivity'), false,
      'يجب ألا تُطبَّق نتيجة حفظ u1 (true) على حالة المستخدم الحالي u2');
  });

  test('يطبّق النتيجة بشكل طبيعي لو لم يتغيّر المستخدم أثناء الانتظار', async () => {
    const app = loadApp({ currentUser: { id: 'u1' } });
    installLiveDom(app);
    app.showToast = () => {};
    runInAppContext(app, 'hasStudentActivity = false;');

    await app.saveStudentActivityFlag(true);

    assert.equal(runInAppContext(app, 'hasStudentActivity'), true);
  });
});
