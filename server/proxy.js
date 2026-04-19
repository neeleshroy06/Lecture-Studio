import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer, WebSocket } from 'ws'

const DEBUG = process.env.DEBUG === 'true'
const log = (...args) => DEBUG && console.log(...args)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const uploadDir = path.join(__dirname, '../uploads')
const upload = multer({ dest: uploadDir })

const PORT = process.env.PORT || 3001
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const GEMINI_LIVE_WS_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`

fs.mkdirSync(uploadDir, { recursive: true })

/** Allow browser dev (e.g. Vite on :5173) to call API on :3001 when using absolute VITE_API_URL */
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

let sessionContext = {
  transcript: '',
  handwrittenNotesText: '',
  typedNotes: '',
  pdfBase64: null,
  pdfMimeType: 'application/pdf',
  chapters: [],
  voiceId: process.env.ELEVENLABS_VOICE_ID || '',
}

function cleanupUpload(file) {
  if (file?.path) {
    fs.promises.unlink(file.path).catch(() => {})
  }
}

/** Readable message for the UI when ElevenLabs (or similar) returns an axios error */
function messageFromUpstream(error) {
  const data = error.response?.data
  const status = error.response?.status
  const detail = data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.status === 'invalid_api_key' || detail?.message?.toLowerCase?.().includes('invalid api key')) {
    return 'Invalid ElevenLabs API key. In ElevenLabs → Profile → API keys, create a key and set ELEVENLABS_API_KEY in .env, then restart npm run dev.'
  }
  if (detail?.message) return detail.message
  if (status === 401) {
    return 'ElevenLabs rejected the API key (401). Update ELEVENLABS_API_KEY in .env and restart the server.'
  }
  if (status === 403) {
    return 'ElevenLabs denied this request (403). Speech-to-Text may require a paid plan — check your ElevenLabs subscription.'
  }
  if (status === 429) {
    return 'ElevenLabs rate limit reached. Wait a minute and try again.'
  }
  return error.message || 'Upstream request failed.'
}

function getGemmaEndpoint() {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-27b-it:generateContent?key=${GEMINI_API_KEY}`
}

function extractTextCandidate(data) {
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim() || ''
}

function parseChapterArray(raw) {
  if (!raw) return []
  const cleaned = raw.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : []
  } catch {
    return cleaned
      .split('\n')
      .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 8)
  }
}

async function detectChaptersAsync(transcript) {
  if (!transcript?.trim() || !GEMINI_API_KEY) {
    sessionContext.chapters = []
    return
  }

  try {
    const response = await axios.post(
      getGemmaEndpoint(),
      {
        contents: [
          {
            parts: [
              {
                text: `Analyze this lecture transcript and return a JSON array of 4 to 8 concise chapter or topic names only. Do not include markdown, explanations, or extra text.

Transcript:
${transcript.slice(0, 50000)}`,
              },
            ],
          },
        ],
      },
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )

    sessionContext.chapters = parseChapterArray(extractTextCandidate(response.data))
  } catch (error) {
    console.error('Chapter detection failed:', error.response?.data || error.message)
    sessionContext.chapters = []
  }
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(payload))
  if (payload?.type === 'gemini_connected') {
    log('[Proxy] gemini_connected sent to browser')
  }
}

function socketIsActive(ws) {
  return ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
}

function closeSocket(ws, code = 1000, reason = '') {
  if (!socketIsActive(ws)) return
  ws.close(code, reason)
}

function decodeReason(reason) {
  if (!reason) return ''
  if (typeof reason === 'string') return reason
  if (Buffer.isBuffer(reason)) return reason.toString()
  return String(reason)
}

function compactSection(title, value, fallback = '(none)', maxChars = 12000) {
  const text = typeof value === 'string' ? value.trim() : ''
  const body = text ? text.slice(0, maxChars) : fallback
  return `${title}:\n${body}`
}

