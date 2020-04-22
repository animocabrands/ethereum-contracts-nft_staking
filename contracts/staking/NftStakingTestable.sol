pragma solidity = 0.5.16;
pragma experimental ABIEncoderV2;

import "./NftStaking.sol";

contract NftStakingTestable is NftStaking {

    constructor(
        uint _payoutPeriodLength,
        uint _freezeDurationAfterStake,
        address _whitelistedNftContract,
        address _dividendToken,
        uint[] memory _rarities,
        uint[] memory _rarityWeights
    )
    NftStaking(_payoutPeriodLength, _freezeDurationAfterStake, _whitelistedNftContract, _dividendToken, _rarities, _rarityWeights)
    public {

    }

    function getLatestSnapshot()
    public
    view
    returns(
        uint32 cycleRangeStart,
        uint32 cycleRangeEnd,
        uint64 stakedWeight,
        uint128 tokensToClaim
    )
    {
        DividendsSnapshot memory snapshot;

        if (_dividendsSnapshots.length != 0) {
            snapshot = _dividendsSnapshots[_dividendsSnapshots.length - 1];
        }

        return (
            snapshot.cycleRangeStart,
            snapshot.cycleRangeEnd,
            snapshot.stakedWeight,
            snapshot.tokensToClaim
        );
    }

    function dividendsSnapshot(uint targetCycle)
    public
    view
    returns(
        uint32 cycleRangeStart,
        uint32 cycleRangeEnd,
        uint64 stakedWeight,
        uint128 tokensToClaim,
        int snapshotIndex
    )
    {
        DividendsSnapshot memory snapshot;
        (snapshot, snapshotIndex) = findDividendsSnapshot(targetCycle);
        return (
            snapshot.cycleRangeStart,
            snapshot.cycleRangeEnd,
            snapshot.stakedWeight,
            snapshot.tokensToClaim,
            snapshotIndex
        );
    }

    function totalSnapshots() public view returns(uint) {
        return _dividendsSnapshots.length;
    }

    function _getOrCreateLatestCycleSnapshot(uint offset) public returns(DividendsSnapshot memory snapshot) {
        return super.getOrCreateLatestCycleSnapshot(offset);
    }

    function _currentPayoutPeriod() public view returns(uint) {
        StakerState memory state = _stakeStates[msg.sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        return _payoutPeriodFromCycle(state.depositCycle);
    }
}
