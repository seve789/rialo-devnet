/**
 * Scan recent devnet blocks for transactions that actually carry REX subscription
 * edges — the data the Inspector wants to draw but must never invent.
 *
 *   node scan-rex.mjs [blocks=3] [perBlock=6]
 *
 * Uses the raw JSON-RPC (the SDK's getBlock argument shape doesn't match this node's).
 */
const RPC = 'https://devnet.rialo.io:4101';
const BLOCKS = Number(process.argv[2] || 3);
const PER_BLOCK = Number(process.argv[3] || 6);

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

const head = await rpc('getBlockHeight', []);
console.log(`head blockHeight=${head} · scanning last ${BLOCKS} blocks, ≤${PER_BLOCK} txs each`);

let scanned = 0;
const hits = [];

for (let i = 1; i <= BLOCKS; i++) {
  const h = Number(head) - i;
  let block;
  try {
    block = await rpc('getBlock', [{ blockHeight: h, transactionDetails: 'signatures' }]);
  } catch (err) {
    console.log(`  block ${h}: getBlock failed — ${err.message}`);
    continue;
  }
  const txs = block?.value?.transactions ?? [];
  const sigs = txs.map((t) => t?.transaction?.signatures?.[0]).filter(Boolean);
  if (!sigs.length) { console.log(`  block ${h}: no transactions`); continue; }

  for (const sig of sigs.slice(0, PER_BLOCK)) {
    scanned++;
    try {
      const lin = await rpc('getWorkflowLineage', [{ signature: sig, maxDepth: 10, includeEvents: true }]);
      const nodes = lin?.lineage?.workflowNodes ?? [];
      const subs = nodes.reduce((a, n) => a + (n.subscriptions?.length ?? 0), 0);
      const kids = nodes.reduce((a, n) => a + (n.workflowChildren?.length ?? 0), 0);
      if (subs || kids || nodes.length > 1) {
        hits.push({ sig, block: h, nodes: nodes.length, subs, kids });
        console.log(`  HIT block ${h} ${sig.slice(0, 14)}… nodes=${nodes.length} subs=${subs} children=${kids}`);
      }
    } catch { /* individual failures are noise here */ }
  }
  console.log(`  block ${h}: ${txs.length} txs (sampled ${Math.min(txs.length, PER_BLOCK)})`);
}

console.log(`\nscanned=${scanned} hits=${hits.length}`);
console.log(hits.length ? `best candidate: ${JSON.stringify(hits[0])}`
                        : 'no subscription/child edges found in the sampled window');
