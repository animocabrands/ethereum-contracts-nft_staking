// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStaking.sol";

contract NftStakingMock is NftStaking {

    constructor(
        uint256 cycleLength_,
        uint payoutPeriodLength_,
        uint freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint[] memory values,
        uint[] memory valueWeights
    )
    NftStaking(cycleLength_, payoutPeriodLength_, freezeDurationAfterStake_, whitelistedNftContract_, dividendToken_, values, valueWeights)
    public {}

    function isCorrectTokenType(uint tokenId) internal virtual override pure returns(bool) {
        uint tokenType = (tokenId & (0xFF << 240)) >> 240;
        return tokenType == 1;
    }

    function valueFromTokenId(uint tokenId) internal virtual override pure returns(uint) {
        return (tokenId & (0xFF << 176)) >> 176;
    }
}
