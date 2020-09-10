const {accounts, contract} = require('@openzeppelin/test-environment');
const {DefaultNFMaskLength} = require('@animoca/ethereum-contracts-assets_inventory').constants;

const AssetsInventory = contract.fromArtifact('AssetsInventoryMock');

const {shouldRevertAndNotStakeNft, shouldRevertAndNotBatchStakeNfts} = require('../behaviors');

const [creator, staker] = accounts;

const nonWhitelistedNftContractScenario = function () {
    before(async function () {
        this.nftContract = await AssetsInventory.new(DefaultNFMaskLength, {from: creator});

        for (const tokenId of this.stakerTokens[staker]) {
            await this.nftContract.mintNonFungible(staker, tokenId, {from: creator});
        }
    });

    describe('when staking a single NFT from an invalid NFT contract', function () {
        shouldRevertAndNotStakeNft(staker, 0, 'NftStaking: contract not whitelisted.');
    });

    describe('when staking a batch of NFTs from an invalid NFT contract', function () {
        shouldRevertAndNotBatchStakeNfts(staker, [0, 1, 2, 3], 'NftStaking: contract not whitelisted.');
    });
};

module.exports = {
    nonWhitelistedNftContractScenario,
};
