import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { SHAPE_PATH_FORMULAS } from '@mona/presentation-core/shape-path-formulas'
import type { PPTElement, PPTImageElement, PPTLineElement } from '@mona/presentation-core/model'

interface VueParityState {
  presentation: {
    slides: Array<{ id: string; elements: PPTElement[] }>
    slideIndex: number
    viewportRatio: number
    viewportSize: number
  }
  editor: {
    canvasScale: number
    canvasPercentage: number
    canvasDragged: boolean
    editorAreaFocus: boolean
    activeElementIdList: string[]
    activeGroupElementId: string
    gridLineSize: number
    handleElementId: string
    showRuler: boolean
    showBubbleMenu: boolean
    thumbnailsFocus: boolean
    selectedSlidesIndex: number[]
    creatingElement: { type: string } | null
    disableHotkeys: boolean
  }
  history: {
    snapshotCursor: number
    snapshotLength: number
  }
}

interface ReactParityState {
  presentation: VueParityState['presentation']
  session: {
    activeTool: string | null
    activeElementIds: string[]
    activeGroupElementId: string | null
    canvasDragged: boolean
    canvasFocus: boolean
    canvasPan: { x: number; y: number }
    canvasZoom: number
    gridLineSize: number
    handleElementId: string | null
    showRuler: boolean
    showBubbleMenu: boolean
    thumbnailsFocus: boolean
    selectedSlideIndexes: number[]
    disableHotkeys: boolean
  }
}

declare global {
  interface Window {
    __MONA_TEST__?: {
      getState: () => VueParityState
    }
    __MONA_REACT_TEST__?: {
      getHistoryState: () => { cursor: number; length: number }
      getState: () => ReactParityState
    }
  }
}

const fixturePath = '/?rendererFixture=gate4-editor'

function expectRasterParity(
  actual: Buffer,
  expected: Buffer,
  limits: { ignoredCornerRadius?: number; maxChannelDelta: number; maxExactPixelDelta: number; perceptualThreshold: number },
) {
  const actualImage = PNG.sync.read(actual)
  const expectedImage = PNG.sync.read(expected)
  expect(actualImage.width).toBe(expectedImage.width)
  expect(actualImage.height).toBe(expectedImage.height)

  const comparedActual = Uint8Array.from(actualImage.data)
  let exactPixelDelta = 0
  let maxChannelDelta = 0
  const ignoredCornerRadius = limits.ignoredCornerRadius ?? 0
  for (let y = 0; y < actualImage.height; y += 1) {
    for (let x = 0; x < actualImage.width; x += 1) {
      const offset = (y * actualImage.width + x) * 4
      const ignoredCorner = ignoredCornerRadius > 0 &&
        (x < ignoredCornerRadius || x >= actualImage.width - ignoredCornerRadius) &&
        (y < ignoredCornerRadius || y >= actualImage.height - ignoredCornerRadius)
      if (ignoredCorner) {
        for (let channel = 0; channel < 4; channel += 1) comparedActual[offset + channel] = expectedImage.data[offset + channel]!
        continue
      }
      let pixelChanged = false
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(actualImage.data[offset + channel]! - expectedImage.data[offset + channel]!)
        if (delta) pixelChanged = true
        maxChannelDelta = Math.max(maxChannelDelta, delta)
      }
      if (pixelChanged) exactPixelDelta += 1
    }
  }

  expect(exactPixelDelta).toBeLessThanOrEqual(limits.maxExactPixelDelta)
  expect(maxChannelDelta).toBeLessThanOrEqual(limits.maxChannelDelta)
  expect(pixelmatch(
    comparedActual,
    expectedImage.data,
    null,
    actualImage.width,
    actualImage.height,
    { includeAA: true, threshold: limits.perceptualThreshold },
  )).toBe(0)
}

async function openEditors(context: BrowserContext) {
  await context.addInitScript(() => localStorage.setItem('mona:ui-locale', 'en-US'))
  const vue = await context.newPage()
  const react = await context.newPage()
  await Promise.all([
    vue.goto(`http://127.0.0.1:5173${fixturePath}`),
    react.goto(`http://127.0.0.1:5174${fixturePath}`),
  ])
  await expect(vue.locator('.pptist-editor')).toBeVisible()
  await expect(react.getByRole('application', { name: 'Editable slide canvas' })).toBeVisible()
  await vue.waitForFunction(() => window.__MONA_TEST__?.getState().presentation.slides.length === 7)
  await react.waitForFunction(() => window.__MONA_REACT_TEST__?.getState().presentation.slides.length === 7)
  return { react, vue }
}

async function getVueState(page: Page) {
  return page.evaluate(() => window.__MONA_TEST__!.getState())
}

async function getReactState(page: Page) {
  return page.evaluate(() => window.__MONA_REACT_TEST__!.getState())
}

async function getReactHistory(page: Page) {
  return page.evaluate(() => window.__MONA_REACT_TEST__!.getHistoryState())
}

async function getVueHistory(page: Page) {
  const history = (await getVueState(page)).history
  return { cursor: history.snapshotCursor, length: history.snapshotLength }
}

async function pressBoth(vue: Page, react: Page, key: string, count = 1) {
  for (let index = 0; index < count; index += 1) {
    await Promise.all([vue.keyboard.press(key), react.keyboard.press(key)])
  }
}

async function dispatchSynchronousTextPaste(page: Page, app: 'react' | 'vue', value: string) {
  return page.evaluate(({ app, value }) => {
    const clipboardData = {
      items: [{
        getAsString: (callback: (text: string) => void) => callback(value),
        kind: 'string',
        type: 'text/plain',
      }],
      getData: (type: string) => type === 'text/plain' ? value : '',
    }
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: clipboardData })
    document.dispatchEvent(event)
    const state = app === 'vue' ? window.__MONA_TEST__!.getState() : window.__MONA_REACT_TEST__!.getState()
    const selectedIds = app === 'vue'
      ? (state as VueParityState).editor.activeElementIdList
      : (state as ReactParityState).session.activeElementIds
    const slide = state.presentation.slides[state.presentation.slideIndex]!
    return {
      defaultPrevented: event.defaultPrevented,
      element: structuredClone(slide.elements.find(element => selectedIds.includes(element.id))!),
    }
  }, { app, value })
}

async function openCanvasContextMenus(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas').click({ button: 'right', position: { x: 40, y: 40 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({
      button: 'right',
      position: { x: 40, y: 40 },
    }),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.getByRole('menu', { name: 'Canvas menu' })).toBeVisible(),
  ])
}

async function openElementContextMenus(
  vueTarget: ReturnType<Page['locator']>,
  reactTarget: ReturnType<Page['locator']>,
) {
  await Promise.all([
    vueTarget.click({ button: 'right' }),
    reactTarget.click({ button: 'right' }),
  ])
  await Promise.all([
    expect(vueTarget.page().locator('.contextmenu')).toBeVisible(),
    expect(reactTarget.page().getByRole('menu', { name: 'Element menu' })).toBeVisible(),
  ])
}

async function openLineContextMenus(vue: Page, reactTarget: ReturnType<Page['locator']>, id: string) {
  const point = await vue.locator(`#editable-element-${id} .line-path`).evaluate(element => {
    const path = element as SVGPathElement
    const local = path.getPointAtLength(path.getTotalLength() * 0.35)
    const screen = local.matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await Promise.all([
    vue.mouse.click(point.x, point.y, { button: 'right' }),
    reactTarget.click({ button: 'right' }),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(reactTarget.page().getByRole('menu', { name: 'Element menu' })).toBeVisible(),
  ])
}

async function clickElementMenuAction(
  vue: Page,
  react: Page,
  input: { parentLabel?: string; reactAction: string; reactParentAction?: string; vueLabel: string },
) {
  if (input.parentLabel) {
    const vueParent = vue.locator('.contextmenu > .menu-content > .menu-item').filter({
      has: vue.locator(':scope > .menu-item-content > .text', { hasText: new RegExp(`^${input.parentLabel}$`) }),
    })
    const reactParent = react.locator(`.mona-editor-context-menu > .mona-context-menu-content > [data-action="${input.reactParentAction}"]`)
    await Promise.all([
      vueParent.hover(),
      reactParent.hover(),
    ])
    const vueChild = vueParent.locator('.sub-menu > .menu-item').filter({
      has: vue.locator(':scope > .menu-item-content > .text', { hasText: new RegExp(`^${input.vueLabel}$`) }),
    })
    await Promise.all([
      vueChild.click(),
      reactParent.locator(`.mona-editor-context-submenu [data-action="${input.reactAction}"]`).click(),
    ])
    return
  }
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({
      has: vue.locator(':scope > .menu-item-content > .text', { hasText: new RegExp(`^${input.vueLabel}$`) }),
    }).click(),
    react.locator(`.mona-editor-context-menu [data-action="${input.reactAction}"]`).first().click(),
  ])
}

async function setRulerVisible(vue: Page, react: Page) {
  await Promise.all([
    vue.locator('.canvas').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 400,
    }))),
    react.getByRole('application', { name: 'Editable slide canvas' }).evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 400,
      clientY: 400,
    }))),
  ])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.getByRole('menu', { name: 'Canvas menu' })).toBeVisible(),
  ])
  await Promise.all([
    vue.locator('.contextmenu .menu-item').filter({ hasText: /^Ruler$/ }).click(),
    react.getByRole('menuitem', { name: 'Ruler' }).click(),
  ])
}

async function setGridSize(vue: Page, react: Page, size: 0 | 25 | 50 | 100) {
  await openCanvasContextMenus(vue, react)
  const vueGrid = vue.locator('.contextmenu .menu-item').filter({ has: vue.locator('.text', { hasText: /^Grid lines$/ }) }).first()
  const reactGrid = react.getByRole('menuitem', { name: 'Grid lines' })
  if (size === 50) {
    await Promise.all([vueGrid.click(), reactGrid.click()])
    return
  }
  await Promise.all([vueGrid.hover(), reactGrid.hover()])
  const labels = { 0: 'None', 25: 'Small', 100: 'Large' } as const
  await Promise.all([
    vueGrid.locator('.sub-menu .menu-item').filter({ hasText: new RegExp(`^${labels[size]}$`) }).click(),
    react.getByRole('menuitem', { name: labels[size] }).click(),
  ])
}

function normalizedSlides(presentation: VueParityState['presentation']) {
  return presentation.slides.map(slide => ({
    id: slide.id,
    elements: slide.elements.map(element => ({ id: element.id, type: element.type })),
  }))
}

function normalizeGeneratedGroups(elements: readonly PPTElement[]) {
  const knownGroups = new Set(['gate3-heading-group', 'gate4-common-rotation-group', 'gate4-line-rotation-group', 'gate4-blocked-rotation-group'])
  const generated = new Map<string, string>()
  return elements.map(element => {
    const copy = structuredClone(element)
    if (copy.groupId && !knownGroups.has(copy.groupId)) {
      if (!generated.has(copy.groupId)) generated.set(copy.groupId, `generated-group-${generated.size + 1}`)
      copy.groupId = generated.get(copy.groupId)
    }
    return copy
  })
}

function normalizedVueSelection(state: VueParityState) {
  return {
    activeElementIds: [...state.editor.activeElementIdList].sort(),
    activeGroupElementId: state.editor.activeGroupElementId || null,
    handleElementId: state.editor.handleElementId || null,
  }
}

function normalizedReactSelection(state: ReactParityState) {
  return {
    activeElementIds: [...state.session.activeElementIds].sort(),
    activeGroupElementId: state.session.activeGroupElementId,
    handleElementId: state.session.handleElementId,
  }
}

function pickElement(state: VueParityState | ReactParityState, slideIndex: number, elementId: string) {
  return structuredClone(state.presentation.slides[slideIndex]!.elements.find(element => element.id === elementId)!)
}

async function dragBySlideDelta(
  page: Page,
  handle: ReturnType<Page['locator']>,
  slide: ReturnType<Page['locator']>,
  delta: { x: number; y: number },
  anchor = { x: 0.5, y: 0.5 },
) {
  const [handleBox, scale] = await Promise.all([
    handle.boundingBox(),
    slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
  ])
  expect(handleBox).not.toBeNull()
  const start = { x: handleBox!.x + handleBox!.width * anchor.x, y: handleBox!.y + handleBox!.height * anchor.y }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x * scale, start.y + delta.y * scale)
  await page.mouse.up()
}

async function movePointerByScreenPixels(
  page: Page,
  target: ReturnType<Page['locator']>,
  delta: { x: number; y: number },
  modifiers: { control?: boolean; meta?: boolean } = {},
) {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  if (modifiers.control) await page.keyboard.down('Control')
  if (modifiers.meta) await page.keyboard.down('Meta')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x, start.y + delta.y)
  await page.mouse.up()
  if (modifiers.control) await page.keyboard.up('Control')
  if (modifiers.meta) await page.keyboard.up('Meta')
}

async function beginDragBySlideDelta(
  page: Page,
  target: ReturnType<Page['locator']>,
  slide: ReturnType<Page['locator']>,
  delta: { x: number; y: number },
  anchor = { x: 0.5, y: 0.5 },
) {
  const [targetBox, scale] = await Promise.all([
    target.boundingBox(),
    slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
  ])
  expect(targetBox).not.toBeNull()
  const start = {
    x: targetBox!.x + targetBox!.width * anchor.x,
    y: targetBox!.y + targetBox!.height * anchor.y,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta.x * scale, start.y + delta.y * scale)
  return { scale, start }
}

function elementWithoutGeneratedIdentity(element: PPTElement) {
  const copy = structuredClone(element) as PPTElement & { groupId?: string }
  delete copy.id
  delete copy.groupId
  // Equivalent arithmetic sequences in the two frameworks can differ at the
  // final IEEE-754 bit (for example 76.86824693835112 vs ...119). Preserve
  // nine decimal places so this helper ignores only sub-nanopixel noise.
  copy.left = Number(copy.left.toFixed(9))
  copy.top = Number(copy.top.toFixed(9))
  return copy
}

function slideWithoutGeneratedIdentity(slide: VueParityState['presentation']['slides'][number]) {
  const copy = structuredClone(slide) as VueParityState['presentation']['slides'][number] & {
    animations?: Array<{ duration: number; effect: string; elId: string; id: string; trigger: string; type: string }>
  }
  delete (copy as { id?: string }).id
  copy.elements = copy.elements.map(element => {
    const normalized = elementWithoutGeneratedIdentity(element)
    if (normalized.link?.type === 'slide') normalized.link = { ...normalized.link, target: '__slide__' }
    return normalized
  })
  if (copy.animations) {
    copy.animations = copy.animations.map(animation => ({
      ...animation,
      elId: '__element__',
      id: '__animation__',
    }))
  }
  return copy
}

async function normalizedVisualRect(
  target: ReturnType<Page['locator']>,
  slide: ReturnType<Page['locator']>,
) {
  const [targetBox, slideBox, scale] = await Promise.all([
    target.boundingBox(),
    slide.boundingBox(),
    slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
  ])
  expect(targetBox).not.toBeNull()
  expect(slideBox).not.toBeNull()
  return {
    height: targetBox!.height / scale,
    left: (targetBox!.x - slideBox!.x) / scale,
    top: (targetBox!.y - slideBox!.y) / scale,
    width: targetBox!.width / scale,
  }
}

const vueResizeHandleClass: Readonly<Record<string, string>> = {
  'top-left': 'left-top',
  top: 'top',
  'top-right': 'right-top',
  right: 'right',
  'bottom-right': 'right-bottom',
  bottom: 'bottom',
  'bottom-left': 'left-bottom',
  left: 'left',
}

function vueElement(page: Page, id: string, type: PPTElement['type']) {
  return page.locator(type === 'line'
    ? `#editable-element-${id} .line-point`
    : `#editable-element-${id} .editable-element-${type}`)
}

function reactElement(page: Page, id: string, type: PPTElement['type']) {
  return type === 'text'
    ? page.locator(`.mona-editor-slide-canvas [data-element-id="${id}"] .mona-text-content`)
    : page.getByRole('button', { name: `Select ${type} ${id}` })
}

async function selectVueLine(page: Page, id: string) {
  const point = await vueElement(page, id, 'line').evaluate(element => {
    const path = element as SVGPathElement
    const local = path.getPointAtLength(path.getTotalLength() * 0.35)
    const screen = local.matrixTransform(path.getScreenCTM()!)
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(point.x, point.y)
}

function vueResizeHandle(page: Page, type: Exclude<PPTElement['type'], 'line'>, handle: string) {
  return page.locator(`.${vueOperateClass(type)}-element-operate .operate-resize-handler.${vueResizeHandleClass[handle]}`)
}

function reactResizeHandle(page: Page, handle: string) {
  return page.locator(`.mona-selection-frame:not(.is-secondary) .mona-transform-handle[data-handle="${handle}"]`)
}

function vueMultiResizeHandle(page: Page, handle: string) {
  return page.locator(`.multi-select-operate > .resize-handler.${vueResizeHandleClass[handle]}`)
}

function vueOperateClass(type: Exclude<PPTElement['type'], 'line'>) {
  return ['chart', 'latex', 'video', 'audio'].includes(type) ? 'common' : type
}

function expectResizeElementParity(reactElement: PPTElement, vueElementState: PPTElement, label = reactElement.id) {
  const geometryKeys = ['left', 'top', 'width', 'height', 'cellMinHeight'] as const
  const reactCopy = structuredClone(reactElement) as PPTElement & Record<string, unknown>
  const vueCopy = structuredClone(vueElementState) as PPTElement & Record<string, unknown>
  if (
    reactElement.type === 'shape' && vueElementState.type === 'shape' &&
    reactElement.pathFormula && vueElementState.pathFormula && reactElement.path !== vueElementState.path
  ) {
    const reactFormula = SHAPE_PATH_FORMULAS[reactElement.pathFormula]
    const vueFormula = SHAPE_PATH_FORMULAS[vueElementState.pathFormula]
    expect(reactElement.path).toBe(reactFormula.formula(reactElement.width, reactElement.height, reactElement.keypoints))
    expect(vueElementState.path).toBe(vueFormula.formula(vueElementState.width, vueElementState.height, vueElementState.keypoints))
    expect(reactElement.viewBox).toEqual([reactElement.width, reactElement.height])
    expect(vueElementState.viewBox).toEqual([vueElementState.width, vueElementState.height])
    delete reactCopy.path
    delete vueCopy.path
    delete reactCopy.viewBox
    delete vueCopy.viewBox
  }
  for (const key of geometryKeys) {
    const reactValue = reactCopy[key]
    const vueValue = vueCopy[key]
    delete reactCopy[key]
    delete vueCopy[key]
    if (typeof reactValue === 'number' || typeof vueValue === 'number') {
      expect(typeof reactValue).toBe('number')
      expect(typeof vueValue).toBe('number')
      expect(
        Math.abs((reactValue as number) - (vueValue as number)),
        `${label}.${key}: React ${reactValue} vs Vue ${vueValue}`,
      // Vue's document-level MouseEvent handlers receive integer pageX/pageY,
      // while React's PointerEvent path preserves fractional coordinates. At
      // the minimum parity viewport scale one legacy input pixel is < 1.1
      // slide units. Everything not derived from that input remains exact.
      ).toBeLessThan(1.1)
    }
  }
  expect(reactCopy).toEqual(vueCopy)
}

function expectLineParity(reactLine: PPTLineElement, vueLine: PPTLineElement, label = reactLine.id) {
  const pointKeys = ['start', 'end', 'broken', 'broken2', 'curve'] as const
  const reactCopy = structuredClone(reactLine) as PPTLineElement & Record<string, unknown>
  const vueCopy = structuredClone(vueLine) as PPTLineElement & Record<string, unknown>
  for (const key of ['left', 'top'] as const) {
    expect(Math.abs(reactLine[key] - vueLine[key]), `${label}.${key}`).toBeLessThan(1.1)
    delete reactCopy[key]
    delete vueCopy[key]
  }
  for (const key of pointKeys) {
    const reactPoint = reactLine[key]
    const vuePoint = vueLine[key]
    if (reactPoint || vuePoint) {
      expect(reactPoint).toBeDefined()
      expect(vuePoint).toBeDefined()
      for (let index = 0; index < 2; index += 1) {
        expect(
          Math.abs(reactPoint![index] - vuePoint![index]),
          `${label}.${key}.${index}`,
        ).toBeLessThan(1.1)
      }
    }
    delete reactCopy[key]
    delete vueCopy[key]
  }
  if (reactLine.cubic || vueLine.cubic) {
    expect(reactLine.cubic).toBeDefined()
    expect(vueLine.cubic).toBeDefined()
    for (let point = 0; point < 2; point += 1) {
      for (let axis = 0; axis < 2; axis += 1) {
        expect(
          Math.abs(reactLine.cubic![point][axis] - vueLine.cubic![point][axis]),
          `${label}.cubic.${point}.${axis}`,
        ).toBeLessThan(1.1)
      }
    }
  }
  delete reactCopy.cubic
  delete vueCopy.cubic
  expect(reactCopy).toEqual(vueCopy)
}

function expectRotationElementParity(reactElement: PPTElement, vueElementState: PPTElement, label = reactElement.id) {
  if (reactElement.type === 'line' && vueElementState.type === 'line') {
    expectLineParity(reactElement, vueElementState, label)
    return
  }
  expect(reactElement.type).toBe(vueElementState.type)
  if (reactElement.type === 'line' || vueElementState.type === 'line') return
  const reactCopy = structuredClone(reactElement) as PPTElement & Record<string, unknown>
  const vueCopy = structuredClone(vueElementState) as PPTElement & Record<string, unknown>
  for (const key of ['left', 'top', 'rotate'] as const) {
    expect(
      Math.abs(reactElement[key] - vueElementState[key]),
      `${label}.${key}: React ${reactElement[key]} vs Vue ${vueElementState[key]}`,
    ).toBeLessThan(1.1)
    delete reactCopy[key]
    delete vueCopy[key]
  }
  expect(reactCopy).toEqual(vueCopy)
}

function rotateModelPoint(point: { x: number; y: number }, center: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180
  const x = point.x - center.x
  const y = point.y - center.y
  return {
    x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
  }
}

function rotationCenter(elements: PPTElement[], reference = 0) {
  const points = elements.flatMap(element => {
    if (element.type === 'line') {
      return [
        { x: element.left + element.start[0], y: element.top + element.start[1] },
        { x: element.left + element.end[0], y: element.top + element.end[1] },
      ]
    }
    const center = { x: element.left + element.width / 2, y: element.top + element.height / 2 }
    return [
      { x: element.left, y: element.top },
      { x: element.left + element.width, y: element.top },
      { x: element.left + element.width, y: element.top + element.height },
      { x: element.left, y: element.top + element.height },
    ].map(point => rotateModelPoint(point, center, element.rotate))
  }).map(point => reference ? rotateModelPoint(point, { x: 0, y: 0 }, -reference) : point)
  const center = {
    x: (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2,
    y: (Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2,
  }
  return reference ? rotateModelPoint(center, { x: 0, y: 0 }, reference) : center
}

async function rotateToPointerAngle(
  page: Page,
  handle: ReturnType<Page['locator']>,
  slide: ReturnType<Page['locator']>,
  center: { x: number; y: number },
  input: { absoluteAngle?: number; deltaAngle?: number },
) {
  const [box, slideBox, scale] = await Promise.all([
    handle.boundingBox(),
    slide.boundingBox(),
    slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
  ])
  expect(box).not.toBeNull()
  expect(slideBox).not.toBeNull()
  const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
  const startSlide = { x: (start.x - slideBox!.x) / scale, y: (start.y - slideBox!.y) / scale }
  const startAngle = Math.atan2(startSlide.y - center.y, startSlide.x - center.x) * 180 / Math.PI + 90
  const targetAngle = input.absoluteAngle ?? startAngle + input.deltaAngle!
  const radius = Math.max(180, Math.hypot(startSlide.x - center.x, startSlide.y - center.y))
  const radians = targetAngle * Math.PI / 180
  const target = {
    x: slideBox!.x + (center.x + Math.sin(radians) * radius) * scale,
    y: slideBox!.y + (center.y - Math.cos(radians) * radius) * scale,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y)
  await page.mouse.up()
}

async function clickBottomRight(page: Page, target: ReturnType<Page['locator']>) {
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width - 10, box!.y + box!.height - 10)
}

async function dragLasso(
  page: Page,
  canvas: ReturnType<Page['locator']>,
  start: { x: number; y: number },
  end: { x: number; y: number },
  options: { holdMetaBeforeRelease?: boolean; release?: boolean } = {},
) {
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  const scale = await canvas.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a)
  const point = (value: { x: number; y: number }) => ({
    x: box!.x + value.x * scale,
    y: box!.y + value.y * scale,
  })
  const from = point(start)
  const to = point(end)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 3 })
  if (options.holdMetaBeforeRelease) await page.keyboard.down('Meta')
  if (options.release ?? true) {
    await page.mouse.up()
    if (options.holdMetaBeforeRelease) await page.keyboard.up('Meta')
  }
}

test('loads one identical Gate 4 document into both editors', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])

  expect(normalizedSlides(reactState.presentation)).toEqual(normalizedSlides(vueState.presentation))
  expect(reactState.presentation.slideIndex).toBe(vueState.presentation.slideIndex)
  expect(reactState.presentation.viewportSize).toBe(vueState.presentation.viewportSize)
  expect(reactState.presentation.viewportRatio).toBe(vueState.presentation.viewportRatio)
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
  await context.close()
})

