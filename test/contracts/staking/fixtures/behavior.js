const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');

const shouldRevertAndNotStakeNft = function(params) {
    it(`[STAKE \u274C] revert and not stake ${params.tokenId} by ${params.staker}`, async function () {
        const promise = this.nftContract.transferFrom(params.staker, this.stakingContract.address, params.tokenId, { from: params.staker });

        if (params.expectedError) {
            await expectRevert(promise, params.expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldRevertAndNotUnstakeNft = function(params) {
    it(`[UNSTAKE \u274C] revert and not unstake ${params.tokenId} by ${params.staker}`, async function () {
        const promise = this.stakingContract.unstakeNft(params.tokenId, { from: params.staker });

        if (params.expectedError) {
            await expectRevert(promise, params.expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldStakeNft = function(params) {
    it(`[STAKE \u2705] ${params.tokenId} at cycle ${params.cycle} by ${params.staker}`, async function () {
        const globalSnapshotBefore = await this.stakingContract.getLatestGlobalSnapshot();
        const stakerSnapshotBefore = await this.stakingContract.getLatestStakerSnapshot(params.staker);
        const tokenInfoBefore = await this.stakingContract.tokenInfos(params.tokenId);

        const receipt = await this.nftContract.transferFrom(
            params.staker,
            this.stakingContract.address,
            params.tokenId,
            { from: params.staker }
        );

        const globalSnapshotAfter = await this.stakingContract.getLatestGlobalSnapshot();
        const stakerSnapshotAfter = await this.stakingContract.getLatestStakerSnapshot(params.staker);
        const tokenInfoAfter = await this.stakingContract.tokenInfos(params.tokenId);

        globalSnapshotAfter.stake.sub(globalSnapshotBefore.stake).should.be.bignumber.equal(tokenInfoAfter.weight);
        stakerSnapshotAfter.stake.sub(stakerSnapshotBefore.stake).should.be.bignumber.equal(tokenInfoAfter.weight);
        tokenInfoBefore.owner.should.equal(constants.ZeroAddress);
        tokenInfoAfter.owner.should.equal(params.staker);

        await expectEvent.inTransaction(
            receipt.tx,
            this.stakingContract,
            'NftStaked',
            {
                staker: params.staker,
                tokenId: params.tokenId,
                cycle: new BN(params.cycle)
            });
    });
}

const shouldUnstakeNft = function(params) {
    it(`[UNSTAKE \u2705] ${params.tokenId} at cycle ${params.cycle} by ${params.staker}`, async function () {
        const globalSnapshotBefore = await this.stakingContract.getLatestGlobalSnapshot();
        const stakerSnapshotBefore = await this.stakingContract.getLatestStakerSnapshot(params.staker);
        const tokenInfoBefore = await this.stakingContract.tokenInfos(params.tokenId);

        const receipt = await this.stakingContract.unstakeNft(params.tokenId, { from: params.staker });

        const globalSnapshotAfter = await this.stakingContract.getLatestGlobalSnapshot();
        const stakerSnapshotAfter = await this.stakingContract.getLatestStakerSnapshot(params.staker);
        const tokenInfoAfter = await this.stakingContract.tokenInfos(params.tokenId);

        globalSnapshotBefore.stake.sub(globalSnapshotAfter.stake).should.be.bignumber.equal(tokenInfoBefore.weight);
        stakerSnapshotBefore.stake.sub(stakerSnapshotAfter.stake).should.be.bignumber.equal(tokenInfoBefore.weight);
        tokenInfoBefore.owner.should.equal(params.staker);
        tokenInfoAfter.owner.should.equal(constants.ZeroAddress);

        await expectEvent.inTransaction(
            receipt.tx,
            this.stakingContract,
            'NftUnstaked',
            {
                staker: params.staker,
                tokenId: params.tokenId,
                cycle: new BN(params.cycle)
            });
    });
}

const shouldEstimateRewards = function(params) {
    it(`[ESTIMATE \u2705] ${params.claimableRewards} tokens over ${params.computedPeriods} ` +`periods (max=${params.periodsToClaim}) starting at ${params.firstClaimablePeriod}, by ${params.staker}`, async function () {
        const result = await this.stakingContract.estimateRewards(params.periodsToClaim, { from: params.staker });
        result.firstClaimablePeriod.should.be.bignumber.equal(new BN(params.firstClaimablePeriod));
        result.computedPeriods.should.be.bignumber.equal(new BN(params.computedPeriods));
        result.claimableRewards.should.be.bignumber.equal(new BN(params.claimableRewards));
    });
}

const shouldClaimRewards = function(params) {
    it(`[CLAIM \u2705] ${params.claimableRewards} tokens over ${params.computedPeriods} periods (max=${params.periodsToClaim}) starting at ${params.firstClaimablePeriod}, by ${params.staker}`, async function () {
        const stakerBalanceBefore = await this.rewardsToken.balanceOf(params.staker);
        const contractBalanceBefore = await this.rewardsToken.balanceOf(this.stakingContract.address);
        const nextClaimBefore = await this.stakingContract.nextClaims(params.staker);
        nextClaimBefore.period.should.be.bignumber.equal(new BN(params.firstClaimablePeriod));

        const estimate = await this.stakingContract.estimateRewards(params.periodsToClaim, { from: params.staker });
        estimate.firstClaimablePeriod.should.be.bignumber.equal(new BN(params.firstClaimablePeriod));
        estimate.computedPeriods.should.be.bignumber.at.most(new BN(params.computedPeriods));
        estimate.claimableRewards.should.be.bignumber.equal(new BN(params.claimableRewards));

        const receipt = await this.stakingContract.claimRewards(params.periodsToClaim, { from: params.staker });

        const stakerBalanceAfter = await this.rewardsToken.balanceOf(params.staker);
        const contractBalanceAfter = await this.rewardsToken.balanceOf(this.stakingContract.address);
        const nextClaimAfter = await this.stakingContract.nextClaims(params.staker);

        stakerBalanceAfter.sub(stakerBalanceBefore).should.be.bignumber.equal(new BN(params.claimableRewards));
        contractBalanceBefore.sub(contractBalanceAfter).should.be.bignumber.equal(new BN(params.claimableRewards));
        if (nextClaimAfter.period.toNumber() != 0) {
            nextClaimBefore.period.add(estimate.computedPeriods).should.be.bignumber.equal(nextClaimAfter.period);
        }

        if (estimate.computedPeriods > 0) {
            await expectEvent.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: params.staker,
                    startPeriod: new BN(params.firstClaimablePeriod),
                    periodsClaimed: new BN(params.computedPeriods),
                    amount: new BN(params.claimableRewards)
                });
        } else {
            await expectEvent.not.inTransaction(
                receipt.tx,
                this.stakingContract,
                'RewardsClaimed',
                {
                    staker: params.staker
                });
        }
    });
}

module.exports = {
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    shouldStakeNft,
    shouldUnstakeNft,
    shouldEstimateRewards,
    shouldClaimRewards,
}