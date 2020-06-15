const { deploymentPreconditionsScenario } = require('./DeploymentPreconditions.scenario');
const { simpleScenario } = require('./Simple.scenario');
const { lateClaimScenario } = require('./LateClaim.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const { multiStakersScenario } = require('./MultiStakers.scenario');
const { gasHeavyScenario } = require('./GasHeavy.scenario');

module.exports = {
    deploymentPreconditionsScenario,
    simpleScenario,
    lateClaimScenario,
    periodLimitsScenario,
    multiStakersScenario,
    gasHeavyScenario
}