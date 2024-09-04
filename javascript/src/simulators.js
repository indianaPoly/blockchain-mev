/** @format */

export class UniswapV3Simulator {
  constructor() {}

  /**
   * V3 풀에서 가격을 계산하는 함수
   * @param {string | number} sqrtPriceX96  V3 풀의 현재 가격 제곱근
   * @param {number} decimals0 토큰0의 소수 자릿수
   * @param {number} decimals1 토큰1의 소수 자릿수
   * @param {boolean} token0In 토큰0을 입력으로 사용할지 여부
   * @returns {number} 계산된 가격
   */
  sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1, token0In) {
    sqrtPriceX96 = BigInt(sqrtPriceX96);
    decimals0 = BigInt(decimals0);
    decimals1 = BigInt(decimals1);

    // 가격 계산 공식: price = (sqrtPriceX96^2) / 2^192
    let price = Number((sqrtPriceX96 * sqrtPriceX96) >> BigInt(192));

    // 소수점 조정을 위해 10^(decimals0 - decimals1)를 곱함
    price = price * 10 ** Number(decimals0 - decimals1);
    return token0In ? price : 1 / price;
  }

  /**
   * V3에서 주어진 입력에 대한 출력 토큰의 양을 계산하는 함수
   * @param {string | number} amountIn 입력 토큰의 양
   * @param {string | number} sqrtPriceX96 현재 가격 제곱근
   * @param {string | number} liquidity 풀의 유동성
   * @param {number} fee 거래 수수료 (bps, 예: 0.3%는 30)
   * @returns {number} 출력 토큰의 양
   */
  getAmountOut(amountIn, sqrtPriceX96, liquidity, fee) {
    amountIn = BigInt(amountIn);
    sqrtPriceX96 = BigInt(sqrtPriceX96);
    liquidity = BigInt(liquidity);
    fee = BigInt(fee);

    // 수수료 계산
    let amountInWithFee = (amountIn * (BigInt(10000) - fee)) / BigInt(10000);

    // amountOut 계산 공식
    let numerator = amountInWithFee * liquidity;
    let denominator = liquidity + sqrtPriceX96 * amountInWithFee;
    return denominator == 0 ? 0 : Number(numerator / denominator);
  }
}
