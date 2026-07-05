# context-seo.md — SEO, Performance & Analytics

Fonte de verdade do que **ainda falta** em SEO / performance / analytics do
Palpitae. A base (SEO on-page, performance, GA4 com Consent Mode, guias de
conteúdo, cross-linking, atribuição de CTA, 404 real, sitemap multi-URL) já está
implementada no código — este doc lista só o que sobra. Leia "Contexto",
"Decisões descartadas" e "Adiado por design" antes de mexer, para não re-propor o
que já foi rejeitado nem reabrir trabalho gated antes do gatilho.

## Contexto do projeto (o que importa aqui)

- **`web/`** é um SPA **Vite + React** (estático), servido pelo **Cloudflare Pages**.
  Ver `ADR-006`. Não há SSR.
- **Páginas públicas/indexáveis: `/` (landing) + `/guias/` e `/guias/<slug>/`**
  (HTML estático gerado no build, `web/build/guides.ts`). Todo o resto
  (`/grupos/:id`, dashboard) é **autenticado** e está em `Disallow:` no
  `web/public/robots.txt`. Crawlers não chegam nessas rotas.
- A API fica em **outro domínio** (`api.palpitae.com.br`); o boot chama
  `GET /auth/me` (`web/src/App.tsx`).
- Domínio de produção: `https://palpitae.com.br`.

---

## 🔜 O QUE FALTA FAZER

### A. Ativar e verificar o GA4 em produção *(ação do dono — sem código)*
- O ID já está no `web/.env.production`; **basta um deploy do Cloudflare Pages**.
- Verificar: abrir o site em prod, aceitar o banner, e confirmar a sessão em
  **GA4 → Relatórios → Tempo real** (aparece na hora; relatórios normais em ~24h).
- Se algum dia quiser desligar o GA: comentar/esvaziar `VITE_GA_MEASUREMENT_ID`
  (some script e banner automaticamente).

### B. Keyword research *(depende de tráfego acumular no Search Console)*
- Keywords a validar: "bolão copa 2026", "bolão copa do mundo online",
  "palpites copa 2026", "bolão online futebol".
- Quando o GSC tiver dados: **Search Console → Desempenho → Consultas** mostra o
  que as pessoas realmente buscam. Ajustar `meta description` (`index.html`) e a
  copy da `LandingPage` com base nisso. *(É código; pode me delegar.)*
- **Pivot da landing de "Copa 2026" → evergreen — recomendação de timing:** fazer
  **depois da Copa** (final ~meados de jul/2026), NÃO durante. A Copa está no ar
  agora, então "Copa 2026" está no pico de busca e o título atual
  (`Bolões de futebol para a Copa do Mundo 2026`) já é híbrido — contém o termo
  evergreen "bolões de futebol" + o sazonal. Tirar "Copa 2026" no meio do torneio
  joga fora tráfego de pico. Pós-Copa: generalizar (`Brasileirão, Libertadores e
  todos os campeonatos`) no `title`/`description`/JSON-LD do `index.html`.

### C. Bing Webmaster Tools *(ação do dono — sem código)*
- Submeter o mesmo `sitemap.xml` (cobre Bing + DuckDuckGo). Pode importar direto
  do Google Search Console.

### D. Link building *(ação do dono — sem código)*
- Postar em comunidades de futebol (Reddit r/futebol, GE.globo, grupos de
  WhatsApp) para backlinks naturais — maior fator de ranking após o conteúdo.

### F. Expandir as guias de conteúdo *(código — contínuo, guiado por dados)*
- A infra de guias já existe (`web/build/guides.ts`); adicionar guia = um item no
  array. Próximas guias devem ser **guiadas pelas consultas reais do Search
  Console** (item B) — escrever sobre o que as pessoas realmente buscam.
- **Medição ainda em aberto:** a *conversão* guia → login já é medida (evento
  `entrar_origem`). O que falta, se quiser: medir **pageviews/tempo nas próprias
  guias** — elas são HTML estático sem GA (sem JS, sem cookie banner). Por ora,
  tráfego das guias mede-se via **Search Console** (cliques/impressões por URL). Só
  instrumentar com GA nas estáticas se o volume justificar reabrir o tema LGPD.

### E. Dívida de a11y nas telas internas *(código — opcional, baixa prioridade)*
- O token global `--color-text-muted` (#555) falha contraste AA sobre o fundo
  escuro e é usado em ~13 arquivos de páginas **autenticadas** (não indexáveis,
  não auditadas). Não foi mexido para não arriscar regressão visual. Se for fazer
  um passe de a11y nas telas internas, revisar esse token em `variables.css`.

---

## ❌ Decisões descartadas — NÃO re-propor
- **Componente `<Seo>` runtime**: crawlers sociais não executam JS; a única página
  pública (`/`) já é coberta pelo `index.html` estático. Só valeria com várias
  páginas públicas distintas.
- **Middleware bot-aware "barato"** (sniff de UA + injetar meta): não entrega nada
  além da tag estática.

## ⏸️ Adiado por design — só fazer quando o gatilho existir
- **OG image dinâmica** (`@cloudflare/workers-og`/`satori`): quando existir convite
  compartilhável por grupo (ex.: "Pedro te convidou pro Grupo X").
- **Middleware bot-aware (OG por rota/grupo)**: mesmo gatilho do OG dinâmico.
- **Hreflang**: quando houver versão em inglês.
- **`<picture>` para OG/ícones**: manter PNG — crawlers sociais têm suporte
  irregular a WebP.
