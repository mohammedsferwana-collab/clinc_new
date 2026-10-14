import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, fmtDate, errMsg } from './ui.js';
import { exportBar } from './export.js';

function expiryStatus(expDate) {
  if (!expDate) return { status: 'ok', label: '—' };
  const today = N.todayISO();
  const limit = new Date();
  limit.setDate(limit.getDate() + 30);
  const limitISO = limit.toISOString().slice(0, 10);

  if (expDate < today) return { status: 'expired', label: 'منتهي الصلاحية', badge: 'bad' };
  if (expDate <= limitISO) return { status: 'soon', label: 'قريب الانتهاء', badge: 'wait' };
  return { status: 'ok', label: fmtDate(expDate), badge: 'ok' };
}

export function renderPharmacy(root, ctx) {
  const { sb } = ctx;
  let tab = 'dispense';

  root.innerHTML = `<header class="pagehead">
      <div>
        <h1 style="margin:0">بوابة الصيدلية وإدارة المخزون الدوائي</h1>
        <p class="muted small" style="margin:.2rem 0 0">استلام الوصفات الإلكترونية المحولة من الأطباء، إدارة الأصناف والأسعار وتنبيهات الصلاحية والنفاد</p>
      </div>
      <div class="chips">
        <button class="chip on" data-t="dispense">💊 صرف العلاج والوصفات المحولة</button>
        <button class="chip" data-t="stock">📦 إدارة المخزون والأصناف والتوريد</button>
      </div>
    </header>
    <div id="alertsBar"></div>
    <div id="pane"></div>`;

  const pane = root.querySelector('#pane');
  const alertsBar = root.querySelector('#alertsBar');

  root.querySelector('.chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    tab = b.dataset.t;
    root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
    show();
  };

  async function balances() {
    const { data, error } = await sb.from('drug_balance').select('*').eq('active', true).order('name');
    if (error) { toast(errMsg(error), 'bad'); return []; }
    const list = data || [];
    renderTopAlerts(list);
    return list;
  }

  function renderTopAlerts(bal) {
    const lowStock = bal.filter(b => b.balance <= b.min_stock);
    const expAlert = bal.filter(b => {
      const st = expiryStatus(b.expiry_date).status;
      return st === 'expired' || st === 'soon';
    });

    if (!lowStock.length && !expAlert.length) {
      alertsBar.innerHTML = '';
      return;
    }

    alertsBar.innerHTML = `
      <div class="alert-banner noprint">
        ${lowStock.length ? `<div>⚠️ <b>تنبيه نفاد المخزون (${lowStock.length}):</b>${lowStock.slice(0, 5).map(d => `${esc(d.name)} (${d.balance})`).join('، ')}</div>` : ''}
        ${expAlert.length ? `<div>⏰ <b>تنبيه صلاحية الأدوية (${expAlert.length}):</b>${expAlert.slice(0, 5).map(d => `${esc(d.name)} (${fmtDate(d.expiry_date)})`).join('، ')}</div>` : ''}
      </div>
    `;
  }

  const show = () => (tab === 'dispense' ? dispensePane() : stockPane());

  /* ============ 1. صفحة صرف العلاج (Prescription Fulfillment) ============ */
  async function dispensePane() {
    pane.innerHTML = '<div class="panel">جارٍ تحميل الوصفات الإلكترونية المحولة من الأطباء...</div>';
    const [{ data, error }, bal] = await Promise.all([
      sb.from('visit_items').select(`
        id, drug_id, drug_text, qty, dosage, dispensed_at, created_at,
        visits!inner(id, visit_date, clinic, doctor_name, diagnosis, patients(full_name, national_id))
      `).is('dispensed_at', null).order('created_at', { ascending: false }),
      balances()
    ]);

    if (error) return toast(errMsg(error), 'bad');

    const bmap = new Map(bal.map(b => [b.id, b]));
    const byName = new Map(bal.map(b => [b.name.toLowerCase(), b.id]));

    const groups = new Map();
    (data || []).forEach(i => {
      const vid = i.visits.id;
      if (!groups.has(vid)) groups.set(vid, { visit: i.visits, items: [] });
      groups.get(vid).items.push(i);
    });

    pane.innerHTML = groups.size ? [...groups.values()].map(g => `
      <div class="panel" data-vid="${g.visit.id}" style="border-inline-start: 4px solid var(--brand)">
        <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.5rem; margin-bottom:.6rem">
          <div>
            <b style="font-size:1.05rem">المريض: ${esc(g.visit.patients?.full_name || 'بدون اسم')}</b>
            <span class="muted small"> (هوية: ${esc(g.visit.patients?.national_id || '—')})</span>
            ${g.visit.diagnosis ? `<div class="small muted">التشخيص: <b>${esc(g.visit.diagnosis)}</b></div>` : ''}
          </div>
          <div style="text-align:left">
            <span class="badge ok">${esc(g.visit.clinic || 'عيادة')} — د. ${esc(g.visit.doctor_name || '—')}</span>
            <div class="muted small">${fmtDate(g.visit.visit_date)}</div>
          </div>
        </div>
        ${g.items.map(i => {
          const matchedId = i.drug_id || byName.get(i.drug_text.toLowerCase()) || '';
          return `
            <div class="item-row" data-id="${i.id}" style="grid-template-columns:1.5fr 1.8fr 90px auto; align-items:center; margin-top:.5rem">
              <div>
                <b>${esc(i.drug_text)}</b>${i.dosage ? `<div class="muted small">الجرعة: ${esc(i.dosage)}</div>` : ''}
              </div>
              <div>
                <select class="dSelect">
                  ${!matchedId ? '<option value="">اختر الصنف المطابق من المخزن</option>' : ''}
                  ${bal.map(d => `<option value="${d.id}" ${d.id === matchedId ? 'selected' : ''}>${esc(d.name)} ${d.dosage ? `(${esc(d.dosage)})` : ''} — متاح: ${d.balance} ${esc(d.unit)}</option>`).join('')}
                </select>
              </div>
              <div>
                <input type="number" class="dQty" min="1" value="${i.qty}" title="الكمية المصروفة">
              </div>
              <div>
                <button class="btn primary sm confirmBtn">✓ صرف وخصم</button>
              </div>
            </div>
          `;
        }).join('')}
        ${g.items.length > 1 ? `
          <div style="margin-top:.8rem; text-align:left; border-top:1px dashed var(--line); padding-top:.5rem">
            <button class="btn primary sm dispenseAllBtn">✓ تأكيد صرف كامل الوصفة (${g.items.length} أصناف)</button>
          </div>
        ` : ''}
      </div>
    `).join('') : '<div class="panel empty">لا توجد وصفات إلكترونية بانتظار الصرف حالياً.</div>';

    pane.onclick = async e => {
      const btn = e.target.closest('.confirmBtn');
      if (btn) {
        const row = btn.closest('.item-row');
        await dispenseSingleRow(row, btn, bmap);
        dispensePane();
        return;
      }

      const allBtn = e.target.closest('.dispenseAllBtn');
      if (allBtn) {
        const panel = allBtn.closest('.panel');
        const rows = [...panel.querySelectorAll('.item-row')];
        allBtn.disabled = true;
        allBtn.textContent = 'جارٍ صرف الوصفة...';
        for (const r of rows) {
          const b = r.querySelector('.confirmBtn');
          if (b && !b.disabled) await dispenseSingleRow(r, b, bmap);
        }
        dispensePane();
      }
    };
  }

  async function dispenseSingleRow(row, btn, bmap) {
    const drugId = row.querySelector('.dSelect').value;
    const qty = parseInt(row.querySelector('.dQty').value);

    if (!drugId) { toast('يرجى تحديد الدواء من المخزن أولاً', 'bad'); return false; }
    if (!(qty > 0)) { toast('الكمية المحددة غير صالحة', 'bad'); return false; }

    const b = bmap.get(drugId);
    if (b && b.balance < qty) {
      toast(`تعذر الصرف للصنف «${b.name}»: الرصيد غير كافٍ (المتاح: ${b.balance})`, 'bad');
      return false;
    }

    btn.disabled = true;
    btn.textContent = 'جارٍ الصرف...';

    const { error } = await sb.rpc('dispense_item', {
      p_item: row.dataset.id,
      p_drug: drugId,
      p_qty: qty
    });

    if (error) {
      btn.disabled = false;
      btn.textContent = '✓ صرف وخصم';
      toast(errMsg(error), 'bad');
      return false;
    }

    toast('تم صرف الدواء للمريض وخصم الكمية آلياً من المخزون');
    return true;
  }

  /* ============ 2. صفحة إدارة المخزون وإضافة وتحديث الأدوية ============ */
  async function stockPane() {
    pane.innerHTML = '<div class="panel">جارٍ تحميل مخزون الصيدلية...</div>';
    const bal = await balances();

    pane.innerHTML = `
      <div class="row between" style="margin-bottom:.8rem; flex-wrap:wrap; gap:.6rem">
        <div class="row" style="flex-wrap:wrap; gap:.5rem">
          <input id="stockSearch" placeholder="بحث بالاسم التجاري، العلمي، أو المورد..." style="width:260px">
          <select id="stockFilter" style="width:180px">
            <option value="">كل الأصناف (${bal.length})</option>
            <option value="low">قريبة النفاد / منتهية الرصيد</option>
            <option value="exp">قريبة الانتهاء / منتهية الصلاحية</option>
          </select>
          <div id="stockExport" class="row"></div>
        </div>
        <div class="row" style="flex-wrap:wrap; gap:.4rem">
          <button class="btn" id="newDrugBtn">+ إضافة صنف دواء جديد</button>
          <button class="btn primary" id="recvBtn">+ إدخال شحنة / فاتورة توريد (Stock In)</button>
        </div>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>الاسم التجاري</th>
              <th>الاسم العلمي</th>
              <th>الجرعة / الوحدة</th>
              <th>الكمية المتاحة</th>
              <th>السعر</th>
              <th>الشركة الموردة</th>
              <th>تاريخ الانتهاء</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody id="stockTbody"></tbody>
        </table>
      </div>`;

    const expBox = pane.querySelector('#stockExport');
    expBox.append(exportBar(() => ({
      title: 'مخزون الصيدلية والأدوية',
      subtitle: 'تاريخ التقرير: ' + N.todayISO(),
      filename: 'مخزون-الصيدلية-' + N.todayISO(),
      sections: [{
        heading: 'الأصناف الدوائية',
        columns: ['الاسم التجاري', 'الاسم العلمي', 'الجرعة', 'الوحدة', 'الكمية المتاحة', 'السعر', 'المورد', 'تاريخ الانتهاء', 'حد الطلب'],
        rows: bal.map(b => [b.name, b.scientific_name || '', b.dosage || '', b.unit, b.balance, b.price || 0, b.supplier || '', b.expiry_date || '', b.min_stock])
      }]
    })));

    const tbody = pane.querySelector('#stockTbody');
    const drawTable = () => {
      const q = N.arNorm(pane.querySelector('#stockSearch').value);
      const flt = pane.querySelector('#stockFilter').value;

      const filtered = bal.filter(b => {
        const matchQ = !q || N.arNorm([b.name, b.scientific_name, b.supplier, b.dosage].join(' ')).includes(q);
        if (!matchQ) return false;
        if (flt === 'low') return b.balance <= b.min_stock;
        if (flt === 'exp') {
          const st = expiryStatus(b.expiry_date).status;
          return st === 'expired' || st === 'soon';
        }
        return true;
      });

      tbody.innerHTML = filtered.length ? filtered.map(b => {
        const exp = expiryStatus(b.expiry_date);
        return `
        <tr data-id="${b.id}">
          <td><b>${esc(b.name)}</b></td>
          <td>${esc(b.scientific_name || '—')}</td>
          <td>${esc(b.dosage || '—')} <span class="muted small">(${esc(b.unit)})</span></td>
          <td><b>${b.balance}</b> <span class="muted small">(حد: ${b.min_stock})</span></td>
          <td>${Number(b.price || 0).toFixed(2)}</td>
          <td>${esc(b.supplier || '—')}</td>
          <td>${b.expiry_date ? `<span class="badge ${exp.badge}">${fmtDate(b.expiry_date)}</span>` : '—'}</td>
          <td>
            ${b.balance <= 0 ? '<span class="badge bad">نفد الرصيد</span>' : b.balance <= b.min_stock ? '<span class="badge wait">منخفض</span>' : '<span class="badge ok">متوفر</span>'}
            ${exp.status === 'expired' ? '<span class="badge bad">منتهي الصلاحية</span>' : exp.status === 'soon' ? '<span class="badge wait">قريب الانتهاء</span>' : ''}
          </td>
          <td class="row" style="gap:.3rem; flex-wrap:nowrap">
            <button class="btn sm" data-act="edit">تعديل</button>
            <button class="btn sm danger" data-act="del">حذف</button>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" class="empty">لا توجد أصناف مطابقة للبحث.</td></tr>';
    };

    pane.querySelector('#stockSearch').oninput = drawTable;
    pane.querySelector('#stockFilter').onchange = drawTable;
    drawTable();

    tbody.onclick = e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const drug = bal.find(b => b.id === tr?.dataset.id);
      if (!drug) return;
      if (btn.dataset.act === 'edit') openEditDrug(drug);
      else if (btn.dataset.act === 'del') deleteDrug(drug);
    };

    pane.querySelector('#recvBtn').onclick = () => {
      const body = openModal(`<h2>إدخال شحنة / فاتورة توريد جديدة (Stock In)</h2>
        <form id="recvForm" class="grid">
          <div style="grid-column:1/-1">
            <label>الصنف الدوائي *</label>
            <select name="drug_id" required>
              <option value="">اختر الدواء</option>
              ${bal.map(b => `<option value="${b.id}">${esc(b.name)} (المتاح: ${b.balance}${esc(b.unit)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>الكمية الواردة *</label>
            <input name="qty" type="number" min="1" required placeholder="مثال: 100">
          </div>
          <div>
            <label>تاريخ التوريد *</label>
            <input name="movement_date" type="date" value="${N.todayISO()}" required>
          </div>
          <div>
            <label>تحديث تاريخ انتهاء الصلاحية (اختياري)</label>
            <input name="expiry_date" type="date">
          </div>
          <div>
            <label>الشركة الموردة / رقم الفاتورة</label>
            <input name="note" placeholder="مثال: فاتورة رقم 405 - شركة الشفاء">
          </div>
          <div style="grid-column:1/-1">
            <button class="btn primary" id="saveRecvBtn" style="width:100%">✓ حفظ الشحنة وإضافة الكمية للمخزون</button>
          </div>
        </form>`);

      body.querySelector('#recvForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const qty = parseInt(f.qty);
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

        if (f.expiry_date) {
          await sb.from('drugs').update({ expiry_date: f.expiry_date }).eq('id', f.drug_id);
        }

        toast('تم إدخال الشحنة وزيادة رصيد المخزون بنجاح');
        closeModal();
        stockPane();
      };
    };

    pane.querySelector('#newDrugBtn').onclick = () => {
      const body = openModal(`<h2>إضافة صنف دواء جديد</h2>
        <form id="newDrugForm" class="grid">
          <div>
            <label>الاسم التجاري (Trade Name) *</label>
            <input name="name" required placeholder="مثال: Panadol Extra">
          </div>
          <div>
            <label>الاسم العلمي (Scientific Name) *</label>
            <input name="scientific_name" required placeholder="مثال: Paracetamol + Caffeine">
          </div>
          <div>
            <label>الجرعة / التركيز (Dosage)</label>
            <input name="dosage" placeholder="مثال: 500mg">
          </div>
          <div>
            <label>وحدة القياس *</label>
            <select name="unit" required>
              ${['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'مرهم', 'زجاجة', 'كيس'].map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>الكمية الافتتاحية (Initial Stock) *</label>
            <input name="initial_stock" type="number" min="0" value="0" required>
          </div>
          <div>
            <label>السعر (Price)</label>
            <input name="price" type="number" step="0.01" min="0" value="0">
          </div>
          <div>
            <label>الشركة الموردة (Supplier)</label>
            <input name="supplier" placeholder="اسم الشركة أو المستودع المورد">
          </div>
          <div>
            <label>تاريخ الانتهاء (Expiry Date)</label>
            <input name="expiry_date" type="date">
          </div>
          <div>
            <label>حد التنبيه للنفاد (Low Stock Alert)</label>
            <input name="min_stock" type="number" min="0" value="10">
          </div>
          <div style="grid-column:1/-1; margin-top:.4rem">
            <button class="btn primary" id="saveDrugBtn" style="width:100%">✓ حفظ الصنف في دليل الأدوية والمخزون</button>
          </div>
        </form>`, { wide: true });

      body.querySelector('#newDrugForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = body.querySelector('#saveDrugBtn');
        btn.disabled = true;

        const { data: newDrug, error } = await sb.from('drugs').insert({
          name: N.cleanText(f.name),
          scientific_name: N.cleanText(f.scientific_name) || null,
          dosage: N.cleanText(f.dosage) || null,
          unit: f.unit,
          price: parseFloat(f.price) || 0,
          supplier: N.cleanText(f.supplier) || null,
          expiry_date: f.expiry_date || null,
          min_stock: parseInt(f.min_stock) || 0,
          active: true
        }).select().single();

        if (error) {
          btn.disabled = false;
          return toast(error.code === '23505' ? 'هذا الدواء مسجل مسبقاً' : errMsg(error), 'bad');
        }

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

    function openEditDrug(drug) {
      const units = ['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'مرهم', 'زجاجة', 'كيس'];
      if (!units.includes(drug.unit)) units.push(drug.unit);

      const body = openModal(`<h2>تعديل بيانات وكمية الصنف: ${esc(drug.name)}</h2>
        <form id="editDrugForm" class="grid">
          <div>
            <label>الاسم التجاري *</label>
            <input name="name" value="${esc(drug.name)}" required>
          </div>
          <div>
            <label>الاسم العلمي</label>
            <input name="scientific_name" value="${esc(drug.scientific_name || '')}">
          </div>
          <div>
            <label>الجرعة / التركيز</label>
            <input name="dosage" value="${esc(drug.dosage || '')}">
          </div>
          <div>
            <label>وحدة القياس *</label>
            <select name="unit" required>
              ${units.map(u => `<option value="${u}" ${u === drug.unit ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>السعر</label>
            <input name="price" type="number" step="0.01" min="0" value="${drug.price || 0}">
          </div>
          <div>
            <label>الشركة الموردة</label>
            <input name="supplier" value="${esc(drug.supplier || '')}">
          </div>
          <div>
            <label>تاريخ الانتهاء</label>
            <input name="expiry_date" type="date" value="${esc(drug.expiry_date || '')}">
          </div>
          <div>
            <label>حد التنبيه للنفاد</label>
            <input name="min_stock" type="number" min="0" value="${drug.min_stock}">
          </div>

          <div style="grid-column:1/-1; background:var(--bg); padding:.8rem; border-radius:var(--r); border:1px solid var(--line)">
            <label>تعديل الكمية المتاحة حالياً (الرصيد الحالي: <b>${drug.balance} ${esc(drug.unit)}</b>)</label>
            <input name="new_balance" type="number" value="${drug.balance}">
          </div>

          <div style="grid-column:1/-1" class="row">
            <button class="btn primary" id="saveEditBtn" style="flex:1">✓ حفظ التعديلات</button>
            <button type="button" class="btn danger" id="delDrugFromEdit">حذف الصنف</button>
          </div>
        </form>`, { wide: true });

      body.querySelector('#delDrugFromEdit').onclick = () => {
        closeModal();
        deleteDrug(drug);
      };

      body.querySelector('#editDrugForm').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = body.querySelector('#saveEditBtn');
        btn.disabled = true;

        const targetBal = parseInt(f.new_balance);

        const { error } = await sb.from('drugs').update({
          name: N.cleanText(f.name),
          scientific_name: N.cleanText(f.scientific_name) || null,
          dosage: N.cleanText(f.dosage) || null,
          unit: f.unit,
          price: parseFloat(f.price) || 0,
          supplier: N.cleanText(f.supplier) || null,
          expiry_date: f.expiry_date || null,
          min_stock: parseInt(f.min_stock) || 0
        }).eq('id', drug.id);

        if (error) {
          btn.disabled = false;
          return toast(errMsg(error), 'bad');
        }

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
        toast('تم تحديث بيانات الصنف بنجاح');
        closeModal();
        stockPane();
      };
    }

    async function deleteDrug(drug) {
      if (!confirm(`هل أنت متأكد من حذف صنف «${drug.name}» نهائياً؟`)) return;
      try {
        await sb.from('visit_items').update({ drug_id: null }).eq('drug_id', drug.id);
        await sb.from('stock_movements').delete().eq('drug_id', drug.id);
        const { error } = await sb.from('drugs').delete().eq('id', drug.id);
        if (error) await sb.from('drugs').update({ active: false }).eq('id', drug.id);
        await ctx.loadLookups();
        toast('تم حذف الصنف بنجاح');
        stockPane();
      } catch (err) {
        toast(errMsg(err), 'bad');
      }
    }
  }

  show();
}