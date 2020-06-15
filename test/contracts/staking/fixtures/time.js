// const { BN } = require('@openzeppelin/test-helpers');
const { time } = require('@openzeppelin/test-helpers');


const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

async function shouldWarpToTarget(params) {

    it(`warps by ${params.periods} periods & ${params.cycles} cycles to target: cycle=${params.targetCycle} period=${params.targetPeriod}`, async function () {
        const timeDelta =
            params.periods * PeriodLengthInSeconds
            +
            params.cycles * CycleLengthInSeconds;

        await time.increase(timeDelta);

        const currentCycle = await this.stakingContract.getCurrentCycle();
        const currentPeriod = await this.stakingContract.getCurrentPeriod();
        currentCycle.toNumber().should.equal(params.targetCycle);
        currentPeriod.toNumber().should.equal(params.targetPeriod);
    });
}

module.exports = {
    shouldWarpToTarget
}