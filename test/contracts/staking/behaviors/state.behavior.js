const { BN, expectRevert } = require('@openzeppelin/test-helpers');

const shouldHaveNextClaim = function (staker, params) {
    it(`nextClaim for staker [${staker}] should have period=${params.period}, globalSnapshotIndex=${params.globalSnapshotIndex} and stakerSnapshotIndex=${params.stakerSnapshotIndex}`, async function () {
        this.nextClaim = await this.stakingContract.nextClaims(staker);
        this.nextClaim.period.toNumber().should.equal(params.period);
        this.nextClaim.globalSnapshotIndex.toNumber().should.equal(params.globalSnapshotIndex);
        this.nextClaim.stakerSnapshotIndex.toNumber().should.equal(params.stakerSnapshotIndex);
    });
}

const shouldHaveGlobalHistoryLength = function (count) {
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

const shouldHaveStakerHistoryLength = function (staker, count) {
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

const shouldHaveLastGlobalSnapshot = function (params) {
    it(`lastGlobalSnapshot at index=${params.index}`, async function () {
        (await this.stakingContract.lastGlobalSnapshotIndex()).should.be.bignumber.equal(new BN(params.index));
        this.lastGlobalSnapshot = await this.stakingContract.globalHistory(params.index);
    });

    it(`\tstartCycle=${params.startCycle}`, async function () {
        this.lastGlobalSnapshot.startCycle.should.be.bignumber.equal(new BN(params.startCycle));
    });

    it(`\tstake=${params.stake}`, async function () {
        this.lastGlobalSnapshot.stake.should.be.bignumber.equal(new BN(params.stake));
    });
}

const shouldHaveLastStakerSnapshot = function (params) {
    it(`lastStakerSnapshot at index=${params.index}`, async function () {
        (await this.stakingContract.lastStakerSnapshotIndex(params.staker)).should.be.bignumber.equal(new BN(params.index));
        this.lastStakerSnapshot = await this.stakingContract.stakerHistories(params.staker, params.index);
    });

    it(`\tstartCycle=${params.startCycle}`, async function () {
        this.lastStakerSnapshot.startCycle.should.be.bignumber.equal(new BN(params.startCycle));
    });

    it(`\tstake=${params.stake}`, async function () {
        this.lastStakerSnapshot.stake.should.be.bignumber.equal(new BN(params.stake));
    });
}

module.exports = {
    shouldHaveNextClaim,
    shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength,
    shouldHaveLastGlobalSnapshot,
    shouldHaveLastStakerSnapshot,
}