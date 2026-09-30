'use strict';
/* ============================================================
   اختبار buildSchemaSql(schema) — التوليد الآمن لبيئة staging
   ------------------------------------------------------------
   الأصل: buildSchemaSql() بـapp-07-backup-export.js نص SQL ضخم لإعادة بناء
   قاعدة البيانات كاملة، مكتوب بالكامل بـschema "public" مباشرة. لتوليد نفس
   البنية تحت schema "staging" (بيئة تجريبية منفصلة داخل نفس مشروع Supabase،
   بلا تكلفة مشروع إضافي)، أضفنا معامل schema يستبدل "public." بالschema
   المطلوبة، مع استثناء صريح لتريجرات auth.users (جدول مشترك عالميًا لا يخص
   أي schema بعينها — تشغيلها لـstaging يسحب التريجر من الإنتاج نفسه).

   هذا الاختبار يتحقق من ثلاثة أشياء حرجة:
   1) الاستدعاء الافتراضي buildSchemaSql() (بلا معامل) يبقى بالضبط كما كان —
      صفر تأثير على exportFullBackup/exportBackup الحاليين.
   2) buildSchemaSql('staging') يستبدل كل مرجع public.X بـstaging.X فعليًا.
   3) buildSchemaSql('staging') يستبعد تريجرات auth.users بالكامل — لو لم
      يُستبعد هذا القسم، أي بيئة staging تُنشأ ستسحب تريجر مزامنة التسجيل من
      الإنتاج وتُعطّل تسجيل المستخدمين الحقيقيين الجدد بصمت. ============ */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

