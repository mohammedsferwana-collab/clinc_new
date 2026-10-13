import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, fmtDate, errMsg } from './ui.js';
import { exportBar } from './export.js';

export function renderPharmacy(root, ctx) {
  const { sb } = ctx;
  let tab = 'dispense';

  root.innerHTML = `<header class="pagehead">
      <h1>الصيدلية والمخزون</h1>
      <div class="chips">
        <button class="chip on" data-t="dispense">صرف الوصفات</button>
        <button class="chip" data-t="stock">المخزن والتوريد</button>
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
    return data;
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
    data.forEach(i => {
      const vid = i.visits.id;
      if (!groups.has(vid)) groups.set(vid, { visit: i.visits, items: [] });
      groups.get(vid).items.push(i);
    });

    pane.innerHTML = groups.size ? [...groups.values()].map(g => `
      <div class="panel">
        <div class="row between" style="border-bottom:1px solid var(--line); padding-bottom:.4rem; margin-bottom:.6rem">
          <div>
            <b>${esc(g.visit.patients.full_name)}</b>
            <span class="muted small">(${esc(g.visit.patients.national_id || 'بدون هوية')})</span>
          </div>
          <span class="muted small">${esc(g.visit.clinic || '')} — د. ${esc(g.visit.doctor_name || '—')} — ${fmtDate(g.visit.visit_date)}</span>
        </div>
        ${g.items.map(i => {
          const matchedId = i.drug_id || byName.get(i.drug_text.toLowerCase()) || '';
          const b = bmap.get(matchedId);
          const hasBalance = b && b.balance >= i.qty;
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
      <div class="row between" style="margin-bottom:.8rem">
        <div class="row">
          <input id="stockSearch" placeholder="بحث باسم الصنف الدوائي" style="width:260px">
          ${low.length ? `<span class="badge bad">${low.length} صنف منخفض الرصيد</span>` : ''}
        </div>
        <div class="row">
          <button class="btn primary" id="recvBtn">+ تسجيل توريد دواء</button>
          <button class="btn" id="newDrugBtn">+ إضافة صنف جديد للمخزن</button>
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
            </tr>
          </thead>
          <tbody id="stockTbody"></tbody>
        </table>
      </div>`;

    const tbody = pane.querySelector('#stockTbody');
    const drawTable = () => {
      const q = N.arNorm(pane.querySelector('#stockSearch').value);
      tbody.innerHTML = bal.filter(b => N.arNorm(b.name).includes(q)).map(b => `
        <tr>
          <td><b>${esc(b.name)}</b></td>
          <td>${esc(b.unit)}</td>
          <td><b>${b.balance}</b></td>
          <td>${b.min_stock}</td>
          <td>
            ${b.balance <= 0 ? '<span class="badge bad">منتهي</span>' : b.balance <= b.min_stock ? '<span class="badge wait">منخفض</span>' : '<span class="badge ok">متوفر</span>'}
          </td>
        </tr>
      `).join('');
    };

    pane.querySelector('#stockSearch').oninput = drawTable;
    drawTable();

    // 1. تسجيل توريد دواء (R6)
    pane.querySelector('#recvBtn').onclick = () => {
      const body = openModal(`<h2>تسجيل توريد دواء</h2>
        <form id="recvForm" class="grid">
          <div style="grid-column:1/-1">
            <label>اسم الصنف *</label>
            <select name="drug_id" required>
              <option value="">اختر الدواء</option>
              ${bal.map(b => `<option value="${b.id}">${esc(b.name)} (الرصيد الحالي: ${b.balance}${esc(b.unit)})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>كمية التوريد الواردة *</label>
            <input name="qty" type="number" min="1" required placeholder="مثال: 5">
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

    // 2. إضافة صنف جديد (R6)
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
              ${['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'مرهم'].map(u => `<option value="${u}">${u}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>حد الطلب الأدنى للتنبيه</label>
            <input name="min_stock" type="number" min="0" value="5">
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

        const { error } = await sb.from('drugs').insert({
          name: N.cleanText(f.name),
          unit: f.unit,
          min_stock: parseInt(f.min_stock) || 0,
          active: true
        });

        if (error) {
          btn.disabled = false;
          return toast(error.code === '23505' ? 'هذا الدواء مسجل مسبقاً في المخزن' : errMsg(error), 'bad');
        }

        await ctx.loadLookups();
        toast('تم تسجيل الصنف الجديد بنجاح');
        closeModal();
        stockPane();
      };
    };
  }

  show();
}