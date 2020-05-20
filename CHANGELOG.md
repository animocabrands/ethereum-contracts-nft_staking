# Changelog

## 1.0.3 (Unreleased)

### Breaking changes
 * Updated the @animoca/ethereum-contracts-assets_inventory module dependency to ^2.0.2.
 * Migrated compiler to `solc:0.6.8`.

### Changes
 * `NftStaking.sol` defines its own `ERC1155_RECEIVED` and `ERC1155_BATCH_RECEIVED` constants for the ERC-1155 TokenReceiver callback functions, since being removed from the `IERC1155TokenReceiver.sol` contract of the Assets Inventory package.

### Improvements
 * Removed dependency on `@animoca/f1dt-core_metadata`.

### New features
 * Introduction of an SPDX License identifier to all contract headers.

## 1.0.2 (04/05/2020)

### Improvements
 * Updated dependency on `@animoca/ethereum-contracts-assets_inventory` to `2.0.1`.
 * Change variables names in multiple files to be more generic.

## 1.0.1 (04/05/2020)

### Improvements
 * Added 1_NftStaking.js migration script.

## 1.0.0 (03/05/2020)

### Breaking changes
 * Migration to `@animoca/ethereum-contracts-core_library:1.0.0` with `solc:0.6.x` and `@openzeppelin/contracts:3.x`.

### New features
 * Added `NftStakingMock.sol` and `NftStakingTestableMock.sol`.

### Improvements
 * Better abstraction of core staking features.

## 0.0.1 (15/04/2020)
* Initial commit.
