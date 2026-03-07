// ─── ID3v2 Reader ────────────────────────────────────────────────────────────
export function readID3(buf) {
  const v = new Uint8Array(buf);
  if (v[0] !== 0x49 || v[1] !== 0x44 || v[2] !== 0x33) return {}; // No ID3 tag
  const major = v[3];
  // Syncsafe size
  const tagSize = ((v[6] & 0x7f) << 21) | ((v[7] & 0x7f) << 14) |
                  ((v[8] & 0x7f) << 7)  |  (v[9] & 0x7f);
  const result = {};
  let i = 10;
  const end = 10 + tagSize;

  const dec = new TextDecoder('utf-8');
  const decLatin = new TextDecoder('latin1');

  while (i < end - 10) {
    const frameId = String.fromCharCode(v[i], v[i+1], v[i+2], v[i+3]);
    if (frameId === '\x00\x00\x00\x00') break;
    let size;
    if (major >= 4) {
      size = ((v[i+4] & 0x7f) << 21) | ((v[i+5] & 0x7f) << 14) |
             ((v[i+6] & 0x7f) << 7)  |  (v[i+7] & 0x7f);
    } else {
      size = (v[i+4] << 24) | (v[i+5] << 16) | (v[i+6] << 8) | v[i+7];
    }
    if (size <= 0) { i += 10; continue; }
    const data = v.subarray(i + 10, i + 10 + size);

    if (frameId === 'TIT2' || frameId === 'TPE1') {
      const enc = data[0];
      let text = '';
      if (enc === 0) text = decLatin.decode(data.subarray(1));
      else if (enc === 1 || enc === 2) {
        // UTF-16: strip BOM
        const raw = data.subarray(1);
        const hasBOM = raw[0] === 0xFF && raw[1] === 0xFE || raw[0] === 0xFE && raw[1] === 0xFF;
        text = new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16').decode(hasBOM ? raw : raw);
      } else {
        text = dec.decode(data.subarray(1));
      }
      result[frameId] = text.replace(/\x00/g, '').trim();
    }

    if (frameId === 'APIC') {
      // encoding(1) + mimeType(var) + \x00 + picType(1) + desc(var) + \x00 + data
      let pos = 1;
      const enc = data[0];
      // read mime
      let mimeEnd = pos;
      while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++;
      const mime = decLatin.decode(data.subarray(pos, mimeEnd)) || 'image/jpeg';
      pos = mimeEnd + 2; // skip mime \x00 and picType
      // skip description
      if (enc === 0 || enc === 3) {
        while (pos < data.length && data[pos] !== 0) pos++;
        pos++;
      } else {
        // UTF-16: null terminator is 2 bytes
        while (pos + 1 < data.length && !(data[pos] === 0 && data[pos+1] === 0)) pos += 2;
        pos += 2;
      }
      if (pos < data.length) {
        result['APIC'] = { bytes: data.subarray(pos), mime, raw: data };
      }
    }

    i += 10 + size;
  }
  return result;
}

// ─── ID3v2 Writer ────────────────────────────────────────────────────────────
export function encodeID3Frame(id, data) {
  const idBytes = new TextEncoder().encode(id);
  const frame = new Uint8Array(10 + data.length);
  frame.set(idBytes, 0);
  const s = data.length;
  frame[4] = (s >> 24) & 0xff;
  frame[5] = (s >> 16) & 0xff;
  frame[6] = (s >> 8)  & 0xff;
  frame[7] =  s        & 0xff;
  frame.set(data, 10);
  return frame;
}

export function encodeTextFrame(id, text) {
  const enc = new TextEncoder();
  const textBytes = enc.encode(text);
  const data = new Uint8Array(1 + textBytes.length);
  data[0] = 3; // UTF-8
  data.set(textBytes, 1);
  return encodeID3Frame(id, data);
}

export function encodeAPICFrame(imageBytes, mime) {
  const enc = new TextEncoder();
  const mimeBytes = enc.encode(mime || 'image/jpeg');
  // encoding(1) + mime + \x00 + picType(1) + desc(\x00)
  const data = new Uint8Array(1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length);
  let pos = 0;
  data[pos++] = 0; // Latin-1 encoding
  data.set(mimeBytes, pos); pos += mimeBytes.length;
  data[pos++] = 0; // mime null terminator
  data[pos++] = 3; // cover art
  data[pos++] = 0; // empty description
  data.set(imageBytes, pos);
  return encodeID3Frame('APIC', data);
}

export function buildID3Tag(title, artist, artBytes, artMime) {
  const frames = [];
  if (title)   frames.push(encodeTextFrame('TIT2', title));
  if (artist)  frames.push(encodeTextFrame('TPE1', artist));
  if (artBytes && artBytes.length) frames.push(encodeAPICFrame(artBytes, artMime));

  const totalFrameSize = frames.reduce((n, f) => n + f.length, 0);
  function toSyncsafe(n) {
    return [
      (n >> 21) & 0x7f,
      (n >> 14) & 0x7f,
      (n >> 7)  & 0x7f,
       n        & 0x7f,
    ];
  }
  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // ID3
  header[3] = 3; header[4] = 0; // v2.3
  header[5] = 0; // flags
  header.set(toSyncsafe(totalFrameSize), 6);

  const parts = [header, ...frames];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const tag = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { tag.set(p, off); off += p.length; }
  return tag;
}
