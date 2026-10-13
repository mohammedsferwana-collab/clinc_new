import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg, ROLES } from './ui.js';
import { exportBar } from './export.js';
import { compressAvatar } from './app.js';

const KIND = { id: 'صورة الهوية', certificate: 'شهادة جامعية', course: 'دورة تدريبية', other: 'أخرى' };
const BUCKET = 'employee-files';
const hhmm = t => (t || '').slice(0, 5);

// تسميات الأدوار المعتمدة
const ROLE_TITLES = {
  admin: 'مدير',
  doctor: 'دكتور',
  reception: 'سكرتاريا',
  pharmacy: 'صيدلي'
};

export function renderEmployees(root, ctx) {
  const { sb } = ctx;
  let list = [];

  root.innerHTML = `
    <header class="pagehead">
      <div>
        <h1 style="margin:0">الموظفون وحسابات الدخول</h1>
        <p class="muted small" style="margin:.2rem 0 0">إدارة حسابات موظفي المركز وأدوارهم وصورهم وصلاحيات الدخول بالكامل</p>
      </div>
      <div class="row" id="tools" style="gap:.5rem">
        <input id="f" placeholder="بحث بالاسم، اسم المستخدم، أو التخصص" style="width:260px">
        <button class="btn" id="importEmpBtn" title="استيراد موظفين من ملف إكسل">+ إضافة بإكسل</button>
        <button class="btn primary" id="new">+ إضافة موظف وحساب جديد</button>
      </div>
    </header>
    <div id="list"></div>
  `;

  const tools = root.querySelector('#tools');
  tools.append(exportBar(() => ({
    title: 'قائمة الموظفين وحسابات الدخول', subtitle: 'تاريخ التصدير: ' + N.todayISO(), filename: 'الموظفون-' + N.todayISO(),
    sections: [{ heading: 'الموظفون والحسابات', columns: ['الاسم الرباعي', 'اسم المستخدم', 'الدور', 'الهوية', 'التواصل', 'التخصص', 'الدوام', 'الحالة'],
      rows: list.map(e => [e.full_name, e.username || '—', ROLE_TITLES[e.role] || e.role, e.national_id || '', e.phone || '', e.specialty || '', hhmm(e.work_start) + ' – ' + hhmm(e.work_end), e.active ? 'مفعّل' : 'متوقف']) }],
  })));

  // جلب ودمج الموظفين والحسابات بحيث لا يوجد أي فصل بين الموظف والمستخدم
  async function load() {
    try {
      const [{ data: emps, error: eErr }, { data: profs, error: pErr }] = await Promise.all([
        sb.from('employees').select('*, employee_files(count)').order('full_name'),
        sb.from('profiles').select('*').order('created_at')
      ]);

      if (eErr && pErr) throw eErr || pErr;

      const profMap = new Map((profs || []).map(p => [p.id, p]));
      const unifiedList = [];

      // 1. الموظفون المسجلون في جدول employees
      (emps || []).forEach(emp => {
        const p = emp.user_id ? profMap.get(emp.user_id) : null;
        if (emp.user_id) profMap.delete(emp.user_id);
        unifiedList.push({
          ...emp,
          user_id: emp.user_id || (p ? p.id : null),
          username: p ? p.username : null,
          role: p ? p.role : (emp.specialty && /طبيب|دكتور/i.test(emp.specialty) ? 'doctor' : 'reception'),
          avatar_url: p ? p.avatar_url : null,
          active: emp.active !== false && (!p || p.active !== false)
        });
      });

      // 2. الحسابات المسجلة في profiles التي ليس لها صف موظف بعد (مثل المدير الأول)
      for (const [uid, p] of profMap.entries()) {
        unifiedList.push({
          id: 'prof_' + uid,
          user_id: uid,
          full_name: p.full_name || p.username || 'مدير النظام',
          username: p.username || 'admin',
          role: p.role || 'admin',
          avatar_url: p.avatar_url,
          national_id: null,
          phone: null,
          gender: null,
          specialty: p.role === 'admin' ? 'إدارة المركز' : (p.role === 'doctor' ? 'طبيب معالج' : 'موظف'),
          work_start: '08:00',
          work_end: '15:00',
          grace_minutes: 0,
          active: p.active !== false,
          notes: null,
          is_profile_only: true
        });
      }

      list = unifiedList;
      draw();
    } catch (err) {
      toast(errMsg(err), 'bad');
    }
  }

  function draw() {
    const t = N.arNorm(root.querySelector('#f').value);
    const rows = list.filter(e => !t || N.arNorm([e.full_name, e.username, e.national_id, e.specialty, e.phone].join(' ')).includes(t));

    root.querySelector('#list').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr>
          <th style="width:48px; text-align:center">الصورة</th>
          <th>الاسم الكامل</th>
          <th>اسم المستخدم للدخول</th>
          <th>الدور والصلاحية</th>
          <th>التخصص / الوظيفة</th>
          <th>الهوية والتواصل</th>
          <th>الدوام</th>
          <th>الحالة</th>
          <th>إجراءات</th>
        </tr></thead><tbody>${rows.map(e => `
        <tr data-id="${e.id}">
          <td style="width:48px; text-align:center">
            <div class="avatar" style="width:36px; height:36px; font-size:.95rem; margin:0 auto">
              ${e.avatar_url ? `<img src="${esc(e.avatar_url)}" alt="">` : esc((e.full_name || 'م').slice(0, 1))}
            </div>
          </td>
          <td><b>${esc(e.full_name)}</b></td>
          <td><code style="background:var(--bg); padding:2px 7px; border-radius:var(--r); font-weight:600">${esc(e.username || 'بدون حساب')}</code></td>
          <td><span class="role-badge role-${e.role}">${ROLE_TITLES[e.role] || e.role}</span></td>
          <td>${esc(e.specialty || '—')}</td>
          <td>${esc(e.national_id || '—')}<br><span class="muted small">${esc(e.phone || '—')}</span></td>
          <td>${hhmm(e.work_start)} – ${hhmm(e.work_end)}</td>
          <td><span class="badge ${e.active ? 'ok' : 'bad'}">${e.active ? 'مفعّل' : 'متوقف'}</span></td>
          <td class="row" style="gap:.25rem; flex-wrap:nowrap">
            <button class="btn sm" data-act="edit" title="تعديل بيانات وحساب الموظف">تعديل</button>
            <button class="btn sm" data-act="resetPw" title="تعيين كلمة مرور جديدة">كلمة المرور</button>
            <button class="btn sm danger" data-act="del" title="حذف الموظف وحسابه نهائياً">حذف</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا يوجد موظفون. اضغط «+ إضافة موظف وحساب جديد» لإضافة الموظفين وتحديد صلاحياتهم.</div>';
  }

  root.querySelector('#f').oninput = draw;

  root.querySelector('#list').onclick = e => {
    const btn = e.target.closest('button[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const item = list.find(x => x.id === tr.dataset.id);
    if (!item) return;

    if (btn) {
      if (btn.dataset.act === 'edit') openEmployee(ctx, item, load);
      else if (btn.dataset.act === 'resetPw') openResetPasswordModal(ctx, item);
      else if (btn.dataset.act === 'del') deleteEmployeeUnified(ctx, item, load);
    } else {
      openEmployee(ctx, item, load);
    }
  };

  root.querySelector('#new').onclick = () => openEmployee(ctx, null, load);
  root.querySelector('#importEmpBtn').onclick = () => openEmployeesExcelImport(ctx, list, load);
  load();
}

// نافذة تعديل أو إضافة موظف وحساب موحدة بالكامل
async function openEmployee(ctx, emp, done) {
  const { sb } = ctx;
  const v = emp || {
    work_start: '08:00', work_end: '15:00', grace_minutes: 0, active: true,
    role: 'reception', specialty: ''
  };

  let chosenAvatar = v.avatar_url || null;

  const body = openModal(`<h2>${emp ? 'تعديل بيانات وحساب: ' + esc(emp.full_name) : 'إضافة موظف ومستخدم جديد'}</h2>
    <form id="ef" class="grid">
      <!-- الصورة الشخصية للموظف/المستخدم -->
      <div style="grid-column:1/-1; text-align:center; padding-bottom:.4rem">
        <div id="empAvWrap" style="display:inline-block; cursor:pointer" title="انقر لاختيار صورة شخصية">
          <div class="avatar" style="width:72px; height:72px; font-size:1.8rem; margin:0 auto; border-width:2.5px" id="empAvDisplay">
            ${chosenAvatar ? `<img src="${esc(chosenAvatar)}" alt="">` : esc((v.full_name || 'م').slice(0, 1))}
          </div>
          <div style="font-size:.82rem; color:var(--brand); margin-top:.3rem; font-weight:600">📷 اختيار صورة شخصية</div>
        </div>
        <input type="file" id="empAvInput" accept="image/png,image/jpeg,image/webp" style="display:none">
      </div>

      <!-- الاسم الرباعي -->
      <div style="grid-column:1/-1">
        <label>الاسم الرباعي الكامل *</label>
        <input name="full_name" required value="${esc(v.full_name || '')}" placeholder="مثال: د. محمد أحمد سعيد">
      </div>

      <!-- اسم المستخدم للدخول -->
      <div>
        <label>اسم المستخدم للدخول (Username) *</label>
        <input name="username" required dir="ltr" pattern="[a-zA-Z0-9_.-]+" value="${esc(v.username || '')}" placeholder="مثال: dr_nour أو reception1">
        <span class="muted small">أحرف إنجليزية وأرقام بدون مسافات</span>
      </div>

      <!-- كلمة المرور -->
      <div>
        <label>كلمة المرور ${emp ? '(اتركه فارغاً إن لم ترغب بتغييرها)' : '*'}</label>
        <input name="password" type="password" dir="ltr" minlength="6" ${emp ? '' : 'required'} placeholder="6 خانات على الأقل">
      </div>

      <!-- الدور والصلاحية في المركز -->
      <div>
        <label>الدور والصلاحية في المركز *</label>
        <select name="role" required>
          <option value="doctor" ${v.role === 'doctor' ? 'selected' : ''}>دكتور / طبيب معالج</option>
          <option value="reception" ${v.role === 'reception' ? 'selected' : ''}>سكرتاريا واستقبال</option>
          <option value="pharmacy" ${v.role === 'pharmacy' ? 'selected' : ''}>صيدلي / صيدلية</option>
          <option value="admin" ${v.role === 'admin' ? 'selected' : ''}>مدير النظام (كامل الصلاحيات)</option>
        </select>
      </div>

      <!-- التخصص / المسمى الوظيفي -->
      <div>
        <label>التخصص / المسمى الوظيفي</label>
        <input name="specialty" value="${esc(v.specialty || '')}" placeholder="مثال: طبيب عام، صيدلاني، تمريض، محاسب">
      </div>

      <!-- رقم الهوية -->
      <div>
        <label>رقم الهوية</label>
        <input name="national_id" inputmode="numeric" value="${esc(v.national_id || '')}" placeholder="رقم الهوية (9 أرقام)">
      </div>

      <!-- رقم التواصل -->
      <div>
        <label>رقم التواصل / الجوال</label>
        <input name="phone" inputmode="tel" value="${esc(v.phone || '')}" placeholder="مثال: 0599123456">
      </div>

      <!-- الجنس -->
      <div>
        <label>الجنس</label>
        <select name="gender">
          <option value="">—</option>
          <option value="ذكر" ${v.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
          <option value="أنثى" ${v.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
        </select>
      </div>

      <!-- ساعات الدوام -->
      <div>
        <label>بداية الدوام</label>
        <input name="work_start" type="time" required value="${hhmm(v.work_start)}">
      </div>
      <div>
        <label>نهاية الدوام</label>
        <input name="work_end" type="time" required value="${hhmm(v.work_end)}">
      </div>
      <div>
        <label>مهلة التأخير (دقائق)</label>
        <input name="grace_minutes" type="number" min="0" value="${v.grace_minutes || 0}">
      </div>

      <!-- ملاحظات -->
      <div style="grid-column:1/-1">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}">
      </div>

      <div>
        <label><input type="checkbox" name="active" ${v.active ? 'checked' : ''} style="width:auto"> الحساب مفعّل وعلى رأس العمل</label>
      </div>

      <div style="grid-column:1/-1" class="row">
        <button class="btn primary" id="saveEmpBtn" style="flex:1">
          ${emp ? '✓ حفظ التعديلات' : '✓ إنشاء الموظف والحساب'}
        </button>
        ${emp ? '<button type="button" class="btn danger" id="delEmpBtn">حذف الموظف وحسابه</button>' : ''}
      </div>
    </form>
    <div id="filesSection"></div>`, { wide: true });

  const avWrap = body.querySelector('#empAvWrap');
  const avInput = body.querySelector('#empAvInput');
  const avDisplay = body.querySelector('#empAvDisplay');

  avWrap.onclick = () => avInput.click();
  avInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      chosenAvatar = await compressAvatar(file, 300);
      avDisplay.innerHTML = `<img src="${chosenAvatar}" alt="">`;
    } catch {
      toast('تعذر معالجة الصورة', 'bad');
    }
  };

  body.querySelector('#ef').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = body.querySelector('#saveEmpBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ الحفظ...';

    const cleanUser = f.username.trim().toLowerCase();
    const fullName = N.cleanText(f.full_name);
    const role = f.role;
    const pwd = f.password;
    const isActive = !!f.active;

    try {
      let userId = emp?.user_id;

      if (!emp || !userId || emp.is_virtual) {
        // إنشاء مستخدم جديد
        const { data: res, error: rpcErr } = await sb.rpc('admin_create_user', {
          p_username: cleanUser,
          p_password: pwd,
          p_full_name: fullName,
          p_role: role
        });

        if (!rpcErr && res) {
          userId = res.id;
        } else {
          // بديل مباشر عبر البريد الاصطناعي
          const synthEmail = `${cleanUser}@clinic.local`;
          const { data: aData, error: aErr } = await sb.auth.signUp({
            email: synthEmail,
            password: pwd,
            options: { data: { full_name: fullName, username: cleanUser, role } }
          });
          if (aErr) throw new Error(aErr.message.includes('مسجل مسبقاً') ? 'اسم المستخدم مسجل مسبقاً' : errMsg(aErr));
          userId = aData.user?.id;
          if (userId) {
            await sb.from('profiles').upsert({ id: userId, full_name: fullName, username: cleanUser, role, active: isActive });
          }
        }

        // حفظ الصورة الشخصية
        if (userId && chosenAvatar) {
          await sb.from('profiles').update({ avatar_url: chosenAvatar }).eq('id', userId);
        }
      } else {
        // تحديث الحساب الحالي
        await sb.rpc('admin_update_user', {
          p_user_id: userId,
          p_username: cleanUser,
          p_full_name: fullName,
          p_role: role,
          p_active: isActive,
          p_avatar_url: chosenAvatar
        });

        // إذا تم إدخال كلمة مرور جديدة
        if (pwd && pwd.length >= 6) {
          await sb.rpc('admin_set_user_password', { p_user_id: userId, p_new_password: pwd });
        }
      }

      // حفظ أو تحديث سجل الموظف في جدول employees
      const empRec = {
        full_name: fullName,
        national_id: N.cleanId(f.national_id),
        phone: N.cleanPhone(f.phone),
        gender: f.gender || null,
        specialty: N.cleanText(f.specialty) || null,
        work_start: f.work_start,
        work_end: f.work_end,
        grace_minutes: parseInt(f.grace_minutes) || 0,
        user_id: userId || null,
        notes: N.cleanText(f.notes) || null,
        active: isActive
      };

      if (emp && emp.id && !emp.is_virtual && !String(emp.id).startsWith('prof_')) {
        await sb.from('employees').update(empRec).eq('id', emp.id);
      } else {
        await sb.from('employees').upsert(empRec, { onConflict: 'user_id' });
      }

      // إذا كان الدور طبيب معالج، مزامنته في جدول doctors
      if (role === 'doctor' || /طبيب|دكتور/i.test(empRec.specialty || '')) {
        const { data: exDoc } = await sb.from('doctors').select('id').eq('name', fullName).maybeSingle();
        if (!exDoc) await sb.from('doctors').insert({ name: fullName });
      }

      // إذا كان الموظف هو المستخدم الحالي، تحديث الكائن فوراً في الأعلى
      if (userId === ctx.profile.id) {
        ctx.profile.full_name = fullName;
        ctx.profile.username = cleanUser;
        ctx.profile.role = role;
        if (chosenAvatar) ctx.profile.avatar_url = chosenAvatar;
        ctx.paint(ctx.settings);
      }

      await ctx.loadLookups();
      toast('تم حفظ بيانات وحساب الموظف بنجاح');
      closeModal();
      await done();
    } catch (err) {
      toast(errMsg(err), 'bad');
      btn.disabled = false;
      btn.textContent = emp ? '✓ حفظ التعديلات' : '✓ إنشاء الموظف والحساب';
    }
  };

  if (emp) {
    const delBtn = body.querySelector('#delEmpBtn');
    if (delBtn) delBtn.onclick = () => deleteEmployeeUnified(ctx, emp, () => { closeModal(); done(); });
    filesSection(ctx, emp, body.querySelector('#filesSection'));
  }
}

// دالة حذف الموظف وحسابه نهائياً
async function deleteEmployeeUnified(ctx, emp, onDone) {
  const { sb } = ctx;
  if (emp.user_id === ctx.profile.id) {
    return toast('لا يمكنك حذف حسابك الشخصي الذي تستخدمه حالياً', 'bad');
  }

  if (!confirm(`هل أنت متأكد من حذف الموظف «${emp.full_name}» وحساب دخوله (${emp.username || 'بدون اسم مستخدم'}) نهائياً؟\nسيتم حذف جميع ملفاته وسجل حضوره ولا يمكن التراجع.`)) return;

  try {
    // 1. حذف المرفقات والملفات
    if (emp.id && !String(emp.id).startsWith('prof_')) {
      const { data: fs } = await sb.from('employee_files').select('path').eq('employee_id', emp.id);
      if (fs?.length) await sb.storage.from(BUCKET).remove(fs.map(x => x.path));
      await sb.from('employees').delete().eq('id', emp.id);
    }

    // 2. حذف الحساب من Supabase Auth و Profiles
    if (emp.user_id) {
      await sb.rpc('admin_delete_user', { p_user_id: emp.user_id });
    }

    // 3. إن كان طبيباً، حذفه من قائمة الأطباء إن رغب
    if (emp.role === 'doctor') {
      await sb.from('doctors').delete().eq('name', emp.full_name);
    }

    await ctx.loadLookups();
    toast('تم حذف الموظف وحساب دخوله بنجاح');
    if (onDone) onDone();
  } catch (err) {
    toast(errMsg(err), 'bad');
  }
}

// نافذة تعيين كلمة مرور للموظف/المستخدم
function openResetPasswordModal(ctx, user) {
  const { sb } = ctx;
  const body = openModal(`<h2>تعيين كلمة مرور للموظف</h2>
    <p class="muted">تعيين كلمة مرور جديدة للموظف: <b>${esc(user.full_name)}</b> (${esc(user.username || 'بدون اسم مستخدم')})</p>
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
    const btn = body.querySelector('#savePwBtn');
    btn.disabled = true;
    const newPw = e.target.new_password.value;

    const { error } = await sb.rpc('admin_set_user_password', {
      p_user_id: user.user_id,
      p_new_password: newPw
    });

    if (error) {
      btn.disabled = false;
      return toast(errMsg(error), 'bad');
    }

    toast('تم تحديث كلمة المرور بنجاح');
    closeModal();
  };
}

// قسم إدارة ملفات ومرفقات الموظف
async function filesSection(ctx, emp, box) {
  const { sb } = ctx;
  if (!emp.id || String(emp.id).startsWith('prof_')) {
    box.innerHTML = '<p class="muted small">يمكن رفع الوثائق والشهادات بعد حفظ بيانات الموظف.</p>';
    return;
  }

  async function drawFiles() {
    const { data, error } = await sb.from('employee_files').select('*').eq('employee_id', emp.id).order('created_at');
    if (error) return;
    box.innerHTML = `<h3>المرفقات والوثائق الرسمية</h3>
      <div class="filebox">${data.length ? data.map(f => `<div class="filerow" data-id="${f.id}" data-path="${esc(f.path)}">
        <span><b>${KIND[f.kind]}</b>${f.title ? ' — ' + esc(f.title) : ''} <span class="muted small">${esc(f.file_name || '')}</span></span>
        <span><button class="btn sm" data-a="open">عرض</button> <button class="btn sm danger" data-a="del">حذف</button></span></div>`).join('') : '<span class="muted">لا توجد مرفقات بعد.</span>'}</div>
      <form id="uf" class="row" style="margin-top:.8rem"><div><label>النوع</label><select name="kind">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
      <div style="flex:1;min-width:160px"><label>الوصف (مثل: شهادة مزاولة مهنة)</label><input name="title"></div>
      <div><label>الملف (صورة أو PDF)</label><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple required></div>
      <button class="btn primary">رفع الملف</button></form>`;

    box.querySelector('.filebox').onclick = async e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const row = b.closest('.filerow');
      if (b.dataset.a === 'open') {
        const w = window.open('', '_blank');
        const { data: s, error: er } = await sb.storage.from(BUCKET).createSignedUrl(row.dataset.path, 120);
        if (er) { w?.close(); return toast(errMsg(er), 'bad'); }
        if (w) w.location = s.signedUrl; else toast('اسمح بالنوافذ المنبثقة لعرض الملف', 'bad');
      } else if (confirm('حذف هذا المرفق؟')) {
        await sb.storage.from(BUCKET).remove([row.dataset.path]);
        const { error: er } = await sb.from('employee_files').delete().eq('id', row.dataset.id);
        if (er) return toast(errMsg(er), 'bad');
        drawFiles();
      }
    };

    box.querySelector('#uf').onsubmit = async e => {
      e.preventDefault();
      const f = e.target, kind = f.kind.value, title = N.cleanText(f.title.value) || null, btn = f.querySelector('button');
      btn.disabled = true;
      try {
        for (const file of f.file.files) {
          if (file.size > 10 * 1024 * 1024) throw new Error(`الملف «${file.name}» أكبر من 10 ميجابايت`);
          const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          const path = `${emp.id}/${crypto.randomUUID()}.${ext}`;
          const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type });
          if (up.error) throw up.error;
          await sb.from('employee_files').insert({ employee_id: emp.id, kind, title, path, file_name: file.name });
        }
        toast('تم رفع الملفات بنجاح');
        drawFiles();
      } catch (er) { toast(errMsg(er), 'bad'); btn.disabled = false; }
    };
  }
  drawFiles();
}

