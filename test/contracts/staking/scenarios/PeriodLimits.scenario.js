const { time } = require('@openzeppelin/test-helpers');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const periodLimitsScenario = function (staker, other) {

    describe('time warp 6 cycles', function () {
        before(async function () {
            await time.increase(CycleLengthInSeconds.muln(6).toNumber());
        });

        shouldHaveCurrentCycleAndPeriod(7, 1);
        shouldHaveGlobalHistoryLength(0);
        shouldHaveStakerHistoryLength(staker, 0);
        shouldHaveNextClaim({ staker, period: 0, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        shouldStakeNft({staker, tokenId: TokenIds[0], cycle: 7});
        shouldHaveLastGlobalSnapshot({ startCycle: 7, stake: 1, index: 0 });
        shouldHaveLastStakerSnapshot({ staker, startCycle: 7, stake: 1, index: 0 });
        shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

        // TODO move out
        shouldRevertAndNotUnstakeNft({
            staker,
            tokenId: TokenIds[0],
            expectedError: 'NftStaking: Token is still frozen'
        });

        describe('time warp 5 periods', function () {
            before(async function () {
                await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
            });

            shouldHaveCurrentCycleAndPeriod(42, 6);

            shouldEstimateRewards({ staker, periodsToClaim: 1, firstClaimablePeriod: 1, computedPeriods: 1, claimableRewards: 1000 }); // 1 cycle in period 1
            shouldEstimateRewards({ staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 8000 }); // 1 cycle in period 1 + 7 cycles in period 2

            shouldClaimRewards({staker, periodsToClaim: 2, firstClaimablePeriod: 1, computedPeriods: 2, claimableRewards: 8000}); // 1 cycle in period 1 + 7 cycles in period 2

            shouldHaveNextClaim({ staker, period: 3, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

            // TODO move out of scenario
            describe('when staking an already staked NFT', function () {
                shouldRevertAndNotStakeNft({
                    staker,
                    tokenId: TokenIds[0],
                    expectedError: 'ERC1155: transfer of a non-owned NFT'
                });
            });

            // TODO move out of scenario
            describe('when unstaking an NFT not owned by the caller', function () {
                shouldRevertAndNotUnstakeNft({
                    staker: other,
                    tokenId: TokenIds[0],
                    expectedError: 'NftStaking: Incorrect token owner or token already unstaked'
                });
            });

            describe('time warp 3 periods', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.muln(3).toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(63, 9);
                shouldEstimateRewards({ staker, periodsToClaim: 6, firstClaimablePeriod: 3, computedPeriods: 6, claimableRewards: 28000 }); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                shouldEstimateRewards({ staker, periodsToClaim: 100, firstClaimablePeriod: 3, computedPeriods: 6, claimableRewards: 28000 }); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8

                shouldClaimRewards({staker, periodsToClaim: 6, firstClaimablePeriod: 3, computedPeriods: 6, claimableRewards: 28000}); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                shouldHaveNextClaim({ staker, period: 9, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

                describe('time warp 2 periods', function () {
                    before(async function () {
                        await time.increase(PeriodLengthInSeconds.muln(2).toNumber());
                    });

                    shouldHaveCurrentCycleAndPeriod(77, 11);

                    shouldClaimRewards({staker, periodsToClaim: 2, firstClaimablePeriod: 9, computedPeriods: 2, claimableRewards: 0});
                    shouldHaveNextClaim({ staker, period: 11, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

                    shouldUnstakeNft({staker, tokenId: TokenIds[0], cycle: 77 });
                    shouldHaveLastGlobalSnapshot({ startCycle: 77, stake: 0, index: 1 });
                    shouldHaveLastStakerSnapshot({ staker, startCycle: 77, stake: 0, index: 1 });
                });
            });
        });
    })
}

module.exports = {
    periodLimitsScenario
}