/**
 * Music Theory & Transposition Engine
 * Handles diatonic/chromatic pitch math, key signatures, enharmonic spelling,
 * staff positions (treble & bass clefs), chord symbol parsing/transposition,
 * and instrument transposition presets.
 */

export const STEP_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const STEP_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

// Key signature definitions ordered by circle of fifths (-7 flats to +7 sharps)
export const KEY_SIGNATURES = [
  { id: 'Cb', label: 'C♭ Major / A♭ Minor', fifths: -7, rootPc: 11, preferFlats: true },
  { id: 'Gb', label: 'G♭ Major / E♭ Minor', fifths: -6, rootPc: 6, preferFlats: true },
  { id: 'Db', label: 'D♭ Major / B♭ Minor', fifths: -5, rootPc: 1, preferFlats: true },
  { id: 'Ab', label: 'A♭ Major / F Minor', fifths: -4, rootPc: 8, preferFlats: true },
  { id: 'Eb', label: 'E♭ Major / C Minor', fifths: -3, rootPc: 3, preferFlats: true },
  { id: 'Bb', label: 'B♭ Major / G Minor', fifths: -2, rootPc: 10, preferFlats: true },
  { id: 'F',  label: 'F Major / D Minor',   fifths: -1, rootPc: 5, preferFlats: true },
  { id: 'C',  label: 'C Major / A Minor',   fifths: 0,  rootPc: 0, preferFlats: false },
  { id: 'G',  label: 'G Major / E Minor',   fifths: 1,  rootPc: 7, preferFlats: false },
  { id: 'D',  label: 'D Major / B Minor',   fifths: 2,  rootPc: 2, preferFlats: false },
  { id: 'A',  label: 'A Major / F♯ Minor',  fifths: 3,  rootPc: 9, preferFlats: false },
  { id: 'E',  label: 'E Major / C♯ Minor',  fifths: 4,  rootPc: 4, preferFlats: false },
  { id: 'B',  label: 'B Major / G♯ Minor',  fifths: 5,  rootPc: 11, preferFlats: false },
  { id: 'F#', label: 'F♯ Major / D♯ Minor', fifths: 6,  rootPc: 6, preferFlats: false },
  { id: 'C#', label: 'C♯ Major / A♯ Minor', fifths: 7,  rootPc: 1, preferFlats: false },
];

export const INSTRUMENT_PRESETS = [
  { id: 'concert', label: 'Concert Pitch (C)', semitones: 0, description: 'Piano, Violin, Flute, Guitar, Voice' },
  { id: 'bb-inst', label: 'B♭ Instrument (+2 st)', semitones: 2, description: 'Trumpet, Clarinet, Tenor/Soprano Sax' },
  { id: 'eb-alto', label: 'E♭ Alto Sax (+9 st)', semitones: 9, description: 'Alto Saxophone, Baritone Sax' },
  { id: 'eb-down', label: 'E♭ Instrument (-3 st)', semitones: -3, description: 'E♭ Clarinet / Alto Sax (lower 8ve)' },
  { id: 'f-horn',  label: 'F French Horn (+7 st)', semitones: 7, description: 'French Horn, English Horn' },
  { id: 'capo-1',  label: 'Guitar Capo 1 (-1 st)', semitones: -1, description: 'Play 1 semitone lower with Capo 1' },
  { id: 'capo-2',  label: 'Guitar Capo 2 (-2 st)', semitones: -2, description: 'Play 2 semitones lower with Capo 2' },
  { id: 'capo-3',  label: 'Guitar Capo 3 (-3 st)', semitones: -3, description: 'Play 3 semitones lower with Capo 3' },
  { id: 'capo-5',  label: 'Guitar Capo 5 (-5 st)', semitones: -5, description: 'Play 5 semitones lower with Capo 5' },
];

// Staff positions (diatonic steps above bottom staff line; bottom line = 0, top line = 8)
// Treble clef: E4 = 0, F4 = 1, G4 = 2, A4 = 3, B4 = 4, C5 = 5, D5 = 6, E5 = 7, F5 = 8
// Bass clef:   G2 = 0, A2 = 1, B2 = 2, C3 = 3, D3 = 4, E3 = 5, F3 = 6, G3 = 7, A3 = 8
export const CLEF_BOTTOM_DIATONIC = {
  treble: 4 * 7 + 2, // E4
  bass:   2 * 7 + 4, // G2
};

// Standard key signature accidental positions on the 5-line staff (0 = bottom line, 8 = top line)
export const KEY_SIG_POSITIONS = {
  treble: {
    sharps: [8, 5, 9, 6, 3, 7, 4], // F5, C5, G5, D5, A4, E5, B4
    flats:  [4, 7, 3, 6, 2, 5, 1], // B4, E5, A4, D5, G4, C5, F4
  },
  bass: {
    sharps: [6, 3, 7, 4, 1, 5, 2], // F3, C3, G3, D3, A2, E3, B2
    flats:  [2, 5, 1, 4, 0, 3, -1], // B2, E3, A2, D3, G2, C3, F2
  },
};

