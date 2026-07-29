/* global lamejs */

importScripts('../lib/lame.min.js');

function floatChunkToInt16(input, start, end) {
  const output = new Int16Array(end - start);
  for (let sourceIndex = start, outputIndex = 0; sourceIndex < end; sourceIndex++, outputIndex++) {
    const sample = Math.max(-1, Math.min(1, input[sourceIndex]));
    output[outputIndex] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  return output;
}

self.onmessage = (event) => {
  const { leftBuffer, rightBuffer, sampleRate, bitRate = 192 } = event.data;

  try {
    const left = new Float32Array(leftBuffer);
    const right = new Float32Array(rightBuffer);
    const encoder = new lamejs.Mp3Encoder(2, sampleRate, bitRate);
    const chunkSize = 1152;
    const mp3Parts = [];
    let mp3Length = 0;

    for (let offset = 0; offset < left.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, left.length);
      const encoded = encoder.encodeBuffer(
        floatChunkToInt16(left, offset, end),
        floatChunkToInt16(right, offset, end),
      );

      if (encoded.length) {
        const part = new Uint8Array(encoded);
        mp3Parts.push(part);
        mp3Length += part.length;
      }

      if (offset % (chunkSize * 50) === 0) {
        self.postMessage({
          type: 'progress',
          percent: left.length ? Math.round((offset / left.length) * 100) : 100,
        });
      }
    }

    const flushed = encoder.flush();
    if (flushed.length) {
      const part = new Uint8Array(flushed);
      mp3Parts.push(part);
      mp3Length += part.length;
    }

    const mp3 = new Uint8Array(mp3Length);
    let writeOffset = 0;
    for (const part of mp3Parts) {
      mp3.set(part, writeOffset);
      writeOffset += part.length;
    }

    self.postMessage({ type: 'complete', mp3Buffer: mp3.buffer }, [mp3.buffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
