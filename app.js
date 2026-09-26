const MAX_STOCKS = 20;
let config = null;
let editingIndex = null;
let pollTimer = null;

const el = (id) => document.getElementById(id);

// ---------- persistence ----------

async function load() { config = await getConfig(); }
async function save() { await setConfig(config); }
function backendReady() { return Boolean(config.backendUrl && config.accessToken); }

async function api(path, options = {}) {
  const res = await fetch(`${config.backendUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- push notifications ----------

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    el("pushStatus").textContent = "This browser doesn't support push notifications.";
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      el("pushStatus").textContent = "Notifications permission was not granted — background alerts won't work.";
      return;
    }
    const res = await fetch(`${config.backendUrl.replace(/\/$/, "")}/vapid-public-key`);
    const { publicKey } = await res.json();
    if (!publicKey) {
      el("pushStatus").textContent = "Server has no VAPID key configured yet — background alerts are off until it does.";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await api("/api/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub }) });
    el("pushStatus").textContent = "Background alerts are on for this device.";
  } catch (e) {
    el("pushStatus").textContent = `Couldn't enable background alerts: ${e.message}`;
  }
}

// ---------- foreground alerts ----------

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.15);
    });
  } catch (e) {}
}

function alertUser(title, body) {
  beep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: "icons/icon-192.png" }));
    } else {
      new Notification(title, { body, icon: "icons/icon-192.png" });
    }
  }
}

// ---------- quotes ----------

async function fetchQuote(symbol) {
  return api(`/api/quote?symbol=${encodeURIComponent(symbol)}`, { method: "GET" });
}

function statusFor(stock, price) {
  if (price <= stock.stopLoss) return "stopped";
  if (stock.takeProfit && price >= stock.takeProfit) return "target";
  if (price >= stock.entryLow && price <= stock.entryHigh) return "entry";
  return "watching";
}

async function checkAll() {
  if (!backendReady() || config.stocks.length === 0) return;
  el("checkNow").disabled = true;
  for (const stock of config.stocks) {
    try {
      const q = await fetchQuote(stock.symbol);
      const price = q.c;
      const prevStatus = stock.lastState || "watching";
      const status = statusFor(stock, price);
      stock.lastPrice = price;
      stock.lastChange = q.d;
      stock.lastChecked = Date.now();
      stock.status = status;
      delete stock.error;

      if (status !== "watching" && status !== prevStatus) {
        let msg;
        let title;
        if (status === "stopped") {
          title = "Stop-loss hit";
          msg = `${stock.symbol} hit your stop-loss of $${stock.stopLoss.toFixed(2)} — now $${price.toFixed(2)}`;
        } else if (status === "target") {
          title = "Take-profit reached";
          msg = `${stock.symbol} reached your take-profit of $${stock.takeProfit.toFixed(2)} — now $${price.toFixed(2)}`;
        } else {
          title = "Entry zone reached";
          msg = `${stock.symbol} entered your buy zone ($${stock.entryLow.toFixed(2)}–$${stock.entryHigh.toFixed(2)}) — now $${price.toFixed(2)}`;
        }
        alertUser(title, msg);
      }
      stock.lastState = status;
    } catch (err) {
      stock.error = err.message;
    }
  }
  await save();
  el("updatedLabel").textContent = `checked ${new Date().toLocaleTimeString()}`;
  el("checkNow").disabled = false;
  renderList();
}

async function syncWatchlistToServer() {
  if (!backendReady()) return;
  try {
    await api("/api/watchlist", { method: "PUT", body: JSON.stringify({ stocks: config.stocks }) });
  } catch (e) {}
}

// ---------- rendering: watchlist ----------

function fmt(n) {
  return n === undefined || n === null || Number.isNaN(n) ? "—" : n.toFixed(2);
}

