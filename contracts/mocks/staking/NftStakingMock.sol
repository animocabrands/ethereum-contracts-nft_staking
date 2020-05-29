// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStaking.sol";

contract NftStakingMock is NftStaking {

    constructor(
        uint256 cycleLength_,
        uint256 payoutPeriodLength_,
        uint256 freezeDurationAfterStake_,
        // uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint256[] memory values,
        uint256[] memory valueWeights
    ) NftStaking(
        cycleLength_,
        payoutPeriodLength_,
        freezeDurationAfterStake_,
        // rewardPoolBase_,
        whitelistedNftContract_,
        dividendToken_,
        values,
        valueWeights
    ) public {}

    function _isCorrectTokenType(uint256 tokenId) internal virtual override pure returns(bool) {
        uint256 tokenType = (tokenId & (0xFF << 240)) >> 240;
        return tokenType == 1;
    }

    function _valueFromTokenId(uint256 tokenId) internal virtual override pure returns(uint256) {
        return (tokenId & (0xFF << 176)) >> 176;
    }
}
