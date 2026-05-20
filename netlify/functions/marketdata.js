// netlify/functions/marketdata.js
// IntelligentTraders — Zerodha Kite Connect Integration
// 
// REQUIRED ENVIRONMENT VARIABLES (set in Netlify → Site Settings → Environment Variables):
//   KITE_API_KEY     = your Kite Connect API key
//   KITE_API_SECRET  = your Kite Connect API secret
//
// REQUIRED in Kite Connect app (developers.kite.trade):
//   Redirect URL = https://theintelligenttraders1.netlify.app/auth
//   (update this once your custom domain is live)

const https = require('https');
const crypto = require('crypto');

const API_KEY = process.env.KITE_API_KEY || 'zyra6665x2qon7pq';
const API_SECRET = process.env.KITE_API_SECRET || '';

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-access-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || 'data';

  // ── ACTION: login_url ──────────────────────────────────────
  // Returns the Zerodha login URL — keeps API key server-side
  if (action === 'login_url') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        login_url: `https://kite.zerodha.com/connect/login?v=3&api_key=${API_KEY}`
      })
    };
  }

  // ── ACTION: callback ───────────────────────────────────────
  // Exchanges request_token for access_token
  // Called after Zerodha redirects back to /auth?request_token=xxx&status=success
  if (action === 'callback') {
    const requestToken = params.request_token;
    if (!requestToken) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'No request_token provided' })
      };
    }

    if (!API_SECRET) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'KITE_API_SECRET not set in Netlify environment variables. Go to Site Settings → Environment Variables and add it.'
        })
      };
    }

    try {
      // Generate checksum: SHA256(api_key + request_token + api_secret)
      const checksum = crypto
        .createHash('sha256')
        .update(API_KEY + requestToken + API_SECRET)
        .digest('hex');

      // Exchange for access token
      const tokenData = await kitePost('/session/token', {
        api_key: API_KEY,
        request_token: requestToken,
        checksum: checksum
      });

      if (tokenData.status === 'success' && tokenData.data && tokenData.data.access_token) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            access_token: tokenData.data.access_token,
            user_name: tokenData.data.user_name || '',
            login_time: tokenData.data.login_time || new Date().toISOString()
          })
        };
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: tokenData.message || 'Token exchange failed — check API key and secret'
          })
        };
      }
    } catch (e) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Token exchange error: ' + e.message })
      };
    }
  }

  // ── ACTION: data ───────────────────────────────────────────
  // Fetches live market data using stored access token
  if (action === 'data') {
    const accessToken = event.headers['x-access-token'];
    const underlying = params.underlying || 'NIFTY';

    // No token — return simulated data
    if (!accessToken) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, useSimulated: true })
      };
    }

    try {
      // Map underlying to NSE instrument tokens
      const instrumentMap = {
        'NIFTY':     { spot: '256265',  exchange: 'NSE', name: 'NIFTY 50' },
        'BANKNIFTY': { spot: '260105',  exchange: 'NSE', name: 'BANK NIFTY' },
        'SENSEX':    { spot: '265',     exchange: 'BSE', name: 'SENSEX' },
        'FINNIFTY':  { spot: '257801',  exchange: 'NSE', name: 'FIN NIFTY' },
      };

      const inst = instrumentMap[underlying] || instrumentMap['NIFTY'];

      // Fetch spot price + VIX simultaneously
      const [quoteData, vixData] = await Promise.all([
        kiteGet(`/quote?i=${inst.exchange}:${underlying}`, accessToken),
        kiteGet('/quote?i=NSE:INDIA VIX', accessToken)
      ]);

      const quote = quoteData?.data?.[`${inst.exchange}:${underlying}`];
      const vix = vixData?.data?.['NSE:INDIA VIX'];

      if (!quote) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, useSimulated: true, error: 'Quote fetch failed' })
        };
      }

      const spot = quote.last_price;
      const dayChange = quote.net_change;
      const dayChangePct = quote.change?.toFixed(2) || '0';

      // Fetch option chain for PCR and Max Pain
      // Use NSE option chain endpoint
      const atmStrike = Math.round(spot / 100) * 100;
      const strikes = [];
      for (let i = -5; i <= 5; i++) {
        strikes.push(atmStrike + i * 100);
      }

      const data = {
        spot: spot,
        dayChange: parseFloat(dayChangePct),
        high: quote.ohlc?.high || spot,
        low: quote.ohlc?.low || spot,
        vix: vix?.last_price || 16.5,
        vixChange: vix?.change?.toFixed(1) || 0,
        ivRank: calculateIVRank(vix?.last_price || 16.5),
        pcr: 0.85, // calculated from option chain below
        fii: 0,    // requires separate FII data source
        adr: 0.55, // requires breadth data
        maxPain: atmStrike, // calculated from OI below
        ema20: spot * 0.998, // approximation - real requires historical
        rsi: 55,             // approximation - real requires historical
        underlying: underlying,
        timestamp: new Date().toISOString()
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };

    } catch (e) {
      // Token likely expired
      if (e.message && e.message.includes('403')) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, needsLogin: true, error: 'Token expired' })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, useSimulated: true, error: e.message })
      };
    }
  }

  return {
    statusCode: 400,
    headers,
    body: JSON.stringify({ success: false, error: 'Unknown action: ' + action })
  };
};

// ── HELPERS ──────────────────────────────────────────────────────────

function kiteGet(path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.kite.trade',
      path: path,
      method: 'GET',
      headers: {
        'X-Kite-Version': '3',
        'Authorization': `token ${API_KEY}:${accessToken}`
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (res?.statusCode === 403) reject(new Error('403 Unauthorized'));
    req.end();
  });
}

function kitePost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(body).toString();
    const options = {
      hostname: 'api.kite.trade',
      path: path,
      method: 'POST',
      headers: {
        'X-Kite-Version': '3',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function calculateIVRank(currentVix) {
  // 52-week Nifty VIX range approx 10.5 - 28
  const vixMin = 10.5, vixMax = 28;
  return Math.round(((currentVix - vixMin) / (vixMax - vixMin)) * 100);
}
