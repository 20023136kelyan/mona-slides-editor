export function getExportFileStem(title: string, fallback: string) {
  const withoutControlCharacters = Array.from(title, character => (
    character.charCodeAt(0) < 32 ? ' ' : character
  )).join('')
  const normalized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  const candidate = normalized || fallback.trim() || 'Presentation'
  return Array.from(candidate).slice(0, 120).join('').replace(/[. ]+$/g, '') || 'Presentation'
}
