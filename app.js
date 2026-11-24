// Pocket — single-page money tracker. Data lives in Supabase (REST, no SDK).
const SB_URL = 'https://caixinoemxmoeudpqsuc.supabase.co';
const SB_KEY = 'sb_publishable_hyYuYBDBDK8AAunk4xRPtA_NlxM-wWK';
const BASE = 'ETB';
const CURRENCIES = ['ETB', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CNY', 'KES', 'CAD', 'AUD', 'JPY', 'TRY', 'INR'];
const SYM = { ETB: 'Br ', USD: '$', EUR: '€', GBP: '£' };
const LIVE_TTL = 6 * 3600e3;

/* ---------- data layer ---------- */
async function api(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : null;
}
const db = {
  list: (t, q = '') => api(`${t}?select=*${q}`),
  insert: (t, row) => api(t, { method: 'POST', body: row }).then(r => r[0]),
  update: (t, id, patch) => api(`${t}?id=eq.${id}`, { method: 'PATCH', body: patch }).then(r => r[0]),
  remove: (t, id) => api(`${t}?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' }),
  setting: (key, value) => api('settings', { method: 'POST', body: { key, value }, prefer: 'resolution=merge-duplicates,return=minimal' }),
};
async function loadTx() {
  let all = [];
  for (let off = 0; ; off += 1000) {
    const rows = await db.list('transactions', `&order=date.desc,created_at.desc&limit=1000&offset=${off}`);
    all = all.concat(rows);
    if (rows.length < 1000) return all;
  }
}

/* ---------- state & helpers ---------- */
const today = () => new Date().toLocaleDateString('en-CA');
const S = {
  accounts: [], categories: [], bills: [], goals: [], debts: [], tx: [], settings: {},
  live: {}, liveAt: 0, month: today().slice(0, 7), view: 'overview',
  f: { q: '', kind: '', cat: '', acc: '', all: false },
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = v => Number.isFinite(+v) ? +v : 0;
const money = (n, cur = BASE) => (n < 0 ? '-' : '') + (SYM[cur] ?? cur + ' ') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = n => (n < 0 ? '-' : '') + (Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? Math.round(Math.abs(n) / 1e3) + 'k' : Math.round(Math.abs(n)));
const addMonth = (ym, d) => { const t = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const monthName = (ym, opt = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-US', opt);
const daysIn = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const niceDate = d => new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const byId = (list, id) => list.find(x => x.id === id);
const acc = id => byId(S.accounts, id);
const cat = id => byId(S.categories, id);
const accCur = id => acc(id)?.currency || BASE;

// Rates: ETB per 1 unit. Custom override beats live.
const overrides = () => S.settings.rate_overrides || {};
const liveRate = cur => cur === BASE ? 1 : S.live[cur] || 0;
const rate = cur => cur === BASE ? 1 : num(overrides()[cur]) || liveRate(cur) || 1;
const etb = t => num(t.amount) * num(t.rate || 1);

async function loadLive(force = false) {
  try {
    const c = JSON.parse(localStorage.getItem('pocket.live') || 'null');
    if (c && !force && Date.now() - c.at < LIVE_TTL) { S.live = c.rates; S.liveAt = c.at; return; }
    const d = await fetch('https://open.er-api.com/v6/latest/ETB').then(r => r.json());
    if (d.result !== 'success') throw new Error('rates');
    S.live = Object.fromEntries(Object.entries(d.rates).map(([k, v]) => [k, 1 / v]));
    S.liveAt = Date.now();
    localStorage.setItem('pocket.live', JSON.stringify({ rates: S.live, at: S.liveAt }));
  } catch {
    const c = JSON.parse(localStorage.getItem('pocket.live') || 'null');
    if (c) { S.live = c.rates; S.liveAt = c.at; }
    if (force) toast('Could not refresh live rates', true);
  }
}

let toastT;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 2600);
}
async function run(fn, ok) {
  try { await fn(); if (ok) toast(ok); render(); return true; }
  catch (e) { console.error(e); toast('Something went wrong: ' + e.message.slice(0, 80), true); return false; }
}

/* ---------- calculations ---------- */
const inMonth = (t, ym = S.month) => t.date.startsWith(ym);
function monthTotals(ym = S.month) {
  let income = 0, expense = 0;
  for (const t of S.tx) if (inMonth(t, ym)) { if (t.kind === 'income') income += etb(t); else if (t.kind === 'expense') expense += etb(t); }
  return { income, expense, net: income - expense };
}
function balance(a) {
  let b = num(a.opening_balance);
  for (const t of S.tx) {
    if (t.account_id === a.id) b += t.kind === 'income' ? num(t.amount) : -num(t.amount);
    if (t.kind === 'transfer' && t.to_account_id === a.id) b += num(t.to_amount ?? t.amount);
  }
  return b;
}
const netWorth = () => S.accounts.filter(a => !a.archived).reduce((s, a) => s + balance(a) * rate(a.currency), 0);
function spendByCat(ym = S.month) {
  const m = new Map();
  for (const t of S.tx) if (t.kind === 'expense' && inMonth(t, ym)) m.set(t.category_id, (m.get(t.category_id) || 0) + etb(t));
  return m;
}
const billTx = (b, ym = S.month) => S.tx.find(t => t.bill_id === b.id && inMonth(t, ym));
const dueDate = (b, ym = S.month) => `${ym}-${String(Math.min(b.day_of_month, daysIn(ym))).padStart(2, '0')}`;
const debtLeft = d => Math.max(num(d.amount) - num(d.paid), 0);

/* ---------- small render pieces ---------- */
const stat = (lbl, val, sub = '', cls = '') => `<div class="card stat"><div class="lbl">${lbl}</div><div class="val ${cls}">${val}</div><small>${sub}</small></div>`;
const progress = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.min(Math.max(pct, 0), 100).toFixed(1)}%"></i></div>`;
const catIcon = c => `<span class="ico" style="background:${esc(c?.color || '#94a3b8')}22;color:${esc(c?.color || '#94a3b8')}">${esc(c?.icon || '•')}</span>`;
const opts = (list, sel, label = x => x.name) => list.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const curOpts = sel => [...new Set([...CURRENCIES, sel].filter(Boolean))].map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');

function donut(items, total, label, value) {
  const r = 70, C = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map(it => {
    const len = total ? (it.value / total) * C : 0;
    const s = `<circle r="${r}" cx="90" cy="90" fill="none" stroke="${esc(it.color)}" stroke-width="22" stroke-dasharray="${Math.max(len - (items.length > 1 ? 1.5 : 0), 0)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${esc(it.name)}: ${money(it.value)}</title></circle>`;
    off += len; return s;
  }).join('');
  return `<svg class="donut" viewBox="0 0 180 180" role="img" aria-label="${esc(label)}">
    <circle r="${r}" cx="90" cy="90" fill="none" stroke="var(--track)" stroke-width="22"/>${segs}
    <text x="90" y="84" font-size="11" fill="var(--muted)" style="fill:var(--muted)">${esc(label)}</text>
    <text x="90" y="104" font-size="17" font-weight="700">${esc(value)}</text></svg>`;
}
function barsChart(months) {
  const W = 360, H = 170, pad = 22, max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));
  const gw = (W - 10) / months.length, bw = Math.min(16, gw / 3);
  const bars = months.map((m, i) => {
    const x = 5 + i * gw + gw / 2, hi = (m.income / max) * (H - pad - 10), he = (m.expense / max) * (H - pad - 10);
    return `<rect x="${x - bw - 1}" y="${H - pad - hi}" width="${bw}" height="${hi}" rx="3" fill="var(--accent)"><title>${m.label} income: ${money(m.income)}</title></rect>
      <rect x="${x + 1}" y="${H - pad - he}" width="${bw}" height="${he}" rx="3" fill="var(--red)"><title>${m.label} expenses: ${money(m.expense)}</title></rect>
      <text x="${x}" y="${H - 6}">${m.label}</text>`;
  }).join('');
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Income vs expenses, last 6 months">
    <line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" stroke="var(--line)"/>${bars}</svg>
    <div class="row" style="gap:16px;margin-top:6px"><small class="row" style="gap:6px"><span class="dot" style="background:var(--accent)"></span>Income</small><small class="row" style="gap:6px"><span class="dot" style="background:var(--red)"></span>Expenses</small></div>`;
}
function txRow(t) {
  const c = cat(t.category_id), a = acc(t.account_id), cur = t.currency || BASE;
  const isT = t.kind === 'transfer';
  const title = t.note || (isT ? 'Transfer' : c?.name || 'Uncategorized');
  const sub = isT ? `${esc(a?.name || '?')} → ${esc(acc(t.to_account_id)?.name || '?')}` : `${esc(c?.name || 'Uncategorized')} · ${esc(a?.name || 'No account')}`;
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '-' : '';
  const cls = t.kind === 'income' ? 'pos' : t.kind === 'expense' ? 'neg' : 'muted';
  const icon = isT ? `<span class="ico" style="background:var(--panel2)">⇄</span>` : catIcon(c);
  return `<div class="item click" data-act="edit-tx" data-id="${t.id}">${icon}
    <div class="main"><b>${esc(title)}</b><small>${sub}</small></div>
    <div class="amt ${cls}">${sign}${money(num(t.amount), cur)}${cur !== BASE ? `<small class="muted">≈ ${money(etb(t))} @ ${num(t.rate)}</small>` : ''}</div></div>`;
}
const empty = (msg, btn = '') => `<div class="empty">${msg}${btn ? `<div style="margin-top:12px">${btn}</div>` : ''}</div>`;

/* ---------- views ---------- */
const V = {};

V.overview = () => {
  const { income, expense, net } = monthTotals();
  const prev = monthTotals(addMonth(S.month, -1));
  const pct = num(S.settings.savings_pct ?? 20);
  const target = income * pct / 100;
  const spend = [...spendByCat()].map(([id, value]) => ({ ...(cat(id) || { name: 'Uncategorized', color: '#94a3b8' }), value })).sort((a, b) => b.value - a.value);
  const top = spend.slice(0, 7);
  if (spend.length > 7) top.push({ name: 'Others', color: '#64748b', value: spend.slice(7).reduce((s, x) => s + x.value, 0) });
  const months = Array.from({ length: 6 }, (_, i) => { const ym = addMonth(S.month, i - 5); return { ...monthTotals(ym), label: monthName(ym, { month: 'short' }) }; });

  // insights
  const ins = [];
  const isCur = S.month === today().slice(0, 7);
  if (income) {
    const rateSaved = net / income * 100;
    ins.push([rateSaved >= pct ? '🎯' : '⚠️', `You kept <b>${rateSaved.toFixed(0)}%</b> of income this month (target ${pct}%).`]);
  }
  if (spend[0]) ins.push(['📊', `Biggest spend: <b>${esc(spend[0].name)}</b> — ${(spend[0].value / expense * 100).toFixed(0)}% of expenses.`]);
  if (prev.expense) {
    const ch = (expense - prev.expense) / prev.expense * 100;
    ins.push([ch > 0 ? '📈' : '📉', `Spending is <b class="${ch > 0 ? 'neg' : 'pos'}">${ch > 0 ? '+' : ''}${ch.toFixed(0)}%</b> vs last month.`]);
  }
  if (isCur && expense) {
    const d = +today().slice(8), avg = expense / d;
    ins.push(['🗓️', `Daily average <b>${money(avg)}</b> → about <b>${money(avg * daysIn(S.month))}</b> by month end.`]);
  }
  const over = S.categories.filter(c => c.kind === 'expense' && num(c.budget) > 0 && (spendByCat().get(c.id) || 0) > num(c.budget));
  if (over.length) ins.push(['🚨', `Over budget: <b>${over.map(c => esc(c.name)).join(', ')}</b>.`]);
  const unpaid = S.bills.filter(b => b.active && b.kind === 'expense' && !billTx(b));
  if (unpaid.length) ins.push(['🧾', `${unpaid.length} bill${unpaid.length > 1 ? 's' : ''} still to pay: <b>${money(unpaid.reduce((s, b) => s + num(b.amount) * rate(b.currency), 0))}</b>.`]);
  if (!ins.length) ins.push(['✨', 'Add some transactions to see insights.']);

  const bills = S.bills.filter(b => b.active).sort((a, b) => !!billTx(a) - !!billTx(b) || a.day_of_month - b.day_of_month).slice(0, 6);
  const recent = S.tx.filter(t => inMonth(t)).slice(0, 6);

  return `<section class="stats">
      ${stat('Income', money(income), monthName(S.month, { month: 'long' }), 'pos')}
      ${stat('Expenses', money(expense), income ? `${(expense / income * 100).toFixed(0)}% of income` : '', 'neg')}
      ${stat('Net this month', money(net), net >= 0 ? 'Left over' : 'Overspent', net >= 0 ? '' : 'neg')}
      ${stat('Total balance', money(netWorth()), 'All accounts, today\'s rates')}
      ${stat(`Save ${pct}%`, money(target), income ? (net >= target ? 'On track 🎉' : `Short by ${money(target - net)}`) : 'No income yet', '')}
    </section>
    <div class="grid2">
      <div class="card"><h3>Spending by category</h3>
        ${spend.length ? `<div class="chart-wrap">${donut(top, expense, 'Spent', short(expense))}
          <ul class="legend">${top.map(x => `<li><span class="dot" style="background:${esc(x.color)}"></span><span>${esc(x.icon || '')} ${esc(x.name)}</span><span class="num">${money(x.value)}</span><small class="num" style="width:36px;text-align:right">${(x.value / expense * 100).toFixed(0)}%</small></li>`).join('')}</ul></div>`
          : empty('No expenses this month.')}
      </div>
      <div class="card"><h3>Income vs expenses · 6 months</h3>${barsChart(months)}</div>
    </div>
    <div class="grid3">
      <div class="card"><h3>Smart insights</h3><ul class="insights">${ins.map(([i, t]) => `<li><span>${i}</span><span>${t}</span></li>`).join('')}</ul></div>
      <div class="card"><div class="head" style="margin:0 0 12px"><h3>Accounts</h3><a href="#settings" class="muted" style="font-size:12px">Manage</a></div>
        <div class="list mini">${S.accounts.filter(a => !a.archived).map(a => { const b = balance(a); return `<div class="item"><span class="dot" style="background:${esc(a.color)}"></span><div class="main"><b>${esc(a.name)}</b></div><div class="amt ${b < 0 ? 'neg' : ''}">${money(b, a.currency)}${a.currency !== BASE ? `<small class="muted">≈ ${money(b * rate(a.currency))}</small>` : ''}</div></div>`; }).join('') || empty('No accounts')}</div></div>
      <div class="card"><div class="head" style="margin:0 0 12px"><h3>Bills this month</h3><a href="#bills" class="muted" style="font-size:12px">All bills</a></div>
        <div class="list mini">${bills.map(billRow).join('') || empty('No bills yet.')}</div></div>
    </div>
    <div class="head"><h3>Recent in ${monthName(S.month, { month: 'long' })}</h3><a href="#transactions" class="muted" style="font-size:12px">See all</a></div>
    <div class="list">${recent.map(txRow).join('') || empty('Nothing here yet.', '<button class="primary" data-act="add-tx">+ Add transaction</button>')}</div>`;
};

V.transactions = () => {
  const f = S.f, q = f.q.toLowerCase();
  const list = S.tx.filter(t => (f.all || inMonth(t)) && (!f.kind || t.kind === f.kind) && (!f.cat || t.category_id === f.cat)
    && (!f.acc || t.account_id === f.acc || t.to_account_id === f.acc)
    && (!q || `${t.note} ${cat(t.category_id)?.name || ''} ${acc(t.account_id)?.name || ''} ${t.amount}`.toLowerCase().includes(q)));
  let inc = 0, exp = 0;
  for (const t of list) t.kind === 'income' ? inc += etb(t) : t.kind === 'expense' ? exp += etb(t) : 0;
  const groups = {};
  for (const t of list) (groups[t.date] ||= []).push(t);
  return `<div class="head"><h2>Transactions</h2><small>${list.length} items · <span class="pos">+${money(inc)}</span> · <span class="neg">-${money(exp)}</span></small></div>
    <div class="filters">
      <input type="search" placeholder="Search notes, categories, amounts…" value="${esc(f.q)}" data-f="q">
      <select data-f="kind"><option value="">All types</option>${['expense', 'income', 'transfer'].map(k => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
      <select data-f="cat"><option value="">All categories</option>${opts(S.categories, f.cat)}</select>
      <select data-f="acc"><option value="">All accounts</option>${opts(S.accounts, f.acc)}</select>
      <label class="check"><input type="checkbox" data-f="all" ${f.all ? 'checked' : ''}> All months</label>
      <button data-act="export">Export CSV</button>
    </div>
    ${Object.entries(groups).map(([d, ts]) => {
      const dayNet = ts.reduce((s, t) => s + (t.kind === 'income' ? etb(t) : t.kind === 'expense' ? -etb(t) : 0), 0);
      return `<div class="day"><span>${niceDate(d)}</span><span class="${dayNet >= 0 ? 'pos' : 'neg'}">${money(dayNet)}</span></div><div class="list">${ts.map(txRow).join('')}</div>`;
    }).join('') || `<div style="margin-top:14px">${empty('No transactions match.', '<button class="primary" data-act="add-tx">+ Add transaction</button>')}</div>`}`;
};

V.budgets = () => {
  const spend = spendByCat();
  const cats = S.categories.filter(c => c.kind === 'expense');
  const totalB = cats.reduce((s, c) => s + num(c.budget), 0);
  const totalS = cats.filter(c => num(c.budget) > 0).reduce((s, c) => s + (spend.get(c.id) || 0), 0);
  const avg3 = id => [1, 2, 3].reduce((s, i) => s + (spendByCat(addMonth(S.month, -i)).get(id) || 0), 0) / 3;
  const isCur = S.month === today().slice(0, 7);
  const dayPct = isCur ? +today().slice(8) / daysIn(S.month) * 100 : 100;
  const card = c => {
    const b = num(c.budget), s = spend.get(c.id) || 0, p = b ? s / b * 100 : 0, a = avg3(c.id);
    const cls = !b ? '' : p > 100 ? 'over' : p > dayPct + 10 || p > 85 ? 'near' : '';
    return `<div class="card">
      <div class="row">${catIcon(c)}<div class="grow"><b>${esc(c.name)}</b><br><small>${b ? (p > 100 ? `<span class="neg">Over by ${money(s - b)}</span>` : `${money(b - s)} left`) : 'No limit set'}</small></div>
      <div style="text-align:right"><b class="num">${money(s)}</b><br><small>${b ? `of ${money(b)}` : ''}</small></div></div>
      ${b ? progress(p, cls) : '<div style="height:10px"></div>'}
      <div class="row" style="margin-top:6px"><input type="number" min="0" step="any" placeholder="Monthly limit (Br)" value="${b || ''}" data-budget="${c.id}">
      ${a ? `<button class="sm ghost" data-act="use-avg" data-id="${c.id}" data-v="${Math.round(a)}" title="Average of the last 3 months">Avg ${short(a)}</button>` : ''}</div></div>`;
  };
  return `<div class="head"><h2>Budgets · ${monthName(S.month)}</h2></div>
    <div class="card"><div class="split"><span>Spent of budgeted categories</span><span>${isCur ? `${dayPct.toFixed(0)}% of month gone` : ''}</span></div>
      <div class="row" style="margin-top:6px"><b style="font-size:22px" class="num">${money(totalS)}</b><span class="muted">of ${money(totalB)}</span></div>
      ${progress(totalB ? totalS / totalB * 100 : 0, totalS > totalB && totalB ? 'over' : '')}
      <small>Set a monthly limit for each category below. Limits are in Birr and repeat every month.</small></div>
    <div class="cards" style="margin-top:12px">${cats.sort((a, b) => (spend.get(b.id) || 0) - (spend.get(a.id) || 0)).map(card).join('')}</div>`;
};

function billRow(b) {
  const t = billTx(b), due = dueDate(b), late = !t && due < today();
  return `<div class="item ${t ? 'done' : ''}"><input type="checkbox" ${t ? 'checked' : ''} data-act="toggle-bill" data-id="${b.id}" aria-label="Mark ${esc(b.name)} paid">
    <div class="main"><b>${esc(b.name)}</b><small>${late ? '<span class="neg">Overdue · </span>' : ''}Due ${niceDate(due).replace(/^\w+, /, '')}${b.auto_add ? ' · auto' : ''}</small></div>
    <div class="amt ${b.kind === 'income' ? 'pos' : ''}">${money(num(b.amount), b.currency)}</div></div>`;
}
V.bills = () => {
  const bills = S.bills.filter(b => b.active).sort((a, b) => a.day_of_month - b.day_of_month);
  const exp = bills.filter(b => b.kind === 'expense');
  const paid = exp.filter(b => billTx(b));
  const left = exp.filter(b => !billTx(b)).reduce((s, b) => s + num(b.amount) * rate(b.currency), 0);
  const row = b => {
    const t = billTx(b), due = dueDate(b), late = !t && due < today(), c = cat(b.category_id);
    return `<div class="item ${t ? 'done' : ''}">
      <input type="checkbox" ${t ? 'checked' : ''} data-act="toggle-bill" data-id="${b.id}" aria-label="Mark ${esc(b.name)} paid">
      ${catIcon(c)}
      <div class="main"><b>${esc(b.name)}${b.auto_add ? '<span class="badge green">Auto</span>' : ''}${late ? '<span class="badge red">Overdue</span>' : ''}</b>
        <small>${b.kind === 'income' ? 'Income' : 'Pay'} on day ${b.day_of_month} · ${esc(acc(b.account_id)?.name || 'No account')}${t ? ` · done ${niceDate(t.date)}` : ''}</small></div>
      <div class="amt ${b.kind === 'income' ? 'pos' : ''}">${money(num(b.amount), b.currency)}${b.currency !== BASE ? `<small class="muted">≈ ${money(num(b.amount) * rate(b.currency))}</small>` : ''}</div>
      <div class="btns"><button class="sm ghost" data-act="edit-bill" data-id="${b.id}">Edit</button></div></div>`;
  };
  const off = S.bills.filter(b => !b.active);
  return `<div class="head"><h2>Bills & recurring · ${monthName(S.month)}</h2><button class="primary" data-act="edit-bill">+ New bill</button></div>
    <div class="card"><div class="split"><span>${paid.length} of ${exp.length} paid</span><span>${money(left)} left to pay</span></div>
      ${progress(exp.length ? paid.length / exp.length * 100 : 0)}
      <small>Tick a bill to record it as a transaction; untick to remove it. <b>Auto</b> bills are added for you on their due day.</small></div>
    <div class="list" style="margin-top:12px">${bills.map(row).join('') || empty('Add rent, editor payments, family support, subscriptions…', '<button class="primary" data-act="edit-bill">+ New bill</button>')}</div>
    ${off.length ? `<h2 class="muted" style="font-size:14px">Paused</h2><div class="list">${off.map(b => `<div class="item done"><div class="main"><b>${esc(b.name)}</b></div><button class="sm ghost" data-act="edit-bill" data-id="${b.id}">Edit</button></div>`).join('')}</div>` : ''}`;
};

V.goals = () => {
  const card = g => {
    const p = num(g.target) ? num(g.saved) / num(g.target) * 100 : 0, left = Math.max(num(g.target) - num(g.saved), 0);
    let plan = '';
    if (g.deadline && left > 0) {
      const now = new Date(), dl = new Date(g.deadline + 'T00:00');
      const months = Math.max((dl.getFullYear() - now.getFullYear()) * 12 + dl.getMonth() - now.getMonth(), 1);
      plan = dl < now ? '<span class="neg">Deadline passed</span>' : `Save <b>${money(left / months, g.currency)}</b>/month for ${months} month${months > 1 ? 's' : ''}`;
    }
    return `<div class="card">
      <div class="row"><span class="ico" style="background:${esc(g.color)}22;color:${esc(g.color)}">★</span><div class="grow"><b>${esc(g.name)}</b><br><small>${g.deadline ? 'By ' + new Date(g.deadline + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No deadline'}</small></div>
      <b class="num">${p.toFixed(0)}%</b></div>
      <div class="bar"><i style="width:${Math.min(p, 100)}%;background:${esc(g.color)}"></i></div>
      <div class="split"><span>${money(num(g.saved), g.currency)} saved</span><span>${p >= 100 ? '<span class="pos">Reached 🎉</span>' : `${money(left, g.currency)} to go`}</span></div>
      ${plan ? `<p class="hint" style="margin:10px 0 0">${plan}</p>` : ''}
      <div class="row" style="margin-top:12px"><button class="sm primary" data-act="goal-add" data-id="${g.id}">+ Add money</button><button class="sm" data-act="goal-add" data-id="${g.id}" data-neg="1">Withdraw</button><button class="sm ghost" data-act="edit-goal" data-id="${g.id}" style="margin-left:auto">Edit</button></div></div>`;
  };
  const total = S.goals.reduce((s, g) => s + num(g.saved) * rate(g.currency), 0);
  return `<div class="head"><h2>Savings goals</h2><button class="primary" data-act="edit-goal">+ New goal</button></div>
    ${S.goals.length ? `<p class="muted" style="margin-top:-4px">Saved across all goals: <b class="pos">${money(total)}</b></p><div class="cards">${S.goals.map(card).join('')}</div>` : empty('Create a goal — a new camera, an emergency fund, a trip…', '<button class="primary" data-act="edit-goal">+ New goal</button>')}`;
};

V.debts = () => {
  const open = S.debts.filter(d => debtLeft(d) > 0), done = S.debts.filter(d => debtLeft(d) <= 0);
  const sum = dir => open.filter(d => d.direction === dir).reduce((s, d) => s + debtLeft(d) * rate(d.currency), 0);
  const row = d => {
    const left = debtLeft(d), late = left > 0 && d.due && d.due < today();
    return `<div class="item ${left <= 0 ? 'done' : ''}">
      <span class="ico" style="background:var(--panel2)">${d.direction === 'owed_to_me' ? '↙' : '↗'}</span>
      <div class="main"><b>${esc(d.person)}${late ? '<span class="badge red">Overdue</span>' : ''}</b><small>${esc(d.note || (d.direction === 'owed_to_me' ? 'Owes you' : 'You owe'))}${d.due ? ' · due ' + niceDate(d.due) : ''}${num(d.paid) ? ` · ${money(num(d.paid), d.currency)} of ${money(num(d.amount), d.currency)} paid` : ''}</small></div>
      <div class="amt ${d.direction === 'owed_to_me' ? 'pos' : 'neg'}">${left > 0 ? money(left, d.currency) : 'Settled'}</div>
      <div class="btns">${left > 0 ? `<button class="sm" data-act="debt-pay" data-id="${d.id}">Payment</button>` : ''}<button class="sm ghost" data-act="edit-debt" data-id="${d.id}">Edit</button></div></div>`;
  };
  const owed = open.filter(d => d.direction === 'owed_to_me'), owe = open.filter(d => d.direction === 'i_owe');
  return `<div class="head"><h2>Debts & loans</h2><button class="primary" data-act="edit-debt">+ New</button></div>
    <div class="grid2" style="margin-top:0">${stat('People owe you', money(sum('owed_to_me')), `${owed.length} open`, 'pos')}${stat('You owe', money(sum('i_owe')), `${owe.length} open`, 'neg')}</div>
    <div class="grid2">
      <div><h2 style="font-size:14px">Owed to you</h2><div class="list">${owed.map(row).join('') || empty('Nobody owes you.')}</div></div>
      <div><h2 style="font-size:14px">You owe</h2><div class="list">${owe.map(row).join('') || empty('You don\'t owe anyone.')}</div></div>
    </div>
    ${done.length ? `<h2 class="muted" style="font-size:14px">Settled</h2><div class="list">${done.map(row).join('')}</div>` : ''}`;
};

V.settings = () => {
  const ov = overrides();
  const curs = [...new Set([...S.accounts.map(a => a.currency), 'USD', 'EUR', ...Object.keys(ov), ...(S.settings.currencies || []), ...S.goals.map(g => g.currency), ...S.debts.map(d => d.currency), ...S.bills.map(b => b.currency)])].filter(c => c !== BASE);
  const theme = document.documentElement.dataset.theme;
  return `<div class="head"><h2>Exchange rates</h2><button data-act="refresh-rates">↻ Refresh live rates</button></div>
    <div class="card"><table><thead><tr><th>Currency</th><th>Live (official)</th><th>Your rate</th><th class="hide-sm">Using</th></tr></thead><tbody>
      ${curs.map(c => `<tr><td><b>1 ${c}</b> =</td><td class="num muted">${liveRate(c) ? 'Br ' + liveRate(c).toFixed(2) : '—'}</td>
        <td><input type="number" min="0" step="any" placeholder="${liveRate(c) ? liveRate(c).toFixed(2) : 'Set rate'}" value="${ov[c] ?? ''}" data-rate="${c}"></td>
        <td class="hide-sm">${ov[c] ? '<span class="badge green">Custom</span>' : liveRate(c) ? '<span class="badge">Live</span>' : '<span class="badge red">Missing</span>'}</td></tr>`).join('')}
    </tbody></table>
    <div class="row wrapit" style="margin-top:12px"><select id="add-cur" style="max-width:140px">${CURRENCIES.filter(c => c !== BASE && !curs.includes(c)).map(c => `<option>${c}</option>`).join('')}</select><button class="sm" data-act="add-cur">Add currency</button></div>
    <p class="hint" style="margin-top:12px">Live rates ${S.liveAt ? 'updated ' + new Date(S.liveAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'unavailable'}. Leave "Your rate" empty to use the live rate. Each transaction keeps the rate it was saved with, so changing a rate here doesn't rewrite past months.</p></div>

    <div class="head"><h2>Accounts</h2><button class="primary" data-act="edit-acc">+ New account</button></div>
    <div class="list">${S.accounts.map(a => { const b = balance(a); return `<div class="item ${a.archived ? 'done' : ''}"><span class="dot" style="background:${esc(a.color)}"></span><div class="main"><b>${esc(a.name)}</b><small>${a.currency}${a.archived ? ' · hidden' : ''}</small></div><div class="amt">${money(b, a.currency)}${a.currency !== BASE ? `<small class="muted">≈ ${money(b * rate(a.currency))}</small>` : ''}</div><button class="sm ghost" data-act="edit-acc" data-id="${a.id}">Edit</button></div>`; }).join('')}</div>

    <div class="head"><h2>Categories</h2><button class="primary" data-act="edit-cat">+ New category</button></div>
    <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">${S.categories.map(c => `<div class="item click" data-act="edit-cat" data-id="${c.id}">${catIcon(c)}<div class="main"><b>${esc(c.name)}</b><small>${c.kind}</small></div></div>`).join('')}</div>

    <div class="head"><h2>General</h2></div>
    <div class="card"><div class="row wrapit">
      <label style="width:180px">Savings target (%)<input type="number" min="0" max="100" value="${num(S.settings.savings_pct ?? 20)}" data-setting="savings_pct"></label>
      <label style="width:180px">Theme<select data-theme-sel><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Light</option></select></label>
      <div class="grow"></div><button data-act="export">Export all transactions (CSV)</button></div></div>`;
};

/* ---------- forms ---------- */
const dlg = $('#modal'), form = $('#modal-form');
let onSave = null, onDelete = null;
function openForm(html, save, del) {
  form.innerHTML = `${html}<div class="actions">${del ? '<button type="button" class="danger" data-act="del">Delete</button>' : ''}<button type="button" value="cancel" data-act="close">Cancel</button><button class="primary" value="ok">Save</button></div>`;
  onSave = save; onDelete = del; form.oninput = null; dlg.showModal();
  form.querySelector('input:not([type=radio]):not([type=hidden])')?.focus();
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('.primary'); btn.disabled = true;
  if (await run(() => onSave(fd), 'Saved')) dlg.close();
  btn.disabled = false;
});

function txForm(t = {}) {
  const kind = t.kind || 'expense';
  const accs = S.accounts.filter(a => !a.archived || a.id === t.account_id || a.id === t.to_account_id);
  const accId = t.account_id || accs[0]?.id;
  openForm(`<h3>${t.id ? 'Edit' : 'New'} transaction</h3>
    <div class="seg">${['expense', 'income', 'transfer'].map(k => `<input type="radio" name="kind" id="k-${k}" value="${k}" ${k === kind ? 'checked' : ''}><label for="k-${k}">${k[0].toUpperCase() + k.slice(1)}</label>`).join('')}</div>
    <div class="two"><label><span>Amount <span id="cur-lbl"></span></span><input name="amount" type="number" step="any" min="0" required value="${t.amount ?? ''}" inputmode="decimal"></label>
      <label>Date<input name="date" type="date" required value="${t.date || (inMonth({ date: today() }) ? today() : S.month + '-01')}"></label></div>
    <div class="two"><label><span id="acc-lbl">Account</span><select name="account_id" required>${opts(accs, accId, a => `${a.name} (${a.currency})`)}</select></label>
      <label data-for="cat">Category<select name="category_id"></select></label>
      <label data-for="transfer">To account<select name="to_account_id">${opts(accs, t.to_account_id || accs.find(a => a.id !== accId)?.id, a => `${a.name} (${a.currency})`)}</select></label></div>
    <label data-for="toamt"><span>Amount received <span id="to-cur"></span></span><input name="to_amount" type="number" step="any" min="0" value="${t.to_amount ?? ''}"></label>
    <label data-for="rate"><span>Rate: 1 <span id="rate-cur"></span> = ? Br</span><input name="rate" type="number" step="any" min="0" value="${t.rate ?? ''}"></label>
    <p class="hint" data-for="rate" id="rate-hint"></p>
    <label>Note<input name="note" maxlength="200" value="${esc(t.note || '')}" placeholder="e.g. Editor payment, groceries…"></label>`,
    async fd => {
      const cur = accCur(fd.account_id);
      if (fd.kind === 'transfer' && fd.account_id === fd.to_account_id) throw new Error('Pick two different accounts');
      const row = {
        kind: fd.kind, amount: num(fd.amount), date: fd.date, note: fd.note.trim(), account_id: fd.account_id || null, currency: cur,
        rate: cur === BASE ? 1 : num(fd.rate) || rate(cur),
        category_id: fd.kind === 'transfer' ? null : fd.category_id || null,
        to_account_id: fd.kind === 'transfer' ? fd.to_account_id : null,
        to_amount: fd.kind === 'transfer' ? (fd.to_amount ? num(fd.to_amount) : num(fd.amount) * rate(cur) / rate(accCur(fd.to_account_id))) : null,
      };
      const saved = t.id ? await db.update('transactions', t.id, row) : await db.insert('transactions', row);
      S.tx = [saved, ...S.tx.filter(x => x.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    },
    t.id && (async () => { await db.remove('transactions', t.id); S.tx = S.tx.filter(x => x.id !== t.id); }));
  let lastKind = null;
  const sync = () => {
    const k = form.kind.value, cur = accCur(form.account_id.value), toCur = accCur(form.to_account_id.value);
    if (k !== lastKind && k !== 'transfer') {
      const keep = form.category_id.value || t.category_id;
      form.category_id.innerHTML = `<option value="">Uncategorized</option>` + opts(S.categories.filter(c => c.kind === k), keep, c => `${c.icon} ${c.name}`);
    }
    lastKind = k;
    const show = (sel, on) => form.querySelectorAll(`[data-for="${sel}"]`).forEach(el => (el.hidden = !on));
    show('cat', k !== 'transfer'); show('transfer', k === 'transfer');
    show('toamt', k === 'transfer' && cur !== toCur); show('rate', cur !== BASE);
    $('#acc-lbl').textContent = k === 'transfer' ? 'From account' : 'Account';
    $('#cur-lbl').textContent = `(${cur})`; $('#rate-cur').textContent = cur; $('#to-cur').textContent = `(${toCur})`;
    if (cur !== BASE) {
      form.rate.placeholder = rate(cur);
      $('#rate-hint').textContent = `Using ${overrides()[cur] ? 'your custom' : 'the live'} rate ${rate(cur)} if left empty${form.amount.value ? ` → ${money(num(form.amount.value) * (num(form.rate.value) || rate(cur)))}` : ''}.`;
    }
    form.to_amount.placeholder = (num(form.amount.value) * rate(cur) / rate(toCur)).toFixed(2);
  };
  form.oninput = sync; sync();
}

function simpleForm(title, fields, item, table, listKey, extraDel = true) {
  openForm(`<h3>${item?.id ? 'Edit' : 'New'} ${title}</h3>${fields}`,
    async fd => {
      const row = {};
      for (const [k, v] of Object.entries(fd)) row[k] = v === '' && form.elements[k]?.type !== 'text' ? null : v;
      form.querySelectorAll('input[type=checkbox][name]').forEach(cb => (row[cb.name] = cb.checked));
      form.querySelectorAll('input[type=number][name]').forEach(n => (row[n.name] = n.value === '' ? null : num(n.value)));
      const saved = item?.id ? await db.update(table, item.id, row) : await db.insert(table, row);
      S[listKey] = item?.id ? S[listKey].map(x => (x.id === saved.id ? saved : x)) : [...S[listKey], saved];
    },
    item?.id && extraDel && (async () => { await db.remove(table, item.id); S[listKey] = S[listKey].filter(x => x.id !== item.id); }));
}

const billForm = (b = {}) => {
  simpleForm('bill', `
    <div class="seg"><input type="radio" name="kind" id="bk-e" value="expense" ${b.kind !== 'income' ? 'checked' : ''}><label for="bk-e">Bill / payment</label><input type="radio" name="kind" id="bk-i" value="income" ${b.kind === 'income' ? 'checked' : ''}><label for="bk-i">Recurring income</label></div>
    <label>Name<input name="name" required maxlength="80" value="${esc(b.name || '')}" placeholder="e.g. Rent, Editor salary, Netflix"></label>
    <div class="two"><label>Amount<input name="amount" type="number" step="any" min="0" required value="${b.amount ?? ''}"></label>
      <label>Day of month<input name="day_of_month" type="number" min="1" max="31" required value="${b.day_of_month ?? 1}"></label></div>
    <div class="two"><label>Account<select name="account_id" required>${opts(S.accounts.filter(a => !a.archived || a.id === b.account_id), b.account_id, a => `${a.name} (${a.currency})`)}</select></label>
      <label>Category<select name="category_id"><option value="">Uncategorized</option>${opts(S.categories, b.category_id, c => `${c.icon} ${c.name}`)}</select></label></div>
    <label class="check"><input type="checkbox" name="auto_add" ${b.auto_add ? 'checked' : ''}> Add automatically on the due day (recurring)</label>
    <label class="check"><input type="checkbox" name="active" ${b.active !== false ? 'checked' : ''}> Active</label>`, b, 'bills', 'bills');
  const prevSave = onSave;
  onSave = fd => prevSave({ ...fd, currency: accCur(fd.account_id) });
};
const goalForm = (g = {}) => simpleForm('goal', `
    <label>Name<input name="name" required maxlength="80" value="${esc(g.name || '')}" placeholder="e.g. New camera, Emergency fund"></label>
    <div class="two"><label>Target<input name="target" type="number" step="any" min="0" required value="${g.target ?? ''}"></label>
      <label>Currency<select name="currency">${curOpts(g.currency || BASE)}</select></label></div>
    <div class="two"><label>Already saved<input name="saved" type="number" step="any" min="0" value="${g.saved ?? 0}"></label>
      <label>Deadline (optional)<input name="deadline" type="date" value="${g.deadline || ''}"></label></div>
    <label>Color<input name="color" type="color" value="${g.color || '#60a5fa'}"></label>`, g, 'goals', 'goals');
const debtForm = (d = {}) => simpleForm('debt', `
    <div class="seg"><input type="radio" name="direction" id="d-o" value="owed_to_me" ${d.direction !== 'i_owe' ? 'checked' : ''}><label for="d-o">They owe me</label><input type="radio" name="direction" id="d-i" value="i_owe" ${d.direction === 'i_owe' ? 'checked' : ''}><label for="d-i">I owe them</label></div>
    <label>Person<input name="person" required maxlength="80" value="${esc(d.person || '')}"></label>
    <div class="two"><label>Amount<input name="amount" type="number" step="any" min="0" required value="${d.amount ?? ''}"></label>
      <label>Currency<select name="currency">${curOpts(d.currency || BASE)}</select></label></div>
    <div class="two"><label>Already paid<input name="paid" type="number" step="any" min="0" value="${d.paid ?? 0}"></label>
      <label>Due (optional)<input name="due" type="date" value="${d.due || ''}"></label></div>
    <label>Note<input name="note" maxlength="200" value="${esc(d.note || '')}"></label>`, d, 'debts', 'debts');
const accForm = (a = {}) => {
  const used = a.id && S.tx.some(t => t.account_id === a.id || t.to_account_id === a.id);
  simpleForm('account', `
    <label>Name<input name="name" required maxlength="60" value="${esc(a.name || '')}" placeholder="e.g. Telebirr, CBE, PayPal"></label>
    <div class="two"><label>Currency<select name="currency" ${used ? 'disabled' : ''}>${curOpts(a.currency || BASE)}</select></label>
      <label>Starting balance<input name="opening_balance" type="number" step="any" value="${a.opening_balance ?? 0}"></label></div>
    ${used ? '<p class="hint">Currency is locked because this account has transactions.</p>' : ''}
    <label>Color<input name="color" type="color" value="${a.color || '#2dd4a7'}"></label>
    <label class="check"><input type="checkbox" name="archived" ${a.archived ? 'checked' : ''}> Hide from overview & forms</label>`, a, 'accounts', 'accounts', !used);
};
const catForm = (c = {}) => simpleForm('category', `
    <div class="seg"><input type="radio" name="kind" id="c-e" value="expense" ${c.kind !== 'income' ? 'checked' : ''}><label for="c-e">Expense</label><input type="radio" name="kind" id="c-i" value="income" ${c.kind === 'income' ? 'checked' : ''}><label for="c-i">Income</label></div>
    <div class="two"><label>Name<input name="name" required maxlength="40" value="${esc(c.name || '')}"></label>
      <label>Icon (emoji)<input name="icon" maxlength="4" value="${esc(c.icon || '•')}"></label></div>
    <label>Color<input name="color" type="color" value="${c.color || '#94a3b8'}"></label>`, c, 'categories', 'categories');

function amountPrompt(title, max, cb) {
  openForm(`<h3>${esc(title)}</h3><label>Amount<input name="v" type="number" step="any" min="0" required ${max ? `max="${max}"` : ''}></label>`, fd => cb(num(fd.v)));
}

/* ---------- actions ---------- */
const actions = {
  'add-tx': () => txForm(),
  'edit-tx': el => txForm(byId(S.tx, el.dataset.id)),
  month: el => { S.month = +el.dataset.d ? addMonth(S.month, +el.dataset.d) : today().slice(0, 7); render(); },
  close: () => dlg.close(),
  del: async () => { if (onDelete && confirm('Delete this permanently?') && await run(onDelete, 'Deleted')) dlg.close(); },
  'edit-bill': el => billForm(byId(S.bills, el.dataset.id)),
  'edit-goal': el => goalForm(byId(S.goals, el.dataset.id)),
  'edit-debt': el => debtForm(byId(S.debts, el.dataset.id)),
  'edit-acc': el => accForm(byId(S.accounts, el.dataset.id)),
  'edit-cat': el => catForm(byId(S.categories, el.dataset.id)),
  'toggle-bill': el => toggleBill(byId(S.bills, el.dataset.id)),
  'goal-add': el => {
    const g = byId(S.goals, el.dataset.id), neg = !!el.dataset.neg;
    amountPrompt(`${neg ? 'Withdraw from' : 'Add to'} “${g.name}” (${g.currency})`, neg ? g.saved : 0, async v => {
      const saved = await db.update('goals', g.id, { saved: Math.max(num(g.saved) + (neg ? -v : v), 0) });
      S.goals = S.goals.map(x => (x.id === g.id ? saved : x));
    });
  },
  'debt-pay': el => {
    const d = byId(S.debts, el.dataset.id);
    amountPrompt(`Payment ${d.direction === 'owed_to_me' ? 'from' : 'to'} ${d.person} (${d.currency})`, debtLeft(d), async v => {
      const saved = await db.update('debts', d.id, { paid: num(d.paid) + v });
      S.debts = S.debts.map(x => (x.id === d.id ? saved : x));
    });
  },
  'use-avg': el => saveBudget(el.dataset.id, el.dataset.v),
  'refresh-rates': async () => { await loadLive(true); render(); toast('Rates updated'); },
  'add-cur': () => { const c = $('#add-cur').value; if (c) addCurrency(c); },
  export: exportCsv,
};

async function toggleBill(b) {
  const t = billTx(b);
  if (t) return run(async () => { await db.remove('transactions', t.id); S.tx = S.tx.filter(x => x.id !== t.id); }, 'Unmarked');
  const date = S.month === today().slice(0, 7) ? today() : dueDate(b);
  await run(async () => { S.tx.unshift(await db.insert('transactions', billToTx(b, date))); S.tx.sort((a, b) => b.date.localeCompare(a.date)); }, `${b.name} recorded`);
}
const billToTx = (b, date) => ({
  kind: b.kind, amount: num(b.amount), currency: b.currency, rate: rate(b.currency), date, note: b.name,
  account_id: b.account_id, category_id: b.category_id, bill_id: b.id,
});
async function autoBills() {
  const ym = today().slice(0, 7), d = +today().slice(8);
  const due = S.bills.filter(b => b.active && b.auto_add && Math.min(b.day_of_month, daysIn(ym)) <= d && !billTx(b, ym));
  for (const b of due) S.tx.push(await db.insert('transactions', billToTx(b, dueDate(b, ym))));
  if (due.length) { S.tx.sort((a, b) => b.date.localeCompare(a.date)); toast(`Added ${due.length} recurring item${due.length > 1 ? 's' : ''}`); }
}
const saveBudget = (id, v) => run(async () => {
  const saved = await db.update('categories', id, { budget: v === '' ? null : num(v) });
  S.categories = S.categories.map(c => (c.id === id ? saved : c));
}, 'Budget saved');
const saveRate = (cur, v) => run(async () => {
  const ov = { ...overrides() };
  if (v === '' || !num(v)) delete ov[cur]; else ov[cur] = num(v);
  await db.setting('rate_overrides', ov); S.settings.rate_overrides = ov;
}, v === '' ? 'Using live rate' : 'Rate saved');
const addCurrency = cur => run(async () => {
  const list = [...new Set([...(S.settings.currencies || []), cur])];
  await db.setting('currencies', list); S.settings.currencies = list;
}, `${cur} added`);

function exportCsv() {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'type', 'amount', 'currency', 'rate', 'amount_etb', 'account', 'to_account', 'category', 'note'],
    ...S.tx.map(t => [t.date, t.kind, t.amount, t.currency, t.rate, etb(t).toFixed(2), acc(t.account_id)?.name, acc(t.to_account_id)?.name, cat(t.category_id)?.name, t.note])];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `pocket-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  if (el.type === 'checkbox') e.preventDefault();
  actions[el.dataset.act](el);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.budget) saveBudget(el.dataset.budget, el.value);
  else if (el.dataset.rate) saveRate(el.dataset.rate, el.value);
  else if (el.dataset.setting) run(async () => { await db.setting(el.dataset.setting, num(el.value)); S.settings[el.dataset.setting] = num(el.value); }, 'Saved');
  else if (el.matches('[data-theme-sel]')) { document.documentElement.dataset.theme = el.value; localStorage.setItem('pocket.theme', el.value); }
  else if (el.dataset.f && el.type !== 'search') { S.f[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; render(); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.f === 'q') { S.f.q = el.value; render(); const s = $('[data-f=q]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
});

/* ---------- render & boot ---------- */
function render() {
  $('#month-label').textContent = monthName(S.month);
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
  $('#view').innerHTML = V[S.view]();
}
window.addEventListener('hashchange', () => { S.view = V[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; render(); scrollTo(0, 0); });

async function boot() {
  S.view = V[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  try {
    const [accounts, categories, bills, goals, debts, settings, tx] = await Promise.all([
      db.list('accounts', '&order=created_at'), db.list('categories', '&order=kind,created_at'), db.list('bills', '&order=day_of_month'),
      db.list('goals', '&order=created_at'), db.list('debts', '&order=created_at'), db.list('settings'), loadTx(), loadLive(),
    ]);
    Object.assign(S, { accounts, categories, bills, goals, debts, tx, settings: Object.fromEntries(settings.map(s => [s.key, s.value])) });
    render();
    await autoBills().catch(e => console.error(e));
    render();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty" style="margin-top:30px">Couldn't load your data. Check your connection.<div style="margin-top:12px"><button class="primary" onclick="location.reload()">Retry</button></div></div>`;
  }
}
boot();
