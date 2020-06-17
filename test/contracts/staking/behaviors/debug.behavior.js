const { fromWei } = require('web3-utils');
const { PeriodLengthInCycles } = require('../constants');

const TITLE_WIDTH = 25;
const TITLE_PARTITION = '|';
const TITLE_PADDING = 2;

function getTitleString(title) {
    title = title === undefined ? '' : title;
    return (title + TITLE_PARTITION).padStart(TITLE_WIDTH) + ' '.repeat(TITLE_PADDING);
}

async function getGlobalHistory() {
    const history = [];

    let lastGlobalSnapshotIndex;

    try {
        lastGlobalSnapshotIndex = await this.stakingContract.lastGlobalSnapshotIndex();
    } catch (err) {
        return history;
    }

    const totalSnapshots = lastGlobalSnapshotIndex.addn(1).toNumber();

    for (let index = 0; index < totalSnapshots; index++) {
        history.push(await this.stakingContract.globalHistory(index));
    }

    return history;
}

async function getStakerHistory(staker) {
    const history = [];

    let lastSnapshotIndex;

    try {
        lastSnapshotIndex = await this.stakingContract.lastStakerSnapshotIndex(staker);
    } catch (err) {
        return history;
    }

    const totalSnapshots = lastSnapshotIndex.addn(1).toNumber();

    for (let index = 0; index < totalSnapshots; index++) {
        history.push(await this.stakingContract.stakerHistories(staker, index));
    }

    return history;
}

function renderDivider() {
    console.log(getTitleString());
}

async function renderRewardsScheduleMarks(period) {
    let marks = getTitleString('reward schedule');

    const rewardsSchedule = [];

    for (let count = 1; count <= period; count++) {
        rewardsSchedule.push(await this.stakingContract.rewardsSchedule(count));
    }

    for (let index = 0; index < (period - 1); index++) {
        marks += fromWei(rewardsSchedule[index]).padEnd(21, ' ');
    }

    marks += fromWei(rewardsSchedule[period - 1]);

    console.log(marks);
}

function renderPeriodMarks(period) {
    let marks = getTitleString();

    for (let count = 1; count < period; count++) {
        marks += count.toString().padEnd(21, ' ');
    }

    marks += period;

    console.log(marks);
}

function renderPeriodGraph(cycle, period) {
    const trailingCycles = cycle % PeriodLengthInCycles;

    let graph = getTitleString('period');

    if (period > 1) {
        graph += `[${'`'.repeat(19)}]`.repeat(period - 1);
    }

    graph += trailingCycles == 0 ? '' : '[' + '`'.repeat((trailingCycles * 3) - 2);

    console.log(graph);
}

function renderCycleMarks(period) {
    let marks = getTitleString();

    for (let count = 1; count < period; count++) {
        marks += (((count - 1) * PeriodLengthInCycles) + 1).toString().padEnd(21, ' ');
    }

    marks += (((period - 1) * PeriodLengthInCycles) + 1).toString();

    console.log(marks);
}

function renderCycleGraph(cycle, period) {
    const trailingCycles = cycle % PeriodLengthInCycles;

    let graph = getTitleString('cycle');

    if (cycle > 1) {
        graph += `|-${'-*-'.repeat(6)}-`.repeat(period - 1);
    }

    if (trailingCycles > 0) {
        graph += '|-'

        if (trailingCycles > 1) {
            graph += '-*-'.repeat(trailingCycles - 1);
        }
    }

    graph += ` (cycle: ${cycle})`;

    console.log(graph);
}