test('matches single-shape controls, group selection, and active group-member state', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueSingle = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactSingle = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([vueSingle.click(), reactSingle.click()])

  await expect(vue.locator('.shape-element-operate .operate-resize-handler')).toHaveCount(8)
  await expect(react.locator('.mona-selection-frame .mona-transform-handle')).toHaveCount(8)
  await expect(vue.locator('.shape-element-operate .operate-rotate-handler')).toHaveCount(1)
  await expect(react.locator('.mona-selection-frame .mona-rotate-handle')).toHaveCount(1)
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))

  const vueGrouped = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const reactGrouped = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await Promise.all([vueGrouped.click(), reactGrouped.click()])
  await expect(vue.locator('.multi-select-operate .resize-handler')).toHaveCount(0)
  await expect(react.locator('.mona-selection-frame:not(.is-secondary) .mona-transform-handle')).toHaveCount(0)
  await expect(vue.locator('.multi-select-operate .rotate-handler')).toHaveCount(1)
  await expect(react.locator('.mona-selection-frame:not(.is-secondary) .mona-rotate-handle')).toHaveCount(1)
  await expect(vue.locator('.operate:has(.operate-border-line)')).toHaveCount(2)
  await expect(vue.locator('.operate.multi-select:has(.operate-border-line)')).toHaveCount(1)
  await expect(react.locator('.mona-selection-frame.is-secondary')).toHaveCount(2)
  await expect(react.locator('.mona-selection-frame.is-secondary.is-handle-element')).toHaveCount(1)
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))

  await Promise.all([vueGrouped.click(), reactGrouped.click()])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
  expect(normalizedReactSelection(reactState).activeGroupElementId).toBe('gate3-gradient-shape')
  await context.close()
})

test('matches the full click/additive/group/locked selection state machine and focus clearing', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueRadial = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactRadial = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  const vuePattern = vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape')
  const reactPattern = react.getByRole('button', { name: 'Select shape gate3-pattern-shape' })
  const assertSelectionParity = async () => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    return normalizedReactSelection(reactState)
  }

  await Promise.all([vueRadial.click(), reactRadial.click()])
  expect(await assertSelectionParity()).toEqual({
    activeElementIds: ['gate3-radial-shape'],
    activeGroupElementId: null,
    handleElementId: 'gate3-radial-shape',
  })
  await Promise.all([
    vuePattern.click({ modifiers: ['Shift'] }),
    reactPattern.click({ modifiers: ['Shift'] }),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual(['gate3-pattern-shape', 'gate3-radial-shape'])
  await Promise.all([
    vuePattern.click({ modifiers: ['Shift'] }),
    reactPattern.click({ modifiers: ['Shift'] }),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual(['gate3-radial-shape'])
  await Promise.all([
    vueRadial.click({ modifiers: ['Shift'] }),
    reactRadial.click({ modifiers: ['Shift'] }),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual(['gate3-radial-shape'])

  await Promise.all([
    vuePattern.click({ modifiers: ['Meta'] }),
    reactPattern.click({ modifiers: ['Meta'] }),
  ])
  await Promise.all([
    movePointerByScreenPixels(vue, vueRadial, { x: 0, y: 0 }, { meta: true }),
    movePointerByScreenPixels(react, reactRadial, { x: 0, y: 0 }, { meta: true }),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual(['gate3-pattern-shape'])
  await Promise.all([vueRadial.click(), reactRadial.click()])
  await Promise.all([
    movePointerByScreenPixels(vue, vueRadial, { x: 1, y: 1 }, { meta: true }),
    movePointerByScreenPixels(react, reactRadial, { x: 1, y: 1 }, { meta: true }),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual(['gate3-radial-shape'])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 1, length: 2 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 1, length: 2 })

  await Promise.all([
    clickBottomRight(vue, vue.locator('.viewport-wrapper')),
    clickBottomRight(react, react.locator('.mona-editor-slide-canvas')),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual([])

  const vueGroupedShape = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const reactGroupedShape = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  const vueGroupedText = vue.locator('#editable-element-gate3-title .editable-element-text')
  const reactGroupedText = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')
  await Promise.all([vueGroupedShape.click(), reactGroupedShape.click()])
  expect(await assertSelectionParity()).toEqual({
    activeElementIds: ['gate3-gradient-shape', 'gate3-title'],
    activeGroupElementId: null,
    handleElementId: 'gate3-gradient-shape',
  })
  await Promise.all([vueGroupedShape.click(), reactGroupedShape.click()])
  expect((await assertSelectionParity()).activeGroupElementId).toBe('gate3-gradient-shape')
  // Normalize Playwright's retained ProseMirror focus; a real pointer click
  // blurs it before the canvas hotkey is handled.
  await Promise.all([
    vue.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur()),
    react.locator('body').evaluate(() => (document.activeElement as HTMLElement | null)?.blur()),
  ])
  await expect.poll(async () => (
    (await getVueState(vue)).editor as VueParityState['editor'] & { disableHotkeys: boolean }
  ).disableHotkeys).toBe(false)
  await Promise.all([
    vue.keyboard.press('ArrowRight'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('ArrowRight'),
  ])
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(reactState, 0, 'gate3-title')).toEqual(pickElement(vueState, 0, 'gate3-title'))
  expect(pickElement(reactState, 0, 'gate3-gradient-shape')).toEqual(pickElement(vueState, 0, 'gate3-gradient-shape'))
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([
    vue.keyboard.press('Delete'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Delete'),
  ])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedSlides(reactState.presentation)).toEqual(normalizedSlides(vueState.presentation))
  expect(pickElement(reactState, 0, 'gate3-title')).toEqual(pickElement(vueState, 0, 'gate3-title'))
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').first().click(),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z'),
  ])
  await expect.poll(async () => !!(await getVueState(vue)).presentation.slides[0]!.elements.find(element => element.id === 'gate3-gradient-shape')).toBe(true)
  await expect.poll(async () => !!(await getReactState(react)).presentation.slides[0]!.elements.find(element => element.id === 'gate3-gradient-shape')).toBe(true)
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedSlides(reactState.presentation)).toEqual(normalizedSlides(vueState.presentation))

  await Promise.all([vueGroupedShape.click(), reactGroupedShape.click()])
  await Promise.all([vueGroupedText.click(), reactGroupedText.click()])
  expect(await assertSelectionParity()).toMatchObject({
    activeGroupElementId: null,
    handleElementId: 'gate3-title',
  })
  await Promise.all([vue.waitForTimeout(500), react.waitForTimeout(500)])
  await Promise.all([vueGroupedText.click(), reactGroupedText.click()])
  expect((await assertSelectionParity()).activeGroupElementId).toBe('gate3-title')

  await Promise.all([vueRadial.click(), reactRadial.click()])
  await Promise.all([
    vue.locator('.canvas').press('Control+l'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+l'),
  ])
  expect((await assertSelectionParity()).activeElementIds).toEqual([])
  await Promise.all([vuePattern.click(), reactPattern.click()])
  await Promise.all([vueRadial.click(), reactRadial.click()])
  expect((await assertSelectionParity()).activeElementIds).toEqual([])
  await context.close()
})

test('matches the simple-line control inventory and selection state', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    selectVueLine(vue, 'gate3-line'),
    react.getByRole('button', { name: 'Select line gate3-line' }).click(),
  ])

  await expect(vue.locator('.line-element-operate .resize-handler')).toHaveCount(2)
  await expect(react.locator('.mona-line-control-handle')).toHaveCount(2)
  await expect(vue.locator('.line-element-operate .rotate-handler')).toHaveCount(0)
  await expect(react.locator('.mona-rotate-handle')).toHaveCount(0)
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
  await context.close()
})

test('matches every line-family control inventory, placement, chrome, and anchor-line rendering', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(5).click(),
    react.getByRole('button', { name: 'Show slide 6' }).click(),
  ])
  const scenarios = [
    { id: 'gate4-simple-line', controls: 2, anchors: 0 },
    { id: 'gate4-broken-line', controls: 3, anchors: 0 },
    { id: 'gate4-broken2-line', controls: 3, anchors: 0 },
    { id: 'gate4-curve-line', controls: 3, anchors: 2 },
    { id: 'gate4-cubic-line', controls: 4, anchors: 2 },
  ] as const
  for (const scenario of scenarios) {
    await Promise.all([
      selectVueLine(vue, scenario.id),
      react.getByRole('button', { name: `Select line ${scenario.id}` }).click(),
    ])
    const vueControls = vue.locator('.line-element-operate .resize-handler')
    const reactControls = react.locator('.mona-line-control-handle')
    await expect(vueControls).toHaveCount(scenario.controls)
    await expect(reactControls).toHaveCount(scenario.controls)
    await expect(vue.locator('.line-element-operate .anchor-line')).toHaveCount(scenario.anchors)
    await expect(react.locator('.mona-line-anchor-layer line')).toHaveCount(scenario.anchors)

    const [vuePositions, reactPositions] = await Promise.all([
      vueControls.evaluateAll(items => {
        const wrapper = document.querySelector('.viewport-wrapper')!.getBoundingClientRect()
        const scale = window.__MONA_TEST__!.getState().editor.canvasScale as number
        return items.map(item => {
          const rect = item.getBoundingClientRect()
          return { x: (rect.x + rect.width / 2 - wrapper.x) / scale, y: (rect.y + rect.height / 2 - wrapper.y) / scale }
        })
      }),
      reactControls.evaluateAll(items => {
        const canvas = document.querySelector('.mona-editor-slide-canvas') as HTMLElement
        const wrapper = canvas.getBoundingClientRect()
        const scale = new DOMMatrixReadOnly(canvas.style.transform || getComputedStyle(canvas).transform).a
        return items.map(item => {
          const rect = item.getBoundingClientRect()
          return { x: (rect.x + rect.width / 2 - wrapper.x) / scale, y: (rect.y + rect.height / 2 - wrapper.y) / scale }
        })
      }),
    ])
    expect(reactPositions).toHaveLength(vuePositions.length)
    reactPositions.forEach((position, index) => {
      expect(position.x).toBeCloseTo(vuePositions[index]!.x, 1)
      expect(position.y).toBeCloseTo(vuePositions[index]!.y, 1)
    })

    const [vueChrome, reactChrome] = await Promise.all([
      vueControls.first().evaluate(element => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, border: style.border, borderRadius: style.borderRadius, cursor: style.cursor, height: style.height, width: style.width }
      }),
      reactControls.first().evaluate(element => {
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          border: style.border,
          borderRadius: style.borderRadius,
          cursor: style.cursor,
          height: style.height,
          width: style.width,
        }
      }),
    ])
    expect(reactChrome.background).toBe(vueChrome.background)
    expect(reactChrome.border).toBe(vueChrome.border)
    expect(reactChrome.cursor).toBe(vueChrome.cursor)
    expect(Number.parseFloat(reactChrome.borderRadius)).toBeCloseTo(Number.parseFloat(vueChrome.borderRadius), 1)
    expect(Number.parseFloat(reactChrome.width)).toBeCloseTo(Number.parseFloat(vueChrome.width), 1)
    expect(Number.parseFloat(reactChrome.height)).toBeCloseTo(Number.parseFloat(vueChrome.height), 1)

    if (scenario.anchors) {
      const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
      const vueLine = pickElement(vueState, 5, scenario.id) as PPTLineElement
      const reactLine = pickElement(reactState, 5, scenario.id) as PPTLineElement
      const [vueAnchors, reactAnchors] = await Promise.all([
        vue.locator('.line-element-operate .anchor-line').evaluateAll((items, origin) => items.map(item => ({
          x1: Number(item.getAttribute('x1')) + origin.left,
          x2: Number(item.getAttribute('x2')) + origin.left,
          y1: Number(item.getAttribute('y1')) + origin.top,
          y2: Number(item.getAttribute('y2')) + origin.top,
          style: (() => {
            const value = getComputedStyle(item); return { dash: value.strokeDasharray, opacity: value.opacity, stroke: value.stroke, width: value.strokeWidth } 
          })(),
        })), { left: vueLine.left, top: vueLine.top }),
        react.locator('.mona-line-anchor-layer line').evaluateAll((items, origin) => items.map(item => ({
          x1: Number(item.getAttribute('x1')) + origin.left,
          x2: Number(item.getAttribute('x2')) + origin.left,
          y1: Number(item.getAttribute('y1')) + origin.top,
          y2: Number(item.getAttribute('y2')) + origin.top,
          style: (() => {
            const value = getComputedStyle(item); return { dash: value.strokeDasharray, opacity: value.opacity, stroke: value.stroke, width: value.strokeWidth } 
          })(),
        })), { left: reactLine.left, top: reactLine.top }),
      ])
      expect(reactAnchors).toEqual(vueAnchors)
      expectLineParity(reactLine, vueLine)
    }
  }
  await context.close()
})

test('matches line endpoint, control, adsorption, crossing, modifier, and history semantics', async ({ browser }) => {
  const scenarios = [
    { id: 'gate4-simple-line', handle: 'start', vueIndex: 0, delta: { x: 410, y: -100 }, mode: 'adsorb' },
    { id: 'gate4-simple-line', handle: 'end', vueIndex: 1, delta: { x: -350, y: 60 }, mode: 'cross' },
    { id: 'gate4-broken-line', handle: 'end', vueIndex: 1, delta: { x: 55, y: -45 }, mode: 'reset' },
    { id: 'gate4-broken-line', handle: 'end', vueIndex: 1, delta: { x: 55, y: -45 }, mode: 'preserve', shift: true },
    { id: 'gate4-broken-line', handle: 'end', vueIndex: 1, delta: { x: 55, y: -45 }, mode: 'dynamic-preserve', shiftAfterPointerDown: true },
    { id: 'gate4-broken2-line', handle: 'control', vueIndex: 2, delta: { x: 45, y: 35 }, mode: 'broken2-control' },
    { id: 'gate4-curve-line', handle: 'control', vueIndex: 2, delta: { x: -35, y: 70 }, mode: 'curve-control' },
    { id: 'gate4-cubic-line', handle: 'control-1', vueIndex: 2, delta: { x: 45, y: 30 }, mode: 'cubic-control' },
    { id: 'gate4-cubic-line', handle: 'end', vueIndex: 1, delta: { x: 50, y: -45 }, mode: 'reset-cubic' },
    { id: 'gate4-cubic-line', handle: 'end', vueIndex: 1, delta: { x: 50, y: -45 }, mode: 'preserve-cubic', shift: true },
  ] as const
  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(5).click(),
      react.getByRole('button', { name: 'Show slide 6' }).click(),
    ])
    await Promise.all([
      selectVueLine(vue, scenario.id),
      react.getByRole('button', { name: `Select line ${scenario.id}` }).click(),
    ])
    const [vueInitialState, reactInitialState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueInitial = pickElement(vueInitialState, 5, scenario.id) as PPTLineElement
    const reactInitial = pickElement(reactInitialState, 5, scenario.id) as PPTLineElement
    expectLineParity(reactInitial, vueInitial, `${scenario.mode}.initial`)

    const perform = async (page: Page, target: ReturnType<Page['locator']>, slide: ReturnType<Page['locator']>) => {
      if (scenario.shift) await page.keyboard.down('Shift')
      if (scenario.shiftAfterPointerDown) {
        const [box, scale] = await Promise.all([
          target.boundingBox(),
          slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
        ])
        expect(box).not.toBeNull()
        const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.keyboard.down('Shift')
        await page.mouse.move(start.x + scenario.delta.x * scale, start.y + scenario.delta.y * scale)
        await page.mouse.up()
        await page.keyboard.up('Shift')
      }
      else await dragBySlideDelta(page, target, slide, scenario.delta)
      if (scenario.shift) await page.keyboard.up('Shift')
    }
    await Promise.all([
      perform(vue, vue.locator('.line-element-operate .resize-handler').nth(scenario.vueIndex), vue.locator('.viewport')),
      perform(react, react.locator(`.mona-line-control-handle[data-line-handle="${scenario.handle}"]`), react.locator('.mona-editor-slide-canvas')),
    ])
    const [vueFinalState, reactFinalState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueFinal = pickElement(vueFinalState, 5, scenario.id) as PPTLineElement
    const reactFinal = pickElement(reactFinalState, 5, scenario.id) as PPTLineElement
    expectLineParity(reactFinal, vueFinal, scenario.mode)

    const midpoint = (line: PPTLineElement): [number, number] => [
      (line.start[0] + line.end[0]) / 2,
      (line.start[1] + line.end[1]) / 2,
    ]
    if (scenario.mode === 'adsorb') {
      expect(reactFinal.left + reactFinal.start[0]).toBe(500)
      expect(reactFinal.top + reactFinal.start[1]).toBe(0)
    }
    if (scenario.mode === 'cross') {
      expect(reactFinal.end[0]).toBe(0)
      expect(reactFinal.start[0]).toBeGreaterThan(0)
    }
    if (scenario.mode === 'reset') expect(reactFinal.broken).toEqual(midpoint(reactFinal))
    if (scenario.mode === 'reset-cubic') expect(reactFinal.cubic).toEqual([midpoint(reactFinal), midpoint(reactFinal)])
    if (scenario.mode === 'preserve' || scenario.mode === 'dynamic-preserve') {
      expect(reactFinal.left + reactFinal.broken![0]).toBeCloseTo(reactInitial.left + reactInitial.broken![0], 8)
      expect(reactFinal.top + reactFinal.broken![1]).toBeCloseTo(reactInitial.top + reactInitial.broken![1], 8)
    }
    if (scenario.mode === 'preserve-cubic') {
      for (let point = 0; point < 2; point += 1) {
        expect(reactFinal.left + reactFinal.cubic![point][0]).toBeCloseTo(reactInitial.left + reactInitial.cubic![point][0], 8)
        expect(reactFinal.top + reactFinal.cubic![point][1]).toBeCloseTo(reactInitial.top + reactInitial.cubic![point][1], 8)
      }
    }
    if (scenario.mode === 'broken2-control') expect(reactFinal.broken2![1]).toBe(reactInitial.broken2![1])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches lasso thresholds, pixels, four directions, intersection mode, locks, and complete groups', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(1).click(),
    react.getByRole('button', { name: 'Show slide 2' }).click(),
  ])
  const vueCanvas = vue.locator('.viewport')
  const reactCanvas = react.locator('.mona-editor-slide-canvas')
  const selectionIds = async () => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    return normalizedReactSelection(reactState).activeElementIds
  }

  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 20, y: 500 }, { x: 24, y: 504 }, { release: false }),
    dragLasso(react, reactCanvas, { x: 20, y: 500 }, { x: 24, y: 504 }, { release: false }),
  ])
  await Promise.all([
    expect(vue.locator('.mouse-selection')).toHaveCount(0),
    expect(react.locator('.mona-lasso-selection')).toHaveCount(0),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  expect(await selectionIds()).toEqual([])

  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 20, y: 110 }, { x: 350, y: 480 }, { release: false }),
    dragLasso(react, reactCanvas, { x: 20, y: 110 }, { x: 350, y: 480 }, { release: false }),
  ])
  const [vueLassoStyle, reactLassoStyle] = await Promise.all([
    vue.locator('.mouse-selection').evaluate(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.border, height: Number.parseFloat((element as HTMLElement).style.height), width: Number.parseFloat((element as HTMLElement).style.width), zIndex: style.zIndex }
    }),
    react.locator('.mona-lasso-selection').evaluate(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.border, height: Number.parseFloat((element as HTMLElement).style.height), width: Number.parseFloat((element as HTMLElement).style.width), zIndex: style.zIndex }
    }),
  ])
  expect(reactLassoStyle.background).toBe(vueLassoStyle.background)
  expect(reactLassoStyle.border).toBe(vueLassoStyle.border)
  expect(reactLassoStyle.zIndex).toBe(vueLassoStyle.zIndex)
  expect(reactLassoStyle.width).toBeCloseTo(vueLassoStyle.width, 0)
  expect(reactLassoStyle.height).toBeCloseTo(vueLassoStyle.height, 0)
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  expect(await selectionIds()).toEqual(['gate3-image-round'])

  const corners = [
    [{ x: 350, y: 480 }, { x: 20, y: 110 }],
    [{ x: 20, y: 480 }, { x: 350, y: 110 }],
    [{ x: 350, y: 110 }, { x: 20, y: 480 }],
  ] as const
  for (const [start, end] of corners) {
    await Promise.all([dragLasso(vue, vueCanvas, start, end), dragLasso(react, reactCanvas, start, end)])
    expect(await selectionIds()).toEqual(['gate3-image-round'])
  }

  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 30, y: 200 }, { x: 100, y: 300 }),
    dragLasso(react, reactCanvas, { x: 30, y: 200 }, { x: 100, y: 300 }),
  ])
  expect(await selectionIds()).toEqual([])
  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 30, y: 200 }, { x: 100, y: 300 }, { holdMetaBeforeRelease: true }),
    dragLasso(react, reactCanvas, { x: 30, y: 200 }, { x: 100, y: 300 }, { holdMetaBeforeRelease: true }),
  ])
  expect(await selectionIds()).toEqual(['gate3-image-round'])

  await Promise.all([
    vue.locator('.canvas').press('Control+l'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+l'),
  ])
  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 20, y: 110 }, { x: 350, y: 480 }),
    dragLasso(react, reactCanvas, { x: 20, y: 110 }, { x: 350, y: 480 }),
  ])
  expect(await selectionIds()).toEqual([])

  await Promise.all([
    vue.locator('.thumbnail-slide').first().click(),
    react.getByRole('button', { name: 'Show slide 1' }).click(),
  ])
  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 20, y: 20 }, { x: 320, y: 260 }),
    dragLasso(react, reactCanvas, { x: 20, y: 20 }, { x: 320, y: 260 }),
  ])
  expect(await selectionIds()).toEqual([])
  await Promise.all([
    dragLasso(vue, vueCanvas, { x: 20, y: 20 }, { x: 930, y: 260 }),
    dragLasso(react, reactCanvas, { x: 20, y: 20 }, { x: 930, y: 260 }),
  ])
  expect(await selectionIds()).toEqual(['gate3-gradient-shape', 'gate3-line', 'gate3-title'])
  await context.close()
})

test('matches drag snapping, alignment-guide geometry, Shift axis locking, and history', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueCanvas = vue.locator('.viewport')
  const reactCanvas = react.locator('.mona-editor-slide-canvas')
  const vueShape = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactShape = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([vueShape.click(), reactShape.click()])

  await Promise.all([
    beginDragBySlideDelta(vue, vueShape, vueCanvas, { x: 66, y: 0 }),
    beginDragBySlideDelta(react, reactShape, reactCanvas, { x: 66, y: 0 }),
  ])
  const vueGuides = vue.locator('.alignment-line')
  const reactGuides = react.locator('.mona-alignment-guide')
  await expect(vueGuides).toHaveCount(2)
  await expect(reactGuides).toHaveCount(2)
  const [vueGuideData, reactGuideData] = await Promise.all([
    vueGuides.evaluateAll((guides, canvasSelector) => {
      const canvas = document.querySelector(canvasSelector as string)!
      const scale = new DOMMatrixReadOnly((canvas as HTMLElement).style.transform || getComputedStyle(canvas).transform).a
      return guides.map(guide => {
        const line = guide.querySelector('.line') as HTMLElement
        const rect = line.getBoundingClientRect()
        const style = getComputedStyle(line)
        const horizontal = line.classList.contains('horizontal')
        const guideStyle = (guide as HTMLElement).style
        return {
          borderColor: style.borderColor,
          length: Number.parseFloat(horizontal ? line.style.width : line.style.height) / scale,
          left: Number.parseFloat(guideStyle.left) / scale,
          thickness: horizontal ? rect.height : rect.width,
          top: Number.parseFloat(guideStyle.top) / scale,
          zIndex: getComputedStyle(guide).zIndex,
        }
      })
    }, '.viewport'),
    reactGuides.evaluateAll((guides, canvasSelector) => {
      const canvas = document.querySelector(canvasSelector as string)!
      const scale = new DOMMatrixReadOnly((canvas as HTMLElement).style.transform || getComputedStyle(canvas).transform).a
      return guides.map(guide => {
        const rect = guide.getBoundingClientRect()
        const style = getComputedStyle(guide)
        const horizontal = guide.classList.contains('is-horizontal')
        return {
          borderColor: style.borderColor,
          length: Number.parseFloat(horizontal ? (guide as HTMLElement).style.width : (guide as HTMLElement).style.height) / scale,
          left: Number.parseFloat((guide as HTMLElement).style.left) / scale,
          thickness: horizontal ? rect.height : rect.width,
          top: Number.parseFloat((guide as HTMLElement).style.top) / scale,
          zIndex: style.zIndex,
        }
      })
    }, '.mona-editor-slide-canvas'),
  ])
  expect(reactGuideData).toHaveLength(vueGuideData.length)
  for (let index = 0; index < vueGuideData.length; index += 1) {
    expect(reactGuideData[index]!.borderColor).toBe(vueGuideData[index]!.borderColor)
    expect(reactGuideData[index]!.zIndex).toBe(vueGuideData[index]!.zIndex)
    // The two shells fit the same slide at different CSS scales. Chromium can
    // quantize a synthetic mouse coordinate by one device pixel before Vue's
    // pageX/canvasScale conversion, so compare the rendered guide within that
    // single input pixel. The crossed-axis endpoint formula is asserted
    // exactly in packages/editor-interactions/src/geometry.test.ts.
    expect(Math.abs(reactGuideData[index]!.left - vueGuideData[index]!.left)).toBeLessThan(1)
    expect(Math.abs(reactGuideData[index]!.top - vueGuideData[index]!.top)).toBeLessThan(0.001)
    expect(Math.abs(reactGuideData[index]!.length - vueGuideData[index]!.length)).toBeLessThan(1)
    expect(reactGuideData[index]!.thickness).toBeCloseTo(vueGuideData[index]!.thickness, 3)
  }
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(reactState, 0, 'gate3-radial-shape')).toEqual(pickElement(vueState, 0, 'gate3-radial-shape'))
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
  await context.close()

  const shiftContext = await browser.newContext()
  const shiftEditors = await openEditors(shiftContext)
  const shiftVueCanvas = shiftEditors.vue.locator('.viewport')
  const shiftReactCanvas = shiftEditors.react.locator('.mona-editor-slide-canvas')
  const shiftVueShape = shiftEditors.vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const shiftReactShape = shiftEditors.react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([shiftVueShape.click(), shiftReactShape.click()])
  await Promise.all([shiftEditors.vue.keyboard.down('Shift'), shiftEditors.react.keyboard.down('Shift')])
  await Promise.all([
    beginDragBySlideDelta(shiftEditors.vue, shiftVueShape, shiftVueCanvas, { x: 66, y: 20 }),
    beginDragBySlideDelta(shiftEditors.react, shiftReactShape, shiftReactCanvas, { x: 66, y: 20 }),
  ])
  await Promise.all([shiftEditors.vue.mouse.up(), shiftEditors.react.mouse.up()])
  await Promise.all([shiftEditors.vue.keyboard.up('Shift'), shiftEditors.react.keyboard.up('Shift')])
  ;[vueState, reactState] = await Promise.all([getVueState(shiftEditors.vue), getReactState(shiftEditors.react)])
  expect(pickElement(reactState, 0, 'gate3-radial-shape')).toEqual(pickElement(vueState, 0, 'gate3-radial-shape'))
  await shiftContext.close()
})

