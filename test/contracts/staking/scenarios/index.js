const { preconditionsScenario } = require('./Preconditions.scenario');
const MultiNftStaking = require('./MultiNftStaking.scenario');
const { lateClaimScenario } = require('./LateClaim.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const MultiStakers = require('./MultiStakers.scenario');
const { gasHeavyScenario } = require('./GasHeavy.scenario');
const { restakeScenario } = require('./Restake.scenario');
const { nonWhitelistedNftContractScenario } = require('./NonWhitelistedNftContract.scenario');
const { batchStakeScenario } = require('./BatchStake.scenario');
const { earlyUnstakeScenario } = require('./EarlyUnstake.scenario');

module.exports = {
    preconditionsScenario,
    ...MultiNftStaking,
    lateClaimScenario,
    periodLimitsScenario,
    ...MultiStakers,
    gasHeavyScenario,
    restakeScenario,
    nonWhitelistedNftContractScenario,
    batchStakeScenario,
    earlyUnstakeScenario
}
