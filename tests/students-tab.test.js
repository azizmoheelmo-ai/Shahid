'use strict';
/* ============================================================
   تبويب الطلاب (إعادة تنظيم بطلب صاحب التطبيق):
   - "شعبي": بحث في كل الطلاب، وبطاقة لكل شعبة بعدد طلابها تحت مرحلتها.
   - صفحة الشعبة: طلابها، و"+ طالب" و"استيراد Excel" لها مباشرة، والنقل والحذف تحت ⋯.
   - "⚙ المراحل والشعب": الإضافة بخانة داخل الصفحة (لا نافذة المتصفح)، بلا تكرار.
   - الجدول الأسبوعي انتقل لتبويب "اليوم".
   ============================================================ */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, runInAppContext } = require('./load-app');

function client(log, opts){
  opts = opts || {};
  return {
    from(table){
      let op = 'select', values = null; const f = [];
      const api = { select: () => api, eq: (c, v) => { f.push([c, v]); return api; }, in: () => api, order: () => api, limit: () => api,
        insert: v => { op = 'insert'; values = v; return api; }, delete: () => { op = 'delete'; return api; },
        then: (res, rej) => {
          if(op !== 'select') log.push({ table, op, values, filters: f.slice() });
          const p = opts.delay ? new Promise(r => setTimeout(r, opts.delay)) : Promise.resolve();
          return p.then(() => ({ data: [], error: null })).then(res, rej);
        } };
      return api;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) }, storage: { from: () => ({}) }
  };
}
const get = (app, e) => runInAppContext(app, e);

function appWith(log, opts){
  const app = loadApp({ supabaseClient: client(log || [], opts), currentUser: { id: 'u1' } });
  runInAppContext(app, `
    window.__toasts = []; showToast = (m, k) => window.__toasts.push(k + ':' + m);
    window.__modal = []; showInfoModal = h => window.__modal.push(h); closeCrmModal = () => {};
    renderCrmLinkBanner = () => {}; loadCrmStudents = async () => {};
    crmGradeLevels = [{ id: 'g3', name: 'ثالث ثانوي' }, { id: 'g2', name: 'ثاني ثانوي' }, { id: 'g1', name: 'أول ثانوي' }];
    crmSections = [{ id: 'S7', name: '7', grade_level_id: 'g2' }, { id: 'S6', name: '6', grade_level_id: 'g2' }, { id: 'S3', name: '3', grade_level_id: 'g3' }];
    crmStudents = [
      { id: 'a', full_name: 'سامي <b>علي</b>', section_id: 'S6', student_number: '12' },
      { id: 'b', full_name: 'أحمد عمر', section_id: 'S6' },
      { id: 'c', full_name: 'خالد سعد', section_id: 'S7' },
      { id: 'd', full_name: 'فهد بلا شعبة', section_id: null }];
    crmArchivedStudents = [];
    document.getElementById('crmYearInput').value = '1448-1449';
    document.getElementById('crmStudentSearch').value = '';`);
  return app;
}
const html = (app, id) => get(app, `document.getElementById('${id}').innerHTML`);
const shown = (app, id) => get(app, `document.getElementById('${id}').style.display`);

test('شعبي — بطاقة لكل شعبة بعدد طلابها تحت مرحلتها (مرتبة)، و"غير مربوطين"، والمرحلة بلا شعب تُنبَّه، ولا حذف/نقل ظاهر', async () => {
  const app = appWith();
  app.renderCrmStudentsList();
  assert.equal(shown(app, 'crmStuHome'), 'block');
  assert.equal(shown(app, 'crmStuSection'), 'none');
  const h = html(app, 'crmStudentsList');
  assert.ok(h.indexOf('أول ثانوي') < h.indexOf('ثاني ثانوي') && h.indexOf('ثاني ثانوي') < h.indexOf('ثالث ثانوي'), 'المراحل بمعناها: أول ثم ثاني ثم ثالث (لا أبجديًا)');
  assert.ok(h.indexOf("openCrmStuSection('S6')") < h.indexOf("openCrmStuSection('S7')"), 'الشعب مرتبة رقميًا');
  assert.match(h, /<b>الشعبة 6<\/b> <small>· طالبان<\/small>/);
  assert.match(h, /<b>الشعبة 3<\/b> <small>· لا طلاب بعد — أضفهم<\/small>/);
  assert.match(h, /أول ثانوي<\/div><div class="crm-stu-none">لا شعب بعد/);
  const app2 = loadApp();
  const order = ['ثالث ثانوي', 'أول متوسط', 'ثاني ثانوي', 'الأول الثانوي', 'سادس ابتدائي'].map(name => ({ name })).sort(app2.crmCompareGrades).map(g => g.name);
  assert.deepEqual(order, ['سادس ابتدائي', 'أول متوسط', 'الأول الثانوي', 'ثاني ثانوي', 'ثالث ثانوي']);
  assert.match(h, /غير مربوطين بشعبة<\/b> <small>· طالب واحد/);
  assert.doesNotMatch(h, /deleteCrmStudent|openCrmTransferModal/);
});

