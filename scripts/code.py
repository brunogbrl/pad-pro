import time
import sys
import json
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

try:
    import i2cdisplaybus
    I2CDisplayBus = i2cdisplaybus.I2CDisplayBus
except (ImportError, AttributeError):
    I2CDisplayBus = displayio.I2CDisplay

try:
    import supervisor
    TEM_SUPERVISOR = True
except ImportError:
    TEM_SUPERVISOR = False

# =====================================================================
# 1. OLED DISPLAY SSD1306 128x32 (I2C GP15/GP14) - DESIGN MODERNO
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

# Bitmaps de icones 10x10 para a telinha OLED
paleta_oled = displayio.Palette(2)
paleta_oled[0] = 0x000000
paleta_oled[1] = 0xFFFFFF

# Hexadecimal exato do Logo Oficial PadPro (128x32)
BOOT_LOGO_HEX = {
    12: '00000007ff0000077ff0000000000000',
    13: '00000007ff8000077ff8000000000000',
    14: '0000000707ff83f7707bfc7f80000000',
    15: '0000000707ffc7ff707bfcffc0000000',
    16: '00000007ff01e70f7ff381e1e0000000',
    17: '00000007fe3fe7077fe381e1e0000000',
    18: '000000070079e70f700381e1e0000000',
    19: '00000007007be7ff700380ffc0000000',
    20: '00000007003fe3f77003807f80000000'
}

# Hexadecimal exato do texto "Atualizando..." da imagem oficial (w=88, h=7)
UPDATING_TEXT_HEX = {
    0: '0000000000000000300000',
    1: '07870000fc000000300000',
    2: '0fcf73fcffffefe3f3f000',
    3: '0ccf73fefffbffe7f7f800',
    4: '1fe773fefce3fe7e371800',
    5: '1fe777eefdc77e7e773800',
    6: '3877bffefffffe77f3f7e0'
}

# 6 frames de rotação contínua da engrenagem 24x24
GEAR_ANIM_HEX = [
    ['000000', '003e00', '007e00', '007e00', '00ff00', '1ffffc', '3ffffc', '3ffffe', '7ffffe', '7fc3fe', '3f81fc', '1f80f8', '1f00f8', '1f00f8', '1f80fc', '3f81fe', '7fe3fe', '7ffffe', '3ffffe', '3ffffc', '19ff98', '007f00', '007e00', '007e00'],
    ['000000', '00f800', '00f800', '01fe08', '00fff8', '01fffc', '1ffffc', '3ffffc', '7ffffc', '7fc3f8', '7f80f8', '7f80f8', '3f80fc', '1f00fe', '1f01ff', '1fc1ff', '0ff1ff', '1ffffe', '3ffffc', '3fffc8', '1fffc0', '065f80', '001f80', '001f00'],
    ['000000', '006000', '03f020', '03f9f0', '03fff8', '03fff8', '03fff8', '0ffff8', '7ffff0', '7fc3f8', '7f80f8', '7f80ff', 'ff80ff', '7f007f', '1f80ff', '0fc1ff', '0fdbfe', '0ffff6', '0ffff0', '1fffe0', '1fffc0', '07bfe0', '0707c0', '000600'],
    ['000000', '008080', '03c3e0', '07f7f0', '07fff0', '07fff0', '07fff0', '07fff0', '0ffff0', '3fc1fe', '7f80ff', '7f80ff', '7f807f', '7f80ff', '7f80ff', '7fa0ff', '0febf0', '07fff0', '07fff0', '07fff0', '07fff0', '07fff0', '05c1c0', '01c100'],
    ['000000', '000340', '030fc0', '079fe0', '0fffe0', '0fffc0', '1fffe0', '0ffffa', '0ffffe', '0fc1ff', '1f80ff', '3f807f', '7f80ff', '7f80ff', '7f8078', '3fc0f8', '7ff7f8', '07fff8', '03fff8', '01fffc', '01fff8', '01fee0', '03f040', '017000'],
    ['000400', '000f80', '001f80', '063f80', '0fff80', '1fffc0', '3ffffe', '1fffff', '1fffff', '0fc1ff', '0f80ff', '1f80ff', '3f807c', '3f807c', '7fc0fc', '7fc2fc', '3ffffc', '3ffffe', '1bfffc', '01fff8', '00fff8', '00fc10', '00fc00', '007c00']
]

