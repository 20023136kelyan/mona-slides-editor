import {
  applyPresentationTransaction,
  createPresentationTransaction,
  flattenElementTree,
  type PresentationCommand,
  type PresentationState,
  type PresentationTransaction,
} from '@mona/presentation-core'
import type { PPTElement, Slide } from '@mona/presentation-core/model'

import { sanitizeSlides } from '@/lib/deck-sanitizer'
import type { AgentOperationSummary } from '@/features/editor/agent/agent-types'

const MAX_COMMANDS = 500
const MAX_COMMAND_BYTES = 4_000_000
const MAX_ELEMENT_EXTENT = 100_000
const MANAGED_ASSET_PREFIX = '/api/agent/assets/'
const ALLOWED_UPDATE_KEYS = new Set([
  'left', 'top', 'width', 'height', 'rotate', 'lock', 'groupId', 'link', 'name',
  'content', 'defaultFontName', 'defaultColor', 'outline', 'fill', 'lineHeight',
  'wordSpace', 'opacity', 'shadow', 'paragraphSpace', 'vertical', 'textType',
  'inset', 'fixedHeight', 'vAlign', 'fixedRatio', 'filters', 'clip', 'flipH',
  'flipV', 'radius', 'colorMask', 'imageType', 'viewBox', 'path', 'gradient',
  'pattern', 'special', 'text', 'pathFormula', 'keypoints', 'start', 'end',
  'style', 'color', 'points', 'broken', 'broken2', 'broken2Direction', 'curve',
  'cubic', 'chartType', 'data', 'options', 'themeColors', 'textColor',
  'lineColor', 'theme', 'colWidths', 'cellMinHeight', 'latex', 'strokeWidth',
])
const ALLOWED_SLIDE_PATCH_KEYS = new Set([
  'title', 'hidden', 'durationMs', 'notes', 'remark', 'background',
  'animations', 'turningMode', 'sectionTag', 'type',
])
const ALLOWED_COMMANDS = new Set<PresentationCommand['type']>([
  'presentation.title.set',
  'presentation.theme.update',
  'slide.add',
  'slide.update',
  'slide.delete',
  'element.add',
  'element.delete',
  'element.update',
  'element.properties.remove',
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
)

const assertAllowedKeys = (value: unknown, allowed: ReadonlySet<string>, label: string) => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const forbidden = Object.keys(value).find(key => !allowed.has(key))
  if (forbidden) throw new Error(`${label} cannot change "${forbidden}"`)
}

const assertManagedImage = (element: PPTElement, label: string) => {
  if (element.type !== 'image') return
  if (!element.src.startsWith(MANAGED_ASSET_PREFIX)) {
    throw new Error(`${label} must use an image imported through Mona's managed asset service`)
  }
}

const assertGeometry = (element: PPTElement, label: string) => {
  const geometry = [element.left, element.top, element.width]
  if (element.type !== 'line') geometry.push(element.height)
  if (geometry.some(value => !Number.isFinite(value) || Math.abs(value) > MAX_ELEMENT_EXTENT)) {
    throw new Error(`${label} has invalid or excessive geometry`)
  }
  if (element.width <= 0 || (element.type !== 'line' && element.height <= 0)) {
    throw new Error(`${label} must have positive dimensions`)
  }
}

const commandElements = (command: Extract<PresentationCommand, { type: 'element.add' }>): PPTElement[] => (
  Array.isArray(command.elements) ? command.elements : [command.elements]
)

const commandSlides = (command: Extract<PresentationCommand, { type: 'slide.add' }>): Slide[] => (
  Array.isArray(command.slides) ? command.slides : [command.slides]
)

export const validateAgentCommands = (
  state: PresentationState,
  commands: readonly PresentationCommand[],
): PresentationTransaction => {
  if (!commands.length) throw new Error('The agent did not produce any presentation operations')
  if (commands.length > MAX_COMMANDS) throw new Error(`The agent produced more than ${MAX_COMMANDS} operations`)
  if (JSON.stringify(commands).length > MAX_COMMAND_BYTES) throw new Error('Agent operations exceed the 4 MB limit')

  for (const [index, command] of commands.entries()) {
    if (!isRecord(command) || typeof command.type !== 'string' || !ALLOWED_COMMANDS.has(command.type as PresentationCommand['type'])) {
      throw new Error(`Operation ${index + 1} is not allowed`)
    }
    if (command.type === 'element.add') {
      for (const element of flattenElementTree(commandElements(command))) {
        assertGeometry(element, `Element in operation ${index + 1}`)
        assertManagedImage(element, `Element in operation ${index + 1}`)
      }
    }
    if (command.type === 'slide.add') {
      for (const slide of commandSlides(command)) {
        if (!Array.isArray(slide.elements)) throw new Error(`Slide in operation ${index + 1} has no element list`)
        for (const element of flattenElementTree(slide.elements)) {
          assertGeometry(element, `Slide element in operation ${index + 1}`)
          assertManagedImage(element, `Slide element in operation ${index + 1}`)
        }
      }
    }
    if (command.type === 'element.update') {
      assertAllowedKeys(command.payload.props, ALLOWED_UPDATE_KEYS, `Element update ${index + 1}`)
      if ('src' in command.payload.props || 'poster' in command.payload.props || 'type' in command.payload.props || 'id' in command.payload.props) {
        throw new Error(`Element update ${index + 1} cannot replace media identity or element type`)
      }
    }
    if (command.type === 'slide.update') {
      assertAllowedKeys(command.props, ALLOWED_SLIDE_PATCH_KEYS, `Slide update ${index + 1}`)
    }
    if (command.type === 'element.properties.remove') {
      const properties = Array.isArray(command.payload.property) ? command.payload.property : [command.payload.property]
      if (properties.some(property => property === 'id' || property === 'type')) {
        throw new Error(`Element property removal ${index + 1} cannot remove identity or type`)
      }
    }
  }

  const transaction = createPresentationTransaction({
    label: 'Mona agent edit',
    origin: 'agent',
    commands: structuredClone(commands) as PresentationCommand[],
  })
  const preview = applyPresentationTransaction(state, transaction)
  if (!preview.ok) throw new Error(preview.reason)
  const sanitized = sanitizeSlides(preview.state.slides)
  if (sanitized !== preview.state.slides) {
    throw new Error('Agent operations contain unsafe markup or URLs')
  }
  return transaction
}

export const summarizeAgentTransaction = (
  transaction: PresentationTransaction,
  preview: ReturnType<typeof applyPresentationTransaction>,
  description: string,
): AgentOperationSummary => {
  const affectedElementIds = new Set<string>()
  const affectedSlideIds = new Set<string>()
  if (preview.ok) {
    for (const change of preview.changes) {
      change.affectedElementIds.forEach(id => affectedElementIds.add(id))
      change.affectedSlideIds.forEach(id => affectedSlideIds.add(id))
    }
  }
  let createdElements = 0
  let deletedElements = 0
  let updatedElements = 0
  for (const command of transaction.commands) {
    if (command.type === 'element.add') createdElements += commandElements(command).length
    if (command.type === 'element.delete') deletedElements += Array.isArray(command.elementIds) ? command.elementIds.length : 1
    if (command.type === 'element.update') updatedElements += Array.isArray(command.payload.id) ? command.payload.id.length : 1
  }
  return {
    affectedElementIds: [...affectedElementIds],
    affectedSlideIds: [...affectedSlideIds],
    commandCount: transaction.commands.length,
    createdElements,
    deletedElements,
    description,
    updatedElements,
  }
}
