-- Pocket schema (applied to Supabase project "Pocket", ref caixinoemxmoeudpqsuc, as migration init_schema)
-- Single-user app WITHOUT login (owner's choice): RLS is on, but the anon role has full access.
create table accounts (id uuid primary key default gen_random_uuid(), name text not null, currency text not null default 'ETB',
  opening_balance numeric not null default 0, color text not null default '#2dd4a7', archived boolean not null default false, created_at timestamptz not null default now());
create table categories (id uuid primary key default gen_random_uuid(), name text not null,
  kind text not null default 'expense' check (kind in ('expense','income')), icon text not null default '•', color text not null default '#94a3b8',
  budget numeric, created_at timestamptz not null default now());           -- budget = monthly limit in ETB
create table bills (id uuid primary key default gen_random_uuid(), name text not null,
  kind text not null default 'expense' check (kind in ('expense','income')), amount numeric not null, currency text not null default 'ETB',
  account_id uuid references accounts(id) on delete set null, category_id uuid references categories(id) on delete set null,
  day_of_month int not null default 1 check (day_of_month between 1 and 31), auto_add boolean not null default false,
  active boolean not null default true, created_at timestamptz not null default now());
create table transactions (id uuid primary key default gen_random_uuid(), date date not null default current_date,
  kind text not null check (kind in ('income','expense','transfer')), amount numeric not null check (amount >= 0),
  currency text not null default 'ETB', rate numeric not null default 1,   -- ETB per 1 unit, frozen at entry
  account_id uuid references accounts(id) on delete set null, to_account_id uuid references accounts(id) on delete set null,
  to_amount numeric, category_id uuid references categories(id) on delete set null, bill_id uuid references bills(id) on delete set null,
  note text not null default '', created_at timestamptz not null default now());
create table goals (id uuid primary key default gen_random_uuid(), name text not null, target numeric not null, saved numeric not null default 0,
  currency text not null default 'ETB', deadline date, color text not null default '#60a5fa', created_at timestamptz not null default now());
create table debts (id uuid primary key default gen_random_uuid(), person text not null, direction text not null check (direction in ('owed_to_me','i_owe')),
  amount numeric not null, paid numeric not null default 0, currency text not null default 'ETB', due date, note text not null default '',
  created_at timestamptz not null default now());
create table settings (key text primary key, value jsonb not null);  -- savings_pct, rate_overrides {USD:190}, currencies [..]
-- + indexes on transactions(date desc), (bill_id,date), FK columns; RLS policy "app access" for anon on every table; seed accounts/categories.
