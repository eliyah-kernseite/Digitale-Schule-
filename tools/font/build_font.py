#!/usr/bin/env python3
"""
Baut die Hausschrift "Fundament Display" (OpenType/CFF + WOFF2).

Eine kräftige, schmale Grotesk für Überschriften: quadratisch gerundete Bögen,
flache Enden und ein schräger Anschnitt oben links an jedem Hauptstamm
(die "Kante"), der der Schrift Vorwärtsdrang gibt.

Alle Glyphen werden aus wenigen Grundformen (Rechtecke, gerundete Rechtecke,
Diagonalen) per Boolescher Pfad-Operation zusammengesetzt.

Benötigt: pip install fonttools skia-pathops brotli
Aufruf:   python3 tools/font/build_font.py
"""

import os
import sys

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.ttLib import TTFont

FAMILY = "Fundament Display"
VERSION = "1.000"
UPM = 1000
CAP = 700
XH = 528
ASC = 742
DESC = -196
S = 124          # Stammstärke vertikal
T = 104          # Stärke horizontaler Balken
SB = 34          # Vor-/Nachbreite
K = 0.60         # Kurvenhenkel: > 0.552 ergibt quadratischere Rundungen
CUT = 46         # Größe des schrägen Anschnitts ("Kante")

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "..", "..", "public", "fonts")


# ---------------------------------------------------------------- Grundformen

def P():
    return pathops.Path()


def rect(x0, y0, x1, y1):
    p = P()
    p.moveTo(x0, y0)
    p.lineTo(x1, y0)
    p.lineTo(x1, y1)
    p.lineTo(x0, y1)
    p.close()
    return p


def poly(*pts):
    p = P()
    p.moveTo(*pts[0])
    for pt in pts[1:]:
        p.lineTo(*pt)
    p.close()
    return p


def rrect(x0, y0, x1, y1, r):
    """Gerundetes Rechteck. r = Zahl oder (oben-links, oben-rechts, unten-rechts, unten-links)."""
    if not isinstance(r, (tuple, list)):
        r = (r, r, r, r)
    w, h = x1 - x0, y1 - y0
    lim = min(w, h) / 2
    tl, tr, br, bl = [max(0, min(v, lim)) for v in r]
    p = P()
    p.moveTo(x0 + bl, y0)
    p.lineTo(x1 - br, y0)
    if br:
        p.cubicTo(x1 - br + br * K, y0, x1, y0 + br - br * K, x1, y0 + br)
    p.lineTo(x1, y1 - tr)
    if tr:
        p.cubicTo(x1, y1 - tr + tr * K, x1 - tr + tr * K, y1, x1 - tr, y1)
    p.lineTo(x0 + tl, y1)
    if tl:
        p.cubicTo(x0 + tl - tl * K, y1, x0, y1 - tl + tl * K, x0, y1 - tl)
    p.lineTo(x0, y0 + bl)
    if bl:
        p.cubicTo(x0, y0 + bl - bl * K, x0 + bl - bl * K, y0, x0 + bl, y0)
    p.close()
    return p


def shrink(r, d):
    if isinstance(r, (tuple, list)):
        return tuple(max(v - d, 0) if v else 0 for v in r)
    return max(r - d, 0)


def ring(x0, y0, x1, y1, r, sx=S, sy=T):
    inner_r = shrink(r, (sx + sy) / 2 * 0.95)
    return diff(rrect(x0, y0, x1, y1, r), rrect(x0 + sx, y0 + sy, x1 - sx, y1 - sy, inner_r))


def stroke(x0, y0, x1, y1, t=S):
    """Diagonaler Strich mit horizontaler Breite t zwischen zwei Mittelpunkten."""
    h = t / 2
    return poly((x0 - h, y0), (x0 + h, y0), (x1 + h, y1), (x1 - h, y1))


def union(*paths):
    result = P()
    for p in paths:
        if p is None:
            continue
        result = pathops.op(result, p, pathops.PathOp.UNION)
    return result


def diff(a, *bs):
    for b in bs:
        a = pathops.op(a, b, pathops.PathOp.DIFFERENCE)
    return a


def inter(a, b):
    return pathops.op(a, b, pathops.PathOp.INTERSECTION)


def kante(x0, top, size=CUT):
    """Schräger Anschnitt oben links an einem Stamm (Markenzeichen der Schrift)."""
    return poly((x0 - 1, top + 1), (x0 + size, top + 1), (x0 - 1, top - size * 1.4))


def stem(x0, y0, y1, w=S, cut=True):
    s = rect(x0, y0, x0 + w, y1)
    return diff(s, kante(x0, y1)) if cut else s


def clip(path, x0, y0, x1, y1):
    return inter(path, rect(x0, y0, x1, y1))


