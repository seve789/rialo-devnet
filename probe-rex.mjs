/**
 * Probe Rialo's REX / lineage RPCs on live devnet with a real signature.
 * Goal: learn what data actually exists before designing the visualizer.
 *
 * Run: node probe-rex.mjs [signature]
 */
import fs from 'node:fs';
import { createRialoClient, RIALO_DEVNET_CHAIN, Mnemonic } from '@rialo/ts-cdk';

const SIG = process.argv[2] || '4zq63PqFSiHauagzkpVsNzWUibLMtQc6Zkh3a7YQwg9oJ4P9UFVUEd7fakAjAsedoTjy9uChbNfsP9uNZjZhb5Pm';
const client = createRialoClient({ chain: RIALO_DEVNET_CHAIN });
const wallet = JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf8'));
const [payer] = await Mnemonic.fromPhrase(wallet.mnemonic).deriveKeypairs(1);

const trim = (v, n = 600) => {
  const s = JSON.stringify(v, (k, val) => (typeof val === 'bigint' ? String(val) : val));
  return s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s;
};

console.log('blockHeight:', await client.getBlockHeight());
console.log('payer:', payer.publicKey.toString());

console.log('\n=== getTransaction(sig) ===');
try {
  const tx = await client.getTransaction(SIG);
  console.log(trim(tx));
} catch (e) {
  console.log('ERROR', e.message);
}

console.log('\n=== getWorkflowLineage(sig, depth 10, events) ===');
try {
  const lin = await client.getWorkflowLineage({ signature: SIG, maxDepth: 10, includeEvents: true });
  const keys = Object.keys(lin || {});
  console.log('top-level keys:', keys.join(', '));
  console.log(trim(lin, 1400));
} catch (e) {
  console.log('ERROR', e.message);
  console.log('details:', trim(e.details, 400));
}

console.log('\n=== getSubscription(payer, "demo") ===');
try {
  const sub = await client.getSubscription(payer.publicKey, 'demo');
  console.log(trim(sub));
} catch (e) {
  console.log('ERROR', e.message);
  console.log('details:', trim(e.details, 300));
}

console.log('\n=== getTriggeredTransactions(payer, 10) ===');
try {
  const txs = await client.getTriggeredTransactions(payer.publicKey, 10);
  console.log('count:', Array.isArray(txs) ? txs.length : 'n/a');
  console.log(trim(txs, 900));
} catch (e) {
  console.log('ERROR', e.message);
  console.log('details:', trim(e.details, 300));
}

payer.dispose();
