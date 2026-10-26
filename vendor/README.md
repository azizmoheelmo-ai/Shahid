# مكتبات محلية (vendor)

تُخدم من نفس الموقع بدل CDN: لا اعتماد على موقع خارجي، وتعمل بلا إنترنت بعد أول فتح، والإصدارات مثبّتة.

| الملف | الحزمة والإصدار | الاستعمال |
|---|---|---|
| supabase.umd.js | @supabase/supabase-js 2.117.1 | الاتصال بالخادم (يُحمَّل عند الفتح) |
| jszip.min.js | jszip 3.10.1 | ملفات ZIP للنسخ الاحتياطي |
| xlsx.full.min.js | xlsx (SheetJS) 0.18.5 | استيراد وتصدير Excel |
| html2canvas.min.js | html2canvas 1.4.1 | التقاط الصفحة لتقارير PDF |
| jspdf.umd.min.js | jspdf 4.2.1 | توليد PDF |

- البصمات في `SHA384SUMS.txt` ويتحقق منها `tests/vendored-libs.test.js`.
- تحديث مكتبة: ثبّت الإصدار من npm، انسخ ملف dist، حدّث البصمة (`sha384sum`) والجدول أعلاه، وارفع رقم الإصدار (`version.json` و`APP_VERSION` و`APP_VERSION_SW`).
- ملاحظة: SheetJS 0.18.5 قديم (ثغرات معلنة: CVE-2023-30533 وCVE-2024-22363) ويقرأ ملفات يختارها المعلم بنفسه. الإصدارات الأحدث لا تُنشر على npm، وتؤخذ من cdn.sheetjs.com.
