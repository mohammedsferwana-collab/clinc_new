import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { esc, toast, ROLES } from './ui.js';
import { renderReception, renderVisits } from './reception.js';
import { renderPharmacy } from './pharmacy.js';
import { renderSettings } from './settings.js';
import { renderReports } from './reports.js';
import { renderImport } from './import.js';
import { renderEmployees } from './employees.js';
import { renderAttendance } from './attendance.js';
import { renderAssets } from './assets.js';
import { loadSettings, applyTheme, setMode, currentMode, MODE_LABEL } from './theme.js';

const cfg = window.CLINIC_CONFIG || {};
const app = document.getElementById('app');
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  app.innerHTML = '<div class="login"><h1>الإعداد مطلوب</h1><p>افتح ملف <b>config.js</b> وضع رابط مشروع Supabase والمفتاح العام (anon key)، ثم أعد النشر.</p></div>';
  throw new Error('missing config');
}
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const ctx = { sb, profile: null, clinics: [], doctors: [], drugs: [], cleanup: null, settings: null };
ctx.settings = await loadSettings(sb);
applyTheme(ctx.settings);

// رسم الاسم والشعار في الواجهة (يُستدعى عند تغيير الإعدادات أو معاينتها)
const brandHTML = s => `${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : ''}<span>${esc(s.site_name)}</span>`;
const printHead = s => `<b>${esc(s.site_name)}</b>${s.tagline ? ' — ' + esc(s.tagline) : ''}<br>${[s.address, s.phone].filter(Boolean).map(esc).join(' • ')}`;
ctx.paint = s => {
  applyTheme(s);
  const b = document.querySelector('.side .brand'); if (b) b.innerHTML = brandHTML(s);
  const ph = document.querySelector('.printhead'); if (ph) ph.innerHTML = printHead(s);
  const mb = document.getElementById('mode'); if (mb) mb.textContent = 'الوضع: ' + MODE_LABEL[currentMode(s)];
};
ctx.setSettings = s => { ctx.settings = s; ctx.paint(s); };

const NAV = [
  ['reception', 'الاستقبال', renderReception, ['admin', 'reception']],
  ['visits', 'الزيارات', renderVisits, ['admin', 'doctor', 'reception']],
  ['pharmacy', 'الصيدلية', renderPharmacy, ['admin', 'pharmacy']],
  ['attendance', 'الحضور والانصراف', renderAttendance, ['admin', 'reception', 'doctor', 'pharmacy']],
  ['reports', 'تقارير العيادة', renderReports, ['admin', 'reception', 'doctor', 'pharmacy']],
  ['employees', 'الموظفون', renderEmployees, ['admin']],
  ['assets', 'العهد', renderAssets, ['admin']],
  ['import', 'استيراد من إكسل', renderImport, ['admin']],
  ['settings', 'الإعدادات', renderSettings, ['admin']],
];

ctx.loadLookups = async () => {
  const [c, d, g] = await Promise.all([
    sb.from('clinics').select('*').order('sort').order('name'),
    sb.from('doctors').select('*').order('name'),
    sb.from('drugs').select('id,name,unit,min_stock').eq('active', true).order('name'),
  ]);
  ctx.clinics = c.data || []; ctx.doctors = d.data || []; ctx.drugs = g.data || [];
};

function showLogin(msg = '') {
  app.innerHTML = `<form class="login" id="lf">${ctx.settings.logo_url ? `<img class="logo" src="${esc(ctx.settings.logo_url)}" alt="">` : ''}<h1>${esc(ctx.settings.site_name)}</h1>
    <label for="em">البريد الإلكتروني</label><input id="em" type="email" required autocomplete="username" dir="ltr">
    <label for="pw">كلمة المرور</label><input id="pw" type="password" required autocomplete="current-password" dir="ltr">
    <p class="small" style="color:var(--bad)">${esc(msg)}</p><button class="btn primary">دخول</button></form>`;
  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
    if (error) return showLogin('البريد أو كلمة المرور غير صحيحة');
    boot();
  };
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: p } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!p || !p.active) {
    app.innerHTML = '<div class="login"><h1>الحساب غير مفعّل</h1><p>تواصل مع مدير النظام لتفعيل حسابك.</p><button class="btn" id="lo">خروج</button></div>';
    document.getElementById('lo').onclick = async () => { await sb.auth.signOut(); showLogin(); };
    return;
  }
  ctx.profile = p;
  await ctx.loadLookups();
  const items = NAV.filter(n => n[3].includes(p.role));
  app.innerHTML = `<div class="shell"><nav class="side"><div class="brand">${brandHTML(ctx.settings)}</div>
    ${items.map(n => `<a href="#/${n[0]}" data-k="${n[0]}">${n[1]}</a>`).join('')}
    <div class="who">${esc(p.full_name)}<br>${ROLES[p.role]}<button id="mode" class="modebtn"></button><button id="out">تسجيل الخروج</button></div></nav><main><div class="printhead">${printHead(ctx.settings)}</div><div id="view"></div></main></div>`;
  const mb = document.getElementById('mode');
  mb.textContent = 'الوضع: ' + MODE_LABEL[currentMode(ctx.settings)];
  mb.onclick = () => { const order = ['light', 'dark', 'auto']; setMode(order[(order.indexOf(currentMode(ctx.settings)) + 1) % 3], ctx.settings); mb.textContent = 'الوضع: ' + MODE_LABEL[currentMode(ctx.settings)]; };
  document.getElementById('out').onclick = async () => { await sb.auth.signOut(); location.hash = ''; showLogin(); };
  window.onhashchange = () => route(items);
  route(items);
}

function route(items) {
  const key = location.hash.slice(2);
  const page = items.find(n => n[0] === key) || items[0];
  if (ctx.cleanup) { ctx.cleanup(); ctx.cleanup = null; }
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.dataset.k === page[0]));
  const view = document.getElementById('view');
  try { page[2](view, ctx); } catch (e) { console.error(e); toast('تعذر فتح الصفحة', 'bad'); }
}

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') showLogin(); });
boot();
