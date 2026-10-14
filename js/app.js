import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { esc, toast, openModal, closeModal, errMsg, ROLES } from './ui.js';
import { renderEstmara, renderSearch, renderVisits } from './reception.js';
import { renderPharmacy } from './pharmacy.js';
import { renderSettings } from './settings.js';
import { renderReports } from './reports.js';
import { renderImport } from './import.js';
import { renderEmployees } from './employees.js';
import { renderAttendance } from './attendance.js';
import { renderAssets } from './assets.js';
import { renderBackup } from './backup.js';
import { loadSettings, applyTheme, setMode, currentMode, MODE_LABEL } from './theme.js';

const cfg = window.CLINIC_CONFIG || {};
const app = document.getElementById('app');
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  app.innerHTML = '<div class="login"><h1>الإعداد مطلوب</h1><p>افتح ملف <b>config.js</b> وضع رابط مشروع Supabase والمفتاح العام (anon key)، ثم أعد النشر.</p></div>';
  throw new Error('missing config');
}
const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const ctx = { sb, profile: null, clinics: [], doctors: [], drugs: [], cleanup: null, settings: null, estmaraPrefill: null };
ctx.settings = await loadSettings(sb);
applyTheme(ctx.settings);

const ROLE_TITLES = {
  admin: 'مدير النظام',
  doctor: 'دكتور',
  reception: 'سكرتاريا',
  pharmacy: 'صيدلي'
};

function avatarHTML(user) {
  if (user && user.avatar_url) {
    return `<div class="avatar"><img src="${esc(user.avatar_url)}" alt=""></div>`;
  }
  const initial = ((user && user.full_name) || (user && user.username) || 'م').trim().slice(0, 1);
  return `<div class="avatar">${esc(initial)}</div>`;
}

function themeIconHTML(mode) {
  if (mode === 'dark') return '<span class="theme-icon">🌙</span>';
  if (mode === 'light') return '<span class="theme-icon">☀️</span>';
  return '<span class="theme-icon">💻</span>';
}

