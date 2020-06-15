const { BN } = require('@openzeppelin/test-helpers');

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

const shouldDebugCurrentState = function(...stakers) {
    it('should debug the current state', async function () {
        await debugCurrentState.bind(this, ...stakers)();
        true.should.be.true;
    });
}

module.exports = {
    shouldDebugCurrentState
}