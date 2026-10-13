'use strict';
/* اختبار انحدار: سياسة إدراج audit_log بسكربت الإعداد (app-07) ترفض كل إدراج من المستخدم المسجل.
   السجل يكتبه فقط الزناد log_shahid_delete (security definer) وواجهات الخادم (service role)،
   فلو رجعت السياسة إلى auth.uid() is not null لعاد بإمكان أي حساب تلويث السجل بإدخالات مزيفة. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'app-07-backup-export.js'), 'utf8');

test('سياسة إدراج audit_log: with check (false)', () => {
  const m = /create policy "أي مستخدم مسجل يضيف سجل نشاط"\s+on public\.audit_log for insert with check \(([^)]*\)?[^)]*)\);/.exec(src);
  assert.ok(m, 'لم أجد تعريف السياسة');
  assert.equal(m[1].trim(), 'false');
});

test('لا إدراج مباشر في audit_log من كود المتصفح (app/)', () => {
  const dir = path.join(__dirname, '..', 'app');
  for(const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))){
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/from\(\s*['"]audit_log['"]\s*\)\s*\.insert/.test(t), f + ' يُدرج في audit_log من المتصفح');
  }
});
