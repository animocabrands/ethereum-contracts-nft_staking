const { BN } = require('@openzeppelin/test-helpers');

/**
 * Calculates the total rewards pool based for a staking schedule.
 * @param {Array} schedule an array of objects as follow: { startPeriod: number, endPeriod: Number, payoutPerCycle: String }
 * @param {BN} periodLengthInCycles the number of cycles in a period
 */
function rewardsPoolFromSchedule(schedule, periodLengthInCycles) {
    return schedule.reduce(
        ((total, schedule) => {
            return total.add(
                new BN(schedule.payoutPerCycle)
                .mul(new BN(periodLengthInCycles))
                .mul(new BN(schedule.endPeriod - schedule.startPeriod + 1))
            )
        }),
        new BN(0)
    );
}

module.exports = {
    rewardsPoolFromSchedule
}