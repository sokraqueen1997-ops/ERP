#!/usr/bin/env node
/*
 * خادم تطوير محلي: يخدم public/ ويحاكي /api/public بالكامل حسب API.md
 * للتجربة فقط — لا يُستخدم في الإنتاج. لا يحتاج أي مكتبات.
 *   node dev/mock-api.js            ثم افتح http://localhost:8090
 * رمز التحقق في المحاكاة دائمًا: 123456
 * subdomains محجوزة/مأخوذة للتجربة: www, portal, admin, api, alawwad, odai-magdi
 * الدفع: صفحة الدفع تتخطى Moyasar وتحاكي الرجوع بدفعة ناجحة (أو فاشلة إن كانت الباقة basic).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml' };

const PLANS = [
  { code: 'basic', name: 'الأساسية', description: 'لمحل واحد يبدأ رحلته الرقمية', short: 'مستخدمان · فرع واحد', monthly_price: 199, yearly_price: 1990, highlight: false, self_serve: true, features: ['مستخدمان', 'فرع واحد ومستودع واحد', 'المبيعات ونقاط البيع', 'المخزون والمشتريات', 'الفاتورة الإلكترونية (ZATCA)'] },
  { code: 'pro', name: 'الاحترافية', description: 'لشركات الجملة ومورّدي المقاولين', short: '٨ مستخدمين · ٣ فروع', monthly_price: 399, yearly_price: 3990, highlight: true, self_serve: true, features: ['حتى ٨ مستخدمين', 'حتى ٣ فروع ومستودعات متعددة', 'كل مزايا الأساسية', 'عروض الأسعار والأسعار المتعددة', 'المحاسبة الكاملة والتقارير الذكية', 'إرسال عبر واتساب والبريد'] },
  { code: 'enterprise', name: 'المؤسسات', description: 'للموزعين والشركات متعددة الفروع', short: 'غير محدودة', monthly_price: 799, yearly_price: 7990, highlight: false, self_serve: false, features: ['مستخدمون وفروع غير محدودة', 'كل مزايا الاحترافية', 'واجهات API للربط', 'صلاحيات متقدمة حسب الفرع', 'مدير حساب ودعم أولوية'] }
];
const RESERVED = ['www', 'portal', 'admin', 'api', 'app', 'mail'];
const TAKEN = ['alawwad', 'odai-magdi'];
const SUB_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
const signups = new Map();
const checkouts = new Map();
const leads = [];

const id = (p) => p + '_' + crypto.randomBytes(8).toString('hex');
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function fail(res, status, code, fields) { send(res, status, { error: { code, fields } }); }
function readBody(req) { return new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); }); }
function subCheck(n) {
  if (!SUB_RE.test(n || '')) return 'subdomain_invalid';
  if (RESERVED.includes(n)) return 'subdomain_reserved';
  if (TAKEN.includes(n) || [...signups.values()].some((s) => s.subdomain === n)) return 'subdomain_taken';
  return null;
}

async function apiRoute(req, res, url) {
  const p = url.pathname.replace(/^\/api\/public/, '');
  const m = req.method;

  if (m === 'GET' && p === '/plans') return send(res, 200, { plans: PLANS });

  if (m === 'GET' && p === '/subdomains/check') {
    const r = subCheck(url.searchParams.get('name'));
    return send(res, 200, r ? { available: false, reason: r } : { available: true });
  }

  if (m === 'POST' && p === '/signup') {
    const b = await readBody(req);
    if (b.website) return send(res, 201, { signup_id: id('sgn') });
    const f = {};
    if (!b.full_name || b.full_name.length < 3) f.full_name = 'الاسم مطلوب';
    if (!/^\+9665\d{8}$/.test(b.phone || '')) f.phone = 'رقم غير صحيح';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email || '')) f.email = 'بريد غير صحيح';
    if (!b.accept_terms) f.accept_terms = 'مطلوب';
    const sc = subCheck(b.subdomain);
    if (sc) f.subdomain = { subdomain_invalid: 'صيغة غير صحيحة', subdomain_reserved: 'اسم محجوز', subdomain_taken: 'الرابط مستخدم' }[sc];
    if (Object.keys(f).length) return fail(res, 400, sc && Object.keys(f).length === 1 ? sc : 'validation', f);
    if (b.email === 'taken@example.com') return fail(res, 409, 'email_taken', { email: 'البريد مسجل' });
    const s = { id: id('sgn'), ...b, status: 'pending_verification', attempts: 0 };
    signups.set(s.id, s);
    console.log('[signup]', s.id, s.email, s.subdomain, '→ OTP 123456');
    return send(res, 201, { signup_id: s.id });
  }

  if (m === 'POST' && p === '/signup/verify') {
    const b = await readBody(req);
    const s = signups.get(b.signup_id);
    if (!s) return fail(res, 404, 'unknown');
    if (s.status !== 'pending_verification') return send(res, 200, { ok: true });
    if (++s.attempts > 5) return fail(res, 429, 'too_many_attempts');
    if (b.code !== '123456') return fail(res, 400, 'invalid_code');
    s.status = 'verified'; s.verifiedAt = Date.now();
    return send(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/signup/resend') {
    const b = await readBody(req);
    if (!signups.get(b.signup_id)) return fail(res, 404, 'unknown');
    return send(res, 200, { ok: true });
  }

  let mm = p.match(/^\/signup\/([^/]+)\/status$/);
  if (m === 'GET' && mm) {
    const s = signups.get(mm[1]);
    if (!s) return fail(res, 404, 'unknown');
    if (s.verifiedAt) { // محاكاة التجهيز: 3 ثوانٍ provisioning ثم active
      const t = Date.now() - s.verifiedAt;
      s.status = t < 2500 ? 'verified' : t < 6000 ? 'provisioning' : (s.subdomain === 'failme' ? 'failed' : 'active');
    }
    const out = { status: s.status };
    if (s.status === 'active') {
      out.tenant_url = 'https://' + s.subdomain + '.tijaracrm.com';
      out.trial_ends_at = new Date(s.verifiedAt + 7 * 864e5).toISOString();
      if (s.intent === 'subscribe') out.checkout_token = 'tok_' + s.id;
    }
    return send(res, 200, out);
  }

  if (m === 'POST' && p === '/leads') {
    const b = await readBody(req);
    if (!b.name || !b.phone) return fail(res, 400, 'validation', { name: !b.name ? 'مطلوب' : undefined });
    leads.push(b); console.log('[lead]', b.service, b.name);
    return send(res, 201, { ok: true });
  }

  const tokenTenant = (tok) => {
    if (tok === 'demo') return { subdomain: 'demo', company_name: 'شركة تجريبية للأدوات الصحية', email: 'owner@demo.sa' };
    const s = tok && tok.startsWith('tok_') && signups.get(tok.slice(4));
    return s ? { subdomain: s.subdomain, company_name: s.company_name, email: s.email } : null;
  };

  if (m === 'GET' && p === '/checkout/context') {
    const t = tokenTenant(url.searchParams.get('token'));
    if (!t) return fail(res, 401, 'invalid_token');
    return send(res, 200, { tenant_url: 'https://' + t.subdomain + '.tijaracrm.com', company_name: t.company_name, billing_email: t.email, status: 'trial' });
  }

  if (m === 'POST' && p === '/checkout') {
    const b = await readBody(req);
    const t = tokenTenant(b.token);
    if (!t) return fail(res, 401, 'invalid_token');
    const plan = PLANS.find((x) => x.code === b.plan && x.self_serve);
    if (!plan) return fail(res, 400, 'validation');
    const price = b.cycle === 'yearly' ? plan.yearly_price : plan.monthly_price;
    const c = { id: id('chk'), token: b.token, plan: plan.code, cycle: b.cycle, amount: Math.round(price * 1.15 * 100), tenant: t };
    checkouts.set(c.id, c);
    return send(res, 201, {
      checkout_id: c.id, amount: c.amount,
      description: 'اشتراك تجارة ERP — ' + plan.name + ' (' + (b.cycle === 'yearly' ? 'سنوي' : 'شهري') + ') — ' + t.subdomain,
      publishable_key: 'pk_test_MOCK', mock: true,
      callback_url: '/payment-result.html?checkout=' + c.id,
      metadata: { checkout_id: c.id, plan: plan.code, cycle: b.cycle }
    });
  }

  mm = p.match(/^\/checkout\/([^/]+)\/attach$/);
  if (m === 'POST' && mm) return send(res, 200, { ok: true });

  if (m === 'POST' && p === '/checkout/confirm') {
    const b = await readBody(req);
    const c = checkouts.get(b.checkout_id);
    if (!c) return fail(res, 404, 'unknown');
    if (c.plan === 'basic') return send(res, 200, { status: 'failed', message: 'رفض البنك العملية (محاكاة).', retry_url: '/checkout.html?token=' + encodeURIComponent(c.token) + '&plan=pro&cycle=' + c.cycle });
    return send(res, 200, { status: 'paid', tenant_url: 'https://' + c.tenant.subdomain + '.tijaracrm.com' });
  }

  return fail(res, 404, 'unknown');
}

// في المحاكاة: نستبدل مكتبة Moyasar بنسخة وهمية تعرض زرًا يحاكي الدفع
const FAKE_MOYASAR = `window.Moyasar={init:function(o){var el=document.querySelector(o.element);el.innerHTML='<div style="border:1px dashed #C9C2B2;border-radius:12px;padding:20px;text-align:center;direction:rtl"><p style="margin:0 0 12px">نموذج Moyasar (محاكاة) — '+(o.amount/100).toFixed(2)+' ر.س</p><button type="button" class="btn btn-primary btn-block" id="mock-pay">ادفع (محاكاة)</button></div>';document.getElementById('mock-pay').onclick=function(){var pid='pay_mock_'+Date.now();Promise.resolve(o.on_completed&&o.on_completed({id:pid})).then(function(){location.href=o.callback_url+'&id='+pid+'&status=paid';});};}};`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/public/')) {
    await new Promise((r) => setTimeout(r, 250));
    return apiRoute(req, res, url).catch((e) => { console.error(e); fail(res, 500, 'unknown'); });
  }
  if (url.pathname === '/__mock/moyasar.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(FAKE_MOYASAR); }
  if (url.pathname === '/__mock/moyasar.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(''); }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': TYPES['.html'] }); return res.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
  let body = fs.readFileSync(file);
  if (file.endsWith(path.join('assets', 'config.js'))) {
    body = body.toString().replace(/MOYASAR_JS:[^\n]+/, "MOYASAR_JS: '/__mock/moyasar.js',").replace(/MOYASAR_CSS:[^\n]+/, "MOYASAR_CSS: '/__mock/moyasar.css',");
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log('Mock site on http://localhost:' + PORT + '  (OTP: 123456, checkout demo: /checkout.html?token=demo)'));
