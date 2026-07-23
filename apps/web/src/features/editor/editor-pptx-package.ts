import JSZip from 'jszip'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

import type {
  PowerPointPackageManifest,
  PowerPointPackageIssue,
  PowerPointPackagePart,
  PowerPointPackagePartKind,
  PowerPointPackageReference,
  PowerPointRelationship,
  PowerPointHierarchy,
  PowerPointSlideLayout,
  PowerPointSlideMaster,
  PowerPointSourceObjectIdentity,
  PowerPointSourceObjectKind,
  PowerPointSlideDependency,
  PowerPointTheme,
  PowerPointThemeColor,
} from '@mona/presentation-core'

import type { PowerPointPackageBacking } from '@/features/editor/editor-pptx-backing-store'

const MAX_PACKAGE_BYTES = 512 * 1024 * 1024
const MAX_PACKAGE_PARTS = 20_000
const MAX_PACKAGE_COMPRESSION_RATIO = 200
const MAX_PART_BYTES = 256 * 1024 * 1024
const MAX_UNCOMPRESSED_PACKAGE_BYTES = 1024 * 1024 * 1024
const MAX_XML_PART_BYTES = 32 * 1024 * 1024
const MAX_XML_DEPTH = 256

type OrderedXmlNode = Record<string, unknown>

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: true,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: false,
  removeNSPrefix: false,
  trimValues: false,
})

const parseXml = (xml: string, path: string): OrderedXmlNode[] => {
  if (/<!DOCTYPE\b/i.test(xml)) throw new Error(`PowerPoint XML part contains a prohibited DOCTYPE: ${path}`)
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false })
  if (validation !== true) {
    throw new Error(`Invalid PowerPoint XML part: ${path} (${validation.err.msg})`)
  }
  const parsed: unknown = xmlParser.parse(xml)
  if (!Array.isArray(parsed)) throw new Error(`Invalid PowerPoint XML tree: ${path}`)
  const nodes = parsed as OrderedXmlNode[]
  const pending: Array<{ depth: number; nodes: OrderedXmlNode[] }> = [{ depth: 0, nodes }]
  while (pending.length) {
    const current = pending.pop()!
    if (current.depth > MAX_XML_DEPTH) throw new Error(`PowerPoint XML part exceeds the nesting limit: ${path}`)
    for (const node of current.nodes) {
      for (const [, children] of nodeEntries(node)) {
        pending.push({ depth: current.depth + 1, nodes: children })
      }
    }
  }
  return nodes
}

const nodeAttributes = (node: OrderedXmlNode): Record<string, string> => {
  const value = node[':@']
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, string>
}

const nodeEntries = (node: OrderedXmlNode): Array<[string, OrderedXmlNode[]]> => (
  Object.entries(node).flatMap(([tag, value]) => (
    tag === ':@' || !Array.isArray(value) ? [] : [[tag, value as OrderedXmlNode[]]]
  ))
)

const localName = (name: string): string => name.slice(name.lastIndexOf(':') + 1)

const walkXml = (
  nodes: OrderedXmlNode[],
  visit: (tag: string, node: OrderedXmlNode, children: OrderedXmlNode[]) => void,
): void => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      visit(localName(tag), node, children)
      walkXml(children, visit)
    }
  }
}

