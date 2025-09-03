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
  
  // --- Stats for UI ---
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0; // Track subtrees as buckets
  let statRecordsRequested = 0; // Track record IDs exchanged
  let statRecordsExchanged = 0; // Track full records sent
  let peerTraffic: Record<string, { sent: { buckets: number; uuids: number; requests: number; records: number }, recv: { buckets: number; uuids: number; requests: number; records: number } }> = {};

  // --- Trystero setup ---
  const config = { appId: 'testpeer' };
  const room = joinRoom(config, 'testroom_lazyMerkle');
  
  let sendRootHash, getRootHash;
  let sendSubtree, getSubtree;
  let sendRecords, getRecords;
  
  const IDLE_TIMEOUT = 5000;
  const PRUNE_INTERVAL = 5 * 60 * 1000; // 5 min
  const RETENTION_DAYS = 90;
  const lastActivity: Record<string, number> = {};
  
  // --- Initialize peerTraffic for a peer ---
  function initPeerTraffic(peerId: string) {
    if (!peerTraffic[peerId]) {
      peerTraffic[peerId] = {
        sent: { buckets: 0, uuids: 0, requests: 0, records: 0 },
        recv: { buckets: 0, uuids: 0, requests: 0, records: 0 }
      };
      // Trigger reactivity
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
     // Filter valid records with a hash property
    console.log('Records passed to Merkle tree:', records);
    const validRecords = Object.values(records).filter(record => record && typeof record.hash === 'string');
    console.log('Valid records:', validRecords.length);

    // Insert records in a balanced way
    this.bulkInsert(validRecords);
    this.recomputeHashes(this.root);
  }

  private bulkInsert(records: any[]) {
    // Sort records by hash to create a balanced tree
    const sortedRecords = records.length > 0 
      ? records.sort((a, b) => a.hash.localeCompare(b.hash))
      : [];

    // Build tree in a balanced manner (e.g., using a sorted array to tree algorithm)
    this.root = this.buildBalancedTree(sortedRecords, 0, sortedRecords.length - 1);
  }

  private buildBalancedTree(records: any[], start: number, end: number): MerkleNode | null {
    if (start > end) return null;

    // Find middle record to make root
    const mid = Math.floor((start + end) / 2);
    const record = records[mid];
    const newNode: MerkleNode = {
      hash: record.hash,
      isLeaf: true,
      recordId: record.uuid,
      height: 0
    };

    this.recordIndex.set(record.uuid, newNode);

    // Recursively build left and right subtrees
    newNode.left = this.buildBalancedTree(records, start, mid - 1);
    newNode.right = this.buildBalancedTree(records, mid + 1, end);

    // Update height
    newNode.height = 1 + Math.max(this.getHeight(newNode.left), this.getHeight(newNode.right));

    // Rebalance if needed
    return this.rebalance(newNode);
  }
  
    getRootHash(): string {
      return this.root?.hash || '';
    }
  
    // O(log n) insertion
    insertRecord(record: any, updateHashes = true): void {
      const newLeaf: MerkleNode = {
        hash: record.hash,
        isLeaf: true,
        recordId: record.uuid,
        height: 0
      };
  
      this.recordIndex.set(record.uuid, newLeaf);
      this.root = this.insertNode(this.root, newLeaf);
      
      if (updateHashes) {
        this.recomputeHashes(this.root);
      }
    }
  
    // O(log n) deletion  
    deleteRecord(recordId: string): void {
      const nodeToDelete = this.recordIndex.get(recordId);
      if (!nodeToDelete) return;
  
      this.recordIndex.delete(recordId);
      this.root = this.deleteNode(this.root, nodeToDelete.hash);
      this.recomputeHashes(this.root);
    }
  
    // O(log n) update
    updateRecord(oldRecord: any, newRecord: any): void {
      this.deleteRecord(oldRecord.uuid);
      this.insertRecord(newRecord);
    }
  
    private insertNode(node: MerkleNode | null, newNode: MerkleNode, depth = 0, maxDepth = 1000): MerkleNode {
  if (depth > maxDepth) {
    throw new Error(`Maximum recursion depth exceeded while inserting node with hash ${newNode.hash.substring(0, 8)}...`);
  }

  if (!node) {
    newNode.height = 0;
    console.debug(`Inserted leaf node with hash ${newNode.hash.substring(0, 8)}...`);
    return newNode;
  }

  // Compare hashes to decide insertion direction
  const comparison = newNode.hash.localeCompare(node.hash);
  console.debug(`Comparing hashes: ${newNode.hash.substring(0, 8)}... vs ${node.hash.substring(0, 8)}..., result: ${comparison}`);

  if (comparison < 0) {
    node.left = this.insertNode(node.left, newNode, depth + 1, maxDepth);
  } else if (comparison > 0) {
    node.right = this.insertNode(node.right, newNode, depth + 1, maxDepth);
  } else {
    // Handle equal hashes (e.g., collision or duplicate)
    console.warn(`Duplicate hash detected: ${newNode.hash}. Skipping insertion.`);
    return node;
  }

  // Update height
  node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));

  // Rebalance
  return this.rebalance(node);
}
  
    private deleteNode(node: MerkleNode | null, hash: string): MerkleNode | null {
      if (!node) return null;
  
      if (hash < node.hash) {
        node.left = this.deleteNode(node.left, hash);
      } else if (hash > node.hash) {
        node.right = this.deleteNode(node.right, hash);
      } else {
        // Node to delete found
        if (!node.left) return node.right;
        if (!node.right) return node.left;
  
        // Node with two children: find inorder successor
        const successor = this.findMin(node.right);
        node.hash = successor.hash;
        node.recordId = successor.recordId;
        node.isLeaf = successor.isLeaf;
        node.right = this.deleteNode(node.right, successor.hash);
      }
  
      // Update height and rebalance
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
  if (!node) return node; // Early exit for null nodes

  const balance = this.getBalance(node);

  // Only log if an actual rotation is needed to reduce noise
  if (balance > 1 || balance < -1) {
    console.debug(`Rebalancing node with hash ${node.hash.substring(0, 8)}..., balance: ${balance}`);
  }

  // Left heavy
  if (balance > 1) {
    if (node.left && this.getBalance(node.left) < 0) {
      console.debug(`Performing left-right rotation on ${node.hash.substring(0, 8)}...`);
      node.left = this.rotateLeft(node.left);
    }
    console.debug(`Performing right rotation on ${node.hash.substring(0, 8)}...`);
    return this.rotateRight(node);
  }

  // Right heavy
  if (balance < -1) {
    if (node.right && this.getBalance(node.right) > 0) {
      console.debug(`Performing right-left rotation on ${node.hash.substring(0, 8)}...`);
      node.right = this.rotateRight(node.right);
    }
    console.debug(`Performing left rotation on ${node.hash.substring(0, 8)}...`);
    return this.rotateLeft(node);
  }

  return node;
}

