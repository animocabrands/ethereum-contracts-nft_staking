const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldRevertAndNotUnstakeNft,
    shouldStakeNft,
    shouldTimeWarpBy,
    shouldUnstakeNft,
    initialiseDebug,
} = require('../behaviors');

const [creator, staker] = accounts;

const earlyUnstakeScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe("when unstaking an NFT that hasn't been staked", function () {
        shouldRevertAndNotUnstakeNft(staker, 0, 'NftStaking: not staked for owner.');
    });

    describe('when immediatley trying to unstake an NFT after staking', function () {
        shouldStakeNft(staker, 0);
        shouldRevertAndNotUnstakeNft(staker, 0, 'NftStaking: token still frozen.');
    });

    describe('when waiting 1 cycle before trying to unstake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 2});
        shouldRevertAndNotUnstakeNft(staker, 0, 'NftStaking: token still frozen.');
    });

    describe('when waiting another cycle before trying to unstake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 3});
        shouldUnstakeNft(staker, 0);
    });
};

module.exports = {
    earlyUnstakeScenario,
};
