#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 PWA 图标（纯 Python，无需 PIL）

画出与网页一致的四角星 + 鎏金光晕，输出：
  web/public/icon-192.png   普通图标
  web/public/icon-512.png   高清图标 / 启动画面
  web/public/apple-touch-icon.png  iOS 主屏图标（180×180）

用法：python tools/make_icons.py
"""
import os
import sys
import zlib
import math
import struct

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "public")
SS = 3                                    # 超采样倍数（抗锯齿）


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(lerp(c1[i], c2[i], t) for i in range(3))


def star_coverage(dx, dy):
    """四角星：用星形曲线 |x|^(2/3)+|y|^(2/3) <= 1（尖角朝上下左右）"""
    ax, ay = abs(dx), abs(dy)
    if ax < 1e-9 and ay < 1e-9:
        return True
    v = (ax ** (2 / 3)) + (ay ** (2 / 3))
    return v <= 1.0


def render(size):
    """渲染一张 size×size 的图标，返回 RGB 字节"""
    W = size * SS
    # 画布：暖米色径向渐变（与外层网页底色一致）
    bg_in = (255, 250, 240)      # --bg1
    bg_out = (240, 224, 191)     # --bg3
    gold_hi = (255, 226, 150)    # 星心高光
    gold_mid = (217, 164, 65)    # --gold-soft
    gold_lo = (184, 134, 11)     # --gold

    cx = cy = W / 2
    star_r = W * 0.30            # 星半径（占画布 60%，留出 maskable 安全区）
    glow_r = W * 0.46

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # 超采样：在 SS×SS 子像素上累积
            r = g = b = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x * SS + sx + 0.5
                    py = y * SS + sy + 0.5
                    dx, dy = px - cx, py - cy
                    dist = math.hypot(dx, dy)

                    # 底色：中心亮、边缘暖的径向渐变
                    t = min(1.0, dist / (W * 0.62))
                    cr, cg, cb = mix(bg_in, bg_out, t * t)

                    # 光晕
                    if dist < glow_r:
                        gl = (1 - dist / glow_r) ** 2 * 0.55
                        cr = lerp(cr, gold_mid[0], gl)
                        cg = lerp(cg, gold_mid[1], gl)
                        cb = lerp(cb, gold_mid[2], gl)

                    # 四角星
                    if dist < star_r * 1.45:
                        ux, uy = dx / star_r, dy / star_r
                        if star_coverage(ux, uy):
                            # 星内部：靠中心偏亮（有点立体感）
                            k = min(1.0, dist / star_r)
                            sr, sg, sb = mix(gold_hi, gold_lo, k)
                            cr, cg, cb = sr, sg, sb

                    r += cr; g += cg; b += cb
            n = SS * SS
            row += bytes((int(r / n + .5), int(g / n + .5), int(b / n + .5)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + r for r in rows)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]
    print(f"生成图标 → {OUT}")
    for size, name in jobs:
        rows = render(size)
        p = os.path.join(OUT, name)
        n = write_png(p, size, rows)
        print(f"  ✓ {name}  {size}×{size}  {n/1024:.1f} KB")


if __name__ == "__main__":
    main()
