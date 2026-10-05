// =====================================================================
// PADPRO HUD — Renderer Logic
// =====================================================================

(function () {
  'use strict';

  const pill = document.getElementById('hud-pill');
  const dot = document.getElementById('hud-dot');
  const layerEl = document.getElementById('hud-layer');
  const actionEl = document.getElementById('hud-action');

  const hudDefault = document.getElementById('hud-default');
  const hudFlyout = document.getElementById('hud-flyout');
  const hudFlyoutIcon = document.getElementById('hud-flyout-icon');
  const hudFlyoutTitle = document.getElementById('hud-flyout-title');
  const hudFlyoutVal = document.getElementById('hud-flyout-val');
  const hudFlyoutFill = document.getElementById('hud-flyout-fill');

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

    if (data.flyout) {
      if (hudDefault) hudDefault.style.display = 'none';
      if (hudFlyout) hudFlyout.style.display = 'inline-flex';
      if (hudFlyoutTitle) hudFlyoutTitle.textContent = data.flyout.title || 'VOLUME';
      if (hudFlyoutVal) hudFlyoutVal.textContent = data.flyout.value || `${data.flyout.pct}%`;
      if (hudFlyoutFill) hudFlyoutFill.style.width = `${Math.max(0, Math.min(100, data.flyout.pct))}%`;
      if (hudFlyoutIcon && data.flyout.iconSvg) {
        hudFlyoutIcon.innerHTML = data.flyout.iconSvg;
      }
      pill.classList.add('active-press');
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(resetToRest, data.duration || 1200);
    } else if (data.isSoundPlaying !== undefined) {
      isSoundPlaying = !!data.isSoundPlaying;
      if (isSoundPlaying) {
        if (hudDefault) hudDefault.style.display = 'inline-flex';
        if (hudFlyout) hudFlyout.style.display = 'none';
        actionEl.innerHTML = '';
        const soundIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        soundIcon.setAttribute('width', '11');
        soundIcon.setAttribute('height', '11');
        soundIcon.setAttribute('viewBox', '0 0 24 24');
        soundIcon.setAttribute('fill', 'none');
        soundIcon.setAttribute('stroke', 'currentColor');
        soundIcon.setAttribute('stroke-width', '2');
        soundIcon.setAttribute('stroke-linecap', 'round');
        soundIcon.setAttribute('stroke-linejoin', 'round');
        soundIcon.style.verticalAlign = '-1px';
        soundIcon.style.marginRight = '5px';
        soundIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
        actionEl.appendChild(soundIcon);
        actionEl.appendChild(document.createTextNode(data.soundTitle || 'TOCANDO SOM'));
        actionEl.classList.add('highlight');
        pill.classList.add('playing-sound');
        if (resetTimer) clearTimeout(resetTimer);
      } else {
        pill.classList.remove('playing-sound');
        resetToRest();
      }
    } else if (data.action) {
      isSoundPlaying = false;
      pill.classList.remove('playing-sound');
      if (hudDefault) hudDefault.style.display = 'inline-flex';
      if (hudFlyout) hudFlyout.style.display = 'none';
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
    isSoundPlaying = false;
    if (hudDefault) hudDefault.style.display = 'inline-flex';
    if (hudFlyout) hudFlyout.style.display = 'none';
    actionEl.textContent = currentProfile || 'PADRÃO';
    actionEl.classList.remove('highlight');
    pill.classList.remove('playing-sound');
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
