#!/usr/bin/env python3
"""
CarX Street - Account Data Extractor & Multi-Part Implanter
Extract whole account or individual parts from active and banned accounts.
Saves as JSON + compressed string.
"""

import base64
import gzip
import json
import requests
import os
import sys
import argparse
import time
from datetime import datetime

# ============================================================
# CONFIGURATION
# ============================================================

USER_AGENT = 'UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)'
AUTH_URL = 'https://carx-id-prod.carx-online.com/api/auth'
PROFILE_URL = 'https://street-prod.carx-online.com/str/v1/client/profiles'

SAVE_FOLDER = os.path.join(os.getcwd(), "carx_extracted")

PARTS = {
    'cars':         {'path': 'cars.items',                         'desc': 'All cars in garage'},
    'maps':         {'path': 'game_world_parts',                   'desc': 'Unlocked maps'},
    'resources':    {'path': 'resources',                          'desc': 'Silver, gold, XP'},
    'premium':      {'path': 'has_premium',                        'desc': 'Street Pass status'},
    'stats':        {'path': 'statistics',                         'desc': 'Player statistics'},
    'quests':       {'path': 'quests',                             'desc': 'Quest progress'},
    'achievements': {'path': 'achievements',                       'desc': 'Achievements'},
    'business':     {'path': 'business_car_deliveries_completed',  'desc': 'Business progress'},
    'tuning':       {'path': 'tuning',                             'desc': 'Tuning parts'},
    'styling':      {'path': 'styling',                            'desc': 'Visual items'},
    'friends':      {'path': 'friends',                            'desc': 'Friend list'},
    'real_estates': {'path': 'real_estates',                       'desc': 'Properties'},
    'shop_packs':   {'path': 'shop_owned_packs',                   'desc': 'Shop packs'},
    'unlocks':      {'path': 'unlocks',                            'desc': 'Unlocked content'},
    'battle_pass':  {'path': 'battle_pass_event_rewards',          'desc': 'Battle pass'},
    'locations':    {'path': 'locations',                          'desc': 'All locations'},
    'clubs':        {'path': 'clubs',                              'desc': 'All clubs'},
    'slots':        {'path': 'real_estate_slots',                  'desc': 'Garage slots'},
    'races':        {'path': 'race_generators',                    'desc': 'Race generators'},
}

# ============================================================
# API
# ============================================================

