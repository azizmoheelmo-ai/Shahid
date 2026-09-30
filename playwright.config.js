'use strict';
/* ============================================================
   إعداد Playwright — اختبارات متصفح آلية لأهم 3 مسارات بالتطبيق
   (دخول، إضافة شاهد، الشاشة الرئيسية). تُشغَّل ضد خادم ملفات محلي
   (scripts/static-server.js) يخدم نفس الملفات المنشورة فعليًا بلا أي بناء
   (build) — وبما أن hostname هنا ليس أحد نطاقات الإنتاج المعروفة
   (PRODUCTION_HOSTNAMES بـapp/app-01-core.js)، التطبيق نفسه يختار schema
   "staging" تلقائيًا — فلا تلمس هذه الاختبارات أي بيانات إنتاج حقيقية إطلاقًا.
   ============================================================ */
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4173;

/* بعض بيئات التطوير/الحاويات تُثبِّت Chromium مسبقًا بمسار ثابت
   (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) لا يطابق بالضرورة رقم إصدار
   Playwright npm المُثبَّت بـpackage.json — نستخدمه مباشرة لو وُجد فعليًا
   بدل فرض تحميل نسخة مطابقة، فيوفّر وقتًا وشبكة. لو لم يوجد (الحال المعتاد
   بـCI على GitHub Actions بعد npx playwright install)، نترك Playwright
   يحل المسار الافتراضي بنفسه. */
const PRE_INSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const useLocalChromium = fs.existsSync(PRE_INSTALLED_CHROMIUM);

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `node scripts/static-server.js`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
    timeout: 15000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: useLocalChromium ? { executablePath: PRE_INSTALLED_CHROMIUM } : {}
      }
    }
  ]
});