test('matches immediate and mid-gesture quick duplication, including live state and visuals', async ({ browser }) => {
  const runScenario = async (
    activation: 'after-pointerdown' | 'before-pointerdown' | 'mid-gesture',
    releaseAfterActivation = false,
  ) => {
    const midGesture = activation === 'mid-gesture'
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueCanvas = vue.locator('.viewport')
    const reactCanvas = react.locator('.mona-editor-slide-canvas')
    const vueShape = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
    const reactShape = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
    await Promise.all([vueShape.click(), reactShape.click()])
    const [vueInitial, reactInitial] = await Promise.all([getVueState(vue), getReactState(react)])
    const initialVueElement = pickElement(vueInitial, 0, 'gate3-radial-shape')
    const initialReactElement = pickElement(reactInitial, 0, 'gate3-radial-shape')

    if (activation === 'before-pointerdown') {
      await Promise.all([vue.keyboard.down('Control'), react.keyboard.down('Control')])
    }
    const [vueDrag, reactDrag] = await Promise.all([
      beginDragBySlideDelta(vue, vueShape, vueCanvas, midGesture ? { x: 66, y: 0 } : { x: 0, y: 0 }),
      beginDragBySlideDelta(react, reactShape, reactCanvas, midGesture ? { x: 66, y: 0 } : { x: 0, y: 0 }),
    ])
    if (activation !== 'before-pointerdown') {
      await Promise.all([vue.keyboard.down('Control'), react.keyboard.down('Control')])
    }
    await Promise.all([
      vue.mouse.move(vueDrag.start.x + 60 * vueDrag.scale, vueDrag.start.y + 10 * vueDrag.scale),
      react.mouse.move(reactDrag.start.x + 60 * reactDrag.scale, reactDrag.start.y + 10 * reactDrag.scale),
    ])
    await Promise.all([vue.waitForTimeout(50), react.waitForTimeout(50)])

    const [vueLive, reactLive] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactLive.presentation.slides[0]!.elements).toHaveLength(vueLive.presentation.slides[0]!.elements.length)
    expect(reactLive.presentation.slides[0]!.elements).toHaveLength(reactInitial.presentation.slides[0]!.elements.length + 1)
    expect(pickElement(reactLive, 0, 'gate3-radial-shape')).toEqual(pickElement(vueLive, 0, 'gate3-radial-shape'))
    if (!midGesture) {
      expect(pickElement(vueLive, 0, 'gate3-radial-shape')).toEqual(initialVueElement)
      expect(pickElement(reactLive, 0, 'gate3-radial-shape')).toEqual(initialReactElement)
    }
    const vueDuplicateId = vueLive.editor.activeElementIdList[0]!
    const reactDuplicateId = reactLive.session.activeElementIds[0]!
    expect(vueDuplicateId).not.toBe('gate3-radial-shape')
    expect(reactDuplicateId).not.toBe('gate3-radial-shape')
    const vueStoredDuplicate = pickElement(vueLive, 0, vueDuplicateId)
    const reactStoredDuplicate = pickElement(reactLive, 0, reactDuplicateId)
    expect(elementWithoutGeneratedIdentity(reactStoredDuplicate)).toEqual(elementWithoutGeneratedIdentity(vueStoredDuplicate))
    expect(elementWithoutGeneratedIdentity(vueStoredDuplicate)).toEqual(elementWithoutGeneratedIdentity(initialVueElement))
    const [vueLiveRect, reactLiveRect] = await Promise.all([
      normalizedVisualRect(vue.locator(`#editable-element-${vueDuplicateId} > .editable-element-shape`), vueCanvas),
      normalizedVisualRect(reactCanvas.locator(`[data-element-id="${reactDuplicateId}"]`), reactCanvas),
    ])
    expect(reactLiveRect.left).toBeCloseTo(vueLiveRect.left, 2)
    expect(reactLiveRect.top).toBeCloseTo(vueLiveRect.top, 2)
    expect(reactLiveRect.width).toBeCloseTo(vueLiveRect.width, 2)
    expect(reactLiveRect.height).toBeCloseTo(vueLiveRect.height, 2)
    expect(vueLiveRect.left).toBeCloseTo(initialVueElement.left, 2)
    expect(reactLiveRect.left).toBeCloseTo(initialReactElement.left, 2)

    if (releaseAfterActivation) {
      await Promise.all([vue.keyboard.up('Control'), react.keyboard.up('Control')])
    }
    await Promise.all([
      vue.mouse.move(vueDrag.start.x + 66 * vueDrag.scale, vueDrag.start.y),
      react.mouse.move(reactDrag.start.x + 66 * reactDrag.scale, reactDrag.start.y),
    ])
    await Promise.all([vue.waitForTimeout(20), react.waitForTimeout(20)])
    const [vueMovedRect, reactMovedRect] = await Promise.all([
      normalizedVisualRect(vue.locator(`#editable-element-${vueDuplicateId} > .editable-element-shape`), vueCanvas),
      normalizedVisualRect(reactCanvas.locator(`[data-element-id="${reactDuplicateId}"]`), reactCanvas),
    ])
    expect(reactMovedRect.left).toBeCloseTo(vueMovedRect.left, 2)
    expect(reactMovedRect.top).toBeCloseTo(vueMovedRect.top, 2)
    expect(vueMovedRect.left).not.toBeCloseTo(initialVueElement.left, 2)
    expect(reactMovedRect.left).not.toBeCloseTo(initialReactElement.left, 2)

    await Promise.all([vue.mouse.up(), react.mouse.up()])
    if (!releaseAfterActivation) {
      await Promise.all([vue.keyboard.up('Control'), react.keyboard.up('Control')])
    }
    const [vueFinal, reactFinal] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactFinal, 0, 'gate3-radial-shape')).toEqual(pickElement(vueFinal, 0, 'gate3-radial-shape'))
    expect(elementWithoutGeneratedIdentity(pickElement(reactFinal, 0, reactDuplicateId))).toEqual(
      elementWithoutGeneratedIdentity(pickElement(vueFinal, 0, vueDuplicateId)),
    )
    expect(normalizedReactSelection(reactFinal).activeElementIds).toEqual([reactDuplicateId])
    expect(normalizedVueSelection(vueFinal).activeElementIds).toEqual([vueDuplicateId])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }

  await runScenario('after-pointerdown')
  await runScenario('mid-gesture')
  await runScenario('before-pointerdown', true)
})

test('matches whole-group and active-member drag and duplicate semantics', async ({ browser }) => {
  const groupContext = await browser.newContext()
  const groupEditors = await openEditors(groupContext)
  const groupVueCanvas = groupEditors.vue.locator('.viewport')
  const groupReactCanvas = groupEditors.react.locator('.mona-editor-slide-canvas')
  const groupVueShape = groupEditors.vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const groupReactShape = groupEditors.react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await Promise.all([groupVueShape.click(), groupReactShape.click()])
  await Promise.all([groupEditors.vue.waitForTimeout(50), groupEditors.react.waitForTimeout(50)])
  const [groupVueInitial, groupReactInitial] = await Promise.all([
    getVueState(groupEditors.vue),
    getReactState(groupEditors.react),
  ])
  const originalGroupIds = ['gate3-gradient-shape', 'gate3-title']
  const [groupVueDrag, groupReactDrag] = await Promise.all([
    beginDragBySlideDelta(groupEditors.vue, groupVueShape, groupVueCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
    beginDragBySlideDelta(groupEditors.react, groupReactShape, groupReactCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
  ])
  await Promise.all([groupEditors.vue.keyboard.down('Control'), groupEditors.react.keyboard.down('Control')])
  await Promise.all([groupEditors.vue.waitForTimeout(20), groupEditors.react.waitForTimeout(20)])
  await Promise.all([
    groupEditors.vue.mouse.move(groupVueDrag.start.x + 18 * groupVueDrag.scale, groupVueDrag.start.y + 20 * groupVueDrag.scale),
    groupEditors.react.mouse.move(groupReactDrag.start.x + 18 * groupReactDrag.scale, groupReactDrag.start.y + 20 * groupReactDrag.scale),
  ])
  const [groupVueActivated, groupReactActivated] = await Promise.all([
    getVueState(groupEditors.vue),
    getReactState(groupEditors.react),
  ])
  expect(groupReactActivated.presentation.slides[0]!.elements).toHaveLength(groupVueActivated.presentation.slides[0]!.elements.length)
  expect(groupReactActivated.presentation.slides[0]!.elements).toHaveLength(groupReactInitial.presentation.slides[0]!.elements.length + 2)
  expect(groupVueActivated.editor.activeElementIdList).toHaveLength(2)
  expect(groupReactActivated.session.activeElementIds).toHaveLength(2)
  for (const id of originalGroupIds) {
    expect(pickElement(groupReactActivated, 0, id)).toEqual(pickElement(groupReactInitial, 0, id))
    expect(pickElement(groupVueActivated, 0, id)).toEqual(pickElement(groupVueInitial, 0, id))
  }
  await Promise.all([
    groupEditors.vue.mouse.move(groupVueDrag.start.x + 22 * groupVueDrag.scale, groupVueDrag.start.y + 34 * groupVueDrag.scale),
    groupEditors.react.mouse.move(groupReactDrag.start.x + 22 * groupReactDrag.scale, groupReactDrag.start.y + 34 * groupReactDrag.scale),
  ])
  await Promise.all([groupEditors.vue.mouse.up(), groupEditors.react.mouse.up()])
  await Promise.all([groupEditors.vue.keyboard.up('Control'), groupEditors.react.keyboard.up('Control')])
  const [groupVueFinal, groupReactFinal] = await Promise.all([
    getVueState(groupEditors.vue),
    getReactState(groupEditors.react),
  ])
  const vueGroupCopies = groupVueFinal.editor.activeElementIdList.map(id => pickElement(groupVueFinal, 0, id))
  const reactGroupCopies = groupReactFinal.session.activeElementIds.map(id => pickElement(groupReactFinal, 0, id))
  expect(new Set(vueGroupCopies.map(element => element.groupId)).size).toBe(1)
  expect(new Set(reactGroupCopies.map(element => element.groupId)).size).toBe(1)
  expect(vueGroupCopies[0]!.groupId).not.toBe('gate3-heading-group')
  expect(reactGroupCopies[0]!.groupId).not.toBe('gate3-heading-group')
  expect(reactGroupCopies.map(elementWithoutGeneratedIdentity).sort((a, b) => a.type.localeCompare(b.type))).toEqual(
    vueGroupCopies.map(elementWithoutGeneratedIdentity).sort((a, b) => a.type.localeCompare(b.type)),
  )
  for (const id of originalGroupIds) {
    expect(pickElement(groupReactFinal, 0, id)).toEqual(pickElement(groupVueFinal, 0, id))
  }
  await Promise.all([groupEditors.vue.waitForTimeout(350), groupEditors.react.waitForTimeout(350)])
  expect(await getReactHistory(groupEditors.react)).toEqual(await getVueHistory(groupEditors.vue))
  await groupContext.close()

  const memberContext = await browser.newContext()
  const memberEditors = await openEditors(memberContext)
  const memberVueCanvas = memberEditors.vue.locator('.viewport')
  const memberReactCanvas = memberEditors.react.locator('.mona-editor-slide-canvas')
  const memberVueShape = memberEditors.vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const memberReactShape = memberEditors.react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await Promise.all([memberVueShape.click(), memberReactShape.click()])
  await Promise.all([memberVueShape.click(), memberReactShape.click()])
  await Promise.all([
    dragBySlideDelta(memberEditors.vue, memberVueShape, memberVueCanvas, { x: 42, y: -6 }, { x: 0.5, y: 0.1 }),
    dragBySlideDelta(memberEditors.react, memberReactShape, memberReactCanvas, { x: 42, y: -6 }, { x: 0.5, y: 0.1 }),
  ])
  const [memberVueMoved, memberReactMoved] = await Promise.all([
    getVueState(memberEditors.vue),
    getReactState(memberEditors.react),
  ])
  expect(elementWithoutGeneratedIdentity(pickElement(memberReactMoved, 0, 'gate3-gradient-shape'))).toEqual(
    elementWithoutGeneratedIdentity(pickElement(memberVueMoved, 0, 'gate3-gradient-shape')),
  )
  expect(pickElement(memberReactMoved, 0, 'gate3-title')).toEqual(pickElement(memberVueMoved, 0, 'gate3-title'))
  expect(normalizedReactSelection(memberReactMoved)).toEqual(normalizedVueSelection(memberVueMoved))
  await memberContext.close()

  const memberDuplicateContext = await browser.newContext()
  const duplicateEditors = await openEditors(memberDuplicateContext)
  const duplicateVueCanvas = duplicateEditors.vue.locator('.viewport')
  const duplicateReactCanvas = duplicateEditors.react.locator('.mona-editor-slide-canvas')
  const duplicateVueShape = duplicateEditors.vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const duplicateReactShape = duplicateEditors.react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await Promise.all([duplicateVueShape.click(), duplicateReactShape.click()])
  await Promise.all([duplicateVueShape.click(), duplicateReactShape.click()])
  const [memberVueInitial, memberReactInitial] = await Promise.all([
    getVueState(duplicateEditors.vue),
    getReactState(duplicateEditors.react),
  ])
  const [memberVueDrag, memberReactDrag] = await Promise.all([
    beginDragBySlideDelta(duplicateEditors.vue, duplicateVueShape, duplicateVueCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
    beginDragBySlideDelta(duplicateEditors.react, duplicateReactShape, duplicateReactCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
  ])
  await Promise.all([duplicateEditors.vue.keyboard.down('Control'), duplicateEditors.react.keyboard.down('Control')])
  await Promise.all([duplicateEditors.vue.waitForTimeout(20), duplicateEditors.react.waitForTimeout(20)])
  await Promise.all([
    duplicateEditors.vue.mouse.move(memberVueDrag.start.x + 30 * memberVueDrag.scale, memberVueDrag.start.y - 3 * memberVueDrag.scale),
    duplicateEditors.react.mouse.move(memberReactDrag.start.x + 30 * memberReactDrag.scale, memberReactDrag.start.y - 3 * memberReactDrag.scale),
  ])
  await Promise.all([
    duplicateEditors.vue.mouse.move(memberVueDrag.start.x + 42 * memberVueDrag.scale, memberVueDrag.start.y - 6 * memberVueDrag.scale),
    duplicateEditors.react.mouse.move(memberReactDrag.start.x + 42 * memberReactDrag.scale, memberReactDrag.start.y - 6 * memberReactDrag.scale),
  ])
  await Promise.all([duplicateEditors.vue.mouse.up(), duplicateEditors.react.mouse.up()])
  await Promise.all([duplicateEditors.vue.keyboard.up('Control'), duplicateEditors.react.keyboard.up('Control')])
  const [memberVueFinal, memberReactFinal] = await Promise.all([
    getVueState(duplicateEditors.vue),
    getReactState(duplicateEditors.react),
  ])
  const vueMemberCopy = pickElement(memberVueFinal, 0, memberVueFinal.editor.activeElementIdList[0]!)
  const reactMemberCopy = pickElement(memberReactFinal, 0, memberReactFinal.session.activeElementIds[0]!)
  expect(memberVueFinal.editor.activeElementIdList).toHaveLength(1)
  expect(memberReactFinal.session.activeElementIds).toHaveLength(1)
  expect(vueMemberCopy.groupId).toBeUndefined()
  expect(reactMemberCopy.groupId).toBeUndefined()
  expect(elementWithoutGeneratedIdentity(reactMemberCopy)).toEqual(elementWithoutGeneratedIdentity(vueMemberCopy))
  expect(pickElement(memberReactFinal, 0, 'gate3-gradient-shape')).toEqual(pickElement(memberReactInitial, 0, 'gate3-gradient-shape'))
  expect(pickElement(memberVueFinal, 0, 'gate3-gradient-shape')).toEqual(pickElement(memberVueInitial, 0, 'gate3-gradient-shape'))
  expect(pickElement(memberReactFinal, 0, 'gate3-title')).toEqual(pickElement(memberVueFinal, 0, 'gate3-title'))
  expect(normalizedReactSelection(memberReactFinal).activeGroupElementId).toBeNull()
  expect(normalizedVueSelection(memberVueFinal).activeGroupElementId).toBeNull()
  await memberDuplicateContext.close()
})

test('matches ungrouped multi-selection quick duplication', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueCanvas = vue.locator('.viewport')
  const reactCanvas = react.locator('.mona-editor-slide-canvas')
  const vueRadial = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactRadial = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  const vuePattern = vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape')
  const reactPattern = react.getByRole('button', { name: 'Select shape gate3-pattern-shape' })
  await Promise.all([vueRadial.click(), reactRadial.click()])
  await Promise.all([
    vuePattern.click({ modifiers: ['Shift'] }),
    reactPattern.click({ modifiers: ['Shift'] }),
  ])
  const [vueInitial, reactInitial] = await Promise.all([getVueState(vue), getReactState(react)])
  const [vueDrag, reactDrag] = await Promise.all([
    beginDragBySlideDelta(vue, vuePattern, vueCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
    beginDragBySlideDelta(react, reactPattern, reactCanvas, { x: 0, y: 0 }, { x: 0.5, y: 0.1 }),
  ])
  await Promise.all([vue.keyboard.down('Control'), react.keyboard.down('Control')])
  await Promise.all([
    vue.mouse.move(vueDrag.start.x + 10 * vueDrag.scale, vueDrag.start.y - 20 * vueDrag.scale),
    react.mouse.move(reactDrag.start.x + 10 * reactDrag.scale, reactDrag.start.y - 20 * reactDrag.scale),
  ])
  await Promise.all([
    vue.mouse.move(vueDrag.start.x + 18 * vueDrag.scale, vueDrag.start.y - 34 * vueDrag.scale),
    react.mouse.move(reactDrag.start.x + 18 * reactDrag.scale, reactDrag.start.y - 34 * reactDrag.scale),
  ])
  await Promise.all([vue.mouse.up(), react.mouse.up()])
  await Promise.all([vue.keyboard.up('Control'), react.keyboard.up('Control')])
  const [vueFinal, reactFinal] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueFinal.editor.activeElementIdList).toHaveLength(2)
  expect(reactFinal.session.activeElementIds).toHaveLength(2)
  const vueCopies = vueFinal.editor.activeElementIdList.map(id => pickElement(vueFinal, 0, id))
  const reactCopies = reactFinal.session.activeElementIds.map(id => pickElement(reactFinal, 0, id))
  expect(vueCopies.every(element => element.groupId === undefined)).toBe(true)
  expect(reactCopies.every(element => element.groupId === undefined)).toBe(true)
  const sortByFill = (left: PPTElement, right: PPTElement) => (
    ('fill' in left ? left.fill : '').localeCompare('fill' in right ? right.fill : '')
  )
  expect(reactCopies.map(elementWithoutGeneratedIdentity).sort(sortByFill)).toEqual(
    vueCopies.map(elementWithoutGeneratedIdentity).sort(sortByFill),
  )
  for (const id of ['gate3-radial-shape', 'gate3-pattern-shape']) {
    expect(pickElement(reactFinal, 0, id)).toEqual(pickElement(reactInitial, 0, id))
    expect(pickElement(vueFinal, 0, id)).toEqual(pickElement(vueInitial, 0, id))
  }
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
  await context.close()
})

test('matches per-type resize-handle and rotation-handle inventories', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const scenarios = [
    { slide: 0, id: 'gate3-radial-shape', type: 'shape', resize: 8, rotate: 1 },
    { slide: 1, id: 'gate3-image-title', type: 'text', resize: 2, rotate: 1 },
    { slide: 1, id: 'gate3-image-round', type: 'image', resize: 8, rotate: 1 },
    { slide: 2, id: 'gate3-chart', type: 'chart', resize: 8, rotate: 0 },
    { slide: 2, id: 'gate3-table', type: 'table', resize: 8, rotate: 1 },
    { slide: 2, id: 'gate3-latex', type: 'latex', resize: 8, rotate: 1 },
    { slide: 3, id: 'gate3-video', type: 'video', resize: 8, rotate: 0 },
    { slide: 3, id: 'gate3-audio', type: 'audio', resize: 8, rotate: 0 },
    { slide: 4, id: 'gate4-resize-shape', type: 'shape', resize: 8, rotate: 1 },
    { slide: 4, id: 'gate4-resize-image', type: 'image', resize: 8, rotate: 1 },
    { slide: 4, id: 'gate4-rotated-shape', type: 'shape', resize: 8, rotate: 1 },
    { slide: 4, id: 'gate4-horizontal-text', type: 'text', resize: 2, rotate: 1 },
    { slide: 4, id: 'gate4-vertical-text', type: 'text', resize: 2, rotate: 1 },
    { slide: 4, id: 'gate4-fixed-text', type: 'text', resize: 8, rotate: 1 },
  ] as const
  for (const scenario of scenarios) {
    if (scenario.slide) {
      await Promise.all([
        vue.locator('.thumbnail-slide').nth(scenario.slide).click(),
        react.getByRole('button', { name: `Show slide ${scenario.slide + 1}` }).click(),
      ])
    }
    await Promise.all([
      vueElement(vue, scenario.id, scenario.type).click(),
      reactElement(react, scenario.id, scenario.type).click(),
    ])
    const operateClass = vueOperateClass(scenario.type)
    await expect(vue.locator(`.${operateClass}-element-operate .operate-resize-handler`)).toHaveCount(scenario.resize)
    await expect(react.locator('.mona-selection-frame:not(.is-secondary) .mona-transform-handle')).toHaveCount(scenario.resize)
    await expect(vue.locator(`.${operateClass}-element-operate .operate-rotate-handler`)).toHaveCount(scenario.rotate)
    await expect(react.locator('.mona-selection-frame:not(.is-secondary) .mona-rotate-handle')).toHaveCount(scenario.rotate)
    if (scenario.id === 'gate3-radial-shape' || scenario.id === 'gate4-rotated-shape') {
      for (const handle of Object.keys(vueResizeHandleClass)) {
        const [vueChrome, reactChrome] = await Promise.all([
          vueResizeHandle(vue, scenario.type, handle).evaluate(element => {
            const style = getComputedStyle(element)
            return {
              background: style.backgroundColor,
              border: style.border,
              borderRadius: Number.parseFloat(style.borderRadius),
              cursor: style.cursor,
              height: Number.parseFloat(style.height),
              width: Number.parseFloat(style.width),
            }
          }),
          reactResizeHandle(react, handle).evaluate(element => {
            const style = getComputedStyle(element)
            return {
              background: style.backgroundColor,
              border: style.border,
              borderRadius: Number.parseFloat(style.borderRadius),
              cursor: style.cursor,
              height: Number.parseFloat(style.height),
              width: Number.parseFloat(style.width),
            }
          }),
        ])
        expect(reactChrome.background).toBe(vueChrome.background)
        expect(reactChrome.border).toBe(vueChrome.border)
        expect(reactChrome.cursor).toBe(vueChrome.cursor)
        expect(Math.abs(reactChrome.borderRadius - vueChrome.borderRadius)).toBeLessThan(0.02)
        expect(Math.abs(reactChrome.width - vueChrome.width)).toBeLessThan(0.02)
        expect(Math.abs(reactChrome.height - vueChrome.height)).toBeLessThan(0.02)
      }
    }
  }
  await context.close()
})

test('matches rotated, shape-formula, vertical-text, and fixed-text resize branches', async ({ browser }) => {
  const scenarios = [
    { id: 'gate4-resize-shape', type: 'shape', handle: 'bottom-right', delta: { x: 80, y: 32 } },
    { id: 'gate4-rotated-shape', type: 'shape', handle: 'bottom-right', delta: { x: 58, y: 27 } },
    { id: 'gate4-vertical-text', type: 'text', handle: 'bottom', delta: { x: 0, y: 75 } },
    { id: 'gate4-fixed-text', type: 'text', handle: 'top-left', delta: { x: -45, y: -35 } },
  ] as const
  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(4).click(),
      react.getByRole('button', { name: 'Show slide 5' }).click(),
    ])
    await Promise.all([
      vueElement(vue, scenario.id, scenario.type).click(),
      reactElement(react, scenario.id, scenario.type).click(),
    ])
    await Promise.all([
      dragBySlideDelta(vue, vueResizeHandle(vue, scenario.type, scenario.handle), vue.locator('.viewport'), scenario.delta),
      dragBySlideDelta(react, reactResizeHandle(react, scenario.handle), react.locator('.mona-editor-slide-canvas'), scenario.delta),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueResult = pickElement(vueState, 4, scenario.id)
    const reactResult = pickElement(reactState, 4, scenario.id)
    expectResizeElementParity(reactResult, vueResult, `${scenario.id}.${scenario.handle}`)
    if (scenario.id === 'gate4-resize-shape') {
      expect((reactResult as Extract<PPTElement, { type: 'shape' }>).viewBox).toEqual([
        (reactResult as Extract<PPTElement, { type: 'shape' }>).width,
        (reactResult as Extract<PPTElement, { type: 'shape' }>).height,
      ])
      expect((vueResult as Extract<PPTElement, { type: 'shape' }>).viewBox).toEqual([
        (vueResult as Extract<PPTElement, { type: 'shape' }>).width,
        (vueResult as Extract<PPTElement, { type: 'shape' }>).height,
      ])
    }
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('captures single-element aspect-ratio modifiers only at pointer down', async ({ browser }) => {
  for (const timing of ['before-pointer-down', 'after-pointer-down'] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(4).click(),
      react.getByRole('button', { name: 'Show slide 5' }).click(),
    ])
    await Promise.all([
      vueElement(vue, 'gate4-resize-shape', 'shape').click(),
      react.getByRole('button', { name: 'Select shape gate4-resize-shape' }).click(),
    ])

    const perform = async (page: Page, handle: ReturnType<Page['locator']>, slide: ReturnType<Page['locator']>) => {
      const [box, scale] = await Promise.all([
        handle.boundingBox(),
        slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
      ])
      expect(box).not.toBeNull()
      const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
      if (timing === 'before-pointer-down') await page.keyboard.down('Shift')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      if (timing === 'before-pointer-down') await page.keyboard.up('Shift')
      else await page.keyboard.down('Shift')
      await page.mouse.move(start.x + 80 * scale, start.y + 9 * scale)
      await page.mouse.up()
      if (timing === 'after-pointer-down') await page.keyboard.up('Shift')
    }
    await Promise.all([
      perform(vue, vueResizeHandle(vue, 'shape', 'bottom-right'), vue.locator('.viewport')),
      perform(react, reactResizeHandle(react, 'bottom-right'), react.locator('.mona-editor-slide-canvas')),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueResult = pickElement(vueState, 4, 'gate4-resize-shape')
    const reactResult = pickElement(reactState, 4, 'gate4-resize-shape')
    expectResizeElementParity(reactResult, vueResult, timing)
    const resultRatio = (reactResult as Extract<PPTElement, { type: 'shape' }>).width /
      (reactResult as Extract<PPTElement, { type: 'shape' }>).height
    if (timing === 'before-pointer-down') expect(resultRatio).toBeCloseTo(220 / 130, 8)
    else expect(resultRatio).not.toBeCloseTo(220 / 130, 2)
    await context.close()
  }
})

test('matches multi-selection resize, dynamic ratio locking, zero collapse, and stale shape paths', async ({ browser }) => {
  const scenarios = [
    { name: 'free', delta: { x: 85, y: 35 }, dynamicShift: false },
    { name: 'dynamic-ratio', delta: { x: 95, y: 11 }, dynamicShift: true },
    { name: 'zero-collapse', delta: { x: -1000, y: -1000 }, dynamicShift: false },
  ] as const
  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(4).click(),
      react.getByRole('button', { name: 'Show slide 5' }).click(),
    ])
    await Promise.all([
      vueElement(vue, 'gate4-resize-shape', 'shape').click(),
      react.getByRole('button', { name: 'Select shape gate4-resize-shape' }).click(),
    ])
    await Promise.all([
      vueElement(vue, 'gate4-resize-image', 'image').click({ modifiers: ['Shift'] }),
      react.getByRole('button', { name: 'Select image gate4-resize-image' }).click({ modifiers: ['Shift'] }),
    ])
    await expect(vue.locator('.multi-select-operate > .resize-handler')).toHaveCount(8)
    await expect(react.locator('.mona-selection-frame:not(.is-secondary) .mona-transform-handle')).toHaveCount(8)
    const [vueInitial, reactInitial] = await Promise.all([getVueState(vue), getReactState(react)])

    const perform = async (page: Page, handle: ReturnType<Page['locator']>, slide: ReturnType<Page['locator']>) => {
      const [box, scale] = await Promise.all([
        handle.boundingBox(),
        slide.evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform || getComputedStyle(element).transform).a),
      ])
      expect(box).not.toBeNull()
      const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      if (scenario.dynamicShift) {
        await page.mouse.move(start.x + 20 * scale, start.y + 7 * scale)
        await page.keyboard.down('Shift')
      }
      await page.mouse.move(start.x + scenario.delta.x * scale, start.y + scenario.delta.y * scale)
      await page.mouse.up()
      if (scenario.dynamicShift) await page.keyboard.up('Shift')
    }
    await Promise.all([
      perform(vue, vueMultiResizeHandle(vue, 'bottom-right'), vue.locator('.viewport')),
      perform(react, reactResizeHandle(react, 'bottom-right'), react.locator('.mona-editor-slide-canvas')),
    ])

    const [vueFinal, reactFinal] = await Promise.all([getVueState(vue), getReactState(react)])
    for (const id of ['gate4-resize-shape', 'gate4-resize-image']) {
      expectResizeElementParity(pickElement(reactFinal, 4, id), pickElement(vueFinal, 4, id), `${scenario.name}.${id}`)
    }
    const initialShape = pickElement(reactInitial, 4, 'gate4-resize-shape') as Extract<PPTElement, { type: 'shape' }>
    const finalShape = pickElement(reactFinal, 4, 'gate4-resize-shape') as Extract<PPTElement, { type: 'shape' }>
    expect(finalShape.path).toBe(initialShape.path)
    expect(finalShape.viewBox).toEqual(initialShape.viewBox)
    expect(pickElement(vueInitial, 4, 'gate4-resize-shape')).toEqual(pickElement(reactInitial, 4, 'gate4-resize-shape'))
    if (scenario.name === 'zero-collapse') {
      expect(finalShape.width).toBe(0)
      expect(finalShape.height).toBe(0)
    }
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches editable shape-keypoint placement, chrome, clamping, path updates, and history', async ({ browser }) => {
  for (const delta of [{ x: 35, y: 0 }, { x: 1000, y: 0 }] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(4).click(),
      react.getByRole('button', { name: 'Show slide 5' }).click(),
    ])
    await Promise.all([
      vueElement(vue, 'gate4-resize-shape', 'shape').click(),
      react.getByRole('button', { name: 'Select shape gate4-resize-shape' }).click(),
    ])
    const vueKeypoint = vue.locator('.shape-element-operate .operate-keypoint-handler').first()
    const reactKeypoint = react.locator('.mona-shape-keypoint-handle').first()
    await Promise.all([expect(vueKeypoint).toBeVisible(), expect(reactKeypoint).toBeVisible()])
    const [vueChrome, reactChrome] = await Promise.all([
      vueKeypoint.evaluate(element => {
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          border: style.border,
          borderRadius: Number.parseFloat(style.borderRadius),
          height: Number.parseFloat(style.height),
          width: Number.parseFloat(style.width),
        }
      }),
      reactKeypoint.evaluate(element => {
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          border: style.border,
          borderRadius: Number.parseFloat(style.borderRadius),
          height: Number.parseFloat(style.height),
          width: Number.parseFloat(style.width),
        }
      }),
    ])
    expect(reactChrome.background).toBe(vueChrome.background)
    expect(reactChrome.border).toBe(vueChrome.border)
    expect(Math.abs(reactChrome.borderRadius - vueChrome.borderRadius)).toBeLessThan(0.02)
    expect(Math.abs(reactChrome.width - vueChrome.width)).toBeLessThan(0.02)
    expect(Math.abs(reactChrome.height - vueChrome.height)).toBeLessThan(0.02)
    await Promise.all([
      dragBySlideDelta(vue, vueKeypoint, vue.locator('.viewport'), delta),
      dragBySlideDelta(react, reactKeypoint, react.locator('.mona-editor-slide-canvas'), delta),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueShape = pickElement(vueState, 4, 'gate4-resize-shape') as Extract<PPTElement, { type: 'shape' }>
    const reactShape = pickElement(reactState, 4, 'gate4-resize-shape') as Extract<PPTElement, { type: 'shape' }>
    expect(Math.abs(reactShape.keypoints![0]! - vueShape.keypoints![0]!)).toBeLessThan(1 / 130)
    expect(reactShape.path).toBe(
      SHAPE_PATH_FORMULAS[reactShape.pathFormula!].formula(reactShape.width, reactShape.height, reactShape.keypoints),
    )
    expect(vueShape.path).toBe(
      SHAPE_PATH_FORMULAS[vueShape.pathFormula!].formula(vueShape.width, vueShape.height, vueShape.keypoints),
    )
    if (delta.x === 1000) expect(reactShape.keypoints).toEqual([0.5])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches single-element resize geometry, snapping, minimums, fixed ratios, tables, and history', async ({ browser }) => {
  const scenarios = [
    { slide: 0, id: 'gate3-radial-shape', type: 'shape', handle: 'bottom-right', delta: { x: 50, y: 20 } },
    { slide: 0, id: 'gate3-radial-shape', type: 'shape', handle: 'right', delta: { x: -400, y: 0 } },
    { slide: 1, id: 'gate3-image-round', type: 'image', handle: 'bottom-right', delta: { x: 60, y: 20 } },
    { slide: 1, id: 'gate3-image-title', type: 'text', handle: 'right', delta: { x: 100, y: 0 } },
    { slide: 2, id: 'gate3-table', type: 'table', handle: 'bottom', delta: { x: 0, y: -80 } },
    { slide: 2, id: 'gate3-chart', type: 'chart', handle: 'right', delta: { x: -400, y: 0 } },
    { slide: 3, id: 'gate3-video', type: 'video', handle: 'right', delta: { x: -400, y: 0 } },
    { slide: 3, id: 'gate3-audio', type: 'audio', handle: 'bottom-right', delta: { x: 30, y: 10 } },
  ] as const
  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    if (scenario.slide) {
      await Promise.all([
        vue.locator('.thumbnail-slide').nth(scenario.slide).click(),
        react.getByRole('button', { name: `Show slide ${scenario.slide + 1}` }).click(),
      ])
    }
    await Promise.all([
      vueElement(vue, scenario.id, scenario.type).click(),
      reactElement(react, scenario.id, scenario.type).click(),
    ])
    await Promise.all([
      dragBySlideDelta(
        vue,
        vueResizeHandle(vue, scenario.type, scenario.handle),
        vue.locator('.viewport'),
        scenario.delta,
      ),
      dragBySlideDelta(
        react,
        reactResizeHandle(react, scenario.handle),
        react.locator('.mona-editor-slide-canvas'),
        scenario.delta,
      ),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expectResizeElementParity(
      pickElement(reactState, scenario.slide, scenario.id),
      pickElement(vueState, scenario.slide, scenario.id),
      `${scenario.id}.${scenario.handle}`,
    )
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches single rotation absolute angles, snapping, handle chrome, and the rotated no-move history quirk', async ({ browser }) => {
  for (const scenario of [
    { id: 'gate4-resize-shape', angle: 43, expected: 45 },
    { id: 'gate4-rotated-shape', angle: 92, expected: 90 },
    { id: 'gate4-rotated-shape', angle: -178, expected: -180 },
  ] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(4).click(),
      react.getByRole('button', { name: 'Show slide 5' }).click(),
    ])
    await Promise.all([
      vueElement(vue, scenario.id, 'shape').click(),
      react.getByRole('button', { name: `Select shape ${scenario.id}` }).click(),
    ])
    const [vueInitial, reactInitial] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueElementState = pickElement(vueInitial, 4, scenario.id) as Exclude<PPTElement, PPTLineElement>
    const reactElementState = pickElement(reactInitial, 4, scenario.id) as Exclude<PPTElement, PPTLineElement>
    expect(reactElementState).toEqual(vueElementState)
    const center = { x: vueElementState.left + vueElementState.width / 2, y: vueElementState.top + vueElementState.height / 2 }
    const vueHandle = vue.locator('.shape-element-operate .operate-rotate-handler')
    const reactHandle = react.locator('.mona-selection-frame:not(.is-secondary) > .mona-rotate-handle')
    await Promise.all([expect(vueHandle).toBeVisible(), expect(reactHandle).toBeVisible()])

    if (scenario.id === 'gate4-resize-shape') {
      const [vueChrome, reactChrome] = await Promise.all([
        vueHandle.evaluate(element => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, border: style.border, borderRadius: Number.parseFloat(style.borderRadius), cursor: style.cursor, height: Number.parseFloat(style.height), width: Number.parseFloat(style.width) }
        }),
        reactHandle.evaluate(element => {
          const style = getComputedStyle(element)
          return { background: style.backgroundColor, border: style.border, borderRadius: Number.parseFloat(style.borderRadius), cursor: style.cursor, height: Number.parseFloat(style.height), width: Number.parseFloat(style.width) }
        }),
      ])
      expect(reactChrome.background).toBe(vueChrome.background)
      expect(reactChrome.border).toBe(vueChrome.border)
      expect(reactChrome.cursor).toBe(vueChrome.cursor)
      expect(reactChrome.borderRadius).toBeCloseTo(vueChrome.borderRadius, 1)
      expect(reactChrome.width).toBeCloseTo(vueChrome.width, 1)
      expect(reactChrome.height).toBeCloseTo(vueChrome.height, 1)
    }

    await Promise.all([
      rotateToPointerAngle(vue, vueHandle, vue.locator('.viewport'), center, { absoluteAngle: scenario.angle }),
      rotateToPointerAngle(react, reactHandle, react.locator('.mona-editor-slide-canvas'), center, { absoluteAngle: scenario.angle }),
    ])
    const [vueFinal, reactFinal] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueResult = pickElement(vueFinal, 4, scenario.id)
    const reactResult = pickElement(reactFinal, 4, scenario.id)
    expectRotationElementParity(reactResult, vueResult, `${scenario.id}.${scenario.angle}`)
    expect((reactResult as Exclude<PPTElement, PPTLineElement>).rotate).toBe(scenario.expected)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }

  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(4).click(),
    react.getByRole('button', { name: 'Show slide 5' }).click(),
  ])
  await Promise.all([
    vueElement(vue, 'gate4-rotated-shape', 'shape').click(),
    react.getByRole('button', { name: 'Select shape gate4-rotated-shape' }).click(),
  ])
  const [vueBefore, reactBefore] = await Promise.all([getVueState(vue), getReactState(react)])
  await Promise.all([
    vue.locator('.shape-element-operate .operate-rotate-handler').click(),
    react.locator('.mona-selection-frame:not(.is-secondary) > .mona-rotate-handle').click(),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(pickElement(await getReactState(react), 4, 'gate4-rotated-shape')).toEqual(pickElement(reactBefore, 4, 'gate4-rotated-shape'))
  expect(pickElement(await getVueState(vue), 4, 'gate4-rotated-shape')).toEqual(pickElement(vueBefore, 4, 'gate4-rotated-shape'))
  expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
  await context.close()
})

