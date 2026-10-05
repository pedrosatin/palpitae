/**
 * GA4 + Consent Mode v2 for the static /guias/* pages.
 *
 * The guides are plain HTML without the React bundle, so they can't call
 * `initGa()` (src/analytics/ga.ts) or mount `CookieConsent`. This module emits a
 * small inline equivalent that must stay in sync with those two files:
 *
 * - same localStorage key and value format (`granted` / `denied:<timestamp>`,
 *   with the 30-day re-prompt for `denied` and the legacy plain `denied`);
 * - `consent default` (all denied) is pushed before `js`/`config`, so no hit
 *   leaves the page without the default registered first;
 * - a stored `granted` is restored right after the default;
 * - gtag.js is injected after `load`, on idle, like the app;
 * - the banner only shows when there's no stored choice.
 *
 * With an empty measurement id nothing is emitted (no script, no banner), same
 * as the app in local dev.
 */

const CONSENT_KEY = 'palpitae:analytics-consent'
const DENIED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

/** Only a well-formed GA4 id is embedded in the inline script. */
function validId(gaId: string): boolean {
  return /^G-[A-Z0-9]+$/.test(gaId)
}

/** Banner styles, mirroring components/CookieConsent with the app's tokens. */
export const CONSENT_CSS = `
.consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:1000;display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:720px;margin:0 auto;padding:16px 20px;background:#252525;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 8px 24px rgb(0 0 0 / .5)}
.consent[hidden]{display:none}
.consent p{margin:0;color:#a3a3a3;font-size:.875rem;line-height:1.5}
.consent .actions{display:flex;flex-shrink:0;gap:8px}
.consent button{padding:8px 16px;border-radius:9999px;font:inherit;font-size:.875rem;font-weight:600;cursor:pointer}
.consent .reject{background:transparent;border:1px solid #2a2a2a;color:#a3a3a3}
.consent .reject:hover{background:#1a1a1a;color:#fff}
.consent .accept{background:#49f21b;border:1px solid #49f21b;color:#000}
.consent .accept:hover{background:#3dd617;border-color:#3dd617}
@media (max-width:560px){.consent{flex-direction:column;align-items:stretch;gap:12px}.consent .actions{justify-content:flex-end}}
`.trim()

/**
 * Inline <script> for the <head>. Runs before the body is parsed, so the
 * consent default is the first thing in dataLayer. It also wires the banner
 * once the DOM is ready.
 */
export function analyticsHead(gaId: string): string {
  if (!validId(gaId)) return ''
  const script = `(function(){
var ID='${gaId}',KEY='${CONSENT_KEY}';
function stored(){try{var v=localStorage.getItem(KEY);if(v==='granted')return'granted';if(v&&v.indexOf('denied')===0){var p=v.split(':');if(p.length===2){if(Date.now()-parseInt(p[1],10)<${DENIED_EXPIRY_MS})return'denied';localStorage.removeItem(KEY);return null}return'denied'}return null}catch(e){return null}}
window.dataLayer=window.dataLayer||[];
window.gtag=function(){window.dataLayer.push(arguments)};
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
var choice=stored();
if(choice==='granted')gtag('consent','update',{analytics_storage:'granted'});
gtag('js',new Date());
gtag('config',ID);
function inject(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;document.head.appendChild(s)}
function idle(){if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(inject);else setTimeout(inject,0)}
if(document.readyState==='complete')idle();else window.addEventListener('load',idle,{once:true});
function save(c){try{localStorage.setItem(KEY,c==='denied'?'denied:'+Date.now():c)}catch(e){}gtag('consent','update',{analytics_storage:c})}
function banner(){var b=document.getElementById('cookie-consent');if(!b||choice!==null)return;b.hidden=false;
b.querySelector('.accept').addEventListener('click',function(){save('granted');b.hidden=true});
b.querySelector('.reject').addEventListener('click',function(){save('denied');b.hidden=true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',banner);else banner();
})();`
  return `<script>${script}</script>`
}

/** Banner markup, hidden until the head script finds no stored choice. */
export function consentBanner(gaId: string): string {
  if (!validId(gaId)) return ''
  return `<div id="cookie-consent" class="consent" role="dialog" aria-label="Aviso de cookies" aria-live="polite" hidden><p>Usamos cookies do Google Analytics para entender como o site é usado e melhorar o Palpitae. Você decide.</p><div class="actions"><button type="button" class="reject">Recusar</button><button type="button" class="accept">Aceitar</button></div></div>`
}
