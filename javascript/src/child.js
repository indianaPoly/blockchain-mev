/** @format */

// child.js
import { ethers } from 'ethers';
import cliProgress from 'cli-progress';

import UNISWAP_V3_POOL_ABI from '../abi/UniswapV3Pool.json' assert { type: 'json' };

export const getUniswapV3Reserves = async (httpsUrl, poolAddresses, prefix) => {
    const progress = new cliProgress.SingleBar(
        {
            format: `${prefix} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} pools`,
        },
        cliProgress.Presets.shades_classic
    );
    progress.start(poolAddresses.length);

    const provider = new ethers.JsonRpcProvider(httpsUrl);
    const reserves = {};

    let count = 0;
    for (const address of poolAddresses) {
        const poolContract = new ethers.Contract(address, UNISWAP_V3_POOL_ABI, provider);

        try {
            const [sqrtPriceX96, tick] = await poolContract.slot0();
            const liquidity = await poolContract.liquidity();

            reserves[address] = {
                sqrtPriceX96: sqrtPriceX96.toString(), // BigInt to string
                liquidity: liquidity.toString(), // BigInt to string
                tick: tick.toString(), // BigInt to string
            };
            count++;
            progress.update(count);
        } catch (err) {
            count++;
            progress.update(count);
            continue;
        }
    }

    progress.stop();
    return reserves;
};

process.on('message', async (message) => {
    const { httpsUrl, poolAddresses, prefix } = message;
    const reserves = await getUniswapV3Reserves(httpsUrl, poolAddresses, prefix);

    // 결과를 부모 프로세스에 전송 (선택 사항)
    process.send({ reserves });
    process.exit(0);
});
