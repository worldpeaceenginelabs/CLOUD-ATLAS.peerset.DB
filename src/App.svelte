<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecordsBatch } from './db.js';
  import { sha256 } from './secp256k1.js';
  import { moderateRecord, moderateRecordsBatch } from './moderation.js';
  import { getMerkleTree, buildMerkleTreeNodes, findWhatRemoteNeeds, findWhatWeNeed, findNeededSubtrees, type MerkleNode } from './merkleTree.js';
  import Ui from './UI.svelte';
  
  // --- Stores ---
  import { hashMapStore, merkleRoot } from './stores';
  
  // --- Stats ---
  let statRecordsSent = 0;
  let statReceivedRecords = 0;
  let statSubtreesExchanged = 0;
  let statRootHashesSent = 0;
  let statRootHashesReceived = 0;
  let peerTraffic: Record<string, { 
    sent: { rootHashes: number; subtrees: number; records: number }; 
    recv: { rootHashes: number; subtrees: number; records: number } 
  }> = {};
  const lastActivity: Record<string, number> = {};
  const IDLE_TIMEOUT = 1000 * 60 * 5; // Increased from 5000 to 10000ms
  
  // --- P2P ---
  const config = { appId: 'peerset.DB' };
  const room = joinRoom(config, 'sdfjow02039ru');
  
  let sendRootHash, getRootHash, sendRecords, getRecords, sendSubtree, getSubtree;
  let processingRecords: Record<string, boolean> = {}; // Track record processing per peer
  let syncInProgress: Record<string, boolean> = {}; // Track sync state per peer
  let syncTimeouts: Record<string, NodeJS.Timeout> = {}; // Track sync timeouts for cleanup
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

  // Handle reset stats event from UI component
  function handleResetStats() {
    statReceivedRecords = 0;
    statSubtreesExchanged = 0;
    statRecordsSent = 0;
    statRootHashesSent = 0;
    statRootHashesReceived = 0;
    // Reset peer traffic
    for (const peerId in peerTraffic) {
      peerTraffic[peerId] = { 
        sent: { rootHashes: 0, subtrees: 0, records: 0 }, 
        recv: { rootHashes: 0, subtrees: 0, records: 0 } 
      };
    }
    // Trigger reactivity
    peerTraffic = { ...peerTraffic };
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
    console.log(`[peerset.DB] Loaded ${Object.keys(hashMap).length} persisted records`);
    console.log(`[peerset.DB] My peer ID: ${selfId}`);
  
    // Peer joins
    room.onPeerJoin(peerId => {
      console.log(`[peerset.DB] Peer ${peerId} joined`);
      initPeer(peerId);
      // ✅ Send only root hash first, not full tree
      sendRootHash({ merkleRoot: localMerkleRoot.hash }, peerId);
      peerTraffic[peerId].sent.rootHashes++;
      statRootHashesSent++;
    });
  
    // Peer leaves
    room.onPeerLeave(peerId => {
      console.log(`[peerset.DB] Peer ${peerId} left`);
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
      statRootHashesReceived++;

      const localHashes = get(hashMapStore);
      const localMerkleRoot = await getMerkleTree(localHashes);

      if (peerData.merkleRoot !== localMerkleRoot.hash) {
        console.log(`[peerset.DB] Root differs with peer ${peerId}. Starting stateless sync...`);
        
        // ✅ NEW: Check if we're currently processing records from this peer
        if (processingRecords[peerId]) {
          console.log(`[peerset.DB] Deferring sync with ${peerId} - currently processing records`);
          lastActivity[peerId] = Date.now();
          return;
        }
        
        // ✅ FIXED: Check sync state atomically before starting
        if (syncInProgress[peerId]) {
          console.log(`[peerset.DB] Sync already in progress with ${peerId}`);
          lastActivity[peerId] = Date.now();
          return;
        }
        
        // Atomically set sync state
        syncInProgress[peerId] = true;
        console.log(`[peerset.DB] ✅ Starting sync with ${peerId}`);
        
        try {
          // Request their tree so we can determine what we need from them
          sendSubtree({ requestRoot: true }, peerId);
          
          // Reset sync state after timeout
          syncTimeouts[peerId] = setTimeout(() => {
            console.log(`[peerset.DB] Sync timeout with ${peerId}, resetting state`);
            cleanupPeerSync(peerId);
          }, 10000);
        } catch (error) {
          console.error(`[peerset.DB] Error starting sync with ${peerId}:`, error);
          cleanupPeerSync(peerId);
        }
      }

      lastActivity[peerId] = Date.now();
    });
  
    // ✅ Fixed: Handle subtree requests and exchanges
    getSubtree(async (request, peerId) => {
      initPeer(peerId);
      
      if (request.requestRoot) {
        console.log(`[peerset.DB] 📤 Sending tree to ${peerId} for comparison`);
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
        console.log(`[peerset.DB] 🔍 Comparing trees with ${peerId}:`);
        console.log(`[peerset.DB] Our records:`, Object.keys(localHashes).sort());
        console.log(`[peerset.DB] Their records:`, request.tree.uuids.sort());
        
        // Find what we're missing from them (simple set difference)
        const ourRecords = new Set(Object.keys(localHashes));
        const theirRecords = new Set(request.tree.uuids as string[]);
        const weNeed = [...theirRecords].filter((uuid: string) => !ourRecords.has(uuid));
        
        // Request what we need from them
        if (weNeed.length > 0) {
          console.log(`[peerset.DB] 🔍 Requesting ${weNeed.length} records from ${peerId}:`, weNeed);
          sendSubtree({ requestUUIDs: weNeed }, peerId);
          peerTraffic[peerId].sent.subtrees++;
          statSubtreesExchanged++;
        } else {
          console.log(`[peerset.DB] ✅ No records needed from ${peerId}`);
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
          console.log(`[peerset.DB] 📤 Sending ${Object.keys(toSend).length} records to ${peerId}:`, Object.keys(toSend));
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
        console.log(`[peerset.DB] Already processing records from ${peerId}, skipping`);
        return;
      }
      
      processingRecords[peerId] = true;
      initPeer(peerId);

      try {
        const incomingCount = Object.keys(records).length;
        console.log(`[peerset.DB] 📥 Received ${incomingCount} records from ${peerId}:`, Object.keys(records));
        statReceivedRecords += incomingCount;
        peerTraffic[peerId].recv.records += incomingCount;
    
        // Batch moderate all records at once
        const moderationResults = await moderateRecordsBatch(records);
        
        // Filter approved records for batch processing
        const approvedRecords = {};
        const approvedHashes = {};
        let processedCount = 0;
        
        for (const [uuid, record] of Object.entries(records)) {
          if (!moderationResults[uuid]) {
            console.log(`[peerset.DB] Record ${uuid} rejected by moderation`);
            continue;
          }
          approvedRecords[uuid] = record;
          approvedHashes[uuid] = record.integrity.hash;
          processedCount++;
        }
        
        // Batch save all approved records
        if (Object.keys(approvedRecords).length > 0) {
          try {
            await saveRecordsBatch(approvedRecords);
            
            // Batch update hash map store
            hashMapStore.update(local => ({
              ...local,
              ...approvedHashes
            }));
          } catch (error) {
            console.error(`[peerset.DB] Error batch processing records from ${peerId}:`, error);
          }
        }
    
        console.log(`[peerset.DB] Processed ${processedCount}/${incomingCount} records from ${peerId}`);
    
        // Update Merkle root using cached version
        const hashes = get(hashMapStore);
        const localMerkleRoot = await getMerkleTree(hashes);
        merkleRoot.set(localMerkleRoot.hash);

        // Don't update lastActivity here to prevent immediate re-sync
        //       lastActivity[peerId] = Date.now();
        
        // Mark sync as complete for this peer
        cleanupPeerSync(peerId);
      } catch (error) {
        console.error(`[peerset.DB] Error processing records from ${peerId}:`, error);
        cleanupPeerSync(peerId);
      }
    });
  
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
      {statRootHashesSent}
      {statRootHashesReceived}
      {peerTraffic}
      on:resetStats={handleResetStats}
    />

  </main>