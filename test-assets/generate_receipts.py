#!/usr/bin/env python3
"""
Генератор реалістичних PNG-чеків для тестового набору "Навпіл".
ЛОКАЛЬНО, без жодних викликів моделей/мережі. Тільки PIL.

Стиль узгоджено з наявним test-assets/sample-receipt.png:
520x640(+), білий фон, чорний текст, сірі підзаголовки/лінії,
шапка (назва+адреса), позиції (назва / qty x ціна / сума рядка),
"Сума", необов'язковий "Сервіс X%", "РАЗОМ" жирним, подяка знизу.

Запуск: python3 generate_receipts.py
"""
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_DIR = "/System/Library/Fonts/Supplemental"
F_REG = f"{FONT_DIR}/Arial.ttf"
F_BOLD = f"{FONT_DIR}/Arial Bold.ttf"

W = 520
MARGIN_L = 40
MARGIN_R = 480
COL_MID = 350  # права межа колонки "qty x ціна"
COL_R = 480    # права межа колонки суми рядка / значень

BLACK = (20, 20, 20)
GRAY = (120, 120, 120)
LINE = (205, 205, 205)
WHITE = (255, 255, 255)


def font(path, size):
    return ImageFont.truetype(path, size)


def fmt(uah: float) -> str:
    """245.5 -> '245,50'  (для друку на чеку, укр формат)."""
    cents = round(uah * 100)
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100},{cents % 100:02d}"


def right_text(draw, x_right, y, text, fnt, fill):
    w = draw.textlength(text, font=fnt)
    draw.text((x_right - w, y), text, font=fnt, fill=fill)


def center_text(draw, xc, y, text, fnt, fill):
    w = draw.textlength(text, font=fnt)
    draw.text((xc - w / 2, y), text, font=fnt, fill=fill)


def render_receipt(
    out_path,
    shop_name,
    address,
    items,  # list of (name, qty, unit_price_uah)
    service_pct=0,
    footer="Дякуємо за візит!",
    blur_item_index=None,
    noise_seed=1,
):
    """items -> малює чек; повертає dict з порахованими сумами (грн) для звірки."""
    row_h = 34
    header_h = 115
    n = len(items)
    items_block_h = n * row_h
    footer_block_h = 140
    H = header_h + items_block_h + footer_block_h

    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)

    f_title = font(F_BOLD, 27)
    f_sub = font(F_REG, 15)
    f_item = font(F_REG, 17)
    f_label = font(F_REG, 16)
    f_total = font(F_BOLD, 20)
    f_footer = font(F_REG, 14)

    y = 28
    center_text(d, W / 2, y, shop_name, f_title, BLACK)
    y += 40
    center_text(d, W / 2, y, address, f_sub, GRAY)
    y += 32
    d.line([(MARGIN_L, y), (MARGIN_R, y)], fill=LINE, width=2)
    y += 20

    line_sum = 0.0
    item_rows_y = []
    for (name, qty, unit_price) in items:
        line_total = round(qty * unit_price, 2)
        line_sum += line_total
        item_rows_y.append(y)
        d.text((MARGIN_L, y), name, font=f_item, fill=BLACK)
        right_text(d, COL_MID, y, f"{qty} x {fmt(unit_price)}", f_item, BLACK)
        right_text(d, COL_R, y, fmt(line_total), f_item, BLACK)
        y += row_h

    d.line([(MARGIN_L, y), (MARGIN_R, y)], fill=LINE, width=2)
    y += 18

    d.text((MARGIN_L, y), "Сума", font=f_label, fill=BLACK)
    right_text(d, COL_R, y, fmt(line_sum), f_label, BLACK)
    y += 28

    service_uah = 0.0
    if service_pct and service_pct > 0:
        service_uah = round(line_sum * service_pct / 100, 2)
        d.text((MARGIN_L, y), f"Сервіс {service_pct}%", font=f_label, fill=BLACK)
        right_text(d, COL_R, y, fmt(service_uah), f_label, BLACK)
        y += 28

    y += 6
    d.line([(MARGIN_L, y), (MARGIN_R, y)], fill=BLACK, width=2)
    y += 16

    total_uah = round(line_sum + service_uah, 2)
    d.text((MARGIN_L, y), "РАЗОМ", font=f_total, fill=BLACK)
    right_text(d, COL_R, y, fmt(total_uah), f_total, BLACK)
    y += 46

    center_text(d, W / 2, y, footer, f_footer, GRAY)

    # --- Розмиття/нечіткість однієї позиції (сценарій "unreadable") ---
    if blur_item_index is not None:
        row_y = item_rows_y[blur_item_index]
        box = (MARGIN_L - 4, row_y - 4, COL_R + 4, row_y + row_h - 6)
        region = im.crop(box)
        # низький контраст: змішати з сірим фоном
        gray_bg = Image.new("RGB", region.size, (225, 225, 225))
        region = Image.blend(region, gray_bg, 0.55)
        # сильне розмиття (як розфокусоване/змазане фото)
        region = region.filter(ImageFilter.GaussianBlur(radius=2.6))
        # зернистий шум поверх
        rnd = random.Random(noise_seed)
        px = region.load()
        rw, rh = region.size
        for _ in range(int(rw * rh * 0.12)):
            nx = rnd.randrange(rw)
            ny = rnd.randrange(rh)
            r, g, b = px[nx, ny]
            delta = rnd.randint(-40, 40)
            px[nx, ny] = (
                max(0, min(255, r + delta)),
                max(0, min(255, g + delta)),
                max(0, min(255, b + delta)),
            )
        im.paste(region, box)

    im.save(out_path)
    return {"items_sum_uah": line_sum, "service_uah": service_uah, "total_uah": total_uah}