export const DURATIONS = [
  { id: 'w', label: 'Whole',     beats: 4,    symbol: '𝅝', shortcut: '1' },
  { id: 'h', label: 'Half',      beats: 2,    symbol: '𝅗𝅥', shortcut: '2' },
  { id: 'q', label: 'Quarter',   beats: 1,    symbol: '♩', shortcut: '3' },
  { id: '8', label: 'Eighth',    beats: 0.5,  symbol: '♪', shortcut: '4' },
  { id: '16', label: 'Sixteenth', beats: 0.25, symbol: '𝅘𝅥𝅯', shortcut: '5' },
];

export const DURATION_BEATS = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

export function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function getKeyInfo(keyId = 'C') {
  return KEY_SIGNATURES.find((k) => k.id === keyId) || KEY_SIGNATURES.find((k) => k.id === 'C');
}

export function getKeyFromFifths(fifths) {
  const clamped = Math.max(-7, Math.min(7, Math.round(fifths)));
  return KEY_SIGNATURES.find((k) => k.fifths === clamped) || getKeyInfo('C');
}

/**
 * Returns a map of { C, D, E, F, G, A, B } -> alter (-1, 0, +1) for a key signature.
 */
export function getKeyAlterMap(keyId = 'C') {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const info = getKeyInfo(keyId);
  if (info.fifths > 0) {
    for (let i = 0; i < info.fifths; i++) {
      map[SHARP_ORDER[i]] = 1;
    }
  } else if (info.fifths < 0) {
    for (let i = 0; i < Math.abs(info.fifths); i++) {
      map[FLAT_ORDER[i]] = -1;
    }
  }
  return map;
}

/**
 * Returns the 7 pitch classes and their diatonic spellings for a Major key.
 */
export function getKeyScaleSpellings(keyId = 'C') {
  const alterMap = getKeyAlterMap(keyId);
  const byPc = new Map();
  for (const step of STEP_ORDER) {
    const alter = alterMap[step];
    const pc = mod12(STEP_TO_SEMITONE[step] + alter);
    byPc.set(pc, { step, alter });
  }
  return byPc;
}

/**
 * Converts pitch object { step, alter, octave } to MIDI note number (C4 = 60).
 */
export function pitchToMidi(pitch) {
  if (!pitch) return 60;
  return (pitch.octave + 1) * 12 + STEP_TO_SEMITONE[pitch.step] + (pitch.alter || 0);
}

/**
 * Converts MIDI note number to frequency in Hz (A4 = 440 Hz).
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchToFreq(pitch) {
  return midiToFreq(pitchToMidi(pitch));
}

/**
 * Converts a MIDI number to a properly spelled pitch in the given target key.
 * enharmonicPref: 'auto' | 'sharp' | 'flat'
 */
export function midiToPitch(midi, keyId = 'C', enharmonicPref = 'auto') {
  const clampedMidi = Math.max(21, Math.min(108, Math.round(midi)));
  const pc = mod12(clampedMidi);
  const keyInfo = getKeyInfo(keyId);
  const scaleSpellings = getKeyScaleSpellings(keyId);

  let chosen = null;

  // Prefer diatonic scale tones of the key signature unless user explicitly forces sharp/flat on chromatic tones
  if (scaleSpellings.has(pc)) {
    chosen = scaleSpellings.get(pc);
  } else {
    const useFlats =
      enharmonicPref === 'flat'
        ? true
        : enharmonicPref === 'sharp'
        ? false
        : keyInfo.preferFlats;

    const chromaticTable = useFlats
      ? [
          { step: 'C', alter: 0 },
          { step: 'D', alter: -1 },
          { step: 'D', alter: 0 },
          { step: 'E', alter: -1 },
          { step: 'E', alter: 0 },
          { step: 'F', alter: 0 },
          { step: 'G', alter: -1 },
          { step: 'G', alter: 0 },
          { step: 'A', alter: -1 },
          { step: 'A', alter: 0 },
          { step: 'B', alter: -1 },
          { step: 'B', alter: 0 },
        ]
      : [
          { step: 'C', alter: 0 },
          { step: 'C', alter: 1 },
          { step: 'D', alter: 0 },
          { step: 'D', alter: 1 },
          { step: 'E', alter: 0 },
          { step: 'F', alter: 0 },
          { step: 'F', alter: 1 },
          { step: 'G', alter: 0 },
          { step: 'G', alter: 1 },
          { step: 'A', alter: 0 },
          { step: 'A', alter: 1 },
          { step: 'B', alter: 0 },
        ];
    chosen = chromaticTable[pc];
  }

  // Solve octave carefully so B#3 == C4 (60) and Cb5 == B4 (71)
  const rawBase = STEP_TO_SEMITONE[chosen.step] + chosen.alter;
  const octave = Math.round((clampedMidi - rawBase) / 12) - 1;

  return {
    step: chosen.step,
    alter: chosen.alter,
    octave,
  };
}

