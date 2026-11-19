"""시간표 사진 / .ics 분석. 제목·장소·과목명은 읽지 않고 시간 블록(0/1)만 만든다."""
import io
import re
from datetime import datetime, timedelta, date

import numpy as np

DAYS = 7
START_H, END_H = 8, 24
SLOTS = (END_H - START_H) * 2  # 30분 단위 32칸


def empty_grid():
    return np.zeros((DAYS, SLOTS), dtype=np.uint8)


def grid_to_str(g):
    return "".join(str(int(v)) for v in g.reshape(-1))


def str_to_grid(s):
    if not s or len(s) != DAYS * SLOTS:
        return empty_grid()
    return np.array([int(c) for c in s], dtype=np.uint8).reshape(DAYS, SLOTS)


def _runs(flags):
    out, i, n = [], 0, len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            out.append((i + j - 1) / 2)
            i = j
        else:
            i += 1
    return out


def _mode_gap(pos, lo):
    gaps = [int(round(b - a)) for a, b in zip(pos, pos[1:]) if b - a >= lo]
    if not gaps:
        return None
    best = max(gaps, key=lambda g: sum(1 for x in gaps if abs(x - g) <= max(3, g * 0.06)))
    near = [x for x in gaps if abs(x - best) <= max(3, best * 0.06)]
    return sum(near) / len(near)


def _detect_grid(arr):
    """시간표 격자선(옅은 회색)을 찾아 (x0, 칸너비, 요일수, y0, 한 시간 높이)를 돌려준다."""
    h, w, _ = arr.shape
    mx, mn = arr.max(axis=2), arr.min(axis=2)
    g = arr.mean(axis=2)
    base = (mx - mn) < 14
    k = 4
    sat = (mx - mn) > 40
    lrange = base & (g > 190) & (g < 253)

    def edge(ax):
        dark = (g < np.roll(g, k, axis=ax) - 4) & (g < np.roll(g, -k, axis=ax) - 4)
        near = np.roll(sat, k, axis=ax) | np.roll(sat, -k, axis=ax)
        return lrange & (dark | near)

    lv, lh = edge(1), edge(0)
    xs = _runs(lv[k:-k, k:-k].mean(axis=0) > 0.3)
    ys = _runs(lh[k:-k, k:-k].mean(axis=1) > 0.3)
    xs = [x + k for x in xs]
    ys = [y + k for y in ys]
    W = _mode_gap(xs, w * 0.06)
    H = _mode_gap(ys, h * 0.04)
    if not W or not H:
        return None
    colx = [x for x in xs]
    first = None
    for a, b in zip(colx, colx[1:]):
        if abs((b - a) - W) <= W * 0.08:
            first = a
            break
    cols = 0
    if first is not None:
        x = first
        while any(abs(c - (x + W)) <= W * 0.08 for c in colx):
            cols += 1
            x += W
        if cols == 0:
            return None
    top = None
    for a, b in zip(ys, ys[1:]):
        if abs((b - a) - H) <= H * 0.08:
            top = a
            break
    if top is None or first is None or not 3 <= cols <= 7:
        return None
    return first, W, cols, top, H


