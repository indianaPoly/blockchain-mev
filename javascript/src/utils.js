/** @format */

import hre from 'hardhat';
import axios from 'axios';

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
    const swapEventSignature = hre.ethers.id('Swap(address,address,int256,int256,uint160,uint128,int24)');

    // 필터 객체 생성
    const filter = {
        fromBlock: blockNumber,
        toBlock: blockNumber,
        topics: [swapEventSignature],
    };

    const abi = [
        'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
    ];

    // Interface 객체 생성
    const iface = new hre.ethers.Interface(abi);

    let logs = await provider.getLogs(filter);
    let reserves = {};

    for (let log of logs) {
        let address = log.address;
        try {
            let parsedLog = iface.parseLog(log);

            reserves[address] = {
                sqrtPriceX96: parsedLog.args[4], // sqrtPriceX96
                liquidity: parsedLog.args[5], // liquidity
                tick: parsedLog.args[6],
            };
        } catch {
            continue;
        }
    }

    return reserves;
};
