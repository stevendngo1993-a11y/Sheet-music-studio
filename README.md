# Cadence — Sheet Music PDF Viewer, Editor & Transposer

A browser-based studio for viewing PDF sheet music, detecting staves and chords via Optical Music Recognition (OMR), editing engraved musical notation interactively, transposing keys and instruments in real time, synthesizing playback with Web Audio, and exporting crisp vector PDFs and MusicXML.

## Features

- **PDF Sheet Music Viewer & Markup (`pdfjs-dist`)**:
  - Open any `.pdf` sheet music via drag-and-drop or file picker with HiDPI rendering, multi-page navigation, zoom, and fit-to-width.
  - Automatic text-layer chord detection with **in-place transposed chord overlays** directly on top of the PDF page.
  - Per-page PDF annotations: auto-transposing chord stamps, highlighter, red pencil, text notes, and whiteout masks.
- **Client-Side Optical Music Recognition (OMR)**:
  - Detects 5-line staves, vertical barlines, noteheads, pitch positions, and nearby PDF chords from rendered PDF pages.
  - Toggleable detection overlay boxes and one-click loading into the interactive score editor.
- **Interactive Engraved Score Editor**:
  - Split View (PDF alongside editable engraved score), PDF Studio, and Score Editor modes.
  - Click the staff to add notes/rests (Whole → 16th + dotted), drag notes vertically to shift pitch, edit accidentals (`♭`/`♮`/`♯`), chord symbols, dynamics (`pp`–`ff`), lyrics, clefs (Treble/Bass), time signatures (`4/4`, `3/4`, `2/4`, `6/8`), measures, and Undo/Redo.
- **Music-Theory Transposition Engine**:
  - Transpose by semitones (`-1`, `+1`, `-8ve`, `+8ve`), directly by target key signature (all 15 circle-of-fifths keys), or by instrument/capo presets (Concert C, B♭ Trumpet/Clarinet, E♭ Alto Sax, F Horn, Guitar Capo 1–5) with proper diatonic/enharmonic spelling.
- **Web Audio Playback & Exports**:
  - Polyphonic Grand Piano, Electric Piano, Warm Strings, and Nylon Guitar synthesis with optional chord backing, metronome, loop, and live playhead.
  - Pure-JS vector **PDF 1.4** export (with lossless embedded score metadata for reopening in Cadence) and **MusicXML 3.1** import/export.

## Getting Started

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — Start local Vite development server
- `npm test` — Run Vitest unit test suite
- `npm run build` — Build production bundle into `dist/`
