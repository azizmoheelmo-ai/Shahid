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
/* schema: اسم الـschema المُولَّد لها السكربت — 'public' افتراضيًا (سلوك
   الاستدعاءات الحالية بلا تغيير إطلاقًا). أي قيمة أخرى (مثل 'staging') تولّد
   نفس البنية بالضبط تحت schema منفصلة بنفس مشروع Supabase — نسخة مطابقة
   حرفيًا، بلا ازدواج صيانة — باستثناء تريجرات auth.users المشتركة عالميًا
   (راجع تعليق @@STAGING_SKIP_START@@ بالأسفل لسبب استبعادها). */
function buildSchemaSql(schema){
  schema = schema || 'public';
  const sql = `-- ============================================================
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

-- ============ 2ب) حماية الدخول (محاولات فاشلة + إحصاء نشاط) ============
-- ملاحظة: كانت هذه الأعمدة/الجدول/الدوال الثلاثة موجودة فعليًا بقاعدة
-- الإنتاج (طُبِّقت مباشرة سابقًا) لكن غائبة تمامًا عن هذا الملف — اكتُشف
-- الغياب أثناء بناء بيئة staging لأول مرة من هذا السكربت (لا من نسخة إنتاج
-- قديمة أصلًا فيها هذه الكائنات)، فكان سيفشل استرجاع الإنتاج من كارثة حقيقية
-- بفقدان حد محاولات الدخول الفاشلة وإحصاء النشاط بصمت (app-03 يستدعيها
-- بـtry/catch فلا يمنع الدخول، لكن الحماية والإحصاء يختفيان).
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists login_count int default 0;
alter table public.profiles add column if not exists active_days int default 0;
alter table public.profiles add column if not exists last_active_date date;

-- (غير مُدرَج عمدًا بقوائم exportFullBackup/exportBackup — نفس منطق
-- personal_access_tokens: سجلّ أمني تقني لا بيانات معلم، ويحمل عناوين بريد
-- محاولات فاشلة قد لا تخص صاحب الحساب نفسه)
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  success boolean not null default false,
  created_at timestamptz not null default now()
);
-- RLS مفعَّلة بلا أي سياسة عمدًا: لا عميل (anon/authenticated) يقرأ أو يكتب
-- بهذا الجدول مباشرة أبدًا — الوصول الوحيد عبر الدوال الثلاث أدناه
-- (security definer، تتجاوز RLS بصلاحية مالك الدالة) فقط.
alter table public.login_attempts enable row level security;

create or replace function public.check_login_allowed(p_email text)
returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare
  recent_failures int;
begin
  select count(*) into recent_failures
    from public.login_attempts
    where email = lower(trim(p_email))
      and success = false
      and created_at > now() - interval '15 minutes';
  return recent_failures < 5;
end;
$$;

create or replace function public.record_login_attempt(p_email text, p_success boolean)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  insert into public.login_attempts (email, success)
  values (lower(trim(p_email)), p_success);
  -- تنظيف تلقائي للسجلات الأقدم من ساعة لتفادي تضخم الجدول
  delete from public.login_attempts where created_at < now() - interval '1 hour';
end;
$$;

create or replace function public.record_login()
returns void
language plpgsql security definer
as $$
declare
  today date := current_date;
  prev_date date;
begin
  select last_active_date into prev_date from public.profiles where id = auth.uid();
  update public.profiles
    set last_login_at = now(),
        login_count = coalesce(login_count, 0) + 1,
        active_days = case
          when prev_date is null or prev_date <> today then coalesce(active_days, 0) + 1
          else coalesce(active_days, 0)
        end,
        last_active_date = today
    where id = auth.uid();
end;
$$;

-- @@STAGING_SKIP_START@@ (راجع buildSchemaSql: auth.users جدول مشترك عالميًا
-- لا يخص أي schema بعينها — تشغيل هذا القسم لبيئة staging يسحب التريجر بنفس
-- الاسم من الإنتاج (auth.users يسمح بتريجر واحد بهذا الاسم لا اثنين) ويحوّله
-- ليكتب بدل ذلك بجدول staging.profiles، فتتعطل مزامنة التسجيل الحقيقي بالإنتاج.
-- لذلك يُستبعد هذا القسم بالكامل عند التوليد لأي schema غير 'public' (بيانات
-- المعلم التجريبي بـstaging تُدرَج يدويًا بدل الاعتماد على هذا التريجر).
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
-- @@STAGING_SKIP_END@@

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

-- ============ 3ب) نماذج تقييم معلم مسند له تكليف إضافي (نشاط طلابي / توجيه صحي / ...) ============
-- بعض المعلمين مُسند لهم تكليف إضافي رسمي (نشاط طلابي، أو توجيه صحي، ...)،
-- ولهم نموذج تقييم مختلف: نفس العناصر الأحد عشر الأساسية لكن بأوزان مخفَّضة
-- (تصبح 70% إجمالًا — نفس القيمة المخفَّضة بصرف النظر عن نوع التكليف تحديدًا،
-- فالنماذج الرسمية المختلفة تتفق جميعها على هذا التخفيض)، زائد عناصر إضافية
-- خاصة بنوع التكليف تحديدًا (30% الباقية) — المجموع يبقى 100%.
-- weight_with_duty: الوزن البديل لهذا العنصر لأي معلم عليه أي تكليف إضافي
-- (NULL = لا فرق، استخدم weight العادي).
-- required_duty_type: لو غير NULL، هذا العنصر لا يظهر إلا لمعلم تكليفه
-- الإضافي (profiles.duty_type) يطابق هذه القيمة تحديدًا.
alter table public.performance_elements add column if not exists weight_with_duty int;
alter table public.performance_elements add column if not exists required_duty_type text;

-- ترحيل من العمودين القديمين الخاصين بالنشاط الطلابي فقط (أول نسخة من هذه
-- الميزة، تدعم تكليفًا واحدًا فقط) للعمودين العامّين أعلاه، ثم حذفهما —
-- بلا تأثير لو لم يكونا موجودين أصلًا (تركيب هذه الميزة لأول مرة).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='performance_elements' and column_name='weight_activity') then
    update public.performance_elements set weight_with_duty = weight_activity where weight_with_duty is null;
    update public.performance_elements set required_duty_type = 'student_activity' where requires_student_activity = true and required_duty_type is null;
    alter table public.performance_elements drop column weight_activity;
    alter table public.performance_elements drop column requires_student_activity;
  end if;
end $$;

-- upsert بمفتاح "key" — يحدّث weight_with_duty/required_duty_type فقط
-- للعناصر الأحد عشر الموجودة أصلًا (لا يمسّ وزنها العادي أو ترتيبها الحالي
-- حتى لو عدّلهما المسؤول سابقًا)، ويُدرج عناصر كل تكليف الخاصة به لو لم تكن
-- موجودة. مستقل تمامًا عن ترتيب تشغيل قسم 9 (تعبئة العناصر الافتراضية).
insert into public.performance_elements (key, label, weight, weight_with_duty, required_duty_type, sort_order) values
  ('أداء الواجبات الوظيفية', 'أداء الواجبات الوظيفية', 10, 10, null, 1),
  ('التفاعل مع المجتمع المهني', 'التفاعل مع المجتمع المهني', 10, 10, null, 2),
  ('التفاعل مع أولياء الأمور', 'التفاعل مع أولياء الأمور', 10, 10, null, 3),
  ('التنويع في استراتيجيات التدريس', 'التنويع في استراتيجيات التدريس', 10, 5, null, 4),
  ('تحسين نتائج المتعلمين', 'تحسين نتائج المتعلمين', 10, 5, null, 5),
  ('إعداد وتنفيذ خطة التعلم', 'إعداد وتنفيذ خطة التعلم', 10, 5, null, 6),
  ('توظيف تقنيات ووسائل التعلم المناسبة', 'توظيف تقنيات ووسائل التعلم المناسبة', 10, 5, null, 7),
  ('تهيئة البيئة التعليمية', 'تهيئة البيئة التعليمية', 5, 5, null, 8),
  ('الإدارة الصفية', 'الإدارة الصفية', 5, 5, null, 9),
  ('تحليل نتائج المتعلمين وتشخيص مستوياتهم', 'تحليل نتائج المتعلمين وتشخيص مستوياتهم', 10, 5, null, 10),
  ('تنوع أساليب التقويم', 'تنوع أساليب التقويم', 10, 5, null, 11),
  ('إعداد خطة مزمنة ومعتمدة لبرامج وفعاليات النشاط الطلابي', 'إعداد خطة مزمنة ومعتمدة لبرامج وفعاليات النشاط الطلابي', 10, 10, 'student_activity', 12),
  ('تهيئة البيئة المدرسية للبرامج والأنشطة الطلابية', 'تهيئة البيئة المدرسية للبرامج والأنشطة الطلابية', 5, 5, 'student_activity', 13),
  ('يدعم المتعلمين وفق احتياجاتهم وميولهم للأنشطة', 'يدعم المتعلمين وفق احتياجاتهم وميولهم للأنشطة', 5, 5, 'student_activity', 14),
  ('يحفز المتعلمين على المشاركة في الأنشطة المدرسية', 'يحفز المتعلمين على المشاركة في الأنشطة المدرسية', 10, 10, 'student_activity', 15),
  ('تنفيذ الخطة المشتركة للبرامج الصحية المدرسية', 'تنفيذ الخطة المشتركة للبرامج الصحية المدرسية', 15, 15, 'health_guidance', 16),
  ('حصر الحالات الصحية للمتعلمين', 'حصر الحالات الصحية للمتعلمين', 5, 5, 'health_guidance', 17),
  ('تهيئة البيئة الصحية المدرسية', 'تهيئة البيئة الصحية المدرسية', 10, 10, 'health_guidance', 18)
on conflict (key) do update set
  weight_with_duty = excluded.weight_with_duty,
  required_duty_type = excluded.required_duty_type;

-- ============ 3ج) نموذج تقييم وكيل مدرسة (دور مختلف كليًا عن المعلم) ============
-- وكيل المدرسة ليس "معلمًا بتكليف إضافي" — هو دور وظيفي مختلف تمامًا، بعناصر
-- تقييم خاصة به بالكامل (19 عنصرًا، أغلبها 5% وواحد 10%)، لا تُبنى على
-- الأحد عشر عنصرًا الأساسية للمعلم إطلاقًا (حتى لو تشابه نص بعضها مع عناصر
-- المعلم كـ"أداء الواجبات الوظيفية" فوزنها هنا مختلف: 5% لا 10%). لهذا مفاتيحها
-- مسبوقة بـ"وكيل: " لضمان عدم تعارضها مع مفتاح عنصر المعلم المطابق نصًا.
-- required_duty_type = 'vice_principal' يُستثنى صراحة من منطق weight_with_duty
-- الخاص بمعلم عليه تكليف إضافي (راجع computeEffectiveElements بـapp-01-core.js) —
-- عناصر الوكيل تُعرض بوزنها المكتوب مباشرة دون أي إعادة حساب.
insert into public.performance_elements (key, label, weight, weight_with_duty, required_duty_type, sort_order) values
  ('وكيل: أداء الواجبات الوظيفية', 'أداء الواجبات الوظيفية', 5, null, 'vice_principal', 19),
  ('وكيل: التفاعل مع المجتمع المهني', 'التفاعل مع المجتمع المهني', 5, null, 'vice_principal', 20),
  ('وكيل: التفاعل مع أولياء الأمور', 'التفاعل مع أولياء الأمور', 5, null, 'vice_principal', 21),
  ('وكيل: مرن وقادر على تنفيذ أعماله في ظل ظروف العمل المختلفة', 'مرن وقادر على تنفيذ أعماله في ظل ظروف العمل المختلفة', 5, null, 'vice_principal', 22),
  ('وكيل: يدعم ويشارك في المبادرات النوعية', 'يدعم ويشارك في المبادرات النوعية', 10, null, 'vice_principal', 23),
  ('وكيل: يتخذ إجراءات تربوية تُحقق الانضباط المدرسي', 'يتخذ إجراءات تربوية تُحقق الانضباط المدرسي', 5, null, 'vice_principal', 24),
  ('وكيل: يُدير الموارد في المدرسة بكفاءة', 'يُدير الموارد في المدرسة بكفاءة', 5, null, 'vice_principal', 25),
  ('وكيل: يُشارك في إعداد خطة للتطوير المهني', 'يُشارك في إعداد خطة للتطوير المهني', 5, null, 'vice_principal', 26),
  ('وكيل: يُقدم التغذية الراجعة ويتابع تحقق مؤشرات الأداء الوظيفي', 'يُقدم التغذية الراجعة ويتابع تحقق مؤشرات الأداء الوظيفي', 5, null, 'vice_principal', 27),
  ('وكيل: يدعم تنفيذ برامج التطوير المهني', 'يدعم تنفيذ برامج التطوير المهني', 5, null, 'vice_principal', 28),
  ('وكيل: يُقيِّم أداء منسوبي المدرسة', 'يُقيِّم أداء منسوبي المدرسة', 5, null, 'vice_principal', 29),
  ('وكيل: يُنفذ إجراءات علمية لتحسين نتائج التعلم', 'يُنفذ إجراءات علمية لتحسين نتائج التعلم', 5, null, 'vice_principal', 30),
  ('وكيل: يُسهم في تحسين مستوى أداء المدرسة', 'يُسهم في تحسين مستوى أداء المدرسة', 5, null, 'vice_principal', 31),
  ('وكيل: يُشارك في إعداد الخطط المدرسية اللازمة', 'يُشارك في إعداد الخطط المدرسية اللازمة', 5, null, 'vice_principal', 32),
  ('وكيل: يُتابع تنفيذ الخطط المدرسية بمختلف أنواعها', 'يُتابع تنفيذ الخطط المدرسية بمختلف أنواعها', 5, null, 'vice_principal', 33),
  ('وكيل: يُهيئ الفرص والإمكانات الداعمة لمشاركة الطلاب في الأنشطة الصفية وغير الصفية', 'يُهيئ الفرص والإمكانات الداعمة لمشاركة الطلاب في الأنشطة الصفية وغير الصفية', 5, null, 'vice_principal', 34),
  ('وكيل: يُوظف المنصات الرقمية وتطبيقاتها المعتمدة في دعم عمليات التعليم والتعلم', 'يُوظف المنصات الرقمية وتطبيقاتها المعتمدة في دعم عمليات التعليم والتعلم', 5, null, 'vice_principal', 35),
  ('وكيل: يُتابع تعزيز السلوك الإيجابي للطلاب', 'يُتابع تعزيز السلوك الإيجابي للطلاب', 5, null, 'vice_principal', 36),
  ('وكيل: يُهيئ بيئةً مدرسيةً آمنةً ومحفزةً على التعلم', 'يُهيئ بيئةً مدرسيةً آمنةً ومحفزةً على التعلم', 5, null, 'vice_principal', 37)
on conflict (key) do update set
  weight = excluded.weight,
  required_duty_type = excluded.required_duty_type;

-- ============ 3د) نموذج تقييم مدير مدرسة (دور مختلف كليًا عن المعلم أيضًا) ============
-- بنفس منطق وكيل المدرسة تمامًا (دور مستقل، لا "تكليف إضافي")، لكن بعناصره
-- الخاصة به — تتشابه نصًا مع عناصر الوكيل غالبًا لكن بأوزان مختلفة أحيانًا
-- (مثال: "يُسهم في تحسين مستوى أداء المدرسة" 10% هنا مقابل 5% عند الوكيل)،
-- وصياغة بعضها تفترض أن المدير "يُعدّ" الخطط مباشرة لا "يُشارك في إعدادها"
-- كالوكيل. لهذا مفاتيحها منفصلة تمامًا (مسبوقة بـ"مدير: ").
insert into public.performance_elements (key, label, weight, weight_with_duty, required_duty_type, sort_order) values
  ('مدير: أداء الواجبات الوظيفية', 'أداء الواجبات الوظيفية', 5, null, 'school_principal', 38),
  ('مدير: التفاعل مع المجتمع المهني', 'التفاعل مع المجتمع المهني', 5, null, 'school_principal', 39),
  ('مدير: التفاعل مع أولياء الأمور', 'التفاعل مع أولياء الأمور', 5, null, 'school_principal', 40),
  ('مدير: مرن وقادر على تنفيذ أعماله في ظل ظروف العمل المختلفة', 'مرن وقادر على تنفيذ أعماله في ظل ظروف العمل المختلفة', 5, null, 'school_principal', 41),
  ('مدير: يدعم ويشارك في المبادرات النوعية', 'يدعم ويشارك في المبادرات النوعية', 5, null, 'school_principal', 42),
  ('مدير: يتخذ إجراءات تربوية تُحقق الانضباط المدرسي', 'يتخذ إجراءات تربوية تُحقق الانضباط المدرسي', 5, null, 'school_principal', 43),
  ('مدير: يُدير الموارد في المدرسة بكفاءة', 'يُدير الموارد في المدرسة بكفاءة', 5, null, 'school_principal', 44),
  ('مدير: يُعد خطة للتطوير المهني', 'يُعد خطة للتطوير المهني', 5, null, 'school_principal', 45),
  ('مدير: يُقدم التغذية الراجعة ويتابع تحقق مؤشرات الأداء الوظيفي', 'يُقدم التغذية الراجعة ويتابع تحقق مؤشرات الأداء الوظيفي', 5, null, 'school_principal', 46),
  ('مدير: يدعم تنفيذ برامج التطوير المهني', 'يدعم تنفيذ برامج التطوير المهني', 5, null, 'school_principal', 47),
  ('مدير: يُقيّم أداء منسوبي المدرسة', 'يُقيّم أداء منسوبي المدرسة', 5, null, 'school_principal', 48),
  ('مدير: يُنفذ إجراءات علمية لتحسين نتائج التعلم', 'يُنفذ إجراءات علمية لتحسين نتائج التعلم', 5, null, 'school_principal', 49),
  ('مدير: يُسهم في تحسين مستوى أداء المدرسة', 'يُسهم في تحسين مستوى أداء المدرسة', 10, null, 'school_principal', 50),
  ('مدير: يُعد الخطط المدرسية اللازمة', 'يُعد الخطط المدرسية اللازمة', 5, null, 'school_principal', 51),
  ('مدير: يُتابع تنفيذ الخطط المدرسية بمختلف أنواعها', 'يُتابع تنفيذ الخطط المدرسية بمختلف أنواعها', 5, null, 'school_principal', 52),
  ('مدير: يُهيئ الفرص والإمكانات الداعمة لمشاركة الطلاب في الأنشطة الصفية وغير الصفية', 'يُهيئ الفرص والإمكانات الداعمة لمشاركة الطلاب في الأنشطة الصفية وغير الصفية', 5, null, 'school_principal', 53),
  ('مدير: يُوظف المنصات الرقمية وتطبيقاتها المعتمدة في دعم عمليات التعليم والتعلم', 'يُوظف المنصات الرقمية وتطبيقاتها المعتمدة في دعم عمليات التعليم والتعلم', 5, null, 'school_principal', 54),
  ('مدير: يتابع تعزيز السلوك الإيجابي للطلاب', 'يتابع تعزيز السلوك الإيجابي للطلاب', 5, null, 'school_principal', 55),
  ('مدير: يُهيئ بيئةً مدرسيةً آمنةً ومحفزةً على التعلم', 'يُهيئ بيئةً مدرسيةً آمنةً ومحفزةً على التعلم', 5, null, 'school_principal', 56)
on conflict (key) do update set
  weight = excluded.weight,
  required_duty_type = excluded.required_duty_type;

-- ============ 3هـ) نموذج تقييم موجه طلابي (دور مختلف كليًا عن المعلم أيضًا) ============
-- بنفس منطق الوكيل/المدير (دور مستقل، لا "تكليف إضافي")، لكن بعناصره الـ13
-- الخاصة به — يشترك مع الوكيل/المدير بنفس أول 3 عناصر نصًا لكن بوزن مختلف
-- تمامًا هنا ("أداء الواجبات الوظيفية" 20% لا 5%). لهذا مفاتيحها منفصلة
-- تمامًا (مسبوقة بـ"موجه: ").
insert into public.performance_elements (key, label, weight, weight_with_duty, required_duty_type, sort_order) values
  ('موجه: أداء الواجبات الوظيفية', 'أداء الواجبات الوظيفية', 20, null, 'student_counselor', 57),
  ('موجه: التفاعل مع المجتمع المهني', 'التفاعل مع المجتمع المهني', 5, null, 'student_counselor', 58),
  ('موجه: التفاعل مع أولياء الأمور', 'التفاعل مع أولياء الأمور', 5, null, 'student_counselor', 59),
  ('موجه: يُقدم التدخلات المناسبة لتعزيز الانضباط', 'يُقدم التدخلات المناسبة لتعزيز الانضباط', 5, null, 'student_counselor', 60),
  ('موجه: تقديم برامج تربوية لتعزيز دافعية الطلبة للتعلم', 'تقديم برامج تربوية لتعزيز دافعية الطلبة للتعلم', 5, null, 'student_counselor', 61),
  ('موجه: إعداد خُطة لبرامج التوجيه الطلابي', 'إعداد خُطة لبرامج التوجيه الطلابي', 10, null, 'student_counselor', 62),
  ('موجه: يُصنف الحالات ويُقدم برامج الدعم المناسبة', 'يُصنف الحالات ويُقدم برامج الدعم المناسبة', 10, null, 'student_counselor', 63),
  ('موجه: يُعزز القيم والسلوكيات للمتعلمين', 'يُعزز القيم والسلوكيات للمتعلمين', 10, null, 'student_counselor', 64),
  ('موجه: يُقدم التدخلات النفسية والاجتماعية', 'يُقدم التدخلات النفسية والاجتماعية', 10, null, 'student_counselor', 65),
  ('موجه: يُساعد المتعلمين على التخطيط المهني والتعليمي', 'يُساعد المتعلمين على التخطيط المهني والتعليمي', 5, null, 'student_counselor', 66),
  ('موجه: يُعزز التفوق الدراسي', 'يُعزز التفوق الدراسي', 5, null, 'student_counselor', 67),
  ('موجه: يُقدم تدخلات تربوية للمتأخرين دراسيًا والمعيدين', 'يُقدم تدخلات تربوية للمتأخرين دراسيًا والمعيدين', 5, null, 'student_counselor', 68),
  ('موجه: توعية المتعلمين وأولياء أمورهم بقواعد السلوك والمواظبة', 'توعية المتعلمين وأولياء أمورهم بقواعد السلوك والمواظبة', 5, null, 'student_counselor', 69)
on conflict (key) do update set
  weight = excluded.weight,
  required_duty_type = excluded.required_duty_type;

-- ============ 3و) نموذج تقييم محضر مختبر (دور مختلف كليًا عن المعلم أيضًا) ============
-- بنفس منطق الأدوار المستقلة السابقة، لكن بفارق: أول 5 عناصر هنا (لا 3)
-- مطابقة نصًا ووزنًا لعناصر المعلم الأساسية (10% لكل منها) — رغم ذلك مفاتيحها
-- منفصلة تمامًا (مسبوقة بـ"محضر: ") بدل إعادة استخدام مفاتيح المعلم، حفاظًا
-- على استقلالية كاملة لهذا الدور (كبقية STANDALONE_ROLES) وتبسيطًا لمنطق
-- computeEffectiveElements — لا حاجة لحالة خاصة تُميّز "عنصر مشترك نصًا مع
-- المعلم لكن ضمن دور مستقل" عن بقية عناصر الدور.
insert into public.performance_elements (key, label, weight, weight_with_duty, required_duty_type, sort_order) values
  ('محضر: أداء الواجبات الوظيفية', 'أداء الواجبات الوظيفية', 10, null, 'lab_technician', 70),
  ('محضر: التفاعل مع المجتمع المهني', 'التفاعل مع المجتمع المهني', 10, null, 'lab_technician', 71),
  ('محضر: التفاعل مع أولياء الأمور', 'التفاعل مع أولياء الأمور', 10, null, 'lab_technician', 72),
  ('محضر: التنويع في إستراتيجيات التدريس', 'التنويع في إستراتيجيات التدريس', 10, null, 'lab_technician', 73),
  ('محضر: تحسين نتائج المتعلمين', 'تحسين نتائج المتعلمين', 10, null, 'lab_technician', 74),
  ('محضر: يُعد خطةً يوميةً لأنشطة المختبر', 'يُعد خطةً يوميةً لأنشطة المختبر', 5, null, 'lab_technician', 75),
  ('محضر: المعرفة بالأسس والمفاهيم الفنية', 'المعرفة بالأسس والمفاهيم الفنية', 5, null, 'lab_technician', 76),
  ('محضر: يُوفر المستلزمات اللازمة لأداء التجارب العلمية', 'يُوفر المستلزمات اللازمة لأداء التجارب العلمية', 5, null, 'lab_technician', 77),
  ('محضر: يلتزم بسياسات وإجراءات السلامة المهنية', 'يلتزم بسياسات وإجراءات السلامة المهنية', 5, null, 'lab_technician', 78),
  ('محضر: يُحضر ويُجهز المختبر', 'يُحضر ويُجهز المختبر', 5, null, 'lab_technician', 79),
  ('محضر: تهيئة وتسليم الأجهزة المطلوبة للمعلمين وتخزينها بطريقة سليمة', 'تهيئة وتسليم الأجهزة المطلوبة للمعلمين وتخزينها بطريقة سليمة', 5, null, 'lab_technician', 80),
  ('محضر: يُعد تقرير أنشطة ومهام المختبر الأسبوعية', 'يُعد تقرير أنشطة ومهام المختبر الأسبوعية', 10, null, 'lab_technician', 81),
  ('محضر: يُعد تقارير دورية عن حالة الأجهزة والمعدات', 'يُعد تقارير دورية عن حالة الأجهزة والمعدات', 10, null, 'lab_technician', 82)
on conflict (key) do update set
  weight = excluded.weight,
  required_duty_type = excluded.required_duty_type;

alter table public.profiles add column if not exists duty_type text not null default 'none';
alter table public.profiles drop constraint if exists profiles_duty_type_check;
alter table public.profiles add constraint profiles_duty_type_check check (duty_type in ('none', 'student_activity', 'health_guidance', 'vice_principal', 'school_principal', 'student_counselor', 'lab_technician'));

-- ترحيل من العمود القديم الخاص بالنشاط الطلابي فقط، ثم حذفه — بلا تأثير لو
-- لم يكن موجودًا أصلًا (تركيب هذه الميزة لأول مرة).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='has_student_activity') then
    update public.profiles set duty_type = 'student_activity' where has_student_activity = true and duty_type = 'none';
    alter table public.profiles drop column has_student_activity;
  end if;
end $$;

drop function if exists public.set_student_activity_flag(uuid, boolean);

-- تعديل هذا الحقل تحديدًا (المعلم لنفسه، أو المسؤول لأي معلم) عبر دالة
-- مضبوطة بدل سياسة RLS عامة على الجدول — لو أضفنا سياسة "المعلم يعدّل
-- ملفه" عامة، يصير بإمكانه تعديل أي عمود آخر بالصف (مثل disabled) بالخطأ.
-- هذه الدالة تتحقق صراحة أن المستدعي إمّا صاحب الحساب نفسه أو مسؤول، وأن
-- القيمة المطلوبة من ضمن الأنواع المعروفة، ولا تلمس أي عمود غير duty_type.
create or replace function public.set_duty_type(target_user_id uuid, duty text)
returns void as $$
begin
  if duty not in ('none', 'student_activity', 'health_guidance', 'vice_principal', 'school_principal', 'student_counselor', 'lab_technician') then
    raise exception 'نوع تكليف غير معروف: %', duty;
  end if;
  if auth.uid() <> target_user_id and not public.is_admin(auth.uid()) then
    raise exception 'غير مصرح لك بتعديل هذا الحساب';
  end if;
  update public.profiles set duty_type = duty where id = target_user_id;
end;
$$ language plpgsql security definer;

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

/* أُضيفا لاحقًا (ربط شاهد بهدف محدد بالخطة + تصنيف كل شاهد على دورة أدائه) —
   IF NOT EXISTS يجعل هذا آمنًا للتشغيل حتى لو كانا مضافين مسبقًا، وضروري
   لأي قاعدة أُنشئت من نسخة سابقة من هذا الملف لا تتضمنهما: بدونهما يفشل كل
   استعلام في loadPlan() على shawahid بصمت (عمود غير موجود)، فتظهر الخطة
   والنسبة الموزونة فارغتين رغم أن بيانات الخطة نفسها سليمة تمامًا.
   ملاحظة: عمود goal_id بالذات (مرجع FK لـperformance_goals) يُضاف لاحقًا
   بالملف بعد إنشاء ذلك الجدول (قسم 5) لا هنا — راجع تعليقه هناك؛ إنشاؤه هنا
   كان يفشل فعليًا عند تشغيل هذا الملف كاملًا على مشروع جديد فارغ (الغرض
   المعلن بأعلى الملف) لأن performance_goals لم يكن موجودًا بعد بهذه النقطة. */
alter table public.shawahid add column if not exists cycle_year text;

/* أُضيف لاحقًا أيضًا (تصنيف كل شاهد على مرحلة دورة الأداء وقت توثيقه —
   getCycleStageKey بـapp-03) — غائب هنا بنفس سبب غياب login_attempts أعلاه:
   لم يُكتشف غيابه إلا أول تشغيل فعلي لهذا الملف من الصفر (بيئة staging)،
   حيث فشل saveShahid فعليًا بخطأ "Could not find the 'cycle_stage' column
   of 'shawahid' in the schema cache" عند أول محاولة حفظ حقيقية. */
alter table public.shawahid add column if not exists cycle_stage text;

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

-- ============ 4ج) برامج الأنشطة الطلابية متعددة الحصص ============
-- كيان خفيف: المعلم يخطط لبرنامج (مثل "الإسعافات الأولية" على 4 حصص موزّعة
-- على أسابيع الفصل)، وكل حصة يوثّقها لاحقًا تصبح شاهدًا مستقلاً بجدول
-- shawahid (عمودا program_id/program_session_no أدناه) — البرنامج نفسه لا
-- يُحسب كشاهد، فقط الحصص الموثَّقة فعليًا. sessions تخزّن خطة الجدول
-- الزمني وحالة كل حصة: [{session_no, week_label, done, done_date, shahid_id}].
create table if not exists public.activity_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  total_sessions int not null check (total_sessions between 1 and 30),
  student_count int,
  element_key text,
  cycle_year text,
  sessions jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.activity_programs enable row level security;

drop policy if exists "المعلم يشوف برامجه فقط" on public.activity_programs;
create policy "المعلم يشوف برامجه فقط"
  on public.activity_programs for select using (auth.uid() = user_id);

drop policy if exists "المعلم يضيف برنامجًا لنفسه فقط" on public.activity_programs;
create policy "المعلم يضيف برنامجًا لنفسه فقط"
  on public.activity_programs for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يعدّل برامجه فقط" on public.activity_programs;
create policy "المعلم يعدّل برامجه فقط"
  on public.activity_programs for update using (auth.uid() = user_id);

drop policy if exists "المعلم يحذف برامجه فقط" on public.activity_programs;
create policy "المعلم يحذف برامجه فقط"
  on public.activity_programs for delete using (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل البرامج" on public.activity_programs;
create policy "المسؤول يشوف كل البرامج"
  on public.activity_programs for select using (public.is_admin(auth.uid()));

create or replace function public.set_activity_program_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql security definer;

drop trigger if exists trg_activity_program_updated_at on public.activity_programs;
create trigger trg_activity_program_updated_at
before update on public.activity_programs
for each row execute function public.set_activity_program_updated_at();

-- ربط اختياري لكل شاهد بالحصة/البرنامج الذي وثّقه (لو كان أصلاً جزءًا من
-- برنامج متعدد الحصص) — nullable بالكامل، فلا يؤثر على أي شاهد عادي حالي.
alter table public.shawahid add column if not exists program_id uuid references public.activity_programs(id) on delete set null;
alter table public.shawahid add column if not exists program_session_no int;

-- ============ 4د) رسائل الدعم من المعلمين ("تواصل معنا") ============
-- المعلم يرسل رسالة نصية + صورة اختيارية (تُرفع بنفس حاوية shawahid-photos
-- ضمن مجلده الخاص user_id/support/...، فتشملها سياسات الحاوية الحالية
-- دون أي إعداد إضافي). المسؤول وحده يشوف كل الرسائل ويحدّث حالتها.
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  teacher_name text,
  teacher_email text,
  message text not null,
  photo_url text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table public.support_messages enable row level security;

drop policy if exists "المعلم يضيف رسالته فقط" on public.support_messages;
create policy "المعلم يضيف رسالته فقط"
  on public.support_messages for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يشوف رسائله فقط" on public.support_messages;
create policy "المعلم يشوف رسائله فقط"
  on public.support_messages for select using (auth.uid() = user_id);

drop policy if exists "المسؤول يشوف كل رسائل الدعم" on public.support_messages;
create policy "المسؤول يشوف كل رسائل الدعم"
  on public.support_messages for select using (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يحدّث حالة رسائل الدعم" on public.support_messages;
create policy "المسؤول يحدّث حالة رسائل الدعم"
  on public.support_messages for update using (public.is_admin(auth.uid()));

drop policy if exists "المسؤول يحذف رسائل الدعم" on public.support_messages;
create policy "المسؤول يحذف رسائل الدعم"
  on public.support_messages for delete using (public.is_admin(auth.uid()));

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

-- ربط اختياري لكل شاهد بهدف محدد بالخطة — لازم يجي هنا بعد إنشاء الجدول
-- مباشرة، لا قبله بقسم (4) الشواهد (راجع تعليق cycle_year هناك لسبب النقل).
alter table public.shawahid add column if not exists goal_id uuid references public.performance_goals(id) on delete set null;

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

/* شبكة أمان: لو كان هذا الجدول أُنشئ بقاعدة بيانات سابقًا (بنسخة قديمة من
   هذا الملف) بلا هذا المفتاح الأساسي — "create table if not exists" أعلاه
   لا يضيفه رجعيًا لجدول موجود مسبقًا. بدونه، upsert(...,{onConflict:
   'user_id,cycle_year'}) بكود التطبيق يتحول لإدراج (insert) عادي في كل
   حفظ بدل تحديث الصف الموجود، فتتراكم صفوف مكررة لنفس المعلم ونفس الدورة —
   وأي قراءة لاحقة عبر .maybeSingle() (loadPlan) تفشل فورًا برسالة "JSON
   object requested, multiple (or no) rows returned"، فتظهر الخطة والنسبة
   الموزونة فارغتين رغم أن بيانات الخطة (performance_goals) نفسها سليمة. */
delete from public.plan_header a
using public.plan_header b
where a.user_id = b.user_id
  and a.cycle_year = b.cycle_year
  and (a.updated_at, a.ctid) < (b.updated_at, b.ctid);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plan_header'::regclass and contype = 'p'
  ) then
    alter table public.plan_header add primary key (user_id, cycle_year);
  end if;
end $$;

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
drop policy if exists "المعلم يدير مراحله فقط - تعديل" on public.classroom_grade_levels;
create policy "المعلم يدير مراحله فقط - تعديل" on public.classroom_grade_levels for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

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
drop policy if exists "المعلم يدير شعبه فقط - تعديل" on public.classroom_sections;
create policy "المعلم يدير شعبه فقط - تعديل" on public.classroom_sections for update using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- ربط الطالب بشعبته بالمعرّف (section_id) — المرجع الفعلي للشعبة؛ نصّا
-- grade_level/section_number يبقيان نسخة مكتوبة بالاسم الرسمي للكود القديم.
-- المفتاح المركّب (section_id, teacher_id) يمنع ربط طالب بشعبة معلم آخر.
-- يجب أن يأتي بعد إنشاء classroom_sections (مرجع FK) لا داخل تعريف
-- classroom_students أعلاه. حذف الشعبة يفكّ الربط فقط (set null) ولا يحذف طلابها.
-- (فحص وجود القيد بدل drop/add: القيد الفريد تعتمد عليه مفاتيح خارجية، فحذفه
-- عند إعادة تشغيل الملف يفشل)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_sections_id_teacher_key' and conrelid = 'public.classroom_sections'::regclass) then
    alter table public.classroom_sections add constraint classroom_sections_id_teacher_key unique (id, teacher_id);
  end if;
end $$;
alter table public.classroom_students add column if not exists section_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_students_section_fk' and conrelid = 'public.classroom_students'::regclass) then
    alter table public.classroom_students add constraint classroom_students_section_fk foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete set null (section_id);
  end if;
end $$;
create index if not exists classroom_students_section_id_idx on public.classroom_students(section_id);

-- ربط برامج الأنشطة بالشُعب (اختياري، تعدد-لتعدد) — استخدام فعلي للتخطيط:
-- عدّ الطلبة التلقائي وتحذير تعارض الجدولة بين برامج مختلفة بنفس الشعبة
-- بنفس الأسبوع (راجع app-10-programs.js). حذف تلقائي للرابط عند حذف
-- البرنامج أو الشعبة (on delete cascade) — لا مراجع يتيمة.
create table if not exists public.program_sections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references auth.users(id) on delete cascade not null,
  program_id uuid references public.activity_programs(id) on delete cascade not null,
  section_id uuid references public.classroom_sections(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(program_id, section_id)
);
alter table public.program_sections enable row level security;
drop policy if exists "المعلم يشوف روابط برامجه فقط" on public.program_sections;
create policy "المعلم يشوف روابط برامجه فقط" on public.program_sections for select using (auth.uid() = teacher_id);
drop policy if exists "المعلم يربط برامجه فقط" on public.program_sections;
create policy "المعلم يربط برامجه فقط" on public.program_sections for insert with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يحذف روابط برامجه فقط" on public.program_sections;
create policy "المعلم يحذف روابط برامجه فقط" on public.program_sections for delete using (auth.uid() = teacher_id);

-- أي شاهد يوثّق حصة من برنامج مرتبط بأكثر من شعبة يُسجَّل بشعبته المحدَّدة
-- هنا (توثيق كل شعبة بوقتها الخاص بشاهد مستقل) — nullable، وعلى delete set
-- null لا تتأثر بقية بيانات الشاهد لو حُذفت الشعبة لاحقًا. يجب أن يأتي هذا
-- بعد إنشاء classroom_sections أعلاه (مرجع FK)، لا بجانب عمودي program_id/
-- program_session_no الأقدم (قبل إنشاء classroom_sections بمئات الأسطر).
alter table public.shawahid add column if not exists program_section_id uuid references public.classroom_sections(id) on delete set null;

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
-- الشعبة وقت وقوع المخالفة (لا شعبة الطالب الحالية لو نُقل لاحقًا)
alter table public.classroom_incidents add column if not exists section_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_incidents_section_fk' and conrelid = 'public.classroom_incidents'::regclass) then
    alter table public.classroom_incidents add constraint classroom_incidents_section_fk foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete set null (section_id);
  end if;
end $$;
create index if not exists classroom_incidents_section_id_idx on public.classroom_incidents(section_id);

-- ============ إدارة الصف: الجدول الأسبوعي والحصص المرصودة والحضور ============
-- بلا أي سياسة للمسؤول (قرار صريح: لا صلاحية حتى تُبنى شاشة تحتاجها).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_students_id_teacher_key' and conrelid = 'public.classroom_students'::regclass) then
    alter table public.classroom_students add constraint classroom_students_id_teacher_key unique (id, teacher_id);
  end if;
end $$;

-- يوم + رقم حصة ← شعبة (بلا أوقات عمدًا)
create table if not exists public.classroom_timetable_slots (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null,
  academic_year text not null,
  semester smallint not null check (semester in (1, 2)),
  weekday smallint not null check (weekday between 0 and 6),
  period smallint not null check (period between 1 and 12),
  created_at timestamptz not null default now(),
  unique (teacher_id, academic_year, semester, weekday, period),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete cascade
);

-- الحصة المرصودة (وجودها = رُصدت). حذف شعبة لها حصص مرصودة يُمنع.
create table if not exists public.classroom_lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null,
  lesson_date date not null,
  period smallint check (period between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade
);
create unique index if not exists classroom_lessons_unique_period on public.classroom_lessons(section_id, lesson_date, period) where period is not null;
create unique index if not exists classroom_lessons_unique_no_period on public.classroom_lessons(section_id, lesson_date) where period is null;
create index if not exists classroom_lessons_teacher_date_idx on public.classroom_lessons(teacher_id, lesson_date);

-- الاستثناءات فقط: الطالب بلا صف هنا في حصة مرصودة = حاضر
create table if not exists public.classroom_attendance (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  status text not null check (status in ('absent', 'late', 'permitted_exit')),
  created_at timestamptz not null default now(),
  unique (lesson_id, student_id),
  foreign key (lesson_id, teacher_id) references public.classroom_lessons(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_attendance_student_idx on public.classroom_attendance(student_id);

alter table public.classroom_timetable_slots enable row level security;
alter table public.classroom_lessons enable row level security;
alter table public.classroom_attendance enable row level security;
drop policy if exists "المعلم يدير جدوله فقط" on public.classroom_timetable_slots;
create policy "المعلم يدير جدوله فقط" on public.classroom_timetable_slots for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير حصصه المرصودة فقط" on public.classroom_lessons;
create policy "المعلم يدير حصصه المرصودة فقط" on public.classroom_lessons for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير حضور طلابه فقط" on public.classroom_attendance;
create policy "المعلم يدير حضور طلابه فقط" on public.classroom_attendance for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- حفظ رصد حصة كعملية واحدة (الحصة + استثناءاتها) — security invoker: RLS تنطبق
create or replace function public.save_lesson_attendance(
  p_section_id uuid, p_lesson_date date, p_period smallint, p_exceptions jsonb
) returns uuid
language plpgsql security invoker set search_path = ''
as $body$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id into v_id from public.classroom_lessons
    where teacher_id = v_uid and section_id = p_section_id and lesson_date = p_lesson_date
      and period is not distinct from p_period;
  if v_id is null then
    begin
      insert into public.classroom_lessons (teacher_id, section_id, lesson_date, period)
        values (v_uid, p_section_id, p_lesson_date, p_period) returning id into v_id;
    exception when unique_violation then
      select id into v_id from public.classroom_lessons
        where teacher_id = v_uid and section_id = p_section_id and lesson_date = p_lesson_date
          and period is not distinct from p_period;
    end;
  else
    update public.classroom_lessons set updated_at = now() where id = v_id;
  end if;
  delete from public.classroom_attendance where lesson_id = v_id and teacher_id = v_uid;
  insert into public.classroom_attendance (lesson_id, teacher_id, student_id, status)
    select v_id, v_uid, (e->>'student_id')::uuid, e->>'status'
    from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb)) e;
  return v_id;
end
$body$;
revoke execute on function public.save_lesson_attendance(uuid, date, smallint, jsonb) from public, anon;
grant execute on function public.save_lesson_attendance(uuid, date, smallint, jsonb) to authenticated;

-- ⭐ ملاحظة إيجابية (نص اختياري، بلا تصنيفات)
create table if not exists public.classroom_positive_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  section_id uuid,
  note_date date not null default current_date,
  note_text text check (note_text is null or char_length(note_text) <= 300),
  created_at timestamptz not null default now(),
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade,
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete set null (section_id)
);
create index if not exists classroom_positive_notes_student_idx on public.classroom_positive_notes(student_id);
alter table public.classroom_positive_notes enable row level security;
drop policy if exists "المعلم يدير ملاحظاته الإيجابية فقط" on public.classroom_positive_notes;
create policy "المعلم يدير ملاحظاته الإيجابية فقط" on public.classroom_positive_notes for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- ملاحظة المعلم الخاصة: لا يراها المسؤول (لا سياسة له إطلاقًا) ولا موصل الذكاء الاصطناعي
create table if not exists public.classroom_private_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_private_notes_student_idx on public.classroom_private_notes(student_id);
alter table public.classroom_private_notes enable row level security;
drop policy if exists "المعلم وحده يرى ملاحظاته الخاصة" on public.classroom_private_notes;
create policy "المعلم وحده يرى ملاحظاته الخاصة" on public.classroom_private_notes for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- المتابعة الموحّدة: سبب ← خط أساس مجمّد ← إجراءات ← مراجعة ← نتيجة إلزامية عند الإغلاق
create table if not exists public.classroom_followups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null,
  section_id uuid,
  reason_type text not null check (reason_type in ('absence', 'lateness', 'exits', 'behavior', 'grades', 'other')),
  reason_text text not null check (char_length(reason_text) between 1 and 500),
  baseline jsonb,
  review_date date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  outcome text check (outcome in ('improved', 'partial', 'not_improved')),
  result jsonb,
  next_step text check (next_step in ('new_followup', 'escalate', 'no_action')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade,
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete set null (section_id),
  check ((status = 'closed') = (outcome is not null))
);
create index if not exists classroom_followups_student_idx on public.classroom_followups(student_id);
create index if not exists classroom_followups_open_idx on public.classroom_followups(teacher_id, status, review_date);
-- المتابعة الجماعية: أعضاؤها متابعات عادية بمعرّف مجموعة مشترك (النتيجة لكل طالب)
alter table public.classroom_followups add column if not exists group_id uuid;
create index if not exists classroom_followups_group_idx on public.classroom_followups(teacher_id, group_id) where group_id is not null;
-- الشاهد الذي أُنشئ من متابعة انتهت بتحسّن (يُخفي بطاقة "إضافتها كشاهد")
alter table public.classroom_followups add column if not exists shahid_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_followups_shahid_fk') then
    alter table public.classroom_followups add constraint classroom_followups_shahid_fk foreign key (shahid_id) references public.shawahid(id) on delete set null;
  end if;
end $$;

create table if not exists public.classroom_followup_actions (
  id uuid primary key default gen_random_uuid(),
  followup_id uuid not null,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('verbal_warning', 'individual_session', 'remedial_task', 'reteach', 'seat_change', 'counselor', 'referral', 'other')),
  note text check (note is null or char_length(note) <= 500),
  action_date date not null default current_date,
  created_at timestamptz not null default now(),
  foreign key (followup_id, teacher_id) references public.classroom_followups(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_followup_actions_fu_idx on public.classroom_followup_actions(followup_id);

-- "تجاهل" بطاقة انتباه (تُخفى 14 يومًا) — البطاقات نفسها تُحسب لحظيًا ولا تُخزَّن
create table if not exists public.classroom_attention_dismissals (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null,
  subject_key text not null,
  dismissed_at timestamptz not null default now(),
  unique (teacher_id, rule_key, subject_key)
);

alter table public.classroom_followups enable row level security;
alter table public.classroom_followup_actions enable row level security;
alter table public.classroom_attention_dismissals enable row level security;
drop policy if exists "المعلم يدير متابعاته فقط" on public.classroom_followups;
create policy "المعلم يدير متابعاته فقط" on public.classroom_followups for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير إجراءات متابعاته فقط" on public.classroom_followup_actions;
create policy "المعلم يدير إجراءات متابعاته فقط" on public.classroom_followup_actions for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير تجاهلاته فقط" on public.classroom_attention_dismissals;
create policy "المعلم يدير تجاهلاته فقط" on public.classroom_attention_dismissals for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- "لم أحضر": حصة من الجدول غاب عنها المعلم — تُسكت "لم تُرصد" فقط ولا تدخل أي حساب
create table if not exists public.classroom_lesson_skips (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  lesson_date date not null,
  period smallint not null,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (teacher_id, section_id, lesson_date, period),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete cascade
);
alter table public.classroom_lesson_skips enable row level security;
drop policy if exists "المعلم يدير حصصه غير المحضورة فقط" on public.classroom_lesson_skips;
create policy "المعلم يدير حصصه غير المحضورة فقط" on public.classroom_lesson_skips for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- كشف الدرجات: أعمدة لكل شعبة وفصل (أدائي 40 / اختبارات 20) ودرجات الطلاب.
-- الحذف المقيَّد للشعبة: لا تُحذف شعبة عليها كشف درجات (يحمي الدرجات من حذف عرضي)
create table if not exists public.classroom_grade_columns (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  academic_year text not null,
  semester smallint not null check (semester in (1, 2)),
  category text not null check (category in ('performance', 'tests')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  max_score numeric(5,2) not null check (max_score > 0 and max_score <= 40),
  measures text check (measures is null or char_length(measures) <= 120),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade
);
create index if not exists classroom_grade_columns_term_idx on public.classroom_grade_columns(teacher_id, section_id, academic_year, semester);
create table if not exists public.classroom_grade_scores (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  column_id uuid not null,
  student_id uuid not null,
  score numeric(5,2) not null check (score >= 0),
  updated_at timestamptz not null default now(),
  unique (column_id, student_id),
  foreign key (column_id, teacher_id) references public.classroom_grade_columns(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_grade_scores_student_idx on public.classroom_grade_scores(student_id);

-- حماية مكررة بالقاعدة: سقف الفئة، والدرجة لا تتجاوز القصوى، ولا تُخفض القصوى تحت درجة مرصودة
create or replace function public.check_grade_column() returns trigger
language plpgsql set search_path = '' as $b$
declare v_sum numeric; v_cap numeric; v_over int;
begin
  v_cap := case new.category when 'performance' then 40 else 20 end;
  select coalesce(sum(max_score), 0) into v_sum from public.classroom_grade_columns
    where teacher_id = new.teacher_id and section_id = new.section_id
      and academic_year = new.academic_year and semester = new.semester
      and category = new.category and id <> new.id;
  if v_sum + new.max_score > v_cap then
    raise exception 'grade_cap_exceeded' using errcode = 'P0001', hint = v_cap::text;
  end if;
  if tg_op = 'UPDATE' and new.max_score < old.max_score then
    select count(*) into v_over from public.classroom_grade_scores where column_id = new.id and score > new.max_score;
    if v_over > 0 then
      raise exception 'grade_max_below_scores' using errcode = 'P0001', hint = v_over::text;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $b$;
create or replace function public.check_grade_score() returns trigger
language plpgsql set search_path = '' as $b$
declare v_max numeric;
begin
  select max_score into v_max from public.classroom_grade_columns where id = new.column_id;
  if v_max is not null and new.score > v_max then
    raise exception 'grade_score_above_max' using errcode = 'P0001', hint = v_max::text;
  end if;
  new.updated_at := now();
  return new;
end $b$;
drop trigger if exists trg_check_grade_column on public.classroom_grade_columns;
create trigger trg_check_grade_column before insert or update on public.classroom_grade_columns for each row execute function public.check_grade_column();
drop trigger if exists trg_check_grade_score on public.classroom_grade_scores;
create trigger trg_check_grade_score before insert or update on public.classroom_grade_scores for each row execute function public.check_grade_score();
alter table public.classroom_grade_columns enable row level security;
alter table public.classroom_grade_scores enable row level security;
drop policy if exists "المعلم يدير أعمدة درجاته فقط" on public.classroom_grade_columns;
create policy "المعلم يدير أعمدة درجاته فقط" on public.classroom_grade_columns for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير درجات طلابه فقط" on public.classroom_grade_scores;
create policy "المعلم يدير درجات طلابه فقط" on public.classroom_grade_scores for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- خطط الحصص القادمة (أخطط ← أنفّذ ← أوثّق): جدول مستقل حتى لا تُحسب خطة لم تُنفّذ شاهدًا
create table if not exists public.lesson_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  element_key text not null,
  template_name text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  goal text check (goal is null or char_length(goal) <= 2000),
  steps jsonb not null default '[]'::jsonb,
  planned_date date not null,
  section_id uuid,
  period smallint check (period is null or period between 1 and 12),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  shahid_id uuid references public.shawahid(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (section_id, user_id) references public.classroom_sections(id, teacher_id) on update cascade on delete set null (section_id)
);
create index if not exists lesson_plans_user_date_idx on public.lesson_plans(user_id, planned_date);
alter table public.lesson_plans enable row level security;
drop policy if exists "المعلم يدير خططه فقط" on public.lesson_plans;
create policy "المعلم يدير خططه فقط" on public.lesson_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- نوع عمود الدرجات: يدوي / مشاركة (+1 من ورقة الحصة) / واجبات ومهام أدائية (محسوبان) — عمود واحد لكل نوع غير اليدوي
alter table public.classroom_grade_columns add column if not exists kind text not null default 'manual';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_grade_columns_kind_v2_chk') then
    alter table public.classroom_grade_columns add constraint classroom_grade_columns_kind_v2_chk check (kind in ('manual', 'participation', 'homework', 'task'));
    alter table public.classroom_grade_columns drop constraint if exists classroom_grade_columns_kind_chk;
  end if;
end $$;
create unique index if not exists classroom_grade_columns_kind_uq on public.classroom_grade_columns(teacher_id, section_id, academic_year, semester, kind) where kind <> 'manual';

-- الواجبات وحالات تسليمها (لم يسلّم = لا صف)
create table if not exists public.classroom_homework (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  academic_year text not null,
  semester smallint not null check (semester in (1, 2)),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_date date not null,
  created_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade
);
create index if not exists classroom_homework_term_idx on public.classroom_homework(teacher_id, section_id, academic_year, semester);
create table if not exists public.classroom_homework_status (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  homework_id uuid not null,
  student_id uuid not null,
  status text not null check (status in ('submitted', 'partial', 'late')),
  updated_at timestamptz not null default now(),
  unique (homework_id, student_id),
  foreign key (homework_id, teacher_id) references public.classroom_homework(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_homework_status_student_idx on public.classroom_homework_status(student_id);
alter table public.classroom_homework enable row level security;
alter table public.classroom_homework_status enable row level security;
drop policy if exists "المعلم يدير واجباته فقط" on public.classroom_homework;
create policy "المعلم يدير واجباته فقط" on public.classroom_homework for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير تسليم واجبات طلابه فقط" on public.classroom_homework_status;
create policy "المعلم يدير تسليم واجبات طلابه فقط" on public.classroom_homework_status for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- المهام الأدائية: لطلاب يحددهم المعلم بالاسم؛ score فارغ = لم يُقيَّم (لا يُحسب)
create table if not exists public.classroom_tasks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  academic_year text not null,
  semester smallint not null check (semester in (1, 2)),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  max_score numeric(5,2) not null check (max_score > 0 and max_score <= 100),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade
);
create index if not exists classroom_tasks_term_idx on public.classroom_tasks(teacher_id, academic_year, semester, section_id);
create table if not exists public.classroom_task_students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid not null,
  student_id uuid not null,
  score numeric(5,2) check (score is null or score >= 0),
  updated_at timestamptz not null default now(),
  unique (task_id, student_id),
  foreign key (task_id, teacher_id) references public.classroom_tasks(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_task_students_student_idx on public.classroom_task_students(student_id);
-- رقم المجموعة داخل المهمة الجماعية؛ فارغ = مهمة فردية
alter table public.classroom_task_students add column if not exists group_no smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_task_students_group_no_chk') then
    alter table public.classroom_task_students add constraint classroom_task_students_group_no_chk check (group_no is null or group_no between 1 and 50);
  end if;
end $$;
alter table public.classroom_tasks enable row level security;
alter table public.classroom_task_students enable row level security;
drop policy if exists "المعلم يدير مهامه فقط" on public.classroom_tasks;
create policy "المعلم يدير مهامه فقط" on public.classroom_tasks for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
drop policy if exists "المعلم يدير درجات مهام طلابه فقط" on public.classroom_task_students;
create policy "المعلم يدير درجات مهام طلابه فقط" on public.classroom_task_students for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
create or replace function public.check_task_score() returns trigger
language plpgsql set search_path = '' as $b$
declare v_max numeric;
begin
  if new.score is not null then
    select max_score into v_max from public.classroom_tasks where id = new.task_id;
    if v_max is not null and new.score > v_max then
      raise exception 'task_score_above_max' using errcode = 'P0001', hint = v_max::text;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $b$;
create or replace function public.check_task_max() returns trigger
language plpgsql set search_path = '' as $b$
declare v_over int;
begin
  if new.max_score < old.max_score then
    select count(*) into v_over from public.classroom_task_students where task_id = new.id and score > new.max_score;
    if v_over > 0 then
      raise exception 'task_max_below_scores' using errcode = 'P0001', hint = v_over::text;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $b$;
create or replace trigger trg_check_task_score before insert or update on public.classroom_task_students for each row execute function public.check_task_score();
create or replace trigger trg_check_task_max before update on public.classroom_tasks for each row execute function public.check_task_max();

-- زيادة/إنقاص درجة ذرّيًا (نقرة المشاركة) — security invoker: صلاحيات المعلم نفسه
create or replace function public.increment_grade_score(p_column_id uuid, p_student_id uuid, p_delta numeric)
returns numeric language plpgsql security invoker set search_path = '' as $b$
declare v_uid uuid := auth.uid(); v_max numeric; v_new numeric;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select max_score into v_max from public.classroom_grade_columns where id = p_column_id and teacher_id = v_uid;
  if v_max is null then raise exception 'column not found'; end if;
  insert into public.classroom_grade_scores as g (teacher_id, column_id, student_id, score)
    values (v_uid, p_column_id, p_student_id, greatest(0, least(v_max, p_delta)))
    on conflict (column_id, student_id) do update set score = greatest(0, least(v_max, g.score + p_delta))
    returning score into v_new;
  if v_new = 0 and p_delta < 0 then
    delete from public.classroom_grade_scores where column_id = p_column_id and student_id = p_student_id and teacher_id = v_uid;
  end if;
  return v_new;
end $b$;
revoke execute on function public.increment_grade_score(uuid, uuid, numeric) from public, anon;
grant execute on function public.increment_grade_score(uuid, uuid, numeric) to authenticated;

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

-- ============ موصل الذكاء الاصطناعي (رموز وصول شخصية للقراءة فقط) ============
-- ملاحظة: هذا الجدول عمدًا غير مُدرَج بقوائم exportFullBackup/exportBackup —
-- يحمل رموزًا مُجزّأة (hash) لا فائدة من تصديرها ضمن نسخة بيانات المعلم،
-- وتصديرها يزيد سطح التعرّض بلا أي داعٍ.
create table if not exists public.personal_access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  label text not null default 'موصل الذكاء الاصطناعي',
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  rate_window_start timestamptz,
  rate_window_count int not null default 0
);
alter table public.personal_access_tokens enable row level security;
drop policy if exists "المعلم يشوف رموزه فقط" on public.personal_access_tokens;
create policy "المعلم يشوف رموزه فقط" on public.personal_access_tokens for select using (auth.uid() = user_id);
drop policy if exists "المعلم يضيف رمزًا لنفسه فقط" on public.personal_access_tokens;
create policy "المعلم يضيف رمزًا لنفسه فقط" on public.personal_access_tokens for insert with check (auth.uid() = user_id);
drop policy if exists "المعلم يلغي رمزه فقط" on public.personal_access_tokens;
create policy "المعلم يلغي رمزه فقط" on public.personal_access_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists idx_pat_user on public.personal_access_tokens(user_id);
-- لا حاجة لفهرس idx_pat_hash منفصل: عمود token_hash معرَّف أعلاه بقيد
-- "unique" مباشرة على مستوى العمود، وهو ينشئ فهرسًا فريدًا تلقائيًا
-- (personal_access_tokens_token_hash_key) — فهرس idx_pat_hash المنفصل كان
-- مكررًا 100% لنفس العمود، واكتُشف فعليًا عبر Supabase advisors
-- (duplicate_index) وأُزيل من قاعدة البيانات الحية بترحيل منفصل.

-- تقييد التعديل بعمود revoked_at فقط: سياسة RLS أعلاه تسمح بتعديل الصف كاملًا
-- (auth.uid() = user_id) لكنها لا تُقيّد الأعمدة — بلا هذا التقييد يمكن لصاحب
-- الحساب نفسه (عبر استدعاء مباشر لـSupabase REST خارج واجهة التطبيق) تصفير
-- rate_window_count أو حذف expires_at، فيُبطل حد الاستخدام وانتهاء الصلاحية
-- المضافين باليوم الأول من التحصين. الواجهة (revokeConnectorToken) لا تعدّل
-- إلا revoked_at أصلًا، فهذا التقييد لا يكسر أي استخدام مشروع حالي.
revoke update on public.personal_access_tokens from authenticated, anon;
grant update (revoked_at) on public.personal_access_tokens to authenticated;

-- فحص وزيادة عدّاد حد الاستخدام أتوميًا لموصل الذكاء الاصطناعي (يُستدعى فقط
-- من خادم api/mcp.js عبر مفتاح service role — ممنوع الاستدعاء المباشر من
-- anon/authenticated لمنع تلاعب مستخدم بعدّاد رمز غيره)
create or replace function public.check_mcp_rate_limit(p_token_id uuid, p_max_requests int, p_window_seconds int)
returns boolean
language plpgsql
as $$
declare
  v_window_start timestamptz;
  v_count int;
  v_now timestamptz := now();
begin
  select rate_window_start, rate_window_count into v_window_start, v_count
  from public.personal_access_tokens
  where id = p_token_id
  for update;

  if not found then
    return false;
  end if;

  if v_window_start is null or v_now - v_window_start > (p_window_seconds || ' seconds')::interval then
    update public.personal_access_tokens
    set rate_window_start = v_now, rate_window_count = 1
    where id = p_token_id;
    return true;
  end if;

  if v_count >= p_max_requests then
    return false;
  end if;

  update public.personal_access_tokens
  set rate_window_count = rate_window_count + 1
  where id = p_token_id;
  return true;
end;
$$;
revoke all on function public.check_mcp_rate_limit(uuid, int, int) from public, anon, authenticated;

-- ============ 10) التقويم الدراسي الرسمي ============
-- جداول مرجعية مشتركة بين كل المعلمين (بلا user_id) — توزيع الأسابيع
-- الدراسية والإجازات الرسمية، لنطاقين جغرافيين (مكة/المدينة/جدة/الطائف
-- مقابل بقية المناطق). بيانات عام 1448-1449هـ نفسها لا تُزرع هنا — تُستعاد
-- من ملفات CSV بالنسخة الاحتياطية (مُدرَجة بقائمة exportFullBackup) بعد
-- تشغيل هذا الملف، تمامًا كجدول classroom_incident_types.
create table if not exists public.academic_calendar_weeks (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  region_group text not null,
  semester int not null,
  week_label text,
  hijri_month text,
  day_name text not null,
  hijri_date text,
  gregorian_date date not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_academic_calendar_weeks_lookup
  on public.academic_calendar_weeks(region_group, academic_year, gregorian_date);

alter table public.academic_calendar_weeks enable row level security;

drop policy if exists "أي معلم يقرأ تقويم الأسابيع" on public.academic_calendar_weeks;
create policy "أي معلم يقرأ تقويم الأسابيع"
  on public.academic_calendar_weeks for select using (auth.uid() is not null);

create table if not exists public.academic_calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null,
  region_group text not null,
  semester int not null,
  holiday_name text not null,
  event_label text not null,
  day_name text,
  hijri_date text,
  gregorian_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_academic_calendar_holidays_lookup
  on public.academic_calendar_holidays(region_group, academic_year, gregorian_date);

alter table public.academic_calendar_holidays enable row level security;

drop policy if exists "أي معلم يقرأ إجازات التقويم" on public.academic_calendar_holidays;
create policy "أي معلم يقرأ إجازات التقويم"
  on public.academic_calendar_holidays for select using (auth.uid() is not null);

alter table public.profiles add column if not exists calendar_region text;

-- مسار الاستخدام المفضَّل: 'quick' (رئيسية مبسّطة) أو 'full' (كل الميزات)
-- — null = لم يختر بعد، يُعامَل كـ'full' بالعرض مع بانر تعريفي بالسريع.
alter table public.profiles add column if not exists ui_mode text check (ui_mode in ('quick', 'full'));

-- ============ 11) المهام ============
-- كيان شخصي بسيط (عنوان/وصف اختياري/أولوية/تاريخ استحقاق/حالة إنجاز)، مع
-- ربط اختياري بهدف أداء أو برنامج نشاط — FK حقيقي بعمودين منفصلين، يُنظَّف
-- تلقائيًا (on delete set null) لو حُذف الهدف/البرنامج المرتبط.
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  done boolean not null default false,
  linked_goal_id uuid references public.performance_goals(id) on delete set null,
  linked_program_id uuid references public.activity_programs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

drop policy if exists "المعلم يشوف مهامه فقط" on public.tasks;
create policy "المعلم يشوف مهامه فقط"
  on public.tasks for select using (auth.uid() = user_id);

drop policy if exists "المعلم يضيف مهمة لنفسه فقط" on public.tasks;
create policy "المعلم يضيف مهمة لنفسه فقط"
  on public.tasks for insert with check (auth.uid() = user_id);

drop policy if exists "المعلم يعدّل مهامه فقط" on public.tasks;
create policy "المعلم يعدّل مهامه فقط"
  on public.tasks for update using (auth.uid() = user_id);

drop policy if exists "المعلم يحذف مهامه فقط" on public.tasks;
create policy "المعلم يحذف مهامه فقط"
  on public.tasks for delete using (auth.uid() = user_id);

create index if not exists idx_tasks_user_due on public.tasks(user_id, due_date);

create or replace function public.set_tasks_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql security definer;

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.set_tasks_updated_at();

-- ============ انتهى ============
-- الخطوة التالية: أضف نفسك كمسؤول بعد إنشاء حسابك:
-- insert into public.admins (user_id) values ('ضع-UID-حسابك-هنا');
`;
  if(schema === 'public') return sql;
  return sql
    .replace(/-- @@STAGING_SKIP_START@@[\s\S]*?-- @@STAGING_SKIP_END@@\n?/, '-- (تريجرات مزامنة auth.users مُستبعدة عمدًا لبيئات staging — راجع تعليق buildSchemaSql)\n')
    .replace(/table_schema='public'/g, `table_schema='${schema}'`)
    .replace(/\bpublic\./g, schema + '.');
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
  activeExportCount++;
  box.style.display = 'block';
  updateBackupProgress(3, 'جارٍ تحميل مكتبة الضغط...');

  try{
    await ensureZipLib();
    const zip = new JSZip();

    /* 1) سحب كل الجداول */
    updateBackupProgress(10, 'جارٍ سحب البيانات من قاعدة البيانات...');
    const tables = ['shawahid', 'performance_goals', 'plan_header', 'self_assessment', 'profiles', 'performance_elements', 'admins', 'audit_log', 'classroom_students', 'classroom_grade_levels', 'classroom_sections', 'classroom_incident_types', 'classroom_incidents', 'classroom_letter_counters', 'academic_cases', 'activity_programs', 'program_sections', 'support_messages', 'academic_calendar_weeks', 'academic_calendar_holidays', 'tasks', 'classroom_timetable_slots', 'classroom_lessons', 'classroom_attendance', 'classroom_positive_notes', 'classroom_private_notes', 'classroom_followups', 'classroom_followup_actions', 'classroom_attention_dismissals', 'classroom_lesson_skips', 'classroom_grade_columns', 'classroom_grade_scores', 'lesson_plans', 'classroom_homework', 'classroom_homework_status', 'classroom_tasks', 'classroom_task_students'];
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
      '     4. activity_programs.csv',
      '     5. classroom_grade_levels.csv',
      '     6. classroom_sections.csv (لازم قبل shawahid.csv — شاهد توثيق شعبة بعينها يُشير إليها)',
      '     7. shawahid.csv (لازم بعد activity_programs وclassroom_sections لأنها قد تُشير لكليهما)',
      '     8. performance_goals.csv',
      '     9. plan_header.csv',
      '     10. self_assessment.csv',
      '     11. classroom_incident_types.csv (أو أدخلها يدويًا — راجع الملاحظة أعلى 01-schema.sql)',
      '     12. classroom_students.csv (لازم بعد classroom_sections — الطالب يُشير لشعبته)',
      '     13. classroom_incidents.csv (لازم بعد classroom_students وclassroom_sections)',
      '     14. classroom_letter_counters.csv',
      '     15. academic_cases.csv',
      '     16. support_messages.csv',
      '     17. academic_calendar_weeks.csv',
      '     18. academic_calendar_holidays.csv',
      '     19. tasks.csv (لازم بعد activity_programs وperformance_goals لأنها تُشير إليهما)',
      '     20. program_sections.csv (لازم بعد activity_programs وclassroom_sections)',
      '     21. classroom_timetable_slots.csv (لازم بعد classroom_sections)',
      '     22. classroom_lessons.csv (لازم بعد classroom_sections)',
      '     23. classroom_attendance.csv (لازم بعد classroom_lessons وclassroom_students)',
      '     24. classroom_positive_notes.csv (لازم بعد classroom_students وclassroom_sections)',
      '     25. classroom_private_notes.csv (لازم بعد classroom_students)',
      '     26. classroom_followups.csv (لازم بعد classroom_students وclassroom_sections وshawahid)',
      '     27. classroom_followup_actions.csv (لازم بعد classroom_followups)',
      '     28. classroom_attention_dismissals.csv',
      '     29. classroom_lesson_skips.csv (لازم بعد classroom_sections)',
      '     30. classroom_grade_columns.csv (لازم بعد classroom_sections)',
      '     31. classroom_grade_scores.csv (لازم بعد classroom_grade_columns وclassroom_students)',
      '     32. lesson_plans.csv (لازم بعد shawahid وclassroom_sections)',
      '     33. classroom_homework.csv (لازم بعد classroom_sections)',
      '     34. classroom_homework_status.csv (لازم بعد classroom_homework وclassroom_students)',
      '     35. classroom_tasks.csv (لازم بعد classroom_sections)',
      '     36. classroom_task_students.csv (لازم بعد classroom_tasks وclassroom_students)',
      '',
      '── الخطوة 6: استعادة الصور ──',
      '  من Storage ← shawahid-photos ← ارفع محتويات مجلد photos/ (شواهد الأداء، وصور توثيق تحويلات إدارة الصف والمتابعة الأكاديمية ورسائل الدعم معًا)',
      '  ثم حدّث حقل photo_urls في جدول shawahid، وحقل referral_receipt_photo_url في جدولَي classroom_incidents وacademic_cases، وحقل photo_url في جدول support_messages، بالروابط الجديدة.',
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
    (data.support_messages || []).forEach(m => {
      if(m.photo_url){
        allPhotos.push({
          url: m.photo_url,
          teacher: 'رسائل_الدعم_' + (m.teacher_name || 'غير_معروف').replace(/[^؀-ۿ\w]+/g, '_'),
          ref: 'رسالة_' + String(m.id).slice(0, 8),
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
    activeExportCount = Math.max(0, activeExportCount - 1);
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
  loadSupportMessages();
}

function toggleAdminBox(boxId, chevronId){
  const box = document.getElementById(boxId);
  const chev = document.getElementById(chevronId);
  if(!box) return;
  const opening = box.style.display === 'none';
  box.style.display = opening ? 'block' : 'none';
  if(chev) chev.textContent = opening ? '▴ إخفاء' : '▾ عرض';
}

/* حساب جاهزية معلم واحد: التخطيط + التوثيق + التقييم الذاتي
   نستخدم عناصر هذا المعلم بعينه (لا عناصر المسؤول الضمنية) — تُستدعى هذه
   الدالة بالتكرار على كل معلم مسجّل، وكل معلم قد يختلف نوع تكليفه الإضافي
   عن المسؤول نفسه وعن باقي المعلمين. */
function computeTeacherReadiness(uid){
  const p = adminProfiles.find(x => x.id === uid);
  const elements = computeEffectiveElements(ALL_PERFORMANCE_ELEMENTS, (p && p.duty_type) || 'none');
  const plan = adminAllPlans[uid] || {};
  const self = adminAllSelf[uid] || {};
  const recs = adminAllRecords.filter(r => r.user_id === uid);

  const counts = {};
  recs.forEach(r => { counts[r.element_key] = (counts[r.element_key] || 0) + 1; });

  const plannedCount = elements.filter(e => plan[e.key] && (plan[e.key].target_level || plan[e.key].target_count)).length;
  const selfCount = elements.filter(e => self[e.key] && self[e.key].self_level).length;
  const coveredCount = elements.filter(e => (counts[e.key] || 0) > 0).length;

  /* الاكتمال الموزون للتوثيق — نقرأ الوزن مباشرة من عناصر هذا المعلم الفعّالة
     بدل getElementWeight() (التي تعتمد على DB_ELEMENTS الضمنية للمسؤول) */
  let weightedDone = 0, totalWeight = 0;
  elements.forEach(e => {
    const w = Number(e.weight) || 0;
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
