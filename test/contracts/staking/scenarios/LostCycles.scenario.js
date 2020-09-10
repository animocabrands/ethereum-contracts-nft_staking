const {toWei} = require('web3-utils');
const {accounts} = require('@openzeppelin/test-environment');
const {ZeroAddress} = require('@animoca/ethereum-contracts-core_library').constants;

const {
    shouldStakeNft,
    shouldUnstakeNft,
    shouldWithdrawLostCycle,
    shouldRevertAndNotWithdrawLostCycle,
    shouldTimeWarpBy,
    initialiseDebug,
    // mintStakerTokens,
} = require('../behaviors');

const [creator, staker /*, otherStaker, anotherStaker*/] = accounts;

const lostCyclesScenario = function () {
    before(function () {
        initialiseDebug.bind(this)(staker);
    });

    describe('withdraw the first cycle, before first staking', function () {
        shouldRevertAndNotWithdrawLostCycle(creator, 1, -1, 'Ownable: caller is not the owner', {from: staker});
        shouldRevertAndNotWithdrawLostCycle(ZeroAddress, 1, -1, 'NftStaking: zero address', {from: creator});
        shouldRevertAndNotWithdrawLostCycle(creator, 1, -1, 'NftStaking: non-past cycle');
        shouldTimeWarpBy({cycles: 1});
        shouldRevertAndNotWithdrawLostCycle(creator, 1, -2, 'NftStaking: wrong index value');
        shouldWithdrawLostCycle(creator, 1, -1, toWei('1000'));
        shouldRevertAndNotWithdrawLostCycle(creator, 1, -1, 'NftStaking: already withdrawn');
    });

    describe('withdraw a lost cycle, after first staking', function () {
        shouldTimeWarpBy({});
        shouldStakeNft(staker, 0);
        shouldTimeWarpBy({cycles: 2});
        shouldUnstakeNft(staker, 0);
        shouldRevertAndNotWithdrawLostCycle(creator, 3, -1, 'NftStaking: cycle has snapshot');
        shouldRevertAndNotWithdrawLostCycle(creator, 3, 0, 'NftStaking: non-lost cycle');
        shouldRevertAndNotWithdrawLostCycle(creator, 4, 1, 'NftStaking: non-past cycle');
        shouldTimeWarpBy({cycles: 1});
        shouldRevertAndNotWithdrawLostCycle(creator, 3, 1, 'NftStaking: cycle < snapshot');
        shouldRevertAndNotWithdrawLostCycle(creator, 4, 0, 'NftStaking: cycle > snapshot');
        shouldWithdrawLostCycle(creator, 4, 1, toWei('1000'));
    });

    describe('withdraw an empty lost cycle', function () {
        shouldTimeWarpBy({periods: 50}, {cycle: 355});
        shouldRevertAndNotWithdrawLostCycle(creator, 354, 1, 'NftStaking: rewardless cycle');
    });
};

module.exports = {
    lostCyclesScenario,
};
