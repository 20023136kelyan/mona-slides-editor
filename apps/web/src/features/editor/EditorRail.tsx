/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the shadcn Sidebar primitives render divs; landmark roles are applied explicitly on them. */
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'
import { EDITOR_PANEL_REGISTRY } from '@/features/editor/panel/editor-panel-registry'
import { EditorPanelSearchProvider } from '@/features/editor/panel/editor-panel-search'
import { PanelSearchBar } from '@/features/editor/panel/EditorPanelPrimitives'
import type { EditorTaskPanelRoute } from '@/features/editor/shell/editor-shell'
import { useEdgeFade } from '@/features/editor/use-edge-fade'

export type EditorRailPanel = EditorTaskPanelRoute

const contextualDrawerHeaderClassName = 'mona-contextual-drawer-header flex min-h-10 shrink-0 items-center gap-1.5 border-b border-border pr-2 [&_.mona-inspector-tabs-header]:min-w-0 [&_.mona-inspector-tabs-header]:flex-1 [&_.mona-inspector-tabs-header]:border-b-0'

function DrawerCollapseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      aria-label={t('foundation.editor.rail.collapse')}
      className="mona-drawer-close absolute top-1/2 right-0 z-30 h-12! w-5! min-w-0 -translate-y-1/2 translate-x-1/2 rounded-pill border border-border/70 bg-background p-0 text-foreground shadow-[0_1px_3px_rgba(15,23,42,0.12)] hover:bg-background hover:text-foreground [&_svg]:size-3.5!"
      onClick={onClose}
      size="icon-xs"
      type="button"
      variant="outline"
    >
      <ChevronLeft className="size-3.5" strokeWidth={2.5} />
    </Button>
  )
}

export function EditorRailDrawer({
  activePanel,
  children,
  contextualHeader,
  contextualOpen,
  onClose,
  panelTitle,
  secondaryContent,
}: {
  activePanel: EditorRailPanel | null
  children: ReactNode
  contextualHeader: ReactNode
  contextualOpen: boolean
  onClose: () => void
  panelTitle: string
  secondaryContent: ReactNode
}) {
  const { t } = useTranslation()
  const poolScrollRef = useRef<HTMLDivElement>(null)
  // Fade the top/bottom edge wherever pool content is cut off.
  useEdgeFade(poolScrollRef, 'y', activePanel)
  const definition = activePanel ? EDITOR_PANEL_REGISTRY[activePanel] : undefined
  // One string for both the placeholder and the field's accessible name: a
  // generic "Search" would tell a screen-reader user nothing about which
  // category they are searching.
  const searchPlaceholder = definition?.searchPlaceholderKey
    ? t(definition.searchPlaceholderKey)
    : t('foundation.editor.panel.searchPlaceholder', { category: panelTitle.toLocaleLowerCase() })

  if (!activePanel && !contextualOpen) return null

  return (
    <Sidebar
      aria-label={activePanel && panelTitle ? panelTitle : t('foundation.editor.inspector')}
      className="mona-editor-drawer relative w-[22rem] shrink-0 overflow-visible border-r border-sidebar-border"
      collapsible="none"
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      role="complementary"
      side="left"
    >
      <DrawerCollapseButton onClose={onClose} />
      {activePanel ? (
        <>
          {/* Uniform for every route. This used to switch layout by sniffing
              panel class names (`has-[.mona-uploads-panel,…]`), which meant a
              new category rendered wrong until it was added to three separate
              selector lists. Panels own their own padding and scrolling through
              PanelHeader / PanelBody, so the container needs no per-panel
              knowledge at all. */}
          <SidebarContent
            className="mona-drawer-content flex min-h-0 flex-1 flex-col overflow-hidden p-0"
            ref={poolScrollRef}
          >
            {definition ? (
              // The drawer owns the query, not the panel: the bar must survive
              // the panel it sits above, and switching category must not carry
              // the previous term into a panel that would search something else
              // entirely with it.
              <EditorPanelSearchProvider mode={definition.searchMode} route={activePanel}>
                {/* Above the panel, never inside it: every category gets this
                    bar in the same place without having to remember to. */}
                <PanelSearchBar
                  label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                />
                <definition.Component />
              </EditorPanelSearchProvider>
            ) : null}
            {secondaryContent}
          </SidebarContent>
        </>
      ) : (
        <>
          <div className={contextualDrawerHeaderClassName}>
            {contextualHeader}
          </div>
          {children}
        </>
      )}
    </Sidebar>
  )
}
