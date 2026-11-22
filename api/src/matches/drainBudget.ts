import type { D1Database } from '@cloudflare/workers-types'
import { interceptD1 } from '../d1Intercept'
import {
  callsLeft,
  CallBudgetExhaustedError,
  countD1Calls,
  INVOCATION_CALL_LIMIT,
  type CallBudget,
  type CallGate,
} from './callBudget'

/**
 * Orçamento de subrequests do ramo drenador do `scheduled` (ADR-027, adendo
 * "subrequests do dreno").
 *
 * No plano Free a invocação faz no máximo 50 subrequests: cada consulta ao D1,
 * cada `db.batch()` e cada `fetch` conta uma. O ramo drenador gasta no máximo
 * `DRAIN_CALL_BUDGET`; as `DRAIN_RESERVED_CALLS` restantes cobrem a limpeza de
 * registros expirados que o `scheduled` dispara na mesma invocação e a folga,
 * como no poller (`POLLER_CALL_BUDGET`).
 */
export const DRAIN_RESERVED_CALLS = 5
export const DRAIN_CALL_BUDGET = INVOCATION_CALL_LIMIT - DRAIN_RESERVED_CALLS

/** Reclamar os itens do ciclo: um `UPDATE ... RETURNING`. */
export const CLAIM_CALLS = 1

/**
 * Gravar o estado dos itens do ciclo (concluído, devolvido ou liberado): um único
 * `db.batch()`, qualquer que seja o número de itens.
 */
export const SETTLE_CALLS = 1

/**
 * Recuperação da gravação do estado quando o próprio D1 falha: uma nova tentativa
 * do batch (1) e, se ela falhar também, uma liberação mínima (1), um único
 * `UPDATE` que devolve a `pending` os itens do ciclo, sem tentativa e sem lease.
 */
export const SETTLE_RECOVERY_CALLS = 2

/**
 * O que fica reservado, desde o início do ciclo, para gravar o estado e recuperar
 * essa gravação. O trabalho dos itens nunca toca nesta reserva, então nenhum item
 * é abandonado `running` por falta de chamada. Só a indisponibilidade persistente
 * do D1, que recusa até a liberação, deixa itens `running` até o lease de 5 min.
 */
export const STATE_RESERVE_CALLS = SETTLE_CALLS + SETTLE_RECOVERY_CALLS

/** Custo fixo de um ciclo do dreno, antes de qualquer item: a reclamação e a reserva do estado. */
export const CYCLE_FIXED_CALLS = CLAIM_CALLS + STATE_RESERVE_CALLS

/**
 * Fatia do saldo de um dreno. O coordenador (`drainCoordinator.ts`) cria uma por
 * dreno, e a soma dos `limit` nunca passa de `DRAIN_CALL_BUDGET`: cada dreno
 * confere só a própria fatia, e o total fica garantido sem estado compartilhado.
 *
 * `db` serve ao ciclo do dreno (reclamar e gravar o estado): só conta. O trabalho
 * de cada item passa por `open`, que reserva a estimativa dele antes de começar e
 * entrega um D1 e um `fetch` que recusam, sem chamar, o que invadiria a reserva
 * do estado.
 *
 * O poller usa a mesma fatia para o saldo da ESPN no tick (ADR-027, adendo do
 * ticket 03): `reserve` é o que fica de fora do trabalho dos itens (as sincronizações
 * por competição), para o `db` do ciclo (o enfileiramento do que não coube) sempre
 * caber. O dreno usa a reserva do estado, que é o padrão.
 */
export class DrainBudget {
  private readonly budget: CallBudget
  private readonly inFlight = new Set<ItemBudget>()
  private waiters: (() => void)[] = []
  /** D1 do ciclo do dreno: conta cada chamada na fatia, sem recusar. */
  readonly db: D1Database

  constructor(
    readonly rawDb: D1Database,
    limit: number,
    private readonly reserve = STATE_RESERVE_CALLS,
  ) {
    this.budget = { limit, used: 0 }
    this.db = countD1Calls(rawDb, this.budget)
  }

