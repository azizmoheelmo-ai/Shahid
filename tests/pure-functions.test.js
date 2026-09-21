'use strict';
/* اختبارات وحدة على الدوال الصرفة (أو شبه الصرفة) من التطبيق الفعلي —
   تشغّل عبر: node --test tests/
   راجع tests/load-app.js لتفاصيل آلية التحميل. */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => {
  app = loadApp();
});

describe('escapeHtml', () => {
  test('يهرّب < > & لمنع كسر HTML', () => {
    assert.equal(app.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  test('يهرّب علامتي الاقتباس (ضرورية لاستخدامها داخل خصائص HTML)', () => {
    assert.equal(app.escapeHtml(`x" onerror="y" and 'z'`), 'x&quot; onerror=&quot;y&quot; and &#39;z&#39;');
  });
  test('null/undefined تُعامَل كنص فارغ بدل رمي خطأ', () => {
    assert.equal(app.escapeHtml(null), '');
    assert.equal(app.escapeHtml(undefined), '');
  });
  test('نص عربي عادي بلا رموز خاصة يمر بلا تغيير', () => {
    assert.equal(app.escapeHtml('مرحبا بالجميع'), 'مرحبا بالجميع');
  });
});

describe('csvEscape / toCsv', () => {
  test('قيمة بسيطة بلا فواصل أو اقتباس تُترك كما هي', () => {
    assert.equal(app.csvEscape('hello'), 'hello');
  });
  test('قيمة فيها فاصلة تُحاط بعلامتي اقتباس', () => {
    assert.equal(app.csvEscape('a,b'), '"a,b"');
  });
  test('علامة اقتباس داخل القيمة تُضاعَف وتُحاط بالكل بعلامتي اقتباس', () => {
    assert.equal(app.csvEscape('قال "مرحبا"'), '"قال ""مرحبا"""');
  });
  test('null/undefined تصير نصًا فارغًا', () => {
    assert.equal(app.csvEscape(null), '');
    assert.equal(app.csvEscape(undefined), '');
  });
  test('toCsv يبني رأسًا وصفوفًا مطابقة لعدد الأعمدة المجمّعة من كل السجلات', () => {
    const csv = app.toCsv([{ a: 1, b: 'x' }, { a: 2, c: 'y' }]);
    const lines = csv.replace(/^﻿/, '').split('\n');
    assert.equal(lines[0], 'a,b,c');
    assert.equal(lines[1], '1,x,');
    assert.equal(lines[2], '2,,y');
  });
  test('toCsv على مصفوفة فارغة يُرجع نصًا فارغًا', () => {
    assert.equal(app.toCsv([]), '');
    assert.equal(app.toCsv(null), '');
  });
});

describe('passwordStrengthError (شروط الحد الأدنى لكلمة المرور)', () => {
  test('أقصر من 8 أحرف مرفوضة', () => {
    assert.match(app.passwordStrengthError('abc123'), /8 أحرف/);
  });
  test('بدون أي رقم مرفوضة', () => {
    assert.match(app.passwordStrengthError('abcdefgh'), /رقم/);
  });
  test('بدون أي حرف مرفوضة', () => {
    assert.match(app.passwordStrengthError('12345678'), /حرف/); // شائعة أصلاً، لكن تفشل بشرط الحرف أولاً
  });
  test('كلمة مرور شائعة مرفوضة حتى لو استوفت الشروط الشكلية', () => {
    assert.match(app.passwordStrengthError('abcd1234'), /شائعة/);
  });
  test('كلمة مرور سليمة وغير شائعة تُقبل (null = لا خطأ)', () => {
    assert.equal(app.passwordStrengthError('MySecure99'), null);
  });
});

describe('computePasswordStrength (مؤشر بصري فقط)', () => {
  test('كلمة قصيرة وبسيطة = ضعيفة', () => {
    assert.equal(app.computePasswordStrength('abc123').label, 'ضعيفة');
  });
  test('كلمة متوسطة الطول والتنوع = متوسطة أو أعلى', () => {
    const r = app.computePasswordStrength('abcDEF123');
    assert.ok(['متوسطة', 'قوية'].includes(r.label));
  });
  test('كلمة طويلة ومتنوعة (أحرف كبيرة/صغيرة/أرقام/رمز) = قوية', () => {
    assert.equal(app.computePasswordStrength('MySecure!Pass123').label, 'قوية');
  });
  test('النتيجة تتضمن دومًا لون ونسبة مئوية', () => {
    const r = app.computePasswordStrength('x');
    assert.ok(typeof r.color === 'string' && r.color.startsWith('#'));
    assert.ok([33, 66, 100].includes(r.pct));
  });
});

describe('isImageUrl', () => {
  test('امتدادات الصور المعروفة تُعتبر صورًا', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp']) {
      assert.equal(app.isImageUrl(`https://x.test/a.${ext}`), true, ext);
    }
  });
  test('رابط بامتداد استعلام (?) بعد الامتداد يبقى صورة', () => {
    assert.equal(app.isImageUrl('https://x.test/a.png?token=abc'), true);
  });
  test('مستند غير صورة (pdf/docx) ليس صورة', () => {
    assert.equal(app.isImageUrl('https://x.test/a.pdf'), false);
    assert.equal(app.isImageUrl('https://x.test/a.docx'), false);
  });
  test('قيمة فارغة/فارغة تمامًا لا تُعتبر صورة ولا ترمي خطأ', () => {
    assert.equal(app.isImageUrl(''), false);
    assert.equal(app.isImageUrl(undefined), false);
  });
});

describe('splitLabel (فصل اسم عنصر الأداء عن وزنه المئوي)', () => {
  test('يفصل التسمية عن الوزن حين يكون بصيغة "اسم (NN%)"', () => {
    // ملاحظة: نقارن الحقول فرادى بدل deepEqual على الكائن كاملاً، لأن
    // splitLabel يُنفَّذ داخل vm منفصل (realm مختلف) فتُنشأ الكائنات
    // بنموذج أولي (prototype) مختلف عن كائنات ملف الاختبار — deepStrictEqual
    // يرفض هذا رغم تطابق المحتوى فعليًا. راجع tests/load-app.js.
    const r = app.splitLabel('الإدارة الصفية (15%)');
    assert.equal(r.name, 'الإدارة الصفية');
    assert.equal(r.weight, '15%');
  });
  test('بدون وزن مذكور يُرجع الاسم كاملًا بلا وزن', () => {
    const r = app.splitLabel('عنصر بلا وزن');
    assert.equal(r.name, 'عنصر بلا وزن');
    assert.equal(r.weight, '');
  });
});

describe('shortName (تقصير اسم ملف طويل مع الحفاظ على الامتداد)', () => {
  test('اسم أقصر من الحد الأقصى يبقى كما هو', () => {
    assert.equal(app.shortName('short.pdf', 22), 'short.pdf');
  });
  test('اسم طويل يُقصَّر مع الإبقاء على الامتداد', () => {
    const result = app.shortName('a-very-long-file-name-indeed.pdf', 22);
    assert.ok(result.length <= 22);
    assert.ok(result.endsWith('.pdf'));
    assert.ok(result.includes('…'));
  });
  test('بدون اسم يُرجع نص افتراضي بدل الانهيار', () => {
    assert.equal(app.shortName(''), 'ملف');
    assert.equal(app.shortName(null), 'ملف');
  });
});

describe('humanSize', () => {
  test('أقل من 1 كيلوبايت يُعرض بالبايت', () => {
    assert.equal(app.humanSize(500), '500 بايت');
  });
  test('بين 1 كيلوبايت و1 ميغابايت يُعرض بالكيلوبايت', () => {
    assert.equal(app.humanSize(2048), '2 ك.ب');
  });
  test('أكبر من ميغابايت يُعرض بالميغابايت بمنزلة عشرية', () => {
    assert.equal(app.humanSize(1024 * 1024 * 2.5), '2.5 م.ب');
  });
});

describe('daysSince', () => {
  test('تاريخ اليوم نفسه يُعطي رقمًا قريبًا من الصفر', () => {
    const d = app.daysSince(new Date().toISOString());
    assert.ok(d >= -0.01 && d < 0.01);
  });
  test('تاريخ قبل 10 أيام يُعطي رقمًا قريبًا من 10', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const d = app.daysSince(tenDaysAgo);
    assert.ok(d > 9.9 && d < 10.1);
  });
});

