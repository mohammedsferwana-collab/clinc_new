import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, debounce, fmtDate, errMsg, fetchAll } from './ui.js';
import { exportBar } from './export.js';

const STATUS = {
  waiting: ['في الانتظار', 'wait'],
  in_progress: ['جاري الكشف', 'prog'],
  seen: ['مكتمل', 'ok']
};

const treatmentText = v =>
  (v.visit_items || []).map(i => i.drug_text + (i.qty > 1 ? ` × ${i.qty}` : '')).join('، ') || v.legacy_prescription || '—';

/* ========================================================
   أولاً: صفحة الاستمارة (السكرتاريا)
======================================================== */
export function renderEstmara(root, ctx) {
  const { sb, clinics = [], doctors = [] } = ctx;
  const today = N.todayISO();
  let filter = '', todayRows = [];

  const prefill = ctx.estmaraPrefill || {};
  ctx.estmaraPrefill = null;

  root.innerHTML = `
    <header class="pagehead">
      <h1>صفحة الاستمارة — تسجيل مراجع جديد</h1>
      <div class="row" style="gap:.5rem">
        <a href="#/search" class="btn" style="text-decoration:none">🔍 الانتقال لصفحة البحث بالهوية</a>
        <a href="#/visits" class="btn" style="text-decoration:none">📋 قائمة الزيارات والعيادات</a>
      </div>
    </header>

    <div class="panel" style="border:1px solid var(--brand); box-shadow:0 4px 18px rgba(14,90,87,.08); margin-bottom:1.5rem">
      <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.5rem; margin-bottom:.8rem">
        <h2 style="margin:0; color:var(--brand)">استمارة المراجع والزيارة (الحقول الـ 11)</h2>
        <span class="muted small">تُعبأ من موظف السكرتاريا — يتحول المريض تلقائياً إلى قائمة انتظار الطبيب</span>
      </div>

      <form id="estmaraMainForm" class="grid">
        <div>
          <label>1. تاريخ الزيارة *</label>
          <input name="visit_date" id="eVisitDate" type="date" required value="${today}">
        </div>
        <div>
          <label>2. الاسم الرباعي *</label>
          <input name="full_name" id="eFullName" required placeholder="مثال: محمد أحمد إبراهيم خليل" value="${esc(prefill.full_name || '')}">
        </div>
        <div>
          <label>3. رقم الهوية *</label>
          <input name="national_id" id="eNationalId" inputmode="numeric" required placeholder="رقم الهوية (9 أرقام)" value="${esc(prefill.national_id || '')}">
        </div>
        <div>
          <label>4. رقم الجوال</label>
          <input name="phone" id="ePhone" inputmode="tel" placeholder="مثال: 0599123456" value="${esc(prefill.phone || '')}">
        </div>
        <div style="grid-column:1/-1">
          <label>5. عنوان النزوح الحالي</label>
          <input name="address" id="eAddress" placeholder="مكان السكن أو النزوح الحالي" value="${esc(prefill.address || '')}">
        </div>
        <div>
          <label>6. الجنس *</label>
          <select name="gender" id="eGender" required>
            <option value="">اختر الجنس</option>
            <option value="ذكر" ${prefill.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
            <option value="أنثى" ${prefill.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
          </select>
        </div>
        <div>
          <label>7. نوع الحالة *</label>
          <select name="case_type" id="eCaseType" required>
            <option value="جديد">جديد</option>
            <option value="مراجع">مراجع</option>
            <option value="استشارة">استشارة</option>
            <option value="طوارئ">طوارئ</option>
          </select>
        </div>
        <div>
          <label>8. تاريخ الميلاد</label>
          <input name="birth_date" id="eBirthDate" type="date" max="${today}" value="${esc(prefill.birth_date || '')}">
        </div>
        <div>
          <label>9. العمر عند الزيارة</label>
          <input name="age_at_visit" id="eAgeAtVisit" placeholder="يُحسب آلياً من الميلاد أو اكتبه">
        </div>
        <div>
          <label>10. العيادة المختصة *</label>
          <select name="clinic" id="eClinicSelect" required>
            <option value="">اختر العيادة</option>
            ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>11. اسم الطبيب المعالج *</label>
          <select name="doctor_name" id="eDoctorSelect" required>
            <option value="">اختر الطبيب</option>
            ${doctors.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
          </select>
        </div>

        <div style="grid-column:1/-1; margin-top:.8rem" class="row">
          <button class="btn primary" id="saveEstmaraBtn" style="flex:1; padding:.7rem 1.4rem; font-size:1.05rem">
            ✓ تسجيل المريض وتحويله لقائمة انتظار الطبيب
          </button>
          <button type="reset" class="btn" id="resetEstmaraBtn">مسح الخانات</button>
        </div>
      </form>
    </div>

    <section>
      <div class="row between" style="margin-bottom:.6rem; flex-wrap:wrap; gap:.5rem">
        <h2 style="margin:0">سجل المسجلين اليوم بالعيادات</h2>
        <div class="row" style="gap:.5rem">
          <div class="chips" id="chips"></div>
          <div id="exportWrap"></div>
        </div>
      </div>
      <div id="todayTableWrap"></div>
    </section>
  `;

  root.querySelector('#exportWrap').append(exportBar(() => ({
    title: 'زيارات اليوم', subtitle: today, filename: 'زيارات-' + today,
    sections: [{ heading: 'الزيارات', columns: ['#', 'المراجع', 'الهوية', 'العيادة', 'الطبيب', 'العمر', 'الحالة'],
      rows: todayRows.map((v, i) => [i + 1, v.patients?.full_name || '', v.patients?.national_id || '', v.clinic || '', v.doctor_name || '', v.age_at_visit || '', (STATUS[v.status] || STATUS.waiting)[0]]) }]
  })));

  const bDateInput = root.querySelector('#eBirthDate');
  const vDateInput = root.querySelector('#eVisitDate');
  const ageInput = root.querySelector('#eAgeAtVisit');

  const updateAge = () => {
    if (bDateInput.value && vDateInput.value) {
      ageInput.value = N.ageText(bDateInput.value, vDateInput.value);
    }
  };
  bDateInput.onchange = updateAge;
  vDateInput.onchange = updateAge;
  if (bDateInput.value) updateAge();

  const idInput = root.querySelector('#eNationalId');
  idInput.onblur = async () => {
    const natId = N.cleanId(idInput.value);
    if (!natId) return;
    const { data: p } = await sb.from('patients').select('*').eq('national_id', natId).maybeSingle();
    if (p) {
      if (!root.querySelector('#eFullName').value) root.querySelector('#eFullName').value = p.full_name || '';
      if (!root.querySelector('#ePhone').value) root.querySelector('#ePhone').value = p.phone || '';
      if (!root.querySelector('#eAddress').value) root.querySelector('#eAddress').value = p.address || '';
      if (!root.querySelector('#eGender').value && p.gender) root.querySelector('#eGender').value = p.gender;
      if (!root.querySelector('#eBirthDate').value && p.birth_date) {
        root.querySelector('#eBirthDate').value = p.birth_date;
        updateAge();
      }
      root.querySelector('#eCaseType').value = 'مراجع';
      toast(`تم جلب بيانات المراجع السابق «${p.full_name}» تلقائياً`, 'ok');
    }
  };

  const eForm = root.querySelector('#estmaraMainForm');
  eForm.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(eForm));
    const btn = root.querySelector('#saveEstmaraBtn');
    btn.disabled = true;
    btn.textContent = 'جارٍ تسجيل الزيارة...';

    try {
      const natId = N.cleanId(f.national_id);
      if (!natId) throw new Error('يرجى إدخال رقم هوية صالح');

      const patData = {
        full_name: N.cleanText(f.full_name),
        national_id: natId,
        phone: N.cleanPhone(f.phone),
        address: N.cleanText(f.address) || null,
        gender: f.gender || null,
        birth_date: f.birth_date || null
      };

      let { data: patient } = await sb.from('patients').select('id').eq('national_id', natId).maybeSingle();

      if (!patient) {
        const { data: newP, error: pErr } = await sb.from('patients').insert({
          ...patData,
          created_by: ctx.profile.id
        }).select().single();
        if (pErr) throw pErr;
        patient = newP;
      } else {
        await sb.from('patients').update(patData).eq('id', patient.id);
      }

      const ageStr = N.cleanText(f.age_at_visit) || (f.birth_date ? N.ageText(f.birth_date, f.visit_date) : null);
      const { error: vErr } = await sb.from('visits').insert({
        patient_id: patient.id,
        visit_date: f.visit_date,
        clinic: f.clinic,
        doctor_name: N.cleanText(f.doctor_name) || null,
        case_type: f.case_type,
        age_at_visit: ageStr,
        status: 'waiting',
        created_by: ctx.profile.id
      });
      if (vErr) throw vErr;

      toast(`تم تسجيل المراجع «${patData.full_name}» وتحويله لقائمة انتظار الطبيب «${f.doctor_name || f.clinic}»`);
      eForm.reset();
      root.querySelector('#eVisitDate').value = today;
      loadToday();
    } catch (err) {
      toast(errMsg(err), 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = '✓ تسجيل المريض وتحويله لقائمة انتظار الطبيب';
    }
  };

  async function loadToday() {
    const { data, error } = await sb.from('visits')
      .select('id,clinic,doctor_name,status,created_at,age_at_visit,patients(full_name,national_id)')
      .eq('visit_date', today).order('created_at', { ascending: false });
    if (error) return toast(errMsg(error), 'bad');
    todayRows = data || [];

    const counts = {};
    todayRows.forEach(v => { const c = v.clinic || 'بدون عيادة'; counts[c] = (counts[c] || 0) + 1; });
    root.querySelector('#chips').innerHTML =
      `<button class="chip ${filter ? '' : 'on'}" data-c="">الكل ${todayRows.length}</button>` +
      Object.entries(counts).map(([c, n]) => `<button class="chip ${filter === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} ${n}</button>`).join('');

    const rows = todayRows.filter(v => !filter || (v.clinic || 'بدون عيادة') === filter);
    root.querySelector('#todayTableWrap').innerHTML = rows.length
      ? `<div class="tablewrap"><table><thead><tr><th>#</th><th>المراجع</th><th>الهوية</th><th>العيادة</th><th>الطبيب</th><th>العمر</th><th>الحالة</th><th>الوقت</th><th>إجراءات</th></tr></thead><tbody>${rows.map((v, i) => {
          const st = STATUS[v.status] || STATUS.waiting;
          return `<tr data-id="${v.id}"><td>${i + 1}</td><td><b>${esc(v.patients?.full_name)}</b></td><td>${esc(v.patients?.national_id || '—')}</td><td>${esc(v.clinic || '—')}</td><td>${esc(v.doctor_name || '—')}</td>
           <td>${esc(v.age_at_visit || '—')}</td>
           <td><span class="badge ${st[1]}">${st[0]}</span></td>
           <td>${new Date(v.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td>
           <td class="row" style="gap:.25rem; flex-wrap:nowrap">
             <button class="btn sm" data-act="edit">تعديل</button>
             <button class="btn sm danger" data-act="del">حذف</button>
           </td></tr>`;
        }).join('')}</tbody></table></div>`
      : '<div class="panel empty">لا توجد زيارات مسجلة اليوم حتى الآن.</div>';
  }

  root.querySelector('#chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (b) { filter = b.dataset.c; loadToday(); }
  };

  root.querySelector('#todayTableWrap').onclick = e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    const v = todayRows.find(x => x.id === tr?.dataset.id);
    if (!v) return;
    if (btn.dataset.act === 'edit') openEditVisit(ctx, v, loadToday);
    else if (btn.dataset.act === 'del') deleteVisit(ctx, v, loadToday);
  };

  loadToday();
  const t = setInterval(loadToday, 20000);
  ctx.cleanup = () => clearInterval(t);
}

