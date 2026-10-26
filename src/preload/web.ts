// Preload for every web page tab (isolated world). Kept tiny for memory: password save/fill only.
import { ipcRenderer } from 'electron';

function findForm(pw: HTMLInputElement) {
  const form = pw.form || pw.closest('form') || document.body;
  const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
  const idx = inputs.indexOf(pw);
  const user = inputs.slice(0, idx).reverse().find((i) => /^(text|email|tel)$/i.test(i.type) && i.offsetParent !== null)
    || (document.querySelector('input[autocomplete="username"], input[type=email]') as HTMLInputElement | null);
  return { form, user };
}

let lastSent = '';
function capture() {
  const pw = Array.from(document.querySelectorAll('input[type=password]')).find((i: any) => i.value) as HTMLInputElement | undefined;
  if (!pw) return;
  const { user } = findForm(pw);
  const username = user?.value || '';
  const key = location.origin + '|' + username + '|' + pw.value.length;
  if (key === lastSent) return;
  lastSent = key;
  ipcRenderer.send('owl-web:password', { origin: location.origin, username, password: pw.value });
}

window.addEventListener('submit', () => capture(), true);
window.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' && (e.target as HTMLElement)?.tagName === 'INPUT') setTimeout(capture, 0); }, true);
window.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement)?.closest?.('button, input[type=submit], [role=button]');
  if (b) setTimeout(capture, 0);
}, true);

async function autofill() {
  const pw = document.querySelector('input[type=password]') as HTMLInputElement | null;
  if (!pw || pw.value) return;
  const cred = await ipcRenderer.invoke('owl-web:credentials', location.origin).catch(() => null);
  if (!cred) return;
  const { user } = findForm(pw);
  const set = (el: HTMLInputElement, v: string) => {
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    proto?.set?.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (user && cred.username && !user.value) set(user, cred.username);
  set(pw, cred.password);
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(autofill, 400);
  const mo = new MutationObserver(() => { if (document.querySelector('input[type=password]')) { mo.disconnect(); setTimeout(autofill, 200); } });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 15000);
});
