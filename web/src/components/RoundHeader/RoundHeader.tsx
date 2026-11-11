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
  /**
   * round -> nº de jogos adiados. Marca a opção no seletor, senão a rodada
   * some da vista: ela não é o default (o adiado guarda o horário original,
   * já passado) mas ainda tem palpite aberto. Ver ADR-013.
   */
  postponedByRound?: Map<string, number>
  /**
   * round -> nº de jogos remarcados para o futuro numa rodada que ficou para
   * trás (fora do default_round, ver api/src/matches/defaultRound.ts).
   */
  rescheduledByRound?: Map<string, number>
  /**
   * Rodadas com rascunho de palpite não salvo. O aviso de saída conta todas as
   * rodadas, e o marcador mostra onde está cada rascunho.
   */
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
  // `<option>` só renderiza texto — nada de badge aqui, o marcador vai no rótulo.
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