test('matches mixed/common/line-inclusive group rotation centers, snapping, eligibility, and history', async ({ browser }) => {
  const scenarios = [
    { slide: 0, show: 1, selectId: 'gate3-gradient-shape', ids: ['gate3-gradient-shape', 'gate3-title'], reference: null, delta: 43 },
    { slide: 6, show: 7, selectId: 'gate4-common-rotation-shape', ids: ['gate4-common-rotation-shape', 'gate4-common-rotation-text'], reference: 30, delta: 12 },
    { slide: 6, show: 7, selectId: 'gate4-line-rotation-shape', ids: ['gate4-line-rotation-shape', 'gate4-line-rotation-line'], reference: 0, delta: 43 },
  ] as const
  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    if (scenario.slide) {
      await Promise.all([
        vue.locator('.thumbnail-slide').nth(scenario.slide).click(),
        react.getByRole('button', { name: `Show slide ${scenario.show}` }).click(),
      ])
    }
    await Promise.all([
      vueElement(vue, scenario.selectId, 'shape').click(),
      react.getByRole('button', { name: `Select shape ${scenario.selectId}` }).click(),
    ])
    const [vueInitial, reactInitial] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactInitial)).toEqual(normalizedVueSelection(vueInitial))
    const source = scenario.ids.map(id => pickElement(vueInitial, scenario.slide, id))
    const center = rotationCenter(source, scenario.reference ?? 0)
    const vueHandle = vue.locator('.multi-select-operate > .rotate-handler')
    const reactHandle = react.locator('.mona-selection-frame:not(.is-secondary) > .mona-rotate-handle')
    await Promise.all([expect(vueHandle).toBeVisible(), expect(reactHandle).toBeVisible()])
    await Promise.all([
      rotateToPointerAngle(vue, vueHandle, vue.locator('.viewport'), center, { deltaAngle: scenario.delta }),
      rotateToPointerAngle(react, reactHandle, react.locator('.mona-editor-slide-canvas'), center, { deltaAngle: scenario.delta }),
    ])
    const [vueFinal, reactFinal] = await Promise.all([getVueState(vue), getReactState(react)])
    scenario.ids.forEach(id => expectRotationElementParity(
      pickElement(reactFinal, scenario.slide, id),
      pickElement(vueFinal, scenario.slide, id),
      `${scenario.selectId}.${id}`,
    ))
    if (scenario.reference !== null) {
      const expected = scenario.reference === 30 ? 45 : 45
      const rect = pickElement(reactFinal, scenario.slide, scenario.ids[0]!) as Exclude<PPTElement, PPTLineElement>
      expect(rect.rotate).toBe(expected)
    }
    else {
      expect((pickElement(reactFinal, 0, 'gate3-gradient-shape') as Exclude<PPTElement, PPTLineElement>).rotate).not.toBe(45)
      expect((pickElement(reactFinal, 0, 'gate3-title') as Exclude<PPTElement, PPTLineElement>).rotate).not.toBe(45)
    }
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }

  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(6).click(),
    react.getByRole('button', { name: 'Show slide 7' }).click(),
  ])
  await Promise.all([
    vueElement(vue, 'gate4-blocked-rotation-shape', 'shape').click(),
    react.getByRole('button', { name: 'Select shape gate4-blocked-rotation-shape' }).click(),
  ])
  await expect(vue.locator('.multi-select-operate > .rotate-handler')).toHaveCount(0)
  await expect(react.locator('.mona-selection-frame:not(.is-secondary) > .mona-rotate-handle')).toHaveCount(0)
  await context.close()
})

test('matches element-menu inventory and the measured link-dialog geometry', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueShape = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactShape = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([
    vueShape.click({ button: 'right' }),
    reactShape.click({ button: 'right' }),
  ])

  const vueItems = await vue.locator('.contextmenu > .menu-content > .menu-item:not(.divider)').evaluateAll(items => items.map(item => ({
    disabled: item.classList.contains('disable'),
    label: item.querySelector(':scope > .menu-item-content > .text')?.textContent ?? '',
  })))
  const reactItems = await react.locator('.mona-editor-context-menu > .mona-context-menu-content > .mona-context-menu-entry:not(.is-divider)').evaluateAll(items => items.map(item => ({
    disabled: item.classList.contains('is-disabled'),
    label: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-label')?.textContent ?? '',
  })))
  expect(reactItems).toEqual(vueItems)

  const vueMenuStyle = await vue.locator('.contextmenu > .menu-content').evaluate(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      height: rect.height,
      padding: style.padding,
      width: rect.width,
    }
  })
  const reactMenuStyle = await react.locator('.mona-editor-context-menu > .mona-context-menu-content').evaluate(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      height: rect.height,
      padding: style.padding,
      width: rect.width,
    }
  })
  expect(reactMenuStyle).toEqual(vueMenuStyle)

  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: 'Add link' }).click(),
    react.getByRole('menuitem', { name: 'Add link', exact: true }).click(),
  ])
  await Promise.all([
    expect(vue.locator('.link-dialog')).toBeVisible(),
    expect(react.locator('.mona-link-dialog')).toBeVisible(),
  ])
  await Promise.all([vue.waitForTimeout(300), react.waitForTimeout(300)])

  const vueDialogRect = await vue.locator('.link-dialog').boundingBox()
  const reactFormRect = await react.locator('.mona-link-dialog form').boundingBox()
  expect(reactFormRect).toMatchObject({ width: vueDialogRect!.width, height: vueDialogRect!.height })
  expect(reactFormRect!.width).toBe(500)
  expect(reactFormRect!.height).toBe(136)
  const [vueButtonChrome, reactButtonChrome] = await Promise.all([
    vue.locator('.link-dialog .btns .button').first().evaluate(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return { appearance: style.appearance, border: style.border, boxSizing: style.boxSizing, fontFamily: style.fontFamily, height: rect.height, left: rect.left, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, padding: style.padding, right: rect.right, width: rect.width }
    }),
    react.locator('.mona-link-dialog-actions button').first().evaluate(element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return { appearance: style.appearance, border: style.border, boxSizing: style.boxSizing, fontFamily: style.fontFamily, height: rect.height, left: rect.left, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, padding: style.padding, right: rect.right, width: rect.width }
    }),
  ])
  expect(reactButtonChrome).toEqual(vueButtonChrome)
  const [vueWebPixels, reactWebPixels] = await Promise.all([
    vue.locator('.link-dialog').locator('..').screenshot(),
    react.locator('.mona-link-dialog').screenshot(),
  ])
  expectRasterParity(reactWebPixels, vueWebPixels, {
    maxChannelDelta: 2,
    maxExactPixelDelta: 30,
    perceptualThreshold: 0.01,
  })

  const vueSlideTab = vue.locator('.link-dialog .tab').filter({ hasText: 'Slide' })
  const reactSlideTab = react.getByRole('tab', { name: 'Slide', exact: true })
  await Promise.all([vueSlideTab.click(), reactSlideTab.click()])
  const vuePreview = vue.locator('.link-dialog .preview > .thumbnail-slide')
  await Promise.all([
    expect(vuePreview).toBeVisible(),
    expect(react.locator('.mona-link-slide-preview .mona-scaled-slide')).toBeVisible(),
  ])
  const vuePreviewRect = await vuePreview.boundingBox()
  const reactPreviewRect = await react.locator('.mona-link-slide-preview .mona-scaled-slide').boundingBox()
  expect(reactPreviewRect!.width).toBeCloseTo(vuePreviewRect!.width, 2)
  expect(reactPreviewRect!.height).toBeCloseTo(vuePreviewRect!.height, 2)
  const [vueSlidePixels, reactSlidePixels] = await Promise.all([
    vue.locator('.link-dialog').locator('..').screenshot(),
    react.locator('.mona-link-dialog').screenshot(),
  ])
  expectRasterParity(reactSlidePixels, vueSlidePixels, {
    maxChannelDelta: 4,
    maxExactPixelDelta: 9,
    perceptualThreshold: 0.014,
  })
  await context.close()
})