function buildContextSystemInstruction() {
  const chapters = sessionContext.chapters?.length
    ? sessionContext.chapters.map((chapter, index) => `${index + 1}. ${chapter}`).join('\n')
    : '(none)'

  return `You are Ed-Assist, a live course assistant helping a student understand the uploaded course materials.

Use only the available transcript, notes, seeded document context, and current conversation for factual answers. If information is missing, say so briefly.

${compactSection('Detected chapters', chapters, '(none)', 3000)}

${compactSection('Lecture transcript', sessionContext.transcript)}

${compactSection('Typed notes', sessionContext.typedNotes, '(none)', 6000)}

${compactSection('Handwritten notes', sessionContext.handwrittenNotesText, '(none)', 6000)}`
}

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Audio file is required.' })
  }

  if (!ELEVENLABS_API_KEY?.trim()) {
    cleanupUpload(req.file)
    return res.status(500).json({
      message: 'Server has no ELEVENLABS_API_KEY. Add it to .env and restart the proxy.',
    })
  }

  try {
    const formData = new FormData()
    formData.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname || 'lecture.webm',
      contentType: req.file.mimetype || 'audio/webm',
    })
    formData.append('model_id', 'scribe_v2')

    const response = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', formData, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })

    const transcript = response.data?.text || response.data?.transcript || ''
    res.json({ transcript })
  } catch (error) {
    console.error('Transcription error:', error.response?.data || error.message)
    const message = messageFromUpstream(error)
    const code = error.response?.status
    const clientStatus = code === 401 || code === 403 ? code : 500
    res.status(clientStatus).json({ message })
  } finally {
    cleanupUpload(req.file)
  }
})

app.post('/api/ocr-notes', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Image file is required.' })
  }

  try {
    const imageBase64 = await fs.promises.readFile(req.file.path, { encoding: 'base64' })
    const response = await axios.post(
      getGemmaEndpoint(),
      {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: req.file.mimetype || 'image/png',
                  data: imageBase64,
                },
              },
              {
                text: 'Transcribe all handwritten text exactly as written. Preserve structure. Return only the transcribed text, nothing else.',
              },
            ],
          },
        ],
      },
      {
        headers: { 'Content-Type': 'application/json' },
      },
    )

    res.json({ text: extractTextCandidate(response.data) })
  } catch (error) {
    console.error('OCR error:', error.response?.data || error.message)
    res.status(500).json({ message: 'Handwriting OCR failed.' })
  } finally {
    cleanupUpload(req.file)
  }
})

app.post('/api/clone-voice', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Audio file is required.' })
  }

  if (!ELEVENLABS_API_KEY?.trim()) {
    cleanupUpload(req.file)
    return res.status(500).json({
      message: 'Server has no ELEVENLABS_API_KEY. Add it to .env and restart the proxy.',
    })
  }

  try {
    const formData = new FormData()
    formData.append('name', 'Professor Voice Clone')
    formData.append('files', fs.createReadStream(req.file.path), {
      filename: req.file.originalname || 'voice-sample.webm',
      contentType: req.file.mimetype || 'audio/webm',
    })

    const response = await axios.post('https://api.elevenlabs.io/v1/voices/add', formData, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    })

    sessionContext.voiceId = response.data?.voice_id || ''
    res.json({ voiceId: sessionContext.voiceId })
  } catch (error) {
    console.error('Voice clone error:', error.response?.data || error.message)
    const message = messageFromUpstream(error)
    const code = error.response?.status
    const clientStatus = code === 401 || code === 403 ? code : 500
    res.status(clientStatus).json({ message })
  } finally {
    cleanupUpload(req.file)
  }
})

app.post('/api/set-context', async (req, res) => {
  const body = req.body || {}
  const previousTranscript = sessionContext.transcript

  // Merge: only overwrite fields that are explicitly provided so panels can
  // sync independently (e.g. PDF upload alone, or transcript alone).
  if (Object.prototype.hasOwnProperty.call(body, 'transcript')) {
    sessionContext.transcript = body.transcript || ''
  }
  if (Object.prototype.hasOwnProperty.call(body, 'handwrittenNotesText')) {
    sessionContext.handwrittenNotesText = body.handwrittenNotesText || ''
  }
  if (Object.prototype.hasOwnProperty.call(body, 'typedNotes')) {
    sessionContext.typedNotes = body.typedNotes || ''
  }
  if (Object.prototype.hasOwnProperty.call(body, 'pdfBase64')) {
    sessionContext.pdfBase64 = body.pdfBase64 || null
    sessionContext.pdfMimeType = body.pdfMimeType || 'application/pdf'
  }
  if (Object.prototype.hasOwnProperty.call(body, 'voiceId')) {
    sessionContext.voiceId = body.voiceId || sessionContext.voiceId || ''
  }

  if (sessionContext.transcript && sessionContext.transcript !== previousTranscript) {
    detectChaptersAsync(sessionContext.transcript)
  }

  res.json({ ok: true })
})

