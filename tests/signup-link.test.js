'use strict';
/* اختبار انحدار لرابط التسجيل السريع القادم من تطبيق «مُصحّح»
   (parseSignupLink / buildSignupReturnHref بـ app-03-auth-home-risk.js):
   الرابط يملأ البريد ويفتح تبويب «حساب جديد»، ورابط العودة لا يُقبل إلا إن كان
   نطاقه https من القائمة المسموحة حرفيًا (منعًا للتحويل المفتوح/التصيّد). */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

let app;
before(() => { app = loadApp(); });

const OK = ['https://musahhih-test.vercel.app'];
const enc = encodeURIComponent;
const link = (o) => '#signup&' + Object.entries(o).map(([k, v]) => k + '=' + enc(v)).join('&');

describe('parseSignupLink', () => {
  test('رابط سليم: البريد ورابط العودة (بلا query ولا hash)', () => {
    const r = app.parseSignupLink(link({ email: 'a.b@example.com', from: 'musahhih', return: 'https://musahhih-test.vercel.app/index.html?x=1#y' }), OK);
    assert.equal(r.email, 'a.b@example.com');
    assert.equal(r.returnUrl, 'https://musahhih-test.vercel.app/index.html');
  });
  test('بلا بريد: يُقبل الرابط ويبقى رابط العودة', () => {
    const r = app.parseSignupLink('#signup&from=musahhih&return=' + enc('https://musahhih-test.vercel.app/'), OK);
    assert.equal(r.email, '');
    assert.equal(r.returnUrl, 'https://musahhih-test.vercel.app/');
  });
  test('هاش آخر لا يُعدّ رابط تسجيل', () => {
    assert.equal(app.parseSignupLink('', OK), null);
    assert.equal(app.parseSignupLink('#login&email=a@b.co', OK), null);
    assert.equal(app.parseSignupLink('#signupx', OK), null);
    assert.equal(app.parseSignupLink('#access_token=abc&type=recovery', OK), null);
  });
  test('بريد غير صالح أو خبيث يُهمَل', () => {
    for(const bad of ['x"><img src=x@y.z', '<script>@a.bc', 'no-at-sign', 'a@b', 'a b@c.de', 'a'.repeat(130) + '@b.cd']){
      assert.equal(app.parseSignupLink(link({ email: bad, from: 'musahhih' }), OK).email, '', bad);
    }
  });
  test('رابط العودة: نطاق غير مسموح / http / javascript / data / نطاق مشابه يُرفض', () => {
    for(const ret of ['https://evil.example/', 'http://musahhih-test.vercel.app/', 'javascript:alert(1)', 'data:text/html,x',
                      'https://musahhih-test.vercel.app.evil.example/', 'https://evil.example/https://musahhih-test.vercel.app/', '//evil.example', '/relative', '']){
      assert.equal(app.parseSignupLink(link({ email: 'a@b.co', from: 'musahhih', return: ret }), OK).returnUrl, '', ret);
    }
  });
  test('بلا from=musahhih لا يُقبل رابط العودة (يبقى البريد فقط)', () => {
    const r = app.parseSignupLink(link({ email: 'a@b.co', from: 'other', return: 'https://musahhih-test.vercel.app/' }), OK);
    assert.equal(r.returnUrl, '');
    assert.equal(r.email, 'a@b.co');
  });
});

describe('buildSignupReturnHref', () => {
  test('يضيف #login والبريد مرمَّزًا', () => {
    assert.equal(app.buildSignupReturnHref('https://musahhih-test.vercel.app/', 'a+b@example.com'), 'https://musahhih-test.vercel.app/#login&email=a%2Bb%40example.com');
    assert.equal(app.buildSignupReturnHref('https://musahhih-test.vercel.app/', ''), 'https://musahhih-test.vercel.app/#login');
  });
});

describe('applySignupLink', () => {
  test('يملأ البريد ويفتح تبويب حساب جديد ويمسح الهاش', () => {
    const a = loadApp({ location: { hash: link({ email: 'new@example.com', from: 'musahhih', return: 'https://musahhih-test.vercel.app/' }), pathname: '/index.html', search: '' } });
    const emailEl = a.document.getElementById('authEmail');
    a.applySignupLink();
    assert.equal(emailEl.value, 'new@example.com');
    assert.equal(a.document.getElementById('authSubmitBtn').textContent, 'إنشاء حساب');
  });
  test('بريد خبيث لا يُكتب في الحقل', () => {
    const a = loadApp({ location: { hash: link({ email: '<img src=x onerror=1>@a.bc', from: 'musahhih' }), pathname: '/index.html', search: '' } });
    a.applySignupLink();
    assert.equal(a.document.getElementById('authEmail').value, '');
  });
});
