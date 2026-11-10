'use strict';
/* ============================================================
   إرسال تقرير الطالب برابط مؤقت (app-43):
   - المسار داخل مجلد المعلم، والسجل بمعرّفه، والرابط يُركَّب على الرقم المحفوظ فقط.
   - الإغلاق أثناء التجهيز أو فشل أي خطوة لا يترك ملفًا يتيمًا.
   - التنظيف بتصفية المعلم، ولا يحذف السجل إن فشل حذف الملف.
   - لا نقرتان متزامنتان، ولا إرسال بلا رقم.
   (بناء PDF نفسه يحتاج متصفحًا حقيقيًا: فُحص يدويًا بتقرير فعلي — صفحتان بخط عربي متصل.)
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');

function appWith(opts){
  opts = opts || {};
  const log = [];
  const sb = {
    storage: { from(bucket){ return {
      upload: async (p, blob, o) => { log.push({ op: 'upload', bucket, p, o }); return { error: opts.uploadError || null }; },
      createSignedUrl: async (p, sec) => { log.push({ op: 'sign', p, sec }); return opts.signError ? { error: opts.signError } : { data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/report-shares/' + p + '?token=T&a=1' } }; },
      remove: async (paths) => { log.push({ op: 'remove', paths }); return { error: opts.removeError || null }; }
    }; } },
    from(table){
      const f = []; let op = 'select', values = null;
      const api = { select(){ return api; }, eq(c, v){ f.push(['eq', c, v]); return api; }, lt(c, v){ f.push(['lt', c]); return api; }, in(c, v){ f.push(['in', c, v]); return api; }, limit(){ return api; },
        insert(v){ op = 'insert'; values = v; return api; }, delete(){ op = 'delete'; return api; },
        then(res, rej){ log.push({ table, op, values, f: f.slice() }); const data = op === 'select' ? (opts.expired || []) : null; return Promise.resolve({ data, error: op === 'insert' ? (opts.insertError || null) : null }).then(res, rej); } };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) },
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    crmStudents = [{ id: 'a', full_name: 'أحمد <b>', is_active: true, guardian_phone: '966501234567', student_phone: null }];
    window.__built = []; srBuildReport = async (id, v, to, o) => { window.__built.push({ id, v, to, noDx: o.noDx }); return { html: '<div class="sr"></div>' }; };
    reportSharePdfBlob = async () => ({ size: 1000 });
    const els = { reportShareBody: { dataset: { token: '5' } }, rsGoBtn: {}, reportShareForm: { style: {} }, reportShareResult: { style: {}, dataset: {} }, rsDays: { value: '7' }, rsDx: { checked: true } };
    window.__els = els; document.getElementById = id => els[id] || null;
    document.querySelector = () => ({ value: 'grades' });
    crypto = { randomUUID: () => 'RID', getRandomValues: a => { for(let i = 0; i < a.length; i++) a[i] = i * 7 % 248; return a; } };
    location = { origin: 'https://app.example' };`);
  return { app, log };
}

test('إرسال: ملف بمجلد المعلم، سجل بمعرّفه، رابط واتساب على الرقم المحفوظ وبنص مُرمَّز', async () => {
  const { app, log } = appWith();
  await runInAppContext(app, `buildReportShare('a', 'guardian', '5')`);
  const up = log.find(l => l.op === 'upload');
  assert.equal(up.bucket, 'report-shares');
  assert.equal(up.p, 'u1/a/RID.pdf', 'مجلد المعلم ثم الطالب');
  assert.equal(up.o.upsert, false);
  assert.ok(!log.some(l => l.op === 'sign'), 'لا رابط موقَّع طويل من المتصفح: الخادم يُنشئه عند الفتح');
  const ins = log.find(l => l.table === 'student_report_shares' && l.op === 'insert');
  assert.equal(ins.values.teacher_id, 'u1');
  assert.equal(ins.values.object_path, 'u1/a/RID.pdf');
  assert.equal(ins.values.version, 'grades');
  assert.equal(ins.values.recipient, 'guardian');
  assert.ok(new Date(ins.values.expires_at) > new Date());
  assert.match(ins.values.short_code, /^[a-z2-9]{14}$/, 'رمز قصير بالأبجدية المسموحة');
  const html = runInAppContext(app, 'window.__els.reportShareResult.innerHTML');
  const href = html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
  assert.match(href, /^https:\/\/wa\.me\/966501234567\?text=/);
  const text = decodeURIComponent(href.split('?text=')[1]);
  assert.match(text, /تقرير الدرجات للطالب أحمد <b>/, 'الاسم كما هو في الرسالة، ومُهرَّب في الصفحة فقط');
  assert.match(text, new RegExp('https://app\\.example/r/' + ins.values.short_code), 'الرابط القصير على نطاق التطبيق');
  assert.ok(text.length < 140, 'الرسالة قصيرة');
  assert.doesNotMatch(text, /supabase|token=/, 'لا رابط تخزين طويل');
  assert.doesNotMatch(html, /<b>:/, 'الاسم لا يدخل HTML الصفحة خامًا');
  assert.equal(runInAppContext(app, 'window.__built[0].to'), 'ولي الأمر', 'نسخة الدرجات لولي الأمر');
});

test('نسخة تحليلية للطالب: بلا «موجّه إلى»، والتشخيص يتبع الخانة', async () => {
  const { app } = appWith();
  runInAppContext(app, `crmStudents[0].student_phone = '966551234567'; document.querySelector = () => ({ value: 'analytical' }); window.__els.rsDx.checked = false;`);
  await runInAppContext(app, `buildReportShare('a', 'student', '5')`);
  const b = runInAppContext(app, 'window.__built[0]');
  assert.equal(b.v, 'analytical');
  assert.equal(b.to, null);
  assert.equal(b.noDx, true, 'بدون تشخيص');
});

test('أُغلقت النافذة أثناء التجهيز: لا رابط يُعرض، ويُزال الملف والسجل', async () => {
  const { app, log } = appWith();
  runInAppContext(app, `window.__els.reportShareBody = { dataset: { token: '99' } };`);
  await runInAppContext(app, `buildReportShare('a', 'guardian', '5')`);
  assert.ok(log.some(l => l.op === 'remove' && l.paths[0] === 'u1/a/RID.pdf'), 'الملف أُزيل');
  const del = log.find(l => l.table === 'student_report_shares' && l.op === 'delete');
  assert.ok(del && JSON.stringify(del.f).includes('"teacher_id","u1"'), 'حذف السجل بتصفية المعلم');
  assert.equal(runInAppContext(app, 'window.__els.reportShareResult.innerHTML'), undefined);
});

test('فشل الرفع: لا سجل. فشل السجل بعد الرفع: يُزال الملف ولا يبقى يتيمًا', async () => {
  const a = appWith({ uploadError: new Error('رفض') });
  await runInAppContext(a.app, `buildReportShare('a', 'guardian', '5')`);
  assert.ok(!a.log.some(l => l.table === 'student_report_shares'), 'لا سجل');
  assert.match(runInAppContext(a.app, 'window.__toasts.join("|")'), /error:تعذّر تجهيز الرابط: رفض/);
  const b = appWith({ insertError: new Error('x') });
  await runInAppContext(b.app, `buildReportShare('a', 'guardian', '5')`);
  assert.ok(b.log.some(l => l.op === 'remove'), 'فشل السجل: الملف يُزال');
});

test('لا نقرتان متزامنتان، ولا إرسال بلا رقم، ولا نافذة لطالب بلا رقم', async () => {
  const { app, log } = appWith();
  await runInAppContext(app, `Promise.all([buildReportShare('a', 'guardian', '5'), buildReportShare('a', 'guardian', '5')])`);
  assert.equal(log.filter(l => l.op === 'upload').length, 1, 'رفع واحد');
  const none = appWith();
  await runInAppContext(none.app, `buildReportShare('a', 'student', '5')`);
  assert.equal(none.log.length, 0, 'لا رقم للطالب: لا شيء');
  runInAppContext(none.app, `openReportShare('a', 'student')`);
  assert.equal(runInAppContext(none.app, 'window.__modal.length'), 0);
  assert.match(runInAppContext(none.app, 'window.__toasts.join("|")'), /error:أضف رقم الطالب/);
  runInAppContext(none.app, `openReportShare('a', 'guardian')`);
  assert.match(runInAppContext(none.app, 'window.__modal[0]'), /data-token="\d+"/);
});

test('التنظيف: المنتهي فقط بتصفية المعلم، الملف أولًا ثم السجل، ولا يحذف السجل لو فشل حذف الملف', async () => {
  const ok = appWith({ expired: [{ id: 'r1', object_path: 'u1/a/1.pdf' }, { id: 'r2', object_path: 'u1/b/2.pdf' }] });
  await runInAppContext(ok.app, `reportShareCleanup()`);
  const sel = ok.log.find(l => l.table === 'student_report_shares' && l.op === 'select');
  assert.ok(JSON.stringify(sel.f).includes('"teacher_id","u1"') && JSON.stringify(sel.f).includes('"lt","expires_at"'));
  const rm = ok.log.findIndex(l => l.op === 'remove');
  const del = ok.log.findIndex(l => l.table === 'student_report_shares' && l.op === 'delete');
  assert.ok(rm > -1 && del > rm, 'الملف ثم السجل');
  assert.deepEqual(JSON.parse(JSON.stringify(ok.log[rm].paths)), ['u1/a/1.pdf', 'u1/b/2.pdf']);
  assert.ok(JSON.stringify(ok.log[del].f).includes('"teacher_id","u1"'));
  const bad = appWith({ expired: [{ id: 'r1', object_path: 'p' }], removeError: new Error('x') });
  await runInAppContext(bad.app, `reportShareCleanup()`);
  assert.ok(!bad.log.some(l => l.table === 'student_report_shares' && l.op === 'delete'), 'فشل حذف الملف: يبقى السجل لإعادة المحاولة');
  const again = appWith({ expired: [] });
  await runInAppContext(again.app, `reportShareCleanup(); reportShareCleanup();`);
  assert.equal(again.log.filter(l => l.op === 'select').length, 1, 'مرة واحدة بالجلسة');
});

test('البنية: السجل والحاوية بلا سياسة مسؤول، وقص الصفحات لا يعزل رأس الجدول، والملف مسجَّل', () => {
  const src = fs.readFileSync(path.join(root, 'app/app-43-report-share.js'), 'utf8');
  assert.match(src, /REPORT_SHARE_BREAKS = [^;]*\.sr tbody tr/, 'صفوف الجسم فقط');
  assert.doesNotMatch(src, /\.sr tr[,'`]/, 'لا «.sr tr» العامة (رأس الجدول)');
  assert.match(src, /area\.style\.width = '700px'/, 'عرض 700px كالطباعة');
  const sql = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
  /* حتى كتلة دوال النسخة الشاملة (للمسؤول بطبيعتها، ولا تشمل جدول الروابط ولا حاويته) */
  const bEnd = sql.indexOf('-- النسخة الاحتياطية الشاملة للمسؤول');
  const block = sql.slice(sql.indexOf("'report-shares'"), bEnd > 0 ? bEnd : undefined);
  assert.doesNotMatch(block, /is_admin/, 'لا سياسة مسؤول على الحاوية ولا السجل');
  assert.match(block, /public.*false|array\['application\/pdf'\]/s);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-43-report-share\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-43-report-share\.js/);
});

