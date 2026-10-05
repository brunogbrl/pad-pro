import time
from adafruit_hid.keycode import Keycode
from adafruit_hid.consumer_control_code import ConsumerControlCode
from adafruit_hid.mouse import Mouse

teclado = None
teclado_layout = None
consumer_ctrl = None
mouse = None
mostrar_acao_oled = None
animar_troca_camada = None
obter_config_ativa = None
obter_camada_atual = None
TEM_SUPERVISOR = False

def init(kbd, layout, cc, mse, fn_oled, fn_anim_cam, fn_cfg, fn_cam, tem_sup=False):
    global teclado, teclado_layout, consumer_ctrl, mouse, mostrar_acao_oled, animar_troca_camada, obter_config_ativa, obter_camada_atual, TEM_SUPERVISOR
    teclado = kbd
    teclado_layout = layout
    consumer_ctrl = cc
    mouse = mse
    mostrar_acao_oled = fn_oled
    animar_troca_camada = fn_anim_cam
    obter_config_ativa = fn_cfg
    obter_camada_atual = fn_cam
    TEM_SUPERVISOR = tem_sup

def abrir_url_hid(url_val):
    if not url_val or not teclado_layout:
        return
    if not url_val.startswith('http://') and not url_val.startswith('https://'):
        url_val = 'https://' + url_val
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
        print(f'[URL HID] Aberto: {url_val}')
    except Exception as e:
        print(f'[URL HID ERRO] {e}')

def abrir_app_hid(app_val):
    if not app_val or not teclado_layout:
        return
    try:
        teclado.press(Keycode.GUI, Keycode.R)
        time.sleep(0.08)
        teclado.release_all()
        time.sleep(0.18)
        teclado_layout.write(app_val)
        time.sleep(0.05)
        teclado.press(Keycode.ENTER)
        time.sleep(0.05)
        teclado.release_all()
        print(f'[APP HID] Aberto: {app_val}')
    except Exception as e:
        print(f'[APP HID ERRO] {e}')

def executar_comando_hid(cmd_val, interp='powershell'):
    if not cmd_val or not teclado_layout:
        return
    try:
        teclado.press(Keycode.GUI, Keycode.R)
        time.sleep(0.08)
        teclado.release_all()
        time.sleep(0.18)
        if interp == 'cmd':
            teclado_layout.write(f'cmd /c {cmd_val}')
        elif interp == 'python':
            teclado_layout.write(f'python -c "{cmd_val}"')
        else:
            teclado_layout.write(f'powershell -c "{cmd_val}"')
        time.sleep(0.05)
        teclado.press(Keycode.ENTER)
        time.sleep(0.05)
        teclado.release_all()
        print(f'[CMD HID] Executado: {cmd_val}')
    except Exception as e:
        print(f'[CMD HID ERRO] {e}')

MAPA_KC = {
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
}
for _c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
    MAPA_KC[_c] = getattr(Keycode, _c)
for _num_str, _kc_attr in [('0', 'ZERO'), ('1', 'ONE'), ('2', 'TWO'), ('3', 'THREE'),
                          ('4', 'FOUR'), ('5', 'FIVE'), ('6', 'SIX'), ('7', 'SEVEN'),
                          ('8', 'EIGHT'), ('9', 'NINE')]:
    MAPA_KC[_num_str] = getattr(Keycode, _kc_attr)
for _i in range(1, 25):
    MAPA_KC[f'F{_i}'] = getattr(Keycode, f'F{_i}')

def executar_atalho_string(texto):
    if not texto or not teclado:
        return
    partes = [p.strip().upper() for p in texto.split('+')]
    codes = [MAPA_KC[p] for p in partes if p in MAPA_KC]
    if codes:
        try:
            teclado.press(*codes)
            time.sleep(0.01)
            teclado.release(*codes)
        except Exception:
            try: teclado.release_all()
            except: pass

def executar_macro(macro_id):
    cfg = obter_config_ativa() if obter_config_ativa else None
    macros = cfg.get('macros', []) if cfg else []
    macro_encontrada = None
    for m in macros:
        if m.get('id') == macro_id:
            macro_encontrada = m
            break
    if not macro_encontrada:
        return

    nome = macro_encontrada.get('name', 'Macro')
    eventos = macro_encontrada.get('events', [])
    if mostrar_acao_oled:
        mostrar_acao_oled('MACRO', nome[:18], duracao=1.5, icone='custom')
    print(f'[SERIAL] MACRO: {nome}')

    for ev in eventos:
        k_str = str(ev.get('key', '')).strip().upper()
        ev_type = ev.get('type', 'down')
        delay_ms = ev.get('delay', 0)
        if delay_ms and delay_ms > 0:
            time.sleep(min(delay_ms / 1000.0, 1.0))

        kc = MAPA_KC.get(k_str)
        if kc is not None:
            try:
                if ev_type == 'down':
                    teclado.press(kc)
                elif ev_type == 'up':
                    teclado.release(kc)
            except Exception:
                pass
        else:
            if len(k_str) == 1 and ev_type == 'down' and teclado_layout:
                try: teclado_layout.write(ev.get('key'))
                except: pass
    try: teclado.release_all()
    except: pass

