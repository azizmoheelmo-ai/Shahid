'use strict';
/* اختبار انحدار: لا سكربت خارجي. المكتبات (Supabase وPDF وExcel وZIP) محلية في vendor/ بإصدارات مثبّتة وبصمات،
   وضمن قائمة التخزين بالـService Worker (وإلا فشل التصدير بلا إنترنت أو تعطّل التطبيق إن تعطّل الـCDN). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('index.html: لا سكربت من موقع خارجي، وسياسة CSP لا تسمح بـCDN', () => {
  const html = read('index.html');
  for(const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.ok(!/^https?:\/\//.test(m[1]), 'سكربت خارجي: ' + m[1]);
  const csp = (html.match(/Content-Security-Policy" content="([\s\S]*?)">/) || [])[1] || '';
  assert.ok(csp, 'لم أجد CSP');
  assert.ok(!/jsdelivr|unpkg|cdnjs/.test(csp), 'CSP تسمح بـCDN');
});

test('app: التحميل الكسول للمكتبات من vendor/ لا من الشبكة', () => {
  const core = read('app/app-01-core.js');
  const urls = [...core.matchAll(/loadScriptOnce\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 4, 'متوقع 4 مكتبات على الأقل');
  for(const u of urls){ assert.ok(u.startsWith('vendor/'), u); assert.ok(fs.existsSync(path.join(root, u)), 'ملف مفقود: ' + u); }
});

test('vendor: كل ملف يطابق بصمته (SHA384SUMS.txt)', () => {
  const lines = read('vendor/SHA384SUMS.txt').trim().split('\n');
  assert.ok(lines.length >= 5);
  for(const l of lines){ const [h, f] = l.trim().split(/\s+/);
    assert.equal(crypto.createHash('sha384').update(fs.readFileSync(path.join(root, 'vendor', f))).digest('hex'), h, f); }
});

test('sw: كل ملفات vendor/ ضمن APP_SHELL', () => {
  const sw = read('sw.js');
  const shell = vm.runInNewContext(sw.slice(sw.indexOf('const APP_SHELL'), sw.indexOf('];', sw.indexOf('const APP_SHELL')) + 2) + '; APP_SHELL');
  for(const f of fs.readdirSync(path.join(root, 'vendor')).filter(f => f.endsWith('.js'))) assert.ok(shell.includes('./vendor/' + f), f);
});
