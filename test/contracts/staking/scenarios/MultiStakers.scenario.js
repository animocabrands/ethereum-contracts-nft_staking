const TokenHelper = require('../../../utils/tokenHelper');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { shouldWarpToTarget } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const multiStakersScenario = function (creator, staker, otherStaker) {

    const OtherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
    });

    describe('Start', function () {
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 1 });
        shouldHaveLastGlobalSnapshot({ startCycle: 1, stake: 1, index: 0 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 0, claimableRewards: 0 });

        describe('timewarp 1 period', function () {
            shouldWarpToTarget({cycles:0, periods:1, targetCycle:8, targetPeriod: 2});

            shouldStakeNft({ staker: otherStaker, tokenId: OtherTokenIds[0], cycle: 8 });
            shouldHaveLastGlobalSnapshot({ startCycle: 8, stake: 2, index: 1 });
            shouldHaveLastStakerSnapshot({ staker: otherStaker, startCycle: 8, stake: 1, index: 0 });
            shouldHaveNextClaim({ staker: otherStaker, period: 2, globalHistoryIndex: 1, stakerHistoryIndex: 0 });

            shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
            shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 1, firstClaimablePeriod: 2, computedPeriods: 0, claimableRewards: 0 });

            describe('timewarp 1 period', function () {
                shouldWarpToTarget({cycles:0, periods:1, targetCycle:15, targetPeriod: 3});
                shouldEstimateRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 10500 });
                shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, firstClaimablePeriod: 2, computedPeriods: 1, claimableRewards: 3500 });

                describe('timewarp 2 cycles', function () {
                    shouldWarpToTarget({cycles:2, periods:0, targetCycle:17, targetPeriod: 3});

                    shouldEstimateRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 10500 });
                    shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, firstClaimablePeriod: 2, computedPeriods: 1, claimableRewards: 3500 });

                    shouldStakeNft({ staker, tokenId: TokenIds[1], cycle: 17 });
                    shouldHaveLastGlobalSnapshot({ startCycle: 17, stake: 12, index: 2 });
                    shouldHaveLastStakerSnapshot({ staker, startCycle: 17, stake: 11, index: 1 });
                    shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

                    shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
                    shouldEstimateRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 10500 });
                    shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, firstClaimablePeriod: 2, computedPeriods: 1, claimableRewards: 3500 });

                    describe('timewarp 2 cycles', function () {
                        shouldWarpToTarget({cycles:2, periods:0, targetCycle:19, targetPeriod: 3});

                        shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 7000 });
                        shouldEstimateRewards({ staker, periodsToClaim: 5, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 10500 });
                        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, firstClaimablePeriod: 2, computedPeriods: 1, claimableRewards: 3500 });
                    });
                });
            });
        });
    });
}

module.exports = {
    multiStakersScenario
}