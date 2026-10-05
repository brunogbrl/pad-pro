# Buxton Rotary Encoder Algorithm (Full-Step Anti-Bounce)
import digitalio

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
