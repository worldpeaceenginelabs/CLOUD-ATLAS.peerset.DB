<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecord } from './db.js';
  import { sha256 } from './secp256k1.js';
  import { moderateRecord } from './moderation.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { hashMapStore, merkleRoot } from './stores';
  import RecordGenerator from './RecordGenerator.svelte';
  
  // --- Stats ---
  let statRecordsSent = 0;
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0;
  let peerTraffic: Record<string, { 
    sent: { rootHashes: number; subtrees: number; records: number }; 
    recv: { rootHashes: number; subtrees: number; records: number } 
  }> = {};
  const lastActivity: Record<string, number> = {};
  const IDLE_TIMEOUT = 1000 * 60 * 5; // Increased from 5000 to 10000ms
  
  // --- P2P ---
  const config = { appId: 'simpleSync' };
  const room = joinRoom(config, 'simpleRoom');
  
  let sendRootHash, getRootHash, sendRecords, getRecords, sendSubtree, getSubtree;
  let processingRecords: Record<string, boolean> = {}; // Track record processing per peer
  let syncInProgress: Record<string, boolean> = {}; // Track sync state per peer
  let syncTimeouts: Record<string, NodeJS.Timeout> = {}; // Track sync timeouts for cleanup
  let merkleTreeCache: { hashes: Record<string, string>; root: MerkleNode; timestamp: number } | null = null;
  const MERKLE_CACHE_TTL = 1000; // Cache Merkle tree for 1 second
  let hashMapStoreUpdateQueue: Array<{ uuid: string; hash: string }> = [];
  let isUpdatingHashMapStore = false;
  
  // --- Helper Functions ---
  function initPeer(peerId: string) {
    if (!peerTraffic[peerId]) {
      peerTraffic[peerId] = { 
        sent: { rootHashes: 0, subtrees: 0, records: 0 }, 
        recv: { rootHashes: 0, subtrees: 0, records: 0 } 
      };
    }
    if (!lastActivity[peerId]) lastActivity[peerId] = Date.now();
  }

  // Clean up sync state for a peer
  function cleanupPeerSync(peerId: string) {
    if (syncTimeouts[peerId]) {
      clearTimeout(syncTimeouts[peerId]);
      delete syncTimeouts[peerId];
    }
    delete syncInProgress[peerId];
    delete processingRecords[peerId];
  }

  // Get cached Merkle tree or build new one
  async function getMerkleTree(hashes: Record<string, string>): Promise<MerkleNode> {
    const now = Date.now();
    
    // Check if cache is valid
    if (merkleTreeCache && 
        now - merkleTreeCache.timestamp < MERKLE_CACHE_TTL &&
        JSON.stringify(merkleTreeCache.hashes) === JSON.stringify(hashes)) {
      return merkleTreeCache.root;
    }
    
    // Build new tree and cache it
    const root = await buildMerkleTreeNodes(hashes);
    merkleTreeCache = { hashes: { ...hashes }, root, timestamp: now };
    return root;
  }

  // ✅ FIXED: Thread-safe hash map store update
  async function updateHashMapStore(uuid: string, hash: string): Promise<void> {
    hashMapStoreUpdateQueue.push({ uuid, hash });
    
    if (isUpdatingHashMapStore) {
      return; // Another update is in progress, this will be processed in the queue
    }
    
    isUpdatingHashMapStore = true;
    
    try {
      while (hashMapStoreUpdateQueue.length > 0) {
        const updates = hashMapStoreUpdateQueue.splice(0); // Take all pending updates
        hashMapStore.update(local => {
          const updated = { ...local };
          for (const update of updates) {
            updated[update.uuid] = update.hash;
          }
          return updated;
        });
      }
    } finally {
      isUpdatingHashMapStore = false;
    }
  }
  
  async function processRecord(uuid: string, record: any): Promise<boolean> {
    try {
      const approved = await moderateRecord(record);
      if (!approved) {
        console.log(`[SimpleSync] Record ${uuid} rejected by moderation`);
        return false;
      }

      await saveRecord(uuid, record);
      await updateHashMapStore(uuid, record.integrity.hash);
      return true;
    } catch (error) {
      console.error(`[SimpleSync] Error processing record ${uuid}:`, error);
      return false;
    }
  }
  
  // --- Fixed Merkle Tree ---
  interface MerkleNode {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
    uuids: string[];  // ✅ ALL nodes have UUIDs now
    isLeaf?: boolean;
  }
  
  /**
   * Builds a Merkle tree from record hashes with UUIDs propagated to all nodes.
   * This enables efficient diffing by knowing which records are in each subtree.
   * 
   * @param records - Object mapping UUIDs to their hash values
   * @returns Root MerkleNode with all UUIDs in the tree
   */
  async function buildMerkleTreeNodes(records: Record<string, string>): Promise<MerkleNode> {
    const keys = Object.keys(records).sort();
    
    // Handle empty tree case
    if (keys.length === 0) {
      return { hash: await sha256(''), uuids: [], isLeaf: true };
    }

    // Create leaf nodes - each contains one record's hash and UUID
    let nodes: MerkleNode[] = keys.map(uuid => ({
      hash: records[uuid], // Hash of the record content
      uuids: [uuid], // Single UUID for leaf nodes
      isLeaf: true
    }));

    // Build tree bottom-up, combining nodes pairwise
    while (nodes.length > 1) {
      const nextLevel: MerkleNode[] = [];
      
      for (let i = 0; i < nodes.length; i += 2) {
        const left = nodes[i];
        const right = nodes[i + 1];
        
        if (!right) {
          // Odd number of nodes - promote the last node up unchanged
          nextLevel.push(left);
          continue;
        }

        // Combine two nodes: hash their concatenated hashes
        const combinedHash = await sha256(left.hash + right.hash);
        // Combine and sort UUIDs from both subtrees
        const combinedUUIDs = [...left.uuids, ...right.uuids].sort();
        
        nextLevel.push({
          hash: combinedHash,
          left,
          right,
          uuids: combinedUUIDs, // All UUIDs in this subtree
          isLeaf: false
        });
      }
      
      nodes = nextLevel;
    }

    return nodes[0]; // Return the root node
  }
  
  // ✅ Fixed: Find what the remote peer is missing from us (what we can send them)
  function findWhatRemoteNeeds(ourNode: MerkleNode, theirNode?: MerkleNode): string[] {
    // If they don't have this subtree, we can send them all our UUIDs
    if (!theirNode) {
      return ourNode.uuids;
    }
    
    // If hashes match, no differences in this subtree
    if (ourNode.hash === theirNode.hash) {
      return [];
    }
    
    // If we're at a leaf, they need this UUID
    if (ourNode.isLeaf) {
      return ourNode.uuids;
    }
    
    // Recurse into children
    const leftNeeded = findWhatRemoteNeeds(
      ourNode.left!,
      theirNode.left
    );
    
    const rightNeeded = findWhatRemoteNeeds(
      ourNode.right!,
      theirNode.right
    );
    
    return [...leftNeeded, ...rightNeeded];
  }

  // ✅ Find what we're missing from the remote peer (what we need to request)
  function findWhatWeNeed(theirNode: MerkleNode, ourNode?: MerkleNode): string[] {
    // If we don't have this subtree, we need all their UUIDs
    if (!ourNode) {
      return theirNode.uuids;
    }
    
    // If hashes match, no differences in this subtree
    if (theirNode.hash === ourNode.hash) {
      return [];
    }
    
    // If they're at a leaf, we need this UUID (they have it, we don't)
    if (theirNode.isLeaf) {
      return theirNode.uuids;
    }
    
    // If we're at a leaf but they're not, we need all their UUIDs
    if (ourNode.isLeaf) {
      return theirNode.uuids;
    }
    
    // Recurse into children
    const leftNeeded = findWhatWeNeed(
      theirNode.left!,
      ourNode.left
    );
    
    const rightNeeded = findWhatWeNeed(
      theirNode.right!,
      ourNode.right
    );
    
    return [...leftNeeded, ...rightNeeded];
  }
  
  // ✅ New: Find which subtrees to request from peer
  function findNeededSubtrees(localNode: MerkleNode, remoteNode?: MerkleNode): MerkleNode[] {
    if (!remoteNode || localNode.hash === remoteNode.hash) {
      return [];
    }
    
    if (remoteNode.isLeaf) {
      return [remoteNode];
    }
    
    const neededSubtrees: MerkleNode[] = [];
    
    if (remoteNode.left && 
        (!localNode.left || localNode.left.hash !== remoteNode.left.hash)) {
      neededSubtrees.push(...findNeededSubtrees(localNode.left, remoteNode.left));
    }
    
    if (remoteNode.right && 
        (!localNode.right || localNode.right.hash !== remoteNode.right.hash)) {
      neededSubtrees.push(...findNeededSubtrees(localNode.right, remoteNode.right));
    }
    
    return neededSubtrees;
  }
  
  // --- Main P2P Sync Workflow ---
  onMount(async () => {
    [sendRootHash, getRootHash] = room.makeAction('rootHash');
    [sendRecords, getRecords] = room.makeAction('fullRecord');
    [sendSubtree, getSubtree] = room.makeAction('subtree'); // ✅ New subtree exchange
  
    // Load persisted records
    const persisted = await getAllRecords();
    const hashMap: Record<string, string> = {};
    for (const [uuid, record] of Object.entries(persisted)) {
      hashMap[uuid] = record.integrity.hash;
    }
    hashMapStore.set(hashMap);
  
    const localMerkleRoot = await buildMerkleTreeNodes(hashMap);
    merkleRoot.set(localMerkleRoot.hash);
    console.log(`[SimpleSync] Loaded ${Object.keys(hashMap).length} persisted records`);
    console.log(`[SimpleSync] My peer ID: ${selfId}`);
  
    // Peer joins
    room.onPeerJoin(peerId => {
      console.log(`[SimpleSync] Peer ${peerId} joined`);
      initPeer(peerId);
      // ✅ Send only root hash first, not full tree
      sendRootHash({ merkleRoot: localMerkleRoot.hash }, peerId);
      peerTraffic[peerId].sent.rootHashes++;
    });
  
    // Peer leaves
    room.onPeerLeave(peerId => {
      console.log(`[SimpleSync] Peer ${peerId} left`);
      delete peerTraffic[peerId];
      delete lastActivity[peerId];
      cleanupPeerSync(peerId); // Clean up sync state
    });
  
    // ✅ Fixed: Receive root hash and start incremental sync
    // Sync Flow:
    // 1. Both peers exchange root hashes
    // 2. If hashes differ, the peer with higher ID initiates sync
    // 3. Initiator requests full tree from other peer
    // 4. Initiator compares trees and requests missing records
    // 5. Other peer sends requested records
    getRootHash(async (peerData, peerId) => {
      if (!peerTraffic[peerId]) return;
      initPeer(peerId);
      peerTraffic[peerId].recv.rootHashes++;

      const localHashes = get(hashMapStore);
      const localMerkleRoot = await getMerkleTree(localHashes);

      if (peerData.merkleRoot !== localMerkleRoot.hash) {
        console.log(`[SimpleSync] Root differs with peer ${peerId}. Starting stateless sync...`);
        
        // ✅ FIXED: Check sync state atomically before starting
        if (syncInProgress[peerId]) {
          console.log(`[SimpleSync] Sync already in progress with ${peerId}`);
          lastActivity[peerId] = Date.now();
          return;
        }
        
        // Atomically set sync state
        syncInProgress[peerId] = true;
        console.log(`[SimpleSync] ✅ Starting sync with ${peerId}`);
        
        try {
          // Request their tree so we can determine what we need from them
          sendSubtree({ requestRoot: true }, peerId);
          
          // Reset sync state after timeout
          syncTimeouts[peerId] = setTimeout(() => {
            console.log(`[SimpleSync] Sync timeout with ${peerId}, resetting state`);
            cleanupPeerSync(peerId);
          }, 10000);
        } catch (error) {
          console.error(`[SimpleSync] Error starting sync with ${peerId}:`, error);
          cleanupPeerSync(peerId);
        }
      }

      lastActivity[peerId] = Date.now();
    });
  
    // ✅ Fixed: Handle subtree requests and exchanges
    getSubtree(async (request, peerId) => {
      initPeer(peerId);
      
      if (request.requestRoot) {
        console.log(`[SimpleSync] 📤 Sending tree to ${peerId} for comparison`);
        // Send our full tree for comparison
        const localHashes = get(hashMapStore);
        const localMerkleRoot = await getMerkleTree(localHashes);
        sendSubtree({ tree: localMerkleRoot }, peerId);
        peerTraffic[peerId].sent.subtrees++;
        return;
      }
      
      if (request.tree) {
        // This is a tree comparison - find what we need from them (stateless)
        const localHashes = get(hashMapStore);
        const localMerkleRoot = await getMerkleTree(localHashes);
        
        // Debug: Log what we have vs what they have
        console.log(`[SimpleSync] 🔍 Comparing trees with ${peerId}:`);
        console.log(`[SimpleSync] Our records:`, Object.keys(localHashes).sort());
        console.log(`[SimpleSync] Their records:`, request.tree.uuids.sort());
        
        // Find what we're missing from them (simple set difference)
        const ourRecords = new Set(Object.keys(localHashes));
        const theirRecords = new Set(request.tree.uuids as string[]);
        const weNeed = [...theirRecords].filter((uuid: string) => !ourRecords.has(uuid));
        
        // Request what we need from them
        if (weNeed.length > 0) {
          console.log(`[SimpleSync] 🔍 Requesting ${weNeed.length} records from ${peerId}:`, weNeed);
          sendSubtree({ requestUUIDs: weNeed }, peerId);
          peerTraffic[peerId].sent.subtrees++;
          statSubtreesExchanged++;
        } else {
          console.log(`[SimpleSync] ✅ No records needed from ${peerId}`);
        }
      }
      
      if (request.requestUUIDs) {
        // Send specific records they requested
        const fullRecord = await getAllRecords();
        const toSend: Record<string, any> = {};
        for (const uuid of request.requestUUIDs) {
          if (fullRecord[uuid]) {
            toSend[uuid] = fullRecord[uuid];
          }
        }
        
        if (Object.keys(toSend).length > 0) {
          console.log(`[SimpleSync] 📤 Sending ${Object.keys(toSend).length} records to ${peerId}:`, Object.keys(toSend));
          sendRecords(toSend, peerId);
          statRecordsSent += Object.keys(toSend).length;
          peerTraffic[peerId].sent.records += Object.keys(toSend).length;
        }
      }
      
      lastActivity[peerId] = Date.now();
    });
  
    // Receive records from peer (per-peer processing)
    getRecords(async (records: Record<string, any>, peerId) => {
      // ✅ FIXED: Check per-peer processing state
      if (processingRecords[peerId]) {
        console.log(`[SimpleSync] Already processing records from ${peerId}, skipping`);
        return;
      }
      
      processingRecords[peerId] = true;
      initPeer(peerId);

      try {
        const incomingCount = Object.keys(records).length;
        console.log(`[SimpleSync] 📥 Received ${incomingCount} records from ${peerId}:`, Object.keys(records));
        statReceivedRecords += incomingCount;
        peerTraffic[peerId].recv.records += incomingCount;
    
        let processedCount = 0;
        for (const [uuid, record] of Object.entries(records)) {
          if (await processRecord(uuid, record)) processedCount++;
        }
    
        console.log(`[SimpleSync] Processed ${processedCount}/${incomingCount} records from ${peerId}`);
    
        // Update Merkle root using cached version
        const hashes = get(hashMapStore);
        const localMerkleRoot = await getMerkleTree(hashes);
        merkleRoot.set(localMerkleRoot.hash);

        // Don't update lastActivity here to prevent immediate re-sync
        //       lastActivity[peerId] = Date.now();
        
        // Mark sync as complete for this peer
        cleanupPeerSync(peerId);
      } catch (error) {
        console.error(`[SimpleSync] Error processing records from ${peerId}:`, error);
        cleanupPeerSync(peerId);
      }
    });
  
    // ✅ Fixed: Periodic sync with just root hash
    setInterval(async () => {
      const now = Date.now();
      for (const peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          console.log(`[SimpleSync] Peer ${peerId} idle, sending root hash`);
          const hashes = get(hashMapStore);
          const localMerkleRoot = await getMerkleTree(hashes);
          sendRootHash({ merkleRoot: localMerkleRoot.hash }, peerId);
          peerTraffic[peerId].sent.rootHashes++;
        }
      }
    }, 1000);
  });
  </script>
  
  <main style="margin:0; padding:0; width: 95%; height: 95%;">
    <div style="margin:0; padding:0; background-color:dimgray;">
      <a href="https://github.com/worldpeaceenginelabs/CLOUD-ATLAS.peerset.DB">
        <img height="50" width="50" src="github.jpg" alt="GitHub Repository">
      </a>
    </div>
  
    <Ui
      {statReceivedRecords}
      {statSubtreesExchanged}
      {statRecordsSent}
      {peerTraffic}
    />
  
    <RecordGenerator />
  </main>