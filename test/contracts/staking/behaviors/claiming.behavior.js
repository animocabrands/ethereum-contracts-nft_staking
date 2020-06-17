const { BN, expectEvent } = require('@openzeppelin/test-helpers');

const { debugCurrentState } = require('./debug.behavior');
const { PeriodLengthInCycles } = require('../constants');

const retrieveClaimingState = async function (staker) {
    const state = {};
    state.stakerBalance = await this.rewardsToken.balanceOf(staker);
    state.contractBalance = await this.rewardsToken.balanceOf(this.stakingContract.address);
    state.nextClaim = await this.stakingContract.nextClaims(staker);
    return state;
}

const shouldUpdateClaimingStateAndDistributeRewards = async function (receipt, staker, params, stateBefore, estimate, stateAfter) {
    stateBefore.nextClaim.period.should.be.bignumber.equal(new BN(params.startPeriod));

    stateAfter.stakerBalance.sub(stateBefore.stakerBalance).should.be.bignumber.equal(new BN(params.amount));
    stateBefore.contractBalance.sub(stateAfter.contractBalance).should.be.bignumber.equal(new BN(params.amount));

    if (estimate.periods.toNumber() > 0) {
        estimate.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        estimate.periods.should.be.bignumber.at.most(new BN(params.periods));
        estimate.amount.should.be.bignumber.equal(new BN(params.amount));

        const lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
        const lastStakerSnapshot = await this.stakingContract.stakerHistories(staker, lastStakerSnapshotIndex);
        const lastClaimedCycle = estimate.startPeriod.add(estimate.periods).sub(new BN(1)).mul(PeriodLengthInCycles);

        if (
            lastClaimedCycle.gte(lastStakerSnapshot.startCycle) && // the claim overlaps with the last staker snapshot
            lastStakerSnapshot.stake.eq(new BN(0))                 // and nothing is staked in the last staker snapshot
        ) {
            stateAfter.nextClaim.period.should.be.bignumber.equal(new BN(0));
            stateAfter.nextClaim.globalSnapshotIndex.should.be.bignumber.equal(new BN(0));
            stateAfter.nextClaim.stakerSnapshotIndex.should.be.bignumber.equal(new BN(0));
        }

        if (stateAfter.nextClaim.period.toNumber() > 0) {
            stateAfter.nextClaim.period.should.be.bignumber.equal(estimate.startPeriod.add(estimate.periods));
        }

        await expectEvent.inTransaction(
            receipt.tx,
            this.stakingContract,
            'RewardsClaimed',
            {
                staker: staker,
                cycle: this.cycle,
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
                staker: staker
            });
    }
}

const shouldEstimateRewards = function (staker, maxPeriods, params) {
    it(`[ESTIMATE] ${params.amount} tokens over ${params.periods} ` + `periods (max=${maxPeriods}) starting at ${params.startPeriod}, by ${staker}`, async function () {
        const result = await this.stakingContract.estimateRewards(maxPeriods, { from: staker });
        result.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        result.periods.should.be.bignumber.equal(new BN(params.periods));
        result.amount.should.be.bignumber.equal(new BN(params.amount));
    });
}

const shouldClaimRewards = function (staker, maxPeriods, params) {
    it(`[CLAIM] ${params.amount} tokens over ${params.periods} periods (max=${maxPeriods}) starting at ${params.startPeriod}, by ${staker}`, async function () {

        const stateBefore = await retrieveClaimingState.bind(this)(staker);
        const estimate = await this.stakingContract.estimateRewards(maxPeriods, { from: staker });
        if (this.debug) await debugCurrentState.bind(this)();
        const receipt = await this.stakingContract.claimRewards(maxPeriods, { from: staker });
        const stateAfter = await retrieveClaimingState.bind(this)(staker);

        await shouldUpdateClaimingStateAndDistributeRewards.bind(this)(receipt, staker, params, stateBefore, estimate, stateAfter)
    });
}

module.exports = {
    shouldEstimateRewards,
    shouldClaimRewards
}