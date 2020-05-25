const program = require('commander');
const { NFCollectionMaskLength } = require('../src').constants;
const { BN } = require('@openzeppelin/test-helpers');
const DayInSeconds = 86400;
const FreezePeriodSeconds = new BN(DayInSeconds);
const RewardPoolBase = new BN(0);
const DividendTokenInitialBalance = new BN("100000000000000000000000");
const CycleLength = new BN(DayInSeconds);
const PayoutPeriodLength = new BN(7);
const NftStaking = artifacts.require("NftStakingMock");
const AssetsInventory = artifacts.require("AssetsInventoryMock");
const ERC20 = artifacts.require("ERC20WithOperatorsMock");

const RarityToWeightsMap = {
    0:500,// Apex,
    1:100,// Legendary,
    2:50,// Epic,
    3:50,// Epic,
    4:10,// Rare,
    5:10,// Rare,
    6:10,// Rare,
    7:1,// Common,
    8:1,// Common,
    9:1// Common,
};

module.exports = async (deployer, network, accounts) => {

    switch(network){
        case "ganache":
            await deployer.deploy(AssetsInventory,NFCollectionMaskLength);
            this.nftContract = await AssetsInventory.deployed();
            await deployer.deploy(ERC20,DividendTokenInitialBalance);
            this.dividendTokenContract = await ERC20.deployed();
            break;
        case "rinkeby":
            const nftContractAddressRinkeby = program.nftContractAddressRinkeby;
            const ERC20BaseAddressRinkeby = program.ERC20BaseAddressRinkeby;
            this.nftContract = nftContractAddressRinkeby?await AssetsInventory.at(nftContractAddressRinkeby):await AssetsInventory.new(NFCollectionMaskLength);
            this.dividendTokenContract = ERC20BaseAddressRinkeby? await ERC20.at(ERC20BaseAddressRinkeby):await ERC20.new(DividendTokenInitialBalance);
            break;
        case "mainnet":

            break;
        default:
            console.log(`Unknown network '${network}', stopping...`);
            return;

    }

    const result = await deployer.deploy(NftStaking,
        CycleLength,
        PayoutPeriodLength,
        FreezePeriodSeconds,
        RewardPoolBase,
        this.nftContract.address,
        this.dividendTokenContract.address,
        Object.keys(RarityToWeightsMap),
        Object.values(RarityToWeightsMap)
    );

    this.stakingContract = await NftStaking.deployed();

    await this.dividendTokenContract.transfer(this.stakingContract.address, DividendTokenInitialBalance);

}
