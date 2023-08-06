require("dotenv").config();

const { newKit } = require("@celo/contractkit");
const { toWei, toBN, toHex, toChecksumAddress } = require("web3-utils");
const { request, gql } = require("graphql-request");
const { ethers } = require("ethers");

const farmRegistryAbi = require("../abis/FarmRegistry.json");
const pairAbi = require("../abis/UniswapPair.json");
const msrAbi = require("../abis/MSR.json");
const erc20Abi = require("../abis/IERC20.json");
const multicallAbi = require("../abis/Multicall.json");
const {
  CACHED_FARM_INFO_BLOCK,
  cachedFarmInfoEvents,
} = require("./cachedFarms");

const FARM_REGISTRY_ADDRESS = "0xa2bf67e12EeEDA23C7cA1e5a34ae2441a17789Ec";
const STABIL_USD_ADDRESS = "0x0a60c25Ef6021fC3B479914E6bcA7C03c18A97f1";
const sIMMO_ADDRESS = "0xF71c475F566273CC549f597872c6432642D96deF";
const IMMO_ADDRESS = "0xE685d21b7B0FC7A248a6A8E03b8Db22d013Aa2eE";
const SECONDS_PER_DAY = 60 * 60 * 24;
const SECONDS_PER_YEAR = SECONDS_PER_DAY * 7 * 52;
const CHAIN_ID = toHex(42220);

const substitutions = {
  [sIMMO_ADDRESS]: IMMO_ADDRESS,
};

const kit = newKit("https://forno.celo.org");
kit.addAccount(process.env.PRIVATE_KEY);
const farmRegistry = new kit.web3.eth.Contract(
  farmRegistryAbi,
  FARM_REGISTRY_ADDRESS
);
const multicall = new kit.web3.eth.Contract(
  multicallAbi,
  "0x75f59534dd892c1f8a7b172d639fa854d529ada3"
);
const farmInterface = new kit.web3.eth.Contract(msrAbi);
const pairInterface = new kit.web3.eth.Contract(pairAbi);
const erc20Interface = new kit.web3.eth.Contract(erc20Abi);

const WALLET = kit.web3.eth.accounts.privateKeyToAccount(
  process.env.PRIVATE_KEY
).address;

const LOOP_DELAY = 15 * 60 * 1000; // Every 15 minutes
const query = gql`
  {
    tokens(first: 300, subgraphError: allow) {
      id
      symbol
      name
      decimals
      derivedCUSD
    }
  }
`;

const substituteToken = (token) => {
  const substitution = substitutions[toChecksumAddress(token)];
  if (substitution) return substitution;
  return toChecksumAddress(token);
};

