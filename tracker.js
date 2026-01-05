const http = require('http');

const PORT = 3000;

const RAYDIUM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const PUMP_FUN = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_SWAP = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const HELIUS_API_KEY = 'bbd6e2cd-e76f-4057-bc64-e21a712010cd';

const checkedWallets = new Map();
let solPrice = 180;
let recentSwaps = [];

async function fetchSolPrice() {
  // Try Jupiter first
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`);
    const data = await res.json();
    if (data.data?.[SOL_MINT]?.price) {
      solPrice = parseFloat(data.data[SOL_MINT].price);
      return;
    }
  } catch (err) {}
  
  // Fallback to CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    if (data.solana?.usd) {
      solPrice = parseFloat(data.solana.usd);
    }
  } catch (err) {}
}

function getProgram(tx) {
  const source = tx.source || '';
  const accounts = tx.accountData?.map(a => a.account) || [];
  
  if (source === 'JUPITER' || accounts.includes(JUPITER_V6)) {
    return { name: 'JUP', color: '#3b82f6' };
  }
  if (source === 'RAYDIUM' || accounts.includes(RAYDIUM_V4)) {
    return { name: 'RAY', color: '#a855f7' };
  }
  if (accounts.includes(PUMP_SWAP)) {
    return { name: 'PUMPSWAP', color: '#22c55e' };
  }
  if (source === 'PUMP_FUN' || accounts.includes(PUMP_FUN)) {
    return { name: 'PUMP-PREBOND', color: '#eab308' };
  }
  return { name: 'UNKNOWN', color: '#6b7280' };
}

async function checkIfFreshWallet(wallet) {
  if (checkedWallets.has(wallet)) {
    return checkedWallets.get(wallet);
  }

  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${HELIUS_API_KEY}&limit=30`
    );
    const txns = await res.json();

    if (!Array.isArray(txns) || txns.length === 0) {
      const result = { walletAge: 0, priorTxns: 0 };
      checkedWallets.set(wallet, result);
      return result;
    }

    // If wallet has more than 10 total transactions, not fresh (bots spam txns)
    if (txns.length > 10) {
      checkedWallets.set(wallet, null);
      return null;
    }

    // Count DEX-related transactions (SWAP or TRANSFER involving Jupiter/Raydium/Pump)
    const dexTxns = txns.filter(tx => {
      if (tx.type === 'SWAP') return true;
      // Check if it's a transfer through a DEX
      const accounts = tx.accountData?.map(a => a.account) || [];
      const instructions = tx.instructions?.map(i => i.programId) || [];
      const allPrograms = [...accounts, ...instructions];
      return allPrograms.some(p => 
        p === JUPITER_V6 || 
        p === RAYDIUM_V4 || 
        p === PUMP_FUN || 
        p === PUMP_SWAP
      );
    });
    
    // If wallet has more than 5 DEX transactions, not fresh
    if (dexTxns.length > 5) {
      checkedWallets.set(wallet, null);
      return null;
    }

    // Check wallet age based on oldest transaction
    const oldest = txns[txns.length - 1];
    const hoursAgo = (Date.now() - oldest.timestamp * 1000) / (1000 * 60 * 60);
    
    if (hoursAgo > 24) {
      checkedWallets.set(wallet, null);
      return null;
    }

    const result = { walletAge: Math.round(hoursAgo), priorTxns: dexTxns.length };
    checkedWallets.set(wallet, result);
    return result;
  } catch (err) {
    return null;
  }
}

async function processTransaction(tx) {
  try {
    const feePayer = tx.feePayer;
    if (!feePayer) return;

    let solAmount = 0;
    let amountUSD = 0;
    let token = 'UNKNOWN';

    // Method 1: Check native transfers from fee payer (in lamports)
    for (const t of tx.nativeTransfers || []) {
      if (t.fromUserAccount === feePayer) {
        solAmount += t.amount / 1e9;
      }
    }

    // Method 2: Only check WSOL if no native transfers found
    if (solAmount === 0) {
      for (const t of tx.tokenTransfers || []) {
        if (t.mint === SOL_MINT && t.fromUserAccount === feePayer) {
          // tokenAmount should be in SOL, but sanity check for lamports
          let amt = Math.abs(t.tokenAmount || 0);
          if (amt > 100000) amt = amt / 1e9; // Likely in lamports
          solAmount += amt;
        }
      }
    }

    // Method 3: Fallback to accountData balance change
    if (solAmount === 0) {
      for (const acc of tx.accountData || []) {
        if (acc.account === feePayer && acc.nativeBalanceChange < 0) {
          solAmount = Math.abs(acc.nativeBalanceChange) / 1e9;
          break;
        }
      }
    }

    // Sanity check: no single swap should be over 10000 SOL
    if (solAmount > 10000) {
      console.log(`Skipping unrealistic amount: ${solAmount} SOL`);
      return;
    }

    amountUSD = solAmount * solPrice;

    for (const t of tx.tokenTransfers || []) {
      if (t.toUserAccount === feePayer && t.mint !== SOL_MINT) {
        token = t.symbol || t.mint?.slice(0, 6) || 'TOKEN';
      }
      if (t.mint === USDC_MINT) {
        amountUSD = Math.max(amountUSD, Math.abs(t.tokenAmount || 0));
      }
    }

    if (amountUSD < 250) return;

    const fresh = await checkIfFreshWallet(feePayer);
    if (!fresh) return;

    const program = getProgram(tx);

    const swap = {
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      token,
      amountUSD: Math.round(amountUSD),
      solAmount: solAmount.toFixed(2),
      wallet: feePayer,
      walletShort: `${feePayer.slice(0, 4)}...${feePayer.slice(-4)}`,
      walletAge: fresh.walletAge,
      priorTxns: fresh.priorTxns,
      signature: tx.signature,
      program: program.name,
      programColor: program.color,
    };

    recentSwaps.unshift(swap);
    if (recentSwaps.length > 50) recentSwaps.pop();

    console.log(`\n${swap.time}  ${swap.token}  $${swap.amountUSD} (${swap.solAmount} SOL)  [${swap.program}]`);
  } catch (err) {}
}

