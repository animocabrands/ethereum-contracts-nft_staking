const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldRevertAndNotStakeNft,
    shouldStakeNft,
    shouldTimeWarpBy,
    shouldUnstakeNft,
    initialiseDebug,
} = require('../behaviors');

const [creator, staker] = accounts;

const earlyRestakeScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe("when staking an NFT for the first time", function () {
        shouldStakeNft(staker, 0);
    });

    describe('when unstaking an NFT after the freeze period', function () {
        shouldTimeWarpBy({cycles: 2}, {cycle: 3});
        shouldUnstakeNft(staker, 0);
    });

    describe('when re-staking an NFT in the same cycle it was unstaked', function () {
        shouldRevertAndNotStakeNft(staker, 0, 'NftStaking: unstaked token cooldown');
    });

    describe('when waiting 1 cycle before trying to re-stake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 4});
        shouldStakeNft(staker, 0);
    });
};

module.exports = {
    earlyRestakeScenario,
};
