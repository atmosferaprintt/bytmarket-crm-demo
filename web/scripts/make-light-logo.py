"""Логотип для тёмного фона: белый фон → прозрачный, синий → белый, зелёный → зелёный.
Каждый пиксель раскладывается на смесь трёх цветов (синий, зелёный, белый фон)."""
import sys
import numpy as np
from PIL import Image

src, out_full, out_mark, green_hex = sys.argv[1:5]
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float64)
H, W, _ = im.shape

navy = np.array([7, 32, 88], float)
green = np.array([25, 130, 12], float)
white = np.array([253, 253, 253], float)

A = np.stack([navy - white, green - white], axis=1)  # 3×2
P = im.reshape(-1, 3) - white
coef, *_ = np.linalg.lstsq(A, P.T, rcond=None)  # 2×N
a = np.clip(coef[0], 0, 1)
b = np.clip(coef[1], 0, 1)
s = a + b
over = s > 1
a[over] /= s[over]
b[over] /= s[over]
alpha = np.clip(a + b, 0, 1)
alpha[alpha < 0.05] = 0

ink_white = np.array([255, 255, 255], float)
g = green_hex.lstrip('#')
ink_green = np.array([int(g[i:i + 2], 16) for i in (0, 2, 4)], float)
w = np.where(alpha > 0, a / np.maximum(alpha, 1e-6), 0)[:, None]
rgb = w * ink_white + (1 - w) * ink_green

outa = np.concatenate([rgb, (alpha * 255)[:, None]], axis=1).reshape(H, W, 4)
outa = np.clip(np.round(outa), 0, 255).astype(np.uint8)
img = Image.fromarray(outa, 'RGBA')

# обрезка по краям надписи
mask = alpha.reshape(H, W) > 0.2
ys, xs = np.where(mask)
y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
pad = 6
full = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad + 1), min(H, y1 + pad + 1)))

# знак — первый столбец рисунка до пустого промежутка (дом с буквой Б)
cols = mask.any(axis=0)
x = x0
while x < W and cols[x]:
    x += 1
mark_x1 = x - 1
mrows = np.where(mask[:, x0:mark_x1 + 1].any(axis=1))[0]
my0, my1 = mrows.min(), mrows.max()
side = max(mark_x1 - x0, my1 - my0) + 2 * pad
cx, cy = (x0 + mark_x1) / 2, (my0 + my1) / 2
mark = img.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))

def fit(im, width):
    h = round(im.height * width / im.width)
    return im.resize((width, h), Image.LANCZOS)

fit(full, 600).save(out_full, optimize=True)
fit(mark, 128).save(out_mark, optimize=True)
print('full', full.size, '-> 600 wide; mark', mark.size, 'box', (x0, mark_x1, my0, my1))
