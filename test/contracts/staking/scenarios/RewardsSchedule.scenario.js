const { BN, expectRevert } = require('@openzeppelin/test-helpers');
const { toWei } = require("web3-utils");

const { shouldTimeWarpBy } = require('../behaviors');

const reward = toWei('10000');

const rewardsScheduleScenario = function (creator, notCreator) {

    it('should revert if not called by the owner', async function () {
        await expectRevert(
            this.stakingContract.setRewardsForPeriods(9, 10, reward, { from: notCreator }),
            'Ownable: caller is not the owner'
        );
    });

    it('should revert if the start period is 0', async function () {
        await expectRevert(
            this.stakingContract.setRewardsForPeriods(0, 10, reward, { from: creator }),
            'NftStaking: wrong period range'
        );
    });

    it('should revert if the end period precedes the start period', async function () {
        await expectRevert(
            this.stakingContract.setRewardsForPeriods(10, 9, reward, { from: creator }),
            'NftStaking: wrong period range'
        );
    });

    describe('warping 2 periods', function () {
        shouldTimeWarpBy({ periods: 2 }, { cycle: 15 });

        it ('should revert if setting the reward schedule for a past period', async function () {
            await expectRevert(
                this.stakingContract.setRewardsForPeriods(1, 2, reward, { from: creator }),
                'NftStaking: already committed reward schedule'
            );
        });
    });

    describe('when setting a valid period range', function () {
        context('when setting a consecutive reward schedule', function () {
            it('should have the correct total prize pool', async function () {
                await this.stakingContract.setRewardsForPeriods(9, 10, reward, { from: creator });
                const totalRewards = await this.stakingContract.getTotalRewards();
                totalRewards.should.be.bignumber.equal(toWei('182000'));
            });
        });

        context('when setting an overlapping reward schedule', function () {
            it('should have the correct total prize pool', async function () {
                await this.stakingContract.setRewardsForPeriods(4, 5, reward, { from: creator });
                const totalRewards = await this.stakingContract.getTotalRewards();
                totalRewards.should.be.bignumber.equal(toWei('311500'));
            });
        });
    });
}

module.exports = {
    rewardsScheduleScenario
}