def criar_bmp_de_hex(hex_data, w, h):
    bmp = displayio.Bitmap(w, h, 2)
    if isinstance(hex_data, dict):
        for y, hstr in hex_data.items():
            for byte_idx in range(len(hstr) // 2):
                b = int(hstr[byte_idx*2 : byte_idx*2+2], 16)
                if b != 0:
                    for bit in range(8):
                        if b & (1 << (7 - bit)):
                            px = byte_idx * 8 + bit
                            if px < w and y < h:
                                bmp[px, y] = 1
    else:
        for y, hstr in enumerate(hex_data):
            for byte_idx in range(len(hstr) // 2):
                b = int(hstr[byte_idx*2 : byte_idx*2+2], 16)
                if b != 0:
                    for bit in range(8):
                        if b & (1 << (7 - bit)):
                            px = byte_idx * 8 + bit
                            if px < w and y < h:
                                bmp[px, y] = 1
    return bmp

def criar_bmp_icone(linhas_str, w=10, h=10):
    bmp = displayio.Bitmap(w, h, 2)
    linhas = [l.strip().replace(" ", "") for l in linhas_str.strip().split("\n")]
    for y, linha in enumerate(linhas):
        for x, char in enumerate(linha):
            if x < w and y < h and char in ('#', '1', '*'):
                bmp[x, y] = 1
    return bmp

ICONES_STR = {
    'volume': (
        ". # . . . . # . .\n"
        ". # # . . . . # .\n"
        "# # # # . . . # .\n"
        "# # # # . # . . #\n"
        "# # # # . # . . #\n"
        "# # # # . . . # .\n"
        ". # # . . . . # .\n"
        ". # . . . . # . .\n"
        ". . . . . . . . .\n"
        ". . . . . . . . .\n"
    ),
    'mute': (
        ". . . # # . . # .\n"
        ". . # # # . . . #\n"
        ". # # # # . . # .\n"
        "# # # # # . # . .\n"
        "# # # # # # . . .\n"
        "# # # # # . # . .\n"
        "# # # # # . . # .\n"
        ". # # # # . . . #\n"
        ". . # # # . . # .\n"
        ". . . # # . . . .\n"
    ),
    'brightness': (
        ". . . # . # . . .\n"
        ". # . . . . . # .\n"
        ". . # # # # # . .\n"
        "# . # # # # # . #\n"
        ". . # # # # # . .\n"
        "# . # # # # # . #\n"
        ". . # # # # # . .\n"
        ". # . . . . . # .\n"
        ". . . # . # . . .\n"
        ". . . . . . . . .\n"
    ),
    'zoom': (
        ". # # # # . . . .\n"
        "# . . . . # . . .\n"
        "# . # # . # . . .\n"
        "# . # # . # . . .\n"
        "# . . . . # . . .\n"
        ". # # # # # . . .\n"
        ". . . . . . # . .\n"
        ". . . . . . . # .\n"
        ". . . . . . . . #\n"
        ". . . . . . . . .\n"
    ),
    'scroll': (
        ". . # # # # . . .\n"
        ". # . . # . # . .\n"
        ". # . . # . # . .\n"
        ". # . . # . # . .\n"
        ". # . . . . # . .\n"
        ". # . . . . # . .\n"
        ". # . . . . # . .\n"
        ". . # # # # . . .\n"
        ". . . # # . . . .\n"
        ". . . . . . . . .\n"
    ),
    'media': (
        ". . . # # # . . .\n"
        ". . . # . . # . .\n"
        ". . . # . . # . .\n"
        ". . . # . . # . .\n"
        ". . # # . . # . .\n"
        ". # # # . # # # .\n"
        ". # # # . # # # .\n"
        ". . # # . . # # .\n"
        ". . . . . . . . .\n"
        ". . . . . . . . .\n"
    ),
    'video': (
        "# # # # # # # # .\n"
        "# . . # . . # . #\n"
        "# # # # # # # # #\n"
        "# . # . . . . . #\n"
        "# . # # . . . . #\n"
        "# . # # # . . . #\n"
        "# . # # . . . . #\n"
        "# . # . . . . . #\n"
        "# # # # # # # # #\n"
        ". . . . . . . . .\n"
    ),
    'custom': (
        ". . # # # # . . .\n"
        ". # . . . . # . .\n"
        "# . # # # # . # .\n"
        "# . # . . # . # .\n"
        "# . # . . # . # .\n"
        "# . # # # # . # .\n"
        ". # . . . . # . .\n"
        ". . # # # # . . .\n"
        ". . . . . . . . .\n"
        ". . . . . . . . .\n"
    ),
    'layer_nav': (
        ". . . # # # # . . .\n"
        ". . # . . . . # . .\n"
        ". # # # # # # # # .\n"
        ". . # . . . . # . .\n"
        ". # # # # # # # # .\n"
        ". . # . . . . # . .\n"
        ". # # # # # # # # .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
    )
}

icone_grid = None
grupo_oled = None
bmp_barra_progresso = None
tile_barra_progresso = None
tile_boot_logo = None
tile_gear = None
tile_updating_text = None
BMP_GEAR_ANIM = []
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

    grupo_oled = displayio.Group()

    # Linha divisoria sutil e moderna
    bmp_linha = displayio.Bitmap(128, 1, 2)
    for x in range(128):
        bmp_linha[x, 0] = 1 if (x % 2 == 0) else 0 # Linha pontilhada elegante
    linha_div = displayio.TileGrid(bmp_linha, pixel_shader=paleta_oled, x=0, y=14)
    grupo_oled.append(linha_div)

    # Slot para icone 10x10 no canto inferior esquerdo
    bmp_vazio = displayio.Bitmap(10, 10, 2)
    icone_grid = displayio.TileGrid(bmp_vazio, pixel_shader=paleta_oled, x=2, y=18)
    grupo_oled.append(icone_grid)

    # Barra de Progresso Grafica Dinamica para OLED (Volume, Brilho, Zoom, etc.)
    # Largura: 108 pixels, Altura: 7 pixels, Estilo Windows 11 Slider (x=16, y=20)
    bmp_barra_progresso = displayio.Bitmap(108, 7, 2)
    tile_barra_progresso = displayio.TileGrid(bmp_barra_progresso, pixel_shader=paleta_oled, x=16, y=20)
    tile_barra_progresso.hidden = True
    grupo_oled.append(tile_barra_progresso)

    # Boot Logo Oficial PadPro 128x32 (exibicao limpa e exclusiva na inicializacao)
    bmp_boot_logo = criar_bmp_de_hex(BOOT_LOGO_HEX, 128, 32)
    tile_boot_logo = displayio.TileGrid(bmp_boot_logo, pixel_shader=paleta_oled, x=0, y=0)
    tile_boot_logo.hidden = True
    grupo_oled.append(tile_boot_logo)

    # Tela de Atualizacao Unificada Oficial: Engrenagem 24x24 + Texto "Atualizando..."
    BMP_GEAR_ANIM = [criar_bmp_de_hex(f, 24, 24) for f in GEAR_ANIM_HEX]
    tile_gear = displayio.TileGrid(BMP_GEAR_ANIM[0], pixel_shader=paleta_oled, x=7, y=4)
    tile_gear.hidden = True
    grupo_oled.append(tile_gear)

    bmp_updating_text = criar_bmp_de_hex(UPDATING_TEXT_HEX, 88, 7)
    tile_updating_text = displayio.TileGrid(bmp_updating_text, pixel_shader=paleta_oled, x=36, y=12)
    tile_updating_text.hidden = True
    grupo_oled.append(tile_updating_text)

    # Bitmaps para os Dots de Camada no topo direito (4x4 pixels nítidos)
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
        grupo_oled.append(dg)
        dot_grids.append(dg)

    # Texto Superior (Linha 1 - Camada & Perfil)
    txt_linha1 = label.Label(terminalio.FONT, text="", color=0xFFFFFF, x=2, y=6)
    grupo_oled.append(txt_linha1)

    # Texto Inferior (Linha 2 - Funcao/Acao sem a palavra Rotary)
    txt_linha2 = label.Label(terminalio.FONT, text="", color=0xFFFFFF, x=16, y=24)
    grupo_oled.append(txt_linha2)

    display.root_group = grupo_oled
    TEM_OLED = True
    print("[OLED] Display SSD1306 128x32 ativo com layout moderno, icones, logo e barra!")
except Exception as e:
    print(f"[OLED ERRO] {e}")

BMP_CACHE = {}
for k, dados_str in ICONES_STR.items():
    try:
        BMP_CACHE[k] = criar_bmp_icone(dados_str, 10, 10)
    except Exception:
        pass

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
    """Renderiza tela padrao da camada com personalizacoes e dots de status."""
    if not TEM_OLED:
        return
    try:
        nome, perfil, fn, _, _, _ = obter_info_camada(camada_idx)
        fn_label = obter_nome_funcao_amigavel(fn)
        
        # Oculta barra de progresso e telas especiais no modo normal de camada
        if tile_barra_progresso:
            tile_barra_progresso.hidden = True
        if tile_boot_logo:
            tile_boot_logo.hidden = True
        if tile_gear:
            tile_gear.hidden = True
        if tile_updating_text:
            tile_updating_text.hidden = True

        # Opcoes de personalizacao
        cust = config_ativa.get("customization", {}) if config_ativa else {}
        oled_cfg = cust.get("oled", {})
        show_divider = oled_cfg.get("showDivider", True)
        show_icons = oled_cfg.get("showIcons", True)
        show_dots = oled_cfg.get("showLayerDots", True)

        # 1. Linha divisoria
        if linha_div:
            linha_div.hidden = not show_divider

        # 2. Dots visuais de camadas (renderizados via Bitmap real 4x4 no hardware OLED)
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
            txt_linha2.x = 2

    except Exception as e:
        print(f"[OLED ERRO PADRAO] {e}")

def mostrar_acao_oled(linha1, linha2, duracao=1.1, icone=None):
    """Exibe feedback de acao rapida sem sobreposicao de icones ou texto."""
    global tempo_reset_oled
    if not TEM_OLED:
        return
    try:
        # Oculta barra de progresso em acoes simples
        if tile_barra_progresso:
            tile_barra_progresso.hidden = True

        # Restaura divisoria se configurada
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

        # Oculta dots durante alertas e acoes especificas
        if dot_grids:
            for dg in dot_grids:
                dg.hidden = True

        # Previne sobreposicao: se nao tem icone, limpa o bitmap do icone e alinha a esquerda
        if icone:
            atualizar_icone_oled(icone)
            if icone_grid:
                icone_grid.hidden = False
            txt_linha2.x = 16
        else:
            if icone_grid:
                icone_grid.bitmap = bmp_vazio
            txt_linha2.x = 2

        if duracao is not None and duracao <= 0:
            tempo_reset_oled = 0.0 # Sem timeout! Fica na tela ate receber OLED:RESET ou acao
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
    """Desenha a moldura em cápsula e preenchimento da barra de progresso estilo Windows 11 (108x7)."""
    if not bmp_barra_progresso:
        return
    pct_val = max(0, min(100, int(pct)))

    # 1. Bordas da cápsula (cantos arredondados: cantos (0,0), (107,0), (0,6), (107,6) desligados)
    for bx in range(108):
        is_topo_base = 1 if (1 <= bx <= 106) else 0
        bmp_barra_progresso[bx, 0] = is_topo_base
        bmp_barra_progresso[bx, 6] = is_topo_base

    for by in range(7):
        is_lateral = 1 if (1 <= by <= 5) else 0
        bmp_barra_progresso[0, by] = is_lateral
        bmp_barra_progresso[107, by] = is_lateral

    # 2. Preenchimento interno (x de 1 a 106, y de 1 a 5)
    pixels_cheios = int(round((pct_val / 100.0) * 106))
    for bx in range(1, 107):
        is_cheio = 1 if bx <= pixels_cheios else 0
        for by in range(1, 6):
            if is_cheio:
                bmp_barra_progresso[bx, by] = 1
            else:
                # Trilho central discreto guia estilo slider
                bmp_barra_progresso[bx, by] = 1 if by == 3 else 0

def mostrar_barra_oled(titulo, valor_str, pct, icone=None, duracao=1.2):
    """Exibe barra de progresso gráfica com ícone, valor e barra horizontal animada (estilo Windows 11)."""
    global tempo_reset_oled
    if not TEM_OLED:
        return
    try:
        t_clean = str(titulo).strip()[:14]
        v_clean = str(valor_str).strip()[:7]
        espacos = 21 - len(t_clean) - len(v_clean)
        if espacos < 1:
            espacos = 1
        txt_l1 = t_clean + (" " * espacos) + v_clean
        if txt_linha1.text != txt_l1:
            txt_linha1.text = txt_l1[:21]
        txt_linha1.x = 2

        # Linha 2 de texto fica vazia para dar espaço total à barra de progresso e ao ícone
        txt_linha2.text = ""

        if icone:
            atualizar_icone_oled(icone)
            if icone_grid:
                icone_grid.hidden = False
        else:
            if icone_grid:
                icone_grid.bitmap = bmp_vazio

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

# ---------------------------------------------------------------------
# ANIMAÇÕES AVANÇADAS: ALTO-FALANTE DE ÁUDIO, ENGRENAGEM, BOOT E TRANSIÇÕES
# ---------------------------------------------------------------------
SPEAKER_STRS = [
    # Frame 0: Alto-falante em repouso
    (
        ". . . . . . . . . .\n"
        ". . . # . . . . . .\n"
        ". . # # . . . . . .\n"
        ". # # # . . . . . .\n"
        "# # # # . . . . . .\n"
        "# # # # . . . . . .\n"
        ". # # # . . . . . .\n"
        ". . # # . . . . . .\n"
        ". . . # . . . . . .\n"
        ". . . . . . . . . .\n"
    ),
    # Frame 1: Onda sonora 1 (curta)
    (
        ". . . . . . . . . .\n"
        ". . . # . . . . . .\n"
        ". . # # . # . . . .\n"
        ". # # # . . # . . .\n"
        "# # # # . . # . . .\n"
        "# # # # . . # . . .\n"
        ". # # # . . # . . .\n"
        ". . # # . # . . . .\n"
        ". . . # . . . . . .\n"
        ". . . . . . . . . .\n"
    ),
    # Frame 2: Ondas sonoras 1 e 2
    (
        ". . . . . . . . . .\n"
        ". . . # . . . # . .\n"
        ". . # # . # . . # .\n"
        ". # # # . . # . # .\n"
        "# # # # . . # . # .\n"
        "# # # # . . # . # .\n"
        ". # # # . . # . # .\n"
        ". . # # . # . . # .\n"
        ". . . # . . . # . .\n"
        ". . . . . . . . . .\n"
    ),
    # Frame 3: Ondas sonoras completas propagando
    (
        ". . . # . . . # . .\n"
        ". . . # . . # . . #\n"
        ". . # # . # . . # .\n"
        ". # # # . . # . . #\n"
        "# # # # . . # . . #\n"
        "# # # # . . # . . #\n"
        ". # # # . . # . . #\n"
        ". . # # . # . . # .\n"
        ". . . # . . # . . #\n"
        ". . . # . . . # . .\n"
    )
]

GEAR_STRS = [
    (
        ". . # # # # . . . .\n"
        ". . # . . # . . . .\n"
        "# # # . . # # # . .\n"
        "# . . . . . . # . .\n"
        "# . . . . . . # . .\n"
        "# # # . . # # # . .\n"
        ". . # . . # . . . .\n"
        ". . # # # # . . . .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
    ),
    (
        ". # . # # . # . . .\n"
        "# . # . . # . # . .\n"
        ". # . . . . # . . .\n"
        "# . . . . . . # . .\n"
        "# . . . . . . # . .\n"
        ". # . . . . # . . .\n"
        "# . # . . # . # . .\n"
        ". # . # # . # . . .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
    ),
    (
        "# . . # # . . # . .\n"
        ". # # . . # # . . .\n"
        ". # . . . . # . . .\n"
        "# . . . . . . # . .\n"
        "# . . . . . . # . .\n"
        ". # . . . . # . . .\n"
        ". # # . . # # . . .\n"
        "# . . # # . . # . .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
    ),
    (
        ". # . # # . # . . .\n"
        "# . . . . . . # . .\n"
        ". # . . . . # . . .\n"
        "# # . . . . # # . .\n"
        "# # . . . . # # . .\n"
        ". # . . . . # . . .\n"
        "# . . . . . . # . .\n"
        ". # . # # . # . . .\n"
        ". . . . . . . . . .\n"
        ". . . . . . . . . .\n"
    )
]

CHECK_STR = (
    ". . . . . . . . # .\n"
    ". . . . . . . # # .\n"
    ". . . . . . # # . .\n"
    ". . . . . . # # . .\n"
    "# . . . # # . . . .\n"
    "# # . # # . . . . .\n"
    ". # # # . . . . . .\n"
    ". . # . . . . . . .\n"
    ". . . . . . . . . .\n"
    ". . . . . . . . . .\n"
)

BMP_ANIM_SPEAKER = [criar_bmp_icone(s, 10, 10) for s in SPEAKER_STRS]
BMP_ANIM_GEAR = [criar_bmp_icone(s, 10, 10) for s in GEAR_STRS]
BMP_CHECK = criar_bmp_icone(CHECK_STR, 10, 10)

anim_som_ativa = False
anim_som_frame = 0
anim_som_ultimo_tempo = 0.0

def verificar_animacoes_habilitadas():
    if not config_ativa:
        return True
    return config_ativa.get("customization", {}).get("oled", {}).get("showAnimations", True) is not False

def iniciar_animacao_som(titulo, duracao=2.5):
    global anim_som_ativa, anim_som_frame, anim_som_ultimo_tempo, tempo_reset_oled
    if not TEM_OLED:
        return
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
    
    if icone_grid:
        icone_grid.bitmap = BMP_ANIM_SPEAKER[0]
        
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
    atualizar_oled_padrao(camada_atual)

def animar_troca_camada(nova_camada, direcao=1):
    global camada_atual, anim_som_ativa
    anim_som_ativa = False
    if not TEM_OLED:
        camada_atual = nova_camada
        return
    try:
        if not verificar_animacoes_habilitadas():
            camada_atual = nova_camada
            atualizar_oled_padrao(camada_atual)
            return

        # Micro slide out suave
        dx = -8 if direcao > 0 else 8
        txt_linha1.x += dx
        txt_linha2.x += dx
        time.sleep(0.015)
        
        camada_atual = nova_camada
        
        nome, perfil, fn, _, _, _ = obter_info_camada(camada_atual)
        fn_label = obter_nome_funcao_amigavel(fn)
        txt_linha1.text = str(nome)[:11]
        txt_linha2.text = str(fn_label)[:18]
        
        txt_linha1.x = 20 if direcao > 0 else -16
        txt_linha2.x = 34 if direcao > 0 else -2
        atualizar_icone_oled(fn)
        time.sleep(0.015)
        
        txt_linha1.x = 2
        txt_linha2.x = 16
        atualizar_oled_padrao(camada_atual)
    except Exception as e:
        print(f"[TRANSICAO ERRO] {e}")
        camada_atual = nova_camada
        atualizar_oled_padrao(camada_atual)

def animar_engrenagem_atualizando(passos=14):
    """Tela unificada de atualizacao: engrenagem animada girando na esquerda e 'Atualizando...' na direita."""
    global anim_som_ativa
    anim_som_ativa = False
    if not TEM_OLED or not tile_gear or not tile_updating_text:
        return
    try:
        if not verificar_animacoes_habilitadas():
            atualizar_oled_padrao(camada_atual)
            return

        # Oculta todos os outros elementos para uma tela unica, limpa e moderna
        if dot_grids:
            for dg in dot_grids:
                dg.hidden = True
        if linha_div:
            linha_div.hidden = True
        if icone_grid:
            icone_grid.hidden = True
        if tile_barra_progresso:
            tile_barra_progresso.hidden = True
        if tile_boot_logo:
            tile_boot_logo.hidden = True

        txt_linha1.text = ""
        txt_linha2.text = ""

        # Exibe a tela unificada com a engrenagem e o texto oficial
        tile_updating_text.hidden = False
        tile_gear.hidden = False

        # Rotação animada contínua e suave da engrenagem
        for i in range(passos):
            if BMP_GEAR_ANIM:
                tile_gear.bitmap = BMP_GEAR_ANIM[i % len(BMP_GEAR_ANIM)]
            time.sleep(0.075)

        # Oculta elementos de atualizacao
        tile_updating_text.hidden = True
        tile_gear.hidden = True
        if icone_grid:
            icone_grid.hidden = False
    except Exception as e:
        print(f"[ENGRENAGEM ERRO] {e}")

def executar_animacao_boot():
    """Tela de inicializacao: apenas a logo oficial PadPro centralizada, sem nenhum outro elemento."""
    if not TEM_OLED or not tile_boot_logo:
        return
    try:
        # Garante tela 100% limpa antes da logo
        if dot_grids:
            for dg in dot_grids:
                dg.hidden = True
        if linha_div:
            linha_div.hidden = True
        if icone_grid:
            icone_grid.hidden = True
        if tile_barra_progresso:
            tile_barra_progresso.hidden = True
        if tile_gear:
            tile_gear.hidden = True
        if tile_updating_text:
            tile_updating_text.hidden = True

        txt_linha1.text = ""
        txt_linha2.text = ""

        # Exibe exclusivamente o logo oficial PadPro
        tile_boot_logo.hidden = False
        time.sleep(1.8)

        # Oculta a logo para entrar na interface normal
        tile_boot_logo.hidden = True
        if icone_grid:
            icone_grid.hidden = False
    except Exception as e:
        print(f"[BOOT ERRO] {e}")

# =====================================================================
# 2. CONFIGURACAO & MAPEAMENTO DE CAMADAS
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
        config_ativa = None
        soundpad_mapa = {}

carregar_config()

ENCODER_PADROES = {
    0: ("CAMADA 0", "DIRETAS", "volume", None, None, None),
    1: ("CAMADA 1", "COMBO ALT", "brightness", None, None, None),
    2: ("CAMADA 2", "COMBO CTRL", "zoom", None, None, None),
    3: ("CAMADA 3", "CTRL + SHIFT", "scroll", None, None, None),
}

def obter_info_camada(camada_idx):
    if config_ativa and "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
        l = config_ativa["layers"][camada_idx]
        nome = l.get("name", f"CAMADA {camada_idx}")
        perfil = l.get("profile", "")
        enc = l.get("encoder", {})
        fn = enc.get("function", "volume")
        custom_cw = enc.get("customCW")
        custom_ccw = enc.get("customCCW")
        custom_press = enc.get("customPress")
        return nome, perfil, fn, custom_cw, custom_ccw, custom_press

    return ENCODER_PADROES.get(camada_idx, (f"CAMADA {camada_idx}", "CUSTOM", "volume", None, None, None))

def obter_passos_funcao(fn, camada_idx):
    """Retorna os valores de passos configurados para CW e CCW (ex: +4, -6)."""
    step_cw = 1
    step_ccw = 1
    if config_ativa:
        # 1. Checar se a camada atual possui passos especificos
        if "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
            l_enc = config_ativa["layers"][camada_idx].get("encoder", {})
            l_steps = l_enc.get("steps")
            if l_steps and isinstance(l_steps, dict):
                step_cw = int(l_steps.get("cw", 1) or 1)
                step_ccw = int(l_steps.get("ccw", 1) or 1)
                return max(1, min(step_cw, 20)), max(1, min(step_ccw, 20))
        # 2. Checar passos globais por funcao
        g_steps = config_ativa.get("encoder_steps", {}).get(fn)
        if g_steps and isinstance(g_steps, dict):
            step_cw = int(g_steps.get("cw", 1) or 1)
            step_ccw = int(g_steps.get("ccw", 1) or 1)
            return max(1, min(step_cw, 20)), max(1, min(step_ccw, 20))

    # Padroes sensatos
    if fn == 'volume':
        return 2, 2
    elif fn == 'scroll':
        return 3, 3
    elif fn == 'brightness':
        return 2, 2
    elif fn == 'zoom':
        return 1, 1
    return 1, 1

def obter_titulo_som(nome_tecla):
    if not nome_tecla or not soundpad_mapa:
        return None
    if nome_tecla in soundpad_mapa:
        return soundpad_mapa[nome_tecla]
    partes = [p.strip() for p in str(nome_tecla).split("+")]
    padrao = " + ".join(partes)
    return soundpad_mapa.get(padrao)

# =====================================================================
# 3. ROTARY ENCODER PROFISSIONAL (ALGORITMO BUXTON FULL-STEP ANTI-BOUNCE)
# =====================================================================
DIR_NONE = 0x00
DIR_CW   = 0x10
DIR_CCW  = 0x20

BUXTON_FULL = (
    (0,           2,           4,           0),
    (3,           0,           1,           0 | DIR_CW),
    (3,           2,           0,           0),
    (3,           2,           1,           0),
    (6,           0,           4,           0),
    (6,           5,           0,           0 | DIR_CCW),
    (6,           5,           4,           0)
)

class EncoderRotativoBuxton:
    def __init__(self, pin_a, pin_b, invertido=False):
        self.a = digitalio.DigitalInOut(pin_a)
        self.a.direction = digitalio.Direction.INPUT
        self.a.pull = digitalio.Pull.UP

        self.b = digitalio.DigitalInOut(pin_b)
        self.b.direction = digitalio.Direction.INPUT
        self.b.pull = digitalio.Pull.UP

        self.invertido = invertido
        self.estado = 0

    def ler(self):
        pinstate = (int(self.a.value) << 1) | int(self.b.value)
        trans = BUXTON_FULL[self.estado & 0x0F][pinstate]
        self.estado = trans & 0x0F

        if trans & DIR_CW:
            return -1 if self.invertido else 1
        elif trans & DIR_CCW:
            return 1 if self.invertido else -1
        return 0

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
# 4. USB HID & MATRIZ DE TECLAS
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

        self.num_colunas = len(pinos_colunas)
        self.num_teclas = len(pinos_linhas) * len(pinos_colunas)
        self.estado_anterior = [False] * self.num_teclas
        self.ultimo_tempo_mudanca = [0.0] * self.num_teclas

    def ler_eventos(self):
        eventos = []
        agora = time.monotonic()
        for r_idx, linha in enumerate(self.linhas):
            linha.value = False
            for c_idx, coluna in enumerate(self.colunas):
                tecla_id = r_idx * self.num_colunas + c_idx
                pressionado = not coluna.value
                if pressionado != self.estado_anterior[tecla_id]:
                    if agora - self.ultimo_tempo_mudanca[tecla_id] >= 0.025:
                        self.ultimo_tempo_mudanca[tecla_id] = agora
                        self.estado_anterior[tecla_id] = pressionado
                        eventos.append((tecla_id, pressionado))
            linha.value = True
        return eventos

matriz = MatrizTeclado(PINOS_LINHAS, PINOS_COLUNAS)

BOTAO_PLAY_PAUSE = Keycode.F13
BOTAO_MUTE_DISCORD = (Keycode.CONTROL, Keycode.SHIFT, Keycode.F14)

mapas = [
    # Camada 0: F15..F23 diretas
    [Keycode.F15, Keycode.F16, Keycode.F17, "BOTAO_CAMADA",
     Keycode.F18, Keycode.F19, Keycode.F20, BOTAO_PLAY_PAUSE,
     Keycode.F21, Keycode.F22, Keycode.F23, BOTAO_MUTE_DISCORD],

    # Camada 1: Alt + F13..F21
    [Keycode.F24, (Keycode.ALT, Keycode.F13), (Keycode.ALT, Keycode.F14), "BOTAO_CAMADA",
     (Keycode.ALT, Keycode.F15), (Keycode.ALT, Keycode.F16), (Keycode.ALT, Keycode.F17), BOTAO_PLAY_PAUSE,
     (Keycode.ALT, Keycode.F18), (Keycode.ALT, Keycode.F19), (Keycode.ALT, Keycode.F20), BOTAO_MUTE_DISCORD],

    # Camada 2: Combo Alt + F21..F24
    [(Keycode.ALT, Keycode.F21), (Keycode.ALT, Keycode.F22), (Keycode.ALT, Keycode.F23), "BOTAO_CAMADA",
     (Keycode.ALT, Keycode.F24), (Keycode.CONTROL, Keycode.F13), (Keycode.CONTROL, Keycode.F14), BOTAO_PLAY_PAUSE,
     (Keycode.CONTROL, Keycode.F15), (Keycode.CONTROL, Keycode.F16), (Keycode.CONTROL, Keycode.F17), BOTAO_MUTE_DISCORD],

    # Camada 3: Ctrl + Shift + F15..F23
    [(Keycode.CONTROL, Keycode.SHIFT, Keycode.F15), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F16), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F17), "BOTAO_CAMADA",
     (Keycode.CONTROL, Keycode.SHIFT, Keycode.F18), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F19), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F20), BOTAO_PLAY_PAUSE,
     (Keycode.CONTROL, Keycode.SHIFT, Keycode.F21), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F22), (Keycode.CONTROL, Keycode.SHIFT, Keycode.F23), BOTAO_MUTE_DISCORD]
]

