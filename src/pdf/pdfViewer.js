/**
 * Real PDF.js Sheet Music Viewer, Text-Layer Chord Extractor,
 * In-Place Chord Transposition Overlay & Interactive Markup Layer.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { isLikelyChordSymbol, transposeChord } from '../music/theory.js';

const BASE = import.meta.env.BASE_URL || '/';
pdfjsLib.GlobalWorkerOptions.workerSrc = `${BASE}pdfjs/pdf.worker.min.mjs`;

export class PdfSheetViewer {
  constructor(stageContainer, callbacks = {}) {
    this.stage = stageContainer;
    this.callbacks = callbacks;

    this.pdfDoc = null;
    this.pdfBytes = null;
    this.currentPage = 1;
    this.numPages = 0;
    this.zoom = 1.25;
    this.baseViewport = null;
    this.renderScale = 1.25;

    // Detected chords per page: Map<pageNum, Array<{ text, x, y, width, height, fontSize }>>
    // Coordinates stored in unscaled PDF viewport space (scale = 1)
    this.detectedChordsByPage = new Map();

    // User annotations per page: Map<pageNum, Array<Annotation>> (normalized 0..1 coords)
    this.annotationsByPage = new Map();

    // Active transposition state for in-place PDF chord overlays
    this.transposeSemitones = 0;
    this.targetKeyId = 'C';
    this.enharmonicPref = 'auto';
    this.showTransposedChords = true;

    // Optional OMR detection overlay for current page
    this.omrOverlay = null;
    this.showOmrOverlay = false;

    // Markup tool state
    this.activeTool = 'cursor'; // 'cursor' | 'chord' | 'highlight' | 'pen' | 'text' | 'whiteout'
    this.drawingStroke = null;
    this.renderTask = null;

    // DOM elements
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'pdf-page-wrapper';

    this.pdfCanvas = document.createElement('canvas');
    this.pdfCanvas.className = 'pdf-render-canvas';

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'pdf-overlay-canvas';

    this.wrapper.appendChild(this.pdfCanvas);
    this.wrapper.appendChild(this.overlayCanvas);
    this.stage.innerHTML = '';
    this.stage.appendChild(this.wrapper);

    this.attachOverlayEvents();
  }

  async loadPdf(bytes, { resetAnnotations = true } = {}) {
    // Make a copy since pdf.js transfers/detaches the ArrayBuffer sent to the worker
    this.pdfBytes = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
    const workerCopy = new Uint8Array(this.pdfBytes);

    if (this.pdfDoc) {
      try {
        await this.pdfDoc.destroy();
      } catch {
        // ignore cleanup error
      }
    }

    const loadingTask = pdfjsLib.getDocument({
      data: workerCopy,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
    });
    this.pdfDoc = await loadingTask.promise;
    this.numPages = this.pdfDoc.numPages;
    this.currentPage = 1;
    this.detectedChordsByPage.clear();
    this.omrOverlay = null;
    this.showOmrOverlay = false;
    if (resetAnnotations) {
      this.annotationsByPage.clear();
    }

    await this.renderPage(1);
    this.callbacks.onLoaded?.({
      numPages: this.numPages,
      currentPage: this.currentPage,
      chordsCount: this.getCurrentPageChords().length,
    });
  }

  async renderPage(pageNum = this.currentPage) {
    if (!this.pdfDoc) return;
    this.currentPage = Math.max(1, Math.min(this.numPages, pageNum));

    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch {
        // ignore
      }
    }

    const page = await this.pdfDoc.getPage(this.currentPage);
    this.baseViewport = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: this.zoom * dpr });
    const cssWidth = Math.round(this.baseViewport.width * this.zoom);
    const cssHeight = Math.round(this.baseViewport.height * this.zoom);
    this.renderScale = this.zoom * dpr;

    this.pdfCanvas.width = Math.round(viewport.width);
    this.pdfCanvas.height = Math.round(viewport.height);
    this.pdfCanvas.style.width = `${cssWidth}px`;
    this.pdfCanvas.style.height = `${cssHeight}px`;

    this.overlayCanvas.width = Math.round(viewport.width);
    this.overlayCanvas.height = Math.round(viewport.height);
    this.overlayCanvas.style.width = `${cssWidth}px`;
    this.overlayCanvas.style.height = `${cssHeight}px`;

    this.wrapper.style.width = `${cssWidth}px`;
    this.wrapper.style.height = `${cssHeight}px`;

    const ctx = this.pdfCanvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);

    this.renderTask = page.render({ canvasContext: ctx, viewport });
    try {
      await this.renderTask.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
      return;
    }

    // Extract text layer chord symbols if not cached for this page
    if (!this.detectedChordsByPage.has(this.currentPage)) {
      await this.extractChordsFromPage(page);
    }

    this.redrawOverlay();
    this.callbacks.onPageChange?.({
      currentPage: this.currentPage,
      numPages: this.numPages,
      chordsCount: this.getCurrentPageChords().length,
    });
  }

  async extractChordsFromPage(page) {
    const textContent = await page.getTextContent();
    const vp1 = page.getViewport({ scale: 1 });
    const chords = [];

    for (const item of textContent.items) {
      const str = (item.str || '').trim();
      if (!str) continue;

      // Support single chord token or whitespace-separated chords on a chord row
      const tokens = str.split(/\s+/);
      if (tokens.length === 1 && isLikelyChordSymbol(tokens[0])) {
        const tx = pdfjsLib.Util.transform(vp1.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(item.height) || 10;
        const x = tx[4];
        const y = tx[5] - fontHeight * 0.85;
        const width = Math.max(item.width || fontHeight * str.length * 0.6, 12);

        // Skip text right in the top title block (top 9% of page) or footer (bottom 5%)
        if (y < vp1.height * 0.08 || y > vp1.height * 0.94) continue;

        chords.push({
          text: tokens[0],
          x,
          y,
          width,
          height: fontHeight * 1.15,
          fontSize: fontHeight,
        });
      }
    }

    this.detectedChordsByPage.set(this.currentPage, chords);
  }

  getCurrentPageChords() {
    return this.detectedChordsByPage.get(this.currentPage) || [];
  }

  /**
   * Returns current page ImageData + chords scaled to canvas pixel coordinates for OMR scanning.
   */
  getScanPayload() {
    const ctx = this.pdfCanvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);
    const scale = this.renderScale;
    const scaledChords = this.getCurrentPageChords().map((c) => ({
      text: c.text,
      x: c.x * scale,
      y: c.y * scale,
      width: c.width * scale,
      height: c.height * scale,
    }));
    return { imageData, scaledChords, renderScale: scale };
  }

  setOmrOverlay(result, show = true) {
    this.omrOverlay = result;
    this.showOmrOverlay = show;
    this.redrawOverlay();
  }

  setTransposition({ semitones, targetKeyId, enharmonicPref, showTransposedChords } = {}) {
    if (semitones !== undefined) this.transposeSemitones = semitones;
    if (targetKeyId !== undefined) this.targetKeyId = targetKeyId;
    if (enharmonicPref !== undefined) this.enharmonicPref = enharmonicPref;
    if (showTransposedChords !== undefined) this.showTransposedChords = showTransposedChords;
    this.redrawOverlay();
  }

  setTool(tool) {
    this.activeTool = tool;
    this.overlayCanvas.style.cursor =
      tool === 'cursor'
        ? 'default'
        : tool === 'chord' || tool === 'text'
        ? 'text'
        : 'crosshair';
  }

  async setZoom(newZoom) {
    this.zoom = Math.max(0.5, Math.min(2.6, Number(newZoom)));
    await this.renderPage(this.currentPage);
    return this.zoom;
  }

  async fitWidth() {
    if (!this.baseViewport) return this.zoom;
    const avail = Math.max(320, this.stage.clientWidth - 48);
    return this.setZoom(Math.min(2.2, Math.max(0.6, avail / this.baseViewport.width)));
  }

  undoAnnotation() {
    const list = this.annotationsByPage.get(this.currentPage);
    if (list && list.length > 0) {
      list.pop();
      this.redrawOverlay();
    }
  }

  clearPageAnnotations() {
    this.annotationsByPage.set(this.currentPage, []);
    this.redrawOverlay();
  }

  redrawOverlay() {
    const ctx = this.overlayCanvas.getContext('2d');
    const W = this.overlayCanvas.width;
    const H = this.overlayCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const s = this.renderScale;

    // 1. In-Place Transposed PDF Chord Overlays
    if (this.showTransposedChords && this.transposeSemitones !== 0) {
      const chords = this.getCurrentPageChords();
      for (const ch of chords) {
        const transposed = transposeChord(
          ch.text,
          this.transposeSemitones,
          this.targetKeyId,
          this.enharmonicPref
        );
        const rx = ch.x * s - 3 * s;
        const ry = ch.y * s - 1 * s;
        const rw = Math.max(ch.width * s + 10 * s, transposed.length * ch.fontSize * s * 0.65);
        const rh = ch.height * s + 3 * s;

        // Clean paper-matched mask over original chord
        ctx.fillStyle = '#FFFBF2';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(180, 83, 9, 0.35)';
        ctx.lineWidth = Math.max(1, s * 0.7);
        ctx.strokeRect(rx, ry, rw, rh);

        // Transposed chord label
        ctx.fillStyle = '#B45309';
        ctx.font = `700 ${Math.round(ch.fontSize * s * 1.02)}px system-ui, -apple-system, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(transposed, rx + 3 * s, ry + 1.5 * s);
      }
    }

    // 2. OMR Visual Detection Overlay (when enabled)
    if (this.showOmrOverlay && this.omrOverlay) {
      const { staves, barlines, notes } = this.omrOverlay;

      // Detected 5-line staves
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)';
      ctx.lineWidth = Math.max(1, s * 0.7);
      for (const st of staves) {
        const h = st.bottomY - st.topY;
        ctx.fillRect(st.xMin, st.topY, st.xMax - st.xMin, h);
        ctx.strokeRect(st.xMin, st.topY, st.xMax - st.xMin, h);
      }

      // Detected barlines
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.6)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = Math.max(1.2, s * 0.8);
      for (const bl of barlines) {
        ctx.beginPath();
        ctx.moveTo(bl.x, bl.topY - 6);
        ctx.lineTo(bl.x, bl.bottomY + 6);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Detected noteheads + pitch badges
      for (const n of notes) {
        ctx.strokeStyle = '#D97706';
        ctx.fillStyle = 'rgba(217, 119, 6, 0.18)';
        ctx.lineWidth = Math.max(1.2, s * 0.8);
        ctx.fillRect(n.box.x - 2, n.box.y - 2, n.box.w + 4, n.box.h + 4);
        ctx.strokeRect(n.box.x - 2, n.box.y - 2, n.box.w + 4, n.box.h + 4);

        ctx.fillStyle = '#92400E';
        ctx.font = `700 ${Math.max(10, Math.round(9 * s))}px ui-monospace, monospace`;
        ctx.textBaseline = 'bottom';
        ctx.fillText(n.pitchLabel, n.box.x - 2, n.box.y - 3);
      }
    }

    // 3. User Markup Annotations (stored in normalized 0..1 coordinates)
    const anns = this.annotationsByPage.get(this.currentPage) || [];
    const renderList = this.drawingStroke ? [...anns, this.drawingStroke] : anns;

    for (const ann of renderList) {
      if (ann.type === 'pen' || ann.type === 'highlight') {
        if (!ann.points || ann.points.length < 2) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * W, ann.points[0].y * H);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * W, ann.points[i].y * H);
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (ann.type === 'highlight') {
          ctx.strokeStyle = 'rgba(250, 204, 21, 0.38)';
          ctx.lineWidth = Math.max(12, 16 * s);
        } else {
          ctx.strokeStyle = '#DC2626';
          ctx.lineWidth = Math.max(2, 2.2 * s);
        }
        ctx.stroke();
        ctx.restore();
      } else if (ann.type === 'whiteout') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(ann.x * W, ann.y * H, ann.w * W, ann.h * H);
      } else if (ann.type === 'chord' || ann.type === 'text') {
        const display =
          ann.type === 'chord' && this.transposeSemitones !== 0
            ? transposeChord(ann.text, this.transposeSemitones, this.targetKeyId, this.enharmonicPref)
            : ann.text;
        const fontSize = Math.round((ann.type === 'chord' ? 12 : 11) * s);
        ctx.font = `${ann.type === 'chord' ? '700' : '500'} ${fontSize}px system-ui, sans-serif`;
        const tw = ctx.measureText(display).width;
        const px = ann.x * W;
        const py = ann.y * H;

        ctx.fillStyle = ann.type === 'chord' ? 'rgba(255, 251, 235, 0.94)' : 'rgba(255, 255, 255, 0.92)';
        ctx.fillRect(px - 4, py - fontSize, tw + 8, fontSize + 6);
        ctx.strokeStyle = ann.type === 'chord' ? 'rgba(180, 83, 9, 0.45)' : 'rgba(100, 116, 139, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 4, py - fontSize, tw + 8, fontSize + 6);

        ctx.fillStyle = ann.type === 'chord' ? '#B45309' : '#1E293B';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(display, px, py);
      }
    }
  }

  attachOverlayEvents() {
    const getNormCoords = (evt) => {
      const rect = this.overlayCanvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (evt.clientY - rect.top) / rect.height)),
      };
    };

    this.overlayCanvas.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0 || this.activeTool === 'cursor') return;
      const pt = getNormCoords(evt);

      if (this.activeTool === 'chord' || this.activeTool === 'text') {
        const promptLabel =
          this.activeTool === 'chord'
            ? 'Enter chord symbol (auto-transposes with the score, e.g. Cmaj7, F#m7, G7/B):'
            : 'Enter score annotation note (e.g. "rit.", "2nd time 8va", fingering):';
        const val = window.prompt(promptLabel, this.activeTool === 'chord' ? 'Cmaj7' : '');
        if (val && val.trim()) {
          const list = this.annotationsByPage.get(this.currentPage) || [];
          list.push({ type: this.activeTool, x: pt.x, y: pt.y, text: val.trim() });
          this.annotationsByPage.set(this.currentPage, list);
          this.redrawOverlay();
        }
        return;
      }

      if (this.activeTool === 'pen' || this.activeTool === 'highlight') {
        this.drawingStroke = { type: this.activeTool, points: [pt] };
        this.overlayCanvas.setPointerCapture?.(evt.pointerId);
      } else if (this.activeTool === 'whiteout') {
        this.drawingStroke = { type: 'whiteout', x: pt.x, y: pt.y, w: 0, h: 0, startX: pt.x, startY: pt.y };
        this.overlayCanvas.setPointerCapture?.(evt.pointerId);
      }
    });

    this.overlayCanvas.addEventListener('pointermove', (evt) => {
      if (!this.drawingStroke) return;
      const pt = getNormCoords(evt);
      if (this.drawingStroke.type === 'pen' || this.drawingStroke.type === 'highlight') {
        this.drawingStroke.points.push(pt);
      } else if (this.drawingStroke.type === 'whiteout') {
        this.drawingStroke.x = Math.min(this.drawingStroke.startX, pt.x);
        this.drawingStroke.y = Math.min(this.drawingStroke.startY, pt.y);
        this.drawingStroke.w = Math.abs(pt.x - this.drawingStroke.startX);
        this.drawingStroke.h = Math.abs(pt.y - this.drawingStroke.startY);
      }
      this.redrawOverlay();
    });

    const finishStroke = () => {
      if (!this.drawingStroke) return;
      const list = this.annotationsByPage.get(this.currentPage) || [];
      list.push(this.drawingStroke);
      this.annotationsByPage.set(this.currentPage, list);
      this.drawingStroke = null;
      this.redrawOverlay();
    };

    this.overlayCanvas.addEventListener('pointerup', finishStroke);
    this.overlayCanvas.addEventListener('pointercancel', finishStroke);
  }
}
