// All chain logic for the OpenGate app. Pure ES module with ethers injected, so the
// same code runs in the browser (ethers UMD from a CDN) and in the forked-chain tests.
import { XLAYER, FACTORY_ABI, CIRCUITS_ABI, TRANSISTORS_ABI, TIER, VAULT_ABI, VAULT_BYTECODE } from './generated.js';

export const NAND = 0;
export const LATCH = 1;

// ---------------------------------------------------------------- circuit sim

// Decode a NAND/LATCH netlist and evaluate every signal (latches read as 0).
// Returns { elements, signals } where signals[i] is 0/1 for every signal index.
export function simulateAll(netlistHex, nIn, inBits) {
  const hex = netlistHex.replace(/^0x/, '');
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const elements = [];
  let p = 0;
  let next = 2 + nIn;
  const u24 = () => { const v = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3; return v; };
  while (p < b.length) {
    const op = b[p++];
    if (op === 0) elements.push({ op, a: u24(), b: u24(), out: next++ });
    else if (op === 1) elements.push({ op, d: u24(), out: next++ });
    else throw new Error(`unsupported opcode ${op}`);
  }
  const signals = new Array(next).fill(0);
  signals[1] = 1;
  inBits.forEach((v, k) => { signals[2 + k] = v ? 1 : 0; });
  for (const e of elements) signals[e.out] = e.op === 0 ? 1 - (signals[e.a] & signals[e.b]) : 0;
  return { elements, signals, nSignals: next };
}

export function inputBitsFromByte(byte) {
  return Array.from({ length: TIER.nIn }, (_, k) => (byte >> k) & 1);
}

export function referenceLevel(size, age, builder, ignix) {
  return Math.min(7, size + age + (builder ? 1 : 0) + (ignix ? 1 : 0));
}

export const weightMultiplier = (level) => 1 + 0.25 * level;

// Tier a policy netlist gives for each of the 64 possible inputs.
export function policyLevels(netlistHex) {
  return Array.from({ length: 64 }, (_, x) => {
    const { signals, nSignals } = simulateAll(netlistHex, TIER.nIn, inputBitsFromByte(x));
    const o = signals.slice(nSignals - TIER.nOut);
    return o[0] | (o[1] << 1) | (o[2] << 2);
  });
}

export function describeInput(x) {
  const size = ['<100', '≥100', '≥1k', '≥10k'][x & 3];
  const age = ['<1d', '≥1d', '≥7d', '≥30d'][(x >> 2) & 3];
  return `stake ${size}, age ${age}${(x >> 4) & 1 ? ', builder' : ''}${(x >> 5) & 1 ? ', IGNIX holder' : ''}`;
}

// Compare two policies over every situation a staker can be in.
export function policyDiff(fromNetlist, toNetlist) {
  const a = policyLevels(fromNetlist);
  const b = policyLevels(toNetlist);
  const changes = [];
  for (let x = 0; x < 64; x++) if (a[x] !== b[x]) changes.push({ x, from: a[x], to: b[x], label: describeInput(x) });
  return {
    from: a,
    to: b,
    changes,
    up: changes.filter((c) => c.to > c.from).length,
    down: changes.filter((c) => c.to < c.from).length,
  };
}

// ---------------------------------------------------------------- core

