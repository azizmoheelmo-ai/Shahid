'use strict';
/* اختبارات موصل الذكاء الاصطناعي (api/mcp.js) — بلا أي اتصال شبكي حقيقي:
   عميل Supabase وهمي، وخادم MCP متصل بعميل MCP داخل نفس العملية عبر
   InMemoryTransport (النمط الرسمي بحزمة @modelcontextprotocol/sdk للاختبار).

   التركيز: (1) authenticate() يرفض أي رمز غير صحيح/مُلغى ويقبل الصحيح فقط،
   (2) كل أداة تُرجع بيانات صاحب الرمز فقط حتى لو القاعدة فيها صفوف لمستخدم
   آخر — نفس فحص "لا تعتمد على RLS وحدها" المتّبع ببقية اختبارات المشروع،
   وهنا أكثر إلزامًا لأن هذا الملف يستخدم مفتاح service role الذي يتجاوز
   RLS بالكامل. */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mcp = require('../api/mcp.js');
const { hashToken, authenticate, buildServer, tokenFrom } = mcp;
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

function makeFakeSupabase(seedByTable){
  function chain(table){
    const filters = [];
    let limitN = null;
    let orderBy = null;
    let selectOpts = null;
    let rangeArgs = null;
    const matchingRows = () => (seedByTable[table] || []).filter(r => filters.every(([c, v, fn]) => fn ? fn(r) : r[c] === v));
    const rowsFor = () => {
      let rows = matchingRows();
      if(orderBy){
        const { col, ascending } = orderBy;
        rows = rows.slice().sort((a, b) => {
          if(a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if(limitN != null) rows = rows.slice(0, limitN);
      if(rangeArgs) rows = rows.slice(rangeArgs[0], rangeArgs[1] + 1);
      return rows;
    };
    const api = {
      select(_cols, opts){ selectOpts = opts || null; return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      gte(col, val){ filters.push([col, null, r => r[col] >= val]); return api; },
      order(col, opts){ orderBy = { col, ascending: !opts || opts.ascending !== false }; return api; },
      limit(n){ limitN = n; return api; },
      range(from, to){ rangeArgs = [from, to]; return api; },
      maybeSingle: async () => {
        const rows = rowsFor();
        return { data: rows[0] || null, error: null };
      },
      update(patch){
        const fs = [];
        const b = {
          eq(col, val){ fs.push([col, val]); return b; },
          then(resolve, reject){
            if(seedByTable.__failWrites) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject);
            (seedByTable[table] || []).filter(r => fs.every(([c2, v2]) => r[c2] === v2)).forEach(r => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
        };
        return b;
      },
      insert(row){
        let failed = null;
        if(table === 'audit_log' && seedByTable.__failAudit) failed = { message: 'audit down' };
        else if(seedByTable.__failWrites && table !== 'audit_log') failed = { message: 'boom' };
        const stored = Object.assign({ id: 'new-' + table + '-' + ((seedByTable[table] || []).length + 1), created_at: new Date().toISOString() }, row);
        if(!failed){ (seedByTable[table] = seedByTable[table] || []).push(stored); }
        const res = { data: failed ? null : stored, error: failed };
        const b = { select(){ return b; }, maybeSingle: async () => res, then(resolve, reject){ return Promise.resolve(res).then(resolve, reject); } };
        return b;
      },
      then(resolve, reject){
        const count = selectOpts && selectOpts.count === 'exact' ? matchingRows().length : undefined;
        const data = selectOpts && selectOpts.head ? null : rowsFor();
        return Promise.resolve({ data, count, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  /* محاكاة check_mcp_rate_limit الحقيقية (نفس منطق دالة Postgres): نافذة
     منزلقة مخزَّنة على صف الرمز نفسه بجدول personal_access_tokens. */
  async function rpc(fnName, args){
    if(fnName !== 'check_mcp_rate_limit') return { data: null, error: { message: 'unknown rpc: ' + fnName } };
    const row = (seedByTable.personal_access_tokens || []).find(r => r.id === args.p_token_id);
    if(!row) return { data: false, error: null };
    const now = Date.now();
    const windowStart = row.rate_window_start ? new Date(row.rate_window_start).getTime() : null;
    if(windowStart == null || (now - windowStart) > args.p_window_seconds * 1000){
      row.rate_window_start = new Date(now).toISOString();
      row.rate_window_count = 1;
      return { data: true, error: null };
    }
    if((row.rate_window_count || 0) >= args.p_max_requests) return { data: false, error: null };
    row.rate_window_count = (row.rate_window_count || 0) + 1;
    return { data: true, error: null };
  }
  return { from: chain, rpc };
}

describe('hashToken', () => {
  test('نفس النص يعطي نفس التجزئة دومًا', () => {
    assert.equal(hashToken('abc'), hashToken('abc'));
  });
  test('نصوص مختلفة تعطي تجزئات مختلفة', () => {
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });
});

describe('authenticate — يرفض أي شيء غير رمز صحيح وغير مُلغى/منتهي/متجاوز للحد', () => {
  const rawToken = 'shahid_pat_test_' + crypto.randomBytes(8).toString('hex');
  function seedWith(overrides){
    return {
      personal_access_tokens: [
        Object.assign({ id: 'tok-1', user_id: 'u1', token_hash: hashToken(rawToken), revoked_at: null, expires_at: null }, overrides || {}),
      ],
    };
  }

  test('بلا ترويسة Authorization إطلاقًا → مرفوض', async () => {
    const supabase = makeFakeSupabase(seedWith());
    const result = await authenticate({ headers: {} }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'missing_token');
  });

  test('ترويسة بلا "Bearer" → مرفوض', async () => {
    const supabase = makeFakeSupabase(seedWith());
    const result = await authenticate({ headers: { authorization: rawToken } }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'missing_token');
  });

  test('رمز غير موجود بالقاعدة إطلاقًا → مرفوض', async () => {
    const supabase = makeFakeSupabase(seedWith());
    const result = await authenticate({ headers: { authorization: 'Bearer shahid_pat_ghost' } }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'invalid_token');
  });

  test('رمز صحيح وغير مُلغى وغير منتهٍ → يرجع user_id صاحبه', async () => {
    const supabase = makeFakeSupabase(seedWith());
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, 'u1');
    assert.equal(result.reason, 'ok');
  });

  test('رمز رابط التقويم (نفس شكل shahid_pat_) لا يفتح الموصل → مرفوض كغير موجود', async () => {
    const { CALENDAR_FEED_TOKEN_LABEL } = require('../api/mcp.js');
    const supabase = makeFakeSupabase(seedWith({ label: CALENDAR_FEED_TOKEN_LABEL }));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'invalid_token');
    /* وعبر ?key= بالرابط كذلك */
    const viaUrl = await authenticate({ headers: {}, url: '/api/mcp?key=' + rawToken }, makeFakeSupabase(seedWith({ label: CALENDAR_FEED_TOKEN_LABEL })));
    assert.equal(viaUrl.userId, null);
  });

  test('تصنيف رابط التقويم واحد في الموصل وخادم التقويم والتطبيق', () => {
    const fs = require('node:fs'); const path = require('node:path');
    const { CALENDAR_FEED_TOKEN_LABEL } = require('../api/mcp.js');
    assert.equal(require('../api/calendar-feed.js').CALENDAR_FEED_TOKEN_LABEL, CALENDAR_FEED_TOKEN_LABEL);
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'app', 'app-12-calendar.js'), 'utf8').includes(`const CALENDAR_FEED_TOKEN_LABEL = '${CALENDAR_FEED_TOKEN_LABEL}';`));
  });

  test('رمز موصل عادي بتصنيفه المعتاد يبقى مقبولًا', async () => {
    const supabase = makeFakeSupabase(seedWith({ label: 'موصل الذكاء الاصطناعي' }));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, 'u1');
  });

  test('رمز صحيح لكن مُلغى (revoked_at) → مرفوض', async () => {
    const supabase = makeFakeSupabase(seedWith({ revoked_at: '2026-01-01T00:00:00Z' }));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'revoked_token');
  });

  test('رمز منتهي الصلاحية (expires_at بالماضي) → مرفوض', async () => {
    const supabase = makeFakeSupabase(seedWith({ expires_at: '2020-01-01T00:00:00Z' }));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, null);
    assert.equal(result.reason, 'expired_token');
  });

  test('رمز بتاريخ انتهاء مستقبلي → يبقى مقبولًا', async () => {
    const supabase = makeFakeSupabase(seedWith({ expires_at: '2099-01-01T00:00:00Z' }));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result.userId, 'u1');
  });

  test('تجاوز حد الاستخدام الحقيقي (60 طلبًا/5 دقائق) عبر authenticate() نفسها → الطلب 61 مرفوض بسبب rate_limited', async () => {
    const supabase = makeFakeSupabase(seedWith());
    const req = { headers: { authorization: `Bearer ${rawToken}` } };
    for(let i = 0; i < 60; i++){
      const r = await authenticate(req, supabase);
      assert.equal(r.userId, 'u1', `الطلب رقم ${i + 1} من أصل 60 يجب أن يُقبل`);
    }
    const blocked = await authenticate(req, supabase);
    assert.equal(blocked.userId, null);
    assert.equal(blocked.reason, 'rate_limited');
  });
});

describe('الرمز داخل الرابط (?key=) — لأن خانة "موصل مخصص" بتطبيقات المساعد تقبل عنوانًا فقط', () => {
  const rawToken = 'shahid_pat_' + crypto.randomBytes(32).toString('base64url');
  const seed = () => ({ personal_access_tokens: [{ id: 'tok-1', user_id: 'u1', token_hash: hashToken(rawToken), revoked_at: null, expires_at: null }] });

  test('رمز صحيح بـ?key= بلا أي ترويسة → مقبول ويرجع user_id صاحبه', async () => {
    const r = await authenticate({ headers: {}, url: '/api/mcp?key=' + rawToken }, makeFakeSupabase(seed()));
    assert.equal(r.userId, 'u1');
    assert.equal(r.reason, 'ok');
  });
  test('?key= مُلغى → يبقى مرفوضًا (الإلغاء فوري)', async () => {
    const s = seed(); s.personal_access_tokens[0].revoked_at = '2026-01-01T00:00:00Z';
    const r = await authenticate({ headers: {}, url: '/api/mcp?key=' + rawToken }, makeFakeSupabase(s));
    assert.equal(r.userId, null);
    assert.equal(r.reason, 'revoked_token');
  });
  test('?key= بشكل غير صحيح (ليس من رموزنا) → يُعامَل كرمز مفقود دون استعلام', () => {
    assert.equal(tokenFrom({ headers: {}, url: '/api/mcp?key=abc' }), '');
    assert.equal(tokenFrom({ headers: {}, url: '/api/mcp?key=msh_' + 'a'.repeat(43) }), '');
    assert.equal(tokenFrom({ headers: {}, url: '/api/mcp' }), '');
  });
  test('الترويسة لها الأولوية على ?key=', () => {
    assert.equal(tokenFrom({ headers: { authorization: 'Bearer HDR' }, url: '/api/mcp?key=' + rawToken }), 'HDR');
  });
  test('الترويسة القديمة ما زالت تعمل كما كانت', async () => {
    const r = await authenticate({ headers: { authorization: 'Bearer ' + rawToken }, url: '/api/mcp' }, makeFakeSupabase(seed()));
    assert.equal(r.userId, 'u1');
  });
  test('OPTIONS (preflight) → 204 مع ترويسات CORS، قبل أي فحص بيئة أو رمز', async () => {
    const headers = {}; let status = null, ended = false;
    const res = { setHeader(k, v){ headers[k] = v; }, end(){ ended = true; }, set statusCode(v){ status = v; }, get statusCode(){ return status; } };
    await mcp({ method: 'OPTIONS', headers: {}, url: '/api/mcp' }, res);
    assert.equal(status, 204);
    assert.ok(ended);
    assert.equal(headers['Access-Control-Allow-Origin'], '*');
    assert.match(headers['Access-Control-Allow-Headers'], /authorization/);
  });
});

describe('أدوات الموصل — عزل بيانات كل معلم عن البقية', () => {
  async function connectedClient(userId, supabase){
    const server = buildServer(userId, supabase);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  function textOf(result){
    return JSON.parse(result.content[0].text);
  }

  test('get_my_profile يرجع صف صاحب الرمز فقط، لا صف المعلم الآخر', async () => {
    const seed = {
      profiles: [
        { id: 'u1', full_name: 'معلم الأول', school: 'ثانوية أ', subject: 'رياضيات', duty_type: 'none' },
        { id: 'u2', full_name: 'معلم الثاني', school: 'ثانوية ب', subject: 'علوم', duty_type: 'none' },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'get_my_profile', arguments: {} });
    const data = textOf(result);
    assert.equal(data.full_name, 'معلم الأول');
    assert.notEqual(data.full_name, 'معلم الثاني');
    await client.close(); await server.close();
  });

  test('list_my_shawahid لا يرجع أي شاهد يخص مستخدمًا آخر حتى لو القاعدة فيها بيانات مختلطة', async () => {
    const seed = {
      shawahid: [
        { user_id: 'u1', lesson_title: 'شاهد للمستخدم الأول', element_key: 'a', created_at: '2026-01-01' },
        { user_id: 'u2', lesson_title: 'شاهد للمستخدم الثاني', element_key: 'a', created_at: '2026-01-02' },
        { user_id: 'u2', lesson_title: 'شاهد ثانٍ للمستخدم الثاني', element_key: 'a', created_at: '2026-01-03' },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'list_my_shawahid', arguments: {} });
    const data = textOf(result);
    assert.equal(data.total_count, 1);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].lesson_title, 'شاهد للمستخدم الأول');
    await client.close(); await server.close();
  });

  test('get_my_plan يجمع plan_header وperformance_goals لأحدث سنة، لصاحب الرمز فقط', async () => {
    const seed = {
      plan_header: [
        { user_id: 'u1', cycle_year: '1447-1448', role_title: 'معلم قديم' },
        { user_id: 'u1', cycle_year: '1448-1449', role_title: 'معلم' },
        { user_id: 'u2', cycle_year: '1448-1449', role_title: 'معلم آخر تمامًا' },
      ],
      performance_goals: [
        { user_id: 'u1', cycle_year: '1448-1449', element_label: 'التخطيط للتدريس', goal_order: 0, target_count: 3 },
        { user_id: 'u2', cycle_year: '1448-1449', element_label: 'عنصر يخص معلمًا آخر', goal_order: 0, target_count: 9 },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'get_my_plan', arguments: {} });
    const data = textOf(result);
    assert.equal(data.header.cycle_year, '1448-1449');
    assert.equal(data.goals.length, 1);
    assert.equal(data.goals[0].element_label, 'التخطيط للتدريس');
    await client.close(); await server.close();
  });

  test('list_my_shawahid يحترم limit وelement_key المُمرَّرين', async () => {
    const seed = {
      shawahid: [
        { user_id: 'u1', lesson_title: 'شاهد 1', element_key: 'a', created_at: '2026-01-01' },
        { user_id: 'u1', lesson_title: 'شاهد 2', element_key: 'b', created_at: '2026-01-02' },
        { user_id: 'u1', lesson_title: 'شاهد 3', element_key: 'a', created_at: '2026-01-03' },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'list_my_shawahid', arguments: { element_key: 'a', limit: 1 } });
    const data = textOf(result);
    assert.equal(data.total_count, 2, 'إجمالي المطابق فعليًا بالقاعدة (2 عنصر a)، بصرف النظر عن limit');
    assert.equal(data.items.length, 1, 'العناصر المُرجَعة بالتفصيل مقصوصة بـlimit كما طُلب');
    assert.equal(data.items[0].element_key, 'a');
    await client.close(); await server.close();
  });

  test('list_my_shawahid: total_count لا يتأثر بـlimit حتى لو كان العدد الحقيقي أكبر منه (يمنع عدّ خاطئ لدى العميل)', async () => {
    const seed = {
      shawahid: Array.from({ length: 25 }, (_, i) => ({ user_id: 'u1', lesson_title: `شاهد ${i}`, element_key: 'a', created_at: `2026-01-${String(i + 1).padStart(2, '0')}` })),
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'list_my_shawahid', arguments: {} }); // limit الافتراضي 20
    const data = textOf(result);
    assert.equal(data.total_count, 25);
    assert.equal(data.returned_count, 20);
    assert.equal(data.items.length, 20);
    await client.close(); await server.close();
  });

  test('get_my_coverage_summary يحسب التغطية حسب نوع تكليف المعلم، ويعزل بيانات كل معلم عن غيره', async () => {
    const seed = {
      profiles: [{ id: 'u1', duty_type: 'student_activity' }],
      performance_elements: [
        { key: 'base1', label: 'عنصر أساسي مُغطى', weight: 10, weight_with_duty: 8, required_duty_type: null, active: true },
        { key: 'base2', label: 'عنصر أساسي غير مُغطى', weight: 10, weight_with_duty: 8, required_duty_type: null, active: true },
        { key: 'act1', label: 'عنصر نشاط طلابي', weight: 10, weight_with_duty: 12, required_duty_type: 'student_activity', active: true },
        { key: 'health1', label: 'عنصر توجيه صحي (لا يخصّه)', weight: 10, weight_with_duty: 12, required_duty_type: 'health_guidance', active: true },
      ],
      shawahid: [
        { user_id: 'u1', element_key: 'base1' },
        { user_id: 'u1', element_key: 'act1' },
        { user_id: 'u2', element_key: 'base2' }, // يخص معلمًا آخر تمامًا — لا يجب أن يُحتسب لـu1
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'get_my_coverage_summary', arguments: {} });
    const data = textOf(result);

    // عنصر health1 (خاص بتوجيه صحي) يجب ألا يظهر إطلاقًا لمعلم نشاط طلابي
    assert.equal(data.total_elements, 3);
    assert.equal(data.covered_elements, 2);
    assert.equal(data.total_shawahid, 2, 'شاهد u2 لا يُحتسب ضمن إجمالي شواهد u1');

    const byLabel = Object.fromEntries(data.elements.map(e => [e.label, e]));
    assert.equal(byLabel['عنصر أساسي مُغطى'].covered, true);
    assert.equal(byLabel['عنصر أساسي مُغطى'].shawahid_count, 1);
    assert.equal(byLabel['عنصر أساسي مُغطى'].weight, 8, 'وزن العنصر الأساسي يُستبدل بـweight_with_duty لوجود تكليف إضافي');
    assert.equal(byLabel['عنصر أساسي غير مُغطى'].covered, false);
    assert.equal(byLabel['عنصر أساسي غير مُغطى'].shawahid_count, 0);
    assert.equal(byLabel['عنصر نشاط طلابي'].covered, true);
    assert.equal(byLabel['عنصر توجيه صحي (لا يخصّه)'], undefined);

    await client.close(); await server.close();
  });
});

