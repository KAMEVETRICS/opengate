// Regressions for the review of 0b6fa97 (P2, P3). P1 is covered in vault.fork.test.js.
const { expect } = require('chai');
const path = require('path');
const { pathToFileURL } = require('url');
const { synthesize } = require('../copilot/synth.mjs');
const { truthTable } = require('../copilot/table.mjs');
const { validateSpec } = require('../copilot/spec.mjs');
const { parse } = require('../copilot/expr.mjs');
const { decode, simulate, fromHex } = require('../circuit/netlist.mjs');
const { verifyNetlist } = require('../copilot/verify.mjs');

const identity = (name) => ({ name: 'id', inputs: [{ name, bits: 1 }], outputs: [{ name: 'y', bits: 1, expr: name }] });

describe('Review regressions', function () {
  describe('[P2] reserved input names', function () {
    for (const name of ['__proto__', 'constructor', 'prototype', 'tostring', 'hasownproperty', '__definegetter__']) {
      const valid = /^[a-z_][a-z0-9_]*$/.test(name);
      it(`'${name}' never yields a wrong "verified" circuit`, function () {
        let r;
        try { r = synthesize(identity(name)); } catch (e) { expect(e.message).to.match(/reserved|must match/); return; }
        // If a name is accepted, the circuit must really be the identity.
        expect(valid).to.equal(true);
        expect(simulate(r.netlistHex, 1, 1, [0])).to.deep.equal([0]);
        expect(simulate(r.netlistHex, 1, 1, [1])).to.deep.equal([1]);
      });
    }

    it('__proto__, constructor and prototype are rejected with a clear message', function () {
      for (const n of ['__proto__', 'constructor', 'prototype']) {
        expect(() => validateSpec(identity(n))).to.throw(/reserved/);
      }
    });

    it('the truth table itself is correct for ordinary names (dictionaries have no prototype)', function () {
      const t = truthTable(identity('valueof_x'));
      expect([...t.rows[0], ...t.rows[1]]).to.deep.equal([0, 1]);
    });

    it('inherited names are not treated as functions', function () {
      for (const f of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
        expect(() => parse(`${f}(1)`)).to.throw(/unknown function/);
      }
    });
  });

  describe('[P3] truncated netlists', function () {
    let core;
    before(async function () {
      core = await import(pathToFileURL(path.join(__dirname, '..', 'web', 'core.js')).href);
    });

    // A NAND is 7 bytes (op + two 3-byte operands), a LATCH 4 bytes.
    const truncated = ['0x00', '0x0000', '0x000000', '0x00000002', '0x000000020000', '0x01', '0x010000', '0x00000002000002' + '00'];

    for (const hex of truncated) {
      it(`${hex} is rejected by both decoders and the verifier`, function () {
        expect(() => decode(hex, 1)).to.throw(/truncated/);
        expect(() => core.simulateAll(hex, 1, [1])).to.throw(/truncated/);
        const table = truthTable(identity('a'));
        expect(verifyNetlist(fromHex(hex), table).ok).to.equal(false);
      });
    }

    it('complete instructions still decode', function () {
      expect(decode('0x00000002000002', 1).elements).to.have.length(1); // NAND(a, a)
      expect(decode('0x01000002', 1).elements).to.have.length(1); // LATCH(a)
      expect(core.simulateAll('0x00000002000002', 1, [1]).elements).to.have.length(1);
    });
  });
});
