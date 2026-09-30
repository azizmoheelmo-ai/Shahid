'use strict';
/* ============================================================
   اختبار اختيار schema (public/staging) حسب hostname — app-01-core.js
   ------------------------------------------------------------
   الخلفية: أضفنا بيئة "staging" (نفس مشروع Supabase، schema منفصلة) لتشغيل
   اختبارات المتصفح الآلية بلا لمس بيانات الإنتاج الحقيقية. القرار "هل نحن
   بالإنتاج؟" يُبنى على قائمة سماح (allow-list) صريحة لنطاقات الإنتاج
   المعروفة فقط — أي نطاق آخر (localhost، معاينة Vercel عشوائية، دومين لم
   يُدرَج بعد) يقع افتراضيًا على staging، عمدًا: الخطأ الآمن هنا هو الكتابة
   بالخطأ على staging، لا الكتابة بالخطأ على قاعدة إنتاج فيها معلمون وطلاب
   حقيقيون. هذا الاختبار يمنع أي تراجع مستقبلي يقلب هذا الافتراض. ============ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('اختيار schema حسب hostname', async (t) => {
  await t.test('نطاق إنتاج معروف (shahid-classroom.vercel.app) → public (بلا خيار schema)', () => {
    const app = loadApp({ location: { hostname: 'shahid-classroom.vercel.app' } });
    const [, , options] = app.__lastCreateClientArgs;
    assert.equal(options, undefined);
  });

  await t.test('نطاق إنتاج آخر مُدرَج (git-main alias) → public أيضًا', () => {
    const app = loadApp({ location: { hostname: 'shahid-classroom-git-main-shahid-3eaf.vercel.app' } });
    const [, , options] = app.__lastCreateClientArgs;
    assert.equal(options, undefined);
  });

  // ملاحظة: options كائن مُنشَأ داخل vm context (realm مختلف عن هذا الملف)،
  // فـdeepStrictEqual يفشل رغم التطابق البنيوي (يقارن الـprototype أيضًا) —
  // لذا نتحقق من قيمة الحقل المطلوب تحديدًا بدل مقارنة الكائن كاملًا.
  await t.test('hostname غير معروف تمامًا (معاينة PR عشوائية) → staging افتراضيًا (fail-safe)', () => {
    const app = loadApp({ location: { hostname: 'shahid-classroom-git-some-pr-branch-shahid-3eaf.vercel.app' } });
    const [, , options] = app.__lastCreateClientArgs;
    assert.equal(options.db.schema, 'staging');
  });

  await t.test('localhost (تطوير محلي) → staging افتراضيًا', () => {
    const app = loadApp({ location: { hostname: 'localhost' } });
    const [, , options] = app.__lastCreateClientArgs;
    assert.equal(options.db.schema, 'staging');
  });

  await t.test('لا hostname إطلاقًا (بيئة الاختبار الافتراضية بلا تحديد) → staging افتراضيًا', () => {
    const app = loadApp();
    const [, , options] = app.__lastCreateClientArgs;
    assert.equal(options.db.schema, 'staging');
  });

  await t.test('URL وpublishable key يبقيان كما هما بصرف النظر عن schema', () => {
    const app = loadApp({ location: { hostname: 'shahid-classroom.vercel.app' } });
    const [url, key] = app.__lastCreateClientArgs;
    assert.equal(url, 'https://urpsznuywezkqxhnwkyo.supabase.co');
    assert.match(key, /^sb_publishable_/);
  });
});
