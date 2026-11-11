'use strict';
/* ============================================================
   المتابعات في متصفح حقيقي (Chromium) — بلا دخول ولا قاعدة بيانات
   ------------------------------------------------------------
   الكود والتنسيق الحقيقيان (index.html + app/*.js + style.css)، والقاعدة وهمية داخل الصفحة
   (sb.from يُستبدل بمخزن في الذاكرة، وطلبات Supabase الشبكية تُحجب). الغرض: أخطاء لا تظهر إلا
   في DOM حقيقي، كما وصل للإنتاج فعلًا:
   - تأكيد الحذف فوق نافذة المراجعة كان بلا زر موافقة (3.38).
   - اختيار طالب لمتابعة جديدة كان يقصّ القائمة لأول 25 اسمًا (3.39).
   ============================================================ */
const { test, expect } = require('@playwright/test');

const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function boot(page){
  await page.addInitScript(() => localStorage.setItem('shahid_onboarded_v1', '1'));
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('/');
  await page.waitForFunction(() => typeof openCrmReviewModal === 'function' && typeof fuTabPaint === 'function');
  await page.evaluate(({ today, review }) => {
    /* مخزن وهمي: يطبّق eq/in، ويسجّل كل كتابة بترتيبها */
    const db = window.__db = {
      classroom_followups: [
        { id: 'f1', teacher_id: 'u1', student_id: 's1', section_id: 'A', reason_type: 'absence', reason_text: 'غاب 3 من آخر 8 حصص: الأحد 2/11', review_date: today, status: 'open', group_id: null, agreement: null, baseline: { of: 8, count: 3 }, created_at: '2026-10-07T10:00:00Z' },
        { id: 'f2', teacher_id: 'u1', student_id: 's2', section_id: 'A', reason_type: 'grades', reason_text: 'لم يسلّم 5 من 9 واجبات', review_date: review, status: 'open', group_id: null, agreement: { v: 1, status: 'wants_talk', commitment: null, support: null }, baseline: { category: 'performance', columnIds: ['h'], focus: 'homework', label: 'واجبات', pct: 44 }, created_at: '2026-11-01T10:00:00Z' }
      ],
      classroom_followup_actions: [{ id: 'a1', followup_id: 'f1', teacher_id: 'u1', action_type: 'verbal_warning', note: null, action_date: '2026-10-07' }],
      deleted_items: []
    };
    window.__writes = [];
    sb.from = table => {
      const f = []; let op = 'select', payload = null, single = false;
      const rows = () => (db[table] || []).filter(r => f.every(([c, v]) => Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
      const run = () => {
        if(op === 'insert'){
          window.__writes.push({ op, table, payload });
          const list = (Array.isArray(payload) ? payload : [payload]).map((p, i) => Object.assign({ id: table[0] + Date.now() + i }, p));
          (db[table] = db[table] || []).push(...list);
          return { data: single ? list[0] : list, error: null };
        }
        if(op === 'update'){
          const hit = rows(); hit.forEach(r => Object.assign(r, payload));
          window.__writes.push({ op, table, payload, filters: f.slice() });
          return { data: hit.map(r => ({ id: r.id })), error: null };
        }
        if(op === 'delete'){
          const hit = rows(); db[table] = (db[table] || []).filter(r => !hit.includes(r));
          window.__writes.push({ op, table, filters: f.slice() });
          return { data: null, error: null };
        }
        const r = rows();
        return { data: single ? (r[0] || null) : r, error: null, count: r.length };
      };
      const api = {
        select(){ return api; }, order(){ return api; }, limit(){ return api; }, range(){ return api; }, gt(){ return api; }, gte(){ return api; }, lte(){ return api; }, is(){ return api; },
        eq(c, v){ f.push([c, v]); return api; }, in(c, v){ f.push([c, v]); return api; },
        insert(p){ op = 'insert'; payload = p; return api; }, update(p){ op = 'update'; payload = p; return api; },
        delete(){ op = 'delete'; return api; }, upsert(p){ op = 'insert'; payload = p; return api; },
        single(){ single = true; return Promise.resolve(run()); }, maybeSingle(){ single = true; return Promise.resolve(run()); },
        then(res, rej){ return Promise.resolve(run()).then(res, rej); }
      };
      return api;
    };
    sb.rpc = async () => ({ data: null, error: null });
    currentUser = { id: 'u1' };
    crmGradeLevels = [{ id: 'g2', name: 'ثاني' }, { id: 'g3', name: 'ثالث' }];
    crmSections = [{ id: 'A', name: '6', grade_level_id: 'g2' }, { id: 'B', name: '4', grade_level_id: 'g3' }];
    /* 60 طالبًا: 30 في كل شعبة، أسماء تبدأ بحروف مختلفة (القائمة القديمة كانت تُظهر أول 25 أبجديًا فقط) */
    const first = ['إبراهيم', 'أحمد', 'بدر', 'تركي', 'ثامر', 'جابر', 'حسن', 'خالد', 'راشد', 'زياد', 'سالم', 'شادي', 'صالح', 'ضياء', 'طلال', 'ظافر', 'عمر', 'غازي', 'فهد', 'قاسم', 'كريم', 'لؤي', 'ماجد', 'نواف', 'هاني', 'وليد', 'ياسر', 'يوسف', 'يزن', 'يحيى'];
    crmStudents = [];
    ['A', 'B'].forEach(sec => first.forEach((n, i) => crmStudents.push({ id: sec === 'A' && i === 0 ? 's1' : sec === 'A' && i === 1 ? 's2' : sec + i, full_name: n + ' ' + sec + i, section_id: sec })));
    document.getElementById('classroomView').style.display = 'block';
  }, { today: TODAY, review: plusDays(9) });
}

test('حذف متابعة من نافذة المراجعة: تأكيد بزرّين، ثم لقطة في السلة قبل الحذف', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openCrmReviewModal('f1'));
  await expect(page.locator('#confirmMsg .rv-name')).toHaveText('إبراهيم A0');
  await expect(page.locator('#confirmMsg')).not.toContainText('الأحد 2/11'); /* لا قائمة تواريخ في الرأس */
  await page.locator('#confirmMsg .rv-del').click();
  await expect(page.locator('#confirmMsg')).toContainText('حذف هذه المتابعة؟');
  await expect(page.locator('#confirmOkBtn')).toBeVisible();          /* كان مخفيًا قبل 3.38 */
  await expect(page.locator('#confirmCancelBtn')).toHaveText('إلغاء');
  await page.locator('#confirmOkBtn').click();
  await expect.poll(() => page.evaluate(() => window.__writes.map(w => w.op + ':' + w.table))).toEqual(['insert:deleted_items', 'delete:classroom_followups', 'delete:classroom_attention_dismissals']);
  const del = await page.evaluate(() => window.__writes[1].filters);
  expect(del).toEqual([['id', 'f1'], ['teacher_id', 'u1']]);
});

