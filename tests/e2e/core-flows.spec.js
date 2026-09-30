'use strict';
/* ============================================================
   اختبارات Playwright لأهم 3 مسارات بالتطبيق: تسجيل الدخول، إضافة شاهد
   جديد، وتحميل الشاشة الرئيسية بلا أخطاء — اليوم 3 من خطة الأسبوع.

   تعمل حصرًا ضد بيئة staging (حساب معلم تجريبي مُدرَج مسبقًا بقاعدة
   Supabase نفسها، schema منفصلة تمامًا — راجع buildSchemaSql بـ
   app-07-backup-export.js وتعليق PRODUCTION_HOSTNAMES بـapp-01-core.js).
   hostname الخادم المحلي هنا (127.0.0.1) ليس ضمن نطاقات الإنتاج، فيختار
   التطبيق staging تلقائيًا — لا حاجة لأي إعداد إضافي بهذا الملف.

   ملاحظة لو احتجت إعادة إنشاء حساب staging هذا مستقبلًا (حُذف بالخطأ مثلًا):
   إدراج صف بـauth.users مباشرة عبر SQL (بدل التسجيل من واجهة التطبيق) يترك
   confirmation_token/recovery_token/email_change_token_new/email_change
   بقيمة NULL افتراضيًا — GoTrue يفشل حينها بخطأ 500 غامض ("error finding
   user: ... converting NULL to string is unsupported") عند أي محاولة دخول،
   رغم أن كلمة المرور صحيحة تمامًا. الحل: عيّنها فارغة '' صراحة عند الإدراج،
   لا تتركها NULL (اكتُشف هذا فعليًا أول تشغيل لهذه الاختبارات بـCI). */
const { test, expect } = require('@playwright/test');

const TEST_EMAIL = 'staging-test@shahid.test';
const TEST_PASSWORD = 'ShahidStaging#2026';

/* تسجيل الدخول بحساب staging التجريبي — مشترك بين الاختبارات الثلاثة */
async function login(page){
  /* تعطيل الجولة التعريفية (تظهر مرة واحدة فقط لأي معلم جديد — راجع
     ONBOARDING_KEY بـapp-03-auth-home-risk.js) قبل أي تنقّل: بدونه تظهر
     نافذة "مرحبًا بك في شاهد" كحوار مُعلَّق فوق الصفحة عند أول دخول بكل
     سياق متصفح جديد (كل اختبار Playwright يبدأ بسياق فارغ)، فتحجب أي عنصر
     تحته (مثل #elementSelect) — لا علاقة لهذا بسلوك المستخدم الحقيقي
     المُختبَر هنا، فنتخطاه بدل التعامل مع نافذة الجولة بكل اختبار. */
  await page.addInitScript(() => localStorage.setItem('shahid_onboarded_v1', '1'));
  await page.goto('/');
  await page.fill('#authEmail', TEST_EMAIL);
  await page.fill('#authPassword', TEST_PASSWORD);
  await page.click('#authSubmitBtn');
  await expect(page.locator('#appView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#authView')).toBeHidden();
}

test.describe('المسارات الأساسية (بيئة staging)', () => {
  test('تسجيل الدخول', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await login(page);
    await expect(page.locator('#homeView')).toBeVisible();

    expect(pageErrors, `أخطاء JS غير متوقعة أثناء الدخول: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('الشاشة الرئيسية تُحمَّل وتُعرض بلا أخطاء', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await login(page);

    await expect(page.locator('#homeView h1')).toHaveText('لوحة المعلم');
    await expect(page.locator('#cycleCard')).toBeVisible();
    await expect(page.locator('.home-btn.primary')).toBeVisible();
    await expect(page.locator('#planHomeBtn')).toBeVisible();

    expect(pageErrors, `أخطاء JS غير متوقعة بالشاشة الرئيسية: ${pageErrors.join('; ')}`).toEqual([]);
  });

  test('إضافة شاهد جديد', async ({ page }) => {
    await login(page);

    /* شواهدي (الزر الرئيسي الأول بالشاشة الرئيسية) */
    await page.click('.home-btn.primary');
    await expect(page.locator('#listView')).toBeVisible();

    /* + شاهد جديد */
    await page.click('button:has-text("+ شاهد جديد")');
    await expect(page.locator('#formView')).toBeVisible();

    /* عنصر الأداء مطلوب — انتظار تعبئة القائمة (تحميل غير متزامن بعد الدخول)
       قبل الاختيار، بدل افتراض أنها جاهزة فورًا. */
    await expect
      .poll(() => page.locator('#elementSelect option').count(), { timeout: 10000 })
      .toBeGreaterThan(1);

    // تشخيص مؤقت: لماذا #elementSelect "غير مرئي" رغم أن #formView مرئي —
    // يُطبَع مباشرة بسجلّ خطوة CI نفسها (لا يعتمد على تنزيل تقرير Playwright).
    const diag = await page.evaluate(() => {
      const el = document.getElementById('elementSelect');
      const form = document.getElementById('formView');
      const rect = el ? el.getBoundingClientRect() : null;
      const cs = el ? getComputedStyle(el) : null;
      return {
        formDisplay: form ? getComputedStyle(form).display : 'MISSING',
        elExists: !!el,
        elRect: rect ? { w: rect.width, h: rect.height, top: rect.top, left: rect.left } : null,
        elDisplay: cs ? cs.display : null,
        elVisibility: cs ? cs.visibility : null,
        elOpacity: cs ? cs.opacity : null,
        parentChain: (() => {
          const chain = [];
          let n = el && el.parentElement;
          while (n) { chain.push({ tag: n.tagName, id: n.id, display: getComputedStyle(n).display }); n = n.parentElement; }
          return chain;
        })()
      };
    });
    console.log('DIAG elementSelect:', JSON.stringify(diag));

    await page.selectOption('#elementSelect', { index: 1 });

    const marker = `اختبار Playwright ${Date.now()}`;
    await page.fill('#mLesson', marker);

    await page.click('#saveBtn');

    await expect(page.locator('#saveMsg')).toContainText('تم حفظ الشاهد بنجاح', { timeout: 15000 });
    /* التطبيق ينتقل تلقائيًا لشاشة القائمة بعد نجاح الحفظ (بعد ~900ms) */
    await expect(page.locator('#listView')).toBeVisible({ timeout: 15000 });
  });
});
