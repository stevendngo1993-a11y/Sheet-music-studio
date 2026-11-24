/**
 * Pure-JS Vector PDF 1.4 Sheet Music Generator
 * Produces crisp, printable vector sheet music PDFs directly in the browser
 * with standard PDF Helvetica & Times fonts (for selectable text & chord extraction),
 * vector staves/noteheads/clefs/accidentals/stems, multi-page pagination, and
 * optional embedded score metadata for lossless round-trip reopening.
 */

import {
  getKeyInfo,
  getKeyAlterMap,
  KEY_SIG_POSITIONS,
  pitchToStaffPos,
} from '../music/theory.js';
import { noteBeats } from '../music/scoreModel.js';

function pdfEscape(str) {
  return String(str || '')
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/♮/g, '')
    .replace(/♩/g, 'Tempo')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function fmt(n) {
  return Number(n).toFixed(2);
}

/**
 * Draws a filled or stroked ellipse at (cx, cy) with radii (rx, ry) rotated by angleDeg
 * using 4 cubic Bezier segments in PDF content-stream operators.
 */
function pdfEllipse(cx, cy, rx, ry, angleDeg = 0, mode = 'f') {
  const k = 0.55228475;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const tx = (x, y) => cx + x * cos - y * sin;
  const ty = (x, y) => cy + x * sin + y * cos;

  const p0 = [tx(rx, 0), ty(rx, 0)];
  const c1 = [tx(rx, ry * k), ty(rx, ry * k)];
  const c2 = [tx(rx * k, ry), ty(rx * k, ry)];
  const p1 = [tx(0, ry), ty(0, ry)];

  const c3 = [tx(-rx * k, ry), ty(-rx * k, ry)];
  const c4 = [tx(-rx, ry * k), ty(-rx, ry * k)];
  const p2 = [tx(-rx, 0), ty(-rx, 0)];

  const c5 = [tx(-rx, -ry * k), ty(-rx, -ry * k)];
  const c6 = [tx(-rx * k, -ry), ty(-rx * k, -ry)];
  const p3 = [tx(0, -ry), ty(0, -ry)];

  const c7 = [tx(rx * k, -ry), ty(rx * k, -ry)];
  const c8 = [tx(rx, -ry * k), ty(rx, -ry * k)];

  return [
    `${fmt(p0[0])} ${fmt(p0[1])} m`,
    `${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p1[0])} ${fmt(p1[1])} c`,
    `${fmt(c3[0])} ${fmt(c3[1])} ${fmt(c4[0])} ${fmt(c4[1])} ${fmt(p2[0])} ${fmt(p2[1])} c`,
    `${fmt(c5[0])} ${fmt(c5[1])} ${fmt(c6[0])} ${fmt(c6[1])} ${fmt(p3[0])} ${fmt(p3[1])} c`,
    `${fmt(c7[0])} ${fmt(c7[1])} ${fmt(c8[0])} ${fmt(c8[1])} ${fmt(p0[0])} ${fmt(p0[1])} c`,
    `h ${mode}`,
  ].join('\n');
}

function pdfLine(x1, y1, x2, y2, width = 0.8) {
  return `${fmt(width)} w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`;
}

function pdfText(text, x, y, font = 'F1', size = 11, align = 'left') {
  const safe = pdfEscape(text);
  // Estimate string width cleanly for center/right alignment
  const approxWidth = safe.length * size * (font === 'F2' ? 0.56 : 0.48);
  let drawX = x;
  if (align === 'center') drawX = x - approxWidth / 2;
  else if (align === 'right') drawX = x - approxWidth;
  return `BT /${font} ${fmt(size)} Tf 1 0 0 1 ${fmt(drawX)} ${fmt(y)} Tm (${safe}) Tj ET`;
}

