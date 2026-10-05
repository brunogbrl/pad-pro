import time
import sys
import json
import gc
import board
import digitalio
import usb_hid
import busio
import displayio
import terminalio
from adafruit_display_text import label
import adafruit_displayio_ssd1306
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode
from adafruit_hid.consumer_control import ConsumerControl
from adafruit_hid.consumer_control_code import ConsumerControlCode
from adafruit_hid.mouse import Mouse

import pad_assets
from pad_encoder import EncoderRotativoBuxton
import pad_actions

try:
    import i2cdisplaybus
    I2CDisplayBus = i2cdisplaybus.I2CDisplayBus
except (ImportError, AttributeError):
    I2CDisplayBus = displayio.I2CDisplay

try:
    import supervisor
    TEM_SUPERVISOR = True
    try:
        supervisor.runtime.autoreload = False
    except Exception:
        pass
except ImportError:
    TEM_SUPERVISOR = False

# =====================================================================
# 1. OLED DISPLAY SSD1306 128x32
# =====================================================================
TEM_OLED = False
display = None
txt_linha1 = None
txt_linha2 = None
linha_div = None
dot_grids = []
bmp_dot_on = None
bmp_dot_off = None
tempo_reset_oled = 0.0

paleta_oled = displayio.Palette(2)
paleta_oled[0] = 0x000000
paleta_oled[1] = 0xFFFFFF

_assets = pad_assets.carregar_todos_assets()
bmp_boot_logo = _assets['boot_logo']
bmp_updating_text = _assets['updating_text']
BMP_GEAR_ANIM = _assets['gear_anim']
BMP_CACHE = _assets['icons']
BMP_ANIM_SPEAKER = _assets['speaker_anim']
BMP_CHECK = _assets['check']
del _assets
gc.collect()

bmp_vazio = displayio.Bitmap(10, 10, 2)
icone_grid = None
grupo_normal = None
grupo_boot = None
grupo_atualizando = None
em_animacao_especial = False
bmp_barra_progresso = None
tile_barra_progresso = None
tile_boot_logo = None
tile_gear = None
tile_updating_text = None

nivel_volume = 50
nivel_brilho = 70
nivel_zoom = 100
nivel_scroll = 50
vol_mudo = False

try:
    displayio.release_displays()
    time.sleep(0.06)
    i2c = busio.I2C(scl=board.GP15, sda=board.GP14, frequency=400000)
    bus = I2CDisplayBus(i2c, device_address=0x3C)
    display = adafruit_displayio_ssd1306.SSD1306(bus, width=128, height=32)

    grupo_normal = displayio.Group()

    bmp_linha = displayio.Bitmap(128, 1, 2)
    for x in range(128):
        bmp_linha[x, 0] = 1 if (x % 2 == 0) else 0
    linha_div = displayio.TileGrid(bmp_linha, pixel_shader=paleta_oled, x=0, y=14)
    grupo_normal.append(linha_div)

    icone_grid = displayio.TileGrid(bmp_vazio, pixel_shader=paleta_oled, x=2, y=18)
    grupo_normal.append(icone_grid)

    # Barra Windows 11 Slider (108x7 em x=16, y=20)
    bmp_barra_progresso = displayio.Bitmap(108, 7, 2)
    tile_barra_progresso = displayio.TileGrid(bmp_barra_progresso, pixel_shader=paleta_oled, x=16, y=20)
    tile_barra_progresso.hidden = True
    grupo_normal.append(tile_barra_progresso)

    bmp_dot_on = displayio.Bitmap(4, 4, 2)
    for bx in range(4):
        for by in range(4):
            bmp_dot_on[bx, by] = 1

    bmp_dot_off = displayio.Bitmap(4, 4, 2)
    for bx in range(4):
        bmp_dot_off[bx, 0] = 1
        bmp_dot_off[bx, 3] = 1
    for by in range(4):
        bmp_dot_off[0, by] = 1
        bmp_dot_off[3, by] = 1

    dot_grids = []
    for di in range(6):
        dg = displayio.TileGrid(bmp_dot_off, pixel_shader=paleta_oled, x=128, y=4)
        dg.hidden = True
        grupo_normal.append(dg)
        dot_grids.append(dg)

    txt_linha1 = label.Label(terminalio.FONT, text="", color=0xFFFFFF, x=2, y=6)
    grupo_normal.append(txt_linha1)

    txt_linha2 = label.Label(terminalio.FONT, text="", color=0xFFFFFF, x=16, y=24)
    grupo_normal.append(txt_linha2)

    grupo_boot = displayio.Group()
    tile_boot_logo = displayio.TileGrid(bmp_boot_logo, pixel_shader=paleta_oled, x=0, y=0)
    grupo_boot.append(tile_boot_logo)

    grupo_atualizando = displayio.Group()
    tile_gear = displayio.TileGrid(BMP_GEAR_ANIM[0], pixel_shader=paleta_oled, x=7, y=4)
    grupo_atualizando.append(tile_gear)
    tile_updating_text = displayio.TileGrid(bmp_updating_text, pixel_shader=paleta_oled, x=36, y=12)
    grupo_atualizando.append(tile_updating_text)

    display.root_group = grupo_normal
    TEM_OLED = True
    print("[OLED] Display SSD1306 128x32 ativo!")
except Exception as e:
    print(f"[OLED ERRO] {e}")

def atualizar_icone_oled(fn):
    global icone_grid
    if not TEM_OLED or not icone_grid:
        return
    try:
        bmp = BMP_CACHE.get(fn, BMP_CACHE.get('custom'))
        if bmp and icone_grid.bitmap != bmp:
            icone_grid.bitmap = bmp
    except Exception:
        pass

def obter_nome_funcao_amigavel(fn):
    mapa = {
        'volume': 'VOL & MUTE',
        'brightness': 'BRILHO TELA',
        'zoom': 'ZOOM ESCALA',
        'media': 'PLAYER MIDIA',
        'scroll': 'ROLAGEM MOUSE',
        'video': 'NAVEGACAO VIDEO',
        'layer_nav': 'MUDAR CAMADA',
        'custom': 'CUSTOM ATALHOS'
    }
    return mapa.get(fn, str(fn).upper())

