export type ThemeChoice = 'auto' | 'light' | 'dark';

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem('kontrollplan.theme');
    if (t === 'light' || t === 'dark' || t === 'auto') return t;
  } catch { /* ingen lagring */ }
  return 'auto';
}

export function writeTheme(choice: ThemeChoice) {
  if (choice === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  try { localStorage.setItem('kontrollplan.theme', choice); } catch { /* ignorer */ }
}
