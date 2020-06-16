const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { shouldWarpToTarget } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const restakeScenario = function (staker) {

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });
        shouldHaveLastGlobalSnapshot({ startCycle: 1, stake: 1, index: 0 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 0, claimableRewards: 0 });
        // shouldClaimRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 0, claimableRewards: 0 });
        // shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });
    });

    describe('Stake another NFT at start of period 2', function () {
        shouldWarpToTarget({ cycles: 0, periods: 1, targetCycle: 8, targetPeriod: 2 });
        shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 8 });

        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });

        // shouldUnstakeNft({ staker, tokenId: TokenIds[0], cycle: 15 });
        // shouldHaveLastGlobalSnapshot({ startCycle: 15, stake: 0, index: 1 });
        // shouldHaveLastStakerSnapshot({ staker, startCycle: 15, stake: 0, index: 1 });
        // shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        // // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
        // shouldClaimRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 7000 });

    });


    describe('Unstake first NFT, claim, unstake 2nd car, stake the 2nd car again period 3', function () {
        shouldWarpToTarget({ cycles: 0, periods: 1, targetCycle: 15, targetPeriod: 3 });

        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });

        shouldUnstakeNft({ staker, tokenId: TokenIds[0], cycle: 15 });
        // shouldHaveLastGlobalSnapshot({ startCycle: 15, stake: 0, index: 2 });
        // shouldHaveLastStakerSnapshot({ staker, startCycle: 15, stake: 0, index: 2 });
        // shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
        shouldClaimRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[1], cycle: 15 });
        shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 15 });
        // shouldHaveLastGlobalSnapshot({ startCycle: 15, stake: 0, index: 1 });
        // shouldHaveLastStakerSnapshot({ staker, startCycle: 15, stake: 0, index: 1 });
        // shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });
    });

    describe('Unstake the 2nd NFT and claim all the periods at start of period 5', function () {
        shouldWarpToTarget({ cycles: 0, periods: 2, targetCycle: 29, targetPeriod: 5 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[1], cycle: 29 });
        shouldClaimRewards({ staker, periodsToClaim: 10, firstClaimablePeriod: 3, computedPeriods: 2, claimableRewards: 14000 });

        // shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 29 });
        // shouldEstimateRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 4, claimableRewards: 14000 });


        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
        // shouldClaimRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    });

    describe('Stake the 2nd NFT start of period 7', function () {
        shouldWarpToTarget({ cycles: 0, periods: 2, targetCycle: 43, targetPeriod: 7 });
        shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 43 });
        // shouldClaimRewards({ staker, periodsToClaim: 10, firstClaimablePeriod: 3, computedPeriods: 3, claimableRewards: 7000 });

        // shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 29 });
        // shouldEstimateRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 4, claimableRewards: 14000 });


        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
        // shouldClaimRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    });

    describe('Estimate start of period 9', function () {
        shouldWarpToTarget({ cycles: 0, periods: 2, targetCycle: 57, targetPeriod: 9 });
        shouldEstimateRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 5, computedPeriods: 4, claimableRewards: 7000 });

        // shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 44 });
        // shouldClaimRewards({ staker, periodsToClaim: 10, firstClaimablePeriod: 3, computedPeriods: 3, claimableRewards: 7000 });

        // shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 29 });
        // shouldEstimateRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 4, claimableRewards: 14000 });


        // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
        // shouldClaimRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    });

    // describe('Estimate at start of period 5', function () {
    //     shouldWarpToTarget({ cycles: 0, periods: 1, targetCycle: 36, targetPeriod: 6 });
    //     // shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 29 });
    //     shouldEstimateRewards({ staker, periodsToClaim: 99, firstClaimablePeriod: 1, computedPeriods: 5, claimableRewards: 17500 });


    //     // shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    //     // shouldClaimRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 14000 });
    // });
}

module.exports = {
    restakeScenario
}