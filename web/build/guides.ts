/**
 * Build-time generation of the public SEO "guides" pages.
 *
 * These are evergreen, top-of-funnel content pages (e.g. "what is a football
 * pool") rendered to PLAIN STATIC HTML at build time — no React, no client JS,
 * no auth gate. Crawlers don't execute JS (see context-seo.md / ADR-006), so
 * the only way a content page reliably indexes is as a real .html file. Each
 * guide is emitted at /guias/<slug>/index.html, plus an index at /guias/, and
 * every URL is added to sitemap.xml.
 *
 * On Cloudflare Pages static assets are served before the SPA fallback in
 * _redirects (`/* /index.html 200`), so these files win over the React app.
 */
import { execSync } from 'node:child_process'
import type { Connect, Plugin } from 'vite'

const SITE_URL = 'https://palpitae.com.br'
/** Where the CTAs send visitors: the login page (Google sign-in → create pool). */
const LOGIN_PATH = '/entrar'

/**
 * Login URL carrying a `from` token. The guide pages are JS-less static HTML, so
 * the CTA click itself can't be tracked — instead the SPA reads `?from=` when the
 * login page mounts and fires a GA event (see pages/LoginPage). This is how we
 * attribute "which guide drove someone to sign in".
 */
function loginHref(from: string): string {
  return `${LOGIN_PATH}?from=${from}`
}

export interface GuideSection {
  heading: string
  /** Paragraphs, rendered as <p>. Plain text — authored by us. */
  body: string[]
}

export interface Guide {
  /** URL slug; page is served at /guias/<slug>/. */
  slug: string
  /** Used for <title>, OG title and the <h1>. */
  title: string
  /** Inviting blurb shown on the /guias/ index cards (NOT the meta description). */
  teaser: string
  /** <meta name="description"> and OG description — kept SEO-clean. */
  description: string
  /** Lead paragraph shown under the <h1>. */
  intro: string
  sections: GuideSection[]
  /** ISO date (YYYY-MM-DD) for sitemap <lastmod> and Article dates. */
  updated: string
}

/**
 * The evergreen guide catalog. Topics are intentionally timeless (no "2026" in
 * the body) so they keep ranking across seasons and tournaments. Add new guides
 * here and they flow into the HTML output and the sitemap automatically.
 */
