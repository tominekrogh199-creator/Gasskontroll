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

const SW_RELOAD = 'kontrollplan.sw-reload';

function reloadOnce() {
  try {
    if (sessionStorage.getItem(SW_RELOAD) === '1') return;
    sessionStorage.setItem(SW_RELOAD, '1');
  } catch {
    /* uten lagring laster vi likevel én gang fra denne siden */
  }
  location.reload();
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloading = false;
  const once = () => {
    if (reloading) return;
    reloading = true;
    reloadOnce();
  };
  navigator.serviceWorker.addEventListener('controllerchange', once);
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'RELOAD') once();
  });
  const track = () => {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {
        /* nettleseren uten worker, appen virker fortsatt */
      });
  };
  window.addEventListener('load', track);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') track();
  });
}
