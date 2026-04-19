import { useEffect, useMemo, useRef, useState } from 'react'
import TranscriptPdfViewer from '../components/student/TranscriptPdfViewer'
import VoiceOrb from '../components/student/VoiceOrb'
import VoiceControls from '../components/student/VoiceControls'
import InputModeToggle from '../components/student/InputModeToggle'
import ASLCamera from '../components/student/ASLCamera'
import TranscriptPanel from '../components/student/TranscriptPanel'
import { useMicStream } from '../hooks/useAudioRecorder'
import { GeminiLiveDocumentProvider, useGeminiLiveDocumentContext } from '../context/GeminiLiveDocumentContext'

const DEFAULT_VOICE_LIVE_MODEL = 'gemini-3.1-flash-live-preview'
const DEFAULT_ASL_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025'

function resolveLiveModel(envKey, fallback) {
  const candidate = import.meta.env?.[envKey]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : fallback
}

const VOICE_LIVE_MODEL = resolveLiveModel('VITE_GEMINI_LIVE_MODEL', DEFAULT_VOICE_LIVE_MODEL)
const ASL_LIVE_MODEL = resolveLiveModel('VITE_GEMINI_LIVE_MODEL_ASL', DEFAULT_ASL_LIVE_MODEL)

function StudentPageContent() {
  const live = useGeminiLiveDocumentContext()
  const { sendAudioStreamEnd, annotationEvents = [] } = live
  const [inputMode, setInputMode] = useState('voice')
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0.2)
  const documentViewerRef = useRef(null)
  const sessionActive = live.status === 'live'
  const hasPublishedDeck = annotationEvents.length > 0

  const orbState = useMemo(() => {
    if (live.status !== 'live') return 'idle'
    if (live.isAssistantSpeaking) return 'speaking'
    if (live.lastEvent === 'user_turn_complete') return 'thinking'
    if (inputMode === 'voice' && !isMicMuted) return 'listening'
    return 'idle'
  }, [inputMode, isMicMuted, live.isAssistantSpeaking, live.lastEvent, live.status])

  useEffect(() => {
    if (!sessionActive || orbState !== 'listening') {
      setAudioLevel(0.18)
      return undefined
    }
    const timer = setInterval(() => {
      setAudioLevel(0.2 + Math.random() * 0.7)
    }, 150)
    return () => clearInterval(timer)
  }, [orbState, sessionActive])

  const micStream = useMicStream({
    active: sessionActive && inputMode === 'voice' && !isMicMuted,
    onAudioChunk: live.sendMicPcm,
  })

  useEffect(() => {
    const match = (live.isAssistantSpeaking ? live.replyText : live.heardText).match(/\[page:(\d+)\]/i)
    if (match) {
      documentViewerRef.current?.scrollToPage(Number(match[1]))
    }
  }, [live.heardText, live.isAssistantSpeaking, live.replyText])

  useEffect(() => {
    if (!sessionActive) return

    if (inputMode === 'asl') {
      setIsMicMuted(true)
      sendAudioStreamEnd()
      return
    }

    setIsMicMuted(false)
  }, [inputMode, sendAudioStreamEnd, sessionActive])

  const voiceSessionState = useMemo(() => {
    if (live.status === 'live') return 'active'
    if (live.status === 'connecting' || live.status === 'closing') return 'connecting'
    return 'idle'
  }, [live.status])

  const centerPanelStyle = useMemo(
    () => ({
      width: '37%',
      flex: '1 1 37%',
      minWidth: 0,
      minHeight: 0,
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 16,
      padding: 24,
      borderLeft: '1px solid var(--border)',
      borderRight: '1px solid var(--border)',
    }),
    [],
  )

  return (
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', overflow: 'hidden', padding: 12 }}>
      <div className="muted-scrollbar" style={{ width: '38%', overflowY: 'auto', padding: 12, minHeight: 0 }}>
        <TranscriptPdfViewer ref={documentViewerRef} />
      </div>

      <div style={centerPanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', flexShrink: 0 }}>
          <InputModeToggle mode={inputMode} onToggle={setInputMode} />
        </div>

        {inputMode === 'voice' && (
          <div
            className="glass-card"
            style={{
              flex: '1 1 auto',
              minHeight: 0,
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 20,
              padding: '28px 24px 24px',
            }}
          >
            <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', width: '100%' }}>
              <div style={{ transition: 'transform 0.2s ease' }}>
                <VoiceOrb orbState={orbState} audioLevel={audioLevel} />
              </div>
            </div>

            <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
              <VoiceControls
                isMicMuted={isMicMuted}
                onMicToggle={() =>
                  setIsMicMuted((value) => {
                    if (!value && live.status === 'live') {
                      live.sendAudioStreamEnd()
                    }
                    return !value
                  })
                }
                isPaused={isPaused}
                onPauseToggle={async () => {
                  if (isPaused) {
                    await live.resumeAssistantAudio()
                  } else {
                    live.pauseAssistantAudio()
                  }
                  setIsPaused((value) => !value)
                }}
                onEndSession={() => {
                  live.stopLive()
                  setIsMicMuted(false)
                  setIsPaused(false)
                }}
                sessionState={voiceSessionState}
                onStartSession={async () => {
                  setIsPaused(false)
                  setIsMicMuted(false)
                  await live.preparePlayback()
                  await live.startLive({ liveModel: VOICE_LIVE_MODEL })
                }}
              />
            </div>
          </div>
        )}

        {inputMode === 'asl' && (
          <div
            style={{
              width: '100%',
              flex: '1 1 auto',
              minHeight: 0,
              display: 'flex',
            }}
          >
            <ASLCamera
              active={inputMode === 'asl'}
              sessionState={voiceSessionState}
              onStartSession={async () => {
                setIsPaused(false)
                setIsMicMuted(true)
                await live.preparePlayback()
                await live.startLive({ liveModel: ASL_LIVE_MODEL })
              }}
              onEndSession={() => {
                live.stopLive()
                setIsMicMuted(false)
                setIsPaused(false)
              }}
              onSpelledWord={(text) => {
                live.sendText(text, { inputSource: 'asl' })
              }}
            />
          </div>
        )}

        {(live.error || micStream.error) && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{live.error || micStream.error}</p>}
        {live.status === 'connecting' && (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>
            {live.lastEvent === 'context_refresh' ? 'Refreshing live session with the latest lecture context...' : 'Connecting to live session...'}
          </p>
        )}
        {live.status === 'closing' && <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Closing live session...</p>}
        {!live.hasLiveBackend && (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
            Set <code style={{ fontFamily: 'inherit' }}>GEMINI_API_KEY</code> and <code style={{ fontFamily: 'inherit' }}>ELEVENLABS_API_KEY</code> in <code style={{ fontFamily: 'inherit' }}>.env</code> so the backend live proxy can connect and speak back.
          </p>
        )}
        {live.runtimeStatus?.lectureMemoryMode === 'pending' && (
          <p style={{ color: 'var(--amber)', fontSize: 12, margin: 0 }}>
            Enriching lecture context in the background—answers will improve shortly.
          </p>
        )}
        {live.runtimeStatus?.lectureMemoryMode === 'error' && (
          <p style={{ color: 'var(--amber)', fontSize: 12, margin: 0 }}>
            Some background services are unavailable. You can still ask about the document and the slides.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span
            title={
              hasPublishedDeck
                ? 'Professor marks appear on the slides. Click a highlighted region to ask about it.'
                : 'No lecture has been published yet — answers will follow the document text only.'
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              border: `1px solid ${hasPublishedDeck ? 'rgba(56,189,248,0.45)' : 'var(--border)'}`,
              background: hasPublishedDeck ? 'rgba(56,189,248,0.12)' : 'rgba(56,189,248,0.04)',
              color: hasPublishedDeck ? 'var(--primary)' : 'var(--text-muted)',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: hasPublishedDeck ? 'var(--primary)' : 'var(--text-muted)',
              }}
            />
            {live.runtimeStatus?.lectureMemoryMode === 'pending'
              ? 'Enriching'
              : hasPublishedDeck
                ? 'Lecture deck'
                : 'Document only (no lecture published)'}
          </span>
        </div>
      </div>

      <div className="muted-scrollbar" style={{ width: '25%', overflowY: 'auto', padding: 12, minHeight: 0 }}>
        <TranscriptPanel entries={live.transcriptEntries} />
      </div>
    </div>
  )
}

export default function StudentPage() {
  return (
    <GeminiLiveDocumentProvider>
      <StudentPageContent />
    </GeminiLiveDocumentProvider>
  )
}
