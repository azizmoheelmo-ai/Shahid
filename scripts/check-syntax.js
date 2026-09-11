'use strict';
/* فحص سريع لصحة صياغة JavaScript داخل index.html — يستخرج وسم <script>
   الداخلي (بدون src) ويتأكد أنه يُفسَّر بلا أخطاء صياغية، دون تنفيذه.
   يُستخدم يدويًا (npm run check) وتلقائيًا ضمن GitHub Actions CI. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const matches = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const inline = matches.filter(([, attrs]) => !attrs || !/\bsrc=/.test(attrs));

if (!inline.length) {
  console.error('✗ لم يُعثر على أي <script> داخلي بملف index.html');
  process.exit(1);
}

let hadError = false;
inline.forEach(([, , body], i) => {
  try {
    // بناء الكائن فقط (Compile) بدون تنفيذه — يكفي لاكتشاف أخطاء الصياغة
    new vm.Script(body, { filename: `index.html inline <script> #${i + 1}` });
    console.log(`✓ <script> #${i + 1}: صياغة سليمة (${body.length.toLocaleString('en-US')} حرف)`);
  } catch (err) {
    hadError = true;
    console.error(`✗ <script> #${i + 1}: خطأ صياغة\n${err.message}`);
  }
});

// sw.js ملف JS مستقل — نتأكد من صحته أيضًا بنفس الطريقة (تحويل بدون تنفيذ)
const swPath = path.join(__dirname, '..', 'sw.js');
if (fs.existsSync(swPath)) {
  try {
    new vm.Script(fs.readFileSync(swPath, 'utf-8'), { filename: 'sw.js' });
    console.log('✓ sw.js: صياغة سليمة');
  } catch (err) {
    hadError = true;
    console.error(`✗ sw.js: خطأ صياغة\n${err.message}`);
  }
}

if (hadError) {
  process.exit(1);
} else {
  console.log('كل السكربتات سليمة الصياغة ✅');
}
