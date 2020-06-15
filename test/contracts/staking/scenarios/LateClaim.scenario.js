const { time } = require('@openzeppelin/test-helpers');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const {shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot} = require('../fixtures/state');

const {RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool} = require('../constants');

const lateClaimScenario = function (staker) {

    shouldHaveCurrentCycleAndPeriod(1, 1);
    shouldStakeNft(staker, TokenIds[0], 1);
    shouldHaveGlobalHistoryLength(1);
    shouldHaveStakerHistoryLength(staker, 1);
    shouldHaveNextClaim(
        staker,
        1, // period
        0, // globalHistoryIndex
        0, // stakerHistoryIndex
    );

    describe('time warp 25 periods', function () {
        before(async function () {
            await time.increase(PeriodLengthInSeconds.muln(25).toNumber());
        });

        shouldHaveCurrentCycleAndPeriod(176, 26);
        shouldHaveGlobalHistoryLength(1);
        shouldHaveStakerHistoryLength(staker, 1);
        shouldEstimateRewards(staker, 1, 1, 1, 7000); // 1 cycle in period 1
        shouldEstimateRewards(staker, 50, 1, 25, RewardsPool); // Full pool

        shouldClaimRewards(staker, 50, 1, 25, RewardsPool); // Full pool
        shouldHaveGlobalHistoryLength(1);
        shouldHaveStakerHistoryLength(staker, 1);
        shouldHaveNextClaim(
            staker,
            26, // period
            0,  // globalHistoryIndex
            0,  // stakerHistoryIndex
        );

        describe('time warp 3 cycles', function () {
            before(async function () {
                await time.increase(CycleLengthInSeconds.muln(3));
            });

            shouldHaveCurrentCycleAndPeriod(179, 26);
            shouldUnstakeNft(staker, TokenIds[0], 179);
            shouldHaveGlobalHistoryLength(2);
            shouldHaveStakerHistoryLength(staker, 2);
            shouldHaveNextClaim(
                staker,
                26, // period
                0,  // globalHistoryIndex
                0,  // stakerHistoryIndex
            );

            describe('time warp 5 periods', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(214, 31);

                shouldEstimateRewards(staker, 1, 26, 1, 0);
                shouldEstimateRewards(staker, 50, 26, 5, 0);

                shouldClaimRewards(staker, 1, 26, 1, 0);
                shouldHaveNextClaim(
                    staker,
                    0, // period
                    0, // globalHistoryIndex
                    0, // stakerHistoryIndex
                );

                shouldEstimateRewards(staker, 1, 0, 0, 0);
                shouldClaimRewards(staker, 5, 0, 0, 0);
                shouldClaimRewards(staker, 250, 0, 0, 0);
            });
        });
    });
}

module.exports = {
    lateClaimScenario
}