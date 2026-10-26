'use strict';
/* اختبار انحدار: صور الشواهد خاصة. الروابط المحفوظة بالقاعدة تبقى كما هي، ويُبدَّل الرابط عند العرض فقط برابط موقّع.
   أخطر ما يُمنع هنا: كتابة رابط مؤقت (ينتهي بعد ساعة) في قاعدة البيانات، أو جلب صورة بـfetch مباشر بلا توقيع. */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./load-app.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const HOST = 'https://urpsznuywezkqxhnwkyo.supabase.co';
const PUB = HOST + '/storage/v1/object/public/shawahid-photos/';

function fakeClient(log, opts = {}){
  const base = { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) } };
  base.storage = { from(bucket){ return {
    createSignedUrl: async (p, secs) => { log.push(['one', bucket, p, secs]); return opts.fail ? { data: null, error: { message: 'x' } } : { data: { signedUrl: HOST + '/storage/v1/object/sign/' + bucket + '/' + p + '?token=T' }, error: null }; },
    createSignedUrls: async (ps, secs) => { log.push(['many', bucket, ps.slice(), secs]); return { data: ps.map(p => ({ path: p, signedUrl: HOST + '/storage/v1/object/sign/' + bucket + '/' + p + '?token=T' })), error: null }; }
  }; } };
  return base;
}

describe('photoPathOf', () => {
  const app = loadApp();
  test('رابط عام لحاويتنا → المسار', () => {
    assert.equal(app.photoPathOf(PUB + 'u1/shahid/a_1.jpg'), 'u1/shahid/a_1.jpg');
  });
  test('المسار المرمَّز يُفك، واللاحقة ?... تُهمل', () => {
    assert.equal(app.photoPathOf(PUB + 'u1/%D8%B4/a.jpg?x=1'), 'u1/ش/a.jpg');
  });
  test('رابط موقّع أو من موقع آخر أو بمسار خطِر → null (لا نوقّع ما ليس لنا)', () => {
    assert.equal(app.photoPathOf(HOST + '/storage/v1/object/sign/shawahid-photos/u1/a.jpg?token=T'), null);
    assert.equal(app.photoPathOf('https://evil.example/storage/v1/object/public/shawahid-photos/u1/a.jpg'), null);
    assert.equal(app.photoPathOf(PUB + '../other/a.jpg'), null);
    assert.equal(app.photoPathOf(PUB), null);
    assert.equal(app.photoPathOf(null), null);
    assert.equal(app.photoPathOf('data:image/jpeg;base64,AAAA'), null);
  });
});

describe('signPhotoUrl', () => {
  test('يوقّع لمدة ساعة، ويخزّن النتيجة فلا يعيد الطلب', async () => {
    const log = []; const app = loadApp({ supabaseClient: fakeClient(log) });
    const a = await app.signPhotoUrl(PUB + 'u1/a.jpg');
    const b = await app.signPhotoUrl(PUB + 'u1/a.jpg');
    assert.match(a, /\/object\/sign\/shawahid-photos\/u1\/a\.jpg\?token=T$/);
    assert.equal(a, b);
    assert.equal(log.length, 1);
    assert.equal(log[0][3], 3600);
  });
  test('طلبان متزامنان لنفس الصورة = توقيع واحد', async () => {
    const log = []; const app = loadApp({ supabaseClient: fakeClient(log) });
    await Promise.all([app.signPhotoUrl(PUB + 'u1/b.jpg'), app.signPhotoUrl(PUB + 'u1/b.jpg')]);
    assert.equal(log.length, 1);
  });
  test('فشل التوقيع → يبقى الرابط الأصلي (لا يتعطل شيء أثناء الانتقال)', async () => {
    const log = []; const app = loadApp({ supabaseClient: fakeClient(log, { fail: true }) });
    assert.equal(await app.signPhotoUrl(PUB + 'u1/c.jpg'), PUB + 'u1/c.jpg');
  });
  test('رابط ليس لحاويتنا يعود كما هو بلا أي طلب', async () => {
    const log = []; const app = loadApp({ supabaseClient: fakeClient(log) });
    assert.equal(await app.signPhotoUrl('https://x.example/a.jpg'), 'https://x.example/a.jpg');
    assert.equal(log.length, 0);
  });
});

