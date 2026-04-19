import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { renderTextLayer } from 'pdfjs-dist/build/pdf'
import 'pdfjs-dist/web/pdf_viewer.css'
import { loadPdfFromBase64 } from '../../utils/pdfUtils'
import { buildDocumentIndex } from '../../utils/documentIndex'
import { TranscriptParser } from '../../utils/transcriptParser'
import { useGeminiLiveDocumentContext } from '../../context/GeminiLiveDocumentContext'
import { apiUrl } from '../../utils/apiUrl'

function PageWithTextLayer({ pdfDocument, pageNum, scale }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    if (!pdfDocument) return undefined
    let cancelled = false

    const run = async () => {
      const page = await pdfDocument.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const layer = layerRef.current
      if (!canvas || !layer || cancelled) return

      const context = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({ canvasContext: context, viewport }).promise
      if (cancelled) return

      layer.innerHTML = ''
      layer.style.setProperty('--scale-factor', String(viewport.scale))

      const textContent = await page.getTextContent()
      if (cancelled) return

      const task = renderTextLayer({
        textContentSource: textContent,
        container: layer,
        viewport,
        textDivs: [],
      })
      await task.promise
    }

    run().catch((error) => {
      console.error('Page render failed', pageNum, error)
    })

    return () => {
      cancelled = true
    }
  }, [pdfDocument, pageNum, scale])

  return (
    <div
      ref={wrapRef}
      data-page-number={pageNum}
      className="pdf-live-page"
      style={{
        position: 'relative',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#0f0f18',
        marginBottom: 12,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      <div
        ref={layerRef}
        className="textLayer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          color: 'transparent',
          lineHeight: 1,
        }}
      />
    </div>
  )
}

const TranscriptPdfViewer = forwardRef(function TranscriptPdfViewer(_props, ref) {
  const {
    setDocumentIndex,
    setIndexError,
    registerPdfDocument,
    replyText,
    replyTurnId,
    userInputTurnId,
    documentIndex,
  } = useGeminiLiveDocumentContext()

  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1.25)
  const [pageCount, setPageCount] = useState(0)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeChapter, setActiveChapter] = useState(0)
  const [geminiPageToast, setGeminiPageToast] = useState('')

  const containerRef = useRef(null)
  const parserRef = useRef(null)
  const actionChainRef = useRef(Promise.resolve())
  const replyTurnIdRef = useRef(0)

  useEffect(() => {
    replyTurnIdRef.current = replyTurnId
  }, [replyTurnId])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        setLoading(true)
        const response = await fetch(apiUrl('/api/context'))
        const data = await response.json()
        if (mounted) setContext(data)
      } catch (requestError) {
        if (mounted) setError(requestError.message || 'Unable to load course material.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

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

  const chapters = context?.chapters || []
  const chapterPages = useMemo(
    () =>
      chapters.length && pageCount
        ? chapters.map((_chapter, index) => Math.max(1, Math.ceil(((index + 1) / chapters.length) * pageCount)))
        : [],
    [chapters, pageCount],
  )

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
      if (chapterPages.length) {
        let bestChapter = 0
        chapterPages.forEach((startPage, index) => {
          if (bestPage >= startPage) bestChapter = index
        })
        setActiveChapter(bestChapter)
      }
    }

    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [pageCount, chapterPages])

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
          <p style={{ color: 'var(--text-muted)' }}>Waiting for professor to upload course materials...</p>
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
          {documentIndex && (
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Live index ready</span>
          )}
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

        {!!chapters.length && (
          <div className="muted-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 12 }}>
            {chapters.map((chapter, index) => (
              <button
                key={`${chapter}-${index}`}
                type="button"
                aria-label={`Jump to chapter ${chapter}`}
                onClick={() => {
                  setActiveChapter(index)
                  const target = chapterPages[index] || 1
                  const el = containerRef.current?.querySelector(`[data-page-number="${target}"]`)
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                style={{
                  whiteSpace: 'nowrap',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: activeChapter === index ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
                  color: activeChapter === index ? 'white' : 'var(--text-secondary)',
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                {chapter}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={containerRef} className="muted-scrollbar" style={{ flex: 1, overflow: 'auto', paddingRight: 6 }}>
        {pdfDoc &&
          Array.from({ length: pageCount || 0 }, (_, index) => (
            <PageWithTextLayer key={index} pdfDocument={pdfDoc} pageNum={index + 1} scale={scale} />
          ))}
      </div>
    </div>
  )
})

export default TranscriptPdfViewer
