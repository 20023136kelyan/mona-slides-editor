import { describe, expect, it } from 'vitest'

import { getExportFileStem } from '@/features/editor/editor-export-filename'

describe('export filenames', () => {
  it('uses the document title without translating or otherwise rewriting it', () => {
    expect(getExportFileStem('Quarterly review', 'Untitled presentation')).toBe('Quarterly review')
    expect(getExportFileStem('四半期レビュー', 'Untitled presentation')).toBe('四半期レビュー')
  })

  it('removes unsafe filename characters and trailing punctuation', () => {
    expect(getExportFileStem('  Q3: Sales / Europe?.  ', 'Untitled presentation')).toBe('Q3 Sales Europe')
    expect(getExportFileStem('Line\u0000break\nreport', 'Untitled presentation')).toBe('Line break report')
  })

  it('uses a safe fallback for empty titles and caps very long names', () => {
    expect(getExportFileStem('', 'Untitled presentation')).toBe('Untitled presentation')
    expect(getExportFileStem('   ', '')).toBe('Presentation')
    expect(Array.from(getExportFileStem('🎨'.repeat(121), 'Fallback'))).toHaveLength(120)
  })
})
