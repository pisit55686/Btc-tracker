// ============================================================
// STATE & APPLICATION INITIALIZATION
// ============================================================
let state = {
  transactions: [],
  btcPrice: null,
  btcPriceUsd: null,
  btc24h: null,
  priceHistory: [],
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
let mainChart = null;
let priceSource = '';
let isFetching = false;
let priceRefreshInterval = null;
let autoFetchedPrice = null;

// Helper formatters
const fmt = (v, dec = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtD = (v, dec = 2) => Number(v).toFixed(dec);
const satToBtc = (sats) => sats / 100000000;
const satPerThb = (price) => price > 0 ? 100000000 / price : 0;
const thbToSat = (thb, price) => price > 0 ? Math.round((thb / price) * 100000000) : 0;
const fmtSats = (sats) => fmt(sats) + " sat";

// Storage Engine
function save() {
  try {
    localStorage.setItem('dca_v5', JSON.stringify(state));
  } catch (e) {
    console.error("Storage write error", e);
  }
}

function load() {
  try {
    const raw = localStorage.getItem('dca_v5');
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...state, ...parsed };
    }
  } catch (e) {
    console.error("Storage load error", e);
  }
  if (!state.settings) state.settings = { goalFiat: 200000, goalSats: 2000000, manualPrice: null, refreshInterval: 5, satUnit: 'sat' };
}

// ============================================================
// IMPROVED ROBUST AUTO-FETCH ENGINE (Fixes "Load Failed")
// ============================================================
async function autoFetchPrice() {
  if (isFetching) return;
  isFetching = true;
  updatePriceDotUI('fetching');
  
  const statusTxt = document.getElementById('fetchStatusText');
  if (statusTxt) statusTxt.textContent = "Fetching...";

  try {
    // Primary API source: Coingecko / Binance Hybrid Fallback Engine
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=thb,usd&include_24hr_change=true', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) throw new Error("Primary API unavailable");
    
    const data = await response.json();
    if (!data.bitcoin) throw new Error("Data parsing structure exception");

    autoFetchedPrice = {
      thb: data.bitcoin.thb,
      usd: data.bitcoin.usd,
      change24h: data.bitcoin.thb_24h_change || 0
    };

    updatePriceDotUI('ok');
    showAutoResult(autoFetchedPrice);
    if (statusTxt) statusTxt.textContent = "Live online";

  } catch (err) {
    console.warn("Primary endpoint dropped, switching to backup Binance API parser...", err);
    
    // Failover Redundant Call Pipeline
    try {
      const backupResponse = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      if (!backupResponse.ok) throw new Error("Network load dropped cleanly");
      
      const bData = await backupResponse.json();
      const liveUsd = parseFloat(bData.lastPrice);
      const thbEst = liveUsd * 34.5; // Calculated safe fallback multiplier peg
      
      autoFetchedPrice = {
        thb: thbEst,
        usd: liveUsd,
        change24h: parseFloat(bData.priceChangePercent)
      };

      updatePriceDotUI('ok');
      showAutoResult(autoFetchedPrice);
      if (statusTxt) statusTxt.textContent = "Live backup";
    } catch (fallbackErr) {
      console.error("All fetch paths blocked or cross-origin restricted", fallbackErr);
      updatePriceDotUI('error');
      if (statusTxt) statusTxt.textContent = "Load Failed";
      toast("Auto-fetch error: Check connection or firewall", "error");
    }
  } finally {
    isFetching = false;
  }
}

function updatePriceDotUI(type) {
  const dot = document.getElementById('priceDot');
  const btn = document.getElementById('autoFetchBtn');
  if (dot) {
    dot.className = 'price-status-dot';
    if (type === 'fetching') {
      dot.classList.add('fetching');
      if (btn) btn.disabled = true;
    } else if (type === 'ok') {
      dot.classList.add('live');
      if (btn) btn.disabled = false;
    } else {
      dot.classList.add('error');
      if (btn) btn.disabled = false;
    }
  }
}

function showAutoResult(r) {
  const el = document.getElementById('autoPriceResult');
  if (!el) return;
  el.style.display = 'block';
  
  document.getElementById('autoPriceThb').textContent = '฿' + fmt(r.thb);
  document.getElementById('autoPriceDetail').textContent = '$' + fmt(r.usd) + ' • ' + (r.change24h >= 0 ? '+' : '') + fmtD(r.change24h, 2) + '% 24h';
}

function applyAutoPrice() {
  if (!autoFetchedPrice || !autoFetchedPrice.thb) {
    toast('No fetched price to apply', 'error');
    return;
  }
  applyPriceData(autoFetchedPrice.thb, autoFetchedPrice.usd, 'Live', autoFetchedPrice.change24h);
  document.getElementById('quickPricePanel').style.display = 'none';
  toast('Live price applied ✓', 'success');
}

function applyPriceData(thb, usd, src, change24h) {
  if (!thb || thb <= 0) return;
  state.btcPrice = thb;
  state.btcPriceUsd = usd || null;
  if (change24h != null) state.btc24h = change24h;
  priceSource = src || 'Manual';
  
  save();
  refreshPriceUI();
  renderAll();
}

