# عقد الـ API العام للموقع التسويقي

الواجهة في `public/` جاهزة وتستدعي هذه النقاط فقط. على الـ backend تنفيذها **بالضبط** بهذه الأشكال.

- **المسار الأساسي:** `/api/public` على نفس نطاق الموقع (`tijaracrm.com`) عبر Nginx، فلا حاجة لـ CORS.
- **معزول عن APIs الـ tenants:** لا يقبل أي token خاص بالـ tenant.
- **صيغة البيانات:** كل الطلبات والردود JSON.
- **اللغة:** كل طلب يحمل `Accept-Language: ar` أو `en`. استخدمها لاختيار لغة رسائل الخطأ (`message`)، وقوالب البريد (رمز التحقق والترحيب والتذكير والفاتورة)، ونصوص الباقات في `GET /plans`. إن لم تُرسل الباقات بالإنجليزية، تترجم الواجهة الأسماء المعروفة من قاموسها.
- **صيغة الخطأ الموحدة:**

```json
{ "error": { "code": "subdomain_taken", "message": "نص اختياري للمستخدم", "fields": { "subdomain": "سبب الخطأ في الحقل" } } }
```

**أكواد الأخطاء التي تفهمها الواجهة:**

| المجموعة | الأكواد |
|---|---|
| عامة | `validation` (400)، `rate_limited` (429)، `unknown` |
| التسجيل | `captcha_failed`، `email_taken`، `subdomain_taken`، `subdomain_invalid`، `subdomain_reserved` |
| رمز التحقق | `invalid_code`، `code_expired`، `too_many_attempts` |
| الدفع | `invalid_token`، `payment_failed` |

إن أُرسل `message` يُعرض كما هو، وإلا تعرض الواجهة نصًا عربيًا جاهزًا للكود.

---

## الباقات

### `GET /plans`

من جدول `plans` (الحالة `active` فقط، مرتبة حسب `sort_order`).

```json
{ "plans": [
  { "code": "basic", "name": "الأساسية", "description": "لمحل واحد يبدأ رحلته الرقمية", "short": "مستخدمان · فرع واحد",
    "users": "٢", "branches": "١", "einvoice": "مشمولة",
    "monthly_price": 199, "yearly_price": 1990, "highlight": false, "self_serve": true,
    "features": ["مستخدمان", "فرع واحد ومستودع واحد", "..."] }
] }
```

- **الأسعار:** بالريال وقبل الضريبة.
- **`self_serve: false`:** يخفي الباقة من صفحة الدفع (المؤسسات عبر المبيعات).
- **التخزين المؤقت:** `Cache-Control: public, max-age=300`.
- **عند فشل الطلب:** تستخدم الواجهة أسعارًا احتياطية مطابقة للقيم المقترحة (199 / 399 / 799).

---

## التسجيل والتجربة المجانية

### `GET /subdomains/check?name=acme`

```json
{ "available": true }
{ "available": false, "reason": "subdomain_taken" | "subdomain_reserved" | "subdomain_invalid" }
```

- **الصيغة المقبولة:** `^[a-z]([a-z0-9-]{1,28}[a-z0-9])$` (تبدأ بحرف، ولا تنتهي بشرطة). هذه الصيغة أضيق من فحص `provision-tenant.sh` (`^[a-z][a-z0-9-]{1,29}$`)، فكل رابط يقبله الموقع يقبله السكربت.
- **قائمة الأسماء المحجوزة:** على الأقل `www, portal, admin, api, app, mail, smtp, ftp, ns1, ns2, status, docs, help, support, billing, pay, static, cdn, dev, staging, test, demo, tijara, tijaracrm`، إضافة إلى كل subdomain مستخدم حاليًا.
- **Rate limit:** حوالي 30 طلبًا في الدقيقة لكل IP.

### `POST /signup`

```json
{ "full_name": "…", "phone": "+9665XXXXXXXX", "email": "…", "company_name": "…",
  "business_type": "retail|wholesale|distributor|contractor|other",
  "subdomain": "acme", "plan": "pro", "intent": "trial|subscribe", "cycle": "monthly|yearly",
  "accept_terms": true, "captcha_token": "…", "website": "" }
```

