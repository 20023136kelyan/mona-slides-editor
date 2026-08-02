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
  PowerPointElementInsertPatch,
  PowerPointElementReplacePatch,
  PowerPointEffectsPatch,
  PowerPointImagePatch,
  PowerPointNotesPatch,
  PowerPointObjectInsertPatch,
  PowerPointPatchOperation,
  PowerPointSlideInsertPatch,
  PowerPointShapeStylePatch,
  PowerPointShapeGeometryPatch,
  PowerPointTablePatch,
  PowerPointTextPatch,
  PowerPointThemePatch,
  PowerPointThreeDPatch,
  PowerPointTimingPatch,
  PowerPointTransitionPatch,
  PowerPointTransformPatch,
  PowerPointWritebackIssue,
  PowerPointAssetResolver,
} from './types'
import { PowerPointWritebackError } from './types'
import {
  parseAuthoredText,
  type AuthoredTextParagraph,
  type AuthoredTextRun,
  type AuthoredTextStyle,
} from './authored-text'
import { patchNativeChart } from './chart-writeback'
import {
  generateElementDonorPackage,
  generatedElementMarker,
  generateNotesDonorPackage,
} from './generated-object'
import { latexToOmml } from './native-math'

type OrderedXmlNode = Record<string, unknown>
type PowerPointObjectPatchOperation = Exclude<PowerPointPatchOperation, {
  kind: 'background' | 'comments' | 'inherited-visibility' | 'insert-element' | 'insert-object' | 'insert-slide' | 'notes' | 'replace-element' | 'theme' | 'timing' | 'transition'
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
  'AlternateContent',
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

const replaceNodeTag = (node: OrderedXmlNode, tag: string): void => {
  const children = ownChildren(node)
  const attributes = { ...nodeAttributes(node) }
  for (const key of Object.keys(node)) delete node[key]
  Object.assign(node, xmlNode(tag, children, attributes))
}

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

const rewriteHyperlinkReference = (
  nodes: readonly OrderedXmlNode[],
  relationshipId: string,
  action: string,
  keepRelationship: boolean,
): void => {
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === 'hlinkClick') {
          const attributes = nodeAttributes(node)
          if (attributes['r:id'] === relationshipId) {
            attributes.action = action
            if (!keepRelationship) delete attributes['r:id']
          }
        }
        visit(children)
      }
    }
  }
  visit(nodes)
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
          if (attributes.name && !attributes.name.startsWith('mona-generated:')) {
            attributes.name = `${attributes.name} Copy`
          }
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

const ensureContentTypeOverride = async (
  zip: JSZip,
  partPath: string,
  contentType: string,
): Promise<PowerPointWritebackIssue[]> => {
  const manifestPath = '[Content_Types].xml'
  const entry = zip.file(manifestPath)
  if (!entry) return [{
    code: 'pptx.writeback.content-types-missing',
    message: 'The package has no content-types manifest.',
    partPath: manifestPath,
  }]
  const nodes = parseXml(await entry.async('text'), manifestPath)
  const types = findNode(nodes, 'Types')
  if (!types) return [{
    code: 'pptx.writeback.content-types-invalid',
    message: 'The package content-types manifest has no Types root.',
    partPath: manifestPath,
  }]
  const children = ownChildren(types)
  const partName = `/${partPath}`
  const existing = directNodes(children, 'Override').find(node => (
    nodeAttributes(node).PartName === partName
  ))
  if (existing) nodeAttributes(existing).ContentType = contentType
  else children.push(xmlNode('Override', [], { ContentType: contentType, PartName: partName }))
  zip.file(manifestPath, xmlBuilder.build(nodes) as string)
  return []
}

const ensureInternalRelationship = async (
  zip: JSZip,
  ownerPart: string,
  type: string,
  targetPart: string,
): Promise<string> => {
  const relationshipPath = relationshipPartPath(ownerPart)
  const entry = zip.file(relationshipPath)
  const relationships = relationshipDocument(
    entry ? await entry.async('text') : undefined,
    ownerPart,
  )
  for (const [id, relationship] of relationships.byId) {
    const attributes = nodeAttributes(relationship)
    if (
      attributes.Type === type
      && attributes.TargetMode !== 'External'
      && attributes.Target
      && internalRelationshipTarget(ownerPart, attributes.Target) === targetPart
    ) return id
  }
  const id = nextRelationshipId(relationships)
  const relationship = xmlNode('Relationship', [], {
    Id: id,
    Target: relativeRelationshipTarget(ownerPart, targetPart),
    Type: type,
  })
  relationships.children.push(relationship)
  relationships.byId.set(id, relationship)
  zip.file(relationshipPath, serializeRelationshipDocument(relationships))
  return id
}

const copyDonorContentType = async (
  targetZip: JSZip,
  donorZip: JSZip,
  sourcePart: string,
  targetPart: string,
): Promise<PowerPointWritebackIssue[]> => {
  const path = '[Content_Types].xml'
  const [targetEntry, donorEntry] = [targetZip.file(path), donorZip.file(path)]
  if (!targetEntry || !donorEntry) {
    return [{
      code: 'pptx.writeback.generated-content-types-missing',
      message: 'A generated object package is missing its content-type manifest.',
      partPath: path,
    }]
  }
  const targetNodes = parseXml(await targetEntry.async('text'), path)
  const donorNodes = parseXml(await donorEntry.async('text'), path)
  const targetTypes = findNode(targetNodes, 'Types')
  const donorTypes = findNode(donorNodes, 'Types')
  if (!targetTypes || !donorTypes) {
    return [{
      code: 'pptx.writeback.generated-content-types-invalid',
      message: 'A generated object package has an invalid content-type manifest.',
      partPath: path,
    }]
  }
  const targetChildren = ownChildren(targetTypes)
  const donorChildren = ownChildren(donorTypes)
  const donorOverride = directNodes(donorChildren, 'Override').find(node => (
    nodeAttributes(node).PartName === `/${sourcePart}`
  ))
  if (donorOverride) {
    if (!directNodes(targetChildren, 'Override').some(node => (
      nodeAttributes(node).PartName === `/${targetPart}`
    ))) {
      const copied = structuredClone(donorOverride)
      nodeAttributes(copied).PartName = `/${targetPart}`
      targetChildren.push(copied)
    }
  }
  else {
    const extension = posix.extname(sourcePart).slice(1).toLowerCase()
    const donorDefault = directNodes(donorChildren, 'Default').find(node => (
      (nodeAttributes(node).Extension ?? '').toLowerCase() === extension
    ))
    if (!donorDefault) {
      return [{
        code: 'pptx.writeback.generated-content-type-missing',
        message: `The generated object did not declare a content type for ${sourcePart}.`,
        partPath: path,
      }]
    }
    if (!directNodes(targetChildren, 'Default').some(node => (
      (nodeAttributes(node).Extension ?? '').toLowerCase() === extension
    ))) targetChildren.push(structuredClone(donorDefault))
  }
  targetZip.file(path, xmlBuilder.build(targetNodes) as string)
  return []
}

const allocateDonorPart = (zip: JSZip, donorPart: string): string => (
  zip.file(donorPart) ? allocateSiblingPart(zip, donorPart) : donorPart
)

