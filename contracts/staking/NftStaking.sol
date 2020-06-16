// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC721/IERC721.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/ERC1155TokenReceiver.sol";

abstract contract NftStaking is ERC1155TokenReceiver, Ownable {

    using SafeCast for uint256;
    using SafeMath for uint256;
    using SignedSafeMath for int256;

    uint64 internal constant _DIVS_PRECISION = 10 ** 15; // used to preserve significant figures in floating point calculations

    event RewardsScheduled(
        uint256 startPeriod,
        uint256 endPeriod,
        uint256 rewardsPerCycle
    );

    event NftStaked(
        address staker,
        uint256 cycle,
        uint256 tokenId,
        uint256 weight
    );

    event NftUnstaked(
        address staker,
        uint256 cycle,
        uint256 tokenId,
        uint256 weight
    );

    event RewardsClaimed(
        address staker,
        uint256 cycle,
        uint256 startPeriod,
        uint256 periods,
        uint256 amount
    );

    event HistoriesUpdated(
        address staker,
        uint256 startCycle,
        uint256 stakerStake,
        uint256 globalStake
    );

    // optimised for storage
    struct TokenInfo {
        address owner;
        uint64 weight;
        uint16 depositCycle;
    }

    // This struct is used as a history record of stake
    // Used for both global history and staker histories
    // optimised for storage
    struct Snapshot {
        uint128 stake; // an aggregate of staked tokens weights
        uint128 startCycle;
    }

    // optimised for storage
    struct NextClaim {
        uint16 period;
        uint64 globalSnapshotIndex;
        uint64 stakerSnapshotIndex;
    }

    // used as a container to hold result values from computing rewards.
    struct ComputedClaim {
        uint16 startPeriod;
        uint16 periods;
        uint256 amount;
    }

    bool public disabled = false;

    uint256 public prizePool = 0; // prize pool for the entire schedule
    uint256 public startTimestamp = 0; // starting timestamp of the staking schedule, in seconds since epoch

    address public immutable whitelistedNftContract; // ERC1155-compliant NFT contract from which staking is accepted.
    address public immutable rewardsToken; // ERC20-compliant contract used as staking rewards

    uint32 public immutable cycleLengthInSeconds;
    uint16 public immutable periodLengthInCycles;

    Snapshot[] public globalHistory;
    mapping(address /* staker */ => Snapshot[]) public stakerHistories;
    mapping(address /* staker */ => NextClaim) public nextClaims;
    mapping(uint256 /* tokenId */ => TokenInfo) public tokenInfos;
    mapping(uint256 /* period */ => uint256 /* rewardsPerCycle */) public payoutSchedule;

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
     * @param whitelistedNftContract_ ERC1155-based contract to be whitelisted for performing transfer operations of NFTs for staking/unstaking.
     * @param rewardsToken_ ERC20-based token used as staking rewards.
     */
    constructor(
        uint32 cycleLengthInSeconds_,
        uint16 periodLengthInCycles_,
        address whitelistedNftContract_,
        address rewardsToken_
    ) internal {
        require(cycleLengthInSeconds_ >= 1 minutes, "NftStaking: invalid cycle length");
        require(periodLengthInCycles_ >= 2, "NftStaking: invalid period length");

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        whitelistedNftContract = whitelistedNftContract_;
        rewardsToken = rewardsToken_;
    }


/////////////////////////////////// Admin Public Functions ////////////////////////////////////////

    /**
     * Set the rewards for a range of periods.
     * @dev Reverts if the start or end periods are zero.
     * @dev Reverts if the end period is before the start period.
     * @dev Emits the RewardSet event when the function is called successfully.
     * @param startPeriod The starting period (inclusive).
     * @param endPeriod The ending period (inclusive).
     * @param rewardsPerCycle The prize for each cycle within range.
     */
    function setRewardsForPeriods(
        uint16 startPeriod,
        uint16 endPeriod,
        uint256 rewardsPerCycle
    ) public onlyOwner {
        require(startPeriod != 0 && startPeriod <= endPeriod, "NftStaking: wrong period range");

        for (uint16 period = startPeriod; period <= endPeriod; ++period) {
            payoutSchedule[period] = rewardsPerCycle;
        }

        uint256 scheduledRewards =
            rewardsPerCycle
            .mul(periodLengthInCycles)
            .mul(endPeriod - startPeriod + 1);

        prizePool = prizePool.add(scheduledRewards);

        emit RewardsScheduled(startPeriod, endPeriod, rewardsPerCycle);
    }

    /**
     * Transfers necessary reward balance to the contract and starts the first cycle.
     */
    function start() public onlyOwner {
        require(
            IERC20(rewardsToken).transferFrom(msg.sender, address(this), prizePool),
            "NftStaking: failed to fund the reward pool"
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
            "NftStaking: failed to withdraw from the rewards pool"
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
        TokenInfo memory tokenInfo = tokenInfos[tokenId];

        require(tokenInfo.owner == msg.sender, "NftStaking: token not staked or incorrect token owner");

        uint16 currentCycle = _getCycle(now);

        if (!disabled) {
            // ensure that at least an entire cycle has elapsed before unstaking the token to avoid
            // an exploit where a a fukll cycle would be claimable if staking just before the end
            // of a cycle and unstaking right after the start of the new cycle
            require(currentCycle - tokenInfo.depositCycle >= 2, "NftStaking: token still frozen");

            _updateHistories(msg.sender, -int128(tokenInfo.weight), currentCycle);

            // clear the token owner to ensure it cannot be unstaked again without being re-staked
            tokenInfos[tokenId].owner = address(0);
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

        emit NftUnstaked(msg.sender, currentCycle, tokenId, tokenInfo.weight);
    }

    /**
     * Estimates the claimable rewards for the specified number of periods.
     * @param maxPeriods The maximum number of periods to calculate for.
     * @return startPeriod The first period on which the computation starts.
     * @return periods The number of periods computed for.
     * @return amount The total claimable rewards.
     */
    function estimateRewards(uint16 maxPeriods) external view isEnabled hasStarted returns (
        uint16 startPeriod,
        uint16 periods,
        uint256 amount
    ) {
        (ComputedClaim memory claim, ) = _computeRewards(msg.sender, maxPeriods);
        startPeriod = claim.startPeriod;
        periods = claim.periods;
        amount = claim.amount;
    }

    /**
     * Claims the rewards for the specified number of periods.
     * @dev Creates any missing snapshots, up-to the current cycle.
     * @dev Emits the RewardsClaimed event when the function is called successfully.
     * @dev May emit the HistoriesUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @param maxPeriods The maximum number of periods to claim for.
     */
    function claimRewards(uint16 maxPeriods) external isEnabled hasStarted {

        NextClaim memory nextClaim = nextClaims[msg.sender];

        (ComputedClaim memory claim, NextClaim memory newNextClaim) = _computeRewards(msg.sender, maxPeriods);

        // free up memory on already processed staker snapshots
        Snapshot[] storage stakerHistory = stakerHistories[msg.sender];
        while (nextClaim.stakerSnapshotIndex < newNextClaim.stakerSnapshotIndex) {
            delete stakerHistory[nextClaim.stakerSnapshotIndex++];
        }

        if (claim.periods == 0) {
            return;
        }

        if (nextClaims[msg.sender].period == 0) {
            return;
        }

        Snapshot memory lastStakerSnapshot = stakerHistory[stakerHistory.length - 1];

        uint256 lastClaimedCycle = (claim.startPeriod + claim.periods - 1) * periodLengthInCycles;
        if (
            lastClaimedCycle >= lastStakerSnapshot.startCycle && // the claim reached the last staker snapshot
            lastStakerSnapshot.stake == 0                        // and nothing is staked in the last staker snapshot
        ) {
            // re-init the next claim
            delete nextClaims[msg.sender];
        } else {
            nextClaims[msg.sender] = newNextClaim;
        }

        if (claim.amount != 0) {
            require(
                IERC20(rewardsToken).transfer(msg.sender, claim.amount),
                "NftStaking: failed to transfer rewards");
        }

        emit RewardsClaimed(
            msg.sender,
            _getCycle(now),
            claim.startPeriod,
            claim.periods,
            claim.amount);
    }


//////////////////////////////////// Utility Public Functions /////////////////////////////////////

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
     * @return The last global snapshot index, or throws if there are no global history.
     */
    function lastGlobalSnapshotIndex() external view returns (uint256) {
        uint256 length = globalHistory.length;
        require(length > 0, "NftStaking: empty global history");
        return length - 1;
    }

    /**
     * Retrieves the last staker snapshot index, if any.
     * @return The last staker snapshot index, or throws if there are no staker history.
     */
    function lastStakerSnapshotIndex(address staker) external view returns (uint256) {
        Snapshot[] memory stakerHistory = stakerHistories[staker];
        uint256 length = stakerHistory.length;
        require(length > 0, "NftStaking: empty staker history");
        return length - 1;
    }


/////////////////////////////////// Staking Internal Functions ////////////////////////////////////

    /**
     * Stakes the NFT received by the contract, referenced by its specified token identifier and owner.
     * @dev Reverts if the caller is not the whitelisted NFT contract.
     * @dev Creates any missing snapshots, up-to the current cycle.
     * @dev May emit the HistoriesUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @dev Emits the NftStaked event when the function is called successfully.
     * @param tokenId Identifier of the staked NFT.
     * @param tokenOwner Owner of the staked NFT.
     */
    function _stakeNft(
        uint256 tokenId,
        address tokenOwner
    ) internal isEnabled hasStarted {
        require(whitelistedNftContract == msg.sender, "NftStaking: contract not whitelisted");

        uint64 weight = _validateAndGetWeight(tokenId);

        uint16 periodLengthInCycles_ = periodLengthInCycles;
        uint16 currentCycle = _getCycle(now);

        _updateHistories(tokenOwner, int128(weight), currentCycle);

        // initialise the next claim if it was the first stake for this staker or if
        // the next claim was re-initialised (ie. rewards were claimed until the last
        // staker snapshot and the last staker snapshot has no stake)
        if (nextClaims[tokenOwner].period == 0) {
            uint16 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles_);
            nextClaims[tokenOwner] = NextClaim(currentPeriod, uint64(globalHistory.length - 1), 0);
        }

        // set the staked token's info
        TokenInfo memory tokenInfo;
        tokenInfo.depositCycle = currentCycle;
        tokenInfo.owner = tokenOwner;
        tokenInfo.weight = weight;
        tokenInfos[tokenId] = tokenInfo;

        emit NftStaked(tokenOwner, currentCycle, tokenId, weight);
    }

    /**
     * Calculates the amount of rewards for a staker over a capped number of periods.
     * @dev Processes until the specified maximum number of periods to claim is reached, or the last computable period is reached, whichever occurs first.
     * @param staker The staker for whom the rewards will be computed.
     * @param maxPeriods Maximum number of periods over which to compute the rewards.
     * @return claim the result of computation
     * @return nextClaim the next claim which can be used to update the staker's state
     */
    function _computeRewards(
        address staker,
        uint16 maxPeriods
    ) internal view returns (
        ComputedClaim memory claim,
        NextClaim memory nextClaim
    ) {
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
        uint16 currentPeriod = _getCurrentPeriod(periodLengthInCycles_);

        // current period is not claimable
        if (nextClaim.period == currentPeriod) {
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

        // iterate over periods
        while (
            (claim.periods != maxPeriods) &&
            (nextClaim.period != currentPeriod)
        ) {
            uint16 nextPeriodStartCycle = nextClaim.period * periodLengthInCycles_ + 1;
            uint256 rewardPerCycle = payoutSchedule[nextClaim.period];
            uint256 startCycle = nextPeriodStartCycle - periodLengthInCycles_;
            uint256 endCycle = 0;

            // iterate over global snapshots
            while (endCycle != nextPeriodStartCycle) {

                // find this iteration's range-to-claim starting cycle, where
                // the current global snapshot, the current staker snapshot, and
                // the current period overlap
                if (globalSnapshot.startCycle > startCycle) {
                    startCycle = globalSnapshot.startCycle;
                }
                if (stakerSnapshot.startCycle > startCycle) {
                    startCycle = stakerSnapshot.startCycle;
                }

                // find this iteration's range-to-claim ending cycle, where the
                // current global snapshot, the current staker snapshot, and
                // the current period overlap. The end cycle is exclusive of
                // of the range-to-claim and represents the beginning cycle of
                // the next range-to-claim
                endCycle = nextPeriodStartCycle;
                if (
                    (nextGlobalSnapshot.startCycle != 0) &&
                    (nextGlobalSnapshot.startCycle < endCycle)
                ) {
                    endCycle = nextGlobalSnapshot.startCycle;
                }

                // only calculate and update the claimable rewards if there is
                // something to calculate with
                if (
                    (globalSnapshot.stake != 0) &&
                    (stakerSnapshot.stake != 0) &&
                    (rewardPerCycle != 0)
                ) {
                    uint256 snapshotReward =
                        (endCycle - startCycle)
                        .mul(rewardPerCycle)
                        .mul(stakerSnapshot.stake)
                        .mul(_DIVS_PRECISION);
                    snapshotReward /= globalSnapshot.stake;
                    snapshotReward /= _DIVS_PRECISION;

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

            ++claim.periods;
            ++nextClaim.period;
        }

        return (claim, nextClaim);
    }

    /**
     * Updates the global and staker histories at the current cycle with a new difference in stake.
     * @param staker The staker who is updating the history.
     * @param stakeDelta The difference to apply to the current stake.
     * @param currentCycle The current cycle.
     */
    function _updateHistories(address staker, int128 stakeDelta, uint16 currentCycle) internal
    {
        Snapshot memory stakerSnapshot = _updateHistory(stakerHistories[staker], stakeDelta, currentCycle);
        Snapshot memory globalSnapshot = _updateHistory(globalHistory, stakeDelta, currentCycle);

        emit HistoriesUpdated(
            staker,
            currentCycle,
            stakerSnapshot.stake,
            globalSnapshot.stake
        );
    }

    /**
     * Updates the history at the current cycle with a new difference in stake.
     * @dev It will update the latest snapshot if it starts at the current cycle, otherwise will create a new snapshot with the updated stake.
     * @param history The history to update.
     * @param stakeDelta The difference to apply to the current stake.
     * @param currentCycle The current cycle.
     */
    function _updateHistory(
        Snapshot[] storage history,
        int128 stakeDelta,
        uint16 currentCycle
    ) internal returns (Snapshot memory snapshot)
    {
        uint256 historyLength = history.length;
        if (historyLength != 0) {
            // there is an existing staker snapshot
            snapshot = history[historyLength - 1];
        }

        snapshot.stake = uint256(
            int256(snapshot.stake).add(stakeDelta)
        ).toUint128();

        if (snapshot.startCycle == currentCycle) {
            // can only happen if there was a previous snapshot as currentCycle cannot be zero!
            // replace the existing snapshot if it starts on the current cycle
            history[historyLength - 1] = snapshot;
        } else {
            // add a new snapshot in the history
            snapshot.startCycle = currentCycle;
            history.push(snapshot);
        }
    }


/////////////////////////////////// Utility Internal Functions ////////////////////////////////////

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @dev Reverts if the specified timestamp is earlier than the beginning of the staking schedule
     * @param timestamp The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 timestamp) internal view returns (uint16) {
        require(timestamp >= startTimestamp, "NftStaking: cycle preceeds contract start");
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
        require(cycle != 0, "NftStaking: period cycle cannot be zero");
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


///////////////////////////////////////// Internal Hooks //////////////////////////////////////////

    /**
     * Abstract function which validates whether or not an NFT is accepted for staking and
     * retrieves its associated weight.
     * @dev MUST throw if the token is invalid.
     * @param tokenId uint256 token identifier of the NFT.
     * @return uint64 the weight of the NFT.
     */
    function _validateAndGetWeight(uint256 tokenId) internal virtual view returns (uint64);

}
