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

describe('مسجَّل الدخول أصلًا ويأتي من رابط التسجيل', () => {
  test('يعرض له شريطًا بحسابه وزر العودة لمُصحّح بدل إنشاء حساب ثانٍ (ولا تحجبه نافذة الترحيب)', async () => {
    const hash = link({ email: 'x@y.co', from: 'musahhih', return: 'https://musahhih-test.vercel.app/' });
    const session = { user: { id: 'u1', email: 'teacher@example.com', user_metadata: {} } };
    const permissive = (path) => new Proxy(function(){}, {
      get: (t, k) => (k === 'then' ? (res, rej) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej) : permissive(path.concat(String(k)))),
      apply: () => {
        const last = path[path.length - 1];
        if(last === 'getSession') return Promise.resolve({ data: { session }, error: null });
        if(last === 'onAuthStateChange') return { data: { subscription: { unsubscribe() {} } } };
        return permissive(path.concat('()'));
      }
    });
    const a = loadApp({ supabaseClient: permissive([]), location: { hash, pathname: '/index.html', search: '' } });
    a.checkExistingSession();
    await new Promise((r) => setTimeout(r, 50));
    const bar = a.document.getElementById('signupReturnBar'), msg = a.document.getElementById('signupReturnMsg').textContent, lk = a.document.getElementById('signupReturnLink').href;
    assert.equal(bar.style.display, 'flex');
    assert.match(msg, /لديك حساب في شواهد بالفعل/);
    assert.match(msg, /teacher@example\.com/);
    assert.equal(lk, 'https://musahhih-test.vercel.app/#login&email=teacher%40example.com');
  });
});

describe('بعد إنشاء الحساب', () => {
  test('شريط العودة يظهر برابط مُصحّح والبريد، ولا يظهر بلا رابط عودة صالح', () => {
    const ok = loadApp({ location: { hash: link({ email: 'a@b.co', from: 'musahhih', return: 'https://musahhih-test.vercel.app/x?y=1' }), pathname: '/index.html', search: '' } });
    ok.applySignupLink();
    ok.showSignupReturnBar('new', 'n@e.co');
    assert.equal(ok.document.getElementById('signupReturnBar').style.display, 'flex');
    assert.match(ok.document.getElementById('signupReturnMsg').textContent, /تم إنشاء حسابك/);
    assert.equal(ok.document.getElementById('signupReturnLink').href, 'https://musahhih-test.vercel.app/x#login&email=n%40e.co');
    const no = loadApp({ location: { hash: link({ email: 'a@b.co', from: 'musahhih', return: 'https://evil.example/' }), pathname: '/index.html', search: '' } });
    no.applySignupLink();
    no.showSignupReturnBar('new', 'n@e.co');
    assert.notEqual(no.document.getElementById('signupReturnBar').style.display, 'flex');
  });
});