describe('debounce', () => {
  test('يستدعي الدالة الأصلية مرة واحدة فقط بعد آخر نداء ضمن المهلة', (t, done) => {
    let calls = 0;
    const debounced = app.debounce(() => { calls++; }, 30);
    debounced(); debounced(); debounced();
    assert.equal(calls, 0, 'لا يُستدعى فورًا');
    setTimeout(() => {
      assert.equal(calls, 1, 'استُدعي مرة واحدة فقط بعد انتهاء المهلة');
      done();
    }, 60);
  });
});

describe('fetchAllRows (تجميع صفحات متتالية)', () => {
  test('يجمع كل الصفحات حتى تأتي صفحة أصغر من حجم الصفحة', async () => {
    const allRows = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const calls = [];
    const factory = async (from, to) => {
      calls.push([from, to]);
      return { data: allRows.slice(from, to + 1), error: null };
    };
    const { data, error } = await app.fetchAllRows(factory, 10);
    assert.equal(error, null);
    assert.equal(data.length, 25);
    assert.deepEqual(data[0], { id: 0 });
    assert.deepEqual(data[24], { id: 24 });
    // 3 صفحات: 0-9, 10-19, 20-29 (آخر صفحة أصغر من 10 فتوقف)
    assert.equal(calls.length, 3);
  });
  test('يتوقف فورًا ويُرجع الخطأ لو فشل أي طلب صفحة', async () => {
    const factory = async () => ({ data: null, error: { message: 'boom' } });
    const { data, error } = await app.fetchAllRows(factory, 10);
    assert.equal(data, null);
    assert.equal(error.message, 'boom');
  });
  test('نتيجة فارغة من أول صفحة تُرجع مصفوفة فارغة بلا أخطاء', async () => {
    const factory = async () => ({ data: [], error: null });
    const { data, error } = await app.fetchAllRows(factory, 10);
    assert.equal(error, null);
    // data مُنشأة داخل fetchAllRows نفسها (realm الـ vm)، فنقارن الطول بدل
    // deepEqual على المصفوفة كاملة لنفس سبب ملاحظة splitLabel أعلاه
    assert.equal(data.length, 0);
  });
});