const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Fresh Wallet Tracker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #000;
      color: #fff;
      font-family: 'Monaco', 'Menlo', monospace;
      padding: 20px;
      min-height: 100vh;
    }
    h1 {
      font-size: 18px;
      font-weight: normal;
      margin-bottom: 5px;
    }
    .subtitle {
      color: #666;
      font-size: 12px;
      margin-bottom: 20px;
    }
    .status {
      display: inline-block;
      padding: 4px 10px;
      background: #22c55e;
      color: #000;
      font-size: 11px;
      border-radius: 3px;
      margin-left: 10px;
    }
    .swap {
      border-bottom: 1px solid #222;
      padding: 15px 0;
    }
    .swap-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .time { color: #666; font-size: 13px; }
    .token { font-weight: bold; font-size: 15px; }
    .amount { color: #fff; font-size: 14px; }
    .sol { color: #888; font-size: 13px; }
    .program {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
    }
    .details {
      font-size: 12px;
      color: #888;
      margin-bottom: 6px;
    }
    .links {
      display: flex;
      gap: 15px;
    }
    .links a {
      color: #3b82f6;
      text-decoration: none;
      font-size: 12px;
    }
    .links a:hover {
      text-decoration: underline;
    }
    .empty {
      color: #666;
      font-size: 13px;
      padding: 40px 0;
    }
    #swaps { margin-top: 20px; }
  </style>
</head>
<body>
  <h1>fresh wallet tracker <span class="status">LIVE</span></h1>
  <p class="subtitle">swaps >$250 from wallets <24h old, ≤5 swaps</p>
  
  <div id="swaps">
    <p class="empty">waiting for fresh wallet swaps...</p>
  </div>

  <script>
    async function fetchSwaps() {
      try {
        const res = await fetch('/api/swaps');
        const swaps = await res.json();
        
        const container = document.getElementById('swaps');
        
        if (swaps.length === 0) {
          container.innerHTML = '<p class="empty">waiting for fresh wallet swaps...</p>';
          return;
        }
        
        container.innerHTML = swaps.map(s => \`
          <div class="swap">
            <div class="swap-header">
              <span class="time">\${s.time}</span>
              <span class="token">\${s.token}</span>
              <span class="amount">$\${s.amountUSD}</span>
              <span class="sol">(\${s.solAmount} SOL)</span>
              <span class="program" style="background: \${s.programColor}; color: #000;">[\${s.program}]</span>
            </div>
            <div class="details">
              wallet: \${s.walletShort} (\${s.walletAge}h old, \${s.priorTxns} swaps)
            </div>
            <div class="links">
              <a href="https://solscan.io/account/\${s.wallet}" target="_blank">View Wallet</a>
              <a href="https://solscan.io/tx/\${s.signature}" target="_blank">View Transaction</a>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Failed to fetch swaps:', err);
      }
    }

    fetchSwaps();
    setInterval(fetchSwaps, 2000);
  </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const transactions = Array.isArray(data) ? data : [data];
        for (const tx of transactions) {
          await processTransaction(tx);
        }
      } catch (err) {}
      res.writeHead(200);
      res.end('OK');
    });
  } else if (req.url === '/api/swaps') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(recentSwaps));
  } else if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else {
    res.writeHead(200);
    res.end('Fresh Wallet Tracker Running');
  }
});

server.listen(PORT, async () => {
  console.log('');
  console.log('fresh wallet tracker');
  console.log('====================');
  console.log('');
  
  await fetchSolPrice();
  
  console.log(`Web UI: http://localhost:${PORT}`);
  console.log('');
  console.log('Make sure ngrok is running in another terminal:');
  console.log('  ngrok http 3000');
  console.log('');
  console.log('====================');
  console.log('');

  // Live-updating SOL price line
  const updatePrice = async () => {
    await fetchSolPrice();
    process.stdout.write(`\rSOL: $${solPrice.toFixed(2)} | Waiting for swaps...   `);
  };
  
  await updatePrice();
  setInterval(updatePrice, 3000);
  setInterval(() => checkedWallets.clear(), 120000);
});
