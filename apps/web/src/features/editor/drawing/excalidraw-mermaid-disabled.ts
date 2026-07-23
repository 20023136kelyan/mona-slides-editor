/**
 * Mona embeds Excalidraw strictly as a freeform sketch input. Its optional
 * Mermaid converter is not part of that surface and currently pulls a parser
 * stack with unresolved upstream security advisories. Keep the dynamic import
 * contract intact while making the feature intentionally unavailable.
 */
export const parseMermaidToExcalidraw = async (): Promise<never> => {
  throw new Error('Mermaid conversion is unavailable in Mona drawing mode')
}
