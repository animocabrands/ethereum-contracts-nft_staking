const { accounts, contract } = require('@openzeppelin/test-environment');
const { shouldSupportInterfaces } = require('@animoca/ethereum-contracts-core_library');
const { interfaces } = require('@animoca/ethereum-contracts-assets_inventory');

const { MigrationRewardSchedule, FlatRewardSchedule } = require('./constants');
const { deploy, start } = require('./setup');

const {
    preconditionsScenario, multiNftStakingScenario, lateClaimScenario, periodLimitsScenario,
    multiStakersScenario, gasHeavyScenario, restakeScenario, nonWhitelistedNftContractScenario,
    batchStakeScenario
} = require('./scenarios');

describe.only('NftStaking', function () {
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

    describe('Scenario: Multi NFT Staking', function () {
        before(deploy);
        before(start);

        multiNftStakingScenario(staker);
    });

    describe('Scenario: Period Limits', function () {
        before(deploy);
        before(start);

        periodLimitsScenario(staker, otherStaker);
    });

    describe('Scenario: Late Claim', function () {
        before(deploy);
        before(start);

        lateClaimScenario(staker);
    });

    describe('Scenario: Multi Stakers', function () {
        before(deploy);
        before(start);

        multiStakersScenario(creator, staker, otherStaker);
    });

    describe('Scenario: Gas Heavy', function () {
        before(deploy);
        before(function () { return start.bind(this)(FlatRewardSchedule) });

        gasHeavyScenario(creator, staker, otherStaker, anotherStaker);
    });

    describe('Scenario: Restake', function () {
        before(deploy);
        before(function () { return start.bind(this)(MigrationRewardSchedule) });

        restakeScenario(staker, otherStaker);
    });

    describe('Scenario: Non-Whitelisted NFT Contract', function () {
        before(deploy);
        before(start);

        nonWhitelistedNftContractScenario(creator, staker);
    });

    describe('Scenario: Batch Stake', function () {
        before(deploy);
        before(start);

        batchStakeScenario(staker);
    });

    describe("Interface support", function () {
        before(deploy);
        shouldSupportInterfaces([
            interfaces.ERC1155TokenReceiver
        ]);
    });
});