**التحقق على السيرفر (لا تثق بالواجهة):**
- `website` حقل فخ للروبوتات (honeypot): إن جاء غير فارغ، أرجِع 200 بـ `signup_id` وهمي ولا تفعل شيئًا.
- تحقق من Turnstile عبر `https://challenges.cloudflare.com/turnstile/v0/siteverify` بالـ secret من `.env`. تجاوز هذا الفحص فقط إن كان `TURNSTILE_SECRET` فارغًا في بيئة التطوير.
- تحقق من صيغة كل حقل، وأعد فحص الـ subdomain (الصيغة، الحجز، عدم التكرار) داخل transaction مع unique index.
- البريد: إن كان لديه tenant فعّال ← `email_taken`. إن كان لديه signup سابق غير مؤكد ← أعد استخدامه وأرسل رمزًا جديدًا.
- **Rate limit:** 5 تسجيلات في الساعة لكل IP، و3 لكل بريد في اليوم.

**الإجراءات:**
- أنشئ سجلًا في `signups` بالحالة `pending_verification`.
- ولّد OTP من 6 أرقام، واحفظه مُجزّأً (hash) مع انتهاء صلاحية بعد 10 دقائق.
- أرسله عبر Resend بقالب عربي.

```json
201 { "signup_id": "sgn_…" }
```

**ملاحظة:** `signup_id` معرّف عشوائي غير قابل للتخمين (ULID أو UUID مع prefix)، وليس رقمًا تسلسليًا.

### `POST /signup/verify`

```json
{ "signup_id": "sgn_…", "code": "123456" }
```

- **الحماية:** 5 محاولات خاطئة كحد أقصى للرمز، ثم `too_many_attempts`.
- **عند النجاح:**
  - تصبح الحالة `verified`.
  - يُنشأ job في `provisioning_jobs`.
  - يُرد بـ `200 { "ok": true }`.
- **التكرار (idempotent):** طلب ثانٍ بعد النجاح يُرجع `ok` أيضًا.

### `POST /signup/resend`

```json
{ "signup_id": "sgn_…" }
```

- **الحدود:** مرة كل 60 ثانية، و5 مرات كحد أقصى لكل signup.
- **النتيجة:** يُبطل الرمز القديم.

### `GET /signup/:id/status`

```json
{ "status": "pending_verification|verified|provisioning|active|failed",
  "tenant_url": "https://acme.tijaracrm.com",
  "trial_ends_at": "2026-10-17T12:00:00Z",
  "checkout_token": "…" }
```

- **`tenant_url` و`trial_ends_at`:** فقط عند `active`.
- **`checkout_token`:** فقط عند `active` و`intent = subscribe`.
- **ما لا يُرجع أبدًا:** البريد أو أي بيانات شخصية، فهذا الرابط قد يُشارك.

---

## طلبات الخدمات

### `POST /leads`

```json
{ "name": "…", "phone": "05…", "service": "mobile_app|website|ecommerce|custom|erp_enterprise",
  "details": "…", "captcha_token": "…", "website": "" }
```

- **التخزين:** في جدول `service_leads`.
- **الإشعار:** بريد Resend إلى `LEADS_NOTIFY_EMAIL`.
- **Rate limit:** 5 في الساعة لكل IP، مع نفس معالجة حقل الفخ.
- **الرد:** `201 { "ok": true }`

---

## الاشتراك والدفع (Moyasar)

### رابط الاشتراك `token`

- **طبيعته:** token موقّع (HMAC أو JWT بمفتاح `CHECKOUT_TOKEN_SECRET`)، صالح 7 أيام، ويحمل `tenant_id` فقط.
- **مصادره:**
  - `GET /signup/:id/status` عند `intent = subscribe`.
  - روابط بريد التذكير قبل وعند انتهاء التجربة.
  - زر «اشترك الآن» داخل النظام نفسه.

### `GET /checkout/context?token=…`

```json
{ "tenant_url": "https://acme.tijaracrm.com", "company_name": "…", "billing_email": "…", "vat_number": "", "city": "",
  "current_plan": "pro", "status": "trial|active|expired" }
```

- **عند token غير صالح:** `401 invalid_token`.

### `POST /checkout`

```json
{ "token": "…", "plan": "pro", "cycle": "yearly",
  "billing": { "company_name": "…", "billing_email": "…", "vat_number": "3…3", "city": "…" } }
```

