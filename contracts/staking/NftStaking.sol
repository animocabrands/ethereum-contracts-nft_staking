pragma solidity ^0.6.6;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155TokenReceiver.sol";

/**
    Error Codes

    1 - Dividends are not claimed
    2 - Fatal
    3 - Trying to stake non-allowed NFT
    4 - Trying to stake non-car NFT
    5 - Fatal - payoutPeriodLength can't be equal 0
    6 - Rarities and corresponding weights length do not match.
    7 - Not a pool reward provider
    8 - Fatal - not enough tokens in rewards pool
    10 - Fatal - Staked weight underflow
    11 - Token owner doesn't match or token was already withdrawn before
    12 - Token is frozen
 */

abstract contract NftStaking is Ownable, Pausable, IERC1155TokenReceiver {
    uint constant DAY_DURATION = 86400;
    uint constant DIVS_PRECISION = 10 ** 10;
    uint constant MAX_UINT = 2 ^ 256 - 1;

    struct DividendsSnapshot {
        uint32 cycleRangeStart;
        uint32 cycleRangeEnd;
        uint64 stakedWeight;
        uint128 tokensToClaim;
    }

    struct StakerState {
        uint64 depositCycle;
        uint64 stakedWeight;
    }

    struct TokenInfo {
        address owner;
        uint64 depositTimestamp;
        uint64 depositCycle;
    }

    event InitialDistribution(uint startPeriod, uint endPeriod, uint dailyTokens);
    event Deposit(address indexed from, uint tokenId);
    event Withdraw(address indexed from, uint tokenId);
    event ClaimedDivs(address indexed from, uint snapshotStartIndex, uint snapshotEndIndex, uint amount);

    bool _enabled;

    uint public _startTimestamp;
    uint public _payoutPeriodLength;
    uint public _freezeDurationAfterStake;

    mapping(address => bool) public _rewardPoolProviders;
    mapping(address => StakerState) public _stakeStates;
    mapping(uint => uint) public _valueStakeWeights;
    mapping(uint => TokenInfo) public _tokensInfo;

    DividendsSnapshot[] public _dividendsSnapshots;

    address public _whitelistedNftContract;
    address public _dividendToken;
    mapping(uint => uint128) _initialTokenDistribution;

    constructor(
        uint payoutPeriodLength,
        uint freezeDurationAfterStake,
        address whitelistedNftContract,
        address dividendToken,
        uint[] memory values,
        uint[] memory valueWeights
    ) internal {
        require(payoutPeriodLength > 0, "5");
        require(values.length == valueWeights.length, "6");

        _enabled = true;

        _payoutPeriodLength = payoutPeriodLength;
        _freezeDurationAfterStake = freezeDurationAfterStake;
        _startTimestamp = block.timestamp;
        _whitelistedNftContract = whitelistedNftContract;
        _dividendToken = dividendToken;

        for (uint i = 0; i < values.length; ++i) {
            _valueStakeWeights[values[i]] = valueWeights[i];
        }
    }

    // receive() external payable {}

    function set_dividendToken(address dividendToken) public onlyOwner {
        _dividendToken = dividendToken;
    }

    function set_freezeDurationAfterStake(uint freezeDurationAfterStake) public onlyOwner {
        _freezeDurationAfterStake = freezeDurationAfterStake;
    }

    function setInitialDistributionPeriod(uint periodStart, uint periodEnd, uint128 tokensDaily) public onlyOwner {
        for (uint i = periodStart; i <= periodEnd; ++i) {
            _initialTokenDistribution[i] = tokensDaily;
        }

        emit InitialDistribution(periodStart, periodEnd, tokensDaily);
    }

    function withdrawDivsPool(uint amount) public onlyOwner {
        require(IERC20(_dividendToken).transfer(msg.sender, amount));
    }

    function setContractEnabled(bool enabled) public onlyOwner {
        _enabled = enabled;
    }

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender) == 0, "1");
        _;
    }

    modifier onlyRewardPoolProvider() {
        require(_rewardPoolProviders[msg.sender], "7");
        _;
    }

    modifier isEnabled() {
        require(_enabled);
        _;
    }

    // ERC1155TokenReceiver implementation

    function supportsInterface(bytes4 interfaceId) external pure returns(bool) {
        return interfaceId == 0x4e2312e0;
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
        return ERC1155_RECEIVED;
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
        return ERC1155_BATCH_RECEIVED;
    }

    // Staking pool reward implementation

    function addPoolProvider(address _provider) external onlyOwner {
        _rewardPoolProviders[_provider] = true;
    }

    function removePoolProvider(address _provider) external onlyOwner {
        _rewardPoolProviders[_provider] = false;
    }

    function rewardPoolBalanceIncreased(uint128 amount) external onlyRewardPoolProvider {
        // get latest reward pool snapshot and increased it
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(0);
        snapshot.tokensToClaim += amount;
        _dividendsSnapshots[_dividendsSnapshots.length - 1] = snapshot;
    }

    // Staking implementation
    function _getOrCreateLatestCycleSnapshot(uint offsetIntoFuture) internal returns(DividendsSnapshot memory snapshot) {
        uint32 currentCycle = uint32(_getCurrentCycle(block.timestamp + offsetIntoFuture));

        // if there are some snapshots - pick latest
        if (_dividendsSnapshots.length != 0) {
            snapshot = _dividendsSnapshots[_dividendsSnapshots.length - 1];
        }

        uint currentPayoutPeriod = getCurrentPayoutPeriod();
        uint128 initialTokensToClaim = 0;
        uint totalSnapshots = _dividendsSnapshots.length;

        // latest snapshot is not for current cycle - create new one, +20k gas
        if (snapshot.cycleRangeEnd != currentCycle || totalSnapshots == 0) {
            // if current old snapshot has missing cycle - override end range to include all missed cycles
            if (totalSnapshots > 0 && snapshot.cycleRangeEnd != currentCycle - 1) {
                snapshot.cycleRangeEnd = currentCycle - 1;
                
                // if snapshot is between 2 payout periods
                if (currentPayoutPeriod != _payoutPeriodFromCycle(snapshot.cycleRangeStart)) {
                    // Note that we don't have to create new snapshot in this case because prepopulated pool distributes based on staked duration
                    // tokensToClaim only populated from poolProviders and it triggers new snapshot creation and tokensToClaim is SHARED between several days
                    // unlike predefined initial distribution from the company
                    uint32 rangeEnd = snapshot.cycleRangeEnd;
                                        
                    // align current snapshot to the end of the previous payout period
                    snapshot.cycleRangeEnd = uint32((currentPayoutPeriod-1) * _payoutPeriodLength);

                    // if anything has changed - update it
                    if (snapshot.cycleRangeEnd != rangeEnd) {
                        _dividendsSnapshots[_dividendsSnapshots.length - 1] = snapshot;
                    }

                    // if somebody staked already and there are cycles skipped
                    if (snapshot.stakedWeight != 0 && snapshot.cycleRangeEnd + 1 != currentCycle) {
                        snapshot = _addNewSnapshot(snapshot.cycleRangeEnd + 1, currentCycle - 1, snapshot.stakedWeight, 0);
                    }
                } else {
                    _dividendsSnapshots[_dividendsSnapshots.length - 1] = snapshot;
                }
            }

            // if old snapshot has no staked weight - move it to the new snapshot
            if (snapshot.stakedWeight == 0) {
                initialTokensToClaim = snapshot.tokensToClaim;
            }

            // create new snapshot, with staked weight from previous snapshot
            snapshot = _addNewSnapshot(currentCycle, currentCycle, snapshot.stakedWeight, initialTokensToClaim);
        }

        return snapshot;
    }

    function _addNewSnapshot(uint32 cycleStart, uint32 cycleEnd, uint64 stakedWeight, uint128 tokensToClaim
    ) internal returns(DividendsSnapshot memory snapshot)
    {
        snapshot.cycleRangeStart = cycleStart;
        snapshot.cycleRangeEnd = cycleEnd;
        snapshot.stakedWeight = stakedWeight;
        snapshot.tokensToClaim = tokensToClaim;
        _dividendsSnapshots.push(snapshot);

        return snapshot;
    }

    function getCurrentCycle() public view returns(uint) {
        // index is 1 based
        return _getCurrentCycle(block.timestamp);
    }

    function _getCurrentCycle(uint ts) internal view returns(uint) {
        return (ts - _startTimestamp) / DAY_DURATION + 1;
    }

    function getCurrentPayoutPeriod() public view returns(uint) {
        return (getCurrentCycle() - 1) / _payoutPeriodLength + 1;
    }

    function getUnclaimedPayoutPeriods() external view returns(uint, uint) {
        StakerState memory state = _stakeStates[msg.sender];
        return (_payoutPeriodFromCycle(state.depositCycle), _getUnclaimedPayoutPeriods(msg.sender));
    }

    function _payoutPeriodFromCycle(uint depositCycle) internal view returns(uint) {
        return _payoutPeriodFromCycleAndPeriodLength(depositCycle, _payoutPeriodLength);
    }

    function _payoutPeriodFromCycleAndPeriodLength(uint depositCycle, uint payoutPeriodLength) internal pure returns(uint) {
        if (depositCycle == 0) {
            return 0;
        }
        // index is 1 based
        return (depositCycle - 1) / payoutPeriodLength + 1;
    }

    function _getUnclaimedPayoutPeriods(address sender) internal view returns(uint) {
        StakerState memory state = _stakeStates[sender];
        if (state.stakedWeight == 0) {
            return 0;
        }

        uint payoutPeriodToClaim = _payoutPeriodFromCycle(state.depositCycle);
        return getCurrentPayoutPeriod() - payoutPeriodToClaim;
    }

    // to bypass stack limit
    struct ClaimDivsParams {
        uint currentPayoutPeriod;
        uint payoutPeriodToClaim;
        uint startSnapshotIndex;
        int lastSnapshotIndex;
        uint nextPayoutPeriodCycle;
        uint dailyFixedTokens;
        uint rangeStart;
        uint rangeEnd;
        uint _payoutPeriodLength;
        uint depositCycle;
    }

    // almost complete copypaste of claimDividends
    // estimate payout for [startPayoutPeriod, startPayoutPeriod + payoutPeriodsToClaim - 1] range
    function estimatePayout(uint startPayoutPeriod, uint payoutPeriodsToClaim) public view returns(uint128) {
        if (_dividendsSnapshots.length == 0) {
            return 0;
        }

        ClaimDivsParams memory params;
        params._payoutPeriodLength = _payoutPeriodLength;
        params.currentPayoutPeriod = getCurrentPayoutPeriod();

        if (params.currentPayoutPeriod <= startPayoutPeriod) {
            return 0;
        }

        // handle overflow
        if (startPayoutPeriod + payoutPeriodsToClaim < payoutPeriodsToClaim) {
            payoutPeriodsToClaim = payoutPeriodsToClaim - startPayoutPeriod;
        }

        StakerState memory state = _stakeStates[msg.sender];

        uint loops = 0;
        uint128 totalDivsToClaim = 0;

        if (_payoutPeriodFromCycleAndPeriodLength(state.depositCycle, params._payoutPeriodLength) >= startPayoutPeriod) {
            // if requested payout period is earlier then deposit
            params.depositCycle = state.depositCycle;
        } else {
            // or later then latest deposit
            params.depositCycle = (startPayoutPeriod - 1) * params._payoutPeriodLength + 1;
        }

        params.payoutPeriodToClaim = _payoutPeriodFromCycle(params.depositCycle);

        params.currentPayoutPeriod = params.payoutPeriodToClaim + payoutPeriodsToClaim;
        if (params.currentPayoutPeriod > getCurrentPayoutPeriod()) {
            params.currentPayoutPeriod = getCurrentPayoutPeriod();
        }

        (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(params.depositCycle);

        params.startSnapshotIndex = uint(snapshotIndex);
        params.lastSnapshotIndex = int(_dividendsSnapshots.length - 1);
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params._payoutPeriodLength + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "2");

                totalDivsToClaim += tokensToClaim;
            }
            
            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params._payoutPeriodLength);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) != _payoutPeriodFromCycleAndPeriodLength(params.rangeEnd, params._payoutPeriodLength)) {
                        params.rangeEnd = uint32(_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) * params._payoutPeriodLength);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * params.dailyFixedTokens * (params.rangeEnd - params.rangeStart + 1) / DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _payoutPeriodFromCycleAndPeriodLength(params.rangeEnd, params._payoutPeriodLength) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params._payoutPeriodLength + 1);
                        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
                        
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
                params.payoutPeriodToClaim = _payoutPeriodFromCycle(params.depositCycle);
                params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
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
            snapshot = _dividendsSnapshots[uint(snapshotIndex)];

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

        if (_dividendsSnapshots.length == 0) {
            return;
        }

        StakerState memory state = _stakeStates[msg.sender];

        uint loops = 0;
        uint128 totalDivsToClaim = 0;

        ClaimDivsParams memory params;
        params._payoutPeriodLength = _payoutPeriodLength;
        params.currentPayoutPeriod = getCurrentPayoutPeriod();

        // payout cycles starts from 1
        params.payoutPeriodToClaim = _payoutPeriodFromCycle(state.depositCycle);
        (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(state.depositCycle);

        params.startSnapshotIndex = uint(snapshotIndex);
        params.lastSnapshotIndex = int(_dividendsSnapshots.length - 1);
        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];

        params.rangeStart = snapshot.cycleRangeStart;
        params.rangeEnd = snapshot.cycleRangeEnd;

        // if cycle start payout period is earlier than requested - align to the beginning of requested period
        // happens when claiming has been stopped inside inner while loop when iterating inside snapshot longer than 1 payout period
        if (_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) < params.payoutPeriodToClaim) {
            params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params._payoutPeriodLength + 1);
        }

        // iterate over snapshots one by one until current payout period is met
        while (params.payoutPeriodToClaim < params.currentPayoutPeriod) {
            if (snapshot.stakedWeight > 0 && snapshot.tokensToClaim > 0) {
                // avoid division by zero
                uint128 tokensToClaim = uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * snapshot.tokensToClaim / DIVS_PRECISION);
                require(snapshot.tokensToClaim >= tokensToClaim, "2");

                snapshot.tokensToClaim -= tokensToClaim;
                _dividendsSnapshots[uint(snapshotIndex)] = snapshot;
                totalDivsToClaim += tokensToClaim;
            }
            
            if (snapshotIndex == params.lastSnapshotIndex) {
                // last snapshot, align range end to the end of the previous payout period
                snapshot.cycleRangeEnd = uint32((params.currentPayoutPeriod - 1) * params._payoutPeriodLength);
                params.rangeEnd = snapshot.cycleRangeEnd;
            }

            if (snapshot.stakedWeight > 0)  {
                // we need inner cycle to handle continous range between several payout periods
                while (params.rangeStart <= snapshot.cycleRangeEnd) {
                    // if start and end are not from same snapshot (occurs when more than 1 payout period was inactive)
                    if (_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) != _payoutPeriodFromCycleAndPeriodLength(params.rangeEnd, params._payoutPeriodLength)) {
                        params.rangeEnd = uint32(_payoutPeriodFromCycleAndPeriodLength(params.rangeStart, params._payoutPeriodLength) * params._payoutPeriodLength);
                    }

                    totalDivsToClaim += uint128((state.stakedWeight * DIVS_PRECISION / snapshot.stakedWeight) * params.dailyFixedTokens * (params.rangeEnd - params.rangeStart + 1) / DIVS_PRECISION);

                    // this snapshot is across several payout periods
                    if (params.rangeEnd != snapshot.cycleRangeEnd) {
                        params.payoutPeriodToClaim = _payoutPeriodFromCycleAndPeriodLength(params.rangeEnd, params._payoutPeriodLength) + 1;
                        params.rangeStart = uint32((params.payoutPeriodToClaim - 1) * params._payoutPeriodLength + 1);
                        params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                        params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
                        
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
                params.payoutPeriodToClaim = _payoutPeriodFromCycle(state.depositCycle);
                params.dailyFixedTokens = _initialTokenDistribution[params.payoutPeriodToClaim];
                params.nextPayoutPeriodCycle = params.payoutPeriodToClaim * params._payoutPeriodLength + 1;
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
            snapshot = _dividendsSnapshots[uint(snapshotIndex)];

            params.rangeStart = snapshot.cycleRangeStart;
            params.rangeEnd = snapshot.cycleRangeEnd;
        }

        _stakeStates[msg.sender] = state;

        if (totalDivsToClaim > 0) {
            // must never underflow
            require(IERC20(_dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "8");
            require(IERC20(_dividendToken).transfer(msg.sender, totalDivsToClaim));

            emit ClaimedDivs(msg.sender, params.startSnapshotIndex, uint(snapshotIndex), totalDivsToClaim);
        }
    }

    function withdrawNft(uint tokenId) external virtual isEnabled divsClaimed(msg.sender) {
        TokenInfo memory tokenInfo = _tokensInfo[tokenId];
        require(tokenInfo.owner == msg.sender, "11");
        require(block.timestamp - tokenInfo.depositTimestamp > _freezeDurationAfterStake, "12");

        // reset to indicate that token was withdrawn
        tokenInfo.owner = address(0);
        _tokensInfo[tokenId] = tokenInfo;

        // decrease stake weight based on NFT value
        uint64 nftWeight = uint64(_valueStakeWeights[valueFromTokenId(tokenId)]);

        // Decrease staking weight for every snapshot for the current payout period
        uint currentCycle = getCurrentCycle();
        uint startCycle = (getCurrentPayoutPeriod() - 1) * _payoutPeriodLength + 1;
        if (startCycle < tokenInfo.depositCycle) {
            startCycle = tokenInfo.depositCycle;
        }

        // iterate over all snapshots and decrease weight
        (DividendsSnapshot memory snapshot, int snapshotIndex) = _findDividendsSnapshot(startCycle);
        int lastSnapshotIndex = int(_dividendsSnapshots.length - 1);

        while (startCycle <= currentCycle) {
            // outside the range of current snapshot, query next
            if (startCycle > snapshot.cycleRangeEnd) {
                snapshotIndex++;
                if (snapshotIndex > lastSnapshotIndex) {
                    // reached the end of snapshots
                    break;
                }
                snapshot = _dividendsSnapshots[uint(snapshotIndex)];
            }

            startCycle = snapshot.cycleRangeEnd + 1;

            // must never underflow
            require(snapshot.stakedWeight >= nftWeight, "10");
            snapshot.stakedWeight -= nftWeight;
            _dividendsSnapshots[uint(snapshotIndex)] = snapshot;
        }

        StakerState memory state = _stakeStates[msg.sender];

        // decrease staker weight
        state.stakedWeight -= nftWeight;
        // if no more nfts left to stake - reset depositCycle
        if (state.stakedWeight == 0) {
            state.depositCycle = 0;
        }

        _stakeStates[msg.sender] = state;

        IERC1155(_whitelistedNftContract).safeTransferFrom(address(this), msg.sender, tokenId, 1, "");

        emit Withdraw(msg.sender, tokenId);
    }

    function _depositNft(uint tokenId, address tokenOwner) internal isEnabled whenNotPaused {
        require(_whitelistedNftContract == msg.sender, "3");
        require(isCorrectTokenType(tokenId), "4");

        TokenInfo memory tokenInfo;
        tokenInfo.depositTimestamp = uint64(block.timestamp);
        tokenInfo.owner = tokenOwner;

        // add weight based on car value
        uint64 nftWeight = uint64(_valueStakeWeights[valueFromTokenId(tokenId)]);

        // increase current snapshot total staked weight
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(_freezeDurationAfterStake);
        snapshot.stakedWeight += nftWeight;

        tokenInfo.depositCycle = snapshot.cycleRangeStart;

        _tokensInfo[tokenId] = tokenInfo;

        // increase staker weight and set deposit cycle to correct one from snapshot
        StakerState memory state = _stakeStates[tokenOwner];
        if (state.stakedWeight == 0) {
            state.depositCycle = snapshot.cycleRangeStart;
        }

        state.stakedWeight += nftWeight;
        _stakeStates[tokenOwner] = state;

        _dividendsSnapshots[_dividendsSnapshots.length - 1] = snapshot;

        emit Deposit(msg.sender, tokenId);
    }

    function _findDividendsSnapshot(uint cycle)
    internal
    view
    returns(DividendsSnapshot memory snapshot, int snapshotIndex)
    {
        int low = 0;
        int high = int(_dividendsSnapshots.length - 1);
        int mid = 0;

        while (low <= high) {
            mid = (high + low) / 2;
            snapshot = _dividendsSnapshots[uint(mid)];

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
