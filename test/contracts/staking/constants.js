const {BN} = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../utils/tokenHelper');
const {toWei} = require('web3-utils');
const RewardsTokenInitialBalance = new BN(toWei('400000000'));

const DayInSeconds = 86400;
const CycleLengthInSeconds = new BN(DayInSeconds);
const PeriodLengthInCycles = new BN(7);
const PeriodLengthInSeconds = PeriodLengthInCycles.mul(CycleLengthInSeconds);

const RarityWeights = [
    {
        rarity: TokenHelper.Rarities.Common,
        weight: 1,
    },
    {
        rarity: TokenHelper.Rarities.Epic,
        weight: 10,
    },
    {
        rarity: TokenHelper.Rarities.Legendary,
        weight: 100,
    },
    {
        rarity: TokenHelper.Rarities.Apex,
        weight: 500,
    },
];

const DefaultRewardSchedule = [
    {startPeriod: 1, endPeriod: 4, rewardPerCycle: '1000'},
    {startPeriod: 5, endPeriod: 8, rewardPerCycle: '500'},
];

const FlatRewardSchedule = [{startPeriod: 1, endPeriod: 12, rewardPerCycle: '1000'}];

const MigrationRewardSchedule = [
    {startPeriod: 1, endPeriod: 4, rewardPerCycle: '2700000'},
    {startPeriod: 5, endPeriod: 5, rewardPerCycle: '2200000'},
    {startPeriod: 6, endPeriod: 6, rewardPerCycle: '2150000'},
    {startPeriod: 7, endPeriod: 7, rewardPerCycle: '2100000'},
    {startPeriod: 8, endPeriod: 8, rewardPerCycle: '2050000'},
    {startPeriod: 9, endPeriod: 9, rewardPerCycle: '2000000'},
    {startPeriod: 10, endPeriod: 10, rewardPerCycle: '1950000'},
    {startPeriod: 11, endPeriod: 11, rewardPerCycle: '1900000'},
    {startPeriod: 12, endPeriod: 12, rewardPerCycle: '1850000'},
    {startPeriod: 13, endPeriod: 13, rewardPerCycle: '1800000'},
    {startPeriod: 14, endPeriod: 14, rewardPerCycle: '1750000'},
    {startPeriod: 15, endPeriod: 15, rewardPerCycle: '1700000'},
    {startPeriod: 16, endPeriod: 16, rewardPerCycle: '1650000'},
    {startPeriod: 17, endPeriod: 17, rewardPerCycle: '1600000'},
    {startPeriod: 18, endPeriod: 18, rewardPerCycle: '1550000'},
    {startPeriod: 19, endPeriod: 19, rewardPerCycle: '1500000'},
    {startPeriod: 20, endPeriod: 20, rewardPerCycle: '1475000'},
    {startPeriod: 21, endPeriod: 21, rewardPerCycle: '1450000'},
    {startPeriod: 22, endPeriod: 22, rewardPerCycle: '1425000'},
    {startPeriod: 23, endPeriod: 23, rewardPerCycle: '1400000'},
    {startPeriod: 24, endPeriod: 24, rewardPerCycle: '1375000'},
];

const RewardsPool = '42000';

module.exports = {
    DefaultRewardSchedule,
    MigrationRewardSchedule,
    FlatRewardSchedule,
    DayInSeconds,
    CycleLengthInSeconds,
    PeriodLengthInSeconds,
    PeriodLengthInCycles,
    RarityWeights,
    RewardsTokenInitialBalance,
    RewardsPool,
};
