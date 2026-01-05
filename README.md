# Fresh Wallet Tracker

Real-time tracker for fresh Solana wallets making significant swaps on DEXs.

## What it does

Monitors Solana for wallets that:
- Are less than 24 hours old
- Have 10 or fewer total transactions
- Make swaps worth $250+ USD

Tracks swaps on:
- Jupiter V6
- Raydium V4
- Pump.fun (bonding curve)
- PumpSwap AMM

## Features

- Live-updating SOL price
- Web UI with clickable wallet/transaction links
- Color-coded DEX labels
- Fresh wallet detection (filters out bots)

## Setup

### 1. Install Node.js
Download from [nodejs.org](https://nodejs.org/)

### 2. Get a Helius API Key
1. Go to [helius.dev](https://helius.dev)
2. Sign up for free (1M credits/month)
3. Copy your API key

### 3. Update the API Key
Open `tracker.js` and replace the API key on line 11:
```javascript
const HELIUS_API_KEY = 'your-api-key-here';
```

### 4. Set Up Helius Webhook
1. Go to your Helius dashboard → Webhooks
2. Create a new webhook with:
   - **Webhook URL**: Your ngrok URL (see step 6)
   - **Transaction Type**: Select these programs:
     - `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` (Raydium V4)
     - `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` (Jupiter V6)
     - `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (Pump.fun)
     - `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (PumpSwap)

### 5. Run the Tracker
```bash
node tracker.js
```

### 6. Start ngrok (in a separate terminal)
```bash
ngrok http 3000
```
Copy the HTTPS URL and paste it into your Helius webhook settings.

### 7. Open the Web UI
Go to [http://localhost:3000](http://localhost:3000) in your browser.

## Terminal Output

```
fresh wallet tracker
====================

Web UI: http://localhost:3000

Make sure ngrok is running in another terminal:
  ngrok http 3000

====================

SOL: $195.42 | Waiting for swaps...

21:15:32  TOKEN  $450 (2.35 SOL)  [JUP]
21:16:45  BONK   $1200 (6.28 SOL)  [RAY]
```

## Web UI

The web interface shows:
- Token name
- USD amount and SOL amount
- DEX used (color-coded)
- Wallet age and prior swap count
- Clickable links to Solscan for wallet and transaction

## License

MIT
