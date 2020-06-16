

const { BN } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../utils/tokenHelper');
const { toWei } = require("web3-utils");
const RewardsTokenInitialBalance = new BN(toWei('400000000'));

const DayInSeconds = 86400;
const CycleLengthInSeconds = new BN(DayInSeconds);
const PeriodLengthInCycles = new BN(7);
const PeriodLengthInSeconds = PeriodLengthInCycles.mul(CycleLengthInSeconds);

const RarityWeights = [
    {
        rarity: TokenHelper.Rarity.Common,
        weight: 1
    },
    {
        rarity: TokenHelper.Rarity.Epic,
        weight: 10
    },
    {
        rarity: TokenHelper.Rarity.Legendary,
        weight: 100
    },
    {
        rarity: TokenHelper.Rarity.Apex,
        weight: 500
    }
];

const TokenIds = [
    TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Legendary, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
];

const DefaultRewardSchedule = [
    { startPeriod: 1, endPeriod: 4, rewardPerCycle: 1000 },
    { startPeriod: 5, endPeriod: 8, rewardPerCycle: 500 }
];

const FlatRewardSchedule = [
    { startPeriod: 1, endPeriod: 12, rewardPerCycle: 1000 }
];

const MigrationRewardSchedule = [
    { startPeriod: 1, endPeriod: 4, rewardPerCycle: toWei('2700000') },
    { startPeriod: 5, endPeriod: 5, rewardPerCycle: toWei('2200000') },
    { startPeriod: 6, endPeriod: 6, rewardPerCycle: toWei('2150000') },
    { startPeriod: 7, endPeriod: 7, rewardPerCycle: toWei('2100000') },
    { startPeriod: 8, endPeriod: 8, rewardPerCycle: toWei('2050000') },
    { startPeriod: 9, endPeriod: 9, rewardPerCycle: toWei('2000000') },
    { startPeriod: 10, endPeriod: 10, rewardPerCycle: toWei('1950000') },
    { startPeriod: 11, endPeriod: 11, rewardPerCycle: toWei('1900000') },
    { startPeriod: 12, endPeriod: 12, rewardPerCycle: toWei('1850000') },
    { startPeriod: 13, endPeriod: 13, rewardPerCycle: toWei('1800000') },
    { startPeriod: 14, endPeriod: 14, rewardPerCycle: toWei('1750000') },
    { startPeriod: 15, endPeriod: 15, rewardPerCycle: toWei('1700000') },
    { startPeriod: 16, endPeriod: 16, rewardPerCycle: toWei('1650000') },
    { startPeriod: 17, endPeriod: 17, rewardPerCycle: toWei('1600000') },
    { startPeriod: 18, endPeriod: 18, rewardPerCycle: toWei('1550000') },
    { startPeriod: 19, endPeriod: 19, rewardPerCycle: toWei('1500000') },
    { startPeriod: 20, endPeriod: 20, rewardPerCycle: toWei('1475000') },
    { startPeriod: 21, endPeriod: 21, rewardPerCycle: toWei('1450000') },
    { startPeriod: 22, endPeriod: 22, rewardPerCycle: toWei('1425000') },
    { startPeriod: 23, endPeriod: 23, rewardPerCycle: toWei('1400000') },
    { startPeriod: 24, endPeriod: 24, rewardPerCycle: toWei('1375000') }
];

const RewardsPool = 42000;

module.exports = {
    DefaultRewardSchedule, MigrationRewardSchedule, FlatRewardSchedule,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, RewardsTokenInitialBalance, RewardsPool
}
