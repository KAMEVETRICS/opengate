import { XLAYER, TIER } from './generated.js';
import { DEPLOYED, PROCESSOR, VAULT } from './config.js';
import { createCore, simulateAll, weightMultiplier, NAND } from './core.js';

const { ethers } = window;
const core = createCore(ethers);
const reader = new ethers.JsonRpcProvider(XLAYER.rpc, XLAYER.chainId, { staticNetwork: true });
const $ = (id) => document.getElementById(id);
const STORE_KEY = 'opengate.deployed';

const INPUT_LABELS = ['size bit 0', 'size bit 1', 'age bit 0', 'age bit 1', 'builder', 'IGNIX holder'];

const state = {
  signer: null,
  account: null,
  deployed: loadDeployed(),
  processor: null,
  vault: null,
  user: null,
  circuitInputs: [0, 1, 1, 0, 1, 0], // default demo input on the Circuit tab
};

// ---------------------------------------------------------------- config

function loadDeployed() {
  const fromFile = { ...DEPLOYED };
  const params = new URLSearchParams(location.search);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { /* storage blocked */ }
  const pick = (k) => fromFile[k] || params.get(k) || saved[k] || '';
  return { circuits: pick('circuits'), transistors: pick('transistors'), circuitId: pick('circuitId'), vault: pick('vault') };
}

function saveDeployed(patch) {
  Object.assign(state.deployed, patch);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.deployed)); } catch { /* storage blocked */ }
  renderConfig();
}

const hasProcessor = () => Boolean(state.deployed.circuits && state.deployed.transistors);
const hasVault = () => hasProcessor() && Boolean(state.deployed.vault && state.deployed.circuitId);

// ---------------------------------------------------------------- formatting