describe('أدوات إدارة الصف — عزل بيانات كل معلم عن معلم آخر (بيانات طلاب قاصرين)', () => {
  async function connectedClient(userId, supabase){
    const server = buildServer(userId, supabase);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }
  function textOf(result){
    return JSON.parse(result.content[0].text);
  }

  test('list_my_students لا يرجع طلاب معلم آخر، ويستبعد غير النشطين افتراضيًا', async () => {
    const seed = {
      classroom_students: [
        { teacher_id: 'u1', full_name: 'أحمد', student_number: '1', academic_year: '1448', is_active: true },
        { teacher_id: 'u1', full_name: 'خالد', student_number: '2', academic_year: '1448', is_active: false },
        { teacher_id: 'u2', full_name: 'طالب معلم آخر', student_number: '9', academic_year: '1448', is_active: true },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'list_my_students', arguments: {} });
    const data = textOf(result);
    assert.equal(data.total_count, 1, 'يستبعد الطالب غير النشط بالافتراضي، ويستبعد طالب المعلم الآخر');
    assert.equal(data.students[0].full_name, 'أحمد');
    await client.close(); await server.close();
  });

  test('list_my_incidents يقرن اسم الطالب ونوع المخالفة، ولا يرى مخالفات معلم آخر', async () => {
    const seed = {
      classroom_incidents: [
        {
          teacher_id: 'u1', incident_date: '2026-09-01', semester_label: 'الفصل الأول', current_stage: 'warning_1',
          classroom_students: { full_name: 'أحمد' },
          classroom_incident_types: { problem_name: 'الاستهزاء بالمعلم', problem_degree: 5 },
        },
        {
          teacher_id: 'u2', incident_date: '2026-09-02', semester_label: 'الفصل الأول', current_stage: 'warning_1',
          classroom_students: { full_name: 'طالب معلم آخر' },
          classroom_incident_types: { problem_name: 'مخالفة أخرى', problem_degree: 2 },
        },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);
    const result = await client.callTool({ name: 'list_my_incidents', arguments: {} });
    const data = textOf(result);
    assert.equal(data.total_count, 1);
    assert.equal(data.items[0].student_name, 'أحمد');
    assert.equal(data.items[0].problem_name, 'الاستهزاء بالمعلم');
    assert.equal(data.items[0].problem_degree, 5);
    await client.close(); await server.close();
  });

  test('list_my_academic_cases يعزل حالات معلم آخر تمامًا، ويحترم فلتر status', async () => {
    const seed = {
      academic_cases: [
        { teacher_id: 'u1', subject: 'رياضيات', weakness_description: 'ضعف بالجمع', status: 'plan_active', plan_started_at: '2026-09-01', classroom_students: { full_name: 'أحمد' } },
        { teacher_id: 'u1', subject: 'علوم', weakness_description: 'ضعف بالتجارب', status: 'referred', plan_started_at: '2026-09-02', classroom_students: { full_name: 'خالد' } },
        { teacher_id: 'u2', subject: 'لغتي', weakness_description: 'حالة معلم آخر', status: 'plan_active', plan_started_at: '2026-09-01', classroom_students: { full_name: 'طالب آخر' } },
      ],
    };
    const supabase = makeFakeSupabase(seed);
    const { client, server } = await connectedClient('u1', supabase);

    const all = textOf(await client.callTool({ name: 'list_my_academic_cases', arguments: {} }));
    assert.equal(all.total_count, 2, 'يستبعد حالة المعلم الآخر تمامًا');

    const activeOnly = textOf(await client.callTool({ name: 'list_my_academic_cases', arguments: { status: 'plan_active' } }));
    assert.equal(activeOnly.total_count, 1);
    assert.equal(activeOnly.items[0].student_name, 'أحمد');

    await client.close(); await server.close();
  });
});

describe('المرحلة 1: أدوات الدرجات والحضور والواجبات... — قراءة فقط، معزولة لكل معلم', () => {
  async function connectedClient(userId, supabase){
    const server = buildServer(userId, supabase);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }
  const call = async (client, name, args) => JSON.parse((await client.callTool({ name, arguments: args || {} })).content[0].text);

  /* بيانات معلمين: u1 (صاحب الرمز) وu2 (غريب) — كل جدول فيه صفوف للاثنين */
  const seed = () => ({
    classroom_grade_levels: [{ id: 'gl1', teacher_id: 'u1', name: 'الأول المتوسط' }, { id: 'gl2', teacher_id: 'u2', name: 'غريب' }],
    classroom_sections: [{ id: 's1', teacher_id: 'u1', grade_level_id: 'gl1', name: '1' }, { id: 's2', teacher_id: 'u2', grade_level_id: 'gl2', name: '9' }],
    classroom_students: [
      { id: 'st1', teacher_id: 'u1', full_name: 'أحمد', section_id: 's1', is_active: true },
      { id: 'st2', teacher_id: 'u1', full_name: 'خالد', section_id: 's1', is_active: true },
      { id: 'st9', teacher_id: 'u2', full_name: 'طالب غريب', section_id: 's2', is_active: true },
    ],
    classroom_grade_columns: [
      { id: 'c1', teacher_id: 'u1', section_id: 's1', semester: '1', name: 'اختبار 1', category: 'exam', max_score: 20, position: 1 },
      { id: 'c9', teacher_id: 'u2', section_id: 's2', semester: '1', name: 'عمود غريب', category: 'exam', max_score: 50, position: 1 },
    ],
    classroom_grade_scores: [
      { id: 'g1', teacher_id: 'u1', column_id: 'c1', student_id: 'st1', score: 18 },
      { id: 'g2', teacher_id: 'u1', column_id: 'c1', student_id: 'st2', score: 10 },
      { id: 'g9', teacher_id: 'u2', column_id: 'c9', student_id: 'st9', score: 45 },
    ],
    classroom_grade_period_scores: [],
    classroom_lessons: [
      { id: 'l1', teacher_id: 'u1', section_id: 's1', lesson_date: '2026-09-01', period: 1 },
      { id: 'l2', teacher_id: 'u1', section_id: 's1', lesson_date: '2026-09-10', period: 2 },
      { id: 'l9', teacher_id: 'u2', section_id: 's2', lesson_date: '2026-09-01', period: 1 },
    ],
    classroom_attendance: [
      { id: 'a1', teacher_id: 'u1', lesson_id: 'l1', student_id: 'st1', status: 'absent' },
      { id: 'a2', teacher_id: 'u1', lesson_id: 'l2', student_id: 'st1', status: 'late' },
      { id: 'a3', teacher_id: 'u1', lesson_id: 'l1', student_id: 'st2', status: 'absent' },
      { id: 'a9', teacher_id: 'u2', lesson_id: 'l9', student_id: 'st9', status: 'absent' },
    ],
    classroom_homework: [{ id: 'h1', teacher_id: 'u1', section_id: 's1', semester: '1', title: 'واجب 1', due_date: '2026-09-05' }, { id: 'h9', teacher_id: 'u2', section_id: 's2', semester: '1', title: 'واجب غريب', due_date: '2026-09-05' }],
    classroom_homework_status: [{ id: 'hs1', teacher_id: 'u1', homework_id: 'h1', student_id: 'st1', status: 'submitted' }, { id: 'hs9', teacher_id: 'u2', homework_id: 'h9', student_id: 'st9', status: 'late' }],
    classroom_tasks: [{ id: 't1', teacher_id: 'u1', section_id: 's1', semester: '1', title: 'مهمة 1', max_score: 10 }, { id: 't9', teacher_id: 'u2', section_id: 's2', semester: '1', title: 'مهمة غريبة', max_score: 10 }],
    classroom_task_students: [{ id: 'ts1', teacher_id: 'u1', task_id: 't1', student_id: 'st1', score: 9 }, { id: 'ts9', teacher_id: 'u2', task_id: 't9', student_id: 'st9', score: 3 }],
    classroom_custom_tools: [{ id: 'tl1', teacher_id: 'u1', name: 'مشاركة' }, { id: 'tl9', teacher_id: 'u2', name: 'أداة غريبة' }],
    classroom_tool_marks: [{ id: 'm1', teacher_id: 'u1', tool_id: 'tl1', student_id: 'st1', section_id: 's1', mark_date: '2026-09-02', value: 1 }, { id: 'm9', teacher_id: 'u2', tool_id: 'tl9', student_id: 'st9', section_id: 's2', mark_date: '2026-09-02', value: 1 }],
    classroom_followups: [{ id: 'f1', teacher_id: 'u1', student_id: 'st1', section_id: 's1', reason_type: 'absence', status: 'open' }, { id: 'f9', teacher_id: 'u2', student_id: 'st9', section_id: 's2', reason_type: 'absence', status: 'open' }],
    classroom_followup_actions: [{ id: 'fa1', teacher_id: 'u1', followup_id: 'f1', action_type: 'call', note: 'اتصال' }, { id: 'fa9', teacher_id: 'u2', followup_id: 'f9', action_type: 'call', note: 'سرّي غريب' }],
    classroom_positive_notes: [{ id: 'pn1', teacher_id: 'u1', student_id: 'st1', note_date: '2026-09-03', note_text: 'متميز' }, { id: 'pn9', teacher_id: 'u2', student_id: 'st9', note_date: '2026-09-03', note_text: 'غريب' }],
    classroom_private_notes: [{ id: 'pv1', teacher_id: 'u1', student_id: 'st1', body: 'سرّي لي' }, { id: 'pv9', teacher_id: 'u2', student_id: 'st9', body: 'سرّي غريب' }],
    classroom_timetable_slots: [{ id: 'sl1', teacher_id: 'u1', section_id: 's1', weekday: 1, period: 1 }, { id: 'sl9', teacher_id: 'u2', section_id: 's2', weekday: 2, period: 2 }],
    activity_programs: [{ id: 'p1', user_id: 'u1', name: 'برنامجي' }, { id: 'p9', user_id: 'u2', name: 'برنامج غريب' }],
    lesson_plans: [{ id: 'lp1', user_id: 'u1', title: 'خطتي', status: 'planned' }, { id: 'lp9', user_id: 'u2', title: 'خطة غريبة', status: 'planned' }],
    tasks: [{ id: 'tk1', user_id: 'u1', title: 'مهمتي', done: false }, { id: 'tk9', user_id: 'u2', title: 'مهمة غريبة', done: false }],
    shawahid: [{ id: 'sh1', user_id: 'u1' }, { id: 'sh9', user_id: 'u2' }],
  });
  const leaked = obj => /غريب|st9/.test(JSON.stringify(obj));

  test('كل أداة جديدة لا تسرّب أي صف لمعلم آخر (عزل صريح بـteacher_id/user_id)', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const calls = [
      ['get_my_overview'], ['list_my_sections'], ['list_my_grades', { include_scores: true }], ['list_my_attendance'], ['list_my_homework'],
      ['list_my_class_tasks'], ['list_my_tool_marks'], ['list_my_followups'], ['list_my_notes', { include_private: true }],
      ['get_my_timetable'], ['list_my_programs'], ['list_my_lesson_plans'], ['list_my_personal_tasks'],
    ];
    for(const [name, args] of calls){
      const data = await call(client, name, args);
      assert.equal(data.error, undefined, name + ' يجب ألا يفشل: ' + JSON.stringify(data));
      assert.equal(leaked(data), false, name + ' سرّب بيانات معلم آخر: ' + JSON.stringify(data));
    }
    await client.close(); await server.close();
  });

  test('get_my_overview يعدّ صفوف صاحب الرمز فقط', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const d = await call(client, 'get_my_overview');
    assert.equal(d.students, 2); assert.equal(d.attendance_records, 3); assert.equal(d.grade_columns, 1);
    assert.equal(d.shawahid, 1); assert.equal(d.personal_tasks, 1);
    await client.close(); await server.close();
  });

  test('list_my_grades: درجات الطلاب بأسمائهم + المتوسط + المجاميع الخام', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const d = await call(client, 'list_my_grades', { section_id: 's1' });
    assert.equal(d.total_columns, 1);
    assert.equal(d.columns[0].average, 14);
    assert.deepEqual(d.columns[0].scores.map(x => [x.student, x.score]).sort(), [['أحمد', 18], ['خالد', 10]]);
    assert.deepEqual(d.student_raw_totals.map(x => [x.student, x.raw_sum, x.raw_max]).sort(), [['أحمد', 18, 20], ['خالد', 10, 20]]);
    const byName = await call(client, 'list_my_grades', { student_name: 'احمد' });
    assert.equal(byName.columns[0].scores.length, 1, 'مطابقة الاسم تتجاهل الهمزة');
    await client.close(); await server.close();
  });

  test('list_my_grades بلا section_id يرجع ملخصًا بلا درجات تفصيلية افتراضيًا', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const d = await call(client, 'list_my_grades');
    assert.equal(d.columns[0].scores, undefined);
    assert.equal(d.student_raw_totals, undefined);
    await client.close(); await server.close();
  });

  test('list_my_attendance: ملخص لكل طالب وفلتر التاريخ والحالة، وtotal_count لا يتأثر بـlimit', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const all = await call(client, 'list_my_attendance', { limit: 1 });
    assert.equal(all.total_records, 3);
    assert.equal(all.returned_count, 1);
    const ahmad = all.per_student_summary.find(x => x.student === 'أحمد');
    assert.equal(ahmad.absent, 1); assert.equal(ahmad.late, 1);
    const ranged = await call(client, 'list_my_attendance', { from_date: '2026-09-05' });
    assert.equal(ranged.total_records, 1);
    assert.equal(ranged.records[0].status, 'late');
    const onlyAbs = await call(client, 'list_my_attendance', { status: 'absent' });
    assert.equal(onlyAbs.total_records, 2);
    await client.close(); await server.close();
  });

  test('list_my_notes: الملاحظات الخاصة لا تُعرض إلا بطلب صريح', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const d = await call(client, 'list_my_notes');
    assert.equal(d.private_notes, undefined);
    assert.equal(d.positive_count, 1);
    const withPriv = await call(client, 'list_my_notes', { include_private: true });
    assert.equal(withPriv.private_notes.length, 1);
    await client.close(); await server.close();
  });

  test('الجلب مُرقَّم: أكثر من 1000 صف لا تُقصّ بصمت', async () => {
    const s = seed();
    s.classroom_attendance = Array.from({ length: 2500 }, (_, i) => ({ id: 'x' + String(i).padStart(5, '0'), teacher_id: 'u1', lesson_id: 'l1', student_id: 'st1', status: 'absent' }));
    const { client, server } = await connectedClient('u1', makeFakeSupabase(s));
    const d = await call(client, 'list_my_attendance');
    assert.equal(d.total_records, 2500);
    await client.close(); await server.close();
  });

  test('لا أداة كتابة: كل الأدوات المسجَّلة أسماؤها قراءة فقط', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()));
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 20);
    for(const t of tools) assert.match(t.name, /^(get|list)_/, 'أداة غير قراءة: ' + t.name);
    await client.close(); await server.close();
  });
});

