// const { BN } = require('@openzeppelin/test-helpers');
const { time } = require('@openzeppelin/test-helpers');


const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

async function shouldTimeWarpBy(input, expectedOutput = {}) {

    it(`warps by ${input.periods} periods & ${input.cycles} cycles to target: cycle=${input.cycle} period=${input.period}`, async function () {
        let timeDelta = 0;
        if (input.periods) {
            timeDelta += input.periods * PeriodLengthInSeconds;
        }
        if (input.cycles) {
            timeDelta += input.cycles * CycleLengthInSeconds;
        }

        await time.increase(timeDelta);

        const currentCycle = await this.stakingContract.getCurrentCycle();
        const currentPeriod = await this.stakingContract.getCurrentPeriod();

        if (expectedOutput.cycle) {
            currentCycle.toNumber().should.equal(expectedOutput.cycle);
        }

        if (expectedOutput.period) {
            currentPeriod.toNumber().should.equal(expectedOutput.period);
        }

        this.cycle = currentCycle;
        this.period = currentPeriod;
    });
}

module.exports = {
    shouldTimeWarpBy
}