def dot(cx, y):
    """Punkt für i, j und Umlaute: leicht nach vorn geneigtes Parallelogramm."""
    w, h = S, 118
    sl = 18
    return poly((cx - w / 2, y), (cx + w / 2, y), (cx + w / 2 + sl, y + h), (cx - w / 2 + sl, y + h))


# ---------------------------------------------------------------- Glyphen
# Jede Funktion liefert (Pfad, Breite) in lokalen Koordinaten ab x = 0.

G = {}


def glyph(name, uni=None):
    def deco(fn):
        G[name] = (fn, uni)
        return fn
    return deco


RC = 150  # Rundung Versalien
RL = 132  # Rundung Gemeine


# ---- Versalien

@glyph("A", 0x41)
def g_A():
    w = 500
    top_l, top_r = 168, w - 168
    left = stroke(S / 2 + 4, 0, top_l + S / 2 - 6, CAP, S + 6)
    right = stroke(w - S / 2 - 4, 0, top_r - S / 2 + 6, CAP, S + 6)
    top = rect(top_l - 10, CAP - T, top_r + 10, CAP)
    bar = rect(90, 190, w - 90, 190 + T - 8)
    return clip(union(left, right, top, bar), 0, 0, w, CAP), w


@glyph("B", 0x42)
def g_B():
    w = 470
    upper = ring(0, CAP / 2 - T / 2, w - 22, CAP, (0, RC - 30, RC - 30, 0))
    lower = ring(0, 0, w, CAP / 2 + T / 2, (0, RC - 20, RC - 20, 0))
    return union(diff(union(upper, lower), kante(0, CAP)), stem(0, 0, CAP)), w


@glyph("C", 0x43)
def g_C():
    w = 450
    o = ring(0, 0, w, CAP, RC)
    o = diff(o, rect(w / 2 + 10, 250, w + 1, CAP - 250))
    return o, w


@glyph("D", 0x44)
def g_D():
    w = 470
    d = ring(0, 0, w, CAP, (0, RC + 20, RC + 20, 0))
    return diff(d, kante(0, CAP)), w


@glyph("E", 0x45)
def g_E():
    w = 400
    return union(stem(0, 0, CAP), rect(0, CAP - T, w, CAP), rect(0, CAP / 2 - T / 2 + 6, w - 40, CAP / 2 + T / 2 + 6), rect(0, 0, w, T)), w


@glyph("F", 0x46)
def g_F():
    w = 390
    return union(stem(0, 0, CAP), rect(0, CAP - T, w, CAP), rect(0, CAP / 2 - T / 2 - 4, w - 40, CAP / 2 + T / 2 - 4)), w


@glyph("G", 0x47)
def g_G():
    w = 460
    o = ring(0, 0, w, CAP, RC)
    o = diff(o, rect(w / 2, CAP / 2 + 30, w + 1, CAP - 236))
    bar = rect(w / 2 - 10, CAP / 2 - T / 2 - 20, w, CAP / 2 + T / 2 - 20)
    return union(o, bar), w


@glyph("H", 0x48)
def g_H():
    w = 470
    return union(stem(0, 0, CAP), stem(w - S, 0, CAP), rect(0, CAP / 2 - T / 2, w, CAP / 2 + T / 2)), w


@glyph("I", 0x49)
def g_I():
    return stem(0, 0, CAP), S


@glyph("J", 0x4A)
def g_J():
    w = 400
    u = ring(0, 0, w, CAP + 400, (0, 0, RC, RC))
    u = clip(u, 0, 0, w, CAP)
    u = diff(u, rect(-1, 210, S + 1, CAP + 1))
    return diff(u, kante(w - S, CAP)), w


@glyph("K", 0x4B)
def g_K():
    w = 470
    arm = stroke(S + 40, CAP / 2 - 70, w - S / 2 - 6, CAP, S + 14)
    leg = stroke(S + 60, CAP / 2 + 30, w - S / 2 - 2, 0, S + 22)
    return clip(union(stem(0, 0, CAP), arm, leg, rect(S - 2, CAP / 2 - T / 2 - 30, S + 110, CAP / 2 + T / 2 - 30)), 0, 0, w, CAP), w


@glyph("L", 0x4C)
def g_L():
    w = 380
    return union(stem(0, 0, CAP), rect(0, 0, w, T)), w


@glyph("M", 0x4D)
def g_M():
    w = 600
    mid = w / 2
    l = stroke(S / 2 + 10, CAP, mid, 230, S - 6)
    r = stroke(w - S / 2 - 10, CAP, mid, 230, S - 6)
    return clip(union(stem(0, 0, CAP), stem(w - S, 0, CAP, cut=False), l, r), 0, 0, w, CAP), w


@glyph("N", 0x4E)
def g_N():
    w = 490
    d = stroke(S / 2 + 18, CAP, w - S / 2 - 18, 0, S + 8)
    return clip(union(stem(0, 0, CAP), stem(w - S, 0, CAP, cut=False), d), 0, 0, w, CAP), w


