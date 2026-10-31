#!/usr/bin/env node
/**
 * zcode-start-plan.js — включение ZCode Start-плана (Z.AI Weekend Build, ~500M токенов)
 * из Hermes Agent. Переносимая версия: пути резолвятся по платформе, ничего не захардкожено.
 *
 * Старт-план — это НЕ API-ключ, а entitlement OAuth-аккаунта:
 * провайдер `account:zai-start-plan`, модель ТОЛЬКО `glm-5.3-flash`.
 * Чтобы головной CLI ходил через него, нужно:
 *   1) model.main = "account:zai-start-plan/glm-5.3-flash" в ~/.zcode/cli/config.json
 *   2) дать CLI bundled provider config (иначе: "无法定位 CLI ZCode Built-in Provider Config")
 *      через env ZCODE_BUILTIN_PROVIDER_CONFIG_FILE — враппер это делает сам.
 *
 * Использование:
 *   node zcode-start-plan.js status   # показать текущий провайдер + остаток квоты
 *   node zcode-start-plan.js on       # переключить CLI на старт-план
 *   node zcode-start-plan.js off      # вернуть прежний конфиг (из бэкапа)
 *
 * Код возврата: 0 = ok, 2 = ошибка аргументов, 3 = нет OAuth-логина.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CFG = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
const CRED = path.join(os.homedir(), '.zcode', 'v2', 'credentials.json');

const START_PROVIDER = 'zai-start-plan';
const START_MODEL = 'glm-5.3-flash';
const START_MAIN = `account:${START_PROVIDER}/${START_MODEL}`;

/** Известные пути к bundled provider config по платформам. */
function builtinCandidates() {
  const envPath = (process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE || '').trim();
  const cands = envPath ? [envPath] : [];
  const rel = path.join('resources', 'config', 'provider', 'zcode-builtin.json');
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:/Program Files', 'C:/Program Files (x86)']) {
      if (base) cands.push(path.join(base, 'ZCode', rel));
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/ZCode.app/Contents/Resources/' + rel);
  } else {
    cands.push('/opt/ZCode/' + rel, '/usr/lib/zcode/' + rel);
  }
  return cands;
}

