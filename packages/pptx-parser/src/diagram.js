import { readXmlFile } from './readXmlFile'
import { getTextNodeValue } from './text'
import { getTextByPathList, resolvePackageTarget } from './utils'

export async function loadDiagramFile(warpObj, filename, transformDrawing = false) {
  if (!filename) return null

  const cacheKey = `${transformDrawing ? 'drawing:' : 'xml:'}${filename}`
  if (warpObj.diagramFileCache[cacheKey]) return warpObj.diagramFileCache[cacheKey]

  let content = await readXmlFile(warpObj['zip'], filename)
  if (content && transformDrawing) {
    const contentStr = JSON.stringify(content).replace(/dsp:/g, 'p:')
    content = JSON.parse(contentStr)
  }

  warpObj.diagramFileCache[cacheKey] = content
  return content
}

export function getDiagramDrawingRelId(dataContent) {
  let extNodes = getTextByPathList(dataContent, ['dgm:dataModel', 'dgm:extLst', 'a:ext'])
  if (!extNodes) return ''

  if (!Array.isArray(extNodes)) extNodes = [extNodes]
  for (const extNode of extNodes) {
    const relId = getTextByPathList(extNode, ['dsp:dataModelExt', 'attrs', 'relId'])
    if (relId) return relId
  }

  return ''
}

async function loadPartRelationships(warpObj, sourcePart) {
  if (!sourcePart) return {}
  const parts = sourcePart.split('/')
  const fileName = parts.pop()
  const relationshipPart = [...parts, '_rels', `${fileName}.rels`].join('/')
  const content = await readXmlFile(warpObj['zip'], relationshipPart)
  let relationships = getTextByPathList(content, ['Relationships', 'Relationship'])
  if (!relationships) return {}
  if (!Array.isArray(relationships)) relationships = [relationships]
  return Object.fromEntries(relationships.map(relationship => [
    relationship.attrs.Id,
    {
      target: relationship.attrs.TargetMode === 'External'
        ? relationship.attrs.Target
        : resolvePackageTarget(sourcePart, relationship.attrs.Target),
      type: relationship.attrs.Type,
    },
  ]))
}

export async function getDiagramNodeContext(node, warpObj, source = 'slide') {
  const relIds = getTextByPathList(node, ['a:graphic', 'a:graphicData', 'dgm:relIds', 'attrs']) || {}
  const diagramContent = {
    data: null,
    layout: null,
    quickStyle: null,
    colors: null,
    drawing: null,
  }
  let digramFileContent = {}
  const diagramResObj = {}

  const sourceRelationships = source === 'slideLayoutBg'
    ? warpObj.layoutResObj
    : source === 'slideMasterBg'
      ? warpObj.masterResObj
      : warpObj.slideResObj
  const diagramDataTarget = getTextByPathList(sourceRelationships, [relIds['r:dm'], 'target'])
  const diagramLayoutTarget = getTextByPathList(sourceRelationships, [relIds['r:lo'], 'target'])
  const diagramQuickStyleTarget = getTextByPathList(sourceRelationships, [relIds['r:qs'], 'target'])
  const diagramColorsTarget = getTextByPathList(sourceRelationships, [relIds['r:cs'], 'target'])

  if (diagramDataTarget) diagramContent.data = await loadDiagramFile(warpObj, diagramDataTarget)
  if (diagramLayoutTarget) diagramContent.layout = await loadDiagramFile(warpObj, diagramLayoutTarget)
  if (diagramQuickStyleTarget) diagramContent.quickStyle = await loadDiagramFile(warpObj, diagramQuickStyleTarget)
  if (diagramColorsTarget) diagramContent.colors = await loadDiagramFile(warpObj, diagramColorsTarget)

  const drawingRelId = diagramContent.data ? getDiagramDrawingRelId(diagramContent.data) : ''
  const dataRelationships = await loadPartRelationships(warpObj, diagramDataTarget)
  const drawingTarget = getTextByPathList(dataRelationships, [drawingRelId, 'target'])
    || getTextByPathList(sourceRelationships, [drawingRelId, 'target'])

  if (drawingTarget) {
    digramFileContent = await loadDiagramFile(warpObj, drawingTarget, true) || {}
    diagramContent.drawing = digramFileContent

    const drawingName = drawingTarget.split('/').pop()
    const diagramResFileName = drawingTarget.replace(drawingName, '_rels/' + drawingName) + '.rels'
    const digramResContent = await readXmlFile(warpObj['zip'], diagramResFileName)
    if (digramResContent) {
      let relationshipArray = digramResContent['Relationships']['Relationship']
      if (relationshipArray && relationshipArray.constructor !== Array) relationshipArray = [relationshipArray]
      if (relationshipArray) {
        for (const relationshipArrayItem of relationshipArray) {
          const relTarget = relationshipArrayItem['attrs']['TargetMode'] === 'External'
            ? relationshipArrayItem['attrs']['Target']
            : resolvePackageTarget(drawingTarget, relationshipArrayItem['attrs']['Target'])

          diagramResObj[relationshipArrayItem['attrs']['Id']] = {
            type: relationshipArrayItem['attrs']['Type'].replace('http://schemas.openxmlformats.org/officeDocument/2006/relationships/', ''),
            target: relTarget,
          }
        }
      }
    }
  }

  return {
    ...warpObj,
    digramFileContent,
    diagramResObj,
    diagramContent,
    sourceParts: {
      ...warpObj.sourceParts,
      ...(drawingTarget ? { diagramBg: drawingTarget } : {}),
    },
  }
}

export function getSmartArtTextData(dataContent) {
  const result = []

  let ptLst = getTextByPathList(dataContent, ['dgm:dataModel', 'dgm:ptLst', 'dgm:pt'])

  if (!ptLst) return result
  if (!Array.isArray(ptLst)) ptLst = [ptLst]

  for (const pt of ptLst) {
    const textBody = getTextByPathList(pt, ['dgm:t'])

    if (textBody) {
      let nodeText = ''

      let paragraphs = getTextByPathList(textBody, ['a:p'])
      if (paragraphs) {
        if (!Array.isArray(paragraphs)) paragraphs = [paragraphs]

        paragraphs.forEach(p => {
          let runs = getTextByPathList(p, ['a:r'])
          if (runs) {
            if (!Array.isArray(runs)) runs = [runs]

            runs.forEach(r => {
              const t = getTextNodeValue(getTextByPathList(r, ['a:t']))
              if (t && typeof t === 'string') nodeText += t
            })
          }
          if (nodeText.length > 0) nodeText += '\n'
        })
      }

      const cleanText = nodeText.trim()
      if (cleanText) {
        result.push(cleanText)
      }
    }
  }

  return result
}
