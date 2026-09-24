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
const { hashToken, authenticate, buildServer } = require('../api/mcp.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

function makeFakeSupabase(seedByTable){
  function chain(table){
    const filters = [];
    let limitN = null;
    let orderBy = null;
    const rowsFor = () => {
      let rows = (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
      if(orderBy){
        const { col, ascending } = orderBy;
        rows = rows.slice().sort((a, b) => {
          if(a[col] === b[col]) return 0;
          const cmp = a[col] > b[col] ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      if(limitN != null) rows = rows.slice(0, limitN);
      return rows;
    };
    const api = {
      select(){ return api; },
      eq(col, val){ filters.push([col, val]); return api; },
      order(col, opts){ orderBy = { col, ascending: !opts || opts.ascending !== false }; return api; },
      limit(n){ limitN = n; return api; },
      maybeSingle: async () => {
        const rows = rowsFor();
        return { data: rows[0] || null, error: null };
      },
      update(patch){
        return {
          eq(col, val){
            (seedByTable[table] || []).filter(r => r[col] === val).forEach(r => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null });
          }
        };
      },
      then(resolve, reject){
        return Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return { from: chain };
}

describe('hashToken', () => {
  test('نفس النص يعطي نفس التجزئة دومًا', () => {
    assert.equal(hashToken('abc'), hashToken('abc'));
  });
  test('نصوص مختلفة تعطي تجزئات مختلفة', () => {
    assert.notEqual(hashToken('abc'), hashToken('abd'));
  });
});

describe('authenticate — يرفض أي شيء غير رمز صحيح وغير مُلغى', () => {
  const rawToken = 'shahid_pat_test_' + crypto.randomBytes(8).toString('hex');
  function seedWith(revoked){
    return {
      personal_access_tokens: [
        { id: 'tok-1', user_id: 'u1', token_hash: hashToken(rawToken), revoked_at: revoked ? '2026-01-01T00:00:00Z' : null },
      ],
    };
  }

  test('بلا ترويسة Authorization إطلاقًا → null', async () => {
    const supabase = makeFakeSupabase(seedWith(false));
    const result = await authenticate({ headers: {} }, supabase);
    assert.equal(result, null);
  });

  test('ترويسة بلا "Bearer" → null', async () => {
    const supabase = makeFakeSupabase(seedWith(false));
    const result = await authenticate({ headers: { authorization: rawToken } }, supabase);
    assert.equal(result, null);
  });

  test('رمز غير موجود بالقاعدة إطلاقًا → null', async () => {
    const supabase = makeFakeSupabase(seedWith(false));
    const result = await authenticate({ headers: { authorization: 'Bearer shahid_pat_ghost' } }, supabase);
    assert.equal(result, null);
  });

  test('رمز صحيح وغير مُلغى → يرجع user_id صاحبه', async () => {
    const supabase = makeFakeSupabase(seedWith(false));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result, 'u1');
  });

  test('رمز صحيح لكن مُلغى (revoked_at) → null', async () => {
    const supabase = makeFakeSupabase(seedWith(true));
    const result = await authenticate({ headers: { authorization: `Bearer ${rawToken}` } }, supabase);
    assert.equal(result, null);
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
    assert.equal(data.length, 1);
    assert.equal(data[0].lesson_title, 'شاهد للمستخدم الأول');
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
    assert.equal(data.length, 1);
    assert.equal(data[0].element_key, 'a');
    await client.close(); await server.close();
  });
});