test('matches the complete link-editor validation, retention, target, dismissal, focus, and history flow', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const elementId = 'gate3-radial-shape'
  const vueShape = vue.locator(`#editable-element-${elementId} .editable-element-shape`)
  const reactShape = react.getByRole('button', { name: `Select shape ${elementId}` })
  const vueDialog = vue.locator('.link-dialog')
  const reactDialog = react.getByRole('dialog', { name: 'Set link' })
  const vueInput = vue.locator('.link-dialog .input input')
  const reactInput = react.locator('.mona-link-field input')

  const openLinkEditor = async () => {
    await openElementContextMenus(vueShape, reactShape)
    await clickElementMenuAction(vue, react, { reactAction: 'set-link', vueLabel: 'Add link' })
    await Promise.all([expect(vueDialog).toBeVisible(), expect(reactDialog).toBeVisible()])
  }
  const expectHotkeysDisabled = async (disabled: boolean) => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.session.disableHotkeys).toBe(disabled)
    expect(vueState.editor.disableHotkeys).toBe(disabled)
  }
  const expectLinkParity = async () => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactState, 0, elementId)).toEqual(pickElement(vueState, 0, elementId))
  }

  const initialHistory = await Promise.all([getVueHistory(vue), getReactHistory(react)])
  await openLinkEditor()
  await expectHotkeysDisabled(true)
  await Promise.all([expect(vueInput).toBeFocused(), expect(reactInput).toBeFocused()])

  await Promise.all([
    vueInput.fill('https://localhost'),
    reactInput.fill('https://localhost'),
  ])
  await pressBoth(vue, react, 'Enter')
  await Promise.all([
    expect(vue.locator('.message .description')).toHaveText('Enter a valid web address'),
    expect(react.locator('.mona-message-description')).toHaveText('Enter a valid web address'),
    expect(vueInput).toHaveValue(''),
    expect(reactInput).toHaveValue(''),
  ])
  await Promise.all([expect(vueDialog).toBeVisible(), expect(reactDialog).toBeVisible()])
  await expectLinkParity()
  expect(await getVueHistory(vue)).toEqual(initialHistory[0])
  expect(await getReactHistory(react)).toEqual(initialHistory[1])

  await pressBoth(vue, react, 'Escape')
  await Promise.all([expect(vueDialog).toHaveCount(0), expect(reactDialog).toHaveCount(0)])
  await expectHotkeysDisabled(false)
  const closedFocus = await Promise.all([
    vue.evaluate(() => document.activeElement?.tagName),
    react.evaluate(() => document.activeElement?.tagName),
  ])
  expect(closedFocus).toEqual(['BODY', 'BODY'])

  await openLinkEditor()
  const validAddress = 'https://example.com/path?a=1#x'
  await Promise.all([vueInput.fill(validAddress), reactInput.fill(validAddress)])
  await pressBoth(vue, react, 'Enter')
  await Promise.all([expect(vueDialog).toHaveCount(0), expect(reactDialog).toHaveCount(0)])
  await expectHotkeysDisabled(false)
  await expectLinkParity()
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  const historyAfterWeb = await Promise.all([getVueHistory(vue), getReactHistory(react)])
  expect(historyAfterWeb[0].cursor - initialHistory[0].cursor).toBe(1)
  expect(historyAfterWeb[0].length - initialHistory[0].length).toBe(1)
  expect(historyAfterWeb[1].cursor - initialHistory[1].cursor).toBe(1)
  expect(historyAfterWeb[1].length - initialHistory[1].length).toBe(1)

  await openLinkEditor()
  await Promise.all([expect(vueInput).toHaveValue(validAddress), expect(reactInput).toHaveValue(validAddress)])
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Slide$/ }).click(),
    react.getByRole('tab', { name: 'Slide', exact: true }).click(),
  ])
  const slideFocus = await Promise.all([
    vue.evaluate(() => document.activeElement?.className),
    react.evaluate(() => document.activeElement?.className),
  ])
  expect(slideFocus).toEqual(['modal', 'mona-link-dialog-backdrop'])
  const [vueDisabledState, reactDisabledState, vueDisabledHistory, reactDisabledHistory] = await Promise.all([
    getVueState(vue), getReactState(react), getVueHistory(vue), getReactHistory(react),
  ])
  await pressBoth(vue, react, 'Delete')
  await pressBoth(vue, react, 'Control+g')
  await pressBoth(vue, react, ' ')
  const [vueAfterDisabledKeys, reactAfterDisabledKeys] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueAfterDisabledKeys.presentation).toEqual(vueDisabledState.presentation)
  expect(reactAfterDisabledKeys.presentation).toEqual(reactDisabledState.presentation)
  expect(await getVueHistory(vue)).toEqual(vueDisabledHistory)
  expect(await getReactHistory(react)).toEqual(reactDisabledHistory)
  await Promise.all([
    expect(vue.locator('.drag-mask')).toHaveCount(0),
    expect(react.locator('.mona-editor-pan-mask')).toHaveCount(0),
  ])
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Web page$/ }).click(),
    react.getByRole('tab', { name: 'Web page', exact: true }).click(),
  ])
  await Promise.all([expect(vueInput).toHaveValue(validAddress), expect(reactInput).toHaveValue(validAddress)])
  await Promise.all([
    vue.locator('.link-dialog .btns .button').filter({ hasText: /^Cancel$/ }).click(),
    react.getByRole('button', { name: 'Cancel', exact: true }).click(),
  ])
  await Promise.all([expect(vueDialog).toHaveCount(0), expect(reactDialog).toHaveCount(0)])
  expect(await getVueHistory(vue)).toEqual(historyAfterWeb[0])
  expect(await getReactHistory(react)).toEqual(historyAfterWeb[1])

  await openLinkEditor()
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Slide$/ }).click(),
    react.getByRole('tab', { name: 'Slide', exact: true }).click(),
  ])
  const vueSelect = vue.locator('.link-dialog .select')
  const reactSelect = react.locator('.mona-link-select')
  await Promise.all([expect(vueSelect).toHaveText('Slide 2'), expect(reactSelect).toHaveText('Slide 2')])
  await Promise.all([vueSelect.click(), reactSelect.click()])
  const vueOptions = vue.locator('.tippy-box[data-theme~="popover"] .options .option')
  const reactOptions = react.locator('.mona-link-select-options .mona-link-select-option')
  await Promise.all([expect(vueOptions).toHaveCount(7), expect(reactOptions).toHaveCount(7)])
  const [vueOptionState, reactOptionState] = await Promise.all([
    vueOptions.evaluateAll(options => options.map(option => ({
      disabled: option.classList.contains('disabled'),
      label: option.textContent,
      selected: option.classList.contains('selected'),
    }))),
    reactOptions.evaluateAll(options => options.map(option => ({
      disabled: option.classList.contains('is-disabled'),
      label: option.textContent,
      selected: option.classList.contains('is-selected'),
    }))),
  ])
  expect(reactOptionState).toEqual(vueOptionState)
  expect(reactOptionState[0]).toEqual({ disabled: true, label: 'Slide 1', selected: false })
  expect(reactOptionState[1]).toEqual({ disabled: false, label: 'Slide 2', selected: true })
  const openingWidths = await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"] .popover-content').evaluate(element => element.getBoundingClientRect().width),
    react.locator('.mona-link-select-popover').evaluate(element => element.getBoundingClientRect().width),
  ])
  expect(openingWidths[0]).toBeLessThan(502)
  expect(openingWidths[1]).toBeLessThan(502)
  await Promise.all([vue.waitForTimeout(250), react.waitForTimeout(250)])
  const [vuePopoverStyle, reactPopoverStyle] = await Promise.all([
    vue.locator('.tippy-box[data-theme~="popover"] .popover-content').evaluate(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow, height: rect.height, left: rect.left, padding: style.padding, top: rect.top, width: rect.width }
    }),
    react.locator('.mona-link-select-popover').evaluate(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return { border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow, height: rect.height, left: rect.left, padding: style.padding, top: rect.top, width: rect.width }
    }),
  ])
  expect(reactPopoverStyle).toEqual(vuePopoverStyle)

  await Promise.all([vueOptions.nth(2).click(), reactOptions.nth(2).click()])
  await Promise.all([expect(vueSelect).toHaveText('Slide 3'), expect(reactSelect).toHaveText('Slide 3')])
  await Promise.all([
    vue.locator('.link-dialog .btns .button').filter({ hasText: /^Confirm$/ }).click(),
    react.getByRole('button', { name: 'Confirm', exact: true }).click(),
  ])
  await Promise.all([expect(vueDialog).toHaveCount(0), expect(reactDialog).toHaveCount(0)])
  await expectLinkParity()
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  const historyAfterSlide = await Promise.all([getVueHistory(vue), getReactHistory(react)])
  expect(historyAfterSlide[0].cursor - historyAfterWeb[0].cursor).toBe(1)
  expect(historyAfterSlide[0].length - historyAfterWeb[0].length).toBe(1)
  expect(historyAfterSlide[1].cursor - historyAfterWeb[1].cursor).toBe(1)
  expect(historyAfterSlide[1].length - historyAfterWeb[1].length).toBe(1)

  await openLinkEditor()
  await Promise.all([
    expect(vue.locator('.link-dialog .tab.active')).toHaveText('Slide'),
    expect(react.locator('.mona-link-type-tab[aria-selected="true"]')).toHaveText('Slide'),
    expect(vueSelect).toHaveText('Slide 3'),
    expect(reactSelect).toHaveText('Slide 3'),
  ])
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Web page$/ }).click(),
    react.getByRole('tab', { name: 'Web page', exact: true }).click(),
  ])
  const retainedAddress = 'https://retained.example.com'
  await Promise.all([vueInput.fill(retainedAddress), reactInput.fill(retainedAddress)])
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Slide$/ }).click(),
    react.getByRole('tab', { name: 'Slide', exact: true }).click(),
  ])
  await Promise.all([expect(vueSelect).toHaveText('Slide 3'), expect(reactSelect).toHaveText('Slide 3')])
  await Promise.all([
    vue.locator('.link-dialog .tab').filter({ hasText: /^Web page$/ }).click(),
    react.getByRole('tab', { name: 'Web page', exact: true }).click(),
  ])
  await Promise.all([expect(vueInput).toHaveValue(retainedAddress), expect(reactInput).toHaveValue(retainedAddress)])
  await Promise.all([
    vue.locator('.modal:has(.link-dialog) > .mask').click({ position: { x: 5, y: 5 } }),
    react.locator('.mona-link-dialog-backdrop').click({ position: { x: 5, y: 5 } }),
  ])
  await Promise.all([expect(vueDialog).toHaveCount(0), expect(reactDialog).toHaveCount(0)])
  await expectHotkeysDisabled(false)
  await expectLinkParity()
  expect(await getVueHistory(vue)).toEqual(historyAfterSlide[0])
  expect(await getReactHistory(react)).toEqual(historyAfterSlide[1])
  await context.close()
})

test('matches the complete canvas-menu inventory, raster, submenu, checks, dismissal, and overflow behavior', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueMenu = vue.locator('.contextmenu')
  const reactMenu = react.getByRole('menu', { name: 'Canvas menu' })
  const menuState = async () => Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').evaluateAll(items => items.map(item => item.classList.contains('divider')
      ? { divider: true }
      : {
        disabled: item.classList.contains('disable'),
        label: item.querySelector(':scope > .menu-item-content > .text')?.textContent ?? '',
        shortcut: item.querySelector(':scope > .menu-item-content > .sub-text')?.textContent ?? '',
      })),
    react.locator('.mona-editor-context-menu > .mona-context-menu-content > .mona-context-menu-entry').evaluateAll(items => items.map(item => item.classList.contains('is-divider')
      ? { divider: true }
      : {
        disabled: item.classList.contains('is-disabled'),
        label: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-label')?.textContent ?? '',
        shortcut: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-shortcut')?.textContent ?? '',
      })),
  ])

  await openCanvasContextMenus(vue, react)
  let [vueItems, reactItems] = await menuState()
  expect(reactItems).toEqual(vueItems)
  expect(reactItems).toEqual([
    { disabled: false, label: 'Paste', shortcut: 'Ctrl + V' },
    { disabled: false, label: 'Select all', shortcut: 'Ctrl + A' },
    { disabled: false, label: 'Ruler', shortcut: '' },
    { disabled: false, label: 'Grid lines', shortcut: '' },
    { disabled: false, label: 'Reset current slide', shortcut: '' },
    { disabled: false, label: 'Floating toolbar', shortcut: '' },
    { divider: true },
    { disabled: false, label: 'Start slideshow', shortcut: 'F5' },
  ])
  const [vueCanvasMenuPixels, reactCanvasMenuPixels] = await Promise.all([
    vue.locator('.contextmenu > .menu-content').screenshot(),
    react.locator('.mona-editor-context-menu > .mona-context-menu-content').screenshot(),
  ])
  expectRasterParity(reactCanvasMenuPixels, vueCanvasMenuPixels, {
    maxChannelDelta: 14,
    maxExactPixelDelta: 2,
    perceptualThreshold: 0.1,
    ignoredCornerRadius: 2,
  })

  const vueGridParent = vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Grid lines/ })
  const reactGridParent = react.locator('.mona-editor-context-menu [data-action="grid-toggle"]').first()
  await Promise.all([vueGridParent.hover(), reactGridParent.hover()])
  const vueGridItems = vueGridParent.locator('.sub-menu > .menu-item')
  const reactGridItems = reactGridParent.locator('.mona-editor-context-submenu > .mona-context-menu-entry')
  const [vueGridState, reactGridState] = await Promise.all([
    vueGridItems.evaluateAll(items => items.map(item => ({
      label: item.querySelector(':scope > .menu-item-content > .text')?.textContent ?? '',
      shortcut: item.querySelector(':scope > .menu-item-content > .sub-text')?.textContent ?? '',
    }))),
    reactGridItems.evaluateAll(items => items.map(item => ({
      label: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-label')?.textContent ?? '',
      shortcut: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-shortcut')?.textContent ?? '',
    }))),
  ])
  expect(reactGridState).toEqual(vueGridState)
  expect(reactGridState).toEqual([
    { label: 'None', shortcut: '√' },
    { label: 'Small', shortcut: '' },
    { label: 'Medium', shortcut: '' },
    { label: 'Large', shortcut: '' },
  ])
  await Promise.all([vue.waitForTimeout(150), react.waitForTimeout(150)])
  const [vueGridPixels, reactGridPixels] = await Promise.all([
    vueGridParent.locator('.sub-menu').screenshot(),
    reactGridParent.locator('.mona-editor-context-submenu').screenshot(),
  ])
  expectRasterParity(reactGridPixels, vueGridPixels, {
    maxChannelDelta: 0,
    maxExactPixelDelta: 0,
    perceptualThreshold: 0,
    ignoredCornerRadius: 2,
  })

  const histories = await Promise.all([getVueHistory(vue), getReactHistory(react)])
  await Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item').filter({ hasText: /^Floating toolbar/ }).click(),
    react.locator('.mona-editor-context-menu [data-action="bubble-menu"]').click(),
  ])
  await Promise.all([
    expect(vue.locator('.message .description')).toHaveText('Floating toolbar Enabled'),
    expect(react.locator('.mona-message-description')).toHaveText('Floating toolbar Enabled'),
  ])
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.session.showBubbleMenu).toBe(true)
  expect(reactState.session.showBubbleMenu).toBe(vueState.editor.showBubbleMenu)
  expect(await getVueHistory(vue)).toEqual(histories[0])
  expect(await getReactHistory(react)).toEqual(histories[1])

  await openCanvasContextMenus(vue, react)
  ;[vueItems, reactItems] = await menuState()
  expect(reactItems).toEqual(vueItems)
  expect(reactItems[5]).toEqual({ disabled: false, label: 'Floating toolbar', shortcut: '√' })
  await Promise.all([
    vue.locator('.contextmenu-mask').click({ position: { x: 5, y: 5 } }),
    react.locator('.mona-editor-context-menu-mask').click({ position: { x: 5, y: 5 } }),
  ])
  await Promise.all([expect(vueMenu).toHaveCount(0), expect(reactMenu).toHaveCount(0)])

  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.locator('.contextmenu-mask').click({ button: 'right', position: { x: 5, y: 5 } }),
    react.locator('.mona-editor-context-menu-mask').click({ button: 'right', position: { x: 5, y: 5 } }),
  ])
  await Promise.all([expect(vueMenu).toHaveCount(0), expect(reactMenu).toHaveCount(0)])

  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.evaluate(() => window.dispatchEvent(new Event('blur'))),
    react.evaluate(() => window.dispatchEvent(new Event('blur'))),
  ])
  await Promise.all([expect(vueMenu).toBeVisible(), expect(reactMenu).toBeVisible()])
  await Promise.all([
    vue.evaluate(() => document.body.dispatchEvent(new Event('scroll'))),
    react.evaluate(() => document.body.dispatchEvent(new Event('scroll'))),
  ])
  await Promise.all([expect(vueMenu).toHaveCount(0), expect(reactMenu).toHaveCount(0)])

  await openCanvasContextMenus(vue, react)
  await Promise.all([
    vue.evaluate(() => window.dispatchEvent(new Event('resize'))),
    react.evaluate(() => window.dispatchEvent(new Event('resize'))),
  ])
  await Promise.all([expect(vueMenu).toHaveCount(0), expect(reactMenu).toHaveCount(0)])

  await Promise.all([
    vue.locator('.canvas').evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: document.body.clientWidth - 1,
      clientY: document.body.clientHeight - 1,
    }))),
    react.getByRole('application', { name: 'Editable slide canvas' }).evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: document.body.clientWidth - 1,
      clientY: document.body.clientHeight - 1,
    }))),
  ])
  await Promise.all([expect(vueMenu).toBeVisible(), expect(reactMenu).toBeVisible()])
  const [vueOverflowRect, reactOverflowRect] = await Promise.all([
    vueMenu.boundingBox(),
    reactMenu.boundingBox(),
  ])
  expect(reactOverflowRect).toEqual(vueOverflowRect)
  await context.close()
})

test('matches element-menu eligibility for single, grouped, mixed, disabled, and locked selections', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const menuEntries = async () => Promise.all([
    vue.locator('.contextmenu > .menu-content > .menu-item:not(.divider)').evaluateAll(items => items.map(item => ({
      disabled: item.classList.contains('disable'),
      label: item.querySelector(':scope > .menu-item-content > .text')?.textContent ?? '',
    }))),
    react.locator('.mona-editor-context-menu > .mona-context-menu-content > .mona-context-menu-entry:not(.is-divider)').evaluateAll(items => items.map(item => ({
      disabled: item.classList.contains('is-disabled'),
      label: item.querySelector(':scope > .mona-context-menu-item-content > .mona-context-menu-label')?.textContent ?? '',
    }))),
  ])
  const dismiss = async () => Promise.all([
    vue.locator('.contextmenu-mask').click({ position: { x: 5, y: 5 } }),
    react.locator('.mona-editor-context-menu-mask').click({ position: { x: 5, y: 5 } }),
  ])

  const vueRadial = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactRadial = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await openElementContextMenus(vueRadial, reactRadial)
  let [vueEntries, reactEntries] = await menuEntries()
  expect(reactEntries).toEqual(vueEntries)
  expect(reactEntries.some(entry => entry.label === 'Group' || entry.label === 'Ungroup')).toBe(false)
  expect(reactEntries.find(entry => entry.label === 'Bring to front')?.disabled).toBe(false)
  const [vueElementPixels, reactElementPixels] = await Promise.all([
    vue.locator('.contextmenu > .menu-content').screenshot(),
    react.locator('.mona-editor-context-menu > .mona-context-menu-content').screenshot(),
  ])
  expectRasterParity(reactElementPixels, vueElementPixels, {
    maxChannelDelta: 14,
    maxExactPixelDelta: 2,
    perceptualThreshold: 0.1,
    ignoredCornerRadius: 2,
  })
  await dismiss()

  const vueGrouped = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
  const reactGrouped = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
  await openElementContextMenus(vueGrouped, reactGrouped)
  ;[vueEntries, reactEntries] = await menuEntries()
  expect(reactEntries).toEqual(vueEntries)
  expect(reactEntries.find(entry => entry.label === 'Ungroup')?.disabled).toBe(false)
  expect(reactEntries.find(entry => entry.label === 'Bring to front')?.disabled).toBe(false)
  await dismiss()

  const vueOutside = vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape')
  const reactOutside = react.getByRole('button', { name: 'Select shape gate3-pattern-shape' })
  await Promise.all([
    vueOutside.click({ modifiers: ['Shift'] }),
    reactOutside.click({ modifiers: ['Shift'] }),
  ])
  await openElementContextMenus(vueOutside, reactOutside)
  ;[vueEntries, reactEntries] = await menuEntries()
  expect(reactEntries).toEqual(vueEntries)
  expect(reactEntries.find(entry => entry.label === 'Group')?.disabled).toBe(false)
  expect(reactEntries.find(entry => entry.label === 'Bring to front')?.disabled).toBe(true)
  const vueDisabledOrder = vue.locator('.contextmenu > .menu-content > .menu-item.disable').filter({ hasText: /^Bring to front/ })
  const reactDisabledOrder = react.locator('.mona-editor-context-menu > .mona-context-menu-content > [data-action="bring-front"]')
  await Promise.all([vueDisabledOrder.dispatchEvent('click'), reactDisabledOrder.dispatchEvent('click')])
  await Promise.all([
    expect(vue.locator('.contextmenu')).toBeVisible(),
    expect(react.getByRole('menu', { name: 'Element menu' })).toBeVisible(),
  ])
  await Promise.all([vueDisabledOrder.hover(), reactDisabledOrder.hover()])
  await Promise.all([
    expect(vueDisabledOrder.locator('.sub-menu')).toBeHidden(),
    expect(reactDisabledOrder.locator('.mona-editor-context-submenu')).toBeHidden(),
  ])
  await dismiss()

  await openElementContextMenus(vueGrouped, reactGrouped)
  ;[vueEntries, reactEntries] = await menuEntries()
  expect(reactEntries).toEqual(vueEntries)
  expect(reactEntries.find(entry => entry.label === 'Ungroup')?.disabled).toBe(false)
  expect(reactEntries.find(entry => entry.label === 'Bring to front')?.disabled).toBe(false)
  await dismiss()

  await openElementContextMenus(vueRadial, reactRadial)
  await clickElementMenuAction(vue, react, { reactAction: 'lock', vueLabel: 'Lock' })
  await openElementContextMenus(vueRadial, reactRadial)
  ;[vueEntries, reactEntries] = await menuEntries()
  expect(reactEntries).toEqual(vueEntries)
  expect(reactEntries).toEqual([{ disabled: false, label: 'Unlock' }])
  const [vueLockedPixels, reactLockedPixels] = await Promise.all([
    vue.locator('.contextmenu > .menu-content').screenshot(),
    react.locator('.mona-editor-context-menu > .mona-context-menu-content').screenshot(),
  ])
  expectRasterParity(reactLockedPixels, vueLockedPixels, {
    maxChannelDelta: 14,
    maxExactPixelDelta: 2,
    perceptualThreshold: 0.1,
    ignoredCornerRadius: 2,
  })
  await context.close()
})

test('matches all seven canvas-alignment commands on a rotated mixed group', async ({ browser }) => {
  const scenarios = [
    { action: 'align-center', parent: 'Center horizontally', parentAction: 'align-horizontal', label: 'Center horizontally and vertically' },
    { action: 'align-horizontal', parent: 'Center horizontally', parentAction: 'align-horizontal', label: 'Center horizontally' },
    { action: 'align-left', parent: 'Center horizontally', parentAction: 'align-horizontal', label: 'Align left' },
    { action: 'align-right', parent: 'Center horizontally', parentAction: 'align-horizontal', label: 'Align right' },
    { action: 'align-vertical', parent: 'Center vertically', parentAction: 'align-vertical', label: 'Center vertically' },
    { action: 'align-top', parent: 'Center vertically', parentAction: 'align-vertical', label: 'Align top' },
    { action: 'align-bottom', parent: 'Center vertically', parentAction: 'align-vertical', label: 'Align bottom' },
  ] as const

  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
    const [vueHistory, reactHistory] = await Promise.all([getVueHistory(vue), getReactHistory(react)])
    await openElementContextMenus(vueTarget, reactTarget)
    await clickElementMenuAction(vue, react, {
      parentLabel: scenario.parent,
      reactAction: scenario.action,
      reactParentAction: scenario.parentAction,
      vueLabel: scenario.label,
    })
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getVueHistory(vue)).toEqual({ cursor: vueHistory.cursor + 1, length: vueHistory.length + 1 })
    expect(await getReactHistory(react)).toEqual({ cursor: reactHistory.cursor + 1, length: reactHistory.length + 1 })
    await context.close()
  }

  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await openLineContextMenus(vue, react.getByRole('button', { name: 'Select line gate3-line' }), 'gate3-line')
  await clickElementMenuAction(vue, react, {
    parentLabel: 'Center horizontally',
    reactAction: 'align-center',
    reactParentAction: 'align-horizontal',
    vueLabel: 'Center horizontally and vertically',
  })
  const [vueLineState, reactLineState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactLineState.presentation.slides[0]!.elements).toEqual(vueLineState.presentation.slides[0]!.elements)
  await context.close()
})

test('matches all layer commands, selected-group atomicity, neighboring-group skips, and edge no-ops', async ({ browser }) => {
  const scenarios = [
    { target: 'gate3-gradient-shape', type: 'shape', action: 'bring-front', label: 'Bring to front', changed: true },
    { target: 'gate3-gradient-shape', type: 'shape', action: 'bring-forward', label: 'Move forward', parent: 'Bring to front', parentAction: 'bring-front', changed: true },
    { target: 'gate3-line', type: 'line', action: 'send-back', label: 'Send to back', changed: true },
    { target: 'gate3-line', type: 'line', action: 'send-backward', label: 'Move backward', parent: 'Send to back', parentAction: 'send-back', changed: true },
    { target: 'gate3-gradient-shape', type: 'shape', action: 'send-backward', label: 'Move backward', parent: 'Send to back', parentAction: 'send-back', changed: false },
    { target: 'gate3-pattern-shape', type: 'shape', action: 'bring-forward', label: 'Move forward', parent: 'Bring to front', parentAction: 'bring-front', changed: false },
  ] as const

  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = scenario.type === 'line'
      ? vue.locator(`#editable-element-${scenario.target} .line-point`)
      : vue.locator(`#editable-element-${scenario.target} .editable-element-shape`)
    const reactTarget = react.getByRole('button', { name: `Select ${scenario.type} ${scenario.target}` })
    const [vueBefore, reactBefore, vueHistory, reactHistory] = await Promise.all([
      getVueState(vue), getReactState(react), getVueHistory(vue), getReactHistory(react),
    ])
    if (scenario.type === 'line') await openLineContextMenus(vue, reactTarget, scenario.target)
    else await openElementContextMenus(vueTarget, reactTarget)
    await clickElementMenuAction(vue, react, {
      parentLabel: scenario.parent,
      reactAction: scenario.action,
      reactParentAction: scenario.parentAction,
      vueLabel: scenario.label,
    })
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements.map(element => element.id)).toEqual(
      vueState.presentation.slides[0]!.elements.map(element => element.id),
    )
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    if (!scenario.changed) {
      expect(reactState.presentation.slides[0]!.elements).toEqual(reactBefore.presentation.slides[0]!.elements)
      expect(vueState.presentation.slides[0]!.elements).toEqual(vueBefore.presentation.slides[0]!.elements)
    }
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getVueHistory(vue)).toEqual(scenario.changed
      ? { cursor: vueHistory.cursor + 1, length: vueHistory.length + 1 }
      : vueHistory)
    expect(await getReactHistory(react)).toEqual(scenario.changed
      ? { cursor: reactHistory.cursor + 1, length: reactHistory.length + 1 }
      : reactHistory)
    await context.close()
  }
})

