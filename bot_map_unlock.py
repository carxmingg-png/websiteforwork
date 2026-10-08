#!/usr/bin/env python3
"""CARX MAP UNLOCK TOOL — Exact logic from carx_v19.py"""
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

# Maps — hardcoded from GameWorldPartType enum (from carx_v19.py)
Ds = ["industrial", "midtown", "suburb", "port", "mountain", "sunset"]
M = {
    "game_world_parts": {},
    "locations": {},
    "race_generators": {},
    "clubs": {},
    "real_estates": {},
    "real_estate_slots": {},
    "car_to_club": {},
    "car_to_real_estate_slot": {}
}

for d in Ds:
    M["game_world_parts"][d] = {"unlocked": True}

for d in Ds:
    for t in ["tuning_shop", "styling_shop", "dealership", "gas_station", "race_location", "club_location"]:
        M["locations"][f"{d}_{t}"] = {"type": t, "unlocked": True}
    for rt in ["circuit", "sprint", "drift", "time_attack"]:
        M["race_generators"][f"{d}_race_{rt}_01"] = {"type": rt, "unlocked": True}

for c in [
    "club_burnout_rangers", "club_black_lotus", "club_arctic_outlaws",
    "club_speedstar_energy", "club_grip_masters", "club_chimeras",
    "club_savage", "club_hyper_sonic", "club_white_tigers",
    "club_scorpions", "club_red_dragons", "club_electric_dream",
    "club_phantom_riders", "club_midnight_wolves", "club_iron_phoenix",
    "club_shadow_racers", "club_velocity_kings", "club_steel_titans",
    "club_neon_rebels"
]:
    M["clubs"][c] = {"joined": True}

for e in [
    "apartment_01", "suburb_house", "port_loft", "industrial_warehouse",
    "mountain_cabin", "sunset_villa", "beach_condo", "midtown_apartment_02",
    "downtown_penthouse", "apartment_51", "apartment_95"
]:
    M["real_estates"][e] = {"slots": 6, "owned": True}



# Crypto (exact carx_v19.py)
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

def DM(a, b):
    for k, v in b.items():
        if k in a and isinstance(a[k], dict) and isinstance(v, dict):
            DM(a[k], v)
        else:
            a[k] = v

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
    p["data_version"] = (p.get("data_version", 0) or 0) + 1
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

    # Inject exact maps payload
    for k, v in M.items():
        if k in profile and isinstance(profile[k], dict):
            DM(profile[k], v)
        else:
            profile[k] = v

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
        print(json.dumps({"success": True, "message": "✅ Done. Maps and Houses successfully unlocked!", "stats": stats, "profile": profile}))
    else:
        print(json.dumps({"success": False, "message": f"❌ Save failed: {err}"}))

if __name__ == "__main__":
    main()
