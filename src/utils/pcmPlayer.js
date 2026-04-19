import { base64ToFloat32 } from './audioUtils'

/**
 * Plays 16-bit little-endian PCM chunks (e.g. 24 kHz model output) via Web Audio.
 */
export class PcmChunkPlayer {
  constructor(sampleRate = 24000) {
    this.sampleRate = sampleRate
    this.context = null
    this.queue = []
    this.playingSource = null
  }

  ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ sampleRate: this.sampleRate })
    }
    return this.context
  }

  async resumeIfSuspended() {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  playNext() {
    if (!this.queue.length) {
      this.playingSource = null
      return
    }
    const context = this.ensureContext()
    const float32 = this.queue.shift()
    const buffer = context.createBuffer(1, float32.length, this.sampleRate)
    buffer.copyToChannel(float32, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.onended = () => {
      this.playNext()
    }
    this.playingSource = source
    source.start()
  }

  enqueueBase64Pcm(base64) {
    if (!base64) return
    const float32 = base64ToFloat32(base64)
    this.queue.push(float32)
    if (!this.playingSource) {
      this.playNext()
    }
  }

  clear() {
    this.queue = []
    if (this.playingSource) {
      try {
        this.playingSource.stop()
      } catch {
        /* ignore */
      }
    }
    this.playingSource = null
  }

  async close() {
    this.clear()
    if (this.context && this.context.state !== 'closed') {
      await this.context.close()
    }
    this.context = null
  }
}