export function createCore(ethers) {
  const factoryAt = (runner) => new ethers.Contract(XLAYER.factory, FACTORY_ABI, runner);
  const circuitsAt = (addr, runner) => new ethers.Contract(addr, CIRCUITS_ABI, runner);
  const transistorsAt = (addr, runner) => new ethers.Contract(addr, TRANSISTORS_ABI, runner);
  const vaultAt = (addr, runner) => new ethers.Contract(addr, VAULT_ABI, runner);

  function findEvent(contract, receipt, name) {
    const target = String(contract.target).toLowerCase();
    for (const log of receipt.logs) {
      if (String(log.address).toLowerCase() !== target) continue;
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === name) return parsed;
      } catch { /* other event */ }
    }
    throw new Error(`${name} event not found in tx ${receipt.hash}`);
  }

  async function send(txPromise, onStatus, label) {
    onStatus?.(`${label}: confirm in your wallet…`);
    const tx = await txPromise;
    onStatus?.(`${label}: waiting for X Layer…`, tx.hash);
    const rc = await tx.wait();
    if (rc.status !== 1) throw new Error(`${label} reverted (${tx.hash})`);
    onStatus?.(`${label}: done`, tx.hash);
    return rc;
  }

  // Step 1: create the processor through the official TapeOut factory.
  async function createProcessor(signer, { name, symbol, story, supply, priceOkb }, onStatus) {
    const factory = factoryAt(signer);
    const fee = await factory.deployFee();
    const rc = await send(
      factory.createCPU(name, symbol, story, BigInt(supply), ethers.parseEther(String(priceOkb)), { value: fee }),
      onStatus, 'Create processor',
    );
    const ev = findEvent(factory, rc, 'CPUCreated');
    return { circuits: ev.args.circuits, transistors: ev.args.transistors, hash: rc.hash };
  }

  async function mintCost(transistorsAddr, runner, amount) {
    const t = transistorsAt(transistorsAddr, runner);
    const [price, fee] = await Promise.all([t.mintPrice(), t.protocolFee()]);
    return price * BigInt(amount) + fee;
  }

  async function mint(signer, transistorsAddr, id, amount, onStatus) {
    if (BigInt(amount) <= 0n) throw new Error('amount must be positive');
    const t = transistorsAt(transistorsAddr, signer);
    const value = await mintCost(transistorsAddr, signer, amount);
    return send(t.mint(id, BigInt(amount), { value }), onStatus, `Mint ${amount} ${id === NAND ? 'NAND' : 'LATCH'}`);
  }

  // Step 2: tape out a netlist, minting any missing transistors first.
  async function tapeout(signer, circuitsAddr, { netlistHex, nIn, nOut, nNand, nLatch = 0 }, onStatus) {
    const me = await signer.getAddress();
    const circuits = circuitsAt(circuitsAddr, signer);
    const transistorsAddr = await circuits.transistors();
    const t = transistorsAt(transistorsAddr, signer);
    const [haveNand, haveLatch] = await Promise.all([t.balanceOf(me, NAND), t.balanceOf(me, LATCH)]);
    if (BigInt(nNand) > haveNand) await mint(signer, transistorsAddr, NAND, BigInt(nNand) - haveNand, onStatus);
    if (BigInt(nLatch) > haveLatch) await mint(signer, transistorsAddr, LATCH, BigInt(nLatch) - haveLatch, onStatus);
    const fee = await circuits.TAPEOUT_FEE();
    const rc = await send(circuits.tapeout(netlistHex, nIn, nOut, { value: fee }), onStatus, 'Tape out');
    const ev = findEvent(circuits, rc, 'TapedOut');
    return { circuitId: ev.args.circuitId, gateCount: Number(ev.args.gateCount), hash: rc.hash };
  }

  // Step 3: deploy the vault from the browser wallet.
  async function deployVault(signer, { circuits, circuitId, ignixThreshold, rewardsDurationDays }, onStatus) {
    const owner = await signer.getAddress();
    const factory = new ethers.ContractFactory(VAULT_ABI, VAULT_BYTECODE, signer);
    onStatus?.('Deploy vault: confirm in your wallet…');
    const vault = await factory.deploy(
      circuits, BigInt(circuitId), XLAYER.ignix, ethers.parseEther(String(ignixThreshold)),
      BigInt(rewardsDurationDays) * 86400n, owner,
    );
    const tx = vault.deploymentTransaction();
    onStatus?.('Deploy vault: waiting for X Layer…', tx.hash);
    await vault.waitForDeployment();
    onStatus?.('Deploy vault: done', tx.hash);
    return { vault: await vault.getAddress(), hash: tx.hash };
  }

  // ---------------------------------------------------------------- reads

  async function readProcessor(provider, circuitsAddr) {
    const circuits = circuitsAt(circuitsAddr, provider);
    const transistorsAddr = await circuits.transistors();
    const t = transistorsAt(transistorsAddr, provider);
    const [price, fee, cap, minted, nextId] = await Promise.all([
      t.mintPrice(), t.protocolFee(), t.supplyCap(), t.minted(), circuits.nextId(),
    ]);
    // Despite its name, nextId() is the id of the latest circuit (ids start at 1),
    // i.e. the circuit count.
    return { circuits: circuitsAddr, transistors: transistorsAddr, price, fee, cap, minted, circuitCount: nextId };
  }

  async function readVault(provider, vaultAddr) {
    const v = vaultAt(vaultAddr, provider);
    const [circuitId, rewardRate, periodFinish, totalWeight, balance, pendingCircuitId, pendingCircuitEta, owner, threshold] = await Promise.all([
      v.circuitId(), v.rewardRate(), v.periodFinish(), v.totalWeight(), provider.getBalance(vaultAddr),
      v.pendingCircuitId(), v.pendingCircuitEta(), v.owner(), v.ignixThreshold(),
    ]);
    return { circuitId, rewardRate, periodFinish, totalWeight, balance, pendingCircuitId, pendingCircuitEta, owner, ignixThreshold: threshold };
  }

  // A taped-out circuit's netlist, read from the chain (cached: circuits are immutable).
  const netlistCache = new Map();
  async function readNetlist(provider, circuitsAddr, circuitId) {
    const key = `${circuitsAddr}:${circuitId}`.toLowerCase();
    if (!netlistCache.has(key)) {
      const c = circuitsAt(circuitsAddr, provider);
      const [info, netlistHex] = await Promise.all([c.circuitInfo(circuitId), c.netlist(circuitId)]);
      netlistCache.set(key, { netlistHex, nIn: Number(info[0]), nOut: Number(info[1]), gates: Number(info[3]) });
    }
    return netlistCache.get(key);
  }

  async function readUser(provider, { vault: vaultAddr, transistors: transistorsAddr }, user) {
    const v = vaultAt(vaultAddr, provider);
    const t = transistorsAt(transistorsAddr, provider);
    const ig = new ethers.Contract(XLAYER.ignix, ['function balanceOf(address) view returns (uint256)'], provider);
    const [staker, input, preview, earned, nand, latch, approved, ignix] = await Promise.all([
      v.stakers(user), v.circuitInput(user), v.previewLevel(user), v.earned(user),
      t.balanceOf(user, NAND), t.balanceOf(user, LATCH), t.isApprovedForAll(user, vaultAddr),
      ig.balanceOf(user).catch(() => null),
    ]);
    const inputByte = parseInt(input, 16);
    return {
      staked: { nand: staker.nand, latch: staker.latch },
      stakeStart: Number(staker.stakeStart),
      level: Number(staker.level),
      weight: staker.weight,
      liveLevel: Number(preview[0]),
      evalOk: preview[1],
      inputByte,
      inputBits: inputBitsFromByte(inputByte),
      earned,
      wallet: { nand, latch },
      approved,
      ignix,
    };
  }

  // ---------------------------------------------------------------- writes

  async function stake(signer, { vault: vaultAddr, transistors: transistorsAddr }, nand, latch, onStatus) {
    const me = await signer.getAddress();
    const t = transistorsAt(transistorsAddr, signer);
    if (!(await t.isApprovedForAll(me, vaultAddr))) {
      await send(t.setApprovalForAll(vaultAddr, true), onStatus, 'Approve vault');
    }
    return send(vaultAt(vaultAddr, signer).stake(BigInt(nand), BigInt(latch)), onStatus, 'Stake');
  }

  const unstake = (signer, vaultAddr, nand, latch, onStatus) =>
    send(vaultAt(vaultAddr, signer).unstake(BigInt(nand), BigInt(latch)), onStatus, 'Unstake');
  const claim = (signer, vaultAddr, onStatus) => send(vaultAt(vaultAddr, signer).claim(), onStatus, 'Claim');
  const poke = async (signer, vaultAddr, user, onStatus) =>
    send(vaultAt(vaultAddr, signer).poke(user ?? (await signer.getAddress())), onStatus, 'Refresh level');
  const fund = (signer, vaultAddr, okb, onStatus) =>
    send(vaultAt(vaultAddr, signer).fund({ value: ethers.parseEther(String(okb)) }), onStatus, 'Fund rewards');
  const withdrawEarnings = (signer, transistorsAddr, onStatus) =>
    send(transistorsAt(transistorsAddr, signer).withdraw(), onStatus, 'Withdraw mint earnings');
  // Vault owner: new policy circuits wait out the vault's 2-day timelock.
  const proposeCircuit = (signer, vaultAddr, circuitId, onStatus) =>
    send(vaultAt(vaultAddr, signer).proposeCircuit(BigInt(circuitId)), onStatus, `Propose circuit #${circuitId}`);
  const activateCircuit = (signer, vaultAddr, onStatus) =>
    send(vaultAt(vaultAddr, signer).activateCircuit(), onStatus, 'Activate policy');

  return {
    createProcessor, mint, mintCost, tapeout, deployVault,
    readProcessor, readVault, readUser, readNetlist,
    stake, unstake, claim, poke, fund, withdrawEarnings, proposeCircuit, activateCircuit,
    circuitsAt, transistorsAt, vaultAt,
  };
}
