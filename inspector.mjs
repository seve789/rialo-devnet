/**
 * REX Inspector — visualise Rialo's workflow lineage (REX / reactive transactions).
 *
 *   node inspector.mjs <signature-or-address> [--out index.html] [--limit 24]
 *
 * Devnet RPC sends no Access-Control-Allow-Origin, so the browser cannot query it
 * directly: data is collected here at build time and embedded into a single static
 * HTML file (works from file://, GitHub Pages, anywhere; no server, no deps).
 */
import fs from 'node:fs';
import { createRialoClient, RIALO_DEVNET_CHAIN } from '@rialo/ts-cdk';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const limitIdx = argv.indexOf('--limit');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : 'index.html';
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : 24;
const targets = argv.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1 && i !== limitIdx + 1);

if (!targets.length) {
  console.error('usage: node inspector.mjs <signature-or-address> [--out index.html] [--limit 24]');
  process.exit(2);
}

const client = createRialoClient({ chain: RIALO_DEVNET_CHAIN });
const isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const toJSON = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));

const RPC = 'https://devnet.rialo.io:4101';

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function collectStatus() {
  const [blockHeight, epoch, validators] = await Promise.all([
    client.getBlockHeight().catch(() => null),
    client.getEpochInfo().catch(() => null),
    // SDK's getValidatorAccounts wants a request object; the raw RPC needs none.
    rpc('getValidatorAccounts').catch(() => []),
  ]);
  const count = Array.isArray(validators) ? validators.length
    : Array.isArray(validators?.value) ? validators.value.length : null;
  return toJSON({
    blockHeight: blockHeight?.toString?.() ?? null,
    epoch: epoch?.epoch?.toString?.() ?? null,
    transactionCount: epoch?.transactionCount?.toString?.() ?? null,
    validators: count,
  });
}

async function rootsFor(target) {
  if (!isAddress(target)) return [{ signature: target, via: 'signature' }];
  const sigs = await client.getSignaturesForAddress(target).catch(() => []);
  const list = (Array.isArray(sigs) ? sigs : []).slice(0, LIMIT);
  if (!list.length) return [{ signature: target, via: 'signature' }];
  return list.map((t) => ({
    signature: t.signature?.toString?.() ?? String(t.signature),
    via: 'address',
  }));
}

