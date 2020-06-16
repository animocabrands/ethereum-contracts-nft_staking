const { accounts, contract } = require('@openzeppelin/test-environment');
const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { toWei } = require('web3-utils');

const { constants, shouldSupportInterfaces } = require('@animoca/ethereum-contracts-core_library');
const { EmptyByte } = constants;
const { interfaces } = require('@animoca/ethereum-contracts-assets_inventory');
const { inventoryIds } = require('@animoca/blockchain-inventory_metadata');
const { NFCollectionMaskLength } = require('../../../src').constants;

const NftStaking = contract.fromArtifact("NftStakingTestableMock");
const AssetsInventory = contract.fromArtifact("AssetsInventoryMock");
const ERC20WithOperators = contract.fromArtifact("ERC20WithOperatorsMock");

const DayInSeconds = 86400;
const CycleLengthInSeconds = new BN(DayInSeconds);
const PeriodLengthInCycles = new BN(7);
const PeriodLengthInSeconds = PeriodLengthInCycles.toNumber() * DayInSeconds;

const FreezePeriodInSeconds = new BN(DayInSeconds);
const FreezePeriodInDays = Math.ceil(FreezePeriodInSeconds.toNumber() / DayInSeconds);

const RewardsTokenInitialBalance = toWei('10000000000');

const RewardsClaimedEvent = "RewardsClaimed";
// const NftUnstakedEvent = "NftUnstaked";
// const NftStakedEvent = "NftStaked";

const fullDebug = true;

const CarRarities = {
    Common: 1,
    Epic: 2,
    Apex: 3
};

// const CarRarityToStr = {
//     1: "Common",
//     2: "Epic",
//     3: "Apex"
// };

const CarWeightsConfig = [{
    rarity: CarRarities.Common,
    weight: 1
}, {
    rarity: CarRarities.Epic,
    weight: 10
}, {
    rarity: CarRarities.Apex,
    weight: 100
}];

const Types = {
    None: 0,
    Car: 1,
    Driver: 2,
    Part: 3,
    Gear: 4,
    Tyres: 5,
    Track: 6
};

let NftMintCounter = 1;
let seasonCounter = 1;

function createTestNft(rarity, type) {
    // TODO use bits layout instead
    let tokenId = inventoryIds.makeNonFungibleTokenId(NftMintCounter++, 1, NFCollectionMaskLength);
    tokenId = new BN(tokenId).or(new BN(type).shln(240)).or(new BN(seasonCounter++).shln(232)).or(new BN(rarity).shln(176));
    return tokenId;
}

const CarNFTs = [
    {
        tokenId: createTestNft(CarRarities.Common, Types.Car),
        rarity: CarRarities.Common
    },
    {
        tokenId: createTestNft(CarRarities.Epic, Types.Car),
        rarity: CarRarities.Epic
    },
    {
        tokenId: createTestNft(CarRarities.Apex, Types.Car),
        rarity: CarRarities.Apex
    }
];

const NonCarNFTs = [
    {
        tokenId: createTestNft(CarRarities.Common, Types.Driver),
        type: Types.Driver
    },
    {
        tokenId: createTestNft(CarRarities.Epic, Types.Gear),
        type: Types.Gear
    },
    {
        tokenId: createTestNft(CarRarities.Apex, Types.Tyres),
        type: Types.Tyres
    }
];

const DefaultPayoutSchedule = [
    { startPeriod: 1, endPeriod: 4, rewardPerCycle: 1000 },
    { startPeriod: 5, endPeriod: 8, rewardPerCycle: 500 }
];

const [creator, staker, ...otherAccounts] = accounts;

