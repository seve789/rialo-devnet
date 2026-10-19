/**
 * Attempt to deploy a PolkaVM blob to Rialo devnet using the official SDK path.
 *
 * This is an experiment: the blob was produced with the public polkatool, NOT the
 * Rialo-custom toolchain, so a rejection is the expected outcome — either way the
 * node's answer is real information about whether program deploy is open.
 *
 * Run: node deploy-probe.mjs <path-to.polkavm>
 */
import fs from 'node:fs';
import {
  createRialoClient, RIALO_DEVNET_CHAIN, Mnemonic, Keypair, ProgramDeployment,
} from '@rialo/ts-cdk';

const blobPath = process.argv[2] || 'C:/Users/Administrator/rialo-prog/rialo-prog.polkavm';
if (!fs.existsSync(blobPath)) {
  console.error('blob not found:', blobPath);
  process.exit(2);
}
const programData = new Uint8Array(fs.readFileSync(blobPath));
console.log('blob:', blobPath, programData.length, 'bytes');

const client = createRialoClient({ chain: RIALO_DEVNET_CHAIN });
console.log('blockHeight:', await client.getBlockHeight());

const wallet = JSON.parse(fs.readFileSync('devnet-wallet.json', 'utf8'));
const mnemonic = Mnemonic.fromPhrase(wallet.mnemonic);
const [payer] = await mnemonic.deriveKeypairs(1);
const balance = await client.getBalance(payer.publicKey);
console.log('payer:', payer.publicKey.toString(), 'balance:', String(balance), 'kelvin');

const programKeypair = Keypair.generate();
console.log('program keypair:', programKeypair.publicKey.toString());

const deployment = new ProgramDeployment({
  programData,
  programKeypair,
  config: { chunkSize: 900, maxRetries: 2 },
});

try {
  const programId = await deployment.deploy(client, payer);
  console.log('\nDEPLOYED — programId:', programId.toString());
  const info = await client.getAccountInfo(programId).catch((e) => ({ error: e.message }));
  console.log('account info:', JSON.stringify(info).slice(0, 300));
} catch (err) {
  console.error('\nDEPLOY REJECTED:', err.message);
  const details = err.details || err.cause || {};
  console.error('details:', JSON.stringify(details).slice(0, 600));
  process.exit(1);
} finally {
  payer.dispose();
  programKeypair.dispose();
}
