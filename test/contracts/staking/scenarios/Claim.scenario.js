const TokenHelper = require('../../../utils/tokenHelper');

const {
    shouldStakeNft, shouldUnstakeNft, shouldClaimRewards, shouldTimeWarpBy, initialiseDebug
} = require('../behaviors');

const { TokenIds } = require('../constants');

const OtherTokenIds = [
    TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Legendary, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
];

const AnotherTokenIds = [
    TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Legendary, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
];

const claimScenario = function (creator, staker, otherStaker, anotherStaker) {

    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker, anotherStaker);
    });;

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }

        for (const tokenId of AnotherTokenIds) {
            await this.nftContract.mintNonFungible(anotherStaker, tokenId, { from: creator });
        }
    });

    describe('when claiming before staking', function () {
        shouldClaimRewards(staker, 99, { startPeriod: 0, periods: 0, amount: '0'});
    });

    describe('when claiming within the same cycle as staking', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldStakeNft(otherStaker, OtherTokenIds[0]);
        shouldStakeNft(anotherStaker, AnotherTokenIds[0]);
        shouldClaimRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0'});
    });

    describe('when claiming within the same period as staking', function () {
        shouldClaimRewards(staker, 99, { startPeriod: 1, periods: 0, amount: '0'});
    });

    describe('when one period from staking', function () {
        shouldTimeWarpBy({ periods: 1}, { cycle: 8, period: 2});

        describe('when claiming zero claimable periods', function () {
            shouldClaimRewards(staker, 0, { startPeriod: 1, periods: 0, amount: '0' });
        });

        describe('when claiming exact claimable periods', function () {
            shouldClaimRewards(staker, 1, { startPeriod: 1, periods: 1, amount: '2333.3333' });
        });

        describe('when claiming more than exact claimable periods', function () {
            shouldClaimRewards(otherStaker, 99, { startPeriod: 1, periods: 1, amount: '2333.3333' });
        });
    });

    describe('when more than one period from staking', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 15, period: 3 });

        describe('when claiming less than exact claimable periods', function () {
            shouldClaimRewards(anotherStaker, 1, { startPeriod: 1, periods: 1, amount: '2333.3333' });
        });

        describe('when claiming the remaining claimable periods', function () {
            shouldClaimRewards(anotherStaker, 99, { startPeriod: 2, periods: 1, amount: '2333.3333' });
        });
    });

    describe('when claiming after the last claim', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 22, period: 4 });

        describe('when claiming one claimable period', function () {
            shouldClaimRewards(anotherStaker, 99, { startPeriod: 3, periods: 1, amount: '2333.3333' });
        });

        describe('when claiming more than one claimable period', function () {
            shouldClaimRewards(staker, 99, { startPeriod: 2, periods: 2, amount: '4666.6666' });
        });
    });

    describe('when unstake after 10 periods from the last claim', function () {
        shouldTimeWarpBy({ periods: 7 }, { cycle: 71, period: 11 });

        describe('when unstaking', function () {
            shouldUnstakeNft(otherStaker, OtherTokenIds[0]);
        });
    });

    describe('when claiming after 10 periods from the last unstake', function () {
        shouldTimeWarpBy({ periods: 10 }, { cycle: 141, period: 21 });

        describe('when unstaking', function () {
            shouldClaimRewards(otherStaker, 99, { startPeriod: 2, periods: 19, amount: '11666.6666' });
        });
    });
}

module.exports = {
    claimScenario
}