/**
 * Formats a pitch for UI display, e.g. { step: 'F', alter: 1, octave: 4 } -> "F♯4"
 */
export function formatPitch(pitch, ascii = false) {
  if (!pitch) return 'Rest';
  const acc =
    pitch.alter === 1
      ? ascii ? '#' : '♯'
      : pitch.alter === -1
      ? ascii ? 'b' : '♭'
      : pitch.alter === 2
      ? ascii ? '##' : '𝄪'
      : pitch.alter === -2
      ? ascii ? 'bb' : '𝄫'
      : '';
  return `${pitch.step}${acc}${pitch.octave}`;
}

export function formatAccidental(alter) {
  if (alter === 1) return '♯';
  if (alter === -1) return '♭';
  if (alter === 0) return '♮';
  if (alter === 2) return '𝄪';
  if (alter === -2) return '𝄫';
  return '';
}

/**
 * Staff position (diatonic steps above bottom line of the 5-line staff).
 * Bottom line = 0, middle line = 4, top line = 8.
 */
export function pitchToStaffPos(pitch, clef = 'treble') {
  const diatonic = pitch.octave * 7 + STEP_ORDER.indexOf(pitch.step);
  return diatonic - (CLEF_BOTTOM_DIATONIC[clef] ?? CLEF_BOTTOM_DIATONIC.treble);
}

/**
 * Inverse of pitchToStaffPos: converts a diatonic staff position into a pitch,
 * automatically applying the current key signature's alteration for that letter.
 */
export function staffPosToPitch(staffPos, clef = 'treble', keyId = 'C') {
  const baseDiatonic = (CLEF_BOTTOM_DIATONIC[clef] ?? CLEF_BOTTOM_DIATONIC.treble) + Math.round(staffPos);
  const octave = Math.floor(baseDiatonic / 7);
  const stepIdx = ((baseDiatonic % 7) + 7) % 7;
  const step = STEP_ORDER[stepIdx];
  const alterMap = getKeyAlterMap(keyId);
  return {
    step,
    alter: alterMap[step] || 0,
    octave,
  };
}

/**
 * Computes the cleanest target key signature when transposing from `fromKeyId` by `semitones`.
 */
export function transposeKeyId(fromKeyId, semitones, enharmonicPref = 'auto') {
  const fromKey = getKeyInfo(fromKeyId);
  const targetPc = mod12(fromKey.rootPc + semitones);

  // Cleanest default key choices by pitch class (avoids 7 sharps/flats unless explicitly requested)
  const autoMap = {
    0: 'C',
    1: 'Db',
    2: 'D',
    3: 'Eb',
    4: 'E',
    5: 'F',
    6: 'F#',
    7: 'G',
    8: 'Ab',
    9: 'A',
    10: 'Bb',
    11: 'B',
  };
  const sharpMap = {
    0: 'C', 1: 'C#', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
  };
  const flatMap = {
    0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
    6: 'Gb', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'Cb',
  };

  if (enharmonicPref === 'sharp') return sharpMap[targetPc];
  if (enharmonicPref === 'flat') return flatMap[targetPc];
  return autoMap[targetPc];
}

/**
 * Computes the shortest semitone shift (-5 to +6) from one key to another.
 */
export function semitonesBetweenKeys(fromKeyId, toKeyId) {
  const a = getKeyInfo(fromKeyId).rootPc;
  const b = getKeyInfo(toKeyId).rootPc;
  let diff = mod12(b - a);
  if (diff > 6) diff -= 12;
  return diff;
}

/**
 * Transposes a single pitch object by `semitones` into `targetKeyId`.
 */
export function transposePitch(pitch, semitones, targetKeyId = 'C', enharmonicPref = 'auto') {
  if (!pitch) return null;
  const midi = pitchToMidi(pitch) + semitones;
  return midiToPitch(midi, targetKeyId, enharmonicPref);
}

// --- Chord Symbol Parsing & Transposition ---

