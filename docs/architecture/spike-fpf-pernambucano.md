# Spike scraping FPF-PE (Campeonato Pernambucano)

## Objetivo

Este documento registra o resultado do spike que avaliou o site oficial da Federação Pernambucana de Futebol (FPF-PE) como fonte gratuita de fixtures e resultados do Campeonato Pernambucano Série A1, via scraping. O ticket 06 do plano Série B e regionais 2027 pede veredito GO (com desenho de parser e reuso plausível em FBF/Baiano e FCF/Cearense), GO restrito ou NO-GO. NO-GO encerra a linha de estaduais do Nordeste sem ticket de implementação. Este spike não altera produção: nenhum scraper, seed, provider, parser ou cadastro entra no repositório.

A temporada 2026 serve de proxy para planejar 2027. A pesquisa prévia em fontes gratuitas estruturadas (ESPN, football-data.org, TheSportsDB free) já classificou o Pernambucano como ausente ou incompleto nesses provedores.

## Método

Coleta ao vivo em 2026-10-24 (UTC), com `curl` e inspeção do DOM renderizado no navegador. Partiu-se da home oficial descoberta por link público (`https://www.fpf-pe.com.br/` → `/pt/home/`), depois `/pt/competicoes/`, e só então das páginas de jogos apontadas pelo próprio site. Não se assumiu URL de temporada a priori.

O HTML e os JSON brutos ficaram fora do Git em `~/.cache/palpitae-pernambucano-research/` (manifesto `manifest.json`, script descartável `probe-fpf-pe.sh`). Trechos mínimos de markup usados neste relatório estão citados abaixo.

## Fontes oficiais observadas

| Superfície | URL observada | HTTP | Papel |
| --- | --- | --- | --- |
| Home | `https://www.fpf-pe.com.br/` → `.../pt/home/` | 200 | Entrada; link para Competições |
| Lista de competições | `https://www.fpf-pe.com.br/pt/competicoes/` | 200 | Cards com `jogos.php?q=<idcampeonato>` |
| Shell A1 2026 | `https://www.fpf-pe.com.br/pt/competicoes/jogos.php?q=1651` | 200 | Nav de fases + containers vazios preenchidos por AJAX |
| Conteúdo editorial A1 | `https://www.fpf-pe.com.br/pt/conteudo/?q=100&sc=14` | 200 | Editais/PDFs; fora do feed de jogos |
| Jogos (AJAX) | `POST .../pt/competicoes/jogos_ajax_ver2.php` | 200 | JSON `{html, rodada}` com cards da fase |
| Classificação (AJAX) | `POST .../pt/competicoes/classificacao_ajax_ver2.php` | 200 | HTML de tabela por fase |
| Detalhe do jogo (AJAX) | `POST .../pt/competicoes/infoJogo.php` | 200 | HTML com nomes, data com ano, arbitragem, alteração de jogo, link de súmula |
| Página detalhe | `.../jogo.php?id=1651&jogo=<idjogo>` | 200 | Casca que chama `infoJogo.php` |
| REC A1 2026 | `.../assets/uploads/176499150263.pdf` | 200 | Regulamento específico (PDF) |
| RGC 2026 | `.../assets/uploads/176554842178.pdf` | 200 | Regulamento geral (PDF) |

Identificadores observados para o proxy 2026:

- `idcampeonato=1651` (Pernambucano A1 / 2026)
- Fases no nav: `3798` Primeira Fase, `3799` Fase Eliminatória, `3800` Semifinais, `3801` Final
- Jogos amostrados: final `51836`/`51837`; semifinais `51501` a `51504`
- Escudos usam ID CBF em `https://conteudo.cbf.com.br/clubes/<id>/escudo.jpg`

O parâmetro `rodada` no POST de jogos não fatia o retorno: para uma mesma fase o HTML veio idêntico em `rodada=1..10`. O campo `rodada` do JSON indica o slide inicial do carrossel (ex.: `6` na primeira fase com 7 rodadas).

### Nav de fases (shell)

