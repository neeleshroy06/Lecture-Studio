import * as pdfjsLib from 'pdfjs-dist/build/pdf'

export { pdfjsLib }

export async function loadPdfFromBase64(base64, mimeType = 'application/pdf') {
  const dataUrl = `data:${mimeType};base64,${base64}`
  const task = pdfjsLib.getDocument({ url: dataUrl })
  return task.promise
}

export async function loadPdfFromUrl(url) {
  const task = pdfjsLib.getDocument({ url })
  return task.promise
}

export async function renderPageToCanvas(pdf, pageNum, canvas, scale = 1.5) {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  const context = canvas.getContext('2d')

  canvas.width = viewport.width
  canvas.height = viewport.height

  return page.render({
    canvasContext: context,
    viewport,
  }).promise
}

/** Returns base64 JPEG (no data URL prefix) for multimodal seed when text extraction is weak. */
export async function renderFirstPageJpegBase64(pdf, scale = 1.2, quality = 0.82) {
  const canvas = document.createElement('canvas')
  await renderPageToCanvas(pdf, 1, canvas, scale)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const idx = dataUrl.indexOf(',')
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
}
