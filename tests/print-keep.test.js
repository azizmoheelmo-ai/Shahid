'use strict';
/* حادثة حقيقية: PDF بشاشة التطبيق (شريط التطبيق + رأس/ذيل المتصفح الافتراضيان) بدل التقرير —
   سببها تفريغ #printArea وإزالة الكلاس عند 'afterprint' أو بعد 15 ثانية، ثم أعادت معاينة الطباعة توليد الصفحة. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInAppContext } = require('./load-app.js');
const root = path.join(__dirname, '..');

function setup(){
  const app = loadApp();
  runInAppContext(app, `window.__cls = new Set(); window.__timers = []; window.__prints = 0;
    document.body = { classList: { add: c => __cls.add(c), remove: c => __cls.delete(c) } };
    setTimeout = (fn, ms) => { __timers.push({ fn, ms }); return __timers.length; }; clearTimeout = () => {};
    window.print = () => { __prints++; };`);
  return app;
}

test('الطباعة لا تُنظَّف عند afterprint ولا بعد 15 ثانية، بل بعد مهلة طويلة', () => {
  const app = setup();
  runInAppContext(app, `window.__cleaned = 0; printNow(() => { __cleaned++; });`);
  assert.equal(runInAppContext(app, '__cls.has("printing-record")'), true);
  assert.equal(runInAppContext(app, '__prints'), 1);
  assert.ok(runInAppContext(app, '__timers[0].ms') >= 120000, 'المهلة أطول بكثير من 15 ثانية');
  assert.equal(runInAppContext(app, '__cleaned'), 0, 'لا تنظيف فوري');
  runInAppContext(app, '__timers[0].fn()');
  assert.equal(runInAppContext(app, '__cleaned'), 1);
  assert.equal(runInAppContext(app, '__cls.has("printing-record")'), false);
});

test('طباعة جديدة تنفّذ التنظيف المعلَّق مرة واحدة فقط', () => {
  const app = setup();
  runInAppContext(app, `window.__n = 0; printNow(() => { __n++; }); printCleanupNow(); printCleanupNow();`);
  assert.equal(runInAppContext(app, '__n'), 1);
});

test('لا مستمع afterprint ينظّف في أي ملف، ولا مهلة 15 ثانية', () => {
  for(const f of fs.readdirSync(path.join(root, 'app'))){
    const src = fs.readFileSync(path.join(root, 'app', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /addEventListener\('afterprint'/, f);
    assert.doesNotMatch(src, /,\s*15000\)/, f);
  }
});
