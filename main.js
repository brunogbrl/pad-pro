const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
  console.warn('[AutoUpdater] Não foi possível carregar electron-updater:', e?.message);
}

// Disable hardware acceleration to prevent GPU crashes on Windows
app.disableHardwareAcceleration();

function bringMainWindowToFront() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  }
}

// Enforce single instance to prevent duplicate HUDs and duplicate processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    bringMainWindowToFront();
  });
}

// Paths
const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const OLD_CONFIG_FILE = path.join(CONFIG_DIR, 'sharkropad-config.json');
const CONFIG_FILE = path.join(CONFIG_DIR, 'padpro-config.json');
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

let mainWindow = null;
let hudWindow = null;
let tray = null;
let serialPortInstance = null;
let serialBuffer = '';
let currentConfig = null;
let soundpadSoundMap = {};
let lastSoundpadMtime = 0;
let currentHardwareLayer = null;

app.isQuitting = false;

function safeSend(win, channel, ...args) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch {}
}

// =====================================================================
// DEFAULT CONFIG
// =====================================================================
function getDefaultConfig() {
  return {
    version: '2.0',
    language: 'pt-BR',
    hud: {
      enabled: true
    },
    system: {
      startOnBoot: false,
      startMinimized: false,
      closeToTray: true,
      developerMode: false,
      autoCheckUpdates: true,
      notifyUpdates: true
    },
    soundpad: {
      enabled: true,
      previewOnHold: true,
      holdDelay: 380
    },
    encoder: {
      function: 'volume',
      customCW: null,
      customCCW: null,
      customPress: null
    },
    macros: [],
    layers: [
      {
        name: 'CAMADA 0',
        profile: 'DIRETAS',
        color: '#38BDF8',
        encoder: { function: 'volume' },
        keys: {
          0: { type: 'key', value: 'F15', holdAction: null, fixed: false, label: '' },
          1: { type: 'key', value: 'F16', holdAction: null, fixed: false, label: '' },
          2: { type: 'key', value: 'F17', holdAction: null, fixed: false, label: '' },
          3: { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' },
          4: { type: 'key', value: 'F18', holdAction: null, fixed: false, label: '' },
          5: { type: 'key', value: 'F19', holdAction: null, fixed: false, label: '' },
          6: { type: 'key', value: 'F20', holdAction: null, fixed: false, label: '' },
          7: { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' },
          8: { type: 'key', value: 'F21', holdAction: null, fixed: false, label: '' },
          9: { type: 'key', value: 'F22', holdAction: null, fixed: false, label: '' },
          10: { type: 'key', value: 'F23', holdAction: null, fixed: false, label: '' },
          11: { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' }
        }
      },
      {
        name: 'CAMADA 1',
        profile: 'COMBO ALT',
        color: '#F87171',
        encoder: { function: 'brightness' },
        keys: {
          0: { type: 'key', value: 'F24', holdAction: null, fixed: false, label: '' },
          1: { type: 'combo', value: ['Alt', 'F13'], holdAction: null, fixed: false, label: '' },
          2: { type: 'combo', value: ['Alt', 'F14'], holdAction: null, fixed: false, label: '' },
          3: { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' },
          4: { type: 'combo', value: ['Alt', 'F15'], holdAction: null, fixed: false, label: '' },
          5: { type: 'combo', value: ['Alt', 'F16'], holdAction: null, fixed: false, label: '' },
          6: { type: 'combo', value: ['Alt', 'F17'], holdAction: null, fixed: false, label: '' },
          7: { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' },
          8: { type: 'combo', value: ['Alt', 'F18'], holdAction: null, fixed: false, label: '' },
          9: { type: 'combo', value: ['Alt', 'F19'], holdAction: null, fixed: false, label: '' },
          10: { type: 'combo', value: ['Alt', 'F20'], holdAction: null, fixed: false, label: '' },
          11: { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' }
        }
      },
      {
        name: 'CAMADA 2',
        profile: 'COMBO CTRL',
        color: '#FB923C',
        encoder: { function: 'scroll' },
        keys: {
          0: { type: 'combo', value: ['Alt', 'F21'], holdAction: null, fixed: false, label: '' },
          1: { type: 'combo', value: ['Alt', 'F22'], holdAction: null, fixed: false, label: '' },
          2: { type: 'combo', value: ['Alt', 'F23'], holdAction: null, fixed: false, label: '' },
          3: { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' },
          4: { type: 'combo', value: ['Alt', 'F24'], holdAction: null, fixed: false, label: '' },
          5: { type: 'combo', value: ['Ctrl', 'F13'], holdAction: null, fixed: false, label: '' },
          6: { type: 'combo', value: ['Ctrl', 'F14'], holdAction: null, fixed: false, label: '' },
          7: { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' },
          8: { type: 'combo', value: ['Ctrl', 'F15'], holdAction: null, fixed: false, label: '' },
          9: { type: 'combo', value: ['Ctrl', 'F16'], holdAction: null, fixed: false, label: '' },
          10: { type: 'combo', value: ['Ctrl', 'F17'], holdAction: null, fixed: false, label: '' },
          11: { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' }
        }
      },
      {
        name: 'CAMADA 3',
        profile: 'CTRL + SHIFT',
        color: '#4ADE80',
        encoder: { function: 'media' },
        keys: {
          0: { type: 'combo', value: ['Ctrl', 'Shift', 'F15'], holdAction: null, fixed: false, label: '' },
          1: { type: 'combo', value: ['Ctrl', 'Shift', 'F16'], holdAction: null, fixed: false, label: '' },
          2: { type: 'combo', value: ['Ctrl', 'Shift', 'F17'], holdAction: null, fixed: false, label: '' },
          3: { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' },
          4: { type: 'combo', value: ['Ctrl', 'Shift', 'F18'], holdAction: null, fixed: false, label: '' },
          5: { type: 'combo', value: ['Ctrl', 'Shift', 'F19'], holdAction: null, fixed: false, label: '' },
          6: { type: 'combo', value: ['Ctrl', 'Shift', 'F20'], holdAction: null, fixed: false, label: '' },
          7: { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' },
          8: { type: 'combo', value: ['Ctrl', 'Shift', 'F21'], holdAction: null, fixed: false, label: '' },
          9: { type: 'combo', value: ['Ctrl', 'Shift', 'F22'], holdAction: null, fixed: false, label: '' },
          10: { type: 'combo', value: ['Ctrl', 'Shift', 'F23'], holdAction: null, fixed: false, label: '' },
          11: { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' }
        }
      }
    ]
  };
}

function loadConfig() {
  try {
    const targetFile = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : (fs.existsSync(OLD_CONFIG_FILE) ? OLD_CONFIG_FILE : null);
    if (targetFile) {
      const data = fs.readFileSync(targetFile, 'utf8');
      currentConfig = { ...getDefaultConfig(), ...JSON.parse(data) };
      return currentConfig;
    }
  } catch (e) {
    console.error('Erro ao carregar config:', e);
  }
  currentConfig = getDefaultConfig();
  return currentConfig;
}

function saveConfig(config) {
  try {
    currentConfig = config;
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    try { fs.writeFileSync(OLD_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); } catch {}

    // Build pad configuration with soundpad_sounds embedded
    const soundMap = generateSoundpadSoundsMap();
    const configForPad = {
      ...config,
      soundpad_sounds: soundMap
    };

    // Sync directly to the pad flash drive if connected
    const padDrives = ['D:\\', 'E:\\', 'F:\\'];
    for (const drv of padDrives) {
      try {
        if (fs.existsSync(path.join(drv, 'code.py'))) {
          sendSerialCommand('OLED:UPDATING');
          const localCodePath = path.join(__dirname, 'scripts', 'code.py');
          if (fs.existsSync(localCodePath)) {
            try {
              const localCode = fs.readFileSync(localCodePath, 'utf8');
              const targetCodePath = path.join(drv, 'code.py');
              const currentPicoCode = fs.existsSync(targetCodePath) ? fs.readFileSync(targetCodePath, 'utf8') : '';
              if (localCode !== currentPicoCode) {
                fs.writeFileSync(targetCodePath, localCode, 'utf8');
                logDebug(`[FIRMWARE SYNC] scripts/code.py sincronizado para ${targetCodePath}`);
                sendSerialCommand('RELOAD_FIRMWARE');
              }
            } catch (errCodeSync) {
              logDebug(`[FIRMWARE SYNC AVISO] ${errCodeSync.message}`);
            }
          }
          // Sincronizar boot.py, autorun.inf e icon.ico para identidade oficial PadPro
          try {
            const localBoot = path.join(__dirname, 'scripts', 'boot.py');
            if (fs.existsSync(localBoot)) {
              const targetBoot = path.join(drv, 'boot.py');
              if (!fs.existsSync(targetBoot) || fs.readFileSync(localBoot, 'utf8') !== fs.readFileSync(targetBoot, 'utf8')) {
                fs.writeFileSync(targetBoot, fs.readFileSync(localBoot, 'utf8'), 'utf8');
              }
            }
            const localAutorun = path.join(__dirname, 'scripts', 'autorun.inf');
            if (fs.existsSync(localAutorun)) {
              fs.copyFileSync(localAutorun, path.join(drv, 'autorun.inf'));
            }
            const localIcon = path.join(__dirname, 'build', 'icon.ico');
            if (fs.existsSync(localIcon)) {
              fs.copyFileSync(localIcon, path.join(drv, 'icon.ico'));
            }
          } catch {}
          fs.writeFileSync(path.join(drv, 'config.json'), JSON.stringify(configForPad, null, 2), 'utf8');
          logDebug(`[CONFIG SYNC] Configuração gravada diretamente no pad (${drv}config.json com ${Object.keys(soundMap).length} sons)`);
          
          // Sincronizar funcoes do encoder de todas as camadas
          if (Array.isArray(config.layers)) {
            config.layers.forEach((l, idx) => {
              const enc = l.encoder || {};
              const fn = enc.function || 'volume';
              const cw = (enc.customCW || '').replace(/[:|\r\n]/g, '-');
              const ccw = (enc.customCCW || '').replace(/[:|\r\n]/g, '-');
              const press = (enc.customPress || '').replace(/[:|\r\n]/g, '-');
              const stepCW = enc.steps?.cw || config.encoder_steps?.[fn]?.cw || 1;
              const stepCCW = enc.steps?.ccw || config.encoder_steps?.[fn]?.ccw || 1;
              sendSerialCommand(`SET_ENCODER:${idx}:${fn}:${cw}:${ccw}:${press}:${stepCW}:${stepCCW}`);
            });
          }

          const o = config.customization?.oled || {};
          const sd = o.showDivider !== false ? '1' : '0';
          const si = o.showIcons !== false ? '1' : '0';
          const sdo = o.showLayerDots !== false ? '1' : '0';
          const tout = o.displayTimeout || 1.2;
          const anim = o.showAnimations !== false ? '1' : '0';
          sendSerialCommand(`SET_OLED_CUSTOM:${sd}:${si}:${sdo}:${tout}:${anim}`);
          
          if (currentHardwareLayer !== null) {
            sendSerialCommand(`SET_LAYER:${currentHardwareLayer}`);
          }
          sendSerialCommand('CONFIG_UPDATED');
          break;
        }
      } catch (errSync) {
        logDebug(`[CONFIG SYNC AVISO] ${errSync.message}`);
      }
    }

    // Update tray menu and HUD
    updateTrayMenu();
    broadcastConfigUpdate();
    return true;
  } catch (e) {
    console.error('Erro ao salvar config:', e);
    return false;
  }
}

// =====================================================================
// WINDOW CREATION
// =====================================================================
function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const startMinimized = currentConfig?.system?.startMinimized || false;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 700,
    show: !startMinimized,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startMinimized) {
      bringMainWindowToFront();
    }
  });

  // Guarantee window becomes visible even if ready-to-show is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !startMinimized) {
      bringMainWindowToFront();
    }
  }, 1000);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[DID FAIL LOAD] ${errorCode}: ${errorDescription}`);
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && currentConfig?.system?.closeToTray !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createHUDWindow() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    if (currentConfig?.hud?.enabled !== false) {
      hudWindow.showInactive();
    }
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;

  const hudW = 280;
  const hudH = 48;
  const defaultX = screenW - hudW - 24;
  const defaultY = screenH - hudH - 24;

  let posX = defaultX;
  let posY = defaultY;

  // Restore saved custom position if valid
  if (currentConfig?.hud?.position && typeof currentConfig.hud.position.x === 'number' && typeof currentConfig.hud.position.y === 'number') {
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(d => {
      const { x, y, width, height } = d.bounds;
      return (
        currentConfig.hud.position.x >= x - 50 &&
        currentConfig.hud.position.x <= x + width &&
        currentConfig.hud.position.y >= y - 20 &&
        currentConfig.hud.position.y <= y + height
      );
    });
    if (isVisible) {
      posX = currentConfig.hud.position.x;
      posY = currentConfig.hud.position.y;
    }
  }

  hudWindow = new BrowserWindow({
    width: hudW,
    height: hudH,
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload-hud.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  hudWindow.loadFile(path.join(__dirname, 'src', 'hud.html'));
  hudWindow.setAlwaysOnTop(true, 'screen-saver');

  let hudMoveDebounce = null;
  const onHUDMoved = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const [curX, curY] = hudWindow.getPosition();
    if (!currentConfig.hud) currentConfig.hud = {};
    currentConfig.hud.position = { x: curX, y: curY };
    currentConfig.hud.customPosition = true;

    if (hudMoveDebounce) clearTimeout(hudMoveDebounce);
    hudMoveDebounce = setTimeout(() => {
      saveConfig(currentConfig);
    }, 300);
  };

  hudWindow.on('moved', onHUDMoved);

  const isHUDActive = currentConfig?.hud?.enabled !== false;
  const isAutoHide = currentConfig?.hud?.mode === 'auto_hide';

  if (isHUDActive && !isAutoHide) {
    hudWindow.showInactive();
  } else {
    hudWindow.hide();
  }

  hudWindow.on('closed', () => {
    hudWindow = null;
  });
}

// =====================================================================
// SYSTEM TRAY
// =====================================================================
let baseTrayRawBitmap = null;

function getBaseTrayBitmap() {
  if (!baseTrayRawBitmap) {
    try {
      const baseImg = nativeImage.createFromPath(ICON_PATH).resize({ width: 32, height: 32, quality: 'best' });
      baseTrayRawBitmap = baseImg.toBitmap();
    } catch (e) {
      console.error('Erro ao ler ícone base da tray:', e);
    }
  }
  return baseTrayRawBitmap;
}

function hexToRgb(hex) {
  if (!hex) return { r: 56, g: 189, b: 248 };
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const num = parseInt(hex, 16);
  if (isNaN(num)) return { r: 56, g: 189, b: 248 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function createTintedTrayIcon(hexColor) {
  const rawBuf = getBaseTrayBitmap();
  if (!rawBuf) {
    return nativeImage.createFromPath(ICON_PATH);
  }

  const buf = Buffer.from(rawBuf);
  const { r: tr, g: tg, b: tb } = hexToRgb(hexColor);

  // 1. Tint cyan/blue highlight pixels of the PadPRO icon
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i];
    const g = buf[i + 1];
    const r = buf[i + 2];
    const a = buf[i + 3];

    if (a > 30) {
      // Check if pixel is part of the cyan/blue highlights
      if (b > r + 20 && g > r + 10) {
        const brightness = Math.max(r, g, b) / 255;
        buf[i] = Math.round(tb * brightness);     // B
        buf[i + 1] = Math.round(tg * brightness); // G
        buf[i + 2] = Math.round(tr * brightness); // R
      }
    }
  }

  // 2. Draw a clean glowing circular layer badge dot in the bottom right corner (32x32)
  const cx = 24;
  const cy = 24;
  const radius = 4.5;
  for (let y = 18; y < 32; y++) {
    for (let x = 18; x < 32; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * 32 + x) * 4;
      if (dist <= radius) {
        buf[idx] = tb;
        buf[idx + 1] = tg;
        buf[idx + 2] = tr;
        buf[idx + 3] = 255;
      } else if (dist <= radius + 1.2) {
        const factor = Math.max(0, radius + 1.2 - dist);
        buf[idx] = Math.round(buf[idx] * (1 - factor) + 15 * factor);
        buf[idx + 1] = Math.round(buf[idx + 1] * (1 - factor) + 23 * factor);
        buf[idx + 2] = Math.round(buf[idx + 2] * (1 - factor) + 42 * factor);
        buf[idx + 3] = Math.max(buf[idx + 3], Math.round(255 * factor));
      }
    }
  }

  try {
    const rawImg = nativeImage.createFromBitmap(buf, { width: 32, height: 32 });
    const png = rawImg.toPNG();
    if (png && png.length > 0) {
      return nativeImage.createFromBuffer(png);
    }
    return rawImg;
  } catch (err) {
    return nativeImage.createFromPath(ICON_PATH);
  }
}

function updateTrayIcon(hexColor, layerName) {
  if (!tray) return;
  try {
    const icon = createTintedTrayIcon(hexColor);
    tray.setImage(icon);
    if (layerName) {
      tray.setToolTip(`PAD Pro — ${layerName}`);
    }
  } catch (e) {
    console.error('Erro ao atualizar ícone da tray:', e);
  }
}

function createTray() {
  try {
    const initialLayer = currentConfig?.layers?.[currentHardwareLayer || 0] || currentConfig?.layers?.[0];
    const initialColor = initialLayer?.color || '#38BDF8';
    const initialName = initialLayer?.name || 'Camada 0';

    let icon = null;
    try {
      tray = new Tray(ICON_PATH);
    } catch {
      try {
        icon = createTintedTrayIcon(initialColor);
      } catch {}
      if (!icon || icon.isEmpty()) {
        icon = nativeImage.createFromPath(ICON_PATH);
      }
      tray = new Tray(icon);
    }
    tray.setToolTip(`PAD Pro — ${initialName}`);

    tray.on('double-click', () => {
      bringMainWindowToFront();
    });

    updateTrayMenu();
  } catch (e) {
    console.error('Erro ao criar tray:', e);
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const isHUDActive = currentConfig?.hud?.enabled !== false;
  const layers = currentConfig?.layers || [];

  const layerSubmenu = layers.map((layer, idx) => ({
    label: layer.name || `Camada ${idx}`,
    click: () => {
      dispatchPadEvent({
        type: 'layer-change',
        layer: idx,
        layerName: layer.name || `Camada ${idx}`,
        color: layer.color || '#38BDF8',
        profile: layer.profile || 'CUSTOM'
      });
    }
  }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'PAD Pro Configurator',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Abrir Configurador',
      click: () => {
        bringMainWindowToFront();
      }
    },
    {
      label: 'HUD Flutuante',
      submenu: [
        {
          label: 'Ativar HUD',
          type: 'checkbox',
          checked: isHUDActive,
          click: (item) => toggleHUD(item.checked)
        },
        { type: 'separator' },
        {
          label: 'Sempre Visível',
          type: 'radio',
          checked: (currentConfig?.hud?.mode || 'always') === 'always',
          click: () => setHUDMode('always')
        },
        {
          label: 'Apenas ao Atualizar Tecla/Camada',
          type: 'radio',
          checked: currentConfig?.hud?.mode === 'auto_hide',
          click: () => setHUDMode('auto_hide')
        },
        { type: 'separator' },
        {
          label: 'Redefinir Posição do HUD (Canto)',
          click: () => resetHUDPosition()
        }
      ]
    },
    {
      label: 'Camadas',
      submenu: layerSubmenu
    },
    { type: 'separator' },
    {
      label: 'Sair do PAD Pro',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

let hudAutoHideTimer = null;

function showHUDTemporarily(durationMs = 2500) {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (currentConfig?.hud?.enabled === false) return;

  if (hudAutoHideTimer) {
    clearTimeout(hudAutoHideTimer);
    hudAutoHideTimer = null;
  }

  if (!hudWindow.isVisible()) {
    hudWindow.showInactive();
  }

  hudAutoHideTimer = setTimeout(() => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      if (currentConfig?.hud?.mode === 'auto_hide') {
        hudWindow.hide();
      }
    }
    hudAutoHideTimer = null;
  }, durationMs);
}

function setHUDMode(mode) {
  if (!currentConfig.hud) currentConfig.hud = {};
  currentConfig.hud.mode = mode; // 'always' or 'auto_hide'
  saveConfig(currentConfig);

  if (hudWindow && !hudWindow.isDestroyed()) {
    if (currentConfig.hud.enabled !== false) {
      if (mode === 'auto_hide') {
        showHUDTemporarily(2500);
      } else {
        if (hudAutoHideTimer) {
          clearTimeout(hudAutoHideTimer);
          hudAutoHideTimer = null;
        }
        hudWindow.showInactive();
      }
    } else {
      hudWindow.hide();
    }
  }

  mainWindow?.webContents.send('hud:mode-changed', mode);
  updateTrayMenu();
  return mode;
}

function toggleHUD(enabled) {
  if (!currentConfig.hud) currentConfig.hud = {};
  currentConfig.hud.enabled = enabled;
  saveConfig(currentConfig);

  if (hudWindow && !hudWindow.isDestroyed()) {
    if (enabled) {
      if (currentConfig.hud.mode === 'auto_hide') {
        showHUDTemporarily(2500);
      } else {
        hudWindow.showInactive();
      }
    } else {
      if (hudAutoHideTimer) {
        clearTimeout(hudAutoHideTimer);
        hudAutoHideTimer = null;
      }
      hudWindow.hide();
    }
  }

  mainWindow?.webContents.send('hud:state-changed', enabled);
  updateTrayMenu();
}

function resetHUDPosition() {
  if (!currentConfig.hud) currentConfig.hud = {};
  delete currentConfig.hud.position;
  currentConfig.hud.customPosition = false;
  saveConfig(currentConfig);

  if (hudWindow && !hudWindow.isDestroyed()) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenW, height: screenH } = primaryDisplay.workAreaSize;
    const bounds = hudWindow.getBounds();
    const defaultX = screenW - bounds.width - 24;
    const defaultY = screenH - bounds.height - 24;
    hudWindow.setBounds({ x: defaultX, y: defaultY, width: bounds.width, height: bounds.height });
    showHUDTemporarily(2500);
  }
  return true;
}

function broadcastConfigUpdate() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    const layer = currentConfig?.layers?.[0];
    hudWindow.webContents.send('hud:update', {
      layer: 0,
      layerName: layer?.name || 'CAMADA 0',
      color: layer?.color || '#38BDF8',
      profile: layer?.profile || 'PADRÃO'
    });
  }
}

// =====================================================================
// SOUNDPAD READER (REAL-TIME XML CACHE)
// =====================================================================
function updateSoundpadCache(force = false) {
  try {
    const soundlistPath = path.join(process.env.APPDATA || '', 'Leppsoft', 'soundlist.spl');
    if (!fs.existsSync(soundlistPath)) {
      if (Object.keys(soundpadSoundMap).length > 0) {
        soundpadSoundMap = {};
        return true;
      }
      return false;
    }

    const stat = fs.statSync(soundlistPath);
    if (force || stat.mtimeMs !== lastSoundpadMtime) {
      const content = fs.readFileSync(soundlistPath, 'utf8');
      const tagRegex = /<Sound\b([^>]*)\/?>/g;
      let tagMatch;
      const newMap = {};
      while ((tagMatch = tagRegex.exec(content)) !== null) {
        const attrs = tagMatch[1];
        const keyM = attrs.match(/\bkey="(\d+)"/);
        const modsM = attrs.match(/\bkeyModifiers="(\d+)"/);
        const titleM = attrs.match(/\btitle="([^"]+)"/);
        if (keyM && titleM) {
          const key = parseInt(keyM[1]);
          const mods = modsM ? parseInt(modsM[1]) : 0;
          let title = titleM[1];
          // Decode common XML entities
          title = title
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'");
          newMap[`${mods}_${key}`] = title;
        }
      }
      const prevKeys = Object.keys(soundpadSoundMap);
      const newKeys = Object.keys(newMap);
      let changed = force || prevKeys.length !== newKeys.length;
      if (!changed) {
        for (const k of newKeys) {
          if (soundpadSoundMap[k] !== newMap[k]) {
            changed = true;
            break;
          }
        }
      }
      soundpadSoundMap = newMap;
      lastSoundpadMtime = stat.mtimeMs;
      return changed;
    }
  } catch (e) {
    console.error('Erro ao processar soundlist.spl:', e);
  }
  return false;
}

function triggerSoundpadSave() {
  return new Promise((resolve) => {
    const tryPipe = (pipeName) => {
      return new Promise((res) => {
        const pipePath = `\\\\.\\pipe\\${pipeName}`;
        const client = net.createConnection(pipePath, () => {
          try {
            client.write('DoSaveSoundlist()\r\n');
          } catch {}
          setTimeout(() => {
            try { client.end(); } catch {}
            res(true);
          }, 80);
        });
        client.on('error', () => res(false));
        setTimeout(() => {
          try { client.destroy(); } catch {}
          res(false);
        }, 300);
      });
    };

    tryPipe('sp_remote_control').then(success => {
      if (!success) {
        tryPipe('sp_pipe').then(resolve);
      } else {
        resolve(true);
      }
    });
  });
}

function setupSoundpadWatcher() {
  const soundlistPath = path.join(process.env.APPDATA || '', 'Leppsoft', 'soundlist.spl');
  const leppsoftDir = path.join(process.env.APPDATA || '', 'Leppsoft');

  const checkAndUpdate = (forced = false) => {
    const updated = updateSoundpadCache(forced);
    if (updated) {
      safeSend(mainWindow, 'soundpad:updated', soundpadSoundMap);
    }
  };

  try {
    if (fs.existsSync(soundlistPath)) {
      fs.watchFile(soundlistPath, { interval: 1500 }, () => checkAndUpdate(false));
    } else if (fs.existsSync(leppsoftDir)) {
      fs.watch(leppsoftDir, (eventType, filename) => {
        if (filename && filename.toLowerCase().includes('soundlist')) {
          setTimeout(() => checkAndUpdate(true), 400);
        }
      });
    }
  } catch (e) {
    console.warn('Erro ao configurar watcher do Soundpad:', e);
  }

  // Periodic polling every 3.5 seconds
  setInterval(() => checkAndUpdate(false), 3500);
}

// =====================================================================
// SOUNDPAD LIVE PLAYBACK TRACKING
// =====================================================================
let soundpadPlaybackInterval = null;
let currentPlayingSoundTitle = null;

function querySoundpadPlayStatus() {
  return new Promise((resolve) => {
    const client = net.createConnection('\\\\.\\pipe\\sp_remote_control', () => {
      client.write('GetPlayStatus()\r\n');
    });
    client.on('data', (d) => {
      client.end();
      resolve(d.toString().trim());
    });
    client.on('error', () => resolve(null));
    setTimeout(() => {
      try { client.end(); } catch (e) {}
      resolve(null);
    }, 450);
  });
}

function startSoundpadPlaybackTracking(soundTitle) {
  currentPlayingSoundTitle = soundTitle || 'Som em reprodução';

  // 1. Hardware OLED: set line 1 "TOCANDO SOM" and line 2 soundTitle, with dur=0 (indefinite until reset)
  const safeTitle = currentPlayingSoundTitle.substring(0, 18);
  sendSerialCommand(`OLED:TOCANDO SOM|${safeTitle}|0`);

  // 2. Floating HUD: persistent playing indicator
  safeSend(hudWindow, 'hud:update', { isSoundPlaying: true, soundTitle: currentPlayingSoundTitle });

  // 3. Virtual Pad & Configurator
  safeSend(mainWindow, 'soundpad:playing', { playing: true, soundTitle: currentPlayingSoundTitle });

  if (soundpadPlaybackInterval) clearInterval(soundpadPlaybackInterval);
  soundpadPlaybackInterval = setInterval(async () => {
    const status = await querySoundpadPlayStatus();
    // Soundpad returns 'PLAYING', 'PAUSED', 'STOPPED', or null if disconnected
    if (status !== 'PLAYING') {
      stopSoundpadPlaybackTracking();
    }
  }, 250);
}

function stopSoundpadPlaybackTracking() {
  if (soundpadPlaybackInterval) {
    clearInterval(soundpadPlaybackInterval);
    soundpadPlaybackInterval = null;
  }
  if (!currentPlayingSoundTitle) return;
  currentPlayingSoundTitle = null;

  // 1. Hardware OLED: Restore default screen
  sendSerialCommand('OLED:RESET');

  // 2. Floating HUD: Restore
  safeSend(hudWindow, 'hud:update', { isSoundPlaying: false });

  // 3. Virtual Pad & Configurator
  safeSend(mainWindow, 'soundpad:playing', { playing: false });
}

// =====================================================================
// DISCORD RPC INTEGRATION (APP ID: 1553424943046201376)
// =====================================================================
const DISCORD_CLIENT_ID = '1553424943046201376';
let discordClient = null;
let discordConnected = false;
let discordUser = null;
let discordVoiceSettings = { mute: false, deaf: false };
let discordReconnectTimer = null;

function connectDiscordRPC() {
  if (discordClient) {
    try { discordClient.destroy(); } catch (e) {}
    discordClient = null;
  }

  const pipePath = '\\\\.\\pipe\\discord-ipc-0';
  const client = net.createConnection(pipePath, () => {
    logDebug('[DISCORD] Conectado ao named pipe do Discord!');
    const payload = JSON.stringify({ v: 1, client_id: DISCORD_CLIENT_ID });
    const buffer = Buffer.alloc(8 + Buffer.byteLength(payload));
    buffer.writeInt32LE(0, 0); // Opcode 0: HANDSHAKE
    buffer.writeInt32LE(Buffer.byteLength(payload), 4);
    buffer.write(payload, 8);
    client.write(buffer);
  });

  client.on('data', (d) => {
    try {
      const opcode = d.readInt32LE(0);
      const length = d.readInt32LE(4);
      const json = JSON.parse(d.slice(8, 8 + length).toString());

      if (opcode === 1 && json.cmd === 'DISPATCH' && json.evt === 'READY') {
        discordConnected = true;
        discordUser = json.data?.user || null;
        logDebug(`[DISCORD] Autenticado com sucesso como: ${discordUser?.username || 'Usuário'}`);
        safeSend(mainWindow, 'discord:status-changed', { connected: true, user: discordUser, voice: discordVoiceSettings });
        updateDiscordActivity();

        // Inscrever para atualizações de microfone e fone
        sendDiscordCommand('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
        sendDiscordCommand('GET_VOICE_SETTINGS');
      }

      if (json.cmd === 'GET_VOICE_SETTINGS' || (json.cmd === 'DISPATCH' && json.evt === 'VOICE_SETTINGS_UPDATE')) {
        if (json.data) {
          discordVoiceSettings.mute = !!json.data.mute;
          discordVoiceSettings.deaf = !!json.data.deaf;
          logDebug(`[DISCORD VOICE] Mute: ${discordVoiceSettings.mute}, Deafen: ${discordVoiceSettings.deaf}`);
          safeSend(mainWindow, 'discord:voice-status', discordVoiceSettings);
          safeSend(hudWindow, 'discord:voice-status', discordVoiceSettings);
        }
      }
    } catch (e) {
      logDebug(`[DISCORD ERRO RX] ${e.message}`);
    }
  });

  client.on('error', () => {
    discordConnected = false;
    discordUser = null;
  });

  client.on('close', () => {
    discordConnected = false;
    discordUser = null;
    safeSend(mainWindow, 'discord:status-changed', { connected: false });
    if (!discordReconnectTimer) {
      discordReconnectTimer = setTimeout(() => {
        discordReconnectTimer = null;
        connectDiscordRPC();
      }, 15000);
    }
  });

  discordClient = client;
}

function sendDiscordCommand(cmd, args = {}, evt = null) {
  if (!discordClient || !discordConnected) return false;
  try {
    const payload = JSON.stringify({
      cmd,
      args,
      evt: evt || undefined,
      nonce: Math.random().toString(36).substring(2, 12)
    });
    const buffer = Buffer.alloc(8 + Buffer.byteLength(payload));
    buffer.writeInt32LE(1, 0); // Opcode 1: FRAME
    buffer.writeInt32LE(Buffer.byteLength(payload), 4);
    buffer.write(payload, 8);
    discordClient.write(buffer);
    return true;
  } catch (e) {
    logDebug(`[DISCORD ERRO TX] ${e.message}`);
    return false;
  }
}

function updateDiscordActivity(layerName = null) {
  if (!discordConnected) return;
  const lName = layerName || currentConfig?.layers?.[currentHardwareLayer]?.name || `Camada ${currentHardwareLayer}`;
  sendDiscordCommand('SET_ACTIVITY', {
    pid: process.pid,
    activity: {
      details: 'PAD Pro Macropad',
      state: `${lName} Ativa`,
      timestamps: {
        start: Math.floor(Date.now() / 1000)
      }
    }
  });
}


function getVkCode(str) {
  if (!str) return null;
  const s = str.trim().toUpperCase();
  if (s.startsWith('F') && !isNaN(s.slice(1))) {
    const fNum = parseInt(s.slice(1));
    return 112 + fNum - 1; // VK_F1=112, VK_F24=135
  }
  if (s.length === 1) {
    const code = s.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 48 && code <= 57)) return code;
  }
  const map = {
    'SPACE': 32, 'ESPAÇO': 32,
    'ENTER': 13, 'RETURN': 13,
    'TAB': 9, 'ESCAPE': 27, 'ESC': 27,
    'BACKSPACE': 8, 'DELETE': 46, 'DEL': 46,
    'INSERT': 45, 'INS': 45,
    'HOME': 36, 'END': 35,
    'PAGEUP': 33, 'PGUP': 33,
    'PAGEDOWN': 34, 'PGDN': 34,
    'PRINTSCREEN': 44, 'PRTSC': 44
  };
  return map[s] || null;
}

function getSoundTitleForButton(btnName) {
  if (currentConfig?.soundpad?.enabled === false) return null;
  updateSoundpadCache();

  if (Array.isArray(btnName)) btnName = btnName.join('+');
  if (!btnName || typeof btnName !== 'string') return null;

  // Parse button key name e.g. "Alt + F15", "F17", "Ctrl + Shift + F14"
  const parts = btnName.split('+').map(p => p.trim().toUpperCase());
  let mods = 0;
  let targetVk = null;

  for (const p of parts) {
    if (p === 'ALT') mods |= 1;
    else if (p === 'CTRL' || p === 'CONTROL') mods |= 2;
    else if (p === 'SHIFT') mods |= 4;
    else if (p === 'WIN' || p === 'GUI' || p === 'META') mods |= 8;
    else {
      const vk = getVkCode(p);
      if (vk !== null) targetVk = vk;
    }
  }

  if (targetVk !== null) {
    return soundpadSoundMap[`${mods}_${targetVk}`] || null;
  }
  return null;
}

function generateSoundpadSoundsMap() {
  updateSoundpadCache();
  const map = {};
  if (!currentConfig || !currentConfig.layers) return map;

  currentConfig.layers.forEach((layer) => {
    const keys = layer.keys || {};
    Object.values(keys).forEach((key) => {
      if (!key || key.fixed || key.type === 'fixed' || key.type === 'media') return;
      let label = '';
      if (key.type === 'key') label = key.value;
      else if (key.type === 'combo' && Array.isArray(key.value)) label = key.value.join(' + ');

      if (label) {
        const title = getSoundTitleForButton(label);
        if (title) {
          map[label] = title;
        }
      }
    });
  });
  return map;
}


// =====================================================================
// DEBUG LOGGING & SERIAL COMMUNICATION
// =====================================================================
const LOG_FILE = path.join(CONFIG_DIR, 'padpro-serial.log');
const recentLogs = [];

function logDebug(msg) {
  const ts = new Date().toLocaleTimeString();
  const line = `[${ts}] ${msg}`;
  recentLogs.push(line);
  if (recentLogs.length > 200) recentLogs.shift();

  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch {}

  console.log(line);
  safeSend(mainWindow, 'log:message', line);
}

function sendSerialCommand(cmd) {
  if (serialPortInstance && serialPortInstance.isOpen) {
    try {
      serialPortInstance.write(cmd + '\r\n');
      logDebug(`[Serial TX] ${cmd}`);
    } catch (e) {
      logDebug(`[Serial TX ERRO] ${e.message}`);
    }
  }
}

// =====================================================================
// WINDOWS AUDIO & HARDWARE SYNCHRONIZATION
// =====================================================================
let audioListenerProc = null;
let lastKnownVolume = 50;
let lastKnownMute = 0;
let lastKnobTurnTime = 0;

function getAudioHelperPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'scripts', 'pad-audio.exe'),
    path.join((app.getAppPath() || '').replace('app.asar', 'app.asar.unpacked'), 'scripts', 'pad-audio.exe'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'scripts', 'pad-audio.exe'),
    path.join(process.resourcesPath || '', 'scripts', 'pad-audio.exe'),
    path.join(__dirname, 'scripts', 'pad-audio.exe')
  ];
  for (const c of candidates) {
    if (c && !c.includes('app.asar\\') && !c.includes('app.asar/') && fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function queryWindowsBrightness() {
  try {
    const { exec } = require('child_process');
    exec('powershell -NoProfile -Command "(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness"', (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        const b = parseInt(stdout.trim(), 10);
        if (!isNaN(b) && b >= 0 && b <= 100) {
          sendSerialCommand(`SET_BRIGHTNESS:${b}`);
        }
      }
    });
  } catch {}
}

function startWindowsAudioListener() {
  const exePath = getAudioHelperPath();
  if (!exePath) {
    logDebug('[AUDIO] pad-audio.exe não encontrado.');
    return;
  }

  if (audioListenerProc) {
    try { audioListenerProc.kill(); } catch {}
    audioListenerProc = null;
  }

  try {
    const { spawn } = require('child_process');
    audioListenerProc = spawn(exePath, ['listen'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    logDebug(`[AUDIO] Monitor de volume iniciado via ${exePath}`);

    let audioBuffer = '';
    audioListenerProc.stdout.on('data', (data) => {
      audioBuffer += data.toString('utf8');
      const lines = audioBuffer.split('\n');
      audioBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const m = trimmed.match(/(?:READY\|)?VOL:(\d+)\|MUTE:(\d+)/);
        if (m) {
          const vol = parseInt(m[1], 10);
          const mute = parseInt(m[2], 10);
          const changed = (vol !== lastKnownVolume || mute !== lastKnownMute);
          lastKnownVolume = vol;
          lastKnownMute = mute;

          // Se o encoder foi girado recentemente (< 1.5s), exibe a barra no display
          const recentlyTurned = (Date.now() - lastKnobTurnTime < 1500);
          const showBar = recentlyTurned ? '1' : '0';

          if (serialPortInstance && serialPortInstance.isOpen) {
            sendSerialCommand(`SET_VOL:${vol}:${mute}:${showBar}`);
          }

          if (changed) {
            safeSend(mainWindow, 'system:volume-changed', { volume: vol, muted: mute === 1 });
            if (hudWindow && !hudWindow.isDestroyed() && currentConfig?.hud?.enabled !== false && recentlyTurned) {
              safeSend(hudWindow, 'hud:update', {
                action: mute === 1 ? 'Mudo' : `Volume: ${vol}%`,
                progress: vol,
                icon: mute === 1 ? 'mute' : 'volume'
              });
            }
          }
        }
      }
    });

    audioListenerProc.on('error', (err) => {
      logDebug(`[AUDIO ERRO] ${err.message}`);
    });

    audioListenerProc.on('close', (code) => {
      logDebug(`[AUDIO] Monitor finalizado (código ${code})`);
      audioListenerProc = null;
      if (!app.isQuitting) {
        setTimeout(startWindowsAudioListener, 3000);
      }
    });
  } catch (e) {
    logDebug(`[AUDIO SPAWN ERRO] ${e.message}`);
  }
}

async function setupSerialListener() {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();

    let targetPort = null;

    // 1. Primary match: Raspberry Pi Pico / RP2040 VID (0x239A or 0x2E8A) or PnpId
    for (const p of ports) {
      const vid = (p.vendorId || '').toUpperCase();
      const pnp = (p.pnpId || '').toUpperCase();
      const name = (p.friendlyName || p.description || '').toLowerCase();
      const mfg = (p.manufacturer || '').toLowerCase();

      if (vid === '239A' || pnp.includes('VID_239A') || pnp.includes('239A')) {
        targetPort = p.path;
        break;
      }
      if (vid === '2E8A' || pnp.includes('VID_2E8A') || pnp.includes('2E8A')) {
        targetPort = p.path;
        break;
      }
      if (name.includes('circuitpython') || name.includes('pico') || name.includes('rp2040') || mfg.includes('raspberry')) {
        targetPort = p.path;
        break;
      }
    }

    // 2. Fallback: Any USB Serial device on any PC (PT-BR "Dispositivo Serial USB", EN "USB Serial Device", etc.)
    if (!targetPort) {
      for (const p of ports) {
        const name = (p.friendlyName || p.description || '').toLowerCase();
        const pnp = (p.pnpId || '').toUpperCase();
        if (pnp.startsWith('USB\\') || name.includes('dispositivo serial usb') || name.includes('usb serial')) {
          if (p.path !== 'COM1' && p.path !== 'COM2') {
            targetPort = p.path;
            break;
          }
        }
      }
    }

    if (targetPort && (!serialPortInstance || serialPortInstance.path !== targetPort || !serialPortInstance.isOpen)) {
      if (serialPortInstance && serialPortInstance.isOpen) {
        try { serialPortInstance.close(); } catch {}
      }

      logDebug(`Tentando conectar na porta ${targetPort}...`);
      serialPortInstance = new SerialPort({
        path: targetPort,
        baudRate: 115200,
        autoOpen: true
      });

      serialPortInstance.on('open', () => {
        logDebug(`[Serial CONECTADO] Pad detectado em ${targetPort}`);
        // CRITICAL FOR CIRCUITPYTHON: DTR & RTS must be asserted
        serialPortInstance.set({ dtr: true, rts: true }, (err) => {
          if (err) logDebug(`[Serial DTR ERRO] ${err.message}`);
          else logDebug('[Serial DTR/RTS ativos com sucesso]');
        });

        setTimeout(() => {
          sendSerialCommand('PING');
          if (lastKnownVolume !== null) {
            sendSerialCommand(`SET_VOL:${lastKnownVolume}:${lastKnownMute}:0`);
          }
          queryWindowsBrightness();
        }, 500);

        safeSend(mainWindow, 'pad:serial-status', { connected: true, port: targetPort });
      });

      serialPortInstance.on('data', (chunk) => {
        serialBuffer += chunk.toString('utf8');
        const lines = serialBuffer.split('\n');
        serialBuffer = lines.pop(); // keep partial

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (trimmed) {
            handleSerialLine(trimmed);
          }
        }
      });

      serialPortInstance.on('error', (err) => {
        logDebug(`[Serial ERRO] ${err.message}`);
        safeSend(mainWindow, 'pad:serial-status', { connected: false, port: null });
      });

      serialPortInstance.on('close', () => {
        logDebug('[Serial DESCONECTADO]');
        safeSend(mainWindow, 'pad:serial-status', { connected: false, port: null });
        serialPortInstance = null;
      });
    }
  } catch (e) {
    // Port scan error
  }
}

// =====================================================================
// EXECUTORES DE APLICATIVO E COMANDO DO SISTEMA
// =====================================================================
function launchApp(appTarget, args = '') {
  if (!appTarget || !appTarget.trim()) return;
  const target = appTarget.trim();
  logDebug(`[LAUNCH APP] Iniciando: ${target} ${args ? `(args: ${args})` : ''}`);

  if (target.includes('://') || target.endsWith(':')) {
    shell.openExternal(target).catch(e => logDebug(`[APP PROTOCOL ERRO] ${e.message}`));
    return;
  }

  if (!args && fs.existsSync(target) && target.toLowerCase().endsWith('.lnk')) {
    shell.openPath(target).catch(e => logDebug(`[APP LNK ERRO] ${e.message}`));
    return;
  }

  let cmdLine = '';
  if (target.includes(' ') && !target.startsWith('"')) {
    cmdLine = `start "" "${target}" ${args || ''}`;
  } else {
    cmdLine = `start "" ${target} ${args || ''}`;
  }

  exec(cmdLine, { windowsHide: false }, (err) => {
    if (err) {
      logDebug(`[LAUNCH APP start ERRO] ${err.message}, tentando fallback...`);
      if (fs.existsSync(target)) {
        shell.openPath(target).catch(e => logDebug(`[LAUNCH APP openPath ERRO] ${e.message}`));
      } else {
        exec(`"${target}" ${args || ''}`, (err2) => {
          if (err2) logDebug(`[LAUNCH APP exec direto ERRO] ${err2.message}`);
        });
      }
    }
  });
}

function executeSystemCommand(commandText, interpreter = 'powershell', customName = '') {
  if (!commandText || !commandText.trim()) return;
  const cleanCmd = commandText.trim();
  const interp = (interpreter || 'powershell').toLowerCase();
  logDebug(`[COMMAND EXEC] (${interp}) [${customName || 'cmd'}]: ${cleanCmd}`);

  let fullCommand = '';
  if (interp === 'cmd') {
    fullCommand = `cmd.exe /c "${cleanCmd}"`;
  } else if (interp === 'python') {
    if (cleanCmd.endsWith('.py') || cleanCmd.includes('.py ')) {
      fullCommand = `python "${cleanCmd}"`;
    } else {
      fullCommand = `python -c "${cleanCmd.replace(/"/g, '\\"')}"`;
    }
  } else {
    fullCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${cleanCmd.replace(/"/g, '`"')}"`;
  }

  exec(fullCommand, { windowsHide: true }, (err, stdout, stderr) => {
    if (err) {
      logDebug(`[COMMAND ERRO] ${err.message}`);
    } else {
      logDebug(`[COMMAND SUCESSO] ${stdout ? stdout.trim() : 'OK'}`);
    }
  });
}

global._lastSystemActionTimes = global._lastSystemActionTimes || {};
function handleKeySystemAction(actionObj, keyIndex) {
  if (!actionObj) return;
  const now = Date.now();
  const lastTime = global._lastSystemActionTimes[keyIndex] || 0;
  if (now - lastTime < 900) {
    logDebug(`[ACTION DEBOUNCE] B${keyIndex} ignorado para evitar disparo duplo`);
    return;
  }
  global._lastSystemActionTimes[keyIndex] = now;

  const type = actionObj.type;
  if (type === 'app') {
    launchApp(actionObj.value || actionObj.path, actionObj.args);
  } else if (type === 'command') {
    executeSystemCommand(actionObj.command || actionObj.value, actionObj.interpreter, actionObj.name || actionObj.label);
  } else if (type === 'url' || (actionObj.value && typeof actionObj.value === 'string' && (actionObj.value.startsWith('http://') || actionObj.value.startsWith('https://')))) {
    let urlsToOpen = [];
    if (Array.isArray(actionObj.urls) && actionObj.urls.length > 0) {
      urlsToOpen = actionObj.urls;
    } else if (Array.isArray(actionObj.value)) {
      urlsToOpen = actionObj.value;
    } else if (typeof actionObj.value === 'string' && actionObj.value.trim()) {
      urlsToOpen = [actionObj.value.trim()];
    }
    const cleanUrls = [...new Set(urlsToOpen.map(u => (u || '').trim()).filter(Boolean))];
    cleanUrls.forEach((u, idx) => {
      let targetUrl = u;
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
      }
      setTimeout(() => {
        shell.openExternal(targetUrl).catch(e => logDebug(`[URL ERRO] ${e.message}`));
        logDebug(`[URL ABERTA] B${keyIndex} [${idx + 1}/${cleanUrls.length}] abriu: ${targetUrl}`);
      }, idx * 150);
    });
  }
}

function handleSerialLine(line) {
  if (!line) return;
  if (line.includes('[URL HID]')) {
    global._lastUrlTriggerTime = Date.now();
  }
  logDebug(`[RX] ${line}`);

  // 1. Preview Soundpad: "PREVIEW Botao 2: F17 | Camada 0" or "[SERIAL] PREVIEW..."
  const previewMatch = line.match(/(?:\[SERIAL\]\s*)?PREVIEW\s+(?:Botao|B)\s*(\d+):\s*(.*?)\s*\|\s*Camada\s*(\d+)/i);
  if (previewMatch) {
    const keyIndex = parseInt(previewMatch[1]);
    const keyName = previewMatch[2].trim();
    const layer = parseInt(previewMatch[3]);
    const soundTitle = getSoundTitleForButton(keyName);

    const actionText = soundTitle ? `🔍 ${soundTitle}` : `🔍 B${keyIndex} ➜ ${keyName}`;
    dispatchPadEvent({
      type: 'preview',
      keyIndex,
      keyName,
      layer,
      soundTitle,
      actionText,
      isPreview: true
    });
    return;
  }

  // 1.5 Dual Function Hold: "HOLD Botao 11: Mute | Camada 3"
  const holdMatch = line.match(/(?:\[SERIAL\]\s*)?HOLD\s+(?:Botao|B)\s*(\d+):\s*(.*?)\s*\|\s*Camada\s*(\d+)/i);
  if (holdMatch) {
    const keyIndex = parseInt(holdMatch[1]);
    const holdName = holdMatch[2].trim();
    const layer = parseInt(holdMatch[3]);
    dispatchPadEvent({
      type: 'key-press',
      keyIndex,
      keyName: holdName,
      layer,
      soundTitle: null,
      actionText: `⏳ ${holdName}`,
      isPreview: false
    });

    const layerObj = currentConfig?.layers?.[layer];
    const keyData = layerObj?.keys?.[keyIndex];
    if (keyData?.holdAction && typeof keyData.holdAction === 'object') {
      handleKeySystemAction(keyData.holdAction, keyIndex);
    }
    return;
  }

  // 2. Normal Key Press: "Botao 2: F17 | Camada 0" or "[SERIAL] Botao 2..." or "[HUD] C0 | B2: F17"
  const btnMatch = line.match(/(?:\[SERIAL\]\s*)?(?:DOWN\s+)?(?:Botao|B)\s*(\d+):\s*(.*?)\s*\|\s*Camada\s*(\d+)/i) ||
                   line.match(/\[HUD\]\s*C(\d+)\s*\|\s*B(\d+):\s*(.*)/i);
  if (btnMatch) {
    let keyIndex, keyName, layer;
    if (line.includes('[HUD]')) {
      layer = parseInt(btnMatch[1]);
      keyIndex = parseInt(btnMatch[2]);
      keyName = btnMatch[3].trim();
    } else {
      keyIndex = parseInt(btnMatch[1]);
      keyName = btnMatch[2].trim();
      layer = parseInt(btnMatch[3]);
    }
    const soundTitle = getSoundTitleForButton(keyName);
    const actionText = soundTitle ? `🔊 ${soundTitle}` : `B${keyIndex} ➜ ${keyName}`;

    dispatchPadEvent({
      type: 'key-press',
      keyIndex,
      keyName,
      layer,
      soundTitle,
      actionText,
      isPreview: false
    });

    if (soundTitle) {
      startSoundpadPlaybackTracking(soundTitle);
    } else if (currentPlayingSoundTitle) {
      // Se estava reproduzindo um som e o usuário apertou outra tecla (ex: Play/Pause ou Stop), checa e encerra imediatamente
      querySoundpadPlayStatus().then((status) => {
        if (status !== 'PLAYING') {
          stopSoundpadPlaybackTracking();
        }
      });
    }

    // Check if this key in config has a system action (URL, App, Command)
    const layerObj = currentConfig?.layers?.[layer];
    const keyData = layerObj?.keys?.[keyIndex];
    if (keyData) {
      handleKeySystemAction(keyData, keyIndex);
    }
    return;
  }

  // 3. Key Release (UP): "[SERIAL] UP Botao 2"
  const upMatch = line.match(/UP\s+Botao\s*(\d+)/i);
  if (upMatch) {
    const keyIndex = parseInt(upMatch[1]);
    safeSend(mainWindow, 'pad:event', {
      type: 'key-up',
      keyIndex
    });
    return;
  }

  // 4. Explicit physical layer change (only when user physically pressed layer button on pad):
  const explicitMatch = line.match(/Mudou para Camada\s*(\d+)/i);
  if (explicitMatch) {
    const layer = parseInt(explicitMatch[1]);
    const layerData = currentConfig?.layers?.[layer];
    currentHardwareLayer = layer;

    dispatchPadEvent({
      type: 'layer-change',
      layer,
      layerName: layerData?.name || `CAMADA ${layer}`,
      color: layerData?.color || '#38BDF8',
      profile: layerData?.profile || 'CUSTOM',
      actionText: `Mudou para Camada ${layer}`
    });
    return;
  }

  // 5. Periodic Heartbeat, Status, or Sync line:
  // IMPORTANT: Keep HUD and currentHardwareLayer synced, but NEVER dispatch 'layer-change' to mainWindow
  // so the user's active editor layer is never hijacked or bounced back!
  const heartbeatMatch = line.match(/(?:\[HEARTBEAT\]\s*Camada|STATUS\s*Camada:|Camada inicial:|Camada sincronizada:|\[HUD\]\s*Camada)\s*(\d+)/i);
  if (heartbeatMatch) {
    const layer = parseInt(heartbeatMatch[1]);
    currentHardwareLayer = layer;
    const layerData = currentConfig?.layers?.[layer] || currentConfig?.layers?.[0];
    if (layerData?.color) {
      updateTrayIcon(layerData.color, layerData.name);
    }
    if (hudWindow && !hudWindow.isDestroyed() && currentConfig?.hud?.enabled !== false) {
      safeSend(hudWindow, 'hud:update', {
        layer,
        layerName: layerData?.name || `CAMADA ${layer}`,
        layerColor: layerData?.color || '#38BDF8',
        color: layerData?.color || '#38BDF8',
        profile: layerData?.profile || 'PADRÃO',
        action: null
      });
    }
    return;
  }

  // 6. Rotary Encoder / Knob rotation or click from physical pad:
  if (line.includes('OSD_BAR|volume')) {
    lastKnobTurnTime = Date.now();
  }
  const encMatch = line.match(/(?:ENCODER|KNOB|ROTARY|GIRO)\s*(?:TURN\s*)?(CW|CCW|RIGHT|LEFT|UP|DOWN|CLICK|PRESS)/i);
  if (encMatch) {
    lastKnobTurnTime = Date.now();
    const action = encMatch[1].toUpperCase();
    const isCW = action === 'CW' || action === 'RIGHT' || action === 'UP';
    const isCCW = action === 'CCW' || action === 'LEFT' || action === 'DOWN';
    const isClick = action === 'CLICK' || action === 'PRESS';

    const encFn = currentConfig?.layers?.[currentHardwareLayer]?.encoder?.function || 'volume';
    if (encFn === 'layer_nav' && !line.includes('Funcao: layer_nav')) {
      const totalLayers = currentConfig?.layers?.length || 4;
      if (isCW) {
        const next = (currentHardwareLayer + 1) % totalLayers;
        switchHardwareLayer(next);
      } else if (isCCW) {
        const prev = (currentHardwareLayer - 1 + totalLayers) % totalLayers;
        switchHardwareLayer(prev);
      } else if (isClick) {
        switchHardwareLayer(0);
      }
    }

    if (isCW || isCCW) {
      dispatchPadEvent({
        type: 'encoder-turn',
        direction: isCW ? 'cw' : 'ccw',
        delta: isCW ? 1 : -1
      });
    } else if (isClick) {
      dispatchPadEvent({
        type: 'encoder-click'
      });
    }
    return;
  }
}

function switchHardwareLayer(layer) {
  const target = Math.max(0, parseInt(layer) || 0);
  currentHardwareLayer = target;
  sendSerialCommand(`SET_LAYER:${target}`);
  const layerData = currentConfig?.layers?.[target] || currentConfig?.layers?.[0];
  dispatchPadEvent({
    type: 'layer-change',
    layer: target,
    layerName: layerData?.name || `CAMADA ${target}`,
    color: layerData?.color || '#38BDF8',
    profile: layerData?.profile || 'CUSTOM',
    actionText: `Mudou para ${layerData?.name || 'Camada ' + target}`
  });
}

function dispatchPadEvent(event) {
  // Send to main configurator window
  safeSend(mainWindow, 'pad:event', event);

  const layerIdx = event.layer !== undefined ? event.layer : currentHardwareLayer;
  const layerData = currentConfig?.layers?.[layerIdx] || currentConfig?.layers?.[0];

  // Update tray icon color when layer changes or color specified
  if (event.type === 'layer-change' || event.color) {
    stopSoundpadPlaybackTracking();
    const targetColor = event.color || layerData?.color;
    const targetName = event.layerName || layerData?.name;
    if (targetColor) {
      updateTrayIcon(targetColor, targetName);
    }
    updateDiscordActivity(targetName);
  }

  // Send to HUD window
  if (hudWindow && !hudWindow.isDestroyed() && currentConfig?.hud?.enabled !== false) {
    if (currentConfig?.hud?.mode === 'auto_hide') {
      showHUDTemporarily(event.isPreview ? 3000 : 2500);
    }
    safeSend(hudWindow, 'hud:update', {
      layer: event.layer,
      layerName: layerData?.name || `CAMADA ${event.layer}`,
      layerColor: layerData?.color || '#38BDF8',
      color: layerData?.color || '#38BDF8',
      profile: layerData?.profile || 'PADRÃO',
      action: event.actionText,
      isPreview: !!event.isPreview
    });
  }

  // Forward Soundpad title on preview only (avoids clobbering local Pico OLED display on press)
  if (event.soundTitle && event.isPreview) {
    const titleClean = event.soundTitle.substring(0, 20);
    sendSerialCommand(`OLED:ESPIAR SOM|${titleClean}`);
  }
}

// Auto-scan serial every 3.5s
setInterval(setupSerialListener, 3500);

// =====================================================================
// IPC HANDLERS
// =====================================================================
ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_, config) => saveConfig(config));
ipcMain.handle('pad:set-layer', (_, layer) => {
  switchHardwareLayer(layer);
  return true;
});
ipcMain.handle('pad:sync-encoder', (_, { layer, encoder }) => {
  const l = parseInt(layer) || 0;
  const fn = encoder?.function || 'volume';
  const cw = (encoder?.customCW || '').replace(/[:|\r\n]/g, '-');
  const ccw = (encoder?.customCCW || '').replace(/[:|\r\n]/g, '-');
  const press = (encoder?.customPress || '').replace(/[:|\r\n]/g, '-');
  const stepCW = encoder?.steps?.cw || 1;
  const stepCCW = encoder?.steps?.ccw || 1;
  sendSerialCommand(`SET_ENCODER:${l}:${fn}:${cw}:${ccw}:${press}:${stepCW}:${stepCCW}`);
  return true;
});
ipcMain.handle('pad:sync-customization', (_, data) => {
  if (!currentConfig) currentConfig = loadConfig();
  if (!currentConfig.customization) currentConfig.customization = {};
  if (data?.oled) {
    currentConfig.customization.oled = { ...(currentConfig.customization.oled || {}), ...data.oled };
  }
  if (data?.app) {
    currentConfig.customization.app = { ...(currentConfig.customization.app || {}), ...data.app };
  }
  saveConfig(currentConfig);

  const o = currentConfig.customization.oled || {};
  const sd = o.showDivider !== false ? '1' : '0';
  const si = o.showIcons !== false ? '1' : '0';
  const sdo = o.showLayerDots !== false ? '1' : '0';
  const tout = o.displayTimeout || 1.2;
  const anim = o.showAnimations !== false ? '1' : '0';
  sendSerialCommand(`SET_OLED_CUSTOM:${sd}:${si}:${sdo}:${tout}:${anim}`);
  return true;
});
ipcMain.handle('pad:test-oled-boot', () => {
  logDebug('[OLED TEST] Disparando animacao de boot no hardware');
  sendSerialCommand('OLED:BOOT');
  return { success: true };
});
ipcMain.handle('pad:test-oled-updating', () => {
  logDebug('[OLED TEST] Disparando animacao de atualizacao no hardware');
  sendSerialCommand('OLED:UPDATING');
  return { success: true };
});
ipcMain.handle('pad:force-sync', async () => {
  try {
    const config = currentConfig || loadConfig();
    const soundMap = generateSoundpadSoundsMap();
    const configForPad = {
      ...config,
      soundpad_sounds: soundMap
    };

    let driveSynced = false;
    const padDrives = ['D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\'];
    for (const drv of padDrives) {
      try {
        if (fs.existsSync(path.join(drv, 'code.py'))) {
          sendSerialCommand('OLED:UPDATING');
          const localCodePath = path.join(__dirname, 'scripts', 'code.py');
          if (fs.existsSync(localCodePath)) {
            try {
              const localCode = fs.readFileSync(localCodePath, 'utf8');
              const targetCodePath = path.join(drv, 'code.py');
              const currentPicoCode = fs.existsSync(targetCodePath) ? fs.readFileSync(targetCodePath, 'utf8') : '';
              if (localCode !== currentPicoCode) {
                fs.writeFileSync(targetCodePath, localCode, 'utf8');
                logDebug(`[FIRMWARE FORCED SYNC] scripts/code.py atualizado para ${targetCodePath}`);
                sendSerialCommand('RELOAD_FIRMWARE');
              }
            } catch (errCode) {
              logDebug(`[FIRMWARE FORCED SYNC ERRO] ${errCode.message}`);
            }
          }
          // Sincronizar boot.py, autorun.inf e icon.ico para identidade oficial PadPro
          try {
            const localBoot = path.join(__dirname, 'scripts', 'boot.py');
            if (fs.existsSync(localBoot)) {
              const targetBoot = path.join(drv, 'boot.py');
              if (!fs.existsSync(targetBoot) || fs.readFileSync(localBoot, 'utf8') !== fs.readFileSync(targetBoot, 'utf8')) {
                fs.writeFileSync(targetBoot, fs.readFileSync(localBoot, 'utf8'), 'utf8');
              }
            }
            const localAutorun = path.join(__dirname, 'scripts', 'autorun.inf');
            if (fs.existsSync(localAutorun)) {
              fs.copyFileSync(localAutorun, path.join(drv, 'autorun.inf'));
            }
            const localIcon = path.join(__dirname, 'build', 'icon.ico');
            if (fs.existsSync(localIcon)) {
              fs.copyFileSync(localIcon, path.join(drv, 'icon.ico'));
            }
          } catch {}
          fs.writeFileSync(path.join(drv, 'config.json'), JSON.stringify(configForPad, null, 2), 'utf8');
          logDebug(`[CONFIG FORCED SYNC] Gravado com sucesso em ${drv}config.json`);
          driveSynced = true;
          break;
        }
      } catch (errSync) {
        logDebug(`[CONFIG FORCED SYNC AVISO] ${errSync.message}`);
      }
    }

    if (!driveSynced) {
      sendSerialCommand('OLED:UPDATING');
    }

    // Sincronizar funcoes do encoder de todas as camadas
    if (Array.isArray(config.layers)) {
      config.layers.forEach((l, idx) => {
        const enc = l.encoder || {};
        const fn = enc.function || 'volume';
        const cw = (enc.customCW || '').replace(/[:|\r\n]/g, '-');
        const ccw = (enc.customCCW || '').replace(/[:|\r\n]/g, '-');
        const press = (enc.customPress || '').replace(/[:|\r\n]/g, '-');
        const stepCW = enc.steps?.cw || config.encoder_steps?.[fn]?.cw || 1;
        const stepCCW = enc.steps?.ccw || config.encoder_steps?.[fn]?.ccw || 1;
        sendSerialCommand(`SET_ENCODER:${idx}:${fn}:${cw}:${ccw}:${press}:${stepCW}:${stepCCW}`);
      });
    }

    const o = config.customization?.oled || {};
    const sd = o.showDivider !== false ? '1' : '0';
    const si = o.showIcons !== false ? '1' : '0';
    const sdo = o.showLayerDots !== false ? '1' : '0';
    const tout = o.displayTimeout || 1.2;
    const anim = o.showAnimations !== false ? '1' : '0';
    sendSerialCommand(`SET_OLED_CUSTOM:${sd}:${si}:${sdo}:${tout}:${anim}`);

    if (currentHardwareLayer !== null) {
      sendSerialCommand(`SET_LAYER:${currentHardwareLayer}`);
    }
    sendSerialCommand('CONFIG_UPDATED');

    return { success: true, driveSynced };
  } catch (err) {
    console.error('Erro ao forcar sincronizacao do pad:', err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('serial:export-logs', async (_, logsText) => {
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Logs Seriais',
      defaultPath: `padpro-serial-log-${dateStr}.txt`,
      filters: [{ name: 'Arquivo de Texto (*.txt)', extensions: ['txt'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    fs.writeFileSync(filePath, logsText || '', 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    console.error('Erro ao exportar logs seriais:', err);
    return { success: false, error: err.message };
  }
});
ipcMain.handle('pad:get-serial-status', () => ({
  connected: !!(serialPortInstance && serialPortInstance.isOpen),
  port: serialPortInstance?.path || null
}));
ipcMain.handle('pad:reconnect', async () => {
  await setupSerialListener();
  return {
    connected: !!(serialPortInstance && serialPortInstance.isOpen),
    port: serialPortInstance?.path || null
  };
});
ipcMain.handle('pad:get-logs', () => recentLogs);
ipcMain.handle('config:reset', () => {
  const config = getDefaultConfig();
  saveConfig(config);
  return config;
});

ipcMain.handle('config:export', async (_, configData) => {
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar Backup de Configuração',
      defaultPath: `padpro-config-backup-${dateStr}.json`,
      filters: [{ name: 'Arquivo JSON (*.json)', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    const content = JSON.stringify(configData || loadConfig(), null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, filePath };
  } catch (err) {
    console.error('Erro ao exportar config:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:import', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar Backup de Configuração',
      filters: [{ name: 'Arquivo JSON (*.json)', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths || filePaths.length === 0) return { success: false, canceled: true };
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (!parsed.layers && !parsed.version)) {
      return { success: false, error: 'Arquivo JSON inválido ou incompatível.' };
    }
    saveConfig(parsed);
    return { success: true, config: parsed, filePath: filePaths[0] };
  } catch (err) {
    console.error('Erro ao importar config:', err);
    return { success: false, error: err.message };
  }
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => {
  if (currentConfig?.system?.closeToTray !== false) {
    mainWindow?.hide();
  } else {
    app.isQuitting = true;
    app.quit();
  }
});

// System handlers (URL, App, Command, File Browser)
ipcMain.handle('system:open-url', async (_, urls) => {
  const list = Array.isArray(urls) ? urls : [urls];
  for (let u of list) {
    if (u && typeof u === 'string') {
      let target = u.trim();
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = 'https://' + target;
      }
      shell.openExternal(target).catch(e => logDebug(`[OPEN URL ERRO] ${e.message}`));
    }
  }
  return true;
});

ipcMain.handle('system:browse-executable', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar Aplicativo, Script ou Atalho',
    properties: ['openFile'],
    filters: [
      { name: 'Executáveis e Scripts (*.exe, *.bat, *.cmd, *.ps1, *.py, *.lnk)', extensions: ['exe', 'bat', 'cmd', 'ps1', 'py', 'lnk'] },
      { name: 'Todos os Arquivos (*.*)', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('system:test-open-app', async (_, data) => {
  try {
    const target = (typeof data === 'string' ? data : data?.path || data?.value || '').trim();
    const args = typeof data === 'object' ? (data?.args || '') : '';
    if (!target) return { success: false, error: 'Caminho ou nome do aplicativo não fornecido' };
    launchApp(target, args);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('system:test-run-command', async (_, data) => {
  try {
    const cmd = (typeof data === 'string' ? data : data?.command || data?.value || '').trim();
    const interp = (typeof data === 'object' ? data?.interpreter : 'powershell') || 'powershell';
    if (!cmd) return { success: false, error: 'Comando não fornecido' };
    executeSystemCommand(cmd, interp, 'Teste');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// HUD controls
ipcMain.handle('hud:toggle', (_, enabled) => {
  toggleHUD(enabled);
  return enabled;
});
ipcMain.handle('hud:state', () => currentConfig?.hud?.enabled !== false);
ipcMain.handle('hud:set-mode', (_, mode) => setHUDMode(mode));
ipcMain.handle('hud:get-mode', () => currentConfig?.hud?.mode || 'always');

ipcMain.on('hud:notify', (_, data) => {
  if (hudWindow && !hudWindow.isDestroyed() && currentConfig?.hud?.enabled !== false) {
    if (currentConfig?.hud?.mode === 'auto_hide') {
      showHUDTemporarily(2500);
    }
    safeSend(hudWindow, 'hud:update', data);
  }
  const color = data?.layerColor || data?.color;
  if (color) {
    updateTrayIcon(color, data?.layerName);
  }
});

// Tray color IPC
ipcMain.handle('tray:update-color', (_, data) => {
  const color = typeof data === 'string' ? data : data?.color;
  const name = typeof data === 'object' ? data?.name : null;
  if (color) {
    updateTrayIcon(color, name);
  }
  return true;
});

ipcMain.on('hud:resize', (_, width) => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    const currentBounds = hudWindow.getBounds();
    const newWidth = Math.max(180, Math.min(420, width));
    const targetHeight = 48;

    if (currentConfig?.hud?.customPosition) {
      // User placed the HUD at a custom spot — DO NOT reset x to bottom-right!
      hudWindow.setBounds({
        x: currentBounds.x,
        y: currentBounds.y,
        width: newWidth,
        height: targetHeight
      });
    } else {
      // Default: anchor to bottom-right of primary screen
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenW } = primaryDisplay.workAreaSize;
      const newX = screenW - newWidth - 24;
      hudWindow.setBounds({
        x: newX,
        y: currentBounds.y,
        width: newWidth,
        height: targetHeight
      });
    }
  }
});

ipcMain.handle('hud:reset-position', () => resetHUDPosition());

// System & Login Item
ipcMain.handle('system:set-login-item', (_, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
    if (!currentConfig.system) currentConfig.system = {};
    currentConfig.system.startOnBoot = enabled;
    saveConfig(currentConfig);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('system:get-login-item', () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle('system:set-close-to-tray', (_, enabled) => {
  if (!currentConfig.system) currentConfig.system = {};
  currentConfig.system.closeToTray = enabled;
  saveConfig(currentConfig);
  return true;
});

ipcMain.handle('system:set-start-minimized', (_, enabled) => {
  if (!currentConfig.system) currentConfig.system = {};
  currentConfig.system.startMinimized = enabled;
  saveConfig(currentConfig);
  return true;
});


// Serial port listing
ipcMain.handle('serial:list', async () => {
  try {
    const { SerialPort } = require('serialport');
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      serialNumber: p.serialNumber || ''
    }));
  } catch (e) {
    return [];
  }
});

// Soundpad named pipe check
ipcMain.handle('soundpad:check', async () => {
  const tryPipe = (pipeName) => {
    return new Promise((resolve) => {
      const pipePath = `\\\\.\\pipe\\${pipeName}`;
      const client = net.createConnection(pipePath, () => {
        client.end();
        resolve(true);
      });
      client.on('error', () => resolve(false));
      setTimeout(() => {
        try { client.destroy(); } catch {}
        resolve(false);
      }, 700);
    });
  };

  try {
    // Official Soundpad named pipe
    if (await tryPipe('sp_remote_control')) return true;
    // Alternative / legacy fallback
    if (await tryPipe('sp_pipe')) return true;
    return false;
  } catch {
    return false;
  }
});

// Soundpad sound title lookup & cache
ipcMain.handle('soundpad:get-title-for-shortcut', (_, shortcut) => {
  return getSoundTitleForButton(shortcut);
});

ipcMain.handle('soundpad:get-cache', () => {
  updateSoundpadCache();
  return soundpadSoundMap;
});

ipcMain.handle('soundpad:resolve-keys', (_, shortcutsList) => {
  if (!Array.isArray(shortcutsList)) return {};
  const res = {};
  for (const item of shortcutsList) {
    if (item) {
      const title = getSoundTitleForButton(item);
      if (title) res[item] = title;
    }
  }
  return res;
});

ipcMain.handle('soundpad:refresh', async () => {
  try {
    await triggerSoundpadSave();
    await new Promise(r => setTimeout(r, 120));
    updateSoundpadCache(true);
    safeSend(mainWindow, 'soundpad:updated', soundpadSoundMap);
    return {
      success: true,
      count: Object.keys(soundpadSoundMap).length,
      sounds: soundpadSoundMap
    };
  } catch (err) {
    console.error('Erro no refresh do Soundpad:', err);
    return { success: false, count: 0, sounds: soundpadSoundMap, error: err.message };
  }
});

ipcMain.handle('discord:status', () => {
  return {
    connected: discordConnected,
    user: discordUser,
    clientId: DISCORD_CLIENT_ID,
    voice: discordVoiceSettings
  };
});

ipcMain.handle('discord:get-voice', () => {
  return discordVoiceSettings;
});

ipcMain.handle('discord:toggle-mute', () => {
  if (!discordConnected) return false;
  return sendDiscordCommand('SET_VOICE_SETTINGS', { mute: !discordVoiceSettings.mute });
});

ipcMain.handle('discord:set-mute', (event, muteState) => {
  if (!discordConnected) return false;
  return sendDiscordCommand('SET_VOICE_SETTINGS', { mute: !!muteState });
});

// =====================================================================
// AUTO-UPDATER
// =====================================================================
function setupAutoUpdater() {
  if (!autoUpdater) {
    console.log('[AutoUpdater] electron-updater não carregado');
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'brunogbrl',
      repo: 'pad-pro'
    });
  } catch (err) {
    console.warn('Falha ao definir setFeedURL no autoUpdater:', err?.message);
  }

  // Se estiver instalado e por qualquer motivo o app-update.yml não existir em resources, cria o arquivo
  if (app.isPackaged && process.resourcesPath) {
    try {
      const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
      if (!fs.existsSync(updateConfigPath)) {
        const ymlContent = `owner: brunogbrl\nrepo: pad-pro\nprovider: github\nupdaterCacheDirName: pad-pro-updater\n`;
        fs.writeFileSync(updateConfigPath, ymlContent, 'utf8');
        console.log('Restaurado app-update.yml de fallback em:', updateConfigPath);
      }
    } catch (err) {
      console.warn('Não foi possível gravar app-update.yml de fallback:', err?.message);
    }
  }

  autoUpdater.on('checking-for-update', () => {
    safeSend(mainWindow, 'updater:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    safeSend(mainWindow, 'updater:status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    safeSend(mainWindow, 'updater:status', {
      status: 'not-available',
      version: info.version
    });
  });

  autoUpdater.on('error', (err) => {
    safeSend(mainWindow, 'updater:status', {
      status: 'error',
      message: err == null ? 'Erro na verificação de atualização' : (err.message || String(err))
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    safeSend(mainWindow, 'updater:status', {
      status: 'downloading',
      percent: progressObj.percent,
      bytesPerSecond: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    safeSend(mainWindow, 'updater:status', {
      status: 'downloaded',
      version: info.version
    });
  });

  // Check for updates automatically 4 seconds after startup (only in packaged app and if enabled)
  setTimeout(() => {
    if (app.isPackaged && currentConfig?.system?.autoCheckUpdates !== false) {
      autoUpdater.checkForUpdates().catch(err => {
        console.warn('Auto-updater startup check error:', err?.message);
      });
    }
  }, 4000);
}

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    // Modo de desenvolvimento: consulta informativa via API do GitHub
    try {
      const https = require('https');
      const latestRelease = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.github.com',
          path: '/repos/brunogbrl/pad-pro/releases/latest',
          method: 'GET',
          headers: { 'User-Agent': 'PAD-Pro' }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(new Error('Timeout')); });
        req.end();
      });

      if (latestRelease && latestRelease.tag_name) {
        const latestVer = latestRelease.tag_name.replace(/^v/, '');
        const curVer = app.getVersion();
        const hasUpdate = latestVer !== curVer;
        return {
          success: true,
          isDev: true,
          isUpdateAvailable: hasUpdate,
          updateInfo: { version: latestVer, releaseNotes: latestRelease.body },
          currentVersion: curVer,
          message: hasUpdate ? `Nova versão v${latestVer} disponível no GitHub!` : `Você já está usando a versão mais recente (v${curVer})!`
        };
      }
    } catch {}
    return { success: false, isDev: true, message: 'Verificação em desenvolvimento (requer app instalado para download automático).' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      success: true,
      isUpdateAvailable: Boolean(result?.isUpdateAvailable),
      updateInfo: result?.updateInfo || null,
      currentVersion: app.getVersion()
    };
  } catch (err) {
    console.warn('Erro ao verificar atualizações no autoUpdater:', err?.message);
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('updater:download', async () => {
  if (!autoUpdater) return { success: false, error: 'Auto-updater não carregado' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  if (!autoUpdater) return { success: false, error: 'Auto-updater não carregado' };
  app.isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

ipcMain.handle('updater:get-version', () => {
  return app.getVersion();
});

// =====================================================================
// APP LIFECYCLE
// =====================================================================
app.whenReady().then(() => {
  loadConfig();
  createMainWindow();
  createHUDWindow();
  createTray();
  setupSerialListener();
  startWindowsAudioListener();
  setupSoundpadWatcher();
  connectDiscordRPC();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (currentConfig?.system?.closeToTray !== false) {
    // Keep running in tray
  } else {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (audioListenerProc) {
    try { audioListenerProc.kill(); } catch {}
    audioListenerProc = null;
  }
  if (serialPortInstance && serialPortInstance.isOpen) {
    try { serialPortInstance.close(); } catch {}
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    createHUDWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});
