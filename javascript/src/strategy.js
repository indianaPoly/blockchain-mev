/** @format */

import { ethers } from 'ethers';
import EventEmitter from 'events';
import dotenv from 'dotenv';

import { Bundler } from './bundler.js';
import { logger } from './constants.js';
import { processPoolsInParallel } from './multi.js';
import { generateTriangularPaths } from './paths.js';
import { loadAllPoolsFromV3 } from './pools.js';
import { streamNewBlocks } from './streams.js';
import { getTouchedPoolReserves } from './utils.js';

dotenv.config();
export const main = async () => {
    // 이더리움 메인넷에서 진행
    const HTTPSURL = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY1}`;
    const WSSURL = `wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY1}`;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const SIGNING_KEY = process.env.SIGNING_KEY;
    const BOT_ADDRESS = process.env.BOT_ADDRESS;

    const provider = new ethers.JsonRpcProvider(HTTPSURL);

    const factoryAddresses = ['0x1F98431c8aD98523631AE4a59f267346ea31F984'];
    const factoryBlocks = [12469621];

    //Uniswap V3 pool의 정보를 가져옵니다.
    let pools = await loadAllPoolsFromV3(HTTPSURL, factoryAddresses, factoryBlocks, 50000);
    logger.info(`Inital pool count: ${Object.keys(pools).length}`);

    // 시작하는 토큰의 주소를 정의합니다. (지금은 USDC로 시작을 하려고 합니다)
    const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const usdcDecimals = 6;

    let paths = generateTriangularPaths(pools, usdcAddress);

    pools = {};
    // path에 존재하는 pool에 대해서 필터링을 진행
    for (let path of paths) {
        pools[path.pool1.address] = path.pool1;
        pools[path.pool2.address] = path.pool2;
        pools[path.pool3.address] = path.pool3;
    }
    logger.info(`New pool count: ${Object.keys(pools).length}`);

    let s = new Date();
    // 경로에서 생성된 풀만 남기고 나머지를 제거, 그리고 초기 유동성 정보를 한번에 가져옴
    let reserves = await processPoolsInParallel(Object.keys(pools));
    let e = new Date();
    // 리저브 정보를 가져오는데 걸리는 시간을 측정함
    logger.info(`Batch reserve call took: ${(e - s) / 1000} seconds`);

    // pool에 대한 정보와 reserve에 대한 정보를 동시에 가지는 객체가 존재
    let poolANDreserve = {};
    Object.keys(pools).forEach((poolAddress) => {
        if (reserves[poolAddress]) {
            poolANDreserve[poolAddress] = {
                ...pools[poolAddress].toObject(),
                ...reserves[poolAddress],
            };
        }
    });

    let eventEmitter = new EventEmitter();

    // // 새로운 block에 대해서 모니터링을 함
    streamNewBlocks(WSSURL, eventEmitter);

    // let bundler = new Bundler(PRIVATE_KEY, SIGNING_KEY, HTTPSURL, BOT_ADDRESS);
    // await bundler.setup();
    console.log(poolANDreserve);

    eventEmitter.on('event', async (event) => {
        if (event.type === 'block') {
            let blockNumber = event.blockNumber;
            logger.info(`- New Block #${blockNumber}`);

            // 새로운 블럭이 생성될때마다 해당 블록에서 변경된 풀의 유동성 정보를 가져옴
            let touchedReserves = await getTouchedPoolReserves(provider, blockNumber);
            let touchedPools = [];
            for (let address in touchedReserves) {
                let touchedReserve = touchedReserves[address];
                // 해당 정보에 대해서 pool 및 address에 대한 정보가 있으면
                if (poolANDreserve[address]) {
                    poolANDreserve[address] = {
                        ...poolANDreserve[address],
                        ...touchedReserve,
                    };
                }

                touchedPools.push(address);
            }

            // 수익이 발생할 가능성이 있는 경로를 spreads에 기록
            let spreads = {};
            for (let idx = 0; idx < Object.keys(paths).length; idx++) {
                // path 중에서 이벤트가 발생한 풀이 있는지 확인함.
                let path = paths[idx];
                let touchedPath = touchedPools.reduce((touched, pool) => {
                    return touched + (path.hasPool(pool) ? 1 : 0);
                }, 0);

                // 이벤트가 발생한 풀이 1개라도 존재한다면 아래 함수를 실행
                if (touchedPath > 0) {
                    // 해당 로직에 대한 전략을 고안해야됩니다.
                    let priceQuote = path.simulateV3Path(1, poolANDreserve);
                    let spread = (priceQuote / 10 ** usdcDecimals - 1) * 100;
                    if (spread > 0) {
                        spreads[idx] = spread;
                    }
                }
            }

            console.log('Spread over 0%: ', spreads);
        } else if (event.type === 'uniswapV3Event') {
            console.log('Uniswap V3 Event: ', event.event);
        }
    });
};

main();
