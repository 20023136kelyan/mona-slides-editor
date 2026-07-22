import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import BackIcon from '~icons/icon-park-outline/back'
import CopyIcon from '~icons/icon-park-outline/copy'
import DeleteIcon from '~icons/icon-park-outline/delete'
import FontSizeIcon from '~icons/icon-park-outline/font-size'
import LogoutIcon from '~icons/icon-park-outline/logout'
import NextIcon from '~icons/icon-park-outline/next'
import PictureIcon from '~icons/icon-park-outline/picture'
import PlusIcon from '~icons/icon-park-outline/plus'
import RoundIcon from '~icons/icon-park-outline/round'
import SquareIcon from '~icons/icon-park-outline/square'
import { editorActions, selectPresentation, selectSession } from '@mona/editor-state'
import { createPresentationId } from '@mona/presentation-core'
import type { PPTImageElement, PPTShapeElement, PPTTextElement } from '@mona/presentation-core/model'

import { EditorCanvas } from '@/features/editor/EditorCanvas'
import { fileToDataUrl, fitImageToPresentation, getImageSize } from '@/features/editor/editor-image'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { MobileElementToolbar } from '@/features/mobile/MobileElementToolbar'
import { MobileButton, MobileButtonGroup } from '@/features/mobile/MobilePrimitives'
import { MobileThumbnails } from '@/features/mobile/MobileThumbnails'
import type { MobileMode } from '@/features/mobile/MobileView'

