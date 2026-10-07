/**
 * Build-time generation of the public SEO "guides" pages.
 *
 * These are evergreen, top-of-funnel content pages (e.g. "what is a football
 * pool") rendered to PLAIN STATIC HTML at build time — no React, no client JS,
 * no auth gate. Crawlers don't execute JS (see context-seo.md / ADR-006), so
 * the only way a content page reliably indexes is as a real .html file. Each
 * guide is emitted at /guias/<slug>/index.html, plus an index at /guias/, and
 * every URL is added to sitemap.xml and to /llms.txt.
 *
 * On Cloudflare Pages static assets are served before the SPA fallback in
 * _redirects (`/* /index.html 200`), so these files win over the React app.
 */
import { execSync } from 'node:child_process'
import type { Connect, Plugin } from 'vite'
import { analyticsHead, consentBanner, CONSENT_CSS, normalizeGaId } from './analytics'

const SITE_URL = 'https://palpitae.com.br'
/** Shared 1200x630 social image: og:image and the Article `image`. */
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`
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

interface GuideSection {
  heading: string
  /** Paragraphs, rendered as <p>. Plain text — authored by us. */
  body: string[]
}

interface GuideFaq {
  question: string
  /** Plain-text answer; rendered on the page and in the FAQPage JSON-LD. */
  answer: string
}

interface Guide {
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
  /**
   * Optional FAQ block rendered after the sections, mirrored in a FAQPage
   * JSON-LD so search engines and answer engines can quote it.
   */
  faq?: GuideFaq[]
  /**
   * ISO date (YYYY-MM-DD) the guide first went live: Article `datePublished`.
   * Fixed forever. Taken from the commit on main that introduced the slug
   * (`git log --reverse --format=%as -S "slug: '<slug>'" -- web/build/guides.ts`).
   * A new guide uses the date of the commit that adds it.
   */
  published: string
  /**
   * ISO date (YYYY-MM-DD) of the last content edit: sitemap <lastmod> and
   * Article `dateModified`. Bump it whenever the guide's text changes; never
   * earlier than `published`.
   */
  updated: string
}

/**
 * The evergreen guide catalog. Topics are intentionally timeless so they keep
 * ranking across seasons and tournaments: a specific edition (e.g. "Copa do
 * Mundo 2026") only appears in the past tense, never as the current season. Add new guides
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
    published: '2026-06-20',
    updated: '2026-06-20',
  },
  {
    slug: 'como-organizar-um-bolao',
    title: 'Como organizar um bolão com amigos (passo a passo)',
    teaser:
      'Clique aqui e veja o passo a passo para montar um bolão: escolher o campeonato, combinar as regras, chamar a galera e acompanhar a classificação sem dor de cabeça.',
    description:
      'Passo a passo para organizar um bolão com os amigos: escolher o campeonato, definir as regras de pontuação, convidar a galera e acompanhar a classificação.',
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
    published: '2026-06-20',
    updated: '2026-10-04',
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
          'Defina antes se o palpite vale pelo placar dos 90 minutos ou pelo placar ao fim da prorrogação.',
          'No Palpitae vale o placar do tempo normal somado à prorrogação, sem os gols da disputa de pênaltis. Um jogo que termina 1 a 1 depois dos 120 minutos e vai para os pênaltis conta como empate de 1 a 1 para o palpite.',
          'Nas fases de jogo único que o campeonato decide nos pênaltis, quem palpitou empate também escolhe quem vence a disputa. Acertar o vencedor dá um bônus de 1 ponto por padrão, e quem cria o grupo pode ajustar esse valor de 0 a 10. Errar o vencedor dos pênaltis não tira pontos do palpite.',
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
    published: '2026-06-20',
    updated: '2026-10-05',
  },
  {
    slug: 'bolao-do-brasileirao',
    title: 'Como fazer um bolão do Brasileirão Série A',
    teaser:
      'Clique aqui e veja como montar um bolão do Brasileirão com os amigos: 38 rodadas de palpites, pontuação automática e classificação atualizada o ano inteiro.',
    description:
      'Monte um bolão do Brasileirão Série A com os amigos: regras de pontuação para 38 rodadas, trava dos palpites e como manter o grupo engajado na temporada.',
    intro:
      'O Brasileirão é o campeonato perfeito para bolão: são 38 rodadas ao longo do ano, jogo importante quase toda semana e reviravolta até a última rodada. Veja como montar o seu, que regras usar e como manter a disputa viva a temporada inteira.',
    sections: [
      {
        heading: 'Por que o Brasileirão dá um ótimo bolão',
        body: [
          'Diferente de uma Copa do Mundo, que dura um mês, o Brasileirão é um campeonato de pontos corridos com 20 times e 380 jogos. Isso significa palpites toda semana durante mais de seis meses — a disputa do bolão acompanha a temporada inteira, e quem começa mal tem tempo de sobra para se recuperar.',
          'Pontos corridos também premiam consistência: acertar palpites de jogos "fáceis" toda rodada vale tanto quanto cravar um placar improvável de vez em quando. É um teste real de quem acompanha o campeonato de verdade.',
        ],
      },
      {
        heading: 'Regras que funcionam bem em pontos corridos',
        body: [
          'O sistema clássico funciona muito bem no Brasileirão: 3 pontos para quem crava o placar exato e 1 ponto para quem acerta só o resultado (vitória, empate ou derrota). Em 38 rodadas, essa diferença entre cravar e só acertar o vencedor separa bem os primeiros colocados.',
          'Uma decisão importante é a trava dos palpites: o mais justo é travar cada palpite no horário de início daquele jogo, e não a rodada inteira de uma vez — no Brasileirão os jogos de uma mesma rodada se espalham entre sexta e segunda, e ninguém deveria ser impedido de palpitar no jogo de segunda por causa do jogo de sexta.',
        ],
      },
      {
        heading: 'Como manter o grupo engajado por 38 rodadas',
        body: [
          'A temporada é longa, e o segredo é reduzir o atrito: se registrar palpite der trabalho, o grupo esvazia em um mês. Palpites pelo celular, lembrete antes da rodada e classificação atualizada automaticamente fazem mais diferença do que qualquer prêmio.',
          'Também ajuda ter marcos no caminho: quem lidera no primeiro turno, quem foi o melhor do returno, quem acertou mais placares exatos. São títulos paralelos que renovam o interesse de quem já não briga pelo topo.',
        ],
      },
      {
        heading: 'Monte seu bolão do Brasileirão no Palpitae',
        body: [
          'No Palpitae o Brasileirão Série A 2026 já está disponível: você cria um grupo privado gratuito, convida os amigos por link e cada um dá seus palpites rodada a rodada. Os resultados sincronizam sozinhos, a pontuação é automática e cada palpite trava no início do próprio jogo.',
          'A classificação do grupo e a tabela real do campeonato ficam lado a lado no app — dá para ver quem manja de futebol e quem só tem sorte, a temporada inteira.',
        ],
      },
    ],
    faq: [
      {
        question: 'Quantos jogos tem o Brasileirão Série A?',
        answer:
          'São 380 jogos. Os 20 times se enfrentam em turno e returno, num total de 38 rodadas.',
      },
      {
        question: 'Dá para começar um bolão do Brasileirão com o campeonato em andamento?',
        answer:
          'Sim. Você pode criar ou entrar num grupo a qualquer momento e palpitar nos jogos que ainda não começaram. Contam pontos os jogos em que você deu palpite.',
      },
      {
        question: 'O que acontece com jogo adiado no bolão?',
        answer:
          'No Palpitae, jogo adiado não trava o palpite. Ele continua aberto para edição até a nova data e só pontua quando a partida acontece.',
      },
    ],
    published: '2026-07-12',
    updated: '2026-10-04',
  },
  {
    slug: 'bolao-copa-do-mundo',
    title: 'Como fazer um bolão da Copa do Mundo',
    teaser:
      'Clique aqui e veja como montar um bolão da Copa do Mundo com os amigos: fase de grupos, mata-mata, pontuação por placar e como manter a galera engajada até a grande final.',
    description:
      'Monte um bolão da Copa do Mundo com seus amigos: como organizar a fase de grupos e o mata-mata, quais regras de pontuação usar e como manter todo mundo engajado até a final.',
    intro:
      'A Copa do Mundo é o maior evento do futebol e um dos melhores momentos para fazer bolão com os amigos. São semanas de jogos diários, surpresas na fase de grupos e mata-mata até a final. Veja como organizar o seu bolão e aproveitar cada partida.',
    sections: [
      {
        heading: 'Por que a Copa do Mundo é perfeita para bolão',
        body: [
          'Diferente de um campeonato de pontos corridos, a Copa concentra muita emoção em poucas semanas: fase de grupos com surpresas, oitavas, quartas, semis e final. Cada rodada elimina times, o que mantém a tensão alta até o último jogo.',
          'A Copa também é acessível para quem não acompanha futebol o ano inteiro. A atenção de todo mundo facilita o engajamento, e qualquer pessoa tem uma opinião sobre quem vai longe.',
        ],
      },
      {
        heading: 'Regras para a fase de grupos',
        body: [
          'Na fase de grupos cada seleção joga três partidas, e o palpite de placar exato ou resultado funciona igual a qualquer bolão. O sistema clássico dá 3 pontos para o placar exato e 1 ponto para quem acerta só o resultado (vitória, empate ou derrota).',
          'Vale combinar se o bolão cobre todos os jogos da fase de grupos ou só a partir das oitavas. Cobrir tudo dá mais pontos para quem acompanha desde o início e mantém o grupo ativo nas primeiras semanas.',
        ],
      },
      {
        heading: 'Como pontuar no mata-mata',
        body: [
          'No mata-mata o jogo pode ir para prorrogação e pênaltis. Combine antes se o palpite vale pelo placar dos 90 minutos ou pelo placar ao fim da prorrogação. No Palpitae vale o placar ao fim da prorrogação, sem os gols da disputa de pênaltis. Um 2 a 2 depois de 120 minutos conta como empate de 2 a 2.',
          'Nos jogos eliminatórios de partida única, quem palpitou empate no Palpitae também escolhe quem vence nos pênaltis. Acertar dá um bônus de 1 ponto por padrão, e quem cria o grupo pode ajustar esse valor de 0 a 10.',
          'Alguns grupos dão mais pontos nas fases finais, já que os jogos ficam mais decisivos. Uma opção simples: manter a pontuação igual em todas as fases e fazer as semifinais e a final valerem em dobro. Cria tensão no fim sem complicar as regras.',
        ],
      },
      {
        heading: 'Bolão da Copa no Palpitae',
        body: [
          'No Palpitae você cria um grupo privado gratuito e convida os amigos por link. Cada um dá seus palpites antes de cada jogo, e a pontuação é calculada automaticamente a cada resultado. A classificação do grupo atualiza sozinha.',
          'A Copa do Mundo 2026 terminou. Os bolões dela no Palpitae tiveram fase de grupos, chaveamento do mata-mata e palpite de pênaltis. Hoje o campeonato com jogos em andamento no app é o Brasileirão Série A.',
        ],
      },
    ],
    published: '2026-08-02',
    updated: '2026-10-05',
  },
  {
    slug: 'bolao-de-empresa',
    title: 'Como fazer um bolão na empresa com os colegas de trabalho',
    teaser:
      'Clique aqui e veja como montar um bolão entre colegas de trabalho: quem organiza, que regras usar, como evitar atrito e como manter o clima leve até o fim do campeonato.',
    description:
      'Como organizar um bolão grátis entre colegas de trabalho sem planilha: pontuação, convite da equipe e prêmio sem dinheiro.',
    intro:
      'Bolão no trabalho vira assunto no grupo da equipe toda segunda. Para dar certo, alguém precisa organizar, as regras precisam estar claras desde o primeiro jogo e ninguém deveria passar a semana somando pontos em planilha.',
    sections: [
      {
        heading: 'Por que fazer um bolão na empresa',
        body: [
          'Um bolão aproxima gente de áreas que quase não conversam. A pessoa do financeiro e a do suporte passam a discutir o mesmo jogo, e a classificação vira assunto em qualquer intervalo. Em equipes remotas o efeito é parecido. O bolão dá um motivo leve para o grupo trocar mensagens que não sejam sobre trabalho.',
          'O formato também funciona para quem não acompanha futebol. Num bolão de pontos, um palpite dado no chute às vezes vence o de quem assiste a todos os jogos, e isso deixa a disputa aberta para todo mundo.',
        ],
      },
      {
        heading: 'Escolha quem organiza e qual campeonato',
        body: [
          'Defina uma pessoa responsável. Ela cria o grupo, envia o convite, tira dúvidas sobre as regras e decide os casos que ninguém previu. Não precisa ser alguém da liderança. Costuma funcionar melhor com quem gosta de futebol e tem paciência para lembrar a turma de palpitar.',
          'Depois escolha o campeonato. A Copa do Mundo concentra muitos jogos em poucas semanas e atrai até quem ignora futebol no resto do ano. O Brasileirão tem 38 rodadas ao longo do ano, com jogo quase toda semana, e serve para um bolão que acompanha o ano inteiro. Para um primeiro bolão de empresa, um torneio curto é mais fácil de levar até o fim.',
        ],
      },
      {
        heading: 'Escreva as regras antes do primeiro jogo',
        body: [
          'No trabalho, regra ambígua vira desconforto entre colegas. Antes do primeiro jogo, deixe por escrito quanto vale cada acerto, até quando dá para mudar o palpite e o que acontece com jogo adiado. O modelo mais usado dá 3 pontos para o placar exato e 1 ponto para quem acerta só o resultado.',
          'Se parte da equipe nunca participou de bolão, use só o resultado: vitória do mandante, empate ou vitória do visitante. Fica fácil de explicar e qualquer pessoa palpita em poucos segundos.',
          'Decida também se os palpites dos colegas ficam visíveis antes do jogo. Esconder os palpites até o jogo começar impede que alguém copie o palpite de quem está liderando.',
        ],
      },
      {
        heading: 'Cuidado com prêmio em dinheiro',
        body: [
          'Bolão de empresa funciona bem sem dinheiro. Um prêmio simbólico basta, como escolher o restaurante do próximo almoço da equipe. Quando entra dinheiro, alguém precisa cobrar e guardar o valor, e o bolão pode esbarrar nas regras internas.',
          'Se a empresa tiver política sobre jogos, rifas ou sorteios entre funcionários, consulte o RH antes de anunciar o bolão.',
        ],
      },
      {
        heading: 'Mantenha a equipe engajada',
        body: [
          'Bolão de empresa costuma morrer por esquecimento. Quem perde uma rodada fica para trás e desanima. Lembrete antes da rodada e classificação fácil de consultar seguram a participação.',
          'Títulos paralelos, como melhor da rodada ou mais placares exatos, mantêm palpitando quem já não briga pelo topo.',
        ],
      },
      {
        heading: 'Como montar o bolão da empresa no Palpitae',
        body: [
          'No Palpitae cada pessoa entra com a conta Google e o organizador cria um grupo privado gratuito. Na criação ele escolhe a pontuação: clássica (3 pontos pelo placar exato e 1 pelo resultado), só placar exato, só vencedor ou valores personalizados. Também define se os palpites dos outros aparecem em tempo real ou ficam ocultos até o jogo começar. Essas regras ficam fixas depois que o grupo é criado, então ninguém muda a pontuação no meio do campeonato.',
          'O convite vai por link ou código, que dá para colar no canal da equipe. Cada grupo aceita até 50 participantes. Em empresas maiores, dá para criar um grupo por área. Cada palpite trava no horário de início do jogo, os resultados entram sozinhos e a classificação se atualiza a cada partida. O app manda um lembrete por e-mail na manhã da rodada para quem ainda não palpitou, e cada pessoa pode desligar o aviso nas configurações.',
        ],
      },
    ],
    faq: [
      {
        question: 'Precisa pagar para fazer o bolão da empresa no Palpitae?',
        answer:
          'Não. Criar o grupo, convidar os colegas, palpitar e acompanhar a classificação é gratuito.',
      },
      {
        question: 'Quantas pessoas cabem em um grupo?',
        answer:
          'Até 50 participantes por grupo. Para equipes maiores, crie um grupo por área ou por time e compare os líderes de cada um.',
      },
      {
        question: 'Colegas que não entendem de futebol conseguem participar?',
        answer:
          'Sim. No modo só vencedor, o palpite é um clique entre mandante, empate e visitante. O app mostra os jogos da rodada com data e horário.',
      },
      {
        question: 'O bolão precisa ter prêmio em dinheiro?',
        answer:
          'Não, e o Palpitae não movimenta dinheiro. O app registra palpites e calcula pontos. Qualquer prêmio fica por conta do grupo, e em empresa os prêmios simbólicos evitam cobrança e conflito com regras internas.',
      },
    ],
    published: '2026-10-05',
    updated: '2026-10-05',
  },
  {
    slug: 'bolao-online-gratis',
    title: 'Como funciona um bolão online grátis',
    teaser:
      'Clique aqui e entenda como funciona um bolão online grátis: convite por link, palpites pelo celular e pontuação automática, sem planilha e sem conta de cabeça.',
    description:
      'Como funciona um bolão de futebol online e grátis: criar o grupo, convidar amigos por link, palpitar pelo celular e ver a pontuação calculada a cada jogo.',
    intro:
      'Bolão online é o bolão de sempre com a parte chata automatizada. Os palpites ficam registrados com horário, os resultados entram sozinhos e a classificação se atualiza depois de cada jogo.',
    sections: [
      {
        heading: 'O que muda em relação ao bolão no papel',
        body: [
          'No bolão tradicional, alguém recolhe os palpites por mensagem, copia tudo para uma planilha e, depois da rodada, confere placar por placar. Cada etapa depende dessa pessoa, e uma semana de férias dela deixa a rodada sem pontuação. Também fica difícil provar que um palpite chegou antes do início do jogo.',
          'Num bolão online, cada participante registra os próprios palpites. O sistema guarda o horário, bloqueia alterações quando a partida começa e calcula os pontos com a regra combinada. O organizador só cria o grupo e convida as pessoas.',
        ],
      },
      {
        heading: 'Passo a passo de um bolão online',
        body: [
          'O processo segue a mesma ordem em quase toda plataforma. Alguém cria o grupo e escolhe o campeonato. Em seguida define a regra de pontuação e manda o convite. Cada participante entra, vê a lista de jogos e preenche os placares antes de cada partida.',
          'Quando o jogo termina, o placar oficial entra no sistema e os pontos de cada palpite são calculados. A classificação do grupo é refeita na hora, e todo mundo vê quem subiu e quem caiu na rodada.',
          'Para quem participa, o trabalho se resume a abrir o app antes da rodada e preencher os jogos. Para quem organiza, termina no envio do convite.',
        ],
      },
      {
        heading: 'O que conferir num bolão grátis',
        body: [
          'Alguns sites anunciam bolão grátis e cobram por recursos como mais participantes. Antes de convidar o grupo, confira se o limite de pessoas atende, se a pontuação é calculada sem custo e se o cadastro pede dados além do necessário.',
          'Confira também se o site é mesmo um bolão. Um bolão entre amigos é uma disputa de palpites em que cada acerto vale pontos. Uma casa de apostas recebe dinheiro e paga conforme as odds de cada jogo. Se a página pede depósito, cartão ou Pix para você palpitar, você está numa casa de apostas.',
        ],
      },
      {
        heading: 'Regras de pontuação mais usadas',
        body: [
          'A regra clássica dá 3 pontos para quem acerta o placar exato e 1 ponto para quem acerta só o resultado (vitória, empate ou derrota). Ela premia quem arrisca o placar e ainda recompensa quem acertou o vencedor.',
          'Há variações. Alguns grupos contam só o vencedor, o que deixa o palpite mais rápido. Outros contam só o placar exato, o que deixa a disputa mais difícil. Num bolão online a regra fica registrada no grupo e vale igual para todos, sem conta manual.',
        ],
      },
      {
        heading: 'Como o Palpitae funciona',
        body: [
          'O Palpitae é um app de bolão gratuito que roda no navegador do celular ou do computador, sem instalar nada. O login usa a conta Google. Você cria um grupo privado, escolhe a regra de pontuação e convida os amigos por link ou código. Cada grupo aceita até 50 pessoas.',
          'Os jogos e resultados são sincronizados automaticamente a partir de um provedor de dados de futebol. Cada palpite trava no horário de início do próprio jogo, e os pontos entram assim que a partida termina. A classificação do grupo fica ao lado da tabela do campeonato. O app manda um lembrete por e-mail na manhã da rodada para quem ainda não palpitou.',
          'O Palpitae registra palpites e calcula pontos, sem depósito, odds ou prêmio em dinheiro.',
        ],
      },
    ],
    faq: [
      {
        question: 'O Palpitae é uma casa de apostas?',
        answer:
          'Não. O Palpitae é um bolão de palpites entre amigos, gratuito e sem depósito. Ninguém aposta dinheiro no app, e o site não paga prêmios.',
      },
      {
        question: 'Preciso baixar aplicativo para participar?',
        answer:
          'Não. O Palpitae funciona no navegador do celular ou do computador. Basta abrir o link de convite e entrar com a conta Google.',
      },
      {
        question: 'Quais campeonatos estão disponíveis?',
        answer:
          'O campeonato com jogos em andamento no Palpitae é o Brasileirão Série A 2026. A Copa do Mundo 2026 terminou, e os grupos dela mostram a classificação final.',
      },
      {
        question: 'Dá para mudar o palpite depois de enviado?',
        answer:
          'Sim, até o horário de início do jogo. Depois disso o palpite trava e não pode mais ser alterado.',
      },
    ],
    published: '2026-10-05',
    updated: '2026-10-05',
  },
  {
    slug: 'planilha-de-bolao',
    title: 'Quando trocar a planilha de bolão por um app',
    teaser:
      'Clique aqui e compare a planilha de bolão com um app de bolão: quanto trabalho cada um dá, onde surgem os erros de pontuação e quando a planilha ainda faz sentido.',
    description:
      'Planilha de bolão no Excel ou no Google Sheets, ou app de bolão online? Compare o trabalho de cada formato, os erros de pontuação e a trava dos palpites.',
    intro:
      'A planilha é o jeito clássico de organizar bolão: uma aba com os jogos, uma coluna por participante e fórmulas para somar os pontos. A planilha dá conta de grupos pequenos. Com grupo grande ou campeonato de dezenas de rodadas, a manutenção pesa.',
    sections: [
      {
        heading: 'Como funciona uma planilha de bolão',
        body: [
          'Uma planilha de bolão típica tem os jogos nas linhas, os palpites de cada participante ao lado do placar real e uma fórmula que compara os dois. Com o palpite nas colunas C e D e o placar real em E e F, a fórmula =SE(E(C2=E2;D2=F2);3;SE(SINAL(C2-D2)=SINAL(E2-F2);1;0)) dá 3 pontos pelo placar exato, 1 pelo resultado e 0 no resto. A função E confere se os gols dos dois times batem. A função SINAL devolve 1, 0 ou -1 conforme o mandante vence, empata ou perde, então comparar os dois sinais confere o resultado.',
          'Uma aba de classificação soma os pontos de cada participante e ordena a lista.',
          'Montar a primeira versão leva uma tarde. Depois disso, o organizador precisa recolher os palpites antes de cada rodada, copiar para a planilha, digitar os placares oficiais e conferir se as fórmulas pegaram todas as linhas.',
          'Planilhas prontas baixadas da internet já trazem a tabela do campeonato e as fórmulas. Elas poupam a montagem. O recolhimento dos palpites e a digitação dos placares continuam manuais, rodada após rodada.',
        ],
      },
      {
        heading: 'Onde a planilha costuma dar problema',
        body: [
          'Palpite que chega por mensagem não tem horário confiável. Alguém sempre manda depois do apito inicial, e o organizador precisa decidir se aceita. Sem horário registrado, a discussão fica na palavra de cada um.',
          'Um placar lançado na linha errada ou uma fórmula arrastada só até a metade da coluna muda a classificação, e o erro só aparece quando alguém reclama. Num campeonato de pontos corridos com 380 jogos, são centenas de células para conferir.',
          'A planilha só anda quando o organizador atualiza. Se ele perde o interesse no meio da temporada, a classificação congela na última rodada que ele lançou.',
        ],
      },
      {
        heading: 'O que um app de bolão faz no lugar da planilha',
        body: [
          'Num app de bolão, cada participante preenche os próprios palpites. O sistema guarda o horário, trava o palpite quando o jogo começa e busca o placar oficial sozinho. A pontuação segue a regra definida na criação do grupo e é aplicada igual para todos.',
          'O organizador deixa de ser digitador. Ele cria o grupo, manda o convite e palpita como os outros. A classificação fica disponível a qualquer hora, sem esperar ninguém atualizar o arquivo.',
        ],
      },
      {
        heading: 'Quando a planilha ainda faz sentido',
        body: [
          'A planilha funciona bem em grupos muito pequenos, com poucos jogos, ou quando a regra é tão específica que nenhum app oferece, como pontuar artilheiro, campeão e vice antes do torneio. Também serve para quem gosta de montar fórmulas e acompanhar estatísticas próprias.',
          'Num campeonato de 38 rodadas, o organizador digita 380 placares. Nesses casos um app economiza horas do organizador e encerra a discussão sobre palpite atrasado.',
        ],
      },
      {
        heading: 'Trocar a planilha pelo Palpitae',
        body: [
          'No Palpitae você cria o grupo de graça e escolhe a regra de pontuação: clássica (3 pontos pelo placar exato e 1 pelo resultado), só placar exato, só vencedor ou valores personalizados de 0 a 10. Depois manda o link de convite no mesmo grupo de WhatsApp onde a planilha circulava.',
          'Os resultados chegam automaticamente, cada palpite trava no início do próprio jogo e a classificação se atualiza a cada partida. O app conta os placares exatos de cada participante, que na planilha exigem uma coluna extra de fórmula.',
        ],
      },
    ],
    faq: [
      {
        question: 'Qual fórmula usar para pontuar uma planilha de bolão?',
        answer:
          'Com o palpite nas colunas C e D e o placar real em E e F, use =SE(E(C2=E2;D2=F2);3;SE(SINAL(C2-D2)=SINAL(E2-F2);1;0)) para a pontuação clássica de 3 pontos pelo placar exato, 1 pelo resultado e 0 no resto. A função E confere se os gols dos dois times batem. A função SINAL devolve 1, 0 ou -1 conforme o mandante vence, empata ou perde, então comparar os dois sinais confere o resultado.',
      },
      {
        question: 'Dá para importar a planilha antiga para o Palpitae?',
        answer:
          'Não. No Palpitae cada participante registra os próprios palpites a partir do momento em que entra no grupo. Com o campeonato em andamento, o mais simples é começar o grupo na rodada seguinte.',
      },
      {
        question: 'Quanto custa usar um app de bolão?',
        answer:
          'Depende do app. No Palpitae, criar grupos, convidar participantes e acompanhar a classificação é gratuito.',
      },
    ],
    published: '2026-10-05',
    updated: '2026-10-05',
  },
  {
    slug: 'dicas-para-acertar-palpites',
    title: 'Dicas para acertar mais palpites no bolão',
    teaser:
      'Clique aqui e veja dicas para palpitar melhor no bolão: quais placares mais saem, quando arriscar o empate e como a regra de pontuação muda a estratégia.',
    description:
      'Dicas para acertar mais palpites no bolão de futebol: placares mais comuns, peso do mando de campo, quando arriscar o empate e como a regra de pontuação muda a estratégia.',
    intro:
      'Ninguém acerta todos os placares, e é isso que deixa o bolão divertido. Alguns hábitos aumentam a média de pontos ao longo do campeonato. As dicas abaixo valem para qualquer bolão que pontua placar exato e resultado.',
    sections: [
      {
        heading: 'Entenda o que a regra de pontuação premia',
        body: [
          'Antes de palpitar, leia a regra do grupo. No sistema clássico, o placar exato vale 3 pontos e o resultado vale 1. Um placar exato vale três acertos de resultado. Errar o vencedor zera o palpite, então escolha o resultado primeiro.',
          'Se o grupo pontua só o vencedor, esqueça os gols e pense apenas em quem ganha. Se pontua só o placar exato, vale escolher sempre os placares que mais acontecem.',
        ],
      },
      {
        heading: 'Placares baixos saem mais',
        body: [
          'A maioria dos jogos de futebol termina com poucos gols. Placares como 1 a 0, 1 a 1, 2 a 1 e 0 a 0 aparecem com mais frequência do que 3 a 2 ou 4 a 1. Na dúvida, um placar baixo coerente com o vencedor que você espera tem mais chance de cravar.',
          'O 3 a 0 para o favorito sai menos que 1 a 0 ou 2 a 0. Se o vencedor estiver certo, você leva o ponto de resultado com qualquer um dos três, e o placar mais modesto tem mais chance de valer os 3 pontos.',
        ],
      },
      {
        heading: 'Mando de campo e momento dos times',
        body: [
          'Em campeonatos nacionais, o mandante vence com mais frequência do que o visitante. Quando dois times estão próximos na tabela, o mando serve de critério de desempate.',
          'Olhe também os últimos jogos, os desfalques anunciados e o calendário. Um time que jogou no meio da semana por outra competição costuma poupar titulares no fim de semana, e isso muda o favoritismo.',
          'Desconfie da paixão pelo seu time. Palpitar sempre a favor dele, ou sempre contra o rival, tira pontos. Quando a dúvida for grande, palpite o que a tabela indica.',
        ],
      },
      {
        heading: 'Quando arriscar o empate',
        body: [
          'O empate é o resultado mais difícil de prever, e muita gente evita palpitar nele. Por isso um empate acertado costuma valer pontos que pouca gente no grupo fez. Jogos entre times do mesmo nível, clássicos regionais e partidas em que o empate serve aos dois lados são bons candidatos.',
          'Em campeonatos de pontos corridos, boa parte dos jogos termina empatada. Quem nunca palpita empate abre mão desses pontos a temporada inteira.',
        ],
      },
      {
        heading: 'No mata-mata, pense no contexto do confronto',
        body: [
          'Em jogos de ida e volta, o time que venceu a ida por boa vantagem costuma jogar a volta com mais cautela, e o placar tende a ser baixo.',
          'No Palpitae vale o placar ao fim da prorrogação, sem contar a disputa de pênaltis. Nos jogos eliminatórios de partida única, quem palpita empate também escolhe quem vence nos pênaltis e ganha pontos extras se acertar.',
        ],
      },
      {
        heading: 'Consistência ganha bolão longo',
        body: [
          'Em campeonatos longos, como o Brasileirão com 38 rodadas, quem lidera no fim costuma ser quem palpitou em todos os jogos. Um palpite esquecido vale zero. Preencha a rodada com antecedência e ajuste perto do jogo se surgir alguma notícia.',
          'No Palpitae dá para editar cada palpite até o apito inicial, o app manda um lembrete por e-mail na manhã da rodada para quem ainda não palpitou e a classificação mostra também quantos placares exatos cada participante acertou.',
        ],
      },
    ],
    faq: [
      {
        question: 'Qual é o placar mais comum no futebol?',
        answer:
          'Na maioria das ligas, 1 a 0 e 1 a 1 estão entre os placares mais frequentes, seguidos de 2 a 1, 2 a 0 e 0 a 0. Jogos com cinco gols ou mais são raros.',
      },
      {
        question: 'Vale mais arriscar o placar exato ou garantir o resultado?',
        answer:
          'No sistema clássico (3 pontos pelo placar, 1 pelo resultado), o placar exato só pontua se o vencedor estiver certo. Escolha primeiro o resultado mais provável e, dentro dele, o placar mais comum.',
      },
      {
        question: 'Posso ver os palpites dos outros antes de palpitar?',
        answer:
          'Depende da configuração do grupo. No Palpitae, quem cria o grupo escolhe se os palpites aparecem em tempo real ou ficam ocultos. Nos grupos com palpites ocultos, os palpites dos outros aparecem quando o jogo começa.',
      },
    ],
    published: '2026-10-05',
    updated: '2026-10-05',
  },
]

/** Public path for a guide (with trailing slash, as served). */
function guidePath(slug: string): string {
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
section.faq h3{font-size:1.0625rem;line-height:1.35;margin:24px 0 8px}
@media (prefers-reduced-motion:reduce){a.card{transition:none}a.card:hover{transform:none}}
${CONSENT_CSS}
`.trim()

