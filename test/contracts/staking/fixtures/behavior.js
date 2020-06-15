const { BN, expectRevert, expectEvent, time } = require('@openzeppelin/test-helpers');
const { constants } = require('@animoca/ethereum-contracts-core_library');

const shouldRevertAndNotStakeNft = function(from, tokenId, expectedError) {
    it(`[STAKE \u274C] revert and not stake ${tokenId} by ${from}`, async function () {
        const promise = this.nftContract.transferFrom(from, this.stakingContract.address, tokenId, { from: from });

        if (expectedError) {
            await expectRevert(promise, expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldRevertAndNotUnstakeNft = function(from, tokenId, expectedError) {
    it(`[UNSTAKE \u274C] revert and not unstake ${tokenId} by ${from}`, async function () {
        const promise = this.stakingContract.unstakeNft(tokenId, { from: from });

        if (expectedError) {
            await expectRevert(promise, expectedError);
        } else {
            await expectRevert.unspecified(promise);
        }
    });
}

const shouldStakeNft = function(from, tokenId, cycle) {
    it(`[STAKE \u2705] ${tokenId} in cycle ${cycle} by ${from}`, async function () {
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

const shouldUnstakeNft = function(from, tokenId, cycle) {
    it(`[UNSTAKE \u2705] ${tokenId} at cycle ${cycle} by ${from}`, async function () {
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


const shouldEstimateRewards = function(from, periodsToClaim, firstClaimablePeriod, computedPeriods, claimableRewards) {
    it(`[ESTIMATE \u2705] ${claimableRewards} tokens over ${computedPeriods} periods (max=${periodsToClaim}) starting at ${firstClaimablePeriod}, by ${from}`, async function () {
        const result = await this.stakingContract.estimateRewards(periodsToClaim, { from: from });
        result.firstClaimablePeriod.should.be.bignumber.equal(new BN(firstClaimablePeriod));
        result.computedPeriods.should.be.bignumber.equal(new BN(computedPeriods));
        result.claimableRewards.should.be.bignumber.equal(new BN(claimableRewards));
    });
}

const shouldClaimRewards = function(from, periodsToClaim, firstClaimablePeriod, computedPeriods, claimableRewards) {
    it(`[CLAIM \u2705] ${claimableRewards} tokens over ${computedPeriods} periods (max=${periodsToClaim}) starting at ${firstClaimablePeriod}, by ${from}`, async function () {
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

module.exports = {
    shouldRevertAndNotStakeNft,
    shouldRevertAndNotUnstakeNft,
    shouldStakeNft,
    shouldUnstakeNft,
    shouldEstimateRewards,
    shouldClaimRewards,
}