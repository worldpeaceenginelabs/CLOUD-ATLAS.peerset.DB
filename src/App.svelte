<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord, deleteRecord } from './db.js';
  import { sha256 } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { recordStore, merkleRoot } from './stores';
    import RecordGenerator from './RecordGenerator.svelte';
  
  // --- Stats for UI ---
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0;
  let statRecordsRequested = 0;
  let statRecordsExchanged = 0;
  let peerTraffic: Record<string, { sent: { buckets: number; uuids: number; requests: number; records: number }, recv: { buckets: number; uuids: number; requests: number; records: number } }> = {};
  
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
  
  // Ensure record has proper hash
  function ensureRecordHash(uuid: string, record: any): any {
    if (!record.hash) {
      console.log(`Computing missing hash for record ${uuid}`);
      record.hash = sha256(JSON.stringify({ 
        uuid, 
        content: record.content, 
        createdAt: record.createdAt 
      }));
    }
    return record;
  }
  
  // Initialize peerTraffic for a peer
  function initPeerTraffic(peerId: string) {
    if (!peerTraffic[peerId]) {
      peerTraffic[peerId] = {
        sent: { buckets: 0, uuids: 0, requests: 0, records: 0 },
        recv: { buckets: 0, uuids: 0, requests: 0, records: 0 }
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
      
      // Ensure all records have hashes and filter invalid ones
      const validRecords = Object.entries(records)
        .map(([uuid, record]) => ensureRecordHash(uuid, record))
        .filter(record => record && typeof record.hash === 'string');
      
      console.log(`Valid records after filtering: ${validRecords.length}`);
      
      if (validRecords.length > 0) {
        this.bulkInsert(validRecords);
        this.recomputeHashes(this.root);
      }
      
      const rootHash = this.getRootHash();
      console.log(`Merkle tree built with root hash: ${formatHash(rootHash)}`);
    }

    getRootHash(): string {
      return this.root?.hash || '';
    }

    private bulkInsert(records: any[]) {
      const sortedRecords = records.sort((a, b) => a.hash.localeCompare(b.hash));
      this.root = this.buildBalancedTree(sortedRecords, 0, sortedRecords.length - 1);
      console.log(`Built balanced tree with ${sortedRecords.length} records`);
    }

    private buildBalancedTree(records: any[], start: number, end: number): MerkleNode | null {
      if (start > end) return null;
      if (start === end) {
        // True leaf
        const record = records[start];
        const newNode: MerkleNode = {
          hash: record.hash,
          recordId: record.uuid,
          height: 0,
          isLeaf: true
        };
        this.recordIndex.set(record.uuid, newNode);
        return newNode;
      }

      // Internal node
      const mid = Math.floor((start + end) / 2);
      const newNode: MerkleNode = {
        hash: '', // Will be computed in recomputeHashes
        height: 0,
        isLeaf: false
      };
      newNode.left = this.buildBalancedTree(records, start, mid);
      newNode.right = this.buildBalancedTree(records, mid + 1, end);
      newNode.height = 1 + Math.max(this.getHeight(newNode.left), this.getHeight(newNode.right));
      return this.rebalance(newNode);
    }
  
    private insertNode(node: MerkleNode | null, newNode: MerkleNode, depth = 0, maxDepth = 1000): MerkleNode {
      if (depth > maxDepth) {
        throw new Error(`Maximum recursion depth exceeded while inserting node with hash ${formatHash(newNode.hash)}`);
      }

      if (!node) {
        newNode.height = 0;
        console.debug(`Inserted leaf node with hash ${formatHash(newNode.hash)}`);
        return newNode;
      }

      const comparison = newNode.hash.localeCompare(node.hash);
      console.debug(`Comparing hashes: ${formatHash(newNode.hash)} vs ${formatHash(node.hash)}, result: ${comparison}`);

      if (comparison < 0) {
        node.left = this.insertNode(node.left, newNode, depth + 1, maxDepth);
      } else if (comparison > 0) {
        node.right = this.insertNode(node.right, newNode, depth + 1, maxDepth);
      } else {
        console.warn(`Duplicate hash detected: ${formatHash(newNode.hash)}. Skipping insertion.`);
        return node;
      }

      node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
      return this.rebalance(node);
    }
  
    private deleteNode(node: MerkleNode | null, hash: string): MerkleNode | null {
      if (!node) return null;

      if (hash < node.hash) {
        node.left = this.deleteNode(node.left, hash);
      } else if (hash > node.hash) {
        node.right = this.deleteNode(node.right, hash);
      } else {
        if (!node.left) return node.right;
        if (!node.right) return node.left;

        const successor = this.findMin(node.right);
        node.hash = successor.hash;
        node.recordId = successor.recordId;
        node.isLeaf = successor.isLeaf;
        node.right = this.deleteNode(node.right, successor.hash);
      }

      node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
      return this.rebalance(node);
    }
  
    private findMin(node: MerkleNode): MerkleNode {
      while (node.left) {
        node = node.left;
      }
      return node;
    }
  
    private rebalance(node: MerkleNode): MerkleNode {
      if (!node) return node;

      const balance = this.getBalance(node);

      if (balance > 1 || balance < -1) {
        console.debug(`Rebalancing node with hash ${formatHash(node.hash)}, balance: ${balance}`);
      }

      if (balance > 1) {
        if (node.left && this.getBalance(node.left) < 0) {
          console.debug(`Performing left-right rotation on ${formatHash(node.hash)}`);
          node.left = this.rotateLeft(node.left);
        }
        console.debug(`Performing right rotation on ${formatHash(node.hash)}`);
        return this.rotateRight(node);
      }

      if (balance < -1) {
        if (node.right && this.getBalance(node.right) > 0) {
          console.debug(`Performing right-left rotation on ${formatHash(node.hash)}`);
          node.right = this.rotateRight(node.right);
        }
        console.debug(`Performing left rotation on ${formatHash(node.hash)}`);
        return this.rotateLeft(node);
      }

      return node;
    }

    private rotateLeft(node: MerkleNode): MerkleNode {
      if (!node.right) throw new Error(`Cannot rotate left: no right child for node ${formatHash(node.hash)}`);
      console.debug(`Rotating left on ${formatHash(node.hash)}`);
      const newRoot = node.right;
      node.right = newRoot.left;
      newRoot.left = node;

      node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
      newRoot.height = 1 + Math.max(this.getHeight(newRoot.left), this.getHeight(newRoot.right));

      return newRoot;
    }

    private rotateRight(node: MerkleNode): MerkleNode {
      if (!node.left) throw new Error(`Cannot rotate right: no left child for node ${formatHash(node.hash)}`);
      console.debug(`Rotating right on ${formatHash(node.hash)}`);
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
  
    // Recompute hashes bottom-up after structural changes
    private recomputeHashes(node: MerkleNode | null): void {
      if (!node) return;
      this.recomputeHashes(node.left);
      this.recomputeHashes(node.right);
      if (node.left || node.right) {
        const leftHash = node.left?.hash || '';
        const rightHash = node.right?.hash || '';
        node.hash = sha256(leftHash + rightHash);
        console.log(`Recomputed hash for node at height ${node.height}: ${formatHash(node.hash)}`);
      }
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
  
      if (currentPath === targetPath || targetPath.startsWith(currentPath)) {
        if (node.recordId && node.isLeaf) {
          recordIds.add(node.recordId);
        }
        
        if (node.left) this.collectRecordsInPath(node.left, currentPath + 'L', targetPath, recordIds);
        if (node.right) this.collectRecordsInPath(node.right, currentPath + 'R', targetPath, recordIds);
      } else if (targetPath.startsWith(currentPath)) {
        const next = targetPath[currentPath.length];
        if (next === 'L' && node.left) this.collectRecordsInPath(node.left, currentPath + 'L', targetPath, recordIds);
        if (next === 'R' && node.right) this.collectRecordsInPath(node.right, currentPath + 'R', targetPath, recordIds);
      }
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
  
  // Rebuild Merkle tree helper
  function rebuildMerkleTree(records: Record<string, any>) {
    console.log(`Rebuilding Merkle tree with ${Object.keys(records).length} records`);
    merkleTree = new IncrementalMerkleTree(records);
    const newRootHash = merkleTree.getRootHash();
    console.log(`New root hash: ${formatHash(newRootHash)}`);
    merkleRoot.set(newRootHash);
    return newRootHash;
  }
  
  // Prune old records
  function pruneOldRecords() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let hasChanges = false;
    recordStore.update(local => {
      for (const uuid in local) {
        if (local[uuid].createdAt < cutoff) {
          delete local[uuid];
          deleteRecord(uuid);
          hasChanges = true;
        }
      }
      return local;
    });
  
    if (hasChanges) {
      const allRecords = get(recordStore);
      rebuildMerkleTree(allRecords);
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
      rebuildMerkleTree(allRecords);
    }

    forceFlush() {
      if (this.flushTimeout) {
        clearTimeout(this.flushTimeout);
        this.flush();
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
    const rootHash = rebuildMerkleTree(persisted);
    console.log(`Initial setup complete - Root hash: ${formatHash(rootHash)}`);
  
    // 2️⃣ Send root hash on peer join
    room.onPeerJoin(peerId => {
      initPeerTraffic(peerId);
      
      // Ensure tree is ready
      if (!merkleTree) {
        console.warn(`Merkle tree not ready when peer ${peerId} joined, rebuilding...`);
        const currentRecords = get(recordStore);
        rebuildMerkleTree(currentRecords);
      }
      
      const currentRootHash = merkleTree?.getRootHash() || '';
      console.log(`Peer ${peerId} joined, sending root hash: ${formatHash(currentRootHash)}`);
      sendRootHash(currentRootHash, peerId);
      peerTraffic[peerId].sent.requests += 1;
      peerTraffic = { ...peerTraffic };
    });
  
    // 3️⃣ Receive root hash → send subtrees if differ
    getRootHash((peerRootHash, peerId) => {
      initPeerTraffic(peerId);
      
      if (!merkleTree) {
        console.warn(`Merkle tree not ready for peer ${peerId}, rebuilding...`);
        const currentRecords = get(recordStore);
        rebuildMerkleTree(currentRecords);
      }

      peerTraffic[peerId].recv.requests += 1;
      peerTraffic = { ...peerTraffic };

      const ourRootHash = merkleTree?.getRootHash() || '';
      console.log(`Received root hash from ${peerId}: ${formatHash(peerRootHash)} vs ours: ${formatHash(ourRootHash)}`);

      // Handle different root hashes
      if (peerRootHash !== ourRootHash) {
        const allSubtrees = merkleTree?.getAllSubtreeHashes(3) || [];
        console.log(`Root hashes differ, sending ${allSubtrees.length} subtree hashes to ${peerId}`);
        sendSubtree(allSubtrees, peerId);
        peerTraffic[peerId].sent.buckets += allSubtrees.length;
        statSubtreesExchanged += allSubtrees.length;
        peerTraffic = { ...peerTraffic };
      }
      
      // Handle empty peer tree (fresh peer)
      if (!peerRootHash && ourRootHash) {
        console.log(`Peer ${peerId} has empty tree, sending all our records`);
        const snapshot = get(recordStore);
        const recordsToSend: Record<string, any> = { ...snapshot };
        console.log(`Sending ${Object.keys(recordsToSend).length} records to ${peerId}`);
        sendRecordsBatched(recordsToSend, peerId);
        peerTraffic[peerId].sent.records += Object.keys(recordsToSend).length;
        statRecordsExchanged += Object.keys(recordsToSend).length;
        peerTraffic = { ...peerTraffic };
      }
    });
  
    // 4️⃣ Receive subtree → find differences and send relevant records
    getSubtree((peerSubtreeData: { path: string, hash: string }[], peerId) => {
      initPeerTraffic(peerId);
      
      if (!merkleTree) {
        console.warn(`Merkle tree not ready for subtree comparison with ${peerId}, rebuilding...`);
        const currentRecords = get(recordStore);
        rebuildMerkleTree(currentRecords);
      }

      peerTraffic[peerId].recv.buckets += peerSubtreeData.length;
      statSubtreesExchanged += peerSubtreeData.length;
      peerTraffic = { ...peerTraffic };

      const ourRootHash = merkleTree?.getRootHash() || '';
      if (!ourRootHash && peerSubtreeData.length > 0) {
        console.log(`Local tree is empty, requesting records for ${peerSubtreeData.length} subtrees from ${peerId}`);
        const ourSubtrees = merkleTree?.getAllSubtreeHashes(3) || [];
        sendSubtree(ourSubtrees, peerId);
        peerTraffic[peerId].sent.buckets += ourSubtrees.length;
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
        peerTraffic[peerId].sent.uuids += recordIds.length;
        peerTraffic[peerId].sent.records += Object.keys(recordsToSend).length;
        statRecordsRequested += recordIds.length;
        statRecordsExchanged += Object.keys(recordsToSend).length;
        peerTraffic = { ...peerTraffic };
      }
    });
  
    // 5️⃣ Receive records → buffer for incremental processing
    getRecords(async (records: Record<string, any>, peerId) => {
      initPeerTraffic(peerId);
      console.log(`Received ${Object.keys(records).length} records from ${peerId}`);
      
      // Validate and ensure hashes
      const validatedRecords: Record<string, any> = {};
      for (const [uuid, record] of Object.entries(records)) {
        validatedRecords[uuid] = ensureRecordHash(uuid, record);
      }
      
      peerTraffic[peerId].recv.records += Object.keys(validatedRecords).length;
      statReceivedRecords += Object.keys(validatedRecords).length;
      peerTraffic = { ...peerTraffic };
      
      recordBuffer.add(validatedRecords);
      lastActivity[peerId] = Date.now();
      
      await recordBuffer.forceFlush();
      
      // Broadcast updated root hash
      if (merkleTree) {
        const rootHash = merkleTree.getRootHash();
        console.log(`Broadcasting updated root hash to all peers: ${formatHash(rootHash)}`);
        sendRootHash(rootHash);
        peerTraffic[peerId].sent.requests += 1;
        peerTraffic = { ...peerTraffic };
      }
    });
  
    // 6️⃣ Idle check → broadcast updated root
    setInterval(() => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId];
          if (merkleTree) {
            const rootHash = merkleTree.getRootHash();
            console.log(`Peer ${peerId} went idle, broadcasting root hash: ${formatHash(rootHash)}`);
            sendRootHash(rootHash);
            peerTraffic[peerId].sent.requests += 1;
            peerTraffic = { ...peerTraffic };
          }
        }
      }
    }, 1000);
  
    // 7️⃣ Periodic pruning
    setInterval(() => pruneOldRecords(), PRUNE_INTERVAL);
    
    // Cleanup on unmount
    return () => {
      recordBuffer.forceFlush();
    };
  });
</script>


<div class="p-4">
  
  <Ui
  {statReceivedRecords}
  {statSubtreesExchanged}
  {statRecordsRequested}
  {statRecordsExchanged}
  {peerTraffic}
/>
<RecordGenerator />
</div>