**على السيرفر:**
- تحقق من الـ token والباقة (`self_serve = true`).
- **احسب المبلغ بنفسك من جدول `plans`.** لا يُرسل المبلغ من الواجهة أصلًا.
- `amount_halalas = round((price) * 1.15 * 100)`
- احفظ بيانات الفوترة على الـ tenant.
- أنشئ سجلًا في `checkouts` بالحالة `pending`: `id`، `tenant_id`، `plan`، `cycle`، `amount`، `expires_at` = ساعة واحدة.

```json
201 {
  "checkout_id": "chk_…",
  "amount": 458850,
  "description": "اشتراك تجارة ERP — الاحترافية (سنوي) — acme",
  "publishable_key": "pk_test_…",
  "callback_url": "https://tijaracrm.com/payment-result.html?checkout=chk_…",
  "methods": ["creditcard", "applepay", "stcpay"],
  "metadata": { "checkout_id": "chk_…", "tenant_id": "…", "plan": "pro", "cycle": "yearly" },
  "save_card": true,
  "apple_pay": { "country": "SA", "label": "تجارة ERP", "validate_merchant_url": "https://api.moyasar.com/v1/applepay/initiate" }
}
```

- **قبل الإطلاق:** راجع وثائق Moyasar الحالية للأسماء الدقيقة لخيارات `Moyasar.init`، مثل `save_card` (حفظ البطاقة للتجديد) وإعداد Apple Pay، وطابِق `app.js` (الدالة `mountMoyasar`) إن اختلفت.
- **Apple Pay:** يتطلب التحقق من النطاق `tijaracrm.com` في لوحة Moyasar، بما في ذلك ملف `/.well-known/apple-developer-merchantid-domain-association`.

### `POST /checkout/:checkout_id/attach`

```json
{ "payment_id": "…" }
```

- **وظيفته:** تسجيل معرّف الدفعة على الـ checkout فقط، دون تفعيل أي شيء.
- **الرد:** `200 { "ok": true }`

### `POST /checkout/confirm`

```json
{ "checkout_id": "chk_…", "payment_id": "…" }
```

**يستدعيه المتصفح بعد الرجوع من Moyasar. على السيرفر:**
1. اجلب `GET https://api.moyasar.com/v1/payments/{payment_id}` بالـ **secret key** (Basic auth).
2. تحقق أن: `status === "paid"`، و`amount === checkout.amount`، و`currency === "SAR"`، و`metadata.checkout_id === checkout_id`.
3. في transaction واحدة وبشكل idempotent:
   - الـ checkout ← `paid`.
   - سجل في `payments`.
   - إنشاء أو تمديد `subscriptions` (`current_period_end` من نهاية الفترة الحالية أو من الآن، أيهما أبعد).
   - إعادة تفعيل الـ tenant إن كان موقوفًا.
   - حفظ token البطاقة إن وُجد، للتجديد.
4. أصدر الفاتورة الضريبية وأرسلها بالبريد. ضعها في طابور، ولا تجعلها تُعطّل الرد.

**الردود:**

```json
{ "status": "paid", "tenant_url": "https://acme.tijaracrm.com" }
{ "status": "pending" }
{ "status": "failed", "message": "سبب الرفض من Moyasar إن وُجد", "retry_url": "/checkout.html?token=…&plan=pro&cycle=yearly" }
```

### `POST /webhooks/moyasar`

(تستدعيه Moyasar، وليس الواجهة.)

- **التحقق:** قارن `secret_token` في جسم الطلب بـ `MOYASAR_WEBHOOK_SECRET` باستخدام مقارنة آمنة زمنيًا (timing-safe).
- **المعالجة:** نفس منطق `confirm`، مع جلب الدفعة من API Moyasar وعدم الاعتماد على جسم الـ webhook. هذا يغطي حالة إغلاق المستخدم للمتصفح قبل الرجوع.

---

## متغيرات البيئة المطلوبة (`.env` على السيرفر فقط)

```
MOYASAR_PUBLISHABLE_KEY=
MOYASAR_SECRET_KEY=
MOYASAR_WEBHOOK_SECRET=
TURNSTILE_SECRET=
CHECKOUT_TOKEN_SECRET=
LEADS_NOTIFY_EMAIL=
VAT_RATE=0.15
TRIAL_DAYS=7
TRIAL_DATA_RETENTION_DAYS=
RENEWAL_GRACE_DAYS=
```

**المفتاح العام لـ Turnstile:** يوضع في `public/assets/config.js` (`TURNSTILE_SITE_KEY`)، وليس في `.env`.
