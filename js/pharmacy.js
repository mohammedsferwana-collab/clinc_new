import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, fmtDate, errMsg } from './ui.js';
import { exportBar } from './export.js';

export function renderPharmacy(root, ctx) {
  const { sb } = ctx;
  // عرض المخزون افتراضياً بدل الصرف
  let tab = 'stock';

  root.innerHTML = `<header class="pagehead">
      <h1>الصيدلية والمخزون</h1>
      <div class="chips">
        <button class="chip on" data-t="stock">المخزن والتوريد</button>
        <button class="chip" data-t="dispense">صرف الوصفات</button>
      </div>
    </header>
    <div id="pane"></div>`;

  const pane = root.querySelector('#pane');
  root.querySelector('.chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    tab = b.dataset.t;
    root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    show();
  };

  const show = () => (tab === 'dispense' ? dispensePane() : stockPane());

  async function balances() {
    const { data, error } = await sb.from('drug_balance').select('*').eq('active', true).order('name');
    if (error) { toast(errMsg(error), 'bad'); return []; }
    return data || [];
  }

  /* ============ شاشة صرف الوصفات (R7) ============ */
  async function dispensePane() {
    pane.innerHTML = '<div class="panel">جارٍ تحميل الوصفات بانتظار الصرف...</div>';
    const [{ data, error }, bal] = await Promise.all([
      sb.from('visit_items').select(`
        id, drug_id, drug_text, qty, dosage, dispensed_at, created_at,
        visits!inner(id, visit_date, clinic, doctor_name, patients(full_name, national_id))
      `).is('dispensed_at', null).order('created_at', { ascending: false }),
      balances()
    ]);

    if (error) return toast(errMsg(error), 'bad');

    const bmap = new Map(bal.map(b => [b.id, b]));
    const byName = new Map(bal.map(b => [b.name.toLowerCase(), b.id]));

    // تجميع الوصفات بحسب الزيارة
    const groups = new Map();
    (data || []).forEach(i => {
      const vid = i.visits.id;
      if (!groups.has(vid)) groups.set(vid, { visit: i.visits, items: [] });
      groups.get(vid).items.push(i);
    });

    pane.innerHTML = groups.size ? [...groups.values()].map(g => `
      <div class="panel">
        <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.4rem; margin-bottom:.6rem">
          <div>
            <b>${esc(g.visit.patients?.full_name || 'بدون اسم')}</b>
            <span class="muted small">(${esc(g.visit.patients?.national_id || 'بدون هوية')})</span>
          </div>
          <span class="muted small">${esc(g.visit.clinic || '')} — د. ${esc(g.visit.doctor_name || '—')} — ${fmtDate(g.visit.visit_date)}</span>
        </div>
        ${g.items.map(i => {
          const matchedId = i.drug_id || byName.get(i.drug_text.toLowerCase()) || '';
          const b = bmap.get(matchedId);
          return `
            <div class="item-row" data-id="${i.id}" style="grid-template-columns:1.5fr 1.6fr 90px auto; align-items:center; margin-top:.5rem">
              <div>
                <b>${esc(i.drug_text)}</b>${i.dosage ? `<div class="muted small">${esc(i.dosage)}</div>` : ''}
              </div>
              <div>
                <select class="dSelect">
                  ${!matchedId ? '<option value="">اختر الصنف من المخزن</option>' : ''}
                  ${bal.map(d => `<option value="${d.id}" ${d.id === matchedId ? 'selected' : ''}>${esc(d.name)} (رصيد: ${d.balance} ${esc(d.unit)})</option>`).join('')}
                </select>
              </div>
              <div>
                <input type="number" class="dQty" min="1" value="${i.qty}" title="كمية الصرف">
              </div>
              <div>
                <button class="btn primary sm confirmBtn" title="تأكيد الصرف وخصم المخزون">✓ تأكيد الاستلام</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('') : '<div class="panel empty">لا توجد وصفات طبية بانتظار الصرف.</div>';

    // تنفيذ عملية الصرف الذرية (R7)
    pane.onclick = async e => {
      const btn = e.target.closest('.confirmBtn');
      if (!btn) return;
      const row = btn.closest('.item-row');
      const drugId = row.querySelector('.dSelect').value;
      const qty = parseInt(row.querySelector('.dQty').value);

      if (!drugId) return toast('يرجى تحديد الدواء من المخزن أولاً', 'bad');
      if (!(qty > 0)) return toast('الكمية المحددة غير صالحة', 'bad');

      const b = bmap.get(drugId);
      if (b && b.balance < qty) {
        return toast(`تعذر الصرف: الرصيد غير كافٍ (المتاح: ${b.balance} ${b.unit})`, 'bad');
      }

      // منع النقر المزدوج فوراً
      btn.disabled = true;
      btn.textContent = 'جارٍ الصرف...';

      const { error } = await sb.rpc('dispense_item', {
        p_item: row.dataset.id,
        p_drug: drugId,
        p_qty: qty
      });

      if (error) {
        btn.disabled = false;
        btn.textContent = '✓ تأكيد الاستلام';
        return toast(errMsg(error), 'bad');
      }

      toast('تم تأكيد استلام المريض وخصم الكمية من المخزون بنجاح');
      dispensePane();
    };
  }

  /* ============ شاشة المخزن والتوريد (R6) ============ */
  async function stockPane() {
    pane.innerHTML = '<div class="panel">جارٍ تحميل المخزن...</div>';
    const bal = await balances();
    const low = bal.filter(b => b.balance <= b.min_stock);

    pane.innerHTML = `
      <div class="row between" style="margin-bottom:.8rem; flex-wrap:wrap; gap:.6rem">
        <div class="row" style="flex-wrap:wrap; gap:.5rem">
          <input id="stockSearch" placeholder="بحث باسم الصنف الدوائي" style="width:240px">
          ${low.length ? `<span class="badge bad">${low.length} صنف منخفض الرصيد</span>` : ''}
          <div id="stockExport" class="row"></div>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:.4rem">
          <button class="btn" id="importDrugsBtn" title="إضافة أصناف بكمياتها عبر ملف إكسل">+ إضافة بإكسل</button>
          <button class="btn" id="newDrugBtn">+ إضافة صنف جديد</button>
          <button class="btn primary" id="recvBtn">+ تسجيل توريد دواء</button>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>اسم الصنف</th>
              <th>وحدة القياس</th>
              <th>الرصيد الفعلي</th>
              <th>حد الطلب</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody id="stockTbody"></tbody>
        </table>
      </div>`;

    // شريط التصدير للمخزون
    const expBox = pane.querySelector('#stockExport');
    expBox.append(exportBar(() => ({
      title: 'مخزون الصيدلية والأدوية',
      subtitle: 'تاريخ التقرير: ' + N.todayISO(),
      filename: 'مخزون-الصيدلية-' + N.todayISO(),
      sections: [{
        heading: 'الأصناف الدوائية',
        columns: ['اسم الصنف', 'وحدة القياس', 'الرصيد الفعلي', 'حد الطلب', 'الحالة'],
        rows: bal.map(b => [b.name, b.unit, b.balance, b.min_stock, b.balance <= 0 ? 'منتهي' : b.balance <= b.min_stock ? 'منخفض' : 'متوفر'])
      }]
    })));

    const tbody = pane.querySelector('#stockTbody');
    const drawTable = () => {
      const q = N.arNorm(pane.querySelector('#stockSearch').value);
      const filtered = bal.filter(b => N.arNorm(b.name).includes(q));
      tbody.innerHTML = filtered.length ? filtered.map(b => `
        <tr data-id="${b.id}">
          <td><b>${esc(b.name)}</b></td>
          <td>${esc(b.unit)}</td>
          <td><b>${b.balance}</b></td>
          <td>${b.min_stock}</td>
          <td>
            ${b.balance <= 0 ? '<span class="badge bad">منتهي</span>' : b.balance <= b.min_stock ? '<span class="badge wait">منخفض</span>' : '<span class="badge ok">متوفر</span>'}
          </td>
          <td class="row" style="gap:.3rem; flex-wrap:nowrap">
            <button class="btn sm" data-act="edit" title="تعديل بيانات الصنف">تعديل</button>
            <button class="btn sm danger" data-act="del" title="حذف الصنف نهائياً">حذف</button>
          </td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="empty">لا توجد أصناف مطابقة للبحث.</td></tr>';
    };

    pane.querySelector('#stockSearch').oninput = drawTable;
    drawTable();

    // التعامل مع أزرار التعديل والحذف في جدول المخزون
    tbody.onclick = async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const drugId = tr?.dataset.id;
      const drug = bal.find(b => b.id === drugId);
      if (!drug) return;

      if (btn.dataset.act === 'edit') {
        openEditDrug(drug);
      } else if (btn.dataset.act === 'del') {
        deleteDrug(drug);
      }
    };

    // 1. تسجيل توريد دواء (R6)
    pane.querySelector('#recvBtn').onclick = () => {
      const body = openModal(`<h2>تسجيل توريد دواء</h2>
        <form id="recvForm" class="grid">
          <div style="grid-column:1/-1">
            <label>اسم الصنف *</label>
            <select name="drug_id" required>
              <option value="">اختر الدواء</option>
              ${bal.map(b => `<option value="${b.id}">${esc(b.name)} (الرصيد الحالي: ${b.balance} ${esc(b.unit)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>كمية التوريد الواردة *</label>
            <input name="qty" type="number" min="1" required placeholder="مثال: 50">
          </div>
          <div>
            <label>تاريخ التوريد</label>
            <input name="movement_date" type="date" value="${N.todayISO()}" required>
          </div>
          <div style="grid-column:1/-1">
            <label>ملاحظات (رقم الفاتورة أو جهة التوريد)</label>
            <input name="note" placeholder="مثال: توريد دفعة طبية">
          </div>
          <div style="grid-column:1/-1">
            <button class="btn primary" id="saveRecvBtn" style="width:100%">حفظ التوريد وإضافة الكمية</button>
          </div>
        </form>`);

      body.querySelector('#recvForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const qty = parseInt(f.qty);
        if (!qty || qty <= 0) return toast('الكمية يجب أن تكون أكبر من الصفر', 'bad');

        const btn = body.querySelector('#saveRecvBtn');
        btn.disabled = true;

        const { error } = await sb.from('stock_movements').insert({
          drug_id: f.drug_id,
          kind: 'in',
          qty: qty,
          movement_date: f.movement_date,
          note: N.cleanText(f.note) || null,
          created_by: ctx.profile.id
        });

        if (error) {
          btn.disabled = false;
          return toast(errMsg(error), 'bad');
        }

        toast('تم تسجيل التوريد وزيادة الرصيد بنجاح');
        closeModal();
        stockPane();
      };
    };

    // 2. إضافة صنف جديد يدوياً (R6)
    pane.querySelector('#newDrugBtn').onclick = () => {
      const body = openModal(`<h2>إضافة صنف دواء جديد</h2>
        <form id="newDrugForm" class="grid">
          <div style="grid-column:1/-1">
            <label>اسم الصنف الطبي *</label>
            <input name="name" required placeholder="الاسم العلمي أو التجاري">
          </div>
          <div>
            <label>وحدة القياس المعتمدة *</label>
            <select name="unit" required>
              ${['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'مرهم', 'زجاجة', 'كيس'].map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>حد الطلب الأدنى للتنبيه</label>
            <input name="min_stock" type="number" min="0" value="5">
          </div>
          <div>
            <label>الرصيد الابتدائي الافتتاحي</label>
            <input name="initial_stock" type="number" min="0" value="0" placeholder="0 إذا لم يوجد رصيد حالي">
          </div>
          <div style="grid-column:1/-1">
            <button class="btn primary" id="saveDrugBtn" style="width:100%">حفظ الصنف وإتاحته للأطباء</button>
          </div>
        </form>`);

      body.querySelector('#newDrugForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = body.querySelector('#saveDrugBtn');
        btn.disabled = true;

        const cleanDrugName = N.cleanText(f.name);
        const { data: newDrug, error } = await sb.from('drugs').insert({
          name: cleanDrugName,
          unit: f.unit,
          min_stock: parseInt(f.min_stock) || 0,
          active: true
        }).select().single();

        if (error) {
          btn.disabled = false;
          return toast(error.code === '23505' ? 'هذا الدواء مسجل مسبقاً في المخزن' : errMsg(error), 'bad');
        }

        // إضافة الرصيد الافتتاحي إن وُجد
        const initQty = parseInt(f.initial_stock) || 0;
        if (initQty > 0) {
          await sb.from('stock_movements').insert({
            drug_id: newDrug.id,
            kind: 'in',
            qty: initQty,
            movement_date: N.todayISO(),
            note: 'رصيد افتتاحي عند إنشاء الصنف',
            created_by: ctx.profile.id
          });
        }

        await ctx.loadLookups();
        toast('تم تسجيل الصنف الجديد بنجاح');
        closeModal();
        stockPane();
      };
    };

    // 3. تعديل صنف دوائي
    function openEditDrug(drug) {
      const units = ['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'مرهم', 'زجاجة', 'كيس'];
      if (!units.includes(drug.unit)) units.push(drug.unit);

      const body = openModal(`<h2>تعديل صنف: ${esc(drug.name)}</h2>
        <form id="editDrugForm" class="grid">
          <div style="grid-column:1/-1">
            <label>اسم الصنف الطبي *</label>
            <input name="name" value="${esc(drug.name)}" required>
          </div>
          <div>
            <label>وحدة القياس المعتمدة *</label>
            <select name="unit" required>
              ${units.map(u => `<option value="${u}" ${u === drug.unit ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>حد الطلب الأدنى للتنبيه</label>
            <input name="min_stock" type="number" min="0" value="${drug.min_stock}">
          </div>
          <div style="grid-column:1/-1; background:var(--bg); padding:.8rem; border-radius:var(--r); border:1px solid var(--line); margin-top:.4rem">
            <h4 style="margin:0 0 .4rem">تسوية الرصيد المخزني الفعلي (اختياري)</h4>
            <div class="row" style="gap:1rem; align-items:flex-end">
              <div>
                <span class="muted small">الرصيد المحسوب حالياً:</span>
                <div><b>${drug.balance} ${esc(drug.unit)}</b></div>
              </div>
              <div style="flex:1">
                <label>الرصيد الفعلي الجديد بعد الجرد</label>
                <input name="new_balance" type="number" value="${drug.balance}">
              </div>
            </div>
            <p class="muted small" style="margin:.4rem 0 0">إذا غيرت هذا الرقم فسيتم إنشاء حركة تسوية جرد آلياً لضبط الرصيد.</p>
          </div>
          <div style="grid-column:1/-1" class="row">
            <button class="btn primary" id="saveEditBtn" style="flex:1">حفظ التعديلات</button>
            <button type="button" class="btn danger" id="delDrugFromEdit">حذف الصنف</button>
          </div>
        </form>`);

      body.querySelector('#delDrugFromEdit').onclick = () => {
        closeModal();
        deleteDrug(drug);
      };

      body.querySelector('#editDrugForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = body.querySelector('#saveEditBtn');
        btn.disabled = true;

        const newName = N.cleanText(f.name);
        const newUnit = f.unit;
        const newMin = parseInt(f.min_stock) || 0;
        const targetBal = parseInt(f.new_balance);

        const { error } = await sb.from('drugs').update({
          name: newName,
          unit: newUnit,
          min_stock: newMin
        }).eq('id', drug.id);

        if (error) {
          btn.disabled = false;
          return toast(errMsg(error), 'bad');
        }

        // إذا تم تعديل الرصيد الفعلي عبر الجرد
        if (!isNaN(targetBal) && targetBal !== drug.balance) {
          const diff = targetBal - drug.balance;
          await sb.from('stock_movements').insert({
            drug_id: drug.id,
            kind: 'adjust',
            qty: diff,
            movement_date: N.todayISO(),
            note: `تسوية جرد من ${drug.balance} إلى ${targetBal}`,
            created_by: ctx.profile.id
          });
        }

        await ctx.loadLookups();
        toast('تم حفظ التعديلات بنجاح');
        closeModal();
        stockPane();
      };
    }

    // 4. حذف صنف دوائي
    async function deleteDrug(drug) {
      if (!confirm(`هل أنت متأكد من حذف صنف «${drug.name}» نهائياً من الصيدلية والمخزن؟\nسيتم فك ارتباط الوصفات وحذف سجل حركاته المخزنية.`)) return;

      try {
        // فك ارتباط الوصفات الطبية بالصنف لتفادي تعارض المفاتيح الخارجية
        await sb.from('visit_items').update({ drug_id: null }).eq('drug_id', drug.id);

        // حذف حركات المخزون التابعة لهذا الصنف
        await sb.from('stock_movements').delete().eq('drug_id', drug.id);

        // حذف الصنف نفسه
        const { error } = await sb.from('drugs').delete().eq('id', drug.id);
        if (error) {
          // محاولة إيقاف التفعيل في حال منعت قواعد قاعدة البيانات الحذف النهائي
          await sb.from('drugs').update({ active: false }).eq('id', drug.id);
          toast('تم إيقاف تفعيل الصنف وإخفاؤه من القائمة', 'ok');
        } else {
          toast('تم حذف الصنف بنجاح');
        }

        await ctx.loadLookups();
        stockPane();
      } catch (err) {
        toast(errMsg(err), 'bad');
      }
    }

    // 5. إضافة أصناف بإكسل (Excel Import)
    pane.querySelector('#importDrugsBtn').onclick = () => {
      openExcelImportModal();
    };

    function openExcelImportModal() {
      const body = openModal(`<h2>استيراد أدوية من ملف إكسل</h2>
        <div class="panel" style="margin-bottom:1rem">
          <p>يمكنك استيراد قائمة الأدوية والمخزون الأولي دفعة واحدة من ملف إكسل (.xlsx أو .xls أو .csv).</p>
          <div class="row" style="gap:.6rem; margin-top:.5rem">
            <button class="btn sm" id="dlTemplateBtn">⬇ تحميل نموذج إكسل للأدوية</button>
            <span class="muted small">يحتوي النموذج على الأعمدة: اسم الصنف، وحدة القياس، الرصيد الابتدائي، حد الطلب.</span>
          </div>
        </div>

        <div style="margin-bottom:1rem">
          <label>اختر ملف الإكسل</label>
          <input type="file" id="excelFile" accept=".xlsx,.xls,.csv">
        </div>

        <div id="importPreview" style="max-height:280px; overflow-y:auto; margin-bottom:1rem"></div>

        <div class="row between" id="importActions" hidden>
          <span id="importSummary" class="muted"></span>
          <button class="btn primary" id="confirmImportBtn">تأكيد واستيراد الأصناف</button>
        </div>`, { wide: true });

      // تحميل نموذج إكسل
      body.querySelector('#dlTemplateBtn').onclick = () => {
        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        const headers = ['اسم الصنف', 'وحدة القياس', 'الرصيد الابتدائي', 'حد الطلب'];
        const sampleData = [
          headers,
          ['باراسيتامول 500 ملغم أقراص', 'حبة', 200, 30],
          ['أموكسيسيلين 500 ملغم كبسول', 'علبة', 50, 10],
          ['مرهم فيوسيدين 15 غرام', 'مرهم', 40, 8],
          ['محلول ملحي وريدي 500 مل', 'عبوة', 25, 5],
          ['ديكلوفيناك 75 ملغم أمبولات', 'أمبولة', 60, 15]
        ];
        const ws = XLSX.utils.aoa_to_sheet(sampleData);
        ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws, 'الأدوية والمخزون');
        XLSX.writeFile(wb, 'نموذج_أدوية_الصيدلية.xlsx');
      };

      let parsedItems = [];
      const fileInput = body.querySelector('#excelFile');
      const previewDiv = body.querySelector('#importPreview');
      const actionsDiv = body.querySelector('#importActions');
      const summarySpan = body.querySelector('#importSummary');
      const confirmBtn = body.querySelector('#confirmImportBtn');

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

          // البحث عن صف العناوين
          let headerIdx = -1;
          for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
            const rowStr = rawRows[i].map(c => String(c).trim()).join(' ');
            if (/اسم|دواء|صنف|drug|name/i.test(rowStr)) {
              headerIdx = i;
              break;
            }
          }
          if (headerIdx === -1) headerIdx = 0;

          const headers = rawRows[headerIdx].map(c => String(c).trim());
          const nameCol = headers.findIndex(h => /اسم.*صنف|اسم.*دواء|^اسم$|name|drug/i.test(h));
          const unitCol = headers.findIndex(h => /وحدة|unit/i.test(h));
          const qtyCol = headers.findIndex(h => /رصيد.*ابتدائي|رصيد|كمية|qty|stock|balance/i.test(h));
          const minCol = headers.findIndex(h => /حد.*طلب|حد.*أدنى|min/i.test(h));

          if (nameCol === -1) {
            previewDiv.innerHTML = '<p class="muted bad">تعذر العثور على عمود «اسم الصنف». يرجى التأكد من تسمية رأس العمود.</p>';
            actionsDiv.hidden = true;
            return;
          }

          parsedItems = [];
          const existingNames = new Set(bal.map(b => N.arNorm(b.name)));

          for (let i = headerIdx + 1; i < rawRows.length; i++) {
            const r = rawRows[i];
            const name = N.cleanText(r[nameCol]);
            if (!name) continue;

            const unit = (unitCol >= 0 ? N.cleanText(r[unitCol]) : '') || 'حبة';
            const initStock = Math.max(0, parseInt(r[qtyCol]) || 0);
            const minStock = Math.max(0, parseInt(r[minCol]) || 5);
            const isDuplicate = existingNames.has(N.arNorm(name));

            parsedItems.push({ name, unit, initStock, minStock, isDuplicate });
          }

          if (!parsedItems.length) {
            previewDiv.innerHTML = '<p class="muted">لم يتم العثور على أصناف صالحة للاستيراد في الملف.</p>';
            actionsDiv.hidden = true;
            return;
          }

          const newCount = parsedItems.filter(x => !x.isDuplicate).length;
          const dupCount = parsedItems.filter(x => x.isDuplicate).length;

          previewDiv.innerHTML = `
            <div class="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>اسم الصنف</th>
                    <th>الوحدة</th>
                    <th>الرصيد الابتدائي</th>
                    <th>حد الطلب</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  ${parsedItems.map(p => `
                    <tr>
                      <td><b>${esc(p.name)}</b></td>
                      <td>${esc(p.unit)}</td>
                      <td>${p.initStock}</td>
                      <td>${p.minStock}</td>
                      <td>
                        ${p.isDuplicate
                          ? '<span class="badge wait" title="مسجل مسبقاً في المخزن">موجود مسبقاً (سيتم تحديث رصيده إن وُجدت كمية)</span>'
                          : '<span class="badge ok">صنف جديد</span>'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>`;

          summarySpan.textContent = `الإجمالي: ${parsedItems.length} صنف (${newCount} جديد، ${dupCount} موجود مسبقاً).`;
          actionsDiv.hidden = false;

        } catch (err) {
          previewDiv.innerHTML = `<p class="bad">خطأ أثناء قراءة الملف: ${esc(err.message)}</p>`;
          actionsDiv.hidden = true;
        }
      };

      confirmBtn.onclick = async () => {
        if (!parsedItems.length) return;
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'جارٍ الاستيراد...';

        let addedCount = 0;
        let updatedCount = 0;
        const bmapByName = new Map(bal.map(b => [N.arNorm(b.name), b]));

        for (const item of parsedItems) {
          const normKey = N.arNorm(item.name);
          const existing = bmapByName.get(normKey);

          if (existing) {
            // تحديث الرصيد إذا كان هناك رصيد ابتدائي وارد
            if (item.initStock > 0) {
              await sb.from('stock_movements').insert({
                drug_id: existing.id,
                kind: 'in',
                qty: item.initStock,
                movement_date: N.todayISO(),
                note: 'توريد رصيد من استيراد إكسل',
                created_by: ctx.profile.id
              });
              updatedCount++;
            }
          } else {
            // إضافة صنف جديد
            const { data: newDrug, error } = await sb.from('drugs').insert({
              name: item.name,
              unit: item.unit,
              min_stock: item.minStock,
              active: true
            }).select().single();

            if (!error && newDrug) {
              addedCount++;
              if (item.initStock > 0) {
                await sb.from('stock_movements').insert({
                  drug_id: newDrug.id,
                  kind: 'in',
                  qty: item.initStock,
                  movement_date: N.todayISO(),
                  note: 'رصيد افتتاحي عبر استيراد إكسل',
                  created_by: ctx.profile.id
                });
              }
            }
          }
        }

        await ctx.loadLookups();
        toast(`اكتمل الاستيراد: تم إضافة ${addedCount} صنف جديد وتحديث ${updatedCount} صنف`);
        closeModal();
        stockPane();
      };
    }
  }

  show();
}