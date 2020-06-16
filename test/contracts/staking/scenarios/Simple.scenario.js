const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength } = require('../fixtures/state');

const { shouldTimeWarpBy } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const simpleScenario = function (staker) {

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });
        shouldHaveNextClaim({ staker, period: 1, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 0, amount: 0 });
        shouldClaimRewards({ staker, periodsToClaim: 5, startPeriod: 1, periods: 0, amount: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });
    });


    describe('Stake an NFT at start of period 2', function () {
        const cycle = 8;
        const period = 2;
        shouldTimeWarpBy({ periods: 1 }, { cycle, period });

        shouldEstimateRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 1, amount: 7000 });

        shouldStakeNft({ staker, tokenId: TokenIds[1] });
        shouldHaveNextClaim({ staker, period: 1, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 1, amount: 7000 });

    });

    describe('Claim at start of period 3', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 15, period: 3 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 2, amount: 14000 });
        shouldClaimRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 2, amount: 14000 });
    });
}

module.exports = {
    simpleScenario
}