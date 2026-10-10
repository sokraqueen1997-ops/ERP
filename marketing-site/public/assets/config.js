/*
 * إعدادات الموقع القابلة للتعديل على السيرفر بدون إعادة بناء.
 * لا تضع هنا أي مفتاح سري — هذا الملف عام ويُرسل للمتصفح.
 * مفتاح Moyasar العام (publishable) يأتي من الـ API عند إنشاء جلسة الدفع، وليس من هنا.
 */
window.TC_CONFIG = {
  // مسار الـ API العام (نفس النطاق عبر Nginx)
  API_BASE: '/api/public',

  // رابط دخول نظام الشركة بعد النقل
  PORTAL_URL: 'https://portal.tijaracrm.com',

  // النطاق الأساسي لبيئات العملاء
  TENANT_DOMAIN: 'tijaracrm.com',

  // Cloudflare Turnstile — المفتاح العام (site key). اتركه فارغًا لتعطيل CAPTCHA أثناء التطوير.
  TURNSTILE_SITE_KEY: '',

  // نموذج Moyasar — تحقّق من آخر إصدار في https://docs.moyasar.com قبل الإطلاق
  MOYASAR_JS: 'https://cdn.moyasar.com/mpf/1.14.0/moyasar.js',
  MOYASAR_CSS: 'https://cdn.moyasar.com/mpf/1.14.0/moyasar.css',

  // ضريبة القيمة المضافة
  VAT_RATE: 0.15,

  // بيانات التواصل المعروضة (استبدلها)
  WHATSAPP: '',            // مثال: 9665XXXXXXXX
  SALES_EMAIL: 'sales@tijaracrm.com'
};
