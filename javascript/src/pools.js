/** @format */

// Uniswap V3 팩토리에서 생성된 모든 풀을 로드하고, 이를 캐싱한 이후에 빠르게 접근하도록 함.

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cliProgress from 'cli-progress';

import { logger } from './constants.js';

const Erc20Abi = ['function decimals() external view returns (uint8)'];

const V3FactoryAbi = [
    'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, address pool)',
];

const DexVariant = {
    UniswapV2: 2,
    UniswapV3: 3,
};

class Pool {
    constructor(address, version, token0, token1, decimals0, decimals1, fee) {
        this.address = address;
        this.version = version;
        this.token0 = token0;
        this.token1 = token1;
        this.decimals0 = decimals0;
        this.decimals1 = decimals1;
        this.fee = fee;
    }

    cacheRow() {
        return [this.address, this.version, this.token0, this.token1, this.decimals0, this.decimals1, this.fee];
    }
}

const range = (start, stop, step) => {
    let loopCnt = Math.ceil((stop - start) / step);
    let rangeArray = [];
    for (let i = 0; i < loopCnt; i++) {
        let fromBlock = start + i * step;
        let toBlock = Math.min(fromBlock + step, stop);
        rangeArray.push([fromBlock, toBlock]);
    }
    return rangeArray;
};

const loadCachedPools = () => {
    const __filename = fileURLToPath(import.meta.url);

    let cacheFile = path.join(path.dirname(__filename), '..', '.cached-pools.csv');
    let pools = {};
    if (fs.existsSync(cacheFile)) {
        const content = fs.readFileSync(cacheFile, 'utf-8');
        const rows = content.split('\n');
        for (let row of rows) {
            if (row === '') continue;
            row = row.split(',');
            if (row[0] === 'address') continue;
            let version = row[1] === '2' ? DexVariant.UniswapV2 : DexVariant.UniswapV3;
            let pool = new Pool(row[0], version, row[2], row[3], parseInt(row[4]), parseInt(row[5]), parseInt(row[6]));
            pools[row[0]] = pool;
        }
    }
    return pools;
};

const cacheSyncedPools = (pools) => {
    const __filename = fileURLToPath(import.meta.url);

    const columns = ['address', 'version', 'token0', 'token1', 'decimals0', 'decimals1', 'fee'];

    let data = columns.join(',') + '\n';
    for (let address in pools) {
        let pool = pools[address];
        let row = pool.cacheRow().join(',') + '\n';
        data += row;
    }
    let cacheFile = path.join(path.dirname(__filename), '..', '.cached-pools.csv');
    fs.writeFileSync(cacheFile, data, { encoding: 'utf-8' });
};

/**
 * V3 팩토리에서 풀을 조회하여 반환함.
 * @param {string} httpsUrl PRC 노드에 연결하기 위한 URL
 * @param {string[]} factoryAddresses V3 팩토리 주소 목록
 * @param {number} fromBlocks 조회를 시작할 블록 번호를 지정한 배열
 * @param {number} chunk 블록 범위를 나누는 크기 (ex. 10,000 블록 단위로 나누어 처리)
 * @returns
 */
export const loadAllPoolsFromV3 = async (httpsUrl, factoryAddresses, fromBlocks, chunk) => {
    let pools = loadCachedPools(); // 캐싱된 pool 데이터 정보를 로드

    // 만약 pool이 존재한다면 pool을 반환하고 아래 작업을 진행하지 않음
    if (Object.keys(pools).length > 0) {
        return pools;
    }

    // 이더리움 네트워크와 연결
    const provider = new ethers.JsonRpcProvider(httpsUrl);
    // 현재 블럭을 가져옴
    const toBlock = await provider.getBlockNumber();

    const decimals = {};
    pools = {};

    for (let i = 0; i < factoryAddresses.length; i++) {
        const factoryAddress = factoryAddresses[i];
        const fromBlock = fromBlocks[i];

        const v3Factory = new ethers.Contract(factoryAddress, V3FactoryAbi, provider);

        // fromBlock ~ toBlock 까지의 범위를 chunk 만큼 나눈 배열을 생성
        const requestParams = range(fromBlock, toBlock, chunk);

        // 잔행상황을 표현하는 progress bar 추가
        const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progress.start(requestParams.length);

        // 배열을 순회하며 블록 범위별로 이벤트를 조회
        for (let j = 0; j < requestParams.length; j++) {
            const params = requestParams[j];
            const filter = v3Factory.filters.PoolCreated(); // PoolCreated에 대한 이벤트에 대한 필터를 생성
            const events = await v3Factory.queryFilter(filter, params[0], params[1]); // 지정된 블럭 범위 내 이벤트를 조회
            // 이벤트를 순회하며
            for (let event of events) {
                // 각각의 값들을 순회함
                let token0 = event.args[0];
                let token1 = event.args[1];
                let fee = event.args[2];

                let decimals0;
                let decimals1;

                try {
                    if (token0 in decimals) {
                        decimals0 = decimals[token0];
                    } else {
                        let token0Contract = new ethers.Contract(token0, Erc20Abi, provider);
                        decimals0 = await token0Contract.decimals();
                        decimals[token0] = decimals0;
                    }

                    if (token1 in decimals) {
                        decimals1 = decimals[token1];
                    } else {
                        let token1Contract = new ethers.Contract(token1, Erc20Abi, provider);
                        decimals1 = await token1Contract.decimals();
                        decimals[token1] = decimals1;
                    }
                } catch (_) {
                    logger.warn(`Check if tokens: ${token0} / ${token1} still exist`);
                    continue;
                }

                // 풀 정보를 기반으로 하여 새로운 객체를 생성합니다.
                let pool = new Pool(
                    event.args[3], // pool address
                    DexVariant.UniswapV3,
                    token0,
                    token1,
                    decimals0,
                    decimals1,
                    fee
                );
                pools[event.args[3]] = pool;
            }

            progress.update(j + 1);
        }

        progress.stop();
    }

    // 수집된 정보를 캐싱하는 작업을 진행함.
    cacheSyncedPools(pools);
    return pools;
};
