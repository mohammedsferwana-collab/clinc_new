import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, errMsg, fetchAll, ROLES } from './ui.js';

export async function executeBackup(ctx) {
  const { sb } = ctx;
  const siteName = ctx.settings?.site_name || 'مركز الأمل الطبي';
  const todayStr = N.todayISO();

  const body = openModal(`<h2>النسخ الاحتياطي لجميع البيانات</h2>
    <div class="panel" id="bStatus">
      <p><b>جارٍ الاتصال بقاعدة البيانات وسحب جميع السجلات...</b></p>
      <div class="progress" id="bProg">يرجى الانتظار، يتم جلب الجداول...</div>
    </div>
    <div id="bResult" hidden></div>`, { wide: true });

  const prog = body.querySelector('#bProg');
  const bStatus = body.querySelector('#bStatus');
  const bResult = body.querySelector('#bResult');

  const tables = [
    { key: 'patients', name: 'المرضى والمراجعون', select: 'id,national_id,full_name,phone,address,gender,birth_date,created_at' },
    { key: 'visits', name: 'سجل الزيارات', select: 'id,patient_id,visit_date,clinic,doctor_name,case_type,status,diagnosis,notes,age_at_visit,created_at' },
    { key: 'visit_items', name: 'الوصفات الطبية', select: 'id,visit_id,drug_id,drug_text,qty,dosage,dispensed_at,created_at' },
    { key: 'drugs', name: 'الأدوية والمخزون', select: 'id,name,unit,min_stock,active' },
    { key: 'stock_movements', name: 'حركات التوريد والصرف', select: 'id,drug_id,kind,qty,movement_date,note,created_at' },
    { key: 'employees', name: 'الموظفون', select: 'id,full_name,national_id,phone,gender,specialty,work_start,work_end,grace_minutes,active,notes,created_at' },
    { key: 'attendance', name: 'الحضور والانصراف', select: 'id,employee_id,work_date,check_in,check_out,late_minutes,source,note,created_at' },
    { key: 'assets', name: 'العهد والممتلكات', select: 'id,asset_type,name,serial_no,color,model,assigned_to,status,notes,created_at' },
    { key: 'clinics', name: 'العيادات', select: 'id,name,sort' },
    { key: 'doctors', name: 'الأطباء', select: 'id,name' },
    { key: 'profiles', name: 'المستخدمون والصلاحيات', select: 'id,full_name,role,username,active,created_at' },
    { key: 'app_settings', name: 'إعدادات المركز', select: 'site_name,tagline,phone,address,primary_color,radius,font_scale,default_mode,work_days,updated_at' }
  ];

  const backupData = {};
  const counts = {};

  try {
    for (const t of tables) {
      prog.textContent = `جارٍ تحميل جدول «${t.name}»...`;
      try {
        const rows = await fetchAll(() => sb.from(t.key).select(t.select));
        backupData[t.key] = rows;
        counts[t.key] = rows.length;
      } catch (err) {
        console.warn(`Table ${t.key} fetch warning:`, err);
        backupData[t.key] = [];
        counts[t.key] = 0;
      }
    }

    const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
    bStatus.hidden = true;
    bResult.hidden = false;

    bResult.innerHTML = `
      <div class="panel" style="background:var(--card); border:1px solid var(--line); margin-bottom:1rem">
        <h3 style="margin-top:0; color:var(--brand)">✓ تم استخراج النسخة الاحتياطية بنجاح</h3>
        <p>إجمالي السجلات المستخرجة: <b>${totalRecords}</b> سجل عبر <b>${tables.length}</b> جداول.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:.5rem; margin-top:.8rem">
          ${tables.map(t => `
            <div style="background:var(--bg); padding:.4rem .6rem; border-radius:var(--r); font-size:.9rem">
              <span>${esc(t.name)}:</span> <b>${counts[t.key]}</b>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="row between" style="flex-wrap:wrap; gap:.8rem">
        <span class="muted small">تاريخ النسخ: ${new Date().toLocaleString('ar-EG')}</span>
        <div class="row" style="gap:.5rem">
          <button class="btn" id="dlJsonBtn">تحميل ملف JSON كامل</button>
          <button class="btn primary" id="dlXlsxBtn">تحميل ملف إكسل شامل (Excel)</button>
        </div>
      </div>
    `;

    // 1. تنزيل JSON
    bResult.querySelector('#dlJsonBtn').onclick = () => {
      const dump = {
        site_name: siteName,
        export_date: new Date().toISOString(),
        total_records: totalRecords,
        table_counts: counts,
        data: backupData
      };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `نسخة_احتياطية_${todayStr}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('تم تحميل ملف النسخة الاحتياطية (JSON)');
    };

    // 2. تنزيل Excel متعدد الأوراق
    bResult.querySelector('#dlXlsxBtn').onclick = () => {
      const wb = XLSX.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };

      for (const t of tables) {
        const rows = backupData[t.key] || [];
        if (!rows.length) {
          const emptyWs = XLSX.utils.aoa_to_sheet([['لا توجد بيانات مسجلة في هذا الجدول']]);
          XLSX.utils.book_append_sheet(wb, emptyWs, t.name.slice(0, 31));
          continue;
        }

        // استخراج الأعمدة
        const keys = Object.keys(rows[0]);
        const aoa = [keys];
        rows.forEach(r => {
          aoa.push(keys.map(k => {
            const v = r[k];
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
          }));
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = keys.map(k => ({ wch: Math.max(12, k.length + 4) }));
        XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31));
      }

      XLSX.writeFile(wb, `نسخة_احتياطية_${siteName.replace(/\s+/g, '_')}_${todayStr}.xlsx`);
      toast('تم تحميل ملف النسخة الاحتياطية الشامل (Excel)');
    };

  } catch (err) {
    bStatus.innerHTML = `<p class="bad">حدث خطأ أثناء إجراء النسخ الاحتياطي: ${esc(errMsg(err))}</p>`;
  }
}

