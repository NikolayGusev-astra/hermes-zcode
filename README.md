# hermes-zcode

Скилл для Hermes Agent: использование ZCode Start-плана (Z.AI Weekend Build) из агента.

ZCode периодически начисляет на аккаунт старт-план на 300-500 млн токенов. Это
entitlement OAuth-аккаунта, а не API-ключ: ключ выпустить нельзя. Скилл
переключает CLI ZCode на account-провайдер старт-плана, чинит запуск через env
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` и делегирует задачи враппером, не тратя
Pro-квоту.

## Возможности

- `zcode-start-plan.js status` - вход в аккаунт, текущий `model.main`, остаток токенов. Берётся из кэша десктопа и живого запроса к billing.
- `zcode-start-plan.js on` - переключение CLI на старт-план (модель `glm-5.3-flash`), с бэкапом `config.json`.
- `zcode-start-plan.js off` - возврат прежнего конфига (Pro) из бэкапа.
- `zcode-delegate.js` - делегирование задачи в ZCode: сам находит `zcode.cjs`, сам ставит env, флаг `--plan start` проверяет активный план.

## Установка

1. Скопируй папку скилла в каталог скиллов твоего профиля Hermes:

   - Windows: `C:\Users\<имя>\.hermes\skills\zcode-start-plan\`
   - Linux/macOS: `~/.hermes/skills/zcode-start-plan/`

   Структура внутри:

   ```
   zcode-start-plan/
     SKILL.md
     scripts/
       zcode-start-plan.js
       zcode-delegate.js
   ```

2. Перезапусти Hermes (скилл подхватывается при старте сессии).
3. Проверь, что скилл виден: спроси агента про «ZCode Start-план» в списке скиллов.

## Требования

- ZCode установлен (desktop или CLI) и выполнен вход: десктопный ZCode или `zcode login zai`. Без входа нет `~/.zcode/v2/credentials.json`.
- Node.js в PATH.
- Активный старт-план: обычно раздаётся на выходные, остаток смотри `status`.

## Быстрый старт

```bash
# статус: вход, model.main, остаток токенов, наличие builtin provider config
node ~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js status

# включить старт-план (сделает бэкап config.json)
node ~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js on

# делегировать задачу (враппер сам найдёт zcode.cjs и поставит env)
node ~/.hermes/skills/zcode-start-plan/scripts/zcode-delegate.js \
  "Выполни задачу, работай только в C:/Work/target, после правок прогони проверку." \
  --cwd C:/Work/target --mode yolo --timeout 900000

# вернуть Pro
node ~/.hermes/skills/zcode-start-plan/scripts/zcode-start-plan.js off
```

PowerShell: вместо `~` используй `$HOME` или полный путь.

## Важно знать

- Старт-план это не API-ключ. Это право аккаунта, работает только через провайдер `account:zai-start-plan`, модель одна, `glm-5.3-flash`.
- Без env `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` CLI падает с «无法定位 CLI ZCode Built-in Provider Config». Враппер `zcode-delegate.js` ставит env сам.
- Период плана ограничен. Закончился, верни `off`, чтобы не остаться на несуществующем плане.
- Не доверяй отчёту агента «готово»: проверяй git diff, синтаксис и наличие заявленных изменений.

## Лицензия

MIT. Скилл написан для канала @hermesagentru. Если используешь в своих материалах, ссылайся на первоисточник.