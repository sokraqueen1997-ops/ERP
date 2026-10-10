# نشر الموقع التسويقي على السيرفر

**الشرط المسبق:** إكمال المرحلة 1، أي أن نظام الشركة يعمل على `portal.tijaracrm.com`.

**تنبيه:** لا تحوّل النطاق الرئيسي قبل أن تعمل نقاط `/api/public` (تفاصيلها في `API.md`). بدونها يعمل الموقع للعرض فقط، أما التسجيل والدفع فيظهران رسالة خطأ.

## 1. نسخ الملفات

```bash
pwd && hostname        # يجب أن يكون vps-40807f31
sudo mkdir -p /var/www/marketing-site
cd /home/ubuntu && git clone git@github.com:sokraqueen1997-ops/erp.git erp-repo   # أو git pull إن كان موجودًا
sudo rsync -a --delete /home/ubuntu/erp-repo/marketing-site/public/ /var/www/marketing-site/public/
```

## 2. الإعدادات

عدّل `/var/www/marketing-site/public/assets/config.js`:
- `TURNSTILE_SITE_KEY`: المفتاح العام من Cloudflare Turnstile، مع ربطه بالنطاق `tijaracrm.com`.
- `WHATSAPP`: رقم الواتساب.
- `MOYASAR_JS` و`MOYASAR_CSS`: تأكد من آخر إصدار في وثائق Moyasar.

## 3. Nginx

```bash
sudo cp /etc/nginx/sites-available/<ملف tijaracrm الحالي> ~/nginx-backup-$(date +%F).conf
echo 'limit_req_zone $binary_remote_addr zone=public_api:10m rate=10r/s;' | sudo tee /etc/nginx/conf.d/rate-limit.conf
sudo cp /home/ubuntu/erp-repo/marketing-site/deploy/nginx-tijaracrm.conf /etc/nginx/sites-available/tijaracrm-marketing.conf
```

- عدّل `__PUBLIC_API_UPSTREAM__` ومسارات الشهادة في الملف.
- احذف `server_name tijaracrm.com` من إعداد النظام القديم، فقد أصبح على portal.

```bash
sudo ln -s /etc/nginx/sites-available/tijaracrm-marketing.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**التراجع:** أعد النسخة الاحتياطية، واحذف الرابط من `sites-enabled`، ثم نفّذ `nginx -t` و`reload`.

## 4. الفحص بعد النشر

1. افتح `https://tijaracrm.com` على الجوال والكمبيوتر.
2. تأكد أن الأسعار تأتي من `/api/public/plans`: غيّر سعرًا في قاعدة البيانات وحدّث الصفحة.
3. سجّل تجربة حقيقية ببريدك، وأكمل حتى الدخول إلى النظام الجديد.
4. ادفع بمفاتيح الاختبار باستخدام بطاقات Moyasar التجريبية، ثم تأكد من:
   - تفعيل الاشتراك.
   - وصول الفاتورة.
   - وصول الـ webhook.
5. راقب ترويسة `Content-Security-Policy-Report-Only` في console المتصفح أثناء الدفع بكل الوسائل. إن لم تظهر مخالفات، غيّرها إلى `Content-Security-Policy`.
6. تأكد أن `portal.tijaracrm.com` والعواد وodai-magdi تعمل.
