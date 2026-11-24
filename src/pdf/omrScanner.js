/**
 * Client-Side Optical Music Recognition (OMR) Engine
 * Analyzes rendered PDF sheet music canvas pixels to detect:
 *   1. Five-line staves (horizontal projection profile)
 *   2. Vertical barlines (measure segmentation)
 *   3. Noteheads (horizontal-run filtering to detach stems + connected components)
 *   4. Pitch positions relative to the 5 staff lines -> exact diatonic pitches
 *   5. Duration heuristics (filled vs hollow noteheads + stem presence)
 *   6. Association with PDF text-layer chord symbols above each staff
 */

import { staffPosToPitch, formatPitch } from '../music/theory.js';
import { createNote, createMeasure } from '../music/scoreModel.js';

/**
 * Runs OMR on raw RGBA image data (from a rendered PDF canvas).
 */
export function scanSheetMusicImage(imageData, options = {}) {
  const { width, height, data } = imageData;
  const {
    clef = 'treble',
    keySignature = 'C',
    timeSignature = { beats: 4, beatType: 4 },
    threshold = 175,
    detectedChords = [],
    title = 'Scanned PDF Score',
  } = options;

  // 1. Build binary dark-pixel map (1 = ink, 0 = paper)
  const dark = new Uint8Array(width * height);
  const rowCounts = new Int32Array(height);

  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      const idx = (rowOff + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum < threshold) {
        dark[rowOff + x] = 1;
        rowSum++;
      }
    }
    rowCounts[y] = rowSum;
  }

  // 2. Detect candidate staff-line rows (horizontal runs spanning >= 32% of page width)
  const minLinePixels = Math.floor(width * 0.32);
  const rawLines = [];
  let y = 0;
  while (y < height) {
    if (rowCounts[y] >= minLinePixels) {
      const startY = y;
      while (y < height && rowCounts[y] >= minLinePixels) y++;
      const endY = y - 1;
      const thickness = endY - startY + 1;
      if (thickness <= Math.max(8, Math.floor(height * 0.01))) {
        rawLines.push({
          center: (startY + endY) / 2,
          startY,
          endY,
          thickness,
        });
      }
    } else {
      y++;
    }
  }

  // 3. Group consecutive 5 equally-spaced lines into Staves
  const staves = [];
  let i = 0;
  while (i <= rawLines.length - 5) {
    const group = rawLines.slice(i, i + 5);
    const gaps = [
      group[1].center - group[0].center,
      group[2].center - group[1].center,
      group[3].center - group[2].center,
      group[4].center - group[3].center,
    ];
    const avgGap = gaps.reduce((a, b) => a + b, 0) / 4;
    const isUniform =
      avgGap >= 5 &&
      avgGap <= height * 0.08 &&
      gaps.every((g) => Math.abs(g - avgGap) <= Math.max(2.5, avgGap * 0.26));

    if (isUniform) {
      // Determine horizontal span [xMin, xMax] of this staff
      const midLineY = Math.round(group[2].center);
      let xMin = width;
      let xMax = 0;
      for (let x = 0; x < width; x++) {
        if (dark[midLineY * width + x]) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
      if (xMax - xMin > width * 0.25) {
        staves.push({
          index: staves.length,
          lines: group,
          lineY: group.map((l) => l.center),
          topY: group[0].center,
          bottomY: group[4].center,
          staffSpace: avgGap,
          lineThickness: Math.max(1, Math.round(group.reduce((a, l) => a + l.thickness, 0) / 5)),
          xMin,
          xMax,
        });
      }
      i += 5;
    } else {
      i += 1;
    }
  }

  const allBarlines = [];
  const allDetectedNotes = [];
  const measures = [];

  // 4. Analyze each detected staff
  for (const staff of staves) {
    const s = staff.staffSpace;
    const padY = Math.round(s * 3.2);
    const regTop = Math.max(0, Math.floor(staff.topY - padY));
    const regBottom = Math.min(height - 1, Math.ceil(staff.bottomY + padY));
    const regH = regBottom - regTop + 1;
    const regLeft = Math.max(0, staff.xMin);
    const regRight = Math.min(width - 1, staff.xMax);
    const regW = regRight - regLeft + 1;

    // 4a. Copy region and erase thin staff lines while preserving intersecting objects
    const cleaned = new Uint8Array(regW * regH);
    for (let ry = 0; ry < regH; ry++) {
      const py = regTop + ry;
      for (let rx = 0; rx < regW; rx++) {
        cleaned[ry * regW + rx] = dark[py * width + (regLeft + rx)];
      }
    }

    const halfT = Math.ceil(staff.lineThickness / 2) + 1;
    for (const line of staff.lines) {
      const cy = Math.round(line.center) - regTop;
      const yAbove = Math.max(0, cy - halfT);
      const yBelow = Math.min(regH - 1, cy + halfT);
      for (let rx = 0; rx < regW; rx++) {
        // Erase staff line pixels if neither immediately above nor immediately below is dark
        const hasAbove = cleaned[yAbove * regW + rx] === 1;
        const hasBelow = cleaned[yBelow * regW + rx] === 1;
        if (!hasAbove && !hasBelow) {
          for (let dy = -halfT + 1; dy <= halfT - 1; dy++) {
            const yy = cy + dy;
            if (yy >= 0 && yy < regH) {
              cleaned[yy * regW + rx] = 0;
            }
          }
        }
      }
    }

    // 4b. Detect vertical barlines spanning from topY to bottomY
    const staffTopLocal = Math.round(staff.topY) - regTop;
    const staffBotLocal = Math.round(staff.bottomY) - regTop;
    const staffSpan = Math.max(1, staffBotLocal - staffTopLocal + 1);
    const preamblePx = Math.round(s * (staff.index === 0 ? 8.6 : 7.0)); // Skip opening barline, clef, key & time sig
    const staffBarlines = [];

    let rx = preamblePx;
    while (rx < regW - Math.round(s * 1.5)) {
      let colDark = 0;
      for (let ry = staffTopLocal; ry <= staffBotLocal; ry++) {
        // Check 3px window for slight anti-aliasing
        if (
          cleaned[ry * regW + rx] ||
          (rx > 0 && cleaned[ry * regW + rx - 1]) ||
          (rx + 1 < regW && cleaned[ry * regW + rx + 1])
        ) {
          colDark++;
        }
      }
      if (colDark / staffSpan >= 0.86) {
        // Ensure it's a thin vertical line (not a solid black block)
        let runEnd = rx;
        while (runEnd < regW - 1) {
          let nextDark = 0;
          for (let ry = staffTopLocal; ry <= staffBotLocal; ry++) {
            if (cleaned[ry * regW + runEnd + 1]) nextDark++;
          }
          if (nextDark / staffSpan >= 0.7) runEnd++;
          else break;
        }
        const barWidth = runEnd - rx + 1;
        if (barWidth <= Math.max(6, Math.round(s * 0.45))) {
          const barX = regLeft + (rx + runEnd) / 2;
          // Avoid merging with nearby double barlines or note stems
          if (
            staffBarlines.length === 0 ||
            barX - staffBarlines[staffBarlines.length - 1] > s * 3.5
          ) {
            staffBarlines.push(barX);
            allBarlines.push({ x: barX, topY: staff.topY, bottomY: staff.bottomY });
          }
        }
        rx = runEnd + Math.round(s * 0.8);
      } else {
        rx++;
      }
    }

    // 4c. Notehead isolation via horizontal run-length filtering:
    // Vertical stems have horizontal thickness ~1-3px, while noteheads have horizontal runs >= 0.52*s.
    const minRunW = Math.max(3, Math.round(s * 0.52));
    const maxRunW = Math.max(minRunW + 4, Math.round(s * 2.1));
    const headMask = new Uint8Array(regW * regH);

    for (let ry = 0; ry < regH; ry++) {
      let x = preamblePx;
      while (x < regW) {
        if (cleaned[ry * regW + x]) {
          const start = x;
          while (x < regW && cleaned[ry * regW + x]) x++;
          const len = x - start;
          if (len >= minRunW && len <= maxRunW) {
            for (let k = start; k < x; k++) {
              headMask[ry * regW + k] = 1;
            }
          }
        } else {
          x++;
        }
      }
    }

    // 4d. Connected components on headMask to extract candidate noteheads
    const visited = new Uint8Array(regW * regH);
    const candidates = [];
    const queue = new Int32Array(regW * regH);

    for (let ry = 1; ry < regH - 1; ry++) {
      for (let cx = preamblePx; cx < regW - 1; cx++) {
        const startIdx = ry * regW + cx;
        if (!headMask[startIdx] || visited[startIdx]) continue;

        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = startIdx;
        visited[startIdx] = 1;

        let minX = cx;
        let maxX = cx;
        let minY = ry;
        let maxY = ry;
        let sumX = 0;
        let sumY = 0;
        let count = 0;

        while (qHead < qTail) {
          const cur = queue[qHead++];
          const py = Math.floor(cur / regW);
          const px = cur - py * regW;

          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          sumX += px;
          sumY += py;
          count++;

          // 8-connectivity
          for (let dy = -1; dy <= 1; dy++) {
            const ny = py + dy;
            if (ny < 0 || ny >= regH) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = px + dx;
              if (nx < preamblePx || nx >= regW) continue;
              const nIdx = ny * regW + nx;
              if (headMask[nIdx] && !visited[nIdx]) {
                visited[nIdx] = 1;
                queue[qTail++] = nIdx;
              }
            }
          }
        }

        const bw = maxX - minX + 1;
        const bh = maxY - minY + 1;
        const aspect = bw / Math.max(1, bh);

        // Filter notehead-sized blobs relative to staffSpace
        const validW = bw >= s * 0.65 && bw <= s * 1.95;
        const validH = bh >= s * 0.45 && bh <= s * 1.55;
        const validAspect = aspect >= 0.72 && aspect <= 2.3;
        const validArea = count >= s * s * 0.28;

        if (validW && validH && validAspect && validArea) {
          const absCx = regLeft + sumX / count;
          const absCy = regTop + sumY / count;

          // Exclude anything right on top of a detected barline
          const nearBar = staffBarlines.some((bx) => Math.abs(bx - absCx) < s * 0.55);
          if (nearBar) continue;

          // Determine if hollow (half/whole) vs filled (quarter/eighth)
          const fillRatio = count / (bw * bh);
          const centerPx = Math.round((minY + maxY) / 2) * regW + Math.round((minX + maxX) / 2);
          const centerIsHollow = cleaned[centerPx] === 0;
          const isHollow = centerIsHollow || fillRatio < 0.52;

          // Check for vertical stem near left or right edge of notehead
          let hasStem = false;
          const stemCheckLen = Math.round(s * 2.2);
          const checkCols = [
            Math.max(0, minX - 2),
            minX,
            maxX,
            Math.min(regW - 1, maxX + 2),
          ];
          for (const sc of checkCols) {
            let upRun = 0;
            let downRun = 0;
            for (let k = 1; k <= stemCheckLen; k++) {
              if (minY - k >= 0 && cleaned[(minY - k) * regW + sc]) upRun++;
              if (maxY + k < regH && cleaned[(maxY + k) * regW + sc]) downRun++;
            }
            if (upRun >= stemCheckLen * 0.6 || downRun >= stemCheckLen * 0.6) {
              hasStem = true;
              break;
            }
          }

          let duration = 'q';
          if (isHollow) {
            duration = hasStem ? 'h' : 'w';
          } else {
            duration = 'q';
          }

          const staffPos = Math.round((staff.bottomY - absCy) / (s / 2));
          const clampedPos = Math.max(-5, Math.min(13, staffPos));
          const pitch = staffPosToPitch(clampedPos, clef, keySignature);

          candidates.push({
            x: absCx,
            y: absCy,
            box: {
              x: regLeft + minX,
              y: regTop + minY,
              w: bw,
              h: bh,
            },
            staffIndex: staff.index,
            staffPos: clampedPos,
            pitch,
            pitchLabel: formatPitch(pitch),
            duration,
            isHollow,
            hasStem,
          });
        }
      }
    }

    // Sort left-to-right and deduplicate overlapping detections (e.g. top+bottom arc of a hollow note)
    candidates.sort((a, b) => a.x - b.x);
    const staffNotes = [];
    for (const c of candidates) {
      const prev = staffNotes[staffNotes.length - 1];
      if (prev && Math.abs(prev.x - c.x) < s * 0.85 && Math.abs(prev.y - c.y) < s * 1.1) {
        // Merge duplicate detection into hollow notehead
        prev.y = (prev.y + c.y) / 2;
        prev.isHollow = true;
        prev.duration = prev.hasStem || c.hasStem ? 'h' : 'w';
        const mergedPos = Math.round((staff.bottomY - prev.y) / (s / 2));
        prev.staffPos = Math.max(-5, Math.min(13, mergedPos));
        prev.pitch = staffPosToPitch(prev.staffPos, clef, keySignature);
        prev.pitchLabel = formatPitch(prev.pitch);
        continue;
      }
      staffNotes.push(c);
    }

    // Attach PDF text-layer chord symbols situated just above this staff
    const staffChords = detectedChords.filter(
      (ch) => ch.y >= staff.topY - s * 8 && ch.y <= staff.topY + s * 0.8
    );
    for (const ch of staffChords) {
      let bestNote = null;
      let bestDist = s * 3.5;
      for (const n of staffNotes) {
        const d = Math.abs(n.x - (ch.x + ch.width / 2));
        if (d < bestDist) {
          bestDist = d;
          bestNote = n;
        }
      }
      if (bestNote && !bestNote.chord) {
        bestNote.chord = ch.text;
      }
    }

    allDetectedNotes.push(...staffNotes);

    // 4e. Segment staff notes into Measures using barlines (or fallback chunks of 4 beats)
    if (staffNotes.length > 0) {
      if (staffBarlines.length > 0) {
        const boundaries = [-Infinity, ...staffBarlines, Infinity];
        for (let b = 0; b < boundaries.length - 1; b++) {
          const seg = staffNotes.filter((n) => n.x > boundaries[b] && n.x < boundaries[b + 1]);
          if (seg.length > 0) {
            measures.push(
              createMeasure(
                seg.map((sn) =>
                  createNote({
                    step: sn.pitch.step,
                    alter: sn.pitch.alter,
                    octave: sn.pitch.octave,
                    duration: sn.duration,
                    chord: sn.chord || '',
                  })
                )
              )
            );
          }
        }
      } else {
        const perMeasure = Math.max(2, timeSignature.beats || 4);
        for (let idx = 0; idx < staffNotes.length; idx += perMeasure) {
          const chunk = staffNotes.slice(idx, idx + perMeasure);
          measures.push(
            createMeasure(
              chunk.map((sn) =>
                createNote({
                  step: sn.pitch.step,
                  alter: sn.pitch.alter,
                  octave: sn.pitch.octave,
                  duration: sn.duration,
                  chord: sn.chord || '',
                })
              )
            )
          );
        }
      }
    }
  }

  const score =
    measures.length > 0
      ? {
          id: `omr_${Date.now()}`,
          title,
          subtitle: `Scanned via Optical Music Recognition (${staves.length} staves, ${allDetectedNotes.length} notes)`,
          composer: 'Imported from PDF',
          keySignature,
          originalKey: keySignature,
          transposeSemitones: 0,
          timeSignature,
          clef,
          tempo: 108,
          measures,
        }
      : null;

  return {
    staves,
    barlines: allBarlines,
    notes: allDetectedNotes,
    score,
  };
}
