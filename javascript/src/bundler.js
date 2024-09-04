/** @format */

import { ethers, Wallet } from 'ethers';
import { FlashbotsBundleProvider } from '@flashbots/ethers-provider-bundle';
import { v4 as uuidv4 } from 'uuid';

import { PRIVATE_RELAY } from './constants.js';
import BOT_ABI from '../abi/ArbBot.json' assert { type: 'json' };

export class Path {
  constructor(router, tokenIn, tokenOut) {
    this.router = router;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
  }

  toList() {
    return [this.router, this.tokenIn, this.tokenOut];
  }
}

export const FalshLoan = {
  notUsed: 0,
  Balancer: 1,
  UniswapV3: 2,
};

/**
 * ### 돈을 보내거나, 플래시론 사용, 트랜젝션 관리에 필요한 기능 제공
 */
export class Bundler {
  constructor(privateKey, sigingKey, httpsUrl, botAddress) {
    this.provider = new ethers.JsonRpcProvider(httpsUrl);
    this.sender = new Wallet(privateKey, this.provider);
    this.signer = new Wallet(sigingKey, this.provider);
    this.bot = new ethers.Contract(botAddress, BOT_ABI, this.provider);

    async () => await this.setup();
  }

  // 블록체인 네트워크 및 플래시 봇 서비스와 연결
  setup = async () => {
    this.chainId = (await this.provider.getNetwork()).chainId;
    this.flashbots = await FlashbotsBundleProvider.create(
      this.provider,
      this.signer,
      PRIVATE_RELAY,
    );
  };

  // 트랜젝션을 번들로 만듦
  // 번들은 여러 개의 트랜젝션을 묶어서 동시에 처리
  toBundle = async (transaction) => {
    return [
      {
        signer: this.sender,
        transaction,
      },
    ];
  };

  // 번들을 블록체인에 보냄 및 특정 블록에 포함
  sendBundle = async (bundle, blockNumber) => {
    const replacementUuid = uuidv4();
    const signedBundle = await this.flashbots.signBundle(bundle);
    const targetBlock = blockNumber + 1;
    const simulation = await this.flashbots.simulate(signedBundle, blockNumber);

    if ('error' in simulation) {
      console.warn(`Simulation Error: ${simulation.error.message}`);
      return '';
    } else {
      console.log(`Simulation Success: ${JSON.stringify(simulation, null, 2)}`);
    }

    const bundleSubmission = await this.flashbots.sendRawBundle(
      signedBundle,
      targetBlock,
      { replacementUuid },
    );

    if ('error' in bundleSubmission) {
      throw new Error(bundleSubmission.error.message);
    }

    return [replacementUuid, bundleSubmission];
  };

  // 번들을 취소할 때 사용
  cancelBundle = async (replacementUuid) => {
    return await this.flashbots.cancelBundles(replacementUuid);
  };

  // 번들이 성공할 때 까지 기다림
  waitBundle = async (bundleSubmission) => {
    return await bundleSubmission.wait();
  };

  // 개별 트랜젝션을 보내고 트랜젝션에 대한 해쉬 값을 받음
  sendTx = async (transaction) => {
    const tx = await this.sender.sendTransaction(transaction);
    return tx.hash;
  };

  // 트렌젝션을 만들 때 필요한 정보들을 가져오는 메서드
  _common_fields = async () => {
    let nonce = await this.provider.getTransactionCount(this.sender.address);
    return {
      type: 2,
      chainId: this.chainId,
      nonce,
      from: this.sender.address,
    };
  };

  // 특정 토큰을 컨트랙트에 보내는 트랙젝션을 만듦
  transferInTx = async (amountIn, maxPriorityFeePerGas, maxFeePerGas) => {
    return {
      ...(await this._common_fields()),
      to: this.bot.address,
      value: amountIn, // BigInt 처리는 ethers v6에서 자동으로 됩니다.
      gasLimit: 60000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  };

  // 토큰 인출
  transferOutTx = async (token, maxPriorityFeePerGas, maxFeePerGas) => {
    let calldata = this.bot.interface.encodeFunctionData('recoverToken', [
      token,
    ]);
    return {
      ...(await this._common_fields()),
      to: this.bot.address,
      data: calldata,
      value: 0n,
      gasLimit: 50000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  };

  // router와 token들을 승인하는 트랜젝션 -> 승인하지 않으면 컨트랙트가 토큰을 사용할 수 없음
  approveTx = async (
    router,
    tokens,
    force,
    maxPriorityFeePerGas,
    maxFeePerGas,
  ) => {
    let calldata = this.bot.interface.encodeFunctionData('approveRouter', [
      router,
      tokens,
      force,
    ]);
    return {
      ...(await this._common_fields()),
      to: this.bot.address,
      data: calldata,
      value: 0n,
      gasLimit: BigInt(55000) * BigInt(tokens.length),
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  };

  orderTx = async (
    paths, // array of Path class
    amountIn,
    flashloan, // Flashloan object
    loanFrom, // vault address
    maxPriorityFeePerGas,
    maxFeePerGas,
  ) => {
    let nhop = paths.length;

    let calldataTypes = ['uint256', 'uint256', 'address'];
    let calldataRaw = [BigInt(amountIn), flashloan, loanFrom];

    for (let i = 0; i < nhop; i++) {
      calldataTypes = calldataTypes.concat(['address', 'address', 'address']);
      calldataRaw = calldataRaw.concat(paths[i].toList());
    }

    let abiCoder = new ethers.AbiCoder(); // ethers v6에서 AbiCoder 사용
    let calldata = abiCoder.encode(calldataTypes, calldataRaw);

    return {
      ...(await this._common_fields()),
      to: this.bot.address,
      data: calldata,
      value: 0n,
      gasLimit: 600000n,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };
  };
}
