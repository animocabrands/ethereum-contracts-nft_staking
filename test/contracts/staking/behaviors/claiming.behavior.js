const { toWei } = require('web3-utils');
const { BN, expectEvent } = require('@openzeppelin/test-helpers');

const { debugCurrentState } = require('./debug.behavior');
const { PeriodLengthInCycles } = require('../constants');

const assert = require('assert');

const AcceptedDeviationProportion = new BN('100000'); // 1/100,000th deviation => 0.0001%

const retrieveClaimingState = async function (staker) {
    const state = {};
    state.stakerBalance = await this.rewardsToken.balanceOf(staker);
    state.contractBalance = await this.rewardsToken.balanceOf(this.stakingContract.address);
    state.nextClaim = await this.stakingContract.nextClaims(staker);
    return state;
}

const shouldUpdateClaimingStateAndDistributeRewards = async function (receipt, staker, params, stateBefore, estimate, stateAfter) {
    stateBefore.nextClaim.period.should.be.bignumber.equal(new BN(params.startPeriod));

    const stakerBalanceDelta = stateAfter.stakerBalance.sub(stateBefore.stakerBalance);
    shouldBeEqualWithinDeviation(stakerBalanceDelta, new BN(params.amount));
    const contractBalanceDelta = stateBefore.contractBalance.sub(stateAfter.contractBalance);
    shouldBeEqualWithinDeviation(contractBalanceDelta, new BN(params.amount));

    if (estimate.periods.toNumber() > 0) {
        estimate.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        estimate.periods.should.be.bignumber.at.most(new BN(params.periods));
        shouldBeEqualWithinDeviation(estimate.amount, new BN(params.amount));

        let lastStakerSnapshotIndex;

        try {
            lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
        } catch (err) {
            return;
        }

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
                periods: new BN(params.periods)
            });

        const events = await this.stakingContract.getPastEvents(
            'RewardsClaimed',
            { fromBlock: 0, toBlock: 'latest' }
        );
        const claimEvent = events[0].args;
        shouldBeEqualWithinDeviation(new BN(params.amount), claimEvent.amount);

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

function shouldBeEqualWithinDeviation(actual, expected, proportion = AcceptedDeviationProportion) {
    if (expected.isZero()) {
        actual.should.be.bignumber.equal(new BN(0), `${actual} should be zero`);
    } else {
        const deviation = expected.sub(actual).abs();
        const divPrecision = (new BN(10)).pow(new BN(15));
        const maxDeviation = expected.mul(divPrecision).div(proportion).div(divPrecision);
        deviation.should.be.bignumber.lte(maxDeviation, `${actual} deviates too much from expected ${expected}`);
    }
}

const shouldEstimateRewards = function (staker, maxPeriods, params) {
    it(`[estimateRewards] ${params.amount} tokens over ${params.periods} ` + `periods (max=${maxPeriods}) starting at ${params.startPeriod}, by ${staker}`, async function () {
        params.amount = toWei(params.amount);
        const result = await this.stakingContract.estimateRewards(maxPeriods, { from: staker });
        result.startPeriod.should.be.bignumber.equal(new BN(params.startPeriod));
        result.periods.should.be.bignumber.equal(new BN(params.periods));
        shouldBeEqualWithinDeviation(result.amount, new BN(params.amount));
    });
}

const shouldClaimRewards = function (staker, maxPeriods, params) {
    it(`[claimRewards] ${params.amount} tokens over ${params.periods} periods (max=${maxPeriods}) starting at ${params.startPeriod}, by ${staker}`, async function () {
        params.amount = toWei(params.amount);
        const stateBefore = await retrieveClaimingState.bind(this)(staker);
        const estimate = await this.stakingContract.estimateRewards(maxPeriods, { from: staker });
        const receipt = await this.stakingContract.claimRewards(maxPeriods, { from: staker });
        if (this.debug) await debugCurrentState.bind(this)();
        const stateAfter = await retrieveClaimingState.bind(this)(staker);

        await shouldUpdateClaimingStateAndDistributeRewards.bind(this)(receipt, staker, params, stateBefore, estimate, stateAfter)
    });
}

module.exports = {
    shouldEstimateRewards,
    shouldClaimRewards
}
