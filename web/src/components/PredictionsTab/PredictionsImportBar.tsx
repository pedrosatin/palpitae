import Button from '../Button'
import Select from '../Select'
import type { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

type ImportProps = Pick<
  ReturnType<typeof usePredictionsTab>,
  | 'otherGroups'
  | 'importOptions'
  | 'importPending'
  | 'importCompleted'
  | 'importFeedback'
  | 'importExpanded'
  | 'importSourceId'
  | 'setImportSourceId'
  | 'importing'
  | 'handleImport'
  | 'setImportExpanded'
>

function optionLabel({ name, missing }: { name: string; missing: number }) {
  if (missing === 0) return name
  return `${name} (${missing} ${missing === 1 ? 'palpite novo' : 'palpites novos'})`
}

export default function PredictionsImportBar({
  otherGroups,
  importOptions,
  importPending,
  importCompleted,
  importFeedback,
  importExpanded,
  importSourceId,
  setImportSourceId,
  importing,
  handleImport,
  setImportExpanded,
}: ImportProps) {
  const showSelector = (importPending || importExpanded) && importOptions.length > 0
  // Nada faltando e nenhuma importação anterior: o link recolhido mantém a opção
  // de copiar outro grupo por cima dos palpites daqui.
  const showLinkOnly = !showSelector && !importCompleted && otherGroups.length > 0
  return (
    <>
      {(showSelector || showLinkOnly || importCompleted || importFeedback) && (
        <div className={styles.importBar}>
          {showSelector ? (
            <>
              <span className={styles.importLabel}>
                {importCompleted && !importExpanded
                  ? 'Novos palpites para importar de:'
                  : 'Importar palpites de:'}
              </span>
              <Select
                className={styles.importSelect}
                value={importSourceId}
                onChange={(e) => setImportSourceId(e.target.value)}
              >
                {importOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {optionLabel(g)}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                className={styles.importBtn}
                onClick={handleImport}
                disabled={importing || !importSourceId}
              >
                {importing ? 'Importando...' : 'Importar'}
              </Button>
            </>
          ) : showLinkOnly ? (
            <button
              type="button"
              className={styles.postponedHintLink}
              onClick={() => setImportExpanded(true)}
            >
              Importar de outro grupo
            </button>
          ) : (
            importCompleted && (
              <>
                <span className={styles.importSuccess}>Palpites importados.</span>
                {otherGroups.length > 0 && (
                  <button
                    type="button"
                    className={styles.postponedHintLink}
                    onClick={() => setImportExpanded(true)}
                  >
                    Importar novamente
                  </button>
                )}
              </>
            )
          )}
          {importFeedback && (
            <span className={importFeedback.ok ? styles.importSuccess : styles.importError}>
              {importFeedback.message}
            </span>
          )}
        </div>
      )}
    </>
  )
}
