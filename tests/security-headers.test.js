'use strict';
/* ترويسات الحماية من التضمين (clickjacking): frame-ancestors داخل وسم meta يتجاهله المتصفح، فتُرسل ترويسةً من vercel.json.
   صفحة /s/ مستثناة لأنها تضبط ترويساتها بنفسها (X-Frame-Options: DENY وCSP أشد). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));

test('ترويسات منع التضمين وnosniff لكل المسارات عدا /s/', () => {
  const rule = (vj.headers || []).find(h => /\(\?!s\//.test(h.source));
  assert.ok(rule, 'قاعدة ترويسات تستثني /s/');
  const get = k => (rule.headers.find(h => h.key === k) || {}).value;
  assert.equal(get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(get('Content-Security-Policy'), /frame-ancestors 'self'/);
  assert.equal(get('X-Content-Type-Options'), 'nosniff');
  const re = new RegExp('^' + rule.source.replace(/^\//, '/') + '$');
  assert.ok(re.test('/index.html') && re.test('/sw.js') && re.test('/api/mcp'), 'تغطي التطبيق والـapi');
  assert.ok(!re.test('/s/abcdefghjk'), 'تستثني صفحة الاستبانة');
});

test('صفحة /s/ تمنع التضمين بنفسها', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'api', 's.js'), 'utf8');
  assert.match(s, /X-Frame-Options', 'DENY'/);
  assert.match(s, /frame-ancestors 'none'/);
});
