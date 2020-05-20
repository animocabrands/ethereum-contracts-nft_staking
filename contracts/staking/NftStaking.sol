// SPDX-License-Identifier: MIT

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@animoca/ethereum-contracts-erc20_base/contracts/token/ERC20/IERC20.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC721/IERC721.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155.sol";
import "@animoca/ethereum-contracts-assets_inventory/contracts/token/ERC1155/IERC1155TokenReceiver.sol";

/**
    Error Codes

    1 - Dividends are not claimed
    2 - Fatal
    3 - Trying to stake non-allowed NFT
    4 - Trying to stake non-car NFT
    5 - Fatal - payoutPeriodLength_ can't be equal 0
    6 - Values and corresponding weights length do not match.
    7 - Not a pool reward provider
    8 - Fatal - not enough tokens in rewards pool
    9 - Fatal - dividends amount failed to transfer out of the dividends pool to the owner
    10 - Fatal - Staked weight underflow
    11 - Token owner doesn't match or token was already withdrawn before
    12 - Token is frozen
    13 - Staking operations are disabled
 */

abstract contract NftStaking is Ownable, Pausable, IERC1155TokenReceiver {
    using SafeMath for uint256;
    using SafeCast for uint256;

    uint constant DAY_DURATION = 86400;
    uint constant DIVS_PRECISION = 10 ** 10;
    uint constant MAX_UINT = ~uint256(0);

    // bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))
    bytes4 constant internal ERC1155_RECEIVED = 0xf23a6e61;

    // bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))
    bytes4 constant internal ERC1155_BATCH_RECEIVED = 0xbc197c81;

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
    event Deposit(address indexed from, uint tokenId, uint currentCycle);
    event Withdrawal(address indexed from, uint tokenId, uint currentCycle);
    event ClaimedDivs(address indexed from, uint snapshotStartIndex, uint snapshotEndIndex, uint amount);

    bool private _enabled;

    uint public startTimestamp;
    uint public payoutPeriodLength;
    uint public freezeDurationAfterStake;

    mapping(address => bool) public rewardPoolProviders;
    mapping(address => StakerState) public stakeStates;
    mapping(uint => uint) public valueStakeWeights;
    mapping(uint => TokenInfo) public tokensInfo;

    DividendsSnapshot[] public dividendsSnapshots;

    address public whitelistedNftContract;
    address public dividendToken;

    mapping(uint => uint128) private _initialTokenDistribution;

    constructor(
        uint payoutPeriodLength_,
        uint freezeDurationAfterStake_,
        address whitelistedNftContract_,
        address dividendToken_,
        uint[] memory values,
        uint[] memory valueWeights
    ) internal {
        require(payoutPeriodLength_ != 0, "5");
        require(values.length == valueWeights.length, "6");

        _enabled = true;

        payoutPeriodLength = payoutPeriodLength_;
        freezeDurationAfterStake = freezeDurationAfterStake_;
        startTimestamp = block.timestamp;
        whitelistedNftContract = whitelistedNftContract_;
        dividendToken = dividendToken_;

        for (uint i = 0; i < values.length; ++i) {
            valueStakeWeights[values[i]] = valueWeights[i];
        }
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

    function setContractEnabled(bool enabled) public onlyOwner {
        _enabled = enabled;
    }

    modifier divsClaimed(address sender) {
        require(_getUnclaimedPayoutPeriods(sender) == 0, "1");
        _;
    }

    modifier onlyRewardPoolProvider() {
        require(rewardPoolProviders[msg.sender], "7");
        _;
    }

    modifier isEnabled() {
        require(_enabled, "13");
        _;
    }

    // ERC1155TokenReceiver implementation

    function supportsInterface(bytes4 interfaceId) external pure returns(bool) {
        return (
            // ERC165 interface id
            interfaceId == 0x01ffc9a7 ||
            // ERC1155TokenReceiver interface id
            interfaceId == 0x4e2312e0
        );
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

    function setPoolProvider(address provider, bool authorize) external onlyOwner {
        rewardPoolProviders[provider] = authorize;
    }

    function rewardPoolBalanceIncreased(uint128 amount) external onlyRewardPoolProvider {
        // get latest reward pool snapshot and increased it
        DividendsSnapshot memory snapshot = _getOrCreateLatestCycleSnapshot(0);
        snapshot.tokensToClaim = SafeMath.add(snapshot.tokensToClaim, amount).toUint128();
        dividendsSnapshots[dividendsSnapshots.length - 1] = snapshot;
    }

    // Staking implementation
    function _getOrCreateLatestCycleSnapshot(uint offsetIntoFuture) internal returns(DividendsSnapshot memory snapshot) {
        uint32 currentCycle = uint32(_getCurrentCycle(block.timestamp + offsetIntoFuture));

        uint totalSnapshots = dividendsSnapshots.length;

        // if there are some snapshots - pick latest
        if (totalSnapshots != 0) {
            snapshot = dividendsSnapshots[totalSnapshots - 1];
        }

        uint payoutPeriodLength_ = payoutPeriodLength;
        uint currentPayoutPeriod = _getPayoutPeriod(getCurrentCycle(), payoutPeriodLength_);
        uint128 initialTokensToClaim = 0;

        // latest snapshot is not for current cycle - create new one, +20k gas
        if (snapshot.cycleRangeEnd != currentCycle || totalSnapshots == 0) {
            // if current old snapshot has missing cycle - override end range to include all missed cycles
            if (totalSnapshots != 0 && snapshot.cycleRangeEnd != currentCycle - 1) {
                snapshot.cycleRangeEnd = currentCycle - 1;

                // if snapshot is between 2 payout periods
                if (currentPayoutPeriod != _getPayoutPeriod(snapshot.cycleRangeStart, payoutPeriodLength_)) {
                    // Note that we don't have to create new snapshot in this case because prepopulated pool distributes based on staked duration
                    // tokensToClaim only populated from poolProviders and it triggers new snapshot creation and tokensToClaim is SHARED between several days
                    // unlike predefined initial distribution from the company
                    uint32 rangeEnd = snapshot.cycleRangeEnd;

                    // align current snapshot to the end of the previous payout period
                    snapshot.cycleRangeEnd = uint32((currentPayoutPeriod-1) * payoutPeriodLength_);

                    // if anything has changed - update it
                    if (snapshot.cycleRangeEnd != rangeEnd) {
                        dividendsSnapshots[totalSnapshots - 1] = snapshot;
                    }

                    // if somebody staked already and there are cycles skipped
                    if (snapshot.stakedWeight != 0 && snapshot.cycleRangeEnd + 1 != currentCycle) {
                        snapshot = _addNewSnapshot(snapshot.cycleRangeEnd + 1, currentCycle - 1, snapshot.stakedWeight, 0);
                    }
                } else {
                    dividendsSnapshots[totalSnapshots - 1] = snapshot;
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
        dividendsSnapshots.push(snapshot);

        return snapshot;
    }

    function getCurrentCycle() public view returns(uint) {
        // index is 1 based
        return _getCurrentCycle(block.timestamp);
    }

    function _getCurrentCycle(uint ts) internal view returns(uint) {
        return (ts - startTimestamp) / DAY_DURATION + 1;
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
        uint payoutPeriodLength;
        uint depositCycle;
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
                require(snapshot.tokensToClaim >= tokensToClaim, "2");

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
                require(snapshot.tokensToClaim >= tokensToClaim, "2");

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
            require(IERC20(dividendToken).balanceOf(address(this)) >= totalDivsToClaim, "8");
            require(IERC20(dividendToken).transfer(msg.sender, totalDivsToClaim));

            emit ClaimedDivs(msg.sender, params.startSnapshotIndex, uint(snapshotIndex), totalDivsToClaim);
        }
    }

    function withdrawNft(uint tokenId) external virtual isEnabled divsClaimed(msg.sender) {
        TokenInfo memory tokenInfo = tokensInfo[tokenId];
        require(tokenInfo.owner == msg.sender, "11");
        require(block.timestamp - tokenInfo.depositTimestamp > freezeDurationAfterStake, "12");

        // reset to indicate that token was withdrawn
        tokensInfo[tokenId].owner = address(0);

        // decrease stake weight based on NFT value
        uint64 nftWeight = uint64(valueStakeWeights[valueFromTokenId(tokenId)]);

        // Decrease staking weight for every snapshot for the current payout period
        uint currentCycle = getCurrentCycle();
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
            require(snapshot.stakedWeight >= nftWeight, "10");
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

        emit Withdrawal(msg.sender, tokenId, getCurrentCycle());
    }

    function _depositNft(uint tokenId, address tokenOwner) internal isEnabled whenNotPaused {
        require(whitelistedNftContract == msg.sender, "3");
        require(isCorrectTokenType(tokenId), "4");

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

        emit Deposit(msg.sender, tokenId, getCurrentCycle());
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