export function compressAvatar(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h) {
          if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        } else {
          if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        const c2d = canvas.getContext('2d');
        c2d.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const brandHTML = s => `${s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : ''}<span>${esc(s.site_name)}</span>`;
const printHead = s => `<b>${esc(s.site_name)}</b>${s.tagline ? ' — ' + esc(s.tagline) : ''}<br>${[s.address, s.phone].filter(Boolean).map(esc).join(' • ')}`;

ctx.paint = s => {
  applyTheme(s);
  const b = document.querySelector('.side .brand'); if (b) b.innerHTML = brandHTML(s);
  const tc = document.querySelector('.topbar-clinic');
  if (tc) tc.innerHTML = `${s.logo_url ? `<img src="${esc(s.logo_url)}" style="height:26px;width:auto;border-radius:4px" alt="">` : ''} <b>${esc(s.site_name)}</b>`;
  const ph = document.querySelector('.printhead'); if (ph) ph.innerHTML = printHead(s);
  const topModeBtn = document.getElementById('topModeBtn');
  if (topModeBtn) {
    const m = currentMode(s);
    topModeBtn.innerHTML = `${themeIconHTML(m)}<span class="theme-label">${MODE_LABEL[m]}</span>`;
  }
  const topUserWidget = document.getElementById('userWidget');
  if (topUserWidget && ctx.profile) {
    topUserWidget.innerHTML = `
      ${avatarHTML(ctx.profile)}
      <div class="user-info">
        <span class="user-name">${esc(ctx.profile.full_name || ctx.profile.username)}</span>
        <span class="role-badge role-${ctx.profile.role}">${ROLE_TITLES[ctx.profile.role] || ROLES[ctx.profile.role]}</span>
      </div>
    `;
  }
};
ctx.setSettings = s => { ctx.settings = s; ctx.paint(s); };

// شريط التنقل والصلاحيات لكل بوابة
const NAV = [
  ['estmara', 'صفحة الاستمارة', renderEstmara, ['admin', 'reception']],
  ['search', 'صفحة البحث', renderSearch, ['admin', 'reception']],
  ['visits', 'بوابة الطبيب والكشوفات', renderVisits, ['admin', 'doctor', 'reception']],
  ['pharmacy', 'بوابة الصيدلية', renderPharmacy, ['admin', 'pharmacy']],
  ['reports', 'التقارير الإحصائية', renderReports, ['admin']],
  ['employees', 'الحسابات والصلاحيات', renderEmployees, ['admin']],
  ['attendance', 'الحضور والانصراف', renderAttendance, ['admin', 'reception', 'doctor', 'pharmacy']],
  ['assets', 'العهد والمستلزمات', renderAssets, ['admin']],
  ['settings', 'البيانات التعريفية والإعدادات', renderSettings, ['admin']],
  ['import', 'الاستيراد من إكسل', renderImport, ['admin']],
  ['backup', 'النسخ الاحتياطي', renderBackup, ['admin']],
];

ctx.loadLookups = async () => {
  const [c, d, emps, g] = await Promise.all([
    sb.from('clinics').select('*').order('sort').order('name'),
    sb.from('doctors').select('*').order('name'),
    sb.from('employees').select('id,full_name,specialty,active').eq('active', true),
    sb.from('drugs').select('*').eq('active', true).order('name'),
  ]);
  ctx.clinics = c.data || [];

  const docMap = new Map();
  (d.data || []).forEach(doc => docMap.set(doc.name, doc));
  (emps.data || []).forEach(emp => {
    if (/طبيب|دكتور/i.test(emp.specialty || '')) {
      if (!docMap.has(emp.full_name)) {
        docMap.set(emp.full_name, { id: 'emp_' + emp.id, name: emp.full_name });
      }
    }
  });
  ctx.doctors = Array.from(docMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  ctx.drugs = g.data || [];
};

function showLogin(msg = '') {
  const logoHTML = ctx.settings.logo_url
    ? `<div class="login-logo-wrap"><img class="logo" src="${esc(ctx.settings.logo_url)}" alt="${esc(ctx.settings.site_name)}"></div>`
    : `<div class="login-logo-wrap default-logo" title="${esc(ctx.settings.site_name)}"><svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path><path d="M12 5v6"></path><path d="M9 8h6"></path></svg></div>`;

  app.innerHTML = `
    <form class="login" id="lf">
      ${logoHTML}
      <h1>${esc(ctx.settings.site_name)}</h1>
      ${ctx.settings.tagline ? `<p class="login-tagline">${esc(ctx.settings.tagline)}</p>` : ''}
      <label for="em">اسم المستخدم أو البريد الإلكتروني</label>
      <input id="em" type="text" required autocomplete="username" dir="ltr" placeholder="اسم المستخدم (مثال: ahmed)">
      <label for="pw">كلمة المرور</label>
      <input id="pw" type="password" required autocomplete="current-password" dir="ltr" placeholder="••••••••">
      <p class="small" style="color:var(--bad)">${esc(msg)}</p>
      <button class="btn primary" id="subBtn">دخول للنظام</button>
    </form>
  `;

  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('subBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحقق...';

    const rawInput = document.getElementById('em').value.trim();
    const pw = document.getElementById('pw').value;
    let targetEmail = rawInput;

    if (!rawInput.includes('@')) {
      try {
        const { data: mappedEmail } = await sb.rpc('get_email_for_username', { p_username: rawInput });
        targetEmail = mappedEmail || (rawInput.toLowerCase() + '@clinic.local');
      } catch {
        targetEmail = rawInput.toLowerCase() + '@clinic.local';
      }
    }

    const { error } = await sb.auth.signInWithPassword({ email: targetEmail, password: pw });
    if (error) return showLogin('اسم المستخدم أو كلمة المرور غير صحيحة');
    boot();
  };
}

function openProfileModal(context, user) {
  const body = openModal(`
    <div style="text-align:center; padding:.5rem 0">
      <div id="profAvatarWrap" style="display:inline-block; margin-bottom:.8rem; cursor:pointer" title="انقر لتغيير الصورة الشخصية">
        <div class="avatar" style="width:84px; height:84px; font-size:2.2rem; margin:0 auto; border-width:3px">
          ${user.avatar_url ? `<img src="${esc(user.avatar_url)}" id="profImg" alt="">` : `<span id="profInit">${esc(((user.full_name || user.username || 'م').trim().slice(0, 1)))}</span>`}
        </div>
        <div style="font-size:.84rem; color:var(--brand); margin-top:.4rem; font-weight:600">📷 تغيير الصورة الشخصية</div>
      </div>
      <input type="file" id="avatarFileInput" accept="image/png,image/jpeg,image/webp" style="display:none">

      <h2 style="margin:0 0 .2rem">${esc(user.full_name || user.username)}</h2>
      <div class="role-badge role-${user.role}" style="font-size:.85rem; padding:.15rem .75rem">
        ${ROLE_TITLES[user.role] || ROLES[user.role]}
      </div>
      ${user.username ? `<p class="muted small" style="margin:.4rem 0">اسم المستخدم: <code>${esc(user.username)}</code></p>` : ''}
    </div>

    <div style="border-top:1px solid var(--line); margin-top:1.2rem; padding-top:1rem">
      <h3>تغيير كلمة المرور الخاصة بك</h3>
      <form id="myPwForm" class="row" style="gap:.6rem; align-items:flex-end">
        <div style="flex:1">
          <label>كلمة المرور الجديدة</label>
          <input name="new_pw" type="password" minlength="6" required placeholder="6 خانات على الأقل">
        </div>
        <button class="btn primary" id="saveMyPwBtn">تحديث كلمة المرور</button>
      </form>
    </div>
  `);

  const avatarWrap = body.querySelector('#profAvatarWrap');
  const fileInput = body.querySelector('#avatarFileInput');

  avatarWrap.onclick = () => fileInput.click();

  fileInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      toast('جارٍ معالجة ورفع الصورة...', 'wait');
      const compressedDataUrl = await compressAvatar(file, 300);

      const { error } = await context.sb.from('profiles').update({
        avatar_url: compressedDataUrl
      }).eq('id', user.id);

      if (error) throw error;

      user.avatar_url = compressedDataUrl;
      context.profile.avatar_url = compressedDataUrl;

      const profImg = body.querySelector('#profImg');
      if (profImg) {
        profImg.src = compressedDataUrl;
      } else {
        const wrap = body.querySelector('.avatar');
        wrap.innerHTML = `<img src="${compressedDataUrl}" id="profImg" alt="">`;
      }

      context.paint(context.settings);
      toast('تم تحديث صورتك الشخصية بنجاح!');
    } catch (err) {
      toast(errMsg(err), 'bad');
    }
  };

  body.querySelector('#myPwForm').onsubmit = async e => {
    e.preventDefault();
    const btn = body.querySelector('#saveMyPwBtn');
    btn.disabled = true;
    const newPw = e.target.new_pw.value;

    const { error } = await context.sb.auth.updateUser({ password: newPw });
    if (error) {
      btn.disabled = false;
      return toast(errMsg(error), 'bad');
    }

    toast('تم تحديث كلمة المرور بنجاح');
    closeModal();
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

  const curMode = currentMode(ctx.settings);
  const todayArabic = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const isAdmin = p.role === 'admin';

  const mainItems = NAV.slice(0, 8).filter(n => n[3].includes(p.role));

  app.innerHTML = `
    <div class="shell">
      <nav class="side">
        <div class="brand">${brandHTML(ctx.settings)}</div>
        
        <div class="nav-links">
          ${mainItems.map(n => `<a href="#/${n[0]}" data-k="${n[0]}">${n[1]}</a>`).join('')}

          ${isAdmin ? `
            <div class="nav-dropdown" id="settingsNavGroup">
              <button type="button" class="nav-dropdown-btn" id="settingsDropdownToggle">
                <span>⚙️ الإعدادات والبيانات</span>
                <span class="dropdown-caret">▾</span>
              </button>
              <div class="nav-dropdown-menu">
                <a href="#/settings" data-k="settings" class="sub-link">البيانات التعريفية والإعدادات</a>
                <a href="#/import" data-k="import" class="sub-link">الاستيراد من إكسل</a>
                <a href="#/backup" data-k="backup" class="sub-link">النسخ الاحتياطي</a>
              </div>
            </div>
          ` : ''}
        </div>
      </nav>

      <div class="main-col">
        <header class="topbar noprint">
          <div class="topbar-right">
            <span class="topbar-clinic">
              ${ctx.settings.logo_url ? `<img src="${esc(ctx.settings.logo_url)}" style="height:26px;width:auto;border-radius:4px" alt="">` : ''}
              <b>${esc(ctx.settings.site_name)}</b>
            </span>
            <span class="topbar-date">${todayArabic}</span>
          </div>

          <div class="topbar-left">
            <button id="topModeBtn" class="theme-toggle-btn" title="تبديل الوضع (فاتح / ليلي / تلقائي)">
              ${themeIconHTML(curMode)}
              <span class="theme-label">${MODE_LABEL[curMode]}</span>
            </button>

            <div class="user-widget" id="userWidget" title="انقر لعرض الملف الشخصي وتغيير صورتك">
              ${avatarHTML(p)}
              <div class="user-info">
                <span class="user-name">${esc(p.full_name || p.username)}</span>
                <span class="role-badge role-${p.role}">${ROLE_TITLES[p.role] || ROLES[p.role]}</span>
              </div>
            </div>

            <button id="topLogoutBtn" class="topbar-logout" title="تسجيل الخروج">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              خروج
            </button>
          </div>
        </header>

        <main>
          <div class="printhead">${printHead(ctx.settings)}</div>
          <div id="view"></div>
        </main>
      </div>
    </div>
  `;

  const settingsToggle = document.getElementById('settingsDropdownToggle');
  const settingsGroup = document.getElementById('settingsNavGroup');
  if (settingsToggle && settingsGroup) {
    settingsToggle.onclick = () => {
      const isOpen = settingsGroup.classList.toggle('open');
      const caret = settingsGroup.querySelector('.dropdown-caret');
      if (caret) caret.textContent = isOpen ? '▴' : '▾';
    };
  }

  const topModeBtn = document.getElementById('topModeBtn');
  topModeBtn.onclick = () => {
    const order = ['light', 'dark', 'auto'];
    const next = order[(order.indexOf(currentMode(ctx.settings)) + 1) % 3];
    setMode(next, ctx.settings);
    topModeBtn.innerHTML = `${themeIconHTML(next)}<span class="theme-label">${MODE_LABEL[next]}</span>`;
  };

  document.getElementById('userWidget').onclick = () => openProfileModal(ctx, p);

  document.getElementById('topLogoutBtn').onclick = async () => {
    await sb.auth.signOut();
    location.hash = '';
    showLogin();
  };

  const allItems = NAV.filter(n => n[3].includes(p.role));
  window.onhashchange = () => route(allItems);
  route(allItems);
}

function route(items) {
  const hash = location.hash.slice(2);
  const key = hash.split('?')[0] || items[0][0];
  const page = items.find(n => n[0] === key) || items[0];
  if (ctx.cleanup) { ctx.cleanup(); ctx.cleanup = null; }

  document.querySelectorAll('.side a').forEach(a => {
    a.classList.toggle('on', a.dataset.k === page[0]);
  });

  const group = document.getElementById('settingsNavGroup');
  if (group) {
    const isSub = ['settings', 'import', 'backup'].includes(page[0]);
    if (isSub) {
      group.classList.add('open');
      const caret = group.querySelector('.dropdown-caret');
      if (caret) caret.textContent = '▴';
    }
  }

  const view = document.getElementById('view');
  try { page[2](view, ctx); } catch (e) { console.error(e); toast('تعذر فتح الصفحة', 'bad'); }
}

sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') showLogin(); });
boot();