async function main() {
  const status = await collectStatus();
  const roots = [];

  for (const target of targets) {
    for (const r of await rootsFor(target)) {
      if (roots.some((x) => x.signature === r.signature)) continue;
      try {
        const lin = await client.getWorkflowLineage({ signature: r.signature, maxDepth: 10, includeEvents: true });
        roots.push({ ...r, lineage: toJSON(lin) });
      } catch (err) {
        roots.push({ ...r, error: err.message });
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    targets,
    status,
    roots: roots.map((r) => ({
      signature: r.signature,
      via: r.via,
      error: r.error ?? null,
      truncated: r.lineage?.truncated ?? null,
      truncationReason: r.lineage?.truncationReason ?? null,
      nodes: (r.lineage?.lineage?.workflowNodes ?? []).map((n) => ({
        id: n.id,
        depth: n.depth ?? 0,
        data: n.data ?? {},
        subscriptions: n.subscriptions ?? [],
        workflowChildren: n.workflowChildren ?? [],
        hasMoreChildren: !!n.hasMoreChildren,
        events: n.events ?? null,
      })),
      leaves: r.lineage?.leaves ?? [],
      continuationHints: r.lineage?.continuationHints ?? [],
    })),
  };

  const html = render(payload);
  fs.writeFileSync(OUT, html);
  const nodes = payload.roots.reduce((a, r) => a + r.nodes.length, 0);
  const subs = payload.roots.reduce((a, r) => a + r.nodes.reduce((b, n) => b + n.subscriptions.length, 0), 0);
  console.log(`roots=${payload.roots.length} nodes=${nodes} subscriptions=${subs} validators=${status.validators} ` +
              `blockHeight=${status.blockHeight} txCount=${status.transactionCount}`);
  console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} KB)`);
}

function render(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>REX Inspector · Rialo devnet</title>
<style>
  :root { --bg:#0d0f14; --surface:#151922; --surface2:#1b202b; --fg:#e8ebf1; --muted:#8f9aab;
          --border:#242b38; --accent:#6d8dff; --ok:#3ecf8e; --bad:#e5484d; --sub:#c084fc; --warn:#f5a524; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.6 ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif; }
  a { color:var(--accent); }
  header { padding:18px 22px 14px; border-bottom:1px solid var(--border); position:sticky; top:0; background:rgba(13,15,20,.92); backdrop-filter:blur(8px); z-index:20; }
  .row { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }
  h1 { margin:0; font-size:17px; letter-spacing:-.01em; }
  .pill { font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
  .meta { color:var(--muted); font-size:12px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-top:12px; }
  .stat { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:8px 10px; }
  .stat b { display:block; font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; }
  .stat span { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:12px 22px; border-bottom:1px solid var(--border); }
  input[type=search], button, select { font:inherit; font-size:13px; color:var(--fg); background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:6px 10px; }
  input[type=search] { min-width:260px; }
  button { cursor:pointer; }
  button:hover { border-color:var(--accent); }
  .nbtn { display:block; width:100%; text-align:left; margin:0 0 4px; padding:4px 8px; background:var(--surface2); }
  .nbtn.sel { border-color:var(--accent); color:var(--fg); }
  main { display:grid; grid-template-columns:1fr 380px; gap:14px; padding:14px 22px 40px; }
  @media (max-width:1000px){ main { grid-template-columns:1fr; } }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; margin-bottom:12px; overflow:hidden; }
  .card.flash { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .card head, .card-h { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .tag { font-size:10px; padding:1px 7px; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
  .tag.ok { color:var(--ok); border-color:rgba(62,207,142,.4); }
  .tag.err { color:var(--bad); border-color:rgba(229,72,77,.4); }
  .tag.warn { color:var(--warn); border-color:rgba(245,165,36,.4); }
  .graph { padding:8px; overflow-x:auto; }
  .node { cursor:pointer; }
  .node rect { fill:var(--surface2); stroke:var(--border); }
  .node.root rect { stroke:var(--accent); }
  .node.failed rect { stroke:var(--bad); }
  .node:hover rect { stroke:var(--accent); }
  .node.sel rect { stroke:var(--accent); stroke-width:2; }
  .node text { fill:var(--fg); font-size:11px; font-family:ui-monospace,Menlo,monospace; pointer-events:none; }
  .node .dim { fill:var(--muted); }
  .edge { stroke:#39414f; stroke-width:1.5; fill:none; }
  .edge.sub { stroke:var(--sub); stroke-dasharray:4 3; }
  aside .panel { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px; position:sticky; top:96px; }
  aside h2, main h2 { font-size:12px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); margin:0 0 8px; }
  dl.kv { display:grid; grid-template-columns:110px 1fr; gap:4px 10px; margin:0 0 10px; font-size:12px; }
  dl.kv dt { color:var(--muted); }
  dl.kv dd { margin:0; word-break:break-all; }
  pre { background:#0a0c11; border:1px solid var(--border); border-radius:8px; padding:10px; font-size:11px; overflow:auto; max-height:340px; }
  .empty { color:var(--muted); font-size:12px; padding:10px 2px; }
  .pager { display:flex; gap:8px; align-items:center; justify-content:flex-end; padding:4px 22px 0; font-size:12px; color:var(--muted); }
  .note { padding:10px 22px 0; color:var(--muted); font-size:11px; }
</style>
</head>
<body>
<header>
  <div class="row">
    <h1>REX Inspector</h1>
    <span class="pill">Rialo devnet</span>
    <span class="meta">workflow lineage · REX reactive transactions</span>
  </div>
  <div class="row meta" style="margin-top:4px">
    target <code id="targetLabel"></code>
    <span>· snapshot <span id="genAt"></span></span>
  </div>
  <div class="stats" id="stats"></div>
</header>
<div class="toolbar">
  <input type="search" id="q" placeholder="按签名前缀过滤 root…" oninput="INSP.setQ(this.value)">
  <select id="size" onchange="INSP.setSize(this.value)"><option>4</option><option selected>6</option><option>10</option></select>
  <span class="meta">每页 root 数</span>
  <span style="flex:1"></span>
  <button id="copy" onclick="INSP.copy()">复制分享链接</button>
  <button id="export" onclick="INSP.exportJSON()">导出 JSON</button>
</div>
<div class="note" id="note"></div>
<div class="pager"><button id="prev" onclick="INSP.prev()">← 上一页</button><span id="pageInfo"></span><button id="next" onclick="INSP.next()">下一页 →</button></div>
<main>
  <section id="list"></section>
  <aside>
    <div class="panel">
      <h2>本页节点</h2>
      <div id="nodelist"><div class="empty">—</div></div>
    </div>
    <div class="panel" style="margin-top:12px">
      <h2>节点详情</h2>
      <div id="detail"><div class="empty">点击左侧节点或上面的按钮查看完整数据</div></div>
    </div>
  </aside>
</main>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var data = JSON.parse(document.getElementById('data').textContent);
  var params = new URLSearchParams(location.search);
  var q = '', page = 0, pageSize = 6, sel = null;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function short(s, n) { n = n || 14; return s.length <= n + 6 ? s : s.slice(0, n) + '…' + s.slice(-4); }
  function ts(ms) { if (!ms) return '—'; var d = new Date(Number(ms)); return isNaN(d) ? String(ms) : d.toLocaleString(); }
  function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

  document.getElementById('targetLabel').textContent = data.targets.join(', ');
  document.getElementById('genAt').textContent = new Date(data.generatedAt).toLocaleString();
  document.getElementById('note').innerHTML =
    '静态快照（浏览器直连 RPC 会被 CORS 拦，所以数据是构建时抓的）。刷新：' +
    '<code>npm run inspector -- ' + esc(data.targets[0]) + '</code>' +
    ' · 每条链都来自节点真实的 <code>getWorkflowLineage</code> 返回，没有模拟数据。';

  var stats = [
    ['block height', fmt(data.status.blockHeight)],
    ['epoch', fmt(data.status.epoch)],
    ['transactions', fmt(data.status.transactionCount)],
    ['validators', fmt(data.status.validators)],
    ['root txs', fmt(data.roots.length)],
    ['nodes', fmt(data.roots.reduce(function (a, r) { return a + r.nodes.length; }, 0))]
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>';
  }).join('');

  function filtered() {
    return data.roots.filter(function (r) { return !q || r.signature.indexOf(q) >= 0; });
  }

  function drawGraph(root) {
    var W = 430, H = 44, COL = 210, ROW = 62, PAD = 10;
    var nodes = root.nodes.slice();
    if (!nodes.length) return '<div class="empty">该交易没有 lineage 节点</div>';
    var pos = {};
    nodes.forEach(function (n, i) { pos[n.id] = { x: PAD + (n.depth || 0) * COL, y: PAD + i * ROW }; });
    var maxDepth = nodes.reduce(function (m, n) { return Math.max(m, n.depth || 0); }, 0);
    var width = PAD * 2 + (maxDepth + 1) * COL, height = PAD * 2 + nodes.length * ROW;
    var s = '<svg width="' + width + '" height="' + height + '" role="img">';
    s += '<defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">' +
         '<path d="M0,0 L6,3 L0,6" fill="#39414f"/></marker></defs>';
    nodes.forEach(function (n) {
      (n.workflowChildren || []).forEach(function (cid) {
        if (!pos[cid]) return;
        var a = pos[n.id], b = pos[cid];
        var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
        s += '<path class="edge" marker-end="url(#ar)" d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '"/>';
      });
    });
    nodes.forEach(function (n) {
      var p = pos[n.id], cls = 'node' + (n.id === root.signature ? ' root' : '');
      if (n.data && n.data.success === false) cls += ' failed';
      if (sel === n.id) cls += ' sel';
      s += '<g class="' + cls + '" data-id="' + esc(n.id) + '" onclick="INSP.pickId(&quot;' + esc(n.id) + '&quot;)"' +
           ' transform="translate(' + p.x + ',' + p.y + ')">';
      s += '<rect width="' + W + '" height="' + H + '" rx="8"/>';
      s += '<text x="10" y="18">' + esc(short(n.id, 16)) + '</text>';
      s += '<text class="dim" x="10" y="33">blk ' + esc(n.data && n.data.blockHeight || '?') +
           ' · ix ' + esc(n.data && n.data.instructionCount != null ? n.data.instructionCount : '?') +
           ' · depth ' + esc(n.depth || 0) + (n.subscriptions && n.subscriptions.length ? ' · sub ' + n.subscriptions.length : '') + '</text>';
      s += '</g>';
    });
    s += '</svg>';
    return s;
  }

  function draw() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / pageSize));
    if (page >= pages) page = pages - 1;
    var slice = list.slice(page * pageSize, page * pageSize + pageSize);
    document.getElementById('pageInfo').textContent = '第 ' + (page + 1) + ' / ' + pages + ' 页 · 共 ' + list.length + ' 个 root';

    if (!slice.length) { document.getElementById('list').innerHTML = '<div class="card"><div class="empty">没有匹配的 root</div></div>'; return; }
    document.getElementById('list').innerHTML = slice.map(function (r, i) {
      var tag = r.error ? '<span class="tag err">error</span>'
        : '<span class="tag ok">' + r.nodes.length + ' node</span>' +
          (r.truncated ? '<span class="tag warn">truncated</span>' : '');
      return '<div class="card" id="root-' + i + '" data-sig="' + esc(r.signature) + '">' +
        '<div class="card-h"><div><code>' + esc(short(r.signature, 22)) + '</code> ' +
        '<span class="meta">via ' + esc(r.via) + '</span></div><div>' + tag + '</div></div>' +
        '<div class="graph">' + (r.error ? '<div class="empty">' + esc(r.error) + '</div>' : drawGraph(r)) + '</div>' +
        '</div>';
    }).join('');

    var pageNodes = [];
    slice.forEach(function (r) { r.nodes.forEach(function (n) { pageNodes.push(n); }); });
    var nl = document.getElementById('nodelist');
    nl.innerHTML = pageNodes.length ? pageNodes.map(function (n) {
      return '<button class="nbtn" data-id="' + esc(n.id) + '" onclick="INSP.pickId(&quot;' + esc(n.id) + '&quot;)"><code>' +
        esc(short(n.id, 18)) + '</code> <span class="meta">d' + esc(n.depth) + ' · blk ' +
        esc(n.data.blockHeight || '?') + '</span></button>';
    }).join('') : '<div class="empty">—</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.node'), function (g) {
      g.addEventListener('click', function () { pick(g); });
    });

    var want = params.get('root');
    if (want && page === 0) {
      var idx = list.findIndex(function (r) { return r.signature === want; });
      if (idx >= 0) {
        page = Math.floor(idx / pageSize);
        draw();
        var el = document.querySelector('[data-sig="' + want + '"]');
        if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); }
      }
    }
  }

  function pick(g) {
    sel = g.getAttribute('data-id');
    Array.prototype.forEach.call(document.querySelectorAll('.node'), function (x) { x.classList.remove('sel'); });
    g.classList.add('sel');
    showDetail(sel);
    // file:// documents throw on replaceState with a URL, so fall back to the hash
    try {
      history.replaceState(null, '', '?node=' + encodeURIComponent(sel));
    } catch (e) {
      try { location.hash = 'node=' + encodeURIComponent(sel); } catch (e2) {}
    }
  }

  // delegated handler: survives re-renders, works even if a node listener was missed
  document.getElementById('list').addEventListener('click', function (ev) {
    var g = ev.target.closest ? ev.target.closest('.node') : null;
    if (g) pick(g);
  });
  document.getElementById('nodelist').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.nbtn') : null;
    if (!b) return;
    var id = b.getAttribute('data-id');
    var g = document.querySelector('.node[data-id="' + id + '"]');
    if (g) pick(g); else { sel = id; showDetail(id); }
    Array.prototype.forEach.call(document.querySelectorAll('.nbtn'), function (x) { x.classList.remove('sel'); });
    b.classList.add('sel');
  });

  function showDetail(id) {
    var node = null, root = null;
    data.roots.forEach(function (r) {
      r.nodes.forEach(function (n) { if (n.id === id) { node = n; root = r; } });
    });
    if (!node) return;
    var raw = JSON.stringify({ node: node, root: root.signature, truncationReason: root.truncationReason }, null, 2);
    document.getElementById('detail').innerHTML =
      '<dl class="kv">' +
      '<dt>签名</dt><dd><code>' + esc(node.id) + '</code></dd>' +
      '<dt>深度</dt><dd>' + esc(node.depth) + '</dd>' +
      '<dt>区块</dt><dd>' + esc(node.data.blockHeight || '—') + '</dd>' +
      '<dt>时间</dt><dd>' + esc(ts(node.data.timestamp)) + '</dd>' +
      '<dt>成功</dt><dd>' + (node.data.success === false ? '<span class="tag err">failed</span>' : '<span class="tag ok">ok</span>') + '</dd>' +
      '<dt>指令数</dt><dd>' + esc(node.data.instructionCount != null ? node.data.instructionCount : '—') + '</dd>' +
      '<dt>程序</dt><dd>' + (node.data.instructionProgramIds || []).map(function (p) { return '<code>' + esc(short(p, 12)) + '</code>'; }).join(', ') + '</dd>' +
      '<dt>订阅</dt><dd>' + (node.subscriptions.length ? esc(node.subscriptions.length) : '—') + '</dd>' +
      '<dt>子节点</dt><dd>' + ((node.workflowChildren || []).length ? esc(node.workflowChildren.length) : '—') + '</dd>' +
      (node.hasMoreChildren ? '<dt>更多</dt><dd><span class="tag warn">hasMoreChildren</span></dd>' : '') +
      '</dl><pre>' + esc(raw) + '</pre>';
  }

  // Inline handlers (onclick/oninput in the markup) call these — no addEventListener,
  // so nothing breaks silently if a binding step is skipped.
  window.INSP = {
    setQ: function (v) { q = v.trim(); page = 0; draw(); },
    setSize: function (v) { pageSize = Number(v) || 6; page = 0; draw(); },
    prev: function () { if (page > 0) { page--; draw(); } },
    next: function () { page++; draw(); },
    pickId: function (id) {
      var g = document.querySelector('.node[data-id="' + id + '"]');
      if (g) { pick(g); return; }
      sel = id; showDetail(id);
    },
    copy: function () {
      var url = location.href;
      var done = function () {
        var b = document.getElementById('copy');
        b.textContent = '已复制 ✓';
        setTimeout(function () { b.textContent = '复制分享链接'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(done);
      } else { done(); }
    },
    exportJSON: function () {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rex-inspector-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  draw();
  var nodeParam = params.get('node');
  if (nodeParam) showDetail(nodeParam);
})();
</script>
</body>
</html>`;
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
