/* تجارة ERP — منطق الموقع التسويقي (بدون مكتبات وبدون خطوة بناء) */
(function () {
  'use strict';

  var CFG = window.TC_CONFIG || {};
  var API = CFG.API_BASE || '/api/public';
  var VAT = typeof CFG.VAT_RATE === 'number' ? CFG.VAT_RATE : 0.15;

  /* ---------- أدوات عامة ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n, decimals) {
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals == null ? 0 : decimals,
      maximumFractionDigits: decimals == null ? 2 : decimals
    });
  }
  function qs(name) { return new URLSearchParams(location.search).get(name); }
  function store(key, val) {
    try { if (val === undefined) return JSON.parse(sessionStorage.getItem('tc:' + key)); sessionStorage.setItem('tc:' + key, JSON.stringify(val)); } catch (e) { return null; }
  }

  var MESSAGES = {
    network: 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.',
    rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
    captcha_failed: 'تعذّر التحقق من أنك لست روبوتًا. أعد المحاولة.',
    email_taken: 'هذا البريد مسجّل لدينا مسبقًا. سجّل الدخول بدلًا من ذلك.',
    subdomain_taken: 'رابط الشركة هذا مستخدم. جرّب اسمًا آخر.',
    subdomain_invalid: 'رابط الشركة يقبل أحرفًا إنجليزية صغيرة وأرقامًا وشرطة (-) فقط، من 3 إلى 30 حرفًا.',
    subdomain_reserved: 'هذا الاسم محجوز. اختر اسمًا آخر.',
    invalid_code: 'الرمز غير صحيح.',
    code_expired: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.',
    too_many_attempts: 'تجاوزت عدد المحاولات المسموح. اطلب رمزًا جديدًا.',
    invalid_token: 'رابط الاشتراك غير صالح أو منتهي. اطلب رابطًا جديدًا من داخل نظامك.',
    payment_failed: 'لم تتم عملية الدفع. لم يُخصم أي مبلغ، ويمكنك المحاولة مرة أخرى.',
    validation: 'راجِع الحقول المظللة.',
    unknown: 'حدث خطأ غير متوقع. حاول مرة أخرى أو تواصل معنا.'
  };

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'Accept': 'application/json' }, credentials: 'same-origin' };
    if (opts.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (res) {
      return res.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = (data && data.error) || {};
          var e = new Error(err.message || MESSAGES[err.code] || MESSAGES.unknown);
          e.code = err.code || (res.status === 429 ? 'rate_limited' : 'unknown');
          e.fields = err.fields || {};
          e.status = res.status;
          if (!err.message && MESSAGES[e.code]) e.message = MESSAGES[e.code];
          throw e;
        }
        return data;
      });
    }, function () {
      var e = new Error(MESSAGES.network); e.code = 'network'; throw e;
    });
  }

  function showAlert(el, msg, kind) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'alert ' + (kind === 'ok' ? 'alert-ok' : 'alert-error');
    el.hidden = !msg;
    if (msg) el.setAttribute('role', kind === 'ok' ? 'status' : 'alert');
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'جارٍ الإرسال…'; btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.removeAttribute('aria-busy'); btn.disabled = false; }
  }
  function markFields(form, fields) {
    $all('[aria-invalid]', form).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    $all('.error-text', form).forEach(function (e) { e.textContent = ''; });
    Object.keys(fields || {}).forEach(function (name) {
      var input = form.elements[name];
      if (input && input.setAttribute) input.setAttribute('aria-invalid', 'true');
      var holder = $('[data-error-for="' + name + '"]', form);
      if (holder) holder.textContent = fields[name];
    });
  }
  function formData(form) {
    var out = {};
    $all('input, select, textarea', form).forEach(function (el) {
      if (!el.name) return;
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else out[el.name] = el.value.trim();
    });
    return out;
  }

  var ICON_CHECK = '<svg class="icon" width="18" height="18" viewBox="0 0 24 24" stroke-width="2.4" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  /* ---------- الباقات ---------- */
  // تُستخدم فقط إذا لم يستجب الـ API (الأسعار الرسمية تأتي من جدول plans)
  var FALLBACK_PLANS = [
    { code: 'basic', name: 'الأساسية', description: 'لمحل واحد يبدأ رحلته الرقمية', short: 'مستخدمان · فرع واحد',
      users: '٢', branches: '١', einvoice: 'مشمولة',
      monthly_price: 199, yearly_price: 1990, highlight: false,
      features: ['مستخدمان', 'فرع واحد ومستودع واحد', 'المبيعات ونقاط البيع', 'المخزون والمشتريات', 'الفاتورة الإلكترونية (ZATCA)'] },
    { code: 'pro', name: 'الاحترافية', description: 'لشركات الجملة ومورّدي المقاولين', short: '٨ مستخدمين · ٣ فروع',
      users: 'حتى ٨', branches: 'حتى ٣', einvoice: 'مشمولة',
      monthly_price: 399, yearly_price: 3990, highlight: true,
      features: ['حتى ٨ مستخدمين', 'حتى ٣ فروع ومستودعات متعددة', 'كل مزايا الأساسية', 'عروض الأسعار والأسعار المتعددة', 'المحاسبة الكاملة والتقارير الذكية', 'إرسال عبر واتساب والبريد'] },
    { code: 'enterprise', name: 'المؤسسات', description: 'للموزعين والشركات متعددة الفروع', short: 'مستخدمون وفروع غير محدودة',
      users: 'غير محدود', branches: 'غير محدود', einvoice: 'مشمولة + API',
      monthly_price: 799, yearly_price: 7990, highlight: false, self_serve: false,
      features: ['مستخدمون وفروع غير محدودة', 'كل مزايا الاحترافية', 'واجهات API للربط', 'صلاحيات متقدمة حسب الفرع', 'مدير حساب ودعم أولوية'] }
  ];
  var plansPromise = null;
  function loadPlans() {
    if (!plansPromise) {
      plansPromise = api('/plans').then(function (d) {
        var list = d && (d.plans || d);
        return Array.isArray(list) && list.length ? list : FALLBACK_PLANS;
      }).catch(function () { return FALLBACK_PLANS; });
    }
    return plansPromise;
  }
  function planPrice(plan, cycle) { return Number(cycle === 'yearly' ? plan.yearly_price : plan.monthly_price); }
  function cycleWord(cycle) { return cycle === 'yearly' ? 'سنة' : 'شهر'; }

  function initPricing() {
    var holder = $('#plans');
    if (!holder) return;
    var cycle = 'monthly';
    var btns = $all('[data-cycle]');
    var note = $('#price-note');

    function render(plans) {
      holder.innerHTML = plans.map(function (p) {
        var price = planPrice(p, cycle);
        var featured = !!p.highlight;
        var trialBtn = featured ? 'btn btn-dark btn-block' : 'btn btn-primary btn-block';
        var second = p.self_serve === false
          ? '<a class="link" href="/#contact">أو تواصل مع المبيعات</a>'
          : '<a class="link" href="/signup.html?plan=' + encodeURIComponent(p.code) + '&cycle=' + cycle + '&subscribe=1">أو اشترك مباشرة</a>';
        return '<div class="price-row' + (featured ? ' featured' : '') + '">' +
          '<div class="name">' + esc(p.name) + '<small>' + esc(p.description) + '</small></div>' +
          '<div><span class="lbl">المستخدمون</span>' + esc(p.users || '—') + '</div>' +
          '<div><span class="lbl">الفروع</span>' + esc(p.branches || '—') + '</div>' +
          '<div><span class="lbl">الفاتورة الإلكترونية</span>' + esc(p.einvoice || 'مشمولة') + '</div>' +
          '<div class="amount"><span class="lbl">' + (cycle === 'yearly' ? 'سنويًا' : 'شهريًا') + '</span>' + money(price) + '<small>ر.س</small></div>' +
          '<div class="cta"><a class="' + trialBtn + '" href="/signup.html?plan=' + encodeURIComponent(p.code) + '">ابدأ مجانًا</a>' + second + '</div>' +
          '</div>';
      }).join('');
      var col = $('#price-col-label'); if (col) col.textContent = cycle === 'yearly' ? 'السعر السنوي' : 'السعر الشهري';
      if (note) note.textContent = (cycle === 'yearly' ? 'الاشتراك السنوي بسعر ١٠ أشهر. ' : 'وفّر شهرين بالاشتراك السنوي. ') +
        'الأسعار لا تشمل ضريبة القيمة المضافة ١٥٪. الدفع بمدى وApple Pay وVisa/Mastercard وSTC Pay.';
    }

    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        cycle = b.dataset.cycle;
        btns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        loadPlans().then(render);
      });
    });
    loadPlans().then(render);
  }

  /* ---------- الهيدر في الجوال ---------- */
  function initHeader() {
    var header = $('.site-header');
    var toggle = $('.nav-toggle');
    if (!header || !toggle) return;
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    $all('.main-nav a').forEach(function (a) {
      a.addEventListener('click', function () { header.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
    });
  }

  /* ---------- CAPTCHA (Cloudflare Turnstile) ---------- */
  var turnstileReady = null;
  function initCaptcha(container) {
    if (!container) return Promise.resolve(null);
    if (!CFG.TURNSTILE_SITE_KEY) { container.hidden = true; return Promise.resolve(null); }
    if (!turnstileReady) {
      turnstileReady = new Promise(function (resolve) {
        window.__tcTurnstileLoaded = resolve;
        var s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tcTurnstileLoaded&render=explicit';
        s.async = true; s.defer = true;
        document.head.appendChild(s);
      });
    }
    return turnstileReady.then(function () {
      return window.turnstile.render(container, { sitekey: CFG.TURNSTILE_SITE_KEY, language: 'ar', theme: 'light' });
    });
  }
  function captchaToken(widgetId) {
    if (widgetId == null || !window.turnstile) return '';
    return window.turnstile.getResponse(widgetId) || '';
  }
  function captchaReset(widgetId) { if (widgetId != null && window.turnstile) window.turnstile.reset(widgetId); }

  /* ---------- نموذج طلب الخدمات ---------- */
  function initLeadForm() {
    var form = $('#lead-form');
    if (!form) return;
    var alertEl = $('#lead-alert');
    var widget = null;
    initCaptcha($('#lead-captcha')).then(function (id) { widget = id; });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var data = formData(form);
      var errs = {};
      if (!data.name) errs.name = 'اكتب اسمك.';
      if (!/^0?5\d{8}$/.test(data.phone.replace(/\s/g, ''))) errs.phone = 'رقم جوال سعودي غير صحيح.';
      markFields(form, errs);
      if (Object.keys(errs).length) return;
      data.captcha_token = captchaToken(widget);
      data.website = form.elements.website ? form.elements.website.value : ''; // honeypot
      var btn = $('button[type=submit]', form);
      busy(btn, true);
      api('/leads', { method: 'POST', body: data }).then(function () {
        form.reset();
        showAlert(alertEl, 'وصلنا طلبك. سنتواصل معك خلال يوم عمل.', 'ok');
      }).catch(function (e) {
        markFields(form, e.fields);
        showAlert(alertEl, e.message);
        captchaReset(widget);
      }).then(function () { busy(btn, false); });
    });
  }

  /* ---------- التسجيل ---------- */
  var SUB_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
  function initSignup() {
    var form = $('#signup-form');
    if (!form) return;
    var alertEl = $('#signup-alert');
    var subInput = form.elements.subdomain;
    var preview = $('#sub-preview');
    var subStatus = $('#sub-status');
    var widget = null;
    var checkTimer = null;
    var lastChecked = { name: '', ok: false };

    var plan = qs('plan');
    var subscribe = qs('subscribe') === '1';
    if (plan) form.elements.plan.value = plan;
    if (subscribe) {
      form.elements.intent.value = 'subscribe';
      form.elements.cycle.value = qs('cycle') === 'monthly' ? 'monthly' : 'yearly';
      var t = $('#signup-title'); if (t) t.textContent = 'أنشئ حسابك للاشتراك';
      var l = $('#signup-lead'); if (l) l.textContent = 'نجهّز بيئة شركتك أولًا، ثم ننقلك مباشرة لإتمام الدفع.';
      var b = $('button[type=submit]', form); if (b) b.textContent = 'أنشئ حسابي وتابع للدفع';
    }

    initCaptcha($('#signup-captcha')).then(function (id) { widget = id; });

    function normalize(v) { return v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30); }
    subInput.addEventListener('input', function () {
      var v = normalize(subInput.value);
      if (v !== subInput.value) subInput.value = v;
      preview.textContent = 'https://' + (v || 'yourcompany') + '.' + (CFG.TENANT_DOMAIN || 'tijaracrm.com');
      subStatus.textContent = ''; subStatus.className = 'sub-status';
      clearTimeout(checkTimer);
      if (!v) return;
      if (!SUB_RE.test(v)) { subStatus.textContent = MESSAGES.subdomain_invalid; subStatus.className = 'sub-status bad'; return; }
      checkTimer = setTimeout(function () {
        subStatus.textContent = 'جارٍ التحقق من التوفر…';
        api('/subdomains/check?name=' + encodeURIComponent(v)).then(function (d) {
          if (normalize(subInput.value) !== v) return;
          lastChecked = { name: v, ok: !!(d && d.available) };
          if (lastChecked.ok) { subStatus.textContent = 'الرابط متاح'; subStatus.className = 'sub-status ok'; }
          else { subStatus.textContent = MESSAGES[(d && d.reason) || 'subdomain_taken'] || MESSAGES.subdomain_taken; subStatus.className = 'sub-status bad'; }
        }).catch(function () { subStatus.textContent = ''; });
      }, 450);
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      showAlert(alertEl, '');
      var d = formData(form);
      d.phone = d.phone.replace(/\s/g, '').replace(/^0/, '');
      var errs = {};
      if (d.full_name.length < 3) errs.full_name = 'اكتب الاسم الكامل.';
      if (!/^5\d{8}$/.test(d.phone)) errs.phone = 'أدخل رقم جوال سعودي يبدأ بـ 5 (9 أرقام).';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errs.email = 'بريد إلكتروني غير صحيح.';
      if (d.company_name.length < 2) errs.company_name = 'اكتب اسم الشركة.';
      if (!SUB_RE.test(d.subdomain)) errs.subdomain = MESSAGES.subdomain_invalid;
      else if (lastChecked.name === d.subdomain && !lastChecked.ok) errs.subdomain = MESSAGES.subdomain_taken;
      if (!d.accept_terms) errs.accept_terms = 'يجب الموافقة على الشروط للمتابعة.';
      markFields(form, errs);
      if (Object.keys(errs).length) { showAlert(alertEl, MESSAGES.validation); return; }

      d.phone = '+966' + d.phone;
      d.captcha_token = captchaToken(widget);
      if (CFG.TURNSTILE_SITE_KEY && !d.captcha_token) { showAlert(alertEl, 'أكمل التحقق من أنك لست روبوتًا.'); return; }

      var btn = $('button[type=submit]', form);
      busy(btn, true, 'جارٍ إنشاء الحساب…');
      api('/signup', { method: 'POST', body: d }).then(function (res) {
        store('signup', { id: res.signup_id, email: d.email, intent: d.intent, plan: d.plan, cycle: d.cycle });
        location.href = '/verify.html?id=' + encodeURIComponent(res.signup_id);
      }).catch(function (e) {
        markFields(form, e.fields);
        showAlert(alertEl, e.message);
        captchaReset(widget);
        busy(btn, false);
      });
    });
  }

  /* ---------- التحقق بالرمز ---------- */
  function initVerify() {
    var form = $('#verify-form');
    if (!form) return;
    var id = qs('id');
    var saved = store('signup') || {};
    var alertEl = $('#verify-alert');
    if (!id) { showAlert(alertEl, 'رابط غير مكتمل. ابدأ التسجيل من جديد.'); form.hidden = true; return; }
    var emailEl = $('#verify-email'); if (emailEl && saved.email) emailEl.textContent = saved.email;

    var boxes = $all('.otp input', form);
    boxes.forEach(function (box, i) {
      box.addEventListener('input', function () {
        box.value = box.value.replace(/\D/g, '');
        if (box.value.length > 1) { // لصق الرمز كاملًا
          var digits = box.value.split('');
          boxes.forEach(function (b, j) { b.value = digits[j - i] !== undefined && j >= i ? digits[j - i] : b.value; });
          boxes[Math.min(boxes.length - 1, i + digits.length - 1)].focus();
        } else if (box.value && boxes[i + 1]) boxes[i + 1].focus();
        if (boxes.every(function (b) { return b.value; })) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit'));
      });
      box.addEventListener('keydown', function (ev) {
        if (ev.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
      });
    });
    boxes[0].focus();

    var submitting = false;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (submitting) return;
      var code = boxes.map(function (b) { return b.value; }).join('');
      if (code.length !== boxes.length) { showAlert(alertEl, 'أدخل الرمز كاملًا.'); return; }
      submitting = true;
      var btn = $('button[type=submit]', form);
      busy(btn, true, 'جارٍ التحقق…');
      api('/signup/verify', { method: 'POST', body: { signup_id: id, code: code } }).then(function () {
        location.href = '/setup.html?id=' + encodeURIComponent(id);
      }).catch(function (e) {
        showAlert(alertEl, e.message);
        boxes.forEach(function (b) { b.value = ''; });
        boxes[0].focus();
        busy(btn, false); submitting = false;
      });
    });

    var resend = $('#resend');
    var wait = 60, timer = null;
    function tick() {
      if (wait <= 0) { resend.disabled = false; resend.textContent = 'أعد إرسال الرمز'; clearInterval(timer); return; }
      resend.disabled = true; resend.textContent = 'إعادة الإرسال بعد ' + wait + ' ثانية'; wait--;
    }
    if (resend) {
      tick(); timer = setInterval(tick, 1000);
      resend.addEventListener('click', function () {
        api('/signup/resend', { method: 'POST', body: { signup_id: id } }).then(function () {
          showAlert(alertEl, 'أرسلنا رمزًا جديدًا إلى بريدك.', 'ok');
          wait = 60; tick(); timer = setInterval(tick, 1000);
        }).catch(function (e) { showAlert(alertEl, e.message); });
      });
    }
  }

  /* ---------- حالة التجهيز ---------- */
  function initSetup() {
    var list = $('#setup-progress');
    if (!list) return;
    var id = qs('id');
    var alertEl = $('#setup-alert');
    var done = $('#setup-done');
    var order = ['verified', 'provisioning', 'active'];
    var tries = 0;
    if (!id) { showAlert(alertEl, 'رابط غير مكتمل.'); return; }

    function paint(status) {
      var idx = order.indexOf(status);
      $all('li', list).forEach(function (li, i) {
        li.className = i < idx || status === 'active' ? 'done' : (i === idx ? 'active' : '');
        var dot = $('.dot', li);
        dot.innerHTML = li.className === 'done' ? '<svg class="icon" width="16" height="16" viewBox="0 0 24 24" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>' : '';
      });
    }
    function poll() {
      api('/signup/' + encodeURIComponent(id) + '/status').then(function (d) {
        paint(d.status);
        if (d.status === 'active') {
          var saved = store('signup') || {};
          if (saved.intent === 'subscribe' && d.checkout_token) {
            location.href = '/checkout.html?token=' + encodeURIComponent(d.checkout_token) + '&plan=' + encodeURIComponent(saved.plan || 'pro') + '&cycle=' + encodeURIComponent(saved.cycle || 'yearly');
            return;
          }
          var link = $('#tenant-link');
          link.href = d.tenant_url; link.textContent = 'ادخل إلى نظامك';
          $('#tenant-url').textContent = d.tenant_url.replace(/^https?:\/\//, '');
          if (d.trial_ends_at) $('#trial-end').textContent = new Date(d.trial_ends_at).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' });
          done.hidden = false;
          return;
        }
        if (d.status === 'failed') {
          showAlert(alertEl, 'تأخر تجهيز بيئتك. فريقنا تلقى تنبيهًا وسيتواصل معك قريبًا عبر البريد.');
          return;
        }
        tries++;
        setTimeout(poll, tries < 30 ? 3000 : 10000);
      }).catch(function (e) {
        tries++;
        if (tries > 5) showAlert(alertEl, e.message);
        setTimeout(poll, 5000);
      });
    }
    poll();
  }

  /* ---------- الدفع (Moyasar) ---------- */
  function loadMoyasar() {
    return new Promise(function (resolve, reject) {
      if (window.Moyasar) return resolve();
      var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = CFG.MOYASAR_CSS; document.head.appendChild(css);
      var s = document.createElement('script'); s.src = CFG.MOYASAR_JS; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  function initCheckout() {
    var root = $('#checkout');
    if (!root) return;
    var token = qs('token');
    var alertEl = $('#checkout-alert');
    var state = { plan: qs('plan') || 'pro', cycle: qs('cycle') === 'monthly' ? 'monthly' : 'yearly' };
    var plans = [];

    if (!token) {
      $('#checkout-noaccount').hidden = false;
      root.hidden = true;
      return;
    }

    var planHolder = $('#checkout-plans');
    var cycleBtns = $all('[data-cycle]', root);

    function current() { return plans.filter(function (p) { return p.code === state.plan; })[0] || plans[0]; }
    function render() {
      var p = current(); state.plan = p.code;
      planHolder.innerHTML = plans.filter(function (x) { return x.code !== 'enterprise' || x.self_serve; }).map(function (x) {
        return '<button type="button" class="choice" data-plan="' + esc(x.code) + '" aria-pressed="' + (x.code === state.plan) + '">' +
          '<strong>' + esc(x.name) + '</strong><span>' + esc(x.short || x.description || '') + '</span>' +
          '<em>' + money(planPrice(x, state.cycle)) + ' ر.س / ' + cycleWord(state.cycle) + '</em></button>';
      }).join('');
      var sub = planPrice(p, state.cycle);
      var vat = Math.round(sub * VAT * 100) / 100;
      $('#sum-label').textContent = 'الباقة ' + p.name + ' · ' + (state.cycle === 'yearly' ? 'سنوي' : 'شهري');
      $('#sum-sub').textContent = money(sub, 2) + ' ر.س';
      $('#sum-vat').textContent = money(vat, 2) + ' ر.س';
      $('#sum-total').textContent = money(sub + vat, 2) + ' ر.س';
      $('#sum-renew').textContent = 'يتجدد الاشتراك ' + (state.cycle === 'yearly' ? 'سنويًا' : 'شهريًا') + '، ويمكنك الإلغاء في أي وقت قبل التجديد.';
      cycleBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.cycle === state.cycle)); });
    }
    planHolder.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-plan]'); if (!b) return;
      state.plan = b.dataset.plan; render();
    });
    cycleBtns.forEach(function (b) { b.addEventListener('click', function () { state.cycle = b.dataset.cycle; render(); }); });

    // بيانات الحساب المرتبطة بالرابط (اسم المنشأة، البريد…)
    api('/checkout/context?token=' + encodeURIComponent(token)).then(function (ctx) {
      var f = $('#billing-form');
      if (ctx.company_name) f.elements.company_name.value = ctx.company_name;
      if (ctx.billing_email) f.elements.billing_email.value = ctx.billing_email;
      if (ctx.vat_number) f.elements.vat_number.value = ctx.vat_number;
      if (ctx.city) f.elements.city.value = ctx.city;
      var acc = $('#checkout-account'); if (acc && ctx.tenant_url) acc.textContent = ctx.tenant_url.replace(/^https?:\/\//, '');
    }).catch(function (e) {
      showAlert(alertEl, e.message);
      if (e.code === 'invalid_token') { $('#pay-btn').disabled = true; }
    });

    loadPlans().then(function (p) { plans = p; render(); });

    var payBtn = $('#pay-btn');
    payBtn.addEventListener('click', function () {
      showAlert(alertEl, '');
      var f = $('#billing-form');
      var b = formData(f);
      var errs = {};
      if (b.company_name.length < 2) errs.company_name = 'اكتب اسم المنشأة.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.billing_email)) errs.billing_email = 'بريد غير صحيح.';
      if (b.vat_number && !/^3\d{13}3$/.test(b.vat_number)) errs.vat_number = 'الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3.';
      markFields(f, errs);
      if (Object.keys(errs).length) { showAlert(alertEl, MESSAGES.validation); return; }

      busy(payBtn, true, 'جارٍ تجهيز الدفع…');
      api('/checkout', { method: 'POST', body: { token: token, plan: state.plan, cycle: state.cycle, billing: b } })
        .then(function (session) {
          // السيرفر هو مصدر المبلغ والمفتاح العام — لا نعتمد على حساب المتصفح
          return loadMoyasar().then(function () { mountMoyasar(session); });
        })
        .catch(function (e) { showAlert(alertEl, e.message); busy(payBtn, false); });
    });

    function mountMoyasar(s) {
      $('#pay-step-1').hidden = true;
      $('#pay-step-2').hidden = false;
      payBtn.hidden = true;
      $('#pay-total-final').textContent = money(s.amount / 100, 2) + ' ر.س';
      var opts = {
        element: '.mysr-form',
        amount: s.amount,                       // بالهللات، من السيرفر
        currency: 'SAR',
        description: s.description,
        publishable_api_key: s.publishable_key,
        callback_url: s.callback_url,           // /payment-result.html?checkout=<id>
        methods: s.methods || ['creditcard', 'applepay', 'stcpay'],
        supported_networks: ['mada', 'visa', 'mastercard'],
        metadata: s.metadata || {},
        language: 'ar',
        on_completed: function (payment) {
          // نُبلغ السيرفر بمعرّف الدفعة قبل التحويل، والسيرفر يتحقق منها لاحقًا من Moyasar مباشرة
          return api('/checkout/' + encodeURIComponent(s.checkout_id) + '/attach', { method: 'POST', body: { payment_id: payment.id } });
        }
      };
      if (s.save_card) opts.credit_card = { save_card: true };
      if (s.apple_pay) opts.apple_pay = s.apple_pay;
      window.Moyasar.init(opts);
    }
    var back = $('#pay-back');
    if (back) back.addEventListener('click', function () { $('#pay-step-2').hidden = true; $('#pay-step-1').hidden = false; payBtn.hidden = false; $('.mysr-form').innerHTML = ''; busy(payBtn, false); });
  }

  /* ---------- نتيجة الدفع ---------- */
  function initPaymentResult() {
    var box = $('#result');
    if (!box) return;
    var checkout = qs('checkout');
    var paymentId = qs('id');
    var title = $('#result-title'), text = $('#result-text'), action = $('#result-action');
    if (!checkout || !paymentId) { title.textContent = 'رابط غير مكتمل'; text.textContent = MESSAGES.unknown; return; }
    var tries = 0;
    function confirm() {
      api('/checkout/confirm', { method: 'POST', body: { checkout_id: checkout, payment_id: paymentId } }).then(function (d) {
        if (d.status === 'paid') {
          title.textContent = 'تم الاشتراك بنجاح';
          text.textContent = 'شكرًا لك. فعّلنا باقتك، وأرسلنا الفاتورة الضريبية إلى بريدك.';
          action.href = d.tenant_url; action.textContent = 'ادخل إلى نظامك'; action.hidden = false;
          box.dataset.state = 'ok';
        } else if (d.status === 'pending' && tries < 10) {
          tries++; setTimeout(confirm, 3000);
        } else {
          title.textContent = 'لم تكتمل عملية الدفع';
          text.textContent = d.message || MESSAGES.payment_failed;
          if (d.retry_url) { action.href = d.retry_url; action.textContent = 'حاول مرة أخرى'; action.hidden = false; }
          box.dataset.state = 'bad';
        }
      }).catch(function (e) {
        title.textContent = 'تعذّر تأكيد الدفع';
        text.textContent = e.message + ' إن خُصم المبلغ فسيُفعَّل اشتراكك تلقائيًا خلال دقائق.';
        box.dataset.state = 'bad';
      });
    }
    confirm();
  }

  /* ---------- روابط عامة ---------- */
  function initLinks() {
    $all('[data-portal]').forEach(function (a) { a.href = CFG.PORTAL_URL || '#'; });
    $all('[data-sales-email]').forEach(function (a) { a.href = 'mailto:' + CFG.SALES_EMAIL; a.textContent = CFG.SALES_EMAIL; });
    $all('[data-whatsapp]').forEach(function (a) {
      if (!CFG.WHATSAPP) { a.closest('[data-whatsapp-wrap]') && (a.closest('[data-whatsapp-wrap]').hidden = true); return; }
      a.href = 'https://wa.me/' + CFG.WHATSAPP; a.textContent = '+' + CFG.WHATSAPP;
    });
    var y = $('#year'); if (y) y.textContent = new Date().getFullYear();
    // "اطلب عرض سعر" يختار الخدمة تلقائيًا في نموذج التواصل
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-service]');
      if (a) { var s = $('#lead-service'); if (s) s.value = a.dataset.service; }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initHeader(); initLinks(); initPricing(); initLeadForm();
    initSignup(); initVerify(); initSetup(); initCheckout(); initPaymentResult();
  });
})();
