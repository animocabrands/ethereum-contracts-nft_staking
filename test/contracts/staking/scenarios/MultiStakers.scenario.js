const TokenHelper = require('../../../utils/tokenHelper');

const {
    shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft, shouldHaveNextClaim, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveCurrentCycleAndPeriod, shouldTimeWarpBy, shouldDebugCurrentState
} = require('../behaviors');

const { TokenIds } = require('../constants');

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
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('OtherStaker stakes Common NFT at cycle 8', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 8 });

        shouldStakeNft(otherStaker, OtherTokenIds[0]);

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards(otherStaker, 1, { startPeriod: 2, periods: 0, amount: 0 });
    });

    describe('Estimate during at cycle 15 (period 3)', function () {
        shouldTimeWarpBy({ periods: 1 }, { period: 3 });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: 3500 });
    });

    describe('Staker stakes Rare NFT at cycle 17 (period 3)', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 17, period: 3 });

        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: 3500 });

        shouldStakeNft(staker, TokenIds[1]);

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: 3500 });
    });

    describe('Estimate at cycle 19 (period 3)', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 19, period: 3 });

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: 10500 });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: 3500 });
    });

}

module.exports = {
    multiStakersScenario
}