def atualizar_oled_padrao(camada_idx):
    global anim_som_ativa
    if not TEM_OLED or em_animacao_especial:
        return
    try:
        anim_som_ativa = False
        if display.root_group != grupo_normal:
            display.root_group = grupo_normal

        nome, perfil, fn, _, _, _ = obter_info_camada(camada_idx)
        fn_label = obter_nome_funcao_amigavel(fn)

        if tile_barra_progresso:
            tile_barra_progresso.hidden = True

        cust = config_ativa.get("customization", {}) if config_ativa else {}
        oled_cfg = cust.get("oled", {})
        show_divider = oled_cfg.get("showDivider", True)
        show_icons = oled_cfg.get("showIcons", True)
        show_dots = oled_cfg.get("showLayerDots", True)

        if linha_div:
            linha_div.hidden = not show_divider

        total_c = len(config_ativa.get("layers", [])) if config_ativa else 4
        total_c = max(1, min(total_c, 6))
        if show_dots and dot_grids:
            start_x = 128 - (total_c * 7) - 2
            for i in range(len(dot_grids)):
                if i < total_c:
                    dot_grids[i].bitmap = bmp_dot_on if i == camada_idx else bmp_dot_off
                    dot_grids[i].x = start_x + (i * 7)
                    dot_grids[i].hidden = False
                else:
                    dot_grids[i].hidden = True
            t1 = f"{nome}"[:11]
        else:
            if dot_grids:
                for dg in dot_grids:
                    dg.hidden = True
            t1 = f"{nome}"[:18]

        t2 = fn_label[:18]

        if txt_linha1.text != t1:
            txt_linha1.text = t1
            txt_linha1.x = 2
        if txt_linha2.text != t2:
            txt_linha2.text = t2

        if show_icons:
            txt_linha2.x = 16
            atualizar_icone_oled(fn)
            if icone_grid:
                icone_grid.hidden = False
        else:
            if icone_grid:
                icone_grid.bitmap = bmp_vazio
                icone_grid.hidden = True
            txt_linha2.x = 2
    except Exception as e:
        print(f"[OLED ERRO PADRAO] {e}")

def mostrar_acao_oled(linha1, linha2, duracao=1.1, icone=None):
    global tempo_reset_oled, anim_som_ativa
    if not TEM_OLED or em_animacao_especial:
        return
    try:
        anim_som_ativa = False
        if display.root_group != grupo_normal:
            display.root_group = grupo_normal

        if tile_barra_progresso:
            tile_barra_progresso.hidden = True

        cust = config_ativa.get("customization", {}) if config_ativa else {}
        if linha_div:
            linha_div.hidden = not cust.get("oled", {}).get("showDivider", True)

        t1 = str(linha1)[:21] if linha1 is not None else ""
        t2 = str(linha2)[:21] if linha2 is not None else ""
        if txt_linha1.text != t1:
            txt_linha1.text = t1
            txt_linha1.x = 2
        if txt_linha2.text != t2:
            txt_linha2.text = t2

        if dot_grids:
            for dg in dot_grids:
                dg.hidden = True

        if icone:
            atualizar_icone_oled(icone)
            if icone_grid:
                icone_grid.hidden = False
            txt_linha2.x = 16
        else:
            if icone_grid:
                icone_grid.bitmap = bmp_vazio
                icone_grid.hidden = True
            txt_linha2.x = 2

        if duracao is not None and duracao <= 0:
            tempo_reset_oled = 0.0
        else:
            dur = duracao
            if config_ativa and "customization" in config_ativa:
                try:
                    dur = float(config_ativa["customization"].get("oled", {}).get("displayTimeout", duracao) or duracao)
                except Exception:
                    dur = duracao
            tempo_reset_oled = time.monotonic() + dur
    except Exception:
        pass

def atualizar_bmp_barra(pct):
    if not bmp_barra_progresso:
        return
    pct_val = max(0, min(100, int(pct)))
    for bx in range(108):
        is_tb = 1 if (1 <= bx <= 106) else 0
        bmp_barra_progresso[bx, 0] = is_tb
        bmp_barra_progresso[bx, 6] = is_tb

    for by in range(7):
        is_lat = 1 if (1 <= by <= 5) else 0
        bmp_barra_progresso[0, by] = is_lat
        bmp_barra_progresso[107, by] = is_lat

    px_cheios = int(round((pct_val / 100.0) * 106))
    for bx in range(1, 107):
        is_cheio = 1 if bx <= px_cheios else 0
        for by in range(1, 6):
            if is_cheio:
                bmp_barra_progresso[bx, by] = 1
            else:
                bmp_barra_progresso[bx, by] = 1 if by == 3 else 0

def mostrar_barra_oled(titulo, valor_str, pct, icone=None, duracao=1.2):
    global tempo_reset_oled, anim_som_ativa
    if not TEM_OLED or em_animacao_especial:
        return
    try:
        anim_som_ativa = False
        if display.root_group != grupo_normal:
            display.root_group = grupo_normal

        t_clean = str(titulo).strip()[:14]
        v_clean = str(valor_str).strip()[:7]
        espacos = max(1, 21 - len(t_clean) - len(v_clean))
        txt_l1 = (t_clean + (" " * espacos) + v_clean)[:21]
        if txt_linha1.text != txt_l1:
            txt_linha1.text = txt_l1
        txt_linha1.x = 2
        txt_linha2.text = ""

        if icone:
            atualizar_icone_oled(icone)
            if icone_grid:
                icone_grid.hidden = False
        else:
            if icone_grid:
                icone_grid.bitmap = bmp_vazio
                icone_grid.hidden = True

        atualizar_bmp_barra(pct)
        if tile_barra_progresso:
            tile_barra_progresso.hidden = False
        if linha_div:
            linha_div.hidden = True
        if dot_grids:
            for dg in dot_grids:
                dg.hidden = True

        dur = duracao
        if config_ativa and "customization" in config_ativa:
            try:
                dur = float(config_ativa["customization"].get("oled", {}).get("displayTimeout", duracao) or duracao)
            except Exception:
                dur = duracao
        tempo_reset_oled = time.monotonic() + max(0.6, dur)
    except Exception as e:
        print(f"[OLED BARRA ERRO] {e}")

