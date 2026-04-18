import { useEffect, useMemo, useRef, useState } from 'react'
import DocumentViewer from '../components/student/DocumentViewer'
import VoiceOrb from '../components/student/VoiceOrb'
import VoiceControls from '../components/student/VoiceControls'
import InputModeToggle from '../components/student/InputModeToggle'
import ASLCamera from '../components/student/ASLCamera'
import TranscriptPanel from '../components/student/TranscriptPanel'
import CaptionsBar from '../components/student/CaptionsBar'
import useGeminiProxy from '../hooks/useGeminiProxy'
import useElevenLabsPlayer from '../hooks/useElevenLabsPlayer'
import { useMicStream } from '../hooks/useAudioRecorder'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export default function StudentPage() {
  const [sessionState, setSessionState] = useState('idle')
  const [orbState, setOrbState] = useState('idle')
  const [inputMode, setInputMode] = useState('voice')
  const [isMicMuted, setIsMicMuted] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [transcript, setTranscript] = useState([])
  const [currentCaption, setCurrentCaption] = useState('')
  const [context, setContext] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0.2)
  const [error, setError] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const documentViewerRef = useRef(null)
  const lastProfessorCaptionRef = useRef('')

  useEffect(() => {
    fetch(`${API_URL}/api/context`)
      .then((response) => response.json())
      .then((data) => setContext(data))
      .catch(() => setContext(null))
  }, [])

  useEffect(() => {
    if (sessionState !== 'active') return undefined
    const timer = setInterval(() => setElapsedSeconds((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [sessionState])

  useEffect(() => {
    if (orbState !== 'listening') {
      setAudioLevel(0.18)
      return undefined
    }

    const timer = setInterval(() => {
      setAudioLevel(0.2 + Math.random() * 0.7)
    }, 150)

    return () => clearInterval(timer)
  }, [orbState])

  const appendEntry = (role, text) => {
    if (!text?.trim()) return
    setTranscript((entries) => [
      ...entries,
      {
        id: crypto.randomUUID(),
        role,
        text,
        timestamp: elapsedSeconds,
      },
    ])
  }

  const player = useElevenLabsPlayer()
  const proxy = useGeminiProxy({
    onConnected: () => {
      setSessionState('active')
      setOrbState(inputMode === 'voice' ? 'listening' : 'idle')
      setError('')
    },
    onAudioChunk: (audio) => {
      if (!isPaused) player.enqueueAudio(audio)
    },
    onInterrupted: () => {
      player.clearQueue()
      setOrbState('listening')
    },
    onTranscriptUser: (text) => {
      appendEntry('user', text)
      setOrbState('thinking')
    },
    onTranscriptGemini: (text) => {
      setCurrentCaption(text)
      lastProfessorCaptionRef.current = text
      setOrbState('speaking')
    },
    onSpeakingStart: () => setOrbState('speaking'),
    onSpeakingEnd: () => {
      if (lastProfessorCaptionRef.current) {
        appendEntry('gemini', lastProfessorCaptionRef.current)
      }
      setOrbState(inputMode === 'voice' ? 'listening' : 'idle')
    },
    onError: (message) => {
      setError(message)
      setSessionState('ended')
      setOrbState('idle')
    },
  })

  useMicStream({
    active: sessionState === 'active' && inputMode === 'voice' && !isMicMuted,
    onAudioChunk: (chunk) => {
      proxy.sendAudio(chunk)
      if (sessionState === 'active') setOrbState('listening')
    },
  })

  useEffect(() => {
    if (sessionState !== 'active') return undefined
    const interval = setInterval(() => {
      if (window.__latestScreenFrame) {
        proxy.sendVideoFrame(window.__latestScreenFrame)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [proxy, sessionState])

  useEffect(() => {
    const match = currentCaption.match(/\[page:(\d+)\]/i)
    if (match) {
      documentViewerRef.current?.scrollToPage(Number(match[1]))
    }
  }, [currentCaption])

  const centerPanelStyle = useMemo(
    () => ({
      width: '37%',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 24px 92px',
      borderLeft: '1px solid var(--border)',
      borderRight: '1px solid var(--border)',
    }),
    [],
  )

  return (
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', overflow: 'hidden', padding: '12px 12px 12px 12px' }}>
      <div className="muted-scrollbar" style={{ width: '38%', overflowY: 'auto', padding: 12 }}>
        <DocumentViewer ref={documentViewerRef} />
      </div>

      <div style={centerPanelStyle}>
        <InputModeToggle mode={inputMode} onToggle={setInputMode} />

        <div style={{ flex: inputMode === 'voice' ? '1 1 auto' : '0 0 auto', display: 'grid', placeItems: 'center', width: '100%', paddingTop: 18 }}>
          <div style={{ transform: inputMode === 'asl' ? 'scale(0.78)' : 'scale(1)', transition: 'transform 0.2s ease' }}>
            <VoiceOrb orbState={orbState} audioLevel={audioLevel} />
          </div>
        </div>

        {inputMode === 'asl' && (
          <div style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', marginTop: 8 }}>
            <ASLCamera
              active={inputMode === 'asl'}
              onSpelledWord={(text) => {
                appendEntry('asl', text)
                proxy.sendText(text)
                setOrbState('thinking')
              }}
            />
          </div>
        )}

        <div style={{ marginTop: inputMode === 'voice' ? 20 : 14 }}>
          <VoiceControls
            isMicMuted={isMicMuted}
            onMicToggle={() => setIsMicMuted((value) => !value)}
            isPaused={isPaused}
            onPauseToggle={() => {
              if (!isPaused) proxy.stopSpeaking()
              if (isPaused) setOrbState(inputMode === 'voice' ? 'listening' : 'idle')
              setIsPaused((value) => !value)
            }}
            onEndSession={() => {
              proxy.disconnect()
              player.clearQueue()
              setSessionState('ended')
              setOrbState('idle')
              setCurrentCaption('')
              lastProfessorCaptionRef.current = ''
            }}
            sessionState={sessionState}
            onStartSession={() => {
              setElapsedSeconds(0)
              setSessionState('connecting')
              proxy.connect()
            }}
          />
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        {sessionState === 'connecting' && <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 12 }}>Connecting to live session...</p>}
        {sessionState === 'ended' && <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 12 }}>Session ended. Start again to reconnect.</p>}
        {context && !context.hasPdf && <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>Course PDF has not been uploaded yet.</p>}

        <CaptionsBar caption={currentCaption.replace(/\[page:\d+\]\s*/i, '')} />
      </div>

      <div className="muted-scrollbar" style={{ width: '25%', overflowY: 'auto', padding: 12 }}>
        <TranscriptPanel entries={transcript} />
      </div>
    </div>
  )
}
