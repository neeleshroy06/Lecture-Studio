import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'

function UploadZone({ label, accept, onFile, description }) {
  const inputRef = useRef(null)

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
      style={{
        width: '100%',
        minHeight: 100,
        borderRadius: 12,
        border: '2px dashed var(--border)',
        background: 'rgba(255,255,255,0.02)',
        color: 'var(--text-muted)',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        padding: 16,
        textAlign: 'center',
      }}
    >
      <div>
        <div style={{ fontSize: 14 }}>{description}</div>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept={accept}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onFile(file)
            event.target.value = ''
          }}
        />
      </div>
    </button>
  )
}

export default function UploadPanel({ onPdfReady, onHandwritingOCR, onTypedNotes }) {
  const [pdfFile, setPdfFile] = useState(null)
  const [ocrState, setOcrState] = useState({ loading: false, text: '', preview: '', fileName: '', error: '' })
  const [typedValue, setTypedValue] = useState('')

  useEffect(() => {
    const timeout = setTimeout(() => {
      onTypedNotes?.(typedValue)
    }, 300)

    return () => clearTimeout(timeout)
  }, [typedValue, onTypedNotes])

  const typedCount = useMemo(() => typedValue.length, [typedValue])

  const handlePdf = async (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result?.toString() || ''
      const base64 = result.split(',')[1]
      setPdfFile(file)
      onPdfReady?.(base64, file.type || 'application/pdf')
    }
    reader.readAsDataURL(file)
  }

  const handleImage = async (file) => {
    const previewReader = new FileReader()
    previewReader.onload = () => {
      setOcrState((state) => ({ ...state, preview: previewReader.result?.toString() || '' }))
    }
    previewReader.readAsDataURL(file)

    setOcrState({ loading: true, text: '', preview: '', fileName: file.name, error: '' })
    try {
      const formData = new FormData()
      formData.append('image', file)
      const response = await axios.post('/api/ocr-notes', formData)
      const text = response.data?.text || ''
      setOcrState((state) => ({ ...state, loading: false, text, fileName: file.name, error: '' }))
      onHandwritingOCR?.(text)
    } catch (error) {
      setOcrState((state) => ({
        ...state,
        loading: false,
        error: error.response?.data?.message || 'Unable to read handwriting.',
      }))
    }
  }

  return (
    <section className="glass-card" style={{ padding: 24 }}>
      <div>
        <div style={{ fontSize: 32, color: 'var(--primary)' }}>📄</div>
        <h3 style={{ margin: '10px 0 14px', fontSize: 16 }}>Course Document</h3>
        {!pdfFile ? (
          <UploadZone label="Upload course PDF" accept=".pdf,application/pdf" onFile={handlePdf} description="Drag PDF here or click to browse" />
        ) : (
          <div className="glass-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22, color: 'var(--secondary)' }}>✓</span>
            <div>
              <div>{pdfFile.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 20 }} />

      <div>
        <div style={{ fontSize: 32, color: 'var(--secondary)' }}>✍️</div>
        <h3 style={{ margin: '10px 0 4px', fontSize: 16 }}>Handwritten Notes</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: 13 }}>
          Gemini will read your handwriting automatically
        </p>

        {!ocrState.loading && !ocrState.text && (
          <UploadZone
            label="Upload handwritten notes"
            accept=".jpg,.jpeg,.png,.heic,.webp,image/*"
            onFile={handleImage}
            description="Drag notes image here or click to browse"
          />
        )}

        {ocrState.loading && (
          <div className="glass-card" style={{ padding: 18, textAlign: 'center' }}>
            <div
              className="animate-spin-slow"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.1)',
                borderTopColor: 'var(--secondary)',
                margin: '0 auto 10px',
              }}
            />
            <div>Reading handwriting...</div>
          </div>
        )}

        {!ocrState.loading && ocrState.text && (
          <div className="glass-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {ocrState.preview && (
                <img
                  src={ocrState.preview}
                  alt="Handwritten notes preview"
                  style={{ width: 96, height: 80, objectFit: 'cover', borderRadius: 12 }}
                />
              )}
              <div>
                <div style={{ color: 'var(--secondary)', fontWeight: 600 }}>Notes extracted ✓</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ocrState.fileName}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                borderRadius: 12,
                padding: 12,
                background: 'rgba(255,255,255,0.03)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
              }}
            >
              {ocrState.text.split('\n').slice(0, 2).join('\n')}
            </div>
          </div>
        )}

        {ocrState.error && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{ocrState.error}</p>}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 20 }} />

      <div>
        <div style={{ fontSize: 32, color: 'var(--text-secondary)' }}>📝</div>
        <h3 style={{ margin: '10px 0 12px', fontSize: 16 }}>Typed Reference Notes</h3>
        <textarea
          aria-label="Typed reference notes"
          rows={6}
          className="input-surface"
          placeholder="Paste your notes, outlines, or any reference text the AI should know about..."
          value={typedValue}
          onChange={(event) => setTypedValue(event.target.value)}
        />
        <div style={{ textAlign: 'right', marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>{typedCount} characters</div>
      </div>
    </section>
  )
}
