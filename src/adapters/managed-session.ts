import type { OrbSignal, OrbSignalListener } from './types'

type Session = { start(): Promise<void>; stop(): Promise<void> }

// Keep a pending permission/SDK promise from owning the next call's media or signals.
export function createManagedSessionAdapter(
  createSession: (lifetime: AbortSignal, publish: OrbSignalListener) => Session,
) {
  const listeners = new Set<OrbSignalListener>()
  let signal: OrbSignal = { state: 'idle', inputVolume: 0, outputVolume: 0 }
  let active:
    | { session: Session; lifetime: AbortController; ready: Promise<void>; cancelStart(): void }
    | undefined
  let lastStop = Promise.resolve()

  function publish(next: OrbSignal) {
    signal = next
    listeners.forEach((listener) => listener(next))
  }

  return {
    subscribe(listener: OrbSignalListener) {
      listeners.add(listener)
      listener(signal)
      return () => listeners.delete(listener)
    },
    start() {
      if (active) return active.ready
      const lifetime = new AbortController()
      const session = createSession(lifetime.signal, (next) => {
        if (!lifetime.signal.aborted) publish(next)
      })
      let resolveStart!: () => void
      let rejectStart!: (error: unknown) => void
      const ready = new Promise<void>((resolve, reject) => {
        resolveStart = resolve
        rejectStart = reject
      })
      // Register the call before start() synchronously emits 'connecting'.
      active = { session, lifetime, ready, cancelStart: resolveStart }
      session.start().then(resolveStart, (error) => {
        if (lifetime.signal.aborted) return
        active = undefined
        lifetime.abort()
        rejectStart(error)
      })
      return ready
    },
    stop() {
      if (!active) {
        if (signal.state !== 'idle') publish({ state: 'idle', inputVolume: 0, outputVolume: 0 })
        return lastStop
      }
      const call = active
      active = undefined
      call.lifetime.abort()
      call.cancelStart()
      lastStop = call.session.stop()
      if (!active) publish({ state: 'idle', inputVolume: 0, outputVolume: 0 })
      return lastStop
    },
  }
}