private rotateLeft(node: MerkleNode): MerkleNode {
  if (!node.right) throw new Error(`Cannot rotate left: no right child for node ${node.hash.substring(0, 8)}...`);
  console.debug(`Rotating left on ${node.hash.substring(0, 8)}...`);
  const newRoot = node.right;
  node.right = newRoot.left;
  newRoot.left = node;

  // Update heights
  node.height = 1 + Math.max(this.getHeight(node.left), this.getHeight(node.right));
  newRoot.height = 1 + Math.max(this.getHeight(newRoot.left), this.getHeight(newRoot.right));

  return newRoot;
}

private rotateRight(node: MerkleNode): MerkleNode {
  if (!node.left) throw new Error(`Cannot rotate right: no left child for node ${node.hash.substring(0, 8)}...`);
  console.debug(`Rotating right on ${node.hash.substring(0, 8)}...`);
  const newRoot = node.left;
  node.left = newRoot.right;
  newRoot.right = node;

  // Update heights
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
  
      // Recursively update children first
      if (node.left) this.recomputeHashes(node.left);
      if (node.right) this.recomputeHashes(node.right);
  
      // Update this node's hash if it's not a leaf
      if (!node.isLeaf) {
        const leftHash = node.left?.hash || '';
        const rightHash = node.right?.hash || '';
        node.hash = sha256(leftHash + rightHash);
      }
    }
  
    // Get all subtree hashes for sync protocol
    getAllSubtreeHashes(maxDepth = 3): {path: string, hash: string}[] {
      const result: {path: string, hash: string}[] = [];
      this.collectSubtreeHashes(this.root, 'root', maxDepth, result);
      return result;
    }
  
    private collectSubtreeHashes(
      node: MerkleNode | null, 
      path: string, 
      depth: number, 
      result: {path: string, hash: string}[]
    ): void {
      if (!node || depth <= 0) return;
  
      result.push({ path, hash: node.hash });
  
      if (!node.isLeaf && depth > 1) {
        if (node.left) {
          this.collectSubtreeHashes(node.left, path + 'L', depth - 1, result);
        }
        if (node.right) {
          this.collectSubtreeHashes(node.right, path + 'R', depth - 1, result);
        }
      }
    }
  
    // Find records in differing subtrees
    getRecordsForPaths(differingPaths: string[]): string[] {
      const recordIds: string[] = [];
      for (const path of differingPaths) {
        this.collectRecordsInPath(this.root, 'root', path, recordIds);
      }
      return recordIds;
    }
  
    private collectRecordsInPath(
      node: MerkleNode | null,
      currentPath: string,
      targetPath: string,
      recordIds: string[]
    ): void {
      if (!node) return;
  
      // If we've reached the target path or are within it, collect all leaves
      if (currentPath === targetPath || targetPath.startsWith(currentPath)) {
        if (node.isLeaf && node.recordId) {
          recordIds.push(node.recordId);
          return;
        }
        
        // Continue collecting from all children if we're at/within target path
        if (node.left) this.collectRecordsInPath(node.left, currentPath + 'L', targetPath, recordIds);
        if (node.right) this.collectRecordsInPath(node.right, currentPath + 'R', targetPath, recordIds);
      } else if (targetPath.startsWith(currentPath)) {
        // We need to go deeper toward the target path
        if (targetPath[currentPath.length] === 'L' && node.left) {
          this.collectRecordsInPath(node.left, currentPath + 'L', targetPath, recordIds);
        }
        if (targetPath[currentPath.length] === 'R' && node.right) {
          this.collectRecordsInPath(node.right, currentPath + 'R', targetPath, recordIds);
        }
      }
    }
  
    // Compare with peer's subtree hashes to find differences
    findDifferingPaths(peerSubtrees: {path: string, hash: string}[]): string[] {
  const peerHashMap = new Map(peerSubtrees.map(s => [s.path, s.hash]));
  const ourSubtrees = this.getAllSubtreeHashes(3);
  const differingPaths: string[] = [];

  // If peer has no subtrees (empty tree), return all our paths
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
  
    // Debug: Print tree structure
    printTree(): void {
      console.log('Merkle Tree Structure:');
      this.printNode(this.root, '', true);
    }
  
    private printNode(node: MerkleNode | null, prefix: string, isLast: boolean): void {
      if (!node) return;
  
      console.log(prefix + (isLast ? '└── ' : '├── ') + 
        (node.isLeaf ? `LEAF(${node.recordId}): ` : 'NODE: ') + 
        node.hash.substring(0, 8) + '...' +
        ` [h=${node.height}]`);
  
      if (node.left || node.right) {
        if (node.left) this.printNode(node.left, prefix + (isLast ? '    ' : '│   '), !node.right);
        if (node.right) this.printNode(node.right, prefix + (isLast ? '    ' : '│   '), true);
      }
    }
  }
  
  // --- Global tree instance ---
  let merkleTree: IncrementalMerkleTree | null = null;
  
  // --- Batch helper ---
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
  const batchSize = 1000; // Increase batch size for large datasets
  const batches = batchRecords(records, batchSize);
  let index = 0;

  function sendNextBatch() {
    if (index >= batches.length) return;
    const batch = batches[index];
    console.log(`Sending batch ${index + 1}/${batches.length} with ${Object.keys(batch).length} records to ${peerId || 'all peers'}`);
    sendRecords(batch, peerId);
    index++;
    setTimeout(sendNextBatch, 100); // 100ms delay between batches
  }

  sendNextBatch();
}
  
  // --- Prune old records with incremental tree updates ---
  function pruneOldRecords() {
    const cutoff = Date.now() - RETENTION_DAYS * 24*60*60*1000;
    let hasChanges = false;
    const recordsToDelete: string[] = [];
  
    recordStore.update(local => {
      for (const uuid in local) {
        if (local[uuid].createdAt < cutoff) {
          recordsToDelete.push(uuid);
          delete local[uuid];
          deleteRecord(uuid);
          hasChanges = true;
        }
      }
      return local;
    });
  
    // Incrementally remove records from tree - O(k log n) where k is number deleted
    if (hasChanges && merkleTree) {
      for (const recordId of recordsToDelete) {
        merkleTree.deleteRecord(recordId);
      }
      merkleRoot.set(merkleTree.getRootHash());
    }
  }
  
  // --- Improved record buffer with incremental updates ---
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

  // Update store
  recordStore.update(local => ({ ...local, ...toProcess }));

  // Moderation logic: Filter records before saving to IndexedDB
  const moderatedRecords: [string, any][] = [];
  for (const [uuid, record] of Object.entries(toProcess)) {
    const isApproved = await moderateRecord(record); // Your moderation function
    if (isApproved) {
      moderatedRecords.push([uuid, record]);
    } else {
      console.log(`Record ${uuid} rejected by moderation`);
      // Optionally remove from recordStore if rejected
      recordStore.update(local => {
        const updated = { ...local };
        delete updated[uuid];
        return updated;
      });
    }
  }

  // Persist approved records to IndexedDB
  await Promise.all(
    moderatedRecords.map(([uuid, record]) => saveRecord(uuid, record))
  );

  // Incremental tree updates - O(k log n) where k is number of new records
  if (merkleTree) {
    for (const [, record] of moderatedRecords) {
      merkleTree.insertRecord(record);
    }
    merkleRoot.set(merkleTree.getRootHash());
  }
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
    const persisted = await getAllRecords();
    recordStore.set(persisted);
    
    // Build tree once at startup - O(n log n), but only once!
    merkleTree = new IncrementalMerkleTree(persisted);
    merkleRoot.set(merkleTree.getRootHash());
  
    console.log(`Initialized Merkle tree with ${Object.keys(persisted).length} records`);
    // Uncomment to see tree structure: merkleTree.printTree();
  
    // 2️⃣ Send root hash on peer join
    room.onPeerJoin(peerId => {
      initPeerTraffic(peerId);
      if (merkleTree) {
        console.log(`Peer ${peerId} joined, sending root hash: ${merkleTree.getRootHash().substring(0, 8)}...`);
        sendRootHash(merkleTree.getRootHash(), peerId);
        peerTraffic[peerId].sent.requests += 1;
        peerTraffic = { ...peerTraffic };
      }
    });
  
    // 3️⃣ Receive root hash → send subtrees if differ  
    // In App.svelte, within onMount
