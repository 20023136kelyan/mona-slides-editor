import JSZip from 'jszip'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

import type {
  PowerPointBuild,
  PowerPointComment,
  PowerPointCommentAuthor,
  PowerPointCustomShow,
  PowerPointDocumentSemantics,
  PowerPointPackageManifest,
  PowerPointPackageIssue,
  PowerPointPackagePart,
  PowerPointPackagePartKind,
  PowerPointPackageReference,
  PowerPointRelationship,
  PowerPointColorMap,
  PowerPointHeaderFooterPolicy,
  PowerPointHierarchy,
  PowerPointMasterTextStyles,
  PowerPointNotesMaster,
  PowerPointNotesParagraph,
  PowerPointNotesPlaceholder,
  PowerPointNotesSlide,
  PowerPointPresentationProperties,
  PowerPointTextStyleLevel,
  PowerPointSlideLayout,
  PowerPointSlideMaster,
  PowerPointSourceObjectIdentity,
  PowerPointSourceObjectKind,
  PowerPointSlideDependency,
  PowerPointSlideTiming,
  PowerPointSlideTransition,
  PowerPointTimingCondition,
  PowerPointTimingNode,
  PowerPointTheme,
  PowerPointThemeColor,
  PowerPointThemeFont,
  PowerPointThemeStyleEntry,
  PowerPointVisualEffect,
  PowerPointVisualMetadata,
  StructuredTextParagraphProperties,
  StructuredTextRunProperties,
} from '@mona/presentation-core'

import type { PowerPointPackageBacking } from './types'

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
  if (/^ppt\/theme\/(?:theme|themeOverride)\d+\.xml$/i.test(path)) return 'theme'
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

const childNodes = (
  node: OrderedXmlNode | undefined,
  expectedTag?: string,
): OrderedXmlNode[] => {
  if (!node) return []
  return nodeEntries(node).flatMap(([tag, children]) => (
    expectedTag === undefined || localName(tag) === expectedTag ? children : []
  ))
}

const visualEffectKinds = new Set([
  'alphaBiLevel', 'alphaCeiling', 'alphaFloor', 'alphaInv', 'alphaMod',
  'alphaModFix', 'alphaOutset', 'alphaRepl', 'biLevel', 'blend', 'blur',
  'clrChange', 'clrRepl', 'duotone', 'fill', 'fillOverlay', 'glow',
  'grayscl', 'innerShdw', 'lum', 'outerShdw', 'prstShdw', 'reflection',
  'relOff', 'softEdge', 'solidFill', 'tint', 'xfrm',
])