function pdfAccidental(alter, x, y, s) {
  const cmds = [];
  if (alter === 1) {
    // Sharp
    cmds.push(pdfLine(x - 1.8, y - s * 0.72, x - 1.8, y + s * 0.78, 0.9));
    cmds.push(pdfLine(x + 1.8, y - s * 0.78, x + 1.8, y + s * 0.72, 0.9));
    cmds.push(pdfLine(x - 3.6, y + s * 0.2, x + 3.6, y + s * 0.38, 1.7));
    cmds.push(pdfLine(x - 3.6, y - s * 0.38, x + 3.6, y - s * 0.2, 1.7));
  } else if (alter === -1) {
    // Flat
    cmds.push(pdfLine(x - 2, y - s * 0.5, x - 2, y + s * 1.0, 1.0));
    cmds.push(
      `1.2 w ${fmt(x - 2)} ${fmt(y + s * 0.2)} m ${fmt(x + 3.5)} ${fmt(y + s * 0.45)} ${fmt(x + 3.5)} ${fmt(y - s * 0.25)} ${fmt(x - 2)} ${fmt(y - s * 0.5)} c S`
    );
  } else if (alter === 0) {
    // Natural
    cmds.push(pdfLine(x - 1.8, y - s * 0.35, x - 1.8, y + s * 0.85, 0.9));
    cmds.push(pdfLine(x + 1.8, y - s * 0.85, x + 1.8, y + s * 0.35, 0.9));
    cmds.push(pdfLine(x - 2.0, y + s * 0.2, x + 2.0, y + s * 0.35, 1.6));
    cmds.push(pdfLine(x - 2.0, y - s * 0.35, x + 2.0, y - s * 0.2, 1.6));
  }
  return cmds.join('\n');
}

function pdfClef(clef, x, staffBottom, s) {
  const cmds = [];
  if (clef === 'bass') {
    const fLineY = staffBottom + 3 * s;
    cmds.push(pdfEllipse(x + 2, fLineY, 2.2, 2.2, 0, 'f'));
    cmds.push(
      `1.8 w ${fmt(x + 1)} ${fmt(fLineY + 1)} m ${fmt(x + 1)} ${fmt(fLineY + 7)} ${fmt(x + 11)} ${fmt(fLineY + 7)} ${fmt(x + 11)} ${fmt(fLineY)} c ${fmt(x + 11)} ${fmt(fLineY - 9)} ${fmt(x + 5)} ${fmt(fLineY - 15)} ${fmt(x - 2)} ${fmt(fLineY - 19)} c S`
    );
    cmds.push(pdfEllipse(x + 15, fLineY + s * 0.45, 1.4, 1.4, 0, 'f'));
    cmds.push(pdfEllipse(x + 15, fLineY - s * 0.45, 1.4, 1.4, 0, 'f'));
  } else {
    // Clean stylized G-clef centered on G4 line (staffBottom + 1*s)
    const gLineY = staffBottom + s;
    cmds.push(pdfLine(x + 5, staffBottom - s * 1.1, x + 5, staffBottom + 5.2 * s, 1.3));
    cmds.push(
      `1.4 w ${fmt(x + 5)} ${fmt(staffBottom + 5.2 * s)} m ${fmt(x + 11)} ${fmt(staffBottom + 4.4 * s)} ${fmt(x + 10)} ${fmt(staffBottom + 2.5 * s)} ${fmt(x + 1)} ${fmt(staffBottom + 1.5 * s)} c ${fmt(x - 3)} ${fmt(staffBottom + 0.5 * s)} ${fmt(x + 1)} ${fmt(staffBottom - 0.5 * s)} ${fmt(x + 6)} ${fmt(staffBottom - 0.2 * s)} c ${fmt(x + 11)} ${fmt(staffBottom + 0.2 * s)} ${fmt(x + 11)} ${fmt(gLineY + s * 0.9)} ${fmt(x + 5.5)} ${fmt(gLineY + s * 0.7)} c ${fmt(x + 2)} ${fmt(gLineY + s * 0.5)} ${fmt(x + 2)} ${fmt(gLineY - s * 0.3)} ${fmt(x + 5.5)} ${fmt(gLineY - s * 0.2)} c S`
    );
    cmds.push(pdfEllipse(x + 3.2, staffBottom - s * 1.15, 1.8, 1.8, 0, 'f'));
  }
  return cmds.join('\n');
}

function pdfRest(duration, x, staffBottom, s) {
  if (duration === 'w') {
    const y = staffBottom + 3 * s - s * 0.45;
    return `${fmt(x - 4)} ${fmt(y)} ${fmt(8)} ${fmt(s * 0.45)} re f`;
  }
  if (duration === 'h') {
    const y = staffBottom + 2 * s;
    return `${fmt(x - 4)} ${fmt(y)} ${fmt(8)} ${fmt(s * 0.45)} re f`;
  }
  // Quarter / 8th / 16th stylized rest
  const mid = staffBottom + 2 * s;
  return [
    `1.6 w ${fmt(x - 2)} ${fmt(mid + s)} m ${fmt(x + 2.5)} ${fmt(mid + 0.3 * s)} l ${fmt(x - 2)} ${fmt(mid - 0.3 * s)} l ${fmt(x + 2.5)} ${fmt(mid - s)} l S`,
  ].join('\n');
}

