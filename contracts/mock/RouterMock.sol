// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RouterMock {
    function exactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        address recipient,
        uint256 deadline,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut) {
        require(block.timestamp <= deadline, "Transaction expired");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Mock swapping logic: For simplicity, return the input amount as the output
        amountOut = amountIn;

        IERC20(tokenOut).transfer(recipient, amountOut);
    }
}
