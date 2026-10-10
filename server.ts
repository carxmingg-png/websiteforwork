import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import zlib from "zlib";
import { execFile } from "child_process";

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Resolve paths
const KEYS_FILE = path.join(process.cwd(), "keys.json");
const TMP_KEYS_FILE = path.join("/tmp", "keys.json");
const VERIFIED_DEVICES_FILE = path.join(process.cwd(), "verified_devices.json");
const SAVED_CREDENTIALS_FILE = path.join(process.cwd(), "saved_credentials.json");

function getSavedCredentials() {
  const fallback = {
    default_password: "CARXMING",
    default_email_domain: "@carxming.com",
    saved_passwords: { default: "CARXMING" },
    updated_at: new Date().toISOString()
  };
  try {
    if (fs.existsSync(SAVED_CREDENTIALS_FILE)) {
      const content = fs.readFileSync(SAVED_CREDENTIALS_FILE, "utf-8");
      const parsed = JSON.parse(content);
      return { ...fallback, ...parsed };
    }
  } catch (e) {
    console.error("[CREDENTIALS] Failed to read saved credentials file:", e);
  }
  return fallback;
}

function saveSavedCredentials(data: any) {
  try {
    const current = getSavedCredentials();
    const updated = {
      ...current,
      ...(data.default_password ? { default_password: String(data.default_password).trim() } : {}),
      ...(data.default_email_domain ? { default_email_domain: String(data.default_email_domain).trim() } : {}),
      saved_passwords: {
        ...(current.saved_passwords || {}),
        ...(data.saved_passwords || {}),
        ...(data.email && data.password ? { [data.email]: data.password } : {})
      },
      updated_at: new Date().toISOString()
    };
    fs.writeFileSync(SAVED_CREDENTIALS_FILE, JSON.stringify(updated, null, 2), "utf-8");
    return { success: true, credentials: updated };
  } catch (e: any) {
    console.error("[CREDENTIALS] Failed to write saved credentials file:", e);
    return { success: false, message: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 🛡️ WATCHDOG & ROLLING BACKUP SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const ACCOUNTS_FILE = path.join(process.cwd(), "accounts.json");
const BACKUPS_DIR = path.join(process.cwd(), "backups");
if (!fs.existsSync(BACKUPS_DIR)) {
  try { fs.mkdirSync(BACKUPS_DIR, { recursive: true }); } catch {}
}

export interface TrackedAccount {
  email: string;
  password?: string;
  carxId?: string;
  creatorKey: string;
  creatorRole: string;
  createdAt: number;
  lastSeenAt: number;
  lastLoginAt?: number;
  lastInGameActive?: string;
  lastRaceTimestamp?: number;
  watchdogStatus: "active" | "recent" | "dormant" | "unverified";
  watchdogLabel: string;
  watchdogReason: string;
  backupEnabled: boolean;
  adminBackupBlocked: boolean;
  lastBackupAt?: number;
  backupSizeBytes?: number;
  cash?: number;
  gold?: number;
  level?: number;
  carsCount?: number;
}

function evaluateWatchdog(profile: any, fallbackDate?: string): {
  status: "active" | "recent" | "dormant" | "unverified";
  label: string;
  reason: string;
  lastInGameActive?: string;
  lastRaceTimestamp?: number;
} {
  let inGameDateStr = profile?.date_time || profile?.stats?.lastUpdated || fallbackDate;
  let maxRaceTs = 0;

  if (profile?.races_ts) {
    if (Array.isArray(profile.races_ts)) {
      maxRaceTs = Math.max(0, ...profile.races_ts.filter(Boolean).map((n: any) => Number(n) || 0));
    } else if (typeof profile.races_ts === "object") {
      const vals = Object.values(profile.races_ts).map((n: any) => Number(n) || 0);
      maxRaceTs = Math.max(0, ...vals);
    }
  }

  let latestTimeMs: number | null = null;
  if (inGameDateStr && typeof inGameDateStr === "string") {
    const parsed = Date.parse(inGameDateStr.replace(" ", "T") + "Z") || Date.parse(inGameDateStr);
    if (!isNaN(parsed) && parsed > 0) {
      latestTimeMs = parsed;
    }
  }

  if (maxRaceTs > 0) {
    const tsMs = maxRaceTs < 1e11 ? maxRaceTs * 1000 : maxRaceTs;
    if (!latestTimeMs || tsMs > latestTimeMs) {
      latestTimeMs = tsMs;
      inGameDateStr = new Date(tsMs).toISOString().replace("T", " ").substring(0, 19);
    }
  }

  if (!latestTimeMs) {
    return {
      status: "unverified",
      label: "⚪ NEW / NEVER OPENED IN-GAME",
      reason: "Account profile has not been loaded in-game yet.",
      lastInGameActive: undefined,
      lastRaceTimestamp: maxRaceTs || undefined
    };
  }

  const now = Date.now();
  const diffHours = (now - latestTimeMs) / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours <= 48) {
    return {
      status: "active",
      label: "🟢 ACTIVE (Regularly Played)",
      reason: `Regular gameplay detected (Active ${Math.max(1, Math.round(diffHours))}h ago).`,
      lastInGameActive: inGameDateStr,
      lastRaceTimestamp: maxRaceTs || undefined
    };
  } else if (diffDays <= 7) {
    return {
      status: "recent",
      label: "🟡 RECENT (Played This Week)",
      reason: `Played ${Math.round(diffDays)} day(s) ago.`,
      lastInGameActive: inGameDateStr,
      lastRaceTimestamp: maxRaceTs || undefined
    };
  } else {
    return {
      status: "dormant",
      label: "💤 DORMANT (Inactive)",
      reason: `No gameplay for ${Math.round(diffDays)} days.`,
      lastInGameActive: inGameDateStr,
      lastRaceTimestamp: maxRaceTs || undefined
    };
  }
}

function getSafeBackupFilename(email: string) {
  const clean = email.toLowerCase().replace(/[^a-z0-9@._-]/g, "_");
  return `${clean}.json.gz`;
}

function getAccountBackupPath(email: string) {
  return path.join(BACKUPS_DIR, getSafeBackupFilename(email));
}

function saveAccountBackupFile(email: string, profile: any) {
  try {
    const backupPath = getAccountBackupPath(email);
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const jsonStr = JSON.stringify(profile);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, "utf-8"), { level: 9 });
    fs.writeFileSync(backupPath, compressed);
    return compressed.length;
  } catch (err) {
    console.error(`[BACKUP ERROR] Failed to save backup for ${email}:`, err);
    return 0;
  }
}

function loadAccountBackupFile(email: string): any | null {
  try {
    const backupPath = getAccountBackupPath(email);
    if (!fs.existsSync(backupPath)) return null;
    const buf = fs.readFileSync(backupPath);
    const decompressed = zlib.gunzipSync(buf);
    return JSON.parse(decompressed.toString("utf-8"));
  } catch (err) {
    console.error(`[BACKUP ERROR] Failed to load backup for ${email}:`, err);
    return null;
  }
}

function deleteAccountBackupFile(email: string) {
  try {
    const backupPath = getAccountBackupPath(email);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch {}
}

function getBackupStorageOverview() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) return { totalFiles: 0, totalSizeBytes: 0, totalSizeFormatted: "0 KB" };
    const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith(".json.gz"));
    let totalBytes = 0;
    for (const f of files) {
      try {
        const s = fs.statSync(path.join(BACKUPS_DIR, f));
        totalBytes += s.size;
      } catch {}
    }
    let formatted = `${(totalBytes / 1024).toFixed(1)} KB`;
    if (totalBytes >= 1024 * 1024) {
      formatted = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return {
      totalFiles: files.length,
      totalSizeBytes: totalBytes,
      totalSizeFormatted: formatted
    };
  } catch {
    return { totalFiles: 0, totalSizeBytes: 0, totalSizeFormatted: "0 KB" };
  }
}

function loadTrackedAccounts(): Record<string, TrackedAccount> {
  let accs: Record<string, TrackedAccount> = {};
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
      accs = data.accounts || data || {};
    } catch {}
  }
  return accs;
}

function saveTrackedAccounts(accs: Record<string, TrackedAccount>) {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts: accs, updated_at: new Date().toISOString() }, null, 2), "utf-8");
  } catch (e) {
    console.error("[ACCOUNTS TRACKER] Error saving accounts.json:", e);
  }
}

async function recordAccountActivity(
  email: string,
  password?: string,
  carxId?: string,
  creatorKey: string = "ADMIN",
  creatorRole: string = "admin",
  profile?: any
) {
  if (!email) return;
  const normalizedEmail = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const existing = accs[normalizedEmail] || {
    email: normalizedEmail,
    createdAt: Date.now(),
    backupEnabled: false,
    adminBackupBlocked: false
  };

  const now = Date.now();
  const wd = evaluateWatchdog(profile, existing.lastInGameActive);

  let backupSize = existing.backupSizeBytes || 0;
  const backupPath = getAccountBackupPath(normalizedEmail);
  if (fs.existsSync(backupPath)) {
    try { backupSize = fs.statSync(backupPath).size; } catch {}
  }

  let cash = existing.cash;
  let gold = existing.gold;
  let level = existing.level;
  let carsCount = existing.carsCount;

  if (profile) {
    if (profile.stats) {
      cash = profile.stats.cash ?? cash;
      gold = profile.stats.gold ?? gold;
      level = profile.stats.level ?? level;
      carsCount = profile.stats.cars ?? profile.stats.cars_count ?? carsCount;
    } else {
      if (profile.resources?.soft !== undefined) cash = profile.resources.soft?.amount ?? profile.resources.soft;
      if (profile.resources?.hard !== undefined) gold = profile.resources.hard?.amount ?? profile.resources.hard;
      if (profile.resources?.experience !== undefined) level = profile.resources.experience?.award_index ?? profile.resources.experience?.level ?? level;
      if (profile.cars) {
        const items = profile.cars.items || profile.cars;
        carsCount = typeof items === "object" ? Object.keys(items).length : carsCount;
      }
    }
  }

  const updated: TrackedAccount = {
    ...existing,
    email: normalizedEmail,
    password: password || existing.password || getSavedCredentials().saved_passwords?.[normalizedEmail] || undefined,
    carxId: carxId || existing.carxId,
    creatorKey: existing.creatorKey || creatorKey || "DIRECT",
    creatorRole: existing.creatorRole || creatorRole || "user",
    lastSeenAt: now,
    lastLoginAt: password ? now : existing.lastLoginAt,
    lastInGameActive: wd.lastInGameActive || existing.lastInGameActive,
    lastRaceTimestamp: wd.lastRaceTimestamp || existing.lastRaceTimestamp,
    watchdogStatus: wd.status,
    watchdogLabel: wd.label,
    watchdogReason: wd.reason,
    backupSizeBytes: backupSize,
    cash,
    gold,
    level,
    carsCount
  };

  accs[normalizedEmail] = updated;
  saveTrackedAccounts(accs);

  if (updated.backupEnabled && !updated.adminBackupBlocked && profile) {
    try {
      const size = saveAccountBackupFile(normalizedEmail, profile);
      if (size > 0) {
        updated.backupSizeBytes = size;
        updated.lastBackupAt = now;
        accs[normalizedEmail] = updated;
        saveTrackedAccounts(accs);
      }
    } catch {}
  }

  if (password) {
    saveSavedCredentials({ email: normalizedEmail, password });
  }

  return updated;
}

// 🛡️ Watchdog & Optional Rolling Auto-Backup runner (every 60 seconds)
setInterval(async () => {
  try {
    const accs = loadTrackedAccounts();
    const emails = Object.keys(accs);
    for (const email of emails) {
      const acc = accs[email];
      if (acc.backupEnabled && !acc.adminBackupBlocked && acc.password) {
        const now = Date.now();
        // Run rolling backup every 5 minutes if account is actively configured
        if (!acc.lastBackupAt || (now - acc.lastBackupAt) >= 5 * 60 * 1000) {
          try {
            const loginRes = await CarXClient.authenticate("login", acc.email, acc.password);
            if (loginRes.success && loginRes.token) {
              const profRes = await CarXClient.getProfile(loginRes.token, loginRes.userId);
              if (profRes && profRes.profile) {
                const size = saveAccountBackupFile(acc.email, profRes.profile);
                acc.backupSizeBytes = size;
                acc.lastBackupAt = now;
                const wd = evaluateWatchdog(profRes.profile, acc.lastInGameActive);
                acc.watchdogStatus = wd.status;
                acc.watchdogLabel = wd.label;
                acc.watchdogReason = wd.reason;
                acc.lastInGameActive = wd.lastInGameActive || acc.lastInGameActive;
                saveTrackedAccounts(accs);
              }
            }
          } catch (e: any) {
            // Silently skip if network or rate limited
          }
        }
      }
    }
  } catch (err) {
    console.error("[AUTO-BACKUP RUNNER ERROR]", err);
  }
}, 60000);


function getKeysFilePath() {
  if (process.env.KEYS_FILE_PATH) {
    return process.env.KEYS_FILE_PATH;
  }
  // Automatic detection of Render/Docker persistent disks mounted at /data
  if (fs.existsSync("/data") && !process.env.VERCEL) {
    return "/data/keys.json";
  }
  if (process.env.VERCEL && fs.existsSync(TMP_KEYS_FILE)) {
    return TMP_KEYS_FILE;
  }
  return KEYS_FILE;
}

const MAX_CASH = Number.MAX_SAFE_INTEGER;
const MAX_GOLD = Number.MAX_SAFE_INTEGER;
const MAX_EXP = 93060;

function calculateLevelFromExp(exp: number): number {
  if (exp <= 0) return 1;
  if (exp >= 93060) return 50;
  // Quadratic progression formula: Level = Math.floor(Math.sqrt(exp / 37.224))
  const lvl = Math.floor(Math.sqrt(exp / 37.224));
  return Math.max(1, Math.min(50, lvl));
}

function getKeyCredits(keyData: { credits?: number; tokens?: number } | null | undefined): number {
  if (keyData?.credits !== undefined) return keyData.credits;
  if (keyData?.tokens !== undefined) return keyData.tokens;
  return 10;
}

function resolveCreditsFromBody(body: Record<string, unknown>): number | undefined {
  const raw = body.credits !== undefined ? body.credits : body.tokens;
  if (raw === undefined) return undefined;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? undefined : n;
}

function creditResponse(credits: number) {
  return { credits };
}

function isOutOfCredits(keyData: { out_of_credits?: boolean; out_of_tokens?: boolean } | null | undefined): boolean {
  return !!(keyData?.out_of_credits || keyData?.out_of_tokens);
}

function parseResourceValue(
  value: unknown,
  min: number,
  max: number,
  label: string
): { ok: boolean; value: number | null; message: string } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null, message: "" };
  }
  if (value === 0 || value === "0") {
    return { ok: true, value: null, message: "" };
  }
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  
  if (label === "cash" || label === "gold") {
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, value: null, message: `Invalid ${label}: must be a non-negative number.` };
    }
    // Auto-lock values above 2.14B to 2.14B to prevent overflow/resets
    if (n > 2140000000) {
      return { ok: true, value: 2140000000, message: "" };
    }
  } else {
    if (Number.isNaN(n) || n < min) {
      return { ok: false, value: null, message: `Invalid ${label}: must be between ${min} and ${max}, or 0 to skip.` };
    }
    if (n > max) {
      return { ok: true, value: max, message: "" };
    }
  }
  return { ok: true, value: n, message: "" };
}

// Helper to save keys database to CSV (Excel compatible) format
function saveKeysToCsv(cleanDb: any) {
  try {
    const jsonPath = getKeysFilePath();
    const csvPath = jsonPath.replace(/\.json$/, ".csv");
    
    const headers = ["License Key", "Role", "Credits", "Created At", "Max Claims", "Enabled Features", "Status"];
    const rows = [headers.join(",")];

    for (const [key, data] of Object.entries(cleanDb.keys || {})) {
      const keyData = data as any;
      const features = (keyData.enabled_features || []).join(";");
      const status = isOutOfCredits(keyData) ? "Out of Credits" : "Active";
      const row = [
        key,
        keyData.role || "user",
        getKeyCredits(keyData),
        keyData.created_at || "",
        keyData.max_claims !== undefined ? keyData.max_claims : 1,
        `"${features}"`,
        status
      ];
      rows.push(row.join(","));
    }

    fs.writeFileSync(csvPath, rows.join("\n"), "utf-8");
    console.log(`[KEYS] Excel-compatible CSV backup successfully written to: ${csvPath}`);
  } catch (err) {
    console.error("[KEYS CSV ERROR] Failed to write keys CSV backup:", err);
  }
}

// Default Owner Key & Constants
const OWNER_KEY = process.env.OWNER_KEY || "admin-mingfu";
const BASE_URL = "https://carx-id-prod.carx-online.com/api/auth";
const GAME_BASE_URL = "https://street-prod.carx-online.com/str/v1/client";

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "CarXStreet/1.20.0 (Android; 13)",
  "Accept": "application/json",
  "X-Unity-Version": "2021.3.16f1",
  "X-App-Version": "1.20.0",
  "Connection": "Keep-Alive",
  "X-Project-Id": "4",
  "X-Identity-Project-Id": "4"
};

const STREETPASS_BODY = JSON.stringify({
  gameVersion: "1.20.0",
  purchaseId: "GPA.3304-3406-9941-41674",
  productId: "com.carxtech.sr.bank.event.bp",
  transactionData: "naooopliblhmhlhjphaiblip.AO-J1Owuw7bYU69mo6A_woU7wHx6NDEZPS_Io-HzmDgWudqOLG_3tEEwEqMihq1eHZlasQ97qUvkuma4CCPraosxDFlQEKipqw",
  transactionId: "naooopliblhmhlhjphaiblip.AO-J1Owuw7bYU69mo6A_woU7wHx6NDEZPS_Io-HzmDgWudqOLG_3tEEwEqMihq1eHZlasQ97qUvkuma4CCPraosxDFlQEKipqw",
  subscription: false,
  metaInfo: JSON.stringify({
    json: JSON.stringify({
      packageName: "com.carxtech.sr",
      productId: "com.carxtech.sr.bank.event.bp",
      purchaseTime: 1776223964504,
      purchaseState: 0,
      purchaseToken: "naooopliblhmhlhjphaiblip.AO-J1Owuw7bYU69mo6A_woU7wHx6NDEZPS_Io-HzmDgWudqOLG_3tEEwEqMihq1eHZlasQ97qUvkuma4CCPraosxDFlQEKipqw",
      quantity: 1,
      acknowledged: false,
      orderId: "GPA.3304-3406-9941-41674"
    }),
    signature: "fAlvYHDSE9y+tbPxNYtpI97ompnSrfSkR3AerW5pAatwNtihN6jOb8eXYvLCQxAyc7sK/jU87m9hz6Co4Vig3OvIh74bPm2Z+1y8oGcNNUvyIpQlqV85j4x2PFzbFU0//TCraeAfJOn2mOlHZqMqQ1Fpb2oh1wN6PhMtkQt56Pcg/J6gEpBhhVuU31Om02lW17oj3phKx4KXMbcgvqQ81gLhdos82BKSD7u/VPsnJevKEu5cGC273dh0AmxUUJPRVryeg+ucln6jJLgL+qmH1F71qb7IZ0duAkX3usw/rYY7Luhg0puo9NjW/xt+dblckah5adr/IrL3f1cpfe/xfQ==",
    skuDetails: [
      JSON.stringify({
        productId: "com.carxtech.sr.bank.event.bp",
        type: "inapp",
        title: "Street Pass (CarX Street)",
        name: "Street Pass",
        description: "Street Pass",
        price: "Rp\u00a099.000",
        price_amount_micros: 99000000000,
        price_currency_code: "IDR"
      })
    ]
  }),
  marketType: "GOOGLE",
  productType: 0
});

// All 189 Car Model IDs matching the python bot
const ALL_CAR_MODELS = [
  "toyotasupra2020","bmwm3e46","bmwm3e30","bmwm3e36","bmwe30","bmw340i",
  "bmwm240i","bmw2002","bmw1m","bmwm4","bmwm2","bmwm5e60","bmwm5e34",
  "bmwm6","bmw760li","bmwe46","bmw3series","bmw5series","toyotaae86",
  "toyotacelica","toyotamr2","toyotamarkii","toyotalandcruiser200",
  "toyotaav4","toyotatundra","toyotacamry","toyotacorolla","toyotacorollagts",
  "toyotagr86","toyotagrb","toyotasupraa70","toyotasupraa80","toyotayaris",
  "nissangtr","nissangtr35","nissan240sx","nissan350z","nissan370z",
  "nissansilvia","nissan180sx","nissanskyline","nissanskylinegtr",
  "nissangtrs15","nissangtrs14","nissanpatrol","nissanfrontier",
  "nissanfairladyz31","nissanfairladyz32","nissanfairladyz33",
  "hondacivic","hondaaccord","hondacrx","hondaintegra","hondnsx",
  "hondas2000","hondacr-v","hondafit","hondaprelude",
  "mazdamiata","mazdamx5","mazdamx6","mazdarx7","mazdarx8",
  "mazda6","mazda3","mazdaatenza","mazdabt50",
  "mitsubishieclipse","mitsubishievo9","mitsubishievo10","mitsubishigto",
  "mitsubishilancer","mitsubishimontero","mitsubishioutlander","mitsubishil200",
  "subaruimpreza","subaruimprezawrxsti","subarulegacy","subaruoutback",
  "subaruforester","subarubrz","subarutribeca",
  "audiа4","audi80","audirs4","audirs6","audirs7","auditt","audis3",
  "audis4","audis5","audis6","audis8","audia3","audia6","audia8",
  "audiq7","audiq8","audiR8",
  "mercedesbenzc63","mercedesbenzcla","mercedesbenzclk","mercedesbenzcls",
  "mercedesbenzsl","mercedesbenzsls","mercedesbenzsslk","mercedesbenzamg",
  "mercedesbenze55","mercedesbenze63","mercedesbenzeclass",
  "porsche911","porsche911gt3","porsche911turbo","porsche918","porscheboxter",
  "porschecayman","porschepanamera","porschecarreragts",
  "chevroletcamaro","chevroletcorvette","chevroletcorvettezo6",
  "chevroletcorvettezt1","chevroletsilverado","chevroleteq",
  "fordmustang","fordmustanggt500","fordgt","fordf150","fordf250",
  "fordfusion","fordtaurus",
  "dodgechallenger","dodgechargersrt","dodgecharger","dodgeviper",
  "dodgedurango","dodgeram1500",
  "jeepwrangler","jeepgrandcherokee","jeeprenegade",
  "lamborghiniavantador","lamborghinihuracan","lamborghiniuruss",
  "lamborghinimurcielago","lamborghinijalpa",
  "ferrariroma","ferrari488","ferrari458","ferrari430","ferrari360",
  "ferrari812","ferrariportofino","ferrarif8","ferrarif40","ferrarif50",
  "mclarensenna","mclaren720s","mclaren570s","mclaren600lt",
  "paganihuayra","paganizonda",
  "bugattichironss","bugattichiron","bugattichiropureblee","bugattiveyron",
  "koenigseggone1","koenigseggageras","koenigseggccr",
  "rollsroycephantom","rollsroycecullinan","rollsroyceghost",
  "bentleycontinentalgt","bentleybentayga",
  "astonmartindb11","astonmartinvantage","astonmartindbs",
  "maseratigranturismo","maseratileventegts",
  "alfaaguilajuliet","alfastelvio","alfa156","alfa159",
  "volkswagengolf4","volkswagenpassat","volkswagenscirocco",
  "volkswagentiguan","volkswagenid4",
  "renaultsportmegane","renaultsportclio","renaultkoleos",
  "peugeot207","peugeot206","peugeot508","peugeot3008",
  "citroenax","citroenc4","citroenxsara",
  "seatleoncupra","seatibiza","seatleon",
  "skodaoctaviars","skodakodiaq",
  "hyundaiveloster","hyundaigenesis","hyundaicoupetib","hyundaicelantra",
  "kiagts","kiastinger","kiaoptima","kiasorento",
  "lexusisf","lexusis300","lexusis200","lexuslc500","lexuslx",
  "infinitiq50","infinitifx","infinitg35",
  "acuratsx","acuransx","acurardx"
];

let mongoClient: any = null;
async function getMongoClient() {
  if (process.env.MONGODB_URI) {
    if (!mongoClient) {
      try {
        mongoClient = new MongoClient(process.env.MONGODB_URI);
        await mongoClient.connect();
        console.log("[DB] Connected to MongoDB successfully.");
      } catch (err) {
        console.error("[DB ERROR] MongoDB connection failed:", err);
        mongoClient = null;
      }
    }
    return mongoClient;
  }
  return null;
}

// ─── In-memory DB read cache (1-second TTL) ───────────────────────────────────
// Prevents redundant MongoDB/filesystem reads within a single request burst.
let _dbCache: any = null;
let _dbCacheAt = 0;
const DB_CACHE_TTL_MS = 1000; // 1 second

function invalidateDbCache() {
  _dbCache = null;
  _dbCacheAt = 0;
}

// Helper to load keys database
async function loadKeysDb(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _dbCache && (now - _dbCacheAt) < DB_CACHE_TTL_MS) {
    return _dbCache;
  }

  // 1. Try MongoDB
  try {
    const client = await getMongoClient();
    if (client) {
      const db = client.db("rymenbot");
      const collection = db.collection("keys_db");
      const doc = await collection.findOne({ _id: "main_keys_db" });
      if (doc) {
        const result = {
          keys: doc.keys || {},
          authorized_users: doc.authorized_users || {},
          admins: doc.admins || [],
          owners: doc.owners || [],
          total_credits_used: doc.total_credits_used || 0,
          total_accounts_generated: doc.total_accounts_generated || 0
        };
        _dbCache = result;
        _dbCacheAt = now;
        return result;
      } else {
        const defaultDb = { keys: {}, authorized_users: {}, admins: [], owners: [], total_credits_used: 0, total_accounts_generated: 0 };
        await collection.updateOne({ _id: "main_keys_db" }, { $set: defaultDb }, { upsert: true });
        _dbCache = defaultDb;
        _dbCacheAt = now;
        return defaultDb;
      }
    }
  } catch (err) {
    console.error("[DB ERROR] Failed to load keys from MongoDB:", err);
  }

  // 2. Try Vercel KV REST API
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const url = `${process.env.KV_REST_API_URL}/get/rymenbot_keys_db`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.result) {
          const parsed = JSON.parse(data.result);
          const result = {
            keys: parsed.keys || {},
            authorized_users: parsed.authorized_users || {},
            admins: parsed.admins || [],
            owners: parsed.owners || [],
            total_credits_used: parsed.total_credits_used || 0,
            total_accounts_generated: parsed.total_accounts_generated || 0
          };
          _dbCache = result;
          _dbCacheAt = now;
          return result;
        } else {
          const defaultDb = { keys: {}, authorized_users: {}, admins: [], owners: [], total_credits_used: 0, total_accounts_generated: 0 };
          await saveKeysDb(defaultDb);
          _dbCache = defaultDb;
          _dbCacheAt = now;
          return defaultDb;
        }
      }
    } catch (err) {
      console.error("[DB ERROR] Failed to load keys from Vercel KV:", err);
    }
  }

  // 3. Fallback to Local Filesystem
  const filePath = getKeysFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const result = {
        keys: data.keys || {},
        authorized_users: data.authorized_users || {},
        admins: data.admins || [],
        owners: data.owners || [],
        total_credits_used: data.total_credits_used || 0,
        total_accounts_generated: data.total_accounts_generated || 0
      };
      _dbCache = result;
      _dbCacheAt = now;
      return result;
    } catch (e) {
      console.error("[KEYS ERROR] Failed to parse keys.json", e);
    }
  }

  // If on Vercel and file wasn't found in /tmp, try loading initial keys.json from read-only function dir
  if (filePath !== KEYS_FILE && fs.existsSync(KEYS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
      const result = {
        keys: data.keys || {},
        authorized_users: data.authorized_users || {},
        admins: data.admins || [],
        owners: data.owners || [],
        total_credits_used: data.total_credits_used || 0,
        total_accounts_generated: data.total_accounts_generated || 0
      };
      _dbCache = result;
      _dbCacheAt = now;
      return result;
    } catch (e) {
      console.error("[KEYS ERROR] Failed to parse initial keys.json", e);
    }
  }

  const defaultDb = { keys: {}, authorized_users: {}, admins: [], owners: [], total_credits_used: 0, total_accounts_generated: 0 };
  await saveKeysDb(defaultDb);
  _dbCache = defaultDb;
  _dbCacheAt = now;
  return defaultDb;
}

// Helper to save keys database
async function saveKeysDb(db: any) {
  // Always invalidate cache on write
  invalidateDbCache();

  const cleanDb = {
    keys: db.keys || {},
    authorized_users: db.authorized_users || {},
    admins: db.admins || [],
    owners: db.owners || [],
    total_credits_used: db.total_credits_used || 0,
    total_accounts_generated: db.total_accounts_generated || 0
  };

  let savedToDb = false;

  // 1. Try MongoDB
  try {
    const client = await getMongoClient();
    if (client) {
      const collection = client.db("rymenbot").collection("keys_db");
      await collection.updateOne({ _id: "main_keys_db" }, { $set: cleanDb }, { upsert: true });
      console.log("[DB] Successfully saved keys to MongoDB.");
      savedToDb = true;
    }
  } catch (err) {
    console.error("[DB ERROR] Failed to save keys to MongoDB:", err);
  }

  // 2. Try Vercel KV REST API
  if (!savedToDb && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const url = `${process.env.KV_REST_API_URL}/set/rymenbot_keys_db`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        body: JSON.stringify(cleanDb)
      });
      if (res.ok) {
        console.log("[DB] Successfully saved keys to Vercel KV.");
        savedToDb = true;
      }
    } catch (err) {
      console.error("[DB ERROR] Failed to save keys to Vercel KV:", err);
    }
  }

  // 3. Mirror/fallback to Local Filesystem
  try {
    const targetPath = getKeysFilePath();
    fs.writeFileSync(targetPath, JSON.stringify(cleanDb, null, 2), "utf-8");
    console.log(`[KEYS] Successfully mirrored keys to: ${targetPath}`);
    saveKeysToCsv(cleanDb);
  } catch (e) {
    if (!savedToDb) {
      console.error("[KEYS ERROR] Failed to write keys database, trying /tmp fallback", e);
      try {
        fs.writeFileSync(TMP_KEYS_FILE, JSON.stringify(cleanDb, null, 2), "utf-8");
        console.log("[KEYS] Successfully saved keys to /tmp fallback");
        saveKeysToCsv(cleanDb);
      } catch (tmpErr) {
        console.error("[KEYS ERROR] Failed to write to /tmp fallback as well", tmpErr);
      }
    } else {
      console.log("[KEYS] Mirror to local filesystem skipped or read-only (expected on Vercel)");
    }
  }
}

// Generate random license keys (format: PREFIX-XXXX-XXXX-XXXX)
function generateLicenseKey(prefix = "CARXMING") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const part = (len = 4) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const cleanPrefix = (prefix || "CARXMING").trim().toUpperCase().replace(/[-_]+$/, "");
  return `${cleanPrefix}-${part()}-${part()}-${part()}`;
}

// In-memory Bulk accounts job tracker
const bulkJobs: Record<string, {
  status: string;
  progress: number;
  total: number;
  logs: string[];
  results: Array<{ email: string; status: string; message?: string; password?: string; user_id?: string }>;
}> = {};

import { EMBEDDED_PROFILE_TEMPLATE } from "./profile_template";
import {
  ALL_NEON_REWARDS,
  ALL_NEON_BODY_PARTS,
  ALL_TIRE_SIDE_WALL_REWARDS,
  ALL_TIRE_SIDE_WALL_BODY_PARTS,
  ALL_PROFILE_STYLE_REWARDS,
  EXTENDED_ORDERED_COSMETIC_SETS,
  ALL_NUMBER_PLATE_REWARDS,
  ALL_NUMBER_PLATE_BODY_PARTS,
  ALL_WHEEL_RIM_REWARDS,
  ALL_WHEEL_RIM_BODY_PARTS,
  getNeonKeys,
  getTireSidewallKeys,
  getNumberPlateKeys,
  getWheelRimKeys
} from "./cosmetics_data";

// Decode and decompress EMBEDDED_PROFILE_TEMPLATE at startup
let cachedProfileTemplate: any = null;
try {
  const decoded = Buffer.from(EMBEDDED_PROFILE_TEMPLATE, "base64");
  let decompressed: Buffer;
  try {
    decompressed = zlib.gunzipSync(decoded.subarray(4));
  } catch {
    decompressed = zlib.gunzipSync(decoded);
  }
  cachedProfileTemplate = JSON.parse(decompressed.toString("utf-8"));
  
  // Clean the template to strictly enforce limits (18 avatars, 18 banners, 18 frames, 4 quick chats)
  if (cachedProfileTemplate && cachedProfileTemplate.battle_pass_event_rewards && cachedProfileTemplate.battle_pass_event_rewards.keys) {
    const keys = cachedProfileTemplate.battle_pass_event_rewards.keys;
    cachedProfileTemplate.battle_pass_event_rewards.keys = keys.filter((key: string) => {
      const avatarMatch = key.match(/^unlock_avatar_(\d+)$/i);
      const bannerMatch = key.match(/^unlock_banner_(\d+)$/i);
      const frameMatch = key.match(/^unlock_frame_(\d+)$/i);
      const emojiMatch = key.match(/^unlock_emoji_(\d+)$/i);

      if (avatarMatch && parseInt(avatarMatch[1], 10) > 18) return false;
      if (bannerMatch && parseInt(bannerMatch[1], 10) > 18) return false;
      if (frameMatch && parseInt(frameMatch[1], 10) > 18) return false;
      if (emojiMatch && parseInt(emojiMatch[1], 10) > 4) return false;
      return true;
    });
  }

  // Enforce exactly 4 active slots for quick chats in template (prevents loading freeze)
  if (cachedProfileTemplate) {
    cachedProfileTemplate.emoji = {
      keys: ["0", "1", "2", "3"],
      values: ["emoji_1", "emoji_2", "emoji_3", "emoji_4"]
    };
  }

  console.log("[TEMPLATE] Successfully loaded and filtered rich profile template!");
} catch (e) {
  console.error("[TEMPLATE ERROR] Failed to load rich profile template:", e);
}

const PROFILE_TEMPLATE = cachedProfileTemplate;

import {
  BOT_COMPRESSED_STRING,
  BOT_COMPRESSED_CARS_STRING
} from "./bot_blueprint_string";

// Exact string aliases from bot.py
export const COMPRESSED_STRING = BOT_COMPRESSED_STRING;
export const COMPRESSED_CARS_STRING = BOT_COMPRESSED_CARS_STRING;

// Decompress helper matching decompress_data(s) from bot.py: json.loads(gzip.decompress(raw[4:]))
export function decompressData(s: string): any {
  if (!s) return null;
  try {
    const raw = Buffer.from(s, "base64");
    try {
      return JSON.parse(zlib.gunzipSync(raw.subarray(4)).toString("utf-8"));
    } catch {
      return JSON.parse(zlib.gunzipSync(raw).toString("utf-8"));
    }
  } catch {
    return null;
  }
}

// Bot Blueprint loader matching bot.py (starter profile with Supra, completed intro, and 21k cash)
let BOT_BLUEPRINT: any = null;
try {
  BOT_BLUEPRINT = decompressData(COMPRESSED_STRING);
  if (BOT_BLUEPRINT) {
    console.log("[BOT BLUEPRINT] Successfully decompressed starter blueprint from COMPRESSED_STRING!");
  }
} catch (e) {
  console.warn("[BOT BLUEPRINT] Error decompressing COMPRESSED_STRING:", e);
}

if (!BOT_BLUEPRINT) {
  try {
    const bpPath = path.join(process.cwd(), "bot_blueprint.json");
    if (fs.existsSync(bpPath)) {
      BOT_BLUEPRINT = JSON.parse(fs.readFileSync(bpPath, "utf-8"));
      console.log("[BOT BLUEPRINT] Successfully loaded bot_blueprint.json fallback!");
    }
  } catch (e) {
    console.warn("[BOT BLUEPRINT] Could not load bot_blueprint.json:", e);
  }
}

export function getBotBlueprint(): any {
  if (_dbCache?.custom_blueprint_string) {
    const custom = decompressData(_dbCache.custom_blueprint_string);
    if (custom) return custom;
  }
  if (BOT_BLUEPRINT) return structuredClone(BOT_BLUEPRINT);
  const decomp = decompressData(COMPRESSED_STRING);
  if (decomp) return decomp;
  if (PROFILE_TEMPLATE) return structuredClone(PROFILE_TEMPLATE);
  return null;
}

