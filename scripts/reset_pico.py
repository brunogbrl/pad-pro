import serial, time

s = serial.Serial('COM9', 115200, timeout=1)
s.write(b'\x03') # Ctrl+C
time.sleep(0.3)
s.write(b"import microcontroller\r\nmicrocontroller.reset()\r\n")
time.sleep(1.5)
s.close()
print("Microcontroller reset command sent!")
