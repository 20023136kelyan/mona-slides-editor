import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DownIcon from '~icons/icon-park-outline/down'
import UpIcon from '~icons/icon-park-outline/up'
import LockIcon from '~icons/icon-park-outline/lock'
import HiddenIcon from '~icons/icon-park-outline/preview-close'
import VisibleIcon from '~icons/icon-park-outline/preview-open'
import { editorActions, selectCurrentSlide, selectSession } from '@mona/editor-state'
import type { PPTElement } from '@mona/presentation-core'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { orderElement } from '@/features/editor/editor-geometry'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

interface GroupItem { elements: PPTElement[]; id: string; type: 'group' }
type SelectionItem = GroupItem | PPTElement

export function EditorLayersPanel({ runtime }: { runtime: EditorRuntime }) {
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
    runtime.commit('Rename element', [{
      type: 'element.update',
      payload: { id, props: { name } },
    }], { historyKey: `layer-name-${slide.id}-${id}` })
    setEditingId('')
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.mona-selection-item[data-element-id="${id}"] .mona-selection-select`)?.focus()
    })
  }
  const cancelName = (id: string) => {
    setEditingId('')
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.mona-selection-item[data-element-id="${id}"] .mona-selection-select`)?.focus()
    })
  }
  const order = (command: 'down' | 'up') => {
    if (!handleElement) return
    const next = orderElement(slide.elements, handleElement.id, command)
    if (next) runtime.commit('Order element', [{ type: 'slide.update', slideId: slide.id, props: { elements: next } }], { historyKey: 'order-element' })
  }
  const typeName = (type: string) => t(`foundation.editor.elementTypes.${type}`, { defaultValue: type })

  const renderItem = (element: PPTElement, group?: GroupItem) => {
    const hidden = session.hiddenElementIds.includes(element.id)
    const active = session.activeElementIds.includes(element.id)
    const groupActive = session.activeGroupElementId === element.id
    const name = element.name || typeName(element.type)
    return (
      <div
        className={`mona-selection-item${active ? ' is-active' : ''}${groupActive ? ' is-group-active' : ''}${element.lock ? ' is-locked' : ''}`}
        data-element-id={element.id}
        key={element.id}
      >
        {editingId === element.id ? (
          <Input
            aria-label={t('foundation.editor.selection.renameElement', { name })}
            defaultValue={name}
            onBlur={event => saveName(element.id, event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                saveName(element.id, event.currentTarget.value)
              }
              else if (event.key === 'Escape') {
                event.preventDefault()
                cancelName(element.id)
              }
            }}
            ref={editRef}
          />
        ) : (
          <Button
            aria-label={t('foundation.editor.selection.selectElement', { name })}
            aria-disabled={element.lock || hidden}
            aria-pressed={active}
            className="mona-selection-name mona-selection-select"
            onClick={() => group ? selectGroupElement(group, element) : selectElement(element)}
            onDoubleClick={() => setEditingId(element.id)}
            onKeyDown={event => {
              if (event.key !== 'F2') return
              event.preventDefault()
              setEditingId(element.id)
            }}
            onMouseDown={event => {
              // Selection state can commit between the two native clicks.
              // Enter edit mode on the second press so rename remains a
              // stable double-click gesture.
              if (event.detail === 2) {
                event.preventDefault()
                setEditingId(element.id)
              }
            }}
            type="button"
            variant="ghost"
          >{name}</Button>
        )}
        <div className="mona-selection-icons">
          {element.lock ? (
            <Button
              aria-label={t('foundation.editor.selection.unlockElement', { name })}
              onClick={() => unlock(element)}
              size="editor-icon"
              type="button"
              variant="ghost"
            ><LockIcon /></Button>
          ) : <span aria-hidden="true" />}
          <Button
            aria-label={t(`foundation.editor.selection.${hidden ? 'showElement' : 'hideElement'}`, { name })}
            onClick={() => toggleHidden(element.id)}
            size="editor-icon"
            type="button"
            variant="ghost"
          >{hidden ? <HiddenIcon /> : <VisibleIcon />}</Button>
        </div>
      </div>
    )
  }

  const content = (
    <>
      {elements.length ? (
        <>
          <div className="mona-selection-handler">
            <div><Button onClick={showAll} size="xs" variant="ghost">{t('foundation.editor.selection.showAll')}</Button><Button onClick={hideAll} size="xs" variant="ghost">{t('foundation.editor.selection.hideAll')}</Button></div>
            {handleElement ? (
              <div className="mona-selection-order">
                <Button aria-label={t('common.moveUp')} onClick={() => order('up')} size="editor-icon" type="button" variant="ghost"><DownIcon /></Button>
                <Button aria-label={t('common.moveDown')} onClick={() => order('down')} size="editor-icon" type="button" variant="ghost"><UpIcon /></Button>
              </div>
            ) : null}
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
    </>
  )

  return <div className="mona-selection-panel is-embedded">{content}</div>
}
