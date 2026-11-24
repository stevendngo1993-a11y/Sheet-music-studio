/**
 * MusicXML 3.1 Import & Export
 * Enables round-trip compatibility with MuseScore, Finale, Sibelius, and Dorico.
 */

import { getKeyInfo, getKeyFromFifths, parseChord } from '../music/theory.js';
import { createNote, createMeasure } from '../music/scoreModel.js';

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DUR_TO_DIV = { w: 16, h: 8, q: 4, '8': 2, '16': 1 };
const DUR_TO_TYPE = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' };
const TYPE_TO_DUR = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16' };

export function exportMusicXml(score) {
  const keyInfo = getKeyInfo(score.keySignature);
  const clefSign = score.clef === 'bass' ? 'F' : 'G';
  const clefLine = score.clef === 'bass' ? 4 : 2;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    '  <work>',
    `    <work-title>${xmlEscape(score.title)}</work-title>`,
    '  </work>',
    '  <identification>',
    `    <creator type="composer">${xmlEscape(score.composer)}</creator>`,
    '    <encoding><software>Cadence Sheet Music Studio</software></encoding>',
    '  </identification>',
    '  <part-list>',
    '    <score-part id="P1"><part-name>Score</part-name></score-part>',
    '  </part-list>',
    '  <part id="P1">',
  ];

  score.measures.forEach((measure, idx) => {
    lines.push(`    <measure number="${idx + 1}">`);
    if (idx === 0) {
      lines.push('      <attributes>');
      lines.push('        <divisions>4</divisions>');
      lines.push(`        <key><fifths>${keyInfo.fifths}</fifths></key>`);
      lines.push(`        <time><beats>${score.timeSignature.beats}</beats><beat-type>${score.timeSignature.beatType}</beat-type></time>`);
      lines.push(`        <clef><sign>${clefSign}</sign><line>${clefLine}</line></clef>`);
      lines.push('      </attributes>');
      lines.push(`      <direction placement="above"><sound tempo="${score.tempo || 110}"/></direction>`);
    }

    for (const note of measure.notes) {
      if (note.chord) {
        const parsed = parseChord(note.chord);
        if (parsed) {
          const rootAlter = parsed.rootAcc === '#' || parsed.rootAcc === '♯' ? 1 : parsed.rootAcc === 'b' || parsed.rootAcc === '♭' ? -1 : 0;
          lines.push('      <harmony>');
          lines.push(`        <root><root-step>${parsed.rootLetter}</root-step>${rootAlter ? `<root-alter>${rootAlter}</root-alter>` : ''}</root>`);
          lines.push(`        <kind text="${xmlEscape(parsed.quality + parsed.alteration)}">${parsed.quality.startsWith('m') && !parsed.quality.startsWith('maj') ? 'minor' : 'major'}</kind>`);
          if (parsed.bassLetter) {
            const bassAlter = parsed.bassAcc === '#' || parsed.bassAcc === '♯' ? 1 : parsed.bassAcc === 'b' || parsed.bassAcc === '♭' ? -1 : 0;
            lines.push(`        <bass><bass-step>${parsed.bassLetter}</bass-step>${bassAlter ? `<bass-alter>${bassAlter}</bass-alter>` : ''}</bass>`);
          }
          lines.push('      </harmony>');
        }
      }

      if (note.dynamic) {
        lines.push(`      <direction placement="below"><direction-type><dynamics><${xmlEscape(note.dynamic)}/></dynamics></direction-type></direction>`);
      }

      const baseDiv = DUR_TO_DIV[note.duration] ?? 4;
      const durationVal = note.dotted ? Math.round(baseDiv * 1.5) : baseDiv;
      const typeName = DUR_TO_TYPE[note.duration] || 'quarter';

      lines.push('      <note>');
      if (note.isRest || !note.pitch) {
        lines.push('        <rest/>');
      } else {
        lines.push('        <pitch>');
        lines.push(`          <step>${note.pitch.step}</step>`);
        if (note.pitch.alter) {
          lines.push(`          <alter>${note.pitch.alter}</alter>`);
        }
        lines.push(`          <octave>${note.pitch.octave}</octave>`);
        lines.push('        </pitch>');
      }
      lines.push(`        <duration>${durationVal}</duration>`);
      lines.push(`        <type>${typeName}</type>`);
      if (note.dotted) {
        lines.push('        <dot/>');
      }
      if (note.lyric) {
        lines.push(`        <lyric number="1"><text>${xmlEscape(note.lyric)}</text></lyric>`);
      }
      lines.push('      </note>');
    }

    lines.push('    </measure>');
  });

  lines.push('  </part>');
  lines.push('</score-partwise>');
  return lines.join('\n');
}

