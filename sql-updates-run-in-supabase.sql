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
    'classroom_tasks','classroom_task_students','classroom_custom_tools','classroom_tool_marks','classroom_lessons',
    'classroom_rubric_criteria','classroom_rubric_marks','classroom_rubric_notes','leader_followups'];
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

-- ============ اختبار بسلّم تقدير (تجربة): معايير الاختبار ورصد الطالب لها ============
-- الاختبار بسلّم = عمود اختبار عادي (classroom_grade_columns) تُحسب درجة طالبه من معايير:
-- المعايير هنا، ومستوى الطالب لكل معيار هنا، والدرجة الكلية تبقى في classroom_grade_scores.
-- حذف الاختبار أو الطالب يحذف تابعيه (cascade) وتحميه سلة المحذوفات.
create table if not exists public.classroom_rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  column_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  points numeric(5,2) not null check (points > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, teacher_id),
  foreign key (column_id, teacher_id) references public.classroom_grade_columns(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_rubric_criteria_col_idx on public.classroom_rubric_criteria(column_id);
alter table public.classroom_rubric_criteria enable row level security;
drop policy if exists "المعلم يدير معايير اختباراته فقط" on public.classroom_rubric_criteria;
create policy "المعلم يدير معايير اختباراته فقط" on public.classroom_rubric_criteria for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
create table if not exists public.classroom_rubric_marks (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  column_id uuid not null,
  criterion_id uuid not null,
  student_id uuid not null,
  level smallint not null check (level between 0 and 4),
  updated_at timestamptz not null default now(),
  unique (criterion_id, student_id),
  foreign key (column_id, teacher_id) references public.classroom_grade_columns(id, teacher_id) on update cascade on delete cascade,
  foreign key (criterion_id, teacher_id) references public.classroom_rubric_criteria(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_rubric_marks_col_idx on public.classroom_rubric_marks(column_id, student_id);
create index if not exists classroom_rubric_marks_student_idx on public.classroom_rubric_marks(student_id);
alter table public.classroom_rubric_marks enable row level security;
drop policy if exists "المعلم يدير رصد معايير اختباراته فقط" on public.classroom_rubric_marks;
create policy "المعلم يدير رصد معايير اختباراته فقط" on public.classroom_rubric_marks for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
create or replace function public.touch_rubric_mark() returns trigger
language plpgsql set search_path = '' as $b$
begin
  new.updated_at := now();
  return new;
end $b$;
create or replace trigger trg_touch_rubric_mark before insert or update on public.classroom_rubric_marks for each row execute function public.touch_rubric_mark();

-- ملاحظة المعلم على طالب في اختبار بسلّم تقدير (اختيارية، حتى 300 حرف)؛ لا تغيّر الدرجة ولا تدخل التقرير حتى يُقرَّر ذلك
create table if not exists public.classroom_rubric_notes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  column_id uuid not null,
  student_id uuid not null,
  note text not null check (char_length(btrim(note)) between 1 and 300),
  updated_at timestamptz not null default now(),
  unique (column_id, student_id),
  foreign key (column_id, teacher_id) references public.classroom_grade_columns(id, teacher_id) on update cascade on delete cascade,
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create index if not exists classroom_rubric_notes_student_idx on public.classroom_rubric_notes(student_id);
alter table public.classroom_rubric_notes enable row level security;
drop policy if exists "المعلم يدير ملاحظات اختباراته فقط" on public.classroom_rubric_notes;
create policy "المعلم يدير ملاحظات اختباراته فقط" on public.classroom_rubric_notes for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
create or replace function public.touch_rubric_note() returns trigger
language plpgsql set search_path = '' as $b$
begin
  new.updated_at := now();
  return new;
end $b$;
create or replace trigger trg_touch_rubric_note before insert or update on public.classroom_rubric_notes for each row execute function public.touch_rubric_note();

-- جوال الطالب وولي الأمر (اختياريان، أرقام دولية فقط). للتواصل بواتساب؛ لا يدخلان أي تقرير.
alter table public.classroom_students add column if not exists student_phone text;
alter table public.classroom_students add column if not exists guardian_phone text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_students_student_phone_chk' and conrelid = 'public.classroom_students'::regclass) then
    alter table public.classroom_students add constraint classroom_students_student_phone_chk check (student_phone is null or student_phone ~ '^[0-9]{9,15}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'classroom_students_guardian_phone_chk' and conrelid = 'public.classroom_students'::regclass) then
    alter table public.classroom_students add constraint classroom_students_guardian_phone_chk check (guardian_phone is null or guardian_phone ~ '^[0-9]{9,15}$');
  end if;
end $$;

-- إرسال تقرير الطالب برابط مؤقت (واتساب): حاوية خاصة + سجل بالروابط الصادرة. الجدول مؤقت بطبيعته
-- (يُنظَّف بعد انتهاء الرابط) فهو عمدًا غير مُدرَج بقوائم exportFullBackup/exportBackup ولا بسلة المحذوفات.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-shares', 'report-shares', false, 8388608, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists "report-shares: المعلم يرفع ضمن مجلده فقط" on storage.objects;
create policy "report-shares: المعلم يرفع ضمن مجلده فقط" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-shares' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "report-shares: المعلم يقرأ ملفاته فقط" on storage.objects;
create policy "report-shares: المعلم يقرأ ملفاته فقط" on storage.objects for select to authenticated
  using (bucket_id = 'report-shares' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "report-shares: المعلم يحذف ملفاته فقط" on storage.objects;
create policy "report-shares: المعلم يحذف ملفاته فقط" on storage.objects for delete to authenticated
  using (bucket_id = 'report-shares' and (storage.foldername(name))[1] = (select auth.uid())::text);
create table if not exists public.student_report_shares (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null,
  object_path text not null unique,
  version text not null check (version in ('grades', 'analytical')),
  recipient text not null check (recipient in ('guardian', 'student')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists student_report_shares_teacher_exp_idx on public.student_report_shares(teacher_id, expires_at);
alter table public.student_report_shares enable row level security;
drop policy if exists "المعلم يدير روابط تقاريره فقط" on public.student_report_shares;
create policy "المعلم يدير روابط تقاريره فقط" on public.student_report_shares for all
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- رمز قصير لرابط تقرير الطالب (/r/<رمز> عبر api/r.js)
alter table public.student_report_shares add column if not exists short_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'student_report_shares_short_code_chk' and conrelid = 'public.student_report_shares'::regclass) then
    alter table public.student_report_shares add constraint student_report_shares_short_code_chk check (short_code is null or short_code ~ '^[a-z2-9]{12,32}$');
  end if;
end $$;
create unique index if not exists student_report_shares_short_code_key on public.student_report_shares(short_code) where short_code is not null;

-- اتفاق المتابعة مع الطالب (FOLLOWUP-AGREEMENT.md، المرحلة 1): عمود واحد على المتابعة نفسها بلا جدول جديد،
-- فيرث تلقائيًا RLS المالك وسلة المحذوفات والنسخ الاحتياطي وسياسة تعطيل الحساب. إضافي وآمن التكرار.
alter table public.classroom_followups add column if not exists agreement jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'classroom_followups_agreement_chk' and conrelid = 'public.classroom_followups'::regclass) then
    alter table public.classroom_followups add constraint classroom_followups_agreement_chk
      check (agreement is null or (jsonb_typeof(agreement) = 'object' and agreement->>'status' in ('agreed', 'wants_talk') and octet_length(agreement::text) <= 1500));
  end if;
end $$;

-- ============ استبانة رضا المستفيدين (SURVEYS.md) ============
-- الاستبانة كائن مستقل على مستوى المعلم: عنوان، وجمهور واحد، وشعب مختارة، وأسئلتها هي (نسخة محفوظة بالحملة)،
-- وترتيب يحدده المعلم، وعتبة عرض نتائج لكل استبانة.
-- - survey_invites تذكرة لكل مستلم (ولي أمر/طالب، أو «جهة أخرى» برقم يُدخله المعلم في الاستبانة المخصصة) تعرف من ردّ
--   (answered_on، تاريخ بلا وقت) ولا تحمل أي إجابة.
-- - survey_responses تحمل الإجابات بلا student_id ولا invite_id ولا المستلم، وبتاريخ بلا وقت، ومعرّف عشوائي (uuid لا تسلسل)
--   فلا يُستنتج صاحب الرد من الترتيب ولا التوقيت.
-- - كلها بـauth.uid() = teacher_id وبلا سياسة مسؤول (كـstudent_report_shares).
-- - لا سياسة إدراج/تعديل/حذف على الردود: الكتابة من submit_survey وحدها (لـservice_role فقط عبر api/s.js).
-- - الأسئلة تتجمّد بعد أول إرسال (تريجر)، فتبقى كل الردود مفهومة بنفس الأسئلة التي أُجيب عنها.
-- - الحذف عبر delete_survey وحدها (المالك فقط، بمعاملة واحدة تحذف الردود والتذاكر والشعب ثم الاستبانة).
-- - التعديلات بعد التشغيل الأول إضافية فقط وآمنة التكرار (add column if not exists، قيود بأسماء صريحة):
--   الجداول قد تحمل بيانات حقيقية، فلا drop table ولا drop column هنا إلا حارس الشكل الأول (الفارغ فقط).

-- ترقية من الشكل الأول (حملة مربوطة بشعبة واحدة وقالب ثابت بالكود): إن كانت الجداول القديمة فارغة تُحذف ويُعاد
-- إنشاؤها بالشكل الجديد؛ وإن كان فيها أي صف يتوقف التشغيل كله (لا فقد بيانات صامت). يُعرَف الشكل القديم بعمود
-- section_id في survey_campaigns (من pg_attribute عبر to_regclass، فيعمل كما هو بعد تحويل public. إلى staging.).
do $$
declare v_camp regclass := to_regclass('public.survey_campaigns'); v_t regclass; v_rows boolean := false;
begin
  if v_camp is not null and exists (select 1 from pg_attribute where attrelid = v_camp and attname = 'section_id' and not attisdropped) then
    foreach v_t in array array[v_camp, to_regclass('public.survey_invites'), to_regclass('public.survey_responses')] loop
      if v_t is not null and not v_rows then
        execute format('select exists (select 1 from %s)', v_t) into v_rows;
      end if;
    end loop;
    if v_rows then
      raise exception 'جداول الاستبانة بالشكل القديم وفيها بيانات: يلزم ترحيل يدوي قبل تشغيل هذا الجزء (راجع SURVEYS.md). لم يُغيَّر شيء.';
    end if;
    drop table if exists public.survey_responses, public.survey_invites, public.survey_campaigns cascade;
    drop function if exists public.submit_survey(text, jsonb);
  end if;
end $$;

-- صحة أسئلة الاستبانة (نفس قواعد surveyValidateQuestions بـsurvey-templates.js): مصفوفة 1..12 كائنًا،
-- لكل سؤال {id,type,label,required,options?} فقط؛ id بصيغة q<رقم> فريد؛ النوع من الأربعة؛ النص 1..120 حرفًا بعد
-- btrim وبلا محارف تحكم؛ required منطقي؛ options لسؤال الاختيار وحده: 2..8 نصوص، كل نص 1..40 حرفًا بلا محارف تحكم.
create or replace function public.survey_questions_ok(q jsonb)
returns boolean language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; o jsonb; k text; v_ids text[] := '{}'; v_id text; v_s text;
  -- محارف التحكم C0 وDEL وC1 (بلا شرطة مائلة: الكتلة تُنسخ حرفيًا داخل نص JavaScript بـapp-07)
  v_ctl text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
begin
  if q is null or jsonb_typeof(q) <> 'array' then return false; end if;
  if jsonb_array_length(q) < 1 or jsonb_array_length(q) > 12 then return false; end if;
  for e in select x from jsonb_array_elements(q) x loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('id', 'type', 'label', 'required', 'options') then return false; end if;
    end loop;
    if jsonb_typeof(e->'id') is distinct from 'string' then return false; end if;
    v_id := e->>'id';
    if v_id !~ '^q[0-9]{1,2}$' or v_id = any(v_ids) then return false; end if;
    v_ids := v_ids || v_id;
    if jsonb_typeof(e->'type') is distinct from 'string' or (e->>'type') not in ('rating', 'truefalse', 'choice', 'text') then return false; end if;
    if jsonb_typeof(e->'label') is distinct from 'string' then return false; end if;
    v_s := btrim(e->>'label');
    if char_length(v_s) < 1 or char_length(v_s) > 120 or v_s ~ v_ctl then return false; end if;
    if jsonb_typeof(e->'required') is distinct from 'boolean' then return false; end if;
    if (e->>'type') = 'choice' then
      if jsonb_typeof(e->'options') is distinct from 'array' or jsonb_array_length(e->'options') < 2 or jsonb_array_length(e->'options') > 8 then return false; end if;
      for o in select x from jsonb_array_elements(e->'options') x loop
        if jsonb_typeof(o) <> 'string' then return false; end if;
        v_s := btrim(o #>> '{}');
        if char_length(v_s) < 1 or char_length(v_s) > 40 or v_s ~ v_ctl then return false; end if;
      end loop;
    elsif e ? 'options' then
      return false;
    end if;
  end loop;
  return true;
end
$fn$;

create table if not exists public.survey_campaigns (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  audience text not null check (audience in ('guardian', 'student', 'custom')),
  -- القالب الجاهز الذي بدأت منه (للمعلومة فقط؛ الأسئلة الحاكمة هي questions المحفوظة هنا)
  template text not null default 'guardian_v1' check (template in ('guardian_v1', 'student_v1', 'blank')),
  questions jsonb not null check (public.survey_questions_ok(questions)),
  status text not null default 'open' check (status in ('open', 'closed')),
  closes_at timestamptz not null default (now() + interval '14 days'),
  sort_order integer not null default 0,
  min_results smallint not null default 5 check (min_results between 1 and 50),
  created_at timestamptz not null default now(),
  unique (id, teacher_id)
);
create index if not exists survey_campaigns_teacher_order_idx on public.survey_campaigns(teacher_id, sort_order);
alter table public.survey_campaigns enable row level security;
drop policy if exists "المعلم يدير حملات استباناته فقط" on public.survey_campaigns;
create policy "المعلم يدير حملات استباناته فقط" on public.survey_campaigns for all to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- الشعب المختارة للاستبانة (حذف الشعبة أو الاستبانة يحذف الربط فقط)
create table if not exists public.survey_campaign_sections (
  campaign_id uuid not null,
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  section_id uuid not null,
  primary key (campaign_id, section_id),
  foreign key (campaign_id, teacher_id) references public.survey_campaigns(id, teacher_id) on update cascade on delete cascade,
  foreign key (section_id, teacher_id) references public.classroom_sections(id, teacher_id) on update cascade on delete cascade
);
create index if not exists survey_campaign_sections_section_idx on public.survey_campaign_sections(section_id);
alter table public.survey_campaign_sections enable row level security;
drop policy if exists "المعلم يدير شعب استباناته فقط" on public.survey_campaign_sections;
create policy "المعلم يدير شعب استباناته فقط" on public.survey_campaign_sections for all to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create table if not exists public.survey_invites (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null,
  student_id uuid not null,
  recipient text not null default 'guardian' check (recipient in ('guardian', 'student')),
  -- 10 أحرف عند الإنشاء (surveyNewCode بـsurvey-templates.js، ≈49.5 بت)؛ القيد يقبل 8..32 فلا يكسر طولًا مستقبليًا
  code text check (code is null or code ~ '^[a-z2-9]{8,32}$'),
  sent_at timestamptz,
  answered_on date,
  created_at timestamptz not null default now(),
  -- تذكرتان مستقلتان كحد أقصى لكل طالب بالحملة: لولي الأمر وللطالب
  unique (campaign_id, student_id, recipient),
  foreign key (campaign_id, teacher_id) references public.survey_campaigns(id, teacher_id) on update cascade on delete cascade,
  -- حذف الطالب يحذف تذكرته فقط؛ الردود لا تشير إليها فتبقى سليمة
  foreign key (student_id, teacher_id) references public.classroom_students(id, teacher_id) on update cascade on delete cascade
);
create unique index if not exists survey_invites_code_key on public.survey_invites(code) where code is not null;
create index if not exists survey_invites_student_idx on public.survey_invites(student_id);
alter table public.survey_invites enable row level security;
drop policy if exists "المعلم يدير تذاكر استباناته فقط" on public.survey_invites;
create policy "المعلم يدير تذاكر استباناته فقط" on public.survey_invites for all to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- المرحلة 2 (إضافية، آمنة على جدول فيه بيانات): «جهة أخرى» في الاستبانة المخصصة = شخص ليس طالبًا ولا ولي أمر،
-- يُدخل المعلم اسمه/وصفه ورقمه يدويًا. التذكرة إما لطالب (guardian/student) وإما لجهة أخرى (other)، لا الاثنان.
-- الرد لا يحمل شيئًا من ذلك (survey_responses بلا مستلم ولا اسم ولا رقم)، والصفحة العامة لا تعرضه.
alter table public.survey_invites alter column student_id drop not null;
alter table public.survey_invites add column if not exists contact_label text;
alter table public.survey_invites add column if not exists contact_phone text;
do $$
declare v_rel regclass := to_regclass('public.survey_invites'); r record;
begin
  -- قيد المستلم الأول باسم تلقائي: يُبحث عنه بتعريفه لا باسمه، ويُستبدل بقيد مسمّى (لا شيء في التشغيل الثاني)
  for r in select conname from pg_constraint
           where conrelid = v_rel and contype = 'c'
             and conname not in ('survey_invites_recipient_chk', 'survey_invites_target_chk')
             and pg_get_constraintdef(oid) like '%recipient%'
  loop
    execute format('alter table %s drop constraint %I', v_rel, r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = v_rel and conname = 'survey_invites_recipient_chk') then
    alter table public.survey_invites add constraint survey_invites_recipient_chk
      check (recipient in ('guardian', 'student', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = v_rel and conname = 'survey_invites_target_chk') then
    alter table public.survey_invites add constraint survey_invites_target_chk check (
      (recipient = 'other' and student_id is null
        and contact_label is not null and char_length(btrim(contact_label)) between 1 and 60
        and contact_label !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')
        and contact_phone is not null and contact_phone ~ '^[0-9]{9,15}$')
      or (recipient <> 'other' and student_id is not null and contact_label is null and contact_phone is null));
  end if;
end $$;
-- لا رقم مكرر لجهة أخرى في الاستبانة نفسها (تذاكر الطلاب يضبطها unique (campaign_id, student_id, recipient))
create unique index if not exists survey_invites_other_phone_key on public.survey_invites(campaign_id, contact_phone) where recipient = 'other';

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 16384),
  created_on date not null default current_date,
  -- no action (لا cascade): لا تُحذف حملة فيها ردود؛ وحذف حساب المعلم يحذف الاثنين معًا بنفس الجملة
  foreign key (campaign_id, teacher_id) references public.survey_campaigns(id, teacher_id) on update cascade
);
create index if not exists survey_responses_campaign_idx on public.survey_responses(campaign_id);
alter table public.survey_responses enable row level security;
drop policy if exists "المعلم يقرأ ردود استباناته فقط" on public.survey_responses;
create policy "المعلم يقرأ ردود استباناته فقط" on public.survey_responses for select to authenticated
  using (auth.uid() = teacher_id);
revoke insert, update, delete on public.survey_responses from anon, authenticated;

-- تجميد الأسئلة والجمهور بعد أول إرسال، ومنع نقل الاستبانة لمعلم آخر، ومنع جمهور يخالف تذاكر قائمة
create or replace function public.survey_campaign_guard() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if new.teacher_id is distinct from old.teacher_id then
    raise exception 'لا يُغيَّر مالك الاستبانة' using errcode = '42501';
  end if;
  if (new.questions is distinct from old.questions or new.audience is distinct from old.audience)
     and exists (select 1 from public.survey_invites i
                 where i.campaign_id = old.id and (i.sent_at is not null or i.answered_on is not null)) then
    raise exception 'الأسئلة تتجمّد بعد أول إرسال' using errcode = '55000';
  end if;
  if new.audience is distinct from old.audience and new.audience <> 'custom'
     and exists (select 1 from public.survey_invites i where i.campaign_id = old.id and i.recipient <> new.audience) then
    raise exception 'توجد تذاكر لمستلم لا يطابق الجمهور الجديد' using errcode = '23514';
  end if;
  return new;
end
$fn$;
create or replace trigger trg_survey_campaign_guard before update on public.survey_campaigns
  for each row execute function public.survey_campaign_guard();

-- مستلم التذكرة يطابق جمهور الاستبانة (guardian ← ولي الأمر فقط، student ← الطالب فقط،
-- custom ← ولي الأمر أو الطالب أو جهة أخرى). «other» لا يُقبل أبدًا في استبانة guardian أو student.
create or replace function public.survey_invite_audience_guard() returns trigger
language plpgsql set search_path = '' as $fn$
declare v_aud text;
begin
  select c.audience into v_aud from public.survey_campaigns c where c.id = new.campaign_id;
  if v_aud is not null and v_aud <> 'custom' and new.recipient <> v_aud then
    raise exception 'مستلم التذكرة لا يطابق جمهور الاستبانة' using errcode = '23514';
  end if;
  return new;
end
$fn$;
create or replace trigger trg_survey_invite_audience_guard before insert or update of recipient, campaign_id on public.survey_invites
  for each row execute function public.survey_invite_audience_guard();

-- تنظيف الإجابات وفق أسئلة الاستبانة نفسها (نفس قواعد surveyValidateAnswers بـsurvey-templates.js):
-- يرجع الكائن المعاد بناؤه من معرّفات الأسئلة وحدها، أو null عند أي خطأ.
-- rating عدد 1..5 صحيح، truefalse منطقي، choice فهرس صحيح أصغر من عدد الخيارات، text نص بعد btrim ≤300 (الفارغ يُحذف).
-- المطلوب (required) يجب أن يحضر صالحًا؛ غير المطلوب يُهمل إن غاب أو كان null.
create or replace function public.survey_answers_clean(p_questions jsonb, p_answers jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; v_id text; v_type text; v_req boolean; v_v jsonb; v_s text; v_out jsonb := '{}'::jsonb;
begin
  if not public.survey_questions_ok(p_questions) then return null; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return null; end if;
  for e in select x from jsonb_array_elements(p_questions) x loop
    v_id := e->>'id'; v_type := e->>'type'; v_req := (e->>'required')::boolean; v_v := p_answers->v_id;
    if v_v is null or jsonb_typeof(v_v) = 'null' then
      if v_req then return null; end if;
      continue;
    end if;
    if v_type = 'rating' then
      if jsonb_typeof(v_v) <> 'number' or v_v::text !~ '^[1-5]$' then return null; end if;
    elsif v_type = 'truefalse' then
      if jsonb_typeof(v_v) <> 'boolean' then return null; end if;
    elsif v_type = 'choice' then
      if jsonb_typeof(v_v) <> 'number' or v_v::text !~ '^[0-9]{1,2}$' or (v_v::text)::int >= jsonb_array_length(e->'options') then return null; end if;
    elsif v_type = 'text' then
      if jsonb_typeof(v_v) <> 'string' then return null; end if;
      v_s := btrim(v_v #>> '{}');
      if v_s = '' then
        if v_req then return null; end if;
        continue;
      end if;
      if char_length(v_s) > 300 then return null; end if;
      v_v := to_jsonb(v_s);
    else
      return null;
    end if;
    v_out := v_out || jsonb_build_object(v_id, v_v);
  end loop;
  return v_out;
end
$fn$;
revoke execute on function public.survey_answers_clean(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.survey_answers_clean(jsonb, jsonb) to service_role;

-- استلام رد عبر التذكرة: ذرّي بمعاملة واحدة. الأسئلة تُقرأ من الحملة نفسها (for share يمنع تعديلها حتى نهاية المعاملة)،
-- ثم التحديث المشروط (answered_on is null) يقفل صف التذكرة، فطلبان متزامنان بنفس الرمز: الثاني ينتظر ثم لا يجد صفًا
-- فيرجع false بلا إدراج. يرجع true فقط إن أُدرج الرد. كل خطأ آخر false (لا يُكشف السبب).
create or replace function public.submit_survey(p_code text, p_answers jsonb)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare v_questions jsonb; v_clean jsonb; v_campaign uuid; v_teacher uuid;
begin
  if p_code is null or p_code !~ '^[a-z2-9]{8,32}$' then return false; end if;
  select c.questions into v_questions
    from public.survey_invites i join public.survey_campaigns c on c.id = i.campaign_id and c.teacher_id = i.teacher_id
    where i.code = p_code
    for share of c;
  if not found then return false; end if;
  v_clean := public.survey_answers_clean(v_questions, p_answers);
  if v_clean is null then return false; end if;

  update public.survey_invites i set answered_on = current_date
    from public.survey_campaigns c
    where i.code = p_code and i.answered_on is null
      and c.id = i.campaign_id and c.teacher_id = i.teacher_id
      and c.status = 'open' and c.closes_at > now()
    returning i.campaign_id, i.teacher_id into v_campaign, v_teacher;
  if not found then return false; end if;

  insert into public.survey_responses (campaign_id, teacher_id, answers, created_on)
    values (v_campaign, v_teacher, v_clean, current_date);
  return true;
end
$fn$;
revoke execute on function public.submit_survey(text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_survey(text, jsonb) to service_role;

-- حذف استبانة كاملة (المالك فقط): الردود ثم التذاكر ثم ربط الشعب ثم الاستبانة، بمعاملة واحدة.
-- المعلم لا يملك حذف الردود مباشرة (مسحوب)، فهذا المسار المضبوط هو الوحيد. يرجع false لغير الموجود ولغير المالك
-- بلا تمييز. قفل الصف (for update) يُسلسله مع submit_survey (for share): لا رد يُدرج لاستبانة تُحذف.
create or replace function public.delete_survey(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_id is null then return false; end if;
  perform 1 from public.survey_campaigns where id = p_id and teacher_id = v_uid for update;
  if not found then return false; end if;
  delete from public.survey_responses where campaign_id = p_id and teacher_id = v_uid;
  delete from public.survey_invites where campaign_id = p_id and teacher_id = v_uid;
  delete from public.survey_campaign_sections where campaign_id = p_id and teacher_id = v_uid;
  delete from public.survey_campaigns where id = p_id and teacher_id = v_uid;
  return true;
end
$fn$;
revoke execute on function public.delete_survey(uuid) from public, anon;
grant execute on function public.delete_survey(uuid) to authenticated;

-- ============ متابعة مؤشرات القيادة المدرسية (LEADER-FOLLOWUP.md) ============
-- طلب متابعة من المعلم لمسؤول بالمدرسة (مدير/وكيل): قائمة مؤشرات + أوقات مقترحة للقاء، برابط شخصي يُستعمل مرة واحدة.
-- - جدول واحد: الطلب وإجابته وموعده بصف واحد (الإجابة هنا باسم المسؤول عمدًا، بخلاف الاستبانات المجهولة).
-- - كلها بـauth.uid() = teacher_id وبلا سياسة مسؤول. الكتابة العامة من submit_leader_followup وحدها (service_role عبر api/f.js).
-- - المعلم لا يكتب الإجابة ولا الموعد ولا وقت الرد: صلاحيات أعمدة (grant) ثم تريجر يُجمّد الطلب بعد الرد.
-- - الطلب يُعدَّل قبل التسليم بنفس الرابط (3.47)؛ فقط لا يُحذف مؤشر بدأ المسؤول إجابته في مسودته. الحذف (حتى المجاب عنه) يمرّ بسلة المحذوفات بالواجهة.
-- - الموعد: يختار من المقترحة، أو «لا يناسبني» مع اقتراح بديل (proposed_slot)؛ المعلم يثبّته بـset_leader_meeting ويؤكد عبر واتساب.
-- - مسودة المسؤول (draft) تُحفظ بالخادم من الرابط نفسه (save_leader_draft) ليكمل لاحقًا من أي جهاز قبل التسليم.
-- - الموعد المحجوز لا يتكرر لدى المعلم نفسه (فهرس فريد جزئي)، فاختيار مسؤولين الموعد نفسه: الأول ينجح والثاني slot_taken.
-- - الرابط يموت عند الرد (code = null)، والرد بعده كالرابط الخاطئ.
-- - تعديلات لاحقة إضافية فقط وآمنة التكرار (لا drop table).

-- صحة مؤشرات الطلب (نفس قواعد leaderValidateIndicators بـleader-kit.js): مصفوفة 1..20 كائنًا بمفتاحين id وlabel؛
-- id بصيغة i<رقم> فريد؛ النص 1..150 حرفًا بعد btrim وبلا محارف تحكم.
create or replace function public.leader_indicators_ok(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; v_ids text[] := '{}'; v_id text; v_s text;
  v_ctl text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) < 1 or jsonb_array_length(p) > 20 then return false; end if;
  for e in select x from jsonb_array_elements(p) x loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if (select count(*) from jsonb_object_keys(e)) <> 2 or not (e ? 'id') or not (e ? 'label') then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or jsonb_typeof(e->'label') is distinct from 'string' then return false; end if;
    v_id := e->>'id';
    if v_id !~ '^i[0-9]{1,3}$' or v_id = any(v_ids) then return false; end if;
    v_ids := v_ids || v_id;
    v_s := btrim(e->>'label');
    if char_length(v_s) < 1 or char_length(v_s) > 150 or v_s ~ v_ctl then return false; end if;
  end loop;
  return true;
end
$fn$;

-- صحة الأوقات المقترحة (leaderValidateSlots): مصفوفة 0..6 نصوص بصيغة YYYY-MM-DDTHH:MM بلا تكرار
create or replace function public.leader_slots_ok(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; v_seen text[] := '{}'; v_s text;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 6 then return false; end if;
  for e in select x from jsonb_array_elements(p) x loop
    if jsonb_typeof(e) <> 'string' then return false; end if;
    v_s := e #>> '{}';
    if v_s !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$' or v_s = any(v_seen) then return false; end if;
    v_seen := v_seen || v_s;
  end loop;
  return true;
end
$fn$;

create table if not exists public.leader_followups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  -- سلسلة الدورات المتكررة لنفس المسؤول: الدورة التالية تأخذ series_id نفسه
  series_id uuid not null default gen_random_uuid(),
  leader_role text not null check (leader_role in ('principal', 'deputy_students', 'deputy_academic', 'deputy_other', 'other')),
  leader_name text check (leader_name is null or (char_length(btrim(leader_name)) between 1 and 60
    and leader_name !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']'))),
  cycle_label text not null check (char_length(btrim(cycle_label)) between 1 and 60
    and cycle_label !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')),
  -- اسم المعلم كما يظهر للمسؤول في الصفحة العامة (لقطة وقت الإنشاء)
  sender_name text check (sender_name is null or (char_length(btrim(sender_name)) between 1 and 60
    and sender_name !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']'))),
  indicators jsonb not null check (public.leader_indicators_ok(indicators)),
  slots jsonb not null default '[]'::jsonb check (public.leader_slots_ok(slots)),
  code text check (code is null or code ~ '^[a-z2-9]{8,32}$'),
  closes_at timestamptz not null,
  sent_at timestamptz,
  answered_at timestamptz,
  seen_at timestamptz,
  answers jsonb check (answers is null or (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 16384)),
  chosen_slot text check (chosen_slot is null or chosen_slot = 'none'
    or chosen_slot ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at timestamptz not null default now(),
  check ((answered_at is null) = (answers is null))
);
-- 3.46: مسودة المسؤول قبل التسليم {a: {i1: {s?, r?}}, slot?}؛ يكتبها save_leader_draft وحده (لا صلاحية عمود للمعلم)
alter table public.leader_followups add column if not exists draft jsonb
  constraint leader_followups_draft_chk check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 16384));
alter table public.leader_followups add column if not exists draft_saved_at timestamptz;
-- 3.47: موعد يقترحه المسؤول بدل المقترحة (مع «لا يناسبني») وملاحظته
alter table public.leader_followups add column if not exists proposed_slot text
  constraint leader_followups_proposed_chk check (proposed_slot is null or proposed_slot ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.leader_followups add column if not exists proposed_note text
  constraint leader_followups_note_chk check (proposed_note is null or (char_length(btrim(proposed_note)) between 1 and 100
    and proposed_note !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')));
create unique index if not exists leader_followups_code_key on public.leader_followups(code) where code is not null;
create unique index if not exists leader_followups_slot_key on public.leader_followups(teacher_id, chosen_slot) where chosen_slot is not null and chosen_slot <> 'none';
create index if not exists leader_followups_teacher_idx on public.leader_followups(teacher_id, series_id, created_at);
alter table public.leader_followups enable row level security;
drop policy if exists "المعلم يقرأ طلبات متابعته فقط" on public.leader_followups;
create policy "المعلم يقرأ طلبات متابعته فقط" on public.leader_followups for select to authenticated
  using (auth.uid() = teacher_id);
drop policy if exists "المعلم ينشئ طلبات متابعته فقط" on public.leader_followups;
create policy "المعلم ينشئ طلبات متابعته فقط" on public.leader_followups for insert to authenticated
  with check (auth.uid() = teacher_id and answered_at is null);
drop policy if exists "المعلم يعدّل طلبات متابعته فقط" on public.leader_followups;
create policy "المعلم يعدّل طلبات متابعته فقط" on public.leader_followups for update to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
-- الحذف: كل طلبات المعلم (المجاب عنه أيضًا منذ 3.46)، والواجهة تمرّه بسلة المحذوفات (30 يومًا) قبل الحذف
drop policy if exists "المعلم يحذف طلباته غير المجاب عنها" on public.leader_followups;
drop policy if exists "المعلم يحذف طلبات متابعته فقط" on public.leader_followups;
create policy "المعلم يحذف طلبات متابعته فقط" on public.leader_followups for delete to authenticated
  using (auth.uid() = teacher_id);
-- صلاحيات الأعمدة: المعلم لا يملك كتابة answers ولا chosen_slot ولا answered_at ولا created_at (من الدالة وحدها)
revoke all on public.leader_followups from anon;
revoke insert, update on public.leader_followups from authenticated;
grant insert (teacher_id, series_id, leader_role, leader_name, cycle_label, sender_name, indicators, slots, code, closes_at)
  on public.leader_followups to authenticated;
grant update (leader_role, leader_name, cycle_label, indicators, slots, code, closes_at, sent_at, seen_at)
  on public.leader_followups to authenticated;

-- حارس التعديل: لا نقل لمعلم آخر؛ بعد الرد لا يتغيّر شيء غير seen_at؛ بعد الإرسال تتجمّد المؤشرات والأوقات
create or replace function public.leader_followup_guard() returns trigger
language plpgsql set search_path = '' as $fn$
declare k text;
begin
  if new.teacher_id is distinct from old.teacher_id then
    raise exception 'لا يُغيَّر مالك الطلب' using errcode = '42501';
  end if;
  -- بعد التسليم: لا يتغيّر إلا seen_at، وchosen_slot (تثبيت الموعد بـset_leader_meeting وحدها: لا صلاحية عمود للمعلم)
  if old.answered_at is not null and (to_jsonb(new) - 'seen_at' - 'chosen_slot') is distinct from (to_jsonb(old) - 'seen_at' - 'chosen_slot') then
    raise exception 'الطلب المُجاب عنه لا يتغيّر' using errcode = '55000';
  end if;
  -- قبل التسليم يُعدَّل بحرية، إلا حذف مؤشر بدأ المسؤول إجابته في مسودته (فلا تضيع إجابته)
  if old.answered_at is null and old.draft is not null and new.indicators is distinct from old.indicators then
    for k in select jsonb_object_keys(coalesce(old.draft->'a', '{}'::jsonb)) loop
      if not exists (select 1 from jsonb_array_elements(new.indicators) x where x->>'id' = k) then
        raise exception 'لا يُحذف مؤشر بدأ المسؤول إجابته' using errcode = '55000';
      end if;
    end loop;
  end if;
  return new;
end
$fn$;
create or replace trigger trg_leader_followup_guard before update on public.leader_followups
  for each row execute function public.leader_followup_guard();

-- تنظيف إجابات المسؤول وفق مؤشرات الطلب نفسه (نفس قواعد leaderValidateAnswers بـleader-kit.js):
-- لكل مؤشر كائن {s: done|wip|no, r?: سبب}؛ السبب إلزامي لغير المنفذ، ≤300 بعد btrim وبلا محارف تحكم.
-- يرجع الكائن المعاد بناؤه من معرّفات المؤشرات وحدها، أو null عند أي خطأ.
create or replace function public.leader_answers_clean(p_indicators jsonb, p_answers jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; v_id text; v_a jsonb; v_s text; v_r text; v_out jsonb := '{}'::jsonb;
  v_ctl text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
begin
  if not public.leader_indicators_ok(p_indicators) then return null; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then return null; end if;
  for e in select x from jsonb_array_elements(p_indicators) x loop
    v_id := e->>'id'; v_a := p_answers->v_id;
    if v_a is null or jsonb_typeof(v_a) <> 'object' then return null; end if;
    if jsonb_typeof(v_a->'s') is distinct from 'string' then return null; end if;
    v_s := v_a->>'s';
    if v_s not in ('done', 'wip', 'no') then return null; end if;
    v_r := '';
    if v_a ? 'r' and jsonb_typeof(v_a->'r') <> 'null' then
      if jsonb_typeof(v_a->'r') <> 'string' then return null; end if;
      v_r := btrim(v_a->>'r');
      if v_r <> '' and (char_length(v_r) > 300 or v_r ~ v_ctl) then return null; end if;
    end if;
    if v_s <> 'done' and v_r = '' then return null; end if;
    v_out := v_out || jsonb_build_object(v_id, case when v_r = '' then jsonb_build_object('s', v_s) else jsonb_build_object('s', v_s, 'r', v_r) end);
  end loop;
  return v_out;
end
$fn$;
revoke execute on function public.leader_answers_clean(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.leader_answers_clean(jsonb, jsonb) to service_role;

-- استلام إجابة المسؤول عبر الرابط: ذرّي بمعاملة واحدة (قفل صف الطلب for update).
-- يرجع 'ok' أو 'slot_taken' (الموعد حُجز لمسؤول آخر قبله: يختار غيره) أو 'invalid' (رمز خاطئ/منتهٍ/مستخدَم أو إجابة غير صالحة).
-- p_slot: أحد الأوقات المقترحة أو 'none' (لا يناسبني) إن وُجدت أوقات؛ وnull إن لم توجد أوقات. بعد النجاح يموت الرابط.
create or replace function public.submit_leader_followup(p_code text, p_answers jsonb, p_slot text, p_proposed text, p_note text)
returns text language plpgsql security definer set search_path = '' as $fn$
declare r public.leader_followups%rowtype; v_clean jsonb; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_ctl text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
begin
  if p_code is null or p_code !~ '^[a-z2-9]{8,32}$' then return 'invalid'; end if;
  select * into r from public.leader_followups where code = p_code and answered_at is null and closes_at > now() for update;
  if not found then return 'invalid'; end if;
  v_clean := public.leader_answers_clean(r.indicators, p_answers);
  if v_clean is null then return 'invalid'; end if;
  if jsonb_array_length(r.slots) = 0 then
    if p_slot is not null or p_proposed is not null or v_note is not null then return 'invalid'; end if;
  elsif p_slot is null or not (p_slot = 'none' or r.slots ? p_slot) then
    return 'invalid';
  end if;
  -- اقتراح بديل وملاحظة مع «لا يناسبني» فقط
  if (p_proposed is not null or v_note is not null) and p_slot is distinct from 'none' then return 'invalid'; end if;
  if p_proposed is not null and p_proposed !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$' then return 'invalid'; end if;
  if v_note is not null and (char_length(v_note) > 100 or v_note ~ v_ctl) then return 'invalid'; end if;
  begin
    update public.leader_followups set answers = v_clean, chosen_slot = p_slot, proposed_slot = p_proposed, proposed_note = v_note,
        answered_at = now(), seen_at = null, code = null, draft = null
      where id = r.id;
  exception when unique_violation then
    return 'slot_taken';
  end;
  return 'ok';
end
$fn$;
revoke execute on function public.submit_leader_followup(text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_leader_followup(text, jsonb, text, text, text) to service_role;

-- الصيغة القديمة (3 معاملات) باقية للتوافق أثناء النشر: تمرّر بلا اقتراح
create or replace function public.submit_leader_followup(p_code text, p_answers jsonb, p_slot text)
returns text language sql security definer set search_path = '' as $fn$
  select public.submit_leader_followup(p_code, p_answers, p_slot, null, null)
$fn$;
revoke execute on function public.submit_leader_followup(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_leader_followup(text, jsonb, text) to service_role;

-- تثبيت موعد اللقاء بعد التسليم (المعلم المالك وحده): موعد اقترحه المسؤول أو اتفقا عليه عبر واتساب.
-- 'ok' أو 'slot_taken' (محجوز لمسؤول آخر لدى المعلم نفسه) أو 'invalid'. الحساب المعطَّل لا يثبّت شيئًا.
create or replace function public.set_leader_meeting(p_id uuid, p_slot text)
returns text language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or p_id is null or public.am_disabled() then return 'invalid'; end if;
  if p_slot is null or p_slot !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]$' then return 'invalid'; end if;
  perform 1 from public.leader_followups where id = p_id and teacher_id = v_uid and answered_at is not null for update;
  if not found then return 'invalid'; end if;
  begin
    update public.leader_followups set chosen_slot = p_slot where id = p_id and teacher_id = v_uid;
  exception when unique_violation then
    return 'slot_taken';
  end;
  return 'ok';
end
$fn$;
revoke execute on function public.set_leader_meeting(uuid, text) from public, anon;
grant execute on function public.set_leader_meeting(uuid, text) to authenticated;

-- قوالب مؤشرات يحفظها المعلم بالاسم (3.47) ليبدأ منها أي طلب جديد. القوالب الجاهزة («سجلات المدير») بالكود (leader-kit.js).
create table if not exists public.leader_templates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60
    and name !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']')),
  indicators jsonb not null check (public.leader_indicators_ok(indicators)),
  created_at timestamptz not null default now()
);
create index if not exists leader_templates_teacher_idx on public.leader_templates(teacher_id, created_at);
alter table public.leader_templates enable row level security;
drop policy if exists "المعلم يدير قوالب مؤشراته فقط" on public.leader_templates;
create policy "المعلم يدير قوالب مؤشراته فقط" on public.leader_templates for all to authenticated
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
revoke all on public.leader_templates from anon;

-- تنظيف مسودة المسؤول (نفس قواعد leaderValidateDraft بـleader-kit.js): إجابات جزئية مسموحة.
-- لكل مؤشر معروف كائن اختياري {s?: done|wip|no, r?: نص ≤300 بعد btrim بلا محارف تحكم}؛ الفارغ يُهمل، والمعرّف المجهول يُهمل.
-- slot: null أو 'none' أو أحد الأوقات المقترحة. يرجع {a, slot} أو null عند أي خطأ.
create or replace function public.leader_draft_clean(p_indicators jsonb, p_slots jsonb, p_draft jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $fn$
declare e jsonb; v_id text; v_a jsonb; v_x jsonb; v_s text; v_r text; v_o jsonb; v_out jsonb := '{}'::jsonb; v_slot jsonb;
  v_ctl text := '[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || ']';
begin
  if not public.leader_indicators_ok(p_indicators) or not public.leader_slots_ok(p_slots) then return null; end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then return null; end if;
  v_a := p_draft->'a';
  if v_a is null or jsonb_typeof(v_a) = 'null' then v_a := '{}'::jsonb; end if;
  if jsonb_typeof(v_a) <> 'object' then return null; end if;
  for e in select x from jsonb_array_elements(p_indicators) x loop
    v_id := e->>'id'; v_x := v_a->v_id;
    if v_x is null or jsonb_typeof(v_x) = 'null' then continue; end if;
    if jsonb_typeof(v_x) <> 'object' then return null; end if;
    v_o := '{}'::jsonb;
    if v_x ? 's' and jsonb_typeof(v_x->'s') <> 'null' and coalesce(v_x->>'s', '') <> '' then
      if jsonb_typeof(v_x->'s') <> 'string' or (v_x->>'s') not in ('done', 'wip', 'no') then return null; end if;
      v_o := v_o || jsonb_build_object('s', v_x->>'s');
    end if;
    if v_x ? 'r' and jsonb_typeof(v_x->'r') <> 'null' then
      if jsonb_typeof(v_x->'r') <> 'string' then return null; end if;
      v_r := btrim(v_x->>'r');
      if v_r <> '' then
        if char_length(v_r) > 300 or v_r ~ v_ctl then return null; end if;
        v_o := v_o || jsonb_build_object('r', v_r);
      end if;
    end if;
    if v_o <> '{}'::jsonb then v_out := v_out || jsonb_build_object(v_id, v_o); end if;
  end loop;
  v_slot := p_draft->'slot';
  if v_slot is null or jsonb_typeof(v_slot) = 'null' then
    v_slot := 'null'::jsonb;
  elsif jsonb_typeof(v_slot) <> 'string' or not ((v_slot #>> '{}') = 'none' or p_slots ? (v_slot #>> '{}')) or jsonb_array_length(p_slots) = 0 then
    return null;
  end if;
  return jsonb_build_object('a', v_out, 'slot', v_slot);
end
$fn$;
revoke execute on function public.leader_draft_clean(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.leader_draft_clean(jsonb, jsonb, jsonb) to service_role;

-- حفظ مسودة المسؤول عبر الرابط (لا يستهلك الرابط): الطلب مفتوح ولم يُجب ولم تنتهِ مدته. true عند الحفظ، وإلا false.
create or replace function public.save_leader_draft(p_code text, p_draft jsonb)
returns boolean language plpgsql security definer set search_path = '' as $fn$
declare r public.leader_followups%rowtype; v_clean jsonb;
begin
  if p_code is null or p_code !~ '^[a-z2-9]{8,32}$' then return false; end if;
  select * into r from public.leader_followups where code = p_code and answered_at is null and closes_at > now() for update;
  if not found then return false; end if;
  v_clean := public.leader_draft_clean(r.indicators, r.slots, p_draft);
  if v_clean is null then return false; end if;
  update public.leader_followups set draft = v_clean, draft_saved_at = now() where id = r.id;
  return true;
end
$fn$;
revoke execute on function public.save_leader_draft(text, jsonb) from public, anon, authenticated;
grant execute on function public.save_leader_draft(text, jsonb) to service_role;

-- ============================================================
-- النسخة الاحتياطية الشاملة للمسؤول (app-07: exportFullBackup)
-- سياسات الجداول تمنع المسؤول من قراءة بيانات المعلمين في أغلب جداول إدارة الصف (خصوصية مقصودة للشاشات)،
-- فكانت «النسخة الشاملة» تحمل بيانات المسؤول وحده في تلك الجداول بصمت. هذه الدوال تقرأ كل الجداول كاملة
-- لغرض النسخ فقط، وللمسؤول وحده (is_admin)، ولا تغيّر صلاحيات أي شاشة.
-- - قائمة بيضاء ثابتة: لا اسم جدول من الطلب يُنفَّذ إلا إن كان فيها. خارجها عمدًا: رموز الموصل (personal_access_tokens)
--   ومحاولات الدخول وروابط التقارير المؤقتة (student_report_shares) — لا قيمة لاستعادتها.
-- - روابط الاستبانة تُصدَّر بلا رمز (code = null)، فلا تُحيي النسخةُ المستعادة روابطَ قديمة (SURVEYS.md).
-- - كل نسخة تُسجَّل في audit_log بأعداد الجداول.
-- ============================================================
create or replace function public.admin_backup_tables()
returns text[] language sql immutable set search_path = '' as $fn$
  select array[
    'profiles', 'admins', 'performance_elements', 'audit_log',
    'shawahid', 'performance_goals', 'plan_header', 'self_assessment', 'shahid_drafts', 'tasks',
    'activity_programs', 'program_sections', 'support_messages', 'deleted_items', 'user_app_settings',
    'academic_calendar_weeks', 'academic_calendar_holidays', 'academic_cases',
    'classroom_grade_levels', 'classroom_sections', 'classroom_students', 'classroom_incident_types', 'classroom_incidents',
    'classroom_letter_counters', 'classroom_timetable_slots', 'classroom_lessons', 'classroom_attendance',
    'classroom_positive_notes', 'classroom_private_notes', 'classroom_followups', 'classroom_followup_actions',
    'classroom_attention_dismissals', 'classroom_lesson_skips', 'classroom_custom_tools', 'classroom_grade_columns',
    'classroom_grade_scores', 'classroom_grade_period_scores', 'classroom_tool_marks',
    'classroom_rubric_criteria', 'classroom_rubric_marks', 'classroom_rubric_notes',
    'lesson_plans', 'classroom_homework', 'classroom_homework_status', 'classroom_tasks', 'classroom_task_students',
    'survey_campaigns', 'survey_campaign_sections', 'survey_invites', 'survey_responses',
    'leader_followups', 'leader_templates'
  ]::text[]
$fn$;

-- أعداد الصفوف الفعلية لكل جدول (تُقارَن بما جُلب، فيُكشف أي نقص) + تسجيل النسخة في سجل النشاط
create or replace function public.admin_backup_counts()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := auth.uid(); v_t text; v_n bigint; v_res jsonb := '{}'::jsonb;
begin
  if v_uid is null or not public.is_admin(v_uid) then raise exception 'forbidden'; end if;
  foreach v_t in array public.admin_backup_tables() loop
    if to_regclass(format('public.%I', v_t)) is null then continue; end if; -- جدول غير منشأ بعد: يغيب من الأعداد فيُعلَن ناقصًا
    execute format('select count(*) from public.%I', v_t) into v_n;
    v_res := v_res || jsonb_build_object(v_t, v_n);
  end loop;
  insert into public.audit_log (action, table_name, performed_by, performed_by_email, details)
    values ('full_backup', 'all', v_uid, (select u.email from auth.users u where u.id = v_uid), jsonb_build_object('counts', v_res));
  return v_res;
end
$fn$;

-- صفحة صفوف من جدول (بترتيب المفتاح الأساسي، فالصفحات المتتالية لا تُسقط ولا تكرّر صفًا)
create or replace function public.admin_backup_rows(p_table text, p_offset integer, p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := auth.uid(); v_order text; v_rows jsonb;
begin
  if v_uid is null or not public.is_admin(v_uid) then raise exception 'forbidden'; end if;
  if p_table is null or not (p_table = any(public.admin_backup_tables())) then raise exception 'unknown table'; end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'bad range'; end if;
  select string_agg(format('t.%I', a.attname), ', ' order by array_position(i.indkey::int2[], a.attnum)) into v_order
    from pg_catalog.pg_index i
    join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  if v_order is null then raise exception 'no primary key: %', p_table; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by %s), ''[]''::jsonb) from (select * from public.%I t order by %s offset $1 limit $2) t',
    v_order, p_table, v_order) into v_rows using p_offset, p_limit;
  if p_table in ('survey_invites', 'leader_followups') then
    select coalesce(jsonb_agg(x.e || jsonb_build_object('code', null) order by x.n), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) with ordinality x(e, n);
  end if;
  return v_rows;
end
$fn$;

revoke execute on function public.admin_backup_counts() from public, anon;
revoke execute on function public.admin_backup_rows(text, integer, integer) from public, anon;
grant execute on function public.admin_backup_counts() to authenticated;
grant execute on function public.admin_backup_rows(text, integer, integer) to authenticated;

-- ============================================================
-- فرض «تعطيل الحساب» من القاعدة نفسها (لوحة المسؤول ← تعطيل)
-- كان التعطيل تفرضه الواجهة وحدها (app-03 يقرأ profiles.disabled عند الدخول)، فالمعلم المعطَّل يبقى قادرًا،
-- بنداء مباشر لواجهة Supabase، على قراءة بياناته وتعديلها. هنا سياسة «مقيِّدة» (restrictive) على كل جدول بيانات معلم:
-- تُضاف شرطًا إلزاميًا فوق السياسات الحالية (لا تحلّ محلها ولا توسّعها)، فالمعطَّل لا يقرأ ولا يكتب شيئًا.
-- - profiles مستثنى عمدًا: التطبيق يقرأ منه حالة التعطيل ليُظهر للمعلم سبب منعه، والمسؤول يعيد التفعيل منه.
-- - admins مستثنى: صلاحيات المسؤول تُدار هناك وحده.
-- - حاويتا الصور وتقارير الطلاب كذلك (رفع وقراءة وحذف).
-- - الموصل ورابط التقويم (api/mcp.js وapi/calendar-feed.js) يفحصان التعطيل بأنفسهما (مفتاح الخدمة يتجاوز RLS).
-- آمن التكرار: يحذف السياسة ثم ينشئها.
-- ============================================================
create or replace function public.am_disabled()
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select p.disabled from public.profiles p where p.id = auth.uid()), false)
$fn$;
revoke execute on function public.am_disabled() from public, anon;
grant execute on function public.am_disabled() to authenticated;

do $do$
declare v_t text;
begin
  foreach v_t in array array[
    'academic_cases', 'activity_programs', 'classroom_attendance', 'classroom_attention_dismissals', 'classroom_custom_tools',
    'classroom_followup_actions', 'classroom_followups', 'classroom_grade_columns', 'classroom_grade_levels',
    'classroom_grade_period_scores', 'classroom_grade_scores', 'classroom_homework', 'classroom_homework_status',
    'classroom_incidents', 'classroom_lesson_skips', 'classroom_lessons', 'classroom_letter_counters',
    'classroom_positive_notes', 'classroom_private_notes', 'classroom_rubric_criteria', 'classroom_rubric_marks',
    'classroom_rubric_notes', 'classroom_sections', 'classroom_students', 'classroom_task_students', 'classroom_tasks',
    'classroom_timetable_slots', 'classroom_tool_marks', 'deleted_items', 'lesson_plans', 'performance_goals',
    'personal_access_tokens', 'plan_header', 'program_sections', 'self_assessment', 'shahid_drafts', 'shawahid',
    'leader_followups', 'leader_templates', 'student_report_shares', 'support_messages', 'survey_campaign_sections', 'survey_campaigns', 'survey_invites',
    'survey_responses', 'tasks', 'user_app_settings'
  ] loop
    if to_regclass(format('public.%I', v_t)) is null then continue; end if;
    execute format('drop policy if exists %I on public.%I', 'block_disabled_accounts', v_t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (not (select public.am_disabled())) with check (not (select public.am_disabled()))', 'block_disabled_accounts', v_t);
  end loop;
end
$do$;

drop policy if exists "block_disabled_accounts" on storage.objects;
create policy "block_disabled_accounts" on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('shawahid-photos', 'report-shares') or not (select public.am_disabled()))
  with check (bucket_id not in ('shawahid-photos', 'report-shares') or not (select public.am_disabled()));
