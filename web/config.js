// OpenGate deployment on X Layer. Fill these in after running the Setup tab once
// (it prints the exact values). Until then the app reads them from the URL
// (?circuits=…&vault=…&circuitId=…) or from this browser's saved setup.
export const DEPLOYED = {
  circuits: '', // OpenGate processor (TapeOut circuits contract)
  transistors: '', // OpenGate transistors (ERC-1155)
  circuitId: '', // TierLogic v1 circuit id
  vault: '', // CircuitVault
};

export const PROCESSOR = {
  name: 'OpenGate',
  symbol: 'GATE',
  story: 'Stake transistors, earn OKB: reward tiers are decided by a NAND circuit taped out on X Layer.',
  supply: 10_000_000,
  priceOkb: '0.0001',
};

export const VAULT = {
  ignixThreshold: '100000', // IGNIX (18 decimals)
  rewardsDurationDays: 7,
};