  get limit(): number {
    return this.budget.limit
  }

  /** Chamadas já gastas, de todos os itens e do ciclo. */
  get used(): number {
    return this.budget.used
  }

  /** Chamadas da fatia que ainda não foram gastas. */
  left(): number {
    return callsLeft(this.budget)
  }

  /** Livre para itens novos: sem a reserva do estado e sem o que os itens em voo ainda vão gastar. */
  private free(except?: ItemBudget): number {
    let reserved = this.reserve
    for (const item of this.inFlight) {
      if (item !== except) reserved += item.pending()
    }
    return Math.max(0, this.left() - reserved)
  }

  /** Itens que o saldo comporta num ciclo, pelo custo do mais barato, no máximo `maxItems`. */
  claimLimit(minItemCost: number, maxItems: number): number {
    const items = Math.floor((this.left() - CYCLE_FIXED_CALLS) / Math.max(1, minItemCost))
    return Math.max(0, Math.min(maxItems, items))
  }

  /**
   * Admite um item de custo estimado `estimate`, ou devolve `null` quando o que
   * está livre não cobre a estimativa. A estimativa fica reservada até `close`,
   * abatida do que o item já gastou.
   */
  open(estimate: number): ItemBudget | null {
    if (this.free() < estimate) return null
    const item: ItemBudget = new ItemBudget(this.rawDb, estimate, {
      spend: () => this.spend(),
      freeFor: () => this.free(item),
      release: () => this.release(item),
    })
    this.inFlight.add(item)
    return item
  }

  /** Há item em voo, que ainda pode devolver à fatia o que reservou e não gastou? */
  hasInFlight(): boolean {
    return this.inFlight.size > 0
  }

  /** Espera o próximo item em voo terminar: a reserva dele volta, abatida do que gastou. */
  nextRelease(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private release(item: ItemBudget): void {
    this.inFlight.delete(item)
    const waiting = this.waiters
    this.waiters = []
    for (const resolve of waiting) resolve()
  }

  /** Gasta uma chamada da fatia, ou falha se isso invadisse a reserva do estado. */
  private spend(): void {
    if (this.budget.used + 1 > this.budget.limit - this.reserve) {
      throw new CallBudgetExhaustedError()
    }
    this.budget.used += 1
  }
}

/** O que um item pede à fatia do dreno a que pertence. */
type ItemLedger = { spend(): void; freeFor(): number; release(): void }

/**
 * Chamadas de um item do dreno: o trabalho (sync e pós-sync) e o que ele gastou.
 * `used` é a contagem real do item, que o dreno usa para ajustar a estimativa dos
 * itens seguintes do mesmo tipo.
 */
export class ItemBudget implements CallGate {
  private spent = 0
  /** D1 do item: soma cada chamada na fatia e recusa a que invadiria a reserva do estado. */
  readonly db: D1Database

  constructor(
    rawDb: D1Database,
    readonly estimate: number,
    private readonly ledger: ItemLedger,
  ) {
    this.db = interceptD1(rawDb, (_call, proceed) => {
      try {
        this.spend()
      } catch (err) {
        return Promise.reject(err)
      }
      return proceed()
    })
  }

  /** Chamadas que o item gastou até agora (D1 e `fetch`). */
  used(): number {
    return this.spent
  }

  /** Parte da estimativa que o item ainda não gastou, reservada enquanto ele roda. */
  pending(): number {
    return Math.max(0, this.estimate - this.spent)
  }

  private spend(): void {
    this.ledger.spend()
    this.spent += 1
  }

  chargeFetch(): void {
    this.spend()
  }

  /** Chamadas que cabem ao item agora, sem invadir a reserva de outro item em voo. */
  callsLeft(): number {
    return this.ledger.freeFor()
  }

  close(): void {
    this.ledger.release()
  }
}
