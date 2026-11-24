/**
 * Interactive SVG Sheet Music Engraver
 * Renders publication-grade sheet music with authentic musical engraving rules
 * (contextual accidentals, key signatures, ledger lines, auto-flipped stems, flags,
 * rests, chords, dynamics, lyrics) plus full pointer interaction (click-to-add,
 * click-to-select, vertical drag to change pitch, ghost preview, playhead).
 */

import {
  getKeyInfo,
  getKeyAlterMap,
  KEY_SIG_POSITIONS,
  pitchToStaffPos,
  staffPosToPitch,
  formatPitch,
  formatAccidental,
} from './theory.js';
import { noteBeats } from './scoreModel.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  if (text !== null) node.textContent = text;
  return node;
}

// Graceful vector Treble (G) Clef drawn relative to staffTop (y=0..44 for staffSpace=11)
function drawTrebleClef(x, staffTop, s) {
  const g = el('g', {
    transform: `translate(${x}, ${staffTop + 3 * s}) scale(${s / 10})`,
    class: 'score-clef',
  });
  // Clean engraved G-clef path wrapping around the G4 line (y=0 in local coords)
  g.appendChild(
    el('path', {
      d: [
        'M 2.5 23',
        'C -1.5 23, -4 20.5, -3.5 17.5',
        'C -3 15, -0.5 14, 1.5 15.5',
        'C 3 16.8, 2.5 19.5, 0.5 19.8',
        'C 2 21, 5.2 20, 5.5 16.5',
        'L 2.2 -32',
        'C 1.8 -36, 4.5 -39, 7.5 -37',
        'C 10.5 -35, 10 -27, 4.5 -20',
        'C -1 -13, -7 -7, -7 1.5',
        'C -7 8.5, -1.5 12.5, 4.8 11.5',
        'C 10.5 10.5, 13.5 5.5, 12.2 0',
        'C 11 -4.8, 6.5 -7.2, 2.2 -6',
        'C -1.5 -5, -3.2 -1.5, -1.8 2',
        'C -0.8 4.2, 1.2 5.2, 2.8 4.8',
        'C 0.5 3.6, 0.2 0.8, 2.2 -1',
        'C 4.5 -3, 8.2 -1.2, 8.6 2.2',
        'C 9.1 6.2, 5.8 9.2, 1.8 8.8',
        'C -2.5 8.4, -4.5 4.8, -4.2 0.5',
        'C -3.8 -5.5, 1.5 -10.5, 6.2 -16',
        'C 10 -20.5, 11.8 -26, 10.5 -32.5',
        'C 9.6 -37, 6 -40.5, 3 -39.5',
        'C -0.5 -38.5, -0.8 -33, -0.2 -29',
        'L 3.2 16',
        'C 3.6 20.5, 0.5 23, 2.5 23 Z',
      ].join(' '),
      fill: 'currentColor',
    })
  );
  return g;
}

// Crisp vector Bass (F) Clef centered around the F3 line (2nd line from top)
function drawBassClef(x, staffTop, s) {
  const g = el('g', {
    transform: `translate(${x}, ${staffTop + s}) scale(${s / 10})`,
    class: 'score-clef',
  });
  g.appendChild(
    el('path', {
      d: [
        'M -5 2',
        'C -5 -4.5, 0.5 -9.5, 6.5 -9.5',
        'C 13 -9.5, 17.5 -4.5, 17.5 2.5',
        'C 17.5 11.5, 10 19.5, -3 25.5',
        'L -4 23.8',
        'C 5.5 18.5, 12 11, 12 2.2',
        'C 12 -3.2, 9.2 -6.8, 5 -6.8',
        'C 1.2 -6.8, -1.5 -4.2, -1.5 -1',
        'C 0 -2, 2.5 -1.2, 2.8 1',
        'C 3.2 3.2, 1.5 5.2, -0.8 5.2',
        'C -3.4 5.2, -5 3.6, -5 2 Z',
      ].join(' '),
      fill: 'currentColor',
    })
  );
  // Two F-clef dots straddling the 4th line (y = -4.5 and y = 4.5)
  g.appendChild(el('circle', { cx: 22, cy: -4.2, r: 2.1, fill: 'currentColor' }));
  g.appendChild(el('circle', { cx: 22, cy: 4.5, r: 2.1, fill: 'currentColor' }));
  return g;
}

