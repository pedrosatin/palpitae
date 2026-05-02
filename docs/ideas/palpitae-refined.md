# Palpitae — Grupos Privados de Previsão de Futebol

## Problem Statement

**How Might We** criar uma plataforma escalável para torcedores casuais brasileiros competirem com amigos através de previsões de futebol, gerando engagement semanal durante campeonatos (Copa 2026, Brasileirão, Libertadores), sem depender de apostas, mantendo custos de infra mínimos?

---

## Recommended Direction

**Direção A: Grupos Privados com Arquitetura Componentizada**

Plataforma que permite:

- Criar grupos privados (5-50 users) por campeonato
- Competir **pela rodada completa** (não match-by-match)
- Acumular score e histórico persistente
- Estender para N competições sem duplicação de código (adapter pattern para múltiplos providers)

**Por quê:**

1. **Prova de conceito em produção:** `bolao.pedrosatin.com` (Brasileirão) já valida interesse de usuários
2. **Simples o suficiente para MVP:** Grupos privados, sem algoritmos complexos
3. **Engagement semanal natural:** Amigos competem durante rodada, FOMO funciona sem notificações
4. **Timing perfeito:** Copa 2026 = pico de interesse
5. **Infra viável:** Cloudflare free tier + múltiplos providers como fallback
6. **Escalável:** Arquitetura componentizada (adapter pattern) pronta para Brasileirão, Libertadores, Premier League

**Roadmap:**

- **MVP (Sprint 0-8):** Direção A pura + Copa 2026 + Brasileirão 2026 (refactor bolao.pedrosatin.com)
- **V1.1 (Q3/Q4 2026):** Multi-competição simultânea + anti-abuse strategy
- **V2 (2027):** Públicas efêmeras (Direção B) + Comunidades de torcedores

---

## Key Assumptions to Validate

### ✅ Validado

- [ ] **Social > Betting** — Brasileiros casuais preferem previsão social. _Status:_ VALIDADO com `bolao.pedrosatin.com`. _Action:_ Use grupo existente como early adopters

### ⚠️ Parcialmente Validado

- [ ] **API Football confiável** — Dados chegam com latência aceitável, zero duplicatas. _Status:_ Funciona mas sofre com rate limiting. _Action:_
  - [ ] Teste SofaScore + ESPN em paralelo (semana 1)
  - [ ] Implemente adapter pattern (trocar provider sem quebrar)
  - [ ] Fallback automático (se um cai, outro sobe)
  - [ ] Cache robusto + rate limiting inteligente (Sprint 0)

### ⚠️ Corrigido

- [ ] **Engagement diário sustentável** → ~~Diário~~ **SEMANAL**. Futebol é QUA/QUI/SAB/DOM. _Status:_ Atualizado. _Action:_ Expectativa = 2-3 acessos por semana durante rodada. Notificações são feature futura, não core.

### ✅ Alta Confiança

- [ ] **Componentização escalável** — 5+ competições rodando simultâneas. _Status:_ MVP prova com Brasileirão. _Action:_ Design doc com adapter pattern

### ⚠️ Nova Strategy Necessária

- [ ] **Unit economics viáveis** — 1R$/user (min 5) sustenta infra. _Status:_ Cloudflare free hoje, mas precisa anti-abuse. _Action:_
  - [ ] Email verification obrigatória (prevent spam)
  - [ ] Max 3 grupos grátis por email
  - [ ] Google identity como proxy (hard to spam)
  - [ ] Invite-only free tier (admin invita, não create direto)
  - [ ] Ou: Delayed payment (3 dias trial, depois cobra)

---

## MVP Scope

### ✅ In Scope

- Google OAuth
- 2 competições: **Copa 2026** + **Brasileirão 2026**
- Criar/gerenciar grupos (5-50 users)
- Invite via link público
- Previsão simples: score exato (ex: 2x1)
- Scoring: 3pts (exato) + 1pt (resultado) + 0pt (errado)
- Ranking materializado (atualizado quando match finaliza)
- Histórico de rodadas + score acumulado
- **Payment:** Admin paga 1R$ por user (min 5 = 5R$), OR free tier até 5 pessoas
- Multi-provider adapter (API Football + fallback)
- Admin panel (manual sync, override, debugging)

### ❌ Out of Scope (Por quê)

- Multi-competição simultânea (5+) — Valida em V1.1 após MVP
- Comunidades públicas — Precisa de escala + volume crítico (V2)
- Push notifications — Feature futura; FOMO natural é suficiente
- Scoring customizável — Sem use case claro
- Live predictions — Diferencia em direção a betting
- SMS verification — Complexidade + custo; email é suficiente
- Múltiplas ligas europeias — Focus Brasileiro/Sul-americano; Premier em V1.1

---

## Not Doing (and Why)

- **Betting/Dinheiro em previsões** — Muda positioning, regulatória complexa, não é o diferencial
- **One-match-per-day desafios** — Precisa de seeding de usuários; MVP focado em grupos privados
- **Multi-esporte inicialmente** — Futebol sustenta produto; esportes novos → novos domains (nba.palpitae.com, etc)
- **Social trading / Reputação de experts** — Feature futura; precisa escala primeiro
- **Live ranking durante match** — Betting mindset; previsão é sobre antecipação, não especulação real-time
- **Push notifications como core engagement** — Engagement semanal é natural; notifications são "nice-to-have"

---

## Anti-Abuse Strategy (MVP)

**Problema:** Infinitas contas para criar grupos grátis.

**Solução (escolha 1-2):**

1. **Email verification obrigatória** — Free tier só se email verificado
2. **Max N grupos por pessoa** — 3 grupos grátis max, depois paga
3. **Invite-only para free** — Não pode criar direto; admin invita
4. **Delayed payment** — Grupo fica em trial 3 dias, depois cobra ao primeiro user pago

**Recomendação:** Combinar 1 + 2 (simples, eficaz, sem SMS).

---

## Open Questions

1. **Qual provider usar como primary?** API Football + SofaScore fallback, ou outra?
2. **Match reschedules:** Como lidar com reprogramações (comum Brasileiro)?
3. **Preço final:** 1R$/user é definitivo, ou testar 2R$ ou modelo de assinatura mensal?
4. **Timeline:** Quanto tempo prototipo funcional? Quando launch MVP?
5. **Refactor bolao.pedrosatin.com:** Quanto esforço migrar para arquitetura Palpitae?

---

## Success Metrics (Validação)

Para MVP ser considerado bem-sucedido:

- [ ] 3+ grupos ativos com +5 users cada
- [ ] Engagement semanal: 60%+ return rate durante rodada
- [ ] Zero drops de dados (sync confiável)
- [ ] API fallback funciona 1x+ sem quebra
- [ ] <2% taxa de abuse (spam de contas)

---

## Next Steps

1. **Sprint 0 (Infrastructure):**
   - [ ] Teste SofaScore, ESPN, outros providers
   - [ ] Design adapter pattern (multi-provider)
   - [ ] Anti-abuse strategy selection
   - [ ] TCO calculation (realmente 0 custo?)

2. **Sprint 1-2 (MVP Build):**
   - [ ] Refactor bolao.pedrosatin.com para nova arquitetura
   - [ ] Adicione segunda competição (Copa 2026)
   - [ ] Payment integration

3. **Sprint 3-4 (Validation):**
   - [ ] Invite early adopters (seu grupo + amigos)
   - [ ] Measure engagement, retention, abuse rate
   - [ ] Iterate pricing/anti-abuse