anim_som_ativa = False
anim_som_frame = 0
anim_som_ultimo_tempo = 0.0

def verificar_animacoes_habilitadas():
    if not config_ativa:
        return True
    return config_ativa.get("customization", {}).get("oled", {}).get("showAnimations", True) is not False

def iniciar_animacao_som(titulo, duracao=2.5):
    global anim_som_ativa, anim_som_frame, anim_som_ultimo_tempo, tempo_reset_oled
    if not TEM_OLED or em_animacao_especial:
        return
    if display.root_group != grupo_normal:
        display.root_group = grupo_normal
    anim_som_ativa = True
    anim_som_frame = 0
    anim_som_ultimo_tempo = time.monotonic()

    t1 = "TOCANDO SOM"
    t2 = str(titulo)[:18] if titulo else "SOUNDPAD"
    if txt_linha1.text != t1:
        txt_linha1.text = t1
    txt_linha1.x = 2
    if txt_linha2.text != t2:
        txt_linha2.text = t2
    txt_linha2.x = 16

    if tile_barra_progresso:
        tile_barra_progresso.hidden = True
    if icone_grid:
        icone_grid.bitmap = BMP_ANIM_SPEAKER[0]
        icone_grid.hidden = False
    if dot_grids:
        for dg in dot_grids:
            dg.hidden = True
    if linha_div:
        linha_div.hidden = True

    if duracao and duracao > 0:
        tempo_reset_oled = time.monotonic() + duracao
    else:
        tempo_reset_oled = 0.0

def parar_animacao_som():
    global anim_som_ativa, tempo_reset_oled
    anim_som_ativa = False
    tempo_reset_oled = 0.0
    if icone_grid:
        icone_grid.bitmap = bmp_vazio
        icone_grid.hidden = True
    atualizar_oled_padrao(camada_atual)

def animar_troca_camada(nova_camada, direcao=1):
    global camada_atual, anim_som_ativa
    anim_som_ativa = False
    camada_atual = nova_camada
    if not TEM_OLED:
        return
    try:
        atualizar_oled_padrao(camada_atual)
    except Exception as e:
        print(f"[TRANSICAO ERRO] {e}")

def animar_engrenagem_atualizando(passos=20):
    global anim_som_ativa, em_animacao_especial
    anim_som_ativa = False
    if not TEM_OLED or not grupo_atualizando:
        return
    try:
        if not verificar_animacoes_habilitadas():
            display.root_group = grupo_normal
            atualizar_oled_padrao(camada_atual)
            return

        em_animacao_especial = True
        display.root_group = grupo_atualizando
        num_frames = len(BMP_GEAR_ANIM)
        for i in range(passos):
            tile_gear.bitmap = BMP_GEAR_ANIM[i % num_frames]
            time.sleep(0.04)

        display.root_group = grupo_normal
        em_animacao_especial = False
        atualizar_oled_padrao(camada_atual)
    except Exception as e:
        print(f"[ENGRENAGEM ERRO] {e}")
        em_animacao_especial = False
        display.root_group = grupo_normal

def executar_animacao_boot(duracao=2.2):
    global em_animacao_especial
    if not TEM_OLED or not grupo_boot:
        return
    try:
        em_animacao_especial = True
        display.root_group = grupo_boot
        time.sleep(duracao)
        display.root_group = grupo_normal
        em_animacao_especial = False
    except Exception as e:
        print(f"[BOOT ERRO] {e}")
        em_animacao_especial = False
        display.root_group = grupo_normal

# =====================================================================
# 2. CONFIGURAÇÃO & MAPEAMENTO
# =====================================================================
config_ativa = None
soundpad_mapa = {}
camada_atual = 0

def carregar_config():
    global config_ativa, soundpad_mapa
    try:
        with open("config.json", "r") as f:
            config_ativa = json.load(f)
        soundpad_mapa = config_ativa.get("soundpad_sounds", {})
        print(f"[CONFIG] config.json carregado! {len(soundpad_mapa)} sons mapeados.")
    except Exception as e:
        print(f"[CONFIG AVISO] Sem config.json ({e}), usando padroes.")
        config_ativa = {}
        soundpad_mapa = {}

carregar_config()

def obter_info_camada(camada_idx):
    if config_ativa and "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
        lay = config_ativa["layers"][camada_idx]
        nome = lay.get("name", f"CAMADA {camada_idx}")
        perfil = lay.get("profile", "PADRAO")
        enc = lay.get("encoder", {})
        fn = enc.get("function", "volume")
        custom_cw = enc.get("customCW")
        custom_ccw = enc.get("customCCW")
        custom_press = enc.get("customPress")
        return nome, perfil, fn, custom_cw, custom_ccw, custom_press
    return f"CAMADA {camada_idx}", "PADRAO", "volume", None, None, None

def obter_passos_funcao(fn, camada_idx):
    step_cw = 1
    step_ccw = 1
    if config_ativa:
        enc_steps = config_ativa.get("encoder_steps", {}).get(fn, {})
        if enc_steps:
            step_cw = enc_steps.get("cw", 1)
            step_ccw = enc_steps.get("ccw", 1)
        if "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
            lay_enc = config_ativa["layers"][camada_idx].get("encoder", {})
            if lay_enc.get("function") == fn and "steps" in lay_enc:
                step_cw = lay_enc["steps"].get("cw", step_cw)
                step_ccw = lay_enc["steps"].get("ccw", step_ccw)
    return max(1, step_cw), max(1, step_ccw)

def obter_titulo_som(nome_tecla):
    if not nome_tecla or not soundpad_mapa:
        return None
    if nome_tecla in soundpad_mapa:
        return soundpad_mapa[nome_tecla]
    partes = [p.strip() for p in str(nome_tecla).split("+")]
    padrao = " + ".join(partes)
    return soundpad_mapa.get(padrao)

