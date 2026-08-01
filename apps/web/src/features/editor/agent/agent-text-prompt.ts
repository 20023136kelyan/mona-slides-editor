export interface TextRewritePromptInput {
  currentText: string
  elementId: string
  instruction: string
  slideId: string
}

/**
 * Gives the ordinary deck-editing agent an exact target instead of inventing a
 * second text-generation API.
 *
 * The element remains a native Mona object. The agent edits its JSON in the
 * workspace, looks at the rendered result, and commits through the same
 * validated one-transaction boundary as every other agent operation.
 */
export const buildTextRewritePrompt = ({
  currentText,
  elementId,
  instruction,
  slideId,
}: TextRewritePromptInput): string => [
  'Edit one existing text-bearing element in the presentation.',
  `Slide id: ${slideId}`,
  `Element id: ${elementId}`,
  `Instruction: ${instruction}`,
  `Current visible text: ${JSON.stringify(currentText)}`,
  '',
  'Change only that element’s wording. Preserve its id, element type, position, size, rotation,',
  'rich-text structure, visual styling, hyperlinks, and every other slide element unless the',
  'requested wording makes a minimal line-break adjustment necessary. Keep the result editable.',
  'Use the deck files, render the affected slide to inspect it, and call apply when it is correct.',
].join('\n')
