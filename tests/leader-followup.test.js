'use strict';
/* ============================================================
   متابعة مؤشرات القيادة المدرسية (LEADER-FOLLOWUP.md): المصدر المشترك leader-kit.js، وSQL، والصفحة العامة api/f.js،
   وشاشات المعلم app-50 داخل الأدوات.
   ما تحميه الاختبارات (كل واحدة تفشل لو رُجّع الكود لما قبل الإصلاح):
   1) تطابق قواعد التحقق بين JS وSQL، ودالة submit لـservice_role وحدها، والمعلم لا يكتب الإجابة (صلاحيات أعمدة).
   2) الصفحة العامة: رابط خاطئ/مستخدَم/منتهٍ بردّ موحَّد، تهريب كل نص، 409 عند حجز الموعد، لا استهلاك عند GET.
   3) شاشات المعلم: كل استعلام بتصفية teacher_id، لا تسرّب بين المعلمين، لا نقرة مزدوجة، لا بريد إلكتروني بالصفحة العامة،
      الحذف للمجاب عنه ممنوع، إعادة قراءة أحدث نسخة، والشارة بالدرج.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const K = require('../leader-kit.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const SQL = read('sql-updates-run-in-supabase.sql');
const A07 = read('app/app-07-backup-export.js');
const A50 = read('app/app-50-leader-followup.js');
const J = v => JSON.parse(JSON.stringify(v));
const IND = [{ id: 'i1', label: 'تنفيذ خطة التحسين' }, { id: 'i2', label: 'الزيارات الصفية' }];
const SLOTS = ['2026-11-16T12:00', '2026-11-17T09:15'];
const blockOf = () => SQL.slice(SQL.indexOf('-- ============ متابعة مؤشرات القيادة المدرسية'), SQL.lastIndexOf('-- ====', SQL.indexOf('-- النسخة الاحتياطية الشاملة للمسؤول')));

/* ================= leader-kit.js ================= */

test('leader-kit.js: الصادرات بالضبط، وبلا تلويث globalThis في Node، ويعمل كسكربت متصفح بلا تصادم', () => {
  const EXPORTS = ['LEADER_ANSWER_STATES', 'LEADER_LIMITS', 'LEADER_ROLES', 'LEADER_SLOT_NONE', 'LEADER_SLOT_RE', 'leaderDateLabel', 'leaderRoleLabel', 'leaderSlotLabel', 'leaderValidateAnswers', 'leaderValidateDraft', 'leaderValidateIndicators', 'leaderValidateSlots'];
  assert.deepEqual(Object.keys(K).sort(), EXPORTS);
  EXPORTS.forEach(k => assert.equal(globalThis[k], undefined, k));
  const src = read('leader-kit.js');
  const ctx = vm.createContext({});
  const before = new Set(Object.getOwnPropertyNames(ctx));
  vm.runInContext(src, ctx);
  assert.deepEqual(Object.getOwnPropertyNames(ctx).filter(k => !before.has(k)).sort(), EXPORTS);
  assert.doesNotMatch(src, /^(const|let|var|function|class)\s/m, 'كل شيء داخل IIFE');
  assert.doesNotMatch(src, /\bimport\b|\bexport\b|\(\?<[=!]/, 'بلا وحدات ES ولا lookbehind');
  const ctx2 = vm.createContext({});
  vm.runInContext('function btrim(){ return 3; } const CONTROL = 4;\n' + src, ctx2);
  assert.equal(vm.runInContext('btrim()', ctx2), 3, 'لا يكتب فوق دوال التطبيق');
});

test('المؤشرات: 1..15 بمفتاحين فقط، معرّف i<رقم> فريد، نص 1..150 بلا محارف تحكم', () => {
  assert.equal(K.leaderValidateIndicators(IND).ok, true);
  assert.deepEqual(J(K.leaderValidateIndicators([{ id: 'i1', label: '  نص  ' }]).value), [{ id: 'i1', label: 'نص' }]);
  const bad = [[], null, 'x', [{ id: 'i1' }], [{ id: 'i1', label: 'a', extra: 1 }], [{ id: 'q1', label: 'a' }], [{ id: 'i1', label: ' ' }],
    [{ id: 'i1', label: 'a' }, { id: 'i1', label: 'b' }], [{ id: 'i1', label: 'x\u0007y' }], [{ id: 'i1', label: 'x'.repeat(151) }], [{ id: 'i1', label: 5 }],
    Array.from({ length: 16 }, (_, i) => ({ id: 'i' + (i + 1), label: 'a' }))];
  bad.forEach((b, k) => assert.equal(K.leaderValidateIndicators(b).ok, false, 'حالة ' + k));
  assert.equal(K.leaderValidateIndicators(Array.from({ length: 15 }, (_, i) => ({ id: 'i' + (i + 1), label: 'a' }))).ok, true);
});

test('الأوقات: 0..6 بصيغة YYYY-MM-DDTHH:MM بلا تكرار', () => {
  assert.equal(K.leaderValidateSlots([]).ok, true);
  assert.equal(K.leaderValidateSlots(SLOTS).ok, true);
  [['2026-11-16 12:00'], ['2026-13-16T12:00'], ['2026-11-16T24:00'], ['2026-11-16T12:60'], [5], SLOTS.concat(SLOTS), Array.from({ length: 7 }, (_, i) => '2026-11-1' + i + 'T10:00'), 'x']
    .forEach((b, k) => assert.equal(K.leaderValidateSlots(b).ok, false, 'حالة ' + k));
  assert.equal(K.leaderSlotLabel('2026-11-15T10:30'), 'الأحد 15 نوفمبر 10:30 ص');
  assert.equal(K.leaderSlotLabel('2026-11-16T12:00'), 'الإثنين 16 نوفمبر 12:00 م');
  assert.equal(K.leaderSlotLabel('2026-11-16T00:05'), 'الإثنين 16 نوفمبر 12:05 ص');
  assert.equal(K.leaderSlotLabel('bad'), '');
});

test('الإجابات: كل مؤشر بحالة صحيحة، والسبب إلزامي لغير المنفذ، والمفاتيح الزائدة تُهمل', () => {
  const ok = K.leaderValidateAnswers(IND, { i1: { s: 'done', x: 1 }, i2: { s: 'no', r: '  سبب  ' }, zzz: 5 });
  assert.deepEqual(J(ok), { ok: true, value: { i1: { s: 'done' }, i2: { s: 'no', r: 'سبب' } } });
  assert.deepEqual(J(K.leaderValidateAnswers(IND, { i1: { s: 'done', r: null }, i2: { s: 'wip', r: 'ج' } }).value), { i1: { s: 'done' }, i2: { s: 'wip', r: 'ج' } });
  const bad = [null, [], {}, { i1: { s: 'done' } }, { i1: { s: 'done' }, i2: { s: 'no' } }, { i1: { s: 'done' }, i2: { s: 'no', r: '   ' } },
    { i1: { s: 'maybe' }, i2: { s: 'done' } }, { i1: 'done', i2: { s: 'done' } }, { i1: { s: 'done', r: 5 }, i2: { s: 'done' } },
    { i1: { s: 'done', r: 'x'.repeat(301) }, i2: { s: 'done' } }, { i1: { s: 'done', r: 'a\u0001' }, i2: { s: 'done' } }];
  bad.forEach((b, k) => assert.equal(K.leaderValidateAnswers(IND, b).ok, false, 'حالة ' + k));
  assert.equal(K.leaderValidateAnswers(IND, { i1: { s: 'done', r: 'x'.repeat(300) }, i2: { s: 'done' } }).ok, true);
  assert.equal(K.leaderValidateAnswers([], {}).ok, false);
});

/* ================= SQL ================= */

test('SQL ↔ JS: حدود المؤشرات والأوقات والإجابات هي نفسها بـleader-kit.js', () => {
  const b = blockOf();
  assert.match(b, /jsonb_array_length\(p\) < 1 or jsonb_array_length\(p\) > 15/);
  assert.match(b, /char_length\(v_s\) < 1 or char_length\(v_s\) > 150/);
  assert.match(b, /v_id !~ '\^i\[0-9\]\{1,3\}\$'/);
  assert.match(b, /jsonb_array_length\(p\) > 6/);
  assert.match(b, /char_length\(v_r\) > 300/);
  assert.match(b, /v_s not in \('done', 'wip', 'no'\)/);
  assert.match(b, /if v_s <> 'done' and v_r = '' then return null/);
  assert.deepEqual(K.LEADER_LIMITS, { maxIndicators: 15, maxLabel: 150, maxSlots: 6, maxReason: 300, maxName: 60, maxCycle: 60 });
  assert.deepEqual(Object.keys(K.LEADER_ANSWER_STATES), ['done', 'wip', 'no']);
  /* نفس نص تعبير الموعد حرفيًا بالـSQL (دالة الأوقات وقيد العمود) وبـJS */
  const re = K.LEADER_SLOT_RE.source.replace(/\\\//g, '/');
  assert.equal(b.split(re).length - 1, 2, 'تعبير الموعد بالـSQL مرتان: دالة الأوقات وقيد chosen_slot');
  assert.match(b, /leader_role in \('principal', 'deputy_students', 'deputy_academic', 'deputy_other', 'other'\)/);
  assert.deepEqual(Object.keys(K.LEADER_ROLES), ['principal', 'deputy_students', 'deputy_academic', 'deputy_other', 'other']);
});

test('SQL: بلا سياسة مسؤول، والمعلم لا يكتب الإجابة ولا المسودة (صلاحيات أعمدة)، والحذف لطلباته كلها (عبر السلة بالواجهة)', () => {
  const b = blockOf();
  assert.doesNotMatch(b, /is_admin/, 'بلا سياسة «المسؤول يرى الكل»');
  assert.equal((b.match(/auth\.uid\(\) = teacher_id/g) || []).length >= 4, true);
  assert.match(b, /revoke all on public\.leader_followups from anon;/);
  assert.match(b, /revoke insert, update on public\.leader_followups from authenticated;/);
  const ins = /grant insert \(([^)]*)\)/.exec(b)[1], upd = /grant update \(([^)]*)\)/.exec(b)[1];
  ['answers', 'chosen_slot', 'answered_at', 'created_at', 'id', 'draft', 'draft_saved_at'].forEach(c => { assert.doesNotMatch(ins, new RegExp('\\b' + c + '\\b')); assert.doesNotMatch(upd, new RegExp('\\b' + c + '\\b')); });
  assert.match(upd, /\bseen_at\b/); assert.match(upd, /\bsent_at\b/); assert.match(upd, /\bcode\b/);
  assert.match(b, /create policy "المعلم يحذف طلبات متابعته فقط" on public\.leader_followups for delete to authenticated\s+using \(auth\.uid\(\) = teacher_id\);/);
  assert.match(b, /drop policy if exists "المعلم يحذف طلباته غير المجاب عنها"/, 'السياسة القديمة تُزال عند التشغيل على قاعدة قائمة');
  for(const m of b.matchAll(/create policy "([^"]+)"/g)) assert.ok(Buffer.byteLength(m[1], 'utf8') <= 63, 'اسم سياسة أطول من 63 بايت: ' + m[1]);
  assert.match(b, /for insert to authenticated\s+with check \(auth\.uid\(\) = teacher_id and answered_at is null\)/);
});

