import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg, ROLES } from './ui.js';
import { exportBar } from './export.js';
import { compressAvatar } from './app.js';

const KIND = { id: 'صورة الهوية', certificate: 'الشهادة الجامعية', cv: 'السيرة الذاتية', course: 'دورة تدريبية', other: 'أخرى' };
const BUCKET = 'employee-files';
const hhmm = t => (t || '').slice(0, 5);

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
        <h1 style="margin:0">إدارة الحسابات والصلاحيات والموظفين</h1>
        <p class="muted small" style="margin:.2rem 0 0">إنشاء وتعديل أو إيقاف حسابات (الأطباء، السكرتاريا، الصيدلية) وتوليد كلمات المرور وتحديد الأدوار</p>
      </div>
      <div class="row" id="tools" style="gap:.5rem">
        <input id="f" placeholder="بحث بالاسم، اسم المستخدم، أو التخصص" style="width:260px">
        <button class="btn" id="importEmpBtn" title="استيراد موظفين من ملف إكسل">+ إضافة بإكسل</button>
        <button class="btn primary" id="new">+ إنشاء حساب وموظف جديد</button>
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

  async function load() {
    try {
      const [{ data: emps, error: eErr }, { data: profs, error: pErr }] = await Promise.all([
        sb.from('employees').select('*, employee_files(count)').order('full_name'),
        sb.from('profiles').select('*').order('created_at')
      ]);

      if (eErr && pErr) throw eErr || pErr;

      const profMap = new Map((profs || []).map(p => [p.id, p]));
      const unifiedList = [];

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
            <button class="btn sm" data-act="resetPw" title="تعيين وتوليد كلمة مرور جديدة">كلمة المرور</button>
            <button class="btn sm danger" data-act="del" title="حذف الموظف وحسابه نهائياً">حذف</button>
          </td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا يوجد موظفون. اضغط «+ إنشاء حساب وموظف جديد» لإضافة الحسابات وتحديد صلاحياتهم.</div>';
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

async function openEmployee(ctx, emp, done) {
  const { sb } = ctx;
  const v = emp || {
    work_start: '08:00', work_end: '15:00', grace_minutes: 0, active: true,
    role: 'reception', specialty: ''
  };

  let chosenAvatar = v.avatar_url || null;

  const body = openModal(`<h2>${emp ? 'تعديل بيانات وحساب: ' + esc(emp.full_name) : 'إنشاء حساب وموظف جديد'}</h2>
    <form id="ef" class="grid">
      <div style="grid-column:1/-1; text-align:center; padding-bottom:.4rem">
        <div id="empAvWrap" style="display:inline-block; cursor:pointer" title="انقر لاختيار صورة شخصية">
          <div class="avatar" style="width:72px; height:72px; font-size:1.8rem; margin:0 auto; border-width:2.5px" id="empAvDisplay">
            ${chosenAvatar ? `<img src="${esc(chosenAvatar)}" alt="">` : esc((v.full_name || 'م').slice(0, 1))}
          </div>
          <div style="font-size:.82rem; color:var(--brand); margin-top:.3rem; font-weight:600">📷 اختيار صورة شخصية</div>
        </div>
        <input type="file" id="empAvInput" accept="image/png,image/jpeg,image/webp" style="display:none">
      </div>

      <div style="grid-column:1/-1">
        <label>الاسم الرباعي الكامل *</label>
        <input name="full_name" required value="${esc(v.full_name || '')}" placeholder="مثال: د. محمد أحمد سعيد">
      </div>

      <div>
        <label>اسم المستخدم للدخول (Username) *</label>
        <input name="username" required dir="ltr" pattern="[a-zA-Z0-9_.-]+" value="${esc(v.username || '')}" placeholder="مثال: dr_nour أو reception1">
        <span class="muted small">أحرف إنجليزية وأرقام بدون مسافات</span>
      </div>

      <div>
        <label>كلمة المرور الأولية ${emp ? '(اتركه فارغاً إن لم ترغب بتغييرها)' : '*'}</label>
        <div class="row" style="gap:.35rem; flex-wrap:nowrap">
          <input name="password" id="empPwField" type="text" dir="ltr" minlength="6" ${emp ? '' : 'required'} placeholder="6 خانات على الأقل">
          <button type="button" class="btn sm" id="genPwBtn" title="توليد كلمة مرور عشوائية">🎲 توليد</button>
        </div>
      </div>

      <div>
        <label>الدور والصلاحية في النظام (Role) *</label>
        <select name="role" required>
          <option value="doctor" ${v.role === 'doctor' ? 'selected' : ''}>دكتور / طبيب معالج</option>
          <option value="reception" ${v.role === 'reception' ? 'selected' : ''}>سكرتاريا واستقبال</option>
          <option value="pharmacy" ${v.role === 'pharmacy' ? 'selected' : ''}>صيدلي / صيدلية</option>
          <option value="admin" ${v.role === 'admin' ? 'selected' : ''}>مدير النظام (كامل الصلاحيات)</option>
        </select>
      </div>

      <div>
        <label>التخصص / القسم الطبي</label>
        <input name="specialty" value="${esc(v.specialty || '')}" placeholder="مثال: طبيب عام، أطفال، صيدلاني">
      </div>

      <div>
        <label>رقم الهوية</label>
        <input name="national_id" inputmode="numeric" value="${esc(v.national_id || '')}" placeholder="رقم الهوية (9 أرقام)">
      </div>

      <div>
        <label>رقم التواصل / الجوال</label>
        <input name="phone" inputmode="tel" value="${esc(v.phone || '')}" placeholder="مثال: 0599123456">
      </div>

      <div>
        <label>الجنس</label>
        <select name="gender">
          <option value="">—</option>
          <option value="ذكر" ${v.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
          <option value="أنثى" ${v.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
        </select>
      </div>

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

      <div style="grid-column:1/-1">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}">
      </div>

      <div style="grid-column:1/-1">
        <label><input type="checkbox" name="active" ${v.active ? 'checked' : ''} style="width:auto"> الحساب مفعّل ومسموح له بالدخول للنظام</label>
      </div>

      <div style="grid-column:1/-1" class="row">
        <button class="btn primary" id="saveEmpBtn" style="flex:1">
          ${emp ? '✓ حفظ التعديلات والصلاحيات' : '✓ إنشاء الحساب والموظف'}
        </button>
        ${emp ? '<button type="button" class="btn danger" id="delEmpBtn">حذف الحساب نهائياً</button>' : ''}
      </div>
    </form>
    <div id="filesSection"></div>`, { wide: true });

  body.querySelector('#genPwBtn').onclick = () => {
    body.querySelector('#empPwField').value = 'Cl#' + Math.random().toString(36).slice(2, 8);
  };

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
        const { data: res, error: rpcErr } = await sb.rpc('admin_create_user', {
          p_username: cleanUser,
          p_password: pwd,
          p_full_name: fullName,
          p_role: role
        });

        if (!rpcErr && res) {
          userId = res.id;
        } else {
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

        if (userId && chosenAvatar) {
          await sb.from('profiles').update({ avatar_url: chosenAvatar }).eq('id', userId);
        }
      } else {
        await sb.rpc('admin_update_user', {
          p_user_id: userId,
          p_username: cleanUser,
          p_full_name: fullName,
          p_role: role,
          p_active: isActive,
          p_avatar_url: chosenAvatar
        });

        if (pwd && pwd.length >= 6) {
          await sb.rpc('admin_set_user_password', { p_user_id: userId, p_new_password: pwd });
        }
      }

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

      if (role === 'doctor' || /طبيب|دكتور/i.test(empRec.specialty || '')) {
        const { data: exDoc } = await sb.from('doctors').select('id').eq('name', fullName).maybeSingle();
        if (!exDoc) await sb.from('doctors').insert({ name: fullName });
      }

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
      btn.textContent = emp ? '✓ حفظ التعديلات والصلاحيات' : '✓ إنشاء الحساب والموظف';
    }
  };

  if (emp) {
    const delBtn = body.querySelector('#delEmpBtn');
    if (delBtn) delBtn.onclick = () => deleteEmployeeUnified(ctx, emp, () => { closeModal(); done(); });
    filesSection(ctx, emp, body.querySelector('#filesSection'));
  }
}

