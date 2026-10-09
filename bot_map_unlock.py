#!/usr/bin/env python3
"""CARX MAP UNLOCK TOOL — Clean 1:1 Logic from map&php&house.py"""
import sys
import json
import base64
import gzip
import time
import uuid
import requests

SYNC = "https://street-prod.carx-online.com/str/v1/client/profiles"
U = "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)"
T = 60
W = 3

ALL_MAP_PARTS = ["industrial", "midtown", "suburb", "port", "mountain", "sunset"]

NEW_SHOP_PACKS = [
    "special_avatars", "special_banners", "special_frames", "special_emoji",
    "special_8", "special_11", "special_14", "special_15", "special_78",
]

DEFAULT_REAL_ESTATES = [
    "apartment_01", "suburb_house", "port_loft", "industrial_warehouse",
    "mountain_cabin", "sunset_villa", "beach_condo", "midtown_apartment_02",
    "downtown_penthouse", "apartment_51", "apartment_95"
]

def unlock_maps(data):
    gwp = data.setdefault("game_world_parts", {})
    for part in ALL_MAP_PARTS:
        gwp.setdefault(part, {})["unlocked"] = True

def unlock_profile(data):
    car_id = data.get("current_car_id", "1000")
    slots = data.setdefault("real_estate_slots", {})
    for i, key in enumerate(["apartment_95_slot_0", "apartment_95_slot_1", "apartment_95_slot_2"]):
        slots.setdefault(key, {})["unlocked"] = True
        if i == 0:
            slots[key]["car_id"] = str(car_id)
    data["car_to_real_estate_slot"] = {"keys": [str(car_id)], "values": ["apartment_95_slot_0"]}

    keys = data.setdefault("shop_owned_packs", {"keys": []}).setdefault("keys", [])
    added = [p for p in NEW_SHOP_PACKS if p not in keys]
    keys.extend(added)

    data["emoji"] = {"keys": ["0", "1", "2", "3"], "values": ["emoji_1", "emoji_2", "emoji_3", "emoji_4"]}

def unlock_all_houses(data):
    re = data.setdefault("real_estates", {})
    if not re:
        for k in DEFAULT_REAL_ESTATES:
            re[k] = {"is_bought": True}
    else:
        for key in list(re.keys()):
            if isinstance(re[key], dict):
                re[key]["is_bought"] = True
            else:
                re[key] = {"is_bought": True}
        for k in DEFAULT_REAL_ESTATES:
            if k not in re:
                re[k] = {"is_bought": True}
    data["real_estates"] = re
    data["data_version"] = max(74, (data.get("data_version", 0) or 0) + 1)
    data["playerDataVersion"] = max(74, (data.get("playerDataVersion", 0) or 0) + 1)

# Crypto (exact CarX protocol)
def E(d):
    j = json.dumps(d, separators=(',', ':')).encode()
    return "l84l" + base64.b64encode(b"\x00" + gzip.compress(j, compresslevel=1)).decode()

def D(c):
    try:
        if c.startswith("l84l"):
            raw = base64.b64decode(c[4:])
            gz = raw[1:] if raw[0] == 0 else raw
            return json.loads(gzip.decompress(gz))
        else:
            raw = base64.b64decode(c)
            try:
                return json.loads(gzip.decompress(raw[4:]))
            except:
                return json.loads(gzip.decompress(raw))
    except:
        return {}

def F(d):
    if not isinstance(d, dict):
        return None
    if "compressed_data" in d:
        return d
    for v in d.values():
        r = F(v)
        if r:
            return r
    return None

def H(t, cid="", dev=""):
    headers = {
        "User-Agent": U,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Project": "STREET",
        "Authorization": f"Bearer {t}",
        "x-token": t,
        "Origin": "https://carx-online.com"
    }
    if cid:
        headers["X-CarX-Id"] = cid
    if dev:
        headers["X-Device-Id"] = dev
    return headers

def G(t, cid="", dev=""):
    try:
        r = requests.get(SYNC, headers=H(t, cid, dev), timeout=T)
        if r.status_code != 200:
            return False, {}, f"HTTP {r.status_code}: {r.text[:200]}", None
        j = r.json()
        c = F(j)
        if c and "compressed_data" in c:
            return True, D(c["compressed_data"]), None, j
        return True, {}, None, j
    except Exception as ex:
        return False, {}, str(ex), None

def P(t, cid, dev, p, envelope=None):
    enc = E(p)
    body = {"compressed_data": enc}
    if envelope and isinstance(envelope, dict):
        c = F(envelope)
        if c:
            c["compressed_data"] = enc
            body = envelope

    for _ in range(W):
        try:
            r = requests.post(SYNC, headers=H(t, cid, dev), json=body, timeout=T)
            if r.status_code == 200:
                return True, None
            return False, r.json().get("e", {}).get("message", "") or r.text[:200]
        except Exception as ex:
            if _ == W - 1:
                return False, str(ex)
            time.sleep(2)
    return False, "Save failed"

def S(t, cid, dev, p, envelope=None):
    p["data_version"] = max(74, (p.get("data_version", 0) or 0) + 1)
    p["playerDataVersion"] = max(74, (p.get("playerDataVersion", 0) or 0) + 1)
    p["messaging_version"] = p.get("messaging_version", 1) or 1
    p["model_upgrade_version"] = p.get("model_upgrade_version", 1) or 1
    return P(t, cid, dev, p, envelope)

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "message": "No token provided"}))
        sys.exit(1)

    raw_token = sys.argv[1].strip()
    token = raw_token[7:].strip() if raw_token.startswith("Bearer ") else raw_token
    cid = sys.argv[2].strip() if len(sys.argv) > 2 else ""
    dev = sys.argv[3].strip() if len(sys.argv) > 3 else str(uuid.uuid4()).replace("-", "")[:32]

    ok_g, profile, err, envelope = G(token, cid, dev)
    if not ok_g or not profile:
        print(json.dumps({"success": False, "message": f"Failed to get profile: {err or 'Empty profile'}"}))
        sys.exit(1)

    # Clean map & houses & profile unlock matching map&php&house.py
    unlock_maps(profile)
    unlock_profile(profile)
    unlock_all_houses(profile)

    ok_s, err = S(token, cid, dev, profile, envelope)
    if ok_s:
        res = profile.get("resources", {}) or {}
        silver = res.get("soft", {}).get("amount", 0) if isinstance(res.get("soft"), dict) else res.get("soft", 0)
        gold = res.get("hard", {}).get("amount", 0) if isinstance(res.get("hard"), dict) else res.get("hard", 0)
        xp = res.get("experience", {}).get("amount", 0) if isinstance(res.get("experience"), dict) else res.get("experience", 0)
        gwp = profile.get("game_world_parts", {}) or {}
        maps_count = sum(1 for v in gwp.values() if isinstance(v, dict) and v.get("unlocked"))
        estates = profile.get("real_estates", {}) or {}
        estates_count = len(estates)
        cars_items = profile.get("cars", {}).get("items", profile.get("cars", {}))
        cars_count = len(cars_items) if isinstance(cars_items, dict) else 0

        stats = {
            "cash": silver,
            "gold": gold,
            "exp": xp,
            "maps_count": maps_count,
            "real_estates_count": estates_count,
            "cars_count": cars_count
        }
        print(json.dumps({"success": True, "message": "✅ Done. Maps and Houses successfully unlocked safely!", "stats": stats, "profile": profile}))
    else:
        print(json.dumps({"success": False, "message": f"❌ Save failed: {err}"}))

if __name__ == "__main__":
    main()