test('«+ متابعة جديدة»: اختيار فصل يُظهر كل طلابه (لا أول 25)، والبحث يتجاهل الهمزة', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => fuNewFollowup());
  await expect(page.locator('#fuPickBody')).toContainText('اختر فصلًا');
  await page.locator('#fuPickBody .fu-f', { hasText: 'ثالث/4' }).click();
  await expect(page.locator('#fuPickBody .fu-pick-row')).toHaveCount(30);
  await expect(page.locator('#fuPickBody')).toContainText('يحيى B29');
  await page.locator('#fuPickSearch').fill('ابراهيم');
  await expect(page.locator('#fuPickBody .fu-pick-row')).toHaveCount(2);
});

test('شاشة الاتفاق لمتابعة واجبات: خيارات الواجبات، بلا زر «إغلاق» العام، وحفظ مقيَّد بالمعلم والمفتوحة', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openFollowupAgreement('f2'));
  await expect(page.locator('#confirmCancelBtn')).toBeHidden();
  await expect(page.locator('#faRoot .fa-card')).toHaveCount(3);
  await expect(page.locator('#faRoot .fa-card').first()).toHaveText('أسلّم كل واجب في موعده');
  await page.locator('#faRoot .fa-card').first().click();
  await page.locator('#faRoot .fa-card').nth(1).click();
  await expect(page.locator('#faRoot')).toContainText('هذا اتفاقنا');
  await page.locator('#faAgreeBtn').click();
  await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(1);
  const w = await page.evaluate(() => window.__writes[0]);
  expect(w.payload.agreement.commitment).toBe('أسلّم كل واجب في موعده');
  expect(w.filters).toEqual([['teacher_id', 'u1'], ['id', 'f2'], ['status', 'open']]);
  /* نافذة أخرى بعد الاتفاق تستعيد زر الإغلاق */
  await page.evaluate(() => showInfoModal('x'));
  await expect(page.locator('#confirmCancelBtn')).toBeVisible();
});

test('تبويب «متابعة»: «يريد الحديث معك» في «تحتاجك الآن»، وموعد اليوم «مراجعة»', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { document.getElementById('crmTabFollowups').style.display = 'block'; return renderCrmFollowups(); });
  const body = page.locator('#crmFollowupsBody');
  await expect(body.locator('.fu-grp').first()).toHaveText('تحتاجك الآن (2)');
  await expect(body).toContainText('يريد الحديث معك');
  await expect(body.locator('.fu-row', { hasText: 'إبراهيم A0' }).locator('.fu-b')).toHaveText('مراجعة');
  await expect(body.locator('.fu-modes .fu-f', { hasText: 'مقترحون من الدرجات' })).toHaveCount(1);
});

test('تأكيد يُفتح فوق نافذة معلومات يعرض زرّيه دائمًا (حارس showConfirm نفسه)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { showInfoModal('نافذة'); window.__ans = showConfirm('متأكد؟'); });
  await expect(page.locator('#confirmOkBtn')).toBeVisible();
  await expect(page.locator('#confirmCancelBtn')).toHaveText('إلغاء');
  await page.locator('#confirmOkBtn').click();
  expect(await page.evaluate(() => window.__ans)).toBe(true);
});

test('شارة التذكير: العدد على تبويب «متابعة» وأيقونة إدارة الصف (حان موعده + يريد الحديث)', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => { followupVisible = () => true; return fuRefreshBadge(); });
  expect(n).toBe(2); /* f1 موعده اليوم، وf2 طلب الطالب الحديث */
  await expect(page.locator('#crmTabBtnFollowups .fu-tab-badge')).toHaveText('2');
  await expect(page.locator('#classroomNavBadge')).toHaveText('2');
});

test('شريط التبويبات على الجوال: لا اسم مقطوع مع الشارة (360 و390)', async ({ page }) => {
  for(const width of [360, 390]){
    await page.setViewportSize({ width, height: 740 });
    await boot(page);
    const cut = await page.evaluate(() => {
      let p = document.getElementById('classroomView');
      while(p){ p.style.display = 'block'; p = p.parentElement; }
      document.getElementById('crmTabBtnRecord').style.display = '';
      fuRenderBadge(3);
      return [...document.querySelectorAll('#crmTabsBar .crm-tab-btn')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent);
    });
    expect(cut, 'عرض ' + width).toEqual([]);
  }
});