export const guides: Guide[] = [
  {
    slug: 'o-que-e-bolao-de-futebol',
    title: 'O que é bolão de futebol e como funciona',
    teaser:
      'Clique aqui e entenda o que é um bolão, como funciona a pontuação e por que apostar palpites com os amigos deixa qualquer campeonato muito mais divertido.',
    description:
      'Bolão de futebol é uma disputa de palpites entre amigos: cada um tenta acertar os placares dos jogos e ganha pontos. Entenda como funciona, as regras e como montar o seu.',
    intro:
      'Bolão de futebol é uma das formas mais divertidas de acompanhar um campeonato com os amigos. Em vez de só torcer, todo mundo arrisca os placares das partidas e disputa ponto a ponto quem entende mais de futebol. Veja o que é, como funciona a pontuação e como montar o seu.',
    sections: [
      {
        heading: 'O que é um bolão de futebol',
        body: [
          'Um bolão é uma competição paralela ao campeonato real. Antes de cada jogo, os participantes registram seus palpites, normalmente o placar exato ou apenas o resultado (vitória, empate ou derrota). Conforme as partidas acontecem, cada acerto vale pontos, e quem somar mais pontos ao fim do torneio vence o bolão.',
          'Dá para fazer bolão de praticamente qualquer competição: Copa do Mundo, Brasileirão, Libertadores, Champions League ou o campeonato estadual. A lógica é sempre a mesma, muda só o calendário de jogos.',
        ],
      },
      {
        heading: 'Como funciona a pontuação',
        body: [
          'As regras variam de grupo para grupo, mas o padrão mais comum dá mais pontos para o palpite de placar exato e menos pontos para quem acerta só o vencedor. Uma distribuição típica é 3 pontos por cravar o placar e 1 ponto por acertar apenas o resultado.',
          'Em torneios de mata-mata, alguns grupos dão mais pontos nas fases finais, já que os jogos ficam mais difíceis e decisivos. Vale combinar isso com o grupo antes de começar.',
        ],
      },
      {
        heading: 'Bolão online ou no papel?',
        body: [
          'Por muito tempo os bolões eram feitos em planilhas ou cadernos, com alguém somando os pontos na mão. Funciona, mas dá trabalho: é fácil errar a conta, perder um palpite e gerar discussão sobre quem pontuou o quê.',
          'Um bolão online resolve isso. Os palpites ficam registrados, a pontuação é calculada automaticamente a cada resultado e a classificação atualiza sozinha. Todo mundo acompanha pelo celular, sem planilha e sem dor de cabeça.',
        ],
      },
      {
        heading: 'Como começar o seu bolão',
        body: [
          'Para montar um bolão você precisa de três coisas: um grupo de amigos, um campeonato para acompanhar e um jeito de registrar os palpites e somar os pontos.',
          'No Palpitae é gratuito. Você cria um grupo privado, convida a galera por um link e cada um dá seus palpites rodada a rodada. A pontuação e a classificação são automáticas.',
        ],
      },
    ],
    updated: '2026-06-20',
  },
  {
    slug: 'como-organizar-um-bolao',
    title: 'Como organizar um bolão com amigos (passo a passo)',
    teaser:
      'Clique aqui e veja o passo a passo para montar um bolão: escolher o campeonato, combinar as regras, chamar a galera e acompanhar a classificação sem dor de cabeça.',
    description:
      'Quer montar um bolão da rodada ou do campeonato? Veja o passo a passo para organizar um bolão com os amigos: escolher o campeonato, definir as regras, convidar a galera e somar os pontos.',
    intro:
      'Organizar um bolão é simples, mas alguns cuidados no começo evitam confusão lá na frente, principalmente na hora de definir regras e somar pontos. Veja um passo a passo para montar o seu bolão com os amigos.',
    sections: [
      {
        heading: 'Escolha o campeonato',
        body: [
          'O primeiro passo é decidir qual competição o bolão vai acompanhar: Copa do Mundo, Brasileirão, Libertadores, Champions ou o estadual. Campeonatos longos rendem uma disputa que dura a temporada inteira. Torneios curtos, como uma Copa, são ótimos para quem quer emoção concentrada em poucas semanas.',
          'Vale alinhar desde já se o bolão cobre todos os jogos ou só uma fase específica, como apenas o mata-mata de uma Copa.',
        ],
      },
      {
        heading: 'Defina as regras de pontuação',
        body: [
          'Combine antes como cada acerto vale. O modelo mais comum dá mais pontos pelo placar exato e menos por acertar só o resultado. Deixe claro também como ficam os casos especiais: prorrogação, pênaltis e jogos adiados.',
          'Regras simples e escritas evitam a discussão clássica de fim de campeonato sobre quem pontuou o quê. Se usar uma plataforma online, a pontuação já vem definida e calculada automaticamente.',
        ],
      },
      {
        heading: 'Convide os amigos',
        body: [
          'Um bolão fica bom com gente o suficiente para criar rivalidade. Chame os amigos por um grupo de WhatsApp, defina um prazo para todo mundo entrar e comece junto com a primeira rodada.',
          'No Palpitae você cria um grupo privado e convida a galera por um link ou código. Cada um entra com a conta Google e já começa a palpitar.',
        ],
      },
      {
        heading: 'Acompanhe a classificação',
        body: [
          'Durante o campeonato, a graça é acompanhar a tabela a cada rodada e provocar quem está atrás. Se a soma de pontos for manual, reserve um tempo após cada rodada para atualizar tudo.',
          'Com um bolão online isso é automático. A cada resultado a pontuação e a classificação se atualizam sozinhas, e todo mundo vê quem está na frente em tempo real.',
        ],
      },
    ],
    updated: '2026-06-20',
  },
  {
    slug: 'regras-e-pontuacao-de-bolao',
    title: 'Regras e sistema de pontuação de um bolão',
    teaser:
      'Clique aqui e descubra os sistemas de pontuação mais usados nos bolões, do placar exato aos casos de pênaltis, e como escolher as regras ideais para o seu grupo.',
    description:
      'Como pontuar um bolão de futebol? Veja os sistemas de pontuação mais usados, do placar exato ao acerto do resultado, e como escolher as regras do seu grupo.',
    intro:
      'Não existe uma regra oficial de bolão, cada grupo define a sua. Mas alguns sistemas de pontuação são clássicos porque equilibram sorte e conhecimento. Veja os mais usados para escolher o do seu grupo.',
    sections: [
      {
        heading: 'Placar exato ou acerto do resultado',
        body: [
          'O sistema mais comum separa dois tipos de acerto. Cravar o placar exato (por exemplo, 2 a 1) vale mais pontos, e acertar só o resultado, quem venceu ou empate, vale menos.',
          'Esse modelo premia quem arrisca um placar certeiro, mas ainda dá chance a quem só sentiu o vencedor. Uma distribuição típica é 3 pontos para o placar exato e 1 ponto para o resultado (o Palpitae é assim).',
        ],
      },
      {
        heading: 'Pontos por fase no mata-mata',
        body: [
          'Em torneios de mata-mata, alguns grupos dão mais pontos conforme as fases avançam, já que os jogos ficam mais difíceis e decisivos. Assim, acertar a final pode valer mais do que acertar um jogo da primeira fase.',
          'É um ajuste opcional. Se o seu grupo prefere algo mais simples, manter a mesma pontuação em todas as fases funciona bem e é mais fácil de acompanhar.',
        ],
      },
      {
        heading: 'Casos especiais: prorrogação e pênaltis',
        body: [
          'Defina antes se o palpite vale pelo placar do tempo normal ou incluindo a prorrogação. O mais comum é considerar os 90 minutos para o placar e, no mata-mata, usar quem se classificou para a fase seguinte.',
          'Combinar isso no início evita discussão quando um jogo for decidido nos pênaltis.',
        ],
      },
      {
        heading: 'Escolha as regras do seu grupo',
        body: [
          'Não há certo ou errado. O melhor sistema é o que o seu grupo achar mais divertido. Grupos competitivos costumam valorizar o placar exato, enquanto grupos casuais preferem regras simples, só de resultado.',
          'Se quiser pular essa parte, uma plataforma de bolão já vem com um sistema de pontuação pronto e calcula tudo automaticamente. É só palpitar.',
        ],
      },
    ],
    updated: '2026-06-20',
  },
]