const copyDonorPart = async (
  targetZip: JSZip,
  donorZip: JSZip,
  sourcePart: string,
  partMap: Map<string, string>,
): Promise<{ issues: PowerPointWritebackIssue[]; targetPart?: string }> => {
  const existing = partMap.get(sourcePart)
  if (existing) return { issues: [], targetPart: existing }
  const sourceEntry = donorZip.file(sourcePart)
  if (!sourceEntry) {
    return { issues: [{
      code: 'pptx.writeback.generated-dependency-missing',
      message: 'A generated object references a donor-package dependency that is missing.',
      partPath: sourcePart,
    }] }
  }
  const targetPart = allocateDonorPart(targetZip, sourcePart)
  partMap.set(sourcePart, targetPart)
  targetZip.file(targetPart, await sourceEntry.async('uint8array'))
  const issues = await copyDonorContentType(targetZip, donorZip, sourcePart, targetPart)
  if (issues.length) return { issues }

  const sourceRelationshipPath = relationshipPartPath(sourcePart)
  const relationshipEntry = donorZip.file(sourceRelationshipPath)
  if (!relationshipEntry) return { issues: [], targetPart }
  const relationships = relationshipDocument(await relationshipEntry.async('text'), targetPart)
  for (const relationship of relationships.byId.values()) {
    const attributes = nodeAttributes(relationship)
    if (attributes.TargetMode === 'External' || !attributes.Target) continue
    const dependency = internalRelationshipTarget(sourcePart, attributes.Target)
    const copied = await copyDonorPart(targetZip, donorZip, dependency, partMap)
    issues.push(...copied.issues)
    if (copied.targetPart) {
      attributes.Target = relativeRelationshipTarget(targetPart, copied.targetPart)
    }
  }
  if (issues.length) return { issues }
  const relationshipXml = serializeRelationshipDocument(relationships)
  const validation = XMLValidator.validate(relationshipXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return { issues: [{
      code: 'pptx.writeback.invalid-generated-relationships',
      message: `Generated dependency relationships are invalid: ${validation.err.msg}`,
      partPath: relationships.path,
    }] }
  }
  targetZip.file(relationships.path, relationshipXml)
  return { issues: [], targetPart }
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
      const internalSlide = target.startsWith('pptx-slide:')
        ? target.slice('pptx-slide:'.length)
        : undefined
      const actionAliases: Record<string, string> = {
        end: 'ppaction://hlinkshowjump?jump=endshow',
        first: 'ppaction://hlinkshowjump?jump=firstslide',
        last: 'ppaction://hlinkshowjump?jump=lastslide',
        next: 'ppaction://hlinkshowjump?jump=nextslide',
        previous: 'ppaction://hlinkshowjump?jump=previousslide',
      }
      const actionValue = target.startsWith('pptx-action:')
        ? target.slice('pptx-action:'.length)
        : undefined
      const action = actionValue ? actionAliases[actionValue] ?? actionValue : undefined
      const external = /^(?:https?:|mailto:|tel:)/i.test(target)
      if (!external && !internalSlide && !action) {
        return {
          code: 'pptx.writeback.hyperlink-target',
          elementId: operation.elementId,
          message: 'A run link must be an external URL, pptx-slide:<part>, or pptx-action:<action>.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }
      }
      if (internalSlide && !/^ppt\/slides\/slide\d+\.xml$/i.test(internalSlide)) {
        return {
          code: 'pptx.writeback.hyperlink-slide-target',
          elementId: operation.elementId,
          message: 'The internal link does not resolve to a retained PowerPoint slide part.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }
      }
      if (action && !/^ppaction:\/\/[a-z0-9/?=&._-]+$/i.test(action)) {
        return {
          code: 'pptx.writeback.hyperlink-action',
          elementId: operation.elementId,
          message: 'The PowerPoint action URI is invalid.',
          objectId: operation.objectId,
          partPath: operation.partPath,
          slideId: operation.slideId,
        }
      }
      const hyperlinkNode = hyperlink ?? xmlNode('a:hlinkClick')
      if (!hyperlink) insertBeforeHyperlinks(propertyChildren, hyperlinkNode)
      const hyperlinkAttributes = nodeAttributes(hyperlinkNode)
      if (action) {
        delete hyperlinkAttributes['r:id']
        hyperlinkAttributes.action = action
        editor.dirty = true
        return undefined
      }
      delete hyperlinkAttributes.action
      let relationship = relationshipId ? byId.get(relationshipId) : undefined
      if (relationshipId && !relationship) {
          return {
            code: 'pptx.writeback.hyperlink-relationship',
            elementId: operation.elementId,
            message: `The native run references missing relationship ${relationshipId}.`,
            objectId: operation.objectId,
            partPath: operation.partPath,
            slideId: operation.slideId,
          }
      }
      if (!relationship) {
        let numericId = 1
        while (byId.has(`rId${numericId}`)) numericId += 1
        const id = `rId${numericId}`
        relationship = xmlNode('Relationship', [], { Id: id })
        relationships.push(relationship)
        byId.set(id, relationship)
        hyperlinkAttributes['r:id'] = id
      }
      const attributes = nodeAttributes(relationship)
      if (internalSlide) {
        attributes.Target = relativeRelationshipTarget(partPath, internalSlide)
        delete attributes.TargetMode
        attributes.Type = SLIDE_RELATIONSHIP
        hyperlinkAttributes.action = 'ppaction://hlinksldjump'
      }
      else {
        attributes.Target = target
        attributes.TargetMode = 'External'
        attributes.Type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
      }
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

const NOTES_MASTER_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster'
const NOTES_SLIDE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide'
const SLIDE_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide'
const THEME_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme'

const ensureNotesMaster = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  donor: JSZip,
): Promise<{ issues: PowerPointWritebackIssue[]; partPath?: string }> => {
  const existing = Object.keys(zip.files).find(path => /^ppt\/notesMasters\/notesMaster\d+\.xml$/i.test(path))
  if (existing) return { issues: [], partPath: existing }
  const donorEntry = donor.file('ppt/notesMasters/notesMaster1.xml')
  if (!donorEntry) return { issues: [{
    code: 'pptx.writeback.notes-master-donor',
    message: 'The canonical notes donor has no notes master.',
    partPath: 'ppt/notesMasters/notesMaster1.xml',
  }] }
  const partPath = allocateSiblingPart(zip, 'ppt/notesMasters/notesMaster1.xml')
  zip.file(partPath, await donorEntry.async('uint8array'))
  const issues = await ensureContentTypeOverride(
    zip,
    partPath,
    'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  )
  const themePart = manifest.parts.find(part => part.kind === 'theme' && !/themeOverride/i.test(part.path))?.path
  if (themePart) await ensureInternalRelationship(zip, partPath, THEME_RELATIONSHIP, themePart)
  const presentationPart = 'ppt/presentation.xml'
  const presentationEntry = zip.file(presentationPart)
  if (!presentationEntry) return { issues: [...issues, {
    code: 'pptx.writeback.presentation-part-missing',
    message: 'The package has no presentation part for registering the notes master.',
    partPath: presentationPart,
  }] }
  const relationshipId = await ensureInternalRelationship(
    zip,
    presentationPart,
    NOTES_MASTER_RELATIONSHIP,
    partPath,
  )
  const presentationNodes = parseXml(await presentationEntry.async('text'), presentationPart)
  const presentation = findNode(presentationNodes, 'presentation')
  if (!presentation) return { issues: [...issues, {
    code: 'pptx.writeback.presentation-root-missing',
    message: 'The package presentation part has no presentation root.',
    partPath: presentationPart,
  }] }
  const children = ownChildren(presentation)
  const list = ensureDirectNode(
    children,
    'notesMasterIdLst',
    'p:notesMasterIdLst',
    Math.max(0, children.findIndex(node => localName(nodeTag(node) ?? '') === 'sldIdLst')),
  )
  const listChildren = ownChildren(list)
  if (!listChildren.some(node => nodeAttributes(node)['r:id'] === relationshipId)) {
    listChildren.push(xmlNode('p:notesMasterId', [], { 'r:id': relationshipId }))
  }
  zip.file(presentationPart, xmlBuilder.build(presentationNodes) as string)
  return { issues, partPath }
}

const createNotesPart = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  operation: PowerPointNotesPatch,
): Promise<PowerPointWritebackIssue[]> => {
  const donor = await JSZip.loadAsync(await generateNotesDonorPackage(operation.after))
  const notesEntry = donor.file('ppt/notesSlides/notesSlide1.xml')
  if (!notesEntry) return [{
    code: 'pptx.writeback.notes-slide-donor',
    message: 'The canonical notes donor has no notes slide.',
    partPath: operation.notesPart,
    slideId: operation.slideId,
  }]
  const master = await ensureNotesMaster(zip, manifest, donor)
  if (!master.partPath || master.issues.length) return master.issues.map(issue => ({
    ...issue,
    slideId: operation.slideId,
  }))
  zip.file(operation.notesPart, await notesEntry.async('uint8array'))
  const issues = await ensureContentTypeOverride(
    zip,
    operation.notesPart,
    'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  )
  await ensureInternalRelationship(zip, operation.notesPart, NOTES_MASTER_RELATIONSHIP, master.partPath)
  await ensureInternalRelationship(zip, operation.notesPart, SLIDE_RELATIONSHIP, operation.slidePart)
  await ensureInternalRelationship(zip, operation.slidePart, NOTES_SLIDE_RELATIONSHIP, operation.notesPart)
  return issues
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

const COMMENTS_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENT_AUTHORS_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors'
const COMMENT_THREADING_EXTENSION = '{C676402C-5697-4E1C-873F-D02D1690AC5C}'

const removeInternalRelationship = async (
  zip: JSZip,
  ownerPart: string,
  targetPart: string,
): Promise<void> => {
  const path = relationshipPartPath(ownerPart)
  const entry = zip.file(path)
  if (!entry) return
  const relationships = relationshipDocument(await entry.async('text'), ownerPart)
  for (let index = relationships.children.length - 1; index >= 0; index -= 1) {
    const relationship = relationships.children[index]!
    const attributes = nodeAttributes(relationship)
    if (
      attributes.TargetMode !== 'External'
      && attributes.Target
      && internalRelationshipTarget(ownerPart, attributes.Target) === targetPart
    ) {
      relationships.children.splice(index, 1)
      if (attributes.Id) relationships.byId.delete(attributes.Id)
    }
  }
  zip.file(path, serializeRelationshipDocument(relationships))
}

const removeContentTypeOverride = async (zip: JSZip, partPath: string): Promise<void> => {
  const path = '[Content_Types].xml'
  const entry = zip.file(path)
  if (!entry) return
  const nodes = parseXml(await entry.async('text'), path)
  const types = findNode(nodes, 'Types')
  if (!types) return
  const children = ownChildren(types)
  for (let index = children.length - 1; index >= 0; index -= 1) {
    if (
      localName(nodeTag(children[index]!) ?? '') === 'Override'
      && nodeAttributes(children[index]!).PartName === `/${partPath}`
    ) children.splice(index, 1)
  }
  zip.file(path, xmlBuilder.build(nodes) as string)
}

const commentInitials = (name: string): string => name
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0]!.toUpperCase())
  .join('') || 'M'

const commentDate = (time: number): string => (
  new Date(Number.isFinite(time) && time > 0 ? time : 0).toISOString()
)

const patchCommentsStructure = async (
  zip: JSZip,
  operation: PowerPointCommentsPatch,
): Promise<PowerPointWritebackIssue[]> => {
  for (const removedPart of operation.removePartPaths ?? []) {
    await removeInternalRelationship(zip, operation.slidePart, removedPart)
    await removeContentTypeOverride(zip, removedPart)
    zip.remove(removedPart)
    zip.remove(relationshipPartPath(removedPart))
  }
  if (!operation.comments.length) {
    await removeInternalRelationship(zip, operation.slidePart, operation.partPath)
    await removeContentTypeOverride(zip, operation.partPath)
    zip.remove(operation.partPath)
    zip.remove(relationshipPartPath(operation.partPath))
  }
  else {
    const authorsByName = new Map(operation.authors.map((author, index) => [author, String(index)]))
    const byKey = new Map(operation.comments.map(comment => [comment.key, comment]))
    const commentNodes = operation.comments.map(comment => {
      const authorId = authorsByName.get(comment.user) ?? '0'
      const children: OrderedXmlNode[] = [
        xmlNode('p:pos', [], {
          x: String(Math.round(comment.position?.x ?? 0)),
          y: String(Math.round(comment.position?.y ?? 0)),
        }),
        xmlNode('p:text', [{ '#text': escapeXmlText(comment.content) }]),
      ]
      const parent = comment.parentKey ? byKey.get(comment.parentKey) : undefined
      if (parent) {
        children.push(xmlNode('p:extLst', [
          xmlNode('p:ext', [
            xmlNode('p15:threadingInfo', [
              xmlNode('p15:parentCm', [], {
                authorId: authorsByName.get(parent.user) ?? '0',
                idx: String(parent.index),
              }),
            ], {
              'xmlns:p15': 'http://schemas.microsoft.com/office/powerpoint/2012/main',
              timeZoneBias: '0',
            }),
          ], { uri: COMMENT_THREADING_EXTENSION }),
        ]))
      }
      return xmlNode('p:cm', children, {
        authorId,
        dt: commentDate(comment.time),
        idx: String(comment.index),
      })
    })
    const commentsXml = xmlBuilder.build([
      xmlNode('p:cmLst', commentNodes, {
        'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
      }),
    ]) as string
    const validation = XMLValidator.validate(commentsXml, { allowBooleanAttributes: false })
    if (validation !== true) return [{
      code: 'pptx.writeback.invalid-comments-output',
      message: `Comment structure authoring produced invalid XML: ${validation.err.msg}`,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
    zip.file(operation.partPath, commentsXml)
    await ensureContentTypeOverride(
      zip,
      operation.partPath,
      'application/vnd.openxmlformats-officedocument.presentationml.comments+xml',
    )
    await ensureInternalRelationship(zip, operation.slidePart, COMMENTS_RELATIONSHIP, operation.partPath)
  }

  if (operation.authors.length) {
    const maxIndexByAuthor = new Map<string, number>()
    for (const comment of operation.comments) {
      maxIndexByAuthor.set(comment.user, Math.max(maxIndexByAuthor.get(comment.user) ?? 0, comment.index))
    }
    const authorXml = xmlBuilder.build([
      xmlNode('p:cmAuthorLst', operation.authors.map((author, index) => (
        xmlNode('p:cmAuthor', [], {
          clrIdx: String(index),
          id: String(index),
          initials: commentInitials(author),
          lastIdx: String(maxIndexByAuthor.get(author) ?? 0),
          name: author,
        })
      )), { 'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main' }),
    ]) as string
    zip.file(operation.authorsPart, authorXml)
    await ensureContentTypeOverride(
      zip,
      operation.authorsPart,
      'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml',
    )
    await ensureInternalRelationship(
      zip,
      'ppt/presentation.xml',
      COMMENT_AUTHORS_RELATIONSHIP,
      operation.authorsPart,
    )
  }
  return []
}

const backgroundFillNode = (
  background: PowerPointBackgroundPatch['after'],
  imageFill?: OrderedXmlNode,
): OrderedXmlNode => {
  if (background?.type === 'image') return imageFill ?? xmlNode('a:noFill')
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
  imageFill?: OrderedXmlNode,
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
      xmlNode('p:bgPr', [backgroundFillNode(operation.after, imageFill)], { shadeToTitle: '0' }),
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

const patchThemePart = (
  xml: string,
  operation: PowerPointThemePatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.partPath)
  const colorScheme = findNode(nodes, 'clrScheme')
  const fontScheme = findNode(nodes, 'fontScheme')
  if (!colorScheme || !fontScheme) {
    return {
      issues: [{
        code: 'pptx.writeback.theme-structure',
        message: 'The retained theme is missing its color or font scheme.',
        partPath: operation.partPath,
      }],
      xml,
    }
  }
  const colors = new Map<string, string | undefined>([
    ['dk1', normalizeColor(operation.after.fontColor)],
    ['lt1', normalizeColor(operation.after.backgroundColor)],
    ...operation.after.themeColors.slice(0, 6).map((color, index) => (
      [`accent${index + 1}`, normalizeColor(color)] as [string, string | undefined]
    )),
  ])
  for (const [slot, color] of colors) {
    if (!color) continue
    const slotNode = directNode(ownChildren(colorScheme), slot)
    if (!slotNode) continue
    const children = ownChildren(slotNode)
    children.splice(0, children.length, xmlNode('a:srgbClr', [], { val: color }))
  }
  const fontName = normalizeFontFamily(operation.after.fontName)
  if (fontName) {
    for (const family of ['majorFont', 'minorFont']) {
      const familyNode = findNode(ownChildren(fontScheme), family)
      const latin = familyNode ? directNode(ownChildren(familyNode), 'latin') : undefined
      if (latin) nodeAttributes(latin).typeface = fontName
    }
  }
  const output = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(output, { allowBooleanAttributes: false })
  return validation === true
    ? { issues: [], xml: output }
    : {
        issues: [{
          code: 'pptx.writeback.invalid-theme-output',
          message: `Theme authoring produced invalid XML: ${validation.err.msg}`,
          partPath: operation.partPath,
        }],
        xml,
      }
}

const timingPreset = (
  animation: PowerPointTimingPatch['after'][number],
): { filter: string; presetClass: string; presetId: string } => {
  const presetClass = animation.type === 'in' ? 'entr' : animation.type === 'out' ? 'exit' : 'emph'
  const effect = animation.effect.toLowerCase()
  if (animation.type === 'attention') {
    return { filter: effect.includes('swing') ? 'spin' : 'pulse', presetClass, presetId: effect.includes('swing') ? '8' : '6' }
  }
  if (effect.includes('zoom')) return { filter: 'zoom', presetClass, presetId: '23' }
  if (effect.includes('rotate')) return { filter: 'wheel(1)', presetClass, presetId: '19' }
  if (effect.includes('slide') || effect.includes('light') || effect.includes('back')) {
    const direction = effect.includes('right')
      ? 'right'
      : effect.includes('up')
        ? 'up'
        : effect.includes('down')
          ? 'down'
          : 'left'
    return { filter: `wipe(${direction})`, presetClass, presetId: '2' }
  }
  return { filter: 'fade', presetClass, presetId: '10' }
}

const generatedNativeShapeId = (
  nodes: readonly OrderedXmlNode[],
  elementId: string,
): string | undefined => {
  const marker = generatedElementMarker(elementId)
  let result: string | undefined
  const visit = (current: readonly OrderedXmlNode[]): void => {
    for (const node of current) {
      for (const [tag, children] of nodeEntries(node)) {
        if (localName(tag) === 'cNvPr') {
          const attributes = nodeAttributes(node)
          if (attributes.name === marker || attributes.title === marker) result = attributes.id
        }
        if (!result) visit(children)
      }
      if (result) return
    }
  }
  visit(nodes)
  return result
}

const patchTimingPart = (
  xml: string,
  operation: PowerPointTimingPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.partPath)
  const slide = findNode(nodes, 'sld')
  if (!slide) return { issues: [{
    code: 'pptx.writeback.timing-slide-root',
    message: 'The target slide has no root for animation timing.',
    partPath: operation.partPath,
    slideId: operation.slideId,
  }], xml }
  const children = ownChildren(slide)
  removeDirectNodes(children, new Set(['timing']))
  if (!operation.after.length) return { issues: [], xml: xmlBuilder.build(nodes) as string }
  const issues: PowerPointWritebackIssue[] = []
  let nextId = 1
  const effectNodes = operation.after.flatMap(animation => {
    const targetReference = operation.targets[animation.elId]
    const targetShapeId = targetReference?.startsWith('generated:')
      ? generatedNativeShapeId(nodes, targetReference.slice('generated:'.length))
      : targetReference
    if (!targetShapeId) {
      issues.push({
        code: 'pptx.writeback.animation-target',
        elementId: animation.elId,
        message: 'The animation target has no allocated native PowerPoint shape ID.',
        partPath: operation.partPath,
        slideId: operation.slideId,
      })
      return []
    }
    const preset = timingPreset(animation)
    const effectId = String(nextId++)
    const behaviorId = String(nextId++)
    return [xmlNode('p:par', [
      xmlNode('p:cTn', [
        xmlNode('p:stCondLst', [xmlNode('p:cond', [], {
          delay: '0',
        })]),
        xmlNode('p:childTnLst', [
          xmlNode('p:animEffect', [
            xmlNode('p:cBhvr', [
              xmlNode('p:cTn', [], {
                dur: String(Math.max(1, Math.round(animation.duration))),
                fill: 'hold',
                id: behaviorId,
              }),
              xmlNode('p:tgtEl', [xmlNode('p:spTgt', [], { spid: targetShapeId })]),
            ]),
          ], {
            filter: preset.filter,
            transition: animation.type === 'out' ? 'out' : 'in',
          }),
        ]),
      ], {
        fill: 'hold',
        id: effectId,
        nodeType: animation.trigger === 'meantime'
          ? 'withEffect'
          : animation.trigger === 'auto'
            ? 'afterEffect'
            : 'clickEffect',
        presetClass: preset.presetClass,
        presetID: preset.presetId,
        presetSubtype: '0',
      }),
    ])]
  })
  if (issues.length) return { issues, xml }
  const rootId = String(nextId++)
  const sequenceId = String(nextId++)
  const timing = xmlNode('p:timing', [
    xmlNode('p:tnLst', [
      xmlNode('p:par', [
        xmlNode('p:cTn', [
          xmlNode('p:childTnLst', [
            xmlNode('p:seq', [
              xmlNode('p:cTn', [xmlNode('p:childTnLst', effectNodes)], {
                dur: 'indefinite',
                id: sequenceId,
                nodeType: 'mainSeq',
              }),
            ], { concurrent: '1', nextAc: 'seek' }),
          ]),
        ], { dur: 'indefinite', id: rootId, nodeType: 'tmRoot', restart: 'never' }),
      ]),
    ]),
    xmlNode('p:bldLst', [...new Set(Object.values(operation.targets))].flatMap(target => {
      const targetShapeId = target.startsWith('generated:')
        ? generatedNativeShapeId(nodes, target.slice('generated:'.length))
        : target
      return targetShapeId
        ? [xmlNode('p:bldP', [], { build: 'all', grpId: '0', spid: targetShapeId })]
        : []
    })),
  ])
  const extensionIndex = children.findIndex(node => localName(nodeTag(node) ?? '') === 'extLst')
  children.splice(extensionIndex < 0 ? children.length : extensionIndex, 0, timing)
  const output = xmlBuilder.build(nodes) as string
  const validation = XMLValidator.validate(output, { allowBooleanAttributes: false })
  return validation === true ? { issues: [], xml: output } : {
    issues: [{
      code: 'pptx.writeback.invalid-timing-output',
      message: `Animation timing authoring produced invalid XML: ${validation.err.msg}`,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }],
    xml,
  }
}

const patchTransitionPart = (
  xml: string,
  operation: PowerPointTransitionPatch,
): { issues: PowerPointWritebackIssue[]; xml: string } => {
  const nodes = parseXml(xml, operation.partPath)
  const slide = findNode(nodes, 'sld')
  if (!slide) return { issues: [{
    code: 'pptx.writeback.transition-slide-root',
    message: 'The target slide has no root for transition authoring.',
    partPath: operation.partPath,
    slideId: operation.slideId,
  }], xml }
  const children = ownChildren(slide)
  let transition = directNode(children, 'transition')
  if (operation.after.turningMode === 'no' && operation.after.durationMs === undefined) {
    removeDirectNodes(children, new Set(['transition']))
    return { issues: [], xml: xmlBuilder.build(nodes) as string }
  }
  transition ??= xmlNode('p:transition')
  if (!children.includes(transition)) {
    const timingIndex = children.findIndex(node => localName(nodeTag(node) ?? '') === 'timing')
    children.splice(timingIndex < 0 ? children.length : timingIndex, 0, transition)
  }
  const attributes = nodeAttributes(transition)
  if (operation.after.durationMs !== undefined) {
    attributes.advTm = String(Math.max(0, Math.round(operation.after.durationMs)))
    attributes.advClick = '0'
  }
  else {
    delete attributes.advTm
    delete attributes.advClick
  }
  const transitionChildren = ownChildren(transition)
  const preserved = transitionChildren.filter(node => ['extLst', 'sndAc'].includes(
    localName(nodeTag(node) ?? ''),
  ))
  const effect = operation.after.turningMode === 'fade'
    ? xmlNode('p:fade')
    : operation.after.turningMode === 'slideX'
      ? xmlNode('p:push', [], { dir: 'l' })
      : operation.after.turningMode === 'slideY'
        ? xmlNode('p:push', [], { dir: 'u' })
        : operation.after.turningMode === 'random'
          ? xmlNode('p:random')
          : undefined
  transitionChildren.splice(0, transitionChildren.length, ...(effect ? [effect] : []), ...preserved)
  return { issues: [], xml: xmlBuilder.build(nodes) as string }
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

const effectColorNode = (color: string, opacity: number): OrderedXmlNode => {
  const alpha = Math.max(0, Math.min(100_000, Math.round(opacity * 100_000)))
  return xmlNode('a:srgbClr', alpha < 100_000
    ? [xmlNode('a:alpha', [], { val: String(alpha) })]
    : [], { val: normalizeColor(color) ?? '000000' })
}

const cssColorOpacity = (color: string): number => {
  const hexAlpha = color.trim().match(/^#[0-9a-f]{6}([0-9a-f]{2})$/i)?.[1]
  if (hexAlpha) return Number.parseInt(hexAlpha, 16) / 255
  const rgbaAlpha = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i)?.[1]
  const parsed = rgbaAlpha === undefined ? 1 : Number(rgbaAlpha)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1
}

const editableEffectNodes = (
  effects: PowerPointEffectsPatch['after'],
  scale: number,
  outerShadow?: PowerPointEffectsPatch['afterOuterShadow'],
): OrderedXmlNode[] => {
  const nodes: OrderedXmlNode[] = []
  if (effects?.glow) {
    nodes.push(xmlNode('a:glow', [
      effectColorNode(effects.glow.color, effects.glow.opacity),
    ], { rad: String(Math.max(0, Math.round(effects.glow.radius / scale * 12_700))) }))
  }
  if (effects?.innerShadow) {
    const shadow = effects.innerShadow
    const distance = Math.hypot(shadow.h, shadow.v)
    const direction = ((Math.atan2(shadow.v, shadow.h) * 180 / Math.PI) + 360) % 360
    nodes.push(xmlNode('a:innerShdw', [
      effectColorNode(shadow.color, shadow.opacity),
    ], {
      blurRad: String(Math.max(0, Math.round(shadow.blur / scale * 12_700))),
      dir: String(Math.round(direction * 60_000)),
      dist: String(Math.max(0, Math.round(distance / scale * 12_700))),
    }))
  }
  if (outerShadow) {
    const distance = Math.hypot(outerShadow.h, outerShadow.v)
    const direction = ((Math.atan2(outerShadow.v, outerShadow.h) * 180 / Math.PI) + 360) % 360
    nodes.push(xmlNode('a:outerShdw', [
      effectColorNode(outerShadow.color, cssColorOpacity(outerShadow.color)),
    ], {
      blurRad: String(Math.max(0, Math.round(outerShadow.blur / scale * 12_700))),
      dir: String(Math.round(direction * 60_000)),
      dist: String(Math.max(0, Math.round(distance / scale * 12_700))),
      rotWithShape: '0',
    }))
  }
  if (effects?.reflection) {
    const reflection = effects.reflection
    nodes.push(xmlNode('a:reflection', [], {
      blurRad: String(Math.max(0, Math.round(reflection.blur / scale * 12_700))),
      dir: String(Math.round(reflection.direction * 60_000)),
      dist: String(Math.max(0, Math.round(reflection.distance / scale * 12_700))),
      endA: '0',
      endPos: '100000',
      stA: String(Math.max(0, Math.min(100_000, Math.round(reflection.opacity * 100_000)))),
      stPos: '0',
      sy: String(Math.round(reflection.scaleY * 100_000)),
    }))
  }
  if (effects?.softEdge) {
    nodes.push(xmlNode('a:softEdge', [], {
      rad: String(Math.max(0, Math.round(effects.softEdge.radius / scale * 12_700))),
    }))
  }
  return nodes
}

const nestedNodes = (
  nodes: readonly OrderedXmlNode[],
  expected: string,
): OrderedXmlNode[] => nodes.flatMap(node => nodeEntries(node).flatMap(([tag, children]) => [
  ...(localName(tag) === expected ? [node] : []),
  ...nestedNodes(children, expected),
]))

const replaceEffectNode = (
  existing: OrderedXmlNode,
  replacement: OrderedXmlNode,
): void => {
  const tag = nodeTag(existing) ?? nodeTag(replacement) ?? 'a:effect'
  const attributes = {
    ...nodeAttributes(existing),
    ...nodeAttributes(replacement),
  }
  for (const key of Object.keys(existing)) delete existing[key]
  Object.assign(existing, xmlNode(tag, ownChildren(replacement), attributes))
}

const patchEffectList = (
  shapeProperties: OrderedXmlNode,
  effects: PowerPointEffectsPatch['after'],
  scale: number,
  outerShadow?: PowerPointEffectsPatch['afterOuterShadow'],
  beforeEffects?: PowerPointEffectsPatch['before'],
  beforeOuterShadow?: PowerPointEffectsPatch['beforeOuterShadow'],
): PowerPointWritebackIssue[] => {
  const properties = ownChildren(shapeProperties)
  const effectDag = directNode(properties, 'effectDag')
  const authored = editableEffectNodes(effects, scale, outerShadow)
  if (effectDag) {
    const beforeTypes = new Set(editableEffectNodes(
      beforeEffects,
      scale,
      beforeOuterShadow,
    ).map(node => localName(nodeTag(node) ?? '')))
    const afterTypes = new Set(authored.map(node => localName(nodeTag(node) ?? '')))
    if (
      beforeTypes.size !== afterTypes.size
      || [...beforeTypes].some(type => !afterTypes.has(type))
    ) {
      return [{
        code: 'pptx.writeback.effect-dag-topology',
        message: 'Adding or removing effects would change this composited DrawingML effect graph. Existing supported graph effects may be edited in place.',
      }]
    }
    for (const replacement of authored) {
      const type = localName(nodeTag(replacement) ?? '')
      const matches = nestedNodes(ownChildren(effectDag), type)
      if (matches.length !== 1) {
        return [{
          code: 'pptx.writeback.effect-dag-target',
          message: `The composited DrawingML effect graph contains ${matches.length} ${type} nodes; Mona cannot select one without changing graph semantics.`,
        }]
      }
      replaceEffectNode(matches[0]!, replacement)
    }
    return []
  }
  let effectList = directNode(properties, 'effectLst')
  if (!effectList && !effects && !outerShadow) return []
  effectList ??= ensureDirectNode(properties, 'effectLst', 'a:effectLst')
  const children = ownChildren(effectList)
  removeDirectNodes(children, new Set(['glow', 'innerShdw', 'outerShdw', 'reflection', 'softEdge']))
  children.push(...authored)
  const order = new Map([
    ['blur', 0], ['fillOverlay', 1], ['glow', 2], ['innerShdw', 3],
    ['outerShdw', 4], ['prstShdw', 5], ['reflection', 6], ['softEdge', 7],
  ])
  children.sort((left, right) => (
    (order.get(localName(nodeTag(left) ?? '')) ?? 100)
    - (order.get(localName(nodeTag(right) ?? '')) ?? 100)
  ))
  if (!children.length) properties.splice(properties.indexOf(effectList), 1)
  return []
}

const patchAdvancedEffects = (
  children: OrderedXmlNode[],
  operation: PowerPointEffectsPatch,
): PowerPointWritebackIssue[] => {
  if (JSON.stringify(operation.before) === JSON.stringify(operation.after)) return []
  if (!operation.scale || operation.scale <= 0) {
    return [{
      code: 'pptx.writeback.effect-scale',
      elementId: operation.elementId,
      message: 'The retained object has no exact canvas-to-PowerPoint scale for its advanced effects.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const properties = findNode(children, 'spPr') ?? findNode(children, 'grpSpPr')
  if (!properties) {
    return [{
      code: 'pptx.writeback.effect-structure',
      elementId: operation.elementId,
      message: 'The retained object has no native visual-properties container for advanced effects.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  return patchEffectList(
    properties,
    operation.after,
    operation.scale,
    operation.afterOuterShadow,
    operation.before,
    operation.beforeOuterShadow,
  ).map(issue => ({
    ...issue,
    elementId: operation.elementId,
    objectId: operation.objectId,
    partPath: operation.partPath,
    slideId: operation.slideId,
  }))
}

const updateThreeDRotation = (
  children: OrderedXmlNode[],
  rotation: { latitude: number; longitude: number; revolution: number } | undefined,
): void => {
  const existing = directNode(children, 'rot')
  if (!rotation) {
    if (existing) children.splice(children.indexOf(existing), 1)
    return
  }
  const node = existing ?? ensureDirectNode(children, 'rot', 'a:rot')
  Object.assign(nodeAttributes(node), {
    lat: String(Math.round(rotation.latitude * 60_000)),
    lon: String(Math.round(rotation.longitude * 60_000)),
    rev: String(Math.round(rotation.revolution * 60_000)),
  })
}

const patchThreeDProperties = (
  shapeProperties: OrderedXmlNode,
  threeD: PowerPointThreeDPatch['after'],
  scale: number,
): void => {
  const properties = ownChildren(shapeProperties)
  const existingScene = directNode(properties, 'scene3d')
  const existingShape = directNode(properties, 'sp3d')
  const hasScene = Boolean(threeD?.camera || threeD?.light)
  if (!hasScene) {
    if (existingScene) properties.splice(properties.indexOf(existingScene), 1)
  }
  else {
    const insertAt = properties.findIndex(node => (
      ['sp3d', 'extLst'].includes(localName(nodeTag(node) ?? ''))
    ))
    const scene = existingScene ?? ensureDirectNode(
      properties,
      'scene3d',
      'a:scene3d',
      insertAt < 0 ? properties.length : insertAt,
    )
    const sceneChildren = ownChildren(scene)
    const camera = ensureDirectNode(sceneChildren, 'camera', 'a:camera', 0)
    const cameraValue = threeD?.camera ?? { preset: 'orthographicFront' }
    const cameraAttributes = nodeAttributes(camera)
    cameraAttributes.prst = cameraValue.preset
    if (cameraValue.zoom === undefined) delete cameraAttributes.zoom
    else cameraAttributes.zoom = String(Math.round(cameraValue.zoom * 100_000))
    updateThreeDRotation(ownChildren(camera), cameraValue.rotation)

    const light = ensureDirectNode(sceneChildren, 'lightRig', 'a:lightRig')
    const lightValue = threeD?.light ?? { direction: 't', rig: 'threePt' }
    Object.assign(nodeAttributes(light), {
      dir: lightValue.direction,
      rig: lightValue.rig,
    })
    updateThreeDRotation(ownChildren(light), lightValue.rotation)
  }

  if (!threeD?.shape) {
    if (existingShape) properties.splice(properties.indexOf(existingShape), 1)
    return
  }
  const extIndex = properties.findIndex(node => localName(nodeTag(node) ?? '') === 'extLst')
  const shape = existingShape ?? ensureDirectNode(
    properties,
    'sp3d',
    'a:sp3d',
    extIndex < 0 ? properties.length : extIndex,
  )
  const attributes = nodeAttributes(shape)
  for (const name of ['contourW', 'extrusionH', 'prstMaterial', 'z']) delete attributes[name]
  const nativeLength = (value: number): string => String(Math.round(value / scale * 12_700))
  if (threeD.shape.contourWidth !== undefined) attributes.contourW = nativeLength(threeD.shape.contourWidth)
  if (threeD.shape.extrusionHeight !== undefined) attributes.extrusionH = nativeLength(threeD.shape.extrusionHeight)
  if (threeD.shape.material) attributes.prstMaterial = threeD.shape.material
  if (threeD.shape.z !== undefined) attributes.z = nativeLength(threeD.shape.z)
  const shapeChildren = ownChildren(shape)
  removeDirectNodes(shapeChildren, new Set(['bevelB', 'bevelT', 'contourClr', 'extrusionClr']))
  const bevelNode = (
    tag: 'a:bevelB' | 'a:bevelT',
    bevel: NonNullable<NonNullable<PowerPointThreeDPatch['after']>['shape']>['bevelTop'],
  ) => bevel
    ? xmlNode(tag, [], {
        h: nativeLength(bevel.height),
        prst: bevel.preset,
        w: nativeLength(bevel.width),
      })
    : undefined
  const bevelTop = bevelNode('a:bevelT', threeD.shape.bevelTop)
  const bevelBottom = bevelNode('a:bevelB', threeD.shape.bevelBottom)
  if (bevelTop) shapeChildren.push(bevelTop)
  if (bevelBottom) shapeChildren.push(bevelBottom)
  if (threeD.shape.extrusionColor) {
    shapeChildren.push(xmlNode('a:extrusionClr', [
      effectColorNode(threeD.shape.extrusionColor, 1),
    ]))
  }
  if (threeD.shape.contourColor) {
    shapeChildren.push(xmlNode('a:contourClr', [
      effectColorNode(threeD.shape.contourColor, 1),
    ]))
  }
}

const patchThreeD = (
  children: OrderedXmlNode[],
  operation: PowerPointThreeDPatch,
): PowerPointWritebackIssue[] => {
  if (
    !operation.materializeInherited
    && JSON.stringify(operation.before) === JSON.stringify(operation.after)
  ) return []
  if (!operation.scale || operation.scale <= 0) {
    return [{
      code: 'pptx.writeback.three-d-scale',
      elementId: operation.elementId,
      message: 'The retained object has no exact canvas-to-PowerPoint scale for its 3D geometry.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  const properties = findNode(children, 'spPr') ?? findNode(children, 'grpSpPr')
  if (!properties) {
    return [{
      code: 'pptx.writeback.three-d-structure',
      elementId: operation.elementId,
      message: 'The retained object has no native visual-properties container for 3D geometry.',
      objectId: operation.objectId,
      partPath: operation.partPath,
      slideId: operation.slideId,
    }]
  }
  patchThreeDProperties(properties, operation.after, operation.scale)
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

const generatedDrawingByMarker = (
  donorNodes: OrderedXmlNode[],
  marker: string,
): DrawingNodeLocation | undefined => collectDrawingNodes(donorNodes).find(location => {
  const nonVisual = findNode(location.children, 'cNvPr')
  return nonVisual && nodeAttributes(nonVisual).name === marker
})

const replaceShapeTextBody = (
  shape: OrderedXmlNode,
  textSource: OrderedXmlNode,
): void => {
  const shapeChildren = ownChildren(shape)
  removeDirectNodes(shapeChildren, new Set(['txBody']))
  const textBody = directNode(ownChildren(textSource), 'txBody')
    ?? findNode(ownChildren(textSource), 'txBody')
  if (textBody) shapeChildren.push(structuredClone(textBody))
}

const generatedGroupNode = (
  element: Extract<PPTElement, { type: 'group' }>,
  children: OrderedXmlNode[],
  scale: number,
): OrderedXmlNode => {
  const emuPerCanvasUnit = 12_700 / scale
  const transformAttributes: Record<string, string> = {}
  if (element.rotate) transformAttributes.rot = String(Math.round(element.rotate * 60_000))
  if (element.flipH) transformAttributes.flipH = '1'
  if (element.flipV) transformAttributes.flipV = '1'
  return xmlNode('p:grpSp', [
    xmlNode('p:nvGrpSpPr', [
      xmlNode('p:cNvPr', [], {
        id: '0',
        name: element.name || generatedElementMarker(element.id),
        ...(element.name ? { title: generatedElementMarker(element.id) } : {}),
      }),
      xmlNode('p:cNvGrpSpPr'),
      xmlNode('p:nvPr'),
    ]),
    xmlNode('p:grpSpPr', [
      xmlNode('a:xfrm', [
        xmlNode('a:off', [], {
          x: String(Math.round(element.left * emuPerCanvasUnit)),
          y: String(Math.round(element.top * emuPerCanvasUnit)),
        }),
        xmlNode('a:ext', [], {
          cx: String(Math.max(1, Math.round(element.width * emuPerCanvasUnit))),
          cy: String(Math.max(1, Math.round(element.height * emuPerCanvasUnit))),
        }),
        xmlNode('a:chOff', [], { x: '0', y: '0' }),
        xmlNode('a:chExt', [], {
          cx: String(Math.max(1, Math.round(element.coordinateWidth * emuPerCanvasUnit))),
          cy: String(Math.max(1, Math.round(element.coordinateHeight * emuPerCanvasUnit))),
        }),
      ], transformAttributes),
    ]),
    ...children,
  ])
}

const generatedConnectorNode = (
  element: Extract<PPTElement, { type: 'line' }>,
  scale: number,
): OrderedXmlNode => {
  const start: [number, number] = [element.left + element.start[0], element.top + element.start[1]]
  const end: [number, number] = [element.left + element.end[0], element.top + element.end[1]]
  const minX = Math.min(start[0], end[0])
  const minY = Math.min(start[1], end[1])
  const width = Math.abs(end[0] - start[0])
  const height = Math.abs(end[1] - start[1])
  const flipH = start[0] > end[0]
  const flipV = start[1] > end[1]
  const emu = 12_700 / scale
  const transformAttributes: Record<string, string> = {}
  if (flipH) transformAttributes.flipH = '1'
  if (flipV) transformAttributes.flipV = '1'
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
  if (element.broken) {
    route.push(xmlNode('a:lnTo', [pointNode([
      element.left + element.broken[0],
      element.top + element.broken[1],
    ])]))
    route.push(xmlNode('a:lnTo', [pointNode(end)]))
  }
  else if (element.broken2) {
    const control = [
      element.left + element.broken2[0],
      element.top + element.broken2[1],
    ] as [number, number]
    const horizontal = element.broken2Direction === 'horizontal'
      || (!element.broken2Direction && width >= height)
    route.push(xmlNode('a:lnTo', [pointNode(horizontal
      ? [control[0], start[1]]
      : [start[0], control[1]])]))
    route.push(xmlNode('a:lnTo', [pointNode(horizontal
      ? [control[0], end[1]]
      : [end[0], control[1]])]))
    route.push(xmlNode('a:lnTo', [pointNode(end)]))
  }
  else if (element.curve) {
    route.push(xmlNode('a:quadBezTo', [
      pointNode([element.left + element.curve[0], element.top + element.curve[1]]),
      pointNode(end),
    ]))
  }
  else if (element.cubic) {
    route.push(xmlNode('a:cubicBezTo', [
      pointNode([element.left + element.cubic[0][0], element.top + element.cubic[0][1]]),
      pointNode([element.left + element.cubic[1][0], element.top + element.cubic[1][1]]),
      pointNode(end),
    ]))
  }
  const geometry = element.broken || element.broken2 || element.curve || element.cubic
    ? xmlNode('a:custGeom', [
        xmlNode('a:avLst'),
        xmlNode('a:gdLst'),
        xmlNode('a:ahLst'),
        xmlNode('a:cxnLst'),
        xmlNode('a:rect', [], { b: 'b', l: 'l', r: 'r', t: 't' }),
        xmlNode('a:pathLst', [xmlNode('a:path', route, {
          extrusionOk: '0', fill: 'none', h: '100000', stroke: '1', w: '100000',
        })]),
      ])
    : xmlNode('a:prstGeom', [xmlNode('a:avLst')], { prst: 'straightConnector1' })
  const lineColor = normalizeColor(element.color) ?? '000000'
  const lineChildren: OrderedXmlNode[] = [
    xmlNode('a:solidFill', [xmlNode('a:srgbClr', [], { val: lineColor })]),
    xmlNode('a:prstDash', [], {
      val: element.style === 'dashed' ? 'dash' : element.style === 'dotted' ? 'dot' : 'solid',
    }),
  ]
  if (element.points[0]) {
    lineChildren.push(xmlNode('a:headEnd', [], {
      type: element.points[0] === 'dot' ? 'oval' : 'triangle',
    }))
  }
  if (element.points[1]) {
    lineChildren.push(xmlNode('a:tailEnd', [], {
      type: element.points[1] === 'dot' ? 'oval' : 'triangle',
    }))
  }
  const connectorRelationships: OrderedXmlNode[] = []
  if (element.connections?.start) {
    connectorRelationships.push(xmlNode('a:stCxn', [], {
      id: element.connections.start.nativeShapeId,
      idx: element.connections.start.siteIndex,
    }))
  }
  if (element.connections?.end) {
    connectorRelationships.push(xmlNode('a:endCxn', [], {
      id: element.connections.end.nativeShapeId,
      idx: element.connections.end.siteIndex,
    }))
  }
  return xmlNode('p:cxnSp', [
    xmlNode('p:nvCxnSpPr', [
      xmlNode('p:cNvPr', [], {
        id: '0',
        name: element.name || generatedElementMarker(element.id),
        ...(element.name ? { title: generatedElementMarker(element.id) } : {}),
      }),
      xmlNode('p:cNvCxnSpPr', connectorRelationships),
      xmlNode('p:nvPr'),
    ]),
    xmlNode('p:spPr', [
      xmlNode('a:xfrm', [
        xmlNode('a:off', [], { x: String(Math.round(minX * emu)), y: String(Math.round(minY * emu)) }),
        xmlNode('a:ext', [], {
          cx: String(Math.max(1, Math.round(width * emu))),
          cy: String(Math.max(1, Math.round(height * emu))),
        }),
      ], transformAttributes),
      geometry,
      xmlNode('a:ln', lineChildren, { w: String(Math.max(1, Math.round(element.width / scale * 12_700))) }),
    ]),
  ])
}

const assembleGeneratedDrawing = (
  element: PPTElement,
  donorNodes: OrderedXmlNode[],
  scale: number,
): OrderedXmlNode | undefined => {
  if (element.type === 'group') {
    const children = element.elements.flatMap(child => {
      const node = assembleGeneratedDrawing(child, donorNodes, scale)
      return node ? [node] : []
    })
    return children.length === element.elements.length
      ? generatedGroupNode(element, children, scale)
      : undefined
  }
  if (element.type === 'line') return generatedConnectorNode(element, scale)
  const location = generatedDrawingByMarker(donorNodes, generatedElementMarker(element.id))
  if (!location) return undefined
  const clone = structuredClone(location.node)
  if (element.type === 'latex') {
    const pictureProperties = findNode(ownChildren(clone), 'spPr')
    const pictureFill = findNode(ownChildren(clone), 'blipFill')
    if (!pictureProperties || !pictureFill) return undefined
    const choiceProperties = structuredClone(pictureProperties)
    removeDirectNodes(ownChildren(choiceProperties), new Set([
      'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
    ]))
    ownChildren(choiceProperties).splice(1, 0, xmlNode('a:noFill'))
    const fallbackProperties = structuredClone(pictureProperties)
    removeDirectNodes(ownChildren(fallbackProperties), new Set([
      'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
    ]))
    ownChildren(fallbackProperties).splice(1, 0, xmlNode(
      'a:blipFill',
      structuredClone(ownChildren(pictureFill)),
      { ...nodeAttributes(pictureFill) },
    ))
    const nonVisual = findNode(ownChildren(clone), 'cNvPr')
    const name = element.name || `Mona equation ${element.id}`
    const ommlNodes = parseXml(latexToOmml(element.latex), `equation:${element.id}`)
    const equation = findNode(ommlNodes, 'oMath')
    if (!equation) return undefined
    const shapeNonVisual = (): OrderedXmlNode => xmlNode('p:nvSpPr', [
      xmlNode('p:cNvPr', [], {
        id: nodeAttributes(nonVisual ?? xmlNode('p:cNvPr')).id ?? '0',
        name,
      }),
      xmlNode('p:cNvSpPr', [], { txBox: '1' }),
      xmlNode('p:nvPr'),
    ])
    const choice = xmlNode('p:sp', [
      shapeNonVisual(),
      choiceProperties,
      xmlNode('p:txBody', [
        xmlNode('a:bodyPr'),
        xmlNode('a:lstStyle'),
        xmlNode('a:p', [
          xmlNode('a14:m', [structuredClone(equation)]),
          xmlNode('a:endParaRPr', [], { lang: 'en-US' }),
        ]),
      ]),
    ])
    const fallback = xmlNode('p:sp', [
      shapeNonVisual(),
      fallbackProperties,
    ])
    return xmlNode('mc:AlternateContent', [
      xmlNode('mc:Choice', [choice], { Requires: 'a14' }),
      xmlNode('mc:Fallback', [fallback]),
    ])
  }
  if (element.type === 'shape' && element.text) {
    const textLocation = generatedDrawingByMarker(
      donorNodes,
      generatedElementMarker(element.id, 'text'),
    )
    if (textLocation) replaceShapeTextBody(clone, textLocation.node)
  }
  if (element.type === 'shape') {
    const properties = findNode(ownChildren(clone), 'spPr')
    if (properties) {
      const propertyChildren = ownChildren(properties)
      let authoredFill: OrderedXmlNode | undefined
      if (element.pattern) {
        const fillLocation = generatedDrawingByMarker(
          donorNodes,
          generatedElementMarker(element.id, 'fill'),
        )
        const donorFill = fillLocation
          ? findNode(ownChildren(fillLocation.node), 'blipFill')
          : undefined
        if (donorFill) {
          const fillChildren = structuredClone(ownChildren(donorFill))
          removeDirectNodes(fillChildren, new Set(['stretch', 'tile']))
          if (element.patternFit?.mode === 'tile') {
            fillChildren.push(xmlNode('a:tile', [], {
              ...(element.patternFit.alignment ? { algn: element.patternFit.alignment } : {}),
              ...(element.patternFit.scaleX !== undefined
                ? { sx: String(Math.round(element.patternFit.scaleX * 100_000)) }
                : {}),
              ...(element.patternFit.scaleY !== undefined
                ? { sy: String(Math.round(element.patternFit.scaleY * 100_000)) }
                : {}),
            }))
          }
          else {
            const rect = element.patternFit?.rect
            fillChildren.push(xmlNode('a:stretch', [xmlNode('a:fillRect', [], {
              ...(rect?.b !== undefined ? { b: String(Math.round(rect.b * 100_000)) } : {}),
              ...(rect?.l !== undefined ? { l: String(Math.round(rect.l * 100_000)) } : {}),
              ...(rect?.r !== undefined ? { r: String(Math.round(rect.r * 100_000)) } : {}),
              ...(rect?.t !== undefined ? { t: String(Math.round(rect.t * 100_000)) } : {}),
            })]))
          }
          authoredFill = xmlNode('a:blipFill', fillChildren, { ...nodeAttributes(donorFill) })
        }
      }
      else if (element.gradient) {
        authoredFill = backgroundFillNode({ gradient: element.gradient, type: 'gradient' })
      }
      else if (element.powerPointPattern) {
        authoredFill = backgroundFillNode({ pattern: element.powerPointPattern, type: 'pattern' })
      }
      if (authoredFill) {
        const firstFill = propertyChildren.findIndex(node => (
          ['blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill']
            .includes(localName(nodeTag(node) ?? ''))
        ))
        removeDirectNodes(propertyChildren, new Set([
          'blipFill', 'gradFill', 'grpFill', 'noFill', 'pattFill', 'solidFill',
        ]))
        propertyChildren.splice(firstFill < 0 ? 1 : firstFill, 0, authoredFill)
      }
    }
  }
  if (element.type === 'image') {
    patchImage(ownChildren(clone), {
      after: {
        ...(element.clip ? { clip: structuredClone(element.clip) } : {}),
        ...(element.filters ? { filters: structuredClone(element.filters) } : {}),
        ...(element.opacity !== undefined ? { opacity: element.opacity } : {}),
        ...(element.outline ? { outline: structuredClone(element.outline) } : {}),
        ...(element.shadow ? { shadow: structuredClone(element.shadow) } : {}),
        src: element.src,
      },
      before: { src: element.src },
      elementId: element.id,
      kind: 'image',
      objectId: element.id,
      partPath: 'ppt/slides/slide1.xml',
      scale,
      slideId: 'generated-object',
    })
  }
  if (element.type === 'audio') {
    const mediaFile = findNode(ownChildren(clone), 'videoFile')
    if (mediaFile) replaceNodeTag(mediaFile, 'a:audioFile')
  }
  const nonVisual = findNode(ownChildren(clone), 'cNvPr')
  if (nonVisual) {
    const attributes = nodeAttributes(nonVisual)
    attributes.name = element.name || attributes.name || `Mona ${element.type}`
    if (element.name) attributes.title = attributes.title || generatedElementMarker(element.id)
  }
  return clone
}

const copyGeneratedRelationships = async ({
  clone,
  donorZip,
  targetPart,
  targetZip,
}: {
  clone: OrderedXmlNode
  donorZip: JSZip
  targetPart: string
  targetZip: JSZip
}): Promise<PowerPointWritebackIssue[]> => {
  const donorPart = 'ppt/slides/slide1.xml'
  const donorRelationshipPath = relationshipPartPath(donorPart)
  const referenced = relationshipIdsInTree([clone])
  if (!referenced.size) return []
  const donorEntry = donorZip.file(donorRelationshipPath)
  if (!donorEntry) {
    return [{
      code: 'pptx.writeback.generated-relationships-missing',
      message: 'The generated object references relationships that are absent from its donor package.',
      partPath: donorRelationshipPath,
    }]
  }
  const donor = relationshipDocument(await donorEntry.async('text'), donorPart)
  const targetPath = relationshipPartPath(targetPart)
  const targetEntry = targetZip.file(targetPath)
  const target = relationshipDocument(
    targetEntry ? await targetEntry.async('text') : undefined,
    targetPart,
  )
  const replacements = new Map<string, string>()
  const partMap = new Map<string, string>()
  const issues: PowerPointWritebackIssue[] = []
  for (const donorId of referenced) {
    const relationship = donor.byId.get(donorId)
    if (!relationship) {
      issues.push({
        code: 'pptx.writeback.generated-relationship-missing',
        message: `The generated object references missing donor relationship ${donorId}.`,
        partPath: donorRelationshipPath,
      })
      continue
    }
    const attributes = nodeAttributes(relationship)
    if (!attributes.Target) continue
    const actionValue = attributes.Target.startsWith('pptx-action:')
      ? attributes.Target.slice('pptx-action:'.length)
      : undefined
    if (actionValue) {
      const aliases: Record<string, string> = {
        end: 'ppaction://hlinkshowjump?jump=endshow',
        first: 'ppaction://hlinkshowjump?jump=firstslide',
        last: 'ppaction://hlinkshowjump?jump=lastslide',
        next: 'ppaction://hlinkshowjump?jump=nextslide',
        previous: 'ppaction://hlinkshowjump?jump=previousslide',
      }
      rewriteHyperlinkReference([clone], donorId, aliases[actionValue] ?? actionValue, false)
      continue
    }
    const targetId = nextRelationshipId(target)
    const copiedAttributes: Record<string, string> = { ...attributes, Id: targetId }
    const internalSlide = attributes.Target.startsWith('pptx-slide:')
      ? attributes.Target.slice('pptx-slide:'.length)
      : undefined
    if (internalSlide) {
      copiedAttributes.Target = relativeRelationshipTarget(targetPart, internalSlide)
      copiedAttributes.Type = SLIDE_RELATIONSHIP
      delete copiedAttributes.TargetMode
      rewriteHyperlinkReference([clone], donorId, 'ppaction://hlinksldjump', true)
    }
    else if (attributes.TargetMode !== 'External') {
      const dependency = internalRelationshipTarget(donorPart, attributes.Target)
      const copied = await copyDonorPart(targetZip, donorZip, dependency, partMap)
      issues.push(...copied.issues)
      if (copied.targetPart) {
        copiedAttributes.Target = relativeRelationshipTarget(targetPart, copied.targetPart)
      }
    }
    const copiedRelationship = xmlNode('Relationship', [], copiedAttributes)
    target.children.push(copiedRelationship)
    target.byId.set(targetId, copiedRelationship)
    replacements.set(donorId, targetId)
  }
  if (issues.length) return issues
  replaceRelationshipIds([clone], replacements)
  const targetXml = serializeRelationshipDocument(target)
  const validation = XMLValidator.validate(targetXml, { allowBooleanAttributes: false })
  if (validation !== true) {
    return [{
      code: 'pptx.writeback.invalid-generated-target-relationships',
      message: `Generated object relationships are invalid: ${validation.err.msg}`,
      partPath: targetPath,
    }]
  }
  targetZip.file(targetPath, targetXml)
  return []
}

const generatedBackgroundFill = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  operation: PowerPointBackgroundPatch,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<{ fill?: OrderedXmlNode; issues: PowerPointWritebackIssue[] }> => {
  const image = operation.after?.image
  if (operation.after?.type !== 'image' || !image?.src) return { issues: [] }
  const scale = manifest.coordinateScale ?? 96 / 72
  const documentProperties = manifest['document']?.properties
  const width = documentProperties?.slideWidthEmu
    ? documentProperties.slideWidthEmu / 12_700 * scale
    : 960
  const height = documentProperties?.slideHeightEmu
    ? documentProperties.slideHeightEmu / 12_700 * scale
    : 540
  const element: Extract<PPTElement, { type: 'image' }> = {
    fixedRatio: false,
    height,
    id: `background:${operation.partPath}`,
    left: 0,
    rotate: 0,
    src: image.src,
    top: 0,
    type: 'image',
    width,
  }
  let donorBytes: ArrayBuffer
  try {
    donorBytes = await generateElementDonorPackage({ element, manifest, resolveAsset })
  }
  catch (error) {
    return { issues: [{
      code: 'pptx.writeback.background-asset',
      message: error instanceof Error ? error.message : 'The background image could not be serialized.',
      partPath: operation.partPath,
      slideId: operation.slideId,
    }] }
  }
  const donorZip = await JSZip.loadAsync(donorBytes)
  const donorSlide = donorZip.file('ppt/slides/slide1.xml')
  if (!donorSlide) {
    return { issues: [{
      code: 'pptx.writeback.background-donor',
      message: 'The generated background donor package has no slide payload.',
      partPath: operation.partPath,
      slideId: operation.slideId,
    }] }
  }
  const donorNodes = parseXml(await donorSlide.async('text'), 'ppt/slides/slide1.xml')
  const picture = generatedDrawingByMarker(donorNodes, generatedElementMarker(element.id))
  const blipFill = picture ? findNode(ownChildren(picture.node), 'blipFill') : undefined
  if (!blipFill) {
    return { issues: [{
      code: 'pptx.writeback.background-fill',
      message: 'The generated background donor has no image fill.',
      partPath: operation.partPath,
      slideId: operation.slideId,
    }] }
  }
  const fill = xmlNode(
    'a:blipFill',
    structuredClone(ownChildren(blipFill)),
    { ...nodeAttributes(blipFill) },
  )
  const issues = await copyGeneratedRelationships({
    clone: fill,
    donorZip,
    targetPart: operation.partPath,
    targetZip: zip,
  })
  return { fill, issues }
}

const insertDrawingNodeAt = (
  targetNodes: OrderedXmlNode[],
  clone: OrderedXmlNode,
  index: number,
  parent?: DrawingNodeLocation,
): boolean => {
  const siblings = parent ? parent.children : shapeTreeChildren(targetNodes)
  if (!siblings) return false
  const drawings = siblings.flatMap((node, siblingIndex) => (
    drawingObjectTags.has(localName(nodeTag(node) ?? '')) ? [siblingIndex] : []
  ))
  const extensionIndex = siblings.findIndex(node => localName(nodeTag(node) ?? '') === 'extLst')
  const targetIndex = drawings[Math.max(0, Math.min(index, drawings.length - 1))]
    ?? (extensionIndex < 0 ? siblings.length : extensionIndex)
  siblings.splice(targetIndex, 0, clone)
  return true
}

const patchGeneratedElement = async (
  zip: JSZip,
  manifest: PowerPointPackageManifest,
  operation: PowerPointElementInsertPatch | PowerPointElementReplacePatch,
  resolveAsset: PowerPointAssetResolver | undefined,
): Promise<PowerPointWritebackIssue[]> => {
  const targetEntry = zip.file(operation.targetPart)
  if (!targetEntry) {
    return [{
      code: 'pptx.writeback.generated-target-missing',
      elementId: operation.elementId,
      message: 'The target PowerPoint shape-tree part is missing.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  let donorBytes: ArrayBuffer
  try {
    donorBytes = await generateElementDonorPackage({
      element: operation.after,
      manifest,
      resolveAsset,
    })
  }
  catch (error) {
    return [{
      code: 'pptx.writeback.generated-object',
      elementId: operation.elementId,
      message: error instanceof Error ? error.message : 'The generated object could not be serialized.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const donorZip = await JSZip.loadAsync(donorBytes)
  const donorSlide = donorZip.file('ppt/slides/slide1.xml')
  if (!donorSlide) {
    return [{
      code: 'pptx.writeback.generated-slide-missing',
      elementId: operation.elementId,
      message: 'The generated object donor package has no slide payload.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const donorNodes = parseXml(await donorSlide.async('text'), 'ppt/slides/slide1.xml')
  let clone: OrderedXmlNode | undefined
  try {
    clone = assembleGeneratedDrawing(
      operation.after,
      donorNodes,
      manifest.coordinateScale ?? 96 / 72,
    )
  }
  catch (error) {
    return [{
      code: 'pptx.writeback.generated-object-conversion',
      elementId: operation.elementId,
      message: error instanceof Error ? error.message : 'The generated object could not be converted to native PowerPoint markup.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  if (!clone) {
    return [{
      code: 'pptx.writeback.generated-object-missing',
      elementId: operation.elementId,
      message: 'The generated object donor package did not contain the requested semantic payload.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  if (operation.after.effects || operation.after.threeD) {
    const cloneChildren = ownChildren(clone)
    const properties = directNode(cloneChildren, 'spPr')
      ?? directNode(cloneChildren, 'grpSpPr')
      ?? findNode(cloneChildren, 'spPr')
      ?? findNode(cloneChildren, 'grpSpPr')
    if (!properties) {
      return [{
        code: 'pptx.writeback.generated-effect-structure',
        elementId: operation.elementId,
        message: 'The generated object has no native visual-properties container for its advanced effects.',
        partPath: operation.targetPart,
        slideId: operation.slideId,
      }]
    }
    const scale = manifest.coordinateScale ?? 96 / 72
    if (operation.after.effects) {
      const effectIssues = patchEffectList(
        properties,
        operation.after.effects,
        scale,
      )
      if (effectIssues.length) return effectIssues.map(issue => ({
        ...issue,
        elementId: operation.elementId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      }))
    }
    if (operation.after.threeD) patchThreeDProperties(properties, operation.after.threeD, scale)
  }
  const relationshipIssues = await copyGeneratedRelationships({
    clone,
    donorZip,
    targetPart: operation.targetPart,
    targetZip: zip,
  })
  if (relationshipIssues.length) return relationshipIssues.map(issue => ({
    ...issue,
    elementId: operation.elementId,
    slideId: operation.slideId,
  }))
  const targetNodes = parseXml(await targetEntry.async('text'), operation.targetPart)
  if (operation.after.type === 'latex') {
    const root = findNode(targetNodes, 'sld')
    if (!root) {
      return [{
        code: 'pptx.writeback.equation-slide-root',
        elementId: operation.elementId,
        message: 'The target slide has no root on which native equation namespaces can be declared.',
        partPath: operation.targetPart,
        slideId: operation.slideId,
      }]
    }
    const attributes = nodeAttributes(root)
    attributes['xmlns:a14'] = attributes['xmlns:a14']
      ?? 'http://schemas.microsoft.com/office/drawing/2010/main'
    attributes['xmlns:mc'] = attributes['xmlns:mc']
      ?? 'http://schemas.openxmlformats.org/markup-compatibility/2006'
    const ignorable = new Set((attributes['mc:Ignorable'] ?? '').split(/\s+/).filter(Boolean))
    ignorable.add('a14')
    attributes['mc:Ignorable'] = [...ignorable].join(' ')
  }
  if (operation.kind === 'replace-element') {
    const existing = findDrawingNode(
      targetNodes,
      manifest.packageId,
      operation.targetPart,
      operation.objectId,
    )
    if (!existing) {
      return [{
        code: 'pptx.writeback.generated-replacement-missing',
        elementId: operation.elementId,
        message: 'The native object selected for media replacement no longer exists.',
        objectId: operation.objectId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      }]
    }
    allocateDrawingIds(clone, targetNodes)
    existing.siblings.splice(existing.index, 1, clone)
    const output = xmlBuilder.build(targetNodes) as string
    const validation = XMLValidator.validate(output, { allowBooleanAttributes: false })
    if (validation !== true) {
      return [{
        code: 'pptx.writeback.invalid-generated-replacement',
        elementId: operation.elementId,
        message: `Generated object replacement produced invalid XML: ${validation.err.msg}`,
        objectId: operation.objectId,
        partPath: operation.targetPart,
        slideId: operation.slideId,
      }]
    }
    zip.file(operation.targetPart, output)
    return []
  }
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
      code: 'pptx.writeback.generated-parent-missing',
      elementId: operation.elementId,
      message: 'The native parent group for the generated object no longer exists.',
      objectId: operation.parentObjectId,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  allocateDrawingIds(clone, targetNodes)
  if (!insertDrawingNodeAt(targetNodes, clone, operation.index, parent)) {
    return [{
      code: 'pptx.writeback.generated-shape-tree-missing',
      elementId: operation.elementId,
      message: 'The target part has no shape tree for the generated object.',
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  const output = xmlBuilder.build(targetNodes) as string
  const validation = XMLValidator.validate(output, { allowBooleanAttributes: false })
  if (validation !== true) {
    return [{
      code: 'pptx.writeback.invalid-generated-object',
      elementId: operation.elementId,
      message: `Generated object insertion produced invalid XML: ${validation.err.msg}`,
      partPath: operation.targetPart,
      slideId: operation.slideId,
    }]
  }
  zip.file(operation.targetPart, output)
  return []
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
  resolveAsset?: PowerPointAssetResolver,
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
      const parentObjectId = entry.parent?.source?.copyOnWrite?.sourceObjectId
        ?? entry.parent?.source?.sourceObjectId
      issues.push(...await patchGeneratedElement(zip, manifest, {
        after: entry.element,
        elementId: entry.element.id,
        index: entry.parent?.type === 'group'
          ? entry.parent.elements.indexOf(entry.element)
          : operation.after.elements.indexOf(entry.element),
        kind: 'insert-element',
        ...(parentObjectId ? {
          parentObjectId: rebaseObjectId(
            parentObjectId,
            manifest.packageId,
            operation.sourcePart,
            targetPart,
          ),
        } : {}),
        slideId: operation.slideId,
        targetPart,
      }, resolveAsset))
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
      slidePart: targetPart,
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
    const backgroundOperation: PowerPointBackgroundPatch = {
      ...(operation.after.background ? { after: structuredClone(operation.after.background) } : {}),
      ...(operation.before.background ? { before: structuredClone(operation.before.background) } : {}),
      kind: 'background',
      partPath: targetPart,
      slideId: operation.slideId,
    }
    const generated = await generatedBackgroundFill(
      zip,
      manifest,
      backgroundOperation,
      resolveAsset,
    )
    issues.push(...generated.issues)
    const targetEntry = zip.file(targetPart)
    if (!targetEntry) throw new Error(`Copied slide part disappeared: ${targetPart}`)
    const patched = patchBackgroundPart(
      await targetEntry.async('text'),
      backgroundOperation,
      generated.fill,
    )
    issues.push(...patched.issues)
    if (!generated.issues.length && !patched.issues.length) zip.file(targetPart, patched.xml)
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
            else if (operation.kind === 'effects') {
              issues.push(...patchAdvancedEffects(children, operation))
            }
            else if (operation.kind === 'three-d') {
              issues.push(...patchThreeD(children, operation))
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
  resolveAsset,
}: {
  bytes: ArrayBuffer
  manifest: PowerPointPackageManifest
  operations: readonly PowerPointPatchOperation[]
  resolveAsset?: PowerPointAssetResolver
}): Promise<ArrayBuffer> => {
  if (!operations.length) return bytes.slice(0)
  const knownObjects = new Set(manifest.objects.map(object => object.stableId))
  const objectOperations = operations.filter(
    (operation): operation is PowerPointObjectPatchOperation => (
      operation.kind !== 'background'
      && operation.kind !== 'comments'
      && operation.kind !== 'inherited-visibility'
      && operation.kind !== 'insert-element'
      && operation.kind !== 'insert-object'
      && operation.kind !== 'insert-slide'
      && operation.kind !== 'notes'
      && operation.kind !== 'replace-element'
      && operation.kind !== 'theme'
      && operation.kind !== 'timing'
      && operation.kind !== 'transition'
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
    const inserted = await insertNativeSlide(zip, manifest, operation, resolveAsset)
    issues.push(...inserted.issues)
  }
  if (issues.length) throw new PowerPointWritebackError(issues)
  for (const operation of operations) {
    if (operation.kind === 'insert-element' || operation.kind === 'replace-element') {
      issues.push(...await patchGeneratedElement(zip, manifest, operation, resolveAsset))
    }
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
      const generated = await generatedBackgroundFill(zip, manifest, operation, resolveAsset)
      issues.push(...generated.issues)
      if (generated.issues.length) continue
      const patched = patchBackgroundPart(await entry.async('text'), operation, generated.fill)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.partPath, patched.xml)
    }
    if (operation.kind === 'comments') {
      issues.push(...await patchCommentsStructure(zip, operation))
    }
    if (operation.kind === 'notes') {
      const entry = zip.file(operation.notesPart)
      if (!entry) {
        issues.push(...await createNotesPart(zip, manifest, operation))
        continue
      }
      const patched = patchNotesPart(await entry.async('text'), operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.notesPart, patched.xml)
    }
    if (operation.kind === 'theme') {
      const entry = zip.file(operation.partPath)
      if (!entry) {
        issues.push({
          code: 'pptx.writeback.theme-part-missing',
          message: 'The retained native theme part is missing.',
          partPath: operation.partPath,
        })
        continue
      }
      const patched = patchThemePart(await entry.async('text'), operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.partPath, patched.xml)
    }
    if (operation.kind === 'timing' || operation.kind === 'transition') {
      const entry = zip.file(operation.partPath)
      if (!entry) {
        issues.push({
          code: operation.kind === 'timing'
            ? 'pptx.writeback.timing-part-missing'
            : 'pptx.writeback.transition-part-missing',
          message: 'The retained native slide part is missing.',
          partPath: operation.partPath,
          slideId: operation.slideId,
        })
        continue
      }
      const xml = await entry.async('text')
      const patched = operation.kind === 'timing'
        ? patchTimingPart(xml, operation)
        : patchTransitionPart(xml, operation)
      issues.push(...patched.issues)
      if (!patched.issues.length) zip.file(operation.partPath, patched.xml)
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
