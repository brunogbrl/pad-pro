// =====================================================================
// ConfigStore — Configuration persistence service
// Manages loading, saving, and modifying the pad configuration
// =====================================================================

class ConfigStore {
  constructor() {
    this.config = null;
    this.listeners = [];
  }

  async init() {
    if (window.api) {
      this.config = await window.api.loadConfig();
    } else {
      const saved = localStorage.getItem('padpro-config') || localStorage.getItem('sharkropad-config');
      this.config = saved ? JSON.parse(saved) : this._getDefaultConfig();
    }

    // Ensure layers array and modern schema
    if (!this.config.layers || !Array.isArray(this.config.layers)) {
      this.config.layers = this._getDefaultConfig().layers;
    }
    if (!this.config.macros || !Array.isArray(this.config.macros)) {
      this.config.macros = [];
    }
    if (!this.config.hud) {
      this.config.hud = { enabled: true };
    }
    if (!this.config.system) {
      this.config.system = { startOnBoot: false, startMinimized: false, closeToTray: true, developerMode: false, autoCheckUpdates: true, notifyUpdates: true };
    } else {
      if (this.config.system.developerMode === undefined) this.config.system.developerMode = false;
      if (this.config.system.autoCheckUpdates === undefined) this.config.system.autoCheckUpdates = true;
      if (this.config.system.notifyUpdates === undefined) this.config.system.notifyUpdates = true;
    }

    this._notify();
  }

  getMacros() {
    if (!this.config) return [];
    if (!Array.isArray(this.config.macros)) {
      this.config.macros = [];
    }
    return this.config.macros;
  }

  saveMacro(macro) {
    if (!this.config) return null;
    if (!Array.isArray(this.config.macros)) {
      this.config.macros = [];
    }
    const idx = this.config.macros.findIndex(m => m.id === macro.id);
    if (idx >= 0) {
      this.config.macros[idx] = { ...this.config.macros[idx], ...macro, updatedAt: Date.now() };
    } else {
      if (!macro.id) macro.id = 'macro_' + Date.now();
      macro.createdAt = Date.now();
      this.config.macros.push(macro);
    }
    this._notify();
    return macro;
  }

  deleteMacro(macroId) {
    if (!this.config || !Array.isArray(this.config.macros)) return false;
    const initialLen = this.config.macros.length;
    this.config.macros = this.config.macros.filter(m => m.id !== macroId);
    if (this.config.macros.length !== initialLen) {
      this._notify();
      return true;
    }
    return false;
  }

  importConfig(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') return false;
    this.config = {
      ...this._getDefaultConfig(),
      ...newConfig
    };
    if (!Array.isArray(this.config.layers) || this.config.layers.length === 0) {
      this.config.layers = this._getDefaultConfig().layers;
    }
    if (!Array.isArray(this.config.macros)) {
      this.config.macros = [];
    }
    this._notify();
    return true;
  }

  getConfig() {
    return this.config;
  }

  getLayer(index) {
    return this.config?.layers?.[index] || null;
  }

  getKey(layerIndex, keyIndex) {
    const layer = this.getLayer(layerIndex);
    return layer?.keys?.[keyIndex] || null;
  }

  setKey(layerIndex, keyIndex, keyData) {
    if (this.config?.layers?.[layerIndex]) {
      if (!this.config.layers[layerIndex].keys) {
        this.config.layers[layerIndex].keys = {};
      }
      this.config.layers[layerIndex].keys[keyIndex] = keyData;
      this._notify();
    }
  }

  addLayer(layerData = null) {
    if (!this.config) return null;
    const newIndex = this.config.layers.length;
    const defaultColors = ['#38BDF8', '#F87171', '#FB923C', '#4ADE80', '#A78BFA', '#F472B6', '#FBBF24', '#2DD4BF', '#6366F1', '#EC4899'];
    const color = defaultColors[newIndex % defaultColors.length];

    const newLayer = layerData || {
      name: `CAMADA ${newIndex}`,
      profile: 'CUSTOM',
      color: color,
      encoder: { function: 'layer_nav' },
      keys: this.getDefaultKeysForLayer(newIndex, false)
    };

    this.config.layers.push(newLayer);
    this._notify();
    return newIndex;
  }

  removeLayer(index) {
    if (!this.config || this.config.layers.length <= 1) return false;
    this.config.layers.splice(index, 1);
    this._notify();
    return true;
  }

  setLayerColor(index, color) {
    if (this.config?.layers?.[index]) {
      this.config.layers[index].color = color;
      this._notify();
    }
  }

  setLayerName(index, name) {
    if (this.config?.layers?.[index]) {
      this.config.layers[index].name = name;
      this._notify();
    }
  }

  getLayerEncoder(layerIndex) {
    const layer = this.getLayer(layerIndex);
    return layer?.encoder || this.config?.encoder || { function: 'volume' };
  }

  setLayerEncoder(layerIndex, encoderData) {
    if (this.config?.layers?.[layerIndex]) {
      this.config.layers[layerIndex].encoder = {
        ...(this.config.layers[layerIndex].encoder || {}),
        ...encoderData
      };
      this._notify();
    }
  }

  setEncoder(encoderData) {
    if (this.config) {
      this.config.encoder = { ...this.config.encoder, ...encoderData };
      this._notify();
    }
  }

  setLanguage(lang) {
    if (this.config) {
      this.config.language = lang;
      this._notify();
    }
  }

  setSoundpad(data) {
    if (this.config) {
      this.config.soundpad = { ...this.config.soundpad, ...data };
      this._notify();
    }
  }