// Vector sharp, flat, natural glyphs (reliable across every OS/font!)
function drawAccidentalGlyph(alter, x, y, s, color = 'currentColor') {
  const g = el('g', {
    transform: `translate(${x}, ${y}) scale(${s / 10})`,
    class: 'score-accidental',
  });

  if (alter === 1) {
    // Sharp ♯
    g.appendChild(el('line', { x1: -2.4, y1: -9.5, x2: -2.4, y2: 10.5, stroke: color, 'stroke-width': 1.3 }));
    g.appendChild(el('line', { x1: 2.4, y1: -10.5, x2: 2.4, y2: 9.5, stroke: color, 'stroke-width': 1.3 }));
    g.appendChild(el('line', { x1: -5.2, y1: -2.2, x2: 5.2, y2: -4.6, stroke: color, 'stroke-width': 2.5 }));
    g.appendChild(el('line', { x1: -5.2, y1: 4.6, x2: 5.2, y2: 2.2, stroke: color, 'stroke-width': 2.5 }));
  } else if (alter === -1) {
    // Flat ♭
    g.appendChild(
      el('path', {
        d: 'M -3 -13 L -3 6.5 C -3 6.5, 4.5 2.5, 4.5 -1.8 C 4.5 -4.8, 1.5 -5.8, -1.5 -3.6 L -1.5 -13 Z M -1.5 -1.4 C 0.8 -3.2, 2.5 -2.4, 2.5 -0.8 C 2.5 1.5, -0.5 3.6, -1.5 4.2 Z',
        fill: color,
      })
    );
  } else if (alter === 0) {
    // Natural ♮
    g.appendChild(el('line', { x1: -2.6, y1: -11, x2: -2.6, y2: 5.2, stroke: color, 'stroke-width': 1.3 }));
    g.appendChild(el('line', { x1: 2.6, y1: -5.2, x2: 2.6, y2: 11, stroke: color, 'stroke-width': 1.3 }));
    g.appendChild(el('line', { x1: -2.8, y1: -2.8, x2: 2.8, y2: -4.8, stroke: color, 'stroke-width': 2.3 }));
    g.appendChild(el('line', { x1: -2.8, y1: 4.8, x2: 2.8, y2: 2.8, stroke: color, 'stroke-width': 2.3 }));
  }
  return g;
}