@glyph("O", 0x4F)
def g_O():
    w = 470
    return ring(0, 0, w, CAP, RC + 10), w


@glyph("P", 0x50)
def g_P():
    w = 450
    bowl = ring(0, CAP / 2 - T / 2 - 50, w, CAP, (0, RC, RC, 0))
    return union(diff(bowl, kante(0, CAP)), stem(0, 0, CAP)), w


@glyph("Q", 0x51)
def g_Q():
    w = 470
    o = ring(0, 0, w, CAP, RC + 10)
    tail = stroke(w - 150, 170, w - 30, -60, S - 10)
    return union(o, clip(tail, 0, -60, w + 10, 240)), w


@glyph("R", 0x52)
def g_R():
    w = 470
    bowl = ring(0, CAP / 2 - T / 2 - 40, w - 10, CAP, (0, RC, RC, 0))
    leg = stroke(w - 200, CAP / 2 - 20, w - S / 2 - 4, 0, S + 16)
    return clip(union(diff(bowl, kante(0, CAP)), stem(0, 0, CAP), leg), 0, 0, w, CAP), w


@glyph("S", 0x53)
def g_S():
    w = 450
    mid = CAP / 2
    upper = ring(0, mid - T / 2, w, CAP, RC - 10)
    upper = diff(upper, rect(w - S - 50, mid - T / 2 - 1, w + 1, mid + 95))
    lower = ring(0, 0, w, mid + T / 2, RC - 10)
    lower = diff(lower, rect(-1, mid - 95, S + 50, mid + T / 2 + 1))
    return union(upper, lower), w


@glyph("T", 0x54)
def g_T():
    w = 440
    return union(rect(0, CAP - T, w, CAP), rect(w / 2 - S / 2, 0, w / 2 + S / 2, CAP)), w


@glyph("U", 0x55)
def g_U():
    w = 470
    u = ring(0, 0, w, CAP + 400, (0, 0, RC + 10, RC + 10))
    u = clip(u, 0, 0, w, CAP)
    return diff(u, kante(0, CAP), kante(w - S, CAP)), w


@glyph("V", 0x56)
def g_V():
    w = 490
    l = stroke(S / 2, CAP, w / 2 - 8, 0, S + 10)
    r = stroke(w - S / 2, CAP, w / 2 + 8, 0, S + 10)
    return clip(union(l, r), 0, 0, w, CAP), w


@glyph("W", 0x57)
def g_W():
    w = 680
    a = stroke(S / 2, CAP, 170, 0, S)
    b = stroke(w / 2, CAP - 20, 170 + 10, 0, S - 8)
    c = stroke(w / 2, CAP - 20, w - 170 - 10, 0, S - 8)
    d = stroke(w - S / 2, CAP, w - 170, 0, S)
    return clip(union(a, b, c, d), 0, 0, w, CAP), w


@glyph("X", 0x58)
def g_X():
    w = 480
    return clip(union(stroke(S / 2, CAP, w - S / 2, 0, S + 14), stroke(w - S / 2, CAP, S / 2, 0, S + 14)), 0, 0, w, CAP), w


@glyph("Y", 0x59)
def g_Y():
    w = 480
    l = stroke(S / 2, CAP, w / 2, CAP / 2 - 30, S + 8)
    r = stroke(w - S / 2, CAP, w / 2, CAP / 2 - 30, S + 8)
    st = rect(w / 2 - S / 2, 0, w / 2 + S / 2, CAP / 2 + 10)
    return clip(union(l, r, st), 0, 0, w, CAP), w


@glyph("Z", 0x5A)
def g_Z():
    w = 430
    d = stroke(w - S / 2 - 14, CAP - T, S / 2 + 14, T, S + 24)
    return clip(union(rect(0, CAP - T, w, CAP), rect(0, 0, w, T), d), 0, 0, w, CAP), w


# ---- Gemeine

def bowl(x0, x1, y0=0, y1=XH, r=RL):
    return ring(x0, y0, x1, y1, r)


@glyph("a", 0x61)
def g_a():
    w = 430
    return union(diff(bowl(0, w), rect(w - S, 0, w + 1, XH + 1)), rect(w - S, 0, w, XH)), w


@glyph("b", 0x62)
def g_b():
    w = 430
    return union(diff(bowl(0, w, r=(0, RL, RL, 0)), kante(0, XH)), stem(0, 0, ASC)), w


@glyph("c", 0x63)
def g_c():
    w = 400
    return diff(bowl(0, w), rect(w / 2 + 20, 196, w + 1, XH - 196)), w


@glyph("d", 0x64)
def g_d():
    w = 430
    return union(bowl(0, w, r=(RL, 0, 0, RL)), stem(w - S, 0, ASC)), w


