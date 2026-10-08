// Expression language for circuit specs: a small recursive-descent parser and
// evaluator. Never uses eval/Function, because expressions may come from an LLM.
//
// Values are non-negative integers. "-" saturates at 0. Comparisons and
// logical operators return 0/1. Outputs are masked to their bit width by the caller.

export const FUNCTIONS = { min: [1, Infinity], max: [1, Infinity], bit: [2, 2], popcount: [1, 1], abs: [1, 1] };

const PUNCT = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '*', '&', '|', '^', '~', '!', '<', '>', '(', ')', ',', '?', ':'];

export class ExprError extends Error {
  constructor(message, pos) {
    super(pos == null ? message : `${message} (at position ${pos})`);
    this.pos = pos;
  }
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const start = i;
    if (/[0-9]/.test(c)) {
      let m;
      const rest = src.slice(i);
      if ((m = /^0x[0-9a-fA-F]+/.exec(rest))) { tokens.push({ t: 'num', v: parseInt(m[0].slice(2), 16), pos: start }); i += m[0].length; }
      else if ((m = /^0b[01]+/.exec(rest))) { tokens.push({ t: 'num', v: parseInt(m[0].slice(2), 2), pos: start }); i += m[0].length; }
      else { m = /^[0-9]+/.exec(rest); tokens.push({ t: 'num', v: parseInt(m[0], 10), pos: start }); i += m[0].length; }
      if (/[A-Za-z_0-9]/.test(src[i] || '')) throw new ExprError('malformed number', start);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      tokens.push({ t: 'id', v: m[0], pos: start });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((op) => src.startsWith(op, i));
    if (!p) throw new ExprError(`unexpected character '${c}'`, i);
    tokens.push({ t: 'op', v: p, pos: start });
    i += p.length;
  }
  tokens.push({ t: 'eof', pos: src.length });
  return tokens;
}

// Binary precedence levels, lowest first.
const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!=', '<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*']];
const NON_ASSOC = new Set(['==', '!=', '<', '<=', '>', '>=']);

export function parse(src) {
  if (typeof src !== 'string' || !src.trim()) throw new ExprError('empty expression');
  if (src.length > 500) throw new ExprError('expression longer than 500 characters');
  const tokens = tokenize(src);
  let k = 0;
  const peek = () => tokens[k];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new ExprError(`expected '${v}'`, peek().pos);
    return tokens[k++];
  };

  function ternary() {
    const cond = binary(0);
    if (!isOp('?')) return cond;
    const pos = tokens[k++].pos;
    const a = ternary();
    expect(':');
    const b = ternary();
    return { type: 'cond', cond, a, b, pos };
  }

  function binary(level) {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (peek().t === 'op' && LEVELS[level].includes(peek().v)) {
      const { v: op, pos } = tokens[k++];
      const right = binary(level + 1);
      left = { type: 'bin', op, a: left, b: right, pos };
      if (NON_ASSOC.has(op) && peek().t === 'op' && LEVELS[level].includes(peek().v)) {
        throw new ExprError('chained comparisons are ambiguous; add parentheses', peek().pos);
      }
    }
    return left;
  }

  function unary() {
    if (peek().t === 'op' && ['!', '~', '-'].includes(peek().v)) {
      const { v: op, pos } = tokens[k++];
      return { type: 'un', op, a: unary(), pos };
    }
    return primary();
  }

  function primary() {
    const tok = peek();
    if (tok.t === 'num') { k++; return { type: 'num', v: tok.v, pos: tok.pos }; }
    if (tok.t === 'id') {
      k++;
      if (isOp('(')) {
        k++;
        if (!Object.hasOwn(FUNCTIONS, tok.v)) throw new ExprError(`unknown function '${tok.v}'`, tok.pos);
        const args = [];
        if (!isOp(')')) {
          args.push(ternary());
          while (isOp(',')) { k++; args.push(ternary()); }
        }
        expect(')');
        const [lo, hi] = FUNCTIONS[tok.v];
        if (args.length < lo || args.length > hi) throw new ExprError(`${tok.v}() takes ${lo === hi ? lo : `${lo}+`} argument(s)`, tok.pos);
        return { type: 'call', fn: tok.v, args, pos: tok.pos };
      }
      return { type: 'id', name: tok.v, pos: tok.pos };
    }
    if (isOp('(')) {
      k++;
      const e = ternary();
      expect(')');
      return e;
    }
    throw new ExprError(tok.t === 'eof' ? 'unexpected end of expression' : `unexpected '${tok.v}'`, tok.pos);
  }

  const ast = ternary();
  if (peek().t !== 'eof') throw new ExprError(`unexpected '${peek().v}'`, peek().pos);
  return ast;
}

export function identifiers(ast, out = new Set()) {
  if (ast.type === 'id') out.add(ast.name);
  for (const child of [ast.a, ast.b, ast.cond, ...(ast.args || [])]) if (child) identifiers(child, out);
  return out;
}