describe('المرحلة 2: أدوات التعديل — رمز خاص، معاينة إلزامية، تدقيق، عزل', () => {
  const { WRITE_LIMIT } = require('../api/_mcp-write.js');
  async function connectedClient(userId, supabase, canWrite){
    const server = buildServer(userId, supabase, { canWrite });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }
  const call = async (client, name, args) => JSON.parse((await client.callTool({ name, arguments: args || {} })).content[0].text);
  const WRITE_TOOLS = ['record_attendance', 'set_grades', 'set_homework_status', 'set_class_task_scores', 'add_positive_note', 'add_personal_task', 'update_personal_task'];

  const seed = () => ({
    classroom_grade_levels: [{ id: 'gl1', teacher_id: 'u1', name: 'الأول' }, { id: 'gl2', teacher_id: 'u2', name: 'غريب' }],
    classroom_sections: [{ id: 's1', teacher_id: 'u1', grade_level_id: 'gl1', name: '1' }, { id: 's2', teacher_id: 'u2', grade_level_id: 'gl2', name: '9' }],
    classroom_students: [
      { id: 'st1', teacher_id: 'u1', full_name: 'أحمد علي', section_id: 's1', is_active: true },
      { id: 'st2', teacher_id: 'u1', full_name: 'خالد سعد', section_id: 's1', is_active: true },
      { id: 'st3', teacher_id: 'u1', full_name: 'أحمد سالم', section_id: 's1', is_active: true },
      { id: 'st9', teacher_id: 'u2', full_name: 'طالب غريب', section_id: 's2', is_active: true },
    ],
    classroom_lessons: [{ id: 'l1', teacher_id: 'u1', section_id: 's1', lesson_date: '2026-09-01', period: 1 }],
    classroom_attendance: [{ id: 'a1', teacher_id: 'u1', lesson_id: 'l1', student_id: 'st2', status: 'late' }, { id: 'a9', teacher_id: 'u2', lesson_id: 'l9', student_id: 'st9', status: 'absent' }],
    classroom_grade_columns: [
      { id: 'c1', teacher_id: 'u1', section_id: 's1', semester: '1', name: 'اختبار قصير', kind: 'manual', max_score: 20 },
      { id: 'c2', teacher_id: 'u1', section_id: 's1', semester: '1', name: 'واجبات', kind: 'homework', max_score: 10 },
      { id: 'c3', teacher_id: 'u1', section_id: 's1', semester: '1', name: 'اختبار فترات', kind: 'manual', max_score: 20 },
      { id: 'c9', teacher_id: 'u2', section_id: 's2', semester: '1', name: 'اختبار قصير', kind: 'manual', max_score: 20 },
    ],
    classroom_grade_scores: [{ id: 'g1', teacher_id: 'u1', column_id: 'c1', student_id: 'st1', score: 12 }, { id: 'g9', teacher_id: 'u2', column_id: 'c9', student_id: 'st9', score: 5 }],
    classroom_grade_period_scores: [{ id: 'pp1', teacher_id: 'u1', column_id: 'c3', student_id: 'st1', period: 1, score: 10 }],
    classroom_homework: [{ id: 'h1', teacher_id: 'u1', section_id: 's1', title: 'واجب الوحدة 1' }],
    classroom_homework_status: [],
    classroom_tasks: [{ id: 't1', teacher_id: 'u1', section_id: 's1', title: 'مهمة 1', max_score: 10 }],
    classroom_task_students: [{ id: 'ts1', teacher_id: 'u1', task_id: 't1', student_id: 'st1', score: null }],
    classroom_positive_notes: [],
    tasks: [{ id: 'tk1', user_id: 'u1', title: 'تحضير الدرس', done: false, priority: 'medium' }, { id: 'tk9', user_id: 'u2', title: 'تحضير الدرس', done: false, priority: 'medium' }],
    audit_log: [],
  });
  const attendArgs = () => ({ section_id: 's1', lesson_date: '2026-09-01', period: 1, entries: [{ student_name: 'أحمد علي', status: 'absent' }] });

  test('رمز القراءة لا يرى أي أداة تعديل، ورمز التعديل يراها (وبلا أي أداة حذف)', async () => {
    const r = await connectedClient('u1', makeFakeSupabase(seed()), false);
    const names = (await r.client.listTools()).tools.map(t => t.name);
    for(const w of WRITE_TOOLS) assert.ok(!names.includes(w), 'ظهرت أداة تعديل لرمز قراءة: ' + w);
    await r.client.close(); await r.server.close();

    const w = await connectedClient('u1', makeFakeSupabase(seed()), true);
    const wnames = (await w.client.listTools()).tools.map(t => t.name);
    for(const x of WRITE_TOOLS) assert.ok(wnames.includes(x), 'غابت أداة: ' + x);
    assert.ok(!wnames.some(n => /delete|remove|drop|clear/i.test(n)), 'لا أداة حذف');
    await w.client.close(); await w.server.close();
  });

  test('نوع الرمز من بادئته: shahid_rw_ يكتب، shahid_pat_ لا يكتب', async () => {
    const { canWriteToken } = require('../api/mcp.js');
    assert.equal(canWriteToken('shahid_rw_' + 'a'.repeat(43)), true);
    assert.equal(canWriteToken('shahid_pat_' + 'a'.repeat(43)), false);
    const rawRw = 'shahid_rw_' + crypto.randomBytes(32).toString('base64url');
    const s = { personal_access_tokens: [{ id: 'tk', user_id: 'u1', token_hash: hashToken(rawRw), revoked_at: null, expires_at: null }] };
    const r = await authenticate({ headers: {}, url: '/api/mcp?key=' + rawRw }, makeFakeSupabase(s));
    assert.equal(r.userId, 'u1'); assert.equal(r.canWrite, true);
  });

  test('المعاينة لا تكتب شيئًا ولا تسجّل تدقيقًا، وتُرجع confirm_token', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const p = await call(client, 'record_attendance', attendArgs());
    assert.equal(p.preview, true); assert.equal(p.saved, false);
    assert.equal(p.changes[0].before, 'حاضر (لا سجل)'); assert.equal(p.changes[0].after, 'absent');
    assert.ok(p.confirm_token);
    assert.equal(db.classroom_attendance.length, 2, 'لم يُكتب شيء');
    assert.equal(db.audit_log.length, 0);
    await client.close(); await server.close();
  });

  test('حفظ بلا confirm_token أو بتوكن لمدخلات مختلفة → مرفوض ولا يكتب', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const noTok = await call(client, 'record_attendance', { ...attendArgs(), save: true });
    assert.equal(noTok.saved, false); assert.match(noTok.error, /معاينة/);
    const p = await call(client, 'record_attendance', attendArgs());
    const other = { ...attendArgs(), entries: [{ student_name: 'أحمد علي', status: 'late' }] };
    const wrong = await call(client, 'record_attendance', { ...other, save: true, confirm_token: p.confirm_token });
    assert.equal(wrong.saved, false);
    assert.equal(db.classroom_attendance.length, 2);
    await client.close(); await server.close();
  });

  test('توكن منتهي (أقدم من 10 دقائق) أو مزوَّر → مرفوض', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const real = Date.now;
    Date.now = () => real() - 11 * 60 * 1000;
    const p = await call(client, 'record_attendance', attendArgs());
    Date.now = real;
    const exp = await call(client, 'record_attendance', { ...attendArgs(), save: true, confirm_token: p.confirm_token });
    assert.equal(exp.saved, false);
    const forged = await call(client, 'record_attendance', { ...attendArgs(), save: true, confirm_token: Math.floor(Date.now() / 1000) + '.' + 'a'.repeat(64) });
    assert.equal(forged.saved, false);
    assert.equal(db.classroom_attendance.length, 2);
    await client.close(); await server.close();
  });

  test('معاينة ثم حفظ ناجح: يُكتب الغياب ويُسجَّل audit قبل التنفيذ بالقيم القديمة والجديدة', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const args = { section_id: 's1', lesson_date: '2026-09-01', period: 1, entries: [{ student_name: 'أحمد علي', status: 'absent' }, { student_name: 'خالد', status: 'absent' }] };
    const p = await call(client, 'record_attendance', args);
    const s = await call(client, 'record_attendance', { ...args, save: true, confirm_token: p.confirm_token });
    assert.equal(s.saved, true); assert.equal(s.applied_count, 2);
    assert.equal(db.classroom_attendance.find(a => a.student_id === 'st1').status, 'absent');
    assert.equal(db.classroom_attendance.find(a => a.id === 'a1').status, 'absent', 'تعديل خالد من late إلى absent');
    assert.equal(db.audit_log.length, 1);
    assert.equal(db.audit_log[0].action, 'mcp_write'); assert.equal(db.audit_log[0].performed_by, 'u1');
    const ch = db.audit_log[0].details.changes;
    assert.ok(ch.some(c => c.before === 'late' && c.after === 'absent'));
    await client.close(); await server.close();
  });

  test('حصة غير موجودة تُنشأ عند الحفظ، والتكرار نفسه بلا تغيير (no-op)', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const args = { section_id: 's1', lesson_date: '2026-09-02', period: 3, entries: [{ student_name: 'خالد سعد', status: 'late' }] };
    const p = await call(client, 'record_attendance', args);
    assert.equal(p.changes.length, 2, 'إنشاء الحصة + سجل الحضور');
    await call(client, 'record_attendance', { ...args, save: true, confirm_token: p.confirm_token });
    assert.equal(db.classroom_lessons.filter(l => l.teacher_id === 'u1').length, 2);
    const att = db.classroom_attendance.find(a => a.lesson_id !== 'l1' && a.student_id === 'st2');
    assert.ok(att && att.teacher_id === 'u1', 'السجل رُبط بالحصة الجديدة بمعرّف المعلم');
    const again = await call(client, 'record_attendance', args);
    assert.equal(again.changes_count, 0, 'لا تغيير مطلوب');
    assert.equal(again.confirm_token, undefined);
    await client.close(); await server.close();
  });

  test('عزل: لا يُكتب على طالب/شعبة/صفوف معلم آخر مهما كانت المدخلات', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const foreignSection = await call(client, 'record_attendance', { ...attendArgs(), section_id: 's2' });
    assert.match(foreignSection.error, /الشعبة غير موجودة/);
    const foreignStudent = await call(client, 'record_attendance', { ...attendArgs(), entries: [{ student_name: 'طالب غريب', status: 'absent' }] });
    assert.match(foreignStudent.error, /لا طالب/);
    const foreignCol = await call(client, 'set_grades', { section_id: 's2', column_name: 'اختبار قصير', entries: [{ student_name: 'طالب غريب', score: 1 }] });
    assert.match(foreignCol.error, /الشعبة غير موجودة/);
    const before = JSON.stringify(db.classroom_grade_scores.filter(r => r.teacher_id === 'u2'));
    const tk = await call(client, 'update_personal_task', { match_title: 'تحضير الدرس', done: true });
    await call(client, 'update_personal_task', { match_title: 'تحضير الدرس', done: true, save: true, confirm_token: tk.confirm_token });
    assert.equal(db.tasks.find(t => t.id === 'tk1').done, true);
    assert.equal(db.tasks.find(t => t.id === 'tk9').done, false, 'مهمة المعلم الآخر لم تُمَسّ رغم تطابق العنوان');
    assert.equal(JSON.stringify(db.classroom_grade_scores.filter(r => r.teacher_id === 'u2')), before);
    await client.close(); await server.close();
  });

  test('اسم طالب غامض (أحمد) أو مكرَّر بالطلب → مرفوض بدل تخمين', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const amb = await call(client, 'record_attendance', { ...attendArgs(), entries: [{ student_name: 'أحمد', status: 'absent' }] });
    assert.match(amb.error, /أكثر من طالب/);
    const dup = await call(client, 'record_attendance', { ...attendArgs(), entries: [{ student_name: 'أحمد علي', status: 'absent' }, { student_name: 'احمد علي', status: 'late' }] });
    assert.match(dup.error, /مكرَّر/);
    await client.close(); await server.close();
  });

  test('set_grades: يرفض العمود المحسوب والعمود بفترات والدرجة فوق العظمى، ويقبل اليدوي مع before/after', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const base = { section_id: 's1', entries: [{ student_name: 'أحمد علي', score: 15 }] };
    assert.match((await call(client, 'set_grades', { ...base, column_name: 'واجبات' })).error, /محسوب تلقائيًا/);
    assert.match((await call(client, 'set_grades', { ...base, column_name: 'اختبار فترات' })).error, /الفترات/);
    assert.match((await call(client, 'set_grades', { section_id: 's1', column_name: 'اختبار قصير', entries: [{ student_name: 'أحمد علي', score: 25 }] })).error, /أكبر من الدرجة العظمى/);
    const args = { ...base, column_name: 'اختبار قصير', entries: [{ student_name: 'أحمد علي', score: 15 }, { student_name: 'خالد سعد', score: 7 }] };
    const p = await call(client, 'set_grades', args);
    assert.equal(p.changes[0].before, 12); assert.equal(p.changes[0].after, 15);
    assert.equal(p.changes[1].before, null);
    const s = await call(client, 'set_grades', { ...args, save: true, confirm_token: p.confirm_token });
    assert.equal(s.applied_count, 2);
    assert.equal(db.classroom_grade_scores.find(r => r.id === 'g1').score, 15);
    assert.ok(db.classroom_grade_scores.find(r => r.student_id === 'st2' && r.column_id === 'c1' && r.teacher_id === 'u1' && r.score === 7));
    await client.close(); await server.close();
  });

  test('تجاوز حد التعديلات (20 حفظًا/5 دقائق) → مرفوض ولا يكتب', async () => {
    const db = seed();
    for(let i = 0; i < WRITE_LIMIT; i++) db.audit_log.push({ action: 'mcp_write', performed_by: 'u1', created_at: new Date().toISOString() });
    const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const p = await call(client, 'record_attendance', attendArgs());
    const s = await call(client, 'record_attendance', { ...attendArgs(), save: true, confirm_token: p.confirm_token });
    assert.equal(s.saved, false); assert.match(s.error, /حد التعديلات/);
    assert.equal(db.classroom_attendance.length, 2);
    await client.close(); await server.close();
  });

  test('فشل تسجيل التدقيق → لا يُنفَّذ أي تعديل (fail-closed)', async () => {
    const db = seed(); db.__failAudit = true;
    const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const p = await call(client, 'record_attendance', attendArgs());
    const s = await call(client, 'record_attendance', { ...attendArgs(), save: true, confirm_token: p.confirm_token });
    assert.equal(s.saved, false); assert.match(s.error, /التدقيق/);
    assert.equal(db.classroom_attendance.length, 2);
    await client.close(); await server.close();
  });

  test('الواجبات، المهمة الأدائية، الملاحظة الإيجابية، المهام الشخصية', async () => {
    const db = seed(); const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const run = async (name, args) => { const p = await call(client, name, args); assert.ok(p.confirm_token, name + ': ' + JSON.stringify(p)); return call(client, name, { ...args, save: true, confirm_token: p.confirm_token }); };

    const hw = await run('set_homework_status', { section_id: 's1', homework_title: 'واجب الوحدة', entries: [{ student_name: 'خالد', status: 'submitted' }] });
    assert.equal(hw.saved, true);
    assert.equal(db.classroom_homework_status[0].homework_id, 'h1'); assert.equal(db.classroom_homework_status[0].teacher_id, 'u1');

    const notInTask = await call(client, 'set_class_task_scores', { section_id: 's1', task_title: 'مهمة 1', entries: [{ student_name: 'خالد', score: 5 }] });
    assert.match(notInTask.error, /غير مضاف/);
    const ts = await run('set_class_task_scores', { section_id: 's1', task_title: 'مهمة 1', entries: [{ student_name: 'أحمد علي', score: 9 }] });
    assert.equal(ts.saved, true); assert.equal(db.classroom_task_students[0].score, 9);
    assert.match((await call(client, 'set_class_task_scores', { section_id: 's1', task_title: 'مهمة 1', entries: [{ student_name: 'أحمد علي', score: 11 }] })).error, /أكبر/);

    const note = await run('add_positive_note', { student_name: 'خالد سعد', note_text: 'مشاركة ممتازة', note_date: '2026-09-03' });
    assert.equal(note.saved, true); assert.equal(db.classroom_positive_notes.length, 1);
    const dupNote = await call(client, 'add_positive_note', { student_name: 'خالد سعد', note_text: 'مشاركة ممتازة', note_date: '2026-09-03' });
    assert.equal(dupNote.changes_count, 0, 'لا تكرار');

    const task = await run('add_personal_task', { title: 'تصحيح الدفاتر', priority: 'high', due_date: '2026-09-10' });
    assert.equal(task.saved, true);
    assert.ok(db.tasks.find(t => t.title === 'تصحيح الدفاتر' && t.user_id === 'u1'));
    await client.close(); await server.close();
  });

  test('التعديل مثبَّت على صاحب الرمز حتى لو تطابق المعرّف مع صف معلم آخر (دفاع بالعمق)', async () => {
    const db = seed();
    db.tasks = [{ id: 'same', user_id: 'u1', title: 'مهمة مشتركة', done: false, priority: 'medium' }, { id: 'same', user_id: 'u2', title: 'مهمة مشتركة', done: false, priority: 'medium' }];
    const { client, server } = await connectedClient('u1', makeFakeSupabase(db), true);
    const args = { match_title: 'مهمة مشتركة', done: true };
    const p = await call(client, 'update_personal_task', args);
    await call(client, 'update_personal_task', { ...args, save: true, confirm_token: p.confirm_token });
    assert.equal(db.tasks.find(t => t.user_id === 'u1').done, true);
    assert.equal(db.tasks.find(t => t.user_id === 'u2').done, false);
    await client.close(); await server.close();
  });

  test('الأدوات المسجَّلة للكتابة قائمة بيضاء محدّدة (لا أداة جديدة بلا اختبار)', async () => {
    const { client, server } = await connectedClient('u1', makeFakeSupabase(seed()), true);
    const names = (await client.listTools()).tools.map(t => t.name).filter(n => !/^(get|list)_/.test(n)).sort();
    assert.deepEqual(names, WRITE_TOOLS.slice().sort());
    await client.close(); await server.close();
  });
});
