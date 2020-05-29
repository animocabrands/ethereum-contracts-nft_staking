// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "./NftStaking.sol";

abstract contract NftStakingTestable is NftStaking {

    constructor(
        uint256 cycleLength_,
        uint256 payoutPeriodLength_,
        uint256 freezeDurationAfterStake_,
        // uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint256[] memory values,
        uint256[] memory valueWeights
    ) NftStaking(
        cycleLength_,
        payoutPeriodLength_,
        freezeDurationAfterStake_,
        // rewardPoolBase_,
        whitelistedNftContract_,
        dividendToken_,
        values,
        valueWeights
    ) public {}

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

        if (dividendsSnapshots.length != 0) {
            snapshot = dividendsSnapshots[dividendsSnapshots.length - 1];
        }

        return (
            snapshot.cycleRangeStart,
            snapshot.cycleRangeEnd,
            snapshot.stakedWeight,
            snapshot.tokensToClaim
        );
    }

    function dividendsSnapshot(uint256 targetCycle)
    public
    view
    returns(
        uint32 cycleRangeStart,
        uint32 cycleRangeEnd,
        uint64 stakedWeight,
        uint128 tokensToClaim,
        uint256 snapshotIndex
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

    function totalSnapshots() public view returns(uint256) {
        return dividendsSnapshots.length;
    }

    function getOrCreateLatestCycleSnapshot(uint256 offset) public returns(
        uint32 cycleRangeStart,
        uint32 cycleRangeEnd,
        uint64 stakedWeight,
        uint128 tokensToClaim
    ) {
        (DividendsSnapshot memory snapshot, ) = super._getOrCreateLatestCycleSnapshot(offset);
        cycleRangeStart = snapshot.cycleRangeStart;
        cycleRangeEnd = snapshot.cycleRangeEnd;
        stakedWeight = snapshot.stakedWeight;
        tokensToClaim = snapshot.tokensToClaim;
    }

    function currentPayoutPeriod() public view returns(uint256) {
        StakerState memory state = stakeStates[msg.sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        return _getPayoutPeriod(state.cycleToRename, periodLengthInCycles);
    }
}
