const { toWei } = require('web3-utils');
const { accounts, contract } = require('@openzeppelin/test-environment');
const { DefaultNFMaskLength } = require('@animoca/ethereum-contracts-assets_inventory').constants;

const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");
const ERC20WithOperators = contract.fromArtifact("ERC20WithOperatorsMock");
const NftStaking = contract.fromArtifact("NftStakingMock");

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('./constants');

const [
    creator,
    staker,
] = accounts;

async function deploy() {
    this.nftContract = await AssetsInventory.new(DefaultNFMaskLength, { from: creator });

    this.rewardsToken = await ERC20WithOperators.new(RewardsTokenInitialBalance, { from: creator });

    this.stakingContract = await NftStaking.new(
        CycleLengthInSeconds,
        PeriodLengthInCycles,
        this.nftContract.address,
        this.rewardsToken.address,
        RarityWeights.map(x => x.rarity),
        RarityWeights.map(x => x.weight),
        { from: creator }
    );

    // for 'interface support' tests
    this.contract = this.stakingContract;

    await this.rewardsToken.approve(this.stakingContract.address, RewardsTokenInitialBalance, { from: creator });

    for (const tokenId of TokenIds) {
        await this.nftContract.mintNonFungible(staker, tokenId, { from: creator });
    }
}

async function start(rewardSchedule = DefaultRewardSchedule) {
    for (schedule of rewardSchedule) {
        await this.stakingContract.setRewardsForPeriods(
            schedule.startPeriod,
            schedule.endPeriod,
            toWei(schedule.rewardPerCycle),
            { from: creator }
        );
    }

    await this.stakingContract.start({ from: creator });
    this.cycle = 1;
    this.period = 1;
}

module.exports = {
    deploy,
    start
}