export const renderReception = renderEstmara;

/* ========================================================
   ثانياً: صفحة البحث والاستعلام
======================================================== */
export function renderSearch(root, ctx) {
  const { sb, clinics = [], doctors = [] } = ctx;

  root.innerHTML = `
    <header class="pagehead">
      <h1>صفحة البحث والاستعلام</h1>
      <a href="#/estmara" class="btn primary" style="text-decoration:none">📝 فتح صفحة الاستمارة</a>
    </header>

    <div class="searchbox">
      <input id="qId" type="search" placeholder="أدخل رقم الهوية أو الاسم للبحث عن المراجع..." autocomplete="off">
      <button class="btn primary" id="doSearchBtn">بحث</button>
    </div>

    <div id="searchResults" style="margin-top:1.2rem">
      <div class="panel empty">أدخل رقم الهوية أو الاسم أعلاه للتحقق من سجل المريض أو تحويله للطبيب.</div>
    </div>
  `;

  const qInput = root.querySelector('#qId');
  const resultsBox = root.querySelector('#searchResults');
  qInput.focus();

  const performSearch = async () => {
    const rawVal = qInput.value.trim();
    const cleanNum = N.digits(rawVal).replace(/\D/g, '');

    if (!rawVal) {
      resultsBox.innerHTML = '<div class="panel empty">يرجى كتابة رقم الهوية أو الاسم للبحث.</div>';
      return;
    }

    resultsBox.innerHTML = '<div class="panel">جارٍ البحث في سجلات المراجعين...</div>';

    try {
      let qb = sb.from('patients').select(`
        *,
        visits(id, visit_date, clinic, doctor_name, case_type, status, diagnosis, notes)
      `);

      if (cleanNum && cleanNum.length >= 4) {
        qb = qb.or(`national_id.eq.${cleanNum},phone.ilike.%${cleanNum}%`);
      } else {
        qb = qb.ilike('search_name', '%' + N.arNorm(rawVal).replace(/ /g, '%') + '%');
      }

      const { data, error } = await qb.limit(5);
      if (error) {
        resultsBox.innerHTML = `<div class="panel" style="color:var(--bad)">تعذر البحث: ${esc(errMsg(error))}</div>`;
        return;
      }

      if (!data || !data.length) {
        resultsBox.innerHTML = `
          <div class="panel empty" style="border:2px dashed var(--bad); padding:2rem; text-align:center">
            <div style="font-size:2.5rem; margin-bottom:.5rem">👤❌</div>
            <h3 style="margin:0 0 .5rem; color:var(--bad)">المراجع «${esc(rawVal)}» غير مسجل في النظام</h3>
            <p class="muted">اضغط على الزر أدناه للانتقال إلى استمارة التسجيل وتعبئة بياناته كمراجع جديد.</p>
            <button class="btn primary" id="goToEstmaraBtn" style="font-size:1.1rem; padding:.7rem 1.6rem; margin-top:.5rem">
              📝 تسجيل المراجع في استمارة التسجيل
            </button>
          </div>
        `;
        resultsBox.querySelector('#goToEstmaraBtn').onclick = () => {
          ctx.estmaraPrefill = { national_id: cleanNum || '' };
          location.hash = '#/estmara';
        };
        return;
      }

      const p = data[0];
      const sortedVisits = (p.visits || []).sort((a, b) => b.visit_date.localeCompare(a.visit_date));
      const lastV = sortedVisits[0];

      resultsBox.innerHTML = `
        <div class="panel" style="background:var(--card); border:2px solid var(--brand); border-radius:var(--r); margin-bottom:1.5rem">
          <div class="row between" style="margin-bottom:.8rem; border-bottom:1px solid var(--line); padding-bottom:.4rem">
            <h3 style="margin:0; color:var(--brand)">✓ المريض مسجل — تحويل سريع لقائمة انتظار الطبيب</h3>
            <span class="badge ok">مسجل في النظام</span>
          </div>

          <form id="quickVisitStrip" class="row" style="flex-wrap:wrap; gap:.8rem; align-items:flex-end">
            <div style="min-width:200px">
              <label>العيادة *</label>
              <select name="clinic" required>
                <option value="">اختر العيادة</option>
                ${clinics.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div style="min-width:200px">
              <label>اسم الطبيب المعالج *</label>
              <select name="doctor_name" required>
                <option value="">اختر الطبيب</option>
                ${doctors.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}
              </select>
            </div>
            <div style="min-width:130px">
              <label>نوع الحالة</label>
              <select name="case_type">
                <option value="مراجع">مراجع</option>
                <option value="استشارة">استشارة</option>
                <option value="جديد">جديد</option>
              </select>
            </div>
            <div>
              <button class="btn primary" id="stripSubmitBtn" style="padding:.6rem 1.6rem">
                ✓ تسجيل وإرسال للطبيب
              </button>
            </div>
          </form>
        </div>

        <div class="panel" style="margin-bottom:1.5rem">
          <h3 style="margin-top:0">بيانات المراجع</h3>
          <div class="tablewrap">
            <table>
              <thead>
                <tr><th>الاسم رباعي</th><th>رقم الهوية</th><th>آخر زيارة</th><th>رقم الجوال</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>${esc(p.full_name)}</b></td>
                  <td>${esc(p.national_id || '—')}</td>
                  <td>${lastV ? `<span class="badge ok">${fmtDate(lastV.visit_date)}</span> (${esc(lastV.clinic || '—')})` : '<span class="muted">لا توجد زيارات سابقة</span>'}</td>
                  <td>${esc(p.phone || '—')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h3 style="margin-top:0">سجل الزيارات والتشخيصات السابقة (${sortedVisits.length})</h3>
          ${sortedVisits.length ? `
            <div class="tablewrap">
              <table>
                <thead>
                  <tr><th>تاريخ الزيارة</th><th>العيادة</th><th>الطبيب</th><th>نوع الحالة</th><th>التشخيص الطبي</th><th>الحالة</th></tr>
                </thead>
                <tbody>
                  ${sortedVisits.map(v => {
                    const st = STATUS[v.status] || STATUS.waiting;
                    return `<tr>
                      <td>${fmtDate(v.visit_date)}</td>
                      <td>${esc(v.clinic || '—')}</td>
                      <td>${esc(v.doctor_name || '—')}</td>
                      <td>${esc(v.case_type || '—')}</td>
                      <td>${esc(v.diagnosis || '—')}</td>
                      <td><span class="badge ${st[1]}">${st[0]}</span></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : '<p class="muted">لا توجد زيارات سابقة مسجلة لهذا المريض.</p>'}
        </div>
      `;

      const sForm = resultsBox.querySelector('#quickVisitStrip');
      sForm.onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(sForm));
        const btn = sForm.querySelector('#stripSubmitBtn');
        btn.disabled = true;

        try {
          const { error: vErr } = await sb.from('visits').insert({
            patient_id: p.id,
            visit_date: N.todayISO(),
            clinic: f.clinic,
            doctor_name: N.cleanText(f.doctor_name) || null,
            case_type: f.case_type || 'مراجع',
            age_at_visit: N.ageText(p.birth_date),
            status: 'waiting',
            created_by: ctx.profile.id
          });
          if (vErr) throw vErr;

          toast(`تم تسجيل المريض «${p.full_name}» وتحويله لقائمة انتظار الطبيب «${f.doctor_name}»`);
          performSearch();
        } catch (err) {
          toast(errMsg(err), 'bad');
          btn.disabled = false;
        }
      };

    } catch (err) {
      resultsBox.innerHTML = `<div class="panel" style="color:var(--bad)">خطأ تقني: ${esc(errMsg(err))}</div>`;
    }
  };

  root.querySelector('#doSearchBtn').onclick = performSearch;
  qInput.onkeydown = e => { if (e.key === 'Enter') performSearch(); };
}

/* ========================================================
   ثالثاً: بوابة الطبيب (Doctor Portal)
======================================================== */
export function renderVisits(root, ctx) {
  const { sb, profile } = ctx;
  const today = N.todayISO();
  const isDoctor = profile.role === 'doctor';
  const myDocName = N.cleanText(profile.full_name);

  let rows = [], shown = [], statusFilter = '', clinicFilter = '';

  root.innerHTML = `
    <header class="pagehead">
      <div>
        <h1 style="margin:0">${isDoctor ? `بوابة الطبيب — عيادة ${esc(myDocName)}` : 'قائمة الكشوفات اليومية والزيارات'}</h1>
        <p class="muted small" style="margin:.2rem 0 0">${isDoctor ? 'عرض المرضى المحولين إليك اليوم مع الأرشيف الجانبي والسجل الطبي (EHR)' : 'متابعة شاملة لكافة العيادات والأطباء'}</p>
      </div>
      <span id="bar"></span>
    </header>

    <div class="doctor-layout">
      <div>
        <div class="panel noprint">
          <div class="row">
            <div style="flex:1;min-width:200px">
              <label>بحث في كشوفات اليوم</label>
              <input id="q" type="search" placeholder="بحث بالاسم أو الهوية أو التشخيص..." autocomplete="off">
            </div>
            <div>
              <label>من تاريخ</label>
              <input type="date" id="d1" value="${today}">
            </div>
            <div>
              <label>إلى تاريخ</label>
              <input type="date" id="d2" value="${today}">
            </div>
          </div>

          <div class="chips" id="statusTabs" style="margin-top:.8rem"></div>
          ${!isDoctor ? '<div class="chips" id="clinicTabs" style="margin-top:.5rem"></div>' : ''}
        </div>

        <div id="list"></div>
      </div>

      <aside class="ehr-sidebar noprint">
        <h2 style="margin:0 0 .4rem; color:var(--brand)">📂 الأرشيف والسجل الطبي (EHR)</h2>
        <p class="muted small" style="margin:0 0 .6rem">ابحث عن أي مريض برقم الهوية أو الاسم لعرض سجله الطبي الكامل أو تعديل مراجعته</p>

        <div class="row" style="gap:.4rem; margin-bottom:.8rem">
          <input id="ehrSearchInput" type="search" placeholder="رقم الهوية أو اسم المريض..." style="flex:1">
          <button class="btn primary sm" id="ehrSearchBtn">بحث</button>
        </div>

        <div id="ehrSearchResults" style="margin-bottom:1rem"></div>

        <h3 style="border-top:1px solid var(--line); padding-top:.7rem; margin:.6rem 0 .4rem">آخر المراجعات المكتملة</h3>
        <div id="recentCompletedList">
          <p class="muted small">جارٍ التحميل...</p>
        </div>
      </aside>
    </div>
  `;

  const $ = id => root.querySelector('#' + id);

  $('bar').append(exportBar(() => ({
    title: 'كشف الزيارات اليومية', subtitle: today, filename: 'كشوفات-' + today,
    sections: [{
      heading: 'الزيارات',
      columns: ['التاريخ', 'المريض', 'الهوية', 'العيادة', 'الطبيب', 'الحالة', 'التشخيص'],
      rows: shown.map(v => [fmtDate(v.visit_date), v.patients?.full_name || '', v.patients?.national_id || '', v.clinic || '', v.doctor_name || '', (STATUS[v.status] || STATUS.waiting)[0], v.diagnosis || ''])
    }]
  })));

  async function load() {
    let a = $('d1').value || today, b = $('d2').value || a;
    if (a > b) [a, b] = [b, a];

    try {
      const allData = await fetchAll(() =>
        sb.from('visits').select(`
          id,visit_date,clinic,doctor_name,case_type,status,diagnosis,notes,legacy_prescription,age_at_visit,created_at,
          patients(id,full_name,national_id,phone,gender,birth_date,address),
          visit_items(id,drug_id,drug_text,qty,dosage,dispensed_at)
        `).gte('visit_date', a).lte('visit_date', b).order('created_at', { ascending: false })
      );

      if (isDoctor && myDocName) {
        const normMe = N.arNorm(myDocName.replace(/^د\.?\s*/, ''));
        rows = allData.filter(v => {
          if (!v.doctor_name) return true;
          const normDoc = N.arNorm(v.doctor_name.replace(/^د\.?\s*/, ''));
          return normDoc.includes(normMe) || normMe.includes(normDoc);
        });
      } else {
        rows = allData;
      }

      draw();
      loadSidebarHistory();
    } catch (e) {
      toast(errMsg(e), 'bad');
    }
  }

  function draw() {
    const t = N.arNorm($('q').value);
    const base = rows.filter(v => !t || N.arNorm([v.patients?.full_name, v.patients?.national_id, v.diagnosis, v.doctor_name].join(' ')).includes(t));

    const cWait = base.filter(v => v.status === 'waiting').length;
    const cProg = base.filter(v => v.status === 'in_progress').length;
    const cSeen = base.filter(v => v.status === 'seen').length;

    $('statusTabs').innerHTML = `
      <button class="chip ${statusFilter === '' ? 'on' : ''}" data-st="">الكل (${base.length})</button>
      <button class="chip ${statusFilter === 'waiting' ? 'on' : ''}" data-st="waiting">⏳ في الانتظار (${cWait})</button>
      <button class="chip ${statusFilter === 'in_progress' ? 'on' : ''}" data-st="in_progress">🩺 جاري الكشف (${cProg})</button>
      <button class="chip ${statusFilter === 'seen' ? 'on' : ''}" data-st="seen">✓ مكتمل (${cSeen})</button>
    `;

    if (!isDoctor && $('clinicTabs')) {
      const clCounts = {};
      base.forEach(v => { const c = v.clinic || 'بدون عيادة'; clCounts[c] = (clCounts[c] || 0) + 1; });
      $('clinicTabs').innerHTML = `<button class="chip ${clinicFilter === '' ? 'on' : ''}" data-cl="">كل العيادات</button>` +
        Object.entries(clCounts).map(([c, n]) => `<button class="chip ${clinicFilter === c ? 'on' : ''}" data-cl="${esc(c)}">${esc(c)} (${n})</button>`).join('');
    }

    shown = base.filter(v =>
      (!statusFilter || v.status === statusFilter) &&
      (!clinicFilter || (v.clinic || 'بدون عيادة') === clinicFilter)
    );

    $('list').innerHTML = shown.length
      ? `<div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المريض</th>
              <th>العمر</th>
              <th>العيادة / الطبيب</th>
              <th>التشخيص</th>
              <th>الحالة</th>
              <th>إجراءات الكشف والتحويل</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(v => {
              const st = STATUS[v.status] || STATUS.waiting;
              return `
              <tr data-id="${v.id}">
                <td>${fmtDate(v.visit_date)}</td>
                <td><b>${esc(v.patients?.full_name)}</b><br><span class="muted small">${esc(v.patients?.national_id || '')}</span></td>
                <td>${esc(v.age_at_visit || N.ageText(v.patients?.birth_date, v.visit_date))}</td>
                <td>${esc(v.clinic || '—')}<br><span class="muted small">${esc(v.doctor_name || '—')}</span></td>
                <td>${esc(v.diagnosis || '—')}</td>
                <td><span class="badge ${st[1]}">${st[0]}</span></td>
                <td class="row" style="gap:.25rem; flex-wrap:wrap">
                  <button class="btn sm primary" data-act="start">
                    ${v.status === 'waiting' ? '🩺 بدء المعاينة' : '📋 شاشة الكشف'}
                  </button>
                  <button class="btn sm" data-act="transfer" title="إرسال المريض إلى دكتور آخر">⇄ تحويل لطبيب</button>
                  <button class="btn sm" data-act="ehr" title="عرض السجل الطبي الكامل">ملف EHR</button>
                  <button class="btn sm danger" data-act="del" title="حذف">×</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`
      : '<div class="panel empty">لا يوجد مرضى في هذه القائمة حالياً.</div>';
  }

  async function loadSidebarHistory() {
    const completed = rows.filter(v => v.status === 'seen').slice(0, 12);
    const box = $('recentCompletedList');
    if (!box) return;

    if (!completed.length) {
      box.innerHTML = '<p class="muted small">لا توجد مراجعات مكتملة في هذه الفترة بعد.</p>';
      return;
    }

    box.innerHTML = completed.map(v => `
      <div class="ehr-item" data-vid="${v.id}">
        <div class="row between">
          <b>${esc(v.patients?.full_name)}</b>
          <span class="muted small">${fmtDate(v.visit_date)}</span>
        </div>
        <div class="muted small">الهوية: ${esc(v.patients?.national_id || '—')}</div>
        <div class="small" style="margin-top:.2rem">التشخيص: <b>${esc(v.diagnosis || '—')}</b></div>
        <div class="row" style="gap:.3rem; margin-top:.35rem">
          <button class="btn sm" data-side="edit" style="padding:.15rem .5rem; font-size:.78rem">تعديل سريع</button>
          <button class="btn sm" data-side="ehr" style="padding:.15rem .5rem; font-size:.78rem">السجل الكامل (EHR)</button>
        </div>
      </div>
    `).join('');

    box.onclick = e => {
      const card = e.target.closest('.ehr-item');
      if (!card) return;
      const v = rows.find(x => x.id === card.dataset.vid);
      if (!v) return;
      const sideAct = e.target.closest('button[data-side]')?.dataset.side;
      if (sideAct === 'ehr') openFullEHRModal(ctx, v.patients.id);
      else openDoctorConsultation(ctx, v, load);
    };
  }

  const runEHRSearch = async () => {
    const q = $('ehrSearchInput').value.trim();
    const resBox = $('ehrSearchResults');
    if (!q) { resBox.innerHTML = ''; return; }

    resBox.innerHTML = '<p class="muted small">جارٍ البحث في السجلات الطبية...</p>';
    const cleanNum = N.digits(q).replace(/\D/g, '');
    let qb = sb.from('patients').select('id, full_name, national_id, phone, birth_date');
    if (cleanNum && cleanNum.length >= 4) {
      qb = qb.or(`national_id.ilike.%${cleanNum}%,phone.ilike.%${cleanNum}%`);
    } else {
      qb = qb.ilike('search_name', '%' + N.arNorm(q).replace(/ /g, '%') + '%');
    }

    const { data } = await qb.limit(6);
    if (!data || !data.length) {
      resBox.innerHTML = '<p class="muted small" style="color:var(--bad)">لا يوجد مريض مطابق.</p>';
      return;
    }

    resBox.innerHTML = data.map(p => `
      <div class="ehr-item" data-pid="${p.id}">
        <b>${esc(p.full_name)}</b>
        <div class="muted small">هوية: ${esc(p.national_id || '—')} • العمر: ${N.ageText(p.birth_date)}</div>
        <button class="btn primary sm" style="width:100%; margin-top:.35rem; padding:.2rem">📂 فتح السجل الطبي الكامل (EHR)</button>
      </div>
    `).join('');

    resBox.onclick = e => {
      const item = e.target.closest('.ehr-item');
      if (item) openFullEHRModal(ctx, item.dataset.pid);
    };
  };

  $('ehrSearchBtn').onclick = runEHRSearch;
  $('ehrSearchInput').onkeydown = e => { if (e.key === 'Enter') runEHRSearch(); };

  $('statusTabs').onclick = e => {
    const b = e.target.closest('.chip');
    if (b) { statusFilter = b.dataset.st; draw(); }
  };

  if ($('clinicTabs')) {
    $('clinicTabs').onclick = e => {
      const b = e.target.closest('.chip');
      if (b) { clinicFilter = b.dataset.cl; draw(); }
    };
  }

  $('list').onclick = async e => {
    const btn = e.target.closest('button[data-act]');
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const v = shown.find(x => x.id === tr.dataset.id);
    if (!v) return;

    const act = btn?.dataset.act || 'start';
    if (act === 'start') {
      if (v.status === 'waiting' && ['doctor', 'admin'].includes(profile.role)) {
        await sb.from('visits').update({ status: 'in_progress' }).eq('id', v.id);
        v.status = 'in_progress';
        draw();
      }
      openDoctorConsultation(ctx, v, load);
    } else if (act === 'transfer') {
      openTransferDoctorModal(ctx, v, load);
    } else if (act === 'ehr') {
      openFullEHRModal(ctx, v.patients.id);
    } else if (act === 'del') {
      deleteVisit(ctx, v, load);
    }
  };

  $('q').oninput = debounce(draw, 200);
  $('d1').onchange = $('d2').onchange = load;

  load();
  const t = setInterval(load, 15000);
  ctx.cleanup = () => clearInterval(t);
}

function openTransferDoctorModal(ctx, v, onDone) {
  const { sb, clinics = [], doctors = [] } = ctx;
  const pName = v.patients?.full_name || 'المريض';

  const body = openModal(`
    <h2>⇄ إرسال وتحويل المريض إلى طبيب آخر</h2>
    <p class="muted">تحويل المريض <b>${esc(pName)}</b> من (${esc(v.clinic || '—')} / ${esc(v.doctor_name || '—')}) إلى طبيب آخر للكشف عنه:</p>
    <form id="transferForm" class="grid">
      <div>
        <label>العيادة المحول إليها *</label>
        <select name="clinic" required>
          ${clinics.map(c => `<option value="${esc(c.name)}" ${v.clinic === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>الطبيب المستقبل *</label>
        <select name="doctor_name" required>
          <option value="">اختر الطبيب</option>
          ${doctors.map(d => `<option value="${esc(d.name)}" ${v.doctor_name === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
      </div>
      <div style="grid-column:1/-1">
        <label>سبب التحويل / ملاحظات للطبيب المستقبل</label>
        <input name="notes" value="${esc(v.notes || '')}" placeholder="مثال: بحاجة لاستشارة أخصائي...">
      </div>
      <div style="grid-column:1/-1; margin-top:.6rem">
        <button class="btn primary" id="confirmTransferBtn" style="width:100%">✓ تأكيد إرسال المريض لقائمة انتظار الطبيب المختار</button>
      </div>
    </form>
  `);

  body.querySelector('#transferForm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = body.querySelector('#confirmTransferBtn');
    btn.disabled = true;

    const { error } = await sb.from('visits').update({
      clinic: f.clinic,
      doctor_name: f.doctor_name,
      status: 'waiting',
      case_type: 'استشارة',
      notes: N.cleanText(f.notes) || null
    }).eq('id', v.id);

    if (error) {
      btn.disabled = false;
      return toast(errMsg(error), 'bad');
    }

    toast(`تم إرسال المريض «${pName}» إلى الدكتور «${f.doctor_name}» (${f.clinic}) بنجاح`);
    closeModal();
    if (onDone) onDone();
  };
}

async function openFullEHRModal(ctx, patientId) {
  const { sb } = ctx;
  const [{ data: p }, { data: visits }] = await Promise.all([
    sb.from('patients').select('*').eq('id', patientId).single(),
    sb.from('visits').select(`
      id, visit_date, clinic, doctor_name, case_type, status, diagnosis, notes, legacy_prescription, age_at_visit,
      visit_items(id, drug_text, qty, dosage, dispensed_at)
    `).eq('patient_id', patientId).order('visit_date', { ascending: false })
  ]);

  if (!p) return toast('تعذر العثور على ملف المريض', 'bad');

  const body = openModal(`
    <h2>📂 السجل الطبي الكامل (EHR) — ${esc(p.full_name)}</h2>
    <div class="panel" style="background:var(--bg)">
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr))">
        <div><span class="muted small">رقم الهوية:</span><br><b>${esc(p.national_id || '—')}</b></div>
        <div><span class="muted small">العمر / الميلاد:</span><br><b>${N.ageText(p.birth_date)} (${fmtDate(p.birth_date) || '—'})</b></div>
        <div><span class="muted small">الجنس:</span><br><b>${esc(p.gender || '—')}</b></div>
        <div><span class="muted small">رقم الجوال:</span><br><b>${esc(p.phone || '—')}</b></div>
        <div style="grid-column:1/-1"><span class="muted small">العنوان:</span> <b>${esc(p.address || '—')}</b></div>
      </div>
    </div>

    <h3>تاريخ المراجعات والتشخيصات والوصفات الطبية (${(visits || []).length})</h3>
    <div style="max-height:55vh; overflow-y:auto">
      ${(visits && visits.length) ? visits.map(v => `
        <div class="panel" style="margin-bottom:.75rem; border-inline-start:4px solid var(--brand)">
          <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.35rem; margin-bottom:.5rem">
            <div>
              <b>📅 ${fmtDate(v.visit_date)}</b> — <span class="badge ok">${esc(v.clinic || '—')}</span>
              <span class="muted small">د. ${esc(v.doctor_name || '—')}</span>
            </div>
            <button class="btn sm editPastVisitBtn" data-vid="${v.id}">تعديل هذه المراجعة</button>
          </div>
          <div><b>التشخيص الطبي:</b> ${esc(v.diagnosis || 'لم يُسجل تشخيص')}</div>
          ${v.notes ? `<div class="small muted"><b>ملاحظات:</b> ${esc(v.notes)}</div>` : ''}
          <div style="margin-top:.35rem"><b>الأدوية الموصوفة:</b> ${esc(treatmentText(v))}</div>
        </div>
      `).join('') : '<p class="muted">لا توجد زيارات مسجلة لهذا المريض.</p>'}
    </div>
  `, { wide: true });

  body.onclick = e => {
    const btn = e.target.closest('.editPastVisitBtn');
    if (!btn) return;
    const v = visits.find(x => x.id === btn.dataset.vid);
    if (v) {
      v.patients = p;
      closeModal();
      openDoctorConsultation(ctx, v, () => openFullEHRModal(ctx, patientId));
    }
  };
}

async function openDoctorConsultation(ctx, v, onDone) {
  const { sb, drugs, profile } = ctx;
  const isDoctorOrAdmin = ['doctor', 'admin'].includes(profile.role);

  const { data: history } = await sb.from('visits')
    .select('id,visit_date,clinic,doctor_name,diagnosis,legacy_prescription,visit_items(drug_text,qty)')
    .eq('patient_id', v.patients.id)
    .neq('id', v.id)
    .order('visit_date', { ascending: false });

  const body = openModal(`
    <div class="row between" style="margin-bottom:.5rem">
      <h2 style="margin:0">🩺 شاشة الكشف والتشخيص: ${esc(v.patients.full_name)}</h2>
      <button type="button" class="btn sm" id="transferFromConsultBtn">⇄ تحويل المريض لطبيب آخر</button>
    </div>

    <div class="panel">
      <div class="row between">
        <span><b>رقم الهوية:</b> ${esc(v.patients.national_id || '—')}</span>
        <span><b>الجنس:</b> ${esc(v.patients.gender || '—')}</span>
        <span><b>العمر:</b> ${esc(v.age_at_visit || N.ageText(v.patients.birth_date, v.visit_date))}</span>
        <span><b>العيادة:</b> ${esc(v.clinic || '—')}</span>
      </div>
    </div>
    
    <h3>السجل الطبي السابق للمريض (${(history || []).length})</h3>
    <div style="max-height:150px; overflow-y:auto; margin-bottom:1rem">
      ${(history && history.length) ? history.map(h => `
        <div class="hist">
          <b>${fmtDate(h.visit_date)}</b> — العيادة: ${esc(h.clinic || '—')} (د. ${esc(h.doctor_name || '—')})<br>
          <span class="muted">التشخيص:</span> ${esc(h.diagnosis || '—')} | <span class="muted">العلاج:</span> ${esc(treatmentText(h))}
        </div>
      `).join('') : '<p class="muted">لا توجد زيارات سابقة لهذا المريض.</p>'}
    </div>

    <h3>تسجيل التشخيص والوصفة الإلكترونية</h3>
    <form id="diagForm">
      <div>
        <label>التشخيص الطبي *</label>
        <textarea name="diagnosis" required placeholder="اكتب التشخيص الطبي المفصل هنا..." ${!isDoctorOrAdmin ? 'disabled' : ''}>${esc(v.diagnosis || '')}</textarea>
      </div>
      <div style="margin-top:.6rem">
        <label>ملاحظات وتوصيات طبية</label>
        <input name="notes" value="${esc(v.notes || '')}" placeholder="تعليمات للمريض أو الصيدلية..." ${!isDoctorOrAdmin ? 'disabled' : ''}>
      </div>

      <h4 style="margin:1rem 0 .4rem">الوصفة الإلكترونية (تُرسل آلياً إلى صفحة الصرف في الصيدلية)</h4>
      <div id="rxItems"></div>
      ${isDoctorOrAdmin ? '<button type="button" class="btn sm" id="addDrugBtn">+ إضافة دواء للوصفة</button>' : ''}

      <div style="margin-top:1.2rem">
        ${isDoctorOrAdmin ? '<button class="btn primary" id="saveDiagBtn" style="width:100%; padding:.7rem">✓ إتمام الكشف وإرسال الوصفة الإلكترونية للصيدلية</button>' : '<p class="muted">صلاحية الطبيب مطلوبة لتسجيل التشخيص.</p>'}
      </div>
    </form>`, { wide: true });

  body.querySelector('#transferFromConsultBtn').onclick = () => {
    closeModal();
    openTransferDoctorModal(ctx, v, onDone);
  };

  const rxContainer = body.querySelector('#rxItems');
  const addBtn = body.querySelector('#addDrugBtn');

  const renderDrugRow = (item = {}) => {
    const div = document.createElement('div');
    div.className = 'item-row';
    div.style.gridTemplateColumns = '1.8fr 90px 1.5fr auto';
    div.style.alignItems = 'center';
    div.innerHTML = `
      <input list="stockDrugs" class="dName" placeholder="اختر أو اكتب اسم الدواء" value="${esc(item.drug_text || '')}" ${!isDoctorOrAdmin ? 'disabled' : ''}>
      <input type="number" class="dQty" min="1" value="${item.qty || 1}" title="الكمية" ${!isDoctorOrAdmin ? 'disabled' : ''}>
      <input class="dDosage" placeholder="الجرعة والاستخدام (مثال: حبة كل 8 ساعات)" value="${esc(item.dosage || '')}" ${!isDoctorOrAdmin ? 'disabled' : ''}>
      ${isDoctorOrAdmin ? '<button type="button" class="btn sm danger delDrug">×</button>' : ''}
    `;
    div.querySelector('.delDrug')?.addEventListener('click', () => div.remove());
    rxContainer.append(div);
  };

  const dl = document.createElement('datalist');
  dl.id = 'stockDrugs';
  dl.innerHTML = drugs.map(d => `<option value="${esc(d.name)}">${esc(d.scientific_name || '')} ${esc(d.dosage || '')}</option>`).join('');
  body.append(dl);

  if (v.visit_items && v.visit_items.length) {
    v.visit_items.forEach(renderDrugRow);
  } else if (isDoctorOrAdmin) {
    renderDrugRow();
  }

  if (addBtn) addBtn.onclick = () => renderDrugRow();

  const dForm = body.querySelector('#diagForm');
  dForm.onsubmit = async e => {
    e.preventDefault();
    const saveBtn = body.querySelector('#saveDiagBtn');
    saveBtn.disabled = true;

    try {
      const diagVal = N.cleanText(dForm.diagnosis.value);
      const notesVal = N.cleanText(dForm.notes.value) || null;

      const rows = [...rxContainer.querySelectorAll('.item-row')].map(r => ({
        text: N.cleanText(r.querySelector('.dName').value),
        qty: parseInt(r.querySelector('.dQty').value) || 1,
        dosage: N.cleanText(r.querySelector('.dDosage').value) || null
      })).filter(r => r.text);

      const drugMap = new Map(drugs.map(d => [d.name.toLowerCase(), d.id]));

      const { error: vErr } = await sb.from('visits').update({
        diagnosis: diagVal,
        notes: notesVal,
        doctor_name: v.doctor_name || profile.full_name,
        status: 'seen'
      }).eq('id', v.id);
      if (vErr) throw vErr;

      await sb.from('visit_items').delete().eq('visit_id', v.id).is('dispensed_at', null);
      if (rows.length) {
        const { error: iErr } = await sb.from('visit_items').insert(rows.map(r => ({
          visit_id: v.id,
          drug_id: drugMap.get(r.text.toLowerCase()) || null,
          drug_text: r.text,
          qty: r.qty,
          dosage: r.dosage
        })));
        if (iErr) throw iErr;
      }

      toast('تم حفظ الكشف وإرسال الوصفة الإلكترونية آلياً إلى الصيدلية');
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      toast(errMsg(err), 'bad');
      saveBtn.disabled = false;
    }
  };
}

export function openEditVisit(ctx, v, onDone) {
  const { sb, clinics = [], doctors = [] } = ctx;
  const pName = v.patients?.full_name || 'المراجع';
  const pId = v.patients?.national_id || '—';

  const body = openModal(`<h2>تعديل بيانات الزيارة: ${esc(pName)}</h2>
    <p class="muted small" style="margin-top:-.4rem; margin-bottom:.8rem">رقم الهوية: ${esc(pId)}</p>
    <form id="editVisitForm" class="grid">
      <div>
        <label>تاريخ الزيارة *</label>
        <input name="visit_date" type="date" value="${v.visit_date || N.todayISO()}" required>
      </div>
      <div>
        <label>العيادة *</label>
        <input name="clinic" list="clinicsList" value="${esc(v.clinic || '')}" required>
        <datalist id="clinicsList">${clinics.map(c => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
      </div>
      <div>
        <label>الطبيب المعالج</label>
        <input name="doctor_name" list="doctorsList" value="${esc(v.doctor_name || '')}">
        <datalist id="doctorsList">${doctors.map(d => `<option value="${esc(d.name)}"></option>`).join('')}</datalist>
      </div>
      <div>
        <label>نوع الحالة</label>
        <select name="case_type">
          ${['جديد', 'مراجع', 'استشارة', 'طوارئ', 'أخرى'].map(t => `<option value="${t}" ${v.case_type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div>
        <label>حالة الزيارة *</label>
        <select name="status" required>
          <option value="waiting" ${v.status === 'waiting' ? 'selected' : ''}>في الانتظار</option>
          <option value="in_progress" ${v.status === 'in_progress' ? 'selected' : ''}>جاري الكشف</option>
          <option value="seen" ${v.status === 'seen' ? 'selected' : ''}>مكتمل</option>
        </select>
      </div>
      <div>
        <label>العمر عند الزيارة</label>
        <input name="age_at_visit" value="${esc(v.age_at_visit || '')}">
      </div>
      <div style="grid-column:1/-1">
        <label>التشخيص الطبي</label>
        <textarea name="diagnosis">${esc(v.diagnosis || '')}</textarea>
      </div>
      <div style="grid-column:1/-1">
        <label>ملاحظات إضافية</label>
        <input name="notes" value="${esc(v.notes || '')}">
      </div>
      <div style="grid-column:1/-1" class="row">
        <button class="btn primary" id="saveVisitBtn" style="flex:1">حفظ تعديلات الزيارة</button>
        <button type="button" class="btn danger" id="delVisitFromEdit">حذف الزيارة</button>
      </div>
    </form>`);

  body.querySelector('#delVisitFromEdit').onclick = () => {
    closeModal();
    deleteVisit(ctx, v, onDone);
  };

  body.querySelector('#editVisitForm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = body.querySelector('#saveVisitBtn');
    btn.disabled = true;

    const { error } = await sb.from('visits').update({
      visit_date: f.visit_date,
      clinic: N.cleanText(f.clinic) || null,
      doctor_name: N.cleanText(f.doctor_name) || null,
      case_type: f.case_type || null,
      status: f.status,
      age_at_visit: N.cleanText(f.age_at_visit) || null,
      diagnosis: N.cleanText(f.diagnosis) || null,
      notes: N.cleanText(f.notes) || null
    }).eq('id', v.id);

    if (error) {
      btn.disabled = false;
      return toast(errMsg(error), 'bad');
    }

    toast('تم تحديث بيانات الزيارة بنجاح');
    closeModal();
    if (onDone) onDone();
  };
}

export async function deleteVisit(ctx, v, onDone) {
  const { sb } = ctx;
  const pName = v.patients?.full_name || 'المراجع';
  if (!confirm(`هل أنت متأكد من حذف زيارة «${pName}» نهائياً؟`)) return;

  try {
    const { data: items } = await sb.from('visit_items').select('id').eq('visit_id', v.id);
    if (items?.length) {
      await sb.from('stock_movements').update({ item_id: null }).in('item_id', items.map(x => x.id));
    }
    const { error } = await sb.from('visits').delete().eq('id', v.id);
    if (error) return toast(errMsg(error), 'bad');
    toast('تم حذف الزيارة بنجاح');
    if (onDone) onDone();
  } catch (err) {
    toast(errMsg(err), 'bad');
  }
}