function MobileEditorHeader({ changeMode, runtime }: {
  changeMode: (mode: MobileMode) => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const [historyState, setHistoryState] = useState(() => runtime.getHistoryState())

  useEffect(() => runtime.subscribeHistory(() => setHistoryState(runtime.getHistoryState())), [runtime])

  const canUndo = historyState.cursor > 0
  const canRedo = historyState.cursor < historyState.length - 1
  return (
    <div className="mona-mobile-editor-header">
      <div className="mona-mobile-editor-history">
        <button className={`mona-mobile-editor-history-item${canUndo ? '' : ' is-disabled'}`} onClick={() => runtime.undo()} type="button"><BackIcon /> {t('common.undo')}</button>
        <button className={`mona-mobile-editor-history-item${canRedo ? '' : ' is-disabled'}`} onClick={() => runtime.redo()} type="button"><NextIcon /> {t('common.redo')}</button>
      </div>
      <button className="mona-mobile-editor-back" onClick={() => changeMode('preview')} type="button"><LogoutIcon /> {t('mobile.exitEdit')}</button>
    </div>
  )
}

function MobileSlideToolbar({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const currentSlide = presentation.slides[presentation.slideIndex]

  const selectCreated = (id: string) => runtime.store.dispatch(editorActions.selectionChanged([id]))
  const insertText = () => {
    const width = 400
    const height = 56
    const element: PPTTextElement = {
      type: 'text',
      id: createPresentationId(10),
      left: (presentation.viewportSize - width) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - height) / 2,
      width,
      height,
      content: `<p>${t('mobile.newText')}</p>`,
      rotate: 0,
      defaultFontName: presentation.theme.fontName,
      defaultColor: presentation.theme.fontColor,
      vertical: false,
    }
    if (runtime.commit('Create text', [{ type: 'element.add', elements: element }])) selectCreated(element.id)
  }
  const insertShape = (type: 'round' | 'square') => {
    const size = 200
    const element: PPTShapeElement = {
      type: 'shape',
      id: createPresentationId(10),
      left: (presentation.viewportSize - size) / 2,
      top: (presentation.viewportSize * presentation.viewportRatio - size) / 2,
      width: size,
      height: size,
      viewBox: [200, 200],
      path: type === 'round'
        ? 'M 100 0 A 50 50 0 1 1 100 200 A 50 50 0 1 1 100 0 Z'
        : 'M 0 0 L 200 0 L 200 200 L 0 200 Z',
      fill: presentation.theme.themeColors[0]!,
      fixedRatio: false,
      rotate: 0,
    }
    if (runtime.commit('Create shape', [{ type: 'element.add', elements: element }])) selectCreated(element.id)
  }
  const insertImage = async (file?: File) => {
    if (!file) return
    const src = await fileToDataUrl(file)
    const position = fitImageToPresentation(presentation, await getImageSize(src))
    const element: PPTImageElement = {
      type: 'image',
      id: createPresentationId(10),
      src,
      ...position,
      fixedRatio: true,
      rotate: 0,
    }
    if (runtime.commit('Create image', [{ type: 'element.add', elements: element }])) selectCreated(element.id)
  }

  return (
    <div className="mona-mobile-slide-toolbar">
      <div className="mona-mobile-remark">
        <textarea
          aria-label={t('runtime.speakerNotesPlaceholder')}
          onChange={event => runtime.commit('Update speaker notes', [{ type: 'slide.update', props: { remark: event.target.value } }], { recordHistory: false })}
          placeholder={t('runtime.speakerNotesPlaceholder')}
          value={currentSlide?.remark || ''}
        />
      </div>
      <div className="mona-mobile-slide-actions">
        <MobileButtonGroup className="mona-mobile-row is-compact">
          <MobileButton onClick={() => runtime.createSlide()}><PlusIcon className="mona-mobile-button-icon" /> {t('mobile.newSlide')}</MobileButton>
          <MobileButton onClick={() => runtime.duplicateSlides()}><CopyIcon className="mona-mobile-button-icon" /> {t('common.copy')}</MobileButton>
          <MobileButton onClick={() => runtime.deleteSlides()}><DeleteIcon className="mona-mobile-button-icon" /> {t('common.delete')}</MobileButton>
        </MobileButtonGroup>
        <MobileButtonGroup className="mona-mobile-row is-compact">
          <MobileButton onClick={insertText}><FontSizeIcon className="mona-mobile-button-icon" /> {t('mobile.text')}</MobileButton>
          <MobileButton className="mona-mobile-file-button">
            <label><input accept="image/*" onChange={event => void insertImage(event.target.files?.[0])} type="file" /><PictureIcon className="mona-mobile-button-icon" /> {t('editor.image')}</label>
          </MobileButton>
          <MobileButton onClick={() => insertShape('square')}><SquareIcon className="mona-mobile-button-icon" /> {t('mobile.rectangle')}</MobileButton>
          <MobileButton onClick={() => insertShape('round')}><RoundIcon className="mona-mobile-button-icon" /> {t('mobile.circle')}</MobileButton>
        </MobileButtonGroup>
      </div>
      <MobileThumbnails runtime={runtime} />
    </div>
  )
}

export function MobileEditor({ changeMode, runtime }: {
  changeMode: (mode: MobileMode) => void
  runtime: EditorRuntime
}) {
  const session = useEditorSelector(runtime.store, selectSession)

  useEffect(() => {
    runtime.store.dispatch(editorActions.selectionChanged([]))
    runtime.store.dispatch(editorActions.canvasZoomChanged(100))
    if (runtime.store.getState().presentation.slideIndex !== 0) runtime.focusSlide(0)
  }, [runtime])

  return (
    <div className="mona-mobile-editor">
      <MobileEditorHeader changeMode={changeMode} runtime={runtime} />
      <div className="mona-mobile-editor-content">
        <EditorCanvas
          activeCreateTool={null}
          customShapeActive={false}
          interactionProfile="mobile"
          onCreateToolChange={() => {}}
          onCustomShapeChange={() => {}}
          onEditChart={() => {}}
          onEditLatex={() => {}}
          runtime={runtime}
        />
      </div>
      <MobileSlideToolbar runtime={runtime} />
      {session.handleElementId ? <MobileElementToolbar runtime={runtime} /> : null}
    </div>
  )
}