const fmtOkb = (wei, dp = 4) => {
  const n = Number(ethers.formatEther(wei ?? 0n));
  return n === 0 ? '0' : n < 10 ** -dp ? `<${10 ** -dp}` : n.toLocaleString('en-US', { maximumFractionDigits: dp });
};
const fmtInt = (v) => Number(v ?? 0).toLocaleString('en-US');
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '–');
const fmtDate = (s) => (s ? new Date(s * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '–');

function toast(msg, { hash, error = false, sticky = false } = {}) {
  const el = $('toast');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = msg;
  if (hash) {
    const a = document.createElement('a');
    a.href = `${XLAYER.explorer}/tx/${hash}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'view tx ↗';
    el.append(a);
  }
  el.hidden = false;
  clearTimeout(toast.t);
  if (!sticky) toast.t = setTimeout(() => { el.hidden = true; }, error ? 9000 : 5000);
}

function errorText(e) {
  if (e?.code === 'ACTION_REJECTED' || e?.info?.error?.code === 4001) return 'Cancelled in wallet.';
  return e?.shortMessage || e?.reason || e?.info?.error?.message || e?.message || String(e);
}

// Run a wallet action with status toasts, then refresh.
async function act(button, fn) {
  if (!state.signer) return toast('Connect a wallet first.', { error: true });
  button.disabled = true;
  try {
    await fn((msg, hash) => toast(msg, { hash, sticky: !msg.endsWith('done') }));
  } catch (e) {
    toast(errorText(e), { error: true });
  } finally {
    button.disabled = false;
    await refresh();
  }
}

// ---------------------------------------------------------------- wallet

function injected() {
  return window.okxwallet || window.ethereum || null;
}

async function ensureXLayer(eth) {
  const hex = '0x' + XLAYER.chainId.toString(16);
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e?.code !== 4902 && e?.data?.originalError?.code !== 4902) throw e;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hex,
        chainName: 'X Layer Mainnet',
        nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
        rpcUrls: [XLAYER.rpc],
        blockExplorerUrls: [XLAYER.explorer],
      }],
    });
  }
}

async function connect() {
  const eth = injected();
  if (!eth) return toast('No wallet found. Install OKX Wallet (or any EVM wallet) and reload.', { error: true });
  try {
    await eth.request({ method: 'eth_requestAccounts' });
    await ensureXLayer(eth);
    const provider = new ethers.BrowserProvider(eth);
    state.signer = await provider.getSigner();
    state.account = await state.signer.getAddress();
    $('connect').textContent = short(state.account);
    await refresh();
  } catch (e) {
    toast(errorText(e), { error: true });
  }
}

function watchWallet() {
  const eth = injected();
  if (!eth?.on) return;
  eth.on('accountsChanged', () => (state.account ? connect() : null));
  eth.on('chainChanged', () => location.reload());
}

// ---------------------------------------------------------------- refresh

async function refresh() {
  const banner = $('banner');
  if (!hasVault()) {
    banner.hidden = false;
    banner.textContent = hasProcessor()
      ? 'OpenGate processor found, but the vault is not deployed yet. Finish the Setup tab.'
      : 'OpenGate is not deployed yet. The creator runs the Setup tab once; after that this page is live for everyone.';
  } else {
    banner.hidden = true;
  }

  try {
    if (hasProcessor()) state.processor = await core.readProcessor(reader, state.deployed.circuits);
    if (hasVault()) state.vault = await core.readVault(reader, state.deployed.vault);
    if (hasVault() && state.account) state.user = await core.readUser(reader, state.deployed, state.account);
  } catch (e) {
    console.error(e);
    toast(`Could not read X Layer: ${errorText(e)}`, { error: true });
  }
  renderVault();
  renderSetup();
  renderTapeout();
}

// ---------------------------------------------------------------- vault tab

function renderVault() {
  const { processor: p, vault: v, user: u } = state;
  $('s-balance').textContent = v ? `${fmtOkb(v.balance)} OKB` : '–';
  $('s-rate').textContent = v ? `${fmtOkb(v.rewardRate * 86400n)} OKB/day` : '–';
  $('s-finish').textContent = v ? (Number(v.periodFinish) * 1000 > Date.now() ? fmtDate(Number(v.periodFinish)) : 'not running') : '–';
  $('s-minted').textContent = p ? `${fmtInt(p.minted)} / ${fmtInt(p.cap)}` : '–';
  $('s-circuit').textContent = v ? `#${v.circuitId} · ${TIER.gates} gates` : '–';
  if (v) $('r-threshold').textContent = fmtInt(ethers.formatEther(v.ignixThreshold));

  const ready = Boolean(state.signer && hasVault());
  for (const id of ['btn-stake', 'btn-unstake', 'btn-claim', 'btn-poke', 'btn-mint']) $(id).disabled = !ready;
  updateMintCost();

  if (!u) {
    $('u-level').textContent = '–';
    $('u-mult').textContent = '–';
    $('u-bits').innerHTML = '';
    return;
  }
  const stakedTotal = u.staked.nand + u.staked.latch;
  $('u-level').textContent = u.level;
  $('u-mult').textContent = `${weightMultiplier(u.level).toFixed(2)}× weight`;
  $('u-level-note').textContent = !u.evalOk
    ? 'The circuit call failed, so you are at tier 0. Unstaking still works.'
    : stakedTotal === 0n
      ? 'Stake transistors to start earning.'
      : u.liveLevel !== u.level
        ? `Your circuit now says tier ${u.liveLevel}. Refresh to apply it.`
        : 'Up to date with the circuit.';
  $('btn-poke').classList.toggle('primary', u.evalOk && u.liveLevel !== u.level);

  const sizeB = u.inputBits[0] | (u.inputBits[1] << 1);
  const ageB = u.inputBits[2] | (u.inputBits[3] << 1);
  const bits = [
    ['Stake size', sizeB, `${sizeB}`],
    ['Stake age', ageB, `${ageB}`],
    ['Builder', u.inputBits[4], u.inputBits[4] ? 'yes' : 'no'],
    ['IGNIX holder', u.inputBits[5], u.inputBits[5] ? 'yes' : 'no'],
  ];
  $('u-bits').innerHTML = bits
    .map(([k, on, label]) => `<div class="bit${on ? ' on' : ''}"><span>${k}</span><b>${label}</b></div>`)
    .join('');

  $('u-wallet').textContent = `${fmtInt(u.wallet.nand)} NAND · ${fmtInt(u.wallet.latch)} LATCH`;
  $('u-staked').textContent = `${fmtInt(u.staked.nand)} NAND · ${fmtInt(u.staked.latch)} LATCH`;
  $('u-since').textContent = stakedTotal > 0n ? fmtDate(u.stakeStart) : '–';
  $('u-earned').textContent = fmtOkb(u.earned, 6);
}

async function updateMintCost() {
  const n = parseInt($('in-mint').value, 10);
  const p = state.processor;
  if (!p || !(n > 0)) { $('mint-cost').textContent = p ? `${fmtOkb(p.price, 6)} OKB each + ${fmtOkb(p.fee, 5)} OKB fee per mint` : '–'; return; }
  $('mint-cost').textContent = `Total ${fmtOkb(p.price * BigInt(n) + p.fee, 6)} OKB`;
}

function bindVault() {
  $('in-mint').addEventListener('input', updateMintCost);
  $('btn-mint').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const n = parseInt($('in-mint').value, 10);
    if (!(n > 0)) throw new Error('Enter how many transistors to mint.');
    await core.mint(state.signer, state.deployed.transistors, NAND, n, s);
  }));
  $('btn-stake').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const n = parseInt($('in-stake').value, 10);
    if (!(n > 0)) throw new Error('Enter how many NAND transistors to stake.');
    await core.stake(state.signer, state.deployed, n, 0, s);
  }));
  $('btn-unstake').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const n = parseInt($('in-stake').value, 10);
    if (!(n > 0)) throw new Error('Enter how many NAND transistors to unstake.');
    await core.unstake(state.signer, state.deployed.vault, n, 0, s);
  }));
  $('btn-claim').addEventListener('click', (e) => act(e.currentTarget, (s) => core.claim(state.signer, state.deployed.vault, s)));
  $('btn-poke').addEventListener('click', (e) => act(e.currentTarget, (s) => core.poke(state.signer, state.deployed.vault, state.account, s)));
}