def analyze_image(data, days=5, start_h=9, end_h=18, left=9.0, top=7.0, start_min=None, row_min=60):
    if start_min is None:
        start_min = start_h * 60
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img.draft("RGB", (1300, 1300))
    img = img.convert("RGB")
    img.thumbnail((1200, 1600))
    arr = np.asarray(img, dtype=np.int16)
    h, w, _ = arr.shape

    sat = (arr.max(axis=2) - arr.min(axis=2)) > 40
    if sat.mean() > 0.004:
        mask = sat.astype(np.float32)
    else:
        q = (arr // 16).reshape(-1, 3)
        key = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
        vals, counts = np.unique(key, return_counts=True)
        bgk = int(vals[np.argmax(counts)])
        bg = np.array([(bgk // 256) * 16 + 8, ((bgk // 16) % 16) * 16 + 8, (bgk % 16) * 16 + 8])
        mask = (np.abs(arr - bg).max(axis=2) > 30).astype(np.float32)

    geo = _detect_grid(arr)
    out = empty_grid()
    if geo:
        x0, W, cols, y0, H = geo
        px_per_min = H / row_min
        t_end = START_H * 60 + SLOTS * 30
        for d in range(min(cols, DAYS)):
            xa, xb = int(x0 + d * W + W * 0.06), int(x0 + (d + 1) * W - W * 0.06)
            for slot in range(SLOTS):
                t0 = START_H * 60 + slot * 30
                ya = int(y0 + (t0 - start_min) * px_per_min)
                yb = int(y0 + (t0 + 30 - start_min) * px_per_min)
                if yb <= y0 or ya >= h:
                    continue
                ya, yb = max(ya, int(y0)), min(yb, h)
                if yb - ya < 15 * px_per_min * 0.9:
                    continue
                cell = mask[ya:yb, xa:xb]
                if cell.size and cell.mean() > 0.4:
                    out[d, slot] = 1
        return out

    x0, y0 = int(w * left / 100), int(h * top / 100)
    mask = mask[y0:, x0:]
    mh, mw = mask.shape
    rows = max(1, (end_h - start_h) * 2)
    for d in range(days):
        for r in range(rows):
            ya, yb = int(mh * r / rows), int(mh * (r + 1) / rows)
            xa, xb = int(mw * d / days), int(mw * (d + 1) / days)
            cell = mask[ya:yb, xa:xb]
            if cell.size and cell.mean() > 0.4:
                slot = (start_h - START_H) * 2 + r
                if 0 <= slot < SLOTS:
                    out[d, slot] = 1
    return out


_DT = re.compile(r"^(DTSTART|DTEND)([^:]*):(.+)$")


def _parse_dt(params, val):
    val = val.strip()
    if "VALUE=DATE" in params or len(val) == 8:
        return datetime.strptime(val[:8], "%Y%m%d"), True
    utc = val.endswith("Z")
    dt = datetime.strptime(val.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if utc:
        dt += timedelta(hours=9)
    return dt, False


def analyze_ics(text, week_start):
    text = re.sub(r"\r?\n[ \t]", "", text)
    out = empty_grid()
    start = datetime.combine(week_start, datetime.min.time())
    end = start + timedelta(days=7)
    cur = None
    for line in text.splitlines():
        if line.startswith("BEGIN:VEVENT"):
            cur = {}
        elif line.startswith("END:VEVENT") and cur is not None:
            s, e = cur.get("DTSTART"), cur.get("DTEND")
            cur = None
            if not s:
                continue
            s_dt, allday = s
            e_dt = e[0] if e else s_dt + timedelta(hours=1)
            if allday:
                continue
            if e_dt <= start or s_dt >= end:
                continue
            s_dt, e_dt = max(s_dt, start), min(e_dt, end)
            t = s_dt
            while t < e_dt:
                slot_start = t.hour * 2 + (1 if t.minute >= 30 else 0)
                slot = slot_start - START_H * 2
                base = t.replace(minute=30 if t.minute >= 30 else 0, second=0, microsecond=0)
                nxt = base + timedelta(minutes=30)
                if 0 <= slot < SLOTS:
                    out[(t.date() - week_start).days, slot] = 1
                t = nxt
        elif cur is not None:
            m = _DT.match(line)
            if m:
                try:
                    cur[m.group(1)] = _parse_dt(m.group(2), m.group(3))
                except ValueError:
                    pass
    return out


def slot_label(s):
    m = START_H * 60 + s * 30
    return f"{m // 60:02d}:{m % 60:02d}"


def recommend(grids, names, min_slots=4, mode="all", limit=3):
    n = len(grids)
    if n == 0:
        return {"mode": "none", "items": []}
    busy = np.stack(grids) > 0  # n, 7, 32
    free_cnt = n - busy.sum(axis=0)

    def build(required):
        items = []
        for d in range(DAYS):
            if mode == "weekend" and d < 5:
                continue
            ok = free_cnt[d] >= required
            s = 0
            while s < SLOTS:
                if not ok[s]:
                    s += 1
                    continue
                e = s
                while e < SLOTS and ok[e]:
                    e += 1
                if e - s >= min_slots:
                    best = None
                    for a in range(s, e - min_slots + 1):
                        b = a + min_slots
                        t0, t1 = START_H * 60 + a * 30, START_H * 60 + b * 30
                        if mode == "lunch" and not (t0 >= 690 and t1 <= 870):
                            continue
                        if mode == "dinner" and not (t0 >= 1050 and t1 <= 1290):
                            continue
                        sc = 0.0
                        mid = (t0 + t1) / 2
                        if 690 <= mid <= 840:
                            sc += 2
                        if 1050 <= mid <= 1230:
                            sc += 3
                        if d >= 5:
                            sc += 2
                        sc += min(e - s, 12) * 0.3
                        if t1 > 1380:
                            sc -= 3
                        if t0 < 600:
                            sc -= 1.5
                        if best is None or sc > best[0]:
                            best = (sc, a, b)
                    if best:
                        sc, a, b = best
                        missing = [names[i] for i in range(n) if busy[i, d, a:b].any()]
                        items.append({"day": d, "start": slot_label(a), "end": slot_label(b), "score": round(sc, 1), "missing": missing})
                s = e
        items.sort(key=lambda x: -x["score"])
        picked, used = [], set()
        for it in items:
            if it["day"] not in used:
                picked.append(it)
                used.add(it["day"])
        for it in items:
            if len(picked) >= limit:
                break
            if it not in picked:
                picked.append(it)
        return picked[:limit]

    full = build(n)
    if full:
        return {"mode": "all", "items": full}
    if n >= 3:
        part = build(n - 1)
        if part:
            return {"mode": "almost", "items": part}
    return {"mode": "none", "items": []}