@glyph("e", 0x65)
def g_e():
    w = 420
    o = bowl(0, w)
    o = diff(o, rect(S, 150, w + 1, 236))
    bar = rect(0, XH / 2 - T / 2 + 18, w, XH / 2 + T / 2 + 6)
    o = union(o, bar)
    return diff(o, rect(w - S - 1, 120, w + 1, XH / 2 - T / 2 + 18)), w


@glyph("f", 0x66)
def g_f():
    w = 300
    hook = ring(0, 0, w + 120, ASC, (RL - 10, 0, 0, 0))
    hook = clip(hook, 0, 0, w, ASC)
    hook = diff(hook, rect(S, -1, w + 200, ASC - T))
    bar = rect(-30, XH - T, w - 30, XH)
    return clip(union(hook, bar), -30, 0, w, ASC), w - 30


@glyph("g", 0x67)
def g_g():
    w = 430
    top = union(bowl(0, w, r=(RL, 0, 0, RL)), rect(w - S, 0, w, XH))
    desc = ring(0, DESC, w, 120, (0, 0, RL - 10, RL - 10))
    desc = clip(desc, 0, DESC, w, 0)
    desc = diff(desc, rect(-1, DESC + T, S + 50, 1))
    return union(top, desc, rect(w - S, DESC + 130, w, 1)), w


@glyph("h", 0x68)
def g_h():
    w = 430
    arch = ring(0, -400, w, XH, (0, RL, 0, 0))
    arch = clip(arch, 0, 0, w, XH)
    return union(arch, stem(0, 0, ASC)), w


@glyph("i", 0x69)
def g_i():
    return union(stem(0, 0, XH), dot(S / 2 - 6, XH + 70)), S + 12


@glyph("j", 0x6A)
def g_j():
    w = 250
    hook = ring(-180, DESC, w, XH + 400, (0, 0, RL - 20, 0))
    hook = clip(hook, 0, DESC, w, XH)
    hook = diff(hook, rect(-1, DESC + T, w - S, XH + 1))
    hook = diff(hook, kante(w - S, XH, 30))
    return union(hook, dot(w - S / 2 - 6, XH + 70)), w + 12


@glyph("k", 0x6B)
def g_k():
    w = 420
    arm = stroke(S + 30, XH / 2 - 60, w - S / 2 - 6, XH, S + 8)
    leg = stroke(S + 40, XH / 2 + 20, w - S / 2, 0, S + 16)
    return clip(union(stem(0, 0, ASC), arm, leg), 0, 0, w, ASC), w


@glyph("l", 0x6C)
def g_l():
    return stem(0, 0, ASC), S


@glyph("m", 0x6D)
def g_m():
    w = 650
    half = (w + S) / 2
    a1 = clip(ring(0, -400, half, XH, (0, RL - 20, 0, 0)), 0, 0, half, XH)
    a2 = clip(ring(half - S, -400, w, XH, (0, RL - 20, 0, 0)), 0, 0, w, XH)
    return union(a1, a2, stem(0, 0, XH, cut=True)), w


@glyph("n", 0x6E)
def g_n():
    w = 430
    arch = clip(ring(0, -400, w, XH, (0, RL, 0, 0)), 0, 0, w, XH)
    return union(arch, stem(0, 0, XH)), w


@glyph("o", 0x6F)
def g_o():
    w = 440
    return bowl(0, w), w


@glyph("p", 0x70)
def g_p():
    w = 430
    return union(diff(bowl(0, w, r=(0, RL, RL, 0)), kante(0, XH)), stem(0, DESC, XH)), w


@glyph("q", 0x71)
def g_q():
    w = 430
    return union(bowl(0, w, r=(RL, 0, 0, RL)), rect(w - S, DESC, w, XH)), w


@glyph("r", 0x72)
def g_r():
    w = 310
    arch = clip(ring(0, -400, w + 140, XH, (0, RL, 0, 0)), 0, 0, w, XH)
    arch = diff(arch, rect(S, -1, w + 1, XH - T))
    return union(arch, stem(0, 0, XH)), w


@glyph("s", 0x73)
def g_s():
    w = 400
    mid = XH / 2
    upper = ring(0, mid - (T - 10) / 2, w, XH, RL - 24, sy=T - 10)
    upper = diff(upper, rect(w - S - 40, mid - T / 2, w + 1, mid + 66))
    lower = ring(0, 0, w, mid + (T - 10) / 2, RL - 24, sy=T - 10)
    lower = diff(lower, rect(-1, mid - 66, S + 40, mid + T / 2 + 6))
    return union(upper, lower), w