// ---------------------------------------------------------------- circuit tab

const circuitView = { built: false, elements: [], nodes: new Map() };

function buildCircuitSvg() {
  const { elements } = simulateAll(TIER.netlistHex, TIER.nIn, new Array(TIER.nIn).fill(0));
  const depth = new Map();
  for (let i = 0; i < 2 + TIER.nIn; i++) depth.set(i, 0);
  const columns = [];
  for (const e of elements) {
    const d = 1 + Math.max(depth.get(e.a) ?? 0, depth.get(e.b) ?? 0);
    depth.set(e.out, d);
    (columns[d] ||= []).push(e);
  }
  const colW = 70, rowH = 38, gw = 34, gh = 22, x0 = 110, y0 = 30;
  const rows = Math.max(TIER.nIn, ...columns.filter(Boolean).map((c) => c.length));
  const outputs = new Set(elements.slice(-TIER.nOut).map((e) => e.out));
  const outX = x0 + (columns.length - 1) * colW + 30; // dedicated output column
  const width = outX + 90;
  const height = y0 + rows * rowH + 10;
  const pos = new Map();

  for (let k = 0; k < TIER.nIn; k++) {
    const y = y0 + (k + 0.5) * (rows * rowH / TIER.nIn);
    pos.set(2 + k, { x: x0 - 20, y });
  }
  columns.forEach((col, d) => {
    if (!col) return;
    const offset = (rows - col.length) * rowH / 2;
    col.forEach((e, r) => pos.set(e.out, { x: x0 + (d - 1) * colW + 20, y: y0 + offset + r * rowH + rowH / 2 }));
  });

  const ns = 'http://www.w3.org/2000/svg';
  const svg = $('c-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';
  const mk = (tag, attrs, parent = svg) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.append(el);
    return el;
  };
  const wires = mk('g', {});
  const nodes = mk('g', {});
  const srcPoint = (sig) => {
    const p = pos.get(sig);
    return sig >= 2 + TIER.nIn ? { x: p.x + gw, y: p.y } : { x: p.x + 6, y: p.y };
  };

  for (const e of elements) {
    const p = pos.get(e.out);
    for (const [sig, dy] of [[e.a, -5], [e.b, 5]]) {
      if (sig < 2) continue; // constants are not drawn
      const s = srcPoint(sig);
      const tx = p.x, ty = p.y + dy;
      const mx = (s.x + tx) / 2;
      const path = mk('path', { class: 'wire', d: `M${s.x},${s.y} C${mx},${s.y} ${mx},${ty} ${tx},${ty}` }, wires);
      circuitView.nodes.set(`w${e.out}-${dy}`, { el: path, sig });
    }
    const g = mk('g', { class: 'gate' }, nodes);
    mk('rect', { x: p.x, y: p.y - gh / 2, width: gw, height: gh, rx: 6 }, g);
    const t = mk('text', { x: p.x + gw / 2, y: p.y + 3, 'text-anchor': 'middle' }, g);
    t.textContent = outputs.has(e.out) ? 'OUT' : 'NAND';
    circuitView.nodes.set(`g${e.out}`, { el: g, sig: e.out });
  }
  for (let k = 0; k < TIER.nIn; k++) {
    const p = pos.get(2 + k);
    const g = mk('g', { class: 'pin' }, nodes);
    mk('circle', { cx: p.x + 6, cy: p.y, r: 5 }, g);
    const t = mk('text', { x: p.x - 4, y: p.y + 4, 'text-anchor': 'end', class: 'label' }, g);
    t.textContent = INPUT_LABELS[k];
    circuitView.nodes.set(`p${k}`, { el: g, sig: 2 + k });
  }
  [...outputs].forEach((sig, i) => {
    const s = srcPoint(sig);
    const y = y0 + rows * rowH / 2 + (i - 1) * 44;
    const mx = (s.x + outX) / 2;
    const path = mk('path', { class: 'wire', d: `M${s.x},${s.y} C${mx},${s.y} ${mx},${y} ${outX},${y}` }, wires);
    circuitView.nodes.set(`o${i}-w`, { el: path, sig });
    const g = mk('g', { class: 'pin' }, nodes);
    mk('circle', { cx: outX + 5, cy: y, r: 5 }, g);
    const t = mk('text', { x: outX + 14, y: y + 4, class: 'label' }, g);
    t.textContent = `tier bit ${i}`;
    circuitView.nodes.set(`o${i}`, { el: g, sig });
  });
  circuitView.built = true;
}

