import Modal from '../Modal'
import { buildGroupRules, type GroupRulesInput } from '../../lib/groupRules'
import styles from './GroupRulesModal.module.css'

interface GroupRulesModalProps {
  isOpen: boolean
  onClose: () => void
  group: GroupRulesInput
}

function Section({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>{title}</h3>
      {lines.map((line) => (
        <p key={line} className={styles.line}>
          {line}
        </p>
      ))}
    </section>
  )
}

export default function GroupRulesModal({ isOpen, onClose, group }: GroupRulesModalProps) {
  const rules = buildGroupRules(group)

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Regras do grupo" analyticsId="regras_grupo">
      <Section title="Pontuação" lines={rules.scoring} />
      <Section title="Bônus do mata-mata" lines={rules.bonuses} />
      <Section title="Prazo" lines={[rules.lock]} />
      <Section title="Palpites dos outros" lines={[rules.visibility]} />
      <Section title="Tempo de jogo" lines={[rules.period]} />
      <section className={styles.section}>
        <h3 className={styles.heading}>Ordem do ranking</h3>
        <ol className={styles.list}>
          {rules.tiebreak.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>
    </Modal>
  )
}
