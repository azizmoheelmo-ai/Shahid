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

-- القراءة عبر الواجهة لصاحب الملف فقط. الروابط العامة (getPublicUrl) تبقى تعمل للجميع لأن الحاوية عامة؛
-- سياسة "قراءة للجميع" كانت تسمح لأي زائر بسرد كل ملفات كل المعلمين (قد تكون فيها صور طلاب). الحذف (remove) يحتاج
-- قراءة الملف نفسه، فتبقى قراءة المالك لمجلده.
drop policy if exists "قراءة عامة لصور شاهد" on storage.objects;
drop policy if exists "الصور قابلة للعرض للجميع (رابط مباشر)" on storage.objects;
drop policy if exists "المعلم يقرأ ملفاته فقط" on storage.objects;
create policy "المعلم يقرأ ملفاته فقط"
  on storage.objects for select
  using (bucket_id = 'shawahid-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);

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

-- 3) إدارة الصف — حفظ رصد الحصة كعملية واحدة (الحصة + الغياب/التأخر/الاستئذان
--    معًا): لو فشل جزء لا تبقى حصة "مرصودة" بلا غيابها الحقيقي. security
--    invoker: صلاحيات RLS للمعلم نفسه تنطبق. الجداول نفسها (classroom_lessons/
--    classroom_attendance) أُنشئت مسبقًا بترحيل classroom_timetable_lessons_attendance.
--    مكرر لـpublic (الإنتاج) وstaging (البيئة التجريبية).
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

create or replace function staging.save_lesson_attendance(
  p_section_id uuid, p_lesson_date date, p_period smallint, p_exceptions jsonb
) returns uuid
language plpgsql security invoker set search_path = ''
as $body$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select id into v_id from staging.classroom_lessons
    where teacher_id = v_uid and section_id = p_section_id and lesson_date = p_lesson_date
      and period is not distinct from p_period;
  if v_id is null then
    begin
      insert into staging.classroom_lessons (teacher_id, section_id, lesson_date, period)
        values (v_uid, p_section_id, p_lesson_date, p_period) returning id into v_id;
    exception when unique_violation then
      select id into v_id from staging.classroom_lessons
        where teacher_id = v_uid and section_id = p_section_id and lesson_date = p_lesson_date
          and period is not distinct from p_period;
    end;
  else
    update staging.classroom_lessons set updated_at = now() where id = v_id;
  end if;
  delete from staging.classroom_attendance where lesson_id = v_id and teacher_id = v_uid;
  insert into staging.classroom_attendance (lesson_id, teacher_id, student_id, status)
    select v_id, v_uid, (e->>'student_id')::uuid, e->>'status'
    from jsonb_array_elements(coalesce(p_exceptions, '[]'::jsonb)) e;
  return v_id;
end
$body$;
revoke execute on function staging.save_lesson_attendance(uuid, date, smallint, jsonb) from public, anon;
grant execute on function staging.save_lesson_attendance(uuid, date, smallint, jsonb) to authenticated;

-- ============ 12) سلة المحذوفات (30 يومًا) ============
-- قبل أي حذف ثقيل يحفظ التطبيق نسخة من السجل وكل ما يُحذف معه (لقطة JSON) هنا،
-- فيستطيع المعلم (أو المسؤول للمعلمين) استرجاعها خلال 30 يومًا. الجداول الأصلية
-- وسياساتها لم تتغيّر، فلا استعلام يحتاج فلترة جديدة.
-- payload = {"tables":[{"t":"اسم الجدول","rows":[...]}, ...] بترتيب الاسترجاع (الأب أولًا),
--            "relinks":[{"t":"shawahid","col":"program_id","ids":["..."],"val":"..."}], "meta":{...}}
create table if not exists public.deleted_items (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (char_length(kind) between 1 and 40),
  label text not null check (char_length(label) <= 300),
  payload jsonb not null,
  photo_paths text[] not null default '{}',
  deleted_by uuid default auth.uid(),
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (expires_at <= now() + interval '31 days')
);
create index if not exists deleted_items_teacher_idx on public.deleted_items(teacher_id, deleted_at desc);
create index if not exists deleted_items_expires_idx on public.deleted_items(expires_at);

alter table public.deleted_items enable row level security;

drop policy if exists "سلة: قراءة المالك والمسؤول" on public.deleted_items;
create policy "سلة: قراءة المالك والمسؤول"
  on public.deleted_items for select using (auth.uid() = teacher_id or public.is_admin(auth.uid()));

drop policy if exists "سلة: إضافة المالك والمسؤول" on public.deleted_items;
create policy "سلة: إضافة المالك والمسؤول"
  on public.deleted_items for insert with check (auth.uid() = teacher_id or public.is_admin(auth.uid()));

drop policy if exists "سلة: حذف المالك أو المنشئ" on public.deleted_items;
create policy "سلة: حذف المالك أو المنشئ"
  on public.deleted_items for delete using (auth.uid() = teacher_id or (auth.uid() = deleted_by and public.is_admin(auth.uid())));

grant select, insert, delete on public.deleted_items to authenticated;

