const {preconditionsScenario} = require('./Preconditions.scenario');
const MultiNftStaking = require('./MultiNftStaking.scenario');
const {periodLimitsScenario} = require('./PeriodLimits.scenario');
const MultiStakers = require('./MultiStakers.scenario');
const {gasHeavyScenario} = require('./GasHeavy.scenario');
const {restakeScenario} = require('./Restake.scenario');
const {nonWhitelistedNftContractScenario} = require('./NonWhitelistedNftContract.scenario');
const {batchStakeScenario} = require('./BatchStake.scenario');
const {batchUnstakeScenario} = require('./BatchUnstake.scenario');
const {earlyUnstakeScenario} = require('./EarlyUnstake.scenario');
const {earlyRestakeScenario} = require('./EarlyRestake.scenario');
const Claim = require('./Claim.scenario');
const InvalidNftOwner = require('./InvalidNftOwner.scenario');
const RewardsScheduleScenario = require('./RewardsSchedule.scenario');
const {lostCyclesScenario} = require('./LostCycles.scenario');

module.exports = {
    preconditionsScenario,
    ...MultiNftStaking,
    periodLimitsScenario,
    ...MultiStakers,
    gasHeavyScenario,
    restakeScenario,
    nonWhitelistedNftContractScenario,
    batchStakeScenario,
    batchUnstakeScenario,
    earlyUnstakeScenario,
    earlyRestakeScenario,
    ...Claim,
    ...InvalidNftOwner,
    ...RewardsScheduleScenario,
    lostCyclesScenario,
};
