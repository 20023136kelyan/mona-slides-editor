/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- Tabs and compact search suffix controls preserve PPTist's exact pointer DOM and geometry. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import CloseIcon from '~icons/icon-park-outline/close'
import LeftIcon from '~icons/icon-park-outline/left'
import RightIcon from '~icons/icon-park-outline/right'
import { editorActions, selectPresentation, selectSession } from '@mona/editor-state'
import type { PPTElement, PPTTableElement } from '@mona/presentation-core'
import { normalizeRichTextHtml } from '@mona/rich-text'

import { EditorMoveablePanel } from '@/features/editor/EditorMoveablePanel'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

type SearchResult =
  | { elId: string; elType: 'shape' | 'text'; slideId: string }
  | { cellIndex: [number, number]; elId: string; elType: 'table'; slideId: string }

const textRegex = /(<([^>]+)>)/g

const textNodes = (dom: Node) => {
  const queue = [...dom.childNodes]
  const result: Text[] = []
  while (queue.length) {
    const node = queue.shift()!
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).wholeText) result.push(node as Text)
    }
    else queue.unshift(...node.childNodes)
  }
  return result
}

const replaceAllText = (html: string, expression: RegExp, replacement: string, resultOffset: number) => {
  const root = document.createElement('div')
  root.innerHTML = html
  const nodes = textNodes(root)
  const info: Array<{ end: number; start: number; text: string }> = []
  let length = 0
  for (const node of nodes) {
    info.push({ text: node.wholeText, start: length, end: length + node.wholeText.length })
    length += node.wholeText.length
  }
  const content = info.map(item => item.text).join('')
  const matches: RegExpExecArray[] = []
  let match = expression.exec(content)
  while (match) {
    matches.push(match)
    if (match[0].length === 0) expression.lastIndex += 1
    match = expression.exec(content)
  }
  for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
    const currentMatch = matches[matchIndex]!
    const matchEnd = currentMatch.index + currentMatch[0].length
    for (let textIndex = 0; textIndex < info.length; textIndex += 1) {
      const item = info[textIndex]!
      if (item.end < currentMatch.index) continue
      if (item.start >= matchEnd) break
      let node = nodes[textIndex]!
      const localStart = Math.max(0, currentMatch.index - item.start)
      const localLength = Math.min(item.end, matchEnd) - item.start - localStart
      if (localStart > 0) node = node.splitText(localStart)
      if (localLength < node.wholeText.length) node.splitText(localLength)
      const mark = document.createElement('mark')
      mark.dataset.index = String(resultOffset + matchIndex)
      mark.innerText = item.text.substring(localStart, localStart + localLength)
      node.parentNode?.replaceChild(mark, node)
    }
  }
  let previousMarkIndex = -1
  for (const mark of root.querySelectorAll<HTMLElement>('mark[data-index]')) {
    const markIndex = Number(mark.dataset.index)
    const parent = mark.parentNode
    if (!parent) continue
    if (markIndex === previousMarkIndex) parent.removeChild(mark)
    else {
      parent.replaceChild(document.createTextNode(replacement), mark)
      previousMarkIndex = markIndex
    }
  }
  return root.innerHTML
}

const replaceNthText = (html: string, expression: RegExp, occurrence: number, replacement: string) => {
  const root = document.createElement('div')
  root.innerHTML = html
  const nodes = textNodes(root)
  const ranges: Array<{ end: number; start: number }> = []
  let match = expression.exec(nodes.map(node => node.data).join(''))
  while (match) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
    if (match[0].length === 0) expression.lastIndex += 1
    match = expression.exec(nodes.map(node => node.data).join(''))
  }
  const target = ranges[occurrence]
  if (!target) return html
  let offset = 0
  let startNode: Text | null = null
  let endNode: Text | null = null
  let startOffset = 0
  let endOffset = 0
  for (const node of nodes) {
    const next = offset + node.data.length
    if (!startNode && target.start >= offset && target.start <= next) {
      startNode = node; startOffset = target.start - offset 
    }
    if (target.end >= offset && target.end <= next) {
      endNode = node; endOffset = target.end - offset; break 
    }
    offset = next
  }
  if (!startNode || !endNode) return html
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  range.deleteContents()
  range.insertNode(document.createTextNode(replacement))
  return root.innerHTML
}

