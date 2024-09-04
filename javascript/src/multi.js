/** @format */

import { fork } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

const createChildProcess = (addresses, httpsUrl, prefix) => {
  return new Promise((resolve, reject) => {
    const child = fork('javascript/src/child.js');
    let results = {};

    child.on('message', (msg) => {
      // 메시지 구조를 출력하여 확인
      console.log('Received message from child:', msg);

      if (msg === 'ready') {
        child.send({ httpsUrl, poolAddresses: addresses, prefix });
      } else {
        console.log('Received data from child:', msg.data);

        const formattedReserves = Object.fromEntries(
          Object.entries(msg.data).map(([key, value]) => [
            key,
            {
              sqrtPriceX96: BigInt(value.sqrtPriceX96),
              liquidity: BigInt(value.liquidity),
              tick: BigInt(value.tick),
            },
          ]),
        );
        results = { ...formattedReserves };
      }
    });

    child.on('exit', () => {
      resolve(results);
    });

    child.on('error', (error) => {
      reject(error);
    });

    // 자식 프로세스를 시작할 때 'start' 메시지 전송
    child.send('start');
  });
};

export const processPoolsInParallel = async (poolAddresses) => {
  const batchSize = Math.ceil(poolAddresses.length / 4);
  const batches = [
    poolAddresses.slice(0, batchSize),
    poolAddresses.slice(batchSize, 2 * batchSize),
    poolAddresses.slice(2 * batchSize, 3 * batchSize),
    poolAddresses.slice(3 * batchSize),
  ];

  const urls = [
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY1}`,
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY2}`,
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY3}`,
    `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
  ];

  try {
    const [
      firstBatchResult,
      secondBatchResult,
      thirdBatchResult,
      fourthBatchResult,
    ] = await Promise.all(
      batches.map((batch, index) =>
        createChildProcess(batch, urls[index], `PREFIX${index + 1}`),
      ),
    );

    return {
      ...firstBatchResult,
      ...secondBatchResult,
      ...thirdBatchResult,
      ...fourthBatchResult,
    };
  } catch (error) {
    console.error('Error during processing:', error);
    throw error;
  }
};
