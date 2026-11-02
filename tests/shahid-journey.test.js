'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const { loadApp, runInAppContext } = require('./load-app');

test('الرحلة: تعمل خارج الإنتاج فقط، وتُلغى بـ?journey=0', () => {
  const prod = loadApp({ location: { hostname: 'shahid-classroom.vercel.app' } });
  assert.equal(prod.shouldUseShahidJourney(), false);
  const prev = loadApp({ location: { hostname: 'shahid-xyz.vercel.app' } });
  assert.equal(prev.shouldUseShahidJourney(), true);
  const off = loadApp({ location: { hostname: 'shahid-xyz.vercel.app', search: '?journey=0' } });
  assert.equal(off.shouldUseShahidJourney(), false);
});

test('عنصر الاستراتيجيات وحده مفعّل وله نماذج جاهزة', () => {
  const app = loadApp({ location: { hostname: 'x.vercel.app' } });
  const keys = JSON.parse(runInAppContext(app, 'JSON.stringify(JOURNEY_ENABLED_ELEMENTS)'));
  assert.deepEqual(keys, ['التنويع في استراتيجيات التدريس']);
  assert.ok(runInAppContext(app, `SHAHID_TEMPLATES[${JSON.stringify(keys[0])}].length`) > 0);
});

test('الأزرار تمرّ عبر نقطة الدخول، وزر إلغاء التعديل يبقى كما هو', () => {
  const html = fs.readFileSync(__dirname + '/../index.html', 'utf-8');
  assert.match(html, /id="homeNewShahidBtn" onclick="startNewShahidEntry\(\)"/);
  assert.match(html, /id="cancelEditBtn"[^>]*onclick="startNewShahid\(\)"/);
});

test('الإنتاج: نقطة الدخول تفتح النموذج المعتاد لا الرحلة', () => {
  const app = loadApp({ location: { hostname: 'shahid-classroom.vercel.app' } });
  let classic = 0, journey = 0;
  app.startNewShahid = () => { classic++; };
  app.openShahidJourney = () => { journey++; };
  app.startNewShahidEntry();
  assert.deepEqual([classic, journey], [1, 0]);
});
