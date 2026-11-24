/**
 * Cadence — Sheet Music PDF Viewer, Editor & Transposer
 * Main application controller uniting PDF.js display, OMR scanner,
 * interactive SVG notation editor, music-theory transposition engine,
 * Web Audio synthesizer, and vector PDF / MusicXML export.
 */

import {
  KEY_SIGNATURES,
  INSTRUMENT_PRESETS,
  getKeyInfo,
  formatPitch,
  pitchToMidi,
  midiToFreq,
  midiToPitch,
} from './music/theory.js';
import {
  getSampleScores,
  cloneScore,
  createNote,
  createMeasure,
  transposeScore,
  transposeScoreToKey,
  ScoreHistory,
} from './music/scoreModel.js';
import { ScoreEngraver } from './music/engraver.js';
import { ScoreSynth } from './audio/synth.js';
import { generateScorePdf, extractEmbeddedScoreFromPdfBytes } from './pdf/pdfExporter.js';
import { PdfSheetViewer } from './pdf/pdfViewer.js';
import { scanSheetMusicImage } from './pdf/omrScanner.js';
import { exportMusicXml, importMusicXml } from './io/musicXml.js';

// --- Application State ---
const samples = getSampleScores();
const history = new ScoreHistory(samples[0]);
let score = cloneScore(samples[0]);
let selectedNoteId = null;
let enharmonicPref = 'auto';
let activeScoreTool = 'select';
let activeDuration = 'q';
let activeDotted = false;
let lastOmrResult = null;
let dragOriginalScore = null;
let toastTimer = null;

// --- DOM References ---
const $ = (id) => document.getElementById(id);

const els = {
  studioMain: $('studio-main'),
  sampleSelect: $('sample-select'),
  btnOpenFile: $('btn-open-file'),
  fileInput: $('file-input'),
  btnExportPdf: $('btn-export-pdf'),
  btnExportXml: $('btn-export-xml'),
  btnPrint: $('btn-print'),
  btnTheme: $('btn-theme'),
  btnToggleInspector: $('btn-toggle-inspector'),
  inspectorDrawer: $('inspector-drawer'),

  // Transposition
  keySelect: $('key-select'),
  btnOctDown: $('btn-oct-down'),
  btnSemiDown: $('btn-semi-down'),
  btnSemiUp: $('btn-semi-up'),
  btnOctUp: $('btn-oct-up'),
  btnTransposeReset: $('btn-transpose-reset'),
  transposeReadout: $('transpose-readout'),
  instrumentPreset: $('instrument-preset'),

  // Playback
  btnPlay: $('btn-play'),
  iconPlay: $('icon-play'),
  iconStop: $('icon-stop'),
  playLabel: $('play-label'),
  tempoInput: $('tempo-input'),
  synthInstrument: $('synth-instrument'),
  btnChordsAudio: $('btn-chords-audio'),
  btnMetronome: $('btn-metronome'),
  btnLoop: $('btn-loop'),

  // Tool Rail
  btnDotToggle: $('btn-dot-toggle'),
  btnAddMeasure: $('btn-add-measure'),
  btnDelMeasure: $('btn-del-measure'),
  btnUndo: $('btn-undo'),
  btnRedo: $('btn-redo'),
  btnPdfUndoMark: $('btn-pdf-undo-mark'),
  btnPdfClearMarks: $('btn-pdf-clear-marks'),

  // PDF Pane
  panePdf: $('pane-pdf'),
  pdfStage: $('pdf-stage'),
  pdfDropOverlay: $('pdf-drop-overlay'),
  pdfFilename: $('pdf-filename'),
  pdfChordsBadge: $('pdf-chords-badge'),
  btnPdfPrev: $('btn-pdf-prev'),
  btnPdfNext: $('btn-pdf-next'),
  pdfPageIndicator: $('pdf-page-indicator'),
  btnPdfZoomOut: $('btn-pdf-zoom-out'),
  btnPdfZoomIn: $('btn-pdf-zoom-in'),
  btnPdfFit: $('btn-pdf-fit'),
  pdfZoomReadout: $('pdf-zoom-readout'),
  chkPdfTransposeChords: $('chk-pdf-transpose-chords'),
  btnSyncPdf: $('btn-sync-pdf'),
  btnRunOmr: $('btn-run-omr'),

  // Editor Pane
  scoreCanvasHost: $('score-canvas-host'),
  clefSelect: $('clef-select'),
  timesigSelect: $('timesig-select'),

  // Inspector
  inspNoteSection: $('inspector-note-section'),
  btnDeleteSelected: $('btn-delete-selected'),
  inspPitchName: $('insp-pitch-name'),
  inspPitchFreq: $('insp-pitch-freq'),
  btnNoteUp: $('btn-note-up'),
  btnNoteDown: $('btn-note-down'),
  inspDotted: $('insp-dotted'),
  inspIsRest: $('insp-is-rest'),
  inspChord: $('insp-chord'),
  inspDynamic: $('insp-dynamic'),
  inspLyric: $('insp-lyric'),
  metaTitle: $('meta-title'),
  metaSubtitle: $('meta-subtitle'),
  metaComposer: $('meta-composer'),

  // OMR Panel
  omrClef: $('omr-clef'),
  omrKey: $('omr-key'),
  omrThreshold: $('omr-threshold'),
  omrThresholdVal: $('omr-threshold-val'),
  btnOmrScanPanel: $('btn-omr-scan-panel'),
  chkOmrOverlay: $('chk-omr-overlay'),
  omrResultBox: $('omr-result-box'),
  omrStats: $('omr-stats'),
  btnOmrApply: $('btn-omr-apply'),

  // Status & Toast
  statusKey: $('status-key'),
  statusCounts: $('status-counts'),
  statusHover: $('status-hover'),
  toast: $('toast'),
};

