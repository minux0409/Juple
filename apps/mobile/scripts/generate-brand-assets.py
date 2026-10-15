"""
Regenerates the Juple brand lockup used by the apps and the Entra company-branding banner.

Source of truth is the Web's own brand (apps/web/app/(app)/app.module.css `.sidebarBrand` + `.brandIcon`):
  - the real app icon (assets/branding/juple-app-icon-master-1024.png) with the 22.37% rounded-square mask,
  - "Juple" in weight 800 filled with --brand-gradient: linear-gradient(135deg, #fea248 0%, #fd616b 28%, #f133c5 55%, #6751fc 80%, #51a1fd 100%),
  - proportions of the Web side bar: 32px icon, 12px gap, 20px text (text = 0.625 x icon, gap = 0.375 x icon).
Run from apps/mobile:  python scripts/generate-brand-assets.py
Needs Pillow and the Segoe UI Black font (the Web's first font on Windows for weight 800).
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON = os.path.join(ROOT, 'assets', 'branding', 'juple-app-icon-master-1024.png')
OUT = os.path.join(ROOT, 'assets', 'branding')
FONT_CANDIDATES = ['C:/Windows/Fonts/seguibl.ttf', 'C:/Windows/Fonts/segoeuib.ttf']

STOPS = [(0.00, (0xFE, 0xA2, 0x48)), (0.28, (0xFD, 0x61, 0x6B)), (0.55, (0xF1, 0x33, 0xC5)), (0.80, (0x67, 0x51, 0xFC)), (1.00, (0x51, 0xA1, 0xFD))]

SCALE = 4  # supersampling


def color_at(t):
    t = max(0.0, min(1.0, t))
    for (p0, c0), (p1, c1) in zip(STOPS, STOPS[1:]):
        if t <= p1:
            f = (t - p0) / (p1 - p0)
            return tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
    return STOPS[-1][1]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    sys.exit('Segoe UI Black / Bold not found')


def gradient_text(text, font):
    """The text in the 135deg brand gradient, over the text element's own box (as CSS background-clip:text does)."""
    left, top, right, bottom = font.getbbox(text)
    # CSS: the element box is the line box; approximate it with ascent+descent so the gradient spans the same area.
    ascent, descent = font.getmetrics()
    w, h = right, ascent + descent
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).text((0, 0), text, font=font, fill=255)
    angle = math.radians(135)
    dx, dy = math.sin(angle), -math.cos(angle)
    length = abs(w * math.sin(angle)) + abs(h * math.cos(angle))
    grad = Image.new('RGBA', (w, h))
    px = grad.load()
    for y in range(h):
        for x in range(w):
            t = (((x - w / 2) * dx + (y - h / 2) * dy) / length) + 0.5
            r, g, b = color_at(t)
            px[x, y] = (r, g, b, 255)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out.crop(out.getbbox())


def rounded_icon(size):
    icon = Image.open(ICON).convert('RGBA').resize((size, size), Image.LANCZOS)
    mask = Image.new('L', (size * 2, size * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 2 - 1, size * 2 - 1), radius=round(size * 2 * 0.2237), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    icon.putalpha(mask)
    return icon


def build(icon_px):
    """Returns (lockup, wordmark) at the given icon height."""
    big = icon_px * SCALE
    word = gradient_text('Juple', load_font(round(big * 0.625)))
    gap = round(big * 0.375)
    icon = rounded_icon(big)
    width = big + gap + word.width
    lockup = Image.new('RGBA', (width, big), (0, 0, 0, 0))
    lockup.paste(icon, (0, 0), icon)
    lockup.paste(word, (big + gap, (big - word.height) // 2 + round(big * 0.01)), word)
    return lockup, word


def save(img, path, scale_down):
    w, h = img.size
    out = img.resize((max(1, round(w / scale_down)), max(1, round(h / scale_down))), Image.LANCZOS)
    out.save(path, optimize=True)
    print(os.path.basename(path), out.size, os.path.getsize(path), 'bytes')


if __name__ == '__main__':
    lockup, word = build(256)
    save(lockup, os.path.join(OUT, 'juple-lockup.png'), SCALE)
    save(word, os.path.join(OUT, 'juple-wordmark.png'), SCALE)
    # Entra company branding "banner logo": at most 245 x 36 px (the icon is 36 px high).
    entra, _ = build(36)
    save(entra, os.path.join(OUT, 'juple-entra-banner.png'), SCALE)
