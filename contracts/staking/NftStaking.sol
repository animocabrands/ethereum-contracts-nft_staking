// SPDX-License-Identifier: MIT

pragma solidity 0.6.8;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/ERC1155TokenReceiver.sol";

/**
 * @title NFT Staking
 * Distribute ERC20 rewards over discrete-time schedules for the staking of NFTs.
 * This contract is designed on a self-service model, where users will stake NFTs, unstake NFTs and claim rewards through their own transactions only.
 */
abstract contract NftStaking is ERC1155TokenReceiver, Ownable {
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using ERC1155721SafeTransferFallback for IERC1155721Transferrable;

    event RewardsAdded(uint256 startPeriod, uint256 endPeriod, uint256 rewardsPerCycle);

    event Started();

    event NftStaked(address staker, uint256 cycle, uint256 tokenId, uint256 weight);
    event NftsBatchStaked(address staker, uint256 cycle, uint256[] tokenIds, uint256[] weights);

    event NftUnstaked(address staker, uint256 cycle, uint256 tokenId, uint256 weight);
    event NftsBatchUnstaked(address staker, uint256 cycle, uint256[] tokenIds, uint256[] weights);

    event RewardsClaimed(address staker, uint256 cycle, uint256 startPeriod, uint256 periods, uint256 amount);

    event HistoriesUpdated(address staker, uint256 startCycle, uint256 stakerStake, uint256 globalStake);

    event Disabled();

    /**
     * Used to represent the current staking status of an NFT.
     * Optimised for use in storage.
     */
    struct TokenInfo {
        address owner;
        uint64 weight;
        uint16 depositCycle;
        uint16 withdrawCycle;
    }

    /**
     * Used as a historical record of change of stake.
     * Stake represents an aggregation of staked token weights.
     * Optimised for use in storage.
     */
    struct Snapshot {
        uint128 stake;
        uint128 startCycle;
    }

    /**
     * Used to represent a staker's information about the next claim.
     * Optimised for use in storage.
     */
    struct NextClaim {
        uint16 period;
        uint64 globalSnapshotIndex;
        uint64 stakerSnapshotIndex;
    }

    /**
     * Used as a container to hold result values from computing rewards.
     */
    struct ComputedClaim {
        uint16 startPeriod;
        uint16 periods;
        uint256 amount;
    }

    bool public enabled = true;

    uint256 public totalRewardsPool;

    uint256 public startTimestamp;

    IERC20 public immutable rewardsTokenContract;
    IERC1155721Transferrable public immutable whitelistedNftContract;

    uint32 public immutable cycleLengthInSeconds;
    uint16 public immutable periodLengthInCycles;

    Snapshot[] public globalHistory;

    /* staker => snapshots*/
    mapping(address => Snapshot[]) public stakerHistories;

    /* staker => next claim */
    mapping(address => NextClaim) public nextClaims;

    /* tokenId => token info */
    mapping(uint256 => TokenInfo) public tokenInfos;

    /* period => rewardsPerCycle */
    mapping(uint256 => uint256) public rewardsSchedule;

    /* lost cycle => withdrawn? */
    mapping(uint256 => bool) public withdrawnLostCycles;

    modifier hasStarted() {
        require(startTimestamp != 0, "NftStaking: staking not started");
        _;
    }

    modifier hasNotStarted() {
        require(startTimestamp == 0, "NftStaking: staking has started");
        _;
    }

    modifier isEnabled() {
        require(enabled, "NftStaking: contract is not enabled");
        _;
    }

    modifier isNotEnabled() {
        require(!enabled, "NftStaking: contract is enabled");
        _;
    }

    /**
     * Constructor.
     * @dev Reverts if the period length value is zero.
     * @dev Reverts if the cycle length value is zero.
     * @dev Warning: cycles and periods need to be calibrated carefully. Small values will increase computation load while estimating and claiming rewards. Big values will increase the time to wait before a new period becomes claimable.
     * @param cycleLengthInSeconds_ The length of a cycle, in seconds.
     * @param periodLengthInCycles_ The length of a period, in cycles.
     * @param whitelistedNftContract_ The ERC1155-compliant (optional ERC721-compliance) contract from which staking is accepted.
     * @param rewardsTokenContract_ The ERC20-based token used as staking rewards.
     */
    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        IERC1155721Transferrable whitelistedNftContract_,
        IERC20 rewardsTokenContract_
    ) internal {
        require(cycleLengthInSeconds_ >= 1 minutes, "NftStaking: invalid cycle length");
        require(periodLengthInCycles_ >= 2, "NftStaking: invalid period length");

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        whitelistedNftContract = whitelistedNftContract_;
        rewardsTokenContract = rewardsTokenContract_;
    }

    /*                                            Admin Public Functions                                            */

    /**
     * Adds `rewardsPerCycle` reward amount for the period range from `startPeriod` to `endPeriod`, inclusive, to the rewards schedule.
     * The necessary amount of reward tokens is transferred to the contract. Cannot be used for past periods.
     * Can only be used to add rewards and not to remove them.
     * @dev Reverts if not called by the owner.
     * @dev Reverts if the start period is zero.
     * @dev Reverts if the end period precedes the start period.
     * @dev Reverts if attempting to add rewards for a period earlier than the current, after staking has started.
     * @dev Reverts if the reward tokens transfer fails.
     * @dev The rewards token contract emits an ERC20 Transfer event for the reward tokens transfer.
     * @dev Emits a RewardsAdded event.
     * @param startPeriod The starting period (inclusive).
     * @param endPeriod The ending period (inclusive).
     * @param rewardsPerCycle The reward amount to add for each cycle within range.
     */
    function addRewardsForPeriods(
        uint16 startPeriod,
        uint16 endPeriod,
        uint256 rewardsPerCycle
    ) external onlyOwner {
        require(startPeriod != 0 && startPeriod <= endPeriod, "NftStaking: wrong period range");

        uint16 periodLengthInCycles_ = periodLengthInCycles;

        if (startTimestamp != 0) {
            require(
                startPeriod >= _getCurrentPeriod(periodLengthInCycles_),
                "NftStaking: already committed reward schedule"
            );
        }

        for (uint256 period = startPeriod; period <= endPeriod; ++period) {
            rewardsSchedule[period] = rewardsSchedule[period].add(rewardsPerCycle);
        }

        uint256 addedRewards = rewardsPerCycle.mul(periodLengthInCycles_).mul(endPeriod - startPeriod + 1);

        totalRewardsPool = totalRewardsPool.add(addedRewards);

        require(
            rewardsTokenContract.transferFrom(_msgSender(), address(this), addedRewards),
            "NftStaking: failed to add funds to the reward pool"
        );

        emit RewardsAdded(startPeriod, endPeriod, rewardsPerCycle);
    }

    /**
     * Starts the first cycle of staking, enabling users to stake NFTs.
     * @dev Reverts if not called by the owner.
     * @dev Reverts if the staking has already started.
     * @dev Emits a Started event.
     */
    function start() public onlyOwner hasNotStarted {
        startTimestamp = now;
        emit Started();
    }

    /**
     * Permanently disables all staking and claiming.
     * This is an emergency recovery feature which is NOT part of the normal contract operation.
     * @dev Reverts if not called by the owner.
     * @dev Emits a Disabled event.
     */
    function disable() public onlyOwner {
        enabled = false;
        emit Disabled();
    }

    /**
     * Withdraws a specified amount of reward tokens from the contract it has been disabled.
     * @dev Reverts if not called by the owner.
     * @dev Reverts if the contract has not been disabled.
     * @dev Reverts if the reward tokens transfer fails.
     * @dev The rewards token contract emits an ERC20 Transfer event for the reward tokens transfer.
     * @param amount The amount to withdraw.
     */
    function withdrawRewardsPool(uint256 amount) public onlyOwner isNotEnabled {
        require(
            rewardsTokenContract.transfer(_msgSender(), amount),
            "NftStaking: failed to withdraw from the rewards pool"
        );
    }

    /**
     * Withdraws the rewards associated with a lost cycle (ie. a past cycle with 0 global stake).
     * @dev Reverts if not called by the owner.
     * @dev Reverts if `to` is the zero address.
     * @dev Reverts if the contract is not started.
     * @dev Reverts if `cycle` is not past.
     * @dev Reverts if the rewards for the lost cycle is already withdrawn.
     * @dev Reverts if `globalSnapshotIndex` is -1 but `cycle` is part of an existing snapshot.
     * @dev Reverts if `globalSnapshotIndex` is not -1 and does not point to a snapshot containing `cycle`.
     * @dev Reverts if `cycle` is not a lost cycle (ie. global stake > 0).
     * @dev The rewards token contract emits an ERC20 Transfer event for the reward tokens transfer.
     * @param to The address to send the lost cycle rewards to.
     * @param cycle The lost cycle.
     * @param globalSnapshotIndex The index of the global snapshot which contains `cycle`, or -1 if the cycle was before the first snapshot.
     */
    function withdrawLostCycleRewards(address to, uint16 cycle, int256 globalSnapshotIndex) external onlyOwner {
        require(to != address(0), "NftStaking: zero address");
        require(cycle < _getCycle(now), "NftStaking: non-past cycle");
        require(withdrawnLostCycles[cycle] == false, "NftStaking: already withdrawn");
        if (globalSnapshotIndex == -1) {
            require(
                globalHistory.length == 0 ||
                cycle < globalHistory[0].startCycle,
                "NftStaking: cycle has snapshot"
            );
        } else if (globalSnapshotIndex >= 0) {
            uint256 snapshotIndex = uint256(globalSnapshotIndex);
            Snapshot memory snapshot = globalHistory[snapshotIndex];
            require(
                cycle >= snapshot.startCycle,
                "NftStaking: cycle < snapshot"
            );
            require(
                globalHistory.length == snapshotIndex + 1 || // last snapshot
                cycle < globalHistory[snapshotIndex + 1].startCycle,
                "NftStaking: cycle > snapshot"
            );
            require(snapshot.stake == 0, "NftStaking: non-lost cycle");
        } else {
            revert("NftStaking: wrong index value");
        }

        uint16 period = _getPeriod(cycle, periodLengthInCycles);
        uint256 cycleRewards = rewardsSchedule[period];
        require(cycleRewards != 0, "NftStaking: rewardless cycle");
        withdrawnLostCycles[cycle] = true;
        rewardsTokenContract.transfer(to, cycleRewards);
    }

    /*                                             ERC1155TokenReceiver                                             */

    /**
     * ERC1155Receiver hook for single transfer.
     * @dev Reverts if the caller is not the whitelisted NFT contract.
     */
    function onERC1155Received(
        address, /*operator*/
        address from,
        uint256 id,
        uint256, /*value*/
        bytes calldata /*data*/
    ) external virtual override returns (bytes4) {
        require(address(whitelistedNftContract) == _msgSender(), "NftStaking: contract not whitelisted");
        _stakeNft(id, from);
        return _ERC1155_RECEIVED;
    }

    /**
     * ERC1155Receiver hook for batch transfer.
     * @dev Reverts if the caller is not the whitelisted NFT contract.
     */
    function onERC1155BatchReceived(
        address, /*operator*/
        address from,
        uint256[] calldata ids,
        uint256[] calldata, /*values*/
        bytes calldata /*data*/
    ) external virtual override returns (bytes4) {
        require(address(whitelistedNftContract) == _msgSender(), "NftStaking: contract not whitelisted");
        _batchStakeNfts(ids, from);
        return _ERC1155_BATCH_RECEIVED;
    }

    /*                                            Staking Public Functions                                            */

    /**
     * Unstakes a deposited NFT from the contract and updates the histories accordingly.
     * The NFT's weight will not count for the current cycle.
     * @dev Reverts if the caller is not the original owner of the NFT.
     * @dev While the contract is enabled, reverts if the NFT is still frozen.
     * @dev Reverts if the NFT transfer back to the original owner fails.
     * @dev If ERC1155 safe transfers are supported by the receiver wallet, the whitelisted NFT contract emits an ERC1155 TransferSingle event for the NFT transfer back to the staker.
     * @dev If ERC1155 safe transfers are not supported by the receiver wallet, the whitelisted NFT contract emits an ERC721 Transfer event for the NFT transfer back to the staker.
     * @dev While the contract is enabled, emits a HistoriesUpdated event.
     * @dev Emits a NftUnstaked event.
     * @param tokenId The token identifier, referencing the NFT being unstaked.
     */
    function unstakeNft(uint256 tokenId) external virtual {
        TokenInfo memory tokenInfo = tokenInfos[tokenId];

        require(tokenInfo.owner == _msgSender(), "NftStaking: not staked for owner");

        uint16 currentCycle = _getCycle(now);
        uint64 weight = tokenInfo.weight;

        if (enabled) {
            // ensure that at least an entire cycle has elapsed before unstaking the token to avoid
            // an exploit where a full cycle would be claimable if staking just before the end
            // of a cycle and unstaking right after the start of the new cycle
            require(currentCycle - tokenInfo.depositCycle >= 2, "NftStaking: token still frozen");

            _updateHistories(_msgSender(), -int128(weight), currentCycle);

            // clear the token owner to ensure it cannot be unstaked again without being re-staked
            tokenInfo.owner = address(0);

            // set the withdrawal cycle to ensure it cannot be re-staked during the same cycle
            tokenInfo.withdrawCycle = currentCycle;

            tokenInfos[tokenId] = tokenInfo;
        }

        whitelistedNftContract.safeTransferFromWithFallback(address(this), _msgSender(), tokenId, 1, "");
        emit NftUnstaked(_msgSender(), currentCycle, tokenId, weight);
        _onUnstake(_msgSender(), weight);
    }

    /**
     * Unstakes a batch of deposited NFTs from the contract.
     * @dev Reverts if `tokenIds` is empty.
     * @dev Reverts if the caller is not the original owner of any of the NFTs.
     * @dev While the contract is enabled, reverts if any NFT is being unstaked before its staking freeze duration has elapsed.
     * @dev While the contract is enabled, creates any missing snapshots, up-to the current cycle.
     * @dev While the contract is enabled, emits the HistoriesUpdated event.
     * @dev Emits the NftsBatchUnstaked event for each NFT unstaked.
     * @param tokenIds The token identifiers, referencing the NFTs being unstaked.
     */
    function batchUnstakeNfts(uint256[] calldata tokenIds) external {
        uint256 numTokens = tokenIds.length;
        require(numTokens != 0, "NftStaking: no tokens");

        uint16 currentCycle = _getCycle(now);
        int128 totalUnstakedWeight = 0;
        uint256[] memory values = new uint256[](numTokens);
        uint256[] memory weights = new uint256[](numTokens);

        for (uint256 index = 0; index < numTokens; ++index) {
            uint256 tokenId = tokenIds[index];

            TokenInfo memory tokenInfo = tokenInfos[tokenId];

            require(tokenInfo.owner == _msgSender(), "NftStaking: not staked for owner");

            if (enabled) {
                // ensure that at least an entire cycle has elapsed before
                // unstaking the token to avoid an exploit where a a fukll cycle
                // would be claimable if staking just before the end of a cycle
                // and unstaking right after the start of the new cycle
                require(currentCycle - tokenInfo.depositCycle >= 2, "NftStaking: token still frozen");

                // clear the token owner to ensure it cannot be unstaked again
                // without being re-staked
                tokenInfos[tokenId].owner = address(0);

                // we can use unsafe math here since the maximum total staked
                // weight that a staker can unstake must fit within uint128
                // (i.e. the staker snapshot stake limit)
                uint64 weight = tokenInfo.weight;
                totalUnstakedWeight += weight; // this is safe
                weights[index] = weight;
            }

            values[index] = 1;
        }

        if (enabled) {
            _updateHistories(_msgSender(), -totalUnstakedWeight, currentCycle);
        }

        whitelistedNftContract.safeBatchTransferFromWithFallback(address(this), _msgSender(), tokenIds, values, "");
        emit NftsBatchUnstaked(_msgSender(), currentCycle, tokenIds, weights);
        _onUnstake(_msgSender(), uint256(totalUnstakedWeight));
    }

    /**
     * Estimates the claimable rewards for the specified maximum number of past periods, starting at the next claimable period.
     * Estimations can be done only for periods which have already ended.
     * The maximum number of periods to claim can be calibrated to chunk down claims in several transactions to accomodate gas constraints.
     * @param maxPeriods The maximum number of periods to calculate for.
     * @return startPeriod The first period on which the computation starts.
     * @return periods The number of periods computed for.
     * @return amount The total claimable rewards.
     */
    function estimateRewards(uint16 maxPeriods)
        external
        view
        isEnabled
        hasStarted
        returns (
            uint16 startPeriod,
            uint16 periods,
            uint256 amount
        )
    {
        (ComputedClaim memory claim, ) = _computeRewards(_msgSender(), maxPeriods);
        startPeriod = claim.startPeriod;
        periods = claim.periods;
        amount = claim.amount;
    }

    /**
     * Claims the claimable rewards for the specified maximum number of past periods, starting at the next claimable period.
     * Claims can be done only for periods which have already ended.
     * The maximum number of periods to claim can be calibrated to chunk down claims in several transactions to accomodate gas constraints.
     * @dev Reverts if the reward tokens transfer fails.
     * @dev The rewards token contract emits an ERC20 Transfer event for the reward tokens transfer.
     * @dev Emits a RewardsClaimed event.
     * @param maxPeriods The maximum number of periods to claim for.
     */
    function claimRewards(uint16 maxPeriods) external isEnabled hasStarted {
        NextClaim memory nextClaim = nextClaims[_msgSender()];

        (ComputedClaim memory claim, NextClaim memory newNextClaim) = _computeRewards(_msgSender(), maxPeriods);

        // free up memory on already processed staker snapshots
        Snapshot[] storage stakerHistory = stakerHistories[_msgSender()];
        while (nextClaim.stakerSnapshotIndex < newNextClaim.stakerSnapshotIndex) {
            delete stakerHistory[nextClaim.stakerSnapshotIndex++];
        }

        if (claim.periods == 0) {
            return;
        }

        if (nextClaims[_msgSender()].period == 0) {
            return;
        }

        Snapshot memory lastStakerSnapshot = stakerHistory[stakerHistory.length - 1];

        uint256 lastClaimedCycle = (claim.startPeriod + claim.periods - 1) * periodLengthInCycles;
        if (
            lastClaimedCycle >= lastStakerSnapshot.startCycle && // the claim reached the last staker snapshot
            lastStakerSnapshot.stake == 0 // and nothing is staked in the last staker snapshot
        ) {
            // re-init the next claim
            delete nextClaims[_msgSender()];
        } else {
            nextClaims[_msgSender()] = newNextClaim;
        }

        if (claim.amount != 0) {
            require(rewardsTokenContract.transfer(_msgSender(), claim.amount), "NftStaking: failed to transfer rewards");
        }

        emit RewardsClaimed(_msgSender(), _getCycle(now), claim.startPeriod, claim.periods, claim.amount);
    }

    /*                                            Utility Public Functions                                            */

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() external view returns (uint16) {
        return _getCycle(now);
    }

    /**
     * Retrieves the current period (index-1 based).
     * @return The current period (index-1 based).
     */
    function getCurrentPeriod() external view returns (uint16) {
        return _getCurrentPeriod(periodLengthInCycles);
    }

    /**
     * Retrieves the last global snapshot index, if any.
     * @dev Reverts if the global history is empty.
     * @return The last global snapshot index.
     */
    function lastGlobalSnapshotIndex() external view returns (uint256) {
        uint256 length = globalHistory.length;
        require(length != 0, "NftStaking: empty global history");
        return length - 1;
    }

    /**
     * Retrieves the last staker snapshot index, if any.
     * @dev Reverts if the staker history is empty.
     * @return The last staker snapshot index.
     */
    function lastStakerSnapshotIndex(address staker) external view returns (uint256) {
        uint256 length = stakerHistories[staker].length;
        require(length != 0, "NftStaking: empty staker history");
        return length - 1;
    }

    /*                                            Staking Internal Functions                                            */

    /**
     * Stakes the NFT received by the contract for its owner. The NFT's weight will count for the current cycle.
     * @dev Reverts if `tokenId` is still on cooldown.
     * @dev Emits an HistoriesUpdated event.
     * @dev Emits an NftStaked event.
     * @param tokenId Identifier of the staked NFT.
     * @param owner Owner of the staked NFT.
     */
    function _stakeNft(uint256 tokenId, address owner) internal isEnabled hasStarted {
        uint64 weight = _validateAndGetNftWeight(tokenId);

        uint16 periodLengthInCycles_ = periodLengthInCycles;
        uint16 currentCycle = _getCycle(now);

        _updateHistories(owner, int128(weight), currentCycle);

        // initialise the next claim if it was the first stake for this staker or if
        // the next claim was re-initialised (ie. rewards were claimed until the last
        // staker snapshot and the last staker snapshot has no stake)
        if (nextClaims[owner].period == 0) {
            uint16 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles_);
            nextClaims[owner] = NextClaim(currentPeriod, uint64(globalHistory.length - 1), 0);
        }

        uint16 withdrawCycle = tokenInfos[tokenId].withdrawCycle;
        require(currentCycle != withdrawCycle, "NftStaking: unstaked token cooldown");

        // set the staked token's info
        tokenInfos[tokenId] = TokenInfo(owner, weight, currentCycle, 0);

        emit NftStaked(owner, currentCycle, tokenId, weight);
        _onStake(owner, weight);
    }

    /**
     * Stakes the NFT received by the contract for its owner. The NFT's weight will count for the current cycle.
     * @dev Reverts if `tokenIds` is empty.
     * @dev Reverts if one of `tokenIds` is still on cooldown.
     * @dev Emits an HistoriesUpdated event.
     * @dev Emits an NftStaked event.
     * @param tokenIds Identifiers of the staked NFTs.
     * @param owner Owner of the staked NFTs.
     */
    function _batchStakeNfts(uint256[] memory tokenIds, address owner) internal isEnabled hasStarted {
        uint256 numTokens = tokenIds.length;
        require(numTokens != 0, "NftStaking: no tokens");

        uint16 currentCycle = _getCycle(now);
        uint128 totalStakedWeight = 0;
        uint256[] memory weights = new uint256[](numTokens);

        for (uint256 index = 0; index < numTokens; ++index) {
            uint256 tokenId = tokenIds[index];
            require(currentCycle != tokenInfos[tokenId].withdrawCycle, "NftStaking: unstaked token cooldown");
            uint64 weight = _validateAndGetNftWeight(tokenId);
            totalStakedWeight += weight; // This is safe
            weights[index] = weight;
            tokenInfos[tokenId] = TokenInfo(owner, weight, currentCycle, 0);
        }

        _updateHistories(owner, int128(totalStakedWeight), currentCycle);

        // initialise the next claim if it was the first stake for this staker or if
        // the next claim was re-initialised (ie. rewards were claimed until the last
        // staker snapshot and the last staker snapshot has no stake)
        if (nextClaims[owner].period == 0) {
            uint16 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles);
            nextClaims[owner] = NextClaim(currentPeriod, uint64(globalHistory.length - 1), 0);
        }

        emit NftsBatchStaked(owner, currentCycle, tokenIds, weights);
        _onStake(owner, totalStakedWeight);
    }

    /**
     * Calculates the amount of rewards for a staker over a capped number of periods.
     * @dev Processes until the specified maximum number of periods to claim is reached, or the last computable period is reached, whichever occurs first.
     * @param staker The staker for whom the rewards will be computed.
     * @param maxPeriods Maximum number of periods over which to compute the rewards.
     * @return claim the result of computation
     * @return nextClaim the next claim which can be used to update the staker's state
     */
    function _computeRewards(address staker, uint16 maxPeriods)
        internal
        view
        returns (ComputedClaim memory claim, NextClaim memory nextClaim)
    {
        // computing 0 periods
        if (maxPeriods == 0) {
            return (claim, nextClaim);
        }

        // the history is empty
        if (globalHistory.length == 0) {
            return (claim, nextClaim);
        }

        nextClaim = nextClaims[staker];
        claim.startPeriod = nextClaim.period;

        // nothing has been staked yet
        if (claim.startPeriod == 0) {
            return (claim, nextClaim);
        }

        uint16 periodLengthInCycles_ = periodLengthInCycles;
        uint16 endClaimPeriod = _getCurrentPeriod(periodLengthInCycles_);

        // current period is not claimable
        if (nextClaim.period == endClaimPeriod) {
            return (claim, nextClaim);
        }

        // retrieve the next snapshots if they exist
        Snapshot[] memory stakerHistory = stakerHistories[staker];

        Snapshot memory globalSnapshot = globalHistory[nextClaim.globalSnapshotIndex];
        Snapshot memory stakerSnapshot = stakerHistory[nextClaim.stakerSnapshotIndex];
        Snapshot memory nextGlobalSnapshot;
        Snapshot memory nextStakerSnapshot;

        if (nextClaim.globalSnapshotIndex != globalHistory.length - 1) {
            nextGlobalSnapshot = globalHistory[nextClaim.globalSnapshotIndex + 1];
        }
        if (nextClaim.stakerSnapshotIndex != stakerHistory.length - 1) {
            nextStakerSnapshot = stakerHistory[nextClaim.stakerSnapshotIndex + 1];
        }

        // excludes the current period
        claim.periods = endClaimPeriod - nextClaim.period;

        if (maxPeriods < claim.periods) {
            claim.periods = maxPeriods;
        }

        // re-calibrate the end claim period based on the actual number of
        // periods to claim. nextClaim.period will be updated to this value
        // after exiting the loop
        endClaimPeriod = nextClaim.period + claim.periods;

        // iterate over periods
        while (nextClaim.period != endClaimPeriod) {
            uint16 nextPeriodStartCycle = nextClaim.period * periodLengthInCycles_ + 1;
            uint256 rewardPerCycle = rewardsSchedule[nextClaim.period];
            uint256 startCycle = nextPeriodStartCycle - periodLengthInCycles_;
            uint256 endCycle = 0;

            // iterate over global snapshots
            while (endCycle != nextPeriodStartCycle) {
                // find the range-to-claim starting cycle, where the current
                // global snapshot, the current staker snapshot, and the current
                // period overlap
                if (globalSnapshot.startCycle > startCycle) {
                    startCycle = globalSnapshot.startCycle;
                }
                if (stakerSnapshot.startCycle > startCycle) {
                    startCycle = stakerSnapshot.startCycle;
                }

                // find the range-to-claim ending cycle, where the current
                // global snapshot, the current staker snapshot, and the current
                // period no longer overlap. The end cycle is exclusive of the
                // range-to-claim and represents the beginning cycle of the next
                // range-to-claim
                endCycle = nextPeriodStartCycle;
                if ((nextGlobalSnapshot.startCycle != 0) && (nextGlobalSnapshot.startCycle < endCycle)) {
                    endCycle = nextGlobalSnapshot.startCycle;
                }

                // only calculate and update the claimable rewards if there is
                // something to calculate with
                if ((globalSnapshot.stake != 0) && (stakerSnapshot.stake != 0) && (rewardPerCycle != 0)) {
                    uint256 snapshotReward = (endCycle - startCycle).mul(rewardPerCycle).mul(stakerSnapshot.stake);
                    snapshotReward /= globalSnapshot.stake;

                    claim.amount = claim.amount.add(snapshotReward);
                }

                // advance the current global snapshot to the next (if any)
                // if its cycle range has been fully processed and if the next
                // snapshot starts at most on next period first cycle
                if (nextGlobalSnapshot.startCycle == endCycle) {
                    globalSnapshot = nextGlobalSnapshot;
                    ++nextClaim.globalSnapshotIndex;

                    if (nextClaim.globalSnapshotIndex != globalHistory.length - 1) {
                        nextGlobalSnapshot = globalHistory[nextClaim.globalSnapshotIndex + 1];
                    } else {
                        nextGlobalSnapshot = Snapshot(0, 0);
                    }
                }

                // advance the current staker snapshot to the next (if any)
                // if its cycle range has been fully processed and if the next
                // snapshot starts at most on next period first cycle
                if (nextStakerSnapshot.startCycle == endCycle) {
                    stakerSnapshot = nextStakerSnapshot;
                    ++nextClaim.stakerSnapshotIndex;

                    if (nextClaim.stakerSnapshotIndex != stakerHistory.length - 1) {
                        nextStakerSnapshot = stakerHistory[nextClaim.stakerSnapshotIndex + 1];
                    } else {
                        nextStakerSnapshot = Snapshot(0, 0);
                    }
                }
            }

            ++nextClaim.period;
        }

        return (claim, nextClaim);
    }

    /**
     * Updates the global and staker histories at the current cycle with a new difference in stake.
     * @dev Emits a HistoriesUpdated event.
     * @param staker The staker who is updating the history.
     * @param stakeDelta The difference to apply to the current stake.
     * @param currentCycle The current cycle.
     */
    function _updateHistories(
        address staker,
        int128 stakeDelta,
        uint16 currentCycle
    ) internal {
        uint256 stakerSnapshotIndex = _updateHistory(stakerHistories[staker], stakeDelta, currentCycle);
        uint256 globalSnapshotIndex = _updateHistory(globalHistory, stakeDelta, currentCycle);

        emit HistoriesUpdated(
            staker,
            currentCycle,
            stakerHistories[staker][stakerSnapshotIndex].stake,
            globalHistory[globalSnapshotIndex].stake
        );
    }

    /**
     * Updates the history at the current cycle with a new difference in stake.
     * @dev It will update the latest snapshot if it starts at the current cycle, otherwise will create a new snapshot with the updated stake.
     * @param history The history to update.
     * @param stakeDelta The difference to apply to the current stake.
     * @param currentCycle The current cycle.
     * @return snapshotIndex Index of the snapshot that was updated or created (i.e. the latest snapshot index).
     */
    function _updateHistory(
        Snapshot[] storage history,
        int128 stakeDelta,
        uint16 currentCycle
    ) internal returns (uint256 snapshotIndex) {
        uint256 historyLength = history.length;
        uint128 snapshotStake;

        if (historyLength != 0) {
            // there is an existing snapshot
            snapshotIndex = historyLength - 1;
            Snapshot storage snapshot = history[snapshotIndex];
            snapshotStake = uint256(int256(snapshot.stake).add(stakeDelta)).toUint128();

            if (snapshot.startCycle == currentCycle) {
                // update the snapshot if it starts on the current cycle
                snapshot.stake = snapshotStake;
                return snapshotIndex;
            }

            // update the snapshot index (as a reflection that a new latest
            // snapshot will be added to the history), if there was already an
            // existing snapshot
            snapshotIndex += 1;
        } else {
            // the snapshot index (as a reflection that a new latest snapshot
            // will be added to the history) should already be initialized
            // correctly to the default value 0

            // the stake delta will not be negative, if we have no history, as
            // that would indicate that we are unstaking without having staked
            // anything first
            snapshotStake = uint128(stakeDelta);
        }

        Snapshot memory snapshot;
        snapshot.stake = snapshotStake;
        snapshot.startCycle = currentCycle;

        // add a new snapshot in the history
        history.push(snapshot);
    }

    /*                                           Utility Internal Functions                                           */

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @dev Reverts if the specified timestamp is earlier than the beginning of the staking schedule
     * @param timestamp The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 timestamp) internal view returns (uint16) {
        require(timestamp >= startTimestamp, "NftStaking: timestamp preceeds contract start");
        return (((timestamp - startTimestamp) / uint256(cycleLengthInSeconds)) + 1).toUint16();
    }

    /**
     * Retrieves the period (index-1 based) for the specified cycle and period length.
     * @dev reverts if the specified cycle is zero.
     * @param cycle The cycle within the period to retrieve.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The period (index-1 based) for the specified cycle and period length.
     */
    function _getPeriod(uint16 cycle, uint16 periodLengthInCycles_) internal pure returns (uint16) {
        require(cycle != 0, "NftStaking: cycle cannot be zero");
        return (cycle - 1) / periodLengthInCycles_ + 1;
    }

    /**
     * Retrieves the current period (index-1 based).
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The current period (index-1 based).
     */
    function _getCurrentPeriod(uint16 periodLengthInCycles_) internal view returns (uint16) {
        return _getPeriod(_getCycle(now), periodLengthInCycles_);
    }

    /*                                                Internal Hooks                                                */

    /**
     * Abstract function which validates whether or not an NFT is accepted for staking and retrieves its associated weight.
     * @dev MUST throw if the token is invalid.
     * @param tokenId uint256 token identifier of the NFT.
     * @return uint64 the weight of the NFT.
     */
    function _validateAndGetNftWeight(uint256 tokenId) internal virtual view returns (uint64);

    /**
     * Hook called on NFT(s) staking.
     * @param owner uint256 the NFT(s) owner.
     * @param totalWeight uint256 the total weight of the staked NFT(s).
     */
    function _onStake(
        address owner,
        uint256 totalWeight
    ) internal virtual {}

    /**
     * Hook called on NFT(s) unstaking.
     * @param owner uint256 the NFT(s) owner.
     * @param totalWeight uint256 the total weight of the unstaked NFT(s).
     */
    function _onUnstake(
        address owner,
        uint256 totalWeight
    ) internal virtual {}
}

