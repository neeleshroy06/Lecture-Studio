# Lecture Studio

**Lecture Studio** is a web app for accessible, document-grounded teaching. Professors record a lecture, upload and annotate a PDF, clone their voice, and publish a package. Students open the same slides and ask questions with **voice** or **ASL fingerspelling** (text to **Gemini Live**), with answers grounded in the document, the lecture transcript, timestamped annotations, and—when available—**structured lecture memory** produced by **Gemma 4**.

---

## Gemma 4 (do not skip)

This project uses **Gemma 4** in two complementary ways:

### 1. Gemma 4 on your machine (Ollama) — lecture intelligence

After you **publish** a lecture (`POST /api/process-lecture`), the server runs background jobs that call your configured **Ollama** model (intended to be **Gemma 4**):

| Job | What it does |
|-----|----------------|
| **Lecture memory** | Turns timestamped **annotation moments** (grouped strokes + nearby slide text + overlapping transcript excerpts) into structured JSON: per-moment summaries, cleaned transcript snippets, page numbers, and emphasis—so the student assistant can cite *what the professor was doing when they marked the slide*. |
| **Chapter / topic detection** | Reads the full lecture transcript and returns a short list of chapter-style topic names for context. |

Configure the local model with **`OLLAMA_MODEL`** (for example `gemma4:e4b` from `ollama list`). If Ollama is offline or the model is missing, **publishing can still succeed**; lecture memory and chapters may stay **pending**, **empty**, or surface **warnings** until Gemma 4 is available. The UI and `/api/health` expose Ollama readiness.

### 2. Cloud Gemma (Google AI) — handwriting OCR

**Handwritten notes** images are sent to **`gemma-4-27b-it`** via the Generative Language API (`POST /api/ocr-notes` in `server/proxy.js`), using **`GEMINI_API_KEY`**. This path exists so handwriting transcription works without requiring a multimodal Gemma build in Ollama on every developer machine.

**Summary:** **Gemma 4** powers **local, private lecture structuring** (Ollama) and **cloud handwriting OCR** (Google-hosted Gemma model name in the proxy). Both are first-class parts of the stack.

---

## Features (full list)

### Shared / app shell

- **Landing page** — Hero, feature grid, navigation to professor vs student workspace.
- **Theme** — Light/dark mode with persistence (`ThemeContext`, `ThemeToggle`).
- **Navigation** — `NavBar` switches between **Professor** and **Student** tabs without losing the single-page shell.

### Professor workspace

- **Session lifecycle** — Start a fresh lecture (`/api/clear-context`), record, stop, transcribe, and publish.
- **Lecture recording** — Capture audio; on stop, batch transcription via **ElevenLabs Scribe** (`POST /api/transcribe`).
- **Live captions** — Streaming partial captions over **`/api/stt-stream`** (buffered PCM → Scribe) for real-time UX while recording.
- **Screen share** — Optional screen capture so the pipeline can align with what was shown (see `ScreenSharePanel`).
- **PDF upload & viewer** — Load course PDFs; track page count and base64 payload for publish.
- **Annotation tools** — Pen, highlighter, eraser; strokes carry **page**, **time**, **bounds**, and **nearby text** for downstream Gemma 4 lecture memory.
- **Course document workspace** — `ProfessorDocumentWorkspace` ties PDF rendering (pdf.js text layer), strokes, and publish data together.
- **Voice cloning** — Upload sample audio; **ElevenLabs** instant voice (`POST /api/clone-voice`); `ELEVENLABS_VOICE_ID` is stored in session context for student TTS.
- **Handwriting panel** — Camera/upload images; **cloud Gemma** OCR (`/api/ocr-notes`) fills handwritten notes in context.
- **Typed notes** — Merged into shared session context for grounding.
- **Publish lecture package** — `POST /api/process-lecture` sends transcript, segments, annotations, PDF payload; triggers **Gemma 4 (Ollama)** lecture memory + chapters in the background.
- **Runtime status** — Warnings for Ollama/Gemma readiness, lecture memory mode, chapter detection, post-process state (surfaced from `/api/health` and publish responses).

### Student workspace

