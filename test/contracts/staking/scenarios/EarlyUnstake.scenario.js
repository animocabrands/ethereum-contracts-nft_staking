const {
    shouldRevertAndNotUnstakeNft,
    shouldStakeNft,
    shouldTimeWarpBy,
    shouldUnstakeNft,
    initialiseDebug,
} = require('../behaviors');

const {TokenIds} = require('../constants');

const earlyUnstakeScenario = function (staker) {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe("when unstaking an NFT that hasn't been staked", function () {
        shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: token not staked or incorrect token owner.');
    });

    describe('when immediatley trying to unstake an NFT after staking', function () {
        shouldStakeNft(staker, TokenIds[0]);
        shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: token still frozen.');
    });

    describe('when waiting 1 cycle before trying to unstake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 2});
        shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: token still frozen.');
    });

    describe('when waiting another cycle before trying to unstake', function () {
        shouldTimeWarpBy({cycles: 1}, {cycle: 3});
        shouldUnstakeNft(staker, TokenIds[0]);
    });
};

module.exports = {
    earlyUnstakeScenario,
};
