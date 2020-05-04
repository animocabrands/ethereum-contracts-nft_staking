const program = require('commander');
const { NFCollectionMaskLength } = require('@animoca/f1dt-core_metadata').constants;
const { BN } = require('@openzeppelin/test-helpers');
const DayInSeconds = 86400;
const FreezePeriodSeconds = new BN(DayInSeconds);
const DividendTokenInitialBalance = new BN("100000000000000000000000");
const PayoutPeriodLength = new BN(7); // days
const NftStakingMock = artifacts.require("NftStakingMock");
const AssetsInventoryMock = artifacts.require("AssetsInventoryMock");
const ERC20FullMock = artifacts.require("ERC20FullMock");

const CarRarities = {
    Common: 1,
    Epic: 2,
    Apex: 3
};

const CarWeightsConfig = [{
    rarity: CarRarities.Common,
    weight: 1
}, {
    rarity: CarRarities.Epic,
    weight: 10
}, {
    rarity: CarRarities.Apex,
    weight: 100
}];

module.exports = async (deployer, network, accounts) => {

    switch(network){
        case "ganache":
            await deployer.deploy(AssetsInventoryMock,NFCollectionMaskLength);
            this.nftContract = await AssetsInventoryMock.deployed();
            await deployer.deploy(ERC20FullMock,DividendTokenInitialBalance);
            this.dividendTokenContract = await ERC20FullMock.deployed();
            break;
        case "rinkeby":
            const nftContractAddressRinkeby = program.nftContractAddressRinkeby;
            const ERC20BaseAddressRinkeby = program.ERC20BaseAddressRinkeby;
            this.nftContract = nftContractAddressRinkeby?await AssetsInventoryMock.at(nftContractAddressRinkeby):await AssetsInventoryMock.new(NFCollectionMaskLength);
            this.dividendTokenContract = ERC20BaseAddressRinkeby? await ERC20FullMock.at(ERC20BaseAddressRinkeby):await ERC20FullMock.new(DividendTokenInitialBalance);
            break;
        case "mainnet":
            
            break;
        default:
            console.log(`Unknown network '${network}', stopping...`);
            return;

    }
    
    console.log("Creating Staking Contract");
        
    console.log("Deploying Staking Contract");
    const result = await deployer.deploy(NftStakingMock,
        PayoutPeriodLength,
        FreezePeriodSeconds,
        this.nftContract.address,
        this.dividendTokenContract.address,
        CarWeightsConfig.map(x => x.rarity),
        CarWeightsConfig.map(x => x.weight));

    this.stakingContract = await NftStakingMock.deployed();

    await this.dividendTokenContract.transfer(this.stakingContract.address, DividendTokenInitialBalance);    
    
}