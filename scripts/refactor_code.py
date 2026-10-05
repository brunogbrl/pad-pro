with open('scripts/code.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Replace EncoderRotativoBuxton block
p1_start = text.find('DIR_NONE = 0x00')
p1_end = text.find('TEM_ENCODER = False')
repl1 = "from pad_encoder import EncoderRotativoBuxton\n\n"
text = text[:p1_start] + repl1 + text[p1_end:]

# 2. Replace actions block (abrir_url_hid down to before Rotary Encoder logic)
p2_start = text.find('def abrir_url_hid(url_val):')
p2_end = text.find('# =====================================================================\n# 5. EXECUÇÃO DO ENCODER')
repl2 = """import pad_actions

abrir_url_hid = pad_actions.abrir_url_hid
abrir_app_hid = pad_actions.abrir_app_hid
executar_comando_hid = pad_actions.executar_comando_hid
executar_macro = pad_actions.executar_macro
executar_acao_generica = pad_actions.executar_acao_generica
executar_atalho_string = pad_actions.executar_atalho_string

"""
text = text[:p2_start] + repl2 + text[p2_end:]

# 3. Add pad_actions.init call after keyboard initialization
init_call = "\npad_actions.init(teclado, teclado_layout, consumer_ctrl, mouse, mostrar_acao_oled, animar_troca_camada, lambda: config_ativa, lambda: camada_atual, TEM_SUPERVISOR)\n"
marker = "print(f\"[LAYOUT AVISO] {err_lay}\")"
idx = text.find(marker)
line_end = text.find("\n", idx) + 1
text = text[:line_end] + init_call + text[line_end:]

with open('scripts/code.py', 'w', encoding='utf-8') as f:
    f.write(text)

print('Updated scripts/code.py, new length:', len(text))