# =====================================================================
# 3. ROTARY ENCODER HARDWARE
# =====================================================================
TEM_ENCODER = False
encoder = None
botao_encoder = None
estado_anterior_sw = False

try:
    encoder = EncoderRotativoBuxton(board.GP13, board.GP11, invertido=False)
    botao_encoder = digitalio.DigitalInOut(board.GP12)
    botao_encoder.direction = digitalio.Direction.INPUT
    botao_encoder.pull = digitalio.Pull.UP
    estado_anterior_sw = not botao_encoder.value
    TEM_ENCODER = True
    print("[ENCODER] Rotary Encoder Buxton Anti-Bounce pronto!")
except Exception as e:
    print(f"[ENCODER ERRO] Falha no encoder: {e}")

# =====================================================================
# 4. USB HID & TECLAS
# =====================================================================
teclado = Keyboard(usb_hid.devices)
consumer_ctrl = ConsumerControl(usb_hid.devices)
mouse = Mouse(usb_hid.devices)

teclado_layout = None
try:
    from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS
    teclado_layout = KeyboardLayoutUS(teclado)
except Exception as err_lay:
    print(f"[LAYOUT AVISO] {err_lay}")

pad_actions.init(teclado, teclado_layout, consumer_ctrl, mouse, mostrar_acao_oled, animar_troca_camada, lambda: config_ativa, lambda: camada_atual, TEM_SUPERVISOR)

abrir_url_hid = pad_actions.abrir_url_hid
abrir_app_hid = pad_actions.abrir_app_hid
executar_comando_hid = pad_actions.executar_comando_hid
executar_macro = pad_actions.executar_macro
executar_acao_generica = pad_actions.executar_acao_generica
executar_atalho_string = pad_actions.executar_atalho_string

PINOS_LINHAS = (board.GP2, board.GP3, board.GP4)
PINOS_COLUNAS = (board.GP5, board.GP6, board.GP7, board.GP8)

class MatrizTeclado:
    def __init__(self, pinos_linhas, pinos_colunas):
        self.linhas = []
        for pin in pinos_linhas:
            r = digitalio.DigitalInOut(pin)
            r.direction = digitalio.Direction.OUTPUT
            r.value = True
            self.linhas.append(r)

        self.colunas = []
        for pin in pinos_colunas:
            c = digitalio.DigitalInOut(pin)
            c.direction = digitalio.Direction.INPUT
            c.pull = digitalio.Pull.UP
            self.colunas.append(c)

        self.estados_anteriores = [False] * 12

    def ler_eventos(self):
        eventos = []
        idx = 0
        for r_idx, r in enumerate(self.linhas):
            r.value = False
            time.sleep(0.00003)
            for c_idx, c in enumerate(self.colunas):
                pressionado = not c.value
                if pressionado != self.estados_anteriores[idx]:
                    self.estados_anteriores[idx] = pressionado
                    eventos.append((idx, pressionado))
                idx += 1
            r.value = True
        return eventos

matriz = MatrizTeclado(PINOS_LINHAS, PINOS_COLUNAS)

BOTAO_PLAY_PAUSE = Keycode.F13
BOTAO_MUTE_DISCORD = (Keycode.CONTROL, Keycode.SHIFT, Keycode.F14)

mapas = [
    [Keycode.F15, Keycode.F16, Keycode.F17, "BOTAO_CAMADA",
     Keycode.F18, Keycode.F19, Keycode.F20, BOTAO_PLAY_PAUSE,
     Keycode.F21, Keycode.F22, Keycode.F23, BOTAO_MUTE_DISCORD],

    [Keycode.F24, (Keycode.ALT, Keycode.F13), (Keycode.ALT, Keycode.F14), "BOTAO_CAMADA",
     (Keycode.ALT, Keycode.F15), (Keycode.ALT, Keycode.F16), (Keycode.ALT, Keycode.F17), BOTAO_PLAY_PAUSE,
     (Keycode.ALT, Keycode.F18), (Keycode.ALT, Keycode.F19), (Keycode.ALT, Keycode.F20), BOTAO_MUTE_DISCORD],

    [(Keycode.ALT, Keycode.F21), (Keycode.ALT, Keycode.F22), (Keycode.ALT, Keycode.F23), "BOTAO_CAMADA",
     (Keycode.ALT, Keycode.F24), (Keycode.CONTROL, Keycode.F13), (Keycode.CONTROL, Keycode.F14), BOTAO_PLAY_PAUSE,
     (Keycode.CONTROL, Keycode.F15), (Keycode.CONTROL, Keycode.F16), (Keycode.CONTROL, Keycode.F17), BOTAO_MUTE_DISCORD],

    [(Keycode.CONTROL, Keycode.SHIFT, Keycode.F15), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F16), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F17), "BOTAO_CAMADA",
     (Keycode.CONTROL, Keycode.SHIFT, Keycode.F18), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F19), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F20), BOTAO_PLAY_PAUSE,
     (Keycode.CONTROL, Keycode.SHIFT, Keycode.F21), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F22), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F23), BOTAO_MUTE_DISCORD]
]

def formatar_tecla(tecla, key_number):
    if key_number == 3 or tecla == "BOTAO_CAMADA":
        return "Mudar Camada"
    if config_ativa and "layers" in config_ativa and camada_atual < len(config_ativa["layers"]):
        keys_dict = config_ativa["layers"][camada_atual].get("keys", {})
        k_data = keys_dict.get(str(key_number)) or keys_dict.get(key_number)
        if k_data and isinstance(k_data, dict):
            lbl = k_data.get("label", "").strip()
            if lbl:
                return lbl
            tipo = k_data.get("type", "key")
            val = k_data.get("value")
            if tipo == "url":
                return k_data.get("name") or (f"URL: {val[:12]}" if val else "Abrir URL")
            if tipo == "app":
                val_s = str(val or k_data.get("path") or "App")
                app_nm = val_s.split("\\")[-1].replace(".exe", "")
                return k_data.get("name") or f"APP: {app_nm[:10]}"
            if tipo == "command":
                return k_data.get("name") or "CMD EXEC"
            if tipo == "macro":
                return k_data.get("name") or "Macro"
            if isinstance(val, list):
                return " + ".join(str(v) for v in val)
            if val:
                return str(val)

    if isinstance(tecla, tuple):
        nomes = []
        for code in tecla:
            for k, v in Keycode.__dict__.items():
                if v == code and not k.startswith("_"):
                    nomes.append(k.replace("CONTROL", "Ctrl").replace("ALT", "Alt").replace("SHIFT", "Shift"))
                    break
        return " + ".join(nomes)
    else:
        for k, v in Keycode.__dict__.items():
            if v == tecla and not k.startswith("_"):
                return k
    return str(tecla)