def formatar_tecla(tecla, key_number):
    if key_number == 3:
        return "Mudar Camada"
    if key_number == 7:
        return "Play / Pause"
    if key_number == 11:
        return "Mute / Desmute"

    if config_ativa and "layers" in config_ativa and camada_atual < len(config_ativa["layers"]):
        keys_dict = config_ativa["layers"][camada_atual].get("keys", {})
        k_data = keys_dict.get(str(key_number)) or keys_dict.get(key_number)
        if k_data and isinstance(k_data, dict):
            if k_data.get("label"):
                return k_data["label"]
            tipo = k_data.get("type")
            val = k_data.get("value")
            if tipo == "macro":
                return k_data.get("name") or "Macro"
            if tipo == "url":
                val_s = str(val or "")
                clean_url = val_s.replace("https://", "").replace("http://", "").replace("www.", "")
                return f"URL: {clean_url[:12]}"
            if tipo == "fixed" and str(val) == "layer-switch":
                return "Mudar Camada"
            if tipo == "media":
                media_nomes = {
                    'play_pause': 'Play/Pause', 'stop': 'Stop', 'prev': 'Anterior',
                    'next': 'Proxima', 'volume_up': 'Vol +', 'volume_down': 'Vol -', 'mute': 'Mute'
                }
                return media_nomes.get(str(val), str(val))
            if tipo == "mouse":
                mouse_nomes = {
                    'click_left': 'Clique Esq', 'click_right': 'Clique Dir', 'click_middle': 'Clique Meio',
                    'scroll_up': 'Scroll Cima', 'scroll_down': 'Scroll Baixo'
                }
                return mouse_nomes.get(str(val), str(val))
            if tipo == "combo" and isinstance(val, list):
                return " + ".join(str(v) for v in val)
            if tipo == "key" and val:
                return str(val)
            if val:
                return str(val)

    nomes = {
        Keycode.F13: "F13", Keycode.F14: "F14", Keycode.F15: "F15",
        Keycode.F16: "F16", Keycode.F17: "F17", Keycode.F18: "F18",
        Keycode.F19: "F19", Keycode.F20: "F20", Keycode.F21: "F21",
        Keycode.F22: "F22", Keycode.F23: "F23", Keycode.F24: "F24",
        Keycode.ALT: "Alt", Keycode.CONTROL: "Ctrl", Keycode.SHIFT: "Shift",
        Keycode.GUI: "Win"
    }
    if isinstance(tecla, (tuple, list)):
        return " + ".join(nomes.get(k, str(k)) for k in tecla)
    return nomes.get(tecla, str(tecla))

