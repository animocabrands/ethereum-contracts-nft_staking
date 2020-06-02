// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

interface INftStaking {

    event PayoutSet(
        uint256 startPeriod,
        uint256 endPeriod,
        uint128 payoutPerCycle
    );

    event NftStaked(
        address indexed staker,
        uint256 indexed tokenId,
        uint32 indexed cycle // the cycle in which the token was deposited
    );

    event NftUnstaked(
        address indexed staker,
        uint256 indexed tokenId,
        uint32 indexed cycle
    );

    event DividendsClaimed(
        address indexed staker,
        uint256 snapshotStartIndex,
        uint256 snapshotEndIndex,
        uint256 amount
    );

    event SnapshotUpdated(
        uint256 indexed index, // index (index-0 based) of the snapshot in the history list
        uint32 indexed startCycle,
        uint32 indexed endCycle,
        uint64 totalWeight // Total weight of all NFTs staked
    );
}