export function unwrapProfilePayload(profile: any): any {
  if (!profile || typeof profile !== "object") return profile;
  let current = profile;
  for (let depth = 0; depth < 5; depth++) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      if (current.resources || current.cars || current.clubs || current.date_time || current.real_estates || current.car_models) {
        return current;
      }
      if (current.d !== undefined && typeof current.d === "object" && !Array.isArray(current.d)) {
        current = current.d;
      } else if (current.data !== undefined && typeof current.data === "object" && !Array.isArray(current.data)) {
        current = current.data;
      } else if (current.profile !== undefined && typeof current.profile === "object" && !Array.isArray(current.profile) && (current.profile.resources || current.profile.cars)) {
        current = current.profile;
      } else if (current.result !== undefined && typeof current.result === "object" && !Array.isArray(current.result)) {
        current = current.result;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return current;
}

export function decompressCompressedDataString(compressed: string): any {
  if (typeof compressed !== "string" || !compressed) return null;
  const trimmed = compressed.trim();

  // Case 1: Modern CarX Street "l84l" prefix
  if (trimmed.startsWith("l84l")) {
    try {
      const b64 = trimmed.slice(4);
      const raw = Buffer.from(b64, "base64");
      const gz = raw[0] === 0 ? raw.subarray(1) : raw;
      const decomp = zlib.gunzipSync(gz);
      return JSON.parse(decomp.toString("utf-8"));
    } catch (e: any) {
      console.warn("[DECOMPRESS] Failed parsing l84l data:", e?.message);
    }
  }

  // Case 2: Legacy 4-byte length prefix + GZIP Base64, or direct GZIP Base64
  try {
    const raw = Buffer.from(trimmed, "base64");
    let decomp: Buffer | null = null;
    try {
      decomp = zlib.gunzipSync(raw.subarray(4));
    } catch {
      try {
        decomp = zlib.gunzipSync(raw);
      } catch {
        if (raw[0] === 0) {
          decomp = zlib.gunzipSync(raw.subarray(1));
        }
      }
    }
    if (decomp) {
      return JSON.parse(decomp.toString("utf-8"));
    }
  } catch (e: any) {
    console.warn("[DECOMPRESS] Failed parsing legacy base64 data:", e?.message);
  }

  return null;
}

export function findCompressedDataInEnvelope(obj: any): { container: any; compressedData: string } | null {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.compressed_data === "string" && obj.compressed_data.length > 0) {
    return { container: obj, compressedData: obj.compressed_data };
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      const found = findCompressedDataInEnvelope(val);
      if (found) return found;
    }
  }
  return null;
}

export function updateProfileAccountIds(profile: any, newCarxId: string): void {
  if (!profile || typeof profile !== "object" || !newCarxId) return;
  const cleanNew = String(newCarxId).trim();
  const cleanNewNum = cleanNew.replace(/\D/g, "");

  const idKeys = ["account_id", "player_id", "user_id", "carx_id", "carxId"];
  for (const k of idKeys) {
    if (k in profile && profile[k] !== undefined && profile[k] !== null) {
      if (typeof profile[k] === "number" && cleanNewNum) {
        profile[k] = parseInt(cleanNewNum, 10);
      } else {
        profile[k] = cleanNew;
      }
    }
  }

  if (profile.date_time) {
    profile.date_time = new Date().toISOString();
  }

  for (const key of Object.keys(profile)) {
    if (key === "cars" || key === "resources" || key === "clubs") continue;
    const val = profile[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      updateProfileAccountIds(val, newCarxId);
    }
  }
}

export function decompressProfileIfCompressed(profile: any): any {
  if (!profile || typeof profile !== "object") return profile;

  // If object already contains standard profile resource structure
  if (profile.resources && typeof profile.resources === "object") {
    return profile;
  }

  // Check recursively for any compressed_data in the object envelope
  const found = findCompressedDataInEnvelope(profile);
  if (found && found.compressedData) {
    const decompressed = decompressCompressedDataString(found.compressedData);
    if (decompressed && typeof decompressed === "object") {
      return decompressed;
    }
  }

  const unwrapped = unwrapProfilePayload(profile);
  if (unwrapped && unwrapped !== profile && typeof unwrapped === "object") {
    return decompressProfileIfCompressed(unwrapped);
  }

  return profile;
}

export function encryptProfileL84L(profile: any): string {
  const raw = Buffer.from(JSON.stringify(profile), "utf-8");
  const gz = zlib.gzipSync(raw);
  const combined = Buffer.concat([Buffer.from([0]), gz]);
  return "l84l" + combined.toString("base64");
}

export function compressProfileToBinaryBase64(profile: any): string {
  return encryptProfileL84L(profile);
}

export const ID_SELF_HEAL_MAP: Record<string, string> = {
  car_van: "van",
  car_szk: "suzukicarry",
  car_hrd: "hotrod",
  car_gr86: "toyotagr86",
  car_gnx: "buickgnx",
  car_lma: "lamborghiniaventadors",
  car_tls: "tesla_s_plaid"
};

export const BANNED_UNRELEASED_CAR_IDS = new Set<string>([
  "ferrarif40",
  "mclarenf1",
  "lamborghiniavantador",
  "lma"
]);

export const ALL_CARS_LIST: string[] = [
  "suzukicarry", "hotrod", "van", "toyotagr86", "buickgnx",
  "lamborghiniaventadors", "tesla_s_plaid", "toyotasupra2020", "nissan180sx", "bmw_m3_e36",
  "nissan300zx", "skyliner32", "golfgti", "nissansilvias13", "toyotasuprarz",
  "chevycamaro70", "dodgechallengerrt", "silvias15", "mazdarx7", "bmwe31",
  "mitsubishievo6", "toyotamark2_100", "lamborghinievo", "civicek9", "nissanz31",
  "mitsubishievo9", "hondas2000", "mustang350", "bmwm4g82", "nissan400z",
  "porsche911", "bmwm5f90", "skyliner35", "bmwm5x5", "audir8",
  "lamborghinidiablo", "bmwe46m3", "porschesinger", "audirs6avantc7", "toyotagt86",
  "mercedesbenz190evo2", "vantage", "chevroletcamaro2016", "corvettec7", "mustang650",
  "lexuslfa", "maloor82015", "mclaren720s", "charger", "nissanskyline2000gtx",
  "porsche911gt3", "ae86", "skyliner34", "bmwm5e60", "corvettec6",
  "vipersrt10", "bmwm4", "fordgt_mk2", "mbgelandewagenw463", "bmw_z4_e86",
  "nissan350z", "mazdarx7_fc", "bmw_i8", "bmwe30m3", "mercedesbenzamggt2019",
  "subaruwrxsti", "mitsubishievox", "mazdarx8", "nissanskyliner33vspec", "infinity_q60",
  "bmwm5e34", "mustang_hoonigan", "viper", "chevroletchevelless1970", "jaguar_ftype",
  "corvettec3", "audirs7", "toyotayarisgr2020", "toyotasupraa70", "fordfocusst2019",
  "lotuselise", "bmwm2g87", "dodgecharger2020", "alfaromeogiuliagtam", "mustangs197",
  "bmwm6e24", "lexusrcf", "civic", "datsun620",
  "mazdamx5_90", "mazdamx5cabrio_90", "pontiactransam77", "mitsubishieclipse99", "toyotamr2",
  "nissans30z", "nissan300zx_cabrio", "mini", "subaruforester"
];
export const CATALOG_86_CARS = ALL_CARS_LIST;
export const TOTAL_PREMIUM_CARS: number = ALL_CARS_LIST.length;

export const REAL_ESTATE_PROPERTIES: string[] = [
  "apartment_01", "apartment_51", "apartment_95",
  "apartment_industrial_SP", "apartment_midtown_SP", "apartment_midtown2_SP", "apartment_midtown3_SP",
  "Industrial_apartment_1", "Industrial_apartment_2", "Industrial_apartment_3", "Industrial_apartment_4", "Industrial_apartment_5", "Industrial_apartment_6",
  "Midtown_apartment_1", "Midtown_apartment_2", "Midtown_apartment_3", "Midtown_apartment_4", "Midtown_apartment_5", "Midtown_apartment_6",
  "Midtown_apartment_7", "Midtown_apartment_8", "Midtown_apartment_9", "Midtown_apartment_10", "Midtown_apartment_11", "Midtown_apartment_12",
  "Prigorod_apartment_1", "Prigorod_apartment_2", "Prigorod_apartment_3", "Prigorod_apartment_4", "Prigorod_apartment_5", "Prigorod_apartment_6", "Prigorod_apartment_7",
  "Mountain_apartment_1", "Mountain_apartment_2", "Mountain_apartment_3", "Mountain_apartment_4", "Mountain_apartment_5", "Mountain_apartment_6",
  "Mountain_apartment_7", "Mountain_apartment_8", "Mountain_apartment_9", "Mountain_apartment_11", "Mountain_apartment_13", "Mountain_apartment_14",
  "Mountain_apartment_15", "Mountain_apartment_16", "Mountain_apartment_17", "Mountain_apartment_18", "Mountain_apartment_19",
  "Speedway_apartment_1", "Speedway_apartment_2", "Speedway_apartment_3"
];

export const EXTRA_LOCATION_KEYS: string[] = [
  "car_market_0",
  "car_showroom_0",
  "car_showroom_1",
  "car_showroom_2"
];

export const AUTHENTIC_REAL_ESTATE_SLOTS: string[] = REAL_ESTATE_PROPERTIES.flatMap(prop => [
  `${prop}_slot_0`,
  `${prop}_slot_1`,
  `${prop}_slot_2`
]);

export const ALL_CLUBS: string[] = [
  "club_burnout_rangers", "club_black_lotus", "club_arctic_outlaws",
  "club_speedstar_energy", "club_grip_masters", "club_chimeras", "club_savage",
  "club_emeralds", "club_hyper_sonic", "club_spitfire", "club_drift_united",
  "club_falcons_outlaws", "club_pitons", "club_pythons", "club_speedline_syndicate",
  "club_streethunters", "club_white_tigers", "club_21_tribe", "club_road_runner",
  "club_western_sierra"
];

export const ALL_MAPS: string[] = ["industrial", "midtown", "suburb", "port", "mountain", "sunset"];

export const INTRO_QUESTS: string[] = [
  "car_choice_intro", "move_to_apartment_intro_quest",
  "move_to_gasstation_intro_quest", "move_to_tuning_intro_quest",
  "move_to_club_intro_quest", "quest_intro", "intro_race",
  "delivery_intro_quest", "first_delivery_quest", "first_club_race",
  "first_tuning_quest", "first_gas_station_quest", "apartment_tutorial_quest"
];

export const VALID_COSMETIC_KEYS: string[] = [
  "unlock_avatar_1", "unlock_frame_1", "unlock_banner_1",
  "unlock_avatar_2", "unlock_frame_2", "unlock_banner_2",
  "unlock_avatar_3", "unlock_frame_3", "unlock_banner_3",
  "unlock_avatar_4", "unlock_frame_4", "unlock_banner_4",
  "unlock_avatar_5", "unlock_frame_5", "unlock_banner_5",
  "unlock_avatar_6", "unlock_frame_6", "unlock_banner_6",
  "unlock_avatar_7", "unlock_frame_7", "unlock_banner_7",
  "unlock_avatar_8", "unlock_frame_8", "unlock_banner_8",
  "unlock_avatar_9", "unlock_frame_9", "unlock_banner_9",
  "unlock_avatar_10", "unlock_frame_10", "unlock_banner_10",
  "unlock_avatar_11", "unlock_frame_11", "unlock_banner_11",
  "unlock_avatar_12", "unlock_frame_12", "unlock_banner_12",
  "unlock_avatar_13", "unlock_frame_13", "unlock_banner_13",
  "unlock_avatar_14", "unlock_frame_14", "unlock_banner_14",
  "unlock_avatar_15", "unlock_frame_15", "unlock_banner_15",
  "unlock_avatar_16", "unlock_frame_16", "unlock_banner_16",
  "banner_champion_1", "frame_champion_1", "avatar_champion_1", "unlock_banner_champion_1", "unlock_frame_champion_1", "unlock_avatar_champion_1",
  "banner_champion_2", "frame_champion_2", "avatar_champion_2", "unlock_banner_champion_2", "unlock_frame_champion_2", "unlock_avatar_champion_2",
  "banner_champion_3", "frame_champion_3", "avatar_champion_3", "unlock_banner_champion_3", "unlock_frame_champion_3", "unlock_avatar_champion_3",
  "banner_champion_4", "frame_champion_4", "avatar_champion_4", "unlock_banner_champion_4", "unlock_frame_champion_4", "unlock_avatar_champion_4",
  "emoji_1", "emoji_2", "emoji_3", "emoji_4",
  "unlock_street_pass_emoji_5", "unlock_street_pass_emoji_6", "unlock_street_pass_emoji_7",
  "unlock_street_pass_emoji_8", "unlock_street_pass_emoji_9", "unlock_street_pass_emoji_10",
  "unlock_street_pass_emoji_ellis_1", "unlock_street_pass_emoji_ellis_2", "unlock_street_pass_emoji_ellis_3",
  "unlock_street_pass_emoji_ellis_4", "unlock_street_pass_emoji_ellis_5", "unlock_street_pass_emoji_ellis_6",
  "unlock_street_pass_emoji_ellis_7", "unlock_street_pass_emoji_ellis_8", "unlock_street_pass_emoji_ellis_9",
  "unlock_street_pass_emoji_ellis_10", "unlock_street_pass_emoji_ellis_11", "unlock_street_pass_emoji_ellis_12",
  "unlock_emoji_Сhampionship_1", "unlock_emoji_Сhampionship_2", "unlock_emoji_Сhampionship_3",
  "unlock_emoji_Сhampionship_4", "unlock_emoji_Сhampionship_5"
];

export const ORDERED_COSMETIC_SETS = EXTENDED_ORDERED_COSMETIC_SETS;

export const ALL_MAP_LOCATION_OBJECTS: string[] = [
  "gasstation_0", "gasstation_1", "gasstation_2", "gasstation_3", "gasstation_4", "gasstation_5", "gasstation_6",
  "gasstation_7", "gasstation_8", "gasstation_9", "gasstation_10", "gasstation_11", "gasstation_12", "gasstation_13", "gasstation_14",
  "tuning_0", "tuning_1", "tuning_2", "tuning_3", "tuning_4", "tuning_5", "tuning_6", "tuning_7", "tuning_8", "tuning_9",
  "car_market_0", "car_showroom_0", "car_showroom_1", "car_showroom_2",
  "apartment_01", "apartment_51", "apartment_95",
  "apartment_industrial_SP", "apartment_midtown_SP", "apartment_midtown2_SP", "apartment_midtown3_SP",
  "Industrial_apartment_1", "Industrial_apartment_2", "Industrial_apartment_3", "Industrial_apartment_4", "Industrial_apartment_5", "Industrial_apartment_6",
  "Midtown_apartment_1", "Midtown_apartment_2", "Midtown_apartment_3", "Midtown_apartment_4", "Midtown_apartment_5", "Midtown_apartment_6",
  "Midtown_apartment_7", "Midtown_apartment_8", "Midtown_apartment_9", "Midtown_apartment_10", "Midtown_apartment_11", "Midtown_apartment_12",
  "Prigorod_apartment_1", "Prigorod_apartment_2", "Prigorod_apartment_3", "Prigorod_apartment_4", "Prigorod_apartment_5", "Prigorod_apartment_6", "Prigorod_apartment_7",
  "Mountain_apartment_1", "Mountain_apartment_2", "Mountain_apartment_3", "Mountain_apartment_4", "Mountain_apartment_5", "Mountain_apartment_6",
  "Mountain_apartment_7", "Mountain_apartment_8", "Mountain_apartment_9", "Mountain_apartment_11", "Mountain_apartment_13", "Mountain_apartment_14",
  "Mountain_apartment_15", "Mountain_apartment_16", "Mountain_apartment_17", "Mountain_apartment_18", "Mountain_apartment_19",
  "Speedway_apartment_1", "Speedway_apartment_2", "Speedway_apartment_3",
  "club_burnout_rangers", "club_black_lotus", "club_arctic_outlaws", "club_speedstar_energy", "club_grip_masters", "club_chimeras", "club_savage",
  "club_emeralds", "club_hyper_sonic", "club_spitfire", "club_drift_united", "club_falcons_outlaws", "club_pitons", "club_pythons", "club_speedline_syndicate",
  "club_streethunters", "club_white_tigers", "club_21_tribe", "club_road_runner", "club_western_sierra"
];

export function getCarTemplate(descId: string): any {
  const cleanId = (ID_SELF_HEAL_MAP[descId] || descId).replace(/^car_/, "").replace(/_sp[12]/g, "");
  let builds: any = null;
  try {
    builds = PREMIUM_BUILDS;
  } catch {}

  if (builds && builds[cleanId] && typeof builds[cleanId] === "object") {
    const obj = structuredClone(builds[cleanId]);
    obj.__desc_id = cleanId;
    obj.is_bought = true;
    return obj;
  }

  if (builds && builds["toyotasupra2020"]) {
    const fallback = structuredClone(builds["toyotasupra2020"]);
    fallback.__desc_id = cleanId;
    fallback.is_bought = true;
    return fallback;
  }

  return {
    __desc_id: cleanId,
    is_bought: true,
    consumed_resources: {
      gasoline: { ts: Math.floor(Date.now() / 1000), max_amount: 100, amount: 100 },
      nitro: { ts: Math.floor(Date.now() / 1000), max_amount: 20, amount: 20 },
      statistic_drive_time: { amount: 100 },
      statistic_total_distance: { amount: 500 }
    }
  };
}

let PREMIUM_BUILDS: Record<string, any> = {};
try {
  const possiblePaths = [
    path.join(process.cwd(), "premium_builds.json"),
    path.join(__dirname, "premium_builds.json"),
    path.join("d:", "CarX", "RRTbot", "premium_builds.json")
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      PREMIUM_BUILDS = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log(`[STARTUP] Successfully loaded ${Object.keys(PREMIUM_BUILDS).length} premium builds from ${p}`);
      break;
    }
  }
} catch (e: any) {
  console.error("[STARTUP ERROR] Failed to load premium builds:", e.message);
}

// ── Bot.py Car Database (189 Authentic Builds from COMPRESSED_CARS_STRING) ───
export function extractCarsFromCompressed(s: string): Record<string, any> | null {
  if (!s) return null;
  const data = decompressData(s);
  if (!data) return null;
  let cars: Record<string, any> = {};
  if (typeof data === "object") {
    if (data.cars && typeof data.cars === "object" && data.cars.items) {
      cars = data.cars.items;
    } else {
      for (const v of Object.values(data)) {
        if (v && typeof v === "object" && (v as any).__desc_id) {
          cars = data;
          break;
        }
      }
    }
  }
  if (!cars || Object.keys(cars).length === 0) return null;
  const extracted: Record<string, any> = {};
  for (const [cid, cfg] of Object.entries(cars)) {
    if (cfg && typeof cfg === "object" && (cfg as any).__desc_id) {
      extracted[String(cid)] = JSON.parse(JSON.stringify(cfg));
    }
  }
  return Object.keys(extracted).length > 0 ? extracted : null;
}

export let BOT_CARS_189: Record<string, any> = {};
try {
  // First decompress directly from COMPRESSED_CARS_STRING copied from bot.py
  if (COMPRESSED_CARS_STRING) {
    const extracted = extractCarsFromCompressed(COMPRESSED_CARS_STRING);
    if (extracted) {
      BOT_CARS_189 = extracted;
      console.log(`[STARTUP] Successfully decompressed ${Object.keys(BOT_CARS_189).length} authentic cars from COMPRESSED_CARS_STRING!`);
    }
  }
} catch (e: any) {
  console.warn("[STARTUP] Error decompressing COMPRESSED_CARS_STRING:", e?.message || e);
}

if (Object.keys(BOT_CARS_189).length === 0) {
  try {
    const possibleBotCarPaths = [
      path.join(process.cwd(), "bot_cars_189.json"),
      path.join(__dirname, "bot_cars_189.json")
    ];
    for (const p of possibleBotCarPaths) {
      if (fs.existsSync(p)) {
        BOT_CARS_189 = JSON.parse(fs.readFileSync(p, "utf-8"));
        console.log(`[STARTUP] Successfully loaded ${Object.keys(BOT_CARS_189).length} authentic cars from bot_cars_189.json`);
        break;
      }
    }
  } catch (e: any) {
    console.error("[STARTUP ERROR] Failed to load bot_cars_189.json:", e.message);
  }
}

// ── Bot.py Restore Profile Helper ───────────────────────────────────────────
const RESTORE_PROFILE_PATH = path.join(process.cwd(), "restore_profile.json");
export function getRestoreProfile(): any {
  if (fs.existsSync(RESTORE_PROFILE_PATH)) {
    try {
      const backup = JSON.parse(fs.readFileSync(RESTORE_PROFILE_PATH, "utf-8"));
      backup.data_version = (backup.data_version || 0) + 1;
      backup.messaging_version = backup.messaging_version || 1;
      backup.model_upgrade_version = backup.model_upgrade_version || 1;
      return backup;
    } catch (e: any) {
      console.warn(`[RESTORE BACKUP] Failed reading restore_profile.json: ${e.message}`);
    }
  }
  return null;
}

// ── Clean Map Unlock Logic (One by One) ─────────────────────────────────────
export function unlockMapOneByOne(profile: any, mapName?: string): { profile: any; unlockedMap: string; totalUnlocked: number; allUnlocked: boolean } {
  profile.game_world_parts = profile.game_world_parts || {};

  if (mapName && ALL_MAPS.includes(mapName.toLowerCase())) {
    const cleanMap = mapName.toLowerCase();
    profile.game_world_parts[cleanMap] = { unlocked: true };
    const totalUnlocked = ALL_MAPS.filter(m => profile.game_world_parts[m]?.unlocked).length;
    return { profile, unlockedMap: cleanMap, totalUnlocked, allUnlocked: totalUnlocked === ALL_MAPS.length };
  }

  // Find the next locked map in sequence
  let target = "";
  for (const m of ALL_MAPS) {
    if (!profile.game_world_parts[m] || !profile.game_world_parts[m].unlocked) {
      target = m;
      break;
    }
  }

  if (target) {
    profile.game_world_parts[target] = { unlocked: true };
  }

  const totalUnlocked = ALL_MAPS.filter(m => profile.game_world_parts[m]?.unlocked).length;
  return {
    profile,
    unlockedMap: target || "none",
    totalUnlocked,
    allUnlocked: totalUnlocked === ALL_MAPS.length
  };
}

// ── Clean Maps & Houses Unlock (Exact map&php&house.py Implementation) ───────
export const ALL_MAP_PARTS = ["industrial", "midtown", "suburb", "port", "mountain", "sunset"];

export const NEW_SHOP_PACKS = [
  "special_avatars", "special_banners", "special_frames", "special_emoji",
  "special_8", "special_11", "special_14", "special_15", "special_78",
];

export const OFFICIAL_52_REAL_ESTATES = [
  "Industrial_apartment_1", "Industrial_apartment_2", "Industrial_apartment_3",
  "Industrial_apartment_4", "Industrial_apartment_5", "Industrial_apartment_6",
  "Midtown_apartment_1", "Midtown_apartment_10", "Midtown_apartment_11",
  "Midtown_apartment_12", "Midtown_apartment_2", "Midtown_apartment_3",
  "Midtown_apartment_4", "Midtown_apartment_5", "Midtown_apartment_6",
  "Midtown_apartment_7", "Midtown_apartment_8", "Midtown_apartment_9",
  "Mountain_apartment_1", "Mountain_apartment_11", "Mountain_apartment_13",
  "Mountain_apartment_14", "Mountain_apartment_15", "Mountain_apartment_16",
  "Mountain_apartment_17", "Mountain_apartment_18", "Mountain_apartment_19",
  "Mountain_apartment_2", "Mountain_apartment_3", "Mountain_apartment_4",
  "Mountain_apartment_5", "Mountain_apartment_6", "Mountain_apartment_7",
  "Mountain_apartment_8", "Mountain_apartment_9", "Prigorod_apartment_1",
  "Prigorod_apartment_2", "Prigorod_apartment_3", "Prigorod_apartment_4",
  "Prigorod_apartment_5", "Prigorod_apartment_6", "Prigorod_apartment_7",
  "Speedway_apartment_1", "Speedway_apartment_2", "Speedway_apartment_3",
  "apartment_01", "apartment_51", "apartment_95", "apartment_industrial_SP",
  "apartment_midtown2_SP", "apartment_midtown3_SP", "apartment_midtown_SP"
];

export const BATTLE_PASS_REWARDS = [
  "unlock_avatar_1","unlock_avatar_2","unlock_avatar_3","unlock_avatar_4",
  "unlock_avatar_5","unlock_avatar_6","unlock_avatar_7","unlock_avatar_8",
  "unlock_avatar_9","unlock_avatar_10","unlock_avatar_11","unlock_avatar_12",
  "unlock_avatar_13","unlock_avatar_14","unlock_avatar_15","unlock_avatar_16",
  "unlock_banner_1","unlock_banner_2","unlock_banner_3","unlock_banner_4",
  "unlock_banner_5","unlock_banner_6","unlock_banner_7","unlock_banner_8",
  "unlock_banner_9","unlock_banner_10","unlock_banner_11","unlock_banner_12",
  "unlock_banner_13","unlock_banner_14","unlock_banner_15","unlock_banner_16",
  "unlock_frame_1","unlock_frame_2","unlock_frame_3","unlock_frame_4",
  "unlock_frame_5","unlock_frame_6","unlock_frame_7","unlock_frame_8",
  "unlock_frame_9","unlock_frame_10","unlock_frame_11","unlock_frame_12",
  "unlock_frame_13","unlock_frame_14","unlock_frame_15","unlock_frame_16",
  "unlock_street_pass_emoji_ellis_3",
  "banner_champion_1","frame_champion_1","avatar_champion_1",
  "unlock_banner_champion_1","unlock_frame_champion_1","unlock_avatar_champion_1",
  "banner_champion_2","frame_champion_2","avatar_champion_2",
  "unlock_banner_champion_2","unlock_frame_champion_2","unlock_avatar_champion_2",
  "banner_champion_3","frame_champion_3","avatar_champion_3",
  "unlock_banner_champion_3","unlock_frame_champion_3","unlock_avatar_champion_3",
  "banner_champion_4","frame_champion_4","avatar_champion_4",
  "unlock_banner_champion_4","unlock_frame_champion_4","unlock_avatar_champion_4",
  "emoji_1","emoji_2","emoji_3","emoji_4",
  "unlock_street_pass_emoji_5","unlock_street_pass_emoji_6",
  "unlock_street_pass_emoji_7","unlock_street_pass_emoji_8",
  "unlock_street_pass_emoji_9","unlock_street_pass_emoji_10",
  "unlock_street_pass_emoji_ellis_1","unlock_street_pass_emoji_ellis_2",
  "unlock_street_pass_emoji_ellis_4","unlock_street_pass_emoji_ellis_5",
  "unlock_street_pass_emoji_ellis_6","unlock_street_pass_emoji_ellis_7",
  "unlock_street_pass_emoji_ellis_8","unlock_street_pass_emoji_ellis_9",
  "unlock_street_pass_emoji_ellis_10","unlock_street_pass_emoji_ellis_11",
  "unlock_street_pass_emoji_ellis_12",
  "unlock_emoji_Сhampionship_1","unlock_emoji_Сhampionship_2",
  "unlock_emoji_Сhampionship_3","unlock_emoji_Сhampionship_4",
  "unlock_emoji_Сhampionship_5"
];

export function unlockMapsOnly(data: any): void {
  data.game_world_parts = data.game_world_parts || {};
  for (const part of ALL_MAP_PARTS) {
    data.game_world_parts[part] = { unlocked: true };
  }
}

export function unlockProfileSafe(data: any): void {
  const carsDict = data.cars?.items || (data.cars && typeof data.cars === "object" && !Array.isArray(data.cars) ? data.cars : {});
  const availableCarIds = Object.keys(carsDict);
  let carId = String(data.current_car_id || "");
  if (!availableCarIds.includes(carId) && availableCarIds.length > 0) {
    carId = availableCarIds[0];
    data.current_car_id = carId;
  }

  data.real_estate_slots = data.real_estate_slots || {};
  for (let i = 0; i < 3; i++) {
    const key = `apartment_95_slot_${i}`;
    data.real_estate_slots[key] = data.real_estate_slots[key] || {};
    data.real_estate_slots[key].unlocked = true;
    if (i === 0 && carId) {
      data.real_estate_slots[key].car_id = carId;
    }
  }

  if (carId && availableCarIds.includes(carId)) {
    data.car_to_real_estate_slot = { keys: [carId], values: ["apartment_95_slot_0"] };
  } else {
    data.car_to_real_estate_slot = {};
  }

  data.shop_owned_packs = data.shop_owned_packs || { keys: [] };
  if (!Array.isArray(data.shop_owned_packs.keys)) data.shop_owned_packs.keys = [];
  const existingPacks = new Set<string>(data.shop_owned_packs.keys);
  for (const p of NEW_SHOP_PACKS) {
    if (!existingPacks.has(p)) {
      data.shop_owned_packs.keys.push(p);
      existingPacks.add(p);
    }
  }

  data.battle_pass_event_rewards = data.battle_pass_event_rewards || { keys: [] };
  if (!Array.isArray(data.battle_pass_event_rewards.keys)) data.battle_pass_event_rewards.keys = [];
  const existingBP = new Set<string>(data.battle_pass_event_rewards.keys);
  for (const r of BATTLE_PASS_REWARDS) {
    if (!existingBP.has(r)) {
      data.battle_pass_event_rewards.keys.push(r);
      existingBP.add(r);
    }
  }

  data.emoji = { keys: ["0", "1", "2", "3"], values: ["emoji_1", "emoji_2", "emoji_3", "emoji_4"] };
  data.data_version = 74;
  data.playerDataVersion = 74;
  data.messaging_version = 13;
  data.model_upgrade_version = 1;
}

export function unlockAllHousesSafe(data: any): void {
  const cleanRE: Record<string, { is_bought: boolean }> = {};
  for (const k of OFFICIAL_52_REAL_ESTATES) {
    cleanRE[k] = { is_bought: true };
  }
  data.real_estates = cleanRE;
  data.data_version = 74;
  data.playerDataVersion = 74;
}

export function cleanRewriteAccountData(profile: any): any {
  if (!profile || typeof profile !== "object") return profile;
  unlockMapsOnly(profile);
  unlockAllHousesSafe(profile);
  unlockProfileSafe(profile);
  if (profile.compressed_data) delete profile.compressed_data;
  return profile;
}

export function unlockMapsUltimate(profile: any): any {
  return cleanRewriteAccountData(profile);
}

export const injectMapsV19 = unlockMapsUltimate;

// Helper to safely apply body parts to every car across garage
function addPartsToAllCars(profile: any, carParts: string[]): number {
  let addedParts = 0;
  if (!profile || !carParts || carParts.length === 0) return 0;
  const carsDict = profile.cars?.items || (profile.cars && typeof profile.cars === "object" && !Array.isArray(profile.cars) ? profile.cars : {});
  for (const cid of Object.keys(carsDict)) {
    const car = carsDict[cid];
    if (!car || typeof car !== "object") continue;
    car.body_part_set = car.body_part_set || { keys: [] };
    if (!Array.isArray(car.body_part_set.keys)) car.body_part_set.keys = [];
    const existingP = new Set<string>(car.body_part_set.keys);
    for (const pk of carParts) {
      if (!existingP.has(pk)) {
        car.body_part_set.keys.push(pk);
        existingP.add(pk);
        addedParts++;
      }
    }
  }
  return addedParts;
}

// ── Cosmetic Injection Helpers with One-by-One Support ───────────────────────
export function injectNeonCosmetics(profile: any, option: string = "all", count?: number): { addedRewards: number; addedParts: number; messageDetail?: string } {
  profile.battle_pass_event_rewards = profile.battle_pass_event_rewards || { keys: [] };
  if (!Array.isArray(profile.battle_pass_event_rewards.keys)) profile.battle_pass_event_rewards.keys = [];
  const existingR = new Set<string>(profile.battle_pass_event_rewards.keys);

  let targetRewards: string[] = [];
  let targetParts: string[] = [];
  let messageDetail = "";

  if (option === "next" || count === 1) {
    // One-by-one: find the first unowned neon in sequence 1..15
    const nextReward = ALL_NEON_REWARDS.find(r => !existingR.has(r));
    if (nextReward) {
      targetRewards = [nextReward];
      const match = nextReward.match(/\d+/);
      const num = match ? match[0] : "1";
      targetParts = [
        "neon_front_static", "neon_side_static", "neon_rear_static",
        "neon_front_empty", "neon_side_empty", "neon_rear_empty",
        "neon_front_animated", "neon_side_animated", "neon_rear_animated",
        `neon_front_animated_${num}`, `neon_side_animated_${num}`, `neon_rear_animated_${num}`, `neon_animated_${num}`
      ];
      messageDetail = `Neon Underglow #${num}`;
    }
  } else if (count && count > 1) {
    const unowned = ALL_NEON_REWARDS.filter(r => !existingR.has(r));
    targetRewards = unowned.slice(0, count);
    const nums = targetRewards.map(r => r.match(/\d+/)?.[0]).filter(Boolean);
    targetParts = [
      "neon_front_static", "neon_side_static", "neon_rear_static",
      "neon_front_empty", "neon_side_empty", "neon_rear_empty",
      "neon_front_animated", "neon_side_animated", "neon_rear_animated"
    ];
    for (const num of nums) {
      targetParts.push(`neon_front_animated_${num}`, `neon_side_animated_${num}`, `neon_rear_animated_${num}`, `neon_animated_${num}`);
    }
    messageDetail = `${targetRewards.length} Neon Underglows`;
  } else {
    const { rewards, carParts } = getNeonKeys(option);
    targetRewards = rewards;
    targetParts = carParts;
    messageDetail = `All ${ALL_NEON_REWARDS.length} Neon Underglows`;
  }

  let addedRewards = 0;
  for (const rk of targetRewards) {
    if (!existingR.has(rk)) {
      profile.battle_pass_event_rewards.keys.push(rk);
      existingR.add(rk);
      addedRewards++;
    }
  }

  const addedParts = addPartsToAllCars(profile, targetParts);

  // Ensure shop pack for cosmetic neons is owned
  profile.shop_owned_packs = profile.shop_owned_packs || { keys: [] };
  if (!Array.isArray(profile.shop_owned_packs.keys)) profile.shop_owned_packs.keys = [];
  if (!profile.shop_owned_packs.keys.includes("special_78")) profile.shop_owned_packs.keys.push("special_78");

  return { addedRewards, addedParts, messageDetail };
}

export function injectTireSidewalls(profile: any, option: string = "all", count?: number): { addedRewards: number; addedParts: number; messageDetail?: string } {
  profile.battle_pass_event_rewards = profile.battle_pass_event_rewards || { keys: [] };
  if (!Array.isArray(profile.battle_pass_event_rewards.keys)) profile.battle_pass_event_rewards.keys = [];
  const existingR = new Set<string>(profile.battle_pass_event_rewards.keys);

  let targetRewards: string[] = [];
  let targetParts: string[] = [];
  let messageDetail = "";

  if (option === "next" || count === 1) {
    const nextReward = ALL_TIRE_SIDE_WALL_REWARDS.find(r => !existingR.has(r));
    if (nextReward) {
      targetRewards = [nextReward];
      const match = nextReward.replace(/^unlock_/, "");
      targetParts = ALL_TIRE_SIDE_WALL_BODY_PARTS.filter(p => p.includes(match) || match.includes(p));
      if (targetParts.length === 0) targetParts = ALL_TIRE_SIDE_WALL_BODY_PARTS.slice(0, 5);
      messageDetail = `Tire Sidewall (${match})`;
    }
  } else if (count && count > 1) {
    const unowned = ALL_TIRE_SIDE_WALL_REWARDS.filter(r => !existingR.has(r));
    targetRewards = unowned.slice(0, count);
    targetParts = ALL_TIRE_SIDE_WALL_BODY_PARTS;
    messageDetail = `${targetRewards.length} Tire Sidewalls`;
  } else {
    const { rewards, carParts } = getTireSidewallKeys(option);
    targetRewards = rewards;
    targetParts = carParts;
    messageDetail = `All ${ALL_TIRE_SIDE_WALL_REWARDS.length} Tire Sidewalls`;
  }

  let addedRewards = 0;
  for (const rk of targetRewards) {
    if (!existingR.has(rk)) {
      profile.battle_pass_event_rewards.keys.push(rk);
      existingR.add(rk);
      addedRewards++;
    }
  }

  const addedParts = addPartsToAllCars(profile, targetParts);
  return { addedRewards, addedParts, messageDetail };
}