def obter_dados_tecla(camada_idx, key_number):
    if config_ativa and "layers" in config_ativa and camada_idx < len(config_ativa["layers"]):
        keys_dict = config_ativa["layers"][camada_idx].get("keys", {})
        k_data = keys_dict.get(str(key_number)) or keys_dict.get(key_number)
        if isinstance(k_data, dict):
            return k_data
    return None

def obter_nome_acao(item_acao, default=""):
    if not item_acao:
        return default
    if isinstance(item_acao, dict):
        if item_acao.get("label"):
            return item_acao["label"]
        tipo = item_acao.get("type", "key")
        val = item_acao.get("value")
        if tipo == "macro":
            return item_acao.get("name") or "Macro"
        if isinstance(val, list):
            return " + ".join(str(v) for v in val)
        return str(val) if val else str(tipo or default)
    if isinstance(item_acao, list):
        return " + ".join(str(v) for v in item_acao)
    return str(item_acao)

def abrir_url_hid(url_val):
    app_conectado = False
    if TEM_SUPERVISOR:
        try:
            app_conectado = bool(supervisor.runtime.serial_connected)
        except:
            pass
    if not app_conectado and url_val and teclado_layout:
        if not url_val.startswith("http://") and not url_val.startswith("https://"):
            url_val = "https://" + url_val
        try:
            teclado.press(Keycode.GUI, Keycode.R)
            time.sleep(0.08)
            teclado.release_all()
            time.sleep(0.18)
            teclado_layout.write(url_val)
            time.sleep(0.05)
            teclado.press(Keycode.ENTER)
            time.sleep(0.05)
            teclado.release_all()
            print(f"[URL HID] Aberto nativamente: {url_val}")
        except Exception as e:
            print(f"[URL HID ERRO] {e}")

