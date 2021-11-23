require("dotenv").config();

const { newKit } = require("@celo/contractkit");
const { toWei, toBN } = require("web3-utils");
const { request, gql } = require("graphql-request");
const { ethers } = require("ethers");

const farmRegistryAbi = require("../abis/FarmRegistry.json");
const pairAbi = require("../abis/UniswapPair.json");
const msrAbi = require("../abis/MSR.json");
const erc20Abi = require("../abis/IERC20.json");

const FARM_REGISTRY_ADDRESS = "0xa2bf67e12EeEDA23C7cA1e5a34ae2441a17789Ec";
const SECONDS_PER_YEAR = 60 * 60 * 24 * 7 * 52;
const GAS_PRICE = toWei("0.2", "gwei");

const kit = newKit("https://forno.celo.org");
kit.addAccount(process.env.PRIVATE_KEY);
const farmRegistry = new kit.web3.eth.Contract(
  farmRegistryAbi,
  FARM_REGISTRY_ADDRESS
);

const WALLET = kit.web3.eth.accounts.privateKeyToAccount(
  process.env.PRIVATE_KEY
).address;

const LOOP_DELAY = 15 * 60 * 1000; // Every 15 minutes
const query = gql`
  {
    tokens(first: 200, subgraphError: allow) {
      id
      symbol
      name
      decimals
      derivedCUSD
    }
  }
`;

// @amount - in wei
// @decimals - in number
// @priceUSD - in number
// returns usdValue in number
const usdValue = (amount, decimals, priceUSD) => {
  return Number(amount.div(toBN(10).pow(toBN(decimals))).toString()) * priceUSD;
};
const main = async () => {
  const farms = (
    await farmRegistry.getPastEvents("FarmInfo", {
      fromBlock: 9700000,
      toBlock: "latest",
    })
  ).map((e) => [
    ethers.utils.parseBytes32String(e.returnValues.farmName),
    e.returnValues.stakingAddress,
  ]);

  const { tokens } = await request(
    "https://api.thegraph.com/subgraphs/name/ubeswap/ubeswap",
    query
  ).catch((e) => {
    return e.response.data;
  });
  const tokenToInfo = tokens.reduce((acc, token) => {
    acc[token.id] = token;
    return acc;
  }, {});

  for (const [farmName, farmAddress] of farms) {
    try {
      console.log(`Fetching ${farmName} @${farmAddress}`);
      const farm = new kit.web3.eth.Contract(msrAbi, farmAddress);

      // Get TVL
      let currentFarm = farm;
      let rewardsUSDPerYear = 0;
      let tvlUSD = 0;
      while (true) {
        // Get yearly rewards
        const rewardToken = await currentFarm.methods.rewardsToken().call();
        const tokenInfo = tokenToInfo[rewardToken.toLowerCase()];

        const rewardRate = toBN(await currentFarm.methods.rewardRate().call());
        const yearlyRewardRate = rewardRate.mul(toBN(SECONDS_PER_YEAR));
        rewardsUSDPerYear += usdValue(
          yearlyRewardRate,
          tokenInfo.decimals,
          tokenInfo.derivedCUSD
        );

        const lpToken = new kit.web3.eth.Contract(
          pairAbi,
          await currentFarm.methods.stakingToken().call()
        );
        const pairToken0 = new kit.web3.eth.Contract(
          erc20Abi,
          await lpToken.methods.token0().call()
        );
        const pairToken0Info =
          tokenToInfo[pairToken0.options.address.toLowerCase()];
        const pairToken1 = new kit.web3.eth.Contract(
          erc20Abi,
          await lpToken.methods.token1().call()
        );
        const pairToken1Info =
          tokenToInfo[pairToken1.options.address.toLowerCase()];

        const lpStaked = toBN(
          await lpToken.methods.balanceOf(currentFarm.options.address).call()
        );
        const lpTotalSupply = toBN(await lpToken.methods.totalSupply().call());
        const token0Price =
          pairToken0.options.address.toLowerCase() ===
            "0x0a60c25Ef6021fC3B479914E6bcA7C03c18A97f1".toLowerCase()
            ? 1
            : pairToken0Info.derivedCUSD;
        const token0StakedUSD = usdValue(
          toBN(await pairToken0.methods.balanceOf(lpToken.options.address).call())
            .mul(lpStaked)
            .div(lpTotalSupply),
          pairToken0Info.decimals,
          token0Price
        );
        const token1StakedUSD = usdValue(
          toBN(await pairToken1.methods.balanceOf(lpToken.options.address).call())
            .mul(lpStaked)
            .div(lpTotalSupply),
          pairToken1Info.decimals,
          pairToken1Info.derivedCUSD
        );
        tvlUSD += token0StakedUSD + token1StakedUSD;

        try {
          currentFarm = new kit.web3.eth.Contract(
            msrAbi,
            await currentFarm.methods.externalStakingRewards().call()
          );
        } catch (e) {
          break;
        }
      }

      await farmRegistry.methods
        .updateFarmData(
          farmAddress,
          toWei(tvlUSD.toString()),
          toWei(rewardsUSDPerYear.toString())
        )
        .send({ from: WALLET, gasPrice: GAS_PRICE });
    } catch (e) {
      console.warn(`Failed to update farm ${farmName}`)
    }
  }
};

const loop = async () => {
  try {
    await main();
  } catch (e) {
    console.error(e);
    process.exit(1)
  }
  if (process.env.RUN_ONCE) {
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, LOOP_DELAY));
  await loop();
};

loop().catch(console.error);
