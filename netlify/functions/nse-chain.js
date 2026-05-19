// netlify/functions/nse-chain.js
// Proxies NSE India option chain API — bypasses browser CORS restrictions
// Deploy on Netlify → your frontend calls /.netlify/functions/nse-chain

const https = require("https");

// NSE requires these headers or it returns 401/403
const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://www.nseindia.com/option-chain",
  "Origin": "https://www.nseindia.com",
  "Connection": "keep-alive",
  "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

// NSE session cookie — needed for option chain API
// We first hit the main page to get a session cookie, then hit the API
function fetchWithCookie(url, cookie = "") {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        ...NSE_HEADERS,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    https.get(url, options, (res) => {
      const chunks = [];
      const encoding = res.headers["content-encoding"];
      
      // Handle gzip/deflate
      let stream = res;
      if (encoding === "gzip" || encoding === "br") {
        const zlib = require("zlib");
        const decompress = encoding === "gzip" ? zlib.createGunzip() : zlib.createBrotliDecompress();
        stream = res.pipe(decompress);
      }

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({ body, headers: res.headers, statusCode: res.statusCode });
      });
      stream.on("error", reject);
    }).on("error", reject);
  });
}

// Extract Set-Cookie header value
function extractCookies(headers) {
  const raw = headers["set-cookie"] || [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

// Calculate Max Pain from option chain data
function calcMaxPain(records) {
  const strikes = [...new Set(records.map((r) => r.strikePrice))].sort((a, b) => a - b);
  let minLoss = Infinity;
  let maxPainStrike = strikes[0];

  for (const testStrike of strikes) {
    let totalLoss = 0;
    for (const r of records) {
      const K = r.strikePrice;
      // Loss to call writers if testStrike > K
      if (r.CE && testStrike > K) totalLoss += (testStrike - K) * (r.CE.openInterest || 0);
      // Loss to put writers if testStrike < K
      if (r.PE && testStrike < K) totalLoss += (K - testStrike) * (r.PE.openInterest || 0);
    }
    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainStrike = testStrike;
    }
  }
  return maxPainStrike;
}

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    // Step 1: Hit NSE homepage to get session cookies
    const homeRes = await fetchWithCookie("https://www.nseindia.com");
    const cookie = extractCookies(homeRes.headers);

    if (!cookie) {
      throw new Error("Could not obtain NSE session cookie");
    }

    // Step 2: Fetch option chain
    const chainUrl = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
    const chainRes = await fetchWithCookie(chainUrl, cookie);

    if (chainRes.statusCode !== 200) {
      throw new Error(`NSE returned status ${chainRes.statusCode}`);
    }

    const raw = JSON.parse(chainRes.body);
    const records = raw.records?.data || [];
    const filtered = raw.filtered?.data || records;
    const underlying = raw.records?.underlyingValue || 0;
    const expiryDates = raw.records?.expiryDates || [];

    // Step 3: Fetch India VIX from NSE
    let vix = 0;
    try {
      const vixUrl = "https://www.nseindia.com/api/allIndices";
      const vixRes = await fetchWithCookie(vixUrl, cookie);
      const vixData = JSON.parse(vixRes.body);
      const vixItem = vixData.data?.find((d) => d.index === "INDIA VIX");
      vix = vixItem?.last || 0;
    } catch (e) {
      console.warn("VIX fetch failed:", e.message);
    }

    // Step 4: Process option chain
    const optionChain = {};
    let totalCEOI = 0;
    let totalPEOI = 0;

    for (const rec of filtered) {
      const K = rec.strikePrice;
      optionChain[K] = {
        ce: {
          ltp: rec.CE?.lastPrice || 0,
          oi: parseFloat(((rec.CE?.openInterest || 0) / 100000).toFixed(2)),
          oiChange: parseFloat((rec.CE?.changeinOpenInterest || 0).toFixed(2)),
          oiChangePct: rec.CE?.openInterest > 0
            ? parseFloat(((rec.CE.changeinOpenInterest / rec.CE.openInterest) * 100).toFixed(1))
            : 0,
          iv: parseFloat((rec.CE?.impliedVolatility || 0).toFixed(1)),
          volume: rec.CE?.totalTradedVolume || 0,
          bidQty: rec.CE?.bidQty || 0,
          askQty: rec.CE?.askQty || 0,
        },
        pe: {
          ltp: rec.PE?.lastPrice || 0,
          oi: parseFloat(((rec.PE?.openInterest || 0) / 100000).toFixed(2)),
          oiChange: parseFloat((rec.PE?.changeinOpenInterest || 0).toFixed(2)),
          oiChangePct: rec.PE?.openInterest > 0
            ? parseFloat(((rec.PE.changeinOpenInterest / rec.PE.openInterest) * 100).toFixed(1))
            : 0,
          iv: parseFloat((rec.PE?.impliedVolatility || 0).toFixed(1)),
          volume: rec.PE?.totalTradedVolume || 0,
          bidQty: rec.PE?.bidQty || 0,
          askQty: rec.PE?.askQty || 0,
        },
      };
      totalCEOI += rec.CE?.openInterest || 0;
      totalPEOI += rec.PE?.openInterest || 0;
    }

    // Step 5: Calculate derived values
    const maxPain = calcMaxPain(records);
    const pcr = totalCEOI > 0 ? parseFloat((totalPEOI / totalCEOI).toFixed(2)) : 1;

    // Step 6: Get today's Nifty OHLC (approximate from underlying + intraday range)
    // NSE option chain only gives spot — for high/low we use a secondary endpoint
    let high = underlying, low = underlying;
    try {
      const ohlcUrl = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050";
      const ohlcRes = await fetchWithCookie(ohlcUrl, cookie);
      const ohlcData = JSON.parse(ohlcRes.body);
      const niftyRow = ohlcData.data?.find((d) => d.symbol === "NIFTY 50" || d.index === "NIFTY 50");
      if (niftyRow) {
        high = niftyRow.dayHigh || underlying;
        low = niftyRow.dayLow || underlying;
      }
    } catch (e) {
      console.warn("OHLC fetch failed:", e.message);
    }

    const response = {
      spot: underlying,
      high,
      low,
      vix: parseFloat(vix.toFixed(2)),
      maxPain,
      pcr,
      totalCEOI: parseFloat((totalCEOI / 100000).toFixed(0)),
      totalPEOI: parseFloat((totalPEOI / 100000).toFixed(0)),
      expiryDates: expiryDates.slice(0, 5),
      optionChain,
      timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      source: "NSE India Live",
    };

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify(response),
    };
  } catch (err) {
    console.error("NSE proxy error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({
        error: err.message,
        hint: "NSE may be down, market may be closed, or session cookie fetch failed. Using fallback data.",
      }),
    };
  }
};
                                            
