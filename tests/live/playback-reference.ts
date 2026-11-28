// Test-only taps on browser playback. Retain RMS levels, never speech or provider messages.
export function installPlaybackReference() {
  const meters: {
    analyser: AnalyserNode
    audible: () => boolean
    samples: Float32Array<ArrayBuffer>
  }[] = []
  const outputs = new WeakMap<BaseAudioContext, AnalyserNode>()
  const playback: { time: number; rms: number }[] = []
  window.orbQaPlayback = playback
  const connect = AudioNode.prototype.connect
  function meter(context: BaseAudioContext, audible = () => true) {
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    meters.push({ analyser, audible, samples: new Float32Array(analyser.fftSize) })
    return analyser
  }
  AudioNode.prototype.connect = new Proxy(connect, {
    apply(target, source: AudioNode, args) {
      if (args[0] !== source.context.destination) return Reflect.apply(target, source, args)
      let analyser = outputs.get(source.context)
      if (!analyser) {
        analyser = meter(source.context)
        outputs.set(source.context, analyser)
        Reflect.apply(target, analyser, [source.context.destination])
        // Keep the render graph pulling zero samples after the final player disconnects.
        const silence = source.context.createConstantSource()
        silence.offset.value = 0
        Reflect.apply(target, silence, [analyser])
        silence.start()
      }
      Reflect.apply(target, source, [analyser, ...args.slice(1)])
      return args[0]
    },
  })
  AudioNode.prototype.disconnect = new Proxy(AudioNode.prototype.disconnect, {
    apply(target, source: AudioNode, args) {
      const analyser = outputs.get(source.context)
      if (analyser && args[0] === source.context.destination) args[0] = analyser
      return Reflect.apply(target, source, args)
    },
  })

  // WebRTC players can play a remote MediaStream directly through an HTML element.
  let monitor: AudioContext | undefined
  const elements = new WeakMap<HTMLMediaElement, MediaStream>()
  function observeElement(el: HTMLMediaElement) {
    const stream = el.srcObject
    if (
      !(stream instanceof MediaStream) ||
      !stream.getAudioTracks().length ||
      elements.get(el) === stream
    )
      return
    elements.set(el, stream)
    monitor ??= new AudioContext()
    const analyser = meter(
      monitor,
      () => !el.paused && !el.muted && el.volume > 0 && el.srcObject === stream,
    )
    monitor.createMediaStreamSource(stream).connect(analyser)
    const silent = monitor.createGain()
    silent.gain.value = 0
    Reflect.apply(connect, analyser, [silent])
    Reflect.apply(connect, silent, [monitor.destination])
    void monitor.resume().catch(() => {})
  }
  const play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    const result = play.call(this)
    void result.then(
      () => observeElement(this),
      () => {},
    )
    return result
  }
  document.addEventListener(
    'playing',
    (event) => {
      if (event.target instanceof HTMLMediaElement) observeElement(event.target)
    },
    true,
  )
  window.setInterval(() => {
    if (!meters.length) return
    let rms = 0
    for (const { analyser, audible, samples } of meters) {
      if (analyser.context.state !== 'running' || !audible()) continue
      analyser.getFloatTimeDomainData(samples)
      let squares = 0
      for (const value of samples) squares += value * value
      rms = Math.max(rms, Math.sqrt(squares / samples.length))
    }
    playback.push({ time: performance.timeOrigin + performance.now(), rms })
  }, 33)
}