async function deleteEmployeeUnified(ctx, emp, onDone) {
  const { sb } = ctx;
  if (emp.user_id === ctx.profile.id) {
    return toast('لا يمكنك حذف حسابك الشخصي الذي تستخدمه حالياً', 'bad');
  }

  if (!confirm(`هل أنت متأكد من حذف الموظف «${emp.full_name}» وحساب دخوله (${emp.username || 'بدون اسم مستخدم'}) نهائياً؟`)) return;

  try {
    if (emp.id && !String(emp.id).startsWith('prof_')) {
      const { data: fs } = await sb.from('employee_files').select('path').eq('employee_id', emp.id);
      if (fs?.length) await sb.storage.from(BUCKET).remove(fs.map(x => x.path));
      await sb.from('employees').delete().eq('id', emp.id);
    }

    if (emp.user_id) {
      await sb.rpc('admin_delete_user', { p_user_id: emp.user_id });
    }

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

function openResetPasswordModal(ctx, user) {
  const { sb } = ctx;
  const body = openModal(`<h2>تعيين وتوليد كلمة مرور جديدة</h2>
    <p class="muted">تعيين كلمة مرور جديدة للموظف: <b>${esc(user.full_name)}</b> (${esc(user.username || 'بدون اسم مستخدم')})</p>
    <form id="resetPwForm" class="grid">
      <div style="grid-column:1/-1">
        <label>كلمة المرور الجديدة *</label>
        <div class="row" style="gap:.4rem; flex-wrap:nowrap">
          <input name="new_password" id="resetPwField" type="text" required dir="ltr" minlength="6" placeholder="6 خانات على الأقل">
          <button type="button" class="btn sm" id="genResetBtn">🎲 توليد</button>
        </div>
      </div>
      <div style="grid-column:1/-1; margin-top:.6rem">
        <button class="btn primary" id="savePwBtn" style="width:100%">تحديث كلمة المرور</button>
      </div>
    </form>`);

  body.querySelector('#genResetBtn').onclick = () => {
    body.querySelector('#resetPwField').value = 'Cl#' + Math.random().toString(36).slice(2, 8);
  };

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

async function filesSection(ctx, emp, box) {
  const { sb } = ctx;
  if (!emp.id || String(emp.id).startsWith('prof_')) {
    box.innerHTML = '<p class="muted small">يمكن رفع الوثائق بعد حفظ بيانات الموظف.</p>';
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
      <div style="flex:1;min-width:160px"><label>الوصف</label><input name="title"></div>
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

function openEmployeesExcelImport(ctx, existingList, onDone) {
  const { sb } = ctx;
  const body = openModal(`<h2>استيراد موظفين من ملف إكسل</h2>
    <div style="margin-bottom:1rem">
      <label>اختر ملف الإكسل</label>
      <input type="file" id="empExcelFile" accept=".xlsx,.xls,.csv">
    </div>
    <div id="empImportPreview" style="max-height:280px; overflow-y:auto; margin-bottom:1rem"></div>
    <div class="row between" id="empImportActions" hidden>
      <span id="empImportSummary" class="muted"></span>
      <button class="btn primary" id="confirmEmpImportBtn">تأكيد واستيراد الموظفين</button>
    </div>`, { wide: true });

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
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      if (!rawRows || rawRows.length < 2) return;
      const headers = rawRows[0].map(c => String(c).trim());
      const nameCol = headers.findIndex(h => /اسم|name/i.test(h));
      if (nameCol === -1) return;
      parsedEmployees = rawRows.slice(1).map(r => ({ full_name: N.cleanText(r[nameCol]) })).filter(x => x.full_name);
      previewDiv.innerHTML = `<p>تم العثور على ${parsedEmployees.length} موظف.</p>`;
      actionsDiv.hidden = false;
      summarySpan.textContent = `الإجمالي: ${parsedEmployees.length} موظف.`;
    } catch (err) {
      previewDiv.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
    }
  };

  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    for (const emp of parsedEmployees) {
      await sb.from('employees').insert({ full_name: emp.full_name, active: true });
    }
    toast('تم الاستيراد بنجاح');
    closeModal();
    onDone();
  };
}