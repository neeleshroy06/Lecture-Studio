import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import useGeminiLiveDocument from '../hooks/useGeminiLiveDocument'

const GeminiLiveDocumentContext = createContext(null)

export function GeminiLiveDocumentProvider({ children }) {
  const pdfDocRef = useRef(null)
  const [documentIndex, setDocumentIndex] = useState(null)
  const [indexError, setIndexError] = useState('')

  const getPdfDocument = useCallback(() => pdfDocRef.current, [])

  const registerPdfDocument = useCallback((doc) => {
    pdfDocRef.current = doc
  }, [])

  const live = useGeminiLiveDocument({ documentIndex, getPdfDocument })

  const value = useMemo(
    () => ({
      ...live,
      documentIndex,
      indexError,
      setDocumentIndex,
      setIndexError,
      registerPdfDocument,
    }),
    [live, documentIndex, indexError, registerPdfDocument],
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
