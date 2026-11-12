'use strict';
/* ============================================================
   صفحة رابط المسؤول (/f/) في متصفح حقيقي — البلاطات التي تنطوي (3.49)
   ------------------------------------------------------------
   الصفحة نفسها من api/f.js (buildLeaderPage)، تُخدَم على مسار /f/ وهمي عبر page.route، والإرسال (POST)
   يُلتقط في الذاكرة. لا خادم ولا قاعدة بيانات. يحرس سلوكًا لا يظهر إلا في DOM حقيقي:
   - «منفذ» يطوي البلاطة ويفتح التالية؛ «لم ينفذ» يبقيها مفتوحة، و«تم» لا يطويها بلا سبب.
   - الإرسال بنقص يعيد فتح الناقص، والإرسال الكامل يرسل القيم الصحيحة ويعرض نسخة الإجابة بعناوين نظيفة.
   ============================================================ */
const { test, expect } = require('@playwright/test');
const F = require('../../api/f.js');

const LABELS = ['سجل الخطة التشغيلية', 'سجل التكليفات', 'سجل اللجان والفرق المدرسية'];
const SLOT = '2026-11-20T10:00';

async function open(page, draft){
  const html = F.buildLeaderPage({ req: { role: 'مدير المدرسة', name: 'فهد', cycle: 'ف1', sender: 'ع',
    indicators: LABELS.map((label, i) => ({ id: 'i' + (i + 1), label })), slots: [SLOT], closesAt: null, draft: draft || null, savedAt: 0 }, taken: [] }, 'N');
  const posts = [];
  await page.route('**/f/testcode', async route => {
    if(route.request().method() === 'POST'){ posts.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.goto('/f/testcode');
  return posts;
}
const folded = page => page.$$eval('fieldset[data-i]', fs => fs.map(f => f.classList.contains('cl') ? 'C' : 'O').join(''));
const tile = (page, i) => page.locator(`fieldset[data-i="i${i}"]`);

test('البلاطات: «منفذ» يطوي ويفتح التالية، و«لم ينفذ» ينتظر السبب قبل «تم»', async ({ page }) => {
  await open(page);
  expect(await folded(page)).toBe('OCC');
  await tile(page, 1).locator('.s-done + span').click();
  expect(await folded(page)).toBe('COC');
  await expect(tile(page, 1).locator('.pv')).toHaveText('منفذ');
  await tile(page, 2).locator('.s-no + span').click();
  expect(await folded(page)).toBe('COC');
  await tile(page, 2).locator('.dn').click();
  await expect(tile(page, 2)).toHaveClass(/miss/);
  expect(await folded(page)).toBe('COC');
  await tile(page, 2).locator('textarea').fill('لم يُحدَّث');
  await tile(page, 2).locator('.dn').click();
  expect(await folded(page)).toBe('CCO');
  await expect(tile(page, 2).locator('.pr')).toHaveText('لم يُحدَّث');
  await tile(page, 1).locator('.tg').click();
  expect(await folded(page)).toBe('OCO');
});

test('الإرسال: الناقص يُعاد فتحه، والكامل يرسل القيم ويعرض نسخة بعناوين نظيفة', async ({ page }) => {
  const posts = await open(page, { a: { i1: { s: 'done' } }, slot: null });
  expect(await folded(page)).toBe('COC');
  await tile(page, 1).locator('.tg').click();
  await tile(page, 1).locator('.tg').click();
  await page.locator('#sb').click();
  expect(await folded(page)).toBe('COO');
  await expect(tile(page, 2)).toHaveClass(/miss/);
  expect(posts).toHaveLength(0);
  await tile(page, 2).locator('.s-done + span').click();
  await tile(page, 3).locator('.s-wip + span').click();
  await tile(page, 3).locator('textarea').fill('قيد الجمع');
  await page.locator(`input[value="${SLOT}"] + span`).click();
  await page.locator('#sb').click();
  await expect(page.locator('#st')).toBeVisible();
  expect(posts[0].a).toEqual({ i1: { s: 'done' }, i2: { s: 'done' }, i3: { s: 'wip', r: 'قيد الجمع' } });
  expect(posts[0].slot).toBe(SLOT);
  await expect(page.locator('#cp li b').first()).toHaveText('1. سجل الخطة التشغيلية');
});
