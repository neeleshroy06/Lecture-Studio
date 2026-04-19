# Ed-Assist

Accessible AI lecture assistant: professor uploads materials; students get document-grounded **Gemini Live** voice Q&A in the browser.

## Gemini Live (student / document workspace)

The student experience runs a single **browser-native Gemini Live** session using `@google/genai`.

### API keys (important)

**Recommended:** set `GEMINI_API_KEY` in `.env` for the Express server. On session start the app calls `POST /api/gemini-live/token`, which mints a short-lived Live auth token with a normal HTTPS request, then the browser connects with that token. This avoids a known limitation: **browser WebSocket connections to Gemini often send `Referer: <empty>`**, so API keys restricted by “HTTP referrers” in Google AI Studio can fail even in Chrome with `localhost` allowlisted.

**Optional:** set `VITE_GOOGLE_API_KEY` only if you want a browser-embedded API key (not recommended for Live when using referrer restrictions).

The Live model defaults to `gemini-2.5-flash-native-audio-preview-12-2025` (override with `VITE_GEMINI_LIVE_MODEL` if needed).

### Document session model

- The professor uploads a PDF via the existing `/api/set-context` flow; the student loads it from `/api/context` as base64.
- The client builds a **document index** once (per-page text, normalized search text, compact map, optional headings/terms) and passes a truncated map + rules in the Live **system instruction**.
- Full extracted text is seeded into the Live session as initial context. If extraction is weak (scanned PDF), page 1 is also attached as a JPEG for grounding.
- **Transcript** drives `TranscriptParser`: page references (`page 3`, `pg. 5`, ranges, ordinals) scroll the PDF viewer; optional highlights use the text layer.
- Native Gemini audio is used for now; ElevenLabs can be added later as a separate TTS layer without changing the Gemini Live session path.

## Scripts

```bash
npm install
npm run dev
```

- Vite: `http://localhost:5173`
- API server: `http://localhost:3001` (see `server/proxy.js`)

### “Failed to fetch” / document won’t load (student)

The student UI should call **`/api/context`** on the **same origin** as the page (e.g. `http://localhost:5173/api/context`) so Vite can proxy to the Express app. In `.env`, **leave `VITE_API_URL` unset** for local dev, or rely on the proxy’s CORS headers if you point the client at `http://localhost:3001` directly.

## Build

```bash
npm run build
```

The production server serves `dist/` from the same Express app.