// استيراد الموظفين من ملف إكسل
function openEmployeesExcelImport(ctx, existingList, onDone) {
  const { sb } = ctx;

  const body = openModal(`<h2>استيراد موظفين من ملف إكسل</h2>
    <div class="panel" style="margin-bottom:1rem">
      <p>يمكنك إضافة مجموعة من الموظفين دفعة واحدة من ملف إكسل (.xlsx أو .xls أو .csv).</p>
      <div class="row" style="gap:.6rem; margin-top:.5rem">
        <button class="btn sm" id="dlEmpTemplateBtn">⬇ تحميل نموذج إكسل للموظفين</button>
        <span class="muted small">يحتوي النموذج على الأعمدة: الاسم الرباعي، رقم الهوية، رقم التواصل، الجنس، التخصص، بداية الدوام، نهاية الدوام، مهلة التأخير، ملاحظات.</span>
      </div>
    </div>

    <div style="margin-bottom:1rem">
      <label>اختر ملف الإكسل</label>
      <input type="file" id="empExcelFile" accept=".xlsx,.xls,.csv">
    </div>

    <div id="empImportPreview" style="max-height:280px; overflow-y:auto; margin-bottom:1rem"></div>

    <div class="row between" id="empImportActions" hidden>
      <span id="empImportSummary" class="muted"></span>
      <button class="btn primary" id="confirmEmpImportBtn">تأكيد واستيراد الموظفين</button>
    </div>`, { wide: true });

  body.querySelector('#dlEmpTemplateBtn').onclick = () => {
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    const headers = ['الاسم الرباعي', 'رقم الهوية', 'رقم التواصل', 'الجنس', 'التخصص / الوظيفة', 'بداية الدوام', 'نهاية الدوام', 'مهلة التأخير (دقائق)', 'ملاحظات'];
    const sampleData = [
      headers,
      ['د. محمد أحمد سعيد', '900123456', '0599123456', 'ذكر', 'طبيب عام', '08:00', '15:00', 15, 'دوام صباحي'],
      ['سارة محمود خالد', '900654321', '0599654321', 'أنثى', 'صيدلانية', '08:00', '15:00', 10, 'مسؤولة الصيدلية'],
      ['إياد كمال ناصر', '900789123', '0599789123', 'ذكر', 'تمريض', '08:00', '15:00', 0, 'قسم التمريض']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = [{ wch: 26 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
    XLSX.writeFile(wb, 'نموذج_الموظفون.xlsx');
  };

  const parseTimeVal = (v, defaultVal) => {
    if (v == null || v === '') return defaultVal;
    if (typeof v === 'number' && v >= 0 && v < 1) {
      const totalSecs = Math.round(v * 86400);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const s = String(v).trim();
    const match = s.match(/(\d{1,2}):(\d{2})/);
    if (match) return `${String(match[1]).padStart(2, '0')}:${match[2]}`;
    return defaultVal;
  };

  let parsedEmployees = [];
  const fileInput = body.querySelector('#empExcelFile');
  const previewDiv = body.querySelector('#empImportPreview');
  const actionsDiv = body.querySelector('#empImportActions');
  const summarySpan = body.querySelector('#empImportSummary');
  const confirmBtn = body.querySelector('#confirmEmpImportBtn');

  fileInput.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, raw: true, defval: '' });

      if (!rawRows || rawRows.length < 2) {
        previewDiv.innerHTML = '<p class="muted bad">الملف فارغ أو لا يحتوي على صفوف بيانات.</p>';
        actionsDiv.hidden = true;
        return;
      }

      let headerIdx = -1;
      for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
        const rowStr = rawRows[i].map(c => String(c).trim()).join(' ');
        if (/اسم|موظف|هوية|وظيفة/i.test(rowStr)) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx === -1) headerIdx = 0;

      const headers = rawRows[headerIdx].map(c => String(c).trim());
      const nameCol = headers.findIndex(h => /اسم.*رباعي|^الاسم$|name|employee/i.test(h));
      const idCol = headers.findIndex(h => /هوي|national|id/i.test(h));
      const phoneCol = headers.findIndex(h => /هاتف|جوال|موبايل|تواصل|phone|mobile/i.test(h));
      const genderCol = headers.findIndex(h => /جنس|gender/i.test(h));
      const specCol = headers.findIndex(h => /تخصص|وظيفة|مهنة|specialty|job/i.test(h));
      const startCol = headers.findIndex(h => /بداية.*دوام|حضور|start/i.test(h));
      const endCol = headers.findIndex(h => /نهاية.*دوام|انصراف|end/i.test(h));
      const graceCol = headers.findIndex(h => /مهلة|تأخير|grace/i.test(h));
      const notesCol = headers.findIndex(h => /ملاحظ|note/i.test(h));

      if (nameCol === -1) {
        previewDiv.innerHTML = '<p class="muted bad">تعذر العثور على عمود «الاسم» في ملف الإكسل.</p>';
        actionsDiv.hidden = true;
        return;
      }

      parsedEmployees = [];
      const existingIds = new Set(existingList.map(emp => emp.national_id).filter(Boolean));

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const fullName = N.cleanText(r[nameCol]);
        if (!fullName) continue;

        const natId = idCol >= 0 ? N.cleanId(r[idCol]) : null;
        const phone = phoneCol >= 0 ? N.cleanPhone(r[phoneCol]) : null;
        const gender = genderCol >= 0 ? N.normGender(r[genderCol]) : null;
        const specialty = specCol >= 0 ? N.cleanText(r[specCol]) : null;
        const workStart = startCol >= 0 ? parseTimeVal(r[startCol], '08:00') : '08:00';
        const workEnd = endCol >= 0 ? parseTimeVal(r[endCol], '15:00') : '15:00';
        const graceMinutes = graceCol >= 0 ? Math.max(0, parseInt(r[graceCol]) || 0) : 0;
        const notes = notesCol >= 0 ? N.cleanText(r[notesCol]) : null;

        parsedEmployees.push({
          full_name: fullName,
          national_id: natId,
          phone,
          gender,
          specialty,
          work_start: workStart,
          work_end: workEnd,
          grace_minutes: graceMinutes,
          notes,
          isDupId: natId && existingIds.has(natId)
        });
      }

      previewDiv.innerHTML = `
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>الاسم الرباعي</th>
                <th>الهوية</th>
                <th>التواصل</th>
                <th>الجنس</th>
                <th>التخصص</th>
                <th>الدوام</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              ${parsedEmployees.map(e => `
                <tr>
                  <td><b>${esc(e.full_name)}</b></td>
                  <td>${esc(e.national_id || '—')}</td>
                  <td>${esc(e.phone || '—')}</td>
                  <td>${esc(e.gender || '—')}</td>
                  <td>${esc(e.specialty || '—')}</td>
                  <td>${esc(e.work_start)} – ${esc(e.work_end)}</td>
                  <td>${e.isDupId ? '<span class="badge bad">تكرار هوية</span>' : '<span class="badge ok">مؤهل للإضافة</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      actionsDiv.hidden = false;
      summarySpan.textContent = `الإجمالي: ${parsedEmployees.length} موظف.`;
    } catch (err) {
      previewDiv.innerHTML = `<p class="bad">خطأ أثناء قراءة الملف: ${esc(err.message)}</p>`;
    }
  };

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جارٍ الاستيراد...';
    let added = 0;

    for (const emp of parsedEmployees) {
      if (emp.isDupId) continue;
      const { error } = await sb.from('employees').insert({
        full_name: emp.full_name,
        national_id: emp.national_id,
        phone: emp.phone,
        gender: emp.gender,
        specialty: emp.specialty,
        work_start: emp.work_start,
        work_end: emp.work_end,
        grace_minutes: emp.grace_minutes,
        notes: emp.notes,
        active: true
      });
      if (!error) added++;
    }

    toast(`تم استيراد ${added} موظف بنجاح`);
    closeModal();
    onDone();
  };
}
