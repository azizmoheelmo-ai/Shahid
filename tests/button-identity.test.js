'use strict';
/* ============================================================
   هوية الأزرار: نبيذي = طباعة/حفظ/تنزيل · حبر = قرار · ورقة مذهّبة = إجراء ثانوي ·
   وردي = حذف · أخضر = واتساب · أزرق = Word
   ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadApp } = require('./load-app');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('style.css');
const html = read('index.html');
const appFiles = fs.readdirSync(path.join(root, 'app')).filter(f => f.endsWith('.js')).map(f => 'app/' + f);
const sources = [['index.html', html]].concat(appFiles.map(f => [f, read(f)]));
const allSrc = sources.map(x => x[1]).join('\n');

/* وسم <button ...> الذي يحمل onclick يستدعي fn */
function buttonTagsFor(fn){
  const re = new RegExp(`<(?:button|label)[^>]*onclick="[^"]*\\b${fn}\\(`, 'g');
  return allSrc.match(re) || [];
}

test('الرموز: النبيذي #5E1A24 والذهب والورق في :root، وكل الأصناف معرَّفة', async () => {
  assert.match(css, /--wine:#5E1A24;/);
  for(const v of ['--wine-2', '--wine-d', '--wine-edge', '--gold-2', '--paper-g1', '--paper-g2', '--paper-line', '--paper-edge']) assert.match(css, new RegExp(v + ':#'), v);
  for(const c of ['.btn-primary', '.btn-outline', '.btn-danger', '.btn-link', '.btn-export', '.btn-wa', '.btn-word', '.xb-card', '.xb-wide', '.xb-pill', '.xb-row', '.xbar', '.bi{', '.btn .chip', '.btn-sm'])
    assert.ok(css.includes(c), c);
  assert.match(css, /\.btn-export\{background:linear-gradient\(145deg,var\(--wine-2\)/);
  assert.match(css, /\.btn-primary\{background:linear-gradient\(180deg,#28465F,var\(--navy\)\);[^}]*var\(--gold\)/, 'الحبر بحافة ذهبية');
  assert.match(css, /\.btn-outline\{background:linear-gradient\(180deg,var\(--paper-g1\),var\(--paper-g2\)\)/, 'الورقة المذهّبة');
});

test('كل أيقونة bi-* مستعملة في الواجهة لها قاعدة CSS (وإلا تظهر فارغة)', async () => {
  const used = new Set((allSrc.match(/\bbi bi-([a-z]+)/g) || []).map(x => x.replace('bi bi-', '')));
  assert.ok(used.size >= 8, 'أيقونات مستعملة: ' + [...used].join(','));
  for(const k of used) assert.match(css, new RegExp(`\\.bi-${k}\\{--i:url\\("data:image/svg\\+xml`), 'bi-' + k);
});

test('مواضع التصدير كلها بنبيذي (أو أخضر لواتساب، أزرق لـWord)', async () => {
  const exportFns = ['printCurrentForm', 'exportAllShawahid', 'exportPortfolio', 'printSelfAssessment', 'printPlan', 'printProgramSummary',
    'printAcLetter', 'printReferralLetter', 'printRecord', 'adminPrintRecord', 'exportCrmStudentReport', 'printCrmStudentReport', 'exportGradeReport', 'exportFullBackup'];
  for(const fn of exportFns){
    const tags = buttonTagsFor(fn);
    assert.ok(tags.length >= 1, fn + ': لا زر');
    for(const t of tags) assert.match(t, /btn-export/, fn + ' ← ' + t.slice(0, 80));
  }
  for(const t of buttonTagsFor('exportCrmGradeAnalysis')) assert.match(t, /btn-export|crm-am-opt|exportCrmGradeAnalysis\('pdf'/);
  const xlsx = allSrc.match(/<button[^>]*exportCrmGradeAnalysis\('xlsx'[^>]*>/);
  assert.match(xlsx[0], /btn-export/, 'تنزيل Excel');
  for(const fn of ['exportCrmGradeSheet']) for(const t of allSrc.match(/exportCrmGradeSheet\('(?:template|sheet)', this\)"`, 'is-export'/g) || []) assert.ok(t);
  assert.equal((allSrc.match(/'is-export'/g) || []).length, 2, 'قالب + تصدير الكشف');
  assert.match(html, /class="home-btn tool export"[^>]*onclick="exportBackup\(event\)"/, 'النسخة الاحتياطية الشخصية');
  for(const fn of ['shareAcLetterWhatsApp', 'shareReferralLetterWhatsApp', 'shareWhatsApp']) for(const t of buttonTagsFor(fn)) assert.match(t, /btn-wa/, fn);
  for(const fn of ['downloadAcLetterWordFile', 'downloadReferralLetterWordFile']) for(const t of buttonTagsFor(fn)) assert.match(t, /btn-word/, fn);
});

test('لا زر تصدير بقي بنمط قديم (إطار/حذف/واتساب أبيض)', async () => {
  assert.doesNotMatch(allSrc, /btn-whatsapp/, 'btn-whatsapp القديم');
  assert.doesNotMatch(allSrc, /btn btn-outline[^>]*>\s*(?:📄|🖨)?\s*(?:طباعة|تنزيل PDF|تصدير)/, 'زر طباعة/تنزيل بإطار');
  assert.doesNotMatch(allSrc, /home-link-btn/, 'رابط نصي لملف الإنجاز');
});

test('«النسخ» أُزيل نهائيًا: لا زر ولا دالة ولا مراجع', async () => {
  assert.doesNotMatch(allSrc, /duplicateRecord/);
  assert.doesNotMatch(read('app/app-09-shahid-form.js'), /<button[^>]*>نسخ<\/button>/);
  const card = read('app/app-09-shahid-form.js');
  const rec = card.slice(card.indexOf('<div class="rec-actions">'), card.indexOf('</div>`;', card.indexOf('<div class="rec-actions">')));
  assert.match(rec, /editRecord/);
  assert.match(rec, /deleteRecord/);
  assert.match(rec, /printRecord/);
  assert.match(rec, /shareWhatsApp/);
  assert.doesNotMatch(rec, /نسخ/);
});

test('نص «جارٍ التجهيز» يُستبدل في .xb-label فقط فتبقى الأيقونة', async () => {
  const app = loadApp();
  const label = { textContent: 'طباعة / حفظ PDF', dataset: {} };
  const icon = { tag: 'i' };
  const btn = { disabled: false, textContent: 'IGNORED', dataset: {}, querySelector: sel => sel === '.xb-label' ? label : null, icon };
  app.beginExportBusy(btn, 'جارٍ التجهيز...');
  assert.equal(btn.disabled, true);
  assert.equal(label.textContent, 'جارٍ التجهيز...');
  assert.equal(btn.textContent, 'IGNORED', 'نص الزر الكامل (وفيه الأيقونة) لم يُلمس');
  app.endExportBusy(btn);
  assert.equal(label.textContent, 'طباعة / حفظ PDF');
  assert.equal(btn.disabled, false);
  /* .hb-sub (بطاقات الرئيسية) يغلب .xb-label */
  const sub = { textContent: 'ملف Excel', dataset: {} };
  const card = { disabled: false, textContent: 'X', dataset: {}, querySelector: sel => sel === '.hb-sub' ? sub : sel === '.xb-label' ? label : null };
  app.beginExportBusy(card, '...');
  assert.equal(sub.textContent, '...');
  app.endExportBusy(card);
});

test('مشاركة الشاهد تستعمل beginExportBusy/endExportBusy (لا استبدال textContent يهدم الأيقونة)', async () => {
  const src = read('app/app-09-shahid-form.js');
  const body = src.slice(src.indexOf('async function shareWhatsApp'), src.indexOf('\n}\n', src.indexOf('async function shareWhatsApp')));
  assert.match(body, /beginExportBusy\(btn/);
  assert.match(body, /endExportBusy\(btn\)/);
  assert.doesNotMatch(body, /btn\.textContent/);
  assert.doesNotMatch(body, /activeExportCount/);
});

test('كل زر تصدير ذو أيقونة يضع النص داخل .xb-label', async () => {
  const withIcon = allSrc.match(/<button[^>]*btn-(?:export|wa|word)[^>]*><i class="bi bi-[a-z]+"><\/i>(?:<span class="xb-label">)?/g) || [];
  assert.ok(withIcon.length >= 15, 'عدد الأزرار ذات الأيقونة: ' + withIcon.length);
  assert.ok(withIcon.every(t => t.endsWith('<span class="xb-label">')), 'زر بلا .xb-label');
});

test('انحدار بصري: زر قائمة البرنامج يحمل خلفيته (قاعدة .pg-menu button كانت تمسحها فيظهر نص أبيض على أبيض)', async () => {
  const rule = css.match(/\.pg-menu button\.btn-export\{[^}]*\}/);
  assert.ok(rule, 'قاعدة .pg-menu button.btn-export');
  assert.match(rule[0], /background:linear-gradient\(145deg,var\(--wine-2\)/);
  assert.match(rule[0], /color:#fff/);
});

test('صف نموذج الشاهد: التصدير ثم «حفظ الشاهد» بعرض كامل ثم الثانوي ثم رابط الإلغاء', async () => {
  const i = html.indexOf('<div class="action-row">\n      <button class="btn btn-export');
  assert.ok(i > 0);
  const row = html.slice(i, html.indexOf('</div>', i));
  const order = ['printCurrentForm', 'id="saveBtn"', 'id="planBtn"', 'id="cancelEditBtn"', 'cancelForm()'].map(k => row.indexOf(k));
  assert.ok(order.every((x, n) => x > 0 && (n === 0 || x > order[n - 1])), 'الترتيب: ' + order);
  assert.match(row, /class="btn btn-primary xb-wide" id="saveBtn"/);
  assert.match(row, /class="btn btn-link" onclick="cancelForm\(\)"/);
});

test('الهوية موثّقة في CLAUDE.md للالتزام بها لاحقًا', async () => {
  const md = read('CLAUDE.md');
  assert.match(md, /هوية الأزرار/);
  for(const k of ['btn-export', 'btn-primary', 'btn-outline', 'btn-danger', 'btn-wa', 'btn-word', '#5E1A24']) assert.ok(md.includes(k), k);
});

test('الإصدارات متطابقة', async () => {
  const v = JSON.parse(read('version.json'));
  assert.match(read('sw.js'), new RegExp(`APP_VERSION_SW = '${v.version}'`));
  assert.match(read('app/app-26-update-check.js'), new RegExp(`APP_VERSION = '${v.version}'`));
  assert.ok(v.notes.length >= 1);
});
