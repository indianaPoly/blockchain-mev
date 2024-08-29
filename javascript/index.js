/** @format */

import { getTouchedPoolReserves } from './src/utils.js';
import { streamNewBlocks } from './src/streams.js';
import { ethers } from 'ethers';
import EventEmitter from 'events';
import dotenv from 'dotenv';

dotenv.config();
const main = async () => {
    const WSSURL = `wss://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY1}`;
    const provider = new ethers.WebSocketProvider(WSSURL);
    let eventEmitter = new EventEmitter();

    // // 새로운 block에 대해서 모니터링을 함
    streamNewBlocks(WSSURL, eventEmitter);

    // 가만히 놔두면 알아서 실행이 됨
    eventEmitter.on('event', async (event) => {
        if (event.type === 'block') {
            let blockNumber = event.blockNumber;
            console.log(`- New Block #${blockNumber}`);

            // 새로운 블럭이 생성될때마다 해당 블록에서 변경된 풀의 유동성 정보를 가져옴
            let touchedReserves = await getTouchedPoolReserves(provider, blockNumber);

            for (let address in touchedReserves) {
                console.log(address);
            }
        }
    });
};

main();
