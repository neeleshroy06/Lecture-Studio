import { useEffect, useRef } from 'react'
import axios from 'axios'
import LectureRecorder from '../components/professor/LectureRecorder'
import CourseDocumentPanel from '../components/professor/CourseDocumentPanel'

export default function ProfessorPage() {
  const lastSyncedTranscriptRef = useRef('')

  // Auto-sync the lecture transcript to the server whenever it's ready, so the
  // student session has it available without an extra "launch" step.
  const handleTranscriptReady = async (transcript) => {
    if (!transcript || transcript === lastSyncedTranscriptRef.current) return
    lastSyncedTranscriptRef.current = transcript
    try {
      await axios.post('/api/set-context', { transcript })
    } catch {
      // non-fatal; UI will still show the transcript locally
    }
  }

  useEffect(() => {
    lastSyncedTranscriptRef.current = ''
  }, [])

  return (
    <div
      className="animate-fade-in"
      style={{
        height: '100%',
        display: 'flex',
        overflow: 'hidden',
        padding: 16,
        gap: 16,
      }}
    >
      <div
        className="muted-scrollbar"
        style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'grid', gap: 16, alignContent: 'start' }}
      >
        <LectureRecorder onTranscriptReady={handleTranscriptReady} />
      </div>

      <div
        className="muted-scrollbar"
        style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'grid', gap: 16, alignContent: 'start' }}
      >
        <CourseDocumentPanel />
      </div>
    </div>
  )
}
