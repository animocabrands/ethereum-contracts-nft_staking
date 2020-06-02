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
import "./INftStaking.sol";

abstract contract NftStaking is INftStaking, ERC1155TokenReceiver, Ownable {

    using SafeMath for uint256;
    using SafeCast for uint256;

    uint256 internal constant _DIVS_PRECISION = 10 ** 10;

    // a struct container used to track aggregate changes in staked tokens and
    // dividends, over time
    struct DividendsSnapshot {
        uint256 period;
        // uint255 durationInCycles;
        uint32 startCycle; // starting cycle of the snapshot
        uint32 endCycle; // ending cycle of the snapshot
        uint64 stakedWeight; // current total weight of all NFTs staked
        uint128 dividendsToClaim; // current total dividends available for payout across the snapshot duration
    }

    // a struct container used to track a staker's aggregate staking info
    struct StakerState {
        // TODO change to last claim token index
        uint32 nextUnclaimedPeriodStartCycle; // beginning cycle from which a staker may claim dividend rewards for staked NFTs
        uint64 stakedWeight; // current total weight of NFTs staked by the staker
    }

    struct TokenInfo {
        address owner;
        uint32 depositCycle;
        uint64 depositTimestamp; // seconds since epoch
        uint32 weight;
    }

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

        emit PayoutSet(startPeriod, endPeriod, payoutPerCycle);
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
     * @dev if the latest snapshot is related to a past period, creates a 
     * snapshot for each missing past period (if any) and one for the
     * current period (if needed). Updates the latest snapshot to end on
     * current cycle if not already.
     * @param maxSnapshotsToAdd the limit of snapshots to create. No limit
     * will be applied if it equals zero.
     */
    function _updateSnapshots(uint256 maxSnapshotsToAdd) internal {
        uint256 periodLengthInCycles_ = periodLengthInCycles;
        uint32 currentCycle = uint32(_getCycle(now));
        uint256 currentPeriod = _getPeriod(currentCycle, periodLengthInCycles_);
        uint256 initialTotalSnapshots = dividendsSnapshots.length;
        uint256 totalSnapshots = initialTotalSnapshots;
        uint256 snapshotIndex = totalSnapshots - 1;

        if (dividendsSnapshots.length == 0) {
            // create the very first snapshot, starting at the current cycle
            _addNewSnapshot(currentPeriod, currentCycle, currentCycle, 0);
            return;
        }

        // get the latest snapshot
        DividendsSnapshot storage writeSnapshot = dividendsSnapshots[snapshotIndex];
        DividendsSnapshot memory readSnapshot = writeSnapshot;

        if (readSnapshot.period == currentPeriod) {
            readSnapshot.endCycle = currentCycle;
            // readSnapshot.duration = currentCycle % periodLengthInCycles_;
            dividendsSnapshots[snapshotIndex] = readSnapshot;
            writeSnapshot = dividendsSnapshots[snapshotIndex];
            emit SnapshotUpdated(
                    snapshotIndex,
                    readSnapshot.startCycle,
                    readSnapshot.endCycle,
                    readSnapshot.stakedWeight);
        } else {
            while (readSnapshot.period < currentPeriod) {
                // Update the latest snapshot
                readSnapshot.endCycle = SafeMath.mul(readSnapshot.period, periodLengthInCycles_).toUint32();
                // readSnapshot.duration = periodLengthInCycles_;
                dividendsSnapshots[snapshotIndex] = readSnapshot;
                writeSnapshot = dividendsSnapshots[snapshotIndex];
                emit SnapshotUpdated(
                    snapshotIndex,
                    readSnapshot.startCycle,
                    readSnapshot.endCycle,
                    readSnapshot.stakedWeight);

                // create a new snapshot
                (writeSnapshot, snapshotIndex) = _addNewSnapshot(
                    readSnapshot.period + 1, // period
                    // (readSnapshot.period == currentPeriod - 1) ? // duration
                    //     currentCycle % periodLengthInCycles_ : // exact count if we are creating the current snapshot
                    //     readperiodLengthInCycles_, // full period duration otherwise
                    readSnapshot.endCycle + 1,
                    readSnapshot.endCycle + periodLengthInCycles_.toUint32(),
                    readSnapshot.stakedWeight);

                ++totalSnapshots;
                if (maxSnapshotsToAdd != 0 && (totalSnapshots - initialTotalSnapshots) >= maxSnapshotsToAdd) {
                    break;
                }
                readSnapshot = writeSnapshot;
            }
        }
    }

    /**
     * Adds a new dividends snapshot to the snapshot history list.
     * @param cycleStart Starting cycle for the new snapshot.
     * @param cycleEnd Ending cycle for the new snapshot.
     * @param stakedWeight Initial staked weight for the new snapshot.
     * @return The newly created snapshot.
     * @return The index of the newly created snapshot.
     */
    function _addNewSnapshot(
        uint256 period,
        // uint256 durationInCycles,
        uint32 cycleStart,
        uint32 cycleEnd,
        uint64 stakedWeight
    ) internal returns(DividendsSnapshot storage, uint256)
    {
        DividendsSnapshot memory snapshot;
        snapshot.period = period;
        snapshot.startCycle = cycleStart;
        snapshot.endCycle = cycleEnd;
        snapshot.stakedWeight = stakedWeight;

        dividendsSnapshots.push(snapshot);

        uint256 snapshotIndex = dividendsSnapshots.length - 1;

        emit SnapshotUpdated(
            snapshotIndex,
            snapshot.startCycle,
            snapshot.endCycle,
            snapshot.stakedWeight);

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


    struct ClaimDivsParams {
        uint256 periodLengthInCycles;
        uint256 currentPeriod;
        uint256 periodToClaim;
        uint256 startSnapshotIndex;
        uint256 lastSnapshotIndex;
        uint256 payoutPerCycle;
        uint256 snapshotPayout;
        uint32 depositCycle;
        uint32 startCycle;
        uint32 endCycle;
        uint32 nextPeriodCycle;
    }

    /**
     * Claims the dividends for the specified number of periods.
     * @param periodsToClaim The maximum number of dividend payout periods to claim for.
     */
    function claimDividends(uint256 periodsToClaim) external isEnabled hasStarted {

        _updateSnapshots(0);

        if (periodsToClaim == 0 || dividendsSnapshots.length == 0) {
            return;
        }

        StakerState memory stakerState = stakerStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDividendsToClaim = 0;

        ClaimDivsParams memory _;
        _.periodLengthInCycles = periodLengthInCycles;
        _.currentPeriod = _getCurrentPeriod(_.periodLengthInCycles);

        // payout cycles starts from 1
        _.periodToClaim = _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, _.periodLengthInCycles);
        (DividendsSnapshot memory snapshot, uint256 snapshotIndex) = _findDividendsSnapshot(stakerState.nextUnclaimedPeriodStartCycle);

        _.startSnapshotIndex = snapshotIndex;
        _.lastSnapshotIndex = dividendsSnapshots.length.sub(1);
        _.nextPeriodCycle = _.periodToClaim.mul(_.periodLengthInCycles).add(1).toUint32();
        _.payoutPerCycle = payoutSchedule[_.periodToClaim];

        _.startCycle = snapshot.startCycle;
        _.endCycle = snapshot.endCycle;

        // iterate over snapshots one by one until reaching current period
        while (_.periodToClaim < _.currentPeriod) {
            _.snapshotPayout = SafeMath.mul(payoutSchedule[_.periodToClaim], snapshot.endCycle - snapshot.startCycle + 1);
            if (snapshot.stakedWeight > 0 && _.snapshotPayout > 0) {

                totalDividendsToClaim = SafeMath.add(
                    totalDividendsToClaim,
                    SafeMath.mul(stakerState.stakedWeight, _DIVS_PRECISION)
                            .div(snapshot.stakedWeight)
                            .mul(_.snapshotPayout).div(_DIVS_PRECISION)
                ).toUint128();
            }

            if (snapshotIndex == _.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.endCycle = _.currentPeriod.sub(1).mul(_.periodLengthInCycles).toUint32();
                _.endCycle = snapshot.endCycle;
            }

            stakerState.nextUnclaimedPeriodStartCycle = _.endCycle + 1;

            if (_.nextPeriodCycle <= stakerState.nextUnclaimedPeriodStartCycle) {
                _.periodToClaim = _getPeriod(stakerState.nextUnclaimedPeriodStartCycle, _.periodLengthInCycles);
                _.payoutPerCycle = payoutSchedule[_.periodToClaim];
                _.nextPeriodCycle = _.periodToClaim.mul(_.periodLengthInCycles).add(1).toUint32();
                ++loops;
            }

            if (loops >= periodsToClaim || snapshotIndex == _.lastSnapshotIndex) {
                break;
            }

            ++snapshotIndex;
            snapshot = dividendsSnapshots[snapshotIndex];

            _.startCycle = snapshot.startCycle;
            _.endCycle = snapshot.endCycle;
        }

        stakerStates[msg.sender] = stakerState;

        if (totalDividendsToClaim > 0) {
            require(
                IERC20(dividendToken).transfer(msg.sender, totalDividendsToClaim),
                "NftStaking: Unknown failure when attempting to transfer claimed dividend rewards"
            );

            emit DividendsClaimed(
                msg.sender,
                _.startSnapshotIndex,
                uint256(snapshotIndex),
                totalDividendsToClaim);
        }
    }

    function _updateSnapshotWeight(
        DividendsSnapshot memory snapshot,
        uint256 snapshotIndex,
        uint64 weight,
        uint32 currentCycle
    ) internal returns (DividendsSnapshot memory snapshot_, uint256 snapshotIndex_)
    {
        if (snapshot.startCycle == currentCycle) {
            // If the snapshot starts at the current cycle, update its staked weight
            snapshot_ = snapshot;
            snapshot_.stakedWeight = weight;
            snapshotIndex_ = snapshotIndex;
            dividendsSnapshots[snapshotIndex] = snapshot_;

            emit SnapshotUpdated(
                snapshotIndex_,
                snapshot_.startCycle,
                snapshot_.endCycle,
                weight);

        } else {
            // Make the current snapshot end at previous cycle
            --dividendsSnapshots[snapshotIndex].endCycle;
            
            // Add a new snapshot starting at the current cycle with updated weight
            (snapshot_, snapshotIndex_) = _addNewSnapshot(snapshot.period, currentCycle, currentCycle, weight);
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

        uint32 currentCycle = getCurrentCycle();

        // by-pass staked weight operations if the contract is disabled, to
        // avoid unnecessary calculations and reduce the gas requirements for
        // the caller
        if (!_disabled) {
            uint256 periodLengthInCycles_ = periodLengthInCycles;
            require(_getUnclaimedPayoutPeriods(msg.sender, periodLengthInCycles_) == 0, "NftStaking: Dividends are not claimed");
            require(now > tokenInfo.depositTimestamp + freezeDurationAfterStake, "NftStaking: Token is still frozen");

            _updateSnapshots(0);

            tokensInfo[tokenId].owner = address(0);

            uint256 snapshotIndex = dividendsSnapshots.length - 1;
            DividendsSnapshot memory snapshot = dividendsSnapshots[snapshotIndex];

            // Decrease snapshot's weight
            (snapshot, snapshotIndex) = _updateSnapshotWeight(
                snapshot,
                snapshotIndex,
                snapshot.stakedWeight - tokenInfo.weight,
                currentCycle
            );

            // Decrease stakerState weight
            StakerState memory stakerState = stakerStates[msg.sender];
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

        emit NftUnstaked(msg.sender, tokenId, currentCycle);
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

        _updateSnapshots(0);

        uint32 currentCycle = getCurrentCycle();
        uint256 snapshotIndex = dividendsSnapshots.length - 1;
        DividendsSnapshot memory snapshot = dividendsSnapshots[snapshotIndex];

        // Increase snapshot's weight
        (snapshot, snapshotIndex) = _updateSnapshotWeight(
            snapshot,
            snapshotIndex,
            snapshot.stakedWeight + nftWeight,
            currentCycle
        );

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = now.toUint64();
        tokenInfo.owner = tokenOwner;
        tokenInfo.weight = nftWeight;

        tokenInfo.depositCycle = currentCycle;
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

        emit NftStaked(tokenOwner, tokenId, getCurrentCycle());
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

}