BASE = "/Users/lukahrachov/Desktop/Work/codebridge-receipt-split/test-assets"

if __name__ == "__main__":
    # ---------- Сценарій 1: normal ----------
    r1 = render_receipt(
        f"{BASE}/scenario1/receipt.png",
        'Кав’ярня «Каштан»',
        "м. Чернівці, вул. Кобилянської, 5",
        items=[
            ("Капучино", 1, 65.00),
            ("Круасан з мигдалем", 1, 85.00),
            ("Лате", 1, 75.00),
            ("Тірамісу", 1, 120.00),
            ("Американо", 1, 55.00),
            ("Сирники", 1, 135.00),
        ],
        service_pct=0,
    )
    print("scenario1", r1)

    # ---------- Сценарій 2: shared ----------
    r2 = render_receipt(
        f"{BASE}/scenario2/receipt.png",
        'Піцерія «Дельфіно»',
        "м. Чернівці, просп. Незалежності, 34",
        items=[
            ("Піца Маргарита", 1, 320.00),
            ("Салат Цезар", 1, 145.00),
            ("Тірамісу", 1, 110.00),
            ("Морс домашній", 2, 40.00),
            ("Кава", 1, 55.00),
        ],
        service_pct=10,
    )
    print("scenario2", r2)

    # ---------- Сценарій 3: correction ----------
    r3 = render_receipt(
        f"{BASE}/scenario3/receipt.png",
        'Кафе «Весна»',
        "м. Чернівці, вул. Головна, 21",
        items=[
            ("Борщ", 1, 120.00),
            ("Салат овочевий", 1, 95.00),
            ("Кава", 2, 65.00),
            ("Стейк з телятини", 1, 250.00),
        ],
        service_pct=0,
    )
    print("scenario3", r3)

    # ---------- Сценарій 4: ambiguous ----------
    r4 = render_receipt(
        f"{BASE}/scenario4/receipt.png",
        'Кав’ярня «Схід»',
        "м. Чернівці, вул. Руська, 9",
        items=[
            ("Капучино", 2, 60.00),
            ("Сендвіч з куркою", 1, 95.00),
            ("Мафін чорничний", 1, 55.00),
        ],
        service_pct=0,
    )
    print("scenario4", r4)

    # ---------- Сценарій 5: unreadable (одна позиція розмита) ----------
    r5 = render_receipt(
        f"{BASE}/scenario5/receipt.png",
        'Бар «Причал»',
        "м. Чернівці, наб. Прутська, 2",
        items=[
            ("Бургер класичний", 1, 165.00),
            ("Картопля фрі", 1, 55.00),
            ("Хумус з питою", 1, 130.00),  # <- ця позиція буде розмита
            ("Лимонад домашній", 1, 60.00),
            ("Наггетси", 1, 95.00),
        ],
        service_pct=10,
        blur_item_index=2,
    )
    print("scenario5", r5)
