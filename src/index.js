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

// const farms = {
//   "0x478b8D37eE976228d17704d95B5430Cd93a31b87": "UBE-PREMIO",
//   "0xb450940c5297e9b5e7167FAC5903fD1e90b439b8": "CELO-MOBI",
//   "0x2Ca16986bEA18D562D26354b4Ff4C504F14fB01c": "mcUSD-mcEUR",
//   "0x4274AA72B12221D32ca77cB37057A9692E0b59Eb": "POOF-UBE",
//   "0x501ba7c59BA8afC1427F75D310A862BA0D2adcD2": "UBE-TFBX",
//   "0x194478Aa91e4D7762c3E51EeE57376ea9ac72761": "rCELO-CELO",
//   "0x161c77b4919271B7ED59AdB2151FdaDe3F907a1F": "CELO-mcUSD",
//   "0x728C650D1Fb4da2D18ccF4DF45Af70c5AEb09f81": "CELO-mcEUR",
//   "0xD6E28720Fcd1C1aB6da2d1043a6763FDBb67b3aA": "mcUSD-WETH",
//   "0x09c1cF8669f9A026c59EDd4792944a9aCd2d2a2E": "AAVE-mcUSD",
//   "0x3C29593674c5c760172d354acE88Da4D9d3EB64f": "FTM-mcUSD",
//   "0x750bB68Fa18F06d9696af85Ecc312f178E75fCfD": "AVAX-mcUSD",
//   "0xCD2d4024A42109593301fF11967c16eA180DD381": "mcUSD-BNB",
//   "0x00C4aCee9eB84B1a6Cdc741AeEd19BF84CbE7bF5": "WMATIC-mcUSD",
//   "0x83470506ba97dB33Df0EBe01E876C6718C762Df6": "SOL-CELO",
//   "0x295D6f96081fEB1569d9Ce005F7f2710042ec6a1": "UBE-CELO",
//   "0xE76525610652fFC3aF751Ab0dcC3448B345051F6": "MOO-mCELO",
//   "0x7B7F08164036abEbafD1bf75c1464c6F0d01653C": "POOF-pCELO",
//   "0x1f1678Cc7358F4ed808B53733Bc49c4CFFe8A075": "CELO-KNX",
//   "0x9D87c01672A7D02b2Dc0D0eB7A145C7e13793c3B": "UBE-CELO",
//   "0xf3D9E027B131Af5162451601038EddBF456d824B": "mcUSD-WBTC",
//   "0x0E83662A17B8A3a0585DcA34E5BE81ea6bd59556": "mcUSD-SUSHI",
//   "0x85B21208C0058019bc8004D85eFEa881E7598D17": "CRV-mcUSD",
//   "0xcca933D2ffEDCa69495435049a878C4DC34B079d": "CELO-mcUSD",
//   "0xaAA7bf214367572cadbF17f17d8E035742b55ab9": "mcUSD-mcEUR",
//   "0x32779E096bF913093933Ea94d31956AF8a763CE9": "CELO-mcEUR",
//   "0x19F1A692C77B481C23e9916E3E83Af919eD49765": "CELO-MOBI",
//   "0x666C59E75271f1fF5a52b58D4563afdc76a53b4e": "mcUSD-WETH",
//   "0xfd517545a5f1BD656b7Fda914a8402c44585fA66": "CELO-WBTC",
//   "0xF71A0723137Cd94c7FD5Ef573e16dFF0b8fc326B": "CELO-WETH",
//   "0xA6f2ea3008E6BA42B0D3c09159860De24591cd0E": "USDC-CELO",
//   "0x54097E406DFC00B9179167F9E20B26406Ad42f0F": "MOO-mCELO",
//   "0xC88B8d622c0322fb59ae4473D7A1798DE60785dD": "POOF-UBE",
//   "0x1eDAceC9A58501b819488d521521fc6aC5dfDBC1": "UBE-SBR",
//   "0x33cD870547DD6F30db86e7EE7707DC78e7825289": "SOL-CELO",
//   "0x0079418D54F887e7859c7A3Ecc16cE96A416527b": "mcUSD-WBTC",
//   "0x7313fDf9D8Cab87E54efc8905B9D7d4BA3Fe7c8D": "CELO-KNX",
//   "0xD7D6b5213b9B9DFffbb7ef008b3cF3c677eb2468": "rCELO-CELO",
//   "0xd60E0034D4B27DE226EFf13f68249F69d4D6Cb38": "POOF-pCELO",
//   "0xA2674f69B2BEf4ca3E75589aD4f4d36F061048a9": "mcUSD-SUSHI",
//   "0xA92Bb4D6399Be5403d6c8DF3cce4dd991ca8EaFc": "CRV-mcUSD",
//   "0xF20448aaF8CC60432FC2E774F9ED965D4bf77cDc": "AAVE-mcUSD",
//   "0x5704F21cF5C7e6556cBD1ceEbbD23752B68e4845": "FTM-mcUSD",
//   "0x9584870281DD0d764748a2a234e2218AE544C614": "AVAX-mcUSD",
//   "0x3DAc201Ec1b3a037bC9124906A2ae0A6a09ACC1d": "UBE-TFBX",
//   "0x80ED8Da2d3cd269B0ccbc6ddF8DA2807BF583307": "WMATIC-mcUSD",
//   "0x522be12487d0640337abCfC7201066eC8F787AC5": "mcUSD-BNB",
//   "0x9dBfe0aBf21F506525b5bAD0cc467f2FAeBe40a1": "UBE-cMCO2",
// };

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
  // for (const entry of Object.entries(farms)) {
  //   const [address, name] = entry;
  //   const hexName = ethers.utils.formatBytes32String(name);
  //   console.log(hexName, address);
  //   await farmRegistry.methods
  //     .addFarmInfo(hexName, address)
  //     .send({ from: WALLET, gasPrice: GAS_PRICE });
  // }

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
  }
};

const loop = async () => {
  try {
    await main();
  } catch (e) {
    console.error(e);
  }
  if (process.env.RUN_ONCE) {
    process.exit();
  }
  await new Promise((r) => setTimeout(r, LOOP_DELAY));
  await loop();
};

loop().catch(console.error);