def obter_dados_tecla(camada_idx, key_number):
    if config_ativa and "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
        keys_dict = config_ativa["layers"][camada_idx].get("keys", {})
        return keys_dict.get(str(key_number)) or keys_dict.get(key_number)
    return None

def obter_nome_acao(item_acao, default=""):
    if not item_acao:
        return default
    if isinstance(item_acao, dict):
        if item_acao.get("name"):
            return item_acao.get("name")
        lbl = item_acao.get("label", "").strip()
        if lbl:
            return lbl
        tipo = item_acao.get("type", "key")
        val = item_acao.get("value")
        if tipo == "app":
            val_s = str(val or item_acao.get("path") or "App")
            app_nm = val_s.split("\\")[-1].replace(".exe", "")
            return item_acao.get("name") or f"APP: {app_nm[:10]}"
        if tipo == "command":
            return item_acao.get("name") or "CMD EXEC"
        if tipo == "macro":
            return item_acao.get("name") or "Macro"
        if isinstance(val, list):
            return " + ".join(str(v) for v in val)
        return str(val) if val else str(tipo or default)
    if isinstance(item_acao, list):
        return " + ".join(str(v) for v in item_acao)
    return str(item_acao)

# =====================================================================
# 5. EXECUÇÃO DO ENCODER
# =====================================================================
alt_zoom_pressionado = False
tempo_soltar_alt_zoom = 0.0

def executar_encoder(direcao):
    global alt_zoom_pressionado, tempo_soltar_alt_zoom, camada_atual
    global nivel_volume, nivel_brilho, nivel_zoom, nivel_scroll, vol_mudo

    nome_l, perfil_l, fn, custom_cw, custom_ccw, _ = obter_info_camada(camada_atual)
    step_cw, step_ccw = obter_passos_funcao(fn, camada_atual)
    dir_str = "CW (+)" if direcao > 0 else "CCW (-)"
    print(f"[SERIAL] ENCODER {dir_str} | Camada {camada_atual} | Funcao: {fn} (Passo: +{step_cw}/-{step_ccw})")

    if fn == 'volume':
        passos = step_cw if direcao > 0 else step_ccw
        codigo = ConsumerControlCode.VOLUME_INCREMENT if direcao > 0 else ConsumerControlCode.VOLUME_DECREMENT
        for _ in range(passos):
            consumer_ctrl.send(codigo)
            time.sleep(0.005)

        delta = (passos * 2) if direcao > 0 else -(passos * 2)
        nivel_volume = max(0, min(100, nivel_volume + delta))
        vol_mudo = False
        print(f"[SERIAL] OSD_BAR|volume|{nivel_volume}")
        mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')

    elif fn == 'brightness':
        passos = step_cw if direcao > 0 else step_ccw
        codigo = Keycode.F2 if direcao > 0 else Keycode.F1
        for _ in range(passos):
            teclado.press(codigo)
            time.sleep(0.01)
            teclado.release(codigo)
            time.sleep(0.005)

        delta = (passos * 5) if direcao > 0 else -(passos * 5)
        nivel_brilho = max(0, min(100, nivel_brilho + delta))
        print(f"[SERIAL] OSD_BAR|brightness|{nivel_brilho}")
        mostrar_barra_oled("BRILHO", f"{nivel_brilho}%", nivel_brilho, icone='brightness')

    elif fn == 'zoom':
        passos = step_cw if direcao > 0 else step_ccw
        if not alt_zoom_pressionado:
            teclado.press(Keycode.ALT)
            alt_zoom_pressionado = True
            time.sleep(0.02)
        wheel_dir = 1 if direcao > 0 else -1
        for _ in range(passos):
            mouse.move(wheel=wheel_dir)
            time.sleep(0.01)
        tempo_soltar_alt_zoom = time.monotonic() + 0.35

        delta = (passos * 5) if direcao > 0 else -(passos * 5)
        nivel_zoom = max(10, min(500, nivel_zoom + delta))
        print(f"[SERIAL] OSD_BAR|zoom|{nivel_zoom}")
        pct_zoom_bar = max(0, min(100, int((nivel_zoom / 200.0) * 100)))
        mostrar_barra_oled("ZOOM", f"{nivel_zoom}%", pct_zoom_bar, icone='zoom')

    elif fn == 'scroll':
        passos = step_cw if direcao > 0 else step_ccw
        wheel_dir = -1 if direcao > 0 else 1
        for _ in range(passos):
            mouse.move(wheel=wheel_dir)
            time.sleep(0.008)

        delta = -(passos * 5) if direcao > 0 else (passos * 5)
        nivel_scroll = max(0, min(100, nivel_scroll + delta))
        print(f"[SERIAL] OSD_BAR|scroll|{nivel_scroll}")
        mostrar_barra_oled("ROLAGEM", f"{nivel_scroll}%", nivel_scroll, icone='scroll')

    elif fn == 'layer_nav':
        total_camadas = len(config_ativa.get("layers", [])) if config_ativa else 4
        total_camadas = max(1, total_camadas)
        if direcao > 0:
            prox_c = (camada_atual + 1) % total_camadas
            animar_troca_camada(prox_c, direcao=1)
            print(f"[SERIAL] Mudou para Camada {camada_atual}")
        else:
            prox_c = (camada_atual - 1) % total_camadas
            animar_troca_camada(prox_c, direcao=-1)
            print(f"[SERIAL] Mudou para Camada {camada_atual}")

    elif fn == 'video':
        passos = step_cw if direcao > 0 else step_ccw
        codigo = Keycode.RIGHT_ARROW if direcao > 0 else Keycode.LEFT_ARROW
        for _ in range(passos):
            teclado.press(codigo)
            time.sleep(0.01)
            teclado.release(codigo)
            time.sleep(0.005)
        lbl = f"AVANÇAR ({passos})" if direcao > 0 else f"VOLTAR ({passos})"
        mostrar_acao_oled("VÍDEO", lbl, icone='video')

    elif fn == 'media':
        if direcao > 0:
            consumer_ctrl.send(ConsumerControlCode.SCAN_NEXT_TRACK)
            mostrar_acao_oled("MÍDIA", "PRÓXIMA >>", icone='media')
        else:
            consumer_ctrl.send(ConsumerControlCode.SCAN_PREVIOUS_TRACK)
            mostrar_acao_oled("MÍDIA", "<< ANTERIOR", icone='media')

    elif fn == 'custom':
        acao = custom_cw if direcao > 0 else custom_ccw
        rotulo = str(acao) if acao else ("ATALHO CW" if direcao > 0 else "ATALHO CCW")
        executar_acao_generica(acao)
        mostrar_acao_oled("CUSTOM >" if direcao > 0 else "< CUSTOM", rotulo[:18], icone='custom')

