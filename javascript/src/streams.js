/** @format */

import { ethers } from 'ethers';
import { calculateNextBlockBaseFee, estimateNextBlockGas } from './utils.js';

export const streamNewBlocks = (wssUrl, eventEmitter) => {
    const wss = new ethers.WebSocketProvider(wssUrl);

    wss.on('block', async (blockNumber) => {
        let block = await wss.getBlock(blockNumber);
        let nextBaseFee = calculateNextBlockBaseFee(block);
        let estimateGas = await estimateNextBlockGas();

        eventEmitter.emit('event', {
            type: 'block',
            blockNumber: block.number,
            baseFee: BigInt(block.baseFeePerGas),
            nextBaseFee,
            ...estimateGas,
        });
    });

    return wss;
};

export const parseUniswapV3Event = (event) => {
    let parsedData;
    const abiCoder = new ethers.AbiCoder();
    if (event.topics[0] === ethers.id('Swap(address,address,int256,int256,uint160,uint128,int24)')) {
        parsedData = abiCoder.decode(
            ['address', 'address', 'int256', 'int256', 'uint160', 'uint128', 'int24'],
            event.data
        );
        return {
            eventType: 'Swap',
            sender: parsedData[0],
            recipient: parsedData[1],
            amount0: parsedData[2],
            amount1: parsedData[3],
            sqrtPriceX96: parsedData[4],
            liquidity: parsedData[5],
            tick: parsedData[6],
        };
    } else if (event.topics[0] === ethers.utils.id('Mint(address,address,int24,int24,uint128,uint256,uint256)')) {
        parsedData = abiCoder.decode(
            ['address', 'address', 'int24', 'int24', 'uint128', 'uint256', 'uint256'],
            event.data
        );
        return {
            eventType: 'Mint',
            owner: parsedData[0],
            tickLower: parsedData[2],
            tickUpper: parsedData[3],
            amount: parsedData[4],
            amount0: parsedData[5],
            amount1: parsedData[6],
        };
    } else if (event.topics[0] === ethers.utils.id('Burn(address,int24,int24,uint128,uint256,uint256)')) {
        parsedData = abiCoder.decode(['address', 'int24', 'int24', 'uint128', 'uint256', 'uint256'], event.data);
        return {
            eventType: 'Burn',
            tickLower: parsedData[1],
            tickUpper: parsedData[2],
            amount: parsedData[3],
            amount0: parsedData[4],
            amount1: parsedData[5],
        };
    }
};

export const streamPendingTransactions = (wssUrl, eventEmitter, poolAddress) => {
    const wss = new ethers.WebSocketProvider(wssUrl);

    const swapEventSignature = ethers.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
    const mintEventSignature = ethers.id('Mint(address,address,int24,int24,uint128,uint256,uint256)');
    const burnEventSignature = ethers.id('Burn(address,int24,int24,uint128,uint256,uint256)');

    const filter = {
        address: poolAddress,
        topics: [swapEventSignature, mintEventSignature, burnEventSignature],
    };

    wss.on(filter, async (event) => {
        const parsedEvent = parseUniswapV3Event(event);
        eventEmitter.emit('event', {
            type: 'uniswapV3Event',
            event: parsedEvent,
        });
    });
};