// --- Helpers ---
function showToast(msg, duration = 2800) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function findNoteById(noteId) {
  if (!noteId) return null;
  for (let mIdx = 0; mIdx < score.measures.length; mIdx++) {
    const notes = score.measures[mIdx].notes;
    for (let nIdx = 0; nIdx < notes.length; nIdx++) {
      if (notes[nIdx].id === noteId) {
        return { measure: score.measures[mIdx], measureIndex: mIdx, note: notes[nIdx], noteIndex: nIdx };
      }
    }
  }
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name, ext) {
  const base = (name || 'sheet-music').replace(/[^a-z0-9\-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'score';
  return `${base}.${ext}`;
}

// --- Populate Dropdowns ---
function populateSelects() {
  for (const k of KEY_SIGNATURES) {
    const opt1 = document.createElement('option');
    opt1.value = k.id;
    opt1.textContent = k.label;
    els.keySelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = k.id;
    opt2.textContent = `${k.id} (${k.fifths === 0 ? '0' : k.fifths > 0 ? `+${k.fifths}♯` : `${k.fifths}♭`})`;
    els.omrKey.appendChild(opt2);
  }

  for (const preset of INSTRUMENT_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    opt.title = preset.description;
    els.instrumentPreset.appendChild(opt);
  }
}

// --- Initialize Engines ---
const synth = new ScoreSynth();

const pdfViewer = new PdfSheetViewer(els.pdfStage, {
  onLoaded: ({ numPages, currentPage, chordsCount }) => {
    els.pdfPageIndicator.textContent = `${currentPage} / ${numPages}`;
    els.pdfChordsBadge.textContent = `${chordsCount} chord${chordsCount === 1 ? '' : 's'} detected`;
    els.pdfZoomReadout.textContent = `${Math.round(pdfViewer.zoom * 100)}%`;
  },
  onPageChange: ({ numPages, currentPage, chordsCount }) => {
    els.pdfPageIndicator.textContent = `${currentPage} / ${numPages}`;
    els.pdfChordsBadge.textContent = `${chordsCount} chord${chordsCount === 1 ? '' : 's'} detected`;
    els.pdfZoomReadout.textContent = `${Math.round(pdfViewer.zoom * 100)}%`;
  },
});

const engraver = new ScoreEngraver(els.scoreCanvasHost, {
  onSelectNote: (noteId) => {
    selectedNoteId = noteId;
    const found = findNoteById(noteId);
    if (found && !found.note.isRest && found.note.pitch) {
      synth.playPitch(found.note.pitch, 0.35);
    }
    syncUi();
  },

  onInsertNote: ({ measureIndex, isRest, pitch, relRatio }) => {
    const next = cloneScore(score);
    const measure = next.measures[measureIndex];
    if (!measure) return;

    const newNote = isRest
      ? createNote({ isRest: true, duration: activeDuration, dotted: activeDotted })
      : createNote({
          step: pitch.step,
          alter: pitch.alter,
          octave: pitch.octave,
          duration: activeDuration,
          dotted: activeDotted,
        });

    const insertIdx = Math.min(measure.notes.length, Math.round(relRatio * measure.notes.length));
    measure.notes.splice(insertIdx, 0, newNote);

    commitScore(next);
    selectedNoteId = newNote.id;
    if (!isRest && pitch) synth.playPitch(pitch, 0.35);
    syncUi();
  },

  onDeleteNote: (noteId) => {
    deleteNoteById(noteId);
  },

  onDragPitch: (noteId, newPitch) => {
    if (!dragOriginalScore) {
      dragOriginalScore = cloneScore(score);
    }
    const found = findNoteById(noteId);
    if (!found || found.note.isRest) return;
    found.note.pitch = newPitch;
    synth.playPitch(newPitch, 0.25);
    engraver.setState({ selectedNoteId });
    engraver.render(score);
    updateInspector();
  },

  onDragPitchEnd: () => {
    if (dragOriginalScore) {
      // Push pre-drag snapshot to history cleanly
      const finalScore = cloneScore(score);
      history.current = dragOriginalScore;
      history.push(finalScore);
      score = finalScore;
      dragOriginalScore = null;
      syncUi();
    }
  },

  onEditChord: (noteId) => {
    const found = findNoteById(noteId);
    if (!found) return;
    selectedNoteId = noteId;
    const val = window.prompt(
      'Enter chord symbol above this beat (leave blank to clear):',
      found.note.chord || ''
    );
    if (val !== null) {
      const next = cloneScore(score);
      next.measures[found.measureIndex].notes[found.noteIndex].chord = val.trim();
      commitScore(next);
    }
  },

  onHoverInfo: (info) => {
    if (info?.label) {
      els.statusHover.textContent = info.label;
    } else {
      els.statusHover.textContent = 'Ready — Drag notes vertically to change pitch, or switch to Note (N) to add';
    }
  },
});

// --- Score Mutation Helpers ---
function commitScore(nextScore, { pushHistory = true } = {}) {
  if (pushHistory) {
    history.push(nextScore);
  }
  score = cloneScore(nextScore);
  syncUi();
}

function deleteNoteById(noteId) {
  const found = findNoteById(noteId);
  if (!found) return;
  const next = cloneScore(score);
  next.measures[found.measureIndex].notes.splice(found.noteIndex, 1);
  if (selectedNoteId === noteId) selectedNoteId = null;
  commitScore(next);
}

function applyTransposition(deltaSemitones) {
  if (deltaSemitones === 0) return;
  const next = transposeScore(score, deltaSemitones, enharmonicPref);
  commitScore(next);
  syncPdfTransposition();
  const sign = next.transposeSemitones > 0 ? '+' : '';
  showToast(`Transposed to ${getKeyInfo(next.keySignature).label} (${sign}${next.transposeSemitones} st)`);
}

function applyTargetKey(targetKeyId) {
  if (targetKeyId === score.keySignature) return;
  const next = transposeScoreToKey(score, targetKeyId, enharmonicPref);
  commitScore(next);
  syncPdfTransposition();
  showToast(`Transposed to ${getKeyInfo(next.keySignature).label}`);
}

function syncPdfTransposition() {
  pdfViewer.setTransposition({
    semitones: score.transposeSemitones || 0,
    targetKeyId: score.keySignature,
    enharmonicPref,
    showTransposedChords: els.chkPdfTransposeChords.checked,
  });
}

async function renderScoreIntoPdfViewer(targetScore = score, filename = null) {
  const pdfBytes = generateScorePdf(targetScore, { embedMetadata: true });
  const label = filename || safeFilename(targetScore.title, 'pdf');
  els.pdfFilename.textContent = label;
  await pdfViewer.loadPdf(pdfBytes, { resetAnnotations: true });
  syncPdfTransposition();
}

// --- UI Synchronization ---
function syncUi() {
  engraver.setState({
    selectedNoteId,
    activeTool: activeScoreTool,
    activeDuration,
    activeDotted,
  });
  engraver.render(score);

  // Transposition ribbon
  els.keySelect.value = score.keySignature;
  const semi = score.transposeSemitones || 0;
  els.transposeReadout.textContent = `${semi > 0 ? '+' : ''}${semi} st`;
  els.transposeReadout.classList.toggle('is-transposed', semi !== 0);

  // Match instrument preset dropdown if applicable
  const matchingPreset = INSTRUMENT_PRESETS.find((p) => p.semitones === semi);
  els.instrumentPreset.value = matchingPreset ? matchingPreset.id : 'concert';

  // Tempo, Clef, Time Sig
  els.tempoInput.value = score.tempo || 110;
  els.clefSelect.value = score.clef || 'treble';
  els.timesigSelect.value = `${score.timeSignature.beats}/${score.timeSignature.beatType}`;

  // Undo / Redo buttons
  els.btnUndo.disabled = !history.canUndo();
  els.btnRedo.disabled = !history.canRedo();

  // Status bar
  const totalNotes = score.measures.reduce((sum, m) => sum + m.notes.length, 0);
  const keyLabel = getKeyInfo(score.keySignature).label.split(' / ')[0];
  const origLabel = getKeyInfo(score.originalKey || score.keySignature).label.split(' / ')[0];
  els.statusKey.textContent =
    semi === 0
      ? `Key: ${keyLabel} (Original)`
      : `Original: ${origLabel} → Transposed: ${keyLabel} (${semi > 0 ? '+' : ''}${semi} st)`;
  els.statusCounts.textContent = `${score.measures.length} measure${score.measures.length === 1 ? '' : 's'} • ${totalNotes} event${totalNotes === 1 ? '' : 's'}`;

  updateInspector();
  syncPdfTransposition();
}

function updateInspector() {
  // Score metadata fields
  if (document.activeElement !== els.metaTitle) els.metaTitle.value = score.title || '';
  if (document.activeElement !== els.metaSubtitle) els.metaSubtitle.value = score.subtitle || '';
  if (document.activeElement !== els.metaComposer) els.metaComposer.value = score.composer || '';

  const found = findNoteById(selectedNoteId);
  if (!found) {
    els.inspNoteSection.hidden = true;
    return;
  }

  const { note } = found;
  els.inspNoteSection.hidden = false;

  if (note.isRest || !note.pitch) {
    els.inspPitchName.textContent = 'Rest';
    els.inspPitchFreq.textContent = `Duration: ${note.duration}${note.dotted ? '.' : ''}`;
  } else {
    const midi = pitchToMidi(note.pitch);
    const freq = midiToFreq(midi).toFixed(2);
    els.inspPitchName.textContent = formatPitch(note.pitch);
    els.inspPitchFreq.textContent = `${freq} Hz • MIDI ${midi}`;
  }

  // Accidental buttons
  document.querySelectorAll('[data-acc]').forEach((btn) => {
    const val = Number(btn.getAttribute('data-acc'));
    btn.classList.toggle('is-active', !note.isRest && note.pitch && (note.pitch.alter || 0) === val);
  });

  // Duration buttons
  document.querySelectorAll('[data-insp-dur]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-insp-dur') === note.duration);
  });

  els.inspDotted.checked = Boolean(note.dotted);
  els.inspIsRest.checked = Boolean(note.isRest);
  if (document.activeElement !== els.inspChord) els.inspChord.value = note.chord || '';
  els.inspDynamic.value = note.dynamic || '';
  if (document.activeElement !== els.inspLyric) els.inspLyric.value = note.lyric || '';
}

