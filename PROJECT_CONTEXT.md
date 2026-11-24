# PROJECT_CONTEXT — Pocket

**What**: personal money tracker for one person. Base currency Birr (ETB, "Br"). **No login** and **no accounts** (owner's explicit choice: keep it simple; don't add auth, accounts or transfers unless asked).

**Stack**: `index.html` + `styles.css` + `app.js` (ES module, no framework, no npm deps). Supabase REST via `fetch` (no SDK). Font: Instrument Sans (Google Fonts). Vercel static hosting.

**Hosting**: GitHub `dagitaw/pocket` (main) → Vercel project `pocket` (team dagitaw), auto-deploys on push. Live: https://pocket-flame-nine.vercel.app

**Supabase**: project `Pocket`, ref `caixinoemxmoeudpqsuc`. Tables: categories, bills, transactions, goals, debts, settings (key/jsonb). See `supabase/schema.sql`.

**Key rules in code**
- Transaction amount is in its own currency; `rate` = Birr per unit, frozen at entry. Birr value = amount × rate.
- `rate(cur)` = your rate (settings.rate_overrides) → official rate (open.er-api.com/v6/latest/ETB, localStorage cache 6h) → 1.
- Bill "paid" for a month = a transaction with that `bill_id` in that month. Auto bills insert on app load when due day ≤ today (current month only).
- Goals and debts are Birr only. Category `budget` = monthly limit in Birr.
- Settings keys: `savings_pct`, `rate_overrides` {CUR: number}, `currencies` [extra codes].
- UI: views in `V.<view>` (home, history, bills, goals, settings); clicks via `data-act` → `actions`; all forms in one `<dialog>` via `openForm`/`simpleForm`.

**Design**: light by default (follows system dark mode, toggle in Settings). Palette: paper #f2f4ef, ink #14211c, forest #1f5c46 (money in / primary), berry #b8325a (money out), amber #b7791f (near a limit). One loud element: the green "left this month" card on Home. Floating bottom nav with the + button inside it.

**Testing**: Playwright script (outside repo) covers add/edit entries, foreign currency + custom rates, limits, bills tick/untick/auto, goals, money owed, history filter/search, categories, CSV, mobile + dark screenshots. Test rows use a `TEST` prefix and are deleted after.

**Status (2026-11-25)**: v2 (simplified redesign) live.
**Ideas next**: CSV import of old Pocket data, missed auto-bills for past months.
