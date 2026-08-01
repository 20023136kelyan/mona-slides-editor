import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import JSZip from 'jszip'
import { posix } from 'node:path'

import type {
  PPTElement,
  PowerPointPackageManifest,
} from '@mona/presentation-core'
import { flattenElementTree } from '@mona/presentation-core'

import type {
  PowerPointAccessibilityPatch,
  PowerPointBackgroundPatch,
  PowerPointConnectorPatch,
  PowerPointCommentsPatch,
  PowerPointImagePatch,
  PowerPointNotesPatch,
  PowerPointObjectInsertPatch,
  PowerPointPatchOperation,
  PowerPointSlideInsertPatch,
  PowerPointShapeStylePatch,
  PowerPointShapeGeometryPatch,
  PowerPointTablePatch,
  PowerPointTextPatch,
  PowerPointTransformPatch,
  PowerPointWritebackIssue,
} from './types'
import { PowerPointWritebackError } from './types'
import {
  parseAuthoredText,
  type AuthoredTextParagraph,
  type AuthoredTextRun,
  type AuthoredTextStyle,
} from './authored-text'
import { patchNativeChart } from './chart-writeback'

type OrderedXmlNode = Record<string, unknown>
type PowerPointObjectPatchOperation = Exclude<PowerPointPatchOperation, {
  kind: 'background' | 'comments' | 'inherited-visibility' | 'insert-object' | 'insert-slide' | 'notes'
}>

interface ConnectorCoordinateContext {
  childOffsetX: number
  childOffsetY: number
  scaleX: number
  scaleY: number
}

interface HyperlinkRelationshipEditor {
  dirty: boolean
  path: string
  patchRun: (
    runNode: OrderedXmlNode,
    target: string | undefined,
    operation: PowerPointTextPatch,
  ) => PowerPointWritebackIssue | undefined
  serialize: () => string
}

const drawingObjectTags = new Set([
  'contentPart',
  'cxnSp',
  'graphicFrame',
  'grpSp',
  'pic',
  'sp',
])

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: false,
  removeNSPrefix: false,
  trimValues: false,
})

const xmlBuilder = new XMLBuilder({
  attributeNamePrefix: '',
  format: false,
  ignoreAttributes: false,
  preserveOrder: true,
  processEntities: false,
  suppressEmptyNode: false,
})

const localName = (name: string): string => name.slice(name.lastIndexOf(':') + 1)

const nodeEntries = (node: OrderedXmlNode): Array<[string, OrderedXmlNode[]]> => (
  Object.entries(node).flatMap(([tag, value]) => (
    tag === ':@' || !Array.isArray(value) ? [] : [[tag, value as OrderedXmlNode[]]]
  ))
)

const nodeAttributes = (node: OrderedXmlNode): Record<string, string> => {
  const value = node[':@']
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const attributes: Record<string, string> = {}
    node[':@'] = attributes
    return attributes
  }
  return value as Record<string, string>
}

const parseXml = (value: string, partPath: string): OrderedXmlNode[] => {
  if (/<!DOCTYPE\b/i.test(value)) {
    throw new Error(`PowerPoint XML part contains a prohibited DOCTYPE: ${partPath}`)
  }
  const validation = XMLValidator.validate(value, { allowBooleanAttributes: false })
  if (validation !== true) {
    throw new Error(`Invalid PowerPoint XML part: ${partPath} (${validation.err.msg})`)
  }
  const parsed: unknown = xmlParser.parse(value)
  if (!Array.isArray(parsed)) throw new Error(`Invalid PowerPoint XML tree: ${partPath}`)
  return parsed as OrderedXmlNode[]
}

const findNode = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      if (localName(tag) === expected) return node
      const nested = findNode(children, expected)
      if (nested) return nested
    }
  }
  return undefined
}

const findOwnTransform = (
  nodes: readonly OrderedXmlNode[],
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      const name = localName(tag)
      if (name === 'xfrm') return node
      if (drawingObjectTags.has(name)) continue
      const nested = findOwnTransform(children)
      if (nested) return nested
    }
  }
  return undefined
}

const nonVisualId = (children: readonly OrderedXmlNode[]): string | undefined => {
  const nonVisual = findNode(children, 'cNvPr')
  const value = nonVisual ? nodeAttributes(nonVisual).id : undefined
  return value || undefined
}

const numericAttribute = (
  node: OrderedXmlNode | undefined,
  name: string,
): number | undefined => {
  const value = node ? Number(nodeAttributes(node)[name]) : Number.NaN
  return Number.isFinite(value) ? value : undefined
}

const ownChildren = (node: OrderedXmlNode): OrderedXmlNode[] => (
  nodeEntries(node)[0]?.[1] ?? []
)

const nodeTag = (node: OrderedXmlNode): string | undefined => (
  nodeEntries(node)[0]?.[0]
)

const directNode = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode | undefined => nodes.find(node => {
  const tag = nodeTag(node)
  return tag !== undefined && localName(tag) === expected
})

const directNodes = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode[] => nodes.filter(node => {
  const tag = nodeTag(node)
  return tag !== undefined && localName(tag) === expected
})

const xmlNode = (
  tag: string,
  children: OrderedXmlNode[] = [],
  attributes?: Record<string, string>,
): OrderedXmlNode => ({
  [tag]: children,
  ...(attributes && Object.keys(attributes).length ? { ':@': attributes } : {}),
})

const relationshipPartPath = (partPath: string): string => {
  const slash = partPath.lastIndexOf('/')
  const directory = slash < 0 ? '' : partPath.slice(0, slash + 1)
  const fileName = slash < 0 ? partPath : partPath.slice(slash + 1)
  return `${directory}_rels/${fileName}.rels`
}

interface RelationshipDocument {
  byId: Map<string, OrderedXmlNode>
  children: OrderedXmlNode[]
  nodes: OrderedXmlNode[]
  path: string
}

const relationshipDocument = (
  xml: string | undefined,
  ownerPart: string,
): RelationshipDocument => {
  const path = relationshipPartPath(ownerPart)
  const nodes = xml
    ? parseXml(xml, path)
    : [xmlNode('Relationships', [], {
        xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships',
      })]
  const root = findNode(nodes, 'Relationships') ?? nodes[0]!
  const children = ownChildren(root)
  const byId = new Map<string, OrderedXmlNode>()
  for (const relationship of directNodes(children, 'Relationship')) {
    const id = nodeAttributes(relationship).Id
    if (id) byId.set(id, relationship)
  }
  return { byId, children, nodes, path }
}

const nextRelationshipId = (relationships: RelationshipDocument): string => {
  let numericId = 1
  while (relationships.byId.has(`rId${numericId}`)) numericId += 1
  return `rId${numericId}`
}

const internalRelationshipTarget = (ownerPart: string, target: string): string => (
  target.startsWith('/')
    ? target.slice(1)
    : posix.normalize(posix.join(posix.dirname(ownerPart), target))
)

const relativeRelationshipTarget = (ownerPart: string, targetPart: string): string => (
  posix.relative(posix.dirname(ownerPart), targetPart) || posix.basename(targetPart)
)

const serializeRelationshipDocument = (relationships: RelationshipDocument): string => (
  xmlBuilder.build(relationships.nodes) as string
)

const relationshipIdsInTree = (nodes: readonly OrderedXmlNode[]): Set<string> => {
  const ids = new Set<string>()
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      const attributes = node[':@']
      if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
        for (const [name, value] of Object.entries(attributes)) {
          if (name.startsWith('r:') && typeof value === 'string' && value) ids.add(value)
        }
      }
      for (const [, children] of nodeEntries(node)) visit(children)
    }
  }
  visit(nodes)
  return ids
}

const replaceRelationshipIds = (
  nodes: readonly OrderedXmlNode[],
  replacements: ReadonlyMap<string, string>,
): void => {
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      const attributes = node[':@']
      if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
        for (const [name, value] of Object.entries(attributes)) {
          if (!name.startsWith('r:') || typeof value !== 'string') continue
          const replacement = replacements.get(value)
          if (replacement) (attributes as Record<string, string>)[name] = replacement
        }
      }
      for (const [, children] of nodeEntries(node)) visit(children)
    }
  }
  visit(nodes)
}

const copyReferencedRelationships = async ({
  clone,
  sourcePart,
  targetPart,
  zip,
}: {
  clone: OrderedXmlNode
  sourcePart: string
  targetPart: string
  zip: JSZip
}): Promise<PowerPointWritebackIssue[]> => {
  const sourcePath = relationshipPartPath(sourcePart)
  const sourceEntry = zip.file(sourcePath)
  const referenced = relationshipIdsInTree([clone])
  if (!referenced.size) return []
  if (!sourceEntry) {
    return [{
      code: 'pptx.writeback.copy-relationships-missing',
      message: 'The native object references package relationships, but its source relationship part is missing.',
      partPath: sourcePath,
    }]
  }
  const source = relationshipDocument(await sourceEntry.async('text'), sourcePart)
  const targetPath = relationshipPartPath(targetPart)
  const targetEntry = zip.file(targetPath)
  const target = relationshipDocument(
    targetEntry ? await targetEntry.async('text') : undefined,
    targetPart,
  )
  const replacements = new Map<string, string>()
  const partMap = new Map<string, string>()
  const issues: PowerPointWritebackIssue[] = []
  for (const sourceId of referenced) {
    const relationship = source.byId.get(sourceId)
    if (!relationship) {
      issues.push({
        code: 'pptx.writeback.copy-relationship-missing',
        message: `The native object references missing relationship ${sourceId}.`,
        partPath: sourcePath,
      })
      continue
    }
    const attributes = nodeAttributes(relationship)
    const targetValue = attributes.Target
    if (!targetValue) continue
    const suffix = relationshipTypeSuffix(attributes.Type)
    const cloneDependency = (
      attributes.TargetMode !== 'External'
      && clonedRelationshipSuffixes.has(suffix)
    )
    if (sourcePart === targetPart && !cloneDependency) continue
    const id = nextRelationshipId(target)
    const copiedAttributes: Record<string, string> = { ...attributes, Id: id }
    if (attributes.TargetMode !== 'External') {
      const sourceTarget = internalRelationshipTarget(sourcePart, targetValue)
      let copiedTarget = sourceTarget
      if (cloneDependency) {
        const cloned = await cloneOwnedPart(zip, sourceTarget, partMap)
        issues.push(...cloned.issues)
        if (cloned.targetPart) copiedTarget = cloned.targetPart
      }
      copiedAttributes.Target = relativeRelationshipTarget(
        targetPart,
        copiedTarget,
      )
    }
    const copied = xmlNode('Relationship', [], copiedAttributes)
    target.children.push(copied)
    target.byId.set(id, copied)
    replacements.set(sourceId, id)
  }
  if (issues.length) return issues
  replaceRelationshipIds([clone], replacements)
  zip.file(target.path, serializeRelationshipDocument(target))
  return []
}

interface DrawingNodeLocation {
  children: OrderedXmlNode[]
  index: number
  node: OrderedXmlNode
  siblings: OrderedXmlNode[]
}

const findDrawingNode = (
  nodes: OrderedXmlNode[],
  packageId: string,
  partPath: string,
  objectId: string,
): DrawingNodeLocation | undefined => {
  const occurrences = new Map<string, number>()
  const visit = (siblings: OrderedXmlNode[]): DrawingNodeLocation | undefined => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index]!
      for (const [tag, children] of nodeEntries(node)) {
        const name = localName(tag)
        if (!drawingObjectTags.has(name)) {
          const nested = visit(children)
          if (nested) return nested
          continue
        }
        const nativeId = nonVisualId(children)
        if (nativeId) {
          const occurrence = occurrences.get(nativeId) ?? 0
          occurrences.set(nativeId, occurrence + 1)
          const candidate = `${packageId}/${partPath}#${nativeId}${occurrence ? `:${occurrence}` : ''}`
          if (candidate === objectId) return { children, index, node, siblings }
        }
        const nested = visit(children)
        if (nested) return nested
      }
    }
    return undefined
  }
  return visit(nodes)
}

const collectDrawingNodes = (nodes: OrderedXmlNode[]): DrawingNodeLocation[] => {
  const locations: DrawingNodeLocation[] = []
  const visit = (siblings: OrderedXmlNode[]): void => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index]!
      for (const [tag, children] of nodeEntries(node)) {
        if (drawingObjectTags.has(localName(tag))) {
          locations.push({ children, index, node, siblings })
        }
        visit(children)
      }
    }
  }
  visit(nodes)
  return locations
}

const drawingIds = (nodes: readonly OrderedXmlNode[]): number[] => {
  const ids: number[] = []
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        const value = localName(tag) === 'cNvPr'
          ? Number(nodeAttributes(node).id)
          : Number.NaN
        if (Number.isSafeInteger(value) && value >= 0) ids.push(value)
        visit(children)
      }
    }
  }
  visit(nodes)
  return ids
}

const allocateDrawingIds = (
  clone: OrderedXmlNode,
  targetNodes: readonly OrderedXmlNode[],
): void => {
  let nextId = Math.max(0, ...drawingIds(targetNodes)) + 1
  const replacements = new Map<string, string>()
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === 'cNvPr') {
          const attributes = nodeAttributes(node)
          const previous = attributes.id
          const allocated = String(nextId++)
          if (previous && !replacements.has(previous)) replacements.set(previous, allocated)
          attributes.id = allocated
          if (attributes.name) attributes.name = `${attributes.name} Copy`
        }
        visit(children)
      }
    }
  }
  visit([clone])
  const updateConnections = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === 'stCxn' || localName(tag) === 'endCxn') {
          const attributes = nodeAttributes(node)
          const replacement = attributes.id ? replacements.get(attributes.id) : undefined
          if (replacement) attributes.id = replacement
        }
        updateConnections(children)
      }
    }
  }
  updateConnections([clone])
}

const shapeTreeChildren = (nodes: readonly OrderedXmlNode[]): OrderedXmlNode[] | undefined => {
  const shapeTree = findNode(nodes, 'spTree')
  return shapeTree ? ownChildren(shapeTree) : undefined
}

const insertDrawingNode = (
  targetNodes: OrderedXmlNode[],
  clone: OrderedXmlNode,
  parent?: DrawingNodeLocation,
): boolean => {
  const siblings = parent ? parent.children : shapeTreeChildren(targetNodes)
  if (!siblings) return false
  const extensionIndex = siblings.findIndex(node => localName(nodeTag(node) ?? '') === 'extLst')
  siblings.splice(extensionIndex < 0 ? siblings.length : extensionIndex, 0, clone)
  return true
}

