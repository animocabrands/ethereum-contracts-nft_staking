const {BN, expectRevert, expectEvent} = require('@openzeppelin/test-helpers');
const {constants} = require('@animoca/ethereum-contracts-core_library');

const {debugCurrentState} = require('./debug.behavior');

const shouldSetNextClaimIfUnset = async function (staker, stateBefore, stateAfter) {
    if (stateBefore.lastGlobalSnapshotIndex.eq(new BN('-1'))) {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.period.should.be.bignumber.equal(new BN(this.period));
        nextClaim.stakerSnapshotIndex.should.be.bignumber.equal(new BN(0));
        nextClaim.globalSnapshotIndex.should.be.bignumber.equal(stateAfter.lastGlobalSnapshotIndex);
    }
};

const shouldUpdateHistory = async function (receipt, eventName, staker, tokenIds, stateBefore, stateAfter) {
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
        if (eventName == 'NftStaked') {
            newGlobalStake = newGlobalStake.add(stateAfter.tokenInfos[index].weight);
            newStakerStake = newStakerStake.add(stateAfter.tokenInfos[index].weight);
            stateBefore.tokenInfos[index].owner.should.equal(constants.ZeroAddress);
            stateAfter.tokenInfos[index].owner.should.equal(staker);
        } else if ('NftUnstaked') {
            newGlobalStake = newGlobalStake.sub(stateAfter.tokenInfos[index].weight);
            newStakerStake = newStakerStake.sub(stateAfter.tokenInfos[index].weight);
            stateBefore.tokenInfos[index].owner.should.equal(staker);
            stateAfter.tokenInfos[index].owner.should.equal(constants.ZeroAddress);
        }
    }

    stateAfter.lastGlobalSnapshot.stake.should.be.bignumber.equal(newGlobalStake);
    stateAfter.lastStakerSnapshot.stake.should.be.bignumber.equal(newStakerStake);

    for (var index = 0; index < tokenIds.length; index++) {
        var tokenId = tokenIds[index];

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, eventName, {
            staker,
            cycle: new BN(this.cycle),
            tokenId,
            weight: stateAfter.tokenInfos[index].weight,
        });
    }

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

const shouldRevertAndNotStakeNft = function (staker, tokenId, error) {
    it(`[stakeNft] revert and not stake ${tokenId} by ${staker}`, async function () {
        await expectRevert(
            this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, {from: staker}),
            error
        );
    });
};

const shouldRevertAndNotUnstakeNft = function (staker, tokenId, error) {
    it(`[unstakeNft] revert and not unstake ${tokenId} by ${staker}`, async function () {
        await expectRevert(this.stakingContract.unstakeNft(tokenId, {from: staker}), error);
    });
};

const shouldRevertAndNotBatchStakeNfts = function (staker, tokenIds, error) {
    it(`[stakeNft] revert and not stake ${JSON.stringify(tokenIds)} by ${staker}`, async function () {
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

const shouldStakeNft = function (staker, tokenId) {
    it(`[stakeNft] ${tokenId} by ${staker}`, async function () {
        const stateBefore = await retrieveStakingState.bind(this)(staker, [tokenId]);
        const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, {
            from: staker,
        });
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, [tokenId]);

        await shouldUpdateHistory.bind(this)(receipt, 'NftStaked', staker, [tokenId], stateBefore, stateAfter);
        await shouldSetNextClaimIfUnset.bind(this)(stateBefore, stateAfter);
    });
};

const shouldUnstakeNft = function (staker, tokenId) {
    it(`[unstakeNft] ${tokenId} by ${staker}`, async function () {
        const stateBefore = await retrieveStakingState.bind(this)(staker, [tokenId]);
        const receipt = await this.stakingContract.unstakeNft(tokenId, {from: staker});
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveStakingState.bind(this)(staker, [tokenId]);

        await shouldUpdateHistory.bind(this)(receipt, 'NftUnstaked', staker, [tokenId], stateBefore, stateAfter);
    });
};

const shouldBatchStakeNfts = function (staker, tokenIds) {
    it(`[stakeNft] ${JSON.stringify(tokenIds)} by ${staker}`, async function () {
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

        await shouldUpdateHistory.bind(this)(receipt, 'NftStaked', staker, tokenIds, stateBefore, stateAfter);
        await shouldSetNextClaimIfUnset.bind(this)(stateBefore, stateAfter);
    });
};

module.exports = {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldBatchStakeNfts,
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    shouldRevertAndNotBatchStakeNfts,
};
