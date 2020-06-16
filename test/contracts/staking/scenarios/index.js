const { preconditionsScenario } = require('./Preconditions.scenario');
const { simpleScenario } = require('./Simple.scenario');
const { lateClaimScenario } = require('./LateClaim.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const { multiStakersScenario } = require('./MultiStakers.scenario');
const { gasHeavyScenario } = require('./GasHeavy.scenario');
const { restakeScenario } = require('./Restake.scenario');
const { nonWhitelistedNftContractScenario } = require('./NonWhitelistedNftContract.scenario');
const { batchStakeScenario } = require('./BatchStake.scenario');

module.exports = {
    preconditionsScenario,
    simpleScenario,
    lateClaimScenario,
    periodLimitsScenario,
    multiStakersScenario,
    gasHeavyScenario,
    restakeScenario,
    nonWhitelistedNftContractScenario,
    batchStakeScenario
}
