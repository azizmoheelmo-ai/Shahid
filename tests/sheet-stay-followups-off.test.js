'use strict';
/* ============================================================
   بطلب صاحب التطبيق:
   - المتابعات مخفية حتى إشعار آخر (FOLLOWUPS_ON) — البيانات باقية.
   - حصة رُصد حضورها: "الحضور ✓" و"أكمل الرصد ←" بدل "تعديل".
   - الحفظ (حضورًا أو أداءً) يُبقي المعلم في مكانه — لا تُغلق الورقة.
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');

function client(tables, rpcLog){
  return {
    from(t){ const a = { select: () => a, eq: () => a, in: () => a, gte: () => a, lte: () => a, is: () => a, order: () => a, limit: () => a,
      then: (r) => Promise.resolve({ data: (tables && tables[t]) || [], error: null }).then(r) }; return a; },
    rpc(name, args){ if(rpcLog) rpcLog.push({ name, args }); return Promise.resolve({ data: name === 'save_lesson_attendance' ? 'L-NEW' : null, error: null }); },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

test('المتابعات مخفية: التبويب يُخفى، والانتقال إليه يفتح "اليوم"', async () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  assert.equal(get(app, 'FOLLOWUPS_ON'), false);
  runInAppContext(app, `appFeatures = { sections: {}, tools: {} }; dutyType = 'none';
    window.__rendered = []; renderCrmToday = () => window.__rendered.push('today'); renderCrmFollowups = () => window.__rendered.push('followups');`);
  app.applyAppFeatures();
  assert.equal(get(app, `document.getElementById('crmTabBtnFollowups').style.display`), 'none');
  app.switchCrmTab('followups');
  assert.deepEqual([...get(app, 'window.__rendered')], ['today']);
  assert.equal(get(app, `document.getElementById('crmTabFollowups').style.display`), 'none');
  assert.equal(get(app, `document.getElementById('crmTabToday').style.display`), 'block');
});

test('تبويب اليوم — حصة رُصد حضورها (في "المنجزة"): "الحضور ✓" وزر "أكمل الرصد ←" (لا "تعديل")', async () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  const today = get(app, 'localIsoDate()');
  runInAppContext(app, `
    appFeatures = { sections: { shahid: false }, tools: {} };
    loadCrmTimetable = async () => true; crmHolidayChecker = async () => ({ nameFor: () => null });
    crmSections = [{ id: 'S', name: '٦' }]; crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    crmTimetableSlots = [0, 1, 2, 3, 4, 5, 6].map(d => ({ section_id: 'S', weekday: d, period: 1, created_at: '2020-01-01' }));
    window.__box = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmTodayBody' ? window.__box : _g(id);`);
  runInAppContext(app, `sb.from = t => { const a = { select: () => a, eq: () => a, in: () => a, gte: () => a, lte: () => a, is: () => a, order: () => a, limit: () => a,
    then: (r) => Promise.resolve({ data: t === 'classroom_lessons' ? [{ id: 'L1', section_id: 'S', lesson_date: '${today}', period: 1 }] : [], error: null }).then(r) }; return a; };`);
  await app.renderCrmToday();
  const html = get(app, 'window.__box.innerHTML');
  assert.match(html, /الحضور ✓<\/span><\/div><\/div>\s*<button[^>]*>أكمل الرصد ←<\/button>/);
  assert.doesNotMatch(html, />تعديل</);
});

test('حفظ الحضور يُبقي الورقة مفتوحة على الحضور بزر "حفظ التعديل" (لا عودة للقائمة)', async () => {
  const rpcLog = [];
  const app = loadApp({ supabaseClient: client({}, rpcLog), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__closed = 0; closeCrmLessonSheet = () => { window.__closed++; crmSheet = null; };
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    invalidateAttention = () => {}; refreshAttention = () => {};
    crmSections = [{ id: 'S', name: '٦' }]; crmStudents = [{ id: 'a', full_name: 'أ', section_id: 'S' }];
    window.__body = { innerHTML: '' }; const _g = document.getElementById; document.getElementById = id => id === 'crmLessonSheetBody' ? window.__body : _g(id);
    crmSheet = { sectionId: 'S', dateIso: '2026-10-19', period: 1, states: { a: 'absent' }, lessonId: null, token: 1, dirty: true, markers: new Map() };`);
  await app.saveCrmLessonSheet();
  assert.equal(rpcLog.filter(l => l.name === 'save_lesson_attendance').length, 1);
  assert.equal(get(app, 'window.__closed'), 0, 'يبقى في الورقة');
  assert.equal(get(app, 'crmSheet.lessonId'), 'L-NEW');
  assert.equal(get(app, 'crmSheet.dirty'), false);
  assert.match(get(app, 'window.__body.innerHTML'), /حفظ التعديل/);
  assert.match(get(app, 'window.__body.innerHTML'), /حُفظ الحضور ✓ — أكمل المشاركة/);
  assert.doesNotMatch(get(app, 'window.__body.innerHTML'), /رُصدت هذه الحصة سابقًا/);
  assert.match(get(app, 'window.__toasts.join("|")'), /ok:تم حفظ الحضور/);
  assert.equal(get(app, 'crmSheetSaving'), false, 'الزر يعود قابلًا للنقر');
  await app.saveCrmLessonSheet();
  assert.equal(rpcLog.filter(l => l.name === 'save_lesson_attendance').length, 2, 'حفظ ثانٍ ممكن');
});

test('ملف الطالب — بلا "فتح متابعة" ولا قسم/سطر المتابعات (ولو للطالب متابعات محفوظة)', async () => {
  const app = loadApp({ supabaseClient: client(), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    crmSections = [{ id: 'S', name: '٦', grade_level_id: 'g' }]; crmGradeLevels = [{ id: 'g', name: 'ثاني' }];
    crmStudents = [{ id: 'a', full_name: 'أحمد', section_id: 'S', is_active: true }]; crmIncidentTypes = [{ id: 't' }];
    loadCrmStudentProfileData = async () => ({ attendance: [], recordedLessons: 0, currentSectionId: 'S', studentId: 'a',
      grades: { columns: [], scores: [] }, tasks: [], incidents: [], positives: [], privateNotes: [],
      followups: [{ id: 'f1', reason_text: 'غياب متكرر', status: 'open', review_date: '2026-10-25', created_at: '2026-10-10' }] });
    window.__body = { innerHTML: '', dataset: {} }; const _g = document.getElementById; document.getElementById = id => id === 'crmStudentProfileBody' ? window.__body : _g(id);
    crmProfile = { studentId: 'a', token: 1 };`);
  await app.renderCrmStudentProfile();
  const html = get(app, 'window.__body.innerHTML');
  assert.match(html, /أحمد/);
  assert.doesNotMatch(html, /فتح متابعة/);
  assert.doesNotMatch(html, /غياب متكرر/);
  assert.doesNotMatch(html, />المتابعات</);
  assert.doesNotMatch(html, /crm-status-key">المتابعة/);
});
