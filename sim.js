//
// Queueing model simulator for re-entrant tasks. 
//

const initSimContext = (params, logFn) => {
    const ctx = {};
    ctx.params = params;
    ctx.log = logFn;

    // When null, worker is available.
    ctx.workers = [];
    for (let i = 0; i < params.workers; i++) {
        ctx.workers[i] = null;
    }

    ctx.lastId = 0;

    // Tasks waiting to run.
    ctx.queue = [];
    ctx.newArrivals = [];
    // Tasks that have completed.
    ctx.done = [];
    // Number of tasks that failed after reaching their timeout.
    ctx.timedOut = 0;
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
    task.id = ctx.lastId++;
    // Ticks spent waiting in a queue.
    task.ticksWaiting = 0;
    // Ticks remaining for this task for this repetition.
    task.ticksLeft = getTicks(ctx);
    // Number of times to re-queue in the system.
    task.repeatsLeft = Math.max(0, Math.floor(gaussianRandom(ctx.params.repeatAvg - ctx.params.repeatRange, ctx.params.repeatAvg + ctx.params.repeatRange)));
    // Number of ticks spent active across all repeats.
    task.ticksActive = 0;
    // Number of ticks before this operation is considered timed-out.
    // Use a bi-modal timeout.
    if (Math.random() < ctx.params.timeoutRate) {
        task.timeout = ctx.params.timeout;
    } else {
        task.timeout = Number.MAX_SAFE_INTEGER;
    }
    return task;
}

const getTicks = (ctx) => {
    return Math.floor(gaussianRandom(ctx.params.workAvg - ctx.params.workRange, ctx.params.workAvg + ctx.params.workRange));
};

const getNumArrivals = (ctx) => {
    return poissonRandom(ctx.params.arrivalRate);
};

const getTicksLeft = (task) => {
    return task.timeout - (task.ticksActive + task.ticksWaiting);
};

const enqueue = (ctx, newArrivals, repeats) => {
    ctx.newArrivals.push(...newArrivals);
    if (ctx.newArrivals.length > ctx.stats.newMaxLen) {
        ctx.stats.newMaxLen = ctx.newArrivals.length;
    }
    ctx.queue.push(...repeats);
    if (ctx.queue.length > ctx.stats.queueMaxLen) {
        ctx.stats.queueMaxLen = ctx.queue.length;
    }

    if (ctx.params.policy == "DeadlinePriority") {
        // Sort both queues by deadline priority and pick the operation with the closest deadline.
        ctx.newArrivals.sort((a, b) => {
            const diff = getTicksLeft(a) - getTicksLeft(b);
            if (diff) {
                return diff;
            }
            return b.id - a.id;
        });
        ctx.queue.sort((a, b) => {
            const diff = getTicksLeft(a) - getTicksLeft(b);
            if (diff) {
                return diff;
            }
            return b.id - a.id;
        });
    }
};

const dequeueOne = (ctx) => {
    if (ctx.params.policy == "FIFO") {
        if (ctx.queue.length > 0) {
            return ctx.queue.shift();
        } else if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.shift();
        }
    } else if (ctx.params.policy == "LIFO") {
        if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.pop();
        } else if (ctx.queue.length > 0) {
            return ctx.queue.pop();
        }
    } else if (ctx.params.policy == "NewFirst") {
        if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.shift();
        } else if (ctx.queue.length > 0) {
            return ctx.queue.shift();
        }
    } else if (ctx.params.policy == "DeadlinePriority") {
        if (ctx.queue.length > 0 && ctx.newArrivals.length > 0) {
            if (getTicksLeft(ctx.newArrivals[0]) < getTicksLeft(ctx.queue[0])) {
                return ctx.newArrivals.shift();
            } else {
                return ctx.queue.shift();
            }
        } else if (ctx.queue.length > 0) {
            return ctx.queue.shift();
        } else if (ctx.newArrivals.length > 0) {
            return ctx.newArrivals.shift();
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
            if (task.ticksActive + task.ticksWaiting > task.timeout) {
                ctx.timedOut += 1;
                availableWorkers.push(i);
                ctx.workers[i] = null;
            } else if (task.ticksLeft == 0) {
                // This task just completed. It is eligible for re-entry.
                doneTasks.push(task);
                availableWorkers.push(i);
                ctx.workers[i] = null;
            }
        } else {
            console.error("negative ticks left", task, i);
        }
    }

    // Tick everything in each queue
    for (let i = 0; i < ctx.newArrivals.length; i++) {
        const task = ctx.newArrivals[i];
        task.ticksWaiting += 1;
        if (task.ticksActive + task.ticksWaiting > task.timeout) {
            ctx.newArrivals.splice(i, 1);
            ctx.timedOut += 1;
        }
    }
    for (let i = 0; i < ctx.queue.length; i++) {
        const task = ctx.queue[i];
        task.ticksWaiting += 1;
        if (task.ticksActive + task.ticksWaiting > task.timeout) {
            ctx.queue.splice(i, 1);
            ctx.timedOut += 1;
        }
    }

    // If everything is empty, we are done.
    if (drain && availableWorkers.length == ctx.params.workers &&
        ctx.newArrivals.length == 0 &&
        ctx.queue.length == 0) {
        return true;
    }

    // When draining, stop generating new arrivals.
    const newArrivals = (drain) ? 0 : getNumArrivals(ctx);
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
            task.ticksLeft = getTicks(ctx);
            repeats.push(task);
        } else {
            ctx.done.push(task);
        }
    }

    // Enqueue all new arrivals and repeated tasks.
    enqueue(ctx, arrivals, repeats);

    // Allocate tasks to workers
    for (let i = 0; i < availableWorkers.length; i++) {
        const task = dequeueOne(ctx);
        if (task !== null && task.ticksLeft > 0) {
            ctx.workers[availableWorkers[i]] = task;
        }
    }

    return false;
};

