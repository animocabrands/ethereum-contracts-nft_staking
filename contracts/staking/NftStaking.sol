// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC721/IERC721.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/ERC1155TokenReceiver.sol";

abstract contract NftStaking is ERC1155TokenReceiver, Ownable {

    using SafeMath for uint256;
    using SafeCast for uint256;

    uint40 internal constant _DIVS_PRECISION = 10 ** 10; // used to preserve significant figures in floating point calculations

    // emitted when a reward schedule for a range of periods is set
    event RewardSet(
        uint32 startPeriod, // starting period (inclusive) for the reward schedule
        uint32 endPeriod, // ending period (inclusive ) for the reward schedule
        uint128 rewardPerCycle // amount of rewards allocated per-cycle over the reward schedule
    );

    // emitted when an NFT is staked
    event NftStaked(
        address staker, // wallet address of the staker staking the NFT
        uint256 tokenId, // identifier for the NFT that was staked
        uint64 cycle // the cycle in which the NFT was staked
    );

    // emitted when and NFT is unstaked
    event NftUnstaked(
        address staker, // wallet address of the staker unstaking the NFT
        uint256 tokenId, // identifier for the NFT that was unstaked
        uint64 cycle // the cycle in which the NFT was unstaked
    );

    // emitted when rewards are claimed by a staker
    event RewardsClaimed(
        address staker, // wallet address of the staker claiming the rewards
        uint256 snapshotStartIndex, // starting snapshot index (inclusive) over which the rewards are claimed
        uint256 snapshotEndIndex, // ending snapshot index (inclusive) over which the rewards are claimed
        uint256 amount // amount of rewards claimed
    );

    // emitted when a snapshot is created or updated
    event SnapshotUpdated(
        uint256 index, // index (index-0 based) of the snapshot in the history list
        uint64 startCycle, // starting cycle (inclusive) of the snapshot range
        uint64 endCycle, // ending cycle (inclusive) of the snapshot range
        uint32 stake // total stake of all NFTs staked in the snapshot
    );

    // used to track aggregate changes in stake over time
    struct Snapshot {
        uint32 period; // the period in which the snapshot is contained within
        uint64 startCycle; // starting cycle (inclusive) of the snapshot range
        uint64 endCycle; // ending cycle (inclusive) of the snapshot range
        uint32 stake; // total stake of all NFTs staked in the snapshot
    }

    // used to track a staker's aggregate staking state
    struct StakerState {
        uint64 nextClaimableCycle; // the next cycle which the staker can begin to claim rewards
        uint32 stake; // total stake of all NFTs staked by the staker
    }

    // used to track an NFTs staking state
    struct TokenInfo {
        address owner; // wallet address of the original owner of the NFT
        uint64 depositCycle; // cycle in which the NFT was staked
        uint32 stake; // NFT stake weight
    }

    // used as a container to hold result values from calculating claimable rewards
    struct CalculateRewardsResult {
        uint256 totalRewardsToClaim; // amount of claimable rewards calculated
        uint256 startSnapshotIndex; // starting snapshot index (inclusive) over which the claimable rewards were calculated
        uint256 endSnapshotIndex; // ending snapshot index (inclusive) over which the claimable rewards were calculated
        uint32 periodsClaimed; // number of claimable periods actually used to calculate the claimable rewards
    }

    // TODO Apply these

    // struct Snapshot {
    //     uint32 period;
    //     uint32 startCycle;
    //     uint32 endCycle;
    //     uint128 stake;
    // }

    // struct StakerState {
    //     uint32 nextClaimablePeriod;
    //     uint96 nextClaimableSnapshotIndex;
    //     uint128 stake;
    // }

    // struct TokenInfo {
    //     address owner;
    //     uint32 depositCycle;
    //     uint104 stake;
    // }

    uint256 public startTimestamp = 0; // starting timestamp of the staking schedule, in seconds since epoch
    uint256 public rewardPool = 0; // reward pool amount to be distributed over the entire schedule
    uint32 public lastScheduledPeriod = 0; // the last period in the reward schedule

    bool public disabled = false; // flags whether or not the contract is disabled

    address public whitelistedNftContract; // contract that has been whitelisted to be able to perform transfer operations of staked NFTs
    address public rewardsToken; // ERC20-based token used as staking rewards

    uint32 public immutable periodLengthInCycles; // the length of a claimable reward period, in cycles
    uint64 public immutable freezeDurationInCycles; // duration for which a newly staked NFT is locked before it can be unstaked, in cycles
    uint256 public immutable cycleLengthInSeconds; // the length of a cycle, in seconds

    mapping(address => StakerState) public stakerStates; // staker => StakerState
    mapping(uint256 => TokenInfo) public tokensInfo; // tokenId => TokenInfo
    mapping(uint32 => uint128) public rewardSchedule; // period => reward per-cycle

    Snapshot[] public snapshots; // history of total stake by ranges of cycles within a single period

    modifier rewardsClaimed(address sender) {
        require(_getClaimablePeriods(sender, periodLengthInCycles) == 0, "NftStaking: Rewards are not claimed");
        _;
    }

    modifier hasStarted() {
        require(startTimestamp != 0, "NftStaking: Staking has not started yet");
        _;
    }

    modifier isEnabled() {
        require(!disabled, "NftStaking: Staking operations are disabled");
        _;
    }

    /**
     * Constructor.
     * @dev Reverts if the period length value is zero.
     * @dev Reverts if the cycle length value is zero.
     * @param cycleLengthInSeconds_ Length of a cycle, in seconds.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @param freezeDurationInCycles_ Initial number of cycles during which a newly staked NFT is locked for before it can be unstaked.
     * @param whitelistedNftContract_ Contract that has been whitelisted to be able to perform transfer operations of staked NFTs.
     * @param rewardsToken_ The ERC20-based token used in reward rewards.
     */
    constructor(
        uint256 cycleLengthInSeconds_,
        uint32 periodLengthInCycles_,
        uint64 freezeDurationInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_
    ) internal {
        require(periodLengthInCycles_ != 0, "NftStaking: Period length must not be zero");
        require(cycleLengthInSeconds_ != 0, "NftStaking: Cycle length must not be zero");

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        freezeDurationInCycles = freezeDurationInCycles_;
        whitelistedNftContract = whitelistedNftContract_;
        rewardsToken = rewardsToken_;
    }

//////////////////////////////////////// Admin Functions //////////////////////////////////////////

    /**
     * Set the rewards for a range of periods.
     * @dev Reverts if the start or end periods are zero.
     * @dev Reverts if the end period is before the start period.
     * @dev Emits the RewardSet event when the function is called successfully.
     * @param startPeriod The starting period (inclusive).
     * @param endPeriod The ending period (inclusive).
     * @param rewardPerCycle The reward for each cycle within range.
     */
    function setRewardsForPeriods(
        uint32 startPeriod,
        uint32 endPeriod,
        uint128 rewardPerCycle
    ) public onlyOwner {
        require(startPeriod != 0 && startPeriod <= endPeriod, "NftStaking: Wrong period range");

        for (uint32 period = startPeriod; period <= endPeriod; ++period) {
            rewardSchedule[period] = rewardPerCycle;

            if (period > lastScheduledPeriod) {
                lastScheduledPeriod = period;
            }
        }

        uint256 reward = rewardPerCycle;
        reward *= periodLengthInCycles;
        reward *= endPeriod - startPeriod + 1;

        rewardPool = rewardPool.add(reward);

        emit RewardSet(startPeriod, endPeriod, rewardPerCycle);
    }

    /**
     * Transfers necessary reward balance to the contract from the reward token contract, and begins running the staking schedule.
     */
    function start() public onlyOwner {
        require(
            IERC20(rewardsToken).transferFrom(msg.sender, address(this), rewardPool),
            "NftStaking: Failed to transfer the total reward"
        );

        startTimestamp = now;
    }

    /**
     * Withdraws a specified amount of rewards tokens from the contract.
     * @param amount The amount to withdraw.
     */
    function withdrawRewardsPool(uint256 amount) public onlyOwner {
        require(
            IERC20(rewardsToken).transfer(msg.sender, amount),
            "NftStaking: Failed to withdraw from the rewards pool"
        );
    }

    /**
     * Permanently disables all staking and claiming functionality of the contract.
     */
    function disable() public onlyOwner {
        disabled = true;
    }

////////////////////////////////////// ERC1155TokenReceiver ///////////////////////////////////////

    /**
     * Handle the receipt of a single ERC1155 token type.
     * @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeTransferFrom` after the balance has been updated.
     * This function MUST return `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))` (i.e. 0xf23a6e61) if it accepts the transfer.
     * This function MUST revert if it rejects the transfer.
     * Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
     * @param //operator The address which initiated the transfer (i.e. msg.sender)
     * @param from The address which previously owned the token
     * @param id The ID of the token being transferred
     * @param //value The amount of tokens being transferred
     * @param //data Additional data with no specified format
     * @return `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))`
     */
    function onERC1155Received(
        address /*operator*/,
        address from,
        uint256 id,
        uint256 /*value*/,
        bytes calldata /*data*/
    )
    external
    virtual
    override
    rewardsClaimed(from)
    returns (bytes4)
    {
        _stakeNft(id, from);
        return _ERC1155_RECEIVED;
    }

    /**
     * Handle the receipt of multiple ERC1155 token types.
     * @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeBatchTransferFrom` after the balances have been updated.
     * This function MUST return `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))` (i.e. 0xbc197c81) if it accepts the transfer(s).
     * This function MUST revert if it rejects the transfer(s).
     * Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
     * @param //operator The address which initiated the batch transfer (i.e. msg.sender)
     * @param from The address which previously owned the token
     * @param ids An array containing ids of each token being transferred (order and length must match _values array)
     * @param //values An array containing amounts of each token being transferred (order and length must match _ids array)
     * @param //data Additional data with no specified format
     * @return `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`
     */
    function onERC1155BatchReceived(
        address /*operator*/,
        address from,
        uint256[] calldata ids,
        uint256[] calldata /*values*/,
        bytes calldata /*data*/
    )
    external
    virtual
    override
    rewardsClaimed(from)
    returns (bytes4)
    {
        for (uint256 i = 0; i < ids.length; ++i) {
            _stakeNft(ids[i], from);
        }
        return _ERC1155_BATCH_RECEIVED;
    }

//////////////////////////////////// Staking Public Functions /////////////////////////////////////

    /**
     * Unstakes a deposited NFT from the contract.
     * @dev Reverts if the caller is not the original owner of the NFT.
     * @dev While the contract is enabled, reverts if there are outstanding rewards to be claimed.
     * @dev While the contract is enabled, reverts if NFT is being unstaked before the staking freeze duration has elapsed.
     * @dev While the contract is enabled, creates any missing snapshots, up-to the current cycle.
     * @dev Emits the NftUnstaked event when the function is called successfully.
     * @dev May emit the SnapshotUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @param tokenId The token identifier, referencing the NFT being unstaked.
     */
    function unstakeNft(uint256 tokenId) external virtual {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];

        require(tokenInfo.owner == msg.sender, "NftStaking: Incorrect token owner or token already unstaked");

        uint64 currentCycle = _getCycle(now);

        // by-pass operations if the contract is disabled, to avoid unnecessary calculations and
        // reduce the gas requirements for the caller
        if (!disabled) {
            uint32 periodLengthInCycles_ = periodLengthInCycles;

            require(_getClaimablePeriods (msg.sender, periodLengthInCycles_) == 0, "NftStaking: Rewards are not claimed");
            require(currentCycle - tokenInfo.depositCycle >= freezeDurationInCycles, "NftStaking: Token is still frozen");

            ensureSnapshots(0);

            uint256 snapshotIndex = snapshots.length - 1;
            Snapshot memory snapshot = snapshots[snapshotIndex];

            // decrease the latest snapshot's stake
            _updateSnapshotStake(
                snapshot,
                snapshotIndex,
                snapshot.stake - tokenInfo.stake,
                currentCycle);

            // clear the token owner to ensure that it cannot be unstaked again
            // without being re-staked
            tokensInfo[tokenId].owner = address(0);

            // decrease the staker's stake
            StakerState memory stakerState = stakerStates[msg.sender];
            stakerState.stake -= tokenInfo.stake;

            // nothing is currently staked by the staker
            if (stakerState.stake == 0) {
                // clear the next claimable cycle
                stakerState.nextClaimableCycle = 0;
            }

            stakerStates[msg.sender] = stakerState;
        }

        try IERC1155(whitelistedNftContract).safeTransferFrom(address(this), msg.sender, tokenId, 1, "") {
        } catch Error(string memory /*reason*/) {
            // This is executed in case evert was called inside
            // getData and a reason string was provided.

            // attempting a non-safe transferFrom() of the token in the case
            // that the failure was caused by a ethereum client wallet
            // implementation that does not support safeTransferFrom()
            IERC721(whitelistedNftContract).transferFrom(address(this), msg.sender, tokenId);
        } catch (bytes memory /*lowLevelData*/) {
            // This is executed in case revert() was used or there was
            // a failing assertion, division by zero, etc. inside getData.

            // attempting a non-safe transferFrom() of the token in the case
            // that the failure was caused by a ethereum client wallet
            // implementation that does not support safeTransferFrom()
            IERC721(whitelistedNftContract).transferFrom(address(this), msg.sender, tokenId);
        }

        emit NftUnstaked(msg.sender, tokenId, currentCycle);
    }

    /**
     * Estimates the claimable rewards for the specified number of periods.
     * @param periodsToClaim The maximum number of claimable periods to calculate for.
     * @return claimableRewards The total claimable rewards.
     * @return claimablePeriods The actual number of claimable periods calculated for.
     */
    function estimateRewards(uint32 periodsToClaim) external view isEnabled hasStarted returns (
        uint256 claimableRewards,
        uint32 claimablePeriods
    ) {
        // estimating for 0 periods
        if (periodsToClaim == 0) {
            return (0, 0);
        }

        // calculate the claimable rewards
        CalculateRewardsResult memory result =
            _calculateRewards(msg.sender, periodsToClaim, true);

        claimableRewards = result.totalRewardsToClaim;
        claimablePeriods = result.periodsClaimed;
    }

    /**
     * Claims the rewards for the specified number of periods.
     * @dev Creates any missing snapshots, up-to the current cycle.
     * @dev Emits the RewardsClaimed event when the function is called successfully.
     * @dev May emit the SnapshotUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @param periodsToClaim The maximum number of periods to claim for.
     */
    function claimRewards(uint32 periodsToClaim) external isEnabled hasStarted {
        // claiming for 0 periods
        if (periodsToClaim == 0) {
            return;
        }

        // ensure that snapshots exist up-to the current cycle/period
        ensureSnapshots(0);

        // calculate the claimable rewards
        CalculateRewardsResult memory result =
            _calculateRewards(msg.sender, periodsToClaim, false);

        // no periods were actually processed when calculating the rewards to
        // claim (i.e. no net changes were made to the current state since
        // before _calculateRewards() was called)
        if (result.periodsClaimed == 0) {
            return;
        }

        // update the staker's next claimable cycle for each call of this
        // function. this should be done even when no rewards to claim were
        // found, to save from reprocessing fruitless periods in subsequent
        // calls
        stakerStates[msg.sender].nextClaimableCycle = snapshots[SafeMath.add(result.endSnapshotIndex, 1)].startCycle;

        // no rewards to claim were found across the processed periods
        if (result.totalRewardsToClaim == 0) {
            return;
        }

        require(
            IERC20(rewardsToken).transfer(msg.sender, result.totalRewardsToClaim),
            "NftStaking: Failed to transfer claimed rewards");

        emit RewardsClaimed(
            msg.sender,
            result.startSnapshotIndex,
            result.endSnapshotIndex,
            result.totalRewardsToClaim);
    }

    /**
     * Ensures that the snapshot history is up-to-date to the current cycle.
     * @dev If the latest snapshot is related to a past period, it creates a snapshot for each missing period and one for the current period (if needed).
     * @dev Updates the latest snapshot to end on current cycle if not already.
     * @dev May emit the SnapshotUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @param maxSnapshotsToAdd the limit of snapshots to create. No limit will be applied if it equals zero.
     */
    function ensureSnapshots(uint256 maxSnapshotsToAdd) public {
        uint32 periodLengthInCycles_ = periodLengthInCycles;
        uint64 currentCycle = _getCycle(now);
        uint32 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles_);
        uint256 totalSnapshots = snapshots.length;

        // no snapshots currently exist
        if (totalSnapshots == 0) {
            // create the initial snapshot, starting at the current cycle
            _addNewSnapshot(currentPeriod, currentCycle, currentCycle, 0);
            return;
        }

        uint256 snapshotIndex = totalSnapshots - 1;

        // get the latest snapshot
        Snapshot memory snapshot = snapshots[snapshotIndex];

        // latest snapshot ends on the current cycle
        if (snapshot.endCycle == currentCycle) {
            // nothing to do
            return;
        }

        // determine the assignment based on whether or not the latest snapshot
        // is in the current period
        uint64 snapshotPeriodEndCycle =
            snapshot.period == currentPeriod ?
                currentCycle :
                SafeMath.mul(snapshot.period, periodLengthInCycles_).toUint64();

        // extend the latest snapshot to cover all of the missing cycles for its
        // period
        snapshots[snapshotIndex].endCycle = snapshotPeriodEndCycle;
        snapshot.endCycle = snapshotPeriodEndCycle;

        emit SnapshotUpdated(
                snapshotIndex,
                snapshot.startCycle,
                snapshot.endCycle,
                snapshot.stake);

        // latest snapshot was for the current period
        if (snapshot.period == currentPeriod) {
            // we are done
            return;
        }

        // latest snapshot is in an earlier period

        uint32 previousPeriod = currentPeriod - 1;
        bool hasAddNewSnapshotLimit = maxSnapshotsToAdd != 0;

        // while there are unaccounted-for periods...
        while (snapshot.period < previousPeriod) {
            // maximum snapshots to add has been reached
            if (hasAddNewSnapshotLimit && (--maxSnapshotsToAdd == 0)) {
                // break out of loop to add the last snapshot for the current period
                break;
            }

            // create an interstitial snapshot that spans the unaccounted-for
            // period, initialized with the staked weight of the previous
            // snapshot
            (snapshot, snapshotIndex) = _addNewSnapshot(
                snapshot.period + 1,
                snapshot.endCycle + 1,
                SafeMath.add(snapshot.endCycle, periodLengthInCycles_).toUint64(),
                snapshot.stake);
        }

        // create the new latest snapshot for the current period and cycle,
        // initialized with the staked weight from the previous snapshot
        _addNewSnapshot(
            snapshot.period + 1,
            snapshot.endCycle + 1,
            currentCycle,
            snapshot.stake);
    }

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() external view returns (uint64) {
        // index is 1 based
        return _getCycle(now);
    }

    /**
     * Retrieves the current period (index-1 based).
     * @return The current period (index-1 based).
     */
    function getCurrentPeriod() external view returns (uint32) {
        return _getCurrentPeriod(periodLengthInCycles);
    }

    /**
     * Retrieves the first claimable period (index-1 based) and number of claimable periods.
     * @return nexClaimablePeriod The first claimable period (index-1 based).
     * @return claimablePeriods The number of claimable periods.
     */
    function getClaimablePeriods() external view returns (
        uint32 nexClaimablePeriod,
        uint32 claimablePeriods
    ) {
        StakerState memory stakerState = stakerStates[msg.sender];
        uint32 periodLengthInCycles_ = periodLengthInCycles;
        if (stakerState.nextClaimableCycle == 0) {
            return (0, 0);
        }
        return (
            _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_),
            _getClaimablePeriods (msg.sender, periodLengthInCycles_)
        );
    }

