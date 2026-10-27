'use strict';
/* تصميم طباعة الشاهد (بطاقة التقرير) واختيار لونه — راجع tests/load-app.js */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load-app.js');

const rec = { school: 'مدرسة <b>س</b>', teacher_name: 'م', element_label: 'عنصر', steps: ['أ', 'ب'], description: '<img src=x>' };

test('الافتراضي بطاقة التقرير، والنصوص مهرّبة', () => {
  const app = loadApp();
  const html = app.buildPdfHtml(rec, []);
  assert.match(html, /لا توجد صور مرفقة/);
  assert.doesNotMatch(html, /الهدف من هذا الإجراء/, 'القسم الفارغ يُحذف');
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>س<\/b>/);
});

test('الكلاسيكي يُرجع القديم، وقيمة مخزّنة غريبة تُهمل', () => {
  const app = loadApp();
  app.localStorage.setItem('shahid_print_theme', 'classic');
  assert.match(app.buildPdfHtml(rec, []), /شاهد الأداء الوظيفي/);
  app.localStorage.setItem('shahid_print_theme', '"><script>');
  assert.equal(app.getShahidPrintTheme(), 'identity');
});

test('الصور: أكثر من ٦ تُختصر بملاحظة، والمفرد بعرض كامل', () => {
  const app = loadApp();
  const imgs = Array.from({ length: 8 }, (_, i) => 'data:image/png;base64,A' + i);
  const html = app.buildPdfHtml(rec, imgs);
  assert.equal((html.match(/<img /g) || []).length, 6);
  assert.match(html, /\+ 2 صور أخرى/);
  assert.match(app.buildPdfHtml(rec, [imgs[0]]), /width:100%;display:flex/);
});
