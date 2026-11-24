import { describe, it, expect } from 'vitest';
import {
  pitchToMidi,
  midiToPitch,
  pitchToStaffPos,
  staffPosToPitch,
  transposeKeyId,
  transposeChord,
  isLikelyChordSymbol,
  semitonesBetweenKeys,
} from '../music/theory.js';
import {
  getSampleScores,
  transposeScore,
  transposeScoreToKey,
  ScoreHistory,
} from '../music/scoreModel.js';
import { generateScorePdf, extractEmbeddedScoreFromPdfBytes } from '../pdf/pdfExporter.js';
import { exportMusicXml } from '../io/musicXml.js';
import { scanSheetMusicImage } from '../pdf/omrScanner.js';

describe('Music Theory & Transposition Engine', () => {
  it('converts pitches to MIDI and spells enharmonics accurately per target key', () => {
    expect(pitchToMidi({ step: 'C', alter: 0, octave: 4 })).toBe(60);
    expect(pitchToMidi({ step: 'A', alter: 0, octave: 4 })).toBe(69);
    expect(pitchToMidi({ step: 'F', alter: 1, octave: 4 })).toBe(66);

    // MIDI 70 in F Major must spell Bb4 (not A#4)
    expect(midiToPitch(70, 'F')).toEqual({ step: 'B', alter: -1, octave: 4 });
    // MIDI 66 in D Major must spell F#4 (not Gb4)
    expect(midiToPitch(66, 'D')).toEqual({ step: 'F', alter: 1, octave: 4 });
    // MIDI 63 in Eb Major must spell Eb4
    expect(midiToPitch(63, 'Eb')).toEqual({ step: 'E', alter: -1, octave: 4 });
  });

  it('round-trips staff positions accurately on Treble and Bass clefs', () => {
    // Treble bottom line = E4 (pos 0), top line = F5 (pos 8)
    expect(pitchToStaffPos({ step: 'E', alter: 0, octave: 4 }, 'treble')).toBe(0);
    expect(pitchToStaffPos({ step: 'F', alter: 0, octave: 5 }, 'treble')).toBe(8);
    expect(staffPosToPitch(0, 'treble', 'C')).toEqual({ step: 'E', alter: 0, octave: 4 });
    expect(staffPosToPitch(8, 'treble', 'G')).toEqual({ step: 'F', alter: 1, octave: 5 });

    // Bass bottom line = G2 (pos 0), middle line = D3 (pos 4)
    expect(pitchToStaffPos({ step: 'G', alter: 0, octave: 2 }, 'bass')).toBe(0);
    expect(pitchToStaffPos({ step: 'D', alter: 0, octave: 3 }, 'bass')).toBe(4);
    expect(staffPosToPitch(2, 'bass', 'F')).toEqual({ step: 'B', alter: -1, octave: 2 });
  });

  it('transposes key signatures and complex slash/jazz chord symbols cleanly', () => {
    expect(transposeKeyId('C', 2)).toBe('D');
    expect(transposeKeyId('C', 3)).toBe('Eb');
    expect(transposeKeyId('D', -2)).toBe('C');
    expect(semitonesBetweenKeys('C', 'Eb')).toBe(3);
    expect(semitonesBetweenKeys('D', 'C')).toBe(-2);

    expect(transposeChord('Cmaj7/G', 2, 'D')).toBe('Dmaj7/A');
    expect(transposeChord('Am7b5', 3, 'Eb')).toBe('Cm7b5');
    expect(transposeChord('D7(#9)', -2, 'C')).toBe('C7(#9)');
    expect(transposeChord('F#m7', 1, 'G')).toBe('Gm7');
    expect(transposeChord('N.C.', 5, 'F')).toBe('N.C.');

    expect(isLikelyChordSymbol('Bbmaj7')).toBe(true);
    expect(isLikelyChordSymbol('D/F#')).toBe(true);
    expect(isLikelyChordSymbol('Hello')).toBe(false);
    expect(isLikelyChordSymbol('A')).toBe(false);
  });
});

