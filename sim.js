

const kIterations = 1000;

const kArrivalRate = 2;
const kArrivalRange = 1;

const kWorkers = 32;
// const kQueuePolicy = "FIFO";
const kQueuePolicy = "LIFO";
const kWorkAvg = 3;
const kWorkRange = 2;
const kWorkRepeatAvg = 5;
const kWorkRepeatRange = 1;

const initSimContext = () => {
    const ctx = {};
    ctx.lastId = 0;

    // When zero, worker is available, when non-zero, ticks remaining for task.
    ctx.workers = [];
    for (let i = 0; i < kWorkers; i++) {
        ctx.workers[i] = null;
    }

    // Tasks waiting to run.
    ctx.queue = [];
    // Tasks that have completed.
    ctx.done = [];
    // Stats
    ctx.stats = {
        ticks: 0,
        totalTicks: 0,
    };
    return ctx;
};

const makeTask = (ctx) => {
    let task = {};
    task.id = ++ctx.lastId;
    task.ticksWaiting = 0;
    task.ticksLeft = getTicks();
    task.repeatsLeft = Math.floor(gaussianRandom(kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange));
    task.totalTicks = 0;
    task.totalRepeats = 0;
    return task;
}

const getTicks = () => {
    return Math.floor(gaussianRandom(kWorkAvg - kWorkRange, kWorkAvg + kWorkRange));
};

const enqueueAll = (ctx, newArrivals) => {
    ctx.queue.push(...newArrivals);
};

const dequeueOne = (ctx) => {
    if (ctx.queue.length == 0) {
        return null;
    }
    if (kQueuePolicy == "FIFO") {
        return ctx.queue.shift();
    } else if (kQueuePolicy == "LIFO") {
        return ctx.queue.pop();
    }
};

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
            task.totalTicks += 1;
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

    // Tick everything in the queue
    for (let i = 0; i < ctx.queue.length; i++) {
        ctx.queue[i].ticksWaiting += 1;
    }

    const numArrivals = Math.max(0, Math.floor(gaussianRandom(kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange)));
    let arrivals = [];

    // Generate ticks required for each arrival
    for (let i = 0; i < numArrivals; i++) {
        arrivals.push(makeTask(ctx));
    }

    // Add repeats
    for (let i = 0; i < doneTasks.length; i++) {
        const task = doneTasks[i];
        if (task.repeatsLeft > 0) {
            task.repeatsLeft -= 1;
            // Refresh ticks.
            task.ticksLeft = getTicks();
            arrivals.push(task);
        } else {
            ctx.done.push(task);
        }
    }

    // Enqueue all new arrivals. Note that the repeat tasks have been appended at the end, so 
    enqueueAll(ctx, arrivals);

    // Allocate tasks to workers
    for (let i = 0; i < availableWorkers.length; i++) {
        const task = dequeueOne(ctx);
        if (task !== null && task.ticksLeft > 0) {
            ctx.workers[availableWorkers[i]] = task;
        }
    }


    let stepStats = {};
    stepStats.i = i;
    stepStats.done = ctx.done.length;
    stepStats.queueLen = ctx.queue.length;
    stepStats.activeWorkers = ctx.workers.filter(ticks => ticks !== null).length;
    stepStats.avgWorkRemaining = ctx.workers.reduce((tot, w) => { return tot + ((w !== null) ? w.ticksLeft : 0); }, 0) / ctx.workers.length;

    ctx.stats.ticks += 1;
    ctx.stats.totalTicks += stepStats.activeWorkers;

    // if (i % 10 == 0) {
    //     console.log(ctx.stats);
    //     console.log(stepStats);
    // }
};

async function run() {
    const context = initSimContext();

    for (let i = 0; i < kIterations; i++) {
        step(context, i);
        // await sleep(100);
    }

    // Calcuate some summary statistics.
    console.log("queue policy", kQueuePolicy);
    console.log("unscheduled", context.queue.length);
    console.log("done", context.done.length);

    const allWaiting = context.done.map(task => task.ticksWaiting).sort((a, b) => a - b);
    const waitAvg = average(allWaiting);
    const waitMin = allWaiting[0];
    const waitp50 = percentileSorted(allWaiting, 0.50);
    const waitp95 = percentileSorted(allWaiting, 0.95);
    const waitp99 = percentileSorted(allWaiting, 0.99);
    const waitMax = allWaiting[allWaiting.length - 1];
    console.log("-- waiting latencies --");
    console.log("avg", waitAvg);
    console.log("min", waitMin);
    console.log("p50", waitp50);
    console.log("p95", waitp95);
    console.log("p95", waitp99);
    console.log("max", waitMax);

    const processTicks = context.done.map(task => task.totalTicks).sort((a, b) => a - b);
    const processAvg = average(processTicks);
    const processMin = processTicks[0];
    const processp50 = percentileSorted(processTicks, 0.50);
    const processp95 = percentileSorted(processTicks, 0.95);
    const processp99 = percentileSorted(processTicks, 0.99);
    const processMax = processTicks[processTicks.length - 1];
    console.log("-- processing latencies --");
    console.log("avg", processAvg);
    console.log("min", processMin);
    console.log("p50", processp50);
    console.log("p95", processp95);
    console.log("p95", processp99);
    console.log("max", processMax);

    const totalTicks = context.done.map(task => task.totalTicks + task.ticksWaiting).sort((a, b) => a - b);
    console.log("-- total latencies --");
    console.log("avg", average(totalTicks));
    console.log("min", totalTicks[0]);
    console.log("p50", percentileSorted(totalTicks, 0.5));
    console.log("p95", percentileSorted(totalTicks, 0.95));
    console.log("p95", percentileSorted(totalTicks, 0.99));
    console.log("max", totalTicks[totalTicks.length - 1]);

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

function percentileSorted(sorted, p) {
    const off = Math.floor(p * sorted.length);
    return sorted[off];
}

function average(array) {
    return array.reduce((tot, a) => tot + a, 0) / array.length;
}

function stdDev(array) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b) / n
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n)
}