from PIL import Image

# 1. Boot Logo
im_logo = Image.open('src/assets/oled-logo.png').convert('RGBA')
w, h = im_logo.size
logo_rows = {}
for y in range(h):
    row_bytes = []
    for byte_idx in range(w // 8):
        b = 0
        for bit in range(8):
            x = byte_idx * 8 + bit
            r, g, b_val, a = im_logo.getpixel((x, y))
            if a > 100 and (r > 100 or g > 100 or b_val > 100):
                b |= (1 << (7 - bit))
        row_bytes.append(b)
    hex_str = ''.join([f'{b:02x}' for b in row_bytes])
    if hex_str.replace('0', ''):
        logo_rows[y] = hex_str

# 2. Updating Screen - Text part (x=36..123, w=88, y=12..18, h=7)
im_up = Image.open('src/assets/oled-updating.png').convert('RGBA')
text_rows = {}
for y in range(12, 19):
    row_bytes = []
    for byte_idx in range(11):
        b = 0
        for bit in range(8):
            x = 36 + byte_idx * 8 + bit
            if x < im_up.width:
                r, g, b_val, a = im_up.getpixel((x, y))
                if a > 100 and (r > 100 or g > 100 or b_val > 100):
                    b |= (1 << (7 - bit))
        row_bytes.append(b)
    text_rows[y - 12] = ''.join([f'{b:02x}' for b in row_bytes])

# 3. Gear (Crop 24x24: x=7..30, y=4..27)
gear = im_up.crop((7, 4, 31, 28))
gear_mono = Image.new('1', (24, 24), 0)
for y in range(24):
    for x in range(24):
        r, g, b_val, a = gear.getpixel((x, y))
        if a > 100 and (r > 100 or g > 100 or b_val > 100):
            gear_mono.putpixel((x, y), 1)

angles = [0, 10, 20, 30, 40, 50]
gear_frames = []
for ang in angles:
    rot = gear_mono.rotate(ang, resample=Image.BICUBIC)
    frame_rows = []
    for y in range(24):
        row_bytes = []
        for byte_idx in range(3):
            b = 0
            for bit in range(8):
                x = byte_idx * 8 + bit
                if rot.getpixel((x, y)):
                    b |= (1 << (7 - bit))
            row_bytes.append(b)
        frame_rows.append(''.join([f'{b:02x}' for b in row_bytes]))
    gear_frames.append(frame_rows)

print("# --- BOOT LOGO ---")
print(f"BOOT_LOGO_HEX = {logo_rows}\n")

print("# --- UPDATING TEXT (w=88, h=7) ---")
print(f"UPDATING_TEXT_HEX = {text_rows}\n")

print("# --- GEAR FRAMES (24x24, 6 frames) ---")
print("GEAR_ANIM_HEX = [")
for f in gear_frames:
    print(f"    {f},")
print("]")