const drawHist = (sorted, log) => {
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
const logStats = (dataSet, log) => {
    const sorted = dataSet.sort((a, b) => a - b);
    log("avg", average(sorted).toFixed(1));
    log("dev", stdDev(sorted).toFixed(1));
    log("min", sorted[0]);
    log("p50", percentileSorted(sorted, 0.50));
    log("p95", percentileSorted(sorted, 0.95));
    log("p99", percentileSorted(sorted, 0.99));
    log("max", sorted[sorted.length - 1]);
    drawHist(sorted, log);
};

const runTrial = (context) => {
    context.log("-----------------")
    context.log(`-- TRIAL: ${context.params.policy} --`)
    context.log("-----------------")

    let ticks = 0;
    let done = false;
    let isDraining = false;
    while (!done) {
        const drain = ticks++ > context.params.iterations;
        if (!isDraining && drain) {
            isDraining = true;

            context.log("----------------------------");
            context.log("-- LATENCIES BEFORE DRAIN --");
            context.log("----------------------------");
            logStats(context.done.map(task => task.ticksActive + task.ticksWaiting), context.log);
            context.log("completed", context.done.length);
            context.log("remaining", context.queue.length + context.newArrivals.length);
            const totalTasks = context.done.length + context.timedOut;
            const timedOutPct = (100 * context.timedOut / totalTasks).toFixed(1);
            context.log("timed out", context.timedOut, `(${timedOutPct}%)`);

        }
        done = step(context, drain);
    }

    context.log("---------------------");
    context.log("-- TOTAL LATENCIES AFTER DRAIN --");
    context.log("---------------------");
    logStats(context.done.map(task => task.ticksActive + task.ticksWaiting), context.log);
    context.log("-------------");
    context.log("-- SUMMARY --");
    context.log("-------------");
    context.log("total ticks", ticks);
    const totalTasks = context.done.length + context.timedOut;
    const timedOutPct = (100 * context.timedOut / totalTasks).toFixed(1);
    context.log("timed out", context.timedOut, `(${timedOutPct}%)`);
    context.log("goodput (tasks/1000 ticks)", (1000 * context.done.length / ticks).toFixed(1));
    context.log("arrival queue max length", context.stats.newMaxLen);
    context.log("repeat queue max length", context.stats.queueMaxLen);

    context.log("\n");
}

function getParam(elemId) {
    const val = document.getElementById(elemId).value;
    console.log(elemId, val);
    return Number(val);
}

async function run(output, done = () => { }) {
    const params = {};
    params.iterations = getParam("iterations");

    // Number of workers that process a task per tick. 
    params.workers = getParam("workers");

    // Limit on the number of ticks before a task is considered failed.
    params.timeout = getParam("timeout");
    params.timeoutRate = getParam("timeoutRate");

    // Average number of new tasks arriving per tick +- range 
    params.arrivalRate = getParam("arrivalRateAvg");

    // Average number of ticks per task +- range 
    params.workAvg = getParam("workAvg");
    params.workRange = getParam("workRange");

    // Average number of re-entries per task +- range
    params.repeatAvg = getParam("repeatAvg");
    params.repeatRange = getParam("repeatRange");

    output.innerHTML = "";
    ["FIFO", "LIFO", "NewFirst", "DeadlinePriority"].forEach((policy) => {
        params.policy = policy;
        let trialOutput = "";
        const context = initSimContext(params, function log() {
            console.log.apply(null, arguments);
            trialOutput += Array.from(arguments).join(" ") + "<br>";
        });
        runTrial(context);
        output.innerHTML += `<div class='trial'>${trialOutput}</div>`;
    });
    done();
}


window.onload = () => {
    const output = document.getElementById("trials");
    const trialForm = document.getElementById("trialForm");
    const runBtn = document.getElementById("run");

    const doRun = () => {
        runBtn.innerHTML = "Running...";
        runBtn.disabled = true;
        setTimeout(() => {
            run(output, () => {
                runBtn.disabled = false;
                runBtn.innerHTML = "Run";
            });
        }, 1);
    };

    trialForm.onsubmit = () => {
        doRun();
        return false;
    }
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

function poissonRandom(lambda) {
    // https://stackoverflow.com/questions/1241555/algorithm-to-generate-poisson-and-binomial-random-numbers
    const L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do {
        k++;
        p *= Math.random();
    } while (p > L);

    return k - 1;
}

function stdDev(array) {
    const n = array.length
    const mean = array.reduce((a, b) => a + b) / n
    return Math.sqrt(array.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n)
}