const allocateSiblingPart = (zip: JSZip, sourcePart: string): string => {
  const directory = posix.dirname(sourcePart)
  const extension = posix.extname(sourcePart)
  const stem = posix.basename(sourcePart, extension).replace(/\d+$/, '') || 'part'
  let next = 1
  for (const path of Object.keys(zip.files)) {
    if (posix.dirname(path) !== directory || posix.extname(path) !== extension) continue
    const name = posix.basename(path, extension)
    const match = name.match(new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`))
    if (match) next = Math.max(next, Number(match[1]) + 1)
  }
  while (zip.file(`${directory}/${stem}${next}${extension}`)) next += 1
  return `${directory}/${stem}${next}${extension}`
}

const cloneContentTypeOverride = async (
  zip: JSZip,
  sourcePart: string,
  targetPart: string,
): Promise<PowerPointWritebackIssue[]> => {
  const path = '[Content_Types].xml'
  const entry = zip.file(path)
  if (!entry) return [{ code: 'pptx.writeback.content-types-missing', message: 'The package has no content-types manifest.', partPath: path }]
  const nodes = parseXml(await entry.async('text'), path)
  const types = findNode(nodes, 'Types')
  if (!types) return [{ code: 'pptx.writeback.content-types-invalid', message: 'The package content-types manifest has no Types root.', partPath: path }]
  const children = ownChildren(types)
  const sourceName = `/${sourcePart}`
  const source = directNodes(children, 'Override').find(node => (
    nodeAttributes(node).PartName === sourceName
  ))
  if (!source) {
    const extension = posix.extname(sourcePart).slice(1).toLowerCase()
    const coveredByDefault = directNodes(children, 'Default').some(node => (
      (nodeAttributes(node).Extension ?? '').toLowerCase() === extension
    ))
    if (coveredByDefault) return []
    return [{
      code: 'pptx.writeback.content-type-source-missing',
      message: `No content type is registered for ${sourcePart}.`,
      partPath: path,
    }]
  }
  const targetName = `/${targetPart}`
  if (!directNodes(children, 'Override').some(node => nodeAttributes(node).PartName === targetName)) {
    const clone = structuredClone(source)
    nodeAttributes(clone).PartName = targetName
    children.push(clone)
    zip.file(path, xmlBuilder.build(nodes) as string)
  }
  return []
}

const clonedRelationshipSuffixes = new Set([
  'chart',
  'chartUserShapes',
  'comments',
  'diagramColors',
  'diagramData',
  'diagramLayout',
  'diagramQuickStyle',
  'notesSlide',
  'oleObject',
  'package',
])

const relationshipTypeSuffix = (type: string | undefined): string => (
  type?.slice(type.lastIndexOf('/') + 1) ?? ''
)

/**
 * Clone one package-owned dependency and every mutable dependency below it.
 * Shared resources (themes, layouts, masters and media) keep pointing at their
 * original package parts; editable payloads such as charts, embedded workbooks,
 * notes and SmartArt data receive independent part identities.
 */
const cloneOwnedPart = async (
  zip: JSZip,
  sourcePart: string,
  partMap: Map<string, string>,
): Promise<{ issues: PowerPointWritebackIssue[]; targetPart?: string }> => {
  const existing = partMap.get(sourcePart)
  if (existing) return { issues: [], targetPart: existing }
  const sourceEntry = zip.file(sourcePart)
  if (!sourceEntry) {
    return { issues: [{
      code: 'pptx.writeback.dependency-part-missing',
      message: 'A copied native object references a package dependency that no longer exists.',
      partPath: sourcePart,
    }] }
  }
  const targetPart = allocateSiblingPart(zip, sourcePart)
  // Register before descending so relationship cycles resolve to this clone.
  partMap.set(sourcePart, targetPart)
  zip.file(targetPart, await sourceEntry.async('uint8array'))
  const issues = await cloneContentTypeOverride(zip, sourcePart, targetPart)
  if (issues.length) return { issues }

  const relationshipPath = relationshipPartPath(sourcePart)
  const relationshipEntry = zip.file(relationshipPath)
  if (!relationshipEntry) return { issues: [], targetPart }
  const relationships = relationshipDocument(await relationshipEntry.async('text'), targetPart)
  for (const relationship of relationships.byId.values()) {
    const attributes = nodeAttributes(relationship)
    if (attributes.TargetMode === 'External' || !attributes.Target) continue
    const dependencySource = internalRelationshipTarget(sourcePart, attributes.Target)
    let dependencyTarget = partMap.get(dependencySource) ?? dependencySource
    if (clonedRelationshipSuffixes.has(relationshipTypeSuffix(attributes.Type))) {
      const cloned = await cloneOwnedPart(zip, dependencySource, partMap)
      issues.push(...cloned.issues)
      if (cloned.targetPart) dependencyTarget = cloned.targetPart
    }
    attributes.Target = relativeRelationshipTarget(targetPart, dependencyTarget)
  }
  if (issues.length) return { issues }
  const xml = serializeRelationshipDocument(relationships)
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return { issues: [{
      code: 'pptx.writeback.invalid-cloned-dependency-relationships',
      message: `Cloning a native dependency produced invalid relationships XML: ${validation.err.msg}`,
      partPath: relationships.path,
    }] }
  }
  zip.file(relationships.path, xml)
  return { issues: [], targetPart }
}

const clonePartRelationshipGraph = async (
  zip: JSZip,
  sourcePart: string,
  targetPart: string,
  partMap: Map<string, string>,
): Promise<PowerPointWritebackIssue[]> => {
  const sourcePath = relationshipPartPath(sourcePart)
  const sourceEntry = zip.file(sourcePath)
  if (!sourceEntry) return []
  const relationships = relationshipDocument(await sourceEntry.async('text'), targetPart)
  const issues: PowerPointWritebackIssue[] = []
  for (const relationship of relationships.byId.values()) {
    const attributes = nodeAttributes(relationship)
    if (attributes.TargetMode === 'External' || !attributes.Target) continue
    const dependencySource = internalRelationshipTarget(sourcePart, attributes.Target)
    let dependencyTarget = partMap.get(dependencySource) ?? dependencySource
    if (clonedRelationshipSuffixes.has(relationshipTypeSuffix(attributes.Type))) {
      const cloned = await cloneOwnedPart(zip, dependencySource, partMap)
      issues.push(...cloned.issues)
      if (cloned.targetPart) dependencyTarget = cloned.targetPart
    }
    attributes.Target = relativeRelationshipTarget(targetPart, dependencyTarget)
  }
  if (issues.length) return issues
  const xml = serializeRelationshipDocument(relationships)
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return [{
      code: 'pptx.writeback.invalid-cloned-relationships',
      message: `Cloning a native part produced invalid relationships XML: ${validation.err.msg}`,
      partPath: relationships.path,
    }]
  }
  zip.file(relationships.path, xml)
  return []
}

const numericIds = (nodes: readonly OrderedXmlNode[], expected: string): number[] => {
  const values: number[] = []
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === expected) {
          const value = Number(nodeAttributes(node).id)
          if (Number.isSafeInteger(value)) values.push(value)
        }
        visit(children)
      }
    }
  }
  visit(nodes)
  return values
}

const relationByType = (
  relationships: RelationshipDocument,
  suffix: string,
): OrderedXmlNode | undefined => directNodes(relationships.children, 'Relationship').find(node => (
  (nodeAttributes(node).Type ?? '').endsWith(`/${suffix}`)
))

const registerPrivateMaster = async (
  zip: JSZip,
  masterPart: string,
): Promise<PowerPointWritebackIssue[]> => {
  const presentationPart = 'ppt/presentation.xml'
  const relationshipEntry = zip.file(relationshipPartPath(presentationPart))
  const presentationEntry = zip.file(presentationPart)
  if (!relationshipEntry || !presentationEntry) {
    return [{
      code: 'pptx.writeback.presentation-part-missing',
      message: 'The package cannot register a private master because its presentation root is incomplete.',
      partPath: presentationPart,
    }]
  }
  const relationships = relationshipDocument(await relationshipEntry.async('text'), presentationPart)
  const relationshipId = nextRelationshipId(relationships)
  const relationship = xmlNode('Relationship', [], {
    Id: relationshipId,
    Target: relativeRelationshipTarget(presentationPart, masterPart),
    Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  })
  relationships.children.push(relationship)
  relationships.byId.set(relationshipId, relationship)
  zip.file(relationships.path, serializeRelationshipDocument(relationships))

  const nodes = parseXml(await presentationEntry.async('text'), presentationPart)
  const list = findNode(nodes, 'sldMasterIdLst')
  if (!list) {
    return [{
      code: 'pptx.writeback.master-list-missing',
      message: 'The presentation has no slide-master list to receive a private master.',
      partPath: presentationPart,
    }]
  }
  const nextId = Math.max(2_147_483_647, ...numericIds(nodes, 'sldMasterId')) + 1
  ownChildren(list).push(xmlNode('p:sldMasterId', [], {
    id: String(nextId),
    'r:id': relationshipId,
  }))
  zip.file(presentationPart, xmlBuilder.build(nodes) as string)
  return []
}

const registerSlide = async (
  zip: JSZip,
  slidePart: string,
  index: number,
  slideId: string,
): Promise<PowerPointWritebackIssue[]> => {
  const presentationPart = 'ppt/presentation.xml'
  const presentationEntry = zip.file(presentationPart)
  const relationshipPath = relationshipPartPath(presentationPart)
  const relationshipEntry = zip.file(relationshipPath)
  if (!presentationEntry || !relationshipEntry) {
    return [{
      code: 'pptx.writeback.presentation-part-missing',
      message: 'The package cannot register a copied slide because its presentation root is incomplete.',
      partPath: !presentationEntry ? presentationPart : relationshipPath,
      slideId,
    }]
  }
  const presentationNodes = parseXml(await presentationEntry.async('text'), presentationPart)
  const slideList = findNode(presentationNodes, 'sldIdLst')
  if (!slideList) {
    return [{
      code: 'pptx.writeback.slide-list-missing',
      message: 'The presentation has no slide list to receive the copied slide.',
      partPath: presentationPart,
      slideId,
    }]
  }
  const relationships = relationshipDocument(await relationshipEntry.async('text'), presentationPart)
  const relationshipId = nextRelationshipId(relationships)
  const relationship = xmlNode('Relationship', [], {
    Id: relationshipId,
    Target: relativeRelationshipTarget(presentationPart, slidePart),
    Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  })
  relationships.children.push(relationship)
  relationships.byId.set(relationshipId, relationship)

  const slideIds = ownChildren(slideList)
  const nextId = Math.max(255, ...numericIds(presentationNodes, 'sldId')) + 1
  const insertionIndex = Math.max(0, Math.min(index, slideIds.length))
  slideIds.splice(insertionIndex, 0, xmlNode('p:sldId', [], {
    id: String(nextId),
    'r:id': relationshipId,
  }))

  const presentationXml = xmlBuilder.build(presentationNodes) as string
  const relationshipXml = serializeRelationshipDocument(relationships)
  const presentationValidation = XMLValidator.validate(presentationXml, { allowBooleanAttributes: false })
  const relationshipValidation = XMLValidator.validate(relationshipXml, { allowBooleanAttributes: false })
  if (presentationValidation !== true || relationshipValidation !== true) {
    return [{
      code: 'pptx.writeback.invalid-slide-registration',
      message: presentationValidation !== true
        ? `Registering a copied slide produced invalid presentation XML: ${presentationValidation.err.msg}`
        : `Registering a copied slide produced invalid relationships XML: ${relationshipValidation === true ? '' : relationshipValidation.err.msg}`,
      partPath: presentationValidation !== true ? presentationPart : relationshipPath,
      slideId,
    }]
  }
  zip.file(presentationPart, presentationXml)
  zip.file(relationshipPath, relationshipXml)
  return []
}

interface PrivateHierarchyRequest {
  hiddenObjectIds: Set<string>
  layoutPart: string
  masterPart: string
  slideId: string
  slidePart: string
}

const createPrivateHierarchy = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  request: PrivateHierarchyRequest,
): Promise<PowerPointWritebackIssue[]> => {
  const layoutEntry = zip.file(request.layoutPart)
  const masterEntry = zip.file(request.masterPart)
  if (!layoutEntry || !masterEntry) {
    return [{
      code: 'pptx.writeback.private-hierarchy-source-missing',
      message: 'The retained layout/master pair needed for a slide-local inherited edit is incomplete.',
      partPath: !layoutEntry ? request.layoutPart : request.masterPart,
      slideId: request.slideId,
    }]
  }
  const privateLayout = allocateSiblingPart(zip, request.layoutPart)
  const privateMaster = allocateSiblingPart(zip, request.masterPart)
  const layoutNodes = parseXml(await layoutEntry.async('text'), request.layoutPart)
  const masterNodes = parseXml(await masterEntry.async('text'), request.masterPart)
  const knownObjects = new Map(manifest.objects.map(object => [object.stableId, object]))
  for (const objectId of request.hiddenObjectIds) {
    const source = knownObjects.get(objectId)
    if (!source || (source.partPath !== request.layoutPart && source.partPath !== request.masterPart)) {
      return [{
        code: 'pptx.writeback.inherited-object-source',
        message: 'A slide-local inherited edit no longer resolves to this slide’s retained layout or master.',
        objectId,
        partPath: source?.partPath,
        slideId: request.slideId,
      }]
    }
    const targetNodes = source.partPath === request.layoutPart ? layoutNodes : masterNodes
    const location = findDrawingNode(targetNodes, manifest.packageId, source.partPath, objectId)
    if (!location) {
      return [{
        code: 'pptx.writeback.inherited-object-missing',
        message: 'The private hierarchy source no longer contains the inherited object being hidden or overridden.',
        objectId,
        partPath: source.partPath,
        slideId: request.slideId,
      }]
    }
    location.siblings.splice(location.index, 1)
  }

  const layoutRelationshipPath = relationshipPartPath(request.layoutPart)
  const masterRelationshipPath = relationshipPartPath(request.masterPart)
  const layoutRelationshipEntry = zip.file(layoutRelationshipPath)
  const masterRelationshipEntry = zip.file(masterRelationshipPath)
  if (!layoutRelationshipEntry || !masterRelationshipEntry) {
    return [{
      code: 'pptx.writeback.private-hierarchy-relationships-missing',
      message: 'The retained layout/master relationship graph is incomplete.',
      partPath: !layoutRelationshipEntry ? layoutRelationshipPath : masterRelationshipPath,
      slideId: request.slideId,
    }]
  }
  const layoutRelationships = relationshipDocument(
    await layoutRelationshipEntry.async('text'),
    privateLayout,
  )
  const masterRelationships = relationshipDocument(
    await masterRelationshipEntry.async('text'),
    privateMaster,
  )
  const layoutMasterRelationship = relationByType(layoutRelationships, 'slideMaster')
  if (!layoutMasterRelationship) {
    return [{
      code: 'pptx.writeback.layout-master-relationship-missing',
      message: 'The retained layout has no slide-master relationship.',
      partPath: layoutRelationshipPath,
      slideId: request.slideId,
    }]
  }
  nodeAttributes(layoutMasterRelationship).Target = relativeRelationshipTarget(privateLayout, privateMaster)

  for (let index = masterRelationships.children.length - 1; index >= 0; index -= 1) {
    const relationship = masterRelationships.children[index]!
    if (!(nodeAttributes(relationship).Type ?? '').endsWith('/slideLayout')) continue
    const id = nodeAttributes(relationship).Id
    if (id) masterRelationships.byId.delete(id)
    masterRelationships.children.splice(index, 1)
  }
  const privateLayoutRelationshipId = nextRelationshipId(masterRelationships)
  const privateLayoutRelationship = xmlNode('Relationship', [], {
    Id: privateLayoutRelationshipId,
    Target: relativeRelationshipTarget(privateMaster, privateLayout),
    Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  })
  masterRelationships.children.push(privateLayoutRelationship)
  masterRelationships.byId.set(privateLayoutRelationshipId, privateLayoutRelationship)
  const layoutList = findNode(masterNodes, 'sldLayoutIdLst')
  if (!layoutList) {
    return [{
      code: 'pptx.writeback.layout-list-missing',
      message: 'The retained master has no slide-layout list.',
      partPath: request.masterPart,
      slideId: request.slideId,
    }]
  }
  const nextLayoutId = Math.max(0, ...numericIds(masterNodes, 'sldLayoutId')) + 1
  const layoutListChildren = ownChildren(layoutList)
  removeDirectNodes(layoutListChildren, new Set(['sldLayoutId']))
  layoutListChildren.push(xmlNode('p:sldLayoutId', [], {
    id: String(nextLayoutId),
    'r:id': privateLayoutRelationshipId,
  }))

  zip.file(privateLayout, xmlBuilder.build(layoutNodes) as string)
  zip.file(privateMaster, xmlBuilder.build(masterNodes) as string)
  zip.file(relationshipPartPath(privateLayout), serializeRelationshipDocument(layoutRelationships))
  zip.file(relationshipPartPath(privateMaster), serializeRelationshipDocument(masterRelationships))
  const contentTypeIssues = [
    ...await cloneContentTypeOverride(zip, request.layoutPart, privateLayout),
    ...await cloneContentTypeOverride(zip, request.masterPart, privateMaster),
  ]
  if (contentTypeIssues.length) return contentTypeIssues
  const registrationIssues = await registerPrivateMaster(zip, privateMaster)
  if (registrationIssues.length) return registrationIssues

  const slideRelationshipPath = relationshipPartPath(request.slidePart)
  const slideRelationshipEntry = zip.file(slideRelationshipPath)
  if (!slideRelationshipEntry) {
    return [{
      code: 'pptx.writeback.slide-layout-relationship-missing',
      message: 'The target slide has no relationship part to retarget to its private layout.',
      partPath: slideRelationshipPath,
      slideId: request.slideId,
    }]
  }
  const slideRelationships = relationshipDocument(
    await slideRelationshipEntry.async('text'),
    request.slidePart,
  )
  const slideLayoutRelationship = relationByType(slideRelationships, 'slideLayout')
  if (!slideLayoutRelationship) {
    return [{
      code: 'pptx.writeback.slide-layout-relationship-missing',
      message: 'The target slide has no native slide-layout relationship.',
      partPath: slideRelationshipPath,
      slideId: request.slideId,
    }]
  }
  nodeAttributes(slideLayoutRelationship).Target = relativeRelationshipTarget(request.slidePart, privateLayout)
  zip.file(slideRelationshipPath, serializeRelationshipDocument(slideRelationships))
  return []
}

const createHyperlinkRelationshipEditor = (
  xml: string | undefined,
  partPath: string,
): HyperlinkRelationshipEditor => {
  const path = relationshipPartPath(partPath)
  const nodes = xml
    ? parseXml(xml, path)
    : [xmlNode('Relationships', [], {
        xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships',
      })]
  const root = findNode(nodes, 'Relationships') ?? nodes[0]!
  const relationships = ownChildren(root)
  const byId = new Map<string, OrderedXmlNode>()
  for (const relationship of directNodes(relationships, 'Relationship')) {
    const id = nodeAttributes(relationship).Id
    if (id) byId.set(id, relationship)
  }
  const editor: HyperlinkRelationshipEditor = {
    dirty: false,
    path,
    patchRun: (runNode, target, operation) => {
      const runChildren = ownChildren(runNode)
      const properties = ensureDirectNode(runChildren, 'rPr', 'a:rPr', 0)
      const propertyChildren = ownChildren(properties)
      const hyperlink = directNode(propertyChildren, 'hlinkClick')
      const relationshipId = hyperlink ? nodeAttributes(hyperlink)['r:id'] : undefined
      if (!target) {
        if (hyperlink) {
          removeDirectNodes(propertyChildren, new Set(['hlinkClick']))
          editor.dirty = true
        }
        return undefined
      }
      if (!/^(?:https?:|mailto:|tel:)/i.test(target)) {
        return {
          code: 'pptx.writeback.hyperlink-target',
          elementId: operation.elementId,
          message: 'Only external web, email, and telephone run hyperlinks can be changed safely in this writeback slice.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }
      }
      if (relationshipId) {
        const relationship = byId.get(relationshipId)
        if (!relationship) {
          return {
            code: 'pptx.writeback.hyperlink-relationship',
            elementId: operation.elementId,
            message: `The native run references missing relationship ${relationshipId}.`,
            objectId: operation.objectId,
            partPath: operation.partPath,
            slideId: operation.slideId,
          }
        }
        const attributes = nodeAttributes(relationship)
        if (!/\/hyperlink$/i.test(attributes.Type ?? '')) {
          return {
            code: 'pptx.writeback.hyperlink-relationship',
            elementId: operation.elementId,
            message: `Relationship ${relationshipId} is not a native PowerPoint hyperlink.`,
            objectId: operation.objectId,
            partPath: operation.partPath,
            slideId: operation.slideId,
          }
        }
        attributes.Target = target
        attributes.TargetMode = 'External'
        editor.dirty = true
        return undefined
      }
      let numericId = 1
      while (byId.has(`rId${numericId}`)) numericId += 1
      const id = `rId${numericId}`
      const relationship = xmlNode('Relationship', [], {
        Id: id,
        Target: target,
        TargetMode: 'External',
        Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
      })
      relationships.push(relationship)
      byId.set(id, relationship)
      insertBeforeHyperlinks(propertyChildren, xmlNode('a:hlinkClick', [], { 'r:id': id }))
      editor.dirty = true
      return undefined
    },
    serialize: () => xmlBuilder.build(nodes) as string,
  }
  return editor
}

const removeDirectNodes = (
  nodes: OrderedXmlNode[],
  names: ReadonlySet<string>,
): void => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const tag = nodeTag(nodes[index]!)
    if (tag && names.has(localName(tag))) nodes.splice(index, 1)
  }
}

const ensureDirectNode = (
  nodes: OrderedXmlNode[],
  expected: string,
  tag: string,
  index = nodes.length,
): OrderedXmlNode => {
  const existing = directNode(nodes, expected)
  if (existing) return existing
  const created = xmlNode(tag)
  nodes.splice(index, 0, created)
  return created
}

const escapeXmlText = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const findNotesTextBody = (
  nodes: readonly OrderedXmlNode[],
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      if (localName(tag) === 'sp') {
        const placeholder = findNode(children, 'ph')
        if (placeholder && nodeAttributes(placeholder).type === 'body') {
          const textBody = findNode(children, 'txBody')
          if (textBody) return textBody
        }
      }
      const nested = findNotesTextBody(children)
      if (nested) return nested
    }
  }
  return undefined
}

const patchNotesPart = (
  xml: string,
  operation: PowerPointNotesPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.notesPart)
  const textBody = findNotesTextBody(nodes)
  if (!textBody) {
    return {
      issues: [{
        code: 'pptx.writeback.notes-body',
        message: 'The native notes part has no body placeholder to receive speaker notes.',
        partPath: operation.notesPart,
        slideId: operation.slideId,
      }],
      xml,
    }
  }
  const children = ownChildren(textBody)
  const paragraphs = directNodes(children, 'p')
  const paragraphProperties = paragraphs[0]
    ? directNode(ownChildren(paragraphs[0]), 'pPr')
    : undefined
  const firstRun = paragraphs[0]
    ? directNodes(ownChildren(paragraphs[0]), 'r')[0]
    : undefined
  const authored = parseAuthoredText(operation.after)
  const unsupportedRun = authored.flatMap(paragraph => paragraph.runs).find(run => (
    Boolean(run.hyperlink) || run.kind === 'field'
  ))
  if (unsupportedRun) {
    return {
      issues: [{
        code: unsupportedRun.hyperlink
          ? 'pptx.writeback.notes-hyperlink'
          : 'pptx.writeback.notes-field',
        message: unsupportedRun.hyperlink
          ? 'Adding or changing a speaker-notes hyperlink requires relationship-aware notes writeback.'
          : 'Creating a field in speaker notes requires a typed field serializer.',
        partPath: operation.notesPart,
        slideId: operation.slideId,
      }],
      xml,
    }
  }
  const insertionIndex = paragraphs.length ? children.indexOf(paragraphs[0]!) : children.length
  removeDirectNodes(children, new Set(['p']))
  const replacement = (authored.length ? authored : [{ runs: [], style: {} }]).map(paragraph => {
    const paragraphChildren: OrderedXmlNode[] = []
    if (paragraphProperties) paragraphChildren.push(structuredClone(paragraphProperties))
    for (const run of paragraph.runs) {
      const runNode = plainRunFrom(firstRun, run.kind)
      if (run.kind === 'text') setTextNode(runNode, run.text)
      patchRunProperties({
        after: { ...paragraph.style, ...run.style },
        before: {},
        node: runNode,
        scale: operation.scale ?? 96 / 72,
      })
      paragraphChildren.push(runNode)
    }
    return xmlNode('a:p', paragraphChildren)
  })
  children.splice(insertionIndex, 0, ...replacement)
  const patchedXml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  return validation === true
    ? { issues: [], xml: patchedXml }
    : {
        issues: [{
          code: 'pptx.writeback.invalid-notes-output',
          message: `Speaker-notes writeback produced invalid XML: ${validation.err.msg}`,
          partPath: operation.notesPart,
          slideId: operation.slideId,
        }],
        xml,
      }
}

const patchCommentsPart = (
  xml: string,
  operation: PowerPointCommentsPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.partPath)
  const pending = new Map(operation.changes.map(change => [change.id, change]))
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === 'cm') {
          const attributes = nodeAttributes(node)
          const id = attributes.idx ?? attributes.id
          const change = id ? pending.get(id) : undefined
          if (change) {
            const textNode = findNode(children, 'text')
            if (textNode) {
              const textChildren = ownChildren(textNode)
              const value = textChildren.find(child => '#text' in child)
              if (value) value['#text'] = escapeXmlText(change.after)
              else textChildren.push({ '#text': escapeXmlText(change.after) })
              pending.delete(id!)
            }
          }
        }
        visit(children)
      }
    }
  }
  visit(nodes)
  const issues: PowerPointWritebackIssue[] = [...pending.values()].map(change => ({
    code: 'pptx.writeback.comment-missing',
    message: `The retained comments part no longer contains comment ${change.id}.`,
    partPath: operation.partPath,
    slideId: operation.slideId,
  }))
  if (issues.length) return { issues, xml }
  const patchedXml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  return validation === true
    ? { issues: [], xml: patchedXml }
    : {
        issues: [{
          code: 'pptx.writeback.invalid-comments-output',
          message: `Comment writeback produced invalid XML: ${validation.err.msg}`,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }],
        xml,
      }
}

const backgroundFillNode = (
  background: PowerPointBackgroundPatch['after'],
): OrderedXmlNode => {
  if (background?.type === 'gradient' && background.gradient) {
    return xmlNode('a:gradFill', [
      xmlNode('a:gsLst', background.gradient.colors.map(stop => (
        xmlNode('a:gs', [xmlNode('a:srgbClr', [], {
          val: normalizeColor(stop.color) ?? '000000',
        })], { pos: String(Math.max(0, Math.min(100_000, Math.round(stop.pos * 1000)))) })
      ))),
      background.gradient.type === 'linear'
        ? xmlNode('a:lin', [], {
            ang: String(Math.round(background.gradient.rotate * 60_000)),
            scaled: '1',
          })
        : xmlNode('a:path', [xmlNode('a:fillToRect')], { path: 'circle' }),
    ], { rotWithShape: '1' })
  }
  if (background?.type === 'pattern' && background.pattern) {
    return xmlNode('a:pattFill', [
      xmlNode('a:fgClr', [xmlNode('a:srgbClr', [], {
        val: normalizeColor(background.pattern.foregroundColor) ?? '000000',
      })]),
      xmlNode('a:bgClr', [xmlNode('a:srgbClr', [], {
        val: normalizeColor(background.pattern.backgroundColor) ?? 'FFFFFF',
      })]),
    ], { prst: background.pattern.patternType })
  }
  const color = normalizeColor(background?.color)
  return color
    ? xmlNode('a:solidFill', [xmlNode('a:srgbClr', [], { val: color })])
    : xmlNode('a:noFill')
}

const patchBackgroundPart = (
  xml: string,
  operation: PowerPointBackgroundPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.partPath)
  const commonSlideData = findNode(nodes, 'cSld')
  if (!commonSlideData) {
    return {
      issues: [{
        code: 'pptx.writeback.background-structure',
        message: 'The native slide has no common slide data element for a local background.',
        partPath: operation.partPath,
        slideId: operation.slideId,
      }],
      xml,
    }
  }
  const children = ownChildren(commonSlideData)
  removeDirectNodes(children, new Set(['bg']))
  if (operation.after) {
    children.unshift(xmlNode('p:bg', [
      xmlNode('p:bgPr', [backgroundFillNode(operation.after)], { shadeToTitle: '0' }),
    ]))
  }
  const patchedXml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  return validation === true
    ? { issues: [], xml: patchedXml }
    : {
        issues: [{
          code: 'pptx.writeback.invalid-background-output',
          message: `Slide-background writeback produced invalid XML: ${validation.err.msg}`,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }],
        xml,
      }
}

const removeNestedNodes = (
  nodes: OrderedXmlNode[],
  expected: string,
): void => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!
    const tag = nodeTag(node)
    if (tag && localName(tag) === expected) {
      nodes.splice(index, 1)
      continue
    }
    for (const [, children] of nodeEntries(node)) removeNestedNodes(children, expected)
  }
}

const patchAccessibility = (
  children: OrderedXmlNode[],
  operation: PowerPointAccessibilityPatch,
): PowerPointWritebackIssue[] => {
  const nonVisual = findNode(children, 'cNvPr')
  if (!nonVisual) {
    return [{
      code: 'pptx.writeback.accessibility-missing',
      elementId: operation.elementId,
      message: 'The source object has no nonvisual properties for accessibility metadata.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const attributes = nodeAttributes(nonVisual)
  for (const [attribute, value] of [
    ['descr', operation.after?.description],
    ['title', operation.after?.title],
  ] as const) {
    if (value) attributes[attribute] = value
    else delete attributes[attribute]
  }
  if (operation.after?.hidden) attributes.hidden = '1'
  else delete attributes.hidden

  const nonVisualChildren = ownChildren(nonVisual)
  const decorative = findNode(nonVisualChildren, 'decorative')
  if (operation.after?.decorative !== undefined) {
    if (decorative) nodeAttributes(decorative).val = operation.after.decorative ? '1' : '0'
    else {
      const extensionList = ensureDirectNode(nonVisualChildren, 'extLst', 'a:extLst')
      ownChildren(extensionList).push(xmlNode('a:ext', [
        xmlNode('a16:decorative', [], {
          'xmlns:a16': 'http://schemas.microsoft.com/office/drawing/2014/main',
          val: operation.after.decorative ? '1' : '0',
        }),
      ], { uri: '{C183D7F6-B498-43B3-948B-1728B52AA6E4}' }))
    }
  }
  else if (decorative) removeNestedNodes(nonVisualChildren, 'decorative')
  return []
}

const parseCssNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const result = Number.parseFloat(value)
  return Number.isFinite(result) ? result : undefined
}

const normalizeFontFamily = (value: string | undefined): string | undefined => {
  const family = value?.split(',')[0]?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
  return family || undefined
}

const normalizeColor = (value: string | undefined): string | undefined => {
  if (!value || value === 'transparent') return undefined
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length === 3
      ? [...hex].map(entry => `${entry}${entry}`).join('')
      : hex.slice(0, 6)
    return expanded.toUpperCase()
  }
  const rgb = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i)
  if (!rgb) return undefined
  return rgb.slice(1, 4).map(entry => (
    Math.max(0, Math.min(255, Math.round(Number(entry)))).toString(16).padStart(2, '0')
  )).join('').toUpperCase()
}

const styleValue = (style: AuthoredTextStyle, property: string): string | undefined => (
  style[property]?.trim().toLowerCase()
)

const styleChanged = (
  before: AuthoredTextStyle,
  after: AuthoredTextStyle,
  property: string,
): boolean => styleValue(before, property) !== styleValue(after, property)

const setBooleanAttribute = (
  attributes: Record<string, string>,
  name: string,
  value: boolean,
): void => {
  attributes[name] = value ? '1' : '0'
}

const insertBeforeHyperlinks = (
  children: OrderedXmlNode[],
  node: OrderedXmlNode,
): void => {
  const index = children.findIndex(child => {
    const tag = nodeTag(child)
    return tag && ['hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'].includes(localName(tag))
  })
  children.splice(index < 0 ? children.length : index, 0, node)
}

const replaceSolidColor = (
  children: OrderedXmlNode[],
  color: string | undefined,
  fillNames: ReadonlySet<string>,
): void => {
  removeDirectNodes(children, fillNames)
  if (!color) return
  children.unshift(xmlNode('a:solidFill', [
    xmlNode('a:srgbClr', [], { val: color }),
  ]))
}

const patchRunProperties = ({
  after,
  before,
  forceColor,
  forceFont,
  forceSpacing,
  node,
  scale,
}: {
  after: AuthoredTextStyle
  before: AuthoredTextStyle
  forceColor?: string
  forceFont?: string
  forceSpacing?: number
  node: OrderedXmlNode
  scale: number
}): void => {
  const runChildren = ownChildren(node)
  const rPr = ensureDirectNode(runChildren, 'rPr', 'a:rPr', 0)
  const attributes = nodeAttributes(rPr)
  const rPrChildren = ownChildren(rPr)
  if (styleChanged(before, after, 'font-weight')) {
    const weight = styleValue(after, 'font-weight')
    setBooleanAttribute(attributes, 'b', weight === 'bold' || Number.parseInt(weight ?? '0', 10) >= 600)
  }
  if (styleChanged(before, after, 'font-style')) {
    setBooleanAttribute(attributes, 'i', styleValue(after, 'font-style') === 'italic')
  }
  if (styleChanged(before, after, 'text-decoration-line')) {
    const decoration = styleValue(after, 'text-decoration-line') ?? ''
    attributes.u = decoration.includes('underline') ? 'sng' : 'none'
    attributes.strike = decoration.includes('line-through') ? 'sngStrike' : 'noStrike'
  }
  if (styleChanged(before, after, 'vertical-align')) {
    const value = styleValue(after, 'vertical-align')
    attributes.baseline = value === 'super' ? '30000' : value === 'sub' ? '-25000' : '0'
  }
  if (styleChanged(before, after, 'text-transform')) {
    attributes.cap = styleValue(after, 'text-transform') === 'uppercase' ? 'all' : 'none'
  }
  if (styleChanged(before, after, 'font-variant-caps')) {
    attributes.cap = styleValue(after, 'font-variant-caps') === 'small-caps' ? 'small' : 'none'
  }
  if (styleChanged(before, after, 'font-size')) {
    const size = parseCssNumber(after['font-size'])
    if (size !== undefined) attributes.sz = String(Math.max(100, Math.round(size / scale * 100)))
    else delete attributes.sz
  }
  if (forceSpacing !== undefined || styleChanged(before, after, 'letter-spacing')) {
    const spacing = forceSpacing ?? parseCssNumber(after['letter-spacing'])
    if (spacing !== undefined) attributes.spc = String(Math.round(spacing / scale * 100))
    else delete attributes.spc
  }
  const fontChanged = forceFont !== undefined || styleChanged(before, after, 'font-family')
  if (fontChanged) {
    const font = forceFont || normalizeFontFamily(after['font-family'])
    removeDirectNodes(rPrChildren, new Set(['latin', 'ea', 'cs']))
    if (font) {
      for (const tag of ['a:latin', 'a:ea', 'a:cs']) {
        insertBeforeHyperlinks(rPrChildren, xmlNode(tag, [], { typeface: font }))
      }
    }
  }
  const colorChanged = forceColor !== undefined || styleChanged(before, after, 'color')
  if (colorChanged) {
    replaceSolidColor(
      rPrChildren,
      normalizeColor(forceColor ?? after.color),
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
}

const setTextNode = (run: OrderedXmlNode, value: string): void => {
  const children = ownChildren(run)
  let text = directNode(children, 't')
  if (!text) {
    text = xmlNode('a:t')
    children.push(text)
  }
  const textChildren = ownChildren(text)
  const textValue = textChildren.find(child => '#text' in child)
  if (textValue) textValue['#text'] = escapeXmlText(value)
  else textChildren.push({ '#text': escapeXmlText(value) })
  const attributes = nodeAttributes(text)
  if (/^\s|\s$/.test(value)) attributes['xml:space'] = 'preserve'
  else delete attributes['xml:space']
}

const runKind = (node: OrderedXmlNode): AuthoredTextRun['kind'] => {
  const tag = localName(nodeTag(node) ?? '')
  return tag === 'br' ? 'break' : tag === 'tab' ? 'tab' : tag === 'fld' ? 'field' : 'text'
}

const plainRunFrom = (
  template: OrderedXmlNode | undefined,
  kind: AuthoredTextRun['kind'],
): OrderedXmlNode => {
  if (kind === 'break') return xmlNode('a:br')
  if (kind === 'tab') return xmlNode('a:tab')
  const templateRPr = template ? directNode(ownChildren(template), 'rPr') : undefined
  const clonedRPr = templateRPr ? structuredClone(templateRPr) : undefined
  if (clonedRPr) {
    removeDirectNodes(ownChildren(clonedRPr), new Set(['hlinkClick', 'hlinkMouseOver']))
  }
  const children = clonedRPr ? [clonedRPr] : []
  children.push(xmlNode('a:t'))
  return xmlNode('a:r', children)
}

interface RunTemplate {
  node: OrderedXmlNode
  run: AuthoredTextRun | undefined
}

interface ParagraphTemplate {
  node: OrderedXmlNode
  paragraph: AuthoredTextParagraph | undefined
  runs: Map<string, RunTemplate>
}

const xmlRunNodes = (paragraph: OrderedXmlNode): OrderedXmlNode[] => ownChildren(paragraph).filter(node => (
  ['br', 'fld', 'r', 'tab'].includes(localName(nodeTag(node) ?? ''))
))

const sourceText = (node: OrderedXmlNode): string => {
  const text = directNode(ownChildren(node), 't')
  if (!text) return ''
  const value = ownChildren(text).find(child => '#text' in child)?.['#text']
  return typeof value === 'string' ? decodeXmlText(value) : ''
}

const decodeXmlText = (value: string): string => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

const expandedRunCount = (node: OrderedXmlNode): number => {
  if (runKind(node) !== 'text' || !sourceText(node).includes('\t')) return 1
  const parts = sourceText(node).split('\t')
  return parts.filter(Boolean).length + parts.length - 1
}

const buildTemplates = (
  textBody: OrderedXmlNode,
  before: PowerPointTextPatch['before'],
): {
  bySource: Map<string, ParagraphTemplate>
  fallback?: ParagraphTemplate
  ordered: ParagraphTemplate[]
} => {
  const authored = parseAuthoredText(before.content)
  const structured = before.structuredText?.paragraphs ?? []
  const ordered = directNodes(ownChildren(textBody), 'p').map((node, paragraphIndex) => {
    const paragraph = authored[paragraphIndex]
    const structuredParagraph = structured[paragraphIndex]
    const runs = new Map<string, RunTemplate>()
    const authoredRuns = paragraph?.runs ?? []
    const structuredRuns = structuredParagraph?.runs ?? []
    let logicalIndex = 0
    for (const runNode of xmlRunNodes(node)) {
      const count = expandedRunCount(runNode)
      for (let offset = 0; offset < count; offset += 1) {
        const sourceId = structuredRuns[logicalIndex]?.sourceId ?? authoredRuns[logicalIndex]?.sourceId
        if (sourceId) runs.set(sourceId, { node: runNode, run: authoredRuns[logicalIndex] })
        logicalIndex += 1
      }
    }
    return {
      node,
      paragraph,
      runs,
    }
  })
  const bySource = new Map<string, ParagraphTemplate>()
  for (let index = 0; index < ordered.length; index += 1) {
    const sourceId = structured[index]?.sourceId ?? authored[index]?.sourceId
    if (sourceId) bySource.set(sourceId, ordered[index]!)
  }
  return { bySource, fallback: ordered[0], ordered }
}

const patchSpacing = (
  pPrChildren: OrderedXmlNode[],
  name: 'lnSpc' | 'spcAft' | 'spcBef',
  value: number,
  unit: 'percent' | 'points',
): void => {
  removeDirectNodes(pPrChildren, new Set([name]))
  pPrChildren.unshift(xmlNode(`a:${name}`, [
    unit === 'percent'
      ? xmlNode('a:spcPct', [], { val: String(Math.round(value * 100_000)) })
      : xmlNode('a:spcPts', [], { val: String(Math.round(value * 100)) }),
  ]))
}

const patchParagraphProperties = ({
  after,
  before,
  node,
  scale,
}: {
  after: AuthoredTextParagraph
  before: AuthoredTextParagraph | undefined
  node: OrderedXmlNode
  scale: number
}): void => {
  const children = ownChildren(node)
  const pPr = ensureDirectNode(children, 'pPr', 'a:pPr', 0)
  const attributes = nodeAttributes(pPr)
  const pPrChildren = ownChildren(pPr)
  if (after.level) attributes.lvl = String(Math.max(0, Math.min(8, after.level)))
  else delete attributes.lvl
  if (styleChanged(before?.style ?? {}, after.style, 'text-align')) {
    const align = styleValue(after.style, 'text-align')
    const mapped = align === 'center' ? 'ctr' : align === 'justify' ? 'just' : align === 'right' ? 'r' : 'l'
    attributes.algn = mapped
  }
  if (styleChanged(before?.style ?? {}, after.style, 'direction')) {
    setBooleanAttribute(attributes, 'rtl', styleValue(after.style, 'direction') === 'rtl')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'padding-left')) {
    const value = parseCssNumber(after.style['padding-left'])
    if (value !== undefined) attributes.marL = String(Math.round(value / scale * 12_700))
    else delete attributes.marL
  }
  if (styleChanged(before?.style ?? {}, after.style, 'text-indent')) {
    const value = parseCssNumber(after.style['text-indent'])
    if (value !== undefined) attributes.indent = String(Math.round(value / scale * 12_700))
    else delete attributes.indent
  }
  if (styleChanged(before?.style ?? {}, after.style, 'line-height')) {
    const value = parseCssNumber(after.style['line-height'])
    if (value !== undefined) patchSpacing(pPrChildren, 'lnSpc', value, 'percent')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'margin-top')) {
    const value = parseCssNumber(after.style['margin-top'])
    if (value !== undefined) patchSpacing(pPrChildren, 'spcBef', value / scale, 'points')
  }
  if (styleChanged(before?.style ?? {}, after.style, 'margin-bottom')) {
    const value = parseCssNumber(after.style['margin-bottom'])
    if (value !== undefined) patchSpacing(pPrChildren, 'spcAft', value / scale, 'points')
  }
  if (JSON.stringify(before?.list) !== JSON.stringify(after.list)) {
    removeDirectNodes(pPrChildren, new Set(['buAutoNum', 'buBlip', 'buChar', 'buNone']))
    if (!after.list) pPrChildren.push(xmlNode('a:buNone'))
    else if (after.list.type === 'number') {
      pPrChildren.push(xmlNode('a:buAutoNum', [], {
        ...(after.list.startAt ? { startAt: String(after.list.startAt) } : {}),
        type: 'arabicPeriod',
      }))
    }
    else pPrChildren.push(xmlNode('a:buChar', [], { char: '•' }))
  }
}

const patchBodyProperties = (
  textBody: OrderedXmlNode,
  operation: PowerPointTextPatch,
  scale: number,
): void => {
  const bodyChildren = ownChildren(textBody)
  const bodyPr = ensureDirectNode(bodyChildren, 'bodyPr', 'a:bodyPr', 0)
  const attributes = nodeAttributes(bodyPr)
  if (JSON.stringify(operation.before.inset) !== JSON.stringify(operation.after.inset)) {
    const [top, right, bottom, left] = operation.after.inset ?? [0, 0, 0, 0]
    attributes.tIns = String(Math.round(top / scale * 12_700))
    attributes.rIns = String(Math.round(right / scale * 12_700))
    attributes.bIns = String(Math.round(bottom / scale * 12_700))
    attributes.lIns = String(Math.round(left / scale * 12_700))
  }
  if (operation.before.columns !== operation.after.columns) {
    if (operation.after.columns && operation.after.columns > 1) {
      attributes.numCol = String(Math.max(1, Math.round(operation.after.columns)))
    }
    else delete attributes.numCol
  }
  if (operation.before.columnGap !== operation.after.columnGap) {
    if (operation.after.columnGap !== undefined) {
      attributes.spcCol = String(Math.round(operation.after.columnGap / scale * 12_700))
    }
    else delete attributes.spcCol
  }
  if (operation.before.vAlign !== operation.after.vAlign) {
    attributes.anchor = operation.after.vAlign === 'middle'
      ? 'ctr'
      : operation.after.vAlign === 'bottom'
        ? 'b'
        : 't'
  }
  if (operation.before.fixedHeight !== operation.after.fixedHeight) {
    const children = ownChildren(bodyPr)
    removeDirectNodes(children, new Set(['noAutofit', 'normAutofit', 'spAutoFit']))
    children.push(xmlNode(operation.after.fixedHeight ? 'a:noAutofit' : 'a:spAutoFit'))
  }
  const beforeWarp = operation.before.structuredText?.bodyProperties?.textWarp
  const afterWarp = operation.after.structuredText?.bodyProperties?.textWarp
  if (afterWarp && JSON.stringify(beforeWarp) !== JSON.stringify(afterWarp)) {
    const children = ownChildren(bodyPr)
    removeDirectNodes(children, new Set(['prstTxWarp']))
    children.unshift(xmlNode('a:prstTxWarp', [
      xmlNode('a:avLst', Object.entries(afterWarp.adjustments).flatMap(([name, value]) => (
        name && Number.isFinite(value)
          ? [xmlNode('a:gd', [], { fmla: `val ${Math.round(value)}`, name })]
          : []
      ))),
    ], { prst: afterWarp.preset }))
  }
}

const sourceScale = (
  xfrm: OrderedXmlNode | undefined,
  beforeWidth: number,
  retainedScale: number | undefined,
): number | undefined => {
  if (retainedScale && retainedScale > 0) return retainedScale
  const ext = xfrm ? findNode(ownChildren(xfrm), 'ext') : undefined
  const cx = numericAttribute(ext, 'cx')
  if (!cx || beforeWidth <= 0) return undefined
  return beforeWidth * 12_700 / cx
}

const patchText = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointTextPatch,
  relationshipEditor?: HyperlinkRelationshipEditor,
): PowerPointWritebackIssue[] => {
  const textBody = findNode(children, 'txBody')
  const scale = sourceScale(xfrm, operation.beforeWidth, operation.scale)
  if (!textBody || !scale) {
    return [{
      code: textBody ? 'pptx.writeback.text-scale' : 'pptx.writeback.text-body-missing',
      elementId: operation.elementId,
      message: textBody
        ? 'The retained text body has no exact canvas-to-PowerPoint scale.'
        : 'The source object has no editable PowerPoint text body.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const beforeAuthored = parseAuthoredText(operation.before.content)
  const afterAuthored = parseAuthoredText(operation.after.content)
  const baselineRuns = new Map<string, AuthoredTextRun>()
  for (let paragraphIndex = 0; paragraphIndex < beforeAuthored.length; paragraphIndex += 1) {
    const authoredParagraph = beforeAuthored[paragraphIndex]
    const retainedParagraph = operation.before.structuredText?.paragraphs[paragraphIndex]
    for (let runIndex = 0; runIndex < (retainedParagraph?.runs.length ?? 0); runIndex += 1) {
      const retainedRun = retainedParagraph!.runs[runIndex]!
      const authoredRun = authoredParagraph?.runs[runIndex]
      baselineRuns.set(retainedRun.sourceId, {
        ...(retainedRun.fieldId ? { fieldId: retainedRun.fieldId } : {}),
        ...(retainedRun.fieldType ? { fieldType: retainedRun.fieldType } : {}),
        ...(retainedRun.hyperlink ? { hyperlink: retainedRun.hyperlink } : {}),
        kind: retainedRun.kind,
        sourceId: retainedRun.sourceId,
        style: authoredRun?.style ?? authoredParagraph?.style ?? {},
        text: retainedRun.text ?? authoredRun?.text ?? '',
      })
    }
  }
  for (const paragraph of beforeAuthored) {
    for (const run of paragraph.runs) {
      if (run.sourceId && !baselineRuns.has(run.sourceId)) baselineRuns.set(run.sourceId, run)
    }
  }
  const issues: PowerPointWritebackIssue[] = []
  for (const paragraph of afterAuthored) {
    for (const run of paragraph.runs) {
      const baseline = run.sourceId ? baselineRuns.get(run.sourceId) : undefined
      if (
        baseline?.hyperlink !== run.hyperlink
        && (baseline?.hyperlink || run.hyperlink)
        && !relationshipEditor
      ) {
        issues.push({
          code: 'pptx.writeback.hyperlink-relationship',
          elementId: operation.elementId,
          message: 'Adding, removing, or changing a PowerPoint hyperlink requires relationship-aware writeback.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
      if (run.kind === 'field' && !baseline) {
        issues.push({
          code: 'pptx.writeback.field',
          elementId: operation.elementId,
          message: 'Creating a PowerPoint field requires a typed field serializer.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
      if (baseline?.kind === 'field' && (
        run.kind !== 'field'
        || run.fieldId !== baseline.fieldId
        || run.fieldType !== baseline.fieldType
        || run.text !== baseline.text
      )) {
        issues.push({
          code: 'pptx.writeback.field',
          elementId: operation.elementId,
          message: 'PowerPoint fields are preserved, but their definition or materialized value cannot be edited yet.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
      }
    }
  }
  if (issues.length) return issues

  patchBodyProperties(textBody, operation, scale)
  const templates = buildTemplates(textBody, operation.before)
  const bodyChildren = ownChildren(textBody)
  const oldParagraphs = directNodes(bodyChildren, 'p')
  const insertAt = oldParagraphs.length
    ? bodyChildren.indexOf(oldParagraphs[0]!)
    : bodyChildren.length
  removeDirectNodes(bodyChildren, new Set(['p']))
  const forceFont = operation.before.defaultFontName !== operation.after.defaultFontName
    ? operation.after.defaultFontName
    : undefined
  const forceColor = operation.before.defaultColor !== operation.after.defaultColor
    ? operation.after.defaultColor
    : undefined
  const forceSpacing = operation.before.wordSpace !== operation.after.wordSpace
    ? operation.after.wordSpace ?? 0
    : undefined

  const patchedParagraphs = afterAuthored.map((paragraph, paragraphIndex) => {
    const template = (paragraph.sourceId ? templates.bySource.get(paragraph.sourceId) : undefined)
      ?? templates.ordered[Math.min(paragraphIndex, templates.ordered.length - 1)]
      ?? templates.fallback
    const paragraphNode = template
      ? structuredClone(template.node)
      : xmlNode('a:p')
    patchParagraphProperties({
      after: paragraph,
      before: template?.paragraph,
      node: paragraphNode,
      scale,
    })
    const paragraphChildren = ownChildren(paragraphNode)
    const oldRuns = xmlRunNodes(paragraphNode)
    const endPropertiesIndex = paragraphChildren.findIndex(child => (
      localName(nodeTag(child) ?? '') === 'endParaRPr'
    ))
    const runInsertAt = oldRuns.length
      ? paragraphChildren.indexOf(oldRuns[0]!)
      : endPropertiesIndex < 0
        ? paragraphChildren.length
        : endPropertiesIndex
    removeDirectNodes(paragraphChildren, new Set(['br', 'fld', 'r', 'tab']))
    const newRuns = paragraph.runs.map(run => {
      const exact = run.sourceId ? template?.runs.get(run.sourceId) : undefined
      const baseline = run.sourceId ? baselineRuns.get(run.sourceId) : undefined
      let runNode = exact && runKind(exact.node) === run.kind
        ? structuredClone(exact.node)
        : plainRunFrom(exact?.node ?? xmlRunNodes(template?.node ?? xmlNode('a:p'))[0], run.kind)
      if (run.kind === 'field' && exact) runNode = structuredClone(exact.node)
      if (run.kind === 'text' || run.kind === 'field') setTextNode(runNode, run.text)
      if (run.kind !== 'tab') {
        patchRunProperties({
          after: run.style,
          before: baseline?.style ?? {},
          ...(forceColor !== undefined ? { forceColor } : {}),
          ...(forceFont !== undefined ? { forceFont } : {}),
          ...(forceSpacing !== undefined ? { forceSpacing } : {}),
          node: runNode,
          scale,
        })
      }
      if (baseline?.hyperlink !== run.hyperlink && relationshipEditor) {
        const issue = relationshipEditor.patchRun(runNode, run.hyperlink, operation)
        if (issue) issues.push(issue)
      }
      return runNode
    })
    paragraphChildren.splice(runInsertAt < 0 ? paragraphChildren.length : runInsertAt, 0, ...newRuns)
    const pPr = directNode(paragraphChildren, 'pPr')
    if (pPr) {
      const pPrChildren = ownChildren(pPr)
      const defaultRun = directNode(pPrChildren, 'defRPr')
      if (defaultRun && (forceFont !== undefined || forceColor !== undefined || forceSpacing !== undefined)) {
        patchRunProperties({
          after: paragraph.style,
          before: template?.paragraph?.style ?? {},
          ...(forceColor !== undefined ? { forceColor } : {}),
          ...(forceFont !== undefined ? { forceFont } : {}),
          ...(forceSpacing !== undefined ? { forceSpacing } : {}),
          node: xmlNode('a:r', [
            xmlNode('a:rPr', ownChildren(defaultRun), nodeAttributes(defaultRun)),
          ]),
          scale,
        })
      }
    }
    const endProperties = directNode(paragraphChildren, 'endParaRPr')
    if (endProperties && (forceFont !== undefined || forceColor !== undefined || forceSpacing !== undefined)) {
      patchRunProperties({
        after: paragraph.style,
        before: template?.paragraph?.style ?? {},
        ...(forceColor !== undefined ? { forceColor } : {}),
        ...(forceFont !== undefined ? { forceFont } : {}),
        ...(forceSpacing !== undefined ? { forceSpacing } : {}),
        node: xmlNode('a:r', [
          xmlNode('a:rPr', ownChildren(endProperties), nodeAttributes(endProperties)),
        ]),
        scale,
      })
    }
    return paragraphNode
  })
  bodyChildren.splice(insertAt, 0, ...patchedParagraphs)

  if (operation.before.lineHeight !== operation.after.lineHeight) {
    for (const paragraph of patchedParagraphs) {
      const pPr = ensureDirectNode(ownChildren(paragraph), 'pPr', 'a:pPr', 0)
      patchSpacing(ownChildren(pPr), 'lnSpc', operation.after.lineHeight ?? 1, 'percent')
    }
  }
  if (operation.before.paragraphSpace !== operation.after.paragraphSpace) {
    for (const paragraph of patchedParagraphs) {
      const pPr = ensureDirectNode(ownChildren(paragraph), 'pPr', 'a:pPr', 0)
      patchSpacing(
        ownChildren(pPr),
        'spcAft',
        (operation.after.paragraphSpace ?? 0) / scale,
        'points',
      )
    }
  }
  return []
}

const tableCellTextSnapshot = (
  cell: PowerPointTablePatch['after']['data'][number][number] | undefined,
): PowerPointTextPatch['after'] => ({
  content: cell?.text ?? '',
  defaultColor: cell?.style?.color ?? '#000000',
  defaultFontName: cell?.style?.fontname ?? '',
  ...(cell?.structuredText ? { structuredText: structuredClone(cell.structuredText) } : {}),
})

const createEmptyTableCellNode = (): OrderedXmlNode => xmlNode('a:tc', [
  xmlNode('a:txBody', [
    xmlNode('a:bodyPr'),
    xmlNode('a:lstStyle'),
    xmlNode('a:p', [xmlNode('a:endParaRPr')]),
  ]),
  xmlNode('a:tcPr'),
])

const patchTableCellBorder = (
  children: OrderedXmlNode[],
  name: string,
  before: PowerPointTablePatch['before']['outline'] | undefined,
  after: PowerPointTablePatch['after']['outline'] | undefined,
  scale: number,
): void => {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  const line = ensureDirectNode(children, name, `a:${name}`)
  const attributes = nodeAttributes(line)
  const lineChildren = ownChildren(line)
  if (!after?.width || after.width <= 0) {
    delete attributes.w
    removeDirectNodes(lineChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
    lineChildren.unshift(xmlNode('a:noFill'))
    return
  }
  attributes.w = String(Math.max(0, Math.round(after.width / scale * 12_700)))
  replaceSolidColor(
    lineChildren,
    normalizeColor(after.color),
    new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
  )
  removeDirectNodes(lineChildren, new Set(['custDash', 'prstDash']))
  insertLineProperty(
    lineChildren,
    xmlNode('a:prstDash', [], {
      val: after.style === 'dotted' ? 'dot' : after.style === 'dashed' ? 'dash' : 'solid',
    }),
    new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
  )
}

const patchTableCellProperties = (
  cellNode: OrderedXmlNode,
  before: PowerPointTablePatch['before']['data'][number][number] | undefined,
  after: PowerPointTablePatch['after']['data'][number][number],
  fallbackBeforeOutline: PowerPointTablePatch['before']['outline'],
  fallbackAfterOutline: PowerPointTablePatch['after']['outline'],
  scale: number,
): void => {
  const children = ownChildren(cellNode)
  const properties = ensureDirectNode(children, 'tcPr', 'a:tcPr')
  const attributes = nodeAttributes(properties)
  const propertyChildren = ownChildren(properties)
  if (before?.style?.vAlign !== after.style?.vAlign) {
    attributes.anchor = after.style?.vAlign === 'middle'
      ? 'ctr'
      : after.style?.vAlign === 'bottom'
        ? 'b'
        : 't'
  }
  if (JSON.stringify(before?.margin) !== JSON.stringify(after.margin)) {
    const [top, right, bottom, left] = after.margin ?? [0, 0, 0, 0]
    attributes.marT = String(Math.round(top / scale * 12_700))
    attributes.marR = String(Math.round(right / scale * 12_700))
    attributes.marB = String(Math.round(bottom / scale * 12_700))
    attributes.marL = String(Math.round(left / scale * 12_700))
  }
  if (before?.style?.backcolor !== after.style?.backcolor) {
    removeDirectNodes(propertyChildren, new Set([
      'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
    ]))
    const color = normalizeColor(after.style?.backcolor)
    propertyChildren.push(color
      ? xmlNode('a:solidFill', [xmlNode('a:srgbClr', [], { val: color })])
      : xmlNode('a:noFill'))
  }
  const borderTags = {
    bottom: 'lnB',
    diagonalDown: 'lnTlToBr',
    diagonalUp: 'lnBlToTr',
    left: 'lnL',
    right: 'lnR',
    top: 'lnT',
  } as const
  for (const [side, tag] of Object.entries(borderTags) as Array<[
    keyof typeof borderTags,
    string,
  ]>) {
    patchTableCellBorder(
      propertyChildren,
      tag,
      before?.borders?.[side] ?? fallbackBeforeOutline,
      after.borders?.[side] ?? fallbackAfterOutline,
      scale,
    )
  }
}

interface TableMergePosition {
  anchorColumn: number
  anchorRow: number
  columnSpan: number
  rowSpan: number
}

const tableMergePositions = (
  data: PowerPointTablePatch['after']['data'],
): Map<string, TableMergePosition> => {
  const positions = new Map<string, TableMergePosition>()
  for (let row = 0; row < data.length; row += 1) {
    for (let column = 0; column < (data[row]?.length ?? 0); column += 1) {
      if (positions.has(`${row}:${column}`)) continue
      const cell = data[row]![column]!
      const rowSpan = Math.max(1, Math.round(cell.rowspan || 1))
      const columnSpan = Math.max(1, Math.round(cell.colspan || 1))
      for (let targetRow = row; targetRow < row + rowSpan; targetRow += 1) {
        for (let targetColumn = column; targetColumn < column + columnSpan; targetColumn += 1) {
          positions.set(`${targetRow}:${targetColumn}`, {
            anchorColumn: column,
            anchorRow: row,
            columnSpan,
            rowSpan,
          })
        }
      }
    }
  }
  return positions
}

const patchTableProperties = (
  table: OrderedXmlNode,
  operation: PowerPointTablePatch,
): void => {
  if (
    JSON.stringify(operation.before.powerPointTable)
    === JSON.stringify(operation.after.powerPointTable)
  ) return
  const children = ownChildren(table)
  const properties = ensureDirectNode(children, 'tblPr', 'a:tblPr', 0)
  const attributes = nodeAttributes(properties)
  const after = operation.after.powerPointTable
  if (!after) return
  for (const [attribute, value] of [
    ['bandCol', after.bandColumn],
    ['bandRow', after.bandRow],
    ['firstCol', after.firstColumn],
    ['firstRow', after.firstRow],
    ['lastCol', after.lastColumn],
    ['lastRow', after.lastRow],
    ['rtl', after.rightToLeft],
  ] as const) {
    if (value) attributes[attribute] = '1'
    else delete attributes[attribute]
  }
  const propertyChildren = ownChildren(properties)
  let style = directNode(propertyChildren, 'tableStyleId')
  if (after.styleId) {
    style ??= ensureDirectNode(propertyChildren, 'tableStyleId', 'a:tableStyleId')
    ownChildren(style).splice(0, ownChildren(style).length, { '#text': escapeXmlText(after.styleId) })
  }
  else if (style) propertyChildren.splice(propertyChildren.indexOf(style), 1)
}

const patchTable = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointTablePatch,
): PowerPointWritebackIssue[] => {
  const table = findNode(children, 'tbl')
  const scale = operation.scale
  if (!table || !scale || scale <= 0) {
    return [{
      code: table ? 'pptx.writeback.table-scale' : 'pptx.writeback.table-missing',
      elementId: operation.elementId,
      message: table
        ? 'The retained table has no exact canvas-to-PowerPoint scale.'
        : 'The retained graphic frame no longer contains a PowerPoint table.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const tableChildren = ownChildren(table)
  patchTableProperties(table, operation)
  const grid = ensureDirectNode(tableChildren, 'tblGrid', 'a:tblGrid', 1)
  const gridChildren = ownChildren(grid)
  removeDirectNodes(gridChildren, new Set(['gridCol']))
  const columnCount = operation.after.data[0]?.length ?? 0
  const normalizedWidths = operation.after.colWidths.length === columnCount
    ? operation.after.colWidths
    : new Array<number>(columnCount).fill(1 / Math.max(1, columnCount))
  gridChildren.push(...normalizedWidths.map(width => xmlNode('a:gridCol', [], {
    w: String(Math.max(1, Math.round(width * operation.after.width / scale * 12_700))),
  })))

  const originalRows = directNodes(tableChildren, 'tr')
  const originalCells = originalRows.map(row => directNodes(ownChildren(row), 'tc'))
  const originalByCoordinate = new Map<string, OrderedXmlNode>()
  for (let row = 0; row < operation.before.data.length; row += 1) {
    for (let column = 0; column < (operation.before.data[row]?.length ?? 0); column += 1) {
      const source = operation.before.data[row]![column]!.powerPointCell
      const cellNode = originalCells[row]?.[column]
      if (source && cellNode) {
        originalByCoordinate.set(`${source.rowIndex}:${source.columnIndex}`, cellNode)
      }
    }
  }
  removeDirectNodes(tableChildren, new Set(['tr']))
  const mergePositions = tableMergePositions(operation.after.data)
  const issues: PowerPointWritebackIssue[] = []
  const rows = operation.after.data.map((row, rowIndex) => {
    const sourceRowIndex = row.find(cell => cell.powerPointCell)?.powerPointCell?.rowIndex
    const rowNode = sourceRowIndex !== undefined && originalRows[sourceRowIndex]
      ? structuredClone(originalRows[sourceRowIndex]!)
      : xmlNode('a:tr')
    const rowChildren = ownChildren(rowNode)
    removeDirectNodes(rowChildren, new Set(['tc']))
    const rowAttributes = nodeAttributes(rowNode)
    const rowHeight = operation.after.rowHeights?.[rowIndex]
      ?? operation.after.cellMinHeight
    rowAttributes.h = String(Math.max(1, Math.round(rowHeight / scale * 12_700)))
    const cells = row.map((cell, columnIndex) => {
      const source = cell.powerPointCell
      const beforeCell = source
        ? operation.before.data[source.rowIndex]?.[source.columnIndex]
        : undefined
      const sourceNode = source
        ? originalByCoordinate.get(`${source.rowIndex}:${source.columnIndex}`)
        : undefined
      const cellNode = sourceNode ? structuredClone(sourceNode) : createEmptyTableCellNode()
      const attributes = nodeAttributes(cellNode)
      for (const name of ['gridSpan', 'hMerge', 'rowSpan', 'vMerge']) delete attributes[name]
      const merge = mergePositions.get(`${rowIndex}:${columnIndex}`)
      if (merge) {
        if (merge.anchorRow === rowIndex && merge.anchorColumn === columnIndex) {
          if (merge.columnSpan > 1) attributes.gridSpan = String(merge.columnSpan)
          if (merge.rowSpan > 1) attributes.rowSpan = String(merge.rowSpan)
        }
        else {
          if (columnIndex > merge.anchorColumn) attributes.hMerge = '1'
          if (rowIndex > merge.anchorRow) attributes.vMerge = '1'
        }
      }
      patchTableCellProperties(
        cellNode,
        beforeCell,
        cell,
        operation.before.outline,
        operation.after.outline,
        scale,
      )
      const beforeText = tableCellTextSnapshot(beforeCell)
      const afterText = tableCellTextSnapshot(cell)
      if (JSON.stringify(beforeText) !== JSON.stringify(afterText)) {
        issues.push(...patchText(ownChildren(cellNode), xfrm, {
          after: afterText,
          before: beforeText,
          beforeWidth: operation.beforeWidth,
          elementId: `${operation.elementId}:r${rowIndex}c${columnIndex}`,
          kind: 'text',
          objectId: operation.objectId,
          partPath: operation.partPath,
          scale,
          slideId: operation.slideId,
        }))
      }
      return cellNode
    })
    rowChildren.unshift(...cells)
    return rowNode
  })
  const extensionIndex = tableChildren.findIndex(node => localName(nodeTag(node) ?? '') === 'extLst')
  tableChildren.splice(extensionIndex < 0 ? tableChildren.length : extensionIndex, 0, ...rows)
  return issues
}

const patchShapeStyle = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointShapeStylePatch,
): PowerPointWritebackIssue[] => {
  const spPr = findNode(children, 'spPr')
  const scale = sourceScale(xfrm, operation.beforeWidth, operation.scale)
  if (!spPr || !scale) {
    return [{
      code: spPr ? 'pptx.writeback.style-scale' : 'pptx.writeback.shape-properties-missing',
      elementId: operation.elementId,
      message: spPr
        ? 'The retained shape has no exact canvas-to-PowerPoint scale.'
        : 'The retained source object has no editable shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const spPrChildren = ownChildren(spPr)
  if (
    operation.before.fill !== operation.after.fill
    || JSON.stringify(operation.before.gradient) !== JSON.stringify(operation.after.gradient)
    || operation.before.pattern !== operation.after.pattern
    || JSON.stringify(operation.before.patternFit) !== JSON.stringify(operation.after.patternFit)
    || JSON.stringify(operation.before.powerPointPattern) !== JSON.stringify(operation.after.powerPointPattern)
  ) {
    const existingPictureFill = directNode(spPrChildren, 'blipFill')
    if (operation.after.pattern !== undefined && existingPictureFill) {
      const fillChildren = ownChildren(existingPictureFill)
      removeDirectNodes(fillChildren, new Set(['stretch', 'tile']))
      const fit = operation.after.patternFit
      if (fit?.mode === 'tile') {
        fillChildren.push(xmlNode('a:tile', [], {
          ...(fit.alignment ? { algn: fit.alignment } : {}),
          ...(fit.scaleX !== undefined ? { sx: String(Math.round(fit.scaleX * 100_000)) } : {}),
          ...(fit.scaleY !== undefined ? { sy: String(Math.round(fit.scaleY * 100_000)) } : {}),
        }))
      }
      else {
        const rect = fit?.rect
        fillChildren.push(xmlNode('a:stretch', [xmlNode('a:fillRect', [], {
          ...(rect?.b !== undefined ? { b: String(Math.round(rect.b * 100_000)) } : {}),
          ...(rect?.l !== undefined ? { l: String(Math.round(rect.l * 100_000)) } : {}),
          ...(rect?.r !== undefined ? { r: String(Math.round(rect.r * 100_000)) } : {}),
          ...(rect?.t !== undefined ? { t: String(Math.round(rect.t * 100_000)) } : {}),
        })]))
      }
    }
    else {
      removeDirectNodes(spPrChildren, new Set([
        'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
      ]))
      let fill: OrderedXmlNode
      if (operation.after.gradient) {
        const gradient = operation.after.gradient
        const stops = gradient.colors.map(stop => {
          const color = normalizeColor(stop.color) ?? '000000'
          return xmlNode('a:gs', [xmlNode('a:srgbClr', [], { val: color })], {
            pos: String(Math.max(0, Math.min(100_000, Math.round(stop.pos * 1000)))),
          })
        })
        fill = xmlNode('a:gradFill', [
          xmlNode('a:gsLst', stops),
          gradient.type === 'linear'
            ? xmlNode('a:lin', [], { ang: String(Math.round(gradient.rotate * 60_000)), scaled: '1' })
            : xmlNode('a:path', [xmlNode('a:fillToRect')], { path: 'circle' }),
        ], { rotWithShape: '1' })
      }
      else if (operation.after.powerPointPattern) {
        const pattern = operation.after.powerPointPattern
        fill = xmlNode('a:pattFill', [
          xmlNode('a:fgClr', [xmlNode('a:srgbClr', [], {
            val: normalizeColor(pattern.foregroundColor) ?? '000000',
          })]),
          xmlNode('a:bgClr', [xmlNode('a:srgbClr', [], {
            val: normalizeColor(pattern.backgroundColor) ?? 'FFFFFF',
          })]),
        ], { prst: pattern.patternType })
      }
      else {
        const color = normalizeColor(operation.after.fill)
        fill = color
          ? xmlNode('a:solidFill', [xmlNode('a:srgbClr', [], { val: color })])
          : xmlNode('a:noFill')
      }
      const geometryIndex = spPrChildren.findIndex(node => (
        ['custGeom', 'prstGeom'].includes(localName(nodeTag(node) ?? ''))
      ))
      spPrChildren.splice(geometryIndex < 0 ? 0 : geometryIndex + 1, 0, fill)
    }
  }
  if (JSON.stringify(operation.before.outline) !== JSON.stringify(operation.after.outline)) {
    const line = ensureDirectNode(spPrChildren, 'ln', 'a:ln')
    const lineAttributes = nodeAttributes(line)
    const lineChildren = ownChildren(line)
    const outline = operation.after.outline
    if (!outline || !outline.width || outline.width <= 0) {
      removeDirectNodes(lineChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
      lineChildren.unshift(xmlNode('a:noFill'))
      delete lineAttributes.w
    }
    else {
      lineAttributes.w = String(Math.round(outline.width / scale * 12_700))
      replaceSolidColor(
        lineChildren,
        normalizeColor(outline.color),
        new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
      )
      removeDirectNodes(lineChildren, new Set(['prstDash']))
      lineChildren.push(xmlNode('a:prstDash', [], {
        val: outline.style === 'dotted' ? 'dot' : outline.style === 'dashed' ? 'dash' : 'solid',
      }))
    }
  }
  return []
}

const percentNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const patchImageOutline = (
  shapeProperties: OrderedXmlNode,
  operation: PowerPointImagePatch,
): PowerPointWritebackIssue[] => {
  if (JSON.stringify(operation.before.outline) === JSON.stringify(operation.after.outline)) return []
  if (!operation.scale || operation.scale <= 0) {
    return [{
      code: 'pptx.writeback.image-scale',
      elementId: operation.elementId,
      message: 'The retained picture has no exact canvas-to-PowerPoint scale for its outline.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const children = ownChildren(shapeProperties)
  const line = ensureDirectNode(children, 'ln', 'a:ln')
  const lineChildren = ownChildren(line)
  const lineAttributes = nodeAttributes(line)
  const outline = operation.after.outline
  if (!outline?.width || outline.width <= 0) {
    removeDirectNodes(lineChildren, new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']))
    lineChildren.unshift(xmlNode('a:noFill'))
    delete lineAttributes.w
    return []
  }
  lineAttributes.w = String(Math.round(outline.width / operation.scale * 12_700))
  replaceSolidColor(
    lineChildren,
    normalizeColor(outline.color),
    new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
  )
  removeDirectNodes(lineChildren, new Set(['custDash', 'prstDash']))
  lineChildren.push(xmlNode('a:prstDash', [], {
    val: outline.style === 'dotted' ? 'dot' : outline.style === 'dashed' ? 'dash' : 'solid',
  }))
  return []
}

const patchImageShadow = (
  shapeProperties: OrderedXmlNode,
  operation: PowerPointImagePatch,
): PowerPointWritebackIssue[] => {
  if (JSON.stringify(operation.before.shadow) === JSON.stringify(operation.after.shadow)) return []
  if (!operation.scale || operation.scale <= 0) {
    return [{
      code: 'pptx.writeback.image-scale',
      elementId: operation.elementId,
      message: 'The retained picture has no exact canvas-to-PowerPoint scale for its shadow.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const properties = ownChildren(shapeProperties)
  let effects = directNode(properties, 'effectLst')
  const shadow = operation.after.shadow
  if (!shadow) {
    if (!effects) return []
    removeDirectNodes(ownChildren(effects), new Set(['outerShdw']))
    if (!ownChildren(effects).length) properties.splice(properties.indexOf(effects), 1)
    return []
  }
  effects ??= ensureDirectNode(properties, 'effectLst', 'a:effectLst')
  const effectChildren = ownChildren(effects)
  removeDirectNodes(effectChildren, new Set(['outerShdw']))
  const distance = Math.hypot(shadow.h, shadow.v)
  const direction = ((Math.atan2(shadow.v, shadow.h) * 180 / Math.PI) + 360) % 360
  const color = normalizeColor(shadow.color) ?? '000000'
  effectChildren.push(xmlNode('a:outerShdw', [
    xmlNode('a:srgbClr', [], { val: color }),
  ], {
    blurRad: String(Math.max(0, Math.round(shadow.blur / operation.scale * 12_700))),
    dir: String(Math.round(direction * 60_000)),
    dist: String(Math.max(0, Math.round(distance / operation.scale * 12_700))),
    rotWithShape: '0',
  }))
  return []
}

const patchImage = (
  children: OrderedXmlNode[],
  operation: PowerPointImagePatch,
): PowerPointWritebackIssue[] => {
  const blipFill = findNode(children, 'blipFill')
  const shapeProperties = findNode(children, 'spPr')
  if (!blipFill || !shapeProperties) {
    return [{
      code: 'pptx.writeback.image-structure',
      elementId: operation.elementId,
      message: 'The retained picture has no editable native blip fill or shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const fillChildren = ownChildren(blipFill)
  const blip = directNode(fillChildren, 'blip')
  if (!blip) {
    return [{
      code: 'pptx.writeback.image-blip',
      elementId: operation.elementId,
      message: 'The retained picture no longer contains its native image relationship.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  if (JSON.stringify(operation.before.clip) !== JSON.stringify(operation.after.clip)) {
    removeDirectNodes(fillChildren, new Set(['srcRect']))
    const range = operation.after.clip?.range
    if (range) {
      const [start, end] = range
      fillChildren.splice(1, 0, xmlNode('a:srcRect', [], {
        b: String(Math.round((100 - end[1]) * 1000)),
        l: String(Math.round(start[0] * 1000)),
        r: String(Math.round((100 - end[0]) * 1000)),
        t: String(Math.round(start[1] * 1000)),
      }))
    }
    const shapePropertiesChildren = ownChildren(shapeProperties)
    const geometry = directNode(shapePropertiesChildren, 'prstGeom')
    if (geometry && operation.after.clip?.shape) {
      nodeAttributes(geometry).prst = operation.after.clip.shape
    }
  }
  const blipChildren = ownChildren(blip)
  if (operation.before.opacity !== operation.after.opacity) {
    removeDirectNodes(blipChildren, new Set(['alphaModFix']))
    const opacity = operation.after.opacity
    if (opacity !== undefined && opacity < 0.999_999) {
      blipChildren.unshift(xmlNode('a:alphaModFix', [], {
        amt: String(Math.max(0, Math.min(100_000, Math.round(opacity * 100_000)))),
      }))
    }
  }
  if (JSON.stringify(operation.before.filters) !== JSON.stringify(operation.after.filters)) {
    removeDirectNodes(blipChildren, new Set(['lum', 'satMod']))
    const brightness = percentNumber(operation.after.filters?.brightness)
    const contrast = percentNumber(operation.after.filters?.contrast)
    if (brightness !== undefined || contrast !== undefined) {
      blipChildren.unshift(xmlNode('a:lum', [], {
        ...(brightness !== undefined ? { bright: String(Math.round((brightness / 100 - 1) * 100_000)) } : {}),
        ...(contrast !== undefined ? { contrast: String(Math.round((contrast / 100 - 1) * 100_000)) } : {}),
      }))
    }
    const saturation = percentNumber(operation.after.filters?.saturate)
    if (saturation !== undefined) {
      blipChildren.unshift(xmlNode('a:satMod', [], {
        val: String(Math.max(0, Math.round(saturation / 100 * 100_000))),
      }))
    }
  }
  return [
    ...patchImageOutline(shapeProperties, operation),
    ...patchImageShadow(shapeProperties, operation),
  ]
}

const connectorPoint = (
  connector: PowerPointConnectorPatch['before'],
  endpoint: 'end' | 'start',
): [number, number] => [
  connector.left + connector[endpoint][0],
  connector.top + connector[endpoint][1],
]

const connectorGeometryChanged = (operation: PowerPointConnectorPatch): boolean => (
  JSON.stringify({
    end: connectorPoint(operation.before, 'end'),
    start: connectorPoint(operation.before, 'start'),
  }) !== JSON.stringify({
    end: connectorPoint(operation.after, 'end'),
    start: connectorPoint(operation.after, 'start'),
  })
  || JSON.stringify({
    broken: operation.before.broken,
    broken2: operation.before.broken2,
    broken2Direction: operation.before.broken2Direction,
    cubic: operation.before.cubic,
    curve: operation.before.curve,
  }) !== JSON.stringify({
    broken: operation.after.broken,
    broken2: operation.after.broken2,
    broken2Direction: operation.after.broken2Direction,
    cubic: operation.after.cubic,
    curve: operation.after.curve,
  })
)

const insertLineProperty = (
  children: OrderedXmlNode[],
  node: OrderedXmlNode,
  afterNames: ReadonlySet<string>,
): void => {
  const index = children.findIndex(child => {
    const name = localName(nodeTag(child) ?? '')
    return !afterNames.has(name)
      && ['bevel', 'custDash', 'extLst', 'headEnd', 'miter', 'prstDash', 'round', 'tailEnd'].includes(name)
  })
  children.splice(index < 0 ? children.length : index, 0, node)
}

const patchConnectorMarker = (
  children: OrderedXmlNode[],
  name: 'headEnd' | 'tailEnd',
  before: PowerPointConnectorPatch['before']['points'][number],
  after: PowerPointConnectorPatch['after']['points'][number],
): void => {
  if (before === after) return
  const tag = `a:${name}`
  const node = ensureDirectNode(children, name, tag)
  const attributes = nodeAttributes(node)
  attributes.type = after === 'arrow' ? 'triangle' : after === 'dot' ? 'oval' : 'none'
  if (!after) {
    delete attributes.len
    delete attributes.w
  }
  const currentIndex = children.indexOf(node)
  if (currentIndex >= 0) children.splice(currentIndex, 1)
  const insertionIndex = children.findIndex(child => {
    const childName = localName(nodeTag(child) ?? '')
    return childName === 'extLst' || (name === 'headEnd' && childName === 'tailEnd')
  })
  children.splice(insertionIndex < 0 ? children.length : insertionIndex, 0, node)
}

const patchConnectorRelationships = (
  children: OrderedXmlNode[],
  operation: PowerPointConnectorPatch,
): PowerPointWritebackIssue[] => {
  if (
    JSON.stringify(operation.before.connections)
    === JSON.stringify(operation.after.connections)
  ) return []
  const nonVisual = findNode(children, 'cNvCxnSpPr')
  if (!nonVisual) {
    return [{
      code: 'pptx.writeback.connector-relationships-missing',
      elementId: operation.elementId,
      message: 'The source connector has no non-visual connector relationship container.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const relationshipChildren = ownChildren(nonVisual)
  removeDirectNodes(relationshipChildren, new Set(['endCxn', 'stCxn']))
  const append = (
    name: 'endCxn' | 'stCxn',
    endpoint: NonNullable<PowerPointConnectorPatch['after']['connections']>['end'],
  ) => {
    if (!endpoint) return
    relationshipChildren.push(xmlNode(`a:${name}`, [], {
      id: endpoint.nativeShapeId,
      idx: endpoint.siteIndex,
    }))
  }
  append('stCxn', operation.after.connections?.start)
  append('endCxn', operation.after.connections?.end)
  return []
}

const connectorRouteChanged = (operation: PowerPointConnectorPatch): boolean => (
  JSON.stringify({
    broken: operation.before.broken,
    broken2: operation.before.broken2,
    broken2Direction: operation.before.broken2Direction,
    cubic: operation.before.cubic,
    curve: operation.before.curve,
  }) !== JSON.stringify({
    broken: operation.after.broken,
    broken2: operation.after.broken2,
    broken2Direction: operation.after.broken2Direction,
    cubic: operation.after.cubic,
    curve: operation.after.curve,
  })
)

const replaceConnectorGeometry = (
  spPrChildren: OrderedXmlNode[],
  operation: PowerPointConnectorPatch,
): void => {
  if (!connectorRouteChanged(operation)) return
  const geometryIndex = spPrChildren.findIndex(node => (
    ['custGeom', 'prstGeom'].includes(localName(nodeTag(node) ?? ''))
  ))
  const insertAt = geometryIndex < 0 ? 1 : geometryIndex
  if (geometryIndex >= 0) spPrChildren.splice(geometryIndex, 1)
  const after = operation.after
  if (!after.broken && !after.broken2 && !after.curve && !after.cubic) {
    spPrChildren.splice(insertAt, 0, xmlNode('a:prstGeom', [xmlNode('a:avLst')], {
      prst: 'straightConnector1',
    }))
    return
  }

  const start = connectorPoint(after, 'start')
  const end = connectorPoint(after, 'end')
  const minX = Math.min(start[0], end[0])
  const minY = Math.min(start[1], end[1])
  const width = Math.abs(end[0] - start[0])
  const height = Math.abs(end[1] - start[1])
  const flipH = start[0] > end[0]
  const flipV = start[1] > end[1]
  const coordinate = (point: [number, number]): [number, number] => {
    let x = point[0] - minX
    let y = point[1] - minY
    if (flipH) x = width - x
    if (flipV) y = height - y
    return [
      width > 0 ? Math.round(x / width * 100_000) : 0,
      height > 0 ? Math.round(y / height * 100_000) : 0,
    ]
  }
  const pointNode = (point: [number, number]) => {
    const [x, y] = coordinate(point)
    return xmlNode('a:pt', [], { x: String(x), y: String(y) })
  }
  const route: OrderedXmlNode[] = [xmlNode('a:moveTo', [pointNode(start)])]
  if (after.broken) {
    route.push(xmlNode('a:lnTo', [pointNode([
      after.left + after.broken[0],
      after.top + after.broken[1],
    ])]))
    route.push(xmlNode('a:lnTo', [pointNode(end)]))
  }
  else if (after.broken2) {
    const control = [
      after.left + after.broken2[0],
      after.top + after.broken2[1],
    ] as [number, number]
    const horizontal = after.broken2Direction === 'horizontal'
      || (!after.broken2Direction && width >= height)
    const first = horizontal
      ? [control[0], start[1]] as [number, number]
      : [start[0], control[1]] as [number, number]
    const second = horizontal
      ? [control[0], end[1]] as [number, number]
      : [end[0], control[1]] as [number, number]
    route.push(xmlNode('a:lnTo', [pointNode(first)]))
    route.push(xmlNode('a:lnTo', [pointNode(second)]))
    route.push(xmlNode('a:lnTo', [pointNode(end)]))
  }
  else if (after.curve) {
    route.push(xmlNode('a:quadBezTo', [
      pointNode([after.left + after.curve[0], after.top + after.curve[1]]),
      pointNode(end),
    ]))
  }
  else if (after.cubic) {
    route.push(xmlNode('a:cubicBezTo', [
      pointNode([after.left + after.cubic[0][0], after.top + after.cubic[0][1]]),
      pointNode([after.left + after.cubic[1][0], after.top + after.cubic[1][1]]),
      pointNode(end),
    ]))
  }
  const custom = xmlNode('a:custGeom', [
    xmlNode('a:avLst'),
    xmlNode('a:gdLst'),
    xmlNode('a:ahLst'),
    xmlNode('a:cxnLst'),
    xmlNode('a:rect', [], { b: 'b', l: 'l', r: 'r', t: 't' }),
    xmlNode('a:pathLst', [
      xmlNode('a:path', route, {
        extrusionOk: '0',
        fill: 'none',
        h: '100000',
        stroke: '1',
        w: '100000',
      }),
    ]),
  ])
  spPrChildren.splice(insertAt, 0, custom)
}

const patchConnector = (
  children: OrderedXmlNode[],
  xfrm: OrderedXmlNode | undefined,
  operation: PowerPointConnectorPatch,
  coordinateContext?: ConnectorCoordinateContext,
): PowerPointWritebackIssue[] => {
  const issues = patchConnectorRelationships(children, operation)
  const spPr = findNode(children, 'spPr')
  if (!spPr) {
    return [{
      code: 'pptx.writeback.connector-properties-missing',
      elementId: operation.elementId,
      message: 'The retained line has no editable PowerPoint shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const spPrChildren = ownChildren(spPr)
  const trailingPropertyIndex = spPrChildren.findIndex(child => (
    ['effectDag', 'effectLst', 'extLst', 'scene3d', 'sp3d'].includes(
      localName(nodeTag(child) ?? ''),
    )
  ))
  const line = ensureDirectNode(
    spPrChildren,
    'ln',
    'a:ln',
    trailingPropertyIndex < 0 ? spPrChildren.length : trailingPropertyIndex,
  )
  const lineAttributes = nodeAttributes(line)
  const lineChildren = ownChildren(line)

  if (operation.before.width !== operation.after.width) {
    if (!operation.scale || operation.scale <= 0) {
      issues.push({
        code: 'pptx.writeback.connector-scale',
        elementId: operation.elementId,
        message: 'The retained line has no exact canvas-to-PowerPoint scale for its width.',
        objectId: operation.objectId,
        partPath: operation.partPath,
        slideId: operation.slideId,
      })
    }
    else {
      lineAttributes.w = String(Math.max(0, Math.round(
        operation.after.width / operation.scale * 12_700,
      )))
    }
  }
  if (operation.before.color !== operation.after.color) {
    replaceSolidColor(
      lineChildren,
      normalizeColor(operation.after.color),
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
  if (operation.before.style !== operation.after.style) {
    removeDirectNodes(lineChildren, new Set(['custDash', 'prstDash']))
    const dash = xmlNode('a:prstDash', [], {
      val: operation.after.style === 'dotted'
        ? 'dot'
        : operation.after.style === 'dashed'
          ? 'dash'
          : 'solid',
    })
    insertLineProperty(
      lineChildren,
      dash,
      new Set(['gradFill', 'noFill', 'pattFill', 'solidFill']),
    )
  }
  patchConnectorMarker(
    lineChildren,
    'headEnd',
    operation.before.points[0],
    operation.after.points[0],
  )
  patchConnectorMarker(
    lineChildren,
    'tailEnd',
    operation.before.points[1],
    operation.after.points[1],
  )
  replaceConnectorGeometry(spPrChildren, operation)

  if (!connectorGeometryChanged(operation)) return issues
  if (operation.parentObjectId && !coordinateContext) {
    issues.push({
      code: 'pptx.writeback.connector-group-transform',
      elementId: operation.elementId,
      message: 'The parent PowerPoint group has no complete child-coordinate transform.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })
    return issues
  }
  if (!xfrm || !operation.scale || operation.scale <= 0) {
    issues.push({
      code: xfrm ? 'pptx.writeback.connector-scale' : 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: xfrm
        ? 'The retained line has no exact canvas-to-PowerPoint scale for its geometry.'
        : 'The retained line has no explicit transform that Mona can patch safely.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })
    return issues
  }
  const xfrmChildren = ownChildren(xfrm)
  const off = directNode(xfrmChildren, 'off')
  const ext = directNode(xfrmChildren, 'ext')
  if (!off || !ext) {
    issues.push({
      code: 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: 'The retained line transform has no explicit offset and extent.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })
    return issues
  }
  const start = connectorPoint(operation.after, 'start')
  const end = connectorPoint(operation.after, 'end')
  const emuPerCanvasUnit = 12_700 / operation.scale
  const minX = Math.min(start[0], end[0])
  const minY = Math.min(start[1], end[1])
  const offAttributes = nodeAttributes(off)
  const extAttributes = nodeAttributes(ext)
  const xScale = coordinateContext?.scaleX ?? 1
  const yScale = coordinateContext?.scaleY ?? 1
  offAttributes.x = String(Math.round(
    (coordinateContext?.childOffsetX ?? 0) + minX * emuPerCanvasUnit / xScale,
  ))
  offAttributes.y = String(Math.round(
    (coordinateContext?.childOffsetY ?? 0) + minY * emuPerCanvasUnit / yScale,
  ))
  extAttributes.cx = String(Math.max(0, Math.round(
    Math.abs(end[0] - start[0]) * emuPerCanvasUnit / xScale,
  )))
  extAttributes.cy = String(Math.max(0, Math.round(
    Math.abs(end[1] - start[1]) * emuPerCanvasUnit / yScale,
  )))
  const transformAttributes = nodeAttributes(xfrm)
  delete transformAttributes.rot
  if (start[0] > end[0]) transformAttributes.flipH = '1'
  else delete transformAttributes.flipH
  if (start[1] > end[1]) transformAttributes.flipV = '1'
  else delete transformAttributes.flipV
  return issues
}

const patchShapeGeometry = (
  children: OrderedXmlNode[],
  operation: PowerPointShapeGeometryPatch,
): PowerPointWritebackIssue[] => {
  const geometry = operation.after.powerPointGeometry
  if (!geometry || !geometry.preset || geometry.preset === 'custom') {
    return [{
      code: 'pptx.writeback.shape-geometry',
      elementId: operation.elementId,
      message: 'Native preset geometry cannot be removed or replaced with an unaddressed custom path.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const shapeProperties = findNode(children, 'spPr')
  if (!shapeProperties) {
    return [{
      code: 'pptx.writeback.shape-properties-missing',
      elementId: operation.elementId,
      message: 'The retained shape has no editable PowerPoint shape properties.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const properties = ownChildren(shapeProperties)
  const custom = directNode(properties, 'custGeom')
  const preset = directNode(properties, 'prstGeom')
  if (custom && !preset) {
    return [{
      code: 'pptx.writeback.custom-geometry',
      elementId: operation.elementId,
      message: 'This shape uses native custom geometry; preset adjustment writeback cannot replace its path definition.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const geometryNode = preset ?? xmlNode('a:prstGeom')
  if (!preset) {
    const transformIndex = properties.findIndex(node => localName(nodeTag(node) ?? '') === 'xfrm')
    properties.splice(transformIndex < 0 ? 0 : transformIndex + 1, 0, geometryNode)
  }
  nodeAttributes(geometryNode).prst = geometry.preset
  const geometryChildren = ownChildren(geometryNode)
  const adjustmentList = ensureDirectNode(geometryChildren, 'avLst', 'a:avLst', 0)
  const adjustments = ownChildren(adjustmentList)
  removeDirectNodes(adjustments, new Set(['gd']))
  for (const [name, value] of Object.entries(geometry.adjustments)) {
    if (!name || !Number.isFinite(value)) continue
    adjustments.push(xmlNode('a:gd', [], {
      fmla: `val ${Math.round(value)}`,
      name,
    }))
  }
  return []
}

const connectorChildCoordinateContext = (
  xfrm: OrderedXmlNode | undefined,
): ConnectorCoordinateContext | undefined => {
  if (!xfrm) return undefined
  const children = ownChildren(xfrm)
  const ext = directNode(children, 'ext')
  const childOffset = directNode(children, 'chOff')
  const childExtent = directNode(children, 'chExt')
  const width = numericAttribute(ext, 'cx')
  const height = numericAttribute(ext, 'cy')
  const childWidth = numericAttribute(childExtent, 'cx')
  const childHeight = numericAttribute(childExtent, 'cy')
  const childOffsetX = numericAttribute(childOffset, 'x')
  const childOffsetY = numericAttribute(childOffset, 'y')
  if (
    width === undefined
    || height === undefined
    || childWidth === undefined
    || childHeight === undefined
    || childOffsetX === undefined
    || childOffsetY === undefined
    || childWidth === 0
    || childHeight === 0
  ) return undefined
  return {
    childOffsetX,
    childOffsetY,
    scaleX: width / childWidth,
    scaleY: height / childHeight,
  }
}

const normalizedRotation = (degrees: number): number => {
  const normalized = ((degrees % 360) + 360) % 360
  return Math.round(normalized * 60_000)
}

const patchTransform = (
  xfrm: OrderedXmlNode,
  operation: PowerPointTransformPatch,
): PowerPointWritebackIssue | undefined => {
  const children = nodeEntries(xfrm).flatMap(([, nested]) => nested)
  const off = findNode(children, 'off')
  const ext = findNode(children, 'ext')
  const x = numericAttribute(off, 'x')
  const y = numericAttribute(off, 'y')
  const cx = numericAttribute(ext, 'cx')
  const cy = numericAttribute(ext, 'cy')
  if (
    !off
    || !ext
    || x === undefined
    || y === undefined
    || cx === undefined
    || cy === undefined
    || Math.abs(operation.before.width) < 0.000_001
    || Math.abs(operation.before.height) < 0.000_001
  ) {
    return {
      code: 'pptx.writeback.transform-missing',
      elementId: operation.elementId,
      message: 'The source object has no explicit transform that Mona can patch safely.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }
  }
  const scaleX = cx / operation.before.width
  const scaleY = cy / operation.before.height
  const offAttributes = nodeAttributes(off)
  const extAttributes = nodeAttributes(ext)
  offAttributes.x = String(Math.round(
    x + (operation.after.left - operation.before.left) * scaleX,
  ))
  offAttributes.y = String(Math.round(
    y + (operation.after.top - operation.before.top) * scaleY,
  ))
  extAttributes.cx = String(Math.max(0, Math.round(operation.after.width * scaleX)))
  extAttributes.cy = String(Math.max(0, Math.round(operation.after.height * scaleY)))
  const attributes = nodeAttributes(xfrm)
  const rotation = normalizedRotation(operation.after.rotate)
  if (rotation) attributes.rot = String(rotation)
  else delete attributes.rot
  if (operation.after.flipH) attributes.flipH = '1'
  else delete attributes.flipH
  if (operation.after.flipV) attributes.flipV = '1'
  else delete attributes.flipV
  return undefined
}

const insertedTransformSnapshot = (
  element: Exclude<PPTElement, { type: 'line' }>,
): PowerPointTransformPatch['after'] => ({
  ...('flipH' in element && element.flipH !== undefined ? { flipH: element.flipH } : {}),
  ...('flipV' in element && element.flipV !== undefined ? { flipV: element.flipV } : {}),
  height: element.height,
  left: element.left,
  rotate: element.rotate,
  top: element.top,
  width: element.width,
})

const insertedTextSnapshot = (element: PPTElement): PowerPointTextPatch['after'] | undefined => {
  const text = element.type === 'text'
    ? element
    : element.type === 'shape'
      ? element.text
      : undefined
  if (!text) return undefined
  const vAlign = element.type === 'text'
    ? element.vAlign
    : element.type === 'shape'
      ? element.text?.align
      : undefined
  return {
    ...(text.columnGap !== undefined ? { columnGap: text.columnGap } : {}),
    ...(text.columns !== undefined ? { columns: text.columns } : {}),
    content: text.content,
    defaultColor: text.defaultColor,
    defaultFontName: text.defaultFontName,
    ...('fixedHeight' in text && text.fixedHeight !== undefined ? { fixedHeight: text.fixedHeight } : {}),
    ...(text.inset ? { inset: structuredClone(text.inset) } : {}),
    ...(text.lineHeight !== undefined ? { lineHeight: text.lineHeight } : {}),
    ...(text.paragraphSpace !== undefined ? { paragraphSpace: text.paragraphSpace } : {}),
    ...(text.structuredText ? { structuredText: structuredClone(text.structuredText) } : {}),
    ...(vAlign !== undefined ? { vAlign } : {}),
    ...(text.wordSpace !== undefined ? { wordSpace: text.wordSpace } : {}),
  }
}

const insertedStyleSnapshot = (element: PPTElement): PowerPointShapeStylePatch['after'] | undefined => {
  if (element.type !== 'text' && element.type !== 'shape') return undefined
  return {
    ...(element.fill !== undefined ? { fill: element.fill } : {}),
    ...(element.type === 'shape' && element.gradient ? { gradient: structuredClone(element.gradient) } : {}),
    ...(element.outline ? { outline: structuredClone(element.outline) } : {}),
    ...(element.type === 'shape' && element.pattern !== undefined ? { pattern: element.pattern } : {}),
    ...(element.type === 'shape' && element.patternFit ? { patternFit: structuredClone(element.patternFit) } : {}),
    ...(element.type === 'shape' && element.powerPointPattern ? { powerPointPattern: structuredClone(element.powerPointPattern) } : {}),
  }
}

const insertedImageSnapshot = (
  element: Extract<PPTElement, { type: 'image' }>,
): PowerPointImagePatch['after'] => ({
  ...(element.clip ? { clip: structuredClone(element.clip) } : {}),
  ...(element.filters ? { filters: structuredClone(element.filters) } : {}),
  ...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
  ...(element.outline ? { outline: structuredClone(element.outline) } : {}),
  ...(element.powerPointImage ? { powerPointImage: structuredClone(element.powerPointImage) } : {}),
  ...(element.shadow ? { shadow: structuredClone(element.shadow) } : {}),
  src: element.src,
})

const insertedTableSnapshot = (
  element: Extract<PPTElement, { type: 'table' }>,
): PowerPointTablePatch['after'] => ({
  cellMinHeight: element.cellMinHeight,
  colWidths: structuredClone(element.colWidths),
  data: structuredClone(element.data),
  outline: structuredClone(element.outline),
  ...(element.powerPointTable ? { powerPointTable: structuredClone(element.powerPointTable) } : {}),
  ...(element.rowHeights ? { rowHeights: structuredClone(element.rowHeights) } : {}),
  ...(element.theme ? { theme: structuredClone(element.theme) } : {}),
  width: element.width,
})

const insertedConnectorSnapshot = (
  element: Extract<PPTElement, { type: 'line' }>,
): PowerPointConnectorPatch['after'] => ({
  ...(element.broken ? { broken: structuredClone(element.broken) } : {}),
  ...(element.broken2 ? { broken2: structuredClone(element.broken2) } : {}),
  ...(element.broken2Direction ? { broken2Direction: element.broken2Direction } : {}),
  color: element.color,
  ...(element.connections ? { connections: structuredClone(element.connections) } : {}),
  ...(element.cubic ? { cubic: structuredClone(element.cubic) } : {}),
  ...(element.curve ? { curve: structuredClone(element.curve) } : {}),
  end: structuredClone(element.end),
  left: element.left,
  points: structuredClone(element.points),
  start: structuredClone(element.start),
  style: element.style,
  top: element.top,
  width: element.width,
  ...(element.powerPointGeometry ? { powerPointGeometry: structuredClone(element.powerPointGeometry) } : {}),
})

const applyInsertedElementEdits = (
  children: OrderedXmlNode[],
  before: PPTElement,
  after: PPTElement,
  operation: PowerPointObjectInsertPatch,
  relationshipEditor: HyperlinkRelationshipEditor | undefined,
  scale: number | undefined,
): PowerPointWritebackIssue[] => {
  const issues: PowerPointWritebackIssue[] = []
  if (before.type !== after.type) {
    return [{
      code: 'pptx.writeback.copy-type',
      elementId: after.id,
      message: 'A native copy must retain the semantic type of its source object.',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const xfrm = findOwnTransform(children)
  if (after.type !== 'line') {
    const beforeTransform = insertedTransformSnapshot(before as Exclude<PPTElement, { type: 'line' }>)
    const afterTransform = insertedTransformSnapshot(after)
    if (JSON.stringify(beforeTransform) !== JSON.stringify(afterTransform)) {
      if (!xfrm) {
        issues.push({
          code: 'pptx.writeback.transform-missing',
          elementId: after.id,
          message: 'The cloned native object has no transform to receive its edited geometry.',
          objectId: operation.sourceObjectId,
          partPath: operation.targetPart,
          slideId: operation.slideId,
        })
      }
      else {
        const issue = patchTransform(xfrm, {
          after: afterTransform,
          before: beforeTransform,
          elementId: after.id,
          kind: 'transform',
          objectId: operation.sourceObjectId,
          partPath: operation.targetPart,
          slideId: operation.slideId,
        })
        if (issue) issues.push(issue)
      }
    }
  }
  if (JSON.stringify(before.accessibility) !== JSON.stringify(after.accessibility)) {
    issues.push(...patchAccessibility(children, {
      ...(after.accessibility ? { after: structuredClone(after.accessibility) } : {}),
      ...(before.accessibility ? { before: structuredClone(before.accessibility) } : {}),
      elementId: after.id,
      kind: 'accessibility',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }))
  }
  if (before.type === 'line' && after.type === 'line') {
    const beforeConnector = insertedConnectorSnapshot(before)
    const afterConnector = insertedConnectorSnapshot(after)
    if (JSON.stringify(beforeConnector) !== JSON.stringify(afterConnector)) {
      issues.push(...patchConnector(children, xfrm, {
        after: afterConnector,
        before: beforeConnector,
        elementId: after.id,
        kind: 'connector',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        ...(scale ? { scale } : {}),
        slideId: operation.slideId,
      }))
    }
    return issues
  }
  if (before.type === 'chart' && after.type === 'chart') {
    const beforeChart = {
      chartSpace: before.chartSpace,
      chartType: before.chartType,
      data: before.data,
      options: before.options,
      themeColors: before.themeColors,
    }
    const afterChart = {
      chartSpace: after.chartSpace,
      chartType: after.chartType,
      data: after.data,
      options: after.options,
      themeColors: after.themeColors,
    }
    if (JSON.stringify(beforeChart) !== JSON.stringify(afterChart)) {
      issues.push({
        code: 'pptx.writeback.copy-chart-edit',
        elementId: after.id,
        message: 'The native chart frame can be copied, but independent chart-part cloning is required before changing the copy data.',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      })
    }
    return issues
  }
  if (before.type === 'image' && after.type === 'image') {
    const beforeImage = insertedImageSnapshot(before)
    const afterImage = insertedImageSnapshot(after)
    if (beforeImage.src !== afterImage.src || JSON.stringify(beforeImage.powerPointImage) !== JSON.stringify(afterImage.powerPointImage)) {
      issues.push({
        code: 'pptx.writeback.copy-image-source',
        elementId: after.id,
        message: 'The native picture can be copied, but replacing its media requires a new package media relationship.',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      })
    }
    else if (JSON.stringify(beforeImage) !== JSON.stringify(afterImage)) {
      issues.push(...patchImage(children, {
        after: afterImage,
        before: beforeImage,
        elementId: after.id,
        kind: 'image',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        ...(scale ? { scale } : {}),
        slideId: operation.slideId,
      }))
    }
    return issues
  }
  if (before.type === 'table' && after.type === 'table') {
    const beforeTable = insertedTableSnapshot(before)
    const afterTable = insertedTableSnapshot(after)
    if (JSON.stringify(beforeTable) !== JSON.stringify(afterTable)) {
      issues.push(...patchTable(children, xfrm, {
        after: afterTable,
        before: beforeTable,
        beforeWidth: before.width,
        elementId: after.id,
        kind: 'table',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        ...(scale ? { scale } : {}),
        slideId: operation.slideId,
      }))
    }
    return issues
  }
  const beforeText = insertedTextSnapshot(before)
  const afterText = insertedTextSnapshot(after)
  if (beforeText && afterText && JSON.stringify(beforeText) !== JSON.stringify(afterText)) {
    issues.push(...patchText(children, xfrm, {
      after: afterText,
      before: beforeText,
      beforeWidth: before.type === 'line' ? 0 : before.width,
      elementId: after.id,
      kind: 'text',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      ...(scale ? { scale } : {}),
      slideId: operation.slideId,
    }, relationshipEditor))
  }
  const beforeStyle = insertedStyleSnapshot(before)
  const afterStyle = insertedStyleSnapshot(after)
  if (beforeStyle && afterStyle && JSON.stringify(beforeStyle) !== JSON.stringify(afterStyle)) {
    issues.push(...patchShapeStyle(children, xfrm, {
      after: afterStyle,
      before: beforeStyle,
      beforeWidth: before.type === 'line' ? 0 : before.width,
      elementId: after.id,
      kind: 'style',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      ...(scale ? { scale } : {}),
      slideId: operation.slideId,
    }))
  }
  if (before.type === 'shape' && after.type === 'shape' && JSON.stringify(before.powerPointGeometry) !== JSON.stringify(after.powerPointGeometry)) {
    issues.push(...patchShapeGeometry(children, {
      after: after.powerPointGeometry ? { powerPointGeometry: structuredClone(after.powerPointGeometry) } : {},
      before: before.powerPointGeometry ? { powerPointGeometry: structuredClone(before.powerPointGeometry) } : {},
      elementId: after.id,
      kind: 'shape-geometry',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }))
  }
  return issues
}

const patchInsertedObject = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  operation: PowerPointObjectInsertPatch,
): Promise<PowerPointWritebackIssue[]> => {
  const sourceEntry = zip.file(operation.sourcePart)
  const targetEntry = zip.file(operation.targetPart)
  if (!sourceEntry || !targetEntry) {
    return [{
      code: !sourceEntry ? 'pptx.writeback.copy-source-part-missing' : 'pptx.writeback.copy-target-part-missing',
      elementId: operation.elementId,
      message: !sourceEntry
        ? 'The retained package no longer contains the native object source part.'
        : 'The retained package no longer contains the target slide part.',
      objectId: operation.sourceObjectId,
      partPath: !sourceEntry ? operation.sourcePart : operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const sourceNodes = parseXml(await sourceEntry.async('text'), operation.sourcePart)
  const source = findDrawingNode(
    sourceNodes,
    manifest.packageId,
    operation.sourcePart,
    operation.sourceObjectId,
  )
  if (!source) {
    return [{
      code: 'pptx.writeback.copy-source-object-missing',
      elementId: operation.elementId,
      message: 'The retained package no longer contains the exact native object selected for cloning.',
      objectId: operation.sourceObjectId,
      partPath: operation.sourcePart,
      slideId: operation.slideId,
    }]
  }
  const targetNodes = parseXml(await targetEntry.async('text'), operation.targetPart)
  const parent = operation.parentObjectId
    ? findDrawingNode(
        targetNodes,
        manifest.packageId,
        operation.targetPart,
        operation.parentObjectId,
      )
    : undefined
  if (operation.parentObjectId && !parent) {
    return [{
      code: 'pptx.writeback.copy-parent-missing',
      elementId: operation.elementId,
      message: 'The target native group no longer exists in the slide shape tree.',
      objectId: operation.parentObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const clone = structuredClone(source.node)
  const relationshipIssues = await copyReferencedRelationships({
    clone,
    sourcePart: operation.sourcePart,
    targetPart: operation.targetPart,
    zip,
  })
  if (relationshipIssues.length) return relationshipIssues.map(issue => ({
    ...issue,
    elementId: operation.elementId,
    objectId: operation.sourceObjectId,
    slideId: operation.slideId,
  }))

  const targetRelationshipsPath = relationshipPartPath(operation.targetPart)
  const targetRelationshipsEntry = zip.file(targetRelationshipsPath)
  const relationshipEditor = createHyperlinkRelationshipEditor(
    targetRelationshipsEntry ? await targetRelationshipsEntry.async('text') : undefined,
    operation.targetPart,
  )
  const beforeByObject = new Map(flattenElementTree([operation.before]).flatMap(element => (
    element.source?.sourceObjectId ? [[element.source.sourceObjectId, element] as const] : []
  )))
  const sourceSubtree = collectDrawingNodes([source.node])
  const cloneSubtree = collectDrawingNodes([clone])
  const issues: PowerPointWritebackIssue[] = []
  for (const after of flattenElementTree([operation.after])) {
    const origin = after.source?.copyOnWrite
    if (!origin) continue
    const before = beforeByObject.get(origin.sourceObjectId)
    const sourceLocation = findDrawingNode(
      sourceNodes,
      manifest.packageId,
      operation.sourcePart,
      origin.sourceObjectId,
    )
    const sourceIndex = sourceLocation
      ? sourceSubtree.findIndex(candidate => candidate.node === sourceLocation.node)
      : -1
    const location = sourceIndex >= 0 ? cloneSubtree[sourceIndex] : undefined
    if (!before || !location) {
      issues.push({
        code: 'pptx.writeback.copy-child-missing',
        elementId: after.id,
        message: 'A child of the copied native object no longer resolves to its retained source node.',
        objectId: origin.sourceObjectId,
        partPath: operation.sourcePart,
        slideId: operation.slideId,
      })
      continue
    }
    issues.push(...applyInsertedElementEdits(
      location.children,
      before,
      after,
      { ...operation, elementId: after.id, sourceObjectId: origin.sourceObjectId },
      relationshipEditor,
      manifest.coordinateScale,
    ))
  }
  if (issues.length) return issues
  allocateDrawingIds(clone, targetNodes)
  if (!insertDrawingNode(targetNodes, clone, parent)) {
    return [{
      code: 'pptx.writeback.copy-shape-tree-missing',
      elementId: operation.elementId,
      message: 'The target slide has no native PowerPoint shape tree.',
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const patchedXml = xmlBuilder.build(targetNodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return [{
      code: 'pptx.writeback.invalid-copy-output',
      elementId: operation.elementId,
      message: `Native object insertion produced invalid XML: ${validation.err.msg}`,
      objectId: operation.sourceObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  zip.file(operation.targetPart, patchedXml)
  if (relationshipEditor.dirty) {
    const relationshipXml = relationshipEditor.serialize()
    const relationshipValidation = XMLValidator.validate(relationshipXml, { allowBooleanAttributes: false })
    if (relationshipValidation !== true) {
      return [{
        code: 'pptx.writeback.invalid-copy-relationships-output',
        elementId: operation.elementId,
        message: `Native object insertion produced invalid relationships XML: ${relationshipValidation.err.msg}`,
        objectId: operation.sourceObjectId,
        partPath: relationshipEditor.path,
        slideId: operation.slideId,
      }]
    }
    zip.file(relationshipEditor.path, relationshipXml)
  }
  return []
}

interface CopiedSlideTreeEntry {
  element: PPTElement
  parent?: PPTElement
  path: string
}

const copiedSlideTreeEntries = (elements: readonly PPTElement[]): CopiedSlideTreeEntry[] => {
  const entries: CopiedSlideTreeEntry[] = []
  const visit = (
    children: readonly PPTElement[],
    parent?: PPTElement,
    parentPath = '',
  ): void => {
    children.forEach((element, index) => {
      const path = parentPath ? `${parentPath}.${index}` : String(index)
      entries.push({ element, ...(parent ? { parent } : {}), path })
      if (element.type === 'group') visit(element.elements, element, path)
    })
  }
  visit(elements)
  return entries
}

const unaddressedElementSnapshot = (element: PPTElement): unknown => {
  const clone = structuredClone(element) as unknown as Record<string, unknown>
  const strip = (candidate: Record<string, unknown>): void => {
    delete candidate.id
    delete candidate.source
    delete candidate.groupId
    if (candidate.type === 'group' && Array.isArray(candidate.elements)) {
      for (const child of candidate.elements) {
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          strip(child as Record<string, unknown>)
        }
      }
    }
  }
  strip(clone)
  return clone
}

const exactObjectId = (element: PPTElement): string | undefined => (
  element.source?.sourceObjectId
)

const copiedObjectId = (element: PPTElement): string | undefined => (
  element.source?.copyOnWrite?.sourceObjectId
)

const rebaseObjectId = (
  objectId: string,
  packageId: string,
  sourcePart: string,
  targetPart: string,
): string => {
  const prefix = `${packageId}/${sourcePart}#`
  return objectId.startsWith(prefix)
    ? `${packageId}/${targetPart}#${objectId.slice(prefix.length)}`
    : objectId
}

const insertNativeSlide = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  operation: PowerPointSlideInsertPatch,
): Promise<{ issues: PowerPointWritebackIssue[]; targetPart?: string }> => {
  const sourceEntry = zip.file(operation.sourcePart)
  if (!sourceEntry) {
    return { issues: [{
      code: 'pptx.writeback.slide-copy-source-missing',
      message: 'The retained package no longer contains the native slide selected for duplication.',
      partPath: operation.sourcePart,
      slideId: operation.slideId,
    }] }
  }
  const targetPart = allocateSiblingPart(zip, operation.sourcePart)
  const slideNodes = parseXml(await sourceEntry.async('text'), operation.sourcePart)
  const issues: PowerPointWritebackIssue[] = []
  const partMap = new Map<string, string>([[operation.sourcePart, targetPart]])
  issues.push(...await cloneContentTypeOverride(zip, operation.sourcePart, targetPart))
  issues.push(...await clonePartRelationshipGraph(
    zip,
    operation.sourcePart,
    targetPart,
    partMap,
  ))
  if (issues.length) return { issues }
  const beforeEntries = copiedSlideTreeEntries(operation.before.elements)
  const afterEntries = copiedSlideTreeEntries(operation.after.elements)
  const candidatesByOrigin = new Map<string, CopiedSlideTreeEntry[]>()
  for (const entry of afterEntries) {
    const origin = copiedObjectId(entry.element)
    if (!origin) continue
    const candidates = candidatesByOrigin.get(origin) ?? []
    candidates.push(entry)
    candidatesByOrigin.set(origin, candidates)
  }
  const matchedAfterIds = new Set<string>()
  const missingObjectIds = new Set<string>()
  const relationshipPath = relationshipPartPath(targetPart)
  const targetRelationships = zip.file(relationshipPath)
  const relationshipEditor = createHyperlinkRelationshipEditor(
    targetRelationships ? await targetRelationships.async('text') : undefined,
    targetPart,
  )

  const beforeByPath = new Map(beforeEntries.map(entry => [entry.path, entry]))
  for (const afterEntry of afterEntries) {
    if (copiedObjectId(afterEntry.element)) continue
    const beforeEntry = beforeByPath.get(afterEntry.path)
    if (
      beforeEntry
      && !exactObjectId(beforeEntry.element)
      && JSON.stringify(unaddressedElementSnapshot(beforeEntry.element))
        === JSON.stringify(unaddressedElementSnapshot(afterEntry.element))
    ) {
      matchedAfterIds.add(afterEntry.element.id)
    }
  }

  for (const beforeEntry of beforeEntries) {
    const objectId = exactObjectId(beforeEntry.element)
    if (!objectId || beforeEntry.element.source?.sourcePart !== operation.sourcePart) continue
    const candidates = candidatesByOrigin.get(objectId) ?? []
    const afterEntry = candidates.find(candidate => (
      !matchedAfterIds.has(candidate.element.id)
      && candidate.element.type === beforeEntry.element.type
    ))
    if (!afterEntry) {
      missingObjectIds.add(objectId)
      continue
    }
    matchedAfterIds.add(afterEntry.element.id)
    const location = findDrawingNode(
      slideNodes,
      manifest.packageId,
      operation.sourcePart,
      objectId,
    )
    if (!location) {
      issues.push({
        code: 'pptx.writeback.slide-copy-object-missing',
        elementId: afterEntry.element.id,
        message: 'The copied slide no longer contains one of its retained native objects.',
        objectId,
        partPath: operation.sourcePart,
        slideId: operation.slideId,
      })
      continue
    }
    issues.push(...applyInsertedElementEdits(
      location.children,
      beforeEntry.element,
      afterEntry.element,
      {
        after: afterEntry.element,
        before: beforeEntry.element,
        elementId: afterEntry.element.id,
        kind: 'insert-object',
        mode: 'copy',
        slideId: operation.slideId,
        sourceObjectId: objectId,
        sourcePart: operation.sourcePart,
        targetPart,
      },
      relationshipEditor,
      manifest.coordinateScale,
    ))
  }

  for (const beforeEntry of beforeEntries) {
    const objectId = exactObjectId(beforeEntry.element)
    if (!objectId || !missingObjectIds.has(objectId)) continue
    const parentObjectId = beforeEntry.parent ? exactObjectId(beforeEntry.parent) : undefined
    if (parentObjectId && missingObjectIds.has(parentObjectId)) continue
    const location = findDrawingNode(
      slideNodes,
      manifest.packageId,
      operation.sourcePart,
      objectId,
    )
    if (!location) {
      issues.push({
        code: 'pptx.writeback.slide-copy-delete-object-missing',
        elementId: beforeEntry.element.id,
        message: 'A deleted object is already absent from the retained slide selected for duplication.',
        objectId,
        partPath: operation.sourcePart,
        slideId: operation.slideId,
      })
      continue
    }
    location.siblings.splice(location.index, 1)
  }

  const unmatched = new Set(afterEntries.filter(entry => (
    !matchedAfterIds.has(entry.element.id)
  )).map(entry => entry.element.id))
  const insertionEntries = afterEntries.filter(entry => (
    unmatched.has(entry.element.id)
    && (!entry.parent || !unmatched.has(entry.parent.id))
  ))
  const sourceByObjectId = new Map([
    ...beforeEntries,
    ...copiedSlideTreeEntries(operation.inheritedBefore ?? []),
  ].flatMap(entry => {
    const objectId = exactObjectId(entry.element)
    return objectId ? [[objectId, entry.element] as const] : []
  }))

  if (issues.length) return { issues }
  const slideXml = xmlBuilder.build(slideNodes) as string
  const validation = XMLValidator.validate(slideXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return { issues: [{
      code: 'pptx.writeback.invalid-copied-slide',
      message: `Cloning a native slide produced invalid XML: ${validation.err.msg}`,
      partPath: targetPart,
      slideId: operation.slideId,
    }] }
  }
  zip.file(targetPart, slideXml)
  if (relationshipEditor.dirty) {
    zip.file(relationshipEditor.path, relationshipEditor.serialize())
  }
  if (issues.length) return { issues }

  const hiddenObjectIds = new Set(operation.after.source?.hiddenInheritedObjectIds ?? [])
  for (const entry of insertionEntries) {
    const origin = entry.element.source?.copyOnWrite
    if (origin?.mode === 'override') hiddenObjectIds.add(origin.sourceObjectId)
  }
  if (hiddenObjectIds.size) {
    const dependency = manifest.slides.find(slide => slide.slidePart === operation.sourcePart)
    if (!dependency?.layoutPart || !dependency.masterPart) {
      return { issues: [{
        code: 'pptx.writeback.private-hierarchy-source-missing',
        message: 'The copied slide has no exact layout/master pair to receive slide-local inherited visibility.',
        partPath: operation.sourcePart,
        slideId: operation.slideId,
      }] }
    }
    issues.push(...await createPrivateHierarchy(zip, manifest, {
      hiddenObjectIds,
      layoutPart: dependency.layoutPart,
      masterPart: dependency.masterPart,
      slideId: operation.slideId,
      slidePart: targetPart,
    }))
  }
  if (issues.length) return { issues }

  for (const entry of insertionEntries) {
    const origin = entry.element.source?.copyOnWrite
    if (!origin) {
      issues.push({
        code: 'pptx.writeback.slide-copy-element-added',
        elementId: entry.element.id,
        message: 'A Mona-created object on a copied native slide has no retained OOXML payload to serialize.',
        partPath: targetPart,
        slideId: operation.slideId,
      })
      continue
    }
    const before = sourceByObjectId.get(origin.sourceObjectId)
    if (!before) {
      issues.push({
        code: 'pptx.writeback.slide-copy-origin-model',
        elementId: entry.element.id,
        message: 'A source-backed object on the copied slide no longer resolves to its original semantic element.',
        objectId: origin.sourceObjectId,
        partPath: origin.sourcePart,
        slideId: operation.slideId,
      })
      continue
    }
    const parentOrigin = entry.parent?.source?.copyOnWrite?.sourceObjectId
    issues.push(...await patchInsertedObject(zip, manifest, {
      after: entry.element,
      before,
      elementId: entry.element.id,
      kind: 'insert-object',
      mode: origin.mode,
      ...(parentOrigin ? {
        parentObjectId: rebaseObjectId(
          parentOrigin,
          manifest.packageId,
          operation.sourcePart,
          targetPart,
        ),
      } : {}),
      slideId: operation.slideId,
      sourceObjectId: origin.sourceObjectId,
      sourcePart: origin.sourcePart,
      targetPart,
    }))
  }
  if (issues.length) return { issues }

  if (operation.before.remark !== operation.after.remark) {
    const sourceNotes = manifest.slides.find(slide => slide.slidePart === operation.sourcePart)?.notesPart
    const targetNotes = sourceNotes ? partMap.get(sourceNotes) : undefined
    if (!targetNotes) {
      return { issues: [{
        code: 'pptx.writeback.slide-copy-notes-part',
        message: 'The copied slide has no independently cloned notes part to receive its edited speaker notes.',
        partPath: targetPart,
        slideId: operation.slideId,
      }] }
    }
    const notesEntry = zip.file(targetNotes)
    if (!notesEntry) {
      return { issues: [{
        code: 'pptx.writeback.notes-part-missing',
        message: 'The independently cloned speaker-notes part is missing.',
        partPath: targetNotes,
        slideId: operation.slideId,
      }] }
    }
    const patched = patchNotesPart(await notesEntry.async('text'), {
      after: operation.after.remark ?? '',
      before: operation.before.remark ?? '',
      kind: 'notes',
      notesPart: targetNotes,
      partPath: targetNotes,
      ...(manifest.coordinateScale ? { scale: manifest.coordinateScale } : {}),
      slideId: operation.slideId,
    })
    issues.push(...patched.issues)
    if (!patched.issues.length) zip.file(targetNotes, patched.xml)
  }
  if (JSON.stringify(operation.before.notes ?? []) !== JSON.stringify(operation.after.notes ?? [])) {
    issues.push({
      code: 'pptx.writeback.slide-copy-comments',
      message: 'Changing comments while duplicating a native slide requires comment-author allocation.',
      partPath: targetPart,
      slideId: operation.slideId,
    })
  }
  if (JSON.stringify(operation.before.background) !== JSON.stringify(operation.after.background)) {
    if (operation.after.background?.type === 'image') {
      issues.push({
        code: 'pptx.writeback.background-image',
        message: 'Replacing the copied slide background with a new image requires package media allocation.',
        partPath: targetPart,
        slideId: operation.slideId,
      })
    }
    else {
      const targetEntry = zip.file(targetPart)
      if (!targetEntry) throw new Error(`Copied slide part disappeared: ${targetPart}`)
      const patched = patchBackgroundPart(await targetEntry.async('text'), {
        ...(operation.after.background ? { after: structuredClone(operation.after.background) } : {}),
        ...(operation.before.background ? { before: structuredClone(operation.before.background) } : {}),
        kind: 'background',
        partPath: targetPart,
        slideId: operation.slideId,
      })
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(targetPart, patched.xml)
    }
  }
  if (issues.length) return { issues }
  issues.push(...await registerSlide(zip, targetPart, operation.index, operation.slideId))
  return { issues, targetPart }
}

const patchPart = (
  xml: string,
  partPath: string,
  packageId: string,
  operations: readonly PowerPointObjectPatchOperation[],
  relationshipEditor?: HyperlinkRelationshipEditor,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, partPath)
  const pending = new Map<string, PowerPointObjectPatchOperation[]>()
  for (const operation of operations) {
    const entries = pending.get(operation.objectId) ?? []
    entries.push(operation)
    pending.set(operation.objectId, entries)
  }
  const issues: PowerPointWritebackIssue[] = []
  const occurrences = new Map<string, number>()

  const visit = (
    siblings: OrderedXmlNode[],
    coordinateContext?: ConnectorCoordinateContext,
  ): void => {
    for (let index = 0; index < siblings.length; index += 1) {
      const node = siblings[index]!
      for (const [tag, children] of nodeEntries(node)) {
        const name = localName(tag)
        if (!drawingObjectTags.has(name)) {
          visit(children, coordinateContext)
          continue
        }
        const xfrm = findOwnTransform(children)
        const nativeId = nonVisualId(children)
        if (!nativeId) {
          visit(
            children,
            name === 'grpSp'
              ? connectorChildCoordinateContext(xfrm)
              : coordinateContext,
          )
          continue
        }
        const occurrence = occurrences.get(nativeId) ?? 0
        occurrences.set(nativeId, occurrence + 1)
        const objectId = `${packageId}/${partPath}#${nativeId}${occurrence ? `:${occurrence}` : ''}`
        const objectOperations = pending.get(objectId) ?? []
        const deletion = objectOperations.find(operation => operation.kind === 'delete')
        if (deletion) {
          siblings.splice(index, 1)
          index -= 1
          pending.delete(objectId)
          break
        }
        if (objectOperations.length) {
          for (const operation of objectOperations) {
            if (operation.kind === 'accessibility') {
              issues.push(...patchAccessibility(children, operation))
            }
            else if (operation.kind === 'transform') {
              if (!xfrm) {
                issues.push({
                  code: 'pptx.writeback.transform-missing',
                  elementId: operation.elementId,
                  message: 'The source object has no explicit transform that Mona can patch safely.',
                  objectId,
                  partPath,
                  slideId: operation.slideId,
                })
              }
              else {
                const issue = patchTransform(xfrm, operation)
                if (issue) issues.push(issue)
              }
            }
            else if (operation.kind === 'text') {
              issues.push(...patchText(children, xfrm, operation, relationshipEditor))
            }
            else if (operation.kind === 'style') {
              issues.push(...patchShapeStyle(children, xfrm, operation))
            }
            else if (operation.kind === 'shape-geometry') {
              issues.push(...patchShapeGeometry(children, operation))
            }
            else if (operation.kind === 'image') {
              issues.push(...patchImage(children, operation))
            }
            else if (operation.kind === 'table') {
              issues.push(...patchTable(children, xfrm, operation))
            }
            else if (operation.kind === 'connector') {
              issues.push(...patchConnector(children, xfrm, operation, coordinateContext))
            }
          }
          pending.delete(objectId)
        }
        visit(
          children,
          name === 'grpSp'
            ? connectorChildCoordinateContext(xfrm)
            : coordinateContext,
        )
      }
    }
  }
  visit(nodes)
  for (const remaining of pending.values()) {
    for (const operation of remaining) {
      issues.push({
        code: 'pptx.writeback.object-missing',
        elementId: operation.elementId,
        message: 'The retained package no longer contains the exact source object selected for writeback.',
        objectId: operation.objectId,
        partPath,
        slideId: operation.slideId,
      })
    }
  }
  const patchedXml = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(patchedXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    issues.push({
      code: 'pptx.writeback.invalid-output',
      message: `A source-preserving patch produced invalid XML: ${validation.err.msg}`,
      partPath,
    })
  }
  return { issues, xml: patchedXml }
}

