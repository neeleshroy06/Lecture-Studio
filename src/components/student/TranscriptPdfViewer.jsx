import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import 'pdfjs-dist/web/pdf_viewer.css'
import { loadPdfFromBase64 } from '../../utils/pdfUtils'
import { buildDocumentIndex } from '../../utils/documentIndex'
import { TranscriptParser } from '../../utils/transcriptParser'
import { useGeminiLiveDocumentContext } from '../../context/GeminiLiveDocumentContext'
import { apiUrl } from '../../utils/apiUrl'
import AnnotatedPdfPage from './AnnotatedPdfPage'

const TranscriptPdfViewer = forwardRef(function TranscriptPdfViewer(_props, ref) {
  const {
    setDocumentIndex,
    setIndexError,
    registerPdfDocument,
    replyText,
    replyTurnId,
    userInputTurnId,
    documentIndex,
    setLectureMemory,
    setAnnotationEvents,
    setLectureContextMeta,
    askAboutAnnotation,
  } = useGeminiLiveDocumentContext()

  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [scale, setScale] = useState(1.25)
  const [pageCount, setPageCount] = useState(0)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [geminiPageToast, setGeminiPageToast] = useState('')

  const containerRef = useRef(null)
  const parserRef = useRef(null)
  const actionChainRef = useRef(Promise.resolve())
  const replyTurnIdRef = useRef(0)
  const mountedRef = useRef(true)
  const requestInFlightRef = useRef(false)

  useEffect(() => {
    replyTurnIdRef.current = replyTurnId
  }, [replyTurnId])

  const applyContextPayload = useCallback(
    (data) => {
      if (!mountedRef.current) return
      setContext((current) => {
        if (
          current?.contextVersion === data?.contextVersion &&
          current?.updatedAt === data?.updatedAt &&
          current?.publishedAt === data?.publishedAt
        ) {
          return current
        }
        return data
      })
      setAnnotationEvents?.(Array.isArray(data?.annotationEvents) ? data.annotationEvents : [])
      setLectureMemory?.(Array.isArray(data?.lectureMemory) ? data.lectureMemory : [])
      setLectureContextMeta?.({
        contextVersion: Number(data?.contextVersion) || 0,
        liveGroundingVersion: Number(data?.liveGroundingVersion) || 0,
        publishedAt: data?.publishedAt || null,
        lectureStatus: data?.lectureStatus || 'idle',
        runtimeStatus: data?.runtimeStatus || null,
        updatedAt: data?.updatedAt || null,
      })
    },
    [setAnnotationEvents, setLectureContextMeta, setLectureMemory],
  )

  const loadContext = useCallback(
    async ({ background = false } = {}) => {
      if (requestInFlightRef.current) return
      requestInFlightRef.current = true
      try {
        if (!background) setLoading(true)
        else setRefreshing(true)
        const response = await fetch(apiUrl('/api/context'), { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Unable to load course material (${response.status}).`)
        }
        const data = await response.json()
        if (!mountedRef.current) return
        setError('')
        applyContextPayload(data)
      } catch (requestError) {
        if (!mountedRef.current) return
        if (!background || !context) {
          setError(requestError.message || 'Unable to load course material.')
        }
      } finally {
        requestInFlightRef.current = false
        if (mountedRef.current && !background) setLoading(false)
        if (mountedRef.current && background) setRefreshing(false)
      }
    },
    [applyContextPayload, context],
  )

  useEffect(() => {
    mountedRef.current = true
    void loadContext()
    return () => {
      mountedRef.current = false
    }
  }, [loadContext])

  useEffect(() => {
    const refreshVisibleContext = () => {
      if (document.visibilityState === 'visible') {
        void loadContext({ background: true })
      }
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadContext({ background: true })
      }
    }, 4000)

    window.addEventListener('focus', refreshVisibleContext)
    document.addEventListener('visibilitychange', refreshVisibleContext)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', refreshVisibleContext)
      document.removeEventListener('visibilitychange', refreshVisibleContext)
    }
  }, [loadContext])

  const annotationEvents = useMemo(
    () => (Array.isArray(context?.annotationEvents) ? context.annotationEvents : []),
    [context?.annotationEvents],
  )
  const lectureMemory = useMemo(
    () => (Array.isArray(context?.lectureMemory) ? context.lectureMemory : []),
    [context?.lectureMemory],
  )

  const strokesByPage = useMemo(() => {
    const map = new Map()
    for (const stroke of annotationEvents) {
      const page = Number(stroke.page) || 1
      if (!map.has(page)) map.set(page, [])
      map.get(page).push(stroke)
    }
    return map
  }, [annotationEvents])

  const memoryByAnnotationId = useMemo(() => {
    const map = new Map()
    if (!lectureMemory.length || !annotationEvents.length) return map
    // Match each lecture-memory entry to the closest annotation by (page, timestamp).
    for (const entry of lectureMemory) {
      const candidates = annotationEvents.filter((stroke) => Number(stroke.page) === Number(entry.page))
      if (!candidates.length) continue
      let best = candidates[0]
      let bestDelta = Math.abs((best.startedAtMs ?? 0) - (entry.timestamp ?? 0))
      for (const stroke of candidates.slice(1)) {
        const delta = Math.abs((stroke.startedAtMs ?? 0) - (entry.timestamp ?? 0))
        if (delta < bestDelta) {
          best = stroke
          bestDelta = delta
        }
      }
      if (best?.id) map.set(best.id, entry)
    }
    return map
  }, [annotationEvents, lectureMemory])

  useEffect(() => {
    if (!context?.pdfBase64) return undefined
    let cancelled = false

    const loadPdf = async () => {
      try {
        setLoading(true)
        setIndexError('')
        const pdf = await loadPdfFromBase64(context.pdfBase64, context.pdfMimeType)
        if (cancelled) return
        setPdfDoc(pdf)
        registerPdfDocument(pdf)
        setPageCount(pdf.numPages)
        const index = await buildDocumentIndex(pdf)
        if (cancelled) return
        setDocumentIndex(index)
      } catch (renderError) {
        if (!cancelled) {
          const message = renderError.message || 'Unable to index PDF.'
          setError(message)
          setIndexError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [context?.pdfBase64, context?.pdfMimeType, registerPdfDocument, setDocumentIndex, setIndexError])

  const clearHighlights = useCallback(() => {
    containerRef.current?.querySelectorAll('.transcript-highlight').forEach((node) => {
      node.classList.remove('transcript-highlight')
    })
  }, [])

  const scrollToPage = useCallback(async (pageNumber) => {
    const root = containerRef.current
    if (!root) return
    const el = root.querySelector(`[data-page-number="${pageNumber}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setGeminiPageToast(`Viewing page ${pageNumber}`)
      window.setTimeout(() => setGeminiPageToast(''), 2400)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToPage: (pageNumber) => {
      void scrollToPage(pageNumber)
    },
  }))

  const applyHighlights = useCallback(
    (phrase, pages) => {
      const root = containerRef.current
      if (!root || !phrase?.trim()) return
      const targetPages = pages?.length ? pages : [1]
      const lower = phrase.toLowerCase()
      for (const pageNum of targetPages) {
        const wrap = root.querySelector(`[data-page-number="${pageNum}"]`)
        const layer = wrap?.querySelector('.textLayer')
        if (!layer) continue
        layer.querySelectorAll('span').forEach((span) => {
          if (span.textContent && span.textContent.toLowerCase().includes(lower)) {
            span.classList.add('transcript-highlight')
          }
        })
      }
    },
    [],
  )

  const enqueueActions = useCallback(
    (actions) => {
      const turnWhenScheduled = replyTurnIdRef.current
      for (const action of actions) {
        actionChainRef.current = actionChainRef.current.then(async () => {
          if (turnWhenScheduled !== replyTurnIdRef.current) return
          if (action.type === 'scroll_to_page') {
            await scrollToPage(action.page)
          }
          if (action.type === 'highlight_text') {
            applyHighlights(action.text, action.pages)
          }
        })
      }
    },
    [applyHighlights, scrollToPage],
  )

  useEffect(() => {
    if (!documentIndex) {
      parserRef.current = null
      return
    }
    parserRef.current = new TranscriptParser(documentIndex, enqueueActions)
  }, [documentIndex, enqueueActions])

  useEffect(() => {
    parserRef.current?.beginNewAssistantTurn()
  }, [replyTurnId])

  useEffect(() => {
    if (replyText && parserRef.current) {
      parserRef.current.updateTranscript(replyText)
    }
  }, [replyText, replyTurnId])

  useEffect(() => {
    clearHighlights()
  }, [userInputTurnId, clearHighlights])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const onScroll = () => {
      const pages = container.querySelectorAll('[data-page-number]')
      let bestPage = 1
      let closestDistance = Infinity
      pages.forEach((node) => {
        const pageNum = Number(node.getAttribute('data-page-number'))
        const rect = node.getBoundingClientRect()
        const distance = Math.abs(rect.top - 120)
        if (distance < closestDistance) {
          closestDistance = distance
          bestPage = pageNum
        }
      })
      setCurrentPage(bestPage)
    }

    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [pageCount])

  if (loading && !context) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="glass-card" style={{ padding: 16, marginBottom: 12 }}>
          <div className="skeleton" style={{ height: 18, width: 140, borderRadius: 8 }} />
        </div>
        <div className="muted-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 360, borderRadius: 12 }} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="glass-card" style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ color: 'var(--danger)', textAlign: 'center' }}>{error}</div>
      </div>
    )
  }

  if (!context?.pdfBase64) {
    return (
      <div className="glass-card" style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 42, opacity: 0.7 }}>📄</div>
          <p style={{ color: 'var(--text-muted)', marginBottom: 10 }}>
            {context?.lectureStatus === 'published'
              ? 'The lecture is marked as published, but no PDF package is available yet.'
              : 'Waiting for the professor to publish the annotated lecture package...'}
          </p>
          <button type="button" className="btn-secondary" onClick={() => void loadContext()}>
            Refresh now
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="glass-card" style={{ padding: 14, position: 'sticky', top: 0, zIndex: 2, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Course Material</div>
          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 13 }}>
            Page {currentPage} of {pageCount || 1}
          </div>
          <button type="button" className="btn-secondary" style={{ padding: '8px 12px', fontSize: 12 }} onClick={() => void loadContext({ background: true })}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" aria-label="Zoom out PDF" className="icon-button" onClick={() => setScale((value) => Math.max(0.8, value - 0.15))}>
              −
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Zoom in PDF" className="icon-button" onClick={() => setScale((value) => Math.min(2.4, value + 0.15))}>
              +
            </button>
          </div>
        </div>

        {geminiPageToast && (
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--primary)' }}>{geminiPageToast}</div>
        )}
      </div>

      <div ref={containerRef} className="muted-scrollbar" style={{ flex: 1, overflow: 'auto', paddingRight: 6 }}>
        {pdfDoc &&
          Array.from({ length: pageCount || 0 }, (_, index) => {
            const pageNum = index + 1
            return (
              <AnnotatedPdfPage
                key={pageNum}
                pdfDocument={pdfDoc}
                pageNum={pageNum}
                scale={scale}
                strokes={strokesByPage.get(pageNum) || []}
                memoryByAnnotationId={memoryByAnnotationId}
                onAnnotationClick={(annotationId) => askAboutAnnotation?.(annotationId)}
              />
            )
          })}
      </div>
    </div>
  )
})

export default TranscriptPdfViewer
