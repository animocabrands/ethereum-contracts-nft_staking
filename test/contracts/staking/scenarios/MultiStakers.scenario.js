const TokenHelper = require('../../../utils/tokenHelper');

const { shouldStakeNft, shouldEstimateRewards, shouldTimeWarpBy, initialiseDebug } = require('../behaviors');

const { TokenIds } = require('../constants');

const OtherTokenIds = [
    TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Legendary, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
];

const multiStakersScenario = function (creator, staker, otherStaker) {

    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker);
    });;

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
    });

    describe('Staker stakes Common NFT at cycle 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: '0' });
    });

    describe('OtherStaker stakes Common NFT at cycle 8', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 8 });

        shouldStakeNft(otherStaker, OtherTokenIds[0]);

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: '7000' });
        shouldEstimateRewards(otherStaker, 1, { startPeriod: 2, periods: 0, amount: '0' });
    });

    describe('Estimate during at cycle 15 (period 3)', function () {
        shouldTimeWarpBy({ periods: 1 }, { period: 3 });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: '10500' });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: '3500' });
    });

    describe('Staker stakes Rare NFT at cycle 17 (period 3)', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 17, period: 3 });

        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: '10500' });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: '3500' });

        shouldStakeNft(staker, TokenIds[1]);

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: '7000' });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: '10500' });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: '3500' });
    });

    describe('Estimate at cycle 19 (period 3)', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 19, period: 3 });

        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: '7000' });
        shouldEstimateRewards(staker, 5, { startPeriod: 1, periods: 2, amount: '10500' });
        shouldEstimateRewards(otherStaker, 5, { startPeriod: 2, periods: 1, amount: '3500' });
    });

}

const multiStakersSinglePeriodScenario = function (creator, staker, otherStaker) {

    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker);
    });;

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
    });

    describe('Staker stakes an NFT at the start of the period', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 0, periods: 0, amount: '0' });
    });

    describe('Staker and OtherStaker both stake an NFT in the middle of the period', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 3, period: 1 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldStakeNft(otherStaker, OtherTokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 0, amount: '0' });
    });

    describe('OtherStaker stakes an NFT at the end of the period', function () {
        shouldTimeWarpBy({ cycles: 4 }, { cycle: 7, period: 1 });
        shouldStakeNft(otherStaker, OtherTokenIds[1]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 0, amount: '0' });
    });

    describe('Estimate rewards in the next period', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 14, period: 2 });
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 1, amount: '6166.6666' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 1, periods: 1, amount: '833.3333' });
    });
}

const multiStakersMultiPeriodScenario = function (creator, staker, otherStaker) {

    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker);
    });;

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
    });

    describe('Staker stakes an NFT at the start of period 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 0, periods: 0, amount: '0' });
    });

    describe('Staker and OtherStaker stakes an NFT at the start of period 2', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 8, period: 2 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldStakeNft(otherStaker, OtherTokenIds[0]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 1, amount: '7000' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 0, amount: '0' });
    });

    describe('Staker stakes an NFT at the start of period 3', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 15, period: 3 });
        shouldStakeNft(staker, TokenIds[2]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 2, amount: '13416.6666' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 1, amount: '583.3333' });
    });

    describe('OtherStaker stakes an NFT at the end of period 3', function () {
        shouldTimeWarpBy({ cycles: 6 }, { cycle: 21, period: 3 });
        shouldStakeNft(otherStaker, OtherTokenIds[1]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 2, amount: '13416.6666' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 1, amount: '583.3333' });
    });

    describe('Staker and OtherStaker stakes an NFT at the end of period 4', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 28, period: 4 });
        shouldStakeNft(staker, TokenIds[3]);
        shouldStakeNft(otherStaker, OtherTokenIds[2]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 3, amount: '20272.9313' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 2, amount: '727.0687' });
    });

    describe('OtherStaker stakes an NFT at the end of period 5', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 35, period: 5 });
        shouldStakeNft(otherStaker, OtherTokenIds[3]);
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 4, amount: '26578.208' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 3, amount: '1421.7919' });
    });

    describe('Estimate rewards in period 6', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 42, period: 6 });
        shouldEstimateRewards(staker, 99, { startPeriod: 1, periods: 5, amount: '29366.9892' });
        shouldEstimateRewards(otherStaker, 99, { startPeriod: 2, periods: 4, amount: '2133.0107' });
    });
}

module.exports = {
    multiStakersScenario,
    multiStakersSinglePeriodScenario,
    multiStakersMultiPeriodScenario
}
