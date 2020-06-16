const { shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft } = require('../fixtures/behavior');

const { shouldHaveNextClaim, shouldHaveCurrentCycleAndPeriod, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength } = require('../fixtures/state');

const { shouldTimeWarpBy } = require('../fixtures/time');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const restakeScenario = function (staker) {

    describe('Stake an NFT at start of period 1', function () {
        shouldStakeNft({ staker, tokenId: TokenIds[3] });
        shouldEstimateRewards({ staker, periodsToClaim: 1, startPeriod: 1, periods: 0, amount: 0 });
    });

    describe('Stake another NFT at start of period 2', function () {
        shouldTimeWarpBy({ periods: 1 }, { period: 2 });
        shouldStakeNft({ staker, tokenId: TokenIds[0] });
    });

    describe('Unstake first NFT, claim, unstake 2nd car, stake the 2nd car again period 3', function () {
        shouldTimeWarpBy({ periods: 1 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[3] });
        shouldClaimRewards({ staker, periodsToClaim: 99, startPeriod: 1, periods: 2, amount: "37800000000000000000000000" });
        shouldUnstakeNft({ staker, tokenId: TokenIds[0] });
        shouldStakeNft({ staker, tokenId: TokenIds[0] });
    });
    
    describe('unstake and stake and claim common car within period 4', function () {
        shouldTimeWarpBy({ cycles: 2}, {cycle: 17, period: 3 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[0], cycle: 17 });
        shouldTimeWarpBy({ cycles: 1}, {cycle: 18, period: 3 });
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 18 });
        shouldTimeWarpBy({ cycles: 2}, {cycle: 20, period: 3 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[0], cycle: 20 });
        shouldClaimRewards({ staker, periodsToClaim: 10, startPeriod: 3, periods: 5, amount: "0" });
        shouldStakeNft({ staker, tokenId: TokenIds[0], cycle: 20 });
        shouldTimeWarpBy({ cycles: 2}, {cycle: 22, period: 4 });
    });

    describe('claim period 5', function () {
        shouldTimeWarpBy({ periods: 1}, {cycle: 29, period: 5 });
        shouldClaimRewards({ staker, periodsToClaim: 10, startPeriod: 3, periods: 2, amount: "35100000000000000000000000" });
    });

    describe('Unstake the 2nd NFT and claim all the periods at start of period 8', function () {
        shouldTimeWarpBy({ periods: 3 }, { period: 8 });
        shouldUnstakeNft({ staker, tokenId: TokenIds[0] });
        shouldClaimRewards({ staker, periodsToClaim: 10, startPeriod: 5, periods: 3, amount: "45150000000000000000000000" });
    });

    describe('Stake the 2nd NFT start of period 12', function () {
        shouldTimeWarpBy({ periods: 4 }, { period: 12 });
        shouldStakeNft({ staker, tokenId: TokenIds[0] });
    });

    describe('Estimate start of period 14', function () {
        shouldTimeWarpBy({ periods: 2 }, { period: 14 });
        shouldEstimateRewards({ staker, periodsToClaim: 99, startPeriod: 8, periods: 6, amount: "25550000000000000000000000" });
    });
}

module.exports = {
    restakeScenario
}