import { render } from 'preact';
import './styles.css';
import { App } from './ui/App';

try {
  const t = localStorage.getItem('kontrollplan.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch {
  /* ingen lagring */
}

render(<App />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' }).catch(() => {
      /* nettleseren uten worker, appen virker fortsatt */
    });
  });
}
