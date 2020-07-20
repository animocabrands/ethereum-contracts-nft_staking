const {
    shouldBatchStakeNfts,
    shouldTimeWarpBy,
    shouldEstimateRewards,
    shouldHaveNextClaim,
    initialiseDebug,
} = require('../behaviors');

const {TokenIds} = require('../constants');

const batchStakeScenario = function (staker) {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe('when staking a batch of NFTs', function () {
        shouldHaveNextClaim(staker, {period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldBatchStakeNfts(staker, TokenIds, {from: staker});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
    });

    describe('Estimate after warping 1 period', function () {
        shouldTimeWarpBy({periods: 1}, {cycle: 8});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 1, amount: '7000'});
    });
};

module.exports = {
    batchStakeScenario,
};
