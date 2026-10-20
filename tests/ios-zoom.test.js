'use strict';
/* الآيفون/سفاري: النقر السريع (+ ثم +) لا يكبّر الصفحة، ولا الضغط على خانة كتابة —
   مع إبقاء التكبير بإصبعين (لا منع كامل للتكبير). */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('التكبير بالنقرتين معطّل في كل الصفحة (touch-action: manipulation)', () => {
  assert.match(css, /html, body, \*\{touch-action:manipulation;\}/);
});

test('خانات الكتابة بخط 16 على الأقل في سفاري الجوال (لا تكبير عند الضغط عليها)', () => {
  assert.match(css, /@supports \(-webkit-touch-callout: none\)\{\s*input, select, textarea\{font-size:16px !important;\}/);
});

test('التكبير بإصبعين باقٍ: لا user-scalable=no ولا maximum-scale=1 في إعداد الشاشة', () => {
  const vp = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1];
  assert.ok(vp, 'إعداد الشاشة موجود');
  assert.doesNotMatch(vp, /user-scalable\s*=\s*(no|0)/);
  assert.doesNotMatch(vp, /maximum-scale\s*=\s*1(\.0)?\b/);
});
