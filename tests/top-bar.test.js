'use strict';
/* ============================================================
   الشريط العلوي المضغوط (v2.4): عنوان الصفحة الظاهرة + قائمة الحساب
   (لوحة التحكم، تواصل، الإعدادات، والخروج آخرها بتأكيد)، وشارة السنة/الفصل،
   وبلا "رجوع للرئيسية" (الشريط السفلي يكفي).
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const get = (app, e) => runInAppContext(app, e);

test('لا "رجوع للرئيسية" في أي شاشة، ولافتات العناوين البحتة مخفية (لا الخطابات ولا نموذج الشاهد)', () => {
  assert.doesNotMatch(html, /رجوع للرئيسية/);
  for(const t of ['إدارة الصف', 'الإعدادات', 'أعمالي', 'التقويم الدراسي', 'لوحة تحكم المسؤول']){
    assert.match(html, new RegExp(`<div class="band band-title"><h1>${t}</h1></div>`), t);
  }
  assert.match(html, /<div class="band">\s*<h1>شاهد الأداء الوظيفي<\/h1>/, 'لافتة الشاهد المطبوع باقية');
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  assert.match(css, /\.band\.band-title\{display:none;\}/);
});

test('الخروج داخل قائمة الحساب، آخرها، وبتأكيد', async () => {
  const menu = html.slice(html.indexOf('id="acctMenu"'), html.indexOf('<!-- ---------- شريط التبويبات السفلي الثابت'));
  const order = ['id="whoName"', 'id="adminNavBtn"', 'showSupportModal()', 'showSettings()', 'confirmLogout()'].map(k => menu.indexOf(k));
  order.forEach(i => assert.ok(i > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'الخروج آخر القائمة');
  assert.doesNotMatch(html, /onclick="handleLogout\(\)"/, 'لا خروج بضغطة واحدة');
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__out = 0; handleLogout = () => { window.__out++; }; window.__ans = false; showConfirm = async () => window.__ans;`);
  await app.confirmLogout();
  assert.equal(get(app, 'window.__out'), 0, 'إلغاء = لا خروج');
  runInAppContext(app, `window.__ans = true;`);
  await app.confirmLogout();
  assert.equal(get(app, 'window.__out'), 1);
});

test('عنوان الشريط = الشاشة الظاهرة، والحرف الأول من الاسم في الدائرة', () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `TOP_TITLE_VIEWS.forEach(id => { const v = document.getElementById(id); if(v) v.style.display = 'none'; });
    document.getElementById('listView').style.display = 'block';`);
  app.syncTopTitle();
  assert.equal(get(app, `document.getElementById('topTitle').textContent`), 'الشواهد');
  runInAppContext(app, `document.getElementById('listView').style.display = 'none';
    const v = document.getElementById('classroomView'); v.style.display = 'block';
    v.querySelector = sel => sel === '.band-title h1' ? { textContent: 'إدارة الصف' } : null;`);
  app.syncTopTitle();
  assert.equal(get(app, `document.getElementById('topTitle').textContent`), 'إدارة الصف');
  runInAppContext(app, `document.getElementById('whoName').textContent = 'عبدالعزيز المطيري';`);
  app.updateAcctInitial();
  assert.equal(get(app, `document.getElementById('acctInitial').textContent`), 'ع');
});

test('🔍 و⋯ الشواهد بالشريط العلوي تظهر بشاشة الشواهد فقط وتُغلق قائمتها عند المغادرة', () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `TOP_TITLE_VIEWS.forEach(id => { const v = document.getElementById(id); if(v) v.style.display = 'none'; });
    document.getElementById('listView').style.display = 'block';`);
  app.syncTopTitle();
  assert.equal(get(app, `document.getElementById('shTopActions').style.display`), 'flex');
  runInAppContext(app, `document.getElementById('shMoreMenu').style.display = 'block';
    document.getElementById('listView').style.display = 'none';
    document.getElementById('homeView').style.display = 'block';`);
  app.syncTopTitle();
  assert.equal(get(app, `document.getElementById('shTopActions').style.display`), 'none');
  assert.equal(get(app, `document.getElementById('shMoreMenu').style.display`), 'none', 'القائمة لا تبقى مفتوحة');
});

test('شارة السنة/الفصل تعكس الاختيار وتفتح سطر الاختيار', () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `document.getElementById('crmYearInput').value = '1448-1449'; document.getElementById('crmSemesterSelect').value = 'الفصل الثاني';
    document.getElementById('crmTermRow').style.display = 'none';`);
  app.updateCrmTermChip();
  assert.equal(get(app, `document.getElementById('crmTermChipText').textContent`), '1448-1449 · الفصل الثاني');
  app.toggleCrmTermRow();
  assert.equal(get(app, `document.getElementById('crmTermRow').style.display`), 'block');
});
