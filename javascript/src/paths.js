/** @format */
import { ethers } from 'ethers';
import cliProgress from 'cli-progress';

import { logger } from './constants.js';
import { Path } from './bundler.js';
import { UniswapV3Simulator } from './simulators.js';

const range = (start, stop, step) => {
    let loopCnt = Math.ceil((stop - start) / step);
    let rangeArray = [];
    for (let i = 0; i < loopCnt; i++) {
        let num = start + i * step;
        rangeArray.push(num);
    }
    return rangeArray;
};

export class ArbPath {
    // 풀 주소 들어감
    // 각 풀에서 교환 방향을 나타냄
    constructor(pool1, pool2, pool3, zeroForOne1, zeroForOne2, zeroForOne3) {
        this.pool1 = pool1;
        this.pool2 = pool2;
        this.pool3 = pool3;
        this.zeroForOne1 = zeroForOne1;
        this.zeroForOne2 = zeroForOne2;
        this.zeroForOne3 = zeroForOne3;
    }

    // pool3이 있으면 3 없으면 2
    nhop() {
        return this.pool3 ? 3 : 2;
    }

    hasPool(pool) {
        let isPool1 = this.pool1.address.toLowerCase() === pool.toLowerCase();
        let isPool2 = this.pool2.address.toLowerCase() == pool.toLowerCase();
        let isPool3 = this.pool3.address.toLowerCase() == pool.toLowerCase();
        return isPool1 || isPool2 || isPool3;
    }

    simulateV3Path = (amountIn, reserves) => {
        let tokenInDecimals = this.zeroForOne1 ? this.pool1.decimals0 : this.pool1.decimals1;
        let amountOut = ethers.parseUnits(amountIn.toString(), tokenInDecimals);

        let sim = new UniswapV3Simulator();
        let nhop = this.nhop();

        for (let i = 0; i < nhop; i++) {
            let pool = this[`pool${i + 1}`];
            let zeroForOne = this[`zeroForOne${i + 1}`];

            let { sqrtPriceX96, liquidity, fee } = reserves[pool.address];
            amountOut = sim.getAmountOut(amountOut, sqrtPriceX96, liquidity, fee);
        }

        return amountOut;
    };

    optimizeAmountIn = (maxAmountIn, stepSize, reserves) => {
        let tokenInDecimals = this.zeroForOne1 ? this.pool1.decimals0 : this.pool1.decimals1;

        let optimizedIn = 0;
        let profit = 0;

        for (let amountIn of range(0, maxAmountIn, stepSize)) {
            let amountOut = this.simulateV3Path(amountIn, reserves);
            let thisProfit = amountOut - amountIn * 10 ** tokenInDecimals;
            if (thisProfit >= profit) {
                optimizedIn = amountIn;
                profit = thisProfit;
            } else {
                break;
            }
        }

        return [optimizedIn, profit / 10 ** tokenInDecimals];
    };

    toPathParams = (routers) => {
        let pathParams = [];

        for (let i = 0; i < this.nhop(); i++) {
            let pool = this[`pool${i + 1}`];
            let zeroForOne = this[`zeroForOne${i + 1}`];
            let tokenIn = zeroForOne ? pool.token0 : pool.token1;
            let tokenOut = zeroForOne ? pool.token1 : pool.token0;
            let path = new Path(routers[i], tokenIn, tokenOut);
            pathParams.push(path);
        }

        return pathParams;
    };
}

export const generateTriangularPaths = (pools, tokenIn) => {
    const paths = [];

    pools = Object.values(pools);

    const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progress.start(pools.length);

    for (let i = 0; i < pools.length; i++) {
        let pool1 = pools[i];
        let canTrade1 = pool1.token0 == tokenIn || pool1.token1 == tokenIn;

        if (canTrade1) {
            let zeroForOne1 = pool1.token0 == tokenIn;
            let [tokenIn1, tokenOut1] = zeroForOne1 ? [pool1.token0, pool1.token1] : [pool1.token1, pool1.token0];

            if (tokenIn1 != tokenIn) {
                continue;
            }

            for (let j = 0; j < pools.length; j++) {
                let pool2 = pools[j];
                let canTrade2 = pool2.token0 == tokenOut1 || pool2.token1 == tokenOut1;

                if (canTrade2) {
                    let zeroForOne2 = pool2.token0 == tokenOut1;
                    let [tokenIn2, tokenOut2] = zeroForOne2
                        ? [pool2.token0, pool2.token1]
                        : [pool2.token1, pool2.token0];

                    if (tokenOut1 != tokenIn2) {
                        continue;
                    }

                    for (let k = 0; k < pools.length; k++) {
                        let pool3 = pools[k];
                        let canTrade3 = pool3.token0 == tokenOut2 || pool3.token1 == tokenOut2;
                        if (canTrade3) {
                            let zeroForOne3 = pool3.token0 == tokenOut2;
                            let [tokenIn3, tokenOut3] = zeroForOne3
                                ? [pool3.token0, pool3.token1]
                                : [pool3.token1, pool3.token0];
                            if (tokenOut2 != tokenIn3) {
                                continue;
                            }

                            if (tokenOut3 == tokenIn) {
                                let uniquePoolCnt = [...new Set([pool1.address, pool2.address, pool3.address])].length;

                                if (uniquePoolCnt < 3) {
                                    continue;
                                }

                                let arbPath = new ArbPath(pool1, pool2, pool3, zeroForOne1, zeroForOne2, zeroForOne3);
                                paths.push(arbPath);
                            }
                        }
                    }
                }
            }
        }
        progress.update(i + 1);
    }

    progress.stop();
    logger.info(`Generated ${paths.length} 3-hop arbitrage paths`);
    return paths;
};