//////////////////////////////////// Staking Internal Functions /////////////////////////////////////

    /**
     * Adds a new snapshot to the snapshot history list.
     * @dev Emits the SnapshotUpdated event when the function is called.
     * @param cycleStart Starting cycle for the new snapshot.
     * @param cycleEnd Ending cycle for the new snapshot.
     * @param stake Initial stake for the new snapshot.
     * @return The newly created snapshot.
     * @return The index of the newly created snapshot.
     */
    function _addNewSnapshot(
        uint32 period,
        uint64 cycleStart,
        uint64 cycleEnd,
        uint32 stake
    ) internal returns (Snapshot storage, uint256)
    {
        Snapshot memory snapshot;
        snapshot.period = period;
        snapshot.startCycle = cycleStart;
        snapshot.endCycle = cycleEnd;
        snapshot.stake = stake;

        snapshots.push(snapshot);

        uint256 snapshotIndex = snapshots.length - 1;

        emit SnapshotUpdated(
            snapshotIndex,
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stake);

        return (snapshots[snapshotIndex], snapshotIndex);
    }

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @dev Reverts if the specified timestamp is earlier than the beginning of the staking schedule
     * @param ts The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 ts) internal view returns (uint64) {
        require(ts >= startTimestamp, "NftStaking: Cycle timestamp preceeds the contract start timestamp");
        return ((ts - startTimestamp) / cycleLengthInSeconds).add(1).toUint64();
    }

     /**
      * Retrieves the current period (index-1 based).
      * @param periodLengthInCycles_ Length of a period, in cycles.
      * @return The current period (index-1 based).
      */
    function _getCurrentPeriod(uint32 periodLengthInCycles_) internal view returns (uint32) {
        return _getPeriod(_getCycle(now), periodLengthInCycles_);
    }

    /**
     * Retrieves the period (index-1 based) for the specified cycle and period length.
     * @dev reverts if the specified cycle is zero.
     * @param cycle The cycle within the period to retrieve.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The period (index-1 based) for the specified cycle and period length.
     */
    function _getPeriod(uint64 cycle, uint32 periodLengthInCycles_) internal pure returns (uint32) {
        require(cycle != 0, "NftStaking: Period cycle cannot be zero");
        return (uint256(cycle / uint64(periodLengthInCycles_)) + 1).toUint32();
    }

    /**
     * Retrieves the number of claimable periods for the specified staker.
     * @param sender The staker whose number of claimable periods will be retrieved.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The number of claimable periods for the specified staker.
     */
    function _getClaimablePeriods (address sender, uint32 periodLengthInCycles_) internal view returns (uint32) {
        StakerState memory stakerState = stakerStates[sender];
        if (stakerState.stake == 0) {
            return 0;
        }

        uint32 periodToClaim = _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_);
        return _getCurrentPeriod(periodLengthInCycles_) - periodToClaim;
    }

    /**
     * Calculates the amount of rewards over the available claimable periods
     * @dev Processes until the specified maximum number of periods to claim is reached, or the last processable period is reached (the current period for a claim estimate, or the last snapshot period for an actual claim), whichever occurs first.
     * @param staker The staker for whom the rewards will be calculated.
     * @param periodsToClaim Maximum number of periods, over which to calculate the claimable rewards.
     * @param estimate Flags whether or not the calculation is for a reward claim estimate, or for an actual claim.
     * @return CalculateRewardsResult result containing the amount of claimable rewards, the starting and ending snapshot indices over which the calculation was performed, and the number of actual periods processed in the calculation.
     */
    function _calculateRewards(
        address staker,
        uint32 periodsToClaim,
        bool estimate
    ) internal view returns (CalculateRewardsResult memory)
    {
        CalculateRewardsResult memory result;

        // calculating for 0 periods
        if (periodsToClaim == 0) {
            return result;
        }

        uint256 totalSnapshots = snapshots.length;

        // no snapshots to calculate with
        if (totalSnapshots == 0) {
            return result;
        }

        StakerState memory stakerState = stakerStates[staker];

        // nothing staked to calculate with
        if (stakerState.stake == 0) {
            return result;
        }

        uint32 periodLengthInCycles_ = periodLengthInCycles;
        uint32 periodToClaim = _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_);
        uint32 currentPeriod = _getCurrentPeriod(periodLengthInCycles_);
        uint256 lastSnapshotIndex = totalSnapshots - 1;
        uint32 lastSnapshotPeriod = snapshots[lastSnapshotIndex].period;

        // the current period has been reached (claim estimate), or the last
        // snapshot period has been reached (actual claim)
        if ((estimate && (periodToClaim  == currentPeriod)) ||
            (!estimate && (periodToClaim == lastSnapshotPeriod))) {
            return result;
        }

        uint128 rewardPerCycle = rewardSchedule[periodToClaim];
        uint64 periodToClaimEndCycle = SafeMath.mul(periodToClaim, periodLengthInCycles_).toUint64();

        (Snapshot memory snapshot, uint256 snapshotIndex) = _findSnapshot(stakerState.nextClaimableCycle);

        // for a claim estimate, the last snapshot period is not the current
        // period and does not align with the end of its period
        if (
            estimate &&
            (snapshotIndex == lastSnapshotIndex) &&
            (snapshot.period != currentPeriod) &&
            (snapshot.endCycle != periodToClaimEndCycle)) {
            // extend the last snapshot cycle range to align with the end of its
            // period
            snapshot.endCycle = periodToClaimEndCycle;
        }

        result.startSnapshotIndex = snapshotIndex;

        // iterate over snapshots one by one until either the specified maximum
        // number of periods to claim is reached, or the last processable
        // period is reached (the current period for a claim estimate, or the
        // last snapshot period for an actual claim), whichever occurs first.
        // this loop assumes that (1) there is at least one snapshot within each
        // period, (2) snapshots are aligned back-to-back, (3) each period is
        // spanned by snapshots (i.e. no cycle gaps), (4) snapshots do not span
        // across multiple periods (i.e. bound within a single period), and (5)
        // that it will be executed for at least 1 iteration
        while (true) {
            // there are rewards to calculate in this loop iteration
            if ((snapshot.stake != 0) && (rewardPerCycle != 0)) {
                // calculate the staker's snapshot rewards
                uint256 rewardsToClaim = snapshot.endCycle - snapshot.startCycle + 1;
                rewardsToClaim *= stakerState.stake;
                rewardsToClaim *= _DIVS_PRECISION;
                rewardsToClaim = rewardsToClaim.mul(rewardPerCycle);
                rewardsToClaim /= snapshot.stake;
                rewardsToClaim /= _DIVS_PRECISION;

                // update the total rewards to claim
                result.totalRewardsToClaim = result.totalRewardsToClaim.add(rewardsToClaim);
            }

            // snapshot is the last one in the period to claim
            if (snapshot.endCycle == periodToClaimEndCycle) {
                ++periodToClaim;
                ++result.periodsClaimed;

                // the specified maximum number of periods to claim is reached,
                // or the current period has been reached (claim estimate), or
                // the last snapshot period has been reached (actual claim)
                if ((periodsToClaim == result.periodsClaimed) ||
                    (estimate && (periodToClaim  == currentPeriod)) ||
                    (!estimate && (periodToClaim == lastSnapshotPeriod))) {
                    break;
                }

                // advance the period state for the next loop iteration
                rewardPerCycle = rewardSchedule[periodToClaim];
                periodToClaimEndCycle = SafeMath.add(periodToClaimEndCycle, periodLengthInCycles_).toUint64();
            }

            // still have individual snapshots to process. once there are no
            // more, in the case of a claim estimate, assume the same snapshot
            // properties (excluding cycle range bounds) as the last snapshot,
            // for any subsequent periods to claim that do not have any
            // snapshots
            if (snapshotIndex < lastSnapshotIndex) {
                // advance the snapshot for the next loop iteration
                ++snapshotIndex;
                snapshot = snapshots[snapshotIndex];
            }

            // for a claim estimate, the last snapshot has been reached
            if (estimate && (snapshotIndex == lastSnapshotIndex)) {
                if (periodToClaim == lastSnapshotPeriod) {
                    if (snapshot.endCycle != periodToClaimEndCycle) {
                        // extend the last snapshot cycle range to align with
                        // the end of its period
                        snapshot.endCycle = periodToClaimEndCycle;
                    }
                } else {
                    // re-position the snapshot cycle range for the period to
                    // claim
                    snapshot.startCycle = snapshot.endCycle + 1;
                    snapshot.endCycle = periodToClaimEndCycle;
                }
            }
        }

        result.endSnapshotIndex = snapshotIndex;

        return result;
    }

    /**
     * Updates the snapshot stake at the current cycle.
     * @dev It will update the latest snapshot if it starts at the current cycle, otherwise will adjust the snapshots range end back by one cycle (the previous cycle) and create a new snapshot for the current cycle with the stake update.
     * @dev Emits the SnapshotUpdated event when the function is called.
     * @param snapshot The snapshot whose stake is being updated.
     * @param snapshotIndex The index of the snapshot being updated.
     * @param stake The stake to update the latest snapshot with.
     * @param currentCycle The current staking cycle.
     */
    function _updateSnapshotStake(
        Snapshot memory snapshot,
        uint256 snapshotIndex,
        uint32 stake,
        uint64 currentCycle
    ) internal
    {
        if (snapshot.startCycle == currentCycle) {
            // if the snapshot starts at the current cycle, update its stake
            // since this is the only time we can update an existing snapshot
            snapshots[snapshotIndex].stake = stake;

            emit SnapshotUpdated(
                snapshotIndex,
                snapshot.startCycle,
                snapshot.endCycle,
                stake);

        } else {
            // make the current snapshot end at previous cycle, since the stake
            // for a new snapshot at the current cycle will be updated
            --snapshots[snapshotIndex].endCycle;

            // Note: no need to emit the SnapshotUpdated event, from adjusting
            // the snapshot range, since the purpose of the event is to report
            // changes in stake weight

            // add a new snapshot starting at the current cycle with stake
            // update
            _addNewSnapshot(snapshot.period, currentCycle, currentCycle, stake);
        }
    }

    /**
     * Stakes the NFT received by the contract, referenced by its specified token identifier and owner.
     * @dev Reverts if the caller is not the whitelisted NFT contract.
     * @dev Creates any missing snapshots, up-to the current cycle.
     * @dev May emit the SnapshotUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @dev Emits the NftStaked event when the function is called successfully.
     * @param tokenId Identifier of the staked NFT.
     * @param tokenOwner Owner of the staked NFT.
     */
    function _stakeNft(
        uint256 tokenId,
        address tokenOwner
    ) internal isEnabled hasStarted {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");

        uint32 nftStakeWeight = _validateAndGetWeight(tokenId);

        ensureSnapshots(0);

        uint64 currentCycle = _getCycle(now);
        uint256 snapshotIndex = snapshots.length - 1;
        Snapshot memory snapshot = snapshots[snapshotIndex];

        // increase the latest snapshot's stake
        _updateSnapshotStake(
            snapshot,
            snapshotIndex,
            SafeMath.add(snapshot.stake, nftStakeWeight).toUint32(),
            currentCycle);

        // set the staked token's info
        TokenInfo memory tokenInfo;
        tokenInfo.depositCycle = currentCycle;
        tokenInfo.owner = tokenOwner;
        tokenInfo.stake = nftStakeWeight;
        tokensInfo[tokenId] = tokenInfo;

        StakerState memory stakerState = stakerStates[tokenOwner];

        if (stakerState.stake == 0) {
            // nothing is currently staked by the staker so reset/initialize
            // the next claimable cycle to the current cycle for claimable
            // period tracking
            stakerState.nextClaimableCycle = currentCycle;
        }

        // increase the staker's stake
        stakerState.stake = SafeMath.add(stakerState.stake, nftStakeWeight).toUint32();
        stakerStates[tokenOwner] = stakerState;

        emit NftStaked(tokenOwner, tokenId, currentCycle);
    }

    /**
     * Searches for the reward snapshot containing the specified cycle.
     * @dev If the snapshot cannot be found, then the closest snapshot by cycle range is returned.
     * @param cycle The cycle for which the reward snapshot is searched for.
     * @return snapshot If found, the snapshot containing the specified cycle, otherwise the closest snapshot to the cycle.
     * @return snapshotIndex The index (index-0 based) of the returned snapshot.
     */
    function _findSnapshot(uint64 cycle)
    internal
    view
    returns (Snapshot memory snapshot, uint256 snapshotIndex)
    {
        uint256 low = 0;
        uint256 high = snapshots.length - 1;
        uint256 mid = 0;

        while (low <= high) {
            // overflow protected midpoint calculation
            mid = low.add((high - low) / 2);

            snapshot = snapshots[mid];

            if (snapshot.startCycle > cycle) {
                if (mid == 0) {
                    break;
                }

                // outside by left side of the range
                high = mid - 1;
            } else if (snapshot.endCycle < cycle) {
                if (mid == type(uint256).max) {
                    break;
                }

                // outside by right side of the range
                low = mid + 1;
            } else {
                break;
            }
        }

        // return snapshot with cycle within range or closest possible to it
        return (snapshot, mid);
    }

    /**
     * Abstract function which validates whether or not the supplied NFT identifier is accepted for staking
     * and retrieves its associated weight.
     * @dev MUST throw if the token is invalid.
     * @param nftId uint256 NFT identifier used to determine if the token is valid for staking.
     * @return uint32 the weight of the NFT.
     */
    function _validateAndGetWeight(uint256 nftId) internal virtual view returns (uint32);

}