test('matches grouping insertion, ungroup reset, lock clearing, and clicked-group unlock restoration', async ({ browser }) => {
  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape').click(),
      react.getByRole('button', { name: 'Select shape gate3-gradient-shape' }).click(),
    ])
    await Promise.all([
      vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape').click({ modifiers: ['Shift'] }),
      react.getByRole('button', { name: 'Select shape gate3-pattern-shape' }).click({ modifiers: ['Shift'] }),
    ])
    const [vueSelected, reactSelected] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactSelected)).toEqual(normalizedVueSelection(vueSelected))
    expect(normalizedReactSelection(reactSelected).activeElementIds).toEqual([
      'gate3-gradient-shape', 'gate3-pattern-shape', 'gate3-title',
    ])
    await openElementContextMenus(
      vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape'),
      react.getByRole('button', { name: 'Select shape gate3-pattern-shape' }),
    )
    const [vueMenuState, reactMenuState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactMenuState)).toEqual(normalizedVueSelection(vueMenuState))
    expect(normalizedReactSelection(reactMenuState).activeElementIds).toHaveLength(3)
    await expect(react.locator('.mona-editor-context-menu [data-action="group"]')).toHaveCount(1)
    await clickElementMenuAction(vue, react, { reactAction: 'group', vueLabel: 'Group' })
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements.map(element => element.id)).toEqual([
      'gate3-line', 'gate3-radial-shape', 'gate3-gradient-shape', 'gate3-title', 'gate3-pattern-shape',
    ])
    expect(normalizeGeneratedGroups(reactState.presentation.slides[0]!.elements)).toEqual(
      normalizeGeneratedGroups(vueState.presentation.slides[0]!.elements),
    )
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    await expect.poll(async () => JSON.stringify(await getReactHistory(react)) === JSON.stringify(await getVueHistory(vue))).toBe(true)
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }

  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
    await openElementContextMenus(vueTarget, reactTarget)
    await clickElementMenuAction(vue, react, { reactAction: 'ungroup', vueLabel: 'Ungroup' })
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(pickElement(reactState, 0, 'gate3-gradient-shape').groupId).toBeUndefined()
    expect(pickElement(reactState, 0, 'gate3-title').groupId).toBeUndefined()
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual(['gate3-gradient-shape'])
    await context.close()
  }

  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-gradient-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-gradient-shape' })
    await openElementContextMenus(vueTarget, reactTarget)
    await clickElementMenuAction(vue, react, { reactAction: 'lock', vueLabel: 'Lock' })
    let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    for (const id of ['gate3-gradient-shape', 'gate3-title']) {
      expect(pickElement(reactState, 0, id)).toEqual(pickElement(vueState, 0, id))
      expect(pickElement(reactState, 0, id).lock).toBe(true)
    }
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual([])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])

    await openElementContextMenus(vueTarget, reactTarget)
    const vueLockedItems = await vue.locator('.contextmenu > .menu-content > .menu-item:not(.divider)').allTextContents()
    const reactLockedItems = await react.locator('.mona-editor-context-menu > .mona-context-menu-content > .mona-context-menu-entry:not(.is-divider) .mona-context-menu-label').allTextContents()
    expect(vueLockedItems.map(value => value.trim())).toEqual(['Unlock'])
    expect(reactLockedItems).toEqual(['Unlock'])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual([])
    await clickElementMenuAction(vue, react, { reactAction: 'unlock', vueLabel: 'Unlock' })
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual(['gate3-gradient-shape', 'gate3-title'])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    await expect.poll(async () => JSON.stringify(await getReactHistory(react)) === JSON.stringify(await getVueHistory(vue))).toBe(true)
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches grouping, ungrouping, locking, and layer keyboard commands including source edge cases', async ({ browser }) => {
  test.slow()
  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
    await Promise.all([vueTarget.click(), reactTarget.click()])
    const [vueInitialHistory, reactInitialHistory] = await Promise.all([getVueHistory(vue), getReactHistory(react)])

    // PPTist's global shortcut deliberately permits a one-element group even
    // though the context menu hides Group for the same selection.
    await pressBoth(vue, react, 'Control+g')
    let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizeGeneratedGroups(reactState.presentation.slides[0]!.elements)).toEqual(
      normalizeGeneratedGroups(vueState.presentation.slides[0]!.elements),
    )
    expect(pickElement(reactState, 0, 'gate3-radial-shape').groupId).toBeTruthy()
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getVueHistory(vue)).toEqual({ cursor: vueInitialHistory.cursor + 1, length: vueInitialHistory.length + 1 })
    expect(await getReactHistory(react)).toEqual({ cursor: reactInitialHistory.cursor + 1, length: reactInitialHistory.length + 1 })

    await pressBoth(vue, react, 'Control+Shift+g')
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(pickElement(reactState, 0, 'gate3-radial-shape').groupId).toBeUndefined()
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState)).toEqual({
      activeElementIds: ['gate3-radial-shape'],
      activeGroupElementId: null,
      handleElementId: 'gate3-radial-shape',
    })
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }

  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTitle = vue.locator('#editable-element-gate3-title .editable-element-text')
    const reactTitle = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-title"] .mona-text-content')
    await openElementContextMenus(vueTitle, reactTitle)
    await Promise.all([
      vue.locator('.contextmenu-mask').click({ position: { x: 5, y: 5 } }),
      react.locator('.mona-editor-context-menu-mask').click({ position: { x: 5, y: 5 } }),
    ])
    let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).handleElementId).toBe('gate3-title')
    expect(vueState.editor.disableHotkeys).toBe(false)
    expect(reactState.session.disableHotkeys).toBe(false)

    // Ungroup must restore the active handle, not the first group member.
    await pressBoth(vue, react, 'Control+Shift+g')
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual(['gate3-title'])
    await context.close()
  }

  for (const modifier of ['Control', 'Meta'] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
    await Promise.all([vueTarget.click(), reactTarget.click()])
    await pressBoth(vue, react, `${modifier}+g`)
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizeGeneratedGroups(reactState.presentation.slides[0]!.elements)).toEqual(
      normalizeGeneratedGroups(vueState.presentation.slides[0]!.elements),
    )
    await context.close()
  }

  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueTarget = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
    const reactTarget = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
    await Promise.all([
      vueTarget.click(),
      reactTarget.click(),
    ])
    await Promise.all([
      vue.locator('#editable-element-gate3-pattern-shape .editable-element-shape').click({ modifiers: ['Shift'] }),
      react.getByRole('button', { name: 'Select shape gate3-pattern-shape' }).click({ modifiers: ['Shift'] }),
    ])
    const [vueBeforeLock, reactBeforeLock] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactBeforeLock)).toEqual(normalizedVueSelection(vueBeforeLock))
    expect(normalizedReactSelection(reactBeforeLock).activeElementIds).toEqual([
      'gate3-pattern-shape',
      'gate3-radial-shape',
    ])
    expect(reactBeforeLock.session.canvasFocus).toBe(true)
    expect(reactBeforeLock.session.disableHotkeys).toBe(false)
    await pressBoth(vue, react, 'Control+l')
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState).activeElementIds).toEqual([])
    await context.close()
  }

  for (const scenario of [
    { key: 'Alt+f', target: 'gate3-radial-shape', type: 'shape' },
    { key: 'Alt+b', target: 'gate3-line', type: 'line' },
  ] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const reactTarget = react.getByRole('button', { name: `Select ${scenario.type} ${scenario.target}` })
    if (scenario.type === 'line') await Promise.all([selectVueLine(vue, scenario.target), reactTarget.click()])
    else {
      await Promise.all([
        vue.locator(`#editable-element-${scenario.target} .editable-element-shape`).click({ force: true, position: { x: 20, y: 20 } }),
        reactTarget.click({ force: true, position: { x: 20, y: 20 } }),
      ])
    }
    await pressBoth(vue, react, scenario.key)
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(reactState.presentation.slides[0]!.elements).toEqual(vueState.presentation.slides[0]!.elements)
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    await context.close()
  }
})

test('matches keyboard quick-duplicate offsets, identity remapping, selection, and history', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const { react, vue } = await openEditors(context)
  const vueTarget = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactTarget = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([vueTarget.click(), reactTarget.click()])
  const [vueBefore, reactBefore, vueHistory, reactHistory] = await Promise.all([
    getVueState(vue), getReactState(react), getVueHistory(vue), getReactHistory(react),
  ])
  const original = pickElement(vueBefore, 0, 'gate3-radial-shape')
  expect(pickElement(reactBefore, 0, 'gate3-radial-shape')).toEqual(original)

  for (let duplicateIndex = 1; duplicateIndex <= 2; duplicateIndex += 1) {
    // Run sequentially because both applications correctly use the native OS
    // clipboard; concurrent writes would make the test itself race.
    await vue.keyboard.press('Control+d')
    await expect.poll(async () => (await getVueState(vue)).presentation.slides[0]!.elements.length).toBe(
      vueBefore.presentation.slides[0]!.elements.length + duplicateIndex,
    )
    await react.keyboard.press('Control+d')
    await expect.poll(async () => (await getReactState(react)).presentation.slides[0]!.elements.length).toBe(
      reactBefore.presentation.slides[0]!.elements.length + duplicateIndex,
    )
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(vueState.editor.activeElementIdList).toHaveLength(1)
    expect(reactState.session.activeElementIds).toHaveLength(1)
    const vueCopy = pickElement(vueState, 0, vueState.editor.activeElementIdList[0]!)
    const reactCopy = pickElement(reactState, 0, reactState.session.activeElementIds[0]!)
    expect(vueCopy.id).not.toBe(original.id)
    expect(reactCopy.id).not.toBe(original.id)
    expect(elementWithoutGeneratedIdentity(reactCopy)).toEqual(elementWithoutGeneratedIdentity(vueCopy))
    expect(reactCopy.left).toBe(original.left + duplicateIndex * 10)
    expect(reactCopy.top).toBe(original.top + duplicateIndex * 10)
    expect(normalizedReactSelection(reactState).activeElementIds).toHaveLength(1)
    expect(normalizedVueSelection(vueState).activeElementIds).toHaveLength(1)
  }

  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await getVueHistory(vue)).toEqual({ cursor: vueHistory.cursor + 1, length: vueHistory.length + 1 })
  expect(await getReactHistory(react)).toEqual({ cursor: reactHistory.cursor + 1, length: reactHistory.length + 1 })
  await context.close()
})

test('reads the exact encrypted element clipboard format in both Vue-to-React directions', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  const dispatchPaste = (page: Page, text: string) => page.evaluate(value => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', value)
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, text)

  await vue.keyboard.press('Control+c')
  const vuePayload = await vue.evaluate(() => navigator.clipboard.readText())
  expect(vuePayload).not.toContain('gate3-radial-shape')
  await dispatchPaste(react, vuePayload)
  let reactState = await getReactState(react)
  const reactCopy = pickElement(reactState, 0, reactState.session.activeElementIds[0]!)
  expect(reactCopy.left).toBe(360)
  expect(reactCopy.top).toBe(305)

  await react.keyboard.press('Control+c')
  const reactPayload = await react.evaluate(() => navigator.clipboard.readText())
  expect(reactPayload).not.toContain(reactCopy.id)
  await dispatchPaste(vue, reactPayload)
  const vueState = await getVueState(vue)
  const vueCopy = pickElement(vueState, 0, vueState.editor.activeElementIdList[0]!)
  expect(elementWithoutGeneratedIdentity(vueCopy)).toEqual(elementWithoutGeneratedIdentity(reactCopy))
  reactState = await getReactState(react)
  expect(reactState.presentation.slides[0]!.elements).toHaveLength(vueState.presentation.slides[0]!.elements.length)
  await context.close()
})

test('matches thumbnail keyboard copy, paste, duplicate, cut, delete, create, and select-all commands', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(1).click(),
    react.getByRole('button', { name: 'Show slide 2' }).click(),
  ])
  // ResizeObserver delivery is scheduled independently in the two page event
  // loops. Settle the source-owned auto-height before freezing the slide that
  // the thumbnail commands copy.
  await expect.poll(async () => pickElement(await getVueState(vue), 1, 'gate3-image-title').height).toBe(77)
  await expect.poll(async () => pickElement(await getReactState(react), 1, 'gate3-image-title').height).toBe(77)
  const [vueInitial, reactInitial, vueInitialHistory, reactInitialHistory] = await Promise.all([
    getVueState(vue), getReactState(react), getVueHistory(vue), getReactHistory(react),
  ])
  expect(vueInitial.editor.thumbnailsFocus).toBe(true)
  expect(reactInitial.session.thumbnailsFocus).toBe(true)

  await vue.keyboard.press('Control+d')
  await expect.poll(async () => (await getVueState(vue)).presentation.slides.length).toBe(vueInitial.presentation.slides.length + 1)
  await react.keyboard.press('Control+d')
  await expect.poll(async () => (await getReactState(react)).presentation.slides.length).toBe(reactInitial.presentation.slides.length + 1)
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slideIndex).toBe(vueState.presentation.slideIndex)
  expect(slideWithoutGeneratedIdentity(reactState.presentation.slides[reactState.presentation.slideIndex]!)).toEqual(
    slideWithoutGeneratedIdentity(reactInitial.presentation.slides[1]!),
  )
  expect(slideWithoutGeneratedIdentity(vueState.presentation.slides[vueState.presentation.slideIndex]!)).toEqual(
    slideWithoutGeneratedIdentity(vueInitial.presentation.slides[1]!),
  )
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await getVueHistory(vue)).toEqual({ cursor: vueInitialHistory.cursor + 1, length: vueInitialHistory.length + 1 })
  expect(await getReactHistory(react)).toEqual({ cursor: reactInitialHistory.cursor + 1, length: reactInitialHistory.length + 1 })

  await vue.keyboard.press('Control+c')
  const vueClipboard = await vue.evaluate(() => navigator.clipboard.readText())
  await vue.evaluate(text => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, vueClipboard)
  await expect.poll(async () => (await getVueState(vue)).presentation.slides.length).toBe(vueInitial.presentation.slides.length + 2)
  await react.keyboard.press('Control+c')
  const reactClipboard = await react.evaluate(() => navigator.clipboard.readText())
  await react.evaluate(text => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
  }, reactClipboard)
  await expect.poll(async () => (await getReactState(react)).presentation.slides.length).toBe(reactInitial.presentation.slides.length + 2)
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slideIndex).toBe(vueState.presentation.slideIndex)
  expect(slideWithoutGeneratedIdentity(reactState.presentation.slides[reactState.presentation.slideIndex]!)).toEqual(
    slideWithoutGeneratedIdentity(reactInitial.presentation.slides[1]!),
  )
  expect(slideWithoutGeneratedIdentity(vueState.presentation.slides[vueState.presentation.slideIndex]!)).toEqual(
    slideWithoutGeneratedIdentity(vueInitial.presentation.slides[1]!),
  )

  await vue.keyboard.press('Control+x')
  await expect.poll(async () => (await getVueState(vue)).presentation.slides.length).toBe(vueInitial.presentation.slides.length + 1)
  await react.keyboard.press('Control+x')
  await expect.poll(async () => (await getReactState(react)).presentation.slides.length).toBe(reactInitial.presentation.slides.length + 1)
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slideIndex).toBe(vueState.presentation.slideIndex)

  await Promise.all([vue.keyboard.press('Enter'), react.keyboard.press('Enter')])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slides.length).toBe(vueState.presentation.slides.length)
  expect(slideWithoutGeneratedIdentity(reactState.presentation.slides[reactState.presentation.slideIndex]!)).toEqual(
    slideWithoutGeneratedIdentity(vueState.presentation.slides[vueState.presentation.slideIndex]!),
  )

  await Promise.all([vue.keyboard.press('Backspace'), react.keyboard.press('Backspace')])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slides.length).toBe(vueState.presentation.slides.length)
  expect(reactState.presentation.slideIndex).toBe(vueState.presentation.slideIndex)

  await Promise.all([vue.keyboard.press('Control+a'), react.keyboard.press('Control+a')])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect([...reactState.session.selectedSlideIndexes].sort((a, b) => a - b)).toEqual(
    [...vueState.editor.selectedSlidesIndex].sort((a, b) => a - b),
  )
  expect(reactState.session.selectedSlideIndexes).toHaveLength(reactState.presentation.slides.length)
  expect(normalizedReactSelection(reactState).activeElementIds).toEqual([])
  expect(normalizedVueSelection(vueState).activeElementIds).toEqual([])
  await context.close()
})

test('matches synchronous plain-text, URL, and Shift paste interpretation before rich-text measurement', async ({ browser }) => {
  for (const scenario of [
    { text: 'Alpha\nBeta', expectedContent: '<div>Alpha</div><div>Beta</div>', shift: false },
    {
      text: 'https://example.com/path?a=1',
      expectedContent: '<a href="https://example.com/path?a=1" title="https://example.com/path?a=1" target="_blank">https://example.com/path?a=1</a>',
      shift: false,
    },
    {
      text: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><path d="M0 0h4v3H0z"/></svg>',
      expectedContent: '<div><svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><path d="M0 0h4v3H0z"/></svg></div>',
      shift: true,
    },
  ] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
      react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
    ])
    if (scenario.shift) await Promise.all([vue.keyboard.down('Shift'), react.keyboard.down('Shift')])
    const [vueResult, reactResult] = await Promise.all([
      dispatchSynchronousTextPaste(vue, 'vue', scenario.text),
      dispatchSynchronousTextPaste(react, 'react', scenario.text),
    ])
    if (scenario.shift) await Promise.all([vue.keyboard.up('Shift'), react.keyboard.up('Shift')])
    expect(reactResult.defaultPrevented).toBe(vueResult.defaultPrevented)
    expect(reactResult.defaultPrevented).toBe(false)
    expect(elementWithoutGeneratedIdentity(reactResult.element)).toEqual(elementWithoutGeneratedIdentity(vueResult.element))
    expect(reactResult.element.type).toBe('text')
    expect((reactResult.element as PPTElement & { content: string }).content).toBe(scenario.expectedContent)
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches SVG-string and image-file paste data, dimensions, placement, and history', async ({ browser }) => {
  for (const source of ['text', 'file'] as const) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
      react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
    ])
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#d14424"/></svg>'
    const dispatch = (page: Page) => page.evaluate(({ source, svg }) => {
      const clipboardData = new DataTransfer()
      if (source === 'text') clipboardData.setData('text/plain', svg)
      else clipboardData.items.add(new File([svg], 'fixture.svg', { type: 'image/svg+xml' }))
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
      document.dispatchEvent(event)
      return event.defaultPrevented
    }, { source, svg })
    const [vuePrevented, reactPrevented] = await Promise.all([dispatch(vue), dispatch(react)])
    expect(reactPrevented).toBe(vuePrevented)
    expect(reactPrevented).toBe(false)
    await Promise.all([
      expect.poll(async () => (await getVueState(vue)).presentation.slides[0]!.elements.at(-1)?.type).toBe('image'),
      expect.poll(async () => (await getReactState(react)).presentation.slides[0]!.elements.at(-1)?.type).toBe('image'),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    const vueImage = vueState.presentation.slides[0]!.elements.at(-1)!
    const reactImage = reactState.presentation.slides[0]!.elements.at(-1)!
    expect(elementWithoutGeneratedIdentity(reactImage)).toEqual(elementWithoutGeneratedIdentity(vueImage))
    expect({ width: reactImage.width, height: reactImage.height, left: reactImage.left, top: reactImage.top }).toEqual({
      width: 40, height: 30, left: 480, top: 266.25,
    })
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
    await context.close()
  }
})

test('matches whitelisted image-URL detection and viewport-constrained placement', async ({ browser }) => {
  const context = await browser.newContext()
  await context.route('https://images.pexels.com/**', route => route.fulfill({
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="#22577a"/></svg>',
    contentType: 'image/svg+xml',
  }))
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  const imageUrl = 'https://images.pexels.com/fixture.png'
  await Promise.all([
    dispatchSynchronousTextPaste(vue, 'vue', imageUrl),
    dispatchSynchronousTextPaste(react, 'react', imageUrl),
  ])
  await Promise.all([
    expect.poll(async () => (await getVueState(vue)).presentation.slides[0]!.elements.at(-1)?.type).toBe('image'),
    expect.poll(async () => (await getReactState(react)).presentation.slides[0]!.elements.at(-1)?.type).toBe('image'),
  ])
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  const vueImage = vueState.presentation.slides[0]!.elements.at(-1)!
  const reactImage = reactState.presentation.slides[0]!.elements.at(-1)!
  expect(elementWithoutGeneratedIdentity(reactImage)).toEqual(elementWithoutGeneratedIdentity(vueImage))
  expect({ height: reactImage.height, left: reactImage.left, top: reactImage.top, width: reactImage.width }).toEqual({
    height: 500,
    left: 0,
    top: 31.25,
    width: 1000,
  })
  await context.close()
})

test('matches simultaneous audio/video file paste defaults and native event behavior', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  const dispatch = (page: Page) => page.evaluate(() => {
    const clipboardData = new DataTransfer()
    clipboardData.items.add(new File(['audio'], 'fixture.mp3', { type: 'audio/mpeg' }))
    clipboardData.items.add(new File(['video'], 'fixture.mp4', { type: 'video/mp4' }))
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData })
    document.dispatchEvent(event)
    return event.defaultPrevented
  })
  const [vuePrevented, reactPrevented] = await Promise.all([dispatch(vue), dispatch(react)])
  expect(reactPrevented).toBe(vuePrevented)
  expect(reactPrevented).toBe(false)
  await Promise.all([
    expect.poll(async () => (await getVueState(vue)).presentation.slides[0]!.elements.slice(-2).map(element => element.type)).toEqual(['audio', 'video']),
    expect.poll(async () => (await getReactState(react)).presentation.slides[0]!.elements.slice(-2).map(element => element.type)).toEqual(['audio', 'video']),
  ])
  const normalizeMedia = (element: PPTElement) => {
    const normalized = elementWithoutGeneratedIdentity(element) as PPTElement & { src?: string }
    if (normalized.src?.startsWith('blob:')) normalized.src = '__blob__'
    return normalized
  }
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(reactState.presentation.slides[0]!.elements.slice(-2).map(normalizeMedia)).toEqual(
    vueState.presentation.slides[0]!.elements.slice(-2).map(normalizeMedia),
  )
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  expect(await getReactHistory(react)).toEqual(await getVueHistory(vue))
  await context.close()
})

test('matches the real ProseMirror editing surface, focus routing, drag split, model sync, and local history', async ({ browser }) => {
  test.slow()
  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(1).click(),
      react.getByRole('button', { name: 'Show slide 2' }).click(),
    ])
    const vueElement = vue.locator('#editable-element-gate3-image-title .editable-element-text')
    const reactElement = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-image-title"]')
    const vueContent = vueElement.locator('.element-content')
    const reactContent = reactElement.locator('.mona-text-content')
    const vueEditor = vueElement.locator('.ProseMirror')
    const reactEditor = reactElement.locator('.ProseMirror')

    await Promise.all([
      expect(vueEditor).toHaveAttribute('contenteditable', 'true'),
      expect(reactEditor).toHaveAttribute('contenteditable', 'true'),
    ])
    expect(await reactEditor.innerHTML()).toBe(await vueEditor.innerHTML())
    expect(await reactEditor.evaluate(element => getComputedStyle(element).cursor)).toBe(
      await vueEditor.evaluate(element => getComputedStyle(element).cursor),
    )
    const [vueBox, reactBox] = await Promise.all([vueElement.boundingBox(), reactElement.boundingBox()])
    expect(reactBox).not.toBeNull()
    expect(vueBox).not.toBeNull()
    expect({ height: reactBox!.height, width: reactBox!.width }).toEqual({
      height: vueBox!.height,
      width: vueBox!.width,
    })
    const [vuePixels, reactPixels] = await Promise.all([vueElement.screenshot(), reactElement.screenshot()])
    expectRasterParity(reactPixels, vuePixels, {
      // Both canvases paint the same fractional CSS gradient beneath this
      // transparent layer. Chromium can quantize that gradient one channel
      // value apart across compositor trees; the text itself remains
      // perceptually and geometrically identical.
      maxChannelDelta: 2,
      maxExactPixelDelta: 7100,
      perceptualThreshold: 0.01,
    })

    await Promise.all([vueEditor.click(), reactEditor.click()])
    let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
    expect(normalizedReactSelection(reactState)).toEqual({
      activeElementIds: ['gate3-image-title'],
      activeGroupElementId: null,
      handleElementId: 'gate3-image-title',
    })
    expect(vueState.editor.disableHotkeys).toBe(true)
    expect(reactState.session.disableHotkeys).toBe(true)
    await Promise.all([
      expect(vueEditor).toBeFocused(),
      expect(reactEditor).toBeFocused(),
    ])

    const beforeTextDrag = pickElement(vueState, 1, 'gate3-image-title')
    await Promise.all([
      movePointerByScreenPixels(vue, vueEditor, { x: 28, y: 8 }),
      movePointerByScreenPixels(react, reactEditor, { x: 28, y: 8 }),
    ])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(vueState, 1, 'gate3-image-title')).toEqual(beforeTextDrag)
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(beforeTextDrag)

    await Promise.all([
      dragBySlideDelta(vue, vueContent, vue.locator('.viewport'), { x: 17, y: 13 }, { x: 0.5, y: 0.02 }),
      dragBySlideDelta(react, reactContent, react.locator('.mona-editor-slide-canvas'), { x: 17, y: 13 }, { x: 0.5, y: 0.02 }),
    ])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(pickElement(vueState, 1, 'gate3-image-title'))
    expect(pickElement(reactState, 1, 'gate3-image-title')).not.toEqual(beforeTextDrag)

    await Promise.all([
      vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
      react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
    ])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(vueState.editor.disableHotkeys).toBe(false)
    expect(reactState.session.disableHotkeys).toBe(false)
    await context.close()
  }

  {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    await Promise.all([
      vue.locator('.thumbnail-slide').nth(1).click(),
      react.getByRole('button', { name: 'Show slide 2' }).click(),
    ])
    const vueEditor = vue.locator('#editable-element-gate3-image-title .ProseMirror')
    const reactEditor = react.locator('.mona-editor-slide-canvas [data-element-id="gate3-image-title"] .ProseMirror')
    const [vueInitialHistory, reactInitialHistory] = await Promise.all([getVueHistory(vue), getReactHistory(react)])

    await Promise.all([vueEditor.click(), reactEditor.click()])
    await Promise.all([vueEditor.press('Meta+a'), reactEditor.press('Meta+a')])
    await Promise.all([
      vue.keyboard.type('Agentic slide editing'),
      react.keyboard.type('Agentic slide editing'),
    ])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(pickElement(vueState, 1, 'gate3-image-title'))
    expect(pickElement(reactState, 1, 'gate3-image-title').content).toBe('<p style="">Agentic slide editing</p>')
    expect(await reactEditor.innerHTML()).toBe(await vueEditor.innerHTML())
    expect(await getVueHistory(vue)).toEqual(vueInitialHistory)
    expect(await getReactHistory(react)).toEqual(reactInitialHistory)

    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    const [vueTypedHistory, reactTypedHistory] = await Promise.all([getVueHistory(vue), getReactHistory(react)])
    expect(reactTypedHistory).toEqual(vueTypedHistory)
    expect(reactTypedHistory).toEqual({
      cursor: reactInitialHistory.cursor + 1,
      length: reactInitialHistory.length + 1,
    })

    await Promise.all([vueEditor.press('Meta+z'), reactEditor.press('Meta+z')])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(pickElement(vueState, 1, 'gate3-image-title'))
    expect(pickElement(reactState, 1, 'gate3-image-title').content).toBe(await reactEditor.innerHTML())
    expect(await reactEditor.innerHTML()).toBe(await vueEditor.innerHTML())
    expect(pickElement(reactState, 1, 'gate3-image-title').content).toContain('Images, crops and transforms')
    expect(await getVueHistory(vue)).toEqual(vueTypedHistory)
    expect(await getReactHistory(react)).toEqual(reactTypedHistory)

    await Promise.all([vueEditor.press('Meta+y'), reactEditor.press('Meta+y')])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(pickElement(vueState, 1, 'gate3-image-title'))
    expect(pickElement(reactState, 1, 'gate3-image-title').content).toBe('<p style="">Agentic slide editing</p>')
    expect(await getVueHistory(vue)).toEqual(vueTypedHistory)
    expect(await getReactHistory(react)).toEqual(reactTypedHistory)

    const beforeArrow = pickElement(reactState, 1, 'gate3-image-title')
    await Promise.all([vueEditor.press('ArrowRight'), reactEditor.press('ArrowRight')])
    ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(pickElement(vueState, 1, 'gate3-image-title')).toEqual(beforeArrow)
    expect(pickElement(reactState, 1, 'gate3-image-title')).toEqual(beforeArrow)
    await context.close()
  }
})

