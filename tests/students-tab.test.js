'use strict';
/* ============================================================
   تبويب الطلاب (إعادة تنظيم بطلب صاحب التطبيق):
   - "شعبي": بحث في كل الطلاب، وبطاقة لكل شعبة بعدد طلابها تحت مرحلتها.
   - صفحة الشعبة: طلابها، و«＋» (طالب/استيراد Excel) و☑ للتحديد والنقل الجماعي؛ والنقل والحذف الفرديان من ملف الطالب.
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
        insert: v => { op = 'insert'; values = v; return api; }, update: v => { op = 'update'; values = v; return api; }, delete: () => { op = 'delete'; return api; },
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
  assert.doesNotMatch(h, /⋯|openCrmStudentMenu/, 'لا زر ⋯ في كل صف');
  assert.match(h, /openCrmStudentProfile\('a'/);
  assert.equal(shown(app, 'crmStuSectionActions'), 'flex');
  assert.equal(get(app, `document.getElementById('crmStuAddBtn').style.display`), '');
  app.openCrmStuSection('__unlinked');
  assert.match(html(app, 'crmSectionStudentsList'), /فهد بلا شعبة/);
  assert.equal(get(app, `document.getElementById('crmStuAddBtn').style.display`), 'none', 'غير المربوطين بلا إضافة');
  assert.equal(get(app, `document.getElementById('crmStuSelectBtn').style.display`), '', 'لكن التحديد للنقل متاح لهم');
  app.openCrmStuSection('S7');
  runInAppContext(app, `crmSections = crmSections.filter(s => s.id !== 'S7');`);
  app.renderCrmStudentsList();
  assert.equal(get(app, 'crmStuView.mode'), 'home');
  assert.equal(shown(app, 'crmStuHome'), 'block');
});

test('قائمة ملف الطالب — النقل والحذف فقط (بالاسم مُهرَّبًا)، ولا قائمة ⋯ في الصفوف', async () => {
  const app = appWith();
  assert.equal(typeof app.openCrmStudentMenu, 'undefined');
  app.openCrmProfileMenu('a');
  const m = get(app, 'window.__modal[0]');
  assert.match(m, /سامي &lt;b&gt;علي/);
  assert.match(m, /openCrmTransferModal\('a'\)/);
  assert.match(m, /deleteCrmStudent\('a'\)/);
  assert.doesNotMatch(m, /openCrmStudentProfile/, 'ملف الطالب مكرر: أنت داخله أصلًا');
});

test('وضع التحديد ☑ — الضغط يحدّد لا يفتح الملف، وتحديد الكل، والزر معطّل بلا تحديد، والخروج من الشعبة يُصفّره', async () => {
  const app = appWith();
  app.openCrmStuSection('S6');
  assert.equal(shown(app, 'crmStuSelectBar'), 'none');
  app.toggleCrmStuSelect();
  assert.equal(shown(app, 'crmStuSelectBar'), 'flex');
  assert.equal(get(app, `document.getElementById('crmStuBulkMoveBtn').disabled`), true);
  let h = html(app, 'crmSectionStudentsList');
  assert.doesNotMatch(h, /openCrmStudentProfile/, 'في وضع التحديد لا يفتح الضغط ملفًا');
  assert.match(h, /crmStuToggleStudent\('a'\)/);
  app.crmStuToggleStudent('a');
  assert.equal(get(app, `document.getElementById('crmStuBulkMoveBtn').disabled`), false);
  assert.match(html(app, 'crmSectionStudentsList'), /aria-pressed="true" onclick="crmStuToggleStudent\('a'\)"/);
  app.crmStuToggleStudent('c'); /* من شعبة أخرى: يُتجاهل */
  assert.equal(get(app, 'crmStuSel.ids.size'), 1);
  app.crmStuSelectAll();
  assert.equal(get(app, 'crmStuSel.ids.size'), 2);
  app.crmStuSelectAll();
  assert.equal(get(app, 'crmStuSel.ids.size'), 0, 'الضغط الثاني يلغي الكل');
  app.crmStuToggleStudent('a');
  app.closeCrmStuSection();
  assert.equal(get(app, 'crmStuSel.on'), false);
  assert.equal(get(app, 'crmStuSel.ids.size'), 0);
  app.openCrmStuSection('S6');
  assert.equal(shown(app, 'crmStuSelectBar'), 'none', 'شعبة جديدة بلا تحديد قديم');
});

test('النقل الجماعي — لكل محدّد نقل مستقل، ومن فشل يبقى محدّدًا، ونقرتان = نقل واحد', async () => {
  const app = appWith(undefined, { delay: 10 });
  runInAppContext(app, `
    window.__moved = []; afterCrmStudentMoved = async () => {};
    moveCrmStudentToSection = async (st, t) => { window.__moved.push(st.id + '>' + t.id); return st.id === 'b' ? { error: { stage: 'student', message: 'x' } } : { gradesRes: { moved: 1, stay: st.id === 'a' ? [{}] : [] }, fErr: null }; };`);
  app.openCrmStuSection('S6');
  app.toggleCrmStuSelect();
  app.crmStuSelectAll();
  app.openCrmBulkTransfer();
  const m = get(app, 'window.__modal[0]');
  assert.match(m, /طالبان/);
  assert.doesNotMatch(m, new RegExp('value="S6"'), 'شعبتهم الحالية ليست هدفًا');
  runInAppContext(app, `document.getElementById('crmBulkTarget').value = 'S7';`);
  await Promise.all([app.transferCrmBulk(), app.transferCrmBulk()]);
  assert.deepEqual([...get(app, 'window.__moved')], ['a>S7', 'b>S7'], 'نقرتان = نقل واحد لكل طالب');
  assert.deepEqual([...get(app, 'crmStuSel.ids')], ['b'], 'من فشل نقله يبقى محدّدًا لإعادة المحاولة');
  assert.equal(get(app, 'crmStuSel.on'), true);
  const toasts = get(app, 'window.__toasts').join(' | ');
  assert.match(toasts, /error:نُقل 1 إلى ثاني ثانوي — الشعبة 7 — تعذّر نقل 1/);
  assert.match(get(app, 'window.__modal[1]'), /لـ 1 من الطلاب درجات لم تُنقل/);
});

