const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { shouldWarpToTarget } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const simpleScenario = function (staker) {

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });
        shouldHaveLastGlobalSnapshot({ startCycle: 1, stake: 1, index: 0 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 0, claimableRewards: 0 });
        shouldClaimRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 0, claimableRewards: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });
    });


    describe('Stake an NFT at start of period 2', function () {
        shouldWarpToTarget({ cycles: 0, periods: 1, targetCycle: 8, targetPeriod: 2 });

        shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });

        shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 8 });
        shouldHaveLastGlobalSnapshot({ startCycle: 8, stake: 11, index: 1 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 8, stake: 11, index: 1 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });

    });

    describe('Claim at start of period 3', function () {
        shouldWarpToTarget({ cycles: 0, periods: 1, targetCycle: 15, targetPeriod: 3 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
        shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
        shouldClaimRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    });
}

module.exports = {
    simpleScenario
}