- **PDF + annotations** — Loads published PDF and annotation overlay from `/api/context`; scroll and view professor marks.
- **Document index** — Client-side PDF text extraction, term/heading maps, PHI-style redaction helpers, and **seed text** for Gemini Live (`buildDocumentIndex`, `documentIndex.js`).
- **Gemini Live session** — WebSocket **`/api/live`**: browser ↔ proxy ↔ **Google Gemini Live API**; optional **ElevenLabs** streaming TTS using the cloned professor voice when `ELEVENLABS_VOICE_ID` is set.
- **Voice input** — PCM mic chunks to the proxy; voice mode defaults to **`gemini-3.1-flash-live-preview`** (see `StudentPage.jsx`).
- **ASL input** — MediaPipe hand tracking + TensorFlow.js letter classifier; fingerspelled text is sent as user turns, and ASL mode defaults to the separate native-audio Live model **`gemini-2.5-flash-native-audio-preview-12-2025`** (see `StudentPage.jsx`).
- **Input mode toggle** — Switch between voice and ASL without leaving the page.
- **Annotation grounding** — Click a highlight stroke to ask about that mark; prompts include annotation id, page, nearby text, and lecture-memory snippets when present.
- **Transcript panel** — Timestamped conversation (you / professor voice as “Professor” / ASL-labeled turns when applicable).
- **Page sync** — Assistant replies can include `[page:N]` patterns to scroll the viewer (`TranscriptPdfViewer`).
- **Live session refresh** — When lecture memory or grounding version changes, the client can reconnect with updated seeds (`useGeminiLiveDocument` + context).

### Backend (Express proxy)

- **REST** — Transcribe, OCR notes, clone voice, process lecture, get/set/clear context, health, Gemini Live token minting.
- **WebSockets** — **`/api/live`** (Gemini Live + TTS bridge), **`/api/stt-stream`** (live caption chunks).
- **Session context** — In-memory lecture package: transcript, segments, PDF, annotations, lecture memory, chapters, voice id, runtime flags.
- **Gemini Live setup** — Server connects to Google’s Live WebSocket; system instruction from the client includes document map, lecture memory, and annotation index; generation config can disable internal “thinking” narration for cleaner spoken replies.
- **CORS** — Allows browser dev origins when calling the API directly.

---

## Tech stack (everything we use)

| Area | Technology |
|------|------------|
| **UI** | React 18, Vite 5, Tailwind CSS 3, PostCSS, Autoprefixer |
| **PDF** | pdf.js (`pdfjs-dist`), custom text layer + annotation overlay |
| **Live AI** | Google **Gemini Live** (WebSocket v1alpha), `@google/genai` (token API), client hooks in `useGeminiLiveDocument.js` |
| **Gemma 4 (local)** | **Ollama** HTTP `/api/chat` — lecture memory JSON + chapter list; model tag via **`OLLAMA_MODEL`** (e.g. `gemma4:e4b`) |
| **Gemma (cloud OCR)** | **`gemma-4-27b-it`** on Generative Language API for `/api/ocr-notes` |
| **Speech** | **ElevenLabs** — Scribe batch STT, streaming STT for captions, voice clone, **TTS** WebSocket stream for assistant audio |
| **ASL** | **MediaPipe** Tasks Vision (hand landmarker), **TensorFlow.js**, custom letter templates / classifier (`src/lib/asl/`, `useASLClassifier.js`) |
| **Server** | Node.js, Express, `ws`, Axios, Multer, `form-data`, `dotenv` |
| **Concurrency** | `concurrently` — proxy + Vite in `npm run dev` |

---

## Prerequisites

- **Node.js** 18+  
- **npm**  
- **API keys** — At minimum **`GEMINI_API_KEY`** and **`ELEVENLABS_API_KEY`** for full professor + student flows (see below).  
- **Ollama + Gemma 4** — Strongly recommended for lecture memory and chapters: install Ollama, run `ollama pull` for your chosen Gemma 4 tag (e.g. `gemma4:e4b`), and set **`OLLAMA_MODEL`** in `.env`.

---

## Quick start

```bash
git clone <your-fork-or-repo-url>
cd Project_Ed-Assist
npm install
cp .env.example .env
# Edit .env — set GEMINI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID after cloning voice, OLLAMA_MODEL=gemma4:e4b (or your tag)
npm run dev
```

