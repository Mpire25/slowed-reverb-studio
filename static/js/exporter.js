import { state } from './state.js';
import { makeIR } from './audio.js';
import { buildID3Tag } from './id3.js';
import { getExportSuffix, sanitize, toast } from './utils.js';

export function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

export function setProgress(pct) {
  document.getElementById('progressBar').style.width = pct + '%';
}

export async function doExport(filename) {
  const confirmBtn = document.getElementById('modalConfirm');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="spinner"></span>Rendering…';
  document.getElementById('progressWrap').style.display = 'block';
  setProgress(0);

  try {
    const buf = state.audioBuffer;
    const speed = state.speed;
    const mix = state.reverbMix;
    const decay = state.reverbDecay;
    const outDuration = buf.duration / speed;
    const sr = buf.sampleRate;

    const offCtx = new OfflineAudioContext(2, Math.ceil(outDuration * sr), sr);

    const src = offCtx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;

    const dryGain = offCtx.createGain();
    const wetGain = offCtx.createGain();
    const conv = offCtx.createConvolver();
    dryGain.gain.value = 1 - mix;
    wetGain.gain.value = mix;
    conv.buffer = makeIR(offCtx, decay);

    src.connect(dryGain);
    src.connect(conv);
    conv.connect(wetGain);
    dryGain.connect(offCtx.destination);
    wetGain.connect(offCtx.destination);

    src.start(0);
    setProgress(10);

    const rendered = await offCtx.startRendering();
    setProgress(40);

    function f32ToI16(f32) {
      const i16 = new Int16Array(f32.length);
      for (let i = 0; i < f32.length; i++) {
        const v = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = v < 0 ? v * 32768 : v * 32767;
      }
      return i16;
    }

    const left  = f32ToI16(rendered.getChannelData(0));
    const right = rendered.numberOfChannels > 1 ? f32ToI16(rendered.getChannelData(1)) : left;

    // lamejs is loaded as a classic <script> and attaches to window.lamejs
    const encoder = new lamejs.Mp3Encoder(2, sr, 192);
    const chunkSize = 1152;
    const mp3Parts = [];
    const total = left.length;

    for (let i = 0; i < total; i += chunkSize) {
      const l = left.subarray(i, i + chunkSize);
      const r = right.subarray(i, i + chunkSize);
      const enc = encoder.encodeBuffer(l, r);
      if (enc.length) mp3Parts.push(new Uint8Array(enc));
      if (i % (chunkSize * 100) === 0) {
        setProgress(40 + 50 * (i / total));
        await new Promise(r => setTimeout(r, 0));
      }
    }
    const flush = encoder.flush();
    if (flush.length) mp3Parts.push(new Uint8Array(flush));
    setProgress(92);

    const title = state.title;
    const artBytes = state.artBytes
      ? new Uint8Array(state.artBytes)
      : null;
    const id3Tag = buildID3Tag(title + getExportSuffix(speed), state.artist, artBytes, state.artMime);

    const mp3Len = mp3Parts.reduce((n, p) => n + p.length, 0);
    const final = new Uint8Array(id3Tag.length + mp3Len);
    final.set(id3Tag, 0);
    let off = id3Tag.length;
    for (const p of mp3Parts) { final.set(p, off); off += p.length; }

    setProgress(98);

    const blob = new Blob([final], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.mp3') ? filename : filename + '.mp3';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setProgress(100);
    toast('Download started!', 3000, 'success');
    setTimeout(closeModal, 800);
  } catch (err) {
    toast('Export failed: ' + err.message, 5000, 'error');
    console.error(err);
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Export';
  }
}
