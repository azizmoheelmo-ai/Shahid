'use strict';
/* ============================================================
   الأدوات (app-45): مكان قليل الاستعمال بقائمة الحساب، وفيه قائمة الاستبانات وإنشاؤها وترتيبها:
   - الدخول من قائمة الحساب فقط (لا بلاطة بالرئيسية ولا تبويب سفلي) والشاشة مسجَّلة بكل سجلات الشاشات الرئيسية.
   - التصنيف بالجهة، وترتيب المعلم داخل كل تصنيف يُحفظ بحسابه وحده، ويتراجع عند الفشل.
   - الإنشاء: عنوان وجهة وشعب ولقطة أسئلة من القالب الجاهز، وتراجع نظيف عند الفشل، وبلا تكرار عند النقر المزدوج.
   - كل استعلام بتصفية المعلم، والسباق: مغادرة الشاشة أثناء الإنشاء لا تفتح نافذة فجأة.
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { makeApp, runInAppContext, FUTURE, J } = require('./survey-kit');
const { SURVEY_READY_TEMPLATES } = require('../survey-templates.js');
const root = path.join(__dirname, '..');

const GQ = J(SURVEY_READY_TEMPLATES.guardian_v1.questions);
const camp = (id, audience, order, extra) => Object.assign({ id, teacher_id: 'u1', title: 'استبانة ' + id, audience, template: audience === 'student' ? 'student_v1' : 'guardian_v1', questions: J(GQ), status: 'open', closes_at: FUTURE(), sort_order: order, min_results: 5, created_at: '2026-11-0' + (order % 9 + 1) }, extra || {});
const STUDENTS = [
  { id: 'a', full_name: 'أحمد', section_id: 'sec1', is_active: true, guardian_phone: '966501234567', student_phone: '966551234567' },
  { id: 'b', full_name: 'بدر', section_id: 'sec1', is_active: true, guardian_phone: null, student_phone: '966551111111' },
  { id: 'e', full_name: 'عمر', section_id: 'sec2', is_active: true, guardian_phone: '966503333333', student_phone: null }
];

/* ============ دوال صرفة ============ */

test('التصنيف: أولياء الأمور ثم الطلاب ثم المخصّصة، وداخل كل تصنيف حسب الترتيب ثم الأحدث', () => {
  const { app } = makeApp();
  const list = [camp('s1', 'student', 0), camp('g2', 'guardian', 5), camp('g1', 'guardian', 1), camp('c1', 'custom', 0), camp('g3', 'guardian', 1, { created_at: '2026-11-09' })];
  const groups = J(app.toolsGroupCampaigns(list));
  assert.deepEqual(groups.map(g => g.key), ['guardian', 'student', 'custom']);
  assert.deepEqual(groups[0].items.map(c => c.id), ['g3', 'g1', 'g2'], 'نفس الترتيب: الأحدث أولًا');
});

test('التحريك: خطوة داخل التصنيف فقط، والحافة لا تتحرك، وتصنيف آخر لا يتأثر', () => {
  const { app } = makeApp();
  const list = [camp('g1', 'guardian', 0), camp('g2', 'guardian', 1), camp('s1', 'student', 2)];
  assert.deepEqual(J(app.toolsMoveInOrder(list, 'g1', 1)), ['g2', 'g1', 's1']);
  assert.equal(app.toolsMoveInOrder(list, 'g1', -1), null, 'الأول لا يصعد');
  assert.equal(app.toolsMoveInOrder(list, 'g2', 1), null, 'آخر التصنيف لا ينزل إلى تصنيف آخر');
  assert.equal(app.toolsMoveInOrder(list, 'nope', 1), null);
});

