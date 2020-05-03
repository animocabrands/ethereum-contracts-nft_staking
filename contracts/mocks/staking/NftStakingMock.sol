pragma solidity ^0.6.6;

import "../../staking/NftStaking.sol";

contract NftStakingMock is NftStaking {

    constructor(
        uint payoutPeriodLength,
        uint freezeDurationAfterStake,
        address whitelistedNftContract,
        address dividendToken,
        uint[] memory rarities,
        uint[] memory rarityWeights
    )
    NftStaking(payoutPeriodLength, freezeDurationAfterStake, whitelistedNftContract, dividendToken, rarities, rarityWeights)
    public {}

    function isCorrectTokenType(uint tokenId) internal virtual override pure returns(bool) {
        uint tokenType = (tokenId & (0xFF << 240)) >> 240;
        return tokenType == 1;
    }

    function valueFromTokenId(uint tokenId) internal virtual override pure returns(uint) {
        return (tokenId & (0xFF << 176)) >> 176;
    }
}