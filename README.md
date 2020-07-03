# Solidity Project Non-Fungible Token Staking

This project serves as a base dependency for Solidity-based Non-Fungible Token (NFT) staking contract projects by providing related base contracts.


## Table of Contents

- [Overview](#overview)
  * [Installation](#installation)
  * [Usage](#usage)
    - [Solidity Contracts](#solidity-contracts)
- [Concepts](#concepts)
  * [Staking](#staking)
  * [Periods and Cycles](#periods-and-cycles)
  * [Claiming](#claiming)
  * [Snapshots](#snapshots)
- [Testing](#testing)


## Overview


### Installation

Install as a module dependency in your host NodeJS project:

```bash
$ npm install --save @animoca/ethereum-contracts-nft_staking
```


### Usage

#### Solidity Contracts

Add the following import statement to your Solidity contract and derive your contract from `NftStaking`:

```solidity
import "@animoca/ethereum-contracts-nft_staking/contracts/staking/NftStaking.sol";
```

The implementer contract's constructor needs to provide the following arguments to the `NftStaking` parent contract constructor:

- `cycleLengthInSeconds_` - Length of a cycle, in seconds (must be >= 1 minute).
- `periodLengthInCycles_` - Length of a period, in cycles (must be >= 2 cycles).
- `whitelistedNftContract_` - The 1155-compliant contract to whitelist for performing NFT staking operations.
- `rewardsTokenContract_` - ERC20-based token used as staking rewards.

Finally, override the `_validateAndGetNftWeight()` abstract function, which is used to evaluate the allowable types of NFTs which can be staked and return their staked weight.

Please see the mock contracts used for the tests in `contracts/mocks/staking/` for examples.


## Concepts


### Staking

_Staking_ is the mechanism by-which an ERC1155-NFT is transferred to the `NftStaking` staking contract, to be held for a period of time, in exchange for a claimable ERC20-based token payout (rewards). While staked, the staking contract maintains ownership of the NFT and unlocks claimable rewards over time. When the owner decides to withdraw, or _unstake_, the NFT from the staking contract, it will be transferred back to him, but will stop generating rewards.

Upon the initial stake of an NFT to the staking contract, the NFT will be "frozen" for a fixed duration (at most 2 cycles) before being allowed to be unstaked from the staking contract. Except this restriction, NFTs can be staked and/or unstaked at any time.


### Cycles, Periods and Rewards Schedule

Discrete units of time in staking are expressed in terms of _periods_ and _cycles_. A cycle is defined as a duration in time, measured in seconds. Periods are a larger duration expressed in number of cycles. When the contract starts, the first cycle of the first perdiod begins. The length of cycles and periods are set at contract's deployment through `cycleLengthInSeconds_` and `periodLengthInCycles_` constructor arguments.

Rewards are based on fixed reward pool allotment schedules, specified by periods and expressed in rewards per cycle. Each cycle for which a reward has been scheduled represents a pool claimable by stakers. A staker's entitlement is based on its proportional stake weight during this cycle. Rewards can be added by the contract's administrator for a given schedule. Schedules are cumulative: if some rewards have already been alloted to a period, a future schedule can still allot additional rewards for the same period. Schedules can be added before or after contract the contract starts, but not for a past period.


### Claiming

Rewards can be claimed at any moment by the stakers if they already accumulated some gain. Claims are computed by periods, summing up the gains over the schedule, starting from the last unclaimed up until the previous period relative to now. This means that at least one period must elapse before the accumulated rewards for staking an NFT, in any given period, can be claimed. Or in other words, a staker can claim rewards once per payout period.


### Snapshots

Snapshots are historical records of changes in total staked weight, over time. For every cycle in which an NFT is staked or unstaked, a new snapshot is created. This provides a means for calculating a staker's entitled proportion of rewards for every cycle of a period that they are claiming. There is a global snapshot history that tracks aggregate stake changes for all stakers, as well as a snapshot history for each staker to track their own stake changes.

Snapshots have the following properties:

- Spans at least one cycle.
- Can span multiple cycles over multiple periods.
- The span of one snapshot will never overlap with another (for any given staker).
- Are arranged consecutively in sequence without skipping over cycles (i.e. there will never be a cycle in between two snapshots).
- Are removed from a staker's snapshot history as soon as a reward claim is made for the periods that cover the span of the snapshot.

### Contract disablement

The administrator can disable the contract. By this action, staking is stopped and all remaining rewards become unclaimable by the stakers. The administrator can withrdaw the remaining rewards pool. Stakers can still unstake their NFTs. This feature is a "red button" to be used only in case of critical failure of the contract as it bypasses parts of the unstaking logic, potentially helping stakers to keep withdrawing if the contract is locked otherwise.

## Testing

Unit and behaviour tests have been written for the staking contract and can be found in `test/contracts/staking/`. They can be run by executing the following command:

```bash
$ npm run test
```
or for full state debug logs
```bash
$ DEBUG=true npm run test
```
