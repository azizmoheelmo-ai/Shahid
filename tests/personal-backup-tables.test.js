'use strict';
/* النسخة الاحتياطية الشخصية (exportBackup، app-08): كل جدول بيانات المعلم يدخلها، بتصفية صريحة بالمالك (م1)،
   ويُكتب بمفتاحه في «بيانات-كاملة.json». سبب الاختبار: أربعة جداول كانت غائبة (ضياع صامت عند الاستعادة). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-08-admin.js'), 'utf8');
const i = src.indexOf('const uid = currentUser.id;\n    const [shRes');
const body = src.slice(i, i + 60000);

const OWNER = {
  plan_header: 'user_id', classroom_lesson_skips: 'teacher_id', classroom_letter_counters: 'teacher_id', classroom_attention_dismissals: 'teacher_id',
  survey_campaigns: 'teacher_id', survey_responses: 'teacher_id', classroom_students: 'teacher_id', shawahid: 'user_id'
};

Object.keys(OWNER).forEach(t => {
  test(`النسخة الشخصية تشمل ${t} بتصفية ${OWNER[t]}`, () => {
    const q = new RegExp(`sb\\.from\\('${t}'\\)\\.select\\('\\*'\\)\\.eq\\('${OWNER[t]}', uid\\)`);
    assert.match(body, q, 'استعلام مصفّى بالمالك');
    assert.match(body, new RegExp(`\\b${t}[:,]\\s`), 'مفتاح بملف JSON');
  });
});
