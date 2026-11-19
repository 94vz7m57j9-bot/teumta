import json
import random
import secrets
from datetime import date, datetime, timedelta, timezone

from workers import WorkerEntrypoint
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel

import numpy as np
import analyze as A

app = FastAPI()
DAY_KO = ["월", "화", "수", "목", "금", "토", "일"]
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def db(req):
    return req.scope["env"].DB


async def rows(stmt):
    r = await stmt.all()
    res = r.results
    return res.to_py() if hasattr(res, "to_py") else list(res)


class NewRoom(BaseModel):
    title: str
    name: str


class Join(BaseModel):
    name: str


class SaveGrid(BaseModel):
    grid: str


async def get_room(req, code):
    code = code.upper()
    r = await db(req).prepare("SELECT code,title FROM rooms WHERE code=?").bind(code).first()
    if r is None:
        raise HTTPException(404, "모임을 찾을 수 없어요. 코드를 다시 확인해 주세요.")
    return r.to_py() if hasattr(r, "to_py") else dict(r)


def kst_today():
    return (datetime.now(timezone.utc) + timedelta(hours=9)).date()


def this_week():
    t = kst_today()
    return (t - timedelta(days=t.weekday())).isoformat()


def reset_info():
    t = kst_today()
    return (t - timedelta(days=t.weekday()) + timedelta(days=7)).isoformat()


async def get_members(req, code):
    ms = await rows(db(req).prepare("SELECT id,name,token,grid,is_host,week FROM members WHERE room_code=? ORDER BY id").bind(code.upper()))
    wk = this_week()
    for m in ms:
        if m["week"] != wk:
            m["grid"] = m["grid"].replace("2", "0").replace("3", "0")
    return ms


async def me_of(req, code):
    token = req.headers.get("x-member-token", "")
    for m in await get_members(req, code):
        if m["token"] == token:
            return m
    raise HTTPException(401, "참여 정보가 없어요. 이름을 입력하고 다시 참여해 주세요.")


def clean_name(n):
    n = (n or "").strip()[:12]
    if not n:
        raise HTTPException(400, "이름을 입력해 주세요.")
    return n


async def add_member(req, code, name, host):
    token = secrets.token_urlsafe(16)
    await db(req).prepare("INSERT INTO members (room_code,name,token,grid,is_host,week) VALUES (?,?,?,?,?,?)").bind(
        code, name, token, A.grid_to_str(A.empty_grid()), 1 if host else 0, this_week()
    ).run()
    return token


@app.post("/api/rooms", status_code=201)
async def create_room(body: NewRoom, req: Request):
    title = body.title.strip()[:40] or "우리 약속"
    name = clean_name(body.name)
    code = "".join(random.choice(ALPHABET) for _ in range(6))
    await db(req).prepare("INSERT INTO rooms (code,title) VALUES (?,?)").bind(code, title).run()
    token = await add_member(req, code, name, True)
    return {"code": code, "token": token}


@app.post("/api/rooms/{code}/join")
async def join_room(code: str, body: Join, req: Request):
    room = await get_room(req, code)
    name = clean_name(body.name)
    members = await get_members(req, room["code"])
    if len(members) >= 30:
        raise HTTPException(400, "참여 인원이 가득 찼어요.")
    if any(m["name"] == name for m in members):
        raise HTTPException(400, "같은 이름이 이미 있어요. 다른 이름으로 참여해 주세요.")
    token = await add_member(req, room["code"], name, False)
    return {"code": room["code"], "token": token}


@app.get("/api/rooms/{code}")
async def room_view(code: str, req: Request):
    room = await get_room(req, code)
    members = await get_members(req, room["code"])
    token = req.headers.get("x-member-token", "")
    me = None
    others = []
    for m in members:
        masked = "".join("1" if c != "0" else "0" for c in m["grid"])
        if m["token"] == token:
            me = {"name": m["name"], "grid": m["grid"], "is_host": bool(m["is_host"])}
            others.append({"name": m["name"], "grid": masked, "me": True})
        else:
            others.append({"name": m["name"], "grid": masked, "me": False})
    return {"room": room, "me": me, "members": others, "reset_on": reset_info()}


@app.put("/api/rooms/{code}/me")
async def save_me(code: str, body: SaveGrid, req: Request):
    me = await me_of(req, code)
    g = body.grid
    if len(g) != A.DAYS * A.SLOTS or any(c not in "0123" for c in g):
        raise HTTPException(400, "시간표 형식이 올바르지 않아요.")
    await db(req).prepare("UPDATE members SET grid=?, week=? WHERE id=?").bind(g, this_week(), me["id"]).run()
    return {"ok": True}