def executar_encoder_click():
    global vol_mudo, nivel_volume, camada_atual
    nome_l, perfil_l, fn, _, _, custom_press = obter_info_camada(camada_atual)
    print(f"[SERIAL] ENCODER CLICK | Camada {camada_atual} | Funcao: {fn}")

    if fn == 'volume':
        consumer_ctrl.send(ConsumerControlCode.MUTE)
        vol_mudo = not vol_mudo
        if vol_mudo:
            print(f"[SERIAL] OSD_BAR|volume|0")
            mostrar_barra_oled("VOLUME", "MUDO", 0, icone='mute')
        else:
            print(f"[SERIAL] OSD_BAR|volume|{nivel_volume}")
            mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')

    elif fn == 'brightness':
        nivel_brilho = 70
        print(f"[SERIAL] OSD_BAR|brightness|70")
        mostrar_barra_oled("BRILHO", "70%", 70, icone='brightness')

    elif fn == 'zoom':
        teclado.press(Keycode.CONTROL, Keycode.ZERO)
        time.sleep(0.01)
        teclado.release(Keycode.CONTROL, Keycode.ZERO)
        nivel_zoom = 100
        print(f"[SERIAL] OSD_BAR|zoom|100")
        mostrar_barra_oled("ZOOM", "100%", 50, icone='zoom')

    elif fn == 'video':
        consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE)
        mostrar_acao_oled("VÍDEO", "PLAY / PAUSE", icone='video')

    elif fn == 'media':
        consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE)
        mostrar_acao_oled("MÍDIA", "PLAY / PAUSE", icone='media')

    elif fn == 'scroll':
        mouse.click(Mouse.MIDDLE_BUTTON)
        nivel_scroll = 50
        print(f"[SERIAL] OSD_BAR|scroll|50")
        mostrar_barra_oled("ROLAGEM", "50%", 50, icone='scroll')

    elif fn == 'layer_nav':
        animar_troca_camada(0, direcao=1)
        print(f"[SERIAL] Mudou para Camada 0")

    elif fn == 'custom':
        if custom_press:
            executar_acao_generica(custom_press)
            mostrar_acao_oled("CUSTOM CLICK", str(custom_press)[:18], icone='custom')
        else:
            consumer_ctrl.send(ConsumerControlCode.MUTE)
            mostrar_acao_oled("CLIQUE", "MUTE", icone='custom')

print("[INFO] PadPro firmware iniciado e pronto!")
executar_animacao_boot(duracao=1.8)
atualizar_oled_padrao(camada_atual)

# =====================================================================
# 6. LOOP PRINCIPAL
# =====================================================================
TEMPO_PREVIEW = 0.38
tempo_inicio_tecla = [0.0] * 12
preview_disparado = [False] * 12
tecla_segurada = [False] * 12
hold_executado = [False] * 12
ultimo_heartbeat = time.monotonic()
serial_buffer = ""