@glyph("t", 0x74)
def g_t():
    w = 320
    hook = ring(0, 0, w + 120, XH + 400, (0, 0, 0, RL - 20))
    hook = clip(hook, 0, 0, w, 660)
    hook = diff(hook, rect(S, T, w + 200, 700))
    hook = diff(hook, kante(0, 660))
    bar = rect(-34, XH - T, w - 10, XH)
    return clip(union(hook, bar), -34, 0, w, 700), w


@glyph("u", 0x75)
def g_u():
    w = 430
    u = clip(ring(0, 0, w, XH + 400, (0, 0, 0, RL)), 0, 0, w, XH)
    return union(diff(u, kante(0, XH)), rect(w - S, 0, w, XH)), w


@glyph("v", 0x76)
def g_v():
    w = 440
    return clip(union(stroke(S / 2, XH, w / 2 - 6, 0, S + 8), stroke(w - S / 2, XH, w / 2 + 6, 0, S + 8)), 0, 0, w, XH), w


@glyph("w", 0x77)
def g_w():
    w = 620
    a = stroke(S / 2, XH, 158, 0, S - 4)
    b = stroke(w / 2, XH - 10, 166, 0, S - 14)
    c = stroke(w / 2, XH - 10, w - 166, 0, S - 14)
    d = stroke(w - S / 2, XH, w - 158, 0, S - 4)
    return clip(union(a, b, c, d), 0, 0, w, XH), w


@glyph("x", 0x78)
def g_x():
    w = 430
    return clip(union(stroke(S / 2, XH, w - S / 2, 0, S + 10), stroke(w - S / 2, XH, S / 2, 0, S + 10)), 0, 0, w, XH), w


@glyph("y", 0x79)
def g_y():
    w = 440
    x0, x1 = w - S / 2, w / 2 + 6
    slope = (x1 - x0) / XH
    xd = x1 + slope * (-DESC)  # Verlängerung des rechten Arms in die Unterlänge
    r = stroke(x0, XH, xd, DESC, S + 8)
    l = stroke(S / 2, XH, x1 + slope * 70, -70, S + 8)
    return clip(union(l, r), 0, DESC, w, XH), w


@glyph("z", 0x7A)
def g_z():
    w = 390
    d = stroke(w - S / 2 - 12, XH - T, S / 2 + 12, T, S + 20)
    return clip(union(rect(0, XH - T, w, XH), rect(0, 0, w, T), d), 0, 0, w, XH), w


@glyph("germandbls", 0xDF)
def g_ss():
    w = 450
    mid = XH / 2 + 30
    top = ring(0, mid - T / 2, w - 34, 720, (RL + 20, RL - 10, RL - 10, 0))
    top = diff(top, rect(-1, mid - T / 2 - 1, S + 60, 580))
    low = ring(0, 0, w, mid + T / 2, (0, RL - 20, RL - 20, 0))
    low = diff(low, rect(-1, -1, S + 60, mid + T / 2 + 1))
    return union(top, low, rect(0, 0, S, 580)), w


# ---- Ziffern (Versalhöhe, gleiche Breite für Tabellen)

NUMW = 450


@glyph("zero", 0x30)
def g_0():
    return ring(0, 0, NUMW, CAP, RC), NUMW


@glyph("one", 0x31)
def g_1():
    w = NUMW
    st = rect(w / 2 - S / 2 + 30, 0, w / 2 + S / 2 + 30, CAP)
    flag = poly((w / 2 - S / 2 + 31, CAP), (w / 2 - S / 2 + 31, CAP - 150), (60, CAP - 250), (60, CAP - 110), (w / 2 - 20, CAP))
    return union(st, flag), w


@glyph("two", 0x32)
def g_2():
    w = NUMW
    upper = ring(0, CAP / 2 - 40, w, CAP, RC)
    upper = diff(upper, rect(-1, CAP / 2 - 41, w - S, CAP - 220))
    diag = stroke(w - S / 2 - 6, CAP / 2 + 20, S / 2 + 6, T - 10, S + 26)
    return clip(union(upper, diag, rect(0, 0, w, T)), 0, 0, w, CAP), w


@glyph("three", 0x33)
def g_3():
    w = NUMW
    upper = ring(0, CAP / 2 - T / 2, w - 20, CAP, RC - 10)
    lower = ring(0, 0, w, CAP / 2 + T / 2, RC)
    both = diff(union(upper, lower), rect(-1, T, S + 50, CAP - T))
    return union(both, rect(130, CAP / 2 - T / 2, w - 60, CAP / 2 + T / 2)), w


@glyph("four", 0x34)
def g_4():
    w = NUMW
    st = rect(w - S - 40, 0, w - 40, CAP)
    diag = stroke(w - S - 40 + S / 2 - 10, CAP, S / 2 + 4, 240, S + 10)
    bar = rect(0, 170, w, 170 + T)
    return clip(union(st, diag, bar), 0, 0, w, CAP), w


