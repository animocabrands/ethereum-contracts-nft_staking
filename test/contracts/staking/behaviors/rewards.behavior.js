const {BN, expectRevert, expectEvent} = require('@openzeppelin/test-helpers');

const {PeriodLengthInCycles} = require('../constants');

const retrieveRewardsState = async function (startPeriod, endPeriod) {
    const rewardsSchedule = [];

    for (let period = startPeriod; period <= endPeriod; ++period) {
        const rewardsPerCycle = await this.stakingContract.rewardsSchedule(period);
        rewardsSchedule.push(rewardsPerCycle);
    }

    return {
        rewardsSchedule: rewardsSchedule,
        rewardsTokenBalance: await this.rewardsToken.balanceOf(this.stakingContract.address),
        totalRewardsPool: await this.stakingContract.totalRewardsPool(),
    };
};

const shouldAddRewardsForPeriods = function (owner, startPeriod, endPeriod, rewardsPerCycle) {
    it(`[addRewards] add ${rewardsPerCycle} rewards for period range [${startPeriod}, ${endPeriod}]`, async function () {
        const startPeriodBN = new BN(startPeriod);
        const endPeriodBN = new BN(endPeriod);
        const rewardsPerCycleBN = new BN(rewardsPerCycle);

        const stateBefore = await retrieveRewardsState.bind(this)(startPeriod, endPeriod);
        const receipt = await this.stakingContract.addRewardsForPeriods(startPeriod, endPeriod, rewardsPerCycle, {
            from: owner,
        });
        const stateAfter = await retrieveRewardsState.bind(this)(startPeriod, endPeriod);

        const numPeriods = endPeriod - startPeriod + 1;

        for (let index = 0; index < numPeriods; ++index) {
            stateBefore.rewardsSchedule[index]
                .add(rewardsPerCycleBN)
                .should.be.bignumber.equal(stateAfter.rewardsSchedule[index]);
        }

        const addedRewards = PeriodLengthInCycles.mul(endPeriodBN.sub(startPeriodBN).addn(1)).mul(rewardsPerCycleBN);

        stateBefore.rewardsTokenBalance.add(addedRewards).should.be.bignumber.equal(stateAfter.rewardsTokenBalance);
        stateBefore.totalRewardsPool.add(addedRewards).should.be.bignumber.equal(stateAfter.totalRewardsPool);

        await expectEvent.inTransaction(receipt.tx, this.stakingContract, 'RewardsAdded', {
            startPeriod: startPeriodBN,
            endPeriod: endPeriodBN,
            rewardsPerCycle: rewardsPerCycleBN,
        });
    });
};

const shouldRevertAndNotAddRewardsForPeriods = function (owner, startPeriod, endPeriod, rewardsPerCycle, error) {
    it(`[addRewards] revert and not add ${rewardsPerCycle} rewards for period range [${startPeriod}, ${endPeriod}]`, async function () {
        await expectRevert(
            this.stakingContract.addRewardsForPeriods(startPeriod, endPeriod, rewardsPerCycle, {from: owner}),
            error
        );
    });
};

const shouldWithdrawLostCycle = function (owner, cycle, globalSnapshotIndex, rewards) {
    it(`[withdrawLostCycle] withdraw ${rewards} for lost cycle ${cycle} in global snapshot at index ${globalSnapshotIndex}`, async function () {
        const receipt = await this.stakingContract.withdrawLostCycleRewards(owner, cycle, globalSnapshotIndex, {
            from: owner,
        });

        const withdrawn = await this.stakingContract.withdrawnLostCycles(cycle);
        withdrawn.should.be.true;

        await expectEvent.inTransaction(receipt.tx, this.rewardsToken, 'Transfer', {
            _from: this.stakingContract.address,
            _to: owner,
            _value: rewards,
        });
    });
};

const shouldRevertAndNotWithdrawLostCycle = function (owner, cycle, globalSnapshotIndex, error, options = {}) {
    it(`[withdrawLostCycle] revert and not withdraw rewards for lost cycle ${cycle} in global snapshot at index ${globalSnapshotIndex}`, async function () {
        await expectRevert(
            this.stakingContract.withdrawLostCycleRewards(owner, cycle, globalSnapshotIndex, {
                from: options.from || owner,
            }),
            error
        );
    });
};

module.exports = {
    shouldAddRewardsForPeriods,
    shouldRevertAndNotAddRewardsForPeriods,
    shouldWithdrawLostCycle,
    shouldRevertAndNotWithdrawLostCycle,
};