/**
 * Generates a real, multi-page PDF 1.4 byte array (Uint8Array) from a Cadence score.
 */
export function generateScorePdf(score, { embedMetadata = true } = {}) {
  const pageW = 612; // US Letter 8.5 x 11 in points
  const pageH = 792;
  const marginX = 46;
  const staffRight = pageW - marginX;
  const s = 7.5; // staff space in points (4*s = 30pt staff height)
  const measuresPerSystem = 4;
  const systemsPerPageFirst = 5;
  const systemsPerPageRest = 6;

  const totalSystems = Math.max(1, Math.ceil(score.measures.length / measuresPerSystem));
  const keyInfo = getKeyInfo(score.keySignature);
  const keyAlterMap = getKeyAlterMap(score.keySignature);
  const numKeyAcc = Math.abs(keyInfo.fifths);
  const clefW = 28;
  const keySigW = numKeyAcc > 0 ? numKeyAcc * 7.5 + 8 : 4;
  const timeSigW = 18;

  // Split systems across pages
  const pageSystemRanges = [];
  let cursor = 0;
  while (cursor < totalSystems) {
    const maxSys = pageSystemRanges.length === 0 ? systemsPerPageFirst : systemsPerPageRest;
    pageSystemRanges.push([cursor, Math.min(totalSystems, cursor + maxSys)]);
    cursor += maxSys;
  }

  const pageStreams = [];

  pageSystemRanges.forEach(([sysStart, sysEnd], pageIdx) => {
    const cmds = [];
    cmds.push('0 0 0 RG 0 0 0 rg');

    // Page header on page 1
    if (pageIdx === 0) {
      cmds.push(pdfText(score.title || 'Untitled Score', pageW / 2, pageH - 56, 'F3', 20, 'center'));
      if (score.subtitle) {
        cmds.push(pdfText(score.subtitle, pageW / 2, pageH - 74, 'F1', 10, 'center'));
      }
      if (score.composer) {
        cmds.push(pdfText(score.composer, staffRight, pageH - 92, 'F3', 11, 'right'));
      }
      const transLabel =
        score.transposeSemitones && score.transposeSemitones !== 0
          ? `Tempo = ${score.tempo || 110}   |   Key: ${score.keySignature} (${score.transposeSemitones > 0 ? '+' : ''}${score.transposeSemitones} st)`
          : `Tempo = ${score.tempo || 110}   |   Key: ${score.keySignature}`;
      cmds.push(pdfText(transLabel, marginX, pageH - 92, 'F1', 9.5, 'left'));
    }

    const topStartY = pageIdx === 0 ? pageH - 170 : pageH - 95;
    const systemPitch = 112;

    for (let sysIdx = sysStart; sysIdx < sysEnd; sysIdx++) {
      const localIdx = sysIdx - sysStart;
      const staffBottom = topStartY - localIdx * systemPitch;
      const staffTop = staffBottom + 4 * s;
      const startM = sysIdx * measuresPerSystem;
      const endM = Math.min(score.measures.length, startM + measuresPerSystem);
      const countInSys = endM - startM;

      // 5 Staff Lines
      for (let l = 0; l < 5; l++) {
        const y = staffBottom + l * s;
        cmds.push(pdfLine(marginX, y, staffRight, y, 0.75));
      }

      // Left barline
      cmds.push(pdfLine(marginX, staffBottom, marginX, staffTop, 0.9));

      // Measure number
      cmds.push(pdfText(String(startM + 1), marginX + 2, staffTop + 8, 'F1', 7.5, 'left'));

      // Clef
      cmds.push(pdfClef(score.clef, marginX + 6, staffBottom, s));

      // Key Signature
      const ksX0 = marginX + clefW;
      if (numKeyAcc > 0) {
        const isSharp = keyInfo.fifths > 0;
        const positions = KEY_SIG_POSITIONS[score.clef === 'bass' ? 'bass' : 'treble'][isSharp ? 'sharps' : 'flats'];
        for (let i = 0; i < numKeyAcc; i++) {
          const accY = staffBottom + positions[i] * (s / 2);
          cmds.push(pdfAccidental(isSharp ? 1 : -1, ksX0 + i * 7.5, accY, s));
        }
      }

      // Time signature on first system
      const isFirstSys = sysIdx === 0;
      const contentStartX = marginX + clefW + keySigW + (isFirstSys ? timeSigW : 6);
      if (isFirstSys) {
        const tsX = marginX + clefW + keySigW + 6;
        cmds.push(pdfText(String(score.timeSignature.beats), tsX, staffBottom + 2.2 * s, 'F2', 13, 'center'));
        cmds.push(pdfText(String(score.timeSignature.beatType), tsX, staffBottom + 0.3 * s, 'F2', 13, 'center'));
      }

      const measureW = (staffRight - contentStartX) / Math.max(1, countInSys);

      for (let mOffset = 0; mOffset < countInSys; mOffset++) {
        const mIdx = startM + mOffset;
        const measure = score.measures[mIdx];
        const mX = contentStartX + mOffset * measureW;
        const mEndX = mX + measureW;
        const isLastMeasure = mIdx === score.measures.length - 1;

        const measureAcc = new Map();
        const totalBeats = Math.max(
          (score.timeSignature.beats * 4) / score.timeSignature.beatType,
          measure.notes.reduce((acc, n) => acc + noteBeats(n), 0)
        );
        const padLeft = 15;
        const padRight = 12;
        const usableW = Math.max(20, measureW - padLeft - padRight);

        let beatCursor = 0;
        for (const note of measure.notes) {
          const durBeats = noteBeats(note);
          const nx = mX + padLeft + (beatCursor / totalBeats) * usableW;
          beatCursor += durBeats;

          // Chord symbol above staff (standard Helvetica-Bold text so PDF.js extracts exact chord text!)
          if (note.chord) {
            cmds.push(pdfText(note.chord, nx, staffTop + 16, 'F2', 10, 'center'));
          }

          // Dynamic marking
          if (note.dynamic) {
            cmds.push(pdfText(note.dynamic, nx, staffBottom - 18, 'F3', 9.5, 'center'));
          }

          // Lyric syllable
          if (note.lyric) {
            cmds.push(pdfText(note.lyric, nx, staffBottom - 31, 'F1', 8.5, 'center'));
          }

          if (note.isRest || !note.pitch) {
            cmds.push(pdfRest(note.duration, nx, staffBottom, s));
            if (note.dotted) {
              cmds.push(pdfEllipse(nx + 7, staffBottom + 2.5 * s, 1.3, 1.3, 0, 'f'));
            }
          } else {
            const staffPos = pitchToStaffPos(note.pitch, score.clef);
            const ny = staffBottom + staffPos * (s / 2);

            // Ledger lines
            if (staffPos <= -2) {
              for (let lp = -2; lp >= staffPos; lp -= 2) {
                const ly = staffBottom + lp * (s / 2);
                cmds.push(pdfLine(nx - 6.8, ly, nx + 6.8, ly, 0.75));
              }
            } else if (staffPos >= 10) {
              for (let lp = 10; lp <= staffPos; lp += 2) {
                const ly = staffBottom + lp * (s / 2);
                cmds.push(pdfLine(nx - 6.8, ly, nx + 6.8, ly, 0.75));
              }
            }

            // Contextual accidental
            const keyPitchKey = `${note.pitch.step}${note.pitch.octave}`;
            const activeAlter = measureAcc.has(keyPitchKey)
              ? measureAcc.get(keyPitchKey)
              : keyAlterMap[note.pitch.step] || 0;
            const noteAlter = note.pitch.alter || 0;
            if (noteAlter !== activeAlter) {
              cmds.push(pdfAccidental(noteAlter, nx - 9.5, ny, s));
              measureAcc.set(keyPitchKey, noteAlter);
            }

            // Notehead
            const isHollow = note.duration === 'w' || note.duration === 'h';
            const rx = note.duration === 'w' ? 4.4 : 4.0;
            const ry = note.duration === 'w' ? 2.9 : 2.8;
            if (isHollow) {
              cmds.push('1.2 w');
              cmds.push(pdfEllipse(nx, ny, rx, ry, note.duration === 'w' ? 0 : 18, 'S'));
            } else {
              cmds.push(pdfEllipse(nx, ny, rx, ry, 18, 'f'));
            }

            // Augmentation dot
            if (note.dotted) {
              const isOnLine = Math.abs(staffPos) % 2 === 0;
              cmds.push(pdfEllipse(nx + 7.2, isOnLine ? ny + s * 0.35 : ny, 1.3, 1.3, 0, 'f'));
            }

            // Stem & flags
            if (note.duration !== 'w') {
              const stemUp = staffPos < 4;
              const stemLen = 3.3 * s;
              const stemX = stemUp ? nx + 3.6 : nx - 3.6;
              const stemY2 = stemUp ? ny + stemLen : ny - stemLen;
              cmds.push(pdfLine(stemX, ny, stemX, stemY2, 0.95));

              if (note.duration === '8' || note.duration === '16') {
                const dir = stemUp ? -1 : 1;
                cmds.push(
                  `1.4 w ${fmt(stemX)} ${fmt(stemY2)} m ${fmt(stemX + 5.5)} ${fmt(stemY2 + dir * 3.5)} ${fmt(stemX + 6.5)} ${fmt(stemY2 + dir * 9)} ${fmt(stemX + 2.2)} ${fmt(stemY2 + dir * 13)} c S`
                );
                if (note.duration === '16') {
                  const y2 = stemY2 + dir * 5;
                  cmds.push(
                    `1.4 w ${fmt(stemX)} ${fmt(y2)} m ${fmt(stemX + 5.5)} ${fmt(y2 + dir * 3.5)} ${fmt(stemX + 6.5)} ${fmt(y2 + dir * 9)} ${fmt(stemX + 2.2)} ${fmt(y2 + dir * 13)} c S`
                  );
                }
              }
            }
          }
        }

        // Barline
        if (isLastMeasure) {
          cmds.push(pdfLine(mEndX - 4, staffBottom, mEndX - 4, staffTop, 0.9));
          cmds.push(pdfLine(mEndX - 1, staffBottom, mEndX - 1, staffTop, 2.4));
        } else {
          cmds.push(pdfLine(mEndX, staffBottom, mEndX, staffTop, 0.9));
        }
      }
    }

    // Footer with page number
    cmds.push(
      pdfText(
        `Engraved with Cadence Studio  •  Page ${pageIdx + 1} of ${pageSystemRanges.length}`,
        pageW / 2,
        28,
        'F1',
        8,
        'center'
      )
    );

    pageStreams.push(cmds.join('\n'));
  });

  // Assemble PDF 1.4 binary structure
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length; // 1-indexed PDF object number
  };

  // Reserve 1: Catalog, 2: Pages
  addObj(''); // 1
  addObj(''); // 2
  const font1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const font3 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');

  const pageObjIds = [];
  for (const stream of pageStreams) {
    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R /F3 ${font3} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageObjIds.push(pageId);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;

  // Optional embedded score payload comment for lossless round-trip editing
  let metaComment = '';
  if (embedMetadata) {
    try {
      const jsonStr = JSON.stringify(score);
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
      metaComment = `%CADENCE_SCORE_V1:${b64}\n`;
    } catch {
      metaComment = '';
    }
  }

  let pdf = `%PDF-1.4\n${metaComment}`;
  const offsets = [0];

  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) {
    bytes[i] = pdf.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Extracts lossless Cadence score metadata if the PDF was exported by Cadence.
 * Returns parsed score object or null for external PDFs.
 */
export function extractEmbeddedScoreFromPdfBytes(bytes) {
  try {
    // Only inspect the first 256 KB where the header comment lives
    const slice = bytes.subarray(0, Math.min(bytes.length, 262144));
    let header = '';
    for (let i = 0; i < slice.length; i++) {
      header += String.fromCharCode(slice[i]);
    }
    const marker = '%CADENCE_SCORE_V1:';
    const start = header.indexOf(marker);
    if (start === -1) return null;
    const end = header.indexOf('\n', start);
    const b64 = header.slice(start + marker.length, end === -1 ? undefined : end).trim();
    const jsonStr = decodeURIComponent(escape(atob(b64)));
    const parsed = JSON.parse(jsonStr);
    if (parsed && Array.isArray(parsed.measures)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
