/** @format */

import { ethers } from 'ethers';
import EventEmitter from 'events';

import { Bundler } from './bundler.js';
import { logger } from './constants.js';
import { batchGetUniswapV3Reserves } from './multi.js';
import { generateTriangularPaths } from './paths.js';
import { loadAllPoolsFromV3 } from './pools.js';
import { streamNewBlocks, streamPendingTransactions } from './streams.js';
import { getTouchedPoolReserves } from './utils.js';

export const main = async () => {
    // 이더리움 메인넷에서 진행
    const HTTPSURL = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const WSSURL = `wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const SIGNING_KEY = process.env.SIGNING_KEY;
    const BOT_ADDRESS = process.env.BOT_ADDRESS;

    const provider = new ethers.JsonRpcProvider(HTTPSURL);

    const factoryAddresses = ['0x1F98431c8aD98523631AE4a59f267346ea31F984'];
    const factoryBlocks = [12469621];

    // Uniswap V3 pool의 정보를 가져옵니다.
    let pools = await loadAllPoolsFromV3(HTTPSURL, factoryAddresses, factoryBlocks, 50000);
    logger.info(`Inital pool count: ${Object.keys(pools).length}`);

    // 시작하는 토큰의 주소를 정의합니다. (지금은 USDC로 시작을 하려고 합니다)
    const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const usdcDecimals = 6;

    let paths = generateTriangularPaths(pools, usdcAddress);

    pools = {};
    for (let path of paths) {
        pools[path.pool1.address] = path.pool1;
        pools[path.pool2.address] = path.pool2;

        // pool3은 존재한다면 추가하고 존재하지 않으면 2개의 풀만을 이용
        if (path.pool3) {
            pools[path.pool3.address] = path.pool3;
        }
    }
    logger.info(`New pool count: ${Object.keys(pools).length}`);

    let s = new Date();
    // 경로에서 생성된 풀만 남기고 나머지를 제거, 그리고 초기 유동성 정보를 한번에 가져옴
    let reserves = await batchGetUniswapV3Reserves(HTTPSURL, Object.keys(pools));
    let e = new Date();
    logger.info(`Batch reserve call took: ${(e - s) / 1000} seconds`);

    let bundler = new Bundler(PRIVATE_KEY, SIGNING_KEY, HTTPSURL, BOT_ADDRESS);
    await bundler.setup();

    let eventEmitter = new EventEmitter();

    // 새로운 block과 Uniswap V3 이벤트를 모니터링함
    streamNewBlocks(WSSURL, eventEmitter);
    streamPendingTransactions(WSSURL, eventEmitter, Object.keys(pools));

    eventEmitter.on('event', async (event) => {
        if (event.type === 'block') {
            let blockNumber = event.blockNumber;
            logger.info(`- New Block #${blockNumber}`);

            // 새로운 블럭이 생성될때마다 해당 블록에서 변경된 풀의 유동성 정보를 가져옴
            let touchedReserves = await getTouchedPoolReserves(provider, blockNumber);
            let touchedPools = [];
            for (let address in touchedReserves) {
                let reserve = touchedReserves[address];
                if (address in reserves) {
                    reserves[address] = reserve;
                    touchedPools.push(address);
                }
            }

            // 수익이 발생할 가능성이 있는 경로를 spreads에 기록
            let spreads = {};
            for (let idx = 0; idx < Object.keys(paths).length; idx++) {
                let path = paths[idx];
                let touchedPath = touchedPools.reduce((touched, pool) => {
                    return touched + (path.hasPool(pool) ? 1 : 0);
                }, 0);

                // 시뮬레이션 진행
                if (touchedPath > 0) {
                    let priceQuote = path.simulateV3Path(1, reserves);
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