test('matches the complete image-crop DOM, transient lifecycle, committed geometry, and undo boundary', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(1).click(),
    react.getByRole('button', { name: 'Show slide 2' }).click(),
  ])
  await Promise.all([
    vue.locator('#editable-element-gate3-image-round .editable-element-image').click(),
    react.getByRole('button', { name: 'Select image gate3-image-round' }).click(),
  ])
  await Promise.all([
    vue.getByRole('button', { name: 'Crop image' }).click(),
    react.getByRole('button', { name: 'Crop image' }).click(),
  ])

  const vueCrop = vue.locator('.image-clip-handler')
  const reactCrop = react.locator('.mona-image-crop-editor')
  await Promise.all([expect(vueCrop).toBeVisible(), expect(reactCrop).toBeVisible()])
  await expect(vue.locator('.clip-point')).toHaveCount(8)
  await expect(react.locator('.mona-crop-handle')).toHaveCount(8)

  const readCropDom = (page: Page, selector: string, reactImplementation: boolean) => page.locator(selector).evaluate((element, isReact) => {
    const styleValues = (target: Element | null) => {
      const style = (target as HTMLElement | null)?.style
      return style ? {
        clipPath: style.clipPath,
        height: style.height,
        left: style.left,
        top: style.top,
        width: style.width,
      } : null
    }
    const handles = [...element.querySelectorAll(isReact ? '.mona-crop-handle' : '.clip-point')].map(handle => {
      const raw = isReact
        ? (handle as HTMLElement).dataset.handle!
        : [...handle.classList].find(name => ['left-top', 'right-top', 'left-bottom', 'right-bottom', 'top', 'right', 'bottom', 'left'].includes(name))!
      const name = ({
        'left-top': 'top-left',
        'right-top': 'top-right',
        'left-bottom': 'bottom-left',
        'right-bottom': 'bottom-right',
      } as Record<string, string>)[raw] ?? raw
      return {
        cursor: getComputedStyle(handle).cursor,
        d: handle.querySelector('path')!.getAttribute('d'),
        name,
        rotateClass: [...handle.classList].find(item => item.startsWith('rotate-')),
      }
    }).sort((a, b) => a.name.localeCompare(b.name))
    return {
      bottom: styleValues(element.querySelector(isReact ? '.mona-crop-bottom-image' : '.bottom-img')),
      handler: styleValues(element),
      handles,
      operate: styleValues(element.querySelector(isReact ? '.mona-crop-operate' : '.operate')),
      topImage: styleValues(element.querySelector(isReact ? '.mona-crop-highlight img' : '.top-img')),
      topWrapper: styleValues(element.querySelector(isReact ? '.mona-crop-highlight' : '.top-image-content')),
    }
  }, reactImplementation)

  const [vueCropDom, reactCropDom] = await Promise.all([
    readCropDom(vue, '.image-clip-handler', false),
    readCropDom(react, '.mona-image-crop-editor', true),
  ])
  expect(reactCropDom).toEqual(vueCropDom)

  const [vueBefore, reactBefore] = await Promise.all([getVueState(vue), getReactState(react)])
  const vueImageBefore = pickElement(vueBefore, 1, 'gate3-image-round') as PPTImageElement
  const reactImageBefore = pickElement(reactBefore, 1, 'gate3-image-round') as PPTImageElement
  expect(reactImageBefore).toEqual(vueImageBefore)

  await Promise.all([
    dragBySlideDelta(vue, vue.locator('.clip-point.right'), vue.locator('.viewport'), { x: -50, y: 0 }),
    dragBySlideDelta(react, react.locator('[data-handle="right"]'), react.locator('.mona-editor-slide-canvas'), { x: -50, y: 0 }),
  ])
  const [vueDuring, reactDuring] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(vueDuring, 1, 'gate3-image-round')).toEqual(vueImageBefore)
  expect(pickElement(reactDuring, 1, 'gate3-image-round')).toEqual(reactImageBefore)
  const [vueDraftDom, reactDraftDom] = await Promise.all([
    readCropDom(vue, '.image-clip-handler', false),
    readCropDom(react, '.mona-image-crop-editor', true),
  ])
  expect(reactDraftDom.handles).toEqual(vueDraftDom.handles)
  for (const layer of ['bottom', 'handler', 'operate', 'topImage', 'topWrapper'] as const) {
    expect(reactDraftDom[layer]!.clipPath).toBe(vueDraftDom[layer]!.clipPath)
    for (const property of ['height', 'left', 'top', 'width'] as const) {
      const vueValue = Number.parseFloat(vueDraftDom[layer]![property])
      const reactValue = Number.parseFloat(reactDraftDom[layer]![property])
      if (Number.isNaN(vueValue) || Number.isNaN(reactValue)) {
        expect(reactDraftDom[layer]![property]).toBe(vueDraftDom[layer]![property])
      }
      else expect(reactValue).toBeCloseTo(vueValue, 0)
    }
  }

  await Promise.all([
    vue.locator('.canvas').press('Enter'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Enter'),
  ])
  await Promise.all([expect(vueCrop).toHaveCount(0), expect(reactCrop).toHaveCount(0)])
  const [vueCommitted, reactCommitted] = await Promise.all([getVueState(vue), getReactState(react)])
  const vueImageCommitted = pickElement(vueCommitted, 1, 'gate3-image-round') as PPTImageElement
  const reactImageCommitted = pickElement(reactCommitted, 1, 'gate3-image-round') as PPTImageElement
  expect({ ...reactImageCommitted, left: 0, top: 0, width: 0, height: 0 }).toEqual({
    ...vueImageCommitted,
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })
  for (const property of ['left', 'top', 'width', 'height'] as const) {
    expect(reactImageCommitted[property]).toBeCloseTo(vueImageCommitted[property], 0)
  }
  expect(reactImageCommitted).not.toEqual(reactImageBefore)

  // Vue intentionally debounces snapshot insertion by 300 ms.
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').first().click(),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z'),
  ])
  await expect.poll(async () => pickElement(await getReactState(react), 1, 'gate3-image-round')).toEqual(reactImageBefore)
  await expect.poll(async () => pickElement(await getVueState(vue), 1, 'gate3-image-round')).toEqual(vueImageBefore)

  await Promise.all([
    vue.locator('#editable-element-gate3-image-round .editable-element-image').click(),
    react.getByRole('button', { name: 'Select image gate3-image-round' }).click(),
  ])
  await Promise.all([
    vue.getByRole('button', { name: 'Crop image' }).click(),
    react.getByRole('button', { name: 'Crop image' }).click(),
  ])
  await Promise.all([
    vue.locator('.canvas').press('Escape'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Escape'),
  ])
  await Promise.all([expect(vueCrop).toBeVisible(), expect(reactCrop).toBeVisible()])
  await Promise.all([
    dragBySlideDelta(vue, vue.locator('.image-clip-handler .operate'), vue.locator('.viewport'), { x: 21.25, y: 0 }),
    dragBySlideDelta(react, react.getByRole('button', { name: 'Move crop area' }), react.locator('.mona-editor-slide-canvas'), { x: 21.25, y: 0 }),
  ])
  await Promise.all([
    vue.locator('#editable-element-gate3-image-ellipse .editable-element-image').click(),
    react.getByRole('button', { name: 'Select image gate3-image-ellipse' }).click(),
  ])
  await Promise.all([expect(vueCrop).toHaveCount(0), expect(reactCrop).toHaveCount(0)])
  const [vueOutsideCommitted, reactOutsideCommitted] = await Promise.all([getVueState(vue), getReactState(react)])
  const vueOutsideImage = pickElement(vueOutsideCommitted, 1, 'gate3-image-round') as PPTImageElement
  const reactOutsideImage = pickElement(reactOutsideCommitted, 1, 'gate3-image-round') as PPTImageElement
  expect({ ...reactOutsideImage, left: 0, top: 0 }).toEqual({ ...vueOutsideImage, left: 0, top: 0 })
  expect(Math.abs(reactOutsideImage.left - vueOutsideImage.left)).toBeLessThan(1)
  expect(Math.abs(reactOutsideImage.top - vueOutsideImage.top)).toBeLessThan(1)
  await context.close()
})

test('matches debounced history, redo truncation, the 20-snapshot cap, and restoration state', async ({ browser }) => {
  test.slow()
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueUndo = vue.locator('.canvas-tool .left-handler > .handler-item').first()
  const vueRedo = vue.locator('.canvas-tool .left-handler > .handler-item').nth(1)
  const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
  const vueShape = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactShape = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([vueShape.click(), reactShape.click()])
  const initialLeft = (pickElement(await getVueState(vue), 0, 'gate3-radial-shape') as PPTElement & { left: number }).left
  expect(await getVueHistory(vue)).toEqual({ cursor: 0, length: 1 })
  expect(await getReactHistory(react)).toEqual({ cursor: 0, length: 1 })

  await Promise.all([vue.locator('.canvas').press('ArrowRight'), reactCanvas.press('ArrowRight')])
  expect(await getVueHistory(vue)).toEqual({ cursor: 0, length: 1 })
  expect(await getReactHistory(react)).toEqual({ cursor: 0, length: 1 })
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 1, length: 2 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 1, length: 2 })

  await Promise.all([vueUndo.click(), reactCanvas.press('Control+z')])
  await expect.poll(async () => (pickElement(await getVueState(vue), 0, 'gate3-radial-shape') as PPTElement & { left: number }).left).toBe(initialLeft)
  await expect.poll(async () => (pickElement(await getReactState(react), 0, 'gate3-radial-shape') as PPTElement & { left: number }).left).toBe(initialLeft)
  expect(normalizedVueSelection(await getVueState(vue)).activeElementIds).toEqual([])
  expect(normalizedReactSelection(await getReactState(react)).activeElementIds).toEqual([])

  await Promise.all([vueRedo.click(), reactCanvas.press('Control+y')])
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 1, length: 2 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 1, length: 2 })
  await Promise.all([vueUndo.click(), reactCanvas.press('Control+z')])
  await Promise.all([vueShape.click(), reactShape.click()])
  await Promise.all([vue.locator('.canvas').press('ArrowLeft'), reactCanvas.press('ArrowLeft')])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 1, length: 2 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 1, length: 2 })

  for (let index = 0; index < 20; index += 1) {
    await Promise.all([vue.locator('.canvas').press('ArrowRight'), reactCanvas.press('ArrowRight')])
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    const expectedLength = Math.min(index + 3, 20)
    await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: expectedLength - 1, length: expectedLength })
    await expect.poll(() => getReactHistory(react)).toEqual({ cursor: expectedLength - 1, length: expectedLength })
  }
  expect(await getVueHistory(vue)).toEqual({ cursor: 19, length: 20 })
  expect(await getReactHistory(react)).toEqual({ cursor: 19, length: 20 })
  const [vueAtCap, reactAtCap] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(reactAtCap, 0, 'gate3-radial-shape')).toEqual(pickElement(vueAtCap, 0, 'gate3-radial-shape'))

  for (let index = 0; index < 19; index += 1) {
    await Promise.all([vueUndo.click(), reactCanvas.press('Control+z')])
    await vue.waitForTimeout(110)
  }
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 0, length: 20 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 0, length: 20 })
  const [vueOldest, reactOldest] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(reactOldest, 0, 'gate3-radial-shape')).toEqual(pickElement(vueOldest, 0, 'gate3-radial-shape'))
  await context.close()
})

test('matches history slide-focus preservation after editing another slide', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(1).click(),
    react.getByRole('button', { name: 'Show slide 2' }).click(),
  ])
  await Promise.all([
    vue.locator('#editable-element-gate3-image-ellipse .editable-element-image').click(),
    react.getByRole('button', { name: 'Select image gate3-image-ellipse' }).click(),
  ])
  const [vueBefore, reactBefore] = await Promise.all([getVueState(vue), getReactState(react)])
  await Promise.all([
    vue.locator('.canvas').press('ArrowRight'),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('ArrowRight'),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([
    vue.locator('.canvas-tool .left-handler > .handler-item').first().click(),
    react.getByRole('application', { name: 'Editable slide canvas' }).press('Control+z'),
  ])
  await expect.poll(async () => (await getVueState(vue)).presentation.slideIndex).toBe(1)
  await expect.poll(async () => (await getReactState(react)).presentation.slideIndex).toBe(1)
  const [vueAfter, reactAfter] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(vueAfter, 1, 'gate3-image-ellipse')).toEqual(pickElement(vueBefore, 1, 'gate3-image-ellipse'))
  expect(pickElement(reactAfter, 1, 'gate3-image-ellipse')).toEqual(pickElement(reactBefore, 1, 'gate3-image-ellipse'))
  expect(normalizedReactSelection(reactAfter)).toEqual(normalizedVueSelection(vueAfter))
  await context.close()
})

test('matches independent history debounce channels and duplicate snapshots', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  await Promise.all([vue.locator('.canvas').press('ArrowRight'), reactCanvas.press('ArrowRight')])
  await Promise.all([vue.locator('.canvas').press('Delete'), reactCanvas.press('Delete')])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await expect.poll(() => getVueHistory(vue)).toEqual({ cursor: 2, length: 3 })
  await expect.poll(() => getReactHistory(react)).toEqual({ cursor: 2, length: 3 })

  const vueUndo = vue.locator('.canvas-tool .left-handler > .handler-item').first()
  await Promise.all([vueUndo.click(), reactCanvas.press('Control+z')])
  expect((await getVueState(vue)).presentation.slides[0]!.elements.some(element => element.id === 'gate3-radial-shape')).toBe(false)
  expect((await getReactState(react)).presentation.slides[0]!.elements.some(element => element.id === 'gate3-radial-shape')).toBe(false)
  await vue.waitForTimeout(110)
  await Promise.all([vueUndo.click(), reactCanvas.press('Control+z')])
  await expect.poll(async () => (await getVueState(vue)).presentation.slides[0]!.elements.some(element => element.id === 'gate3-radial-shape')).toBe(true)
  await expect.poll(async () => (await getReactState(react)).presentation.slides[0]!.elements.some(element => element.id === 'gate3-radial-shape')).toBe(true)
  const [vueRestored, reactRestored] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(reactRestored, 0, 'gate3-radial-shape')).toEqual(pickElement(vueRestored, 0, 'gate3-radial-shape'))
  expect(normalizedReactSelection(reactRestored)).toEqual(normalizedVueSelection(vueRestored))
  await context.close()
})

test('matches the complete canvas zoom, reset, wheel-throttle, and wheel-navigation contract', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueCanvas = vue.locator('.canvas')
  const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
  const vueFrame = vue.locator('.viewport-wrapper')
  const reactFrame = react.locator('.mona-editor-viewport-frame')

  const readViewportState = async () => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    return {
      react: {
        pan: reactState.session.canvasPan,
        percentage: reactState.session.canvasZoom,
      },
      vue: {
        pan: { x: 0, y: 0 },
        percentage: vueState.editor.canvasPercentage,
      },
    }
  }

  expect(await readViewportState()).toEqual({
    react: { pan: { x: 0, y: 0 }, percentage: 90 },
    vue: { pan: { x: 0, y: 0 }, percentage: 90 },
  })
  const [initialVueFrame, initialReactFrame, vueChrome, reactChrome] = await Promise.all([
    vueFrame.boundingBox(),
    reactFrame.boundingBox(),
    vueFrame.evaluate(element => ({
      background: getComputedStyle(element.closest('.canvas')!).backgroundColor,
      boxShadow: getComputedStyle(element).boxShadow,
    })),
    reactFrame.evaluate(element => ({
      background: getComputedStyle(element.closest('.mona-editor-stage')!).backgroundColor,
      boxShadow: getComputedStyle(element).boxShadow,
    })),
  ])
  expect(initialReactFrame).toEqual(initialVueFrame)
  expect(reactChrome).toEqual(vueChrome)

  await pressBoth(vue, react, 'Control+=')
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(95)
  expect((await getReactState(react)).session.canvasZoom).toBe(95)
  await pressBoth(vue, react, 'Control+-')
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(90)
  expect((await getReactState(react)).session.canvasZoom).toBe(90)

  await Promise.all([vue.keyboard.down('Meta'), react.keyboard.down('Meta')])
  await Promise.all([vue.keyboard.press('='), react.keyboard.press('=')])
  await Promise.all([vue.keyboard.up('Meta'), react.keyboard.up('Meta')])
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(90)
  expect((await getReactState(react)).session.canvasZoom).toBe(90)

  await pressBoth(vue, react, 'Control+=', 24)
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(205)
  expect((await getReactState(react)).session.canvasZoom).toBe(205)
  await pressBoth(vue, react, 'Control+-', 37)
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(25)
  expect((await getReactState(react)).session.canvasZoom).toBe(25)
  expect(await reactFrame.boundingBox()).toEqual(await vueFrame.boundingBox())
  await pressBoth(vue, react, 'Control+0')
  expect(await reactFrame.boundingBox()).toEqual(initialReactFrame)
  expect(await vueFrame.boundingBox()).toEqual(initialVueFrame)

  const [vueCanvasBox, reactCanvasBox] = await Promise.all([vueCanvas.boundingBox(), reactCanvas.boundingBox()])
  expect(vueCanvasBox).not.toBeNull()
  expect(reactCanvasBox).not.toBeNull()
  await Promise.all([
    vue.mouse.move(vueCanvasBox!.x + 30, vueCanvasBox!.y + 30),
    react.mouse.move(reactCanvasBox!.x + 30, reactCanvasBox!.y + 30),
  ])
  await Promise.all([vue.keyboard.down('Control'), react.keyboard.down('Control')])
  await Promise.all([vue.mouse.wheel(0, -100), react.mouse.wheel(0, -100)])
  await Promise.all([vue.mouse.wheel(0, -100), react.mouse.wheel(0, -100)])
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(95)
  expect((await getReactState(react)).session.canvasZoom).toBe(95)
  await Promise.all([vue.waitForTimeout(110), react.waitForTimeout(110)])
  await Promise.all([vue.mouse.wheel(0, -100), react.mouse.wheel(0, -100)])
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(100)
  expect((await getReactState(react)).session.canvasZoom).toBe(100)
  await Promise.all([vue.keyboard.up('Control'), react.keyboard.up('Control')])

  await Promise.all([vue.keyboard.down('Meta'), react.keyboard.down('Meta')])
  await Promise.all([vue.waitForTimeout(110), react.waitForTimeout(110)])
  await Promise.all([vue.mouse.wheel(0, -100), react.mouse.wheel(0, -100)])
  expect((await getVueState(vue)).editor.canvasPercentage).toBe(105)
  expect((await getReactState(react)).session.canvasZoom).toBe(105)
  await Promise.all([vue.keyboard.up('Meta'), react.keyboard.up('Meta')])

  await Promise.all([vue.mouse.wheel(0, 100), react.mouse.wheel(0, 100)])
  await Promise.all([vue.mouse.wheel(0, 100), react.mouse.wheel(0, 100)])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(1)
  expect((await getReactState(react)).presentation.slideIndex).toBe(1)
  await Promise.all([vue.waitForTimeout(310), react.waitForTimeout(310)])
  await Promise.all([vue.mouse.wheel(0, 100), react.mouse.wheel(0, 100)])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(2)
  expect((await getReactState(react)).presentation.slideIndex).toBe(2)
  await context.close()
})

test('matches space-mask pan routing, screen-pixel movement, no-op drag state, and reset', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueShape = vue.locator('#editable-element-gate3-radial-shape .editable-element-shape')
  const reactShape = react.getByRole('button', { name: 'Select shape gate3-radial-shape' })
  await Promise.all([vueShape.click(), reactShape.click()])
  const [vueInitialFrame, reactInitialFrame, vueHistory, reactHistory] = await Promise.all([
    vue.locator('.viewport-wrapper').boundingBox(),
    react.locator('.mona-editor-viewport-frame').boundingBox(),
    getVueHistory(vue),
    getReactHistory(react),
  ])
  expect(reactInitialFrame).toEqual(vueInitialFrame)

  await Promise.all([vue.keyboard.down('Space'), react.keyboard.down('Space')])
  const vueMask = vue.locator('.drag-mask')
  const reactMask = react.locator('.mona-drag-mask')
  await Promise.all([expect(vueMask).toBeVisible(), expect(reactMask).toBeVisible()])
  const [vueMaskChrome, reactMaskChrome] = await Promise.all([
    vueMask.evaluate(element => {
      const style = getComputedStyle(element)
      return { bottom: style.bottom, cursor: style.cursor, left: style.left, position: style.position, right: style.right, top: style.top }
    }),
    reactMask.evaluate(element => {
      const style = getComputedStyle(element)
      return { bottom: style.bottom, cursor: style.cursor, left: style.left, position: style.position, right: style.right, top: style.top }
    }),
  ])
  expect(reactMaskChrome).toEqual(vueMaskChrome)

  const [vueShapeBox, reactShapeBox] = await Promise.all([vueShape.boundingBox(), reactShape.boundingBox()])
  expect(vueShapeBox).not.toBeNull()
  expect(reactShapeBox).not.toBeNull()
  const pan = async (page: Page, box: NonNullable<typeof vueShapeBox>) => {
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 42, start.y - 27)
    await page.mouse.up()
  }
  await Promise.all([pan(vue, vueShapeBox!), pan(react, reactShapeBox!)])
  const [vueFinalFrame, reactFinalFrame, vueState, reactState] = await Promise.all([
    vue.locator('.viewport-wrapper').boundingBox(),
    react.locator('.mona-editor-viewport-frame').boundingBox(),
    getVueState(vue),
    getReactState(react),
  ])
  expect(reactFinalFrame).toEqual(vueFinalFrame)
  expect(vueFinalFrame!.x - vueInitialFrame!.x).toBe(42)
  expect(vueFinalFrame!.y - vueInitialFrame!.y).toBe(-27)
  expect(reactState.session.canvasPan).toEqual({ x: 42, y: -27 })
  expect(reactState.session.canvasDragged).toBe(vueState.editor.canvasDragged)
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))
  expect(normalizedReactSelection(reactState).activeElementIds).toEqual([])
  expect(await getVueHistory(vue)).toEqual(vueHistory)
  expect(await getReactHistory(react)).toEqual(reactHistory)
  await Promise.all([vue.keyboard.up('Space'), react.keyboard.up('Space')])
  await Promise.all([expect(vueMask).toHaveCount(0), expect(reactMask).toHaveCount(0)])

  await pressBoth(vue, react, 'Control+=')
  await pressBoth(vue, react, 'Control+0')
  expect(await vue.locator('.viewport-wrapper').boundingBox()).toEqual(vueInitialFrame)
  expect(await react.locator('.mona-editor-viewport-frame').boundingBox()).toEqual(reactInitialFrame)
  const [vueReset, reactReset] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueReset.editor.canvasPercentage).toBe(90)
  expect(reactReset.session.canvasZoom).toBe(90)
  expect(vueReset.editor.canvasDragged).toBe(false)
  expect(reactReset.session.canvasDragged).toBe(false)
  expect(reactReset.session.canvasPan).toEqual({ x: 0, y: 0 })

  await Promise.all([vue.keyboard.down('Space'), react.keyboard.down('Space')])
  const [vueMaskBox, reactMaskBox] = await Promise.all([vueMask.boundingBox(), reactMask.boundingBox()])
  await Promise.all([
    vue.mouse.click(vueMaskBox!.x + 20, vueMaskBox!.y + 20),
    react.mouse.click(reactMaskBox!.x + 20, reactMaskBox!.y + 20),
  ])
  const [vueNoMove, reactNoMove] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueNoMove.editor.canvasDragged).toBe(true)
  expect(reactNoMove.session.canvasDragged).toBe(true)
  expect(reactNoMove.session.canvasPan).toEqual({ x: 0, y: 0 })
  await Promise.all([vue.keyboard.up('Space'), react.keyboard.up('Space')])
  await context.close()
})

