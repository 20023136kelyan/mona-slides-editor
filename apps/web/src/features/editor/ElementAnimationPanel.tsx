/* oxlint-disable jsx-a11y/prefer-tag-over-role -- source sequence rows are draggable composite controls containing their own action buttons. */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import ClickIcon from '~icons/icon-park-outline/click'
import CloseIcon from '~icons/icon-park-outline/close-small'
import EffectsIcon from '~icons/icon-park-outline/effects'
import PauseIcon from '~icons/icon-park-outline/pause'
import PlayIcon from '~icons/icon-park-outline/play-one'
import SwitchIcon from '~icons/icon-park-outline/switch'
import {
  ANIMATION_CLASS_PREFIX,
  ANIMATION_DEFAULT_DURATION,
  ANIMATION_DEFAULT_TRIGGER,
  ATTENTION_ANIMATIONS,
  ENTER_ANIMATIONS,
  EXIT_ANIMATIONS,
} from '@mona/presentation-core/animation-config'
import { createPresentationId, selectFormattedCurrentSlideAnimations } from '@mona/presentation-core'
import type { AnimationTrigger, AnimationType, PPTAnimation, PPTElement } from '@mona/presentation-core/model'
import { editorActions, selectPresentation } from '@mona/editor-state'
import { Popover as PopoverPrimitive } from 'radix-ui'

import {
  InspectorButton,
  InspectorNumberInput,
  InspectorSelect,
} from '@/features/editor/EditorInspectorPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

const catalogs = {
  attention: ATTENTION_ANIMATIONS,
  in: ENTER_ANIMATIONS,
  out: EXIT_ANIMATIONS,
} as const

const humanize = (value: string) => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/^./, first => first.toUpperCase())

const animationTarget = (elementId: string) => {
  const root = document.querySelector<HTMLElement>(`.mona-editor-slide-canvas [data-element-id="${CSS.escape(elementId)}"]`)
  if (!root) return null
  return root.querySelector<HTMLElement>('[class$="-content"]') || root.querySelector<HTMLElement>('.mona-rotate-wrapper') || root
}