@glyph("five", 0x35)
def g_5():
    w = NUMW
    lower = ring(0, 0, w, CAP / 2 + 60, (0, RC, RC, RC - 20))
    lower = diff(lower, rect(-1, 120, S + 1, CAP / 2 + 61), rect(S - 1, T, S + 50, CAP / 2 + 60 - T))
    top = rect(0, CAP - T, w - 10, CAP)
    st = rect(0, CAP / 2 + 60 - T, S + 1, CAP)
    return union(lower, top, st), w


@glyph("six", 0x36)
def g_6():
    w = NUMW
    lower = ring(0, 0, w, CAP / 2 + 60, RC)
    back = clip(ring(0, 0, w, CAP, (RC, RC, 0, 0)), 0, CAP / 2 - 100, w, CAP)
    back = diff(back, rect(w - S - 50, CAP / 2 - 101, w + 1, CAP - 210))
    return union(lower, back), w


@glyph("seven", 0x37)
def g_7():
    w = NUMW
    d = stroke(w - S / 2 - 10, CAP - T + 10, 150, 0, S + 16)
    return clip(union(rect(0, CAP - T, w, CAP), d), 0, 0, w, CAP), w


@glyph("eight", 0x38)
def g_8():
    w = NUMW
    upper = ring(14, CAP / 2 - T / 2, w - 14, CAP, RC - 14)
    lower = ring(0, 0, w, CAP / 2 + T / 2, RC)
    return union(upper, lower), w


@glyph("nine", 0x39)
def g_9():
    w = NUMW
    upper = ring(0, CAP / 2 - 60, w, CAP, RC)
    back = clip(ring(0, 0, w, CAP, (0, 0, RC, RC)), 0, 0, w, CAP / 2 + 100)
    back = diff(back, rect(-1, 210, S + 50, CAP / 2 + 101))
    return union(upper, back), w


# ---- Satzzeichen

def sq(x, y, w=S, h=118):
    return poly((x, y), (x + w, y), (x + w + 16, y + h), (x + 16, y + h))


@glyph("space", 0x20)
def g_space():
    return P(), 210


@glyph("period", 0x2E)
def g_period():
    return sq(0, 0), S + 16


@glyph("comma", 0x2C)
def g_comma():
    return union(sq(0, 0), poly((0, 10), (S, 10), (40, -150), (-30, -150))), S + 16


@glyph("colon", 0x3A)
def g_colon():
    return union(sq(0, 0), sq(0, XH - 118)), S + 16


@glyph("semicolon", 0x3B)
def g_semicolon():
    return union(g_comma()[0], sq(0, XH - 118)), S + 16


@glyph("exclam", 0x21)
def g_exclam():
    return union(sq(0, 0), poly((4, 200), (S - 4, 200), (S + 14, CAP), (-6, CAP))), S + 16


@glyph("question", 0x3F)
def g_question():
    w = 400
    upper = ring(0, 270, w, CAP, RC - 20)
    upper = diff(upper, rect(-1, 269, S + 1, CAP - 200), rect(-1, 269, w / 2 - S / 2, 270 + T))
    st = rect(w / 2 - S / 2, 200, w / 2 + S / 2, 380)
    return union(upper, st, sq(w / 2 - S / 2 - 8, 0)), w


@glyph("hyphen", 0x2D)
def g_hyphen():
    return rect(0, 250, 260, 250 + T), 260


@glyph("endash", 0x2013)
def g_endash():
    return rect(0, 250, 480, 250 + T), 480


@glyph("emdash", 0x2014)
def g_emdash():
    return rect(0, 250, 860, 250 + T), 860


def tick(x, y, flip=False):
    if flip:
        return poly((x + 20, y), (x + S, y + 40), (x + S - 10, y + 230), (x + 6, y + 230))
    return poly((x, y), (x + S - 20, y), (x + S + 10, y + 230), (x + 30, y + 230))


@glyph("quotesingle", 0x27)
def g_quotesingle():
    return rect(0, CAP - 240, S - 20, CAP), S - 20


@glyph("quotedbl", 0x22)
def g_quotedbl():
    return union(rect(0, CAP - 240, S - 20, CAP), rect(S + 20, CAP - 240, 2 * S, CAP)), 2 * S


@glyph("quoteright", 0x2019)
def g_quoteright():
    return poly((0, CAP - 250), (60, CAP - 250), (S, CAP), (10, CAP)), S


@glyph("quoteleft", 0x2018)
def g_quoteleft():
    return poly((0, CAP - 250), (S - 10, CAP - 250), (S, CAP), (60, CAP)), S


@glyph("quotedblbase", 0x201E)
def g_quotedblbase():
    a = poly((0, -150), (60, -150), (S, 110), (10, 110))
    return union(a, poly((S + 30, -150), (S + 90, -150), (2 * S + 30, 110), (S + 40, 110))), 2 * S + 30


