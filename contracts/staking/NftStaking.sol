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

    uint256 internal constant _DIVS_PRECISION = 10 ** 10;

    event PayoutSet(
        uint32 startPeriod,
        uint32 endPeriod,
        uint128 payoutPerCycle
    );

    event NftStaked(
        address staker,
        uint256 tokenId,
        uint64 cycle
    );

    event NftUnstaked(
        address staker,
        uint256 tokenId,
        uint64 cycle
    );

    event RewardsClaimed(
        address staker,
        uint256 snapshotStartIndex,
        uint256 snapshotEndIndex,
        uint256 amount
    );

    event SnapshotUpdated(
        uint256 index, // index (index-0 based) of the snapshot in the history list
        uint64 startCycle,
        uint64 endCycle,
        uint32 stake // Total stake of all NFTs
    );

    // a struct container used to track aggregate changes in stake over time
    struct Snapshot {
        uint32 period;
        uint64 startCycle;
        uint64 endCycle;
        uint32 stake; // cumulative stake of all NFTs staked
    }

    // a struct container used to track a staker's aggregate staking state
    struct StakerState {
        uint64 nextClaimableCycle;
        uint32 stake;
    }

    struct TokenInfo {
        address owner;
        uint64 depositTimestamp; // seconds since epoch
        uint32 stake;
    }

    uint256 public startTimestamp = 0; // in seconds since epoch
    uint256 public totalPayout = 0; // payout to be distributed over the entire schedule

    bool public disabled = false; // flags whether or not the contract is disabled

    address public whitelistedNftContract; // contract that has been whitelisted to be able to perform transfer operations of staked NFTs
    address public rewardsToken; // ERC20-based token used in reward payouts

    uint32 public immutable periodLengthInCycles;
    uint64 public immutable freezeDurationAfterStake; // duration for which a newly staked NFT is locked before it can be unstaked, in seconds
    uint256 public immutable cycleLengthInSeconds;

    mapping(address => StakerState) public stakerStates; // staker => StakerState
    mapping(uint256 => TokenInfo) public tokensInfo; // tokenId => TokenInfo
    mapping(uint32 => uint128) public payoutSchedule; // period => payout per-cycle

    Snapshot[] public snapshots; // History of total stake by ranges of cycles within a single period

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender, periodLengthInCycles) == 0, "NftStaking: Rewards are not claimed");
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
     * @dev Constructor.
     * @param cycleLengthInSeconds_ Length of a cycle, in seconds.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
     * @param whitelistedNftContract_ Contract that has been whitelisted to be able to perform transfer operations of staked NFTs.
     * @param rewardsToken_ The ERC20-based token used in reward payouts.
     */
    constructor(
        uint256 cycleLengthInSeconds_,
        uint32 periodLengthInCycles_,
        uint64 freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address rewardsToken_
    ) internal {
        require(periodLengthInCycles_ != 0, "NftStaking: Period length must not be zero");

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        freezeDurationAfterStake = freezeDurationAfterStake_;
        whitelistedNftContract = whitelistedNftContract_;
        rewardsToken = rewardsToken_;
    }