function rangeBar(stock) {
  const p = stock.lastPrice ?? stock.entryHigh;
  let low = Math.min(stock.stopLoss, stock.entryLow, p);
  let high = Math.max(stock.entryHigh, stock.takeProfit || stock.entryHigh, p);
  const pad = (high - low) * 0.2 || 1;
  low -= pad;
  high += pad;
  const span = high - low || 1;
  const pct = (v) => ((v - low) / span) * 100;

  const status = stock.status || "watching";
  const markerClass = status === "entry" ? "in-entry" : status === "stopped" ? "past-stop" : status === "target" ? "in-entry" : "";

  const takeProfitMark = stock.takeProfit
    ? `<div class="stopline" style="left:${pct(stock.takeProfit)}%; background:var(--green)"></div>`
    : "";

  return `
    <div class="range">
      <div class="zone" style="left:${pct(stock.entryLow)}%; width:${pct(stock.entryHigh) - pct(stock.entryLow)}%"></div>
      <div class="stopline" style="left:${pct(stock.stopLoss)}%"></div>
      ${takeProfitMark}
      <div class="marker ${markerClass}" style="left:${pct(p)}%"></div>
    </div>`;
}

function statusLabel(status) {
  if (status === "stopped") return "Stop-loss hit";
  if (status === "target") return "Take-profit reached";
  if (status === "entry") return "In entry zone";
  return "Watching";
}

function card(stock, index) {
  const status = stock.status || "watching";
  const dotClass = status === "entry" || status === "target" ? "entry" : status === "stopped" ? "stopped" : "watching";
  const change = stock.lastChange;
  const deltaClass = change > 0 ? "up" : change < 0 ? "down" : "";
  const deltaText = change !== undefined && change !== null ? `${change > 0 ? "+" : ""}${fmt(change)}` : "";

  return `
    <div class="card">
      <div class="head">
        <div class="symbol">${stock.symbol}</div>
        <div class="status"><span class="dot ${dotClass}"></span>${statusLabel(status)}</div>
      </div>
      <div class="price">$${fmt(stock.lastPrice)}<span class="delta ${deltaClass}">${deltaText}</span></div>
      ${rangeBar(stock)}
      <div class="levels">
        <span>stop $${fmt(stock.stopLoss)}</span>
        <span>entry $${fmt(stock.entryLow)}–$${fmt(stock.entryHigh)}</span>
        <span>target ${stock.takeProfit ? "$" + fmt(stock.takeProfit) : "—"}</span>
      </div>
      <div class="foot">
        <span class="ts">${stock.error ? stock.error : stock.lastChecked ? new Date(stock.lastChecked).toLocaleTimeString() : "not checked yet"}</span>
        <span>
          <button class="linkbtn" data-edit="${index}">Edit</button>
          <button class="linkbtn danger" data-remove="${index}">Remove</button>
        </span>
      </div>
    </div>`;
}

function renderList() {
  const list = el("list");
  const empty = el("emptyState");
  const emptyMsg = el("emptyMessage");
  const count = el("countLabel");

  if (!backendReady()) {
    list.innerHTML = "";
    emptyMsg.textContent = "Add your backend URL and access token in settings to start tracking prices.";
    empty.classList.remove("hidden");
    count.textContent = "";
    el("addToggle").classList.add("hidden");
    return;
  }

  el("addToggle").classList.toggle("hidden", config.stocks.length >= MAX_STOCKS);
  count.textContent = `${config.stocks.length}/${MAX_STOCKS} stocks`;

  if (config.stocks.length === 0) {
    list.innerHTML = "";
    emptyMsg.textContent = "No stocks yet — add your first one below.";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  list.innerHTML = config.stocks.map(card).join("");

  list.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(Number(b.dataset.edit))));
  list.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => removeStock(Number(b.dataset.remove))));
}

function renderSettings() {
  el("backendUrl").value = config.backendUrl || "";
  el("accessToken").value = config.accessToken || "";
  el("pollSeconds").value = config.pollSeconds || 60;
}

// ---------- add/edit stock form ----------

function openAddPanel() {
  el("addPanel").classList.remove("hidden");
  el("symInput").focus();
}

function closeAddPanel() {
  el("addPanel").classList.add("hidden");
  editingIndex = null;
  el("symInput").value = "";
  el("entryLowInput").value = "";
  el("entryHighInput").value = "";
  el("stopLossInput").value = "";
  const tp = el("takeProfitInput");
  if (tp) tp.value = "";
}