function renderHistoryMarks(cycle, history) {
    let mark = getTitleString();

    let deallocatedSnapshot = false;

    for (let index = 0; index < history.length; index++) {
        const snapshot = history[index];
        const startCycle = snapshot.startCycle.toNumber();

        if (startCycle == 0) {
            if (!deallocatedSnapshot) {
                deallocatedSnapshot = true;
            }
            continue;
        }

        if (deallocatedSnapshot) {
            deallocatedSnapshot = false;
            mark += '   '.repeat(startCycle - 1);
        }

        if (index == 0) {
            const offset = (startCycle - 1) * 3;
            mark += ' '.repeat(offset);
        }

        if (index < history.length - 1) {
            const nextSnapshot = history[index + 1];
            const endCycle = nextSnapshot.startCycle.toNumber() - 1;
            mark += (index + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        } else {
            const endCycle = cycle;
            mark += (index + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        }
    }

    console.log(mark);
}

function renderHistoryGraph(cycle, label, history) {
    let graph = getTitleString(`${label} snapshot`);

    let deallocatedSnapshot = false;

    for (let index = 0; index < history.length; index++) {
        const snapshot = history[index];
        const startCycle = snapshot.startCycle.toNumber();

        if (startCycle == 0) {
            if (!deallocatedSnapshot) {
                deallocatedSnapshot = true;
            }
            continue;
        }

        if (deallocatedSnapshot) {
            deallocatedSnapshot = false;
            graph += '   '.repeat(startCycle - 1);
        }

        if (index == 0) {
            graph += ' '.repeat((startCycle - 1) * 3);
        }

        if (index < history.length - 1) {
            const nextSnapshot = history[index + 1];
            const endCycle = nextSnapshot.startCycle.toNumber() - 1;
            graph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}]`;
        } else {
            const endCycle = cycle;
            graph += `[${'.'.repeat(((endCycle - startCycle + 1) * 3) - 2)}`;
        }
    }

    console.log(graph);
}

function renderHistoryStakeMarks(cycle, label, history) {
    let mark = getTitleString(`${label} stake`);

    let deallocatedSnapshot = false;

    for (let index = 0; index < history.length; index++) {
        const snapshot = history[index];
        const startCycle = snapshot.startCycle.toNumber();

        if (startCycle == 0) {
            if (!deallocatedSnapshot) {
                deallocatedSnapshot = true;
            }
            continue;
        }

        if (deallocatedSnapshot) {
            deallocatedSnapshot = false;
            mark += '   '.repeat(startCycle - 1);
        }

        if (index == 0) {
            const offset = (snapshot.startCycle.toNumber() - 1) * 3;
            mark += ' '.repeat(offset);
        }

        const stake = snapshot.stake.toNumber();

        if (index < history.length - 1) {
            const nextSnapshot = history[index + 1];
            const endCycle = nextSnapshot.startCycle.toNumber() - 1;
            mark += (stake + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        } else {
            const endCycle = cycle;
            mark += (stake + '').padEnd((endCycle - startCycle + 1) * 3, ' ');
        }
    }

    console.log(mark);
}

async function renderStakerNextClaimMark(staker, label, stakerHistory, globalHistory) {
    let mark = getTitleString(`${label} next claim`);

    const nextClaim = await this.stakingContract.nextClaims(staker);
    const nextClaimablePeriod = nextClaim.period;

    if (nextClaimablePeriod > 0) {
        const prevClaimablePeriodEndCycle = (nextClaimablePeriod - 1) * PeriodLengthInCycles;
        mark += '   '.repeat(prevClaimablePeriodEndCycle);
        mark += `* (cycle: ${prevClaimablePeriodEndCycle + 1})`;
    }

    console.log(mark);
}

async function debugCurrentState(...stakers) {
    if (stakers.length == 0 && this.stakers) {
        stakers = this.stakers;
    }
    console.log();

    const cycle = (await this.stakingContract.getCurrentCycle()).toNumber();
    const period = Math.floor((cycle - 1) / PeriodLengthInCycles) + 1;

    renderPeriodMarks(period);
    renderPeriodGraph(cycle, period);
    await renderRewardsScheduleMarks.bind(this, period)();
    renderDivider();
    renderCycleMarks(period);
    renderCycleGraph(cycle, period);
    renderDivider();

    const globalHistory = await getGlobalHistory.bind(this)();

    renderHistoryMarks(cycle, globalHistory);
    renderHistoryGraph(cycle, 'global', globalHistory);
    renderHistoryStakeMarks(cycle, 'global', globalHistory);

    for (let index = 0; index < stakers.length; index++) {
        const staker = stakers[index];
        const stakerNo = index + 1;
        const stakerHistory = await getStakerHistory.bind(this, staker)();
        renderDivider();
        renderHistoryMarks(cycle, stakerHistory);
        renderHistoryGraph(cycle, `staker #${stakerNo}`, stakerHistory);
        renderHistoryStakeMarks(cycle, `staker #${stakerNo}`, stakerHistory);
        await renderStakerNextClaimMark.bind(this, staker, `staker #${stakerNo}`, stakerHistory, globalHistory)();
    }

    console.log();
}

const shouldDebugCurrentState = function (...stakers) {
    it('should debug the current state', async function () {
        await debugCurrentState.bind(this, ...stakers)();
        true.should.be.true;
    });
}

// to be used in before() of a scenario
const initialiseDebug = function (...stakers) {
    this.stakers = stakers;
    this.debug = process.env['DEBUG'];
}

const suspendDebugOutput = function () {
    it('suspends debug output', function () {
        this.debugBackup = this.debug;
        this.debug = false;
    });
}

const resumeDebugOutput = function () {
    it('suspends debug output', function () {
        this.debug = this.debugBackup;
    });

}

module.exports = {
    shouldDebugCurrentState,
    debugCurrentState,
    initialiseDebug,
    suspendDebugOutput,
    resumeDebugOutput
}
