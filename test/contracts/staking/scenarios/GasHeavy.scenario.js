const TokenHelper = require('../../../utils/tokenHelper');

const {
    shouldRevertAndNotStakeNft, shouldStakeNft, shouldUnstakeNft, shouldEstimateRewards,
    shouldClaimRewards, shouldRevertAndNotUnstakeNft, shouldHaveNextClaim, shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength, shouldHaveCurrentCycleAndPeriod, shouldTimeWarpBy, shouldDebugCurrentState
} = require('../behaviors');

const { TokenIds } = require('../constants');

const gasHeavyScenario = function (creator, staker, otherStaker, anotherStaker) {

    const OtherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];
    const AnotherTokenIds = [
        TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
        TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
    ];

    before(async function () {
        for (const tokenId of OtherTokenIds) {
            await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
        }
        for (const tokenId of AnotherTokenIds) {
            await this.nftContract.mintNonFungible(anotherStaker, tokenId, { from: creator });
        }
    });

    describe('when creating 100 snapshots', function () {
        let cycleCounter = 1
        const numSnapshotsToCreate = 99; // excluding the initial one created by staker #1's stake

        describe(`when creating snapshot #1 - staker #1 stakes an NFT`, function () {
            shouldStakeNft(staker, TokenIds[0]);
        });

        describe('when creating interstitial snapshots', async function () {
            for (let index = 0; index < numSnapshotsToCreate; index++) {
                ++cycleCounter;

                switch (index % 4) {
                    case 0:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 stakes an NFT`, function () {
                            shouldTimeWarpBy({ cycles: 1 });
                            shouldStakeNft(otherStaker, OtherTokenIds[0]);
                        });
                        break;
                    case 1:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 stakes an NFT`, function () {
                            shouldTimeWarpBy({ cycles: 1 });
                            shouldStakeNft(anotherStaker, AnotherTokenIds[0]);
                        });
                        break;
                    case 2:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 unclaims their NFT`, function () {
                            shouldTimeWarpBy({ cycles: 1 });
                            shouldUnstakeNft(otherStaker, OtherTokenIds[0]);
                        });
                        break;
                    case 3:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 unclaims their NFT`, function () {
                            shouldTimeWarpBy({ cycles: 1 });
                            shouldUnstakeNft(anotherStaker, AnotherTokenIds[0]);
                        });
                        break;
                }
            }
        });

        describe('when claiming - staker #1 claims their NFT', function () {
            shouldHaveCurrentCycleAndPeriod(100, 15); // period = floor(cycleCounter / 7) + 1
            shouldHaveGlobalHistoryLength(100);
            shouldHaveStakerHistoryLength(staker, 1);
            shouldHaveStakerHistoryLength(otherStaker, 50); // ceil(cycleCounter / 2)
            shouldHaveStakerHistoryLength(anotherStaker, 49); // floor(cycleCounter / 2)

            shouldClaimRewards(staker, 99999999, { startPeriod: 1, periods: 14, amount: 48993 });

            // payout share for staker 1 for every 4 cycles (repeating) is 1, 1/2, 1/3, 1/2
            // for periods 1-12 (54 cycles w/ payout schedule of 1000 per-cycle)
            //      total payout = 21 * (1000 + 500 + 333 + 500) = 48993

        });
    });
}

module.exports = {
    gasHeavyScenario
}