@glyph("quotedblleft", 0x201C)
def g_quotedblleft():
    a = poly((0, CAP - 250), (S - 10, CAP - 250), (S, CAP), (60, CAP))
    return union(a, poly((S + 30, CAP - 250), (2 * S + 20, CAP - 250), (2 * S + 30, CAP), (S + 90, CAP))), 2 * S + 30


@glyph("quotedblright", 0x201D)
def g_quotedblright():
    a = poly((0, CAP - 250), (60, CAP - 250), (S, CAP), (10, CAP))
    return union(a, poly((S + 30, CAP - 250), (S + 90, CAP - 250), (2 * S + 30, CAP), (S + 40, CAP))), 2 * S + 30


@glyph("parenleft", 0x28)
def g_parenleft():
    w = 230
    return clip(ring(0, -120, w + 300, CAP + 60, (RC, 0, 0, RC)), 0, -120, w, CAP + 60), w


@glyph("parenright", 0x29)
def g_parenright():
    w = 230
    return clip(ring(-300, -120, w, CAP + 60, (0, RC, RC, 0)), 0, -120, w, CAP + 60), w


@glyph("slash", 0x2F)
def g_slash():
    w = 330
    return clip(stroke(50, -80, w - 50, CAP + 40, S - 10), 0, -80, w, CAP + 40), w


@glyph("plus", 0x2B)
def g_plus():
    w = 440
    return union(rect(0, 260 - T / 2 + 30, w, 260 + T / 2 + 30), rect(w / 2 - S / 2 + 6, 80, w / 2 + S / 2 - 6, 500)), w


@glyph("percent", 0x25)
def g_percent():
    w = 640
    a = ring(0, CAP - 300, 230, CAP, 90, sx=90, sy=80)
    b = ring(w - 230, 0, w, 300, 90, sx=90, sy=80)
    return union(a, b, clip(stroke(w - 170, CAP, 170, 0, S - 20), 0, 0, w, CAP)), w


@glyph("ampersand", 0x26)
def g_ampersand():
    w = 520
    upper = ring(30, 370, 380, CAP, RC - 40, sx=S - 10, sy=T - 10)
    lower = ring(0, 0, 400, 420, (RC - 20, 0, RC - 20, RC - 20))
    lower = diff(lower, rect(260, 120, 401, 421))
    leg = stroke(150, 430, w - 70, 0, S + 10)
    bar = rect(300, 230, w, 230 + T)
    return clip(union(upper, lower, leg, bar), 0, 0, w, CAP), w


@glyph("Euro", 0x20AC)
def g_euro():
    w = 480
    c = diff(ring(60, 0, w, CAP, RC), rect(w / 2 + 70, 230, w + 1, CAP - 230))
    b1 = rect(0, 400, 330, 400 + 84)
    b2 = rect(0, 230, 300, 230 + 84)
    return union(c, b1, b2), w


@glyph("at", 0x40)
def g_at():
    w = 720
    outer = ring(0, -80, w, CAP, 200, sx=90, sy=84)
    outer = diff(outer, rect(w - 250, -81, w + 1, 120))
    inner = ring(200, 120, 480, 470, 90, sx=96, sy=90)
    st = rect(480 - 96, 120, 480, 470)
    tail = rect(480 - 96, 120, w - 90, 210)
    return union(outer, inner, st, tail, rect(w - 90, 120, w, 340)), w


@glyph("numbersign", 0x23)
def g_numbersign():
    w = 520
    return clip(union(stroke(170, 0, 230, CAP, 100), stroke(330, 0, 390, CAP, 100),
                      rect(0, 430, w, 520), rect(0, 180, w, 270)), 0, 0, w, CAP), w


@glyph("asterisk", 0x2A)
def g_asterisk():
    w = 360
    c = (w / 2, CAP - 160)
    a = rect(c[0] - 46, c[1] - 160, c[0] + 46, c[1] + 160)
    b = stroke(c[0] - 140, c[1] - 90, c[0] + 140, c[1] + 90, 92)
    d = stroke(c[0] + 140, c[1] - 90, c[0] - 140, c[1] + 90, 92)
    return clip(union(a, b, d), 0, CAP - 330, w, CAP), w


@glyph("guillemotleft", 0xAB)
def g_gl():
    w = 400
    def chev(x):
        return union(stroke(x + 150, 450, x + 40, 260, S - 10), stroke(x + 40, 260, x + 150, 70, S - 10))
    return clip(union(chev(0), chev(170)), 0, 70, w, 450), w


@glyph("guillemotright", 0xBB)
def g_gr():
    w = 400
    def chev(x):
        return union(stroke(x + 40, 450, x + 150, 260, S - 10), stroke(x + 150, 260, x + 40, 70, S - 10))
    return clip(union(chev(10), chev(180)), 0, 70, w, 450), w


