const {
    shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft, shouldHaveNextClaim, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveCurrentCycleAndPeriod, shouldTimeWarpBy, shouldDebugCurrentState
} = require('../behaviors');

const { TokenIds } = require('../constants');

const lateClaimScenario = function (staker) {
    describe('Stake a Common NFT', function () {
        shouldStakeNft(staker, TokenIds[0]);
    });

    describe('Unstake after warping 10 periods', function () {
        shouldTimeWarpBy({ periods: 10 }, { period: 11 });
        shouldUnstakeNft(staker, TokenIds[0]);
    });

    describe('Claim after warping 10 periods', function () {
        shouldTimeWarpBy({ periods: 10 }, { period: 21 });
        shouldClaimRewards(staker, 11, { startPeriod: 1, periods: 11, amount: 42000 });
    });
}

module.exports = {
    lateClaimScenario
}