const abi = require('./abi')
const { getChainTransform } = require('../helper/portedTokens')
const { sumTokens } = require('../helper/unwrapLPs')
const sdk = require('@defillama/sdk')

function tarotHelper(exportsObj, config) {
Object.keys(config).forEach(chain => {
  let tvlPromise
  const balances = {}
  const borrowedBalances = {}

  async function _getTvl(block) {
    const { factories } = config[chain]
    const transform = await getChainTransform(chain)
    const collaterals = []
    const borrowables = []
    await Promise.all(factories.map(async (factory) => {
      const { output: allLendingPoolsLength } = await sdk.api.abi.call({
        target: factory,
        abi: abi.allLendingPoolsLength,
        chain, block,
      })

      const poolCalls = []
      for (let i = 0; i < +allLendingPoolsLength; i++)  poolCalls.push({ params: i })
      const { output: allLendingPools } = await sdk.api.abi.multiCall({
        target: factory,
        abi: abi.allLendingPools,
        calls: poolCalls,
        chain, block,
      })

      const calls2 = allLendingPools.map(i => ({ params: i.output }))

      const { output: getLendingPool } = await sdk.api.abi.multiCall({
        target: factory,
        abi: abi.getLendingPool,
        calls: calls2,
        chain, block,
      })

      getLendingPool.forEach(i => {
        collaterals.push(i.output.collateral)
        borrowables.push(i.output.borrowable0, i.output.borrowable1)
      })
    }))

    const underlyingCalls = [...collaterals, ...borrowables].map(i => ({ target: i }))
    const { output: toaInput } = await sdk.api.abi.multiCall({
      abi: abi.underlying,
      calls: underlyingCalls,
      chain, block,
    })

    const underlyingMapping = {}

    const toa = toaInput.map(i => [i.output, i.input.target])
    toaInput.forEach(i => underlyingMapping[i.input.target] = i.output)
    const { output: borrowed } = await sdk.api.abi.multiCall({
      abi: abi.totalBorrows,
      calls: borrowables.map(i => ({ target: i })),
      chain, block,
    })

    borrowed.forEach(i => {
      sdk.util.sumSingleBalance(borrowedBalances, transform(underlyingMapping[i.input.target]), i.output)
    })

    await sumTokens(balances, toa, block, chain, transform, {
      resolveLP: true, blacklistedLPs: [
        '0xa5c76fe460128936229f80f651b1deafa37583ae', // evolve in cronos
        // '0x1f2bff0e37c592c7de6393c9dd3c0f7933408228', // disabled because _getReserves has a different abi compared to others
        '0x357c1b507ef563d342afecd01001f1c0b525e25b', // disabled Error: Returned error: execution reverted: VaultToken: INSUFFICIENT_RESERVES
        // '0x526b38991627c509a570ac18a46f7ac7aabc7e4a', // disabled Error: Returned error: execution reverted: VaultToken: INSUFFICIENT_RESERVES
        '0x8706dc2067d64651620d66052bc065da1c81327f', // disabled Error: Returned error: execution reverted: VaultToken: INSUFFICIENT_RESERVES
        '0x1c669f6caaf59dbfe86e9d8b9fb694d4d06611d5', // disabled Error: Returned error: execution reverted: VaultToken: INSUFFICIENT_RESERVES
        '0x6cce00972bff06ec4fed6602bd22f65214e14d1f', // Not a smart contract
        // '0x9bf544e9e96033d1c8b667824844a40aa6c2132a', //
        '0x7eac79383c42bc16e33cd100008ee6d5e491680f', //
        '0x05b2bcb2295a6f07c5d490128b6b4787c8c4464e', //
        '0xd8d4a4738e285c33a2890fb2e225c692b84c55ca', //
      ]
    })
    return { balances, borrowedBalances }
  }

  async function getTvl(block) {
    if (!tvlPromise) tvlPromise = _getTvl(block)
    return tvlPromise
  }

  exportsObj[chain] = {
    tvl: async (_, _b, { [chain]: block }) => (await getTvl(block)).balances,
    borrowed: async (_, _b, { [chain]: block }) => (await getTvl(block)).borrowedBalances,
  }
})
}

module.exports = {
  tarotHelper
}