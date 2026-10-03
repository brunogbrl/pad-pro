// =====================================================================
// i18n — Internationalization Service
// Loads locale files and translates DOM elements with data-i18n
// Uses inline fallback to avoid fetch issues in packaged Electron apps
// =====================================================================

class I18nService {
  constructor() {
    this.locale = 'pt-BR';
    this.translations = {};
    this.fallback = {};
  }

  async init(locale = 'pt-BR') {
    this.locale = locale;

    // Try fetch first, fallback to embedded defaults
    try {
      const res = await fetch(`../locales/${locale}.json`);
      if (res.ok) {
        this.translations = await res.json();
      } else {
        throw new Error(`HTTP ${res.status}`);
      }

      if (locale !== 'pt-BR') {
        const fb = await fetch('../locales/pt-BR.json');
        if (fb.ok) {
          this.fallback = await fb.json();
        }
      } else {
        this.fallback = this.translations;
      }
    } catch (e) {
      console.warn('i18n: fetch failed, using embedded defaults.', e.message);
      // Embedded minimal fallback so the app always works
      this.translations = this._getEmbeddedFallback(locale);
      this.fallback = this._getEmbeddedFallback('pt-BR');
    }

    this.applyToDOM();
  }

  t(key) {
    const parts = key.split('.');
    let val = this.translations;
    for (const p of parts) {
      val = val?.[p];
    }
    if (val !== undefined) return val;

    val = this.fallback;
    for (const p of parts) {
      val = val?.[p];
    }
    return val ?? key;
  }

  applyToDOM() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key);
      if (text && text !== key) {
        el.textContent = text;
      }
    });
  }

  async setLocale(locale) {
    await this.init(locale);
  }

  _getEmbeddedFallback(locale) {
    if (locale === 'en') {
      return {
        sidebar: { keys: 'Keys', macro: 'Macro', encoder: 'Rotary Knob', soundpad: 'Soundpad', settings: 'Settings', about: 'About' },
        keys: { title: 'Key Definition', noSelection: 'Click a key on the pad to configure', combination: 'Combination', media: 'Media', mouse: 'Mouse', confirm: 'Confirm', reset: 'Reset', fixed: 'Pin Key', dualFunction: 'Dual Function', record: 'Record Shortcut', recording: 'Press the desired keys...', recordCancel: 'Cancel', clickAction: 'Quick Click', holdAction: 'Long Press' },
        encoder: { title: 'Rotary Knob Configuration', function: 'Function', volume: 'System Volume', brightness: 'Screen Brightness', scroll: 'Scroll', mediaNav: 'Media Navigation', custom: 'Custom' },
        soundpad: { title: 'Soundpad Integration', connected: 'Connected', disconnected: 'Disconnected', previewOnHold: 'Preview on key hold' },
        settings: { title: 'Settings', language: 'Language', connection: 'Connection', serialPort: 'Serial Port', refresh: 'Refresh', noDevice: 'No device found', connected: 'Connected', disconnected: 'Disconnected', general: 'General', resetAll: 'Reset to Defaults', resetConfirm: 'Are you sure? All settings will be lost.' },
        about: { title: 'About', description: 'Visual configurator for the PAD Pro macro pad', hardware: 'Hardware', firmware: 'Firmware', picoRP2040: 'PAD Pro (RP2040)' },
        common: { save: 'Save', cancel: 'Cancel', apply: 'Apply' }
      };
    }
    // pt-BR default
    return {
      sidebar: { keys: 'Teclas', macro: 'Macro', encoder: 'Botão Giratório', soundpad: 'Soundpad', settings: 'Configurações', about: 'Sobre' },
      keys: { title: 'Definição de Tecla', noSelection: 'Clique em uma tecla no pad para configurar', combination: 'Combinação', media: 'Mídia', mouse: 'Mouse', confirm: 'Confirmar', reset: 'Resetar', fixed: 'Fixar Tecla', dualFunction: 'Dupla Função', record: 'Gravar Atalho', recording: 'Pressione as teclas desejadas...', recordCancel: 'Cancelar', clickAction: 'Clique Rápido', holdAction: 'Clique Longo' },
      encoder: { title: 'Configuração do Botão Giratório (Knob)', function: 'Função', volume: 'Volume do Sistema', brightness: 'Brilho da Tela', scroll: 'Scroll', mediaNav: 'Navegação de Mídia', custom: 'Personalizado' },
      soundpad: { title: 'Integração Soundpad', connected: 'Conectado', disconnected: 'Desconectado', previewOnHold: 'Preview ao segurar tecla' },
      settings: { title: 'Configurações', language: 'Idioma', connection: 'Conexão', serialPort: 'Porta Serial', refresh: 'Atualizar', noDevice: 'Nenhum dispositivo encontrado', connected: 'Conectado', disconnected: 'Desconectado', general: 'Geral', resetAll: 'Restaurar Padrões', resetConfirm: 'Tem certeza? Todas as configurações serão perdidas.' },
      about: { title: 'Sobre', description: 'Configurador visual para o macro pad PAD Pro', hardware: 'Hardware', firmware: 'Firmware', picoRP2040: 'PAD Pro (RP2040)' },
      common: { save: 'Salvar', cancel: 'Cancelar', apply: 'Aplicar' }
    };
  }
}

window.i18n = new I18nService();
