const { time } = require('@openzeppelin/test-helpers');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const {shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot} = require('../fixtures/state');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const simpleScenario = function (staker) {

    shouldHaveCurrentCycleAndPeriod(1, 1);
    shouldHaveNextClaim(
        staker,
        0, // period
        0, // globalHistoryIndex
        0, // stakerHistoryIndex
    );
    shouldStakeNft(staker, TokenIds[0], 1);
    shouldHaveLastGlobalSnapshot(1, 1, 0);
    shouldHaveLastStakerSnapshot(staker, 1, 1, 0);
    shouldHaveNextClaim(
        staker,
        1, // period
        0, // globalHistoryIndex
        0, // stakerHistoryIndex
    );

    describe('time warp 1 period and 1 cycle', function () {
        before(async function () {
            await time.increase(PeriodLengthInSeconds.add(CycleLengthInSeconds).toNumber());
        });

        shouldHaveCurrentCycleAndPeriod(9, 2);

        shouldClaimRewards(staker, 99, 1, 1, 7000); // 7 cycles in period 1
        shouldHaveNextClaim(
            staker,
            2, // period
            0, // globalHistoryIndex
            0, // stakerHistoryIndex
        );

        shouldUnstakeNft(staker, TokenIds[0], 9);
        shouldHaveLastGlobalSnapshot(9, 0, 1);
        shouldHaveLastStakerSnapshot(staker, 9, 0, 1);
        shouldHaveNextClaim(
            staker,
            2, // period
            0, // globalHistoryIndex
            0, // stakerHistoryIndex
        );
    });
}

module.exports = {
    simpleScenario
}