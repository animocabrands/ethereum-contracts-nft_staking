const { BN } = require('@openzeppelin/test-helpers');
const { toWei } = require('web3-utils');

const DayInSeconds = 86400;

const DefaultCycleLengthInSeconds = new BN(DayInSeconds);
const DefaultPeriodLengthInCycles = new BN(7);

const ExamplePayoutSchedule = [ // payouts are expressed in decimal form and need to be converted to wei
    { startPeriod: 1, endPeriod: 4, payoutPerCycle: toWei('2700000') },
    { startPeriod: 5, endPeriod: 5, payoutPerCycle: toWei('2200000') },
    { startPeriod: 6, endPeriod: 6, payoutPerCycle: toWei('2150000') },
    { startPeriod: 7, endPeriod: 7, payoutPerCycle: toWei('2100000') },
    { startPeriod: 8, endPeriod: 8, payoutPerCycle: toWei('2050000') },
    { startPeriod: 9, endPeriod: 9, payoutPerCycle: toWei('2000000') },
    { startPeriod: 10, endPeriod: 10, payoutPerCycle: toWei('1950000') },
    { startPeriod: 11, endPeriod: 11, payoutPerCycle: toWei('1900000') },
    { startPeriod: 12, endPeriod: 12, payoutPerCycle: toWei('1850000') },
    { startPeriod: 13, endPeriod: 13, payoutPerCycle: toWei('1800000') },
    { startPeriod: 14, endPeriod: 14, payoutPerCycle: toWei('1750000') },
    { startPeriod: 15, endPeriod: 15, payoutPerCycle: toWei('1700000') },
    { startPeriod: 16, endPeriod: 16, payoutPerCycle: toWei('1650000') },
    { startPeriod: 17, endPeriod: 17, payoutPerCycle: toWei('1600000') },
    { startPeriod: 18, endPeriod: 18, payoutPerCycle: toWei('1550000') },
    { startPeriod: 19, endPeriod: 19, payoutPerCycle: toWei('1500000') },
    { startPeriod: 20, endPeriod: 20, payoutPerCycle: toWei('1475000') },
    { startPeriod: 21, endPeriod: 21, payoutPerCycle: toWei('1450000') },
    { startPeriod: 22, endPeriod: 22, payoutPerCycle: toWei('1425000') },
    { startPeriod: 23, endPeriod: 23, payoutPerCycle: toWei('1400000') },
    { startPeriod: 24, endPeriod: 24, payoutPerCycle: toWei('1375000') },
]; // total ~ 320,000,000

const ExampleWeightsByRarity = {
    0: 500, // Apex,
    1: 100, // Legendary,
    2: 50,  // Epic,
    3: 50,  // Epic,
    4: 10,  // Rare,
    5: 10,  // Rare,
    6: 10,  // Rare,
    7: 1,   // Common,
    8: 1,   // Common,
    9: 1    // Common,
};

module.exports = {
    DefaultCycleLengthInSeconds,
    DefaultPeriodLengthInCycles,
    ExamplePayoutSchedule,
    ExampleWeightsByRarity,
}
