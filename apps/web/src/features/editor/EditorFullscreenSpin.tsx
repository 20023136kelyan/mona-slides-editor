import { createPortal } from 'react-dom'

export function EditorFullscreenSpin({ loading, tip }: { loading: boolean; tip: string }) {
  if (!loading) return null
  return createPortal((
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(241_241_241/0.7)] text-foreground">
      <div className="flex flex-col items-center justify-center">
        <div className="size-9 animate-spin rounded-full border-[3px] border-foreground border-t-transparent" />
        <div className="mt-5">{tip}</div>
      </div>
    </div>
  ), document.body)
}
