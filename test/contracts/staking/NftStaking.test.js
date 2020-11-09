const {shouldSupportInterfaces} = require('@animoca/ethereum-contracts-core_library').behaviors;
const {interfaces} = require('@animoca/ethereum-contracts-assets_inventory');

const {MigrationRewardSchedule, FlatRewardSchedule} = require('./constants');
const {deploy, start} = require('./init');

const {
    preconditionsScenario,
    multiNftStakingScenario,
    multiNftStakingSinglePeriodScenario,
    multiNftStakingMultiPeriodScenario,
    periodLimitsScenario,
    multiStakersScenario,
    multiStakersSinglePeriodScenario,
    multiStakersMultiPeriodScenario,
    gasHeavyScenario,
    restakeScenario,
    nonWhitelistedNftContractScenario,
    batchStakeScenario,
    batchUnstakeScenario,
    earlyUnstakeScenario,
    earlyRestakeScenario,
    claimScenario,
    invalidNftOwnerScenario,
    rewardsScheduleScenario,
    lostCyclesScenario,
} = require('./scenarios');

describe('NftStaking', function () {
    describe('Preconditions', function () {
        before(deploy);
        before(start);

        preconditionsScenario();
    });

    describe('[[Scenario]] Multi NFT Staking', function () {
        before(deploy);
        before(start);

        multiNftStakingScenario();
    });

    describe('[[Scenario]] Multi NFT Staking (single period)', function () {
        before(deploy);
        before(start);

        multiNftStakingSinglePeriodScenario();
    });

    describe('[[Scenario]] Multi NFT Staking (multi period)', function () {
        before(deploy);
        before(start);

        multiNftStakingMultiPeriodScenario();
    });

    describe('[[Scenario]] Period Limits', function () {
        before(deploy);
        before(start);

        periodLimitsScenario();
    });

    describe('[[Scenario]] Multi Stakers', function () {
        before(deploy);
        before(start);

        multiStakersScenario();
    });

    describe('[[Scenario]] Multi Stakers (single period)', function () {
        before(deploy);
        before(start);

        multiStakersSinglePeriodScenario();
    });

    describe('[[Scenario]] Multi Stakers (multi period)', function () {
        before(deploy);
        before(start);

        multiStakersMultiPeriodScenario();
    });

    describe('[[Scenario]] Gas Heavy', function () {
        before(deploy);
        before(function () {
            return start.bind(this)(FlatRewardSchedule);
        });

        gasHeavyScenario();
    });

    describe('[[Scenario]] Restake', function () {
        before(deploy);
        before(function () {
            return start.bind(this)(MigrationRewardSchedule);
        });

        restakeScenario();
    });

    describe('[[Scenario]] Non-Whitelisted NFT Contract', function () {
        before(deploy);
        before(start);

        nonWhitelistedNftContractScenario();
    });

    describe('[[Scenario]] Batch Stake', function () {
        before(deploy);
        before(start);

        batchStakeScenario();
    });

    describe('[[Scenario]] Batch Unstake', function () {
        before(deploy);
        before(start);

        batchUnstakeScenario();
    });

    describe('[[Scenario]] Early Unstake', function () {
        before(deploy);
        before(start);

        earlyUnstakeScenario();
    });

    describe('[[Scenario]] Early Re-stake', function () {
        before(deploy);
        before(start);

        earlyRestakeScenario();
    });

    describe('[[Scenario]] Early Re-stake', function () {
        before(deploy);
        before(start);

        earlyRestakeScenario(staker);
    });

    describe('[[Scenario]] Claim', function () {
        before(deploy);
        before(start);

        claimScenario();
    });

    describe('[[Scenario]] Invalid NFT Owner', function () {
        before(deploy);
        before(start);

        invalidNftOwnerScenario();
    });

    describe('[[Scenario]] RewardsSchedule (pre-start)', function () {
        before(deploy);

        rewardsScheduleScenario(false);
    });

    describe('[[Scenario]] Rewards Schedule (post-start)', function () {
        before(deploy);
        before(start);

        rewardsScheduleScenario(true);
    });

    describe('[[Scenario]] Lost cycles withdrawal', function () {
        before(deploy);
        before(start);

        lostCyclesScenario(true);
    });

    describe('Interface support', function () {
        before(deploy);
        shouldSupportInterfaces([interfaces.ERC1155TokenReceiver]);
    });
});
