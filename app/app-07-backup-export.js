/* ============ (5) نسخة احتياطية ============ */

/* ============================================
   لوحة تحكم المسؤول — نظرة متكاملة على المعلمين
   تربط: الشواهد + الخطة + التقييم الذاتي في مكان واحد
   ============================================ */
let adminAllRecords = [];
let adminAllPlans = {};   // { user_id: { element_key: {...} } }
let adminAllSelf = {};    // { user_id: { element_key: {...} } }
let adminProfiles = [];
let adminIds = new Set();

/* ============================================
   النسخة الاحتياطية الشاملة (للمسؤول)
   تشمل: كل الجداول + الصور الفعلية + ملفات CSV مقروءة
   ============================================ */
/* ملف SQL كامل لإعادة بناء بنية قاعدة البيانات من الصفر */
function buildSchemaSql(){
  return `-- ============================================================
-- إعادة بناء بنية قاعدة بيانات "شاهد الأداء الوظيفي" من الصفر
-- شغّل هذا الملف كاملًا في SQL Editor على مشروع Supabase جديد
-- ثم استورد البيانات من ملف backup-full.json
-- تاريخ التوليد: ${new Date().toISOString()}
-- ============================================================

-- ============ 1) دالة التحقق من صلاحية المسؤول ============
-- (security definer لتجاوز RLS ومنع الاستعلام الدائري)
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz default now()
);

create or replace function public.is_admin(uid uuid)
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.admins where user_id = uid);
$$;

alter table public.admins enable row level security;

drop policy if exists "المستخدم يتحقق من صلاحيته فقط" on public.admins;
create policy "المستخدم يتحقق من صلاحيته فقط"
  on public.admins for select using (auth.uid() = user_id);

drop policy if exists "المسؤول يضيف مسؤولين" on public.admins;
create policy "المسؤول يضيف مسؤولين"
  on public.admins for insert with check (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يحذف مسؤولين" on public.admins;
create policy "المسؤول يحذف مسؤولين"
  on public.admins for delete using (public.is_admin(auth.uid()));

-- ============ 2) ملفات المعلمين ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  school text,
  subject text,
  default_class text,
  disabled boolean default false,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "المستخدم يشوف ملفه فقط" on public.profiles;
create policy "المستخدم يشوف ملفه فقط"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "المسؤول يشوف كل الملفات" on public.profiles;
create policy "المسؤول يشوف كل الملفات"
  on public.profiles for select using (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يعدّل أي ملف" on public.profiles;
create policy "المسؤول يعدّل أي ملف"
  on public.profiles for update using (public.is_admin(auth.uid()));

-- تزامن تلقائي مع حسابات المصادقة
create or replace function public.sync_profile_from_auth()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, school, subject, default_class)
  values (new.id, new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'school',
    new.raw_user_meta_data->>'subject',
    new.raw_user_meta_data->>'default_class')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    school = excluded.school,
    subject = excluded.subject,
    default_class = excluded.default_class;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists trg_sync_profile_insert on auth.users;
create trigger trg_sync_profile_insert
after insert on auth.users
for each row execute function public.sync_profile_from_auth();

drop trigger if exists trg_sync_profile_update on auth.users;
create trigger trg_sync_profile_update
after update of raw_user_meta_data, email on auth.users
for each row execute function public.sync_profile_from_auth();

-- ============ 3) عناصر الأداء ============
create table if not exists public.performance_elements (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  weight int default 10,
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz default now()
);

alter table public.performance_elements enable row level security;

drop policy if exists "الجميع يشوف العناصر النشطة" on public.performance_elements;
create policy "الجميع يشوف العناصر النشطة"
  on public.performance_elements for select using (auth.uid() is not null);

drop policy if exists "المسؤول يدير العناصر - إضافة" on public.performance_elements;
create policy "المسؤول يدير العناصر - إضافة"
  on public.performance_elements for insert with check (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يدير العناصر - تعديل" on public.performance_elements;
create policy "المسؤول يدير العناصر - تعديل"
  on public.performance_elements for update using (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يدير العناصر - حذف" on public.performance_elements;
create policy "المسؤول يدير العناصر - حذف"
  on public.performance_elements for delete using (public.is_admin(auth.uid()));

-- ============ 4) الشواهد ============
create sequence if not exists public.shawahid_ref_seq start with 1;

create table if not exists public.shawahid (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  teacher_name text,
  teacher_email text,
  school text,
  subject text,
  class_name text,
  lesson_title text,
  lesson_date date,
  element_key text not null,
  element_label text not null,
  description text,
  goal text,
  steps jsonb default '[]'::jsonb,
  photo_urls jsonb default '[]'::jsonb,
  quant_impact text,
  qual_impact text,
  reflection text,
  target_level text,
  ref_number text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.shawahid enable row level security;

drop policy if exists "المعلم يشوف شواهده فقط" on public.shawahid;
create policy "المعلم يشوف شواهده فقط"
  on public.shawahid for select using (auth.uid() = user_id);

drop policy if exists "المعلم يضيف شاهد لنفسه فقط" on public.shawahid;
create policy "المعلم يضيف شاهد لنفسه فقط"
  on public.shawahid for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يعدّل شواهده فقط" on public.shawahid;
create policy "المعلم يعدّل شواهده فقط"
  on public.shawahid for update using (auth.uid() = user_id);

drop policy if exists "المعلم يحذف شواهده فقط" on public.shawahid;
create policy "المعلم يحذف شواهده فقط"
  on public.shawahid for delete using (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل الشواهد" on public.shawahid;
create policy "المسؤول يشوف كل الشواهد"
  on public.shawahid for select using (public.is_admin(auth.uid()));

/* تحصين إضافي: التحقق أن photo_urls مصفوفة نصوص وأن كل رابط فيها فعلاً
   رابط تخزين Supabase علني ضمن bucket الصور — يمنع أي مستخدم من إدخال
   قيمة تعسّفية (مثل كود حقن HTML/JS) عبر نداء مباشر لواجهة الإدراج،
   حتى لو تجاوز واجهة التطبيق نفسها. */
-- PostgreSQL لا يسمح بـ subquery داخل CHECK مباشرة، فنلفّ الشرط بدالة
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
  not valid; -- not valid: لا يفحص الصفوف الموجودة مسبقًا (تفاديًا لفشل الترحيل
             -- على بيانات قديمة قد لا تطابق النمط تمامًا)، ويُطبَّق فقط على
             -- أي إدراج/تعديل جديد من الآن فصاعدًا.

drop policy if exists "المسؤول يحذف أي شاهد" on public.shawahid;
create policy "المسؤول يحذف أي شاهد"
  on public.shawahid for delete using (public.is_admin(auth.uid()));

-- رقم مرجعي تلقائي
create or replace function public.set_shahid_ref_number()
returns trigger as $$
begin
  if new.ref_number is null then
    new.ref_number := 'SH-' || to_char(now(),'YYYY') || '-' ||
                      lpad(nextval('public.shawahid_ref_seq')::text, 5, '0');
  end if;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists trg_set_shahid_ref_number on public.shawahid;
create trigger trg_set_shahid_ref_number
before insert on public.shawahid
for each row execute function public.set_shahid_ref_number();

-- تحديث تلقائي لتاريخ التعديل
create or replace function public.set_shahid_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_shahid_updated_at on public.shawahid;
create trigger trg_set_shahid_updated_at
before update on public.shawahid
for each row execute function public.set_shahid_updated_at();

-- ============ 4ب) إعداد مساحة تخزين الصور (bucket + سياسات الوصول) ============
-- bucket واحد تُخزَّن فيه صور: الشواهد، إثباتات تسليم خطابات الإحالة السلوكية،
-- وإثباتات تسليم خطابات المتابعة الأكاديمية. مسار الملف يبدأ دائمًا بمعرّف
-- المستخدم (auth.uid()) كأول مجلد — راجع upload paths في التطبيق.
-- ملاحظة: القائمة تشمل أنواع المستندات (PDF/Word/Excel/PowerPoint/CSV/نص)
-- لأن ميزة "إضافة مرفق" (makeSlot مصدر 'file') تسمح بإرفاقها كشاهد، وليس
-- الصور فقط — تقييدها لصور فقط كان سيكسر هذه الميزة الموجودة أصلاً.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shawahid-photos', 'shawahid-photos', true,
  8388608, -- 8MB كحد أقصى لكل ملف (حماية من إساءة استخدام المساحة)
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

-- قراءة عامة (الروابط تُستخدم مباشرة كـ src للصور وبالخطابات المطبوعة/PDF)
drop policy if exists "قراءة عامة لصور شاهد" on storage.objects;
create policy "قراءة عامة لصور شاهد"
  on storage.objects for select
  using (bucket_id = 'shawahid-photos');

-- الرفع مسموح فقط ضمن مجلد المستخدم نفسه (أول جزء من المسار = auth.uid())
drop policy if exists "المعلم يرفع ضمن مجلده فقط" on storage.objects;
create policy "المعلم يرفع ضمن مجلده فقط"
  on storage.objects for insert
  with check (
    bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- التعديل/الحذف مسموح فقط لصاحب الملف
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

-- ============ 5) خطة الأداء ============
create or replace function public.set_plan_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql security definer;

create table if not exists public.performance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cycle_year text not null,
  element_key text not null,
  element_label text,
  goal_order int default 0,
  goal_name text,
  template_name text,
  target_level int check (target_level between 1 and 5),
  target_count int default 0,
  personal_note text,
  target_performance text,
  success_indicators jsonb default '[]'::jsonb,
  recommended_evidence jsonb default '[]'::jsonb,
  action_steps jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, cycle_year, element_key, goal_order)
);

alter table public.performance_goals enable row level security;

drop policy if exists "المعلم يشوف خطته فقط" on public.performance_goals;
create policy "المعلم يشوف خطته فقط"
  on public.performance_goals for select using (auth.uid() = user_id);

drop policy if exists "المعلم يضيف خطته فقط" on public.performance_goals;
create policy "المعلم يضيف خطته فقط"
  on public.performance_goals for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يعدّل خطته فقط" on public.performance_goals;
create policy "المعلم يعدّل خطته فقط"
  on public.performance_goals for update using (auth.uid() = user_id);

drop policy if exists "المعلم يحذف خطته فقط" on public.performance_goals;
create policy "المعلم يحذف خطته فقط"
  on public.performance_goals for delete using (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل الخطط" on public.performance_goals;
create policy "المسؤول يشوف كل الخطط"
  on public.performance_goals for select using (public.is_admin(auth.uid()));

drop trigger if exists trg_plan_updated_at on public.performance_goals;
create trigger trg_plan_updated_at
before update on public.performance_goals
for each row execute function public.set_plan_updated_at();

-- ترويسة الخطة
create table if not exists public.plan_header (
  user_id uuid references auth.users(id) on delete cascade not null,
  cycle_year text not null,
  role_title text,
  stage text,
  extra_duties text,
  updated_at timestamptz default now(),
  primary key (user_id, cycle_year)
);

alter table public.plan_header enable row level security;

drop policy if exists "المعلم يدير ترويسة خطته" on public.plan_header;
create policy "المعلم يدير ترويسة خطته"
  on public.plan_header for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل الترويسات" on public.plan_header;
create policy "المسؤول يشوف كل الترويسات"
  on public.plan_header for select using (public.is_admin(auth.uid()));

-- ============ 6) التقييم الذاتي ============
create table if not exists public.self_assessment (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  cycle_year text not null,
  element_key text not null,
  element_label text,
  self_level int check (self_level between 1 and 5),
  self_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, cycle_year, element_key)
);

alter table public.self_assessment enable row level security;

drop policy if exists "المعلم يشوف تقييمه الذاتي فقط" on public.self_assessment;
create policy "المعلم يشوف تقييمه الذاتي فقط"
  on public.self_assessment for select using (auth.uid() = user_id);

drop policy if exists "المعلم يضيف تقييمه الذاتي فقط" on public.self_assessment;
create policy "المعلم يضيف تقييمه الذاتي فقط"
  on public.self_assessment for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يعدّل تقييمه الذاتي فقط" on public.self_assessment;
create policy "المعلم يعدّل تقييمه الذاتي فقط"
  on public.self_assessment for update using (auth.uid() = user_id);

drop policy if exists "المعلم يحذف تقييمه الذاتي فقط" on public.self_assessment;
create policy "المعلم يحذف تقييمه الذاتي فقط"
  on public.self_assessment for delete using (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل التقييمات الذاتية" on public.self_assessment;
create policy "المسؤول يشوف كل التقييمات الذاتية"
  on public.self_assessment for select using (public.is_admin(auth.uid()));

drop trigger if exists trg_self_updated_at on public.self_assessment;
create trigger trg_self_updated_at
before update on public.self_assessment
for each row execute function public.set_plan_updated_at();

-- ============ 7) سجل النشاط ============
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text not null,
  record_id uuid,
  performed_by uuid,
  performed_by_email text,
  details jsonb,
  created_at timestamptz default now()
);

alter table public.audit_log enable row level security;

drop policy if exists "المسؤول فقط يشوف سجل النشاط" on public.audit_log;
create policy "المسؤول فقط يشوف سجل النشاط"
  on public.audit_log for select using (public.is_admin(auth.uid()));

drop policy if exists "أي مستخدم مسجل يضيف سجل نشاط" on public.audit_log;
create policy "أي مستخدم مسجل يضيف سجل نشاط"
  on public.audit_log for insert with check (auth.uid() is not null);

create or replace function public.log_shahid_delete()
returns trigger as $$
begin
  insert into public.audit_log (action, table_name, record_id, performed_by, performed_by_email, details)
  values ('delete','shawahid', old.id, auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    jsonb_build_object('ref_number', old.ref_number,'teacher_name', old.teacher_name,
                       'element_label', old.element_label,'owner_id', old.user_id));
  return old;
end; $$ language plpgsql security definer;

drop trigger if exists trg_log_shahid_delete on public.shawahid;
create trigger trg_log_shahid_delete
before delete on public.shawahid
for each row execute function public.log_shahid_delete();

-- ============ 8) مساحة تخزين الصور ============
insert into storage.buckets (id, name, public)
values ('shawahid-photos','shawahid-photos', true)
on conflict (id) do nothing;

drop policy if exists "أي مستخدم مسجل يرفع صوره في مجلده فقط" on storage.objects;
create policy "أي مستخدم مسجل يرفع صوره في مجلده فقط"
  on storage.objects for insert
  with check (bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "الصور قابلة للعرض للجميع (رابط مباشر)" on storage.objects;
create policy "الصور قابلة للعرض للجميع (رابط مباشر)"
  on storage.objects for select using (bucket_id = 'shawahid-photos');

drop policy if exists "المعلم يحذف صوره فقط" on storage.objects;
create policy "المعلم يحذف صوره فقط"
  on storage.objects for delete
  using (bucket_id = 'shawahid-photos'
    and auth.uid()::text = (storage.foldername(name))[1]);

-- ============ 9) تعبئة عناصر الأداء الافتراضية ============
insert into public.performance_elements (key, label, weight, sort_order) values
  ('أداء الواجبات الوظيفية','أداء الواجبات الوظيفية',10,1),
  ('التفاعل مع المجتمع المهني','التفاعل مع المجتمع المهني',10,2),
  ('التفاعل مع أولياء الأمور','التفاعل مع أولياء الأمور',10,3),
  ('التنويع في استراتيجيات التدريس','التنويع في استراتيجيات التدريس',10,4),
  ('تحسين نتائج المتعلمين','تحسين نتائج المتعلمين',10,5),
  ('إعداد وتنفيذ خطة التعلم','إعداد وتنفيذ خطة التعلم',10,6),
  ('توظيف تقنيات ووسائل التعلم المناسبة','توظيف تقنيات ووسائل التعلم المناسبة',10,7),
  ('تهيئة البيئة التعليمية','تهيئة البيئة التعليمية',5,8),
  ('الإدارة الصفية','الإدارة الصفية',5,9),
  ('تحليل نتائج المتعلمين وتشخيص مستوياتهم','تحليل نتائج المتعلمين وتشخيص مستوياتهم',10,10),
  ('تنوع أساليب التقويم','تنوع أساليب التقويم',10,11)
on conflict (key) do nothing;

-- ============ موديول إدارة الصف ============
create table if not exists public.classroom_students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  full_name text not null,
  grade_level text,
  section_number text,
  student_number text,
  academic_year text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);
alter table public.classroom_students enable row level security;
drop policy if exists "المعلم يشوف طلابه فقط" on public.classroom_students;
create policy "المعلم يشوف طلابه فقط" on public.classroom_students for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يضيف طالبًا لنفسه فقط" on public.classroom_students;
create policy "المعلم يضيف طالبًا لنفسه فقط" on public.classroom_students for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يعدّل طلابه فقط" on public.classroom_students;
create policy "المعلم يعدّل طلابه فقط" on public.classroom_students for update using (auth.uid() = teacher_id);
drop policy if exists "المعلم يحذف طلابه فقط" on public.classroom_students;
create policy "المعلم يحذف طلابه فقط" on public.classroom_students for delete using (auth.uid() = teacher_id);
drop policy if exists "المسؤول يشوف كل الطلاب" on public.classroom_students;
create policy "المسؤول يشوف كل الطلاب" on public.classroom_students for select using (public.is_admin(auth.uid()));

create table if not exists public.classroom_grade_levels (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  academic_year text not null,
  name text not null,
  created_at timestamptz default now()
);
alter table public.classroom_grade_levels enable row level security;
drop policy if exists "المعلم يدير مراحله فقط - عرض" on public.classroom_grade_levels;
create policy "المعلم يدير مراحله فقط - عرض" on public.classroom_grade_levels for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير مراحله فقط - إضافة" on public.classroom_grade_levels;
create policy "المعلم يدير مراحله فقط - إضافة" on public.classroom_grade_levels for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير مراحله فقط - حذف" on public.classroom_grade_levels;
create policy "المعلم يدير مراحله فقط - حذف" on public.classroom_grade_levels for delete using (auth.uid() = teacher_id);

create table if not exists public.classroom_sections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  grade_level_id uuid references public.classroom_grade_levels(id) on delete cascade not null,
  academic_year text not null,
  name text not null,
  created_at timestamptz default now()
);
alter table public.classroom_sections enable row level security;
drop policy if exists "المعلم يدير شعبه فقط - عرض" on public.classroom_sections;
create policy "المعلم يدير شعبه فقط - عرض" on public.classroom_sections for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير شعبه فقط - إضافة" on public.classroom_sections;
create policy "المعلم يدير شعبه فقط - إضافة" on public.classroom_sections for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير شعبه فقط - حذف" on public.classroom_sections;
create policy "المعلم يدير شعبه فقط - حذف" on public.classroom_sections for delete using (auth.uid() = teacher_id);

create table if not exists public.classroom_incident_types (
  id uuid primary key default gen_random_uuid(),
  problem_name text not null,
  regulation_article text not null,
  problem_degree int not null,
  action_sequence text not null check (action_sequence in ('two_warnings_then_referral','immediate_referral')),
  stage_1_label text,
  stage_2_label text,
  referral_trigger_count int not null,
  source_text_summary text,
  active boolean default true,
  created_at timestamptz default now()
);
alter table public.classroom_incident_types enable row level security;
drop policy if exists "الجميع يشوف أنواع المخالفات النشطة" on public.classroom_incident_types;
create policy "الجميع يشوف أنواع المخالفات النشطة" on public.classroom_incident_types for select using (auth.uid() is not null);
drop policy if exists "المسؤول يدير أنواع المخالفات - إضافة" on public.classroom_incident_types;
create policy "المسؤول يدير أنواع المخالفات - إضافة" on public.classroom_incident_types for insert with check (public.is_admin(auth.uid()));
drop policy if exists "المسؤول يدير أنواع المخالفات - تعديل" on public.classroom_incident_types;
create policy "المسؤول يدير أنواع المخالفات - تعديل" on public.classroom_incident_types for update using (public.is_admin(auth.uid()));
drop policy if exists "المسؤول يدير أنواع المخالفات - حذف" on public.classroom_incident_types;
create policy "المسؤول يدير أنواع المخالفات - حذف" on public.classroom_incident_types for delete using (public.is_admin(auth.uid()));

create table if not exists public.classroom_incidents (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  student_id uuid references public.classroom_students(id) on delete cascade not null,
  incident_type_id uuid references public.classroom_incident_types(id) not null,
  incident_date date not null default current_date,
  semester_label text not null,
  occurrence_number int not null,
  current_stage text not null check (current_stage in ('warning_1','warning_2','referred')),
  notes text,
  referral_letter_generated boolean default false,
  referral_letter_number text,
  referral_receipt_photo_url text,
  created_at timestamptz default now()
);
create index if not exists idx_incidents_student_type_semester on public.classroom_incidents (student_id, incident_type_id, semester_label);
alter table public.classroom_incidents enable row level security;
drop policy if exists "المعلم يشوف حوادثه فقط" on public.classroom_incidents;
create policy "المعلم يشوف حوادثه فقط" on public.classroom_incidents for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يضيف حادثة لنفسه فقط" on public.classroom_incidents;
create policy "المعلم يضيف حادثة لنفسه فقط" on public.classroom_incidents for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يعدّل حوادثه فقط" on public.classroom_incidents;
create policy "المعلم يعدّل حوادثه فقط" on public.classroom_incidents for update using (auth.uid() = teacher_id);
drop policy if exists "المعلم يحذف حوادثه فقط" on public.classroom_incidents;
create policy "المعلم يحذف حوادثه فقط" on public.classroom_incidents for delete using (auth.uid() = teacher_id);
drop policy if exists "المسؤول يشوف كل الحوادث" on public.classroom_incidents;
create policy "المسؤول يشوف كل الحوادث" on public.classroom_incidents for select using (public.is_admin(auth.uid()));

create table if not exists public.classroom_letter_counters (
  teacher_id uuid primary key references auth.users(id) on delete cascade,
  next_number int not null default 1,
  updated_at timestamptz default now()
);
alter table public.classroom_letter_counters enable row level security;
drop policy if exists "المعلم يشوف عدّاده فقط" on public.classroom_letter_counters;
create policy "المعلم يشوف عدّاده فقط" on public.classroom_letter_counters for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يضيف عدّاده فقط" on public.classroom_letter_counters;
create policy "المعلم يضيف عدّاده فقط" on public.classroom_letter_counters for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يعدّل عدّاده فقط" on public.classroom_letter_counters;
create policy "المعلم يعدّل عدّاده فقط" on public.classroom_letter_counters for update using (auth.uid() = teacher_id);

-- ملاحظة: بيانات أنواع المخالفات الـ33 يجب إعادة إدخالها يدويًا بعد إنشاء الجداول
-- (راجع ملف classroom_module_schema.sql المُسلَّم سابقًا لقائمة الإدخالات الكاملة)

-- ============ موديول المتابعة الأكاديمية ============
create table if not exists public.academic_cases (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  student_id uuid references public.classroom_students(id) on delete cascade not null,
  subject text not null,
  weakness_description text not null,
  plan_description text,
  plan_started_at date not null default current_date,
  academic_year text not null,
  status text not null check (status in ('plan_active','referred')) default 'plan_active',
  session_type text check (session_type in ('فردي','جماعي')),
  committee_approved_at date,
  notes text,
  referral_letter_generated boolean default false,
  referral_letter_number text,
  referral_receipt_photo_url text,
  created_at timestamptz default now()
);
create index if not exists idx_academic_cases_student on public.academic_cases (student_id);
alter table public.academic_cases enable row level security;
drop policy if exists "المعلم يشوف حالاته فقط" on public.academic_cases;
create policy "المعلم يشوف حالاته فقط" on public.academic_cases for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يضيف حالة لنفسه فقط" on public.academic_cases;
create policy "المعلم يضيف حالة لنفسه فقط" on public.academic_cases for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يعدّل حالاته فقط" on public.academic_cases;
create policy "المعلم يعدّل حالاته فقط" on public.academic_cases for update using (auth.uid() = teacher_id);
drop policy if exists "المعلم يحذف حالاته فقط" on public.academic_cases;
create policy "المعلم يحذف حالاته فقط" on public.academic_cases for delete using (auth.uid() = teacher_id);
drop policy if exists "المسؤول يشوف كل الحالات الأكاديمية" on public.academic_cases;
create policy "المسؤول يشوف كل الحالات الأكاديمية" on public.academic_cases for select using (public.is_admin(auth.uid()));

-- ============ انتهى ============
-- الخطوة التالية: أضف نفسك كمسؤول بعد إنشاء حسابك:
-- insert into public.admins (user_id) values ('ضع-UID-حسابك-هنا');
`;
}