```html
<a class="nav-link fase " ... data-id="1651" data-fase="3798" data-rodada="2" href="javascript:;">Primeira Fase</a>
<a class="nav-link fase " ... data-id="1651" data-fase="3799" data-rodada="2" href="javascript:;">Fase Eliminatória</a>
<a class="nav-link fase " ... data-id="1651" data-fase="3800" data-rodada="2" href="javascript:;">Semifinais</a>
<a class="nav-link fase active" ... data-id="1651" data-fase="3801" data-rodada="2" href="javascript:;">Final</a>
```

### Card de jogo (HTML dentro de `jogos_ajax_ver2.php`)

Trecho da final, 1ª rodada (ida), sem nome de time no card; só escudo CBF, cronologia local e placar em spans:

```html
<div class="py-3 mb-1 title-rodada">1ª Rodada</div>
<div class="py-3 px-2 position-relative pr-jogos">
  <span class="... cronolog-sm ...">DOM, 01/03 - 18h00 - Ilha do Retiro</span>
  ...
  <img src="https://conteudo.cbf.com.br/clubes/20010/escudo.jpg" ...>
  <span class="text-end">3</span><span class="versus ...">X</span><span class="text-start">3</span>
  <img src="https://conteudo.cbf.com.br/clubes/20023/escudo.jpg" ...>
  <a href="jogo.php?id=1651&jogo=51836">sobre o jogo</a>
```

Volumes observados no AJAX de jogos (2026): primeira fase 28 jogos / 7 rodadas; eliminatória 4; semifinais 4; final 2. Bate com a tabela do REC (28+4+4+2).

### Detalhe `infoJogo.php`

O detalhe acrescenta o que o card omite: nomes dos clubes, data com ano (`Quarta, 11/02/2026 - 20:00`), estádio, arbitragem, documentos (súmula CBF em PDF) e, quando existe, bloco **Alteração de Jogo** (data/hora/estádio originais × alterados e motivo). Exemplo em `idjogo=51501`: horário de 19:00 para 20:00 e estádio de José do Rêgo Maciel para Arena Pernambuco. Nenhum campo de pênaltis, status enumerado, fuso ou classificado apareceu nas amostras de detalhe.

## Classificação dos campos exigidos

| Requisito Palpitae | Classificação | Evidência |
| --- | --- | --- |
| Data e hora | Presente só em texto | Card: `DOM, 01/03 - 18h00` (sem ano). Detalhe: `11/02/2026 - 20:00`. Sem ISO, sem offset, sem nome de fuso |
| Fuso / UTC | Ausente | Regulamento e HTML não publicam timezone. Conversão exigiria hipótese operacional (ex.: `America/Recife`) fora do feed |
| Times (nome) | Presente só em texto no detalhe; ausente no card de lista | Nomes em `infoJogo` e na classificação; card de jogos só mostra escudo |
| IDs de time | Presente estruturado (indireto) | Path do escudo CBF `/clubes/<id>/`. Estável na amostra 2026; contrato não documentado pela FPF |
| ID de jogo | Presente estruturado | Query `jogo=<id>` e POST `idjogo` |
| Placar | Presente estruturado no HTML | Spans `text-end` / `text-start` em torno de `X` |
| Status do jogo (agendado/ao vivo/encerrado) | Ausente | Sem enum. Inferência frágil por placar preenchido |
| Fase | Presente estruturado na navegação / request | `data-fase` + rótulo textual; POST usa `idfase` |
| Rodada | Presente só em texto | `title-rodada` (`1ª Rodada`…). No mata-mata o mesmo rótulo cobre ida/volta |
| Pênaltis | Ausente no HTML observado | REC manda pênaltis como 2º critério após saldo nos confrontos de mata-mata; nenhuma amostra 2026 exibiu `shootout`/placar de pênaltis no card ou no `infoJogo` |
| Ida / volta | Presente só em texto / inferível | REC: eliminatória, semi e final em ida e volta. Feed usa `1ª/2ª Rodada` sem `leg` |
| Classificado / vencedor de chave | Ausente | Sem `winner`/`series`. Classificação por fase mostra tabela de pontos (até “GRUPO F” na final), insuficiente para marcar avançado |
| Adiados / alteração de calendário | Presente só em texto no detalhe | Bloco “Alteração de Jogo” no `infoJogo` quando há IMT. Card pode mostrar ícone `bi-info-circle` sem payload estruturado |
| TBD / sem horário | Não observado na amostra | Todos os 38 jogos do AJAX tinham dia e `hhmm` no cronolog |
| Calendário completo da temporada | Presente via varredura de fases | Um POST por `idfase` devolve todos os jogos da fase |

