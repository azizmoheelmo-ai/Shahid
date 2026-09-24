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
    let selectOpts = null;
    const matchingRows = () => (seedByTable[table] || []).filter(r => filters.every(([c, v]) => r[c] === v));
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
      return rows;
    };
    const api = {
      select(_cols, opts){ selectOpts = opts || null; return api; },
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
        const count = selectOpts && selectOpts.count === 'exact' ? matchingRows().length : undefined;
        const data = selectOpts && selectOpts.head ? null : rowsFor();
        return Promise.resolve({ data, count, error: null }).then(resolve, reject);
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
