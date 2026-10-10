/* يُحمَّل في <head> قبل أي شيء: يحدد اللغة ويضبط الاتجاه قبل الرسم لتجنب الوميض.
   الأولوية: ?lang= في الرابط، ثم الاختيار المحفوظ، ثم العربية. */
(function () {
  var lang = 'ar';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'ar') { lang = q; localStorage.setItem('tc:lang', q); }
    else { var s = localStorage.getItem('tc:lang'); if (s === 'en' || s === 'ar') lang = s; }
  } catch (e) {}
  var root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'en' ? 'ltr' : 'rtl';
  if (lang === 'en') root.classList.add('i18n-pending');
  window.TC_LANG = lang;
})();
