/**
 * Smoke test: API server, ElevenLabs auth, ElevenLabs TTS WS.
 * Run: node scripts/e2e-smoke.mjs
 */
import 'dotenv/config'
import axios from 'axios'
import WebSocket from 'ws'

const PROXY = process.env.ELEVENLABS_TEST_PROXY || 'http://localhost:3001'
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY
const VOICE_ID = (process.env.ELEVENLABS_VOICE_ID || '').trim()
function fail(msg) {
  console.error('[FAIL]', msg)
  process.exitCode = 1
}

function ok(msg) {
  console.log('[OK]', msg)
}

async function checkProxyContext() {
  try {
    const { data } = await axios.get(`${PROXY}/api/context`, { timeout: 5000 })
    if (data && typeof data === 'object') ok(`GET ${PROXY}/api/context`)
    else fail('Unexpected /api/context shape')
  } catch (e) {
    fail(`Proxy unreachable at ${PROXY} — is "node server/proxy.js" running? (${e.message})`)
  }
}

async function checkElevenLabsUser() {
  if (!ELEVEN_KEY) {
    fail('ELEVENLABS_API_KEY missing in .env')
    return
  }
  try {
    const { status } = await axios.get('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': ELEVEN_KEY },
      timeout: 15000,
    })
    if (status === 200) ok('ElevenLabs GET /v1/user (API key valid)')
    else fail(`ElevenLabs /v1/user unexpected status ${status}`)
  } catch (e) {
    const st = e.response?.status
    const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e.message
    fail(`ElevenLabs /v1/user failed (${st || 'no status'}): ${detail}`)
  }
}

async function checkElevenLabsTtsWs() {
  if (!ELEVEN_KEY) return
  if (!VOICE_ID || VOICE_ID.toLowerCase() === 'placeholder') {
    fail(
      'ELEVENLABS_VOICE_ID is missing or still "placeholder" — TTS WebSocket will fail until you set a real Voice ID from ElevenLabs.',
    )
    return
  }
  const ttsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000`
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(ttsUrl, { headers: { 'xi-api-key': ELEVEN_KEY } })
      const t = setTimeout(() => {
        ws.close()
        reject(new Error('timeout waiting for TTS open'))
      }, 15000)
      ws.on('open', () => {
        clearTimeout(t)
        ws.close()
        resolve()
      })
      ws.on('error', (err) => {
        clearTimeout(t)
        reject(err)
      })
    })
    ok(`ElevenLabs TTS WebSocket opens for voice_id (length ${VOICE_ID.length})`)
  } catch (e) {
    fail(`ElevenLabs TTS WebSocket: ${e.message} — check VOICE_ID and plan limits.`)
  }
}

async function main() {
  console.log('Ed-Assist E2E smoke (API + ElevenLabs)\n')
  await checkProxyContext()
  await checkElevenLabsUser()
  await checkElevenLabsTtsWs()
  if (process.exitCode === 1) {
    console.log('\nOne or more checks failed. Fix the items marked [FAIL] above.')
  } else {
    console.log('\nAll automated checks passed.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
