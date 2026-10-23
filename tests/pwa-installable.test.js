'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('manifest قابل للتثبيت: أيقونتا 192 و512 موجودتان فعليًا', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf-8'));
  assert.strictEqual(m.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    const icon = m.icons.find(i => i.sizes === size);
    assert.ok(icon, 'أيقونة ' + size);
    assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
  }
});

test('زر التثبيت موجود ومربوط بدالة installApp', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
  const core = fs.readFileSync(path.join(root, 'app/app-01-core.js'), 'utf-8');
  assert.match(html, /id="installAppBtn"[^>]*installApp\(\)/);
  assert.match(core, /function installApp\(/);
  assert.match(core, /beforeinstallprompt/);
});

test('الأيقونة الجديدة ضمن كاش الـservice worker', () => {
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf-8'), /icon-512\.png/);
});
