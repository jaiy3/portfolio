// Live prices in the hero, streamed from MarketPulse over a WebSocket.
// ?mp=ws://localhost:4000/ws points it at a local MarketPulse for development.

const API_ORIGIN = "https://marketpulse-kozq.onrender.com";
const WS_URL = new URLSearchParams(location.search).get("mp") ?? `${API_ORIGIN.replace(/^http/, "ws")}/ws`;

const PAIRS = [
  { symbol: "BTCUSDT", label: "BTC / USDT" },
  { symbol: "ETHUSDT", label: "ETH / USDT" },
  { symbol: "SOLUSDT", label: "SOL / USDT" },
  { symbol: "BNBUSDT", label: "BNB / USDT" },
];

const rowsEl = document.getElementById("live-rows");
const stateEl = document.getElementById("live-state");
const noteEl = document.getElementById("live-note");
const first = {};
const last = {};

for (const pair of PAIRS) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td class="pair">${pair.label}</td><td class="num price" id="p-${pair.symbol}">–</td><td class="num" id="c-${pair.symbol}">–</td>`;
  rowsEl.appendChild(tr);
}

const formatPrice = (n) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

let pending = {};
function queue(tick) {
  pending[tick.symbol] = tick;
}

// Paint at most four times a second; trades can arrive much faster than that.
setInterval(() => {
  for (const tick of Object.values(pending)) {
    const price = Number(tick.price);
    const priceEl = document.getElementById(`p-${tick.symbol}`);
    const chgEl = document.getElementById(`c-${tick.symbol}`);
    if (!priceEl) continue;

    if (first[tick.symbol] === undefined) first[tick.symbol] = price;
    const prev = last[tick.symbol];
    last[tick.symbol] = price;

    priceEl.textContent = formatPrice(price);
    if (prev !== undefined && prev !== price) {
      priceEl.classList.remove("tick-up", "tick-down");
      void priceEl.offsetWidth;
      priceEl.classList.add(price > prev ? "tick-up" : "tick-down");
      setTimeout(() => priceEl.classList.remove("tick-up", "tick-down"), 350);
    }

    const pct = ((price - first[tick.symbol]) / first[tick.symbol]) * 100;
    chgEl.textContent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(3)}%`;
    chgEl.className = `num ${pct >= 0 ? "chg-up" : "chg-down"}`;
  }
  pending = {};
}, 250);

function setState(kind, text, note) {
  stateEl.className = `live-state ${kind}`;
  stateEl.textContent = text;
  if (note !== undefined) noteEl.textContent = note;
}

let attempt = 0;
let received = 0;
let wakeTimer;
let silenceTimer;
let live = false;

function markLive() {
  if (live) return;
  live = true;
  clearTimeout(silenceTimer);
  setState("on", "Live", "Every trade on Binance for these pairs, as it happens.");
}

// Quiet pairs may not have traded within the API's 30-second cache window.
// Fill them from the last stored trade so the table is never half empty.
async function fillFromHistory(have) {
  await Promise.all(
    PAIRS.filter((p) => !have.includes(p.symbol)).map(async (p) => {
      try {
        const res = await fetch(`${API_ORIGIN}/api/market/history?symbol=${p.symbol}&limit=1`);
        const item = (await res.json()).data?.items?.[0];
        if (item && last[p.symbol] === undefined && !pending[p.symbol]) {
          queue({ symbol: p.symbol, price: item.price, quantity: item.quantity, eventTime: Date.parse(item.eventTime) });
        }
      } catch {
        /* leave the row waiting */
      }
    })
  );
}

function connect() {
  attempt += 1;
  setState("", "Connecting");
  let socket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    return fail();
  }

  // Free hosting sleeps when idle; the first connection can take ~30s.
  wakeTimer = setTimeout(() => {
    if (received === 0) noteEl.textContent = "The server is waking up from idle. This takes up to 30 seconds on free hosting.";
  }, 4000);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "subscribe", symbols: PAIRS.map((p) => p.symbol) }));
  });

  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "subscribed") {
      attempt = 0;
      clearTimeout(wakeTimer);
      const snapshot = msg.snapshot ?? [];
      void fillFromHistory(snapshot.map((t) => t.symbol));
      if (snapshot.length > 0) {
        markLive();
        snapshot.forEach(queue);
      } else {
        // Connected, but only claim "Live" once a price actually arrives.
        setState("", "Connected", "Waiting for the first trade…");
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (received === 0) setState("off", "Paused", "Connected, but no trades are arriving. The price feed may be paused.");
        }, 10000);
      }
      return;
    }
    if (msg.symbol) {
      received += 1;
      markLive();
      queue(msg);
    }
  });

  socket.addEventListener("close", () => {
    clearTimeout(wakeTimer);
    clearTimeout(silenceTimer);
    live = false;
    if (attempt >= 6) return fail();
    setState("", "Reconnecting");
    setTimeout(connect, Math.min(2000 * attempt, 10000));
  });
}

function fail() {
  setState("off", "Offline");
  noteEl.innerHTML = `The live feed isn't reachable right now. <a href="${API_ORIGIN}">Open the dashboard</a> to wake it.`;
}

// Nudge the API awake as early as possible, before the WebSocket handshake.
fetch(`${API_ORIGIN}/health`, { mode: "no-cors" }).catch(() => {});
connect();
