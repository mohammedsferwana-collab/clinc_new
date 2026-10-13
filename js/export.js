// تصدير موحد إلى Excel وWord وPDF.
// شكل البيانات: { title, subtitle, filename, sections: [{ heading, columns: [...], rows: [[...]] }] }
import { esc, toast, errMsg } from './ui.js';

const STYLE = `<style>
 body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;direction:rtl;color:#000}
 h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px}p{margin:0 0 8px;color:#444}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th,td{border:1px solid #888;padding:4px 6px;text-align:right;vertical-align:top}
 th{background:#e4eeed}tr{page-break-inside:avoid}
</style>`;

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
const head = () => { const b = window.__brand || {}; const l2 = [b.address, b.phone].filter(Boolean).map(esc).join(' • ');
  return `<div style="border-bottom:2px solid #000;margin-bottom:10px;padding-bottom:4px"><b style="font-size:17px">${esc(b.name || '')}</b>${b.tagline ? ' — ' + esc(b.tagline) : ''}${l2 ? `<br><span style="font-size:12px">${l2}</span>` : ''}</div>`; };
const body = d => head() + `<h1>${esc(d.title)}</h1>${d.subtitle ? `<p>${esc(d.subtitle)}</p>` : ''}` +
  d.sections.map(s => `<h2>${esc(s.heading)}</h2><table><thead><tr>${s.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    s.rows.length ? s.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${s.columns.length}">لا توجد بيانات</td></tr>`}</tbody></table>`).join('');

export function toXlsx(d) {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const used = new Set();
  d.sections.forEach((s, i) => {
    const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows]);
    ws['!cols'] = s.columns.map((c, j) => ({ wch: Math.min(45, Math.max(String(c).length, ...s.rows.slice(0, 300).map(r => String(r[j] ?? '').length)) + 2) }));
    let n = String(s.heading || 'ورقة ' + (i + 1)).replace(/[\\/:*?"<>|\[\]]/g, ' ').slice(0, 28).trim() || 'ورقة';
    while (used.has(n)) n += '_';
    used.add(n);
    XLSX.utils.book_append_sheet(wb, ws, n);
  });
  XLSX.writeFile(wb, d.filename + '.xlsx');
}

export function toWord(d) {
  const html = `\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" dir="rtl"><head><meta charset="utf-8">${STYLE}</head><body dir="rtl">${body(d)}</body></html>`;
  download(new Blob([html], { type: 'application/msword' }), d.filename + '.doc');
}

export async function toPdf(d) {
  const wide = d.sections.some(s => s.columns.length > 6);
  if (!window.html2pdf) return printFallback(d);
  const el = document.createElement('div');
  el.dir = 'rtl';
  el.style.cssText = `position:absolute;left:0;top:0;z-index:-1;background:#fff;padding:14px;width:${wide ? 1080 : 740}px`;
  el.innerHTML = STYLE + body(d);
  document.body.append(el);
  try {
    await window.html2pdf().set({
      margin: 8, filename: d.filename + '.pdf', image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: wide ? 'landscape' : 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'h2'] },
    }).from(el).save();
  } finally { el.remove(); }
}
function printFallback(d) {
  const w = window.open('', '_blank');
  if (!w) return toast('اسمح بالنوافذ المنبثقة ثم أعد المحاولة', 'bad');
  w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>${esc(d.title)}</title>${STYLE}</head><body>${body(d)}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}

// شريط أزرار التصدير؛ getData قد تكون async وتُستدعى عند الضغط فقط
export function exportBar(getData) {
  const wrap = document.createElement('span');
  wrap.className = 'row noprint';
  wrap.style.gap = '.35rem';
  wrap.innerHTML = '<span class="muted small">تصدير:</span><button class="btn sm" data-f="xlsx">Excel</button><button class="btn sm" data-f="doc">Word</button><button class="btn sm" data-f="pdf">PDF</button>';
  wrap.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    b.disabled = true;
    try {
      const d = await getData();
      if (!d) return;
      if (b.dataset.f === 'xlsx') toXlsx(d); else if (b.dataset.f === 'doc') toWord(d); else await toPdf(d);
    } catch (err) { console.error(err); toast(errMsg(err), 'bad'); } finally { b.disabled = false; }
  };
  return wrap;
}
