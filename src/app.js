// =====================================================================
// PADPRO CONFIGURATOR — Main Application Logic v2.0
// =====================================================================

(function () {
  'use strict';

  // ===================================================================
  // STATE
  // ===================================================================
  let currentPage = 'keys';
  let currentLayer = 0;
  let selectedKeyIndex = -1;  // -1 = none, 0-11 = key
  let activeDualTarget = 'click'; // 'click' or 'hold'
  let isRecording = false;
  let recordedKeys = [];
  let oledResetTimer = null;
  let lastUserLayerClickTime = 0;

  const PRESET_COLORS = [
    '#38BDF8', // Cyan/Sky
    '#F87171', // Red
    '#FB923C', // Orange
    '#4ADE80', // Green
    '#A78BFA', // Purple
    '#F472B6', // Pink
    '#FBBF24', // Amber
    '#2DD4BF'  // Teal
  ];

  // Helper: Hex to RGBA
  function hexToRgba(hex, alpha) {
    let c = (hex || '#38BDF8').replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  // ===================================================================
  // INIT
  // ===================================================================
  async function initApp() {
    try {
      await window.configStore.init();
    } catch (e) {
      console.error('ConfigStore init failed:', e);
    }

    try {
      const config = window.configStore.getConfig();
      await window.i18n.init(config?.language || 'pt-BR');
    } catch (e) {
      console.error('i18n init failed:', e);
    }

    // Initial render
    try {
      applyCurrentLayerTheme();
      renderLayerSelector();
      renderColorPalette();
      await refreshSoundpadSoundMap();
      renderPadGrid();
      renderOLED();
      renderEncoderCaption();
      showKeyConfigEmpty();
      refreshPorts();
      checkSoundpadStatus();
      syncSettingsToggles();
      renderEncoderPage();
      renderMacroLibrary();
      renderMacroKeyPicker();
      initCustomizationPage();
      initAutoUpdaterUI();
    } catch (e) {
      console.error('Initial render failed:', e);
    }

    // Hardware Physical Event Listener
    if (window.api?.onPadEvent) {
      window.api.onPadEvent((event) => handlePhysicalPadEvent(event));
    }

    // Soundpad Real-time Update Listener from backend
    if (window.api?.onSoundpadUpdated) {
      window.api.onSoundpadUpdated(() => refreshSoundpadSoundMap(false));
    }

    // Soundpad Live Playback Tracking Listener
    if (window.api?.onSoundPlaying) {
      window.api.onSoundPlaying((data) => {
        if (data.playing) {
          setOLEDContent('TOCANDO SOM', data.soundTitle || 'SOUNDPAD', 0);
        } else {
          renderOLED();
        }
      });
    }

    // Soundpad Manual Sync Buttons (Keys page & Soundpad page)
    document.getElementById('btn-quick-sync-soundpad')?.addEventListener('click', () => triggerManualSoundpadSync());
    document.getElementById('btn-sync-soundpad-page')?.addEventListener('click', () => triggerManualSoundpadSync());

    // HUD Mode Change Listener (e.g. from System Tray)
    if (window.api?.onHUDModeChange) {
      window.api.onHUDModeChange(() => syncSettingsToggles());
    }

    // Serial Status & Logging Listener
    initSerialMonitoring();

    // Periodic checks
    setInterval(() => { try { refreshPorts(); } catch(e) {} }, 8000);
    setInterval(() => { try { checkSoundpadStatus(); } catch(e) {} }, 12000);
    setInterval(() => { try { refreshSoundpadSoundMap(false); } catch(e) {} }, 4500);

    // Responsive marquee re-evaluation on window resize
    window.addEventListener('resize', () => {
      padGrid?.querySelectorAll('.pad-key').forEach(updateKeyMarquee);
    });
  }

  // Unified hardware status updater across all UI elements (top bar, sidebar, settings)
  function updateHardwareStatus(connected, port) {
    const statusPill = document.getElementById('serial-status-pill');
    const statusText = document.getElementById('serial-status-text');
    const logPortTag = document.getElementById('log-port-tag');
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const portEl = document.getElementById('status-port');
    const serialInfo = document.getElementById('serial-port-info');

    if (connected) {
      if (statusPill) statusPill.className = 'serial-status-pill connected';
      if (statusText) statusText.textContent = `Pad Conectado (${port || 'USB'})`;
      if (logPortTag) logPortTag.textContent = `${port || 'USB'} ATIVA`;

      if (dot) dot.className = 'status-dot connected';
      if (text) text.textContent = 'PAD Pro Conectado';
      if (portEl) portEl.textContent = port || 'USB';
      if (serialInfo) serialInfo.textContent = `${port || 'USB'} (PAD Pro)`;
    } else {
      if (statusPill) statusPill.className = 'serial-status-pill disconnected';
      if (statusText) statusText.textContent = 'Buscando Pad...';
      if (logPortTag) logPortTag.textContent = 'Procurando porta...';

      if (dot) dot.className = 'status-dot';
      if (text) text.textContent = 'PAD Pro Desconectado';
      if (portEl) portEl.textContent = '—';
      if (serialInfo) serialInfo.textContent = 'Nenhum dispositivo encontrado';
    }

    const chassisPort = document.getElementById('pad-chassis-port');
    if (chassisPort) {
      chassisPort.classList.toggle('connected', !!connected);
    }

    const btnUpdatePad = document.getElementById('btn-sidebar-update-pad');
    if (btnUpdatePad) {
      btnUpdatePad.classList.toggle('hidden', !connected);
    }
  }

  // ===================================================================
  // SERIAL STATUS & DEBUG CONSOLE
  // ===================================================================
  function initSerialMonitoring() {
    const btnToggleLogs = document.getElementById('btn-toggle-logs');
    const logDrawer = document.getElementById('serial-log-drawer');
    const btnCloseLogs = document.getElementById('btn-close-logs');
    const btnClearLogs = document.getElementById('btn-clear-logs');
    const logBody = document.getElementById('serial-log-body');
    const btnUpdatePad = document.getElementById('btn-sidebar-update-pad');

    // Sidebar Update to Pad Button Handler (Audio 4)
    if (btnUpdatePad) {
      btnUpdatePad.addEventListener('click', async () => {
        if (btnUpdatePad.classList.contains('loading')) return;
        btnUpdatePad.classList.add('loading');
        const textSpan = btnUpdatePad.querySelector('.btn-update-text');
        const originalText = textSpan ? textSpan.textContent : 'Atualizar Pad';
        if (textSpan) textSpan.textContent = 'Atualizando...';

        try {
          if (window.api?.forceSyncPad) {
            await window.api.forceSyncPad();
          }
          btnUpdatePad.classList.remove('loading');
          btnUpdatePad.classList.add('success');
          if (textSpan) textSpan.textContent = 'Atualizado ✓';
          showToast('Configurações sincronizadas com sucesso no PAD Pro!', 'success');
          setTimeout(() => {
            btnUpdatePad.classList.remove('success');
            if (textSpan) textSpan.textContent = originalText;
          }, 2500);
        } catch (err) {
          btnUpdatePad.classList.remove('loading');
          if (textSpan) textSpan.textContent = originalText;
          showToast(`Erro ao sincronizar com o Pad: ${err.message}`, 'error');
        }
      });
    }

    // Initialize Developer Mode visibility for Serial Log button
    const isDev = !!window.configStore.getConfig()?.system?.developerMode;
    btnToggleLogs?.classList.toggle('hidden', !isDev);

    // Query initial state
    window.api?.getSerialStatus?.().then((res) => {
      if (res) updateHardwareStatus(res.connected, res.port);
    });

    // Listen for live status changes
    window.api?.onSerialStatus?.((data) => {
      updateHardwareStatus(data.connected, data.port);
    });

    // Drawer toggle
    btnToggleLogs?.addEventListener('click', () => {
      logDrawer?.classList.toggle('hidden');
      btnToggleLogs?.classList.toggle('active');
    });

    btnCloseLogs?.addEventListener('click', () => {
      logDrawer?.classList.add('hidden');
      btnToggleLogs?.classList.remove('active');
    });

    btnClearLogs?.addEventListener('click', () => {
      if (logBody) logBody.innerHTML = '';
    });

    document.getElementById('btn-copy-logs')?.addEventListener('click', async () => {
      if (!logBody) return;
      const lines = Array.from(logBody.querySelectorAll('.log-line')).map(l => l.textContent).join('\n');
      try {
        await navigator.clipboard.writeText(lines);
        showToast('Logs copiados para a área de transferência!', 'success');
      } catch {
        showToast('Erro ao copiar logs.', 'error');
      }
    });

    document.getElementById('btn-export-logs')?.addEventListener('click', async () => {
      if (!logBody) return;
      const lines = Array.from(logBody.querySelectorAll('.log-line')).map(l => l.textContent).join('\n');
      if (window.api?.exportSerialLogs) {
        const res = await window.api.exportSerialLogs(lines);
        if (res?.success) {
          showToast(`Logs exportados para: ${res.filePath}`, 'success');
        }
      }
    });

    function appendLog(line) {
      if (!logBody) return;
      const el = document.createElement('div');
      el.className = 'log-line';
      if (line.includes('[RX]')) el.classList.add('rx');
      else if (line.includes('[Serial TX]')) el.classList.add('tx');
      else if (line.includes('ERRO')) el.classList.add('error');
      else el.classList.add('system');

      el.textContent = line;
      logBody.appendChild(el);
      logBody.scrollTop = logBody.scrollHeight;
    }

    // Load recent logs
    window.api?.getRecentLogs?.().then((logs) => {
      if (Array.isArray(logs) && logBody) {
        logs.forEach(appendLog);
      }
    });

    // Listen for incoming live logs
    window.api?.onLogMessage?.((line) => {
      appendLog(line);
    });
  }

  // ===================================================================
  // TITLEBAR CONTROLS
  // ===================================================================
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.api?.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.api?.maximize());
  document.getElementById('btn-close')?.addEventListener('click', () => window.api?.close());

  // ===================================================================
  // SIDEBAR NAVIGATION
  // ===================================================================
  const sidebarItems = document.querySelectorAll('.sidebar-item[data-page]');
  const pages = document.querySelectorAll('.page');

  sidebarItems.forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigateTo(page);
    });
  });

  function navigateTo(page) {
    currentPage = page;
    sidebarItems.forEach(i => i.classList.toggle('active', i.dataset.page === page));
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

    if (page === 'encoder') {
      encoderTargetLayer = currentLayer;
      renderEncoderPage();
    }
    if (page === 'macro') {
      renderMacroLibrary();
    }
    if (page === 'soundpad') {
      checkSoundpadStatus();
      renderSoundpadPageSounds();
    }
    if (page === 'customization') {
      updateOledSimulator();
    }
  }

  // ===================================================================
  // LAYER THEME & ACCENTS
  // ===================================================================
  function applyCurrentLayerTheme() {
    const layer = window.configStore.getLayer(currentLayer);
    const color = layer?.color || '#38BDF8';
    document.documentElement.style.setProperty('--active-layer-color', color);
    document.documentElement.style.setProperty('--active-layer-glow', hexToRgba(color, 0.4));
  }

  // ===================================================================
  // PAD GRID — 12 Keys (3x4)
  // ===================================================================
  const padGrid = document.getElementById('pad-grid');
  let soundpadSoundMap = {};
  let soundpadAllSounds = {};
  let isSyncingSoundpad = false;

  async function refreshSoundpadSoundMap(showToastFeedback = false) {
    if (!window.api) return;
    try {
      // 1. Get all detected sounds from Soundpad cache
      if (window.api.getSoundpadCache) {
        soundpadAllSounds = (await window.api.getSoundpadCache()) || {};
      }

      // 2. Resolve pad shortcuts
      const config = window.configStore.getConfig();
      const shortcuts = new Set();
      (config?.layers || []).forEach(layer => {
        if (!layer?.keys) return;
        Object.values(layer.keys).forEach(k => {
          const sc = formatKeyShortcutRaw(k);
          if (sc) shortcuts.add(sc);
        });
      });

      if (shortcuts.size > 0 && window.api.resolveSoundpadKeys) {
        const resolved = await window.api.resolveSoundpadKeys(Array.from(shortcuts));
        soundpadSoundMap = resolved || {};
      } else {
        soundpadSoundMap = {};
      }

      renderPadGrid();
      updateSoundpadKeyHint();
      renderSoundpadPageSounds();

      if (showToastFeedback) {
        const totalCount = Object.keys(soundpadAllSounds).length;
        if (totalCount > 0) {
          showToast(`${totalCount} áudio(s) do Soundpad sincronizado(s)!`, 'success');
        } else {
          showToast('Soundpad sincronizado! (Nenhum som com atalho detectado)', 'info');
        }
      }
    } catch (e) {
      console.warn('Erro ao sincronizar atalhos do Soundpad:', e);
      if (showToastFeedback) {
        showToast('Erro ao sincronizar com o Soundpad', 'error');
      }
    }
  }

  async function triggerManualSoundpadSync() {
    if (isSyncingSoundpad) return;
    isSyncingSoundpad = true;

    // Spin icons on sync buttons
    const syncButtons = document.querySelectorAll('.btn-soundpad-sync');
    syncButtons.forEach(btn => btn.classList.add('syncing'));

    try {
      if (window.api?.refreshSoundpad) {
        const res = await window.api.refreshSoundpad();
        if (res?.sounds) {
          soundpadAllSounds = res.sounds;
        }
      }
      await refreshSoundpadSoundMap(true);
      updateSoundpadSyncTimestamp();
    } catch (err) {
      console.error('Falha ao sincronizar Soundpad:', err);
      showToast('Falha na comunicação com o Soundpad', 'error');
    } finally {
      setTimeout(() => {
        syncButtons.forEach(btn => btn.classList.remove('syncing'));
        isSyncingSoundpad = false;
      }, 500);
    }
  }

  function updateSoundpadSyncTimestamp() {
    const timeEl = document.getElementById('soundpad-last-sync-text');
    if (timeEl) {
      const timeStr = new Date().toLocaleTimeString();
      timeEl.textContent = `Última sincronização às ${timeStr}`;
    }
  }

  function formatModsVkToShortcut(keyStr) {
    const parts = keyStr.split('_');
    if (parts.length !== 2) return keyStr;
    const mods = parseInt(parts[0]);
    const vk = parseInt(parts[1]);
    const modLabels = [];
    if (mods & 2) modLabels.push('Ctrl');
    if (mods & 1) modLabels.push('Alt');
    if (mods & 4) modLabels.push('Shift');
    if (mods & 8) modLabels.push('Win');

    let vkLabel = `Tecla ${vk}`;
    if (vk >= 112 && vk <= 135) {
      vkLabel = `F${vk - 112 + 1}`;
    } else if (vk >= 65 && vk <= 90) {
      vkLabel = String.fromCharCode(vk);
    } else if (vk >= 48 && vk <= 57) {
      vkLabel = String.fromCharCode(vk);
    }
    return [...modLabels, vkLabel].join(' + ');
  }

  function renderSoundpadPageSounds() {
    const listEl = document.getElementById('soundpad-sounds-list');
    const badgeEl = document.getElementById('soundpad-sounds-count');
    if (!listEl) return;

    const entries = Object.entries(soundpadAllSounds || {});
    if (badgeEl) {
      badgeEl.textContent = `${entries.length} som(ns)`;
    }

    if (entries.length === 0) {
      listEl.innerHTML = '<div class="soundpad-empty-hint">Nenhum som com tecla de atalho encontrado no Soundpad.<br><small style="color: var(--text-muted); opacity: 0.8; margin-top: 4px; display: block;">Defina teclas de atalho (Hotkeys) nos seus sons dentro do Soundpad para vinculá-los ao PAD Pro.</small></div>';
      return;
    }

    listEl.innerHTML = entries.map(([key, title]) => `
      <div class="soundpad-sound-item">
        <span class="soundpad-sound-title" title="${escapeHtml(title)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
          <span>${escapeHtml(title)}</span>
        </span>
        <span class="soundpad-sound-hotkey">${formatModsVkToShortcut(key)}</span>
      </div>
    `).join('');
  }


  function formatKeyShortcutRaw(keyData) {
    if (!keyData) return '';
    if (keyData.type === 'combo' && Array.isArray(keyData.value)) {
      return keyData.value.join(' + ');
    }
    if (keyData.type === 'key') {
      return keyData.value || '';
    }
    return '';
  }

  function formatKeyShortcutDisplay(keyData) {
    if (!keyData) return '—';
    if (keyData.type === 'fixed' && keyData.value === 'layer-switch') return 'Troca Camada';
    if (keyData.type === 'function' || keyData.type === 'special') {
      const funcLabels = {
        'layer-switch': 'Troca Camada',
        'zoom_in': 'Zoom In (+)',
        'zoom_out': 'Zoom Out (-)',
        'zoom_reset': 'Resetar Zoom',
        'brightness_up': 'Brilho (+)',
        'brightness_down': 'Brilho (-)',
        'volume_up': 'Volume (+)',
        'volume_down': 'Volume (-)',
        'mute': 'Mute'
      };
      return funcLabels[keyData.value] || keyData.value;
    }
    if (keyData.type === 'media') {
      const mediaLabels = {
        play_pause: 'Play/Pause', stop: 'Stop', prev: 'Anterior',
        next: 'Próxima', volume_up: 'Volume (+)', volume_down: 'Volume (-)', mute: 'Mute'
      };
      return mediaLabels[keyData.value] || keyData.value;
    }
    if (keyData.type === 'mouse') {
      const mouseLabels = {
        click_left: 'Clique Esq', click_right: 'Clique Dir', click_middle: 'Clique Meio',
        scroll_up: 'Scroll Cima', scroll_down: 'Scroll Baixo'
      };
      return mouseLabels[keyData.value] || keyData.value;
    }
    if (keyData.type === 'macro') {
      return keyData.name || keyData.label || '[MACRO]';
    }
    if (keyData.type === 'url') {
      return keyData.value ? `🌐 ${keyData.value.replace(/^https?:\/\//i, '').replace(/^www\./i, '')}` : 'Abrir URL';
    }
    if (keyData.type === 'combo' && Array.isArray(keyData.value)) {
      return keyData.value.join('+');
    }
    return keyData.value || '—';
  }

  function getKeyDisplayInfo(keyData) {
    if (!keyData) return { label: '—', sublabel: '' };

    const rawShortcut = formatKeyShortcutRaw(keyData);
    const soundTitle = rawShortcut ? soundpadSoundMap[rawShortcut] : null;
    const baseDisplay = formatKeyShortcutDisplay(keyData);
    const hasDual = !!(keyData.holdAction && keyData.holdAction !== 'none');

    let title = '';
    let isTitleCustom = false;

    if (keyData.label && keyData.label.trim()) {
      title = keyData.label.trim();
      isTitleCustom = true;
    } else if (soundTitle) {
      title = soundTitle;
      isTitleCustom = true;
    } else if (keyData.type === 'fixed' || keyData.value === 'layer-switch') {
      title = 'Camada';
      isTitleCustom = true;
    } else if (keyData.type === 'macro') {
      title = keyData.name || 'Macro';
      isTitleCustom = true;
    } else if (keyData.type === 'function') {
      const fnTitles = {
        'zoom_in': 'Zoom +',
        'zoom_out': 'Zoom -',
        'zoom_reset': 'Zoom 100%',
        'brightness_up': 'Brilho +',
        'brightness_down': 'Brilho -',
        'volume_up': 'Vol +',
        'volume_down': 'Vol -',
        'mute': 'Mute',
        'discord_mute': '🎙 Mute',
        'discord_deafen': '🎧 Deafen'
      };
      title = fnTitles[keyData.value] || baseDisplay;
      isTitleCustom = true;
    } else if (keyData.type === 'media') {
      const mediaTitles = {
        play_pause: 'Play', stop: 'Stop', prev: 'Ant',
        next: 'Próx', volume_up: 'Vol +', volume_down: 'Vol -', mute: 'Mute'
      };
      title = mediaTitles[keyData.value] || baseDisplay;
      isTitleCustom = true;
    } else if (keyData.type === 'mouse') {
      const mouseTitles = {
        click_left: '🖱 Esq', click_right: '🖱 Dir', click_middle: '🖱 Meio',
        scroll_up: '📜 Cima', scroll_down: '📜 Baixo'
      };
      title = mouseTitles[keyData.value] || baseDisplay;
      isTitleCustom = true;
    } else if (keyData.type === 'url') {
      if (Array.isArray(keyData.urls) && keyData.urls.length > 1) {
        title = keyData.label || `🌐 ${keyData.urls.length} Links`;
      } else {
        const u = (Array.isArray(keyData.urls) && keyData.urls[0]) || keyData.value || '';
        title = keyData.name || keyData.label || (u ? `🌐 ${u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]}` : '🌐 URL');
      }
      isTitleCustom = true;
    } else {
      title = baseDisplay;
    }

    let sublabel = '';
    if (isTitleCustom) {
      sublabel = baseDisplay;
      if (hasDual) {
        sublabel += ' · ⏱';
      }
    } else {
      if (hasDual) {
        sublabel = '⏱ Dupla';
      }
    }

    return { label: title, sublabel };
  }

  function getKeyDisplayLabel(keyData) {
    return getKeyDisplayInfo(keyData).label;
  }

  function getKeyDisplaySublabel(keyData) {
    return getKeyDisplayInfo(keyData).sublabel;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateKeyMarquee(keyEl) {
    if (!keyEl) return;
    const labelEl = keyEl.querySelector('.pad-key-label');
    const contentEl = keyEl.querySelector('.marquee-content:not(.marquee-clone)');
    if (!labelEl || !contentEl) return;

    // Check if the natural text width exceeds the available container width
    const isOverflowing = contentEl.scrollWidth > (labelEl.clientWidth + 1);
    if (isOverflowing) {
      labelEl.classList.add('has-marquee');
      // Set duration based on length: smooth reading speed ~26px per second
      const dur = Math.max(3.5, Math.min(12, contentEl.scrollWidth / 26));
      labelEl.style.setProperty('--marquee-duration', `${dur.toFixed(1)}s`);
    } else {
      labelEl.classList.remove('has-marquee');
    }
  }

  function renderPadGrid() {
    if (!padGrid) return;
    padGrid.innerHTML = '';
    const layer = window.configStore.getLayer(currentLayer);

    for (let i = 0; i < 12; i++) {
      const key = document.createElement('div');
      key.className = 'pad-key';
      key.dataset.index = i;

      const keyData = layer?.keys?.[i] ?? null;
      const { label, sublabel } = getKeyDisplayInfo(keyData);
      const safeLabel = escapeHtml(label);
      const safeSublabel = escapeHtml(sublabel);

      if (keyData?.fixed) {
        key.classList.add('fixed');
      }
      if (i === selectedKeyIndex) {
        key.classList.add('selected');
      }

      key.innerHTML = `
        <div class="pad-key-label" title="${safeLabel}">
          <div class="marquee-track">
            <span class="marquee-content">${safeLabel}</span>
            <span class="marquee-content marquee-clone" aria-hidden="true">${safeLabel}</span>
          </div>
        </div>
        <span class="pad-key-sublabel">${safeSublabel}</span>
      `;

      key.addEventListener('click', () => selectKey(i));
      key.addEventListener('mouseenter', () => updateKeyMarquee(key));
      padGrid.appendChild(key);
    }

    // Measure after keys are attached to DOM
    requestAnimationFrame(() => {
      padGrid.querySelectorAll('.pad-key').forEach(updateKeyMarquee);
    });
  }


  // ===================================================================
  // PHYSICAL PAD HARDWARE FEEDBACK (REAL TIME)
  // ===================================================================
  function handlePhysicalPadEvent(event) {
    if (!event) return;

    // 1. Layer switch event from physical pad
    if (event.type === 'layer-change') {
      // If user recently switched layer manually in configurator, prevent hardware bounce
      if (Date.now() - lastUserLayerClickTime < 2500) {
        return;
      }
      if (event.layer !== undefined && event.layer !== currentLayer) {
        currentLayer = event.layer;
        applyCurrentLayerTheme();
        renderLayerSelector();
        renderColorPalette();
        renderPadGrid();
        renderOLED();
        renderEncoderCaption();
      }
      return;
    }

    // 2. Key press or Preview event
    if (event.type === 'key-press' || event.type === 'preview') {
      // Highlight physical button on pad visual (if enabled)
      const custApp = window.configStore.getCustomization()?.app;
      if (custApp?.hardwareFeedback !== false) {
        const keyEl = padGrid?.querySelector(`.pad-key[data-index="${event.keyIndex}"]`);
        if (keyEl) {
          keyEl.classList.add('physical-pressed');
          if (!event.isPreview) {
            setTimeout(() => {
              if (!keyEl.dataset.holding) {
                keyEl.classList.remove('physical-pressed');
              }
            }, 350);
          } else {
            keyEl.dataset.holding = 'true';
          }
        }
      }

      // Update OLED screen (both on virtual pad and customization simulator)
      const l1 = event.isPreview ? '🔍 ESPIAR SOM' : (event.soundTitle ? '🔊 SOUNDPAD' : `B${event.keyIndex} PRESS`);
      const l2 = event.soundTitle || event.keyName || 'Disparado';
      setOLEDContent(l1, l2, event.isPreview ? 2500 : 1300);
      return;
    }

    // 3. Key release event
    if (event.type === 'key-up') {
      const keyEl = padGrid?.querySelector(`.pad-key[data-index="${event.keyIndex}"]`);
      if (keyEl) {
        delete keyEl.dataset.holding;
        keyEl.classList.remove('physical-pressed');
      }
      return;
    }

    // 4. Encoder turn event from physical pad
    if (event.type === 'encoder-turn') {
      const deg = event.direction === 'cw' ? 30 : -30;
      rotateKnobVisual(deg, event.direction);
      triggerEncoderFeedbackOLED(event.direction);
      return;
    }

    // 5. Encoder click event from physical pad
    if (event.type === 'encoder-click') {
      triggerKnobPressVisual();
      setOLEDContent('ENCODER', 'CLIQUE', 1200);
      return;
    }
  }

  // ===================================================================
  // OLED DISPLAY (SYNCHRONIZED WITH CUSTOMIZATION SIMULATOR)
  // ===================================================================
  function renderOLED() {
    const oledLayer = document.getElementById('pad-oled-layer');
    const oledSub = document.getElementById('pad-oled-sub');
    const layer = window.configStore.getLayer(currentLayer);
    const layerName = layer?.name || `CAMADA ${currentLayer}`;
    const profile = layer?.profile || 'PERSONALIZADO';

    if (oledLayer) oledLayer.textContent = layerName;
    if (oledSub) oledSub.textContent = profile;
    oledResetTimer = null;

    updateOledSimulator(layerName, profile);
  }

  function setOLEDContent(line1, line2, duration = 1200) {
    const oledLayer = document.getElementById('pad-oled-layer');
    const oledSub = document.getElementById('pad-oled-sub');
    if (oledLayer) oledLayer.textContent = line1;
    if (oledSub) oledSub.textContent = line2;

    updateOledSimulator(line1, line2);

    if (oledResetTimer) clearTimeout(oledResetTimer);
    if (duration > 0) {
      oledResetTimer = setTimeout(renderOLED, duration);
    }
  }

  function renderEncoderCaption() {
    const caption = document.getElementById('encoder-caption');
    const encoder = window.configStore.getLayerEncoder(currentLayer);
    const labels = {
      volume: 'VOLUME',
      brightness: 'BRILHO',
      scroll: 'SCROLL',
      media: 'MÍDIA',
      zoom: 'ZOOM',
      video: 'VÍDEO',
      custom: 'CUSTOM'
    };
    if (caption) {
      caption.textContent = labels[encoder?.function] || 'ENCODER';
    }
  }

  // ===================================================================
  // ROTARY ENCODER LOGIC & INTERACTIVE DRAG / ROTATION
  // ===================================================================
  let currentKnobRotation = 0;

  function setKnobRotation(angle) {
    currentKnobRotation = angle;
    const encoderKnobCore = document.getElementById('encoder-knob-core');
    if (encoderKnobCore) {
      encoderKnobCore.style.transform = `rotate(${angle}deg)`;
    }
    const padKnobRing = document.querySelector('#pad-encoder .knob-outer-ring');
    if (padKnobRing) {
      padKnobRing.style.transform = `rotate(${angle}deg)`;
    }
  }

  function rotateKnobVisual(degreesDelta, flashBadge = null) {
    setKnobRotation(currentKnobRotation + degreesDelta);

    if (flashBadge) {
      const badgeEl = document.querySelector(`.direction-badge.${flashBadge}`);
      if (badgeEl) {
        badgeEl.style.boxShadow = '0 0 12px currentColor';
        badgeEl.style.transform = 'scale(1.08)';
        badgeEl.style.transition = 'all 0.15s ease';
        setTimeout(() => {
          badgeEl.style.boxShadow = '';
          badgeEl.style.transform = '';
        }, 220);
      }
    }
  }

  function triggerKnobPressVisual() {
    const encoderKnobCore = document.getElementById('encoder-knob-core');
    if (encoderKnobCore) {
      encoderKnobCore.classList.add('knob-pressed');
      setTimeout(() => encoderKnobCore.classList.remove('knob-pressed'), 200);
    }
    const padEncoder = document.getElementById('pad-encoder');
    if (padEncoder) {
      padEncoder.style.transform = 'scale(0.93)';
      setTimeout(() => { padEncoder.style.transform = ''; }, 150);
    }
    const clickBadge = document.querySelector('.direction-badge.click');
    if (clickBadge) {
      clickBadge.style.boxShadow = '0 0 12px currentColor';
      clickBadge.style.transform = 'scale(1.08)';
      clickBadge.style.transition = 'all 0.15s ease';
      setTimeout(() => {
        clickBadge.style.boxShadow = '';
        clickBadge.style.transform = '';
      }, 220);
    }

    const enc = window.configStore.getLayerEncoder(currentLayer);
    if (enc?.function === 'layer_nav') {
      handleKnobNav('click');
      setOLEDContent('ENCODER', 'CAMADA 0', 1200);
    }
  }

  function handleKnobNav(action) {
    const encoder = window.configStore.getLayerEncoder(currentLayer);
    const fn = encoder?.function || 'volume';
    if (fn === 'layer_nav') {
      const layers = window.configStore.getLayers() || [];
      const total = layers.length || 4;
      if (action === 'cw') {
        const next = (currentLayer + 1) % total;
        selectAppLayer(next);
      } else if (action === 'ccw') {
        const prev = (currentLayer - 1 + total) % total;
        selectAppLayer(prev);
      } else if (action === 'click') {
        selectAppLayer(0);
      }
    }
  }

  function selectAppLayer(i) {
    const layers = window.configStore.getLayers() || [];
    if (i < 0 || i >= layers.length) i = 0;
    currentLayer = i;
    encoderTargetLayer = i;
    selectedKeyIndex = -1;
    applyCurrentLayerTheme();
    renderLayerSelector();
    renderColorPalette();
    renderPadGrid();
    renderOLED();
    renderEncoderPage();
    if (window.api?.setLayer) {
      window.api.setLayer(i);
    }
  }

  function triggerEncoderFeedbackOLED(direction) {
    const encoder = window.configStore.getLayerEncoder(currentLayer);
    const fn = encoder?.function || 'volume';
    let detail = '';
    if (fn === 'volume') detail = direction === 'cw' ? 'VOL +' : 'VOL -';
    else if (fn === 'brightness') detail = direction === 'cw' ? 'BRILHO +' : 'BRILHO -';
    else if (fn === 'scroll') detail = direction === 'cw' ? 'SCROLL DOWN' : 'SCROLL UP';
    else if (fn === 'media') detail = direction === 'cw' ? 'FAIXA ⏭' : 'FAIXA ⏮';
    else if (fn === 'zoom') detail = direction === 'cw' ? 'ZOOM +' : 'ZOOM -';
    else if (fn === 'video') detail = direction === 'cw' ? 'AVANÇAR ⏭' : 'VOLTAR ⏮';
    else if (fn === 'layer_nav') {
      detail = direction === 'cw' ? 'PRÓXIMA (+1)' : 'ANTERIOR (-1)';
      handleKnobNav(direction);
    }
    else if (fn === 'custom' || fn.startsWith('custom_')) detail = direction === 'cw' ? (encoder?.customCW || 'GIRO CW') : (encoder?.customCCW || 'GIRO CCW');
    else detail = direction === 'cw' ? 'GIRO CW' : 'GIRO CCW';

    setOLEDContent(direction === 'cw' ? 'GIRO ⟳' : 'GIRO ⟲', detail, 1200);
  }

  function setupRotaryDrag(element, onStep, onClick) {
    if (!element) return;

    let isDragging = false;
    let lastAngle = 0;
    let totalAngleMoved = 0;
    let accumulatedStep = 0;

    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Left click only
      const rect = element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      isDragging = true;
      totalAngleMoved = 0;
      accumulatedStep = 0;
      lastAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);

      element.classList.add('knob-dragging');
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const currentAngle = Math.atan2(moveEvent.clientY - cy, moveEvent.clientX - cx) * (180 / Math.PI);
        let delta = currentAngle - lastAngle;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        lastAngle = currentAngle;
        totalAngleMoved += Math.abs(delta);
        accumulatedStep += delta;

        setKnobRotation(currentKnobRotation + delta);

        const STEP_THRESHOLD = 16; // Degrees per encoder detent/step
        while (accumulatedStep >= STEP_THRESHOLD) {
          accumulatedStep -= STEP_THRESHOLD;
          if (onStep) onStep('cw');
        }
        while (accumulatedStep <= -STEP_THRESHOLD) {
          accumulatedStep += STEP_THRESHOLD;
          if (onStep) onStep('ccw');
        }
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        element.classList.remove('knob-dragging');
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('mouseup', onMouseUp, true);

        // If user simply clicked without significant rotation (< 6 degrees)
        if (totalAngleMoved < 6 && onClick) {
          onClick();
        }
      };

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
    });

    // Also support mouse wheel for smooth turning
    element.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 'cw' : 'ccw';
      const deg = e.deltaY < 0 ? 25 : -25;
      rotateKnobVisual(deg, dir);
      if (onStep) onStep(dir);
    }, { passive: false });
  }

  // Setup rotary drag on the main pad visual knob
  const padEncoderElement = document.getElementById('pad-encoder');
  setupRotaryDrag(
    padEncoderElement,
    (dir) => {
      triggerEncoderFeedbackOLED(dir);
    },
    () => {
      navigateTo('encoder');
    }
  );

  // ===================================================================
  // LAYER SELECTOR & ACTIONS (ADD, COLOR, DELETE)
  // ===================================================================
  const layerSelector = document.getElementById('layer-selector');
  const colorPalette = document.getElementById('color-palette');
  const customColorInput = document.getElementById('custom-color-input');
  const btnAddLayer = document.getElementById('btn-add-layer');
  const btnDelLayer = document.getElementById('btn-del-layer');
  const btnToggleLayerColor = document.getElementById('btn-toggle-layer-color');
  const layerColorDropdown = document.getElementById('layer-color-dropdown');
  const layerColorIndicator = document.getElementById('layer-color-indicator');
  const layerColorPopoverContainer = document.getElementById('layer-color-popover-container');

  function updateLayerColorIndicator() {
    const layer = window.configStore.getLayer(currentLayer);
    const color = layer?.color || '#38BDF8';
    if (layerColorIndicator) {
      layerColorIndicator.style.background = color;
      layerColorIndicator.style.boxShadow = `0 0 6px ${color}`;
    }
  }

  function renderLayerSelector() {
    if (!layerSelector) return;
    layerSelector.innerHTML = '';
    const config = window.configStore.getConfig();
    const layers = config?.layers || [];

    // Ensure current layer is in bounds
    if (currentLayer >= layers.length) {
      currentLayer = Math.max(0, layers.length - 1);
    }

    layers.forEach((layer, i) => {
      const tab = document.createElement('div');
      tab.className = `layer-tab${i === currentLayer ? ' active' : ''}`;
      tab.dataset.layer = i;

      const dot = document.createElement('span');
      dot.className = 'layer-tab-dot';
      dot.style.background = layer.color || '#38BDF8';

      const label = document.createElement('span');
      label.textContent = layer.name || `Camada ${i}`;

      if (i === currentLayer) {
        tab.style.background = layer.color || '#38BDF8';
      }

      tab.appendChild(dot);
      tab.appendChild(label);
      tab.title = `${layer.name || 'Camada ' + i} (Dois cliques para renomear)`;

      tab.addEventListener('click', () => {
        currentLayer = i;
        lastUserLayerClickTime = Date.now();
        selectedKeyIndex = -1;
        applyCurrentLayerTheme();
        renderLayerSelector();
        renderColorPalette();
        renderPadGrid();
        renderOLED();
        renderEncoderCaption();
        showKeyConfigEmpty();

        // Sync layer with Raspberry Pi Pico
        window.api?.setHardwareLayer?.(currentLayer);
        updateOledSimulator();

        // Update tray icon highlight and tooltip
        window.api?.updateTrayColor?.(layer.color || '#38BDF8', layer.name || `Camada ${i}`);

        // Notify HUD
        window.api?.notifyHUD({
          layer: currentLayer,
          layerName: layer.name,
          layerColor: layer.color,
          profile: layer.profile
        });
      });

      tab.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openRenameLayerModal(i);
      });

      layerSelector.appendChild(tab);
    });

    // Update color indicator badge
    updateLayerColorIndicator();

    // Toggle delete button visibility (only if > 1 layer)
    if (btnDelLayer) {
      btnDelLayer.classList.toggle('hidden', layers.length <= 1);
    }
  }

  function renderColorPalette() {
    if (!colorPalette) return;
    colorPalette.innerHTML = '';
    const layer = window.configStore.getLayer(currentLayer);
    const activeColor = (layer?.color || '#38BDF8').toUpperCase();

    PRESET_COLORS.forEach(color => {
      const dot = document.createElement('div');
      dot.className = `color-dot${color.toUpperCase() === activeColor ? ' active' : ''}`;
      dot.style.background = color;
      dot.title = color;

      dot.addEventListener('click', () => {
        setLayerColor(color);
      });

      colorPalette.appendChild(dot);
    });

    if (customColorInput) {
      customColorInput.value = layer?.color || '#38BDF8';
    }

    // Hexadecimal custom color row
    const customHexInput = document.getElementById('custom-hex-input');
    const colorHexPreviewDot = document.getElementById('color-hex-preview-dot');
    if (customHexInput) {
      customHexInput.value = (layer?.color || '#38BDF8').replace('#', '').toUpperCase();
    }
    if (colorHexPreviewDot) {
      colorHexPreviewDot.style.background = layer?.color || '#38BDF8';
    }
  }

  function normalizeHexColor(val) {
    if (!val) return null;
    let clean = val.trim().replace(/^#/, '');
    if (/^[0-9A-Fa-f]{3}$/.test(clean)) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
      return '#' + clean.toUpperCase();
    }
    return null;
  }

  const customHexInputEl = document.getElementById('custom-hex-input');
  const colorHexPreviewDotEl = document.getElementById('color-hex-preview-dot');
  const btnApplyHexEl = document.getElementById('btn-apply-hex');

  customHexInputEl?.addEventListener('input', (e) => {
    const valid = normalizeHexColor(e.target.value);
    if (valid && colorHexPreviewDotEl) {
      colorHexPreviewDotEl.style.background = valid;
    }
  });

  function applyCustomHexColor() {
    if (!customHexInputEl) return;
    const validHex = normalizeHexColor(customHexInputEl.value);
    if (validHex) {
      setLayerColor(validHex);
      showToast(`Cor da camada definida para ${validHex}!`, 'success');
    } else {
      showToast('Código hexadecimal inválido (ex: 38BDF8 ou #FF0055)', 'error');
    }
  }

  btnApplyHexEl?.addEventListener('click', applyCustomHexColor);
  customHexInputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCustomHexColor();
    }
  });

  function setLayerColor(color) {
    window.configStore.setLayerColor(currentLayer, color);
    window.configStore.save();
    applyCurrentLayerTheme();
    renderLayerSelector();
    renderColorPalette();
    updateLayerColorIndicator();
    renderPadGrid();

    // Sync to HUD
    const layer = window.configStore.getLayer(currentLayer);
    window.api?.notifyHUD({
      layer: currentLayer,
      layerName: layer?.name,
      layerColor: color,
      profile: layer?.profile
    });

    // Sync to Tray Icon
    window.api?.updateTrayColor?.(color, layer?.name);
  }

  // Toggle color dropdown on Alterar Cor button click
  btnToggleLayerColor?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!layerColorDropdown) return;
    const isHidden = layerColorDropdown.classList.contains('hidden');
    if (isHidden) {
      renderColorPalette();
      layerColorDropdown.classList.remove('hidden');
      btnToggleLayerColor.classList.add('open');
    } else {
      layerColorDropdown.classList.add('hidden');
      btnToggleLayerColor.classList.remove('open');
    }
  });

  // Close color dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (layerColorPopoverContainer && !layerColorPopoverContainer.contains(e.target)) {
      layerColorDropdown?.classList.add('hidden');
      btnToggleLayerColor?.classList.remove('open');
    }
  });

  customColorInput?.addEventListener('input', (e) => {
    setLayerColor(e.target.value);
  });

  // Add Layer Button
  btnAddLayer?.addEventListener('click', () => {
    const newIndex = window.configStore.addLayer();
    if (newIndex !== null) {
      currentLayer = newIndex;
      window.configStore.save();
      applyCurrentLayerTheme();
      renderLayerSelector();
      renderColorPalette();
      renderPadGrid();
      renderOLED();
      renderEncoderCaption();
      showToast('Nova camada adicionada!', 'success');
    }
  });

  // Delete Layer Button
  btnDelLayer?.addEventListener('click', async () => {
    const config = window.configStore.getConfig();
    if ((config?.layers?.length || 0) <= 1) return;

    const layerName = config.layers[currentLayer]?.name || `Camada ${currentLayer + 1}`;
    const confirmed = await showCustomConfirm({
      title: 'Excluir Camada',
      message: `Tem certeza que deseja excluir a ${layerName}?`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      type: 'danger'
    });

    if (confirmed) {
      window.configStore.removeLayer(currentLayer);
      currentLayer = Math.max(0, currentLayer - 1);
      window.configStore.save();
      applyCurrentLayerTheme();
      renderLayerSelector();
      renderColorPalette();
      renderPadGrid();
      renderOLED();
      renderEncoderCaption();
      showToast('Camada excluída', 'info');
    }
  });

  // Rename Layer Button
  document.getElementById('btn-rename-layer')?.addEventListener('click', () => {
    openRenameLayerModal(currentLayer);
  });

  // ===================================================================
  // KEY SELECTION & CONFIGURATION
  // ===================================================================
  const keyConfigEmpty = document.getElementById('key-config-empty');
  const keyConfigContent = document.getElementById('key-config-content');
  const selectedKeyId = document.getElementById('selected-key-id');

  // Dual Function Box Elements
  const boxClick = document.getElementById('dual-box-click');
  const boxHold = document.getElementById('dual-box-hold');
  const dualClickVal = document.getElementById('dual-click-value');
  const dualHoldVal = document.getElementById('dual-hold-value');
  const btnClearHold = document.getElementById('btn-clear-hold');

  let editingKeySlots = { click: null, hold: null };

  function formatActionDisplay(action) {
    if (!action || action === 'none') return '—';
    if (typeof action === 'string') return action;
    if (action.type === 'combo' && Array.isArray(action.value)) return action.value.join('+');
    if (action.type === 'fixed' && action.value === 'layer-switch') return 'Troca Camada';
    if (action.type === 'function') {
      const map = {
        'layer-switch': 'Troca Camada',
        zoom_in: 'Zoom In (+)', zoom_out: 'Zoom Out (-)', zoom_reset: 'Resetar Zoom',
        brightness_up: 'Brilho (+)', brightness_down: 'Brilho (-)',
        discord_mute: '🎙 Discord Mute', discord_deafen: '🎧 Discord Deafen'
      };
      return map[action.value] || action.value;
    }
    if (action.type === 'media') {
      const map = {
        play_pause: 'Play/Pause', stop: 'Stop', prev: 'Anterior', next: 'Próxima',
        volume_up: 'Volume (+)', volume_down: 'Volume (-)', mute: 'Mute'
      };
      return map[action.value] || action.value;
    }
    if (action.type === 'mouse') {
      const map = {
        click_left: 'Clique Esq.', click_right: 'Clique Dir.', click_middle: 'Clique Meio',
        scroll_up: 'Scroll Cima', scroll_down: 'Scroll Baixo'
      };
      return map[action.value] || action.value;
    }
    if (action.type === 'macro') {
      return action.name || 'Macro';
    }
    if (action.type === 'url') {
      if (Array.isArray(action.urls) && action.urls.length > 1) {
        return `🌐 ${action.urls.length} Links`;
      }
      const u = (Array.isArray(action.urls) && action.urls[0]) || action.value || '';
      return u ? `🌐 ${u.replace(/^https?:\/\//i, '').replace(/^www\./i, '')}` : 'Abrir URL';
    }
    return action.value || '—';
  }

  function selectKey(index) {
    if (selectedKeyIndex === index) {
      selectedKeyIndex = -1;
      activeDualTarget = null;
      renderPadGrid();
      showKeyConfigEmpty();
      return;
    }
    selectedKeyIndex = index;
    activeDualTarget = 'click';
    renderPadGrid();
    showKeyConfig(index);
  }

  function showKeyConfigEmpty() {
    if (keyConfigEmpty) keyConfigEmpty.classList.remove('hidden');
    if (keyConfigContent) keyConfigContent.classList.add('hidden');
  }

  function showKeyConfig(index) {
    if (keyConfigEmpty) keyConfigEmpty.classList.add('hidden');
    if (keyConfigContent) keyConfigContent.classList.remove('hidden');

    const row = Math.floor(index / 4);
    const col = index % 4;
    if (selectedKeyId) selectedKeyId.textContent = `Linha ${row + 1}, Coluna ${col + 1} (B${index})`;

    const keyData = window.configStore.getKey(currentLayer, index);

    // Initialize editing slots
    editingKeySlots = {
      click: keyData ? { type: keyData.type || 'key', value: keyData.value || '', urls: keyData.urls || (keyData.value ? [keyData.value] : []), name: keyData.name } : { type: 'key', value: '' },
      hold: (keyData?.holdAction && keyData.holdAction !== 'none') ? (typeof keyData.holdAction === 'object' ? { ...keyData.holdAction, urls: keyData.holdAction.urls || (keyData.holdAction.value ? [keyData.holdAction.value] : []) } : { type: 'key', value: keyData.holdAction }) : null
    };

    // Populate Key Name / Label input
    const keyLabelInput = document.getElementById('key-label-input');
    if (keyLabelInput) {
      keyLabelInput.value = keyData?.label || '';
    }
    updateSoundpadKeyHint(keyData);

    // Fixed toggle
    const isFixed = !!keyData?.fixed;
    const toggleFixed = document.getElementById('toggle-fixed');
    if (toggleFixed) toggleFixed.classList.toggle('active', isFixed);
    document.getElementById('card-option-fixed')?.classList.toggle('active', isFixed);

    // Dual function toggle & values
    const hasDual = !!(editingKeySlots.hold && editingKeySlots.hold !== 'none');
    const toggleDual = document.getElementById('toggle-dual');
    if (toggleDual) toggleDual.classList.toggle('active', hasDual);
    document.getElementById('card-option-dual')?.classList.toggle('active', hasDual);

    const dualSection = document.getElementById('dual-function-section');
    if (dualSection) dualSection.classList.toggle('hidden', !hasDual);

    if (dualClickVal) dualClickVal.textContent = formatActionDisplay(editingKeySlots.click);
    if (dualHoldVal) dualHoldVal.textContent = formatActionDisplay(editingKeySlots.hold);

    renderMacroKeyPicker();
    setDualTarget('click');
  }

  function switchConfigTab(tabName) {
    document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.config-tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector(`.config-tab[data-tab="${tabName}"]`);
    const tabContent = document.getElementById(`tab-${tabName}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
  }

  function updateSoundpadKeyHint(keyData) {
    if (!keyData && selectedKeyIndex >= 0) {
      keyData = window.configStore.getKey(currentLayer, selectedKeyIndex);
    }
    const badge = document.getElementById('soundpad-key-badge');
    const badgeText = document.getElementById('soundpad-badge-text');
    if (!badge || !badgeText) return;

    const rawShortcut = formatKeyShortcutRaw(keyData);
    const soundTitle = rawShortcut ? soundpadSoundMap[rawShortcut] : null;

    if (soundTitle) {
      badgeText.textContent = soundTitle;
      badge.classList.remove('hidden');
      badge.title = `Som vinculado no Soundpad: ${soundTitle}`;
    } else {
      badge.classList.add('hidden');
    }
  }

  function populateModifiersAndKey(actionObj) {
    let mods = [];
    let baseKey = '';

    if (actionObj) {
      if (actionObj.type === 'combo' && Array.isArray(actionObj.value)) {
        mods = actionObj.value.filter(k => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(k));
        baseKey = actionObj.value.find(k => !['Ctrl', 'Alt', 'Shift', 'Win'].includes(k)) || '';
      } else if (actionObj.type === 'key' || actionObj.type === 'fixed' || actionObj.type === 'function' || actionObj.type === 'media' || actionObj.type === 'special') {
        baseKey = actionObj.value || '';
      }
    }

    // Set checkboxes
    document.querySelectorAll('.checkbox-item[data-mod]').forEach(cb => {
      const mod = cb.dataset.mod;
      const isChecked = mods.includes(mod);
      cb.classList.toggle('checked', isChecked);
      const input = cb.querySelector('input');
      if (input) input.checked = isChecked;
    });

    // Set key dropdown
    const keySelect = document.getElementById('key-select');
    if (keySelect) keySelect.value = baseKey;
  }

  // Dual Action Target Selection (Click vs Hold)
  function setDualTarget(target) {
    activeDualTarget = target;
    boxClick?.classList.toggle('active', target === 'click');
    boxHold?.classList.toggle('active', target === 'hold');

    const slotAction = editingKeySlots[target];
    document.querySelectorAll('.action-item').forEach(i => i.classList.remove('selected'));

    if (!slotAction || (!slotAction.type && !slotAction.value)) {
      switchConfigTab('combination');
      populateModifiersAndKey(null);
      return;
    }

    const type = slotAction.type || 'key';
    const val = slotAction.value || '';

    if ((type === 'fixed' && val === 'layer-switch') || type === 'function') {
      switchConfigTab('functions');
      const item = document.querySelector(`#tab-functions .action-item[data-value="${val}"]`);
      if (item) item.classList.add('selected');
    } else if (type === 'media') {
      switchConfigTab('media');
      const item = document.querySelector(`#tab-media .action-item[data-value="${val}"]`);
      if (item) item.classList.add('selected');
    } else if (type === 'mouse') {
      switchConfigTab('mouse');
      const item = document.querySelector(`#tab-mouse .action-item[data-value="${val}"]`);
      if (item) item.classList.add('selected');
    } else if (type === 'macro') {
      switchConfigTab('macro');
      const item = document.querySelector(`#macro-key-picker-list .action-item[data-macro-id="${val}"]`);
      if (item) item.classList.add('selected');
    } else if (type === 'url') {
      switchConfigTab('url');
      const urls = (slotAction.urls && slotAction.urls.length > 0) ? slotAction.urls : (val ? [val] : ['']);
      renderUrlInputs(urls);
    } else {
      switchConfigTab('combination');
      populateModifiersAndKey(slotAction);
    }
  }

  boxClick?.addEventListener('click', () => setDualTarget('click'));
  boxHold?.addEventListener('click', () => setDualTarget('hold'));

  btnClearHold?.addEventListener('click', (e) => {
    e.stopPropagation();
    editingKeySlots.hold = null;
    if (dualHoldVal) dualHoldVal.textContent = '—';
    setDualTarget('click');
    showToast('Clique longo removido', 'info');
  });

  // Checkbox toggle in combination tab
  document.querySelectorAll('.checkbox-item[data-mod]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      item.classList.toggle('checked');
      const input = item.querySelector('input');
      if (input) input.checked = item.classList.contains('checked');
      updateCurrentDualPreview();
    });
  });

  // Key dropdown change in combination tab
  document.getElementById('key-select')?.addEventListener('change', () => {
    updateCurrentDualPreview();
  });

  function updateCurrentDualPreview() {
    const mods = [];
    document.querySelectorAll('.checkbox-item[data-mod]').forEach(cb => {
      if (cb.classList.contains('checked')) mods.push(cb.dataset.mod);
    });
    const baseKey = document.getElementById('key-select')?.value || '';

    let assignment = null;
    if (baseKey === 'layer-switch') {
      assignment = { type: 'fixed', value: 'layer-switch' };
    } else if (['zoom_in', 'zoom_out', 'zoom_reset', 'brightness_up', 'brightness_down'].includes(baseKey)) {
      assignment = { type: 'function', value: baseKey };
    } else if (['play_pause', 'stop', 'prev', 'next', 'volume_up', 'volume_down', 'mute'].includes(baseKey)) {
      assignment = { type: 'media', value: baseKey };
    } else if (mods.length > 0 && baseKey) {
      assignment = { type: 'combo', value: [...mods, baseKey] };
    } else if (baseKey) {
      assignment = { type: 'key', value: baseKey };
    } else if (mods.length > 0) {
      assignment = { type: 'combo', value: mods };
    }

    editingKeySlots[activeDualTarget] = assignment;

    if (activeDualTarget === 'hold') {
      if (dualHoldVal) dualHoldVal.textContent = formatActionDisplay(assignment);
    } else {
      if (dualClickVal) dualClickVal.textContent = formatActionDisplay(assignment);
      updateSoundpadKeyHint(assignment);
    }
  }

  // Action items selection across all tabs (Functions, Media, Mouse)
  document.querySelectorAll('.action-item[data-value]').forEach(item => {
    item.addEventListener('click', () => {
      const parent = item.closest('.action-list');
      parent?.querySelectorAll('.action-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');

      const val = item.dataset.value;
      const itemType = item.dataset.type || (item.closest('#tab-media') ? 'media' : (item.closest('#tab-mouse') ? 'mouse' : 'function'));
      const finalType = (val === 'layer-switch') ? 'fixed' : itemType;

      const assignment = { type: finalType, value: val };
      editingKeySlots[activeDualTarget] = assignment;

      if (activeDualTarget === 'hold') {
        if (dualHoldVal) dualHoldVal.textContent = formatActionDisplay(assignment);
      } else {
        if (dualClickVal) dualClickVal.textContent = formatActionDisplay(assignment);
        updateSoundpadKeyHint(assignment);
      }
    });
  });

  // Dynamic Multiple URL Input Management
  let lastFocusedUrlInput = null;

  function renderUrlInputs(urls = ['']) {
    const container = document.getElementById('url-inputs-list');
    if (!container) return;
    if (!urls || urls.length === 0) urls = [''];

    container.innerHTML = '';
    urls.forEach((url, idx) => {
      const row = document.createElement('div');
      row.className = 'url-input-row';
      row.style.cssText = 'display: flex; gap: 8px; align-items: center;';

      row.innerHTML = `
        <div class="input-with-icon flex-1">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <input type="text" class="input-field key-url-entry" data-index="${idx}" value="${escapeHtml(url)}" placeholder="https://exemplo.com ou youtube.com" autocomplete="off" spellcheck="false">
        </div>
        ${urls.length > 1 ? `
          <button type="button" class="btn btn-outline btn-sm btn-remove-url" data-index="${idx}" title="Remover este link" style="color: #F87171; border-color: rgba(248,113,113,0.3); padding: 7px 10px; flex-shrink: 0;">
            ✕
          </button>
        ` : ''}
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.key-url-entry').forEach(inp => {
      inp.addEventListener('input', () => syncUrlAssignmentFromInputs());
      inp.addEventListener('focus', () => { lastFocusedUrlInput = inp; });
    });

    container.querySelectorAll('.btn-remove-url').forEach(btn => {
      btn.addEventListener('click', () => {
        const removeIdx = parseInt(btn.dataset.index);
        const currentUrls = getUrlInputsValues();
        currentUrls.splice(removeIdx, 1);
        renderUrlInputs(currentUrls.length > 0 ? currentUrls : ['']);
      });
    });

    syncUrlAssignmentFromInputs();
  }

  function getUrlInputsValues() {
    const container = document.getElementById('url-inputs-list');
    if (!container) return [];
    return Array.from(container.querySelectorAll('.key-url-entry')).map(i => i.value.trim());
  }

  function syncUrlAssignmentFromInputs() {
    const urls = getUrlInputsValues().filter(u => u.length > 0);
    let assignment = null;
    if (urls.length === 0) {
      assignment = { type: 'key', value: '' };
    } else {
      assignment = {
        type: 'url',
        value: urls[0],
        urls: urls
      };
    }
    editingKeySlots[activeDualTarget] = assignment;

    if (activeDualTarget === 'hold') {
      if (dualHoldVal) dualHoldVal.textContent = formatActionDisplay(assignment);
    } else {
      if (dualClickVal) dualClickVal.textContent = formatActionDisplay(assignment);
      updateSoundpadKeyHint(assignment);
    }

    const testLabel = document.getElementById('btn-test-url-label');
    if (testLabel) {
      testLabel.textContent = urls.length > 1 ? `Testar ${urls.length} Links` : 'Testar Link';
    }
  }

  document.getElementById('btn-add-url')?.addEventListener('click', () => {
    const currentUrls = getUrlInputsValues();
    currentUrls.push('');
    renderUrlInputs(currentUrls);
    const allInputs = document.querySelectorAll('.key-url-entry');
    const lastInput = allInputs[allInputs.length - 1];
    if (lastInput) {
      lastInput.focus();
      lastFocusedUrlInput = lastInput;
    }
  });

  document.getElementById('btn-test-url')?.addEventListener('click', () => {
    const urls = getUrlInputsValues().filter(u => u.length > 0);
    if (urls.length === 0) {
      showToast('Digite ao menos uma URL para testar', 'warning');
      return;
    }
    window.api?.openURL?.(urls);
    showToast(urls.length > 1 ? `Abrindo ${urls.length} links no navegador...` : 'Abrindo link no navegador...', 'info');
  });

  document.querySelectorAll('#tab-url .url-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      if (lastFocusedUrlInput) {
        lastFocusedUrlInput.value = url;
        syncUrlAssignmentFromInputs();
      } else {
        const currentUrls = getUrlInputsValues().filter(u => u.length > 0);
        currentUrls.push(url);
        renderUrlInputs(currentUrls);
      }
    });
  });

  // Tab switching
  document.querySelectorAll('.config-tab[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchConfigTab(tabName);
    });
  });

  // Toggles & Option Cards
  function setupToggle(id, onChange) {
    const toggle = document.getElementById(id);
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      if (onChange) onChange(toggle.classList.contains('active'));
    });
  }

  setupToggle('toggle-fixed', (active) => {
    document.getElementById('card-option-fixed')?.classList.toggle('active', active);
  });

  setupToggle('toggle-dual', (active) => {
    document.getElementById('card-option-dual')?.classList.toggle('active', active);
    const section = document.getElementById('dual-function-section');
    if (section) section.classList.toggle('hidden', !active);
    if (!active) {
      editingKeySlots.hold = null;
      if (dualHoldVal) dualHoldVal.textContent = '—';
      setDualTarget('click');
    }
  });

  // Wire Option Cards Clicks to Toggles
  document.getElementById('card-option-fixed')?.addEventListener('click', (e) => {
    if (e.target.closest('.toggle-switch')) return;
    document.getElementById('toggle-fixed')?.click();
  });

  document.getElementById('card-option-dual')?.addEventListener('click', (e) => {
    if (e.target.closest('.toggle-switch')) return;
    document.getElementById('toggle-dual')?.click();
  });

  // Soundpad master toggle
  setupToggle('toggle-soundpad', (active) => {
    window.configStore.setSoundpad({ enabled: active });
    window.configStore.save();
    const subgroup = document.getElementById('soundpad-options-group');
    if (subgroup) {
      subgroup.classList.toggle('disabled', !active);
    }
    if (active) {
      checkSoundpadStatus();
    }
  });

  setupToggle('toggle-preview', (active) => {
    window.configStore.setSoundpad({ previewOnHold: active });
    window.configStore.save();
  });

  // System Settings Toggles
  setupToggle('toggle-hud', (active) => {
    window.configStore.setHUD({ enabled: active });
    window.configStore.save();
    window.api?.toggleHUD(active);
    const hudGroup = document.getElementById('hud-options-group');
    if (hudGroup) hudGroup.classList.toggle('disabled', !active);
  });

  document.getElementById('hud-mode-always')?.addEventListener('click', () => {
    window.configStore.setHUD({ mode: 'always' });
    window.configStore.save();
    window.api?.setHUDMode?.('always');
    syncSettingsToggles();
    showToast('HUD configurada: Sempre Visível', 'info');
  });

  document.getElementById('hud-mode-autohide')?.addEventListener('click', () => {
    window.configStore.setHUD({ mode: 'auto_hide' });
    window.configStore.save();
    window.api?.setHUDMode?.('auto_hide');
    syncSettingsToggles();
    showToast('HUD configurada: Apenas ao Acionar Tecla', 'info');
  });

  document.getElementById('btn-reset-hud-pos')?.addEventListener('click', async () => {
    if (window.api?.resetHUDPosition) {
      await window.api.resetHUDPosition();
      showToast('Posição do HUD restaurada para o canto da tela!', 'success');
    }
  });

  setupToggle('toggle-start-boot', (active) => {
    window.configStore.setSystem({ startOnBoot: active });
    window.configStore.save();
    window.api?.setLoginItem(active);
  });

  setupToggle('toggle-start-minimized', (active) => {
    window.configStore.setSystem({ startMinimized: active });
    window.configStore.save();
    window.api?.setStartMinimized(active);
  });

  setupToggle('toggle-close-tray', (active) => {
    window.configStore.setSystem({ closeToTray: active });
    window.configStore.save();
    window.api?.setCloseToTray(active);
  });

  setupToggle('toggle-developer-mode', (active) => {
    window.configStore.setSystem({ developerMode: active });
    window.configStore.save();
    const btnToggleLogs = document.getElementById('btn-toggle-logs');
    if (btnToggleLogs) {
      btnToggleLogs.classList.toggle('hidden', !active);
    }
    if (!active) {
      document.getElementById('serial-log-drawer')?.classList.add('hidden');
      btnToggleLogs?.classList.remove('active');
    }
    showToast(active ? 'Modo Desenvolvedor ativado' : 'Modo Desenvolvedor desativado', 'info');
  });

  setupToggle('toggle-auto-updates', (active) => {
    window.configStore.setSystem({ autoCheckUpdates: active });
    window.configStore.save();
    showToast(active ? 'Procurar atualizações automaticamente: Ativado' : 'Procurar atualizações automaticamente: Desativado', 'info');
  });

  setupToggle('toggle-update-notifications', (active) => {
    window.configStore.setSystem({ notifyUpdates: active });
    window.configStore.save();
    showToast(active ? 'Notificações de atualização ativadas' : 'Notificações de atualização desativadas', 'info');
  });

  document.getElementById('btn-open-github')?.addEventListener('click', () => {
    window.api?.openURL?.('https://github.com/brunogbrl/pad-pro');
  });

  document.getElementById('btn-about-github')?.addEventListener('click', () => {
    window.api?.openURL?.('https://github.com/brunogbrl/pad-pro');
  });

  document.getElementById('btn-open-makerworld')?.addEventListener('click', () => {
    window.api?.openURL?.('https://makerworld.com/pt/models/1142984-superpad-cool-macropad#profileId-1145670');
  });

  document.getElementById('btn-about-makerworld')?.addEventListener('click', () => {
    window.api?.openURL?.('https://makerworld.com/pt/models/1142984-superpad-cool-macropad#profileId-1145670');
  });

  function syncSettingsToggles() {
    const config = window.configStore.getConfig();
    const isHUD = config?.hud?.enabled !== false;
    const hudMode = config?.hud?.mode || 'always';
    const isBoot = !!config?.system?.startOnBoot;
    const isMin = !!config?.system?.startMinimized;
    const isTray = config?.system?.closeToTray !== false;
    const isSp = config?.soundpad?.enabled !== false;
    const isPrev = config?.soundpad?.previewOnHold !== false;
    const isDev = !!config?.system?.developerMode;
    const isAutoUpdates = config?.system?.autoCheckUpdates !== false;
    const isNotifyUpdates = config?.system?.notifyUpdates !== false;

    document.getElementById('toggle-hud')?.classList.toggle('active', isHUD);
    document.getElementById('toggle-start-boot')?.classList.toggle('active', isBoot);
    document.getElementById('toggle-start-minimized')?.classList.toggle('active', isMin);
    document.getElementById('toggle-close-tray')?.classList.toggle('active', isTray);
    document.getElementById('toggle-soundpad')?.classList.toggle('active', isSp);
    document.getElementById('toggle-preview')?.classList.toggle('active', isPrev);
    document.getElementById('toggle-developer-mode')?.classList.toggle('active', isDev);
    document.getElementById('toggle-auto-updates')?.classList.toggle('active', isAutoUpdates);
    document.getElementById('toggle-update-notifications')?.classList.toggle('active', isNotifyUpdates);

    const btnToggleLogs = document.getElementById('btn-toggle-logs');
    if (btnToggleLogs) {
      btnToggleLogs.classList.toggle('hidden', !isDev);
    }

    const hudGroup = document.getElementById('hud-options-group');
    if (hudGroup) hudGroup.classList.toggle('disabled', !isHUD);

    const btnAlways = document.getElementById('hud-mode-always');
    const btnAutoHide = document.getElementById('hud-mode-autohide');
    if (btnAlways && btnAutoHide) {
      btnAlways.classList.toggle('active', hudMode === 'always');
      btnAutoHide.classList.toggle('active', hudMode === 'auto_hide');
    }

    const spGroup = document.getElementById('soundpad-options-group');
    if (spGroup) spGroup.classList.toggle('disabled', !isSp);
  }

  // ===================================================================
  // CONFIRM KEY CONFIGURATION
  // ===================================================================
  document.getElementById('btn-confirm-key')?.addEventListener('click', () => {
    if (selectedKeyIndex < 0) return;

    const existingKey = window.configStore.getKey(currentLayer, selectedKeyIndex) || {};
    let keyData = { ...existingKey };

    const customLabel = document.getElementById('key-label-input')?.value.trim() || '';
    keyData.label = customLabel;

    // Primary action (Click slot)
    const clickAssignment = editingKeySlots.click;
    if (!clickAssignment || (!clickAssignment.value && !clickAssignment.type)) {
      showToast('Selecione uma ação para o clique rápido', 'error');
      return;
    }

    keyData.type = clickAssignment.type || 'key';
    keyData.value = clickAssignment.value || '';
    if (clickAssignment.urls) {
      keyData.urls = clickAssignment.urls;
    } else {
      delete keyData.urls;
    }
    if (clickAssignment.name) {
      keyData.name = clickAssignment.name;
    } else {
      delete keyData.name;
    }

    // Default label for layer switch
    if (keyData.value === 'layer-switch') {
      if (!customLabel) keyData.label = 'Camada';
      keyData.fixed = true;
    } else {
      keyData.fixed = document.getElementById('toggle-fixed')?.classList.contains('active') || false;
    }

    // Hold Action (Dual Function)
    const isDualActive = document.getElementById('toggle-dual')?.classList.contains('active');
    if (isDualActive && editingKeySlots.hold && (editingKeySlots.hold.value || editingKeySlots.hold.type)) {
      keyData.holdAction = editingKeySlots.hold;
    } else {
      keyData.holdAction = null;
    }

    window.configStore.setKey(currentLayer, selectedKeyIndex, keyData);
    window.configStore.save();
    renderPadGrid();
    refreshSoundpadSoundMap();
    showToast('Tecla salva com sucesso!', 'success');
  });

  // Reset Key
  document.getElementById('btn-reset-key')?.addEventListener('click', () => {
    if (selectedKeyIndex < 0) return;
    const defaultKey = { type: 'key', value: '', holdAction: null, fixed: false, label: '' };
    window.configStore.setKey(currentLayer, selectedKeyIndex, defaultKey);
    window.configStore.save();
    renderPadGrid();
    showKeyConfig(selectedKeyIndex);
    refreshSoundpadSoundMap();
    showToast('Tecla resetada', 'info');
  });

  // ===================================================================
  // KEYBOARD SHORTCUT RECORDING
  // ===================================================================
  const recordingOverlay = document.getElementById('recording-overlay');
  const recordingKeysDisplay = document.getElementById('recording-keys-display');
  let recordingTarget = 'key'; // 'key', 'encoder-cw', 'encoder-ccw', 'encoder-click'
  let lastRecordKeyTime = 0;

  function resetRecordedKeys() {
    recordedKeys = [];
    lastRecordKeyTime = 0;
    if (recordingKeysDisplay) {
      recordingKeysDisplay.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">Aguardando teclas...</span>';
    }
  }

  document.getElementById('btn-record-shortcut')?.addEventListener('click', () => {
    startRecording('key');
  });

  document.getElementById('btn-recording-cancel')?.addEventListener('click', () => {
    stopRecording(false);
  });

  document.getElementById('btn-recording-reset')?.addEventListener('click', () => {
    resetRecordedKeys();
  });

  document.getElementById('btn-recording-confirm')?.addEventListener('click', () => {
    stopRecording(true);
  });

  function startRecording(target = 'key') {
    isRecording = true;
    recordingTarget = target;
    resetRecordedKeys();
    if (recordingOverlay) recordingOverlay.classList.add('active');
    document.addEventListener('keydown', handleRecordKeyDown);
  }

  function stopRecording(apply) {
    isRecording = false;
    document.removeEventListener('keydown', handleRecordKeyDown);
    if (recordingOverlay) recordingOverlay.classList.remove('active');

    if (apply && recordedKeys.length > 0) {
      applyRecordedKeys(recordedKeys);
    }
    lastRecordKeyTime = 0;
  }

  function handleRecordKeyDown(e) {
    e.preventDefault();
    e.stopPropagation();

    // After 2s of inactivity from the last pressed key, auto-reset to start a fresh new definition
    const now = Date.now();
    if (lastRecordKeyTime > 0 && now - lastRecordKeyTime > 2000) {
      recordedKeys = [];
    }
    lastRecordKeyTime = now;

    const key = mapKeyboardEventKey(e);
    if (!recordedKeys.includes(key)) {
      recordedKeys.push(key);
    }

    if (recordingKeysDisplay) {
      recordingKeysDisplay.innerHTML = recordedKeys.map(k => `<span class="rec-key-badge">${k}</span>`).join(' + ');
    }
  }

  function mapKeyboardEventKey(e) {
    if (e.key === 'Control') return 'Ctrl';
    if (e.key === 'Alt') return 'Alt';
    if (e.key === 'Shift') return 'Shift';
    if (e.key === 'Meta') return 'Win';
    if (e.key === ' ') return 'Space';
    return e.key.toUpperCase();
  }

  function applyRecordedKeys(keys) {
    const formatted = keys.join(' + ');

    // Handle new custom function modal targets
    if (recordingTarget && recordingTarget.startsWith('new-fn-')) {
      const input = document.getElementById(recordingTarget);
      if (input) {
        input.value = formatted;
        input.dispatchEvent(new Event('input'));
      }
      const tag = document.getElementById(`tag-${recordingTarget}`);
      if (tag) tag.textContent = formatted;
      showToast(`Atalho gravado: ${formatted}!`, 'success');
      return;
    }

    // Handle encoder custom actions
    if (recordingTarget === 'encoder-cw') {
      const input = document.getElementById('encoder-cw-input');
      if (input) input.value = formatted;
      window.configStore.setLayerEncoder(encoderTargetLayer, { customCW: formatted });
      window.configStore.save();
      if (encoderActionCW) encoderActionCW.textContent = formatted;
      showToast(`Giro Horário gravado: ${formatted}!`, 'success');
      return;
    }

    if (recordingTarget === 'encoder-ccw') {
      const input = document.getElementById('encoder-ccw-input');
      if (input) input.value = formatted;
      window.configStore.setLayerEncoder(encoderTargetLayer, { customCCW: formatted });
      window.configStore.save();
      if (encoderActionCCW) encoderActionCCW.textContent = formatted;
      showToast(`Giro Anti-horário gravado: ${formatted}!`, 'success');
      return;
    }

    if (recordingTarget === 'encoder-click') {
      const input = document.getElementById('encoder-click-input');
      if (input) input.value = formatted;
      window.configStore.setLayerEncoder(encoderTargetLayer, { customPress: formatted });
      window.configStore.save();
      if (encoderActionClick) encoderActionClick.textContent = formatted;
      showToast(`Clique do botão gravado: ${formatted}!`, 'success');
      return;
    }

    // Default: Key Combination
    const mods = keys.filter(k => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(k));
    const baseKey = keys.find(k => !['Ctrl', 'Alt', 'Shift', 'Win'].includes(k)) || '';

    // Switch to combination tab
    document.querySelector('.config-tab[data-tab="combination"]')?.click();

    // Check modifiers
    document.querySelectorAll('.checkbox-item[data-mod]').forEach(cb => {
      const isChecked = mods.includes(cb.dataset.mod);
      cb.classList.toggle('checked', isChecked);
      const input = cb.querySelector('input');
      if (input) input.checked = isChecked;
    });

    // Select key
    const keySelect = document.getElementById('key-select');
    if (keySelect) {
      keySelect.value = baseKey;
    }

    updateCurrentDualPreview();
    showToast(`Atalho gravado: ${keys.join('+')}`, 'success');
  }

  // ===================================================================
  // ENCODER / KNOB PAGE (PER-LAYER CONFIGURATION)
  // ===================================================================
  let encoderTargetLayer = 0;
  const encoderLayerTabs = document.getElementById('encoder-layer-tabs');
  const encoderBadgeLayer = document.getElementById('encoder-badge-layer');
  const encoderCurrentTitle = document.getElementById('encoder-current-title');
  const encoderActionCW = document.getElementById('encoder-action-cw');
  const encoderActionCCW = document.getElementById('encoder-action-ccw');
  const encoderActionClick = document.getElementById('encoder-action-click');
  const encoderKnobCore = document.getElementById('encoder-knob-core');
  const encoderKnobInteractive = document.getElementById('encoder-knob-interactive');

  const ENCODER_FUNCTIONS_INFO = {
    volume: {
      title: 'Volume do Sistema',
      cw: 'Aumentar Volume (+)',
      ccw: 'Diminuir Volume (-)',
      click: 'Mudo (Mute/Desmute)'
    },
    brightness: {
      title: 'Brilho da Tela',
      cw: 'Aumentar Brilho (+)',
      ccw: 'Diminuir Brilho (-)',
      click: 'Brilho Padrão'
    },
    scroll: {
      title: 'Rolagem (Scroll)',
      cw: 'Rolar para Baixo',
      ccw: 'Rolar para Cima',
      click: 'Clique do Meio'
    },
    media: {
      title: 'Navegação de Música',
      cw: 'Próxima Faixa ⏭',
      ccw: 'Faixa Anterior ⏮',
      click: 'Play / Pause ⏯'
    },
    zoom: {
      title: 'Zoom / Escala',
      cw: 'Aumentar Zoom (+)',
      ccw: 'Diminuir Zoom (-)',
      click: 'Resetar Zoom (100%)'
    },
    video: {
      title: 'Navegação de Vídeo',
      cw: 'Avançar Vídeo (Seta Dir)',
      ccw: 'Voltar Vídeo (Seta Esq)',
      click: 'Play / Pause (Espaço)'
    },
    layer_nav: {
      title: 'Navegação de Camadas',
      cw: 'Próxima Camada (+1)',
      ccw: 'Camada Anterior (-1)',
      click: 'Primeira Camada (Camada 0)'
    },
    custom: {
      title: 'Função Personalizada',
      cw: 'Atalho Personalizado (CW)',
      ccw: 'Atalho Personalizado (CCW)',
      click: 'Macro / Atalho de Clique'
    }
  };

  const ENCODER_FUNCTION_COLORS = {
    volume: { color: '#38BDF8', rgb: '56, 189, 248' },
    brightness: { color: '#F59E0B', rgb: '245, 158, 11' },
    scroll: { color: '#10B981', rgb: '16, 185, 129' },
    media: { color: '#A78BFA', rgb: '167, 139, 250' },
    zoom: { color: '#06B6D4', rgb: '6, 182, 212' },
    video: { color: '#EF4444', rgb: '239, 68, 68' },
    layer_nav: { color: '#6366F1', rgb: '99, 102, 241' },
    custom: { color: '#EC4899', rgb: '236, 72, 153' }
  };

  function hexToRgbString(hex) {
    if (!hex) return '56, 189, 248';
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  }

  // Interactive drag, wheel, and click on the Encoder Showcase knob
  setupRotaryDrag(
    encoderKnobInteractive,
    (dir) => {
      rotateKnobVisual(0, dir);
      triggerEncoderFeedbackOLED(dir);
    },
    () => {
      triggerKnobPressVisual();
    }
  );

  // Interactive buttons for testing knob rotation and click
  document.getElementById('btn-test-cw')?.addEventListener('click', () => {
    rotateKnobVisual(30, 'cw');
    triggerEncoderFeedbackOLED('cw');
  });

  document.getElementById('btn-test-ccw')?.addEventListener('click', () => {
    rotateKnobVisual(-30, 'ccw');
    triggerEncoderFeedbackOLED('ccw');
  });

  document.getElementById('btn-test-click')?.addEventListener('click', () => {
    triggerKnobPressVisual();
  });

  function renderEncoderPage() {
    if (!encoderLayerTabs) return;
    encoderLayerTabs.innerHTML = '';
    const config = window.configStore.getConfig();
    const layers = config?.layers || [];

    if (encoderTargetLayer >= layers.length) {
      encoderTargetLayer = Math.max(0, layers.length - 1);
    }

    layers.forEach((layer, idx) => {
      const tab = document.createElement('div');
      tab.className = `encoder-layer-tab${idx === encoderTargetLayer ? ' active' : ''}`;
      if (idx === encoderTargetLayer) {
        tab.style.background = layer.color || '#38BDF8';
      }

      const dot = document.createElement('span');
      dot.className = 'encoder-layer-tab-dot';
      dot.style.background = layer.color || '#38BDF8';

      const label = document.createElement('span');
      label.textContent = layer.name || `Camada ${idx}`;

      tab.appendChild(dot);
      tab.appendChild(label);

      tab.addEventListener('click', () => {
        encoderTargetLayer = idx;
        renderEncoderPage();
      });

      encoderLayerTabs.appendChild(tab);
    });

    renderDynamicEncoderCards();
    loadEncoderForLayer(encoderTargetLayer);
  }

  function renderDynamicEncoderCards() {
    const grid = document.querySelector('.encoder-cards-grid');
    const addCard = document.getElementById('btn-add-encoder-function');
    if (!grid || !addCard) return;

    grid.querySelectorAll('.encoder-card-custom-dynamic').forEach(el => el.remove());

    const customFns = window.configStore.getConfig()?.custom_encoder_functions || [];
    customFns.forEach(cf => {
      const card = document.createElement('div');
      card.className = 'encoder-card encoder-card-custom-dynamic';
      card.dataset.value = cf.id;
      const rgb = hexToRgbString(cf.color || '#38BDF8');
      card.innerHTML = `
        <div class="encoder-card-header">
          <div class="encoder-card-icon-wrap" style="color: ${cf.color}; background: rgba(${rgb}, 0.15); border: 1px solid rgba(${rgb}, 0.3);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div class="encoder-card-header-actions">
            <button type="button" class="btn-encoder-step-config" data-fn="${cf.id}" title="Configurar sensibilidade / passo">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
            <button type="button" class="btn-encoder-delete-fn" data-fn="${cf.id}" title="Excluir esta função personalizada">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            <div class="encoder-card-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
          </div>
        </div>
        <div class="encoder-card-body">
          <h4 class="encoder-card-title">${cf.name}</h4>
          <p class="encoder-card-desc">${cf.desc || 'Função customizada'}</p>
        </div>
        <div class="encoder-card-footer">
          <span class="pill-cw">⟳ ${cf.cw || 'CW'}</span>
          <span class="pill-ccw">⟲ ${cf.ccw || 'CCW'}</span>
          <span class="pill-click">● ${cf.click || 'Clique'}</span>
        </div>
      `;

      card.addEventListener('click', () => {
        selectEncoderFunction(cf.id);
      });

      card.querySelector('.btn-encoder-step-config')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openStepConfigModal(cf.id);
      });

      card.querySelector('.btn-encoder-delete-fn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const confirmed = await showCustomConfirm({
          title: 'Excluir Função do Knob',
          message: `Deseja realmente excluir a função personalizada "${cf.name}"?`,
          confirmText: 'Excluir',
          cancelText: 'Cancelar',
          type: 'danger'
        });
        if (confirmed) {
          deleteCustomEncoderFunction(cf.id, cf.name);
        }
      });

      grid.insertBefore(card, addCard);
    });
  }

  function deleteCustomEncoderFunction(id, name) {
    const cfg = window.configStore.getConfig();
    if (cfg.custom_encoder_functions) {
      cfg.custom_encoder_functions = cfg.custom_encoder_functions.filter(f => f.id !== id);
    }
    // Reverter para volume caso alguma camada utilize esta funcao
    (cfg.layers || []).forEach((l, idx) => {
      if (l.encoder?.function === id) {
        l.encoder.function = 'volume';
        if (window.api?.syncEncoder) {
          window.api.syncEncoder({ layer: idx, encoder: l.encoder });
        }
      }
    });
    window.configStore.save();
    delete ENCODER_FUNCTIONS_INFO[id];
    delete ENCODER_FUNCTION_COLORS[id];
    renderEncoderPage();
    loadEncoderForLayer(encoderTargetLayer);
    showToast(`Função "${name}" excluída com sucesso!`, 'info');
  }

  function loadEncoderForLayer(layerIdx) {
    const layer = window.configStore.getLayer(layerIdx);
    const encoder = window.configStore.getLayerEncoder(layerIdx);
    const fn = encoder?.function || 'volume';

    // Registrar funcoes customizadas no dicionario se existirem
    const customFns = window.configStore.getConfig()?.custom_encoder_functions || [];
    customFns.forEach(cf => {
      if (!ENCODER_FUNCTIONS_INFO[cf.id]) {
        ENCODER_FUNCTIONS_INFO[cf.id] = {
          title: cf.name || cf.title,
          cw: cf.cw || 'Atalho CW',
          ccw: cf.ccw || 'Atalho CCW',
          click: cf.click || 'Clique'
        };
        ENCODER_FUNCTION_COLORS[cf.id] = {
          color: cf.color || '#38BDF8',
          rgb: hexToRgbString(cf.color || '#38BDF8')
        };
      }
    });

    const info = ENCODER_FUNCTIONS_INFO[fn] || ENCODER_FUNCTIONS_INFO.volume;
    const colorInfo = ENCODER_FUNCTION_COLORS[fn] || { color: '#38BDF8', rgb: '56, 189, 248' };

    // Update left preview card com tons unificados (Audio 2)
    const previewCard = document.querySelector('.encoder-preview-card');
    if (previewCard) {
      previewCard.style.setProperty('--encoder-theme-color', colorInfo.color);
      previewCard.style.setProperty('--encoder-theme-rgb', colorInfo.rgb);
    }

    if (encoderBadgeLayer) {
      encoderBadgeLayer.textContent = layer?.name || `Camada ${layerIdx}`;
      encoderBadgeLayer.style.color = colorInfo.color;
      encoderBadgeLayer.style.borderColor = colorInfo.color;
      encoderBadgeLayer.style.background = `rgba(${colorInfo.rgb}, 0.14)`;
    }
    if (encoderCurrentTitle) encoderCurrentTitle.textContent = info.title;

    if (fn === 'custom' || fn.startsWith('custom_')) {
      if (encoderActionCW) encoderActionCW.textContent = encoder?.customCW || info.cw || 'Atalho 1 (CW)';
      if (encoderActionCCW) encoderActionCCW.textContent = encoder?.customCCW || info.ccw || 'Atalho 2 (CCW)';
      if (encoderActionClick) encoderActionClick.textContent = encoder?.customPress || info.click || 'Macro / Clique';
    } else {
      if (encoderActionCW) encoderActionCW.textContent = info.cw;
      if (encoderActionCCW) encoderActionCCW.textContent = info.ccw;
      if (encoderActionClick) encoderActionClick.textContent = info.click;
    }

    // Highlight active card
    document.querySelectorAll('#page-encoder .encoder-card[data-value]').forEach(card => {
      card.classList.toggle('active', card.dataset.value === fn);
    });

    // Layer navigation notice and undo banner (Audio 1)
    const layerNavNotice = document.getElementById('encoder-layer-nav-notice');
    const cfg = window.configStore.getConfig();
    const hasPreviousBackup = Array.isArray(cfg?.previous_layer_nav_knobs) && cfg.previous_layer_nav_knobs.length > 0;
    const isLayerNavActive = fn === 'layer_nav' || (cfg?.layers || []).some(l => l.encoder?.function === 'layer_nav');

    if (layerNavNotice) {
      layerNavNotice.classList.toggle('hidden', !(hasPreviousBackup && isLayerNavActive));
    }

    // Custom configuration box visibility & values
    const customConfigBox = document.getElementById('encoder-custom-config-box');
    const cwInput = document.getElementById('encoder-cw-input');
    const ccwInput = document.getElementById('encoder-ccw-input');
    const clickInput = document.getElementById('encoder-click-input');

    if (customConfigBox) {
      if (fn === 'custom' || fn.startsWith('custom_')) {
        customConfigBox.classList.remove('hidden');
        if (cwInput) cwInput.value = encoder?.customCW || '';
        if (ccwInput) ccwInput.value = encoder?.customCCW || '';
        if (clickInput) clickInput.value = encoder?.customPress || '';
      } else {
        customConfigBox.classList.add('hidden');
      }
    }
  }

  async function selectEncoderFunction(value) {
    if (value === 'layer_nav') {
      const cfg = window.configStore.getConfig();
      const layers = cfg?.layers || [];
      const allAlreadyLayerNav = layers.length > 0 && layers.every(l => l.encoder?.function === 'layer_nav');

      if (!allAlreadyLayerNav) {
        const confirmed = await showCustomConfirm({
          title: 'Ativar Navegação de Camadas',
          message: 'A função de Navegação de Camadas permite alternar continuamente entre as camadas do PAD Pro girando o botão giratório (Knob).\n\nPara funcionar continuamente a partir de qualquer camada, esta função será aplicada a TODAS as camadas do seu Pad.\n\nAs funções atuais do botão giratório de cada camada serão guardadas para que você possa restaurá-las com o botão "Desfazer" a qualquer momento.\n\nDeseja aplicar agora em todas as camadas?',
          confirmText: 'Aplicar em Todas as Camadas',
          cancelText: 'Cancelar',
          type: 'primary'
        });

        if (!confirmed) {
          return;
        }

        // Backup current encoder configs of all layers
        cfg.previous_layer_nav_knobs = layers.map(l => JSON.parse(JSON.stringify(l.encoder || { function: 'volume' })));

        // Apply layer_nav to all layers
        layers.forEach((l, idx) => {
          l.encoder = { function: 'layer_nav' };
          if (window.api?.syncEncoder) {
            window.api.syncEncoder({ layer: idx, encoder: l.encoder });
          }
        });

        window.configStore.save();
        renderEncoderPage();
        loadEncoderForLayer(encoderTargetLayer);
        renderEncoderCaption();
        showToast('Navegação de Camadas ativada em todas as camadas!', 'success');
        return;
      }
    }

    const encoderData = { function: value };
    const customFns = window.configStore.getConfig()?.custom_encoder_functions || [];
    const matchedCustom = customFns.find(c => c.id === value);
    if (matchedCustom) {
      encoderData.customCW = matchedCustom.cw;
      encoderData.customCCW = matchedCustom.ccw;
      encoderData.customPress = matchedCustom.click;
    }

    window.configStore.setLayerEncoder(encoderTargetLayer, encoderData);
    window.configStore.save();

    // Sincronizacao em Tempo Real com a Raspberry Pi Pico (Issue #5)
    const layer = window.configStore.getLayer(encoderTargetLayer);
    const fullEncoder = layer?.encoder || encoderData;
    if (window.api?.syncEncoder) {
      window.api.syncEncoder({
        layer: encoderTargetLayer,
        encoder: fullEncoder
      });
    }

    loadEncoderForLayer(encoderTargetLayer);
    renderEncoderCaption();
    showToast(`Botão Giratório: ${ENCODER_FUNCTIONS_INFO[value]?.title || value}!`, 'success');
  }

  // Undo Layer Navigation to restore previous encoder functions (Audio 1)
  document.getElementById('btn-undo-layer-nav')?.addEventListener('click', async () => {
    const cfg = window.configStore.getConfig();
    const prev = cfg?.previous_layer_nav_knobs;
    if (!Array.isArray(prev) || prev.length === 0) {
      showToast('Nenhum backup anterior de funções do botão giratório encontrado.', 'info');
      return;
    }

    (cfg.layers || []).forEach((l, idx) => {
      if (prev[idx]) {
        l.encoder = JSON.parse(JSON.stringify(prev[idx]));
        if (window.api?.syncEncoder) {
          window.api.syncEncoder({ layer: idx, encoder: l.encoder });
        }
      }
    });

    delete cfg.previous_layer_nav_knobs;
    window.configStore.save();
    renderEncoderPage();
    loadEncoderForLayer(encoderTargetLayer);
    renderEncoderCaption();
    showToast('Funções anteriores do botão giratório restauradas com sucesso!', 'success');
  });

  // Custom action inputs listener with real-time sync
  document.getElementById('encoder-cw-input')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    window.configStore.setLayerEncoder(encoderTargetLayer, { customCW: val });
    window.configStore.save();
    if (encoderActionCW) encoderActionCW.textContent = val || 'Atalho 1 (CW)';
    const encoder = window.configStore.getLayerEncoder(encoderTargetLayer);
    if (window.api?.syncEncoder) window.api.syncEncoder({ layer: encoderTargetLayer, encoder });
  });

  document.getElementById('encoder-ccw-input')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    window.configStore.setLayerEncoder(encoderTargetLayer, { customCCW: val });
    window.configStore.save();
    if (encoderActionCCW) encoderActionCCW.textContent = val || 'Atalho 2 (CCW)';
    const encoder = window.configStore.getLayerEncoder(encoderTargetLayer);
    if (window.api?.syncEncoder) window.api.syncEncoder({ layer: encoderTargetLayer, encoder });
  });

  document.getElementById('encoder-click-input')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    window.configStore.setLayerEncoder(encoderTargetLayer, { customPress: val });
    window.configStore.save();
    if (encoderActionClick) encoderActionClick.textContent = val || 'Macro / Clique';
    const encoder = window.configStore.getLayerEncoder(encoderTargetLayer);
    if (window.api?.syncEncoder) window.api.syncEncoder({ layer: encoderTargetLayer, encoder });
  });

  // Custom action record buttons
  document.getElementById('btn-record-cw')?.addEventListener('click', () => {
    startRecording('encoder-cw');
  });

  document.getElementById('btn-record-ccw')?.addEventListener('click', () => {
    startRecording('encoder-ccw');
  });

  document.getElementById('btn-record-click')?.addEventListener('click', () => {
    startRecording('encoder-click');
  });

  document.querySelectorAll('#page-encoder .encoder-card[data-value]').forEach(card => {
    card.addEventListener('click', () => {
      const value = card.dataset.value;
      selectEncoderFunction(value);
    });
  });

  // ===================================================================
  // MODAL: SENSIBILIDADE DO PASSO DO ENCODER (AUDIO 1)
  // ===================================================================
  let activeStepFn = 'volume';
  const modalEncoderStep = document.getElementById('modal-encoder-step');
  const inputStepCW = document.getElementById('input-step-cw');
  const inputStepCCW = document.getElementById('input-step-ccw');
  const stepPreviewCW = document.getElementById('step-preview-cw');
  const stepPreviewCCW = document.getElementById('step-preview-ccw');
  const modalStepTitle = document.getElementById('modal-step-title');

  function openStepConfigModal(fn) {
    activeStepFn = fn;
    const config = window.configStore.getConfig();
    const layer = window.configStore.getLayer(encoderTargetLayer);
    const layerSteps = layer?.encoder?.steps;
    const globalSteps = config?.encoder_steps?.[fn];

    const currentCW = layerSteps?.cw || globalSteps?.cw || (fn === 'volume' ? 2 : (fn === 'scroll' ? 3 : 1));
    const currentCCW = layerSteps?.ccw || globalSteps?.ccw || (fn === 'volume' ? 2 : (fn === 'scroll' ? 3 : 1));

    if (modalStepTitle) modalStepTitle.textContent = `Sensibilidade — ${ENCODER_FUNCTIONS_INFO[fn]?.title || fn}`;
    if (inputStepCW) inputStepCW.value = currentCW;
    if (inputStepCCW) inputStepCCW.value = currentCCW;
    updateStepPreviews();
    modalEncoderStep?.classList.remove('hidden');
  }

  function updateStepPreviews() {
    const cw = inputStepCW ? parseInt(inputStepCW.value) || 1 : 1;
    const ccw = inputStepCCW ? parseInt(inputStepCCW.value) || 1 : 1;
    if (stepPreviewCW) stepPreviewCW.textContent = `+${cw}`;
    if (stepPreviewCCW) stepPreviewCCW.textContent = `-${ccw}`;
  }

  document.querySelectorAll('.btn-encoder-step-config').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fn = btn.dataset.fn || 'volume';
      openStepConfigModal(fn);
    });
  });

  document.getElementById('btn-step-cw-minus')?.addEventListener('click', () => {
    if (inputStepCW) {
      inputStepCW.value = Math.max(1, (parseInt(inputStepCW.value) || 1) - 1);
      updateStepPreviews();
    }
  });
  document.getElementById('btn-step-cw-plus')?.addEventListener('click', () => {
    if (inputStepCW) {
      inputStepCW.value = Math.min(20, (parseInt(inputStepCW.value) || 1) + 1);
      updateStepPreviews();
    }
  });
  document.getElementById('btn-step-ccw-minus')?.addEventListener('click', () => {
    if (inputStepCCW) {
      inputStepCCW.value = Math.max(1, (parseInt(inputStepCCW.value) || 1) - 1);
      updateStepPreviews();
    }
  });
  document.getElementById('btn-step-ccw-plus')?.addEventListener('click', () => {
    if (inputStepCCW) {
      inputStepCCW.value = Math.min(20, (parseInt(inputStepCCW.value) || 1) + 1);
      updateStepPreviews();
    }
  });
  inputStepCW?.addEventListener('input', updateStepPreviews);
  inputStepCCW?.addEventListener('input', updateStepPreviews);

  document.getElementById('btn-close-step-modal')?.addEventListener('click', () => {
    modalEncoderStep?.classList.add('hidden');
  });
  document.getElementById('btn-cancel-step')?.addEventListener('click', () => {
    modalEncoderStep?.classList.add('hidden');
  });

  document.getElementById('btn-save-step')?.addEventListener('click', () => {
    const cw = Math.max(1, Math.min(20, parseInt(inputStepCW?.value) || 1));
    const ccw = Math.max(1, Math.min(20, parseInt(inputStepCCW?.value) || 1));
    const cfg = window.configStore.getConfig();
    if (!cfg.encoder_steps) cfg.encoder_steps = {};
    cfg.encoder_steps[activeStepFn] = { cw, ccw };

    const encoder = window.configStore.getLayerEncoder(encoderTargetLayer);
    window.configStore.setLayerEncoder(encoderTargetLayer, {
      steps: { cw, ccw }
    });
    window.configStore.save();

    if (window.api?.syncEncoder) {
      window.api.syncEncoder({
        layer: encoderTargetLayer,
        encoder: { ...encoder, steps: { cw, ccw } }
      });
    }

    modalEncoderStep?.classList.add('hidden');
    showToast(`Sensibilidade (${activeStepFn}): +${cw} / -${ccw} salva!`, 'success');
  });

  // ===================================================================
  // MODAL: SELETOR DE AÇÕES DO ENCODER (PARTE 2 - MIDIA, MOUSE, PAD, ETC.)
  // ===================================================================
  let activeEncoderPickerTarget = 'cw';
  const modalActionPicker = document.getElementById('modal-encoder-action-picker');

  function openEncoderActionPicker(target) {
    activeEncoderPickerTarget = target;
    const titles = {
      'cw': 'Escolher Ação — Girar Horário (CW)',
      'ccw': 'Escolher Ação — Girar Anti-horário (CCW)',
      'click': 'Escolher Ação — Pressionar Botão (Clique)',
      'new-fn-cw': 'Escolher Ação — Girar Horário (CW)',
      'new-fn-ccw': 'Escolher Ação — Girar Anti-horário (CCW)',
      'new-fn-click': 'Escolher Ação — Pressionar Botão (Clique)'
    };
    const titleEl = document.getElementById('encoder-picker-title');
    if (titleEl) titleEl.textContent = titles[target] || 'Escolher Ação';

    switchEncoderPickerTab('combination');
    populateEncoderMacroList();
    modalActionPicker?.classList.remove('hidden');
  }

  function switchEncoderPickerTab(tabName) {
    document.querySelectorAll('#encoder-picker-tabs .config-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.encoder-tab-pane').forEach(p => {
      p.classList.toggle('active', p.id === `enc-pane-${tabName}`);
      p.classList.toggle('hidden', p.id !== `enc-pane-${tabName}`);
    });
  }

  document.querySelectorAll('#encoder-picker-tabs .config-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchEncoderPickerTab(tab.dataset.tab);
    });
  });

  document.querySelectorAll('.btn-choose-encoder-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'cw';
      openEncoderActionPicker(target);
    });
  });

  document.getElementById('btn-close-encoder-picker')?.addEventListener('click', () => {
    modalActionPicker?.classList.add('hidden');
  });
  document.getElementById('btn-cancel-encoder-picker')?.addEventListener('click', () => {
    modalActionPicker?.classList.add('hidden');
  });

  document.querySelectorAll('.enc-action-choice').forEach(item => {
    item.addEventListener('click', () => {
      const act = item.dataset.action;
      applyChosenEncoderAction(act);
    });
  });

  function populateEncoderMacroList() {
    const listEl = document.getElementById('enc-macro-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    const macros = window.configStore.getMacros();
    if (!macros || macros.length === 0) {
      listEl.innerHTML = '<div style="color:#64748B; padding:12px; font-size:12px;">Nenhuma macro cadastrada ainda.</div>';
      return;
    }
    macros.forEach(m => {
      const item = document.createElement('div');
      item.className = 'action-item enc-macro-choice';
      item.innerHTML = `<span class="action-item-label">${m.name}</span><small style="color:#64748B; font-size:10px;">Macro</small>`;
      item.addEventListener('click', () => {
        applyChosenEncoderAction(`macro:${m.id}`);
      });
      listEl.appendChild(item);
    });
  }

  function formatEncoderActionLabel(actionVal) {
    const map = {
      'vol_up': 'Volume +',
      'vol_down': 'Volume -',
      'mute': 'Mute',
      'play_pause': 'Play/Pause',
      'next_track': 'Próxima Faixa',
      'prev_track': 'Faixa Anterior',
      'stop': 'Stop',
      'brightness_up': 'Brilho +',
      'brightness_down': 'Brilho -',
      'zoom_in': 'Zoom In (+)',
      'zoom_out': 'Zoom Out (-)',
      'zoom_reset': 'Resetar Zoom (100%)',
      'layer_next': 'Próxima Camada (+1)',
      'layer_prev': 'Camada Anterior (-1)',
      'layer_0': 'Primeira Camada (Camada 0)',
      'layer-switch': 'Troca de Camada',
      'mouse_left': 'Clique Esquerdo',
      'mouse_right': 'Clique Direito',
      'mouse_middle': 'Clique Meio',
      'mouse_wheel_up': 'Scroll Cima',
      'mouse_wheel_down': 'Scroll Baixo'
    };
    return map[actionVal] || actionVal;
  }

  function applyChosenEncoderAction(actionVal) {
    const displayVal = formatEncoderActionLabel(actionVal);
    if (activeEncoderPickerTarget.startsWith('new-fn-')) {
      const input = document.getElementById(activeEncoderPickerTarget);
      if (input) {
        input.value = displayVal;
        input.dispatchEvent(new Event('input'));
      }
      const tag = document.getElementById(`tag-${activeEncoderPickerTarget}`);
      if (tag) tag.textContent = displayVal;
    } else {
      const input = document.getElementById(`encoder-${activeEncoderPickerTarget}-input`);
      if (input) {
        input.value = displayVal;
        input.dispatchEvent(new Event('input'));
      }
    }
    modalActionPicker?.classList.add('hidden');
    showToast(`Ação definida: ${displayVal}`, 'success');
  }

  document.getElementById('btn-apply-encoder-picker')?.addEventListener('click', () => {
    const activeTab = document.querySelector('#encoder-picker-tabs .config-tab.active')?.dataset.tab;
    if (activeTab === 'url') {
      const urlVal = document.getElementById('enc-picker-url-input')?.value.trim();
      if (urlVal) {
        applyChosenEncoderAction(urlVal);
        return;
      }
    }
    const mods = [];
    document.querySelectorAll('.enc-cb-mod.checked').forEach(cb => mods.push(cb.dataset.mod));
    const baseKey = document.getElementById('enc-custom-key-input')?.value.trim() || '';
    if (baseKey) {
      const fullCombo = mods.length > 0 ? `${mods.join('+')}+${baseKey}` : baseKey;
      applyChosenEncoderAction(fullCombo);
    } else {
      modalActionPicker?.classList.add('hidden');
    }
  });

  document.getElementById('btn-test-enc-url')?.addEventListener('click', () => {
    const val = document.getElementById('enc-picker-url-input')?.value.trim();
    if (!val) {
      showToast('Digite uma URL para testar', 'warning');
      return;
    }
    window.api?.openURL?.(val);
    showToast('Abrindo link no navegador...', 'info');
  });

  document.querySelectorAll('#enc-pane-url .enc-url-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      const input = document.getElementById('enc-picker-url-input');
      if (input) input.value = url;
    });
  });

  document.querySelectorAll('.enc-cb-mod').forEach(cb => {
    cb.addEventListener('click', (e) => {
      e.preventDefault();
      cb.classList.toggle('checked');
      const input = cb.querySelector('input');
      if (input) input.checked = cb.classList.contains('checked');
    });
  });

  document.getElementById('btn-record-picker')?.addEventListener('click', () => {
    const target = activeEncoderPickerTarget.startsWith('new-fn-') ? activeEncoderPickerTarget : `encoder-${activeEncoderPickerTarget}`;
    startRecording(target);
    modalActionPicker?.classList.add('hidden');
  });

  // ===================================================================
  // MODAL: CRIAR NOVA FUNÇÃO DE ENCODER (PARTE 3 - CARD COM O "+")
  // ===================================================================
  const modalCreateFn = document.getElementById('modal-create-encoder-fn');
  let selectedFnColor = '#38BDF8';

  document.getElementById('btn-add-encoder-function')?.addEventListener('click', () => {
    const inputName = document.getElementById('new-fn-name');
    const inputDesc = document.getElementById('new-fn-desc');
    const inputCW = document.getElementById('new-fn-cw');
    const inputCCW = document.getElementById('new-fn-ccw');
    const inputClick = document.getElementById('new-fn-click');
    if (inputName) inputName.value = '';
    if (inputDesc) inputDesc.value = '';
    if (inputCW) inputCW.value = '';
    if (inputCCW) inputCCW.value = '';
    if (inputClick) inputClick.value = '';
    
    // Reset tags
    const tagCW = document.getElementById('tag-new-fn-cw');
    const tagCCW = document.getElementById('tag-new-fn-ccw');
    const tagClick = document.getElementById('tag-new-fn-click');
    if (tagCW) tagCW.textContent = 'Nenhum';
    if (tagCCW) tagCCW.textContent = 'Nenhum';
    if (tagClick) tagClick.textContent = 'Nenhum';

    modalCreateFn?.classList.remove('hidden');
  });

  document.getElementById('btn-close-create-fn')?.addEventListener('click', () => {
    modalCreateFn?.classList.add('hidden');
  });
  document.getElementById('btn-cancel-create-fn')?.addEventListener('click', () => {
    modalCreateFn?.classList.add('hidden');
  });

  // Action picker and recording buttons inside modal create fn
  document.querySelectorAll('.btn-open-enc-picker').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'new-fn-cw';
      openEncoderActionPicker(target);
    });
  });

  document.querySelectorAll('.btn-record-enc-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target || 'new-fn-cw';
      startRecording(target);
    });
  });

  document.querySelectorAll('.enc-quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.target;
      const val = chip.dataset.val;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = val;
        input.dispatchEvent(new Event('input'));
      }
      const tag = document.getElementById(`tag-${targetId}`);
      if (tag) tag.textContent = val;
      showToast(`Ação definida: ${val}`, 'info');
    });
  });

  ['new-fn-cw', 'new-fn-ccw', 'new-fn-click'].forEach(id => {
    const input = document.getElementById(id);
    input?.addEventListener('input', () => {
      const tag = document.getElementById(`tag-${id}`);
      if (tag) tag.textContent = input.value.trim() || 'Nenhum';
    });
  });

  document.querySelectorAll('#new-fn-color-picker .color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('#new-fn-color-picker .color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      selectedFnColor = swatch.dataset.color || '#38BDF8';
    });
  });

  document.getElementById('btn-confirm-create-fn')?.addEventListener('click', () => {
    const name = document.getElementById('new-fn-name')?.value.trim();
    if (!name) {
      showToast('Por favor, informe o nome da função!', 'error');
      return;
    }
    const desc = document.getElementById('new-fn-desc')?.value.trim() || 'Função personalizada do usuário';
    const cw = document.getElementById('new-fn-cw')?.value.trim() || 'Volume +';
    const ccw = document.getElementById('new-fn-ccw')?.value.trim() || 'Volume -';
    const click = document.getElementById('new-fn-click')?.value.trim() || 'Mute';

    const fnKey = 'custom_' + Date.now();
    const newFnObj = {
      id: fnKey,
      name: name,
      title: name,
      desc: desc,
      color: selectedFnColor,
      cw: cw,
      ccw: ccw,
      click: click
    };

    const cfg = window.configStore.getConfig();
    if (!cfg.custom_encoder_functions) cfg.custom_encoder_functions = [];
    cfg.custom_encoder_functions.push(newFnObj);

    ENCODER_FUNCTIONS_INFO[fnKey] = {
      title: name,
      cw: cw,
      ccw: ccw,
      click: click
    };
    ENCODER_FUNCTION_COLORS[fnKey] = {
      color: selectedFnColor,
      rgb: hexToRgbString(selectedFnColor)
    };

    window.configStore.setLayerEncoder(encoderTargetLayer, {
      function: fnKey,
      customCW: cw,
      customCCW: ccw,
      customPress: click
    });
    window.configStore.save();

    if (window.api?.syncEncoder) {
      window.api.syncEncoder({
        layer: encoderTargetLayer,
        encoder: { function: fnKey, customCW: cw, customCCW: ccw, customPress: click, steps: { cw: 1, ccw: 1 } }
      });
    }

    modalCreateFn?.classList.add('hidden');
    renderEncoderPage();
    loadEncoderForLayer(encoderTargetLayer);
    showToast(`Função "${name}" criada e selecionada!`, 'success');
  });

  // ===================================================================
  // SOUNDPAD STATUS
  // ===================================================================
  async function checkSoundpadStatus() {
    const dot = document.getElementById('soundpad-status-dot');
    const text = document.getElementById('soundpad-status-text');
    if (!dot || !text) return;

    if (window.api?.checkSoundpad) {
      const isConnected = await window.api.checkSoundpad();
      dot.className = `status-dot ${isConnected ? 'connected' : ''}`;
      text.textContent = isConnected ? 'Conectado (Named Pipe Ativo)' : 'Soundpad não detectado';
    }
  }

  // ===================================================================
  // SERIAL HARDWARE STATUS
  // ===================================================================
  async function refreshPorts() {
    try {
      if (window.api?.reconnectSerial) {
        await window.api.reconnectSerial();
      }
      if (window.api?.getSerialStatus) {
        const res = await window.api.getSerialStatus();
        updateHardwareStatus(res?.connected || false, res?.port || null);
      }
    } catch {
      updateHardwareStatus(false, null);
    }
  }

  document.getElementById('btn-refresh-ports')?.addEventListener('click', () => {
    refreshPorts();
    showToast('Buscando portas seriais...', 'info');
  });

  // ===================================================================
  // CUSTOM CONFIRM / POPUP MODAL (App Visual Identity)
  // ===================================================================
  const customConfirmOverlay = document.getElementById('custom-confirm-overlay');
  const customModalTitle = document.getElementById('custom-modal-title');
  const customModalMessage = document.getElementById('custom-modal-message');
  const customModalIconBadge = document.getElementById('custom-modal-icon-badge');
  const customModalCancelBtn = document.getElementById('custom-modal-cancel-btn');
  const customModalConfirmBtn = document.getElementById('custom-modal-confirm-btn');
  const customModalCloseBtn = document.getElementById('custom-modal-close-btn');

  let confirmModalResolver = null;

  function showCustomConfirm({
    title = 'Confirmar Ação',
    message = 'Tem certeza que deseja prosseguir?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    type = 'danger'
  } = {}) {
    return new Promise((resolve) => {
      confirmModalResolver = resolve;

      if (customModalTitle) customModalTitle.textContent = title;
      if (customModalMessage) customModalMessage.textContent = message;
      if (customModalConfirmBtn) {
        customModalConfirmBtn.textContent = confirmText;
        customModalConfirmBtn.className = `btn custom-modal-btn-confirm ${type === 'danger' ? 'danger' : 'primary'}`;
      }
      if (customModalCancelBtn) customModalCancelBtn.textContent = cancelText;

      if (customModalIconBadge) {
        customModalIconBadge.className = `custom-modal-icon-badge ${type === 'danger' ? '' : 'info'}`;
      }

      customConfirmOverlay?.classList.remove('hidden');
      customModalConfirmBtn?.focus();
    });
  }

  function closeConfirmModal(result = false) {
    customConfirmOverlay?.classList.add('hidden');
    if (confirmModalResolver) {
      const resolver = confirmModalResolver;
      confirmModalResolver = null;
      resolver(result);
    }
  }

  customModalConfirmBtn?.addEventListener('click', () => closeConfirmModal(true));
  customModalCancelBtn?.addEventListener('click', () => closeConfirmModal(false));
  customModalCloseBtn?.addEventListener('click', () => closeConfirmModal(false));

  customConfirmOverlay?.addEventListener('click', (e) => {
    if (e.target === customConfirmOverlay) {
      closeConfirmModal(false);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (customConfirmOverlay && !customConfirmOverlay.classList.contains('hidden')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeConfirmModal(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        closeConfirmModal(true);
      }
    }
  });

  // Reset All Settings
  document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
    const confirmed = await showCustomConfirm({
      title: 'Restaurar Padrões de Fábrica',
      message: 'Tem certeza de que deseja restaurar todas as configurações para o padrão de fábrica? Todas as alterações serão perdidas.',
      confirmText: 'Restaurar',
      cancelText: 'Cancelar',
      type: 'danger'
    });

    if (confirmed) {
      await window.configStore.reset();
      currentLayer = 0;
      selectedKeyIndex = -1;
      applyCurrentLayerTheme();
      renderLayerSelector();
      renderColorPalette();
      renderPadGrid();
      renderOLED();
      renderEncoderCaption();
      showKeyConfigEmpty();
      syncSettingsToggles();
      showToast('Configurações restauradas para o padrão', 'info');
    }
  });

  // ===================================================================
  // TOAST NOTIFICATIONS
  // ===================================================================
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  // ===================================================================
  // RENAME LAYER MODAL (App Visual Identity)
  // ===================================================================
  const customRenameOverlay = document.getElementById('custom-rename-overlay');
  const renameLayerInput = document.getElementById('rename-layer-input');
  const renameLayerCounter = document.getElementById('rename-layer-counter');
  const renameModalCancelBtn = document.getElementById('rename-modal-cancel-btn');
  const renameModalSaveBtn = document.getElementById('rename-modal-save-btn');
  const renameModalCloseBtn = document.getElementById('rename-modal-close-btn');

  let renameTargetLayerIndex = 0;

  function openRenameLayerModal(layerIndex) {
    renameTargetLayerIndex = layerIndex !== undefined ? layerIndex : currentLayer;
    const layer = window.configStore.getLayer(renameTargetLayerIndex);
    const initialName = layer?.name || `Camada ${renameTargetLayerIndex}`;

    if (renameLayerInput) {
      renameLayerInput.value = initialName;
      updateRenameCounter();
    }

    customRenameOverlay?.classList.remove('hidden');
    setTimeout(() => {
      renameLayerInput?.focus();
      renameLayerInput?.select();
    }, 60);
  }

  function closeRenameModal() {
    customRenameOverlay?.classList.add('hidden');
  }

  function updateRenameCounter() {
    if (renameLayerInput && renameLayerCounter) {
      renameLayerCounter.textContent = `${renameLayerInput.value.length}/20`;
    }
  }

  renameLayerInput?.addEventListener('input', updateRenameCounter);

  async function saveLayerRename() {
    if (!renameLayerInput) return;
    let newName = renameLayerInput.value.trim();
    if (!newName) {
      newName = `Camada ${renameTargetLayerIndex}`;
    }

    window.configStore.setLayerName(renameTargetLayerIndex, newName);
    await window.configStore.save();

    closeRenameModal();

    renderLayerSelector();
    renderOLED();
    renderEncoderCaption();
    if (currentPage === 'encoder') {
      renderEncoderPage();
    }

    const layer = window.configStore.getLayer(renameTargetLayerIndex);
    window.api?.notifyHUD?.({
      layer: renameTargetLayerIndex,
      layerName: newName,
      layerColor: layer?.color,
      profile: layer?.profile
    });

    window.api?.updateTrayColor?.(layer?.color, newName);
    showToast(`Camada renomeada para "${newName}"!`, 'success');
  }

  renameModalSaveBtn?.addEventListener('click', saveLayerRename);
  renameModalCancelBtn?.addEventListener('click', closeRenameModal);
  renameModalCloseBtn?.addEventListener('click', closeRenameModal);

  customRenameOverlay?.addEventListener('click', (e) => {
    if (e.target === customRenameOverlay) {
      closeRenameModal();
    }
  });

  renameLayerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLayerRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeRenameModal();
    }
  });

  // ===================================================================
  // MACRO RECORDER & LIBRARY ENGINE
  // ===================================================================
  let isRecordingMacro = false;
  let recordedMacroEvents = [];
  let lastMacroEventTime = 0;

  function renderMacroSequenceTimeline() {
    const seqEl = document.getElementById('macro-sequence');
    const countEl = document.getElementById('macro-event-count');
    if (!seqEl) return;

    if (countEl) {
      countEl.textContent = `${recordedMacroEvents.length} eventos`;
    }

    if (recordedMacroEvents.length === 0) {
      seqEl.innerHTML = `
        <div class="macro-empty" id="macro-empty-hint">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01"/><path d="M8 16h8"/></svg>
          <span>Pressione <strong>Gravar</strong> e execute a sequência desejada no teclado.</span>
        </div>`;
      return;
    }

    let html = '';
    recordedMacroEvents.forEach((ev, idx) => {
      if (idx > 0 && ev.delay > 10) {
        html += `<span class="macro-chip-delay">⏱ ${ev.delay}ms</span>`;
      }
      const dirIcon = ev.type === 'down' ? '↓' : '↑';
      html += `<span class="macro-chip-key" title="${ev.key} (${ev.type})">${ev.key} <small style="font-size: 9px; opacity: 0.7;">${dirIcon}</small></span>`;
    });
    seqEl.innerHTML = html;
    seqEl.scrollTop = seqEl.scrollHeight;
  }

  function handleMacroKeyDown(e) {
    if (!isRecordingMacro) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const delay = lastMacroEventTime > 0 ? Math.min(now - lastMacroEventTime, 2000) : 0;
    lastMacroEventTime = now;

    const keyName = mapKeyboardEventKey(e);
    recordedMacroEvents.push({
      key: keyName,
      code: e.code,
      type: 'down',
      delay
    });

    renderMacroSequenceTimeline();
  }

  function handleMacroKeyUp(e) {
    if (!isRecordingMacro) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const delay = lastMacroEventTime > 0 ? Math.min(now - lastMacroEventTime, 2000) : 0;
    lastMacroEventTime = now;

    const keyName = mapKeyboardEventKey(e);
    recordedMacroEvents.push({
      key: keyName,
      code: e.code,
      type: 'up',
      delay
    });

    renderMacroSequenceTimeline();
  }

  function startMacroRecording() {
    isRecordingMacro = true;
    lastMacroEventTime = 0;
    const btn = document.getElementById('btn-macro-record');
    const pill = document.getElementById('macro-status-pill');
    const text = document.getElementById('macro-status-text');
    const btnText = document.getElementById('btn-macro-record-text');

    btn?.classList.add('recording');
    pill?.classList.add('recording');
    if (text) text.textContent = 'Gravando teclas...';
    if (btnText) btnText.textContent = 'Parar Gravação';

    window.addEventListener('keydown', handleMacroKeyDown, true);
    window.addEventListener('keyup', handleMacroKeyUp, true);
  }

  function stopMacroRecording() {
    isRecordingMacro = false;
    const btn = document.getElementById('btn-macro-record');
    const pill = document.getElementById('macro-status-pill');
    const text = document.getElementById('macro-status-text');
    const btnText = document.getElementById('btn-macro-record-text');

    btn?.classList.remove('recording');
    pill?.classList.remove('recording');
    if (text) text.textContent = 'Gravação concluída';
    if (btnText) btnText.textContent = 'Gravar Macro';

    window.removeEventListener('keydown', handleMacroKeyDown, true);
    window.removeEventListener('keyup', handleMacroKeyUp, true);
  }

  document.getElementById('btn-macro-record')?.addEventListener('click', () => {
    if (isRecordingMacro) {
      stopMacroRecording();
    } else {
      startMacroRecording();
    }
  });

  document.getElementById('btn-macro-clear')?.addEventListener('click', () => {
    if (isRecordingMacro) stopMacroRecording();
    recordedMacroEvents = [];
    lastMacroEventTime = 0;
    renderMacroSequenceTimeline();
    const nameInput = document.getElementById('macro-name-input');
    if (nameInput) nameInput.value = '';
    const text = document.getElementById('macro-status-text');
    if (text) text.textContent = 'Pronto para gravar';
  });

  document.getElementById('btn-macro-save')?.addEventListener('click', async () => {
    if (isRecordingMacro) stopMacroRecording();
    if (recordedMacroEvents.length === 0) {
      showToast('Grave ao menos uma tecla antes de salvar', 'error');
      return;
    }
    const nameInput = document.getElementById('macro-name-input');
    let name = nameInput?.value.trim();
    if (!name) {
      const count = (window.configStore.getMacros() || []).length + 1;
      name = `Macro ${count}`;
    }

    const saved = window.configStore.saveMacro({
      id: 'macro_' + Date.now(),
      name,
      events: [...recordedMacroEvents]
    });
    await window.configStore.save();

    renderMacroLibrary();
    renderMacroKeyPicker();
    showToast(`Macro "${name}" salva com sucesso!`, 'success');
  });

  // ===================================================================
  // MODAL: ATRIBUIR MACRO À TECLA COM ESCOLHA VISUAL
  // ===================================================================
  let pendingAssignMacro = null;
  let assignSelectedLayer = 0;
  let assignSelectedKey = 0;
  let assignSelectedSlot = 'click'; // 'click' | 'hold'

  function openAssignMacroModal(macro) {
    if (!macro) return;
    pendingAssignMacro = macro;
    assignSelectedLayer = currentLayer || 0;
    assignSelectedKey = (selectedKeyIndex >= 0 && selectedKeyIndex < 12) ? selectedKeyIndex : 0;
    assignSelectedSlot = 'click';

    const modal = document.getElementById('modal-assign-macro');
    const nameEl = document.getElementById('assign-macro-modal-name');
    if (nameEl) nameEl.textContent = macro.name;

    renderAssignMacroLayerPills();
    renderAssignMacroPadGrid();

    document.getElementById('assign-type-click')?.classList.add('active');
    document.getElementById('assign-type-hold')?.classList.remove('active');

    modal?.classList.remove('hidden');
  }

  function renderAssignMacroLayerPills() {
    const container = document.getElementById('assign-macro-layer-pills');
    if (!container) return;
    const config = window.configStore.getConfig();
    const layers = config?.layers || [];

    container.innerHTML = layers.map((l, idx) => `
      <button type="button" class="layer-pill ${idx === assignSelectedLayer ? 'active' : ''}" data-layer="${idx}" style="font-size: 11px; padding: 5px 12px; border-radius: 9999px; cursor: pointer;">
        <span class="layer-pill-dot" style="background: ${l.color || '#38BDF8'}; width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 5px;"></span>
        ${l.name || `Camada ${idx}`}
      </button>
    `).join('');

    container.querySelectorAll('button[data-layer]').forEach(btn => {
      btn.addEventListener('click', () => {
        assignSelectedLayer = parseInt(btn.dataset.layer);
        renderAssignMacroLayerPills();
        renderAssignMacroPadGrid();
      });
    });
  }

  function renderAssignMacroPadGrid() {
    const grid = document.getElementById('assign-macro-pad-grid');
    if (!grid) return;
    const config = window.configStore.getConfig();
    const layer = config?.layers?.[assignSelectedLayer];
    const keys = layer?.keys || {};

    let html = '';
    for (let i = 0; i < 12; i++) {
      const kData = keys[i] || keys[String(i)];
      let label = 'Vazio';
      if (i === 3 || kData?.value === 'layer-switch') {
        label = 'Camada';
      } else if (kData) {
        label = kData.label || formatActionDisplay(kData) || 'Tecla';
      }
      const isSelected = (i === assignSelectedKey);
      html += `
        <div class="assign-pad-key-btn ${isSelected ? 'selected' : ''}" data-key="${i}">
          <span class="assign-pad-key-num">B${i}</span>
          <span class="assign-pad-key-lbl" title="${label}">${label}</span>
        </div>
      `;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.assign-pad-key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        assignSelectedKey = parseInt(btn.dataset.key);
        renderAssignMacroPadGrid();
      });
    });
  }

  document.getElementById('assign-type-click')?.addEventListener('click', () => {
    assignSelectedSlot = 'click';
    document.getElementById('assign-type-click')?.classList.add('active');
    document.getElementById('assign-type-hold')?.classList.remove('active');
  });

  document.getElementById('assign-type-hold')?.addEventListener('click', () => {
    assignSelectedSlot = 'hold';
    document.getElementById('assign-type-hold')?.classList.add('active');
    document.getElementById('assign-type-click')?.classList.remove('active');
  });

  document.getElementById('btn-close-assign-macro')?.addEventListener('click', () => {
    document.getElementById('modal-assign-macro')?.classList.add('hidden');
  });
  document.getElementById('btn-cancel-assign-macro')?.addEventListener('click', () => {
    document.getElementById('modal-assign-macro')?.classList.add('hidden');
  });

  document.getElementById('btn-confirm-assign-macro')?.addEventListener('click', async () => {
    if (!pendingAssignMacro) return;
    const macro = pendingAssignMacro;
    const layerIdx = assignSelectedLayer;
    const keyIdx = assignSelectedKey;

    const currentKeyData = window.configStore.getKey(layerIdx, keyIdx) || { type: 'key', value: '' };

    if (assignSelectedSlot === 'hold') {
      currentKeyData.holdAction = {
        type: 'macro',
        value: macro.id,
        name: macro.name,
        label: macro.name
      };
    } else {
      currentKeyData.type = 'macro';
      currentKeyData.value = macro.id;
      currentKeyData.name = macro.name;
      currentKeyData.label = macro.name;
    }

    window.configStore.setKey(layerIdx, keyIdx, currentKeyData);
    await window.configStore.save();

    document.getElementById('modal-assign-macro')?.classList.add('hidden');
    renderPadGrid();
    if (currentLayer === layerIdx) {
      showKeyConfig(keyIdx);
    }
    renderMacroLibrary();
    renderMacroKeyPicker();

    const slotLabel = assignSelectedSlot === 'hold' ? 'Clique Longo (Dupla Função)' : 'Clique Rápido';
    showToast(`Macro "${macro.name}" vinculada à tecla B${keyIdx} da Camada ${layerIdx} em [${slotLabel}]!`, 'success');
  });

  document.getElementById('btn-macro-assign-key')?.addEventListener('click', async () => {
    if (isRecordingMacro) stopMacroRecording();
    if (recordedMacroEvents.length === 0) {
      showToast('Grave uma sequência de teclas primeiro', 'error');
      return;
    }
    const nameInput = document.getElementById('macro-name-input');
    let name = nameInput?.value.trim() || 'Macro';

    const saved = window.configStore.saveMacro({
      id: 'macro_' + Date.now(),
      name,
      events: [...recordedMacroEvents]
    });
    await window.configStore.save();
    renderMacroLibrary();

    openAssignMacroModal(saved);
  });

  function renderMacroLibrary() {
    const listEl = document.getElementById('macro-library-list');
    const badgeEl = document.getElementById('macro-library-count');
    if (!listEl) return;

    const macros = window.configStore.getMacros() || [];
    if (badgeEl) badgeEl.textContent = macros.length;

    if (macros.length === 0) {
      listEl.innerHTML = '<div style="padding: 18px 8px; text-align: center; color: var(--text-muted); font-size: 11.5px;">Nenhuma macro criada ainda.</div>';
      return;
    }

    listEl.innerHTML = macros.map(m => `
      <div class="macro-library-item" data-id="${m.id}">
        <div class="macro-item-info">
          <span class="macro-item-name">${m.name}</span>
          <span class="macro-item-meta">${(m.events || []).length} eventos</span>
        </div>
        <div class="macro-item-actions">
          <button type="button" class="btn btn-outline btn-sm btn-assign-macro" data-id="${m.id}" title="Escolher tecla para atribuir">Atribuir</button>
          <button type="button" class="btn btn-danger btn-sm btn-del-macro" data-id="${m.id}" title="Excluir macro">✕</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-del-macro').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        window.configStore.deleteMacro(id);
        await window.configStore.save();
        renderMacroLibrary();
        renderMacroKeyPicker();
        renderPadGrid();
        showToast('Macro excluída', 'info');
      });
    });

    listEl.querySelectorAll('.btn-assign-macro').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const macro = (window.configStore.getMacros() || []).find(m => m.id === id);
        if (!macro) return;
        openAssignMacroModal(macro);
      });
    });
  }

  function renderMacroKeyPicker() {
    const picker = document.getElementById('macro-key-picker-list');
    const noteEl = document.getElementById('macro-tab-note');
    if (!picker) return;

    const macros = window.configStore.getMacros() || [];
    if (macros.length === 0) {
      if (noteEl) noteEl.classList.add('hidden');
      picker.innerHTML = `
        <div class="macro-picker-empty">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <div class="empty-title">Nenhuma macro criada ainda</div>
          <div class="empty-desc">Acesse o menu <button type="button" class="macro-link-btn" id="btn-goto-macro" title="Clique para abrir o menu Macro">Macro</button> na barra lateral para gravar sua primeira automação e vinculá-la a esta tecla.</div>
        </div>
      `;
      const btnGotoMacro = picker.querySelector('#btn-goto-macro');
      if (btnGotoMacro) {
        btnGotoMacro.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigateTo('macro');
        });
      }
      return;
    }

    if (noteEl) noteEl.classList.remove('hidden');

    const currentSlot = editingKeySlots[activeDualTarget];
    picker.innerHTML = macros.map(m => {
      const isSelected = currentSlot?.type === 'macro' && currentSlot?.value === m.id;
      return `
        <div class="action-item ${isSelected ? 'selected' : ''}" data-macro-id="${m.id}" data-macro-name="${m.name}">
          <svg class="action-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span class="action-item-label">${m.name}</span>
        </div>
      `;
    }).join('');

    picker.querySelectorAll('.action-item').forEach(item => {
      item.addEventListener('click', () => {
        picker.querySelectorAll('.action-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        const macroId = item.dataset.macroId;
        const macroName = item.dataset.macroName;
        const assignment = { type: 'macro', value: macroId, name: macroName };
        editingKeySlots[activeDualTarget] = assignment;

        if (activeDualTarget === 'hold') {
          if (dualHoldVal) dualHoldVal.textContent = formatActionDisplay(assignment);
        } else {
          if (dualClickVal) dualClickVal.textContent = formatActionDisplay(assignment);
        }
      });
    });
  }

  // ===================================================================
  // CUSTOMIZATION PAGE & OLED SIMULATOR
  // ===================================================================
  function initCustomizationPage() {
    const cust = window.configStore.getCustomization();

    const toggleOledDivider = document.getElementById('toggle-oled-divider');
    const toggleOledIcons = document.getElementById('toggle-oled-icons');
    const toggleOledDots = document.getElementById('toggle-oled-dots');
    const toggleOledAnimations = document.getElementById('toggle-oled-animations');
    const selectOledTimeout = document.getElementById('select-oled-timeout');

    const toggleAppGlow = document.getElementById('toggle-app-glow');
    const toggleAppMarquee = document.getElementById('toggle-app-marquee');
    const toggleAppFeedback = document.getElementById('toggle-app-feedback');
    const toggleAppAnimations = document.getElementById('toggle-app-animations');

    // Sync initial toggle visual states
    toggleOledDivider?.classList.toggle('active', cust.oled.showDivider !== false);
    toggleOledIcons?.classList.toggle('active', cust.oled.showIcons !== false);
    toggleOledDots?.classList.toggle('active', cust.oled.showLayerDots !== false);
    toggleOledAnimations?.classList.toggle('active', cust.oled.showAnimations !== false);
    if (selectOledTimeout) selectOledTimeout.value = String(cust.oled.displayTimeout || 1.2);

    toggleAppGlow?.classList.toggle('active', cust.app.glowEffect !== false);
    toggleAppMarquee?.classList.toggle('active', cust.app.marqueeText !== false);
    toggleAppFeedback?.classList.toggle('active', cust.app.hardwareFeedback !== false);
    toggleAppAnimations?.classList.toggle('active', cust.app.transitionAnimations !== false);

    applyAppCustomizations(cust.app);
    updateOledSimulator();

    // Event listeners for OLED options
    toggleOledDivider?.addEventListener('click', async () => {
      toggleOledDivider.classList.toggle('active');
      const active = toggleOledDivider.classList.contains('active');
      await saveOledSetting('showDivider', active);
      updateOledSimulator();
    });

    toggleOledIcons?.addEventListener('click', async () => {
      toggleOledIcons.classList.toggle('active');
      const active = toggleOledIcons.classList.contains('active');
      await saveOledSetting('showIcons', active);
      updateOledSimulator();
    });

    toggleOledDots?.addEventListener('click', async () => {
      toggleOledDots.classList.toggle('active');
      const active = toggleOledDots.classList.contains('active');
      await saveOledSetting('showLayerDots', active);
      updateOledSimulator();
    });

    toggleOledAnimations?.addEventListener('click', async () => {
      toggleOledAnimations.classList.toggle('active');
      const active = toggleOledAnimations.classList.contains('active');
      await saveOledSetting('showAnimations', active);
    });

    selectOledTimeout?.addEventListener('change', async () => {
      const val = parseFloat(selectOledTimeout.value) || 1.2;
      await saveOledSetting('displayTimeout', val);
    });

    // Event listeners for App / Virtual Pad options
    toggleAppGlow?.addEventListener('click', async () => {
      toggleAppGlow.classList.toggle('active');
      const active = toggleAppGlow.classList.contains('active');
      await saveAppSetting('glowEffect', active);
      applyAppCustomizations({ glowEffect: active });
    });

    toggleAppMarquee?.addEventListener('click', async () => {
      toggleAppMarquee.classList.toggle('active');
      const active = toggleAppMarquee.classList.contains('active');
      await saveAppSetting('marqueeText', active);
      applyAppCustomizations({ marqueeText: active });
    });

    toggleAppFeedback?.addEventListener('click', async () => {
      toggleAppFeedback.classList.toggle('active');
      const active = toggleAppFeedback.classList.contains('active');
      await saveAppSetting('hardwareFeedback', active);
      applyAppCustomizations({ hardwareFeedback: active });
    });

    toggleAppAnimations?.addEventListener('click', async () => {
      toggleAppAnimations.classList.toggle('active');
      const active = toggleAppAnimations.classList.contains('active');
      await saveAppSetting('transitionAnimations', active);
      applyAppCustomizations({ transitionAnimations: active });
    });
  }

  async function saveOledSetting(key, val) {
    const cust = window.configStore.getCustomization();
    cust.oled[key] = val;
    window.configStore.setCustomization(cust);
    await window.configStore.save();
    if (window.api?.syncCustomization) {
      window.api.syncCustomization(cust);
    }
  }

  async function saveAppSetting(key, val) {
    const cust = window.configStore.getCustomization();
    cust.app[key] = val;
    window.configStore.setCustomization(cust);
    await window.configStore.save();
  }

  function applyAppCustomizations(appSettings) {
    if (!appSettings) return;
    if (appSettings.glowEffect === false) {
      document.body.classList.add('no-glow');
    } else {
      document.body.classList.remove('no-glow');
    }

    if (appSettings.marqueeText === false) {
      document.body.classList.add('no-marquee');
    } else {
      document.body.classList.remove('no-marquee');
    }

    if (appSettings.transitionAnimations === false) {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }
  }

  function updateOledSimulator(overrideLine1 = null, overrideLine2 = null) {
    const cust = window.configStore.getCustomization();
    const layer = window.configStore.getLayer(currentLayer);
    const encoder = window.configStore.getLayerEncoder(currentLayer);

    const simName = document.getElementById('oled-sim-layer-name');
    const simDots = document.getElementById('oled-sim-dots');
    const simDivider = document.getElementById('oled-sim-divider');
    const simIconBox = document.getElementById('oled-sim-icon-box');
    const simText = document.getElementById('oled-sim-action-text');

    if (simName) {
      simName.textContent = (overrideLine1 || layer?.name || `CAMADA ${currentLayer}`).toUpperCase();
    }

    if (simDots) {
      if (overrideLine1) {
        simDots.style.display = 'none';
      } else {
        const config = window.configStore.getConfig();
        const numLayers = Math.min(4, config?.layers?.length || 4);
        let dotsStr = '';
        for (let i = 0; i < numLayers; i++) {
          dotsStr += (i === currentLayer) ? '● ' : '○ ';
        }
        simDots.textContent = dotsStr.trim();
        simDots.style.display = (cust.oled.showLayerDots !== false) ? 'block' : 'none';
      }
    }

    if (simDivider) {
      simDivider.style.display = (cust.oled.showDivider !== false) ? 'block' : 'none';
    }

    if (simIconBox) {
      simIconBox.style.display = (cust.oled.showIcons !== false && !overrideLine2) ? 'flex' : 'none';
    }

    if (simText) {
      if (overrideLine2) {
        simText.textContent = overrideLine2.toUpperCase();
      } else {
        const fn = encoder?.function || 'volume';
        const titles = {
          volume: 'VOL & MUTE',
          brightness: 'BRILHO',
          scroll: 'SCROLL',
          media: 'MULTIMIDIA',
          zoom: 'ZOOM TELA',
          video: 'VIDEO NAV',
          custom: 'CUSTOM PAD'
        };
        simText.textContent = titles[fn] || fn.toUpperCase();
      }
    }
  }

  // ===================================================================
  // BACKUP EXPORT & IMPORT
  // ===================================================================
  const btnExportConfig = document.getElementById('btn-export-config');
  const btnImportConfig = document.getElementById('btn-import-config');
  const inputImportConfig = document.getElementById('input-import-config');

  btnExportConfig?.addEventListener('click', async () => {
    try {
      const cfg = window.configStore.getConfig();
      if (window.api?.exportConfig) {
        const res = await window.api.exportConfig(cfg);
        if (res?.success) {
          showToast('Backup exportado com sucesso!', 'success');
        } else if (!res?.canceled) {
          showToast('Erro ao exportar backup: ' + (res?.error || 'Desconhecido'), 'error');
        }
      } else {
        const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `padpro-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup baixado com sucesso!', 'success');
      }
    } catch (err) {
      showToast('Erro na exportação: ' + err.message, 'error');
    }
  });

  btnImportConfig?.addEventListener('click', async () => {
    try {
      if (window.api?.importConfig) {
        const res = await window.api.importConfig();
        if (res?.success && res.config) {
          window.configStore.importConfig(res.config);
          await window.configStore.save();
          applyCurrentLayerTheme();
          renderLayerSelector();
          renderColorPalette();
          renderPadGrid();
          renderOLED();
          renderEncoderCaption();
          renderMacroLibrary();
          renderMacroKeyPicker();
          refreshSoundpadSoundMap();
          showToast('Configurações importadas com sucesso!', 'success');
        } else if (!res?.canceled) {
          showToast('Falha ao importar: ' + (res?.error || 'Arquivo inválido'), 'error');
        }
      } else {
        inputImportConfig?.click();
      }
    } catch (err) {
      showToast('Erro na importação: ' + err.message, 'error');
    }
  });

  inputImportConfig?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const parsed = JSON.parse(evt.target.result);
          if (!parsed || typeof parsed !== 'object' || (!parsed.layers && !parsed.version)) {
            showToast('Arquivo JSON inválido ou incompatível', 'error');
            return;
          }
          window.configStore.importConfig(parsed);
          await window.configStore.save();
          applyCurrentLayerTheme();
          renderLayerSelector();
          renderColorPalette();
          renderPadGrid();
          renderOLED();
          renderEncoderCaption();
          renderMacroLibrary();
          renderMacroKeyPicker();
          refreshSoundpadSoundMap();
          showToast('Configurações restauradas do backup!', 'success');
        } catch (err) {
          showToast('Erro ao ler JSON: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    } catch (err) {
      showToast('Erro ao carregar arquivo: ' + err.message, 'error');
    } finally {
      inputImportConfig.value = '';
    }
  });

  // ===================================================================
  // AUTO-UPDATER UI LOGIC
  // ===================================================================
  function initAutoUpdaterUI() {
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    const settingsAppVersion = document.getElementById('settings-app-version');
    const settingsUpdaterStatus = document.getElementById('settings-updater-status');

    const modalAppUpdate = document.getElementById('modal-app-update');
    const btnCloseUpdateModal = document.getElementById('btn-close-update-modal');
    const btnCancelUpdate = document.getElementById('btn-cancel-update');
    const btnConfirmUpdate = document.getElementById('btn-confirm-update');
    const btnConfirmUpdateText = document.getElementById('btn-confirm-update-text');
    const updateModalTitle = document.getElementById('update-modal-title');
    const updateModalSubtitle = document.getElementById('update-modal-subtitle');
    const updateTargetVersion = document.getElementById('update-target-version');
    const updateReleaseNotes = document.getElementById('update-release-notes');
    const updateReleaseDate = document.getElementById('update-release-date');

    const updateProgressWrapper = document.getElementById('update-progress-wrapper');
    const updateProgressBar = document.getElementById('update-progress-bar');
    const updateProgressPctLabel = document.getElementById('update-progress-pct-label');
    const updateProgressTransferred = document.getElementById('update-progress-transferred');
    const updateProgressSpeed = document.getElementById('update-progress-speed');

    let updateState = 'idle'; // idle | available | downloading | downloaded | error

    // Load current version into badge
    if (window.api?.getAppVersion) {
      window.api.getAppVersion().then(v => {
        if (v) {
          if (settingsAppVersion) settingsAppVersion.textContent = 'v' + v;
          const aboutAppVersion = document.getElementById('about-app-version');
          if (aboutAppVersion) aboutAppVersion.textContent = 'v' + v + ' PRO';
        }
      }).catch(() => {});
    }

    function openModal() {
      modalAppUpdate?.classList.remove('hidden');
    }

    function closeModal() {
      if (updateState === 'downloading') {
        showToast('O download continuará em segundo plano.', 'info');
      }
      modalAppUpdate?.classList.add('hidden');
    }

    btnCloseUpdateModal?.addEventListener('click', closeModal);
    btnCancelUpdate?.addEventListener('click', closeModal);

    // Click on check updates button in Settings
    btnCheckUpdates?.addEventListener('click', async () => {
      if (!window.api?.checkForUpdates) return;
      if (settingsUpdaterStatus) {
        settingsUpdaterStatus.textContent = 'Verificando atualizações no GitHub...';
      }
      btnCheckUpdates.disabled = true;
      try {
        const res = await window.api.checkForUpdates();
        if (res?.isDev) {
          showToast(res.message || 'Disponível na versão compilada/instalada.', 'info');
          if (settingsUpdaterStatus) {
            settingsUpdaterStatus.textContent = 'Em modo de desenvolvimento.';
          }
        } else if (res?.success) {
          if (settingsUpdaterStatus) {
            settingsUpdaterStatus.textContent = 'Verificação iniciada...';
          }
        } else if (res?.error) {
          showToast('Não foi possível verificar atualizações: ' + res.error, 'error');
          if (settingsUpdaterStatus) {
            settingsUpdaterStatus.textContent = 'Falha ao verificar atualizações.';
          }
        }
      } catch (err) {
        showToast('Erro ao checar atualizações: ' + err.message, 'error');
      } finally {
        setTimeout(() => {
          btnCheckUpdates.disabled = false;
        }, 2000);
      }
    });

    // Action button inside modal (Download -> Install)
    btnConfirmUpdate?.addEventListener('click', async () => {
      if (updateState === 'available') {
        // Trigger download
        updateState = 'downloading';
        btnConfirmUpdate.disabled = true;
        btnConfirmUpdateText.textContent = 'Baixando...';
        updateProgressWrapper?.classList.remove('hidden');
        try {
          await window.api?.downloadUpdate();
        } catch (err) {
          showToast('Erro ao iniciar download: ' + err.message, 'error');
          updateState = 'available';
          btnConfirmUpdate.disabled = false;
          btnConfirmUpdateText.textContent = 'Tentar Novamente';
        }
      } else if (updateState === 'downloaded') {
        // Trigger install
        btnConfirmUpdate.disabled = true;
        btnConfirmUpdateText.textContent = 'Reiniciando...';
        showToast('Reiniciando para aplicar a atualização...', 'info');
        window.api?.installUpdate();
      }
    });

    // Listen for updater events from main process
    if (window.api?.onUpdaterStatus) {
      window.api.onUpdaterStatus((data) => {
        if (!data) return;

        if (data.status === 'checking') {
          if (settingsUpdaterStatus) settingsUpdaterStatus.textContent = 'Consultando novas versões...';
        } else if (data.status === 'not-available') {
          if (settingsUpdaterStatus) settingsUpdaterStatus.textContent = 'Você já está usando a versão mais recente!';
          showToast('Seu PAD Pro já está na versão mais recente!', 'success');
        } else if (data.status === 'available') {
          updateState = 'available';
          if (settingsUpdaterStatus) settingsUpdaterStatus.textContent = `Nova versão v${data.version} disponível!`;
          if (updateTargetVersion) updateTargetVersion.textContent = 'v' + data.version;
          if (updateModalTitle) updateModalTitle.textContent = `Nova Versão v${data.version} Disponível!`;
          if (updateReleaseDate && data.releaseDate) {
            try {
              const d = new Date(data.releaseDate);
              updateReleaseDate.textContent = 'Lançada em ' + d.toLocaleDateString();
            } catch {}
          }
          if (updateReleaseNotes && data.releaseNotes) {
            updateReleaseNotes.innerHTML = typeof data.releaseNotes === 'string' ? data.releaseNotes : 'Novas melhorias inclusas.';
          }
          if (btnConfirmUpdateText) btnConfirmUpdateText.textContent = 'Baixar e Atualizar';
          if (btnConfirmUpdate) btnConfirmUpdate.disabled = false;
          updateProgressWrapper?.classList.add('hidden');
          const shouldNotify = window.configStore.getConfig()?.system?.notifyUpdates !== false;
          if (shouldNotify) {
            openModal();
          } else {
            showToast(`Nova versão v${data.version} disponível!`, 'info');
          }
        } else if (data.status === 'downloading') {
          updateState = 'downloading';
          updateProgressWrapper?.classList.remove('hidden');
          const pct = Math.floor(data.percent || 0);
          if (updateProgressBar) updateProgressBar.style.width = `${pct}%`;
          if (updateProgressPctLabel) updateProgressPctLabel.textContent = `${pct}%`;
          
          if (updateProgressTransferred && data.transferred && data.total) {
            const mbTransferred = (data.transferred / (1024 * 1024)).toFixed(1);
            const mbTotal = (data.total / (1024 * 1024)).toFixed(1);
            updateProgressTransferred.textContent = `${mbTransferred} MB / ${mbTotal} MB`;
          }
          if (updateProgressSpeed && data.bytesPerSecond) {
            const speedKB = (data.bytesPerSecond / 1024).toFixed(0);
            updateProgressSpeed.textContent = speedKB > 1024 ? `${(speedKB / 1024).toFixed(1)} MB/s` : `${speedKB} KB/s`;
          }
        } else if (data.status === 'downloaded') {
          updateState = 'downloaded';
          if (settingsUpdaterStatus) settingsUpdaterStatus.textContent = `Versão v${data.version} pronta para instalar!`;
          if (updateModalTitle) updateModalTitle.textContent = `Atualização Pronta para Instalar!`;
          if (updateModalSubtitle) updateModalSubtitle.textContent = `O download da nova versão foi concluído com sucesso.`;
          if (btnConfirmUpdateText) btnConfirmUpdateText.textContent = 'Reiniciar e Instalar Agora';
          if (btnConfirmUpdate) btnConfirmUpdate.disabled = false;
          if (updateProgressBar) updateProgressBar.style.width = '100%';
          if (updateProgressPctLabel) updateProgressPctLabel.textContent = '100%';
          showToast(`Nova versão v${data.version} baixada! Pronto para reiniciar.`, 'success');
          openModal();
        } else if (data.status === 'error') {
          updateState = 'error';
          console.warn('Updater status error:', data.message);
          if (settingsUpdaterStatus) settingsUpdaterStatus.textContent = 'Erro ao verificar atualizações.';
        }
      });
    }
  }

  // ===================================================================
  // START APPLICATION
  // ===================================================================
  initApp();

})();
