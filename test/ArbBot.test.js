/** @format */

import hre from 'hardhat';

describe('arbBot contract depoly and test', async () => {
  // Mock Token address or mainCurrency address
  const mainCurrency = "";
  let Arbot, arbBot;
  let owner;

  beforeEach(async () => {
    [owner] = await hre.ethers.getSigners();


    Arbot = hre.ethers.getContractFactory('ArbBot');

    // 배포시에 owner address와 체인의 메인 토큰의 address가 들어감
    arbBot = await Arbot.deploy(owner.address, mainCurrency);
    await arbBot.waitForDeployment();

    console.log("sucessful initialize!");
  });

  // 테스트를 진행할 케이스
  it("recoverToken", async () => {});
  it("approveRouter", async () => {});
  it("flashswap", async () => {});
  it("fallback", async () => {});
}) 