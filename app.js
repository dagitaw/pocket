// Pocket — simple money tracker. Data in Supabase (REST, no SDK). Base currency: Birr.
const SB_URL = 'https://caixinoemxmoeudpqsuc.supabase.co';
const SB_KEY = 'sb_publishable_hyYuYBDBDK8AAunk4xRPtA_NlxM-wWK';
const BASE = 'ETB';
const ALL_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'CNY', 'KES', 'CAD', 'AUD', 'TRY', 'INR'];
const SYM = { ETB: 'Br ', USD: '$', EUR: '€', GBP: '£' };
const PIE = ['#1f5c46', '#b8325a', '#3f8f6f', '#e08aa3', '#b7791f', '#7cbf9e', '#e3b86b', '#8a9a92'];
const LIVE_TTL = 6 * 3600e3;

/* ---------- data ---------- */
async function api(path, { method = 'GET', body, prefer = 'return=representation' } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method, headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: prefer },
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
const S = { categories: [], bills: [], goals: [], debts: [], tx: [], settings: {}, live: {}, liveAt: 0, month: today().slice(0, 7), view: 'home', q: '', kind: '' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = v => (Number.isFinite(+v) ? +v : 0);
const fmt = n => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n, cur = BASE) => (n < 0 ? '-' : '') + (SYM[cur] ?? cur + ' ') + fmt(n);
const addMonth = (ym, d) => { const t = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const monthName = (ym, o = { month: 'long', year: 'numeric' }) => new Date(ym + '-01T00:00').toLocaleDateString('en-US', o);
const daysIn = ym => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const dayName = d => new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const byId = (list, id) => list.find(x => x.id === id);
const cat = id => byId(S.categories, id);
const isThisMonth = () => S.month === today().slice(0, 7);

// Rates are Birr per 1 unit. Your own rate beats the live one.
const overrides = () => S.settings.rate_overrides || {};
const liveRate = c => (c === BASE ? 1 : S.live[c] || 0);
const rate = c => (c === BASE ? 1 : num(overrides()[c]) || liveRate(c) || 1);
const currencies = () => [BASE, ...new Set(['USD', 'EUR', ...Object.keys(overrides()), ...(S.settings.currencies || [])])];
const birr = t => num(t.amount) * num(t.rate || 1);

async function loadLive(force = false) {
  const cached = () => { try { return JSON.parse(localStorage.getItem('pocket.live')); } catch { return null; } };
  try {
    const c = cached();
    if (c && !force && Date.now() - c.at < LIVE_TTL) { S.live = c.rates; S.liveAt = c.at; return; }
    const d = await fetch('https://open.er-api.com/v6/latest/ETB').then(r => r.json());
    if (d.result !== 'success') throw new Error('rates');
    S.live = Object.fromEntries(Object.entries(d.rates).map(([k, v]) => [k, 1 / v]));
    S.liveAt = Date.now();
    localStorage.setItem('pocket.live', JSON.stringify({ rates: S.live, at: S.liveAt }));
  } catch {
    const c = cached();
    if (c) { S.live = c.rates; S.liveAt = c.at; }
    if (force) toast("Couldn't reach the rates service. Using the last saved rates.", true);
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
  catch (e) { console.error(e); toast("Couldn't save. Check your connection and try again.", true); return false; }
}

/* ---------- numbers ---------- */
const inMonth = (t, ym = S.month) => t.date.startsWith(ym);
function totals(ym = S.month) {
  let income = 0, expense = 0;
  for (const t of S.tx) if (inMonth(t, ym)) t.kind === 'income' ? (income += birr(t)) : (expense += birr(t));
  return { income, expense };
}
const allTimeKept = () => S.tx.reduce((s, t) => s + (t.kind === 'income' ? birr(t) : -birr(t)), 0);
function spendByCat(ym = S.month) {
  const m = new Map();
  for (const t of S.tx) if (t.kind === 'expense' && inMonth(t, ym)) m.set(t.category_id, (m.get(t.category_id) || 0) + birr(t));
  return m;
}
const billTx = (b, ym = S.month) => S.tx.find(t => t.bill_id === b.id && inMonth(t, ym));
const dueDate = (b, ym = S.month) => `${ym}-${String(Math.min(b.day_of_month, daysIn(ym))).padStart(2, '0')}`;
const owedLeft = d => Math.max(num(d.amount) - num(d.paid), 0);

/* ---------- pieces ---------- */
const emoji = c => `<span class="emoji">${esc(c?.icon || '•')}</span>`;
const bar = (pct, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.min(Math.max(pct, 0), 100).toFixed(1)}%"></i></div>`;
const empty = (msg, act, label) => `<div class="empty">${msg}${act ? `<br><button type="button" class="btn small" data-act="${act}">${label}</button>` : ''}</div>`;

function txRow(t) {
  const c = cat(t.category_id), cur = t.currency || BASE, inc = t.kind === 'income';
  return `<button type="button" class="row" data-act="edit-tx" data-id="${t.id}">${emoji(c)}
    <span class="main"><b>${esc(t.note || c?.name || (inc ? 'Money in' : 'Spent'))}</b><small>${esc(c?.name || 'No category')}, ${dayName(t.date)}</small></span>
    <span class="amt ${inc ? 'in' : 'out'}">${inc ? '+' : '−'}${money(num(t.amount), cur)}${cur !== BASE ? `<small>${money(birr(t))} at ${num(t.rate)}</small>` : ''}</span></button>`;
}
function pie(items, total) {
  const r = 52, C = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map((it, i) => {
    const len = (it.value / total) * C;
    const s = `<circle r="${r}" cx="74" cy="74" fill="none" stroke="${PIE[i % PIE.length]}" stroke-width="20" stroke-dasharray="${Math.max(len - (items.length > 1 ? 2 : 0), 0.01)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 74 74)"><title>${esc(it.name)}: ${money(it.value)}</title></circle>`;
    off += len; return s;
  }).join('');
  return `<svg viewBox="0 0 148 148" role="img" aria-label="Spending by category">${segs}</svg>`;
}

/* ---------- views ---------- */
const V = {};

V.home = () => {
  const { income, expense } = totals(), left = income - expense;
  const pct = num(S.settings.savings_pct ?? 20), keepGoal = income * pct / 100;
  const spentPct = income ? expense / income * 100 : expense ? 100 : 0;
  let note = 'Add what you earned this month to see how much you keep.';
  if (income) note = left < 0 ? `You've spent ${money(-left)} more than you earned.`
    : left >= keepGoal ? `You're keeping ${Math.round(left / income * 100)}% of what you earned. Your goal is ${pct}%.`
    : `You're ${money(keepGoal - left)} short of keeping ${pct}%.`;

  const spend = [...spendByCat()].map(([id, value]) => ({ c: cat(id), name: cat(id)?.name || 'No category', value })).sort((a, b) => b.value - a.value);
  const budgeted = S.categories.filter(c => c.kind === 'expense' && num(c.budget) > 0 && !spend.some(s => s.c?.id === c.id)).map(c => ({ c, name: c.name, value: 0 }));
  const rows = [...spend, ...budgeted];
  const unpaid = S.bills.filter(b => !billTx(b)).sort((a, b) => a.day_of_month - b.day_of_month);
  const recent = S.tx.filter(t => inMonth(t)).slice(0, 5);

  const catRow = (s, i) => {
    const b = num(s.c?.budget), p = b ? s.value / b * 100 : 0;
    const sub = b ? (s.value > b ? `<span class="out">${money(s.value - b)} over your ${money(b)} limit</span>` : `${money(b - s.value)} left of ${money(b)}`) : 'Tap to set a monthly limit';
    return `<button type="button" class="row" data-act="budget" data-id="${s.c?.id || ''}">
      <span class="emoji" style="box-shadow: inset 4px 0 ${s.value ? PIE[i % PIE.length] : 'transparent'}">${esc(s.c?.icon || '•')}</span>
      <span class="main"><b>${esc(s.name)}</b><small>${sub}</small>${b ? bar(p, p > 100 ? 'over' : p > 85 ? 'warn' : '') : ''}</span>
      <span class="amt">${money(s.value)}</span></button>`;
  };

  return `<section class="hero">
      <p>${left >= 0 ? 'Left this month' : 'Overspent this month'}</p>
      <div class="big"><small>Br</small>${fmt(left)}</div>
      <div class="track" aria-hidden="true"><i style="width:${Math.min(spentPct, 100)}%"></i>${income ? `<b style="left:${100 - pct}%" title="Spend up to here to keep ${pct}%"></b>` : ''}</div>
      <div class="legend"><span>Earned ${money(income)}</span><span>Spent ${money(expense)}</span></div>
      <p class="note">${note}<br>All time you've kept ${money(allTimeKept())}.</p>
    </section>

    <h2>Spending</h2>
    <div class="group">${expense ? `<div class="spend">${pie(spend, expense)}<div class="total">Spent in ${monthName(S.month, { month: 'long' })}<b class="num">${money(expense)}</b></div></div>` : ''}
      ${rows.map(catRow).join('') || empty('Nothing spent this month yet.', 'add', 'Add spending')}</div>

    ${unpaid.length ? `<h2>Bills to pay <a href="#bills">All bills</a></h2><div class="group">${unpaid.slice(0, 5).map(billRow).join('')}</div>` : ''}

    <h2>Recent <a href="#history">See all</a></h2>
    <div class="group">${recent.map(txRow).join('') || empty('No money in or out this month yet.', 'add', 'Add the first one')}</div>`;
};

V.history = () => {
  const q = S.q.toLowerCase();
  const list = S.tx.filter(t => (q ? true : inMonth(t)) && (!S.kind || t.kind === S.kind)
    && (!q || `${t.note} ${cat(t.category_id)?.name || ''} ${t.amount}`.toLowerCase().includes(q)));
  let inc = 0, exp = 0;
  for (const t of list) t.kind === 'income' ? (inc += birr(t)) : (exp += birr(t));
  const days = {};
  for (const t of list) (days[t.date] ||= []).push(t);
  const chip = (k, l) => `<button type="button" class="chip ${S.kind === k ? 'on' : ''}" data-act="kind" data-k="${k}">${l}</button>`;
  return `<h2>${q ? 'Search results' : monthName(S.month)}</h2>
    <div class="chips">${chip('', 'All')}${chip('expense', 'Spent')}${chip('income', 'Earned')}</div>
    <input class="search" type="search" placeholder="Search all months" value="${esc(S.q)}" data-q aria-label="Search">
    <p class="quiet">Earned <span class="in num">${money(inc)}</span>, spent <span class="out num">${money(exp)}</span></p>
    ${Object.entries(days).map(([d, ts]) => `<div class="daylabel"><span>${new Date(d + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', ...(q ? { year: 'numeric' } : {}) })}</span></div><div class="group">${ts.map(txRow).join('')}</div>`).join('')
      || `<div class="group">${empty(q ? 'Nothing matches that search.' : 'No money in or out this month yet.', q ? '' : 'add', 'Add the first one')}</div>`}`;
};

function billRow(b) {
  const t = billTx(b), due = dueDate(b), late = !t && due < today();
  return `<div class="row ${t ? 'done' : ''}">
    <input type="checkbox" class="check" ${t ? 'checked' : ''} data-act="pay-bill" data-id="${b.id}" aria-label="Mark ${esc(b.name)} as paid">
    <span class="main tap" data-act="edit-bill" data-id="${b.id}" style="cursor:pointer"><b>${esc(b.name)}</b>
      <small>${t ? `Paid ${dayName(t.date)}` : late ? `<span class="out">Overdue since ${dayName(due)}</span>` : `Due ${dayName(due)}`}${b.auto_add ? ', added automatically' : ''}</small></span>
    <span class="amt">${money(num(b.amount), b.currency)}${b.currency !== BASE ? `<small>${money(num(b.amount) * rate(b.currency))}</small>` : ''}</span></div>`;
}
V.bills = () => {
  const bills = [...S.bills].sort((a, b) => a.day_of_month - b.day_of_month);
  const paid = bills.filter(b => billTx(b)).length;
  const toPay = bills.filter(b => !billTx(b)).reduce((s, b) => s + num(b.amount) * rate(b.currency), 0);
  return `<h2>Bills for ${monthName(S.month, { month: 'long' })} <button type="button" data-act="edit-bill">Add bill</button></h2>
    ${bills.length ? `<p class="quiet">${paid} of ${bills.length} paid${toPay ? `, ${money(toPay)} still to pay` : ''}. Tick a bill when you pay it and it's added to your spending.</p>` : ''}
    <div class="group">${bills.map(billRow).join('') || empty('Add the things you pay every month, like rent, editors or subscriptions.', 'edit-bill', 'Add bill')}</div>`;
};

V.goals = () => {
  const goal = g => {
    const p = num(g.target) ? num(g.saved) / num(g.target) * 100 : 0, left = Math.max(num(g.target) - num(g.saved), 0);
    let plan = left ? `${money(left)} to go` : 'Reached';
    if (g.deadline && left) {
      const now = new Date(), dl = new Date(g.deadline + 'T00:00');
      const m = Math.max((dl.getFullYear() - now.getFullYear()) * 12 + dl.getMonth() - now.getMonth(), 1);
      plan = dl < now ? `${money(left)} to go, deadline passed` : `Save ${money(left / m)} a month to reach it by ${dayName(g.deadline)}`;
    }
    return `<div class="row"><span class="main tap" data-act="edit-goal" data-id="${g.id}" style="cursor:pointer"><b>${esc(g.name)}</b>
      <small class="wrap">${money(num(g.saved))} of ${money(num(g.target))}. ${plan}</small>${bar(p)}</span>
      <button type="button" class="btn small" data-act="goal-add" data-id="${g.id}">Add</button></div>`;
  };
  const debt = d => {
    const left = owedLeft(d), mine = d.direction === 'owed_to_me', late = left && d.due && d.due < today();
    return `<div class="row ${left ? '' : 'done'}"><span class="main tap" data-act="edit-debt" data-id="${d.id}" style="cursor:pointer"><b>${esc(d.person)}</b>
      <small>${left ? (mine ? 'Owes you' : 'You owe') : 'Paid back'}${d.note ? `, ${esc(d.note)}` : ''}${late ? ', <span class="out">overdue</span>' : d.due && left ? `, due ${dayName(d.due)}` : ''}</small></span>
      <span class="amt ${left ? (mine ? 'in' : 'out') : ''}">${money(left || num(d.amount))}</span>
      ${left ? `<button type="button" class="btn small" data-act="debt-pay" data-id="${d.id}">Paid</button>` : ''}</div>`;
  };
  const debts = [...S.debts].sort((a, b) => !owedLeft(a) - !owedLeft(b));
  return `<h2>Savings goals <button type="button" data-act="edit-goal">Add goal</button></h2>
    <div class="group">${S.goals.map(goal).join('') || empty('Saving for a camera, a trip or an emergency fund? Add it here.', 'edit-goal', 'Add goal')}</div>
    <h2>Money owed <button type="button" data-act="edit-debt">Add</button></h2>
    <div class="group">${debts.map(debt).join('') || empty('Keep track of money you lent or borrowed.', 'edit-debt', 'Add')}</div>`;
};

V.settings = () => {
  const ov = overrides(), dark = document.documentElement.dataset.theme === 'dark';
  const unused = ALL_CURRENCIES.filter(c => !currencies().includes(c));
  return `<h2>Exchange rates <button type="button" data-act="refresh-rates">Refresh</button></h2>
    <div class="group">${currencies().filter(c => c !== BASE).map(c => `<div class="row"><span class="main"><b>1 ${c} in Birr</b>
        <small>${liveRate(c) ? `Official rate ${liveRate(c).toFixed(2)}` : 'No official rate'}${ov[c] ? ', using yours' : ''}</small></span>
        <input style="max-width:120px" type="number" min="0" step="any" inputmode="decimal" placeholder="${liveRate(c) ? liveRate(c).toFixed(2) : 'Rate'}" value="${ov[c] ?? ''}" data-rate="${c}" aria-label="Your ${c} rate"></div>`).join('')}
      ${unused.length ? `<div class="row"><select id="new-cur" aria-label="Currency">${unused.map(c => `<option>${c}</option>`).join('')}</select><button type="button" class="btn small" data-act="add-cur">Add currency</button></div>` : ''}</div>
    <p class="quiet" style="font-size:14px">Type your own rate to use it instead of the official one. Leave it empty to use the official rate. Saved entries keep the rate they were added with.</p>

    <h2>Categories <button type="button" data-act="edit-cat">Add category</button></h2>
    <div class="group">${S.categories.map(c => `<button type="button" class="row" data-act="edit-cat" data-id="${c.id}">${emoji(c)}<span class="main"><b>${esc(c.name)}</b><small>${c.kind === 'income' ? 'Money in' : 'Spending'}${num(c.budget) ? `, limit ${money(num(c.budget))}` : ''}</small></span></button>`).join('')}</div>

    <h2>Preferences</h2>
    <div class="group">
      <div class="row"><span class="main"><b>Savings goal</b><small>Share of what you earn you want to keep</small></span><input style="max-width:90px" type="number" min="0" max="100" value="${num(S.settings.savings_pct ?? 20)}" data-setting="savings_pct" aria-label="Savings goal percent"><span class="quiet">%</span></div>
      <label class="row toggle"><span>Dark mode</span><input type="checkbox" data-theme-toggle ${dark ? 'checked' : ''}></label>
      <div class="row"><span class="main"><b>Download your data</b><small>Every entry as a spreadsheet (CSV)</small></span><button type="button" class="btn small" data-act="export">Download</button></div>
    </div>`;
};

/* ---------- forms ---------- */
const dlg = $('#modal'), form = $('#modal-form');
let onSave = null, onDelete = null;
function openForm(html, save, del, saveLabel = 'Save') {
  form.innerHTML = `${html}<div class="actions">${del ? '<button type="button" class="btn danger" data-act="del">Delete</button>' : ''}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn solid">${saveLabel}</button></div>`;
  onSave = save; onDelete = del; form.oninput = null; dlg.showModal();
  form.querySelector('input[type=number], input:not([type=radio]):not([type=checkbox])')?.focus();
}
form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('.solid'); btn.disabled = true;
  if (await run(() => onSave(Object.fromEntries(new FormData(form))), 'Saved')) dlg.close();
  btn.disabled = false;
});
const seg = (name, opts, sel) => `<div class="seg">${opts.map(([v, l]) => `<input type="radio" name="${name}" id="${name}-${v}" value="${v}" ${v === sel ? 'checked' : ''}><label for="${name}-${v}">${l}</label>`).join('')}</div>`;
const curSelect = sel => `<select name="currency" aria-label="Currency">${currencies().map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('')}</select>`;

function txForm(t = {}) {
  const lastCur = localStorage.getItem('pocket.cur') || BASE;
  openForm(`<h3>${t.id ? 'Edit entry' : 'Add money in or out'}</h3>
    ${seg('kind', [['expense', 'Spent'], ['income', 'Earned']], t.kind || 'expense')}
    <div class="amount"><input name="amount" type="number" step="any" min="0" required inputmode="decimal" placeholder="0" value="${t.amount ?? ''}" aria-label="Amount">${curSelect(t.currency || (currencies().includes(lastCur) ? lastCur : BASE))}</div>
    <label data-rate>Rate in Birr<input name="rate" type="number" step="any" min="0" inputmode="decimal" value="${t.rate && t.currency !== BASE ? t.rate : ''}"></label>
    <p class="hint" data-rate id="rate-hint"></p>
    <div class="chips" id="cats" role="radiogroup" aria-label="Category"></div>
    <div class="pair"><label>Date<input name="date" type="date" required value="${t.date || (isThisMonth() ? today() : S.month + '-01')}"></label>
      <label>Note<input name="note" maxlength="120" value="${esc(t.note || '')}" placeholder="Optional"></label></div>`,
    async fd => {
      const cur = fd.currency;
      const row = { kind: fd.kind, amount: num(fd.amount), currency: cur, rate: cur === BASE ? 1 : num(fd.rate) || rate(cur), date: fd.date, note: fd.note.trim(), category_id: fd.category_id || null };
      const saved = t.id ? await db.update('transactions', t.id, row) : await db.insert('transactions', row);
      localStorage.setItem('pocket.cur', cur);
      S.tx = [saved, ...S.tx.filter(x => x.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
    },
    t.id && (async () => { await db.remove('transactions', t.id); S.tx = S.tx.filter(x => x.id !== t.id); }));
  let lastKind;
  const sync = () => {
    const k = form.kind.value, cur = form.currency.value;
    if (k !== lastKind) {
      const sel = form.category_id?.value || t.category_id;
      $('#cats').innerHTML = S.categories.filter(c => c.kind === k).map(c => `<input type="radio" name="category_id" id="c-${c.id}" value="${c.id}" ${c.id === sel ? 'checked' : ''}><label for="c-${c.id}">${esc(c.icon)} ${esc(c.name)}</label>`).join('');
      lastKind = k;
    }
    form.querySelectorAll('[data-rate]').forEach(el => (el.hidden = cur === BASE));
    if (cur !== BASE) {
      form.rate.placeholder = rate(cur);
      const r = num(form.rate.value) || rate(cur);
      $('#rate-hint').textContent = `${form.rate.value ? 'Using this rate' : overrides()[cur] ? 'Using your rate' : 'Using the official rate'}${form.amount.value ? `, that's ${money(num(form.amount.value) * r)}` : ''}.`;
    }
  };
  form.oninput = sync; sync();
}

function simpleForm(title, html, item, table, key) {
  openForm(`<h3>${title}</h3>${html}`, async fd => {
    const row = {};
    for (const [k, v] of Object.entries(fd)) row[k] = v === '' && form.elements[k]?.type !== 'text' ? null : v;
    form.querySelectorAll('input[type=checkbox][name]').forEach(cb => (row[cb.name] = cb.checked));
    form.querySelectorAll('input[type=number][name]').forEach(n => (row[n.name] = n.value === '' ? null : num(n.value)));
    const saved = item.id ? await db.update(table, item.id, row) : await db.insert(table, row);
    S[key] = item.id ? S[key].map(x => (x.id === saved.id ? saved : x)) : [...S[key], saved];
  }, item.id && (async () => { await db.remove(table, item.id); S[key] = S[key].filter(x => x.id !== item.id); }));
}

const billForm = (b = {}) => simpleForm(b.id ? 'Edit bill' : 'Add a monthly bill', `
  <label>Name<input name="name" required maxlength="60" value="${esc(b.name || '')}" placeholder="Rent, editor, Netflix…"></label>
  <div class="amount"><input name="amount" type="number" step="any" min="0" required inputmode="decimal" placeholder="0" value="${b.amount ?? ''}" aria-label="Amount">${curSelect(b.currency || BASE)}</div>
  <div class="pair"><label>Due on day<input name="day_of_month" type="number" min="1" max="31" required value="${b.day_of_month ?? 1}"></label>
    <label>Category<select name="category_id"><option value="">None</option>${S.categories.filter(c => c.kind === 'expense').map(c => `<option value="${c.id}" ${c.id === b.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label></div>
  <label class="toggle"><span>Add it to my spending automatically on the due day</span><input type="checkbox" name="auto_add" ${b.auto_add ? 'checked' : ''}></label>`, b, 'bills', 'bills');

const goalForm = (g = {}) => simpleForm(g.id ? 'Edit goal' : 'New savings goal', `
  <label>What are you saving for?<input name="name" required maxlength="60" value="${esc(g.name || '')}" placeholder="New camera"></label>
  <div class="pair"><label>Target (Br)<input name="target" type="number" step="any" min="0" required value="${g.target ?? ''}"></label>
    <label>Saved so far (Br)<input name="saved" type="number" step="any" min="0" value="${g.saved ?? 0}"></label></div>
  <label>Reach it by (optional)<input name="deadline" type="date" value="${g.deadline || ''}"></label>`, g, 'goals', 'goals');

const debtForm = (d = {}) => simpleForm(d.id ? 'Edit' : 'Money owed', `
  ${seg('direction', [['owed_to_me', 'They owe me'], ['i_owe', 'I owe them']], d.direction || 'owed_to_me')}
  <label>Person<input name="person" required maxlength="60" value="${esc(d.person || '')}"></label>
  <div class="pair"><label>Amount (Br)<input name="amount" type="number" step="any" min="0" required value="${d.amount ?? ''}"></label>
    <label>Paid back so far<input name="paid" type="number" step="any" min="0" value="${d.paid ?? 0}"></label></div>
  <div class="pair"><label>Due (optional)<input name="due" type="date" value="${d.due || ''}"></label>
    <label>Note<input name="note" maxlength="80" value="${esc(d.note || '')}" placeholder="Optional"></label></div>`, d, 'debts', 'debts');

const catForm = (c = {}) => simpleForm(c.id ? 'Edit category' : 'New category', `
  ${seg('kind', [['expense', 'Spending'], ['income', 'Money in']], c.kind || 'expense')}
  <div class="amount" style="grid-template-columns:72px 1fr"><input name="icon" maxlength="4" value="${esc(c.icon || '•')}" aria-label="Emoji" style="text-align:center;font-size:22px"><input name="name" required maxlength="30" value="${esc(c.name || '')}" placeholder="Name" aria-label="Name"></div>
  <label>Monthly limit in Birr (spending only, optional)<input name="budget" type="number" step="any" min="0" value="${c.budget ?? ''}"></label>`, c, 'categories', 'categories');

function budgetForm(c) {
  if (!c) return;
  const avg = [1, 2, 3].reduce((s, i) => s + (spendByCat(addMonth(S.month, -i)).get(c.id) || 0), 0) / 3;
  openForm(`<h3>${esc(c.icon)} ${esc(c.name)}</h3>
    <label>Monthly limit in Birr<input name="budget" type="number" step="any" min="0" value="${c.budget ?? ''}" placeholder="No limit"></label>
    <p class="hint">${avg ? `You spent about ${money(avg)} a month here over the last 3 months. ` : ''}Leave it empty for no limit.</p>`,
    async fd => { const saved = await db.update('categories', c.id, { budget: fd.budget === '' ? null : num(fd.budget) }); S.categories = S.categories.map(x => (x.id === c.id ? saved : x)); });
}
function amountForm(title, max, cb, label) {
  openForm(`<h3>${esc(title)}</h3><label>Amount (Br)<input name="v" type="number" step="any" min="0" required ${max ? `max="${max}"` : ''} inputmode="decimal"></label>`, fd => cb(num(fd.v)), null, label);
}

/* ---------- actions ---------- */
const actions = {
  add: () => txForm(),
  'edit-tx': el => txForm(byId(S.tx, el.dataset.id)),
  month: el => { S.month = +el.dataset.d ? addMonth(S.month, +el.dataset.d) : today().slice(0, 7); render(); },
  kind: el => { S.kind = el.dataset.k; render(); },
  close: () => dlg.close(),
  del: async () => { if (onDelete && confirm('Delete this? This can’t be undone.') && await run(onDelete, 'Deleted')) dlg.close(); },
  'edit-bill': el => billForm(byId(S.bills, el.dataset.id)),
  'edit-goal': el => goalForm(byId(S.goals, el.dataset.id)),
  'edit-debt': el => debtForm(byId(S.debts, el.dataset.id)),
  'edit-cat': el => catForm(byId(S.categories, el.dataset.id)),
  budget: el => budgetForm(cat(el.dataset.id)),
  'pay-bill': el => payBill(byId(S.bills, el.dataset.id)),
  'goal-add': el => {
    const g = byId(S.goals, el.dataset.id);
    amountForm(`Add to ${g.name}`, 0, async v => {
      const saved = await db.update('goals', g.id, { saved: num(g.saved) + v });
      S.goals = S.goals.map(x => (x.id === g.id ? saved : x));
    }, 'Add');
  },
  'debt-pay': el => {
    const d = byId(S.debts, el.dataset.id);
    amountForm(`How much did ${d.direction === 'owed_to_me' ? `${d.person} pay you` : `you pay ${d.person}`}?`, owedLeft(d), async v => {
      const saved = await db.update('debts', d.id, { paid: num(d.paid) + v });
      S.debts = S.debts.map(x => (x.id === d.id ? saved : x));
    }, 'Record payment');
  },
  'refresh-rates': async () => { await loadLive(true); render(); toast('Rates refreshed'); },
  'add-cur': () => {
    const c = $('#new-cur').value, list = [...new Set([...(S.settings.currencies || []), c])];
    run(async () => { await db.setting('currencies', list); S.settings.currencies = list; }, `${c} added`);
  },
  export: exportCsv,
};

const billToTx = (b, date) => ({ kind: 'expense', amount: num(b.amount), currency: b.currency, rate: rate(b.currency), date, note: b.name, category_id: b.category_id, bill_id: b.id });
function payBill(b) {
  const t = billTx(b);
  if (t) return run(async () => { await db.remove('transactions', t.id); S.tx = S.tx.filter(x => x.id !== t.id); }, `${b.name} marked unpaid`);
  return run(async () => { S.tx.unshift(await db.insert('transactions', billToTx(b, isThisMonth() ? today() : dueDate(b)))); S.tx.sort((a, c) => c.date.localeCompare(a.date)); }, `${b.name} paid`);
}
async function autoBills() {
  const ym = today().slice(0, 7), d = +today().slice(8);
  const due = S.bills.filter(b => b.auto_add && Math.min(b.day_of_month, daysIn(ym)) <= d && !billTx(b, ym));
  for (const b of due) S.tx.push(await db.insert('transactions', billToTx(b, dueDate(b, ym))));
  if (due.length) { S.tx.sort((a, b) => b.date.localeCompare(a.date)); toast(`Added ${due.length} bill${due.length > 1 ? 's' : ''} due this month`); }
}
function exportCsv() {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['date', 'type', 'amount', 'currency', 'rate', 'amount_birr', 'category', 'note'],
    ...S.tx.map(t => [t.date, t.kind === 'income' ? 'earned' : 'spent', t.amount, t.currency, t.rate, birr(t).toFixed(2), cat(t.category_id)?.name, t.note])];
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
  if (el.matches('#view [data-rate]')) {
    const ov = { ...overrides() }, c = el.dataset.rate;
    if (num(el.value)) ov[c] = num(el.value); else delete ov[c];
    run(async () => { await db.setting('rate_overrides', ov); S.settings.rate_overrides = ov; }, ov[c] ? `${c} rate saved` : `Using the official ${c} rate`);
  } else if (el.dataset.setting) run(async () => { await db.setting(el.dataset.setting, num(el.value)); S.settings[el.dataset.setting] = num(el.value); }, 'Saved');
  else if (el.matches('[data-theme-toggle]')) {
    const t = el.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = t; localStorage.setItem('pocket.theme', t);
  }
});
document.addEventListener('input', e => {
  if (!e.target.matches('[data-q]')) return;
  S.q = e.target.value; render();
  const s = $('[data-q]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length);
});

/* ---------- render & start ---------- */
function render() {
  $('#month-label').textContent = monthName(S.month, isThisMonth() || S.month.slice(0, 4) === today().slice(0, 4) ? { month: 'long' } : undefined);
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
  $('#view').innerHTML = V[S.view]();
}
const viewFromHash = () => (V[location.hash.slice(1)] ? location.hash.slice(1) : 'home');
window.addEventListener('hashchange', () => { S.view = viewFromHash(); render(); scrollTo(0, 0); });

async function start() {
  S.view = viewFromHash();
  if (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';
  try {
    const [categories, bills, goals, debts, settings, tx] = await Promise.all([
      db.list('categories', '&order=kind,name'), db.list('bills', '&order=day_of_month'), db.list('goals', '&order=created_at'),
      db.list('debts', '&order=created_at'), db.list('settings'), loadTx(), loadLive(),
    ]);
    Object.assign(S, { categories, bills, goals, debts, tx, settings: Object.fromEntries(settings.map(s => [s.key, s.value])) });
    render();
    await autoBills().catch(console.error);
    render();
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<div class="empty">Couldn't load your data. Check your connection.<br><button class="btn small" onclick="location.reload()">Try again</button></div>`;
  }
}
start();