// Constant arguments required by the hardware compiler (shift amounts, bit indexes).
export function isConstant(ast) {
  return ast.type === 'num' || (ast.type !== 'id' && [ast.a, ast.b, ast.cond, ...(ast.args || [])].filter(Boolean).every(isConstant));
}

const popcount = (x) => { let c = 0; while (x) { c += x % 2; x = Math.floor(x / 2); } return c; };
const bitLength = (v) => Math.max(1, Math.ceil(Math.log2(v + 1)));
const constValue = (ast) => evaluate(ast, {});
export const MAX_WIDTH = 48; // keeps every intermediate value an exact JS number

// Annotate every node with its static bit width (n.w) and validate it against the
// declared inputs. The evaluator and the hardware compiler both rely on these
// widths, so `~x` means "invert the bits x actually has" in both.
export function annotate(ast, inputWidths) {
  const w = (n) => annotate(n, inputWidths);
  let width;
  switch (ast.type) {
    case 'num': width = bitLength(ast.v); break;
    case 'id':
      if (!(ast.name in inputWidths)) throw new ExprError(`unknown input '${ast.name}'`, ast.pos);
      width = inputWidths[ast.name];
      break;
    case 'un': {
      const a = w(ast.a);
      width = ast.op === '~' ? a : 1;
      break;
    }
    case 'cond': w(ast.cond); width = Math.max(w(ast.a), w(ast.b)); break;
    case 'call': {
      const ws = ast.args.map(w);
      if (ast.fn === 'min') width = Math.min(...ws);
      else if (ast.fn === 'max') width = Math.max(...ws);
      else if (ast.fn === 'bit') {
        if (!isConstant(ast.args[1])) throw new ExprError('bit(x, i) needs a constant i', ast.pos);
        width = 1;
      } else if (ast.fn === 'popcount') width = bitLength(ws[0]);
      else width = ws[0];
      break;
    }
    case 'bin': {
      const a = w(ast.a);
      const b = w(ast.b);
      switch (ast.op) {
        case '+': width = Math.max(a, b) + 1; break;
        case '-': width = a; break;
        case '*': width = a + b; break;
        case '<<':
        case '>>': {
          if (!isConstant(ast.b)) throw new ExprError(`variable shift amounts are not supported`, ast.pos);
          const s = constValue(ast.b);
          if (s > MAX_WIDTH) throw new ExprError('shift amount too large', ast.pos);
          width = ast.op === '<<' ? a + s : Math.max(1, a - s);
          break;
        }
        case '&': width = Math.min(a, b); break;
        case '|':
        case '^': width = Math.max(a, b); break;
        default: width = 1; // comparisons and logical operators
      }
      break;
    }
    default: throw new ExprError(`bad node ${ast.type}`);
  }
  if (width > MAX_WIDTH) throw new ExprError(`intermediate value wider than ${MAX_WIDTH} bits`, ast.pos);
  ast.w = width;
  return width;
}

// Evaluate an annotated AST. Constant sub-expressions may be evaluated before
// annotation (env = {}), where '~' is never needed.
export function evaluate(ast, env) {
  const ev = (n) => evaluate(n, env);
  switch (ast.type) {
    case 'num': return ast.v;
    case 'id':
      if (!(ast.name in env)) throw new ExprError(`unknown input '${ast.name}'`, ast.pos);
      return env[ast.name];
    case 'un': {
      const a = ev(ast.a);
      if (ast.op === '!') return a === 0 ? 1 : 0;
      if (ast.op === '-') return 0; // saturating: -a for a >= 0 is 0
      if (ast.w == null) throw new ExprError("'~' needs a known width (annotate first)", ast.pos);
      return 2 ** ast.w - 1 - a; // invert within the operand's own width
    }
    case 'cond': return ev(ast.cond) !== 0 ? ev(ast.a) : ev(ast.b);
    case 'call': {
      const args = ast.args.map(ev);
      if (ast.fn === 'min') return Math.min(...args);
      if (ast.fn === 'max') return Math.max(...args);
      if (ast.fn === 'bit') return Math.floor(args[0] / 2 ** args[1]) % 2;
      if (ast.fn === 'popcount') return popcount(args[0]);
      return args[0]; // abs of a non-negative value
    }
    case 'bin': {
      const a = ev(ast.a);
      const b = ev(ast.b);
      switch (ast.op) {
        case '+': return a + b;
        case '-': return Math.max(0, a - b);
        case '*': return a * b;
        case '<<': return a * 2 ** b;
        case '>>': return Math.floor(a / 2 ** b);
        case '&': return Number(BigInt(a) & BigInt(b));
        case '|': return Number(BigInt(a) | BigInt(b));
        case '^': return Number(BigInt(a) ^ BigInt(b));
        // (bitwise ops via BigInt: JS number bitwise ops truncate to 32 bits)
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '&&': return a !== 0 && b !== 0 ? 1 : 0;
        case '||': return a !== 0 || b !== 0 ? 1 : 0;
      }
    }
  }
  throw new ExprError(`bad node ${ast.type}`);
}
