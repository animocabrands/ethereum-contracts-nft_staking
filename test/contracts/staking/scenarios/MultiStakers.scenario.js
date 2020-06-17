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

const multiStakersSinglePeriodScenario = function (creator, staker, otherStaker) {

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

    describe('Staker stakes an NFT at the start of the period', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: 0 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 0, periods: 0, amount: 0 });
    });

    describe('Staker and OtherStaker both stake an NFT in the middle of the period', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 3, period: 1 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldStakeNft(otherStaker, OtherTokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: 0 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('OtherStaker stakes an NFT at the end of the period', function () {
        shouldTimeWarpBy({ cycles: 4 }, { cycle: 7, period: 1 });
        shouldStakeNft(otherStaker, OtherTokenIds[1]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: 0 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Estimate rewards in the next period', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 14, period: 2 });
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 1, amount: 6166 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 1, amount: 833 });
    });
}

const multiStakersMultiPeriodScenario = function (creator, staker, otherStaker) {

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

    describe('Staker stakes an NFT at the start of period 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: 0 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 0, periods: 0, amount: 0 });
    });

    describe('Staker and OtherStaker stakes an NFT at the start of period 2', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 8, period: 2 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldStakeNft(otherStaker, OtherTokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 0, amount: 0 });
    });

    describe('Staker stakes an NFT at the start of period 3', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 15, period: 3 });
        shouldStakeNft(staker, TokenIds[2]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 2, amount: 13416 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 1, amount: 583 });
    });

    describe('OtherStaker stakes an NFT at the end of period 3', function () {
        shouldTimeWarpBy({ cycles: 6 }, { cycle: 21, period: 3 });
        shouldStakeNft(otherStaker, OtherTokenIds[1]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 2, amount: 13416 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 1, amount: 583 });
    });

    describe('Staker and OtherStaker stakes an NFT at the end of period 4', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 28, period: 4 });
        shouldStakeNft(staker, TokenIds[3]);
        shouldStakeNft(otherStaker, OtherTokenIds[2]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 3, amount: 20271 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 2, amount: 726 });
    });

    describe('OtherStaker stakes an NFT at the end of period 5', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 35, period: 5 });
        shouldStakeNft(otherStaker, OtherTokenIds[3]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 4, amount: 26576 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 3, amount: 1419 });
    });

    describe('Estimate rewards in period 6', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 42, period: 6 });
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 5, amount: 29364 });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 4, amount: 2130 });
    });
}

module.exports = {
    multiStakersScenario,
    multiStakersSinglePeriodScenario,
    multiStakersMultiPeriodScenario
}