Custo de acesso: zero (páginas públicas, sem chave). Não há API JSON de objetos de partida; o “endpoint” devolve fragmento HTML dentro de JSON (`jogos`) ou HTML puro (`classificacao`, `infoJogo`).

## Desenho de parser (somente análise)

Um parser de produto, se viesse a existir, teria que:

1. Descobrir `idcampeonato` do ano em `/pt/competicoes/` (o `q=` muda por temporada; 1651 é só 2026).
2. Ler o shell `jogos.php?q=…` e extrair pares `(idfase, rótulo)`.
3. Para cada fase, `POST jogos_ajax_ver2.php` e parsear cards (idjogo, ids CBF do escudo, placar, cronolog, title-rodada).
4. Para cada idjogo, `POST infoJogo.php` para nomes, data com ano e alterações.
5. Montar kickoff com fuso assumido; mapear CBF id → time interno; inferir encerrado pelo placar; tratar ida/volta por ordem de rodada dentro da fase de mata-mata.

Isso são duas famílias de request por sincronização completa (lista por fase + N detalhes), dependentes de classes CSS (`cronolog-sm`, `title-rodada`, `text-end`/`versus`/`text-start`) e de paths PHP sem contrato. O desenho existe como evidência de esforço; o veredito abaixo não o autoriza.

## Comparação com FBF (Baiano) e FCF (Cearense)

Reuso de parser exige o mesmo contrato de página ou o mesmo shape de AJAX. A amostragem de 2026-10-24 mostra stacks distintos:

| Federação | Entrada observada | Stack / padrão | Relação com FPF-PE |
| --- | --- | --- | --- |
| FPF-PE | `fpf-pe.com.br/pt/competicoes/jogos.php` + `*_ajax_ver2.php` | PHP + jQuery; HTML em JSON | Referência deste spike |
| FBF | `fbf.org.br` (Laravel/CSRF); ` /competicoes/<n>` 200; `/competicoes` lista genérica **HTTP 500** no teste; `/jogo/detalhes/<n>` 200 | Rotas REST-like próprias; CSS de pênaltis no detalhe (`detail-penalty-*`); sem `jogos_ajax_ver2.php` | Markup e rotas incompatíveis com o parser PE |
| FCF | `futebolcearense.com.br/2023/homepage.asp` e `campeonatos.asp` 200; `tabela.asp`/`jogos.asp` **404** | Shell ASP/IIS; no JS do HTML em cache (`fcf-home.html`, `fcf-campeonatos.html`), `api/v2/?route=` com `games-byRound`, `phases`, `championships` e `classifications` (descoberta estática; HTTP/JSON desses routes não exercitado neste ticket) | Stack e contrato distintos do AJAX PHP da PE; o parser PE não cobre FCF. A `api/v2` observada ficou fora do gate deste spike |

Não há padrão compartilhado de IDs, POST body ou fragmentos HTML entre FPF-PE, FBF e FCF. Baiano e Cearense exigiriam spikes e parsers próprios. O critério de GO completo do ticket (reuso plausível BA/CE) não se sustenta. A presença de `api/v2` no JS da FCF não altera esse critério: este ticket não avaliou essa API como fonte candidata.

## Manutenção e risco de quebra

Estimativa qualitativa (hipóteses explícitas; sem horas inventadas).

