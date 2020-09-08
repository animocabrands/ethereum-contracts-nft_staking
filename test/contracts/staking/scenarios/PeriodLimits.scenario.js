const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldRevertAndNotStakeNft,
    shouldStakeNft,
    shouldUnstakeNft,
    shouldEstimateRewards,
    shouldClaimRewards,
    shouldRevertAndNotUnstakeNft,
    shouldTimeWarpBy,
    initialiseDebug,
} = require('../behaviors');

const [creator, staker] = accounts;

const periodLimitsScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe('Stake Common NFT at cycle 7', function () {
        shouldTimeWarpBy({cycles: 6}, {cycle: 7, period: 1});
        shouldStakeNft(staker, 0);
    });

    describe('Estimate after 5 periods', function () {
        shouldTimeWarpBy({periods: 5}, {cycle: 42, period: 6});

        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 1, amount: '1000'}); // 1 cycle in period 1
        shouldEstimateRewards(staker, 2, {startPeriod: 1, periods: 2, amount: '8000'}); // 1 cycle in period 1 + 7 cycles in period 2

        shouldClaimRewards(staker, 2, {startPeriod: 1, periods: 2, amount: '8000'}); // 1 cycle in period 1 + 7 cycles in period 2
    });

    describe('Estimate after 3 more periods', function () {
        shouldTimeWarpBy({periods: 3}, {cycle: 63, period: 9});

        shouldEstimateRewards(staker, 6, {startPeriod: 3, periods: 6, amount: '28000'}); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
        shouldEstimateRewards(staker, 100, {startPeriod: 3, periods: 6, amount: '28000'}); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8

        shouldClaimRewards(staker, 6, {startPeriod: 3, periods: 6, amount: '28000'}); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
    });

    describe('time warp 2 periods', function () {
        shouldTimeWarpBy({periods: 2}, {cycle: 77, period: 11});

        shouldClaimRewards(staker, 2, {startPeriod: 9, periods: 2, amount: '0'});
        shouldUnstakeNft(staker, 0);
    });
};

module.exports = {
    periodLimitsScenario,
};
