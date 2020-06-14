// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "./NftStaking.sol";

abstract contract NftStakingTestable is NftStaking {

    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_
    ) NftStaking(
        cycleLengthInSeconds_,
        periodLengthInCycles_,
        whitelistedNftContract_,
        rewardsToken_
    ) public {}

    function getLatestGlobalSnapshot()
    public
    view
    returns(
        uint128 startCycle,
        uint128 stake
    )
    {
        Snapshot memory globalSnapshot;

        if (globalHistory.length != 0) {
            globalSnapshot = globalHistory[globalHistory.length - 1];
        }

        startCycle = globalSnapshot.startCycle;
        stake = globalSnapshot.stake;
    }

    function getLatestStakerSnapshot(address staker)
    public
    view
    returns(
        uint128 startCycle,
        uint128 stake
    )
    {
        Snapshot[] memory stakerHistory = stakerHistories[staker];
        Snapshot memory stakerSnapshot;

        if (stakerHistory.length != 0) {
            stakerSnapshot = stakerHistory[stakerHistory.length - 1];
        }

        startCycle = stakerSnapshot.startCycle;
        stake = stakerSnapshot.stake;
    }
}