getRootHash((peerRootHash, peerId) => {
  initPeerTraffic(peerId);
  if (!merkleTree) return;

  peerTraffic[peerId].recv.requests += 1;
  peerTraffic = { ...peerTraffic };

  const ourRootHash = merkleTree.getRootHash();
  console.log(`Received root hash from ${peerId}: ${peerRootHash.substring(0, 8)}... vs ours: ${ourRootHash.substring(0, 8)}...`);

  if (peerRootHash !== ourRootHash) {
    const allSubtrees = merkleTree.getAllSubtreeHashes(3);
    console.log(`Sending ${allSubtrees.length} subtree hashes to ${peerId}`);
    sendSubtree(allSubtrees, peerId);
    peerTraffic[peerId].sent.buckets += allSubtrees.length;
    statSubtreesExchanged += allSubtrees.length;
    peerTraffic = { ...peerTraffic };
  }
  // Handle empty peer tree (fresh peer)
  if (!peerRootHash && ourRootHash) {
    console.log(`Peer ${peerId} has empty tree, sending all records`);
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
  if (!merkleTree) return;

  peerTraffic[peerId].recv.buckets += peerSubtreeData.length;
  statSubtreesExchanged += peerSubtreeData.length;
  peerTraffic = { ...peerTraffic };

  // If local tree is empty, request all records from peer's subtrees
  if (!merkleTree.getRootHash() && peerSubtreeData.length > 0) {
    console.log(`Local tree is empty, requesting all records for ${peerSubtreeData.length} subtrees from ${peerId}`);
    const recordIds = peerSubtreeData.map(s => s.path); // Treat paths as placeholders to request records
    const recordsToSend: Record<string, any> = {};
    // Since we're empty, we can't send records, but we can request them
    // Here, we rely on the peer to send records for these paths
    return; // The peer will send records due to findDifferingPaths returning all paths
  }

  const differingPaths = merkleTree.findDifferingPaths(peerSubtreeData);
  console.log(`Found ${differingPaths.length} differing paths with ${peerId}:`, differingPaths);

  if (differingPaths.length > 0) {
    const recordIds = merkleTree.getRecordsForPaths(differingPaths);
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
      peerTraffic[peerId].recv.records += Object.keys(records).length;
      statReceivedRecords += Object.keys(records).length;
      peerTraffic = { ...peerTraffic };
      recordBuffer.add(records);
      lastActivity[peerId] = Date.now();
    });
  
    // 6️⃣ Idle check → broadcast updated root
    setInterval(() => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId];
          if (merkleTree) {
            console.log(`Peer ${peerId} went idle, broadcasting root hash`);
            sendRootHash(merkleTree.getRootHash());
            peerTraffic[peerId].sent.requests += 1;
            peerTraffic = { ...peerTraffic };
          }
        }
      }
    }, 1000);
  
    // 7️⃣ Periodic pruning with incremental updates
    setInterval(() => pruneOldRecords(), PRUNE_INTERVAL);
    
    // Cleanup on unmount
    return () => {
      recordBuffer.forceFlush();
    };
  });
  </script>

<Ui
{statReceivedRecords}
{statSubtreesExchanged}
{statRecordsRequested}
{statRecordsExchanged}
{peerTraffic}
/>