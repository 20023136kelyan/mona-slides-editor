export interface AIWritingPayload {
  command: string
  content: string
}

export type AIWritingResponse = Response | { state: -1 }

export async function requestAIWriting({ command, content }: AIWritingPayload): Promise<AIWritingResponse> {
  const response = await fetch('/api/tools/ai_writing', {
    body: JSON.stringify({
      command,
      content,
      model: 'glm-4.7-flash',
      stream: true,
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream') || contentType.includes('application/octet-stream')) {
    return response
  }
  return response.json() as Promise<{ state: -1 }>
}
