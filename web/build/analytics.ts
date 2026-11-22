
import { PRIVACY_PATH } from './privacy'

const CONSENT_KEY = 'palpitae:analytics-consent'
const DENIED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

const GA_ID_RE = /^G-[A-Z0-9]+$/

/**
 * Normalizes the measurement id from the env: trims it and returns '' unless it
 * is a well-formed GA4 id, so only a safe value reaches the inline script.
 * A non-empty id that fails the check is reported through `warn` (the Vite
 * plugin passes `this.warn`), so a typo in the env doesn't silently drop GA.
 */
export function normalizeGaId(raw: string, warn: (msg: string) => void = console.warn): string {
  const id = raw.trim()
  if (id === '') return ''
  if (GA_ID_RE.test(id)) return id
  warn(
    `VITE_GA_MEASUREMENT_ID inválido (${JSON.stringify(id)}): GA e banner de cookies omitidos dos guias.`,
  )
  return ''
}

function validId(gaId: string): boolean {
  return GA_ID_RE.test(gaId)
}

/** Banner styles, mirroring components/CookieConsent with the app's tokens.
 *  O link da política de privacidade fica sublinhado para não depender da cor
 *  (auditoria `link-in-text-block` do Lighthouse). */
export const CONSENT_CSS = `
html{scroll-padding-bottom:var(--consent-banner-height,0px)}
body{padding-bottom:var(--consent-banner-height,0px)}
.consent{position:fixed;left:16px;right:16px;bottom:calc(8px + env(safe-area-inset-bottom, 0px));z-index:1000;display:flex;align-items:center;justify-content:space-between;gap:8px;max-width:720px;margin:0 auto;padding:12px;background:#252525;border:1px solid #2a2a2a;border-radius:12px;box-shadow:0 8px 24px rgb(0 0 0 / .5)}
.cookie-preferences{text-align:center;padding:16px}
#cookie-preferences{background:transparent;border:0;color:#a3a3a3;font:inherit;font-size:.875rem;text-decoration:underline;min-height:44px;cursor:pointer}
.consent[hidden]{display:none}
.consent p{margin:0;color:#a3a3a3;font-size:.875rem;line-height:1.5}
.consent p a{text-decoration:underline;text-underline-offset:3px}
.consent p a:focus-visible{outline:2px solid #49f21b;outline-offset:2px}
.consent .actions{display:flex;flex-shrink:0;gap:8px}
.consent button{min-height:44px;padding:8px 16px;border-radius:9999px;font:inherit;font-size:.875rem;font-weight:600;cursor:pointer}
.consent .reject{background:transparent;border:1px solid #2a2a2a;color:#a3a3a3}
.consent .reject:hover{background:#1a1a1a;color:#fff}
.consent .accept{background:#49f21b;border:1px solid #49f21b;color:#000}
.consent .accept:hover{background:#3dd617;border-color:#3dd617}
@media (max-width:560px){.consent{flex-direction:column;align-items:stretch;gap:8px}.consent .actions{justify-content:flex-end}}
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
var choice=stored();
window['ga-disable-'+ID]=choice==='denied';
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
if(choice)gtag('consent','update',{analytics_storage:choice});
function inject(){var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;document.head.appendChild(s)}
function idle(){if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(inject);else setTimeout(inject,0)}
gtag('js',new Date());
gtag('config',ID);
if(document.readyState==='complete')idle();else window.addEventListener('load',idle,{once:true});
function clearCookies(){var labels=location.hostname.split('.'),domains=[''];for(var i=0;i<labels.length;i++)domains.push(labels.slice(i).join('.'));['_ga','_ga_'+ID.slice(2)].forEach(function(name){domains.forEach(function(domain){document.cookie=name+'=; Max-Age=0; path=/'+(domain?'; domain='+domain:'')})})}
function save(c){var previous=choice;choice=c;window['ga-disable-'+ID]=c==='denied';try{localStorage.setItem(KEY,c==='denied'?'denied:'+Date.now():c)}catch(e){}gtag('consent','update',{analytics_storage:c});if(c==='denied'){clearCookies();if(previous==='granted'&&window.google_tag_manager&&stored()==='denied')location.reload()}}
function banner(){var b=document.getElementById('cookie-consent'),preferences=document.getElementById('cookie-preferences');if(!b||!preferences)return;
function height(){document.documentElement.style.setProperty('--consent-banner-height',Math.ceil(b.getBoundingClientRect().height+(parseFloat(getComputedStyle(b).bottom)||0))+'px')}
var observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(height);function show(){b.hidden=false;preferences.setAttribute('aria-expanded','true');height();if(observer)observer.observe(b);window.addEventListener('resize',height)}
preferences.addEventListener('click',function(){show();b.querySelector('.reject').focus()});
if(choice===null)show();
function dismiss(){b.hidden=true;preferences.setAttribute('aria-expanded','false');preferences.focus({preventScroll:true});if(observer)observer.disconnect();window.removeEventListener('resize',height);document.documentElement.style.removeProperty('--consent-banner-height')}
b.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();dismiss()}});
b.querySelector('.accept').addEventListener('click',function(){save('granted');dismiss()});
b.querySelector('.reject').addEventListener('click',function(){save('denied');dismiss()})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',banner);else banner();
})();`
  return `<script>${script}</script>`
}

/** Preferences button and banner markup; the banner opens with no stored choice or on the button click. */
export function consentBanner(gaId: string): string {
  if (!validId(gaId)) return ''
  return `<div class="cookie-preferences"><button id="cookie-preferences" type="button" aria-expanded="false">Preferências de cookies</button></div><div id="cookie-consent" class="consent" role="dialog" aria-label="Aviso de cookies" aria-live="polite" hidden><p>Cookies do Google Analytics medem o uso para melhorar o Palpitae. Você decide. Detalhes na <a href="${PRIVACY_PATH}">política de privacidade</a>.</p><div class="actions"><button type="button" class="reject">Recusar</button><button type="button" class="accept">Aceitar</button></div></div>`
}
