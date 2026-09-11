'use strict';
/* فحص سريع لصحة صياغة JavaScript بالمشروع — يفحص كل سكربت يُحمَّله index.html
   فعليًا (سواء <script> داخلي أو ملف <script src="..."> محلي، بنفس ترتيب
   ورودها)، بالإضافة إلى sw.js، ويتأكد أن كل واحد منها يُفسَّر بلا أخطاء
   صياغية دون تنفيذه. يُستخدم يدويًا (npm run check) وتلقائيًا ضمن CI. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const htmlPath = path.join(rootDir, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const matches = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
let hadError = false;
let checked = 0;

function check(label, code) {
  checked++;
  try {
    new vm.Script(code, { filename: label }); // Compile فقط، بدون تنفيذ
    console.log(`✓ ${label}: صياغة سليمة (${code.length.toLocaleString('en-US')} حرف)`);
  } catch (err) {
    hadError = true;
    console.error(`✗ ${label}: خطأ صياغة\n${err.message}`);
  }
}

for (const [, attrsStr, body] of matches) {
  const srcMatch = attrsStr.match(/\bsrc=["']([^"']+)["']/);
  if (!srcMatch) {
    if (body.trim()) check('index.html inline <script>', body);
    continue;
  }
  const src = srcMatch[1];
  if (/^https?:\/\//.test(src)) continue; // مكتبة خارجية (CDN) — ليست من مسؤوليتنا
  const filePath = path.join(rootDir, src);
  if (!fs.existsSync(filePath)) {
    hadError = true;
    console.error(`✗ ${src}: الملف مُشار إليه بـ index.html لكنه غير موجود`);
    continue;
  }
  check(src, fs.readFileSync(filePath, 'utf-8'));
}

if (!checked) {
  console.error('✗ لم يُعثر على أي كود JavaScript محلي (لا <script> داخلي ولا ملفات src) بملف index.html');
  process.exit(1);
}

// sw.js ملف مستقل غير مُحمَّل عبر <script> بـ index.html (يُسجَّل ببرمجية)
const swPath = path.join(rootDir, 'sw.js');
if (fs.existsSync(swPath)) {
  check('sw.js', fs.readFileSync(swPath, 'utf-8'));
}

if (hadError) {
  process.exit(1);
} else {
  console.log(`كل السكربتات (${checked}) سليمة الصياغة ✅`);
}
