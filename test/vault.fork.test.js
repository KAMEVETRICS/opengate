// End-to-end test against a local fork of X Layer mainnet, using the real
// TapeOut factory, transistors and circuits contracts. Run with:
//   FORK=1 npx hardhat test test/vault.fork.test.js
const { expect } = require('chai');
const { ethers, network } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const tier = require('../circuit/tierLogic');
const { pack } = require('../circuit/netlist');
const { XLAYER, FACTORY_ABI, CIRCUITS_ABI, TRANSISTORS_ABI } = require('../scripts/tapeout');

const describeFork = process.env.FORK ? describe : describe.skip;
const OKB = (v) => ethers.parseEther(String(v));
const DAY = 24 * 3600;

describeFork('CircuitVault on forked X Layer', function () {
  let creator, alice, bob, funder;
  let factory, circuits, transistors, vault, circuitId, ignix;

  async function mint(signer, id, amount) {
    const price = await transistors.mintPrice();
    const fee = await transistors.protocolFee();
    await (await transistors.connect(signer).mint(id, amount, { value: price * BigInt(amount) + fee })).wait();
  }

  before(async function () {
    // Move past the fork block so calls run on the local EVM, not "historical" state.
    await network.provider.send('evm_mine');
    [creator, alice, bob, funder] = await ethers.getSigners();
    factory = new ethers.Contract(XLAYER.factory, FACTORY_ABI, creator);

    // 1. Create a processor through the official factory.
    const fee = await factory.deployFee();
    const tx = await factory.createCPU('Circuit Vault Test', 'CVT', 'fork test', 1_000_000, OKB('0.0001'), { value: fee });
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'CPUCreated');
    circuits = new ethers.Contract(ev.args.circuits, CIRCUITS_ABI, creator);
    transistors = new ethers.Contract(ev.args.transistors, TRANSISTORS_ABI, creator);

    // 2. Mint the transistors the circuit needs and tape it out.
    await mint(creator, 0, tier.nNand);
    const tfee = await circuits.TAPEOUT_FEE();
    const trc = await (await circuits.tapeout(tier.netlistHex, tier.N_IN, tier.N_OUT, { value: tfee })).wait();
    const tev = trc.logs.map((l) => { try { return circuits.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'TapedOut');
    circuitId = tev.args.circuitId;

    ignix = new ethers.Contract(XLAYER.ignix, ['function balanceOf(address) view returns (uint256)'], creator);

    // 3. Deploy the vault (7-day reward periods, 1,000 IGNIX threshold).
    const Vault = await ethers.getContractFactory('CircuitVault');
    vault = await Vault.deploy(await circuits.getAddress(), circuitId, XLAYER.ignix, OKB(1000), 7 * DAY, creator.address);
    await vault.waitForDeployment();
  });

  it('taped out the circuit on the real processor with the expected shape', async function () {
    const [nIn, nOut, nState, gateCount] = await circuits.circuitInfo(circuitId);
    expect([nIn, nOut, nState, gateCount].map(Number)).to.deep.equal([6, 3, 0, tier.gateCount]);
    expect(await circuits.ownerOf(circuitId)).to.equal(creator.address);
  });

  it('real eval() matches the reference level for all 64 inputs', async function () {
    for (let x = 0; x < 64; x++) {
      const inputs = { sizeBucket: x & 3, ageBucket: (x >> 2) & 3, builder: (x >> 4) & 1, ignix: (x >> 5) & 1 };
      const out = await circuits.eval(circuitId, ethers.hexlify(pack(tier.inputBits(inputs))));
      expect(Number(ethers.getBytes(out)[0]) & 7, `input ${x}`).to.equal(tier.referenceLevel(inputs));
    }
  });

  it('stakes, levels up through the circuit, and pays weighted rewards', async function () {
    await mint(alice, 0, 1_000);
    await mint(bob, 0, 100);
    for (const s of [alice, bob]) await (await transistors.connect(s).setApprovalForAll(await vault.getAddress(), true)).wait();

    await vault.connect(alice).stake(1_000, 0); // size bucket 2
    await vault.connect(bob).stake(100, 0); // size bucket 1
    expect((await vault.stakers(alice.address)).level).to.equal(2);
    expect((await vault.stakers(bob.address)).level).to.equal(1);

    await vault.connect(funder).fund({ value: OKB(1) });

    // Age buckets grow; a poke re-runs the circuit.
    await time.increase(8 * DAY - 60);
    await vault.poke(alice.address);
    expect((await vault.stakers(alice.address)).level).to.equal(4); // size 2 + age 2

    // Builder bit: bob tapes out a tiny circuit on this processor.
    await mint(bob, 0, 1);
    const tfee = await circuits.TAPEOUT_FEE();
    await (await circuits.connect(bob).tapeout('0x00000002000002', 1, 1, { value: tfee })).wait(); // NOT gate
    await vault.poke(bob.address);
    expect((await vault.stakers(bob.address)).level).to.equal(4); // size 1 + age 2 + builder 1

    await time.increase(2 * DAY);
    const before = await ethers.provider.getBalance(alice.address);
    const earnedA = await vault.earned(alice.address);
    const earnedB = await vault.earned(bob.address);
    expect(earnedA).to.be.gt(earnedB * 5n); // 10x the stake and never lower level
    const rc = await (await vault.connect(alice).claim()).wait();
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before + rc.gasUsed * rc.gasPrice).to.be.closeTo(earnedA, earnedA / 1000n);

    // Everything funded is accounted for (rounding dust only).
    const paidOut = earnedA;
    const owed = await vault.earned(bob.address) + await vault.earned(alice.address);
    expect(paidOut + owed).to.be.closeTo(OKB(1), OKB('0.000001'));
  });

  it('partial unstake resets age and drops to level 0 until poked', async function () {
    await vault.connect(alice).unstake(500, 0);
    const s = await vault.stakers(alice.address);
    expect(s.level).to.equal(0);
    expect(s.nand).to.equal(500);
    await vault.poke(alice.address);
    expect((await vault.stakers(alice.address)).level).to.equal(1); // 500 -> size 1, age reset
    expect(await transistors.balanceOf(alice.address, 0)).to.equal(500);
  });

  it('unstake works even if the circuit call breaks', async function () {
    // Simulate a broken processor: wipe the circuits contract code on the fork.
    const addr = await circuits.getAddress();
    const code = await ethers.provider.getCode(addr);
    await network.provider.send('hardhat_setCode', [addr, '0x']);
    try {
      const [lvl, ok] = await vault.previewLevel(bob.address);
      expect(ok).to.equal(false);
      expect(lvl).to.equal(0);
      await vault.poke(bob.address); // must not revert either
      await vault.connect(bob).claim();
      await vault.connect(bob).unstake(100, 0);
      expect(await transistors.balanceOf(bob.address, 0)).to.equal(100);
    } finally {
      await network.provider.send('hardhat_setCode', [addr, code]);
    }
  });

  it('rejects transistors sent directly and non-owner policy changes', async function () {
    await mint(bob, 0, 1);
    await expect(
      transistors.connect(bob).safeTransferFrom(bob.address, await vault.getAddress(), 0, 1, '0x'),
    ).to.be.reverted;
    await expect(vault.connect(bob).proposeCircuit(circuitId)).to.be.revertedWithCustomError(vault, 'OwnableUnauthorizedAccount');
  });

  it('policy changes wait for the 2-day timelock and must match the 6-in/3-out shape', async function () {
    // Tape out TierLogic again as v2 and propose it.
    await mint(creator, 0, tier.nNand);
    const tfee = await circuits.TAPEOUT_FEE();
    const rc = await (await circuits.tapeout(tier.netlistHex, tier.N_IN, tier.N_OUT, { value: tfee })).wait();
    const v2 = rc.logs.map((l) => { try { return circuits.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'TapedOut').args.circuitId;

    // Bob's 1-in/1-out NOT gate (taped out earlier, id circuitId + 1) has the wrong shape.
    await expect(vault.proposeCircuit(circuitId + 1n)).to.be.revertedWithCustomError(vault, 'BadCircuit');
    await vault.proposeCircuit(v2);
    await expect(vault.activateCircuit()).to.be.revertedWithCustomError(vault, 'TimelockActive');
    await time.increase(2 * DAY + 1);
    await vault.activateCircuit();
    expect(await vault.circuitId()).to.equal(v2);
  });

  it('pauses emission while nobody is staked, so no funded OKB is lost', async function () {
    const Vault = await ethers.getContractFactory('CircuitVault');
    const empty = await Vault.deploy(await circuits.getAddress(), circuitId, XLAYER.ignix, OKB(1000), 7 * DAY, creator.address);
    await empty.connect(funder).fund({ value: OKB(1) });
    const finish0 = await empty.periodFinish();

    await time.increase(3 * DAY); // nobody staked for 3 days
    await mint(alice, 0, 100);
    await transistors.connect(alice).setApprovalForAll(await empty.getAddress(), true);
    await empty.connect(alice).stake(100, 0);
    expect(await empty.periodFinish()).to.be.closeTo(finish0 + BigInt(3 * DAY), 5n);

    await time.increase(11 * DAY); // past the (extended) end
    expect(await empty.earned(alice.address)).to.be.closeTo(OKB(1), OKB('0.000001'));
  });

  it('pays every funded wei even when the first stake comes after the original finish', async function () {
    // Reviewer case: fund 7 days of rewards, first stake on day 15.
    const Vault = await ethers.getContractFactory('CircuitVault');
    const late = await Vault.deploy(await circuits.getAddress(), circuitId, XLAYER.ignix, OKB(1000), 7 * DAY, creator.address);
    await late.connect(funder).fund({ value: OKB(1) });
    const funded = BigInt(await time.latest());

    await time.increase(15 * DAY);
    await mint(bob, 0, 100);
    await transistors.connect(bob).setApprovalForAll(await late.getAddress(), true);
    await late.connect(bob).stake(100, 0);
    const stakedAt = BigInt(await time.latest());
    expect(await late.periodFinish()).to.equal(funded + BigInt(7 * DAY) + (stakedAt - funded));
    expect(await late.periodFinish()).to.be.gt(stakedAt + BigInt(7 * DAY) - 10n);

    await time.increase(8 * DAY);
    expect(await late.earned(bob.address)).to.be.closeTo(OKB(1), OKB('0.000001'));
  });

  it('pays in full across several idle gaps, including one that outlasts the period', async function () {
    const Vault = await ethers.getContractFactory('CircuitVault');
    const v = await Vault.deploy(await circuits.getAddress(), circuitId, XLAYER.ignix, OKB(1000), 7 * DAY, creator.address);
    await mint(alice, 0, 200);
    await transistors.connect(alice).setApprovalForAll(await v.getAddress(), true);
    await v.connect(funder).fund({ value: OKB(1) });
    await time.increase(2 * DAY); // idle
    await v.connect(alice).stake(100, 0);
    await time.increase(2 * DAY); // staked
    await v.connect(alice).unstake(100, 0);
    await time.increase(20 * DAY); // idle far past the original finish
    await v.connect(alice).stake(100, 0);
    await time.increase(10 * DAY); // run out the rest
    await v.connect(alice).unstake(100, 0);
    await v.connect(alice).claim();
    expect(await ethers.provider.getBalance(await v.getAddress())).to.be.lt(OKB('0.000001'));
  });

  it('funding during an active period raises the rate instead of stretching it', async function () {
    await vault.connect(funder).fund({ value: OKB(1) });
    const finish = await vault.periodFinish();
    const rate = await vault.rewardRate();
    await vault.connect(funder).fund({ value: 1n });
    expect(await vault.periodFinish()).to.equal(finish);
    expect(await vault.rewardRate()).to.be.gte(rate);
  });
});
