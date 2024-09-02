// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/ArbBot.sol";

contract BalancerVaultMock {
    function flashLoan(
        IFlashLoanRecipient recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external {
        uint256[] memory feeAmount;
        // Transfer the flashloan amount to the recipient
        tokens[0].transfer(address(recipient), amounts[0]);

        // Execute the flashloan recipient logic
        recipient.receiveFlashLoan(tokens, amounts, feeAmount, userData);

        // Assuming flashloan is repaid in full, we do not implement further logic
    }
}
