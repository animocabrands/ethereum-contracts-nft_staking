// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "./NftStaking.sol";

abstract contract NftStakingTestable is NftStaking {

    constructor(
        uint256 cycleLength_,
        uint256 payoutPeriodLength_,
        uint256 freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address dividendToken_
    ) NftStaking(
        cycleLength_,
        payoutPeriodLength_,
        freezeDurationAfterStake_,
        whitelistedNftContract_,
        dividendToken_
    ) public {}

    function getLatestSnapshot()
    public
    view
    returns(
        uint32 startCycle,
        uint32 endCycle,
        uint64 stake
    )
    {
        Snapshot memory snapshot;

        if (snapshots.length != 0) {
            snapshot = snapshots[snapshots.length - 1];
        }

        return (
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stake
        );
    }

    function getSnapshot(uint32 targetCycle)
    public
    view
    returns(
        uint32 startCycle,
        uint32 endCycle,
        uint64 stake,
        uint256 snapshotIndex
    )
    {
        Snapshot memory snapshot;
        (snapshot, snapshotIndex) = _findSnapshot(targetCycle);
        return (
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stake,
            snapshotIndex
        );
    }

    function totalSnapshots() public view returns(uint256) {
        return snapshots.length;
    }

    function getOrCreateSnapshot() public returns(
        uint256 period,
        uint32 startCycle,
        uint32 endCycle,
        uint64 stake
    ) {
        ensureSnapshots(0);
        uint256 snapshotIndex = snapshots.length - 1;
        Snapshot memory snapshot = snapshots[snapshotIndex];

        period = snapshot.period;
        startCycle = snapshot.startCycle;
        endCycle = snapshot.endCycle;
        stake = snapshot.stake;
    }

    function currentPayoutPeriod() public view returns(uint256) {
        StakerState memory state = stakerStates[msg.sender];
        if (state.stake == 0) {
            return 0;
        }

        return _getPeriod(state.nextClaimableCycle, periodLengthInCycles);
    }
}