test('الروابط المتوقعة: طلاب نشطون بالشعب المختارة لهم رقم الجهة فقط', () => {
  const { app } = makeApp();
  const st = STUDENTS.concat([{ id: 'x', full_name: 'خارج', section_id: 'sec1', is_active: false, guardian_phone: '966500000000', student_phone: null }]);
  assert.equal(app.toolsExpectedLinks(st, ['sec1', 'sec2'], 'guardian'), 2);
  assert.equal(app.toolsExpectedLinks(st, ['sec1'], 'guardian'), 1);
  assert.equal(app.toolsExpectedLinks(st, ['sec1', 'sec2'], 'student'), 2);
  assert.equal(app.toolsExpectedLinks(st, [], 'guardian'), 0);
});

test('العنوان الافتراضي من القالب الجاهز بحسب الجهة', () => {
  const { app } = makeApp();
  assert.equal(app.toolsDefaultTitle('guardian'), SURVEY_READY_TEMPLATES.guardian_v1.title);
  assert.equal(app.toolsDefaultTitle('student'), SURVEY_READY_TEMPLATES.student_v1.title);
});

/* ============ الدخول والتسجيل ============ */

test('showTools: تُخفي بقية الشاشات الرئيسية وتُظهر حاويتها صراحةً، ولا تُفعّل تبويبًا سفليًا', async () => {
  const { app } = makeApp();
  runInAppContext(app, `window.__calls = []; const h = hideAllMainViews; hideAllMainViews = () => { window.__calls.push('hide'); h(); }; setActiveBottomTab = t => window.__calls.push('tab:' + t);`);
  runInAppContext(app, `showTools()`);
  assert.deepEqual(J(runInAppContext(app, 'window.__calls')), ['hide', 'tab:null']);
  assert.equal(app.__els.toolsView.style.display, 'block');
  assert.equal(app.__els.toolsTitle.textContent, 'الأدوات');
  assert.match(app.__els.toolsBody.innerHTML, /الاستبانات/);
});

test('التسجيل: toolsView بكل سجلات الشاشات الرئيسية، وخيار «الأدوات» بقائمة الحساب فقط، بلا بلاطة رئيسية ولا تبويب سفلي ولا ★ بالشعبة', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const a03 = fs.readFileSync(path.join(root, 'app/app-03-auth-home-risk.js'), 'utf8');
  const a04 = fs.readFileSync(path.join(root, 'app/app-04-academic-crm.js'), 'utf8');
  assert.match(a04, /getElementById\('toolsView'\)\.style\.display = 'none'/, 'hideAllMainViews');
  assert.match(a03, /TOP_TITLE_VIEWS = \[[^\]]*'toolsView'/, 'عنوان الشريط العلوي');
  assert.match(a03, /alreadyNavigatedAway = \[[^\]]*'toolsView'/, 'سباق الإقلاع');
  assert.match(html, /id="toolsView"[\s\S]*?id="toolsBody"/);
  const menu = html.slice(html.indexOf('id="acctMenu"'), html.indexOf('id="bottomTabBar"'));
  assert.match(menu, /id="toolsNavBtn"[^>]*showTools\(\)/);
  const home = html.slice(html.indexOf('id="homeView"'), html.indexOf('id="toolsView"'));
  assert.doesNotMatch(home, /showTools|toolsNavBtn|>[^<]*🧰/, 'لا بلاطة بالرئيسية');
  const tabbar = html.slice(html.indexOf('id="bottomTabBar"'), html.indexOf('id="homeView"'));
  assert.doesNotMatch(tabbar, /showTools|toolsNavBtn|🧰/, 'لا تبويب سفلي');
  assert.doesNotMatch(html, /crmStuSurveyBtn/, 'لا ★ بصفحة الشعبة');
  assert.doesNotMatch(a04, /crmStuSurveyBtn/);
});

/* ============ القائمة ============ */

const loadList = async (opts) => {
  const k = makeApp(opts);
  runInAppContext(k.app, `showTools('surveys')`);
  await runInAppContext(k.app, `toolsLoadList()`);
  return k;
};

