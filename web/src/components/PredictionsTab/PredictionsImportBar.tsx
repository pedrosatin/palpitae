import type { ReactNode } from 'react'
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
  | 'importedFromName'
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

function ImportSelector({
  importCompleted,
  importExpanded,
  importSourceId,
  setImportSourceId,
  importOptions,
  importing,
  handleImport,
}: Pick<
  ImportProps,
  | 'importCompleted'
  | 'importExpanded'
  | 'importSourceId'
  | 'setImportSourceId'
  | 'importOptions'
  | 'importing'
  | 'handleImport'
>) {
  return (
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
  )
}

function ImportLink({ onExpand }: { onExpand: () => void }) {
  return (
    <button type="button" className={styles.postponedHintLink} onClick={onExpand}>
      Importar de outro grupo
    </button>
  )
}

function ImportedInfo({
  importedFromName,
  canRepeat,
  onExpand,
}: {
  importedFromName: string | null
  canRepeat: boolean
  onExpand: () => void
}) {
  return (
    <>
      <span className={styles.importInfo}>
        {importedFromName
          ? `Palpites importados de ${importedFromName}.`
          : 'Você já importou palpites de outro grupo.'}
      </span>
      {canRepeat && (
        <button type="button" className={styles.importInfoLink} onClick={onExpand}>
          Importar de novo
        </button>
      )}
    </>
  )
}

export default function PredictionsImportBar({
  otherGroups,
  importOptions,
  importPending,
  importCompleted,
  importFeedback,
  importedFromName,
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
  if (!showSelector && !showLinkOnly && !importCompleted && !importFeedback) return null

  let content: ReactNode = null
  if (showSelector) {
    content = (
      <ImportSelector
        importCompleted={importCompleted}
        importExpanded={importExpanded}
        importSourceId={importSourceId}
        setImportSourceId={setImportSourceId}
        importOptions={importOptions}
        importing={importing}
        handleImport={handleImport}
      />
    )
  } else if (showLinkOnly) {
    content = <ImportLink onExpand={() => setImportExpanded(true)} />
  } else if (importCompleted) {
    content = (
      <ImportedInfo
        importedFromName={importedFromName}
        canRepeat={otherGroups.length > 0}
        onExpand={() => setImportExpanded(true)}
      />
    )
  }

  return (
    <div
      className={`${styles.importBar} ${
        !showSelector && !showLinkOnly ? styles.importBarInfo : ''
      }`}
    >
      {content}
      {importFeedback && (
        <span className={importFeedback.ok ? styles.importSuccess : styles.importError}>
          {importFeedback.message}
        </span>
      )}
    </div>
  )
}
