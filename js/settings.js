import { esc, toast, errMsg, ROLES } from './ui.js';
import * as N from './normalize.js';
import { PRESETS, MODE_LABEL, withLogo } from './theme.js';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export async function renderSettings(root, ctx) {
  const { sb } = ctx;
  let draft = { ...ctx.settings };
  ctx.cleanup = () => ctx.paint(ctx.settings);          // إلغاء المعاينة غير المحفوظة عند مغادرة الصفحة

  async function draw() {
    await ctx.loadLookups();
    const { data: users } = await sb.from('profiles').select('*').order('created_at');
    const s = draft;
    root.innerHTML = `<header class="pagehead"><h1>الإعدادات</h1></header>
    <div class="panel"><h2>الهوية والمظهر</h2>
      <div class="grid">
        <div><label>اسم الموقع / المركز</label><input id="g_site" value="${esc(s.site_name)}"></div>
        <div><label>وصف قصير (يظهر في التقارير)</label><input id="g_tag" value="${esc(s.tagline)}" placeholder="مثال: خدمات صحية متكاملة"></div>
        <div><label>هاتف المركز</label><input id="g_phone" value="${esc(s.phone)}" dir="ltr"></div>
        <div><label>العنوان</label><input id="g_addr" value="${esc(s.address)}"></div>
      </div>
      <h3>الشعار</h3>
      <div class="row">${s.logo_url ? `<img class="logoprev" src="${esc(s.logo_url)}" alt="الشعار الحالي">` : '<span class="muted">لا يوجد شعار</span>'}
        <div><label>رفع شعار (PNG أو JPG أو WebP، حتى 2 ميجابايت)</label><input id="g_logo" type="file" accept="image/png,image/jpeg,image/webp"></div>
        ${s.logo_url ? '<button class="btn danger sm" id="g_rmlogo">حذف الشعار</button>' : ''}</div>
      <h3>اللون الرئيسي</h3>
      <div class="swatches">${PRESETS.map(([n, c]) => `<button type="button" class="swatch ${s.primary_color.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" title="${n}" aria-label="${n}" data-c="${c}"></button>`).join('')}
        <label style="margin:0 .6rem 0 0">لون مخصص</label><input id="g_color" type="color" value="${esc(s.primary_color)}" style="width:54px;padding:2px;height:36px"></div>
      <div class="grid" style="margin-top:1rem">
        <div><label>شكل الحواف</label><select id="g_radius">${[['round', 'مستدير (افتراضي)'], ['soft', 'مستدير أكثر'], ['square', 'حاد']].map(([k, l]) => `<option value="${k}" ${s.radius === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>حجم الخط</label><select id="g_font">${[['small', 'صغير'], ['normal', 'عادي'], ['large', 'كبير']].map(([k, l]) => `<option value="${k}" ${s.font_scale === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>الوضع الافتراضي للمستخدمين الجدد</label><select id="g_mode">${Object.entries(MODE_LABEL).map(([k, l]) => `<option value="${k}" ${s.default_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <p class="muted small">كل مستخدم يستطيع تبديل الوضع الليلي لنفسه من زر «الوضع» أسفل القائمة الجانبية. التغييرات هنا تُعاين فوراً ولا تُحفظ للجميع إلا بالضغط على «حفظ الإعدادات».</p>
      <h3>أيام الدوام (تُستخدم في احتساب الغياب)</h3>
      <div class="row">${DAYS.map((d, i) => `<label style="margin:0;display:flex;gap:.3rem;align-items:center;color:var(--ink)"><input type="checkbox" class="wd" value="${i}" style="width:auto" ${s.work_days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
      <div class="row" style="margin-top:1rem"><button class="btn primary" id="g_save">حفظ الإعدادات</button><button class="btn" id="g_reset">تراجع عن التعديلات</button></div></div>

    <div class="panel"><h2>المستخدمون</h2><div class="tablewrap"><table><thead><tr><th>الاسم</th><th>الدور</th><th>مفعّل</th></tr></thead><tbody>${users.map(u => `<tr data-id="${u.id}">
      <td><input class="nm" value="${esc(u.full_name)}"></td>
      <td><select class="rl">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input type="checkbox" class="ac" ${u.active ? 'checked' : ''} ${u.id === ctx.profile.id ? 'disabled' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">لإضافة مستخدم جديد: Supabase ← Authentication ← Users ← Add user (مع تفعيل Auto Confirm)، ثم غيّر دوره من هنا. المدير يرى كل الصفحات.</p></div>
    <div class="cols2"><div class="panel"><h2>العيادات</h2><div class="chips">${ctx.clinics.map(c => `<span class="chip">${esc(c.name)}</span>`).join('')}</div>
      <form class="row" data-t="clinics" style="margin-top:.8rem"><input name="name" placeholder="عيادة جديدة" required><button class="btn">إضافة</button></form></div>
    <div class="panel"><h2>الأطباء</h2><div class="chips">${ctx.doctors.map(c => `<span class="chip">${esc(c.name)}</span>`).join('') || '<span class="muted">لا يوجد أطباء مسجلون</span>'}</div>
      <form class="row" data-t="doctors" style="margin-top:.8rem"><input name="name" placeholder="طبيب جديد" required><button class="btn">إضافة</button></form></div></div>`;
    bindGeneral();
    root.querySelectorAll('form[data-t]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.from(f.dataset.t).insert({ name: new FormData(f).get('name').trim() });
      if (error) return toast(errMsg(error), 'bad');
      draw();
    });
    root.querySelector('tbody').onchange = async e => {
      const tr = e.target.closest('tr');
      const { error } = await sb.from('profiles').update({ full_name: tr.querySelector('.nm').value.trim(), role: tr.querySelector('.rl').value, active: tr.querySelector('.ac').checked }).eq('id', tr.dataset.id);
      toast(error ? errMsg(error) : 'تم حفظ التعديل', error ? 'bad' : 'ok');
    };
  }

  function bindGeneral() {
    const $ = id => root.querySelector('#' + id);
    const preview = () => ctx.paint(draft);
    const pull = () => {
      draft.site_name = N.cleanText($('g_site').value) || ctx.settings.site_name;
      draft.tagline = N.cleanText($('g_tag').value); draft.phone = N.cleanText($('g_phone').value); draft.address = N.cleanText($('g_addr').value);
      draft.radius = $('g_radius').value; draft.font_scale = $('g_font').value; draft.default_mode = $('g_mode').value;
      draft.work_days = [...root.querySelectorAll('.wd')].filter(c => c.checked).map(c => +c.value);
    };
    ['g_site', 'g_tag', 'g_phone', 'g_addr', 'g_radius', 'g_font', 'g_mode'].forEach(id => ($(id).oninput = () => { pull(); preview(); }));
    root.querySelectorAll('.wd').forEach(c => (c.onchange = pull));
    root.querySelectorAll('.swatch').forEach(b => (b.onclick = () => { pull(); draft.primary_color = b.dataset.c; $('g_color').value = b.dataset.c; root.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === b)); preview(); }));
    $('g_color').oninput = e => { pull(); draft.primary_color = e.target.value; root.querySelectorAll('.swatch').forEach(x => x.classList.remove('on')); preview(); };
    $('g_reset').onclick = () => { draft = { ...ctx.settings }; ctx.paint(ctx.settings); draw(); };

    $('g_save').onclick = async () => {
      pull();
      if (!draft.work_days.length) return toast('اختر يوم دوام واحداً على الأقل', 'bad');
      const rec = { site_name: draft.site_name, tagline: draft.tagline || null, phone: draft.phone || null, address: draft.address || null,
        primary_color: draft.primary_color, radius: draft.radius, font_scale: draft.font_scale, default_mode: draft.default_mode, work_days: draft.work_days, updated_at: new Date().toISOString() };
      const { data, error } = await sb.from('app_settings').update(rec).eq('id', 1).select().maybeSingle();
      if (error || !data) return toast(error ? errMsg(error) : 'تعذر الحفظ: شغّل ملف schema_v3.sql في Supabase أولاً', 'bad');
      draft = withLogo({ ...draft, ...data }, sb); ctx.setSettings(draft); draft = { ...draft };
      toast('تم حفظ الإعدادات');
    };

    $('g_logo').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) return toast('حجم الشعار أكبر من 2 ميجابايت', 'bad');
      const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[f.type];
      if (!ext) return toast('الصيغة غير مدعومة: استخدم PNG أو JPG أو WebP', 'bad');
      const path = `logo-${Date.now()}.${ext}`;
      const up = await sb.storage.from('branding').upload(path, f, { contentType: f.type });
      if (up.error) return toast(errMsg(up.error), 'bad');
      const { data, error } = await sb.from('app_settings').update({ logo_path: path }).eq('id', 1).select().maybeSingle();
      if (error || !data) { await sb.storage.from('branding').remove([path]); return toast(error ? errMsg(error) : 'تعذر الحفظ: شغّل schema_v3.sql أولاً', 'bad'); }
      if (ctx.settings.logo_path) sb.storage.from('branding').remove([ctx.settings.logo_path]);
      draft = withLogo({ ...draft, logo_path: path }, sb);
      ctx.setSettings({ ...ctx.settings, logo_path: path, logo_url: draft.logo_url });
      toast('تم رفع الشعار'); draw();
    };
    const rm = $('g_rmlogo');
    if (rm) rm.onclick = async () => {
      if (!confirm('حذف الشعار؟')) return;
      const { error } = await sb.from('app_settings').update({ logo_path: null }).eq('id', 1);
      if (error) return toast(errMsg(error), 'bad');
      if (ctx.settings.logo_path) sb.storage.from('branding').remove([ctx.settings.logo_path]);
      draft = { ...draft, logo_path: null, logo_url: null };
      ctx.setSettings({ ...ctx.settings, logo_path: null, logo_url: null });
      draw();
    };
  }
  draw();
}
