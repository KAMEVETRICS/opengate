// Drives web/core.js (the exact module the browser app uses) through the full
// OpenGate setup and user flow on a fork of X Layer. Run with FORK=1.
const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const path = require('path');
const { pathToFileURL } = require('url');

const describeFork = process.env.FORK ? describe : describe.skip;
const DAY = 86400;

describeFork('web/core.js on forked X Layer', function () {
  let core, gen, cfgMod, owner, user, dep;
  const statuses = [];

  before(async function () {
    await network.provider.send('evm_mine');
    const url = (p) => pathToFileURL(path.join(__dirname, '..', 'web', p)).href;
    const mod = await import(url('core.js'));
    gen = await import(url('generated.js'));
    cfgMod = await import(url('config.js'));
    core = { ...mod, ...mod.createCore(ethers) };
    [owner, user] = await ethers.getSigners();
  });

  it('runs the owner setup: processor → tape out TierLogic → vault → fund', async function () {
    const onStatus = (s) => statuses.push(s);
    const p = await core.createProcessor(owner, cfgMod.PROCESSOR, onStatus);
    const t = await core.tapeout(owner, p.circuits, gen.TIER, onStatus);
    const v = await core.deployVault(owner, { circuits: p.circuits, circuitId: t.circuitId, ...cfgMod.VAULT }, onStatus);
    dep = { circuits: p.circuits, transistors: p.transistors, circuitId: t.circuitId, vault: v.vault };
    await core.fund(owner, dep.vault, '0.5', onStatus);

    const proc = await core.readProcessor(ethers.provider, dep.circuits);
    expect(proc.cap).to.equal(10_000_000n);
    expect(proc.price).to.equal(ethers.parseEther('0.0001'));
    expect(proc.circuitCount).to.equal(1n);
    expect(t.gateCount).to.equal(gen.TIER.gates);

    const vs = await core.readVault(ethers.provider, dep.vault);
    expect(vs.circuitId).to.equal(t.circuitId);
    expect(vs.ignixThreshold).to.equal(ethers.parseEther('100000'));
    expect(vs.balance).to.equal(ethers.parseEther('0.5'));
    expect(statuses.some((s) => s.startsWith('Tape out: done'))).to.equal(true);
  });

  it('runs the user flow: mint → stake (auto-approve) → level → poke → claim → unstake', async function () {
    await core.mint(user, dep.transistors, core.NAND, 2_000);
    await core.stake(user, dep, 2_000, 0);

    let u = await core.readUser(ethers.provider, dep, user.address);
    expect(u.approved).to.equal(true);
    expect(u.staked.nand).to.equal(2_000n);
    expect(u.level).to.equal(2); // size bucket 2 (>=1,000), age 0
    expect(u.inputBits.slice(0, 2)).to.deep.equal([0, 1]);

    await time.increase(DAY + 5);
    u = await core.readUser(ethers.provider, dep, user.address);
    expect(u.liveLevel).to.equal(3); // age crossed 1 day; stored level is stale
    expect(u.level).to.equal(2);
    await core.poke(user, dep.vault);
    u = await core.readUser(ethers.provider, dep, user.address);
    expect(u.level).to.equal(3);
    expect(u.earned).to.be.gt(0n);

    // The browser's local simulation agrees with the chain's eval().
    const sim = core.simulateAll(gen.TIER.netlistHex, gen.TIER.nIn, u.inputBits);
    const outs = sim.signals.slice(sim.nSignals - 3);
    expect(outs[0] | (outs[1] << 1) | (outs[2] << 2)).to.equal(u.liveLevel);

    await core.claim(user, dep.vault);
    await core.unstake(user, dep.vault, 2_000, 0);
    u = await core.readUser(ethers.provider, dep, user.address);
    expect(u.wallet.nand).to.equal(2_000n);
    expect(u.staked.nand).to.equal(0n);
  });

  it('lets the creator withdraw mint earnings', async function () {
    const t = core.transistorsAt(dep.transistors, owner);
    expect(await t.owed(owner.address)).to.be.gt(0n);
    await core.withdrawEarnings(owner, dep.transistors);
    expect(await t.owed(owner.address)).to.equal(0n);
  });
});
