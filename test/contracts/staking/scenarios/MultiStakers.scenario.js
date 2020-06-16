const TokenHelper = require('../../../utils/tokenHelper');

const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength } = require('../fixtures/state');

const { shouldTimeWarpBy } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const multiStakersScenario = function (creator, staker, otherStaker) {

    const OtherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Legendary, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
    });

    describe('Staker stakes Common NFT at cycle 1', function () {
        const cycle = 1;
        const period = 1;
        shouldStakeNft({ staker, tokenId: TokenIds[0] });
        shouldHaveNextClaim({ staker, period, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: period, periods: 0, amount: 0 });

    });

    describe('OtherStaker stakes Common NFT at cycle 8', function () {
        const cycle = 8;
        shouldTimeWarpBy({ periods: 1 }, { cycle });

        shouldStakeNft({ staker: otherStaker, tokenId: OtherTokenIds[0] });
        shouldHaveNextClaim({ staker: otherStaker, period: 2, globalSnapshotIndex: 1, stakerSnapshotIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 1, startPeriod: 2, periods: 0, amount: 0 });
    });

    describe('Estimate during at cycle 15 (period 3)', function () {
        shouldTimeWarpBy({ periods: 1 }, { period: 3 });
        shouldEstimateRewards({ staker, periodsToClaim: 5, startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, startPeriod: 2, periods: 1, amount: 3500 });
    });

    describe('Staker stakes Rare NFT at cycle 17 (period 3)', function () {
        const cycle = 17;
        shouldTimeWarpBy({ cycles: 2 }, { cycle, period: 3 });

        shouldEstimateRewards({ staker, periodsToClaim: 5, startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, startPeriod: 2, periods: 1, amount: 3500 });

        shouldStakeNft({ staker, tokenId: TokenIds[1] });
        shouldHaveNextClaim({ staker, period: 1, globalSnapshotIndex: 0, stakerSnapshotIndex: 0 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards({ staker, periodsToClaim: 5, startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, startPeriod: 2, periods: 1, amount: 3500 });
    });

    describe('Estimate at cycle 19 (period 3)', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 19, period: 3 });

        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards({ staker, periodsToClaim: 5, startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards({ staker: otherStaker, periodsToClaim: 5, startPeriod: 2, periods: 1, amount: 3500 });
    });

}

module.exports = {
    multiStakersScenario
}