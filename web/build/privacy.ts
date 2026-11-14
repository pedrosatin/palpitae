/**
 * Texto da página pública /privacidade, gerada no build como os guias
 * (renderPrivacy em build/guides.ts).
 *
 * Cada afirmação aponta para um campo, evento ou serviço do código. Ao mudar o
 * que o Palpitae coleta, revise esta página e o campo `updated`.
 *
 * Dado que dependa do operador entra como marcador "A CONFIRMAR", que o teste em
 * guides.test.ts barra antes da publicação.
 */

export interface PrivacySection {
  heading: string
  /** Parágrafos, renderizados como <p>. Texto puro. */
  body: string[]
}

export interface PrivacyPolicy {
  title: string
  /** <meta name="description"> e descrição do OG. */
  description: string
  intro: string
  /** Data ISO (YYYY-MM-DD) da última mudança no texto: <lastmod> do sitemap. */
  updated: string
  sections: PrivacySection[]
}

/** Caminho público, sem barra final: o build grava privacidade.html. */
export const PRIVACY_PATH = '/privacidade'

/** Marcador de dado que o operador ainda precisa informar. */
export const PENDING_MARKER = /A CONFIRMAR/

const CONTATO = 'privacidade@palpitae.com.br'

export const privacyPolicy: PrivacyPolicy = {
  title: 'Política de privacidade',
  description:
    'Quais dados o Palpitae trata, para que servem, com quem são compartilhados, por quanto tempo ficam guardados e como pedir acesso ou exclusão pela LGPD.',
  intro:
    'Esta página explica quais dados o Palpitae trata, para que servem, com quem são compartilhados, por quanto tempo ficam guardados e como exercer os direitos previstos na Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).',
  updated: '2026-11-14',
  sections: [
    {
      heading: 'Responsável e contato',
      body: [
        'O Palpitae é o responsável pelo tratamento dos dados descritos nesta página.',
        `Para dúvidas sobre privacidade e pedidos sobre os seus dados, escreva para ${CONTATO}.`,
      ],
    },
    {
      heading: 'Dados da conta',
      body: [
        'O login usa a conta Google. Ao entrar, o Google envia ao Palpitae o seu e-mail, o seu nome, a sua foto de perfil e um identificador da sua conta Google. O Palpitae guarda esses dados, a data de criação da conta e a data do último login.',
        'O Palpitae também guarda os grupos que você cria ou em que entra, os seus palpites e a sua pontuação. Quando o dono de um grupo remove ou bloqueia um participante, o bloqueio fica registrado no grupo.',
        'O seu nome, a sua foto, os seus palpites e a sua pontuação aparecem para os participantes dos grupos em que você está. Conforme a regra do grupo, os palpites aparecem para os outros na hora ou só depois do início do jogo.',
        'Finalidade: identificar você, manter a sua conta e fazer o bolão funcionar. Base legal: execução do contrato de uso do serviço (art. 7º, V, da LGPD).',
      ],
    },
    {
      heading: 'Sessão e segurança',
      body: [
        'Depois do login, um cookie de sessão mantém você conectado por até 30 dias. A opção Sair de todos os dispositivos, em Configurações, encerra todas as sessões abertas.',
        'Para conter abuso, a API conta as requisições de cada conta ou endereço IP. A contagem guarda um código calculado com uma chave secreta, sem o endereço IP em si, e cada contagem expira em até um dia.',
        'Finalidade: manter você conectado e proteger o serviço contra abuso. Base legal: execução do contrato para a sessão e legítimo interesse para a proteção contra abuso (art. 7º, V e IX).',
      ],
    },
    {
      heading: 'Dados de uso e medição',
      body: [
        'Eventos do servidor: a API registra eventos como login, palpite salvo, grupo criado, entrada em grupo e envio de lembrete, para contar o uso e acompanhar falhas. Esses eventos ficam no Cloudflare Analytics Engine, com cópia diária no Cloudflare R2. Eles não levam e-mail, nome nem o identificador da conta. Quando um evento precisa ligar ações da mesma pessoa, ele usa um pseudônimo calculado a partir do identificador interno da conta. Alguns eventos levam o identificador do grupo.',
        'A abertura de um link de convite é contada sem nenhum dado do convite ou de quem abriu. A origem de um cadastro novo, como o guia que trouxe a pessoa, é registrada em categorias, sem identificar quem se cadastrou.',
        'Cloudflare Web Analytics: conta as visitas às páginas sem cookies e sem identificar quem visita.',
        'Google Analytics 4: mede as páginas visitadas e os cliques em botões do site. O Google recebe a página (endereço e título), a página de origem, os parâmetros de campanha do endereço, como utm_*, from, tab e, quando presente, o gclid, e dados do navegador e do aparelho, como tipo de aparelho e navegador, além do endereço IP da conexão. Nos guias, páginas estáticas, o endereço completo da página vai sem filtro. O Palpitae não envia ao Google Analytics o seu e-mail, o seu nome nem o identificador da sua conta.',
        'Antes da sua escolha no aviso de cookies, o Google Analytics funciona sem cookies de Analytics e sem identificador persistente do navegador. Nessa fase ele recebe pings sem cookies com os dados de navegação acima, a hora, o User-Agent do navegador e um número aleatório gerado a cada carregamento da página. Com o aceite, ele grava cookies que reconhecem o navegador entre visitas. Com a recusa, ele fica desligado e nada é enviado.',
        'Finalidade: entender o uso do site, encontrar falhas e melhorar o Palpitae. Base legal: legítimo interesse para os eventos do servidor e o Cloudflare Web Analytics (art. 7º, IX). Para o Google Analytics, consentimento (art. 7º, I) para os cookies e legítimo interesse (art. 7º, IX) para os pings sem cookies enviados antes da escolha.',
      ],
    },
    {
      heading: 'Lembretes por e-mail e descadastro',
      body: [
        'Na manhã de um dia com jogo sem o seu palpite, o Palpitae envia um e-mail com os jogos pendentes de cada grupo. O envio passa pela Resend, que recebe o seu endereço de e-mail e o conteúdo da mensagem.',
        'A Resend recebe também um identificador interno da sua conta. Ele vai no cabeçalho de controle de repetição do envio (idempotência), junto com a data, e no link de cancelamento de cada e-mail. No link, o identificador está codificado em base64url e assinado, sem prazo de validade. A codificação não esconde o identificador: quem tem o e-mail consegue lê-lo.',
        'Cada e-mail tem um link para cancelar os lembretes. Também dá para desligar e religar os lembretes em Configurações. O Palpitae guarda a data do cancelamento e, por 7 dias, o registro de cada envio, para não repetir o lembrete no mesmo dia.',
        'Finalidade: avisar sobre palpites pendentes. Base legal: legítimo interesse (art. 7º, IX), com cancelamento a qualquer momento.',
      ],
    },
    {
      heading: 'Compartilhamento com terceiros',
      body: [
        'O Palpitae não vende dados pessoais. Os serviços abaixo recebem dados para o site funcionar e podem tratá-los fora do Brasil.',
        'Google: login com a conta Google e Google Analytics, nas condições descritas acima. As fotos de perfil são carregadas dos servidores do Google.',
        'Cloudflare: hospedagem do site e da API, banco de dados, eventos de uso e contagem de visitas. Passam pela Cloudflare os dados que o site e a API do Palpitae tratam. Vão direto do seu navegador para o destino, sem passar pela API do Palpitae, a resposta à pergunta sobre o salvamento de palpites (TBBC), as medições do Google Analytics e as imagens de fotos de perfil e escudos de times.',
        'Resend: envio dos lembretes por e-mail. Recebe o seu e-mail, o conteúdo da mensagem e o identificador interno da conta, no cabeçalho de idempotência e no link de cancelamento.',
        'TBBC: recebe as respostas da pergunta opcional sobre o salvamento de palpites, quando você responde. A resposta vai sem nome, e-mail ou identificador da conta. A TBBC recebe a conexão direta do seu navegador, com o endereço IP. Não escreva dados pessoais no comentário.',
        'Os escudos dos times vêm dos servidores da football-data.org e da ESPN, que recebem a conexão do seu navegador.',
      ],
    },
    {
      heading: 'Retenção',
      body: [
        'Dados da conta, grupos e palpites: enquanto a conta existir. Depois de um pedido de exclusão, são apagados em até 30 dias.',
        'Cookie de sessão: até 30 dias, ou até você sair. Cookies temporários do login: 5 minutos.',
        'Registro de envio de lembretes: 7 dias. Contagens de requisições: até um dia.',
        'Registros técnicos do servidor, usados para investigar falhas: 3 dias.',
        'Rascunhos de palpite no navegador: 7 dias, ou até você sair da conta. Ficam só no seu aparelho.',
        `Eventos de uso no Cloudflare Analytics Engine: cerca de 3 meses. Cópia diária no Cloudflare R2: 13 meses.`,
        'Google Analytics: 14 meses. Na Resend e na TBBC valem os prazos de cada serviço.',
      ],
    },
    {
      heading: 'Cookies e escolhas de medição',
      body: [
        'session: mantém o login por até 30 dias. Sem ele não dá para usar a conta.',
        'oauth_state, oauth_nonce, oauth_verifier, oauth_redirect e oauth_origin: protegem o login com o Google, guardam a página de destino e a origem do cadastro, e duram 5 minutos.',
        '_ga e _ga_*: cookies do Google Analytics, gravados só depois do aceite.',
        'O armazenamento local do navegador guarda a sua escolha sobre o Google Analytics, a marca de que este aparelho já teve uma sessão e a preferência de copiar palpites entre grupos. O armazenamento da aba, apagado quando ela fecha, guarda dados temporários do login, do convite aberto e da página de origem da visita.',
        'Rascunhos de palpite: o armazenamento local guarda os placares e as escolhas de vencedor nos pênaltis que você digitou e ainda não salvou, com a hora da digitação e o valor salvo antes. Cada rascunho fica numa chave com o identificador interno da sua conta e o do grupo, só no seu navegador, e não é enviado ao Palpitae até você salvar o palpite. A finalidade é não perder o que foi digitado ao recarregar a página. Rascunhos com mais de 7 dias deixam de valer e são removidos na próxima vez que a aba Palpitar do grupo abre. Nenhum temporizador os apaga no sétimo dia. Ao usar Sair ou Sair de todos os dispositivos, o Palpitae apaga os rascunhos de todas as contas e grupos deste navegador. Quando a sessão expira sem você sair, os rascunhos ficam para você recuperar ao entrar de novo.',
        'O aviso de cookies aparece até você escolher. Aceitar libera os cookies do Google Analytics. Recusar desliga o Google Analytics e apaga os cookies dele, e o aviso volta depois de 30 dias. Para mudar a escolha, use o botão Preferências de cookies no fim da página.',
      ],
    },
    {
      heading: 'Seus direitos e como exercê-los',
      body: [
        'Pela LGPD (art. 18), você pode pedir a confirmação de que tratamos os seus dados, o acesso a eles, a correção de dados incompletos ou errados, a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei, a portabilidade, a eliminação dos dados tratados com o seu consentimento, a lista de com quem compartilhamos os dados e a revogação do consentimento.',
        `Para fazer um pedido, escreva para ${CONTATO} a partir do e-mail da sua conta. O site não tem botão para excluir a conta. Para excluir, peça por e-mail.`,
        'No próprio site, você pode revogar o aceite do Google Analytics pelo botão Preferências de cookies, cancelar os lembretes pelo link do e-mail ou em Configurações e encerrar as sessões com Sair de todos os dispositivos.',
        'Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
      ],
    },
    {
      heading: 'Mudanças nesta página',
      body: [
        'Quando o Palpitae passar a tratar dados de outro jeito, esta página muda junto, com nova data de atualização.',
      ],
    },
  ],
}
