// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStakingTestable.sol";

contract NftStakingTestableMock is NftStakingTestable {

    mapping(uint256 => uint32) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => payout weight

    constructor(
        uint256 cycleLength_,
        uint256 payoutPeriodLength_,
        uint256 freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint256[] memory values,
        uint32[] memory valueWeights
    )
    NftStakingTestable(
        cycleLength_,
        payoutPeriodLength_,
        freezeDurationAfterStake_,
        whitelistedNftContract_,
        dividendToken_
    ) public {
        require(values.length == valueWeights.length, "NftStakingTestableMock: Mismatch in value/weight array argument lengths");
        for (uint256 i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }
    }

    function _validateAndGetWeight(uint256 nftId) internal virtual override view returns (uint32) {
        uint256 tokenType = (nftId & (0xFF << 240)) >> 240;
        require(tokenType == 1, "NftStakingMock: wrong NFT type");
        uint256 value = (nftId & (0xFF << 176)) >> 176;
        return valueStakeWeights[value];
    }
}
