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
  /**
   * round -> nº de jogos adiados. Marca a opção no seletor, senão a rodada
   * some da vista: ela não é o default (o adiado guarda o horário original,
   * já passado) mas ainda tem palpite aberto. Ver ADR-013.
   */
  postponedByRound?: Map<string, number>
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
  postponedByRound,
  id = 'round-select',
  className,
}: RoundHeaderProps) {
  // `<option>` só renderiza texto — nada de badge aqui, o marcador vai no rótulo.
  const optionLabel = (r: string) => {
    const count = postponedByRound?.get(r)
    if (!count) return labelFor(r)
    return `${labelFor(r)} · ${count} adiado${count > 1 ? 's' : ''}`
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
        {roundKeys.some((r) => !isGroupStageRound(r)) ? (
          <>
            {roundKeys.some(isGroupStageRound) && (
              <optgroup label="Fase de grupos">
                {roundKeys.filter(isGroupStageRound).map((r) => (
                  <option key={r} value={r}>
                    {optionLabel(r)}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Mata-mata">
              {roundKeys
                .filter((r) => !isGroupStageRound(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {optionLabel(r)}
                  </option>
                ))}
            </optgroup>
          </>
        ) : (
          roundKeys.map((r) => (
            <option key={r} value={r}>
              {optionLabel(r)}
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