const parseVisualMetadata = (
  visualChildren: OrderedXmlNode[],
): PowerPointVisualMetadata | undefined => {
  const effectContainer = findDirectNode(visualChildren, ['effectDag', 'effectLst'])
  const effects: PowerPointVisualEffect[] = []
  if (effectContainer) {
    walkXml(childNodes(effectContainer), (effectTag, effectNode) => {
      if (!visualEffectKinds.has(effectTag)) return
      const color = parseThemeColorNode(effectNode, effectTag)
      const alphaNode = findFirstNode(childNodes(effectNode), 'alpha')
      const alphaValue = alphaNode ? Number(nodeAttributes(alphaNode).val) : Number.NaN
      effects.push({
        attributes: { ...nodeAttributes(effectNode) },
        ...(color
          ? {
              color: {
                ...color,
                ...(Number.isFinite(alphaValue)
                  ? { alpha: Math.max(0, Math.min(1, alphaValue / 100_000)) }
                  : {}),
              },
            }
          : {}),
        type: effectTag,
      })
    })
  }
  const hasEffectDag = Boolean(findDirectNode(visualChildren, ['effectDag']))
  const hasEffectList = Boolean(findDirectNode(visualChildren, ['effectLst']))
  const scene3dNode = findDirectNode(visualChildren, ['scene3d'])
  const sceneChildren = childNodes(scene3dNode)
  const cameraNode = findDirectNode(sceneChildren, ['camera'])
  const lightRigNode = findDirectNode(sceneChildren, ['lightRig'])
  const cameraRotation = cameraNode
    ? findDirectNode(childNodes(cameraNode), ['rot'])
    : undefined
  const lightRotation = lightRigNode
    ? findDirectNode(childNodes(lightRigNode), ['rot'])
    : undefined
  const scene3d = scene3dNode
    ? {
        ...(cameraNode
          ? {
              camera: {
                attributes: { ...nodeAttributes(cameraNode) },
                ...(cameraRotation
                  ? { rotation: { attributes: { ...nodeAttributes(cameraRotation) } } }
                  : {}),
              },
            }
          : {}),
        ...(lightRigNode
          ? {
              lightRig: {
                attributes: { ...nodeAttributes(lightRigNode) },
                ...(lightRotation
                  ? { rotation: { attributes: { ...nodeAttributes(lightRotation) } } }
                  : {}),
              },
            }
          : {}),
      }
    : undefined
  const shape3dNode = findDirectNode(visualChildren, ['sp3d'])
  const shapeChildren = childNodes(shape3dNode)
  const bevelTopNode = findDirectNode(shapeChildren, ['bevelT'])
  const bevelBottomNode = findDirectNode(shapeChildren, ['bevelB'])
  const contourColorNode = findDirectNode(shapeChildren, ['contourClr'])
  const extrusionColorNode = findDirectNode(shapeChildren, ['extrusionClr'])
  const shape3d = shape3dNode
    ? {
        attributes: { ...nodeAttributes(shape3dNode) },
        ...(bevelBottomNode ? { bevelBottom: { ...nodeAttributes(bevelBottomNode) } } : {}),
        ...(bevelTopNode ? { bevelTop: { ...nodeAttributes(bevelTopNode) } } : {}),
        ...(contourColorNode && parseThemeColorNode(contourColorNode, 'contourClr')
          ? { contourColor: parseThemeColorNode(contourColorNode, 'contourClr') }
          : {}),
        ...(extrusionColorNode && parseThemeColorNode(extrusionColorNode, 'extrusionClr')
          ? { extrusionColor: parseThemeColorNode(extrusionColorNode, 'extrusionClr') }
          : {}),
      }
    : undefined
  const hasScene3d = Boolean(scene3dNode)
  const hasShape3d = Boolean(shape3dNode)
  return effects.length || hasEffectDag || hasEffectList || hasScene3d || hasShape3d
    ? {
        effects,
        hasEffectDag,
        hasEffectList,
        hasScene3d,
        hasShape3d,
        ...(scene3d ? { scene3d } : {}),
        ...(shape3d ? { shape3d } : {}),
      }
    : undefined
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
        const decorativeNode = nonVisual
          ? findFirstNode(nodeEntries(nonVisual).flatMap(([, nested]) => nested), 'decorative')
          : undefined
        const decorativeValue = decorativeNode ? nodeAttributes(decorativeNode).val : undefined
        const placeholder = findFirstNode(nonVisualChildren, 'ph')
        const placeholderValues = placeholder ? nodeAttributes(placeholder) : {}
        const connectorProperties = kind === 'connector'
          ? findFirstNode(nonVisualChildren, 'cNvCxnSpPr')
          : undefined
        const connectorChildren = connectorProperties
          ? childNodes(connectorProperties)
          : []
        const lockNode = findFirstNode(nonVisualChildren, kind === 'group'
          ? 'cNvGrpSpPr'
          : kind === 'picture'
            ? 'cNvPicPr'
            : kind === 'connector'
              ? 'cNvCxnSpPr'
              : 'cNvSpPr')
        const locks = Object.fromEntries(Object.entries(lockNode ? nodeAttributes(lockNode) : {}).flatMap(
          ([name, value]) => (
            name.startsWith('no')
              ? [[name, value !== '0' && value !== 'false']]
              : []
          ),
        ))
        const connectorEndpoint = (name: 'endCxn' | 'stCxn') => {
          const endpoint = findFirstNode(connectorChildren, name)
          const endpointValues = endpoint ? nodeAttributes(endpoint) : {}
          return endpointValues.id && endpointValues.idx !== undefined
            ? {
                nativeShapeId: endpointValues.id,
                siteIndex: endpointValues.idx,
              }
            : undefined
        }
        const connectorStart = connectorEndpoint('stCxn')
        const connectorEnd = connectorEndpoint('endCxn')
        const visualProperties = findDirectNode(children, ['grpSpPr', 'spPr'])
        const visualChildren = visualProperties ? childNodes(visualProperties) : []
        const visual = parseVisualMetadata(visualChildren)
        const style = findDirectNode(children, ['style'])
        const effectReferenceNode = style
          ? findDirectNode(childNodes(style), ['effectRef'])
          : undefined
        const effectReferenceAttributes = effectReferenceNode
          ? nodeAttributes(effectReferenceNode)
          : {}
        const effectReferenceIndex = Number(effectReferenceAttributes.idx)
        const effectReferenceColor = effectReferenceNode
          ? parseThemeColorNode(effectReferenceNode, 'effectRef')
          : undefined
        const relationshipIds = new Set<string>()
        walkXml(children, (_childTag, childNode) => {
          for (const [name, value] of Object.entries(nodeAttributes(childNode))) {
            if (/^r:(?:embed|id|link)$/.test(name) && value) relationshipIds.add(value)
          }
        })
        objects.push({
          ...(creationId ? { creationId } : {}),
          ...(decorativeValue !== undefined
            ? { decorative: decorativeValue !== '0' && decorativeValue !== 'false' }
            : {}),
          ...(connectorStart || connectorEnd
            ? {
                connector: {
                  ...(connectorEnd ? { end: connectorEnd } : {}),
                  ...(connectorStart ? { start: connectorStart } : {}),
                },
              }
            : {}),
          ...(values.descr ? { description: values.descr } : {}),
          ...(Number.isFinite(effectReferenceIndex) && effectReferenceIndex >= 0
            ? {
                effectReference: {
                  ...(effectReferenceColor ? { color: effectReferenceColor } : {}),
                  index: effectReferenceIndex,
                },
              }
            : {}),
          ...(values.hidden !== undefined
            ? { hidden: values.hidden !== '0' && values.hidden !== 'false' }
            : {}),
          kind,
          ...(Object.keys(locks).length ? { locks } : {}),
          ...(values.name ? { name: values.name } : {}),
          nativeId,
          ...(parentStableId ? { parentStableId } : {}),
          partPath,
          ...(placeholderValues.idx ? { placeholderIndex: placeholderValues.idx } : {}),
          ...(placeholderValues.type ? { placeholderType: placeholderValues.type } : {}),
          ...(relationshipIds.size ? { relationshipIds: [...relationshipIds].sort() } : {}),
          sourceIndex,
          stableId,
          ...(values.title ? { title: values.title } : {}),
          ...(visual ? { visual } : {}),
        })
        sourceIndex += 1
        visit(children, stableId)
      }
    }
  }
  visit(parseXml(xml, partPath))
  const uniqueObjectByNativeId = new Map<string, PowerPointSourceObjectIdentity | undefined>()
  for (const object of objects) {
    if (uniqueObjectByNativeId.has(object.nativeId)) {
      uniqueObjectByNativeId.set(object.nativeId, undefined)
    }
    else uniqueObjectByNativeId.set(object.nativeId, object)
  }
  for (const object of objects) {
    if (!object.connector) continue
    for (const endpoint of [object.connector.start, object.connector.end]) {
      if (!endpoint) continue
      const target = uniqueObjectByNativeId.get(endpoint.nativeShapeId)
      if (target) endpoint.targetObjectId = target.stableId
    }
  }
  return objects
}

const stablePartId = (packageId: string, partPath: string): string => `${packageId}/${partPath}`

const parseThemeColorNode = (
  node: OrderedXmlNode,
  name: string,
): PowerPointThemeColor | undefined => {
  const children = childNodes(node)
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
    if (value) return { name, type, value }
  }
  return undefined
}

const parseColorScheme = (node: OrderedXmlNode | undefined): PowerPointThemeColor[] => {
  const colors: PowerPointThemeColor[] = []
  for (const colorNode of childNodes(node, 'clrScheme')) {
    for (const [tag] of nodeEntries(colorNode)) {
      const color = parseThemeColorNode(colorNode, localName(tag))
      if (color) colors.push(color)
    }
  }
  return colors
}

const findAllNodes = (
  nodes: OrderedXmlNode[],
  expectedTag: string,
): OrderedXmlNode[] => {
  const matches: OrderedXmlNode[] = []
  walkXml(nodes, (tag, node) => {
    if (tag === expectedTag) matches.push(node)
  })
  return matches
}

