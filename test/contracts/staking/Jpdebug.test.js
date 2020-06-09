const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');
const { NFCollectionMaskLength } = require('../../../src').constants;
const TokenHelper = require('../../utils/tokenHelper');

const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");
const ERC20WithOperators = contract.fromArtifact("ERC20WithOperatorsMock");
const NftStaking = contract.fromArtifact("NftStakingTestableMock");

const DayInSeconds = 86400;

const RewardsTokenInitialBalance = new BN('100000000000000000000000');
const CycleLengthInSeconds = new BN(DayInSeconds);
const PeriodLengthInCycles = new BN(7);
const PeriodLengthInSeconds = PeriodLengthInCycles.mul(CycleLengthInSeconds);
const FreezeDurationInCycles = new BN(1);

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

describe.only('NftStaking', function () {
    const [
        creator,
        staker,
        ...otherAccounts
    ] = accounts;

    async function doFreshDeploy() {
        this.nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });

        this.rewardsToken = await ERC20WithOperators.new(RewardsTokenInitialBalance, { from: creator });

        this.stakingContract = await NftStaking.new(
            CycleLengthInSeconds,
            PeriodLengthInCycles,
            FreezeDurationInCycles,
            this.nftContract.address,
            this.rewardsToken.address,
            RarityWeights.map(x => x.rarity),
            RarityWeights.map(x => x.weight),
            { from: creator }
        );

        await this.rewardsToken.approve(this.stakingContract.address, RewardsTokenInitialBalance, { from: creator });

        for (const tokenId of TokenIds) {
            await this.nftContract.mintNonFungible(staker, tokenId, { from: creator });
        }
    }

    describe('Deployment pre-conditions', function () {
        before(doFreshDeploy);

        context('Staking contract', function () {
            it('should have the correct cycle length', async function () {
                const cycleLength = await this.stakingContract.cycleLengthInSeconds();
                cycleLength.should.be.bignumber.equal(CycleLengthInSeconds);
            });

            it('should have the correct period length', async function () {
                const periodLength = await this.stakingContract.periodLengthInCycles();
                periodLength.should.be.bignumber.equal(PeriodLengthInCycles);
            });

            it('should have the correct staking freeze duration', async function () {
                const freezeDuration = await this.stakingContract.freezeDurationInCycles();
                freezeDuration.should.be.bignumber.equal(FreezeDurationInCycles);
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

        context('Rewards Token contract', function () {
            it('should be used as the rewards token', async function () {
                const rewardsToken = await this.stakingContract.rewardsToken();
                rewardsToken.should.be.equal(this.rewardsToken.address);
            });

            // // The rewards token transfer to the contract should now occur when
            // // starting the staking event by calling the start() function
            // it(`should have a token balance of ${RewardsTokenInitialBalance.toString()} for the staking contract`, async function () {
            //     const balance = await this.rewardsToken.balanceOf(this.stakingContract.address);
            //     balance.should.be.bignumber.equal(RewardsTokenInitialBalance);
            // });
        });
    });

    async function start(rewardSchedule = DefaultRewardSchedule) {
        for (schedule of rewardSchedule) {
            await this.stakingContract.setRewardsForPeriods(
                schedule.startPeriod,
                schedule.endPeriod,
                schedule.rewardPerCycle,
                { from: creator }
            );
        }

        await this.stakingContract.start({ from: creator });
    }

    async function debugCurrentState(...stakers) {
        console.log();

        const cycle = (await this.stakingContract.getCurrentCycle()).toNumber();
        const period = Math.floor((cycle - 1) / PeriodLengthInCycles) + 1;
        const titleWidth = 18;
        const titlePartition = '|';
        const titlePadding = 2;

        let rewardMark = ('reward per-cycle' + titlePartition).padStart(titleWidth) + ' '.repeat(titlePadding);
        const rewardSchedule = [];
        for (let count = 1; count <= period; count++) {
            rewardSchedule.push(await this.stakingContract.rewardSchedule(count));
        }
        for (let index = 0; index < (period - 1); index++) {
            rewardMark += rewardSchedule[index].toString().padEnd(21, ' ');
        }
        rewardMark += rewardSchedule[period - 1];
        console.log(rewardMark);

        let periodMark = ('period' + titlePartition).padStart(titleWidth) + ' '.repeat(titlePadding);
        for (let count = 1; count < period; count++) {
            periodMark += count.toString().padEnd(21, ' ');
        }
        periodMark += period;
        console.log(periodMark);

        const trailingCycles = cycle % PeriodLengthInCycles;
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
        cycleGraph += `  (cycle: ${cycle})`;
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
            let stakerStakeMark = `staker #${index + 1} stake${titlePartition}`.padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
            if ((stake > 0) && (nextClaimableCycle > 0)) {
                stakerStakeMark += '   '.repeat(nextClaimableCycle - 1);
                stakerStakeMark += stake;
                stakerStakeMark += `  (cycle: ${nextClaimableCycle})`;
            }
            console.log(stakerStakeMark);
        }

        console.log();
    }

    function shouldDebugCurrentState(...stakers) {
        it('should debug the current state', async function () {
            await debugCurrentState.bind(this, ...stakers)();
            true.should.be.true;
        });
    }

    function shouldHaveSnapshot(fields, index = -1) {
        it('should have ' + (index < 0 ? 'latest snapshot' : `snapshot ${index}`) + ':' + JSON.stringify(fields), async function () {
            let snapshotIndex;

            if (index < 0) {
                const totalSnapshots = await this.stakingContract.totalSnapshots();
                snapshotIndex = totalSnapshots.subn(1);
            } else {
                snapshotIndex = new BN(snapshotIndex);
            }

            const snapshot = await this.stakingContracts.rewardsSnapshots(snapshotIndex);

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
            const snapshotBefore = await this.stakingContract.getLatestSnapshot();
            const stakerStateBefore = await this.stakingContract.stakerStates(from);
            const tokenInfoBefore = await this.stakingContract.tokensInfo(tokenId);

            const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: from });

            const snapshotAfter = await this.stakingContract.getLatestSnapshot();
            const stakerStateAfter = await this.stakingContract.stakerStates(from);
            const tokenInfoAfter = await this.stakingContract.tokensInfo(tokenId);

            snapshotAfter.stake.sub(snapshotBefore.stake).should.be.bignumber.equal(tokenInfoAfter.stake);
            stakerStateAfter.stake.sub(stakerStateBefore.stake).should.be.bignumber.equal(tokenInfoAfter.stake);
            tokenInfoBefore.owner.should.equal(constants.ZeroAddress);
            tokenInfoAfter.owner.should.equal(from);

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

    function shouldRevertAndNotStakeNft(from, tokenId, expectedError) {
        it(`should revert and not have staked ${tokenId} by ${from}`, async function () {
            const promise = this.nftContract.transferFrom(staker, this.stakingContract.address, tokenId, { from: from });

            if (expectedError) {
                await expectRevert(promise, expectedError);
            } else {
                await expectRevert.unspecified(promise);
            }
        });
    }

    function shouldEstimateRewards(from, periodsToClaim, periodsClaimed, amount) {
        it(`should have estimated ${amount.toString()} tokens over ${periodsToClaim} periods for ${from}`, async function () {
            const result = await this.stakingContract.estimateRewards(periodsToClaim, { from: from });
            result.claimableRewards.should.be.bignumber.equal(new BN(amount));
            result.claimablePeriods.should.be.bignumber.equal(new BN(periodsClaimed));
        });
    }

    function shouldClaimRewards(from, periodsToClaim, start, end, amount) {
        it(`should have claimed ${amount.toString()} tokens in ${periodsToClaim} periods from snapshots [${start}, ${end}] by ${from}`, async function () {
            const snapshotStartIndexBN = new BN(start);
            const snapshotEndIndexBN = new BN(end);
            const amountBN = new BN(amount);

            const stakerBalanceBefore = await this.rewardsToken.balanceOf(from);
            const contractBalanceBefore = await this.rewardsToken.balanceOf(this.stakingContract.address);
            const stakerStateBefore = await this.stakingContract.stakerStates(from);

            const estimate = await this.stakingContract.estimateRewards(periodsToClaim, { from: from });
            estimate.claimableRewards.should.be.bignumber.equal(amountBN);

            const receipt = await this.stakingContract.claimRewards(periodsToClaim, { from: from });

            const stakerBalanceAfter = await this.rewardsToken.balanceOf(from);
            const contractBalanceAfter = await this.rewardsToken.balanceOf(this.stakingContract.address);
            const stakerStateAfter = await this.stakingContract.stakerStates(from);

            const startSnapshot = await this.stakingContract.snapshots(snapshotStartIndexBN);
            const endSnapshot = await this.stakingContract.snapshots(snapshotEndIndexBN);

            stakerBalanceAfter.sub(stakerBalanceBefore).should.be.bignumber.equal(amountBN);
            contractBalanceBefore.sub(contractBalanceAfter).should.be.bignumber.equal(amountBN);
            stakerStateBefore.nextClaimableCycle.should.be.bignumber.equal(startSnapshot.startCycle);
            stakerStateAfter.nextClaimableCycle.should.be.bignumber.equal(endSnapshot.endCycle.addn(1));

            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: from,
                    snapshotStartIndex: snapshotStartIndexBN,
                    snapshotEndIndex: snapshotEndIndexBN,
                    amount: amountBN
                });
        });
    }

    function shouldNotClaimRewards(from, periodsToClaim, nextClaimableCycle) {
        it(`should not have claimed tokens in ${periodsToClaim} periods by ${from}`, async function () {
            const stakerBalanceBefore = await this.rewardsToken.balanceOf(from);
            const contractBalanceBefore = await this.rewardsToken.balanceOf(this.stakingContract.address);

            const receipt = await this.stakingContract.claimRewards(periodsToClaim, { from: from });

            const stakerBalanceAfter = await this.rewardsToken.balanceOf(from);
            const contractBalanceAfter = await this.rewardsToken.balanceOf(this.stakingContract.address);
            const stakerStateAfter = await this.stakingContract.stakerStates(from);

            stakerBalanceBefore.should.be.bignumber.equal(stakerBalanceAfter);
            contractBalanceBefore.should.be.bignumber.equal(contractBalanceAfter);

            // it's possible to not claim any rewards but still have the next
            // claimable cycle advance. this happens when there is no reward
            // schedule defined for a claimed period
            stakerStateAfter.nextClaimableCycle.toNumber().should.be.equal(nextClaimableCycle);

            await expectEvent.not.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: from
                });
        });
    }

    function shouldRevertAndNotClaimRewards(from, periodsToClaim, expectedError) {
        it(`should revert and not have claimed tokens in ${periodsToClaim} periods by ${from}`, async function () {
            const promise = this.stakingContract.claimRewards(periodsToClaim, { from: from });

            if (expectedError) {
                await expectRevert(promise, expectedError);
            } else {
                await expectRevert.unspecified(promise);
            }
        });
    }

    function shouldUnstakeNft(from, tokenId, cycle) {
        it(`should have unstaked ${tokenId} in cycle ${cycle} by ${from}`, async function () {
            const snapshotBefore = await this.stakingContract.getLatestSnapshot();
            const stakerStateBefore = await this.stakingContract.stakerStates(from);
            const tokenInfoBefore = await this.stakingContract.tokensInfo(tokenId);

            const receipt = await this.stakingContract.unstakeNft(tokenId, { from: from });

            const snapshotAfter = await this.stakingContract.getLatestSnapshot();
            const stakerStateAfter = await this.stakingContract.stakerStates(from);
            const tokenInfoAfter = await this.stakingContract.tokensInfo(tokenId);

            snapshotBefore.stake.sub(snapshotAfter.stake).should.be.bignumber.equal(tokenInfoBefore.stake);
            stakerStateBefore.stake.sub(stakerStateAfter.stake).should.be.bignumber.equal(tokenInfoBefore.stake);
            tokenInfoBefore.owner.should.equal(from);
            tokenInfoAfter.owner.should.equal(constants.ZeroAddress);

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

    function shouldRevertAndNotUnstakeNft(from, tokenId, expectedError) {
        it(`should revert and not have unstaked ${tokenId} by ${from}`, async function () {
            const promise = this.stakingContract.unstakeNft(tokenId, { from: from });

            if (expectedError) {
                await expectRevert(promise, expectedError);
            } else {
                await expectRevert.unspecified(promise);
            }
        });
    }


    describe('Scenario #0', function () {
        before(doFreshDeploy);
        before(start);

        describe('when staking a Common NFT', function () {
            shouldStakeNft(staker, TokenIds[0], 1);
            shouldHaveCurrentCycle(1);
            shouldHaveNumberOfSnapshots(1);
            shouldHaveStakerState({ nextClaimableCycle: 1, stake: 1 });

            describe('when 1 period have passed after staking', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.add(CycleLengthInSeconds).toNumber());
                });

                shouldHaveCurrentCycle(9);
                shouldHaveNumberOfSnapshots(1);

                describe('when estimating rewards for all periods', function () {
                    shouldEstimateRewards(staker, 4, 1, 7000); // 7 cycles in period 1
                });

                describe('when claiming all periods', function () {
                    shouldClaimRewards(staker, 4, 0, 0, 7000); // 7 cycles in period 1
                    shouldHaveCurrentCycle(9);
                    shouldHaveNumberOfSnapshots(2);
                    shouldHaveStakerState({ nextClaimableCycle: 8 });

                    describe('when unstaking the NFT', function () {
                        shouldUnstakeNft(staker, TokenIds[0], 9);
                    });
                });
            });
        });
    });

    describe('Scenario #1', function () {
        before(doFreshDeploy);
        before(start);

        describe('when 3 cycles have passed before staking', function () {
            before(async function () {
                await time.increase(CycleLengthInSeconds.muln(3).toNumber());
            });

            shouldHaveCurrentCycle(4);
            shouldHaveNumberOfSnapshots(0);
            shouldHaveStakerState({ nextClaimableCycle: 0, stake: 0 });

            describe('when staking a Common NFT', function () {
                shouldStakeNft(staker, TokenIds[0], 4);
                shouldHaveCurrentCycle(4);
                shouldHaveNumberOfSnapshots(1);
                shouldHaveStakerState({ nextClaimableCycle: 4, stake: 1 });

                describe('when unstaking before the end of the freeze', function () {
                    shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Token is still frozen');
                });

                describe('when 5 periods have passed after staking', function () {
                    before(async function () {
                        await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                    });

                    shouldHaveCurrentCycle(39);
                    shouldHaveNumberOfSnapshots(1);

                    describe('when staking another NFT before rewards are claimed', function () {
                        shouldRevertAndNotStakeNft(staker, TokenIds[1], 'NftStaking: Rewards are not claimed');
                    });

                    describe('when estimating rewards', function () {
                        context('for less than 2 periods', function () {
                            shouldEstimateRewards(staker, 1, 1, 4000); // 4 cycles in period 1
                        });

                        context('for exactly 2 periods', function () {
                            shouldEstimateRewards(staker, 2, 2, 11000); // 4 cycles in period 1 + 7 cycles in period 2
                        });
                    });

                    describe('when claiming 2 periods', function () {
                        shouldClaimRewards(staker, 2, 0, 1, 11000); // 4 cycles in period 1 + 7 cycles in period 2
                        shouldHaveCurrentCycle(39);
                        shouldHaveNumberOfSnapshots(6);
                        shouldHaveStakerState({ nextClaimableCycle: 15 });

                        describe('when staking an already staked NFT', function () {
                            shouldRevertAndNotStakeNft(staker, TokenIds[0], 'ERC1155: transfer of a non-owned NFT');
                        });

                        describe('when unstaking an NFT not owned by the caller', function () {
                            shouldRevertAndNotUnstakeNft(creator, TokenIds[0], 'NftStaking: incorrect token owner or token already unstaked');
                        });

                        describe('when 3 periods have passed since the last claim', function () {
                            before(async function () {
                                await time.increase(PeriodLengthInSeconds.muln(3).toNumber());
                            });

                            shouldHaveCurrentCycle(60);
                            shouldHaveNumberOfSnapshots(6);

                            describe('when unstaking a Common NFT before rewards are claimed', function () {
                                shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Rewards are not claimed');
                            });

                            describe('when estimating rewards', function () {
                                context('for exactly the 6 remaining periods', function () {
                                    shouldEstimateRewards(staker, 6, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                });

                                context('for more than the remaining periods', function () {
                                    shouldEstimateRewards(staker, 100, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                });
                            });

                            describe('when claming the remaining 6 periods', function () {
                                shouldClaimRewards(staker, 6, 2, 7, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                shouldHaveCurrentCycle(60);
                                shouldHaveNumberOfSnapshots(9);
                                shouldHaveStakerState({ nextClaimableCycle: 57 });

                                describe('when 2 periods have passed since the last claim', function () {
                                    before(async function () {
                                        await time.increase(PeriodLengthInSeconds.muln(2).toNumber());
                                    });

                                    describe('when claiming the remaining 2 periods', function () {
                                        shouldNotClaimRewards(staker, 2, 71);
                                        shouldHaveStakerState({ nextClaimableCycle: 71, stake: 0 });

                                        describe('when unstaking a Common NFT', function () {
                                            shouldUnstakeNft(staker, TokenIds[0], 74);
                                            shouldHaveCurrentCycle(74);
                                            shouldHaveNumberOfSnapshots(12);
                                            shouldHaveStakerState({ nextClaimableCycle: 0, stake: 0 });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        })
    });
});
