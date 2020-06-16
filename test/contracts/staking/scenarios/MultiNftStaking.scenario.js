const {
    shouldStakeNft, shouldEstimateRewards, shouldClaimRewards, shouldTimeWarpBy
} = require('../behaviors');

const { TokenIds } = require('../constants');

const multiNftStakingScenario = function (staker) {

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
        shouldClaimRewards(staker, 5, { startPeriod: 1, periods: 0, amount: 0 });
    });


    describe('Stake an NFT at start of period 2', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 8, period: 2 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldEstimateRewards(staker, 2, { startPeriod: 1, periods: 1, amount: 7000 });
    });

    describe('Claim at start of period 3', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 15, period: 3 });
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
        shouldEstimateRewards(staker, 2, { startPeriod: 1, periods: 2, amount: 14000 });
        shouldClaimRewards(staker, 2, { startPeriod: 1, periods: 2, amount: 14000 });
    });
}

module.exports = {
    multiNftStakingScenario
}
