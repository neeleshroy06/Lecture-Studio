import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import useGeminiLiveDocument from '../hooks/useGeminiLiveDocument'

const GeminiLiveDocumentContext = createContext(null)

export function GeminiLiveDocumentProvider({ children }) {
  const pdfDocRef = useRef(null)
  const [documentIndex, setDocumentIndex] = useState(null)
  const [indexError, setIndexError] = useState('')
  const [lectureMemory, setLectureMemory] = useState([])
  const [annotationEvents, setAnnotationEvents] = useState([])
  const [lectureContextMeta, setLectureContextMeta] = useState({
    contextVersion: 0,
    liveGroundingVersion: 0,
    publishedAt: null,
    lectureStatus: 'idle',
    runtimeStatus: null,
    updatedAt: null,
  })

  const getPdfDocument = useCallback(() => pdfDocRef.current, [])

  const registerPdfDocument = useCallback((doc) => {
    pdfDocRef.current = doc
  }, [])

  const live = useGeminiLiveDocument({
    documentIndex,
    getPdfDocument,
    lectureMemory,
    annotationEvents,
    lectureGroundingVersion: lectureContextMeta.liveGroundingVersion,
    runtimeStatus: lectureContextMeta.runtimeStatus,
  })

  const value = useMemo(
    () => ({
      ...live,
      documentIndex,
      indexError,
      lectureMemory,
      annotationEvents,
      lectureContextMeta,
      setDocumentIndex,
      setIndexError,
      setLectureMemory,
      setAnnotationEvents,
      setLectureContextMeta,
      registerPdfDocument,
    }),
    [live, documentIndex, indexError, lectureMemory, annotationEvents, lectureContextMeta, registerPdfDocument],
  )

  return <GeminiLiveDocumentContext.Provider value={value}>{children}</GeminiLiveDocumentContext.Provider>
}

export function useGeminiLiveDocumentContext() {
  const ctx = useContext(GeminiLiveDocumentContext)
  if (!ctx) {
    throw new Error('useGeminiLiveDocumentContext requires GeminiLiveDocumentProvider')
  }
  return ctx
}