const parseThemeStyleList = (
  nodes: OrderedXmlNode[],
  listTag: 'bgFillStyleLst' | 'effectStyleLst' | 'fillStyleLst' | 'lnStyleLst',
): PowerPointThemeStyleEntry[] => {
  const listNode = findFirstNode(nodes, listTag)
  const listChildren = childNodes(listNode, listTag)
  const styles: PowerPointThemeStyleEntry[] = []
  for (const child of listChildren) {
    for (const [sourceTag, children] of nodeEntries(child)) {
      const colors: PowerPointThemeColor[] = []
      walkXml(children, (tag, colorNode) => {
        const type = tag === 'srgbClr'
          ? 'srgb'
          : tag === 'sysClr'
            ? 'system'
            : tag === 'schemeClr'
              ? 'scheme'
              : tag === 'prstClr'
                ? 'preset'
                : undefined
        if (!type) return
        const values = nodeAttributes(colorNode)
        const value = type === 'system' ? values.lastClr ?? values.val : values.val ?? values.lastClr
        if (value) colors.push({ name: tag, type, value })
      })
      const visual = listTag === 'effectStyleLst'
        ? parseVisualMetadata(children)
        : undefined
      styles.push({
        attributes: nodeAttributes(child),
        childTypes: children.flatMap(node => nodeEntries(node).map(([tag]) => localName(tag))),
        colors,
        index: styles.length,
        kind: localName(sourceTag),
        ...(visual ? { visual } : {}),
      })
    }
  }
  return styles
}

const parseThemeFont = (node: OrderedXmlNode | undefined): PowerPointThemeFont | undefined => {
  if (!node) return undefined
  const children = childNodes(node)
  const latin = findFirstAttributes(children, 'latin').typeface
  const eastAsian = findFirstAttributes(children, 'ea').typeface
  const complexScript = findFirstAttributes(children, 'cs').typeface
  const supplemental: PowerPointThemeFont['supplemental'] = []
  walkXml(children, (tag, fontNode) => {
    if (tag !== 'font') return
    const values = nodeAttributes(fontNode)
    if (values.script && values.typeface) supplemental.push({
      script: values.script,
      typeface: values.typeface,
    })
  })
  if (!latin && !eastAsian && !complexScript && !supplemental.length) return undefined
  return {
    ...(complexScript ? { complexScript } : {}),
    ...(eastAsian ? { eastAsian } : {}),
    ...(latin ? { latin } : {}),
    supplemental,
  }
}

const parseTheme = (
  xml: string,
  partPath: string,
  packageId: string,
): PowerPointTheme => {
  const nodes = parseXml(xml, partPath)
  const root = findFirstAttributes(nodes, 'theme')
  const colorSchemeNode = findFirstNode(nodes, 'clrScheme')
  const colors = parseColorScheme(colorSchemeNode)
  const majorFontNode = findFirstNode(nodes, 'majorFont')
  const minorFontNode = findFirstNode(nodes, 'minorFont')
  const majorFont = parseThemeFont(majorFontNode)
  const minorFont = parseThemeFont(minorFontNode)
  const extraColorSchemes = findAllNodes(nodes, 'extraClrScheme').map(node => {
    const colorScheme = findFirstNode(childNodes(node, 'extraClrScheme'), 'clrScheme')
    return {
      colors: parseColorScheme(colorScheme),
      name: colorScheme ? nodeAttributes(colorScheme).name : undefined,
    }
  })
  return {
    backgroundFillStyles: parseThemeStyleList(nodes, 'bgFillStyleLst'),
    colorSchemeName: findFirstAttributes(nodes, 'clrScheme').name,
    colors,
    ...(extraColorSchemes.length ? { extraColorSchemes } : {}),
    effectStyles: parseThemeStyleList(nodes, 'effectStyleLst'),
    fillStyles: parseThemeStyleList(nodes, 'fillStyleLst'),
    formatSchemeName: findFirstAttributes(nodes, 'fmtScheme').name,
    id: stablePartId(packageId, partPath),
    isOverride: /\/themeOverride\d+\.xml$/i.test(partPath),
    lineStyles: parseThemeStyleList(nodes, 'lnStyleLst'),
    ...(majorFont ? { majorFont } : {}),
    majorLatinFont: majorFont?.latin,
    ...(minorFont ? { minorFont } : {}),
    minorLatinFont: minorFont?.latin,
    name: root.name,
    packageId,
    partPath,
  }
}

const parseBooleanAttribute = (value: string | undefined, fallback: boolean): boolean => (
  value === undefined ? fallback : value !== '0' && value.toLowerCase() !== 'false'
)

const parseColorMap = (
  nodes: OrderedXmlNode[],
  tag: 'clrMap' | 'overrideClrMapping',
): PowerPointColorMap | undefined => {
  const values = findFirstAttributes(nodes, tag)
  return Object.keys(values).length ? values : undefined
}

const parseHeaderFooter = (nodes: OrderedXmlNode[]): PowerPointHeaderFooterPolicy | undefined => {
  const node = findFirstNode(nodes, 'hf')
  const values = node ? nodeAttributes(node) : {}
  return {
    dateTime: parseBooleanAttribute(values.dt, true),
    footer: parseBooleanAttribute(values.ftr, true),
    header: parseBooleanAttribute(values.hdr, true),
    slideNumber: parseBooleanAttribute(values.sldNum, true),
  }
}

const textPoints = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 12_700 : undefined
}

const parseTextSpacing = (node: OrderedXmlNode | undefined) => {
  if (!node) return undefined
  const percent = Number(findFirstAttributes(childNodes(node), 'spcPct').val)
  if (Number.isFinite(percent)) return { unit: 'percent' as const, value: percent / 1000 }
  const points = Number(findFirstAttributes(childNodes(node), 'spcPts').val)
  if (Number.isFinite(points)) return { unit: 'points' as const, value: points / 100 }
  return undefined
}

