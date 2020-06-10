// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "./NftStaking.sol";

abstract contract NftStakingTestable is NftStaking {

    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        uint16 freezeDurationInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_
    ) NftStaking(
        cycleLengthInSeconds_,
        periodLengthInCycles_,
        freezeDurationInCycles_,
        whitelistedNftContract_,
        rewardsToken_
    ) public {}

    function getLatestSnapshot()
    public
    view
    returns(
        uint16 startCycle,
        uint16 endCycle,
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

    function getSnapshot(uint64 targetCycle)
    public
    view
    returns(
        uint16 startCycle,
        uint16 endCycle,
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
        uint16 period,
        uint16 startCycle,
        uint16 endCycle,
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
}
