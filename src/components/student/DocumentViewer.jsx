import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { loadPdfFromBase64, renderPageToCanvas } from '../../utils/pdfUtils'
import { apiUrl } from '../../utils/apiUrl'

const DocumentViewer = forwardRef(function DocumentViewer(_props, ref) {
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1.25)
  const [pageCount, setPageCount] = useState(0)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [activeChapter, setActiveChapter] = useState(0)
  const containerRef = useRef(null)
  const pageRefs = useRef([])

  useImperativeHandle(ref, () => ({
    scrollToPage(pageNumber) {
      const index = Math.max(0, pageNumber - 1)
      pageRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  }))

  useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        setLoading(true)
        const response = await fetch(apiUrl('/api/context'))
        const data = await response.json()
        if (mounted) {
          setContext(data)
        }
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
    if (!context?.pdfBase64 || !window.pdfjsLib) return undefined
    let cancelled = false

    const loadPdf = async () => {
      try {
        setLoading(true)
        const pdf = await loadPdfFromBase64(context.pdfBase64, context.pdfMimeType)
        if (cancelled) return
        setPdfDoc(pdf)
        setPageCount(pdf.numPages)
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError.message || 'Unable to render PDF.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPdf()

    return () => {
      cancelled = true
    }
  }, [context?.pdfBase64, context?.pdfMimeType])

  useEffect(() => {
    if (!pdfDoc || !pageCount) return undefined
    let cancelled = false

    const renderAllPages = async () => {
      try {
        setLoading(true)
        await Promise.all(
          Array.from({ length: pageCount }, async (_item, index) => {
            const canvas = pageRefs.current[index]?.querySelector('canvas')
            if (!canvas) return
            await renderPageToCanvas(pdfDoc, index + 1, canvas, scale)
          }),
        )
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError.message || 'Unable to render PDF.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    const id = requestAnimationFrame(() => {
      renderAllPages()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [pdfDoc, pageCount, scale])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const onScroll = () => {
      const pages = pageRefs.current.filter(Boolean)
      let bestPage = 1
      let closestDistance = Infinity

      pages.forEach((node, index) => {
        const rect = node.getBoundingClientRect()
        const distance = Math.abs(rect.top - 120)
        if (distance < closestDistance) {
          closestDistance = distance
          bestPage = index + 1
        }
      })

      setCurrentPage(bestPage)
    }

    container.addEventListener('scroll', onScroll)
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  const chapters = context?.chapters || []
  const chapterPages = useMemo(() => {
    if (!chapters.length || !pageCount) return []
    return chapters.map((_chapter, index) => Math.max(1, Math.ceil(((index + 1) / chapters.length) * pageCount)))
  }, [chapters, pageCount])

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
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--text-muted)', opacity: 0.85 }}>PDF</div>
          <p style={{ color: 'var(--text-muted)' }}>Waiting for professor to upload course materials...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        className="glass-card"
        style={{ padding: 14, position: 'sticky', top: 0, zIndex: 2, marginBottom: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Course Material</div>
          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 13 }}>
            Page {currentPage} of {pageCount || 1}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" aria-label="Zoom out PDF" className="icon-button" onClick={() => setScale((value) => Math.max(0.8, value - 0.15))}>−</button>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Zoom in PDF" className="icon-button" onClick={() => setScale((value) => Math.min(2.4, value + 0.15))}>+</button>
          </div>
        </div>

        {!!chapters.length && (
          <div className="muted-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 12 }}>
            {chapters.map((chapter, index) => (
              <button
                key={`${chapter}-${index}`}
                type="button"
                aria-label={`Jump to chapter ${chapter}`}
                onClick={() => {
                  setActiveChapter(index)
                  pageRefs.current[(chapterPages[index] || 1) - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

      <div ref={containerRef} className="muted-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 12, paddingRight: 6 }}>
        {Array.from({ length: pageCount || 1 }).map((_, index) => (
          <div
            key={index}
            ref={(node) => {
              pageRefs.current[index] = node
            }}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0f0f18',
              minHeight: 320,
            }}
          >
            <canvas style={{ width: '100%', display: 'block' }} />
          </div>
        ))}
      </div>
    </div>
  )
})

export default DocumentViewer
