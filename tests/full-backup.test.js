'use strict';
/* النسخة الاحتياطية الشاملة للمسؤول (exportFullBackup، app-07):
   - كانت تقرأ الجداول مباشرة، وسياسات أغلب جداول إدارة الصف لا تسمح للمسؤول برؤية بيانات غيره، فتخرج «شاملة» ببياناته وحده بصمت.
   - صارت تمرّ بدالتي المسؤول admin_backup_counts/admin_backup_rows: كل الجداول كاملة، وأي فشل يوقف النسخة، والأعداد تُقارَن. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8');
const A07 = fs.readFileSync(path.join(root, 'app', 'app-07-backup-export.js'), 'utf8');

const sqlWhitelist = () => {
  const m = /function public\.admin_backup_tables\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(SQL);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
};
const jsTables = () => {
  const i = A07.indexOf('async function exportFullBackup');
  const m = /const tables = \[([^\]]*)\]/.exec(A07.slice(i));
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
};

/* ============ قاعدة البيانات ============ */

test('قائمة جداول التطبيق = القائمة البيضاء في الدالة (لا جدول يُطلب فيُرفض، ولا جدول يُنسى)', () => {
  assert.deepEqual(jsTables().slice().sort(), sqlWhitelist().slice().sort());
});

test('كل جدول بيانات بالقاعدة داخل النسخة، والمستثنى مقصود ومحدود', () => {
  const created = [...SQL.matchAll(/create table if not exists public\.([a-z_]+)/g)].map(x => x[1]);
  const fromSchema = [...runInAppContext(loadApp({}), 'buildSchemaSql()').matchAll(/create table if not exists public\.([a-z_]+)/g)].map(x => x[1]);
  const all = new Set(created.concat(fromSchema));
  const excluded = [...all].filter(t => !sqlWhitelist().includes(t)).sort();
  assert.deepEqual(excluded, ['login_attempts', 'personal_access_tokens', 'student_report_shares']);
});

