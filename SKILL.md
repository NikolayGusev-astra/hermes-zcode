---
name: zcode-start-plan
description: "Use when нужно использовать ZCode Start-план (Z.AI Weekend Build) из Hermes: переключение CLI с Pro на account-провайдер старт-плана (500M токенов, только glm-5.3-flash), резолв bundled provider config (иначе CLI падает с 无法定位), делегация задач с автозаголовками, чтение остатка квоты."
version: 1.0.0
author: Rin
license: MIT
platforms: [windows, macos, linux]
metadata:
  hermes:
    tags: [zcode, zhipu, start-plan, delegation, quota, windows]
---

# ZCode Start-план из Hermes

ZCode (Zhipu Z.AI) периодически начисляет Start-план (Weekend Build): примерно
300-500M токенов на аккаунт. Это entitlement OAuth-аккаунта, а не API-ключ:
ключ выпустить нельзя. Провайдер в конфиге CLI называется
`account:zai-start-plan`, модель одна, `glm-5.3-flash`. Скилл переключает CLI
на этот план, чинит запуск через env `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` и
делегирует задачи враппером.

## When to Use

- На аккаунте ZCode появился Start-план / Weekend Build и хочется гонять задачи, не тратя Pro-квоту.
- `zcode.cjs -p` падает с `无法定位 CLI ZCode Built-in Provider Config`. Это сломанный резолв после обновления.
- Нужно быстро проверить остаток токенов плана или переключиться обратно на Pro.

Не использовать для: обычной делегации на Pro-плане (там хватает `zcode-delegation`), выбора моделей, настройки MCP.

## Prerequisites

- Установлен ZCode (desktop или CLI), выполнен OAuth-логин (десктоп или `zcode login zai`). Без него нет `~/.zcode/v2/credentials.json`.
- Node.js в PATH (для запуска врапперов).
- План активен: период действия ограничен (обычно выходные), остаток смотри `status`.

## How to Run

Все вызовы через `terminal`. Путь к скриптам зависит от того, куда установлен скилл:
после установки обычно `~/.hermes/skills/zcode-start-plan/scripts/` (на Windows
`C:/Users/<пользователь>/.hermes/skills/...`). Проверить: найди папку
`zcode-start-plan` в дереве скиллов, там лежат `SKILL.md` и `scripts/`.

```bash
# 1. Статус: есть ли login, какой model.main, остаток квоты
node "~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js" status

# 2. Переключить CLI на старт-план (делает бэкап config.json)
node "~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js" on

# 3. Делегировать задачу (враппер сам выставит env и проверит план)
node "~/.hermes/skills/zcode-start-plan/scripts/zcode-delegate.js" \
  "Выполни задачу из attached файла. Работай только в C:/Work/target. После правок прогони syntax check." \
  --cwd C:/Work/target --mode yolo --attach C:/Work/brief.md --timeout 900000

# 4. Вернуть Pro (восстанавливает бэкап)
node "~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js" off
```

Тильда раскрывается оболочкой. В PowerShell замени `~` на
`$HOME` или полный путь.

## Quick Reference

```bash
node scripts/zcode-start-plan.js status   # login, model.main, остаток, builtin config
node scripts/zcode-start-plan.js on       # model.main -> account:zai-start-plan/glm-5.3-flash
node scripts/zcode-start-plan.js off      # откат из последнего бэкапа
node scripts/zcode-delegate.js "<prompt>" --cwd DIR --mode yolo --attach F --timeout 900000 [--plan start]
```

`scripts/` в командах означает папку `scripts` внутри установленного скилла
(см. How to Run, путь может отличаться).

## Procedure

1. **Проверь статус.** Если нет OAuth, сделай логин в десктопный ZCode или `zcode login zai` и повтори. `zcode-start-plan.js status` показывает login, model.main и остаток.
2. **Включи старт-план.** Команда `zcode-start-plan.js on` бэкапит `~/.zcode/cli/config.json` и ставит `model.main = account:zai-start-plan/glm-5.3-flash`.
3. **Делегируй.** `zcode-delegate.js` сам находит `zcode.cjs`, сам ставит `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` (без него CLI падает). С `--plan start` проверяет, что активен именно старт-план.
4. **Проверь результат, не верь self-report.** `git diff --stat`, `git status`, `node --check` или `py_compile`, grep заявленных символов. Чистый exit 0 не значит, что работа сделана.
5. **Верни Pro** после сессии: `zcode-start-plan.js off` восстанавливает бэкап config.json.
6. **Следи за остатком.** `status` показывает квоту. Когда план закончился или период истёк, переключайся обратно. Лимиты не ретраить.

## Pitfalls

- **Ключ старт-плана не существует.** `zcode-start-plan.js` не выпускает API-ключ. План работает только через account-провайдер OAuth. Попытка использовать `zai-coding-plan-api-key` с этим планом провалится.
- **`无法定位 CLI ZCode Built-in Provider Config`.** После обновления ZCode built-in конфиг переехал, и без env `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` CLI не стартует. Враппер `zcode-delegate.js` ставит env сам. Для ручного запуска `zcode.cjs` задавай env явно.
- **Модель одна.** Только `glm-5.3-flash`. Тяжёлые задачи (multi-hour) не для него. Длинные фазы могут замирать после финального отчёта: убей процесс и проверь файлы сам.
- **Расход.** Примерно 27K токенов на ход с системным промптом. Реальная задача на 2-4 млн токенов, значит на 500 млн хватит примерно на 150-200 задач.
- **Период ограничен.** Старт-план живёт в выходные. После `periodEnd` entitlement исчезает. Верни `off`, иначе останешься на плане, которого нет.
- **Не ретраить лимиты.** Ошибка `1310` означает исчерпанный лимит плана, а не перегрузку. Зафиксируй дату сброса и переключись на Pro или другой путь.

## Verification

- `zcode-start-plan.js status` показывает `model.main` и положительный `remaining` (число больше нуля).
- Микро-проба. `zcode.cjs -p "Reply with exactly: PROBE_OK" --cwd $HOME --mode yolo --json` возвращает exit 0 и `"response":"PROBE_OK"`.
- После `on` в `~/.zcode/cli/config.json` `model.main` начинается с `account:zai-start-plan`.
- После `off` `model.main` вернулся к прежнему значению (бэкап восстановлен).