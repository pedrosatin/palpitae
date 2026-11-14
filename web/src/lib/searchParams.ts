/** Devolve uma cópia dos parâmetros da URL sem `name`. */
export function withoutParam(prev: URLSearchParams, name: string): URLSearchParams {
  const next = new URLSearchParams(prev)
  next.delete(name)
  return next
}
