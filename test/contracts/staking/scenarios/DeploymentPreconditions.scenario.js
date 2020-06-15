const { BN } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../../utils/tokenHelper');

const { RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool } = require('../constants');

const deploymentPreconditionsScenario = function (staker) {

    context('Staking contract', function () {
        it('should have the correct cycle length', async function () {
            const cycleLength = await this.stakingContract.cycleLengthInSeconds();
            cycleLength.should.be.bignumber.equal(CycleLengthInSeconds);
        });

        it('should have the correct period length', async function () {
            const periodLength = await this.stakingContract.periodLengthInCycles();
            periodLength.should.be.bignumber.equal(PeriodLengthInCycles);
        });

        it('should have assigned a weight of 1 for Common cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Common);
            weight.should.be.bignumber.equal(new BN(1));
        });

        it('should have assigned a weight of 10 for Epic cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Epic);
            weight.should.be.bignumber.equal(new BN(10));
        });

        it('should have assigned a weight of 100 for Apex cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Apex);
            weight.should.be.bignumber.equal(new BN(100));
        });
    });

    context('NFT Assets Inventory contract', function () {
        it('should be whitelisted with the Staking contract', async function () {
            const whitelistedAddress = await this.stakingContract.whitelistedNftContract();
            whitelistedAddress.should.be.equal(this.nftContract.address);
        });

        it('should have minted 3 tokens in total for the staker', async function () {
            const balance = await this.nftContract.balanceOf(staker);
            balance.should.be.bignumber.equal(new BN(3));
        });

        it('should have minted 3 car tokens for the staker', async function () {
            for (const tokenId of TokenIds) {
                const balance = await this.nftContract.balanceOf(staker, tokenId);
                balance.should.be.bignumber.equal(new BN(1));

                const tokenType = TokenHelper.getType(tokenId)
                tokenType.should.be.equal(TokenHelper.Type.Car);
            }
        });

        it('should have minted a Common car token for the staker', async function () {
            const tokenId = TokenIds[0];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarity.Common);
        });

        it('should have minted an Epic car token for the staker', async function () {
            const tokenId = TokenIds[1];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarity.Epic);
        });

        it('should have minted an Apex car token for the staker', async function () {
            const tokenId = TokenIds[2];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarity.Apex);
        });
    });

    context('Rewards Token contract', function () {
        it('should be used as the rewards token', async function () {
            const rewardsToken = await this.stakingContract.rewardsToken();
            rewardsToken.should.be.equal(this.rewardsToken.address);
        });

        // // The rewards token transfer to the contract should now occur when
        // // starting the staking event by calling the start() function
        // it(`should have a token balance of ${RewardsTokenInitialBalance.toString()} for the staking contract`, async function () {
        //     const balance = await this.rewardsToken.balanceOf(this.stakingContract.address);
        //     balance.should.be.bignumber.equal(RewardsTokenInitialBalance);
        // });
    });
}

module.exports = {
    deploymentPreconditionsScenario
}