export function importMusicXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error('Invalid MusicXML file.');
  }

  const title =
    doc.querySelector('work-title')?.textContent?.trim() ||
    doc.querySelector('movement-title')?.textContent?.trim() ||
    'Imported MusicXML Score';
  const composer =
    doc.querySelector('creator[type="composer"]')?.textContent?.trim() || 'Unknown Composer';

  const fifthsEl = doc.querySelector('key > fifths');
  const fifths = fifthsEl ? Number(fifthsEl.textContent) : 0;
  const keyInfo = getKeyFromFifths(Number.isFinite(fifths) ? fifths : 0);

  const beats = Number(doc.querySelector('time > beats')?.textContent || 4);
  const beatType = Number(doc.querySelector('time > beat-type')?.textContent || 4);
  const clefSign = doc.querySelector('clef > sign')?.textContent?.trim() || 'G';
  const clef = clefSign === 'F' ? 'bass' : 'treble';

  const soundTempo = doc.querySelector('sound[tempo]')?.getAttribute('tempo');
  const tempo = soundTempo ? Math.round(Number(soundTempo)) : 110;

  const partEl = doc.querySelector('part');
  const measureEls = partEl ? Array.from(partEl.querySelectorAll('measure')) : [];
  const measures = [];

  for (const mEl of measureEls) {
    const notes = [];
    let pendingChord = '';
    let pendingDynamic = '';

    for (const child of Array.from(mEl.children)) {
      if (child.tagName === 'harmony') {
        const rootStep = child.querySelector('root > root-step')?.textContent?.trim();
        const rootAlter = Number(child.querySelector('root > root-alter')?.textContent || 0);
        const kindEl = child.querySelector('kind');
        const kindText = kindEl?.getAttribute('text');
        const kindVal = kindEl?.textContent?.trim() || '';
        const bassStep = child.querySelector('bass > bass-step')?.textContent?.trim();
        const bassAlter = Number(child.querySelector('bass > bass-alter')?.textContent || 0);
        if (rootStep) {
          const acc = rootAlter === 1 ? '#' : rootAlter === -1 ? 'b' : '';
          let suffix = kindText !== null ? kindText : kindVal === 'minor' ? 'm' : kindVal === 'dominant' ? '7' : '';
          let chord = `${rootStep}${acc}${suffix}`;
          if (bassStep) {
            const bAcc = bassAlter === 1 ? '#' : bassAlter === -1 ? 'b' : '';
            chord += `/${bassStep}${bAcc}`;
          }
          pendingChord = chord;
        }
      } else if (child.tagName === 'direction') {
        const dynEl = child.querySelector('dynamics > *');
        if (dynEl) pendingDynamic = dynEl.tagName;
      } else if (child.tagName === 'note') {
        // Skip chord-stack simultaneous notes for monophonic staff view
        if (child.querySelector('chord')) continue;
        const isRest = Boolean(child.querySelector('rest'));
        const typeStr = child.querySelector('type')?.textContent?.trim() || 'quarter';
        const duration = TYPE_TO_DUR[typeStr] || 'q';
        const dotted = Boolean(child.querySelector('dot'));
        const lyric = child.querySelector('lyric > text')?.textContent?.trim() || '';

        if (isRest) {
          notes.push(
            createNote({
              isRest: true,
              duration,
              dotted,
              chord: pendingChord,
              dynamic: pendingDynamic,
            })
          );
        } else {
          const step = child.querySelector('pitch > step')?.textContent?.trim() || 'C';
          const alter = Number(child.querySelector('pitch > alter')?.textContent || 0);
          const octave = Number(child.querySelector('pitch > octave')?.textContent || 4);
          notes.push(
            createNote({
              step,
              alter,
              octave,
              duration,
              dotted,
              chord: pendingChord,
              dynamic: pendingDynamic,
              lyric,
            })
          );
        }
        pendingChord = '';
        pendingDynamic = '';
      }
    }

    if (notes.length > 0) {
      measures.push(createMeasure(notes));
    }
  }

  return {
    id: `mxml_${Date.now()}`,
    title,
    subtitle: 'Imported from MusicXML',
    composer,
    keySignature: keyInfo.id,
    originalKey: keyInfo.id,
    transposeSemitones: 0,
    timeSignature: { beats: beats || 4, beatType: beatType || 4 },
    clef,
    tempo: Number.isFinite(tempo) ? tempo : 110,
    measures: measures.length > 0 ? measures : [createMeasure([createNote({ isRest: true, duration: 'w' })])],
  };
}
