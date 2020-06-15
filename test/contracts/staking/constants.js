

const { BN } = require('@openzeppelin/test-helpers');
const TokenHelper = require('../../utils/tokenHelper');

const RewardsTokenInitialBalance = new BN('100000000000000000000000');

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
        rarity: TokenHelper.Rarity.Apex,
        weight: 100
    }
];

const TokenIds = [
    TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
    TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
];

const DefaultRewardSchedule = [
    { startPeriod: 1, endPeriod: 4, rewardPerCycle: 1000 },
    { startPeriod: 5, endPeriod: 8, rewardPerCycle: 500 }
];
const RewardsPool = 42000;

module.exports = {
    RewardsTokenInitialBalance,
    DayInSeconds, CycleLengthInSeconds, PeriodLengthInSeconds, PeriodLengthInCycles,
    RarityWeights, TokenIds, DefaultRewardSchedule, RewardsPool
}
