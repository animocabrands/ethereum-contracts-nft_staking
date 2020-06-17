const { contract } = require('@openzeppelin/test-environment');
const { DefaultNFMaskLength } = require('@animoca/ethereum-contracts-assets_inventory').constants;

const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");

const {
    shouldRevertAndNotStakeNft, shouldRevertAndNotBatchStakeNfts
} = require('../behaviors');

const { TokenIds } = require('../constants');

const nonWhitelistedNftContractScenario = function (creator, staker) {
    before (async function () {
        this.nftContract = await AssetsInventory.new(DefaultNFMaskLength, { from: creator });

        for (const tokenId of TokenIds) {
            await this.nftContract.mintNonFungible(staker, tokenId, { from: creator });
        }
    });

    describe('when staking a single NFT from an invalid NFT contract', function () {
        shouldRevertAndNotStakeNft(staker, TokenIds[0], 'NftStaking: contract not whitelisted.');
    });

    describe('when staking a batch of NFTs from an invalid NFT contract', function () {
        shouldRevertAndNotBatchStakeNfts(staker, TokenIds, 'NftStaking: contract not whitelisted.');
    });
}

module.exports = {
    nonWhitelistedNftContractScenario
}