//////////////////////////////////////// Admin Functions //////////////////////////////////////////

    /**
     * Set the payout for a range of periods.
     * @param startPeriod The starting period (inclusive).
     * @param endPeriod The ending period (inclusive).
     * @param payoutPerCycle The total payout for each cycle within range.
     */
    function setPayoutForPeriods(
        uint32 startPeriod,
        uint32 endPeriod,
        uint128 payoutPerCycle
    ) public onlyOwner {
        require(startPeriod > 0 && startPeriod <= endPeriod, "NftStaking: Wrong period range");

        for (uint32 period = startPeriod; period <= endPeriod; ++period) {
            payoutSchedule[period] = payoutPerCycle;
        }

        totalPayout = totalPayout.add(
            (SafeMath.sub(endPeriod, startPeriod) + 1)
            .mul(payoutPerCycle)
            .mul(periodLengthInCycles)
        );

        emit PayoutSet(startPeriod, endPeriod, payoutPerCycle);
    }

    /**
     * Transfers total payout balance to the contract and starts the staking.
     */
    function start() public onlyOwner {
        require(
            IERC20(rewardsToken).transferFrom(msg.sender, address(this), totalPayout),
            "NftStaking: Failed to transfer the total payout"
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
    divsClaimed(from)
    returns (bytes4)
    {
        _stakeNft(id, from);
        return _ERC1155_RECEIVED;
    }

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
    divsClaimed(from)
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
     * @dev While the contract is enabled, reverts if NFT is being withdrawn before the staking freeze duration has elapsed.
     * @param tokenId The token identifier, referencing the NFT being withdrawn.
     */
    function unstakeNft(uint256 tokenId) external virtual {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];

        require(tokenInfo.owner == msg.sender, "NftStaking: Token owner doesn't match or token was already withdrawn before");

        uint64 currentCycle = _getCycle(now);

        // by-pass operations if the contract is disabled, to avoid unnecessary calculations and
        // reduce the gas requirements for the caller
        if (!disabled) {
            uint32 periodLengthInCycles_ = periodLengthInCycles;

            require(_getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_) == 0, "NftStaking: Rewards are not claimed");
            require(now > SafeMath.add(tokenInfo.depositTimestamp, freezeDurationAfterStake), "NftStaking: Token is still frozen");

            ensureSnapshots(0);

            uint256 snapshotIndex = snapshots.length - 1;
            Snapshot memory snapshot = snapshots[snapshotIndex];

            // decrease the latest snapshot's stake
            _updateSnapshotStake(
                snapshot,
                snapshotIndex,
                SafeMath.sub(snapshot.stake, tokenInfo.stake).toUint32(),
                currentCycle);

            // clear the token owner to ensure that it cannot be unstaked again
            // without being re-staked
            tokensInfo[tokenId].owner = address(0);

            // decrease the staker's stake
            StakerState memory stakerState = stakerStates[msg.sender];
            stakerState.stake = SafeMath.sub(stakerState.stake, tokenInfo.stake).toUint32();

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
     * The accuracy of the result depends on how up-to-date the snapshots are.
     * Calling ensureSnapshots() prior to estimating the claimable rewards
     * will result in a precise calculation.
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
        (claimableRewards, , , claimablePeriods) = _calculateRewards(msg.sender, periodsToClaim);
    }

    /**
     * Claims the rewards for the specified number of periods.
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
        (uint256 totalRewardsToClaim,
            uint256 startSnapshotIndex,
            uint256 endSnapshotIndex,
            uint32 periodsClaimed
        ) = _calculateRewards(msg.sender, periodsToClaim);

        // no periods were actually processed when calculating the rewards to
        // claim (i.e. no net changes were made to the current state since
        // before _calculateRewardss() was called)
        if (periodsClaimed == 0) {
            return;
        }

        // update the staker's next claimable cycle for each call of this
        // function. this should be done even when no rewards to claim were
        // found, to save from reprocessing fruitless periods in subsequent
        // calls
        stakerStates[msg.sender].nextClaimableCycle = snapshots[endSnapshotIndex + 1].startCycle;

        // no rewards to claim were found across the processed periods
        if (totalRewardsToClaim == 0) {
            return;
        }

        require(
            IERC20(rewardsToken).transfer(msg.sender, totalRewardsToClaim),
            "NftStaking: Failed to transfer claimed rewards");

        emit RewardsClaimed(
            msg.sender,
            startSnapshotIndex,
            endSnapshotIndex,
            totalRewardsToClaim);
    }

    /**
     * @dev if the latest snapshot is related to a past period, creates a
     * snapshot for each missing past period (if any) and one for the
     * current period (if needed). Updates the latest snapshot to end on
     * current cycle if not already.
     * @param maxSnapshotsToAdd the limit of snapshots to create. No limit
     * will be applied if it equals zero.
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
        Snapshot storage writeSnapshot = snapshots[snapshotIndex];

        // in-memory copy of the latest snapshot for reads, to save gas
        Snapshot memory readSnapshot = writeSnapshot;

        // latest snapshot ends on the current cycle
        if (readSnapshot.endCycle == currentCycle) {
            // nothing to do
            return;
        }

        // determine the assignment based on whether or not the latest snapshot
        // is in the current period
        uint64 snapshotPeriodEndCycle =
            readSnapshot.period == currentPeriod ?
                currentCycle :
                SafeMath.mul(readSnapshot.period, periodLengthInCycles_).toUint64();

        // extend the latest snapshot to cover all of the missing cycles for its
        // period
        writeSnapshot.endCycle = snapshotPeriodEndCycle;
        readSnapshot.endCycle = snapshotPeriodEndCycle;

        emit SnapshotUpdated(
                snapshotIndex,
                readSnapshot.startCycle,
                readSnapshot.endCycle,
                readSnapshot.stake);

        // latest snapshot was for the current period
        if (readSnapshot.period == currentPeriod) {
            // we are done
            return;
        }

        // latest snapshot is in an earlier period

        uint32 previousPeriod = currentPeriod - 1;
        bool hasAddNewSnapshotLimit = maxSnapshotsToAdd != 0;

        // while there are unaccounted-for periods...
        while (readSnapshot.period < previousPeriod) {
            // maximum snapshots to add has been reached
            if (hasAddNewSnapshotLimit && (--maxSnapshotsToAdd == 0)) {
                // break out of loop to add the last snapshot for the current
                // period
                break;
            }

            // create an interstitial snapshot that spans the unaccounted-for
            // period, initialized with the staked weight of the previous
            // snapshot
            (writeSnapshot, snapshotIndex) = _addNewSnapshot(
                readSnapshot.period + 1,
                readSnapshot.endCycle + 1,
                SafeMath.add(readSnapshot.endCycle, periodLengthInCycles_).toUint64(),
                readSnapshot.stake);

            readSnapshot = writeSnapshot;
        }

        // create the new latest snapshot for the current period and cycle,
        // initialized with the staked weight from the previous snapshot
        _addNewSnapshot(
            readSnapshot.period + 1,
            readSnapshot.endCycle + 1,
            currentCycle,
            readSnapshot.stake);
    }

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() external view returns(uint64) {
        // index is 1 based
        return _getCycle(now);
    }

    /**
     * Retrieves the current payout period (index-1 based).
     * @return The current payout period (index-1 based).
     */
    function getCurrentPayoutPeriod() external view returns(uint32) {
        return _getCurrentPeriod(periodLengthInCycles);
    }

    /**
     * Retrieves the first unclaimed payout period (index-1 based) and number of unclaimed payout periods.
     * @return The first unclaimed payout period (index-1 based).
     * @return The number of unclaimed payout periods.
     */
    function getUnclaimedPayoutPeriods() external view returns(uint32, uint32) {
        StakerState memory stakerState = stakerStates[msg.sender];
        uint32 periodLengthInCycles_ = periodLengthInCycles;
        return (
            _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_),
            _getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_)
        );
    }

