<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord, deleteRecord } from './db.js';
  import { sha256, bytesToHex } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { recordStore, merkleRoot } from './stores';
  import RecordGenerator from './RecordGenerator.svelte';
  
  // --- Stats for UI ---
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0;
  let statRecordsSent = 0;
  let peerTraffic: Record<string, { sent: { roothashs: number; subtrees: number; records: number }, recv: { roothashs: number; subtrees: number; records: number } }> = {};
  
  // --- Trystero setup ---
  const config = { appId: 'testpeer' };
  const room = joinRoom(config, 'testroom_lazyMerkle');
  
  let sendRootHash, getRootHash;
  let sendSubtree, getSubtree;
  let sendRecords, getRecords;
  
  const IDLE_TIMEOUT = 5000;
  const PRUNE_INTERVAL = 5 * 60 * 1000;
  const RETENTION_DAYS = 90;
  const lastActivity: Record<string, number> = {};
  
  // Helper function to format hash for logging
  function formatHash(hash: string): string {
    return hash ? hash.substring(0, 8) + '...' : 'EMPTY';
  }
  
  // Initialize peerTraffic for a peer
  function initPeerTraffic(peerId: string) {
    if (!peerTraffic[peerId]) {
      peerTraffic[peerId] = {
        sent: { roothashs: 0, subtrees: 0, records: 0},
        recv: { roothashs: 0, subtrees: 0, records: 0}
      };
      peerTraffic = { ...peerTraffic };
    }
  }

  // --- True incremental Merkle tree structures ---
  type MerkleNode = {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
    isLeaf?: boolean;
    recordId?: string;
    height: number;
  };
  
  // --- AVL-based Merkle Tree for O(log n) operations ---
  class IncrementalMerkleTree {
    private root: MerkleNode | null = null;
    private recordIndex = new Map<string, MerkleNode>();

    constructor(records: Record<string, any> = {}) {
      console.log(`Building Merkle tree with ${Object.keys(records).length} records`);
      
      // Convert records to array for processing
      const recordArray = Object.entries(records);
      
      if (recordArray.length > 0) {
        this.bulkInsert(recordArray);
        // Initialize the tree structure first, then we'll compute hashes asynchronously
      }
      
      const rootHash = this.getRootHash();
      console.log(`Merkle tree initialized with root hash: ${formatHash(rootHash)} (hashes will be computed asynchronously)`);
    }

    // Add this method to compute hashes after construction
    async initialize(): Promise<void> {
      if (this.root) {
        await this.recomputeHashes(this.root);
        console.log(`Merkle tree hashes computed - root hash: ${formatHash(this.getRootHash())}`);
      }
    }

    getRootHash(): string {
    return this.root?.hash || 'freshNode';
    }

    private bulkInsert(records: any[]) {
  // Sort records by UUID using simple string comparison for deterministic results
  const sortedRecords = records.sort((a, b) => {
    const uuidA = a[0];
    const uuidB = b[0];
    if (uuidA < uuidB) return -1;
    if (uuidA > uuidB) return 1;
    return 0;
  });
  
  console.log(`Building tree with sorted UUIDs: ${sortedRecords.slice(0, 3).map(r => r[0]).join(', ')}${sortedRecords.length > 3 ? '...' : ''}`);
  
  this.root = this.buildBalancedTree(sortedRecords, 0, sortedRecords.length - 1);
  console.log(`Built balanced tree with ${sortedRecords.length} records`);
}

    private buildBalancedTree(records: any[], start: number, end: number): MerkleNode | null {
      if (start > end) return null;
      if (start === end) {
        // True leaf
        const [uuid, record] = records[start];
        const newNode: MerkleNode = {
          hash: record.integrity?.hash || '',
          recordId: uuid,
          height: 0,
          isLeaf: true
        };
        this.recordIndex.set(uuid, newNode);
        return newNode;
      }

      // Internal node
      const mid = Math.floor((start + end) / 2);
      const newNode: MerkleNode = {
        hash: '',
        height: 0,
        isLeaf: false
      };
      newNode.left = this.buildBalancedTree(records, start, mid);
      newNode.right = this.buildBalancedTree(records, mid + 1, end);
      newNode.height = 1 + Math.max(this.getHeight(newNode.left), this.getHeight(newNode.right));
      return this.rebalance(newNode);
    }
  
    private rebalance(node: MerkleNode): MerkleNode {
      if (!node) return node;

      const balance = this.getBalance(node);

      if (balance > 1) {
        if (node.left && this.getBalance(node.left) < 0) {
          node.left = this.rotateLeft(node.left);
        }
        return this.rotateRight(node);
      }

      if (balance < -1) {
        if (node.right && this.getBalance(node.right) > 0) {
          node.right = this.rotateRight(node.right);
        }
        return this.rotateLeft(node);
      }

      return node;
    }

    private rotateLeft(node: MerkleNode): MerkleNode {
      if (!node.right) throw new Error(`Cannot rotate left: no right child for node ${formatHash(node.hash)}`);
      const newRoot = node.right;
      node.right = newRoot.left;
      newRoot.left = node;

      node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
      newRoot.height = 1 + Math.max(this.getHeight(newRoot.left), this.getHeight(newRoot.right));

      return newRoot;
    }

    private rotateRight(node: MerkleNode): MerkleNode {
      if (!node.left) throw new Error(`Cannot rotate right: no left child for node ${formatHash(node.hash)}`);
      const newRoot = node.left;
      node.left = newRoot.right;
      newRoot.right = node;

      node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
      newRoot.height = 1 + Math.max(this.getHeight(newRoot.left), this.getHeight(newRoot.right));

      return newRoot;
    }

    private getHeight(node: MerkleNode | null): number {
      return node ? node.height : -1;
    }

    private getBalance(node: MerkleNode | null): number {
      return node ? this.getHeight(node.left) - this.getHeight(node.right) : 0;
    }
  
    private async recomputeHashes(node: MerkleNode | null): Promise<void> {
      if (!node) return;
      await this.recomputeHashes(node.left);
      await this.recomputeHashes(node.right);
      if (node.isLeaf) {
        // Leaf nodes use the record's integrity.hash directly
        return;
      }
      const leftHash = node.left?.hash || '';
      const rightHash = node.right?.hash || '';
      const combined = new TextEncoder().encode(leftHash + rightHash);
      const hashBytes = await sha256(combined);
      node.hash = bytesToHex(hashBytes);
      console.log(`Recomputed hash for node at height ${node.height}: ${formatHash(node.hash)}`);
    }
  
    getAllSubtreeHashes(maxDepth = 3): {path: string, hash: string}[] {
      const result: {path: string, hash: string}[] = [];
      this.collectSubtreeHashes(this.root, 'root', maxDepth, result);
      return result;
    }
  
    private collectSubtreeHashes(node: MerkleNode | null, path: string, depth: number, result: {path: string, hash: string}[]) {
      if (!node || depth <= 0) return;
      result.push({ path, hash: node.hash });
      if ((node.left || node.right) && depth > 1) {
        if (node.left) this.collectSubtreeHashes(node.left, path + 'L', depth - 1, result);
        if (node.right) this.collectSubtreeHashes(node.right, path + 'R', depth - 1, result);
      }
    }
  
    getRecordsForPaths(differingPaths: string[]): string[] {
      const recordIds: Set<string> = new Set();
      for (const path of differingPaths) {
        this.collectRecordsInPath(this.root, 'root', path, recordIds);
      }
      return Array.from(recordIds);
    }
  
    private collectRecordsInPath(node: MerkleNode | null, currentPath: string, targetPath: string, recordIds: Set<string>) {
  if (!node) return;

  // If we've reached the target path exactly, collect all records in this subtree
  if (currentPath === targetPath) {
    this.collectAllRecordsInSubtree(node, recordIds);
    return;
  }

  // If the target path starts with current path, we need to go deeper
  if (targetPath.startsWith(currentPath)) {
    const nextChar = targetPath[currentPath.length];
    if (nextChar === 'L' && node.left) {
      this.collectRecordsInPath(node.left, currentPath + 'L', targetPath, recordIds);
    }
    if (nextChar === 'R' && node.right) {
      this.collectRecordsInPath(node.right, currentPath + 'R', targetPath, recordIds);
    }
  }
}

// Collect all records in a subtree:
private collectAllRecordsInSubtree(node: MerkleNode | null, recordIds: Set<string>) {
  if (!node) return;
  
  if (node.isLeaf && node.recordId) {
    recordIds.add(node.recordId);
  }
  
  if (node.left) this.collectAllRecordsInSubtree(node.left, recordIds);
  if (node.right) this.collectAllRecordsInSubtree(node.right, recordIds);
}
  
    findDifferingPaths(peerSubtrees: {path: string, hash: string}[]): string[] {
      const peerHashMap = new Map(peerSubtrees.map(s => [s.path, s.hash]));
      const ourSubtrees = this.getAllSubtreeHashes(3);
      const differingPaths: string[] = [];

      if (peerSubtrees.length === 0 && ourSubtrees.length > 0) {
        console.log('Peer has empty tree, marking all local paths as differing');
        return ourSubtrees.map(s => s.path);
      }

      for (const {path, hash} of ourSubtrees) {
        const peerHash = peerHashMap.get(path);
        if (!peerHash || peerHash !== hash) {
          differingPaths.push(path);
        }
      }

      return differingPaths;
    }
  
    printTree(): void {
      console.log('Merkle Tree Structure:');
      this.printNode(this.root, '', true);
    }
  
    private printNode(node: MerkleNode | null, prefix: string, isLast: boolean): void {
      if (!node) return;
      console.log(prefix + (isLast ? '└── ' : '├── ') + 
        (node.isLeaf ? `LEAF(${node.recordId}): ` : 'NODE: ') + 
        formatHash(node.hash) +
        ` [h=${node.height}]`);
      if (node.left || node.right) {
        if (node.left) this.printNode(node.left, prefix + (isLast ? '    ' : '│   '), !node.right);
        if (node.right) this.printNode(node.right, prefix + (isLast ? '    ' : '│   '), true);
      }
    }
  }
  
  // --- Global tree instance ---
  let merkleTree: IncrementalMerkleTree | null = null;
  
  // Batch helper
  function batchRecords(records: Record<string, any>, batchSize = 100): Record<string, any>[] {
    const keys = Object.keys(records);
    const batches: Record<string, any>[] = [];
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch: Record<string, any> = {};
      keys.slice(i, i + batchSize).forEach(k => batch[k] = records[k]);
      batches.push(batch);
    }
    return batches;
  }
  
  function sendRecordsBatched(records: Record<string, any>, peerId?: string) {
    const batchSize = 1000;
    const batches = batchRecords(records, batchSize);
    let index = 0;

    function sendNextBatch() {
      if (index >= batches.length) return;
      const batch = batches[index];
      console.log(`Sending batch ${index + 1}/${batches.length} with ${Object.keys(batch).length} records to ${peerId || 'all peers'}`);
      sendRecords(batch, peerId);
      index++;
      setTimeout(sendNextBatch, 100);
    }

    sendNextBatch();
  }
  
  // Rebuild Merkle tree helper - now async
  async function rebuildMerkleTree(records: Record<string, any>) {
    console.log(`Rebuilding Merkle tree with ${Object.keys(records).length} records`);
    merkleTree = new IncrementalMerkleTree(records);
    await merkleTree.initialize(); // Compute the hashes asynchronously
    const newRootHash = merkleTree.getRootHash();
    console.log(`New root hash: ${formatHash(newRootHash)}`);
    merkleRoot.set(newRootHash);
    return newRootHash;
  }
  
  // Prune old records - now async
  async function pruneOldRecords() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let hasChanges = false;
    recordStore.update(local => {
      for (const uuid in local) {
        if (local[uuid].created_at < cutoff) {
          delete local[uuid];
          deleteRecord(uuid);
          hasChanges = true;
        }
      }
      return local;
    });
  
    if (hasChanges) {
      const allRecords = get(recordStore);
      await rebuildMerkleTree(allRecords);
    }
  }
  
  // Improved record buffer
  class IncrementalRecordBuffer {
    private buffer: Record<string, any> = {};
    private flushTimeout: number | null = null;

    add(records: Record<string, any>) {
      Object.assign(this.buffer, records);
      if (this.flushTimeout) clearTimeout(this.flushTimeout);
      this.flushTimeout = setTimeout(() => this.flush(), 100);
    }

    private async flush() {
      if (Object.keys(this.buffer).length === 0) return;
      const toProcess = { ...this.buffer };
      this.buffer = {};
      console.log(`Processing ${Object.keys(toProcess).length} buffered records`);
      
      recordStore.update(local => ({ ...local, ...toProcess }));
      const moderatedRecords: [string, any][] = [];
      
      for (const [uuid, record] of Object.entries(toProcess)) {
        const isApproved = await moderateRecord(record);
        if (isApproved) {
          moderatedRecords.push([uuid, record]);
        } else {
          console.log(`Record ${uuid} rejected by moderation`);
          recordStore.update(local => {
            const updated = { ...local };
            delete updated[uuid];
            return updated;
          });
        }
      }
      
      await Promise.all(moderatedRecords.map(([uuid, record]) => saveRecord(uuid, record)));
      const allRecords = get(recordStore);
      await rebuildMerkleTree(allRecords);
    }

    async forceFlush() {
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        await this.flush();
      }
    }
  }
  
  const recordBuffer = new IncrementalRecordBuffer();
  
  // --- Main mount ---
  onMount(async () => {
    [sendRootHash, getRootHash] = room.makeAction('rootHash');
    [sendSubtree, getSubtree] = room.makeAction('subtreeHash');
    [sendRecords, getRecords] = room.makeAction('fullRecords');
  
    // 1️⃣ Load persisted records and build initial tree
    console.log('Loading persisted records from IndexedDB...');
    const persisted = await getAllRecords();
    console.log(`Persisted records from IndexedDB: ${Object.keys(persisted).length} records`);
    
    recordStore.set(persisted);
    const rootHash = await rebuildMerkleTree(persisted);
    console.log(`Initial setup complete - Root hash: ${formatHash(rootHash)}`);
  
    // 2️⃣ Send root hash on peer join
    room.onPeerJoin(async (peerId) => {
      initPeerTraffic(peerId);
      
      if (!merkleTree) {
        console.warn(`Merkle tree not ready when peer ${peerId} joined, rebuilding...`);
        const currentRecords = get(recordStore);
        await rebuildMerkleTree(currentRecords);
      }
      
      const currentRootHash = merkleTree?.getRootHash() || '';
      console.log(`Peer ${peerId} joined, sending root hash: ${formatHash(currentRootHash)}`);
      sendRootHash(currentRootHash, peerId);
      peerTraffic[peerId].sent.roothashs += 1;
      peerTraffic = { ...peerTraffic };
    });
  
    // 3️⃣ Receive root hash → send subtrees if differ
    getRootHash(async (peerRootHash, peerId) => {
    initPeerTraffic(peerId);
    
    if (!merkleTree) {
      console.warn(`Merkle tree not ready for peer ${peerId}, rebuilding...`);
      const currentRecords = get(recordStore);
      await rebuildMerkleTree(currentRecords);
    }

    peerTraffic[peerId].recv.roothashs += 1;
    peerTraffic = { ...peerTraffic };

    const ourRootHash = merkleTree?.getRootHash() || '';
    console.log(`Received root hash from ${peerId}: ${formatHash(peerRootHash)} vs ours: ${formatHash(ourRootHash)}`);

    // Handle fresh node case first (most efficient - send all records)
    if (peerRootHash === 'freshNode' && ourRootHash !== 'freshNode') {
      console.log(`Peer ${peerId} is freshNode, sending all our records`);
      const snapshot = get(recordStore);
      const recordsToSend: Record<string, any> = { ...snapshot };
      console.log(`Sending ${Object.keys(recordsToSend).length} records to ${peerId}`);
      sendRecordsBatched(recordsToSend, peerId);
      peerTraffic[peerId].sent.records += Object.keys(recordsToSend).length;
      statRecordsSent += Object.keys(recordsToSend).length;
      peerTraffic = { ...peerTraffic };
    }
    // Handle case where both have hashes but they differ (Merkle sync)
    else if (peerRootHash !== 'freshNode' && ourRootHash !== 'freshNode' && peerRootHash !== ourRootHash) {
      const allSubtrees = merkleTree?.getAllSubtreeHashes(3) || [];
      console.log(`Root hashes differ, sending ${allSubtrees.length} subtree hashes to ${peerId}`);
      sendSubtree(allSubtrees, peerId);
      peerTraffic[peerId].sent.subtrees += allSubtrees.length;
      statSubtreesExchanged += allSubtrees.length;
      peerTraffic = { ...peerTraffic };
    }
    // Handle case where hashes match (do nothing)
    else if (peerRootHash === ourRootHash && peerRootHash !== 'freshNode') {
      console.log(`Root hashes match with ${peerId}, no sync needed`);
    }
  });
  
    // 4️⃣ Receive subtree → find differences and send relevant records
    getSubtree(async (peerSubtreeData: { path: string, hash: string }[], peerId) => {
      initPeerTraffic(peerId);
      
      if (!merkleTree) {
        console.warn(`Merkle tree not ready for subtree comparison with ${peerId}, rebuilding...`);
        const currentRecords = get(recordStore);
        await rebuildMerkleTree(currentRecords);
      }

      peerTraffic[peerId].recv.subtrees += peerSubtreeData.length;
      statSubtreesExchanged += peerSubtreeData.length;
      peerTraffic = { ...peerTraffic };

      const ourRootHash = merkleTree?.getRootHash() || '';
      if (!ourRootHash && peerSubtreeData.length > 0) {
        console.log(`Local tree is empty, requesting records for ${peerSubtreeData.length} subtrees from ${peerId}`);
        const ourSubtrees = merkleTree?.getAllSubtreeHashes(3) || [];
        sendSubtree(ourSubtrees, peerId);
        peerTraffic[peerId].sent.subtrees += ourSubtrees.length;
        statSubtreesExchanged += ourSubtrees.length;
        peerTraffic = { ...peerTraffic };
        return;
      }

      const differingPaths = merkleTree?.findDifferingPaths(peerSubtreeData) || [];
      console.log(`Found ${differingPaths.length} differing paths with ${peerId}:`, differingPaths);

      if (differingPaths.length > 0) {
        const recordIds = merkleTree?.getRecordsForPaths(differingPaths) || [];
        const recordsToSend: Record<string, any> = {};
        const snapshot = get(recordStore);
        
        for (const recordId of recordIds) {
          if (snapshot[recordId]) {
            recordsToSend[recordId] = snapshot[recordId];
          }
        }
        
        console.log(`Sending ${Object.keys(recordsToSend).length} records to ${peerId}`);
        sendRecordsBatched(recordsToSend, peerId);        
        peerTraffic[peerId].sent.records += Object.keys(recordsToSend).length;
        statRecordsSent += Object.keys(recordsToSend).length;
        peerTraffic = { ...peerTraffic };
      }
    });
  
    // 5️⃣ Receive records → buffer for incremental processing
    getRecords(async (records: Record<string, any>, peerId) => {
  initPeerTraffic(peerId);
  const recordCount = Object.keys(records).length;
  console.log(`Received ${recordCount} records from ${peerId}`);
  
  peerTraffic[peerId].recv.records += recordCount;
  statReceivedRecords += recordCount;
  peerTraffic = { ...peerTraffic };
  
  recordBuffer.add(records);
  lastActivity[peerId] = Date.now();
  
  // Force flush and rebuild tree
  await recordBuffer.forceFlush();
  
  // Add small delay to ensure processing is complete
  await new Promise(resolve => setTimeout(resolve, 100));
  
  });
  
    // 6️⃣ Idle check → broadcast updated roothash after inactivity after onpeerjoin() 
    setInterval(() => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId];
          if (merkleTree) {
            const rootHash = merkleTree.getRootHash();
            console.log(`Peer ${peerId} went idle, broadcasting root hash: ${formatHash(rootHash)}`);
            sendRootHash(rootHash);
            peerTraffic[peerId].sent.roothashs += 1;
            peerTraffic = { ...peerTraffic };
          }
        }
      }
    }, 1000);
  
    // 7️⃣ Periodic pruning
    setInterval(() => pruneOldRecords(), PRUNE_INTERVAL);
    
    return () => {
      recordBuffer.forceFlush();
    };
  });
</script>

<main style="margin:0; padding:0; width: 95%; height: 95%;">

  <div style="margin:0; padding:0; background-color:dimgray;">
    <a href="https://github.com/worldpeaceenginelabs/CLOUD-ATLAS.peerset.DB"><img height="50" width="50" src="github.jpg"></a>
  </div>

  <Ui
    {statReceivedRecords}
    {statSubtreesExchanged}
    {statRecordsSent}
    {peerTraffic}
  />
  
  <RecordGenerator />

</main>