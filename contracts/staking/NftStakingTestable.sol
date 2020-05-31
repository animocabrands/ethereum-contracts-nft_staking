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
        uint64 stakedWeight,
        uint128 dividendsToClaim
    )
    {
        DividendsSnapshot memory snapshot;

        if (dividendsSnapshots.length != 0) {
            snapshot = dividendsSnapshots[dividendsSnapshots.length - 1];
        }

        return (
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stakedWeight,
            snapshot.dividendsToClaim
        );
    }

    function dividendsSnapshot(uint32 targetCycle)
    public
    view
    returns(
        uint32 startCycle,
        uint32 endCycle,
        uint64 stakedWeight,
        uint128 dividendsToClaim,
        uint256 snapshotIndex
    )
    {
        DividendsSnapshot memory snapshot;
        (snapshot, snapshotIndex) = _findDividendsSnapshot(targetCycle);
        return (
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stakedWeight,
            snapshot.dividendsToClaim,
            snapshotIndex
        );
    }

    function totalSnapshots() public view returns(uint256) {
        return dividendsSnapshots.length;
    }

    function getOrCreateLatestCycleSnapshot(uint256 offset) public returns(
        uint32 startCycle,
        uint32 endCycle,
        uint64 stakedWeight,
        uint128 dividendsToClaim
    ) {
        (DividendsSnapshot memory snapshot, ) = super._getOrCreateLatestCycleSnapshot(offset);
        startCycle = snapshot.startCycle;
        endCycle = snapshot.endCycle;
        stakedWeight = snapshot.stakedWeight;
        dividendsToClaim = snapshot.dividendsToClaim;
    }

    function currentPayoutPeriod() public view returns(uint256) {
        StakerState memory state = stakeStates[msg.sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        return _getPeriod(state.unclaimedCycle, periodLengthInCycles);
    }
}