export function injectNumberPlates(profile: any, option: string = "all", count?: number): { addedRewards: number; addedParts: number; messageDetail?: string } {
  profile.battle_pass_event_rewards = profile.battle_pass_event_rewards || { keys: [] };
  if (!Array.isArray(profile.battle_pass_event_rewards.keys)) profile.battle_pass_event_rewards.keys = [];
  const existingR = new Set<string>(profile.battle_pass_event_rewards.keys);

  let targetRewards: string[] = [];
  let targetParts: string[] = [];
  let messageDetail = "";

  if (option === "next" || count === 1) {
    const nextReward = ALL_NUMBER_PLATE_REWARDS.find(r => !existingR.has(r));
    if (nextReward) {
      targetRewards = [nextReward];
      const cleanName = nextReward.replace(/^unlock_/, "");
      targetParts = ALL_NUMBER_PLATE_BODY_PARTS.filter(p => p.includes(cleanName) || cleanName.includes(p));
      if (targetParts.length === 0) targetParts = [cleanName];
      messageDetail = `Number Plate (${cleanName})`;
    }
  } else if (count && count > 1) {
    const unowned = ALL_NUMBER_PLATE_REWARDS.filter(r => !existingR.has(r));
    targetRewards = unowned.slice(0, count);
    targetParts = ALL_NUMBER_PLATE_BODY_PARTS;
    messageDetail = `${targetRewards.length} Number Plates`;
  } else {
    const { rewards, carParts } = getNumberPlateKeys(option);
    targetRewards = rewards;
    targetParts = carParts;
    messageDetail = `All ${ALL_NUMBER_PLATE_REWARDS.length} Number Plates`;
  }

  let addedRewards = 0;
  for (const rk of targetRewards) {
    if (!existingR.has(rk)) {
      profile.battle_pass_event_rewards.keys.push(rk);
      existingR.add(rk);
      addedRewards++;
    }
  }

  const addedParts = addPartsToAllCars(profile, targetParts);
  return { addedRewards, addedParts, messageDetail };
}

export function injectWheelRims(profile: any, option: string = "all", count?: number): { addedRewards: number; addedParts: number; messageDetail?: string } {
  profile.battle_pass_event_rewards = profile.battle_pass_event_rewards || { keys: [] };
  if (!Array.isArray(profile.battle_pass_event_rewards.keys)) profile.battle_pass_event_rewards.keys = [];
  const existingR = new Set<string>(profile.battle_pass_event_rewards.keys);

  let targetRewards: string[] = [];
  let targetParts: string[] = [];
  let messageDetail = "";

  if (option === "next" || count === 1) {
    const nextReward = ALL_WHEEL_RIM_REWARDS.find(r => !existingR.has(r));
    if (nextReward) {
      targetRewards = [nextReward];
      const num = nextReward.match(/\d+/)?.[0] || "1";
      targetParts = [`wheel_rim_${num}`];
      messageDetail = `Wheel Rim #${num}`;
    } else {
      // If all BP rewards owned, take next 5 aftermarket rims
      targetParts = ALL_WHEEL_RIM_BODY_PARTS.slice(0, 10);
      messageDetail = `10 Custom Tuner Rims`;
    }
  } else if (count && count > 1) {
    const unowned = ALL_WHEEL_RIM_REWARDS.filter(r => !existingR.has(r));
    targetRewards = unowned.slice(0, count);
    targetParts = ALL_WHEEL_RIM_BODY_PARTS.slice(0, count * 5);
    messageDetail = `${targetRewards.length || count} Wheel Rims`;
  } else {
    const { rewards, carParts } = getWheelRimKeys(option);
    targetRewards = rewards;
    targetParts = carParts;
    messageDetail = `All 400+ Wheel Rims`;
  }

  let addedRewards = 0;
  for (const rk of targetRewards) {
    if (!existingR.has(rk)) {
      profile.battle_pass_event_rewards.keys.push(rk);
      existingR.add(rk);
      addedRewards++;
    }
  }

  const addedParts = addPartsToAllCars(profile, targetParts);
  return { addedRewards, addedParts, messageDetail };
}

// ── Bot.py Implant Cars Logic ───────────────────────────────────────────────
export function implantCarsFromBot(profile: any, carsToAdd: Record<string, any>): { profile: any; added: number } {
  if (!carsToAdd || Object.keys(carsToAdd).length === 0) {
    return { profile, added: 0 };
  }
  profile.cars = profile.cars || { seed: 1000, items: {} };
  profile.cars.items = profile.cars.items || {};
  const existing = profile.cars.items;

  let maxId = 1000;
  for (const cid in existing) {
    const num = parseInt(cid, 10);
    if (!isNaN(num) && num > maxId) {
      maxId = num;
    }
  }

  let added = 0;
  for (const key of Object.keys(carsToAdd)) {
    const cfg = carsToAdd[key];
    if (!cfg || typeof cfg !== "object" || !cfg.__desc_id) continue;
    maxId++;
    existing[String(maxId)] = structuredClone(cfg);
    added++;
  }

  profile.cars.seed = Math.max(1000, maxId + 1);
  if (!existing[String(profile.current_car_id)]) {
    profile.current_car_id = Object.keys(existing)[0] || "1000";
  }

  const activeModelsMap: Record<string, number> = {};
  for (const cid in existing) {
    const descId = existing[cid]?.__desc_id;
    if (descId) {
      activeModelsMap[descId] = (activeModelsMap[descId] || 0) + 1;
    }
  }
  profile.car_models = {
    keys: Object.keys(activeModelsMap),
    values: Object.values(activeModelsMap).map(v => parseInt(v as any, 10) || 1)
  };

  return { profile, added };
}

// ── Bot.py Inject Currency Function (Safe Incremental Step) ───────────────────
export function injectCurrencyFromBot(profile: any, silver = 1000, gold = 1000, xp = 100): any {
  if (!profile.resources) {
    profile.resources = {};
  }
  const currentSoft = Number(profile.resources.soft?.amount ?? 0) || 0;
  const currentHard = Number(profile.resources.hard?.amount ?? 0) || 0;
  const currentExp = Number(profile.resources.experience?.amount ?? 0) || 0;

  const newSoft = Math.min(2140000000, currentSoft + silver);
  const newHard = Math.min(2140000000, currentHard + gold);
  const newExp = currentExp + xp;

  profile.resources.soft = { amount: newSoft };
  profile.resources.hard = { amount: newHard };
  profile.resources.experience = { award_index: calculateLevelFromExp(newExp) || 1, amount: newExp };
  for (const key of ["battle_pass_points", "battle_pass_resource", "event_points", "ep", "bp"]) {
    profile.resources[key] = { amount: 999999 };
  }
  profile.has_premium = true;
  profile.is_premium_active = true;
  profile.is_premium_max_player = true;
  profile.premium_timer = 99999999;
  profile.premium_length = 99999999;
  profile.is_pass_owned = true;
  profile.battle_pass_resource_amount = 999999;
  return profile;
}

// ── Bot.py Max StreetPass Points Function ───────────────────────────────────
export function maxStreetPassPointsFromBot(profile: any, points = 1000000): any {
  if (!profile.resources) {
    profile.resources = {};
  }
  profile.resources.street_pass = { amount: points };
  profile.resources.battle_pass_points = { amount: points };
  profile.resources.battle_pass_resource = { amount: points };
  profile.resources.event_points = { amount: points };
  profile.resources.ep = { amount: points };
  profile.resources.bp = { amount: points };
  profile.is_pass_owned = true;
  profile.has_premium = true;
  profile.is_premium_active = true;
  profile.is_premium_max_player = true;
  profile.premium_timer = 99999999;
  profile.premium_length = 99999999;
  profile.battle_pass_resource_amount = points;
  if (!profile.postprogression_counter) profile.postprogression_counter = {};
  if (!profile.battle_pass_event_rewards) profile.battle_pass_event_rewards = { keys: [] };
  return profile;
}


function intParse(val: string): number {
  const p = parseInt(val, 10);
  return isNaN(p) ? 0 : p;
}

// Shared helper to extract profile stats from various CarX API response structures
export function extractProfileStats(profile: any, debug = false) {
  // Debug logging removed

  // Resolve the actual resources object - CarX API may wrap in many ways
  let res = profile.resources || null;
  if (!res && profile.profile) res = profile.profile.resources || null;
  if (!res && profile.data) res = profile.data.resources || null;
  // Some responses put resources under statistics or stats
  if (!res && profile.statistics) res = profile.statistics.resources || profile.statistics;
  if (!res && profile.stats) res = profile.stats.resources || profile.stats;
  if (!res && profile.profileData) res = profile.profileData.resources || profile.profileData;
  if (!res && profile.player) res = profile.player.resources || profile.player;
  if (!res && profile.account) res = profile.account.resources || profile.account;
  // Deep search up to 3 levels for any object with 'resources' property
  if (!res) {
    for (const key of Object.keys(profile)) {
      const v = profile[key];
      if (v && typeof v === "object" && v.resources) { res = v.resources; break; }
    }
  }
  // Also search for soft/hard/experience directly on nested objects
  if (!res) {
    for (const key of Object.keys(profile)) {
      const v = profile[key];
      if (v && typeof v === "object" && (v.soft || v.hard || v.experience || v.soft_currency || v.hard_currency || v.cash || v.gold)) {
        res = v; break;
      }
    }
  }
  // Debug logging removed

// Cash (soft currency) - try EVERY possible path
  let cash = 0;
  if (res) {
    cash = res.soft?.amount ?? res.soft_currency ?? res.cash ?? res.soft_currency_amount
      ?? res.softCurrency?.amount ?? res.softCurrency ?? res.soft ?? 0;
    // Handle case where soft is a number directly (not an object)
    if (!cash && typeof res.soft === "number") cash = res.soft;
    if (!cash && typeof res.soft === "string") cash = parseInt(res.soft, 10) || 0;
    if (!cash && typeof res.softCurrency === "number") cash = res.softCurrency;
  }
  if (!cash) cash = profile.cash ?? profile.soft_currency ?? profile.money
    ?? profile.soft_currency_amount ?? profile.softCurrency ?? profile.soft ?? 0;
  // Try inside profile.profile sub-object
  if (!cash && profile.profile) cash = profile.profile.cash ?? profile.profile.soft_currency ?? profile.profile.soft ?? 0;
  // Try inside profile.data sub-object
  if (!cash && profile.data) cash = profile.data.cash ?? profile.data.soft_currency ?? profile.data.soft ?? 0;
  // Try inside profile.profileData sub-object
  if (!cash && profile.profileData) cash = profile.profileData.cash ?? profile.profileData.soft_currency ?? profile.profileData.soft ?? 0;
  // Try inside profile.player sub-object
  if (!cash && profile.player) cash = profile.player.cash ?? profile.player.soft_currency ?? profile.player.soft ?? 0;
  cash = typeof cash === "string" ? parseInt(cash, 10) || 0 : Number(cash) || 0;

  // Gold (hard currency) - try EVERY possible path
  let gold = 0;
  if (res) {
    gold = res.hard?.amount ?? res.hard_currency ?? res.gold ?? res.hard_currency_amount
      ?? res.hardCurrency?.amount ?? res.hardCurrency ?? res.hard ?? 0;
    // Handle case where hard is a number directly (not an object)
    if (!gold && typeof res.hard === "number") gold = res.hard;
    if (!gold && typeof res.hard === "string") gold = parseInt(res.hard, 10) || 0;
    if (!gold && typeof res.hardCurrency === "number") gold = res.hardCurrency;
  }
  if (!gold) gold = profile.gold ?? profile.hard_currency ?? profile.premium_currency
    ?? profile.hard_currency_amount ?? profile.hardCurrency ?? profile.hard ?? 0;
  // Try inside profile.profile sub-object
  if (!gold && profile.profile) gold = profile.profile.gold ?? profile.profile.hard_currency ?? profile.profile.hard ?? 0;
  // Try inside profile.data sub-object
  if (!gold && profile.data) gold = profile.data.gold ?? profile.data.hard_currency ?? profile.data.hard ?? 0;
  // Try inside profile.profileData sub-object
  if (!gold && profile.profileData) gold = profile.profileData.gold ?? profile.profileData.hard_currency ?? profile.profileData.hard ?? 0;
  // Try inside profile.player sub-object
  if (!gold && profile.player) gold = profile.player.gold ?? profile.player.hard_currency ?? profile.player.hard ?? 0;
  gold = typeof gold === "string" ? parseInt(gold, 10) || 0 : Number(gold) || 0;

  // Level - try EVERY possible path
  let level = 1;
  if (res) {
    level = res.experience?.award_index ?? res.experience?.level ?? res.level ?? res.award_index ?? 1;
    // Handle case where experience is a number directly
    if (level === 1 && typeof res.experience === "number") level = 1;
  }
  if (level === 1) level = profile.level ?? profile.player_level ?? profile.playerLevel ?? profile.award_index ?? profile.level_index ?? 1;
  if (level === 1 && profile.profile) level = profile.profile.level ?? profile.profile.player_level ?? profile.profile.award_index ?? 1;
  if (level === 1 && profile.data) level = profile.data.level ?? profile.data.player_level ?? 1;
  if (level === 1 && profile.profileData) level = profile.profileData.level ?? profile.profileData.player_level ?? 1;
  if (level === 1 && profile.player) level = profile.player.level ?? profile.player.player_level ?? 1;
  level = typeof level === "string" ? parseInt(level, 10) || 1 : Number(level) || 1;

  // EXP - try EVERY possible path
  let exp = 0;
  if (res) {
    exp = res.experience?.amount ?? res.experience?.xp ?? res.exp ?? res.experience_amount ?? 0;
    // Handle case where experience is a number directly
    if (!exp && typeof res.experience === "number") exp = res.experience;
    if (!exp && typeof res.experience === "string") exp = parseInt(res.experience, 10) || 0;
  }
  if (!exp) exp = profile.exp ?? profile.experience ?? profile.xp ?? profile.experience_amount ?? profile.xp_amount ?? 0;
  if (!exp && profile.profile) exp = profile.profile.exp ?? profile.profile.experience ?? profile.profile.xp ?? 0;
  if (!exp && profile.data) exp = profile.data.exp ?? profile.data.experience ?? 0;
  if (!exp && profile.profileData) exp = profile.profileData.exp ?? profile.profileData.experience ?? 0;
  if (!exp && profile.player) exp = profile.player.exp ?? profile.player.experience ?? 0;
  exp = typeof exp === "string" ? parseInt(exp, 10) || 0 : Number(exp) || 0;

  // Name - try many paths including nested profile.profile
  const name = profile.name || profile.nickname || profile.username || profile.display_name
    || profile.player_name || profile.profileName || (profile.profile?.nickname) || (profile.profile?.name) || null;
  const avatar = profile.avatar || profile.avatarUrl || profile.avatar_url
    || (profile.profile?.avatar) || null;
  const frame = profile.frame || profile.frameUrl || (profile.profile?.frame) || null;
  const banner = profile.banner || profile.bannerUrl || (profile.profile?.banner) || null;
  const lastUpdated = profile.date_time || profile.updated_at || profile.last_save
    || profile.last_updated || profile.dateTime || (profile.profile?.date_time) || null;

  // Verified - check many possible field names and types (boolean, number, string)
  // Also check nested paths (profile.profile.*, profile.data.*) for CarX API variants
  const verifySources = [profile, profile.profile, profile.data, profile.d, profile.account, profile.user].filter(Boolean);
  let isVerified = false;
  const verifyKeys = [
    "isEmailVerified", "email_verified", "verified", "emailVerified",
    "email_confirmed", "confirmed", "is_confirmed", "accountVerified",
    "isVerified", "verification_status", "verified_status",
    "verify_state", "verifyState", "email_confirmed"
  ];
  for (const src of verifySources) {
    if (isVerified) break;
    for (const key of verifyKeys) {
      const val = src[key];
      if (val === true || val === 1 || val === "1") { isVerified = true; break; }
      if (typeof val === "string" && val.toLowerCase() === "true") { isVerified = true; break; }
      if (val === "verified") { isVerified = true; break; }
    }
  }

  if (debug) {
    // Log all possible verify-related fields for debugging (including nested sources)
    const verifyFields: Record<string, any> = {};
    for (const src of verifySources) {
      for (const key of Object.keys(src)) {
        if (key.toLowerCase().includes("verif") || key.toLowerCase().includes("confirm") || key.toLowerCase().includes("email")) {
          verifyFields[key] = src[key];
        }
      }
    }
    console.log("[PROFILE EXTRACT] Verify fields:", JSON.stringify(verifyFields));
    console.log("[PROFILE EXTRACT] Result:", { cash, gold, level, exp, name, isVerified });
  }

  // Extract Cars & Fleet info
  const carsObj = profile.cars?.items || profile.profile?.cars?.items || {};
  const carIds = Object.keys(carsObj);
  const carsCount = carIds.length > 0 ? carIds.length : (profile.car_models?.keys?.length || 0);

  const currentCarId = String(profile.current_car_id || profile.profile?.current_car_id || (carIds.length > 0 ? carIds[0] : ""));
  const activeCarObj = carsObj[currentCarId] || (carIds.length > 0 ? carsObj[carIds[0]] : null);
  const currentCarDesc = activeCarObj?.__desc_id || "toyotasupra2020";

  // Extract Fleet list
  const carsList: Array<{ id: string; descId: string; mileage?: number; rating?: number }> = [];
  for (const cid of carIds) {
    const c = carsObj[cid];
    if (c) {
      carsList.push({
        id: cid,
        descId: c.__desc_id || "Unknown Car",
        mileage: c.mileage || 0,
        rating: c.rating || 0
      });
    }
  }

  // Extract Clubs
  const clubsObj = profile.clubs || profile.profile?.clubs || {};
  let clubsCount = 0;
  if (typeof clubsObj === "object") {
    clubsCount = Object.keys(clubsObj).length;
  }

  // Extract Garages / Real Estates
  const realEstatesObj = profile.real_estates || profile.profile?.real_estates || {};
  let realEstatesCount = 0;
  if (typeof realEstatesObj === "object") {
    realEstatesCount = Object.keys(realEstatesObj).length;
  }

  // StreetPass
  const hasStreetPass = Boolean(profile.battlepass || profile.battle_pass_premium || profile.battle_pass_rewards?.keys?.length);

  let finalCash = cash;
  if (finalCash === 0 && level === 1 && gold === 0) {
    finalCash = 21000;
  }

  const isBanned = Boolean(
    profile.is_banned ||
    profile.banned ||
    profile.ban ||
    profile.is_blocked ||
    profile.profile?.is_banned ||
    profile.profile?.banned ||
    profile.profile?.ban ||
    profile.account_status === "banned" ||
    profile.status === "banned"
  );
  const banReason = profile.ban_reason || profile.profile?.ban_reason || profile.reason || (isBanned ? "Account flagged by server anti-cheat" : undefined);

  // Maps
  const gwp = profile.game_world_parts || profile.profile?.game_world_parts || {};
  const unlockedMaps = ALL_MAPS.filter(m => gwp[m]?.unlocked);

  const bpKeys: string[] = Array.isArray(profile.battle_pass_event_rewards?.keys)
    ? profile.battle_pass_event_rewards.keys
    : (Array.isArray(profile.profile?.battle_pass_event_rewards?.keys) ? profile.profile.battle_pass_event_rewards.keys : []);
  const bpSet = new Set<string>(bpKeys);

  const avatarsCount = bpKeys.filter((k: string) => k.startsWith("unlock_avatar_")).length;
  const framesCount = bpKeys.filter((k: string) => k.startsWith("unlock_frame_")).length;
  const bannersCount = bpKeys.filter((k: string) => k.startsWith("unlock_banner_")).length;

  const neonsCount = ALL_NEON_REWARDS.filter(k => bpSet.has(k)).length;
  const tireWallsCount = ALL_TIRE_SIDE_WALL_REWARDS.filter(k => bpSet.has(k)).length;
  const platesCount = ALL_NUMBER_PLATE_REWARDS.filter(k => bpSet.has(k)).length;
  const rimsBpCount = ALL_WHEEL_RIM_REWARDS.filter(k => bpSet.has(k)).length;

  const activeCarParts: string[] = Array.isArray(activeCarObj?.body_part_set?.keys) ? activeCarObj.body_part_set.keys : [];
  const rimsCarCount = activeCarParts.filter(k => k.startsWith("wheel_rim_")).length;
  const totalRimsCount = Math.max(rimsBpCount * 40, rimsCarCount);

  return {
    cash: finalCash,
    gold,
    level,
    exp,
    name,
    avatar,
    frame,
    banner,
    lastUpdated,
    isVerified,
    isBanned,
    banReason,
    cars: carsCount,
    cars_count: carsCount,
    clubs_count: clubsCount,
    real_estates_count: realEstatesCount,
    maps_count: unlockedMaps.length,
    unlocked_maps: unlockedMaps,
    all_maps: ALL_MAPS,
    current_car_id: currentCarId,
    current_car: currentCarDesc,
    street_pass: hasStreetPass,
    avatars_count: avatarsCount,
    frames_count: framesCount,
    banners_count: bannersCount,
    neons_count: neonsCount,
    neons_total: ALL_NEON_REWARDS.length,
    neons_approved: neonsCount === ALL_NEON_REWARDS.length,
    tire_walls_count: tireWallsCount,
    tire_walls_total: ALL_TIRE_SIDE_WALL_REWARDS.length,
    tire_walls_approved: tireWallsCount === ALL_TIRE_SIDE_WALL_REWARDS.length,
    plates_count: platesCount,
    plates_total: ALL_NUMBER_PLATE_REWARDS.length,
    plates_approved: platesCount >= 70,
    rims_count: totalRimsCount,
    rims_total: 412,
    rims_approved: totalRimsCount >= 10,
    profile_styles_approved: avatarsCount >= 18 && framesCount >= 18,
    maps_approved: unlockedMaps.length === 6,
    houses_approved: realEstatesCount >= 11,
    cars_list: carsList
  };
}

// CarX API Requester Client
class CarXClient {
  static getDeviceIds() {
    const deviceId = crypto.randomBytes(8).toString("hex");
    const uniqueId = crypto.randomBytes(16).toString("hex");
    return { deviceId, uniqueId };
  }

  // Fire-and-forget device registration — does not block callers
  static registerDevice(deviceId: string) {
    fetch(`${BASE_URL}/register_device`, {
      method: "POST",
      headers: DEFAULT_HEADERS,
      body: JSON.stringify({
        deviceId,
        platform: "android",
        project: 4
      })
    })
      .then(async res => {
        await res.text().catch(() => "");
      })
      .catch(e => console.log("[CARX DEVICE REG ERROR] Skipped:", e));
  }

