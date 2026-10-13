import { esc, toast, openModal, closeModal, errMsg, ROLES } from './ui.js';
import * as N from './normalize.js';
import { PRESETS, MODE_LABEL, withLogo } from './theme.js';
import { executeBackup } from './backup.js';
import { compressAvatar } from './app.js';

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export async function renderSettings(root, ctx) {
  const { sb } = ctx;
  let draft = { ...ctx.settings };
  ctx.cleanup = () => ctx.paint(ctx.settings);          // إلغاء المعاينة غير المحفوظة عند مغادرة الصفحة

  async function draw() {
    await ctx.loadLookups();
    const [{ data: users }, { data: emps }] = await Promise.all([
      sb.from('profiles').select('*').order('created_at'),
      sb.from('employees').select('id,full_name,user_id').eq('active', true).order('full_name')
    ]);
    const unlinkedEmps = (emps || []).filter(e => !e.user_id);
    const s = draft;

    root.innerHTML = `<header class="pagehead">
      <h1>الإعدادات</h1>
      <button class="btn primary" id="backupFromSettingsTop">النسخ الاحتياطي لجميع البيانات</button>
    </header>
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
      <p class="muted small">كل مستخدم يستطيع تبديل الوضع الليلي لنفسه من زر «الوضع» أعلى الشاشة في القائمة العلوية. التغييرات هنا تُعاين فوراً ولا تُحفظ للجميع إلا بالضغط على «حفظ الإعدادات».</p>
      <h3>أيام الدوام (تُستخدم في احتساب الغياب)</h3>
      <div class="row">${DAYS.map((d, i) => `<label style="margin:0;display:flex;gap:.3rem;align-items:center;color:var(--ink)"><input type="checkbox" class="wd" value="${i}" style="width:auto" ${s.work_days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
      <div class="row" style="margin-top:1rem"><button class="btn primary" id="g_save">حفظ الإعدادات</button><button class="btn" id="g_reset">تراجع عن التعديلات</button></div></div>

    <div class="panel">
      <div class="row between" style="margin-bottom:.8rem">
        <h2 style="margin:0">المستخدمون وصلاحيات الدخول</h2>
        <button class="btn primary" id="addUserBtn">+ إضافة مستخدم جديد</button>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th style="width:48px; text-align:center">الصورة</th>
              <th>الاسم الكامل</th>
              <th>اسم المستخدم</th>
              <th>الدور والصلاحية</th>
              <th>مفعّل</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody id="usersTbody">
            ${(users || []).map(u => `<tr data-id="${u.id}">
              <td style="width:48px; text-align:center">
                <div class="avatar" style="width:34px; height:34px; font-size:.95rem; margin:0 auto; cursor:pointer" data-act="uploadAvatar" title="تغيير صورة هذا المستخدم">
                  ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc((u.full_name || u.username || 'م').trim().slice(0, 1))}
                </div>
              </td>
              <td><input class="nm" value="${esc(u.full_name)}"></td>
              <td><code style="background:var(--bg); padding:3px 8px; border-radius:var(--r); font-weight:600">${esc(u.username || '—')}</code></td>
              <td><select class="rl">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
              <td><input type="checkbox" class="ac" ${u.active ? 'checked' : ''} ${u.id === ctx.profile.id ? 'disabled' : ''} style="width:auto"></td>
              <td class="row" style="gap:.25rem; flex-wrap:nowrap">
                <button class="btn sm" data-act="uploadAvatar" title="رفع صورة شخصية">📷 الصورة</button>
                <button class="btn sm" data-act="resetPw" title="تغيير كلمة المرور لهذا المستخدم">كلمة المرور</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <input type="file" id="tableAvatarInput" accept="image/png,image/jpeg,image/webp" style="display:none">
      <p class="muted small" style="margin-top:.6rem">يمكن للمدير رفع وتغيير الصورة الشخصية لأي مستخدم، وتغيير كلمة المرور أو إنشاء حساب جديد مباشرة.</p>
    </div>

    <!-- قسم النسخ الاحتياطي أسفل الإعدادات -->
    <div class="panel">
      <h2>النسخ الاحتياطي لقاعدة البيانات</h2>
      <p>أخذ نسخة احتياطية فورية وشاملة لكافة بيانات المركز (المرضى، الزيارات، الأدوية، الموظفين، الحضور، الإعدادات) وتصديرها بصيغتي Excel و JSON.</p>
      <div class="row" style="margin-top:.8rem">
        <button class="btn primary" id="backupFromSettingsBtn">النسخ الاحتياطي لجميع البيانات</button>
      </div>
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

      <!-- إدارة الأطباء وحذف الأطباء الزائدين (مثل علي) -->
      <div class="panel">
        <div class="row between" style="margin-bottom:.4rem">
          <h2 style="margin:0">الأطباء</h2>
          <button type="button" class="btn sm danger" id="cleanAliBtn" title="حذف الطبيب علي والأطباء التجريبيين">حذف الطبيب علي والأطباء الزائدين</button>
        </div>
        <p class="muted small" style="margin:0 0 .6rem">انقر على علامة (×) لحذف أي طبيب. كما يُضاف الأطباء تلقائياً عند تسجيلهم في صفحة الموظفون كطبيب معالج.</p>
        <div class="chips" id="docChips">
          ${ctx.doctors.map(c => `
            <span class="chip" style="display:inline-flex; align-items:center; gap:.4rem">
              <span>${esc(c.name)}</span>
              <button type="button" class="del-doc" data-id="${c.id}" data-name="${esc(c.name)}" style="background:none; border:none; color:var(--bad); font-weight:bold; cursor:pointer; font-size:1.1rem; line-height:1; padding:0 3px" title="حذف هذا الطبيب">×</button>
            </span>
          `).join('') || '<span class="muted">لا يوجد أطباء مسجلون</span>'}
        </div>
        <form class="row" data-t="doctors" style="margin-top:.8rem">
          <input name="name" placeholder="طبيب جديد" required>
          <button class="btn">إضافة</button>
        </form>
      </div>
    </div>`;

    bindGeneral();

    // تشغيل النسخ الاحتياطي من صفحة الإعدادات
    const runBackup = () => executeBackup(ctx);
    root.querySelector('#backupFromSettingsTop').onclick = runBackup;
    root.querySelector('#backupFromSettingsBtn').onclick = runBackup;

    // حذف طبيب فردي بالنقر على ×
    root.querySelector('#docChips').onclick = async e => {
      const btn = e.target.closest('.del-doc');
      if (!btn) return;
      const name = btn.dataset.name;
      const id = btn.dataset.id;
      if (!confirm(`هل أنت متأكد من حذف الطبيب «${name}» من النظام؟`)) return;
      if (String(id).startsWith('emp_')) {
        toast('هذا الطبيب مضاف كموظف؛ لتعديله أو إيقافه افتح شاشة الموظفون', 'wait');
        return;
      }
      const { error } = await sb.from('doctors').delete().eq('id', id);
      if (error) return toast(errMsg(error), 'bad');
      toast(`تم حذف الطبيب «${name}» بنجاح`);
      await ctx.loadLookups();
      draw();
    };

    // زر الحذف السريع للطبيب علي والأطباء التجريبيين
    const cleanAliBtn = root.querySelector('#cleanAliBtn');
    if (cleanAliBtn) {
      cleanAliBtn.onclick = async () => {
        if (!confirm('تأكيد حذف الطبيب «علي» والأطباء التجريبيين غير المعتمدين (علي، غلي، ابابيل، احمد، ايمن، عبير)؟')) return;
        const testNames = ['علي', 'غلي', 'ابابيل', 'احمد', 'ايمن', 'عبير'];
        const { error } = await sb.from('doctors').delete().in('name', testNames);
        toast(error ? errMsg(error) : 'تم حذف الطبيب علي والأطباء التجريبيين بنجاح', error ? 'bad' : 'ok');
        await ctx.loadLookups();
        draw();
      };
    }

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

    // إضافة مستخدم جديد
    root.querySelector('#addUserBtn').onclick = () => {
      openAddUserModal(unlinkedEmps);
    };

    // تغيير صورة المستخدم من الجدول
    let targetUserForAvatar = null;
    const tableAvatarInput = root.querySelector('#tableAvatarInput');
    tableAvatarInput.onchange = async e => {
      const file = e.target.files[0];
      if (!file || !targetUserForAvatar) return;
      try {
        toast('جارٍ معالجة ورفع الصورة...', 'wait');
        const compressed = await compressAvatar(file, 300);
        const { error } = await sb.from('profiles').update({ avatar_url: compressed }).eq('id', targetUserForAvatar.id);
        if (error) throw error;
        toast('تم تحديث الصورة بنجاح');
        if (targetUserForAvatar.id === ctx.profile.id) {
          ctx.profile.avatar_url = compressed;
          const topAv = document.querySelector('#userWidget .avatar');
          if (topAv) topAv.innerHTML = `<img src="${compressed}" alt="">`;
        }
        draw();
      } catch (err) {
        toast(errMsg(err), 'bad');
      } finally {
        tableAvatarInput.value = '';
        targetUserForAvatar = null;
      }
    };

    // تعديل بيانات المستخدم أو تغيير كلمة المرور أو رفع الصورة
    const utbody = root.querySelector('#usersTbody');
    utbody.onchange = async e => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const { error } = await sb.from('profiles').update({
        full_name: tr.querySelector('.nm').value.trim(),
        role: tr.querySelector('.rl').value,
        active: tr.querySelector('.ac').checked
      }).eq('id', tr.dataset.id);
      toast(error ? errMsg(error) : 'تم حفظ تعديل المستخدم', error ? 'bad' : 'ok');
    };

    utbody.onclick = async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const u = (users || []).find(x => x.id === tr?.dataset.id);
      if (!u) return;

      if (btn.dataset.act === 'resetPw') {
        openResetPasswordModal(u);
      } else if (btn.dataset.act === 'uploadAvatar') {
        targetUserForAvatar = u;
        tableAvatarInput.click();
      }
    };

    root.querySelectorAll('form[data-t]').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.from(f.dataset.t).insert({ name: new FormData(f).get('name').trim() });
      if (error) return toast(errMsg(error), 'bad');
      draw();
    });
  }

  // نافذة إضافة مستخدم جديد بواسطة المدير
  function openAddUserModal(unlinkedEmps) {
    let chosenAvatarData = null;
    const body = openModal(`<h2>إضافة مستخدم جديد للنظام</h2>
      <form id="addUserForm" class="grid">
        <div style="grid-column:1/-1; text-align:center">
          <div id="newAvPreview" style="display:inline-block; cursor:pointer" title="اختيار صورة شخصية للمستخدم">
            <div class="avatar" style="width:68px; height:68px; font-size:1.8rem; margin:0 auto; border-width:2px">
              👤
            </div>
            <div style="font-size:.82rem; color:var(--brand); margin-top:.3rem; font-weight:600">📷 اختيار صورة (اختياري)</div>
          </div>
          <input type="file" id="newAvInput" accept="image/png,image/jpeg,image/webp" style="display:none">
        </div>

        <div style="grid-column:1/-1">
          <label>الاسم الكامل *</label>
          <input name="full_name" required placeholder="مثال: د. أحمد محمد أو سارة علي">
        </div>
        <div>
          <label>اسم المستخدم لتسجيل الدخول *</label>
          <input name="username" required dir="ltr" pattern="[a-zA-Z0-9_.-]+" placeholder="مثال: ahmed أو dr_nour">
          <span class="muted small">أحرف إنجليزية وأرقام بدون مسافات</span>
        </div>
        <div>
          <label>كلمة المرور *</label>
          <input name="password" type="password" required dir="ltr" minlength="6" placeholder="6 خانات على الأقل">
        </div>
        <div>
          <label>الدور والصلاحية *</label>
          <select name="role" required>
            ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>ربط بحساب موظف (اختياري)</label>
          <select name="employee_id">
            <option value="">بدون ربط بموظف حالي</option>
            ${(unlinkedEmps || []).map(emp => `<option value="${emp.id}">${esc(emp.full_name)}</option>`).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1; margin-top:.8rem">
          <button class="btn primary" id="saveUserBtn" style="width:100%">إنشاء حساب المستخدم وتفعيله</button>
        </div>
      </form>`);

    const newAvPreview = body.querySelector('#newAvPreview');
    const newAvInput = body.querySelector('#newAvInput');
    newAvPreview.onclick = () => newAvInput.click();

    newAvInput.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        chosenAvatarData = await compressAvatar(file, 300);
        newAvPreview.querySelector('.avatar').innerHTML = `<img src="${chosenAvatarData}" alt="">`;
      } catch (err) {
        toast('تعذر قراءة الصورة', 'bad');
      }
    };

    body.querySelector('#addUserForm').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = body.querySelector('#saveUserBtn');
      btn.disabled = true;
      btn.textContent = 'جارٍ إنشاء الحساب...';

      const cleanUser = f.username.trim().toLowerCase();
      const fullName = N.cleanText(f.full_name);
      const role = f.role;
      const pwd = f.password;

      let createdUserId = null;
      const { data: res, error: rpcErr } = await sb.rpc('admin_create_user', {
        p_username: cleanUser,
        p_password: pwd,
        p_full_name: fullName,
        p_role: role
      });

      if (!rpcErr && res) {
        createdUserId = res.id;
      } else {
        const syntheticEmail = `${cleanUser}@clinic.local`;
        const { data: authData, error: authErr } = await sb.auth.signUp({
          email: syntheticEmail,
          password: pwd,
          options: {
            data: { full_name: fullName, username: cleanUser, role }
          }
        });

        if (authErr) {
          btn.disabled = false;
          btn.textContent = 'إنشاء حساب المستخدم وتفعيله';
          const msg = rpcErr ? errMsg(rpcErr) : errMsg(authErr);
          return toast(msg.includes('مسجل مسبقاً') ? 'اسم المستخدم مسجل مسبقاً' : msg, 'bad');
        }

        createdUserId = authData.user?.id;
        if (createdUserId) {
          await sb.from('profiles').upsert({
            id: createdUserId,
            full_name: fullName,
            username: cleanUser,
            role,
            active: true
          });
        }
      }

      // حفظ الصورة إن تم اختيارها
      if (createdUserId && chosenAvatarData) {
        await sb.from('profiles').update({ avatar_url: chosenAvatarData }).eq('id', createdUserId);
      }

      if (f.employee_id && createdUserId) {
        await sb.from('employees').update({ user_id: createdUserId }).eq('id', f.employee_id);
      }

      toast(`تم إنشاء المستخدم «${cleanUser}» بنجاح`);
      closeModal();
      draw();
    };
  }

  // نافذة تغيير كلمة المرور لأي مستخدم بواسطة المدير
  function openResetPasswordModal(user) {
    const body = openModal(`<h2>تغيير كلمة المرور</h2>
      <p class="muted">تعيين كلمة مرور جديدة للمستخدم: <b>${esc(user.full_name)}</b> (${esc(user.username || 'بدون اسم مستخدم')})</p>
      <form id="resetPwForm" class="grid">
        <div style="grid-column:1/-1">
          <label>كلمة المرور الجديدة *</label>
          <input name="new_password" type="password" required dir="ltr" minlength="6" placeholder="6 خانات على الأقل">
        </div>
        <div style="grid-column:1/-1; margin-top:.6rem">
          <button class="btn primary" id="savePwBtn" style="width:100%">تحديث كلمة المرور</button>
        </div>
      </form>`);

    body.querySelector('#resetPwForm').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = body.querySelector('#savePwBtn');
      btn.disabled = true;

      const { error } = await sb.rpc('admin_set_user_password', {
        p_user_id: user.id,
        p_new_password: f.new_password
      });

      if (error) {
        btn.disabled = false;
        return toast(errMsg(error), 'bad');
      }

      toast('تم تغيير كلمة المرور بنجاح');
      closeModal();
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