const replaceActiveMark = (html: string, replacement: string) => {
  const root = document.createElement('div')
  root.innerHTML = html
  let replaced = false
  for (const mark of root.querySelectorAll('mark[data-index]')) {
    const parent = mark.parentNode
    if (!parent) continue
    if (mark.classList.contains('active')) {
      if (replaced) parent.removeChild(mark)
      else {
        parent.replaceChild(document.createTextNode(replacement), mark)
        replaced = true
      }
    }
    else parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
  }
  return root.innerHTML
}

export function EditorSearchPanel({ onClose, runtime }: { onClose: () => void; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const session = useEditorSelector(runtime.store, selectSession)
  const [mode, setMode] = useState<'replace' | 'search'>('search')
  const [searchWord, setSearchWordValue] = useState('')
  const [replaceWord, setReplaceWord] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [modifiers, setModifiers] = useState<'g' | 'gi'>('g')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const latestRef = useRef({ presentation, results, searchIndex, searchWord, modifiers })
  const highlightCurrentSlideRef = useRef<() => void>(() => undefined)

  useLayoutEffect(() => {
    latestRef.current = { presentation, results, searchIndex, searchWord, modifiers }
  }, [modifiers, presentation, results, searchIndex, searchWord])

  const notice = (text: string) => window.dispatchEvent(new CustomEvent('mona:notice', { detail: { text, type: 'warning' } }))
  const clearMarks = () => {
    for (const mark of document.querySelectorAll('.mona-editor-slide-canvas mark[data-index]')) {
      const parent = mark.parentNode
      if (parent) parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
    }
  }
  const activeMark = (index: number) => {
    for (const mark of document.querySelectorAll<HTMLElement>('.mona-editor-slide-canvas mark[data-index]')) {
      mark.classList.toggle('active', Number(mark.dataset.index) === index)
    }
  }
  const matchList = (content: string, keyword: string) => {
    const expression = new RegExp(keyword, modifiers)
    const matches: RegExpExecArray[] = []
    let match = expression.exec(content)
    while (match) {
      matches.push(match)
      if (match[0].length === 0) expression.lastIndex += 1
      match = expression.exec(content)
    }
    return matches
  }
  const highlightText = (root: Element, startIndex: number) => {
    const nodes = textNodes(root)
    const info: Array<{ end: number; start: number; text: string }> = []
    let length = 0
    for (const node of nodes) {
      info.push({ text: node.data, start: length, end: length + node.data.length })
      length += node.data.length
    }
    const matches = matchList(info.map(item => item.text).join(''), searchWord)
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const match = matches[matchIndex]!
      const end = match.index + match[0].length
      for (let index = 0; index < info.length; index += 1) {
        const item = info[index]!
        if (item.end < match.index) continue
        if (item.start >= end) break
        let node = nodes[index]!
        const localStart = Math.max(0, match.index - item.start)
        const localLength = Math.min(item.end, end) - item.start - localStart
        if (localStart > 0) node = node.splitText(localStart)
        if (localLength < node.data.length) node.splitText(localLength)
        const mark = document.createElement('mark')
        mark.dataset.index = String(startIndex + matchIndex)
        mark.innerText = item.text.substring(localStart, localStart + localLength)
        node.parentNode?.replaceChild(mark, node)
      }
    }
  }
  const highlightCurrentSlide = (searchResults = results, activeIndex = searchIndex) => {
    clearMarks()
    setTimeout(() => {
      const state = latestRef.current.presentation
      const current = state.slides[state.slideIndex]
      for (let index = 0; index < searchResults.length; index += 1) {
        const previous = searchResults[index - 1]
        const target = searchResults[index]!
        if (!current || target.slideId !== current.id || (previous && previous.elId === target.elId)) continue
        const root = document.querySelector(`.mona-editor-slide-canvas [data-element-id="${CSS.escape(target.elId)}"]`)
        if (!root) continue
        if (target.elType === 'table') {
          let markIndex = index
          for (const cell of root.querySelectorAll<HTMLElement>('.mona-table-cell-text')) {
            cell.innerHTML = cell.innerHTML.replace(new RegExp(searchWord, modifiers), () => `<mark data-index="${markIndex++}">${searchWord}</mark>`)
          }
        }
        else {
          const editor = root.querySelector('.ProseMirror, .ProseMirror-static')
          if (editor) highlightText(editor, index)
        }
      }
      activeMark(activeIndex)
    }, 0)
  }
  useLayoutEffect(() => {
    highlightCurrentSlideRef.current = () => highlightCurrentSlide()
  })
  const collectResults = () => {
    const collected: SearchResult[] = []
    const expression = new RegExp(searchWord, modifiers)
    for (const slide of presentation.slides) {
      for (const element of slide.elements) {
        if (element.type === 'text') {
          const matches = element.content.replace(textRegex, '').match(expression)
          if (matches) collected.push(...matches.map(() => ({ slideId: slide.id, elId: element.id, elType: 'text' as const })))
        }
        else if (element.type === 'shape' && element.text?.content) {
          const matches = element.text.content.replace(textRegex, '').match(expression)
          if (matches) collected.push(...matches.map(() => ({ slideId: slide.id, elId: element.id, elType: 'shape' as const })))
        }
        else if (element.type === 'table') {
          element.data.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
            const matches = cell.text?.replace(textRegex, '').match(expression)
            if (matches) collected.push(...matches.map(() => ({ slideId: slide.id, elId: element.id, elType: 'table' as const, cellIndex: [rowIndex, columnIndex] as [number, number] })))
          }))
        }
      }
    }
    return collected
  }
  const turnTarget = (index: number, searchResults: SearchResult[]) => {
    if (index < 0) return
    const target = searchResults[index]
    if (!target) return
    const current = presentation.slides[presentation.slideIndex]
    if (target.slideId === current?.id) setTimeout(() => activeMark(index), 0)
    else {
      const slideIndex = presentation.slides.findIndex(slide => slide.id === target.slideId)
      if (slideIndex !== -1) runtime.focusSlide(slideIndex)
    }
  }
  const search = () => {
    const collected = collectResults()
    if (!collected.length) {
      notice(t('foundation.editor.runtime.noSearchMatch'))
      clearMarks()
      return []
    }
    setResults(collected)
    setSearchIndex(0)
    highlightCurrentSlide(collected, 0)
    return collected
  }
  const searchNext = () => {
    if (!searchWord) {
      notice(t('foundation.editor.runtime.enterSearchText')); return 
    }
    runtime.store.dispatch(editorActions.selectionChanged([]))
    const currentResults = searchIndex === -1 ? search() : results
    if (!currentResults.length) return
    const next = searchIndex === -1 ? 0 : searchIndex < currentResults.length - 1 ? searchIndex + 1 : 0
    setSearchIndex(next)
    turnTarget(next, currentResults)
  }
  const searchPrev = () => {
    if (!searchWord) {
      notice(t('foundation.editor.runtime.enterSearchText')); return 
    }
    runtime.store.dispatch(editorActions.selectionChanged([]))
    const currentResults = searchIndex === -1 ? search() : results
    if (!currentResults.length) return
    const next = searchIndex === -1 ? 0 : searchIndex > 0 ? searchIndex - 1 : currentResults.length - 1
    setSearchIndex(next)
    turnTarget(next, currentResults)
  }
  const updateElementContent = (target: SearchResult, content: string) => {
    const state = runtime.store.getState().presentation
    const slide = state.slides.find(item => item.id === target.slideId)
    const element = slide?.elements.find(item => item.id === target.elId)
    if (!element) return
    if (element.type === 'text') {
      runtime.commit('Replace text', [{
        type: 'element.update',
        payload: { id: element.id, slideId: slide!.id, props: { content } },
      }], { recordHistory: false })
    }
    else if (element.type === 'shape' && element.text) {
      runtime.commit('Replace shape text', [{
        type: 'element.update',
        payload: { id: element.id, slideId: slide!.id, props: { text: { ...element.text, content } } },
      }], { recordHistory: false })
    }
    else if (element.type === 'table' && target.elType === 'table') {
      const data = element.data.map((row, rowIndex) => row.map((cell, columnIndex) => rowIndex === target.cellIndex[0] && columnIndex === target.cellIndex[1] ? { ...cell, text: content } : cell))
      runtime.commit('Replace table text', [{ type: 'element.update', payload: { id: element.id, slideId: slide!.id, props: { data } } }], { recordHistory: false })
    }
  }
  const replace = () => {
    if (!searchWord) return
    if (searchIndex === -1) {
      searchNext(); return 
    }
    const target = results[searchIndex]
    if (!target) return
    const root = document.querySelector(`.mona-editor-slide-canvas [data-element-id="${CSS.escape(target.elId)}"]`)
    const targetElement = target.elType === 'table'
      ? root?.querySelector(`.mona-table-cell[data-cell-index="${target.cellIndex[0]}_${target.cellIndex[1]}"] .mona-table-cell-text`)
      : root?.querySelector('.ProseMirror, .ProseMirror-static')
    if (!targetElement) return
    let occurrence = 0
    for (let index = searchIndex - 1; index >= 0; index -= 1) {
      const candidate = results[index]!
      const sameCell = target.elType !== 'table' || (candidate.elType === 'table' && candidate.cellIndex[0] === target.cellIndex[0] && candidate.cellIndex[1] === target.cellIndex[1])
      if (candidate.slideId === target.slideId && candidate.elId === target.elId && sameCell) occurrence += 1
      else break
    }
    const state = runtime.store.getState().presentation
    const storedElement = state.slides.find(slide => slide.id === target.slideId)?.elements.find(element => element.id === target.elId)
    const storedHtml = storedElement?.type === 'text'
      ? storedElement.content
      : storedElement?.type === 'shape'
        ? storedElement.text?.content
        : undefined
    const content = target.elType === 'table'
      ? replaceActiveMark(targetElement.innerHTML, replaceWord)
      : replaceNthText(normalizeRichTextHtml(storedHtml ?? targetElement.innerHTML), new RegExp(searchWord, modifiers), occurrence, replaceWord)
    updateElementContent(target, content)
    const nextResults = results.filter((_, index) => index !== searchIndex)
    const nextIndex = nextResults.length ? Math.min(searchIndex, nextResults.length - 1) : -1
    setResults(nextResults)
    setSearchIndex(nextIndex)
    if (nextResults.length) {
      setTimeout(() => {
        highlightCurrentSlide(nextResults, nextIndex); turnTarget(nextIndex, nextResults) 
      }, 0)
    }
    else clearMarks()
  }
  const replaceAll = () => {
    if (!searchWord) return
    if (searchIndex === -1) {
      searchNext(); return 
    }
    const state = runtime.store.getState().presentation
    const commands: Array<{ type: 'element.update'; payload: { id: string; slideId: string; props: Partial<PPTElement> } }> = []
    const preservedTableMarkup: Array<{ cellIndex: [number, number]; elId: string; html: string }> = []
    for (let index = 0; index < results.length; index += 1) {
      const previous = results[index - 1]
      const target = results[index]!
      if (previous?.elId === target.elId) continue
      const slide = state.slides.find(item => item.id === target.slideId)
      const element = slide?.elements.find(item => item.id === target.elId)
      if (!slide || !element) continue
      if (element.type === 'table') {
        const data = (element as PPTTableElement).data.map((row, rowIndex) => row.map((cell, columnIndex) => {
          if (!cell.text) return cell
          const text = cell.text.replace(new RegExp(searchWord, 'g'), replaceWord)
          if (text === cell.text && slide.id === state.slides[state.slideIndex]?.id) {
            const cellText = document.querySelector<HTMLElement>(`.mona-editor-slide-canvas [data-element-id="${CSS.escape(element.id)}"] .mona-table-cell[data-cell-index="${rowIndex}_${columnIndex}"] .mona-table-cell-text`)
            if (cellText?.querySelector('mark[data-index]')) preservedTableMarkup.push({ elId: element.id, cellIndex: [rowIndex, columnIndex], html: cellText.innerHTML })
          }
          return { ...cell, text }
        }))
        commands.push({ type: 'element.update', payload: { id: element.id, slideId: slide.id, props: { data } } })
      }
      else if (element.type === 'text') {
        commands.push({ type: 'element.update', payload: { id: element.id, slideId: slide.id, props: { content: replaceAllText(element.content, new RegExp(searchWord, modifiers), replaceWord, index) } } })
      }
      else if (element.type === 'shape' && element.text) {
        const currentSlide = state.slides[state.slideIndex]
        const currentShape = currentSlide?.elements.find(item => item.id === target.elId)
        if (currentShape?.type === 'shape' && currentShape.text) commands.push({ type: 'element.update', payload: { id: currentShape.id, slideId: currentSlide.id, props: { text: { ...currentShape.text, content: replaceAllText(element.text.content, new RegExp(searchWord, modifiers), replaceWord, index) } } } })
      }
    }
    if (commands.length) runtime.commit('Replace all text', commands, { recordHistory: false })
    if (preservedTableMarkup.length) {
      setTimeout(() => {
        for (const item of preservedTableMarkup) {
          const cellText = document.querySelector<HTMLElement>(`.mona-editor-slide-canvas [data-element-id="${CSS.escape(item.elId)}"] .mona-table-cell[data-cell-index="${item.cellIndex[0]}_${item.cellIndex[1]}"] .mona-table-cell-text`)
          if (cellText) cellText.innerHTML = item.html
        }
      }, 0)
    }
    setResults([])
    setSearchIndex(-1)
  }
  const reset = (value = searchWord) => {
    setSearchIndex(-1)
    setResults([])
    if (!value) clearMarks()
  }

  useEffect(() => {
    searchInputRef.current?.focus() 
  }, [mode])
  useEffect(() => {
    highlightCurrentSlideRef.current()
    setTimeout(() => activeMark(latestRef.current.searchIndex), 0)
  }, [presentation.slideIndex])
  useEffect(() => {
    if (!session.handleElementId) return undefined
    let active = true
    queueMicrotask(() => {
      if (!active) return
      reset()
      clearMarks()
    })
    return () => {
      active = false 
    }
  }, [session.handleElementId])
  useEffect(() => () => clearMarks(), [])

  const setSearchWord = (value: string) => {
    setSearchWordValue(value); reset(value) 
  }

  return (
    <EditorMoveablePanel className="mona-search-panel" height={0} left={-270} top={90} width={330}>
      <div className="mona-search-close" onClick={onClose} onMouseDown={event => event.stopPropagation()}><CloseIcon /></div>
      <div className="mona-search-tabs">
        <div className={mode === 'search' ? 'is-active' : ''} onClick={() => setMode('search')}>{t('foundation.editor.search.find')}</div>
        <div className={mode === 'replace' ? 'is-active' : ''} onClick={() => setMode('replace')}>{t('foundation.editor.search.replace')}</div>
      </div>
      <div className={`mona-search-content is-${mode}`} onMouseDown={event => event.stopPropagation()}>
        <div className="mona-search-input">
          <input onChange={event => setSearchWord(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter') searchNext() 
          }} placeholder={t('foundation.editor.search.findPlaceholder')} ref={searchInputRef} value={searchWord} />
          <span className="mona-search-count">{searchIndex + 1}/{results.length}</span><i />
          <span className={`mona-search-case${modifiers === 'g' ? ' is-active' : ''}`} onClick={() => {
            setModifiers(value => value === 'g' ? 'gi' : 'g'); reset() 
          }}>Aa</span><i />
          <span className="mona-search-next" onClick={searchPrev}><LeftIcon /></span><span className="mona-search-next" onClick={searchNext}><RightIcon /></span>
        </div>
        {mode === 'replace' ? <div className="mona-search-input"><input onChange={event => setReplaceWord(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') replace() 
        }} placeholder={t('foundation.editor.search.replacePlaceholder')} value={replaceWord} /></div> : null}
        {mode === 'replace' ? <div className="mona-search-footer"><button disabled={!searchWord} onClick={replace}>{t('foundation.editor.action.replace')}</button><button className="is-primary" disabled={!searchWord} onClick={replaceAll}>{t('foundation.editor.action.replaceAll')}</button></div> : null}
      </div>
    </EditorMoveablePanel>
  )
}
