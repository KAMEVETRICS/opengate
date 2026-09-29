require('@nomicfoundation/hardhat-toolbox');

const XLAYER_RPC = process.env.XLAYER_RPC || 'https://rpc.xlayer.tech';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    hardhat: {
      chainId: 196,
      forking: process.env.FORK ? { url: XLAYER_RPC } : undefined,
      chains: {
        196: {
          hardforkHistory: { berlin: 0, london: 0, merge: 0, shanghai: 0, cancun: 0 },
        },
      },
    },
    xlayer: {
      url: XLAYER_RPC,
      chainId: 196,
      // Deployments are signed in the browser wallet (see web/), never with a key here.
      accounts: [],
    },
  },
  mocha: { timeout: 300_000 },
};