const parseTextRunProperties = (
  runNode: OrderedXmlNode | undefined,
): StructuredTextRunProperties | undefined => {
  if (!runNode) return undefined
  const values = nodeAttributes(runNode)
  const children = childNodes(runNode)
  const colorNode = findFirstNode(children, 'solidFill')
  const color = colorNode ? parseThemeColorNode(colorNode, 'text') : undefined
  const fontSize = Number(values.sz)
  const spacing = Number(values.spc)
  const baseline = Number(values.baseline)
  const properties: StructuredTextRunProperties = {
    ...(values.altLang ? { alternativeLanguage: values.altLang } : {}),
    ...(Number.isFinite(baseline) ? { baseline: baseline / 1000 } : {}),
    ...(values.b !== undefined ? { bold: parseBooleanAttribute(values.b, false) } : {}),
    ...(values.cap ? { capitalization: values.cap } : {}),
    ...(color ? { color } : {}),
    ...(findFirstAttributes(children, 'cs').typeface
      ? { complexScriptFontFamily: findFirstAttributes(children, 'cs').typeface }
      : {}),
    ...(findFirstAttributes(children, 'ea').typeface
      ? { eastAsianFontFamily: findFirstAttributes(children, 'ea').typeface }
      : {}),
    ...(findFirstAttributes(children, 'latin').typeface
      ? { fontFamily: findFirstAttributes(children, 'latin').typeface }
      : {}),
    ...(Number.isFinite(fontSize) ? { fontSize: fontSize / 100 } : {}),
    ...(values.i !== undefined ? { italic: parseBooleanAttribute(values.i, false) } : {}),
    ...(values.lang ? { language: values.lang } : {}),
    ...(values.normalizeH !== undefined
      ? { normalizeHeight: parseBooleanAttribute(values.normalizeH, false) }
      : {}),
    ...(Number.isFinite(spacing) ? { spacing: spacing / 100 } : {}),
    ...(values.strike ? { strike: values.strike } : {}),
    ...(values.u ? { underline: values.u } : {}),
  }
  return Object.keys(properties).length ? properties : undefined
}

const parseTextBullet = (children: OrderedXmlNode[]) => {
  if (findFirstNode(children, 'buNone')) return { type: 'none' as const }
  const character = findFirstAttributes(children, 'buChar').char
  const autoNumber = findFirstNode(children, 'buAutoNum')
  const picture = findFirstNode(children, 'buBlip')
  if (!character && !autoNumber && !picture) return undefined
  const autoValues = autoNumber ? nodeAttributes(autoNumber) : {}
  const startAt = Number(autoValues.startAt)
  const percent = Number(findFirstAttributes(children, 'buSzPct').val)
  const points = Number(findFirstAttributes(children, 'buSzPts').val)
  return {
    ...(character ? { character } : {}),
    ...(findFirstAttributes(children, 'buFont').typeface
      ? { fontFamily: findFirstAttributes(children, 'buFont').typeface }
      : {}),
    ...(autoValues.type ? { numberingScheme: autoValues.type } : {}),
    ...(Number.isFinite(percent)
      ? { size: { unit: 'percent' as const, value: percent / 1000 } }
      : Number.isFinite(points)
        ? { size: { unit: 'points' as const, value: points / 100 } }
        : {}),
    ...(Number.isFinite(startAt) ? { startAt } : {}),
    type: autoNumber ? 'auto-number' as const : picture ? 'picture' as const : 'character' as const,
  }
}

const parseTextParagraphProperties = (
  styleNode: OrderedXmlNode,
): StructuredTextParagraphProperties | undefined => {
  const values = nodeAttributes(styleNode)
  const children = childNodes(styleNode)
  const bullet = parseTextBullet(children)
  const defaultRun = parseTextRunProperties(findFirstNode(children, 'defRPr'))
  const marginLeft = textPoints(values.marL)
  const indent = textPoints(values.indent)
  const defaultTabSize = textPoints(values.defTabSz)
  const tabsNode = findFirstNode(children, 'tabLst')
  const tabs = childNodes(tabsNode, 'tabLst').flatMap(tabNode => {
    const tabValues = nodeAttributes(tabNode)
    const position = textPoints(tabValues.pos)
    return position === undefined
      ? []
      : [{ ...(tabValues.algn ? { alignment: tabValues.algn } : {}), position }]
  })
  const lineSpacing = parseTextSpacing(findFirstNode(children, 'lnSpc'))
  const spaceBefore = parseTextSpacing(findFirstNode(children, 'spcBef'))
  const spaceAfter = parseTextSpacing(findFirstNode(children, 'spcAft'))
  const properties: StructuredTextParagraphProperties = {
    ...(values.algn ? { alignment: values.algn } : {}),
    ...(bullet ? { bullet } : {}),
    ...(defaultRun ? { defaultRun } : {}),
    ...(defaultTabSize !== undefined ? { defaultTabSize } : {}),
    ...(values.eaLnBrk !== undefined
      ? { eastAsianLineBreak: parseBooleanAttribute(values.eaLnBrk, false) }
      : {}),
    ...(values.fontAlgn ? { fontAlignment: values.fontAlgn } : {}),
    ...(values.hangingPunct !== undefined
      ? { hangingPunctuation: parseBooleanAttribute(values.hangingPunct, false) }
      : {}),
    ...(indent !== undefined ? { indent } : {}),
    ...(values.latinLnBrk !== undefined
      ? { latinLineBreak: parseBooleanAttribute(values.latinLnBrk, false) }
      : {}),
    ...(lineSpacing ? { lineSpacing } : {}),
    ...(marginLeft !== undefined ? { marginLeft } : {}),
    ...(values.rtl !== undefined
      ? { rightToLeft: parseBooleanAttribute(values.rtl, false) }
      : {}),
    ...(spaceAfter ? { spaceAfter } : {}),
    ...(spaceBefore ? { spaceBefore } : {}),
    ...(tabs.length ? { tabs } : {}),
  }
  return Object.keys(properties).length ? properties : undefined
}

