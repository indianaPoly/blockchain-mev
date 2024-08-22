/** @format */

import { ethers } from 'hardhat';

export const calculateNextBlockBaseFee = (block) => {
    let baseFee = BigInt(block.baseFeePerGas);
    let gasUsed = BigInt(block.gasUsed);
    let gasLimit = BigInt(block.gasLimit);

    let targetGasUsed = gasLimit / BigInt(2);
    targetGasUsed = targetGasUsed == BigInt(0) ? BigInt(1) : targetGasUsed;

    let newBaseFee;

    if (gasUsed > targetGasUsed) {
        newBaseFee = baseFee + (baseFee * (gasUsed - targetGasUsed)) / targetGasUsed / BigInt(8);
    } else {
        newBaseFee = baseFee - (baseFee * (targetGasUsed - gasUsed)) / targetGasUsed / BigInt(8);
    }

    const rand = BigInt(Math.floor(Math.random() * 10));
    return newBaseFee + rand;
};

export const estimateNextBlockGas = async () => {
    let estimate = {};
    const CHAIN_ID = 1; // 1은 이더리움 메인넷.

    // 체인 아이디는 1 ~ 137 사이에 있어야 합니다.
    if (![1, 137].includes(parseInt(CHAIN_ID))) return estimate;

    const url = `https://api.blocknative.com/gasprices/blockprices?chainid=${CHAIN_ID}`;
    const response = await axios.get(url);

    if (response.data) {
        let gwei = 10 ** 9;
        let res = response.data;
        let estimatedPrice = res.blockPrices[0].estimatedPrices[0];
        estimate['maxPriorityFeePerGas'] = BigInt(parseInt(estimatedPrice['maxPriorityFeePerGas'] * gwei));
        estimate['maxFeePerGas'] = BigInt(parseInt(estimatedPrice['maxFeePerGas'] * gwei));
    }
    return estimate;
};

export const getTouchedPoolReserves = async (provider, blockNumber) => {
    const swapEventSignature = ethers.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
    const filter = {
        fromBlock: blockNumber,
        toBlock: blockNumber,
        topics: [swapEventSignature],
    };

    let abiCoder = new ethers.AbiCoder();
    let logs = await provider.getLogs(filter);
    let reserves = {};

    for (let log of logs) {
        let address = log.address;
        let parsedData = abiCoder.decode(
            ['address', 'address', 'int256', 'int256', 'uint160', 'uint128', 'int24'],
            log.data
        );
        reserves[address] = {
            sqrtPriceX96: parsedData[4],
            liquidity: parsedData[5],
            fee: null, // 수수료 정보는 별도로 유지해야 함
        };
    }

    return reserves;
};