const CHORD_REGEX = /^([A-G])([#♯b♭]?)(maj7|maj9|maj11|maj13|maj|min7|min9|min11|min|m7b5|m7#5|mMaj7|m6|m7|m9|m11|m13|m|dim7|dim|°7|°|ø7|ø|aug|\+|sus2|sus4|sus|add9|add11|add2|6\/9|6|7b9|7#9|7b5|7#5|7alt|7sus4|7|9|11|13|5|2)?(\([^)]+\))?(?:\/([A-G])([#♯b♭]?))?$/;

const PC_TO_CHORD_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_TO_CHORD_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function noteNameToPc(letter, acc) {
  let pc = STEP_TO_SEMITONE[letter];
  if (acc === '#' || acc === '♯') pc += 1;
  if (acc === 'b' || acc === '♭') pc -= 1;
  return mod12(pc);
}

export function parseChord(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'N.C.' || trimmed === 'NC') return null;
  const m = trimmed.match(CHORD_REGEX);
  if (!m) return null;
  const [, rootLetter, rootAcc = '', quality = '', alteration = '', bassLetter = '', bassAcc = ''] = m;
  return {
    raw: trimmed,
    rootLetter,
    rootAcc,
    rootPc: noteNameToPc(rootLetter, rootAcc),
    quality,
    alteration,
    bassLetter,
    bassAcc,
    bassPc: bassLetter ? noteNameToPc(bassLetter, bassAcc) : null,
  };
}

/**
 * Heuristic for detecting chord symbols in PDF text layers without matching regular English words.
 */
export function isLikelyChordSymbol(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 14) return false;
  // Avoid matching standalone English word "A" or "Am" unless unambiguous,
  // though single chord letters B, C, D, E, F, G are very strong chord candidates in sheet music.
  if (trimmed === 'A' || trimmed === 'I') return false;
  if (trimmed === 'Am') return true; // In sheet music PDFs, "Am" above a staff is overwhelmingly A minor
  return parseChord(trimmed) !== null;
}

/**
 * Transposes a chord symbol string (e.g., "Cmaj7/G" + 2 st -> "Dmaj7/A").
 */
export function transposeChord(chordStr, semitones, targetKeyId = 'C', enharmonicPref = 'auto') {
  if (!chordStr || semitones === 0) return chordStr;
  const parsed = parseChord(chordStr);
  if (!parsed) return chordStr;

  const keyInfo = getKeyInfo(targetKeyId);
  const useFlats =
    enharmonicPref === 'flat'
      ? true
      : enharmonicPref === 'sharp'
      ? false
      : keyInfo.preferFlats;

  const table = useFlats ? PC_TO_CHORD_FLAT : PC_TO_CHORD_SHARP;
  const newRoot = table[mod12(parsed.rootPc + semitones)];
  const prettyRoot = newRoot.replace('#', '♯').replace('b', '♭');
  let result = `${prettyRoot}${parsed.quality}${parsed.alteration}`;

  if (parsed.bassPc !== null) {
    const newBass = table[mod12(parsed.bassPc + semitones)].replace('#', '♯').replace('b', '♭');
    result += `/${newBass}`;
  }
  return result;
}

/**
 * Returns chord MIDI voicing notes (root position around octave 3) for accompaniment playback.
 */
export function chordToMidiNotes(chordStr) {
  const parsed = parseChord(chordStr);
  if (!parsed) return [];
  const root = 48 + parsed.rootPc; // C3..B3
  const q = parsed.quality || '';
  let intervals = [0, 4, 7]; // Major triad

  if (q.startsWith('m7b5') || q.startsWith('ø')) {
    intervals = [0, 3, 6, 10];
  } else if (q.startsWith('dim7') || q.startsWith('°7')) {
    intervals = [0, 3, 6, 9];
  } else if (q.startsWith('dim') || q.startsWith('°')) {
    intervals = [0, 3, 6];
  } else if (q.startsWith('aug') || q === '+') {
    intervals = [0, 4, 8];
  } else if (q.startsWith('sus2')) {
    intervals = [0, 2, 7];
  } else if (q.startsWith('sus4') || q === 'sus') {
    intervals = [0, 5, 7];
  } else if (q.startsWith('mMaj7')) {
    intervals = [0, 3, 7, 11];
  } else if (q.startsWith('m6')) {
    intervals = [0, 3, 7, 9];
  } else if (q.startsWith('m7') || q.startsWith('min7') || q.startsWith('m9') || q.startsWith('m11') || q.startsWith('m13')) {
    intervals = [0, 3, 7, 10];
  } else if (q === 'm' || q === 'min') {
    intervals = [0, 3, 7];
  } else if (q.startsWith('maj7') || q.startsWith('maj9') || q.startsWith('maj13')) {
    intervals = [0, 4, 7, 11];
  } else if (q.startsWith('6')) {
    intervals = [0, 4, 7, 9];
  } else if (q.startsWith('7') || q.startsWith('9') || q.startsWith('11') || q.startsWith('13')) {
    intervals = [0, 4, 7, 10];
  } else if (q === '5') {
    intervals = [0, 7];
  }

  const notes = intervals.map((i) => root + i);
  if (parsed.bassPc !== null && parsed.bassPc !== parsed.rootPc) {
    notes.unshift(36 + parsed.bassPc);
  }
  return notes;
}