function renderCircuit() {
  if (!circuitView.built) buildCircuitSvg();
  const bits = state.circuitInputs;
  const { signals, nSignals } = simulateAll(TIER.netlistHex, TIER.nIn, bits);
  for (const { el, sig } of circuitView.nodes.values()) el.classList.toggle('on', signals[sig] === 1);
  const outs = signals.slice(nSignals - TIER.nOut);
  $('c-local').textContent = outs[0] | (outs[1] << 1) | (outs[2] << 2);
  $('c-chain').textContent = '–';
  $('c-gates').textContent = TIER.gates;

  $('c-toggles').innerHTML = bits
    .map((b, k) => `<span class="toggle${b ? ' on' : ''}" data-k="${k}" role="switch" aria-checked="${!!b}" tabindex="0"><span class="dot"></span>${INPUT_LABELS[k]}</span>`)
    .join('');
}

function bindCircuit() {
  $('c-toggles').addEventListener('click', (e) => {
    const t = e.target.closest('.toggle');
    if (!t) return;
    const k = Number(t.dataset.k);
    state.circuitInputs[k] ^= 1;
    renderCircuit();
  });
  $('c-toggles').addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.target.click(); }
  });
  $('btn-eval').addEventListener('click', async (e) => {
    if (!hasVault()) return toast('The circuit is not taped out yet.', { error: true });
    e.currentTarget.disabled = true;
    try {
      const byte = state.circuitInputs.reduce((acc, b, k) => acc | (b << k), 0);
      const out = await core.circuitsAt(state.deployed.circuits, reader).eval(state.deployed.circuitId, ethers.toBeHex(byte, 1));
      const level = ethers.getBytes(out)[0] & 7;
      $('c-chain').textContent = level;
      const match = String(level) === $('c-local').textContent;
      toast(match ? 'X Layer agrees with the browser simulation.' : 'Mismatch between chain and simulation!', { error: !match });
    } catch (err) {
      toast(errorText(err), { error: true });
    } finally {
      e.currentTarget.disabled = false;
    }
  });
  $('btn-mine').addEventListener('click', () => {
    if (!state.user) return toast('Connect a wallet (with the vault deployed) to load your inputs.', { error: true });
    state.circuitInputs = [...state.user.inputBits];
    renderCircuit();
  });
}

