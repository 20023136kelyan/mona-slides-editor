import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  CopyPlus,
  Link,
  Lock,
  LockOpen,
  MessageSquare,
  MousePointer2,
  Trash2,
  Ungroup,
  Users,
} from 'lucide-react'

import type { PPTElement } from '@mona/presentation-core/model'

import { Button } from '@/components/ui/button'
import type { SelectionCapabilities } from '@/features/editor/contextual/resolve-selection-capabilities'
import { getElementsBounds } from '@/features/editor/editor-geometry'

interface EditorSelectionActionsProps {
  capabilities: SelectionCapabilities
  elements: readonly PPTElement[]
  frameRef: RefObject<HTMLDivElement | null>
  onAskMona: () => void
  onComment: () => void
  onDelete: () => void
  onDuplicate: () => void
  onEditLink: () => void
  onGroup: () => void
  onLock: (lock: boolean) => void
  onSelectGroup: () => void
  onUngroup: () => void
  scale: number
  stageRef: RefObject<HTMLElement | null>
  viewportRatio: number
  viewportSize: number
}

export function EditorSelectionActions({
  capabilities,
  elements,
  frameRef,
  onAskMona,
  onComment,
  onDelete,
  onDuplicate,
  onEditLink,
  onGroup,
  onLock,
  onSelectGroup,
  onUngroup,
  scale,
  stageRef,
  viewportRatio,
  viewportSize,
}: EditorSelectionActionsProps) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const page = capabilities.selectionKind === 'page'
  const locked = capabilities.values.lock === true

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const frame = frameRef.current
    const stage = stageRef.current
    if (!toolbar || !frame || !stage || capabilities.mode === 'crop') return undefined
    const update = () => {
      const bounds = elements.length
        ? getElementsBounds(elements)
        : { minX: 0, minY: 0, maxX: viewportSize, maxY: viewportSize * viewportRatio }
      const stageRect = stage.getBoundingClientRect()
      const frameRect = frame.getBoundingClientRect()
      const minLeft = stageRect.left - frameRect.left + 10
      const maxLeft = stageRect.right - frameRect.left - toolbar.clientWidth - 10
      const centered = (bounds.minX + bounds.maxX) / 2 * scale - toolbar.clientWidth / 2
      const left = maxLeft < minLeft ? minLeft : Math.min(Math.max(centered, minLeft), maxLeft)
      const bottomTop = bounds.maxY * scale + 10
      const stageBottom = stageRect.bottom - frameRect.top
      const placeAbove = bottomTop + toolbar.clientHeight > stageBottom
      const rotateGap = page || elements.every(element => element.type === 'line' || element.type === 'chart') ? 10 : 40
      const requestedTop = placeAbove
        ? page
          // Page actions never leave the slide: with no room below, they sit
          // on the slide's bottom edge instead of jumping across the stage.
          ? stageBottom - toolbar.clientHeight - 10
          : bounds.minY * scale - toolbar.clientHeight - rotateGap
        : bottomTop
      // The floating contextual pill owns the stage top (20px + 40px pill);
      // clamping below it keeps the two from stacking into one another.
      const top = Math.max(stageRect.top - frameRect.top + 76, requestedTop)
      setPosition(current => current?.left === left && current.top === top ? current : { left, top })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [capabilities.mode, elements, frameRef, page, scale, stageRef, viewportRatio, viewportSize])

  if (capabilities.mode === 'crop') return null

  const moveActionFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = controls.indexOf(event.target as HTMLButtonElement)
    if (index === -1 || !controls.length) return
    event.preventDefault()
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? controls.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % controls.length
          : (index - 1 + controls.length) % controls.length
    controls[next]?.focus()
  }

  return (
    <div
      aria-label={t(page ? 'foundation.editor.contextual.pageActions' : 'foundation.editor.contextual.objectActions')}
      className="mona-selection-actions"
      data-selection-kind={capabilities.selectionKind}
      onKeyDown={moveActionFocus}
      onPointerDown={event => event.stopPropagation()}
      ref={toolbarRef}
      role="toolbar"
      style={position || { visibility: 'hidden' }}
      tabIndex={-1}
    >
      <Button aria-label={t('foundation.editor.contextual.askMona')} onClick={onAskMona} size="editor-icon" title={t('foundation.editor.contextual.askMona')} type="button" variant="ghost"><Bot /></Button>
      {capabilities.selectionKind === 'group-child' ? (
        <Button aria-label={t('foundation.editor.contextual.selectGroup')} onClick={onSelectGroup} size="editor-icon" title={t('foundation.editor.contextual.selectGroup')} type="button" variant="ghost"><MousePointer2 /></Button>
      ) : null}
      {capabilities.canGroup ? (
        <Button aria-label={t('foundation.editor.action.group')} onClick={onGroup} size="editor-icon" title={t('foundation.editor.action.group')} type="button" variant="ghost"><Users /></Button>
      ) : null}
      {capabilities.canUngroup ? (
        <Button aria-label={t('foundation.editor.action.ungroup')} onClick={onUngroup} size="editor-icon" title={t('foundation.editor.action.ungroup')} type="button" variant="ghost"><Ungroup /></Button>
      ) : null}
      {capabilities.mode === 'text-edit' && capabilities.canLink ? (
        <Button aria-label={t('foundation.editor.action.setLink')} onClick={onEditLink} size="editor-icon" title={t('foundation.editor.action.setLink')} type="button" variant="ghost"><Link /></Button>
      ) : null}
      <Button aria-label={t('foundation.editor.contextual.comment')} onClick={onComment} size="editor-icon" title={t('foundation.editor.contextual.comment')} type="button" variant="ghost"><MessageSquare /></Button>
      {capabilities.canLock && !page ? (
        <Button aria-label={t(locked ? 'foundation.editor.action.unlock' : 'foundation.editor.action.lock')} onClick={() => onLock(!locked)} size="editor-icon" title={t(locked ? 'foundation.editor.action.unlock' : 'foundation.editor.action.lock')} type="button" variant="ghost">
          {locked ? <LockOpen /> : <Lock />}
        </Button>
      ) : null}
      {capabilities.canDuplicate ? (
        <Button aria-label={t(page ? 'foundation.editor.thumbnails.duplicateSlide' : 'foundation.editor.contextual.duplicate')} onClick={onDuplicate} size="editor-icon" title={t(page ? 'foundation.editor.thumbnails.duplicateSlide' : 'foundation.editor.contextual.duplicate')} type="button" variant="ghost"><CopyPlus /></Button>
      ) : null}
      {capabilities.canDelete ? (
        <Button aria-label={t(page ? 'foundation.editor.thumbnails.deleteSlide' : 'foundation.editor.action.delete')} onClick={onDelete} size="editor-icon" title={t(page ? 'foundation.editor.thumbnails.deleteSlide' : 'foundation.editor.action.delete')} type="button" variant="ghost"><Trash2 /></Button>
      ) : null}
    </div>
  )
}
