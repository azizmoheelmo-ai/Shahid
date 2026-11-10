'use strict';
/* النسخة الاحتياطية الشخصية (exportBackup، app-08): كل جدول بيانات المعلم يدخلها، بتصفية صريحة بالمالك (م1)،
   ويُكتب بمفتاحه في «بيانات-كاملة.json». سبب الاختبار: أربعة جداول كانت غائبة (ضياع صامت عند الاستعادة). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-08-admin.js'), 'utf8');
const i = src.indexOf('const uid = currentUser.id;\n    const [shRes');
const body = src.slice(i, i + 60000);

const OWNER = {
  plan_header: 'user_id', classroom_lesson_skips: 'teacher_id', classroom_letter_counters: 'teacher_id', classroom_attention_dismissals: 'teacher_id',
  survey_campaigns: 'teacher_id', survey_responses: 'teacher_id', classroom_students: 'teacher_id', shawahid: 'user_id'
};

Object.keys(OWNER).forEach(t => {
  test(`النسخة الشخصية تشمل ${t} بتصفية ${OWNER[t]}`, () => {
    const q = new RegExp(`sb\\.from\\('${t}'\\)\\.select\\('\\*'\\)\\.eq\\('${OWNER[t]}', uid\\)`);
    assert.match(body, q, 'استعلام مصفّى بالمالك');
    assert.match(body, new RegExp(`\\b${t}[:,]\\s`), 'مفتاح بملف JSON');
  });
});

/* ============ فشل جلب جدول يوقف النسخة بدل أن يُكتب فارغًا ============ */
const { loadApp, runInAppContext } = require('./load-app');

async function runBackup(failTable){
  const calls = [];
  const sb = {
    from(table){
      const api = {};
      ['select', 'eq', 'order', 'range', 'limit', 'neq', 'in', 'gte', 'lte', 'is'].forEach(m => { api[m] = () => api; });
      api.then = (res, rej) => Promise.resolve(table === failTable ? { data: null, error: { message: 'network' } } : { data: [], error: null }).then(res, rej);
      calls.push(table);
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1', email: 'a@b.c', user_metadata: {} } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    beginExportBusy = () => {}; endExportBusy = () => {};
    ensureZipLib = async () => {}; ensureXlsxLib = async () => {};
    window.__zipTouched = false; JSZip = function(){ window.__zipTouched = true; };`);
  await runInAppContext(app, `exportBackup(null)`);
  return { toasts: runInAppContext(app, `window.__toasts.slice()`), zip: runInAppContext(app, `window.__zipTouched`) };
}

test('فشل جلب أي جدول يوقف النسخة برسالة واضحة ولا ينتج ملفًا ناقصًا', async () => {
  const r = await runBackup('classroom_lesson_skips');
  assert.ok(r.toasts.some(t => /^error:تعذّر التصدير: تعذّر جلب بعض بياناتك/.test(t) && /أُوقفت النسخة/.test(t)), r.toasts.join(' | '));
  assert.equal(r.zip, false, 'لا ملف zip');
});

test('بلا فشل: لا يُوقف الحارس النسخة (تمضي لبناء الملف)', async () => {
  const r = await runBackup(null);
  assert.ok(!r.toasts.some(t => /أُوقفت النسخة/.test(t)), r.toasts.join(' | '));
});
