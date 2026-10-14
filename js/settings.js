import { esc, toast, openModal, closeModal, errMsg, ROLES } from './ui.js';
import * as N from './normalize.js';
import { PRESETS, MODE_LABEL, withLogo } from './theme.js';
import { executeBackup } from './backup.js';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export async function renderSettings(root, ctx) {
  const { sb } = ctx;
  let draft = { ...ctx.settings };
  ctx.cleanup = () => ctx.paint(ctx.settings); // إلغاء المعاينة غير المحفوظة عند مغادرة الصفحة

  async function draw() {
    await ctx.loadLookups();
    const s = draft;

    root.innerHTML = `
      <header class="pagehead">
        <div>
          <h1 style="margin:0">الإعدادات العامة</h1>
          <p class="muted small" style="margin:.2rem 0 0">إدارة مظهر وهوية المركز، العيادات، والأطباء والنسخ الاحتياطي</p>
        </div>
        <button class="btn primary" id="backupFromSettingsTop">💾 النسخ الاحتياطي لجميع البيانات</button>
      </header>

      <!-- شريط تبويبات الإعدادات والصفحات المنسدلة -->
      <div class="panel" style="padding:.6rem 1rem; margin-bottom:1.2rem; background:var(--card); border:1px solid var(--line)">
        <div class="row" style="gap:.6rem; align-items:center; flex-wrap:wrap">
          <span class="muted small" style="font-weight:600">أقسام الإعدادات:</span>
          <a href="#/settings" class="btn primary sm" style="text-decoration:none">⚙️ الإعدادات العامة والمظهر</a>
          <a href="#/import" class="btn sm" style="text-decoration:none">📊 الاستيراد من إكسل</a>
          <a href="#/backup" class="btn sm" style="text-decoration:none">💾 النسخ الاحتياطي لجميع البيانات</a>
          <a href="#/employees" class="btn sm" style="text-decoration:none">👥 الموظفون وحسابات الدخول</a>
        </div>
      </div>

      <!-- الهوية والمظهر -->
      <div class="panel">
        <h2>الهوية والمظهر العام</h2>
        <div class="grid">
          <div><label>اسم الموقع / المركز</label><input id="g_site" value="${esc(s.site_name)}"></div>
          <div><label>وصف قصير (يظهر في التقارير)</label><input id="g_tag" value="${esc(s.tagline)}" placeholder="مثال: خدمات صحية متكاملة"></div>
          <div><label>هاتف المركز</label><input id="g_phone" value="${esc(s.phone)}" dir="ltr"></div>
          <div><label>العنوان</label><input id="g_addr" value="${esc(s.address)}"></div>
        </div>

        <h3>شعار المركز (يظهر في الدخول والترويسة)</h3>
        <div class="row">${s.logo_url ? `<img class="logoprev" src="${esc(s.logo_url)}" alt="الشعار الحالي">` : '<span class="muted">لا يوجد شعار مخصص</span>'}
          <div><label>رفع شعار جديد (PNG أو JPG أو WebP، حتى 2 ميجابايت)</label><input id="g_logo" type="file" accept="image/png,image/jpeg,image/webp"></div>
          ${s.logo_url ? '<button class="btn danger sm" id="g_rmlogo">حذف الشعار</button>' : ''}
        </div>

        <h3>اللون الرئيسي للمركز</h3>
        <div class="swatches">${PRESETS.map(([n, c]) => `<button type="button" class="swatch ${s.primary_color.toLowerCase() === c.toLowerCase() ? 'on' : ''}" style="background:${c}" title="${n}" aria-label="${n}" data-c="${c}"></button>`).join('')}
          <label style="margin:0 .6rem 0 0">لون مخصص</label><input id="g_color" type="color" value="${esc(s.primary_color)}" style="width:54px;padding:2px;height:36px">
        </div>

        <div class="grid" style="margin-top:1rem">
          <div><label>شكل الحواف</label><select id="g_radius">${[['round', 'مستدير (افتراضي)'], ['soft', 'مستدير أكثر'], ['square', 'حاد']].map(([k, l]) => `<option value="${k}" ${s.radius === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>حجم الخط</label><select id="g_font">${[['small', 'صغير'], ['normal', 'عادي'], ['large', 'كبير']].map(([k, l]) => `<option value="${k}" ${s.font_scale === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>الوضع الافتراضي للمستخدمين الجدد</label><select id="g_mode">${Object.entries(MODE_LABEL).map(([k, l]) => `<option value="${k}" ${s.default_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <p class="muted small">كل مستخدم يستطيع تبديل الوضع الليلي لنفسه من زر «الوضع» أعلى الشاشة في القائمة العلوية.</p>

        <h3>أيام الدوام (تُستخدم في احتساب الغياب)</h3>
        <div class="row">${DAYS.map((d, i) => `<label style="margin:0;display:flex;gap:.3rem;align-items:center;color:var(--ink)"><input type="checkbox" class="wd" value="${i}" style="width:auto" ${s.work_days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
        <div class="row" style="margin-top:1rem"><button class="btn primary" id="g_save">✓ حفظ الإعدادات</button><button class="btn" id="g_reset">تراجع عن التعديلات</button></div>
      </div>

      <!-- بطاقة الموظفين والحسابات الموحدة -->
      <div class="panel" style="background:var(--card); border:1px solid var(--line)">
        <div class="row between">
          <div>
            <h2 style="margin:0 0 .3rem">الموظفون وحسابات الدخول الموحدة</h2>
            <p class="muted small" style="margin:0">تم توحيد الموظفين والمستخدمين؛ يمتلك كل موظف حسابه وصورته ودوره وصلاحياته وكلمة مروره في شاشة واحدة.</p>
          </div>
          <a href="#/employees" class="btn primary" style="text-decoration:none">👥 إدارة الموظفون والحسابات</a>
        </div>
      </div>

      <!-- النسخ الاحتياطي المنسدل من الإعدادات -->
      <div class="panel">
        <div class="row between" style="margin-bottom:.5rem">
          <h2 style="margin:0">النسخ الاحتياطي لقاعدة البيانات</h2>
          <button class="btn primary" id="backupFromSettingsBtn">تصدير النسخة الاحتياطية الآن</button>
        </div>
        <p class="muted" style="margin:0">تصدير شامل وفوري لجميع بيانات المركز (المرضى، الزيارات، الأدوية، الموظفون والحسابات، الحضور، الإعدادات) في ملفات Excel و JSON.</p>
      </div>

      <div class="cols2">
        <!-- إدارة العيادات -->
        <div class="panel">
          <h2>العيادات</h2>
          <div class="chips" id="clinicChips">
            ${ctx.clinics.map(c => `
              <span class="chip" style="display:inline-flex; align-items:center; gap:.4rem">
                <span>${esc(c.name)}</span>
                <button type="button" class="del-clinic" data-id="${c.id}" data-name="${esc(c.name)}" style="background:none; border:none; color:var(--bad); font-weight:bold; cursor:pointer; font-size:1.1rem; line-height:1; padding:0 3px" title="حذف العيادة">×</button>
              </span>
            `).join('') || '<span class="muted">لا توجد عيادات</span>'}
          </div>
          <form class="row" data-t="clinics" style="margin-top:.8rem">
            <input name="name" placeholder="عيادة جديدة" required>
            <button class="btn">إضافة</button>
          </form>
        </div>

        <!-- الأطباء: عرض فقط — تتم إضافتهم وتعديلهم وحذفهم من صفحة «الموظفون والحسابات» -->
        <div class="panel">
          <h2 style="margin:0 0 .4rem">الأطباء</h2>
          <p class="muted small" style="margin:0 0 .6rem">لا يمكن إضافة الأطباء من الإعدادات. يُضاف الطبيب من صفحة <a href="#/employees"><b>الموظفون والحسابات</b></a> بتحديد الدور «دكتور / طبيب معالج»، وتُرفق هناك شهادته الجامعية وسيرته الذاتية.</p>
          <div class="chips" id="docChips">
            ${ctx.doctors.map(c => `<span class="chip">${esc(c.name)}</span>`).join('') || '<span class="muted">لا يوجد أطباء مسجلون</span>'}
          </div>
        </div>
      </div>
    `;

    bindGeneral();

    // تشغيل النسخ الاحتياطي من صفحة الإعدادات
    const runBackup = () => executeBackup(ctx);
    root.querySelector('#backupFromSettingsTop').onclick = runBackup;
    root.querySelector('#backupFromSettingsBtn').onclick = runBackup;

    // حذف عيادة بالنقر على ×
    root.querySelector('#clinicChips').onclick = async e => {
      const btn = e.target.closest('.del-clinic');
      if (!btn) return;
      const name = btn.dataset.name;
      const id = btn.dataset.id;
      if (!confirm(`هل أنت متأكد من حذف عيادة «${name}»؟`)) return;
      const { error } = await sb.from('clinics').delete().eq('id', id);
      if (error) return toast(errMsg(error), 'bad');
      toast(`تم حذف عيادة «${name}» بنجاح`);
      await ctx.loadLookups();
      draw();
    };

    root.querySelectorAll('form[data-t]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.from(f.dataset.t).insert({ name: new FormData(f).get('name').trim() });
      if (error) return toast(errMsg(error), 'bad');
      draw();
    });
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
