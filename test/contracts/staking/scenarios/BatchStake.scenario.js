const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldBatchStakeNfts,
    shouldRevertAndNotBatchStakeNfts,
    shouldTimeWarpBy,
    shouldEstimateRewards,
    shouldHaveNextClaim,
    initialiseDebug,
    mintStakerTokens,
} = require('../behaviors');

const [creator, staker, otherStaker] = accounts;

const batchStakeScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker);
    });

    before(async function () {
        await mintStakerTokens.bind(this)(otherStaker);
    });

    describe('when staking a batch of NFTs', function () {
        shouldBatchStakeNfts(staker, [0, 1, 2, 3], {from: staker});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 0, amount: '0'});
        shouldHaveNextClaim(staker, {period: 1, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
    });

    describe('when staking an empty batch of NFTs', function () {
        shouldHaveNextClaim(otherStaker, {period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldRevertAndNotBatchStakeNfts(otherStaker, [], 'NftStaking: no tokens', {from: staker});
        // shouldEstimateRewards(otherStaker, 1, {startPeriod: 0, periods: 0, amount: '0'});
        // shouldHaveNextClaim(otherStaker, {period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
    });

    describe('when staking a batch of NFTs, where at least one is not owned by the staker', function () {
        shouldHaveNextClaim(otherStaker, {period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
        shouldRevertAndNotBatchStakeNfts(otherStaker, [0, 0], 'ERC1155: transfer of a non-owned NFT.', {
            1: {owner: otherStaker},
        });
        shouldEstimateRewards(otherStaker, 1, {startPeriod: 0, periods: 0, amount: '0'});
        shouldHaveNextClaim(otherStaker, {period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0});
    });

    describe('Estimate after warping 1 period', function () {
        shouldTimeWarpBy({periods: 1}, {cycle: 8});
        shouldEstimateRewards(staker, 1, {startPeriod: 1, periods: 1, amount: '7000'});
    });
};

module.exports = {
    batchStakeScenario,
};
