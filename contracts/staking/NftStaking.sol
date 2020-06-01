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

abstract contract NftStaking is Ownable, ERC1155TokenReceiver {

    using SafeMath for uint256;
    using SafeCast for uint256;

    uint256 internal constant _DIVS_PRECISION = 10 ** 10;

    // a struct container used to track aggregate changes in staked tokens and
    // dividends, over time
    struct DividendsSnapshot {
        uint32 startCycle; // starting cycle of the snapshot
        uint32 endCycle; // ending cycle of the snapshot
        uint64 stakedWeight; // current total weight of all NFTs staked
        uint128 dividendsToClaim; // current total dividends available for payout across the snapshot duration
    }

    // a struct container used to track a staker's aggregate staking info
    struct StakerState {
        uint32 nextUnclaimedPeriodStartCycle; // beginning cycle from which a staker may claim dividend rewards for staked NFTs
        uint64 stakedWeight; // current total weight of NFTs staked by the staker
    }

    struct TokenInfo {
        address owner;
        uint32 depositCycle;
        uint64 depositTimestamp; // seconds since epoch
        uint32 weight;
    }

    // a struct container for getting around the stack limit of the
    // claimDividends() and estimatePayout() functions
    struct ClaimDivsParams {
        uint256 periodLengthInCycles;
        uint256 currentPeriod;
        uint256 periodToClaim;
        uint256 startSnapshotIndex;
        uint256 lastSnapshotIndex;
        uint256 payoutPerCycle;
        uint32 depositCycle;
        uint32 startCycle;
        uint32 endCycle;
        uint32 nextPeriodCycle;
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
        uint32 currentCycle // the cycle in which the token was deposited
    );

    // emitted when an NFT is unstaked
    event Withdrawal(
        address indexed from, // original owner of the NFT
        uint256 tokenId, // NFT identifier
        uint32 currentCycle // the cycle in which the token was withdrawn
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
        uint32 indexed startCycle, // starting cycle of the snapshot
        uint32 indexed endCycle, // ending cycle of the snapshot
        uint64 stakedWeight, // initial total weight of all NFTs staked
        uint128 tokensToClaim // initial total dividends available for payout across the snapshot duration
    );

    // emitted when an existing snapshot is updated
    event SnapshotUpdated(
        uint256 indexed index, // index (index-0 based) of the snapshot in the history list
        uint32 indexed startCycle, // starting cycle of the snapshot
        uint32 indexed endCycle, // ending cycle of the snapshot
        uint64 stakedWeight, // current total weight of all NFTs staked
        uint128 tokensToClaim // current total dividends available for payout across the snapshot duration
    );

    bool internal _disabled; // flags whether or not the contract is disabled

    uint256 public startTimestamp = 0; // staking started timestamp, in seconds since epoch
    uint256 public totalPayout = 0; // payout to be distributed over the entire schedule

    uint256 public immutable cycleLengthInSeconds;
    uint256 public immutable periodLengthInCycles;
    uint256 public immutable freezeDurationAfterStake; // initial duration that a newly staked NFT is locked before it can be with drawn from staking, in seconds

    mapping(address => StakerState) public stakerStates; // staker address => staker state
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

    modifier isEnabled() {
        require(!_disabled, "NftStaking: Staking operations are disabled");
        _;
    }

    /**
     * @dev Constructor.
     * @param cycleLengthInSeconds_ Length of a cycle, in seconds.
     * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
     * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
     * @param whitelistedNftContract_ Contract that has been whitelisted to be able to perform transfer operations of staked NFTs.
     * @param dividendToken_ The ERC20-based token used in dividend payouts.
     */
    constructor(
        uint256 cycleLengthInSeconds_,
        uint256 periodLengthInCycles_,
        uint256 freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address dividendToken_
    ) internal {
        require(periodLengthInCycles_ != 0, "NftStaking: Zero payout period length");

        _disabled = false;

        cycleLengthInSeconds = cycleLengthInSeconds_;
        periodLengthInCycles = periodLengthInCycles_;
        freezeDurationAfterStake = freezeDurationAfterStake_;
        whitelistedNftContract = whitelistedNftContract_;
        dividendToken = dividendToken_;
    }

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
            endPeriod.sub(startPeriod).add(1)
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

    /**
     * Retrieves, or creates (if one does not already exist), a dividends snapshot for the timestamp derived from the specified offset to the current time, in seconds.
     * @param offsetIntoFuture The offset from the current time to create the snapshot for, in seconds.
     * @return The dividends snapshot, or a newly created one, for the timestamp derived from the specified offset to the current time.
     * @return The index of the retrieved snapshot.
     */
    function _getSnapshot(uint256 offsetIntoFuture) internal returns(DividendsSnapshot storage, uint256) {
        uint32 currentCycle = uint32(_getCycle(now.add(offsetIntoFuture)));
        uint256 totalSnapshots = dividendsSnapshots.length;
        uint128 initialDividendsToClaim = 0;

        // empty snapshot history
        if (totalSnapshots == 0) {
            // create the very first snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, 0, initialDividendsToClaim);
            // return _addNewSnapshot(uint32(_getCycle(now)), currentCycle, 0, initialDividendsToClaim);
        }

        uint256 snapshotIndex = totalSnapshots.sub(1);

        // get the latest snapshot
        DividendsSnapshot storage writeSnapshot = dividendsSnapshots[snapshotIndex];

        // latest snapshot ends on the current cycle
        if (writeSnapshot.endCycle == currentCycle) {
            // this is the very latest snapshot
            return (writeSnapshot, snapshotIndex);
        }

        // in-memory copy of the latest snapshot for reads, to save gas
        DividendsSnapshot memory readSnapshot = writeSnapshot;

        uint256 periodLengthInCycles_ = periodLengthInCycles;
        uint256 currentPeriod = _getCurrentPeriod(periodLengthInCycles_);
        uint32 previousCycle = SafeMath.sub(currentCycle, 1).toUint32();

        // latest snapshot is for the current payout period
        if (currentPeriod == _getPeriod(readSnapshot.startCycle, periodLengthInCycles_)) {
            // latest snapshot didn't end on the previous cycle
            if (readSnapshot.endCycle != previousCycle) {
                // simply extend the latest snapshot to capture the unaccounted
                // cycles from where the last snapshot ended, up-to the previous
                // cycle (inclusive)
                writeSnapshot.endCycle = previousCycle;

                emit SnapshotUpdated(
                    snapshotIndex,
                    readSnapshot.startCycle,
                    previousCycle,
                    readSnapshot.stakedWeight,
                    readSnapshot.dividendsToClaim);
            }

            if (readSnapshot.stakedWeight == 0) {
                initialDividendsToClaim = readSnapshot.dividendsToClaim;
            }

            // create a new latest snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, readSnapshot.stakedWeight, initialDividendsToClaim);
        }

        // latest snapshot is for an earlier payout period

        uint32 previousPeriodEndCycle = currentPeriod.sub(1).mul(periodLengthInCycles_).toUint32();

        // latest snapshot didn't end on the end of the previous payout period
        if (readSnapshot.endCycle != previousPeriodEndCycle) {
            // align the latest snapshot to the end of the previous payout period
            writeSnapshot.endCycle = previousPeriodEndCycle;

            emit SnapshotUpdated(
                snapshotIndex,
                readSnapshot.startCycle,
                previousPeriodEndCycle,
                readSnapshot.stakedWeight,
                readSnapshot.dividendsToClaim);
        }

        // there are tokens staked and cycles unaccounted for in the current
        // payout period
        if ((readSnapshot.stakedWeight != 0) && (previousPeriodEndCycle != previousCycle)) {
            // create a new snapshot to capture the unaccounted cycles in the
            // current payout period, up-to the previous cycle (inclusive)
            (readSnapshot, ) = _addNewSnapshot(SafeMath.add(previousPeriodEndCycle, 1).toUint32(), previousCycle, readSnapshot.stakedWeight, initialDividendsToClaim);
        }

        if (readSnapshot.stakedWeight == 0) {
            initialDividendsToClaim = readSnapshot.dividendsToClaim;
        }

        // create a new latest snapshot for the current cycle
        return _addNewSnapshot(currentCycle, currentCycle, readSnapshot.stakedWeight, initialDividendsToClaim);
    }

    /**
     * Adds a new dividends snapshot to the snapshot history list.
     * @param cycleStart Starting cycle for the new snapshot.
     * @param cycleEnd Ending cycle for the new snapshot.
     * @param stakedWeight Initial staked weight for the new snapshot.
     * @param dividendsToClaim Initial tokens to claim balance for the new snapshot.
     * @return The newly created snapshot.
     * @return The index of the newly created snapshot.
     */
    function _addNewSnapshot(uint32 cycleStart, uint32 cycleEnd, uint64 stakedWeight, uint128 dividendsToClaim
    ) internal returns(DividendsSnapshot storage, uint256)
    {
        DividendsSnapshot memory snapshot;
        snapshot.startCycle = cycleStart;
        snapshot.endCycle = cycleEnd;
        snapshot.stakedWeight = stakedWeight;
        snapshot.dividendsToClaim = dividendsToClaim;

        dividendsSnapshots.push(snapshot);

        uint256 snapshotIndex = dividendsSnapshots.length.sub(1);

        emit SnapshotCreated(
            snapshotIndex,
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stakedWeight,
            snapshot.dividendsToClaim);

        return (dividendsSnapshots[snapshotIndex], snapshotIndex);
    }

    /**
     * Retrieves the current cycle (index-1 based).
     * @return The current cycle (index-1 based).
     */
    function getCurrentCycle() public view returns(uint32) {
        // index is 1 based
        return _getCycle(now);
    }

    /**
     * Retrieves the cycle (index-1 based) at the specified timestamp.
     * @param ts The timestamp for which the cycle is derived from.
     * @return The cycle (index-1 based) at the specified timestamp.
     */
    function _getCycle(uint256 ts) internal view returns(uint32) {
        return ts.sub(startTimestamp).div(cycleLengthInSeconds).add(1).toUint32();
    }

    /**
     * Retrieves the current payout period (index-1 based).
     * @return The current payout period (index-1 based).
     */
     function getCurrentPayoutPeriod() external view returns(uint256) {
         return _getCurrentPeriod(periodLengthInCycles);
     }

     /**
      * Retrieves the current payout period (index-1 based).
      * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
      * @return The current payout period (index-1 based).
      */
     function _getCurrentPeriod(uint256 periodLengthInCycles_) internal view returns(uint256) {
         return _getPeriod(getCurrentCycle(), periodLengthInCycles_);
     }

    /**
     * Retrieves the payout period (index-1 based) for the specified cycle and payout period length.
     * @param cycle The cycle within the payout period to retrieve.
     * @param periodLengthInCycles_ Length of a dividend payout period, in cycles.
     * @return The payout period (index-1 based) for the specified cycle and payout period length.
     */
    function _getPeriod(uint32 cycle, uint256 periodLengthInCycles_) internal pure returns(uint256) {
        if (cycle == 0) {
            return 0;
        }
        // index is 1 based
        return SafeMath.sub(cycle, 1).div(periodLengthInCycles_).add(1);
    }

    /**
     * Retrieves the first unclaimed payout period (index-1 based) and number of unclaimed payout periods.
     * @return The first unclaimed payout period (index-1 based).
     * @return The number of unclaimed payout periods.
     */
    function getUnclaimedPayoutPeriods() external view returns(uint256, uint256) {
        StakerState memory stakerState = stakerStates[msg.sender];
        uint256 periodLengthInCycles_ = periodLengthInCycles;
        return (
            _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, periodLengthInCycles_),
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
        StakerState memory stakerState = stakerStates[sender];
        if (stakerState.stakedWeight == 0) {
            return 0;
        }

        uint256 periodToClaim = _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, periodLengthInCycles_);
        return _getCurrentPeriod(periodLengthInCycles_).sub(periodToClaim);
    }

    /**
     * Estimates the total claimable dividends, starting from the specified payout period over the specified number of payout periods to claim.
     * @param startPeriod The starting payout period to begin estimating the total claimable dividends.
     * @param periodsToClaim The number of payout periods to estimate the total claimable dividends for.
     */
    function estimatePayout(uint256 startPeriod, uint256 periodsToClaim) external view returns(uint128) {
        if (dividendsSnapshots.length == 0) {
            return 0;
        }

        ClaimDivsParams memory params;
        params.periodLengthInCycles = periodLengthInCycles;
        params.currentPeriod = _getCurrentPeriod(params.periodLengthInCycles);

        if (params.currentPeriod <= startPeriod) {
            return 0;
        }

        // handle overflow
        if (startPeriod.add(periodsToClaim) < periodsToClaim) {
            periodsToClaim = type(uint256).max.sub(startPeriod);
        }

        StakerState memory stakerState = stakerStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDividendsToClaim = 0;

        if (_getPeriod(stakerState.nextUnclaimedPeriodStartCycle, params.periodLengthInCycles) >= startPeriod) {
            // if requested payout period is earlier then deposit
            params.depositCycle = stakerState.nextUnclaimedPeriodStartCycle;
        } else {
            // or later then latest deposit
            params.depositCycle = startPeriod.sub(1).mul(params.periodLengthInCycles).add(1).toUint32();
        }

        params.periodToClaim = _getPeriod(params.depositCycle, params.periodLengthInCycles);

        uint256 updatedPeriod = params.periodToClaim.add(periodsToClaim);
        if (updatedPeriod <= params.currentPeriod) {
            params.currentPeriod = updatedPeriod;
        }

        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(params.depositCycle);

        params.startSnapshotIndex = snapshotIndex;
        params.lastSnapshotIndex = dividendsSnapshots.length.sub(1);
        params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();
        params.payoutPerCycle = payoutSchedule[params.periodToClaim];

        params.startCycle = snapshot.startCycle;
        params.endCycle = snapshot.endCycle;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPeriod(params.startCycle, params.periodLengthInCycles) < params.periodToClaim) {
            params.startCycle = params.periodToClaim.sub(1).mul(params.periodLengthInCycles).add(1).toUint32();
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.periodToClaim < params.currentPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.dividendsToClaim > 0) {
                // avoid division by zero
                uint128 dividendsToClaim = SafeMath.mul(stakerState.stakedWeight, _DIVS_PRECISION).div(snapshot.stakedWeight).mul(snapshot.dividendsToClaim).div(_DIVS_PRECISION).toUint128();
                require(snapshot.dividendsToClaim >= dividendsToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                totalDividendsToClaim = SafeMath.add(totalDividendsToClaim, dividendsToClaim).toUint128();
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.endCycle = params.currentPeriod.sub(1).mul(params.periodLengthInCycles).toUint32();
                params.endCycle = snapshot.endCycle;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.startCycle <= snapshot.endCycle) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPeriod(params.startCycle, params.periodLengthInCycles) != _getPeriod(params.endCycle, params.periodLengthInCycles)) {
                        params.endCycle = _getPeriod(params.startCycle, params.periodLengthInCycles).mul(params.periodLengthInCycles).toUint32();
                    }

                    uint256 temp = SafeMath.mul(stakerState.stakedWeight, _DIVS_PRECISION);
                    temp = temp.div(snapshot.stakedWeight);
                    temp = temp.mul(params.payoutPerCycle);
                    temp = temp.mul(SafeMath.sub(params.endCycle, params.startCycle).add(1));
                    temp = temp.div(_DIVS_PRECISION);
                    totalDividendsToClaim = temp.add(totalDividendsToClaim).toUint128();

                    // this snapshot is across several payout periods
                    if (params.endCycle != snapshot.endCycle) {
                        params.periodToClaim = _getPeriod(params.endCycle, params.periodLengthInCycles).add(1);
                        params.startCycle = params.periodToClaim.sub(1).mul(params.periodLengthInCycles).add(1).toUint32();
                        params.payoutPerCycle = payoutSchedule[params.periodToClaim];
                        params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();

                        loops = loops.add(1);
                        if (loops >= periodsToClaim) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }

            params.depositCycle = SafeMath.add(params.endCycle, 1).toUint32();

            if (params.nextPeriodCycle <= params.depositCycle) {
                params.periodToClaim = _getPeriod(params.depositCycle, params.periodLengthInCycles);
                params.payoutPerCycle = payoutSchedule[params.periodToClaim];
                params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();
                loops = loops.add(1);
            }

            if (loops >= periodsToClaim) {
                break;
            }

            // that was last snapshot
            if (snapshotIndex == params.lastSnapshotIndex) {
                break;
            }

            snapshotIndex = snapshotIndex.add(1);
            snapshot = dividendsSnapshots[snapshotIndex];

            params.startCycle = snapshot.startCycle;
            params.endCycle = snapshot.endCycle;
        }

        return totalDividendsToClaim;
    }

    /**
     * Claims the dividends for the specified number of payout periods.
     * @param periodsToClaim The maximum number of dividend payout periods to claim for.
     */
    function claimDividends(uint256 periodsToClaim) external isEnabled hasStarted {
        if (periodsToClaim == 0) {
            return;
        }

        if (dividendsSnapshots.length == 0) {
            return;
        }

        StakerState memory stakerState = stakerStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDividendsToClaim = 0;

        ClaimDivsParams memory params;
        params.periodLengthInCycles = periodLengthInCycles;
        params.currentPeriod = _getCurrentPeriod(params.periodLengthInCycles);

        // payout cycles starts from 1
        params.periodToClaim = _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, params.periodLengthInCycles);
        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(stakerState.nextUnclaimedPeriodStartCycle);

        params.startSnapshotIndex = snapshotIndex;
        params.lastSnapshotIndex = dividendsSnapshots.length.sub(1);
        params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();
        params.payoutPerCycle = payoutSchedule[params.periodToClaim];

        params.startCycle = snapshot.startCycle;
        params.endCycle = snapshot.endCycle;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPeriod(params.startCycle, params.periodLengthInCycles) < params.periodToClaim) {
            params.startCycle = params.periodToClaim.sub(1).mul(params.periodLengthInCycles).add(1).toUint32();
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.periodToClaim < params.currentPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.dividendsToClaim > 0) {
                // avoid division by zero
                uint128 dividendsToClaim = SafeMath.mul(stakerState.stakedWeight, _DIVS_PRECISION).div(snapshot.stakedWeight).mul(snapshot.dividendsToClaim).div(_DIVS_PRECISION).toUint128();
                require(snapshot.dividendsToClaim >= dividendsToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                snapshot.dividendsToClaim = SafeMath.sub(snapshot.dividendsToClaim, dividendsToClaim).toUint128();
                dividendsSnapshots[snapshotIndex] = snapshot;

                emit SnapshotUpdated(
                    snapshotIndex,
                    snapshot.startCycle,
                    snapshot.endCycle,
                    snapshot.stakedWeight,
                    snapshot.dividendsToClaim);

                totalDividendsToClaim = SafeMath.add(totalDividendsToClaim, dividendsToClaim).toUint128();
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.endCycle = params.currentPeriod.sub(1).mul(params.periodLengthInCycles).toUint32();
                params.endCycle = snapshot.endCycle;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.startCycle <= snapshot.endCycle) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPeriod(params.startCycle, params.periodLengthInCycles) != _getPeriod(params.endCycle, params.periodLengthInCycles)) {
                        params.endCycle = _getPeriod(params.startCycle, params.periodLengthInCycles).mul(params.periodLengthInCycles).toUint32();
                    }

                    uint256 temp = SafeMath.mul(stakerState.stakedWeight, _DIVS_PRECISION);
                    temp = temp.div(snapshot.stakedWeight);
                    temp = temp.mul(params.payoutPerCycle);
                    temp = temp.mul(SafeMath.sub(params.endCycle, params.startCycle).add(1));
                    temp = temp.div(_DIVS_PRECISION);
                    totalDividendsToClaim = temp.add(totalDividendsToClaim).toUint128();

                    // this snapshot is across several payout periods
                    if (params.endCycle != snapshot.endCycle) {
                        params.periodToClaim = _getPeriod(params.endCycle, params.periodLengthInCycles).add(1);
                        params.startCycle = params.periodToClaim.sub(1).mul(params.periodLengthInCycles).add(1).toUint32();
                        params.payoutPerCycle = payoutSchedule[params.periodToClaim];
                        params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();

                        loops = loops.add(1);
                        if (loops >= periodsToClaim) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }

            stakerState.nextUnclaimedPeriodStartCycle = SafeMath.add(params.endCycle, 1).toUint32();

            if (params.nextPeriodCycle <= stakerState.nextUnclaimedPeriodStartCycle) {
                params.periodToClaim = _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, params.periodLengthInCycles);
                params.payoutPerCycle = payoutSchedule[params.periodToClaim];
                params.nextPeriodCycle = params.periodToClaim.mul(params.periodLengthInCycles).add(1).toUint32();
                loops = loops.add(1);
            }

            if (loops >= periodsToClaim) {
                break;
            }

            // that was last snapshot
            if (snapshotIndex == params.lastSnapshotIndex) {
                break;
            }

            snapshotIndex = snapshotIndex.add(1);
            snapshot = dividendsSnapshots[snapshotIndex];

            params.startCycle = snapshot.startCycle;
            params.endCycle = snapshot.endCycle;
        }

        stakerStates[msg.sender] = stakerState;

        if (totalDividendsToClaim > 0) {
            // must never underflow
            require(IERC20(dividendToken).balanceOf(address(this)) >= totalDividendsToClaim, "NftStaking: Insufficient tokens in the rewards pool");
            require(IERC20(dividendToken).transfer(msg.sender, totalDividendsToClaim), "NftStaking: Unknown failure when attempting to transfer claimed dividend rewards");

            emit ClaimedDivs(msg.sender, params.startSnapshotIndex, uint256(snapshotIndex), totalDividendsToClaim);
        }
    }

    /**
     * Unstakes a deposited NFT from the contract.
     * @dev Reverts if the caller is not the original owner of the NFT.
     * @dev While the contract is enabled, reverts if there are outstanding dividends to be claimed.
     * @dev While the contract is enabled, reverts if NFT is being withdrawn before the staking freeze duration has elapsed.
     * @param tokenId The token identifier, referencing the NFT being withdrawn.
     */
    function withdrawNft(uint256 tokenId) external virtual divsClaimed(msg.sender) {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];
        require(tokenInfo.owner == msg.sender, "NftStaking: Token owner doesn't match or token was already withdrawn before");

        uint32 currentCycle = getCurrentCycle();
        uint256 periodLengthInCycles_ = periodLengthInCycles;

        // by-pass staked weight operations if the contract is disabled, to
        // avoid unnecessary calculations and reduce the gas requirements for
        // the caller
        if (!_disabled) {
            require(_getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_) == 0, "NftStaking: Dividends are not claimed");
            require(now.sub(tokenInfo.depositTimestamp) > freezeDurationAfterStake, "NftStaking: Staking freeze duration has not yet elapsed");

            // reset to indicate that token was withdrawn
            tokensInfo[tokenId].owner = address(0);

            // decrease stake weight based on NFT value
            // uint64 nftWeight = _getWeight(tokenId);

            // uint32 startCycle = Math.max(
            //     currentCycle - (currentCycle % periodLengthInCycles_) + 1, // First cycle of the current period
            //     tokenInfo.depositCycle                                   // Deposit cycle of the token
            // ).toUint32();

            // Decrease staking weight for every snapshot for the current payout period
            uint32 startCycle = _getPeriod(currentCycle, periodLengthInCycles_).sub(1).mul(periodLengthInCycles_).add(1).toUint32();

            // uint32 startCycle =
            //     ((_getPeriod(currentCycle, periodLengthInCycles_) - 1) // Previous payout period
            //      * periodLengthInCycles_ // Last cycle of the previous payout period
            //     + 1).toUint32();

            if (startCycle < tokenInfo.depositCycle) {
                startCycle = tokenInfo.depositCycle;
            }

            (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(startCycle);
            uint256 lastSnapshotIndex = dividendsSnapshots.length.sub(1);

            // Decrease staking weight for every snapshot for the current payout period
            while (startCycle <= currentCycle) {
                startCycle = SafeMath.add(snapshot.endCycle, 1).toUint32();

                // must never underflow
                require(snapshot.stakedWeight >= tokenInfo.weight, "NftStaking: Staked weight underflow");
                snapshot.stakedWeight = SafeMath.sub(snapshot.stakedWeight, tokenInfo.weight).toUint64();
                dividendsSnapshots[snapshotIndex] = snapshot;

                emit SnapshotUpdated(
                    snapshotIndex,
                    snapshot.startCycle,
                    snapshot.endCycle,
                    snapshot.stakedWeight,
                    snapshot.dividendsToClaim);

                // outside the range of current snapshot, query next
                if (startCycle > snapshot.endCycle) {
                    snapshotIndex = snapshotIndex.add(1);
                    if (snapshotIndex > lastSnapshotIndex) {
                        // reached the end of snapshots
                        break;
                    }
                    snapshot = dividendsSnapshots[snapshotIndex];
                }
            }

            StakerState memory stakerState = stakerStates[msg.sender];

            // decrease staker weight
            stakerState.stakedWeight = SafeMath.sub(stakerState.stakedWeight, tokenInfo.weight).toUint64();
            // if no more nfts left to stake - reset nextUnclaimedPeriodStartCycle
            if (stakerState.stakedWeight == 0) {
                stakerState.nextUnclaimedPeriodStartCycle = 0;
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

        emit Withdrawal(msg.sender, tokenId, currentCycle);
    }

    /**
     * Stakes the NFT received by the contract, referenced by its specified token identifier and owner.
     * @param tokenId Identifier of the staked NFT.
     * @param tokenOwner Owner of the staked NFT.
     */
    function _depositNft(
        uint256 tokenId,
        address tokenOwner
    ) internal isEnabled hasStarted {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");

        uint32 nftWeight = _validateAndGetWeight(tokenId);

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = now.toUint64();
        tokenInfo.owner = tokenOwner;

        // returned 'latest' snapshot will either be a new snapshot for the
        // current (or possibly next, due to the freeze duration) cycle, or an
        // existing one starting at the current (or possibly next, due to the
        // freeze duration) cycle
        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _getSnapshot(freezeDurationAfterStake);

        uint64 stakedWeight = SafeMath.add(snapshot.stakedWeight, nftWeight).toUint64();

        // increase current snapshot total staked weight
        dividendsSnapshots[snapshotIndex].stakedWeight = stakedWeight;

        emit SnapshotUpdated(
            snapshotIndex,
            snapshot.startCycle,
            snapshot.endCycle,
            stakedWeight,
            snapshot.dividendsToClaim);

        tokenInfo.weight = nftWeight;

        // because of the nature of the snapshot that was retrieved, the token
        // deposit cycle is guaranteed to be in alignment with the start of the
        // latest snapshot
        tokenInfo.depositCycle = snapshot.startCycle;

        tokensInfo[tokenId] = tokenInfo;

        // increase staker weight and set unclaimed start cycle to correct one from snapshot
        StakerState memory stakerState = stakerStates[tokenOwner];
        if (stakerState.stakedWeight == 0) {
            // nothing is currently staked by the staker so reset/initialize
            // the next unclaimed period start cycle to the token deposit cycle
            // for unclaimed payout period tracking
            stakerState.nextUnclaimedPeriodStartCycle = tokenInfo.depositCycle;
        }

        stakerState.stakedWeight = SafeMath.add(stakerState.stakedWeight, nftWeight).toUint64();
        stakerStates[tokenOwner] = stakerState;

        emit Deposit(tokenOwner, tokenId, getCurrentCycle());
    }

    /**
     * Searches for the dividend snapshot containing the specified cycle. If the snapshot cannot be found then the closest snapshot by cycle range is returned.
     * @param cycle The cycle for which the dividend snapshot is searched for.
     * @return snapshot If found, the snapshot containing the specified cycle, otherwise the closest snapshot to the cycle.
     * @return snapshotIndex The index (index-0 based) of the returned snapshot.
     */
    function _findDividendsSnapshot(uint32 cycle)
    internal
    view
    returns(DividendsSnapshot memory snapshot, uint256 snapshotIndex)
    {
        uint256 low = 0;
        uint256 high = dividendsSnapshots.length.sub(1);
        uint256 mid = 0;

        while (low <= high) {
            // overflow protected midpoint calculation
            mid = low.add(high.sub(low).div(2));

            snapshot = dividendsSnapshots[mid];

            if (snapshot.startCycle > cycle) {
                if (mid == 0) {
                    break;
                }

                // outside by left side of the range
                high = mid.sub(1);
            } else if (snapshot.endCycle < cycle) {
                if (mid == type(uint256).max) {
                    break;
                }

                // outside by right side of the range
                low = mid.add(1);
            } else {
                break;
            }
        }

        // return snapshot with cycle within range or closest possible to it
        return (snapshot, mid);
    }

    /**
     * Validates whether or not the supplied NFT identifier is accepted for staking
     * and retrieves its associated weight. MUST throw if the token is invalid.
     * @param nftId uint256 NFT identifier used to determine if the token is valid for staking.
     * @return uint32 the weight of the NFT.
     */
    function _validateAndGetWeight(uint256 nftId) internal virtual view returns (uint32);

    // /**
    //  * Retrieves the NFT's weight.
    //  * @param nftId uint256 NFT identifier used to determine if the token is valid for staking.
    //  * @return uint64 the weight of the NFT.
    //  */
    // function _getWeight(uint256 nftId) internal virtual view returns (uint64);

}