/**
 * @title IERC1155721Transferrable
 * Interface for transferring 1155 and/or 721 NFTs.
 */
interface IERC1155721Transferrable {
    /**
     * @notice Transfers `values` amount(s) of `ids` from the `from` address to the `to` address specified (with safety call).
     * @dev Caller must be approved to manage the tokens being transferred out of the `from` account (see "Approval" section of the standard).
     * MUST revert if `to` is the zero address.
     * MUST revert if length of `ids` is not the same as length of `values`.
     * MUST revert if any of the balance(s) of the holder(s) for token(s) in `ids` is lower than the respective amount(s) in `values` sent to the recipient.
     * MUST revert on any other error.
     * MUST emit `TransferSingle` or `TransferBatch` event(s) such that all the balance changes are reflected (see "Safe Transfer Rules" section of the standard).
     * Balance changes and events MUST follow the ordering of the arrays (_ids[0]/_values[0] before _ids[1]/_values[1], etc).
     * After the above conditions for the transfer(s) in the batch are met, this function MUST check if `to` is a smart contract (e.g. code size > 0). If so, it MUST call the relevant `ERC1155TokenReceiver` hook(s) on `to` and act appropriately (see "Safe Transfer Rules" section of the standard).
     * @param from Source address
     * @param to Target address
     * @param ids IDs of each token type (order and length must match _values array)
     * @param values Transfer amounts per token type (order and length must match _ids array)
     * @param data Additional data with no specified format, MUST be sent unaltered in call to the `ERC1155TokenReceiver` hook(s) on `to`
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external;

    /**
     * ERC1155: Transfers `value` amount of an `id` from  `from` to `to` (with safety call).
     * @dev Caller must be approved to manage the tokens being transferred out of the `from` account (see "Approval" section of the standard).
     * @dev MUST revert if `to` is the zero address.
     * @dev MUST revert if balance of holder for token `id` is lower than the `value` sent.
     * @dev MUST revert on any other error.
     * @dev MUST emit the `TransferSingle` event to reflect the balance change (see "Safe Transfer Rules" section of the standard).
     * @dev After the above conditions are met, this function MUST check if `to` is a smart contract (e.g. code size > 0). If so, it MUST call `onERC1155Received` on `to` and act appropriately (see "Safe Transfer Rules" section of the standard).
     * @param from Source address
     * @param to Target address
     * @param id ID of the token type
     * @param value Transfer amount
     * @param data Additional data with no specified format, MUST be sent unaltered in call to `onERC1155Received` on `to`
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external;

    /**
     * @notice ERC721: Transfers the ownership of a given token ID to another address.
     * Usage of this method is discouraged, use `safeTransferFrom` whenever possible.
     * Requires the msg sender to be the owner, approved, or operator.
     * @param from current owner of the token.
     * @param to address to receive the ownership of the given token ID.
     * @param tokenId uint256 ID of the token to be transferred.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external;
}

/**
 * @title ERC1155721SafeTransferFallback
 * Library used to fall back on ERC721 non-safe transfer(s)
 * in case of ERC1155 safe transfer failure. A failure can be
 * caused by a contract-based wallet not implementing the
 * ERC1155Receiver interface.
 */
library ERC1155721SafeTransferFallback {
    function safeBatchTransferFromWithFallback(
        IERC1155721Transferrable self,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) internal {
        try self.safeBatchTransferFrom(from, to, ids, values, data)  {} catch {
            uint256 length = ids.length;
            for (uint256 i = 0; i < length; ++i) {
                self.transferFrom(from, to, ids[i]);
            }
        }
    }

    function safeTransferFromWithFallback(
        IERC1155721Transferrable self,
        address from,
        address to,
        uint256 id,
        uint256 value,
        bytes memory data
    ) internal {
        try self.safeTransferFrom(from, to, id, value, data)  {} catch {
            self.transferFrom(from, to, id);
        }
    }
}