function updatePlayButton(playing) {
  els.btnPlay.classList.toggle('is-playing', playing);
  els.iconPlay.hidden = playing;
  els.iconStop.hidden = !playing;
  els.playLabel.textContent = playing ? 'Stop' : 'Play';
}

// --- OMR Scanning Workflow ---
function runOmrScan() {
  if (!pdfViewer.pdfDoc) {
    showToast('Open a PDF sheet music file first.');
    return;
  }
  const { imageData, scaledChords } = pdfViewer.getScanPayload();
  const clef = els.omrClef.value;
  const keySig = els.omrKey.value;
  const threshold = Number(els.omrThreshold.value);
  const [beats, beatType] = els.timesigSelect.value.split('/').map(Number);

  const result = scanSheetMusicImage(imageData, {
    clef,
    keySignature: keySig,
    timeSignature: { beats: beats || 4, beatType: beatType || 4 },
    threshold,
    detectedChords: scaledChords,
    title: els.pdfFilename.textContent.replace(/\.pdf$/i, '') || 'Scanned PDF Score',
  });

  lastOmrResult = result;
  els.chkOmrOverlay.checked = true;
  pdfViewer.setOmrOverlay(result, true);

  els.omrResultBox.hidden = false;
  els.omrStats.innerHTML = [
    `Staves found: <strong>${result.staves.length}</strong>`,
    `Barlines: <strong>${result.barlines.length}</strong>`,
    `Notes recognized: <strong>${result.notes.length}</strong>`,
    `PDF Chords matched: <strong>${result.notes.filter((n) => n.chord).length}</strong>`,
  ].join('<br/>');

  els.btnOmrApply.disabled = !result.score;

  if (result.score) {
    showToast(`Scanned ${result.notes.length} notes across ${result.staves.length} staves — click "Load Scanned Score" to edit!`);
  } else {
    showToast('No standard 5-line staves detected. Try adjusting Ink Sensitivity or zooming in.');
  }
}

