-- ============================================================
-- تحديثات قاعدة البيانات المطلوبة لهذا المشروع
-- شغّل هذا الملف كاملًا مرة واحدة في: Supabase Dashboard → SQL Editor
-- (آمن التكرار — لو شُغّل أكثر من مرة بالخطأ لن يكسر شيئًا)
-- ============================================================

-- 1) تحصين إضافي: يمنع أي قيمة تعسّفية بحقل photo_urls بجدول shawahid
--    (حتى لو تم تجاوز واجهة التطبيق نفسها عبر نداء مباشر لواجهة Supabase)
-- ملاحظة: PostgreSQL لا يسمح بـ subquery داخل CHECK مباشرة، فنلفّ الشرط بدالة
create or replace function public.valid_shawahid_photo_urls(urls jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(urls) = 'array'
    and not exists (
      select 1 from jsonb_array_elements_text(urls) as u(url)
      where url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/(public|sign)/shawahid-photos/'
    );
$$;

alter table public.shawahid drop constraint if exists shawahid_photo_urls_valid;
alter table public.shawahid add constraint shawahid_photo_urls_valid
  check (public.valid_shawahid_photo_urls(photo_urls))
  not valid;

-- 2) إعداد صحيح لمساحة تخزين الصور: حد أقصى لحجم الملف، أنواع ملفات مسموحة،
--    وتقييد الرفع/التعديل/الحذف على مجلد المستخدم نفسه فقط (بدل الاعتماد
--    فقط على واجهة التطبيق)
-- ملاحظة: القائمة تشمل أنواع المستندات (PDF/Word/Excel/PowerPoint/CSV/نص)
-- لأن ميزة "إضافة مرفق" بالتطبيق تسمح بإرفاق مستندات كشاهد وليس صور فقط.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shawahid-photos', 'shawahid-photos', true,
  8388608, -- 8MB كحد أقصى لكل ملف
  array[
    'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "قراءة عامة لصور شاهد" on storage.objects;
create policy "قراءة عامة لصور شاهد"
  on storage.objects for select
  using (bucket_id = 'shawahid-photos');

drop policy if exists "المعلم يرفع ضمن مجلده فقط" on storage.objects;
create policy "المعلم يرفع ضمن مجلده فقط"
  on storage.objects for insert
  with check (
    bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "المعلم يعدّل ملفاته فقط" on storage.objects;
create policy "المعلم يعدّل ملفاته فقط"
  on storage.objects for update
  using (
    bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "المعلم يحذف ملفاته فقط" on storage.objects;
create policy "المعلم يحذف ملفاته فقط"
  on storage.objects for delete
  using (
    bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
