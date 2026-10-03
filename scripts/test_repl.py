import serial, time

s = serial.Serial('COM9', 115200, timeout=1)
s.dtr = True
s.rts = True
s.write(b'\x03')
time.sleep(0.3)
s.read_all()
s.write(b"import rotaryio, board\r\n")
time.sleep(0.2)
s.write(b"enc = rotaryio.IncrementalEncoder(board.GP13, board.GP11)\r\n")
time.sleep(0.2)
s.write(b"print('ROTARYIO_VAL:', enc.position)\r\n")
time.sleep(0.2)
s.write(b"enc.deinit()\r\n")
time.sleep(0.2)
res = s.read_all().decode('utf-8', errors='ignore')
print("OUTPUT:", res.encode('ascii', errors='replace').decode('ascii'))
s.write(b'\x04')
time.sleep(0.5)
s.close()