def executar_macro(macro_id):
    """Executa nativamente os eventos gravados da macro via USB HID Keyboard."""
    if not config_ativa:
        return
    macros = config_ativa.get("macros", [])
    macro_encontrada = None
    for m in macros:
        if m.get("id") == macro_id:
            macro_encontrada = m
            break
    if not macro_encontrada:
        print(f"[MACRO AVISO] Macro {macro_id} nao encontrada no config.json")
        return

    nome = macro_encontrada.get("name", "Macro")
    eventos = macro_encontrada.get("events", [])
    mostrar_acao_oled("MACRO", nome[:18], duracao=1.5, icone='custom')
    print(f"[SERIAL] MACRO: {nome} ({len(eventos)} eventos)")

    mapa_macro_kc = {
        'CTRL': Keycode.CONTROL, 'CONTROL': Keycode.CONTROL,
        'ALT': Keycode.ALT, 'SHIFT': Keycode.SHIFT,
        'WIN': Keycode.GUI, 'GUI': Keycode.GUI,
        'ENTER': Keycode.ENTER, 'TAB': Keycode.TAB, 'ESC': Keycode.ESCAPE,
        'ESCAPE': Keycode.ESCAPE, 'SPACE': Keycode.SPACE, 'ESPACO': Keycode.SPACE,
        'BACKSPACE': Keycode.BACKSPACE, 'DELETE': Keycode.DELETE, 'DEL': Keycode.DELETE,
        'UP': Keycode.UP_ARROW, 'DOWN': Keycode.DOWN_ARROW,
        'LEFT': Keycode.LEFT_ARROW, 'RIGHT': Keycode.RIGHT_ARROW,
        'PAGE_UP': Keycode.PAGE_UP, 'PAGE_DOWN': Keycode.PAGE_DOWN,
        'HOME': Keycode.HOME, 'END': Keycode.END, 'INSERT': Keycode.INSERT,
        'CAPS_LOCK': Keycode.CAPS_LOCK, 'PRINT_SCREEN': Keycode.PRINT_SCREEN,
        'F1': Keycode.F1, 'F2': Keycode.F2, 'F3': Keycode.F3, 'F4': Keycode.F4,
        'F5': Keycode.F5, 'F6': Keycode.F6, 'F7': Keycode.F7, 'F8': Keycode.F8,
        'F9': Keycode.F9, 'F10': Keycode.F10, 'F11': Keycode.F11, 'F12': Keycode.F12,
        'F13': Keycode.F13, 'F14': Keycode.F14, 'F15': Keycode.F15,
        'F16': Keycode.F16, 'F17': Keycode.F17, 'F18': Keycode.F18,
        'F19': Keycode.F19, 'F20': Keycode.F20, 'F21': Keycode.F21,
        'F22': Keycode.F22, 'F23': Keycode.F23, 'F24': Keycode.F24,
    }
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        mapa_macro_kc[c] = getattr(Keycode, c)
    for num_str, kc_attr in [("0", "ZERO"), ("1", "ONE"), ("2", "TWO"), ("3", "THREE"),
                             ("4", "FOUR"), ("5", "FIVE"), ("6", "SIX"), ("7", "SEVEN"),
                             ("8", "EIGHT"), ("9", "NINE")]:
        mapa_macro_kc[num_str] = getattr(Keycode, kc_attr)

    for ev in eventos:
        k_str = str(ev.get("key", "")).strip().upper()
        ev_type = ev.get("type", "down")
        delay_ms = ev.get("delay", 0)
        if delay_ms and delay_ms > 0:
            time.sleep(min(delay_ms / 1000.0, 1.0))

        kc = mapa_macro_kc.get(k_str)
        if kc is not None:
            try:
                if ev_type == "down":
                    teclado.press(kc)
                elif ev_type == "up":
                    teclado.release(kc)
            except Exception:
                pass
        else:
            if len(k_str) == 1 and ev_type == "down":
                if teclado_layout:
                    try:
                        teclado_layout.write(ev.get("key"))
                    except:
                        pass
    try:
        teclado.release_all()
    except:
        pass

