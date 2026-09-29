// Addresses and ABIs of the live TapeOut protocol on X Layer (chain 196),
// read from tapeout.net's bundle and verified on-chain on 2026-09-28.

const XLAYER = {
  chainId: 196,
  rpc: 'https://rpc.xlayer.tech',
  explorer: 'https://www.oklink.com/xlayer',
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  ignix: '0x0c9535416fd3b772646c4575e0664fd65afeeeee',
  // Fees seen on-chain (wei). Always re-read before sending.
  deployFee: 6_600_000_000_000_000n, // 0.0066 OKB per createCPU
  protocolFee: 660_000_000_000_000n, // 0.00066 OKB per mint tx
  tapeoutFee: 1_300_000_000_000_000n, // 0.0013 OKB per tapeout
};

const FACTORY_ABI = [
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address transistors, address circuits)',
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function isCPU(address) view returns (bool)',
  'event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)',
];

const CIRCUITS_ABI = [
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function TAPEOUT_FEE() view returns (uint256)',
  'function eval(uint256, bytes) view returns (bytes)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256) view returns (bytes)',
  'function nextId() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function transistors() view returns (address)',
  'function creator() view returns (address)',
  'event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)',
];

const TRANSISTORS_ABI = [
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function supplyCap() view returns (uint256)',
  'function minted() view returns (uint256)',
  'function balanceOf(address a, uint256 id) view returns (uint256)',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
  'function owed(address a) view returns (uint256)',
  'function withdraw()',
];

module.exports = { XLAYER, FACTORY_ABI, CIRCUITS_ABI, TRANSISTORS_ABI };
