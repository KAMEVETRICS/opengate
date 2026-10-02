// LLM layer with a fake client: no network, no API key, no cost.
const { expect } = require('chai');
const { promptToSpec, CopilotError, MODEL } = require('../copilot/llm.mjs');
const { design } = require('../copilot/index.mjs');

const GOOD = {
  name: 'comparator2',
  description: 'compare',
  inputs: [{ name: 'a', bits: 2 }, { name: 'b', bits: 2 }],
  outputs: [{ name: 'gt', bits: 1, expr: 'a > b' }],
};

// Replies are { parsed_output, stop_reason? }; records every request it receives.
function fakeClient(replies) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        parse: async (params) => {
          requests.push(JSON.parse(JSON.stringify(params, (k, v) => (k === 'format' ? '<format>' : v))));
          const r = replies.shift();
          if (!r) throw new Error('no more fake replies');
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], ...r };
        },
      },
    },
  };
}

describe('Copilot LLM layer (fake client)', function () {
  it('returns a valid spec and sends the expected request', async function () {
    const client = fakeClient([{ parsed_output: { unsupported_reason: null, spec: GOOD } }]);
    const spec = await promptToSpec('compare two 2-bit numbers', { client });
    expect(spec).to.deep.equal(GOOD);
    const req = client.requests[0];
    expect(req.model).to.equal(MODEL);
    expect(req.fallbacks).to.equal('default');
    expect(req.betas).to.include('server-side-fallback-2026-07-01');
    expect(req.output_config.effort).to.equal('high');
    expect(req.messages).to.have.length(1);
  });

  it('feeds validation errors back and retries', async function () {
    const bad = { ...GOOD, outputs: [{ name: 'gt', bits: 1, expr: 'a > zz' }] };
    const client = fakeClient([
      { parsed_output: { unsupported_reason: null, spec: bad } },
      { parsed_output: null }, // schema-invalid reply
      { parsed_output: { unsupported_reason: null, spec: GOOD } },
    ]);
    const spec = await promptToSpec('compare', { client });
    expect(spec.outputs[0].expr).to.equal('a > b');
    const third = client.requests[2].messages;
    expect(third).to.have.length(5); // user, assistant, user(error), assistant, user(error)
    expect(third[2].content).to.match(/unknown input 'zz'/);
    expect(third[4].content).to.match(/not valid JSON/);
  });

  it('gives up after 3 attempts with the last problem', async function () {
    const bad = { ...GOOD, name: 'Bad Name' };
    const client = fakeClient([1, 2, 3].map(() => ({ parsed_output: { unsupported_reason: null, spec: bad } })));
    let err;
    try { await promptToSpec('x', { client }); } catch (e) { err = e; }
    expect(err).to.be.instanceOf(CopilotError);
    expect(err.message).to.match(/after 3 attempts.*name must be/);
  });

  it('surfaces "unsupported" answers and refusals without retrying', async function () {
    const c1 = fakeClient([{ parsed_output: { unsupported_reason: 'counters need state', spec: null } }]);
    let err;
    try { await promptToSpec('a counter', { client: c1 }); } catch (e) { err = e; }
    expect(err.message).to.equal('counters need state');
    expect(c1.requests).to.have.length(1);

    const c2 = fakeClient([{ stop_reason: 'refusal', stop_details: { explanation: 'nope' }, parsed_output: null }]);
    try { await promptToSpec('x', { client: c2 }); } catch (e) { err = e; }
    expect(err.message).to.match(/declined.*nope/);
  });

  it('enforces the vault policy shape in policy mode', async function () {
    const client = fakeClient([
      { parsed_output: { unsupported_reason: null, spec: GOOD } }, // wrong shape for a policy
      {
        parsed_output: {
          unsupported_reason: null,
          spec: {
            name: 'p', description: 'd',
            inputs: [{ name: 'size', bits: 2 }, { name: 'age', bits: 2 }, { name: 'builder', bits: 1 }, { name: 'ignix', bits: 1 }],
            outputs: [{ name: 'level', bits: 3, expr: 'min(7, size + age)' }],
          },
        },
      },
    ]);
    const spec = await promptToSpec('tier is size plus age', { client, policy: true });
    expect(spec.name).to.equal('p');
    expect(client.requests[0].messages[0].content).to.match(/OpenGate vault reward policy/);
    expect(client.requests[1].messages[2].content).to.match(/vault policies need inputs exactly/);
  });

  it('design() goes from prompt to a verified netlist end to end', async function () {
    const client = fakeClient([{ parsed_output: { unsupported_reason: null, spec: GOOD } }]);
    const r = await design({ prompt: 'compare', llm: { client } });
    expect(r.verified).to.equal(true);
    expect(r.checkedInputs).to.equal(16);
    expect(r.cost.transistors).to.equal(r.nNand);
  });
});
