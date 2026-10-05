import displayio
import gc

# 1. Hexadecimal do Logo Oficial PadPro (128x32)
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

# 2. Hexadecimal do texto "Atualizando..." (w=88, h=7)
UPDATING_TEXT_HEX = {
    0: '0000000000000000300000',
    1: '07870000fc000000300000',
    2: '0fcf73fcffffefe3f3f000',
    3: '0ccf73fefffbffe7f7f800',
    4: '1fe773fefce3fe7e371800',
    5: '1fe777eefdc77e7e773800',
    6: '3877bffefffffe77f3f7e0'
}

# 3. 6 frames da engrenagem 24x24
GEAR_ANIM_HEX = [
    ['000000', '003e00', '007e00', '007e00', '00ff00', '1ffffc', '3ffffc', '3ffffe', '7ffffe', '7fc3fe', '3f81fc', '1f80f8', '1f00f8', '1f00f8', '1f80fc', '3f81fe', '7fe3fe', '7ffffe', '3ffffe', '3ffffc', '19ff98', '007f00', '007e00', '007e00'],
    ['000000', '00f800', '00f800', '01fe08', '00fff8', '01fffc', '1ffffc', '3ffffc', '7ffffc', '7fc3f8', '7f80f8', '7f80f8', '3f80fc', '1f00fe', '1f01ff', '1fc1ff', '0ff1ff', '1ffffe', '3ffffc', '3fffc8', '1fffc0', '065f80', '001f80', '001f00'],
    ['000000', '006000', '03f020', '03f9f0', '03fff8', '03fff8', '03fff8', '0ffff8', '7ffff0', '7fc3f8', '7f80f8', '7f80ff', 'ff80ff', '7f007f', '1f80ff', '0fc1ff', '0fdbfe', '0ffff6', '0ffff0', '1fffe0', '1fffc0', '07bfe0', '0707c0', '000600'],
    ['000000', '008080', '03c3e0', '07f7f0', '07fff0', '07fff0', '07fff0', '07fff0', '0ffff0', '3fc1fe', '7f80ff', '7f80ff', '7f807f', '7f80ff', '7f80ff', '7fa0ff', '0febf0', '07fff0', '07fff0', '07fff0', '07fff0', '07fff0', '05c1c0', '01c100'],
    ['000000', '000340', '030fc0', '079fe0', '0fffe0', '0fffc0', '1fffe0', '0ffffa', '0ffffe', '0fc1ff', '1f80ff', '3f807f', '7f80ff', '7f80ff', '7f8078', '3fc0f8', '7ff7f8', '07fff8', '03fff8', '01fffc', '01fff8', '01fee0', '03f040', '017000'],
    ['000400', '000f80', '001f80', '063f80', '0fff80', '1fffc0', '3ffffe', '1fffff', '1fffff', '0fc1ff', '0f80ff', '1f80ff', '3f807c', '3f807c', '7fc0fc', '7fc2fc', '3ffffc', '3ffffe', '1bfffc', '01fff8', '00fff8', '00fc10', '00fc00', '007c00']
]

# 4. Icones 10x10 compactos (bitmasks de 10 bytes)
ICONES_BITS = {
    'volume': [0x00, 0x10, 0x18, 0x1C, 0x9C, 0x9C, 0x1C, 0x18, 0x10, 0x00],
    'mute':   [0x00, 0x11, 0x1A, 0x1C, 0x98, 0x98, 0x1C, 0x1A, 0x11, 0x00],
    'brightness': [0x10, 0x92, 0x7C, 0xFE, 0xFE, 0xFE, 0x7C, 0x92, 0x10, 0x00],
    'zoom':   [0x78, 0x84, 0xCC, 0xCC, 0x84, 0x7E, 0x02, 0x01, 0x00, 0x00],
    'scroll': [0x3C, 0x4A, 0x4A, 0x4A, 0x42, 0x42, 0x42, 0x3C, 0x0C, 0x00],
    'media':  [0x1C, 0x12, 0x12, 0x12, 0x32, 0x77, 0x77, 0x33, 0x00, 0x00],
    'video':  [0xFF, 0x99, 0xFF, 0x89, 0x99, 0xB9, 0x99, 0x89, 0xFF, 0x00],
    'custom': [0x3C, 0x42, 0xBD, 0xA5, 0xA5, 0xBD, 0x42, 0x3C, 0x00, 0x00],
    'layer_nav': [0x1E, 0x22, 0x7F, 0x22, 0x7F, 0x22, 0x7F, 0x00, 0x00, 0x00]
}

SPEAKER_FRAMES_BITS = [
    [0x00, 0x10, 0x30, 0x70, 0xF0, 0xF0, 0x70, 0x30, 0x10, 0x00],
    [0x00, 0x10, 0x34, 0x72, 0xF2, 0xF2, 0x72, 0x34, 0x10, 0x00],
    [0x00, 0x12, 0x35, 0x75, 0xF5, 0xF5, 0x75, 0x35, 0x12, 0x00],
    [0x12, 0x15, 0x35, 0x75, 0xF5, 0xF5, 0x75, 0x35, 0x15, 0x12]
]

CHECK_BITS = [0x01, 0x03, 0x06, 0x06, 0x98, 0xD8, 0x70, 0x20, 0x00, 0x00]

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

def criar_bmp_bits(linhas_int, w=10, h=10):
    bmp = displayio.Bitmap(w, h, 2)
    for y, row in enumerate(linhas_int):
        for x in range(w):
            if row & (1 << (w - 1 - x)):
                bmp[x, y] = 1
    return bmp

def carregar_todos_assets():
    global BOOT_LOGO_HEX, UPDATING_TEXT_HEX, GEAR_ANIM_HEX, ICONES_BITS, SPEAKER_FRAMES_BITS, CHECK_BITS
    
    bmp_boot_logo = criar_bmp_de_hex(BOOT_LOGO_HEX, 128, 32)
    bmp_updating_text = criar_bmp_de_hex(UPDATING_TEXT_HEX, 88, 7)
    bmp_gear_anim = [criar_bmp_de_hex(f, 24, 24) for f in GEAR_ANIM_HEX]
    
    bmp_cache = {}
    for k, b_list in ICONES_BITS.items():
        bmp_cache[k] = criar_bmp_bits(b_list, 10, 10)
        
    bmp_anim_speaker = [criar_bmp_bits(f, 10, 10) for f in SPEAKER_FRAMES_BITS]
    bmp_check = criar_bmp_bits(CHECK_BITS, 10, 10)

    # Limpeza total da memoria RAM dos dados brutos
    BOOT_LOGO_HEX = None
    UPDATING_TEXT_HEX = None
    GEAR_ANIM_HEX = None
    ICONES_BITS = None
    SPEAKER_FRAMES_BITS = None
    CHECK_BITS = None
    gc.collect()

    return {
        'boot_logo': bmp_boot_logo,
        'updating_text': bmp_updating_text,
        'gear_anim': bmp_gear_anim,
        'icons': bmp_cache,
        'speaker_anim': bmp_anim_speaker,
        'check': bmp_check
    }
