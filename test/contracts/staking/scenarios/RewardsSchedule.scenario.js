const { BN, expectRevert } = require('@openzeppelin/test-helpers');
const { toWei } = require("web3-utils");

const {
    shouldAddRewardsForPeriods, shouldRevertAndNotAddRewardsForPeriods,
    shouldTimeWarpBy
} = require('../behaviors');

const reward = toWei('10000');

const rewardsScheduleScenario = function (creator, notCreator, started) {
    describe('when not called by the owner', function () {
        shouldRevertAndNotAddRewardsForPeriods(notCreator, 9, 10, reward, 'Ownable: caller is not the owner');
    });

    describe('when the start period is zero', function () {
        shouldRevertAndNotAddRewardsForPeriods(creator, 0, 10, reward, 'NftStaking: wrong period range');
    });

    describe('when the end period precedes the start period', function () {
        shouldRevertAndNotAddRewardsForPeriods(creator, 10, 9, reward, 'NftStaking: wrong period range');
    });

    describe('warping 2 periods', function () {
        shouldTimeWarpBy({ periods: 2 });

        context('when adding rewards to a past period', function () {
            if (started) {
                shouldRevertAndNotAddRewardsForPeriods(creator, 1, 2, reward, 'NftStaking: already committed reward schedule');
            } else {
                shouldAddRewardsForPeriods(creator, 1, 2, reward);
            }
        });

        context('when adding rewards to the current period', function () {
            shouldAddRewardsForPeriods(creator, 3, 3, reward);
        });

        context('when adding rewards to a future period', function () {
            context('when adding rewards to extend the rewards schedule', function () {
                shouldAddRewardsForPeriods(creator, 9, 10, reward);
            });

            context('when adding rewards to update the existing rewards schedule', function () {
                shouldAddRewardsForPeriods(creator, 4, 5, reward);
            });
        });
    });
}

module.exports = {
    rewardsScheduleScenario
}
