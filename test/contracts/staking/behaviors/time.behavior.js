const { BN, time } = require('@openzeppelin/test-helpers');
const { CycleLengthInSeconds, PeriodLengthInSeconds } = require('../constants');

const shouldHaveCurrentCycleAndPeriod = function (cycle, period) {
    it(`should currently be at: cycle=${cycle}, period=${period}`, async function () {
        const currentCycle = await this.stakingContract.getCurrentCycle();
        currentCycle.toNumber().should.equal(cycle);
        const currentPeriod = await this.stakingContract.getCurrentPeriod();
        currentPeriod.toNumber().should.equal(period);

        this.cycle = currentCycle;
        this.period = currentPeriod;
    })
}

const shouldTimeWarpBy = async function (warp, expectedTime = {}) {

    warp.cycles = warp.cycles ? warp.cycles : 0;
    warp.periods = warp.periods ? warp.periods : 0;

    it(`warps by ${warp.periods} periods and ${warp.cycles} cycles`, async function () {
        const timeDelta = new BN(warp.periods * PeriodLengthInSeconds + warp.cycles * CycleLengthInSeconds);

        // const cycleBefore = await this.stakingContract.getCurrentCycle();
        // const periodBefore = await this.stakingContract.getCurrentPeriod();

        if (timeDelta.toNumber() > 0) {
            await time.increase(timeDelta);
        }

        const cycleAfter = await this.stakingContract.getCurrentCycle();
        const periodAfter = await this.stakingContract.getCurrentPeriod();

        if (expectedTime.cycle) {
            cycleAfter.should.be.bignumber.equal(new BN(expectedTime.cycle));
        }

        if (expectedTime.period) {
            periodAfter.should.be.bignumber.equal(new BN(expectedTime.period));
        }

        this.cycle = cycleAfter;
        this.period = periodAfter;
    });
}

module.exports = {
    shouldHaveCurrentCycleAndPeriod,
    shouldTimeWarpBy
}