export const patchPowerPointPackage = async ({
  bytes,
  manifest,
  operations,
}: {
  bytes: ArrayBuffer
  manifest: PowerPointPackageManifest
  operations: readonly PowerPointPatchOperation[]
}): Promise<ArrayBuffer> => {
  if (!operations.length) return bytes.slice(0)
  const knownObjects = new Set(manifest.objects.map(object => object.stableId))
  const objectOperations = operations.filter(
    (operation): operation is PowerPointObjectPatchOperation => (
      operation.kind !== 'background'
      && operation.kind !== 'comments'
      && operation.kind !== 'inherited-visibility'
      && operation.kind !== 'insert-object'
      && operation.kind !== 'insert-slide'
      && operation.kind !== 'notes'
    ),
  )
  const unknown = objectOperations.filter(operation => !knownObjects.has(operation.objectId))
  if (unknown.length) {
    throw new PowerPointWritebackError(unknown.map(operation => ({
      code: 'pptx.writeback.object-not-in-manifest',
      elementId: operation.elementId,
      message: 'The edit target is absent from the retained source-package manifest.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    })))
  }
  const zip = await JSZip.loadAsync(bytes)
  const issues: PowerPointWritebackIssue[] = []
  for (const operation of operations) {
    if (operation.kind !== 'insert-slide') continue
    const inserted = await insertNativeSlide(zip, manifest, operation)
    issues.push(...inserted.issues)
  }
  if (issues.length) throw new PowerPointWritebackError(issues)
  const privateHierarchyBySlide = new Map<string, PrivateHierarchyRequest>()
  for (const operation of operations) {
    if (operation.kind === 'inherited-visibility') {
      if (!operation.masterPart) {
        issues.push({
          code: 'pptx.writeback.private-master-missing',
          message: 'The slide-local inherited edit has no exact master from which to derive a private hierarchy.',
          partPath: operation.layoutPart,
          slideId: operation.slideId,
        })
        continue
      }
      privateHierarchyBySlide.set(operation.slideId, {
        hiddenObjectIds: new Set(operation.hiddenObjectIds),
        layoutPart: operation.layoutPart,
        masterPart: operation.masterPart,
        slideId: operation.slideId,
        slidePart: operation.partPath,
      })
    }
  }
  for (const operation of operations) {
    if (operation.kind !== 'insert-object' || operation.mode !== 'override') continue
    const dependency = manifest.slides.find(slide => slide.slidePart === operation.targetPart)
    if (!dependency?.layoutPart || !dependency.masterPart) {
      issues.push({
        code: 'pptx.writeback.private-hierarchy-source-missing',
        elementId: operation.elementId,
        message: 'The inherited override has no exact layout/master pair to privatize.',
        objectId: operation.sourceObjectId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      })
      continue
    }
    const request = privateHierarchyBySlide.get(operation.slideId) ?? {
      hiddenObjectIds: new Set<string>(),
      layoutPart: dependency.layoutPart,
      masterPart: dependency.masterPart,
      slideId: operation.slideId,
      slidePart: operation.targetPart,
    }
    request.hiddenObjectIds.add(operation.sourceObjectId)
    privateHierarchyBySlide.set(operation.slideId, request)
  }
  for (const request of privateHierarchyBySlide.values()) {
    issues.push(...await createPrivateHierarchy(zip, manifest, request))
  }
  if (issues.length) throw new PowerPointWritebackError(issues)
  for (const operation of operations) {
    if (operation.kind === 'insert-object') {
      issues.push(...await patchInsertedObject(zip, manifest, operation))
    }
  }
  for (const operation of operations) {
    if (operation.kind === 'chart') issues.push(...await patchNativeChart(zip, operation))
    if (operation.kind === 'background') {
      const entry = zip.file(operation.partPath)
      if (!entry) {
        issues.push({
          code: 'pptx.writeback.background-part-missing',
          message: 'The retained native slide part is missing.',
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
        continue
      }
      const patched = patchBackgroundPart(await entry.async('text'), operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.partPath, patched.xml)
    }
    if (operation.kind === 'comments') {
      const entry = zip.file(operation.partPath)
      if (!entry) {
        issues.push({
          code: 'pptx.writeback.comments-part-missing',
          message: 'The retained native comments part is missing.',
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
        continue
      }
      const patched = patchCommentsPart(await entry.async('text'), operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.partPath, patched.xml)
    }
    if (operation.kind === 'notes') {
      const entry = zip.file(operation.notesPart)
      if (!entry) {
        issues.push({
          code: 'pptx.writeback.notes-part-missing',
          message: 'The retained native notes part is missing.',
          partPath: operation.notesPart,
          slideId: operation.slideId,
        })
        continue
      }
      const patched = patchNotesPart(await entry.async('text'), operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.notesPart, patched.xml)
    }
  }
  const byPart = new Map<string, PowerPointObjectPatchOperation[]>()
  for (const operation of objectOperations) {
    if (operation.kind === 'chart') continue
    const group = byPart.get(operation.partPath) ?? []
    group.push(operation)
    byPart.set(operation.partPath, group)
  }
  for (const [partPath, partOperations] of byPart) {
    const entry = zip.file(partPath)
    if (!entry) {
      issues.push({
        code: 'pptx.writeback.part-missing',
        message: 'The retained package no longer contains a dirty source part.',
        partPath,
      })
      continue
    }
    const relationshipPath = relationshipPartPath(partPath)
    const relationshipEntry = zip.file(relationshipPath)
    const relationshipEditor = partOperations.some(operation => operation.kind === 'text')
      ? createHyperlinkRelationshipEditor(
          relationshipEntry ? await relationshipEntry.async('text') : undefined,
          partPath,
        )
      : undefined
    const patched = patchPart(
      await entry.async('text'),
      partPath,
      manifest.packageId,
      partOperations,
      relationshipEditor,
    )
    issues.push(...patched.issues)
    if (!patched.issues.length) {
      zip.file(partPath, patched.xml)
      if (relationshipEditor?.dirty) {
        const relationshipXml = relationshipEditor.serialize()
        const relationshipValidation = XMLValidator.validate(relationshipXml, { allowBooleanAttributes: false })
        if (relationshipValidation === true) zip.file(relationshipEditor.path, relationshipXml)
        else {
          issues.push({
            code: 'pptx.writeback.invalid-relationships-output',
            message: `Hyperlink writeback produced invalid relationships XML: ${relationshipValidation.err.msg}`,
            partPath: relationshipEditor.path,
          })
        }
      }
    }
  }
  if (issues.length) throw new PowerPointWritebackError(issues)
  return zip.generateAsync({
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    type: 'arraybuffer',
  })
}
