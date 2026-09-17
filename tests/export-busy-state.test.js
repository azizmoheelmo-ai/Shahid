'use strict';
/* اختبارات لحالة "جاري تصدير/طباعة" الموحّدة (beginExportBusy/endExportBusy/
   activeExportCount في app-01-core.js) — أُضيفت بعد اكتشاف خلل أثناء
   التطوير: بعض الأزرار (مثل "home-btn" ببطاقات الرئيسية، كزر "ملف الإنجاز")
   لها عناصر <span> فرعية للعنوان والوصف (.hb-title/.hb-sub)، واستبدال
   textContent الزر كاملًا كان يُسطِّح هذا التركيب ولا يُعاد بناؤه صحيحًا
   عند "الاستعادة" — فتُفقد بنية العنوان/الوصف نهائيًا بعد أول عملية تصدير. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

/* عنصر زر وهمي بسيط: يدعم textContent وdataset وdisabled، مع دعم اختياري
   لعنصر ابن (.hb-sub) لمحاكاة تركيب "home-btn" الحقيقي. */
function makeFakeButton(withHbSub){
  const hbSub = withHbSub ? { textContent: 'وصف البطاقة الأصلي', dataset: {} } : null;
  const btn = {
    textContent: withHbSub ? 'عنوانوصف البطاقة الأصلي' : 'زر عادي',
    disabled: false,
    dataset: {},
    querySelector(sel){ return (sel === '.hb-sub' && hbSub) ? hbSub : null; },
  };
  return { btn, hbSub };
}

describe('حالة "جاري تصدير/طباعة" الموحّدة', () => {
  test('beginExportBusy بلا busyText: يعطّل الزر فقط، ولا يمسّ نصّه إطلاقًا', () => {
    const app = loadApp();
    const { btn } = makeFakeButton(false);
    const originalText = btn.textContent;

    app.beginExportBusy(btn);
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, originalText, 'بلا busyText يجب ألا يتغيّر النص إطلاقًا');

    app.endExportBusy(btn);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, originalText);
  });

  test('beginExportBusy/endExportBusy على زر نص مسطّح عادي: يبدّل النص ويستعيده', () => {
    const app = loadApp();
    const { btn } = makeFakeButton(false);
    const originalText = btn.textContent;

    app.beginExportBusy(btn, 'جارٍ التجهيز...');
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, 'جارٍ التجهيز...');

    app.endExportBusy(btn);
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, originalText, 'يجب أن يعود النص الأصلي كما كان بالضبط');
  });

  test('زر "home-btn" له عنصر .hb-sub فرعي: يُحدَّث نص .hb-sub فقط، ولا يُسطَّح تركيب الزر بالكامل', () => {
    const app = loadApp();
    const { btn, hbSub } = makeFakeButton(true);
    const originalButtonText = btn.textContent;
    const originalSubText = hbSub.textContent;

    app.beginExportBusy(btn, 'جارٍ التجهيز (٢/٥)...');
    assert.equal(btn.disabled, true);
    assert.equal(hbSub.textContent, 'جارٍ التجهيز (٢/٥)...', 'وصف البطاقة (.hb-sub) هو اللي يتغيّر');
    assert.equal(btn.textContent, originalButtonText, 'textContent الزر الأصلي (المُجمَّع من العنوان+الوصف) لا يُلمَس مباشرة');

    app.setExportBusyText(btn, 'جارٍ التجهيز (٤/٥)...');
    assert.equal(hbSub.textContent, 'جارٍ التجهيز (٤/٥)...', 'تحديثات التقدّم المتتالية تستمر بتحديث .hb-sub فقط');

    app.endExportBusy(btn);
    assert.equal(btn.disabled, false);
    assert.equal(hbSub.textContent, originalSubText, 'وصف البطاقة يجب أن يعود كما كان بالضبط بعد انتهاء العملية');
  });

  test('endExportBusy لا يرمي استثناءً عند استدعائه بلا زر (btn=null) أو أكثر من مرة مقابل begin واحد', () => {
    /* activeExportCount نفسه (let بأعلى المستوى) لا يظهر كخاصية مباشرة على
       sandbox فلا يُقرأ من هنا مباشرة (نفس قيد currentUser الموثَّق بـ
       load-app.js) — هذا الاختبار يتحقق بدلًا من ذلك أن endExportBusy لا
       ينهار مع btn غير موجود أو نداءات زائدة، وهو السيناريو الفعلي عند
       فشل عملية تصدير قبل أن يُتاح لها زر (أو معالجة أخطاء متكررة). */
    const app = loadApp();
    const { btn } = makeFakeButton(false);

    app.beginExportBusy(btn, 'جارٍ التجهيز...');
    assert.doesNotThrow(() => {
      app.endExportBusy(btn);
      app.endExportBusy(btn);   // نداء زائد لنفس الزر
      app.endExportBusy(null);  // بلا زر إطلاقًا
    });
    assert.equal(btn.disabled, false);
  });
});
