export function formatTime(seconds = 0) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function base64ToFloat32(base64) {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)

  for (let index = 0; index < int16.length; index += 1) {
    float32[index] = int16[index] / 32768
  }

  return float32
}

export function float32ToBase64PCM(float32Array) {
  const int16 = new Int16Array(float32Array.length)

  for (let index = 0; index < float32Array.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[index]))
    int16[index] = sample < 0 ? sample * 32768 : sample * 32767
  }

  const bytes = new Uint8Array(int16.buffer)
  let binary = ''

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }

  return btoa(binary)
}