app.post('/api/clear-context', (_req, res) => {
  sessionContext = {
    transcript: '',
    handwrittenNotesText: '',
    typedNotes: '',
    pdfBase64: null,
    pdfMimeType: 'application/pdf',
    chapters: [],
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
  }
  res.json({ ok: true })
})

app.get('/api/context', (_req, res) => {
  res.json({
    hasPdf: Boolean(sessionContext.pdfBase64),
    pdfBase64: sessionContext.pdfBase64,
    pdfMimeType: sessionContext.pdfMimeType,
    chapters: sessionContext.chapters,
    transcript: sessionContext.transcript,
    typedNotes: sessionContext.typedNotes,
    handwrittenNotesText: sessionContext.handwrittenNotesText,
  })
})

/**
 * Mint a short-lived Live API auth token (v1alpha) so the browser can connect with
 * `auth_tokens/...` instead of embedding a browser API key in the WebSocket URL.
 *
 * Browser WebSocket handshakes often send Referer: empty; Google API keys restricted by
 * "HTTP referrers" then fail with "referer <empty> are blocked". Server-side keys use
 * normal HTTPS requests for token creation and are not subject to that WebSocket quirk.
 *
 * For production, protect this route (session cookie, etc.); it is open for local dev.
 */
app.post('/api/gemini-live/token', async (req, res) => {
  if (!GEMINI_API_KEY?.trim()) {
    return res.status(503).json({
      message: 'Server has no GEMINI_API_KEY. Add it to .env for server-minted Live tokens.',
    })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai/node')
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: { apiVersion: 'v1alpha' },
    })
    const requestedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : ''
    const requestedConfig =
      req.body?.config && typeof req.body.config === 'object' && !Array.isArray(req.body.config) ? req.body.config : null
    const tokenConfig = {
      uses: 1,
      httpOptions: { apiVersion: 'v1alpha' },
    }

    if (requestedModel || requestedConfig) {
      tokenConfig.liveConnectConstraints = {}
      if (requestedModel) tokenConfig.liveConnectConstraints.model = requestedModel
      if (requestedConfig) tokenConfig.liveConnectConstraints.config = requestedConfig
    }

    const token = await ai.authTokens.create({
      config: tokenConfig,
    })
    if (!token?.name) {
      return res.status(500).json({ message: 'Token response missing name.' })
    }
    res.json({ tokenName: token.name })
  } catch (error) {
    console.error('gemini-live token:', error)
    res.status(500).json({
      message: error?.message || 'Failed to create Live session token.',
    })
  }
})

const server = http.createServer(app)
const liveWss = new WebSocketServer({ server, path: '/api/live' })