describe("NftStaking", function () {

    async function debug_PrintAllSnapshots() {
        if (!fullDebug) return;

        console.log("===== Snapshots");
        const t = (await this.stakingContract.totalSnapshots()).toNumber();
        for (let k = 0; k < t; ++k) {
            const ss = await this.stakingContract.snapshots(k);

            for (let key in ss) {
                if (!isNaN(key)) continue;
                console.log(`${key} = ${ss[key].toString()}`);
            }

            console.log("================");
        }
    }

    async function debug_Cycles(from) {
        if (!fullDebug) return;

        console.log("===== Cycles", from);
        const c = (await this.stakingContract.getCurrentCycle()).toNumber();
        console.log("current cycle ", c);

        const cpp = (await this.stakingContract.getCurrentPayoutPeriod()).toNumber();
        console.log("current period ", cpp);

        // const pp = (await this.stakingContract._currentPayoutPeriod({ from })).toNumber();
        // console.log("period", pp);

        const upp = (await this.stakingContract.getUnclaimedPayoutPeriods({ from }));
        console.log("start period to claim", upp[0].toNumber());
        console.log("unclaimed periods", upp[1].toNumber());

        console.log("=====================");
    }

    async function debug_state(from) {
        if (!fullDebug) return;

        const state = await this.stakingContract.stakerStates(from);

        console.log("===== Staker's State", from);
        console.log("nextClaimableCycle", state.nextClaimableCycle.toNumber());
        console.log("stake", state.stake.toNumber());
    }

    function testSnapshot(startCycle, endCycle, stake, rewardsToClaim) {
        it(`snapshot.startCycle == ${startCycle}`, function () {
            this.snapshot.startCycle.toNumber().should.be.equal(startCycle);
        });

        it(`snapshot.endCycle == ${endCycle}`, function () {
            this.snapshot.endCycle.toNumber().should.be.equal(endCycle);
        });

        it(`snapshot.stake == ${stake}`, function () {
            this.snapshot.stake.toNumber().should.be.equal(stake);
        });

        it(`snapshot.rewardsToClaim == ${rewardsToClaim}`, function () {
            this.snapshot.rewardsToClaim.toNumber().should.be.equal(rewardsToClaim);
        });
    }

    async function doFreshDeploy() {
        this.nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });

        this.rewardsToken = await ERC20WithOperators.new(RewardsTokenInitialBalance, { from: creator });
        this.stakingContract = await NftStaking.new(
            CycleLengthInSeconds,
            PeriodLengthInCycles,
            FreezePeriodInSeconds,
            this.nftContract.address,
            this.rewardsToken.address,
            CarWeightsConfig.map(x => x.rarity),
            CarWeightsConfig.map(x => x.weight),
            { from: creator }
        );

        await this.rewardsToken.approve(this.stakingContract.address, RewardsTokenInitialBalance, { from: creator });

        this.mock = this.stakingContract;

        // mint some NFTs
        for (const nft of CarNFTs) {
            await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
        }

        for (const nft of NonCarNFTs) {
            await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
        }
    }

    function start(rewardSchedule = DefaultPayoutSchedule) {
        return async function () {
            for (schedule of rewardSchedule) {
                await this.stakingContract.setPayoutForPeriods(
                    schedule.startPeriod,
                    schedule.endPeriod,
                    schedule.rewardPerCycle,
                    { from: creator }
                );
            }
            await this.stakingContract.start({ from: creator });
            // console.log(`Staking started, total reward: ${(await(this.rewardsToken.balanceOf(this.stakingContract.address)))}`);
        }
    }

    describe("Getting or creating the latest cycle snapshot", function () {
        before(doFreshDeploy);
        before(start());

        it("must initially have no snapshots", async function () {
            const numSnapshots = await this.stakingContract.totalSnapshots();
            numSnapshots.toNumber().should.be.equal(0);
        });

        it("Cycle 1 (Period 1), getSnapshot(0)", async function () {
            this.receipt = await this.stakingContract.getSnapshot(0);
            const numSnapshots = await this.stakingContract.totalSnapshots();
            numSnapshots.toNumber().should.be.equal(1);
            const snapshot = await this.stakingContract.getLatestSnapshot();
            snapshot.startCycle.toNumber().should.be.equal(1);
            snapshot.endCycle.toNumber().should.be.equal(1);
        });

        it("must emit the SnapshotUpdated event", async function () {
            await expectEvent.inTransaction(
                this.receipt.tx,
                this.stakingContract,
                'SnapshotUpdated',
                {
                    index: new BN(0),
                    startCycle: new BN(1),
                    endCycle: new BN(1),
                    stake: new BN(0),
                });
        });

        // it("must not emit the SnapshotUpdated event", async function () {
        //     await expectEvent.not.inTransaction(
        //         this.receipt.tx,
        //         this.stakingContract,
        //         'SnapshotUpdated');
        // });

        it("Cycle 1 (Period 1), getSnapshot(0)", async function () {
            await time.increase(1);
            this.receipt = await this.stakingContract.getSnapshot(0);
            const numSnapshots = await this.stakingContract.totalSnapshots();
            numSnapshots.toNumber().should.be.equal(1);
            const snapshot = await this.stakingContract.getLatestSnapshot();
            snapshot.startCycle.toNumber().should.be.equal(1);
            snapshot.endCycle.toNumber().should.be.equal(1);
        });

        // it("must not emit the SnapshotCreated event", async function () {
        //     await expectEvent.not.inTransaction(
        //         this.receipt.tx,
        //         this.stakingContract,
        //         'SnapshotCreated');
        // });

        // TODO why emit here? It is actually not updating the snapshot
        // it("must emit the SnapshotUpdated event", async function () {
        //     await expectEvent.inTransaction(
        //         this.receipt.tx,
        //         this.stakingContract,
        //         'SnapshotUpdated',
        //         {
        //             index: new BN(0),
        //             startCycle: new BN(1),
        //             endCycle: new BN(1),
        //             stake: new BN(0),
        //         });
        // });

        it("Cycle 8 (Period 2), getSnapshot(0)", async function () {
            await time.increase(PeriodLengthInSeconds);
            this.receipt = await this.stakingContract.getSnapshot(0);

            const numSnapshots = await this.stakingContract.totalSnapshots();
            numSnapshots.toNumber().should.be.equal(2);

            const snapshot = await this.stakingContract.getLatestSnapshot();
            snapshot.startCycle.toNumber().should.be.equal(8);
            snapshot.endCycle.toNumber().should.be.equal(8);
        });

        // // TODO why these 2 events?
        // it("must emit the SnapshotCreated event", async function () {
        //     await expectEvent.inTransaction(
        //         this.receipt.tx,
        //         this.stakingContract,
        //         'SnapshotCreated');
        // });

        it("must emit 2 SnapshotUpdated events", async function () {
            await expectEvent.inTransaction(
                this.receipt.tx,
                this.stakingContract,
                'SnapshotUpdated',
                {
                    index: new BN(0),
                    startCycle: new BN(1),
                    endCycle: new BN(7),
                    stake: new BN(0),
                }
            );

            await expectEvent.inTransaction(
                this.receipt.tx,
                this.stakingContract,
                'SnapshotUpdated',
                {
                    index: new BN(1),
                    startCycle: new BN(8),
                    endCycle: new BN(8),
                    stake: new BN(0),
                }
            );
        });

        // describe("Cycle 8 (Period 2), getSnapshot(nextCycleTs): future snapshot creation", async function () {
        //     beforeEach(async function () {
        //         this.receipt = await this.stakingContract.getSnapshot(CycleLengthInSeconds);
        //     });

            it("Updates the snapshots in storage", async function () {
                this.receipt = await this.stakingContract.getSnapshot(CycleLengthInSeconds);
                let numSnapshots = await this.stakingContract.totalSnapshots();
                numSnapshots.toNumber().should.be.equal(3);

                const snapshot = await this.stakingContract.getLatestSnapshot();
                snapshot.startCycle.toNumber().should.be.equal(9);
                snapshot.endCycle.toNumber().should.be.equal(9);
            });
        // });

        it("must emit the SnapshotCreated event", async function () {
            await expectEvent.inTransaction(
                this.receipt.tx,
                this.stakingContract,
                'SnapshotCreated');
        });

        it("must not emit the SnapshotUpdated event", async function () {
            await expectEvent.not.inTransaction(
                this.receipt.tx,
                this.stakingContract,
                'SnapshotUpdated');
        });
    });

    describe("Current cycle", function () {
        before(doFreshDeploy);
        before(start());

        it("must equal 1 within the 1st day", async function () {
            await time.increase(1);
            const cycle = await this.stakingContract.getCurrentCycle();
            cycle.toNumber().should.be.equal(1);
        });

        it("must equal 8 within the 8th day", async function () {
            await time.increase(DayInSeconds * 7);
            const cycle = await this.stakingContract.getCurrentCycle();
            cycle.toNumber().should.be.equal(8);
        });

        it("must equal n within the nth day", async function () {
            let cycle = await this.stakingContract.getCurrentCycle();
            const nthCycle = 30;
            const cyclesToAdvance = nthCycle - cycle.toNumber();
            await time.increase(DayInSeconds * cyclesToAdvance);
            cycle = await this.stakingContract.getCurrentCycle();
            cycle.toNumber().should.be.equal(nthCycle);
        });
    });

    describe("Current period", function () {
        beforeEach(doFreshDeploy);
        beforeEach(start());

        it("must equal 1 within the 1st day of period", async function () {
            await time.increase(1);
            const period = await this.stakingContract.getCurrentPayoutPeriod();
            period.toNumber().should.be.equal(1);
        });

        it("must equal 1 on last day of period", async function () {
            await time.increase(PeriodLengthInSeconds - 10);
            const period = await this.stakingContract.getCurrentPayoutPeriod();
            period.toNumber().should.be.equal(1);
        });

        it("must equal 2 within the 2nd period", async function () {
            await time.increase(PeriodLengthInSeconds);
            const period = await this.stakingContract.getCurrentPayoutPeriod();
            period.toNumber().should.be.equal(2);
        });

        it("must equal n within the nth period", async function () {
            let period = await this.stakingContract.getCurrentPayoutPeriod();
            const nthPeriod = 3;
            const periodsToAdvance = nthPeriod - period.toNumber();
            await time.increase(PeriodLengthInSeconds * periodsToAdvance);
            period = await this.stakingContract.getCurrentPayoutPeriod();
            period.toNumber().should.be.equal(nthPeriod);
        });
    });

    describe("Staking functionality", function () {
        describe("stakeNft", function () {
            before(doFreshDeploy);
            before(start());

            it("must fail if NFT staked from invalid NFT contract", async function () {
                const nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });
                const nft = CarNFTs[0];
                await nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                await expectRevert(
                    nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker }),
                    "NftStaking: Caller is not the whitelisted NFT contract"
                );
            });

            it("must fail if batch NFT staked from invalid NFT contract", async function () {
                const nftContract = await AssetsInventory.new(NFCollectionMaskLength, { from: creator });
                for (const nft of CarNFTs) {
                    await nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                }
                await expectRevert(
                    nftContract.safeBatchTransferFrom(
                        staker,
                        this.stakingContract.address,
                        CarNFTs.map(x => x.tokenId),
                        CarNFTs.map(x => 1),
                        EmptyByte,
                        { from: staker }
                    ),
                    "NftStaking: Caller is not the whitelisted NFT contract"
                );
            });

            describe("when single transfer is used", function () {
                before(doFreshDeploy);
                before(start());

                describe("must fail if non-car NFT type is staked", function () {
                    for (const nft of NonCarNFTs) {
                        it(`with type ${nft.type}`, async function () {
                            await expectRevert(
                                this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker }),
                                "NftStakingMock: wrong NFT type"
                            );
                        });
                    }
                });

                it("must stake Car NFTs", async function () {
                    this.receipts = [];

                    for (const nft of CarNFTs) {
                        const receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });
                        this.receipts.push(receipt);
                        (await this.nftContract.ownerOf(nft.tokenId)).should.be.equal(this.stakingContract.address);
                    }
                });

                it("must have snapshot stake of 111", async function () {
                    const snapshot = await this.stakingContract.getLatestSnapshot();
                    snapshot.stake.toNumber().should.be.equal(111);
                });

                it("must have stake of 111", async function () {
                    const stakerState = await this.stakingContract.stakerStates(staker);
                    stakerState.stake.toNumber().should.be.equal(111);
                });

                it("must have nextClaimableCycle == " + (1 + FreezePeriodInDays), async function () {
                    const stakerState = await this.stakingContract.stakerStates(staker);
                    stakerState.nextClaimableCycle.toNumber().should.be.equal(1 + FreezePeriodInDays);
                });

                it("must emit the SnapshotCreated event", async function () {
                    for (let index = 0; index < this.receipts.length; index++) {
                        const receipt = this.receipts[index];

                        if (index == 0) {
                            await expectEvent.inTransaction(
                                receipt.tx,
                                this.stakingContract,
                                'SnapshotCreated');
                        } else {
                            await expectEvent.not.inTransaction(
                                receipt.tx,
                                this.stakingContract,
                                'SnapshotCreated');
                        }
                    }
                });

                it("must emit the SnapshotUpdated event", async function () {
                    for (let index = 0; index < this.receipts.length; index++) {
                        const receipt = this.receipts[index];
                        await expectEvent.inTransaction(
                            receipt.tx,
                            this.stakingContract,
                            'SnapshotUpdated');
                    }
                });
            });

            describe("when batch transfer is used", function () {
                before(doFreshDeploy);
                before(start());

                it("must fail if non-car NFTs are staked", async function () {
                    await expectRevert(
                        this.nftContract.safeBatchTransferFrom(
                            staker,
                            this.stakingContract.address,
                            NonCarNFTs.map(x => x.tokenId),
                            NonCarNFTs.map(x => 1), EmptyByte,
                            { from: staker }
                        ),
                        "NftStakingMock: wrong NFT type"
                    );
                });

                it("must stake Car NFTs", async function () {
                    this.receipt = await this.nftContract.safeBatchTransferFrom(
                        staker,
                        this.stakingContract.address,
                        CarNFTs.map(x => x.tokenId),
                        CarNFTs.map(x => 1), EmptyByte,
                        { from: staker }
                    );

                    for (const nft of CarNFTs) {
                        (await this.nftContract.ownerOf(nft.tokenId)).should.be.equal(this.stakingContract.address);
                    }
                });

                it("must have snapshot stake of 111", async function () {
                    const snapshot = await this.stakingContract.getLatestSnapshot();
                    snapshot.stake.toNumber().should.be.equal(111);
                });

                it("must have stake == 111", async function () {
                    const stakerState = await this.stakingContract.stakerStates(staker);
                    stakerState.stake.toNumber().should.be.equal(111);
                });

                it("must have nextClaimableCycle == 2", async function () {
                    const stakerState = await this.stakingContract.stakerStates(staker);
                    stakerState.nextClaimableCycle.toNumber().should.be.equal(2);
                });

                it("must emit the SnapshotCreated event", async function () {
                    await expectEvent.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotCreated');
                });

                it("must emit the SnapshotUpdated event", async function () {
                    await expectEvent.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            });

            describe("when there are 3 periods have passed", function () {
                before(doFreshDeploy);
                before(start());

                const periodsToAdvance = 3;

                it("staker must have nextClaimableCycle == 0 before staking", async function () {
                    const stakerState = await this.stakingContract.stakerStates(staker);
                    stakerState.nextClaimableCycle.toNumber().should.be.equal(0);
                });

                it("must stake successfully", async function () {
                    await time.increase(PeriodLengthInSeconds * periodsToAdvance);
                    this.receipt = await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                });

                const targetDepositCycle = periodsToAdvance * 7 + 1 + FreezePeriodInDays;
                describe(`staker must have nextClaimableCycle == ${targetDepositCycle}`, function () {
                    it("immediately after staking", async function () {
                        const stakerState = await this.stakingContract.stakerStates(staker);
                        stakerState.nextClaimableCycle.toNumber().should.be.equal(targetDepositCycle);
                    });

                    it("after 2 additional periods after staking", async function () {
                        await time.increase(PeriodLengthInSeconds * 2);
                        const stakerState = await this.stakingContract.stakerStates(staker);
                        stakerState.nextClaimableCycle.toNumber().should.be.equal(targetDepositCycle);
                    });
                });

                it("must emit the SnapshotCreated event", async function () {
                    await expectEvent.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotCreated');
                });

                it("must emit the SnapshotUpdated event", async function () {
                    await expectEvent.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            });

            describe(`when staked Common and Epic NFTs with ${PeriodLengthInCycles.toNumber()} days difference`, async function () {
                beforeEach(doFreshDeploy);
                beforeEach(start());

                const secondsToAdvance = (PeriodLengthInSeconds * 4) + 1;

                it("must fail staking when divs are not claimed before 2nd stake", async function () {
                    this.transferFromReceipt = await this.nftContract.transferFrom(
                        staker,
                        this.stakingContract.address,
                        CarNFTs.filter(x => x.rarity == CarRarities.Common)[0].tokenId,
                        { from: staker }
                    );
                    await time.increase(secondsToAdvance);
                    await expectRevert(
                        this.nftContract.transferFrom(
                            staker,
                            this.stakingContract.address,
                            CarNFTs.filter(x => x.rarity == CarRarities.Epic)[0].tokenId,
                            { from: staker }
                        ),
                        "NftStaking: Rewards are not claimed"
                    );
                });

                it("must emit the SnapshotUpdated event for the 1st stake", async function () {
                    await expectEvent.inTransaction(
                        this.transferFromReceipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });

                it("must able to stake 2 NFTs when divs are claimed before 2nd stake", async function () {
                    this.transferFromReceipt1 = await this.nftContract.transferFrom(
                        staker,
                        this.stakingContract.address,
                        CarNFTs.filter(x => x.rarity == CarRarities.Common)[0].tokenId,
                        { from: staker }
                    );
                    await time.increase(secondsToAdvance);
                    let nextClaimableCycles = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                    await this.stakingContract.claimRewards(nextClaimableCycles[1], { from: staker });
                    this.transferFromReceipt2 = await this.nftContract.transferFrom(
                        staker,
                        this.stakingContract.address,
                        CarNFTs.filter(x => x.rarity == CarRarities.Epic)[0].tokenId,
                        { from: staker }
                    );
                });

                it("must emit the SnapshotUpdated event for the 1st stake", async function () {
                    await expectEvent.inTransaction(
                        this.transferFromReceipt1.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });

                it("must emit the SnapshotUpdated event for the 2nd stake", async function () {
                    await expectEvent.inTransaction(
                        this.transferFromReceipt2.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            });
        });
    });

    describe("Unclaimed periods", function () {
        describe("before staking", function () {
            before(doFreshDeploy);
            before(start());

            it("must equal 0,0 within the 1st period", async function () {
                await time.increase(1);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(0);
                periods[1].toNumber().should.be.equal(0);
            });

            it("must equal 0,0 within the 2nd period", async function () {
                await time.increase(PeriodLengthInSeconds);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(0);
                periods[1].toNumber().should.be.equal(0);
            });

            it("must equal 0,0 within the nth period", async function () {
                const currentCycle = await this.stakingContract.getCurrentCycle();
                const nthCycle = 10;
                const additonalCyclesToAdvance = nthCycle - currentCycle.toNumber();
                await time.increase(PeriodLengthInSeconds * additonalCyclesToAdvance);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(0);
                periods[1].toNumber().should.be.equal(0);
            });
        });

        describe("after staking 1 nft", function () {
            before(doFreshDeploy);
            before(start());

            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
            });

            it("must equal 1,0 within the 1st period", async function () {
                await time.increase(1);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(1);
                periods[1].toNumber().should.be.equal(0);
            });

            it("must equal 1,1 within the 2nd period", async function () {
                await time.increase(PeriodLengthInSeconds);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(1);
                periods[1].toNumber().should.be.equal(1);
            });

            it("must equal 1,n-1 within the nth period", async function () {
                const currentCycle = await this.stakingContract.getCurrentPayoutPeriod();
                const nthCycle = 3;
                const additonalCyclesToAdvance = nthCycle - currentCycle.toNumber();
                await time.increase(PeriodLengthInSeconds * additonalCyclesToAdvance);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(1);
                periods[1].toNumber().should.be.equal(nthCycle - 1);
            });

            it("must equal 1,n-1 within the (n + 1)th period", async function () {
                const currentCycle = await this.stakingContract.getCurrentPayoutPeriod();
                const nthCycle = 3 + 1;
                const additonalCyclesToAdvance = nthCycle - currentCycle.toNumber();
                await time.increase(PeriodLengthInSeconds * additonalCyclesToAdvance);
                const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                periods[0].toNumber().should.be.equal(1);
                periods[1].toNumber().should.be.equal(nthCycle - 1);
            });
        });

        describe("start unclaimed period after staking", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());

            function testUnclaimedPayoutPeriodsAfterPayoutperiods(periodsElapsedBefore, periodsElapsedAfter, periodsToClaim) {
                describe(`when ${periodsToClaim} periods are claimed`, function () {
                    const periods0 = periodsElapsedBefore + Math.min(periodsToClaim + 1, periodsElapsedAfter + 1);
                    const periods1 = periodsElapsedBefore + periodsElapsedAfter + 1 - periods0;

                    it(`should have ${periods0}, ${periods1} unclaimed periods`, async function () {
                        await this.stakingContract.claimRewards(periodsToClaim, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(periods0);
                        periods[1].toNumber().should.be.equal(periods1);
                        true.should.be.true;
                    });
                });
            }

            function testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedAfter(periodsElapsedBefore, periodsElapsedAfter) {
                describe(`after ${periodsElapsedAfter} periods have passed after staking`, function () {
                    beforeEach(async function () {
                        await time.increase(PeriodLengthInSeconds * periodsElapsedAfter);
                    });

                    testUnclaimedPayoutPeriodsAfterPayoutperiods(periodsElapsedBefore, periodsElapsedAfter, 0);
                    testUnclaimedPayoutPeriodsAfterPayoutperiods(periodsElapsedBefore, periodsElapsedAfter, 1);
                    testUnclaimedPayoutPeriodsAfterPayoutperiods(periodsElapsedBefore, periodsElapsedAfter, 2);
                });
            }

            function testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedBefore(periodsElapsedBefore) {
                describe(`after ${periodsElapsedBefore} periods have passed before staking`, function () {
                    beforeEach(async function () {
                        await time.increase(PeriodLengthInSeconds * periodsElapsedBefore);
                        await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                    });

                    testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedAfter(periodsElapsedBefore, 0);
                    testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedAfter(periodsElapsedBefore, 1);
                    testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedAfter(periodsElapsedBefore, 2);
                });
            }

            testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedBefore(0);
            testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedBefore(1);
            testUnclaimedPayoutPeriodsAfterPayoutPeriodsPassedBefore(3);
        });

        describe("start unclaimed period after staking", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());

            beforeEach(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
            });

            describe("after a total of 4 nfts have been staked, separated by a period", function () {
                const nfts = [
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                ];

                beforeEach(async function () {
                    for (let index = 0; index < 3; ++index) {
                        await time.increase(PeriodLengthInSeconds);
                        await this.nftContract.mintNonFungible(otherAccounts[index], nfts[index].tokenId, { from: creator });
                        await this.nftContract.transferFrom(
                            otherAccounts[index],
                            this.stakingContract.address,
                            nfts[index].tokenId,
                            { from: otherAccounts[index] }
                        );
                    }
                });

                describe("when divs were not claimed", function () {
                    it("must be 1,3", async function () {
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(1);
                        periods[1].toNumber().should.be.equal(3);
                    });
                });

                describe("when divs for 1 period were claimed", function () {
                    it("must be 2,2", async function () {
                        await this.stakingContract.claimRewards(1, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(2);
                        periods[1].toNumber().should.be.equal(2);
                    });
                });

                describe("when divs for 2 periods were claimed", function () {
                    it("must be 3,1", async function () {
                        await this.stakingContract.claimRewards(2, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(3);
                        periods[1].toNumber().should.be.equal(1);
                    });
                });

                describe("when divs for 3 periods were claimed", function () {
                    it("must be 4,0", async function () {
                        await this.stakingContract.claimRewards(3, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(4);
                        periods[1].toNumber().should.be.equal(0);
                    });
                });

                describe("when divs for 4 periods were claimed", function () {
                    it("must be 4,0", async function () {
                        await this.stakingContract.claimRewards(4, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(4);
                        periods[1].toNumber().should.be.equal(0);
                    });
                });
            });
        });
    });

    describe("Claim rewards", function () {
        describe("when staked during last day.", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());
            beforeEach(async function () {
                await time.increase(PeriodLengthInSeconds - DayInSeconds);
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                await time.increase(DayInSeconds);
            });

            it("must not claim any rewards next day", shouldClaimDivs(100, 0, staker, false));
        });

        describe("with default initial token distribution", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());

            describe("when staker account stakes first and then another account stakes 1 period later.", function () {
                beforeEach(async function () {
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                    await time.increase(PeriodLengthInSeconds);

                    const newNFt = createTestNft(CarRarities.Common, Types.Car);
                    await this.nftContract.mintNonFungible(otherAccounts[0], newNFt, { from: creator });

                    await this.nftContract.transferFrom(otherAccounts[0], this.stakingContract.address, newNFt, { from: otherAccounts[0] });
                    await time.increase(PeriodLengthInSeconds);
                });

                it("must have 0 unclaimed period left after attempt to claim more periods than user currently has", async function () {
                    await shouldClaimDivs(100, 10000, staker, true).call(this);

                    const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                    periods[0].toNumber().should.be.equal(3);
                    periods[1].toNumber().should.be.equal(0);
                });

                it("must revert after attempt to claim negative periods (overflow)", async function () {
                    await expectRevert(shouldClaimDivs(-1, 10000, staker, true).call(this), "SafeMath: addition overflow");
                });

                describe("when 1 period was claimed", function () {
                    it("staker account must unstake 6000 tokens", shouldClaimDivs(1, 6000, staker, true));

                    it("must have 1 unclaimed period left after ", async function () {
                        this.receipt = await this.stakingContract.claimRewards(1, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(2);
                        periods[1].toNumber().should.be.equal(1);
                    });

                    it("must not emit the SnapshotUpdated event", async function () {
                        await expectEvent.not.inTransaction(
                            this.receipt.tx,
                            this.stakingContract,
                            'SnapshotUpdated');
                    });
                });

                describe("when 2 periods were claimed", function () {
                    it("staker account must unstake 10000 tokens", shouldClaimDivs(2, 10000, staker, true));

                    it("must have 0 unclaimed period left after 2 periods claimed", async function () {
                        this.receipt = await this.stakingContract.claimRewards(2, { from: staker });
                        const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                        periods[0].toNumber().should.be.equal(3);
                        periods[1].toNumber().should.be.equal(0);
                    });

                    it("must not emit the SnapshotUpdated event", async function () {
                        await expectEvent.not.inTransaction(
                            this.receipt.tx,
                            this.stakingContract,
                            'SnapshotUpdated');
                    });
                });
            });

            describe("when there are 3 deposits within 1 period", function () {
                beforeEach(doFreshDeploy);
                beforeEach(start());
                beforeEach(async function () {
                    const nfts = [
                        { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                        { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                        { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                    ];

                    // mint new nfts and stake
                    for (let nft of nfts) {
                        await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                        await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });
                        await time.increase(DayInSeconds);
                    }

                    // ensure all staked nfts are not frozen
                    await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());
                });

                it("must claim 1 period", async function () {
                    this.receipt = await this.stakingContract.claimRewards(1, { from: staker });

                    const periods = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                    periods[0].toNumber().should.be.equal(1);
                    periods[1].toNumber().should.be.equal(0);
                });

                it("must not emit the SnapshotUpdated event", async function () {
                    await expectEvent.not.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            });
        });

        describe("when staked and 1000 periods passed", async () => {
            const PayoutSchedule = [
                { startPeriod: 1, endPeriod: 100, rewardPerCycle: 10 },
                { startPeriod: 101, endPeriod: 200, rewardPerCycle: 10 },
                { startPeriod: 201, endPeriod: 300, rewardPerCycle: 10 },
                { startPeriod: 301, endPeriod: 400, rewardPerCycle: 10 },
                { startPeriod: 401, endPeriod: 500, rewardPerCycle: 10 },
                { startPeriod: 501, endPeriod: 600, rewardPerCycle: 10 },
                { startPeriod: 601, endPeriod: 700, rewardPerCycle: 10 },
                { startPeriod: 701, endPeriod: 800, rewardPerCycle: 10 },
                { startPeriod: 801, endPeriod: 900, rewardPerCycle: 10 },
                { startPeriod: 901, endPeriod: 1000, rewardPerCycle: 10 }
            ];

            before(doFreshDeploy);
            before(start(PayoutSchedule));
            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                await time.increase(PeriodLengthInSeconds * 1000);
            })

            function testUnclaimedPeriods(startPeriod, amount) {
                it(`must have ${amount} unclaimed periods from period #${startPeriod}`, async function () {
                    // await debug_state.call(this, staker);
                    const upp = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                    upp[0].toNumber().should.be.equal(startPeriod);
                    upp[1].toNumber().should.be.equal(amount);
                });
            }

            it("must claim 60 tokens when claimed 1 period", shouldClaimDivs(1, 60, staker, true));
            testUnclaimedPeriods(2, 999);

            it("must claim 210 tokens when claimed 3 more periods", shouldClaimDivs(3, 210, staker, true));
            testUnclaimedPeriods(5, 996);

            it("must claim 700 tokens when claimed 10 more periods", shouldClaimDivs(10, 700, staker, true));
            testUnclaimedPeriods(15, 986);
        });
    });

    describe("unstakeNft", function () {
        describe("when 1 NFT (Common) is staked", async function () {
            before(doFreshDeploy);
            before(start());

            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
            });

            it("must fail to unstake NFT staked by different account", async function () {
                await expectRevert(this.stakingContract.unstakeNft(CarNFTs[0].tokenId, { from: otherAccounts[0] }), "NftStaking: Token owner doesn't match or token was already unstaken before");
            });

            it("must fail to unstake within frozen period", async function () {
                await expectRevert(this.stakingContract.unstakeNft(CarNFTs[0].tokenId, { from: staker }), "NftStaking: Staking freeze duration has not yet elapsed");
            });

            it("must able to unstake right after frozen period", async function () {
                await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());
                this.receipt = await this.stakingContract.unstakeNft(CarNFTs[0].tokenId, { from: staker });
            });

            it("must emit the SnapshotUpdated event", async function () {
                await expectEvent.inTransaction(
                    this.receipt.tx,
                    this.stakingContract,
                    'SnapshotUpdated');
            });
        });

        describe("when 2 NFTs (Common, Epic) are staked with 1 day difference", function () {
            before(doFreshDeploy);
            before(start());

            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                await time.increase(DayInSeconds * 1);
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[1].tokenId, { from: staker });
                await time.increase(FreezePeriodInSeconds.toNumber() - DayInSeconds + 1);
            });

            it("must able to unstake 1st NFT after freeze period passed", async function () {
                this.receipt = await this.stakingContract.unstakeNft(CarNFTs[0].tokenId, { from: staker });
            });

            it("must emit the SnapshotUpdated event", async function () {
                await expectEvent.inTransaction(
                    this.receipt.tx,
                    this.stakingContract,
                    'SnapshotUpdated');
            });

            it("must fail to unstake 2nd NFT", async function () {
                await expectRevert(
                    this.stakingContract.unstakeNft(CarNFTs[1].tokenId, { from: staker }),
                    "NftStaking: Staking freeze duration has not yet elapsed"
                );
            });

            it("must able to unstake 2nd NFTs after 1 more freeze period passed", async function () {
                await time.increase(FreezePeriodInSeconds.toNumber() + 1);
                this.receipt = await this.stakingContract.unstakeNft(CarNFTs[1].tokenId, { from: staker });
            });

            it("must emit the SnapshotUpdated event", async function () {
                await expectEvent.inTransaction(
                    this.receipt.tx,
                    this.stakingContract,
                    'SnapshotUpdated');
            });
        });

        describe("when 2 NFTs (Common and Epic) are staked from different accounts and there are 7 days between stakes", function () {
            before(doFreshDeploy);
            before(start());

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic }
            ];

            before(async function () {
                // mint new nfts and stake
                let nftIndex = 0;
                for (let nft of nfts) {
                    const userAddr = otherAccounts[nftIndex++];
                    await this.nftContract.mintNonFungible(userAddr, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(userAddr, this.stakingContract.address, nft.tokenId, { from: userAddr });
                    await time.increase(PeriodLengthInSeconds);
                }
            });

            it("must fail to unstake 1st NFT (Common) without claiming", async function () {
                await expectRevert(
                    this.stakingContract.unstakeNft(nfts[0].tokenId, { from: otherAccounts[0] }),
                    "NftStaking: Rewards are not claimed"
                );
            });

            it("must fail to unstake 2nd NFT (Epic) without claiming", async function () {
                await expectRevert(
                    this.stakingContract.unstakeNft(nfts[1].tokenId, { from: otherAccounts[1] }),
                    "NftStaking: Rewards are not claimed"
                );
            });
        });

        function testStakingState(staker, tokenId, stake, snapshots, expectUpdateSnapshotEvent) {
            it("must unstake", async function () {
                let unclaimedDivsLeft = await this.stakingContract.getUnclaimedPayoutPeriods({ from: staker });
                await this.stakingContract.claimRewards(unclaimedDivsLeft[1], { from: staker });
                this.receipt = await this.stakingContract.unstakeNft(tokenId, { from: staker });
            });

            it(`must have stake == ${stake}`, async function () {
                const stakerState = await this.stakingContract.stakerStates(staker);
                stakerState.stake.toNumber().should.be.equal(stake);
            });

            let ssIndex = 0;
            for (const ss of snapshots) {
                const i = ssIndex;
                it(`must have snapshot #${i} stake == ${ss}`, async function () {
                    const snapshot = await this.stakingContract.snapshots(i);
                    snapshot.stake.toNumber().should.be.equal(ss);
                });
                ssIndex++;
            }

            if (expectUpdateSnapshotEvent) {
                it("must emit the SnapshotUpdated event", async function () {
                    await expectEvent.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            } else {
                it("must not emit the SnapshotUpdated event", async function () {
                    await expectEvent.not.inTransaction(
                        this.receipt.tx,
                        this.stakingContract,
                        'SnapshotUpdated');
                });
            }
        }

        function testMultiplyStakesFromSameAccountWithinSamePayoutPeriod(daysToSkip, daysBetweenStakes) {
            before(doFreshDeploy);
            before(start());

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic },
                { tokenId: createTestNft(CarRarities.Apex, Types.Car), rarity: CarRarities.Apex },
            ];

            before(async function () {
                if (daysToSkip > 0) {
                    await time.increase(DayInSeconds * daysToSkip);
                }

                // mint new nfts and stake
                for (let nft of nfts) {
                    await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });
                    await time.increase(daysBetweenStakes * DayInSeconds);
                }

                // ensure all staked nfts are not frozen
                await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());
            });

            // since freeze time is 24 hours long, stake increase will happen only for the next day

            describe("unstake 1st NFT (Common), update staker state and snapshot", function () {
                testStakingState(staker, nfts[0].tokenId, 110, [0, 10, 110], true);
            });

            describe("unstake 2nd NFT (Epic), update staker state and snapshot", function () {
                testStakingState(staker, nfts[1].tokenId, 100, [0, 0, 100], true);
            });

            describe("unstake 3rd NFT (Apex), update staker state and snapshot", function () {
                testStakingState(staker, nfts[2].tokenId, 0, [0, 0, 0], true);
            });
        }

        describe("all NFTs are staked within 1 period with 1 day difference from same staker. 0 days skipped.", async function () {
            testMultiplyStakesFromSameAccountWithinSamePayoutPeriod(0, 1);
        });

        describe("all NFTs are staked within 1 period with 1 day difference from same staker. 1 period is skipped.", async function () {
            testMultiplyStakesFromSameAccountWithinSamePayoutPeriod(PeriodLengthInCycles.toNumber(), 1);
        });

        function testMultiplyStakesFromSameAccountAcrossSeveralPayoutPeriods(daysToSkip, daysBetweenStakes, ...weights) {
            before(doFreshDeploy);
            // TODO there is a bug here when using a non-empty schedule: rewards go too high
            before(start([]));

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic },
                { tokenId: createTestNft(CarRarities.Apex, Types.Car), rarity: CarRarities.Apex },
            ];

            before(async function () {
                if (daysToSkip > 0) {
                    await time.increase(DayInSeconds * daysToSkip);
                }

                let nftIndex = 0;
                let daysPassed = daysToSkip;
                const periodInDays = PeriodLengthInCycles.toNumber();
                // mint new nfts and stake
                for (let nft of nfts) {
                    await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });

                    if (nftIndex++ < nfts.length - 1) {
                        await time.increase(DayInSeconds * daysBetweenStakes);
                        daysPassed += daysBetweenStakes;
                    }

                    while (daysPassed >= periodInDays) {
                        daysPassed -= periodInDays;
                        const estimationResult = await this.stakingContract.estimateRewards(1, { from: staker });
                        console.log(`${estimationResult}`);
                        // await debug_PrintAllSnapshots.call(this);
                        // await debug_Cycles.call(this, staker);
                        // await debug_state.call(this, staker);
                        await this.stakingContract.claimRewards(1, { from: staker });
                    }
                }

                await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());

                // await debug_PrintAllSnapshots.call(this);
            });

            describe("unstake 1st NFT (Common), update staker state and snapshot", function () {
                testStakingState(staker, nfts[0].tokenId, 110, weights[0], true);
            });

            describe("unstake 2nd NFT (Epic), update staker state and snapshot", function () {
                testStakingState(staker, nfts[1].tokenId, 100, weights[1], true);
            });

            describe("unstake 3rd NFT (Apex), update staker state and snapshot", function () {
                testStakingState(staker, nfts[2].tokenId, 0, weights[2], true);
            });
        }

        describe("all NFTs are staked within 2 periods with 5 days difference from same staker. 0 days skipped.", async function () {
            testMultiplyStakesFromSameAccountAcrossSeveralPayoutPeriods(0, 5, [1, 11, 10, 110], [1, 11, 0, 100], [1, 11, 0, 0]);
        });

        describe("all NFTs are staked within 2 periods with 5 days difference from same staker. 2 days skipped.", async function () {
            testMultiplyStakesFromSameAccountAcrossSeveralPayoutPeriods(2, 5, [1, 0, 10, 110], [1, 0, 0, 100], [1, 0, 0, 0]);
        });

        describe("all NFTs are staked within 2 periods with 5 days difference from same staker. 7 days skipped.", async function () {
            testMultiplyStakesFromSameAccountAcrossSeveralPayoutPeriods(7, 5, [1, 11, 10, 110], [1, 11, 0, 100], [1, 11, 0, 0]);
        });

        function testMultiplyStakesFromDifferentAccountsAcrossSeveralPayoutPeriods(daysToSkip, daysBetweenStakes, ...weights) {
            before(doFreshDeploy);
            // TODO there is a bug here when using a non-empty schedule: rewards go too high
            before(start([]));

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic },
                { tokenId: createTestNft(CarRarities.Apex, Types.Car), rarity: CarRarities.Apex },
            ];

            before(async function () {
                if (daysToSkip > 0) {
                    await time.increase(DayInSeconds * daysToSkip);
                }

                let nftIndex = 0;
                // mint new nfts and stake
                for (let nft of nfts) {
                    const userAddr = otherAccounts[nftIndex];
                    await this.nftContract.mintNonFungible(userAddr, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(userAddr, this.stakingContract.address, nft.tokenId, { from: userAddr });

                    if (nftIndex++ < nfts.length - 1) {
                        await time.increase(DayInSeconds * daysBetweenStakes);
                    }
                }

                await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());
            });

            describe("unstake 1st NFT (Common), update staker state and snapshot", function () {
                testStakingState(otherAccounts[0], nfts[0].tokenId, 0, weights[0], true);
            });

            describe("unstake 2nd NFT (Epic), update staker state and snapshot", function () {
                testStakingState(otherAccounts[1], nfts[1].tokenId, 0, weights[1], true);
            });

            describe("unstake 3rd NFT (Apex), update staker state and snapshot", function () {
                testStakingState(otherAccounts[2], nfts[2].tokenId, 0, weights[2], true);
            });
        }

        describe("all NFTs are staked within 2 periods with 5 days difference from different accounts. 0 days skipped.", async function () {
            testMultiplyStakesFromDifferentAccountsAcrossSeveralPayoutPeriods(0, 5, [1, 11, 10, 110], [1, 11, 0, 100], [1, 11, 0, 0]);
        });

        describe("all NFTs are staked within 2 periods with 5 days difference from different accounts. 2 days skipped.", async function () {
            testMultiplyStakesFromDifferentAccountsAcrossSeveralPayoutPeriods(2, 5, [1, 0, 10, 110], [1, 0, 0, 100], [1, 0, 0, 0]);
        });

        describe("all NFTs are staked within 2 periods with 5 days difference from different accounts. 7 days skipped.", async function () {
            testMultiplyStakesFromDifferentAccountsAcrossSeveralPayoutPeriods(7, 5, [1, 11, 10, 110], [1, 11, 0, 100], [1, 11, 0, 0]);
        });
    });

    describe("rewards snapshots", async function () {
        const pp = PeriodLengthInCycles.toNumber();

        describe(`when 3 NFTs (Common) were staked. ${pp} days between stakes. From same staker.`, async function () {
            before(doFreshDeploy);
            // TODO there is a bug here when using a non-empty schedule: rewards go too high
            before(start([]));

            const nfts = [];
            for (let i = 0; i < 3; ++i) {
                nfts.push({ tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common });
            }

            before(async function () {
                let index = 0;
                for (const nft of nfts) {
                    await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });
                    await time.increase(PeriodLengthInSeconds);

                    if (index++ < nfts.length - 1) {
                        await this.stakingContract.claimRewards(1, { from: staker });
                    }
                }
            });

            describe(`snapshot #0`, function () {
                before(async function () {
                    this.snapshot = await this.stakingContract.snapshots(0);
                });

                testSnapshot(2, 7, 1, 0);
            });

            describe(`snapshot #1`, function () {
                before(async function () {
                    this.snapshot = await this.stakingContract.snapshots(1);
                });

                testSnapshot(8, 8, 1, 0);
            });

            describe(`snapshot #2`, function () {
                before(async function () {
                    this.snapshot = await this.stakingContract.snapshots(2);
                });

                testSnapshot(9, 14, 2, 0);
            });

            describe(`snapshot #3`, function () {
                before(async function () {
                    this.snapshot = await this.stakingContract.snapshots(3);
                });

                testSnapshot(15, 15, 2, 0);
            });

            describe(`snapshot #4`, function () {
                before(async function () {
                    this.snapshot = await this.stakingContract.snapshots(4);
                });

                testSnapshot(16, 16, 3, 0);
            });
        });

        describe(`searching (7 NFTs, ${pp} days between stakes.)`, async function () {
            before(doFreshDeploy);
            // TODO there is a bug here when using a non-empty schedule: rewards go too high
            before(start([]));

            const nftsCount = 7;
            const nfts = [];
            for (let i = 0; i < nftsCount; ++i) {
                nfts.push({ tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common });
            }

            before(async function () {
                // mint new nfts and stake
                let nftIndex = 0;
                for (let nft of nfts) {
                    await this.nftContract.mintNonFungible(staker, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });

                    if (nftIndex++ < nfts.length - 1) {
                        await time.increase(PeriodLengthInSeconds);
                        await this.stakingContract.claimRewards(1, { from: staker });
                    }
                }
            });

            it("must return 0 snapshotIndex when searched period is too small", async function () {
                const searchResult = await this.stakingContract.rewardsSnapshot(0);
                searchResult.snapshotIndex.toNumber().should.be.equal(0);
            });

            it(`must return ${nftsCount * 2 - 2} snapshotIndex when searched period is too big`, async function () {
                const searchResult = await this.stakingContract.rewardsSnapshot(999);
                searchResult.snapshotIndex.toNumber().should.be.equal((nftsCount - 1) * 2);
            });

            for (let i = 0; i < nftsCount; ++i) {
                it(`must return ${i * 2} snapshotIndex when searched for period #${i + 1}`, async function () {
                    let searchResult = await this.stakingContract.rewardsSnapshot((i + 1) * pp);
                    searchResult.snapshotIndex.toNumber().should.be.equal(i * 2);
                });
            }
        });
    });

    function shouldClaimDivs(divsToClaim, expectClaimed, from, _expectClaimRewardsEvent, _expectSnapshotUpdatedEvent) {
        var should = require('chai').should();
        return async function () {
            // estimate max here
            // await debug_PrintAllSnapshots.call(this);
            // await debug_Cycles.call(this, staker);
            // await debug_state.call(this, staker);
            const estimationResult = await this.stakingContract.estimateRewards(divsToClaim, { from });
            let receipt = await this.stakingContract.claimRewards(divsToClaim, { from });

            if (_expectClaimRewardsEvent) {
                await expectEvent(receipt, RewardsClaimedEvent, {
                    staker: from,
                    amount: new BN(expectClaimed)
                });

                if (expectClaimed !== null) {
                    estimationResult.amount.toNumber().should.be.equal(expectClaimed);
                }
            } else {
                should.equal(receipt.logs.find(e => e.event === RewardsClaimedEvent), undefined, "Didn't expect event " + RewardsClaimedEvent);
            }

            if (_expectSnapshotUpdatedEvent) {
                await expectEvent.inTransaction(
                    receipt.tx,
                    this.stakingContract,
                    'SnapshotUpdated');
            } else {
                await expectEvent.not.inTransaction(
                    receipt.tx,
                    this.stakingContract,
                    'SnapshotUpdated');
            }
        }
    }

    describe("claimRewards", function () {
        describe("when there are NFTs staked and 3 periods passed.", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());
            beforeEach(async function () {
                for (const nft of CarNFTs) {
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, nft.tokenId, { from: staker });
                }

                await time.increase(PeriodLengthInSeconds * 3);
            });

            it("must claim divs when claimed too many (9999) periods", shouldClaimDivs(9999, 20000, staker, true));
            it("must not claim any divs when claimed nothing", shouldClaimDivs(0, 0, staker, false));
            it("must claim 1 period only 1 period is requested to be claimed", shouldClaimDivs(1, 6000, staker, true));
            it("must claim divs when all periods are claimed", shouldClaimDivs(3, 20000, staker, true));
        });

        describe("when there are no NFT staked", function () {
            beforeEach(doFreshDeploy);
            beforeEach(start());

            it("must not claim when claimed too many (9999) periods", shouldClaimDivs(9999, 0, staker, false));
            it("must not claim when claimed nothing", shouldClaimDivs(0, 0, staker, false));
            it("must not claim when only 1 period is claimed", shouldClaimDivs(1, 0, staker, false));
            it("must not claim when all periods are claimed at once", shouldClaimDivs(3, 0, staker, false));
        });
    });

    describe("estimateRewards", function () {
        function shouldEstimate(amount, start, count) {
            it(`must estimate ${amount} between [${start}, ${start + count - 1}] periods`, async function () {
                // await debug_PrintAllSnapshots.call(this);
                // await debug_Cycles.call(this, staker);
                // await debug_state.call(this, staker);
                const estimation = await this.stakingContract.estimateRewards(count, { from: staker });
                estimation.amount.toNumber().should.be.equal(amount);
            });
        }

        describe("when staked 1st day. 3 more stakes follows. 1 period between each following stake.", function () {
            before(doFreshDeploy);
            before(start());

            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });

                const nfts = [
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                    { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                ];

                for (let index = 0; index < 3; ++index) {
                    await time.increase(PeriodLengthInSeconds);
                    await this.nftContract.mintNonFungible(otherAccounts[index], nfts[index].tokenId, { from: creator });
                    await this.nftContract.transferFrom(
                        otherAccounts[index],
                        this.stakingContract.address,
                        nfts[index].tokenId,
                        { from: otherAccounts[index] }
                    );
                }

                await time.increase(PeriodLengthInSeconds);
            });


            shouldEstimate(6000, 1, 1);
            shouldEstimate(4000, 2, 1);
            shouldEstimate(2499, 3, 1);
        });
    });

    describe("Rewards", function () {
        function testClaimAndEstimation(divsToClaim, expectedAmount, from, _expectClaimRewardsEvent, _expectSnapshotUpdatedEvent) {
            if (_expectClaimRewardsEvent) {
                it(
                    `must estimate and claim ${expectedAmount} tokens when ${divsToClaim} period(s) claimed`,
                    shouldClaimDivs(divsToClaim, expectedAmount, from, _expectClaimRewardsEvent, _expectSnapshotUpdatedEvent)
                );
            } else {
                it("must not claim rewards", shouldClaimDivs(divsToClaim, expectedAmount, from, _expectClaimRewardsEvent, _expectSnapshotUpdatedEvent));
            }
        }

        describe(`when claimed after 4 periods passed.`, function () {
            describe("when staked on day 1", function () {
                const PayoutSchedule = [
                    { startPeriod: 1, endPeriod: 1, rewardPerCycle: 10000 },
                    { startPeriod: 2, endPeriod: 2, rewardPerCycle: 1000 },
                    { startPeriod: 3, endPeriod: 3, rewardPerCycle: 100 },
                    { startPeriod: 4, endPeriod: 4, rewardPerCycle: 10 }
                ];

                before(doFreshDeploy);
                before(start(PayoutSchedule));

                before(async function () {
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                    await time.increase(PeriodLengthInSeconds * 4);
                });

                it("must have 1 snapshot", async function () {
                    const total = await this.stakingContract.totalSnapshots();
                    total.toNumber().should.be.equal(1);
                });

                testClaimAndEstimation(1, 60000, staker, true);
                testClaimAndEstimation(1, 7000, staker, true);
                testClaimAndEstimation(1, 700, staker, true);
                testClaimAndEstimation(1, 70, staker, true);
            });

            describe("when staked on the 3rd day", function () {
                const PayoutSchedule = [
                    { startPeriod: 1, endPeriod: 1, rewardPerCycle: 10000 },
                    { startPeriod: 2, endPeriod: 2, rewardPerCycle: 1000 },
                    { startPeriod: 3, endPeriod: 3, rewardPerCycle: 100 },
                    { startPeriod: 4, endPeriod: 4, rewardPerCycle: 10 }
                ];

                before(doFreshDeploy);
                before(start(PayoutSchedule));

                before(async function () {
                    await time.increase(DayInSeconds * 2);
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                    await time.increase(PeriodLengthInSeconds * 4);
                });

                it("must have 1 snapshot", async function () {
                    const total = await this.stakingContract.totalSnapshots();
                    total.toNumber().should.be.equal(1);
                });

                testClaimAndEstimation(1, 40000, staker, true);
                testClaimAndEstimation(1, 7000, staker, true);
                testClaimAndEstimation(1, 700, staker, true);
                testClaimAndEstimation(1, 70, staker, true);
            });

            describe("when staked on the day before the last day", function () {
                const PayoutSchedule = [
                    { startPeriod: 1, endPeriod: 1, rewardPerCycle: 10000 },
                    { startPeriod: 2, endPeriod: 2, rewardPerCycle: 1000 },
                    { startPeriod: 3, endPeriod: 3, rewardPerCycle: 100 },
                    { startPeriod: 4, endPeriod: 4, rewardPerCycle: 10 }
                ];

                before(doFreshDeploy);
                before(start(PayoutSchedule));

                before(async function () {
                    await time.increase(PeriodLengthInSeconds - DayInSeconds * 2);
                    await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                    await time.increase(PeriodLengthInSeconds * 4);
                });

                it("must have 1 snapshot", async function () {
                    const total = await this.stakingContract.totalSnapshots();
                    total.toNumber().should.be.equal(1);
                });

                testClaimAndEstimation(1, 10000, staker, true);
                testClaimAndEstimation(1, 7000, staker, true);
                testClaimAndEstimation(1, 700, staker, true);
                testClaimAndEstimation(1, 70, staker, true);
            });
        });

        describe("when 2 NFTs (Common) were staked from day 1 from 2 accounts and 1st was unstaken after the freeze period. ", function () {
            before(doFreshDeploy);
            before(start());

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common }
            ]

            before(async function () {
                await this.nftContract.mintNonFungible(otherAccounts[0], nfts[0].tokenId, { from: creator });
                await this.nftContract.transferFrom(otherAccounts[0], this.stakingContract.address, nfts[0].tokenId, { from: otherAccounts[0] });

                await this.nftContract.mintNonFungible(otherAccounts[1], nfts[1].tokenId, { from: creator });
                await this.nftContract.transferFrom(otherAccounts[1], this.stakingContract.address, nfts[1].tokenId, { from: otherAccounts[1] });

                await time.increase(FreezePeriodInSeconds.add(new BN(1)).toNumber());
                await this.stakingContract.unstakeNft(nfts[0].tokenId, { from: otherAccounts[0] });
                // advance to the end of the period
                await time.increase(PeriodLengthInSeconds - FreezePeriodInSeconds.toNumber() + 1);
            });

            it("must have 1 snapshot", async function () {
                const snapshots = await this.stakingContract.totalSnapshots();
                snapshots.toNumber().should.be.equal(1);
            });

            describe("when 1st account claimed divs", function () {
                testClaimAndEstimation(1, 0, otherAccounts[0], false);

                it("must have 0 tokens when divs were claimed", async function () {
                    (await this.rewardsToken.balanceOf(otherAccounts[0])).toString().should.be.equal("0");
                });
            });

            describe("when 2nd account claimed divs", function () {
                testClaimAndEstimation(1, 6000, otherAccounts[1], true);

                it("2nd account must have 6000 tokens when divs were claimed", async function () {
                    (await this.rewardsToken.balanceOf(otherAccounts[1])).toString().should.be.equal("6000");
                });
            });
        });

        describe("when 1 NFT (Common) was staked. 1 period passed before divs are claimed.", function () {
            before(doFreshDeploy);
            before(start());

            before(async function () {
                await this.nftContract.transferFrom(staker, this.stakingContract.address, CarNFTs[0].tokenId, { from: staker });
                await time.increase(PeriodLengthInSeconds + 100);
            });

            it("must have 1 snapshot", async function () {
                const snapshots = await this.stakingContract.totalSnapshots();
                snapshots.toNumber().should.be.equal(1);
            });

            it("must claim divs", shouldClaimDivs(1, 6000, staker, true));
        });

        describe("when 3 stakers claim within 1 period when staked for a whole period (Common, Epic, Apex)", function () {
            before(doFreshDeploy);
            before(start());

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic },
                { tokenId: createTestNft(CarRarities.Apex, Types.Car), rarity: CarRarities.Apex },
            ];

            before(async function () {
                // mint new nfts and stake
                let carIndex = 0;
                for (let nft of nfts) {
                    const userAddr = otherAccounts[carIndex++];
                    await this.nftContract.mintNonFungible(userAddr, nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(userAddr, this.stakingContract.address, nft.tokenId, { from: userAddr });
                }

                await time.increase(PeriodLengthInSeconds);
            });

            it("1st staker must have 54 tokens when Common car was claimed", async function () {
                await shouldClaimDivs(1, 54, otherAccounts[0], true).call(this);
                (await this.rewardsToken.balanceOf(otherAccounts[0])).toString().should.be.equal("54");
            });

            it("2nd staker must have 540 tokens when Common car was claimed", async function () {
                await shouldClaimDivs(1, 540, otherAccounts[1], true).call(this);
                (await this.rewardsToken.balanceOf(otherAccounts[1])).toString().should.be.equal("540");
            });

            it("3rd staker must have 5405 tokens when Common car was claimed", async function () {
                await shouldClaimDivs(1, 5405, otherAccounts[2], true).call(this);
                (await this.rewardsToken.balanceOf(otherAccounts[2])).toString().should.be.equal("5405");
            });
        });

        describe("2 stakers. 1st staker staked from day 1. 2nd staker staked after 1st period.", function () {
            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic }
            ];

            function prepareForTests() {
                before(doFreshDeploy);
                before(start());

                before(async function () {
                    // mint new nfts and stake
                    let carIndex = 0;
                    for (let nft of nfts) {
                        const userAddr = otherAccounts[carIndex];
                        await this.nftContract.mintNonFungible(userAddr, nft.tokenId, { from: creator });
                        await this.nftContract.transferFrom(userAddr, this.stakingContract.address, nft.tokenId, { from: userAddr });

                        if (carIndex == 0) {
                            await time.increase(PeriodLengthInSeconds);
                        }

                        carIndex++;
                    }
                });
            }

            describe("when 1 day passed after 1st period.", function () {
                prepareForTests();

                before(async function () {
                    // advance 1 day in the future to be able to claim divs
                    await time.increase(DayInSeconds);
                });

                it("1st staker (Common car) must have 6000 tokens after divs was claimed", async function () {
                    await shouldClaimDivs(1, 6000, otherAccounts[0], true).call(this);
                    (await this.rewardsToken.balanceOf(otherAccounts[0])).toString().should.be.equal("6000");
                });
            });

            describe("when 4 days passed after 1st period.", function () {
                prepareForTests();

                before(async function () {
                    // advance 1 day in the future to be able to claim divs
                    await time.increase(DayInSeconds * 4);
                });

                it("1st staker (Common car) must have 6000 tokens after divs was claimed", async function () {
                    await shouldClaimDivs(1, 6000, otherAccounts[0], true).call(this);
                    (await this.rewardsToken.balanceOf(otherAccounts[0])).toString().should.be.equal("6000");
                });
            });
        });

        describe("2 stakers, 1st stake at day 1, 2nd stake at day 3. (Common, Epic)", function () {
            before(doFreshDeploy);
            before(start());

            const nfts = [
                { tokenId: createTestNft(CarRarities.Common, Types.Car), rarity: CarRarities.Common },
                { tokenId: createTestNft(CarRarities.Epic, Types.Car), rarity: CarRarities.Epic }
            ];

            before(async function () {
                // mint new nfts and stake
                let index = 0;
                for (let nft of nfts) {
                    await this.nftContract.mintNonFungible(otherAccounts[index], nft.tokenId, { from: creator });
                    await this.nftContract.transferFrom(
                        otherAccounts[index],
                        this.stakingContract.address,
                        nft.tokenId,
                        { from: otherAccounts[index] }
                    );

                    if (index == 0) {
                        await time.increase(DayInSeconds * 2);
                    }

                    index++;
                }

                await time.increase(PeriodLengthInSeconds - DayInSeconds * 2);
            });

            it("must have 2 snapshots", async function () {
                const total = await this.stakingContract.totalSnapshots();
                total.toNumber().should.be.equal(2);
            });

            it("1st staker (Common car) must have 2363 tokens after divs was claimed", async function () {
                await shouldClaimDivs(1, 2363, otherAccounts[0], true).call(this);
                (await this.rewardsToken.balanceOf(otherAccounts[0])).toString().should.be.equal("2363");
            });

            it("2st staker (Epic car) must have 3636 tokens after divs was claimed", async function () {
                await shouldClaimDivs(1, 3636, otherAccounts[1], true).call(this);
                (await this.rewardsToken.balanceOf(otherAccounts[1])).toString().should.be.equal("3636");
            });
        });
    });

    describe("interface support", function () {
        before(doFreshDeploy);
        shouldSupportInterfaces([
            interfaces.ERC1155TokenReceiver
        ]);
    });
});
