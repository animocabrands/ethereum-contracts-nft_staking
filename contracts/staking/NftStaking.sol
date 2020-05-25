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

    uint constant DIVS_PRECISION = 10 ** 10;
    uint constant MAX_UINT = ~uint256(0);

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
        uint currentPayoutPeriod;
        uint payoutPeriodToClaim;
        uint startSnapshotIndex;
        int lastSnapshotIndex;
        uint nextPayoutPeriodCycle;
        uint dailyFixedTokens;
        uint rangeStart;
        uint rangeEnd;
        uint payoutPeriodLength;
        uint depositCycle;
    }

    // emitted when an initial token distribution is set
    event InitialDistribution(
        uint startPeriod, // starting payout period for the distribution
        uint endPeriod, // ending payout period for the distribution
        uint dailyTokens // amount of token rewards to distribute per cycle
    );

    // emitted when an NFT is staked
    event Deposit(
        address indexed from, // original owner of the NFT
        uint tokenId, // NFT identifier
        uint currentCycle // the cycle in which the token was deposited
    );

    // emitted when an NFT is unstaked
    event Withdrawal(
        address indexed from, // original owner of the NFT
        uint tokenId, // NFT identifier
        uint currentCycle // the cycle in which the token was withdrawn
    );

    // emitted when dividends are claimed
    event ClaimedDivs(
        address indexed from, // staker claiming the dividends
        uint snapshotStartIndex, // claim snapshot starting index
        uint snapshotEndIndex, // claim snapshot ending index
        uint amount // amount of dividends claimed
    );

    bool private _disabled; // flags whether or not the contract is disabled

    uint public startTimestamp; // staking started timestamp, in seconds since epoch
    uint256 public immutable cycleLength; // length of a cycle, in seconds
    uint public payoutPeriodLength; // length of a dividend payout period, in cycles
    uint public freezeDurationAfterStake; // initial duration that a newly staked NFT is locked before it can be with drawn from staking, in seconds
    uint128 public rewardPoolBase; // amount of reward pool tokens to set as the initial tokens to claim when a new snapshot is created

    mapping(address => bool) public rewardPoolProviders; // reward pool provider address => authorized flag
    mapping(address => StakerState) public stakeStates; // staker address => staker state
    mapping(uint => uint) public valueStakeWeights; // NFT classification (e.g. tier, rarity, category) => payout weight
    mapping(uint => TokenInfo) public tokensInfo; // NFT identifier => token info

    DividendsSnapshot[] public dividendsSnapshots; // snapshot history of staking and dividend changes

    address public whitelistedNftContract; // contract that has been whitelisted to be able to perform transfer operations of staked NFTs
    address public dividendToken; // ERC20-based token used in dividend payouts

    mapping(uint => uint128) private _initialTokenDistribution; // payout period => per-cycle tokens distribution

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender) == 0, "NftStaking: Dividends are not claimed");
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
        uint payoutPeriodLength_,
        uint freezeDurationAfterStake_,
        uint128 rewardPoolBase_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint[] memory values,
        uint[] memory valueWeights
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

        for (uint i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }

        _registerInterface(type(IERC1155TokenReceiver).interfaceId);
    }

    // receive() external payable {}

    function setDividendToken(address dividendToken_) public onlyOwner {
        dividendToken = dividendToken_;
    }

    function setFreezeDurationAfterStake(uint freezeDurationAfterStake_) public onlyOwner {
        freezeDurationAfterStake = freezeDurationAfterStake_;
    }

    function setInitialDistributionPeriod(uint periodStart, uint periodEnd, uint128 tokensDaily) public onlyOwner {
        for (uint i = periodStart; i <= periodEnd; ++i) {
            _initialTokenDistribution[i] = tokensDaily;
        }

        emit InitialDistribution(periodStart, periodEnd, tokensDaily);
    }

    function withdrawDivsPool(uint amount) public onlyOwner {
        require(IERC20(dividendToken).transfer(msg.sender, amount), "9");
    }

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
        for (uint i = 0; i < ids.length; ++i) {
            _depositNft(ids[i], from);
        }
        return _ERC1155_BATCH_RECEIVED;
    }

    // Staking pool reward implementation

    function setPoolProvider(address provider, bool authorize) external onlyOwner {
        rewardPoolProviders[provider] = authorize;
    }

    function rewardPoolBalanceIncreased(uint128 amount) external onlyRewardPoolProvider {
        // get latest reward pool snapshot and increased it
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(0);
        snapshot.tokensToClaim = SafeMath.add(snapshot.tokensToClaim, amount).toUint128();
        dividendsSnapshots[dividendsSnapshots.length - 1] = snapshot;

        // update the reward pool base amount to persist the change for new
        // snapshots created, moving forward
        rewardPoolBase = SafeMath.add(rewardPoolBase, amount).toUint128();
    }

    // Staking implementation
    function _getOrCreateLatestCycleSnapshot(uint offsetIntoFuture) internal returns(DividendsSnapshot memory) {
        uint32 currentCycle = uint32(_getCurrentCycle(block.timestamp + offsetIntoFuture));
        uint totalSnapshots = dividendsSnapshots.length;
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

        uint payoutPeriodLength_ = payoutPeriodLength;
        uint currentPayoutPeriod = _getPayoutPeriod(getCurrentCycle(), payoutPeriodLength_);

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

    function getCurrentCycle() public view returns(uint) {
        // index is 1 based
        return _getCurrentCycle(block.timestamp);
    }

    function _getCurrentCycle(uint ts) internal view returns(uint) {
        return (ts - startTimestamp) / cycleLength + 1;
    }

    function _getPayoutPeriod(uint cycle, uint payoutPeriodLength_) internal pure returns(uint) {
        if (cycle == 0) {
            return 0;
        }
        // index is 1 based
        return (cycle - 1) / payoutPeriodLength_ + 1;
    }

    function getUnclaimedPayoutPeriods() external view returns(uint, uint) {
        StakerState memory state = stakeStates[msg.sender];
        return (_getPayoutPeriod(state.depositCycle, payoutPeriodLength), _getUnclaimedPayoutPeriods(msg.sender));
    }

    function _getUnclaimedPayoutPeriods(address sender) internal view returns(uint) {
        StakerState memory state = stakeStates[sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        uint payoutPeriodLength_ = payoutPeriodLength;
        uint payoutPeriodToClaim = _getPayoutPeriod(state.depositCycle, payoutPeriodLength_);
        return _getPayoutPeriod(getCurrentCycle(), payoutPeriodLength_) - payoutPeriodToClaim;
    }

    // almost complete copypaste of claimDividends
    // estimate payout for [startPayoutPeriod, startPayoutPeriod + payoutPeriodsToClaim - 1] range
    function estimatePayout(uint startPayoutPeriod, uint payoutPeriodsToClaim) public view returns(uint128) {
        if (dividendsSnapshots.length == 0) {
            return 0;
        }

        ClaimDivsParams memory params;
        params.payoutPeriodLength = payoutPeriodLength;
        params.currentPayoutPeriod = _getPayoutPeriod(getCurrentCycle(), params.payoutPeriodLength);

        if (params.currentPayoutPeriod <= startPayoutPeriod) {
            return 0;
        }

        // handle overflow
        if (startPayoutPeriod + payoutPeriodsToClaim < payoutPeriodsToClaim) {
            payoutPeriodsToClaim = payoutPeriodsToClaim - startPayoutPeriod;
        }

        StakerState memory state = stakeStates[msg.sender];

        uint loops = 0;
        uint128 totalDivsToClaim = 0;

        if (_getPayoutPeriod(state.depositCycle, params.payoutPeriodLength) >= startPayoutPeriod) {
            // if requested payout period is earlier then deposit
            params.depositCycle = state.depositCycle;
        } else {
            // or later then latest deposit
            params.depositCycle = (startPayoutPeriod - 1) * params.payoutPeriodLength + 1;
        }

        params.payoutPeriodToClaim = _getPayoutPeriod(params.depositCycle, params.payoutPeriodLength);

        uint updatedPayoutPeriod = params.payoutPeriodToClaim + payoutPeriodsToClaim;
        if (updatedPayoutPeriod <= params.currentPayoutPeriod) {
            params.currentPayoutPeriod = updatedPayoutPeriod;
        }

        (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(params.depositCycle);

        params.startSnapshotIndex = uint(snapshotIndex);
        params.lastSnapshotIndex = int(dividendsSnapshots.length - 1);
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
            snapshot = dividendsSnapshots[uint(snapshotIndex)];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        return totalDivsToClaim;
    }

    // claim X payout periods. Will not claim more than X periods to control gas consumption
    function claimDividends(uint payoutPeriodsToClaim) external isEnabled {
        if (payoutPeriodsToClaim == 0) {
            return;
        }

        if (dividendsSnapshots.length == 0) {
            return;
        }

        StakerState memory state = stakeStates[msg.sender];

        uint loops = 0;
        uint128 totalDivsToClaim = 0;

        ClaimDivsParams memory params;
        params.payoutPeriodLength = payoutPeriodLength;
        params.currentPayoutPeriod = _getPayoutPeriod(getCurrentCycle(), params.payoutPeriodLength);

        // payout cycles starts from 1
        params.payoutPeriodToClaim = _getPayoutPeriod(state.depositCycle, params.payoutPeriodLength);
        (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(state.depositCycle);

        params.startSnapshotIndex = uint(snapshotIndex);
        params.lastSnapshotIndex = int(dividendsSnapshots.length - 1);
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
                dividendsSnapshots[uint(snapshotIndex)] = snapshot;
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
            snapshot = dividendsSnapshots[uint(snapshotIndex)];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        stakeStates[msg.sender] = state;

        if (totalDivsToClaim > 0) {
            // must never underflow
            require(IERC20(dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "NftStaking: Insufficient tokens in the rewards pool");
            require(IERC20(dividendToken).transfer(msg.sender, totalDivsToClaim));

            emit ClaimedDivs(msg.sender, params.startSnapshotIndex, uint(snapshotIndex), totalDivsToClaim);
        }
    }

    /**
     * Unstakes a deposited NFT from the contract.
     * @dev Reverts if the caller is not the original owner of the NFT.
     * @dev While the contract is enabled, reverts if there are outstanding dividends to be claimed.
     * @dev While the contract is enabled, reverts if NFT is being withdrawn before the staking freeze duration has elapsed.
     * @param tokenId The token identifier, referencing the NFT being withdrawn.
     */
    function withdrawNft(uint tokenId) external virtual {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];
        require(tokenInfo.owner == msg.sender, "NftStaking: Token owner doesn't match or token was already withdrawn before");

        uint currentCycle = getCurrentCycle();

        // by-pass staked weight operations if the contract is disabled, to
        // avoid unnecessary calculations and reduce the gas requirements for
        // the caller
        if (!_disabled) {
            require(_getUnclaimedPayoutPeriods(msg.sender) == 0, "NftStaking: Dividends are not claimed");
            require(block.timestamp - tokenInfo.depositTimestamp > freezeDurationAfterStake, "NftStaking: Staking freeze duration has not yet elapsed");

            // reset to indicate that token was withdrawn
            tokensInfo[tokenId].owner = address(0);

            // decrease stake weight based on NFT value
            uint64 nftWeight = uint64(valueStakeWeights[valueFromTokenId(tokenId)]);

            // Decrease staking weight for every snapshot for the current payout period
            uint payoutPeriodLength_ = payoutPeriodLength;
            uint startCycle = (_getPayoutPeriod(currentCycle, payoutPeriodLength_) - 1) * payoutPeriodLength_ + 1;
            if (startCycle < tokenInfo.depositCycle) {
                startCycle = tokenInfo.depositCycle;
            }

            // iterate over all snapshots and decrease weight
            (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(startCycle);
            int lastSnapshotIndex = int(dividendsSnapshots.length - 1);

            while (startCycle <= currentCycle) {
                // outside the range of current snapshot, query next
                if (startCycle > snapshot.cycleRangeEnd) {
                    snapshotIndex++;
                    if (snapshotIndex > lastSnapshotIndex) {
                        // reached the end of snapshots
                        break;
                    }
                    snapshot = dividendsSnapshots[uint(snapshotIndex)];
                }

                startCycle = snapshot.cycleRangeEnd + 1;

                // must never underflow
                require(snapshot.stakedWeight >= nftWeight, "NftStaking: Staked weight underflow");
                snapshot.stakedWeight -= nftWeight;
                dividendsSnapshots[uint(snapshotIndex)] = snapshot;
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

    function _depositNft(uint tokenId, address tokenOwner) internal isEnabled whenNotPaused {
        require(whitelistedNftContract == msg.sender, "NftStaking: Caller is not the whitelisted NFT contract");
        require(isCorrectTokenType(tokenId), "NftStaking: Attempting to deposit an invalid token type");

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = uint64(block.timestamp);
        tokenInfo.owner = tokenOwner;

        // add weight based on car value
        uint64 nftWeight = uint64(valueStakeWeights[valueFromTokenId(tokenId)]);

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

    function _findDividendsSnapshot(uint cycle)
    internal
    view
    returns(DividendsSnapshot memory snapshot, int snapshotIndex)
    {
        int low = 0;
        int high = int(dividendsSnapshots.length - 1);
        int mid = 0;

        while (low <= high) {
            mid = (high + low) / 2;
            snapshot = dividendsSnapshots[uint(mid)];

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

    function isCorrectTokenType(uint id) internal virtual pure returns(bool);

    function valueFromTokenId(uint tokenId) internal virtual pure returns(uint);

}
