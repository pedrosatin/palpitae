import { Link } from 'react-router-dom'
import GoogleLoginButton from '../../components/GoogleLoginButton'
import { trackEvent } from '../../analytics/ga'
import styles from './LandingPage.module.css'

/**
 * Public landing page — the marketing/preview face of Palpitae shown to
 * unauthenticated visitors who want to know what to expect before logging in.
 *
 * It showcases the product's three core screens (groups dashboard, round
 * predictions, knockout bracket) with real screenshots, and funnels visitors
 * to the Google login. No authenticated data is fetched here.
 *
 * Screenshots live in /public/screenshots/ and are served statically.
 */
export default function LandingPage() {
  return (
    <div className={styles.root}>
      <Header />
      <main>
        <Hero />
        <Features />
        <Scoring />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}

/* ─── Page Sections ────────────────────────────────────────────────────── */

function Header() {
  return (
    <header className={styles.nav}>
      <Link to="/" className={styles.brand} onClick={() => trackEvent('click_landing_brand')}>
        <img
          src="/logo-text.svg"
          alt="Palpitae"
          width={110}
          height={28}
          className={styles.brandLogo}
        />
      </Link>
      <nav className={styles.navLinks}>
        <a
          href="#recursos"
          className={styles.navLink}
          onClick={() => trackEvent('click_nav_recursos')}
        >
          Recursos
        </a>
        <a
          href="#pontuacao"
          className={styles.navLink}
          onClick={() => trackEvent('click_nav_pontuacao')}
        >
          Pontuação
        </a>
        <a href="#faq" className={styles.navLink} onClick={() => trackEvent('click_nav_faq')}>
          Dúvidas
        </a>
        <Link to="/entrar" className={styles.navCta} onClick={() => trackEvent('click_nav_entrar')}>
          Entrar
        </Link>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>Brasileirão Série A 2026</span>
        <h1 className={styles.heroTitle}>
          Bolões de futebol <span className={styles.accent}>com seus amigos</span>
        </h1>
        <p className={styles.heroSubtitle}>
          Crie grupos privados, dê seus palpites rodada a rodada e dispute o topo da classificação.
          Tudo em um só lugar.
        </p>
        <div className={styles.heroActions}>
          <GoogleLoginButton />
          <a
            href="#recursos"
            className={styles.secondaryAction}
            onClick={() => trackEvent('click_hero_ver_como_funciona')}
          >
            Ver como funciona ↓
          </a>
        </div>
      </div>

      <BrowserFrame className={styles.heroShot}>
        <Shot
          src="/screenshots/grupos.png"
          alt="Tela de grupos do Palpitae mostrando os bolões do usuário"
          width={1100}
          height={590}
          loading="eager"
          fetchPriority="high"
        />
      </BrowserFrame>
    </section>
  )
}

function Features() {
  return (
    <section id="recursos" className={styles.features}>
      <FeatureRow
        tag="Grupos"
        title="Crie ou entre em grupos privados"
        description="Monte um bolão com a galera em segundos. Compartilhe um código ou link de convite e acompanhe membros, sua posição e seus pontos de cada grupo."
        shot="/screenshots/grupos.png"
        shotAlt="Lista de grupos com membros, posição e pontos"
        shotWidth={1100}
        shotHeight={590}
      />
      <FeatureRow
        reversed
        tag="Palpites"
        title="Dê seus palpites rodada a rodada"
        description="Cravou o placar? Ajuste os números de cada jogo e salve um por um — ou de uma vez com 'Salvar todos'. Navegue entre as rodadas e palpite com antecedência."
        shot="/screenshots/palpites.png"
        shotAlt="Tela de previsões com cards de jogos e seletores de placar"
        shotWidth={1100}
        shotHeight={712}
      />
    </section>
  )
}

function Scoring() {
  return (
    <section id="pontuacao" className={styles.scoring}>
      <h2 className={styles.sectionTitle}>Cravou o placar, leva mais</h2>
      <p className={styles.sectionLead}>
        Cada jogo vale pontos conforme o quanto você chegou perto do resultado real.
      </p>
      <ul className={styles.scoringGrid}>
        <ScoringCard
          points="3"
          title="Placar exato"
          description="Você acertou os gols dos dois times, como em um 2 a 1 cravado."
        />
        <ScoringCard
          points="1"
          title="Resultado certo"
          description="Errou o placar, mas acertou quem venceu — ou que o jogo terminaria empatado."
        />
        <ScoringCard
          points="0"
          title="Resultado errado"
          description="O jogo terminou diferente do que você palpitou. Sem desconto: nunca fica negativo."
        />
      </ul>
      <p className={styles.scoringNote}>
        Esses são os valores padrão. O admin do grupo pode ajustar quanto vale cada acerto na
        criação do bolão.
      </p>
    </section>
  )
}

function ScoringCard({
  points,
  title,
  description,
}: {
  points: string
  title: string
  description: string
}) {
  return (
    <li className={styles.scoringCard}>
      <span className={styles.scoringPoints}>{points}</span>
      <h3 className={styles.scoringTitle}>{title}</h3>
      <p className={styles.scoringDesc}>{description}</p>
    </li>
  )
}

function Faq() {
  return (
    <section id="faq" className={styles.faq}>
      <h2 className={styles.sectionTitle}>Perguntas frequentes</h2>
      <dl className={styles.faqList}>
        <FaqItem
          q="O Palpitae é gratuito?"
          a="Sim. Você entra com sua conta Google e cria bolões sem pagar nada."
        />
        <FaqItem
          q="Como funciona a pontuação?"
          a="Você ganha 3 pontos por acertar o placar exato e 1 ponto por acertar apenas o resultado (vitória, empate ou derrota)."
        />
        <FaqItem
          q="Como entro em um grupo?"
          a={
            'Peça o código ou o link de convite ao admin do grupo e use a opção "Entrar em grupo".'
          }
        />
        <FaqItem
          q="Preciso instalar algum aplicativo?"
          a="Não. O Palpitae funciona direto no navegador, no celular ou no computador."
        />
        <FaqItem
          q="Quais campeonatos tem no Palpitae?"
          a="Brasileirão Série A 2026 e Copa do Mundo 2026. Você pode criar um grupo para cada campeonato, e novos torneios serão adicionados."
        />
      </dl>
    </section>
  )
}

function Cta() {
  return (
    <section className={styles.cta}>
      <h2 className={styles.ctaTitle}>Pronto para palpitar?</h2>
      <p className={styles.ctaSubtitle}>
        Entre com sua conta Google e crie seu primeiro bolão agora.
      </p>
      <div className={styles.ctaButton}>
        <GoogleLoginButton />
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <img
        src="/logo-text.svg"
        alt="Palpitae"
        width={86}
        height={22}
        className={styles.footerLogo}
      />
      <span className={styles.footerNote}>Palpitae — Bolões de futebol com seus amigos</span>
      {/* Static content pages live outside the SPA (built to /guias/*), so use
          a native <a> for a full navigation — react-router has no such route. */}
      <a
        href="/guias/"
        className={styles.footerLink}
        onClick={() => trackEvent('click_footer_guias')}
      >
        Guias de bolão
      </a>
      <span className={styles.footerNote}>
        Criado por{' '}
        <a
          href="https://github.com/pedrosatin"
          target="_blank"
          rel="noreferrer"
          className={styles.footerLink}
          onClick={() => trackEvent('click_footer_autor')}
        >
          @pedrosatin
        </a>
      </span>
    </footer>
  )
}

/* ─── Local presentational helpers ─────────────────────────────────────── */

function FeatureRow({
  tag,
  title,
  description,
  shot,
  shotAlt,
  shotWidth,
  shotHeight,
  reversed = false,
}: {
  tag: string
  title: string
  description: string
  shot: string
  shotAlt: string
  shotWidth: number
  shotHeight: number
  reversed?: boolean
}) {
  return (
    <article className={`${styles.feature} ${reversed ? styles.featureReversed : ''}`}>
      <div className={styles.featureCopy}>
        <span className={styles.featureTag}>{tag}</span>
        <h2 className={styles.featureTitle}>{title}</h2>
        <p className={styles.featureDesc}>{description}</p>
      </div>
      <BrowserFrame className={styles.featureShot}>
        <Shot src={shot} alt={shotAlt} width={shotWidth} height={shotHeight} loading="lazy" />
      </BrowserFrame>
    </article>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className={styles.faqItem}>
      <dt className={styles.faqQuestion}>{q}</dt>
      <dd className={styles.faqAnswer}>{a}</dd>
    </div>
  )
}

/**
 * Product screenshot that prefers a WebP source (30-65% smaller) and falls
 * back to the original PNG on browsers without WebP support. The WebP path is
 * derived from the PNG path by extension, so both files share one source of
 * truth. The hero shot passes loading="eager" and fetchPriority="high" (it's
 * the LCP element, and the preload in index.html carries the same priority);
 * the rest lazy-load.
 */
function Shot({
  src,
  alt,
  width,
  height,
  loading,
  fetchPriority,
}: {
  src: string
  alt: string
  width: number
  height: number
  loading: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
}) {
  const webp = src.replace(/\.png$/, '.webp')
  // O React 18 não conhece a prop `fetchPriority` em camelCase: ele avisa no
  // console e descarta o atributo, então a dica de prioridade nunca chegava ao
  // <img> (nem no navegador, nem no HTML gerado no build). Em minúsculas ele
  // repassa o atributo como qualquer outro desconhecido, que é o que o
  // navegador de fato lê. O cast existe só porque a tipagem do JSX descreve a
  // grafia camelCase.
  const priority = (fetchPriority ? { fetchpriority: fetchPriority } : {}) as object
  return (
    <picture>
      <source srcSet={webp} type="image/webp" />
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        {...priority}
      />
    </picture>
  )
}

/**
 * Decorative browser-window chrome wrapped around a screenshot, so the preview
 * reads as a real product shot rather than a bare image.
 */
function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`${styles.frame} ${className ?? ''}`}>
      <div className={styles.frameBar}>
        <span className={styles.frameDot} />
        <span className={styles.frameDot} />
        <span className={styles.frameDot} />
      </div>
      <div className={styles.frameBody}>{children}</div>
    </div>
  )
}
