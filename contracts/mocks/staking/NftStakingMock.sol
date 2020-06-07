// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStaking.sol";

contract NftStakingMock is NftStaking {

    mapping(uint256 => uint32) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => payout weight

    constructor(
        uint256 cycleLength_,
        uint32 payoutPeriodLength_,
        uint64 freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address rewardsToken_,
        uint256[] memory values,
        uint32[] memory valueWeights
    ) NftStaking(
        cycleLength_,
        payoutPeriodLength_,
        freezeDurationAfterStake_,
        whitelistedNftContract_,
        rewardsToken_
    ) public {
        require(values.length == valueWeights.length, "NftStakingMock: Mismatch in value/weight array argument lengths");
        for (uint256 i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }
    }

    function _validateAndGetWeight(uint256 nftId) internal virtual override view returns (uint32) {
        uint256 tokenType = (nftId & (0xFF << 240)) >> 240;
        require(tokenType == 1, "NftStakingMock: Wrong NFT type");
        uint256 value = (nftId & (0xFF << 176)) >> 176;
        return valueStakeWeights[value];
    }
}