test('الدوال: للمسؤول وحده، مسار بحث فارغ، بلا تنفيذ للزائر، وروابط الاستبانة بلا رمز', () => {
  const blk = SQL.slice(SQL.indexOf('create or replace function public.admin_backup_tables'));
  ['admin_backup_counts', 'admin_backup_rows'].forEach(f => {
    const def = blk.slice(blk.indexOf('function public.' + f), blk.indexOf('$fn$;', blk.indexOf('function public.' + f)));
    assert.match(def, /security definer set search_path = ''/, f);
    assert.match(def, /if v_uid is null or not public\.is_admin\(v_uid\) then raise exception 'forbidden'/, f);
    assert.match(blk, new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon`), f);
  });
  assert.match(blk, /not \(p_table = any\(public\.admin_backup_tables\(\)\)\) then raise exception 'unknown table'/);
  assert.match(blk, /p_limit > 1000 then raise exception 'bad range'/);
  assert.match(blk, /public\.%I/);
  assert.match(blk, /if p_table in \('survey_invites', 'leader_followups'\) then[\s\S]*?jsonb_build_object\('code', null\)/);
});

test('مرآة buildSchemaSql: نفس كتلة الدوال حرفيًا (الاستعادة على مشروع جديد تشمل النسخ)', () => {
  const blk = SQL.slice(SQL.indexOf('-- النسخة الاحتياطية الشاملة للمسؤول')).trim();
  assert.ok(runInAppContext(loadApp({}), 'buildSchemaSql()').includes(blk));
});

/* ============ دالة صرفة ============ */

test('فحص الاكتمال: المطابق مكتمل، والناقص والغائب من الأعداد يُعلَنان', () => {
  const app = loadApp({});
  const J = v => JSON.parse(JSON.stringify(v));
  assert.deepEqual(J(app.fullBackupCompleteness(['a', 'b'], { a: 2, b: 0 }, { a: [1, 2], b: [] })), { ok: true, mismatches: [] });
  assert.deepEqual(J(app.fullBackupCompleteness(['a', 'b'], { a: 3 }, { a: [1, 2], b: [] })), { ok: false, mismatches: [{ table: 'a', got: 2, expected: 3 }, { table: 'b', got: 0, expected: null }] });
});

test('سجل النشاط: زيادته أثناء التصدير (سطر النسخة نفسها) ليست نقصًا، ونقصه نقص', () => {
  const app = loadApp({});
  /* حالة حقيقية: عُدّ 2269 ثم سجّلت الدالة سطر النسخة فجُلب 2270 */
  assert.equal(app.fullBackupCompleteness(['audit_log'], { audit_log: 2269 }, { audit_log: new Array(2270) }).ok, true);
  assert.equal(app.fullBackupCompleteness(['audit_log'], { audit_log: 2269 }, { audit_log: new Array(2268) }).ok, false);
  assert.equal(app.fullBackupCompleteness(['shawahid'], { shawahid: 101 }, { shawahid: new Array(102) }).ok, false, 'غيره يبقى مطابقة تامة');
});

/* ============ مسار التصدير ============ */

async function run(rpcImpl){
  const calls = [];
  const sb = {
    rpc(name, args){ calls.push({ name, args }); return Promise.resolve(rpcImpl(name, args)); },
    from(){ throw new Error('قراءة مباشرة للجداول ممنوعة في النسخة الشاملة'); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'admin1', email: 'a@b.c', user_metadata: {} } });
  runInAppContext(app, `
    isAdmin = true;
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    const __el = { style: {}, textContent: '', disabled: false };
    const __orig = document.getElementById;
    document.getElementById = id => (/^fullBackup/.test(id) ? __el : (__orig ? __orig(id) : null));
    window.__msg = () => __el.textContent;
    ensureZipLib = async () => {};
    window.__zipFiles = 0;
    JSZip = function(){ this.file = () => { window.__zipFiles++; throw new Error('STOP_AFTER_FETCH'); }; this.folder = () => this; };`);
  await runInAppContext(app, `exportFullBackup()`);
  return { calls, toasts: runInAppContext(app, 'window.__toasts.slice()'), msg: runInAppContext(app, 'window.__msg()') };
}
const tables = jsTables();
const countsAll = n => Object.fromEntries(tables.map(t => [t, t === 'classroom_grade_scores' ? n : 0]));

test('يجلب بالصفحات حتى آخر صف (2500 صف = 3 صفحات) ولا يقرأ الجداول مباشرة', async () => {
  const r = await run((name, a) => {
    if(name === 'admin_backup_counts') return { data: countsAll(2500), error: null };
    if(a.p_table !== 'classroom_grade_scores') return { data: [], error: null };
    const left = Math.max(0, Math.min(a.p_limit, 2500 - a.p_offset));
    return { data: Array.from({ length: left }, (_, i) => ({ id: a.p_offset + i })), error: null };
  });
  const pages = r.calls.filter(c => c.name === 'admin_backup_rows' && c.args.p_table === 'classroom_grade_scores');
  assert.deepEqual(pages.map(c => c.args.p_offset), [0, 1000, 2000]);
  assert.equal(r.calls.filter(c => c.name === 'admin_backup_rows').length, tables.length + 2, 'كل جدول مرة واحدة على الأقل');
  assert.match(r.msg, /STOP_AFTER_FETCH/, 'وصل لبناء الملف بعد الجلب كاملًا');
});

test('فشل جلب أي جدول يوقف النسخة قبل إنشاء أي ملف', async () => {
  const r = await run((name, a) => {
    if(name === 'admin_backup_counts') return { data: countsAll(0), error: null };
    if(a.p_table === 'classroom_tool_marks') return { data: null, error: { message: 'network' } };
    return { data: [], error: null };
  });
  assert.match(r.msg, /تعذّر جلب جدول classroom_tool_marks.*أُوقفت النسخة/);
  assert.ok(r.toasts.some(t => /^error:/.test(t)));
  assert.doesNotMatch(r.msg, /STOP_AFTER_FETCH/, 'لم يُكتب أي ملف');
});

test('الدالة غير مثبّتة: رسالة واضحة بدل نسخة ناقصة', async () => {
  const r = await run(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_backup_counts' } }));
  assert.match(r.msg, /غير مثبّتة في قاعدة البيانات/);
  assert.equal(r.calls.filter(c => c.name === 'admin_backup_rows').length, 0);
});