/** Shared <head> tags for a page given its canonical path, title, description. */
function head(
  path: string,
  title: string,
  description: string,
  jsonLd: object[],
  gaId: string,
): string {
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
    <meta property="og:image" content="${OG_IMAGE_URL}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="theme-color" content="#0d0d0d" />
    <style>${PAGE_CSS}</style>
    ${analyticsHead(gaId)}
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
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Guias',
      item: `${SITE_URL}/guias/`,
    },
    { '@type': 'ListItem', position: 3, name, item: `${SITE_URL}${path}` },
  ],
})

/** FAQPage JSON-LD for a guide's FAQ block. */
function faqJsonLd(faq: GuideFaq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
}

/**
 * Render one guide to a complete static HTML document. `gaId` is the GA4
 * measurement id; empty disables analytics and the cookie banner, as in the app.
 */
export function renderGuide(g: Guide, gaId = ''): string {
  const path = guidePath(g.slug)
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.description,
    inLanguage: 'pt-BR',
    datePublished: g.published,
    dateModified: g.updated,
    image: OG_IMAGE_URL,
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
  const faqHtml = g.faq?.length
    ? `<section class="faq"><h2>Perguntas frequentes</h2>\n${g.faq
        .map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`)
        .join('\n')}</section>`
    : ''
  const jsonLd: object[] = [breadcrumb(path, g.title), article]
  if (g.faq?.length) jsonLd.push(faqJsonLd(g.faq))
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
${head(path, g.title, g.description, jsonLd, gaId)}
  </head>
  <body>
    <div class="wrap">
      ${siteHeader(`guia_${g.slug}_header`)}
      <nav class="crumbs"><a href="/">Início</a> › <a href="/guias/">Guias</a> › ${escapeHtml(g.title)}</nav>
      <article>
        <h1>${escapeHtml(g.title)}</h1>
        <p class="intro">${escapeHtml(g.intro)}</p>
        ${sections}
        ${faqHtml}
      </article>
      <div class="cta">
        <strong>Pronto para começar?</strong>
        <p>Crie um bolão grátis e convide seus amigos em segundos.</p>
        <a class="btn" href="${loginHref(`guia_${g.slug}`)}">Criar meu bolão grátis</a>
      </div>
      ${relatedHtml}
      ${SITE_FOOTER}
    </div>
    ${consentBanner(gaId)}
  </body>
</html>
`
}

