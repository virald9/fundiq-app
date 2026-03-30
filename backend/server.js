/**
 * FundIQ Backend Server
 * ─────────────────────
 * Free stack:
 *   • mfapi.in      — Live NAV data (free, no auth)
 *   • AMFI India    — Official NAV feed (free)
 *   • Razorpay      — Subscriptions (2% per txn, no monthly fee)
 *   • Anthropic     — Claude AI (pay-per-use, ~₹0.01/query)
 *   • Vercel        — Hosting (free tier)
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// ── ENV VARS (set in Vercel dashboard or .env file) ──
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────────────
// SECTION 1: LIVE MF DATA (mfapi.in — completely free)
// ─────────────────────────────────────────────────────

// Simple in-memory cache to avoid hammering mfapi
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 min

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function cached(key, fn, ttl = CACHE_TTL) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
  return fn().then(data => { cache.set(key, { data, ts: Date.now() }); return data; });
}

/**
 * GET /api/funds/search?q=parag+parikh
 * Searches all MF schemes by name using mfapi.in
 */
app.get('/api/funds/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q || q.length < 2) return res.json([]);

    const allFunds = await cached('all_funds', () =>
      fetchJson('https://api.mfapi.in/mf')
    );

    const results = allFunds
      .filter(f => f.schemeName.toLowerCase().includes(q))
      .slice(0, 20)
      .map(f => ({
        schemeCode: f.schemeCode,
        schemeName: f.schemeName,
      }));

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: 'Failed to search funds', detail: e.message });
  }
});

/**
 * GET /api/funds/:schemeCode
 * Returns live NAV + scheme details for a single fund
 */
app.get('/api/funds/:schemeCode', async (req, res) => {
  try {
    const { schemeCode } = req.params;
    const data = await cached(`fund_${schemeCode}`, () =>
      fetchJson(`https://api.mfapi.in/mf/${schemeCode}`)
    , 10 * 60 * 1000); // 10 min for individual fund

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch fund', detail: e.message });
  }
});

/**
 * GET /api/funds/:schemeCode/nav-history
 * Returns historical NAV (used for charts and return calculations)
 */
app.get('/api/funds/:schemeCode/nav-history', async (req, res) => {
  try {
    const { schemeCode } = req.params;
    const data = await cached(`history_${schemeCode}`, () =>
      fetchJson(`https://api.mfapi.in/mf/${schemeCode}`)
    , 60 * 60 * 1000); // 1 hour cache

    const navData = (data.data || []).slice(0, 365 * 5); // last 5 years max
    res.json({ schemeCode, meta: data.meta, history: navData });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history', detail: e.message });
  }
});

/**
 * POST /api/funds/compare
 * Body: { schemeCodes: [119598, 120503] }
 * Returns side-by-side fund data for comparison
 */
app.post('/api/funds/compare', async (req, res) => {
  try {
    const { schemeCodes = [] } = req.body;
    if (!schemeCodes.length || schemeCodes.length > 5) {
      return res.status(400).json({ error: 'Provide 2-5 scheme codes' });
    }

    const funds = await Promise.all(
      schemeCodes.map(code =>
        cached(`fund_${code}`, () => fetchJson(`https://api.mfapi.in/mf/${code}`), 10 * 60 * 1000)
      )
    );

    const comparison = funds.map(fund => {
      const navs = fund.data || [];
      const latestNav = parseFloat(navs[0]?.nav || 0);
      const nav1yAgo = parseFloat(navs[252]?.nav || latestNav);
      const nav3yAgo = parseFloat(navs[756]?.nav || latestNav);
      const nav5yAgo = parseFloat(navs[1260]?.nav || latestNav);

      return {
        meta: fund.meta,
        latestNav,
        latestDate: navs[0]?.date,
        returns: {
          '1Y': nav1yAgo ? (((latestNav - nav1yAgo) / nav1yAgo) * 100).toFixed(2) : null,
          '3Y': nav3yAgo ? (((latestNav - nav3yAgo) / nav3yAgo) * 100).toFixed(2) : null,
          '5Y': nav5yAgo ? (((latestNav - nav5yAgo) / nav5yAgo) * 100).toFixed(2) : null,
        },
        dataPoints: navs.length,
      };
    });

    res.json(comparison);
  } catch (e) {
    res.status(500).json({ error: 'Comparison failed', detail: e.message });
  }
});