  setHUD(data) {
    if (this.config) {
      this.config.hud = { ...this.config.hud, ...data };
      this._notify();
    }
  }

  setSystem(data) {
    if (this.config) {
      this.config.system = { ...this.config.system, ...data };
      this._notify();
    }
  }

  async save() {
    if (window.api) {
      return await window.api.saveConfig(this.config);
    }
    localStorage.setItem('padpro-config', JSON.stringify(this.config));
    return true;
  }

  async reset() {
    if (window.api) {
      this.config = await window.api.resetConfig();
    } else {
      this.config = this._getDefaultConfig();
      localStorage.removeItem('padpro-config');
      localStorage.removeItem('sharkropad-config');
    }
    this._notify();
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  _notify() {
    this.listeners.forEach(fn => fn(this.config));
  }

  getCustomization() {
    if (!this.config) return {};
    if (!this.config.customization) {
      this.config.customization = {
        oled: { showDivider: true, showIcons: true, showLayerDots: true, displayTimeout: 1.2 },
        app: { neonGlow: true, keyMarquee: true, hardwareFeedback: true, animations: true }
      };
    }
    return this.config.customization;
  }

  setCustomization(data) {
    if (!this.config) return;
    if (!this.config.customization) this.config.customization = {};
    if (data.oled) {
      this.config.customization.oled = { ...(this.config.customization.oled || {}), ...data.oled };
    }
    if (data.app) {
      this.config.customization.app = { ...(this.config.customization.app || {}), ...data.app };
    }
    this._notify();
  }

  getDefaultKeysForLayer(layerIndex, isBlank = false) {
    // Teclas fixas da direita (B3, B7, B11) permanecem sempre padronizadas de fábrica
    const fixedKeys = {
      3: { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' },
      7: { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' },
      11: { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' }
    };

    const keys = {};
    const configurableIndices = [0, 1, 2, 4, 5, 6, 8, 9, 10];

    if (isBlank) {
      configurableIndices.forEach(idx => {
        keys[idx] = { type: 'key', value: '', holdAction: null, fixed: false, label: '' };
      });
      return { ...keys, ...fixedKeys };
    }

    // Camadas padrão predefinidas de fábrica (0 a 3)
    const def = this._getDefaultConfig();
    if (layerIndex < 4 && def.layers?.[layerIndex]?.keys) {
      return JSON.parse(JSON.stringify(def.layers[layerIndex].keys));
    }

    // Camadas 4 em diante: gerador sequencial inteligente com modificadores
    const modifierSchemes = [
      ['Alt', 'Shift'],
      ['Ctrl', 'Alt'],
      ['Ctrl', 'Alt', 'Shift'],
      ['Shift'],
      ['Ctrl', 'Win'],
      ['Alt', 'Win']
    ];

    const schemeIdx = (layerIndex - 4) % modifierSchemes.length;
    const mods = modifierSchemes[schemeIdx];
    const fKeys = ['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21'];

    configurableIndices.forEach((keyIdx, i) => {
      const fKey = fKeys[i % fKeys.length];
      if (mods && mods.length > 0) {
        keys[keyIdx] = {
          type: 'combo',
          value: [...mods, fKey],
          holdAction: null,
          fixed: false,
          label: ''
        };
      } else {
        keys[keyIdx] = {
          type: 'key',
          value: fKey,
          holdAction: null,
          fixed: false,
          label: ''
        };
      }
    });

    return { ...keys, ...fixedKeys };
  }

  getDefaultKey(layerIndex, keyIndex) {
    const keys = this.getDefaultKeysForLayer(layerIndex, false);
    if (keys && keys[keyIndex]) {
      return JSON.parse(JSON.stringify(keys[keyIndex]));
    }
    // Fallback de seguranca para as teclas da coluna fixa
    if (keyIndex === 3) return { type: 'fixed', value: 'layer-switch', holdAction: null, fixed: true, label: 'Camada' };
    if (keyIndex === 7) return { type: 'media', value: 'play_pause', holdAction: null, fixed: true, label: 'Play' };
    if (keyIndex === 11) return { type: 'combo', value: ['Ctrl', 'Shift', 'F14'], holdAction: null, fixed: true, label: 'Mute' };
    return { type: 'key', value: '', holdAction: null, fixed: false, label: '' };
  }

  _getDefaultConfig() {
    return {
      version: '2.0',
      language: 'pt-BR',
      hud: { enabled: true },
      system: { startOnBoot: false, startMinimized: false, closeToTray: true, developerMode: false, autoCheckUpdates: true, notifyUpdates: true },
      soundpad: { enabled: true, previewOnHold: true, holdDelay: 380 },
      encoder: { function: 'volume', customCW: null, customCCW: null, customPress: null },
      customization: {
        oled: { showDivider: true, showIcons: true, showLayerDots: true, displayTimeout: 1.2 },
        app: { neonGlow: true, keyMarquee: true, hardwareFeedback: true, animations: true }
      },
      macros: [],
      layers: [
        {
          name: 'CAMADA 0', profile: 'DIRETAS', color: '#38BDF8',
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
          name: 'CAMADA 1', profile: 'COMBO ALT', color: '#F87171',
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
          name: 'CAMADA 2', profile: 'COMBO CTRL', color: '#FB923C',
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
          name: 'CAMADA 3', profile: 'CTRL + SHIFT', color: '#4ADE80',
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
}

// Global singleton
window.configStore = new ConfigStore();
