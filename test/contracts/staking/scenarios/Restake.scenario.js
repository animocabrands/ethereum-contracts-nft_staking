const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldEstimateRewards,
    shouldClaimRewards,
    shouldTimeWarpBy,
    initialiseDebug,
} = require('../behaviors');

const [creator, staker] = accounts;

const restakeScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft(staker, 3);
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
    });

    describe('Stake another NFT at start of period 2', function () {
        shouldTimeWarpBy({periods: 1}, {period: 2});
        shouldStakeNft(staker, 0);
    });

    describe('Unstake first NFT, claim, unstake 2nd car, stake the 2nd car again period 3', function () {
        shouldTimeWarpBy({periods: 1});
        shouldUnstakeNft(staker, 3);
        shouldClaimRewards(staker, 99, {startPeriod: 1, periods: 2, amount: '37800000'});
        shouldUnstakeNft(staker, 0);
        shouldTimeWarpBy({cycles: 2}); // unstake cooldown
        shouldStakeNft(staker, 0);
    });

    describe('unstake and stake and claim common car within period 4', function () {
        shouldTimeWarpBy({cycles: 2}, {cycle: 19, period: 3});
        shouldUnstakeNft(staker, 0);

        shouldTimeWarpBy({cycles: 2}, {cycle: 21, period: 3});
        shouldStakeNft(staker, 0);

        shouldTimeWarpBy({cycles: 2}, {cycle: 23, period: 4});
        shouldUnstakeNft(staker, 0);

        shouldTimeWarpBy({cycles: 2}); // unstake cooldown

        shouldClaimRewards(staker, 10, {startPeriod: 3, periods: 1, amount: '8100000'});
        shouldStakeNft(staker, 0);

        shouldTimeWarpBy({cycles: 2}, {cycle: 27, period: 4});
    });

    describe('claim period 5', function () {
        shouldTimeWarpBy({periods: 1}, {cycle: 34, period: 5});
        shouldClaimRewards(staker, 10, {startPeriod: 4, periods: 1, amount: '13500000'});
    });

    describe('Unstake the 2nd NFT and claim all the periods at start of period 8', function () {
        shouldTimeWarpBy({periods: 3}, {period: 8});
        shouldUnstakeNft(staker, 0);
        shouldClaimRewards(staker, 10, {startPeriod: 5, periods: 3, amount: '45150000'});
    });

    describe('Stake the 2nd NFT start of period 12', function () {
        shouldTimeWarpBy({periods: 4}, {period: 12});
        shouldStakeNft(staker, 0);
    });

    describe('Estimate start of period 14', function () {
        shouldTimeWarpBy({periods: 2}, {period: 14});
        shouldEstimateRewards(staker, 99, {startPeriod: 8, periods: 6, amount: '26550000'});
    });
};

module.exports = {
    restakeScenario,
};
