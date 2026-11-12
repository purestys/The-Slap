const KEY = 'theclick-theme';

export const currentTheme = () => document.documentElement.dataset.theme;

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* armazenamento bloqueado */ }
  const prefersLight = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = saved || (prefersLight ? 'light' : 'dark');
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignora */ }
  return next;
}
