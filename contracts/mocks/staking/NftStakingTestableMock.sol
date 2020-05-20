pragma solidity ^0.6.8;

import "../../staking/NftStakingTestable.sol";

contract NftStakingTestableMock is NftStakingTestable {

    constructor(
        uint payoutPeriodLength,
        uint freezeDurationAfterStake,
        address whitelistedNftContract,
        address dividendToken,
        uint[] memory values,
        uint[] memory valueWeights
    )
    NftStakingTestable(payoutPeriodLength, freezeDurationAfterStake, whitelistedNftContract, dividendToken, values, valueWeights)
    public {}

    function isCorrectTokenType(uint tokenId) internal virtual override pure returns(bool) {
        uint tokenType = (tokenId & (0xFF << 240)) >> 240;
        return tokenType == 1;
    }

    function valueFromTokenId(uint tokenId) internal virtual override pure returns(uint) {
        return (tokenId & (0xFF << 176)) >> 176;
    }
}
