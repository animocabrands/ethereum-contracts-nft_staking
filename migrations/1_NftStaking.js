const { fromWei } = require('web3-utils');
const { DefaultNFMaskLength } = require('@animoca/ethereum-contracts-assets_inventory').constants;
const { DefaultCycleLengthInSeconds, DefaultPeriodLengthInCycles, ExamplePayoutSchedule, ExampleWeightsByRarity } = require('../src/constants');
const { rewardsPoolFromSchedule } = require('../src/utils');

const NftStaking = artifacts.require("NftStakingMock");
const AssetsInventory = artifacts.require("AssetsInventoryMock");
const ERC20 = artifacts.require("ERC20WithOperatorsMock");

const RewardsPool = rewardsPoolFromSchedule(ExamplePayoutSchedule, DefaultPeriodLengthInCycles);

module.exports = async (deployer, network, accounts) => {

    this.inventoryContract = await AssetsInventory.new(DefaultNFMaskLength);
    this.erc20Contract = await ERC20.new(RewardsPool);

    await deployer.deploy(NftStaking,
        DefaultCycleLengthInSeconds,
        DefaultPeriodLengthInCycles,
        this.inventoryContract.address,
        this.erc20Contract.address,
        Object.keys(ExampleWeightsByRarity),
        Object.values(ExampleWeightsByRarity),
    );

    this.stakingContract = await NftStaking.deployed();

    for (schedule of ExamplePayoutSchedule) {
        console.log(`Setting schedule: ${fromWei(schedule.payoutPerCycle)} ERC20s per-cycle for periods ${schedule.startPeriod} to ${schedule.endPeriod}`);
        await this.stakingContract.setRewardsForPeriods(
            schedule.startPeriod,
            schedule.endPeriod,
            schedule.payoutPerCycle
        );
    }

    console.log(`Approving ${fromWei(RewardsPool)} ERC20s to the staking contract for the reward pool before starting`);
    await this.erc20Contract.approve(this.stakingContract.address, RewardsPool);

    console.log('Starting the staking schedule');
    await this.stakingContract.start();
}