describe('الكود: لا كتابة لرابط مؤقت ولا جلب مباشر', () => {
  test('وحدة الصور الخاصة لا تكتب بالقاعدة أبدًا', () => {
    const src = read('app/app-32-private-photos.js');
    assert.ok(!/\bsb\s*\.\s*from\(/.test(src), 'الوحدة يجب ألا تستعلم جداول القاعدة (التخزين فقط: sb.storage)');
    assert.ok(!/\.(insert|update|upsert)\(/.test(src), 'الوحدة يجب ألا تكتب بالقاعدة');
  });
  test('مواضع جلب الصور (نسخ احتياطي، مشرف، PDF) تمرّ بـphotoFetch', () => {
    assert.match(read('app/app-07-backup-export.js'), /photoFetch\(p\.url\)/);
    assert.match(read('app/app-08-admin.js'), /photoFetch\(p\.url\)/);
    assert.match(read('app/app-09-shahid-form.js'), /async function toDataUrl[\s\S]*?photoFetch\(url\)/);
    for(const f of ['app/app-07-backup-export.js', 'app/app-08-admin.js', 'app/app-09-shahid-form.js'])
      assert.ok(!/await fetch\((p\.url|url)\)/.test(read(f)), f + ': fetch مباشر لصورة');
  });
  test('كل طباعة مباشرة من printArea تنتظر توقيع الصور قبل window.print', () => {
    for(const f of ['app/app-08-admin.js', 'app/app-09-shahid-form.js']){
      const src = read(f);
      const calls = [...src.matchAll(/getElementById\('printArea'\)\.innerHTML = buildPdfHtml\([^;]*;\s*([^\n]*)/g)];
      assert.ok(calls.length >= 1, f);
      for(const m of calls) assert.match(m[1], /settlePhotosIn\(/, f + ': طباعة قبل توقيع الصور');
    }
  });
  test('لا تُحفظ روابط img.src بالقاعدة: مصدر الحفظ هو dataset.existingUrl (الأصل)', () => {
    const src = read('app/app-09-shahid-form.js');
    assert.match(src, /existingUrl/);
    const save = src.slice(src.indexOf('const photoUrls = existingUrls.concat(newUrls)'));
    assert.ok(save.length > 0);
  });
});

describe('SQL: الحاوية خاصة والمشرف يقرأ', () => {
  test('كل مصادر إنشاء الحاوية تجعلها public=false', () => {
    const a = read('sql-updates-run-in-supabase.sql'), b = read('app/app-07-backup-export.js');
    assert.ok(/'shawahid-photos', 'shawahid-photos', false,/.test(a));
    assert.ok(/'shawahid-photos', 'shawahid-photos', false,/.test(b));
    assert.ok(/values \('shawahid-photos','shawahid-photos', false\)/.test(b));
    assert.ok(!/'shawahid-photos',\s*'shawahid-photos',\s*true/.test(a + b));
  });
  test('سياسة القراءة: المالك أو المشرف، ولا قراءة عامة', () => {
    for(const f of ['sql-updates-run-in-supabase.sql', 'app/app-07-backup-export.js', 'sql-private-photos-APPLY.sql']){
      const s = read(f);
      const sel = [...s.matchAll(/for select\s+using \(([\s\S]*?)\);/g)].map(m => m[1]).filter(q => /shawahid-photos/.test(q));
      assert.ok(sel.length > 0, f);
      for(const q of sel){ assert.match(q, /auth\.uid\(\)\)::text = \(storage\.foldername\(name\)\)\[1\]/, f); assert.match(q, /public\.is_admin\(/, f); }
    }
  });
  test('ملف التطبيق يقلب الحاوية وملف الرجوع يعيدها عامة', () => {
    assert.match(read('sql-private-photos-APPLY.sql'), /update storage\.buckets set public = false where id = 'shawahid-photos'/);
    assert.match(read('sql-private-photos-ROLLBACK.sql'), /update storage\.buckets set public = true where id = 'shawahid-photos'/);
  });
});
