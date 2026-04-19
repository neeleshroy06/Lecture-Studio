# ASL calibration JSON

Optional files in this folder are merged **on top of** the built-in procedural templates (per-letter override).

Supported filenames (first match wins):

- `templates.json`
- `asl-calibration.json`
- `asl-calibration (1).json`

## Format

Each letter is one averaged **normalized** landmark vector (63 floats = 21 × (x, y, z)):

```json
{
  "A": {
    "count": 5,
    "vector": [0.0, 0.0, 0.0]
  }
}
```

`count` is how many samples were averaged when the file was built (often 5).

## In-app training

Use **Train letters** on the ASL panel: pick A–Z, capture up to 5 samples per letter, then **Export JSON**. You can copy that file here as `asl-calibration.json` so the same calibration ships with the app. Training in the browser is also saved in `localStorage` for that origin and merged at runtime with these files.
