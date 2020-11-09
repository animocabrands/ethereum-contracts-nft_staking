const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldStakeNft,
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    mintStakerTokens,
} = require('../behaviors');

const [creator, staker, otherStaker] = accounts;

const invalidNftOwnerScenario = function () {
    before(async function () {
        await mintStakerTokens.bind(this)(otherStaker);
    });

    describe('when staking an NFT', function () {
        shouldStakeNft(staker, 0);

        describe('when staking an already staked NFT', function () {
            shouldRevertAndNotStakeNft(staker, 0, 'ERC1155: transfer of a non-owned NFT');
        });

        describe('when unstaking an NFT not owned by the caller', function () {
            shouldRevertAndNotUnstakeNft(staker, 0, 'NftStaking: not staked for owner', {
                owner: otherStaker,
            });
        });
    });
};

module.exports = {
    invalidNftOwnerScenario,
};