function resolveBuiltinConfig() {
  for (const c of builtinCandidates()) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

function resolveSecret() {
  const fromEnv = process.env.ZCODE_CREDENTIAL_SECRET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  let username = 'unknown';
  try { username = os.userInfo().username; } catch {}
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}

function decrypt(v) {
  if (!v.startsWith('enc:v1:')) return v;
  const body = v.slice('enc:v1:'.length);
  const [ivB64, tagB64, ctB64] = body.split('.');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  const key = crypto.createHash('sha256').update(resolveSecret()).digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function hasOAuth() {
  try {
    const rec = JSON.parse(fs.readFileSync(CRED, 'utf8'));
    return !!rec['oauth:zai:access_token'] && !!rec['zcodejwttoken'];
  } catch { return false; }
}

function backup() {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const bak = `${CFG}.bak-${ts}`;
  fs.writeFileSync(bak, fs.readFileSync(CFG));
  return bak;
}

function on() {
  if (!fs.existsSync(CFG)) {
    console.error(`[err] Нет ${CFG}. Сначала выполни /login в ZCode CLI или залогинься в десктопном ZCode.`);
    process.exit(3);
  }
  const bak = backup();
  const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  cfg.model = { main: START_MAIN };
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  const b = resolveBuiltinConfig();
  console.log(`[ok] CLI model.main -> ${START_MAIN}`);
  console.log(`[ok] backup: ${bak}`);
  console.log(`[env] builtin provider config: ${b || 'НЕ НАЙДЕН — задай ZCODE_BUILTIN_PROVIDER_CONFIG_FILE явно (без него CLI не стартует)'}`);
}

function newestBackup() {
  const dir = path.dirname(CFG);
  const baks = fs.readdirSync(dir)
    .filter(f => f.startsWith('config.json.bak-'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime); // самый свежий первым
  return baks[0]?.name || null;
}

function off() {
  const bak = newestBackup();
  if (!bak) { console.error('[err] Нет бэкапов для восстановления'); process.exit(1); }
  fs.copyFileSync(path.join(path.dirname(CFG), bak), CFG);
  console.log(`[ok] restored from ${bak}`);
}

function readEntitlementLocalStorage() {
  try {
    let ldbDir = null;
    if (process.env.APPDATA) ldbDir = path.join(process.env.APPDATA, 'ZCode', 'session', 'Local Storage', 'leveldb');
    if (!ldbDir || !fs.existsSync(ldbDir)) {
      const alt = path.join(os.homedir(), 'AppData', 'Roaming', 'ZCode', 'session', 'Local Storage', 'leveldb');
      if (fs.existsSync(alt)) ldbDir = alt;
    }
    if (!ldbDir) return null;
    const files = fs.readdirSync(ldbDir).filter(f => f.endsWith('.ldb'));
    let all = '';
    for (const f of files) all += fs.readFileSync(path.join(ldbDir, f)).toString('latin1');
    const i = all.indexOf('zcode:usage-entitlement:subscription-v2:account:zai-start-plan');
    if (i < 0) return null;
    const j = all.indexOf('"remaining"', i);
    const chunk = all.slice(j, j + 300);
    const count = chunk.match(/"count":(\d+)/);
    const next = chunk.match(/"nextResetTime":(\d+)/);
    const period = all.indexOf('"periodEnd":', i) >= 0
      ? all.slice(all.indexOf('"periodEnd":', i), all.indexOf('"periodEnd":', i) + 60).match(/"periodEnd":(\d+)/)
      : null;
    return {
      remaining: count ? Number(count[1]) : null,
      nextReset: next ? new Date(Number(next[1])).toISOString() : null,
      periodEnd: period ? new Date(Number(period[1])).toISOString() : null,
    };
  } catch { return null; }
}

/** Живая проверка активного Start-плана через billing/current (read-only GET). */
async function fetchBillingCurrent() {
  try {
    const rec = JSON.parse(fs.readFileSync(CRED, 'utf8'));
    const jwt = decrypt(rec['zcodejwttoken']);
    const r = await fetch('https://zcode.z.ai/api/v1/zcode-plan/billing/current', {
      headers: { Authorization: 'Bearer ' + jwt, 'content-type': 'application/json' },
      timeout: 15000,
    });
    const body = await r.json();
    if (body.code !== 0 || !body.data?.plans) return null;
    const plans = body.data.plans.filter(p => /start-plan/i.test(p.plan_id || '') || /start plan/i.test(p.name || ''));
    return plans.map(p => ({
      plan: p.plan_id,
      name: p.name,
      status: p.status,
      grantUnits: p.entitlements?.[0]?.grant_units ?? null,
      endsAt: p.ends_at ? new Date(p.ends_at * 1000).toISOString() : null,
    }));
  } catch { return null; }
}

async function status() {
  console.log('oauth login:', hasOAuth() ? 'есть' : 'НЕТ (нужен /login zai в ZCode CLI или логин в десктопном ZCode)');
  console.log('config:', fs.existsSync(CFG) ? CFG : 'нет (не инициализирован CLI)');
  if (fs.existsSync(CFG)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      console.log('model.main:', cfg.model?.main || '(не задан)');
      console.log('providers:', Object.keys(cfg.provider || {}).join(', ') || '(нет)');
    } catch (e) { console.log('config parse fail:', e.message); }
  }
  console.log('builtin provider config:', resolveBuiltinConfig() || 'НЕ НАЙДЕН (CLI не стартует без него в новых версиях)');

  const ent = readEntitlementLocalStorage();
  if (ent) {
    console.log('start-plan remaining (кэш десктопа):', ent.remaining != null ? ent.remaining.toLocaleString('en-US') : '?');
    if (ent.nextReset) console.log('next reset:', ent.nextReset);
    if (ent.periodEnd) console.log('period end:', ent.periodEnd);
  } else {
    console.log('start-plan entitlement: кэш не найден (десктоп не обновлял квоту — смотри живую проверку ниже)');
  }

  const live = await fetchBillingCurrent();
  if (live && live.length) {
    for (const p of live) {
      console.log(`start-plan (живой): ${p.plan} "${p.name}" status=${p.status} grant=${p.grantUnits != null ? p.grantUnits.toLocaleString('en-US') : '?'} ends=${p.endsAt || '?'}`);
    }
  } else {
    console.log('start-plan (живой): нет активного плана (billing/current не отдал start-plan)');
  }
}

const cmd = process.argv[2] || 'status';
if (cmd === 'on') { on(); process.exit(0); }
else if (cmd === 'off') { off(); process.exit(0); }
else if (cmd === 'status') { status().then(() => process.exit(0)); }
else { console.error('usage: node zcode-start-plan.js on|off|status'); process.exit(2); }