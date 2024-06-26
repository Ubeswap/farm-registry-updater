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

const farmWhitelist = {
  '0x534408e91d755a0d898e1c508e987e8d0615b52c': true,
  '0x9584870281dd0d764748a2a234e2218ae544c614': true,
  '0xd94e14358f66a3c0d13ae76ec45fe1c92dd7fb23': true,
  '0xfaa5aff67582db0e9e581f52007c428ba71db405': true,
  '0x3c8e2eb988f0890b68b5667c2fb867249e68e3c7': true,
  '0xe4d9cab86f3419102984983e5a611442aaa3d864': true,
  '0x6f79b6b3c00d11dbd05475be1240ad8f2c20bcb6': true,
  '0xfeb0df4542e5394aac89383c135e2fc829812c6c': true,
  '0x04103efcec2d475b43964e0bf976c2a7e5eab2c0': true,
  '0x9caf0cd20c8ef7622eeb8db50e5bb4d407e38ae2': true,
  '0xf4f8a7d430aa5d3bac057610bcbfc18f68d0b66d': true,
  '0xbd61deb4459556d78b2133521af91a13eb21e20e': true,
  '0xbfa2748a60976cd18b835c75c6a20328e9a72684': true,
  '0x54097e406dfc00b9179167f9e20b26406ad42f0f': true,
  '0xf725d0ed5987bd9e7ef725491c584a84e4212708': true,
  '0xb5b6a87434f7a0ccc3dcc0de60d1ade3737ad263': true,
  '0x833febc01260d8f3dcc98393c216a025e90b405d': true,
  '0xed2ef7b098a0056f8fa73215f183ad908ac158f8': true,
  '0x033ae9200dbfc107e84d682f286f315f36ac452d': true,
  '0xda7f463c27ec862cfbf2369f3f74c364d050d93f': true,
  '0x295d6f96081feb1569d9ce005f7f2710042ec6a1': true,
}

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
    tokens(first: 500, subgraphError: allow) {
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
    "https://gateway-arbitrum.network.thegraph.com/api/3f1b45f0fd92b4f414a3158b0381f482/subgraphs/id/JWDRLCwj4H945xEkbB6eocBSZcYnibqcJPJ8h9davFi",
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

  /*const receipt = await farmRegistry.methods
    .addFarmInfo(
      '0x5542452d43454c4f000000000000000000000000000000000000000000000000',
      '0x534408e91d755a0d898e1c508e987e8d0615b52c',
    )
    .send({
      from: WALLET,
      chainId: CHAIN_ID,
      gasPrice,
    });
    console.log(`UBE-CELO added: https://explorer.celo.org/tx/${receipt.transactionHash}`);*/

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

      if (numRewardFarms > 0 || farmWhitelist[currentFarmAddr.toLowerCase()]) {
        console.log(farmAddress, tvlUSD.toString(), rewardsUSDPerYear.toString())
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
