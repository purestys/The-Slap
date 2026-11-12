// The Slap usa somente o tema claro.
export const currentTheme = () => 'light';
export function initTheme() { document.documentElement.dataset.theme = 'light'; }
export function toggleTheme() { document.documentElement.dataset.theme = 'light'; return 'light'; }

