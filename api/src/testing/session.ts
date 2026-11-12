/**
 * Apoio para fakes de D1 diante da validação de sessão (`verifySession`), que
 * lê numa só consulta a revogação do token, a conta e o corte de sessões dela.
 * Só para testes.
 */

/** Linha da validação para uma conta ativa: não revogada, sem corte, com o e-mail gravado. */
export function activeSessionRow(email: string | null) {
  return { revoked: 0, valid_after: null, email }
}

/** A consulta é a validação de sessão? */
export function isSessionQuery(sql: string): boolean {
  return sql.includes('FROM revoked_sessions')
}

/** id da conta → e-mail gravado; conta ausente é conta apagada. */
type Accounts = Record<string, string> | ((userId: string) => string | undefined)

/**
 * Envolve um D1 falso para que a validação de sessão encontre estas contas com
 * estes e-mails. Token de conta fora da lista é recusado, como o de conta
 * apagada. As outras consultas seguem para o fake original. A validação recebe
 * (hash do token, agora, id da conta), nesta ordem.
 */
export function withSessionAccounts(db: D1Database, accounts: Accounts): D1Database {
  const emailOf = typeof accounts === 'function' ? accounts : (id: string) => accounts[id]
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== 'prepare') return Reflect.get(target, prop, receiver)
      return (sql: string) => {
        if (!isSessionQuery(sql)) return target.prepare(sql)
        return {
          bind: (...args: unknown[]) => ({
            first: async () => activeSessionRow(emailOf(String(args[2])) ?? null),
          }),
        }
      }
    },
  })
}