while True:
    try:
        agora = time.monotonic()

        if alt_zoom_pressionado and agora >= tempo_soltar_alt_zoom:
            teclado.release(Keycode.ALT)
            alt_zoom_pressionado = False

        if tempo_reset_oled > 0.0 and agora >= tempo_reset_oled:
            tempo_reset_oled = 0.0
            anim_som_ativa = False
            atualizar_oled_padrao(camada_atual)

        if anim_som_ativa and (agora - anim_som_ultimo_tempo >= 0.11):
            anim_som_ultimo_tempo = agora
            anim_som_frame = (anim_som_frame + 1) % len(BMP_ANIM_SPEAKER)
            if icone_grid:
                icone_grid.bitmap = BMP_ANIM_SPEAKER[anim_som_frame]

        if TEM_ENCODER and encoder:
            dir_giro = encoder.ler()
            if dir_giro != 0:
                executar_encoder(dir_giro)

        if TEM_ENCODER and botao_encoder:
            pressionado_sw = not botao_encoder.value
            if pressionado_sw != estado_anterior_sw:
                estado_anterior_sw = pressionado_sw
                if pressionado_sw:
                    executar_encoder_click()

        if TEM_SUPERVISOR and supervisor.runtime.serial_bytes_available:
            while supervisor.runtime.serial_bytes_available:
                ch = sys.stdin.read(1)
                if ch in ('\r', '\n'):
                    cmd = serial_buffer.strip()
                    serial_buffer = ""
                    cmd_upper = cmd.upper()

                    if cmd_upper.startswith("SET_LAYER:"):
                        try:
                            val_str = cmd.split(":")[1].strip()
                            prox_c = max(0, int(val_str))
                            if prox_c != camada_atual:
                                animar_troca_camada(prox_c, direcao=1 if prox_c > camada_atual else -1)
                            else:
                                atualizar_oled_padrao(camada_atual)
                            print(f"[SERIAL] Camada sincronizada: {camada_atual}")
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_LAYER: {e}")

                    elif cmd_upper.startswith("SET_ENCODER:"):
                        try:
                            partes = cmd.split(":")
                            c_idx = int(partes[1])
                            fn_nova = partes[2].lower() if len(partes) > 2 else 'volume'
                            cw_novo = partes[3] if len(partes) > 3 and partes[3] else None
                            ccw_novo = partes[4] if len(partes) > 4 and partes[4] else None
                            press_novo = partes[5] if len(partes) > 5 and partes[5] else None
                            step_cw = int(partes[6]) if len(partes) > 6 and partes[6].isdigit() else 1
                            step_ccw = int(partes[7]) if len(partes) > 7 and partes[7].isdigit() else 1

                            if config_ativa and "layers" in config_ativa and c_idx < len(config_ativa["layers"]):
                                enc_obj = config_ativa["layers"][c_idx].setdefault("encoder", {})
                                enc_obj["function"] = fn_nova
                                if cw_novo is not None: enc_obj["customCW"] = cw_novo
                                if ccw_novo is not None: enc_obj["customCCW"] = ccw_novo
                                if press_novo is not None: enc_obj["customPress"] = press_novo
                                enc_obj["steps"] = {"cw": step_cw, "ccw": step_ccw}
                                print(f"[SERIAL] Encoder atualizado Camada {c_idx} -> {fn_nova} (passo {step_cw}/{step_ccw})")
                                if c_idx == camada_atual:
                                    atualizar_oled_padrao(camada_atual)
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_ENCODER: {e}")

                    elif cmd_upper.startswith("SET_OLED_CUSTOM:"):
                        try:
                            p = cmd.split(":")
                            sd = (p[1].strip() == '1') if len(p) > 1 else True
                            si = (p[2].strip() == '1') if len(p) > 2 else True
                            sdo = (p[3].strip() == '1') if len(p) > 3 else True
                            tout = float(p[4].strip()) if len(p) > 4 and p[4].strip() else 1.2
                            anim = (p[5].strip() == '1') if len(p) > 5 and p[5].strip() else True

                            if config_ativa is not None:
                                c = config_ativa.setdefault("customization", {})
                                o = c.setdefault("oled", {})
                                o["showDivider"] = sd
                                o["showIcons"] = si
                                o["showLayerDots"] = sdo
                                o["displayTimeout"] = tout
                                o["showAnimations"] = anim

                            atualizar_oled_padrao(camada_atual)
                            print(f"[SERIAL] OLED Customizado: Div={sd}, Icones={si}, Dots={sdo}, Timeout={tout}s, Anim={anim}")
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_OLED_CUSTOM: {e}")

                    elif cmd_upper in ("OLED:BOOT", "TEST_BOOT"):
                        executar_animacao_boot(duracao=2.2)

                    elif cmd_upper in ("OLED:UPDATING", "TEST_UPDATING"):
                        animar_engrenagem_atualizando(passos=20)

                    elif cmd_upper in ("CONFIG_UPDATED", "RELOAD_CONFIG"):
                        carregar_config()
                        atualizar_oled_padrao(camada_atual)

                    elif cmd_upper in ("RELOAD_FIRMWARE", "REBOOT"):
                        if TEM_SUPERVISOR:
                            supervisor.reload()

                    elif cmd_upper == "OLED:RESET":
                        parar_animacao_som()

                    elif cmd_upper.startswith("OLED:TOCANDO SOM"):
                        parts = cmd[5:].split("|")
                        nome_som = parts[1] if len(parts) > 1 else "SOUNDPAD"
                        iniciar_animacao_som(nome_som, duracao=0)

                    elif cmd_upper.startswith("OLED:ESPIAR SOM"):
                        parts = cmd[5:].split("|")
                        nome_som = parts[1] if len(parts) > 1 else "SOUNDPAD"
                        iniciar_animacao_som(nome_som, duracao=2.5)

                    elif cmd_upper.startswith("SET_VOL:"):
                        try:
                            p_vol = cmd.split(":")
                            pct_val = max(0, min(100, int(p_vol[1].strip())))
                            nivel_volume = pct_val
                            if len(p_vol) > 2 and p_vol[2].strip():
                                vol_mudo = (p_vol[2].strip() == '1')
                            show_hud = (p_vol[3].strip() == '1') if len(p_vol) > 3 else False
                            if show_hud:
                                if vol_mudo:
                                    mostrar_barra_oled("VOLUME", "MUDO", 0, icone='mute')
                                else:
                                    mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')
                            print(f"[SERIAL] Volume sincronizado: {nivel_volume}% (Mudo: {vol_mudo})")
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_VOL: {e}")

                    elif cmd_upper.startswith("SET_BRIGHTNESS:"):
                        try:
                            p_b = cmd.split(":")
                            nivel_brilho = max(0, min(100, int(p_b[1].strip())))
                            show_hud = (p_b[2].strip() == '1') if len(p_b) > 2 else False
                            if show_hud:
                                mostrar_barra_oled("BRILHO", f"{nivel_brilho}%", nivel_brilho, icone='brightness')
                            print(f"[SERIAL] Brilho sincronizado: {nivel_brilho}%")
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_BRIGHTNESS: {e}")

                    elif cmd_upper.startswith("OLED:BAR"):
                        parts = cmd[8:].lstrip("|").split("|")
                        titulo_bar = parts[0] if len(parts) > 0 and parts[0] else "VALOR"
                        try:
                            pct_bar = int(parts[1]) if len(parts) > 1 and parts[1] else 50
                        except Exception:
                            pct_bar = 50
                        icone_bar = parts[2] if len(parts) > 2 and parts[2] else 'volume'
                        try:
                            dur_bar = float(parts[3]) if len(parts) > 3 and parts[3] else 1.2
                        except Exception:
                            dur_bar = 1.2
                        if icone_bar == 'volume' or titulo_bar.upper() == 'VOLUME':
                            nivel_volume = pct_bar
                            vol_mudo = False
                        elif icone_bar == 'brightness' or titulo_bar.upper() == 'BRILHO':
                            nivel_brilho = pct_bar
                        mostrar_barra_oled(titulo_bar, f"{pct_bar}%", pct_bar, icone=icone_bar, duracao=dur_bar)

                    elif cmd_upper.startswith("OLED:"):
                        parts = cmd[5:].split("|")
                        l1 = parts[0] if len(parts) > 0 else ""
                        l2 = parts[1] if len(parts) > 1 else ""
                        dur = float(parts[2]) if len(parts) > 2 else 2.0
                        mostrar_acao_oled(l1, l2, duracao=dur)

                    elif cmd_upper in ("PING", "STATUS", "?"):
                        print(f"[HUD] Camada {camada_atual}")
                        print(f"[SERIAL] STATUS Camada: {camada_atual} | Volume: {nivel_volume}% | Brilho: {nivel_brilho}%")
                else:
                    serial_buffer += ch
                    if len(serial_buffer) > 128:
                        serial_buffer = ""

        # F. Varredura da Matriz de Teclas
        eventos = matriz.ler_eventos()
        total_camadas = len(config_ativa["layers"]) if config_ativa and "layers" in config_ativa else len(mapas)
        total_camadas = max(1, total_camadas)

        mapa_ativo = mapas[camada_atual % len(mapas)]
        for key_number, pressed in eventos:
            tecla_pressionada = mapa_ativo[key_number]
            nome_acao = formatar_tecla(tecla_pressionada, key_number)
            k_data = obter_dados_tecla(camada_atual, key_number)
            tem_hold = bool(k_data and k_data.get("holdAction") and k_data.get("holdAction") != "none")

            if pressed:
                tempo_inicio_tecla[key_number] = agora
                preview_disparado[key_number] = False
                tecla_segurada[key_number] = True
                hold_executado[key_number] = False

                if key_number == 3 or tecla_pressionada == "BOTAO_CAMADA":
                    mostrar_acao_oled(f"CAMADA {camada_atual}", "Mudar Camada", duracao=1.5)
                elif tem_hold:
                    nome_hold = obter_nome_acao(k_data.get("holdAction"), "Dupla Funcao")
                    mostrar_acao_oled(f"B{key_number} PRESS", f"{nome_acao[:10]} / {nome_hold[:10]}", duracao=1.5)
                else:
                    som_titulo = obter_titulo_som(nome_acao)
                    if som_titulo:
                        iniciar_animacao_som(som_titulo, duracao=2.5)
                    else:
                        mostrar_acao_oled(f"B{key_number} PRESS", nome_acao, duracao=1.5)

            else:
                tecla_segurada[key_number] = False

                if key_number == 3 or tecla_pressionada == "BOTAO_CAMADA":
                    tempo_segurado = agora - tempo_inicio_tecla[key_number]
                    if tempo_segurado > 0.5:
                        prox_c = (camada_atual - 1) % total_camadas
                        animar_troca_camada(prox_c, direcao=-1)
                        print(f"[SERIAL] Mudou para Camada {camada_atual} (Voltou)")
                    else:
                        prox_c = (camada_atual + 1) % total_camadas
                        animar_troca_camada(prox_c, direcao=1)
                        print(f"[SERIAL] Mudou para Camada {camada_atual}")
                else:
                    if hold_executado[key_number] or preview_disparado[key_number]:
                        pass
                    else:
                        print(f"[SERIAL] Botao {key_number}: {nome_acao} | Camada {camada_atual}")
                        if k_data and isinstance(k_data, dict):
                            executar_acao_generica(k_data)
                        elif isinstance(tecla_pressionada, (tuple, list)):
                            teclado.press(*tecla_pressionada)
                            time.sleep(0.01)
                            teclado.release(*tecla_pressionada)
                        else:
                            teclado.press(tecla_pressionada)
                            time.sleep(0.01)
                            teclado.release(tecla_pressionada)

                print(f"[SERIAL] UP Botao {key_number} | Camada {camada_atual}")

        # G. Dual Function Hold & Long Press
        for k in range(12):
            if k != 3 and tecla_segurada[k] and not hold_executado[k] and not preview_disparado[k]:
                k_data = obter_dados_tecla(camada_atual, k)
                tem_hold = bool(k_data and k_data.get("holdAction") and k_data.get("holdAction") != "none")
                if tem_hold:
                    if agora - tempo_inicio_tecla[k] >= 0.42:
                        hold_executado[k] = True
                        h_action = k_data.get("holdAction")
                        nome_hold = obter_nome_acao(h_action, "Acao Segurada")
                        print(f"[SERIAL] HOLD Botao {k}: {nome_hold} | Camada {camada_atual}")
                        executar_acao_generica(h_action)
                        mostrar_acao_oled(f"B{k} HOLD", nome_hold, duracao=1.8)
                else:
                    if agora - tempo_inicio_tecla[k] >= TEMPO_PREVIEW:
                        preview_disparado[k] = True
                        tecla_pressionada = mapa_ativo[k]
                        nome_acao = formatar_tecla(tecla_pressionada, k)
                        som_titulo = obter_titulo_som(nome_acao)
                        print(f"[SERIAL] PREVIEW Botao {k}: {nome_acao} | Camada {camada_atual}")
                        if som_titulo:
                            iniciar_animacao_som(som_titulo, duracao=2.5)
                        else:
                            mostrar_acao_oled("ESPIAR SOUNDPAD", nome_acao, duracao=2.5)

        # H. Heartbeat
        if agora - ultimo_heartbeat >= 3.5:
            ultimo_heartbeat = agora
            print(f"[HEARTBEAT] Camada {camada_atual} | GP13(A)={int(encoder.a.value)} GP11(B)={int(encoder.b.value)} GP12(SW)={int(botao_encoder.value)}")

    except Exception as e:
        print(f"[ERRO] Loop: {e}")