function drawRestGlyph(duration, x, staffTop, s, color = 'currentColor') {
  const g = el('g', {
    transform: `translate(${x}, ${staffTop})`,
    class: 'score-rest',
  });
  if (duration === 'w') {
    // Hangs from 4th line (y = 1*s)
    g.appendChild(el('rect', { x: -s * 0.55, y: s, width: s * 1.1, height: s * 0.48, fill: color }));
  } else if (duration === 'h') {
    // Sits on 3rd line (y = 2*s)
    g.appendChild(el('rect', { x: -s * 0.55, y: 2 * s - s * 0.48, width: s * 1.1, height: s * 0.48, fill: color }));
  } else if (duration === 'q') {
    // Quarter rest zig-zag
    const k = s / 10;
    g.appendChild(
      el('path', {
        transform: `translate(0, ${2 * s}) scale(${k})`,
        d: 'M -2 -13 L 3.5 -5.5 L -2.5 1.5 L 3.8 8.5 C 0 7.5, -3 9.5, -1.5 13 C -4.5 10.5, -4 6.5, 0.5 6.8 L -4.5 1 L 1.2 -5.5 L -3.5 -11.5 Z',
        fill: color,
      })
    );
  } else if (duration === '8') {
    const k = s / 10;
    g.appendChild(
      el('g', { transform: `translate(0, ${2 * s}) scale(${k})` })
    );
    const inner = g.firstChild;
    inner.appendChild(el('circle', { cx: -2.5, cy: -3.5, r: 2.4, fill: color }));
    inner.appendChild(el('path', { d: 'M -1.5 -2.5 Q 2.5 -1.5 4.2 -5.5 L -1.2 10.5', fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round' }));
  } else {
    // Sixteenth rest
    const k = s / 10;
    const inner = el('g', { transform: `translate(0, ${2 * s}) scale(${k})` });
    inner.appendChild(el('circle', { cx: -2.2, cy: -5.5, r: 2.2, fill: color }));
    inner.appendChild(el('circle', { cx: -3.6, cy: 1.5, r: 2.2, fill: color }));
    inner.appendChild(el('path', { d: 'M -1.2 -4.5 Q 2.5 -3.5 4.2 -7.2 L -1.8 11.5 M -2.4 2.5 Q 1.2 3.2 2.4 0', fill: 'none', stroke: color, 'stroke-width': 1.7, 'stroke-linecap': 'round' }));
    g.appendChild(inner);
  }
  return g;
}

export class ScoreEngraver {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.svg = null;
    this.layout = null;
    this.score = null;
    this.selectedNoteId = null;
    this.playingNoteId = null;
    this.activeTool = 'select'; // 'select' | 'note' | 'rest' | 'chord' | 'erase'
    this.activeDuration = 'q';
    this.activeDotted = false;
    this.dragState = null;
    this.ghostGroup = null;
  }

  setState({ selectedNoteId, playingNoteId, activeTool, activeDuration, activeDotted } = {}) {
    if (selectedNoteId !== undefined) this.selectedNoteId = selectedNoteId;
    if (playingNoteId !== undefined) this.playingNoteId = playingNoteId;
    if (activeTool !== undefined) this.activeTool = activeTool;
    if (activeDuration !== undefined) this.activeDuration = activeDuration;
    if (activeDotted !== undefined) this.activeDotted = activeDotted;
  }

  render(score) {
    this.score = score;
    this.container.innerHTML = '';

    const s = 11; // staff space in px (4*s = 44px staff height)
    const pageWidth = 860;
    const marginX = 48;
    const headerHeight = 104;
    const systemHeight = 148;
    const measuresPerSystem = 4;
    const totalSystems = Math.max(1, Math.ceil(score.measures.length / measuresPerSystem));
    const pageHeight = headerHeight + totalSystems * systemHeight + 48;

    const svg = el('svg', {
      viewBox: `0 0 ${pageWidth} ${pageHeight}`,
      width: '100%',
      class: 'engraved-score-svg',
      role: 'img',
      'aria-label': `${score.title} sheet music`,
    });

    // Subtle manuscript paper frame
    svg.appendChild(
      el('rect', {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
        rx: 4,
        class: 'score-paper-bg',
      })
    );

    // --- Header: Title, Subtitle, Composer, Tempo & Key badge ---
    svg.appendChild(
      el(
        'text',
        {
          x: pageWidth / 2,
          y: 44,
          'text-anchor': 'middle',
          class: 'score-title-text',
        },
        score.title || 'Untitled Score'
      )
    );

    if (score.subtitle) {
      svg.appendChild(
        el(
          'text',
          {
            x: pageWidth / 2,
            y: 65,
            'text-anchor': 'middle',
            class: 'score-subtitle-text',
          },
          score.subtitle
        )
      );
    }

    if (score.composer) {
      svg.appendChild(
        el(
          'text',
          {
            x: pageWidth - marginX,
            y: 84,
            'text-anchor': 'end',
            class: 'score-composer-text',
          },
          score.composer
        )
      );
    }

    // Tempo & transposition mark on left (vector quarter note so it renders crisply on every OS)
    const tempoGroup = el('g', { transform: `translate(${marginX}, 80)` });
    tempoGroup.appendChild(
      el('ellipse', { cx: 4, cy: 1.5, rx: 3.6, ry: 2.5, transform: 'rotate(-18 4 1.5)', fill: '#44403c' })
    );
    tempoGroup.appendChild(
      el('line', { x1: 7.2, y1: 1, x2: 7.2, y2: -11, stroke: '#44403c', 'stroke-width': 1.25 })
    );
    svg.appendChild(tempoGroup);

    const tempoText = `= ${score.tempo || 110}`;
    const transBadge =
      score.transposeSemitones && score.transposeSemitones !== 0
        ? `   •   Transposed ${score.transposeSemitones > 0 ? '+' : ''}${score.transposeSemitones} st (${score.keySignature})`
        : `   •   Key: ${score.keySignature}`;
    svg.appendChild(
      el(
        'text',
        {
          x: marginX + 13,
          y: 84,
          'text-anchor': 'start',
          class: 'score-tempo-text',
        },
        tempoText + transBadge
      )
    );

    const keyInfo = getKeyInfo(score.keySignature);
    const keyAlterMap = getKeyAlterMap(score.keySignature);
    const numKeyAcc = Math.abs(keyInfo.fifths);
    const clefWidth = 42;
    const keySigWidth = numKeyAcc > 0 ? numKeyAcc * 11 + 10 : 6;
    const timeSigWidth = 28;

    const measureLayouts = [];
    const noteLayouts = new Map();

    // --- Render Systems ---
    for (let sysIdx = 0; sysIdx < totalSystems; sysIdx++) {
      const startM = sysIdx * measuresPerSystem;
      const endM = Math.min(score.measures.length, startM + measuresPerSystem);
      const countInSys = endM - startM;
      const staffTop = headerHeight + sysIdx * systemHeight + 42;
      const staffBottom = staffTop + 4 * s;
      const staffRight = pageWidth - marginX;

      const sysGroup = el('g', { class: 'score-system', 'data-system': sysIdx });

      // 5 Staff Lines
      for (let l = 0; l < 5; l++) {
        const y = staffTop + l * s;
        sysGroup.appendChild(
          el('line', {
            x1: marginX,
            y1: y,
            x2: staffRight,
            y2: y,
            class: 'staff-line',
          })
        );
      }

      // Opening barline
      sysGroup.appendChild(
        el('line', {
          x1: marginX,
          y1: staffTop,
          x2: marginX,
          y2: staffBottom,
          class: 'bar-line',
        })
      );

      // Measure number above start of each system (from system 2 onward, or m.1 subtly)
      sysGroup.appendChild(
        el(
          'text',
          {
            x: marginX + 2,
            y: staffTop - 10,
            class: 'measure-number',
          },
          String(startM + 1)
        )
      );

      // Clef
      if (score.clef === 'bass') {
        sysGroup.appendChild(drawBassClef(marginX + 10, staffTop, s));
      } else {
        sysGroup.appendChild(drawTrebleClef(marginX + 14, staffTop, s));
      }

      // Key Signature
      const ksX0 = marginX + clefWidth;
      if (numKeyAcc > 0) {
        const isSharp = keyInfo.fifths > 0;
        const positions =
          KEY_SIG_POSITIONS[score.clef === 'bass' ? 'bass' : 'treble'][isSharp ? 'sharps' : 'flats'];
        for (let i = 0; i < numKeyAcc; i++) {
          const pos = positions[i];
          const accY = staffBottom - pos * (s / 2);
          sysGroup.appendChild(drawAccidentalGlyph(isSharp ? 1 : -1, ksX0 + i * 11, accY, s * 0.88));
        }
      }

      // Time Signature (only on first system)
      const isFirstSys = sysIdx === 0;
      const contentStartX = marginX + clefWidth + keySigWidth + (isFirstSys ? timeSigWidth : 8);
      if (isFirstSys) {
        const tsX = marginX + clefWidth + keySigWidth + 10;
        sysGroup.appendChild(
          el('text', { x: tsX, y: staffTop + 1.85 * s, 'text-anchor': 'middle', class: 'time-sig-text' }, String(score.timeSignature.beats))
        );
        sysGroup.appendChild(
          el('text', { x: tsX, y: staffTop + 3.85 * s, 'text-anchor': 'middle', class: 'time-sig-text' }, String(score.timeSignature.beatType))
        );
      }

      // Compute measure widths evenly across remaining width
      const availableW = staffRight - contentStartX;
      const measureW = availableW / Math.max(1, countInSys);

      for (let mOffset = 0; mOffset < countInSys; mOffset++) {
        const mIdx = startM + mOffset;
        const measure = score.measures[mIdx];
        const mX = contentStartX + mOffset * measureW;
        const mEndX = mX + measureW;
        const isLastMeasure = mIdx === score.measures.length - 1;

        measureLayouts.push({
          measureIndex: mIdx,
          measureId: measure.id,
          x: mX,
          width: measureW,
          staffTop,
          staffBottom,
          staffSpace: s,
        });

        // Interactive background hit-zone for this measure
        sysGroup.appendChild(
          el('rect', {
            x: mX,
            y: staffTop - 36,
            width: measureW,
            height: 4 * s + 74,
            class: 'measure-hit-zone',
            'data-measure-index': mIdx,
          })
        );

        // Track contextual accidentals per letter+octave inside this measure
        const measureAccidentals = new Map();

        const notes = measure.notes;
        const totalBeats = Math.max(
          (score.timeSignature.beats * 4) / score.timeSignature.beatType,
          notes.reduce((acc, n) => acc + noteBeats(n), 0)
        );
        const padLeft = 22;
        const padRight = 18;
        const usableW = Math.max(30, measureW - padLeft - padRight);

        let beatCursor = 0;

        for (let nIdx = 0; nIdx < notes.length; nIdx++) {
          const note = notes[nIdx];
          const durBeats = noteBeats(note);
          const nx = mX + padLeft + (beatCursor / totalBeats) * usableW;
          beatCursor += durBeats;

          const isSelected = note.id === this.selectedNoteId;
          const isPlaying = note.id === this.playingNoteId;

          const noteGroup = el('g', {
            class: `score-note${isSelected ? ' is-selected' : ''}${isPlaying ? ' is-playing' : ''}`,
            'data-note-id': note.id,
            'data-measure-index': mIdx,
            'data-note-index': nIdx,
          });

          // Active playhead highlight column
          if (isPlaying) {
            noteGroup.appendChild(
              el('rect', {
                x: nx - 13,
                y: staffTop - 22,
                width: 26,
                height: 4 * s + 44,
                rx: 4,
                class: 'playhead-highlight',
              })
            );
          }

          // Chord symbol above staff
          if (note.chord) {
            const prettyChord = note.chord.replace(/#/g, '♯').replace(/b(?=[0-9]|m|M|d|a|s|$|\/)/g, '♭');
            noteGroup.appendChild(
              el(
                'text',
                {
                  x: nx,
                  y: staffTop - 20,
                  'text-anchor': 'middle',
                  class: 'score-chord-text',
                },
                prettyChord
              )
            );
          }

          // Dynamic marking below staff
          if (note.dynamic) {
            noteGroup.appendChild(
              el(
                'text',
                {
                  x: nx,
                  y: staffBottom + 24,
                  'text-anchor': 'middle',
                  class: 'score-dynamic-text',
                },
                note.dynamic
              )
            );
          }

          // Lyric syllable below dynamics
          if (note.lyric) {
            noteGroup.appendChild(
              el(
                'text',
                {
                  x: nx,
                  y: staffBottom + 40,
                  'text-anchor': 'middle',
                  class: 'score-lyric-text',
                },
                note.lyric
              )
            );
          }

          if (note.isRest || !note.pitch) {
            noteGroup.appendChild(drawRestGlyph(note.duration, nx, staffTop, s));
            if (note.dotted) {
              noteGroup.appendChild(el('circle', { cx: nx + 11, cy: staffTop + 1.5 * s, r: 2.1, class: 'note-dot' }));
            }
            // Larger invisible click target for rests
            noteGroup.appendChild(
              el('rect', {
                x: nx - 14,
                y: staffTop,
                width: 28,
                height: 4 * s,
                fill: 'transparent',
              })
            );
            noteLayouts.set(note.id, { x: nx, y: staffTop + 2 * s, measureIndex: mIdx, noteIndex: nIdx });
          } else {
            const staffPos = pitchToStaffPos(note.pitch, score.clef);
            const ny = staffBottom - staffPos * (s / 2);

            // Ledger lines above (pos >= 10) or below (pos <= -2)
            if (staffPos <= -2) {
              for (let lp = -2; lp >= staffPos; lp -= 2) {
                const ly = staffBottom - lp * (s / 2);
                noteGroup.appendChild(
                  el('line', { x1: nx - 10, y1: ly, x2: nx + 10, y2: ly, class: 'ledger-line' })
                );
              }
            } else if (staffPos >= 10) {
              for (let lp = 10; lp <= staffPos; lp += 2) {
                const ly = staffBottom - lp * (s / 2);
                noteGroup.appendChild(
                  el('line', { x1: nx - 10, y1: ly, x2: nx + 10, y2: ly, class: 'ledger-line' })
                );
              }
            }

            // Contextual accidental calculation
            const keyPitchKey = `${note.pitch.step}${note.pitch.octave}`;
            const activeAlter = measureAccidentals.has(keyPitchKey)
              ? measureAccidentals.get(keyPitchKey)
              : keyAlterMap[note.pitch.step] || 0;
            const noteAlter = note.pitch.alter || 0;
            if (noteAlter !== activeAlter) {
              noteGroup.appendChild(drawAccidentalGlyph(noteAlter, nx - 14, ny, s * 0.85));
              measureAccidentals.set(keyPitchKey, noteAlter);
            }

            // Notehead
            const isHollow = note.duration === 'w' || note.duration === 'h';
            const rx = note.duration === 'w' ? 6.6 : 5.8;
            const ry = note.duration === 'w' ? 4.4 : 4.2;
            noteGroup.appendChild(
              el('ellipse', {
                cx: nx,
                cy: ny,
                rx,
                ry,
                transform: note.duration === 'w' ? undefined : `rotate(-18 ${nx} ${ny})`,
                class: isHollow ? 'note-head-hollow' : 'note-head-filled',
              })
            );

            // Augmentation dot (if on a line, nudge slightly up into the space!)
            if (note.dotted) {
              const isOnLine = Math.abs(staffPos) % 2 === 0;
              noteGroup.appendChild(
                el('circle', {
                  cx: nx + 10.5,
                  cy: isOnLine ? ny - s * 0.35 : ny,
                  r: 2.1,
                  class: 'note-dot',
                })
              );
            }

            // Stem & Flags (everything except whole notes)
            if (note.duration !== 'w') {
              const stemUp = staffPos < 4;
              const stemLen = 3.3 * s;
              const stemX = stemUp ? nx + 5.1 : nx - 5.1;
              const stemY1 = ny + (stemUp ? -1 : 1);
              const stemY2 = stemUp ? ny - stemLen : ny + stemLen;

              noteGroup.appendChild(
                el('line', {
                  x1: stemX,
                  y1: stemY1,
                  x2: stemX,
                  y2: stemY2,
                  class: 'note-stem',
                })
              );

              // Flags for 8th and 16th notes
              if (note.duration === '8' || note.duration === '16') {
                const dir = stemUp ? 1 : -1;
                const d1 = `M ${stemX} ${stemY2} C ${stemX + 8} ${stemY2 + dir * 5}, ${stemX + 10} ${stemY2 + dir * 13}, ${stemX + 3.5} ${stemY2 + dir * 19}`;
                noteGroup.appendChild(el('path', { d: d1, class: 'note-flag' }));
                if (note.duration === '16') {
                  const yOff = dir * 7.5;
                  const d2 = `M ${stemX} ${stemY2 + yOff} C ${stemX + 8} ${stemY2 + yOff + dir * 5}, ${stemX + 10} ${stemY2 + yOff + dir * 13}, ${stemX + 3.5} ${stemY2 + yOff + dir * 19}`;
                  noteGroup.appendChild(el('path', { d: d2, class: 'note-flag' }));
                }
              }
            }

            // Generous invisible pointer target for effortless selection/dragging
            noteGroup.appendChild(
              el('circle', {
                cx: nx,
                cy: ny,
                r: 13,
                fill: 'transparent',
              })
            );

            noteLayouts.set(note.id, { x: nx, y: ny, staffPos, measureIndex: mIdx, noteIndex: nIdx });
          }

          sysGroup.appendChild(noteGroup);
        }

        // Closing barline (double final barline on last measure of the score!)
        if (isLastMeasure) {
          sysGroup.appendChild(
            el('line', { x1: mEndX - 5.5, y1: staffTop, x2: mEndX - 5.5, y2: staffBottom, class: 'bar-line' })
          );
          sysGroup.appendChild(
            el('line', { x1: mEndX - 1.5, y1: staffTop, x2: mEndX - 1.5, y2: staffBottom, class: 'bar-line-final' })
          );
        } else {
          sysGroup.appendChild(
            el('line', { x1: mEndX, y1: staffTop, x2: mEndX, y2: staffBottom, class: 'bar-line' })
          );
        }
      }

      svg.appendChild(sysGroup);
    }

    // Ghost note hover layer
    const ghostGroup = el('g', { class: 'ghost-note-layer', style: 'pointer-events:none; display:none;' });
    svg.appendChild(ghostGroup);
    this.ghostGroup = ghostGroup;

    this.svg = svg;
    this.layout = { measureLayouts, noteLayouts, pageWidth, pageHeight, staffSpace: s };
    this.attachEvents(svg);
    this.container.appendChild(svg);
  }

  clientToSvgCoords(evt) {
    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  findMeasureAt(x, y) {
    if (!this.layout) return null;
    for (const m of this.layout.measureLayouts) {
      if (x >= m.x && x <= m.x + m.width && y >= m.staffTop - 42 && y <= m.staffBottom + 42) {
        return m;
      }
    }
    return null;
  }

  updateGhost(x, y) {
    if (!this.ghostGroup || !this.score) return;
    if (this.activeTool !== 'note' && this.activeTool !== 'rest') {
      this.ghostGroup.style.display = 'none';
      return;
    }
    const m = this.findMeasureAt(x, y);
    if (!m) {
      this.ghostGroup.style.display = 'none';
      this.callbacks.onHoverInfo?.(null);
      return;
    }
    const s = m.staffSpace;
    const rawStep = Math.round((m.staffBottom - y) / (s / 2));
    const clampedStep = Math.max(-6, Math.min(14, rawStep));
    const snapY = m.staffBottom - clampedStep * (s / 2);
    const pitch = staffPosToPitch(clampedStep, this.score.clef, this.score.keySignature);

    this.ghostGroup.innerHTML = '';
    this.ghostGroup.style.display = 'block';

    if (this.activeTool === 'rest') {
      this.ghostGroup.appendChild(drawRestGlyph(this.activeDuration, x, m.staffTop, s, 'var(--accent)'));
      this.callbacks.onHoverInfo?.({
        label: `Insert Rest • Measure ${m.measureIndex + 1}`,
      });
    } else {
      // Ledger lines for ghost
      if (clampedStep <= -2) {
        for (let lp = -2; lp >= clampedStep; lp -= 2) {
          const ly = m.staffBottom - lp * (s / 2);
          this.ghostGroup.appendChild(el('line', { x1: x - 10, y1: ly, x2: x + 10, y2: ly, stroke: 'var(--accent)', 'stroke-width': 1.2 }));
        }
      } else if (clampedStep >= 10) {
        for (let lp = 10; lp <= clampedStep; lp += 2) {
          const ly = m.staffBottom - lp * (s / 2);
          this.ghostGroup.appendChild(el('line', { x1: x - 10, y1: ly, x2: x + 10, y2: ly, stroke: 'var(--accent)', 'stroke-width': 1.2 }));
        }
      }
      this.ghostGroup.appendChild(
        el('ellipse', {
          cx: x,
          cy: snapY,
          rx: 5.8,
          ry: 4.2,
          transform: `rotate(-18 ${x} ${snapY})`,
          fill: this.activeDuration === 'w' || this.activeDuration === 'h' ? 'none' : 'var(--accent)',
          stroke: 'var(--accent)',
          'stroke-width': 1.8,
          opacity: 0.72,
        })
      );
      this.ghostGroup.appendChild(
        el('text', { x: x + 12, y: snapY - 6, class: 'ghost-pitch-label' }, formatPitch(pitch))
      );
      this.callbacks.onHoverInfo?.({
        label: `${formatPitch(pitch)} • Measure ${m.measureIndex + 1}`,
        pitch,
      });
    }
  }

  attachEvents(svg) {
    svg.addEventListener('pointermove', (evt) => {
      const { x, y } = this.clientToSvgCoords(evt);

      if (this.dragState) {
        const { noteId, measureLayout, lastStep } = this.dragState;
        const s = measureLayout.staffSpace;
        const step = Math.max(-6, Math.min(14, Math.round((measureLayout.staffBottom - y) / (s / 2))));
        if (step !== lastStep) {
          this.dragState.lastStep = step;
          this.dragState.moved = true;
          const newPitch = staffPosToPitch(step, this.score.clef, this.score.keySignature);
          this.callbacks.onDragPitch?.(noteId, newPitch);
        }
        return;
      }

      this.updateGhost(x, y);
    });

    svg.addEventListener('pointerleave', () => {
      if (this.ghostGroup) this.ghostGroup.style.display = 'none';
      this.callbacks.onHoverInfo?.(null);
    });

    svg.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      const { x, y } = this.clientToSvgCoords(evt);
      const noteEl = evt.target.closest?.('.score-note');

      if (noteEl) {
        const noteId = noteEl.getAttribute('data-note-id');
        const mIdx = Number(noteEl.getAttribute('data-measure-index'));

        if (this.activeTool === 'erase') {
          this.callbacks.onDeleteNote?.(noteId);
          return;
        }
        if (this.activeTool === 'chord') {
          this.callbacks.onEditChord?.(noteId);
          return;
        }

        this.callbacks.onSelectNote?.(noteId);

        // Enable vertical pitch drag for non-rest notes in select mode
        const nl = this.layout.noteLayouts.get(noteId);
        const ml = this.layout.measureLayouts.find((m) => m.measureIndex === mIdx);
        if (nl && ml && nl.staffPos !== undefined && this.activeTool === 'select') {
          this.dragState = {
            noteId,
            measureLayout: ml,
            lastStep: nl.staffPos,
            moved: false,
          };
          svg.setPointerCapture?.(evt.pointerId);
        }
        return;
      }

      // Clicked empty space inside a measure
      const m = this.findMeasureAt(x, y);
      if (!m) {
        this.callbacks.onSelectNote?.(null);
        return;
      }

      if (this.activeTool === 'note' || this.activeTool === 'rest') {
        const s = m.staffSpace;
        const step = Math.max(-6, Math.min(14, Math.round((m.staffBottom - y) / (s / 2))));
        const pitch = staffPosToPitch(step, this.score.clef, this.score.keySignature);
        const relRatio = Math.max(0, Math.min(1, (x - m.x) / m.width));
        this.callbacks.onInsertNote?.({
          measureIndex: m.measureIndex,
          isRest: this.activeTool === 'rest',
          pitch,
          relRatio,
        });
      } else {
        this.callbacks.onSelectNote?.(null);
      }
    });

    const endDrag = () => {
      if (this.dragState) {
        const wasMoved = this.dragState.moved;
        const noteId = this.dragState.noteId;
        this.dragState = null;
        if (wasMoved) {
          this.callbacks.onDragPitchEnd?.(noteId);
        }
      }
    };

    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('dblclick', (evt) => {
      const noteEl = evt.target.closest?.('.score-note');
      if (noteEl) {
        const noteId = noteEl.getAttribute('data-note-id');
        this.callbacks.onEditChord?.(noteId);
      }
    });
  }
}

export { formatAccidental };