describe('getAcademicTermInfo (شريط التاريخ بالشاشة الرئيسية)', () => {
  test('أول يوم بالفصل الأول يُرجع الأسبوع 1', () => {
    const info = app.getAcademicTermInfo(new Date('2026-08-23T12:00:00'));
    assert.equal(info.label, 'الفصل الدراسي الأول');
    assert.equal(info.week, 1);
    assert.equal(info.totalWeeks, 19);
  });
  test('آخر يوم بالفصل الأول يبقى محصورًا بالأسبوع 19 ولا يتجاوزه', () => {
    const info = app.getAcademicTermInfo(new Date('2027-01-07T12:00:00'));
    assert.equal(info.label, 'الفصل الدراسي الأول');
    assert.equal(info.week, 19);
  });
  test('فترة إجازة منتصف العام (بين الفصلين) تُرجع null بدل رقم أسبوع خاطئ', () => {
    assert.equal(app.getAcademicTermInfo(new Date('2027-01-10T12:00:00')), null);
  });
  test('أول يوم بالفصل الثاني يُرجع الأسبوع 1 من فصل جديد', () => {
    const info = app.getAcademicTermInfo(new Date('2027-01-17T12:00:00'));
    assert.equal(info.label, 'الفصل الدراسي الثاني');
    assert.equal(info.week, 1);
  });
  test('الإجازة الصيفية (بعد نهاية الفصل الثاني) تُرجع null', () => {
    assert.equal(app.getAcademicTermInfo(new Date('2027-07-01T12:00:00')), null);
  });
});
