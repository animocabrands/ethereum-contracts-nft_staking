const { time } = require('@openzeppelin/test-helpers');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const {shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot} = require('../fixtures/state');

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
        shouldHaveNextClaim(
            staker,
            0, // period
            0, // globalHistoryIndex
            0, // stakerHistoryIndex
        );

        describe('when staking a Common NFT', function () {
            shouldStakeNft(staker, TokenIds[0], 7);
            shouldHaveCurrentCycleAndPeriod(7, 1);
            shouldHaveGlobalHistoryLength(1);
            shouldHaveStakerHistoryLength(staker, 1);
            shouldHaveNextClaim(
                staker,
                1, // period
                0, // globalHistoryIndex
                0, // stakerHistoryIndex
            );


            describe('when unstaking before the end of the freeze', function () {
                shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Token is still frozen');
            });

            describe('time warp 5 periods', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(42, 6);
                shouldHaveGlobalHistoryLength(1);
                shouldHaveStakerHistoryLength(staker, 1);

                // describe('when staking another NFT before rewards are claimed', function () {
                //     shouldRevertAndNotStakeNft(staker, TokenIds[1], 'NftStaking: Rewards are not claimed');
                // });

                describe('when estimating rewards', function () {
                    context('for 1 period', function () {
                        shouldEstimateRewards(staker, 1, 1, 1, 1000); // 1 cycle in period 1
                    });

                    context('for 2 periods', function () {
                        shouldEstimateRewards(staker, 2, 1, 2, 8000); // 1 cycle in period 1 + 7 cycles in period 2
                    });
                });

                describe('when claiming 2 periods', function () {
                    shouldClaimRewards(staker, 2, 1, 2, 8000); // 1 cycle in period 1 + 7 cycles in period 2
                    shouldHaveGlobalHistoryLength(1);
                    shouldHaveStakerHistoryLength(staker, 1);
                    shouldHaveNextClaim(
                        staker,
                        3, // period
                        0, // globalHistoryIndex
                        0, // stakerHistoryIndex
                    );

                    // TODO move out of scenario
                    describe('when staking an already staked NFT', function () {
                        shouldRevertAndNotStakeNft.bind(this, staker, TokenIds[0], 'ERC1155: transfer of a non-owned NFT');
                    });

                    // TODO move out of scenario
                    describe('when unstaking an NFT not owned by the caller', function () {
                        shouldRevertAndNotUnstakeNft.bind(this, other, TokenIds[0], 'NftStaking: Incorrect token owner or token already unstaked');
                    });

                    describe('time warp 3 periods', function () {
                        before(async function () {
                            await time.increase(PeriodLengthInSeconds.muln(3).toNumber());
                        });

                        shouldHaveCurrentCycleAndPeriod(63, 9);
                        shouldHaveGlobalHistoryLength(1);
                        shouldHaveStakerHistoryLength(staker, 1);

                        // describe('when unstaking a Common NFT before rewards are claimed', function () {
                        //     shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Rewards are not claimed');
                        // });

                        describe('when estimating rewards', function () {
                            context('for exactly the 6 remaining periods', function () {
                                shouldEstimateRewards(staker, 6, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                            });

                            context('for more than the remaining periods', function () {
                                shouldEstimateRewards(staker, 100, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                            });
                        });

                        describe('when claiming the remaining 6 periods', function () {
                            shouldClaimRewards(staker, 6, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                            shouldHaveNextClaim(
                                staker,
                                9, // period
                                0, // globalHistoryIndex
                                0, // stakerHistoryIndex
                            );

                            describe('time warp 2 periods', function () {
                                before(async function () {
                                    await time.increase(PeriodLengthInSeconds.muln(2).toNumber());
                                });

                                describe('when claiming the remaining 2 periods', function () {
                                    shouldClaimRewards(staker, 2, 9, 2, 0);
                                    shouldHaveNextClaim(
                                        staker,
                                        11, // period
                                        0,  // globalHistoryIndex
                                        0,  // stakerHistoryIndex
                                    );

                                    describe('when unstaking a Common NFT', function () {
                                        shouldUnstakeNft(staker, TokenIds[0], 77);
                                        shouldHaveCurrentCycleAndPeriod(77, 11);
                                        shouldHaveGlobalHistoryLength(2);
                                        shouldHaveStakerHistoryLength(staker, 2);
                                        shouldHaveNextClaim(
                                            staker,
                                            11, // period
                                            0,  // globalHistoryIndex
                                            0,  // stakerHistoryIndex
                                        );
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    })
}

module.exports = {
    periodLimitsScenario
}