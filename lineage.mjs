/**
 * Rialo workflow-lineage explorer (offline single-file output).
 *
 *   node lineage.mjs <signature-or-address> [more...]
 *
 * Reads Rialo's REX/lineage RPC (getWorkflowLineage) on live devnet and writes a
 * self-contained `lineage.html` with the data embedded — no server, no CORS, works
 * from file:// and can be hosted on Pages as-is.
 */
import fs from 'node:fs';
import { createRialoClient, RIALO_DEVNET_CHAIN } from '@rialo/ts-cdk';

const OUT = process.env.OUT || 'index.html';
const LIMIT = 8;
const client = createRialoClient({ chain: RIALO_DEVNET_CHAIN });

const isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
// RPC payloads carry BigInt fields; JSON round-trip them to strings before embedding.
const toJSON = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

async function rootsFrom(arg) {
  if (!isAddress(arg)) return [{ signature: arg, source: 'signature' }];
  const sigs = await client.getSignaturesForAddress(arg).catch(() => []);
  const list = (Array.isArray(sigs) ? sigs : []).slice(0, LIMIT);
  if (!list.length) return [{ signature: arg, source: 'signature' }];
  return list.map((t) => ({
    signature: t.signature?.toString?.() ?? String(t.signature),
    source: 'address',
    err: t.err ?? null,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('usage: node lineage.mjs <signature-or-address> [...]');
    process.exit(2);
  }

  const blockHeight = String(await client.getBlockHeight());
  const roots = [];
  for (const arg of args) {
    for (const r of await rootsFrom(arg)) {
      try {
        const lin = await client.getWorkflowLineage({
          signature: r.signature, maxDepth: 10, includeEvents: true,
        });
        roots.push({ ...r, lineage: lin });
      } catch (err) {
        roots.push({ ...r, error: err.message });
      }
    }
  }

  // the same signature can arrive twice (explicit arg + address history) — keep one
  const uniq = [];
  const seenSig = new Set();
  for (const r of roots) {
    if (seenSig.has(r.signature)) continue;
    seenSig.add(r.signature);
    uniq.push(r);
  }
  roots.length = 0;
  roots.push(...uniq);

  // flatten into a deduped node/edge graph
  const nodes = new Map();
  const edges = [];
  for (const root of roots) {
    const lin = root.lineage;
    if (!lin) continue;
    for (const n of lin.lineage?.workflowNodes ?? []) {
      if (!nodes.has(n.id)) {
        nodes.set(n.id, {
          id: n.id,
          depth: n.depth ?? 0,
          success: n.data?.success !== false,
          blockHeight: n.data?.blockHeight ?? null,
          timestamp: n.data?.timestamp ?? null,
          instructionCount: n.data?.instructionCount ?? null,
          programIds: n.data?.instructionProgramIds ?? [],
          subscriptions: n.subscriptions ?? [],
          hasMoreChildren: !!n.hasMoreChildren,
          events: n.events ?? null,
        });
      }
      for (const childId of n.workflowChildren ?? []) {
        const key = `${n.id}->${childId}`;
        if (!edges.some((e) => e.key === key)) edges.push({ key, from: n.id, to: childId, kind: 'workflow' });
      }
      for (const sub of n.subscriptions ?? []) {
        const subId = sub?.account ?? sub?.id ?? (typeof sub === 'string' ? sub : null);
        if (!subId) continue;
        const key = `${n.id}~>${subId}`;
        if (!edges.some((e) => e.key === key)) edges.push({ key, from: n.id, to: subId, kind: 'subscription' });
        if (!nodes.has(subId)) {
          nodes.set(subId, { id: subId, depth: (n.depth ?? 0) + 1, kind: 'subscription', raw: sub });
        }
      }
    }
    for (const leaf of lin.leaves ?? []) {
      const node = nodes.get(leaf);
      if (node) node.isLeaf = true;
    }
  }

  const payload = toJSON({
    generatedAt: new Date().toISOString(),
    blockHeight,
    args,
    roots: roots.map((r) => ({
      signature: r.signature, source: r.source, error: r.error ?? null,
      nodeCount: r.lineage?.lineage?.workflowNodes?.length ?? 0,
      truncated: r.lineage?.truncated ?? null,
      truncationReason: r.lineage?.truncationReason ?? null,
    })),
    nodes: [...nodes.values()],
    edges,
  });

  const html = render(payload);
  fs.writeFileSync(OUT, html);
  const withChildren = payload.nodes.filter((n) => n.subscriptions?.length).length;
  console.log(`roots=${payload.roots.length} nodes=${payload.nodes.length} edges=${payload.edges.length} ` +
              `nodesWithSubscriptions=${withChildren}`);
  console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB), blockHeight=${blockHeight}`);
}

function render(data) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rialo Workflow Lineage</title>
<style>
  :root { --bg:#0f1116; --surface:#171a21; --fg:#e9ecf1; --muted:#9aa3b2; --border:#262b35;
          --ok:#3ecf8e; --bad:#e5484d; --accent:#6d8dff; --sub:#c084fc; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif; }
  header { padding:20px 24px 12px; border-bottom:1px solid var(--border); }
  h1 { margin:0 0 4px; font-size:18px; letter-spacing:-.01em; }
  .meta { color:var(--muted); font-size:12px; }
  .stats { display:flex; gap:20px; flex-wrap:wrap; margin-top:10px; font-size:12px; color:var(--muted); }
  .stats b { color:var(--fg); font-size:15px; font-weight:600; }
  main { display:grid; grid-template-columns:1fr 340px; gap:16px; padding:16px 24px 32px; }
  @media (max-width: 900px) { main { grid-template-columns:1fr; } }
  .panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; overflow:auto; }
  .panel h2 { margin:0 0 10px; font-size:13px; color:var(--muted); font-weight:600;
              text-transform:uppercase; letter-spacing:.06em; }
  .node rect { fill:#1d212b; stroke:var(--border); stroke-width:1; rx:8; }
  .node.root rect { stroke:var(--accent); }
  .node.failed rect { stroke:var(--bad); }
  .node.sub rect { stroke:var(--sub); stroke-dasharray:4 3; }
  .node text { fill:var(--fg); font-size:11px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .node .dim { fill:var(--muted); }
  .edge { stroke:#39414f; stroke-width:1.5; fill:none; }
  .edge.sub { stroke:var(--sub); stroke-dasharray:4 3; }
  .depth-label { fill:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
  ul.roots { list-style:none; margin:0; padding:0; }
  ul.roots li { padding:8px 0; border-bottom:1px solid var(--border); font-size:12px; }
  ul.roots li:last-child { border-bottom:0; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--fg); }
  .tag { display:inline-block; padding:1px 6px; border-radius:999px; font-size:10px;
         border:1px solid var(--border); color:var(--muted); margin-left:6px; }
  .tag.ok { color:var(--ok); border-color:color-mix(in srgb, var(--ok) 40%, transparent); }
  .tag.err { color:var(--bad); border-color:color-mix(in srgb, var(--bad) 40%, transparent); }
  .legend { display:flex; gap:14px; flex-wrap:wrap; font-size:11px; color:var(--muted); margin-top:8px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  .empty { color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>Rialo · Workflow Lineage</h1>
  <div class="meta">devnet · block ${data.blockHeight} · generated ${data.generatedAt}</div>
  <div class="stats">
    <div><b>${data.roots.length}</b> root tx</div>
    <div><b>${data.nodes.length}</b> nodes</div>
    <div><b>${data.edges.filter((e) => e.kind === 'subscription').length}</b> subscription edges</div>
  </div>
  <div class="legend">
    <span><span class="dot" style="background:#6d8dff"></span>root tx</span>
    <span><span class="dot" style="background:#1d212b;border:1px solid #262b35"></span>workflow node</span>
    <span><span class="dot" style="background:#c084fc"></span>REX subscription</span>
    <span><span class="dot" style="background:#e5484d"></span>failed</span>
  </div>
</header>
<main>
  <section class="panel">
    <h2>Lineage graph</h2>
    <div id="graph"></div>
  </section>
  <aside class="panel">
    <h2>Roots</h2>
    <ul class="roots" id="roots"></ul>
  </aside>
</main>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var roots = new Map(data.roots.map(function (r) { return [r.signature, r]; }));

  // ---- sidebar ----
  var ul = document.getElementById('roots');
  if (!data.roots.length) ul.innerHTML = '<li class="empty">no roots</li>';
  data.roots.forEach(function (r) {
    var li = document.createElement('li');
    var tag = r.error ? '<span class="tag err">error</span>'
                      : '<span class="tag ok">' + r.nodeCount + ' node</span>';
    li.innerHTML = '<code>' + r.signature.slice(0, 10) + '…' + r.signature.slice(-6) + '</code>' + tag +
      '<div class="meta">' + (r.error ? r.error : 'source: ' + r.source +
        (r.truncated ? ' · truncated (' + r.truncationReason + ')' : '')) + '</div>';
    ul.appendChild(li);
  });

  // ---- graph layout: column per depth ----
  var COL = 250, ROW = 70, PAD = 20, W = 520, H = 46;
  var depthOf = {};
  data.nodes.forEach(function (n) { depthOf[n.id] = n.depth || 0; });

  var byDepth = {};
  data.nodes.forEach(function (n) {
    var d = depthOf[n.id];
    (byDepth[d] = byDepth[d] || []).push(n);
  });
  var depths = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
  var maxDepth = depths.length ? depths[depths.length - 1] : 0;
  var maxRows = Math.max.apply(null, depths.map(function (d) { return byDepth[d].length; }).concat([1]));

  var pos = {};
  depths.forEach(function (d) {
    byDepth[d].forEach(function (n, i) {
      pos[n.id] = { x: PAD + d * COL, y: PAD + 24 + i * ROW };
    });
  });

  var svgNS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', PAD * 2 + (maxDepth + 1) * COL);
  svg.setAttribute('height', PAD * 2 + 24 + maxRows * ROW);
  svg.style.maxWidth = '100%';

  depths.forEach(function (d) {
    var label = document.createElementNS(svgNS, 'text');
    label.setAttribute('class', 'depth-label');
    label.setAttribute('x', PAD + d * COL);
    label.setAttribute('y', 14);
    label.textContent = 'depth ' + d;
    svg.appendChild(label);
  });

  function edgePath(a, b) {
    var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    var mx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
  }

  data.edges.forEach(function (e) {
    if (!pos[e.from] || !pos[e.to]) return;
    var p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', edgePath(pos[e.from], pos[e.to]));
    p.setAttribute('class', 'edge' + (e.kind === 'subscription' ? ' sub' : ''));
    svg.appendChild(p);
  });

  data.nodes.forEach(function (n) {
    var g = document.createElementNS(svgNS, 'g');
    var cls = 'node';
    if (roots.has(n.id)) cls += ' root';
    if (n.success === false) cls += ' failed';
    if (n.kind === 'subscription') cls += ' sub';
    g.setAttribute('class', cls);
    g.setAttribute('transform', 'translate(' + pos[n.id].x + ',' + pos[n.id].y + ')');

    var rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('width', W);
    rect.setAttribute('height', H);
    rect.setAttribute('rx', 8);
    g.appendChild(rect);

    var t1 = document.createElementNS(svgNS, 'text');
    t1.setAttribute('x', 10); t1.setAttribute('y', 19);
    t1.textContent = n.kind === 'subscription' ? 'sub:' + n.id.slice(0, 12) + '…'
                                               : n.id.slice(0, 14) + '…' + n.id.slice(-4);
    g.appendChild(t1);

    var t2 = document.createElementNS(svgNS, 'text');
    t2.setAttribute('x', 10); t2.setAttribute('y', 35);
    t2.setAttribute('class', 'dim');
    t2.textContent = n.kind === 'subscription'
      ? (n.raw ? JSON.stringify(n.raw).slice(0, 34) : 'subscription')
      : 'blk ' + (n.blockHeight || '?') + ' · ix ' + (n.instructionCount ?? '?') +
        (n.success === false ? ' · failed' : '');
    g.appendChild(t2);

    var title = document.createElementNS(svgNS, 'title');
    title.textContent = n.id + (n.programIds && n.programIds.length ? '\\nprograms: ' + n.programIds.join(', ') : '');
    g.appendChild(title);

    svg.appendChild(g);
  });

  var host = document.getElementById('graph');
  if (data.nodes.length) host.appendChild(svg);
  else host.innerHTML = '<p class="empty">no lineage nodes</p>';
})();
</script>
</body>
</html>`;
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