def login(email, password):
    """Multi-strategy login to support regular and banned accounts"""
    clean_email = email.strip()
    clean_pass = password.strip()

    strategies = [
        # Strategy 1: User's exact extractor payload (deviceId = email)
        {
            'url': f'{AUTH_URL}/login',
            'data': {'deviceId': clean_email, 'deviceUniqueId': clean_email, 'username': clean_email, 'password': clean_pass, 'project': 'STREET'},
            'headers': {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}
        },
        # Strategy 2: Clean STREET login without deviceId (carx_v19.py)
        {
            'url': f'{AUTH_URL}/login',
            'data': {'project': 'STREET', 'username': clean_email, 'password': clean_pass},
            'headers': {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}
        },
        # Strategy 3: Project 4 form-urlencoded
        {
            'url': f'{AUTH_URL}/login',
            'data': {'project': '4', 'username': clean_email, 'password': clean_pass},
            'headers': {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded'}
        },
        # Strategy 4: Project 4 JSON payload (Android platform)
        {
            'url': f'{AUTH_URL}/login',
            'json': {'username': clean_email, 'password': clean_pass, 'project': 4, 'platform': 'android'},
            'headers': {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Content-Type': 'application/json'}
        }
    ]

    last_err = ""
    for s in strategies:
        try:
            if 'data' in s:
                r = requests.post(s['url'], data=s['data'], headers=s['headers'], timeout=15)
            else:
                r = requests.post(s['url'], json=s['json'], headers=s['headers'], timeout=15)

            if r.status_code == 200:
                data = r.json().get('d', {})
                if data and 'token' in data:
                    return data['token'], data.get('carxId', data.get('carx_id', ''))
            else:
                try:
                    err_json = r.json()
                    last_err = err_json.get('e', {}).get('message', '') or err_json.get('message', '') or f"HTTP {r.status_code}"
                except Exception:
                    last_err = f"HTTP {r.status_code}"
        except Exception as e:
            last_err = str(e)

    print(f"  ❌ Login failed: {last_err}")
    return None, None

def find_compressed_data(d):
    """Recursively search for compressed_data in envelope"""
    if isinstance(d, dict):
        if 'compressed_data' in d and isinstance(d['compressed_data'], str) and len(d['compressed_data']) > 0:
            return d['compressed_data']
        for v in d.values():
            res = find_compressed_data(v)
            if res:
                return res
    return None

def get_raw_compressed(token):
    """Get raw compressed string from server using minimal and extended headers"""
    headers_list = [
        # Strategy 1: User's exact minimal headers (avoids ban filters)
        {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Authorization': f'Bearer {token}'},
        # Strategy 2: With x-token and X-Project
        {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Authorization': f'Bearer {token}', 'x-token': token, 'X-Project': 'STREET'},
        # Strategy 3: With Origin header
        {'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Authorization': f'Bearer {token}', 'Origin': 'https://carx-online.com'}
    ]

    for h in headers_list:
        try:
            r = requests.get(PROFILE_URL, headers=h, timeout=20)
            if r.status_code == 200:
                j = r.json()
                comp = find_compressed_data(j)
                if comp:
                    return comp
            elif r.status_code == 403:
                print(f"  ⚠️ Game server returned 403 Forbidden for this profile session.")
        except Exception as e:
            print(f"  ⚠️ Fetch note: {e}")

    # Fallback: Try POST with empty body (some CarX versions accept POST /profiles)
    for h in headers_list:
        try:
            r = requests.post(PROFILE_URL, headers=h, json={}, timeout=20)
            if r.status_code in (200, 201):
                j = r.json()
                comp = find_compressed_data(j)
                if comp:
                    return comp
        except Exception:
            pass

    return None

def decompress(compressed_string):
    """Decompress supporting both modern l84l and legacy formats"""
    if not compressed_string:
        return {}
    c = compressed_string.strip()

    # Case 1: modern l84l format
    if c.startswith("l84l"):
        try:
            raw = base64.b64decode(c[4:])
            gz = raw[1:] if raw[0] == 0 else raw
            return json.loads(gzip.decompress(gz).decode('utf-8'))
        except Exception as e:
            print(f"  ⚠️ l84l decode error: {e}")

    # Case 2: standard base64 (legacy 4-byte length prefix or direct gzip)
    try:
        raw = base64.b64decode(c)
        try:
            # Slicing off 4-byte length header
            return json.loads(gzip.decompress(raw[4:]).decode('utf-8'))
        except Exception:
            # Direct gzip without length prefix
            try:
                return json.loads(gzip.decompress(raw).decode('utf-8'))
            except Exception:
                if len(raw) > 1 and raw[0] == 0:
                    return json.loads(gzip.decompress(raw[1:]).decode('utf-8'))
    except Exception as e:
        print(f"  ⚠️ Legacy decode error: {e}")

    return {}

def compress(data):
    """Compress data to modern l84l string (compatible with both l84l and legacy)"""
    json_bytes = json.dumps(data, separators=(',', ':')).encode('utf-8')
    gz = gzip.compress(json_bytes, compresslevel=1)
    return "l84l" + base64.b64encode(b"\x00" + gz).decode('ascii')

def save_profile_to_server(token, profile):
    """Push profile back to server"""
    try:
        compressed_b64 = compress(profile)
        headers = {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }
        r = requests.post(PROFILE_URL, json={'compressed_data': compressed_b64}, headers=headers, timeout=20)
        return r.status_code in (200, 201), r.text
    except Exception as e:
        return False, str(e)

# ============================================================
# EXTRACT HELPERS
# ============================================================

def get_nested(data, path):
    keys = path.split('.')
    value = data
    for key in keys:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return None
    return value

def show_part_summary(part_name, data):
    if data is None:
        print(f"     ⚠️  No data")
        return

    if part_name == 'cars' and isinstance(data, dict):
        models = sorted(set(c.get('__desc_id', '?') for c in data.values() if isinstance(c, dict)))
        print(f"     🚗 {len(data)} cars ({len(models)} unique)")
        for m in models[:8]:
            print(f"        • {m}")
        if len(models) > 8:
            print(f"        ... and {len(models) - 8} more")
    elif part_name == 'maps' and isinstance(data, dict):
        print(f"     🗺️  {len(data)} maps: {', '.join(sorted(data.keys()))}")
    elif part_name == 'resources' and isinstance(data, dict):
        print(f"     💰 Resources:")
        for k, v in data.items():
            if isinstance(v, dict) and 'amount' in v:
                print(f"        • {k}: {v['amount']:,}")
    elif part_name == 'premium':
        print(f"     ⭐ Premium: {'✅ Active' if data else '❌ Inactive'}")
    elif part_name == 'stats' and isinstance(data, dict):
        print(f"     📊 {len(data)} stats")
    elif part_name == 'locations' and isinstance(data, dict):
        total = sum(len(loc.get('location_objects_set', {}).get('keys', [])) for loc in data.values() if isinstance(loc, dict))
        print(f"     📍 {len(data)} locations ({total} objects)")
    elif part_name == 'clubs' and isinstance(data, dict):
        print(f"     🎯 {len(data)} clubs: {', '.join(sorted(data.keys())[:5])}")
    elif isinstance(data, (dict, list)):
        print(f"     📦 {len(data)} items")
    else:
        print(f"     📦 Value: {data}")

def show_account_summary(profile):
    print("\n  📊 ACCOUNT SUMMARY:\n  " + "=" * 50)
    print(f"  👤 Nickname: {profile.get('nickname', 'unknown')}")
    print(f"  🆔 CarX ID: {profile.get('carx_id', 'unknown')}")
    cars = profile.get('cars', {}).get('items', {})
    if cars:
        models = sorted(set(c.get('__desc_id', '?') for c in cars.values() if isinstance(c, dict)))
        print(f"  🚗 Cars: {len(cars)} ({len(models)} unique)")
    else:
        print(f"  🚗 Cars: 0")
    resources = profile.get('resources', {})
    if isinstance(resources, dict):
        for k, v in resources.items():
            if isinstance(v, dict) and 'amount' in v:
                print(f"  💰 {k}: {v['amount']:,}")
    maps = profile.get('game_world_parts', {})
    if isinstance(maps, dict):
        print(f"  🗺️  Maps: {len(maps)} ({', '.join(sorted(maps.keys()))})")
    print(f"  ⭐ Premium: {'✅' if profile.get('has_premium') else '❌'}")
    print(f"  🏢 Properties: {len(profile.get('real_estates', {}))}")
    print(f"  🎯 Clubs: {len(profile.get('clubs', {}))}")
    print(f"  📋 Version: {profile.get('data_version', '?')}")
    print(f"  📦 Total fields: {len(profile)}\n  " + "=" * 50)

# ============================================================
# SAVE FUNCTIONS
# ============================================================

def ensure_folders():
    os.makedirs(SAVE_FOLDER, exist_ok=True)
    os.makedirs(os.path.join(SAVE_FOLDER, "full_account"), exist_ok=True)
    for part in PARTS.keys():
        os.makedirs(os.path.join(SAVE_FOLDER, part), exist_ok=True)

def save_as_json(data, filepath):
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2)
    size = os.path.getsize(filepath)
    print(f"  ✅ JSON: {filepath} ({size:,} bytes)")

def save_as_compressed(data, filepath):
    compressed = compress(data)
    with open(filepath, 'w') as f:
        f.write(compressed)
    size = os.path.getsize(filepath)
    print(f"  ✅ Compressed: {filepath} ({size:,} bytes)")

# ============================================================
# EXTRACTION WORKFLOWS
# ============================================================

def extract_whole_account(email, password, quiet=False):
    if not quiet:
        print(f"\n📥 EXTRACTING WHOLE ACCOUNT: {email}")
        print("=" * 60)

    token, carx_id = login(email, password)
    if not token:
        return None

    compressed_string = get_raw_compressed(token)
    if not compressed_string:
        if not quiet:
            print("  ❌ Failed to download save data from game server.")
        return None

    profile = decompress(compressed_string)
    if not profile or not isinstance(profile, dict) or len(profile) < 2:
        if not quiet:
            print("  ❌ Failed to decompress save profile JSON.")
        return None

    if not quiet:
        show_account_summary(profile)

    ensure_folders()
    nickname = profile.get('nickname', email.split('@')[0])
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_name = f"{nickname}_{timestamp}"
    folder = os.path.join(SAVE_FOLDER, "full_account")

    json_path = os.path.join(folder, f"{base_name}.json")
    save_as_json(profile, json_path)

    txt_path = os.path.join(folder, f"{base_name}.txt")
    with open(txt_path, 'w') as f:
        f.write(compressed_string)

    if not quiet:
        print(f"\n  ✅ WHOLE ACCOUNT EXTRACTED SUCCESSFULLY!")
    return profile

def extract_single_part(email, password, part_name):
    print(f"\n📥 EXTRACTING [{part_name.upper()}] from: {email}")
    print("-" * 50)
    token, carx_id = login(email, password)
    if not token:
        return None
    compressed_string = get_raw_compressed(token)
    if not compressed_string:
        return None
    profile = decompress(compressed_string)
    nickname = profile.get('nickname', email.split('@')[0])
    path = PARTS[part_name]['path']
    data = get_nested(profile, path)
    if data is None:
        print(f"  ⚠️  No {part_name} data found!")
        return None

    show_part_summary(part_name, data)
    ensure_folders()
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_name = f"{part_name}_{nickname}_{timestamp}"
    folder = os.path.join(SAVE_FOLDER, part_name)

    json_data = {
        'part_type': part_name,
        'extracted_at': datetime.now().isoformat(),
        'source_account': email,
        'source_nickname': nickname,
        'data': data
    }
    json_path = os.path.join(folder, f"{base_name}.json")
    save_as_json(json_data, json_path)
    txt_path = os.path.join(folder, f"{base_name}.txt")
    save_as_compressed(data, txt_path)
    print(f"\n  ✅ [{part_name.upper()}] EXTRACTED!")
    return data

def extract_multiple_parts(email, password, part_list):
    print(f"\n📥 EXTRACTING {len(part_list)} PARTS from: {email}")
    print("=" * 60)
    token, carx_id = login(email, password)
    if not token:
        return None
    compressed_string = get_raw_compressed(token)
    if not compressed_string:
        return None
    profile = decompress(compressed_string)
    nickname = profile.get('nickname', email.split('@')[0])
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    ensure_folders()

    saved = 0
    for part_name in part_list:
        path = PARTS[part_name]['path']
        data = get_nested(profile, path)
        if data is None:
            continue
        base_name = f"{part_name}_{nickname}_{timestamp}"
        folder = os.path.join(SAVE_FOLDER, part_name)
        json_data = {
            'part_type': part_name,
            'extracted_at': datetime.now().isoformat(),
            'source_account': email,
            'source_nickname': nickname,
            'data': data
        }
        with open(os.path.join(folder, f"{base_name}.json"), 'w') as f:
            json.dump(json_data, f, indent=2)
        with open(os.path.join(folder, f"{base_name}.txt"), 'w') as f:
            f.write(compress(data))
        print(f"  ✅ {part_name}: saved (json + compressed)")
        saved += 1
    print(f"\n  📊 Done: {saved}/{len(part_list)} parts saved")

def browse_files():
    print(f"\n  📁 SAVED FILES ({SAVE_FOLDER}):\n  " + "=" * 50)
    total = 0
    full_folder = os.path.join(SAVE_FOLDER, "full_account")
    if os.path.exists(full_folder):
        files = sorted(os.listdir(full_folder))
        if files:
            print(f"\n  📂 full_account/ ({len(files)} files)")
            for f in files:
                size = os.path.getsize(os.path.join(full_folder, f))
                file_type = "JSON" if f.endswith('.json') else "COMPRESSED"
                print(f"     • {f} ({size:,} bytes) [{file_type}]")
                total += 1
    for part in sorted(PARTS.keys()):
        part_folder = os.path.join(SAVE_FOLDER, part)
        if os.path.exists(part_folder):
            files = sorted(os.listdir(part_folder))
            if files:
                print(f"\n  📂 {part}/ ({len(files)} files)")
                for f in files:
                    size = os.path.getsize(os.path.join(part_folder, f))
                    file_type = "JSON" if f.endswith('.json') else "COMPRESSED"
                    print(f"     • {f} ({size:,} bytes) [{file_type}]")
                    total += 1
    if total == 0:
        print("  ⚠️  No saved files yet")
    else:
        print(f"\n  📊 Total: {total} files")

# ============================================================
# CLI & MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="CarX Street Account Data Extractor")
    parser.add_argument("--extract", action="store_true", help="Automated extraction mode")
    parser.add_argument("--email", type=str, help="Account email")
    parser.add_argument("--password", type=str, help="Account password")
    parser.add_argument("--part", type=str, help="Extract specific part")
    parser.add_argument("--out", type=str, help="Output JSON path")
    args = parser.parse_args()

    if args.extract and args.email and args.password:
        ensure_folders()
        if args.part:
            res = extract_single_part(args.email, args.password, args.part)
            if res and args.out:
                with open(args.out, 'w') as f:
                    json.dump(res, f, indent=2)
            sys.exit(0 if res else 1)
        else:
            profile = extract_whole_account(args.email, args.password, quiet=False)
            if profile and args.out:
                with open(args.out, 'w') as f:
                    json.dump(profile, f, indent=2)
            sys.exit(0 if profile else 1)

    ensure_folders()
    while True:
        print("\n" + "=" * 60)
        print("  CarX Street - Account Data Extractor")
        print(f"  📁 {SAVE_FOLDER}")
        print("=" * 60)
        print("  [1] Extract WHOLE account (JSON + compressed)")
        print("  [2] Extract ONE part (JSON + compressed)")
        print("  [3] Extract MULTIPLE parts (JSON + compressed)")
        print("  [4] Extract ALL parts separately (JSON + compressed)")
        print("  [5] Browse saved files")
        print("  [0] Exit\n")

        choice = input("  Choice: ").strip()
        if choice == "0":
            print("  👋 Bye!")
            break
        elif choice == "1":
            email = input("  Email: ").strip()
            password = input("  Password: ").strip()
            if email and password:
                extract_whole_account(email, password)
        elif choice == "2":
            part_names = list(PARTS.keys())
            for i, (name, info) in enumerate(PARTS.items(), 1):
                print(f"    [{i:2}] {name:15} - {info['desc']}")
            try:
                idx = int(input("\n  Select part: ").strip()) - 1
                if 0 <= idx < len(part_names):
                    part = part_names[idx]
                    email = input("  Email: ").strip()
                    password = input("  Password: ").strip()
                    if email and password:
                        extract_single_part(email, password, part)
            except ValueError:
                pass
        elif choice == "3":
            part_names = list(PARTS.keys())
            for i, (name, info) in enumerate(PARTS.items(), 1):
                print(f"    [{i:2}] {name:15} - {info['desc']}")
            try:
                nums_input = input("\n  Parts (comma-separated): ").strip()
                nums = [int(n.strip()) for n in nums_input.split(',')]
                selected = [part_names[n - 1] for n in nums if 1 <= n <= len(part_names)]
                if selected:
                    email = input("  Email: ").strip()
                    password = input("  Password: ").strip()
                    if email and password:
                        extract_multiple_parts(email, password, selected)
            except ValueError:
                pass
        elif choice == "4":
            email = input("  Email: ").strip()
            password = input("  Password: ").strip()
            if email and password:
                extract_multiple_parts(email, password, list(PARTS.keys()))
        elif choice == "5":
            browse_files()

if __name__ == "__main__":
    main()
