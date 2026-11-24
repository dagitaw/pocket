# PROJECT_CONTEXT — Pocket

**What**: personal money tracker (successor to the owner's old local "Pocket" app). Base currency ETB ("Br"). Single user, **no login** (owner's explicit choice — do not add auth unless asked).

**Stack**: `index.html` + `styles.css` + `app.js` (ES module, ~600 lines, no framework, no npm deps). Supabase REST via `fetch` (no SDK). Vercel static hosting.

**Supabase**: project `Pocket`, ref `caixinoemxmoeudpqsuc`, org `ktapkhabhtpjnyjqeijm`. Tables: accounts, categories, bills, transactions, goals, debts, settings (key/jsonb). See `supabase/schema.sql`.

**Key rules in code**
- Amounts are stored in the account's currency; `rate` = ETB per unit, frozen at entry. ETB value = amount × rate.
- `rate(cur)` = custom override (settings.rate_overrides) → live rate (open.er-api.com/v6/latest/ETB, localStorage cache 6h) → 1.
- Account balance = opening_balance + income − expense − transfers out + transfers in (`to_amount`).
- Bill "paid" for a month = a transaction with that `bill_id` in that month. Auto bills insert on app load when due day ≤ today (current month only).
- Settings keys: `savings_pct`, `rate_overrides` {CUR: number}, `currencies` [extra codes shown in rates table].
- UI: render functions in `V.<view>`; click actions via `data-act` → `actions`; forms via `openForm`/`simpleForm` in one `<dialog>`.

**Testing**: Playwright end-to-end script (kept outside repo) covers add/edit tx, multi-currency, transfers, balances, custom rates, budgets, bill tick/untick/auto, goals, debts, search, CSV, mobile layout; test rows use `TEST` prefix and are deleted after.

**Status (2026-11-24)**: v1 complete and deployed to Vercel. Not yet on GitHub (needs an empty repo created by the owner).
**Ideas next**: CSV import, receipts/photos, monthly report PDF, missed auto-bills for past months.
