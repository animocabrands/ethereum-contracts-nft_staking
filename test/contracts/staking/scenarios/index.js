const { deploymentPreconditionsScenario } = require('./DeploymentPreconditions.scenario');
const { simpleScenario } = require('./Simple.scenario');
const { lateClaimScenario } = require('./LateClaim.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const { multiStakersScenario } = require('./MultiStakers.scenario');

module.exports = {
    deploymentPreconditionsScenario,
    simpleScenario,
    lateClaimScenario,
    periodLimitsScenario,
    multiStakersScenario
}