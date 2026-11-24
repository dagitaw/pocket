-- Pocket schema (Supabase project "Pocket", ref caixinoemxmoeudpqsuc). Migrations: init_schema, simplify_remove_accounts, drop_category_color.
-- Single-user app WITHOUT login (owner's choice): RLS is on, but the anon role has full access ("app access" policy on every table).
create table categories (id uuid primary key default gen_random_uuid(), name text not null,
  kind text not null default 'expense' check (kind in ('expense','income')), icon text not null default '•',
  budget numeric, created_at timestamptz not null default now());           -- budget = monthly limit in Birr
create table bills (id uuid primary key default gen_random_uuid(), name text not null, amount numeric not null,
  currency text not null default 'ETB', category_id uuid references categories(id) on delete set null,
  day_of_month int not null default 1 check (day_of_month between 1 and 31), auto_add boolean not null default false,
  active boolean not null default true, created_at timestamptz not null default now());
create table transactions (id uuid primary key default gen_random_uuid(), date date not null default current_date,
  kind text not null check (kind in ('income','expense')), amount numeric not null check (amount >= 0),
  currency text not null default 'ETB', rate numeric not null default 1,   -- Birr per 1 unit, frozen at entry
  category_id uuid references categories(id) on delete set null, bill_id uuid references bills(id) on delete set null,
  note text not null default '', created_at timestamptz not null default now());
create table goals (id uuid primary key default gen_random_uuid(), name text not null, target numeric not null,
  saved numeric not null default 0, deadline date, created_at timestamptz not null default now());          -- Birr
create table debts (id uuid primary key default gen_random_uuid(), person text not null,
  direction text not null check (direction in ('owed_to_me','i_owe')), amount numeric not null, paid numeric not null default 0,
  due date, note text not null default '', created_at timestamptz not null default now());                  -- Birr
create table settings (key text primary key, value jsonb not null);  -- savings_pct, rate_overrides {USD:190}, currencies [..]