const parseTextStyleLevel = (
  styleNode: OrderedXmlNode,
  level: number,
) => {
  const values = nodeAttributes(styleNode)
  const children = childNodes(styleNode)
  const runNode = findFirstNode(children, 'defRPr')
  const runValues = runNode ? nodeAttributes(runNode) : {}
  const runChildren = childNodes(runNode)
  const colorNode = findFirstNode(runChildren, 'solidFill')
  const fontColor = colorNode ? parseThemeColorNode(colorNode, 'text') : undefined
  const fontFamily = findFirstAttributes(runChildren, 'latin').typeface
  const bulletCharacter = findFirstAttributes(children, 'buChar').char
  const paragraph = parseTextParagraphProperties(styleNode)
  const run = parseTextRunProperties(runNode)
  const fontSize = Number(runValues.sz)
  return {
    ...(values.algn ? { alignment: values.algn } : {}),
    ...(runValues.b !== undefined ? { bold: parseBooleanAttribute(runValues.b, false) } : {}),
    ...(bulletCharacter ? { bulletCharacter } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(Number.isFinite(fontSize) ? { fontSize: fontSize / 100 } : {}),
    ...(textPoints(values.indent) !== undefined ? { indent: textPoints(values.indent) } : {}),
    ...(runValues.i !== undefined ? { italic: parseBooleanAttribute(runValues.i, false) } : {}),
    ...(runValues.lang ? { language: runValues.lang } : {}),
    level,
    ...(textPoints(values.marL) !== undefined ? { marginLeft: textPoints(values.marL) } : {}),
    ...(paragraph ? { paragraph } : {}),
    ...(values.rtl !== undefined ? { rightToLeft: parseBooleanAttribute(values.rtl, false) } : {}),
    ...(run ? { run } : {}),
    ...(runValues.u ? { underline: runValues.u } : {}),
  }
}

const parseTextStyleLevels = (styleChildren: OrderedXmlNode[]) => {
  const levels: PowerPointTextStyleLevel[] = []
  for (let level = 1; level <= 9; level += 1) {
    const levelNode = findFirstNode(styleChildren, `lvl${level}pPr`)
    if (levelNode) levels.push(parseTextStyleLevel(levelNode, level))
  }
  return levels
}

const parseTextStyle = (
  nodes: OrderedXmlNode[],
  styleTag: 'bodyStyle' | 'otherStyle' | 'titleStyle',
) => {
  const styleNode = findFirstNode(nodes, styleTag)
  const styleChildren = childNodes(styleNode, styleTag)
  return parseTextStyleLevels(styleChildren)
}

const parseMasterTextStyles = (nodes: OrderedXmlNode[]): PowerPointMasterTextStyles | undefined => {
  const stylesNode = findFirstNode(nodes, 'txStyles')
  const styles = childNodes(stylesNode, 'txStyles')
  if (!styles.length) return undefined
  return {
    body: parseTextStyle(styles, 'bodyStyle'),
    other: parseTextStyle(styles, 'otherStyle'),
    title: parseTextStyle(styles, 'titleStyle'),
  }
}

const placeholderLayer = (partPath: string): 'layout' | 'master' | 'slide' => {
  if (partPath.includes('/slideLayouts/')) return 'layout'
  if (partPath.includes('/slideMasters/')) return 'master'
  return 'slide'
}

const placeholderTextStyleKind = (
  type: string | undefined,
): 'body' | 'other' | 'title' => {
  if (type === 'title' || type === 'ctrTitle') return 'title'
  if (type === 'body' || type === 'obj' || type === 'subTitle') return 'body'
  return 'other'
}

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
  const presentationPart = parts.find(part => part.kind === 'presentation' && /\/presentation\.xml$/i.test(part.path))
  const presentationNodes = presentationPart ? parseXml(await readXmlPart(presentationPart.path), presentationPart.path) : []
  const defaultTextStyleNode = findFirstNode(presentationNodes, 'defaultTextStyle')
  const defaultTextStyle = defaultTextStyleNode
    ? parseTextStyleLevels(childNodes(defaultTextStyleNode, 'defaultTextStyle'))
    : []
  const themeParts = parts.filter(part => part.kind === 'theme')
  const themes = await Promise.all(themeParts.map(async part => (
    parseTheme(await readXmlPart(part.path), part.path, packageId)
  )))
  const layouts: PowerPointSlideLayout[] = await Promise.all(
    parts.filter(part => part.kind === 'layout').map(async part => {
      const nodes = parseXml(await readXmlPart(part.path), part.path)
      const root = findFirstAttributes(nodes, 'sldLayout')
      const masterPart = findInternalTarget(relationships, part.path, 'slideMaster')
      const colorMapOverride = parseColorMap(nodes, 'overrideClrMapping')
      return {
        ...(colorMapOverride ? { colorMapOverride } : {}),
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
      const nodes = parseXml(await readXmlPart(part.path), part.path)
      const root = findFirstAttributes(nodes, 'sldMaster')
      const themePart = findInternalTarget(relationships, part.path, 'theme')
      const colorMap = parseColorMap(nodes, 'clrMap')
      const headerFooter = parseHeaderFooter(nodes)
      const textStyles = parseMasterTextStyles(nodes)
      const layoutParts = relationships.filter(relationship => (
        !relationship.external
        && relationship.sourcePart === part.path
        && relationshipKind(relationship) === 'slideLayout'
      )).map(relationship => relationship.target)
      return {
        ...(colorMap ? { colorMap } : {}),
        ...(headerFooter ? { headerFooter } : {}),
        id: stablePartId(packageId, part.path),
        layoutIds: layoutParts.map(layoutPart => stablePartId(packageId, layoutPart)),
        objectIds: objects.filter(object => object.partPath === part.path).map(object => object.stableId),
        packageId,
        partPath: part.path,
        preserve: parseBooleanAttribute(root.preserve, false),
        ...(textStyles ? { textStyles } : {}),
        themeId: themePart ? stablePartId(packageId, themePart) : undefined,
      }
    }),
  )
  const placeholders = objects.flatMap(object => (
    object.placeholderIndex === undefined && object.placeholderType === undefined
      ? []
      : [{
          ...(object.placeholderIndex !== undefined ? { index: object.placeholderIndex } : {}),
          layer: placeholderLayer(object.partPath),
          objectId: object.stableId,
          partId: stablePartId(packageId, object.partPath),
          partPath: object.partPath,
          textStyleKind: placeholderTextStyleKind(object.placeholderType),
          ...(object.placeholderType !== undefined ? { type: object.placeholderType } : {}),
        }]
  ))
  return {
    ...(defaultTextStyle.length ? { defaultTextStyle } : {}),
    layouts,
    masters,
    placeholders,
    themes,
  }
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
    const notesPart = findInternalTarget(relationships, slide.slidePart, 'notesSlide')
    const nodes = parseXml(await readXmlPart(slide.slidePart), slide.slidePart)
    const root = findFirstAttributes(nodes, 'sld')
    const colorMapOverride = parseColorMap(nodes, 'overrideClrMapping')
    return {
      ...slide,
      ...(colorMapOverride ? { colorMapOverride } : {}),
      layoutPart,
      masterPart,
      notesPart,
      showMasterPlaceholderAnimations: parseBooleanAttribute(root.showMasterPhAnim, true),
      showMasterShapes: parseBooleanAttribute(root.showMasterSp, true),
      themePart,
    }
  }))
}

const descendantText = (nodes: readonly OrderedXmlNode[]): string => {
  let value = ''
  for (const node of nodes) {
    const text = node['#text']
    if (typeof text === 'string') value += text
    for (const [, children] of nodeEntries(node)) value += descendantText(children)
  }
  return value
}

