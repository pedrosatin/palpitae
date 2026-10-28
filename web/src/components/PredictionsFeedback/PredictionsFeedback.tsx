import { useId, useState } from 'react'
import { config } from '../../config'
import Button from '../Button'
import { usePredictionsFeedback } from './usePredictionsFeedback'
import styles from './PredictionsFeedback.module.css'

function FeedbackForm({ site, onDismiss }: { site: string; onDismiss: () => void }) {
  const titleId = useId()
  const commentId = useId()
  const noticeId = useId()
  const [text, setText] = useState('')
  const { ratingId, pending, error, done, vote, comment } = usePredictionsFeedback(site)

  return (
    <section className={styles.root} aria-labelledby={titleId} aria-describedby={noticeId}>
      <div className={styles.header}>
        <h3 id={titleId} className={styles.title}>
          Foi fácil salvar seus palpites?
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {ratingId ? 'Fechar avaliação' : 'Agora não'}
        </Button>
      </div>
      <p id={noticeId} className={styles.notice}>
        Sua avaliação será enviada e armazenada pela{' '}
        <a href="https://tbbc.app/rating-widget/#h-dados" target="_blank" rel="noopener noreferrer">
          TBBC
        </a>
        . Não inclua dados pessoais no comentário.
      </p>
      {done ? (
        <p role="status">Obrigado! Sua avaliação foi recebida.</p>
      ) : ratingId ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void comment(text)
          }}
        >
          <p role="status">Voto recebido. Quer contar mais?</p>
          <label htmlFor={commentId}>Comentário opcional</label>
          <textarea
            id={commentId}
            className={styles.comment}
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1000}
            rows={3}
            disabled={pending}
          />
          <div className={styles.actions}>
            <Button type="submit" size="sm" disabled={pending || !text.trim()}>
              {pending ? 'Enviando comentário...' : 'Enviar comentário'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              Concluir sem comentário
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void vote(1)}
          >
            Sim
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void vote(-1)}
          >
            Não
          </Button>
          {pending && <span role="status">Enviando avaliação...</span>}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export default function PredictionsFeedback() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || !config.tbbcSiteKey) return null
  return <FeedbackForm site={config.tbbcSiteKey} onDismiss={() => setDismissed(true)} />
}
