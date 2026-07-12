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
          <a href="#recursos" className={styles.navLink} onClick={() => trackEvent('click_nav_recursos')}>
            Recursos
          </a>
          <a href="#pontuacao" className={styles.navLink} onClick={() => trackEvent('click_nav_pontuacao')}>
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

      <main>
        {/* ─── Hero ─────────────────────────────────────────────────────── */}
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Copa do Mundo FIFA 2026</span>
            <h1 className={styles.heroTitle}>
              Bolões de futebol <span className={styles.accent}>com seus amigos</span>
            </h1>
            <p className={styles.heroSubtitle}>
              Crie grupos privados, dê seus palpites rodada a rodada e dispute
              o topo da classificação. Tudo em um só lugar.
            </p>
            <div className={styles.heroActions}>
              <GoogleLoginButton />
              <a href="#recursos" className={styles.secondaryAction} onClick={() => trackEvent('click_hero_ver_como_funciona')}>
                Ver como funciona ↓
              </a>
            </div>
          </div>

          <BrowserFrame className={styles.heroShot}>
            <Shot
              src="/screenshots/grupos.png"
              alt="Tela de grupos do Palpitae mostrando os bolões do usuário"
              width={1336}
              height={717}
              loading="eager"
            />
          </BrowserFrame>
        </section>

        {/* ─── Features ─────────────────────────────────────────────────── */}
        <section id="recursos" className={styles.features}>
          <FeatureRow
            tag="Grupos"
            title="Crie ou entre em grupos privados"
            description="Monte um bolão com a galera em segundos. Compartilhe um código ou link de convite e acompanhe membros, sua posição e seus pontos de cada grupo."
            shot="/screenshots/grupos.png"
            shotAlt="Lista de grupos com membros, posição e pontos"
            shotWidth={1336}
            shotHeight={717}
          />
          <FeatureRow
            reversed
            tag="Palpites"
            title="Dê seus palpites rodada a rodada"
            description="Cravou o placar? Ajuste os números de cada jogo e salve um por um — ou de uma vez com 'Salvar todos'. Navegue entre as rodadas e palpite com antecedência."
            shot="/screenshots/palpites.png"
            shotAlt="Tela de previsões com cards de jogos e seletores de placar"
            shotWidth={1297}
            shotHeight={840}
          />
        </section>

        {/* ─── FAQ ──────────────────────────────────────────────────────── */}
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
              a={'Peça o código ou o link de convite ao admin do grupo e use a opção "Entrar em grupo".'}
            />
            <FaqItem
              q="Preciso instalar algum aplicativo?"
              a="Não. O Palpitae funciona direto no navegador, no celular ou no computador."
            />
          </dl>
        </section>

        {/* ─── Final CTA ────────────────────────────────────────────────── */}
        <section className={styles.cta}>
          <h2 className={styles.ctaTitle}>Pronto para palpitar?</h2>
          <p className={styles.ctaSubtitle}>
            Entre com sua conta Google e crie seu primeiro bolão agora.
          </p>
          <div className={styles.ctaButton}>
            <GoogleLoginButton />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <img
          src="/logo-text.svg"
          alt="Palpitae"
          width={86}
          height={22}
          className={styles.footerLogo}
        />
        <span className={styles.footerNote}>
          Palpitae — Bolões de futebol com seus amigos
        </span>
        {/* Static content pages live outside the SPA (built to /guias/*), so use
            a native <a> for a full navigation — react-router has no such route. */}
        <a
          href="/guias/"
          className={styles.footerLink}
          onClick={() => trackEvent('click_footer_guias')}
        >
          Guias de bolão
        </a>
      </footer>
    </div>
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
 * truth. The hero shot passes loading="eager" (it's the LCP element); the rest
 * lazy-load.
 */
function Shot({
  src,
  alt,
  width,
  height,
  loading,
}: {
  src: string
  alt: string
  width: number
  height: number
  loading: 'eager' | 'lazy'
}) {
  const webp = src.replace(/\.png$/, '.webp')
  return (
    <picture>
      <source srcSet={webp} type="image/webp" />
      <img src={src} alt={alt} width={width} height={height} loading={loading} />
    </picture>
  )
}

/**
 * Decorative browser-window chrome wrapped around a screenshot, so the preview
 * reads as a real product shot rather than a bare image.
 */
function BrowserFrame({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
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
