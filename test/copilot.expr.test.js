const { expect } = require('chai');
const { parse, annotate, evaluate, identifiers, ExprError } = require('../copilot/expr.mjs');
const { validateSpec, layout, SpecError } = require('../copilot/spec.mjs');

const run = (src, env = {}, widths = Object.fromEntries(Object.keys(env).map((k) => [k, 4]))) => {
  const ast = parse(src);
  annotate(ast, widths);
  return evaluate(ast, env);
};

describe('Copilot expression language', function () {
  const cases = [
    ['1 + 2 * 3', {}, 7],
    ['(1 + 2) * 3', {}, 9],
    ['a - b', { a: 3, b: 5 }, 0], // saturating
    ['a - b', { a: 5, b: 3 }, 2],
    ['-a', { a: 3 }, 0],
    ['0x0f & 0b0110', {}, 6],
    ['a | b', { a: 9, b: 6 }, 15],
    ['a ^ b', { a: 12, b: 10 }, 6],
    ['~a', { a: 5 }, 10], // within a's 4 bits
    ['!a', { a: 0 }, 1],
    ['!a', { a: 4 }, 0],
    ['a << 2', { a: 3 }, 12],
    ['a >> 1', { a: 13 }, 6],
    ['a == b', { a: 4, b: 4 }, 1],
    ['a != b', { a: 4, b: 4 }, 0],
    ['a < b', { a: 2, b: 3 }, 1],
    ['a <= b', { a: 3, b: 3 }, 1],
    ['a > b', { a: 3, b: 3 }, 0],
    ['a >= b', { a: 3, b: 2 }, 1],
    ['a && b', { a: 2, b: 0 }, 0],
    ['a || b', { a: 0, b: 7 }, 1],
    ['a ? 10 : 20', { a: 1 }, 10],
    ['a ? 10 : 20', { a: 0 }, 20],
    ['a > 1 ? b : c', { a: 2, b: 5, c: 6 }, 5],
    ['min(a, b, 9)', { a: 12, b: 11 }, 9],
    ['max(a, b)', { a: 2, b: 11 }, 11],
    ['bit(a, 2)', { a: 4 }, 1],
    ['popcount(a)', { a: 11 }, 3],
    ['abs(a)', { a: 7 }, 7],
    ['1 + 2 == 3 && 4 > 3', {}, 1], // comparison binds tighter than &&, + tighter than ==
    ['a & 1 == 1', { a: 3 }, 1], // C-like: == binds tighter than &
  ];
  for (const [src, env, want] of cases) {
    it(`${src} with ${JSON.stringify(env)} = ${want}`, function () {
      expect(run(src, env)).to.equal(want);
    });
  }

  it('reports unknown identifiers with a position', function () {
    expect(() => run('a + zz', { a: 1 })).to.throw(ExprError, /unknown input 'zz'.*position 4/);
  });

  it('rejects unknown functions, bad syntax and chained comparisons', function () {
    expect(() => parse('foo(1)')).to.throw(/unknown function 'foo'/);
    expect(() => parse('1 +')).to.throw(/unexpected end/);
    expect(() => parse('(1 + 2')).to.throw(/expected '\)'/);
    expect(() => parse('1 < 2 < 3')).to.throw(/chained comparisons/);
    expect(() => parse('a $ b')).to.throw(/unexpected character/);
    expect(() => parse('min()')).to.throw(/argument/);
  });

  it('requires constant shift amounts and bit indexes', function () {
    expect(() => run('a << b', { a: 1, b: 1 })).to.throw(/variable shift/);
    expect(() => run('bit(a, b)', { a: 1, b: 1 })).to.throw(/constant/);
  });

  it('never executes code: JS syntax is rejected, not evaluated', function () {
    for (const src of ['process.exit()', 'a; 1', "require('fs')", 'this', '`x`', 'a.constructor']) {
      expect(() => run(src, { a: 1 })).to.throw();
    }
  });

  it('collects identifiers', function () {
    expect([...identifiers(parse('min(a, b + c) ? a : 2'))].sort()).to.deep.equal(['a', 'b', 'c']);
  });
});

describe('Copilot spec validation', function () {
  const base = () => ({ name: 'x', inputs: [{ name: 'a', bits: 2 }], outputs: [{ name: 'y', bits: 2, expr: 'a' }] });

  it('accepts a valid spec and computes the bit layout', function () {
    const spec = { name: 't', inputs: [{ name: 'size', bits: 2 }, { name: 'builder', bits: 1 }], outputs: [{ name: 'y', bits: 3, expr: 'size + builder' }] };
    const r = validateSpec(spec);
    expect([r.nIn, r.nOut]).to.deep.equal([3, 3]);
    expect(layout(spec).inputs.map((p) => p.offset)).to.deep.equal([0, 2]);
  });

  it('rejects bad names, widths, duplicates and oversize inputs', function () {
    expect(() => validateSpec({ ...base(), name: 'Bad Name' })).to.throw(SpecError);
    expect(() => validateSpec({ ...base(), inputs: [{ name: 'a', bits: 0 }] })).to.throw(/bits/);
    expect(() => validateSpec({ ...base(), outputs: [{ name: 'a', bits: 1, expr: 'a' }] })).to.throw(/duplicate/);
    expect(() => validateSpec({ ...base(), inputs: [{ name: 'a', bits: 16 }, { name: 'b', bits: 1 }] })).to.throw(/17 input bits/);
    expect(() => validateSpec({ ...base(), outputs: [{ name: 'y', bits: 1 }] })).to.throw(/expr/);
    expect(() => validateSpec({ ...base(), outputs: [{ name: 'y', bits: 1, expr: 'q' }] })).to.throw(/unknown input 'q'/);
  });

  it('enforces the vault policy shape in policy mode', function () {
    const P = [{ name: 'size', bits: 2 }, { name: 'age', bits: 2 }, { name: 'builder', bits: 1 }, { name: 'ignix', bits: 1 }];
    expect(() => validateSpec({ name: 'p', inputs: P, outputs: [{ name: 'l', bits: 3, expr: 'size' }] }, { policy: true })).to.not.throw();
    expect(() => validateSpec({ name: 'p', inputs: P, outputs: [{ name: 'l', bits: 2, expr: 'size' }] }, { policy: true })).to.throw(/3 output bits/);
    expect(() => validateSpec({ name: 'p', inputs: P.slice().reverse(), outputs: [{ name: 'l', bits: 3, expr: 'size' }] }, { policy: true })).to.throw(/inputs exactly/);
  });
});
