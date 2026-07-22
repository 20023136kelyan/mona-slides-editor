/* oxlint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- Comment cards and their hover-only nested actions mirror PPTist's pointer interaction contract. */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import DeleteIcon from '~icons/icon-park-outline/delete'
import PlusIcon from '~icons/icon-park-outline/plus'
import UserIcon from '~icons/icon-park-outline/user'
import { editorActions, selectCurrentSlide, selectPresentation, selectSession } from '@mona/editor-state'
import { createPresentationId, type Note } from '@mona/presentation-core'

import { EditorMoveablePanel } from '@/features/editor/EditorMoveablePanel'
import type { EditorRuntime } from '@/features/editor/editor-runtime'
import { useEditorSelector } from '@/features/editor/use-editor-selector'

export function EditorNotesPanel({ onClose, runtime }: { onClose: () => void; runtime: EditorRuntime }) {
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
    runtime.commit('Update slide comments', [{ type: 'slide.update', slideId: currentSlide.id, props: { notes: next } }], { recordHistory: false })
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
      user: t('foundation.editor.notes.testUser'),
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
        user: t('foundation.editor.notes.testUser'),
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
    <EditorMoveablePanel
      className="mona-notes-panel"
      height={560}
      left={-270}
      maxHeight={780}
      maxWidth={480}
      minHeight={400}
      minWidth={300}
      onClose={onClose}
      resizeable
      title={t('foundation.editor.notes.title', { number: presentation.slideIndex + 1 })}
      top={90}
      width={300}
    >
      <div className="mona-notes-container">
        <div className="mona-notes-list" ref={notesRef}>
          {notes.map(note => (
            <div className={`mona-note${activeNoteId === note.id ? ' is-active' : ''}`} data-note-id={note.id} key={note.id} onClick={() => selectNote(note)}>
              <div className="mona-note-header">
                <div className="mona-note-user">
                  <div className="mona-note-avatar"><UserIcon /></div>
                  <div><div className="mona-note-username">{note.user}</div><div className="mona-note-time">{new Date(note.time).toLocaleString()}</div></div>
                </div>
                <div className="mona-note-actions">
                  <div onClick={() => setReplyNoteId(note.id)}>{t('foundation.editor.notes.reply')}</div>
                  <div onClick={event => {
                    event.stopPropagation(); setNotes(notes.filter(item => item.id !== note.id)) 
                  }}>{t('foundation.editor.action.delete')}</div>
                </div>
              </div>
              <div className="mona-note-content">{note.content}</div>
              {note.replies?.length ? (
                <div className="mona-note-replies">
                  {note.replies.map(reply => (
                    <div className="mona-note-reply-item" key={reply.id}>
                      <div className="mona-note-header">
                        <div className="mona-note-user">
                          <div className="mona-note-avatar"><UserIcon /></div>
                          <div><div className="mona-note-username">{reply.user}</div><div className="mona-note-time">{new Date(reply.time).toLocaleString()}</div></div>
                        </div>
                        <div className="mona-note-actions"><div onClick={event => {
                          event.stopPropagation()
                          setNotes(notes.map(item => item.id === note.id ? { ...item, replies: item.replies?.filter(candidate => candidate.id !== reply.id) } : item))
                        }}>{t('foundation.editor.action.delete')}</div></div>
                      </div>
                      <div className="mona-note-content">{reply.content}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {replyNoteId === note.id ? (
                <div className="mona-note-reply-editor">
                  <textarea onChange={event => setReplyContent(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault(); createReply() 
                    } 
                  }} placeholder={t('foundation.editor.notes.replyPlaceholder')} rows={1} value={replyContent} />
                  <div className="mona-note-reply-buttons">
                    <button onClick={() => setReplyNoteId('')} type="button">{t('foundation.editor.action.cancel')}</button>
                    <button className="is-primary" onClick={createReply} type="button">{t('foundation.editor.notes.reply')}</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {!notes.length ? <div className="mona-notes-empty">{t('foundation.editor.notes.empty')}</div> : null}
        </div>
        <div className="mona-notes-send">
          <textarea
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
          <div className="mona-notes-footer">
            <button aria-label={t('foundation.editor.notes.clearSlide')} className="mona-notes-clear" onClick={() => setNotes([])} type="button"><DeleteIcon /></button>
            <button className="mona-notes-add" onClick={createNote} type="button"><PlusIcon /> {t('foundation.editor.notes.add')}</button>
          </div>
        </div>
      </div>
    </EditorMoveablePanel>
  )
}
