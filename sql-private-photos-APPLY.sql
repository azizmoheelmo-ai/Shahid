-- ===== خطوة تأمين صور الشواهد (شغّلها بعد نشر الإصدار 2.31 وتأكد أن الصور تظهر) =====
-- 1) المشرف يقرأ ملفات المعلمين (يحتاجها عرض شواهد المعلم عند المشرف) والمعلم يقرأ ملفاته فقط كما كان.
drop policy if exists "المعلم يقرأ ملفاته فقط" on storage.objects;
create policy "المعلم يقرأ ملفاته فقط"
  on storage.objects for select
  using (bucket_id = 'shawahid-photos' and ((select auth.uid())::text = (storage.foldername(name))[1] or public.is_admin((select auth.uid()))));
-- 2) الحاوية تصير خاصة: الروابط العامة القديمة تتوقف، والتطبيق يعرض الصور بروابط مؤقتة.
update storage.buckets set public = false where id = 'shawahid-photos';
-- للتحقق: يجب أن يظهر public = false
select id, public from storage.buckets where id = 'shawahid-photos';
