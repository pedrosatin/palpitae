# Feedback sobre o salvamento de palpites

O piloto usa a [API da TBBC](https://tbbc.app/rating-widget/#api) com interface do Palpitae. A pergunta aparece na aba de palpites após a confirmação de pelo menos um salvamento individual ou em lote. A pessoa pode votar, acrescentar um comentário ou dispensar a pergunta. Ela não reabre durante a mesma montagem da aba. Voltar à aba permite uma nova avaliação.

## Ativação e desativação

1. Crie um inbox do Palpitae em [TBBC](https://tbbc.app/rating-widget/) e mantenha o acesso ao painel sob controle do operador. A chave pública de envio começa com `k_`; ela não substitui o acesso administrativo.
2. Para desenvolvimento, defina `VITE_TBBC_SITE_KEY=k_...` em `web/.env.local` e reinicie o Vite. O arquivo deve permanecer fora do Git. Use um inbox separado se for enviar avaliações de teste.
3. Para o deploy pelo GitHub Actions, configure a **variável de repositório** `VITE_TBBC_SITE_KEY`. O workflow de web passa essa variável ao build de validação e ao de produção. Ela é pública e aparece no JavaScript entregue ao navegador. Não coloque credenciais administrativas nessa variável.
4. Faça um novo build/deploy. A variável é resolvida durante a compilação, não em tempo de execução. Configurá-la somente no painel de build da Cloudflare Pages não afeta o build feito pelo GitHub Actions.
5. Para desativar, remova/esvazie a variável e gere um novo build/deploy. Sem chave, não há pergunta nem pedidos de feedback.

O frontend usa um inbox existente. Criar o inbox e configurar a variável de build são etapas de configuração; o recebimento no painel deve ser conferido após o deploy.

## Dados e privacidade

O aviso na interface informa que a TBBC recebe a resposta e pede que a pessoa não inclua dados pessoais no comentário. O piloto não solicita nome ou contato e não preenche dados da conta automaticamente.

O voto envia somente a chave pública do inbox, voto `1` ou `-1`, seção `predictions`, app `palpitae`, página genérica `/grupos/palpites` e idioma `pt-BR`. O comentário envia o texto escolhido pela pessoa e um `nonce` de idempotência vinculado ao ID do voto aceito. Não envia o caminho real, IDs de usuário/grupo, cookies, cabeçalhos de autenticação ou referer. A TBBC recebe a conexão diretamente do navegador, portanto continua recebendo metadados de rede, como o endereço IP.

Não há fila em `localStorage`, persistência de rascunhos ou script remoto. A CSP autoriza somente a conexão com `https://tbbc.app`; a lista de fontes de scripts e estilos permanece a mesma. Trocar de conta ou grupo remonta a aba e descarta o formulário anterior.

Antes da ativação pública, confirme com a TBBC as condições de acesso ao painel, retenção, exclusão e exportação das respostas. A ausência de coleta automática de identidade não impede alguém de escrever dados pessoais no campo livre.

## Falhas e validação

A interface só confirma envios depois de uma resposta válida da TBBC. Uma falha no feedback não altera os palpites já salvos. O voto não tem repetição automática; uma nova tentativa manual após perda da resposta pode duplicar um voto já recebido. O comentário usa o mesmo `nonce` ao repetir o mesmo envio para evitar duplicação, conforme o contrato da TBBC. Se o voto já foi aceito, a tentativa do comentário não envia outro voto.

As chamadas são canceladas ao desmontar o formulário e não atualizam telas posteriores. O cancelamento no navegador não desfaz um envio que o servidor já tenha recebido.

Validação local usa testes da interface e do contrato HTTP, typecheck, lint, build e `csp:verify`. Respostas simuladas nos testes verificam o comportamento do Palpitae; elas não comprovam aceitação pelo serviço externo. Recebimento real deve ser conferido no inbox correto depois da configuração, sem publicar feedback fictício no inbox de produção.