def executar_acao_generica(acao):
    """Executa atalhos de teclado, macros, midia, mouse, URLs ou comandos de camada."""
    if not acao:
        return
    
    if isinstance(acao, dict):
        tipo = acao.get("type", "key")
        val = acao.get("value")
        if tipo in ("combo", "key"):
            if isinstance(val, list):
                executar_atalho_string("+".join(str(v) for v in val))
            elif val:
                executar_atalho_string(str(val))
            return
        elif tipo == "macro":
            executar_macro(val)
            return
        elif tipo == "media":
            executar_acao_generica(str(val))
            return
        elif tipo == "mouse":
            executar_acao_generica(str(val))
            return
        elif tipo == "fixed":
            if str(val) == "layer-switch":
                total_c = len(config_ativa.get("layers", [])) if config_ativa else 4
                prox_c = (camada_atual + 1) % max(1, total_c)
                animar_troca_camada(prox_c, direcao=1)
            return
        elif tipo == "url":
            abrir_url_hid((val or "").strip())
            return
        elif val:
            executar_acao_generica(val)
            return

    if isinstance(acao, list):
        executar_atalho_string("+".join(str(v) for v in acao))
        return

    # Se for string simples
    if isinstance(acao, str):
        acao_upper = acao.upper().strip()
        # Funcoes de Midia
        if acao_upper in ('PLAY_PAUSE', 'PLAY', 'PAUSE'):
            consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE)
            return
        elif acao_upper in ('NEXT_TRACK', 'PROXIMA', 'PROXIMA_FAIXA'):
            consumer_ctrl.send(ConsumerControlCode.SCAN_NEXT_TRACK)
            return
        elif acao_upper in ('PREV_TRACK', 'ANTERIOR', 'FAIXA_ANTERIOR'):
            consumer_ctrl.send(ConsumerControlCode.SCAN_PREVIOUS_TRACK)
            return
        elif acao_upper in ('VOL_UP', 'VOLUME_UP', 'VOLUME_MAIS'):
            consumer_ctrl.send(ConsumerControlCode.VOLUME_INCREMENT)
            return
        elif acao_upper in ('VOL_DOWN', 'VOLUME_DOWN', 'VOLUME_MENOS'):
            consumer_ctrl.send(ConsumerControlCode.VOLUME_DECREMENT)
            return
        elif acao_upper in ('MUTE', 'MUDO'):
            consumer_ctrl.send(ConsumerControlCode.MUTE)
            return

        # Funcoes de Mouse
        elif acao_upper in ('MOUSE_LEFT', 'CLICK_LEFT'):
            mouse.click(Mouse.LEFT_BUTTON)
            return
        elif acao_upper in ('MOUSE_RIGHT', 'CLICK_RIGHT'):
            mouse.click(Mouse.RIGHT_BUTTON)
            return
        elif acao_upper in ('MOUSE_MIDDLE', 'CLICK_MIDDLE'):
            mouse.click(Mouse.MIDDLE_BUTTON)
            return
        elif acao_upper in ('MOUSE_WHEEL_UP', 'SCROLL_UP'):
            mouse.move(wheel=1)
            return
        elif acao_upper in ('MOUSE_WHEEL_DOWN', 'SCROLL_DOWN'):
            mouse.move(wheel=-1)
            return

        # Funcoes de Camada
        elif acao_upper == 'LAYER-SWITCH':
            total_c = len(config_ativa.get("layers", [])) if config_ativa else 4
            prox_c = (camada_atual + 1) % max(1, total_c)
            animar_troca_camada(prox_c, direcao=1)
            return

    executar_atalho_string(str(acao))

def executar_atalho_string(texto):
    if not texto:
        return
    partes = [p.strip().upper() for p in texto.split("+")]
    mapa_kc = {
        'CTRL': Keycode.CONTROL, 'CONTROL': Keycode.CONTROL,
        'ALT': Keycode.ALT, 'SHIFT': Keycode.SHIFT,
        'WIN': Keycode.GUI, 'GUI': Keycode.GUI,
        'C': Keycode.C, 'V': Keycode.V, 'Z': Keycode.Z, 'Y': Keycode.Y,
        'A': Keycode.A, 'X': Keycode.X, 'S': Keycode.S, 'W': Keycode.W,
        'T': Keycode.T, 'R': Keycode.R, 'F': Keycode.F, 'D': Keycode.D,
        'ENTER': Keycode.ENTER, 'TAB': Keycode.TAB, 'ESC': Keycode.ESCAPE,
        'SPACE': Keycode.SPACE, 'ESPACO': Keycode.SPACE,
        'UP': Keycode.UP_ARROW, 'DOWN': Keycode.DOWN_ARROW,
        'LEFT': Keycode.LEFT_ARROW, 'RIGHT': Keycode.RIGHT_ARROW,
        'F1': Keycode.F1, 'F2': Keycode.F2, 'F3': Keycode.F3, 'F4': Keycode.F4,
        'F5': Keycode.F5, 'F6': Keycode.F6, 'F7': Keycode.F7, 'F8': Keycode.F8,
        'F9': Keycode.F9, 'F10': Keycode.F10, 'F11': Keycode.F11, 'F12': Keycode.F12,
        'F13': Keycode.F13, 'F14': Keycode.F14, 'F15': Keycode.F15,
        'F16': Keycode.F16, 'F17': Keycode.F17, 'F18': Keycode.F18,
        'F19': Keycode.F19, 'F20': Keycode.F20, 'F21': Keycode.F21,
        'F22': Keycode.F22, 'F23': Keycode.F23, 'F24': Keycode.F24
    }
    codes = [mapa_kc[p] for p in partes if p in mapa_kc]
    if codes:
        try:
            teclado.press(*codes)
            time.sleep(0.01)
            teclado.release(*codes)
        except Exception:
            pass

# =====================================================================
# 5. CONTROLE DO ZOOM ROBUSTO (SEM DESLIZAMENTO DE SCROLL)
# =====================================================================
tempo_soltar_alt_zoom = 0.0
alt_zoom_pressionado = False

