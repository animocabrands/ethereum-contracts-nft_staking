const {
    shouldRevertAndNotStakeNft,
    shouldStakeNft,
    shouldTimeWarpBy,
    shouldUnstakeNft,
    initialiseDebug,
} = require('../behaviors');

const {TokenIds} = require('../constants');

const earlyRestakeScenario = function (staker) {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe("when staking an NFT for the first time", function () {
        shouldStakeNft(staker, TokenIds[0]);
    });

    describe('when unstaking an NFT after the freeze period', function () {
        shouldTimeWarpBy({cycles: 2}, {cycle: 3});
        shouldUnstakeNft(staker, TokenIds[0]);
    });

    describe('when re-staking an NFT in the same cycle it was unstaked', function () {
        shouldRevertAndNotStakeNft(staker, TokenIds[0], 'NftStaking: unstaked token cooldown');
    });

    describe('when waiting 1 cycle before trying to re-stake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 4});
        shouldStakeNft(staker, TokenIds[0]);
    });
};

module.exports = {
    earlyRestakeScenario,
};
