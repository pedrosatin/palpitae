
type Env = Record<string, string | undefined>

function absoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
  } catch {
    return false
  }
}

function sameOriginPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

function hasQueryOrHash(value: string): boolean {
  return value.includes('?') || value.includes('#')
}

function check(
  env: Env,
  name: string,
  accepts: (value: string) => boolean,
  expected: string,
): string | null {
  const value = env[name]?.trim()
  if (!value) return `${name} não está definida.`
  if (accepts(value) && !hasQueryOrHash(value)) return null
  return `${name} precisa ser ${expected}, sem query nem fragmento (recebido: ${JSON.stringify(env[name])}).`
}

/** Problemas nas variáveis obrigatórias. Lista vazia quando o build pode seguir. */
export function buildEnvErrors(env: Env): string[] {
  const errors = [
    check(
      env,
      'VITE_API_URL',
      (v) => sameOriginPath(v) || absoluteHttpUrl(v),
      'um caminho iniciado por "/" ou uma URL absoluta http(s)',
    ),
    check(env, 'VITE_AUTH_URL', absoluteHttpUrl, 'uma URL absoluta http(s)'),
  ]
  return errors.filter((error): error is string => error !== null)
}

/** Lança com todos os problemas de uma vez, para o log do CI mostrar o que corrigir. */
export function assertBuildEnv(env: Env): void {
  const errors = buildEnvErrors(env)
  if (errors.length === 0) return
  throw new Error(
    `Build de produção com variáveis de ambiente inválidas:\n- ${errors.join('\n- ')}\n` +
      'Defina-as em web/.env.production ou no ambiente do build.',
  )
}
