// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStakingTestable.sol";

contract NftStakingTestableMock is NftStakingTestable {

    constructor(
        uint256 cycleLength_,
        uint payoutPeriodLength_,
        uint freezeDurationAfterStake_,
        uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint[] memory values,
        uint[] memory valueWeights
    )
    NftStakingTestable(cycleLength_, payoutPeriodLength_, freezeDurationAfterStake_, rewardPoolBase_, whitelistedNftContract_, dividendToken_, values, valueWeights)
    public {}

    function isCorrectTokenType(uint tokenId) internal virtual override pure returns(bool) {
        uint tokenType = (tokenId & (0xFF << 240)) >> 240;
        return tokenType == 1;
    }

    function valueFromTokenId(uint tokenId) internal virtual override pure returns(uint) {
        return (tokenId & (0xFF << 176)) >> 176;
    }

    function getCurrentPayoutPeriod() public view returns (uint) {
        return _getPayoutPeriod(getCurrentCycle(), payoutPeriodLength);
    }
}
