const program = require('commander');
const { NFCollectionMaskLength } = require('../src').constants;
const { BN } = require('@openzeppelin/test-helpers');
const { fromWei, toWei } = require('web3-utils');

const NftStaking = artifacts.require("NftStakingMock");
const AssetsInventory = artifacts.require("AssetsInventoryMock");
const ERC20 = artifacts.require("ERC20WithOperatorsMock");

const DayInSeconds = 86400;
const CycleLengthInSeconds = new BN(DayInSeconds);
const PeriodLengthInCycles = new BN(7);
const FreezeLengthInCycles = new BN(1);

const RewardsTokenInitialBalance = toWei('320000000');
const PayoutSchedule = [ // payouts are expressed in decimal form and need to be converted to wei
    { startPeriod: 1, endPeriod: 4, payoutPerCycle: 2700000 },
    { startPeriod: 5, endPeriod: 5, payoutPerCycle: 2200000 },
    { startPeriod: 6, endPeriod: 6, payoutPerCycle: 2150000 },
    { startPeriod: 7, endPeriod: 7, payoutPerCycle: 2100000 },
    { startPeriod: 8, endPeriod: 8, payoutPerCycle: 2050000 },
    { startPeriod: 9, endPeriod: 9, payoutPerCycle: 2000000 },
    { startPeriod: 10, endPeriod: 10, payoutPerCycle: 1950000 },
    { startPeriod: 11, endPeriod: 11, payoutPerCycle: 1900000 },
    { startPeriod: 12, endPeriod: 12, payoutPerCycle: 1850000 },
    { startPeriod: 13, endPeriod: 13, payoutPerCycle: 1800000 },
    { startPeriod: 14, endPeriod: 14, payoutPerCycle: 1750000 },
    { startPeriod: 15, endPeriod: 15, payoutPerCycle: 1700000 },
    { startPeriod: 16, endPeriod: 16, payoutPerCycle: 1650000 },
    { startPeriod: 17, endPeriod: 17, payoutPerCycle: 1600000 },
    { startPeriod: 18, endPeriod: 18, payoutPerCycle: 1550000 },
    { startPeriod: 19, endPeriod: 19, payoutPerCycle: 1500000 },
    { startPeriod: 20, endPeriod: 20, payoutPerCycle: 1475000 },
    { startPeriod: 21, endPeriod: 21, payoutPerCycle: 1450000 },
    { startPeriod: 22, endPeriod: 22, payoutPerCycle: 1425000 },
    { startPeriod: 23, endPeriod: 23, payoutPerCycle: 1400000 },
    { startPeriod: 24, endPeriod: 24, payoutPerCycle: 1375000 },
]; // total ~ 320,000,000

const RarityToWeightsMap = {
    0: 500,// Apex,
    1: 100,// Legendary,
    2: 50,// Epic,
    3: 50,// Epic,
    4: 10,// Rare,
    5: 10,// Rare,
    6: 10,// Rare,
    7: 1,// Common,
    8: 1,// Common,
    9: 1// Common,
};

module.exports = async (deployer, network, accounts) => {

    switch (network) {
        case "ganache":
            await deployer.deploy(AssetsInventory, NFCollectionMaskLength);
            this.nftContract = await AssetsInventory.deployed();
            await deployer.deploy(ERC20, RewardsTokenInitialBalance);
            this.rewardsTokenContract = await ERC20.deployed();
            break;
        case "rinkeby":
            const nftContractAddressRinkeby = program.nftContractAddressRinkeby;
            const ERC20BaseAddressRinkeby = program.ERC20BaseAddressRinkeby;

            this.nftContract =
                nftContractAddressRinkeby ?
                    await AssetsInventory.at(nftContractAddressRinkeby) :
                    await AssetsInventory.new(NFCollectionMaskLength);

            this.rewardsTokenContract =
                ERC20BaseAddressRinkeby ?
                    await ERC20.at(ERC20BaseAddressRinkeby) :
                    await ERC20.new(RewardsTokenInitialBalance);

            break;
        case "mainnet":

            break;
        default:
            console.log(`Unknown network '${network}', stopping...`);
            return;

    }


    const result = await deployer.deploy(NftStaking,
        CycleLengthInSeconds,
        PeriodLengthInCycles,
        FreezeLengthInCycles,
        this.nftContract.address,
        this.rewardsTokenContract.address,
        Object.keys(RarityToWeightsMap),
        Object.values(RarityToWeightsMap),
    );

    this.stakingContract = await NftStaking.deployed();

    // Enough to cover the whole payout schedule needs to be approved and will be transferred to the contract at start
    await this.rewardsTokenContract.approve(this.stakingContract.address, RewardsTokenInitialBalance);

    for (schedule of PayoutSchedule) {
        await this.stakingContract.setRewardsForPeriods(
            schedule.startPeriod,
            schedule.endPeriod,
            schedule.payoutPerCycle
        );
    }

    await this.stakingContract.start();
}
