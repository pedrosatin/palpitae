import { useEffect, useRef, useState } from 'react'

const API = 'https://tbbc.app/api/rating'
const REQUEST_TIMEOUT_MS = 10_000

type Reply = { ok?: unknown; id?: unknown }
type CommentAttempt = { comment: string; nonce: string }

export function usePredictionsFeedback(site: string) {
  const [ratingId, setRatingId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const request = useRef<AbortController | null>(null)
  const commentAttempt = useRef<CommentAttempt | null>(null)

  useEffect(() => {
    return () => {
      const controller = request.current
      request.current = null
      controller?.abort()
    }
  }, [])

  async function send(
    path: string,
    body: Record<string, unknown>,
    expectedStatus: number,
    accept: (reply: Reply) => void,
  ) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const reply = (await response.json()) as Reply | null
      if (controller.signal.aborted) throw new Error('Request aborted')
      if (
        response.status !== expectedStatus ||
        !reply ||
        reply.ok !== true ||
        typeof reply.id !== 'string' ||
        !reply.id.trim()
      ) {
        throw new Error('Feedback not confirmed')
      }
      if (request.current === controller) accept(reply)
    } catch {
      if (request.current === controller) {
        setError('Não foi possível confirmar o envio. Tente novamente se quiser.')
      }
    } finally {
      clearTimeout(timeout)
      if (request.current === controller) {
        request.current = null
        setPending(false)
      }
    }
  }

  function vote(value: 1 | -1) {
    if (ratingId) return
    return send(
      '',
      {
        site,
        vote: value,
        section: 'predictions',
        app: 'palpitae',
        page: '/grupos/palpites',
        lang: 'pt-BR',
      },
      201,
      (reply) => setRatingId(reply.id as string),
    )
  }

  function comment(value: string) {
    const text = value.trim()
    if (!ratingId || !text || text.length > 1000 || request.current) return
    if (commentAttempt.current?.comment !== text) {
      commentAttempt.current = { comment: text, nonce: crypto.randomUUID() }
    }
    return send(`/${encodeURIComponent(ratingId)}`, commentAttempt.current, 200, () =>
      setDone(true),
    )
  }

  return { ratingId, pending, error, done, vote, comment }
}
