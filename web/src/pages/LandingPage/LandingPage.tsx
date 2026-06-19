import { Link } from 'react-router-dom'
import GoogleLoginButton from '../../components/GoogleLoginButton'
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
        <Link to="/" className={styles.brand}>
          <img
            src="/logo-text.svg"
            alt="Palpitae"
            width={110}
            height={28}
            className={styles.brandLogo}
          />
        </Link>
        <nav className={styles.navLinks}>
          <a href="#recursos" className={styles.navLink}>
            Recursos
          </a>
          <a href="#pontuacao" className={styles.navLink}>
            Pontuação
          </a>
          <a href="#faq" className={styles.navLink}>
            Dúvidas
          </a>
          <Link to="/entrar" className={styles.navCta}>
            Entrar
          </Link>
        </nav>
      </header>

      <main>
        {/* ─── Hero ─────────────────────────────────────────────────────── */}
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>FIFA World Cup 2026</span>
            <h1 className={styles.heroTitle}>
              Bolões de futebol <span className={styles.accent}>com seus amigos</span>
            </h1>
            <p className={styles.heroSubtitle}>
              Crie grupos privados, dê seus palpites rodada a rodada, monte o
              chaveamento do mata-mata e dispute o topo da classificação. Tudo em
              um só lugar.
            </p>
            <div className={styles.heroActions}>
              <GoogleLoginButton />
              <a href="#recursos" className={styles.secondaryAction}>
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
          <FeatureRow
            tag="Chaveamento"
            title="Monte o bracket do mata-mata"
            description="Das oitavas à final, escolha quem avança em cada chave. As escolhas inválidas se ajustam automaticamente, e dá pra ver o chaveamento dos outros membros do grupo."
            shot="/screenshots/chaveamento.png"
            shotAlt="Tela de chaveamento do mata-mata da copa"
            shotWidth={1296}
            shotHeight={839}
          />
        </section>

        {/* ─── Scoring ──────────────────────────────────────────────────── */}
        <section id="pontuacao" className={styles.scoring}>
          <h2 className={styles.sectionTitle}>Quanto mais longe, mais vale</h2>
          <p className={styles.sectionLead}>
            Acertos no mata-mata pesam de forma crescente até a grande final.
          </p>
          <ul className={styles.scoringGrid}>
            <ScoreCard phase="16 avos" points="1pt" />
            <ScoreCard phase="Oitavas" points="2pt" />
            <ScoreCard phase="Quartas" points="4pt" />
            <ScoreCard phase="Semi" points="8pt" />
            <ScoreCard phase="Final" points="16pt" highlight />
          </ul>
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
              a="Você ganha pontos acertando os palpites. No mata-mata os acertos valem cada vez mais: começam em 1 ponto nos 16-avos e dobram a cada fase até 16 pontos na final."
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

function ScoreCard({
  phase,
  points,
  highlight = false,
}: {
  phase: string
  points: string
  highlight?: boolean
}) {
  return (
    <li className={`${styles.scoreCard} ${highlight ? styles.scoreCardHighlight : ''}`}>
      <span className={styles.scorePoints}>{points}</span>
      <span className={styles.scorePhase}>{phase}</span>
    </li>
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
