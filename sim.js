//
// Queueing model simulator for re-entrant tasks. 
//

// TODO: test multiple trials
const kIterations = 10000;

// Average number of new tasks arriving per tick +- kArrivalRange
const kArrivalRate = 4;
const kArrivalRange = 1;

// Number of workers that process a task per tick. 
const kWorkers = 64;

// Average number of ticks per task +- kWorkRange
const kWorkAvg = 4;
const kWorkRange = 2;

// Average number of re-entries per task +- kWorkRepeatRange
const kWorkRepeatAvg = 4;
const kWorkRepeatRange = 2;

const initSimContext = () => {
    const ctx = {};
    ctx.lastId = 0;

    // When null, worker is available.
    ctx.workers = [];
    for (let i = 0; i < kWorkers; i++) {
        ctx.workers[i] = null;
    }

    // Queue policy.
    ctx.policy;

    // Tasks waiting to run.
    ctx.queue = [];
    ctx.newArrivals = [];
    // Tasks that have completed.
    ctx.done = [];
    // Stats
    ctx.stats = {
        ticks: 0,
        queueMaxLen: 0,
        newMaxLen: 0,
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

const getNumArrivals = () => {
    return Math.max(0, Math.floor(gaussianRandom(kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange)));
};

const enqueueNew = (ctx, tasks) => {
    ctx.newArrivals.push(...tasks);
    if (ctx.newArrivals.length > ctx.stats.newMaxLen) {
        ctx.stats.newMaxLen = ctx.newArrivals.length;
    }
};

const enqueueRepeats = (ctx, tasks) => {
    ctx.queue.push(...tasks);
    if (ctx.queue.length > ctx.stats.queueMaxLen) {
        ctx.stats.queueMaxLen = ctx.queue.length;
    }
};

const dequeueOne = (ctx) => {
    if (ctx.policy == "FIFO") {
        if (ctx.queue.length > 0) {
            return ctx.queue.shift();
        } else if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.shift();
        }
    } else if (ctx.policy == "LIFO") {
        if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.pop();
        } else if (ctx.queue.length > 0) {
            return ctx.queue.pop();
        }
    } else if (ctx.policy == "NewFirst") {
        if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.shift();
        } else if (ctx.queue.length > 0) {
            return ctx.queue.shift();
        }
    }
    return null;
};

// Returns true when done and all queues are cleared
// The 'drain' argument indicates that no new tasks will arrive and all queues should drain.
const step = (ctx, drain) => {
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

    // Tick everything in each queue
    for (let i = 0; i < ctx.newArrivals.length; i++) {
        ctx.newArrivals[i].ticksWaiting += 1;
    }
    for (let i = 0; i < ctx.queue.length; i++) {
        ctx.queue[i].ticksWaiting += 1;
    }

    // If everything is empty, we are done.
    if (drain && availableWorkers.length == kWorkers &&
        ctx.newArrivals.length == 0 &&
        ctx.queue.length == 0) {
        return true;
    }

    // TODO: Use poisson distribution, not normal.
    // When draining, stop generating new arrivals.
    const newArrivals = (drain) ? 0 : getNumArrivals();
    let arrivals = [];

    // Generate ticks required for each arrival
    for (let i = 0; i < newArrivals; i++) {
        arrivals.push(makeTask(ctx));
    }

    // Add repeats
    let repeats = [];
    for (let i = 0; i < doneTasks.length; i++) {
        const task = doneTasks[i];
        if (task.repeatsLeft > 0) {
            task.repeatsLeft -= 1;
            // Refresh ticks when re-entering.
            task.ticksLeft = getTicks();
            repeats.push(task);
        } else {
            ctx.done.push(task);
        }
    }

    // Enqueue all new arrivals.
    enqueueNew(ctx, arrivals);
    enqueueRepeats(ctx, repeats);

    // Allocate tasks to workers
    for (let i = 0; i < availableWorkers.length; i++) {
        const task = dequeueOne(ctx);
        if (task !== null && task.ticksLeft > 0) {
            ctx.workers[availableWorkers[i]] = task;
        }
    }

    return false;
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

const runTrial = (context) => {
    console.log("-----------")
    console.log("-- TRIAL --")
    console.log("-----------")
    console.log("queue policy", context.policy);

    let ticks = 0;
    let done = false;
    let isDraining = false;
    while (!done) {
        const drain = ticks++ > kIterations;
        if (!isDraining && drain) {
            isDraining = true;

            console.log("-- latencies before drain --");
            logStats(context.done.map(task => task.totalTicks + task.ticksWaiting));

        }
        done = step(context, drain);
    }

    console.log("-- results --");
    console.log("ticks", ticks);
    console.log("new arrival max length", context.stats.newMaxLen);
    console.log("repeat queue max length", context.stats.queueMaxLen);

    // Calcuate some summary statistics.
    // console.log("-- waiting latencies --");
    // logStats(context.done.map(task => task.ticksWaiting))

    // console.log("-- processing latencies --");
    // logStats(context.done.map(task => task.totalTicks));

    console.log("-- total latencies --");
    logStats(context.done.map(task => task.totalTicks + task.ticksWaiting));
}

async function run() {
    console.log("ticks", kIterations);
    console.log("workers", kWorkers);
    console.log("arrival rate per tick (min,max)", kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange);
    console.log("ticks per task (min,max)", kWorkAvg - kWorkRange, kWorkAvg + kWorkRange);
    console.log("repeats per task (min,max)", kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange);

    ["FIFO", "LIFO", "NewFirst"].forEach((policy) => {
        const context = initSimContext();
        context.policy = policy;
        runTrial(context);
    });
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