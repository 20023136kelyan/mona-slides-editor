export interface PointerPosition {
  readonly x: number
  readonly y: number
}

export interface PointerModifiers {
  readonly alt: boolean
  readonly control: boolean
  readonly meta: boolean
  readonly shift: boolean
}

export const EMPTY_POINTER_MODIFIERS: PointerModifiers = Object.freeze({
  alt: false,
  control: false,
  meta: false,
  shift: false,
})

export type InteractionGestureKind = 'drag' | 'resize' | 'rotate' | 'crop' | 'lasso' | 'pan' | 'create'

export interface InteractionSnapshot {
  readonly status: 'idle' | 'active'
  readonly gestureId: string | null
  readonly kind: InteractionGestureKind | null
  readonly origin: PointerPosition
  readonly pointer: PointerPosition
  readonly delta: PointerPosition
  readonly modifiers: PointerModifiers
  readonly revision: number
}

export interface CompletedInteraction {
  readonly gestureId: string
  readonly kind: InteractionGestureKind
  readonly origin: PointerPosition
  readonly pointer: PointerPosition
  readonly delta: PointerPosition
  readonly modifiers: PointerModifiers
}

export interface BeginInteractionInput {
  readonly gestureId: string
  readonly kind: InteractionGestureKind
  readonly pointer: PointerPosition
  readonly modifiers?: Partial<PointerModifiers>
}

export interface InteractionController {
  getSnapshot: () => InteractionSnapshot
  subscribe: (listener: () => void) => () => void
  begin: (input: BeginInteractionInput) => void
  updatePointer: (pointer: PointerPosition, modifiers?: Partial<PointerModifiers>) => void
  complete: () => CompletedInteraction | undefined
  cancel: () => void
}

const IDLE_POSITION: PointerPosition = Object.freeze({ x: 0, y: 0 })

const idleSnapshot = (revision: number): InteractionSnapshot => ({
  status: 'idle',
  gestureId: null,
  kind: null,
  origin: IDLE_POSITION,
  pointer: IDLE_POSITION,
  delta: IDLE_POSITION,
  modifiers: EMPTY_POINTER_MODIFIERS,
  revision,
})

const createModifiers = (input: Partial<PointerModifiers> = {}): PointerModifiers => ({
  alt: input.alt ?? false,
  control: input.control ?? false,
  meta: input.meta ?? false,
  shift: input.shift ?? false,
})

/**
 * Mutable, framework-neutral pointer-frequency state. React reads its cached
 * snapshots through useSyncExternalStore; the presentation store is untouched
 * until complete() returns one semantic interaction.
 */
export const createInteractionController = (): InteractionController => {
  let snapshot = idleSnapshot(0)
  const listeners = new Set<() => void>()

  const publish = (next: InteractionSnapshot) => {
    snapshot = next
    listeners.forEach(listener => listener())
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    begin: input => {
      publish({
        status: 'active',
        gestureId: input.gestureId,
        kind: input.kind,
        origin: input.pointer,
        pointer: input.pointer,
        delta: IDLE_POSITION,
        modifiers: createModifiers(input.modifiers),
        revision: snapshot.revision + 1,
      })
    },
    updatePointer: (pointer, modifiers) => {
      if (snapshot.status !== 'active') return
      const nextModifiers = modifiers ? createModifiers(modifiers) : snapshot.modifiers
      if (
        pointer.x === snapshot.pointer.x &&
        pointer.y === snapshot.pointer.y &&
        nextModifiers.alt === snapshot.modifiers.alt &&
        nextModifiers.control === snapshot.modifiers.control &&
        nextModifiers.meta === snapshot.modifiers.meta &&
        nextModifiers.shift === snapshot.modifiers.shift
      ) return
      publish({
        ...snapshot,
        pointer,
        delta: {
          x: pointer.x - snapshot.origin.x,
          y: pointer.y - snapshot.origin.y,
        },
        modifiers: nextModifiers,
        revision: snapshot.revision + 1,
      })
    },
    complete: () => {
      if (
        snapshot.status !== 'active' ||
        snapshot.gestureId === null ||
        snapshot.kind === null
      ) return undefined

      const completed: CompletedInteraction = {
        gestureId: snapshot.gestureId,
        kind: snapshot.kind,
        origin: snapshot.origin,
        pointer: snapshot.pointer,
        delta: snapshot.delta,
        modifiers: snapshot.modifiers,
      }
      publish(idleSnapshot(snapshot.revision + 1))
      return completed
    },
    cancel: () => {
      if (snapshot.status === 'idle') return
      publish(idleSnapshot(snapshot.revision + 1))
    },
  }
}
