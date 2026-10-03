import serial
import time
import os
import shutil

print("[1/4] Conectando ao Pico via COM9...")
s = serial.Serial('COM9', 115200, timeout=1)
time.sleep(0.2)
s.write(b'\x03') # Ctrl+C
time.sleep(0.3)
s.read_all()

print("[2/4] Executando storage.erase_filesystem() no CircuitPython...")
s.write(b"import storage\r\nstorage.erase_filesystem()\r\n")
time.sleep(2.0)
s.close()

print("[3/4] Aguardando reinicializacao e reconexao do drive USB...")
time.sleep(5.0)

# Verificar se D: voltou
for attempt in range(15):
    if os.path.exists("D:\\"):
        print(f"Drive D: detectado! (Tentativa {attempt+1})")
        break
    time.sleep(1.0)

time.sleep(2.0)
print("[4/4] Restaurando arquivos essenciais para D:...")
# Test write
with open("D:\\test_write.txt", "w") as f:
    f.write("OK")
os.remove("D:\\test_write.txt")
print("Drive D: agora esta 100% GRAVAVEL!")

backup_dir = os.path.abspath("firmware_backup")
# Copiar lib
if os.path.exists(os.path.join(backup_dir, "lib")):
    dest_lib = "D:\\lib"
    if os.path.exists(dest_lib):
        shutil.rmtree(dest_lib)
    shutil.copytree(os.path.join(backup_dir, "lib"), dest_lib)
    print("lib/ restaurada!")

# Copiar config.json
if os.path.exists(os.path.join(backup_dir, "config.json")):
    shutil.copy2(os.path.join(backup_dir, "config.json"), "D:\\config.json")
    print("config.json restaurado!")

print("Pronto para receber o novo code.py!")
