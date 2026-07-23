import { describe, expect, it, vi } from 'vitest'

import { runAgentSandbox } from '@/features/editor/agent/agent-sandbox'
import type { AgentAssetService, AgentDocumentContext } from '@/features/editor/agent/agent-types'

const context: AgentDocumentContext = {
  currentSlideId: 'slide-1',
  revision: 'revision-1',
  selection: { elementIds: [], elements: [], slideId: 'slide-1' },
  slides: [{ id: 'slide-1', index: 0, elements: [] }],
  summary: {
    currentSlideNumber: 1,
    elementCount: 0,
    slideCount: 1,
    title: 'Sandbox fixture',
    viewportHeight: 562.5,
    viewportWidth: 1000,
  },
  theme: {
    backgroundColor: '#fff',
    fontColor: '#18181b',
    fontName: 'Arial',
    outline: { color: '#000', style: 'solid', width: 1 },
    shadow: { blur: 0, color: '#000', h: 0, v: 0 },
    themeColors: ['#6d5dfc'],
  },
}

const assets: AgentAssetService = {
  searchImages: vi.fn<AgentAssetService['searchImages']>(async () => [{ id: 'result-1', alt: 'Mountains', previewUrl: '/preview.jpg' }]),
  importImage: vi.fn<AgentAssetService['importImage']>(async () => ({ id: 'asset-1', alt: 'Mountains', src: '/api/agent/assets/images/asset-1' })),
}

describe('agent JavaScript sandbox', () => {
  it('records native editable commands without exposing page capabilities', async () => {
    const result = await runAgentSandbox({
      assetService: assets,
      context,
      code: `
        if (typeof window !== "undefined" || typeof document !== "undefined" || typeof fetch !== "undefined") {
          throw new Error("ambient page capability leaked");
        }
        const slide = mona.document.getSlide(context.currentSlideId);
        mona.log.info("Elements before: " + slide.elements.length);
        mona.elements.addText(context.currentSlideId, {
          text: "Editable heading", left: 80, top: 60, width: 600, height: 90,
          fontSize: 36, bold: true
        });
      `,
    })
    expect(result.commands).toHaveLength(1)
    expect(result.commands[0]).toMatchObject({
      type: 'element.add',
      slideId: 'slide-1',
      elements: { type: 'text', left: 80, top: 60 },
    })
    expect(result.logs[0]?.message).toBe('Elements before: 0')
  })

  it('routes image access exclusively through the managed asset bridge', async () => {
    const result = await runAgentSandbox({
      assetService: assets,
      context,
      code: `
        const result = (await mona.assets.searchImages("mountain sunrise"))[0];
        const asset = await mona.assets.importImage(result);
        mona.elements.addImage(context.currentSlideId, {
          asset, left: 100, top: 100, width: 400, height: 240
        });
      `,
    })
    expect(assets.searchImages).toHaveBeenCalledWith('mountain sunrise', expect.any(AbortSignal))
    expect(result.commands[0]).toMatchObject({
      type: 'element.add',
      elements: {
        type: 'image',
        src: '/api/agent/assets/images/asset-1',
      },
    })
  })

  it('terminates non-yielding programs without blocking the editor page', async () => {
    const marker = vi.fn<() => void>()
    setTimeout(marker, 0)
    await expect(runAgentSandbox({
      assetService: assets,
      context,
      code: 'while (true) {}',
      timeoutMs: 80,
    })).rejects.toThrow(/exceeded 80 ms/)
    expect(marker).toHaveBeenCalled()
  })
})