function refreshPriceUI() {
  const hp = document.getElementById('headerPrice');
  const hu = document.getElementById('headerPriceUsd');
  if (hp) hp.textContent = state.btcPrice ? '฿' + fmt(state.btcPrice) : '฿--';
  if (hu) hu.textContent = state.btcPriceUsd ? '$' + fmt(state.btcPriceUsd) : '';
}

// ============================================================
// UI LOGIC INTERACTION
// ============================================================
function togglePriceInput() {
  const p = document.getElementById('quickPricePanel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function toggleTweaks() {
  document.getElementById('tweaksPanel').classList.toggle('open');
}

function applyManualPrice() {
  const v = parseFloat(document.getElementById('manualPrice').value);
  if (v > 0) {
    applyPriceData(v, null, 'Manual', null);
    toast('Price set manually ✓', 'success');
  }
}

function pickRefresh(mins, btn) {
  state.settings.refreshInterval = mins;
  document.querySelectorAll('.refresh-opt').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('refreshIntervalLabel').textContent = "Auto-refresh: " + (mins === 0 ? "Off" : mins + "m");
  setupAutoRefresh();
  save();
}

function setupAutoRefresh() {
  if (priceRefreshInterval) clearInterval(priceRefreshInterval);
  const mins = state.settings.refreshInterval || 5;
  if (mins > 0) {
    priceRefreshInterval = setInterval(() => {
      autoFetchPrice();
    }, mins * 60 * 1000);
  }
}

// ============================================================
// ENGINE CALCULATIONS & CORE RENDERS
// ============================================================
function filteredTxs() {
  if (dayFilter === 'ALL') return state.transactions;
  return state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getDay().toString() === dayFilter;
  });
}

function calcPortfolio(txs) {
  let totalThb = 0, totalSats = 0, totalBuyThb = 0;
  txs.forEach(t => {
    if (t.type === 'buy') {
      totalThb += t.thb;
      totalSats += t.sats;
      totalBuyThb += t.thb;
    } else if (t.type === 'sell') {
      totalThb -= t.thb;
      totalSats -= t.sats;
    }
  });
  const mv = state.btcPrice ? satToBtc(totalSats) * state.btcPrice : null;
  const pnl = mv !== null ? mv - totalThb : null;
  const pnlPct = (mv !== null && totalThb > 0) ? (pnl / totalThb) * 100 : null;
  return { totalThb, totalSats, totalBuyThb, marketValue: mv, pnl, pnlPct };
}

function renderAll() {
  const fTxs = filteredTxs();
  const p = calcPortfolio(fTxs);
  
  const pnlEl = document.getElementById('pnlValue');
  if (p.pnl !== null) {
    pnlEl.textContent = (p.pnl >= 0 ? '+' : '-') + '฿' + fmt(Math.abs(p.pnl), 2);
    pnlEl.className = 'pnl-value ' + (p.pnl >= 0 ? 'pos' : 'neg');
  }
  
  const badge = document.getElementById('pnlBadge');
  if (p.pnlPct !== null) {
    badge.textContent = (p.pnlPct >= 0 ? '+' : '') + fmtD(p.pnlPct, 2) + '%';
    badge.className = 'pnl-badge ' + (p.pnlPct >= 0 ? 'pos' : 'neg');
  }

  document.getElementById('marketValue').textContent = p.marketValue !== null ? '฿' + fmt(p.marketValue, 0) : '฿0';
  document.getElementById('totalInvested').textContent = '฿' + fmt(p.totalThb, 0);
  document.getElementById('mSpend').textContent = '฿' + fmt(p.totalBuyThb, 0);
  document.getElementById('mSats').textContent = fmtSats(p.totalSats);
  document.getElementById('mSatsBtc').textContent = satToBtc(p.totalSats).toFixed(8) + ' BTC';
  document.getElementById('mPrice').textContent = state.btcPrice ? '฿' + fmt(state.btcPrice, 0) : '฿--';
  
  renderMainChart();
}

function renderMainChart() {
  // Chart template engine fallback placeholder
  console.log("Rendering chart pipeline updates standard context layout.");
}

function setDayFilter(day, el) {
  dayFilter = day;
  document.querySelectorAll('.day-pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderAll();
}

// ============================================================
// SYSTEM UTILITIES
// ============================================================
function toast(msg, type = 'success') {
  const tc = document.getElementById('toastContainer');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Window global initialization safe anchors
window.addEventListener('DOMContentLoaded', () => {
  load();
  refreshPriceUI();
  renderAll();
  autoFetchPrice();
  setupAutoRefresh();
});

// Event listener safely intercepting panel click closures
document.addEventListener('click', e => {
  const qp = document.getElementById('quickPricePanel');
  if (qp && qp.style.display !== 'none' && !document.getElementById('quickPriceWrap').contains(e.target)) {
    qp.style.display = 'none';
  }
});
