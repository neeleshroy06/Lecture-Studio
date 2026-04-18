import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import multer from 'multer'
import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer, WebSocket } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })
const uploadDir = path.join(__dirname, '../uploads')
const upload = multer({ dest: uploadDir })

const PORT = process.env.PORT || 3001
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY

fs.mkdirSync(uploadDir, { recursive: true })

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

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function cleanupUpload(file) {
  if (file?.path) {
    fs.promises.unlink(file.path).catch(() => {})
  }
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

function buildSystemInstruction() {
  return `You are an accessible AI tutor assistant for a university course. You answer student questions based ONLY on the following lecture materials provided by the professor.

LECTURE TRANSCRIPT:
${sessionContext.transcript || '(not provided)'}

PROFESSOR TYPED NOTES:
${sessionContext.typedNotes || '(not provided)'}

HANDWRITTEN NOTES (OCR):
${sessionContext.handwrittenNotesText || '(not provided)'}

CHAPTER TOPICS:
${sessionContext.chapters.join(', ') || '(auto-detect from content)'}

IMPORTANT RULES:
- Answer ONLY based on the lecture materials above.
- If something was not covered, say: "That wasn't covered in this lecture."
- Be warm, conversational, and encouraging - like the professor speaking directly to the student.
- Keep answers concise and spoken-word friendly. No bullet points, no markdown.
- If you reference a specific slide or page, prefix that sentence with [page:N] where N is the page number. Example: "[page:3] As shown here, mitosis begins when..."
- Never break character. You are the professor's AI voice.`
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

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Audio file is required.' })
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
    res.status(500).json({ message: 'Transcription failed.' })
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
    res.status(500).json({ message: 'Voice cloning failed.' })
  } finally {
    cleanupUpload(req.file)
  }
})