test('القائمة: بالتصفية، والأعداد (شعب وردود)، والتصنيف، والترتيب الحاضر', async () => {
  const campaigns = [camp('g1', 'guardian', 0), camp('s1', 'student', 1, { status: 'closed' })];
  const sections = [{ teacher_id: 'u1', campaign_id: 'g1', section_id: 'sec1' }, { teacher_id: 'u1', campaign_id: 'g1', section_id: 'sec2' }, { teacher_id: 'u1', campaign_id: 's1', section_id: 'sec1' }];
  const invites = [
    { id: 'i1', teacher_id: 'u1', campaign_id: 'g1', answered_on: '2026-11-01' }, { id: 'i2', teacher_id: 'u1', campaign_id: 'g1', answered_on: null }, { id: 'i3', teacher_id: 'u1', campaign_id: 'g1', answered_on: null }
  ];
  const { app, log } = await loadList({ students: STUDENTS, campaigns, sections, invites });
  log.forEach(l => assert.equal(l.f.teacher_id, 'u1', l.table + ' بلا تصفية المعلم'));
  const html = app.__els.toolsBody.innerHTML;
  assert.match(html, /لأولياء الأمور[\s\S]*للطلاب/, 'التصنيف بالترتيب');
  assert.match(html, /شعبتان · ردّ 1 من 3/);
  assert.match(html, /شعبة واحدة · لم يُرسل بعد/);
  assert.match(html, /مفتوحة/);
  assert.match(html, /مغلقة/);
  assert.match(html, /openSurvey\('g1'\)/);
  assert.equal(app.__els.toolsTitle.textContent, 'الاستبانات');
});

test('القائمة الفارغة: دعوة صريحة لإنشاء أول استبانة، ولا ترتيب لواحدة', async () => {
  const { app } = await loadList({ students: STUDENTS });
  const html = app.__els.toolsBody.innerHTML;
  assert.match(html, /لا توجد استبانات بعد/);
  assert.match(html, /toolsGo\('create'\)/);
  assert.doesNotMatch(html, /toolsToggleSort/);
});

test('التبويبات: «مخصّصة» لا تظهر إلا إن وُجدت، والتصفية تُخفي التصنيفات الأخرى', async () => {
  const a = await loadList({ students: STUDENTS, campaigns: [camp('g1', 'guardian', 0), camp('s1', 'student', 1)] });
  assert.doesNotMatch(a.app.__els.toolsBody.innerHTML, /مخصّصة/);
  runInAppContext(a.app, `toolsSetFilter('student')`);
  const html = a.app.__els.toolsBody.innerHTML;
  assert.match(html, /للطلاب/);
  assert.doesNotMatch(html, /لأولياء الأمور<span/);
  const b = await loadList({ students: STUDENTS, campaigns: [camp('c1', 'custom', 0)] });
  assert.match(b.app.__els.toolsBody.innerHTML, /مخصّصة/);
});

test('عنوان الاستبانة يمرّ بـescapeHtml', async () => {
  const { app } = await loadList({ students: STUDENTS, campaigns: [camp('g1', 'guardian', 0, { title: '<img src=x onerror=alert(1)>' })] });
  assert.ok(!app.__els.toolsBody.innerHTML.includes('<img'));
  assert.match(app.__els.toolsBody.innerHTML, /&lt;img/);
});

/* ============ الترتيب ============ */

