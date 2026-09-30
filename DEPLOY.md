# Деплой - «Навпіл»

## Живий сайт
**https://navpil.vercel.app** - публічний (захист доступу вимкнено), працює.

## Де що
- **Хостинг:** Vercel, проєкт `navpil` (team `luka-da3c`, Hobby).
- **Репозиторій:** github.com/Luka-Hrachov/navpil (публічний), гілка `main`.
- **Фреймворк:** Next.js, корінь застосунку - тека `web/`.
- **Env на Vercel:** `GEMINI_API_KEY` виставлено для Production / Preview / Development.
  (Локальний `web/.env.local` НЕ їде в деплой - git його ігнорує.)

## Секрети (НЕ в репо)
- Gemini-ключ - у `web/.env.local` (gitignored) і в env Vercel.
- Vercel-токен - у `.vercel-token` у корені (gitignored).
- SSH deploy key - `~/.ssh/navpil_deploy` (приватний), публічний доданий на GitHub з write-доступом.

## Як передеплоїти
GitHub з Vercel НЕ звʼязаний автоматично (пуш у main деплой НЕ тригерить).
Деплой руками з CLI:
```
cd web
export VT=$(tr -d '\n' < ../.vercel-token)
npx vercel@latest deploy --prod --yes --token=$VT
```
Пуш коду на GitHub (лише версіювання):
```
git push origin main
```

## Правило
Деплой на прод - ЛИШЕ після явного «деплой» від Луки на кожну окрему зміну.
