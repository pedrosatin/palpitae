import { isGroupStageRound } from '../../lib/rounds'
import styles from '../tab-shared.module.css'
import Select from '../Select'
import Button from '../Button'

interface RoundHeaderProps {
  roundKeys: string[]
  safeIndex: number
  selectedRound: string
  labelFor: (r: string) => string
  onPrev: () => void
  onNext: () => void
  onSelect: (round: string) => void
  id?: string
  className?: string
}

export default function RoundHeader({
  roundKeys,
  safeIndex,
  selectedRound,
  labelFor,
  onPrev,
  onNext,
  onSelect,
  id = 'round-select',
  className,
}: RoundHeaderProps) {
  return (
    <div className={[styles.roundNav, className].filter(Boolean).join(' ')}>
      <Button
        variant="outline"
        className={styles.navBtn}
        onClick={onPrev}
        disabled={safeIndex === 0}
        aria-label="Rodada anterior"
      >
        ‹ Anterior
      </Button>
      <Select
        id={id}
        name={id}
        className={styles.roundSelect}
        value={selectedRound}
        onChange={(e) => onSelect(e.target.value)}
      >
        {roundKeys.some((r) => !isGroupStageRound(r)) ? (
          <>
            {roundKeys.some(isGroupStageRound) && (
              <optgroup label="Fase de grupos">
                {roundKeys.filter(isGroupStageRound).map((r) => (
                  <option key={r} value={r}>
                    {labelFor(r)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Mata-mata">
              {roundKeys.filter((r) => !isGroupStageRound(r)).map((r) => (
                <option key={r} value={r}>
                  {labelFor(r)}
                </option>
              ))}
            </optgroup>
          </>
        ) : (
          roundKeys.map((r) => (
            <option key={r} value={r}>
              {labelFor(r)}
            </option>
          ))
        )}
      </Select>
      <Button
        variant="outline"
        className={styles.navBtn}
        onClick={onNext}
        disabled={safeIndex === roundKeys.length - 1}
        aria-label="Próxima rodada"
      >
        Próxima ›
      </Button>
    </div>
  )
}