// @amount - in wei
// @decimals - in number
// @priceUSD - in number
// returns usdValue in number
const usdValue = (amount, decimals, priceUSD) => {
  return Number(amount.div(toBN(10).pow(toBN(decimals))).toString()) * priceUSD;
};
const main = async () => {
  // const farms = (
  //   await farmRegistry.getPastEvents("FarmInfo", {
  //     fromBlock: CACHED_FARM_INFO_BLOCK,
  //     toBlock: "latest",
  //   })
  // )
  const farms = cachedFarmInfoEvents
    .map((e) => [
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
    const tokenAddr = toChecksumAddress(token.id);
    acc[tokenAddr] = token;
    return acc;
  }, {});

  const oldestFarmTime = Date.now() / 1000 - SECONDS_PER_DAY;
  const gasPrice = await kit.web3.eth.getGasPrice();
  for (const [farmName, farmAddress] of farms) {
    try {
      console.log(`\nFetching ${farmName} @${farmAddress}`);

      // Get TVL
      let currentFarmAddr = farmAddress;
      let rewardsUSDPerYear = 0;
      let tvlUSD = 0;
      let numRewardFarms = 0;
      while (true) {
        // Get yearly rewards
        const { rewardToken, stakingToken, rewardRate, periodFinish } =
          await farmInfo(currentFarmAddr);
        if (periodFinish > oldestFarmTime) {
          numRewardFarms++;
        }
        const tokenInfo = tokenToInfo[substituteToken(rewardToken)];
        if (!tokenInfo) {
          console.error(`No token info for ${rewardToken}`);
          break;
        }
        const yearlyRewardRate = rewardRate.mul(toBN(SECONDS_PER_YEAR));
        rewardsUSDPerYear += usdValue(
          yearlyRewardRate,
          tokenInfo.decimals,
          tokenInfo.derivedCUSD
        );

        const {
          token0,
          token1,
          totalSupply: lpTotalSupply,
        } = await lpInfo(stakingToken);
        const pairToken0Info = tokenToInfo[token0];
        const pairToken1Info = tokenToInfo[token1];

        const [token0Staked, token1Staked, lpStaked] = await multiBalanceOf(
          [token0, token1, stakingToken],
          [stakingToken, stakingToken, currentFarmAddr]
        );

        const token0Price =
          token0 === STABIL_USD_ADDRESS ? 1 : pairToken0Info.derivedCUSD;
        const token0StakedUSD = usdValue(
          token0Staked.mul(lpStaked).div(lpTotalSupply),
          pairToken0Info.decimals,
          token0Price
        );
        const token1Price =
          token1 === STABIL_USD_ADDRESS ? 1 : pairToken1Info.derivedCUSD;
        const token1StakedUSD = usdValue(
          token1Staked.mul(lpStaked).div(lpTotalSupply),
          pairToken1Info.decimals,
          token1Price
        );
        tvlUSD += token0StakedUSD + token1StakedUSD;

        try {
          const nextFarmAddr = await new kit.web3.eth.Contract(
            msrAbi,
            currentFarmAddr
          ).methods
            .externalStakingRewards()
            .call();
          currentFarmAddr = nextFarmAddr;
        } catch (e) {
          break;
        }
      }

      if (numRewardFarms > 0) {
        const receipt = await farmRegistry.methods
          .updateFarmData(
            farmAddress,
            toWei(tvlUSD.toString()),
            toWei(rewardsUSDPerYear.toString())
          )
          .send({
            from: WALLET,
            chainId: CHAIN_ID,
            gasPrice,
          });
        console.log(
          `Updated ${farmName} @${farmAddress}: https://explorer.celo.org/tx/${receipt.transactionHash}`
        );
      } else {
        console.log(
          `Skipping ${farmName} @${farmAddress} because there are no reward farms`
        );
      }
    } catch (e) {
      console.warn(`Failed to update farm ${farmName}`, e);
    }
  }
};

const farmInfo = async (farmAddr) => {
  return await multicall.methods
    .aggregate([
      [farmAddr, farmInterface.methods.rewardsToken().encodeABI()],
      [farmAddr, farmInterface.methods.stakingToken().encodeABI()],
      [farmAddr, farmInterface.methods.rewardRate().encodeABI()],
      [farmAddr, farmInterface.methods.periodFinish().encodeABI()],
    ])
    .call()
    .then(({ returnData }) => {
      const rewardToken = kit.web3.eth.abi.decodeParameters(
        ["address"],
        returnData[0]
      )[0];
      const stakingToken = kit.web3.eth.abi.decodeParameters(
        ["address"],
        returnData[1]
      )[0];
      const rewardRate = toBN(
        kit.web3.eth.abi.decodeParameters(["uint256"], returnData[2])[0]
      );
      const periodFinish = Number(
        kit.web3.eth.abi.decodeParameters(["uint256"], returnData[3])[0]
      );
      return { rewardToken, stakingToken, rewardRate, periodFinish };
    });
};

const lpInfo = async (pairAddr) => {
  return await multicall.methods
    .aggregate([
      [pairAddr, pairInterface.methods.token0().encodeABI()],
      [pairAddr, pairInterface.methods.token1().encodeABI()],
      [pairAddr, pairInterface.methods.totalSupply().encodeABI()],
    ])
    .call()
    .then(({ returnData }) => {
      const token0 = kit.web3.eth.abi.decodeParameters(
        ["address"],
        returnData[0]
      )[0];
      const token1 = kit.web3.eth.abi.decodeParameters(
        ["address"],
        returnData[1]
      )[0];
      const totalSupply = toBN(
        kit.web3.eth.abi.decodeParameters(["uint256"], returnData[2])[0]
      );
      return { token0, token1, totalSupply };
    });
};

const multiBalanceOf = async (tokenAddrs, ofs) => {
  return await multicall.methods
    .aggregate(
      tokenAddrs.map((tokenAddr, i) => [
        tokenAddr,
        erc20Interface.methods.balanceOf(ofs[i]).encodeABI(),
      ])
    )
    .call()
    .then(({ returnData }) =>
      returnData.map((data) =>
        toBN(kit.web3.eth.abi.decodeParameters(["uint256"], data)[0])
      )
    );
};

const loop = async () => {
  try {
    await main();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  if (process.env.RUN_ONCE) {
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, LOOP_DELAY));
  await loop();
};

loop().catch(console.error);
