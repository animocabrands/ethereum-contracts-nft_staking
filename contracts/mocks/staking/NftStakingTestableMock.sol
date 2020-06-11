// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStakingTestable.sol";

contract NftStakingTestableMock is NftStakingTestable {

    mapping(uint256 => uint64) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => weight

    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        uint16 freezeLengthInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_,
        uint256[] memory values,
        uint64[] memory valueWeights
    )
    NftStakingTestable(
        cycleLengthInSeconds_,
        periodLengthInCycles_,
        freezeLengthInCycles_,
        whitelistedNftContract_,
        rewardsToken_
    ) public {
        require(values.length == valueWeights.length, "NftStakingTestableMock: Mismatch in value/weight array argument lengths");
        for (uint256 i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }
    }

    function _validateAndGetWeight(uint256 nftId) internal virtual override view returns (uint64) {
        uint256 tokenType = (nftId & (0xFF << 240)) >> 240;
        require(tokenType == 1, "NftStakingMock: wrong NFT type");
        uint256 value = (nftId & (0xFF << 176)) >> 176;
        return valueStakeWeights[value];
    }
}
