// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "../../staking/NftStakingTestable.sol";

contract NftStakingTestableMock is NftStakingTestable {

    mapping(uint256 => uint64) public weightByTokenAttribute;

    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        uint16 freezeLengthInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_,
        uint256[] memory tokenAttributes,
        uint64[] memory weights
    )
    NftStakingTestable(
        cycleLengthInSeconds_,
        periodLengthInCycles_,
        freezeLengthInCycles_,
        whitelistedNftContract_,
        rewardsToken_
    ) public {
        require(tokenAttributes.length == weights.length, "NftStakingTestableMock: inconsistent array lengths");
        for (uint256 i = 0; i < tokenAttributes.length; ++i) {
            weightByTokenAttribute[tokenAttributes[i]] = weights[i];
        }
    }

    function _validateAndGetWeight(uint256 nftId) internal virtual override view returns (uint64) {
        uint256 tokenType = (nftId & (0xFF << 240)) >> 240;
        require(tokenType == 1, "NftStakingMock: wrong NFT type");
        uint256 attributeValue = (nftId & (0xFF << 176)) >> 176;
        return weightByTokenAttribute[attributeValue];
    }
}