liveWss.on('connection', (browserWs) => {
  let geminiWs = null
  let elevenWs = null
  let elevenReady = false
  let elevenQueue = []
  let isSpeaking = false
  let currentSource = null
  let sessionSystemInstruction = ''
  let pendingSeedTurns = []

  function buildSystemInstruction() {
    return sessionSystemInstruction.trim() || buildContextSystemInstruction()
  }

  function prepareElevenLabs() {
    const existingWs = elevenWs
    if (socketIsActive(existingWs)) {
      closeSocket(existingWs, 1000, 'Refreshing stream')
    }

    elevenWs = null
    elevenReady = false
    isSpeaking = false
    currentSource = null

    if (!ELEVENLABS_API_KEY?.trim()) {
      safeSend(browserWs, {
        type: 'error',
        message: 'Server has no ELEVENLABS_API_KEY. Add it to .env and restart the proxy.',
      })
      return
    }

    const voiceId = sessionContext.voiceId
    if (!voiceId) {
      console.warn('[ElevenLabs] No voice ID set — skipping TTS connection')
      return
    }

    const wsUrl =
      `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input` +
      `?model_id=eleven_flash_v2_5&output_format=pcm_24000&optimize_streaming_latency=3`

    const nextWs = new WebSocket(wsUrl, {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    })

    elevenWs = nextWs

    nextWs.on('open', () => {
      if (elevenWs !== nextWs) {
        closeSocket(nextWs, 1000, 'Superseded')
        return
      }

      log('[ElevenLabs] Connected')
      elevenReady = true

      nextWs.send(
        JSON.stringify({
          text: ' ',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            use_speaker_boost: true,
          },
          generation_config: {
            chunk_length_schedule: [120, 160, 250, 290],
          },
        }),
      )

      if (elevenQueue.length > 0) {
        log(`[ElevenLabs] Flushing ${elevenQueue.length} queued chunks`)
        elevenQueue.forEach((chunk) => {
          nextWs.send(JSON.stringify({ text: chunk }))
        })
        elevenQueue = []
      }
    })

    nextWs.on('message', (data) => {
      if (elevenWs !== nextWs) return

      try {
        const msg = JSON.parse(data.toString())

        if (msg.audio) {
          if (!isSpeaking) {
            isSpeaking = true
            safeSend(browserWs, { type: 'speaking_start' })
          }
          safeSend(browserWs, { type: 'audio_chunk', audio: msg.audio })
        }

        if (msg.isFinal) {
          isSpeaking = false
          currentSource = null
          safeSend(browserWs, { type: 'speaking_end' })
          prepareElevenLabs()
        }

        if (msg.error) {
          console.error('[ElevenLabs] API error:', msg.error)
          safeSend(browserWs, { type: 'error', message: `ElevenLabs: ${msg.error}` })
        }
      } catch (error) {
        console.error('[ElevenLabs] Failed to parse message:', error.message)
      }
    })

    nextWs.on('error', (err) => {
      if (elevenWs !== nextWs) return
      console.error('[ElevenLabs] WS error:', err.message)
      elevenReady = false
      safeSend(browserWs, { type: 'error', message: 'TTS connection error' })
    })

    nextWs.on('close', (code, reason) => {
      if (elevenWs !== nextWs) return
      log(`[ElevenLabs] Closed: ${code} ${decodeReason(reason)}`)
      elevenReady = false
      isSpeaking = false
      currentSource = null
    })
  }

  function streamTextToElevenLabs(text) {
    if (!text || text.trim() === '') return

    currentSource = currentSource || 'gemini'

    if (!elevenReady || !elevenWs || elevenWs.readyState !== WebSocket.OPEN) {
      log(`[ElevenLabs] Not ready yet — queuing: "${text.substring(0, 30)}..."`)
      elevenQueue.push(text)
      return
    }

    elevenWs.send(JSON.stringify({ text }))
  }

  function flushElevenLabs() {
    elevenQueue = []
    currentSource = null
    if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
      elevenWs.send(JSON.stringify({ text: '' }))
      log('[ElevenLabs] Sent EOS signal')
    }
  }

  function stopElevenLabs() {
    const activeWs = elevenWs
    elevenQueue = []
    isSpeaking = false
    elevenReady = false
    currentSource = null
    elevenWs = null
    if (activeWs && socketIsActive(activeWs)) {
      closeSocket(activeWs, 1000, 'Interrupted')
    }
    safeSend(browserWs, { type: 'speaking_end' })
  }

  function sendSeedTurns() {
    if (!pendingSeedTurns.length || !geminiWs || geminiWs.readyState !== WebSocket.OPEN) return

    geminiWs.send(
      JSON.stringify({
        clientContent: {
          turns: pendingSeedTurns,
          turnComplete: false,
        },
      }),
    )
    pendingSeedTurns = []
  }

  function connectGemini() {
    if (!GEMINI_API_KEY?.trim()) {
      safeSend(browserWs, {
        type: 'error',
        message: 'Server has no GEMINI_API_KEY. Add it to .env and restart the proxy.',
      })
      return
    }

    if (socketIsActive(geminiWs)) {
      closeSocket(geminiWs, 1000, 'Restarting session')
    }

    geminiWs = new WebSocket(GEMINI_LIVE_WS_URL)

    const setup = {
      setup: {
        model: 'models/gemini-3.1-flash-live-preview',
        generationConfig: {
          responseModalities: ['AUDIO'],
        },
        systemInstruction: {
          parts: [{ text: buildSystemInstruction() }],
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }

    geminiWs.on('open', () => {
      log('[Gemini] WebSocket opened')
      geminiWs.send(JSON.stringify(setup))
      prepareElevenLabs()
      safeSend(browserWs, { type: 'gemini_connected' })
    })

    geminiWs.on('message', (rawMsg) => {
      let msg
      try {
        msg = JSON.parse(rawMsg.toString())
      } catch {
        return
      }

      if (msg.setupComplete) {
        sendSeedTurns()
        return
      }

      const content = msg.serverContent
      if (!content) return

      if (content.interrupted) {
        log('[Gemini] Turn interrupted by user')
        stopElevenLabs()
        setTimeout(() => {
          if (browserWs.readyState === WebSocket.OPEN) {
            prepareElevenLabs()
          }
        }, 300)
        safeSend(browserWs, { type: 'interrupted' })
        return
      }

      if (content.inputTranscription?.text) {
        safeSend(browserWs, {
          type: 'transcript_user',
          text: content.inputTranscription.text,
          isFinal: content.inputTranscription.finished ?? true,
        })
      }

      const hasOutputTranscript = Boolean(content.outputTranscription?.text)
      if (hasOutputTranscript) {
        safeSend(browserWs, {
          type: 'transcript_gemini',
          text: content.outputTranscription.text,
        })
        streamTextToElevenLabs(content.outputTranscription.text)
      }

      if (content.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (!part.text) continue
          if (!hasOutputTranscript) {
            safeSend(browserWs, {
              type: 'transcript_gemini',
              text: part.text,
            })
          }
          streamTextToElevenLabs(part.text)
        }
      }

      if (content.turnComplete) {
        log('[Gemini] Turn complete — flushing ElevenLabs')
        flushElevenLabs()
      }
    })

    geminiWs.on('error', (err) => {
      console.error('[Gemini] WS error:', err.message)
      safeSend(browserWs, { type: 'error', message: 'Gemini connection error' })
    })

    geminiWs.on('close', (code, reason) => {
      log(`[Gemini] Closed: ${code} ${decodeReason(reason)}`)
      stopElevenLabs()
      if (browserWs.readyState === WebSocket.OPEN && code !== 1000) {
        safeSend(browserWs, {
          type: 'error',
          message: decodeReason(reason) || 'Gemini Live session closed unexpectedly.',
        })
      }
      geminiWs = null
    })
  }

  browserWs.on('message', (rawMessage) => {
    let message
    try {
      message = JSON.parse(rawMessage.toString())
    } catch {
      return
    }

    switch (message.type) {
      case 'start_session':
        sessionSystemInstruction = typeof message.systemInstruction === 'string' ? message.systemInstruction : ''
        pendingSeedTurns = Array.isArray(message.seedTurns) ? message.seedTurns : []
        connectGemini()
        break
      case 'audio_chunk':
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN && typeof message.audio === 'string') {
          geminiWs.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  data: message.audio,
                  mimeType: 'audio/pcm;rate=16000',
                },
              },
            }),
          )
        }
        break
      case 'audio_stream_end':
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(
            JSON.stringify({
              realtimeInput: { audioStreamEnd: true },
            }),
          )
        }
        break
      case 'user_text': {
        const text = typeof message.text === 'string' ? message.text.trim() : ''
        if (!text || !geminiWs || geminiWs.readyState !== WebSocket.OPEN) break
        geminiWs.send(
          JSON.stringify({
            realtimeInput: {
              text,
            },
          }),
        )
        break
      }
      case 'end_session':
        log('[Proxy] Session ended by user')
        stopElevenLabs()
        if (geminiWs) {
          closeSocket(geminiWs, 1000, 'Session ended')
          geminiWs = null
        }
        safeSend(browserWs, { type: 'session_ended' })
        break
      default:
        break
    }
  })

  browserWs.on('close', () => {
    log('[Proxy] Browser disconnected — cleaning up')
    stopElevenLabs()
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close(1000, 'Browser disconnected')
    } else if (geminiWs && geminiWs.readyState === WebSocket.CONNECTING) {
      closeSocket(geminiWs, 1000, 'Browser disconnected')
    }
    geminiWs = null
  })

  browserWs.on('error', (error) => {
    console.error('[Proxy] Browser WS error:', error.message)
  })
})

app.use(express.static(path.join(__dirname, '../dist')))

app.get('*', (_req, res) => {
  const distIndex = path.join(__dirname, '../dist/index.html')
  if (fs.existsSync(distIndex)) {
    res.sendFile(distIndex)
    return
  }

  res.status(404).json({ message: 'Build output not found.' })
})

server.listen(PORT, () => {
  console.log(`Ed-Assist proxy running on http://localhost:${PORT}`)
})
