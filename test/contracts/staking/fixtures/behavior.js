const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');

const {} = require('./state');

const shouldRevertAndNotStakeNft = function(params) {
    it(`[STAKE \u274C] revert and not stake ${params.tokenId} by ${params.staker}`, async function () {
        const promise = this.nftContract.transferFrom(params.staker, this.stakingContract.address, params.tokenId, { from: params.staker });

        if (params.expectedError) {
            await expectRevert(promise, params.expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldRevertAndNotUnstakeNft = function(params) {
    it(`[UNSTAKE \u274C] revert and not unstake ${params.tokenId} by ${params.staker}`, async function () {
        const promise = this.stakingContract.unstakeNft(params.tokenId, { from: params.staker });

        if (params.expectedError) {
            await expectRevert(promise, params.expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldStakeNft = function(params) {
    it(`[STAKE \u2705] ${params.tokenId} by ${params.staker}`, async function () {

        let stateBefore = {};
        try {
            stateBefore.lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
            stateBefore.lastGlobalSnapshot = await this.stakingContract.globalHistory(stateBefore.lastGlobalSnapshotIndex);
        } catch(e) {
            stateBefore.lastGlobalSnapshotIndex = new BN('-1');
            stateBefore.lastGlobalSnapshot = {startCycle: new BN(0), stake: new BN(0)};
        }

        try {
            stateBefore.lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(params.staker);
            stateBefore.lastStakerSnapshot = await this.stakingContract.stakerHistories(params.staker, stateBefore.lastStakerSnapshotIndex);
        } catch(e) {
            stateBefore.lastStakerSnapshotIndex = new BN('-1');
            stateBefore.lastStakerSnapshot = {startCycle: new BN(0), stake: new BN(0)};
        }

        stateBefore.tokenInfo = await this.stakingContract.tokenInfos(params.tokenId);

        const receipt = await this.nftContract.transferFrom(
            params.staker,
            this.stakingContract.address,
            params.tokenId,
            { from: params.staker }
        );

        await shouldUpdateHistory.bind(this, receipt, 'NftStaked', params, stateBefore);
    });
}

const shouldUnstakeNft = function(params) {
    it(`[UNSTAKE \u2705] ${params.tokenId} by ${params.staker}`, async function () {
        let stateBefore = {};
        try {
            stateBefore.lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
            stateBefore.lastGlobalSnapshot = await this.stakingContract.globalHistory(stateBefore.lastGlobalSnapshotIndex);
        } catch(e) {
            stateBefore.lastGlobalSnapshotIndex = new BN('-1');
            stateBefore.lastGlobalSnapshot = {startCycle: new BN(0), stake: new BN(0)};
        }

        try {
            stateBefore.lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(params.staker);
            stateBefore.lastStakerSnapshot = await this.stakingContract.stakerHistories(params.staker, stateBefore.lastStakerSnapshotIndex);
        } catch(e) {
            stateBefore.lastStakerSnapshotIndex = new BN('-1');
            stateBefore.lastStakerSnapshot = {startCycle: new BN(0), stake: new BN(0)};
        }

        stateBefore.tokenInfo = await this.stakingContract.tokenInfos(params.tokenId);

        const receipt = await this.stakingContract.unstakeNft(
            params.tokenId,
            { from: params.staker }
        );

        await shouldUpdateHistory.bind(this, receipt, 'NftUnstaked', params, stateBefore);
    });
}

const shouldUpdateHistory = async function(receipt, eventName, params, stateBefore) {

    let stateAfter = {};
    stateAfter.lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
    stateAfter.lastGlobalSnapshot = await this.stakingContract.globalHistory(lastGlobalSnapshotIndexAfter);
    stateAfter.lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(params.staker);
    stateAfter.lastStakerSnapshot = await this.stakingContract.stakerHistories(params.staker, lastStakerSnapshotIndexAfter);
    stateAfter.tokenInfo = await this.stakingContract.tokenInfos(params.tokenId);

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
    } else if ('NftUnstaked') {
        newGlobalStake = stateBefore.lastGlobalSnapshot.stake.sub(stateAfter.tokenInfo.weight);
        newStakerStake = stateBefore.lastStakerSnapshot.stake.sub(stateAfter.tokenInfo.weight);
    }

    stateAfter.lastGlobalSnapshot.stake.should.be.bignumber.equal(newGlobalStake);
    stateAfter.lastStakerSnapshot.stake.should.be.bignumber.equal(newStakerStake);

    stateBefore.tokenInfo.owner.should.equal(constants.ZeroAddress);
    stateAfter.tokenInfo.owner.should.equal(params.staker);

    await expectEvent.inTransaction(
        receipt.tx,
        this.stakingContract,
        eventName,
        {
            staker: params.staker,
            cycle: new BN(this.cycle),
            tokenId: params.tokenId,
            weight: stateAfter.tokenInfo.weight
        });

    await expectEvent.inTransaction(
        receipt.tx,
        this.stakingContract,
        'HistoryUpdated',
        {
            staker: params.staker,
            startCycle: new BN(this.cycle),
            globalStake: newGlobalStake,
            stakerStake: newStakerStake,
        });
}


const shouldEstimateRewards = function(params) {
    it(`[ESTIMATE \u2705] ${params.amount} tokens over ${params.periods} ` +`periods (max=${params.periodsToClaim}) starting at ${params.startPeriod}, by ${params.staker}`, async function () {
        const result = await this.stakingContract.estimateRewards(params.periodsToClaim, { from: params.staker });
        result.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        result.periods.should.be.bignumber.equal(new BN(params.periods));
        result.amount.should.be.bignumber.equal(new BN(params.amount));
    });
}

const shouldClaimRewards = function(params) {
    it(`[CLAIM \u2705] ${params.amount} tokens over ${params.periods} periods (max=${params.periodsToClaim}) starting at ${params.startPeriod}, by ${params.staker}`, async function () {
        const stakerBalanceBefore = await this.rewardsToken.balanceOf(params.staker);
        const contractBalanceBefore = await this.rewardsToken.balanceOf(this.stakingContract.address);
        const nextClaimBefore = await this.stakingContract.nextClaims(params.staker);
        nextClaimBefore.period.should.be.bignumber.equal(new BN(params.startPeriod));

        const estimate = await this.stakingContract.estimateRewards(params.periodsToClaim, { from: params.staker });
        estimate.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        estimate.periods.should.be.bignumber.at.most(new BN(params.periods));
        estimate.amount.should.be.bignumber.equal(new BN(params.amount));

        const receipt = await this.stakingContract.claimRewards(params.periodsToClaim, { from: params.staker });

        const stakerBalanceAfter = await this.rewardsToken.balanceOf(params.staker);
        const contractBalanceAfter = await this.rewardsToken.balanceOf(this.stakingContract.address);
        const nextClaimAfter = await this.stakingContract.nextClaims(params.staker);

        stakerBalanceAfter.sub(stakerBalanceBefore).should.be.bignumber.equal(new BN(params.amount));
        contractBalanceBefore.sub(contractBalanceAfter).should.be.bignumber.equal(new BN(params.amount));
        if (nextClaimAfter.period.toNumber() != 0) {
            nextClaimBefore.period.add(estimate.periods).should.be.bignumber.equal(nextClaimAfter.period);
        }

        if (estimate.periods > 0) {
            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: params.staker,
                    startPeriod: new BN(params.startPeriod),
                    periods: new BN(params.periods),
                    amount: new BN(params.amount)
                });
        } else {
            await expectEvent.not.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: params.staker
                });
        }
    });
}

module.exports = {
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    shouldStakeNft,
    shouldUnstakeNft,
    shouldEstimateRewards,
    shouldClaimRewards,
}