const textParagraphs = (textBody: OrderedXmlNode | undefined): PowerPointNotesParagraph[] => {
  if (!textBody) return []
  const paragraphs: PowerPointNotesParagraph[] = []
  for (const paragraph of childNodes(textBody).filter(node => (
    localName(nodeEntries(node)[0]?.[0] ?? '') === 'p'
  ))) {
    const paragraphChildren = childNodes(paragraph)
    const paragraphProperties = findDirectNode(paragraphChildren, ['pPr'])
    const paragraphValues = paragraphProperties ? nodeAttributes(paragraphProperties) : {}
    const runs: PowerPointNotesParagraph['runs'] = []
    for (const run of paragraphChildren) {
      const kind = localName(nodeEntries(run)[0]?.[0] ?? '')
      if (kind === 'br') {
        runs.push({ text: '\n' })
        continue
      }
      if (kind === 'tab') {
        runs.push({ text: '\t' })
        continue
      }
      if (kind !== 'r' && kind !== 'fld') continue
      const runChildren = childNodes(run)
      const runProperties = findDirectNode(runChildren, ['rPr'])
      const values = runProperties ? nodeAttributes(runProperties) : {}
      const font = runProperties
        ? findFirstAttributes(childNodes(runProperties), 'latin').typeface
        : undefined
      const textNode = findDirectNode(runChildren, ['t'])
      runs.push({
        ...(values.b !== undefined ? { bold: parseBooleanAttribute(values.b, false) } : {}),
        ...(font ? { fontFamily: font } : {}),
        ...(values.sz && Number.isFinite(Number(values.sz)) ? { fontSize: Number(values.sz) / 100 } : {}),
        ...(values.i !== undefined ? { italic: parseBooleanAttribute(values.i, false) } : {}),
        ...(values.lang ? { language: values.lang } : {}),
        text: textNode ? descendantText(childNodes(textNode)) : '',
        ...(values.u ? { underline: values.u } : {}),
      })
    }
    const endProperties = findDirectNode(paragraphChildren, ['endParaRPr'])
    if (!runs.length && endProperties) runs.push({ text: '' })
    paragraphs.push({
      ...(paragraphValues.algn ? { alignment: paragraphValues.algn } : {}),
      ...(paragraphValues.lvl && Number.isFinite(Number(paragraphValues.lvl))
        ? { level: Number(paragraphValues.lvl) }
        : {}),
      runs,
    })
  }
  return paragraphs
}

const parseNotesPlaceholders = (nodes: OrderedXmlNode[]): PowerPointNotesPlaceholder[] => {
  const placeholders: PowerPointNotesPlaceholder[] = []
  const visit = (children: OrderedXmlNode[]): void => {
    for (const node of children) {
      const tag = localName(nodeEntries(node)[0]?.[0] ?? '')
      if (tag !== 'sp') {
        visit(childNodes(node))
        continue
      }
      const shapeChildren = childNodes(node)
      const nonVisual = findFirstNode(shapeChildren, 'cNvPr')
      const placeholder = findFirstNode(shapeChildren, 'ph')
      const nonVisualValues = nonVisual ? nodeAttributes(nonVisual) : {}
      const placeholderValues = placeholder ? nodeAttributes(placeholder) : {}
      if (nonVisualValues.id) {
        placeholders.push({
          nativeShapeId: nonVisualValues.id,
          paragraphs: textParagraphs(findDirectNode(shapeChildren, ['txBody'])),
          ...(placeholderValues.idx !== undefined ? { placeholderIndex: placeholderValues.idx } : {}),
          ...(placeholderValues.type ? { placeholderType: placeholderValues.type } : {}),
        })
      }
      visit(shapeChildren)
    }
  }
  visit(nodes)
  return placeholders
}

const parsePresentationProperties = (nodes: OrderedXmlNode[]): PowerPointPresentationProperties => {
  const presentation = findFirstAttributes(nodes, 'presentation')
  const slideSize = findFirstAttributes(nodes, 'sldSz')
  const integer = (value: string | undefined): number | undefined => {
    const result = Number(value)
    return Number.isFinite(result) ? result : undefined
  }
  return {
    ...(integer(presentation.firstSlideNum) !== undefined
      ? { firstSlideNumber: integer(presentation.firstSlideNum) }
      : {}),
    ...(presentation.rtl !== undefined
      ? { rightToLeft: parseBooleanAttribute(presentation.rtl, false) }
      : {}),
    ...(presentation.showSpecialPlsOnTitleSld !== undefined
      ? { showSpecialPlaceholdersOnTitleSlide: parseBooleanAttribute(presentation.showSpecialPlsOnTitleSld, true) }
      : {}),
    ...(integer(slideSize.cy) !== undefined ? { slideHeightEmu: integer(slideSize.cy) } : {}),
    ...(integer(slideSize.cx) !== undefined ? { slideWidthEmu: integer(slideSize.cx) } : {}),
    ...(presentation.strictFirstAndLastChars !== undefined
      ? { strictFirstAndLastChars: parseBooleanAttribute(presentation.strictFirstAndLastChars, false) }
      : {}),
  }
}

const parseSections = (nodes: OrderedXmlNode[]) => {
  const sections: PowerPointDocumentSemantics['sections'] = []
  walkXml(nodes, (tag, node, children) => {
    if (tag !== 'section') return
    const values = nodeAttributes(node)
    if (!values.id) return
    const slideIds: string[] = []
    walkXml(children, (childTag, child) => {
      if (childTag !== 'sldId') return
      const id = nodeAttributes(child).id
      if (id) slideIds.push(id)
    })
    sections.push({ id: values.id, ...(values.name ? { name: values.name } : {}), slideIds })
  })
  return sections
}

const parseCustomShows = (nodes: OrderedXmlNode[]): PowerPointCustomShow[] => {
  const shows: PowerPointCustomShow[] = []
  walkXml(nodes, (tag, node, children) => {
    if (tag !== 'custShow') return
    const values = nodeAttributes(node)
    if (!values.name) return
    const relationshipIds: string[] = []
    walkXml(children, (childTag, child) => {
      if (childTag !== 'sld') return
      const relationshipId = nodeAttributes(child)['r:id']
      if (relationshipId) relationshipIds.push(relationshipId)
    })
    shows.push({
      ...(values.id ? { id: values.id } : {}),
      name: values.name,
      relationshipIds,
    })
  })
  return shows
}

