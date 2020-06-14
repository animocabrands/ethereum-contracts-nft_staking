// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/math/Math.sol";
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

    event PayoutScheduled(
        uint256 startPeriod,
        uint256 endPeriod,
        uint256 payoutPerCycle
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
        uint256 startPeriod,
        uint256 periodsClaimed,
        uint256 amount
    );

    event HistoryUpdated(
        address staker,
        uint256 startCycle,
        uint256 stakerStake,
        uint256 globalStake
    );

    // optimised for usage in storage
    struct Snapshot {
        uint128 stake;
        uint128 startCycle;
    }

    // optimised for usage in storage
    struct NextClaim {
        uint16 period;
        uint64 globalHistoryIndex;
        uint64 stakerHistoryIndex;
    }

    // optimised for usage in storage
    struct TokenInfo {
        address owner;
        uint64 weight;
        uint16 depositCycle;
    }

    // used as a container to hold result values from computing claimable rewards.
    struct ComputeRewardsResult {
        uint256 claimableRewards;
        NextClaim nextClaim;
        uint16 firstClaimablePeriod;
        uint16 computedPeriods;
    }

    // used to bypass the stack limit
    struct ComputeRewardsIterationVariables {
        Snapshot globalSnapshot;
        Snapshot nextGlobalSnapshot;
        Snapshot stakerSnapshot;
        Snapshot nextSnapshot;
    }

    bool public disabled = false;

    uint256 public prizePool = 0; // prize pool for the entire schedule
    uint256 public startTimestamp = 0; // starting timestamp of the staking schedule, in seconds since epoch

    address public immutable whitelistedNftContract; // ERC1155-compliant NFT contract from which staking is accepted.
    address public immutable rewardsToken; // ERC20-compliant contract used as staking rewards

    uint32 public immutable cycleLengthInSeconds;
    uint16 public immutable periodLengthInCycles;

    uint16 internal constant _FREEZE_LENGTH_IN_CYCLES = 2;

    Snapshot[] public globalHistory;
    mapping(address /* staker */ => Snapshot[]) public stakerHistories;

    mapping(address /* staker */ => NextClaim) public nextClaims;
    mapping(uint256 /* tokenId */ => TokenInfo) public tokenInfos;
    mapping(uint256 /* period */ => uint256 /* rewards per-cycle */) public rewardSchedule;

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
        require(cycleLengthInSeconds_ >= 1 minutes, "NftStaking: Cycles must be at least one minute");
        require(periodLengthInCycles_ >= 2, "NftStaking: Periods must be at least 2 cycles long");

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
     * @param payoutPerCycle The prize for each cycle within range.
     */
    function setRewardsForPeriods(
        uint16 startPeriod,
        uint16 endPeriod,
        uint256 payoutPerCycle
    ) public onlyOwner {
        require(startPeriod != 0 && startPeriod <= endPeriod, "NftStaking: Wrong period range");

        for (uint16 period = startPeriod; period <= endPeriod; ++period) {
            rewardSchedule[period] = payoutPerCycle;
        }

        uint256 reward = payoutPerCycle;
        reward = reward.mul(periodLengthInCycles);
        reward = reward.mul(endPeriod - startPeriod + 1);

        prizePool = prizePool.add(reward);

        emit PayoutScheduled(startPeriod, endPeriod, payoutPerCycle);
    }

    /**
     * Transfers necessary reward balance to the contract from the reward token contract,
     * and begins running the staking schedule.
     */
    function start() public onlyOwner {
        require(
            IERC20(rewardsToken).transferFrom(msg.sender, address(this), prizePool),
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

        require(tokenInfo.owner == msg.sender, "NftStaking: Incorrect token owner or token already unstaked");

        uint16 currentCycle = _getCycle(now);
        // uint16 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles);

        // by-pass operations if the contract is disabled, to avoid unnecessary calculations and
        // reduce the gas requirements for the caller
        if (!disabled) {
            require(currentCycle - tokenInfo.depositCycle >= _FREEZE_LENGTH_IN_CYCLES, "NftStaking: Token is still frozen");

            int64 stakeDelta = -int64(tokenInfo.weight); // int64 conversion is safe because weight < 2**64
            _updateHistory(msg.sender, stakeDelta, currentCycle);

            // clear the token owner to ensure that it cannot be unstaked again
            // without being re-staked
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
     * @param maxPeriods The maximum number of claimable periods to calculate for.
     * @return firstClaimablePeriod The first period on which the computation starts.
     * @return computedPeriods The number of periods computed for.
     * @return claimableRewards The total claimable rewards.
     */
    function estimateRewards(uint16 maxPeriods) external view isEnabled hasStarted returns (
        uint16 firstClaimablePeriod,
        uint16 computedPeriods,
        uint256 claimableRewards
    ) {
        ComputeRewardsResult memory result = _computeRewards(msg.sender, maxPeriods);
        firstClaimablePeriod = result.firstClaimablePeriod;
        computedPeriods = result.computedPeriods;
        claimableRewards = result.claimableRewards;
    }

    /**
     * Claims the rewards for the specified number of periods.
     * @dev Creates any missing snapshots, up-to the current cycle.
     * @dev Emits the RewardsClaimed event when the function is called successfully.
     * @dev May emit the HistoryUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @param maxPeriods The maximum number of periods to claim for.
     */
    function claimRewards(uint16 maxPeriods) external isEnabled hasStarted {
        ComputeRewardsResult memory result = _computeRewards(msg.sender, maxPeriods);
        if (result.computedPeriods == 0) {
            return;
        }

        Snapshot[] memory stakerHistory = stakerHistories[msg.sender];
        Snapshot memory lastStakerSnapshot = stakerHistory[stakerHistory.length - 1];
        uint256 lastClaimableCycle = (result.firstClaimablePeriod + result.computedPeriods) * periodLengthInCycles;
        if (
            lastClaimableCycle >= lastStakerSnapshot.startCycle && // the claim overlaps with the last staker snapshot
            lastStakerSnapshot.stake == 0                          // and nothing is staked in the last staker snapshot
        ) {
            // re-init the next claim
            delete nextClaims[msg.sender];
        } else {
            nextClaims[msg.sender] = result.nextClaim;
        }

        if (result.claimableRewards != 0) {
            require(
                IERC20(rewardsToken).transfer(msg.sender, result.claimableRewards),
                "NftStaking: Failed to transfer claimed rewards");
        }

        emit RewardsClaimed(
            msg.sender,
            result.firstClaimablePeriod,
            result.computedPeriods,
            result.claimableRewards);
    }


//////////////////////////////////// Utility Public Functions /////////////////////////////////////

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() external view returns (uint16) {
        // index is 1 based
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
     * @dev May emit the HistoryUpdated event if any snapshots are created or modified to ensure that snapshots exist, up-to the current cycle.
     * @dev Emits the NftStaked event when the function is called successfully.
     * @param tokenId Identifier of the staked NFT.
     * @param tokenOwner Owner of the staked NFT.
     */
    function _stakeNft(
        uint256 tokenId,
        address tokenOwner
    ) internal isEnabled hasStarted {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");

        uint64 weight = _validateAndGetWeight(tokenId);
        require(weight < 2**64, "NftStaking: weight is too big");

        uint16 periodLengthInCycles_ = periodLengthInCycles;
        uint16 currentCycle = _getCycle(now);

        _updateHistory(tokenOwner, int64(weight), currentCycle);

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
     * @param maxPeriods Maximum number of periods over which to compute the claimable rewards.
     * @return CalculateRewardsResult result as follow:
     *  ComputeRewardsResult {
          uint256 claimableRewards;
          NextClaim nextClaim;
          uint16 firstClaimablePeriod;
          uint16 computedPeriods;
        }
     */
    function _computeRewards(
        address staker,
        uint16 maxPeriods
    ) internal view returns (ComputeRewardsResult memory)
    {
        ComputeRewardsResult memory result;

        // calculating for 0 periods
        if (maxPeriods == 0) {
            return result;
        }

        uint256 globalHistoryLength = globalHistory.length;

        // the history is empty
        if (globalHistoryLength == 0) {
            return result;
        }

        result.nextClaim = nextClaims[staker];
        result.firstClaimablePeriod = result.nextClaim.period;

        // nothing has been staked yet
        if (result.firstClaimablePeriod == 0) {
            return result;
        }

        uint16 periodLengthInCycles_ = periodLengthInCycles;
        uint16 currentPeriod = _getCurrentPeriod(periodLengthInCycles_);

        // current period is not claimable
        if (result.nextClaim.period == currentPeriod) {
            return result;
        }

        // iterate over periods
        while (
            result.computedPeriods < maxPeriods &&  // max number of periods not reached
            result.nextClaim.period < currentPeriod // and period didn't reach current period
        ) {
            ComputeRewardsIterationVariables memory $;
            // struct ComputeRewardsIterationVariables {
            //     Snapshot globalSnapshot;
            //     Snapshot nextGlobalSnapshot;
            //     Snapshot stakerSnapshot;
            //     Snapshot nextSnapshot;
            // }

            // Retrieve the active global and staker snapshots
            Snapshot[] memory stakerHistory = stakerHistories[staker];
            $.globalSnapshot = globalHistory[result.nextClaim.globalHistoryIndex];
            $.stakerSnapshot = stakerHistory[result.nextClaim.stakerHistoryIndex];
            if (result.nextClaim.globalHistoryIndex != globalHistory.length - 1) {
                // there is a next global snapshot
                $.nextGlobalSnapshot = globalHistory[result.nextClaim.globalHistoryIndex + 1];
                if (result.nextClaim.stakerHistoryIndex != stakerHistory.length - 1) {
                    // there is a next staker snapshot
                    $.nextSnapshot = stakerHistory[result.nextClaim.stakerHistoryIndex + 1];
                }
            }

            // iterate over global snapshots inside the period
            uint16 nextPeriodStartCycle = result.nextClaim.period * periodLengthInCycles_ + 1;
            bool endOfPeriodReached = false;
            while (!endOfPeriodReached) {
                uint256 startCycle = Math.max(
                    $.globalSnapshot.startCycle,                 // if the global snapshot starts before the current period,
                    nextPeriodStartCycle - periodLengthInCycles_ // use the current period first cycle as starting point for computation
                );
                uint256 nbCycles;
                if (
                    $.nextGlobalSnapshot.startCycle != 0 &&                // there is a next global snapshot
                    $.nextGlobalSnapshot.startCycle < nextPeriodStartCycle // which starts during the current period
                ) {
                    // compute until next global snapshot
                    nbCycles = $.nextGlobalSnapshot.startCycle - startCycle;
                } else {
                    // extrapolate until end of period
                    nbCycles = nextPeriodStartCycle - startCycle;
                    endOfPeriodReached = true;
                }
                uint256 snapshotReward = nbCycles;                         // nb cycles
                snapshotReward *= rewardSchedule[result.nextClaim.period]; // * reward per-cycle
                snapshotReward *= $.stakerSnapshot.stake;                  // * staker stake
                snapshotReward *= _DIVS_PRECISION;
                snapshotReward /= $.globalSnapshot.stake;                  // / global stake
                snapshotReward /= _DIVS_PRECISION;
                result.claimableRewards = result.claimableRewards.add(snapshotReward);

                if (
                    !endOfPeriodReached ||                                  // there are more global snapshots in the current period
                    $.nextGlobalSnapshot.startCycle == nextPeriodStartCycle // or the next global snapshot starts at next period start cycle
                ) {
                    // move current global snapshot to next snapshot
                    $.globalSnapshot = $.nextGlobalSnapshot;
                    ++result.nextClaim.globalHistoryIndex;
                    if (result.nextClaim.globalHistoryIndex != globalHistory.length - 1) {
                        // there is a next global snapshot
                        $.nextGlobalSnapshot = globalHistory[result.nextClaim.globalHistoryIndex + 1];
                        if (
                            $.nextSnapshot.startCycle != 0 &&                            // there is a next staker snapshot
                            $.nextSnapshot.startCycle == $.nextGlobalSnapshot.startCycle // which starts at the next global snapshot
                        ) {
                            // move current staker snapshot to next
                            $.stakerSnapshot = $.nextSnapshot;
                            ++result.nextClaim.stakerHistoryIndex;
                            if (result.nextClaim.stakerHistoryIndex != stakerHistory.length - 1) {
                                // there is a next staker snapshot
                                $.nextSnapshot = stakerHistory[result.nextClaim.stakerHistoryIndex + 1];
                            } else {
                                // there is no next staker snapshot
                                $.nextSnapshot = Snapshot(0, 0);
                            }
                        }
                    } else {
                        // there is no next global snapshot
                        $.nextGlobalSnapshot = Snapshot(0, 0);
                    }
                }
            }

            ++result.computedPeriods;
            ++result.nextClaim.period;
        }
        return result;
    }


/////////////////////////////////// Utility Internal Functions ////////////////////////////////////

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @dev Reverts if the specified timestamp is earlier than the beginning of the staking schedule
     * @param timestamp The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 timestamp) internal view returns (uint16) {
        require(timestamp >= startTimestamp, "NftStaking: Cycle timestamp preceeds the contract start timestamp");
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
        require(cycle != 0, "NftStaking: Period cycle cannot be zero");
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

    /**
     * Updates the histories at the current cycle with a new difference in stake.
     * @dev It will update the latest snapshot if it starts at the current cycle, otherwise will adjust the snapshots range end back by one cycle (the previous cycle) and create a new snapshot for the current cycle with the stake update.
     * @param staker The staker who is updating the history.
     * @param stakeDelta The difference to apply to the current stake.
     * @param currentCycle The current staking cycle.
     */
    function _updateHistory(
        address staker,
        int64 stakeDelta,
        uint16 currentCycle
    ) internal
    {
        Snapshot[] storage stakerHistory = stakerHistories[staker];
        uint256 stakerHistoryLength = stakerHistory.length;
        Snapshot memory newSnapshot;
        if (stakerHistoryLength != 0) {
            newSnapshot = stakerHistory[stakerHistoryLength - 1];
            // we assume the conversion to int64 is safe (stake < 2**64)
            newSnapshot.stake = uint256(int64(newSnapshot.stake) + stakeDelta).toUint64(); // assumed to be safe
        } else {
            // startCycle defaults to zero
            // can only happen on an initial staking operation (stakeDelta > 0)
            newSnapshot.stake = uint256(stakeDelta).toUint64();
        }

        if (newSnapshot.startCycle == currentCycle) {
            // can only happen if there was a previous snapshot as currentCycle cannot be zero
            // replace the existing snapshot if it starts on the current cycle
            stakerHistory[stakerHistoryLength - 1] = newSnapshot;
        } else {
            // add a new snapshot in the history
            newSnapshot.startCycle = currentCycle;
            stakerHistory.push(newSnapshot);
        }

        uint256 globalHistoryLength = globalHistory.length;
        Snapshot memory newGlobalSnapshot;
        if (globalHistoryLength != 0) {
            newGlobalSnapshot = globalHistory[globalHistoryLength - 1];
            // we assume the conversion to int64 is safe (stake < 2**64)
            newGlobalSnapshot.stake = uint256(int64(newGlobalSnapshot.stake) + stakeDelta).toUint64(); // assumed to be safe
        } else {
            // startCycle defaults to zero
            // can only happen on an initial staking operation (stakeDelta > 0)
            newGlobalSnapshot.stake = uint256(stakeDelta).toUint64();
        }

        if (newGlobalSnapshot.startCycle == currentCycle) {
            // can only happen if there was a previous snapshot as currentCycle cannot be zero
            // replace the existing snapshot if it starts on the current cycle
            globalHistory[globalHistoryLength - 1] = newGlobalSnapshot;
        } else {
            // add a new snapshot in the history
            newGlobalSnapshot.startCycle = currentCycle;
            globalHistory.push(newGlobalSnapshot);
        }

        emit HistoryUpdated(
            staker,
            newSnapshot.stake,
            newGlobalSnapshot.stake,
            currentCycle
        );
    }

///////////////////////////////////////// Internal Hooks //////////////////////////////////////////

    /**
     * Abstract function which validates whether or not the supplied NFT identifier is accepted for staking
     * and retrieves its associated weight.
     * @dev MUST throw if the token is invalid.
     * @param nftId uint256 NFT identifier used to determine if the token is valid for staking.
     * @return uint32 the weight of the NFT.
     */
    function _validateAndGetWeight(uint256 nftId) internal virtual view returns (uint64);

}
