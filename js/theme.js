// الهوية البصرية: الاسم، الشعار، اللون، الوضع الليلي، الحواف، حجم الخط
export const DEFAULTS = {
  site_name: 'مركز الأمل الطبي', tagline: '', logo_path: null, primary_color: '#0E5A57', radius: 'round',
  font_scale: 'normal', default_mode: 'light', phone: '', address: '', work_days: [0, 1, 2, 3, 4],
};
export const PRESETS = [['تركواز', '#0E5A57'], ['أزرق', '#1F4E8C'], ['بنفسجي', '#5B3E96'], ['أخضر', '#2F7D4F'], ['عنابي', '#8C2F3F'], ['رمادي', '#37474F'], ['برتقالي', '#B45309']];
export const MODE_LABEL = { light: 'فاتح', dark: 'ليلي', auto: 'تلقائي' };

export async function loadSettings(sb) {
  let s = { ...DEFAULTS };
  try {
    const { data } = await sb.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (data) s = { ...DEFAULTS, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) };
  } catch { /* الجدول غير موجود بعد: نستخدم الافتراضي */ }
  return withLogo(s, sb);
}
export function withLogo(s, sb) {
  s.logo_url = s.logo_path ? sb.storage.from('branding').getPublicUrl(s.logo_path).data.publicUrl : null;
  return s;
}

const hex2rgb = h => { h = h.replace('#', ''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgb2hex = a => '#' + a.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => { const B = hex2rgb(b); return rgb2hex(hex2rgb(a).map((v, i) => v * (1 - t) + B[i] * t)); };
const lum = h => { const [r, g, b] = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ink = bg => (lum(bg) > 0.4 ? '#142A2E' : '#FFFFFF');

let cur = DEFAULTS;
export const currentMode = s => localStorage.getItem('mode') || (s || cur).default_mode || 'light';
export function applyTheme(s) {
  cur = s;
  const root = document.documentElement, mode = currentMode(s);
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  const p = /^#[0-9a-f]{6}$/i.test(s.primary_color) ? s.primary_color : DEFAULTS.primary_color;
  const brand = dark ? mix(p, '#ffffff', 0.3) : p, side = dark ? mix(p, '#000000', 0.5) : p;
  const set = (k, v) => root.style.setProperty(k, v);
  set('--brand', brand); set('--brand-d', mix(brand, '#000000', 0.2)); set('--brand-ink', ink(brand));
  set('--side', side); set('--side-ink', ink(side));
  set('--r', { round: '8px', soft: '14px', square: '2px' }[s.radius] || '8px');
  root.style.fontSize = { small: '15px', normal: '16px', large: '18px' }[s.font_scale] || '16px';
  document.title = s.site_name || DEFAULTS.site_name;
  window.__brand = { name: s.site_name, tagline: s.tagline, phone: s.phone, address: s.address };
  let link = document.querySelector('link[rel=icon]');
  if (s.logo_url) { if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.append(link); } link.href = s.logo_url; }
  else if (link) link.remove();
}
export function setMode(m, s) { localStorage.setItem('mode', m); applyTheme(s || cur); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (currentMode() === 'auto') applyTheme(cur); });