def executar_acao_generica(acao):
    if not acao:
        return
    if isinstance(acao, dict):
        tipo = acao.get('type', 'key')
        val = acao.get('value')
        if tipo in ('combo', 'key'):
            if isinstance(val, list):
                executar_atalho_string('+'.join(str(v) for v in val))
            elif val:
                executar_atalho_string(str(val))
            return
        elif tipo == 'macro':
            executar_macro(val)
            return
        elif tipo == 'media':
            executar_acao_generica(str(val))
            return
        elif tipo == 'mouse':
            executar_acao_generica(str(val))
            return
        elif tipo == 'fixed':
            if str(val) == 'layer-switch' and animar_troca_camada:
                cfg = obter_config_ativa() if obter_config_ativa else None
                total_c = len(cfg.get('layers', [])) if cfg else 4
                c_atual = obter_camada_atual() if obter_camada_atual else 0
                prox_c = (c_atual + 1) % max(1, total_c)
                animar_troca_camada(prox_c, direcao=1)
            return
        elif tipo == 'url':
            abrir_url_hid((val or '').strip())
            return
        elif tipo == 'app':
            abrir_app_hid(str(val or acao.get('path') or '').strip())
            return
        elif tipo == 'command':
            cmd_val = str(acao.get('command') or val or '').strip()
            interp = acao.get('interpreter', 'powershell')
            executar_comando_hid(cmd_val, interp)
            return
        elif val:
            executar_acao_generica(val)
            return

    if isinstance(acao, list):
        executar_atalho_string('+'.join(str(v) for v in acao))
        return

    if isinstance(acao, str):
        acao_upper = acao.upper().strip()
        if consumer_ctrl:
            if acao_upper in ('PLAY_PAUSE', 'PLAY', 'PAUSE'):
                consumer_ctrl.send(ConsumerControlCode.PLAY_PAUSE); return
            elif acao_upper in ('NEXT_TRACK', 'PROXIMA', 'PROXIMA_FAIXA'):
                consumer_ctrl.send(ConsumerControlCode.SCAN_NEXT_TRACK); return
            elif acao_upper in ('PREV_TRACK', 'ANTERIOR', 'FAIXA_ANTERIOR'):
                consumer_ctrl.send(ConsumerControlCode.SCAN_PREVIOUS_TRACK); return
            elif acao_upper in ('VOL_UP', 'VOLUME_UP', 'VOLUME_MAIS'):
                consumer_ctrl.send(ConsumerControlCode.VOLUME_INCREMENT); return
            elif acao_upper in ('VOL_DOWN', 'VOLUME_DOWN', 'VOLUME_MENOS'):
                consumer_ctrl.send(ConsumerControlCode.VOLUME_DECREMENT); return
            elif acao_upper in ('MUTE', 'MUDO'):
                consumer_ctrl.send(ConsumerControlCode.MUTE); return

        if mouse:
            if acao_upper in ('MOUSE_LEFT', 'CLICK_LEFT'):
                mouse.click(Mouse.LEFT_BUTTON); return
            elif acao_upper in ('MOUSE_RIGHT', 'CLICK_RIGHT'):
                mouse.click(Mouse.RIGHT_BUTTON); return
            elif acao_upper in ('MOUSE_MIDDLE', 'CLICK_MIDDLE'):
                mouse.click(Mouse.MIDDLE_BUTTON); return
            elif acao_upper in ('MOUSE_WHEEL_UP', 'SCROLL_UP'):
                mouse.move(wheel=1); return
            elif acao_upper in ('MOUSE_WHEEL_DOWN', 'SCROLL_DOWN'):
                mouse.move(wheel=-1); return

        if acao_upper == 'LAYER-SWITCH' and animar_troca_camada:
            cfg = obter_config_ativa() if obter_config_ativa else None
            total_c = len(cfg.get('layers', [])) if cfg else 4
            c_atual = obter_camada_atual() if obter_camada_atual else 0
            prox_c = (c_atual + 1) % max(1, total_c)
            animar_troca_camada(prox_c, direcao=1)
            return

    executar_atalho_string(str(acao))
