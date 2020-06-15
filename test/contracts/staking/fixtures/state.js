const { BN, expectRevert } = require('@openzeppelin/test-helpers');

const shouldHaveNextClaim = function(staker, period, globalHistoryIndex, stakerHistoryIndex) {
    it(`should have nextClaim.period=${period}`, async function () {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.period.toNumber().should.equal(period);
    });
    it(`should have nextClaim.globalHistoryIndex=${globalHistoryIndex}`, async function () {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.globalHistoryIndex.toNumber().should.equal(globalHistoryIndex);
    });
    it(`should have nextClaim.stakerHistoryIndex=${stakerHistoryIndex}`, async function () {
        const nextClaim = await this.stakingContract.nextClaims(staker);
        nextClaim.stakerHistoryIndex.toNumber().should.equal(stakerHistoryIndex);
    });
}

const shouldHaveCurrentCycleAndPeriod = function(cycle, period) {
    it(`should currently have: cycle=${cycle}, period=${period}`, async function () {
        const currentCycle = await this.stakingContract.getCurrentCycle();
        currentCycle.toNumber().should.equal(cycle);
        const currentPeriod = await this.stakingContract.getCurrentPeriod();
        currentPeriod.toNumber().should.equal(period);
    })
}

const shouldHaveGlobalHistoryLength = function(count) {
    it(`should have global history length: ${count}`, async function () {
        if (count == 0) {
            await expectRevert(
                this.stakingContract.lastGlobalSnapshotIndex(),
                "NftStaking: empty global history"
            );
        } else {
            const historyLength = (await this.stakingContract.lastGlobalSnapshotIndex()).add(new BN('1'));
            historyLength.toNumber().should.equal(count);
        }
    });
}

const shouldHaveStakerHistoryLength = function(staker, count) {
    it(`should have staker history length: ${count}`, async function () {
        if (count == 0) {
            await expectRevert(
                this.stakingContract.lastStakerSnapshotIndex(staker),
                "NftStaking: empty staker history"
            );
        } else {
            const historyLength = (await this.stakingContract.lastStakerSnapshotIndex(staker)).add(new BN('1'));
            historyLength.toNumber().should.equal(count);
        }
    });
}

const shouldHaveLastGlobalSnapshot = function(startCycle, stake, index) {
    it(`should have the lastGlobalSnapshot at index=${index}`, async function () {
        (await this.stakingContract.lastGlobalSnapshotIndex()).should.be.bignumber.equal(new BN(index));
    });

    it(`should have lastGlobalSnapshot.startCycle=${startCycle}`, async function () {
        (await this.stakingContract.globalHistory(index)).startCycle.should.be.bignumber.equal(new BN(startCycle));
    });

    it(`should have lastGlobalSnapshot.stake=${stake}`, async function () {
        (await this.stakingContract.globalHistory(index)).stake.should.be.bignumber.equal(new BN(stake));
    });
}

const shouldHaveLastStakerSnapshot = function(staker, startCycle, stake, index) {
    it(`should have the lastStakerSnapshot at index=${index}`, async function () {
        (await this.stakingContract.lastStakerSnapshotIndex(staker)).should.be.bignumber.equal(new BN(index));
    });

    it(`should have lastStakerSnapshot.startCycle=${startCycle}`, async function () {
        (await this.stakingContract.stakerHistories(staker, index)).startCycle.should.be.bignumber.equal(new BN(startCycle));
    });

    it(`should have lastStakerSnapshot.stake=${stake}`, async function () {
        (await this.stakingContract.stakerHistories(staker, index)).stake.should.be.bignumber.equal(new BN(stake));
    });
}

module.exports = {
    shouldHaveNextClaim,
    shouldHaveCurrentCycleAndPeriod,
    shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength,
    shouldHaveLastGlobalSnapshot,
    shouldHaveLastStakerSnapshot,
}