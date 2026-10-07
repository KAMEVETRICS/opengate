// OpenGate deployment on X Layer. Fill these in after running the Setup tab once
// (it prints the exact values). Until then the app reads them from the URL
// (?circuits=…&vault=…&circuitId=…) or from this browser's saved setup.
export const DEPLOYED = {
  circuits: '0x12FA3aF78B22E9AC3f0afc5D2bf907601a1cA725', // OpenGate processor (TapeOut circuits contract)
  transistors: '0xA0f693b8a30d415091cCcAbD085D4bDE4A3F5966', // OpenGate transistors (ERC-1155)
  circuitId: '1', // TierLogic v1 circuit id
  vault: '0x51297E8e617E8Dc70491358f450C0a532024733d', // CircuitVault
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
