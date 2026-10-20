'use strict';
/* اختبار انحدار: سكربتات الإعداد لا تُنشئ سياسة قراءة عامة على حاوية shawahid-photos.
   سياسة select بلا شرط المالك كانت تسمح لأي زائر بسرد كل ملفات كل المعلمين عبر الواجهة؛ الروابط العامة تعمل بدونها
   لأن الحاوية عامة. القراءة عبر الواجهة لصاحب المجلد فقط (يحتاجها الحذف). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

for(const f of ['app/app-07-backup-export.js', 'sql-updates-run-in-supabase.sql']){
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test(f + ': لا سياسة قراءة على shawahid-photos بلا شرط المالك', () => {
    const selects = [...src.matchAll(/create policy "[^"]+"\s+on storage\.objects for select\s+using \(([\s\S]*?)\);/g)].map(m => m[1]).filter(q => /shawahid-photos/.test(q));
    assert.ok(selects.length > 0, 'لم أجد سياسة القراءة');
    for(const q of selects) assert.match(q, /auth\.uid\(\)\)?::text = \(storage\.foldername\(name\)\)\[1\]/, 'سياسة قراءة بلا شرط المالك: '+q);
  });
  test(f + ': السياسات العامة القديمة تُحذف', () => {
    assert.ok(!/create policy "قراءة عامة لصور شاهد"/.test(src) && !/create policy "الصور قابلة للعرض للجميع/.test(src));
  });
}
