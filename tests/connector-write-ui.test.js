'use strict';
/* حراسة ثابتة لواجهة رابط "القراءة والتعديل" (app-03) واتساقها مع الخادم (api/mcp.js):
   البادئة بالمتصفح = البادئة التي يستنتج منها الخادم صلاحية الكتابة، والرابط الأخطر
   بصلاحية قصيرة ثابتة وسقف أصغر وتأكيد صريح قبل الإنشاء. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const ui = read('app/app-03-auth-home-risk.js');
const server = read('api/mcp.js');
const html = read('index.html');

test('بادئة رمز التعديل متطابقة بين المتصفح والخادم', () => {
  assert.match(ui, /kind === 'write' \? 'shahid_rw_' : 'shahid_pat_'/);
  assert.match(server, /WRITE_TOKEN_PREFIX = 'shahid_rw_'/);
  assert.match(server, /\(pat\|rw\)/);
});

test('رابط التعديل: تأكيد صريح + صلاحية ثابتة 30 يومًا (لا "بلا انتهاء") + سقف رابطين', () => {
  assert.match(ui, /const WRITE_TOKEN_DAYS = 30;/);
  assert.match(ui, /const MAX_ACTIVE_WRITE_TOKENS = 2;/);
  assert.match(ui, /const okWrite = await showConfirm\(/);
  assert.match(ui, /const expiryDays = isWrite \? WRITE_TOKEN_DAYS :/);
});

test('زرّان منفصلان في الإعدادات، وزر التعديل لا يكون الافتراضي', () => {
  assert.match(html, /generateConnectorToken\('read'\)/);
  assert.match(html, /generateConnectorToken\('write'\)/);
  assert.ok(!/generateConnectorToken\(\)/.test(html), 'لا استدعاء بلا نوع صريح');
});

test('قائمة الروابط تميّز رابط التعديل بشارة ظاهرة', () => {
  assert.match(ui, /isWriteConnectorToken\(t\)/);
});
