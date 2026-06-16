// ============================================================
// CONFIGURATION & DATABASE CONNECTIVITY
// ============================================================
// Paste your Google Apps Script Web App URL below:
const GOOGLE_SHEET_API_URL = "YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

let state = {
  transactions: [],
  btcPrice: null,
  btcPriceUsd: null,
  btc24h: null,
  settings: {
    goalFiat: 200000,
    goalSats: 2000000,
    manualPrice: null,
    refreshInterval: 5,
    satUnit: 'sat'
  }
};

let editId = null;
let currentChart = 'portfolio';
let dayFilter = 'ALL';
let priceSource = '';
let isFetching = false;
let priceRefreshInterval = null;
let autoFetchedPrice = null;

// Formatters
const fmt = (v, dec = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtD = (v, dec = 2) => Number(v).toFixed(dec);
const satToBtc = (sats) => sats / 100000000;
const fmtSats = (sats) => fmt(sats) + " sat";

// ============================================================
// ASYNC DATABASE SYNC ENGINE (Google Sheets Link)
// ============================================================
async function fetchFromDatabase() {
  if (!GOOGLE_SHEET_API_URL || GOOGLE_SHEET_API_URL.includes("YOUR_APPS_SCRIPT")) {
    console.warn("Google Sheet API base URL missing. Falling back to LocalStorage.");
    loadLocalFallback();
    return;
  }

  try {
    const response = await fetch(GOOGLE_SHEET_API_URL);
    if (!response.ok) throw new Error("Database fetch connection dropped");
    const remoteData = await response.json();
    
    // Normalize data properties arriving from sheet columns
    state.transactions = remoteData.map(t => ({
      id: t.id,
      date: t.date,
      type: t.type,
      thb: parseFloat(t.thb || 0),
      sats: parseInt(t.sats || 0)
    }));

    toast("Database synchronized ✓", "success");
    renderAll();
  } catch (err) {
    console.error("Database connection dropped. Using local storage cache.", err);
    toast("Database offline, loaded cache", "error");
    loadLocalFallback();
  }
}

async function writeToDatabase(payload) {
  // Always update locally for instant UI responsiveness
  if (payload.action === "add") {
    state.transactions.push({ id: payload.id, date: payload.date, type: payload.type, thb: payload.thb, sats: payload.sats });
  } else if (payload.action === "clear") {
    state.transactions = [];
  }
  saveLocalCache();
  renderAll();

  if (!GOOGLE_SHEET_API_URL || GOOGLE_SHEET_API_URL.includes("YOUR_APPS_SCRIPT")) return true;

  try {
    // Send background network update to your Google Sheet database
    const res = await fetch(GOOGLE_SHEET_API_URL, {
      method: "POST",
      mode: "no-cors", // Bypasses browser CORS policy blocks cleanly on micro-backends
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return true;
  } catch (err) {
    console.error("Write error on cloud sheet pipeline", err);
    toast("Saved locally, cloud sync pending", "error");
    return false;
  }
}

function saveLocalCache() { localStorage.setItem('dca_cache_tx', JSON.stringify(state.transactions)); }
function loadLocalFallback() {
  const raw = localStorage.getItem('dca_cache_tx');
  if (raw) state.transactions = JSON.parse(raw);
}

// ============================================================
// BITCOIN AUTO-FETCH PRICE TICKER ENGINE
// ============================================================
async function autoFetchPrice() {
  if (isFetching) return;
  isFetching = true;
  updatePriceDotUI('fetching');
  
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=thb,usd&include_24hr_change=true');
    if (!response.ok) throw new Error();
    const data = await response.json();

    autoFetchedPrice = {
      thb: data.bitcoin.thb,
      usd: data.bitcoin.usd,
      change24h: data.bitcoin.thb_24h_change || 0
    };

    updatePriceDotUI('ok');
    applyPriceData(autoFetchedPrice.thb, autoFetchedPrice.usd, 'Live', autoFetchedPrice.change24h);
  } catch (err) {
    // Fallback direct Binance endpoint mapping
    try {
      const backupResponse = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      const bData = await backupResponse.json();
      const liveUsd = parseFloat(bData.lastPrice);
      
      autoFetchedPrice = { thb: liveUsd * 35.2, usd: liveUsd, change24h: parseFloat(bData.priceChangePercent) };
      updatePriceDotUI('ok');
      applyPriceData(autoFetchedPrice.thb, autoFetchedPrice.usd, 'Live Fallback', autoFetchedPrice.change24h);
    } catch(fErr) {
      updatePriceDotUI('error');
    }
  } finally {
    isFetching = false;
  }
}

function updatePriceDotUI(type) {
  const dot = document.getElementById('priceDot');
  if (!dot) return;
  dot.className = 'price-status-dot';
  if (type === 'fetching') dot.classList.add('fetching');
  else if (type === 'ok') dot.classList.add('live');
  else dot.classList.add('error');
}

function applyPriceData(thb, usd, src, change24h) {
  state.btcPrice = thb;
  state.btcPriceUsd = usd;
  state.btc24h = change24h;
  const hp = document.getElementById('headerPrice');
  if (hp) hp.textContent = '฿' + fmt(thb);
  renderAll();
}

// ============================================================
// FORM SUBMISSION ROUTER
// ============================================================
async function handleAddTransaction(event) {
  event.preventDefault(); // Stop page reload behavior
  
  const thbVal = parseFloat(document.getElementById('inputThb').value);
  const priceVal = parseFloat(document.getElementById('inputPrice').value) || state.btcPrice;

  if (!thbVal || !priceVal) {
    toast("Please enter all required transaction fields", "error");
    return;
  }

  const calculatedSats = Math.round((thbVal / priceVal) * 100000000);
  
  const payload = {
    action: "add",
    id: "tx_" + Date.now(),
    date: document.getElementById('inputDate').value || new Date().toISOString().split('T')[0],
    type: "buy",
    thb: thbVal,
    sats: calculatedSats
  };

  toast("Sending to database...", "fetching");
  const success = await writeToDatabase(payload);
  if (success) toast("Saved to Google Sheets ✓", "success");
}

async function clearAllData() {
  if (confirm("Are you sure you want to permanently clear the cloud database table?")) {
    toast("Clearing database...", "fetching");
    await writeToDatabase({ action: "clear" });
    toast("Database cleared", "success");
  }
}

function togglePriceInput() {
  const p = document.getElementById('quickPricePanel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function toggleTweaks() { document.getElementById('tweaksPanel').classList.toggle('open'); }

function filteredTxs() {
  if (dayFilter === 'ALL') return state.transactions;
  return state.transactions.filter(t => new Date(t.date).getDay().toString() === dayFilter);
}

function calcPortfolio(txs) {
  let totalThb = 0, totalSats = 0;
  txs.forEach(t => {
    totalThb += t.thb;
    totalSats += t.sats;
  });
  const mv = state.btcPrice ? satToBtc(totalSats) * state.btcPrice : 0;
  const pnl = mv - totalThb;
  const pnlPct = totalThb > 0 ? (pnl / totalThb) * 100 : 0;
  return { totalThb, totalSats, marketValue: mv, pnl, pnlPct };
}

function renderAll() {
  const fTxs = filteredTxs();
  const p = calcPortfolio(fTxs);
  
  const pnlEl = document.getElementById('pnlValue');
  if (pnlEl) {
    pnlEl.textContent = (p.pnl >= 0 ? '+' : '') + '฿' + fmt(p.pnl, 2);
    pnlEl.className = 'pnl-value ' + (p.pnl >= 0 ? 'pos' : 'neg');
  }

  const badge = document.getElementById('pnlBadge');
  if (badge) {
    badge.textContent = (p.pnlPct >= 0 ? '+' : '') + fmtD(p.pnlPct, 2) + '%';
    badge.className = 'pnl-badge ' + (p.pnlPct >= 0 ? 'pos' : 'neg');
  }

  if(document.getElementById('marketValue')) document.getElementById('marketValue').textContent = '฿' + fmt(p.marketValue, 0);
  if(document.getElementById('totalInvested')) document.getElementById('totalInvested').textContent = '฿' + fmt(p.totalThb, 0);
  if(document.getElementById('mSpend')) document.getElementById('mSpend').textContent = '฿' + fmt(p.totalThb, 0);
  if(document.getElementById('mSats')) document.getElementById('mSats').textContent = fmtSats(p.totalSats);
  if(document.getElementById('mSatsBtc')) document.getElementById('mSatsBtc').textContent = satToBtc(p.totalSats).toFixed(8) + ' BTC';
}

function setDayFilter(day, el) {
  dayFilter = day;
  document.querySelectorAll('.day-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderAll();
}

function toast(msg, type = 'success') {
  const tc = document.getElementById('toastContainer');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Global System Boot Anchor
window.addEventListener('DOMContentLoaded', () => {
  autoFetchPrice();
  fetchFromDatabase(); 
  
  // Refresh price feeds every 5 minutes
  setInterval(autoFetchPrice, 5 * 60 * 1000);
});

document.addEventListener('click', e => {
  const qp = document.getElementById('quickPricePanel');
  if (qp && qp.style.display !== 'none' && !document.getElementById('quickPriceWrap').contains(e.target)) {
    qp.style.display = 'none';
  }
});
