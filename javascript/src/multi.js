/** @format */

import { ethers } from 'ethers';
import cliProgress from 'cli-progress';

import UNISWAP_V3_POOL_ABI from '../abi/UniswapV3Pool.json' assert { type: 'json' };

/**
 * ###풀의 유동성을 정보를 조회하는 함수
 * @param {string} httpsUrl 풀의 http url이 들어가야합니다.
 * @param {string[]} poolAddresses 배치에서의 풀 주소를 가져오는 것이므로 batchGetUniswapV3Reserves와 다름
 * @returns {}
 */
export const getUniswapV3Reserves = async (httpsUrl, poolAddresses) => {
    const provider = new ethers.JsonRpcProvider(httpsUrl);
    const reserves = {};

    for (const address of poolAddresses) {
        const poolContract = new ethers.Contract(address, UNISWAP_V3_POOL_ABI, provider);
        const [sqrtPriceX96, tick] = await poolContract.slot0(); // 현재 가격 정보가 있습니다.
        const liquidity = await poolContract.liquidity(); // 유동정 정보를 가져옴

        // 유동성을 객체에 저장
        reserves[address] = {
            sqrtPriceX96,
            liquidity,
            tick,
        };
    }

    // 객체 반환
    return reserves;
};

/**
 * ### Uniswap V3 풀의 유동성 정보를 대량으로 한 번에 처리하는 함수
 * @param {string} httpsUrl
 * @param {string[]} poolAddresses 풀의 모든 주소를 가져옴
 * @returns
 */
export const batchGetUniswapV3Reserves = async (httpsUrl, poolAddresses) => {
    // 한 번에 보낼 수 있는 요청 수에 한계가 있으므로, 요청 크기를 200으로 설정합니다.
    // 일반적으로 노드 서비스에서 7~10개의 배치당 1~2초가 소요됩니다. 

    let poolsCnt = poolAddresses.length; // 풀 주소의 총 개수를 가져
    let batch = Math.ceil(poolsCnt / 200); // 해당 코드는 한 번에 200개의 풀 정보를 조회할 수 있도록 설정함.
    let poolsPerBatch = Math.ceil(poolsCnt / batch); // 각 배치마다 처리할 풀의 개수를 의미

    const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progress.start(poolsCnt);

    let promises = [];
    for (let i = 0; i < batch; i++) {
        let startIdx = i * poolsPerBatch;
        let endIdx = Math.min(startIdx + poolsPerBatch, poolsCnt);
        // startIdx, endIdx를 통해서 풀 주소 배열의 일부만을 처리함.
        promises.push(await getUniswapV3Reserves(httpsUrl, poolAddresses.slice(startIdx, endIdx)));
        progress.update(i + 1);
    }
    progress.stop();

    // 모든 비동기 요청 처리가 마무리 될 때 까지 기다림
    const results = await Promise.all(promises);
    const reserves = Object.assign({}, ...results);
    return reserves;
};
