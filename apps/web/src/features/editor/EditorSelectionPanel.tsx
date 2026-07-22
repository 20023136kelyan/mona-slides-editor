/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- Selection rows and their nested visibility/layer handles preserve PPTist's direct-manipulation event model. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import UpIcon from '~icons/icon-park-outline/up'
import LockIcon from '~icons/icon-park-outline/lock'
import HiddenIcon from '~icons/icon-park-outline/preview-close'
import VisibleIcon from '~icons/icon-park-outline/preview-open'
import { editorActions, selectCurrentSlide, selectSession } from '@mona/editor-state'
import type { PPTElement } from '@mona/presentation-core'

import { orderElementLikeVue } from '@/features/editor/editor-element-operations'
import { EditorMoveablePanel } from '@/features/editor/EditorMoveablePanel'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

interface GroupItem { elements: PPTElement[]; id: string; type: 'group' }
type SelectionItem = GroupItem | PPTElement

export function EditorSelectionPanel({ onClose, runtime }: { onClose: () => void; runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const slide = useEditorSelector(runtime.store, selectCurrentSlide)!
  const session = useEditorSelector(runtime.store, selectSession)
  const [editingId, setEditingId] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const elements = useMemo<SelectionItem[]>(() => {
    const result: SelectionItem[] = []
    for (const element of slide.elements) {
      if (!element.groupId) result.push(element)
      else {
        const previous = result[result.length - 1]
        if (previous?.type === 'group' && previous.id === element.groupId) previous.elements.push(element)
        else result.push({ type: 'group', id: element.groupId, elements: [element] })
      }
    }
    return result
  }, [slide.elements])
  const handleElement = slide.elements.find(element => element.id === session.handleElementId)

  useEffect(() => {
    editRef.current?.focus() 
  }, [editingId])

  const selectElement = (element: PPTElement) => {
    if (session.handleElementId === element.id || element.lock || session.hiddenElementIds.includes(element.id)) return
    runtime.store.dispatch(editorActions.selectionChanged([element.id]))
  }
  const selectGroupElement = (group: GroupItem, element: PPTElement) => {
    if (session.handleElementId === element.id || session.hiddenElementIds.includes(element.id)) return
    const ids = group.elements.filter(item => !item.lock).map(item => item.id)
    if (!ids.length) return
    runtime.store.dispatch(editorActions.selectionChanged(ids))
    runtime.store.dispatch(editorActions.handleElementChanged(element.id))
    queueMicrotask(() => runtime.store.dispatch(editorActions.activeGroupElementChanged(element.id)))
  }
  const toggleHidden = (id: string) => {
    const hidden = session.hiddenElementIds.includes(id)
      ? session.hiddenElementIds.filter(item => item !== id)
      : [...session.hiddenElementIds, id]
    runtime.store.dispatch(editorActions.hiddenElementsChanged(hidden))
    if (!session.hiddenElementIds.includes(id) && session.activeElementIds.includes(id)) runtime.store.dispatch(editorActions.selectionChanged([]))
  }
  const showAll = () => {
    const currentIds = new Set(slide.elements.map(element => element.id))
    runtime.store.dispatch(editorActions.hiddenElementsChanged(session.hiddenElementIds.filter(id => !currentIds.has(id))))
  }
  const hideAll = () => {
    runtime.store.dispatch(editorActions.hiddenElementsChanged([...session.hiddenElementIds, ...slide.elements.map(element => element.id)]))
    if (session.activeElementIds.length) runtime.store.dispatch(editorActions.selectionChanged([]))
  }
  const unlock = (target: PPTElement) => {
    const elements = structuredClone(slide.elements)
    const selected: string[] = []
    for (const element of elements) {
      if (target.groupId ? element.groupId === target.groupId : element.id === target.id) {
        element.lock = false
        selected.push(element.id)
      }
    }
    if (runtime.commit('Unlock element', [{ type: 'slide.update', slideId: slide.id, props: { elements } }], { historyKey: 'lock-handler' })) {
      runtime.store.dispatch(editorActions.selectionChanged(selected))
    }
  }
  const saveName = (id: string, name: string) => {
    runtime.commit('Rename element', [{ type: 'element.update', payload: { id, props: { name } } }], { recordHistory: false })
    setEditingId('')
  }
  const order = (command: 'down' | 'up') => {
    if (!handleElement) return
    const next = orderElementLikeVue(slide.elements, handleElement, command)
    if (next) runtime.commit('Order element', [{ type: 'slide.update', slideId: slide.id, props: { elements: next } }], { historyKey: 'order-element' })
  }
  const typeName = (type: string) => t(`foundation.editor.elementTypes.${type}`, { defaultValue: type })

  const renderItem = (element: PPTElement, group?: GroupItem) => {
    const hidden = session.hiddenElementIds.includes(element.id)
    const active = session.activeElementIds.includes(element.id)
    const groupActive = session.activeGroupElementId === element.id
    return (
      <div
        className={`mona-selection-item${active ? ' is-active' : ''}${groupActive ? ' is-group-active' : ''}${element.lock ? ' is-locked' : ''}`}
        data-element-id={element.id}
        key={element.id}
        onClick={() => group ? selectGroupElement(group, element) : selectElement(element)}
        onDoubleClick={() => setEditingId(element.id)}
        onMouseDown={event => {
          // React can commit the first click's selection between the two
          // native clicks. Enter edit mode on the second pointer-down so the
          // source double-click gesture survives that state render.
          if (event.detail === 2) {
            event.preventDefault()
            setEditingId(element.id)
          }
        }}
      >
        {editingId === element.id ? (
          <input defaultValue={element.name || typeName(element.type)} onBlur={event => saveName(element.id, event.currentTarget.value)} onKeyDown={event => {
            if (event.key === 'Enter') saveName(element.id, event.currentTarget.value) 
          }} ref={editRef} />
        ) : <div className="mona-selection-name">{element.name || typeName(element.type)}</div>}
        <div className="mona-selection-icons">
          {element.lock ? <LockIcon onClick={() => unlock(element)} /> : <span />}
          {hidden ? <HiddenIcon onClick={event => {
            event.stopPropagation(); toggleHidden(element.id) 
          }} /> : <VisibleIcon onClick={event => {
            event.stopPropagation(); toggleHidden(element.id) 
          }} />}
        </div>
      </div>
    )
  }

  return (
    <EditorMoveablePanel
      className="mona-selection-panel"
      height={360}
      left={-270}
      onClose={onClose}
      title={t('foundation.editor.selection.title', { selected: session.activeElementIds.length, total: slide.elements.length })}
      top={90}
      width={200}
    >
      {elements.length ? (
        <>
          <div className="mona-selection-handler">
            <div><button onClick={showAll} type="button">{t('foundation.editor.selection.showAll')}</button><button onClick={hideAll} type="button">{t('foundation.editor.selection.hideAll')}</button></div>
            {handleElement ? <div className="mona-selection-order"><span onClick={() => order('up')}><DownIcon /></span><span onClick={() => order('down')}><UpIcon /></span></div> : null}
          </div>
          <div className="mona-selection-list">
            {elements.map(item => item.type === 'group' ? (
              <div className="mona-selection-group" key={item.id}>
                <div className="mona-selection-group-title">{t('foundation.editor.selection.group')}</div>
                {item.elements.map(element => renderItem(element, item))}
              </div>
            ) : renderItem(item))}
          </div>
        </>
      ) : <div className="mona-selection-empty">{t('foundation.editor.selection.empty')}</div>}
    </EditorMoveablePanel>
  )
}
