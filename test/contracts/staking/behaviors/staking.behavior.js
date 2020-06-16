const { BN, expectRevert, expectEvent } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');

const shouldSetNextClaimIfUnset = async function (staker, stateBefore, stateAfter) {
    if (stateBefore.lastGlobalSnapshotIndex.eq(new BN('-1'))) {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.period.should.be.bignumber.equal(new BN(this.period));
        nextClaim.stakerSnapshotIndex.should.be.bignumber.equal(new BN(0));
        nextClaim.globalSnapshotIndex.should.be.bignumber.equal(stateAfter.lastGlobalSnapshotIndex);
    }
}

const shouldUpdateHistory = async function (receipt, eventName, staker, tokenId, stateBefore, stateAfter) {

    if (stateBefore.lastGlobalSnapshot.startCycle.eq(new BN(this.cycle))) {
        stateAfter.lastGlobalSnapshotIndex.should.be.bignumber.equal(stateBefore.lastGlobalSnapshotIndex); // no new snapshot
    } else {
        stateAfter.lastGlobalSnapshotIndex.should.be.bignumber.equal(stateBefore.lastGlobalSnapshotIndex.add(new BN(1))); // new snapshot
    }

    if (stateBefore.lastStakerSnapshot.startCycle.eq(new BN(this.cycle))) {
        stateAfter.lastStakerSnapshotIndex.should.be.bignumber.equal(stateBefore.lastStakerSnapshotIndex); // no new snapshot
    } else {
        stateAfter.lastStakerSnapshotIndex.should.be.bignumber.equal(stateBefore.lastStakerSnapshotIndex.add(new BN(1))); // new snapshot
    }

    let newGlobalStake;
    let newStakerStake;
    if (eventName == 'NftStaked') {
        newGlobalStake = stateBefore.lastGlobalSnapshot.stake.add(stateAfter.tokenInfo.weight);
        newStakerStake = stateBefore.lastStakerSnapshot.stake.add(stateAfter.tokenInfo.weight);
        stateBefore.tokenInfo.owner.should.equal(constants.ZeroAddress);
        stateAfter.tokenInfo.owner.should.equal(staker);
    } else if ('NftUnstaked') {
        newGlobalStake = stateBefore.lastGlobalSnapshot.stake.sub(stateAfter.tokenInfo.weight);
        newStakerStake = stateBefore.lastStakerSnapshot.stake.sub(stateAfter.tokenInfo.weight);
        stateBefore.tokenInfo.owner.should.equal(staker);
        stateAfter.tokenInfo.owner.should.equal(constants.ZeroAddress);
    }

    stateAfter.lastGlobalSnapshot.stake.should.be.bignumber.equal(newGlobalStake);
    stateAfter.lastStakerSnapshot.stake.should.be.bignumber.equal(newStakerStake);

    await expectEvent.inTransaction(
        receipt.tx,
        this.stakingContract,
        eventName,
        {
            staker,
            cycle: new BN(this.cycle),
            tokenId,
            weight: stateAfter.tokenInfo.weight
        });

    await expectEvent.inTransaction(
        receipt.tx,
        this.stakingContract,
        'HistoriesUpdated',
        {
            staker,
            startCycle: new BN(this.cycle),
            globalStake: newGlobalStake,
            stakerStake: newStakerStake,
        });
}

const retrieveStakingState = async function (staker, tokenId) {

    const state = {};
    try {
        state.lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
        state.lastGlobalSnapshot = await this.stakingContract.globalHistory(state.lastGlobalSnapshotIndex);
    } catch (e) {
        state.lastGlobalSnapshotIndex = new BN('-1');
        state.lastGlobalSnapshot = { startCycle: new BN(0), stake: new BN(0) };
    }

    try {
        state.lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
        state.lastStakerSnapshot = await this.stakingContract.stakerHistories(staker, state.lastStakerSnapshotIndex);
    } catch (e) {
        state.lastStakerSnapshotIndex = new BN('-1');
        state.lastStakerSnapshot = { startCycle: new BN(0), stake: new BN(0) };
    }

    state.tokenInfo = await this.stakingContract.tokenInfos(tokenId);
    state.nextClaim = await this.stakingContract.nextClaims(staker);

    return state;
}

const shouldRevertAndNotStakeNft = function (staker, tokenId, error) {
    it(`[STAKE] revert and not stake ${tokenId} by ${staker}`, async function () {
        await expectRevert(
            this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: staker }),
            error
        );
    });
}

const shouldRevertAndNotUnstakeNft = function (staker, tokenId, error) {
    it(`[UNSTAKE] revert and not unstake ${tokenId} by ${staker}`, async function () {
        await expectRevert(
            this.stakingContract.unstakeNft(tokenId, { from: staker }),
            error
        );
    });
}

const shouldStakeNft = function (staker, tokenId) {
    it(`[STAKE] ${tokenId} by ${staker}`, async function () {

        const stateBefore = await retrieveStakingState.bind(this)(staker, tokenId);
        const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: staker });
        const stateAfter = await retrieveStakingState.bind(this)(staker, tokenId);

        await shouldUpdateHistory.bind(this)(receipt, 'NftStaked', staker, tokenId, stateBefore, stateAfter);
        await shouldSetNextClaimIfUnset.bind(this)(stateBefore, stateAfter);
    });
}

const shouldUnstakeNft = function (staker, tokenId) {
    it(`[UNSTAKE] ${tokenId} by ${staker}`, async function () {

        const stateBefore = await retrieveStakingState.bind(this)(staker, tokenId);
        const receipt = await this.stakingContract.unstakeNft(tokenId, { from: staker });
        const stateAfter = await retrieveStakingState.bind(this)(staker, tokenId);

        await shouldUpdateHistory.bind(this)(receipt, 'NftUnstaked', staker, tokenId, stateBefore, stateAfter);
    });
}

module.exports = {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft
}