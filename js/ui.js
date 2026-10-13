export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = iso => (iso ? iso.split('-').reverse().join('/') : '');
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function toast(msg, kind = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}
export function openModal(html, { wide = false } = {}) {
  const d = document.getElementById('modal');
  const body = d.querySelector('.modal-body');
  body.innerHTML = html;
  d.classList.toggle('wide', wide);
  if (!d.open) d.showModal();
  return body;
}
export function closeModal() {
  const d = document.getElementById('modal');
  if (d.open) d.close();
}
export function errMsg(e) {
  if (!e) return '';
  if (e.code === '23505') return 'السجل موجود مسبقاً';
  if (e.code === '42501') return 'ليست لديك صلاحية لهذا الإجراء';
  return e.message || String(e);
}
export async function fetchAll(make, size = 1000) {
  let all = [], from = 0;
  for (;;) {
    const { data, error } = await make().range(from, from + size - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}
export const ROLES = { admin: 'مدير', reception: 'استقبال', doctor: 'طبيب', pharmacy: 'صيدلية' };