/**
 * POST /api/portfolio/xirr
 * Calculates XIRR for a portfolio
 * Body: { transactions: [{ date, amount, units, nav }], currentNav, currentDate }
 */
app.post('/api/portfolio/xirr', (req, res) => {
  try {
    const { transactions, currentNav } = req.body;

    // XIRR using Newton-Raphson method
    function xirr(cashflows, dates) {
      let rate = 0.1;
      for (let i = 0; i < 100; i++) {
        let npv = 0, dnpv = 0;
        const t0 = dates[0].getTime();
        for (let j = 0; j < cashflows.length; j++) {
          const t = (dates[j].getTime() - t0) / (365.25 * 24 * 3600 * 1000);
          const v = cashflows[j] / Math.pow(1 + rate, t);
          npv += v;
          dnpv += -t * v / (1 + rate);
        }
        const newRate = rate - npv / dnpv;
        if (Math.abs(newRate - rate) < 1e-7) return newRate;
        rate = newRate;
      }
      return rate;
    }

    const cashflows = transactions.map(t => -Math.abs(t.amount));
    const currentValue = transactions.reduce((s, t) => s + t.units, 0) * currentNav;
    cashflows.push(currentValue);

    const dates = transactions.map(t => new Date(t.date));
    dates.push(new Date());

    const xirrRate = xirr(cashflows, dates);
    res.json({
      xirr: (xirrRate * 100).toFixed(2),
      currentValue: currentValue.toFixed(2),
      totalInvested: transactions.reduce((s, t) => s + Math.abs(t.amount), 0).toFixed(2),
    });
  } catch (e) {
    res.status(500).json({ error: 'XIRR calculation failed', detail: e.message });
  }
});

/**
 * POST /api/portfolio/overlap
 * Detects stock overlap between funds
 * Body: { funds: [{ name, topHoldings: ['HDFC Bank', 'Infosys', ...] }] }
 */
app.post('/api/portfolio/overlap', (req, res) => {
  try {
    const { funds } = req.body;
    const stockCount = {};
    const stockFunds = {};

    funds.forEach(fund => {
      (fund.topHoldings || []).forEach(stock => {
        stockCount[stock] = (stockCount[stock] || 0) + 1;
        if (!stockFunds[stock]) stockFunds[stock] = [];
        stockFunds[stock].push(fund.name);
      });
    });

    const overlaps = Object.entries(stockCount)
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([stock, count]) => ({
        stock,
        count,
        funds: stockFunds[stock],
        severity: count >= funds.length ? 'high' : count >= funds.length / 2 ? 'medium' : 'low',
      }));

    res.json({ overlaps, totalFunds: funds.length });
  } catch (e) {
    res.status(500).json({ error: 'Overlap analysis failed', detail: e.message });
  }
});

// ─────────────────────────────────────────────────────
// SECTION 2: AI CHAT (Anthropic Claude)
// ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are FundIQ AI, India's most knowledgeable mutual fund research analyst.

RULES (strictly follow):
1. You are a RESEARCH tool ONLY. Never say "buy this fund" or "invest now."
2. Always end with: "⚠️ Research only — not investment advice. Consult a SEBI-registered advisor."
3. Be data-driven. Use real metrics: expense ratio, AUM, Sharpe ratio, alpha, XIRR, rolling returns.
4. You cover: all SEBI-registered MFs (equity, debt, hybrid, FOF, ETF, ELSS, index), category analysis, 
   tax (LTCG/STCG/ELSS lock-in), SIP math, fund manager analysis, AMC reputation, benchmark comparison.
