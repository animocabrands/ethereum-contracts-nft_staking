// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

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

    uint256 constant DIVS_PRECISION = 10 ** 10;
    uint256 constant MAX_UINT = ~uint256(0);

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
        uint64 depositCycle; // beginning cycle from which a staker may claim dividend rewards for staked NFTs
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
        int256 lastSnapshotIndex;
        uint256 nextPayoutPeriodCycle;
        uint256 dailyFixedTokens;
        uint256 rangeStart;
        uint256 rangeEnd;
        uint256 payoutPeriodLength;
        uint256 depositCycle;
    }

    // emitted when an initial token distribution is set
    event InitialDistribution(
        uint256 startPeriod, // starting payout period for the distribution
        uint256 endPeriod, // ending payout period for the distribution
        uint256 dailyTokens // amount of token rewards to distribute per cycle
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

    bool private _disabled; // flags whether or not the contract is disabled

    uint256 public startTimestamp; // staking started timestamp, in seconds since epoch
    uint256 public immutable cycleLength; // length of a cycle, in seconds
    uint256 public payoutPeriodLength; // length of a dividend payout period, in cycles
    uint256 public freezeDurationAfterStake; // initial duration that a newly staked NFT is locked before it can be with drawn from staking, in seconds
    uint128 public rewardPoolBase; // amount of reward pool tokens to set as the initial tokens to claim when a new snapshot is created

    mapping(address => bool) public rewardPoolProviders; // reward pool provider address => authorized flag
    mapping(address => StakerState) public stakeStates; // staker address => staker state
    mapping(uint256 => uint256) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => payout weight
    mapping(uint256 => TokenInfo) public tokensInfo; // NFT identifier => token info

    DividendsSnapshot[] public dividendsSnapshots; // snapshot history of staking and dividend changes

    address public whitelistedNftContract; // contract that has been whitelisted to be able to perform transfer operations of staked NFTs
    address public dividendToken; // ERC20-based token used in dividend payouts

    mapping(uint256 => uint128) private _initialTokenDistribution; // payout period => per-cycle tokens distribution

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender, payoutPeriodLength) == 0, "NftStaking: Dividends are not claimed");
        _;
    }

    modifier onlyRewardPoolProvider() {
        require(rewardPoolProviders[msg.sender], "NftStaking: Not a pool reward provider");
        _;
    }

    modifier isEnabled() {
        require(!_disabled, "NftStaking: Staking operations are disabled");
        _;
    }

    /**
     * @dev Constructor.
     * @param cycleLength_ Length of a cycle, in seconds.
     * @param payoutPeriodLength_ Length of a dividend payout period, in cycles.
     * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
     * @param rewardPoolBase_ Amount of reward pool tokens to set as the initial tokens to claim when a new snapshot is created.
     * @param whitelistedNftContract_ Contract that has been whitelisted to be able to perform transfer operations of staked NFTs.
     * @param dividendToken_ The ERC20-based token used in dividend payouts.
     * @param values NFT token classifications (e.g. tier, rarity, category).
     * @param valueWeights Dividend reward allocation weight for each NFT token classification defined by the 'value' argument.
     */
    constructor(
        uint256 cycleLength_,
        uint256 payoutPeriodLength_,
        uint256 freezeDurationAfterStake_,
        uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint256[] memory values,
        uint256[] memory valueWeights
    ) internal {
        require(payoutPeriodLength_ != 0, "NftStaking: Zero payout period length");
        require(values.length == valueWeights.length, "NftStaking: Mismatch in value/weight array argument lengths");

        _disabled = false;

        cycleLength = cycleLength_;
        payoutPeriodLength = payoutPeriodLength_;
        freezeDurationAfterStake = freezeDurationAfterStake_;
        rewardPoolBase = rewardPoolBase_;
        startTimestamp = block.timestamp;
        whitelistedNftContract = whitelistedNftContract_;
        dividendToken = dividendToken_;

        for (uint256 i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }

        _registerInterface(type(IERC1155TokenReceiver).interfaceId);
    }

    /**
     * Sets the dividend token to use for dividend payouts.
     * @param dividendToken_ The address of an IERC20 compatible token to use for dividend payouts.
     */
    function setDividendToken(address dividendToken_) public onlyOwner {
        dividendToken = dividendToken_;
    }

    /**
     * Sets the period of time, in seconds, for which a newly staked token cannot be withdrawn. After the freeze duration has elapsed, the staked token can be unstaked.
     * @param freezeDurationAfterStake_ Initial duration that a newly staked NFT is locked for before it can be withdrawn from staking, in seconds.
     */
    function setFreezeDurationAfterStake(uint256 freezeDurationAfterStake_) public onlyOwner {
        freezeDurationAfterStake = freezeDurationAfterStake_;
    }

    /**
     * Sets the initial distribution period in which staked tokens are awarded additional per-cycle bonus dividends.
     * @param periodStart The starting period of the initial distribution.
     * @param periodEnd The ending period of the initial distribution.
     * @param tokensDaily The amount of per-cycle bonus dividends to award.
     */
    function setInitialDistributionPeriod(uint256 periodStart, uint256 periodEnd, uint128 tokensDaily) public onlyOwner {
        for (uint256 i = periodStart; i <= periodEnd; ++i) {
            _initialTokenDistribution[i] = tokensDaily;
        }

        emit InitialDistribution(periodStart, periodEnd, tokensDaily);
    }

    /**
     * Withdraws a specified amount of dividends from the contract reward pool.
     * @param amount The amount to withdraw.
     */
    function withdrawDivsPool(uint256 amount) public onlyOwner {
        require(IERC20(dividendToken).transfer(msg.sender, amount), "9");
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

    /**
     * Sets the authorization state of the specified pool provider.
     * @param provider The provider whose authorization state will be set.
     * @param authorize The authorization state to set with.
     */
    function setPoolProvider(address provider, bool authorize) external onlyOwner {
        rewardPoolProviders[provider] = authorize;
    }

    /**
     * Permanently increases the reward pool balance of the current and new snapshots.
     * @param amount The amount to increase the reward pool balance by.
     */
    function rewardPoolBalanceIncreased(uint128 amount) external onlyRewardPoolProvider {
        // get latest reward pool snapshot and increased it
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(0);
        snapshot.tokensToClaim = SafeMath.add(snapshot.tokensToClaim, amount).toUint128();
        dividendsSnapshots[dividendsSnapshots.length - 1] = snapshot;

        // update the reward pool base amount to persist the change for new
        // snapshots created, moving forward
        rewardPoolBase = SafeMath.add(rewardPoolBase, amount).toUint128();
    }

    /**
     * Retrieves, or creates (if one does not already exist), a dividends snapshot for the timestamp derived from the specified offset to the current time, in seconds.
     * @param offsetIntoFuture The offset from the current time to create the snapshot for, in seconds.
     * @return The dividends snapshot, or a newly created one, for the timestamp derived from the specified offset to the current time.
     */
    function _getOrCreateLatestCycleSnapshot(uint256 offsetIntoFuture) internal returns(DividendsSnapshot memory) {
        uint32 currentCycle = uint32(_getCycle(block.timestamp + offsetIntoFuture));
        uint256 totalSnapshots = dividendsSnapshots.length;
        uint128 initialTokensToClaim = rewardPoolBase;

        // empty snapshot history
        if (totalSnapshots == 0) {
            // create the very first snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, 0, initialTokensToClaim);
        }

        // get the latest snapshot
        DividendsSnapshot memory snapshot = dividendsSnapshots[totalSnapshots - 1];

        // latest snapshot ends on the current cycle
        if (snapshot.cycleRangeEnd == currentCycle) {
            // this is the very latest snapshot
            return snapshot;
        }

        uint256 payoutPeriodLength_ = payoutPeriodLength;
        uint256 currentPayoutPeriod = _getCurrentPayoutPeriod(payoutPeriodLength_);

        // latest snapshot is for the current payout period
        if (currentPayoutPeriod == _getPayoutPeriod(snapshot.cycleRangeStart, payoutPeriodLength_)) {
            // latest snapshot didn't end on the previous cycle
            if (snapshot.cycleRangeEnd != currentCycle - 1) {
                // simply extend the latest snapshot to capture the unaccounted
                // cycles from where the last snapshot ended, up-to the previous
                // cycle (inclusive)
                snapshot.cycleRangeEnd = currentCycle - 1;
                dividendsSnapshots[totalSnapshots - 1] = snapshot;
            }

            if (snapshot.stakedWeight == 0) {
                initialTokensToClaim = snapshot.tokensToClaim;
            }

            // create a new latest snapshot for the current cycle
            return _addNewSnapshot(currentCycle, currentCycle, snapshot.stakedWeight, initialTokensToClaim);
        }

        // latest snapshot is for an earlier payout period

        uint32 previousPayoutPeriodCycleEnd = uint32((currentPayoutPeriod - 1) * payoutPeriodLength_);

        // latest snapshot didn't end on the end of the previous payout period
        if (snapshot.cycleRangeEnd != previousPayoutPeriodCycleEnd) {
            // align current snapshot to the end of the previous payout period
            snapshot.cycleRangeEnd = previousPayoutPeriodCycleEnd;
            dividendsSnapshots[totalSnapshots - 1] = snapshot;
        }

        // there are tokens staked and cycles unaccounted for in the current
        // payout period
        if ((snapshot.stakedWeight != 0) && (snapshot.cycleRangeEnd != currentCycle - 1)) {
            // create a new snapshot to capture the unaccounted cycles in the
            // current payout period, up-to the previous cycle (inclusive)
            snapshot = _addNewSnapshot(snapshot.cycleRangeEnd + 1, currentCycle - 1, snapshot.stakedWeight, initialTokensToClaim);
        }

        if (snapshot.stakedWeight == 0) {
            initialTokensToClaim = snapshot.tokensToClaim;
        }

        // create a new latest snapshot for the current cycle
        return _addNewSnapshot(currentCycle, currentCycle, snapshot.stakedWeight, initialTokensToClaim);
    }

    /**
     * Adds a new dividends snapshot to the snapshot history list.
     * @param cycleStart Starting cycle for the new snapshot.
     * @param cycleEnd Ending cycle for the new snapshot.
     * @param stakedWeight Initial staked weight for the new snapshot.
     * @param tokensToClaim Initial tokens to claim balance for the new snapshot.
     * @return snapshot The newly created snapshot.
     */
    function _addNewSnapshot(uint32 cycleStart, uint32 cycleEnd, uint64 stakedWeight, uint128 tokensToClaim
    ) internal returns(DividendsSnapshot memory snapshot)
    {
        snapshot.cycleRangeStart = cycleStart;
        snapshot.cycleRangeEnd = cycleEnd;
        snapshot.stakedWeight = stakedWeight;
        snapshot.tokensToClaim = tokensToClaim;
        dividendsSnapshots.push(snapshot);

        return snapshot;
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
        return (ts - startTimestamp) / cycleLength + 1;
    }

    /**
     * Retrieves the current payout period (index-1 based).
     * @return The current payout period (index-1 based).
     */
     function getCurrentPayoutPeriod() external view returns(uint256) {
         return _getCurrentPayoutPeriod(payoutPeriodLength);
     }

     /**
      * Retrieves the current payout period (index-1 based).
      * @param payoutPeriodLength_ Length of a dividend payout period, in cycles.
      * @return The current payout period (index-1 based).
      */
     function _getCurrentPayoutPeriod(uint256 payoutPeriodLength_) internal view returns(uint256) {
         return _getPayoutPeriod(getCurrentCycle(), payoutPeriodLength_);
     }

    /**
     * Retrieves the payout period (index-1 based) for the specified cycle and payout period length.
     * @param cycle The cycle within the payout period to retrieve.
     * @param payoutPeriodLength_ Length of a dividend payout period, in cycles.
     * @return The payout period (index-1 based) for the specified cycle and payout period length.
     */
    function _getPayoutPeriod(uint256 cycle, uint256 payoutPeriodLength_) internal pure returns(uint256) {
        if (cycle == 0) {
            return 0;
        }
        // index is 1 based
        return (cycle - 1) / payoutPeriodLength_ + 1;
    }

    /**
     * Retrieves the first unclaimed payout period (index-1 based) and number of unclaimed payout periods.
     * @return The first unclaimed payout period (index-1 based).
     * @return The number of unclaimed payout periods.
     */
    function getUnclaimedPayoutPeriods() external view returns(uint256, uint256) {
        StakerState memory state = stakeStates[msg.sender];
        uint256 payoutPeriodLength_ = payoutPeriodLength;
        return (_getPayoutPeriod(state.depositCycle, payoutPeriodLength_), _getUnclaimedPayoutPeriods(msg.sender, payoutPeriodLength_));
    }

    /**
     * Retrieves the number of unclaimed payout periods for the specified staker.
     * @param sender The staker whose number of unclaimed payout periods will be retrieved.
     * @param payoutPeriodLength_ Length of a dividend payout period, in cycles.
     * @return The number of unclaimed payout periods for the specified staker.
     */
    function _getUnclaimedPayoutPeriods(address sender, uint256 payoutPeriodLength_) internal view returns(uint256) {
        StakerState memory state = stakeStates[sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        uint256 payoutPeriodToClaim = _getPayoutPeriod(state.depositCycle, payoutPeriodLength_);
        return _getCurrentPayoutPeriod(payoutPeriodLength_) - payoutPeriodToClaim;
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
        params.payoutPeriodLength = payoutPeriodLength;
        params.currentPayoutPeriod = _getCurrentPayoutPeriod(params.payoutPeriodLength);

        if (params.currentPayoutPeriod <= startPayoutPeriod) {
            return 0;
        }

        // handle overflow
        if (startPayoutPeriod + payoutPeriodsToClaim < payoutPeriodsToClaim) {
            payoutPeriodsToClaim = payoutPeriodsToClaim - startPayoutPeriod;
        }

        StakerState memory state = stakeStates[msg.sender];

        uint256 loops = 0;
        uint128 totalDivsToClaim = 0;

        if (_getPayoutPeriod(state.depositCycle, params.payoutPeriodLength) >= startPayoutPeriod) {
            // if requested payout period is earlier then deposit
            params.depositCycle = state.depositCycle;
        } else {
            // or later then latest deposit
            params.depositCycle = (startPayoutPeriod - 1) * params.payoutPeriodLength + 1;
        }

        params.payoutPeriodToClaim = _getPayoutPeriod(params.depositCycle, params.payoutPeriodLength);

        uint256 updatedPayoutPeriod = params.payoutPeriodToClaim + payoutPeriodsToClaim;
        if (updatedPayoutPeriod <= params.currentPayoutPeriod) {
            params.currentPayoutPeriod = updatedPayoutPeriod;
        }

        (DividendsSnapshot memory snapshot, int256 snapshotIndex) = _findDividendsSnapshot(params.depositCycle);

        params.startSnapshotIndex = uint256(snapshotIndex);
        params.lastSnapshotIndex = int256(dividendsSnapshots.length - 1);
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;
        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.payoutPeriodLength + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                totalDivsToClaim += tokensToClaim;
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params.payoutPeriodLength);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) != _getPayoutPeriod(params.rangeEnd, params.payoutPeriodLength)) {
                        params.rangeEnd = uint32(_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) * params.payoutPeriodLength);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * params.dailyFixedTokens * (params.rangeEnd - params.rangeStart + 1) / DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _getPayoutPeriod(params.rangeEnd, params.payoutPeriodLength) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.payoutPeriodLength + 1);
                        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;

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
                params.payoutPeriodToClaim = _getPayoutPeriod(params.depositCycle, params.payoutPeriodLength);
                params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;
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
            snapshot = dividendsSnapshots[uint256(snapshotIndex)];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        return totalDivsToClaim;
    }

    /**
     * Claims the dividends for the specified number of payout periods.
     * @param payoutPeriodsToClaim The maximum number of dividend payout periods to claim for.
     */
    function claimDividends(uint256 payoutPeriodsToClaim) external isEnabled {
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
        params.payoutPeriodLength = payoutPeriodLength;
        params.currentPayoutPeriod = _getCurrentPayoutPeriod(params.payoutPeriodLength);

        // payout cycles starts from 1
        params.payoutPeriodToClaim = _getPayoutPeriod(state.depositCycle, params.payoutPeriodLength);
        (DividendsSnapshot memory snapshot, int256 snapshotIndex) = _findDividendsSnapshot(state.depositCycle);

        params.startSnapshotIndex = uint256(snapshotIndex);
        params.lastSnapshotIndex = int256(dividendsSnapshots.length - 1);
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;
        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.payoutPeriodLength + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "NftStaking: Tokens to claim exceeds the snapshot balance");

                snapshot.tokensToClaim -= tokensToClaim;
                dividendsSnapshots[uint256(snapshotIndex)] = snapshot;
                totalDivsToClaim += tokensToClaim;
            }

            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params.payoutPeriodLength);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) != _getPayoutPeriod(params.rangeEnd, params.payoutPeriodLength)) {
                        params.rangeEnd = uint32(_getPayoutPeriod(params.rangeStart, params.payoutPeriodLength) * params.payoutPeriodLength);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * params.dailyFixedTokens * (params.rangeEnd - params.rangeStart + 1) / DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _getPayoutPeriod(params.rangeEnd, params.payoutPeriodLength) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params.payoutPeriodLength + 1);
                        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;

                        loops++;
                        if (loops >= payoutPeriodsToClaim) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }

            state.depositCycle = uint64(params.rangeEnd + 1);

            if (uint64(params.nextPayoutPeriodCycle) <= state.depositCycle) {
                params.payoutPeriodToClaim = _getPayoutPeriod(state.depositCycle, params.payoutPeriodLength);
                params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params.payoutPeriodLength + 1;
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
            snapshot = dividendsSnapshots[uint256(snapshotIndex)];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        stakeStates[msg.sender] = state;

        if (totalDivsToClaim > 0) {
            // must never underflow
            require(IERC20(dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "NftStaking: Insufficient tokens in the rewards pool");
            require(IERC20(dividendToken).transfer(msg.sender, totalDivsToClaim));

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
        uint256 payoutPeriodLength_ = payoutPeriodLength;

        // by-pass staked weight operations if the contract is disabled, to
        // avoid unnecessary calculations and reduce the gas requirements for
        // the caller
        if (!_disabled) {
            require(_getUnclaimedPayoutPeriods(msg.sender, payoutPeriodLength_) == 0, "NftStaking: Dividends are not claimed");
            require(block.timestamp - tokenInfo.depositTimestamp > freezeDurationAfterStake, "NftStaking: Staking freeze duration has not yet elapsed");

            // reset to indicate that token was withdrawn
            tokensInfo[tokenId].owner = address(0);

            // decrease stake weight based on NFT value
            uint64 nftWeight = uint64(valueStakeWeights[_valueFromTokenId(tokenId)]);

            // Decrease staking weight for every snapshot for the current payout period
            uint256 startCycle = (_getPayoutPeriod(currentCycle, payoutPeriodLength_) - 1) * payoutPeriodLength_ + 1;
            if (startCycle < tokenInfo.depositCycle) {
                startCycle = tokenInfo.depositCycle;
            }

            // iterate over all snapshots and decrease weight
            (DividendsSnapshot memory snapshot, int256 snapshotIndex) = _findDividendsSnapshot(startCycle);
            int256 lastSnapshotIndex = int256(dividendsSnapshots.length - 1);

            while (startCycle <= currentCycle) {
                // outside the range of current snapshot, query next
                if (startCycle > snapshot.cycleRangeEnd) {
                    snapshotIndex++;
                    if (snapshotIndex > lastSnapshotIndex) {
                        // reached the end of snapshots
                        break;
                    }
                    snapshot = dividendsSnapshots[uint256(snapshotIndex)];
                }

                startCycle = snapshot.cycleRangeEnd + 1;

                // must never underflow
                require(snapshot.stakedWeight >= nftWeight, "NftStaking: Staked weight underflow");
                snapshot.stakedWeight -= nftWeight;
                dividendsSnapshots[uint256(snapshotIndex)] = snapshot;
            }

            StakerState memory state = stakeStates[msg.sender];

            // decrease staker weight
            state.stakedWeight -= nftWeight;
            // if no more nfts left to stake - reset depositCycle
            if (state.stakedWeight == 0) {
                state.depositCycle = 0;
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
    function _depositNft(uint256 tokenId, address tokenOwner) internal isEnabled whenNotPaused {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");
        require(_isCorrectTokenType(tokenId), "NftStaking: Attempting to deposit an invalid token type");

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = uint64(block.timestamp);
        tokenInfo.owner = tokenOwner;

        // add weight based on car value
        uint64 nftWeight = uint64(valueStakeWeights[_valueFromTokenId(tokenId)]);

        // increase current snapshot total staked weight
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(freezeDurationAfterStake);
        snapshot.stakedWeight += nftWeight;

        tokenInfo.depositCycle = snapshot.cycleRangeStart;

        tokensInfo[tokenId] = tokenInfo;

        // increase staker weight and set deposit cycle to correct one from snapshot
        StakerState memory state = stakeStates[tokenOwner];
        if (state.stakedWeight == 0) {
            state.depositCycle = snapshot.cycleRangeStart;
        }

        state.stakedWeight += nftWeight;
        stakeStates[tokenOwner] = state;

        dividendsSnapshots[dividendsSnapshots.length - 1] = snapshot;

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
    returns(DividendsSnapshot memory snapshot, int256 snapshotIndex)
    {
        int256 low = 0;
        int256 high = int256(dividendsSnapshots.length - 1);
        int256 mid = 0;

        while (low <= high) {
            mid = (high + low) / 2;
            snapshot = dividendsSnapshots[uint256(mid)];

            if (snapshot.cycleRangeStart > cycle) {
                // outside by left side of the range
                high = mid - 1;
            } else if (snapshot.cycleRangeEnd < cycle) {
                // outside by right side of the range
                low = mid + 1;
            } else {
                break;
            }
        }

        // return snapshot with cycle withing range or closest possible to it
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
