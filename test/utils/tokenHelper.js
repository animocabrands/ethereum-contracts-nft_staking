const { BN } = require('@openzeppelin/test-helpers');
const { inventoryIds } = require('@animoca/blockchain-inventory_metadata');
const { DefaultNFMaskLength } = require('@animoca/ethereum-contracts-assets_inventory').constants;

const Type = {
    None: 0,
    Car: 1,
    Driver: 2,
    Part: 3,
    Gear: 4,
    Tyres: 5,
    Track: 6
};

const Rarity = {
    Common: 1,
    Epic: 2,
    Legendary: 3,
    Apex: 4,
};

const MAX_UINT_8 = (new BN(2)).pow(new BN(8)).subn(1);
const BIT_LAYOUT_POSITION_TYPE = 240;
const BIT_LAYOUT_POSITION_RARITY = 176;
const BIT_MASK_TYPE = MAX_UINT_8.shln(BIT_LAYOUT_POSITION_TYPE);
const BIT_MASK_RARITY = MAX_UINT_8.shln(BIT_LAYOUT_POSITION_RARITY);

const BaseCollectionId = 1;
let baseTokenId = 1;

function makeTokenId(rarity, type) {
    const tokenId = inventoryIds.makeNonFungibleTokenId(
        baseTokenId++,
        BaseCollectionId,
        DefaultNFMaskLength);

    return new BN(tokenId)
        .or(new BN(type).shln(BIT_LAYOUT_POSITION_TYPE))
        .or(new BN(rarity).shln(BIT_LAYOUT_POSITION_RARITY))
        .toString();
}


function getType(tokenId) {
    return new BN(tokenId)
        .and(BIT_MASK_TYPE)
        .shrn(BIT_LAYOUT_POSITION_TYPE)
        .toNumber();
}

function getRarity(tokenId) {
    return new BN(tokenId)
        .and(BIT_MASK_RARITY)
        .shrn(BIT_LAYOUT_POSITION_RARITY).toNumber();
}

module.exports = {
    Type: Type,
    Rarity: Rarity,
    makeTokenId: makeTokenId,
    getType: getType,
    getRarity: getRarity
};