const transitionFrom = (
  nodes: OrderedXmlNode[],
  sourceLayer: PowerPointSlideTransition['sourceLayer'],
): PowerPointSlideTransition | undefined => {
  const transition = findFirstNode(nodes, 'transition')
  if (!transition) return undefined
  const values = nodeAttributes(transition)
  const children = childNodes(transition)
  const effectNode = children.find(node => !['sndAc', 'extLst'].includes(
    localName(nodeEntries(node)[0]?.[0] ?? ''),
  ))
  const effectTag = effectNode ? localName(nodeEntries(effectNode)[0]?.[0] ?? '') : undefined
  const duration = Object.entries(values).find(([key]) => localName(key) === 'dur')?.[1]
  const sound = findFirstNode(children, 'snd')
  const soundId = sound ? nodeAttributes(sound)['r:embed'] ?? nodeAttributes(sound)['r:link'] : undefined
  return {
    ...(values.advTm && Number.isFinite(Number(values.advTm)) ? { advanceAfterMs: Number(values.advTm) } : {}),
    ...(values.advClick !== undefined ? { advanceOnClick: parseBooleanAttribute(values.advClick, true) } : {}),
    ...(duration && Number.isFinite(Number(duration)) ? { durationMs: Number(duration) } : {}),
    ...(effectNode && effectTag
      ? { effect: { attributes: { ...nodeAttributes(effectNode) }, type: effectTag } }
      : {}),
    ...(soundId ? { soundRelationshipId: soundId } : {}),
    ...(values.spd ? { speed: values.spd } : {}),
    sourceLayer,
  }
}

const timingTarget = (
  nodes: OrderedXmlNode[],
  objectByNativeId: Map<string, string>,
): { targetObjectId?: string; targetShapeId?: string } => {
  const target = findFirstNode(nodes, 'spTgt')
  const targetShapeId = target ? nodeAttributes(target).spid : undefined
  return targetShapeId
    ? {
        ...(objectByNativeId.get(targetShapeId)
          ? { targetObjectId: objectByNativeId.get(targetShapeId) }
          : {}),
        targetShapeId,
      }
    : {}
}

const timingConditions = (
  nodes: OrderedXmlNode[],
  objectByNativeId: Map<string, string>,
): PowerPointTimingCondition[] => {
  const conditions: PowerPointTimingCondition[] = []
  for (const node of nodes) {
    const tag = localName(nodeEntries(node)[0]?.[0] ?? '')
    if (tag === 'cond') {
      const values = nodeAttributes(node)
      const target = timingTarget(childNodes(node), objectByNativeId)
      conditions.push({
        ...(values.delay ? { delay: values.delay } : {}),
        ...(values.evt ? { event: values.evt } : {}),
        ...(values['r:id'] ? { relationshipId: values['r:id'] } : {}),
        ...target,
      })
    }
    conditions.push(...timingConditions(childNodes(node), objectByNativeId))
  }
  return conditions
}

const timingNodeFrom = (
  node: OrderedXmlNode,
  objectByNativeId: Map<string, string>,
): PowerPointTimingNode => {
  const tag = localName(nodeEntries(node)[0]?.[0] ?? '')
  const children = childNodes(node)
  const values = { ...nodeAttributes(node) }
  const conditions = timingConditions(children.filter(child => (
    ['endCondLst', 'stCondLst'].includes(localName(nodeEntries(child)[0]?.[0] ?? ''))
  )), objectByNativeId)
  const target = timingTarget(children, objectByNativeId)
  return {
    attributes: values,
    children: children
      .filter(child => !['bldLst', 'endCondLst', 'stCondLst', 'tgtEl'].includes(
        localName(nodeEntries(child)[0]?.[0] ?? ''),
      ))
      .map(child => timingNodeFrom(child, objectByNativeId)),
    ...(conditions.length ? { conditions } : {}),
    ...(values.id ? { id: values.id } : {}),
    nodeType: tag,
    ...target,
  }
}

const slideTimingFrom = (
  slidePart: string,
  slideNodes: OrderedXmlNode[],
  transition: PowerPointSlideTransition | undefined,
  objects: PowerPointSourceObjectIdentity[],
): PowerPointSlideTiming | undefined => {
  const timing = findFirstNode(slideNodes, 'timing')
  if (!timing && !transition) return undefined
  const objectByNativeId = new Map(objects
    .filter(object => object.partPath === slidePart)
    .map(object => [object.nativeId, object.stableId]))
  const timingChildren = timing ? childNodes(timing) : []
  const builds: PowerPointBuild[] = []
  const buildList = timing ? findFirstNode(timingChildren, 'bldLst') : undefined
  if (buildList) {
    for (const build of childNodes(buildList)) {
      const values = { ...nodeAttributes(build) }
      const targetShapeId = values.spid
      builds.push({
        attributes: values,
        kind: localName(nodeEntries(build)[0]?.[0] ?? ''),
        ...(targetShapeId && objectByNativeId.get(targetShapeId)
          ? { targetObjectId: objectByNativeId.get(targetShapeId) }
          : {}),
        ...(targetShapeId ? { targetShapeId } : {}),
      })
    }
  }
  const timeNodeList = timing ? findFirstNode(timingChildren, 'tnLst') : undefined
  return {
    builds,
    roots: timeNodeList
      ? childNodes(timeNodeList).map(node => timingNodeFrom(node, objectByNativeId))
      : [],
    slidePart,
    ...(transition ? { transition } : {}),
  }
}