Por temporada, o site exige novo `idcampeonato` e novos `idfase` no nav, com conferência manual ou descoberta no shell. Hipótese: mudança anual certa desses inteiros, porque 2026 já usa 1651 e 3798 a 3801.

No meio do campeonato, o risco de quebra silenciosa é alto se a FPF renomear `jogos_ajax_ver2.php`, alterar classes do card ou omitir placar/escudo. Hipótese: site editorial sem versionamento público de API; um redesign ou “ver3” invalida seletores.

Pênaltis e classificado continuariam dependentes de súmula PDF, regulamento ou inferência. Hipótese: lacuna permanente no HTML enquanto o layout atual prevalecer.

Na operação, o poller precisaria de N+1 requests HTML por ciclo (fases + detalhes tocados), com parsing não tipado. Hipótese: custo de CPU/IO e flakiness maiores que o sync ESPN JSON já adotado no projeto.

## Veredito

| Escopo | Veredito |
| --- | --- |
| Scraping FPF-PE como fonte Palpitae para Pernambucano e porta de entrada dos estaduais NE | **NO-GO** |

Motivos objetivos:

1. O feed útil é HTML não contratado atrás de POST PHP, não um JSON de partidas.
2. Faltam no markup campos que o produto já exige em competições de mata-mata via ESPN: fuso/UTC, pênaltis estruturados, perna/série/classificado e status explícito.
3. FBF e FCF não compartilham o padrão FPF-PE; o GO com reuso BA/CE é inviável com a evidência atual.
4. O custo de manutenção por temporada e o risco de quebra no meio do estadual são altos para um site sem SLA de dados.

Consequência conforme o ticket 06 e a spec do lote 2027: a linha de estaduais do Nordeste (Baiano, Pernambucano, Cearense) via scraping de federação encerra aqui. Não se abre ticket de implementação de scraper. O representante NE do lote permanece a Copa do Nordeste via ESPN, já coberta por outra frente.

GO restrito (só PE, aceitando fuso assumido e sem pênaltis no feed) foi considerado e rejeitado: o gate do plano é reuso mantível entre federações, e as lacunas de mata-mata quebram o modelo de palpite já usado nas copas.

## Limites desta investigação

- Amostra concentrada no A1 masculino 2026 já encerrado (proxy). Temporada 2027 ainda não tinha shell equivalente no momento da coleta.
- Nenhuma partida observada exibiu disputa de pênaltis no HTML; a lacuna de campo permanece mesmo com o REC a prever pênaltis.
- Uma navegação falhou por timeout. O DOM renderizado e as respostas HTTP dos mesmos endpoints foram conferidos separadamente.
- FBF `/competicoes` (lista) respondeu 500; páginas `/competicoes/1` e `/competicoes/2` responderam 200. Página inacessível não foi tratada como fonte inexistente.
- ToS de reuso automatizado das federações não foi litigio neste spike; o veredito já cai por contrato de dados e reuso técnico.

## Reprodução

```bash
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

curl -sS -L -A "$UA" -o competicoes.html -w '%{http_code} %{url_effective}\n' \
  'https://www.fpf-pe.com.br/pt/competicoes/'

curl -sS -L -A "$UA" -o jogos-shell.html -w '%{http_code}\n' \
  'https://www.fpf-pe.com.br/pt/competicoes/jogos.php?q=1651'

curl -sS -A "$UA" -X POST \
  'https://www.fpf-pe.com.br/pt/competicoes/jogos_ajax_ver2.php' \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data 'idcampeonato=1651&idfase=3798&rodada=1' \
  -o ajax-primeira.json -w '%{http_code} %{size_download}\n'

curl -sS -A "$UA" -X POST \
  'https://www.fpf-pe.com.br/pt/competicoes/infoJogo.php' \
  -H 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8' \
  -H 'X-Requested-With: XMLHttpRequest' \
  --data 'idjogo=51836' \
  -o infoJogo-51836.html -w '%{http_code} %{size_download}\n'
```

Script descartável equivalente: `~/.cache/palpitae-pernambucano-research/probe-fpf-pe.sh`.