-- مراجع اختيارية (on delete set null): لو اختفى المرجع قبل الاسترجاع يُفرَّغ الحقل بدل أن يفشل الاسترجاع كله
create or replace function public.trash_soft_refs(p_table text, p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $fn$
declare
  v_cfg jsonb := '{
    "shawahid": [["program_id","activity_programs"],["goal_id","performance_goals"],["program_section_id","classroom_sections"]],
    "tasks": [["linked_goal_id","performance_goals"],["linked_program_id","activity_programs"]],
    "classroom_tasks": [["shahid_id","shawahid"]],
    "classroom_followups": [["shahid_id","shawahid"],["section_id","classroom_sections"]],
    "classroom_students": [["section_id","classroom_sections"]],
    "classroom_incidents": [["section_id","classroom_sections"]],
    "classroom_positive_notes": [["section_id","classroom_sections"]],
    "classroom_private_notes": [["section_id","classroom_sections"]]
  }';
  v_pair jsonb; v_row jsonb; v_out jsonb := '[]'::jsonb; v_exists boolean;
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    for v_pair in select * from jsonb_array_elements(coalesce(v_cfg->p_table, '[]'::jsonb)) loop
      if v_row->>(v_pair->>0) is not null then
        execute format('select exists(select 1 from public.%I where id = $1)', v_pair->>1)
          into v_exists using (v_row->>(v_pair->>0))::uuid;
        if not v_exists then v_row := jsonb_set(v_row, array[v_pair->>0], 'null'::jsonb); end if;
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  return v_out;
end
$fn$;

-- الاسترجاع كله في معاملة واحدة: ينجح كاملًا أو لا يتغيّر شيء
create or replace function public.restore_deleted_item(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_item public.deleted_items;
  v_allowed text[] := array['shawahid','activity_programs','program_sections','performance_goals','tasks',
    'classroom_students','classroom_incidents','academic_cases','classroom_attendance','classroom_positive_notes',
    'classroom_private_notes','classroom_followups','classroom_followup_actions','classroom_grade_columns',
    'classroom_grade_scores','classroom_grade_period_scores','classroom_homework','classroom_homework_status',
    'classroom_tasks','classroom_task_students','classroom_custom_tools','classroom_tool_marks','classroom_lessons'];
  v_user_owned text[] := array['shawahid','activity_programs','performance_goals','tasks'];
  v_relinks text[] := array['shawahid.program_id','shawahid.goal_id','tasks.linked_goal_id','tasks.linked_program_id'];
  v_spec jsonb; v_rel jsonb; v_tab text; v_owner text; v_rows jsonb; v_c int; v_n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_item from public.deleted_items where id = p_id for update;
  if not found then raise exception 'deleted_item_not_found' using errcode = 'P0002'; end if;
  if v_item.teacher_id <> auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_spec in select * from jsonb_array_elements(coalesce(v_item.payload->'tables', '[]'::jsonb)) loop
    v_tab := v_spec->>'t';
    if v_tab is null or not (v_tab = any(v_allowed)) then
      raise exception 'table_not_allowed: %', coalesce(v_tab, '<null>') using errcode = '42501';
    end if;
    v_owner := case when v_tab = any(v_user_owned) then 'user_id' else 'teacher_id' end;
    -- المالك يُفرض من سجل السلة نفسه، فلا تُكتب صفوف باسم معلم آخر مهما كانت اللقطة
    select coalesce(jsonb_agg(r || jsonb_build_object(v_owner, v_item.teacher_id)), '[]'::jsonb)
      into v_rows from jsonb_array_elements(coalesce(v_spec->'rows', '[]'::jsonb)) r;
    v_rows := public.trash_soft_refs(v_tab, v_rows);
    execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', v_tab, v_tab)
      using v_rows;
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end loop;

  -- إعادة ربط ما فُكّ ربطه بالحذف (مثل شواهد برنامج محذوف)
  for v_rel in select * from jsonb_array_elements(coalesce(v_item.payload->'relinks', '[]'::jsonb)) loop
    if not ((v_rel->>'t') || '.' || (v_rel->>'col') = any(v_relinks)) then
      raise exception 'relink_not_allowed' using errcode = '42501';
    end if;
    v_owner := case when (v_rel->>'t') = any(v_user_owned) then 'user_id' else 'teacher_id' end;
    execute format('update public.%I set %I = $1 where id = any($2) and %I is null and %I = $3',
        v_rel->>'t', v_rel->>'col', v_rel->>'col', v_owner)
      using (v_rel->>'val')::uuid,
            (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(coalesce(v_rel->'ids', '[]'::jsonb)) x),
            v_item.teacher_id;
  end loop;

  delete from public.deleted_items where id = p_id;
  return jsonb_build_object('kind', v_item.kind, 'rows', v_n, 'meta', coalesce(v_item.payload->'meta', '{}'::jsonb));
end
$fn$;
revoke execute on function public.restore_deleted_item(uuid) from public, anon;
grant execute on function public.restore_deleted_item(uuid) to authenticated;
revoke execute on function public.trash_soft_refs(text, jsonb) from public, anon, authenticated;

-- ============ تجهيز الشواهد دفعة واحدة (مسودات بانتظار الصورة) ============
-- المعلم يختار 20-30 نموذجًا مرة واحدة فتُحفظ هنا كبطاقات مسودة. المسودة ليست
-- شاهدًا: جدول مستقل (مثل lesson_plans) فلا تُحسب بالتقدم ولا التصدير ولا
-- لوحة المسؤول. عند إرفاق صورتها تُنسخ لجدول shawahid بنفس المعرّف (id) وتُحذف
-- من هنا. الفهرس الفريد يمنع تكرار نفس النموذج بنفس العنصر قيد التجهيز.
create table if not exists public.shahid_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  element_key text not null,
  template_name text,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  planned_date date,
  teacher_name text,
  school text,
  subject text,
  class_name text,
  cycle_year text,
  created_at timestamptz not null default now()
);
create unique index if not exists shahid_drafts_uniq on public.shahid_drafts(user_id, element_key, template_name);
create index if not exists shahid_drafts_user_idx on public.shahid_drafts(user_id, created_at);
alter table public.shahid_drafts enable row level security;
drop policy if exists "المعلم يدير مسوداته فقط" on public.shahid_drafts;
create policy "المعلم يدير مسوداته فقط" on public.shahid_drafts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
