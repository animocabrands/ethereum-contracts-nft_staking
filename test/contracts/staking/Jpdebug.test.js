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

describe.only('NftStaking', function () {
    const [
        creator,
        staker,
        otherStaker,
        ...otherAccounts
    ] = accounts;

    async function doFreshDeploy() {
        this.nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });

        this.rewardsToken = await ERC20WithOperators.new(RewardsTokenInitialBalance, { from: creator });

        this.stakingContract = await NftStaking.new(
            CycleLengthInSeconds,
            PeriodLengthInCycles,
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

            // it('should have the correct staking freeze duration', async function () {
            //     const freezeDuration = await this.stakingContract.freezeLengthInCycles();
            //     freezeDuration.should.be.bignumber.equal(FreezeLengthInCycles);
            // });

            it('should have assigned a weight of 1 for Common cars', async function () {
                const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Common);
                weight.should.be.bignumber.equal(new BN(1));
            });

            it('should have assigned a weight of 10 for Epic cars', async function () {
                const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Epic);
                weight.should.be.bignumber.equal(new BN(10));
            });

            it('should have assigned a weight of 100 for Apex cars', async function () {
                const weight = await this.stakingContract.weightByTokenAttribute(TokenHelper.Rarity.Apex);
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
            rewardSchedule.push(await this.stakingContract.payoutSchedule(count));
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

        const totalSnapshots = (await this.stakingContract.lastGlobalSnapshotIndex()).add(new BN('1'));

        const globalHistory = [];
        for (let index = 0; index < totalSnapshots; index++) {
            globalHistory.push(await this.stakingContract.globalHistory(index));
        }

        let snapshotGraph = titlePartition.padStart(titleWidth) + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = globalHistory[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                snapshotGraph += ' '.repeat((startCycle - 1) * 3);
            }
            if (index < totalSnapshots - 1) {
                const nextSnapshot = globalHistory[index + 1];
                const endCycle = nextSnapshot.startCycle.toNumber() - 1;
                snapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}]`;
            } else {
                const endCycle = cycle;
                snapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 1)}`;
            }
        }
        console.log(snapshotGraph);

        let snapshotMark = ('global snapshot' + titlePartition).padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = globalHistory[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                const offset = (startCycle - 1) * 3;
                snapshotMark += ' '.repeat(offset);
            }
            if (index < totalSnapshots - 1) {
                const nextSnapshot = globalHistory[index + 1];
                const endCycle = nextSnapshot.startCycle.toNumber() - 1;
                snapshotMark += (index + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
            } else {
                const endCycle = cycle;
                snapshotMark += (index + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
            }
        }
        console.log(snapshotMark);

        let totalStakeMark = ('global stake' + titlePartition).padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
        for (let index = 0; index < totalSnapshots; index++) {
            const snapshot = globalHistory[index];
            const startCycle = snapshot.startCycle.toNumber();
            if (index == 0) {
                const offset = (snapshot.startCycle.toNumber() - 1) * 3;
                totalStakeMark += ' '.repeat(offset);
            }
            const stake = snapshot.stake.toNumber();
            if (index < totalSnapshots - 1) {
                const nextSnapshot = globalHistory[index + 1];
                const endCycle = nextSnapshot.startCycle.toNumber() - 1;
                totalStakeMark += (stake + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
            } else {
                const endCycle = cycle;
                totalStakeMark += (stake + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
            }
        }
        console.log(totalStakeMark);

        const stakersHistory = {};
        for (let index = 0; index < stakers.length; index++) {
            const staker = stakers[index];
            const lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
            const totalSnapshots = lastStakerSnapshotIndex.toNumber() + 1;
            const stakerHistory = [];
            for (let sIndex = 0; sIndex < totalSnapshots; sIndex++) {
                stakerHistory.push(await this.stakingContract.stakerHistories(staker, sIndex));
            }
            stakersHistory[staker] = stakerHistory;
        }

        for (let index = 0; index < stakers.length; index++) {
            let stakerSnapshotGraph = `staker #${index + 1} snapshot${titlePartition}`.padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
            const nextClaim = await this.stakingContract.nextClaims(stakers[index]);
            const lastStakerSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(stakers[index]);
            const totalSnapshots = lastStakerSnapshotIndex.toNumber() + 1;
            const stakerHistory = [];
            for (let sIndex = 0; sIndex < totalSnapshots; sIndex++) {
                stakerHistory.push(await this.stakingContract.stakerHistories(stakers[index], sIndex));
            }
            for (let sIndex = 0; sIndex < totalSnapshots; sIndex++) {
                const snapshot = stakerHistory[sIndex];
                const startCycle = snapshot.startCycle.toNumber();
                if (sIndex == 0) {
                    stakerSnapshotGraph += ' '.repeat((startCycle - 1) * 3);
                }
                if (sIndex < totalSnapshots - 1) {
                    const nextSnapshot = stakerHistory[sIndex + 1];
                    const endCycle = nextSnapshot.startCycle.toNumber() - 1;
                    stakerSnapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}]`;
                } else {
                    const endCycle = cycle;
                    stakerSnapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 1)}`;
                }
            }
            console.log(stakerSnapshotGraph);
            for (let sIndex = 0; sIndex < totalSnapshots; sIndex++) {
                const snapshot = stakerHistory[sIndex];
                const startCycle = snapshot.startCycle.toNumber();
                if (sIndex == 0) {
                    stakerSnapshotGraph += ' '.repeat((startCycle - 1) * 3);
                }
                if (sIndex < totalSnapshots - 1) {
                    const nextSnapshot = stakerHistory[sIndex + 1];
                    const endCycle = nextSnapshot.startCycle.toNumber() - 1;
                    stakerSnapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}]`;
                } else {
                    const endCycle = cycle;
                    stakerSnapshotGraph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 1)}`;
                }
            }
            // const nextClaimableCycle = await this.stakingContract.nextClaim.nextClaimableCycle.toNumber();
            // let stakerStakeMark = `staker #${index + 1} stake${titlePartition}`.padStart(titleWidth, ' ') + ' '.repeat(titlePadding);
            // if ((stake > 0) && (nextClaimableCycle > 0)) {
            //     stakerStakeMark += '   '.repeat(nextClaimableCycle - 1);
            //     stakerStakeMark += stake;
            //     stakerStakeMark += `  (cycle: ${nextClaimableCycle})`;
            // }
            // console.log(stakerStakeMark);
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
                const totalSnapshots = (await this.stakingContract.lastGlobalSnapshotIndex()).add(new BN('1'));
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

    function shouldHaveNextClaim(staker, period, globalHistoryIndex, stakerHistoryIndex) {
        it(`should have nextClaim.period=${period}`, async function () {
            const nextClaim = await this.stakingContract.nextClaims(staker);
            nextClaim.period.toNumber().should.equal(period);
        });
        it(`should have nextClaim.globalHistoryIndex=${globalHistoryIndex}`, async function () {
            const nextClaim = await this.stakingContract.nextClaims(staker);
            nextClaim.globalHistoryIndex.toNumber().should.equal(globalHistoryIndex);
        });
        it(`should have nextClaim.stakerHistoryIndex=${stakerHistoryIndex}`, async function () {
            const nextClaim = await this.stakingContract.nextClaims(staker);
            nextClaim.stakerHistoryIndex.toNumber().should.equal(stakerHistoryIndex);
        });
    }

    function shouldHaveCurrentCycleAndPeriod(cycle, period) {
        it(`should currently have: cycle=${cycle}, period=${period}`, async function () {
            const currentCycle = await this.stakingContract.getCurrentCycle();
            currentCycle.toNumber().should.equal(cycle);
            const currentPeriod = await this.stakingContract.getCurrentPeriod();
            currentPeriod.toNumber().should.equal(period);
        })
    }

    function shouldHaveGlobalHistoryLength(count) {
        it(`should have global history length: ${count}`, async function () {
            if (count == 0) {
                await expectRevert(
                    this.stakingContract.lastGlobalSnapshotIndex(),
                    "NftStaking: empty global history"
                );
            } else {
                const historyLength = (await this.stakingContract.lastGlobalSnapshotIndex()).add(new BN('1'));
                historyLength.toNumber().should.equal(count);
            }
        });
    }

    function shouldHaveStakerHistoryLength(staker, count) {
        it(`should have staker history length: ${count}`, async function () {
            if (count == 0) {
                await expectRevert(
                    this.stakingContract.lastStakerSnapshotIndex(staker),
                    "NftStaking: empty staker history"
                );
            } else {
                const historyLength = (await this.stakingContract.lastStakerSnapshotIndex(staker)).add(new BN('1'));
                historyLength.toNumber().should.equal(count);
            }
        });
    }

    function shouldHaveLastGlobalSnapshot(startCycle, stake, index) {
        it(`should have the lastGlobalSnapshot at index=${index}`, async function () {
            (await this.stakingContract.lastGlobalSnapshotIndex()).should.be.bignumber.equal(new BN(index));
        });

        it(`should have lastGlobalSnapshot.startCycle=${startCycle}`, async function () {
            (await this.stakingContract.globalHistory(index)).startCycle.should.be.bignumber.equal(new BN(startCycle));
        });

        it(`should have lastGlobalSnapshot.stake=${stake}`, async function () {
            (await this.stakingContract.globalHistory(index)).stake.should.be.bignumber.equal(new BN(stake));
        });
    }

    function shouldHaveLastStakerSnapshot(staker, startCycle, stake, index) {
        it(`should have the lastStakerSnapshot at index=${index}`, async function () {
            (await this.stakingContract.lastStakerSnapshotIndex(staker)).should.be.bignumber.equal(new BN(index));
        });

        it(`should have lastStakerSnapshot.startCycle=${startCycle}`, async function () {
            (await this.stakingContract.stakerHistories(staker, index)).startCycle.should.be.bignumber.equal(new BN(startCycle));
        });

        it(`should have lastStakerSnapshot.stake=${stake}`, async function () {
            (await this.stakingContract.stakerHistories(staker, index)).stake.should.be.bignumber.equal(new BN(stake));
        });
    }

    function shouldStakeNft(from, tokenId, cycle) {
        it(`should have staked ${tokenId} in cycle ${cycle} by ${from}`, async function () {
            const globalSnapshotBefore = await this.stakingContract.getLatestGlobalSnapshot();
            const stakerSnapshotBefore = await this.stakingContract.getLatestStakerSnapshot(from);
            const tokenInfoBefore = await this.stakingContract.tokenInfos(tokenId);

            const receipt = await this.nftContract.transferFrom(from, this.stakingContract.address, tokenId, { from: from });

            const globalSnapshotAfter = await this.stakingContract.getLatestGlobalSnapshot();
            const stakerSnapshotAfter = await this.stakingContract.getLatestStakerSnapshot(from);
            const tokenInfoAfter = await this.stakingContract.tokenInfos(tokenId);

            globalSnapshotAfter.stake.sub(globalSnapshotBefore.stake).should.be.bignumber.equal(tokenInfoAfter.weight);
            stakerSnapshotAfter.stake.sub(stakerSnapshotBefore.stake).should.be.bignumber.equal(tokenInfoAfter.weight);
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

    function shouldEstimateRewards(from, periodsToClaim, firstClaimablePeriod, computedPeriods, claimableRewards) {
        it(`should estimate ${claimableRewards} tokens in ${periodsToClaim} periods, starting at ${firstClaimablePeriod} by ${from}`, async function () {
            const result = await this.stakingContract.estimateRewards(periodsToClaim, { from: from });
            result.firstClaimablePeriod.should.be.bignumber.equal(new BN(firstClaimablePeriod));
            result.computedPeriods.should.be.bignumber.equal(new BN(computedPeriods));
            result.claimableRewards.should.be.bignumber.equal(new BN(claimableRewards));
        });
    }

    function shouldClaimRewards(from, periodsToClaim, firstClaimablePeriod, computedPeriods, claimableRewards) {
        it(`should claim ${claimableRewards} tokens in ${periodsToClaim} periods, starting at ${firstClaimablePeriod} by ${from}`, async function () {
            const stakerBalanceBefore = await this.rewardsToken.balanceOf(from);
            const contractBalanceBefore = await this.rewardsToken.balanceOf(this.stakingContract.address);
            const nextClaimBefore = await this.stakingContract.nextClaims(from);
            nextClaimBefore.period.should.be.bignumber.equal(new BN(firstClaimablePeriod));

            const estimate = await this.stakingContract.estimateRewards(periodsToClaim, { from: from });
            estimate.firstClaimablePeriod.should.be.bignumber.equal(new BN(firstClaimablePeriod));
            estimate.computedPeriods.should.be.bignumber.at.most(new BN(computedPeriods));
            estimate.claimableRewards.should.be.bignumber.equal(new BN(claimableRewards));

            const receipt = await this.stakingContract.claimRewards(periodsToClaim, { from: from });

            const stakerBalanceAfter = await this.rewardsToken.balanceOf(from);
            const contractBalanceAfter = await this.rewardsToken.balanceOf(this.stakingContract.address);
            const nextClaimAfter = await this.stakingContract.nextClaims(from);

            stakerBalanceAfter.sub(stakerBalanceBefore).should.be.bignumber.equal(new BN(claimableRewards));
            contractBalanceBefore.sub(contractBalanceAfter).should.be.bignumber.equal(new BN(claimableRewards));
            if (nextClaimAfter.period.toNumber() != 0) {
                nextClaimBefore.period.add(estimate.computedPeriods).should.be.bignumber.equal(nextClaimAfter.period);
            }

            if (estimate.computedPeriods > 0) {
                await expectEvent.inTransaction(
                    receipt.tx,
                    this.stakingContract,
                    'RewardsClaimed',
                    {
                        staker: from,
                        startPeriod: new BN(firstClaimablePeriod),
                        periodsClaimed: new BN(computedPeriods),
                        amount: new BN(claimableRewards)
                    });
            } else {
                await expectEvent.not.inTransaction(
                    receipt.tx,
                    this.stakingContract,
                    'RewardsClaimed',
                    {
                        staker: from
                    });
            }

        });
    }

    function shouldUnstakeNft(from, tokenId, cycle) {
        it(`should unstake ${tokenId} in cycle ${cycle} by ${from}`, async function () {
            const globalSnapshotBefore = await this.stakingContract.getLatestGlobalSnapshot();
            const stakerSnapshotBefore = await this.stakingContract.getLatestStakerSnapshot(from);
            const tokenInfoBefore = await this.stakingContract.tokenInfos(tokenId);

            const receipt = await this.stakingContract.unstakeNft(tokenId, { from: from });

            const globalSnapshotAfter = await this.stakingContract.getLatestGlobalSnapshot();
            const stakerSnapshotAfter = await this.stakingContract.getLatestStakerSnapshot(from);
            const tokenInfoAfter = await this.stakingContract.tokenInfos(tokenId);

            globalSnapshotBefore.stake.sub(globalSnapshotAfter.stake).should.be.bignumber.equal(tokenInfoBefore.weight);
            stakerSnapshotBefore.stake.sub(stakerSnapshotAfter.stake).should.be.bignumber.equal(tokenInfoBefore.weight);
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
            shouldHaveCurrentCycleAndPeriod(1, 1);
            shouldHaveNextClaim(
                staker,
                0, // period
                0, // globalHistoryIndex
                0, // stakerHistoryIndex
            );
            shouldStakeNft(staker, TokenIds[0], 1);
            shouldHaveLastGlobalSnapshot(1, 1, 0);
            shouldHaveLastStakerSnapshot(staker, 1, 1, 0);
            shouldHaveNextClaim(
                staker,
                1, // period
                0, // globalHistoryIndex
                0, // stakerHistoryIndex
            );

            describe('time warp 1 period and 1 cycle', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.add(CycleLengthInSeconds).toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(9, 2);

                shouldClaimRewards(staker, 99, 1, 1, 7000); // 7 cycles in period 1
                shouldHaveNextClaim(
                    staker,
                    2, // period
                    0, // globalHistoryIndex
                    0, // stakerHistoryIndex
                );

                shouldUnstakeNft(staker, TokenIds[0], 9);
                shouldHaveLastGlobalSnapshot(9, 0, 1);
                shouldHaveLastStakerSnapshot(staker, 9, 0, 1);
                shouldHaveNextClaim(
                    staker,
                    2, // period
                    0, // globalHistoryIndex
                    0, // stakerHistoryIndex
                );
            });
        });
    });

    describe('Scenario #1', function () {
        before(doFreshDeploy);
        before(start);

        describe('time warp 6 cycles', function () {
            before(async function () {
                await time.increase(CycleLengthInSeconds.muln(6).toNumber());
            });

            shouldHaveCurrentCycleAndPeriod(7, 1);
            shouldHaveGlobalHistoryLength(0);
            shouldHaveStakerHistoryLength(staker, 0);
            shouldHaveNextClaim(
                staker,
                0, // period
                0, // globalHistoryIndex
                0, // stakerHistoryIndex
            );

            describe('when staking a Common NFT', function () {
                shouldStakeNft(staker, TokenIds[0], 7);
                shouldHaveCurrentCycleAndPeriod(7, 1);
                shouldHaveGlobalHistoryLength(1);
                shouldHaveStakerHistoryLength(staker, 1);
                shouldHaveNextClaim(
                    staker,
                    1, // period
                    0, // globalHistoryIndex
                    0, // stakerHistoryIndex
                );


                describe('when unstaking before the end of the freeze', function () {
                    shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Token is still frozen');
                });

                describe('time warp 5 periods', function () {
                    before(async function () {
                        await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                    });

                    shouldHaveCurrentCycleAndPeriod(42, 6);
                    shouldHaveGlobalHistoryLength(1);
                    shouldHaveStakerHistoryLength(staker, 1);

                    // describe('when staking another NFT before rewards are claimed', function () {
                    //     shouldRevertAndNotStakeNft(staker, TokenIds[1], 'NftStaking: Rewards are not claimed');
                    // });

                    describe('when estimating rewards', function () {
                        context('for 1 period', function () {
                            shouldEstimateRewards(staker, 1, 1, 1, 1000); // 1 cycle in period 1
                        });

                        context('for 2 periods', function () {
                            shouldEstimateRewards(staker, 2, 1, 2, 8000); // 1 cycle in period 1 + 7 cycles in period 2
                        });
                    });

                    describe('when claiming 2 periods', function () {
                        shouldClaimRewards(staker, 2, 1, 2, 8000); // 1 cycle in period 1 + 7 cycles in period 2
                        shouldHaveGlobalHistoryLength(1);
                        shouldHaveStakerHistoryLength(staker, 1);
                        shouldHaveNextClaim(
                            staker,
                            3, // period
                            0, // globalHistoryIndex
                            0, // stakerHistoryIndex
                        );

                        // TODO move out of scenario
                        describe('when staking an already staked NFT', function () {
                            shouldRevertAndNotStakeNft(staker, TokenIds[0], 'ERC1155: transfer of a non-owned NFT');
                        });

                        // TODO move out of scenario
                        describe('when unstaking an NFT not owned by the caller', function () {
                            shouldRevertAndNotUnstakeNft(creator, TokenIds[0], 'NftStaking: Incorrect token owner or token already unstaked');
                        });

                        describe('time warp 3 periods', function () {
                            before(async function () {
                                await time.increase(PeriodLengthInSeconds.muln(3).toNumber());
                            });

                            shouldHaveCurrentCycleAndPeriod(63, 9);
                            shouldHaveGlobalHistoryLength(1);
                            shouldHaveStakerHistoryLength(staker, 1);

                            // describe('when unstaking a Common NFT before rewards are claimed', function () {
                            //     shouldRevertAndNotUnstakeNft(staker, TokenIds[0], 'NftStaking: Rewards are not claimed');
                            // });

                            describe('when estimating rewards', function () {
                                context('for exactly the 6 remaining periods', function () {
                                    shouldEstimateRewards(staker, 6, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                });

                                context('for more than the remaining periods', function () {
                                    shouldEstimateRewards(staker, 100, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                });
                            });

                            describe('when claiming the remaining 6 periods', function () {
                                shouldClaimRewards(staker, 6, 3, 6, 28000); // 7 cycles in period 3 + 7 cyles in period 4 + 28 cycles in period 5-8
                                shouldHaveNextClaim(
                                    staker,
                                    9, // period
                                    0, // globalHistoryIndex
                                    0, // stakerHistoryIndex
                                );

                                describe('time warp 2 periods', function () {
                                    before(async function () {
                                        await time.increase(PeriodLengthInSeconds.muln(2).toNumber());
                                    });

                                    describe('when claiming the remaining 2 periods', function () {
                                        shouldClaimRewards(staker, 2, 9, 2, 0);
                                        shouldHaveNextClaim(
                                            staker,
                                            11, // period
                                            0,  // globalHistoryIndex
                                            0,  // stakerHistoryIndex
                                        );

                                        describe('when unstaking a Common NFT', function () {
                                            shouldUnstakeNft(staker, TokenIds[0], 77);
                                            shouldHaveCurrentCycleAndPeriod(77, 11);
                                            shouldHaveGlobalHistoryLength(2);
                                            shouldHaveStakerHistoryLength(staker, 2);
                                            shouldHaveNextClaim(
                                                staker,
                                                11, // period
                                                0,  // globalHistoryIndex
                                                0,  // stakerHistoryIndex
                                            );
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

    describe('Multi stakers scenario', function () {
        const OtherTokenIds = [
            TokenHelper.makeTokenId(TokenHelper.Rarity.Common, TokenHelper.Type.Car),
            TokenHelper.makeTokenId(TokenHelper.Rarity.Epic, TokenHelper.Type.Car),
            TokenHelper.makeTokenId(TokenHelper.Rarity.Apex, TokenHelper.Type.Car)
        ];

        before(doFreshDeploy);
        before(start);

        before(async function () {
            for (const tokenId of OtherTokenIds) {
                await this.nftContract.mintNonFungible(otherStaker, tokenId, { from: creator });
            }
        });

        describe('Start', function () {
            shouldHaveCurrentCycleAndPeriod(1, 1);

            shouldStakeNft(staker, TokenIds[0], 1);
            shouldHaveLastGlobalSnapshot(1, 1, 0);
            shouldHaveLastStakerSnapshot(staker, 1, 1, 0);
            shouldHaveNextClaim(
                staker,
                1, // period
                0, // globalHistoryIndex
                0, // stakerHistoryIndex
            );
            shouldEstimateRewards(staker, 1, 1, 0, 0);

            describe('timewarp 1 period', function () {
                before(async function () {
                    await time.increase(PeriodLengthInSeconds.toNumber());
                });

                shouldHaveCurrentCycleAndPeriod(8, 2);

                shouldStakeNft(otherStaker, OtherTokenIds[0], 8);
                shouldHaveLastGlobalSnapshot(8, 2, 1);
                shouldHaveLastStakerSnapshot(otherStaker, 8, 1, 0);
                shouldHaveNextClaim(
                    otherStaker,
                    2, // period
                    1, // globalHistoryIndex
                    0, // stakerHistoryIndex
                );
                shouldEstimateRewards(otherStaker, 1, 2, 0, 0);
                shouldEstimateRewards(staker, 1, 1, 1, 7000);

                describe('timewarp 1 period', function () {
                    before(async function () {
                        await time.increase(PeriodLengthInSeconds.toNumber());
                    });

                    shouldHaveCurrentCycleAndPeriod(15, 3);

                    shouldEstimateRewards(otherStaker, 1, 2, 1, 3500);
                    shouldEstimateRewards(staker, 2, 1, 2, 10500);

                    describe('timewarp 2 cycles', function () {
                        before(async function () {
                            await time.increase(CycleLengthInSeconds.muln(2).toNumber());
                        });

                        shouldHaveCurrentCycleAndPeriod(17, 3);

                        shouldEstimateRewards(otherStaker, 10, 2, 1, 3500);
                        shouldEstimateRewards(staker, 10, 1, 2, 10500);
                        shouldHaveNextClaim(
                            staker,
                            1, // period
                            0, // globalHistoryIndex
                            0, // stakerHistoryIndex
                        );

                        shouldStakeNft(staker, TokenIds[1], 17);
                        shouldHaveNextClaim(
                            staker,
                            1, // period
                            0, // globalHistoryIndex
                            0, // stakerHistoryIndex
                        );
                        shouldEstimateRewards(otherStaker, 10, 2, 1, 3500);
                        shouldEstimateRewards(staker, 10, 1, 2, 10500);
                    });
                });
            });
        });
    });

    describe('Scenario late claim', function () {
        before(doFreshDeploy);
        before(start);

        shouldHaveCurrentCycleAndPeriod(1, 1);
        shouldStakeNft(staker, TokenIds[0], 1);
        shouldHaveGlobalHistoryLength(1);
        shouldHaveStakerHistoryLength(staker, 1);
        shouldHaveNextClaim(
            staker,
            1, // period
            0, // globalHistoryIndex
            0, // stakerHistoryIndex
        );

        describe('time warp 25 periods', function () {
            before(async function () {
                await time.increase(PeriodLengthInSeconds.muln(25).toNumber());
            });

            shouldHaveCurrentCycleAndPeriod(176, 26);
            shouldHaveGlobalHistoryLength(1);
            shouldHaveStakerHistoryLength(staker, 1);
            shouldEstimateRewards(staker, 1, 1, 1, 7000); // 1 cycle in period 1
            shouldEstimateRewards(staker, 50, 1, 25, RewardsPool); // Full pool

            shouldClaimRewards(staker, 50, 1, 25, RewardsPool); // Full pool
            shouldHaveGlobalHistoryLength(1);
            shouldHaveStakerHistoryLength(staker, 1);
            shouldHaveNextClaim(
                staker,
                26, // period
                0,  // globalHistoryIndex
                0,  // stakerHistoryIndex
            );

            describe('time warp 3 cycles', function () {
                before(async function () {
                    await time.increase(CycleLengthInSeconds.muln(3));
                });

                shouldHaveCurrentCycleAndPeriod(179, 26);
                shouldUnstakeNft(staker, TokenIds[0], 179);
                shouldHaveGlobalHistoryLength(2);
                shouldHaveStakerHistoryLength(staker, 2);
                shouldHaveNextClaim(
                    staker,
                    26, // period
                    0,  // globalHistoryIndex
                    0,  // stakerHistoryIndex
                );

                describe('time warp 5 periods', function () {
                    before(async function () {
                        await time.increase(PeriodLengthInSeconds.muln(5).toNumber());
                    });

                    shouldHaveCurrentCycleAndPeriod(214, 31);

                    shouldEstimateRewards(staker, 1, 26, 1, 0);
                    shouldEstimateRewards(staker, 50, 26, 5, 0);

                    shouldClaimRewards(staker, 1, 26, 1, 0);
                    shouldHaveNextClaim(
                        staker,
                        0, // period
                        0, // globalHistoryIndex
                        0, // stakerHistoryIndex
                    );

                    shouldEstimateRewards(staker, 1, 0, 0, 0);
                    shouldClaimRewards(staker, 5, 0, 0, 0);
                    shouldClaimRewards(staker, 250, 0, 0, 0);
                });
            });
        });
    });
});
