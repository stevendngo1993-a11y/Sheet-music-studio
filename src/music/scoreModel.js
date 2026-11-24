/**
 * Score Data Model, Transposition Operations, Undo/Redo History & Sample Scores
 */

import {
  DURATION_BEATS,
  transposeKeyId,
  transposePitch,
  transposeChord,
  semitonesBetweenKeys,
} from './theory.js';

let _uid = 1;
export function nextId(prefix = 'n') {
  return `${prefix}_${Date.now().toString(36)}_${(_uid++).toString(36)}`;
}

export function noteBeats(note) {
  const base = DURATION_BEATS[note.duration] ?? 1;
  return note.dotted ? base * 1.5 : base;
}

export function measureCapacity(timeSignature = { beats: 4, beatType: 4 }) {
  return (timeSignature.beats * 4) / timeSignature.beatType;
}

export function measureUsedBeats(measure) {
  return measure.notes.reduce((sum, n) => sum + noteBeats(n), 0);
}

export function cloneScore(score) {
  return JSON.parse(JSON.stringify(score));
}

export function createNote({
  step = 'C',
  alter = 0,
  octave = 4,
  duration = 'q',
  dotted = false,
  isRest = false,
  chord = '',
  dynamic = '',
  lyric = '',
} = {}) {
  return {
    id: nextId('note'),
    isRest,
    pitch: isRest ? null : { step, alter, octave },
    duration,
    dotted,
    chord,
    dynamic,
    lyric,
  };
}

export function createMeasure(notes = []) {
  return {
    id: nextId('m'),
    notes,
  };
}

/**
 * Returns a brand-new transposed copy of `score` shifted by `deltaSemitones`.
 * Updates key signature, every note's pitch with music-theory-accurate spelling,
 * and every chord symbol.
 */
export function transposeScore(score, deltaSemitones, enharmonicPref = 'auto', explicitTargetKey = null) {
  const next = cloneScore(score);
  if (deltaSemitones === 0 && !explicitTargetKey) return next;

  const targetKey = explicitTargetKey || transposeKeyId(next.keySignature, deltaSemitones, enharmonicPref);
  next.keySignature = targetKey;
  next.transposeSemitones = (next.transposeSemitones || 0) + deltaSemitones;

  for (const measure of next.measures) {
    for (const note of measure.notes) {
      if (!note.isRest && note.pitch) {
        note.pitch = transposePitch(note.pitch, deltaSemitones, targetKey, enharmonicPref);
      }
      if (note.chord) {
        note.chord = transposeChord(note.chord, deltaSemitones, targetKey, enharmonicPref);
      }
    }
  }
  return next;
}

/**
 * Transposes score directly to a chosen target key (shortest interval).
 */
export function transposeScoreToKey(score, targetKeyId, enharmonicPref = 'auto') {
  const delta = semitonesBetweenKeys(score.keySignature, targetKeyId);
  return transposeScore(score, delta, enharmonicPref, targetKeyId);
}

/**
 * Simple snapshot-based Undo / Redo manager.
 */
export class ScoreHistory {
  constructor(initialScore, limit = 60) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.current = cloneScore(initialScore);
  }

  push(nextScore) {
    this.undoStack.push(cloneScore(this.current));
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.current = cloneScore(nextScore);
    return this.current;
  }

  reset(newScore) {
    this.undoStack = [];
    this.redoStack = [];
    this.current = cloneScore(newScore);
    return this.current;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.redoStack.push(cloneScore(this.current));
    this.current = this.undoStack.pop();
    return cloneScore(this.current);
  }

  redo() {
    if (!this.canRedo()) return null;
    this.undoStack.push(cloneScore(this.current));
    this.current = this.redoStack.pop();
    return cloneScore(this.current);
  }
}

// --- Built-in Sample Scores ---

function n(step, alter, octave, duration = 'q', opts = {}) {
  return createNote({ step, alter, octave, duration, ...opts });
}

function r(duration = 'q', opts = {}) {
  return createNote({ isRest: true, duration, ...opts });
}