function startEdit(index) {
  const s = config.stocks[index];
  editingIndex = index;
  el("symInput").value = s.symbol;
  el("entryLowInput").value = s.entryLow;
  el("entryHighInput").value = s.entryHigh;
  el("stopLossInput").value = s.stopLoss;
  const tp = el("takeProfitInput");
  if (tp) tp.value = s.takeProfit || "";
  openAddPanel();
}

async function removeStock(index) {
  config.stocks.splice(index, 1);
  await save();
  renderList();
  syncWatchlistToServer();
}

async function handleAddStock() {
  const symbol = el("symInput").value.trim().toUpperCase();
  const entryLow = parseFloat(el("entryLowInput").value);
  const entryHigh = parseFloat(el("entryHighInput").value);
  const stopLoss = parseFloat(el("stopLossInput").value);
  const takeProfitRaw = el("takeProfitInput") ? el("takeProfitInput").value : "";
  const takeProfit = takeProfitRaw ? parseFloat(takeProfitRaw) : null;

  if (!symbol || Number.isNaN(entryLow) || Number.isNaN(entryHigh) || Number.isNaN(stopLoss)) {
    alert("Fill in a symbol, entry low, entry high, and stop-loss.");
    return;
  }
  if (stopLoss >= entryLow) {
    alert("Stop-loss should be below your entry range.");
    return;
  }
  if (takeProfit !== null && takeProfit <= entryHigh) {
    alert("Take-profit should be above your entry range.");
    return;
  }

  const entry = { symbol, entryLow, entryHigh, stopLoss, takeProfit, lastState: "watching" };

  if (editingIndex !== null) {
    config.stocks[editingIndex] = { ...config.stocks[editingIndex], ...entry };
  } else {
    if (config.stocks.length >= MAX_STOCKS) {
      alert(`You can track up to ${MAX_STOCKS} stocks at a time.`);
      return;
    }
    if (config.stocks.some((s) => s.symbol === symbol)) {
      alert(`${symbol} is already on your watchlist.`);
      return;
    }
    config.stocks.push(entry);
  }

  await save();
  closeAddPanel();
  renderList();
  checkAll();
  syncWatchlistToServer();
}

async function handleSaveSettings() {
  config.backendUrl = el("backendUrl").value.trim();
  config.accessToken = el("accessToken").value.trim();
  config.pollSeconds = Math.max(30, parseInt(el("pollSeconds").value, 10) || 60);
  await save();

  el("settingsPanel").classList.add("hidden");
  renderList();
  restartPolling();
  if (backendReady()) {
    checkAll();
    syncWatchlistToServer();
    enablePush();
  }
}

// ---------- AI analysis (3-model consensus) ----------

function verdictClass(v) {
  const s = (v || "").toLowerCase();
  if (s === "buy") return "buy";
  if (s === "avoid") return "avoid";
  return "hold";
}

function modelChip(m) {
  if (m.error) return `<span class="model-chip mv-error">${m.name}: n/a</span>`;
  return `<span class="model-chip mv-${verdictClass(m.verdict)}">${m.name}: <span class="mv">${m.verdict}</span></span>`;
}

