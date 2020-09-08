const {accounts} = require('@openzeppelin/test-environment');
const {BN, expectRevert, expectEvent} = require('@openzeppelin/test-helpers');
const {constants} = require('@animoca/ethereum-contracts-core_library');

const {debugCurrentState} = require('./debug.behavior');

const {RarityWeights} = require('../constants');
const TokenHelper = require('../../../utils/tokenHelper');

const [creator] = accounts;

const shouldSetNextClaimIfUnset = async function (staker, stateBefore, stateAfter) {
    if (stateBefore.lastGlobalSnapshotIndex.eq(new BN('-1'))) {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.period.should.be.bignumber.equal(new BN(this.period));
        nextClaim.stakerSnapshotIndex.should.be.bignumber.equal(new BN(0));
        nextClaim.globalSnapshotIndex.should.be.bignumber.equal(stateAfter.lastGlobalSnapshotIndex);
    }
};

const shouldUpdateHistory = async function (receipt, action, staker, tokenIds, stateBefore, stateAfter) {
    if (stateBefore.lastGlobalSnapshot.startCycle.eq(new BN(this.cycle))) {
        stateAfter.lastGlobalSnapshotIndex.should.be.bignumber.equal(stateBefore.lastGlobalSnapshotIndex); // no new snapshot
    } else {
        stateAfter.lastGlobalSnapshotIndex.should.be.bignumber.equal(
            stateBefore.lastGlobalSnapshotIndex.add(new BN(1))
        ); // new snapshot
    }

    if (stateBefore.lastStakerSnapshot.startCycle.eq(new BN(this.cycle))) {
        stateAfter.lastStakerSnapshotIndex.should.be.bignumber.equal(stateBefore.lastStakerSnapshotIndex); // no new snapshot
    } else {
        stateAfter.lastStakerSnapshotIndex.should.be.bignumber.equal(
            stateBefore.lastStakerSnapshotIndex.add(new BN(1))
        ); // new snapshot
    }

    let newGlobalStake = stateBefore.lastGlobalSnapshot.stake;
    let newStakerStake = stateBefore.lastStakerSnapshot.stake;

    for (var index = 0; index < tokenIds.length; index++) {
        if (action == 'stake') {
            newGlobalStake = newGlobalStake.add(stateAfter.tokenInfos[index].weight);
            newStakerStake = newStakerStake.add(stateAfter.tokenInfos[index].weight);
            stateBefore.tokenInfos[index].owner.should.equal(constants.ZeroAddress);
            stateAfter.tokenInfos[index].owner.should.equal(staker);
        } else if (action == 'unstake') {
            newGlobalStake = newGlobalStake.sub(stateAfter.tokenInfos[index].weight);
            newStakerStake = newStakerStake.sub(stateAfter.tokenInfos[index].weight);
            stateBefore.tokenInfos[index].owner.should.equal(staker);
            stateAfter.tokenInfos[index].owner.should.equal(constants.ZeroAddress);
        }
    }

    stateAfter.lastGlobalSnapshot.stake.should.be.bignumber.equal(newGlobalStake);
    stateAfter.lastStakerSnapshot.stake.should.be.bignumber.equal(newStakerStake);

    await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'HistoriesUpdated', {
        staker,
        startCycle: new BN(this.cycle),
        globalStake: newGlobalStake,
        stakerStake: newStakerStake,
    });
};

const retrieveStakingState = async function (staker, tokenIds) {
    const state = {};
    try {
        state.lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
        state.lastGlobalSnapshot = await this.stakingContract.globalHistory(state.lastGlobalSnapshotIndex);
    } catch (e) {
        state.lastGlobalSnapshotIndex = new BN('-1');
        state.lastGlobalSnapshot = {startCycle: new BN(0), stake: new BN(0)};
    }

    try {
        state.lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
        state.lastStakerSnapshot = await this.stakingContract.stakerHistories(staker, state.lastStakerSnapshotIndex);
    } catch (e) {
        state.lastStakerSnapshotIndex = new BN('-1');
        state.lastStakerSnapshot = {startCycle: new BN(0), stake: new BN(0)};
    }

    state.tokenInfos = [];

    for (var tokenId of tokenIds) {
        state.tokenInfos.push(await this.stakingContract.tokenInfos(tokenId));
    }

    state.nextClaim = await this.stakingContract.nextClaims(staker);

    return state;
};

const getTokenIds = async function (staker, tokens, options) {
    options = options || {}; // falsey initializes as empty options

    const numTokens = tokens.length;
    const tokenIds = [];

    for (let index = 0; index < numTokens; index++) {
        tokenIds.push(await getTokenId.bind(this)(staker, tokens[index], options[index]));
    }

    return tokenIds;
};

const getTokenId = async function (staker, token, options) {
    options = options || {}; // falsey initializes as empty options

    const owner = options.owner || staker;

    if (typeof token == 'number' || token instanceof Number) {
        return this.stakerTokens[owner][token];
    }

    if (typeof token == 'string' || token instanceof String) {
        if (options.minter) {
            await this.nftContract.mintNonFungible(owner, token, {from: minter});
        }

        return token;
    }
};

const shouldRevertAndNotStakeNft = function (staker, token, error, options = {}) {
    it('shouldRevertAndNotStakeNft', async function () {
        const tokenId = await getTokenId.bind(this)(staker, token, options);

        this.test.title = `[stakeNft] revert and not stake ${tokenId} by ${staker}`;

        await expectRevert(
            this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, {from: staker}),
            error
        );
    });
};

const shouldRevertAndNotUnstakeNft = function (staker, token, error, options = {}) {
    it('shouldRevertAndNotUnstakeNft', async function () {
        const tokenId = await getTokenId.bind(this)(staker, token, options);

        this.test.title = `[unstakeNft] revert and not unstake ${tokenId} by ${staker}`;

        await expectRevert(this.stakingContract.unstakeNft(tokenId, {from: staker}), error);
    });
};

