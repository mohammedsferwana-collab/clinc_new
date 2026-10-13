import * as N from './normalize.js';
import { esc, toast, openModal, closeModal, fmtDate, errMsg, fetchAll } from './ui.js';
import { exportBar } from './export.js';

export function renderPharmacy(root, ctx) {
  const { sb } = ctx;
  let tab = 'dispense';
  root.innerHTML = `<header class="pagehead"><h1>الصيدلية</h1><div class="chips">
    <button class="chip on" data-t="dispense">الصرف</button><button class="chip" data-t="stock">المخزون</button></div></header><div id="pane"></div>`;
  const pane = root.querySelector('#pane');
  root.querySelector('.chips').onclick = e => {
    const b = e.target.closest('.chip'); if (!b) return;
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

  async function dispensePane() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const [{ data, error }, bal] = await Promise.all([
      sb.from('visit_items').select('id,drug_id,drug_text,qty,dosage,created_at,visits!inner(id,visit_date,clinic,patients(full_name))')
        .is('dispensed_at', null).gte('visits.visit_date', since).order('created_at'),
      balances(),
    ]);
    if (error) return toast(errMsg(error), 'bad');
    const bmap = new Map(bal.map(b => [b.id, b]));
    const byName = new Map(bal.map(b => [b.name.toLowerCase(), b.id]));
    const groups = new Map();
    data.forEach(i => { const k = i.visits.id; if (!groups.has(k)) groups.set(k, { v: i.visits, items: [] }); groups.get(k).items.push(i); });
    pane.innerHTML = groups.size ? [...groups.values()].map(g => `<div class="panel"><div class="row between"><b>${esc(g.v.patients.full_name)}</b>
      <span class="muted small">${esc(g.v.clinic || '')} — ${fmtDate(g.v.visit_date)}</span></div>
      ${g.items.map(i => {
        const sel = i.drug_id || byName.get(i.drug_text.toLowerCase()) || '';
        return `<div class="item-row" data-id="${i.id}" style="grid-template-columns:1fr 1.4fr 80px auto;align-items:center;margin-top:.6rem">
          <div>${esc(i.drug_text)}${i.dosage ? `<div class="muted small">${esc(i.dosage)}</div>` : ''}</div>
          <select>${sel ? '' : '<option value="">اختر الدواء من المخزون</option>'}${bal.map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)} (${b.balance} ${esc(b.unit)})</option>`).join('')}</select>
          <input type="number" min="1" value="${i.qty}" aria-label="الكمية"><button class="btn primary sm">صرف</button></div>`;
      }).join('')}</div>`).join('')
      : '<div class="panel empty">لا توجد وصفات بانتظار الصرف.</div>';
    pane.onclick = async e => {
      const btn = e.target.closest('button.primary'); if (!btn) return;
      const row = btn.closest('.item-row');
      const drug = row.querySelector('select').value, qty = parseInt(row.querySelector('input').value);
      if (!drug) return toast('اختر الدواء من المخزون أولاً', 'bad');
      if (!(qty > 0)) return toast('الكمية غير صالحة', 'bad');
      const b = bmap.get(drug);
      if (b && b.balance < qty && !confirm(`الرصيد المتاح ${b.balance} فقط. المتابعة في الصرف؟`)) return;
      btn.disabled = true;
      const { error } = await sb.rpc('dispense_item', { p_item: row.dataset.id, p_drug: drug, p_qty: qty });
      if (error) { btn.disabled = false; return toast(errMsg(error), 'bad'); }
      toast('تم الصرف وخصمه من المخزون'); dispensePane();
    };
  }

  async function stockPane() {
    const bal = await balances();
    const low = bal.filter(b => b.balance <= b.min_stock);
    pane.innerHTML = `<div class="row between" style="margin-bottom:.8rem"><div class="row"><input id="f" placeholder="بحث باسم الدواء" style="width:260px">
      <span class="muted">${low.length ? `<span class="badge bad">${low.length} تحت حد الطلب</span>` : ''}</span></div>
      <div class="row"><button class="btn primary" id="recv">تسجيل توريد</button><button class="btn" id="adj">تسوية جرد</button><button class="btn" id="newd">دواء جديد</button></div></div>
      <div class="tablewrap"><table><thead><tr><th>الدواء</th><th>الوحدة</th><th>الرصيد</th><th>حد الطلب</th></tr></thead><tbody id="tb"></tbody></table></div>`;
    const draw = () => {
      const t = N.arNorm(pane.querySelector('#f').value);
      pane.querySelector('#tb').innerHTML = bal.filter(b => N.arNorm(b.name).includes(t)).map(b =>
        `<tr><td>${esc(b.name)}</td><td>${esc(b.unit)}</td><td><b>${b.balance}</b> ${b.balance < 0 ? '<span class="badge bad">سالب</span>' : b.balance <= b.min_stock ? '<span class="badge wait">منخفض</span>' : ''}</td><td>${b.min_stock}</td></tr>`).join('');
    };
    pane.querySelector('#f').oninput = draw; draw();
    const opts = bal.map(b => `<option value="${b.id}">${esc(b.name)} — ${b.balance} ${esc(b.unit)}</option>`).join('');
    const move = (kind, title) => () => {
      const body = openModal(`<h2>${title}</h2><form id="mf" class="grid"><div style="grid-column:1/-1"><label>الدواء</label><select name="drug" required><option value="">اختر</option>${opts}</select></div>
        <div><label>${kind === 'adjust' ? 'الفرق (موجب للزيادة، سالب للنقص)' : 'الكمية'}</label><input name="qty" type="number" required ${kind === 'in' ? 'min="1"' : ''}></div>
        <div><label>التاريخ</label><input name="date" type="date" value="${N.todayISO()}" required></div>
        <div style="grid-column:1/-1"><label>ملاحظة ${kind === 'adjust' ? '(سبب التسوية)' : '(المورد / رقم الفاتورة)'}</label><input name="note"></div>
        <div style="grid-column:1/-1"><button class="btn primary">حفظ</button></div></form>`);
      body.querySelector('#mf').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target)); const qty = parseInt(f.qty);
        if (!qty) return toast('الكمية غير صالحة', 'bad');
        const { error } = await sb.from('stock_movements').insert({ drug_id: f.drug, kind, qty, movement_date: f.date, note: N.cleanText(f.note) || null, created_by: ctx.profile.id });
        if (error) return toast(errMsg(error), 'bad');
        toast('تم الحفظ'); closeModal(); stockPane();
      };
    };
    pane.querySelector('#recv').parentElement.append(exportBar(() => ({ title: 'مخزون الصيدلية', subtitle: 'تاريخ التصدير: ' + N.todayISO(), filename: 'مخزون-الصيدلية-' + N.todayISO(),
      sections: [{ heading: 'المخزون', columns: ['الدواء', 'الوحدة', 'الرصيد', 'حد الطلب'], rows: bal.map(b => [b.name, b.unit, b.balance, b.min_stock]) }] })));
    pane.querySelector('#recv').onclick = move('in', 'تسجيل توريد');
    pane.querySelector('#adj').onclick = move('adjust', 'تسوية جرد');
    pane.querySelector('#newd').onclick = () => {
      const body = openModal(`<h2>دواء جديد</h2><form id="df" class="grid"><div style="grid-column:1/-1"><label>الاسم التجاري *</label><input name="name" required></div>
        <div><label>وحدة العد</label><select name="unit">${['حبة', 'شريط', 'علبة', 'عبوة', 'أمبولة', 'تحميلة', 'أنبوب', 'أخرى'].map(u => `<option>${u}</option>`).join('')}</select></div>
        <div><label>حد الطلب (تنبيه عند الوصول إليه)</label><input name="min" type="number" min="0" value="0"></div>
        <div style="grid-column:1/-1"><button class="btn primary">حفظ</button></div></form>`);
      body.querySelector('#df').onsubmit = async e => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const { error } = await sb.from('drugs').insert({ name: N.cleanText(f.name), unit: f.unit, min_stock: parseInt(f.min) || 0 });
        if (error) return toast(error.code === '23505' ? 'هذا الدواء موجود مسبقاً' : errMsg(error), 'bad');
        await ctx.loadLookups(); toast('تمت الإضافة'); closeModal(); stockPane();
      };
    };
  }

  show();
  const t = setInterval(() => { if (tab === 'dispense') dispensePane(); }, 20000);
  ctx.cleanup = () => clearInterval(t);
}