# =====================================================================
# 6. EXECUCAO DE ACOES DO ENCODER POR CAMADA
# =====================================================================
def executar_encoder(direcao):
    global tempo_soltar_alt_zoom, alt_zoom_pressionado, nivel_volume, nivel_brilho, nivel_zoom, nivel_scroll, vol_mudo
    nome_l, perfil_l, fn, custom_cw, custom_ccw, _ = obter_info_camada(camada_atual)
    step_cw, step_ccw = obter_passos_funcao(fn, camada_atual)
    dir_str = "CW" if direcao > 0 else "CCW"
    print(f"[SERIAL] ENCODER {dir_str} | Camada {camada_atual} | Funcao: {fn} (Passo: +{step_cw}/-{step_ccw})")

    if fn == 'volume':
        if direcao > 0:
            for _ in range(step_cw):
                consumer_ctrl.send(ConsumerControlCode.VOLUME_INCREMENT)
                time.sleep(0.004)
            nivel_volume = min(100, nivel_volume + step_cw * 2)
            vol_mudo = False
        else:
            for _ in range(step_ccw):
                consumer_ctrl.send(ConsumerControlCode.VOLUME_DECREMENT)
                time.sleep(0.004)
            nivel_volume = max(0, nivel_volume - step_ccw * 2)
            vol_mudo = False
        mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')
        print(f"[SERIAL] OSD_BAR|volume|{nivel_volume}")

    elif fn == 'brightness':
        if direcao > 0:
            for _ in range(step_cw):
                try:
                    consumer_ctrl.send(ConsumerControlCode.BRIGHTNESS_INCREMENT)
                    time.sleep(0.004)
                except Exception:
                    pass
            nivel_brilho = min(100, nivel_brilho + step_cw * 5)
        else:
            for _ in range(step_ccw):
                try:
                    consumer_ctrl.send(ConsumerControlCode.BRIGHTNESS_DECREMENT)
                    time.sleep(0.004)
                except Exception:
                    pass
            nivel_brilho = max(0, nivel_brilho - step_ccw * 5)
        mostrar_barra_oled("BRILHO", f"{nivel_brilho}%", nivel_brilho, icone='brightness')
        print(f"[SERIAL] OSD_BAR|brightness|{nivel_brilho}")

    elif fn == 'zoom':
        if not alt_zoom_pressionado:
            teclado.press(Keycode.ALT)
            time.sleep(0.012)
            alt_zoom_pressionado = True

        wheel_amt = step_cw if direcao > 0 else -step_ccw
        mouse.move(wheel=wheel_amt)
        tempo_soltar_alt_zoom = time.monotonic() + 0.20

        if direcao > 0:
            nivel_zoom = min(300, nivel_zoom + step_cw * 10)
        else:
            nivel_zoom = max(20, nivel_zoom - step_ccw * 10)

        pct_zoom = int(round(((nivel_zoom - 20) / (300 - 20)) * 100))
        mostrar_barra_oled("ZOOM", f"{nivel_zoom}%", pct_zoom, icone='zoom')
        print(f"[SERIAL] OSD_BAR|zoom|{nivel_zoom}")

    elif fn == 'scroll':
        if direcao > 0:
            mouse.move(wheel=-step_cw)
            nivel_scroll = min(100, nivel_scroll + step_cw * 4)
            mostrar_barra_oled("ROLAGEM", f"{nivel_scroll}%", nivel_scroll, icone='scroll')
        else:
            mouse.move(wheel=step_ccw)
            nivel_scroll = max(0, nivel_scroll - step_ccw * 4)
            mostrar_barra_oled("ROLAGEM", f"{nivel_scroll}%", nivel_scroll, icone='scroll')
        print(f"[SERIAL] OSD_BAR|scroll|{nivel_scroll}")

    elif fn == 'video':
        if direcao > 0:
            for _ in range(step_cw):
                teclado.press(Keycode.RIGHT_ARROW)
                time.sleep(0.01)
                teclado.release(Keycode.RIGHT_ARROW)
                time.sleep(0.005)
            mostrar_acao_oled("VIDEO", f"AVANCAR >> ({step_cw})", icone='video')
        else:
            for _ in range(step_ccw):
                teclado.press(Keycode.LEFT_ARROW)
                time.sleep(0.01)
                teclado.release(Keycode.LEFT_ARROW)
                time.sleep(0.005)
            mostrar_acao_oled("VIDEO", f"<< VOLTAR ({step_ccw})", icone='video')

    elif fn == 'media':
        if direcao > 0:
            consumer_ctrl.send(ConsumerControlCode.SCAN_NEXT_TRACK)
            mostrar_acao_oled("MIDIA", "PROXIMA FAIXA >>", icone='media')
        else:
            consumer_ctrl.send(ConsumerControlCode.SCAN_PREVIOUS_TRACK)
            mostrar_acao_oled("MIDIA", "<< FAIXA ANTERIOR", icone='media')

    elif fn == 'layer_nav':
        total_camadas = len(config_ativa["layers"]) if config_ativa and "layers" in config_ativa else 4
        total_camadas = max(1, total_camadas)
        if direcao > 0:
            prox_c = (camada_atual + 1) % total_camadas
            animar_troca_camada(prox_c, direcao=1)
            print(f"[SERIAL] Mudou para Camada {camada_atual}")
        else:
            prox_c = (camada_atual - 1 + total_camadas) % total_camadas
            animar_troca_camada(prox_c, direcao=-1)
            print(f"[SERIAL] Mudou para Camada {camada_atual}")

    elif fn == 'custom':
        acao = custom_cw if direcao > 0 else custom_ccw
        rotulo = str(acao) if acao else ("ATALHO CW" if direcao > 0 else "ATALHO CCW")
        executar_acao_generica(acao)
        mostrar_acao_oled("CUSTOM >" if direcao > 0 else "< CUSTOM", rotulo[:18], icone='custom')

    else:
        # Funcao personalizada generica ou fallback
        acao = custom_cw if direcao > 0 else custom_ccw
        if acao:
            executar_acao_generica(acao)
            mostrar_acao_oled(fn.upper()[:12], str(acao)[:18], icone='custom')
        else:
            if direcao > 0:
                consumer_ctrl.send(ConsumerControlCode.VOLUME_INCREMENT)
                nivel_volume = min(100, nivel_volume + step_cw * 2)
                mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')
            else:
                consumer_ctrl.send(ConsumerControlCode.VOLUME_DECREMENT)
                nivel_volume = max(0, nivel_volume - step_ccw * 2)
                mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')

def executar_encoder_click():
    global vol_mudo, nivel_volume, nivel_brilho, nivel_zoom, nivel_scroll
    nome_l, perfil_l, fn, _, _, custom_press = obter_info_camada(camada_atual)
    print(f"[SERIAL] ENCODER CLICK | Camada {camada_atual} | Funcao: {fn}")

    if fn == 'volume':
        consumer_ctrl.send(ConsumerControlCode.MUTE)
        vol_mudo = not vol_mudo
        if vol_mudo:
            mostrar_barra_oled("VOLUME", "MUDO", 0, icone='mute')
            print(f"[SERIAL] OSD_BAR|volume|0")
        else:
            mostrar_barra_oled("VOLUME", f"{nivel_volume}%", nivel_volume, icone='volume')
            print(f"[SERIAL] OSD_BAR|volume|{nivel_volume}")

    elif fn == 'brightness':
        nivel_brilho = 70
        mostrar_barra_oled("BRILHO", "70%", 70, icone='brightness')
        print(f"[SERIAL] OSD_BAR|brightness|70")

    elif fn == 'zoom':
        teclado.press(Keycode.CONTROL, Keycode.ZERO)
        time.sleep(0.01)
        teclado.release(Keycode.CONTROL, Keycode.ZERO)
        nivel_zoom = 100
        pct_zoom = int(round(((100 - 20) / (300 - 20)) * 100))
        mostrar_barra_oled("ZOOM", "100%", pct_zoom, icone='zoom')
        print(f"[SERIAL] OSD_BAR|zoom|100")

    elif fn == 'video':
        consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE)
        mostrar_acao_oled("VIDEO", "PLAY / PAUSE", icone='video')

    elif fn == 'media':
        consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE)
        mostrar_acao_oled("MIDIA", "PLAY / PAUSE", icone='media')

    elif fn == 'scroll':
        mouse.click(Mouse.MIDDLE_BUTTON)
        nivel_scroll = 50
        mostrar_barra_oled("ROLAGEM", "50%", 50, icone='scroll')
        print(f"[SERIAL] OSD_BAR|scroll|50")

    elif fn == 'layer_nav':
        if camada_atual != 0:
            animar_troca_camada(0, direcao=-1)
            print(f"[SERIAL] Mudou para Camada 0")
        else:
            mostrar_acao_oled("CAMADA 0", "PRIMEIRA CAMADA", icone='layer_nav')

    elif fn == 'custom':
        if custom_press:
            executar_acao_generica(custom_press)
            mostrar_acao_oled("CUSTOM CLICK", str(custom_press)[:18], icone='custom')
        else:
            consumer_ctrl.send(ConsumerControlCode.MUTE)
            mostrar_acao_oled("CLIQUE", "MUTE", icone='custom')

    else:
        if custom_press:
            executar_acao_generica(custom_press)
            mostrar_acao_oled(fn.upper()[:12], str(custom_press)[:18], icone='custom')
        else:
            consumer_ctrl.send(ConsumerControlCode.MUTE)
            mostrar_acao_oled("CLIQUE", "MUTE")

