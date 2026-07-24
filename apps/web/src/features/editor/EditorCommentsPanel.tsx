import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DeleteIcon from '~icons/icon-park-outline/delete'
import PlusIcon from '~icons/icon-park-outline/plus'
import UserIcon from '~icons/icon-park-outline/user'
import { editorActions, selectCurrentSlide, selectPresentation, selectSession } from '@mona/editor-state'
import { createPresentationId, type Note } from '@mona/presentation-core'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PanelEmptyState } from '@/features/editor/panel/EditorPanelPrimitives'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'
import { cn } from '@/lib/utils'

export function EditorCommentsPanel({ runtime }: { runtime: EditorRuntime }) {
  const { t } = useTranslation()
  const presentation = useEditorSelector(runtime.store, selectPresentation)
  const currentSlide = useEditorSelector(runtime.store, selectCurrentSlide)!
  const session = useEditorSelector(runtime.store, selectSession)
  const [content, setContent] = useState('')
  const [replyContent, setReplyContent] = useState('')
  const [activeNoteId, setActiveNoteId] = useState('')
  const [replyNoteId, setReplyNoteId] = useState('')
  const notesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const notes = currentSlide.notes ?? []

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setActiveNoteId('')
      setReplyNoteId('')
    })
    return () => {
      active = false
    }
  }, [presentation.slideIndex])

  const setNotes = (next: Note[]) => {
    runtime.commit('Update slide comments', [{
      type: 'slide.update',
      slideId: currentSlide.id,
      props: { notes: next },
    }], { historyKey: `slide-comments-${currentSlide.id}` })
  }
  const scrollToBottom = () => requestAnimationFrame(() => {
    if (notesRef.current) notesRef.current.scrollTop = notesRef.current.scrollHeight
  })
  const createNote = () => {
    if (!content) {
      inputRef.current?.focus()
      return
    }
    const note: Note = {
      id: createPresentationId(21),
      content,
      time: Date.now(),
      user: t('foundation.editor.notes.authorYou'),
      ...(session.handleElementId ? { elId: session.handleElementId } : {}),
    }
    setNotes([...notes, note])
    setContent('')
    scrollToBottom()
  }
  const createReply = () => {
    if (!replyContent) return
    const target = notes.find(note => note.id === replyNoteId)
    if (!target) return
    const next = notes.map(note => note.id === target.id ? {
      ...note,
      replies: [...note.replies ?? [], {
        id: createPresentationId(21),
        content: replyContent,
        time: Date.now(),
        user: t('foundation.editor.notes.authorYou'),
      }],
    } : note)
    setNotes(next)
    setReplyContent('')
    setReplyNoteId('')
    scrollToBottom()
  }
  const selectNote = (note: Note) => {
    setActiveNoteId(note.id)
    const targetExists = note.elId && currentSlide.elements.some(element => element.id === note.elId)
    runtime.store.dispatch(editorActions.selectionChanged(targetExists ? [note.elId!] : []))
  }

  return (
    <div className="h-full min-h-[420px] text-xs select-none">
      <div className="flex h-full flex-col">
        <div className="mx-[-10px] flex-1 space-y-2.5 overflow-auto px-3 py-0.5" ref={notesRef}>
          {notes.map(note => (
            <div
              className={cn('group/note rounded-[var(--radius-surface)] border p-2.5', activeNoteId === note.id && 'bg-muted')}
              data-note-id={note.id}
              key={note.id}
            >
              <div className="mb-2 flex items-start justify-between">
                <Button
                  aria-label={`${note.user}: ${note.content}`}
                  aria-pressed={activeNoteId === note.id}
                  className="h-auto justify-start p-0 font-normal hover:bg-transparent"
                  onClick={() => selectNote(note)}
                  type="button"
                  variant="ghost"
                >
                  <div className="mr-2.5 flex size-[30px] items-center justify-center rounded-full bg-[#42ba97] text-lg text-white"><UserIcon /></div>
                  <div><div className="text-sm">{note.user}</div><div className="text-xs text-muted-foreground">{new Date(note.time).toLocaleString()}</div></div>
                </Button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/note:opacity-100 group-focus-within/note:opacity-100">
                  <Button className="h-7 px-1.5 text-xs hover:text-foreground hover:underline" onClick={event => {
                    event.stopPropagation()
                    setReplyNoteId(note.id)
                  }} size="xs" type="button" variant="ghost">{t('foundation.editor.notes.reply')}</Button>
                  <Button className="h-7 px-1.5 text-xs hover:text-foreground hover:underline" onClick={event => {
                    event.stopPropagation()
                    setNotes(notes.filter(item => item.id !== note.id))
                  }} size="xs" type="button" variant="ghost">{t('foundation.editor.action.delete')}</Button>
                </div>
              </div>
              <Button
                aria-label={`${note.user}: ${note.content}`}
                aria-pressed={activeNoteId === note.id}
                className="block h-auto w-full justify-start p-0 text-left font-normal whitespace-normal hover:bg-transparent"
                onClick={() => selectNote(note)}
                type="button"
                variant="ghost"
              >{note.content}</Button>
              {note.replies?.length ? (
                <div className="mt-[15px] ml-5">
                  {note.replies.map(reply => (
                    <div className="mt-2.5" key={reply.id}>
                      <div className="group/reply flex items-start justify-between">
                        <div className="flex items-center">
                          <div className="mr-2.5 flex size-[30px] items-center justify-center rounded-full bg-[#42ba97] text-lg text-white"><UserIcon /></div>
                          <div><div className="text-sm">{reply.user}</div><div className="text-xs text-muted-foreground">{new Date(reply.time).toLocaleString()}</div></div>
                        </div>
                        <div className="flex items-center opacity-0 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100"><Button className="h-7 px-1.5 text-xs hover:text-foreground hover:underline" onClick={event => {
                          event.stopPropagation()
                          setNotes(notes.map(item => item.id === note.id ? { ...item, replies: item.replies?.filter(candidate => candidate.id !== reply.id) } : item))
                        }} size="xs" type="button" variant="ghost">{t('foundation.editor.action.delete')}</Button></div>
                      </div>
                      <div className="mt-1.5">{reply.content}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {replyNoteId === note.id ? (
                <div className="mt-[15px]">
                  <Textarea className="resize-none" onChange={event => setReplyContent(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault(); createReply()
                    }
                  }} placeholder={t('foundation.editor.notes.replyPlaceholder')} rows={1} value={replyContent} />
                  <div className="mt-1.5 flex justify-end gap-2">
                    <Button onClick={() => setReplyNoteId('')} size="sm" variant="outline">{t('foundation.editor.action.cancel')}</Button>
                    <Button onClick={createReply} size="sm">{t('foundation.editor.notes.reply')}</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {!notes.length ? <PanelEmptyState message={t('foundation.editor.notes.empty')} /> : null}
        </div>
        <div className="flex h-[120px] shrink-0 flex-col justify-end text-right">
          <Textarea
            className="resize-none"
            onChange={event => setContent(event.target.value)}
            onFocus={() => {
              setReplyNoteId(''); setActiveNoteId('')
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault(); createNote()
              }
            }}
            placeholder={t('foundation.editor.notes.commentPlaceholder', { target: t(session.handleElementId ? 'foundation.editor.notes.selectedElement' : 'foundation.editor.notes.currentSlide') })}
            ref={inputRef}
            rows={2}
            value={content}
          />
          <div className="mt-2.5 flex items-center">
            <Button aria-label={t('foundation.editor.notes.clearSlide')} className="flex-1 justify-start text-lg text-muted-foreground" onClick={() => setNotes([])} size="editor-icon" variant="ghost"><DeleteIcon /></Button>
            <Button className="ml-2 flex-[12]" onClick={createNote} size="sm"><PlusIcon /> {t('foundation.editor.notes.add')}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
