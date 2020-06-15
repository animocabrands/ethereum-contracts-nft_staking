const { time } = require('@openzeppelin/test-helpers');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const lateClaimScenario = function (staker) {

    shouldHaveCurrentCycleAndPeriod(1, 1);
    shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });

    shouldHaveLastGlobalSnapshot({ startCycle: 1, stake: 1, index: 0 });
    shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
    shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

    describe('time warp 25 periods', function () {
        before(async function () {
            await time.increase(PeriodLengthInSeconds.muln(25).toNumber());
        });

        shouldHaveCurrentCycleAndPeriod(176, 26);

        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 }); // 7 cycles in period 1
        shouldEstimateRewards({ staker, periodsToClaim: 50, firstClaimablePeriod: 1, computedPeriods: 25, claimableRewards: RewardsPool }); // Full pool

        shouldClaimRewards({ staker, periodsToClaim: 50, firstClaimablePeriod: 1, computedPeriods: 25, claimableRewards: RewardsPool }); // Full pool
        shouldHaveNextClaim({ staker, period: 26, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        describe('time warp 3 cycles', function () {
            before(async function () {
                await time.increase(CycleLengthInSeconds.muln(3));
            });

            shouldHaveCurrentCycleAndPeriod(179, 26);
            shouldUnstakeNft({ staker, tokenId: TokenIds[0], cycle: 179 });
            shouldHaveLastGlobalSnapshot({ startCycle: 179, stake: 0, index: 1 });
            shouldHaveLastStakerSnapshot({ staker, startCycle: 179, stake: 0, index: 1 });

            describe('time warp 5 periods', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(214, 31);

                shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 26, computedPeriods: 1, claimableRewards: 0 });
                shouldEstimateRewards({ staker, periodsToClaim: 50, firstClaimablePeriod: 26, computedPeriods: 5, claimableRewards: 0 });

                shouldClaimRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 26, computedPeriods: 1, claimableRewards: 0 });

                shouldHaveNextClaim({ staker, period: 0, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

                shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 0, computedPeriods: 0, claimableRewards: 0 });
                shouldClaimRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 0, computedPeriods: 0, claimableRewards: 0 });
                shouldClaimRewards({ staker, periodsToClaim: 250, firstClaimablePeriod: 0, computedPeriods: 0, claimableRewards: 0 });
            });
        });
    });
}

module.exports = {
    lateClaimScenario
}