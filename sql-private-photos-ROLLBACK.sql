-- ===== رجوع فوري: يعيد الحاوية عامة (الروابط القديمة تعمل من جديد خلال ثوانٍ، ولا بيانات تتغير) =====
update storage.buckets set public = true where id = 'shawahid-photos';
select id, public from storage.buckets where id = 'shawahid-photos';