test('moveCrmStudentToSection — الدرجات أولًا: فشلها لا ينقل الطالب؛ والنجاح يحدّث الطالب ومتابعاته باسم المعلم', async () => {
  const log = [];
  const app = appWith(log);
  const target = { id: 'S7', gradeName: 'ثاني ثانوي', sectionName: '7' };
  runInAppContext(app, `moveStudentGrades = async () => { throw new Error('boom'); };`);
  const bad = await app.moveCrmStudentToSection({ id: 'a' }, target);
  assert.equal(bad.error.stage, 'grades');
  assert.equal(log.filter(l => l.table === 'classroom_students').length, 0, 'لم يُنقل الطالب');
  runInAppContext(app, `moveStudentGrades = async () => ({ moved: 2, stay: [] });`);
  const ok = await app.moveCrmStudentToSection({ id: 'a' }, target);
  assert.equal(ok.gradesRes.moved, 2);
  const st = log.find(l => l.table === 'classroom_students');
  assert.deepEqual({ ...st.values }, { section_id: 'S7', grade_level: 'ثاني ثانوي', section_number: '7' });
  assert.ok(st.filters.some(f => f[0] === 'teacher_id' && f[1] === 'u1'), 'مقيّد بالمعلم الحالي');
  assert.ok(log.some(l => l.table === 'classroom_followups' && l.filters.some(f => f[0] === 'teacher_id' && f[1] === 'u1')));
});

test('حذف الطالب من داخل ملفه — يُغلق الملف (لا يبقى ملف طالب محذوف مفتوحًا)', async () => {
  const app = appWith();
  runInAppContext(app, `
    window.__closed = 0; closeCrmStudentProfile = () => { window.__closed++; };
    showConfirm = async () => true; showUndoToast = async () => true;
    refreshCrmPendingBadges = async () => {}; refreshAcBadges = async () => {};
    crmProfile = { studentId: 'a', returnTo: { type: 'tab', tab: 'students' }, token: 1 };`);
  await app.deleteCrmStudent('a');
  assert.equal(get(app, 'window.__closed'), 1);
  runInAppContext(app, `window.__closed = 0; crmProfile = { studentId: 'zzz', returnTo: {}, token: 2 };`);
  await app.deleteCrmStudent('b');
  assert.equal(get(app, 'window.__closed'), 0, 'ملف طالب آخر لا يُغلق');
});

test('الأرقام — "الشعبة ٦" المخزّنة تُعرض 6 مع باقي الأعداد، والمخزَّن لا يتغيّر', async () => {
  const app = appWith();
  assert.equal(app.crmDigits('٦'), '6');
  assert.equal(app.crmDigits('۱۲'), '12');
  assert.equal(app.crmDigits('أ'), 'أ');
  runInAppContext(app, `crmSections = [{ id: 'X', name: '٦', grade_level_id: 'g2' }];`);
  assert.equal(app.crmSectionOptionLabel({ id: 'X', name: '٦', grade_level_id: 'g2' }), 'ثاني ثانوي — الشعبة 6');
  app.renderCrmStudentsList();
  assert.match(html(app, 'crmStudentsList'), /<b>الشعبة 6<\/b>/);
  assert.equal(get(app, `crmSections[0].name`), '٦');
});

test('الشعبة المفتوحة من الطلاب هي نفسها في الدرجات؛ وغير المربوطين لا يُحفظون', async () => {
  const app = appWith();
  runInAppContext(app, `window.__ls = {}; localStorage.setItem = (k, v) => { window.__ls[k] = v; };`);
  app.openCrmStuSection('S7');
  assert.equal(get(app, `window.__ls.crm_grades_section`), 'S7');
  app.openCrmStuSection('__unlinked');
  assert.equal(get(app, `window.__ls.crm_grades_section`), 'S7');
});

test('الطلاب — شريط الشعبة الثابت وزر ⚙ في الصفحة الرئيسية، ولا جملة شرح ولا بطاقة إعداد وسط القائمة', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(src, /id="crmStuStructureBtn"[^>]*onclick="openCrmStructure\(\)">⚙/);
  assert.doesNotMatch(src, /اضغط على الطالب لملفه، و⋯/);
  assert.doesNotMatch(src, /class="crm-stu-setup"/);
  assert.match(src, /class="crm-stu-secbar" id="crmStuSecBar"/);
  assert.match(src, /id="betaNoticeBar"[\s\S]*?closeBetaNoticeBar\(\)/, 'الشريط التجريبي قابل للإغلاق');
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
  assert.equal(get(app, `document.getElementById('crmTimetableSection').style.display`), 'block');
  app.toggleCrmTimetable();
  assert.equal(get(app, `document.getElementById('crmTimetableSection').style.display`), 'none', 'مربّع "جدولي" يغلقه أيضًا');
});
