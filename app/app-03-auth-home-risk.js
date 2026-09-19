/* ============ تبديل تبويبات تسجيل الدخول/حساب جديد ============ */
let authMode = 'login';
function switchAuthTab(mode){
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('signupNameField').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('signupStudentActivityField').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('authSubmitBtn').textContent = mode === 'signup' ? 'إنشاء حساب' : 'دخول';
  document.getElementById('forgotWrap').style.display = mode === 'signup' ? 'none' : 'block';
  document.getElementById('termsWrap').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('pwHint').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('authPassword2Wrap').style.display = mode === 'signup' ? 'block' : 'none';
  hideAuthMsg();
}

/* ============ شروط الاستخدام وسياسة الخصوصية ============ */
function showBetaInfoModal(){
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">🧪 هذه نسخة تجريبية</h3>
      <p style="font-size:12.5px;line-height:1.95;margin:0 0 10px;">
        التطبيق بكل أقسامه — <b>بما في ذلك المواد والنصوص النظامية المرجعية، حسابات الدرجات والتصعيد، وصياغة الخطابات</b> — لا يزال قيد التجربة والتطوير المستمر.
      </p>
      <p style="font-size:12.5px;line-height:1.95;margin:0 0 10px;">
        قد تحدث أخطاء في العرض، الحسابات، أو صياغة المحتوى النظامي، وقد تتغيّر الميزات أو تُصحَّح لاحقًا دون إشعار مسبق.
      </p>
      <div style="background:#F7F5F0;border:1px solid var(--line);padding:10px 12px;font-size:11.5px;color:var(--muted);line-height:1.85;">
        لأي إجراء نظامي أو إداري رسمي (خطاب، حسم درجة، إحالة)، راجع دائمًا النص الأصلي في الدليل الرسمي، ولا تعتمد على التطبيق كمصدر وحيد أو نهائي.
      </div>
    </div>
  `, '400px');
}

function showAcademicInfoModal(){
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 10px;font-size:15px;color:var(--navy);">الأساس النظامي لهذه الوحدة</h3>
      <p style="font-size:12px;color:var(--muted);margin:0 0 10px;line-height:1.9;">
        دليل إجراءات عمل مدارس التعليم العام (الإصدار الرابع، 1446هـ) — مجموعة إدارة العملية التعليمية.
      </p>

      <p style="font-weight:700;color:var(--navy);margin:12px 0 4px;">الإجراء (1.9.1): تحديد الطالب الذين يعانون من ضعف أكاديمي</p>
      <p style="font-size:12.5px;line-height:1.9;margin:0 0 10px;">
        الخطوة الأولى هي دراسة حاجة الطالب لخطوات تصحيحية، بالرجوع إلى المعلم الخبير للمادة عند اللزوم — تشخيص أولًا، لا إحالة فورية.
      </p>

      <p style="font-weight:700;color:var(--navy);margin:12px 0 4px;">الإجراء (1.9.2): متابعة حالات تأخر التحصيل الدراسي</p>
      <p style="font-size:12.5px;line-height:1.9;margin:0 0 10px;">
        بعد التشخيص، يُصنَّف الطالب حسب المهارات غير المتقنة، وتُحدَّد له حصص علاجية (فردية أو جماعية) عبر "نموذج خطة علاجية". <b>تُراجَع الخطة من لجنة التوجيه الطلابي، وتُعتمَد من الوكيل للشؤون التعليمية</b> قبل التنفيذ.
      </p>
      <p style="font-size:12.5px;line-height:1.9;margin:0 0 10px;">
        بعد التنفيذ: إن لم يتقن الطالب مهارة أو أكثر من مهارات الحد الأدنى، يُحيله <b>المعلم</b> للموجه الطلابي (نموذج "إحالة الطالب"). أما تحويل من لم يتجاوب مع البرامج العلاجية إلى "البرامج المساندة" بعد إشعار ولي الأمر، فهو مسؤولية <b>الموجه الطلابي</b> لا المعلم.
      </p>

      <div style="background:#F7F5F0;border:1px solid var(--line);padding:10px 12px;font-size:11.5px;color:var(--muted);line-height:1.85;margin-top:8px;">
        <b>ما تديره هذه الوحدة فعليًا:</b> توثيق التشخيص والخطة (مع نوعها فردي/جماعي)، تسجيل تاريخ اعتماد اللجنة إن حصلت عليه خارج التطبيق، ثم إصدار خطاب الإحالة للموجه بعد ثبوت عدم إتقان المهارة. مراجعة/اعتماد اللجنة نفسها إجراء يتم خارج التطبيق — هذا الحقل للتوثيق فقط.
      </div>
    </div>
  `, '440px');
}