@glyph("checkmark", 0x2713)
def g_check():
    w = 560
    return clip(union(stroke(60, 300, 200, 0, S + 10), stroke(200, 0, w - 60, CAP - 120, S + 10)), 0, 0, w, CAP - 120), w


@glyph("arrowright", 0x2192)
def g_arrow():
    w = 640
    shaft = rect(0, 250, w - 120, 250 + T)
    head = union(stroke(w - 230, 520, w - 60, 302, S), stroke(w - 60, 302, w - 230, 84, S))
    return clip(union(shaft, head), 0, 84, w, 520), w


# ---- Umlaute

def with_dots(base, xs, y):
    def fn():
        p, w = G[base][0]()
        return union(p, *[dot(x, y) for x in xs(w)]), w
    return fn


for name, uni, base, y in [
    ("Adieresis", 0xC4, "A", CAP + 60), ("Odieresis", 0xD6, "O", CAP + 60), ("Udieresis", 0xDC, "U", CAP + 60),
    ("adieresis", 0xE4, "a", XH + 70), ("odieresis", 0xF6, "o", XH + 70), ("udieresis", 0xFC, "u", XH + 70),
]:
    G[name] = (with_dots(base, lambda w: (w / 2 - 92, w / 2 + 92), y), uni)


# ---------------------------------------------------------------- Kerning

FEA = """
languagesystem DFLT dflt;
languagesystem latn dflt;
@round = [O Q C G D zero];
@diagL = [A];
@diagR = [V W Y T];
feature kern {
  pos T [a c e o s u adieresis odieresis udieresis] -70;
  pos T [A Adieresis] -40;
  pos [A Adieresis] T -40;
  pos [A Adieresis] [V W Y] -36;
  pos [V W Y] [A Adieresis] -36;
  pos [V W Y] [a e o u odieresis adieresis udieresis] -44;
  pos L [T V W Y] -60;
  pos L quoteright -80;
  pos P [A Adieresis] -40;
  pos P [period comma] -110;
  pos [T V W Y F] [period comma] -90;
  pos r [period comma] -60;
  pos [v w y] [period comma] -50;
  pos f [a e o] -10;
  pos quotedblbase [T V W Y] -80;
} kern;
"""


# ---------------------------------------------------------------- Bauen

def build():
    order = [".notdef"] + list(G.keys())
    cmap = {uni: name for name, (fn, uni) in G.items() if uni}
    charstrings = {}
    metrics = {}

    pen = T2CharStringPen(500, None)
    nd = union(rect(40, 0, 460, CAP), )
    nd = diff(nd, rect(100, 60, 400, CAP - 60))
    nd.draw(pen)
    charstrings[".notdef"] = pen.getCharString()
    metrics[".notdef"] = (500, 40)

    for name, (fn, uni) in G.items():
        path, width = fn()
        bounds = path.bounds if len(list(path.contours)) else None
        adv = int(round(width + 2 * SB))
        pen = T2CharStringPen(adv, None)
        tpen = TransformPen(pen, (1, 0, 0, 1, SB, 0))
        path.draw(tpen)
        charstrings[name] = pen.getCharString()
        lsb = int(round(bounds[0] + SB)) if bounds else 0
        metrics[name] = (adv, lsb)

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    ps_name = FAMILY.replace(" ", "") + "-Bold"
    fb.setupCFF(ps_name, {"FullName": FAMILY + " Bold", "FamilyName": FAMILY, "Weight": "Bold"}, charstrings, {})
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASC + 60, descent=DESC - 40)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Bold",
        "uniqueFontIdentifier": f"{ps_name};{VERSION}",
        "fullName": FAMILY + " Bold",
        "psName": ps_name,
        "version": f"Version {VERSION}",
        "copyright": "Copyright 2026 Fundament. Hausschrift der digitalen Schule.",
        "licenseDescription": "Hausschrift. Nutzung für die eigene Website und eigene Materialien.",
    })
    fb.setupOS2(
        sTypoAscender=ASC + 60, sTypoDescender=DESC - 40, sTypoLineGap=0,
        usWinAscent=ASC + 120, usWinDescent=-(DESC - 60),
        sxHeight=XH, sCapHeight=CAP, usWeightClass=700, fsSelection=0x20, achVendID="FNDM",
    )
    fb.setupPost()
    addOpenTypeFeaturesFromString(fb.font, FEA)

    os.makedirs(OUT_DIR, exist_ok=True)
    otf = os.path.join(OUT_DIR, "fundament-display.otf")
    fb.font.save(otf)
    f = TTFont(otf)
    f.flavor = "woff2"
    f.save(os.path.join(OUT_DIR, "fundament-display.woff2"))
    print(f"{len(order)} Glyphen gebaut → {otf} (+ .woff2)")
    return otf


if __name__ == "__main__":
    sys.exit(0 if build() else 1)