test('تصادم الرمز القصير يُعاد مرة بشفرة جديدة، والرمز عشوائي بلا انحياز وبالأبجدية المسموحة', async () => {
  const { app, log } = appWith();
  runInAppContext(app, `window.__n = 0; const real = sb.from.bind(sb);
    sb.from = t => { const api = real(t); if(t === 'student_report_shares'){ const ins = api.insert; api.insert = v => { const r = ins(v); window.__n++; if(window.__n === 1) r.then = (res) => Promise.resolve({ data: null, error: { code: '23505' } }).then(res); return r; }; } return api; };`);
  await runInAppContext(app, `buildReportShare('a', 'guardian', '5')`);
  assert.equal(runInAppContext(app, 'window.__n'), 2, 'تصادم أول ثم محاولة ثانية بشفرة جديدة');
  assert.match(runInAppContext(app, 'window.__els.reportShareResult.innerHTML'), /wa\.me/, 'ونجح الإرسال بعد الإعادة');
  const code = runInAppContext(app, 'reportShareCode()');
  assert.match(code, /^[a-z2-9]{14}$/);
  assert.doesNotMatch(code, /[ilo01]/, 'بلا الحروف الملتبسة');
});

test('api/r.js: الرمز الصالح غير المنتهي فقط يُحوَّل، والخاطئ والمنتهي والمفقود بالرد نفسه، ولا قراءة بغير الرمز', async () => {
  const { resolveShare } = require('../api/r.js');
  const rows = [{ short_code: 'abcdefghjkmnpq', object_path: 'u1/a/1.pdf', expires_at: new Date(Date.now() + 86400000).toISOString() },
    { short_code: 'zzzzzzzzzzzzzz', object_path: 'u1/a/2.pdf', expires_at: new Date(Date.now() - 1000).toISOString() }];
  const calls = [];
  const sb = { from: t => { const f = []; const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; },
    maybeSingle: async () => { calls.push({ t, f }); return { data: rows.find(r => f.every(([c, v]) => r[c] === v)) || null, error: null }; } }; return api; } };
  assert.deepEqual(await resolveShare('abcdefghjkmnpq', sb), { ok: true, path: 'u1/a/1.pdf' });
  assert.deepEqual(await resolveShare('zzzzzzzzzzzzzz', sb), { ok: false }, 'منتهي');
  assert.deepEqual(await resolveShare('mmmmmmmmmmmmmm', sb), { ok: false }, 'غير موجود');
  const before = calls.length;
  for(const bad of ['', 'ABC', 'abc', "a' or '1'='1aaaaa", '../../etc/passwd', null, undefined, 'a'.repeat(40), ['abcdefghjkmnpq']])
    assert.deepEqual(await resolveShare(bad, sb), { ok: false }, 'يُرفض قبل أي استعلام: ' + String(bad));
  assert.equal(calls.length, before, 'الشكل الخاطئ لا يصل للقاعدة');
  assert.ok(calls.every(c => c.t === 'student_report_shares' && c.f.length === 1 && c.f[0][0] === 'short_code'), 'استعلام واحد بالرمز وحده');
});

