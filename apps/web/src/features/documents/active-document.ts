/**
 * The document mounted in this renderer.
 *
 * Asset helpers are intentionally presentation-engine utilities rather than
 * React hooks, so they cannot read route params directly. One renderer edits one
 * document; the route establishes that identity before any editor interaction
 * can write an asset and clears it when the editor unmounts.
 */

let activeDocumentId: string | null = null

export const setActiveDocumentId = (id: string | null): void => {
  activeDocumentId = id
}

export const clearActiveDocumentId = (id: string): void => {
  if (activeDocumentId === id) activeDocumentId = null
}

export const getActiveDocumentId = (): string => {
  // Component and importer tests render editor fragments without a route. Keep
  // that test-only shell deterministic without weakening the desktop contract.
  if (!activeDocumentId && import.meta.env.MODE === 'test') return 'browser-test-document'
  if (!activeDocumentId) throw new Error('No Mona document is active in this window.')
  return activeDocumentId
}

export const maybeActiveDocumentId = (): string | null => activeDocumentId
