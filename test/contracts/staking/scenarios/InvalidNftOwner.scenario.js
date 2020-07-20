const {shouldStakeNft, shouldRevertAndNotStakeNft, shouldRevertAndNotUnstakeNft} = require('../behaviors');

const {TokenIds} = require('../constants');

const invalidNftOwnerScenario = function (staker, otherStaker) {
    describe('when staking an NFT', function () {
        shouldStakeNft(staker, TokenIds[0]);

        describe('when staking an already staked NFT', function () {
            shouldRevertAndNotStakeNft(staker, TokenIds[0], 'ERC1155: transfer of a non-owned NFT');
        });

        describe('when unstaking an NFT not owned by the caller', function () {
            shouldRevertAndNotUnstakeNft(
                otherStaker,
                TokenIds[0],
                'NftStaking: token not staked or incorrect token owner'
            );
        });
    });
};

module.exports = {
    invalidNftOwnerScenario,
};