test('البحث — نتائج من كل الشعب مع شعبة كل طالب، والاسم مُهرَّب', async () => {
  const app = appWith();
  runInAppContext(app, `document.getElementById('crmStudentSearch').value = 'سامي';`);
  app.renderCrmStudentsList();
  const h = html(app, 'crmStudentsList');
  assert.match(h, /طالب واحد/);
  assert.match(h, /سامي &lt;b&gt;علي&lt;\/b&gt; <span class="crm-stu-num">#12<\/span><small>ثاني ثانوي — الشعبة 6<\/small>/);
  assert.doesNotMatch(h, /<b>علي<\/b>/);
  assert.doesNotMatch(h, /أحمد عمر/);
});

test('صفحة الشعبة — طلابها فقط مرتبين، و+ طالب/استيراد لها؛ و"غير مربوطين" بلا إضافة؛ وشعبة حُذفت = العودة لشعبي', async () => {
  const app = appWith();
  app.openCrmStuSection('S6');
  assert.equal(shown(app, 'crmStuHome'), 'none');
  assert.equal(shown(app, 'crmStuSection'), 'block');
  assert.equal(get(app, `document.getElementById('crmStuSectionTitle').textContent`), 'ثاني ثانوي — الشعبة 6');
  assert.equal(get(app, `document.getElementById('crmStuSectionCount').textContent`), 'طالبان');
  const h = html(app, 'crmSectionStudentsList');
  assert.ok(h.indexOf('أحمد عمر') < h.indexOf('سامي'), 'مرتبون أبجديًا');
  assert.doesNotMatch(h, /خالد/);
  assert.match(h, /onclick="openCrmStudentMenu\('a'\)">⋯/);
  assert.equal(shown(app, 'crmStuSectionActions'), 'flex');
  app.openCrmStuSection('__unlinked');
  assert.match(html(app, 'crmSectionStudentsList'), /فهد بلا شعبة/);
  assert.equal(shown(app, 'crmStuSectionActions'), 'none');
  app.openCrmStuSection('S7');
  runInAppContext(app, `crmSections = crmSections.filter(s => s.id !== 'S7');`);
  app.renderCrmStudentsList();
  assert.equal(get(app, 'crmStuView.mode'), 'home');
  assert.equal(shown(app, 'crmStuHome'), 'block');
});

test('قائمة ⋯ — ملف الطالب، والنقل، والحذف (بالاسم مُهرَّبًا)', async () => {
  const app = appWith();
  app.openCrmStudentMenu('a');
  const m = get(app, 'window.__modal[0]');
  assert.match(m, /سامي &lt;b&gt;علي/);
  assert.match(m, /openCrmTransferModal\('a'\)/);
  assert.match(m, /deleteCrmStudent\('a'\)/);
  assert.match(m, /openCrmStudentProfile\('a'/);
});

test('+ طالب — يُضاف لشعبة الصفحة باسم المعلم، ونقرتان = طالب واحد، وبلا شعبة مفتوحة لا يُضاف', async () => {
  const log = [];
  const app = appWith(log, { delay: 20 });
  runInAppContext(app, `document.getElementById('newStudentName').value = ' ماجد حسن '; document.getElementById('newStudentNumber').value = '';`);
  await app.addClassroomStudent();
  assert.equal(log.length, 0, 'شعبي (لا صفحة شعبة)');
  app.openCrmStuSection('S7');
  runInAppContext(app, `document.getElementById('newStudentName').value = ' ماجد حسن ';`);
  await Promise.all([app.addClassroomStudent(), app.addClassroomStudent()]);
  const ins = log.filter(l => l.table === 'classroom_students' && l.op === 'insert');
  assert.equal(ins.length, 1);
  const v = ins[0].values;
  assert.deepEqual([v.teacher_id, v.full_name, v.section_id, v.section_number, v.grade_level, v.academic_year, v.student_number], ['u1', 'ماجد حسن', 'S7', '7', 'ثاني ثانوي', '1448-1449', null]);
  assert.equal(get(app, `document.getElementById('newStudentName').value`), '', 'جاهز للتالي');
});

test('استيراد Excel — للشعبة المفتوحة فقط، وتُثبَّت الشعبة عند اختيار الملف ولو تنقّل المعلم بعدها', async () => {
  const app = appWith();
  runInAppContext(app, `window.__clicked = 0; document.getElementById('crmExcelInput').click = () => window.__clicked++;`);
  app.startCrmImport();
  assert.equal(get(app, 'window.__clicked'), 0);
  assert.match(get(app, 'window.__toasts.join("|")'), /افتح الشعبة التي تستورد إليها/);
  app.openCrmStuSection('S6');
  app.startCrmImport();
  assert.equal(get(app, 'window.__clicked'), 1);
  app.openCrmStuSection('S7');
  assert.equal(get(app, 'crmImportTargetSectionId'), 'S6');
});

test('انحدار: الاستيراد يُدخل الطلاب في الشعبة التي اختير لها الملف، لا التي انتقل إليها المعلم أثناء القراءة', async () => {
  const log = [];
  const app = appWith(log);
  runInAppContext(app, `document.getElementById('crmExcelInput').click = () => {};
    ensureXlsxLib = async () => {}; showConfirm = async () => true;
    XLSX = { read: () => ({ SheetNames: ['a'], Sheets: { a: {} } }), utils: { sheet_to_json: () => [{ 'الاسم': 'طالب مستورد' }] } };`);
  app.openCrmStuSection('S6');
  app.startCrmImport();
  app.openCrmStuSection('S7');
  await app.importStudentsExcel({ target: { files: [{ arrayBuffer: async () => new ArrayBuffer(0) }], value: 'x' } });
  const ins = log.filter(l => l.table === 'classroom_students' && l.op === 'insert');
  assert.equal(ins.length, 1);
  assert.deepEqual([...ins[0].values].map(r => r.full_name + ':' + r.section_id + ':' + r.teacher_id), ['طالب مستورد:S6:u1']);
});

test('⚙ المراحل والشعب — إضافة مرحلة/شعبة بخانة داخل الصفحة باسم المعلم وسنته، والفارغ لا يُحفظ، ونقرتان = واحدة', async () => {
  const log = [];
  const app = appWith(log, { delay: 20 });
  runInAppContext(app, `refreshCrmStructureAndStudents = async () => { window.__refreshed = (window.__refreshed || 0) + 1; };`);
  app.openCrmStructure();
  assert.equal(shown(app, 'crmStuStructure'), 'block');
  let h = html(app, 'crmGradesList');
  assert.match(h, /الشعبة 6<button type="button" aria-label="حذف الشعبة 6" onclick="deleteCrmSection\('S6'\)">✕/);
  assert.match(h, /setCrmStructAdd\(\{ kind: 'section', gradeId: 'g2' \}\)">\+ شعبة/);
  app.setCrmStructAdd({ kind: 'section', gradeId: 'g2' });
  assert.match(html(app, 'crmGradesList'), /id="crmStructAddInput"/);
  runInAppContext(app, `document.getElementById('crmStructAddInput').value = '  ';`);
  await app.saveCrmStructAdd();
  assert.equal(log.length, 0, 'الفارغ لا يُحفظ');
  runInAppContext(app, `document.getElementById('crmStructAddInput').value = ' 8 ';`);
  await Promise.all([app.saveCrmStructAdd(), app.saveCrmStructAdd()]);
  const sec = log.filter(l => l.table === 'classroom_sections' && l.op === 'insert');
  assert.equal(sec.length, 1);
  assert.deepEqual({ ...sec[0].values }, { teacher_id: 'u1', grade_level_id: 'g2', academic_year: '1448-1449', name: '8' });
  assert.equal(get(app, 'crmStructAdd'), null);
  app.setCrmStructAdd({ kind: 'grade' });
  runInAppContext(app, `document.getElementById('crmStructAddInput').value = 'أول متوسط';`);
  await app.saveCrmStructAdd();
  const gr = log.filter(l => l.table === 'classroom_grade_levels' && l.op === 'insert');
  assert.deepEqual({ ...gr[0].values }, { teacher_id: 'u1', academic_year: '1448-1449', name: 'أول متوسط' });
});

test('الجدول الأسبوعي في تبويب "اليوم" لا "الطلاب"، و"ضبط الجدول" يفتحه هناك', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const today = src.slice(src.indexOf('id="crmTabToday"'), src.indexOf('id="crmTabFollowups"'));
  const students = src.slice(src.indexOf('id="crmTabStudents"'), src.indexOf('id="referralLetterView"'));
  assert.match(today, /id="crmTimetableSection"/);
  assert.doesNotMatch(students, /crmTimetable/);
  assert.doesNotMatch(students, /newStudentGradeSelect|crmImportSectionSelect/, 'لا اختيار مرحلة/شعبة — الصفحة تحددها');
  const app = appWith();
  runInAppContext(app, `window.__tabs = []; switchCrmTab = t => window.__tabs.push(t); renderCrmTimetableEditor = () => {};
    document.getElementById('crmTabToday').style.display = 'none';`);
  app.openCrmTimetableEditor();
  assert.deepEqual([...get(app, 'window.__tabs')], ['today']);
  assert.equal(get(app, `document.getElementById('crmTimetableBody').style.display`), 'block');
});
