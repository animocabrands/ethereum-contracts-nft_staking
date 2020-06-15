const { time } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../../utils/tokenHelper');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveLastGlobalSnapshot, shouldHaveLastStakerSnapshot } = require('../fixtures/state');

const { shouldWarpToTarget } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const gasHeavyScenario = function (creator, staker, otherStaker, anotherStaker) {

    const OtherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];
    const AnotherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
        for (const tokenId of AnotherTokenIds) {
            await this.nftContract.mintNonFungible(anotherStaker, tokenId, { from: creator });
        }
    });

    describe('when creating 100 snapshots', function () {
        let cycleCounter = 1
        const numSnapshotsToCreate = 99; // excluding the initial one created by staker #1's stake

        describe(`when creating snapshot #1 - staker #1 stakes an NFT`, function () {
            shouldStakeNft({staker, tokenId: TokenIds[0], cycle: 1});
            shouldHaveLastGlobalSnapshot({ startCycle: 1, stake: 1, index: 0 });
            shouldHaveLastStakerSnapshot({ staker, startCycle: 1, stake: 1, index: 0 });
        });

        describe('when creating interstitial snapshots', async function () {
            for (let index = 0; index < numSnapshotsToCreate; index++) {
                ++cycleCounter;

                switch (index % 4) {
                    case 0:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 stakes an NFT`, function () {
                            before(async function () {
                                await time.increase(CycleLengthInSeconds.toNumber());
                            });

                            shouldStakeNft({staker: otherStaker, tokenId: OtherTokenIds[0], cycle: cycleCounter});
                            shouldHaveLastGlobalSnapshot({ startCycle: cycleCounter, stake: 2, index: cycleCounter - 1 });
                            shouldHaveLastStakerSnapshot({ staker: otherStaker, startCycle: cycleCounter, stake: 1, index: Math.floor(cycleCounter / 2) - 1 });
                        });
                        break;
                    case 1:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 stakes an NFT`, function () {
                            before(async function () {
                                await time.increase(CycleLengthInSeconds.toNumber());
                            });

                            shouldStakeNft({staker: anotherStaker, tokenId: AnotherTokenIds[0], cycle: cycleCounter});
                            shouldHaveLastGlobalSnapshot({ startCycle: cycleCounter, stake: 3, index: cycleCounter - 1 });
                            shouldHaveLastStakerSnapshot({ staker: anotherStaker, startCycle: cycleCounter, stake: 1, index: Math.floor(cycleCounter / 2) - 1 });
                        });
                        break;
                    case 2:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 unclaims their NFT`, function () {
                            before(async function () {
                                await time.increase(CycleLengthInSeconds.toNumber());
                            });
                            shouldUnstakeNft({staker: otherStaker, tokenId: OtherTokenIds[0], cycle: cycleCounter });
                            shouldHaveLastGlobalSnapshot({ startCycle: cycleCounter, stake: 2, index: cycleCounter - 1 });
                            shouldHaveLastStakerSnapshot({ staker: otherStaker, startCycle: cycleCounter, stake: 0, index: Math.floor(cycleCounter / 2) - 1 });

                        });
                        break;
                    case 3:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 unclaims their NFT`, function () {
                            before(async function () {
                                await time.increase(CycleLengthInSeconds.toNumber());
                            });

                            shouldUnstakeNft({staker: anotherStaker, tokenId: AnotherTokenIds[0], cycle: cycleCounter });
                            shouldHaveLastGlobalSnapshot({ startCycle: cycleCounter, stake: 1, index: cycleCounter - 1 });
                            shouldHaveLastStakerSnapshot({ staker: anotherStaker, startCycle: cycleCounter, stake: 0, index: Math.floor(cycleCounter / 2) - 1 });
                        });
                        break;
                }
            }
        });

        describe('when claiming - staker #1 claims their NFT', function () {
            shouldHaveGlobalHistoryLength(100);
            shouldHaveStakerHistoryLength(staker, 1);
            shouldHaveStakerHistoryLength(otherStaker, 50); // ceil(cycleCounter / 2)
            shouldHaveStakerHistoryLength(anotherStaker, 49); // floor(cycleCounter / 2)

            shouldHaveCurrentCycleAndPeriod(100, 15); // period = floor(cycleCounter / 7) + 1

            shouldHaveNextClaim({ staker, period: 1, globalHistoryIndex: 0, stakerHistoryIndex: 0 });

            shouldClaimRewards({staker, periodsToClaim: 99999999, firstClaimablePeriod: 1, computedPeriods: 14, claimableRewards: 24493});

            // payout share for staker 1 for every 4 cycles (repeating) is 1, 1/2, 1/3, 1/2
            // for periods 1-4 (28 cycles w/ payout schedule of 1000 per-cycle)
            //      total payout = 7 * (1000 + 500 + 333 + 500) = 16331
            // for periods 5-8 (28 cycles w/ payout schedule of 500 per-cycle)
            //      total payout += 7 * (500 + 250 + 166 + 250) = 8162
            // for remaining periods (98 - 28 - 28 = 42 cycles)
            //      total payout += 0
            // total payout = 16331 + 8162 + 0 = 24493

            shouldHaveNextClaim({ staker, period: 15, globalHistoryIndex: 98, stakerHistoryIndex: 0 });
        });
    });
}

module.exports = {
    gasHeavyScenario
}