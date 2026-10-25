const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-14-classroom-today.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

test('محرّر الجدول الأسبوعي: التنسيق الجديد لا يكسر ربط الأحداث', () => {
  assert.match(js, /onclick="setCrmTimetableDay\(\$\{d\.value\}\)"/);
  assert.match(js, /onchange="saveCrmTimetableSlot\(\$\{crmTimetableDay\}, \$\{p\}, this\)"/);
  assert.match(js, /class="crm-tt-row\$\{slot \? ' has-slot' : ''\}"/);
});

test('محرّر الجدول الأسبوعي: كل أصناف القالب معرّفة في style.css', () => {
  ['crm-tt-days', 'crm-tt-day', 'crm-tt-row', 'crm-tt-n', 'crm-tt-sel', 'crm-tt-hint', 'crm-tt-list'].forEach(c => {
    assert.ok(css.includes('.' + c), 'الصنف ' + c + ' غير معرّف');
  });
  assert.match(css, /\.crm-tt-days\{[^}]*position:sticky/);
});
