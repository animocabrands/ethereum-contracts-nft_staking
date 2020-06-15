const { preconditionsScenario } = require('./Preconditions.scenario');
const { simpleScenario } = require('./Simple.scenario');
const { lateClaimScenario } = require('./LateClaim.scenario');
const { periodLimitsScenario } = require('./PeriodLimits.scenario');
const { multiStakersScenario } = require('./MultiStakers.scenario');
const { gasHeavyScenario } = require('./GasHeavy.scenario');

module.exports = {
    preconditionsScenario,
    simpleScenario,
    lateClaimScenario,
    periodLimitsScenario,
    multiStakersScenario,
    gasHeavyScenario
}