function showTermsModal(){
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 4px;font-size:15px;color:var(--navy);">شروط الاستخدام وسياسة الخصوصية</h3>
      <p style="font-size:11px;color:var(--muted);margin:0 0 14px;">نظام "شاهد الأداء الوظيفي" — أداة شخصية لتوثيق شواهد الأداء</p>

      <div style="font-size:12.5px;line-height:1.95;color:#413D33;">

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">1. طبيعة النظام</p>
        <p style="margin:0 0 12px;">هذا النظام أداة مساعدة شخصية لتنظيم وتوثيق شواهد الأداء الوظيفي، وليس نظامًا رسميًا معتمدًا من وزارة التعليم، ولا يُغني عن نظام فارس أو أي نظام رسمي معتمد. البيانات المدخلة فيه لا تُرحّل تلقائيًا لأي جهة رسمية.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">2. مسؤولية المحتوى</p>
        <p style="margin:0 0 12px;">أنت المسؤول الكامل عن دقة وصحة ما تُدخله من بيانات وشواهد وصور. يُمنع رفع أي محتوى مخالف للأنظمة أو الآداب العامة، أو ينتهك خصوصية الآخرين، أو لا تملك حق استخدامه.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">3. صور الطلاب والخصوصية</p>
        <p style="margin:0 0 12px;">عند رفع صور تتضمن طلابًا، أنت مسؤول عن الالتزام بأنظمة حماية خصوصية الطلاب والحصول على الموافقات اللازمة وفق تعليمات وزارة التعليم. يُنصح بتجنّب الصور التي تُظهر وجوه الطلاب بوضوح.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">4. حماية الحساب</p>
        <p style="margin:0 0 12px;">أنت مسؤول عن سرية بيانات دخولك وعدم مشاركتها مع أحد. أي نشاط يتم عبر حسابك يُعد صادرًا منك.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">5. خصوصية بياناتك</p>
        <p style="margin:0 0 6px;">بياناتك محفوظة في قاعدة بيانات محمية، ولا يمكن لأي معلم آخر الاطلاع عليها. يطّلع عليها فقط:</p>
        <ul style="margin:0 0 12px;padding-right:18px;">
          <li>أنت (صاحب الحساب)</li>
          <li>مسؤول النظام (لأغراض المتابعة الإشرافية)</li>
        </ul>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">6. التخزين المحلي في متصفحك</p>
        <p style="margin:0 0 12px;">يستخدم النظام تخزينًا محليًا في متصفحك لأغراض تشغيلية ضرورية فقط: إبقاء جلسة دخولك مفتوحة، وحفظ مسودة الشاهد الذي تكتبه حمايةً له من الفقد، وتذكّر تفضيلات العرض. <b>لا يستخدم النظام أي ملفات تعريف ارتباط (كوكيز) للتتبّع أو الإعلانات أو التحليلات الخارجية.</b></p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">7. سجل النشاط</p>
        <p style="margin:0 0 12px;">يسجّل النظام بيانات استخدام أساسية لأغراض المتابعة الإدارية وأمن الحسابات، تشمل أوقات الدخول ومعدل النشاط، إضافةً إلى توثيق العمليات الجوهرية كحذف الشواهد. <b>لا يجمع النظام بيانات تتبّع للموقع الجغرافي أو الأجهزة.</b> يطّلع على هذه البيانات مسؤول النظام فقط، وتُستخدم حصرًا لأغراض تشغيلية.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">8. الاستضافة والتخزين</p>
        <p style="margin:0 0 12px;">تُخزَّن البيانات على خوادم مزوّد خدمات سحابية عالمي (Supabase) يلتزم بمعايير الحماية الدولية. كما هو الحال في أي خدمة سحابية، تخضع البيانات لسياسات المزوّد التقنية والقانونية.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">9. حقوقك في بياناتك</p>
        <p style="margin:0 0 12px;">تملك بياناتك كاملة، ويمكنك تعديلها أو حذفها أو تصديرها نسخة احتياطية في أي وقت من داخل النظام.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">10. حدود المسؤولية</p>
        <p style="margin:0 0 12px;">يُقدَّم النظام "كما هو" دون ضمان توفره الدائم أو خلوه من الأخطاء. يُنصح بشدة بالاحتفاظ بنسخ احتياطية دورية عبر أداة النسخ المتاحة في النظام.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">11. إيقاف الحساب</p>
        <p style="margin:0 0 12px;">يحق لمسؤول النظام تعطيل أي حساب في حال مخالفة هذه الشروط أو إساءة استخدام النظام أو انتهاء الحاجة إلى الحساب.</p>

        <p style="font-weight:700;color:var(--navy);margin:0 0 4px;">12. التعديلات</p>
        <p style="margin:0;">قد تُحدَّث هذه الشروط عند تطوير النظام، ويُعد استمرارك في الاستخدام موافقة على النسخة المحدّثة.</p>

      </div>
    </div>`, '480px');
}

function showAuthMsg(text, type){
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = 'auth-msg ' + type;
}
function hideAuthMsg(){
  const el = document.getElementById('authMsg');
  el.className = 'auth-msg';
  el.textContent = '';
}

/* ============ (2) التحقق من قوة كلمة المرور ============ */
function passwordStrengthError(pw){
  if(!pw || pw.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
  if(!/[a-zA-Z\u0600-\u06FF]/.test(pw)) return 'كلمة المرور يجب أن تحتوي على حرف واحد على الأقل.';
  if(!/[0-9]/.test(pw)) return 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل.';
  /* رفض كلمات المرور الشائعة جدًا حتى لو استوفت الشروط الشكلية */
  const common = ['12345678', '123456789', 'password', 'qwerty123', '11111111', 'abcd1234', 'a1234567'];
  if(common.includes(pw.toLowerCase())) return 'كلمة المرور هذه ضعيفة وشائعة جدًا، اختر كلمة مرور أقوى.';
  return null;
}

/* ============ مؤشر قوة كلمة المرور (بصري فقط — لا يمنع من الحفظ) ============ */
function computePasswordStrength(pw){
  let score = 0;
  if(pw.length >= 8) score++;
  if(pw.length >= 12) score++;
  if(/[0-9]/.test(pw)) score++;
  if(/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if(/[^a-zA-Z0-9\u0600-\u06FF]/.test(pw)) score++;
  if(/[\u0600-\u06FF]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;

  if(score <= 2) return { label: 'ضعيفة', color: '#C0392B', pct: 33 };
  if(score <= 4) return { label: 'متوسطة', color: '#C9A227', pct: 66 };
  return { label: 'قوية', color: '#215C34', pct: 100 };
}

function getPasswordHintMessage(pw){
  if(pw.length < 8) return 'أضف حتى تصل 8 أحرف على الأقل';
  if(!/[a-zA-Z\u0600-\u06FF]/.test(pw)) return 'أضف حرفًا واحدًا على الأقل';
  if(!/[0-9]/.test(pw)) return 'أضف رقمًا واحدًا على الأقل';

  const tips = [];
  if(pw.length < 12) tips.push('أطول قليلًا');
  if(!(/[a-z]/.test(pw) && /[A-Z]/.test(pw))) tips.push('حرفًا كبيرًا');
  if(!/[^a-zA-Z0-9\u0600-\u06FF]/.test(pw)) tips.push('رمزًا خاصًا (!@#...)');

  if(!tips.length) return 'ممتازة ✓';
  return 'جيدة — لتقويتها أكثر أضف ' + tips[0];
}

function updatePasswordStrengthUI(inputId, barId, labelId, boxId){
  const pw = document.getElementById(inputId).value;
  const box = document.getElementById(boxId);
  if(!pw){ box.style.display = 'none'; return; }
  box.style.display = 'block';
  const s = computePasswordStrength(pw);
  const bar = document.getElementById(barId);
  const label = document.getElementById(labelId);
  bar.style.width = s.pct + '%';
  bar.style.background = s.color;
  label.style.color = s.color;
  label.textContent = s.label + ' — ' + getPasswordHintMessage(pw);
}

async function handleAuthSubmit(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value.trim();
  const btn = document.getElementById('authSubmitBtn');

  if(!email || !password){
    showAuthMsg('الرجاء تعبئة البريد الإلكتروني وكلمة المرور.', 'error');
    return;
  }
  if(authMode === 'signup' && !name){
    showAuthMsg('الرجاء إدخال الاسم الكامل.', 'error');
    return;
  }
  if(authMode === 'signup' && !document.getElementById('agreeTerms').checked){
    showAuthMsg('يجب الموافقة على شروط الاستخدام وسياسة الخصوصية للمتابعة.', 'error');
    return;
  }
  if(authMode === 'signup'){
    const pwErr = passwordStrengthError(password);
    if(pwErr){
      showAuthMsg(pwErr, 'error');
      return;
    }
    const password2 = document.getElementById('authPassword2').value;
    if(password !== password2){
      showAuthMsg('كلمتا المرور غير متطابقتين.', 'error');
      return;
    }
  }

  btn.disabled = true;
  hideAuthMsg();

  try{
    if(authMode === 'signup'){
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
      });
      if(error) throw error;
      if(data.session){
        /* نطبّق نوع التكليف قبل onLoggedIn (لا بعده) لضمان قراءة onLoggedIn لقيمته
           الصحيحة من profiles من أول مرة، فتُحسب عناصر الشاشة الرئيسية
           والمؤشر الموزون بشكل صحيح دون حاجة لإعادة تحميل لاحقة */
        const signupDuty = document.getElementById('authDutyType').value;
        if(signupDuty && signupDuty !== 'none'){
          try{
            await sb.rpc('set_duty_type', { target_user_id: data.session.user.id, duty: signupDuty });
          } catch(e){ /* لا نمنع إكمال التسجيل — يمكنه ضبطها لاحقًا من الإعدادات */ }
        }
        onLoggedIn(data.session.user);
      } else {
        showAuthMsg('تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب، ثم سجّل الدخول.', 'ok');
        switchAuthTab('login');
      }
    } else {
      /* (3) التحقق من عدم تجاوز عدد المحاولات الفاشلة المسموح بها قبل أي محاولة دخول */
      try{
        const { data: allowed } = await sb.rpc('check_login_allowed', { p_email: email });
        if(allowed === false){
          showAuthMsg('محاولات دخول فاشلة كثيرة لهذا الحساب. الرجاء الانتظار 15 دقيقة قبل المحاولة مرة أخرى.', 'error');
          btn.disabled = false;
          return;
        }
      } catch(e){ /* لو تعذّر الفحص (مثلًا قبل تشغيل سكربت SQL)، نكمل بدون حظر */ }

      const { data, error } = await sb.auth.signInWithPassword({ email, password });

      /* تسجيل نتيجة المحاولة بصمت (نجاح أو فشل) — لا يؤثر على تجربة المستخدم */
      try{ sb.rpc('record_login_attempt', { p_email: email, p_success: !error }); } catch(e){}

      if(error) throw error;
      onLoggedIn(data.user);
    }
  } catch(err){
    showAuthMsg(translateAuthError(err.message), 'error');
  } finally {
    btn.disabled = false;
  }
}

function translateAuthError(msg){
  if(!msg) return 'حدث خطأ غير متوقع، حاول مرة أخرى.';
  if(msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if(msg.includes('User already registered')) return 'هذا البريد مسجّل مسبقًا، جرّب تسجيل الدخول بدلًا من إنشاء حساب.';
  if(msg.includes('Email not confirmed')) return 'يجب تأكيد بريدك الإلكتروني أولًا قبل تسجيل الدخول.';
  if(msg.includes('Password should be at least')) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
  return msg;
}

let isAdmin = false;

async function onLoggedIn(user){
  currentUser = user;

  /* التحقق من كون الحساب معطّلًا من قبل المسؤول، وقراءة نوع التكليف الإضافي */
  dutyType = 'none'; // إعادة الضبط صراحة: قد يبقى من جلسة سابقة على نفس الصفحة (تسجيل خروج/دخول)
  try{
    const { data: profile } = await sb.from('profiles').select('disabled, duty_type').eq('id', user.id).maybeSingle();
    if(profile && profile.disabled){
      await sb.auth.signOut();
      currentUser = null;
      showAuthMsg('تم تعطيل هذا الحساب من قبل الإدارة. تواصل مع المسؤول لمزيد من المعلومات.', 'error');
      return;
    }
    dutyType = (profile && profile.duty_type) || 'none';
  } catch(e){ /* تجاهل أي خطأ هنا حتى لا يمنع الدخول */ }

  document.getElementById('authView').style.display = 'none';
  document.getElementById('appView').style.display = 'block';
  const meta = user.user_metadata || {};
  document.getElementById('whoName').textContent = meta.full_name || user.email;
  checkAdminStatus();
  renderVerifyBanner();
  applyStaffRoleVisibility();
  sb.rpc('record_login').then(() => {}).catch(() => {});  /* تسجيل النشاط بصمت */
  await loadPerformanceElements();
  /* لا حاجة لاستدعاء loadPlan() هنا بشكل منفصل — showHome() (بالأسفل) يستدعيها
     أصلًا عبر refreshPlanSummary() وينتظرها فعليًا قبل حساب الاكتمال الموزون؛
     استدعاء إضافي هنا كان يكرّر نفس 3 الاستعلامات بلا أي فائدة، ويُبطئ تسجيل
     الدخول بلا داعٍ. */
  await showHome();
  offerDraftRestore();
}

/* وكيل/مدير المدرسة (STANDALONE_ROLES) دور وظيفي مختلف كليًا عن المعلم — لا
   فصل ولا طلاب خاصين به، فتُخفى عنه ميزات مرتبطة تحديدًا بمعلم له فصل (إدارة
   الصف، المتابعة الأكاديمية، برامج الأنشطة الطلابية)، بينما تبقى شواهده/
   خطته/تقييمه الذاتي كما هي (بعناصره الخاصة، تُحسب عبر DB_ELEMENTS كالمعتاد). */
function applyStaffRoleVisibility(){
  const isStandaloneRole = STANDALONE_ROLES.includes(dutyType);
  ['classroomNavTab', 'academicNavTab', 'classroomHomeBtn', 'academicHomeBtn', 'myProgramsBtn', 'programsNavTab'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = isStandaloneRole ? 'none' : '';
  });
}

/* ============ تنبيه تأكيد البريد الإلكتروني ============ */
const VERIFY_DISMISS_KEY = 'shahid_verify_dismissed';

function isEmailVerified(){
  if(!currentUser) return true;
  /* Supabase يضع تاريخ التأكيد عند تفعيل البريد */
  return !!(currentUser.email_confirmed_at || currentUser.confirmed_at);
}

function renderVerifyBanner(){
  const banner = document.getElementById('verifyBanner');
  if(!banner) return;

  if(isEmailVerified()){
    banner.style.display = 'none';
    try{ localStorage.removeItem(VERIFY_DISMISS_KEY); } catch(e){}
    return;
  }

  /* يُخفى مؤقتًا ليوم واحد إن اختار المستخدم الإخفاء */
  try{
    const t = Number(localStorage.getItem(VERIFY_DISMISS_KEY) || 0);
    if(t && (Date.now() - t) < 24 * 60 * 60 * 1000){
      banner.style.display = 'none';
      return;
    }
  } catch(e){}

  banner.style.display = 'block';
  document.getElementById('verifyMsg').textContent = '';
}

function dismissVerifyBanner(){
  try{ localStorage.setItem(VERIFY_DISMISS_KEY, String(Date.now())); } catch(e){}
  document.getElementById('verifyBanner').style.display = 'none';
  showToast('سيظهر التنبيه مرة أخرى بعد يوم', 'ok');
}

async function resendVerification(){
  const msg = document.getElementById('verifyMsg');
  msg.style.color = 'var(--muted)';
  msg.textContent = 'جارٍ الإرسال...';
  try{
    const { error } = await sb.auth.resend({
      type: 'signup',
      email: currentUser.email,
      options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] }
    });
    if(error) throw error;
    msg.style.color = '#215C34';
    msg.textContent = 'تم إرسال رابط التفعيل إلى ' + currentUser.email + ' — افتح بريدك واضغط الرابط.';
    showToast('تحقق من بريدك الإلكتروني', 'ok');
  } catch(err){
    msg.style.color = '#8A2C2C';
    msg.textContent = 'تعذّر الإرسال: ' + err.message;
  }
}

async function checkAdminStatus(){
  try{
    const { data } = await sb.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle();
    isAdmin = !!data;
  } catch(e){
    isAdmin = false;
  }
  document.getElementById('adminNavBtn').style.display = isAdmin ? 'inline-block' : 'none';
  document.getElementById('adminHomeBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('homeToolsSection').style.display = isAdmin ? 'block' : 'none';
  if(isAdmin) refreshSupportMessagesBadge();
  refreshCrmPendingBadges();
  buildAdminRisks();
  buildAcademicRisks();
  buildPerformanceRisks();
  buildDataRisks();
  refreshAcBadges();
}

async function handleLogout(){
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('appView').style.display = 'none';
  document.getElementById('authView').style.display = 'block';
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authPassword2').value = '';
  document.getElementById('verifyBanner').style.display = 'none';
  const agree = document.getElementById('agreeTerms');
  if(agree) agree.checked = false;
}

/* استعادة الجلسة تلقائيًا إن وجدت (إلا إذا كنا في تدفق استعادة كلمة المرور)

   ملاحظة مهمة: التطبيق مقسَّم لعدة ملفات <script src="app/..."> مرتّبة
   (راجع index.html)، وonLoggedIn (بهذا الملف) يستدعي دوالًا معرَّفة بملفات
   لاحقة (showHome بـ app-04، loadPlan بـ app-05، loadPerformanceElements
   بـ app-09). لو استجاب sb.auth.getSession() بسرعة كافية (وهو الحال
   الشائع فعليًا — Supabase تقرأ الجلسة من localStorage محليًا)، قد يُستدعى
   onLoggedIn() قبل ما تُحمَّل تلك الملفات اللاحقة أصلاً، فيرمي الكود خطأ
   "غير معرَّف" ويفشل تسجيل الدخول التلقائي بصمت لمعظم المستخدمين العائدين!
   الحل: تأجيل هذا الفحص حتى حدث DOMContentLoaded، الذي لا يُطلَق إلا بعد
   انتهاء تنفيذ كل وسوم <script> المتزامنة (script-01 حتى script-09)
   بالصفحة بالكامل — يضمن جهوزية كل الدوال بدون أي تأخير محسوس عمليًا
   (لا ينتظر تحميل الصور/الخطوط/المكتبات الخارجية كما لو استخدمنا حدث
   'load' بدلاً منه). */
function checkExistingSession(){
  if(isRecoveryFlow) return;
  (async () => {
    const { data } = await sb.auth.getSession();
    if(data.session){
      onLoggedIn(data.session.user);
    }
  })();
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', checkExistingSession);
} else {
  // احتياطي: لو نُفِّذ هذا السكربت بعد انتهاء تحليل المستند لأي سبب
  checkExistingSession();
}

/* ============ نسيت كلمة المرور ============ */
/* ============ تسجيل الدخول عبر Google ============ */
async function signInWithGoogle(){
  const btn = document.querySelector('.google-signin-btn');
  if(btn) btn.disabled = true;
  try{
    const redirectUrl = window.location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUrl }
    });
    if(error) throw error;
    /* المتصفح سينتقل تلقائيًا لصفحة جوجل هنا؛ لا حاجة لكود إضافي بعد النجاح */
  } catch(err){
    if(btn) btn.disabled = false;
    showAuthMsg('تعذّر بدء الدخول عبر Google: ' + err.message, 'error');
  }
}

async function forgotPassword(){
  let email = document.getElementById('authEmail').value.trim();
  if(!email){
    email = prompt('اكتب بريدك الإلكتروني لإرسال رابط استعادة كلمة المرور:');
    if(!email) return;
    email = email.trim();
  }
  try{
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0].split('?')[0]
    });
    if(error) throw error;
    showAuthMsg('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني. افتح البريد واضغط الرابط.', 'ok');
  } catch(err){
    showAuthMsg(translateAuthError(err.message), 'error');
  }
}

/* شبكة أمان إضافية: لو Supabase أطلق الحدث مباشرة */
sb.auth.onAuthStateChange((event) => {
  if(event === 'PASSWORD_RECOVERY'){
    isRecoveryFlow = true;
    showRecoveryUI();
  }
});

async function updatePasswordAfterRecovery(){
  const p1 = document.getElementById('recoveryPassword').value;
  const p2 = document.getElementById('recoveryPassword2').value;
  const msg = document.getElementById('recoveryMsg');

  if(!p1 || p1.length < 6){
    msg.className = 'auth-msg error';
    msg.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    return;
  }
  const pwErr = passwordStrengthError(p1);
  if(pwErr){
    msg.className = 'auth-msg error';
    msg.textContent = pwErr;
    return;
  }
  if(p1 !== p2){
    msg.className = 'auth-msg error';
    msg.textContent = 'كلمتا المرور غير متطابقتين.';
    return;
  }

  try{
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    msg.className = 'auth-msg ok';
    msg.textContent = 'تم تحديث كلمة المرور بنجاح ✓ جارٍ الدخول...';
    isRecoveryFlow = false;
    const { data } = await sb.auth.getSession();
    setTimeout(() => {
      document.getElementById('authTabs').style.display = 'flex';
      document.getElementById('authBody').style.display = 'block';
      document.getElementById('recoveryBody').style.display = 'none';
      if(data.session) onLoggedIn(data.session.user);
    }, 1200);
  } catch(err){
    msg.className = 'auth-msg error';
    msg.textContent = 'خطأ: ' + err.message;
  }
}

/* ============ الصفحة الرئيسية (لوحة المعلم) ============ */
/* الحقول الافتراضية عند أول استخدام — يقدر المعلم يحذفها أو يضيف غيرها */
const DEFAULT_PROFILE_FIELDS = [
  { label: 'المدرسة', value: '' },
  { label: 'المادة', value: '' },
  { label: 'الفصل', value: '' },
  { label: 'المنطقة/المحافظة', value: 'جدة' }
];

/* يقرأ الحقول المخصصة من بيانات المستخدم، مع دعم البيانات القديمة */
function getProfileFields(){
  const meta = (currentUser && currentUser.user_metadata) || {};

  if(Array.isArray(meta.custom_fields)) return meta.custom_fields;

  /* ترحيل تلقائي من الصيغة القديمة (school/subject/default_class) */
  const migrated = [];
  if(meta.school !== undefined) migrated.push({ label: 'المدرسة', value: meta.school || '' });
  if(meta.subject !== undefined) migrated.push({ label: 'المادة', value: meta.subject || '' });
  if(meta.default_class !== undefined) migrated.push({ label: 'الفصل', value: meta.default_class || '' });
  return migrated.length ? migrated : DEFAULT_PROFILE_FIELDS.map(f => ({ ...f }));
}

/* اختصارات للوصول لقيم شائعة (تُستخدم في الشواهد وملفات PDF) */
function getFieldValue(labelKeywords){
  const fields = getProfileFields();
  const f = fields.find(x => labelKeywords.some(k => (x.label || '').includes(k)));
  return f ? (f.value || '') : '';
}
function getProfileSchool(){ return getFieldValue(['مدرسة', 'المدرسة']); }
function getProfileSubject(){ return getFieldValue(['مادة', 'المادة', 'تخصص']); }
function getProfileClass(){ return getFieldValue(['فصل', 'الفصل', 'صف']); }
/* لا حقل مخصص لها بعد (حساب قديم) -> "جدة" افتراضيًا، قابل للتعديل يدويًا
   بإضافة حقل "المنطقة/المحافظة" من الإعدادات — تُستخدم بخطاب الإحالة السلوكية */
function getProfileRegion(){ return getFieldValue(['منطقة', 'محافظة']) || 'جدة'; }

function renderProfile(){
  renderCycleCard();
}

/* ============ دورة الأداء الوظيفي (تخطيط / مراجعة نصف سنوية / تقييم) ============
   تقسيم تقريبي بحسب العام الدراسي — يمكن تعديله لاحقًا وفق تقويم الوزارة الرسمي
   التفاصيل والخطوات الرسمية منقولة من "الدليل الإرشادي لإدارة الأداء الوظيفي" الصادر عن وزارة التعليم */
const CYCLE_STAGES = {
  planning: {
    label: 'مرحلة التخطيط',
    timing: 'تبدأ مع بداية دورة الأداء (العام الدراسي)',
    tip: function(){
      const hasPlan = Object.keys(myPlan || {}).some(k => ((myPlan[k] || {}).target_count || 0) > 0);
      if(!hasPlan){
        return 'حدّد خطتك الآن: ادخل «خطتي» وحدّد المستوى الذي تستهدفه لكل عنصر، وعدد الشواهد التي تنوي توثيقها — يساعدك هذا تدخل جلسة التخطيط مع مديرك وأنت مستعد.';
      }
      return 'خطتك جاهزة — الآن ابدأ التوثيق الفعلي، ولا يزال أمامك وقت كافٍ قبل نهاية دورة الأداء.';
    },
    steps: [
      'مناقشة المهام والأدوار والمسؤوليات والأهداف المتوقعة منك خلال دورة الأداء',
      'الاطلاع على عناصر تقييم الأداء الوظيفي',
      'تبادل الآراء والمقترحات حول معايير التقييم وآليات التطبيق',
      'تحديد فترة المتابعة والقياس',
      'تزويدك بصورة من نموذج تقييم الأداء الوظيفي',
      'اعتماد ميثاق الأداء الوظيفي'
    ]
  },
  midreview: {
    label: 'المراجعة نصف السنوية',
    timing: 'تبدأ في منتصف دورة الأداء',
    tip: function(){
      const wp = computeWeightedProgress();
      if(wp.pct < 30){
        return 'تقدّمك أقل من المتوقع عند منتصف العام — راجع أسباب التأخر وخصّص وقتًا للتوثيق قبل جلسة المراجعة.';
      }
      return 'تقدّمك جيد لهذه المرحلة — جهّز أبرز شواهدك من الفصل الأول لعرضها في جلسة المراجعة النصف سنوية.';
    },
    steps: [
      'استعراض مستويات الأداء التي أظهرتها',
      'تقبّل ما يُطرح من أفكار جديدة لتطوير العمل',
      'المناقشة البنّاءة وتقديم/تلقي التغذية الراجعة',
      'تقدير الإنجازات وتقديم الدعم المطلوب',
      'مناقشة نقاط القوة ومجالات التطوير',
      'الاستعانة بالأقران من ذوي الخبرة أو تبادل الزيارات',
      'اتخاذ الإجراءات التصحيحية المناسبة'
    ]
  },
  evaluation: {
    label: 'مرحلة التقييم',
    timing: 'تبدأ في نهاية العام الدراسي',
    tip: function(){
      const elements = getElementsOrder();
      const missing = elements.filter(e => (planShahidCounts[e.key] || 0) === 0).map(e => e.label);
      if(missing.length){
        const list = missing.slice(0, 3).join('، ') + (missing.length > 3 ? ' وغيرها' : '');
        return `لم توثّق بعد: ${list} — أكملها قبل إغلاق الدورة.`;
      }
      return 'غطّيت كل العناصر بشاهد واحد على الأقل — راجع الأقل توثيقًا وأضف ما ينقص قبل التقييم النهائي.';
    },
    steps: [
      'تعبئة التقييم الذاتي (لا يدخل في احتساب الدرجة النهائية)',
      'مناقشة نتائج تقييم الأداء الوظيفي وبيان أسبابها',
      'تقييم الأداء وفقًا لنموذج التقييم المعتمد بموضوعية وحيادية',
      'تحديد نقاط القوة ومجالات التطوير',
      'اعتماد التقييم وتزويدك بصورة منه',
      'يحق لك التظلم على النتيجة مرفقًا بالشواهد إن رأيت ضرورة لذلك'
    ]
  }
};

function getCycleStageKey(date){
  const d = date || new Date();
  const m = d.getMonth() + 1; // 1-12
  if(m === 8 || m === 9 || m === 10 || m === 11) return 'planning';
  if(m === 12 || m === 1 || m === 2) return 'midreview';
  return 'evaluation'; // مارس حتى نهاية يوليو — تشمل إغلاق الدورة نهاية العام
}

function renderCycleCard(){
  const key = getCycleStageKey();
  const stage = CYCLE_STAGES[key];
  document.getElementById('cycleBadge').textContent = stage.label;
  document.getElementById('cycleTip').textContent = typeof stage.tip === 'function' ? stage.tip() : stage.tip;
}

/* ============================================
   (4) جولة تعريفية قصيرة — تظهر مرة واحدة فقط لأي معلم جديد
   ============================================ */
const ONBOARDING_KEY = 'shahid_onboarded_v1';
const ONBOARDING_STEPS = [
  { title: 'مرحبًا بك في شاهد 👋', body: 'أداة بسيطة تساعدك على توثيق شواهد أدائك الوظيفي بثلاث خطوات، على مدار العام.' },
  { title: '١. خطتي', body: 'ابدأ من "خطتي" — حدّد لكل عنصر أداء المستوى الذي تستهدفه وعدد الشواهد التي تنوي توثيقها. اختياري، لكنه يوجّه توثيقك.' },
  { title: '٢. شواهدي', body: 'وثّق أعمالك اليومية بالصور والوصف من "شواهدي". فيه نماذج جاهزة توفّر عليك وقت الكتابة.' },
  { title: '٣. تقييمي الذاتي', body: 'في نهاية الدورة، قيّم نفسك من "تقييمي الذاتي" واستعد لجلسة التقييم مع مديرك — وصدّر كل شيء كملف PDF جاهز.' }
];
let _onboardStep = 0;

function maybeShowOnboardingTour(){
  try{
    if(localStorage.getItem(ONBOARDING_KEY)) return;
  } catch(e){ return; }
  _onboardStep = 0;
  showOnboardingStep();
}

function showOnboardingStep(){
  const s = ONBOARDING_STEPS[_onboardStep];
  const isLast = _onboardStep === ONBOARDING_STEPS.length - 1;
  showInfoModal(`
    <div style="text-align:center;">
      <h3 style="margin:0 0 10px;font-size:16px;color:var(--navy);">${escapeHtml(s.title)}</h3>
      <p style="font-size:13px;color:#413D33;line-height:1.9;margin:0 0 16px;">${escapeHtml(s.body)}</p>
      <div style="display:flex;justify-content:center;gap:6px;margin-bottom:14px;">
        ${ONBOARDING_STEPS.map((_, i) => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${i === _onboardStep ? 'var(--gold)' : 'var(--line)'};"></span>`).join('')}
      </div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="advanceOnboarding()">${isLast ? 'ابدأ الاستخدام' : 'التالي'}</button>
    </div>`, '340px');

  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn){
    cancelBtn.textContent = 'تخطي الجولة';
    /* نضمن تسجيل "تمت الجولة" حتى لو ضغط تخطي مباشرة، لا فقط عند الإكمال */
    cancelBtn.addEventListener('click', () => {
      try{ localStorage.setItem(ONBOARDING_KEY, '1'); } catch(e){}
    }, { once: true });
  }
}

function advanceOnboarding(){
  _onboardStep++;
  if(_onboardStep >= ONBOARDING_STEPS.length){
    finishOnboarding();
  } else {
    showOnboardingStep();
  }
}

function finishOnboarding(){
  try{ localStorage.setItem(ONBOARDING_KEY, '1'); } catch(e){}
  const cancelBtn = document.getElementById('confirmCancelBtn');
  if(cancelBtn) cancelBtn.click();
}

function showInfoModal(bodyHtml, maxWidth){
  document.getElementById('confirmMsg').innerHTML = bodyHtml;
  document.getElementById('confirmOkBtn').style.display = 'none';
  document.getElementById('confirmCancelBtn').textContent = 'إغلاق';
  document.getElementById('confirmModal').style.display = 'flex';
  document.getElementById('confirmModal').querySelector('.confirm-box').style.maxWidth = maxWidth || '480px';

  const cancelBtn = document.getElementById('confirmCancelBtn');
  const closeHandler = () => {
    document.getElementById('confirmModal').style.display = 'none';
    document.getElementById('confirmOkBtn').style.display = 'inline-block';
    document.getElementById('confirmCancelBtn').textContent = 'إلغاء';
    document.getElementById('confirmMsg').innerHTML = '';
    document.getElementById('confirmModal').querySelector('.confirm-box').style.maxWidth = '';
    cancelBtn.removeEventListener('click', closeHandler);
  };
  cancelBtn.addEventListener('click', closeHandler);
}

function showPhaseInfoModal(){
  const currentKey = getCycleStageKey();
  const order = ['planning', 'midreview', 'evaluation'];
  const body = order.map(key => {
    const s = CYCLE_STAGES[key];
    const isCurrent = key === currentKey;
    const stepsHtml = s.steps.length
      ? '<ul style="margin:8px 0 0;padding-right:18px;font-size:12.5px;line-height:1.9;color:#413D33;">' +
        s.steps.map(st => `<li>${escapeHtml(st)}</li>`).join('') + '</ul>'
      : '';
    return `
      <div style="border:1px solid ${isCurrent ? 'var(--gold)' : 'var(--line)'};background:${isCurrent ? '#F4F0E4' : '#fff'};padding:14px 16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:800;color:var(--navy);font-size:14px;">${escapeHtml(s.label)}${isCurrent ? ' <span style="font-size:10.5px;color:var(--gold);">(المرحلة الحالية)</span>' : ''}</span>
          <span style="font-size:11px;color:var(--muted);">${escapeHtml(s.timing)}</span>
        </div>
        ${stepsHtml}
      </div>`;
  }).join('');

  showInfoModal(`
    <div style="text-align:right;">
      <p style="font-size:12px;color:var(--muted);margin:0 0 14px;">حسب "الدليل الإرشادي لإدارة الأداء الوظيفي" الصادر عن وزارة التعليم:</p>
      ${body}
    </div>`, '480px');
}

function showPlanNoteInfo(){
  showInfoModal(`
    <div style="text-align:right;">
      <h3 style="margin:0 0 12px;font-size:15px;color:var(--navy);">مساعدك لتحقيق المستوى المستهدف لعناصر الأداء الوظيفي</h3>

      <p style="font-size:12.5px;line-height:1.95;color:#413D33;margin:0 0 10px;">
        الوزارة حدّدت لك مسبقًا <b>11 عنصر تقييم ثابتة</b> بأوزان جاهزة — أنت لا تضع أهدافًا رقمية جديدة.
      </p>

      <p style="font-size:12.5px;line-height:1.95;color:#413D33;margin:0 0 10px;">
        يوجد فعلًا <b>جلسة تخطيط رسمية</b> معتمدة (الأسئلة الشائعة الرسمية، إدارة الأداء الوظيفي، الإصدار الثاني 2026م): يتفق فيها المعلم مع مديره المباشر على الأداء المتوقع خلال العام، ويطّلع على نموذج التقييم في نظام فارس. لكنها <b>مناقشة واتفاق</b>، لا صياغة أهداف وأوزان جديدة.
      </p>

      <p style="font-size:12.5px;line-height:1.95;color:#413D33;margin:0;">
        خطتك هنا <b>ليست بديلًا عن ذلك ولا تُرفع لفارس</b> — هي أداتك الشخصية لتستعد لتلك الجلسة: تدخلها وأنت عارف أي مستوى تستهدفه في كل عنصر، وكم شاهدًا تنوي توثيقه. العدد والمستوى قرارك الشخصي، ولا يفرضهما النظام.
      </p>
    </div>`, '440px');
}

function showSettings(section){
  hideAllMainViews();
  setActiveBottomTab(null);
  document.getElementById('settingsView').style.display = 'block';
  const meta = (currentUser && currentUser.user_metadata) || {};
  document.getElementById('peName').value = meta.full_name || '';
  renderCustomFields(getProfileFields());
  document.getElementById('profileMsg').textContent = '';
  document.getElementById('peNewEmail').placeholder = 'الحالي: ' + (currentUser.email || '');
  document.getElementById('peNewEmail').value = '';
  document.getElementById('peCurrentPassword').value = '';
  document.getElementById('peNewPassword').value = '';
  document.getElementById('peNewPassword2').value = '';
  document.getElementById('peNewPwBox').style.display = 'none';
  document.getElementById('emailChangeMsg').textContent = '';
  document.getElementById('passwordChangeMsg').textContent = '';
  document.getElementById('peDutyType').value = dutyType;
  document.getElementById('dutyTypeMsg').textContent = '';
  showSettingsSection(section || 'menu');
}

/* تعديل نوع التكليف الإضافي من الإعدادات — عبر الدالة المضبوطة set_duty_type
   (لا تحديث مباشر على profiles، ولا عبر sb.auth.updateUser لأن saveProfile لا
   يلمس هذا الحقل أصلًا، تجنّبًا لتعارضه مع مُحفّز مزامنة user_metadata) */
async function saveDutyType(duty){
  const sel = document.getElementById('peDutyType');
  const msg = document.getElementById('dutyTypeMsg');
  const uid = currentUser.id; // نلتقط هوية المستخدم الحالي قبل الانتظار — لو سجّل خروجًا ودخل مستخدم آخر قبل اكتمال الطلب، لا نطبّق النتيجة على المستخدم الجديد
  const previousDuty = dutyType;
  sel.disabled = true;
  try{
    const { error } = await sb.rpc('set_duty_type', { target_user_id: uid, duty });
    if(error) throw error;
    if(!currentUser || currentUser.id !== uid) return; // تغيّر المستخدم الحالي أثناء الانتظار — تجاهل التطبيق على الحالة الجديدة
    dutyType = duty;
    applyStaffRoleVisibility(); // إظهار/إخفاء ميزات "إدارة الصف" ونحوها فورًا لو تحوّل من/إلى وكيل مدرسة
    await loadPerformanceElements(); // إعادة حساب DB_ELEMENTS فورًا بالعناصر/الأوزان الجديدة
    const label = (DUTY_TYPES.find(d => d.value === duty) || {}).label || duty;
    msg.className = 'save-msg';
    msg.textContent = `تم ضبط تكليفك: ${label}`;
    showToast(`تم ضبط تكليفك: ${label}`, 'ok');
  } catch(err){
    if(currentUser && currentUser.id === uid) sel.value = previousDuty; // التراجع عن التغيير البصري لأن الحفظ فشل
    msg.className = 'save-msg error';
    msg.textContent = 'تعذّر الحفظ: ' + err.message;
  } finally {
    sel.disabled = false;
  }
}

function showSettingsSection(name){
  const ids = { menu: 'settingsMenu', profile: 'settingsProfileBody', security: 'settingsSecurityBody', data: 'settingsDataBody', about: 'settingsAboutBody' };
  Object.values(ids).forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById(ids[name] || ids.menu).style.display = 'block';
}

/* ============ مركز المخاطر ============ */
async function showRiskCenter(){
  hideAllMainViews();
  setActiveBottomTab('risk');
  document.getElementById('riskView').style.display = 'block';
  await Promise.all([buildAdminRisks(), buildAcademicRisks(), buildPerformanceRisks(), buildDataRisks()]);
}

function daysSince(dateStr){
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

/* يشغّل مصفوفة استعلامات معًا، ويتحقق من عدم وجود أي خطأ ضمنها فعليًا — لا
   يكفي فحص data فقط، لأن استعلامًا فاشلًا (خطأ شبكة، أو Supabase "بارد" لم
   يستيقظ بعد) يُرجع data:null بلا رمي استثناء، فيبدو كـ"لا توجد بيانات/لا
   تنبيهات" خطأً بدل "فشل الفحص". عند فشل أي استعلام، نعيد الكل مرة واحدة بعد
   مهلة قصيرة (كافية غالبًا لتجاوز فترة الاستيقاظ) قبل التسليم بالفشل — وحينها
   يُبقي المستدعي المحتوى المعروض حاليًا كما هو بدل استبداله بـ"لا تنبيهات ✓"
   خاطئة (نفس المبدأ المطبَّق في loadPlan). */
async function runQueriesWithRetry(queryFactories){
  const runAll = () => Promise.all(queryFactories.map(f => f()));
  let results = await runAll();
  let hadError = results.some(r => r.error);
  if(hadError){
    await new Promise(r => setTimeout(r, 1500));
    results = await runAll();
    hadError = results.some(r => r.error);
  }
  return { ok: !hadError, results };
}

function riskRow(level, text, actionLabel, actionFn){
  const colors = { high: '#8A2C2C', medium: '#6B5420', low: '#2C4A72' };
  const bgs = { high: '#FBEAEA', medium: '#FBF3E6', low: '#EDF1F7' };
  const c = colors[level] || colors.low;
  const bg = bgs[level] || bgs.low;
  const btnId = 'riskBtn' + Math.random().toString(36).slice(2, 9);
  window['_' + btnId] = actionFn;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line);background:${bg};">
    <span style="font-size:12.5px;color:${c};flex:1;">${text}</span>
    ${actionFn ? `<button class="btn btn-outline" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="window._${btnId}()">${actionLabel || 'اذهب'}</button>` : ''}
  </div>`;
}

async function buildAdminRisks(){
  const box = document.getElementById('riskAdminBody');
  /* فلترة صريحة بمعرّف المعلم الحالي ضرورية: classroom_students/incidents
     لهما صلاحية "المسؤول يشوف الكل"، فبدونها تعرض لوحة تنبيهات إدارة
     الصف الخاصة بحساب المسؤول حوادث كل المعلمين مجتمعة بدل حوادثه هو فقط. */
  const { ok, results } = await runQueriesWithRetry([
    () => sb.from('classroom_students').select('id, full_name').eq('teacher_id', currentUser.id),
    () => sb.from('classroom_incident_types').select('id, problem_name, problem_degree'),
    () => sb.from('classroom_incidents').select('id, student_id, incident_type_id, current_stage, referral_letter_generated, referral_receipt_photo_url, created_at').eq('teacher_id', currentUser.id).eq('current_stage', 'referred')
  ]);
  if(!ok) return; /* فشل الفحص مرتين — نُبقي ما هو معروض حاليًا كما هو */

  try{
    const [{ data: students }, { data: types }, { data: incidents }] = results;

    const rows = [];
    (incidents || []).forEach(inc => {
      const student = (students || []).find(s => s.id === inc.student_id);
      const type = (types || []).find(t => t.id === inc.incident_type_id);
      const name = student ? student.full_name : 'طالب';

      if(!inc.referral_letter_generated){
        const urgent = type && type.problem_degree >= 4 && daysSince(inc.created_at) > 1;
        rows.push({
          level: urgent ? 'high' : 'medium',
          text: `${name} — مخالفة "${type ? type.problem_name : '—'}" لم يُصدَر لها خطاب تحويل بعد${urgent ? ' — درجة عالية ومرّ عليها أكثر من يوم' : ''}`,
          action: () => { showClassroomManagement(); setTimeout(() => jumpToCrmFilter('pending'), 250); }
        });
      } else if(!inc.referral_receipt_photo_url){
        const overdue = daysSince(inc.created_at) > 3;
        rows.push({
          level: overdue ? 'medium' : 'low',
          text: `${name} — خطاب تحويل صادر بدون توثيق صورة التسليم${overdue ? ' منذ أكثر من 3 أيام' : ''}`,
          action: () => { showClassroomManagement(); setTimeout(() => jumpToCrmFilter('undocumented'), 250); }
        });
      }
    });

    rows.sort((a, b) => (a.level === 'high' ? -1 : 1) - (b.level === 'high' ? -1 : 1));

    const badgeCount = rows.filter(r => r.level === 'high').length + rows.filter(r => r.level === 'medium').length;
    updateRiskBadges();

    box.innerHTML = rows.length
      ? rows.map(r => riskRow(r.level, r.text, 'اذهب', r.action)).join('')
      : '<div class="empty-state">لا تنبيهات إدارية حاليًا ✓</div>';
  } catch(e){
    box.innerHTML = '<div class="empty-state">تعذّر فحص إدارة الصف</div>';
  }
}

async function buildAcademicRisks(){
  const box = document.getElementById('riskAcademicBody');
  /* نفس سبب الفلترة في buildAdminRisks أعلاه — classroom_students/
     academic_cases لهما صلاحية "المسؤول يشوف الكل" أيضًا. */
  const { ok, results } = await runQueriesWithRetry([
    () => sb.from('classroom_students').select('id, full_name').eq('teacher_id', currentUser.id),
    () => sb.from('academic_cases').select('id, student_id, subject, referral_letter_generated, referral_receipt_photo_url, created_at').eq('teacher_id', currentUser.id).eq('status', 'referred')
  ]);
  if(!ok) return; /* فشل الفحص مرتين — نُبقي ما هو معروض حاليًا كما هو */

  try{
    const [{ data: students }, { data: cases }] = results;

    const rows = [];
    (cases || []).forEach(c => {
      const student = (students || []).find(s => s.id === c.student_id);
      const name = student ? student.full_name : 'طالب';

      if(!c.referral_letter_generated){
        rows.push({
          level: daysSince(c.created_at) > 3 ? 'high' : 'medium',
          text: `${name} — إحالة أكاديمية (${c.subject}) لم يُصدَر لها خطاب بعد${daysSince(c.created_at) > 3 ? ' — مرّ أكثر من 3 أيام' : ''}`,
          action: () => { showAcademicTracking(); setTimeout(() => jumpToAcFilter('pending'), 250); }
        });
      } else if(!c.referral_receipt_photo_url){
        const overdue = daysSince(c.created_at) > 3;
        rows.push({
          level: overdue ? 'medium' : 'low',
          text: `${name} — خطاب إحالة أكاديمية صادر بدون توثيق تسليم${overdue ? ' منذ أكثر من 3 أيام' : ''}`,
          action: () => { showAcademicTracking(); setTimeout(() => jumpToAcFilter('undocumented'), 250); }
        });
      }
    });

    rows.sort((a, b) => (a.level === 'high' ? -1 : 1) - (b.level === 'high' ? -1 : 1));
    updateRiskBadges();

    box.innerHTML = rows.length
      ? rows.map(r => riskRow(r.level, r.text, 'اذهب', r.action)).join('')
      : '<div class="empty-state">لا تنبيهات أكاديمية حاليًا ✓</div>';
  } catch(e){
    box.innerHTML = '<div class="empty-state">تعذّر فحص المتابعة الأكاديمية</div>';
  }
}

async function buildPerformanceRisks(){
  const box = document.getElementById('riskPerfBody');
  try{
    await loadPlan();
    const elements = getElementsOrder();
    const end = getCycleEndDate();
    const daysLeft = Math.max(0, Math.round((end - new Date()) / (1000 * 60 * 60 * 24)));
    const cycleNearEnd = daysLeft <= 45;

    const rows = [];
    elements.forEach(e => {
      const w = getElementWeight(e.key);
      if(!w) return;
      const target = (myPlan[e.key] || {}).target_count || 0;
      const done = planShahidCounts[e.key] || 0;
      const ratio = target > 0 ? Math.min(1, done / target) : (done > 0 ? 1 : 0);

      if(ratio < 0.5 && w >= 10){
        rows.push({
          level: cycleNearEnd ? 'high' : 'medium',
          text: `"${e.label}" (وزن ${w}%) — ${target > 0 ? `أنجزت ${done} من ${target} فقط` : 'بلا توثيق بعد'}${cycleNearEnd ? ` — تبقّى ${daysLeft} يومًا فقط على نهاية الدورة` : ''}`,
          action: () => showPlan()
        });
      }
    });

    rows.sort((a, b) => (a.level === 'high' ? -1 : 1) - (b.level === 'high' ? -1 : 1));
    updateRiskBadges();

    box.innerHTML = rows.length
      ? rows.map(r => riskRow(r.level, r.text, 'اذهب للخطة', r.action)).join('')
      : '<div class="empty-state">لا تنبيهات أداء بارزة حاليًا ✓</div>';
  } catch(e){
    box.innerHTML = '<div class="empty-state">تعذّر فحص عناصر الأداء</div>';
  }
}

async function buildDataRisks(){
  const box = document.getElementById('riskDataBody');
  const rows = [];

  if(!getProfileSchool() || !getProfileSubject()){
    rows.push({
      level: 'low',
      text: 'الملف الشخصي ناقص (المدرسة أو المادة غير معبّأة) — يؤثر على دقة الخطابات والتقارير',
      action: () => showSettings('profile')
    });
  }

  /* مفتاح خاص بالمستخدم الحالي — على جهاز مشترك بين أكثر من حساب، مفتاح
     عام واحد كان يعني أن نسخة أحدهم الاحتياطية "تُريح" تنبيه حساب آخر لم
     يعمل نسخة قط. */
  const lastBackup = localStorage.getItem('last_personal_backup_ts:' + currentUser.id);
  const backupDays = lastBackup ? daysSince(lastBackup) : null;
  if(!lastBackup || backupDays > 30){
    rows.push({
      level: backupDays > 60 ? 'medium' : 'low',
      text: lastBackup ? `آخر نسخة احتياطية شخصية منذ ${Math.round(backupDays)} يومًا` : 'لا توجد نسخة احتياطية شخصية مسجّلة بعد',
      action: () => showSettings('data')
    });
  }

  rows.sort((a, b) => (a.level === 'medium' ? -1 : 1) - (b.level === 'medium' ? -1 : 1));
  updateRiskBadges();

  box.innerHTML = rows.length
    ? rows.map(r => riskRow(r.level, r.text, 'اذهب', r.action)).join('')
    : '<div class="empty-state">لا تنبيهات بيانات حاليًا ✓</div>';
}

let _riskBadgeDebounce = null;
function updateRiskBadges(){
  if(_riskBadgeDebounce) clearTimeout(_riskBadgeDebounce);
  _riskBadgeDebounce = setTimeout(() => {
    const boxes = ['riskAdminBody', 'riskAcademicBody', 'riskPerfBody', 'riskDataBody'];
    let count = 0;
    boxes.forEach(id => {
      const el = document.getElementById(id);
      if(el && !el.querySelector('.empty-state') && !el.querySelector('.loading-state')){
        count += el.children.length;
      }
    });
    const navBadge = document.getElementById('riskNavBadge');
    if(navBadge){
      if(count > 0){ navBadge.style.display = 'block'; navBadge.textContent = count > 9 ? '9+' : String(count); }
      else { navBadge.style.display = 'none'; }
    }
  }, 300);
}

