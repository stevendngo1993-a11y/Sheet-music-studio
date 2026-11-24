/**
 * Web Audio Polyphonic Synthesizer & Score Playback Scheduler
 * Supports Grand Piano, Electric Piano, Warm Strings, Nylon Guitar,
 * optional chord accompaniment, metronome click, and live playhead tracking.
 */

import { pitchToMidi, midiToFreq, chordToMidiNotes } from '../music/theory.js';
import { noteBeats } from '../music/scoreModel.js';

export class ScoreSynth {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.instrument = 'piano'; // 'piano' | 'epiano' | 'strings' | 'guitar'
    this.metronome = false;
    this.accompaniment = true;
    this.loop = false;
    this.isPlaying = false;
    this._timers = [];
    this._activeNodes = [];
    this._onNotePlay = null;
    this._onStop = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.65;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playTone(midi, durationSec = 0.6, velocity = 0.45, startOffsetSec = 0) {
    const ctx = this.ensureContext();
    const now = ctx.currentTime + startOffsetSec;
    const freq = midiToFreq(midi);

    const env = ctx.createGain();
    env.connect(this.masterGain);

    const oscs = [];
    const inst = this.instrument;

    if (inst === 'piano') {
      // Warm additive piano timbre (fundamental + 2nd & 3rd harmonics with fast decay)
      const harmonics = [
        { mult: 1, type: 'triangle', gain: 0.72 },
        { mult: 2, type: 'sine', gain: 0.22 },
        { mult: 3, type: 'sine', gain: 0.08 },
      ];
      for (const h of harmonics) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = h.type;
        osc.frequency.setValueAtTime(freq * h.mult, now);
        g.gain.setValueAtTime(h.gain, now);
        osc.connect(g);
        g.connect(env);
        oscs.push(osc);
      }
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(velocity, now + 0.012);
      env.gain.exponentialRampToValueAtTime(velocity * 0.45, now + Math.min(0.18, durationSec * 0.6));
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.28);
    } else if (inst === 'epiano') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq * 4, now);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.14, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(env);
      osc2.connect(g2);
      g2.connect(env);
      oscs.push(osc1, osc2);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(velocity, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.35);
    } else if (inst === 'strings') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1800, now);
      filter.connect(env);

      for (const detune of [-5, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.detune.setValueAtTime(detune, now);
        osc.connect(filter);
        oscs.push(osc);
      }
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(velocity * 0.52, now + Math.min(0.14, durationSec * 0.4));
      env.gain.setValueAtTime(velocity * 0.48, now + Math.max(0.15, durationSec * 0.85));
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.35);
    } else {
      // Nylon guitar pluck
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, now);
      filter.frequency.exponentialRampToValueAtTime(600, now + durationSec + 0.15);
      filter.connect(env);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(filter);
      oscs.push(osc);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(velocity * 0.9, now + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.22);
    }

    for (const osc of oscs) {
      osc.start(now);
      osc.stop(now + durationSec + 0.4);
      this._activeNodes.push(osc);
    }
  }

  playPitch(pitch, durationSec = 0.45) {
    if (!pitch) return;
    this.playTone(pitchToMidi(pitch), durationSec, 0.42, 0);
  }

  playClick(accent = false) {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accent ? 1180 : 820, now);
    g.gain.setValueAtTime(accent ? 0.18 : 0.1, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  playScore(score, { onNotePlay, onStop } = {}) {
    this.stop();
    this.ensureContext();
    this.isPlaying = true;
    this._onNotePlay = onNotePlay;
    this._onStop = onStop;

    const bpm = Math.max(40, Math.min(240, score.tempo || 110));
    const secPerBeat = 60 / bpm;

    const schedulePass = () => {
      if (!this.isPlaying) return;
      let cursorBeats = 0;

      // Schedule metronome ticks
      const beatsPerMeasure = (score.timeSignature.beats * 4) / score.timeSignature.beatType;
      const totalScoreBeats = score.measures.reduce(
        (sum, m) => sum + Math.max(beatsPerMeasure, m.notes.reduce((a, n) => a + noteBeats(n), 0)),
        0
      );

      if (this.metronome) {
        const totalQuarterClicks = Math.ceil(totalScoreBeats);
        for (let b = 0; b < totalQuarterClicks; b++) {
          const tMs = b * secPerBeat * 1000;
          const isDownbeat = b % Math.max(1, Math.round(beatsPerMeasure)) === 0;
          const tid = setTimeout(() => {
            if (this.isPlaying && this.metronome) this.playClick(isDownbeat);
          }, tMs);
          this._timers.push(tid);
        }
      }

      // Schedule notes and chords
      for (const measure of score.measures) {
        for (const note of measure.notes) {
          const durBeats = noteBeats(note);
          const durSec = durBeats * secPerBeat;
          const delayMs = cursorBeats * secPerBeat * 1000;

          const tid = setTimeout(() => {
            if (!this.isPlaying) return;
            this._onNotePlay?.(note.id);

            // Dynamic velocity mapping
            const dynMap = { pp: 0.22, p: 0.3, mp: 0.38, mf: 0.46, f: 0.58, ff: 0.68 };
            const vel = dynMap[note.dynamic] || 0.46;

            if (!note.isRest && note.pitch) {
              this.playTone(pitchToMidi(note.pitch), Math.max(0.12, durSec * 0.92), vel, 0);
            }
            if (this.accompaniment && note.chord) {
              const chordNotes = chordToMidiNotes(note.chord);
              chordNotes.forEach((m, idx) => {
                this.playTone(m, Math.max(0.35, durSec * 1.4), 0.14, idx * 0.014);
              });
            }
          }, delayMs);

          this._timers.push(tid);
          cursorBeats += durBeats;
        }
      }

      const endTid = setTimeout(() => {
        if (!this.isPlaying) return;
        if (this.loop) {
          schedulePass();
        } else {
          this.stop();
        }
      }, cursorBeats * secPerBeat * 1000 + 220);
      this._timers.push(endTid);
    };

    schedulePass();
  }

  stop() {
    this.isPlaying = false;
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    for (const node of this._activeNodes) {
      try {
        node.stop();
      } catch {
        // already stopped
      }
    }
    this._activeNodes = [];
    this._onNotePlay?.(null);
    this._onStop?.();
  }
}