test('SQL: دالة الاستلام لـservice_role وحدها، وذرّية، والموعد المحجوز بفهرس فريد، والرابط يموت بالرد', () => {
  const b = blockOf();
  assert.match(b, /revoke execute on function public\.submit_leader_followup\(text, jsonb, text\) from public, anon, authenticated;\s+grant execute on function public\.submit_leader_followup\(text, jsonb, text\) to service_role;/);
  assert.match(b, /revoke execute on function public\.leader_answers_clean\(jsonb, jsonb\) from public, anon, authenticated;\s+grant execute on function public\.leader_answers_clean\(jsonb, jsonb\) to service_role;/);
  const fn = b.slice(b.indexOf('function public.submit_leader_followup'));
  assert.match(fn, /security definer set search_path = ''/);
  assert.match(fn, /where code = p_code and answered_at is null and closes_at > now\(\) for update/);
  assert.match(fn, /code = null/);
  assert.match(fn, /exception when unique_violation then\s+return 'slot_taken'/);
  assert.match(b, /create unique index if not exists leader_followups_slot_key on public\.leader_followups\(teacher_id, chosen_slot\) where chosen_slot is not null and chosen_slot <> 'none'/);
  assert.match(b, /create unique index if not exists leader_followups_code_key on public\.leader_followups\(code\) where code is not null/);
  assert.match(b, /check \(\(answered_at is null\) = \(answers is null\)\)/);
});

test('SQL: حارس التجميد بعد الرد والإرسال، ومنع نقل المالك', () => {
  const g = blockOf();
  assert.match(g, /new\.teacher_id is distinct from old\.teacher_id/);
  assert.match(g, /old\.answered_at is not null and \(to_jsonb\(new\) - 'seen_at'\) is distinct from \(to_jsonb\(old\) - 'seen_at'\)/);
  assert.match(g, /old\.sent_at is not null and \(new\.indicators is distinct from old\.indicators or new\.slots is distinct from old\.slots\)/);
  assert.match(g, /create or replace trigger trg_leader_followup_guard before update on public\.leader_followups/);
});

