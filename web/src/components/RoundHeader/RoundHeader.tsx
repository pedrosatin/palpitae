import { leftoverMatchesMarker } from '../../lib/rounds'
import styles from '../tab-shared.module.css'
import Select from '../Select'
import Button from '../Button'

interface RoundHeaderProps {
  roundKeys: string[]
  safeIndex: number
  selectedRound: string
  labelFor: (r: string) => string
  knockoutRounds?: Set<string>
  onPrev: () => void
  onNext: () => void
  onSelect: (round: string) => void
  postponedByRound?: Map<string, number>
  rescheduledByRound?: Map<string, number>
  unsavedRounds?: Set<string>
  id?: string
  className?: string
}

export default function RoundHeader({
  roundKeys,
  safeIndex,
  selectedRound,
  labelFor,
  knockoutRounds = new Set(),
  onPrev,
  onNext,
  onSelect,
  postponedByRound,
  rescheduledByRound,
  unsavedRounds,
  id = 'round-select',
  className,
}: RoundHeaderProps) {
  const optionLabel = (r: string) => {
    const markers = [
      leftoverMatchesMarker(postponedByRound?.get(r) ?? 0, rescheduledByRound?.get(r) ?? 0),
      unsavedRounds?.has(r) ? 'não salvo' : '',
    ].filter(Boolean)
    return markers.length > 0 ? `${labelFor(r)} · ${markers.join(', ')}` : labelFor(r)
  }

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
        {roundKeys.map((r, i) => {
          if (!knockoutRounds.has(r)) {
            return (
              <option key={r} value={r}>
                {optionLabel(r)}
              </option>
            )
          }
          if (i > 0 && knockoutRounds.has(roundKeys[i - 1])) return null
          const end = roundKeys.findIndex((key, index) => index > i && !knockoutRounds.has(key))
          return (
            <optgroup key={r} label="Mata-mata">
              {roundKeys.slice(i, end < 0 ? undefined : end).map((key) => (
                <option key={key} value={key}>
                  {optionLabel(key)}
                </option>
              ))}
            </optgroup>
          )
        })}
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
