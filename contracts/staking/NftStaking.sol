// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC721/IERC721.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/ERC1155TokenReceiver.sol";

abstract contract NftStaking is Ownable, Pausable, ERC1155TokenReceiver {

    using SafeMath for uint256;
    using SafeCast for uint256;

    uint256 internal constant _DIVS_PRECISION = 10 ** 10;

    // a struct container used to track aggregate changes in staked tokens and
    // dividends, over time
    struct DividendsSnapshot {
        uint32 cycleRangeStart; // starting cycle of the snapshot
        uint32 cycleRangeEnd; // ending cycle of the snapshot
        uint64 stakedWeight; // current total weight of all NFTs staked
        uint128 tokensToClaim; // current total dividends available for payout across the snapshot duration
    }

    // a struct container used to track a staker's aggregate staking info
    struct StakerState {
        uint64 cycleToRename; // beginning cycle from which a staker may claim dividend rewards for staked NFTs
        uint64 stakedWeight; // current total weight of NFTs staked by the staker
    }

    // a struct container used to track staked tokens
    struct TokenInfo {
        address owner; // owner of the staked NFT
        uint64 depositTimestamp; // initial deposit timestamp of the NFT, in seconds since epoch
        uint64 depositCycle; // cycle in which the token was deposited for staking
    }

    // a struct container for getting around the stack limit of the
    // claimDividends() and estimatePayout() functions
    struct ClaimDivsParams {
        uint256 currentPayoutPeriod;
        uint256 payoutPeriodToClaim;
        uint256 startSnapshotIndex;
        uint256 lastSnapshotIndex;
        uint256 nextPayoutPeriodCycle;
        uint256 payoutPerCycle;
        uint256 rangeStart;
        uint256 rangeEnd;
        uint256 periodLengthInCycles;
        uint256 depositCycle;
    }

    // emitted when the staking starts
    event PayoutSetForPeriods(
        uint256 startPeriod,
        uint256 endPeriod,
        uint128 payoutPerCycle
    );

    // emitted when an NFT is staked
    event Deposit(
        address indexed from, // original owner of the NFT
        uint256 tokenId, // NFT identifier
        uint256 currentCycle // the cycle in which the token was deposited
    );

    // emitted when an NFT is unstaked
    event Withdrawal(
        address indexed from, // original owner of the NFT
        uint256 tokenId, // NFT identifier
        uint256 currentCycle // the cycle in which the token was withdrawn
    );

    // emitted when dividends are claimed
    event ClaimedDivs(
        address indexed from, // staker claiming the dividends
        uint256 snapshotStartIndex, // claim snapshot starting index
        uint256 snapshotEndIndex, // claim snapshot ending index
        uint256 amount // amount of dividends claimed
    );

    // emitted when a new snapshot is created
    event SnapshotCreated(
        uint256 indexed index, // index (index-0 based) of the snapshot in the history list
        uint32 indexed cycleRangeStart, // starting cycle of the snapshot
        uint32 indexed cycleRangeEnd, // ending cycle of the snapshot
        uint64 stakedWeight, // initial total weight of all NFTs staked
        uint128 tokensToClaim // initial total dividends available for payout across the snapshot duration
    );

    // emitted when an existing snapshot is updated
    event SnapshotUpdated(
        uint256 indexed index, // index (index-0 based) of the snapshot in the history list
        uint32 indexed cycleRangeStart, // starting cycle of the snapshot
        uint32 indexed cycleRangeEnd, // ending cycle of the snapshot
        uint64 stakedWeight, // current total weight of all NFTs staked
        uint128 tokensToClaim // current total dividends available for payout across the snapshot duration
    );

    bool internal _disabled; // flags whether or not the contract is disabled

    uint256 public startTimestamp = 0; // staking started timestamp, in seconds since epoch
    uint256 public totalPayout = 0; // payout to be distributed over the entire schedule

    uint256 public immutable cycleLengthInSeconds;
    uint256 public immutable periodLengthInCycles;
    uint256 public immutable freezeDurationAfterStake; // initial duration that a newly staked NFT is locked before it can be with drawn from staking, in seconds
    // uint128 public rewardPoolBase; // amount of reward pool tokens to set as the initial tokens to claim when a new snapshot is created

    // mapping(address => bool) public rewardPoolProviders; // reward pool provider address => authorized flag
    mapping(address => StakerState) public stakeStates; // staker address => staker state
    mapping(uint256 => uint256) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => payout weight
    mapping(uint256 => TokenInfo) public tokensInfo; // NFT identifier => token info
    mapping(uint256 => uint128) public payoutSchedule; // period => payout per-cycle

    DividendsSnapshot[] public dividendsSnapshots; // snapshot history of staking and dividend changes

    address public whitelistedNftContract; // contract that has been whitelisted to be able to perform transfer operations of staked NFTs
    address public dividendToken; // ERC20-based token used in dividend payouts

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender, periodLengthInCycles) == 0, "NftStaking: Dividends are not claimed");
        _;
    }

    modifier hasStarted() {
        require(startTimestamp != 0, "NftStaking: Staking has not started yet");
        _;
    }

    // modifier onlyRewardPoolProvider() {
    //     require(rewardPoolProviders[msg.sender], "NftStaking: Not a pool reward provider");
    //     _;
    // }

    modifier isEnabled() {
        require(!_disabled, "NftStaking: Staking operations are disabled");
        _;
    }

    /**
     * @dev Constructor.
     * @param cycleLengthInSeconds_ Length of a cycle, in seconds.
     * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
     * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
    //  * @ param rewardPoolBase_ Amount of reward pool tokens to set as the initial tokens to claim when a new snapshot is created.
     * @param whitelistedNftContract_ Contract that has been whitelisted to be able to perform transfer operations of staked NFTs.
     * @param dividendToken_ The ERC20-based token used in dividend payouts.
     * @param values NFT token classifications (e.g. tier, rarity, category).
     * @param valueWeights Dividend reward allocation weight for each NFT token classification defined by the 'value' argument.
     */
    constructor(
        uint256 cycleLengthInSeconds_,
        uint256 periodLengthInCycles_,
        uint256 freezeDurationAfterStake_,
        // uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint256[] memory values,
        uint256[] memory valueWeights
    ) internal {
        require(periodLengthInCycles_ != 0, "NftStaking: Zero payout period length");
        require(values.length == valueWeights.length, "NftStaking: Mismatch in value/weight array argument lengths");

        _disabled = false;

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        freezeDurationAfterStake = freezeDurationAfterStake_;
        // rewardPoolBase = rewardPoolBase_;
        whitelistedNftContract = whitelistedNftContract_;
        dividendToken = dividendToken_;

        for (uint256 i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }
    }

    // /**
    //  * Sets the dividend token to use for dividend payouts.
    //  * @param dividendToken_ The address of an IERC20 compatible token to use for dividend payouts.
    //  */
    // function setDividendToken(address dividendToken_) public onlyOwner {
    //     dividendToken = dividendToken_;
    // }

    // /**
    //  * Sets the period of time, in seconds, for which a newly staked token cannot be withdrawn. After the freeze duration has elapsed, the staked token can be unstaked.
    //  * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
    //  */
    // function setFreezeDurationAfterStake(uint256 freezeDurationAfterStake_) public onlyOwner {
    //     freezeDurationAfterStake = freezeDurationAfterStake_;
    // }

    /**
     * Transfers total payout balance to the contract and starts the staking.
     */
    function start() public onlyOwner {
        require(
            IERC20(dividendToken).transferFrom(msg.sender, address(this), totalPayout),
            "NftStaking: failed to transfer the total payout"
        );

        startTimestamp = now;
    }

    /**
     * Set the payout for a range of periods.
     * @param startPeriod The starting period.
     * @param endPeriod The ending period.
     * @param payoutPerCycle The total payout for each cycle within range.
     */
    function setPayoutForPeriods(
        uint256 startPeriod,
        uint256 endPeriod,
        uint128 payoutPerCycle
    ) public onlyOwner {
        require(startPeriod > 0 && startPeriod <= endPeriod, "NftStaking: wrong period range");
        for (uint256 period = startPeriod; period < endPeriod; ++period) {
            payoutSchedule[period] = payoutPerCycle;
        }
        totalPayout = totalPayout.add(
            (endPeriod - startPeriod + 1)
            .mul(payoutPerCycle)
            .mul(periodLengthInCycles)
        );

        emit PayoutSetForPeriods(startPeriod, endPeriod, payoutPerCycle);
    }

    /**
     * Withdraws a specified amount of dividends from the contract reward pool.
     * @param amount The amount to withdraw.
     */
    function withdrawDivsPool(uint256 amount) public onlyOwner {
        require(IERC20(dividendToken).transfer(msg.sender, amount), "NftStaking: Unknown failure when attempting to withdraw from the dividends reward pool");
    }

    /**
     * Permanently disables all staking and claiming functionality of the contract.
     */
    function disable() public onlyOwner {
        _disabled = true;
    }

    /**
     * Handle the receipt of a single ERC1155 token type.
     * @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeTransferFrom` after the balance has been updated.
     * This function MUST return `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))` (i.e. 0xf23a6e61) if it accepts the transfer.
     * This function MUST revert if it rejects the transfer.
     * Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
     * @param //operator The address which initiated the transfer (i.e. msg.sender).
     * @param from The address which previously owned the token.
     * @param id The ID of the token being transferred.
     * @param //value The amount of tokens being transferred.
     * @param //data Additional data with no specified format.
     * @return `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))`.
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
    divsClaimed(from)
    returns (bytes4)
    {
        _depositNft(id, from);
        return _ERC1155_RECEIVED;
    }

    /**
     * Handle the receipt of multiple ERC1155 token types.
     * @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeBatchTransferFrom` after the balances have been updated.
     * This function MUST return `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))` (i.e. 0xbc197c81) if it accepts the transfer(s).
     * This function MUST revert if it rejects the transfer(s).
     * Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
     * @param //operator The address which initiated the batch transfer (i.e. msg.sender).
     * @param from The address which previously owned the token.
     * @param ids An array containing ids of each token being transferred (order and length must match _values array).
     * @param //values An array containing amounts of each token being transferred (order and length must match _ids array).
     * @param //data Additional data with no specified format.
     * @return `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`.
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
    divsClaimed(from)
    returns (bytes4)
    {
        for (uint256 i = 0; i < ids.length; ++i) {
            _depositNft(ids[i], from);
        }
        return _ERC1155_BATCH_RECEIVED;
    }

    // /**
    //  * Sets the authorization state of the specified pool provider.
    //  * @param provider The provider whose authorization state will be set.
    //  * @param authorize The authorization state to set with.
    //  */
    // function setPoolProvider(address provider, bool authorize) external onlyOwner {
    //     rewardPoolProviders[provider] = authorize;
    // }

    // /**
    //  * Permanently increases the reward pool balance of the current and new snapshots.
    //  * @param amount The amount to increase the reward pool balance by.
    //  */
    // function rewardPoolBalanceIncreased(uint128 amount) external onlyRewardPoolProvider {
    //     // get latest reward pool snapshot and increased it
    //     (DividendsSnapshot storage writeSnapshot, uint256 snapshotIndex) = _getOrCreateLatestCycleSnapshot(0);

    //     // in-memory copy of the latest snapshot for reads, to save gas
    //     DividendsSnapshot memory readSnapshot = writeSnapshot;

    //     uint128 tokensToClaim = SafeMath.add(readSnapshot.tokensToClaim, amount).toUint128();

    //     writeSnapshot.tokensToClaim = tokensToClaim;

    //     emit SnapshotUpdated(
    //         snapshotIndex,
    //         readSnapshot.cycleRangeStart,
    //         readSnapshot.cycleRangeEnd,
    //         readSnapshot.stakedWeight,
    //         tokensToClaim);

    //     // update the reward pool base amount to persist the change for new
    //     // snapshots created, moving forward
    //     rewardPoolBase = SafeMath.add(rewardPoolBase, amount).toUint128();
    // }

    /**
     * Retrieves, or creates (if one does not already exist), a dividends snapshot for the timestamp derived from the specified offset to the current time, in seconds.
     * @param offsetIntoFuture The offset from the current time to create the snapshot for, in seconds.
     * @return The dividends snapshot, or a newly created one, for the timestamp derived from the specified offset to the current time.
     * @return The index of the retrieved snapshot.
     */
    function _getOrCreateLatestCycleSnapshot(uint256 offsetIntoFuture) internal returns(DividendsSnapshot storage, uint256) {
        uint32 currentCycle = uint32(_getCycle(now + offsetIntoFuture));
        uint256 totalSnapshots = dividendsSnapshots.length;
        // uint128 initialTokensToClaim = rewardPoolBase;
        uint128 initialTokensToClaim = 0;

        // empty snapshot history
        if (totalSnapshots == 0) {
            // create the very first snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, 0, initialTokensToClaim);
            // return _addNewSnapshot(uint32(_getCycle(block.timestamp)), currentCycle, 0, initialTokensToClaim);
        }

        uint256 snapshotIndex = totalSnapshots - 1;

        // get the latest snapshot
        DividendsSnapshot storage writeSnapshot = dividendsSnapshots[snapshotIndex];

        // latest snapshot ends on the current cycle
        if (writeSnapshot.cycleRangeEnd == currentCycle) {
            // this is the very latest snapshot
            return (writeSnapshot, snapshotIndex);
        }

        // in-memory copy of the latest snapshot for reads, to save gas
        DividendsSnapshot memory readSnapshot = writeSnapshot;

        uint256 periodLengthInCycles_ = periodLengthInCycles;
        uint256 currentPayoutPeriod = _getCurrentPayoutPeriod(periodLengthInCycles_);
        uint32 previousCycle = currentCycle - 1;

        // latest snapshot is for the current payout period
        if (currentPayoutPeriod == _getPayoutPeriod(readSnapshot.cycleRangeStart, periodLengthInCycles_)) {
            // latest snapshot didn't end on the previous cycle
            if (readSnapshot.cycleRangeEnd != previousCycle) {
                // simply extend the latest snapshot to capture the unaccounted
                // cycles from where the last snapshot ended, up-to the previous
                // cycle (inclusive)
                writeSnapshot.cycleRangeEnd = previousCycle;

                emit SnapshotUpdated(
                    snapshotIndex,
                    readSnapshot.cycleRangeStart,
                    previousCycle,
                    readSnapshot.stakedWeight,
                    readSnapshot.tokensToClaim);
            }

            if (readSnapshot.stakedWeight == 0) {
                initialTokensToClaim = readSnapshot.tokensToClaim;
            }

            // create a new latest snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, readSnapshot.stakedWeight, initialTokensToClaim);
        }

        // latest snapshot is for an earlier payout period

        uint32 previousPayoutPeriodCycleEnd = uint32((currentPayoutPeriod - 1) * periodLengthInCycles_);

        // latest snapshot didn't end on the end of the previous payout period
        if (readSnapshot.cycleRangeEnd != previousPayoutPeriodCycleEnd) {
            // align the latest snapshot to the end of the previous payout period
            writeSnapshot.cycleRangeEnd = previousPayoutPeriodCycleEnd;

            emit SnapshotUpdated(
                snapshotIndex,
                readSnapshot.cycleRangeStart,
                previousPayoutPeriodCycleEnd,
                readSnapshot.stakedWeight,
                readSnapshot.tokensToClaim);
        }

        // there are tokens staked and cycles unaccounted for in the current
        // payout period
        if ((readSnapshot.stakedWeight != 0) && (previousPayoutPeriodCycleEnd != previousCycle)) {
            // create a new snapshot to capture the unaccounted cycles in the
            // current payout period, up-to the previous cycle (inclusive)
            (readSnapshot, ) = _addNewSnapshot(previousPayoutPeriodCycleEnd + 1, previousCycle, readSnapshot.stakedWeight, initialTokensToClaim);
        }

        if (readSnapshot.stakedWeight == 0) {
            initialTokensToClaim = readSnapshot.tokensToClaim;
        }

        // create a new latest snapshot for the current cycle
        return _addNewSnapshot(currentCycle, currentCycle, readSnapshot.stakedWeight, initialTokensToClaim);
    }

    /**
     * Adds a new dividends snapshot to the snapshot history list.
     * @param cycleStart Starting cycle for the new snapshot.
     * @param cycleEnd Ending cycle for the new snapshot.
     * @param stakedWeight Initial staked weight for the new snapshot.
     * @param tokensToClaim Initial tokens to claim balance for the new snapshot.
     * @return The newly created snapshot.
     * @return The index of the newly created snapshot.
     */
    function _addNewSnapshot(uint32 cycleStart, uint32 cycleEnd, uint64 stakedWeight, uint128 tokensToClaim
    ) internal returns(DividendsSnapshot storage, uint256)
    {
        DividendsSnapshot memory snapshot;
        snapshot.cycleRangeStart = cycleStart;
        snapshot.cycleRangeEnd = cycleEnd;
        snapshot.stakedWeight = stakedWeight;
        snapshot.tokensToClaim = tokensToClaim;

        dividendsSnapshots.push(snapshot);

        uint256 snapshotIndex = dividendsSnapshots.length - 1;

        emit SnapshotCreated(
            snapshotIndex,
            snapshot.cycleRangeStart,
            snapshot.cycleRangeEnd,
            snapshot.stakedWeight,
            snapshot.tokensToClaim);

        return (dividendsSnapshots[snapshotIndex], snapshotIndex);
    }

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() public view returns(uint256) {
        // index is 1 based
        return _getCycle(block.timestamp);
    }

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @param ts The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 ts) internal view returns(uint256) {
        return (ts - startTimestamp) / cycleLengthInSeconds + 1;
    }

    /**
     * Retrieves the current payout period (index-1 based).
     * @return The current payout period (index-1 based).
     */
     function getCurrentPayoutPeriod() external view returns(uint256) {
         return _getCurrentPayoutPeriod(periodLengthInCycles);
     }

     /**
      * Retrieves the current payout period (index-1 based).
      * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
      * @return The current payout period (index-1 based).
      */
     function _getCurrentPayoutPeriod(uint256 periodLengthInCycles_) internal view returns(uint256) {
         return _getPayoutPeriod(getCurrentCycle(), periodLengthInCycles_);
     }

    /**
     * Retrieves the payout period (index-1 based) for the specified cycle and payout period length.
     * @param cycle The cycle within the payout period to retrieve.
     * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
     * @return The payout period (index-1 based) for the specified cycle and payout period length.
     */
    function _getPayoutPeriod(uint256 cycle, uint256 periodLengthInCycles_) internal pure returns(uint256) {
        if (cycle == 0) {
            return 0;
        }
        // index is 1 based
        return (cycle - 1) / periodLengthInCycles_ + 1;
    }

    /**
     * Retrieves the first unclaimed payout period (index-1 based) and number of unclaimed payout periods.
     * @return The first unclaimed payout period (index-1 based).
     * @return The number of unclaimed payout periods.
     */
    function getUnclaimedPayoutPeriods() external view returns(uint256, uint256) {
        StakerState memory state = stakeStates[msg.sender];
        uint256 periodLengthInCycles_ = periodLengthInCycles;
        return (
            _getPayoutPeriod(state.cycleToRename, periodLengthInCycles_),
            _getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_)
        );
    }

    /**
     * Retrieves the number of unclaimed payout periods for the specified staker.
     * @param sender The staker whose number of unclaimed payout periods will be retrieved.
     * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
     * @return The number of unclaimed payout periods for the specified staker.
     */
    function _getUnclaimedPayoutPeriods(address sender, uint256 periodLengthInCycles_) internal view returns(uint256) {
        StakerState memory state = stakeStates[sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        uint256 payoutPeriodToClaim = _getPayoutPeriod(state.cycleToRename, periodLengthInCycles_);
        return _getCurrentPayoutPeriod(periodLengthInCycles_) - payoutPeriodToClaim;
    }

    /**
     * Estimates the total claimable dividends, starting from the specified payout period over the specified number of payout periods to claim.
     * @param startPayoutPeriod The starting payout period to begin estimating the total claimable dividends.
     * @param payoutPeriodsToClaim The number of payout periods to estimate the total claimable dividends for.
     */
    function estimatePayout(uint256 startPayoutPeriod, uint256 payoutPeriodsToClaim) external view returns(uint128) {
        if (dividendsSnapshots.length == 0) {
            return 0;
        }

        ClaimDivsParams memory params;
        params.periodLengthInCycles = periodLengthInCycles;
        params.currentPayoutPeriod = _getCurrentPayoutPeriod(params.periodLengthInCycles);

        if (params.currentPayoutPeriod <= startPayoutPeriod) {
            return 0;
        }

        // handle overflow
        if (startPayoutPeriod + payoutPeriodsToClaim < payoutPeriodsToClaim) {
            payoutPeriodsToClaim = type(uint256).max - startPayoutPeriod;
        }

        StakerState memory state = stakeStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDivsToClaim = 0;

        if (_getPayoutPeriod(state.cycleToRename, params.periodLengthInCycles) >= startPayoutPeriod) {
            // if requested payout period is earlier then deposit
            params.depositCycle = state.cycleToRename;
        } else {
            // or later then latest deposit
            params.depositCycle = (startPayoutPeriod - 1) * params.periodLengthInCycles + 1;
        }

        params.payoutPeriodToClaim = _getPayoutPeriod(params.depositCycle, params.periodLengthInCycles);

        uint256 updatedPayoutPeriod = params.payoutPeriodToClaim + payoutPeriodsToClaim;
        if (updatedPayoutPeriod <= params.currentPayoutPeriod) {
            params.currentPayoutPeriod = updatedPayoutPeriod;
        }

        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(params.depositCycle);

        params.startSnapshotIndex = snapshotIndex;
        params.lastSnapshotIndex = dividendsSnapshots.length - 1;
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;
        params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.periodLengthInCycles + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * _DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / _DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                totalDivsToClaim += tokensToClaim;
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params.periodLengthInCycles);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) != _getPayoutPeriod(params.rangeEnd, params.periodLengthInCycles)) {
                        params.rangeEnd = uint32(_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) * params.periodLengthInCycles);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * _DIVS_PRECISION / snapshot.stakedWeight) * params.payoutPerCycle * (params.rangeEnd - params.rangeStart + 1) / _DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _getPayoutPeriod(params.rangeEnd, params.periodLengthInCycles) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.periodLengthInCycles + 1);
                        params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;

                        loops++;
                        if (loops >= payoutPeriodsToClaim) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }

            params.depositCycle = uint64(params.rangeEnd + 1);

            if (uint64(params.nextPayoutPeriodCycle) <= params.depositCycle) {
                params.payoutPeriodToClaim = _getPayoutPeriod(params.depositCycle, params.periodLengthInCycles);
                params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;
                loops++;
            }

            if (loops >= payoutPeriodsToClaim) {
                break;
            }

            // that was last snapshot
            if (snapshotIndex == params.lastSnapshotIndex) {
                break;
            }

            snapshotIndex++;
            snapshot = dividendsSnapshots[snapshotIndex];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        return totalDivsToClaim;
    }

    /**
     * Claims the dividends for the specified number of payout periods.
     * @param payoutPeriodsToClaim The maximum number of dividend payout periods to claim for.
     */
    function claimDividends(uint256 payoutPeriodsToClaim) external isEnabled hasStarted {
        if (payoutPeriodsToClaim == 0) {
            return;
        }

        if (dividendsSnapshots.length == 0) {
            return;
        }

        StakerState memory state = stakeStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDivsToClaim = 0;

        ClaimDivsParams memory params;
        params.periodLengthInCycles = periodLengthInCycles;
        params.currentPayoutPeriod = _getCurrentPayoutPeriod(params.periodLengthInCycles);

        // payout cycles starts from 1
        params.payoutPeriodToClaim = _getPayoutPeriod(state.cycleToRename, params.periodLengthInCycles);
        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(state.cycleToRename);

        params.startSnapshotIndex = snapshotIndex;
        params.lastSnapshotIndex = dividendsSnapshots.length - 1;
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;
        params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.periodLengthInCycles + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * _DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / _DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                snapshot.tokensToClaim -= tokensToClaim;
                dividendsSnapshots[snapshotIndex] = snapshot;

                emit SnapshotUpdated(
                    snapshotIndex,
                    snapshot.cycleRangeStart,
                    snapshot.cycleRangeEnd,
                    snapshot.stakedWeight,
                    snapshot.tokensToClaim);

                totalDivsToClaim += tokensToClaim;
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params.periodLengthInCycles);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) != _getPayoutPeriod(params.rangeEnd, params.periodLengthInCycles)) {
                        params.rangeEnd = uint32(_getPayoutPeriod(params.rangeStart, params.periodLengthInCycles) * params.periodLengthInCycles);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * _DIVS_PRECISION / snapshot.stakedWeight) * params.payoutPerCycle * (params.rangeEnd - params.rangeStart + 1) / _DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _getPayoutPeriod(params.rangeEnd, params.periodLengthInCycles) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.periodLengthInCycles + 1);
                        params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;

                        loops++;
                        if (loops >= payoutPeriodsToClaim) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }

            state.cycleToRename = uint64(params.rangeEnd + 1);

            if (uint64(params.nextPayoutPeriodCycle) <= state.cycleToRename) {
                params.payoutPeriodToClaim = _getPayoutPeriod(state.cycleToRename, params.periodLengthInCycles);
                params.payoutPerCycle = payoutSchedule[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.periodLengthInCycles + 1;
                loops++;
            }

            if (loops >= payoutPeriodsToClaim) {
                break;
            }

            // that was last snapshot
            if (snapshotIndex == params.lastSnapshotIndex) {
                break;
            }

            snapshotIndex++;
            snapshot = dividendsSnapshots[snapshotIndex];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        stakeStates[msg.sender] = state;

        if (totalDivsToClaim > 0) {
            // must never underflow
            // require(IERC20(dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "NftStaking: Insufficient tokens in the rewards pool");
            require(IERC20(dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "NftStaking: Insufficient tokens in the rewards pool");
            require(IERC20(dividendToken).transfer(msg.sender, totalDivsToClaim), "NftStaking: Unknown failure when attempting to transfer claimed dividend rewards");

            emit ClaimedDivs(msg.sender, params.startSnapshotIndex, uint256(snapshotIndex), totalDivsToClaim);
        }
    }

    /**
     * Unstakes a deposited NFT from the contract.
     * @dev Reverts if the caller is not the original owner of the NFT.
     * @dev While the contract is enabled, reverts if there are outstanding dividends to be claimed.
     * @dev While the contract is enabled, reverts if NFT is being withdrawn before the staking freeze duration has elapsed.
     * @param tokenId The token identifier, referencing the NFT being withdrawn.
     */
    function withdrawNft(uint256 tokenId) external virtual {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];
        require(tokenInfo.owner == msg.sender, "NftStaking: Token owner doesn't match or token was already withdrawn before");

        uint256 currentCycle = getCurrentCycle();
        uint256 periodLengthInCycles_ = periodLengthInCycles;

        // by-pass staked weight operations if the contract is disabled, to
        // avoid unnecessary calculations and reduce the gas requirements for
        // the caller
        if (!_disabled) {
            require(_getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_) == 0, "NftStaking: Dividends are not claimed");
            require(now - tokenInfo.depositTimestamp > freezeDurationAfterStake, "NftStaking: Staking freeze duration has not yet elapsed");

            // reset to indicate that token was withdrawn
            tokensInfo[tokenId].owner = address(0);

            // decrease stake weight based on NFT value
            uint64 nftWeight = uint64(valueStakeWeights[_valueFromTokenId(tokenId)]);

            // uint256 startCycle = Math.max(
            //     currentCycle - (currentCycle % periodLengthInCycles_) + 1, // First cycle of the current period
            //     tokenInfo.depositCycle                                   // Deposit cycle of the token
            // );

            // Decrease staking weight for every snapshot for the current payout period
            uint256 startCycle = (_getPayoutPeriod(currentCycle, periodLengthInCycles_) - 1) * periodLengthInCycles_ + 1;

            // uint256 startCycle =
            //     (_getPayoutPeriod(currentCycle, periodLengthInCycles_) - 1) // Previous payout period
            //      * periodLengthInCycles_ // Last cycle of the previous payout period
            //     + 1;

            if (startCycle < tokenInfo.depositCycle) {
                startCycle = tokenInfo.depositCycle;
            }

            (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(startCycle);
            uint256 lastSnapshotIndex = dividendsSnapshots.length - 1;

            // Decrease staking weight for every snapshot for the current payout period
            while (startCycle <= currentCycle) {
                startCycle = snapshot.cycleRangeEnd + 1;

                // must never underflow
                require(snapshot.stakedWeight >= nftWeight, "NftStaking: Staked weight underflow");
                snapshot.stakedWeight -= nftWeight;
                dividendsSnapshots[snapshotIndex] = snapshot;

                emit SnapshotUpdated(
                    snapshotIndex,
                    snapshot.cycleRangeStart,
                    snapshot.cycleRangeEnd,
                    snapshot.stakedWeight,
                    snapshot.tokensToClaim);

                // outside the range of current snapshot, query next
                if (startCycle > snapshot.cycleRangeEnd) {
                    snapshotIndex++;
                    if (snapshotIndex > lastSnapshotIndex) {
                        // reached the end of snapshots
                        break;
                    }
                    snapshot = dividendsSnapshots[snapshotIndex];
                }
            }

            StakerState memory state = stakeStates[msg.sender];

            // decrease staker weight
            state.stakedWeight -= nftWeight;
            // if no more nfts left to stake - reset depositCycle
            if (state.stakedWeight == 0) {
                state.cycleToRename = 0;
            }

            stakeStates[msg.sender] = state;
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

        emit Withdrawal(msg.sender, tokenId, currentCycle);
    }

    /**
     * Stakes the NFT received by the contract, referenced by its specified token identifier and owner.
     * @param tokenId Identifier of the staked NFT.
     * @param tokenOwner Owner of the staked NFT.
     */
    function _depositNft(uint256 tokenId, address tokenOwner) internal isEnabled whenNotPaused hasStarted {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");
        require(_isCorrectTokenType(tokenId), "NftStaking: Attempting to deposit an invalid token type");

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = uint64(block.timestamp);
        tokenInfo.owner = tokenOwner;

        // add weight based on token type
        uint64 nftWeight = uint64(valueStakeWeights[_valueFromTokenId(tokenId)]);

        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _getOrCreateLatestCycleSnapshot(freezeDurationAfterStake);

        uint64 stakedWeight = snapshot.stakedWeight + nftWeight;

        // increase current snapshot total staked weight
        dividendsSnapshots[snapshotIndex].stakedWeight = stakedWeight;

        emit SnapshotUpdated(
            snapshotIndex,
            snapshot.cycleRangeStart,
            snapshot.cycleRangeEnd,
            stakedWeight,
            snapshot.tokensToClaim);

        tokenInfo.depositCycle = snapshot.cycleRangeStart;

        tokensInfo[tokenId] = tokenInfo;

        // increase staker weight and set deposit cycle to correct one from snapshot
        StakerState memory state = stakeStates[tokenOwner];
        if (state.stakedWeight == 0) {
            state.cycleToRename = snapshot.cycleRangeStart;
        }

        state.stakedWeight += nftWeight;
        stakeStates[tokenOwner] = state;

        emit Deposit(tokenOwner, tokenId, getCurrentCycle());
    }

    /**
     * Searches for the dividend snapshot containing the specified cycle. If the snapshot cannot be found then the closest snapshot by cycle range is returned.
     * @param cycle The cycle for which the dividend snapshot is searched for.
     * @return snapshot If found, the snapshot containing the specified cycle, otherwise the closest snapshot to the cycle.
     * @return snapshotIndex The index (index-0 based) of the returned snapshot.
     */
    function _findDividendsSnapshot(uint256 cycle)
    internal
    view
    returns(DividendsSnapshot memory snapshot, uint256 snapshotIndex)
    {
        uint256 low = 0;
        uint256 high = dividendsSnapshots.length - 1;
        uint256 mid = 0;

        while (low <= high) {
            // overflow protected midpoint calculation
            mid = low + ((high - low) / 2);

            snapshot = dividendsSnapshots[mid];

            if (snapshot.cycleRangeStart > cycle) {
                if (mid == 0) {
                    break;
                }

                // outside by left side of the range
                high = mid - 1;
            } else if (snapshot.cycleRangeEnd < cycle) {
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
     * Validates whether or not the supplied NFT identifier is the correct token
     * type allowable for staking.
     * @param id NFT identifier used to determine if the token is valid for staking.
     * @return True if the token can be staked, false otherwise.
     */
    function _isCorrectTokenType(uint256 id) internal virtual pure returns(bool);

    /**
     * Retrieves NFT token classification (e.g. tier, rarity, category) from the
     * given token identifier.
     * @param tokenId The token identifier from which the classification value is retrieved from.
     * @return The retrieved token classification value.
     */
    function _valueFromTokenId(uint256 tokenId) internal virtual pure returns(uint256);

}