const shouldRevertAndNotBatchStakeNfts = function (staker, tokens, error, options = {}) {
    it('shouldRevertAndNotBatchStakeNfts', async function () {
        const tokenIds = await getTokenIds.bind(this)(staker, tokens, options);

        this.test.title = `[stakeNft] revert and not batch stake ${JSON.stringify(tokenIds)} by ${staker}`;

        var data = constants.EmptyByte;
        var values = Array(tokenIds.length).fill(1);
        await expectRevert(
            this.nftContract.safeBatchTransferFrom(staker, this.stakingContract.address, tokenIds, values, data, {
                from: staker,
            }),
            error
        );
    });
};

const shouldRevertAndNotBatchUnstakeNfts = function (staker, tokens, error, options = {}) {
    it('shouldRevertAndNotBatchUnstakeNfts', async function () {
        const tokenIds = await getTokenIds.bind(this)(staker, tokens, options);
        this.test.title = `[unstakeNft] revert and not batch unstake ${JSON.stringify(tokenIds)} by ${staker}`;
        await expectRevert(this.stakingContract.batchUnstakeNfts(tokenIds, {from: staker}), error);
    });
};

const shouldStakeNft = function (staker, token, options = {}) {
    it('shouldStakeNft', async function () {
        const tokenId = await getTokenId.bind(this)(staker, token, options);

        this.test.title = `[stakeNft] ${tokenId} by ${staker}`;

        const stateBefore = await retrieveStakingState.bind(this)(staker, [tokenId]);
        const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, {
            from: staker,
        });
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, [tokenId]);

        await shouldUpdateHistory.bind(this)(receipt, 'stake', staker, [tokenId], stateBefore, stateAfter);
        await shouldSetNextClaimIfUnset.bind(this)(stateBefore, stateAfter);

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'NftStaked', {
            staker,
            cycle: new BN(this.cycle),
            tokenId,
            weight: stateAfter.tokenInfos[0].weight,
        });
    });
};

const shouldUnstakeNft = function (staker, token, options = {}) {
    it('shouldUnstakeNft', async function () {
        const tokenId = await getTokenId.bind(this)(staker, token, options);
        this.test.title = `[unstakeNft] ${tokenId} by ${staker}`;

        const stateBefore = await retrieveStakingState.bind(this)(staker, [tokenId]);
        const receipt = await this.stakingContract.unstakeNft(tokenId, {from: staker});
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, [tokenId]);

        await shouldUpdateHistory.bind(this)(receipt, 'unstake', staker, [tokenId], stateBefore, stateAfter);

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'NftUnstaked', {
            staker,
            cycle: new BN(this.cycle),
            tokenId,
            weight: stateAfter.tokenInfos[0].weight,
        });
    });
};

const shouldBatchStakeNfts = function (staker, tokens, options = {}) {
    it('shouldBatchStakeNfts', async function () {
        const tokenIds = await getTokenIds.bind(this)(staker, tokens, options);

        this.test.title = `[stakeNft] ${JSON.stringify(tokenIds)} by ${staker}`;

        var data = constants.EmptyByte;
        var values = Array(tokenIds.length).fill(1);

        const stateBefore = await retrieveStakingState.bind(this)(staker, tokenIds);
        const receipt = await this.nftContract.safeBatchTransferFrom(
            staker,
            this.stakingContract.address,
            tokenIds,
            values,
            data,
            {from: staker}
        );
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, tokenIds);

        await shouldUpdateHistory.bind(this)(receipt, 'stake', staker, tokenIds, stateBefore, stateAfter);
        await shouldSetNextClaimIfUnset.bind(this)(stateBefore, stateAfter);

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'NftsBatchStaked', {
            staker,
            cycle: new BN(this.cycle),
            tokenIds,
            weights: stateAfter.tokenInfos.map((t) => t.weight.toString()),
        });
    });
};

const shouldBatchUnstakeNfts = function (staker, tokens, options = {}) {
    it('shouldBatchUnstakeNfts', async function () {
        const tokenIds = await getTokenIds.bind(this)(staker, tokens, options);

        this.test.title = `[unstakeNft] ${JSON.stringify(tokenIds)} by ${staker}`;

        const stateBefore = await retrieveStakingState.bind(this)(staker, tokenIds);
        const receipt = await this.stakingContract.batchUnstakeNfts(tokenIds, {from: staker});
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, tokenIds);

        await shouldUpdateHistory.bind(this)(receipt, 'unstake', staker, tokenIds, stateBefore, stateAfter);

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'NftsBatchUnstaked', {
            staker,
            cycle: new BN(this.cycle),
            tokenIds,
            weights: stateAfter.tokenInfos.map((t) => t.weight.toString()),
        });
    });
};

const mintStakerTokens = async function (...stakers) {
    this.stakerTokens = this.stakerTokens || {};

    const stakerTokens = {};
    const rarities = RarityWeights.map((item) => item.rarity);

    for (const staker of stakers) {
        const tokens = [];

        for (const rarity of rarities) {
            const tokenId = TokenHelper.makeTokenId(rarity, TokenHelper.Types.Car);
            tokens.push(tokenId);
            await this.nftContract.mintNonFungible(staker, tokenId, {from: creator});
        }

        stakerTokens[staker] = tokens;
    }

    this.stakerTokens = Object.assign(this.stakerTokens, stakerTokens);
};

module.exports = {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldBatchStakeNfts,
    shouldBatchUnstakeNfts,
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    shouldRevertAndNotBatchStakeNfts,
    shouldRevertAndNotBatchUnstakeNfts,
    mintStakerTokens,
};