5. Format with bullet points and bold headers for readability.
6. When asked to compare funds, structure your response as a comparison table in text.
7. For tax questions: LTCG on equity MFs > 1 year = 10% above ₹1L. STCG < 1 year = 15%. 
   Debt MFs: taxed at slab rate regardless of holding period (post April 2023 rule change).

KNOWLEDGE:
- Top performing large cap funds: Mirae Asset Large Cap (0.54% ER), HDFC Top 100 (0.64%)
- Top flexi cap: Parag Parikh (0.63% ER, global exposure), HDFC Flexi Cap, SBI Flexi Cap
- Top small cap: Nippon India Small Cap, SBI Small Cap, Quant Small Cap
- Top ELSS: Mirae Asset Tax Saver, DSP Tax Saver, Quant Tax Plan
- Top debt: HDFC Corporate Bond, ICICI Pru All Seasons Bond, SBI Magnum Medium Duration
- Key AMCs: HDFC MF (largest), SBI MF, ICICI Pru, Mirae Asset, Parag Parikh, Axis, Kotak, Nippon`;

/**
 * POST /api/chat
 * Body: { messages: [{role, content}], userPlan: 'free'|'premium'|'pro' }
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, userPlan = 'free' } = req.body;
    const queryLimit = { free: 10, premium: 500, pro: 1000 };

    // Rate limit check would go here with Redis in production
    // For now, just proxy to Anthropic

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-10), // keep last 10 msgs for context
      }),
    });

    const data = await response.json();
    res.json({ reply: data.content?.[0]?.text || 'Sorry, please try again.' });
  } catch (e) {
    res.status(500).json({ error: 'AI chat failed', detail: e.message });
  }
});

// ─────────────────────────────────────────────────────
// SECTION 3: RAZORPAY SUBSCRIPTIONS (free to set up)
// ─────────────────────────────────────────────────────

function razorpayRequest(path, method = 'GET', body = null) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.razorpay.com',
      path: `/v1${path}`,
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * POST /api/billing/create-subscription
 * Creates a Razorpay subscription for a plan
 * Body: { planId: 'premium'|'pro', customerEmail, customerName, customerPhone }
 */
app.post('/api/billing/create-subscription', async (req, res) => {
  try {
    const { planId, customerEmail, customerName, customerPhone } = req.body;

    // Razorpay Plan IDs (create these once in your Razorpay dashboard)
    const PLAN_IDS = {
      premium_monthly: process.env.RZP_PLAN_PREM_MONTHLY,
      premium_yearly: process.env.RZP_PLAN_PREM_YEARLY,
      pro_monthly: process.env.RZP_PLAN_PRO_MONTHLY,
      pro_yearly: process.env.RZP_PLAN_PRO_YEARLY,
    };

    const rzpPlanId = PLAN_IDS[planId];
    if (!rzpPlanId) return res.status(400).json({ error: 'Invalid plan' });

    // Step 1: Create/find customer
    const customer = await razorpayRequest('/customers', 'POST', {
      name: customerName,
      email: customerEmail,
      contact: customerPhone,
    });

    // Step 2: Create subscription
    const subscription = await razorpayRequest('/subscriptions', 'POST', {
      plan_id: rzpPlanId,
      customer_notify: 1,
      quantity: 1,
      total_count: 12, // 12 billing cycles (1 year for monthly, irrelevant for yearly)
      customer_id: customer.id,
      notes: { plan: planId, email: customerEmail },
    });

    res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      razorpayKeyId: RAZORPAY_KEY_ID,
    });
  } catch (e) {
    res.status(500).json({ error: 'Subscription creation failed', detail: e.message });
  }
});

/**
 * POST /api/billing/webhook
 * Razorpay sends events here. Verify signature and update user plan.
 */
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const digest = crypto
      .createHmac('sha256', secret)
      .update(req.body)
      .digest('hex');

    if (digest !== signature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body);
    console.log('Razorpay webhook:', event.event);

    // Handle subscription events
    switch (event.event) {
      case 'subscription.activated':
        // TODO: Update user plan in your DB (Supabase/PlanetScale free tier)
        // updateUserPlan(event.payload.subscription.entity.notes.email, 'premium')
        console.log('Subscription activated:', event.payload.subscription.entity.id);
        break;
      case 'subscription.charged':
        console.log('Subscription charged:', event.payload.payment.entity.amount / 100);
        break;
      case 'subscription.cancelled':
        // TODO: Downgrade user to free plan
        console.log('Subscription cancelled');
        break;
      case 'subscription.halted':
        // Payment failed repeatedly — notify user
        console.log('Subscription halted — notify user');
        break;
    }

    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'Webhook error' });
  }
});

/**
 * GET /api/billing/plans
 * Returns available subscription plans with pricing
 */
app.get('/api/billing/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'free',
        name: 'Standard',
        price: 0,
        period: 'forever',
        queries: 10,
        features: ['Basic screener', '1Y NAV history', 'Compare 3 funds'],
      },
      {
        id: 'premium_yearly',
        name: 'Premium',
        price: 5999,
        monthlyEquiv: 500,
        period: 'year',
        savings: 'Save ₹4,000 vs monthly',
        queries: 500,
        features: ['Advanced screener', '10Y NAV history', 'CAS import', 'Overlap analyser', 'Daily alerts'],
      },
      {
        id: 'pro_yearly',
        name: 'Professional',
        price: 9999,
        monthlyEquiv: 833,
        period: 'year',
        savings: 'Save ₹6,000 vs monthly',
        queries: 1000,
        features: ['20Y NAV history', 'Tax P&L engine', 'Rolling returns', 'US MFs', 'Data export', 'Real-time alerts'],
      },
    ],
  });
});

// ─────────────────────────────────────────────────────
// SECTION 4: SCREENER API (uses mfapi data)
// ─────────────────────────────────────────────────────

/**
 * GET /api/screener?category=equity&minReturn3y=15&sortBy=return3y&limit=50
 * Filters and sorts funds — uses curated dataset + mfapi live NAV
 */
app.get('/api/screener', async (req, res) => {
  try {
    // In production: fetch from mfapi and combine with cached analytics
    // For now: return enriched curated list
    const { category, minReturn3y, sortBy = 'return3y', limit = 20 } = req.query;

    let funds = CURATED_FUNDS;

    if (category) funds = funds.filter(f => f.category === category);
    if (minReturn3y) funds = funds.filter(f => f.return3y >= parseFloat(minReturn3y));

    funds.sort((a, b) => {
      if (sortBy === 'return3y') return b.return3y - a.return3y;
      if (sortBy === 'return1y') return b.return1y - a.return1y;
      if (sortBy === 'aum') return b.aum - a.aum;
      if (sortBy === 'expense') return a.expenseRatio - b.expenseRatio;
      return 0;
    });

    res.json(funds.slice(0, parseInt(limit)));
  } catch (e) {
    res.status(500).json({ error: 'Screener failed', detail: e.message });
  }
});

// Curated fund dataset (expand this from mfapi.in + Value Research data)
const CURATED_FUNDS = [
  { schemeCode: 120503, name: 'Parag Parikh Flexi Cap Fund - Direct Growth', category: 'equity', subCategory: 'Flexi Cap', amc: 'PPFAS', return1y: 28.4, return3y: 22.1, return5y: 19.8, aum: 72400, expenseRatio: 0.63, stars: 5, fundManager: 'Rajeev Thakkar' },
  { schemeCode: 118989, name: 'Mirae Asset Large Cap Fund - Direct Growth', category: 'equity', subCategory: 'Large Cap', amc: 'Mirae Asset', return1y: 18.2, return3y: 14.8, return5y: 16.4, aum: 38900, expenseRatio: 0.54, stars: 5, fundManager: 'Gaurav Misra' },
  { schemeCode: 125497, name: 'SBI Small Cap Fund - Direct Growth', category: 'equity', subCategory: 'Small Cap', amc: 'SBI MF', return1y: 34.6, return3y: 28.4, return5y: 26.2, aum: 26800, expenseRatio: 0.67, stars: 4, fundManager: 'R. Srinivasan' },
  { schemeCode: 100444, name: 'HDFC Mid-Cap Opportunities - Direct Growth', category: 'equity', subCategory: 'Mid Cap', amc: 'HDFC MF', return1y: 42.1, return3y: 31.2, return5y: 28.8, aum: 68200, expenseRatio: 0.72, stars: 5, fundManager: 'Chirag Setalvad' },
  { schemeCode: 120847, name: 'Axis ELSS Tax Saver Fund - Direct Growth', category: 'equity', subCategory: 'ELSS', amc: 'Axis MF', return1y: 12.4, return3y: 9.8, return5y: 13.2, aum: 34100, expenseRatio: 0.68, stars: 3, fundManager: 'Shreyash Devalkar' },
  { schemeCode: 131103, name: 'Kotak Balanced Advantage - Direct Growth', category: 'hybrid', subCategory: 'Dynamic Alloc', amc: 'Kotak MF', return1y: 16.8, return3y: 13.4, return5y: 14.6, aum: 18200, expenseRatio: 0.58, stars: 4, fundManager: 'Harsha Upadhyaya' },
  { schemeCode: 119062, name: 'HDFC Corporate Bond Fund - Direct Growth', category: 'debt', subCategory: 'Corporate Bond', amc: 'HDFC MF', return1y: 8.4, return3y: 7.2, return5y: 8.1, aum: 29400, expenseRatio: 0.31, stars: 4, fundManager: 'Anupam Joshi' },
  { schemeCode: 120505, name: 'Nippon India Small Cap - Direct Growth', category: 'equity', subCategory: 'Small Cap', amc: 'Nippon India', return1y: 38.2, return3y: 32.6, return5y: 30.4, aum: 45800, expenseRatio: 0.74, stars: 5, fundManager: 'Samir Rachh' },
  { schemeCode: 119551, name: 'Mirae Asset Tax Saver - Direct Growth', category: 'equity', subCategory: 'ELSS', amc: 'Mirae Asset', return1y: 22.8, return3y: 17.4, return5y: 20.2, aum: 22100, expenseRatio: 0.54, stars: 5, fundManager: 'Neelesh Surana' },
  { schemeCode: 120716, name: 'SBI Liquid Fund - Direct Growth', category: 'debt', subCategory: 'Liquid', amc: 'SBI MF', return1y: 7.1, return3y: 6.8, return5y: 6.4, aum: 62100, expenseRatio: 0.20, stars: 4, fundManager: 'R. Arun' },
  { schemeCode: 147622, name: 'Quant Small Cap Fund - Direct Growth', category: 'equity', subCategory: 'Small Cap', amc: 'Quant MF', return1y: 48.6, return3y: 42.1, return5y: 38.4, aum: 8200, expenseRatio: 0.62, stars: 5, fundManager: 'Ankit Pande' },
  { schemeCode: 119775, name: 'ICICI Pru Bluechip Fund - Direct Growth', category: 'equity', subCategory: 'Large Cap', amc: 'ICICI Pru', return1y: 20.4, return3y: 16.8, return5y: 17.2, aum: 52800, expenseRatio: 0.89, stars: 4, fundManager: 'Anish Tawakley' },
];

// ─────────────────────────────────────────────────────
// SECTION 5: HEALTH & MISC
// ─────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      mfapi: 'https://api.mfapi.in/mf',
      anthropic: !!ANTHROPIC_KEY,
      razorpay: !!RAZORPAY_KEY_ID,
    },
  });
});

app.listen(PORT, () => {
  console.log(`FundIQ backend running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});

module.exports = app;
