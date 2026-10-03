// =====================================================================
// SHARKROPAD HUD — Renderer Logic
// =====================================================================

(function () {
  'use strict';

  const pill = document.getElementById('hud-pill');
  const dot = document.getElementById('hud-dot');
  const layerEl = document.getElementById('hud-layer');
  const actionEl = document.getElementById('hud-action');

  let resetTimer = null;
  let currentLayer = 0;
  let currentLayerName = 'CAMADA 0';
  let currentProfile = 'PADRÃO';
  let currentColor = '#38BDF8';

  function applyTheme(color) {
    currentColor = color || '#38BDF8';
    pill.style.setProperty('--layer-color', currentColor);
    pill.style.setProperty('--layer-glow', hexToRgba(currentColor, 0.45));
    dot.style.background = currentColor;
    dot.style.boxShadow = `0 0 8px ${currentColor}`;
  }

  function hexToRgba(hex, alpha) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  let isSoundPlaying = false;

  function updateDisplay(data) {
    if (data.layer !== undefined) currentLayer = data.layer;
    if (data.layerName) currentLayerName = data.layerName;
    if (data.profile) currentProfile = data.profile;
    if (data.color || data.layerColor) applyTheme(data.color || data.layerColor);

    layerEl.textContent = currentLayerName;

    if (data.isSoundPlaying !== undefined) {
      isSoundPlaying = !!data.isSoundPlaying;
      if (isSoundPlaying) {
        actionEl.textContent = '🔊 ' + (data.soundTitle || 'TOCANDO SOM');
        actionEl.classList.add('highlight');
        pill.classList.add('playing-sound');
        if (resetTimer) clearTimeout(resetTimer);
      } else {
        pill.classList.remove('playing-sound');
        resetToRest();
      }
    } else if (data.action) {
      actionEl.textContent = data.action;
      actionEl.classList.add('highlight');
      pill.classList.add('active-press');

      // Schedule return to rest
      if (resetTimer) clearTimeout(resetTimer);
      const duration = data.isPreview ? 1800 : 1200;
      resetTimer = setTimeout(resetToRest, duration);
    } else {
      resetToRest();
    }

    // Auto-fit window width with comfortable margin for shadow
    requestAnimationFrame(() => {
      const pillWidth = pill.getBoundingClientRect().width;
      if (window.electronAPI?.resizeHUD) {
        window.electronAPI.resizeHUD(Math.ceil(pillWidth) + 24);
      }
    });
  }

  function resetToRest() {
    if (isSoundPlaying) return;
    actionEl.textContent = currentProfile || 'PADRÃO';
    actionEl.classList.remove('highlight');
    pill.classList.remove('active-press');
    resetTimer = null;
  }

  // Listen for IPC messages from main process
  if (window.electronAPI?.onHUDUpdate) {
    window.electronAPI.onHUDUpdate((data) => updateDisplay(data));
  }

  // Initial theme
  applyTheme(currentColor);
  resetToRest();
})();