/** Render the /guias/ index that lists every guide. */
export function renderIndex(gaId = ''): string {
  const path = '/guias/'
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Início',
          item: `${SITE_URL}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Guias',
          item: `${SITE_URL}/guias/`,
        },
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
${head(path, 'Guias de bolão de futebol', 'Guias para organizar bolão de futebol online com amigos ou colegas de trabalho: regras de pontuação, Brasileirão, Copa do Mundo, planilha e dicas de palpite.', jsonLd, gaId)}
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
    ${consentBanner(gaId)}
  </body>
</html>
`
}

/**
 * Render /llms.txt (https://llmstxt.org): a Markdown summary of the site for
 * answer engines. The guide list comes from the catalog above, so a new guide
 * shows up here without touching this function. Text is PT-BR, like the site.
 */
export function renderLlmsTxt(): string {
  const guideLines = guides
    .map((g) => `- [${g.title}](${SITE_URL}${guidePath(g.slug)}): ${g.description}`)
    .join('\n')
  return `# Palpitae

> Palpitae é um app web gratuito de bolão de futebol entre amigos. Você cria um
> grupo privado, dá palpites de placar rodada a rodada e acompanha a
> classificação do grupo. Funciona no navegador do celular ou do computador,
> com login pela conta Google.

## Resumo

- O Palpitae é um app de bolão de futebol gratuito. Criar grupo, palpitar e ver a classificação não custa nada.
- O Palpitae não é casa de apostas. O app não recebe depósitos, não usa odds e não paga prêmios em dinheiro.
- Cada bolão é um grupo privado de até 50 pessoas, e só entra quem recebe o link ou o código de convite.
- O campeonato com jogos em andamento no Palpitae é o Brasileirão Série A 2026. A Copa do Mundo 2026 terminou, e os grupos dela mostram a classificação final.
- A pontuação padrão dá 3 pontos pelo placar exato e 1 ponto pelo resultado, e quem cria o grupo pode mudar esses valores.

## Campeonatos

- Brasileirão Série A 2026, em pontos corridos, com 20 times e 38 rodadas ao longo da temporada.
- Copa do Mundo 2026, encerrada. Os grupos criados para ela continuam com a classificação final.

## Como funciona

- Crie um grupo privado e convide amigos por link ou código.
- Dê seus palpites de placar até o horário de início de cada jogo.
- Os resultados entram automaticamente e a classificação do grupo é recalculada a cada partida.
- No mata-mata vale o placar ao fim da prorrogação, sem os gols da disputa de pênaltis.
- Em fases de jogo único decididas nos pênaltis, quem palpitou empate escolhe o vencedor da disputa e ganha um bônus se acertar. O bônus vale 1 ponto por padrão e pode ser ajustado de 0 a 10.

## Guias

${guideLines}

## Links

- [Site oficial](${SITE_URL}/): página inicial com apresentação e perguntas frequentes.
- [Guias de bolão](${SITE_URL}/guias/): índice de todos os guias.
- [Sitemap](${SITE_URL}/sitemap.xml): URLs públicas indexáveis.
- [robots.txt](${SITE_URL}/robots.txt): regras de rastreamento.

## Observações

- Páginas públicas indexáveis: \`/\` (página inicial) e \`/guias/*\` (guias de bolão).
- As telas de grupos, palpites e painel exigem login e não são indexáveis.
- Idioma: português do Brasil (pt-BR).
`
}

