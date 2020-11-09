# Changelog

## 4.0.0

### New features
 * `NftStakingV2.sol`: 
   - added `batchUnstakeNfts()` function
   - internal hook functions `_onStake` and`_onUnstake`.
   - added `withdrawLostCycleRewards` for an admin to withdraw the rewards for a past cycle where there was no stake.
   - new events `NftsBatchStaked` and `NftsBatchUnstaked` emitted during batch operations instead of the single versions.
   - Batch functions throw on an empty tokens list.
   - Optimised implementation of batch staking.
   - GSN compatibility.

### Improvements
 * Dependencies updated to `@animoca/ethereum-contracts-core_library@3.1.1` and `@animoca/ethereum-contracts-assets_inventory@4.0.0`.

## 3.0.4

### Improvements
 * Optimised the assignment of `tokenInfos` in `_stakeNFT`.

## 3.0.3

### Improvements
 * Calibrated the re-stake exploit fix to only apply during the same cycle after unstaking.
 * Improved the comments.

## 3.0.2

### Bugfixes
 * Fixed an exploit that allowed the re-staking of a token during the same cycle.

## 3.0.1

### Improvements
 * Gas optimisations, minor comments improvements.
 * Linting configuration.
 * Migrated to `yarn`.

## 3.0.0

### New features
 * Added `addRewardsForPeriods()` function, which initializes or adds reward amounts for the specified period range. This will perform a transfer operation to fund the contract with the added rewards amount when called.
 * Added contract interface `IWhitelistedNftContract` to define the API for the whitelisted contract used for NFT transfer operations when unstaking.

### Breaking changes
 * Removed `setRewardsForPeriods()` function.
 * Funding the contract rewards no longer occurs when calling the `start()` function. Instead, this happens whenever `addRewardsForPeriods()` is called.
 * Removed `disabled` state variable, for representing the contract enabled state, and replaced with `enabled`.
 * Renamed `RewardsScheduled` event to `RewardsAdded`.
 * Renamed `totalPrizePool` state variable to `totalRewardsPool`.

## 2.0.1

### New features
 * The module now exports a `constants` and a `utils` object.
 * Added a function to calculate a total rewards based on a rewards schedule.

### Bugfixes
 * Fixed a wrong import in the migration and restructured the script

## 2.0.0

### Breaking changes
 * Updated `@animoca/ethereum-contracts-core_library` to version 3 and downgraded it to be a dev dependency.
 * Updated `@animoca/ethereum-contracts-erc20_base` to version 3 and downgraded it to be a dev dependency.
 * Updated `@animoca/ethereum-contracts-assets_inventory` to version 3 and downgraded it to be a dev dependency.
 * Migrated compiler to `solc:0.6.8`.
 * Design change to record staker histories with modification to public interfaces.
 * Removed testable version of the contract.

### Improvements
 * Removed dependency on `@animoca/f1dt-core_metadata`.

## 1.0.2

### Improvements
 * Updated dependency on `@animoca/ethereum-contracts-assets_inventory` to `2.0.1`.
 * Change variables names in multiple files to be more generic.

## 1.0.1

### Improvements
 * Added 1_NftStaking.js migration script.

## 1.0.0

### Breaking changes
 * Migration to `@animoca/ethereum-contracts-core_library:1.0.0` with `solc:0.6.x` and `@openzeppelin/contracts:3.x`.

### New features
 * Added `NftStakingMock.sol` and `NftStakingTestableMock.sol`.

### Improvements
 * Better abstraction of core staking features.

## 0.0.1
 * Initial commit.