export function renderBackup(root, ctx) {
  root.innerHTML = `
    <header class="pagehead">
      <h1>النسخ الاحتياطي لجميع البيانات</h1>
      <button class="btn primary" id="startBackupBtn">النسخ الاحتياطي لجميع البيانات</button>
    </header>
    <div class="panel">
      <h2>أخذ نسخة احتياطية شاملة</h2>
      <p>تتيح لك هذه الخاصية استخراج وتنزيل كافة بيانات مركز الأمل الطبي في أي وقت لحفظها في مكان آمن أو أرشفة السجلات.</p>
      <div style="background:var(--bg); border:1px solid var(--line); border-radius:var(--r); padding:1rem; margin:1rem 0">
        <h3 style="margin-top:0">البيانات المشمولة في النسخة الاحتياطية:</h3>
        <ul style="line-height:1.8; margin-bottom:0">
          <li><b>سجلات المراجعين والمرضى:</b> الأسماء، أرقام الهوية، العناوين، وأرقام الهواتف.</li>
          <li><b>سجل الزيارات والتشخيصات:</b> تواريخ الزيارات، الأطباء، العيادات، والتشخيص الطبي.</li>
          <li><b>الوصفات الطبية:</b> الأدوية الموصوفة والكميات والجرعات وحالة الصرف.</li>
          <li><b>الصيدلية والمخزون:</b> جميع الأصناف، الأرصدة، وحد الطلب، وسجل حركات التوريد والصرف.</li>
          <li><b>الموظفون والحضور:</b> بيانات الموظفين ومواعيد الدوام وسجلات الحضور والانصراف.</li>
          <li><b>العهد والعيادات والأطباء:</b> سجل العهد المسلمة، وقوائم العيادات والأطباء المسجلين.</li>
          <li><b>المستخدمون والإعدادات العامة:</b> حسابات النظام، أسماء المستخدمين، والشعار والهوية.</li>
        </ul>
      </div>
      <div class="row" style="margin-top:1.2rem">
        <button class="btn primary" id="startBackupBtn2" style="font-size:1.05rem; padding:.6rem 1.4rem">بدء النسخ الاحتياطي وتصدير البيانات</button>
      </div>
    </div>
  `;

  const run = () => executeBackup(ctx);
  root.querySelector('#startBackupBtn').onclick = run;
  root.querySelector('#startBackupBtn2').onclick = run;
}
