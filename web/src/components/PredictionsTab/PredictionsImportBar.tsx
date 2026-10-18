import Button from '../Button'
import Select from '../Select'
import type { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

type ImportProps = Pick<
  ReturnType<typeof usePredictionsTab>,
  | 'otherGroups'
  | 'importCompleted'
  | 'importFeedback'
  | 'importExpanded'
  | 'importSourceId'
  | 'setImportSourceId'
  | 'importing'
  | 'handleImport'
  | 'setImportExpanded'
>

export default function PredictionsImportBar({
  otherGroups,
  importCompleted,
  importFeedback,
  importExpanded,
  importSourceId,
  setImportSourceId,
  importing,
  handleImport,
  setImportExpanded,
}: ImportProps) {
  return (
    <>
      {(otherGroups.length > 0 || importCompleted || importFeedback) && (
        <div className={styles.importBar}>
          {(!importCompleted || importExpanded) && otherGroups.length > 0 ? (
            <>
              <span className={styles.importLabel}>Importar palpites de:</span>
              <Select
                className={styles.importSelect}
                value={importSourceId}
                onChange={(e) => setImportSourceId(e.target.value)}
              >
                {otherGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
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