test('buildSchemaSql', async (t) => {
  await t.test('بلا معامل (schema افتراضي public) يبقى كما هو تمامًا', () => {
    const app = loadApp();
    const sql = app.buildSchemaSql();
    assert.match(sql, /create table if not exists public\.shawahid/);
    assert.match(sql, /create table if not exists public\.profiles/);
    assert.match(sql, /trg_sync_profile_insert/);
    assert.match(sql, /trg_sync_profile_update/);
    // فحص دقيق لمعرّفات SQL فعلية (لا نص التعليقات التوضيحية العربية التي قد
    // تذكر كلمة staging كجزء من الشرح البشري بلا علاقة بالـschema المولَّدة)
    assert.doesNotMatch(sql, /create table if not exists staging\./);
    assert.doesNotMatch(sql, /staging\.is_admin/);
  });

  await t.test("schema='staging' يستبدل كل مرجع public.X بـstaging.X", () => {
    const app = loadApp();
    const sql = app.buildSchemaSql('staging');
    assert.match(sql, /create table if not exists staging\.shawahid/);
    assert.match(sql, /create table if not exists staging\.profiles/);
    assert.match(sql, /create table if not exists staging\.classroom_students/);
    assert.match(sql, /staging\.is_admin\(auth\.uid\(\)\)/);
    // لا يجب أن يبقى أي مرجع public.X لجداول/دوال التطبيق نفسه
    assert.doesNotMatch(sql, /\bpublic\.(shawahid|profiles|admins|classroom_\w+|academic_cases|performance_\w+|self_assessment|audit_log|plan_header|activity_programs|support_messages|personal_access_tokens|check_mcp_rate_limit|is_admin|sync_profile_from_auth|set_duty_type|set_plan_updated_at|set_shahid_ref_number|set_shahid_updated_at|set_activity_program_updated_at|set_student_activity_flag|log_shahid_delete|valid_shawahid_photo_urls|shawahid_ref_seq)\b/);
    // auth/storage schemas عالمية — تبقى بلا أي تغيير
    assert.match(sql, /auth\.uid\(\)/);
    assert.match(sql, /storage\.objects/);
    assert.match(sql, /storage\.buckets/);
    // فحوصات توافق الترحيل القديمة يجب أن تشير لـstaging أيضًا لا public
    assert.match(sql, /table_schema='staging'/);
    assert.doesNotMatch(sql, /table_schema='public'/);
  });

  await t.test('ترتيب الجمل: أي FK لجدول لاحق يجب أن يأتي بعد إنشائه', () => {
    // خلل حقيقي اكتُشف أثناء توليد نسخة staging لأول مرة: shawahid.goal_id
    // كانت تُضاف (بمرجع FK لـperformance_goals) قبل إنشاء ذلك الجدول بمئات
    // الأسطر — يفشل فعليًا لو شُغِّل هذا الملف كاملًا على قاعدة فارغة (الغرض
    // المعلن بتعليق أعلى buildSchemaSql: "شغّل هذا الملف كاملًا على مشروع
    // Supabase جديد"). هذا الاختبار يمنع تكرار هذا الترتيب الخاطئ مستقبلًا
    // لأي عمود FK جديد يُضاف بنفس الأسلوب.
    const app = loadApp();
    const sql = app.buildSchemaSql();
    const createGoalsIdx = sql.indexOf('create table if not exists public.performance_goals');
    const fkIdx = sql.indexOf('references public.performance_goals(id)');
    assert.ok(createGoalsIdx > -1, 'لم يُعثر على إنشاء جدول performance_goals');
    assert.ok(fkIdx > -1, 'لم يُعثر على مرجع FK لـperformance_goals');
    assert.ok(createGoalsIdx < fkIdx, 'مرجع FK لـperformance_goals يسبق إنشاء الجدول نفسه بالسكربت');
  });

  await t.test('اكتمال المخطط: أعمدة/جداول اكتُشف غيابها فعليًا أثناء تجهيز staging', () => {
    // هذا السكربت مُعلَن بتعليقه الخاص كأداة استرجاع كاملة من الصفر، لكن لم
    // يُشغَّل فعليًا من الصفر قبل بناء بيئة staging بهذا الأسبوع — فكُشفت
    // فجوتان حقيقيتان كانتا ستفشلان أي استرجاع كارثة حقيقي بصمت أو بخطأ:
    // (1) جدول login_attempts + الدوال الثلاث (حد محاولات الدخول الفاشلة)،
    // (2) عمود shawahid.cycle_stage (فشل saveShahid فعليًا بخطأ "schema
    // cache" أول محاولة حفظ حقيقية على staging لولا هذا العمود). هذا
    // الاختبار يمنع تكرار حذف أي منهما سهوًا مستقبلًا.
    const app = loadApp();
    const sql = app.buildSchemaSql();
    assert.match(sql, /create table if not exists public\.login_attempts/);
    assert.match(sql, /create or replace function public\.check_login_allowed/);
    assert.match(sql, /create or replace function public\.record_login_attempt/);
    assert.match(sql, /create or replace function public\.record_login\(\)/);
    assert.match(sql, /alter table public\.shawahid add column if not exists cycle_stage text/);
  });

  await t.test("schema='staging' يستبعد تريجرات auth.users المشتركة عالميًا", () => {
    const app = loadApp();
    const sql = app.buildSchemaSql('staging');
    // لو ظهر أي من هذين الاسمين بنص staging، فهذا يعني أن التوليد سيحاول
    // (drop ثم create) تريجرًا بنفس اسم تريجر الإنتاج على auth.users نفسه —
    // auth.users جدول واحد مشترك، فهذا يسحب مزامنة تسجيل المستخدمين الحقيقيين
    // لتكتب بدل ذلك بـstaging.profiles، ويُعطّل تسجيل الدخول الحقيقي بصمت.
    assert.doesNotMatch(sql, /trg_sync_profile_insert/);
    assert.doesNotMatch(sql, /trg_sync_profile_update/);
    assert.doesNotMatch(sql, /after insert on auth\.users/);
    assert.doesNotMatch(sql, /after update of raw_user_meta_data, email on auth\.users/);
  });

  await t.test('التقويم الدراسي الرسمي: جداول academic_calendar_weeks/holidays وعمود calendar_region', () => {
    const app = loadApp();
    const sql = app.buildSchemaSql();
    assert.match(sql, /create table if not exists public\.academic_calendar_weeks/);
    assert.match(sql, /create table if not exists public\.academic_calendar_holidays/);
    assert.match(sql, /alter table public\.profiles add column if not exists calendar_region text/);
    // قراءة عامة لأي معلم (بلا user_id — جداول مرجعية مشتركة)، بلا اعتماد على RLS الافتراضي فقط
    assert.match(sql, /create policy "أي معلم يقرأ تقويم الأسابيع"\s*\n\s*on public\.academic_calendar_weeks for select using \(auth\.uid\(\) is not null\)/);
    assert.match(sql, /create policy "أي معلم يقرأ إجازات التقويم"\s*\n\s*on public\.academic_calendar_holidays for select using \(auth\.uid\(\) is not null\)/);
  });
});
