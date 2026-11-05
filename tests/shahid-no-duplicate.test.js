'use strict';
/* زر «نسخ» الشاهد أُزيل نهائيًا بقرار المستخدم — لا يعود بأي تراجع/استرجاع لاحق */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('لا دالة duplicateRecord ولا زر «نسخ» في أي ملف', async () => {
  const files = ['index.html'].concat(fs.readdirSync(path.join(root, 'app')).filter(f => f.endsWith('.js')).map(f => 'app/' + f));
  for(const f of files) assert.doesNotMatch(read(f), /duplicateRecord/, f);
  assert.doesNotMatch(read('app/app-09-shahid-form.js'), /<button[^>]*>نسخ<\/button>/);
});

test('بطاقة الشاهد: تعديل · طباعة · حذف · واتساب فقط', async () => {
  const src = read('app/app-09-shahid-form.js');
  const i = src.indexOf('<div class="rec-actions">');
  const block = src.slice(i, src.indexOf('</div>', i));
  for(const k of ['editRecord', 'printRecord', 'deleteRecord', 'shareWhatsApp']) assert.ok(block.includes(k), k);
  assert.equal((block.match(/<button/g) || []).length, 4);
});
