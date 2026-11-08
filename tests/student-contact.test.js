'use strict';
/* ============================================================
   جوال الطالب وولي الأمر + ملاحظة واتساب (app-42):
   - توحيد الأرقام ورفض الخاطئ، والرابط يُرمَّز فلا يحمل حقنًا.
   - الإضافة والتعديل يكتبان بمعرّف المعلم، والخاطئ لا يصل للقاعدة.
   - الاستيراد يلتقط عمودي الجوال ولا يخلطهما برقم الطالب.
   - البطاقة تُهرِّب النص ولا تُنتج أي مكان للأرقام في التقارير.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp, runInAppContext } = require('./load-app');
const root = path.join(__dirname, '..');

function appWith(log, opts){
  const sb = {
    from(table){
      const f = []; let op = 'select', values = null;
      const api = { select(){ return api; }, eq(c, v){ f.push([c, v]); return api; }, in(){ return api; },
        insert(v){ op = 'insert'; values = v; return api; }, update(v){ op = 'update'; values = v; return api; },
        then(res, rej){ log.push({ table, op, values, filters: f.slice() }); return Promise.resolve({ data: [], error: (opts && opts.error) || null }).then(res, rej); } };
      return api;
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) },
  };
  const app = loadApp({ supabaseClient: sb, currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h);
    window.__opened = []; window.open = (...a) => window.__opened.push(a);
    crmStudents = [{ id: 'a', full_name: 'سامي <b>علي</b>', is_active: true, guardian_phone: '966501234567', student_phone: null }];`);
  return app;
}
const norm = (app, v) => JSON.parse(JSON.stringify(runInAppContext(app, `normalizePhone(${JSON.stringify(v)})`)));

test('توحيد الأرقام: صيغ سعودية ودولية وأرقام عربية، والفارغ صحيح، والخاطئ يُرفض', () => {
  const app = appWith([]);
  assert.equal(norm(app, '0501234567').value, '966501234567');
  assert.equal(norm(app, '0501 234 567').value, '966501234567');
  assert.equal(norm(app, '501234567').value, '966501234567');
  assert.equal(norm(app, '+966501234567').value, '966501234567');
  assert.equal(norm(app, '00966501234567').value, '966501234567');
  assert.equal(norm(app, '966 05 0123 4567').value, '966501234567', '966 ثم 05 خطأ شائع');
  assert.equal(norm(app, '٠٥٠١٢٣٤٥٦٧').value, '966501234567', 'أرقام عربية');
  assert.equal(norm(app, '+20 100 123 4567').value, '201001234567', 'دولي غير سعودي');
  assert.deepEqual(norm(app, '   '), { ok: true, value: null });
  for(const bad of ['abc', '0501', '0601234567', '05012345678', '+966 4 1234567', '12; drop table', '٠٥٠'])
    assert.equal(norm(app, bad).ok, false, 'يُرفض: ' + bad);
});

test('رابط واتساب: رقم صالح فقط، والنص يُرمَّز كاملًا فلا يُحقن', () => {
  const app = appWith([]);
  const u = runInAppContext(app, `waChatUrl('966501234567', 'مرحبا&phone=1 #x?y')`);
  assert.match(u, /^https:\/\/wa\.me\/966501234567\?text=/);
  assert.doesNotMatch(u.split('?text=')[1], /[&# ?]/, 'لا فواصل رابط خام داخل النص');
  assert.equal(runInAppContext(app, `waChatUrl('9665; x', 'a')`), '');
  assert.equal(runInAppContext(app, `waChatUrl('', 'a')`), '');
  assert.equal(runInAppContext(app, `phoneDisplay('966501234567')`), '+966 50 123 4567');
  assert.equal(runInAppContext(app, `phoneEditValue('966501234567')`), '0501234567');
});

test('البطاقة: تهرِّب النص، وزر واتساب لمن له رقم فقط، والعرض بلا رقم غير صالح', () => {
  const app = appWith([]);
  const h = runInAppContext(app, `crmContactCardHtml({ id: 'a', full_name: 'x', is_active: true, guardian_phone: '966501234567', student_phone: null })`);
  assert.match(h, /openCrmWaNote\('a','guardian'\)/);
  assert.doesNotMatch(h, /openCrmWaNote\('a','student'\)/, 'لا رقم للطالب فلا زر');
  assert.match(h, /تعديل الأرقام/);
  const arch = runInAppContext(app, `crmContactCardHtml({ id: 'a', is_active: false, guardian_phone: null, student_phone: null })`);
  assert.doesNotMatch(arch, /openCrmContactEditor/, 'الطالب المنقول للاطلاع فقط');
});

test('إضافة طالب: الأرقام تُحفظ موحّدة بمعرّف المعلم، والخاطئ لا يصل للقاعدة', async () => {
  const log = [];
  const app = appWith(log);
  const setup = (name, sp, gp) => runInAppContext(app, `
    crmStuView = { mode: 'section', sectionId: 'S' }; crmSectionById = () => ({ id: 'S', name: '1', grade_level_id: 'G' }); crmGradeLevels = [{ id: 'G', name: 'ثاني' }];
    loadCrmStudents = async () => {}; renderCrmStudentsList = () => {}; renderCrmLinkBanner = () => {};
    window.__els = { newStudentName: { value: ${JSON.stringify(name)}, focus(){} }, newStudentNumber: { value: '' }, newStudentPhone: { value: ${JSON.stringify(sp)} }, newGuardianPhone: { value: ${JSON.stringify(gp)} }, crmYearInput: { value: '2026' }, newStudentSaveBtn: {} };
    document.getElementById = id => window.__els[id] || { style: {}, value: '' };
    window.__p = addClassroomStudent();`);
  setup('خالد', '0551234567', '+966 50 123 4567');
  await runInAppContext(app, 'window.__p');
  const ins = log.find(l => l.table === 'classroom_students' && l.op === 'insert');
  assert.equal(ins.values.teacher_id, 'u1');
  assert.equal(ins.values.student_phone, '966551234567');
  assert.equal(ins.values.guardian_phone, '966501234567');
  log.length = 0;
  setup('خالد', '0551234567', '12345');
  await runInAppContext(app, 'window.__p');
  assert.equal(log.length, 0, 'رقم خاطئ: لا كتابة');
  assert.match(runInAppContext(app, 'window.__toasts.join("|")'), /error:جوال ولي الأمر/);
});

test('تعديل الأرقام: يكتب بمعرّف المعلم والطالب، ولا يرسم فوق ملف طالب آخر، ويفرغ الرقم عند حذفه', async () => {
  const log = [];
  const app = appWith(log);
  runInAppContext(app, `
    const els = { crmCtGuardian: { value: '' }, crmCtStudent: { value: '0551234567' }, crmCtErr: { style: {} }, crmCtSaveBtn: {}, confirmCancelBtn: { click(){} } };
    document.getElementById = id => els[id] || { style: {}, value: '' };
    window.__rendered = 0; renderCrmStudentProfile = () => { window.__rendered++; };
    crmProfile = { studentId: 'other', token: 1 };
    window.__p = saveCrmStudentContact('a');`);
  await runInAppContext(app, 'window.__p');
  const up = log.find(l => l.op === 'update');
  assert.deepEqual(JSON.parse(JSON.stringify(up.values)), { guardian_phone: null, student_phone: '966551234567' });
  const f = JSON.stringify(up.filters);
  assert.match(f, /"teacher_id","u1"/);
  assert.match(f, /"id","a"/);
  assert.equal(runInAppContext(app, 'window.__rendered'), 0, 'المعلم في ملف طالب آخر: لا إعادة رسم');
  assert.equal(runInAppContext(app, 'crmStudents[0].student_phone'), '966551234567');
  assert.equal(runInAppContext(app, 'crmStudents[0].guardian_phone'), null);
});

test('ملاحظة واتساب: تفتح المحادثة مع الرقم المختار والنص مُرمَّز، والفارغ لا يفتح', () => {
  const app = appWith([]);
  runInAppContext(app, `
    const els = { crmWaText: { value: '  السلام عليكم  ' } };
    document.getElementById = id => els[id] || { style: {}, value: '' };
    document.querySelector = () => ({ value: 'guardian' });
    sendCrmWaNote('a');
    els.crmWaText.value = '   '; sendCrmWaNote('a');`);
  assert.equal(runInAppContext(app, 'window.__opened.length'), 1, 'الفارغ لا يفتح');
  const [url, target, feat] = runInAppContext(app, 'window.__opened[0]');
  assert.equal(url, 'https://wa.me/966501234567?text=' + encodeURIComponent('السلام عليكم'));
  assert.equal(target, '_blank');
  assert.equal(feat, 'noopener');
  const none = appWith([]);
  runInAppContext(none, `crmStudents = [{ id: 'z', full_name: 'ب', is_active: true }]; openCrmWaNote('z', 'guardian');`);
  assert.equal(runInAppContext(none, 'window.__modal.length'), 0, 'بلا رقم لا نافذة');
});

test('الاستيراد: التخطيط يحمل الجوالين، وعمود «رقم جوال» لا يُقرأ رقمًا للطالب', () => {
  const app = appWith([]);
  const plan = runInAppContext(app, `planStudentImport([{ full_name: 'سعد', student_number: '7', student_phone: '966551234567', guardian_phone: '966501234567' }], [], 'S')`);
  assert.equal(plan.toInsert[0].student_phone, '966551234567');
  assert.equal(plan.toInsert[0].guardian_phone, '966501234567');
  const src = fs.readFileSync(path.join(root, 'app/app-04-academic-crm.js'), 'utf8');
  assert.match(src, /isPhoneKey/, 'أعمدة الجوال تُستبعد من «رقم الطالب»');
  assert.match(src, /noPhoneCol\('رقم', 'number'\)/);
});

test('الأرقام للتواصل فقط: لا تدخل التقارير، ولا يقرؤها موصل الذكاء الاصطناعي، والملف مسجَّل بالصفحة والكاش', () => {
  for(const f of ['app/app-36-student-report.js', 'app/app-34-grade-report.js', 'app/app-38-section-report.js', 'app/app-39-group-report.js']){
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /student_phone|guardian_phone/, f + ' بلا أرقام جوال');
  }
  const mcp = fs.readFileSync(path.join(root, 'api/mcp.js'), 'utf8');
  assert.doesNotMatch(mcp, /student_phone|guardian_phone/, 'الموصل لا يقرأ الأرقام');
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /app\/app-42-student-contact\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /app-42-student-contact\.js/);
  assert.match(fs.readFileSync(path.join(root, 'sql-updates-run-in-supabase.sql'), 'utf8'), /guardian_phone/);
});