const classifyPart = (path: string): PowerPointPackagePartKind => {
  if (path.endsWith('.rels')) return 'relationships'
  if (path === 'ppt/presentation.xml') return 'presentation'
  if (/^ppt\/slides\/slide\d+\.xml$/i.test(path)) return 'slide'
  if (/^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(path)) return 'layout'
  if (/^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(path)) return 'master'
  if (/^ppt\/theme\/theme\d+\.xml$/i.test(path)) return 'theme'
  if (/^ppt\/notes(?:Masters|Slides)\//i.test(path)) return 'notes'
  if (/^ppt\/comments?\//i.test(path)) return 'comments'
  if (/^ppt\/charts?\//i.test(path)) return 'chart'
  if (/^ppt\/diagrams?\//i.test(path)) return 'diagram'
  if (/^ppt\/media\//i.test(path)) return 'media'
  if (/^ppt\/embeddings?\//i.test(path)) return 'embedded'
  if (/^(?:docProps|ppt\/presProps|ppt\/viewProps|ppt\/tableStyles)/i.test(path)) return 'metadata'
  if (/(?:^|\/)customXml\/|^ppt\/tags\//i.test(path)) return 'custom'
  return 'unknown'
}

const normalizePackagePath = (path: string): string => {
  const segments: string[] = []
  for (const segment of path.replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

const relationshipSourcePart = (relationshipPart: string): string => {
  if (relationshipPart === '_rels/.rels') return ''
  const match = /^(.*\/)?_rels\/([^/]+)\.rels$/i.exec(relationshipPart)
  return match ? `${match[1] ?? ''}${match[2]}` : ''
}

const relationshipTarget = (sourcePart: string, target: string, external: boolean): string => {
  if (external) return target
  const sourceDirectory = sourcePart.includes('/') ? sourcePart.slice(0, sourcePart.lastIndexOf('/') + 1) : ''
  return normalizePackagePath(target.startsWith('/') ? target : `${sourceDirectory}${target}`)
}

const relationshipKind = (relationship: PowerPointRelationship): string => (
  relationship.type.slice(relationship.type.lastIndexOf('/') + 1)
)

const numericPartSort = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { numeric: true })
)

const digestId = async (source: ArrayBuffer): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source)
  const hex = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  return `pptx:${hex}`
}

const parseContentTypes = (xml: string) => {
  const defaults = new Map<string, string>()
  const overrides = new Map<string, string>()
  walkXml(parseXml(xml, '[Content_Types].xml'), (tag, node) => {
    const values = nodeAttributes(node)
    if (tag === 'Default' && values.Extension && values.ContentType) {
      defaults.set(values.Extension.toLowerCase(), values.ContentType)
    }
    if (tag === 'Override' && values.PartName && values.ContentType) {
      overrides.set(normalizePackagePath(values.PartName), values.ContentType)
    }
  })
  return { defaults, overrides }
}

const contentTypeFor = (
  path: string,
  contentTypes: ReturnType<typeof parseContentTypes>,
): string | undefined => {
  const override = contentTypes.overrides.get(path)
  if (override) return override
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  return contentTypes.defaults.get(extension)
}

const parseRelationships = async (zip: JSZip, relationshipPaths: string[]): Promise<PowerPointRelationship[]> => {
  const groups = await Promise.all(relationshipPaths.map(async path => {
    const xml = await zip.file(path)!.async('text')
    const sourcePart = relationshipSourcePart(path)
    const relationships: PowerPointRelationship[] = []
    walkXml(parseXml(xml, path), (tag, node) => {
      if (tag !== 'Relationship') return
      const values = nodeAttributes(node)
      if (!values.Id || !values.Type || !values.Target) return
      const external = values.TargetMode?.toLowerCase() === 'external'
      relationships.push({
        external,
        id: values.Id,
        sourcePart,
        target: relationshipTarget(sourcePart, values.Target, external),
        type: values.Type,
      })
    })
    return relationships
  }))
  return groups.flat().sort((left, right) => (
    left.sourcePart.localeCompare(right.sourcePart, undefined, { numeric: true })
    || left.id.localeCompare(right.id, undefined, { numeric: true })
  ))
}

const findInternalTarget = (
  relationships: PowerPointRelationship[],
  sourcePart: string | undefined,
  kind: string,
): string | undefined => {
  if (!sourcePart) return undefined
  return relationships.find(relationship => (
    !relationship.external
    && relationship.sourcePart === sourcePart
    && relationshipKind(relationship) === kind
  ))?.target
}

const parseSlideOrder = (
  presentationXml: string,
  relationships: PowerPointRelationship[],
  fallbackSlideParts: string[],
): Array<{ presentationSlideId?: string; relationshipId?: string; slidePart: string }> => {
  const presentationRelationships = relationships.filter(relationship => (
    relationship.sourcePart === 'ppt/presentation.xml'
    && !relationship.external
    && relationshipKind(relationship) === 'slide'
  ))
  const targetById = new Map(presentationRelationships.map(relationship => [relationship.id, relationship.target]))
  const ordered: Array<{ presentationSlideId?: string; relationshipId?: string; slidePart: string }> = []
  walkXml(parseXml(presentationXml, 'ppt/presentation.xml'), (tag, node) => {
    if (tag !== 'sldId') return
    const values = nodeAttributes(node)
    const relationshipId = values['r:id']
    const slidePart = relationshipId ? targetById.get(relationshipId) : undefined
    if (slidePart) {
      ordered.push({
        presentationSlideId: values.id,
        relationshipId,
        slidePart,
      })
    }
  })
  return ordered.length ? ordered : fallbackSlideParts.map(slidePart => ({ slidePart }))
}

const sourceObjectKinds: Partial<Record<string, PowerPointSourceObjectKind>> = {
  contentPart: 'content',
  cxnSp: 'connector',
  graphicFrame: 'graphic-frame',
  grpSp: 'group',
  pic: 'picture',
  sp: 'shape',
}

const findFirstNode = (
  nodes: OrderedXmlNode[],
  expectedTag: string,
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag, children] of nodeEntries(node)) {
      if (localName(tag) === expectedTag) return node
      const nested = findFirstNode(children, expectedTag)
      if (nested) return nested
    }
  }
  return undefined
}

const findDirectNode = (
  nodes: OrderedXmlNode[],
  expectedTags: readonly string[],
): OrderedXmlNode | undefined => {
  for (const node of nodes) {
    for (const [tag] of nodeEntries(node)) {
      if (expectedTags.includes(localName(tag))) return node
    }
  }
  return undefined
}

const findFirstAttributes = (
  nodes: OrderedXmlNode[],
  expectedTag: string,
): Record<string, string> => {
  const node = findFirstNode(nodes, expectedTag)
  return node ? nodeAttributes(node) : {}
}

const collectSourceObjects = (
  xml: string,
  partPath: string,
  packageId: string,
): PowerPointSourceObjectIdentity[] => {
  const objects: PowerPointSourceObjectIdentity[] = []
  const nativeOccurrences = new Map<string, number>()
  let sourceIndex = 0
  const visit = (nodes: OrderedXmlNode[], parentStableId?: string) => {
    for (const node of nodes) {
      for (const [tag, children] of nodeEntries(node)) {
        const kind = sourceObjectKinds[localName(tag)]
        if (!kind) {
          visit(children, parentStableId)
          continue
        }
        const nonVisualContainer = findDirectNode(children, [
          'nvSpPr',
          'nvPicPr',
          'nvGrpSpPr',
          'nvGraphicFramePr',
          'nvCxnSpPr',
          'nvContentPartPr',
        ])
        const nonVisualChildren = nonVisualContainer
          ? nodeEntries(nonVisualContainer).flatMap(([, nested]) => nested)
          : []
        const nonVisual = findFirstNode(nonVisualChildren, 'cNvPr')
        const values = nonVisual ? nodeAttributes(nonVisual) : {}
        const nativeId = values.id
        if (!nativeId) {
          visit(children, parentStableId)
          continue
        }
        const occurrence = nativeOccurrences.get(nativeId) ?? 0
        nativeOccurrences.set(nativeId, occurrence + 1)
        const stableId = `${packageId}/${partPath}#${nativeId}${occurrence ? `:${occurrence}` : ''}`
        const creationNode = nonVisual
          ? findFirstNode(nodeEntries(nonVisual).flatMap(([, nested]) => nested), 'creationId')
          : undefined
        const creationId = creationNode ? nodeAttributes(creationNode).id : undefined
        const placeholder = findFirstNode(nonVisualChildren, 'ph')
        const placeholderValues = placeholder ? nodeAttributes(placeholder) : {}
        objects.push({
          ...(creationId ? { creationId } : {}),
          ...(values.descr ? { description: values.descr } : {}),
          kind,
          ...(values.name ? { name: values.name } : {}),
          nativeId,
          ...(parentStableId ? { parentStableId } : {}),
          partPath,
          ...(placeholderValues.idx ? { placeholderIndex: placeholderValues.idx } : {}),
          ...(placeholderValues.type ? { placeholderType: placeholderValues.type } : {}),
          sourceIndex,
          stableId,
          ...(values.title ? { title: values.title } : {}),
        })
        sourceIndex += 1
        visit(children, stableId)
      }
    }
  }
  visit(parseXml(xml, partPath))
  return objects
}

const stablePartId = (packageId: string, partPath: string): string => `${packageId}/${partPath}`

const parseTheme = (
  xml: string,
  partPath: string,
  packageId: string,
): PowerPointTheme => {
  const nodes = parseXml(xml, partPath)
  const root = findFirstAttributes(nodes, 'theme')
  const colorSchemeNode = findFirstNode(nodes, 'clrScheme')
  const colorSchemeChildren = colorSchemeNode
    ? nodeEntries(colorSchemeNode).flatMap(([, children]) => children)
    : []
  const colors: PowerPointThemeColor[] = []
  for (const colorNode of colorSchemeChildren) {
    for (const [tag, children] of nodeEntries(colorNode)) {
      const colorName = localName(tag)
      for (const [sourceTag, type] of [
        ['srgbClr', 'srgb'],
        ['sysClr', 'system'],
        ['schemeClr', 'scheme'],
        ['prstClr', 'preset'],
      ] as const) {
        const source = findFirstNode(children, sourceTag)
        if (!source) continue
        const values = nodeAttributes(source)
        const value = type === 'system' ? values.lastClr ?? values.val : values.val ?? values.lastClr
        if (value) colors.push({ name: colorName, type, value })
        break
      }
    }
  }
  const majorFontNode = findFirstNode(nodes, 'majorFont')
  const minorFontNode = findFirstNode(nodes, 'minorFont')
  return {
    colorSchemeName: findFirstAttributes(nodes, 'clrScheme').name,
    colors,
    id: stablePartId(packageId, partPath),
    majorLatinFont: majorFontNode
      ? findFirstAttributes(nodeEntries(majorFontNode).flatMap(([, children]) => children), 'latin').typeface
      : undefined,
    minorLatinFont: minorFontNode
      ? findFirstAttributes(nodeEntries(minorFontNode).flatMap(([, children]) => children), 'latin').typeface
      : undefined,
    name: root.name,
    packageId,
    partPath,
  }
}

const parseBooleanAttribute = (value: string | undefined, fallback: boolean): boolean => (
  value === undefined ? fallback : value !== '0' && value.toLowerCase() !== 'false'
)

const buildHierarchy = async ({
  objects,
  packageId,
  parts,
  readXmlPart,
  relationships,
}: {
  objects: PowerPointSourceObjectIdentity[]
  packageId: string
  parts: PowerPointPackagePart[]
  readXmlPart: (path: string) => Promise<string>
  relationships: PowerPointRelationship[]
}): Promise<PowerPointHierarchy> => {
  const themeParts = parts.filter(part => part.kind === 'theme')
  const themes = await Promise.all(themeParts.map(async part => (
    parseTheme(await readXmlPart(part.path), part.path, packageId)
  )))
  const layouts: PowerPointSlideLayout[] = await Promise.all(
    parts.filter(part => part.kind === 'layout').map(async part => {
      const root = findFirstAttributes(parseXml(await readXmlPart(part.path), part.path), 'sldLayout')
      const masterPart = findInternalTarget(relationships, part.path, 'slideMaster')
      return {
        id: stablePartId(packageId, part.path),
        matchingName: root.matchingName,
        masterId: masterPart ? stablePartId(packageId, masterPart) : undefined,
        name: root.name,
        objectIds: objects.filter(object => object.partPath === part.path).map(object => object.stableId),
        packageId,
        partPath: part.path,
        preserve: parseBooleanAttribute(root.preserve, false),
        showMasterPlaceholderAnimations: parseBooleanAttribute(root.showMasterPhAnim, true),
        showMasterShapes: parseBooleanAttribute(root.showMasterSp, true),
        type: root.type,
      }
    }),
  )
  const masters: PowerPointSlideMaster[] = await Promise.all(
    parts.filter(part => part.kind === 'master').map(async part => {
      const root = findFirstAttributes(parseXml(await readXmlPart(part.path), part.path), 'sldMaster')
      const themePart = findInternalTarget(relationships, part.path, 'theme')
      const layoutParts = relationships.filter(relationship => (
        !relationship.external
        && relationship.sourcePart === part.path
        && relationshipKind(relationship) === 'slideLayout'
      )).map(relationship => relationship.target)
      return {
        id: stablePartId(packageId, part.path),
        layoutIds: layoutParts.map(layoutPart => stablePartId(packageId, layoutPart)),
        objectIds: objects.filter(object => object.partPath === part.path).map(object => object.stableId),
        packageId,
        partPath: part.path,
        preserve: parseBooleanAttribute(root.preserve, false),
        themeId: themePart ? stablePartId(packageId, themePart) : undefined,
      }
    }),
  )
  const placeholders = objects.flatMap(object => (
    object.placeholderIndex === undefined && object.placeholderType === undefined
      ? []
      : [{
          ...(object.placeholderIndex !== undefined ? { index: object.placeholderIndex } : {}),
          objectId: object.stableId,
          partId: stablePartId(packageId, object.partPath),
          partPath: object.partPath,
          ...(object.placeholderType !== undefined ? { type: object.placeholderType } : {}),
        }]
  ))
  return { layouts, masters, placeholders, themes }
}

const buildSlideDependencies = async (
  presentationXml: string,
  relationships: PowerPointRelationship[],
  parts: PowerPointPackagePart[],
  readXmlPart: (path: string) => Promise<string>,
): Promise<PowerPointSlideDependency[]> => {
  const fallbackSlides = parts
    .filter(part => part.kind === 'slide')
    .map(part => part.path)
    .sort(numericPartSort)
  return Promise.all(parseSlideOrder(presentationXml, relationships, fallbackSlides).map(async slide => {
    const layoutPart = findInternalTarget(relationships, slide.slidePart, 'slideLayout')
    const masterPart = findInternalTarget(relationships, layoutPart, 'slideMaster')
    const themePart = findInternalTarget(relationships, masterPart, 'theme')
    const root = findFirstAttributes(parseXml(await readXmlPart(slide.slidePart), slide.slidePart), 'sld')
    return {
      ...slide,
      layoutPart,
      masterPart,
      showMasterPlaceholderAnimations: parseBooleanAttribute(root.showMasterPhAnim, true),
      showMasterShapes: parseBooleanAttribute(root.showMasterSp, true),
      themePart,
    }
  }))
}

const buildPackageIssues = (
  parts: PowerPointPackagePart[],
  relationships: PowerPointRelationship[],
  slides: PowerPointSlideDependency[],
): PowerPointPackageIssue[] => {
  const issues: PowerPointPackageIssue[] = []
  const partPaths = new Set(parts.map(part => part.path))
  const relationshipKeys = new Set<string>()
  for (const relationship of relationships) {
    const key = `${relationship.sourcePart}\0${relationship.id}`
    if (relationshipKeys.has(key)) {
      issues.push({
        code: 'pptx.relationship.duplicate-id',
        message: `Duplicate relationship ID ${relationship.id} in ${relationship.sourcePart || 'package root'}`,
        relationshipId: relationship.id,
        severity: 'error',
        sourcePart: relationship.sourcePart,
        target: relationship.target,
      })
    }
    relationshipKeys.add(key)
    if (!relationship.external && !partPaths.has(relationship.target)) {
      issues.push({
        code: 'pptx.relationship.missing-target',
        message: `Relationship target does not exist: ${relationship.target}`,
        relationshipId: relationship.id,
        severity: 'error',
        sourcePart: relationship.sourcePart,
        target: relationship.target,
      })
    }
  }
  for (const part of parts) {
    if (!part.contentType && part.path !== '[Content_Types].xml') {
      issues.push({
        code: 'pptx.part.missing-content-type',
        message: `Package part has no declared content type: ${part.path}`,
        severity: 'warning',
        sourcePart: part.path,
      })
    }
  }
  for (const slide of slides) {
    for (const [kind, target] of [
      ['layout', slide.layoutPart],
      ['master', slide.masterPart],
      ['theme', slide.themePart],
    ] as const) {
      if (!target) {
        issues.push({
          code: `pptx.slide.missing-${kind}`,
          message: `Slide dependency is missing its ${kind}: ${slide.slidePart}`,
          severity: 'error',
          sourcePart: slide.slidePart,
        })
      }
    }
  }
  return issues
}

export const createPowerPointPackageBacking = async (
  source: ArrayBuffer,
  fileName: string,
): Promise<PowerPointPackageBacking> => {
  if (source.byteLength > MAX_PACKAGE_BYTES) throw new Error('PowerPoint package exceeds the import size limit')
  const sourceCopy = source.slice(0)
  const zip = await JSZip.loadAsync(sourceCopy, { createFolders: false })
  const entries = Object.values(zip.files).filter(entry => !entry.dir)
  if (entries.length > MAX_PACKAGE_PARTS) throw new Error('PowerPoint package contains too many parts')
  let knownUncompressedBytes = 0
  for (const entry of entries) {
    const originalName = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
    if (originalName.startsWith('/') || originalName.includes('\\') || originalName.split('/').includes('..')) {
      throw new Error(`Unsafe PowerPoint package part path: ${originalName}`)
    }
    const uncompressedSize = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof uncompressedSize === 'number') {
      if (uncompressedSize > MAX_PART_BYTES) {
        throw new Error(`PowerPoint package part exceeds the import size limit: ${entry.name}`)
      }
      knownUncompressedBytes += uncompressedSize
      if (knownUncompressedBytes > MAX_UNCOMPRESSED_PACKAGE_BYTES) {
        throw new Error('PowerPoint package expands beyond the import size limit')
      }
    }
  }
  if (
    sourceCopy.byteLength
    && knownUncompressedBytes / sourceCopy.byteLength > MAX_PACKAGE_COMPRESSION_RATIO
  ) {
    throw new Error('PowerPoint package compression ratio exceeds the import limit')
  }

  const contentTypesPart = zip.file('[Content_Types].xml')
  const presentationPart = zip.file('ppt/presentation.xml')
  const presentationRelationshipsPart = zip.file('ppt/_rels/presentation.xml.rels')
  if (!contentTypesPart || !presentationPart || !presentationRelationshipsPart) {
    throw new Error('The file is not a complete PowerPoint OOXML package')
  }

  const [contentTypesXml, presentationXml] = await Promise.all([
    contentTypesPart.async('text'),
    presentationPart.async('text'),
  ])
  const contentTypes = parseContentTypes(contentTypesXml)
  const paths = entries.map(entry => normalizePackagePath(entry.name)).sort(numericPartSort)
  const parts = paths.map(path => ({
    contentType: contentTypeFor(path, contentTypes),
    kind: classifyPart(path),
    path,
  }))
  const relationships = await parseRelationships(zip, paths.filter(path => path.endsWith('.rels')))
  const packageId = await digestId(sourceCopy)
  const xmlCache = new Map<string, Promise<string>>()
  const readXmlPart = (path: string): Promise<string> => {
    const cached = xmlCache.get(path)
    if (cached) return cached
    const entry = zip.file(path)
    if (!entry) return Promise.reject(new Error(`PowerPoint package part does not exist: ${path}`))
    const size = (entry as typeof entry & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof size === 'number' && size > MAX_XML_PART_BYTES) {
      return Promise.reject(new Error(`PowerPoint XML part exceeds the import size limit: ${path}`))
    }
    const pending = entry.async('text')
    xmlCache.set(path, pending)
    return pending
  }
  const slideDependencies = await buildSlideDependencies(
    presentationXml,
    relationships,
    parts,
    readXmlPart,
  )
  const issues = buildPackageIssues(parts, relationships, slideDependencies)
  const objectParts = parts.filter(part => (
    part.kind === 'diagram'
    || part.kind === 'layout'
    || part.kind === 'master'
    || part.kind === 'notes'
    || part.kind === 'slide'
  ))
  const objects = (await Promise.all(objectParts.map(async part => {
    return collectSourceObjects(await readXmlPart(part.path), part.path, packageId)
  }))).flat()
  const hierarchy = await buildHierarchy({
    objects,
    packageId,
    parts,
    readXmlPart,
    relationships,
  })
  const slides = slideDependencies.map(slide => ({
    ...slide,
    layoutId: slide.layoutPart ? stablePartId(packageId, slide.layoutPart) : undefined,
    masterId: slide.masterPart ? stablePartId(packageId, slide.masterPart) : undefined,
    themeId: slide.themePart ? stablePartId(packageId, slide.themePart) : undefined,
  }))
  const reference: PowerPointPackageReference = {
    byteLength: sourceCopy.byteLength,
    fileName,
    hierarchy,
    kind: 'pptx',
    packageId,
    slides,
  }
  const manifest: PowerPointPackageManifest = {
    ...reference,
    issues,
    objects,
    parts,
    relationships,
    schemaVersion: 1,
  }
  return { bytes: new Uint8Array(sourceCopy), manifest, reference }
}
