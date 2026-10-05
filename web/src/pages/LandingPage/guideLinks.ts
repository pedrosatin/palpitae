/**
 * Guias em destaque na landing. Os guias são HTML estático gerado por
 * `build/guides.ts` (fora do bundle do app), então a lista fica aqui e o teste
 * `build/guides.test.ts` confere que cada slug existe no catálogo.
 *
 * O `label` é o texto da âncora: usa o termo de busca que o guia mira.
 */
export interface LandingGuideLink {
  slug: string
  label: string
  description: string
}

export const LANDING_GUIDE_LINKS: LandingGuideLink[] = [
  {
    slug: 'bolao-do-brasileirao',
    label: 'Bolão do Brasileirão',
    description: 'Regras para 38 rodadas e trava de palpite por jogo.',
  },
  {
    slug: 'bolao-online-gratis',
    label: 'Bolão online grátis',
    description: 'Convite por link, palpite pelo celular e pontos calculados a cada jogo.',
  },
  {
    slug: 'como-organizar-um-bolao',
    label: 'Como organizar um bolão',
    description: 'Campeonato, regras de pontuação e convite da galera, em ordem.',
  },
  {
    slug: 'bolao-de-empresa',
    label: 'Bolão na empresa',
    description: 'Quem organiza, que regras usar e por que deixar o dinheiro de fora.',
  },
]
