export const MONA_AGENT_MODELS = [
  {
    badge: 'max',
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    providerId: 'openai-chatgpt',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    providerId: 'openai-chatgpt',
  },
  {
    badge: 'max',
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    providerId: 'anthropic-claude',
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    providerId: 'anthropic-claude',
  },
  {
    badge: 'max',
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    providerId: 'google-ai-studio',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    providerId: 'google-ai-studio',
  },
  {
    id: 'mona-default',
    name: 'Mona 1',
    providerId: 'mona-managed',
  },
] as const

export type MonaAgentModel = (typeof MONA_AGENT_MODELS)[number]
export type MonaAgentModelId = MonaAgentModel['id']
export type MonaAgentProviderId = MonaAgentModel['providerId']

export const getMonaAgentModel = (
  providerId: MonaAgentProviderId,
  modelId: string | undefined,
): MonaAgentModel | undefined => (
  MONA_AGENT_MODELS.find(model => model.providerId === providerId && model.id === modelId)
)

export const MONA_AGENT_SDK_REFERENCE = String.raw`
The program is an async JavaScript body. The only capabilities available are
"mona" and the read-only "context" object. Do not import packages, use the
network, or use browser globals.

Read:
  mona.document.getSummary()
  mona.document.getSlide(slideId)
  mona.selection.get()

Slides:
  mona.slides.add({ title?, background? }) -> slideId
  mona.slides.update(slideId, patch)
  mona.slides.remove(slideIds)

Elements (all geometry is in the logical slide coordinate system):
  mona.elements.addText(slideId, {
    text, left, top, width, height, fontSize?, fontFamily?, color?, align?,
    verticalAlign?, bold?, fill?, opacity?, rotate?, name?
  }) -> elementId
  mona.elements.addShape(slideId, {
    shape: "rectangle" | "roundedRectangle" | "ellipse",
    left, top, width, height, fill?, stroke?, strokeWidth?, opacity?, rotate?,
    text?, textColor?, fontSize?, name?
  }) -> elementId
  mona.elements.addLine(slideId, {
    left, top, width, height, color?, strokeWidth?, dash?, startMarker?,
    endMarker?, rotate?, name?
  }) -> elementId
  mona.elements.addChart(slideId, {
    chartType: "bar" | "column" | "line" | "pie" | "ring" | "area" |
      "radar" | "scatter",
    labels, legends, series, left, top, width, height, colors?, fill?, name?
  }) -> elementId
  mona.elements.addTable(slideId, {
    rows: string[][], left, top, width, height, headerColor?, bodyColor?,
    textColor?, name?
  }) -> elementId
  mona.elements.addImage(slideId, {
    asset, left, top, width, height, alt?, radius?, rotate?, name?
  }) -> elementId
  mona.elements.add(slideId, completeEditableMonaElement) -> elementId
  mona.elements.update(slideId, elementId, patch)
  mona.elements.remove(slideId, elementIds)

Managed images (the only network-like capability):
  const results = await mona.assets.searchImages("precise search query")
  const asset = await mona.assets.importImage(results[0])
  mona.elements.addImage(slideId, { asset, left, top, width, height })

The current slide id is context.currentSlideId. Existing element ids and
geometry are available through mona.document.getSlide(). Keep every object
inside context.summary.viewportWidth × context.summary.viewportHeight. Prefer
editing existing selected elements when the request refers to "this" or the
selection. Create editable text, shapes, charts, tables and managed images;
never flatten a slide into one image.
`

export const buildAgentSystemInstruction = (): string => String.raw`
You are Mona's presentation editing agent. Return one JSON object with:
  {"code":"JavaScript program body","explanation":"concise user-facing summary"}

The JavaScript will run in an isolated command-recording sandbox. It must use
only the SDK below. It must be deterministic, precise, and preserve existing
editable content unless the user explicitly asks to replace it. Use the visual
preview to judge hierarchy and spacing, and use the structural context for
exact IDs and geometry. If a sketch is attached, treat its positions and text
as design intent, not as final artwork.

${MONA_AGENT_SDK_REFERENCE}
`

export interface AgentProgramResponse {
  code: string
  explanation: string
}

export type AgentReviewResponse =
  | { status: 'accept'; explanation?: string }
  | { status: 'revise'; code: string; explanation: string }

const unwrapCodeFence = (value: string): string => {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value.trim())
  return match?.[1] ?? value.trim()
}

export const parseAgentProgramResponse = (text: string): AgentProgramResponse => {
  let value: unknown
  try {
    value = JSON.parse(unwrapCodeFence(text))
  }
  catch {
    throw new Error('The model returned invalid structured output')
  }
  if (!value || typeof value !== 'object') throw new Error('The model returned an invalid presentation program')
  const record = value as Record<string, unknown>
  if (typeof record.code !== 'string' || typeof record.explanation !== 'string') {
    throw new Error('The model returned an invalid presentation program')
  }
  if (!record.code.trim() || record.code.length > 100_000) {
    throw new Error('The model returned an empty or oversized presentation program')
  }
  if (record.explanation.length > 8_000) throw new Error('The model returned an oversized explanation')
  return { code: record.code, explanation: record.explanation }
}

export const parseAgentReviewResponse = (text: string): AgentReviewResponse => {
  let value: unknown
  try {
    value = JSON.parse(unwrapCodeFence(text))
  }
  catch {
    throw new Error('The model returned invalid review output')
  }
  if (!value || typeof value !== 'object') throw new Error('The model returned an invalid visual review')
  const record = value as Record<string, unknown>
  if (record.status === 'accept') {
    return {
      status: 'accept',
      ...(typeof record.explanation === 'string' ? { explanation: record.explanation } : {}),
    }
  }
  if (
    record.status === 'revise'
    && typeof record.code === 'string'
    && typeof record.explanation === 'string'
    && record.code.trim()
    && record.code.length <= 100_000
  ) {
    return { status: 'revise', code: record.code, explanation: record.explanation }
  }
  throw new Error('The model returned an invalid visual review')
}