test('الترتيب: يحفظ الصفوف المتغيّرة فقط بتصفية المعلم، وتراجع نظيف عند الفشل، ولا نقرة مزدوجة', async () => {
  const campaigns = [camp('g1', 'guardian', 0), camp('g2', 'guardian', 1), camp('g3', 'guardian', 2)];
  const { app, log, db } = await loadList({ students: STUDENTS, campaigns });
  runInAppContext(app, `toolsToggleSort()`);
  log.length = 0;
  await runInAppContext(app, `Promise.all([toolsMove('g1', 1), toolsMove('g1', 1)])`);
  const ups = log.filter(l => l.table === 'survey_campaigns' && l.op === 'update');
  assert.equal(ups.length, 2, 'g1 وg2 فقط، ومرة واحدة (النقرة الثانية مرفوضة)');
  ups.forEach(u => assert.equal(u.f.teacher_id, 'u1'));
  assert.deepEqual(db.survey_campaigns.map(c => c.id + ':' + c.sort_order).sort(), ['g1:1', 'g2:0', 'g3:2']);

  /* فشل الحفظ يُرجع الترتيب كما كان */
  const failing = makeApp({ students: STUDENTS, campaigns: [camp('g1', 'guardian', 0), camp('g2', 'guardian', 1)], fail: (t, op) => (t === 'survey_campaigns' && op === 'update') ? { message: 'down' } : null });
  runInAppContext(failing.app, `showTools('surveys')`);
  await runInAppContext(failing.app, `toolsLoadList()`);
  runInAppContext(failing.app, `toolsToggleSort()`);
  await runInAppContext(failing.app, `toolsMove('g1', 1)`);
  assert.deepEqual(J(runInAppContext(failing.app, 'toolsState.list.campaigns.map(c => c.id + ":" + c.sort_order)')), ['g1:0', 'g2:1']);
  assert.ok(failing.app.__toasts.some(t => /تعذّر حفظ الترتيب/.test(t)));
});


test('السحب والإفلات: موضع الإفلات، حفظ الصفوف المتغيّرة بتصفية المعلم، وإلغاء/سباق لا يحفظان', async () => {
  const { app } = makeApp();
  assert.equal(app.toolsDropIndex([10, 30, 50], 5), 0);
  assert.equal(app.toolsDropIndex([10, 30, 50], 40), 2);
  assert.equal(app.toolsDropIndex([10, 30, 50], 99), 3);
  const cs = [camp('g1', 'guardian', 0), camp('g2', 'guardian', 1), camp('g3', 'guardian', 2), camp('s1', 'student', 3)];
  assert.deepEqual(J(app.toolsReorderInOrder(cs, 'g1', 2)), ['g2', 'g3', 'g1', 's1']);
  assert.deepEqual(J(app.toolsReorderInOrder(cs, 'g3', 0)), ['g3', 'g1', 'g2', 's1']);
  assert.equal(app.toolsReorderInOrder(cs, 'g1', 0), null, 'نفس الموضع');
  assert.deepEqual(J(app.toolsReorderInOrder(cs, 'g1', 99)), ['g2', 'g3', 'g1', 's1'], 'يُقصّ داخل التصنيف ولا يعبر إلى غيره');

  const setup = async () => {
    const m = await loadList({ students: STUDENTS, campaigns: [camp('g1', 'guardian', 0), camp('g2', 'guardian', 1), camp('g3', 'guardian', 2)] });
    runInAppContext(m.app, `toolsToggleSort()`);
    runInAppContext(m.app, `
      const mkTile = (mid) => ({ classList: { add(){}, remove(){} }, style: {}, getBoundingClientRect: () => ({ top: mid - 10, height: 20 }) });
      window.__tiles = [mkTile(100), mkTile(200), mkTile(300)];
      const parent = { querySelectorAll: () => window.__tiles };
      window.__tiles.forEach(t => { t.parentNode = parent; });
      window.__grip = (i) => ({ closest: () => window.__tiles[i], setPointerCapture(){} });
      window.__start = (i, y) => { const g = window.__grip(i); g.pointerId = 1; g.clientY = y; const ev = { currentTarget: window.__tiles[i].gripEl = Object.assign(g, { closest: () => window.__tiles[i] }), pointerId: 1, clientY: y, preventDefault(){} }; toolsDragStart(ev, ['g1','g2','g3'][i]); return g; };`);
    return m;
  };
  /* إفلات g1 تحت g2: يصير الترتيب g2,g1,g3 */
  const a = await setup(); a.log.length = 0;
  const g = runInAppContext(a.app, `window.__start(0, 100)`);
  await runInAppContext(a.app, `toolsDragEnd({ clientY: 250 }, true)`);
  const ups = a.log.filter(l => l.table === 'survey_campaigns' && l.op === 'update');
  assert.equal(ups.length, 2); ups.forEach(u => assert.equal(u.f.teacher_id, 'u1'));
  assert.deepEqual(a.db.survey_campaigns.map(c => c.id + ':' + c.sort_order).sort(), ['g1:1', 'g2:0', 'g3:2']);
  /* إلغاء: لا حفظ */
  const b = await setup(); b.log.length = 0;
  runInAppContext(b.app, `window.__start(0, 100)`);
  await runInAppContext(b.app, `toolsDragEnd({ clientY: 350 }, false)`);
  assert.equal(b.log.filter(l => l.op === 'update').length, 0);
  assert.equal(runInAppContext(b.app, `toolsDrag`), null);
  /* سباق: غادر المعلم الشاشة قبل الإفلات */
  const c = await setup(); c.log.length = 0;
  runInAppContext(c.app, `window.__start(0, 100)`);
  runInAppContext(c.app, `toolsState.token++`);
  await runInAppContext(c.app, `toolsDragEnd({ clientY: 350 }, true)`);
  assert.equal(c.log.filter(l => l.op === 'update').length, 0);
  /* مقبض ثانٍ أثناء سحب قائم لا يبدأ */
  const d = await setup();
  runInAppContext(d.app, `window.__start(0, 100)`);
  const first = runInAppContext(d.app, `toolsDrag.id`);
  runInAppContext(d.app, `window.__start(1, 200)`);
  assert.equal(runInAppContext(d.app, `toolsDrag.id`), first);
});