function csvEscape(v){
  if(v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function toCsv(rows){
  if(!rows || !rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => csvEscape(r[c])).join(',')).join('\n');
  return '\uFEFF' + head + '\n' + body;  // BOM لضمان ظهور العربية في Excel
}

function updateBackupProgress(pct, msg){
  document.getElementById('fullBackupBar').style.width = pct + '%';
  document.getElementById('fullBackupMsg').textContent = msg;
}

async function exportFullBackup(){
  if(!isAdmin){
    showToast('هذه الميزة مخصصة للمسؤول فقط.', 'error');
    return;
  }

  const btn = document.getElementById('fullBackupBtn');
  const box = document.getElementById('fullBackupProgress');
  btn.disabled = true;
  box.style.display = 'block';
  updateBackupProgress(3, 'جارٍ تحميل مكتبة الضغط...');

  try{
    await ensureZipLib();
    const zip = new JSZip();

    /* 1) سحب كل الجداول */
    updateBackupProgress(10, 'جارٍ سحب البيانات من قاعدة البيانات...');
    const tables = ['shawahid', 'performance_goals', 'plan_header', 'self_assessment', 'profiles', 'performance_elements', 'admins', 'audit_log', 'classroom_students', 'classroom_grade_levels', 'classroom_sections', 'classroom_incident_types', 'classroom_incidents', 'classroom_letter_counters', 'academic_cases'];
    /* عمود ترتيب ثابت لكل جدول — ضروري لصحّة fetchAllRows: بدون ORDER BY
       صريح لا يضمن Postgres نفس ترتيب الصفوف بين طلبات range() منفصلة، ما
       قد يُسقط أو يكرّر صفوفًا بصمت لجدول كبير. أغلب الجداول لها عمود id،
       والثلاثة المستثناة (مفتاحها الأساسي مركّب/بدون id) لا تتجاوز عمليًا
       صفًا واحدًا لكل معلم فلن تحتاج أكثر من صفحة واحدة أصلًا. */
    const orderColumns = { plan_header: 'cycle_year', admins: 'added_at', classroom_letter_counters: 'updated_at' };
    const data = {};
    for(const t of tables){
      try{
        /* نسخة احتياطية كاملة يجب ألا تفقد صفوفًا بصمت لو تجاوز جدول ما حد
           الصفوف الافتراضي للاستعلام الواحد (1000) — نجلبها صفحات متتالية */
        const orderCol = orderColumns[t] || 'id';
        const { data: rows } = await fetchAllRows((from, to) => sb.from(t).select('*').order(orderCol, { ascending: true }).range(from, to));
        data[t] = rows || [];
      } catch(e){ data[t] = []; }
    }

    /* 2) ملف JSON شامل */
    updateBackupProgress(25, 'جارٍ تجهيز ملفات البيانات...');
    const meta = (currentUser && currentUser.user_metadata) || {};
    const backup = {
      exported_at: new Date().toISOString(),
      exported_by: { name: meta.full_name || '', email: currentUser.email },
      cycle_year: getCycleYear(),
      counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
      tables: data
    };
    zip.file('backup-full.json', JSON.stringify(backup, null, 2));

    /* 3) ملفات CSV مقروءة في Excel */
    const csvFolder = zip.folder('csv');
    for(const t of tables){
      if(data[t].length) csvFolder.file(t + '.csv', toCsv(data[t]));
    }

    /* 3ب) ملف SQL لإعادة بناء البنية كاملة من الصفر */
    zip.file('01-schema.sql', buildSchemaSql());

    /* 3ج) دليل الاستعادة خطوة بخطوة */
    const restoreGuide = [
      'دليل استعادة نظام شاهد الأداء الوظيفي',
      '='.repeat(50),
      '',
      'هذه النسخة تحتوي على كل ما يلزم لإعادة بناء النظام من الصفر.',
      '',
      '── الخطوة 1: إنشاء مشروع Supabase جديد ──',
      '  1. ادخل supabase.com وأنشئ مشروعًا جديدًا',
      '  2. انسخ من Project Settings ← API قيمتي:',
      '     • Project URL',
      '     • anon public key',
      '',
      '── الخطوة 2: إعادة بناء البنية ──',
      '  1. افتح SQL Editor في المشروع الجديد',
      '  2. الصق محتوى ملف 01-schema.sql كاملًا',
      '  3. اضغط Run — يجب أن تظهر رسالة Success',
      '  (هذا ينشئ: الجداول، الصلاحيات، الدوال، المشغّلات، مساحة الصور)',
      '',
      '── الخطوة 3: تحديث ملف الموقع ──',
      '  1. افتح ملف HTML الخاص بالتطبيق في محرر نصوص',
      '  2. ابحث عن السطرين:',
      '     const SUPABASE_URL = "..."',
      '     const SUPABASE_ANON_KEY = "..."',
      '  3. استبدلهما بالقيمتين الجديدتين من الخطوة 1',
      '  4. ارفع الملف على Netlify',
      '',
      '── الخطوة 4: إعادة إنشاء الحسابات ──',
      '  ملاحظة مهمة: حسابات الدخول (كلمات المرور) لا تُنسخ لأسباب أمنية.',
      '  يحتاج كل معلم إنشاء حساب جديد بنفس بريده الإلكتروني.',
      '  بعد تسجيله، اربط بياناته القديمة عبر تحديث user_id في الجداول.',
      '',
      '── الخطوة 5: استعادة البيانات ──',
      '  الطريقة الأسهل: من Table Editor ← اختر الجدول ← Insert ← Import data from CSV',
      '  ارفع ملفات مجلد csv/ واحدًا تلو الآخر بالترتيب التالي:',
      '     1. profiles.csv',
      '     2. performance_elements.csv',
      '     3. admins.csv',
      '     4. shawahid.csv',
      '     5. performance_goals.csv',
      '     6. plan_header.csv',
      '     7. self_assessment.csv',
      '     8. classroom_grade_levels.csv',
      '     9. classroom_sections.csv',
      '     10. classroom_incident_types.csv (أو أدخلها يدويًا — راجع الملاحظة أعلى 01-schema.sql)',
      '     11. classroom_students.csv',
      '     12. classroom_incidents.csv',
      '     13. classroom_letter_counters.csv',
      '     14. academic_cases.csv',
      '',
      '── الخطوة 6: استعادة الصور ──',
      '  من Storage ← shawahid-photos ← ارفع محتويات مجلد photos/ (شواهد الأداء، وصور توثيق تحويلات إدارة الصف والمتابعة الأكاديمية معًا)',
      '  ثم حدّث حقل photo_urls في جدول shawahid، وحقل referral_receipt_photo_url في جدولَي classroom_incidents وacademic_cases، بالروابط الجديدة.',
      '',
      '── الخطوة 7: تعيين المسؤول ──',
      '  من Authentication ← Users انسخ UID حسابك، ثم في SQL Editor:',
      "  insert into public.admins (user_id) values ('UID-هنا');",
      '',
      '='.repeat(50),
      'ملاحظة: الاستعادة الكاملة عملية تقنية — يُنصح بالاستعانة بمختص عند الحاجة.'
    ].join('\n');
    zip.file('00-دليل-الاستعادة.txt', '\uFEFF' + restoreGuide);

    /* 4) ملف ملخص نصي */
    const summary = [
      'النسخة الاحتياطية الشاملة — نظام شاهد الأداء الوظيفي',
      '='.repeat(50),
      `تاريخ التصدير: ${new Date().toLocaleString('ar-SA')}`,
      `المصدِّر: ${meta.full_name || ''} (${currentUser.email})`,
      `دورة الأداء: ${getCycleYear()}`,
      '',
      'محتوى النسخة:',
      ...tables.map(t => `  • ${t}: ${data[t].length} سجل`),
      '',
      'المجلدات والملفات:',
      '  • 00-دليل-الاستعادة.txt   خطوات استعادة النظام كاملًا',
      '  • 01-schema.sql           سكربت إعادة بناء البنية (جداول + صلاحيات + دوال)',
      '  • backup-full.json        كل البيانات بصيغة قابلة للاستيراد',
      '  • csv/                    ملفات Excel مقروءة لكل جدول',
      '  • photos/                 الصور الفعلية مرتبة حسب المعلم',
      '',
      'هذه النسخة مكتملة: تحتوي على البنية والبيانات والصور معًا.',
      'ما لا تحتويه: كلمات مرور الحسابات (لأسباب أمنية).'
    ].join('\n');
    zip.file('README.txt', '\uFEFF' + summary);

    /* 5) تحميل الصور الفعلية */
    const photosFolder = zip.folder('photos');
    const allPhotos = [];
    (data.shawahid || []).forEach(r => {
      (r.photo_urls || []).forEach((url, i) => {
        allPhotos.push({
          url,
          teacher: (r.teacher_name || 'unknown').replace(/[^\u0600-\u06FF\w]+/g, '_'),
          ref: r.ref_number || String(r.id).slice(0, 8),
          idx: i + 1
        });
      });
    });

    const studentNameById = {};
    (data.classroom_students || []).forEach(s => { studentNameById[s.id] = s.full_name; });
    (data.classroom_incidents || []).forEach(inc => {
      if(inc.referral_receipt_photo_url){
        allPhotos.push({
          url: inc.referral_receipt_photo_url,
          teacher: 'إدارة_الصف_' + (studentNameById[inc.student_id] || 'غير_معروف').replace(/[^\u0600-\u06FF\w]+/g, '_'),
          ref: 'تحويل_' + String(inc.id).slice(0, 8),
          idx: 1
        });
      }
    });
    (data.academic_cases || []).forEach(c => {
      if(c.referral_receipt_photo_url){
        allPhotos.push({
          url: c.referral_receipt_photo_url,
          teacher: 'المتابعة_الأكاديمية_' + (studentNameById[c.student_id] || 'غير_معروف').replace(/[^\u0600-\u06FF\w]+/g, '_'),
          ref: 'إحالة_' + String(c.id).slice(0, 8),
          idx: 1
        });
      }
    });

    let done = 0, failed = 0;
    for(const p of allPhotos){
      done++;
      const pct = 30 + Math.round((done / Math.max(1, allPhotos.length)) * 62);
      updateBackupProgress(pct, `جارٍ تحميل الصور (${done} من ${allPhotos.length})...`);
      try{
        const res = await fetch(p.url);
        if(!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const ext = (p.url.split('.').pop() || 'jpg').split('?')[0].slice(0, 4);
        photosFolder.folder(p.teacher).file(`${p.ref}_${p.idx}.${ext}`, blob);
      } catch(e){ failed++; }
    }

    /* 6) توليد الملف المضغوط */
    updateBackupProgress(95, 'جارٍ ضغط الملف النهائي...');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Shahid-Full-Backup-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);

    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    updateBackupProgress(100, `تم بنجاح — ${data.shawahid.length} شاهد، ${allPhotos.length - failed} صورة، الحجم ${sizeMb} ميجابايت${failed ? ` (تعذّر تحميل ${failed} صورة)` : ''}`);
    showToast('تم تنزيل النسخة الاحتياطية الشاملة', 'ok');
  } catch(err){
    updateBackupProgress(0, 'تعذّر إنشاء النسخة: ' + err.message);
    showToast('تعذّر إنشاء النسخة الاحتياطية', 'error');
  } finally {
    btn.disabled = false;
  }
}

async function showAdminPanel(){
  if(!isAdmin){
    showToast('هذه الصفحة مخصصة للمسؤول فقط.', 'error');
    return;
  }
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('adminView').style.display = 'block';
  document.getElementById('adminStats').innerHTML = '<div class="loading-state">جارِ تحميل الإحصائيات...</div>';

  try{
    /* شواهد كل المعلمين وملفاتهم قد تتجاوز حد الصفوف الافتراضي للاستعلام
       الواحد مع نمو المدرسة عبر السنين — نجلبها صفحات متتالية (fetchAllRows)
       حتى لا تُفقَد بيانات بصمت من إحصائيات/تصدير المسؤول */
    const [recRes, planRes, selfRes, profRes, admRes] = await Promise.all([
      fetchAllRows((from, to) => sb.from('shawahid').select('*').order('created_at', { ascending: false }).range(from, to)),
      sb.from('performance_goals').select('*').eq('cycle_year', getCycleYear()),
      sb.from('self_assessment').select('*').eq('cycle_year', getCycleYear()),
      fetchAllRows((from, to) => sb.from('profiles').select('*').order('created_at', { ascending: false }).range(from, to)),
      sb.from('admins').select('user_id')
    ]);

    adminAllRecords = recRes.data || [];
    adminProfiles = profRes.data || [];
    adminIds = new Set((admRes.data || []).map(a => a.user_id));

    /* عنصر واحد قد يحمل أكثر من هدف (goal_order) — نجمعها هنا بدل الكتابة فوق بعضها */
    adminAllPlans = {};
    (planRes.data || []).forEach(p => {
      adminAllPlans[p.user_id] = adminAllPlans[p.user_id] || {};
      const existing = adminAllPlans[p.user_id][p.element_key];
      if(!existing){
        adminAllPlans[p.user_id][p.element_key] = { ...p, target_count: p.target_count || 0 };
      } else {
        existing.target_count = (existing.target_count || 0) + (p.target_count || 0);
        if(!existing.target_level && p.target_level) existing.target_level = p.target_level;
      }
    });

    adminAllSelf = {};
    (selfRes.data || []).forEach(s => {
      adminAllSelf[s.user_id] = adminAllSelf[s.user_id] || {};
      adminAllSelf[s.user_id][s.element_key] = s;
    });
  } catch(err){
    document.getElementById('adminStats').innerHTML = '<div class="empty-state">تعذّر تحميل البيانات: ' + err.message + '</div>';
    return;
  }

  renderAdminStats();
  renderAdminGrowthChart();
  renderAdminReadiness();
  renderAdminActivity();
  renderAdminByElement();
  renderAdminProfiles();
  renderAdminTeachers();
  loadAuditLog();
  loadElementsMgmt();
}

function toggleAdminBox(boxId, chevronId){
  const box = document.getElementById(boxId);
  const chev = document.getElementById(chevronId);
  if(!box) return;
  const opening = box.style.display === 'none';
  box.style.display = opening ? 'block' : 'none';
  if(chev) chev.textContent = opening ? '▴ إخفاء' : '▾ عرض';
}

/* حساب جاهزية معلم واحد: التخطيط + التوثيق + التقييم الذاتي */
function computeTeacherReadiness(uid){
  const elements = getElementsOrder();
  const plan = adminAllPlans[uid] || {};
  const self = adminAllSelf[uid] || {};
  const recs = adminAllRecords.filter(r => r.user_id === uid);

  const counts = {};
  recs.forEach(r => { counts[r.element_key] = (counts[r.element_key] || 0) + 1; });

  const plannedCount = elements.filter(e => plan[e.key] && (plan[e.key].target_level || plan[e.key].target_count)).length;
  const selfCount = elements.filter(e => self[e.key] && self[e.key].self_level).length;
  const coveredCount = elements.filter(e => (counts[e.key] || 0) > 0).length;

  /* الاكتمال الموزون للتوثيق */
  let weightedDone = 0, totalWeight = 0;
  elements.forEach(e => {
    const w = getElementWeight(e.key);
    if(!w) return;
    totalWeight += w;
    const t = (plan[e.key] || {}).target_count || 0;
    const d = counts[e.key] || 0;
    const ratio = t > 0 ? Math.min(1, d / t) : (d > 0 ? 1 : 0);
    weightedDone += w * ratio;
  });
  const weightedPct = totalWeight ? Math.round((weightedDone / totalWeight) * 100) : 0;

  /* درجة جاهزية عامة: تخطيط 25% + توثيق 50% + تقييم ذاتي 25% */
  const planPct = elements.length ? (plannedCount / elements.length) * 100 : 0;
  const selfPct = elements.length ? (selfCount / elements.length) * 100 : 0;
  const readiness = Math.round(planPct * 0.25 + weightedPct * 0.5 + selfPct * 0.25);

  return {
    plannedCount, selfCount, coveredCount, weightedPct, readiness,
    total: elements.length, shahidCount: recs.length
  };
}

function renderAdminStats(){
  const teacherIds = new Set(adminProfiles.map(p => p.id));
  const activeIds = new Set(adminAllRecords.map(r => r.user_id));
  const box = document.getElementById('adminStats');

  const readinessList = adminProfiles.map(p => computeTeacherReadiness(p.id).readiness);
  const avgReadiness = readinessList.length
    ? Math.round(readinessList.reduce((a, b) => a + b, 0) / readinessList.length) : 0;

  box.innerHTML = `
    <div class="admin-stat-card"><div class="num">${teacherIds.size}</div><div class="lbl">معلم مسجّل</div></div>
    <div class="admin-stat-card"><div class="num">${activeIds.size}</div><div class="lbl">معلم بدأ التوثيق</div></div>
    <div class="admin-stat-card"><div class="num">${adminAllRecords.length}</div><div class="lbl">إجمالي الشواهد</div></div>
    <div class="admin-stat-card"><div class="num">${Object.keys(adminAllPlans).length}</div><div class="lbl">خطة معدّة</div></div>
    <div class="admin-stat-card"><div class="num">${Object.keys(adminAllSelf).length}</div><div class="lbl">تقييم ذاتي</div></div>
    <div class="admin-stat-card"><div class="num">${avgReadiness}%</div><div class="lbl">متوسط الجاهزية</div></div>`;
}

function renderAdminGrowthChart(){
  const box = document.getElementById('adminGrowthChart');
  if(!box) return;
  const weeks = [];
  const now = new Date();
  for(let i = 7; i >= 0; i--){
    const end = new Date(now); end.setDate(now.getDate() - (i * 7));
    const start = new Date(end); start.setDate(end.getDate() - 6);
    weeks.push({ start, end, count: 0 });
  }
  adminAllRecords.forEach(r => {
    if(!r.created_at) return;
    const d = new Date(r.created_at);
    for(const w of weeks){ if(d >= w.start && d <= w.end){ w.count++; break; } }
  });
  const max = Math.max(1, ...weeks.map(w => w.count));
  box.innerHTML = weeks.map(w => `
    <div class="growth-bar-col">
      <span class="growth-bar-count">${w.count}</span>
      <div class="growth-bar" style="height:${Math.max(4, Math.round((w.count / max) * 90))}px;"></div>
      <span class="growth-bar-label">${w.start.getDate()}/${w.start.getMonth()+1}</span>
    </div>`).join('');
}

/* جدول الجاهزية: يربط التخطيط والتوثيق والتقييم لكل معلم */
