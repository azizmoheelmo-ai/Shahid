'use strict';
/* ============================================================
   مركز المخاطر (الجرس 🔔) موقوف حتى إشعار آخر — بطلب صاحب التطبيق:
   الزر مخفي، ولا تُفحص تنبيهاته عند الدخول، والشاشة لا تُفتح.
   الكود باقٍ؛ إعادته = RISK_CENTER_ON = true.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { loadApp, runInAppContext } = require('./load-app');

test('الجرس مخفي عند التحميل، والزر له معرّف', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<button class="ghost" id="riskNavBtn" onclick="showRiskCenter\(\)"/);
  const app = loadApp();
  assert.equal(app.riskCenterOn(), false);
  assert.equal(runInAppContext(app, `document.getElementById('riskNavBtn').style.display`), 'none');
});

test('لا فحص لتنبيهات المخاطر عند الدخول، ولا تُفتح شاشته', async () => {
  const app = loadApp({ currentUser: { id: 'u1' } });
  runInAppContext(app, `window.__calls = [];
    buildPerformanceRisks = async () => window.__calls.push('perf'); buildDataRisks = async () => window.__calls.push('data');
    refreshAttention = () => {}; refreshSupportMessagesBadge = () => {};
    hideAllMainViews = () => window.__calls.push('hide');`);
  await app.checkAdminStatus();
  await app.showRiskCenter();
  assert.deepEqual([...runInAppContext(app, 'window.__calls')], []);
});