describe('Score Model & History', () => {
  it('transposes full scores and preserves exact pitches on round-trip', () => {
    const ode = getSampleScores()[0]; // D Major
    const origMidis = ode.measures.flatMap((m) => m.notes.map((n) => pitchToMidi(n.pitch)));

    const up = transposeScore(ode, 3); // D -> F Major
    expect(up.keySignature).toBe('F');
    expect(up.transposeSemitones).toBe(3);
    expect(up.measures[0].notes[0].chord).toBe('F');

    const back = transposeScoreToKey(up, 'D');
    const backMidis = back.measures.flatMap((m) => m.notes.map((n) => pitchToMidi(n.pitch)));
    expect(backMidis).toEqual(origMidis);
  });

  it('supports undo and redo snapshots', () => {
    const initial = getSampleScores()[0];
    const hist = new ScoreHistory(initial);
    const transposed = transposeScore(initial, 2);
    hist.push(transposed);
    expect(hist.canUndo()).toBe(true);
    expect(hist.undo().keySignature).toBe('D');
    expect(hist.canRedo()).toBe(true);
    expect(hist.redo().keySignature).toBe('E');
  });
});

describe('Vector PDF Generator & MusicXML Exporter', () => {
  it('generates a valid PDF 1.4 binary and round-trips embedded score metadata', () => {
    const jazz = getSampleScores()[1];
    const pdfBytes = generateScorePdf(jazz, { embedMetadata: true });
    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(1500);

    const text = new TextDecoder('latin1').decode(pdfBytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.includes('xref')).toBe(true);
    expect(text.trim().endsWith('%%EOF')).toBe(true);
    expect(text.includes('(Cm7) Tj')).toBe(true);

    const restored = extractEmbeddedScoreFromPdfBytes(pdfBytes);
    expect(restored).not.toBeNull();
    expect(restored.title).toBe(jazz.title);
    expect(restored.measures.length).toBe(jazz.measures.length);
  });

  it('exports valid MusicXML 3.1 markup', () => {
    const ode = getSampleScores()[0];
    const xml = exportMusicXml(ode);
    expect(xml).toContain('<score-partwise version="3.1">');
    expect(xml).toContain('<work-title>Ode to Joy</work-title>');
    expect(xml).toContain('<fifths>2</fifths>');
    expect(xml).toContain('<harmony>');
  });
});

describe('Optical Music Recognition (OMR) Scanner', () => {
  it('detects a 5-line staff, barline, and notehead pitches from raw RGBA pixels', () => {
    const width = 600;
    const height = 220;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);

    const setDark = (x, y) => {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const idx = (y * width + x) * 4;
      data[idx] = 20;
      data[idx + 1] = 20;
      data[idx + 2] = 20;
      data[idx + 3] = 255;
    };

    const s = 12; // staff space = 12px
    const topY = 80;
    const bottomY = topY + 4 * s; // 128

    // Draw 5 staff lines (thickness 2px) from x=40 to x=560
    for (let l = 0; l < 5; l++) {
      const ly = topY + l * s;
      for (let x = 40; x <= 560; x++) {
        setDark(x, ly);
        setDark(x, ly + 1);
      }
    }

    // Draw vertical barline at x=330
    for (let y = topY; y <= bottomY; y++) {
      setDark(330, y);
      setDark(331, y);
    }

    // Draw 4 filled noteheads (rx=6, ry=4.5) at known treble staff positions:
    // pos 0 (E4), pos 2 (G4), pos 4 (B4), pos 6 (D5)
    const testNotes = [
      { x: 180, pos: 0, expected: 'E4' },
      { x: 250, pos: 2, expected: 'G4' },
      { x: 400, pos: 4, expected: 'B4' },
      { x: 470, pos: 6, expected: 'D5' },
    ];

    for (const tn of testNotes) {
      const cy = bottomY - tn.pos * (s / 2);
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -7; dx <= 7; dx++) {
          if ((dx * dx) / 42 + (dy * dy) / 20 <= 1) {
            setDark(Math.round(tn.x + dx), Math.round(cy + dy));
          }
        }
      }
    }

    const result = scanSheetMusicImage(
      { width, height, data },
      { clef: 'treble', keySignature: 'C', threshold: 175 }
    );

    expect(result.staves.length).toBe(1);
    expect(result.barlines.length).toBeGreaterThanOrEqual(1);
    expect(result.notes.length).toBe(4);
    expect(result.notes.map((n) => n.pitchLabel)).toEqual(['E4', 'G4', 'B4', 'D5']);
    expect(result.score.measures.length).toBe(2);
  });
});
