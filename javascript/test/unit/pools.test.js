/** @format */

import { ethers } from 'ethers';
import dotenv from 'dotenv';

import { loadAllPoolsFromV3 } from '../../src/pools.js';

dotenv.config();
const exec = async () => {
    const HTTPSURL = `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`;
    const MOCKFACTORYADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
    const MOCKBLOCKNUMBER = 12469621;
    const CHUNK = 10000;

    const pools = await loadAllPoolsFromV3(HTTPSURL, [MOCKFACTORYADDRESS], [MOCKBLOCKNUMBER], CHUNK);

    console.log(pools);
};

exec();
