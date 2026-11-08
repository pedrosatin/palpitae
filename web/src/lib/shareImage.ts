/**
 * Saídas de uma imagem gerada no cliente. Servem ao cartão de fim de campeonato e ao
 * cartão da rodada.
 */

/** Baixa o arquivo pelo navegador. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoga no próximo tick. Revogar antes de o navegador iniciar o download
  // interrompe o salvamento em alguns browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * O navegador consegue compartilhar um arquivo de imagem pelo menu nativo? Verdadeiro
 * no mobile (iOS/Android), falso no desktop, onde "compartilhar" seria só um download
 * disfarçado. Sonda com um File vazio.
 */
export function canShareImageFiles(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({ files: [new File([], 'r.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

/**
 * Compartilha a imagem pelo menu nativo quando o aparelho aceita arquivo, e baixa nos
 * outros casos. Cancelar o menu não baixa nada. Qualquer outra falha do menu cai no
 * download, para o usuário não ficar sem a imagem.
 */
export async function shareOrDownloadImage(
  blob: Blob,
  fileName: string,
  text: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareImageFiles()) {
    const file = new File([blob], fileName, { type: 'image/png' })
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, fileName)
  return 'downloaded'
}