- **App (Vite):** [http://localhost:5173](http://localhost:5173)  
- **API (Express):** proxied from the same origin as **`/api/*`** → **http://localhost:3001** (see `vite.config.js`)

---

## Environment variables

Create `.env` from `.env.example`. Never commit real secrets.

| Variable | Purpose |
|----------|---------|
| **`GEMINI_API_KEY`** | Gemini Live (via proxy WebSocket), **cloud Gemma** handwriting OCR (`gemma-4-27b-it`), and **`POST /api/gemini-live/token`** for browser-safe Live sessions. |
| **`ELEVENLABS_API_KEY`** | Transcription, live captions stream, voice clone, TTS. |
| **`ELEVENLABS_VOICE_ID`** | Default cloned voice for streaming assistant speech to students. |
| **`PORT`** | Express port (default **3001**). |
| **`OLLAMA_URL`** | Ollama base URL (default `http://localhost:11434`). |
| **`OLLAMA_MODEL`** | **Gemma 4** tag for lecture memory + chapters (e.g. **`gemma4:e4b`**). Server default if unset may differ—set explicitly for Gemma 4. |
| **`OLLAMA_TIMEOUT_MS`** / **`OLLAMA_LECTURE_MEMORY_TIMEOUT_MS`** | Long-running Ollama calls (lecture memory can take minutes on CPU). |
| **`GEMINI_LIVE_MODEL`** | Server default Live model name (see `server/proxy.js`). |
| **`VITE_API_URL`** | Optional; omit in local dev for same-origin `/api`. |
| **`VITE_GOOGLE_API_KEY`** | Optional browser key; Live prefers server key + token flow. |
| **`VITE_GEMINI_LIVE_MODEL`** | Optional client override for Live model name. |
| **`DEBUG`** | Set to `true` for verbose proxy logging. |

---

## HTTP & WebSocket API (reference)

| Method / path | Role |
|---------------|------|
| `POST /api/transcribe` | Audio file → ElevenLabs Scribe transcript + segments |
| `POST /api/ocr-notes` | Image → **cloud Gemma** handwriting text |
| `POST /api/clone-voice` | Sample audio → ElevenLabs voice id |
| `POST /api/process-lecture` | Publish PDF + transcript + annotations → background **Gemma 4 (Ollama)** jobs |
| `POST /api/set-context` | Merge professor context fields |
| `POST /api/clear-context` | Reset session package |
| `GET /api/context` | Full package for student (PDF, annotations, lecture memory, status, …) |
| `GET /api/health` | Server + **Ollama/Gemma** readiness, runtime flags |
| `POST /api/gemini-live/token` | Short-lived Live API auth token (v1alpha) |
| **WS `/api/live`** | Browser ↔ Gemini Live + optional ElevenLabs TTS |
| **WS `/api/stt-stream`** | Buffered PCM → partial captions (professor UI) |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | `server/proxy.js` + Vite on port **5173** |
| `npm run build` | Production build to `dist/` |
| `npm start` | Express only (serves `dist/` if present) |
| `npm run test:e2e` | `scripts/e2e-smoke.mjs` when configured |

---

## How the flow fits together

1. **Professor** starts a lecture, optionally shares screen, uploads a PDF, and annotates slides while speaking. Captions can stream via **`/api/stt-stream`**; final text comes from **`/api/transcribe`** on stop.  
2. **Handwriting** images go through **cloud Gemma** OCR and merge into context.  
3. **Voice clone** stores **`ELEVENLABS_VOICE_ID`** for later TTS.  
4. **Publish** calls **`/api/process-lecture`**; the server stores the package and runs **Gemma 4 via Ollama** for **lecture memory** and **chapters**.  
5. **Student** loads **`/api/context`**, builds a **document index** in the browser, and opens **Gemini Live** over **`/api/live`**. Answers use system instructions built from the document map, **Gemma 4–derived lecture memory**, and annotation index; the assistant can speak through **ElevenLabs** with the professor’s cloned voice.

---

## Gemini Live and API keys

Browser WebSocket handshakes may send an empty **Referer**, so Google API keys restricted by HTTP referrers can fail for Live. This repo supports **server-side `GEMINI_API_KEY`** and **`POST /api/gemini-live/token`** to mint short-lived tokens where applicable.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Student PDF / context fails | Use Vite proxy (`/api` on **5173**) or configure **`VITE_API_URL`** and CORS; confirm both processes from `npm run dev`. |
| Live session won’t connect | Check **`GEMINI_API_KEY`**, restart the proxy, inspect browser console and **`/api/health`**. |
| No assistant voice | Ensure **`ELEVENLABS_VOICE_ID`** is set after cloning and **`ELEVENLABS_API_KEY`** is valid. |
| Transcription / caption errors | Verify ElevenLabs key, plan limits, and model availability. |
| **Gemma 4** lecture memory empty or pending | Confirm **`ollama serve`**, **`ollama pull`** your **`OLLAMA_MODEL`** (e.g. **`gemma4:e4b`**), raise **`OLLAMA_LECTURE_MEMORY_TIMEOUT_MS`** on slow hardware. |
| Handwriting OCR fails | **`GEMINI_API_KEY`** must be valid for **cloud Gemma** endpoint. |

---

## Project layout (high level)

```
├── server/proxy.js       # Express, REST, WS (Live + STT stream), Ollama Gemma 4 jobs, cloud Gemma OCR
├── src/                  # React app: pages, professor/student components, hooks, context, utils
├── public/               # Static assets (e.g. ASL calibration data)
├── scripts/              # e.g. e2e smoke
└── .env.example          # Environment template
```

---

## License

Use and modify according to your repository’s license (add a `LICENSE` file if you distribute this project).
