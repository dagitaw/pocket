# Pocket

A simple personal money tracker in Birr, with other currencies converted at live or your own rates. Plain HTML/CSS/JS (no build step, no npm dependencies), data in Supabase, hosted on Vercel.

## What it does
- **Home**: what's left this month, earned vs spent bar with your savings goal marker, spending pie by category with monthly limits (tap a category to set one), bills still to pay, recent entries
- **Add money in or out**: Spent / Earned, amount in any currency, category, date, note. Non-Birr amounts use your rate, or the official one, and keep that rate forever
- **History**: month list, Spent/Earned filter, search across all months
- **Bills**: monthly checklist; ticking a bill adds it to spending; bills can be added automatically on their due day
- **Goals**: savings goals with "save X a month" plan, plus money owed (lent/borrowed) with partial payments
- **Settings**: exchange rates, categories, savings goal %, dark mode, CSV download

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000

## Deploy
Vercel project `pocket`, auto-deploys on every push to `main`. Live: https://pocket-flame-nine.vercel.app

## Database
Supabase project **Pocket** (`caixinoemxmoeudpqsuc`, eu-central-1). Schema: `supabase/schema.sql`.
No login by design: the publishable key in `app.js` gives full access, so keep the site URL private.
