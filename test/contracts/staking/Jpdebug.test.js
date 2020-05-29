const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');
const { NFCollectionMaskLength } = require('../../../src').constants;
const TokenHelper = require('../../utils/tokenHelper');

const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");
const ERC20WithOperators = contract.fromArtifact("ERC20WithOperatorsMock");
const NftStaking = contract.fromArtifact("JpdebugNftStakingTestableMock");

const DayInSeconds = 86400;

const DividendTokenInitialBalance = new BN('100000000000000000000000');
const CycleLength = new BN(DayInSeconds);
const PayoutPeriodLength = new BN(7);
const FreezePeriodSeconds = new BN(DayInSeconds);

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

describe('NftStaking', function () {
    const [
        creator,
        rewardPoolProvider,
        staker,
        ...otherAccounts
    ] = accounts;

    async function doFreshDeploy() {
        this.nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });

        this.dividendToken = await ERC20WithOperators.new(DividendTokenInitialBalance, { from: creator });

        this.stakingContract = await NftStaking.new(
            CycleLength,
            PayoutPeriodLength,
            FreezePeriodSeconds,
            this.nftContract.address,
            this.dividendToken.address,
            RarityWeights.map(x => x.rarity),
            RarityWeights.map(x => x.weight),
            { from: creator }
        );

        await this.dividendToken.transfer(this.stakingContract.address, DividendTokenInitialBalance, { from: creator });

        for (const tokenId of TokenIds) {
            await this.nftContract.mintNonFungible(staker, tokenId, { from: creator });
        }
    }

    describe('Deployment pre-conditions', function () {
        before(doFreshDeploy);

        context('Staking contract', function () {
            it('should have a cycle length of 1 day (86400 seconds)', async function () {
                const cycleLength = await this.stakingContract.cycleLength();
                cycleLength.should.be.bignumber.equal(new BN(DayInSeconds));
            });

            it('should have a payout period length of 7 days (7 cycles)', async function () {
                const periodLength = await this.stakingContract.payoutPeriodLength();
                periodLength.should.be.bignumber.equal(new BN(7));
            });

            it('should have a staking freeze duration of 1 day (86400 seconds)', async function () {
                const freezeDuration = await this.stakingContract.freezeDurationAfterStake();
                freezeDuration.should.be.bignumber.equal(new BN(DayInSeconds));
            });

            it('should have assigned a weight of 1 for Common cars', async function () {
                const weight = await this.stakingContract.valueStakeWeights(TokenHelper.Rarity.Common);
                weight.should.be.bignumber.equal(new BN(1));
            });

            it('should have assigned a weight of 10 for Epic cars', async function () {
                const weight = await this.stakingContract.valueStakeWeights(TokenHelper.Rarity.Epic);
                weight.should.be.bignumber.equal(new BN(10));
            });

            it('should have assigned a weight of 100 for Apex cars', async function () {
                const weight = await this.stakingContract.valueStakeWeights(TokenHelper.Rarity.Apex);
                weight.should.be.bignumber.equal(new BN(100));
            });
        });

        context('NFT Assets Inventory contract', function () {
            it('should be whitelisted with the Staking contract', async function () {
                const whitelistedAddress = await this.stakingContract.whitelistedNftContract();
                whitelistedAddress.should.be.equal(this.nftContract.address);
            });

            it('should have minted 3 tokens in total for the staker', async function () {
                const balance = await this.nftContract.balanceOf(staker);
                balance.should.be.bignumber.equal(new BN(3));
            });

            it('should have minted 3 car tokens for the staker', async function () {
                for (const tokenId of TokenIds) {
                    const balance = await this.nftContract.balanceOf(staker, tokenId);
                    balance.should.be.bignumber.equal(new BN(1));

                    const tokenType = TokenHelper.getType(tokenId)
                    tokenType.should.be.equal(TokenHelper.Type.Car);
                }
            });

            it('should have minted a Common car token for the staker', async function () {
                const tokenId = TokenIds[0];
                const rarity = TokenHelper.getRarity(tokenId);
                rarity.should.be.equal(TokenHelper.Rarity.Common);
            });

            it('should have minted an Epic car token for the staker', async function () {
                const tokenId = TokenIds[1];
                const rarity = TokenHelper.getRarity(tokenId);
                rarity.should.be.equal(TokenHelper.Rarity.Epic);
            });

            it('should have minted an Apex car token for the staker', async function () {
                const tokenId = TokenIds[2];
                const rarity = TokenHelper.getRarity(tokenId);
                rarity.should.be.equal(TokenHelper.Rarity.Apex);
            });
        });

        context('Dividend Token contract', function () {
            it('should be used as the dividend token', async function () {
                const dividendToken = await this.stakingContract.dividendToken();
                dividendToken.should.be.equal(this.dividendToken.address);
            });

            it(`should have a token balance of ${DividendTokenInitialBalance.toString()} for the staking contract`, async function () {
                const balance = await this.dividendToken.balanceOf(this.stakingContract.address);
                balance.should.be.bignumber.equal(DividendTokenInitialBalance);
            });
        });
    });

    describe('Scenario #1', function () {
        const CurrentState = {
            currentCycle: new BN(0),
            numSnapshots: new BN(0),
            latestSnapshotStakedWeight: new BN(0),
            latestSnapshotTokensToClaim: new BN(0),
            stakerStateDepositCycle: new BN(0),
            stakerStateStakedWeight: new BN(0),
            stakerDividendTokenBalance: new BN(0),
            stakingContractDividendTokenBalance: new BN(0)
        };

        function testCurrentState(updates = {}) {
            describe('current state', function () {
                const expected = Object.assign({}, Object.assign(CurrentState, updates));

                it(`should have a current cycle of ${expected.currentCycle.toString()}`, async function () {
                    const currentCycle = await this.stakingContract.getCurrentCycle();
                    currentCycle.should.be.bignumber.equal(expected.currentCycle);
                });

                it(`should have ${expected.numSnapshots.toString()} snapshot(s)`, async function () {
                    const numSnapshots = await this.stakingContract.totalSnapshots();
                    numSnapshots.should.be.bignumber.equal(expected.numSnapshots);
                });

                describe(`latest snapshot`, function () {
                    before(async function () {
                        this.latestSnapshot = await this.stakingContract.getLatestSnapshot();
                    });

                    it(`should have a staked weight of ${expected.latestSnapshotStakedWeight.toString()}`, async function () {
                        this.latestSnapshot.stakedWeight.should.be.bignumber.equal(expected.latestSnapshotStakedWeight);
                    });

                    it(`should have a tokens-to-claim balance of ${expected.latestSnapshotTokensToClaim.toString()}`, async function () {
                        this.latestSnapshot.tokensToClaim.should.be.bignumber.equal(expected.latestSnapshotTokensToClaim);
                    });
                });

                describe(`staker state`, function () {
                    before(async function () {
                        this.stakerState = await this.stakingContract.stakeStates(staker);
                    });

                    it(`should have a deposit cycle of ${expected.stakerStateDepositCycle.toString()}`, async function () {
                        this.stakerState.depositCycle.should.be.bignumber.equal(expected.stakerStateDepositCycle);
                    });

                    it(`should have a staked weight of ${expected.stakerStateStakedWeight.toString()}`, async function () {
                        this.stakerState.stakedWeight.should.be.bignumber.equal(expected.stakerStateStakedWeight);
                    });
                });

                it(`should have a staker dividend token balance of ${expected.stakerDividendTokenBalance.toString()}`, async function () {
                    const dividendTokenBalance = await this.dividendToken.balanceOf(staker);
                    dividendTokenBalance.should.be.bignumber.equal(expected.stakerDividendTokenBalance);
                });

                it(`should have a staking contract dividend token balance of ${expected.stakingContractDividendTokenBalance.toString()}`, async function () {
                    const dividendTokenBalance = await this.dividendToken.balanceOf(this.stakingContract.address);
                    dividendTokenBalance.should.be.bignumber.equal(expected.stakingContractDividendTokenBalance);
                });
            });
        }

        const rewardPoolBalanceIncrease = new BN('1000000000');

        before(doFreshDeploy);

        before(async function () {
            await this.stakingContract.setPoolProvider(rewardPoolProvider, true, { from: creator });
            await this.stakingContract.rewardPoolBalanceIncreased(rewardPoolBalanceIncrease, { from: rewardPoolProvider });
        });

        // snapshot | 0 |
        //          --*--
        // cycle      1

        testCurrentState.bind(this, {
            currentCycle: constants.BN.One, // 1
            numSnapshots: constants.BN.One, // 1
            latestSnapshotTokensToClaim: rewardPoolBalanceIncrease, // 1000000000
            stakingContractDividendTokenBalance: DividendTokenInitialBalance, // 100000000000000000000000
        })();

        describe('advancing 3 cycles and increasing reward pool balance', function () {
            before(async function () {
                await time.increase(CycleLength.toNumber() * 3);
                await this.stakingContract.rewardPoolBalanceIncreased(rewardPoolBalanceIncrease, { from: rewardPoolProvider });
            });

            // snapshot | 0 |     1     |
            //          --*---*---*---*--
            // cycle      1   2   3   4

            testCurrentState.bind(this, {
                currentCycle: CurrentState.currentCycle.addn(3), // 4
                numSnapshots: CurrentState.numSnapshots.addn(1), // 2
                latestSnapshotTokensToClaim: CurrentState.latestSnapshotTokensToClaim.add(rewardPoolBalanceIncrease) // 2000000000
            })();

            describe('advancing 2 cycles', function () {
                before(async function () {
                    await time.increase(CycleLength.toNumber() * 2);
                });

                // snapshot | 0 |     1     |
                //          --*---*---*---*---*---*--
                // cycle      1   2   3   4   5   6

                testCurrentState.bind(this, {
                    currentCycle: CurrentState.currentCycle.addn(2) // 6
                })();

                describe('staking the Epic car', function () {
                    const tokenId = TokenIds[1]; // epic car

                    before(async function () {
                        await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: staker });
                    });

                    // snapshot | 0 |     1     |   2   |
                    //          --*---*---*---*---*---*--
                    // cycle      1   2   3   4   5   6
                    // stake                          |..

                    testCurrentState.bind(this, {
                        numSnapshots: CurrentState.numSnapshots.addn(1), // 3
                        latestSnapshotStakedWeight: CurrentState.latestSnapshotStakedWeight.addn(10), // 10
                        stakerStateDepositCycle: CurrentState.currentCycle, // 6
                        stakerStateStakedWeight: CurrentState.stakerStateStakedWeight.addn(10) // 10
                    })();

                    describe('advance 3 cycles and try to claim all dividends (none claimed)', function () {
                        before(async function () {
                            await time.increase(CycleLength.toNumber() * 3);
                            await this.stakingContract.jpdebugClaimDividends(1000, { from: staker });
                        });

                        // snapshot | 0 |     1     |   2   |
                        //          --*---*---*---*---*---*---*---*---*--
                        // cycle      1   2   3   4   5   6   7   8   9
                        // stake                          |..............

                        testCurrentState.bind(this, {
                            currentCycle: CurrentState.currentCycle.addn(3) // 9
                        })();

                        describe('advance 5 cycles and try to claim all dividends (1 payout period claimed)', function () {
                            before(async function () {
                                await time.increase(CycleLength.toNumber() * 5);
                                await this.stakingContract.jpdebugClaimDividends(1000, { from: staker });
                            });

                            // snapshot | 0 |     1     |   2   |               3               |
                            //          --*---*---*---*---*---*---*---*---*---*---*---*---*---*--
                            // cycle      1   2   3   4   5   6   7   8   9   10  11  12  13  14
                            // stake                          |..................................
                            // claim                              |=======================|

                            testCurrentState.bind(this, {
                                numSnapshots: CurrentState.numSnapshots.addn(1), // 4
                                currentCycle: CurrentState.currentCycle.addn(5), // 14
                                stakerStateDepositCycle: CurrentState.stakerStateDepositCycle.add(PayoutPeriodLength), // 13
                                stakerDividendTokenBalance: CurrentState.stakerDividendTokenBalance.add(new BN('14000000000')), // 14000000000
                                stakingContractDividendTokenBalance: CurrentState.stakingContractDividendTokenBalance.sub(new BN('14000000000')) // 99999999999986000000000
                            })();
                        });
                    });

                    describe('advance 8 cycles and try to claim all dividends (1 payout period claimed)', function () {
                        before(async function () {
                            await time.increase(CycleLength.toNumber() * 8);
                            await this.stakingContract.jpdebugClaimDividends(1000, { from: staker });
                        });

                        // snapshot | 0 |     1     |   2   |               3               |
                        //          --*---*---*---*---*---*---*---*---*---*---*---*---*---*--
                        // cycle      1   2   3   4   5   6   7   8   9   10  11  12  13  14
                        // stake                          |..................................
                        // claim                              |=======================|

                        testCurrentState.bind(this, {
                            numSnapshots: CurrentState.numSnapshots.addn(1), // 4
                            currentCycle: CurrentState.currentCycle.addn(8), // 14
                            stakerStateDepositCycle: CurrentState.stakerStateDepositCycle.add(PayoutPeriodLength), // 13
                            stakerDividendTokenBalance: CurrentState.stakerDividendTokenBalance.add(new BN('14000000000')), // 14000000000
                            stakingContractDividendTokenBalance: CurrentState.stakingContractDividendTokenBalance.sub(new BN('14000000000')) // 99999999999986000000000
                        })();
                    });
                });
            });
        });
    });

});
