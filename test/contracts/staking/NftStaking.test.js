const { accounts, contract } = require('@openzeppelin/test-environment');
const { shouldSupportInterfaces } = require('@animoca/ethereum-contracts-core_library').behaviors;
const { interfaces } = require('@animoca/ethereum-contracts-assets_inventory');

const { MigrationRewardSchedule, FlatRewardSchedule } = require('./constants');
const { deploy, start } = require('./init');

const {
    preconditionsScenario, multiNftStakingScenario, multiNftStakingSinglePeriodScenario,
    multiNftStakingMultiPeriodScenario, periodLimitsScenario,
    multiStakersScenario, multiStakersSinglePeriodScenario, multiStakersMultiPeriodScenario,
    gasHeavyScenario, restakeScenario, nonWhitelistedNftContractScenario,
    batchStakeScenario, earlyUnstakeScenario, claimScenario, invalidNftOwnerScenario,
    rewardsScheduleScenario
} = require('./scenarios');

describe('NftStaking', function () {
    const [
        creator,
        staker,
        otherStaker,
        anotherStaker,
        ...otherAccounts
    ] = accounts;

    describe('Preconditions', function () {
        before(deploy);
        before(start);

        preconditionsScenario(staker);
    });

    describe('[[Scenario]] Multi NFT Staking', function () {
        before(deploy);
        before(start);

        multiNftStakingScenario(staker);
    });

    describe('[[Scenario]] Multi NFT Staking (single period)', function () {
        before(deploy);
        before(start);

        multiNftStakingSinglePeriodScenario(staker);
    });

    describe('[[Scenario]] Multi NFT Staking (multi period)', function () {
        before(deploy);
        before(start);

        multiNftStakingMultiPeriodScenario(staker);
    });

    describe('[[Scenario]] Period Limits', function () {
        before(deploy);
        before(start);

        periodLimitsScenario(staker, otherStaker);
    });

    describe('[[Scenario]] Multi Stakers', function () {
        before(deploy);
        before(start);

        multiStakersScenario(creator, staker, otherStaker);
    });

    describe('[[Scenario]] Multi Stakers (single period)', function () {
        before(deploy);
        before(start);

        multiStakersSinglePeriodScenario(creator, staker, otherStaker);
    });

    describe('[[Scenario]] Multi Stakers (multi period)', function () {
        before(deploy);
        before(start);

        multiStakersMultiPeriodScenario(creator, staker, otherStaker);
    });

    describe('[[Scenario]] Gas Heavy', function () {
        before(deploy);
        before(function () { return start.bind(this)(FlatRewardSchedule) });

        gasHeavyScenario(creator, staker, otherStaker, anotherStaker);
    });

    describe('[[Scenario]] Restake', function () {
        before(deploy);
        before(function () { return start.bind(this)(MigrationRewardSchedule) });

        restakeScenario(staker, otherStaker);
    });

    describe('[[Scenario]] Non-Whitelisted NFT Contract', function () {
        before(deploy);
        before(start);

        nonWhitelistedNftContractScenario(creator, staker);
    });

    describe('[[Scenario]] Batch Stake', function () {
        before(deploy);
        before(start);

        batchStakeScenario(staker);
    });

    describe('[[Scenario]] Early Unstake', function () {
        before(deploy);
        before(start);

        earlyUnstakeScenario(staker);
    });

    describe('[[Scenario]] Claim', function () {
        before(deploy);
        before(start);

        claimScenario(creator, staker, otherStaker, anotherStaker);
    });

    describe('[[Scenario]] Invalid NFT Owner', function () {
        before(deploy);
        before(start);

        invalidNftOwnerScenario(staker, otherStaker);
    });

    describe('[[Scenario]] Rewards Schedule', function () {
        before(deploy);
        before(start);

        rewardsScheduleScenario(creator, staker);
    });

    describe("Interface support", function () {
        before(deploy);
        shouldSupportInterfaces([
            interfaces.ERC1155TokenReceiver
        ]);
    });
});