/**
 * Render the static 404 page. Cloudflare Pages serves /404.html (with a real 404
 * status) for any URL not matched by a static asset or a _redirects rule. It's
 * `noindex` so a crawler that lands on a stale link doesn't index an error page.
 */
function render404(): string {
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
    <style>${PAGE_CSS}
.not-found{padding:56px 0 0}</style>
  </head>
  <body>
    <div class="wrap">
      ${siteHeader('404_header')}
      <article class="not-found">
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
function guideHtmlFor(reqUrl: string, gaId: string): string | null {
  const path = (reqUrl.split('?')[0] || '').replace(/\/+$/, '') // strip query + trailing /
  if (path === '/guias') return renderIndex(gaId)
  const g = guides.find((g) => `/guias/${g.slug}` === path)
  return g ? renderGuide(g, gaId) : null
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
  // Same env var the SPA reads (src/config.ts). Vite loads .env.<mode> into
  // config.env, so production builds get the id and local dev stays GA-free.
  let gaId = ''
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if ((req.originalUrl ?? '').split('?')[0] === '/llms.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end(renderLlmsTxt())
      return
    }
    const html = guideHtmlFor(req.originalUrl ?? '', gaId)
    if (html === null) return next()
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  }
  return {
    name: 'palpitae-guides',
    configResolved(config) {
      gaId = normalizeGaId(String(config.env.VITE_GA_MEASUREMENT_ID ?? ''), (msg) =>
        config.logger.warn(msg),
      )
    },
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
        source: renderIndex(gaId),
      })
      for (const g of guides) {
        this.emitFile({
          type: 'asset',
          fileName: `guias/${g.slug}/index.html`,
          source: renderGuide(g, gaId),
        })
      }
      // /llms.txt lists every guide, so it is generated from the same catalog.
      this.emitFile({
        type: 'asset',
        fileName: 'llms.txt',
        source: renderLlmsTxt(),
      })
      // Static 404 page served by Cloudflare Pages for unmatched URLs.
      this.emitFile({
        type: 'asset',
        fileName: '404.html',
        source: render404(),
      })
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
function sitemapUrls(): { loc: string; lastmod: string; priority: string }[] {
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