// ---------------------------------------------------------------- tape-out tab

const tapeoutDesign = { netlistHex: null, nIn: null, nOut: null, nNand: 0, nLatch: 0, gates: 0 };

function parseDesign() {
  const raw = $('to-input').value.trim();
  let netlistHex = null, nIn = parseInt($('to-nin').value, 10), nOut = parseInt($('to-nout').value, 10);
  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      if (j.verified === false) throw new Error('This design is marked unverified. Do not tape it out.');
      netlistHex = j.netlistHex;
      nIn = j.nIn;
      nOut = j.nOut;
      $('to-nin').value = nIn;
      $('to-nout').value = nOut;
    } catch (e) {
      return { error: e.message };
    }
  } else if (raw) {
    netlistHex = raw;
  }
  if (!netlistHex) return { error: 'Paste a design first.' };
  if (!/^0x([0-9a-fA-F]{2})+$/.test(netlistHex)) return { error: 'Netlist must be 0x-prefixed hex.' };
  if (!(nIn > 0) || !(nOut > 0)) return { error: 'Set the number of inputs and outputs.' };
  try {
    const { elements, nSignals } = simulateAll(netlistHex, nIn, []);
    elements.forEach((e) => {
      const refs = e.op === 0 ? [e.a, e.b] : [e.d];
      if (refs.some((r) => r >= e.out)) throw new Error(`gate ${e.out} reads a later signal`);
    });
    if (nOut > elements.length) throw new Error('more outputs than gates');
    const nNand = elements.filter((e) => e.op === 0).length;
    return { netlistHex, nIn, nOut, nNand, nLatch: elements.length - nNand, gates: elements.length, nSignals };
  } catch (e) {
    return { error: `Invalid netlist: ${e.message}` };
  }
}

function renderTapeout() {
  const d = parseDesign();
  const btn = $('btn-tapeout');
  if (d.error) {
    $('to-summary').textContent = $('to-input').value.trim() ? d.error : 'Paste a design, or load TierLogic v1 to try it.';
    $('to-gates').value = '';
    btn.disabled = true;
    return;
  }
  Object.assign(tapeoutDesign, d);
  $('to-gates').value = d.gates;
  const p = state.processor;
  const cost = p ? p.price * BigInt(d.nNand + d.nLatch) + p.fee + BigInt(XLAYER.tapeoutFee) : null;
  $('to-summary').textContent = `${d.nNand} NAND + ${d.nLatch} LATCH · ${d.nIn} in / ${d.nOut} out` +
    (cost ? ` · up to ${fmtOkb(cost, 6)} OKB (transistors + mint fee + 0.0013 tape-out fee)` : '') +
    (d.gates > 2000 ? ' · warning: large circuits cost a lot of gas to eval()' : '');
  btn.disabled = !(state.signer && hasProcessor());
}

