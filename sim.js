// TODO: test multiple trials
const kIterations = 10000;

// Average number of new tasks arriving per tick +- kArrivalRange
const kArrivalRate = 2;
const kArrivalRange = 1;

// Number of workers that process a task per tick. 
const kWorkers = 64;

const kQueuePolicy = "FIFO";
// const kQueuePolicy = "LIFO";

// Average number of ticks per task +- kWorkRange
const kWorkAvg = 3;
const kWorkRange = 2;

// Average number of re-entries per task +- kWorkRepeatRange
const kWorkRepeatAvg = 10;
const kWorkRepeatRange = 1;

const initSimContext = () => {
    const ctx = {};
    ctx.lastId = 0;

    // When null, worker is available.
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
    // Ticks spent waiting in a queue.
    task.ticksWaiting = 0;
    // Ticks remaining for this task for this repetition.
    task.ticksLeft = getTicks();
    // Number of times to re-queue in the system.
    task.repeatsLeft = Math.floor(gaussianRandom(kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange));
    // Total number of ticks spent processing across repeated runs.
    task.totalTicks = 0;
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

    // TODO: Use poisson distribution, not normal.
    const newArrivals = Math.max(0, Math.floor(gaussianRandom(kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange)));
    let arrivals = [];

    // Generate ticks required for each arrival
    for (let i = 0; i < newArrivals; i++) {
        arrivals.push(makeTask(ctx));
    }

    // Add repeats
    for (let i = 0; i < doneTasks.length; i++) {
        const task = doneTasks[i];
        if (task.repeatsLeft > 0) {
            task.repeatsLeft -= 1;
            // Refresh ticks when re-entering.
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

const logStats = (dataSet) => {
    const sorted = dataSet.sort((a, b) => a - b);
    console.log("avg", average(sorted));
    console.log("min", sorted[0]);
    console.log("p50", percentileSorted(sorted, 0.50));
    console.log("p95", percentileSorted(sorted, 0.95));
    console.log("p99", percentileSorted(sorted, 0.99));
    console.log("max", sorted[sorted.length - 1]);
};

async function run() {
    const context = initSimContext();

    for (let i = 0; i < kIterations; i++) {
        step(context, i);
        // await sleep(100);
    }

    console.log("-- parameters --")
    console.log("queue policy", kQueuePolicy);
    console.log("ticks", kIterations);
    console.log("workers", kWorkers);
    console.log("arrival rate per tick (min,max)", kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange);
    console.log("ticks per task (min,max)", kWorkAvg - kWorkRange, kWorkAvg + kWorkRange);
    console.log("repeats per task (min,max)", kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange);

    console.log("-- results --");
    console.log("unscheduled", context.queue.length);
    console.log("done", context.done.length);

    // Calcuate some summary statistics.
    console.log("-- waiting latencies --");
    logStats(context.done.map(task => task.ticksWaiting))

    console.log("-- processing latencies --");
    logStats(context.done.map(task => task.totalTicks));

    console.log("-- total latencies --");
    logStats(context.done.map(task => task.totalTicks + task.ticksWaiting));
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
    // Central limit theorum to generate a normally-distributed random value
    //between start and end.
    let rand = 0;
    for (let i = 0; i < 6; i += 1) {
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