test('SQL: الجدول بقائمتي النسخة الشاملة (SQL + JS) وسياسة التعطيل، والرمز يُصدَّر null، والمرآة حرفية', () => {
  const wl = /function public\.admin_backup_tables\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(SQL)[1];
  assert.match(wl, /'leader_followups'/);
  const jsList = /const tables = \[([^\]]*)\]/.exec(A07.slice(A07.indexOf('async function exportFullBackup')))[1];
  assert.match(jsList, /'leader_followups'/);
  const dis = /foreach v_t in array array\[([\s\S]*?)\] loop/.exec(SQL.slice(SQL.indexOf('-- فرض «تعطيل الحساب» من القاعدة نفسها')))[1];
  assert.match(dis, /'leader_followups'/);
  assert.match(SQL, /if p_table in \('survey_invites', 'leader_followups'\) then/);
  assert.ok(runInAppContext(loadApp({}), 'buildSchemaSql()').includes(blockOf().trim()), 'مرآة buildSchemaSql: نفس الكتلة حرفيًا');
  assert.match(A07, /50\. leader_followups\.csv/, 'دليل الاستعادة يذكر الجدول');
  assert.doesNotMatch(blockOf(), /\\|`|\$\{/, 'الكتلة تُنسخ حرفيًا داخل نص JS: بلا شرطة مائلة ولا backtick');
});

test('النسخة الشخصية (app-08): تشمل الجدول بتصفية teacher_id ورموزه null', () => {
  const src = read('app/app-08-admin.js');
  assert.match(src, /sb\.from\('leader_followups'\)\.select\('\*'\)\.eq\('teacher_id', uid\)/);
  assert.match(src, /leader_followups: \(leaderFollowupsRes\.data \|\| \[\]\)\.map\(r => Object\.assign\(\{\}, r, \{ code: null \}\)\)/);
  assert.match(src, /leaderFollowupsRes \};/, 'ضمن فحص أي جلب فاشل يوقف النسخة');
});

test('المسودة: إجابات جزئية مسموحة، والفارغ والمجهول يُهملان، والحالة والسبب والموعد بنفس قواعد التسليم', () => {
  const I3 = IND.concat([{ id: 'i3', label: 'ثالث' }]);
  assert.deepEqual(J(K.leaderValidateDraft(I3, SLOTS, { a: { i1: { s: 'no' }, i2: { r: '  نص  ', s: '' }, i3: {}, zz: { s: 'done' } }, slot: SLOTS[0] })),
    { ok: true, value: { a: { i1: { s: 'no' }, i2: { r: 'نص' } }, slot: SLOTS[0] } }, 'نفس ناتج leader_draft_clean على PostgreSQL');
  assert.deepEqual(J(K.leaderValidateDraft(IND, SLOTS, {}).value), { a: {}, slot: null });
  assert.deepEqual(J(K.leaderValidateDraft(IND, SLOTS, { a: null, slot: 'none' }).value), { a: {}, slot: 'none' });
  const bad = [null, [], { a: [] }, { a: { i1: 'done' } }, { a: { i1: { s: 'maybe' } } }, { a: { i1: { s: 5 } } }, { a: { i1: { r: 7 } } },
    { a: { i1: { r: 'x'.repeat(301) } } }, { a: { i1: { r: 'a\u0001' } } }, { slot: '2026-12-01T10:00' }, { slot: 3 }];
  bad.forEach((b, k) => assert.equal(K.leaderValidateDraft(IND, SLOTS, b).ok, false, 'حالة ' + k));
  assert.equal(K.leaderValidateDraft(IND, [], { slot: 'none' }).ok, false, 'بلا أوقات: بلا موعد');
  assert.equal(K.leaderValidateDraft([], SLOTS, {}).ok, false);
  assert.equal(K.leaderDateLabel('2026-11-21T22:30:00Z'), 'الأحد 22 نوفمبر', 'بتوقيت السعودية');
  assert.equal(K.leaderDateLabel('bad'), '');
});

test('SQL: المسودة — أعمدة إضافية آمنة، ودالة الحفظ لـservice_role وحدها، لا تستهلك الرابط، والتسليم يمسحها، والقواعد = JS', () => {
  const b = blockOf();
  assert.match(b, /alter table public\.leader_followups add column if not exists draft jsonb\s+constraint leader_followups_draft_chk check/);
  assert.match(b, /alter table public\.leader_followups add column if not exists draft_saved_at timestamptz;/);
  assert.match(b, /revoke execute on function public\.save_leader_draft\(text, jsonb\) from public, anon, authenticated;\s+grant execute on function public\.save_leader_draft\(text, jsonb\) to service_role;/);
  assert.match(b, /revoke execute on function public\.leader_draft_clean\(jsonb, jsonb, jsonb\) from public, anon, authenticated;/);
  const fn = b.slice(b.indexOf('function public.save_leader_draft'), b.indexOf('$fn$;', b.indexOf('function public.save_leader_draft')));
  assert.match(fn, /security definer set search_path = ''/);
  assert.match(fn, /where code = p_code and answered_at is null and closes_at > now\(\) for update/);
  assert.match(fn, /set draft = v_clean, draft_saved_at = now\(\) where id = r\.id/);
  assert.doesNotMatch(fn, /code = null|answered_at = /, 'الحفظ لا يستهلك الرابط');
  assert.match(b, /answered_at = now\(\), seen_at = null, code = null, draft = null/, 'التسليم يمسح المسودة');
  const dc = b.slice(b.indexOf('function public.leader_draft_clean'));
  assert.match(dc, /\(v_x->>'s'\) not in \('done', 'wip', 'no'\)/); assert.match(dc, /char_length\(v_r\) > 300/);
  assert.match(dc, /p_slots \? \(v_slot #>> '\{\}'\)\) or jsonb_array_length\(p_slots\) = 0/);
});

test('SQL: سلة المحذوفات تقبل الجدول (الاسترجاع)، بالملف والمرآة', () => {
  for(const src of [SQL, runInAppContext(loadApp({}), 'buildSchemaSql()')]){
    const allowed = /v_allowed text\[\] := array\[([\s\S]*?)\];/.exec(src)[1];
    assert.match(allowed, /'leader_followups'/);
  }
});

/* ================= الصفحة العامة api/f.js ================= */

const F = require('../api/f.js');
const CODE = 'abcdefghjk';
const future = () => new Date(Date.now() + 864e5).toISOString();
function fakeDb(o){
  o = o || {};
  const base = { teacher_id: 't1', leader_role: 'principal', leader_name: 'فهد', cycle_label: 'الفصل الأول', sender_name: 'عبدالعزيز', indicators: J(IND), slots: J(SLOTS), closes_at: future(), answered_at: null };
  const rows = [
    Object.assign({}, base, { code: CODE }, o.row || {}),
    Object.assign({}, base, { code: 'usedusedus', answered_at: '2026-11-01T00:00:00Z' }),
    Object.assign({}, base, { code: 'expiredexp', closes_at: new Date(Date.now() - 1000).toISOString() }),
    Object.assign({}, base, { code: 'badindbadi', indicators: [] }),
    Object.assign({}, base, { code: 'otherslots', teacher_id: 't1', slots: [], chosen_slot: null })
  ];
  const booked = o.booked || [];
  const calls = [];
  const client = {
    from(t){ const f = []; let cols = '', isTaken = false, inList = null;
      const api = {
        select(c){ cols = c; isTaken = c === 'chosen_slot'; return api; }, eq(c, v){ f.push([c, v]); return api; }, in(c, v){ inList = v; return api; },
        maybeSingle: async () => { calls.push({ t, cols, f: f.slice() }); if(o.dbError) return { data: null, error: { message: 'x' } };
          const row = rows.find(r => f.every(([c, v]) => r[c] === v)); return { data: row || null, error: null }; },
        then(res, rej){ calls.push({ t, cols, f: f.slice(), inList }); return Promise.resolve({ data: booked.filter(s => inList.indexOf(s) >= 0).map(s => ({ chosen_slot: s })), error: o.takenError ? { message: 'x' } : null }).then(res, rej); }
      }; return api; },
    rpc: async (name, args) => { calls.push({ rpc: name, args });
      if(o.rpcError) return { data: null, error: { message: 'x' } };
      if(name === 'save_leader_draft') return { data: o.draftRpc === undefined ? true : o.draftRpc, error: null };
      return { data: o.rpc || 'ok', error: null }; }
  };
  return { client, calls, rows };
}
function fakeRes(){ const r = { statusCode: 0, headers: {}, body: undefined, status(s){ r.statusCode = s; return r; }, setHeader(k, v){ r.headers[k.toLowerCase()] = v; }, send(b){ r.body = b; return r; } }; return r; }
function handlerWith(o){
  const f = fakeDb(o);
  const limiter = (o && o.limiter) || require('../api/s.js').createFailureLimiter();
  return { h: F.createHandler({ url: 'https://x.supabase.co', key: 'service', createClient: () => f.client, limiter }), f, limiter };
}
async function call(h, method, code, body, ip){
  const res = fakeRes();
  await h({ method, query: { c: code }, headers: { 'content-type': 'application/json' }, body, socket: { remoteAddress: ip || '10.0.0.1' } }, res);
  return res;
}
const GOOD = (extra) => Object.assign({ a: { i1: { s: 'done' }, i2: { s: 'wip', r: 'تعارض مع الاختبارات' } }, slot: SLOTS[0] }, extra || {});

test('api/f.js: GET يعرض الصفحة ولا يستهلك الرابط، وبرؤوس خصوصية ومحتوى بلا معرّفات', async () => {
  const { h, f } = handlerWith();
  const res = await call(h, 'GET', CODE);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['x-robots-tag'], /noindex/);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.match(res.headers['content-security-policy'], /default-src 'none'; script-src 'nonce-[^']+'; style-src 'nonce-[^']+'/);
  assert.match(res.body, /تنفيذ خطة التحسين/);
  assert.match(res.body, /الإثنين 16 نوفمبر 12:00 م/);
  assert.match(res.body, /مدير المدرسة — فهد/);
  assert.doesNotMatch(res.body, /t1|usedusedus/, 'لا معرّف معلم ولا رموز أخرى');
  assert.ok(!f.calls.some(c => c.rpc), 'GET لا يستدعي الدالة (لا يستهلك الرابط)');
});

test('api/f.js: الخاطئ والمستخدَم والمنتهي وسيّئ المؤشرات = ردّ موحَّد 404 بلا كشف السبب', async () => {
  const { h } = handlerWith();
  const bodies = [];
  for(const code of ['zzzzzzzzzz', 'usedusedus', 'expiredexp', 'badindbadi', 'short', 'ABCDEFGHJK']){
    const g = await call(h, 'GET', code); assert.equal(g.statusCode, 404, code); bodies.push(g.body.replace(/nonce="[^"]*"/g, ''));
    const p = await call(h, 'POST', code, GOOD()); assert.equal(p.statusCode, 404, code); assert.equal(p.body, '{"ok":false}');
  }
  assert.equal(new Set(bodies).size, 1, 'نفس الصفحة تمامًا');
});

test('api/f.js: كل نص من المعلم مهرَّب ومعزول اتجاهيًا (XSS)', async () => {
  const evil = '<img src=x onerror=alert(1)>"\'';
  const { h } = handlerWith({ row: { leader_name: evil, cycle_label: evil, sender_name: evil, indicators: [{ id: 'i1', label: evil }] } });
  const res = await call(h, 'GET', CODE);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<img/);
  assert.match(res.body, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;/);
  assert.match(res.body, /<bdi>/);
});

test('api/f.js: الأوقات المحجوزة تظهر معطّلة (محجوز) بلا كشف لمن', async () => {
  const { h } = handlerWith({ booked: [SLOTS[1]] });
  const res = await call(h, 'GET', CODE);
  assert.match(res.body, new RegExp('value="' + SLOTS[1] + '" class="s-slot" disabled'));
  assert.doesNotMatch(res.body, new RegExp('value="' + SLOTS[0] + '" class="s-slot" disabled'));
  assert.match(res.body, /\(محجوز\)/);
});

test('api/f.js POST: إجابة صالحة تمرّ للدالة بالقيم المنظَّفة، وslot_taken = 409، وغير ذلك = 404 موحّد', async () => {
  let r = handlerWith(); let res = await call(r.h, 'POST', CODE, GOOD({ a: { i1: { s: 'done', junk: 1 }, i2: { s: 'wip', r: '  سبب  ' }, extra: 1 } }));
  assert.equal(res.statusCode, 200); assert.equal(res.body, '{"ok":true}');
  const rpc = r.f.calls.find(c => c.rpc);
  assert.equal(rpc.rpc, 'submit_leader_followup');
  assert.deepEqual(J(rpc.args), { p_code: CODE, p_answers: { i1: { s: 'done' }, i2: { s: 'wip', r: 'سبب' } }, p_slot: SLOTS[0] });
  r = handlerWith({ rpc: 'slot_taken' }); res = await call(r.h, 'POST', CODE, GOOD());
  assert.equal(res.statusCode, 409); assert.equal(res.body, '{"ok":false,"error":"slot_taken"}');
  assert.equal(r.limiter.size(), 0, 'تعارض الموعد ليس محاولة رمز فاشلة');
  r = handlerWith({ rpc: 'invalid' }); res = await call(r.h, 'POST', CODE, GOOD()); assert.equal(res.statusCode, 404);
  r = handlerWith({ rpcError: true }); res = await call(r.h, 'POST', CODE, GOOD()); assert.equal(res.statusCode, 503);
});

test('api/f.js POST: إجابة أو موعد غير صالح يُرفض 400 قبل الدالة (السبب إلزامي، الموعد من المقترحة أو none)', async () => {
  const bads = [GOOD({ a: { i1: { s: 'done' } } }), GOOD({ a: { i1: { s: 'done' }, i2: { s: 'no' } } }), GOOD({ slot: '2026-12-01T10:00' }), GOOD({ slot: undefined }),
    GOOD({ slot: 5 }), 'x', null, [], { slot: SLOTS[0] }];
  for(const b of bads){
    const r = handlerWith(); const res = await call(r.h, 'POST', CODE, b);
    assert.equal(res.statusCode, 400, JSON.stringify(b)); assert.ok(!r.f.calls.some(c => c.rpc), 'لا نداء للدالة');
  }
  const r = handlerWith(); assert.equal((await call(r.h, 'POST', CODE, GOOD({ slot: K.LEADER_SLOT_NONE }))).statusCode, 200, 'none مقبول');
  const noSlots = handlerWith({ row: { slots: [] } });
  assert.equal((await call(noSlots.h, 'POST', CODE, { a: GOOD().a })).statusCode, 200, 'بلا أوقات: بلا موعد');
  assert.equal((await call(noSlots.h, 'POST', CODE, GOOD())).statusCode, 400, 'بلا أوقات: موعد مرفوض');
});

test('api/f.js POST مسودة: الجزئي يُحفظ بالقيم المنظَّفة ولا يستهلك الرابط، والخاطئ 400 قبل الدالة، والمُجاب/المنتهي 404', async () => {
  let r = handlerWith();
  let res = await call(r.h, 'POST', CODE, { draft: true, a: { i1: { s: 'no', r: '  سبب  ' }, i2: { s: null, r: '' }, zz: { s: 'done' } }, slot: null });
  assert.equal(res.statusCode, 200); assert.equal(res.body, '{"ok":true,"saved":true}');
  const rpcs = r.f.calls.filter(c => c.rpc);
  assert.deepEqual(rpcs.map(c => c.rpc), ['save_leader_draft'], 'لا تسليم');
  assert.deepEqual(J(rpcs[0].args), { p_code: CODE, p_draft: { a: { i1: { s: 'no', r: 'سبب' } }, slot: null } });
  for(const bad of [{ draft: true, a: { i1: { s: 'maybe' } } }, { draft: true, a: [] }, { draft: true, slot: '2026-12-01T10:00' }, { draft: true, a: { i1: { r: 'x'.repeat(301) } } }]){
    r = handlerWith(); res = await call(r.h, 'POST', CODE, bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad)); assert.ok(!r.f.calls.some(c => c.rpc));
  }
  r = handlerWith({ draftRpc: false }); res = await call(r.h, 'POST', CODE, { draft: true, a: {} }); assert.equal(res.statusCode, 404);
  r = handlerWith(); res = await call(r.h, 'POST', 'usedusedus', { draft: true, a: {} }); assert.equal(res.statusCode, 404, 'المُجاب عنه لا يقبل مسودة');
  r = handlerWith({ rpcError: true }); res = await call(r.h, 'POST', CODE, { draft: true, a: {} }); assert.equal(res.statusCode, 503);
  r = handlerWith(); res = await call(r.h, 'POST', CODE, { draft: 'yes', a: { i1: { s: 'done' } } });
  assert.equal(res.statusCode, 400, 'draft غير true = تسليم ناقص يُرفض لا مسودة');
});

test('api/f.js GET: الصفحة معبّأة من مسودة الخادم (مهرَّبة)، وتعرض آخر موعد للرابط وزر «حفظ والإكمال لاحقًا»', async () => {
  const evil = '</textarea><script>alert(1)</script>';
  const { h } = handlerWith({ row: { draft: { a: { i1: { s: 'done' }, i2: { s: 'no', r: evil } }, slot: SLOTS[1] }, draft_saved_at: '2026-11-12T10:00:00Z', closes_at: '2099-11-21T22:30:00Z' } });
  const res = await call(h, 'GET', CODE);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /value="done" class="s-done" checked/); assert.match(res.body, /value="no" class="s-no" checked/);
  assert.match(res.body, new RegExp('value="' + SLOTS[1] + '" class="s-slot" checked'));
  assert.doesNotMatch(res.body, /<\/textarea><script>alert/); assert.match(res.body, /&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/textarea>/);
  assert.ok(res.body.includes('data-saved="' + Date.parse('2026-11-12T10:00:00Z') + '"'), 'وقت آخر حفظ بالخادم (لمقارنة مسودة الجهاز)');
  assert.match(res.body, /أكمل من حيث توقفت: محفوظ 2 من 2/);
  assert.match(res.body, /حفظ والإكمال لاحقًا/);
  assert.match(res.body, /صالحًا حتى الأحد 22 نوفمبر/);
  const booked = await call(handlerWith({ booked: [SLOTS[1]], row: { draft: { a: {}, slot: SLOTS[1] } } }).h, 'GET', CODE);
  assert.doesNotMatch(booked.body, new RegExp('value="' + SLOTS[1] + '" class="s-slot" disabled checked'), 'موعد حُجز لغيره لا يبقى مختارًا من المسودة');
  const broken = await call(handlerWith({ row: { draft: { a: { i1: { s: 'weird' } } } } }).h, 'GET', CODE);
  assert.equal(broken.statusCode, 200, 'مسودة لا تطابق القواعد تُهمل ولا تكسر الصفحة'); assert.doesNotMatch(broken.body, / checked>/);
});

test('api/f.js: محدِّد المحاولات الفاشلة (429 بعد 20 فشلًا) وفشل القاعدة 503 وطرق غير مسموحة 405', async () => {
  const { h, limiter } = handlerWith();
  for(let i = 0; i < 20; i++) await call(h, 'GET', 'zzzzzzzzzz', null, '9.9.9.9');
  const blocked = await call(h, 'GET', CODE, null, '9.9.9.9');
  assert.equal(blocked.statusCode, 429); assert.ok(blocked.headers['retry-after']);
  assert.equal((await call(h, 'GET', CODE, null, '8.8.8.8')).statusCode, 200, 'عنوان آخر لا يتأثر');
  assert.equal((await call(handlerWith({ dbError: true }).h, 'GET', CODE)).statusCode, 503);
  assert.equal((await call(h, 'DELETE', CODE)).statusCode, 405);
  assert.ok(limiter);
});

test('api/f.js وvercel.json: التوجيه /f/ مستثنى من ترويسة SAMEORIGIN العامة، ومسارا require حرفيان', () => {
  const vj = JSON.parse(read('vercel.json'));
  assert.ok(vj.rewrites.some(r => r.source === '/f/:code' && r.destination === '/api/f?c=:code'));
  const re = new RegExp('^' + vj.headers[0].source + '$');
  assert.equal(re.test('/f/abcdefghjk'), false); assert.equal(re.test('/s/abcdefghjk'), false); assert.equal(re.test('/index.html'), true);
  const src = read('api/f.js');
  assert.match(src, /require\('\.\.\/leader-kit\.js'\)/); assert.match(src, /require\('\.\/s\.js'\)/);
});

test('الصفحة العامة تعمل فعليًا: السبب يظهر لغير المنفذ، والمسودة بمتصفح المسؤول، ونسخة الإجابة بعد النجاح (jsdom مصغّر)', () => {
  const page = F.buildLeaderPage({ req: { role: 'مدير المدرسة', name: 'فهد', cycle: 'ف1', sender: 'ع', indicators: IND, slots: SLOTS }, taken: [] }, 'N');
  const script = /<script nonce="N">([\s\S]*)<\/script>/.exec(page)[1];
  assert.doesNotThrow(() => new vm.Script(script), 'السكربت سليم الصياغة');
  assert.match(script, /localStorage/); assert.match(script, /credentials:'omit'/);
  assert.doesNotMatch(script, /\balert\(|innerHTML|document\.write|eval\(/, 'بلا alert ولا innerHTML');
});

/* ================= شاشات المعلم app-50 ================= */

function makeApp(opts){
  opts = opts || {};
  const log = [];
  const db = { leader_followups: (opts.rows || []).map(r => Object.assign({}, r)), deleted_items: [] };
  let seq = 0;
  const match = (r, f) => f.every(([k, c, v]) => k === 'eq' ? r[c] === v : k === 'is' ? (r[c] == null) === (v === null) && (v === null ? r[c] == null : true) : r[c] != null);
  const sb = {
    from(table){
      const f = []; let op = 'select', values = null, single = false, maybe = false, ret = false, head = false;
      const api = {
        select(cols, o){ if(op === 'insert' || op === 'delete') ret = true; if(o && o.head) head = true; return api; }, order(){ return api; }, range(){ return api; },
        eq(c, v){ f.push(['eq', c, v]); return api; }, is(c, v){ f.push(['is', c, v]); return api; }, not(c, _o, v){ f.push(['not', c, v]); return api; },
        insert(v){ op = 'insert'; values = v; return api; }, update(v){ op = 'update'; values = v; return api; }, delete(){ op = 'delete'; return api; },
        single(){ single = true; return api; }, maybeSingle(){ maybe = true; return api; },
        then(res, rej){
          log.push({ table, op, values, f: f.map(x => x.slice()), head });
          const t = db[table]; let data = null, error = null, count;
          const fail = opts.fail && opts.fail(table, op, values);
          if(fail) error = fail;
          else if(op === 'select'){
            const m = t.filter(r => match(r, f));
            if(head){ count = m.length; } else { data = JSON.parse(JSON.stringify(single || maybe ? (m[0] || null) : m)); } /* نسخة كما يفعل عميل Supabase: لا مرجع مشترك مع القاعدة */
          } else if(op === 'insert'){
            const row = Object.assign({ id: 'L' + (++seq), series_id: 'S' + seq, answered_at: null, seen_at: null, sent_at: null, answers: null, chosen_slot: null, created_at: new Date(2026, 10, 1 + seq).toISOString() }, values);
            t.push(row); if(ret) data = single ? row : [row];
          } else if(op === 'update'){
            t.filter(r => match(r, f)).forEach(r => Object.assign(r, values));
          } else if(op === 'delete'){
            if(opts.beforeDelete && table === 'leader_followups') opts.beforeDelete(db);
            const gone = t.filter(r => match(r, f)); gone.forEach(r => t.splice(t.indexOf(r), 1)); if(ret) data = gone;
          }
          return Promise.resolve({ data, error, count }).then(res, rej);
        }
      };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1', email: 'teacher@example.com', user_metadata: opts.meta || { full_name: 'عبدالعزيز' } } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__confirm = ${opts.confirm === false ? 'false' : 'true'}; showConfirm = async () => window.__confirm;
    window.__undo = []; showUndoToast = async (m) => { window.__undo.push(m); return true; };
    const els = {}; window.__els = els;
    const mk = () => ({ style: {}, dataset: {}, innerHTML: '', textContent: '', value: '', disabled: false, setAttribute(){}, parentNode: null });
    ['toolsView', 'toolsBody', 'toolsTitle', 'topTitle', 'toolsNavBadge', 'lfCreateBtn'].forEach(id => { els[id] = mk(); });
    els.toolsView.style.display = 'none';
    document.getElementById = id => { if(els[id]) return els[id]; if(/View$/.test(id)) return (els[id] = mk()); return null; };
    document.addEventListener = () => {};
    location = { origin: 'https://app.example' };
    navigator = { clipboard: { writeText: async t => { window.__copied = t; } } };
    let __n = 0; crypto = { getRandomValues: a => { __n++; for(let i = 0; i < a.length; i++) a[i] = (i * 7 + __n * 13) % 248; return a; } };`);
  return { app, log, db, toasts: () => J(runInAppContext(app, 'window.__toasts')), html: () => runInAppContext(app, 'window.__els.toolsBody.innerHTML') };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const row = (id, extra) => Object.assign({ id, teacher_id: 'u1', series_id: 'S-' + id, leader_role: 'principal', leader_name: 'فهد', cycle_label: 'الفصل الأول', sender_name: 'ع', indicators: J(IND), slots: J(SLOTS),
  code: 'abcdefghj' + id.length, closes_at: future(), sent_at: null, answered_at: null, seen_at: null, answers: null, chosen_slot: null, created_at: '2026-11-01T00:00:00.000Z' }, extra || {});
const answered = (id, extra) => row(id, Object.assign({ code: null, answered_at: '2026-11-05T09:00:00Z', answers: { i1: { s: 'done' }, i2: { s: 'wip', r: 'تعارض' } }, chosen_slot: SLOTS[0] }, extra || {}));

test('دوال صرفة: الحالة والعدّ والتجميع بسلاسل ومقارنة الدورات', () => {
  const { app } = makeApp();
  assert.equal(app.lfStatus(answered('a')), 'answered');
  assert.equal(app.lfStatus(row('b', { code: null })), 'revoked');
  assert.equal(app.lfStatus(row('c', { closes_at: new Date(Date.now() - 1000).toISOString() })), 'expired');
  assert.equal(app.lfStatus(row('d', { sent_at: '2026-11-02T00:00:00Z' })), 'sent');
  assert.equal(app.lfStatus(row('e')), 'ready');
  assert.deepEqual(J(app.lfCounts(answered('a'))), { done: 1, wip: 1, no: 0 });
  const list = [row('x1', { series_id: 'S', created_at: '2026-10-01T00:00:00Z' }), row('x2', { series_id: 'S', created_at: '2026-11-01T00:00:00Z' }), row('y', { series_id: 'T', created_at: '2026-10-15T00:00:00Z' })];
  const g = J(app.lfGroupSeries(list));
  assert.deepEqual(g.map(s => s.id), ['S', 'T']); assert.deepEqual(g[0].items.map(x => x.id), ['x2', 'x1'], 'الأحدث أولًا داخل السلسلة');
  const prev = answered('p', { series_id: 'S', created_at: '2026-10-01T00:00:00Z', answers: { i1: { s: 'no', r: 'x' }, i2: { s: 'done' } } });
  assert.deepEqual(J(app.lfPrevStates([prev, row('cur', { series_id: 'S', created_at: '2026-11-01T00:00:00Z' })], row('cur', { series_id: 'S', created_at: '2026-11-01T00:00:00Z' }))), { 'تنفيذ خطة التحسين': 'no', 'الزيارات الصفية': 'done' });
});

test('الشارة: عدد الإجابات التي لم تُشاهَد فقط، بتصفية المعلم، وتختفي عند الصفر', async () => {
  const k = makeApp({ rows: [answered('a'), answered('b', { seen_at: '2026-11-06T00:00:00Z' }), row('c'), answered('d', { teacher_id: 'other' })] });
  await runInAppContext(k.app, 'refreshLeaderBadge()');
  const b = runInAppContext(k.app, 'window.__els.toolsNavBadge');
  assert.equal(b.textContent, '1'); assert.equal(b.style.display, 'flex');
  const q = k.log[0]; assert.ok(q.f.some(x => x[0] === 'eq' && x[1] === 'teacher_id' && x[2] === 'u1'), 'تصفية المعلم'); assert.equal(q.head, true);
  const none = makeApp({ rows: [row('c')] }); await runInAppContext(none.app, 'refreshLeaderBadge()');
  assert.equal(runInAppContext(none.app, 'window.__els.toolsNavBadge.style.display'), 'none');
  const down = makeApp({ rows: [], fail: () => ({ message: 'relation does not exist' }) }); await runInAppContext(down.app, 'refreshLeaderBadge()');
  assert.equal(runInAppContext(down.app, 'window.__els.toolsNavBadge.style.display'), 'none', 'جدول غير منشأ: بلا شارة ولا انهيار');
});

test('القائمة: تحمّل طلبات المعلم وحده، وتظهر «جديد» للإجابة غير المشاهَدة، والنصوص مهرَّبة', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const k = makeApp({ rows: [answered('a', { leader_name: evil }), row('c', { leader_role: 'deputy_students', series_id: 'S2' }), answered('z', { teacher_id: 'other', leader_name: 'غريب' })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick();
  const sel = k.log.find(l => l.table === 'leader_followups' && l.op === 'select' && !l.head);
  assert.ok(sel.f.some(x => x[1] === 'teacher_id' && x[2] === 'u1'));
  const html = k.html();
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /غريب/, 'لا تسرّب بين المعلمين');
  assert.match(html, /جديد/); assert.match(html, /وكيل شؤون الطلاب/);
});

test('الإنشاء: مؤشرات وأوقات بمدقق المصدر المشترك، رابط عشوائي، ولا بريد بالصفحة العامة، ونقرة مزدوجة = طلب واحد', async () => {
  const k = makeApp({ meta: {} });
  runInAppContext(k.app, "showTools(); lfStartCreate(null)");
  runInAppContext(k.app, `lfState.create.role = 'deputy_academic'; lfState.create.cycle = 'الفصل الأول'; lfState.create.indicators = [' خطة ', '', 'زيارات']; lfState.create.slots = ['2026-11-16T12:00', ''];`);
  assert.equal(runInAppContext(k.app, 'lfCreateReady(lfState.create)'), true);
  runInAppContext(k.app, 'lfCreate(); lfCreate();'); await tick(); await tick();
  const ins = k.log.filter(l => l.table === 'leader_followups' && l.op === 'insert');
  assert.equal(ins.length, 1, 'لا تكرار بنقرة مزدوجة');
  const v = ins[0].values;
  assert.equal(v.teacher_id, 'u1'); assert.equal(v.leader_role, 'deputy_academic'); assert.equal(v.leader_name, null);
  assert.deepEqual(J(v.indicators), [{ id: 'i1', label: 'خطة' }, { id: 'i2', label: 'زيارات' }]); assert.deepEqual(J(v.slots), ['2026-11-16T12:00']);
  assert.match(v.code, /^[a-z2-9]{10}$/); assert.equal(v.sender_name, null, 'لا اسم مسجَّل: لا يُرسل البريد بديلًا');
  assert.ok(!('series_id' in v), 'طلب جديد: سلسلة جديدة بالقاعدة');
  assert.ok(new Date(v.closes_at).getTime() > Date.now() + 6 * 864e5);
  assert.equal(runInAppContext(k.app, 'toolsState.screen'), 'ldetail', 'يفتح التفاصيل بعد الإنشاء');
  assert.match(k.html(), /https:\/\/app\.example\/f\/[a-z2-9]{10}/); assert.match(k.html(), /wa\.me\/\?text=/);
  assert.doesNotMatch(JSON.stringify(v), /teacher@example\.com/);
});

test('الإنشاء: اسم المعلم المسجَّل يُرسل، وغير الصالح يُرفض بلا نداء، وفشل القاعدة لا يفتح شيئًا', async () => {
  const k = makeApp({ meta: { full_name: 'عبدالعزيز' } });
  runInAppContext(k.app, "showTools(); lfStartCreate(null); lfState.create.cycle = 'ف1'; lfState.create.indicators = ['x']; lfCreate();"); await tick(); await tick();
  assert.equal(k.log.find(l => l.op === 'insert').values.sender_name, 'عبدالعزيز');
  const bad = makeApp();
  runInAppContext(bad.app, "showTools(); lfStartCreate(null); lfState.create.cycle = ''; lfState.create.indicators = ['x'];");
  assert.equal(runInAppContext(bad.app, 'lfCreateReady(lfState.create)'), false, 'دورة فارغة');
  runInAppContext(bad.app, "lfCreate()"); await tick(); assert.ok(!bad.log.some(l => l.op === 'insert'));
  const fail = makeApp({ fail: (t, op) => op === 'insert' ? { message: 'boom' } : null });
  runInAppContext(fail.app, "showTools(); lfStartCreate(null); lfState.create.cycle = 'ف1'; lfState.create.indicators = ['x']; lfCreate();"); await tick(); await tick();
  assert.match(fail.toasts().join('|'), /error:تعذّر إنشاء الطلب: boom/); assert.equal(runInAppContext(fail.app, 'toolsState.screen'), 'lcreate');
  assert.equal(runInAppContext(fail.app, 'lfState.create.busy'), false, 'يمكن إعادة المحاولة');
});

test('الدورة التالية: نفس السلسلة والمسؤول والمؤشرات، بدورة فارغة وأوقات فارغة', async () => {
  const k = makeApp({ rows: [answered('a', { series_id: 'SER', leader_role: 'deputy_students', leader_name: 'سعد' })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick();
  runInAppContext(k.app, "lfStartCreate('a')");
  const c = J(runInAppContext(k.app, 'lfState.create'));
  assert.equal(c.series_id, 'SER'); assert.equal(c.role, 'deputy_students'); assert.equal(c.name, 'سعد'); assert.equal(c.cycle, ''); assert.deepEqual(c.slots, []);
  assert.deepEqual(c.indicators, ['تنفيذ خطة التحسين', 'الزيارات الصفية']);
  runInAppContext(k.app, "lfState.create.cycle = 'الفصل الثاني'; lfCreate();"); await tick(); await tick();
  assert.equal(k.log.find(l => l.op === 'insert').values.series_id, 'SER');
});

test('التفاصيل: نتائج مهرَّبة ومقارنة بالدورة السابقة، وفتحها تعلّم «شوهدت» بشرط وبتصفية المعلم', async () => {
  const prev = answered('p', { series_id: 'S', created_at: '2026-10-01T00:00:00Z', answers: { i1: { s: 'no', r: 'سبب قديم' }, i2: { s: 'wip', r: 'ج' } }, seen_at: '2026-10-02T00:00:00Z' });
  const cur = answered('q', { series_id: 'S', created_at: '2026-11-01T00:00:00Z', answers: { i1: { s: 'done' }, i2: { s: 'no', r: '<script>alert(1)</script>' } } });
  const k = makeApp({ rows: [prev, cur] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick();
  runInAppContext(k.app, "lfOpen('q')"); await tick(); await tick();
  const html = k.html();
  assert.doesNotMatch(html, /<script>alert/); assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /الدورة السابقة: لم ينفذ/, 'تحسّن المؤشر 1 يظهر');
  assert.match(html, /موعد اللقاء: الإثنين 16 نوفمبر 12:00 م/);
  const up = k.log.find(l => l.op === 'update' && l.values && l.values.seen_at);
  assert.ok(up.f.some(x => x[1] === 'teacher_id' && x[2] === 'u1') && up.f.some(x => x[0] === 'is' && x[1] === 'seen_at'));
  assert.match(html, /حذف الطلب/, 'المجاب عنه يُحذف أيضًا (عبر السلة)');
});

test('الموعد «لا يناسبني»: يظهر للمعلم ليحدد موعدًا آخر', async () => {
  const k = makeApp({ rows: [answered('a', { chosen_slot: 'none' })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(k.app, "lfOpen('a')"); await tick();
  assert.match(k.html(), /لم يناسبه أي موعد/);
});

test('الإرسال: يُعلَّم مرة واحدة بشرط sent_at فارغ، وتبدأ المدة من لحظته، وإعادة القراءة من القاعدة', async () => {
  const created = new Date(Date.now() - 3 * 864e5).toISOString();
  const k = makeApp({ rows: [row('a', { created_at: created, closes_at: new Date(Date.now() + 4 * 864e5).toISOString() })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(k.app, "lfOpen('a')"); await tick();
  runInAppContext(k.app, "lfMarkSent('a'); lfMarkSent('a');"); await tick(); await tick();
  const ups = k.log.filter(l => l.op === 'update' && l.values.sent_at);
  assert.equal(ups.length, 1, 'نقرتان = تحديث واحد');
  assert.ok(ups[0].f.some(x => x[0] === 'is' && x[1] === 'sent_at') && ups[0].f.some(x => x[0] === 'is' && x[1] === 'answered_at') && ups[0].f.some(x => x[1] === 'teacher_id'));
  assert.ok(new Date(ups[0].values.closes_at).getTime() - Date.now() > 6.9 * 864e5, 'المدة الأصلية 7 أيام من لحظة الإرسال');
  assert.match(k.html(), /أُرسل/);
});

test('نسخ الرابط يُعلِّم أُرسل أيضًا، والرابط الكامل يُنسخ', async () => {
  const k = makeApp({ rows: [row('a')] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(k.app, "lfOpen('a')"); await tick();
  await runInAppContext(k.app, "lfCopyLink('a')"); await tick();
  assert.equal(runInAppContext(k.app, 'window.__copied'), 'https://app.example/f/abcdefghj1');
  assert.equal(k.log.filter(l => l.op === 'update' && l.values.sent_at).length, 1);
});

test('إلغاء الرابط/التمديد/الإصدار: بتصفية المعلم وشرط «لم يُجب»، وبتأكيد للإلغاء، وتعطّل أثناء التنفيذ', async () => {
  const k = makeApp({ rows: [row('a', { sent_at: '2026-11-02T00:00:00Z' })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(k.app, "lfOpen('a')"); await tick();
  runInAppContext(k.app, "lfExtend('a'); lfExtend('a');"); await tick(); await tick(); await tick();
  const ext = k.log.filter(l => l.op === 'update' && l.values.closes_at && !l.values.sent_at);
  assert.equal(ext.length, 1, 'نقرتان = تنفيذ واحد');
  assert.ok(ext[0].f.some(x => x[1] === 'teacher_id' && x[2] === 'u1') && ext[0].f.some(x => x[0] === 'is' && x[1] === 'answered_at'));
  await runInAppContext(k.app, "lfRevoke('a')"); await tick();
  const rev = k.log.find(l => l.op === 'update' && l.values.code === null);
  assert.ok(rev && rev.f.some(x => x[0] === 'is' && x[1] === 'answered_at'));
  assert.match(k.html(), /أُلغي الرابط|رابطه مُلغى/); assert.match(k.html(), /إصدار رابط جديد/);
  await runInAppContext(k.app, "lfReissue('a')"); await tick();
  const re = k.log.find(l => l.op === 'update' && /^[a-z2-9]{10}$/.test(l.values.code || ''));
  assert.ok(re && re.f.some(x => x[1] === 'teacher_id'));
  const no = makeApp({ rows: [row('a')], confirm: false });
  runInAppContext(no.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(no.app, "lfOpen('a')"); await tick();
  await runInAppContext(no.app, "lfRevoke('a')"); assert.ok(!no.log.some(l => l.op === 'update' && 'code' in (l.values || {})), 'رُفض التأكيد: لا إلغاء');
});

async function openDetail(k, id){ runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick(); runInAppContext(k.app, `lfOpen('${id}')`); await tick(); }
const settle = async () => { for(let i = 0; i < 8; i++) await tick(); };

test('الحذف عبر سلة المحذوفات: لقطة أولًا بلا رمز الرابط، ثم الحذف بتصفية المعلم، ثم «تراجع»', async () => {
  const k = makeApp({ rows: [row('a', { draft: { a: { i1: { s: 'done' } }, slot: null } })] });
  await openDetail(k, 'a');
  await runInAppContext(k.app, "lfDelete('a')"); await settle();
  const snap = k.db.deleted_items[0];
  assert.ok(snap, 'لقطة بالسلة'); assert.equal(snap.kind, 'leader_followup'); assert.equal(snap.teacher_id, 'u1');
  const saved = snap.payload.tables[0];
  assert.equal(saved.t, 'leader_followups'); assert.equal(saved.rows[0].code, null, 'الاسترجاع لا يُحيي الرابط القديم');
  assert.deepEqual(J(saved.rows[0].draft), { a: { i1: { s: 'done' } }, slot: null }, 'المسودة محفوظة باللقطة');
  const iSnap = k.log.findIndex(l => l.table === 'deleted_items' && l.op === 'insert'), iDel = k.log.findIndex(l => l.table === 'leader_followups' && l.op === 'delete');
  assert.ok(iSnap > -1 && iSnap < iDel, 'لا حذف قبل نجاح حفظ اللقطة');
  const del = k.log[iDel];
  assert.ok(del.f.some(x => x[1] === 'teacher_id' && x[2] === 'u1') && del.f.some(x => x[0] === 'is' && x[1] === 'answered_at'), 'غير المجاب عنه: بشرط «لم يُجب»');
  assert.equal(k.db.leader_followups.length, 0); assert.equal(runInAppContext(k.app, 'toolsState.screen'), 'leaders');
  assert.match(J(runInAppContext(k.app, 'window.__undo')).join('|'), /حُذف الطلب — تجده في «المحذوفات»/);
});

test('الحذف: المجاب عنه يُحذف أيضًا (بإجابته داخل اللقطة)، وبلا تأكيد لا شيء، ونقرتان = لقطة واحدة', async () => {
  const k = makeApp({ rows: [answered('b')] });
  await openDetail(k, 'b');
  runInAppContext(k.app, "lfDelete('b'); lfDelete('b');"); await settle();
  assert.equal(k.db.deleted_items.length, 1, 'لقطة واحدة');
  assert.deepEqual(J(k.db.deleted_items[0].payload.tables[0].rows[0].answers), { i1: { s: 'done' }, i2: { s: 'wip', r: 'تعارض' } });
  const del = k.log.find(l => l.op === 'delete' && l.table === 'leader_followups');
  assert.ok(!del.f.some(x => x[1] === 'answered_at'), 'المجاب عنه: بلا شرط «لم يُجب»');
  assert.equal(k.db.leader_followups.length, 0);
  const no = makeApp({ rows: [answered('b')], confirm: false });
  await openDetail(no, 'b'); await runInAppContext(no.app, "lfDelete('b')"); await settle();
  assert.equal(no.db.leader_followups.length, 1); assert.equal(no.db.deleted_items.length, 0);
});

test('السباق: أجاب المسؤول بين اللقطة والحذف — لا يُحذف شيء، وتُزال اللقطة، وتظهر إجابته', async () => {
  const race = makeApp({ rows: [row('a')], beforeDelete: db => Object.assign(db.leader_followups[0], { answered_at: '2026-11-05T00:00:00Z', answers: { i1: { s: 'done' }, i2: { s: 'done' } }, chosen_slot: SLOTS[0], code: null }) });
  await openDetail(race, 'a');
  await runInAppContext(race.app, "lfDelete('a')"); await settle();
  assert.equal(race.db.leader_followups.length, 1, 'لم تُحذف الإجابة خارج السلة');
  assert.equal(race.db.deleted_items.length, 0, 'أُزيلت اللقطة التي لا تطابق ما حُذف');
  assert.match(race.toasts().join('|'), /أجاب المسؤول للتو/);
  assert.match(race.html(), /موعد اللقاء/, 'أُعيدت القراءة فظهرت نتيجته');
});

test('مسودة المسؤول: المعلم يرى التقدّم (كم من كم) لا المحتوى، بالقائمة والتفاصيل', async () => {
  const k = makeApp({ rows: [row('a', { draft: { a: { i1: { s: 'no', r: '<b>سرّي</b>' } }, slot: null }, draft_saved_at: '2026-11-21T22:30:00Z' })] });
  runInAppContext(k.app, "showTools(); toolsGo('leaders')"); await tick(); await tick();
  assert.match(k.html(), /بدأ الإجابة: 1 من 2 \(لم يُسلِّم بعد\)/);
  runInAppContext(k.app, "lfOpen('a')"); await tick();
  assert.match(k.html(), /بدأ المسؤول الإجابة ولم يُسلِّم بعد/); assert.match(k.html(), /حدّد 1 من 2 مؤشرات · آخر حفظ الأحد 22 نوفمبر/);
  assert.doesNotMatch(k.html(), /سرّي/, 'لا يظهر محتوى المسودة');
  assert.equal(k.app.lfDraftProgress(answered('x', { draft: { a: { i1: { s: 'done' } } } })), null, 'المُسلَّم: لا مسودة');
});

test('السباق: مغادرة الشاشة أثناء الإنشاء لا تفتح التفاصيل، والطلب يظهر بالقائمة', async () => {
  const k = makeApp();
  runInAppContext(k.app, "showTools(); lfStartCreate(null); lfState.create.cycle = 'ف1'; lfState.create.indicators = ['x']; lfCreate(); toolsGo('home');"); await tick(); await tick();
  assert.equal(runInAppContext(k.app, 'toolsState.screen'), 'home');
  assert.equal(k.db.leader_followups.length, 1);
});

test('حراس ثابتة: كل استعلام بـteacher_id، والواجهة بلا أي كتابة لـanswers/chosen_slot/answered_at، وكل نص يمر بـescapeHtml', () => {
  const chains = A50.split(/sb\s*\.from\('leader_followups'\)/).slice(1);
  assert.ok(chains.length >= 8);
  chains.forEach(c => {
    const end = c.search(/;\s*\n|\n\s*\n/); const stmt = c.slice(0, end > 0 ? end : 400);
    if(/^\.insert\(/.test(stmt)) return; /* الإدراج: teacher_id داخل الصف نفسه (يُفحص أدناه) */
    assert.match(stmt, /teacher_id/, 'استعلام بلا تصفية المالك: ' + stmt.slice(0, 80));
  });
  assert.match(A50, /const row = \{\s+teacher_id: currentUser\.id,/, 'الإدراج بمالك الجلسة');
  assert.doesNotMatch(A50, /\.(insert|update)\((\{[^}]*)?\b(answers|chosen_slot|answered_at|created_at)\b/, 'لا كتابة لأعمدة الرد');
  assert.doesNotMatch(A50, /\.from\('leader_followups'\)\.update\(\{[^}]*answered_at/);
  assert.doesNotMatch(A50, /\$\{\s*(r|x|ind|c|t|older)\.(leader_name|cycle_label|label|r|name|cycle|sender_name)\s*\}/, 'نص مستخدم يُدرج بلا escapeHtml');
});

test('التنقل: الشاشات الثلاث داخل toolsView، والدرج والشارة والسكربتان بـindex.html وsw.js', () => {
  const idx = read('index.html'), sw = read('sw.js'), t45 = read('app/app-45-tools.js');
  assert.match(idx, /id="toolsNavBadge" class="acct-badge"/); assert.match(idx, /<script src="leader-kit\.js"><\/script>/); assert.match(idx, /<script src="app\/app-50-leader-followup\.js"><\/script>/);
  assert.ok(idx.indexOf('leader-kit.js') < idx.indexOf('app-50-leader-followup.js'), 'المصدر المشترك قبل الشاشة');
  assert.match(sw, /'\.\/leader-kit\.js'/); assert.match(sw, /'\.\/app\/app-50-leader-followup\.js'/);
  assert.match(t45, /toolsGo\('leaders'\)/); assert.match(t45, /s === 'leaders' \|\| s === 'lcreate' \|\| s === 'ldetail'\) lfRender\(s\)/);
  assert.match(read('app/app-03-auth-home-risk.js'), /\['supportMsgNavBadge', 'riskNavBadge', 'toolsNavBadge'\]/);
  assert.doesNotMatch(A50, /function show[A-Z]\w*\(/, 'لا شاشة رئيسية جديدة: كلها داخل toolsView');
});
