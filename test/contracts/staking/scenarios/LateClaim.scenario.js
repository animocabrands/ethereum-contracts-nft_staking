const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength } = require('../fixtures/state');

const { shouldTimeWarpBy } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const lateClaimScenario = function (staker) {

    shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });
    shouldHaveNextClaim({ staker, period: 1, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

    describe('time warp 25 periods', function () {

        shouldTimeWarpBy({ periods: 25 }, { period: 26 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 7000 }); // 7 cycles in period 1
        shouldEstimateRewards({ staker, periodsToClaim: 50, startPeriod: 1, periods: 25, amount: RewardsPool }); // Full pool

        shouldClaimRewards({ staker, periodsToClaim: 50, startPeriod: 1, periods: 25, amount: RewardsPool }); // Full pool
        shouldHaveNextClaim({ staker, period: 26, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        describe('time warp 3 cycles', function () {

            shouldTimeWarpBy({ cycles: 3 }, { cycle: 179, period: 26 });

            shouldUnstakeNft({ staker, tokenId: TokenIds[0] });

            describe('time warp 5 periods', function () {
                shouldTimeWarpBy({ periods: 5 }, { cycle: 214, period: 31 });

                shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 26, periods: 1, amount: 0 });
                shouldEstimateRewards({ staker, periodsToClaim: 50, startPeriod: 26, periods: 5, amount: 0 });

                shouldClaimRewards({ staker, periodsToClaim: 1, startPeriod: 26, periods: 1, amount: 0 });

                shouldHaveNextClaim({ staker, period: 0, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

                shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 0, periods: 0, amount: 0 });
                shouldClaimRewards({ staker, periodsToClaim: 5, startPeriod: 0, periods: 0, amount: 0 });
                shouldClaimRewards({ staker, periodsToClaim: 250, startPeriod: 0, periods: 0, amount: 0 });
            });
        });
    });
}

module.exports = {
    lateClaimScenario
}