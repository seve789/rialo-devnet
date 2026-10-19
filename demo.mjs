/**
 * Rialo devnet smoke test: mnemonic → keypair → airdrop → balance → transfer → confirm.
 * Run: node demo.mjs
 */
import fs from 'node:fs';
import {
  createRialoClient, RIALO_DEVNET_CHAIN, getDefaultRialoClientConfig,
  Mnemonic, transferInstruction, TransactionBuilder, KELVIN_PER_RLO,
} from '@rialo/ts-cdk';

const log = (...a) => console.log(...a);
const rlo = (k) => `${(Number(k) / KELVIN_PER_RLO).toFixed(4)} RLO`;

// devnet preset points at :4101; the plain 443 endpoint answered our probe, so try
// the preset first and fall back to a custom baseUrl if it refuses.
async function connect() {
  const attempts = [
    ['preset (devnet chain)', () => createRialoClient({ chain: RIALO_DEVNET_CHAIN })],
    ['custom :443', () => createRialoClient({ ...getDefaultRialoClientConfig('devnet'), url: 'https://devnet.rialo.io' })],
  ];
  for (const [label, make] of attempts) {
    try {
      const client = make();
      const height = await client.getBlockHeight();
      log(`connected via ${label} — blockHeight=${height}`);
      return client;
    } catch (err) {
      log(`  ${label} failed: ${err.message}`);
    }
  }
  throw new Error('no reachable devnet endpoint');
}

const client = await connect();
const height = await client.getBlockHeight();
const epoch = await client.getEpochInfo().catch(() => null);
log('epoch:', epoch ? JSON.stringify({ epoch: String(epoch.epoch), slotIndex: String(epoch.slotIndex ?? '') }) : '(n/a)');

// --- wallet from a 24-word mnemonic (BIP44 coin type 756) ---
const WALLET_FILE = 'devnet-wallet.json';
const mnemonic = fs.existsSync(WALLET_FILE)
  ? Mnemonic.fromPhrase(JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8')).mnemonic)
  : Mnemonic.generate(256);
const [payer, recipient] = await mnemonic.deriveKeypairs(2);
log('mnemonic words:', mnemonic.getWordCount(), fs.existsSync(WALLET_FILE) ? '(reused saved wallet)' : '(new)');
log('payer    :', payer.publicKey.toString());
log('recipient:', recipient.publicKey.toString());

// keep the phrase so the wallet is reproducible (test wallet only)
fs.writeFileSync(WALLET_FILE, JSON.stringify({
  warning: 'devnet test wallet only — never fund this on mainnet',
  createdAt: new Date().toISOString(),
  mnemonic: mnemonic.toString(),
  accounts: [payer.publicKey.toString(), recipient.publicKey.toString()],
}, null, 2));
log('mnemonic saved to', WALLET_FILE);

// --- faucet (devnet caps a single airdrop at 1 RLO) ---
const AMOUNT = BigInt(KELVIN_PER_RLO) / 10n; // 0.1 RLO
let balance = await client.getBalance(payer.publicKey);
log('payer balance before:', rlo(balance));
if (balance < AMOUNT) {
  const sig = await client.requestAirdropAndConfirm(payer.publicKey, BigInt(KELVIN_PER_RLO));
  log('airdrop signature:', sig.signature?.toString?.() ?? sig.toString?.() ?? JSON.stringify(sig));
  balance = await client.getBalance(payer.publicKey);
  log('payer balance after airdrop:', rlo(balance));
}

// --- transfer ---
const prefix = await client.getConfigHashPrefix();
log('configHashPrefix:', String(prefix).slice(0, 24) + '…');

const payerStart = await client.getBalance(payer.publicKey);
const recipStart = await client.getBalance(recipient.publicKey);

const ix = transferInstruction(payer.publicKey, recipient.publicKey, AMOUNT);
const tx = TransactionBuilder.create()
  .setPayer(payer.publicKey)
  .setValidFrom(BigInt(Date.now()))
  .setConfigHashPrefix(prefix)
  .addInstruction(ix)
  .build();
const signed = tx.sign(payer);
const confirmed = await client.sendAndConfirmTransaction(signed.serialize());
log('transfer confirmed:', JSON.stringify({
  signature: String(confirmed.signature ?? confirmed),
  slot: confirmed.slot ? String(confirmed.slot) : undefined,
  err: confirmed.err ?? null,
}));

// Balances can lag behind the confirmation on devnet, so poll instead of trusting one read.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitBalance(pubkey, predicate, timeoutMs = 20000) {
  const started = Date.now();
  let value = await client.getBalance(pubkey);
  while (!predicate(value) && Date.now() - started < timeoutMs) {
    await sleep(1000);
    value = await client.getBalance(pubkey);
  }
  return { value, waitedMs: Date.now() - started };
}

const payerRes = await waitBalance(payer.publicKey, (b) => b <= payerStart - AMOUNT);
const recipRes = await waitBalance(recipient.publicKey, (b) => b >= recipStart + AMOUNT);
const payerEnd = payerRes.value;
const recipEnd = recipRes.value;
log(`payer     delta: ${rlo(payerStart - payerEnd)} (settled after ${payerRes.waitedMs}ms)`);
log(`recipient delta: ${rlo(recipEnd - recipStart)} (settled after ${recipRes.waitedMs}ms)`);

// --- assertions: fail loudly instead of just printing ---
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push(ok);
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
};
check('transfer succeeded on devnet', confirmed.err == null);
check('recipient received exactly the sent amount', recipEnd - recipStart === AMOUNT,
  `expected ${AMOUNT}, got ${recipEnd - recipStart}`);
check('payer decreased by at least the sent amount', payerStart - payerEnd >= AMOUNT,
  `spent ${payerStart - payerEnd}`);

const history = await client.getSignaturesForAddress(payer.publicKey).catch(() => []);
log('payer tx history entries:', Array.isArray(history) ? history.length : '(n/a)');
check('payer has on-chain history', Array.isArray(history) && history.length > 0);

check('block height readable', typeof height === 'bigint' && height > 0n, String(height));

payer.dispose();
recipient.dispose();

const failed = checks.filter((ok) => !ok).length;
log(failed === 0 ? `\nVERIFIED — ${checks.length}/${checks.length} checks passed on live devnet` : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
