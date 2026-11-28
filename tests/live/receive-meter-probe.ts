// Route a recording to the actual SDK analysers after measuring one unmodified real reply.
export function installReceiveMeterProbe() {
  const peers = new Set<RTCPeerConnection>()
  const edges: { source: MediaStreamAudioSourceNode; analyser: AnalyserNode }[] = []
  const negotiate = RTCPeerConnection.prototype.setRemoteDescription
  RTCPeerConnection.prototype.setRemoteDescription = new Proxy(negotiate, {
    apply(original, peer: RTCPeerConnection, args) {
      peers.add(peer)
      return Reflect.apply(original, peer, args)
    },
  })
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = new Proxy(connect, {
    apply(original, source: AudioNode, args) {
      const result = Reflect.apply(original, source, args)
      if (source instanceof MediaStreamAudioSourceNode && args[0] instanceof AnalyserNode) {
        edges.push({ source, analyser: args[0] })
      }
      return result
    },
  })
  const restore: (() => void)[] = []
  window.orbQaRouteReceiveMeters = () => {
    const microphone = window.orbQaMicrophone
    if (!microphone) return 0
    const ids = new Set([...peers].flatMap((pc) => pc.getReceivers().map((r) => r.track?.id)))
    for (const { source, analyser } of [...edges]) {
      if (!source.mediaStream.getAudioTracks().some((t) => ids.has(t.id))) continue
      const context = source.context as AudioContext
      const fixture = context.createMediaStreamSource(microphone)
      source.disconnect(analyser)
      fixture.connect(analyser)
      restore.push(() => {
        fixture.disconnect()
        source.connect(analyser)
      })
    }
    return restore.length
  }
  window.orbQaRestoreReceiveMeters = () => {
    for (const undo of restore.splice(0)) undo()
  }
}
