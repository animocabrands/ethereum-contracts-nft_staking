const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');
const { NFCollectionMaskLength } = require('../../../src').constants;
const TokenHelper = require('../../utils/tokenHelper');

const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");
const ERC20WithOperators = contract.fromArtifact("ERC20WithOperatorsMock");
const NftStaking = contract.fromArtifact("NftStakingTestableMock");

const DayInSeconds = 86400;

const DividendTokenInitialBalance = new BN('100000000000000000000000');
const CycleLength = new BN(DayInSeconds);
const PayoutPeriodLength = new BN(7);
const PayoutPeriodLengthInSeconds = PayoutPeriodLength.mul(CycleLength);
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

const DefaultPayoutSchedule = [
    { startPeriod: 1, endPeriod: 4, payoutPerCycle: 1000 },
    { startPeriod: 5, endPeriod: 8, payoutPerCycle: 500 }
];

describe.only('NftStaking', function () {
    const [
        creator,
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

        await this.dividendToken.approve(this.stakingContract.address, DividendTokenInitialBalance, { from: creator });

        for (const tokenId of TokenIds) {
            await this.nftContract.mintNonFungible(staker, tokenId, { from: creator });
        }
    }

    describe('Deployment pre-conditions', function () {
        before(doFreshDeploy);

        context('Staking contract', function () {
            it('should have a cycle length of 1 day (86400 seconds)', async function () {
                const cycleLength = await this.stakingContract.cycleLengthInSeconds();
                cycleLength.should.be.bignumber.equal(new BN(DayInSeconds));
            });

            it('should have a payout period length of 7 days (7 cycles)', async function () {
                const periodLength = await this.stakingContract.periodLengthInCycles();
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

            // // The dividend token transfer to the contract should now occur when
            // // starting the staking event by calling the start() function
            // it(`should have a token balance of ${DividendTokenInitialBalance.toString()} for the staking contract`, async function () {
            //     const balance = await this.dividendToken.balanceOf(this.stakingContract.address);
            //     balance.should.be.bignumber.equal(DividendTokenInitialBalance);
            // });
        });
    });

    async function start(payoutSchedule = DefaultPayoutSchedule) {
        for (schedule of payoutSchedule) {
            await this.stakingContract.setPayoutForPeriods(
                schedule.startPeriod,
                schedule.endPeriod,
                schedule.payoutPerCycle,
                { from: creator }
            );
        }

        await this.stakingContract.start({ from: creator });
    }

    async function debugCurrentState(...stakers) {
        console.log();

        const cycle = (await this.stakingContract.getCurrentCycle()).toNumber();
        const period = Math.floor((cycle - 1) / PayoutPeriodLength) + 1;
        const titleWidth = 18;
        const titlePartition = '|';
        const titlePadding = 2;

        let periodMark = ('period' + titlePartition).padStart(titleWidth) + ' '.repeat(titlePadding);
        for (let count = 1; count < period; count++) {
            periodMark += count.toString().padEnd(21, ' ');
        }
        periodMark += period;
        console.log(periodMark);

        const trailingCycles = cycle % PayoutPeriodLength;
        let periodGraph = titlePartition.padStart(titleWidth) + ' '.repeat(titlePadding);
        if (period > 1) {
            periodGraph += '[```````````````````]'.repeat(period - 1);
        }
        periodGraph += trailingCycles == 0 ? '' : '[' + '`'.repeat((trailingCycles * 3) - 2);
        console.log(periodGraph);

        let cycleGraph = ('cycle' + titlePartition).padStart(titleWidth) + ' '.repeat(titlePadding);
        cycleGraph += '*-';
        if (cycle > 1) {
            cycleGraph += '-*-'.repeat(cycle - 1);
        }
        cycleGraph += `  ${cycle}`;
        console.log(cycleGraph);

        const totalSnapshots = await this.stakingContract.totalSnapshots();

        const snapshots = [];
        for (let index = 0; index < totalSnapshots; index++) {
            snapshots.push(await this.stakingContract.snapshots(index));
        }

        let snapshotGraph = titlePartition.padStart(titleWidth) + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = snapshots[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                snapshotGraph += ' '.repeat((startCycle - 1) * 3);
            }
            const endCycle = snapshot.endCycle.toNumber();
            snapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}]`;
        }
        console.log(snapshotGraph);

        let snapshotMark = ('snapshot' + titlePartition).padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = snapshots[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                const offset = (startCycle - 1) * 3;
                snapshotMark += ' '.repeat(offset);
            }
            const endCycle = snapshot.endCycle.toNumber();
            snapshotMark += (index + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        }
        console.log(snapshotMark);

        let totalStakeMark = ('total stake' + titlePartition).padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = snapshots[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                const offset = (snapshot.startCycle.toNumber() - 1) * 3;
                totalStakeMark += ' '.repeat(offset);
            }
            const endCycle = snapshot.endCycle.toNumber();
            const stake = snapshot.stake.toNumber();
            totalStakeMark += (stake + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        }
        console.log(totalStakeMark);

        for (let index = 0; index < stakers.length; index++) {
            const stakerState = await this.stakingContract.stakerStates(stakers[index]);
            const stake = stakerState.stake.toNumber();
            const nextClaimableCycle = stakerState.nextClaimableCycle.toNumber();
            let stakerMark = `staker #${index + 1} stake${titlePartition}`.padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
            if ((stake > 0) && (nextClaimableCycle > 0)) {
                stakerMark += '   '.repeat(nextClaimableCycle - 1);
                stakerMark += stake;
            }
            console.log(stakerMark);
        }

        console.log();
    }

    function shouldDebugCurrentState(...stakers) {
        it('should debug the current state', async function() {
            await debugCurrentState.bind(this, ...stakers)();
            true.should.be.true;
        });
    }

    function shouldHaveSnapshot(fields, index = -1) {
        it('should have ' + (index < 0 ? 'latest snapshot' : `snapshot ${index}`) + ':' + JSON.stringify(fields), async function() {
            let snapshotIndex;

            if (index < 0) {
                const totalSnapshots = await this.stakingContract.totalSnapshots();
                snapshotIndex = totalSnapshots.subn(1);
            } else {
                snapshotIndex = new BN(snapshotIndex);
            }

            const snapshot = await this.stakingContracts.dividendsSnapshots(snapshotIndex);

            if ('period' in snapshot) {
                snapshot.period.toNumber().should.equal(fields.period);
            }

            if ('starCycle' in snapshot) {
                snapshot.startCycle.toNumber().should.equal(fields.startCycle);
            }

            if ('endCycle' in snapshot) {
                snapshot.endCycle.toNumber().should.equal(fields.endCycle);
            }

            if ('stakedWeight' in snapshot) {
                snapshot.stakedWeight.toNumber().should.equal(fields.stakedWeight);
            }
        });
    }

    function shouldHaveStakerState(fields) {
        it(`should have staker state: ${JSON.stringify(fields)}`, async function () {
            const stakerState = await this.stakingContract.stakerStates(staker);

            if ('nextClaimableCycle' in stakerState) {
                stakerState.nextClaimableCycle.toNumber().should.equal(fields.nextClaimableCycle);
            }

            if ('stakedWeight' in stakerState) {
                stakerState.stakedWeight.toNumber().should.equal(fields.stakedWeight);
            }
        });
    }

    function shouldHaveCurrentCycle(cycle) {
        it(`should have current cycle: ${cycle}`, async function () {
            const currentCycle = await this.stakingContract.getCurrentCycle();
            currentCycle.toNumber().should.equal(cycle);
        })
    }

    function shouldHaveNumberOfSnapshots(count) {
        it(`should have snapshot count: ${count}`, async function () {
            const totalSnapshots = await this.stakingContract.totalSnapshots();
            totalSnapshots.toNumber().should.equal(count);
        });
    }

    function shouldStakeNft(from, tokenId, cycle) {
        it(`should have staked ${tokenId} in cycle ${cycle} by ${from}`, async function () {
            const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: from });

            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'NftStaked',
                {
                    staker: from,
                    tokenId: tokenId,
                    cycle: new BN(cycle)
                });
        });
    }

    function shouldEstimateDividends(from, periodsToClaim, periodsClaimed, amount, ensureSnapshots = -1) {
        it(`should have estimated ${amount} tokens over ${periodsToClaim} periods for ${from}`, async function () {
            if (ensureSnapshots >= 0) {
                await this.stakingContract.ensureSnapshots(ensureSnapshots);
            }
            const result = await this.stakingContract.estimateDividends(periodsToClaim, { from: from });
            result.totalDividendsToClaim.toNumber().should.be.equal(amount);
            result.periodsClaimed.toNumber().should.be.equal(periodsClaimed);
        });
    }

    function shouldClaimDividends(from, periodsToClaim, start, end, amount) {
        it(`should have claimed ${amount} tokens in ${periodsToClaim} periods from snapshots [${start}, ${end}] by ${from}`, async function () {
            const receipt = await this.stakingContract.claimDividends(periodsToClaim, { from: from });

            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'DividendsClaimed',
                {
                    staker: from,
                    snapshotStartIndex: new BN(start),
                    snapshotEndIndex: new BN(end),
                    amount: new BN(amount)
                });
        });
    }

    function shouldUnstakeNft(from, tokenId, cycle) {
        it(`should have unstaked ${tokenId} in cycle ${cycle} by ${from}`, async function () {
            const receipt = await this.stakingContract.unstakeNft(tokenId, { from: from });

            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'NftUnstaked',
                {
                    staker: from,
                    tokenId: tokenId,
                    cycle: new BN(cycle)
                });
        });
    }

    describe('Scenario #1', function () {
        before(doFreshDeploy);
        before(start);

        describe('when 3 cycles have passed before staking', function () {
            before(async function () {
                await time.increase(CycleLength.toNumber() * 3);
            });

            shouldHaveCurrentCycle(4);
            shouldHaveNumberOfSnapshots(0);
            shouldHaveStakerState({ nextClaimableCycle: 0, stake: 0 });

            describe('when staking a Common NFT', function () {
                shouldStakeNft(staker, TokenIds[0], 4);
                shouldHaveCurrentCycle(4);
                shouldHaveNumberOfSnapshots(1);
                shouldHaveStakerState({ nextClaimableCycle: 4, stake: 1 });

                describe('when 5 periods have passed after staking', function () {
                    before(async function () {
                        await time.increase(PayoutPeriodLengthInSeconds.toNumber() * 5);
                    });

                    shouldHaveCurrentCycle(39);
                    shouldHaveNumberOfSnapshots(1);

                    describe('when estimating dividends for 2 periods', function () {
                        context('when not ensuring snapshots', function () {
                            shouldEstimateDividends(staker, 2, 0, 0);
                            shouldHaveCurrentCycle(39);
                            shouldHaveNumberOfSnapshots(1);
                        });

                        context('when ensuring snapshots', function () {
                            shouldEstimateDividends(staker, 2, 2, 11000, 0);
                            shouldHaveCurrentCycle(39);
                            shouldHaveNumberOfSnapshots(6);
                        })
                    });

                    describe('when claiming 2 periods', function () {
                        shouldClaimDividends(staker, 2, 0, 1, 11000); // 4 cycles in period 1 + 7 cycles in period 2
                        shouldHaveCurrentCycle(39);
                        shouldHaveNumberOfSnapshots(6);
                        shouldHaveStakerState({ nextClaimableCycle: 15 });

                        describe('when 3 periods have passed since the last claim', function () {
                            before(async function () {
                                await time.increase(PayoutPeriodLengthInSeconds.toNumber() * 3);
                            });

                            shouldHaveCurrentCycle(60);
                            shouldHaveNumberOfSnapshots(6);

                            describe('when claming the remaining 6 periods', function () {
                                shouldClaimDividends(staker, 6, 2, 7, 17500); // 7 cycles in period 3 + 7 cyles in period 4 + 21 cycles in period 5-7
                                shouldHaveCurrentCycle(60);
                                shouldHaveNumberOfSnapshots(9);
                                shouldHaveStakerState({ nextClaimableCycle: 57 });
                            });

                            describe('when unstaking a Common NFT', function () {
                                shouldUnstakeNft(staker, TokenIds[0], 60);
                                shouldHaveCurrentCycle(60);
                                shouldHaveNumberOfSnapshots(10);
                                shouldHaveStakerState({ nextClaimableCycle: 0, stake: 0 });
                            });
                        });
                    });
                });
            });
        })

    });
});