export function ElementAnimationPanel({
  element,
  runtime,
}: {
  element: PPTElement | undefined
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const slide = presentation.slides[presentation.slideIndex]!
  const animations = slide.animations || []
  const [activeTab, setActiveTab] = useState<AnimationType>('in')
  const [open, setOpen] = useState(false)
  const [poolMask, setPoolMask] = useState(false)
  const [replacementId, setReplacementId] = useState('')
  const [hoverEffect, setHoverEffect] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const suppressSequenceClickRef = useRef(false)
  const poolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewingRef = useRef(false)
  const reorderCleanupRef = useRef<(() => void) | null>(null)
  const historyKey = 'element-animation-panel'
  const formatted = selectFormattedCurrentSlideAnimations(presentation)
  const sequence = formatted.flatMap((group, groupIndex) => group.animations.flatMap((animation, animationIndex) => {
    const target = slide.elements.find(candidate => candidate.id === animation.elId)
    return target ? [{
      ...animation,
      animationEffect: humanize(animation.effect),
      elType: t(`foundation.editor.animation.elementType.${target.type}`),
      index: animationIndex === 0 ? groupIndex + 1 : '',
    }] : []
  }))
  const handleAnimations = element ? animations.filter(animation => animation.elId === element.id) : []

  useEffect(() => () => {
    if (poolTimerRef.current) clearTimeout(poolTimerRef.current)
    reorderCleanupRef.current?.()
    reorderCleanupRef.current = null
    previewingRef.current = false
  }, [])

  const changeOpen = (visible: boolean) => {
    setOpen(visible)
    if (poolTimerRef.current) clearTimeout(poolTimerRef.current)
    poolTimerRef.current = null
    if (visible) {
      setPoolMask(true)
      poolTimerRef.current = setTimeout(() => {
        poolTimerRef.current = null
        setPoolMask(false)
      }, 800)
    }
    else setPoolMask(false)
  }

  const updateAnimations = (next: PPTAnimation[], label: string) => runtime.commit(label, [{
    type: 'slide.update',
    props: { animations: next },
  }], { historyKey })

  const runAnimation = (elementId: string, effect: string, duration: number) => {
    const target = animationTarget(elementId)
    if (!target) return
    const animationName = `${ANIMATION_CLASS_PREFIX}${effect}`
    document.documentElement.style.setProperty('--animate-duration', `${duration}ms`)
    target.classList.add(`${ANIMATION_CLASS_PREFIX}animated`, animationName)
    target.addEventListener('animationend', () => {
      document.documentElement.style.removeProperty('--animate-duration')
      target.classList.remove(`${ANIMATION_CLASS_PREFIX}animated`, animationName)
    }, { once: true })
  }

  const chooseEffect = (type: AnimationType, effect: string) => {
    if (!element) return
    let duration = ANIMATION_DEFAULT_DURATION
    let next: PPTAnimation[]
    if (replacementId) {
      next = animations.map(animation => {
        if (animation.id !== replacementId) return animation
        duration = animation.duration
        return { ...animation, effect, type }
      })
    }
    else {
      next = [...structuredClone(animations), {
        duration: ANIMATION_DEFAULT_DURATION,
        effect,
        elId: element.id,
        id: createPresentationId(10),
        trigger: ANIMATION_DEFAULT_TRIGGER,
        type,
      }]
    }
    updateAnimations(next, replacementId ? 'Replace element animation' : 'Add element animation')
    changeOpen(false)
    window.setTimeout(() => runAnimation(element.id, effect, duration), 0)
  }

  const deleteAnimation = (id: string) => updateAnimations(animations.filter(animation => animation.id !== id), 'Delete element animation')
  const updateAnimation = (id: string, props: Partial<PPTAnimation>, label: string) => updateAnimations(
    animations.map(animation => animation.id === id ? { ...animation, ...props } : animation),
    label,
  )
  const selectElement = (id: string) => {
    const session = runtime.store.getState().session
    if (session.handleElementId === id || session.hiddenElementIds.includes(id)) return
    const target = slide.elements.find(candidate => candidate.id === id)
    if (!target || target.lock) return
    runtime.store.dispatch(editorActions.selectionChanged([id]))
  }

  const runAll = async () => {
    if (previewingRef.current) {
      previewingRef.current = false
      setPreviewing(false)
      return
    }
    previewingRef.current = true
    setPreviewing(true)
    for (let index = 0; index < sequence.length; index++) {
      if (!previewingRef.current) break
      const item = sequence[index]!
      if (item.index !== 1 && item.trigger !== 'meantime') {
        await new Promise(resolve => window.setTimeout(resolve, item.duration + 100))
      }
      if (!previewingRef.current) break
      runAnimation(item.elId, item.effect, item.duration)
    }
    previewingRef.current = false
    setPreviewing(false)
  }

  const reorder = (oldIndex: number, newIndex: number) => {
    if (oldIndex === newIndex) return
    const next = structuredClone(animations)
    const moved = next.splice(oldIndex, 1)[0]
    if (!moved) return
    next.splice(newIndex, 0, moved)
    updateAnimations(next, 'Reorder element animations')
  }

  const startReorder = (event: ReactPointerEvent<HTMLElement>, oldIndex: number) => {
    if (event.button !== 0) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button, input, .mona-panel-select')) return
    const startY = event.clientY
    let newIndex = oldIndex
    let moved = false
    reorderCleanupRef.current?.()
    const move = (pointer: PointerEvent) => {
      if (!moved && Math.abs(pointer.clientY - startY) < 4) return
      moved = true
      setDraggingIndex(oldIndex)
      const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>('.mona-animation-sequence-item') || [])]
      const firstAfterPointer = rows.findIndex(row => pointer.clientY <= row.getBoundingClientRect().top + (row.getBoundingClientRect().height / 2))
      newIndex = firstAfterPointer === -1 ? Math.max(rows.length - 1, 0) : firstAfterPointer
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      reorderCleanupRef.current = null
    }
    const stop = () => {
      cleanup()
      setDraggingIndex(null)
      if (!moved) return
      suppressSequenceClickRef.current = true
      reorder(oldIndex, newIndex)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
    reorderCleanupRef.current = cleanup
  }

  const pool = (
    <div className="mona-animation-pool-popover">
      <div className="mona-animation-pool-tabs" role="tablist">
        {([
          ['in', t('foundation.editor.animation.entrance')],
          ['out', t('foundation.editor.animation.exit')],
          ['attention', t('foundation.editor.animation.emphasis')],
        ] as const).map(([key, label]) => (
          <button aria-selected={activeTab === key} className={activeTab === key ? 'is-active' : ''} key={key} onClick={() => setActiveTab(key)} role="tab" style={{ '--animation-color': key === 'in' ? '#68a490' : key === 'out' ? '#d86344' : '#e8b76a' } as React.CSSProperties} type="button">{label}</button>
        ))}
      </div>
      <div className={`mona-animation-pool is-${activeTab}`}>
        {catalogs[activeTab].map(group => (
          <div className="mona-animation-pool-group" key={group.type}>
            <div className="mona-animation-pool-title">{t(`foundation.editor.animation.group.${group.type}`, { defaultValue: humanize(group.type) })}:</div>
            <div className="mona-animation-pool-items">
              {group.children.map(item => (
                <button
                  className="mona-animation-pool-item"
                  key={item.value}
                  onClick={() => chooseEffect(activeTab, item.value)}
                  onMouseEnter={() => setHoverEffect(item.value)}
                  onMouseLeave={() => setHoverEffect('')}
                  type="button"
                ><span className={`${ANIMATION_CLASS_PREFIX}animated ${ANIMATION_CLASS_PREFIX}fast${hoverEffect === item.value ? ` ${ANIMATION_CLASS_PREFIX}${item.value}` : ''}`}>{t(`foundation.editor.animation.effect.${item.value}`, { defaultValue: humanize(item.value) })}</span></button>
              ))}
            </div>
          </div>
        ))}
        {poolMask ? <div className="mona-animation-pool-mask" /> : null}
      </div>
    </div>
  )

  return (
    <div className="mona-element-animation-panel" ref={panelRef}>
      <div className="mona-element-animation-add">
        {element ? (
          <div className="mona-animation-add-popover">
            <PopoverPrimitive.Root onOpenChange={changeOpen} open={open && !replacementId}>
              <PopoverPrimitive.Trigger aria-label={t('foundation.editor.animation.add')} className="mona-panel-button mona-animation-add-button" onClick={() => setReplacementId('')} type="button"><EffectsIcon />{` ${t('foundation.editor.animation.add')}`}</PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content align="center" className="mona-animation-popover" collisionPadding={5} side="bottom" sideOffset={8}>{pool}</PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          </div>
        ) : <div className="mona-animation-tip"><ClickIcon /> {t('foundation.editor.animation.selectTip')}</div>}
      </div>

      <div className="mona-panel-divider" />

      <div className="mona-animation-sequence">
        {sequence.map((item, index) => (
          <div
            className={`mona-animation-sequence-item is-${item.type}${element?.id === item.elId ? ' is-active' : ''}${draggingIndex === index ? ' is-dragging' : ''}`}
            key={item.id}
            onClick={() => {
              if (suppressSequenceClickRef.current) {
                suppressSequenceClickRef.current = false
                return
              }
              selectElement(item.elId)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') selectElement(item.elId)
            }}
            role="button"
            tabIndex={0}
          >
            <div className="mona-animation-sequence-content" onPointerDown={event => startReorder(event, index)}>
              <div className="mona-animation-index">{item.index}</div>
              <div className="mona-animation-text">「{item.elType}」{item.animationEffect}</div>
              <div className="mona-animation-handlers">
                <button aria-label={t('foundation.editor.animation.preview')} onClick={event => {
                  event.stopPropagation(); runAnimation(item.elId, item.effect, item.duration) 
                }} onPointerDown={event => event.stopPropagation()} type="button"><PlayIcon /></button>
                <button
                  aria-label={t('foundation.editor.animation.delete')}
                  onClick={event => {
                    event.stopPropagation()
                    // Keyboard/programmatic activation has no pointer-up.
                    if (event.detail === 0) deleteAnimation(item.id)
                  }}
                  onPointerDown={event => event.stopPropagation()}
                  onPointerUp={event => {
                    event.stopPropagation()
                    deleteAnimation(item.id)
                  }}
                  type="button"
                ><CloseIcon /></button>
              </div>
            </div>
            {handleAnimations[0]?.elId === item.elId ? (
              <div className="mona-animation-configs">
                <div className="mona-panel-divider" />
                <div className="mona-animation-config-row">
                  <div style={{ width: '35%' }}>{t('foundation.editor.animation.duration')}</div>
                  <InspectorNumberInput ariaLabel={`${t('foundation.editor.animation.duration')} ${item.animationEffect}`} max={3000} min={500} onChange={value => {
                    if (value >= 100 && value <= 5000) updateAnimation(item.id, { duration: value }, 'Update animation duration')
                  }} step={500} style={{ width: '65%' }} value={item.duration} />
                </div>
                <div className="mona-animation-config-row">
                  <div style={{ width: '35%' }}>{t('foundation.editor.animation.trigger')}</div>
                  <InspectorSelect<AnimationTrigger>
                    ariaLabel={`${t('foundation.editor.animation.trigger')} ${item.animationEffect}`}
                    onChange={value => updateAnimation(item.id, { trigger: value }, 'Update animation trigger')}
                    options={[
                      { label: t('foundation.editor.animation.onClick'), value: 'click' },
                      { label: t('foundation.editor.animation.withPrevious'), value: 'meantime' },
                      { label: t('foundation.editor.animation.afterPrevious'), value: 'auto' },
                    ]}
                    style={{ width: '65%' }}
                    value={item.trigger}
                  />
                </div>
                <div className="mona-animation-config-row">
                  <PopoverPrimitive.Root onOpenChange={changeOpen} open={open && replacementId === item.id}>
                    <PopoverPrimitive.Trigger aria-label={`${t('foundation.editor.animation.replace')} ${item.animationEffect}`} className="mona-panel-button" onClick={() => {
                      setReplacementId(item.id); changeOpen(true) 
                    }} style={{ width: '100%' }} type="button"><SwitchIcon /> {t('foundation.editor.animation.replace')}</PopoverPrimitive.Trigger>
                    <PopoverPrimitive.Portal><PopoverPrimitive.Content align="center" className="mona-animation-popover" collisionPadding={5} side="bottom" sideOffset={8}>{pool}</PopoverPrimitive.Content></PopoverPrimitive.Portal>
                  </PopoverPrimitive.Root>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {sequence.length >= 2 ? (
        <>
          <div className="mona-panel-divider" />
          <InspectorButton ariaLabel={previewing ? t('foundation.editor.animation.stopAll') : t('foundation.editor.animation.previewAll')} onClick={runAll}>{previewing ? <PauseIcon /> : <PlayIcon />} {previewing ? t('foundation.editor.animation.stopAll') : t('foundation.editor.animation.previewAll')}</InspectorButton>
        </>
      ) : null}
    </div>
  )
}
