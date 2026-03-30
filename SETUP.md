# FundIQ — Complete Setup Guide
## Zero-to-Live in ~30 minutes, using only FREE services

---

## 🆓 FREE SERVICES YOU'LL USE

| Service | What For | Cost |
|---|---|---|
| **mfapi.in** | Live NAV for all 2,500+ Indian MFs | 100% Free, no auth |
| **AMFI India** | Official MF data source | 100% Free |
| **Anthropic Claude** | AI chatbot (Ask AI feature) | ~₹0.01/query, pay per use |
| **Razorpay** | Subscription billing | No setup fee, 2% per transaction |
| **Vercel** | Hosting frontend + backend | Free tier (100GB bandwidth) |
| **Supabase** | User database | Free tier (500MB, perfect for start) |
| **Resend.com** | Email alerts | Free (3,000 emails/month) |

**Your monthly cost at 0 subscribers: ₹0**
**At 100 Premium subscribers (₹5,999/yr): Revenue ~₹50K/mo, cost ~₹2K/mo**

---

## STEP 1: Get Your API Keys (15 minutes)

### Anthropic (Claude AI)
1. Go to https://console.anthropic.com/
2. Sign up → API Keys → Create Key
3. Copy it as `ANTHROPIC_API_KEY`
4. Add ₹500 credit to start (lasts ~50,000 queries)

### Razorpay
1. Go to https://dashboard.razorpay.com/
2. Sign up with your business PAN + bank account
3. Settings → API Keys → Generate Key
4. Copy `Key ID` and `Key Secret`
5. Create subscription plans:
   - Subscriptions → Plans → Create Plan
   - "FundIQ Premium Monthly": ₹833/month
   - "FundIQ Premium Yearly": ₹5,999/year  
   - "FundIQ Pro Monthly": ₹1,399/month
   - "FundIQ Pro Yearly": ₹9,999/year
6. Copy the Plan IDs (start with `plan_`)
7. Settings → Webhooks → Add webhook URL: `https://your-domain.vercel.app/api/billing/webhook`

### Supabase (optional, for user accounts)
1. Go to https://supabase.com/ → New Project
2. Copy `Project URL` and `anon key`
3. Free tier: 500MB database, 2GB file storage

---

## STEP 2: Deploy to Vercel (10 minutes)

```bash
# Install Vercel CLI
npm install -g vercel

# Clone/navigate to your project
cd fundiq

# Login to Vercel
vercel login

# Deploy (first time)
vercel

# Set environment variables (one by one)
vercel env add ANTHROPIC_API_KEY
vercel env add RAZORPAY_KEY_ID
vercel env add RAZORPAY_KEY_SECRET
vercel env add RAZORPAY_WEBHOOK_SECRET
vercel env add RZP_PLAN_PREM_MONTHLY
vercel env add RZP_PLAN_PREM_YEARLY
vercel env add RZP_PLAN_PRO_MONTHLY
vercel env add RZP_PLAN_PRO_YEARLY

# Deploy to production
vercel --prod
```

Your site is now live at `https://fundiq.vercel.app` (or your custom domain).

---

## STEP 3: Custom Domain (optional, ~₹800/year)

1. Buy domain at GoDaddy/Namecheap: `fundiq.in` or `yourname-mf.in`
2. In Vercel → Project → Domains → Add Domain
3. Update DNS records as instructed
4. SSL certificate is automatic (free via Let's Encrypt)

---

## STEP 4: Set Up Subscription Plans in Razorpay

In Razorpay Dashboard → Subscriptions → Plans, create:

```
Plan 1: FundIQ Premium Monthly
  - Period: monthly
  - Interval: 1
  - Amount: 83300 (in paise = ₹833)
  - Currency: INR

Plan 2: FundIQ Premium Yearly
  - Period: yearly
  - Interval: 1
  - Amount: 599900 (in paise = ₹5,999)
  - Currency: INR

Plan 3: FundIQ Pro Monthly
  - Period: monthly
  - Interval: 1
  - Amount: 139900 (= ₹1,399)

Plan 4: FundIQ Pro Yearly
  - Period: yearly
  - Interval: 1
  - Amount: 999900 (= ₹9,999)
```

---

## STEP 5: Live MF Data (mfapi.in — already wired)

The frontend already fetches live NAV from:
```
https://api.mfapi.in/mf/{schemeCode}
```

No API key needed. Free, no rate limits. Updates 6x daily.

To get all 2,500+ funds: `https://api.mfapi.in/mf`

---

## STEP 6: SEBI Compliance Checklist

Before going live, ensure:
- [ ] Disclaimer on every page: "Not investment advice. For research purposes only."
- [ ] Privacy Policy page (required by law)
- [ ] Terms & Conditions page
- [ ] No SEBI registration needed for pure research/information platform
- [ ] If you want to earn AMC commission: get AMFI ARN (free to apply at amfiindia.com)
- [ ] GST registration if revenue > ₹20L/year (SaaS = 18% GST)

---

## REVENUE PROJECTIONS

| Subscribers | Monthly Revenue | Your Cost | Profit |
|---|---|---|---|
| 10 Premium | ₹5,000 | ₹500 | ₹4,500 |
| 50 Premium | ₹25,000 | ₹2,000 | ₹23,000 |
| 100 Premium | ₹50,000 | ₹3,500 | ₹46,500 |
| 1 Enterprise | ₹50,000+ | ₹2,000 | ₹48,000+ |

*Cost = Anthropic API + Razorpay 2% txn fee + Vercel (free) + Supabase (free)*

---

## TECH STACK SUMMARY

```
Frontend:  Vanilla HTML/CSS/JS → Vercel (free)
Backend:   Node.js Express     → Vercel Serverless Functions (free)
Database:  Supabase PostgreSQL → Free 500MB tier
Email:     Resend.com          → Free 3,000/month
MF Data:   mfapi.in (AMFI)    → 100% free, no auth
AI:        Claude Sonnet       → Pay per use (~₹0.01/query)
Payments:  Razorpay            → 2% per transaction, no monthly fee
```

---

## GO-TO-MARKET (Week 1)

1. **WhatsApp groups**: Share in MF investor communities
2. **Twitter/X**: Post "I built a free AI MF research tool for India"
3. **Reddit**: r/IndiaInvestments, r/personalfinanceindia
4. **Product Hunt**: List it (free, huge visibility)
5. **IFA outreach**: Email 20 IFAs offering white-label Enterprise plan

---

## SUPPORT & NEXT STEPS

Files in this package:
- `frontend/index.html` — Full working web app
- `backend/server.js`  — Complete API with MF data + AI + Razorpay
- `backend/.env.example` — All environment variables needed
- `vercel.json`         — Deployment configuration
- `SETUP.md`           — This guide

Questions? All APIs used are publicly documented:
- mfapi.in docs: https://www.mfapi.in/docs/
- Razorpay Subscriptions: https://razorpay.com/docs/subscriptions/
- Anthropic API: https://docs.anthropic.com/
- Vercel deployment: https://vercel.com/docs
