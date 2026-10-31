#!/usr/bin/env node
/**
 * zcode-delegate.js — делегирование задачи в ZCode CLI (Zhipu Z.AI) из Hermes Agent.
 * Переносимая версия враппера: пути к zcode.cjs и bundled provider config резолвятся
 * по платформе, ZCODE_BUILTIN_PROVIDER_CONFIG_FILE подставляется автоматически.
 *
 * Использование:
 *   node zcode-delegate.js "<промпт>" [--cwd DIR] [--mode MODE] [--attach FILE ...]
 *   node zcode-delegate.js "<промпт>" --plan start   # проверить, что активен старт-план
 *
 * Опции:
 *   --cwd DIR     рабочая директория, где агент может писать файлы (default: cwd)
 *   --mode MODE   build|edit|plan|yolo (default: yolo)
 *   --attach F    прикрепить файл к промпту (повторять)
 *   --timeout MS  лимит на весь запуск (default 900000 = 15 мин; реальные задачи >= 15 мин)
 *   --plan P      ожидаемый план: start | pro (default: любой). Если не совпадает — ошибка 5.
 *   --json        машинный вывод (default)
 *   --no-json     человекочитаемый вывод
 *
 * Код возврата: 0 = успех, 2 = аргументы, 3 = zcode.cjs не найден, 4 = doctor fail,
 *               5 = план не совпал, 124 = timeout.
 * При успехе stdout = JSON с полем `response`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_TIMEOUT = 900000; // 15 мин

/** Известные пути к zcode.cjs по платформам + env override. */
function zcodeCandidates() {
  const envPath = (process.env.ZCODE_CJS || '').trim();
  const cands = envPath ? [envPath] : [];
  if (process.platform === 'win32') {
    const rel = path.join('resources', 'glm', 'zcode.cjs');
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:/Program Files', 'C:/Program Files (x86)']) {
      if (base) cands.push(path.join(base, 'ZCode', rel));
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs');
  } else {
    cands.push('/opt/ZCode/resources/glm/zcode.cjs', '/usr/lib/zcode/zcode.cjs');
  }
  return cands;
}

function resolveZcodeCjs() {
  for (const c of zcodeCandidates()) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

function resolveBuiltinConfig() {
  const envPath = (process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE || '').trim();
  if (envPath) {
    try { if (fs.statSync(envPath).isFile()) return envPath; } catch {}
  }
  const rel = path.join('resources', 'config', 'provider', 'zcode-builtin.json');
  const bases = [];
  if (process.platform === 'win32') {
    for (const b of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:/Program Files', 'C:/Program Files (x86)']) {
      if (b) bases.push(path.join(b, 'ZCode'));
    }
  } else if (process.platform === 'darwin') {
    bases.push('/Applications/ZCode.app/Contents/Resources');
  } else {
    bases.push('/opt/ZCode', '/usr/lib/zcode');
  }
  for (const b of bases) {
    const p = path.join(b, rel);
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}

function readModelMain() {
  const cfgPath = path.join(os.homedir(), '.zcode', 'cli', 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return cfg.model?.main || null;
  } catch { return null; }
}

function parseArgs(argv) {
  const out = { prompt: null, cwd: process.cwd(), mode: 'yolo', attach: [], json: true, timeoutMs: DEFAULT_TIMEOUT, plan: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--cwd') out.cwd = rest.shift();
    else if (a === '--mode') out.mode = rest.shift();
    else if (a === '--attach') out.attach.push(rest.shift());
    else if (a === '--timeout') out.timeoutMs = Number(rest.shift());
    else if (a === '--plan') out.plan = rest.shift();
    else if (a === '--json') out.json = true;
    else if (a === '--no-json') out.json = false;
    else if (out.prompt === null) out.prompt = a;
    else throw new Error(`Неожиданный аргумент: ${a}`);
  }
  if (!out.prompt) throw new Error('Не передан промпт.');
  return out;
}

function delegate(opts, zcodeCjs, builtinConfig) {
  const args = [zcodeCjs, '-p', opts.prompt, '--cwd', opts.cwd, '--mode', opts.mode];
  if (opts.json) args.push('--json');
  for (const f of opts.attach) args.push('--attach', f);

  const env = { ...process.env };
  if (builtinConfig) env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE = builtinConfig;

  const r = spawnSync('node', args, {
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (r.error && r.error.code === 'ETIMEDOUT') {
    return { exitCode: 124, stdout: '', stderr: `Timeout after ${opts.timeoutMs}ms` };
  }
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`Ошибка аргументов: ${e.message}`); process.exit(2); }

  const zcodeCjs = resolveZcodeCjs();
  if (!zcodeCjs) {
    console.error('zcode.cjs не найден. Установи ZCode (desktop) или задай env ZCODE_CJS.');
    process.exit(3);
  }
  const builtin = resolveBuiltinConfig();
  if (!builtin) {
    console.error('bundled provider config не найден. Задай env ZCODE_BUILTIN_PROVIDER_CONFIG_FILE (см. zcode-start-plan.js status).');
    process.exit(3);
  }

  if (opts.plan) {
    const main = readModelMain();
    const wantStart = opts.plan === 'start';
    const isStart = !!main && main.startsWith('account:zai-start-plan');
    if (wantStart !== isStart) {
      console.error(`План не совпал: ожидается ${opts.plan}, а model.main = ${main || '(не задан)'}.`);
      console.error('Выполни: node zcode-start-plan.js on|off  (папка scripts этого скилла)');
      process.exit(5);
    }
  }

  // doctor
  const doc = spawnSync('node', [zcodeCjs, 'doctor'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, ...(builtin ? { ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtin } : {}) } });
  if (doc.status !== 0) {
    console.error(`ZCode CLI недоступен: ${doc.stderr || doc.stdout || 'exit ' + doc.status}`);
    process.exit(4);
  }

  const res = delegate(opts, zcodeCjs, builtin);
  if (res.exitCode === 0) {
    if (opts.json) {
      try {
        const j = JSON.parse(res.stdout);
        process.stdout.write(JSON.stringify({
          ok: true,
          response: j.response,
          sessionId: j.sessionId,
          traceId: j.traceId,
          usage: j.usage,
          builtinProviderConfig: builtin,
        }, null, 2));
        return 0;
      } catch {
        process.stdout.write(res.stdout);
        return 0;
      }
    }
    process.stdout.write(res.stdout);
    return 0;
  }
  if (res.exitCode === 124) { console.error('ZCode: timeout.'); return 124; }
  console.error(`ZCode failed (exit ${res.exitCode})`);
  if (res.stderr) console.error(res.stderr);
  if (res.stdout) console.error(res.stdout);
  return res.exitCode ?? 1;
}

process.exit(main());