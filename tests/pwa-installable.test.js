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

/* كان الزر يظهر فقط مع beforeinstallprompt (أو آيفون) — فلا يظهر أبدًا في سفاري الماك
   وفايرفوكس، ولا في كروم/إيدج الكمبيوتر بعد إغلاق عرض التثبيت مرة: «نزّلته بالجوال ولم أقدر بالكمبيوتر». */
test('زر التثبيت يظهر على الكمبيوتر حتى بلا beforeinstallprompt، بخطوات حسب المتصفح', () => {
  const core = fs.readFileSync(path.join(root, 'app/app-01-core.js'), 'utf-8');
  assert.match(core, /DOMContentLoaded', \(\) => \{\s*setInstallBtnVisible\(!isStandaloneApp\(\)\);/);
  const { loadApp } = require('./load-app');
  const app = loadApp();
  const h = (ua, t) => app.installHelpText(ua, t || 0).title;
  const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ';
  assert.match(h(WIN + 'Chrome/131.0 Safari/537.36'), /Chrome/);
  assert.match(h(WIN + 'Chrome/131.0 Safari/537.36 Edg/131.0'), /Edge/);
  assert.match(h('Mozilla/5.0 (Windows NT 10.0; rv:133.0) Gecko/20100101 Firefox/133.0'), /Firefox/);
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  assert.match(h(MAC), /الماك/);
  assert.match(h(MAC, 5), /الآيباد/); /* آيباد يتنكّر كماك */
  assert.match(h('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'), /أندرويد/);
});