function renderAnalysis(data) {
  const box = el("analyzeResult");
  if (data.error) {
    box.innerHTML = `<div class="analysis"><p class="error">${data.error}</p></div>`;
    return;
  }
  const modelsRow = (data.models || []).map(modelChip).join("");
  box.innerHTML = `
    <div class="analysis">
      <div class="a-head">
        <div>
          <div class="symbol">${data.symbol}</div>
          <div class="a-price">$${fmt(data.price)} <span class="delta ${data.changePercent >= 0 ? "up" : "down"}">${data.changePercent >= 0 ? "+" : ""}${fmt(data.changePercent)}%</span></div>
        </div>
        <span class="verdict ${verdictClass(data.verdict)}">${data.verdict || "—"}</span>
      </div>
      <div class="agreement">${data.agreement ? `Consensus: ${data.agreement} models agree` : ""}</div>
      <div class="model-breakdown">${modelsRow}</div>
      <div class="grid2">
        <div class="stat"><div class="label">Volatility</div><div class="value">${data.volatility?.rating || "—"}</div></div>
        <div class="stat"><div class="label">Measure</div><div class="value" style="font-size:0.78rem">${data.volatility?.measure || "—"}</div></div>
        <div class="stat"><div class="label">Entry zone</div><div class="value">$${fmt(data.entryZone?.low)}–$${fmt(data.entryZone?.high)}</div></div>
        <div class="stat"><div class="label">Take-profit</div><div class="value">$${fmt(data.exitTarget)}</div></div>
        <div class="stat"><div class="label">Stop-loss</div><div class="value">$${fmt(data.stopLoss)}</div></div>
        <div class="stat"><div class="label">As of</div><div class="value" style="font-size:0.72rem">${new Date(data.asOf).toLocaleTimeString()}</div></div>
      </div>
      <p class="rationale">${data.rationale || ""}</p>
      <p class="disclaimer">${data.disclaimer || "AI-generated — not financial advice."}</p>
      <button class="btn" id="useForWatchlist">Use these levels to add to watchlist</button>
    </div>`;

  const useBtn = document.getElementById("useForWatchlist");
  if (useBtn) {
    useBtn.addEventListener("click", () => {
      openAddPanel();
      el("symInput").value = data.symbol;
      el("entryLowInput").value = data.entryZone?.low ?? "";
      el("entryHighInput").value = data.entryZone?.high ?? "";
      el("stopLossInput").value = data.stopLoss ?? "";
      const tp = el("takeProfitInput");
      if (tp) tp.value = data.exitTarget ?? "";
    });
  }
}

async function handleAnalyze() {
  const symbol = el("analyzeSym").value.trim().toUpperCase();
  if (!symbol) return;
  if (!backendReady()) {
    renderAnalysis({ error: "Add your backend URL and access token in settings first." });
    return;
  }
  el("analyzeBtn").disabled = true;
  el("analyzeResult").innerHTML = `<div class="analysis"><p class="help">Asking Claude, ChatGPT, and Gemini about ${symbol}…</p></div>`;
  try {
    const data = await api("/api/analyze", { method: "POST", body: JSON.stringify({ symbol }) });
    renderAnalysis(data);
  } catch (e) {
    renderAnalysis({ error: e.message });
  }
  el("analyzeBtn").disabled = false;
}

// ---------- polling ----------

function restartPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (!backendReady() || config.stocks.length === 0) return;
  pollTimer = setInterval(checkAll, config.pollSeconds * 1000);
}

// ---------- wiring ----------

async function init() {
  await load();
  renderSettings();
  renderList();

  if (!backendReady()) {
    el("settingsPanel").classList.remove("hidden");
  }

  el("settingsToggle").addEventListener("click", () => el("settingsPanel").classList.toggle("hidden"));
  el("saveSettings").addEventListener("click", handleSaveSettings);
  el("addToggle").addEventListener("click", () => (el("addPanel").classList.contains("hidden") ? openAddPanel() : closeAddPanel()));
  el("addStock").addEventListener("click", handleAddStock);
  el("checkNow").addEventListener("click", checkAll);
  el("analyzeBtn").addEventListener("click", handleAnalyze);

  restartPolling();
  if (backendReady() && config.stocks.length) checkAll();
  if (backendReady()) enablePush();

  // Fix for "doesn't update unless I refresh": Android suspends the JS timer
  // when the tab/app is backgrounded, so the on-screen prices go stale. The
  // moment you switch back to the app, check immediately instead of waiting
  // for the next poll interval to happen to land.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkAll();
  });
  window.addEventListener("focus", () => checkAll());

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // When a background push arrives (server-side alert), the service worker
    // tells any open tab to refresh its data immediately too, so you see the
    // new price/status the instant the alert fires, not just the notification.
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "REFRESH") checkAll();
    });
  }
}

init();
