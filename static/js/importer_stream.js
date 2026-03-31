// @ts-check

/**
 * @callback StreamEventHandler
 * @param {any} data
 * @param {() => void} close
 * @returns {void}
 */

/**
 * @typedef {object} OpenImportStreamOptions
 * @property {string} url
 * @property {Record<string, StreamEventHandler>} events
 * @property {(message: string, close: () => void) => void} [onServerError]
 * @property {(close: () => void) => void} [onConnectionLost]
 */

function parseJsonOrNull(raw) {
  if (typeof raw !== 'string' || !raw.length) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Opens an EventSource with JSON-event helpers and unified error lifecycle.
 * Prevents duplicate server/network error callbacks after closure.
 * @param {OpenImportStreamOptions} options
 */
export function openImportStream(options) {
  const es = new EventSource(options.url);
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    if (es.readyState !== EventSource.CLOSED) {
      es.close();
    }
  };

  for (const [eventName, handler] of Object.entries(options.events)) {
    es.addEventListener(eventName, e => {
      if (closed) return;
      const parsed = parseJsonOrNull(e.data);
      handler(parsed ?? {}, close);
    });
  }

  es.addEventListener('error', e => {
    if (closed) return;
    close();
    const parsed = parseJsonOrNull(e.data);
    const message = parsed && typeof parsed.message === 'string' ? parsed.message : '';
    options.onServerError?.(message, close);
  });

  es.onerror = () => {
    if (closed || es.readyState === EventSource.CLOSED) return;
    close();
    options.onConnectionLost?.(close);
  };

  return { close };
}
