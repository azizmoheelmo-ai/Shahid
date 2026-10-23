'use strict';
/* اختبار انحدار: معلم دخل عبر Google (بلا كلمة مرور) كان يُطلب منه «كلمة المرور
   الحالية» فيفشل دائمًا. الآن حساب Google فقط يُعيّن كلمة مرور دون التحقق من
   حالية، وحساب البريد يبقى بسلوكه القديم (يتحقق من الحالية أولًا). */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makeFakeSupabaseClient, runInAppContext } = require('./load-app.js');

const googleUser = { id: 'u1', email: 'a@b.co', identities: [{ provider: 'google' }] };
const emailUser = { id: 'u2', email: 'c@d.co', identities: [{ provider: 'email' }, { provider: 'google' }] };

function setup(user){
  const calls = [];
  const client = makeFakeSupabaseClient();
  client.auth.signInWithPassword = async (a) => { calls.push(['signIn', a]); return { data: null, error: { message: 'bad' } }; };
  client.auth.updateUser = async (a) => { calls.push(['update', a]); return { data: { user: { ...user, identities: [{ provider: 'email' }] } }, error: null }; };
  const app = loadApp({ supabaseClient: client, currentUser: user });
  const val = { peCurrentPassword: '', peNewPassword: 'Abcdef1!x', peNewPassword2: 'Abcdef1!x' };
  const orig = app.document.getElementById;
  app.document.getElementById = (id) => { const el = orig(id); if(id in val) el.value = val[id]; return el; };
  return { app, calls, val, orig };
}

describe('userHasPasswordLogin', () => {
  test('Google فقط = لا كلمة مرور؛ مع هوية email = نعم', () => {
    const { app } = setup(googleUser);
    assert.equal(app.userHasPasswordLogin(googleUser), false);
    assert.equal(app.userHasPasswordLogin(emailUser), true);
    assert.equal(app.userHasPasswordLogin({ app_metadata: { providers: ['google'] } }), false);
    assert.equal(app.userHasPasswordLogin({}), true);
    assert.equal(app.userHasPasswordLogin(null), true);
  });
});

describe('changePassword', () => {
  test('حساب Google فقط: يعيّن كلمة المرور بلا التحقق من حالية', async () => {
    const { app, calls } = setup(googleUser);
    await app.changePassword();
    assert.deepEqual(calls.map(c => c[0]), ['update']);
    assert.equal(runInAppContext(app, 'userHasPasswordLogin(currentUser)'), true);
  });
  test('حساب بكلمة مرور: يرفض بلا الحالية، ويتحقق منها قبل التحديث', async () => {
    const { app, calls, val } = setup(emailUser);
    await app.changePassword();
    assert.equal(calls.length, 0);
    val.peCurrentPassword = 'old-pass';
    await app.changePassword();
    assert.deepEqual(calls.map(c => c[0]), ['signIn']);
  });
});