test('matches source ruler structure, threshold states, range pixels, and dashed SVG grid', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  await setRulerVisible(vue, react)
  // Opening the canvas menu is a blank secondary-button mousedown in the
  // source, so both editors clear selection before the menu action.
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueState.editor.showRuler).toBe(true)
  expect(reactState.session.showRuler).toBe(true)

  const vueHorizontal = vue.locator('.ruler > .h')
  const reactHorizontal = react.locator('.mona-editor-ruler.is-horizontal')
  const vueVertical = vue.locator('.ruler > .v')
  const reactVertical = react.locator('.mona-editor-ruler.is-vertical')
  await Promise.all([
    expect(vueHorizontal.locator('.ruler-marker-100')).toHaveCount(20),
    expect(reactHorizontal.locator('.mona-ruler-marker-100')).toHaveCount(20),
    expect(vueVertical.locator('.ruler-marker-100')).toHaveCount(20),
    expect(reactVertical.locator('.mona-ruler-marker-100')).toHaveCount(20),
  ])

  const inspectRuler = async (
    page: Page,
    horizontal: ReturnType<Page['locator']>,
    vertical: ReturnType<Page['locator']>,
    frame: ReturnType<Page['locator']>,
    stage: ReturnType<Page['locator']>,
    markerClass: string,
    rangeClass: string,
  ) => {
    const [horizontalBox, verticalBox, frameBox, stageBox] = await Promise.all([
      horizontal.boundingBox(), vertical.boundingBox(), frame.boundingBox(), stage.boundingBox(),
    ])
    const marker = horizontal.locator(markerClass).first()
    const range = horizontal.locator(rangeClass)
    return {
      chrome: await horizontal.evaluate(element => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, border: style.border, height: style.height, overflow: style.overflow }
      }),
      geometry: {
        horizontalLeftFromFrame: horizontalBox!.x - frameBox!.x,
        horizontalTopFromStage: horizontalBox!.y - stageBox!.y,
        verticalLeftFromStage: verticalBox!.x - stageBox!.x,
        verticalTopFromFrame: verticalBox!.y - frameBox!.y,
      },
      marker: await marker.evaluate(element => {
        const style = getComputedStyle(element)
        const before = getComputedStyle(element, '::before')
        const after = getComputedStyle(element, '::after')
        return {
          after: { background: after.backgroundColor, height: after.height, width: after.width },
          before: { background: before.backgroundColor, display: before.display, height: before.height, width: before.width },
          fontSize: style.fontSize,
          spanDisplay: getComputedStyle(element.querySelector('span')!).display,
        }
      }),
      range: await range.evaluate(element => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, height: style.height, left: style.left, width: style.width }
      }),
    }
  }

  const [initialVueRuler, initialReactRuler] = await Promise.all([
    inspectRuler(vue, vueHorizontal, vueVertical, vue.locator('.viewport-wrapper'), vue.locator('.canvas'), '.ruler-marker-100', '.range'),
    inspectRuler(react, reactHorizontal, reactVertical, react.locator('.mona-editor-viewport-frame'), react.getByRole('application', { name: 'Editable slide canvas' }), '.mona-ruler-marker-100', '.mona-ruler-range'),
  ])
  expect(initialReactRuler).toEqual(initialVueRuler)
  expect(Buffer.compare(await reactHorizontal.screenshot(), await vueHorizontal.screenshot())).toBe(0)
  expect(Buffer.compare(await reactVertical.screenshot(), await vueVertical.screenshot())).toBe(0)

  await pressBoth(vue, react, 'Control+-', 4)
  await expect(vueHorizontal.locator('.ruler-marker-100').first()).toHaveClass(/omit/)
  await expect(reactHorizontal.locator('.mona-ruler-marker-100').first()).toHaveClass(/omit/)
  await expect(vueHorizontal.locator('.ruler-marker-100').first()).not.toHaveClass(/hide/)
  await expect(reactHorizontal.locator('.mona-ruler-marker-100').first()).not.toHaveClass(/hide/)
  await pressBoth(vue, react, 'Control+-', 8)
  await expect(vueHorizontal.locator('.ruler-marker-100').first()).toHaveClass(/hide/)
  await expect(reactHorizontal.locator('.mona-ruler-marker-100').first()).toHaveClass(/hide/)
  const [vueHiddenMarker, reactHiddenMarker] = await Promise.all([
    vueHorizontal.locator('.ruler-marker-100').first().evaluate(element => ({
      before: getComputedStyle(element, '::before').display,
      label: getComputedStyle(element.querySelector('span')!).display,
    })),
    reactHorizontal.locator('.mona-ruler-marker-100').first().evaluate(element => ({
      before: getComputedStyle(element, '::before').display,
      label: getComputedStyle(element.querySelector('span')!).display,
    })),
  ])
  expect(reactHiddenMarker).toEqual(vueHiddenMarker)
  await pressBoth(vue, react, 'Control+0')

  await setGridSize(vue, react, 50)
  const vueGrid = vue.locator('.grid-lines')
  const reactGrid = react.locator('.mona-editor-grid')
  const [vueGridState, reactGridState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueGridState.editor.gridLineSize).toBe(50)
  expect(reactGridState.session.gridLineSize).toBe(50)
  const [vueGridData, reactGridData] = await Promise.all([
    vueGrid.evaluate(element => {
      const path = element.querySelector('path')!
      const style = getComputedStyle(element)
      return {
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill'),
        overflow: style.overflow,
        pointerEvents: style.pointerEvents,
        stroke: path.getAttribute('stroke'),
        strokeDasharray: path.getAttribute('stroke-dasharray'),
        strokeWidth: path.getAttribute('stroke-width'),
        transform: (path as SVGPathElement).style.transform,
        zIndex: style.zIndex,
      }
    }),
    reactGrid.evaluate(element => {
      const path = element.querySelector('path')!
      const style = getComputedStyle(element)
      return {
        d: path.getAttribute('d'),
        fill: path.getAttribute('fill'),
        overflow: style.overflow,
        pointerEvents: style.pointerEvents,
        stroke: path.getAttribute('stroke'),
        strokeDasharray: path.getAttribute('stroke-dasharray'),
        strokeWidth: path.getAttribute('stroke-width'),
        transform: (path as SVGPathElement).style.transform,
        zIndex: style.zIndex,
      }
    }),
  ])
  expect(reactGridData).toEqual(vueGridData)
  expect(await reactGrid.boundingBox()).toEqual(await vueGrid.boundingBox())
  const [vueGridBox, reactGridBox] = await Promise.all([vueGrid.boundingBox(), reactGrid.boundingBox()])
  const [vueGridPixels, reactGridPixels] = await Promise.all([
    vue.screenshot({ clip: { x: vueGridBox!.x + vueGridBox!.width - 160, y: vueGridBox!.y + 10, width: 60, height: 40 } }),
    react.screenshot({ clip: { x: reactGridBox!.x + reactGridBox!.width - 160, y: reactGridBox!.y + 10, width: 60, height: 40 } }),
  ])
  const vueGridImage = PNG.sync.read(vueGridPixels)
  const reactGridImage = PNG.sync.read(reactGridPixels)
  expect(reactGridImage.width).toBe(vueGridImage.width)
  expect(reactGridImage.height).toBe(vueGridImage.height)
  expect(pixelmatch(
    reactGridImage.data,
    vueGridImage.data,
    null,
    reactGridImage.width,
    reactGridImage.height,
    { includeAA: true, threshold: 0 },
  )).toBe(0)

  await setGridSize(vue, react, 25)
  expect(react.locator('.mona-editor-grid path')).toHaveAttribute('d', await vue.locator('.grid-lines path').getAttribute('d') ?? '')
  await setGridSize(vue, react, 100)
  const [vueLargeGrid, reactLargeGrid] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueLargeGrid.editor.gridLineSize).toBe(100)
  expect(reactLargeGrid.session.gridLineSize).toBe(100)
  expect(react.locator('.mona-editor-grid path')).toHaveAttribute('d', await vue.locator('.grid-lines path').getAttribute('d') ?? '')
  await Promise.all([
    vue.locator('.thumbnail-slide').nth(3).click(),
    react.getByRole('button', { name: 'Show slide 4' }).click(),
  ])
  expect(await react.locator('.mona-editor-grid path').getAttribute('stroke')).toBe(
    await vue.locator('.grid-lines path').getAttribute('stroke'),
  )
  expect(await react.locator('.mona-editor-grid path').getAttribute('stroke')).toBe('rgba(255, 255, 255, 0.5)')
  await setGridSize(vue, react, 0)
  await Promise.all([expect(vueGrid).toHaveCount(0), expect(reactGrid).toHaveCount(0)])
  await context.close()
})

test('matches canvas and thumbnail focus ownership, blank clearing, text-range removal, and outside release', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const focusState = async () => {
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    return {
      react: {
        canvas: reactState.session.canvasFocus,
        thumbnails: reactState.session.thumbnailsFocus,
      },
      vue: {
        canvas: vueState.editor.editorAreaFocus,
        thumbnails: vueState.editor.thumbnailsFocus,
      },
    }
  }
  expect(await focusState()).toEqual({
    react: { canvas: false, thumbnails: false },
    vue: { canvas: false, thumbnails: false },
  })

  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  expect(await focusState()).toEqual({
    react: { canvas: true, thumbnails: false },
    vue: { canvas: true, thumbnails: false },
  })

  await Promise.all([vue, react].map(page => page.evaluate(() => {
    const root = document.querySelector('[data-element-id="gate3-title"], #editable-element-gate3-title')!
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()!
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })))
  expect(await vue.evaluate(() => window.getSelection()!.rangeCount)).toBe(1)
  expect(await react.evaluate(() => window.getSelection()!.rangeCount)).toBe(1)
  await Promise.all([
    vue.locator('.canvas').click({ position: { x: 30, y: 30 } }),
    react.getByRole('application', { name: 'Editable slide canvas' }).click({ position: { x: 30, y: 30 } }),
  ])
  expect(await vue.evaluate(() => window.getSelection()!.rangeCount)).toBe(0)
  expect(await react.evaluate(() => window.getSelection()!.rangeCount)).toBe(0)
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))

  await Promise.all([
    vue.locator('.thumbnail-item').nth(1).click(),
    react.getByRole('button', { name: 'Show slide 2' }).click(),
  ])
  expect(await focusState()).toEqual({
    react: { canvas: false, thumbnails: true },
    vue: { canvas: false, thumbnails: true },
  })
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(normalizedReactSelection(reactState)).toEqual(normalizedVueSelection(vueState))

  const [vueInspector, reactInspector] = await Promise.all([
    vue.locator('.layout-content-right').boundingBox(),
    react.locator('.mona-render-inspector').boundingBox(),
  ])
  await Promise.all([
    vue.mouse.click(vueInspector!.x + 20, vueInspector!.y + vueInspector!.height - 20),
    react.mouse.click(reactInspector!.x + 20, reactInspector!.y + reactInspector!.height - 20),
  ])
  expect(await focusState()).toEqual({
    react: { canvas: false, thumbnails: false },
    vue: { canvas: false, thumbnails: false },
  })
  await context.close()
})

test('matches editor keyboard scope, one-unit movement, undo modifiers, slide navigation, Tab cycling, and tool keys', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueCanvas = vue.locator('.canvas')
  const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  const initial = pickElement(await getVueState(vue), 0, 'gate3-radial-shape')
  await Promise.all([vueCanvas.press('Shift+ArrowRight'), reactCanvas.press('Shift+ArrowRight')])
  let [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  const vueMoved = pickElement(vueState, 0, 'gate3-radial-shape')
  const reactMoved = pickElement(reactState, 0, 'gate3-radial-shape')
  expect(reactMoved).toEqual(vueMoved)
  expect(reactMoved.left).toBe(initial.left + 1)
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  await Promise.all([vueCanvas.press('Control+Shift+z'), reactCanvas.press('Control+Shift+z')])
  ;[vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(pickElement(vueState, 0, 'gate3-radial-shape')).toEqual(initial)
  expect(pickElement(reactState, 0, 'gate3-radial-shape')).toEqual(initial)

  await Promise.all([
    vueCanvas.click({ position: { x: 30, y: 30 } }),
    reactCanvas.click({ position: { x: 30, y: 30 } }),
  ])
  await Promise.all([vueCanvas.press('ArrowDown'), reactCanvas.press('ArrowDown')])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(1)
  expect((await getReactState(react)).presentation.slideIndex).toBe(1)
  await Promise.all([vueCanvas.press('PageDown'), reactCanvas.press('PageDown')])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(2)
  expect((await getReactState(react)).presentation.slideIndex).toBe(2)
  await Promise.all([vueCanvas.press('PageUp'), reactCanvas.press('PageUp')])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(1)
  expect((await getReactState(react)).presentation.slideIndex).toBe(1)

  const elementCount = (await getVueState(vue)).presentation.slides[1]!.elements.length
  for (let index = 0; index <= elementCount; index += 1) {
    await Promise.all([vueCanvas.press('Tab'), reactCanvas.press('Tab')])
    const [vueTab, reactTab] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(normalizedReactSelection(reactTab)).toEqual(normalizedVueSelection(vueTab))
  }

  const [vueInspector, reactInspector] = await Promise.all([
    vue.locator('.layout-content-right').boundingBox(),
    react.locator('.mona-render-inspector').boundingBox(),
  ])
  await Promise.all([
    vue.mouse.click(vueInspector!.x + 20, vueInspector!.y + vueInspector!.height - 20),
    react.mouse.click(reactInspector!.x + 20, reactInspector!.y + reactInspector!.height - 20),
  ])
  await Promise.all([vue.keyboard.press('ArrowDown'), react.keyboard.press('ArrowDown')])
  expect((await getVueState(vue)).presentation.slideIndex).toBe(1)
  expect((await getReactState(react)).presentation.slideIndex).toBe(1)

  await Promise.all([
    vueCanvas.click({ position: { x: 30, y: 30 } }),
    reactCanvas.click({ position: { x: 30, y: 30 } }),
  ])
  for (const scenario of [
    { key: 't', reactTool: 'text', vueType: 'text' },
    { key: 'r', reactTool: 'shape', vueType: 'shape' },
    { key: 'o', reactTool: 'ellipse', vueType: 'shape' },
    { key: 'l', reactTool: 'line', vueType: 'line' },
  ]) {
    await Promise.all([vueCanvas.press(scenario.key), reactCanvas.press(scenario.key)])
    const [vueTool, reactTool] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(vueTool.editor.creatingElement?.type).toBe(scenario.vueType)
    expect(reactTool.session.activeTool).toBe(scenario.reactTool)
  }
  await context.close()
})

test('matches every keyboard create family, screen-pixel thresholds, defaults, reverse drags, and live modifiers', async ({ browser }) => {
  const scenarios = [
    { name: 'shape', key: 'r', delta: { x: 80, y: 45 } },
    { name: 'ellipse', key: 'o', delta: { x: 80, y: 60 } },
    { name: 'text-reverse', key: 't', delta: { x: -90, y: -50 } },
    { name: 'line-reverse', key: 'l', delta: { x: -80, y: 55 } },
    { name: 'shape-default-click', key: 'r', delta: { x: 0, y: 0 } },
    { name: 'line-one-axis-sufficient', key: 'l', delta: { x: 20, y: 80 } },
    { name: 'shape-one-axis-fallback', key: 'r', delta: { x: 100, y: 20 } },
    { name: 'shape-live-shift', key: 'r', delta: { x: 90, y: 30 }, modifier: 'shift-after-move' },
    { name: 'line-shift-tie', key: 'l', delta: { x: 60, y: 60 }, modifier: 'shift-before' },
  ] as const

  for (const scenario of scenarios) {
    const context = await browser.newContext()
    const { react, vue } = await openEditors(context)
    const vueCanvas = vue.locator('.canvas')
    const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
    await Promise.all([
      vueCanvas.click({ position: { x: 30, y: 30 } }),
      reactCanvas.click({ position: { x: 30, y: 30 } }),
    ])
    await Promise.all([vueCanvas.press(scenario.key), reactCanvas.press(scenario.key)])
    await Promise.all([
      expect(vue.locator('.element-create-selection')).toBeVisible(),
      expect(react.locator('.mona-element-create-selection')).toBeVisible(),
    ])
    const [vueSlideBox, reactSlideBox, vueScale, reactScale] = await Promise.all([
      vue.locator('.viewport').boundingBox(),
      react.locator('.mona-editor-slide-canvas').boundingBox(),
      vue.locator('.viewport').evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform).a),
      react.locator('.mona-editor-slide-canvas').evaluate(element => new DOMMatrixReadOnly((element as HTMLElement).style.transform).a),
    ])
    const create = async (page: Page, slideBox: NonNullable<typeof vueSlideBox>, scale: number) => {
      const start = { x: slideBox.x + 420 * scale, y: slideBox.y + 260 * scale }
      if (scenario.modifier === 'shift-before') await page.keyboard.down('Shift')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      if (scenario.modifier === 'shift-after-move') {
        await page.mouse.move(start.x + 20, start.y + 8)
        await page.keyboard.down('Shift')
      }
      await page.mouse.move(start.x + scenario.delta.x, start.y + scenario.delta.y)
      await page.mouse.up()
      if (scenario.modifier) await page.keyboard.up('Shift')
    }
    const [vueHistory, reactHistory] = await Promise.all([getVueHistory(vue), getReactHistory(react)])
    await Promise.all([
      create(vue, vueSlideBox!, vueScale),
      create(react, reactSlideBox!, reactScale),
    ])
    const [vueState, reactState] = await Promise.all([getVueState(vue), getReactState(react)])
    expect(vueState.editor.creatingElement).toBeNull()
    expect(reactState.session.activeTool).toBeNull()
    expect(vueState.editor.activeElementIdList).toHaveLength(1)
    expect(reactState.session.activeElementIds).toHaveLength(1)
    const vueElementState = pickElement(vueState, 0, vueState.editor.activeElementIdList[0]!)
    const reactElementState = pickElement(reactState, 0, reactState.session.activeElementIds[0]!)
    expect(elementWithoutGeneratedIdentity(reactElementState)).toEqual(elementWithoutGeneratedIdentity(vueElementState))
    await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
    expect(await getReactHistory(react)).toEqual({ cursor: reactHistory.cursor + 1, length: reactHistory.length + 1 })
    expect(await getVueHistory(vue)).toEqual({ cursor: vueHistory.cursor + 1, length: vueHistory.length + 1 })
    await context.close()
  }
})

test('matches create-overlay chrome, nonline and line live pixels, right-click cancellation, and blank double-click text', async ({ browser }) => {
  const context = await browser.newContext()
  const { react, vue } = await openEditors(context)
  const vueCanvas = vue.locator('.canvas')
  const reactCanvas = react.getByRole('application', { name: 'Editable slide canvas' })
  await Promise.all([
    vueCanvas.click({ position: { x: 30, y: 30 } }),
    reactCanvas.click({ position: { x: 30, y: 30 } }),
  ])
  await Promise.all([vueCanvas.press('l'), reactCanvas.press('l')])
  const vueOverlay = vue.locator('.element-create-selection')
  const reactOverlay = react.locator('.mona-element-create-selection')
  const [vueOverlayChrome, reactOverlayChrome] = await Promise.all([
    vueOverlay.evaluate(element => {
      const style = getComputedStyle(element)
      return { bottom: style.bottom, cursor: style.cursor, left: style.left, position: style.position, right: style.right, top: style.top, zIndex: style.zIndex }
    }),
    reactOverlay.evaluate(element => {
      const style = getComputedStyle(element)
      return { bottom: style.bottom, cursor: style.cursor, left: style.left, position: style.position, right: style.right, top: style.top, zIndex: style.zIndex }
    }),
  ])
  expect(reactOverlayChrome).toEqual(vueOverlayChrome)

  const [vueSlide, reactSlide] = await Promise.all([
    vue.locator('.viewport').boundingBox(),
    react.locator('.mona-editor-slide-canvas').boundingBox(),
  ])
  const start = { x: vueSlide!.x + 700, y: vueSlide!.y + 20 }
  expect(reactSlide!.x).toBe(vueSlide!.x)
  expect(reactSlide!.y).toBe(vueSlide!.y)
  await Promise.all([vue.mouse.move(start.x, start.y), react.mouse.move(start.x, start.y)])
  await Promise.all([vue.mouse.down(), react.mouse.down()])
  await Promise.all([vue.mouse.move(start.x + 100, start.y + 35), react.mouse.move(start.x + 100, start.y + 35)])
  const vueSelection = vue.locator('.element-create-selection .selection.line')
  const reactSelection = react.locator('.mona-create-selection.is-line')
  expect(await reactSelection.boundingBox()).toEqual(await vueSelection.boundingBox())
  const [vueLineChrome, reactLineChrome] = await Promise.all([
    vueSelection.evaluate(element => {
      const path = element.querySelector('path')!
      const style = getComputedStyle(element)
      return { d: path.getAttribute('d'), fill: path.getAttribute('fill'), opacity: style.opacity, stroke: path.getAttribute('stroke'), strokeWidth: path.getAttribute('stroke-width') }
    }),
    reactSelection.evaluate(element => {
      const path = element.querySelector('path')!
      const style = getComputedStyle(element)
      return { d: path.getAttribute('d'), fill: path.getAttribute('fill'), opacity: style.opacity, stroke: path.getAttribute('stroke'), strokeWidth: path.getAttribute('stroke-width') }
    }),
  ])
  expect(reactLineChrome).toEqual(vueLineChrome)
  const [vueLinePixels, reactLinePixels] = await Promise.all([
    vueSelection.screenshot(),
    reactSelection.screenshot(),
  ])
  const vueLineImage = PNG.sync.read(vueLinePixels)
  const reactLineImage = PNG.sync.read(reactLinePixels)
  expect(pixelmatch(
    reactLineImage.data,
    vueLineImage.data,
    null,
    reactLineImage.width,
    reactLineImage.height,
    { includeAA: true, threshold: 0 },
  )).toBe(0)
  await Promise.all([vue.mouse.up(), react.mouse.up()])

  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  await Promise.all([vueCanvas.press('r'), reactCanvas.press('r')])
  const [vueBeforeCancel, reactBeforeCancel, vueHistory, reactHistory] = await Promise.all([
    getVueState(vue), getReactState(react), getVueHistory(vue), getReactHistory(react),
  ])
  await Promise.all([
    vueCanvas.click({ button: 'right', position: { x: 60, y: 60 } }),
    reactCanvas.click({ button: 'right', position: { x: 60, y: 60 } }),
  ])
  await Promise.all([vue.waitForTimeout(20), react.waitForTimeout(20)])
  const [vueCancelled, reactCancelled] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueCancelled.editor.creatingElement).toBeNull()
  expect(reactCancelled.session.activeTool).toBeNull()
  expect(normalizedVueSelection(vueCancelled)).toEqual(normalizedVueSelection(vueBeforeCancel))
  expect(normalizedReactSelection(reactCancelled)).toEqual(normalizedReactSelection(reactBeforeCancel))
  expect(await getVueHistory(vue)).toEqual(vueHistory)
  expect(await getReactHistory(react)).toEqual(reactHistory)
  await Promise.all([expect(vue.locator('.contextmenu')).toHaveCount(0), expect(react.locator('.mona-editor-context-menu')).toHaveCount(0)])

  const vueCount = vueCancelled.presentation.slides[0]!.elements.length
  const reactCount = reactCancelled.presentation.slides[0]!.elements.length
  await Promise.all([
    vue.mouse.dblclick(190, 150),
    react.mouse.dblclick(190, 150),
  ])
  const [vueDouble, reactDouble] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueDouble.presentation.slides[0]!.elements).toHaveLength(vueCount + 1)
  expect(reactDouble.presentation.slides[0]!.elements).toHaveLength(reactCount + 1)
  const vueText = pickElement(vueDouble, 0, vueDouble.editor.activeElementIdList[0]!)
  const reactText = pickElement(reactDouble, 0, reactDouble.session.activeElementIds[0]!)
  expect(elementWithoutGeneratedIdentity(reactText)).toEqual(elementWithoutGeneratedIdentity(vueText))
  await Promise.all([
    vue.locator('#editable-element-gate3-radial-shape .editable-element-shape').click(),
    react.getByRole('button', { name: 'Select shape gate3-radial-shape' }).click(),
  ])
  await Promise.all([vue.waitForTimeout(350), react.waitForTimeout(350)])
  const [vueAfterEmptyBlur, reactAfterEmptyBlur] = await Promise.all([getVueState(vue), getReactState(react)])
  expect(vueAfterEmptyBlur.presentation.slides[0]!.elements).toHaveLength(vueCount)
  expect(reactAfterEmptyBlur.presentation.slides[0]!.elements).toHaveLength(reactCount)
  expect(normalizedReactSelection(reactAfterEmptyBlur)).toEqual(normalizedVueSelection(vueAfterEmptyBlur))
  expect(await getVueHistory(vue)).toEqual({ cursor: vueHistory.cursor + 2, length: vueHistory.length + 2 })
  expect(await getReactHistory(react)).toEqual({ cursor: reactHistory.cursor + 2, length: reactHistory.length + 2 })
  await context.close()
})