export function getSampleScores() {
  return [
    {
      id: 'ode-to-joy',
      title: 'Ode to Joy',
      subtitle: 'From Symphony No. 9, Op. 125',
      composer: 'Ludwig van Beethoven',
      keySignature: 'D',
      originalKey: 'D',
      transposeSemitones: 0,
      timeSignature: { beats: 4, beatType: 4 },
      clef: 'treble',
      tempo: 112,
      measures: [
        createMeasure([
          n('F', 1, 4, 'q', { chord: 'D', dynamic: 'mf', lyric: 'Freu-' }),
          n('F', 1, 4, 'q', { lyric: 'de,' }),
          n('G', 0, 4, 'q', { chord: 'A7', lyric: 'schö-' }),
          n('A', 0, 4, 'q', { lyric: 'ner' }),
        ]),
        createMeasure([
          n('A', 0, 4, 'q', { chord: 'D', lyric: 'Göt-' }),
          n('G', 0, 4, 'q', { lyric: 'ter-' }),
          n('F', 1, 4, 'q', { chord: 'A7', lyric: 'fun-' }),
          n('E', 0, 4, 'q', { lyric: 'ken,' }),
        ]),
        createMeasure([
          n('D', 0, 4, 'q', { chord: 'D', lyric: 'Toch-' }),
          n('D', 0, 4, 'q', { lyric: 'ter' }),
          n('E', 0, 4, 'q', { chord: 'A7', lyric: 'aus' }),
          n('F', 1, 4, 'q', { lyric: 'E-' }),
        ]),
        createMeasure([
          n('F', 1, 4, 'q', { dotted: true, chord: 'D', lyric: 'ly-' }),
          n('E', 0, 4, '8', { lyric: 'si-' }),
          n('E', 0, 4, 'h', { chord: 'A7', lyric: 'um!' }),
        ]),
        createMeasure([
          n('F', 1, 4, 'q', { chord: 'D', dynamic: 'f', lyric: 'Wir' }),
          n('F', 1, 4, 'q', { lyric: 'be-' }),
          n('G', 0, 4, 'q', { chord: 'G', lyric: 'tre-' }),
          n('A', 0, 4, 'q', { lyric: 'ten' }),
        ]),
        createMeasure([
          n('A', 0, 4, 'q', { chord: 'D/F#', lyric: 'feu-' }),
          n('G', 0, 4, 'q', { lyric: 'er-' }),
          n('F', 1, 4, 'q', { chord: 'Em7', lyric: 'trun-' }),
          n('E', 0, 4, 'q', { chord: 'A7', lyric: 'ken,' }),
        ]),
        createMeasure([
          n('D', 0, 4, 'q', { chord: 'Bm', lyric: 'Himm-' }),
          n('D', 0, 4, 'q', { lyric: 'li-' }),
          n('E', 0, 4, 'q', { chord: 'Em', lyric: 'sche,' }),
          n('F', 1, 4, 'q', { chord: 'A7', lyric: 'dein' }),
        ]),
        createMeasure([
          n('E', 0, 4, 'q', { dotted: true, chord: 'A7', lyric: 'Hei-' }),
          n('D', 0, 4, '8', { lyric: 'lig-' }),
          n('D', 0, 4, 'h', { chord: 'D', lyric: 'tum.' }),
        ]),
      ],
    },
    {
      id: 'autumn-jazz',
      title: 'Autumn Cadence',
      subtitle: 'Jazz Lead Sheet in G Minor (B♭ Key Sig)',
      composer: 'Standard Arrangement',
      keySignature: 'Bb',
      originalKey: 'Bb',
      transposeSemitones: 0,
      timeSignature: { beats: 4, beatType: 4 },
      clef: 'treble',
      tempo: 118,
      measures: [
        createMeasure([
          r('q', { dynamic: 'mp' }),
          n('G', 0, 4, 'q'),
          n('A', 0, 4, 'q'),
          n('B', -1, 4, 'q'),
        ]),
        createMeasure([
          n('E', -1, 5, 'h', { dotted: true, chord: 'Cm7' }),
          n('F', 0, 4, 'q'),
        ]),
        createMeasure([
          n('F', 0, 4, 'q', { chord: 'F7' }),
          n('G', 0, 4, 'q'),
          n('A', 0, 4, 'q'),
          n('D', 0, 5, 'q'),
        ]),
        createMeasure([
          n('D', 0, 5, 'h', { dotted: true, chord: 'Bbmaj7' }),
          n('E', -1, 4, 'q'),
        ]),
        createMeasure([
          n('E', -1, 4, 'q', { chord: 'Ebmaj7' }),
          n('F', 0, 4, 'q'),
          n('G', 0, 4, 'q'),
          n('C', 0, 5, 'q'),
        ]),
        createMeasure([
          n('C', 0, 5, 'h', { dotted: true, chord: 'Am7b5' }),
          n('D', 0, 4, 'q'),
        ]),
        createMeasure([
          n('F', 1, 4, 'q', { chord: 'D7' }),
          n('A', 0, 4, 'q'),
          n('C', 0, 5, 'q'),
          n('B', -1, 4, 'q'),
        ]),
        createMeasure([
          n('G', 0, 4, 'w', { chord: 'Gm6', dynamic: 'p' }),
        ]),
      ],
    },
    {
      id: 'minuet-in-g',
      title: 'Minuet in G Major',
      subtitle: 'BWV Anh. 114 (Notebook for Anna Magdalena Bach)',
      composer: 'Christian Petzold',
      keySignature: 'G',
      originalKey: 'G',
      transposeSemitones: 0,
      timeSignature: { beats: 3, beatType: 4 },
      clef: 'treble',
      tempo: 116,
      measures: [
        createMeasure([
          n('D', 0, 5, 'q', { chord: 'G', dynamic: 'mf' }),
          n('G', 0, 4, '8'),
          n('A', 0, 4, '8'),
          n('B', 0, 4, '8'),
          n('C', 0, 5, '8'),
        ]),
        createMeasure([
          n('D', 0, 5, 'q', { chord: 'G' }),
          n('G', 0, 4, 'q'),
          n('G', 0, 4, 'q'),
        ]),
        createMeasure([
          n('E', 0, 5, 'q', { chord: 'C' }),
          n('C', 0, 5, '8'),
          n('D', 0, 5, '8'),
          n('E', 0, 5, '8'),
          n('F', 1, 5, '8'),
        ]),
        createMeasure([
          n('G', 0, 5, 'q', { chord: 'G' }),
          n('G', 0, 4, 'q'),
          n('G', 0, 4, 'q'),
        ]),
        createMeasure([
          n('C', 0, 5, 'q', { chord: 'C' }),
          n('D', 0, 5, '8'),
          n('C', 0, 5, '8'),
          n('B', 0, 4, '8'),
          n('A', 0, 4, '8'),
        ]),
        createMeasure([
          n('B', 0, 4, 'q', { chord: 'G/B' }),
          n('C', 0, 5, '8'),
          n('B', 0, 4, '8'),
          n('A', 0, 4, '8'),
          n('G', 0, 4, '8'),
        ]),
        createMeasure([
          n('F', 1, 4, 'q', { chord: 'D7' }),
          n('G', 0, 4, '8'),
          n('A', 0, 4, '8'),
          n('B', 0, 4, '8'),
          n('G', 0, 4, '8'),
        ]),
        createMeasure([
          n('A', 0, 4, 'h', { dotted: true, chord: 'D' }),
        ]),
      ],
    },
    {
      id: 'cello-prelude',
      title: 'Cello Prelude Study',
      subtitle: 'Bass Clef Arpeggio Etude in C Major',
      composer: 'Studio Etude',
      keySignature: 'C',
      originalKey: 'C',
      transposeSemitones: 0,
      timeSignature: { beats: 4, beatType: 4 },
      clef: 'bass',
      tempo: 96,
      measures: [
        createMeasure([
          n('C', 0, 3, 'q', { chord: 'C', dynamic: 'mf' }),
          n('G', 0, 3, 'q'),
          n('E', 0, 3, 'q'),
          n('G', 0, 3, 'q'),
        ]),
        createMeasure([
          n('D', 0, 3, 'q', { chord: 'Dm7' }),
          n('A', 0, 3, 'q'),
          n('F', 0, 3, 'q'),
          n('A', 0, 3, 'q'),
        ]),
        createMeasure([
          n('B', 0, 2, 'q', { chord: 'G7/B' }),
          n('G', 0, 3, 'q'),
          n('F', 0, 3, 'q'),
          n('D', 0, 3, 'q'),
        ]),
        createMeasure([
          n('C', 0, 3, 'h', { chord: 'C' }),
          n('G', 0, 3, 'h'),
        ]),
      ],
    },
  ];
}
