pragma solidity ^0.6.6;

import "./NftStaking.sol";

abstract contract NftStakingTestable is NftStaking {

    constructor(
        uint payoutPeriodLength,
        uint freezeDurationAfterStake,
        address whitelistedNftContract,
        address dividendToken,
        uint[] memory values,
        uint[] memory valueWeights
    )
    NftStaking(payoutPeriodLength, freezeDurationAfterStake, whitelistedNftContract, dividendToken, values, valueWeights)
    public {}

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
        (snapshot, snapshotIndex) = _findDividendsSnapshot(targetCycle);
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

    function getOrCreateLatestCycleSnapshot(uint offset) public returns(
        uint32 cycleRangeStart,
        uint32 cycleRangeEnd,
        uint64 stakedWeight,
        uint128 tokensToClaim
    ) {
        DividendsSnapshot memory snapshot = super._getOrCreateLatestCycleSnapshot(offset);
        cycleRangeStart = snapshot.cycleRangeStart;
        cycleRangeEnd = snapshot.cycleRangeEnd;
        stakedWeight = snapshot.stakedWeight;
        tokensToClaim = snapshot.tokensToClaim;
    }

    function currentPayoutPeriod() public view returns(uint) {
        StakerState memory state = _stakeStates[msg.sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        return _payoutPeriodFromCycle(state.depositCycle);
    }
}