/** Public path for a guide (with trailing slash, as served). */
export function guidePath(slug: string): string {
  return `/guias/${slug}/`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Shared <style> for every guide page — mirrors the app's dark design tokens. */
const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{background:#0d0d0d;font-size:16px;-webkit-text-size-adjust:100%}
body{background:#0d0d0d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
a{color:#49f21b;text-decoration:none}
a:hover{text-decoration:underline}
img{display:block;max-width:100%}
.wrap{max-width:720px;margin:0 auto;padding:0 20px 64px}
header.site{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid #2a2a2a}
header.site .brand img{height:24px;width:auto;opacity:.9}
header.site .navcta{color:#a3a3a3;font-size:.9375rem}
header.site .navcta:hover{color:#49f21b;text-decoration:none}
nav.crumbs{font-size:.875rem;color:#a3a3a3;padding:20px 0 8px}
nav.crumbs a{color:#a3a3a3}
h1{font-size:1.875rem;line-height:1.25;margin:12px 0 16px}
h2{font-size:1.25rem;line-height:1.3;margin:36px 0 12px}
p{margin:0 0 16px}
.intro{color:#a3a3a3;font-size:1.125rem}
.cta{margin:44px 0 8px;padding:24px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;text-align:center}
.cta a.btn{display:inline-block;margin-top:12px;padding:12px 24px;background:#49f21b;color:#000;font-weight:600;border-radius:9999px}
.cta a.btn:hover{background:#3dd617;text-decoration:none}
footer.site{margin-top:48px;padding-top:24px;border-top:1px solid #2a2a2a;color:#a3a3a3;font-size:.875rem}
ul.guides{list-style:none;display:flex;flex-direction:column;gap:16px;margin-top:12px}
a.card{display:block;padding:20px 22px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;transition:border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease}
a.card:hover{border-color:#49f21b;box-shadow:0 0 24px rgb(73 242 27 / .12);transform:translateY(-2px);text-decoration:none}
a.card:focus-visible{outline:2px solid #49f21b;outline-offset:2px}
a.card .card-title{display:block;color:#fff;font-size:1.125rem;font-weight:600}
a.card .card-teaser{display:block;color:#a3a3a3;font-size:1rem;line-height:1.55;margin-top:6px}
a.card .card-go{display:inline-block;color:#49f21b;font-size:.9375rem;font-weight:600;margin-top:14px}
nav.related{margin:44px 0 8px;padding-top:8px;border-top:1px solid #2a2a2a}
nav.related h2{font-size:1.125rem;margin:24px 0 12px}
nav.related ul{list-style:none;display:flex;flex-direction:column;gap:10px}
nav.related a{color:#49f21b;font-weight:500}
@media (prefers-reduced-motion:reduce){a.card{transition:none}a.card:hover{transform:none}}
`.trim()

/** Shared <head> tags for a page given its canonical path, title, description. */
function head(path: string, title: string, description: string, jsonLd: object[]): string {
  const canonical = `${SITE_URL}${path}`
  const ld = jsonLd
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join('\n    ')
  return `    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} — Palpitae</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Palpitae" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:locale" content="pt_BR" />
    <meta property="og:image" content="${SITE_URL}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="theme-color" content="#0d0d0d" />
    <style>${PAGE_CSS}</style>
    ${ld}`
}

/** Shared top bar; `from` flows into the "Criar bolão" CTA for attribution. */
function siteHeader(from: string): string {
  return `<header class="site"><a class="brand" href="/" aria-label="Ir para a página inicial"><img src="/logo-text.svg" alt="Palpitae" width="94" height="24" /></a><a class="navcta" href="${loginHref(from)}">Criar bolão</a></header>`
}
const SITE_FOOTER = `<footer class="site">Palpitae — bolões de futebol online e gratuitos. <a href="/">Voltar ao início</a></footer>`

const breadcrumb = (path: string, name: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
    { '@type': 'ListItem', position: 2, name: 'Guias', item: `${SITE_URL}/guias/` },
    { '@type': 'ListItem', position: 3, name, item: `${SITE_URL}${path}` },
  ],
})

/** Render one guide to a complete static HTML document. */
export function renderGuide(g: Guide): string {
  const path = guidePath(g.slug)
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.description,
    inLanguage: 'pt-BR',
    datePublished: g.updated,
    dateModified: g.updated,
    mainEntityOfPage: `${SITE_URL}${path}`,
    author: { '@type': 'Organization', name: 'Palpitae' },
    publisher: {
      '@type': 'Organization',
      name: 'Palpitae',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/apple-touch-icon.png` },
    },
  }
  const sections = g.sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.heading)}</h2>\n${s.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}`,
    )
    .join('\n')
  // Contextual internal links to the sibling guides — strengthens the topic
  // cluster for SEO and keeps the other pages from being orphaned.
  const related = guides.filter((o) => o.slug !== g.slug)
  const relatedHtml = related.length
    ? `<nav class="related" aria-label="Guias relacionados"><h2>Continue lendo</h2><ul>${related
        .map((o) => `<li><a href="${guidePath(o.slug)}">${escapeHtml(o.title)}</a></li>`)
        .join('')}</ul></nav>`
    : ''
  return `<!doctype html>
<html lang="pt-BR">
  <head>
${head(path, g.title, g.description, [breadcrumb(path, g.title), article])}
  </head>
  <body>
    <div class="wrap">
      ${siteHeader(`guia_${g.slug}_header`)}
      <nav class="crumbs"><a href="/">Início</a> › <a href="/guias/">Guias</a> › ${escapeHtml(g.title)}</nav>
      <article>
        <h1>${escapeHtml(g.title)}</h1>
        <p class="intro">${escapeHtml(g.intro)}</p>
        ${sections}
      </article>
      <div class="cta">
        <strong>Pronto para começar?</strong>
        <p>Crie um bolão grátis e convide seus amigos em segundos.</p>
        <a class="btn" href="${loginHref(`guia_${g.slug}`)}">Criar meu bolão grátis</a>
      </div>
      ${relatedHtml}
      ${SITE_FOOTER}
    </div>
  </body>
</html>
`
}

/** Render the /guias/ index that lists every guide. */
export function renderIndex(): string {
  const path = '/guias/'
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Guias', item: `${SITE_URL}/guias/` },
      ],
    },
  ]
  const items = guides
    .map(
      (g) =>
        `<li><a class="card" href="${guidePath(g.slug)}"><span class="card-title">${escapeHtml(g.title)}</span><span class="card-teaser">${escapeHtml(g.teaser)}</span><span class="card-go">Ler guia →</span></a></li>`,
    )
    .join('\n        ')
  return `<!doctype html>
<html lang="pt-BR">
  <head>
${head(path, 'Guias de bolão de futebol', 'Guias e dicas para organizar e disputar bolões de futebol com os amigos: como funciona, regras de pontuação e como começar.', jsonLd)}
  </head>
  <body>
    <div class="wrap">
      ${siteHeader('guias_header')}
      <nav class="crumbs"><a href="/">Início</a> › Guias</nav>
      <h1>Guias de bolão de futebol</h1>
      <p class="intro">Tudo o que você precisa para organizar e disputar bolões com os amigos.</p>
      <ul class="guides">
        ${items}
      </ul>
      ${SITE_FOOTER}
    </div>
  </body>
</html>
`
}

/**
 * Render the static 404 page. Cloudflare Pages serves /404.html (with a real 404
 * status) for any URL not matched by a static asset or a _redirects rule. It's
 * `noindex` so a crawler that lands on a stale link doesn't index an error page.
 */
export function render404(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Página não encontrada — Palpitae</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#0d0d0d" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <div class="wrap">
      ${siteHeader('404_header')}
      <article style="padding:56px 0 0">
        <h1>Página não encontrada</h1>
        <p class="intro">A página que você procura não existe ou foi movida.</p>
        <p><a href="/">← Voltar ao início</a> &nbsp;·&nbsp; <a href="/guias/">Ver os guias</a></p>
      </article>
      ${SITE_FOOTER}
    </div>
  </body>
</html>
`
}

/** Resolve a request path to a guide page's HTML, or null if it's not a guide. */
function guideHtmlFor(reqUrl: string): string | null {
  const path = (reqUrl.split('?')[0] || '').replace(/\/+$/, '') // strip query + trailing /
  if (path === '/guias') return renderIndex()
  const g = guides.find((g) => `/guias/${g.slug}` === path)
  return g ? renderGuide(g) : null
}

/**
 * Vite plugin: serve the guide pages during dev/preview AND emit them as static
 * files at build time.
 *
 * The dev/preview middleware matters: without it the Vite SPA fallback serves
 * index.html for /guias/*, the React router has no such route, and the visitor
 * lands on the login page. The middleware makes dev behave like production
 * (Cloudflare Pages serves the static /guias/<slug>/index.html files directly).
 */
export function guidesPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const html = guideHtmlFor(req.originalUrl ?? '')
    if (html === null) return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  }
  return {
    name: 'palpitae-guides',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'guias/index.html',
        source: renderIndex(),
      })
      for (const g of guides) {
        this.emitFile({
          type: 'asset',
          fileName: `guias/${g.slug}/index.html`,
          source: renderGuide(g),
        })
      }
      // Static 404 page served by Cloudflare Pages for unmatched URLs.
      this.emitFile({ type: 'asset', fileName: '404.html', source: render404() })
    },
  }
}

/**
 * Last commit date (YYYY-MM-DD) touching any of `paths`, for a truthful sitemap
 * <lastmod>. Uses git so it reflects real content changes instead of the build
 * date. Falls back to `fallback` when git history is unavailable (e.g. a shallow
 * CI checkout or an untracked path), so the build never breaks.
 */
function gitLastModified(paths: string[], fallback: string): string {
  let latest = ''
  for (const p of paths) {
    try {
      const out = execSync(`git log -1 --format=%cs -- ${p}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim()
      if (out && out > latest) latest = out // ISO dates sort lexicographically
    } catch {
      // git missing or path untracked — skip; fallback applies below
    }
  }
  return latest || fallback
}

/** All indexable public URLs, with lastmod, for the sitemap. */
export function sitemapUrls(): { loc: string; lastmod: string; priority: string }[] {
  const fallback = new Date().toISOString().slice(0, 10)
  return [
    {
      loc: `${SITE_URL}/`,
      // Landing markup lives in index.html + the LandingPage component.
      lastmod: gitLastModified(['index.html', 'src/pages/LandingPage'], fallback),
      priority: '1.0',
    },
    {
      loc: `${SITE_URL}/guias/`,
      // The index is generated from the guide catalog in this file.
      lastmod: gitLastModified(['build/guides.ts'], fallback),
      priority: '0.6',
    },
    // Per-guide dates stay manual (`updated`): granular and truthful — bump it
    // when you edit a guide's content.
    ...guides.map((g) => ({
      loc: `${SITE_URL}${guidePath(g.slug)}`,
      lastmod: g.updated,
      priority: '0.7',
    })),
  ]
}

/** Vite plugin: emit sitemap.xml covering the landing + every guide. */
export function sitemapPlugin(): Plugin {
  return {
    name: 'palpitae-sitemap',
    apply: 'build',
    generateBundle() {
      const urls = sitemapUrls()
        .map(
          (u) =>
            `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
        )
        .join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}
