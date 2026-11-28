'use strict';
/* طبقة الكمبيوتر (≥1024px): الشريط السفلي يصير قائمة جانبية بالـCSS وحده.
   هذا يعمل فقط لأن تنسيقات الشريط في style.css لا inline بـindex.html —
   inline يغلب أي media query فيرجع الشريط ممدودًا أسفل شاشة الكمبيوتر. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('شريط التبويبات وأزراره بلا تنسيق inline (وإلا تفشل طبقة الكمبيوتر)', () => {
  const m = html.match(/<div id="bottomTabBar"[\s\S]*?\n  <\/div>/);
  assert.ok(m, 'bottomTabBar غير موجود');
  assert.ok(!/<div id="bottomTabBar"[^>]*style=/.test(m[0]), 'bottomTabBar عليه style inline');
  assert.ok(!/<button[^>]*bottom-tab-btn[^>]*style=/.test(m[0]), 'زر بالشريط عليه style inline');
  assert.ok(!/<span[^>]*btab-(ic|lb)[^>]*style=/.test(m[0]));
});

test('طبقة الكمبيوتر للشاشة فقط (لا تمسّ الطباعة) وتحوّل الشريط لقائمة جانبية', () => {
  const i = css.indexOf('@media screen and (min-width:1024px)');
  assert.ok(i > 0, 'طبقة الكمبيوتر مفقودة');
  const block = css.slice(i);
  assert.match(block, /\.btab-bar\{[^}]*flex-direction:column/);
  assert.match(block, /#appView\.wrap\{[^}]*padding-right:var\(--side-w\)/);
});

test('البيان لا يقفل الاتجاه عموديًا (يكسر نافذة التطبيق المثبّت على الكمبيوتر)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.notStrictEqual(m.orientation, 'portrait');
});
