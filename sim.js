

const kIterations = 100;

const kArrivalRate = 5;
const kArrivalRange = 5;

const kWorkers = 16;
const kQueueLen = 100;
const kWorkAvg = 3;
const kWorkRange = 2;
const kWorkRepeatAvg = 5;
const kWorkRepeatRange = 1;

const initSimContext = () => {
    const ctx = {};

    // When zero, worker is available, when non-zero, ticks remaining for task.
    ctx.workers = [];
    for (let i = 0; i < kWorkers; i++) {
        ctx.workers[i] = null;
    }

    ctx.queue = [];
    return ctx;
};

const makeTask = () => {
    let task = {};
    task.ticksLeft = Math.floor(gaussianRandom(kWorkAvg - kWorkRange, kWorkAvg + kWorkRange));
    task.repeatsLeft = Math.floor(gaussianRandom(kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange));
    task.totalTicks = 0;
    task.totalRepeats = 0;
    return task;
}

const enqueueAll = (ctx, newArrivals) => {
    ctx.queue.push(...newArrivals);
};

const dequeueOne = (ctx) => {
    if (ctx.queue.length == 0) {
        return null;
    }
    return ctx.queue.shift();
};

const getStats = (ctx, i) => {
    let stats = {};
    stats.i = i;
    stats.queueLen = ctx.queue.length;
    stats.activeWorkers = ctx.workers.filter(ticks => ticks !== null).length;
    stats.avgWorkRemaining = ctx.workers.reduce((tot, w) => { return tot + ((w !== null) ? w.ticksLeft : 0); }, 0) / ctx.workers.length;
    stats.ctx = ctx;
    return stats;
}

const step = (ctx, i) => {

    // Find available workers.
    // Run all workers for 1 tick.
    let doneTasks = [];
    let availableWorkers = [];
    for (let i = 0; i < ctx.workers.length; i++) {
        const task = ctx.workers[i];
        if (task === null) {
            availableWorkers.push(i);
            continue;
        }
        if (task.ticksLeft) {
            task.ticksLeft -= 1;
            if (task.ticksLeft == 0) {
                // This task just completed. It is eligible for re-entry.
                doneTasks.push(task);
                availableWorkers.push(i);
                ctx.workers[i] = null;
            }
        } else {
            console.error("negative ticks left");
            console.log(task, i);
        }
    }

    const numArrivals = Math.floor(gaussianRandom(kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange));
    let arrivals = [];

    // Generate ticks required for each arrival
    for (let i = 0; i < numArrivals; i++) {
        arrivals.push(makeTask());
    }

    // Add repeats
    for (let i = 0; i < doneTasks; i++) {
        const task = doneTasks[i];
        if (task.repeatsLeft > 0) {
            task.repeatsLeft -= 1;
            arrivals.push(task);
        }
    }

    // Enqueue all new arrivals
    enqueueAll(ctx, arrivals);

    // Allocate tasks to workers
    for (let i = 0; i < availableWorkers.length; i++) {
        const task = dequeueOne(ctx);
        if (task !== null && task.ticksLeft > 0) {
            ctx.workers[availableWorkers[i]] = task;
        }
    }

    if (i % 10 == 0) {
        console.log(getStats(ctx, i));
    }
};

async function run() {
    const context = initSimContext();

    for (let i = 0; i < kIterations; i++) {
        step(context, i);
        await sleep(100);
    }
}

window.onload = () => {
    const output = document.getElementById("output");

    run().catch((err) => {
        console.log(err);
    });
    // Output stats.
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function gaussianRandom(start, end) {
    let rand = 0;

    for (var i = 0; i < 6; i += 1) {
        rand += Math.random();
    }

    rand = rand / 6;
    return Math.floor(start + rand * (end - start + 1));
}