const buildDocumentSemantics = async ({
  objects,
  parts,
  presentationNodes,
  readXmlPart,
  relationships,
  slides,
}: {
  objects: PowerPointSourceObjectIdentity[]
  parts: PowerPointPackagePart[]
  presentationNodes: OrderedXmlNode[]
  readXmlPart: (path: string) => Promise<string>
  relationships: PowerPointRelationship[]
  slides: PowerPointSlideDependency[]
}): Promise<PowerPointDocumentSemantics> => {
  const notesMasterParts = parts.filter(part => /^ppt\/notesMasters\/[^/]+\.xml$/i.test(part.path))
  const notesSlideParts = parts.filter(part => /^ppt\/notesSlides\/[^/]+\.xml$/i.test(part.path))
  const notesMasters: PowerPointNotesMaster[] = await Promise.all(notesMasterParts.map(async part => {
    const nodes = parseXml(await readXmlPart(part.path), part.path)
    return {
      objectIds: objects.filter(object => object.partPath === part.path).map(object => object.stableId),
      partPath: part.path,
      placeholders: parseNotesPlaceholders(nodes),
      ...(findInternalTarget(relationships, part.path, 'theme')
        ? { themePart: findInternalTarget(relationships, part.path, 'theme') }
        : {}),
    }
  }))
  const notesSlides: PowerPointNotesSlide[] = []
  for (const part of notesSlideParts) {
    const slidePart = relationships.find(relationship => (
      !relationship.external
      && relationship.sourcePart === part.path
      && relationshipKind(relationship) === 'slide'
    ))?.target ?? slides.find(slide => slide.notesPart === part.path)?.slidePart
    if (!slidePart) continue
    const nodes = parseXml(await readXmlPart(part.path), part.path)
    notesSlides.push({
      ...(findInternalTarget(relationships, part.path, 'notesMaster')
        ? { masterPart: findInternalTarget(relationships, part.path, 'notesMaster') }
        : {}),
      objectIds: objects.filter(object => object.partPath === part.path).map(object => object.stableId),
      partPath: part.path,
      placeholders: parseNotesPlaceholders(nodes),
      slidePart,
    })
  }

  const commentAuthors: PowerPointCommentAuthor[] = []
  const authorParts = parts.filter(part => /(?:commentAuthors|persons)\.xml$/i.test(part.path))
  for (const part of authorParts) {
    const nodes = parseXml(await readXmlPart(part.path), part.path)
    walkXml(nodes, (tag, node) => {
      if (!['author', 'cmAuthor', 'person'].includes(tag)) return
      const values = nodeAttributes(node)
      const id = values.id ?? values.authorId
      if (!id) return
      const lastIndex = Number(values.lastIdx)
      commentAuthors.push({
        id,
        ...(values.initials ? { initials: values.initials } : {}),
        ...(Number.isFinite(lastIndex) ? { lastIndex } : {}),
        ...(values.name || values.displayName ? { name: values.name ?? values.displayName } : {}),
        ...(values.providerId ? { providerId: values.providerId } : {}),
        ...(values.userId ? { userId: values.userId } : {}),
      })
    })
  }

  const comments: PowerPointComment[] = []
  const commentParts = parts.filter(part => /ppt\/(?:comments|modernComments)\//i.test(part.path) && part.path.endsWith('.xml'))
  for (const part of commentParts) {
    const nodes = parseXml(await readXmlPart(part.path), part.path)
    const slidePart = relationships.find(relationship => (
      !relationship.external
      && relationship.target === part.path
      && relationshipKind(relationship).toLowerCase().includes('comment')
    ))?.sourcePart
    const parsedComments: Array<{
      children: OrderedXmlNode[]
      values: Record<string, string>
    }> = []
    walkXml(nodes, (tag, node, children) => {
      if (!['cm', 'comment'].includes(tag)) return
      const values = nodeAttributes(node)
      const id = values.id ?? (values.authorId && values.idx
        ? `${values.authorId}:${values.idx}`
        : values.idx)
      if (!id) return
      parsedComments.push({ children, values })
    })
    const idByAuthorAndIndex = new Map(parsedComments.flatMap(({ values }) => {
      const id = values.id ?? (values.authorId && values.idx
        ? `${values.authorId}:${values.idx}`
        : values.idx)
      return values.authorId && values.idx && id
        ? [[`${values.authorId}\0${values.idx}`, id] as const]
        : []
    }))
    for (const { children, values } of parsedComments) {
      const id = values.id ?? (values.authorId && values.idx
        ? `${values.authorId}:${values.idx}`
        : values.idx)
      if (!id) continue
      const position = findFirstNode(children, 'pos')
      const positionValues = position ? nodeAttributes(position) : {}
      const x = Number(positionValues.x)
      const y = Number(positionValues.y)
      const textNode = findFirstNode(children, 'text') ?? findFirstNode(children, 't')
      const parent = findFirstNode(children, 'parentCm')
      const parentValues = parent ? nodeAttributes(parent) : {}
      const threadedParentId = parentValues.authorId && parentValues.idx
        ? idByAuthorAndIndex.get(`${parentValues.authorId}\0${parentValues.idx}`)
        : undefined
      comments.push({
        ...(values.authorId ? { authorId: values.authorId } : {}),
        ...(values.dt || values.created ? { createdAt: values.dt ?? values.created } : {}),
        id,
        ...(values.parentId || threadedParentId ? { parentId: values.parentId ?? threadedParentId } : {}),
        partPath: part.path,
        ...(Number.isFinite(x) && Number.isFinite(y) ? { position: { x, y } } : {}),
        ...(slidePart ? { slidePart } : {}),
        ...(values.status ? { status: values.status } : {}),
        text: textNode ? descendantText(childNodes(textNode)) : descendantText(children),
      })
    }
  }

  const timings: PowerPointSlideTiming[] = []
  for (const slide of slides) {
    const slideNodes = parseXml(await readXmlPart(slide.slidePart), slide.slidePart)
    let transition = transitionFrom(slideNodes, 'slide')
    if (!transition && slide.layoutPart) {
      transition = transitionFrom(parseXml(await readXmlPart(slide.layoutPart), slide.layoutPart), 'layout')
    }
    if (!transition && slide.masterPart) {
      transition = transitionFrom(parseXml(await readXmlPart(slide.masterPart), slide.masterPart), 'master')
    }
    const timing = slideTimingFrom(slide.slidePart, slideNodes, transition, objects)
    if (timing) timings.push(timing)
  }
  return {
    commentAuthors,
    comments,
    customShows: parseCustomShows(presentationNodes),
    notesMasters,
    notesSlides,
    properties: parsePresentationProperties(presentationNodes),
    sections: parseSections(presentationNodes),
    timings,
  }
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
  const document = await buildDocumentSemantics({
    objects,
    parts,
    presentationNodes: parseXml(presentationXml, 'ppt/presentation.xml'),
    readXmlPart,
    relationships,
    slides: slideDependencies,
  })
  const slides = slideDependencies.map(slide => ({
    ...slide,
    layoutId: slide.layoutPart ? stablePartId(packageId, slide.layoutPart) : undefined,
    masterId: slide.masterPart ? stablePartId(packageId, slide.masterPart) : undefined,
    themeId: slide.themePart ? stablePartId(packageId, slide.themePart) : undefined,
  }))
  const reference: PowerPointPackageReference = {
    byteLength: sourceCopy.byteLength,
    document,
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
