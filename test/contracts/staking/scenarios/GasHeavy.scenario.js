const {accounts} = require('@openzeppelin/test-environment');

const {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldClaimRewards,
    shouldHaveGlobalHistoryLength,
    shouldHaveStakerHistoryLength,
    shouldHaveCurrentCycleAndPeriod,
    shouldTimeWarpBy,
    initialiseDebug,
    suspendDebugOutput,
    resumeDebugOutput,
    mintStakerTokens,
} = require('../behaviors');

const [creator, staker, otherStaker, anotherStaker] = accounts;

const gasHeavyScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker, otherStaker, anotherStaker);
    });

    before(async function () {
        await mintStakerTokens.bind(this)(otherStaker);
        await mintStakerTokens.bind(this)(anotherStaker);
    });

    describe('when creating 100 snapshots', function () {
        let cycleCounter = 1;
        const numSnapshotsToCreate = 99; // excluding the initial one created by staker #1's stake

        suspendDebugOutput.bind(this)();

        describe(`when creating snapshot #1 - staker #1 stakes an NFT`, function () {
            shouldStakeNft(staker, 0);
        });

        describe('when creating interstitial snapshots', function () {
            for (let index = 0; index < numSnapshotsToCreate; index++) {
                ++cycleCounter;

                switch (index % 4) {
                    case 0:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 stakes an NFT`, function () {
                            shouldTimeWarpBy({cycles: 1});
                            shouldStakeNft(otherStaker, 0);
                        });
                        break;
                    case 1:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 stakes an NFT`, function () {
                            shouldTimeWarpBy({cycles: 1});
                            shouldStakeNft(anotherStaker, 0);
                        });
                        break;
                    case 2:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #2 unclaims their NFT`, function () {
                            shouldTimeWarpBy({cycles: 1});
                            shouldUnstakeNft(otherStaker, 0);
                        });
                        break;
                    case 3:
                        describe(`when creating snapshot #${cycleCounter} - timewarp 1 cycle and staker #3 unclaims their NFT`, function () {
                            shouldTimeWarpBy({cycles: 1});
                            shouldUnstakeNft(anotherStaker, 0);
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

            resumeDebugOutput.bind(this)();

            shouldClaimRewards(staker, 99999999, {startPeriod: 1, periods: 14, amount: '49000'});

            // payout share for staker 1 for every 4 cycles (repeating) is 1, 1/2, 1/3, 1/2
            // for periods 1-12 (54 cycles w/ payout schedule of 1000 per-cycle)
            //      total payout = 21 * (1000 + 500 + 333.3333333333 + 500) = 49000
        });
    });
};

module.exports = {
    gasHeavyScenario,
};