// --- File Loading (PDF & MusicXML) ---
async function handleOpenFile(file) {
  if (!file) return;
  const nameLower = file.name.toLowerCase();

  if (nameLower.endsWith('.xml') || nameLower.endsWith('.musicxml')) {
    try {
      const text = await file.text();
      const imported = importMusicXml(text);
      selectedNoteId = null;
      history.reset(imported);
      score = cloneScore(imported);
      syncUi();
      await renderScoreIntoPdfViewer(score, safeFilename(score.title, 'pdf'));
      showToast(`Imported MusicXML: "${score.title}" (${score.measures.length} measures)`);
    } catch (err) {
      showToast(`Could not parse MusicXML: ${err.message}`);
    }
    return;
  }

  if (nameLower.endsWith('.pdf') || file.type === 'application/pdf') {
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      els.pdfFilename.textContent = file.name;
      await pdfViewer.loadPdf(bytes, { resetAnnotations: true });

      // Check if this PDF carries lossless Cadence embedded score metadata
      const embedded = extractEmbeddedScoreFromPdfBytes(bytes);
      if (embedded) {
        selectedNoteId = null;
        history.reset(embedded);
        score = cloneScore(embedded);
        syncUi();
        showToast(`Opened "${file.name}" with lossless editable score restored!`);
      } else {
        // External PDF: reset transposition offset for PDF overlay & auto-run OMR preview
        els.omrResultBox.hidden = true;
        lastOmrResult = null;
        showToast(`Opened "${file.name}" (${pdfViewer.numPages} page${pdfViewer.numPages === 1 ? '' : 's'}) — click "Scan PDF → Score" to convert to editable notation!`);
      }
    } catch (err) {
      console.error(err);
      showToast(`Failed to open PDF: ${err.message}`);
    }
    return;
  }

  showToast('Please select a .pdf, .musicxml, or .xml file.');
}

