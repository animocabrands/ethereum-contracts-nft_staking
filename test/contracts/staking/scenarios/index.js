const { preconditionsScenario } = require('./Preconditions.scenario');
const MultiNftStaking = require('./MultiNftStaking.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const MultiStakers = require('./MultiStakers.scenario');
const { gasHeavyScenario } = require('./GasHeavy.scenario');
const { restakeScenario } = require('./Restake.scenario');
const { nonWhitelistedNftContractScenario } = require('./NonWhitelistedNftContract.scenario');
const { batchStakeScenario } = require('./BatchStake.scenario');
const { earlyUnstakeScenario } = require('./EarlyUnstake.scenario');
const Claim = require('./Claim.scenario');
const InvalidNftOwner = require('./InvalidNftOwner.scenario');
const RewardsScheduleScenario = require('./RewardsSchedule.scenario');

module.exports = {
    preconditionsScenario,
    ...MultiNftStaking,
    periodLimitsScenario,
    ...MultiStakers,
    gasHeavyScenario,
    restakeScenario,
    nonWhitelistedNftContractScenario,
    batchStakeScenario,
    earlyUnstakeScenario,
    ...Claim,
    ...InvalidNftOwner,
    ...RewardsScheduleScenario
}
