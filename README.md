# Pocket — money tracker

A fast, single-user money tracker built in Birr (ETB) with multi-currency support. Plain HTML/CSS/JS (no build step, no dependencies), data in Supabase, hosted on Vercel.

## Features
- **Overview**: income, expenses, net, total balance across accounts, savings target, spending-by-category donut, 6-month income vs expenses chart, smart insights, accounts, bills, recent activity
- **Transactions**: expense / income / transfer between accounts; search, filter by type, category and account; all-months view; CSV export
- **Multi-currency**: every account has a currency; live rates (open.er-api.com, cached 6h) with **custom rate overrides** per currency (e.g. parallel-market USD) and a per-transaction rate field. Each transaction stores the rate used, so past months never change
- **Budgets**: monthly limit per category, progress bars, warnings, "use 3-month average" shortcut
- **Bills & recurring**: monthly checklist (tick → creates a transaction, untick → removes it), overdue flags, **auto** bills added on their due day
- **Savings goals**: target, deadline, add/withdraw, "save X per month" plan
- **Debts & loans**: owed to me / I owe, partial payments, overdue flags
- **Settings**: accounts, categories (emoji + colour), rates, savings %, dark/light theme
- Installable on phone (web manifest), mobile bottom nav

## Run locally
```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy
Static site — Vercel serves the folder as-is (no build command).

## Database
Supabase project **Pocket** (`caixinoemxmoeudpqsuc`, eu-central-1). Schema: `supabase/schema.sql`.
No login by design: the publishable key in `app.js` gives full access, so keep the site URL private.
