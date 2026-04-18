import { useState } from 'react'
import LectureRecorder from '../components/professor/LectureRecorder'
import ScreenSharePanel from '../components/professor/ScreenSharePanel'
import UploadPanel from '../components/professor/UploadPanel'
import VoiceCloningPanel from '../components/professor/VoiceCloningPanel'
import SessionLauncher from '../components/professor/SessionLauncher'

export default function ProfessorPage({ onLaunch }) {
  const [transcript, setTranscript] = useState('')
  const [handwrittenNotesText, setHandwrittenNotesText] = useState('')
  const [typedNotes, setTypedNotes] = useState('')
  const [pdfBase64, setPdfBase64] = useState(null)
  const [pdfMimeType, setPdfMimeType] = useState('application/pdf')
  const [voiceId, setVoiceId] = useState('')

  return (
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', overflow: 'hidden', padding: 12, gap: 12 }}>
      <div className="muted-scrollbar" style={{ width: '55%', overflowY: 'auto', padding: 12, display: 'grid', gap: 20 }}>
        <LectureRecorder onTranscriptReady={setTranscript} />
        <ScreenSharePanel />
      </div>

      <div className="muted-scrollbar" style={{ width: '45%', overflowY: 'auto', padding: 12, display: 'grid', gap: 20 }}>
        <UploadPanel
          onPdfReady={(base64, mimeType) => {
            setPdfBase64(base64)
            setPdfMimeType(mimeType)
          }}
          onHandwritingOCR={setHandwrittenNotesText}
          onTypedNotes={setTypedNotes}
        />
        <VoiceCloningPanel onVoiceCloned={setVoiceId} />
        <SessionLauncher
          transcript={transcript}
          pdfBase64={pdfBase64}
          pdfMimeType={pdfMimeType}
          voiceId={voiceId}
          handwrittenNotesText={handwrittenNotesText}
          typedNotes={typedNotes}
          onLaunch={onLaunch}
        />
      </div>
    </div>
  )
}
