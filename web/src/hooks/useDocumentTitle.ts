import { useEffect } from 'react'

const BASE_TITLE = 'Palpitae'

/**
 * Keeps `document.title` in sync with the active view.
 *
 * This is purely a UX concern — it improves browser tab, bookmark and
 * history labels. It has no SEO effect: the authenticated views that use it
 * sit behind login and are excluded from indexing (see robots.txt), so
 * crawlers never reach them. Public SEO lives entirely in the static
 * index.html.
 *
 * Pass only the page-specific part; the brand suffix is appended. Passing a
 * falsy value resets to the bare brand title. The previous title is restored
 * on unmount so transient views don't leak their title into the next one.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} | ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = previous
    }
  }, [title])
}
