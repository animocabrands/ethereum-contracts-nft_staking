const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldBatchStakeNfts,
    shouldBatchUnstakeNfts,
    shouldRevertAndNotBatchUnstakeNfts,
    shouldTimeWarpBy,
    shouldHaveLastStakerSnapshot,
    shouldHaveLastGlobalSnapshot,
    shouldHaveNextClaim,
    shouldEstimateRewards,
    initialiseDebug,
    // mintStakerTokens,
} = require('../behaviors');

const [creator, staker] = accounts;

const batchUnstakeScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe('when staking some NFTs immediately', function () {
        shouldBatchStakeNfts(staker, [0, 1], {from: staker});
        shouldHaveLastStakerSnapshot({staker: staker, index: 0, startCycle: 1, stake: 11});
        shouldHaveLastGlobalSnapshot({index: 0, startCycle: 1, stake: 11});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});

        describe('when batch unstaking NFTs', function () {
            context('when the NFT list is empty', function () {
                shouldRevertAndNotBatchUnstakeNfts(staker, [], 'NftStaking: no tokens', {from: staker});
            });

            context('when the NFT list is non-empty and the NFTs are all frozen', function () {
                shouldRevertAndNotBatchUnstakeNfts(staker, [0, 1], 'NftStaking: token still frozen.');
                shouldHaveLastStakerSnapshot({staker: staker, index: 0, startCycle: 1, stake: 11});
                shouldHaveLastGlobalSnapshot({index: 0, startCycle: 1, stake: 11});
                shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
                shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
            });
        });
    });

    describe('timewarp 2 cycles and stake some NFTs', function () {
        shouldTimeWarpBy({periods: 0, cycles: 2}, {period: 1, cycle: 3});
        shouldBatchStakeNfts(staker, [2, 3], {from: staker});
        shouldHaveLastStakerSnapshot({staker: staker, index: 1, startCycle: 3, stake: 611});
        shouldHaveLastGlobalSnapshot({index: 1, startCycle: 3, stake: 611});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});

        describe('when batch unstaking NFTs', function () {
            context('when all of the NFTs are frozen', function () {
                shouldRevertAndNotBatchUnstakeNfts(staker, [2, 3], 'NftStaking: token still frozen.');
                shouldHaveLastStakerSnapshot({staker: staker, index: 1, startCycle: 3, stake: 611});
                shouldHaveLastGlobalSnapshot({index: 1, startCycle: 3, stake: 611});
                shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
                shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
            });

            context('when some of the NFTs are frozen', function () {
                shouldRevertAndNotBatchUnstakeNfts(staker, [0, 2], 'NftStaking: token still frozen.');
                shouldHaveLastStakerSnapshot({staker: staker, index: 1, startCycle: 3, stake: 611});
                shouldHaveLastGlobalSnapshot({index: 1, startCycle: 3, stake: 611});
                shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
                shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
            });

            context('when none of the NFTs are frozen', function () {
                shouldBatchUnstakeNfts(staker, [0, 1]);
                shouldHaveLastStakerSnapshot({staker: staker, index: 1, startCycle: 3, stake: 600});
                shouldHaveLastGlobalSnapshot({index: 1, startCycle: 3, stake: 600});
                shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
                shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
            });
        });
    });

    describe('timewarp 2 cycles and batch unstaking NFTs', function () {
        shouldTimeWarpBy({periods: 0, cycles: 2}, {period: 1, cycle: 5});
        shouldBatchUnstakeNfts(staker, [2, 3]);
        shouldHaveLastStakerSnapshot({staker: staker, index: 2, startCycle: 5, stake: 0});
        shouldHaveLastGlobalSnapshot({index: 2, startCycle: 5, stake: 0});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
    });

    describe('timewarp 3 cycles', function () {
        shouldTimeWarpBy({periods: 0, cycles: 3}, {period: 2, cycle: 8});
        shouldHaveLastStakerSnapshot({staker: staker, index: 2, startCycle: 5, stake: 0});
        shouldHaveLastGlobalSnapshot({index: 2, startCycle: 5, stake: 0});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 1, amount: '4000'});
    });
};

module.exports = {
    batchUnstakeScenario,
};