// --- Event Listeners ---
function bindEvents() {
  // View mode switcher
  document.querySelectorAll('.view-switcher .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      els.studioMain.setAttribute('data-view', mode);
      document.querySelectorAll('.view-switcher .seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  // Sample score picker
  els.sampleSelect.addEventListener('change', async () => {
    const chosen = samples.find((s) => s.id === els.sampleSelect.value) || samples[0];
    synth.stop();
    selectedNoteId = null;
    const fresh = cloneScore(chosen);
    history.reset(fresh);
    score = fresh;
    els.omrClef.value = score.clef;
    els.omrKey.value = score.keySignature;
    els.omrResultBox.hidden = true;
    lastOmrResult = null;
    syncUi();
    await renderScoreIntoPdfViewer(score, safeFilename(score.title, 'pdf'));
    showToast(`Loaded "${score.title}"`);
  });

  // File Open & Drag-and-Drop
  els.btnOpenFile.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleOpenFile(file);
    els.fileInput.value = '';
  });

  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      els.pdfDropOverlay.hidden = false;
    }
  });
  document.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) els.pdfDropOverlay.hidden = true;
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    els.pdfDropOverlay.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) handleOpenFile(file);
  });

  // Exports & Print
  els.btnExportPdf.addEventListener('click', () => {
    const bytes = generateScorePdf(score, { embedMetadata: true });
    const suffix = score.transposeSemitones ? `_${score.keySignature}` : '';
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), safeFilename(`${score.title}${suffix}`, 'pdf'));
    showToast('Exported crisp vector PDF sheet music!');
  });

  els.btnExportXml.addEventListener('click', () => {
    const xml = exportMusicXml(score);
    downloadBlob(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }), safeFilename(score.title, 'musicxml'));
    showToast('Exported MusicXML 3.1 file!');
  });

  els.btnPrint.addEventListener('click', () => window.print());

  // Theme & Inspector toggle
  els.btnTheme.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  els.btnToggleInspector.addEventListener('click', () => {
    const collapsed = els.inspectorDrawer.classList.toggle('is-collapsed');
    els.btnToggleInspector.classList.toggle('is-active', !collapsed);
  });

  // Transposition Controls
  els.keySelect.addEventListener('change', () => applyTargetKey(els.keySelect.value));
  els.btnSemiDown.addEventListener('click', () => applyTransposition(-1));
  els.btnSemiUp.addEventListener('click', () => applyTransposition(1));
  els.btnOctDown.addEventListener('click', () => applyTransposition(-12));
  els.btnOctUp.addEventListener('click', () => applyTransposition(12));

  els.btnTransposeReset.addEventListener('click', () => {
    const currentShift = score.transposeSemitones || 0;
    if (currentShift === 0) return;
    const next = transposeScore(score, -currentShift, enharmonicPref, score.originalKey || undefined);
    next.transposeSemitones = 0;
    commitScore(next);
    showToast(`Reset to original key (${getKeyInfo(next.keySignature).label})`);
  });

  els.instrumentPreset.addEventListener('change', () => {
    const preset = INSTRUMENT_PRESETS.find((p) => p.id === els.instrumentPreset.value);
    if (!preset) return;
    const delta = preset.semitones - (score.transposeSemitones || 0);
    if (delta !== 0) {
      applyTransposition(delta);
    }
  });

  document.querySelectorAll('[data-enh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      enharmonicPref = btn.getAttribute('data-enh');
      document.querySelectorAll('[data-enh]').forEach((b) => b.classList.toggle('is-active', b === btn));
      // Re-spell notes in place using new preference
      const next = transposeScore(score, 0, enharmonicPref, score.keySignature);
      for (const m of next.measures) {
        for (const n of m.notes) {
          if (!n.isRest && n.pitch) {
            n.pitch = midiToPitch(pitchToMidi(n.pitch), next.keySignature, enharmonicPref);
          }
        }
      }
      commitScore(next);
    });
  });

  // Playback Controls
  els.btnPlay.addEventListener('click', () => {
    if (synth.isPlaying) {
      synth.stop();
      return;
    }
    updatePlayButton(true);
    synth.playScore(score, {
      onNotePlay: (noteId) => {
        engraver.setState({ playingNoteId: noteId });
        engraver.render(score);
      },
      onStop: () => {
        updatePlayButton(false);
        engraver.setState({ playingNoteId: null });
        engraver.render(score);
      },
    });
  });

  els.tempoInput.addEventListener('change', () => {
    const bpm = Math.max(40, Math.min(240, Number(els.tempoInput.value) || 110));
    const next = cloneScore(score);
    next.tempo = bpm;
    commitScore(next);
  });

  els.synthInstrument.addEventListener('change', () => {
    synth.instrument = els.synthInstrument.value;
  });

  els.btnChordsAudio.addEventListener('click', () => {
    synth.accompaniment = !synth.accompaniment;
    els.btnChordsAudio.classList.toggle('is-active', synth.accompaniment);
  });

  els.btnMetronome.addEventListener('click', () => {
    synth.metronome = !synth.metronome;
    els.btnMetronome.classList.toggle('is-active', synth.metronome);
  });

  els.btnLoop.addEventListener('click', () => {
    synth.loop = !synth.loop;
    els.btnLoop.classList.toggle('is-active', synth.loop);
  });

  // Left Tool Rail: Score Tools
  document.querySelectorAll('[data-score-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeScoreTool = btn.getAttribute('data-score-tool');
      document.querySelectorAll('[data-score-tool]').forEach((b) => b.classList.toggle('is-active', b === btn));
      engraver.setState({ activeTool: activeScoreTool });
    });
  });

  document.querySelectorAll('[data-dur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeDuration = btn.getAttribute('data-dur');
      document.querySelectorAll('[data-dur]').forEach((b) => b.classList.toggle('is-active', b === btn));
      engraver.setState({ activeDuration });

      // Also apply immediately if a note is selected
      const found = findNoteById(selectedNoteId);
      if (found) {
        const next = cloneScore(score);
        next.measures[found.measureIndex].notes[found.noteIndex].duration = activeDuration;
        commitScore(next);
      }
    });
  });

  els.btnDotToggle.addEventListener('click', () => {
    activeDotted = !activeDotted;
    els.btnDotToggle.classList.toggle('is-active', activeDotted);
    engraver.setState({ activeDotted });
    const found = findNoteById(selectedNoteId);
    if (found) {
      const next = cloneScore(score);
      next.measures[found.measureIndex].notes[found.noteIndex].dotted = activeDotted;
      commitScore(next);
    }
  });

  els.btnAddMeasure.addEventListener('click', () => {
    const next = cloneScore(score);
    next.measures.push(createMeasure([createNote({ isRest: true, duration: 'w' })]));
    commitScore(next);
    showToast(`Added Measure ${next.measures.length}`);
  });

  els.btnDelMeasure.addEventListener('click', () => {
    if (score.measures.length <= 1) return;
    const next = cloneScore(score);
    next.measures.pop();
    commitScore(next);
  });

  els.btnUndo.addEventListener('click', () => {
    const prev = history.undo();
    if (prev) {
      score = prev;
      selectedNoteId = null;
      syncUi();
    }
  });

  els.btnRedo.addEventListener('click', () => {
    const nxt = history.redo();
    if (nxt) {
      score = nxt;
      selectedNoteId = null;
      syncUi();
    }
  });

  // Left Tool Rail: PDF Markup Tools
  document.querySelectorAll('[data-pdf-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-pdf-tool');
      document.querySelectorAll('[data-pdf-tool]').forEach((b) => b.classList.toggle('is-active', b === btn));
      pdfViewer.setTool(tool);
    });
  });

  els.btnPdfUndoMark.addEventListener('click', () => pdfViewer.undoAnnotation());
  els.btnPdfClearMarks.addEventListener('click', () => pdfViewer.clearPageAnnotations());

  // PDF Pane Controls
  els.btnPdfPrev.addEventListener('click', () => pdfViewer.renderPage(pdfViewer.currentPage - 1));
  els.btnPdfNext.addEventListener('click', () => pdfViewer.renderPage(pdfViewer.currentPage + 1));
  els.btnPdfZoomOut.addEventListener('click', async () => {
    const z = await pdfViewer.setZoom(pdfViewer.zoom - 0.15);
    els.pdfZoomReadout.textContent = `${Math.round(z * 100)}%`;
  });
  els.btnPdfZoomIn.addEventListener('click', async () => {
    const z = await pdfViewer.setZoom(pdfViewer.zoom + 0.15);
    els.pdfZoomReadout.textContent = `${Math.round(z * 100)}%`;
  });
  els.btnPdfFit.addEventListener('click', async () => {
    const z = await pdfViewer.fitWidth();
    els.pdfZoomReadout.textContent = `${Math.round(z * 100)}%`;
  });

  els.chkPdfTransposeChords.addEventListener('change', syncPdfTransposition);

  els.btnSyncPdf.addEventListener('click', async () => {
    await renderScoreIntoPdfViewer(score, safeFilename(score.title, 'pdf'));
    showToast('PDF updated with your latest edits and transposition!');
  });

  els.btnRunOmr.addEventListener('click', () => {
    els.inspectorDrawer.classList.remove('is-collapsed');
    els.btnToggleInspector.classList.add('is-active');
    runOmrScan();
  });

  // Editor Clef & Time Signature
  els.clefSelect.addEventListener('change', () => {
    const next = cloneScore(score);
    next.clef = els.clefSelect.value;
    commitScore(next);
  });

  els.timesigSelect.addEventListener('change', () => {
    const [beats, beatType] = els.timesigSelect.value.split('/').map(Number);
    const next = cloneScore(score);
    next.timeSignature = { beats, beatType };
    commitScore(next);
  });

  // Selected Note Inspector
  els.btnDeleteSelected.addEventListener('click', () => {
    if (selectedNoteId) deleteNoteById(selectedNoteId);
  });

  const nudgeSelected = (semi) => {
    const found = findNoteById(selectedNoteId);
    if (!found || found.note.isRest || !found.note.pitch) return;
    const next = cloneScore(score);
    const target = next.measures[found.measureIndex].notes[found.noteIndex];
    target.pitch = midiToPitch(pitchToMidi(target.pitch) + semi, score.keySignature, enharmonicPref);
    synth.playPitch(target.pitch, 0.3);
    commitScore(next);
  };

  els.btnNoteUp.addEventListener('click', () => nudgeSelected(1));
  els.btnNoteDown.addEventListener('click', () => nudgeSelected(-1));

  document.querySelectorAll('[data-acc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findNoteById(selectedNoteId);
      if (!found || found.note.isRest || !found.note.pitch) return;
      const next = cloneScore(score);
      const target = next.measures[found.measureIndex].notes[found.noteIndex];
      target.pitch.alter = Number(btn.getAttribute('data-acc'));
      synth.playPitch(target.pitch, 0.3);
      commitScore(next);
    });
  });

  document.querySelectorAll('[data-insp-dur]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const found = findNoteById(selectedNoteId);
      if (!found) return;
      const next = cloneScore(score);
      next.measures[found.measureIndex].notes[found.noteIndex].duration = btn.getAttribute('data-insp-dur');
      commitScore(next);
    });
  });

  els.inspDotted.addEventListener('change', () => {
    const found = findNoteById(selectedNoteId);
    if (!found) return;
    const next = cloneScore(score);
    next.measures[found.measureIndex].notes[found.noteIndex].dotted = els.inspDotted.checked;
    commitScore(next);
  });

  els.inspIsRest.addEventListener('change', () => {
    const found = findNoteById(selectedNoteId);
    if (!found) return;
    const next = cloneScore(score);
    const target = next.measures[found.measureIndex].notes[found.noteIndex];
    target.isRest = els.inspIsRest.checked;
    if (!target.isRest && !target.pitch) {
      target.pitch = { step: score.clef === 'bass' ? 'D' : 'B', alter: 0, octave: score.clef === 'bass' ? 3 : 4 };
    }
    commitScore(next);
  });

  els.inspChord.addEventListener('change', () => {
    const found = findNoteById(selectedNoteId);
    if (!found) return;
    const next = cloneScore(score);
    next.measures[found.measureIndex].notes[found.noteIndex].chord = els.inspChord.value.trim();
    commitScore(next);
  });

  els.inspDynamic.addEventListener('change', () => {
    const found = findNoteById(selectedNoteId);
    if (!found) return;
    const next = cloneScore(score);
    next.measures[found.measureIndex].notes[found.noteIndex].dynamic = els.inspDynamic.value;
    commitScore(next);
  });

  els.inspLyric.addEventListener('change', () => {
    const found = findNoteById(selectedNoteId);
    if (!found) return;
    const next = cloneScore(score);
    next.measures[found.measureIndex].notes[found.noteIndex].lyric = els.inspLyric.value;
    commitScore(next);
  });

  // Score Metadata Inputs
  const bindMeta = (inputEl, field) => {
    inputEl.addEventListener('input', () => {
      score[field] = inputEl.value;
      engraver.render(score);
    });
    inputEl.addEventListener('change', () => {
      const next = cloneScore(score);
      next[field] = inputEl.value;
      commitScore(next);
    });
  };
  bindMeta(els.metaTitle, 'title');
  bindMeta(els.metaSubtitle, 'subtitle');
  bindMeta(els.metaComposer, 'composer');

  // OMR Panel Controls
  els.omrThreshold.addEventListener('input', () => {
    els.omrThresholdVal.textContent = els.omrThreshold.value;
  });

  els.btnOmrScanPanel.addEventListener('click', runOmrScan);

  els.chkOmrOverlay.addEventListener('change', () => {
    pdfViewer.setOmrOverlay(lastOmrResult, els.chkOmrOverlay.checked);
  });

  els.btnOmrApply.addEventListener('click', () => {
    if (!lastOmrResult?.score) return;
    const scanned = cloneScore(lastOmrResult.score);
    selectedNoteId = null;
    commitScore(scanned);
    // Ensure editor is visible
    if (els.studioMain.getAttribute('data-view') === 'pdf') {
      els.studioMain.setAttribute('data-view', 'split');
      document.querySelectorAll('.view-switcher .seg-btn').forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-mode') === 'split')
      );
    }
    showToast(`Loaded ${lastOmrResult.notes.length} scanned notes into Score Editor — ready to edit & transpose!`);
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) els.btnRedo.click();
      else els.btnUndo.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      els.btnRedo.click();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      els.btnPlay.click();
      return;
    }

    const k = e.key.toLowerCase();
    const toolMap = { v: 'select', n: 'note', r: 'rest', c: 'chord', e: 'erase' };
    if (toolMap[k]) {
      document.querySelector(`[data-score-tool="${toolMap[k]}"]`)?.click();
      return;
    }

    const durMap = { '1': 'w', '2': 'h', '3': 'q', '4': '8', '5': '16' };
    if (durMap[k]) {
      document.querySelector(`[data-dur="${durMap[k]}"]`)?.click();
      return;
    }
    if (e.key === '.') {
      els.btnDotToggle.click();
      return;
    }

    if (selectedNoteId) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        nudgeSelected(e.shiftKey ? 12 : 1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        nudgeSelected(e.shiftKey ? -12 : -1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNoteById(selectedNoteId);
      }
    }
  });
}

// --- Boot Studio ---
async function init() {
  populateSelects();
  bindEvents();
  els.omrClef.value = score.clef;
  els.omrKey.value = score.keySignature;
  syncUi();

  // Generate & render the initial real vector PDF sheet music inside the PDF.js viewer
  await renderScoreIntoPdfViewer(score, 'Ode_to_Joy.pdf');
  await pdfViewer.fitWidth();
}

init().catch((err) => {
  console.error('Cadence initialization error:', err);
  showToast(`Startup error: ${err.message}`);
});
