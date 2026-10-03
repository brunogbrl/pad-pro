import supervisor
import storage

# Define a identificacao USB oficial do PadPro para o Windows
try:
    supervisor.set_usb_identification(manufacturer="PadPro", product_name="PadPro")
except Exception:
    pass

# Define o nome do volume da unidade flash para PadPro
try:
    storage.set_disk_name("PadPro")
except Exception:
    pass
