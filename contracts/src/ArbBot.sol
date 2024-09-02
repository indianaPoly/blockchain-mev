// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interface/IBalancer.sol";
import "../interface/IUniswapV3Pool.sol";
import "../interface/IUniswapV3Swap.sol";
import "../interface/IWETH.sol";

contract ArbBot is IFlashLoanRecipient {
    using SafeERC20 for IERC20;

    address public immutable owner;
    IWETH public immutable mainCurrency;

    // 이더를 받을 때마다 자동으로 호출하며 받은 이더를 WETH로 변환하여 저장
    receive() external payable {
        mainCurrency.deposit{value: msg.value}();
    }

    // mainCurrency on Ethereum is WETH
    constructor(address _owner, address _mainCurrency) {
        owner = _owner;
        mainCurrency = IWETH(_mainCurrency);
    }

    // 잔여 토큰에 대해서 소유자에게 반환하는 기능
    // 소유자가 아닌 경우에는 트랜젝션이 실패
    function recoverToken(address token) public payable {
        require(msg.sender == owner, "not owner");
        // 1 wei만 남겨두고 나머지를 transfer를 진행
        IERC20(token).transfer(
            msg.sender,
            IERC20(token).balanceOf(address(this)) - 1
        );
    }

    // router에 대해서 토큰 전송에 대한 승인하는 기능
    function approveRouter(
        address router,
        address[] memory tokens,
        bool force
    ) public {
        // skip approval if it already has allowance and if force is false
        uint maxInt = type(uint256).max;

        uint tokensLength = tokens.length;

        for (uint i; i < tokensLength; ) {
            IERC20 token = IERC20(tokens[i]);
            uint allowance = token.allowance(address(this), router);

            // 충분히 허용한 경우에 대해서는 승인을 하지 않도록 함
            if (allowance < (maxInt / 2) || force) {
                token.approve(router, maxInt);
            }

            unchecked {
                i++;
            }
        }
    }

    // 거래를 실행하는 함수
    function _execute(bytes memory data) internal returns (uint amountOut) {
        uint8 nhop;

        assembly {
            nhop := sub(div(mload(data), 0x60), 1)

            let offset := add(data, 0x20)
            amountOut := mload(offset)
        }

        for (uint8 i; i < nhop; ) {
            address router;
            address tokenIn;
            address tokenOut;
            uint24 fee;

            assembly {
                let offset := add(add(data, 0x20), 0x60)
                offset := add(offset, mul(0x60, i))

                router := mload(offset)
                tokenIn := mload(add(offset, 0x20))
                tokenOut := mload(add(offset, 0x40))
                fee := mload(add(offset, 0x60))
            }

            address[] memory tokens;
            tokens[0] = tokenIn;
            tokens[1] = tokenOut;
            approveRouter(router, tokens, false);

            IUniswapV3Router.ExactInputSingleParams
                memory params = IUniswapV3Router.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fee,
                    recipient: address(this),
                    deadline: block.timestamp + 60,
                    amountIn: amountOut,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                });

            IUniswapV3Router router3 = IUniswapV3Router(router);
            amountOut = router3.exactInputSingle{value: 0}(params);

            unchecked {
                i++;
            }
        }
    }

    // flashLoan 수령
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint[] memory amounts,
        uint[] memory,
        bytes memory data
    ) external override {
        address vault;

        assembly {
            let offset := add(data, 0x20)
            vault := mload(add(offset, 0x40))
        }

        require(msg.sender == vault, "not vault");

        IERC20 token = tokens[0];
        uint amountIn = amounts[0];

        // we don't need any amountOut checks for this
        // because if we can't pay back the loan, our function simply reverts
        _execute(data);

        // repay the amount borrowed from flashloan
        token.transfer(vault, amountIn);
    }

    // 받은 자금을 통해서 거래를 수행한 뒤에 스왑을 진행.
    function uniswapV3Call(
        address sender,
        uint amount0,
        uint amount1,
        bytes memory data
    ) external {
        address loanPool;
        address tokenIn;

        assembly {
            let offset := add(data, 0x20)
            loanPool := mload(add(offset, 0x40))
            tokenIn := mload(add(offset, 0x80))
        }

        require(msg.sender == loanPool, "not loanPool");
        require(sender == address(this), "not sender");

        // we don't need any amountOut checks for this
        // because if we can't pay back the loan, our function simply reverts
        _execute(data);

        uint amountIn = amount0 == 0 ? amount1 : amount0;
        uint fee = (amountIn * 3) / 997 + 1;
        uint repayAmount = amountIn + fee;

        // repay the amount borrowed from flashloan: (amount + fee)
        IERC20(tokenIn).transfer(loanPool, repayAmount);
    }

    fallback() external payable {
        uint amountIn;
        uint useLoan;
        address loanPool;

        address _owner = owner;

        assembly {
            // only the owner can call fallback
            if iszero(eq(caller(), _owner)) {
                revert(0, 0)
            }

            amountIn := calldataload(0x00)
            useLoan := calldataload(0x20)
            loanPool := calldataload(0x40)
        }

        if (useLoan != 0) {
            address tokenBorrow;

            assembly {
                // the first tokenIn is the token we flashloan
                tokenBorrow := calldataload(0x80)
            }

            if (useLoan == 1) {
                // Balancer Flashloan
                IERC20[] memory tokens = new IERC20[](1);
                tokens[0] = IERC20(tokenBorrow);

                uint[] memory amounts = new uint[](1);
                amounts[0] = amountIn;

                IBalancerVault(loanPool).flashLoan(
                    IFlashLoanRecipient(address(this)),
                    tokens,
                    amounts,
                    msg.data
                );
            } else if (useLoan == 2) {
                // Uniswap V2 Flashswap
                IUniswapV3Pool pool = IUniswapV3Pool(loanPool);
                bool zeroForOne = tokenBorrow == pool.token0();
                pool.swap(
                    address(this),
                    zeroForOne,
                    int256(amountIn),
                    0,
                    msg.data
                );
            }
        } else {
            // perform swaps without flashloan
            _execute(msg.data);
        }
    }
}
