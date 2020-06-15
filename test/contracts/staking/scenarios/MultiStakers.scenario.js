const { time } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../../utils/tokenHelper');


const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const {shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot} = require('../fixtures/state');

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
        shouldHaveCurrentCycleAndPeriod(1, 1);

        shouldStakeNft(staker, TokenIds[0], 1);
        shouldHaveLastGlobalSnapshot(1, 1, 0);
        shouldHaveLastStakerSnapshot(staker, 1, 1, 0);
        shouldHaveNextClaim(
            staker,
            1, // period
            0, // globalHistoryIndex
            0, // stakerHistoryIndex
        );
        shouldEstimateRewards(staker, 1, 1, 0, 0);

        describe('timewarp 1 period', function () {
            before(async function () {
                await time.increase(PeriodLengthInSeconds.toNumber());
            });

            shouldHaveCurrentCycleAndPeriod(8, 2);

            shouldStakeNft(otherStaker, OtherTokenIds[0], 8);
            shouldHaveLastGlobalSnapshot(8, 2, 1);
            shouldHaveLastStakerSnapshot(otherStaker, 8, 1, 0);
            shouldHaveNextClaim(
                otherStaker,
                2, // period
                1, // globalHistoryIndex
                0, // stakerHistoryIndex
            );
            shouldEstimateRewards(staker, 1, 1, 1, 7000);
            shouldEstimateRewards(otherStaker, 1, 2, 0, 0);

            describe('timewarp 1 period', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(15, 3);

                shouldEstimateRewards(staker, 5, 1, 2, 10500);
                shouldEstimateRewards(otherStaker, 5, 2, 1, 3500);

                describe('timewarp 2 cycles', function () {
                    before(async function () {
                        await time.increase(CycleLengthInSeconds.muln(2).toNumber());
                    });

                    shouldHaveCurrentCycleAndPeriod(17, 3);

                    shouldEstimateRewards(staker, 5, 1, 2, 10500);
                    shouldEstimateRewards(otherStaker, 5, 2, 1, 3500);

                    shouldStakeNft(staker, TokenIds[1], 17);
                    shouldHaveLastGlobalSnapshot(17, 12, 2);
                    shouldHaveLastStakerSnapshot(staker, 17, 11, 1);

                    shouldHaveNextClaim(
                        staker,
                        1, // period
                        0, // globalHistoryIndex
                        0, // stakerHistoryIndex
                    );
                    shouldEstimateRewards(staker, 1, 1, 1, 7000);
                    shouldEstimateRewards(staker, 5, 1, 2, 10500);
                    shouldEstimateRewards(otherStaker, 5, 2, 1, 3500);

                    describe('timewarp 2 cycles', function () {
                        before(async function () {
                            await time.increase(CycleLengthInSeconds.muln(2).toNumber());
                        });

                        shouldEstimateRewards(staker, 1, 1, 1, 7000);
                        shouldEstimateRewards(staker, 5, 1, 2, 10500);
                        shouldEstimateRewards(otherStaker, 5, 2, 1, 3500);
                    });
                });
            });
        });
    });
}

module.exports = {
    multiStakersScenario
}