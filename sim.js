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

// Limit on the number of ticks before a task is considered failed.
const kTimeout = 5000;

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
    // Tasks that failed after reaching their timeout.
    ctx.timedOut = [];
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
    // Number of ticks spent active across all repeats.
    task.ticksActive = 0;
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
            task.ticksActive += 1;
            if (task.ticksActive + task.ticksWaiting > kTimeout) {
                ctx.timedOut.push(task);
                availableWorkers.push(i);
                ctx.workers[i] = null;
            } else if (task.ticksLeft == 0) {
                // This task just completed. It is eligible for re-entry.
                doneTasks.push(task);
                availableWorkers.push(i);
                ctx.workers[i] = null;
            }
        } else {
            console.error("negative ticks left");
            log(task, i);
        }
    }

    // Tick everything in each queue
    for (let i = 0; i < ctx.newArrivals.length; i++) {
        const task = ctx.newArrivals[i];
        task.ticksWaiting += 1;
        if (task.ticksActive + task.ticksWaiting > kTimeout) {
            ctx.newArrivals.splice(i, 1);
            ctx.timedOut.push(task);
        }
    }
    for (let i = 0; i < ctx.queue.length; i++) {
        const task = ctx.queue[i];
        task.ticksWaiting += 1;
        if (task.ticksActive + task.ticksWaiting > kTimeout) {
            ctx.queue.splice(i, 1);
            ctx.timedOut.push(task);
        }
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

const drawHist = (sorted) => {
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    const nBuckets = 10;
    const buckets = Array(nBuckets).fill(0);

    for (let i = 0; i < sorted.length; i++) {
        const myBucket = Math.min(Math.floor(((sorted[i] - min) / range) * nBuckets), nBuckets - 1);
        buckets[myBucket] += 1;
    }
    const largestBucket = Math.max(...buckets);
    const padLen = Math.log10(max) + 1;
    for (let i = 0; i < buckets.length; i++) {
        const fill = 20 * buckets[i] / largestBucket;
        const rangeMin = Math.floor(i * (range / nBuckets) + min);
        const rangeMax = Math.floor((i + 1) * (range / nBuckets) + min - 1);
        const minTxt = rangeMin.toString().padStart(padLen, ' ');
        const maxTxt = rangeMax.toString().padStart(padLen, ' ');
        log(`[${minTxt} - ${maxTxt}]: ${'='.repeat(fill)} ${buckets[i]}`);
    }
}
const logStats = (dataSet) => {
    const sorted = dataSet.sort((a, b) => a - b);
    log("avg", average(sorted).toFixed(1));
    log("dev", stdDev(sorted).toFixed(1));
    log("min", sorted[0]);
    log("p50", percentileSorted(sorted, 0.50));
    log("p95", percentileSorted(sorted, 0.95));
    log("p99", percentileSorted(sorted, 0.99));
    log("max", sorted[sorted.length - 1]);
    drawHist(sorted);
};

const runTrial = (context) => {
    log("-----------------")
    log(`-- TRIAL: ${context.policy} --`)
    log("-----------------")

    let ticks = 0;
    let done = false;
    let isDraining = false;
    while (!done) {
        const drain = ticks++ > kIterations;
        if (!isDraining && drain) {
            isDraining = true;

            log("----------------------------");
            log("-- LATENCIES BEFORE DRAIN --");
            log("----------------------------");
            logStats(context.done.map(task => task.ticksActive + task.ticksWaiting));

        }
        done = step(context, drain);
    }

    // Calcuate some summary statistics.
    // log("-- waiting latencies --");
    // logStats(context.done.map(task => task.ticksWaiting))

    // log("-- processing latencies --");
    // logStats(context.done.map(task => task.ticksActive));

    log("---------------------");
    log("-- TOTAL LATENCIES --");
    log("---------------------");
    logStats(context.done.map(task => task.ticksActive + task.ticksWaiting));
    log("-------------");
    log("-- RESULTS --");
    log("-------------");
    log("total ticks", ticks);
    const totalTasks = context.done.length + context.timedOut.length;
    const timedOutPct = (100 * context.timedOut.length / totalTasks).toFixed(2);
    log("timed out", context.timedOut.length, `${timedOutPct}%`);
    log("goodput (tasks/tick)", (context.done.length / ticks).toFixed(3));
    log("arrival queue max length", context.stats.newMaxLen);
    log("repeat queue max length", context.stats.queueMaxLen);

    log("\n");
}

async function run() {
    log("----------------");
    log("-- PARAMETERS --");
    log("----------------");
    log("arrival ticks", kIterations);
    log("workers", kWorkers);
    log("timeout ticks", kTimeout);
    log("arrival rate per tick (min,max)", kArrivalRate - kArrivalRange, kArrivalRate + kArrivalRange);
    log("ticks per task (min,max)", kWorkAvg - kWorkRange, kWorkAvg + kWorkRange);
    log("repeats per task (min,max)", kWorkRepeatAvg - kWorkRepeatRange, kWorkRepeatAvg + kWorkRepeatRange);

    ["FIFO", "LIFO", "NewFirst"].forEach((policy) => {
        const context = initSimContext();
        context.policy = policy;
        runTrial(context);
    });
}

let output;
function log() {
    console.log.apply(null, arguments);
    output.innerHTML += Array.from(arguments).join(" ") + "<br>";
};

window.onload = () => {
    output = document.getElementById("output");

    run().catch((err) => {
        log(err);
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