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

Your contract's constructor will need to provide the following arguments to the `NftStaking` parent contract constructor:

- `cycleLengthInSeconds_` - Length of a cycle, in seconds.
- `periodLengthInCycles_` - Length of a period, in cycles.
- `freezeDurationInCycles_` - Initial number of cycles during which a newly staked NFT is locked before it can be unstaked.
- `whitelistedNftContract_` - ERC1155-based contract to be whitelisted for performing transfer operations of NFTs for staking/unstaking.
- `rewardsToken_` - ERC20-based token used as staking rewards.

Finally, override the `_validateAndGetWeight()` abstract function, which is used to evaluate the allowable types of NFTs which can be staked and return their staked weight.

Please see the mock contracts used for the tests in `contracts/mocks/staking/` for examples.


## Concepts


### Staking

_Staking_ is the mechanism by-which an NFT is transferred to the `NftStaking` staking contract, to be held for a period of time, in exchange for a claimable ERC20-based token payout (rewards). While staked, the staking contract maintains ownership of the NFT on behalf of the original owner until such time as that owner decides to withdraw, or _unstake_, the NFT from the staking contract. The unstaked NFT is then transferred back to the original owner.

Upon the initial stake of an NFT to the staking contract, the NFT will be "frozen" for a fixed duration (as specified by the `freezeDurationInCycles_` constructor argument) before being allowed to be unstaked from the staking contract. The minimum freeze duration is defined as two (2) cycles.

Before any staker can stake or unstake their NFTs from the staking contract, all outstanding claimable rewards must first be claimed.


### Periods and Cycles

Discrete units of time in staking are expressed in terms of either _periods_ or _cycles_. A cycle is defined as some number of seconds (as specified by the `cycleLengthInSeconds_` constructor argument), and a period is defined as some number of cycles (as specified by the `periodLengthInCycles_` constructor argument). While cycles are used to calculate a staker's entitlement to claimable rewards, based on a fixed reward pool allotment schedule, periods are used for claiming rewards based on a payout schedule.


### Claiming

As mentioned in the [Staking](#staking) section above, claiming outstanding claimable rewards is a requirement prior to staking and unstaking any additional NFTs from the staking contract. While entitled rewards for staking accumulate every cycle, those rewards can only be claimed according to a payout schedule; that schedule is defined as one (1) period. This means that at least one period must elapse before the accumulated rewards for staking an NFT in any given period can be claimed. Or in other words, a staker can claim rewards once per payout period.

The only period that cannot be claimed for by a staker is the current period, as it has not completed its full elapsed duration to be claimable.


### Snapshots

Snapshots are a historical record of changes in total staked weight over time. For every cycle in which an NFT is staked or unstaked, a new snapshot is created. This provides a means for calculating a staker's entitled proportion of rewards for every cycle of a period that they are claiming.

Snapshots have the following properties:

- Span at least one cycle, and at most one period.
- The span of one snapshot will never overlap with another.
- Are arranged consecutively in sequence without skipping over cycles (i.e. there will never be a cycle in between two snapshots).
- Snapshots do not span multiple periods (i.e. a snapshot will not start in one period and end in a different period).


## Testing

Unit and behaviour tests have been written for the staking contract and can be found in `test/contracts/staking/`. They can be run by executing the following command:

```bash
$ npm run test
```
