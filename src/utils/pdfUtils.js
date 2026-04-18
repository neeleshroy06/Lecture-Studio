export async function loadPdfFromBase64(base64, mimeType = 'application/pdf') {
  const dataUrl = `data:${mimeType};base64,${base64}`
  const task = window.pdfjsLib.getDocument(dataUrl)
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