test('api/r.js: ردود بلا تخزين ولا فهرسة، وrewrite لـ/r/ في vercel.json، وبلا require للحزمة بأعلى الملف', () => {
  const src = fs.readFileSync(path.join(root, 'api/r.js'), 'utf8');
  assert.match(src, /Cache-Control', 'no-store'/);
  assert.match(src, /Referrer-Policy', 'no-referrer'/);
  assert.match(src, /X-Robots-Tag', 'noindex'/);
  assert.match(src, /res\.redirect\(302/);
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vj.rewrites.some(r => r.source === '/r/:code' && r.destination === '/api/r?c=:code'));
});

test('رسائل المراحل على الزر بالترتيب (قراءة ← PDF ← رفع ← رابط)، ولا تُكتب فوق نافذة أُغلقت', async () => {
  const { app } = appWith();
  runInAppContext(app, `window.__stages = []; const btn = {}; Object.defineProperty(btn, 'textContent', { set(v){ window.__stages.push(v); }, get(){ return ''; } }); window.__els.rsGoBtn = btn;`);
  await runInAppContext(app, `buildReportShare('a', 'guardian', '5')`);
  const st = runInAppContext(app, 'window.__stages.filter((x, i, a) => x !== a[i - 1])');
  assert.deepEqual(Array.from(st).slice(0, 4), ['جارٍ قراءة بيانات الطالب…', 'جارٍ تحويل التقرير إلى PDF…', 'جارٍ رفع الملف…', 'جارٍ إنشاء الرابط…']);
  const closed = appWith();
  runInAppContext(closed.app, `window.__stages = []; const btn = {}; Object.defineProperty(btn, 'textContent', { set(v){ window.__stages.push(v); }, get(){ return ''; } }); window.__els.rsGoBtn = btn; window.__els.reportShareBody = { dataset: { token: '99' } };`);
  await runInAppContext(closed.app, `buildReportShare('a', 'guardian', '5')`);
  assert.equal(runInAppContext(closed.app, 'window.__stages.length'), 1, 'نافذة مغلقة: لا كتابة سوى الأولى قبل الإغلاق');
});
