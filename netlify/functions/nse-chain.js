// netlify/functions/nse-chain.js
// NSE Option Chain proxy with robust session handling
// Handles NSE anti-bot protection via two-step cookie fetch

const https = require("https");
const zlib = require("zlib");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

// Step 1: fetch a page to get cookies, Step 2: use cookies to fetch API
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      let stream = res;

      if (res.headers["content-encoding"] === "gzip") {
        stream = res.pipe(zlib.createGunzip());
      } else if (res.headers["content-encoding"] === "br") {
        stream = res.pipe(zlib.createBrotliDecompress());
      } else if (res.headers["content-encoding"] === "deflate") {
        stream = res.pipe(zlib.createInflate());
      }

      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers,
          status: res.statusCode,
        })
      );
      stream.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function getCookies(headers) {
  return (headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
}

// NSE Base headers
function nseHeaders(cookie = "", referer = "https://www.nseindia.com/option-chain") {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: referer,
    Origin: "https://www.nseindia.com",
    Connection: "keep-alive",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

// Calculate Max Pain
function calcMaxPain(records) {
  const strikes = [...new Set(records.map((r) => r.strikePrice))].sort((a, b) => a - b);
  let minLoss = Infinity, maxPainStrike = strikes[0];
  for (const testK of strikes) {
    let loss = 0;
    for (const r of records) {
      const K = r.strikePrice;
      if (r.CE && testK > K) loss += (testK - K) * (r.CE.openInterest || 0);
      if (r.PE && testK < K) loss += (K - testK) * (r.PE.openInterest || 0);
    }
    if (loss < minLoss) { minLoss = loss; maxPainStrike = testK; }
  }
  return maxPainStrike;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    // ── STEP 1: Get session cookies from NSE homepage ──
    let cookie = "";
    try {
      const home = await httpsGet("https://www.nseindia.com", nseHeaders());
      cookie = getCookies(home.headers);
      // Also hit option-chain page to get additional cookies
      if (cookie) {
        const oc = await httpsGet("https://www.nseindia.com/option-chain", nseHeaders(cookie));
        const ocCookies = getCookies(oc.headers);
        if (ocCookies) cookie = cookie + "; " + ocCookies;
      }
    } catch (e) {
      console.warn("Cookie fetch failed:", e.message);
    }

    if (!cookie) throw new Error("Could not obtain NSE session — market may be closed");

    // ── STEP 2: Fetch option chain ──
    const chainUrl = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
    const chainRes = await httpsGet(chainUrl, nseHeaders(cookie));

    if (chainRes.status !== 200) {
      throw new Error(`NSE option chain returned HTTP ${chainRes.status}`);
    }

    let raw;
    try {
      raw = JSON.parse(chainRes.body);
    } catch (e) {
      throw new Error("NSE returned non-JSON response — likely blocked or session expired");
    }

    const records = raw.records?.data || [];
    const filtered = raw.filtered?.data || records;
    const underlying = raw.records?.underlyingValue || 0;
    const expiryDates = raw.records?.expiryDates || [];

    if (!underlying) throw new Error("No underlying value in NSE response");

    // ── STEP 3: Fetch India VIX ──
    let vix = 0;
    try {
      const vixRes = await httpsGet(
        "https://www.nseindia.com/api/allIndices",
        nseHeaders(cookie, "https://www.nseindia.com/market-data/live-market-indices")
      );
      const vixData = JSON.parse(vixRes.body);
      const vixRow = vixData.data?.find((d) => d.index === "INDIA VIX");
      vix = vixRow?.last || vixRow?.previousClose || 0;
    } catch (e) {
      console.warn("VIX fetch failed:", e.message);
    }

    // ── STEP 4: Fetch Nifty OHLC ──
    let high = underlying, low = underlying;
    try {
      const ohlcRes = await httpsGet(
        "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
        nseHeaders(cookie, "https://www.nseindia.com/market-data/live-market-indices")
      );
      const ohlcData = JSON.parse(ohlcRes.body);
      const row = ohlcData.data?.find((d) => d.index === "NIFTY 50" || d.symbol === "NIFTY 50");
      if (row) { high = row.dayHigh || underlying; low = row.dayLow || underlying; }
    } catch (e) {
      console.warn("OHLC fetch failed:", e.message);
    }

    // ── STEP 5: Process option chain data ──
    const optionChain = {};
    let totalCEOI = 0, totalPEOI = 0;

    // Use only strikes within ±10% of spot for cleaner data
    const relevantStrikes = filtered.filter(
      (r) => Math.abs(r.strikePrice - underlying) / underlying <= 0.06
    );
    const dataToUse = relevantStrikes.length >= 5 ? relevantStrikes : filtered;

    for (const rec of dataToUse) {
      const K = rec.strikePrice;
      const ceOI = rec.CE?.openInterest || 0;
      const peOI = rec.PE?.openInterest || 0;
      optionChain[K] = {
        ce: {
          ltp: rec.CE?.lastPrice || 0,
          oi: parseFloat((ceOI / 100000).toFixed(2)),
          oiChange: rec.CE?.changeinOpenInterest || 0,
          oiChangePct: ceOI > 0
            ? parseFloat(((rec.CE.changeinOpenInterest / ceOI) * 100).toFixed(1))
            : 0,
          iv: parseFloat((rec.CE?.impliedVolatility || 0).toFixed(1)),
          volume: rec.CE?.totalTradedVolume || 0,
        },
        pe: {
          ltp: rec.PE?.lastPrice || 0,
          oi: parseFloat((peOI / 100000).toFixed(2)),
          oiChange: rec.PE?.changeinOpenInterest || 0,
          oiChangePct: peOI > 0
            ? parseFloat(((rec.PE.changeinOpenInterest / peOI) * 100).toFixed(1))
            : 0,
          iv: parseFloat((rec.PE?.impliedVolatility || 0).toFixed(1)),
          volume: rec.PE?.totalTradedVolume || 0,
        },
      };
      totalCEOI += ceOI;
      totalPEOI += peOI;
    }

    const maxPain = calcMaxPain(records);
    const pcr = totalCEOI > 0 ? parseFloat((totalPEOI / totalCEOI).toFixed(2)) : 1.0;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        spot: underlying,
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        vix: parseFloat(vix.toFixed(2)),
        maxPain,
        pcr,
        totalCEOI: parseFloat((totalCEOI / 100000).toFixed(0)),
        totalPEOI: parseFloat((totalPEOI / 100000).toFixed(0)),
        expiryDates: expiryDates.slice(0, 5),
        optionChain,
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        source: "NSE India Live",
      }),
    };
  } catch (err) {
    console.error("nse-chain error:", err.message);

    // Return structured error so frontend can show demo fallback cleanly
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: err.message,
        hint: "NSE blocked or market closed. Frontend will use demo data.",
      }),
    };
  }
}
            
