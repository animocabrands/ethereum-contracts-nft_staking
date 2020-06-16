const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength } = require('../fixtures/state');

const { shouldTimeWarpBy } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const periodLimitsScenario = function (staker, other) {

    describe('Stake Common NFT at cycle 7', function () {
        const cycle = 7;
        const period = 1;
        shouldTimeWarpBy({ cycles: 6 }, { cycle: 7, period: 1 });

        shouldStakeNft({ staker, tokenId: TokenIds[0] });
        shouldHaveNextClaim({ staker, period, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        // TODO move out
        shouldRevertAndNotUnstakeNft({
            staker,
            tokenId: TokenIds[0],
            expectedError: 'NftStaking: Token is still frozen'
        });
    })

    describe('Estimate after 5 periods', function () {
        shouldTimeWarpBy({ periods: 5 }, { cycle: 42, period: 6 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 1000 }); // 1 cycle in period 1
        shouldEstimateRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 2, amount: 8000 }); // 1 cycle in period 1 + 7 cycles in period 2

        shouldClaimRewards({ staker, periodsToClaim: 2, startPeriod: 1, periods: 2, amount: 8000 }); // 1 cycle in period 1 + 7 cycles in period 2

        shouldHaveNextClaim({ staker, period: 3, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

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
    });

    describe('Estimate after 3 more periods', function () {
        const cycle = 63;
        const period = 9;
        shouldTimeWarpBy({ periods: 3 }, { cycle, period });

        shouldEstimateRewards({ staker, periodsToClaim: 6, startPeriod: 3, periods: 6, amount: 28000 }); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
        shouldEstimateRewards({ staker, periodsToClaim: 100, startPeriod: 3, periods: 6, amount: 28000 }); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8

        shouldClaimRewards({ staker, periodsToClaim: 6, startPeriod: 3, periods: 6, amount: 28000 }); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
        shouldHaveNextClaim({ staker, period: period, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });
    });

    describe('time warp 2 periods', function () {
        const cycle = 77;
        const period = 11;
        shouldTimeWarpBy({ periods: 2 }, { cycle: 77, period: 11 });

        shouldClaimRewards({ staker, periodsToClaim: 2, startPeriod: 9, periods: 2, amount: 0 });
        shouldHaveNextClaim({ staker, period: period, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        shouldUnstakeNft({ staker, tokenId: TokenIds[0] });
    });
}

module.exports = {
    periodLimitsScenario
}