app.post('/api/set-context', async (req, res) => {
  const { transcript, handwrittenNotesText, typedNotes, pdfBase64, pdfMimeType, voiceId } = req.body || {}

  sessionContext = {
    transcript: transcript || '',
    handwrittenNotesText: handwrittenNotesText || '',
    typedNotes: typedNotes || '',
    pdfBase64: pdfBase64 || null,
    pdfMimeType: pdfMimeType || 'application/pdf',
    chapters: sessionContext.chapters || [],
    voiceId: voiceId || sessionContext.voiceId || '',
  }

  detectChaptersAsync(sessionContext.transcript)
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

wss.on('connection', (browserWs) => {
  let geminiWs = null
  let elevenWs = null
  let isSpeaking = false
  let elevenReady = false
  let textBuffer = ''
  let geminiClosingExpected = false

  function cleanupGemini() {
    if (geminiWs) {
      geminiClosingExpected = true
      geminiWs.removeAllListeners()
      try {
        geminiWs.close()
      } catch {}
      geminiWs = null
    }
  }

  function stopElevenLabs() {
    if (elevenWs) {
      elevenWs.removeAllListeners()
      try {
        elevenWs.close()
      } catch {}
      elevenWs = null
    }
    textBuffer = ''
    elevenReady = false
    isSpeaking = false
  }

  function flushElevenLabs() {
    if (elevenWs?.readyState === WebSocket.OPEN) {
      if (textBuffer.trim()) {
        elevenWs.send(JSON.stringify({ text: textBuffer }))
        textBuffer = ''
      }
      elevenWs.send(JSON.stringify({ text: '' }))
    }
  }

  function connectElevenLabs() {
    return new Promise((resolve, reject) => {
      if (elevenWs?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      const voiceId = sessionContext.voiceId
      if (!voiceId) {
        reject(new Error('No voice clone available.'))
        return
      }

      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000`
      elevenWs = new WebSocket(url, {
        headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      })

      elevenWs.on('open', () => {
        elevenReady = true
        elevenWs.send(
          JSON.stringify({
            text: ' ',
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          }),
        )
        resolve()
      })

      elevenWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.audio) {
            send(browserWs, { type: 'audio_chunk', audio: msg.audio })
          }
        } catch (error) {
          console.error('ElevenLabs message parse error:', error.message)
        }
      })

      elevenWs.on('close', () => {
        elevenReady = false
        isSpeaking = false
      })

      elevenWs.on('error', (error) => {
        console.error('ElevenLabs websocket error:', error.message)
        elevenReady = false
        reject(error)
      })
    })
  }

  async function streamToElevenLabs(textChunk) {
    if (!textChunk) return

    try {
      if (!elevenWs || elevenWs.readyState !== WebSocket.OPEN || !elevenReady) {
        await connectElevenLabs()
      }

      if (!isSpeaking) {
        isSpeaking = true
        send(browserWs, { type: 'speaking_start' })
      }

      textBuffer += textChunk
      const shouldFlush = /[.!?]\s$/.test(textBuffer) || textBuffer.length > 140
      if (shouldFlush) {
        elevenWs.send(JSON.stringify({ text: textBuffer }))
        textBuffer = ''
      }
    } catch (error) {
      console.error('ElevenLabs streaming error:', error.message)
      send(browserWs, { type: 'error', message: 'Unable to stream professor voice.' })
      stopElevenLabs()
    }
  }

  function connectGemini() {
    if (geminiWs?.readyState === WebSocket.OPEN || geminiWs?.readyState === WebSocket.CONNECTING) {
      return
    }

    geminiWs = new WebSocket(
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`,
    )
    geminiClosingExpected = false

    geminiWs.on('open', () => {
      geminiWs.send(
        JSON.stringify({
          setup: {
            model: 'models/gemini-3.1-flash-live-preview',
            generationConfig: {
              responseModalities: ['TEXT'],
            },
            systemInstruction: {
              parts: [{ text: buildSystemInstruction() }],
            },
            inputAudioTranscription: {},
            outputTranscription: {},
          },
        }),
      )

      send(browserWs, { type: 'gemini_connected' })
    })

    geminiWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        const content = msg.serverContent
        if (!content) return

        if (content.interrupted) {
          stopElevenLabs()
          send(browserWs, { type: 'interrupted' })
          return
        }

        if (content.inputTranscription?.text) {
          send(browserWs, { type: 'transcript_user', text: content.inputTranscription.text })
        }

        if (content.outputTranscription?.text) {
          send(browserWs, { type: 'transcript_gemini', text: content.outputTranscription.text })
        }

        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.text) {
              await streamToElevenLabs(part.text)
            }
          }
        }

        if (content.turnComplete) {
          flushElevenLabs()
          send(browserWs, { type: 'speaking_end' })
          isSpeaking = false
        }
      } catch (error) {
        console.error('Gemini message parse error:', error.message)
      }
    })

    geminiWs.on('close', () => {
      stopElevenLabs()
      if (!geminiClosingExpected) {
        send(browserWs, { type: 'error', message: 'Gemini session disconnected unexpectedly.' })
      }
    })

    geminiWs.on('error', (error) => {
      console.error('Gemini websocket error:', error.message)
      stopElevenLabs()
      send(browserWs, { type: 'error', message: 'Unable to connect to Gemini Live.' })
    })
  }

  browserWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())

      if (msg.type === 'start_session') {
        connectGemini()
        return
      }

      if (msg.type === 'audio_chunk' && geminiWs?.readyState === WebSocket.OPEN) {
        geminiWs.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                data: msg.audio,
                mimeType: 'audio/pcm;rate=16000',
              },
            },
          }),
        )
        return
      }

      if (msg.type === 'video_frame' && geminiWs?.readyState === WebSocket.OPEN) {
        geminiWs.send(
          JSON.stringify({
            realtimeInput: {
              video: {
                data: msg.frame,
                mimeType: 'image/jpeg',
              },
            },
          }),
        )
        return
      }

      if (msg.type === 'text_input' && geminiWs?.readyState === WebSocket.OPEN) {
        geminiWs.send(
          JSON.stringify({
            realtimeInput: {
              text: msg.text,
            },
          }),
        )
        return
      }

      if (msg.type === 'stop_speaking') {
        stopElevenLabs()
        return
      }

      if (msg.type === 'end_session') {
        stopElevenLabs()
        cleanupGemini()
      }
    } catch (error) {
      console.error('Browser message error:', error.message)
      send(browserWs, { type: 'error', message: 'Invalid websocket message.' })
    }
  })

  browserWs.on('close', () => {
    stopElevenLabs()
    cleanupGemini()
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

httpServer.listen(PORT, () => {
  console.log(`Ed-Assist proxy running on http://localhost:${PORT}`)
})