//////////////////////////////////// Staking Internal Functions /////////////////////////////////////

    /**
     * Adds a new snapshot to the snapshot history list.
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
    ) internal returns(Snapshot storage, uint256)
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
     * @param ts The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 ts) internal view returns(uint64) {
        return (ts.sub(startTimestamp).div(cycleLengthInSeconds) + 1).toUint64();
    }

     /**
      * Retrieves the current payout period (index-1 based).
      * @param periodLengthInCycles_ Length of a period, in cycles.
      * @return The current payout period (index-1 based).
      */
    function _getCurrentPeriod(uint32 periodLengthInCycles_) internal view returns(uint32) {
        return _getPeriod(_getCycle(now), periodLengthInCycles_);
    }

    /**
     * Retrieves the payout period (index-1 based) for the specified cycle and payout period length.
     * @param cycle The cycle within the payout period to retrieve.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The payout period (index-1 based) for the specified cycle and payout period length.
     */
    function _getPeriod(uint64 cycle, uint32 periodLengthInCycles_) internal pure returns(uint32) {
        if (cycle == 0) {
            return 0;
        }
        // index is 1 based
        return (SafeMath.div(cycle - 1, periodLengthInCycles_) + 1).toUint32();
    }

    /**
     * Retrieves the number of unclaimed payout periods for the specified staker.
     * @param sender The staker whose number of unclaimed payout periods will be retrieved.
     * @param periodLengthInCycles_ Length of a period, in cycles.
     * @return The number of unclaimed payout periods for the specified staker.
     */
    function _getUnclaimedPayoutPeriods(address sender, uint32 periodLengthInCycles_) internal view returns(uint32) {
        StakerState memory stakerState = stakerStates[sender];
        if (stakerState.stake == 0) {
            return 0;
        }

        uint32 periodToClaim = _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_);
        return SafeMath.sub(_getCurrentPeriod(periodLengthInCycles_), periodToClaim).toUint32();
    }

    /**
     * Calculates the amount of rewards over the available claimable periods
     * until either the specified maximum number of periods to claim is reached,
     * or the last snapshot period is reached, whichever is smaller.
     * @param staker The staker for whom the rewards will be calculated.
     * @param periodsToClaim Maximum number of periods, over which to calculate the claimable rewards.
     * @return totalRewardsToClaim The total claimable rewards calculated.
     * @return startSnapshotIndex The index of the starting snapshot claimed, in the calculation.
     * @return endSnapshotIndex The index of the ending snapshot claimed, in the calculation.
     * @return periodsClaimed The number of actual claimable periods calculated for.
     */
    function _calculateRewards(
        address staker,
        uint32 periodsToClaim
    ) internal view returns (
        uint256 totalRewardsToClaim,
        uint256 startSnapshotIndex,
        uint256 endSnapshotIndex,
        uint32 periodsClaimed)
    {
        // calculating for 0 periods
        if (periodsToClaim == 0) {
            return (0, 0, 0, 0);
        }

        uint256 totalSnapshots = snapshots.length;

        // no snapshots to calculate with
        if (totalSnapshots == 0) {
            return (0, 0, 0, 0);
        }

        StakerState memory stakerState = stakerStates[staker];

        // nothing staked to calculate with
        if (stakerState.stake == 0) {
            return (0, 0, 0, 0);
        }

        uint32 periodLengthInCycles_ = periodLengthInCycles;
        uint32 lastPeriod = snapshots[totalSnapshots - 1].period;
        uint32 periodToClaim = _getPeriod(stakerState.nextClaimableCycle, periodLengthInCycles_);

        // attempting to calculate for the last snapshot period. the latest
        // snapshot period is excluded from the claim calculation since it
        // is treated as a period that has not completed yet
        if (periodToClaim == lastPeriod) {
            return (0, 0, 0, 0);
        }

        uint128 payoutPerCycle = payoutSchedule[periodToClaim];
        uint64 periodToClaimEndCycle = SafeMath.mul(periodToClaim, periodLengthInCycles_).toUint64();

        (Snapshot memory snapshot, uint256 snapshotIndex) = _findSnapshot(stakerState.nextClaimableCycle);

        startSnapshotIndex = snapshotIndex;

        // iterate over snapshots one by one until reaching the last period.
        // this loop assumes that (1) there is at least one snapshot within
        // each period, (2) snapshots are aligned back-to-back, (3) each period
        // is spanned by snapshots (i.e. no cycle gaps), (4) snapshots do not
        // span across multiple periods (i.e. bound within a single period),
        // and (5) that it will be executed for at least 1 iteration
        while (true) {
            // there are rewards to calculate in this loop iteration
            if ((snapshot.stake != 0) && (payoutPerCycle != 0)) {
                // calculate the staker's snapshot rewards
                uint256 rewardsToClaim = SafeMath.sub(snapshot.endCycle, snapshot.startCycle) + 1;
                rewardsToClaim = rewardsToClaim.mul(payoutPerCycle);
                rewardsToClaim = rewardsToClaim.mul(_DIVS_PRECISION);
                rewardsToClaim = rewardsToClaim.mul(stakerState.stake).div(snapshot.stake);
                rewardsToClaim = rewardsToClaim.div(_DIVS_PRECISION);

                // update the total rewards to claim
                totalRewardsToClaim = SafeMath.add(totalRewardsToClaim, rewardsToClaim);
            }

            // snapshot is the last one in the period to claim
            if (snapshot.endCycle == periodToClaimEndCycle) {
                // the last claimable period has been reached, or all requested
                // periods to claim have been made
                if ((++periodToClaim == lastPeriod) || (++periodsClaimed == periodsToClaim)) {
                    break;
                }

                // advance the period state for the next loop iteration
                payoutPerCycle = payoutSchedule[periodToClaim];
                periodToClaimEndCycle = SafeMath.mul(periodToClaim, periodLengthInCycles_).toUint64();
            }

            // advance the snapshot for the next loop iteration
            ++snapshotIndex;
            snapshot = snapshots[snapshotIndex];
        }

        endSnapshotIndex = snapshotIndex;
    }

    /**
     * Updates the snapshot stake at the current cycle. It will update the
     * latest snapshot if it starts at the current cycle, otherwise will adjust
     * the snapshots range end back by one cycle (the previous cycle) and
     * create a new snapshot for the current cycle with the stake update.
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
        tokenInfo.depositTimestamp = now.toUint64();
        tokenInfo.owner = tokenOwner;
        tokenInfo.stake = nftStakeWeight;
        tokensInfo[tokenId] = tokenInfo;

        StakerState memory stakerState = stakerStates[tokenOwner];

        if (stakerState.stake == 0) {
            // nothing is currently staked by the staker so reset/initialize
            // the next claimable cycle to the current cycle for unclaimed
            // payout period tracking
            stakerState.nextClaimableCycle = currentCycle;
        }

        // increase the staker's stake
        stakerState.stake = SafeMath.add(stakerState.stake, nftStakeWeight).toUint32();
        stakerStates[tokenOwner] = stakerState;

        emit NftStaked(tokenOwner, tokenId, currentCycle);
    }

    /**
     * Searches for the reward snapshot containing the specified cycle. If the snapshot cannot be found,
     * then the closest snapshot by cycle range is returned.
     * @param cycle The cycle for which the reward snapshot is searched for.
     * @return snapshot If found, the snapshot containing the specified cycle, otherwise the closest snapshot to the cycle.
     * @return snapshotIndex The index (index-0 based) of the returned snapshot.
     */
    function _findSnapshot(uint64 cycle)
    internal
    view
    returns(Snapshot memory snapshot, uint256 snapshotIndex)
    {
        uint256 low = 0;
        uint256 high = snapshots.length - 1;
        uint256 mid = 0;

        while (low <= high) {
            // overflow protected midpoint calculation
            mid = low.add(high.sub(low).div(2));

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
     * and retrieves its associated weight. MUST throw if the token is invalid.
     * @param nftId uint256 NFT identifier used to determine if the token is valid for staking.
     * @return uint32 the weight of the NFT.
     */
    function _validateAndGetWeight(uint256 nftId) internal virtual view returns (uint32);

}
