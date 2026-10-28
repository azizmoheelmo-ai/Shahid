'use strict';
/* ============================================================
   صفحة الشواهد (v2.4): ملخص التغطية بحلقة، بطاقة لكل معيار بالترتيب الرسمي
   مع "+ أضف أول شاهد" للفارغ، و"تصدير الكل" داخل ⋯، والبحث من 🔍.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');
const get = (app, e) => runInAppContext(app, e);

function client(recs){
  return { from(){ const a = { select: () => a, eq: () => a, order: () => a, range: () => a, then: (r) => Promise.resolve({ data: recs, error: null }).then(r) }; return a; },
    rpc(){ return Promise.resolve({ data: null, error: null }); }, auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) } };
}

async function render(recs, opts){
  const app = loadApp({ supabaseClient: client(recs), currentUser: { id: 'u1' } });
  runInAppContext(app, `elementSelect.options = [
      { value: 'b', textContent: 'المعيار ب (10%)' }, { value: 'a', textContent: 'المعيار أ (5%)' }, { value: 'c', textContent: '<img src=x> (10%)' }];
    window.__b = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'listBody' ? window.__b : _g(id);`);
  await app.loadMyShawahid();
  return { app, html: get(app, 'window.__b.innerHTML') };
}

test('ملخص التغطية + الترتيب الرسمي + "أضف أول شاهد" للفارغ فقط', async () => {
  const recs = [{ id: '1', user_id: 'u1', element_key: 'a', element_label: 'المعيار أ (5%)', created_at: '2026-10-01', cycle_stage: 'planning', cycle_year: 'x' },
    { id: '2', user_id: 'u1', element_key: 'a', element_label: 'المعيار أ (5%)', created_at: '2026-10-02', cycle_stage: 'planning', cycle_year: 'x' }];
  const { html } = await render(recs);
  assert.match(html, /غطّيت 1 من 3 معيارًا/);
  assert.match(html, /<i>1\/3<\/i>/);
  assert.match(html, /شاهدان/);
  assert.ok(html.indexOf('المعيار ب') < html.indexOf('المعيار أ'), 'الترتيب الرسمي لا حسب العدد');
  assert.equal((html.match(/أضف أول شاهد/g) || []).length, 2, 'المعياران الفارغان');
  assert.match(html, /addShahidForElement\('b'\)/);
  assert.doesNotMatch(html, /<img src=x>/, 'اسم المعيار مهرّب');
});

test('الفلترة تُخفي الملخص، وتصدير الكل داخل ⋯ والبحث من 🔍', async () => {
  const { app } = await render([]);
  runInAppContext(app, `document.getElementById('shahidSearch').value = 'xyz'; myRecords = [{ id: '1', element_key: 'a', lesson_title: 'xyz' }];`);
  app.filterMyShawahid();
  assert.doesNotMatch(get(app, 'window.__b.innerHTML'), /غطّيت/);
  assert.equal(get(app, `document.getElementById('filterSummary').style.display`), 'block');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  /* 🔍 و⋯ في الشريط العلوي بجانب دائرة الحساب (لا في رأس بطاقة القائمة) */
  const head = html.slice(html.indexOf('id="shTopActions"'), html.indexOf('class="tb-acct"'));
  assert.ok(head.length > 0 && head.indexOf('id="shSearchBtn"') > 0, 'الأزرار قبل دائرة الحساب بالشريط العلوي');
  const card = html.slice(html.indexOf('<h2 id="listTitle">'), html.indexOf('id="filterPanel"'));
  assert.doesNotMatch(card, /shSearchBtn|shMoreMenu/, 'لا نسخة مكررة برأس البطاقة');
  assert.match(head, /id="shMoreMenu"[\s\S]*id="exportAllBtn"/);
  assert.match(head, /id="shSearchBtn"[^>]*onclick="toggleFilterPanel\(\)"/);
  runInAppContext(app, `document.getElementById('filterPanel').style.display = 'none';`);
  app.toggleFilterPanel();
  assert.equal(get(app, `document.getElementById('filterPanel').style.display`), 'block');
});