print("[INFO] PadPRO firmware iniciado e pronto!")
executar_animacao_boot()
atualizar_oled_padrao(camada_atual)

# =====================================================================
# 7. CONTROLE DE EVENTOS & LOOP PRINCIPAL
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

        # A. Liberacao segura do Alt do Zoom (previne scroll indesejado)
        if alt_zoom_pressionado and agora >= tempo_soltar_alt_zoom:
            teclado.release(Keycode.ALT)
            alt_zoom_pressionado = False

        # B. Timeout do display OLED (retorna a tela padrao com dots da camada)
        if tempo_reset_oled > 0.0 and agora >= tempo_reset_oled:
            tempo_reset_oled = 0.0
            anim_som_ativa = False
            atualizar_oled_padrao(camada_atual)

        # B2. Animacao continua do alto-falante de som (quando tocando)
        if anim_som_ativa and (agora - anim_som_ultimo_tempo >= 0.11):
            anim_som_ultimo_tempo = agora
            anim_som_frame = (anim_som_frame + 1) % len(BMP_ANIM_SPEAKER)
            if icone_grid:
                icone_grid.bitmap = BMP_ANIM_SPEAKER[anim_som_frame]

        # C. Leitura do Rotary Encoder Buxton (Prioridade Maxima)
        if TEM_ENCODER and encoder:
            dir_giro = encoder.ler()
            if dir_giro != 0:
                executar_encoder(dir_giro)

        # D. Leitura do Clique do Encoder
        if TEM_ENCODER and botao_encoder:
            pressionado_sw = not botao_encoder.value
            if pressionado_sw != estado_anterior_sw:
                estado_anterior_sw = pressionado_sw
                if pressionado_sw:
                    executar_encoder_click()

        # E. Comandos seriais recebidos do PC (Sincronizacao em Tempo Real)
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
                            if val_str.isdigit() or (val_str.startswith('-') and val_str[1:].isdigit()):
                                prox_c = max(0, int(val_str))
                                if prox_c != camada_atual:
                                    animar_troca_camada(prox_c, direcao=1 if prox_c > camada_atual else -1)
                                else:
                                    atualizar_oled_padrao(camada_atual)
                                print(f"[SERIAL] Camada sincronizada: {camada_atual}")
                        except Exception as e:
                            print(f"[SERIAL ERRO] SET_LAYER: {e}")

                    elif cmd_upper.startswith("SET_ENCODER:"):
                        # Formato: SET_ENCODER:<camada>:<funcao>:<cw>:<ccw>:<press>:<step_cw>:<step_ccw>
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
                            # Formato: SET_OLED_CUSTOM:<show_divider 0/1>:<show_icons 0/1>:<show_dots 0/1>:<timeout>:<show_animations 0/1>
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
                        executar_animacao_boot()
                        atualizar_oled_padrao(camada_atual)

                    elif cmd_upper in ("OLED:UPDATING", "TEST_UPDATING"):
                        animar_engrenagem_atualizando(passos=16)
                        atualizar_oled_padrao(camada_atual)

                    elif cmd_upper in ("CONFIG_UPDATED", "RELOAD_CONFIG"):
                        animar_engrenagem_atualizando(passos=8)
                        carregar_config()
                        atualizar_oled_padrao(camada_atual)

                    elif cmd_upper == "OLED:RESET":
                        tempo_reset_oled = 0.0
                        parar_animacao_som()
                        atualizar_oled_padrao(camada_atual)

                    elif cmd_upper.startswith("OLED:TOCANDO SOM"):
                        parts = cmd[5:].split("|")
                        nome_som = parts[1] if len(parts) > 1 else "SOUNDPAD"
                        iniciar_animacao_som(nome_som, duracao=0)

                    elif cmd_upper.startswith("OLED:ESPIAR SOM"):
                        parts = cmd[5:].split("|")
                        nome_som = parts[1] if len(parts) > 1 else "SOUNDPAD"
                        iniciar_animacao_som(nome_som, duracao=2.5)

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
                        mostrar_barra_oled(titulo_bar, f"{pct_bar}%", pct_bar, icone=icone_bar, duracao=dur_bar)

                    elif cmd_upper.startswith("OLED:"):
                        parts = cmd[5:].split("|")
                        l1 = parts[0] if len(parts) > 0 else ""
                        l2 = parts[1] if len(parts) > 1 else ""
                        dur = float(parts[2]) if len(parts) > 2 else 2.0
                        mostrar_acao_oled(l1, l2, duracao=dur)

                    elif cmd_upper in ("PING", "STATUS", "?"):
                        print(f"[HUD] Camada {camada_atual}")
                        print(f"[SERIAL] STATUS Camada: {camada_atual}")
                else:
                    serial_buffer += ch
                    if len(serial_buffer) > 128:
                        serial_buffer = ""

        # F. Varredura da Matriz de Teclas (Standalone + Som Soundpad + Dupla Funcao)
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
                    # Tecla com dupla função: feedback imediato no OLED
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
                    if hold_executado[key_number]:
                        # Clique longo ja foi executado enquanto segurava; nao dispara clique rapido
                        pass
                    elif preview_disparado[key_number]:
                        # Espiar soundpad ja disparou
                        pass
                    else:
                        # TOQUE RAPIDO (Dispara acao principal):
                        print(f"[SERIAL] Botao {key_number}: {nome_acao} | Camada {camada_atual}")
                        if k_data:
                            executar_acao_generica(k_data)
                        else:
                            if isinstance(tecla_pressionada, (tuple, list)):
                                teclado.press(*tecla_pressionada)
                                time.sleep(0.01)
                                teclado.release(*tecla_pressionada)
                            else:
                                teclado.press(tecla_pressionada)
                                time.sleep(0.01)
                                teclado.release(tecla_pressionada)

                print(f"[SERIAL] UP Botao {key_number} | Camada {camada_atual}")

        # G. Checagem de Long Press (Clique Longo de Dupla Funcao OU Preview Soundpad)
        for k in range(12):
            if k != 3 and tecla_segurada[k] and not hold_executado[k] and not preview_disparado[k]:
                if agora - tempo_inicio_tecla[k] >= TEMPO_PREVIEW:
                    k_data = obter_dados_tecla(camada_atual, k)
                    if k_data and k_data.get("holdAction") and k_data.get("holdAction") != "none":
                        # CLIQUE LONGO DISPARADO!
                        hold_executado[k] = True
                        acao_hold = k_data["holdAction"]
                        nome_hold = obter_nome_acao(acao_hold, "Clique Longo")
                        print(f"[SERIAL] HOLD Botao {k}: {nome_hold} | Camada {camada_atual}")
                        mostrar_acao_oled("CLIQUE LONGO", nome_hold[:18], duracao=2.0)
                        executar_acao_generica(acao_hold)
                    else:
                        # Espiar Soundpad apenas se NAO tiver dupla funcao
                        preview_disparado[k] = True
                        tecla_pressionada = mapa_ativo[k]
                        nome_acao = formatar_tecla(tecla_pressionada, k)
                        som_titulo = obter_titulo_som(nome_acao)
                        print(f"[SERIAL] PREVIEW Botao {k}: {nome_acao} | Camada {camada_atual}")
                        if som_titulo:
                            iniciar_animacao_som(som_titulo, duracao=2.5)
                        else:
                            mostrar_acao_oled("ESPIAR SOUNDPAD", nome_acao, duracao=2.5)

        # H. Heartbeat periodico
        if agora - ultimo_heartbeat >= 3.5:
            ultimo_heartbeat = agora
            print(f"[HEARTBEAT] Camada {camada_atual} | GP13(A)={int(encoder.a.value)} GP11(B)={int(encoder.b.value)} GP12(SW)={int(botao_encoder.value)}")

    except Exception as e:
        print(f"[ERRO] Loop: {e}")
