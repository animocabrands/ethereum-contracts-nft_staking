const program = require('commander');
const { NFCollectionMaskLength } = require('../src').constants;
const { BN } = require('@openzeppelin/test-helpers');
const DayInSeconds = 86400;
const FreezePeriodSeconds = new BN(DayInSeconds);
const DividendTokenInitialBalance = new BN("100000000000000000000000");
const PayoutPeriodLength = new BN(7); // days
const NftStakingMock = artifacts.require("NftStakingMock");
const AssetsInventoryMock = artifacts.require("AssetsInventoryMock");
const ERC20FullMock = artifacts.require("ERC20FullMock");

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

    const result = await deployer.deploy(NftStakingMock,
        PayoutPeriodLength,
        FreezePeriodSeconds,
        this.nftContract.address,
        this.dividendTokenContract.address,
        Object.keys(RarityToWeightsMap),
        Object.values(RarityToWeightsMap)
    );

    this.stakingContract = await NftStakingMock.deployed();

    await this.dividendTokenContract.transfer(this.stakingContract.address, DividendTokenInitialBalance);

}
