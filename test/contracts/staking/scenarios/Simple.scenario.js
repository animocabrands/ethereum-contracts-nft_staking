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
    shouldHaveNextClaim({staker, period: 0, globalHistoryIndex: 0, stakerHistoryIndex: 0});

    shouldStakeNft({staker, tokenId: TokenIds[0], cycle: 1});
    shouldHaveLastGlobalSnapshot({startCycle: 1, stake: 1, index: 0 });
    shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
    shouldHaveNextClaim({staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0});

    describe('time warp 1 period and 1 cycle', function () {
        before(async function () {
            await time.increase(PeriodLengthInSeconds.add(CycleLengthInSeconds).toNumber());
        });

        shouldHaveCurrentCycleAndPeriod(9, 2);

        shouldClaimRewards({staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000}); // 7 cycles in period 1
        shouldHaveNextClaim({staker, period: 2, globalHistoryIndex: 0, stakerHistoryIndex: 0});

        shouldUnstakeNft({staker, tokenId: TokenIds[0], cycle: 9 });
        shouldHaveLastGlobalSnapshot({startCycle: 9, stake: 0, index: 1 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 9, stake: 0, index: 1 });
    });
}

module.exports = {
    simpleScenario
}