@app.delete("/api/rooms/{code}/me")
async def leave(code: str, req: Request):
    me = await me_of(req, code)
    await db(req).prepare("DELETE FROM members WHERE id=?").bind(me["id"]).run()
    return {"ok": True}


async def do_recommend(req, code, minutes, mode):
    room = await get_room(req, code)
    members = await get_members(req, room["code"])
    grids = [A.str_to_grid(m["grid"]) for m in members]
    res = A.recommend(grids, [m["name"] for m in members], max(1, min(minutes // 30, 16)), mode)
    for it in res["items"]:
        it["day_name"] = DAY_KO[it["day"]]
    res["people"] = len(members)
    res["title"] = room["title"]
    return res


@app.get("/api/rooms/{code}/recommend")
async def recommend(code: str, req: Request, minutes: int = 120, mode: str = "all"):
    if mode not in ("all", "lunch", "dinner", "weekend"):
        mode = "all"
    return await do_recommend(req, code, minutes, mode)


def monday_of(s):
    try:
        d = date.fromisoformat(s) if s else date.today()
    except ValueError:
        d = date.today()
    return d - timedelta(days=d.weekday())


@app.post("/api/analyze/image")
async def analyze_image(req: Request, days: int = 5, start: int = 9, end: int = 18, left: float = 9.0, top: float = 7.0, temp: int = 0, start_min: int = -1, row_min: int = 60):
    data = await req.body()
    if not data or len(data) > 8_000_000:
        raise HTTPException(400, "사진은 8MB 이하로 올려 주세요.")
    days = 7 if days >= 6 else 5
    start = max(A.START_H, min(start, A.END_H - 1))
    end = max(start + 1, min(end, A.END_H))
    try:
        g = A.analyze_image(data, days, start, end, max(0, min(left, 30)), max(0, min(top, 30)), start_min if start_min >= 0 else None, max(30, min(row_min, 120)))
    except Exception:
        raise HTTPException(400, "사진을 읽지 못했어요. png나 jpg 시간표 캡처를 올려 주세요.")
    if temp:
        g = np.where(g > 0, 3, 0)
    return {"grid": A.grid_to_str(g)}


@app.post("/api/analyze/ics")
async def analyze_ics(req: Request, week: str = ""):
    raw = await req.body()
    if not raw or len(raw) > 4_000_000:
        raise HTTPException(400, "캘린더 파일은 4MB 이하로 올려 주세요.")
    text = raw.decode("utf-8", errors="ignore")
    if "BEGIN:VCALENDAR" not in text:
        raise HTTPException(400, ".ics 캘린더 파일이 아니에요.")
    monday = monday_of(week)
    g = np.where(A.analyze_ics(text, monday) > 0, 3, 0)
    return {"grid": A.grid_to_str(g), "week_start": monday.isoformat()}


@app.post("/api/kakao/skill")
async def kakao_skill(req: Request):
    """카카오 i 오픈빌더 스킬 서버용: 발화나 파라미터 'room'에 모임 코드를 넣으면 추천 시간을 답한다."""
    body = await req.json()
    action = body.get("action", {}) or {}
    code = (action.get("params", {}) or {}).get("room") or ""
    if not code:
        for w in (body.get("userRequest", {}).get("utterance", "") or "").upper().split():
            if len(w) == 6 and all(c in ALPHABET for c in w):
                code = w
                break

    def text(t):
        return {"version": "2.0", "template": {"outputs": [{"simpleText": {"text": t}}]}}

    if not code:
        return text("모임 코드 6자리를 함께 보내 주세요. 예) 약속 K7M2QX")
    try:
        res = await do_recommend(req, code, 120, "all")
    except HTTPException as e:
        return text(e.detail)
    if not res["items"]:
        return text(f"[{res['title']}] 모두 가능한 시간을 아직 찾지 못했어요.")
    lines = [f"[{res['title']}] 추천 시간 ({res['people']}명)"]
    for i, it in enumerate(res["items"], 1):
        extra = f" (불가: {', '.join(it['missing'])})" if it["missing"] else ""
        lines.append(f"{i}. {it['day_name']}요일 {it['start']}~{it['end']}{extra}")
    return text("\n".join(lines))


@app.get("/api/config")
async def config(req: Request):
    env = req.scope["env"]
    key = getattr(env, "KAKAO_JS_KEY", None)
    return {"kakao_js_key": str(key) if key else ""}


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        import asgi

        return await asgi.fetch(app, request.js_object, self.env)
