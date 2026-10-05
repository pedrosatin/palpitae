/**
 * Guias em destaque na landing. Os guias são HTML estático gerado por
 * `build/guides.ts` (fora do bundle do app), então a lista fica aqui e o teste
 * `build/guides.test.ts` confere que cada slug existe no catálogo.
 *
 * O `label` é o texto da âncora e repete o termo de busca do guia.
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
    description: 'Crie o grupo, mande o link e palpite pelo celular.',
  },
  {
    slug: 'como-organizar-um-bolao',
    label: 'Como organizar um bolão',
    description: 'Passo a passo para escolher o campeonato e a pontuação.',
  },
  {
    slug: 'bolao-de-empresa',
    label: 'Bolão na empresa',
    description: 'Prêmio simbólico em vez de dinheiro, e um grupo por área.',
  },
]
