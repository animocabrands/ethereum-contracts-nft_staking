const { BN } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../../utils/tokenHelper');

const { shouldHaveNextClaim, shouldHaveGlobalHistoryLength, shouldHaveStakerHistoryLength,
    shouldHaveCurrentCycleAndPeriod, initialiseDebug, debugCurrentState } = require('../behaviors');

const { CycleLengthInSeconds, PeriodLengthInCycles, TokenIds } = require('../constants');

const preconditionsScenario = function (staker) {

    before(function () {
        initialiseDebug.bind(this)();
    });;

    context('Staking contract', async function () {

        it('should have the correct cycle length', async function () {
            const cycleLength = await this.stakingContract.cycleLengthInSeconds();
            cycleLength.should.be.bignumber.equal(CycleLengthInSeconds);
        });

        it('should have the correct period length', async function () {
            const periodLength = await this.stakingContract.periodLengthInCycles();
            periodLength.should.be.bignumber.equal(PeriodLengthInCycles);
        });

        it('should have assigned a weight of 1 for Common cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarities.Common);
            weight.should.be.bignumber.equal(new BN(1));
        });

        it('should have assigned a weight of 10 for Epic cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarities.Epic);
            weight.should.be.bignumber.equal(new BN(10));
        });

        it('should have assigned a weight of 100 for Legendary cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarities.Legendary);
            weight.should.be.bignumber.equal(new BN(100));
        });

        it('should have assigned a weight of 500 for Apex cars', async function () {
            const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarities.Apex);
            weight.should.be.bignumber.equal(new BN(500));
        });

        shouldHaveCurrentCycleAndPeriod(1, 1);
        shouldHaveGlobalHistoryLength(0);
        shouldHaveStakerHistoryLength(staker, 0);
        shouldHaveNextClaim(staker, { period: 0, stakerSnapshotIndex: 0, globalSnapshotIndex: 0 });
        if (this.debug) await debugCurrentState.bind(this)();
    });

    context('NFT Assets Inventory contract', function () {
        it('should be whitelisted with the Staking contract', async function () {
            const whitelistedAddress = await this.stakingContract.whitelistedNftContract();
            whitelistedAddress.should.be.equal(this.nftContract.address);
        });

        it('should have minted 3 tokens in total for the staker', async function () {
            const balance = await this.nftContract.balanceOf(staker);
            balance.should.be.bignumber.equal(new BN(4));
        });

        it('should have minted 3 car tokens for the staker', async function () {
            for (const tokenId of TokenIds) {
                const balance = await this.nftContract.balanceOf(staker, tokenId);
                balance.should.be.bignumber.equal(new BN(1));

                const tokenType = TokenHelper.getType(tokenId)
                tokenType.should.be.equal(TokenHelper.Types.Car);
            }
        });

        it('should have minted a Common car token for the staker', async function () {
            const tokenId = TokenIds[0];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarities.Common);
        });

        it('should have minted an Epic car token for the staker', async function () {
            const tokenId = TokenIds[1];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarities.Epic);
        });

        it('should have minted an Apex car token for the staker', async function () {
            const tokenId = TokenIds[2];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarities.Legendary);
        });

        it('should have minted an Apex car token for the staker', async function () {
            const tokenId = TokenIds[3];
            const rarity = TokenHelper.getRarity(tokenId);
            rarity.should.be.equal(TokenHelper.Rarities.Apex);
        });
    });

    context('Rewards Token contract', function () {
        it('should be used as the rewards token', async function () {
            const rewardsToken = await this.stakingContract.rewardsTokenContract();
            rewardsToken.should.be.equal(this.rewardsToken.address);
        });

        it(`should have a token balance equal to the total rewards`, async function () {
            const balance = await this.rewardsToken.balanceOf(this.stakingContract.address);
            balance.should.be.bignumber.equal(await this.stakingContract.totalRewardsPool());
        });
    });
}

module.exports = {
    preconditionsScenario
}
