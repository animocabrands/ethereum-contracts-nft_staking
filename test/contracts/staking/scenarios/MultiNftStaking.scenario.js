const { shouldStakeNft, shouldEstimateRewards, shouldClaimRewards,
    shouldTimeWarpBy, initialiseDebug } = require('../behaviors');

const { TokenIds } = require('../constants');

const multiNftStakingScenario = function (staker) {

    before(function () {
        initialiseDebug.bind(this)(staker);
    });;

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

const multiNftStakingSinglePeriodScenario = function (staker) {

    describe('Stake an NFT at cycle 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Stake an NFT at cycle 2', function () {
        shouldTimeWarpBy({ cycles: 1 }, { cycle: 2, period: 1 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Stake an NFT at cycle 4', function () {
        shouldTimeWarpBy({ cycles: 2 }, { cycle: 4, period: 1 });
        shouldStakeNft(staker, TokenIds[2]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Stake an NFT at cycle 7', function () {
        shouldTimeWarpBy({ cycles: 3 }, { cycle: 7, period: 1 });
        shouldStakeNft(staker, TokenIds[3]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Estimate rewards in period 2', function () {
        shouldTimeWarpBy({ periods: 1 }, { cycle: 14, period: 2 });
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
    });

};

const multiNftStakingMultiPeriodScenario = function (staker) {

    describe('Stake an NFT at the start of period 1', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Stake an NFT at the middle of period 2', function () {
        shouldTimeWarpBy({ cycles: 3, periods: 1 }, { cycle: 11, period: 2 });
        shouldStakeNft(staker, TokenIds[1]);
        shouldEstimateRewards(staker, 1, { startPeriod: 1, periods: 1, amount: 7000 });
    });

    describe('Stake an NFT at the end of period 3', function () {
        shouldTimeWarpBy({ cycles: 3, periods: 1 }, { cycle: 21, period: 3 });
        shouldStakeNft(staker, TokenIds[2]);
        shouldEstimateRewards(staker, 2, { startPeriod: 1, periods: 2, amount: 14000 });
    });
}

module.exports = {
    multiNftStakingScenario,
    multiNftStakingSinglePeriodScenario,
    multiNftStakingMultiPeriodScenario
}
