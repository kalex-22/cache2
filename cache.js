class Cache {
  constructor(size, block, assoc, policy) {
    this.block = block;
    this.assoc = assoc;
    this.policy = policy; // "LRU" or "FIFO"
    this.numSets = size / block / assoc;
    this.offBits = Math.log2(block);
    this.idxBits = Math.log2(this.numSets);
    this.time = 0;
    this.hits = 0;
    this.misses = 0;
    this.memoryReads = 0;
    this.memoryWrites = 0;
    this.dirtyEvictions = 0;
 
    // each set is a list of lines: { valid, tag, stamp }
    this.sets = Array.from({ length: this.numSets }, () =>
      Array.from({ length: assoc }, () => ({ valid: false, tag: 0, stamp: 0, dirty: false }))
    );
  }
 
  // Process a byte-addressed read or write.
  access(a, op = "R", writePolicy = "back", writeAllocate = "allocate") {
    this.time++;
 
    // split the address into offset, index, and tag
    const offset = a % this.block;
    const index = Math.floor(a / this.block) % this.numSets;
    const tag = Math.floor(a / this.block / this.numSets);
    const set = this.sets[index];
 
    // 1. hit check
    for (let w = 0; w < set.length; w++) {
      const line = set[w];
      if (line.valid && line.tag === tag) {
        this.hits++;
        if (this.policy === "LRU") line.stamp = this.time; // FIFO keeps the old stamp
        if (op === "W") {
          if (writePolicy === "back") line.dirty = true;
          else this.memoryWrites++;
        }
        return { a, op, tag, index, offset, way: w, result: "HIT", detail: op === "W" ? (writePolicy === "back" ? "dirty" : "write-through") : "read" };
      }
    }
 
    // A no-write-allocate store miss bypasses the cache and writes memory directly.
    this.misses++;
    if (op === "W" && writeAllocate === "no-allocate") {
      this.memoryWrites++;
      return { a, op, tag, index, offset, way: null, result: "MISS", detail: "bypass" };
    }

    // Fetch the missing block, then choose an empty line or the replacement victim.
    this.memoryReads++;
    let w = set.findIndex(line => !line.valid);
    if (w < 0) {
      w = 0;
      set.forEach((line, i) => {
        if (line.stamp < set[w].stamp) w = i;
      });
    }
    const evicted = set[w].valid ? set[w] : null;
    if (evicted && evicted.dirty) {
      this.memoryWrites++;
      this.dirtyEvictions++;
    }
    const dirty = op === "W" && writePolicy === "back";
    if (op === "W" && writePolicy === "through") this.memoryWrites++;
    set[w] = { valid: true, tag, stamp: this.time, dirty };
    return { a, op, tag, index, offset, way: w, result: "MISS", detail: dirty ? "dirty" : (op === "W" ? "write-through" : "read") };
  }
 
  // Copy of the cache contents (tag per line, or null if empty)
  snapshot() {
    return this.sets.map(set => set.map(line => (line.valid ? { tag: line.tag, dirty: line.dirty } : null)));
  }
 
  // Serialized AMAT: each access pays hit time, each block read pays miss penalty,
  // and each memory write pays the configured write penalty.
  stats(hitTime, missPenalty, writePenalty) {
    const total = this.hits + this.misses;
    const missRate = total ? this.misses / total : 0;
    return {
      hitRate: 1 - missRate,
      missRate,
      amat: total ? hitTime + (this.memoryReads * missPenalty + this.memoryWrites * writePenalty) / total : 0
    };
  }
}
 
