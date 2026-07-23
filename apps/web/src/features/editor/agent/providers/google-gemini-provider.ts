import { buildAgentSystemInstruction } from '@/features/editor/agent/agent-sdk'
import type {
  AgentDocumentContext,
  AgentGeneratedPlan,
  AgentPlanReview,
  AgentProvider,
} from '@/features/editor/agent/agent-types'

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

const stripPreviewData = (context: AgentDocumentContext) => {
  const copy = structuredClone(context)
  delete copy.currentSlidePreviewDataUrl
  if (copy.sketch) delete (copy.sketch as Partial<typeof copy.sketch>).previewDataUrl
  return copy
}

const dataUrlPart = (dataUrl: string | undefined) => {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl ?? '')
  if (!match) return undefined
  return { inlineData: { data: match[2], mimeType: match[1] } }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  error?: { message?: string }
}

const parseResponseJson = <Value>(payload: GeminiResponse): Value => {
  if (payload.error?.message) throw new Error(payload.error.message)
  const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('').trim()
  if (!text) throw new Error('Gemini returned no presentation program')
  try {
    return JSON.parse(text) as Value
  }
  catch {
    throw new Error('Gemini returned an invalid structured response')
  }
}

const requestGemini = async <Value>({
  apiKey,
  body,
  model,
  signal,
}: {
  apiKey: string
  body: Record<string, unknown>
  model: string
  signal?: AbortSignal
}): Promise<Value> => {
  const response = await fetch(`${GOOGLE_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    method: 'POST',
    signal,
  })
  const payload = await response.json() as GeminiResponse
  if (!response.ok) throw new Error(payload.error?.message || `Gemini request failed (${response.status})`)
  return parseResponseJson<Value>(payload)
}

const planSchema = {
  type: 'OBJECT',
  properties: {
    code: { type: 'STRING', description: 'Executable JavaScript program body using only the Mona SDK.' },
    explanation: { type: 'STRING', description: 'Concise user-facing description of the proposed edit.' },
  },
  required: ['code', 'explanation'],
}

const reviewSchema = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['accept', 'revise'] },
    code: { type: 'STRING', description: 'Complete revised JavaScript program when status is revise.' },
    explanation: { type: 'STRING' },
  },
  required: ['status'],
}

export const createGoogleGeminiProvider = ({
  apiKey,
  model = 'gemini-3.6-flash',
}: {
  apiKey: string
  model?: string
}): AgentProvider => {
  if (!apiKey.trim()) throw new Error('Enter a Google AI Studio key to use Gemini')
  return {
    id: 'google-ai-studio',
    label: `Google ${model}`,
    async generatePlan({ context, instruction, signal }): Promise<AgentGeneratedPlan> {
      const parts: Array<Record<string, unknown>> = [{
        text: `User instruction:\n${instruction}\n\nPresentation context:\n${JSON.stringify(stripPreviewData(context))}`,
      }]
      const currentPreview = dataUrlPart(context.currentSlidePreviewDataUrl)
      if (currentPreview) {
        parts.push({ text: 'Current slide visual:' }, currentPreview)
      }
      const sketchPreview = dataUrlPart(context.sketch?.previewDataUrl)
      if (sketchPreview) {
        parts.push({ text: 'Attached sketch visual:' }, sketchPreview)
      }
      const plan = await requestGemini<{ code?: unknown; explanation?: unknown }>({
        apiKey,
        model,
        signal,
        body: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            maxOutputTokens: 16_384,
            responseMimeType: 'application/json',
            responseSchema: planSchema,
            temperature: 0.2,
          },
          systemInstruction: { parts: [{ text: buildAgentSystemInstruction() }] },
        },
      })
      if (typeof plan.code !== 'string' || typeof plan.explanation !== 'string') {
        throw new Error('Gemini did not return a valid Mona presentation program')
      }
      return {
        code: plan.code,
        explanation: plan.explanation,
        providerId: 'google-ai-studio',
        providerLabel: `Google ${model}`,
      }
    },
    async reviewPlan({ afterPreview, context, instruction, plan, signal, summary }): Promise<AgentPlanReview> {
      if (!afterPreview) return { status: 'accept' }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => {
          if (typeof reader.result === 'string') resolve(reader.result)
          else reject(new Error('Rendered preview could not be encoded'))
        })
        reader.addEventListener('error', () => reject(reader.error))
        reader.readAsDataURL(afterPreview)
      })
      const preview = dataUrlPart(dataUrl)
      const parts: Array<Record<string, unknown>> = [{
        text: `Review the rendered result of this proposed Mona edit.
User request: ${instruction}
Program: ${plan.code}
Operation summary: ${JSON.stringify(summary)}
Slide size: ${context.summary.viewportWidth} × ${context.summary.viewportHeight}
Return "accept" if it is coherent, readable, aligned, and fulfills the request.
Return "revise" with a complete replacement program if a material visual issue is visible.`,
      }]
      if (preview) parts.push(preview)
      const review = await requestGemini<Record<string, unknown>>({
        apiKey,
        model,
        signal,
        body: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            maxOutputTokens: 16_384,
            responseMimeType: 'application/json',
            responseSchema: reviewSchema,
            temperature: 0.1,
          },
          systemInstruction: { parts: [{ text: buildAgentSystemInstruction() }] },
        },
      })
      if (review.status === 'revise') {
        if (typeof review.code !== 'string' || typeof review.explanation !== 'string') {
          throw new Error('Gemini requested a revision without a valid replacement program')
        }
        return { status: 'revise', code: review.code, explanation: review.explanation }
      }
      return { status: 'accept', explanation: typeof review.explanation === 'string' ? review.explanation : undefined }
    },
  }
}
