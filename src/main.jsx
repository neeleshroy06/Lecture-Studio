import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjsLib from 'pdfjs-dist/build/pdf'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url'
import './index.css'
import App from './App.jsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
window.pdfjsLib = pdfjsLib

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
