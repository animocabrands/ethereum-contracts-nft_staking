const { shouldStakeNft, shouldUnstakeNft, shouldClaimRewards,
    shouldTimeWarpBy, initialiseDebug } = require('../behaviors');

const { TokenIds } = require('../constants');

const lateClaimScenario = function (staker) {

    before(function () {
        initialiseDebug.bind(this)(staker);
    });;

    before(function () {
        this.stakers = [staker];
    });

    describe('Stake a Common NFT', function () {
        shouldStakeNft(staker, TokenIds[0]);
    });

    describe('Unstake after warping 10 periods', function () {
        shouldTimeWarpBy({ periods: 10 }, { period: 11 });
        shouldUnstakeNft(staker, TokenIds[0]);
    });

    describe('Claim after warping 10 periods', function () {
        shouldTimeWarpBy({ periods: 10 }, { period: 21 });
        shouldClaimRewards(staker, 11, { startPeriod: 1, periods: 11, amount: 42000 });
    });
}

module.exports = {
    lateClaimScenario
}