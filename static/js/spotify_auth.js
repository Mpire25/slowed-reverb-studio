import { SERVER } from './config.js';
import { $id } from './dom.js';

let _pollTimer = null;

async function refreshStatus() {
  try {
    const res = await fetch(`${SERVER}/spotify/status`);
    const data = await res.json();
    _render(data.connected, data.callback_url);
    return data.connected;
  } catch {
    return null;
  }
}

function _render(connected, callbackUrl) {
  const dot = $id('spotifyStatusDot');
  const label = $id('spotifyStatusLabel');
  const hint = $id('spotifyConnectHint');
  const connectBtn = $id('spotifyConnectBtn');
  const disconnectBtn = $id('spotifyDisconnectBtn');

  dot.className = 'spotify-status-dot ' + (connected ? 'connected' : 'disconnected');
  label.textContent = connected ? 'Connected' : 'Not connected';
  hint.textContent = connected
    ? 'Spotify playlists are enabled.'
    : `Connect your Spotify account to import playlists. You'll need to add ${callbackUrl} as a Redirect URI in your Spotify app dashboard first.`;
  connectBtn.style.display = connected ? 'none' : '';
  disconnectBtn.style.display = connected ? '' : 'none';
}

export function initSpotifyAuth() {
  refreshStatus();

  $id('spotifyConnectBtn').addEventListener('click', async () => {
    try {
      const res = await fetch(`${SERVER}/spotify/auth`);
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      const popup = window.open(data.url, 'spotify-auth', 'width=500,height=650');
      if (_pollTimer) clearInterval(_pollTimer);
      _pollTimer = setInterval(async () => {
        const connected = await refreshStatus();
        if (connected || (popup && popup.closed)) {
          clearInterval(_pollTimer);
          _pollTimer = null;
        }
      }, 1000);
    } catch (e) {
      alert('Failed to start Spotify auth: ' + e.message);
    }
  });

  $id('spotifyDisconnectBtn').addEventListener('click', async () => {
    await fetch(`${SERVER}/spotify/disconnect`, { method: 'POST' });
    _render(false);
  });
}

export { refreshStatus as refreshSpotifyStatus };