  // 🤖 Exact registration flow from bot.py (2-step guest token exchange)
  static async register(email: string, pass: string, customDeviceId?: string, customUniqueId?: string) {
    const deviceId = (customDeviceId || crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
    const uniqueId = (customUniqueId || deviceId).slice(0, 32);
    const userAgent = "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)";

    // Fire-and-forget device registration
    CarXClient.registerDevice(deviceId);

    try {
      // Step 1: Guest register to obtain guest token
      const form1 = new URLSearchParams({
        project: "STREET",
        deviceId: deviceId,
        deviceUniqueId: uniqueId
      });

      const controller1 = new AbortController();
      const timeoutId1 = setTimeout(() => controller1.abort(), 20000);
      const res1 = await fetch(`${BASE_URL}/register`, {
        method: "POST",
        headers: {
          "User-Agent": userAgent,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form1.toString(),
        signal: controller1.signal
      });
      clearTimeout(timeoutId1);

      if (res1.status !== 200 && res1.status !== 201) {
        const errText = await res1.text().catch(() => "");
        return { success: false, message: "Guest token failed: " + errText };
      }

      const j1 = await res1.json().catch(() => null);
      const gt = (j1?.d || j1)?.token;
      if (!gt) {
        return { success: false, message: "No guest token received" };
      }

      // Step 2: Register user credentials with guest token authorization
      const form2 = new URLSearchParams({
        project: "STREET",
        username: email,
        password: pass,
        deviceId: deviceId,
        deviceUniqueId: uniqueId
      });

      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 20000);
      const res2 = await fetch(`${BASE_URL}/register`, {
        method: "POST",
        headers: {
          "User-Agent": userAgent,
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${gt}`
        },
        body: form2.toString(),
        signal: controller2.signal
      });
      clearTimeout(timeoutId2);

      const j2 = await res2.json().catch(() => null);
      if ((res2.status === 200 || res2.status === 201) && j2?.d?.token) {
        const token = j2.d.token;
        const userId = j2.d.carxId || j2.d.carx_id || j2.d.id || j2.d.userId;
        return {
          success: true,
          token,
          userId,
          deviceId,
          uniqueId,
          unipId: uniqueId,
          data: j2.d
        };
      }

      let errMsg = "Registration failed";
      if (j2) {
        errMsg = j2.e?.message || j2.message || JSON.stringify(j2);
      }
      return { success: false, message: errMsg, deviceId, uniqueId };
    } catch (e: any) {
      return { success: false, message: e.message || "Network Connection Error" };
    }
  }

  // 🤖 Exact save_profile from bot.py with binary GZIP compression and retries
  static async saveProfile(token: string, profile: any, retries = 3) {
    const userAgent = "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)";
    let b64 = "";
    try {
      b64 = compressProfileToBinaryBase64(profile);
    } catch (e: any) {
      return { success: false, message: "Profile compression failed: " + e.message };
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(`${GAME_BASE_URL}/profiles`, {
          method: "POST",
          headers: {
            "User-Agent": userAgent,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": fToken(token)
          },
          body: JSON.stringify({ compressed_data: b64 }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.status === 200 || res.status === 201 || res.status === 204) {
          return { success: true };
        }
        await new Promise(r => setTimeout(r, 1500));
      } catch {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    return { success: false, message: "Save profile failed after retries" };
  }

  static async authenticate(endpoint: "login" | "register", email: string, pass: string, customDeviceId?: string, customUniqueId?: string) {
    if (endpoint === "register") {
      return await CarXClient.register(email, pass, customDeviceId, customUniqueId);
    }

    try {
      const deviceId = customDeviceId || crypto.randomBytes(8).toString("hex");
      const uniqueId = customUniqueId || crypto.randomUUID().replace(/-/g, "");

      // Fire-and-forget — don't block authentication
      CarXClient.registerDevice(deviceId);

      const payload: any = {
        username: email,
        password: pass,
        deviceId,
        uniqueId,
        unipId: uniqueId,
        unip_id: uniqueId,
        platform: "android",
        project: 4
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: DEFAULT_HEADERS,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.status === 200 || response.status === 201) {
        const data = await response.json();
        const d = data.d || data;
        const token = d.token;
        const userId = d.carxId || d.carx_id || d.id || d.userId || d.user_id || d.uid;
        const unipId = d.unipId || d.unip_id || uniqueId;
        return { success: true, token, userId, deviceId, uniqueId, unipId, data: d };
      } else {
        const errText = await response.text();
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.message || (errJson.e && errJson.e.message) || errText;
        } catch {}
        return { success: false, message: errMsg };
      }
    } catch (e: any) {
      return { success: false, message: e.message || "Network Connection Error" };
    }
  }

  static async verifyAccount(email: string, pass: string, code: string, token?: string, customDeviceId?: string, customUniqueId?: string) {
    try {
      const deviceId = customDeviceId || crypto.randomBytes(8).toString("hex");
      const uniqueId = customUniqueId || crypto.randomUUID().replace(/-/g, "");

      let activeToken = token;
      if (!activeToken) {
        console.log("[VERIFY] No token provided. Logging in first to get a token...");
        const loginRes = await CarXClient.authenticate("login", email, pass, deviceId, uniqueId);
        if (loginRes.success && loginRes.token) {
          activeToken = loginRes.token;
        } else {
          return { success: false, message: loginRes.message || "Failed to log in to obtain verification token." };
        }
      }

      CarXClient.registerDevice(deviceId);

      const headers = {
        ...DEFAULT_HEADERS,
        "Authorization": `Bearer ${activeToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      };

      const body = new URLSearchParams({
        username: email,
        password: pass,
        code,
        deviceId,
        uniqueId,
        unipId: uniqueId,
        unip_id: uniqueId,
        platform: "android",
        project: "4"
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${BASE_URL}/verify`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.status === 200 || response.status === 201) {
        const data = await response.json();
        const d = data.d || data;
        const respToken = d.token || activeToken;
        const userId = d.carxId || d.carx_id || d.id || d.userId || d.user_id || d.uid;
        const unipId = d.unipId || d.unip_id || uniqueId;
        return { success: true, token: respToken, userId, deviceId, uniqueId, unipId, data: d };
      } else {
        const errText = await response.text();
        let errMsg = errText;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.message || (errJson.e && errJson.e.message) || errText;
        } catch {}
        return { success: false, message: errMsg };
      }
    } catch (e: any) {
      return { success: false, message: e.message || "Network Connection Error" };
    }
  }

  // Fetch profile - try both GET and POST, both with userId and without
  static async getProfile(token: string, userId?: string, deviceId?: string, uniqueId?: string) {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      "X-Project": "STREET",
      "Authorization": fToken(token),
      "x-token": token.replace(/^Bearer\s+/i, "")
    };
    if (userId) {
      headers["X-CarX-Id"] = String(userId);
    }
    if (deviceId) {
      headers["Device-Id"] = deviceId;
      headers["X-Device-Id"] = deviceId;
    }
    if (uniqueId) {
      headers["Unique-Id"] = uniqueId;
      headers["X-Unique-Id"] = uniqueId;
      headers["Unip-Id"] = uniqueId;
      headers["X-Unip-Id"] = uniqueId;
      headers["UnipId"] = uniqueId;
      headers["X-UnipId"] = uniqueId;
    }

    type ProfileResult = { profile: any; response: any; isWrappedInD: boolean; isWrappedInData: boolean };

    // Deep-unwrap: recursively search for the actual profile object with resources
    const deepUnwrap = (obj: any, depth = 0): any => {
      if (!obj || typeof obj !== "object" || depth > 4) return null;
      // If this object has resources with any content, it's the profile
      if (obj.resources && typeof obj.resources === "object") {
        const r = obj.resources;
        const hasResourceKeys = Object.keys(r).some(k => r[k] !== undefined && r[k] !== null);
        if (hasResourceKeys) return obj;
      }
      // If this object has cars/clubs/date_time, it's likely the profile
      if (obj.cars || obj.clubs || obj.date_time || obj.car_models) return obj;
      // Try common wrappers
      for (const key of ["d", "data", "profile", "result", "body", "content"]) {
        if (obj[key] && typeof obj[key] === "object") {
          const found = deepUnwrap(obj[key], depth + 1);
          if (found) return found;
        }
      }
      return null;
    };

    const tryRequest = (url: string, method: string): Promise<ProfileResult | null> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const body = method === "POST" ? JSON.stringify({}) : undefined;
      return fetch(url, { headers, method, signal: controller.signal, body })
        .then(async res => {
          clearTimeout(timeoutId);
          console.log(`[PROFILE FETCH] ${method} ${url} status=${res.status}`);
          if (res.status !== 200 && res.status !== 201) {
            const errText = await res.text().catch(() => "");
            console.log(`[PROFILE FETCH] Error body: ${errText.substring(0, 500)}`);
            return null;
          }
          const data = await res.json();
          console.log(`[PROFILE FETCH] Raw keys:`, Object.keys(data));
          if (data.d !== undefined) console.log(`[PROFILE FETCH] data.d keys:`, Object.keys(data.d || {}));
          if (data.data !== undefined) console.log(`[PROFILE FETCH] data.data keys:`, Object.keys(data.data || {}));
          let isWrappedInD = false;
          let isWrappedInData = false;

          // First try standard unwrapping
          let inner = data;
          if (data && data.d !== undefined) { inner = data.d; isWrappedInD = true; }
          else if (data && data.data !== undefined) { inner = data.data; isWrappedInData = true; }

          // Accept any object as profile - decompress if compressed
          if (inner && typeof inner === "object") {
            const decompInner = decompressProfileIfCompressed(inner);
            const target = decompInner || inner;
            console.log(`[PROFILE FETCH] inner keys:`, Object.keys(target));
            if (target.resources && typeof target.resources === "object" && Object.keys(target.resources).length > 0) {
              return { profile: target, response: res, isWrappedInD, isWrappedInData };
            }
            const deepInner = deepUnwrap(target);
            if (deepInner && deepInner.resources) {
              const decompDeep = decompressProfileIfCompressed(deepInner);
              console.log(`[PROFILE FETCH] Deep unwrap found resources in inner, keys:`, Object.keys(decompDeep || deepInner));
              return { profile: decompDeep || deepInner, response: res, isWrappedInD, isWrappedInData };
            }
            return { profile: target, response: res, isWrappedInD, isWrappedInData };
          }

          // Standard unwrap didn't yield object — try deep unwrap from raw data
          const deep = deepUnwrap(data);
          if (deep) {
            const decompDeep = decompressProfileIfCompressed(deep);
            console.log(`[PROFILE FETCH] Deep unwrap found profile, keys:`, Object.keys(decompDeep || deep));
            return { profile: decompDeep || deep, response: res, isWrappedInD: false, isWrappedInData: false };
          }

          console.log(`[PROFILE FETCH] No valid profile found in response`);
          return null;
        })
        .catch(e => { clearTimeout(timeoutId); console.log(`[PROFILE FETCH] Error: ${e.message}`); return null; });
    };

    // Try the specific ID endpoints first (GET and POST)
    if (userId) {
      const numericId = typeof userId === "string" ? userId.replace(/\D/g, "") : String(userId);
      const urlsToTry = [];
      if (numericId && numericId !== userId) {
        urlsToTry.push(`${GAME_BASE_URL}/profiles/${numericId}`);
      }
      urlsToTry.push(`${GAME_BASE_URL}/profiles/${userId}`);

      for (const url of urlsToTry) {
        const getRes = await tryRequest(url, "GET");
        if (getRes) {
          console.log(`[PROFILE FETCH] Successfully resolved profile from GET ${url}`);
          return getRes;
        }
        
        const postRes = await tryRequest(url, "POST");
        if (postRes) {
          console.log(`[PROFILE FETCH] Successfully resolved profile from POST ${url}`);
          return postRes;
        }
      }
    }

    // Fallback to generic /profiles endpoints
    console.log(`[PROFILE FETCH] Specific profile endpoints failed or not provided. Trying generic fallback...`);
    const getFallback = await tryRequest(`${GAME_BASE_URL}/profiles`, "GET");
    if (getFallback) {
      console.log(`[PROFILE FETCH] Successfully resolved generic profile from GET`);
      return getFallback;
    }

    const postFallback = await tryRequest(`${GAME_BASE_URL}/profiles`, "POST");
    if (postFallback) {
      console.log(`[PROFILE FETCH] Successfully resolved generic profile from POST`);
      return postFallback;
    }

    return { profile: null, response: null, isWrappedInD: true, isWrappedInData: false };
  }

  static async getAuthState(token: string) {
    try {
      const cleanToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
      const response = await fetch(`${BASE_URL}/state`, {
        method: "GET",
        headers: {
          "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
          "Accept": "application/json",
          "Authorization": `Bearer ${cleanToken}`
        }
      });
      if (response.status === 200 || response.status === 201) {
        const data = await response.json();
        return data.d || data;
      }
      if (response.status === 403 || response.status === 401) {
        const data = await response.json().catch(() => null);
        return {
          is_banned: true,
          status: "banned",
          ban_reason: data?.e?.message || data?.message || "Account suspended/blocked on CarX ID Auth Server (403)"
        };
      }
    } catch (e) {
      console.error("[AUTH STATE FETCH ERROR]", e);
    }
    return null;
  }

  static async checkBanStatus(token: string, userId?: string, deviceId?: string, uniqueId?: string): Promise<{ isBanned: boolean; banReason?: string; statusText?: string }> {
    try {
      const cleanToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();

      // 1. Probe CarX ID Auth Server State
      const authState = await CarXClient.getAuthState(cleanToken);
      if (authState) {
        const stateObj = authState.d || authState;
        const bannedVal = stateObj.is_banned ?? stateObj.banned ?? stateObj.ban ?? false;
        const statusVal = String(stateObj.status || "").toLowerCase();
        const isBanned = Boolean(
          bannedVal ||
          statusVal === "banned" ||
          statusVal === "blocked" ||
          statusVal === "suspended" ||
          stateObj.is_blocked ||
          stateObj.blocked
        );
        if (isBanned) {
          const reason = stateObj.ban_reason || stateObj.reason || stateObj.message || "Account is suspended/blocked on CarX ID";
          return {
            isBanned: true,
            banReason: reason,
            statusText: "BANNED (CARX ID)"
          };
        }
      }

      // 2. Probe Game Server Profiles Endpoint
      const headers: Record<string, string> = {
        "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
        "Accept": "application/json",
        "Authorization": `Bearer ${cleanToken}`
      };

      const profileRes = await fetch(`${GAME_BASE_URL}/profiles`, {
        method: "GET",
        headers
      }).catch(() => null);

      if (profileRes) {
        // If HTTP 403 Forbidden: Game anti-cheat has blocked/banned this account!
        if (profileRes.status === 403) {
          const bodyText = await profileRes.text().catch(() => "");
          let errJson: any = null;
          try { errJson = JSON.parse(bodyText); } catch {}
          const msg = errJson?.e?.message || errJson?.message || errJson?.error || (bodyText.length < 120 && bodyText.trim() ? bodyText.trim() : "Account Banned by CarX Anti-Cheat (403 Forbidden)");
          return {
            isBanned: true,
            banReason: msg,
            statusText: "BANNED"
          };
        }

        // If HTTP 401 Unauthorized: Session revoked or account banned
        if (profileRes.status === 401) {
          const bodyText = await profileRes.text().catch(() => "");
          let errJson: any = null;
          try { errJson = JSON.parse(bodyText); } catch {}
          const msg = errJson?.e?.message || errJson?.message || "Token Revoked / Banned by Anti-Cheat (401 Unauthorized)";
          return {
            isBanned: true,
            banReason: msg,
            statusText: "BANNED"
          };
        }

        // If HTTP 200 OK: Decompress profile and inspect all anti-cheat flags deeply
        if (profileRes.status === 200) {
          const json = await profileRes.json().catch(() => null);
          const decompressed = decompressProfileIfCompressed(json);
          const p = decompressed || {};
          const d = json?.d?.data || json?.d || json;

          const isBanned = Boolean(
            p.is_banned === true ||
            p.banned === true ||
            p.ban === true ||
            p.is_blocked === true ||
            p.blocked === true ||
            p.account_status === "banned" ||
            p.status === "banned" ||
            p.profile?.is_banned === true ||
            p.profile?.banned === true ||
            p.profile?.status === "banned" ||
            p.player?.is_banned === true ||
            p.player?.banned === true ||
            p.player?.status === "banned" ||
            p.sanctions ||
            p.penalties ||
            d?.is_banned === true ||
            d?.banned === true ||
            d?.account_status === "banned" ||
            d?.status === "banned"
          );

          if (isBanned) {
            const reason = p.ban_reason || p.reason || p.profile?.ban_reason || d?.ban_reason || "Account flagged with Anti-Cheat Ban";
            return {
              isBanned: true,
              banReason: reason,
              statusText: "BANNED"
            };
          }

          return {
            isBanned: false,
            banReason: "No ban flags detected. Account active on game servers.",
            statusText: "ACTIVE & CLEAN"
          };
        }
      }
    } catch (e: any) {
      console.warn("[CHECK BAN ERROR]", e.message || e);
    }
    return { isBanned: false, statusText: "ACTIVE & CLEAN" };
  }

  static async fetchAndAttachProfileStats(result: any) {
    if (result.success && result.token) {
      try {
        console.log(`[FETCH STATS] Fetching profile & state for userId=${result.userId}`);
        const [profileResult, authState] = await Promise.all([
          CarXClient.getProfile(result.token, result.userId, result.deviceId, result.uniqueId),
          CarXClient.getAuthState(result.token),
        ]);
        const { profile, response } = profileResult;
        let stats: any;
        if (profile) {
          stats = extractProfileStats(profile, false);
        } else {
          // Fresh account that hasn't initialized profile on CarX server yet
          stats = {
            cash: 21000,
            gold: 0,
            level: 1,
            exp: 0,
            name: null,
            avatar: null,
            lastUpdated: null,
            isVerified: false,
            isFallback: true
          };
        }
        if (authState) {
          stats.isVerified = !!authState.verified;
        }

        const stateObj = authState?.d || authState;
        const bannedVal = stateObj?.is_banned ?? stateObj?.banned ?? stateObj?.ban ?? false;
        const statusVal = String(stateObj?.status || "").toLowerCase();
        const profileStatus = response?.status;
        const isBanned = Boolean(
          bannedVal ||
          statusVal === "banned" ||
          statusVal === "blocked" ||
          statusVal === "suspended" ||
          stateObj?.is_blocked ||
          profileStatus === 403 ||
          profileStatus === 401 ||
          profile?.is_banned ||
          profile?.banned ||
          profile?.account_status === "banned" ||
          profile?.status === "banned"
        );

        stats.isBanned = isBanned;
        if (isBanned) {
          stats.banReason = stateObj?.ban_reason || stateObj?.reason || (profileStatus === 403 ? "Account Banned by CarX Anti-Cheat (403 Forbidden)" : "Account suspended on CarX servers");
        }

        result.profileStats = stats;
        result.isBanned = stats.isBanned;
        result.banReason = stats.banReason;
        result.rawProfile = profile || null;
      } catch (e: any) {
        console.error("[PROFILE FETCH ERROR]", e.message || e);
      }
    }
  }

  // Optimized: fire both upload URLs in parallel, return first success (with binary GZIP Base64 compression)
  static async uploadProfile(
    token: string,
    profile: any,
    userId?: string,
    getResponse?: any,
    isWrappedInD = true,
    isWrappedInData = false,
    deviceId?: string,
    uniqueId?: string
  ) {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      "X-Project": "STREET",
      "Authorization": fToken(token),
      "x-token": token.replace(/^Bearer\s+/i, "")
    };

    if (userId) {
      headers["X-CarX-Id"] = String(userId);
    }

    if (deviceId) {
      headers["Device-Id"] = deviceId;
      headers["X-Device-Id"] = deviceId;
    }
    if (uniqueId) {
      headers["Unique-Id"] = uniqueId;
      headers["X-Unique-Id"] = uniqueId;
      headers["Unip-Id"] = uniqueId;
      headers["X-Unip-Id"] = uniqueId;
      headers["UnipId"] = uniqueId;
      headers["X-UnipId"] = uniqueId;
    }

    if (getResponse) {
      let profileVer: string | null = null;
      let xVer: string | null = null;
      if (getResponse.headers) {
        if (typeof getResponse.headers.get === "function") {
          profileVer = getResponse.headers.get("X-Profile-Version") || getResponse.headers.get("x-profile-version");
          xVer = getResponse.headers.get("X-Version") || getResponse.headers.get("x-version");
        } else if (typeof getResponse.headers === "object") {
          profileVer = getResponse.headers["X-Profile-Version"] || getResponse.headers["x-profile-version"];
          xVer = getResponse.headers["X-Version"] || getResponse.headers["x-version"];
        }
      }
      headers["X-Profile-Version"] = profileVer || "1";
      if (xVer) headers["X-Version"] = xVer;
    } else {
      headers["X-Profile-Version"] = "1";
    }

    let payload = profile;
    for (let depth = 0; depth < 5; depth++) {
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        if (payload.resources || payload.cars || payload.clubs || payload.date_time || payload.real_estates) {
          break;
        }
        if (payload.d !== undefined && typeof payload.d === "object" && !Array.isArray(payload.d)) {
          payload = payload.d;
        } else if (payload.data !== undefined && typeof payload.data === "object" && !Array.isArray(payload.data)) {
          payload = payload.data;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (!payload || typeof payload !== "object") {
      return { success: false, response: null, message: "Save validation error: profile payload is empty or invalid." };
    }

    // Always run full clean rewrite on account data before upload to eliminate "REPORT ERROR"
    try {
      payload = cleanRewriteAccountData(payload);
    } catch (e: any) {
      console.warn(`[UPLOAD PROFILE] Clean rewrite warning: ${e?.message}`);
    }

    // Strip any stale compressed_data so the JSON we compress contains fresh values
    if (payload.compressed_data) delete payload.compressed_data;
    if (payload.d?.compressed_data) delete payload.d.compressed_data;
    if (payload.data?.compressed_data) delete payload.data.compressed_data;

    // Binary GZIP Compression matching CarX client 1:1
    let compressedB64 = "";
    try {
      compressedB64 = compressProfileToBinaryBase64(payload);
    } catch (e: any) {
      console.warn(`[UPLOAD PROFILE] GZIP compression failed: ${e?.message}`);
    }

    if (!compressedB64) {
      return { success: false, response: null, message: "Save compression failed. Refusing to upload malformed save." };
    }

    const compressedPayloadObj = { compressed_data: compressedB64 };
    const bodyStr = JSON.stringify(compressedPayloadObj);
    headers["Content-Length"] = String(Buffer.byteLength(bodyStr, "utf-8"));

    const tryUpload = async (url: string): Promise<{ success: boolean; response: any; message?: string } | null> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const respText = await res.text().catch(() => "");
        if (res.status === 200 || res.status === 201 || res.status === 204) {
          return { success: true, response: res };
        }
        return { success: false, response: res, message: respText };
      } catch (e: any) {
        clearTimeout(timeoutId);
        return null;
      }
    };

    const urls: string[] = [`${GAME_BASE_URL}/profiles`];
    if (userId) {
      const cleanUser = typeof userId === "string" ? userId.trim() : String(userId);
      const numericId = cleanUser.replace(/\D/g, "");
      if (numericId && numericId.length >= 6) {
        urls.push(`${GAME_BASE_URL}/profiles/${numericId}`);
      }
    }

    const results = await Promise.all(urls.map(url => tryUpload(url).catch(() => null)));
    const firstSuccess = results.find(r => r && r.success);
    if (firstSuccess) return firstSuccess;
    return results.find(r => r !== null) || { success: false, response: null, message: "Save upload failed." };
  }

  static async botRegisterDevice(deviceId: string) {
    try {
      await fetch(`${BASE_URL}/register_device`, {
        method: "POST",
        headers: {
          "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          deviceId,
          platform: "android",
          project: 4
        })
      });
    } catch {}
  }

  static async botLogin(email: string, pass: string, customDeviceId?: string): Promise<{ success: boolean; token?: string; carxId?: string; message?: string }> {
    const cleanEmail = email.trim();
    const cleanPass = pass.trim();

    const headersForm = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    };

    let lastErrMsg = "Login failed";

    // Strategy 1: User's exact extractor payload (deviceId = email)
    const devicesToTry = [
      cleanEmail,
      (customDeviceId || crypto.randomUUID().replace(/-/g, "")).slice(0, 32),
      cleanEmail.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 32)
    ];

    for (const devId of devicesToTry) {
      try {
        const body = new URLSearchParams({
          deviceId: devId,
          deviceUniqueId: devId,
          username: cleanEmail,
          password: cleanPass,
          project: "STREET"
        }).toString();

        const r = await fetch(`${BASE_URL}/login`, { method: "POST", headers: headersForm, body });
        if (r.status === 200) {
          const json = await r.json().catch(() => ({}));
          const d = json.d || json;
          return { success: true, token: d.token, carxId: d.carxId || d.carx_id };
        }
        const errText = await r.text().catch(() => "");
        try {
          const j = JSON.parse(errText);
          lastErrMsg = (j.e && j.e.message) || j.message || errText;
        } catch {
          lastErrMsg = errText || `HTTP ${r.status}`;
        }
      } catch (e: any) {
        lastErrMsg = e.message || "Failed to connect to CarX login";
      }
    }

    // Strategy 2: STREET login without deviceId (carx_v19.py)
    try {
      const body = new URLSearchParams({
        project: "STREET",
        username: cleanEmail,
        password: cleanPass
      }).toString();

      const r = await fetch(`${BASE_URL}/login`, { method: "POST", headers: headersForm, body });
      if (r.status === 200) {
        const json = await r.json().catch(() => ({}));
        const d = json.d || json;
        return { success: true, token: d.token, carxId: d.carxId || d.carx_id };
      }
    } catch {}

    // Strategy 3: Project 4 form-urlencoded (bot.py)
    try {
      const body = new URLSearchParams({
        project: "4",
        username: cleanEmail,
        password: cleanPass
      }).toString();

      const r = await fetch(`${BASE_URL}/login`, { method: "POST", headers: headersForm, body });
      if (r.status === 200) {
        const json = await r.json().catch(() => ({}));
        const d = json.d || json;
        return { success: true, token: d.token, carxId: d.carxId || d.carx_id };
      }
    } catch {}

    // Strategy 4: Project 4 JSON payload (Android platform)
    try {
      const authRes = await CarXClient.authenticate("login", cleanEmail, cleanPass);
      if (authRes.success && authRes.token) {
        return { success: true, token: authRes.token, carxId: String(authRes.userId || "") };
      }
      if (authRes.message) lastErrMsg = authRes.message;
    } catch {}

    return { success: false, message: lastErrMsg };
  }

  static async deleteAnonymous(email: string, pass: string, deviceId?: string) {
    const cleanEmail = email.trim();
    const cleanPass = pass.trim();
    const devId = (deviceId || crypto.randomBytes(8).toString("hex")).slice(0, 16);
    await CarXClient.botRegisterDevice(devId);

    const headersForm = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Content-Type": "application/x-www-form-urlencoded"
    };
    const headersJson = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Content-Type": "application/json"
    };

    // Strategy 1: URL encoded with project 4 (bot.py default)
    try {
      const body1 = new URLSearchParams({ username: cleanEmail, password: cleanPass, project: "4" }).toString();
      const r1 = await fetch(`${BASE_URL}/delete/anonymous`, { method: "POST", headers: headersForm, body: body1 });
      if (r1.status === 200 || r1.status === 201 || r1.status === 204) {
        return { success: true, method: "anonymous-p4", message: "Account deleted successfully via CarX Anonymous API." };
      }
    } catch {}

    // Strategy 2: URL encoded with project STREET
    try {
      const body2 = new URLSearchParams({ username: cleanEmail, password: cleanPass, project: "STREET" }).toString();
      const r2 = await fetch(`${BASE_URL}/delete/anonymous`, { method: "POST", headers: headersForm, body: body2 });
      if (r2.status === 200 || r2.status === 201 || r2.status === 204) {
        return { success: true, method: "anonymous-street", message: "Account deleted successfully via CarX Anonymous API." };
      }
    } catch {}

    // Strategy 3: JSON payload with integer project 4
    try {
      const r3 = await fetch(`${BASE_URL}/delete/anonymous`, {
        method: "POST",
        headers: headersJson,
        body: JSON.stringify({ username: cleanEmail, password: cleanPass, project: 4 })
      });
      if (r3.status === 200 || r3.status === 201 || r3.status === 204) {
        return { success: true, method: "anonymous-json-p4", message: "Account deleted successfully via CarX Anonymous API." };
      }
      const errText = await r3.text().catch(() => "");
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        errMsg = (j.e && j.e.message) || j.message || errText;
      } catch {}
      return { success: false, message: errMsg || `HTTP ${r3.status}` };
    } catch (e: any) {
      return { success: false, message: e.message || "Failed to connect for anonymous deletion" };
    }
  }

  static async getGuestToken(customDeviceId?: string): Promise<string | null> {
    const devId = (customDeviceId || crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
    try {
      const form = new URLSearchParams({
        project: "STREET",
        deviceId: devId,
        deviceUniqueId: devId
      });
      const res = await fetch(`${BASE_URL}/register`, {
        method: "POST",
        headers: {
          "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      });
      if (res.status === 200 || res.status === 201) {
        const j = await res.json().catch(() => null);
        return (j?.d || j)?.token || null;
      }
    } catch (e: any) {
      console.warn(`[GUEST TOKEN] Error: ${e.message}`);
    }
    return null;
  }

  static async deleteWithToken(token: string, email: string, pass?: string) {
    const cleanEmail = email.trim();
    const cleanPass = pass ? pass.trim() : undefined;
    const cleanToken = token.trim();
    const headersForm = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Authorization": fToken(cleanToken),
      "x-token": cleanToken.replace(/^Bearer\s+/i, ""),
      "X-Project": "STREET",
      "Content-Type": "application/x-www-form-urlencoded"
    };
    const headersJson = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Authorization": fToken(cleanToken),
      "x-token": cleanToken.replace(/^Bearer\s+/i, ""),
      "X-Project": "STREET",
      "Content-Type": "application/json"
    };

    // Strategy 1: URL encoded username + password
    try {
      const params1: Record<string, string> = { username: cleanEmail, project: "STREET" };
      if (cleanPass) params1.password = cleanPass;
      const r1 = await fetch(`${BASE_URL}/delete`, { method: "POST", headers: headersForm, body: new URLSearchParams(params1).toString() });
      if (r1.status === 200 || r1.status === 201 || r1.status === 204) {
        return { success: true, method: "token-form", message: "Account deleted successfully via CarX Token API." };
      }
      if (r1.status === 404) {
        return { success: true, method: "token-form", message: "Account already deleted." };
      }
    } catch {}

    // Strategy 2: JSON body
    try {
      const bodyObj: Record<string, any> = { username: cleanEmail, project: "STREET" };
      if (cleanPass) bodyObj.password = cleanPass;
      const r2 = await fetch(`${BASE_URL}/delete`, { method: "POST", headers: headersJson, body: JSON.stringify(bodyObj) });
      if (r2.status === 200 || r2.status === 201 || r2.status === 204) {
        return { success: true, method: "token-json", message: "Account deleted successfully via CarX Token API." };
      }
      if (r2.status === 404) {
        return { success: true, method: "token-json", message: "Account already deleted." };
      }
      const errText = await r2.text().catch(() => "");
      let errMsg = errText;
      try {
        const j = JSON.parse(errText);
        errMsg = (j.e && j.e.message) || j.message || errText;
      } catch {}
      return { success: false, message: errMsg || `HTTP ${r2.status}` };
    } catch (e: any) {
      return { success: false, message: e.message || "Failed to connect for token deletion" };
    }
  }

  static async deleteAccount(token: string, email: string, pass: string) {
    return CarXClient.deleteWithToken(token, email, pass);
  }

  static async deleteAccountAuto(email: string, pass?: string, token?: string, deviceId?: string) {
    const cleanEmail = (email || "").trim();
    const cleanPass = pass ? pass.trim() : undefined;
    console.log(`[DELETE] Starting auto delete sequence for ${cleanEmail || "(token only)"}...`);

    // 1. If active token is available, attempt token delete first
    if (token) {
      console.log(`[DELETE] Trying active token delete...`);
      const tokenRes = await CarXClient.deleteWithToken(token, cleanEmail, cleanPass);
      if (tokenRes.success) {
        return tokenRes;
      }
      console.log(`[DELETE] Active token delete note:`, tokenRes.message);
    }

    // 2. High-reliability Guest Token Delete
    if (cleanPass && cleanEmail) {
      console.log(`[DELETE] Requesting fresh guest token for authenticated purge...`);
      const guestToken = await CarXClient.getGuestToken(deviceId);
      if (guestToken) {
        console.log(`[DELETE] Guest session obtained. Executing delete with guest authorization...`);
        const delWithGuest = await CarXClient.deleteWithToken(guestToken, cleanEmail, cleanPass);
        if (delWithGuest.success) {
          return { success: true, method: "guest-token", message: "Account purged successfully via authorized guest session." };
        }
        if (/not found/i.test(delWithGuest.message || "")) {
          return { success: true, method: "guest-token", message: "Account already purged or does not exist." };
        }
        console.log(`[DELETE] Guest session delete note:`, delWithGuest.message);
      }

      // 3. Log in with credentials to obtain fresh account token
      console.log(`[DELETE] Attempting direct credential login for account token...`);
      const bLog = await CarXClient.botLogin(cleanEmail, cleanPass, deviceId);
      if (bLog.success && bLog.token) {
        console.log(`[DELETE] Fresh token obtained, executing deletion...`);
        const tokenRes = await CarXClient.deleteWithToken(bLog.token, cleanEmail, cleanPass);
        if (tokenRes.success) {
          return tokenRes;
        }
      }

      // 4. Fallback anonymous attempt
      const anonRes = await CarXClient.deleteAnonymous(cleanEmail, cleanPass, deviceId);
      if (anonRes.success) {
        return anonRes;
      }

      return {
        success: false,
        message: anonRes.message || "Failed to delete account. Please check your password."
      };
    }

    return {
      success: false,
      message: "Password is required to delete this account."
    };
  }

  // 🔄 REBUILD BANNED ACCOUNT: Extract JSON -> Purge Account -> Re-register -> Re-inject JSON
  static async rebuildBannedAccount(params: {
    email: string;
    password: string;
    token?: string;
    deviceId?: string;
    uniqueId?: string;
  }): Promise<{
    success: boolean;
    message: string;
    token?: string;
    carxId?: string;
    stepsCompleted: string[];
    backupFile?: string;
  }> {
    const email = (params.email || "").trim();
    const password = (params.password || "").trim();
    const deviceId = (params.deviceId || crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
    const uniqueId = (params.uniqueId || deviceId).slice(0, 32);
    const stepsCompleted: string[] = [];

    console.log(`[REBUILD] Starting banned account rebuild workflow for ${email}...`);

    // STEP 1: AUTHENTICATE & EXTRACT PROFILE JSON
    let activeToken = params.token;
    let activeCarxId = "";

    // Always attempt fresh login to capture exact activeCarxId and token
    console.log(`[REBUILD] Step 1: Logging in to account ${email}...`);
    const auth = await CarXClient.botLogin(email, password, deviceId);
    if (auth.success && auth.token) {
      activeToken = auth.token;
      activeCarxId = auth.carxId || "";
      console.log(`[REBUILD] Authenticated successfully. CarX ID: ${activeCarxId}`);
    } else {
      console.log(`[REBUILD] Direct login note: ${auth.message || "Using provided session token"}`);
    }

    if (!activeToken) {
      return {
        success: false,
        message: "Failed to authenticate with CarX servers. Please verify your email and password.",
        stepsCompleted
      };
    }

    let preservedProfile: any = null;
    let rawEnvelope: any = null;

    console.log(`[REBUILD] Step 1: Downloading profile save data from ${GAME_BASE_URL}/profiles...`);
    const cleanHeaders = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Accept": "application/json",
      "Authorization": fToken(activeToken)
    };

    const extendedHeaders: Record<string, string> = {
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Accept": "application/json",
      "X-Project": "STREET",
      "Authorization": fToken(activeToken),
      "x-token": activeToken.replace(/^Bearer\s+/i, ""),
      "Origin": "https://carx-online.com"
    };

    const headersList = [cleanHeaders, extendedHeaders];
    const urlsToTry = [`${GAME_BASE_URL}/profiles`];
    if (activeCarxId) {
      const numericId = activeCarxId.replace(/\D/g, "");
      if (numericId && numericId.length >= 6) {
        urlsToTry.push(`${GAME_BASE_URL}/profiles/${numericId}`);
      }
    }

    // Attempt 1: Direct Node.js fetch with GET & POST using minimal extractor headers
    for (const h of headersList) {
      if (preservedProfile) break;
      for (const url of urlsToTry) {
        try {
          // Try GET
          const getRes = await fetch(url, { method: "GET", headers: h });
          if (getRes.status === 200 || getRes.status === 201) {
            const json = await getRes.json().catch(() => null);
            if (json) {
              rawEnvelope = json;
              const decompressed = decompressProfileIfCompressed(json);
              if (decompressed && typeof decompressed === "object" && (decompressed.resources || decompressed.cars || Object.keys(decompressed).length > 2)) {
                preservedProfile = decompressed;
                console.log(`[REBUILD] Successfully extracted and decompressed profile from GET ${url}`);
                break;
              }
            }
          }
        } catch (e: any) {
          console.warn(`[REBUILD] GET attempt error at ${url}:`, e.message);
        }

        if (!preservedProfile) {
          try {
            // Try POST with empty body (some CarX proxy clusters require POST)
            const postRes = await fetch(url, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({}) });
            if (postRes.status === 200 || postRes.status === 201) {
              const json = await postRes.json().catch(() => null);
              if (json) {
                rawEnvelope = json;
                const decompressed = decompressProfileIfCompressed(json);
                if (decompressed && typeof decompressed === "object" && (decompressed.resources || decompressed.cars || Object.keys(decompressed).length > 2)) {
                  preservedProfile = decompressed;
                  console.log(`[REBUILD] Successfully extracted profile from POST ${url}`);
                  break;
                }
              }
            }
          } catch {}
        }
      }
    }

    // Attempt 2: Via CarXClient.getProfile
    if (!preservedProfile) {
      try {
        const pRes = await CarXClient.getProfile(activeToken, activeCarxId, deviceId, uniqueId);
        if (pRes && pRes.profile) {
          preservedProfile = pRes.profile;
          rawEnvelope = pRes.response;
        }
      } catch (e: any) {
        console.warn(`[REBUILD] Secondary profile fetch error:`, e.message);
      }
    }

    // Attempt 3: Execute python account_extractor.py directly (Unity libcurl engine)
    if (!preservedProfile) {
      try {
        console.log(`[REBUILD] Invoking Python account_extractor.py fallback...`);
        const tempJsonOut = path.join(os.tmpdir(), `rebuild_ext_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
        await new Promise<void>((resolve) => {
          execFile("python", [
            path.join(process.cwd(), "account_extractor.py"),
            "--extract",
            "--email", email,
            "--password", password,
            "--out", tempJsonOut
          ], { timeout: 25000 }, (err, stdout, stderr) => {
            if (err) console.warn("[REBUILD] Python extractor note:", err.message);
            resolve();
          });
        });
        if (fs.existsSync(tempJsonOut)) {
          const raw = fs.readFileSync(tempJsonOut, "utf-8");
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && (parsed.resources || parsed.cars || Object.keys(parsed).length > 2)) {
              preservedProfile = parsed;
              console.log("[REBUILD] Successfully extracted profile via Python account_extractor.py!");
            }
          } catch {}
          try { fs.unlinkSync(tempJsonOut); } catch {}
        }
      } catch (e: any) {
        console.warn(`[REBUILD] Python extractor subprocess error:`, e.message);
      }
    }

    // Attempt 4: Check pre-existing local backups for this account
    if (!preservedProfile) {
      try {
        const safeName = email.replace(/[^a-zA-Z0-9]/g, "_");
        const foldersToSearch = [
          path.join(process.cwd(), "backups"),
          path.join(process.cwd(), "carx_extracted", "full_account")
        ];
        for (const fDir of foldersToSearch) {
          if (preservedProfile) break;
          if (fs.existsSync(fDir)) {
            const matches = fs.readdirSync(fDir)
              .filter(f => f.includes(safeName) && f.endsWith(".json"))
              .sort().reverse();
            if (matches.length > 0) {
              const fullP = path.join(fDir, matches[0]);
              const raw = fs.readFileSync(fullP, "utf-8");
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object" && (parsed.resources || parsed.cars || Object.keys(parsed).length > 2)) {
                preservedProfile = parsed;
                console.log(`[REBUILD] Restored profile from previous backup file: ${matches[0]}`);
                stepsCompleted.push(`Recovered previous account JSON from local backup (${matches[0]})`);
                break;
              }
            }
          }
        }
      } catch (e: any) {
        console.warn("[REBUILD] Local backup search note:", e.message);
      }
    }

    // CRITICAL SAFETY CHECK: NEVER purge account if profile extraction failed!
    if (!preservedProfile || typeof preservedProfile !== "object" || (!preservedProfile.resources && !preservedProfile.cars && Object.keys(preservedProfile).length < 2)) {
      return {
        success: false,
        message: "Profile extraction failed: Could not retrieve save data from this banned account. Rebuild aborted safely to protect your account.",
        stepsCompleted
      };
    }

    // Save local backup file on server
    const backupsDir = path.join(process.cwd(), "backups");
    if (!fs.existsSync(backupsDir)) {
      try { fs.mkdirSync(backupsDir, { recursive: true }); } catch {}
    }
    const safeName = email.replace(/[^a-zA-Z0-9]/g, "_");
    const backupFileName = `rebuild_backup_${safeName}_${Date.now()}.json`;
    const backupFilePath = path.join(backupsDir, backupFileName);
    try {
      fs.writeFileSync(backupFilePath, JSON.stringify(preservedProfile, null, 2), "utf-8");
      console.log(`[REBUILD] Preserved profile backup safely written to: ${backupFilePath}`);
    } catch (e: any) {
      console.warn(`[REBUILD] Failed writing local backup:`, e.message);
    }
    stepsCompleted.push(`Extracted account JSON & saved local backup (${backupFileName})`);

    // STEP 2: DELETE BANNED ACCOUNT
    console.log(`[REBUILD] Step 2: Purging banned account ${email}...`);
    const delRes = await CarXClient.deleteAccountAuto(email, password, activeToken, deviceId);
    if (!delRes.success) {
      console.warn(`[REBUILD] Purge note: ${delRes.message}`);
      return {
        success: false,
        message: `Account deletion failed: ${delRes.message || "CarX rejected delete request"}. Rebuild halted safely. Your JSON backup is saved at ${backupFileName}.`,
        stepsCompleted,
        backupFile: backupFileName
      };
    }
    stepsCompleted.push("Purged banned account from CarX cluster");

    // Propagation delay: wait 3000ms
    console.log(`[REBUILD] Waiting 3000ms for database propagation...`);
    await new Promise(r => setTimeout(r, 3000));

    // STEP 3: RE-REGISTER IDENTICAL ACCOUNT
    console.log(`[REBUILD] Step 3: Re-registering fresh account for ${email}...`);
    let regRes = await CarXClient.register(email, password, deviceId, uniqueId);
    if (!regRes.success && /exists|already/i.test(regRes.message || "")) {
      console.log(`[REBUILD] Account still propagating, waiting 2500ms before retry...`);
      await new Promise(r => setTimeout(r, 2500));
      regRes = await CarXClient.register(email, password, deviceId, uniqueId);
    }

    let newToken = regRes.token;
    let newUserId = regRes.userId;

    if (!newToken) {
      const newAuth = await CarXClient.botLogin(email, password, deviceId);
      if (newAuth.success && newAuth.token) {
        newToken = newAuth.token;
        newUserId = newAuth.carxId;
      }
    }

    if (!newToken) {
      return {
        success: false,
        message: `Account was purged and backup saved (${backupFileName}), but re-registration failed: ${regRes.message || "Failed to create new account."}`,
        stepsCompleted,
        backupFile: backupFileName
      };
    }
    stepsCompleted.push(`Re-registered fresh account (${newUserId || email})`);

    // Propagation delay before upload
    await new Promise(r => setTimeout(r, 1500));

    // STEP 4: INJECT PRESERVED JSON
    console.log(`[REBUILD] Step 4: Injecting preserved JSON profile into newly registered account...`);
    if (newUserId && typeof preservedProfile === "object") {
      updateProfileAccountIds(preservedProfile, newUserId);
    }

    // Encrypt preserved profile using modern l84l format
    const encryptedL84L = encryptProfileL84L(preservedProfile);

    // Fetch fresh envelope for newly registered account
    const newAuthHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "X-Project": "STREET",
      "Authorization": fToken(newToken),
      "x-token": newToken.replace(/^Bearer\s+/i, ""),
      "X-Device-Id": deviceId,
      "X-CarX-Id": newUserId || ""
    };

    let newEnvelope: any = null;
    try {
      const getNewRes = await fetch(`${GAME_BASE_URL}/profiles`, {
        method: "GET",
        headers: newAuthHeaders
      });
      if (getNewRes.status === 200 || getNewRes.status === 201) {
        newEnvelope = await getNewRes.json().catch(() => null);
      }
    } catch {}

    // Prepare upload envelope with compressed_data updated
    let uploadPayload: any = { compressed_data: encryptedL84L };
    if (newEnvelope && typeof newEnvelope === "object") {
      const foundContainer = findCompressedDataInEnvelope(newEnvelope);
      if (foundContainer) {
        foundContainer.container.compressed_data = encryptedL84L;
        uploadPayload = newEnvelope;
      } else {
        if (newEnvelope.d && typeof newEnvelope.d === "object") {
          newEnvelope.d.compressed_data = encryptedL84L;
          uploadPayload = newEnvelope;
        }
      }
    }

    let uploadOk = false;
    try {
      const postSyncRes = await fetch(`${GAME_BASE_URL}/profiles`, {
        method: "POST",
        headers: newAuthHeaders,
        body: JSON.stringify(uploadPayload)
      });
      if (postSyncRes.status === 200 || postSyncRes.status === 201 || postSyncRes.status === 204) {
        uploadOk = true;
      }
    } catch (e: any) {
      console.warn(`[REBUILD] POST /profiles error:`, e.message);
    }

    // Dual upload via uploadProfile
    const uploadRes = await CarXClient.uploadProfile(
      newToken,
      preservedProfile,
      newUserId,
      undefined,
      true,
      false,
      deviceId,
      uniqueId
    );
    if (uploadRes && uploadRes.success) {
      uploadOk = true;
    }

    // Verify sync persistence
    try {
      const verifyRes = await fetch(`${GAME_BASE_URL}/profiles`, {
        method: "GET",
        headers: newAuthHeaders
      });
      if (verifyRes.status === 200) {
        const verifyJson = await verifyRes.json().catch(() => null);
        const decomp = decompressProfileIfCompressed(verifyJson);
        if (decomp && (decomp.resources || decomp.cars)) {
          uploadOk = true;
          console.log(`[REBUILD] Verified sync: profile loaded with resources:`, decomp.resources);
        }
      }
    } catch {}

    stepsCompleted.push(uploadOk ? "Preserved JSON profile injected & verified on game servers" : "Profile save data uploaded. Ready to launch game.");

    return {
      success: true,
      message: "Account rebuilt successfully! Saved profile injected and synced to fresh account.",
      token: newToken,
      carxId: newUserId,
      stepsCompleted,
      backupFile: backupFileName
    };
  }

  static async unlockStreetPassAuto(token: string, deviceId?: string, uniqueId?: string): Promise<boolean> {
    const bpObj = JSON.parse(STREETPASS_BODY);
    const epObj = JSON.parse(STREETPASS_BODY.replace(/com\.carxtech\.sr\.bank\.event\.bp/g, "com.carxtech.sr.bank.event.ep_big"));
    
    let bpOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      bpOk = await CarXClient.verifyStreetPass(token, bpObj, deviceId, uniqueId);
      if (bpOk) break;
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (bpOk) {
      // Loop EP 3 times exactly like bot.py
      for (let i = 0; i < 3; i++) {
        await CarXClient.verifyStreetPass(token, epObj, deviceId, uniqueId).catch(() => false);
      }
      return true;
    }
    return false;
  }

  static async verifyStreetPass(token: string, bodyObj: any, deviceId?: string, uniqueId?: string) {
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        const headers: Record<string, string> = {
          "Host": "street-prod.carx-online.com",
          "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
          "Accept": "*/*",
          "Accept-Encoding": "deflate, gzip",
          "Content-Type": "application/json",
          "Authorization": fToken(token),
          "X-Unity-Version": "6000.0.64f1"
        };
        if (deviceId) { headers["Device-Id"] = deviceId; headers["X-Device-Id"] = deviceId; }
        if (uniqueId) {
          headers["Unique-Id"] = uniqueId;
          headers["X-Unique-Id"] = uniqueId;
          headers["Unip-Id"] = uniqueId;
          headers["X-Unip-Id"] = uniqueId;
          headers["UnipId"] = uniqueId;
          headers["X-UnipId"] = uniqueId;
        }
        const response = await fetch(`${GAME_BASE_URL}/purchases/verify`, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyObj),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const bodyText = await response.text().catch(() => "");
        if (response.status === 200 || response.status === 201) {
          return true;
        }
        if ([500, 502, 503, 504, 429].includes(response.status) && attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        console.warn(`[STREETPASS VERIFY ERROR] status=${response.status} body=${bodyText}`);
        return false;
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 200));
          continue;
        }
        console.warn(`[STREETPASS VERIFY ERROR] error=${e.message || e}`);
        return false;
      }
    }
    return false;
  }

  static async unlockPremium(token: string, deviceId?: string, uniqueId?: string) {
    const skrg = new Date();
    const end_iso = new Date(skrg.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const headers: Record<string, string> = {
      "Host": "street-prod.carx-online.com",
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Accept": "*/*",
      "Accept-Encoding": "deflate, gzip",
      "Content-Type": "application/json",
      "Authorization": fToken(token),
      "X-Unity-Version": "6000.0.64f1"
    };

    if (deviceId) { headers["Device-Id"] = deviceId; headers["X-Device-Id"] = deviceId; }
    if (uniqueId) {
      headers["Unique-Id"] = uniqueId;
      headers["X-Unique-Id"] = uniqueId;
      headers["Unip-Id"] = uniqueId;
      headers["X-Unip-Id"] = uniqueId;
      headers["UnipId"] = uniqueId;
      headers["X-UnipId"] = uniqueId;
    }

    const store_headers: Record<string, string> = {
      "Host": "carx-store.com",
      "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
      "Accept": "*/*",
      "Content-Type": "application/json",
      "Authorization": fToken(token),
      "X-Unity-Version": "6000.0.64f1"
    };

    const premiumPurchaseId = process.env.PREMIUM_PURCHASE_ID || "GPA.3300-9384-4790-70667";
    const premiumPurchaseToken = process.env.PREMIUM_PURCHASE_TOKEN || "eeoldhlponplckhkmghkbnbh.AO-J1Oz0GmoQuAe5OWrshC5AsawwFRMyVvQdwzz2ovPDkPj29SuvBnAPbKkGvchP0b-3pDrr3BnluedswSEHqcG_GHS4fiCC7w";
    const premiumSignature = process.env.PREMIUM_SIGNATURE || "pktPXa9uIJ4CnoLsDDEdRmsqzADuxwwp9eMHSMnoTlcT+M9JdDWb3v4EwEpnOOKaK+WULjY8ZvNza+mFvvV2MnEFZu0YtTWdroBr1S9T//bsLhO9UIV8C+CEtQeruoGnTGgHfONNeUuJkfgVFUZqc8stlibEWCRhn2gaCco6PoEcfk9WTbjSKEu7XKmj8+2sGiMK+no2uK7WunfMIhos1p53BT38ryo30BkSZKi/9xCenP5AUHPIzkf6ZbhGbIrbSFqbbhn5rHs1w6FuIRGtz2Ivr+j8zmJ3Gz0BlsuSsLYoCvs3qFxIsSD+HNkhs1mh0UIlYi4gL9htww1rKSk3pg==";
    const premiumPurchaseTime = process.env.PREMIUM_PURCHASE_TIME ? parseInt(process.env.PREMIUM_PURCHASE_TIME, 10) : 1780240284277;

    const verify_payload = {
      "gameVersion": "1.20.0",
      "purchaseId": premiumPurchaseId,
      "productId": "com.carxtech.sr.bank.prem.30day",
      "transactionData": premiumPurchaseToken,
      "transactionId": premiumPurchaseToken,
      "subscription": true,
      "metaInfo": JSON.stringify({
        "json": JSON.stringify({
          "orderId": premiumPurchaseId,
          "packageName": "com.carxtech.sr",
          "productId": "com.carxtech.sr.bank.prem.30day",
          "purchaseTime": premiumPurchaseTime,
          "purchaseState": 0,
          "purchaseToken": premiumPurchaseToken,
          "quantity": 1,
          "autoRenewing": true,
          "acknowledged": false
        }),
        "signature": premiumSignature,
        "skuDetails": [JSON.stringify({
          "productId": "com.carxtech.sr.bank.prem.30day",
          "type": "subs",
          "title": "Premium 30 days (CarX Street)",
          "name": "Premium 30 days",
          "description": "",
          "price": "$5.99",
          "price_amount_micros": 5990000,
          "price_currency_code": "USD",
          "subscriptionPeriod": "P1M"
        })]
      }),
      "marketType": "GOOGLE",
      "productType": 2
    };

    const receive_payload = {
      "purchaseId": premiumPurchaseId,
      "productId": "com.carxtech.sr.bank.prem.30day",
      "transactionId": premiumPurchaseToken,
      "marketType": "GOOGLE",
      "productType": 2
    };

    try {
      // Step 1: Trigger Verify
      console.log("[PREMIUM] Step 1: purchases/verify");
      const resVerify = await fetch(`${GAME_BASE_URL}/purchases/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(verify_payload)
      });
      const verifyText = await resVerify.text().catch(() => "");
      console.log(`[PREMIUM] Verify status: ${resVerify.status}, body: ${verifyText}`);

      // Step 2: Receive purchase
      console.log("[PREMIUM] Step 2: purchases/receive");
      const resReceive = await fetch(`${GAME_BASE_URL}/purchases/receive`, {
        method: "POST",
        headers,
        body: JSON.stringify(receive_payload)
      });
      const receiveText = await resReceive.text().catch(() => "");
      console.log(`[PREMIUM] Receive status: ${resReceive.status}, body: ${receiveText}`);

      // Step 3: Probe store catalog
      console.log("[PREMIUM] Step 3: carx-store.com items");
      const resStore = await fetch("https://carx-store.com/api/v1/mobile/str/items", {
        method: "GET",
        headers: store_headers
      });
      const storeText = await resStore.text().catch(() => "");
      console.log(`[PREMIUM] Store status: ${resStore.status}, body: ${storeText.substring(0, 200)}`);

      // Step 4: Get remote rewards
      console.log("[PREMIUM] Step 4: remote/rewards");
      const resRewards = await fetch(`${GAME_BASE_URL}/remote/rewards`, {
        method: "GET",
        headers
      });
      const rewardsText = await resRewards.text().catch(() => "{}");
      console.log(`[PREMIUM] Rewards status: ${resRewards.status}`);

      let claimedCount = 0;
      try {
        const rewardsData = JSON.parse(rewardsText);
        const rewards = rewardsData?.d?.rewards || [];
        if (Array.isArray(rewards) && rewards.length > 0) {
          console.log(`[PREMIUM] Found ${rewards.length} rewards. Claiming...`);
          // Step 5: Claim each reward
          for (const rw of rewards) {
            const rewardId = rw.id || rw.rewardId;
            if (rewardId) {
              const resClaim = await fetch(`${GAME_BASE_URL}/remote/rewards/receive_reward`, {
                method: "POST",
                headers,
                body: JSON.stringify({ rewardId })
              });
              await resClaim.text().catch(() => "");
              if (resClaim.status === 200 || resClaim.status === 201) {
                claimedCount++;
              }
            }
          }
        }
      } catch (e: any) {
        console.warn(`[PREMIUM] Error processing rewards: ${e.message}`);
      }

      if (resVerify.status === 200 || resVerify.status === 201 || resReceive.status === 200 || resReceive.status === 201) {
        return { success: true, expired: end_iso };
      }
      
      return { 
        success: false, 
        message: `Premium Activation Failed. Verify: ${resVerify.status}, Receive: ${resReceive.status}.` 
      };
    } catch (e: any) {
      console.warn(`[PREMIUM UNLOCK ERROR] error=${e.message || e}`);
      return { success: false, message: e.message || "Failed to connect for premium activation" };
    }
  }
}

function fToken(token: string) {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

export function ensureCarToRealEstateSlot(profile: any): void {
  profile.car_to_real_estate_slot = profile.car_to_real_estate_slot || {};
  profile.car_to_real_estate_slot.keys = Array.isArray(profile.car_to_real_estate_slot.keys)
    ? profile.car_to_real_estate_slot.keys
    : [];
  profile.car_to_real_estate_slot.values = Array.isArray(profile.car_to_real_estate_slot.values)
    ? profile.car_to_real_estate_slot.values
    : [];
}

export function getPrioritizedSlots(profile: any): string[] {
  const ownedHouses = new Set<string>();
  if (profile && profile.real_estates) {
    for (const h in profile.real_estates) {
      if (profile.real_estates[h]?.is_bought) ownedHouses.add(h);
    }
  }
  return [...AUTHENTIC_REAL_ESTATE_SLOTS].sort((a, b) => {
    const aHouse = a.substring(0, a.lastIndexOf("_slot_"));
    const bHouse = b.substring(0, b.lastIndexOf("_slot_"));
    const aIsApt95 = aHouse === "apartment_95" ? 0 : 1;
    const bIsApt95 = bHouse === "apartment_95" ? 0 : 1;
    if (aIsApt95 !== bIsApt95) return aIsApt95 - bIsApt95;
    const aOwned = ownedHouses.has(aHouse) ? 0 : 1;
    const bOwned = ownedHouses.has(bHouse) ? 0 : 1;
    if (aOwned !== bOwned) return aOwned - bOwned;
    return AUTHENTIC_REAL_ESTATE_SLOTS.indexOf(a) - AUTHENTIC_REAL_ESTATE_SLOTS.indexOf(b);
  });
}

export function sanitizeCarToRealEstateSlot(profile: any): void {
  ensureCarToRealEstateSlot(profile);
  profile.real_estates = profile.real_estates || {};
  profile.real_estate_slots = profile.real_estate_slots || {};
  profile.locations = profile.locations || {};
  profile.locations.default = profile.locations.default || {};
  profile.locations.default.location_objects_set = profile.locations.default.location_objects_set || { keys: [] };
  if (!Array.isArray(profile.locations.default.location_objects_set.keys)) {
    profile.locations.default.location_objects_set.keys = [];
  }

  const authenticSlotsSet = new Set(AUTHENTIC_REAL_ESTATE_SLOTS);
  const locationKeysSet = new Set(profile.locations.default.location_objects_set.keys);

  for (const slotKey of Object.keys(profile.real_estate_slots)) {
    if (!authenticSlotsSet.has(slotKey)) {
      delete profile.real_estate_slots[slotKey];
    }
  }

  const rawKeys = profile.car_to_real_estate_slot.keys || [];
  const rawValues = profile.car_to_real_estate_slot.values || [];
  const ownedCarIds = new Set(Object.keys(profile.cars?.items || {}));

  const validKeys: string[] = [];
  const validValues: string[] = [];
  const usedSlots = new Set<string>();
  const carsWithSlots = new Set<string>();

  for (let i = 0; i < rawKeys.length; i++) {
    const cidStr = String(rawKeys[i]);
    const slot = rawValues[i];

    if (
      slot &&
      typeof slot === "string" &&
      authenticSlotsSet.has(slot) &&
      ownedCarIds.has(cidStr) &&
      !usedSlots.has(slot) &&
      !carsWithSlots.has(cidStr)
    ) {
      usedSlots.add(slot);
      carsWithSlots.add(cidStr);
      validKeys.push(cidStr);
      validValues.push(slot);

      const houseName = slot.substring(0, slot.lastIndexOf("_slot_"));
      profile.real_estates[houseName] = profile.real_estates[houseName] || { is_bought: true };
      profile.real_estates[houseName].is_bought = true;
      profile.real_estate_slots[slot] = profile.real_estate_slots[slot] || {};
      profile.real_estate_slots[slot].unlocked = true;
      profile.real_estate_slots[slot].car_id = cidStr;

      if (!locationKeysSet.has(houseName)) {
        profile.locations.default.location_objects_set.keys.push(houseName);
        locationKeysSet.add(houseName);
      }
    }
  }

  // Raw cars are NOT automatically assigned to empty real estate slots or garages.
  // Only existing explicitly assigned cars remain in slots.
  profile.car_to_real_estate_slot.keys = validKeys;
  profile.car_to_real_estate_slot.values = validValues;

  for (const slotName in profile.real_estate_slots) {
    const slotData = profile.real_estate_slots[slotName];
    if (slotData && slotData.car_id !== undefined && slotData.car_id !== null) {
      const cidStr = String(slotData.car_id);
      const mappedIdx = validKeys.indexOf(cidStr);
      if (!ownedCarIds.has(cidStr) || mappedIdx === -1 || validValues[mappedIdx] !== slotName) {
        delete slotData.car_id;
      }
    }
  }

  for (const houseName in profile.real_estates) {
    if (profile.real_estates[houseName]?.is_bought) {
      for (const slot of AUTHENTIC_REAL_ESTATE_SLOTS) {
        if (slot.startsWith(`${houseName}_slot_`)) {
          profile.real_estate_slots[slot] = profile.real_estate_slots[slot] || {};
          profile.real_estate_slots[slot].unlocked = true;
        }
      }
    }
  }
}

export function assignCarToFreeSlot(profile: any, carId: string): string {
  const carStr = String(carId);
  ensureCarToRealEstateSlot(profile);
  profile.real_estates = profile.real_estates || {};
  profile.real_estate_slots = profile.real_estate_slots || {};
  profile.locations = profile.locations || {};
  profile.locations.default = profile.locations.default || {};
  profile.locations.default.location_objects_set = profile.locations.default.location_objects_set || { keys: [] };
  if (!Array.isArray(profile.locations.default.location_objects_set.keys)) {
    profile.locations.default.location_objects_set.keys = [];
  }

  const authenticSlotsSet = new Set(AUTHENTIC_REAL_ESTATE_SLOTS);
  const locationKeysSet = new Set(profile.locations.default.location_objects_set.keys);

  const existingIdx = profile.car_to_real_estate_slot.keys.findIndex((k: any) => String(k) === carStr);
  if (existingIdx !== -1) {
    const slot = profile.car_to_real_estate_slot.values[existingIdx];
    if (slot && authenticSlotsSet.has(slot)) {
      const houseName = slot.substring(0, slot.lastIndexOf("_slot_"));
      profile.real_estates[houseName] = profile.real_estates[houseName] || { is_bought: true };
      profile.real_estates[houseName].is_bought = true;
      profile.real_estate_slots[slot] = profile.real_estate_slots[slot] || {};
      profile.real_estate_slots[slot].unlocked = true;
      profile.real_estate_slots[slot].car_id = carStr;
      if (!locationKeysSet.has(houseName)) {
        profile.locations.default.location_objects_set.keys.push(houseName);
      }
      return slot;
    }
  }

  const usedSlots = new Set<string>();
  for (let i = 0; i < (profile.car_to_real_estate_slot.values || []).length; i++) {
    const s = profile.car_to_real_estate_slot.values[i];
    if (s && authenticSlotsSet.has(s)) usedSlots.add(s);
  }

  const sortedCandidates = getPrioritizedSlots(profile);
  let targetSlot = "";
  for (const candidate of sortedCandidates) {
    if (!usedSlots.has(candidate)) {
      targetSlot = candidate;
      break;
    }
  }

  if (!targetSlot) {
    return "";
  }

  const houseName = targetSlot.substring(0, targetSlot.lastIndexOf("_slot_"));
  profile.real_estates[houseName] = profile.real_estates[houseName] || { is_bought: true };
  profile.real_estates[houseName].is_bought = true;
  profile.real_estate_slots[targetSlot] = profile.real_estate_slots[targetSlot] || {};
  profile.real_estate_slots[targetSlot].unlocked = true;
  profile.real_estate_slots[targetSlot].car_id = carStr;

  if (!locationKeysSet.has(houseName)) {
    profile.locations.default.location_objects_set.keys.push(houseName);
  }

  if (existingIdx !== -1) {
    profile.car_to_real_estate_slot.values[existingIdx] = targetSlot;
  } else {
    profile.car_to_real_estate_slot.keys.push(carStr);
    profile.car_to_real_estate_slot.values.push(targetSlot);
  }

  return targetSlot;
}

export function sanitizeAndHealProfile(base: any, userId?: string, email?: string): any {
  if (!base) return base;
  let profileObject = structuredClone(base);

  const isCompressed = profileObject && (profileObject.compressed_data || (profileObject.data && profileObject.data.compressed_data) || (profileObject.d && profileObject.d.compressed_data));
  if (isCompressed) {
    profileObject = decompressProfileIfCompressed(profileObject);
  }
  profileObject = unwrapProfilePayload(profileObject) || profileObject;

  if (profileObject && typeof profileObject === "object") {
    delete profileObject.compressed_data;
    if (profileObject.d?.compressed_data) delete profileObject.d.compressed_data;
    if (profileObject.data?.compressed_data) delete profileObject.data.compressed_data;

    const defaultBlueprint = PROFILE_TEMPLATE;

    if (!profileObject.resources || typeof profileObject.resources !== "object") {
      profileObject.resources = defaultBlueprint?.resources ? structuredClone(defaultBlueprint.resources) : {};
    }
    const res = profileObject.resources;

    delete res.wheel_tires;
    delete res.cash;
    delete res.gold;
    delete res.exp;
    delete res.level;
    delete res.soft_currency;
    delete res.hard_currency;

    if (defaultBlueprint?.resources) {
      for (const k of Object.keys(defaultBlueprint.resources)) {
        if (res[k] === undefined && k !== "soft" && k !== "hard" && k !== "experience") {
          res[k] = structuredClone(defaultBlueprint.resources[k]);
        }
      }
    }

    let rawCash: any = 0;
    if (res.soft !== undefined) {
      if (typeof res.soft === "object" && res.soft !== null) {
        rawCash = res.soft.amount ?? res.soft.value ?? res.soft.count ?? 0;
      } else {
        rawCash = res.soft;
      }
    }
    const safeCash = Math.min(2140000000, Math.max(0, Math.floor(Number(rawCash) || 0)));
    res.soft = { amount: safeCash };

    let rawGold: any = 0;
    if (res.hard !== undefined) {
      if (typeof res.hard === "object" && res.hard !== null) {
        rawGold = res.hard.amount ?? res.hard.value ?? res.hard.count ?? 0;
      } else {
        rawGold = res.hard;
      }
    }
    const safeGold = Math.min(2140000000, Math.max(0, Math.floor(Number(rawGold) || 0)));
    res.hard = { amount: safeGold };

    let rawExp: any = 0;
    let rawLevel: any = 0;
    if (res.experience !== undefined) {
      if (typeof res.experience === "object" && res.experience !== null) {
        rawExp = res.experience.amount ?? res.experience.value ?? res.experience.xp ?? 0;
        rawLevel = res.experience.award_index ?? res.experience.level ?? 0;
      } else {
        rawExp = res.experience;
      }
    }
    let safeExp = Math.max(0, Math.floor(Number(rawExp) || 0));
    let safeLevel = Math.max(1, Math.min(50, Math.floor(Number(rawLevel) || 0)));

    res.experience = { award_index: safeLevel, amount: safeExp };

    if (!profileObject.quests || typeof profileObject.quests !== "object") {
      profileObject.quests = {};
    }
    const fakeQuests = [
      "quest_intro", "intro_race", "delivery_intro_quest", "first_delivery_quest",
      "first_club_race", "first_tuning_quest", "first_gas_station_quest", "apartment_tutorial_quest"
    ];
    for (const fq of fakeQuests) {
      delete profileObject.quests[fq];
    }
    if (!profileObject.quests.car_choice_intro) {
      profileObject.quests.car_choice_intro = { trigger: {}, completed: true, rewarded: true };
    }
    if (!profileObject.quests.move_to_apartment_intro_quest) {
      profileObject.quests.move_to_apartment_intro_quest = { trigger: {} };
    }
    if (!profileObject.quests.move_to_gasstation_intro_quest) {
      profileObject.quests.move_to_gasstation_intro_quest = { trigger: {} };
    }
    if (!profileObject.quests.move_to_tuning_intro_quest) {
      profileObject.quests.move_to_tuning_intro_quest = { trigger: {} };
    }
    if (!profileObject.quests.move_to_club_intro_quest) {
      profileObject.quests.move_to_club_intro_quest = { trigger: {} };
    }

    if (!profileObject.cars || typeof profileObject.cars !== "object") {
      profileObject.cars = { seed: 1000, items: {} };
    }
    if (!profileObject.cars.items || typeof profileObject.cars.items !== "object") {
      profileObject.cars.items = {};
    }

    for (const cid in profileObject.cars.items) {
      const car = profileObject.cars.items[cid];
      if (car && car.__desc_id) {
        if (BANNED_UNRELEASED_CAR_IDS.has(car.__desc_id)) {
          delete profileObject.cars.items[cid];
          continue;
        }
        if (ID_SELF_HEAL_MAP[car.__desc_id]) {
          car.__desc_id = ID_SELF_HEAL_MAP[car.__desc_id];
        }
      }
    }

    const carKeys = Object.keys(profileObject.cars.items);
    if (carKeys.length === 0) {
      let starterCar: any = { __desc_id: "toyotasupra2020", is_bought: true };
      if (PREMIUM_BUILDS && PREMIUM_BUILDS["toyotasupra2020"]) {
        starterCar = structuredClone(PREMIUM_BUILDS["toyotasupra2020"]);
      } else {
        starterCar = getCarTemplate("toyotasupra2020");
      }
      starterCar.__desc_id = "toyotasupra2020";
      starterCar.is_bought = true;
      profileObject.cars.items["1000"] = starterCar;
      profileObject.cars.seed = 1001;
      profileObject.current_car_id = "1000";
    }

    const activeCarIds = Object.keys(profileObject.cars.items);
    const curStr = profileObject.current_car_id !== undefined && profileObject.current_car_id !== null ? profileObject.current_car_id.toString() : "";
    if (!curStr || !profileObject.cars.items[curStr]) {
      profileObject.current_car_id = typeof profileObject.current_car_id === "number" ? parseInt(activeCarIds[0], 10) : activeCarIds[0];
    }

    const activeModelsMap: Record<string, number> = {};
    for (const cid in profileObject.cars.items) {
      const descId = profileObject.cars.items[cid]?.__desc_id;
      if (descId) {
        activeModelsMap[descId] = (activeModelsMap[descId] || 0) + 1;
      }
    }
    profileObject.car_models = {
      keys: Object.keys(activeModelsMap),
      values: Object.values(activeModelsMap).map(v => parseInt(v as any, 10) || 1)
    };

    if (!profileObject.real_estates || typeof profileObject.real_estates !== "object") {
      profileObject.real_estates = {};
    }
    profileObject.real_estates["apartment_95"] = profileObject.real_estates["apartment_95"] || { is_bought: true };
    profileObject.real_estates["apartment_95"].is_bought = true;

    if (!profileObject.real_estate_slots || typeof profileObject.real_estate_slots !== "object") {
      profileObject.real_estate_slots = {};
    }
    profileObject.real_estate_slots["apartment_95_slot_0"] = profileObject.real_estate_slots["apartment_95_slot_0"] || {};
    profileObject.real_estate_slots["apartment_95_slot_0"].unlocked = true;

    ensureCarToRealEstateSlot(profileObject);
    sanitizeCarToRealEstateSlot(profileObject);

    if (profileObject.current_car_id) {
      const activeCarIdStr = profileObject.current_car_id.toString();
      assignCarToFreeSlot(profileObject, activeCarIdStr);
    }

    if (profileObject.clubs && typeof profileObject.clubs === "object") {
      for (const clubName in profileObject.clubs) {
        const c = profileObject.clubs[clubName];
        if (c && typeof c === "object") {
          c.cars = c.cars || {};
          c.available_races = c.available_races || {};
          c.complete_races = c.complete_races || {};
          c.car_statistics = c.car_statistics || {};
        }
      }
    }

    if (!profileObject.profile || typeof profileObject.profile !== "object") {
      profileObject.profile = {};
    }
    if (email && email.includes("@")) {
      profileObject.profile.login = email;
    }
    if (!profileObject.profile.nickname || profileObject.profile.nickname.trim() === "") {
      const numId = userId ? String(userId).replace(/\D/g, "") : "";
      profileObject.profile.nickname = numId ? `Player${numId}` : "Player";
    }
    if (!profileObject.profile.avatar) profileObject.profile.avatar = "avatar_champion_4";
    if (!profileObject.profile.banner) profileObject.profile.banner = "banner_14";
    if (!profileObject.profile.frame) profileObject.profile.frame = "frame_11";
    profileObject.profile.favorite_achievents = profileObject.profile.favorite_achievents || {};

    profileObject.emoji = {
      keys: ["0", "1", "2", "3"],
      values: ["emoji_1", "emoji_2", "emoji_3", "emoji_4"]
    };

    delete profileObject.avatars;
    delete profileObject.banners;
    delete profileObject.frames;
    delete profileObject.unlocks;
    delete profileObject.emojis;

    if (!profileObject.game_world_parts || typeof profileObject.game_world_parts !== "object") {
      profileObject.game_world_parts = {};
    }

    if (!profileObject.locations || typeof profileObject.locations !== "object" || !profileObject.locations.default || !profileObject.locations.default.location_objects_set || !Array.isArray(profileObject.locations.default.location_objects_set.keys) || profileObject.locations.default.location_objects_set.keys.length === 0) {
      if (defaultBlueprint?.locations) {
        profileObject.locations = structuredClone(defaultBlueprint.locations);
      }
    }

    profileObject.date_time = new Date().toISOString().replace("T", " ").substring(0, 19);
  }

  if (profileObject && profileObject.d && (profileObject.d.resources || profileObject.d.cars || profileObject.d.clubs || profileObject.d.real_estates)) {
    profileObject = profileObject.d;
  }
  return profileObject;
}

export function modifyProfile(
  baseProfile: any,
  mods: {
    cash?: number;
    gold?: number;
    exp?: number;
    level?: number;
    custom_cars_amount?: number;
    inject_cars?: string[];
    inject_car?: string;
    get_all_cars?: boolean;
    unlock_clubs?: boolean;
    unlock_maps?: boolean;
    unlock_map?: string;
    inject_map?: string;
    map_name?: string;
    unlock_houses?: boolean;
    unlock_streetpass?: boolean;
    streetpass_points?: number;
    unlock_profile_style?: boolean | string;
    cosmetic_mode?: string;
    custom_cosmetic_count?: number;
    specific_set_id?: number;
    avatar?: string;
    banner?: string;
    frame?: string;
    unlock_neon?: boolean;
    neon_option?: string;
    unlock_tire_walls?: boolean;
    tire_option?: string;
    unlock_number_plates?: boolean;
    plate_option?: string;
    unlock_wheel_rims?: boolean;
    rim_option?: string;
    custom_count?: number;
    inject_achievements?: boolean;
    overwrite_resources?: boolean;
    unlock_all?: boolean;
    inject_everything?: boolean;
    safe_repair?: boolean;
    random_cars_count?: number;
  },
  userId?: string,
  email?: string
): any {
  let profileObject = baseProfile;
  const decompressed = decompressProfileIfCompressed(baseProfile);
  if (decompressed && typeof decompressed === "object") {
    profileObject = decompressed;
  }
  profileObject = unwrapProfilePayload(profileObject) || profileObject;

  if (profileObject && typeof profileObject === "object" && (profileObject.compressed_data || (profileObject.d && profileObject.d.compressed_data) || (profileObject.data && profileObject.data.compressed_data))) {
    const innerDecomp = decompressProfileIfCompressed(profileObject);
    if (innerDecomp && typeof innerDecomp === "object") {
      profileObject = unwrapProfilePayload(innerDecomp) || innerDecomp;
    }
  }

  const isFresh = !profileObject || Object.keys(profileObject).length === 0 || (!profileObject.cars && !profileObject.resources);

  let profile: any;
  if (mods.safe_repair || isFresh) {
    profile = structuredClone(PROFILE_TEMPLATE || {});
    let s90Car: any = { __desc_id: "toyotasupra2020", is_bought: true };
    if (PREMIUM_BUILDS && PREMIUM_BUILDS["toyotasupra2020"]) {
      s90Car = structuredClone(PREMIUM_BUILDS["toyotasupra2020"]);
    } else if (PROFILE_TEMPLATE?.cars?.items) {
      for (const k in PROFILE_TEMPLATE.cars.items) {
        if (PROFILE_TEMPLATE.cars.items[k].__desc_id === "toyotasupra2020") {
          s90Car = structuredClone(PROFILE_TEMPLATE.cars.items[k]);
          break;
        }
      }
    }
    profile.cars = { seed: 1000, items: { "1000": s90Car } };
    profile.car_models = { keys: ["toyotasupra2020"], values: [1] };
    profile.current_car_id = "1000";

    profile.real_estates = { apartment_95: { is_bought: true } };
    profile.real_estate_slots = { apartment_95_slot_0: { unlocked: true, car_id: "1000" } };
    profile.car_to_real_estate_slot = { keys: ["1000"], values: ["apartment_95_slot_0"] };

    if (!mods.unlock_clubs && !mods.unlock_all) {
      profile.clubs = {};
    }

    if (userId) {
      const numericId = String(userId).replace(/\D/g, "");
      profile.profile = profile.profile || {};
      profile.profile.nickname = `Player${numericId || userId}`;
    }
  } else {
    profile = structuredClone(profileObject);
    if (profile?.resources) {
      delete profile.resources.wheel_tires;
    }
    if (profile?.quests) {
      const fakeQuests = [
        "quest_intro", "intro_race", "delivery_intro_quest", "first_delivery_quest",
        "first_club_race", "first_tuning_quest", "first_gas_station_quest", "apartment_tutorial_quest"
      ];
      for (const fq of fakeQuests) {
        delete profile.quests[fq];
      }
    }
  }

  if (profile && profile.profile) {
    if (email && email.includes("@")) {
      profile.profile.login = email;
    }
    if (userId) {
      const numericId = String(userId).replace(/\D/g, "");
      if (!profile.profile.nickname || profile.profile.nickname.startsWith("Player")) {
        profile.profile.nickname = `Player${numericId || userId}`;
      }
    }
  }

  delete profile.compressed_data;
  if (profile.d?.compressed_data) delete profile.d.compressed_data;
  if (profile.data?.compressed_data) delete profile.data.compressed_data;

  // 1. Self-Healing: Auto-correct corrupted descriptor IDs & purge banned unreleased cars
  if (profile && profile.cars && profile.cars.items) {
    for (const key in profile.cars.items) {
      const car = profile.cars.items[key];
      if (car && car.__desc_id) {
        if (BANNED_UNRELEASED_CAR_IDS.has(car.__desc_id)) {
          delete profile.cars.items[key];
          continue;
        }
        if (ID_SELF_HEAL_MAP[car.__desc_id]) {
          car.__desc_id = ID_SELF_HEAL_MAP[car.__desc_id];
        }
      }
    }
  }

  // 2. Self-Healing: Sanitize cosmetic unlocks bounds
  if (profile) {
    if (profile.battle_pass_event_rewards) {
      if (!Array.isArray(profile.battle_pass_event_rewards.keys)) {
        profile.battle_pass_event_rewards = { keys: [] };
      } else {
        const validKeySet = new Set(VALID_COSMETIC_KEYS);
        profile.battle_pass_event_rewards.keys = profile.battle_pass_event_rewards.keys.filter((key: string) => {
          if (typeof key !== "string" || !key) return false;
          if (validKeySet.has(key)) return true;
          const avatarMatch = key.match(/^unlock_avatar_(\d+)$/i);
          const bannerMatch = key.match(/^unlock_banner_(\d+)$/i);
          const frameMatch = key.match(/^unlock_frame_(\d+)$/i);
          const emojiMatch = key.match(/^unlock_emoji_(\d+)$/i);
          if (avatarMatch && parseInt(avatarMatch[1], 10) <= 16) return true;
          if (bannerMatch && parseInt(bannerMatch[1], 10) <= 16) return true;
          if (frameMatch && parseInt(frameMatch[1], 10) <= 16) return true;
          if (emojiMatch && parseInt(emojiMatch[1], 10) <= 4) return true;
          return false;
        });
      }
    }
    profile.emoji = {
      keys: ["0", "1", "2", "3"],
      values: ["emoji_1", "emoji_2", "emoji_3", "emoji_4"]
    };
    delete profile.avatars;
    delete profile.banners;
    delete profile.frames;
    delete profile.unlocks;
    delete profile.emojis;
  }

  // 3. Resources (Cash, Gold, EXP, Level)
  if (!profile.resources) {
    profile.resources = {
      soft: { amount: 0 },
      hard: { amount: 0 },
      experience: { award_index: 1, amount: 0 }
    };
  }

  if (mods.cash !== undefined) {
    const res = profile.resources;
    const currentCash = Number(
      res.soft?.amount ?? res.soft_currency?.amount ?? res.soft_currency ?? res.soft ?? res.cash?.amount ?? res.cash ?? 0
    ) || 0;
    const addCash = Math.floor(Number(mods.cash) || 0);
    const newCash = mods.overwrite_resources ? addCash : (currentCash + addCash);
    const safeCash = Math.min(2140000000, Math.max(0, newCash));
    res.soft = { amount: safeCash };
    delete res.soft_currency;
    delete res.cash;
  }

  if (mods.gold !== undefined) {
    const res = profile.resources;
    const currentGold = Number(
      res.hard?.amount ?? res.hard_currency?.amount ?? res.hard_currency ?? res.hard ?? res.gold?.amount ?? res.gold ?? 0
    ) || 0;
    const addGold = Math.floor(Number(mods.gold) || 0);
    const newGold = mods.overwrite_resources ? addGold : (currentGold + addGold);
    const safeGold = Math.min(2140000000, Math.max(0, newGold));
    res.hard = { amount: safeGold };
    delete res.hard_currency;
    delete res.gold;
  }

  if (mods.level !== undefined || mods.exp !== undefined) {
    const res = profile.resources;
    let currentLevel = 1;
    let currentExp = 0;
    if (res.experience && typeof res.experience === "object") {
      currentLevel = Math.max(1, Number(res.experience.award_index ?? res.experience.level ?? 1) || 1);
      currentExp = Math.max(0, Number(res.experience.amount ?? 0) || 0);
    }

    let targetExp = currentExp;
    if (mods.exp !== undefined) {
      const addExp = Math.floor(Number(mods.exp) || 0);
      targetExp = mods.overwrite_resources ? addExp : (currentExp + addExp);
    }

    let targetLevel = calculateLevelFromExp(targetExp);
    if (mods.level !== undefined) {
      const reqLevel = Math.min(50, Math.max(1, Math.floor(mods.level)));
      targetLevel = mods.overwrite_resources ? reqLevel : Math.max(targetLevel, reqLevel);
    }

    res.experience = { award_index: targetLevel, amount: targetExp };
    delete res.exp;
    delete res.level;
  }

  // 4. Clubs
  if (mods.unlock_clubs || mods.unlock_all) {
    profile.clubs = profile.clubs || {};
    profile.is_actual_clubs_send = true;
    const validClubsSet = new Set(ALL_CLUBS);

    for (const k of Object.keys(profile.clubs)) {
      if (!validClubsSet.has(k)) {
        delete profile.clubs[k];
      }
    }

    ALL_CLUBS.forEach(club => {
      const existingClub = profile.clubs[club];
      if (existingClub && typeof existingClub === "object" && existingClub.club_completed && Object.keys(existingClub.complete_races || {}).length > 0) {
        return;
      }
      profile.clubs[club] = {
        cars: {},
        available_races: {},
        complete_races: {},
        car_statistics: {},
        club_completed: true
      };
    });

    profile.race_generators = profile.race_generators || {};
    ALL_CLUBS.forEach(club => {
      const eliteKey = `${club}_elite`;
      if (!profile.race_generators[eliteKey]) {
        profile.race_generators[eliteKey] = {
          races_counter: {},
          races_set: {}
        };
      }
    });

    profile.locations = profile.locations || {};
    profile.locations.default = profile.locations.default || {};
    profile.locations.default.location_objects_set = profile.locations.default.location_objects_set || { keys: [] };
    profile.locations.default.location_objects_set.keys = profile.locations.default.location_objects_set.keys || [];

    const shouldUnlockHouses = !!(mods.unlock_houses || mods.unlock_all);
    const existingLocSet = new Set(profile.locations.default.location_objects_set.keys);
    for (const loc of ALL_MAP_LOCATION_OBJECTS) {
      const isApartment = loc.toLowerCase().includes("apartment");
      if (isApartment && !shouldUnlockHouses) {
        continue;
      }
      if (!existingLocSet.has(loc)) {
        profile.locations.default.location_objects_set.keys.push(loc);
        existingLocSet.add(loc);
      }
    }
  }

  // 5. Quests
  profile.quests = profile.quests || {};
  INTRO_QUESTS.forEach(q => {
    profile.quests[q] = profile.quests[q] || {};
    profile.quests[q].completed = true;
    profile.quests[q].rewarded = true;
    profile.quests[q].trigger = profile.quests[q].trigger || {};
  });

  // 5. Maps & Real Estates (Exact Bot.py Logic)
  if (mods.unlock_maps || mods.unlock_houses || mods.unlock_all || mods.inject_map || mods.unlock_map || mods.map_name) {
    unlockMapsUltimate(profile);
  }

  profile.real_estates = profile.real_estates || {};
  profile.real_estates["apartment_95"] = { is_bought: true };
  profile.real_estate_slots = profile.real_estate_slots || {};
  profile.real_estate_slots["apartment_95_slot_0"] = profile.real_estate_slots["apartment_95_slot_0"] || {};
  profile.real_estate_slots["apartment_95_slot_0"].unlocked = true;

  // 7. Cars Injection (Raw inventory only - NO slots, NO garages)
  profile.cars = profile.cars || { seed: 1000, items: {} };
  profile.cars.items = profile.cars.items || {};

  const existingDescIds = new Set<string>();
  const existingIds: number[] = [];

  for (const cid in profile.cars.items) {
    const num = parseInt(cid, 10);
    if (!isNaN(num)) existingIds.push(num);
    const descId = profile.cars.items[cid]?.__desc_id;
    if (descId) existingDescIds.add(descId);
  }

  let nextCarId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1000;
  const carsToInject: string[] = [];

  if (mods.get_all_cars || (mods.custom_cars_amount && mods.custom_cars_amount >= ALL_CARS_LIST.length)) {
    // Add all cars from ALL_CARS_LIST that are not yet owned, so total becomes ALL_CARS_LIST.length
    for (const descId of ALL_CARS_LIST) {
      const cleanDesc = (ID_SELF_HEAL_MAP[descId] || descId).replace(/^car_/, "").replace(/_sp[12]/g, "");
      if (BANNED_UNRELEASED_CAR_IDS.has(cleanDesc)) continue;
      if (!existingDescIds.has(cleanDesc)) {
        carsToInject.push(cleanDesc);
      }
    }
  }

  if (mods.inject_cars && Array.isArray(mods.inject_cars)) {
    for (const c of mods.inject_cars) {
      const clean = (ID_SELF_HEAL_MAP[c] || c).replace(/^car_/, "").replace(/_sp[12]/g, "");
      if (!BANNED_UNRELEASED_CAR_IDS.has(clean)) carsToInject.push(clean);
    }
  }

  if (mods.inject_car) {
    const clean = (ID_SELF_HEAL_MAP[mods.inject_car] || mods.inject_car).replace(/^car_/, "").replace(/_sp[12]/g, "");
    if (!BANNED_UNRELEASED_CAR_IDS.has(clean)) carsToInject.push(clean);
  }

  if (mods.random_cars_count && mods.random_cars_count > 0 && !mods.get_all_cars) {
    const availableCars = ALL_CARS_LIST
      .map(c => (ID_SELF_HEAL_MAP[c] || c).replace(/^car_/, "").replace(/_sp[12]/g, ""))
      .filter(c => !BANNED_UNRELEASED_CAR_IDS.has(c) && !existingDescIds.has(c));
    const pool = availableCars.length >= mods.random_cars_count ? availableCars : ALL_CARS_LIST;
    const shuffled = pool.slice().sort(() => 0.5 - Math.random());
    const toInject = shuffled.slice(0, mods.random_cars_count);
    for (const car of toInject) {
      carsToInject.push(car);
    }
  }

  const nowTs = Math.floor(Date.now() / 1000);
  for (const descId of carsToInject) {
    if (BANNED_UNRELEASED_CAR_IDS.has(descId)) continue;
    const newIdStr = String(nextCarId);
    nextCarId++;

    let carObj: any = null;
    if (PREMIUM_BUILDS && PREMIUM_BUILDS[descId]) {
      carObj = structuredClone(PREMIUM_BUILDS[descId]);
    } else if (PROFILE_TEMPLATE?.cars?.items) {
      for (const tCid in PROFILE_TEMPLATE.cars.items) {
        if (PROFILE_TEMPLATE.cars.items[tCid].__desc_id === descId) {
          carObj = structuredClone(PROFILE_TEMPLATE.cars.items[tCid]);
          break;
        }
      }
    }
    if (!carObj) {
      carObj = getCarTemplate(descId);
    }
    if (carObj) {
      carObj.__desc_id = descId;
      carObj.is_bought = true;
      carObj.consumed_resources = carObj.consumed_resources || {};
      carObj.consumed_resources.gasoline = { ts: nowTs, max_amount: 100, amount: 100 };
      carObj.consumed_resources.nitro = { ts: nowTs, max_amount: 20, amount: 20 };
      carObj.consumed_resources.statistic_drive_time = carObj.consumed_resources.statistic_drive_time || { amount: 100 };
      carObj.consumed_resources.statistic_total_distance = carObj.consumed_resources.statistic_total_distance || { amount: 500 };

      // RAW ONLY: Do NOT assign to slot, house, or garage!
      profile.cars.items[newIdStr] = carObj;
      existingDescIds.add(descId);
    }
  }

  profile.cars.seed = Math.max(1000, nextCarId);

  // Synchronize car_models and amounts accurately
  if (profile.cars && profile.cars.items) {
    const activeModelsMap: Record<string, number> = {};
    for (const cid in profile.cars.items) {
      const descId = profile.cars.items[cid]?.__desc_id;
      if (descId) {
        activeModelsMap[descId] = (activeModelsMap[descId] || 0) + 1;
      }
    }
    profile.car_models = {
      keys: Object.keys(activeModelsMap),
      values: Object.values(activeModelsMap).map(v => parseInt(v as any, 10) || 1)
    };

    const carIds = Object.keys(profile.cars.items);
    if (carIds.length > 0) {
      const currentIdStr = profile.current_car_id ? profile.current_car_id.toString() : "";
      if (!currentIdStr || !profile.cars.items[currentIdStr]) {
        profile.current_car_id = typeof profile.current_car_id === "number" ? parseInt(carIds[0], 10) : carIds[0];
      }
    }
  }

  if (mods.unlock_profile_style) {
    profile.battle_pass_event_rewards = profile.battle_pass_event_rewards || { keys: [] };
    profile.shop_owned_packs = profile.shop_owned_packs || { keys: [] };
    if (!Array.isArray(profile.battle_pass_event_rewards.keys)) {
      profile.battle_pass_event_rewards.keys = [];
    }
    if (!Array.isArray(profile.shop_owned_packs.keys)) {
      profile.shop_owned_packs.keys = [];
    }

    const addKeys = (arr: string[], key: string) => {
      if (arr && !arr.includes(key)) arr.push(key);
    };

    const mode = mods.cosmetic_mode || (mods.custom_cosmetic_count !== undefined ? "custom_count" : (mods.specific_set_id ? "specific" : "all"));
    const existingKeysSet = new Set<string>(profile.battle_pass_event_rewards.keys);

    if (mode === "next" || (mode === "custom_count" && mods.custom_cosmetic_count === 1)) {
      // One-by-one: find the first unowned set in sequence
      const nextSet = ORDERED_COSMETIC_SETS.find(s => !existingKeysSet.has(s.unlock_avatar) || !existingKeysSet.has(s.unlock_frame));
      if (nextSet) {
        addKeys(profile.battle_pass_event_rewards.keys, nextSet.unlock_avatar);
        addKeys(profile.battle_pass_event_rewards.keys, nextSet.unlock_frame);
        addKeys(profile.battle_pass_event_rewards.keys, nextSet.unlock_banner);
        profile.profile = profile.profile || {};
        profile.profile.avatar = nextSet.avatar;
        profile.profile.frame = nextSet.frame;
        profile.profile.banner = nextSet.banner;
      }
    } else if (mode === "custom_count" && (mods.custom_cosmetic_count || 0) > 0) {
      const count = Math.min(20, Math.max(1, mods.custom_cosmetic_count || 1));
      let added = 0;
      for (const setItem of ORDERED_COSMETIC_SETS) {
        if (!existingKeysSet.has(setItem.unlock_avatar) || !existingKeysSet.has(setItem.unlock_frame)) {
          addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_avatar);
          addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_frame);
          addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_banner);
          profile.profile = profile.profile || {};
          profile.profile.avatar = setItem.avatar;
          profile.profile.frame = setItem.frame;
          profile.profile.banner = setItem.banner;
          added++;
          if (added >= count) break;
        }
      }
    } else if (mode === "specific" && mods.specific_set_id) {
      const setItem = ORDERED_COSMETIC_SETS.find(s => s.id === mods.specific_set_id);
      if (setItem) {
        addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_avatar);
        addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_frame);
        addKeys(profile.battle_pass_event_rewards.keys, setItem.unlock_banner);
        profile.profile = profile.profile || {};
        profile.profile.avatar = setItem.avatar;
        profile.profile.frame = setItem.frame;
        profile.profile.banner = setItem.banner;
      }
    } else {
      // Unlock all 20 sets & valid keys
      for (const k of VALID_COSMETIC_KEYS) {
        addKeys(profile.battle_pass_event_rewards.keys, k);
      }
      profile.profile = profile.profile || {};
      if (!profile.profile.avatar) profile.profile.avatar = "avatar_champion_4";
      if (!profile.profile.banner) profile.profile.banner = "banner_14";
      if (!profile.profile.frame) profile.profile.frame = "frame_11";
    }

    profile.emoji = {
      keys: ["0", "1", "2", "3"],
      values: ["emoji_1", "emoji_2", "emoji_3", "emoji_4"]
    };

    delete profile.avatars;
    delete profile.banners;
    delete profile.frames;
    delete profile.unlocks;
    delete profile.emojis;

    const shopPacks = [
      "special_avatars", "special_banners", "special_frames", "special_emoji",
      "special_8", "special_11", "special_14", "special_15", "special_55", "special_78"
    ];
    for (const p of shopPacks) {
      addKeys(profile.shop_owned_packs.keys, p);
    }
  }

  if (mods.avatar) {
    profile.profile = profile.profile || {};
    profile.profile.avatar = mods.avatar;
  }
  if (mods.banner) {
    profile.profile = profile.profile || {};
    profile.profile.banner = mods.banner;
  }
  if (mods.frame) {
    profile.profile = profile.profile || {};
    profile.profile.frame = mods.frame;
  }
  if (mods.unlock_neon) {
    injectNeonCosmetics(profile, mods.neon_option || "all", mods.custom_count);
  }
  if (mods.unlock_tire_walls) {
    injectTireSidewalls(profile, mods.tire_option || "all", mods.custom_count);
  }
  if (mods.unlock_number_plates) {
    injectNumberPlates(profile, mods.plate_option || "all", mods.custom_count);
  }
  if (mods.unlock_wheel_rims) {
    injectWheelRims(profile, mods.rim_option || "all", mods.custom_count);
  }
  if (mods.unlock_all || mods.inject_everything) {
    injectNeonCosmetics(profile, "all");
    injectTireSidewalls(profile, "all");
    injectNumberPlates(profile, "all");
    injectWheelRims(profile, "all");
  }

  profile.date_time = new Date().toISOString().replace("T", " ").substring(0, 19);

  return sanitizeAndHealProfile(profile, userId, email);
}


// Default features supported by RYOMENX STORE CONTROLLER keys
const DEFAULT_FEATURES = [
  "cash_gold",
  "level_xp",
  "unlock_clubs",
  "get_all_cars",
  "safe_repair",
  "battlepass",
  "streetpass_ep",
  "bulk_generate",
  "premium"
];

// Helper to check and deduct credits and check feature gates
async function checkAndDeductCredit(licenseKey: string, role: string, feature: string, creditCost = 1) {
  if (role === "owner" || licenseKey === OWNER_KEY) {
    return { success: true, credits: -1 };
  }

  const db = await loadKeysDb();
  const keyData = db.keys[licenseKey];
  if (!keyData) {
    return { success: false, message: "Invalid license key session." };
  }

  if (feature !== "bypass_check") {
    const enabledFeatures = keyData.enabled_features || DEFAULT_FEATURES;
    if (!enabledFeatures.includes(feature)) {
      return { success: false, message: `Access Denied: The "${feature}" feature is not unlocked for your license key.` };
    }
  }

  const credits = getKeyCredits(keyData);
  if (credits !== -1) {
    if (credits <= 0) {
      keyData.out_of_credits = true;
      saveKeysDb(db); // fire-and-forget
      return { success: false, message: "Out of Credits. Please DM Telegram @ryomenx1 to buy more credits." };
    }
    if (credits < creditCost) {
      return { success: false, message: `Insufficient Credits: This action costs ${creditCost} credit(s), but you only have ${credits} credit(s) remaining. Please DM Telegram @ryomenx1 to buy more credits.` };
    }
  }

  return { success: true, keyData, db };
}

async function getRemainingCreditsGlobal(licenseKey: string, role: string) {
  if (role === "owner" || licenseKey === OWNER_KEY) return -1;
  const db = await loadKeysDb();
  return getKeyCredits(db.keys[licenseKey]);
}

// API ROUTE HANDLERS

// License Verification
app.post(["/api/verify-license", "/verify-license", "/api/auth/verify", "/auth/verify"], async (req, res) => {
  const { key, deviceToken, deviceId } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, error: "License key is required.", message: "License key is required." });
  }

  const cleanKey = key.trim();
  const clientDevice = (deviceToken || deviceId || req.headers["x-device-token"] || "").toString().trim();

  // Check owner key or admin key
  if (cleanKey === OWNER_KEY || cleanKey === "admin-mingfu" || cleanKey === "RMX_CARX_RYOMEN_ADD") {
    return res.json({
      success: true,
      role: "admin",
      token: cleanKey,
      message: "Owner access granted.",
      expiry: "Unlimited/Lifetime",
      expires_at: null,
      ...creditResponse(-1),
      enabled_features: DEFAULT_FEATURES
    });
  }

  const db = await loadKeysDb();

  // Check key
  if (!db.keys[cleanKey]) {
    return res.status(401).json({ success: false, error: "Invalid key", message: "Invalid license key." });
  }

  const keyData = db.keys[cleanKey];
  const now = Date.now() / 1000;

  if (keyData.expires_at && now > keyData.expires_at) {
    return res.status(401).json({ success: false, error: "Key expired", message: "This key has expired." });
  }

  // 🔒 HARD DEVICE LOCK: Make keys only valid for one device
  if (keyData.type !== "admin" && keyData.type !== "owner") {
    if (clientDevice) {
      if (keyData.bound_device_token && keyData.bound_device_token !== clientDevice) {
        return res.status(403).json({
          success: false,
          error: "Device Locked",
          message: "⚠️ This key is already bound to another device. Only 1 device is allowed per key."
        });
      }
      if (!keyData.bound_device_token) {
        keyData.bound_device_token = clientDevice;
      }
    }
  }

  // 🔒 ONE OPEN USE AT A TIME: Purge previous active sessions for this key
  const claimedUsers = keyData.claimed_users || [];
  for (const token of claimedUsers) {
    delete db.authorized_users[token];
  }

  // Generate a random user session ID
  const sessionToken = crypto.randomUUID();
  const activeClaims = [sessionToken];

  keyData.claimed_users = activeClaims;
  keyData.claimed_by = activeClaims[0] || null;
  db.authorized_users[sessionToken] = {
    key: cleanKey,
    deviceToken: clientDevice || null,
    expires_at: keyData.expires_at
  };

  await saveKeysDb(db);

  const credits = getKeyCredits(keyData);
  res.json({
    success: true,
    role: keyData.type || "user",
    token: sessionToken,
    sessionToken,
    ...creditResponse(credits),
    enabled_features: keyData.enabled_features || DEFAULT_FEATURES,
    message: "Access granted successfully.",
    expiry: keyData.expires_at ? new Date(keyData.expires_at * 1000).toLocaleString() : "Unlimited/Lifetime",
    expires_at: keyData.expires_at || null,
    out_of_credits: isOutOfCredits(keyData)
  });
});

// Admin & Session Check Middleware
async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  let sessionToken = req.headers["authorization"]?.replace("Bearer ", "")?.trim();
  if (!sessionToken) {
    sessionToken = (
      req.query.adminToken ||
      req.query.userToken ||
      req.query.token ||
      (req.body && (req.body.adminToken || req.body.userToken || req.body.token || req.body.sessionToken))
    ) as string;
  }

  if (!sessionToken) {
    return res.status(401).json({ success: false, message: "Unauthorized. Session token missing." });
  }

  // Owner / master keys
  if (
    sessionToken === OWNER_KEY ||
    sessionToken === "admin-mingfu" ||
    sessionToken === "RMX_CARX_RYOMEN_ADD" ||
    sessionToken === "backupkey2026"
  ) {
    (req as any).role = "owner";
    (req as any).licenseKey = OWNER_KEY;
    (req as any).sessionToken = sessionToken;
    return next();
  }

  const db = await loadKeysDb();

  // 1. Direct key match in database
  if (db.keys[sessionToken]) {
    const directKey = db.keys[sessionToken];
    const now = Date.now() / 1000;
    if (directKey.expires_at && now > directKey.expires_at) {
      return res.status(401).json({ success: false, message: "Your license key has expired." });
    }
    (req as any).role = directKey.type || "user";
    (req as any).sessionToken = sessionToken;
    (req as any).licenseKey = sessionToken;
    return next();
  }

  // 2. Active session token match
  const user = db.authorized_users[sessionToken];
  if (!user) {
    return res.status(401).json({ success: false, message: "Session invalid or expired." });
  }

  const keyData = db.keys[user.key];
  if (!keyData) {
    return res.status(401).json({ success: false, message: "Associated license key no longer exists." });
  }

  const now = Date.now() / 1000;
  if (keyData.expires_at && now > keyData.expires_at) {
    return res.status(401).json({ success: false, message: "Your license key has expired." });
  }

  if (user.expires_at && now > user.expires_at) {
    return res.status(401).json({ success: false, message: "Session has expired." });
  }

  // 🔒 ONE OPEN USE AT A TIME: Check if session is still in claimed_users
  if (keyData.claimed_users && !keyData.claimed_users.includes(sessionToken)) {
    return res.status(401).json({ success: false, message: "Session expired: key opened in another window or device." });
  }

  // 🔒 HARD DEVICE LOCK: Verify device token
  const clientDevice = (req.headers["x-device-token"] || (req.body && (req.body.deviceToken || req.body.deviceId)) || "").toString().trim();
  if (clientDevice && keyData.bound_device_token && keyData.bound_device_token !== clientDevice) {
    return res.status(403).json({ success: false, message: "Device locked: This key is bound to another device." });
  }

  (req as any).role = keyData.type || "user";
  (req as any).sessionToken = sessionToken;
  (req as any).licenseKey = user.key;
  next();
}

// Lightweight session sync — does not mint a new session token
app.get(["/api/session/balance", "/session/balance"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  const licenseKey = (req as any).licenseKey;

  if (role === "owner" || licenseKey === OWNER_KEY) {
    return res.json({
      success: true,
      role: "owner",
      ...creditResponse(-1),
      enabled_features: DEFAULT_FEATURES,
      expiry: "Unlimited/Lifetime",
      expires_at: null
    });
  }

  const db = await loadKeysDb();
  const keyData = db.keys[licenseKey];
  if (!keyData) {
    return res.status(401).json({ success: false, message: "Associated license key no longer exists." });
  }

  const credits = getKeyCredits(keyData);
  return res.json({
    success: true,
    role: keyData.type || "user",
    ...creditResponse(credits),
    enabled_features: keyData.enabled_features || DEFAULT_FEATURES,
    expiry: keyData.expires_at ? new Date(keyData.expires_at * 1000).toLocaleString() : "Unlimited/Lifetime",
    expires_at: keyData.expires_at || null,
    out_of_credits: isOutOfCredits(keyData)
  });
});

app.post(["/api/auth/session", "/auth/session"], async (req, res) => {
  const token = req.body.token || req.headers["authorization"]?.replace("Bearer ", "");
  const clientDevice = (req.body.deviceToken || req.body.deviceId || req.headers["x-device-token"] || "").toString().trim();
  if (!token) {
    return res.status(401).json({ success: false, message: "Session token missing" });
  }

  if (token === OWNER_KEY || token === "admin-mingfu" || token === "RMX_CARX_RYOMEN_ADD") {
    return res.json({ role: "admin", token });
  }

  const db = await loadKeysDb();
  const user = db.authorized_users[token];
  if (user) {
    const keyData = db.keys[user.key];
    if (keyData) {
      if (clientDevice && keyData.bound_device_token && keyData.bound_device_token !== clientDevice) {
        return res.status(403).json({ success: false, message: "Session invalid: this key is registered on another device." });
      }
      const role = (keyData?.type === "admin" || keyData?.type === "owner") ? "admin" : "user";
      return res.json({ role, token });
    }
  }

  return res.status(401).json({ success: false, message: "Invalid session" });
});

// Get cars list
app.get(["/api/cars", "/cars"], (req, res) => {
  res.json({
    success: true,
    total: ALL_CARS_LIST.length,
    cars: ALL_CARS_LIST
  });
});

// Admin strings config
app.get(["/api/admin/strings", "/admin/strings"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden." });
  }
  const db = await loadKeysDb();
  res.json({
    success: true,
    cars_string: db.custom_cars_string || "",
    blueprint_string: db.custom_blueprint_string || "",
    carsString: db.custom_cars_string || "",
    blueprintString: db.custom_blueprint_string || ""
  });
});

app.post(["/api/admin/strings", "/admin/strings"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden." });
  }
  const { cars_string, blueprint_string, carsString, blueprintString } = req.body;
  const db = await loadKeysDb();
  if (cars_string !== undefined || carsString !== undefined) {
    db.custom_cars_string = cars_string ?? carsString;
  }
  if (blueprint_string !== undefined || blueprintString !== undefined) {
    db.custom_blueprint_string = blueprint_string ?? blueprintString;
  }
  await saveKeysDb(db);
  res.json({ success: true, message: "Strings updated successfully." });
});

// Admin / Owner endpoints

// Get all keys
app.get(["/api/admin/keys", "/admin/keys"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const db = await loadKeysDb();
  res.json({
    success: true,
    keys: db.keys || {},
    total_credits_used: db.total_credits_used || 0,
    total_accounts_generated: db.total_accounts_generated || 0
  });
});

// Generate key
app.post(["/api/admin/generate-key", "/admin/generate-key"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { type, duration_val, duration_unit, max_claims, maxClaims, enabled_features, features, custom_key, customKey } = req.body;
  const db = await loadKeysDb();

  const keyType = type || "user";
  if (role !== "owner" && keyType === "admin") {
    return res.status(403).json({ success: false, message: "Only owners can create admin keys." });
  }

  // Resolve credits (-1 = Infinite/Unlimited)
  let creditAmount = resolveCreditsFromBody(req.body);
  if (
    req.body.isUnlimited ||
    req.body.infiniteCredits ||
    req.body.unlimited ||
    req.body.credits === -1 ||
    req.body.credits === "inf" ||
    req.body.credits === "unlimited" ||
    req.body.tokens === -1 ||
    req.body.tokens === "inf" ||
    req.body.tokens === "unlimited"
  ) {
    creditAmount = -1;
  }

  // Parse duration: accepts days, duration string ("1d", "3d", "7d", "30d", "lifetime", "1h", etc.) or unit + val
  let durationSeconds: number | null = null;
  let unit = duration_unit || "unlim";
  let val = duration_val ? parseInt(duration_val, 10) : 0;

  if (req.body.days !== undefined && req.body.days !== null && req.body.days !== "") {
    const dNum = parseInt(String(req.body.days), 10);
    if (!isNaN(dNum) && dNum > 0) {
      val = dNum;
      unit = "d";
    }
  } else if (req.body.duration_days !== undefined && req.body.duration_days !== null && req.body.duration_days !== "") {
    const dNum = parseInt(String(req.body.duration_days), 10);
    if (!isNaN(dNum) && dNum > 0) {
      val = dNum;
      unit = "d";
    }
  }

  const rawDuration = req.body.duration || req.body.expiry;
  if (rawDuration && typeof rawDuration === "string") {
    const dLower = rawDuration.trim().toLowerCase();
    if (dLower === "lifetime" || dLower === "unlimited" || dLower === "unlim" || dLower === "inf" || dLower === "forever") {
      unit = "unlim";
      val = 0;
    } else {
      const match = dLower.match(/^(\d+)\s*(h|hr|hrs|hours?|d|day|days?|m|min|mins|minutes?|mo|mon|months?|w|weeks?|y|years?)$/i);
      if (match) {
        val = parseInt(match[1], 10);
        const u = match[2].toLowerCase();
        if (u.startsWith("h")) unit = "h";
        else if (u.startsWith("d")) unit = "d";
        else if (u.startsWith("w")) { unit = "d"; val = val * 7; }
        else if (u.startsWith("mo")) unit = "mo";
        else if (u.startsWith("y")) { unit = "d"; val = val * 365; }
        else if (u.startsWith("m")) unit = "m";
      }
    }
  }

  if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes") durationSeconds = val * 60;
  else if (unit === "h" || unit === "hr" || unit === "hrs" || unit === "hour" || unit === "hours") durationSeconds = val * 3600;
  else if (unit === "d" || unit === "day" || unit === "days") durationSeconds = val * 86400;
  else if (unit === "mo" || unit === "mon" || unit === "month" || unit === "months") durationSeconds = val * 30 * 86400;

  const keyPrefix = req.body.prefix || req.body.key_prefix || req.body.keyPrefix || "CARXMING";
  const rawKeyName = custom_key || customKey;
  let key = generateLicenseKey(keyPrefix);
  if (rawKeyName && String(rawKeyName).trim()) {
    const trimmedKey = String(rawKeyName).trim();
    if (db.keys[trimmedKey]) {
      return res.status(400).json({ success: false, message: `License key '${trimmedKey}' already exists. Please choose another name.` });
    }
    key = trimmedKey;
  }

  const now = Date.now() / 1000;
  const expiresAt = durationSeconds ? now + durationSeconds : null;
  const featuresList = Array.isArray(enabled_features) ? enabled_features : (Array.isArray(features) ? features : DEFAULT_FEATURES);
  const claimsLimit = max_claims ? parseInt(max_claims, 10) : (maxClaims ? parseInt(maxClaims, 10) : 1);
  const durationLabel = unit === "unlim" ? "lifetime" : (unit === "d" ? `${val}d` : `${val}${unit}`);

  db.keys[key] = {
    type: keyType,
    created_at: now,
    expires_at: expiresAt,
    claimed_users: [],
    claimed_by: null,
    max_claims: claimsLimit,
    duration: durationLabel,
    duration_unit: unit,
    duration_val: val || null,
    credits: creditAmount !== undefined ? creditAmount : 10,
    out_of_credits: false,
    enabled_features: featuresList
  };

  await saveKeysDb(db);
  console.log(`[KEY MINT] Created key ${key} (credits: ${creditAmount === -1 ? 'Unlimited' : creditAmount}, duration: ${unit === 'unlim' ? 'Lifetime' : `${val}${unit}`})`);
  res.json({ success: true, key, data: db.keys[key], created_at: now, expires_at: expiresAt, duration: durationLabel });
});

// Delete Key
app.post(["/api/admin/delete-key", "/admin/delete-key"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: "Key parameter is required." });
  }

  if (key === OWNER_KEY || key === "admin-mingfu" || key === "RMX_CARX_RYOMEN_ADD") {
    return res.status(403).json({ success: false, message: "Cannot delete master owner key." });
  }

  const db = await loadKeysDb();
  const keyData = db.keys[key];
  if (!keyData) {
    return res.status(404).json({ success: false, message: "Key not found." });
  }

  // Revoke active sessions claimed by this key
  const claimedUsers = keyData.claimed_users || [];
  claimedUsers.forEach((u: string) => {
    delete db.authorized_users[u];
  });

  delete db.keys[key];
  await saveKeysDb(db);

  res.json({ success: true, message: "Key successfully deleted." });
});

// Update Key Custom settings (Credits, Features, Max Claims, Expiry)
app.post(["/api/admin/update-key", "/admin/update-key"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { key, enabled_features, features, max_claims, maxClaims, expires_at } = req.body;
  let creditAmount = resolveCreditsFromBody(req.body);
  if (
    req.body.isUnlimited ||
    req.body.infiniteCredits ||
    req.body.unlimited ||
    req.body.credits === -1 ||
    req.body.credits === "inf" ||
    req.body.tokens === -1 ||
    req.body.tokens === "inf"
  ) {
    creditAmount = -1;
  }

  if (!key) {
    return res.status(400).json({ success: false, message: "Key parameter is required." });
  }

  if (key === OWNER_KEY || key === "admin-mingfu" || key === "RMX_CARX_RYOMEN_ADD") {
    return res.status(403).json({ success: false, message: "Cannot modify master owner key." });
  }

  const db = await loadKeysDb();
  const keyData = db.keys[key];
  if (!keyData) {
    return res.status(404).json({ success: false, message: "Key not found." });
  }

  // Update properties if provided
  if (creditAmount !== undefined) {
    keyData.credits = creditAmount;
    delete keyData.tokens;
    if (creditAmount === -1 || creditAmount > 0) {
      keyData.out_of_credits = false;
      delete keyData.out_of_tokens;
    }
  }
  const featList = enabled_features ?? features;
  if (featList !== undefined && Array.isArray(featList)) {
    keyData.enabled_features = featList;
  }
  const claims = max_claims ?? maxClaims;
  if (claims !== undefined) {
    keyData.max_claims = parseInt(claims, 10);
  }
  if (expires_at !== undefined) {
    keyData.expires_at = expires_at === null ? null : parseInt(expires_at, 10);
  }

  db.keys[key] = keyData;
  await saveKeysDb(db);

  res.json({ success: true, message: "Key successfully updated.", data: keyData });
});

// Bulk Delete Keys
app.post(["/api/admin/bulk-delete-keys", "/admin/bulk-delete-keys"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { keys } = req.body;
  if (!keys || !Array.isArray(keys)) {
    return res.status(400).json({ success: false, message: "Keys array is required." });
  }

  const db = await loadKeysDb();
  let deletedCount = 0;

  for (const k of keys) {
    const keyData = db.keys[k];
    if (keyData) {
      if (role === "admin" && keyData.type !== "user") {
        // Skip deleting admin/owner keys if sender is just an admin
        continue;
      }
      // Revoke active sessions claimed by this key
      const claimedUsers = keyData.claimed_users || [];
      claimedUsers.forEach((u: string) => {
        delete db.authorized_users[u];
      });
      delete db.keys[k];
      deletedCount++;
    }
  }

  await saveKeysDb(db);
  res.json({ success: true, message: `Successfully deleted ${deletedCount} keys.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// 👑 ADMIN: ACCOUNTS WATCHDOG & ROLLING BACKUP MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// Get all tracked accounts with watchdog status, credentials, and storage metrics
app.get(["/api/admin/accounts", "/admin/accounts"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const accs = loadTrackedAccounts();
  const list = Object.values(accs).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  const storageStats = getBackupStorageOverview();

  res.json({
    success: true,
    accounts: list,
    totalAccounts: list.length,
    storageStats
  });
});

// Admin toggle: Shut off / unblock backup feature for an account
app.post(["/api/admin/accounts/toggle-block", "/admin/accounts/toggle-block"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { email, blocked } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  if (!acc) {
    return res.status(404).json({ success: false, message: "Tracked account not found." });
  }

  acc.adminBackupBlocked = blocked !== undefined ? !!blocked : !acc.adminBackupBlocked;
  if (acc.adminBackupBlocked) {
    acc.backupEnabled = false; // Immediately disable backup if blocked
  }
  saveTrackedAccounts(accs);

  res.json({
    success: true,
    message: acc.adminBackupBlocked
      ? `Backup feature SHUT OFF for ${normalized}.`
      : `Backup feature ALLOWED for ${normalized}.`,
    account: acc
  });
});

// Admin toggle: Turn backup on / off directly for an account
app.post(["/api/admin/accounts/toggle-backup", "/admin/accounts/toggle-backup"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { email, enabled } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  if (!acc) {
    return res.status(404).json({ success: false, message: "Tracked account not found." });
  }

  if (acc.adminBackupBlocked && enabled) {
    return res.status(400).json({ success: false, message: "Cannot enable backup: Admin has blocked this account." });
  }

  acc.backupEnabled = enabled !== undefined ? !!enabled : !acc.backupEnabled;
  saveTrackedAccounts(accs);

  res.json({
    success: true,
    message: acc.backupEnabled ? `Backup enabled for ${normalized}.` : `Backup disabled for ${normalized}.`,
    account: acc
  });
});

// Admin action: Backup account now
app.post(["/api/admin/accounts/backup-now", "/admin/accounts/backup-now"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  if (!acc || !acc.password) {
    return res.status(400).json({ success: false, message: "Account credentials not found to execute backup." });
  }

  try {
    const loginRes = await CarXClient.authenticate("login", acc.email, acc.password);
    if (!loginRes.success || !loginRes.token) {
      return res.status(400).json({ success: false, message: loginRes.message || "CarX login failed." });
    }

    const profRes = await CarXClient.getProfile(loginRes.token, loginRes.userId);
    if (!profRes || !profRes.profile) {
      return res.status(400).json({ success: false, message: "Failed to fetch profile snapshot from CarX server." });
    }

    const size = saveAccountBackupFile(normalized, profRes.profile);
    const now = Date.now();
    acc.backupSizeBytes = size;
    acc.lastBackupAt = now;
    const wd = evaluateWatchdog(profRes.profile, acc.lastInGameActive);
    acc.watchdogStatus = wd.status;
    acc.watchdogLabel = wd.label;
    acc.watchdogReason = wd.reason;
    acc.lastInGameActive = wd.lastInGameActive || acc.lastInGameActive;
    saveTrackedAccounts(accs);

    res.json({
      success: true,
      message: `Snapshot saved successfully! (${(size / 1024).toFixed(1)} KB)`,
      backupSizeBytes: size,
      lastBackupAt: now,
      account: acc
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to create backup." });
  }
});

// Admin action: Restore account from backup
app.post(["/api/admin/accounts/restore", "/admin/accounts/restore"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  if (!acc || !acc.password) {
    return res.status(400).json({ success: false, message: "Account credentials missing." });
  }

  const backupProfile = loadAccountBackupFile(normalized);
  if (!backupProfile) {
    return res.status(404).json({ success: false, message: "No backup snapshot exists for this account." });
  }

  try {
    const loginRes = await CarXClient.authenticate("login", acc.email, acc.password);
    if (!loginRes.success || !loginRes.token) {
      return res.status(400).json({ success: false, message: loginRes.message || "CarX login failed." });
    }

    const saveRes = await CarXClient.saveProfile(
      loginRes.token,
      backupProfile,
      loginRes.userId,
      loginRes.deviceId,
      loginRes.uniqueId
    );

    if (!saveRes.success) {
      return res.status(400).json({ success: false, message: saveRes.message || "CarX restore save failed." });
    }

    res.json({
      success: true,
      message: "Account profile backup successfully restored to CarX Street server! Restart the game to see changes."
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Restore failed." });
  }
});

// Admin action: Delete tracked account record and backup file
app.post(["/api/admin/accounts/delete", "/admin/accounts/delete"], authMiddleware, async (req, res) => {
  const role = (req as any).role;
  if (role !== "owner" && role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden. Admin access required." });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  delete accs[normalized];
  saveTrackedAccounts(accs);
  deleteAccountBackupFile(normalized);

  res.json({ success: true, message: `Account ${normalized} and its backup were deleted from tracking.` });
});

// ─────────────────────────────────────────────────────────────────────────────
// 👤 USER / CLIENT: OPTIONAL BACKUP & WATCHDOG CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

// Get backup & watchdog status for current connected account
app.all(["/api/carx/backup/status", "/carx/backup/status"], authMiddleware, async (req, res) => {
  const email = (req.query.email || req.body.email || "").toString().toLowerCase().trim();
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const accs = loadTrackedAccounts();
  const acc = accs[email];
  if (!acc) {
    return res.json({
      success: true,
      backupEnabled: false,
      adminBackupBlocked: false,
      lastBackupAt: null,
      backupSizeBytes: 0,
      watchdogStatus: "unverified",
      watchdogLabel: "⚪ UNVERIFIED / NEVER PLAYED",
      watchdogReason: "No gameplay recorded yet."
    });
  }

  res.json({
    success: true,
    backupEnabled: acc.backupEnabled,
    adminBackupBlocked: acc.adminBackupBlocked,
    lastBackupAt: acc.lastBackupAt,
    backupSizeBytes: acc.backupSizeBytes || 0,
    watchdogStatus: acc.watchdogStatus,
    watchdogLabel: acc.watchdogLabel,
    watchdogReason: acc.watchdogReason,
    lastInGameActive: acc.lastInGameActive
  });
});

// User toggle backup feature on/off (optional)
app.post(["/api/carx/backup/toggle", "/carx/backup/toggle"], authMiddleware, async (req, res) => {
  const { email, enabled } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  let acc = accs[normalized];
  if (!acc) {
    acc = await recordAccountActivity(normalized);
  }

  if (acc.adminBackupBlocked && enabled) {
    return res.status(403).json({
      success: false,
      message: "⚠️ Backup feature disabled by administrator. You cannot enable backup for this account."
    });
  }

  acc.backupEnabled = !!enabled;
  saveTrackedAccounts(accs);

  res.json({
    success: true,
    message: acc.backupEnabled ? "Auto-backup enabled for this account." : "Auto-backup disabled for this account.",
    backupEnabled: acc.backupEnabled,
    adminBackupBlocked: acc.adminBackupBlocked
  });
});

// User instant backup save
app.post(["/api/carx/backup/save", "/carx/backup/save"], authMiddleware, async (req, res) => {
  const { email, token, userId, deviceId, uniqueId } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  if (acc && acc.adminBackupBlocked) {
    return res.status(403).json({ success: false, message: "Backup feature has been shut off by administrator." });
  }

  try {
    let activeToken = token;
    let activeUserId = userId;

    if (!activeToken && acc && acc.password) {
      const loginRes = await CarXClient.authenticate("login", acc.email, acc.password, deviceId, uniqueId);
      if (loginRes.success) {
        activeToken = loginRes.token;
        activeUserId = loginRes.userId;
      }
    }

    if (!activeToken) {
      return res.status(400).json({ success: false, message: "Token or credentials required to fetch profile for backup." });
    }

    const profRes = await CarXClient.getProfile(activeToken, activeUserId, deviceId, uniqueId);
    if (!profRes || !profRes.profile) {
      return res.status(400).json({ success: false, message: "Failed to fetch profile snapshot from game server." });
    }

    const size = saveAccountBackupFile(normalized, profRes.profile);
    const now = Date.now();
    const updated = await recordAccountActivity(normalized, undefined, activeUserId, (req as any).licenseKey, (req as any).role, profRes.profile);
    if (updated) {
      updated.backupSizeBytes = size;
      updated.lastBackupAt = now;
      saveTrackedAccounts(loadTrackedAccounts());
    }

    res.json({
      success: true,
      message: `Profile backup saved successfully (${(size / 1024).toFixed(1)} KB)!`,
      backupSizeBytes: size,
      lastBackupAt: now
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Failed to save backup." });
  }
});

// User restore backup
app.post(["/api/carx/backup/restore", "/carx/backup/restore"], authMiddleware, async (req, res) => {
  const { email, password, token, userId, deviceId, uniqueId } = req.body;
  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required." });
  }

  const normalized = email.toLowerCase().trim();
  const backupProfile = loadAccountBackupFile(normalized);
  if (!backupProfile) {
    return res.status(404).json({ success: false, message: "No backup snapshot exists for this account." });
  }

  const accs = loadTrackedAccounts();
  const acc = accs[normalized];
  const pass = password || acc?.password || getSavedCredentials().saved_passwords?.[normalized];

  try {
    let activeToken = token;
    let activeUserId = userId || acc?.carxId;

    if (!activeToken && pass) {
      const loginRes = await CarXClient.authenticate("login", normalized, pass, deviceId, uniqueId);
      if (loginRes.success) {
        activeToken = loginRes.token;
        activeUserId = loginRes.userId;
      }
    }

    if (!activeToken) {
      return res.status(400).json({ success: false, message: "Active session token or password required to restore backup." });
    }

    const saveRes = await CarXClient.saveProfile(activeToken, backupProfile, activeUserId, deviceId, uniqueId);
    if (!saveRes.success) {
      return res.status(400).json({ success: false, message: saveRes.message || "Server save failed during restore." });
    }

    res.json({
      success: true,
      message: "Backup profile successfully restored to server! Please completely restart your CarX Street game."
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || "Restore failed." });
  }
});

// CarX Account Login
app.post(["/api/carx/login", "/carx/login"], authMiddleware, async (req, res) => {
  const { email, password, deviceId, uniqueId } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }

  const result = await CarXClient.authenticate("login", email, password, deviceId, uniqueId);
  await CarXClient.fetchAndAttachProfileStats(result);
  if (result.success) {
    recordAccountActivity(
      email,
      password,
      result.userId,
      (req as any).licenseKey,
      (req as any).role,
      result.stats || result.data
    ).catch(() => {});
  }
  res.json(result);
});

// CarX Account Register
app.post(["/api/carx/register", "/carx/register"], authMiddleware, async (req, res) => {
  let { email, password, deviceId, uniqueId, verify, auto_mail, auto_password } = req.body;

  if (auto_mail || !email) {
    const user = "carx" + crypto.randomBytes(5).toString("hex");
    email = user + "@carxming.com";
  }
  if (auto_password || !password) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let rand = "";
    for (let i = 0; i < 8; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    password = "CarX@" + rand;
  }

  let result: Awaited<ReturnType<typeof CarXClient.authenticate>>;
  let mailToken: string | null = null;

  if (verify) {
    // ⚡ PARALLEL: mailbox creation + CarX registration fire at the same time
    console.log(`[REGISTER] Synchronous mailbox+register for ${email}...`);
    const [mbToken, reg] = await Promise.all([
      precreateMailbox(email, password),
      CarXClient.authenticate("register", email, password, deviceId, uniqueId)
    ]);
    mailToken = mbToken;
    result = reg;

    if (result.success) {
      console.log(`[REGISTER] ⚡ Auto-verifying ${email} (mailToken=${mailToken ? "ready" : "null"})...`);
      const verifyRes = await autoVerifyMailtm(email, password, result.token, result.deviceId, result.uniqueId, mailToken);
      console.log(`[REGISTER AUTO-VERIFY] ${email}: success=${verifyRes.success} code=${verifyRes.code ?? "N/A"} | ${verifyRes.message}`);
      
      if (!verifyRes.success) {
        return res.json({
          success: false,
          message: `Account registered successfully on CarX, but auto-verification failed: ${verifyRes.message}. You can verify it manually under the Verify tab.`
        });
      }
    }
  } else {
    result = await CarXClient.authenticate("register", email, password, deviceId, uniqueId);
  }

  if (result.success) {
    // 🤖 EXACTLY LIKE THE BOT: Inject the starter blueprint save right away!
    try {
      const blueprint = getBotBlueprint();
      if (blueprint && result.token) {
        console.log(`[REGISTER] 💾 Injecting bot blueprint profile for ${email}...`);
        const saveRes = await CarXClient.saveProfile(result.token, blueprint);
        console.log(`[REGISTER] Blueprint injection result for ${email}:`, saveRes.success ? "✅ OK" : `❌ ${saveRes.message}`);
      }
    } catch (e: any) {
      console.error("[REGISTER] Failed to inject blueprint save:", e.message || e);
    }

    try {
      const db = await loadKeysDb();
      db.total_accounts_generated = (db.total_accounts_generated || 0) + 1;
      await saveKeysDb(db);
    } catch (e) {
      console.error("[TELEMETRY] Failed to increment registered count:", e);
    }

    await CarXClient.fetchAndAttachProfileStats(result);
    recordAccountActivity(
      email,
      password,
      result.userId,
      (req as any).licenseKey,
      (req as any).role,
      result.stats || result.data
    ).catch(() => {});
  }
  res.json({ ...result, email, password });
});


// CarX Account Verify
app.post(["/api/carx/verify", "/carx/verify"], authMiddleware, async (req, res) => {
  const { email, password, code, deviceId, uniqueId } = req.body;
  if (!email || !password || !code) {
    return res.status(400).json({ success: false, message: "Email, password, and verification code are required." });
  }

  const result = await CarXClient.verifyAccount(email, password, code, undefined, deviceId, uniqueId);
  await CarXClient.fetchAndAttachProfileStats(result);
  if (result.success) {
    recordAccountActivity(
      email,
      password,
      result.userId,
      (req as any).licenseKey,
      (req as any).role,
      result.stats || result.data
    ).catch(() => {});
  }
  res.json(result);
});

// CarX Fetch Real Profile Stats
app.post(["/api/carx/profile", "/carx/profile"], authMiddleware, async (req, res) => {
  const { token, userId, deviceId, uniqueId, email } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required." });
  }

  try {
    const [profileResult, authState] = await Promise.all([
      CarXClient.getProfile(token, userId, deviceId, uniqueId),
      CarXClient.getAuthState(token),
    ]);
    const { profile, response } = profileResult;

    if (!authState) {
      return res.json({
        success: false,
        message: "Session expired (logged into another device/game). Please reconnect your account."
      });
    }
    
    let stats: any;
    if (profile) {
      stats = extractProfileStats(profile, false);
    } else {
      // Return starting stats for fresh/uninitialized accounts (rather than throwing 502)
      stats = {
        cash: 21000,
        gold: 0,
        level: 1,
        exp: 0,
        name: null,
        avatar: null,
        lastUpdated: null,
        isVerified: authState ? !!authState.verified : false,
        isFallback: true
      };
    }

    if (authState) {
      stats.isVerified = !!authState.verified;
    }

    const stateObj = authState?.d || authState;
    const bannedVal = stateObj?.is_banned ?? stateObj?.banned ?? stateObj?.ban ?? false;
    const statusVal = String(stateObj?.status || "").toLowerCase();
    const isBanned = Boolean(bannedVal || statusVal === "banned" || statusVal === "blocked" || stateObj?.is_blocked || profile?.is_banned || profile?.banned);

    stats.isBanned = isBanned;
    if (isBanned) {
      stats.banReason = stateObj?.ban_reason || stateObj?.reason || "Account suspended on CarX servers";
    }

    if (email || profile?.account?.email || profile?.email) {
      const accEmail = email || profile?.account?.email || profile?.email;
      recordAccountActivity(accEmail, undefined, userId, (req as any).licenseKey, (req as any).role, profile).catch(() => {});
    }

    return res.json({
      success: true,
      stats,
      isBanned: stats.isBanned,
      banReason: stats.banReason,
      rawProfile: profile || null
    });
  } catch (e: any) {
    console.error("[PROFILE ERROR]", e.message || e);
    return res.json({ success: false, message: e.message || "Error fetching profile." });
  }
});


// CarX Account Delete (Robust Anonymous + Token Auto Sequence from bot.py)
app.post(["/api/carx/delete", "/carx/delete", "/api/carx/delete-account", "/carx/delete-account"], authMiddleware, async (req, res) => {
  const { token, userToken, email, username, password, pass, deviceId } = req.body;
  const activeToken = token || userToken || (req.headers["authorization"]?.replace(/^Bearer\s+/i, ""));
  const activeEmail = (email || username || "").trim();
  const activePass = (password || pass || "").trim();

  if (!activeEmail && !activeToken) {
    return res.status(400).json({ success: false, message: "Email or Token is required." });
  }

  const result = await CarXClient.deleteAccountAuto(activeEmail, activePass, activeToken, deviceId);
  res.json(result);
});

// Saved Passwords & Credentials Configuration Endpoints
app.get(["/api/carx/saved-credentials", "/carx/saved-credentials"], authMiddleware, (req, res) => {
  const creds = getSavedCredentials();
  res.json({ success: true, credentials: creds });
});

app.post(["/api/carx/saved-credentials", "/carx/saved-credentials"], authMiddleware, (req, res) => {
  const result = saveSavedCredentials(req.body);
  res.json(result);
});

// Rebuild Banned Account (Extract JSON -> Purge Account -> Re-register -> Re-inject JSON)
app.post(["/api/carx/rebuild-banned", "/carx/rebuild-banned", "/api/carx/rebuild", "/carx/rebuild"], authMiddleware, async (req, res) => {
  const { email, username, password, pass, token, userToken, deviceId, uniqueId } = req.body;
  const activeEmail = (email || username || "").trim();
  const activePass = (password || pass || "").trim();
  const activeToken = token || userToken || (req.headers["authorization"]?.replace(/^Bearer\s+/i, ""));

  if (!activeEmail || !activePass) {
    return res.status(400).json({ success: false, message: "Email and password are required to rebuild account." });
  }

  const result = await CarXClient.rebuildBannedAccount({
    email: activeEmail,
    password: activePass,
    token: activeToken,
    deviceId,
    uniqueId
  });

  res.json(result);
});

// CarX Ban Status Checker (Works with active Token or Email/Password)
app.post(["/api/carx/check-ban", "/carx/check-ban"], authMiddleware, async (req, res) => {
  const { token, email, password, userId, deviceId, uniqueId } = req.body;
  try {
    let activeToken = token;
    let activeUserId = userId;

    if (!activeToken && email && password) {
      console.log(`[CHECK BAN] Logging in for ban check on ${email}...`);
      const auth = await CarXClient.botLogin(email, password, deviceId);
      if (auth.success && auth.token) {
        activeToken = auth.token;
        activeUserId = auth.carxId;
      } else {
        const msg = auth.message || "";
        if (/ban|block|suspend|forbidden|restrict/i.test(msg)) {
          return res.json({
            success: true,
            isBanned: true,
            banReason: msg,
            statusText: "BANNED",
            email
          });
        }
        return res.status(400).json({ success: false, message: msg || "Failed to authenticate account for ban check." });
      }
    }

    if (!activeToken) {
      return res.status(400).json({ success: false, message: "Provide an active token or account email and password." });
    }

    const banStatus = await CarXClient.checkBanStatus(activeToken, activeUserId, deviceId, uniqueId);
    return res.json({
      success: true,
      ...banStatus,
      email: email || undefined,
      userId: activeUserId || undefined
    });
  } catch (err: any) {
    console.error("[CHECK BAN ERROR]", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to check ban status." });
  }
});

// CarX Account Restore Backup (from bot.py restore profile)
app.post(["/api/carx/restore", "/carx/restore"], authMiddleware, async (req, res) => {
  const { token, userId, deviceId, uniqueId } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required." });
  }

  const restoreProfile = getRestoreProfile();
  if (!restoreProfile) {
    return res.status(400).json({ success: false, message: "Restore backup file (restore_profile.json) not found." });
  }

  const upload = await CarXClient.uploadProfile(token, restoreProfile, userId, undefined, false, false, deviceId, uniqueId);
  if (upload.success) {
    const stats = extractProfileStats(restoreProfile, false);
    return res.json({ success: true, message: "✅ Backup restored and uploaded successfully!", stats });
  }
  return res.status(400).json({ success: false, message: "Failed to upload restored backup profile to server." });
});

// CarX Account Unblock
app.post(["/api/carx/unblock", "/carx/unblock"], authMiddleware, async (req, res) => {
  const { email, password, token, userId, deviceId, uniqueId, verify } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required." });
  }

  let activeToken = token;
  let activeUserId = userId;
  let activeDeviceId = deviceId || crypto.randomBytes(8).toString("hex");
  let activeUniqueId = uniqueId || crypto.randomUUID().replace(/-/g, "");

  console.log(`[UNBLOCK] Logging in to get token for ${email}...`);
  const loginRes = await CarXClient.authenticate("login", email, password, activeDeviceId, activeUniqueId);
  if (loginRes.success && loginRes.token) {
    activeToken = loginRes.token;
    activeUserId = loginRes.userId ? String(loginRes.userId) : activeUserId;
    activeDeviceId = loginRes.deviceId || activeDeviceId;
    activeUniqueId = loginRes.uniqueId || activeUniqueId;
    console.log(`[UNBLOCK] Login succeeded. Token: ${activeToken}, UserId: ${activeUserId}`);
  } else {
    console.log(`[UNBLOCK] Login failed: ${loginRes.message || "Unknown error"}. Verifying if account exists...`);
    
    // Check if the username exists by attempting a check registration
    const checkReg = await CarXClient.authenticate("register", email, password, activeDeviceId, activeUniqueId);
    if (checkReg.success && checkReg.token) {
      // Registration succeeded, meaning the account did NOT exist. Clean it up and reject unblock.
      console.log(`[UNBLOCK] Check registration succeeded (account did not exist). Deleting test account...`);
      await CarXClient.deleteAccount(checkReg.token, email, password);
      return res.status(400).json({
        success: false,
        message: "Account is not yet registered. Cannot unblock."
      });
    } else {
      // Registration failed because account already exists (so it is registered, but password was incorrect or other issue)
      console.log(`[UNBLOCK] Check registration failed (account exists): ${checkReg.message}`);
      
      // If we already have a provided token, we can proceed with that token (fallback)
      if (activeToken) {
        console.log(`[UNBLOCK] Proceeding with provided token fallback.`);
      } else {
        return res.status(400).json({
          success: false,
          message: `Failed to login to blocked account. If the account exists, the password might be incorrect. Detail: ${loginRes.message}`
        });
      }
    }
  }

  // 1. Fetch profile
  console.log(`[UNBLOCK] Fetching profile for ${email}...`);
  const profileResult = await CarXClient.getProfile(activeToken, activeUserId, activeDeviceId, activeUniqueId);
  let { profile, isWrappedInD, isWrappedInData } = profileResult;
  let usingFallback = false;

  if (!profile) {
    console.log(`[UNBLOCK] Profile fetch failed (account may be banned). Falling back to template profile.`);
    profile = PROFILE_TEMPLATE ? structuredClone(PROFILE_TEMPLATE) : null;
    usingFallback = true;
    isWrappedInD = true;
    isWrappedInData = false;
  }

  if (!profile) {
    return res.status(400).json({
      success: false,
      message: "Failed to fetch profile from the blocked account and template profile is unavailable."
    });
  }

  // 2. Delete account
  console.log(`[UNBLOCK] Deleting account ${email}...`);
  const deleteResult = await CarXClient.deleteAccount(activeToken, email, password);
  if (!deleteResult.success) {
    return res.status(400).json({
      success: false,
      message: "Failed to delete the blocked account: " + deleteResult.message
    });
  }

  // 3. Register account back
  console.log(`[UNBLOCK] Registering account ${email} back...`);
  let regResult: any;
  let mailToken: string | null = null;
  if (verify) {
    console.log(`[UNBLOCK] Auto-verifying new account for ${email}...`);
    const [mbToken, reg] = await Promise.all([
      precreateMailbox(email, password),
      CarXClient.authenticate("register", email, password, activeDeviceId, activeUniqueId)
    ]);
    mailToken = mbToken;
    regResult = reg;

    if (regResult.success) {
      const verifyRes = await autoVerifyMailtm(email, password, regResult.token, regResult.deviceId, regResult.uniqueId, mailToken);
      if (!verifyRes.success) {
        console.warn(`[UNBLOCK VERIFY FAILED] ${verifyRes.message}`);
      }
    }
  } else {
    regResult = await CarXClient.authenticate("register", email, password, activeDeviceId, activeUniqueId);
  }

  if (!regResult.success) {
    return res.status(400).json({
      success: false,
      message: "Deleted the blocked account successfully, but failed to re-register: " + regResult.message
    });
  }

  // 4. Upload profile
  console.log(`[UNBLOCK] Uploading profile back to new account...`);
  if (usingFallback) {
    const targetCash = req.body.cash !== undefined ? Number(req.body.cash) : (req.body.profileStats?.cash !== undefined ? Number(req.body.profileStats.cash) : 100000000);
    const targetGold = req.body.gold !== undefined ? Number(req.body.gold) : (req.body.profileStats?.gold !== undefined ? Number(req.body.profileStats.gold) : 50000);
    const targetLevel = req.body.level !== undefined ? Number(req.body.level) : (req.body.profileStats?.level !== undefined ? Number(req.body.profileStats.level) : 50);
    const targetExp = req.body.exp !== undefined ? Number(req.body.exp) : (req.body.profileStats?.exp !== undefined ? Number(req.body.profileStats.exp) : targetLevel * 10000);

    console.log(`[UNBLOCK] Customizing fallback profile: cash=${targetCash}, gold=${targetGold}, level=${targetLevel}`);
    profile = modifyProfile(profile, { cash: targetCash, gold: targetGold, level: targetLevel, exp: targetExp }, regResult.userId);
  }
  
  profile.date_time = new Date().toISOString().replace("T", " ").substring(0, 19);
  
  const upload = await CarXClient.uploadProfile(
    regResult.token,
    profile,
    regResult.userId,
    undefined,
    isWrappedInD,
    isWrappedInData,
    regResult.deviceId,
    regResult.uniqueId
  );

  if (upload.success) {
    await CarXClient.fetchAndAttachProfileStats(regResult);
    return res.json({
      success: true,
      message: "Account successfully unblocked! Profile was backed up, account deleted, re-registered, and profile restored.",
      account: {
        email,
        password,
        token: regResult.token,
        user_id: regResult.userId ? String(regResult.userId) : undefined,
        deviceId: regResult.deviceId,
        uniqueId: regResult.uniqueId,
        unipId: regResult.unipId || regResult.uniqueId,
        profileStats: regResult.profileStats || undefined,
        statsFetchedAt: regResult.profileStats ? Date.now() : undefined,
      }
    });
  } else {
    return res.status(400).json({
      success: false,
      message: "Account was deleted and re-registered successfully, but failed to upload your backed up profile back to it."
    });
  }
});

// Exact Python Bot Map Unlock Executor
// Exact Python Bot Map Unlock Executor (carx_v19.py exact maps injection)
async function executePythonMapUnlock(rawToken: string, customUserId?: string, customDeviceId?: string): Promise<{ success: boolean; message: string; profile?: any; stats?: any }> {
  const token = rawToken.startsWith("Bearer ") ? rawToken.slice(7).trim() : rawToken.trim();
  const userId = customUserId ? String(customUserId).trim() : "";
  const deviceId = (customDeviceId || crypto.randomUUID().replace(/-/g, "")).slice(0, 32);
  const pyScript = path.join(process.cwd(), "bot_map_unlock.py");

  // Attempt 1: Execute bot_map_unlock.py directly with Python
  const pyPromise = new Promise<{ success: boolean; message: string; profile?: any; stats?: any }>((resolve) => {
    execFile("python", [pyScript, token, userId, deviceId], { maxBuffer: 50 * 1024 * 1024, timeout: 65000 }, (error, stdout, stderr) => {
      if (error) {
        console.warn("[PYTHON MAP RUNNER ERROR]", stderr || error.message);
        return resolve({ success: false, message: stderr || error.message });
      }
      try {
        const out = stdout.trim();
        const lastJsonLine = out.split("\n").filter(l => l.trim().startsWith("{")).pop();
        if (lastJsonLine) {
          const parsed = JSON.parse(lastJsonLine);
          return resolve(parsed);
        }
        const parsed = JSON.parse(out);
        return resolve(parsed);
      } catch (err: any) {
        console.warn("[PYTHON MAP RUNNER PARSE ERROR]", stdout);
        return resolve({ success: false, message: stdout || err.message });
      }
    });
  });

  const res = await pyPromise;
  if (res && res.success) {
    return res;
  }

  // Attempt 2: Exact 1:1 replica of carx_v19.py in Node
  console.log("[MAP INJECT] Executing exact V19 maps injection in Node...");
  try {
    const userAgent = "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)";
    const profileUrl = `${GAME_BASE_URL}/profiles`;

    const authHeaders: Record<string, string> = {
      "User-Agent": userAgent,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Project": "STREET",
      "Authorization": fToken(token),
      "x-token": token,
      "Origin": "https://carx-online.com"
    };
    if (userId) authHeaders["X-CarX-Id"] = userId;
    if (deviceId) authHeaders["X-Device-Id"] = deviceId;

    const getRes = await fetch(profileUrl, {
      method: "GET",
      headers: authHeaders
    });

    if (getRes.status !== 200 && getRes.status !== 201) {
      return { success: false, message: `HTTP ${getRes.status} fetching profile from CarX.` };
    }

    const envelope: any = await getRes.json().catch(() => null);
    if (!envelope) {
      return { success: false, message: "No profile data returned from CarX server." };
    }

    const decompressed = decompressProfileIfCompressed(envelope);
    let profile = decompressed && typeof decompressed === "object" ? decompressed : envelope;

    // Inject exact V19 maps data
    profile = unlockMapsUltimate(profile);

    const enc = encryptProfileL84L(profile);

    let uploadPayload: any = { compressed_data: enc };
    const container = findCompressedDataInEnvelope(envelope);
    if (container) {
      container.container.compressed_data = enc;
      uploadPayload = envelope;
    }

    let saved = false;
    let lastErr = "Save failed";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const postRes = await fetch(profileUrl, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(uploadPayload)
        });
        if (postRes.status === 200 || postRes.status === 201 || postRes.status === 204) {
          saved = true;
          break;
        }
        lastErr = `HTTP ${postRes.status}`;
        await new Promise(r => setTimeout(r, 1500));
      } catch (err: any) {
        lastErr = err?.message || "Connection error";
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    if (saved) {
      const r = profile.resources || {};
      const silver = r.soft?.amount !== undefined ? r.soft.amount : (r.soft || 0);
      const gold = r.hard?.amount !== undefined ? r.hard.amount : (r.hard || 0);
      const xp = r.experience?.amount !== undefined ? r.experience.amount : (r.experience || 0);
      const gwp = profile.game_world_parts || {};
      const maps_count = Object.keys(gwp).length;
      const estates = profile.real_estates || {};
      const real_estates_count = Object.keys(estates).length;
      const cars = profile.cars?.items || profile.cars || {};
      const cars_count = typeof cars === "object" ? Object.keys(cars).length : 0;

      const stats = {
        cash: silver,
        gold: gold,
        exp: xp,
        maps_count,
        real_estates_count,
        cars_count
      };
      return { success: true, message: "✅ Done. Maps and Houses successfully unlocked!", profile, stats };
    }
    return { success: false, message: `❌ Save failed: ${lastErr}` };
  } catch (e: any) {
    return { success: false, message: e?.message || "Map unlock failed" };
  }
}

// CarX Injection Endpoints
app.post(["/api/carx/inject", "/carx/inject"], authMiddleware, async (req, res) => {
  const {
    token,
    userId,
    service_type,
    custom_amount,
    deviceId,
    uniqueId,
    unlock_houses = false,
    unlock_clubs = false,
    get_all_cars = false,
    unlock_streetpass = false,
    inject_ep = false,
    unlock_profile_style = false,
    unlock_neon = false,
    neon_option = "all",
    unlock_tire_walls = false,
    tire_option = "all",
    unlock_number_plates = false,
    plate_option = "all",
    unlock_wheel_rims = false,
    rim_option = "all",
    inject_car,
    inject_cars,
    avatar,
    banner,
    frame,
    random_cars_count
  } = req.body;

  if (!token || !service_type) {
    return res.status(400).json({ success: false, message: "Token and service_type are required." });
  }

  const role = (req as any).role;
  const licenseKey = (req as any).licenseKey;

  // Map service_type to feature ID (supporting both legacy & bot.py actions)
  const featureMap: Record<string, string> = {
    cash: "cash_gold",
    gold: "cash_gold",
    custom_resource: "cash_gold",
    exp: "level_xp",
    level: "level_xp",
    unlock_clubs: "unlock_clubs",
    get_all_cars: "get_all_cars",
    add_cars_all: "get_all_cars",
    add_cars_50: "get_all_cars",
    add_cars_random: "get_all_cars",
    safe_repair: "safe_repair",
    battlepass: "battlepass",
    menu_sp: "battlepass",
    custom_ep: "streetpass_ep",
    streetpass_ep: "streetpass_ep",
    inject_all: "cash_gold",
    inject_everything: "cash_gold",
    menu_all: "cash_gold",
    unlock_profile_style: "battlepass",
    unlock_neon: "battlepass",
    unlock_tire_walls: "battlepass",
    unlock_number_plates: "battlepass",
    unlock_wheel_rims: "battlepass",
    inject_car: "get_all_cars",
    inject_cars: "get_all_cars",
    inject_random_cars: "get_all_cars",
    premium: "premium",
    inject_max: "cash_gold",
    inject_med: "cash_gold",
    currency_max: "cash_gold",
    currency_med: "cash_gold",
    inject_step: "cash_gold",
    currency_step: "cash_gold",
    menu_maps: "unlock_clubs",
    unlock_maps: "unlock_clubs",
    unlock_map: "unlock_clubs",
    inject_map: "unlock_clubs",
    unlock_maps_houses: "unlock_clubs",
    unlock_houses: "unlock_clubs",
    menu_restore: "safe_repair",
    restore: "safe_repair"
  };

  // Credit cost map for each injection service_type
  const creditCostMap: Record<string, number> = {
    cash: 2,
    gold: 2,
    custom_resource: 0,
    exp: 1,
    level: 1,
    unlock_clubs: 3,
    unlock_maps_houses: 3,
    unlock_houses: 3,
    get_all_cars: 4,
    add_cars_all: 4,
    add_cars_50: 3,
    add_cars_random: 2,
    safe_repair: 1,
    battlepass: 5,
    menu_sp: 5,
    custom_ep: 2,
    streetpass_ep: 2,
    inject_all: 3,
    inject_everything: 15,
    menu_all: 15,
    premium: 5,
    unlock_profile_style: 3,
    unlock_neon: 2,
    unlock_tire_walls: 2,
    unlock_number_plates: 2,
    unlock_wheel_rims: 3,
    inject_car: 1,
    inject_cars: 1,
    inject_random_cars: 2,
    inject_max: 3,
    inject_med: 2,
    currency_max: 3,
    currency_med: 2,
    inject_step: 1,
    currency_step: 1,
    menu_maps: 1,
    unlock_maps: 1,
    unlock_map: 1,
    inject_map: 1,
    menu_restore: 2,
    restore: 2
  };

  let creditCost = creditCostMap[service_type] || 1;
  if (service_type === "inject_cars") {
    const carsCount = Array.isArray(inject_cars) ? inject_cars.length : 0;
    if (carsCount === 0) {
      return res.status(400).json({ success: false, message: "No cars selected for injection." });
    }
    creditCost = carsCount * 1;
  }

  let customResourceParsed: {
    cash: { ok: boolean; value: number | null; message: string };
    gold: { ok: boolean; value: number | null; message: string };
    exp: { ok: boolean; value: number | null; message: string };
  } | null = null;

  const isComboAction = service_type === "inject_all" || service_type === "inject_everything";

  if (service_type === "custom_resource") {
    const cashParsed = parseResourceValue(req.body.cash, 0, MAX_CASH, "cash");
    if (!cashParsed.ok) return res.status(400).json({ success: false, message: cashParsed.message });
    const goldParsed = parseResourceValue(req.body.gold, 0, MAX_GOLD, "gold");
    if (!goldParsed.ok) return res.status(400).json({ success: false, message: goldParsed.message });
    const expParsed = parseResourceValue(req.body.exp, 1, MAX_EXP, "exp");
    if (!expParsed.ok) return res.status(400).json({ success: false, message: expParsed.message });

    customResourceParsed = { cash: cashParsed, gold: goldParsed, exp: expParsed };
    creditCost = 0;
    if (cashParsed.value !== null) creditCost += 1;
    if (goldParsed.value !== null) creditCost += 1;
    if (expParsed.value !== null) creditCost += 1;
    if (unlock_streetpass) creditCost += 5;
    if (unlock_houses || unlock_clubs) creditCost += 3;
    if (get_all_cars) creditCost += 4;

    if (creditCost === 0) {
      return res.status(400).json({ success: false, message: "No resources or add-ons selected for custom injection." });
    }
  } else if (!isComboAction && service_type !== "safe_repair") {
    if (unlock_streetpass && service_type !== "battlepass" && service_type !== "custom_ep") {
      creditCost += 5;
    }
    if ((unlock_houses || unlock_clubs) && service_type !== "unlock_clubs") {
      creditCost += 3;
    }
    if (get_all_cars && service_type !== "get_all_cars") {
      creditCost += 4;
    }
  }

  let requestedFeature = featureMap[service_type];
  if (!requestedFeature) {
    return res.status(400).json({ success: false, message: "Invalid service_type." });
  }

  // Special check for custom_resource to validate individual permissions
  if (service_type === "custom_resource") {
    requestedFeature = "bypass_check";
    const db = await loadKeysDb();
    const keyData = db.keys[licenseKey];
    if (role !== "owner" && licenseKey !== OWNER_KEY && keyData) {
      const enabled = keyData.enabled_features || DEFAULT_FEATURES;
      if (customResourceParsed) {
        if (customResourceParsed.cash.value !== null || customResourceParsed.gold.value !== null) {
          if (!enabled.includes("cash_gold")) {
            return res.status(403).json({ success: false, message: "Access Denied: The \"cash_gold\" feature is not unlocked for your license key." });
          }
        }
        if (customResourceParsed.exp.value !== null) {
          if (!enabled.includes("level_xp")) {
            return res.status(403).json({ success: false, message: "Access Denied: The \"level_xp\" feature is not unlocked for your license key." });
          }
        }
      }
    }
  }

  // Special check for inject_all / inject_everything: requires all 4 underlying features to be unlocked!
  if (service_type === "inject_all" || service_type === "inject_everything") {
    const checkAllFeatures = ["cash_gold", "level_xp", "unlock_clubs", "get_all_cars"];
    const db = await loadKeysDb();
    const keyData = db.keys[licenseKey];
    if (role !== "owner" && licenseKey !== OWNER_KEY && keyData) {
      const enabled = keyData.enabled_features || DEFAULT_FEATURES;
      for (const f of checkAllFeatures) {
        if (!enabled.includes(f)) {
          return res.status(403).json({ success: false, message: `Access Denied: The inject everything package requires "${f}" feature permission.` });
        }
      }
    }
  }

  const check = await checkAndDeductCredit(licenseKey, role, requestedFeature, creditCost);
  if (!check.success) {
    return res.status(check.message?.includes("Access Denied") ? 403 : 402).json({ success: false, message: check.message });
  }

  // Fire-and-forget credit deduction — respond immediately after success, DB writes in background
  const deductCreditOnSuccess = () => {
    loadKeysDb(true).then(db => {
      if (role !== "owner" && licenseKey !== OWNER_KEY) {
        const keyData = db.keys[licenseKey];
        if (keyData) {
          const currentCredits = getKeyCredits(keyData);
          if (currentCredits !== -1) {
            keyData.credits = Math.max(0, currentCredits - creditCost);
            delete keyData.tokens;
            if (keyData.credits === 0) {
              keyData.out_of_credits = true;
              delete keyData.out_of_tokens;
            }
          }
        }
      }
      db.total_credits_used = (db.total_credits_used || 0) + creditCost;
      saveKeysDb(db).catch(e => console.error("[CREDITS] Failed to deduct credits:", e));
      console.log(`[CREDITS] Logged deduction of ${creditCost} credits.`);
    }).catch(e => console.error("[CREDITS] Failed to load db for deduction:", e));
  };

  // Optimized: get remaining credits from in-memory cache
  const getRemainingCredits = async () => getRemainingCreditsGlobal(licenseKey, role);

  try {
    // ── EXACT PYTHON BOT MAP UNLOCK ─────────────────────────────────────────
    const isMapService = [
      "unlock_maps_houses",
      "unlock_maps",
      "unlock_map",
      "inject_map",
      "menu_maps",
      "unlock_houses"
    ].includes(service_type);

    if (isMapService) {
      console.log(`[MAP INJECT] Running exact V19 map unlock for token...`);
      const mapResult = await executePythonMapUnlock(token, userId, deviceId);
      if (mapResult.success) {
        deductCreditOnSuccess();
        const remCredits = await getRemainingCredits();
        const stats = mapResult.profile ? extractProfileStats(mapResult.profile, false) : mapResult.stats;
        return res.json({
          success: true,
          message: "✅ Done. Maps and Houses successfully unlocked!",
          stats,
          ...creditResponse(remCredits)
        });
      } else {
        return res.status(400).json({
          success: false,
          message: mapResult.message || "Failed to unlock maps on CarX server."
        });
      }
    }

    // ── Handle profile-based injections (get profile + modify + upload) ──────────
    const profileTypes = [
      "cash", "gold", "exp", "level", "unlock_clubs", "get_all_cars",
      "custom_resource", "safe_repair", "unlock_profile_style",
      "unlock_neon", "unlock_tire_walls", "unlock_number_plates", "unlock_wheel_rims",
      "inject_car", "inject_cars", "inject_random_cars", "battlepass", "custom_ep", "streetpass_ep",
      "inject_max", "inject_med", "currency_max", "currency_med",
      "add_cars_all", "add_cars_50", "add_cars_random", "menu_sp", "restore", "menu_restore"
    ];

    if (profileTypes.includes(service_type)) {
      // First trigger and wait for StreetPass and EP verification to complete if requested.
      // This ensures that any updated event/streetpass state exists in the game server's database
      // before we fetch the profile, preventing the subsequent profile upload from overwriting/wiping it.
      let spResult = false;
      if (unlock_streetpass || service_type === "battlepass" || service_type === "custom_ep" || service_type === "menu_sp") {
        spResult = await CarXClient.unlockStreetPassAuto(token, deviceId, uniqueId);
      }

      if (inject_ep) {
        const epObj = JSON.parse(STREETPASS_BODY.replace(/com\.carxtech\.sr\.bank\.event\.bp/g, "com.carxtech.sr.bank.event.ep_big"));
        await Promise.all(
          Array.from({ length: 5 }, () => CarXClient.verifyStreetPass(token, epObj, deviceId, uniqueId))
        );
      }

      // Fetch profile AFTER the verify requests have fully updated the database state
      const profileResult = await CarXClient.getProfile(token, userId, deviceId, uniqueId);
      const optStreetPassSuccess = spResult;
      const { profile, response, isWrappedInD, isWrappedInData } = profileResult;

      if (!profile && service_type !== "safe_repair" && service_type !== "restore" && service_type !== "menu_restore") {
        return res.status(400).json({ success: false, message: "Failed to download profile. Check account status." });
      }

      let modified: any;
      let successMsg = "";

      if (service_type === "cash") {
        const amount = custom_amount ? parseInt(custom_amount, 10) : 1000;
        modified = modifyProfile(profile, { cash: amount, unlock_houses, unlock_clubs, get_all_cars }, userId);
        successMsg = `✅ Successfully added +${amount.toLocaleString()} Cash safely!`;
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
        if (unlock_clubs) successMsg += " (All Clubs Unlocked)";
        if (get_all_cars) successMsg += " (All Cars Injected)";
        if (unlock_streetpass) successMsg += " (StreetPass Activated)";
        if (inject_ep) successMsg += " (EP Point loops sent)";
      } else if (service_type === "gold") {
        const amount = custom_amount ? parseInt(custom_amount, 10) : 1000;
        modified = modifyProfile(profile, { gold: amount, unlock_houses, unlock_clubs, get_all_cars }, userId);
        successMsg = `✅ Successfully added +${amount.toLocaleString()} Gold safely!`;
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
        if (unlock_clubs) successMsg += " (All Clubs Unlocked)";
        if (get_all_cars) successMsg += " (All Cars Injected)";
        if (unlock_streetpass) successMsg += " (StreetPass Activated)";
        if (inject_ep) successMsg += " (EP Point loops sent)";
      } else if (service_type === "exp" || service_type === "level") {
        const amount = custom_amount ? parseInt(custom_amount, 10) : 100;
        modified = modifyProfile(profile, { exp: amount, unlock_houses, unlock_clubs, get_all_cars }, userId);
        successMsg = `✅ Successfully added +${amount.toLocaleString()} EXP safely!`;
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
        if (unlock_clubs) successMsg += " (All Clubs Unlocked)";
        if (get_all_cars) successMsg += " (All Cars Injected)";
        if (unlock_streetpass) successMsg += " (StreetPass Activated)";
        if (inject_ep) successMsg += " (EP Point loops sent)";
      } else if (service_type === "inject_max" || service_type === "currency_max" || service_type === "inject_step" || service_type === "currency_step") {
        modified = modifyProfile(profile, { cash: 1000, gold: 1000, exp: 100 }, userId);
        successMsg = "✅ Safe Step Currency added (+1,000 Cash, +1,000 Gold, +100 EXP safely)!";
      } else if (service_type === "inject_med" || service_type === "currency_med") {
        modified = modifyProfile(profile, { cash: 1000, gold: 1000, exp: 100 }, userId);
        successMsg = "✅ Safe Step Currency added (+1,000 Cash, +1,000 Gold, +100 EXP safely)!";
      } else if (service_type === "unlock_clubs") {
        modified = modifyProfile(profile, {
          unlock_clubs: true
        }, userId);
        const clubsCount = Object.keys(modified?.clubs || {}).length;
        successMsg = `✅ Successfully unlocked all ${clubsCount} Clubs safely!`;
      } else if (service_type === "add_cars_all") {
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { get_all_cars: true }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Successfully injected ${addedCount} cars raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "add_cars_50") {
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { random_cars_count: 50 }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Successfully injected ${addedCount} cars raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "add_cars_random") {
        const count = parseInt(random_cars_count || custom_amount || 10, 10) || 10;
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { random_cars_count: count }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Successfully injected ${addedCount} random cars raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "menu_sp") {
        await CarXClient.unlockStreetPassAuto(token, deviceId, uniqueId);
        modified = maxStreetPassPointsFromBot(profile, 1000000);
        successMsg = "✅ StreetPass verified and 1,000,000 Event Points activated!";
      } else if (service_type === "restore" || service_type === "menu_restore") {
        const restoreData = getRestoreProfile();
        if (!restoreData) {
          return res.status(400).json({ success: false, message: "Restore backup file (restore_profile.json) not found." });
        }
        modified = restoreData;
        successMsg = "✅ Backup profile successfully restored and uploaded!";
      } else if (service_type === "get_all_cars") {
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { get_all_cars: true, unlock_houses, unlock_clubs }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Successfully parked all ${finalCount} cars in your fleet! (${addedCount} added raw). Turn on/off your game to sync.`;
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
        if (unlock_clubs) successMsg += " (All Clubs Unlocked)";
        if (unlock_streetpass) successMsg += " (StreetPass Activated)";
        if (inject_ep) successMsg += " (EP Point loops sent)";
      } else if (service_type === "custom_resource") {
        if (!customResourceParsed) {
          return res.status(400).json({ success: false, message: "Invalid custom resource payload." });
        }
        const { cash: cashParsed, gold: goldParsed, exp: expParsed } = customResourceParsed;
        const addCash = cashParsed.value !== null && cashParsed.value !== undefined ? cashParsed.value : 0;
        const addGold = goldParsed.value !== null && goldParsed.value !== undefined ? goldParsed.value : 0;
        const addExp = expParsed.value !== null && expParsed.value !== undefined ? expParsed.value : 0;
        modified = modifyProfile(profile, {
          cash: addCash,
          gold: addGold,
          exp: addExp,
          unlock_houses,
          unlock_clubs,
          get_all_cars
        }, userId);
        successMsg = `✅ Safely added +${addCash.toLocaleString()} Cash, +${addGold.toLocaleString()} Gold, +${addExp.toLocaleString()} EXP!`;
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
        if (unlock_streetpass) successMsg += " (StreetPass Activated)";
        if (inject_ep) successMsg += " (EP Point loops sent)";
      } else if (service_type === "safe_repair") {
        modified = modifyProfile(profile || {}, {
          safe_repair: true,
          cash: 99000000,
          gold: 99000000,
          level: 50,
          exp: 93060,
          unlock_houses,
          unlock_clubs: true, // Force true to match the warning message stating it will beat all clubs
          get_all_cars
        }, userId);
        modified = cleanRewriteAccountData(modified);
        successMsg = "✅ Safe Profile Repair completed successfully! Corrupted slots sanitized, all 52 real estates validated, and 99M Cash & 99M Gold safely loaded. REPORT ERROR eliminated!";
        if (unlock_houses) successMsg += " (All Houses Unlocked)";
      } else if (service_type === "clean_rewrite_account" || service_type === "clean_sync" || service_type === "clean_rewrite") {
        modified = cleanRewriteAccountData(profile || {});
        successMsg = "✅ Clean Blueprint Rewrite Complete! Sanitized all 52 real estates, 6 world districts, validated slots and garage references into 100% compliant CarX save data. REPORT ERROR eliminated!";
      } else if (service_type === "unlock_profile_style") {
        const cosmeticMode = req.body.cosmetic_mode || (req.body.custom_count ? "custom_count" : (req.body.set_id ? "specific" : "all"));
        const customCount = req.body.custom_count ? parseInt(req.body.custom_count, 10) : undefined;
        const setId = req.body.set_id ? parseInt(req.body.set_id, 10) : undefined;

        const initialAvatars = (profile.battle_pass_event_rewards?.keys || []).filter((k: string) => k.startsWith("unlock_avatar_")).length;

        modified = modifyProfile(profile, {
          unlock_profile_style: true,
          cosmetic_mode: cosmeticMode,
          custom_cosmetic_count: customCount,
          specific_set_id: setId,
          avatar: req.body.avatar || avatar,
          banner: req.body.banner || banner,
          frame: req.body.frame || frame
        }, userId);

        const finalAvatars = (modified.battle_pass_event_rewards?.keys || []).filter((k: string) => k.startsWith("unlock_avatar_")).length;
        const finalFrames = (modified.battle_pass_event_rewards?.keys || []).filter((k: string) => k.startsWith("unlock_frame_")).length;
        const addedCount = Math.max(0, finalAvatars - initialAvatars);

        if (cosmeticMode === "next" || customCount === 1) {
          successMsg = `✅ Successfully unlocked next Avatar & Frame one-by-one! (${finalAvatars}/20 Avatars, ${finalFrames}/20 Frames unlocked).`;
        } else if (cosmeticMode === "custom_count" && customCount) {
          successMsg = `✅ Successfully unlocked ${addedCount} Avatars & Frames one-by-one! (${finalAvatars}/20 Avatars, ${finalFrames}/20 Frames unlocked).`;
        } else if (cosmeticMode === "specific" && setId) {
          successMsg = `✅ Successfully unlocked & equipped Set ${setId}! (${finalAvatars}/20 Avatars, ${finalFrames}/20 Frames unlocked).`;
        } else {
          successMsg = `✅ Successfully unlocked all ${finalAvatars}/20 Avatars & ${finalFrames}/20 Frames!`;
        }
      } else if (service_type === "unlock_neon") {
        const option = req.body.neon_option || neon_option || "all";
        const count = req.body.custom_count ? parseInt(req.body.custom_count, 10) : (option === "next" ? 1 : undefined);
        modified = modifyProfile(profile, {
          unlock_neon: true,
          neon_option: option,
          custom_count: count,
          unlock_houses,
          unlock_clubs
        }, userId);
        const statsNow = extractProfileStats(modified, false);
        successMsg = option === "next" || count === 1
          ? `✅ Successfully injected next Neon Underglow one-by-one! (${statsNow.neons_count}/15 Neons Approved & Installed).`
          : `✅ Successfully injected Neon Underglow! (${statsNow.neons_count}/15 Neons Approved & Installed).`;
      } else if (service_type === "unlock_tire_walls") {
        const option = req.body.tire_option || tire_option || "all";
        const count = req.body.custom_count ? parseInt(req.body.custom_count, 10) : (option === "next" ? 1 : undefined);
        modified = modifyProfile(profile, {
          unlock_tire_walls: true,
          tire_option: option,
          custom_count: count,
          unlock_houses,
          unlock_clubs
        }, userId);
        const statsNow = extractProfileStats(modified, false);
        successMsg = option === "next" || count === 1
          ? `✅ Successfully injected next Tire Sidewall one-by-one! (${statsNow.tire_walls_count}/14 Sidewalls Approved & Installed).`
          : `✅ Successfully injected Tire Sidewalls! (${statsNow.tire_walls_count}/14 Sidewalls Approved & Installed).`;
      } else if (service_type === "unlock_number_plates") {
        const option = req.body.plate_option || plate_option || "all";
        const count = req.body.custom_count ? parseInt(req.body.custom_count, 10) : (option === "next" ? 1 : undefined);
        modified = modifyProfile(profile, {
          unlock_number_plates: true,
          plate_option: option,
          custom_count: count,
          unlock_houses,
          unlock_clubs
        }, userId);
        const statsNow = extractProfileStats(modified, false);
        successMsg = option === "next" || count === 1
          ? `✅ Successfully injected next Number Plate one-by-one! (${statsNow.plates_count}/74 Plates Approved & Installed).`
          : `✅ Successfully injected Custom Number Plates! (${statsNow.plates_count}/74 Plates Approved & Installed).`;
      } else if (service_type === "unlock_wheel_rims") {
        const option = req.body.rim_option || rim_option || "all";
        const count = req.body.custom_count ? parseInt(req.body.custom_count, 10) : (option === "next" ? 1 : undefined);
        modified = modifyProfile(profile, {
          unlock_wheel_rims: true,
          rim_option: option,
          custom_count: count,
          unlock_houses,
          unlock_clubs
        }, userId);
        const statsNow = extractProfileStats(modified, false);
        successMsg = option === "next" || count === 1
          ? `✅ Successfully injected next Wheel Rims one-by-one! (${statsNow.rims_count} Rims Approved & Installed).`
          : `✅ Successfully injected Custom Wheel Rims! (${statsNow.rims_count} Rims Approved & Installed).`;
      } else if (service_type === "inject_car") {
        if (!inject_car) {
          return res.status(400).json({ success: false, message: "Car model name (inject_car) is required." });
        }
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { inject_car }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        successMsg = `✅ Car "${inject_car}" successfully injected raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "inject_cars") {
        if (!inject_cars || !Array.isArray(inject_cars) || inject_cars.length === 0) {
          return res.status(400).json({ success: false, message: "A list of selected cars (inject_cars) is required." });
        }
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { inject_cars }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Successfully injected ${addedCount} selected cars raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "inject_random_cars") {
        const count = parseInt(random_cars_count, 10);
        if (isNaN(count) || count <= 0) {
          return res.status(400).json({ success: false, message: "A valid positive random_cars_count is required." });
        }
        const initialCount = Object.keys(profile.cars?.items || {}).length;
        modified = modifyProfile(profile, { random_cars_count: count }, userId);
        const finalCount = Object.keys(modified.cars?.items || {}).length;
        const addedCount = Math.max(0, finalCount - initialCount);
        successMsg = `✅ Injected ${addedCount} random cars raw! Total cars in account: ${finalCount}.`;
      } else if (service_type === "battlepass" || service_type === "custom_ep" || service_type === "streetpass_ep") {
        await CarXClient.unlockStreetPassAuto(token, deviceId, uniqueId);
        modified = maxStreetPassPointsFromBot(profile, 1000000);
        successMsg = "✅ Premium StreetPass successfully verified & 1,000,000 Event Points activated! Unlocked all avatars, frames, banners, and quick chats.";
      }

      const upload = await CarXClient.uploadProfile(token, modified, userId, response, isWrappedInD, isWrappedInData, deviceId, uniqueId);
      if (upload.success) {
        deductCreditOnSuccess(); // fire-and-forget
        const remCredits = await getRemainingCredits();
        const [authState] = await Promise.all([
          CarXClient.getAuthState(token).catch(() => null)
        ]);
        const stats = extractProfileStats(modified, false);
        if (authState) stats.isVerified = !!authState.verified;
        return res.json({ success: true, message: successMsg, stats, ...creditResponse(remCredits) });
      }
      return res.status(400).json({ success: false, message: "Failed to upload injected profile to server." });
    }

    // ── inject_all / inject_everything / menu_all ───────────────────────────────
    if (service_type === "inject_all" || service_type === "inject_everything" || service_type === "menu_all") {
      const isEverything = service_type === "inject_everything" || service_type === "menu_all";
      const shouldUnlockSP = unlock_streetpass || isEverything;
      const shouldInjectEP = inject_ep || isEverything;

      let bpSuccess = false;
      if (shouldUnlockSP) {
        bpSuccess = await CarXClient.unlockStreetPassAuto(token, deviceId, uniqueId);
      }

      if (shouldInjectEP && !shouldUnlockSP) {
        const epObj = JSON.parse(STREETPASS_BODY.replace(/com\.carxtech\.sr\.bank\.event\.bp/g, "com.carxtech.sr.bank.event.ep_big"));
        await Promise.all(
          Array.from({ length: 3 }, () => CarXClient.verifyStreetPass(token, epObj, deviceId, uniqueId))
        );
      }

      // Fetch profile AFTER the verify requests have fully updated the database state
      const profileResult = await CarXClient.getProfile(token, userId, deviceId, uniqueId);
      const { profile, response, isWrappedInD, isWrappedInData } = profileResult;

      if (!profile) {
        return res.status(400).json({ success: false, message: "Failed to download profile." });
      }

      let modified: any;
      if (isEverything) {
        modified = injectCurrencyFromBot(profile, 50000000, 9999, 999999);
        modified = maxStreetPassPointsFromBot(modified, 1000000);
        modified = modifyProfile(modified, {
          cash: 50000000,
          gold: 9999,
          level: 50,
          exp: 999999,
          unlock_clubs: true,
          get_all_cars: true,
          unlock_houses: true,
          unlock_maps: true,
          unlock_profile_style: true
        }, userId);
      } else {
        modified = modifyProfile(profile, {
          cash: 50000000,
          gold: 9999,
          level: 50,
          exp: 999999,
          unlock_clubs: true,
          get_all_cars: true,
          unlock_houses: true,
          unlock_maps: true,
          unlock_profile_style: true
        }, userId);
      }

      const upload = await CarXClient.uploadProfile(token, modified, userId, response, isWrappedInD, isWrappedInData, deviceId, uniqueId);
      if (upload.success) {
        deductCreditOnSuccess(); // fire-and-forget
        const remCredits = await getRemainingCredits();
        const totalCarsInjected = Object.keys(modified?.cars?.items || {}).length || ALL_CARS_LIST.length;
        let msg = isEverything
          ? `✅ Everything successfully injected!\n💵 Cash: 50M\n🪙 Gold: 9,999\n📈 EXP: 999,999 (Level 50)\n🏆 All Clubs Unlocked\n🚗 All ${totalCarsInjected} Cars Injected`
          : "✅ Default Boost successfully injected!\n💵 Cash: 50M\n🪙 Gold: 9,999\n📈 EXP: 999,999 (Level 50)\n🏆 All Clubs Unlocked\n🚗 Starting Car R34 Active";

        const spActivated = isEverything ? bpSuccess : (unlock_streetpass ? bpSuccess : false);
        if (spActivated) {
          msg += "\n🎟 Premium StreetPass: Activated ✅";
        } else if (unlock_streetpass || isEverything) {
          msg += "\n🎟 Premium StreetPass: Activation Failed/Timeout ⚠️";
        }
        const [authState] = await Promise.all([
          CarXClient.getAuthState(token).catch(() => null)
        ]);
        const stats = extractProfileStats(modified, false);
        if (authState) stats.isVerified = !!authState.verified;
        return res.json({ success: true, message: msg, stats, ...creditResponse(remCredits) });
      }
      return res.status(400).json({ success: false, message: "Failed to upload comprehensive profile." });
    }

    // ── battlepass ───────────────────────────────────────────────────────────────


    // ── premium ──────────────────────────────────────────────────────────────────
    if (service_type === "premium") {
      const result = await CarXClient.unlockPremium(token, deviceId, uniqueId);
      if (result.success) {
        deductCreditOnSuccess(); // fire-and-forget
        const remCredits = await getRemainingCredits();
        return res.json({
          success: true,
          message: `✅ Premium Account subscription successfully verified & activated! Expired at: ${result.expired}`,
          ...creditResponse(remCredits)
        });
      }
      return res.status(400).json({ success: false, message: result.message || "Failed to unlock premium account." });
    }

    return res.status(400).json({ success: false, message: "Invalid service_type." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message || "Internal server error during injection" });
  }
});

// Bulk accounts generation & logging

// Precompiled regex patterns for extracting verification codes from emails
const CODE_PATTERNS = [
  /registration code below[^\n]*\r?\n[^\n]*?([a-z0-9]{6})\b/i,
  /code below[^\n]*\r?\n[^\n]*?([a-z0-9]{6})\b/i,
  /verification code[^\n]*\r?\n[^\n]*?([a-z0-9]{6})\b/i,
  /your code[^\n]*:\s*([a-z0-9]{6})\b/i,
  /\bcode[^\n]{0,30}?:\s*([a-z0-9]{6})\b/i,
  // Spaced codes like  "a b c d e f"
  /\b([a-z0-9] [a-z0-9] [a-z0-9] [a-z0-9] [a-z0-9] [a-z0-9])\b/i,
  // Standalone 6-char alphanumeric block — last resort
  /\b([a-z0-9]{6})\b/i,
];

function extractCode(text: string): string | null {
  // Normalize all whitespace to simplify regex matching across lines
  const normalized = text.replace(/\s+/g, " ");

  // 1. Look for a 6-character code immediately following key instructions
  const nearCodeMatch = normalized.match(/(?:code below|registration code below|verification code)\s*:?\s*\b([a-z0-9]{6})\b/i);
  if (nearCodeMatch?.[1]) {
    const code = nearCodeMatch[1].toLowerCase();
    const exclude = ["please", "ignore", "delete", "thanks", "system", "client", "online", "report"];
    if (!exclude.includes(code)) {
      return code;
    }
  }

  // 2. Scan all 6-character alphanumeric blocks and look for one containing a digit (e.g. bh4965)
  // This avoids matching standard dictionary words like "please", "thanks", or "ignore"
  const matches = normalized.matchAll(/\b([a-z0-9]{6})\b/gi);
  for (const m of matches) {
    const code = m[1].toLowerCase();
    if (/\d/.test(code)) {
      const exclude = ["please", "ignore", "delete", "thanks", "system", "client", "online", "report"];
      if (!exclude.includes(code)) {
        return code;
      }
    }
  }

  // 3. Fallback to precompiled patterns (excluding common words)
  for (const pat of CODE_PATTERNS) {
    const m = text.match(pat);
    if (m?.[1]) {
      const code = m[1].replace(/\s/g, "").toLowerCase();
      const exclude = ["please", "ignore", "delete", "thanks", "system", "client", "online", "report"];
      if (code.length === 6 && !exclude.includes(code)) {
        return code;
      }
    }
  }
  return null;
}

/** Fetch the first active domain from mail.tm */
async function getMailTmDomain(): Promise<string> {
  try {
    const resp = await fetch("https://api.mail.tm/domains?page=1", {
      headers: { "Accept": "application/json" }
    });
    if (resp.status === 200) {
      const data = await resp.json() as any;
      const members: any[] = data["hydra:member"] || [];
      const active = members.find((d: any) => d.isActive);
      if (active?.domain) {
        console.log(`[MAIL.TM] Using domain: ${active.domain}`);
        return active.domain;
      }
    }
  } catch (e: any) {
    console.warn("[MAIL.TM] Could not fetch domains, falling back to web-library.net:", e.message);
  }
  return "web-library.net"; // fallback
}

async function precreateMailbox(email: string, pass: string): Promise<string | null> {
  const mailApiUrl = "https://api.mail.tm";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const createResp = await fetch(`${mailApiUrl}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: email, password: pass })
      });
      if (createResp.status === 429) {
        // Backoff on rate limit
        await new Promise(r => setTimeout(r, 2000));
      }
      const tokenResp = await fetch(`${mailApiUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: email, password: pass })
      });
      if (tokenResp.status === 429) {
        // Backoff on rate limit
        await new Promise(r => setTimeout(r, 2000));
      }
      if (tokenResp.status === 200) {
        const td = await tokenResp.json() as any;
        return td.token as string;
      }
      if (createResp.status === 201 || createResp.status === 422) {
        const tr = await fetch(`${mailApiUrl}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: email, password: pass })
        });
        if (tr.status === 429) {
          await new Promise(r => setTimeout(r, 2000));
        }
        if (tr.status === 200) {
          const td = await tr.json() as any;
          return td.token as string;
        }
      }
      console.warn(`[MAIL.TM PRECREATE] Attempt ${attempt} failed (create status: ${createResp.status}, token status: ${tokenResp.status}).`);
    } catch (err: any) {
      console.error(`[MAIL.TM PRECREATE] Attempt ${attempt} error for ${email}:`, err.message || err);
    }
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}


async function autoVerifyMailtm(
  email: string,
  pass: string,
  carxToken?: string,
  deviceId?: string,
  uniqueId?: string,
  preloadedMailToken?: string | null
): Promise<{ success: boolean; message: string; code?: string }> {
  const mailApiUrl = "https://api.mail.tm";
  const POLL_INITIAL_MS = 1500;  // wait 1.5s before first check — fastest safe start
  const POLL_INTERVAL_MS = 500;  // poll every 500ms for near-instant detection
  const MAX_ATTEMPTS = 120;      // 120 × 500ms = 60s total window to allow slow emails

  try {
    let mailToken = preloadedMailToken || null;

    if (!mailToken) {
      console.log(`[MAIL.TM] Setting up mailbox for ${email}...`);
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const [createResp, tokenResp] = await Promise.all([
            fetch(`${mailApiUrl}/accounts`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: email, password: pass })
            }),
            fetch(`${mailApiUrl}/token`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: email, password: pass })
            })
          ]);

          if (tokenResp.status === 200) {
            mailToken = ((await tokenResp.json()) as any).token;
          } else if (createResp.status === 201 || createResp.status === 422) {
            // Account created or already exists - get token
            const tr = await fetch(`${mailApiUrl}/token`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: email, password: pass })
            });
            if (tr.status === 200) {
              mailToken = ((await tr.json()) as any).token;
            }
          }

          if (mailToken) {
            break;
          }
          console.warn(`[MAIL.TM] Setup attempt ${attempt} failed (create status: ${createResp.status}, token status: ${tokenResp.status}).`);
        } catch (e: any) {
          console.warn(`[MAIL.TM] Setup attempt ${attempt} error: ${e.message}`);
        }
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      if (!mailToken) {
        return { success: false, message: "Failed to authenticate with mail.tm after 3 attempts." };
      }
    }

    const mailHeaders = { "Authorization": `Bearer ${mailToken}` };

    // Initial wait — give CarX time to send the email
    await new Promise(r => setTimeout(r, POLL_INITIAL_MS));

    console.log(`[MAIL.TM] Polling inbox for ${email} (every ${POLL_INTERVAL_MS}ms, up to ${MAX_ATTEMPTS} attempts = ${(MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000).toFixed(0)}s)...`);
    let verificationCode = "";

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      try {
        const listResp = await fetch(`${mailApiUrl}/messages`, { headers: mailHeaders });
        if (listResp.status !== 200) {
          console.warn(`[MAIL.TM] inbox list status ${listResp.status} on attempt ${attempt + 1}`);
          if (listResp.status === 429) {
            // Backoff on rate limit
            await new Promise(r => setTimeout(r, 2500));
          }
          continue;
        }

        const messages = ((await listResp.json()) as any)["hydra:member"] || [];
        if (messages.length === 0) continue;

        // Check all messages, not just the first, in case of ordering issues
        for (const msg of messages) {
          const msgResp = await fetch(`${mailApiUrl}/messages/${msg.id}`, { headers: mailHeaders });
          if (msgResp.status !== 200) continue;

          const msgData = await msgResp.json() as any;

          // Better HTML stripping: decode entities & strip tags
          const rawHtml: string = Array.isArray(msgData.html)
            ? msgData.html.join(" ")
            : (msgData.html || "");
          const strippedHtml = rawHtml
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&#\d+;/g, " ");

          const candidates = [
            msgData.text || "",
            strippedHtml,
            msg.subject || ""
          ];

          for (const candidate of candidates) {
            const code = extractCode(candidate);
            if (code) {
              verificationCode = code;
              console.log(`[MAIL.TM] ✅ Found code: ${code} (attempt ${attempt + 1}/${MAX_ATTEMPTS}, msg: ${msg.subject || msg.id})`);
              break;
            }
          }
          if (verificationCode) break;
        }

        if (verificationCode) break;
      } catch (pollErr: any) {
        console.warn(`[MAIL.TM] Poll attempt ${attempt + 1} error: ${pollErr.message}`);
        continue;
      }
    }

    if (!verificationCode) {
      return { success: false, message: `Verification email not received within ${(MAX_ATTEMPTS * POLL_INTERVAL_MS / 1000).toFixed(0)}s.` };
    }

    // Retry verify up to 3x on transient failure
    console.log(`[MAIL.TM] Submitting code '${verificationCode}' to CarX for ${email}...`);
    for (let vAttempt = 0; vAttempt < 3; vAttempt++) {
      const verifyResult = await CarXClient.verifyAccount(email, pass, verificationCode, carxToken, deviceId, uniqueId);
      if (verifyResult.success) {
        return { success: true, message: "Account successfully verified!", code: verificationCode };
      }
      if (vAttempt < 2) {
        console.log(`[MAIL.TM] Verify attempt ${vAttempt + 1} failed (${verifyResult.message}), retrying...`);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        return { success: false, message: verifyResult.message || "Failed to verify account on CarX." };
      }
    }

    return { success: false, message: "Verification failed after retries." };

  } catch (e: any) {
    return { success: false, message: e.message || "Error during mail.tm auto-verification" };
  }
}


function randomizePattern(pattern: string, isPassword = false) {
  const isPlaceholder = pattern.toLowerCase().includes("x");
  if (!isPlaceholder) {
    const suffix = crypto.randomBytes(3).toString("hex").substring(0, 6);
    if (isPassword) return pattern + suffix;
    if (pattern.includes("@")) {
      const parts = pattern.split("@");
      return `${parts[0]}${suffix}@${parts[1]}`;
    }
    return `${pattern}${suffix}@web-library.net`;
  }

  return pattern.split("").map(char => {
    if (char === 'x') {
      return "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
    }
    if (char === 'X') {
      return "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)];
    }
    return char;
  }).join("");
}

// Bulk generate account trigger
app.post(["/api/carx/bulk-generate", "/carx/bulk-generate"], authMiddleware, async (req, res) => {
  const { count, email_template, password, cash, gold, exp, get_all_cars, unlock_all, unlock_clubs, inject_bp, verify, unlock_profile_style } = req.body;
  const jobCount = count ? Math.min(30, Math.max(1, parseInt(count, 10))) : 5;

  let costPerAccount = 3; // base resource quantities cost 3
  if (get_all_cars) costPerAccount += 4;
  if (unlock_all || unlock_clubs) costPerAccount += 3;
  if (inject_bp) costPerAccount += 5;
  const totalCost = jobCount * costPerAccount;

  const role = (req as any).role;
  const licenseKey = (req as any).licenseKey;

  // 1. Verify bulk_generate feature and credit balance
  const check = await checkAndDeductCredit(licenseKey, role, "bulk_generate", totalCost);
  if (!check.success) {
    return res.status(check.message?.includes("Access Denied") ? 403 : 402).json({ success: false, message: check.message });
  }

  // 2. Deduct credits upfront
  if (role !== "owner" && licenseKey !== OWNER_KEY) {
    const db = check.db;
    const keyData = db.keys[licenseKey];
    if (keyData) {
      const currentCredits = getKeyCredits(keyData);
      if (currentCredits !== -1) {
        keyData.credits = Math.max(0, currentCredits - totalCost);
        delete keyData.tokens;
        if (keyData.credits === 0) {
          keyData.out_of_credits = true;
          delete keyData.out_of_tokens;
        }
      }
      db.total_credits_used = (db.total_credits_used || 0) + totalCost;
      await saveKeysDb(db);
      console.log(`[CREDITS] Deducted upfront ${totalCost} credits from key ${licenseKey} for bulk generation.`);
    }
  } else {
    // Owner is doing bulk generation. Update total credits used in keys database.
    const db = await loadKeysDb();
    db.total_credits_used = (db.total_credits_used || 0) + totalCost;
    await saveKeysDb(db);
  }

  const jobId = crypto.randomUUID();
  bulkJobs[jobId] = {
    status: "running",
    progress: 0,
    total: jobCount,
    logs: ["⚙️ Starting Bulk Generation process..."],
    results: []
  };

  // Run the background generation thread
  const job = bulkJobs[jobId];
  const cashParsed = parseResourceValue(cash, 0, MAX_CASH, "cash");
  if (!cashParsed.ok) {
    job.status = "cancelled";
    return res.status(400).json({ success: false, message: cashParsed.message });
  }
  const goldParsed = parseResourceValue(gold, 0, MAX_GOLD, "gold");
  if (!goldParsed.ok) {
    job.status = "cancelled";
    return res.status(400).json({ success: false, message: goldParsed.message });
  }
  const expParsed = parseResourceValue(exp, 1, MAX_EXP, "exp");
  if (!expParsed.ok) {
    job.status = "cancelled";
    return res.status(400).json({ success: false, message: expParsed.message });
  }
  const cashVal = cashParsed.value ?? MAX_CASH;
  const goldVal = goldParsed.value ?? MAX_GOLD;
  const expVal = expParsed.value ?? MAX_EXP;

  async function generateJobs() {
    let completedCount = 0;
    // Limit concurrency to 3 when email verification is on to prevent mail.tm 429 rate limit errors
    const CONCURRENCY = verify ? Math.min(3, jobCount) : Math.min(12, jobCount);
    const tasks = Array.from({ length: jobCount }, (_, i) => i);

    // Resolve the live mail.tm domain once for the whole job (only needed when verify is on)
    let activeDomain = "web-library.net";
    if (verify && (!email_template || email_template.endsWith("@web-library.net"))) {
      try {
        activeDomain = await getMailTmDomain();
        if (activeDomain !== "web-library.net") {
          job.logs.push(`📡 Using live mail.tm domain: @${activeDomain}`);
        }
      } catch { /* keep default */ }
    }

    async function worker() {
      while (tasks.length > 0 && job.status === "running") {
        const i = tasks.shift()!;
        
        // Resolve dynamic template domain based on verification state
        let effectiveTemplate = email_template;
        if (!effectiveTemplate) {
          effectiveTemplate = verify ? `carxmingxxxxxxx@${activeDomain}` : `carxmingxxxxxxx@carxming.com`;
        } else {
          // If not verifying, force default domains to carxming.com
          if (!verify && (effectiveTemplate.endsWith("@web-library.net") || (activeDomain && effectiveTemplate.endsWith(`@${activeDomain}`)) || effectiveTemplate.endsWith("@gmail.com"))) {
            effectiveTemplate = effectiveTemplate.split("@")[0] + "@carxming.com";
          }
        }
        const email = randomizePattern(effectiveTemplate);
        const pass = randomizePattern(password || "CARXMING", true);

        job.logs.push(`⚙️ [${i+1}/${jobCount}] Registering: ${email}`);

        // ⚡ PARALLEL: mailbox creation + CarX registration fire simultaneously
        // This eliminates the sequential delay — both complete in the time of the slower one
        let mailToken: string | null = null;
        let regRes: Awaited<ReturnType<typeof CarXClient.authenticate>>;

        if (verify) {
          const [mbToken, reg] = await Promise.all([
            precreateMailbox(email, pass),
            CarXClient.authenticate("register", email, pass)
          ]);
          mailToken = mbToken;
          regRes = reg;
          if (!mailToken) {
            job.logs.push(`  └─ ⚠️ Mailbox pre-create failed — autoVerify will retry internally`);
          }
        } else {
          regRes = await CarXClient.authenticate("register", email, pass);
        }

        try {
          if (!regRes.success) {
            job.logs.push(`  └─ ❌ Reg Failed for ${email}: ${regRes.message}`);
            job.results.push({ email, status: "failed", message: regRes.message });
            completedCount++;
            job.progress = Math.round((completedCount / jobCount) * 100);
            continue;
          }

          const token = regRes.token;
          const userId = regRes.userId;
          const deviceId = regRes.deviceId;
          const uniqueId = regRes.uniqueId;

          // Verify account if requested — mailToken already obtained in parallel above
          if (verify) {
            job.logs.push(`  └─ ⚡ Auto-verifying ${email} via mail.tm...`);
            const verifyRes = await autoVerifyMailtm(email, pass, token, deviceId, uniqueId, mailToken);
            if (verifyRes.success) {
              job.logs.push(`  └─ ✅ Verified! Code: ${verifyRes.code}`);
            } else {
              job.logs.push(`  └─ ⚠️ Verification failed: ${verifyRes.message}`);
            }
          }

          // Run BP verify and profile get in parallel
          const bpPromise = (inject_bp && token)
            ? (() => {
                job.logs.push(`  └─ 🎟 Verifying Premium StreetPass for ${email}...`);
                const bpObj = JSON.parse(STREETPASS_BODY);
                return CarXClient.verifyStreetPass(token, bpObj, deviceId, uniqueId);
              })()
            : Promise.resolve(false);

          const profilePromise = CarXClient.getProfile(token, userId, deviceId, uniqueId);

          const [bpOk, profileResult] = await Promise.all([bpPromise, profilePromise]);

          if (inject_bp) {
            job.logs.push(bpOk ? `  └─ 🎟 StreetPass Activated for ${email}!` : `  └─ ⚠️ StreetPass Failed/Timeout for ${email}`);
          }

          const { profile, response, isWrappedInD, isWrappedInData } = profileResult;
          const level = expVal >= 93060 ? 50 : 1;

          const profileMods: Parameters<typeof modifyProfile>[1] = {
            cash: cashVal,
            gold: goldVal,
            level,
            exp: expVal,
            unlock_clubs: unlock_clubs !== false,
            get_all_cars: get_all_cars !== false,
            unlock_houses: unlock_all !== false
          };

          if (unlock_profile_style !== false) {
            const randIdx = Math.floor(Math.random() * 16) + 1;
            profileMods.unlock_profile_style = true;
            profileMods.avatar = `avatar_${randIdx}`;
            profileMods.banner = `banner_${randIdx}`;
            profileMods.frame = `frame_${randIdx}`;
          }

          const modified = modifyProfile(profile || PROFILE_TEMPLATE, profileMods, userId);

          // Set quest completion
          if (unlock_all !== false || !profile) {
            modified.quests = PROFILE_TEMPLATE ? structuredClone(PROFILE_TEMPLATE.quests) : {};
          }

          // Upload Profile
          const upload = await CarXClient.uploadProfile(token, modified, userId, response, isWrappedInD, isWrappedInData, deviceId, uniqueId);
          if (upload.success) {
            job.logs.push(`  └─ ✅ Injected Profile [OK] for ${email}`);
            job.results.push({ email, password: pass, status: "success", user_id: userId });
          } else {
            const errText = upload.response ? await upload.response.text() : "No server response";
            job.logs.push(`  └─ ❌ Injection Failed for ${email}: ${errText}`);
            job.results.push({ email, status: "failed", message: errText });
          }
        } catch (e: any) {
          job.logs.push(`  └─ ❌ Error for ${email}: ${e.message || e}`);
          job.results.push({ email, status: "failed", message: e.message || "Exception error" });
        }

        completedCount++;
        job.progress = Math.round((completedCount / jobCount) * 100);
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, jobCount) }, () => worker());
    await Promise.all(workers);

    // Save generated count
    const successCount = job.results.filter(r => r.status === "success").length;
    if (successCount > 0) {
      try {
        const db = await loadKeysDb();
        db.total_accounts_generated = (db.total_accounts_generated || 0) + successCount;
        await saveKeysDb(db);
      } catch (err) {
        console.error("[TELEMETRY ERROR] Failed to save accounts count:", err);
      }
    }

    if (job.status === "cancelled") {
      job.logs.push("❌ Process terminated by user.");
    } else if (job.status === "running") {
      job.status = "completed";
      job.logs.push("🎉 Bulk generation completed successfully.");
    }
  }

  generateJobs();

  const remCredits = await getRemainingCreditsGlobal(licenseKey, role);
  res.json({ success: true, jobId, message: "Bulk generation started.", ...creditResponse(remCredits) });
});

// Check Bulk status
app.get(["/api/carx/bulk-status/:jobId", "/carx/bulk-status/:jobId"], authMiddleware, (req, res) => {
  const { jobId } = req.params;
  const job = bulkJobs[jobId];
  if (!job) {
    return res.status(404).json({ success: false, message: "Job not found or expired." });
  }
  res.json({ success: true, job });
});

// Terminate Bulk Job
app.post(["/api/carx/bulk-cancel/:jobId", "/carx/bulk-cancel/:jobId"], authMiddleware, (req, res) => {
  const { jobId } = req.params;
  const job = bulkJobs[jobId];
  if (!job) {
    return res.status(404).json({ success: false, message: "Job not found." });
  }
  job.status = "cancelled";
  res.json({ success: true, message: "Cancellation request received." });
});

// Server configuration for development vs production
// Keep alive function to prevent hosting services (like Render) from sleeping
function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || process.env.APP_URL;
  if (url) {
    console.log(`[Keep-Alive] Initializing self-ping 24h keep-alive for URL: ${url}`);
    // Ping every 5 minutes (300000 ms)
    setInterval(async () => {
      try {
        const res = await fetch(url);
        await res.text().catch(() => "");
        console.log(`[Keep-Alive] Self-ping successful: ${url} (Status: ${res.status})`);
      } catch (err: any) {
        console.error(`[Keep-Alive] Self-ping failed for ${url}:`, err.message || err);
      }
    }, 5 * 60 * 1000);
  } else {
    console.log("[Keep-Alive] No RENDER_EXTERNAL_URL or PUBLIC_URL defined. Self-ping inactive.");
  }
}

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Rymenbot Web Panel Server] Listening on http://0.0.0.0:${PORT}`);
    startKeepAlive();
  });
}

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  startServer();
}

export default app;
