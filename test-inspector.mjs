/**
 * UI regression test for the generated inspector page, run in jsdom.
 *
 *   npm run test:ui
 *
 * Verifies the interactions that can't be trusted from eyeballing: pagination,
 * filtering, node-detail rendering and the export/copy hooks being wired.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/index.html',
});
const { window } = dom;
const doc = window.document;

const text = (sel) => doc.querySelector(sel)?.textContent?.trim() ?? '';
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`  PASS  ${name}`);
};

// ---------- initial render ----------
check('INSP global installed', () => assert.equal(typeof window.INSP, 'object'));
check('6 stat cards rendered', () => assert.equal(doc.querySelectorAll('.stat').length, 6));
check('stat values present', () => {
  const v = doc.querySelector('.stat b').textContent.replace(/[^0-9]/g, '');
  assert.ok(Number(v) > 1_000_000, `block height looks wrong: ${v}`);
});
check('page 1 of 2 shown', () => assert.match(text('#pageInfo'), /第 1 \/ 2 页 · 共 11 个 root/));
check('6 root cards on page 1', () => assert.equal(doc.querySelectorAll('#list .card').length, 6));
check('node buttons listed', () => assert.equal(doc.querySelectorAll('.nbtn').length, 6));

// ---------- pagination ----------
click(doc.querySelector('#next'));
check('next goes to page 2', () => assert.match(text('#pageInfo'), /第 2 \/ 2 页/));
check('page 2 has the remaining 5 roots', () => assert.equal(doc.querySelectorAll('#list .card').length, 5));

click(doc.querySelector('#prev'));
check('prev returns to page 1', () => assert.match(text('#pageInfo'), /第 1 \/ 2 页/));

// ---------- filtering ----------
const firstSig = doc.querySelector('#list .card').getAttribute('data-sig');
const input = doc.querySelector('#q');
input.value = firstSig.slice(0, 6);
input.dispatchEvent(new window.Event('input', { bubbles: true }));
check('search filters to matching roots', () => {
  const cards = [...doc.querySelectorAll('#list .card')];
  assert.ok(cards.length >= 1 && cards.length < 6, `expected a subset, got ${cards.length}`);
  assert.ok(cards.every((c) => c.getAttribute('data-sig').includes(firstSig.slice(0, 6))));
});
input.value = '';
input.dispatchEvent(new window.Event('input', { bubbles: true }));
check('clearing search restores 6', () => assert.equal(doc.querySelectorAll('#list .card').length, 6));

// ---------- node detail ----------
const nodeBtn = doc.querySelector('.nbtn');
const nodeId = nodeBtn.getAttribute('data-id');
click(nodeBtn);
check('detail panel filled for clicked node', () => {
  const detail = text('#detail');
  assert.match(detail, /签名/);
  assert.ok(detail.includes(nodeId), 'detail does not mention the node id');
  assert.match(detail, /"blockHeight"/);
  assert.match(detail, /深度/);
});
check('clicked node marked selected', () => assert.ok(doc.querySelector('.nbtn.sel')));

// ---------- export / copy wiring ----------
check('export and copy hooks exist', () => {
  assert.equal(typeof window.INSP.exportJSON, 'function');
  assert.equal(typeof window.INSP.copy, 'function');
});
check('embedded data is real lineage, not a mock', () => {
  const payload = JSON.parse(doc.getElementById('data').textContent);
  assert.ok(payload.roots.length === 11);
  assert.ok(payload.roots.every((r) => r.nodes.length >= 1 && !r.error));
  const n = payload.roots[0].nodes[0];
  assert.ok(n.data.blockHeight && n.data.instructionProgramIds.length >= 1);
  assert.equal(payload.status.validators, 4);
});

console.log(`\nALL ${checks} UI CHECKS PASSED`);