/* ============ الإنشاء ============ */

const startCreate = async (opts) => {
  const k = makeApp(opts);
  runInAppContext(k.app, `showTools(); window.__opened = []; openSurvey = id => window.__opened.push(id);`);
  await runInAppContext(k.app, `toolsGo('create'); (async () => { for(let i = 0; i < 8; i++) await null; })()`);
  return k;
};

test('الإنشاء: الافتراضي ولي الأمر وكل الشعب وعنوان القالب و14 يومًا، وعدد الروابط من الأرقام', async () => {
  const { app } = await startCreate({ students: STUDENTS });
  const html = app.__els.toolsBody.innerHTML;
  assert.match(html, new RegExp(SURVEY_READY_TEMPLATES.guardian_v1.title));
  assert.match(html, /2 روابط لأولياء الأمور بالشعب المختارة/);
  assert.match(html, /30 يومًا/);
  assert.equal(runInAppContext(app, 'toolsState.create.days'), 14);
  assert.equal(runInAppContext(app, 'toolsState.create.sectionIds.size'), 2, 'كل شعبي');
  assert.equal(app.__els.toolsTitle.textContent, 'استبانة جديدة');
});

test('الإنشاء: تغيير الجهة يغيّر العنوان الافتراضي ما لم يعدّله المعلم بنفسه', async () => {
  const a = await startCreate({ students: STUDENTS });
  runInAppContext(a.app, `toolsPickAudience('student')`);
  assert.equal(runInAppContext(a.app, 'toolsState.create.title'), SURVEY_READY_TEMPLATES.student_v1.title);
  const b = await startCreate({ students: STUDENTS });
  runInAppContext(b.app, `toolsSetTitleText('عنواني'); toolsPickAudience('student')`);
  assert.equal(runInAppContext(b.app, 'toolsState.create.title'), 'عنواني');
});

