/**
 * Context-to-props adapters for panels that predate the drawer contract.
 *
 * They live apart from the registry so that file exports data only: a module
 * that mixes component and non-component exports opts out of Fast Refresh, and
 * editing the registry would then force a full reload.
 */
import { EditorChartsPanel } from '@/features/editor/EditorChartsPanel'
import { EditorPhotosPanel } from '@/features/editor/EditorPhotosPanel'
import { EditorUploadsPanel } from '@/features/editor/EditorUploadsPanel'
import { EditorVideosPanel } from '@/features/editor/EditorVideosPanel'
import { useEditorPanel } from '@/features/editor/panel/editor-panel-context'

export function UploadsRoute() {
  const { actions } = useEditorPanel()
  // Uploads is the user's own files; the tabs inside it filter those by kind.
  // Searching elsewhere lives in its own panels.
  return <EditorUploadsPanel onInsertAudio={actions.insertAudio} onInsertImageSource={actions.insertImageSource} onInsertVideo={actions.insertVideo} />
}

export function VideosRoute() {
  const { actions } = useEditorPanel()
  return <EditorVideosPanel onInsertVideo={actions.insertVideo} />
}

export function PhotosRoute() {
  const { actions } = useEditorPanel()
  return <EditorPhotosPanel onInsertImageSource={actions.insertImageSource} />
}

export function ChartsRoute() {
  const { actions } = useEditorPanel()
  return <EditorChartsPanel onInsertChart={actions.insertChart} />
}
