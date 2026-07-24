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

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InspectorButton, InspectorNumberInput, InspectorSelect, inspectorDividerClass } from '@/features/editor/EditorInspectorPrimitives'
import { cancelListReorder, startListReorder } from '@/features/editor/editor-list-reorder'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { cn } from '@/lib/utils'

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
  const historyKey = 'element-animation-panel'
  const formatted = selectFormattedCurrentSlideAnimations(presentation)
  const sequence = formatted.flatMap((group, groupIndex) => group.animations.flatMap((animation, animationIndex) => {
    const target = slide.elements.find(candidate => candidate.id === animation.elId)
    return target ? [{
      ...animation,
      animationEffect: t(`foundation.editor.animation.effect.${animation.effect}`, { defaultValue: humanize(animation.effect) }),
      elType: t(`foundation.editor.animation.elementType.${target.type}`),
      index: animationIndex === 0 ? groupIndex + 1 : '',
    }] : []
  }))
  const handleAnimations = element ? animations.filter(animation => animation.elId === element.id) : []

  useEffect(() => () => {
    if (poolTimerRef.current) clearTimeout(poolTimerRef.current)
    cancelListReorder()
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

  const startReorder = (event: ReactPointerEvent<HTMLElement>, oldIndex: number) => startListReorder(event, oldIndex, {
    getRows: () => panelRef.current?.querySelectorAll<HTMLElement>('.mona-animation-sequence-item') || [],
    onDragStart: setDraggingIndex,
    onDragEnd: moved => {
      setDraggingIndex(null)
      if (moved) suppressSequenceClickRef.current = true
    },
    onReorder: reorder,
  })

  const poolTitleTone = activeTab === 'in'
    ? 'border-l-anim-in bg-[rgba(104,164,144,0.15)]'
    : activeTab === 'out'
      ? 'border-l-anim-out bg-[rgba(216,99,68,0.15)]'
      : 'border-l-anim-attention bg-[rgba(232,183,106,0.15)]'
  const pool = (
    <div>
      <Tabs onValueChange={value => setActiveTab(value as AnimationType)} value={activeTab}>
        <TabsList className="mb-5 flex h-auto select-none rounded-none border-b border-[#d9d9d9] bg-transparent p-0 text-control leading-none">
          {([
            ['in', t('foundation.editor.animation.entrance'), '#68a490'],
            ['out', t('foundation.editor.animation.exit'), '#d86344'],
            ['attention', t('foundation.editor.animation.emphasis'), '#e8b76a'],
          ] as const).map(([key, label, color]) => (
            <TabsTrigger
              className="w-1/3 rounded-none border-0 border-b-2 border-transparent bg-transparent px-2.5 py-2 text-center text-[#333] shadow-none data-[state=active]:border-b-[var(--animation-color)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              key={key}
              style={{ '--animation-color': color } as React.CSSProperties}
              value={key}
            >{label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="relative mr-[-10px] h-125 w-100 overflow-hidden overflow-y-auto pr-1.25 text-xs">
        {catalogs[activeTab].map(group => (
          <div className="mb-1.25 last:mb-0" key={group.type}>
            <div className={`mb-2.5 w-full border-l-4 py-1 pr-0 pl-2.5 text-control ${poolTitleTone}`}>{t(`foundation.editor.animation.group.${group.type}`, { defaultValue: humanize(group.type) })}:</div>
            <div className="flex flex-wrap content-start">
              {group.children.map(item => (
                <Button
                  className="mb-1.25 h-10 w-[24%] border-0 bg-transparent p-0 text-center text-foreground leading-10 not-[:nth-child(4n)]:mr-[1.333333%] hover:bg-transparent [&_span]:block [&_span]:rounded-control [&_span]:bg-[#f9f9f9]"
                  key={item.value}
                  onClick={() => chooseEffect(activeTab, item.value)}
                  onMouseEnter={() => setHoverEffect(item.value)}
                  onMouseLeave={() => setHoverEffect('')}
                  size="editor"
                  type="button"
                  variant="ghost"
                ><span className={`${ANIMATION_CLASS_PREFIX}animated ${ANIMATION_CLASS_PREFIX}fast${hoverEffect === item.value ? ` ${ANIMATION_CLASS_PREFIX}${item.value}` : ''}`}>{t(`foundation.editor.animation.effect.${item.value}`, { defaultValue: humanize(item.value) })}</span></Button>
              ))}
            </div>
          </div>
        ))}
        {poolMask ? <div className="absolute inset-0" /> : null}
      </div>
    </div>
  )

  return (
    <div className="mona-element-animation-panel" ref={panelRef}>
      <div className="mona-element-animation-add">
        {element ? (
          <div className="mona-animation-add-popover">
            <Popover onOpenChange={changeOpen} open={open && !replacementId}>
              <PopoverTrigger asChild><Button aria-label={t('foundation.editor.animation.add')} className="mona-panel-button mona-animation-add-button" onClick={() => setReplacementId('')} size="editor" type="button" variant="editor"><EffectsIcon />{` ${t('foundation.editor.animation.add')}`}</Button></PopoverTrigger>
              <PopoverContent aria-label={t('foundation.editor.animation.add')} align="center" className="mona-animation-popover" collisionPadding={5} side="bottom" sideOffset={8}>{pool}</PopoverContent>
            </Popover>
          </div>
        ) : <div className="mona-animation-tip"><ClickIcon /> {t('foundation.editor.animation.selectTip')}</div>}
      </div>

      <div className={inspectorDividerClass} />

      <div className="mona-animation-sequence">
        {sequence.map((item, index) => (
          <div
            className={cn(
              // class kept: getRows() querySelectors it for keyboard reordering
              'mona-animation-sequence-item mb-2 rounded-surface border border-[#d9d9d9] p-2 transition-all duration-500',
              `is-${item.type}`,
              element?.id === item.elId && 'is-active',
              element?.id === item.elId && item.type === 'in' && 'border-anim-in',
              element?.id === item.elId && item.type === 'out' && 'border-anim-out',
              element?.id === item.elId && item.type === 'attention' && 'border-anim-attention',
              draggingIndex === index && 'is-dragging opacity-75',
            )}
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
                <Button aria-label={t('foundation.editor.animation.preview')} onClick={event => {
                  event.stopPropagation(); runAnimation(item.elId, item.effect, item.duration) 
                }} onPointerDown={event => event.stopPropagation()} size="icon-xs" type="button" variant="ghost"><PlayIcon /></Button>
                <Button
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
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                ><CloseIcon /></Button>
              </div>
            </div>
            {handleAnimations[0]?.elId === item.elId ? (
              <div className="mona-animation-configs">
                <div className={`${inspectorDividerClass} !my-4`} />
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
                  <Popover onOpenChange={changeOpen} open={open && replacementId === item.id}>
                    <PopoverTrigger asChild><Button aria-label={`${t('foundation.editor.animation.replace')} ${item.animationEffect}`} className="mona-panel-button" onClick={() => {
                      setReplacementId(item.id); changeOpen(true) 
                    }} size="editor" style={{ width: '100%' }} type="button" variant="editor"><SwitchIcon /> {t('foundation.editor.animation.replace')}</Button></PopoverTrigger>
                    <PopoverContent aria-label={`${t('foundation.editor.animation.replace')} ${item.animationEffect}`} align="center" className="mona-animation-popover" collisionPadding={5} side="bottom" sideOffset={8}>{pool}</PopoverContent>
                  </Popover>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {sequence.length >= 2 ? (
        <>
          <div className={inspectorDividerClass} />
          <InspectorButton ariaLabel={previewing ? t('foundation.editor.animation.stopAll') : t('foundation.editor.animation.previewAll')} onClick={runAll}>{previewing ? <PauseIcon /> : <PlayIcon />} {previewing ? t('foundation.editor.animation.stopAll') : t('foundation.editor.animation.previewAll')}</InspectorButton>
        </>
      ) : null}
    </div>
  )
}