function bindTapeout() {
  for (const id of ['to-input', 'to-nin', 'to-nout']) $(id).addEventListener('input', renderTapeout);
  $('btn-to-tier').addEventListener('click', () => {
    $('to-input').value = JSON.stringify({ netlistHex: TIER.netlistHex, nIn: TIER.nIn, nOut: TIER.nOut, nNand: TIER.nNand });
    renderTapeout();
  });
  $('btn-tapeout').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const r = await core.tapeout(state.signer, state.deployed.circuits, tapeoutDesign, s);
    toast(`Taped out circuit #${r.circuitId} (${r.gateCount} gates). You are now a builder: refresh your tier.`, { hash: r.hash });
  }));
}

// ---------------------------------------------------------------- setup tab

function renderSetup() {
  const d = state.deployed;
  const signed = Boolean(state.signer);
  $('st1-desc').textContent = `"${PROCESSOR.name}" (${PROCESSOR.symbol}) · ${fmtInt(PROCESSOR.supply)} transistors at ${PROCESSOR.priceOkb} OKB each. Both are permanent. Factory fee: ${fmtOkb(BigInt(XLAYER.deployFee))} OKB.`;
  $('st3-desc').textContent = `Reward periods of ${VAULT.rewardsDurationDays} days; IGNIX holder bonus at ${fmtInt(VAULT.ignixThreshold)} IGNIX. You become the vault owner (policy changes only, behind a 2-day timelock).`;
  $('btn-st1').disabled = !signed || hasProcessor();
  $('btn-st2').disabled = !signed || !hasProcessor() || Boolean(d.circuitId);
  $('btn-st3').disabled = !signed || !d.circuitId || Boolean(d.vault);
  $('btn-st4').disabled = !signed || !hasVault();
  const link = (a) => `<a href="${XLAYER.explorer}/address/${a}" target="_blank" rel="noopener">${a}</a>`;
  $('st1-out').innerHTML = hasProcessor() ? `<span class="ok">✓</span> processor ${link(d.circuits)}<br>transistors ${link(d.transistors)}` : '';
  $('st2-out').innerHTML = d.circuitId ? `<span class="ok">✓</span> TierLogic v1 is circuit #${d.circuitId}` : '';
  $('st3-out').innerHTML = d.vault ? `<span class="ok">✓</span> vault ${link(d.vault)}` : '';
  renderConfig();
}

function renderConfig() {
  const d = state.deployed;
  $('cfg-out').textContent = `export const DEPLOYED = {\n  circuits: '${d.circuits}',\n  transistors: '${d.transistors}',\n  circuitId: '${d.circuitId}',\n  vault: '${d.vault}',\n};`;
}

function bindSetup() {
  $('btn-st1').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const r = await core.createProcessor(state.signer, PROCESSOR, s);
    saveDeployed({ circuits: r.circuits, transistors: r.transistors });
  }));
  $('btn-st2').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const r = await core.tapeout(state.signer, state.deployed.circuits, TIER, s);
    saveDeployed({ circuitId: String(r.circuitId) });
  }));
  $('btn-st3').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const r = await core.deployVault(state.signer, { circuits: state.deployed.circuits, circuitId: state.deployed.circuitId, ...VAULT }, s);
    saveDeployed({ vault: r.vault });
  }));
  $('btn-st4').addEventListener('click', (e) => act(e.currentTarget, async (s) => {
    const okb = $('in-fund').value;
    if (!(Number(okb) > 0)) throw new Error('Enter an OKB amount.');
    await core.fund(state.signer, state.deployed.vault, okb, s);
  }));
  $('btn-copy-cfg').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('cfg-out').textContent); toast('Copied.'); } catch { toast('Copy failed; select the text instead.', { error: true }); }
  });
  $('btn-reset-cfg').addEventListener('click', () => {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    state.deployed = loadDeployed();
    refresh();
  });
}

// ---------------------------------------------------------------- boot

function bindTabs() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
    if (b.dataset.tab === 'circuit') renderCircuit();
  }));
}

bindTabs();
bindVault();
bindCircuit();
bindTapeout();
bindSetup();
$('connect').addEventListener('click', connect);
watchWallet();
renderCircuit();
refresh();
setInterval(refresh, 20_000);