test('الإنشاء: يُدرج الاستبانة بلقطة الأسئلة الجاهزة (نسخة عميقة) والجهة والمدة وكل الشعب، بتصفية المعلم، ثم يفتحها', async () => {
  const { app, log, db } = await startCreate({ students: STUDENTS });
  runInAppContext(app, `toolsSetTitleText('رضا الفصل الأول'); toolsPickDays(30)`);
  await runInAppContext(app, `toolsCreate()`);
  const c = db.survey_campaigns[0];
  assert.equal(c.teacher_id, 'u1');
  assert.equal(c.title, 'رضا الفصل الأول');
  assert.equal(c.audience, 'guardian');
  assert.equal(c.template, 'guardian_v1');
  assert.deepEqual(J(c.questions), GQ);
  assert.notEqual(c.questions, SURVEY_READY_TEMPLATES.guardian_v1.questions, 'لقطة لا مرجع مشترك مع القالب');
  const days = (new Date(c.closes_at).getTime() - Date.now()) / 864e5;
  assert.ok(days > 29 && days < 30.1);
  assert.ok(c.sort_order < 0, 'الأحدث يتصدّر');
  assert.deepEqual(db.survey_campaign_sections.map(s => s.section_id).sort(), ['sec1', 'sec2']);
  db.survey_campaign_sections.forEach(s => { assert.equal(s.teacher_id, 'u1'); assert.equal(s.campaign_id, c.id); });
  assert.deepEqual(J(runInAppContext(app, 'window.__opened')), [c.id]);
  log.filter(l => l.op !== 'insert').forEach(l => assert.equal(l.f.teacher_id, 'u1'));
});

test('الإنشاء: نقرتان متزامنتان تُنشئان استبانة واحدة', async () => {
  const { app, db } = await startCreate({ students: STUDENTS });
  await runInAppContext(app, `Promise.all([toolsCreate(), toolsCreate()])`);
  assert.equal(db.survey_campaigns.length, 1);
});

test('الإنشاء: فشل إدراج الشعب يحذف الاستبانة (لا يتيمة) ويُعلن الخطأ ولا يفتح شيئًا', async () => {
  const { app, db } = await startCreate({ students: STUDENTS, fail: (t, op) => (t === 'survey_campaign_sections' && op === 'insert') ? { message: 'boom' } : null });
  await runInAppContext(app, `toolsCreate()`);
  assert.equal(db.survey_campaigns.length, 0);
  assert.ok(app.__toasts.some(t => /boom/.test(t)));
  assert.equal(runInAppContext(app, 'window.__opened.length'), 0);
});

test('الإنشاء: بلا شعب مختارة لا يُنشئ شيئًا', async () => {
  const { app, db } = await startCreate({ students: STUDENTS });
  runInAppContext(app, `toolsToggleAllSections()`);
  await runInAppContext(app, `toolsCreate()`);
  assert.equal(db.survey_campaigns.length, 0);
  assert.match(app.__els.toolsBody.innerHTML, /id="toolsCreateBtn"[^>]*disabled/);
});

test('السباق: مغادرة الشاشة أثناء الإنشاء لا تفتح نافذة فجأة', async () => {
  const { app, db } = await startCreate({ students: STUDENTS });
  await runInAppContext(app, `(async () => { const p = toolsCreate(); toolsGo('home'); await p; })()`);
  assert.equal(db.survey_campaigns.length, 1, 'تُنشأ وتظهر بالقائمة');
  assert.equal(runInAppContext(app, 'window.__opened.length'), 0);
});

test('بلا شعب بالحساب: رسالة صريحة بدل نموذج بلا فائدة', async () => {
  const { app } = await startCreate({ students: [], sectionsData: [] });
  assert.match(app.__els.toolsBody.innerHTML, /لا شعب بعد/);
});

test('عنوان الاستبانة يُقصّ بحدّ القالب المشترك (80)', async () => {
  const { app } = await startCreate({ students: STUDENTS });
  runInAppContext(app, `toolsSetTitleText('أ'.repeat(200))`);
  assert.equal(runInAppContext(app, 'toolsState.create.title.length'), 80);
});
