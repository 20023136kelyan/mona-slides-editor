import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import EditIcon from '~icons/icon-park-outline/edit'
import PlayIcon from '~icons/icon-park-outline/full-screen-play'
import { selectPresentation } from '@mona/editor-state'

import { Button } from '@/components/ui/button'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import type { MobileMode } from '@/features/mobile/MobileView'
import { useMobileSlidesLoad } from '@/features/mobile/use-mobile-slides-load'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { useEditorApplication } from '@/features/editor/services/editor-application'
import { ScaledSlide } from '@/features/presentation-renderer/ScaledSlide'

export function MobilePreview({ changeMode, runtime }: {
  changeMode: (mode: MobileMode) => void
  runtime: EditorRuntime
}) {
  const { t } = useTranslation()
  const { openAgent } = useEditorApplication()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const slidesLoadLimit = useMobileSlidesLoad(presentation.slides.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const [screenWidth, setScreenWidth] = useState(0)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root) setScreenWidth(root.clientWidth)
  }, [])

  return (
    <div className="mona-mobile-preview" ref={rootRef}>
      <div className="mona-mobile-preview-list">
        {presentation.slides.map((slide, index) => (
          <div className="mona-mobile-preview-item" key={slide.id}>
            {screenWidth ? (
              <ScaledSlide
                fixedWidth={screenWidth - 20}
                slide={slide}
                sourcePackages={presentation.sourcePackages}
                theme={presentation.theme}
                thumbnail
                viewportRatio={presentation.viewportRatio}
                viewportSize={presentation.viewportSize}
                visible={index < slidesLoadLimit}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="mona-mobile-preview-menu">
        <Button className="mona-mobile-preview-menu-item" onClick={() => changeMode('editor')} size="editor" type="button" variant="ghost"><EditIcon className="mona-mobile-icon" /> {t('mobile.edit')}</Button>
        <i className="mona-mobile-divider is-vertical" />
        <Button className="mona-mobile-preview-menu-item" onClick={() => changeMode('player')} size="editor" type="button" variant="ghost"><PlayIcon className="mona-mobile-icon" /> {t('mobile.play')}</Button>
        <i className="mona-mobile-divider is-vertical" />
        <Button
          className="mona-mobile-preview-menu-item is-ai"
          onClick={openAgent}
          size="editor"
          type="button"
          variant="ghost"
        >Mona AI</Button>
      </div>
    </div>
  )
}
