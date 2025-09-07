<script lang="ts">
  import { onMount } from 'svelte';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { get } from 'svelte/store';
  import { getAllRecords, saveRecordsBatch } from './db.js';
  import { moderateRecordsBatch } from './moderation.js';
  import { getMerkleTree, buildMerkleTreeNodes, type MerkleNode } from './merkleTree.js';
  import { EfficientMerkleSync, type SubtreeRequest } from './efficientMerkleSync.js';
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
  
  // --- P2P ---
  const config = { appId: 'peerset.DB' };
  const room = joinRoom(config, 'sdfjow02039ru');
  
  let sendRootHash, getRootHash, sendRecords, getRecords, sendSubtree, getSubtree;
  let processingRecords: Record<string, boolean> = {}; // Track record processing per peer
  let syncInProgress: Record<string, boolean> = {}; // Track sync state per peer
  let syncTimeouts: Record<string, NodeJS.Timeout> = {}; // Track sync timeouts for cleanup
  let syncCompletionChecks: Record<string, NodeJS.Timeout> = {}; // Delayed completion checks
  let hashMapStoreUpdateQueue: Array<{ uuid: string; hash: string }> = [];
  let isUpdatingHashMapStore = false;
  
  // Batch merkle root recalculation optimization
  let pendingMerkleUpdates: Record<string, NodeJS.Timeout> = {}; // Track pending updates per peer
  let peerBatchTimings: Record<string, number[]> = {}; // Track batch arrival times per peer
  const MIN_MERKLE_DELAY = 500; // Minimum delay
  const MAX_MERKLE_DELAY = 5000; // Maximum delay (5 seconds)
  const BATCH_TIMING_HISTORY = 5; // Keep last 5 batch timings for calculation
  
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
    
    // Clean up pending merkle updates for this peer
    // Clean up pending batches
    EfficientMerkleSync.cleanupPeerBatches(peerId);
    if (pendingMerkleUpdates[peerId]) {
      clearTimeout(pendingMerkleUpdates[peerId]);
      delete pendingMerkleUpdates[peerId];
    }
    
    // Clean up batch timing history
    delete peerBatchTimings[peerId];
    
    // Clean up completion checks
    if (syncCompletionChecks[peerId]) {
      clearTimeout(syncCompletionChecks[peerId]);
      delete syncCompletionChecks[peerId];
    }
  }
  
  // Extend sync timeout when there's activity (records being processed)
  function extendSyncTimeout(peerId: string) {
    if (syncTimeouts[peerId] && syncInProgress[peerId]) {
      // Clear existing timeout
      clearTimeout(syncTimeouts[peerId]);
      
      // Set new timeout
      syncTimeouts[peerId] = setTimeout(() => {
        console.log(`[peerset.DB] Sync timeout with ${peerId}, resetting state`);
        cleanupPeerSync(peerId);
      }, 120000); // 2 minutes from now
      
      console.log(`[peerset.DB] Extended sync timeout for ${peerId} due to activity`);
    }
  }
  
  // Check if sync is truly complete after a delay (to allow for pending batches)
  function scheduleCompletionCheck(peerId: string) {
    // Clear any existing completion check
    if (syncCompletionChecks[peerId]) {
      clearTimeout(syncCompletionChecks[peerId]);
    }
    
    // Schedule completion check after a delay
    syncCompletionChecks[peerId] = setTimeout(async () => {
      // Check if there are still pending batches
      const pendingCount = EfficientMerkleSync.getPendingRecordCount(peerId);
      const hasPending = EfficientMerkleSync.hasPendingBatches(peerId);
      
      if (!hasPending && pendingCount === 0 && syncInProgress[peerId]) {
        console.log(`[peerset.DB] ✅ Sync truly complete for ${peerId} - no more pending batches`);
        
        // ✅ NEW: Check if we need to initiate reverse sync
        await checkAndInitiateReverseSync(peerId);
        
        cleanupPeerSync(peerId);
      } else {
        console.log(`[peerset.DB] Sync still active for ${peerId} - ${pendingCount} records pending`);
        // Schedule another check
        scheduleCompletionCheck(peerId);
      }
      
      delete syncCompletionChecks[peerId];
    }, 2000); // Wait 2 seconds to see if more batches arrive
  }

  // ✅ NEW: Check if we need to initiate reverse sync after receiving records
  async function checkAndInitiateReverseSync(peerId: string) {
    try {
      // Get current local state after processing all received records
      const localHashes = get(hashMapStore);
      const localMerkleRoot = await getMerkleTree(localHashes);
      
      // Send our updated root hash to the peer
      console.log(`[peerset.DB] 🔄 Sending updated root hash to ${peerId} for reverse sync check`);
      sendRootHash({ merkleRoot: localMerkleRoot.hash }, peerId);
      peerTraffic[peerId].sent.rootHashes++;
      statRootHashesSent++;
      
      // Update activity to prevent immediate timeout
      lastActivity[peerId] = Date.now();
      
    } catch (error) {
      console.error(`[peerset.DB] Error initiating reverse sync check with ${peerId}:`, error);
    }
  }

  // Calculate adaptive delay based on peer's batch timing history
  function calculateAdaptiveDelay(peerId: string): number {
    const timings = peerBatchTimings[peerId];
    if (!timings || timings.length < 2) {
      return MIN_MERKLE_DELAY; // Use minimum delay for first batch or insufficient data
    }
    
    // Calculate average time between batches
    const intervals: number[] = [];
    for (let i = 1; i < timings.length; i++) {
      intervals.push(timings[i] - timings[i - 1]);
    }
    
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    
    // Use 2x the average interval as delay, but within bounds
    const adaptiveDelay = Math.min(Math.max(avgInterval * 2, MIN_MERKLE_DELAY), MAX_MERKLE_DELAY);
    
    console.log(`[peerset.DB] Adaptive merkle delay for ${peerId}: ${adaptiveDelay}ms (avg interval: ${avgInterval}ms)`);
    return adaptiveDelay;
  }

  // Record batch timing for adaptive delay calculation
  function recordBatchTiming(peerId: string) {
    const now = Date.now();
    if (!peerBatchTimings[peerId]) {
      peerBatchTimings[peerId] = [];
    }
    
    peerBatchTimings[peerId].push(now);
    
    // Keep only recent history
    if (peerBatchTimings[peerId].length > BATCH_TIMING_HISTORY) {
      peerBatchTimings[peerId] = peerBatchTimings[peerId].slice(-BATCH_TIMING_HISTORY);
    }
  }

  // Schedule merkle root recalculation with adaptive debouncing
  function scheduleMerkleRootUpdate(peerId: string) {
    // Clear any existing timeout for this peer
    if (pendingMerkleUpdates[peerId]) {
      clearTimeout(pendingMerkleUpdates[peerId]);
    }
    
    // Calculate adaptive delay based on peer's batch timing history
    const delay = calculateAdaptiveDelay(peerId);
    
    // Schedule new update after adaptive delay
    pendingMerkleUpdates[peerId] = setTimeout(async () => {
      console.log(`[peerset.DB] Recalculating merkle root after batch completion from ${peerId}`);
      
      // Update Merkle root using cached version
      const hashes = get(hashMapStore);
      const localMerkleRoot = await getMerkleTree(hashes);
      merkleRoot.set(localMerkleRoot.hash);
      
      // Clean up the timeout
      delete pendingMerkleUpdates[peerId];
    }, delay);
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

  // Handle peer traffic updates from UI component
  function handleUpdatePeerTraffic(event) {
    const { peerTraffic: updatedPeerTraffic, statRootHashesSent: updatedStatRootHashesSent } = event.detail;
    peerTraffic = { ...updatedPeerTraffic };
    statRootHashesSent = updatedStatRootHashesSent;
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
    // 2. If hashes differ, both peers can initiate sync (bidirectional)
    // 3. Initiator requests full tree from other peer
    // 4. Initiator compares trees and requests missing records
    // 5. Other peer sends requested records
    // 6. When one peer finishes, it sends updated root hash for reverse sync
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
          // Use efficient Merkle sync instead of sending full tree
          await EfficientMerkleSync.startSync(localHashes, peerData.merkleRoot, sendSubtree, peerId);
          
          // Reset sync state after timeout (increased for large datasets)
          syncTimeouts[peerId] = setTimeout(() => {
            console.log(`[peerset.DB] Sync timeout with ${peerId}, resetting state`);
            cleanupPeerSync(peerId);
          }, 120000); // 2 minutes for large dataset sync
        } catch (error) {
          console.error(`[peerset.DB] Error starting sync with ${peerId}:`, error);
          cleanupPeerSync(peerId);
        }
      } else {
        console.log(`[peerset.DB] ✅ Root hashes match with ${peerId} - no sync needed`);
      }

      lastActivity[peerId] = Date.now();
    });
  
    // ✅ Efficient subtree handling using progressive Merkle sync
    getSubtree(async (request: SubtreeRequest, peerId) => {
      initPeer(peerId);
      const localHashes = get(hashMapStore);
      
      try {
        // Handle subtree hash requests (progressive sync)
        if (request.requestSubtreeHashes) {
          await EfficientMerkleSync.handleSubtreeHashRequest(request, localHashes, sendSubtree, peerId);
          peerTraffic[peerId].sent.subtrees++;
          lastActivity[peerId] = Date.now();
          return;
        }
        
        // Handle received subtree hashes (compare and request deeper/records)
        if (request.subtreeHashes) {
          const neededRecords = await EfficientMerkleSync.handleSubtreeHashes(request, localHashes, sendSubtree, peerId);
          if (neededRecords.length > 0) {
            peerTraffic[peerId].sent.subtrees++;
            statSubtreesExchanged++;
            // Extend timeout when requesting more records
            extendSyncTimeout(peerId);
          }
          lastActivity[peerId] = Date.now();
          return;
        }
        
        // Handle record requests (final step of sync)
        if (request.requestRecords) {
          const fullRecord = await getAllRecords();
          const toSend: Record<string, any> = {};
          for (const uuid of request.requestRecords) {
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
          lastActivity[peerId] = Date.now();
          return;
        }
        
        
      } catch (error) {
        console.error(`[peerset.DB] Error handling subtree request from ${peerId}:`, error);
      }
      
      lastActivity[peerId] = Date.now();
    });
  
    // Receive records from peer (per-peer processing with batching)
    getRecords(async (records: Record<string, any>, peerId) => {
      processingRecords[peerId] = true;
      initPeer(peerId);

      try {
        const incomingCount = Object.keys(records).length;
        console.log(`[peerset.DB] 📥 Received ${incomingCount} records from ${peerId}:`, Object.keys(records));
        statReceivedRecords += incomingCount;
        peerTraffic[peerId].recv.records += incomingCount;
        
        // Extend sync timeout due to activity
        extendSyncTimeout(peerId);
        
        // Record batch timing for adaptive delay calculation
        recordBatchTiming(peerId);
    
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
    
        // Schedule merkle root recalculation (debounced for batching optimization)
        scheduleMerkleRootUpdate(peerId);

        // Don't update lastActivity here to prevent immediate re-sync
        //       lastActivity[peerId] = Date.now();
        
        // Schedule a completion check to see if sync is truly done
        scheduleCompletionCheck(peerId);
      } catch (error) {
        console.error(`[peerset.DB] Error processing records from ${peerId}:`, error);
        cleanupPeerSync(peerId);
      } finally {
        // Always release processing lock
        processingRecords[peerId] = false;
      }
    });
  
  });
  </script>
  
  <main class="glass fade-in-up" style="margin: 0; padding: 16px; width: 100%; max-width: 100vw; min-height: 95vh; box-sizing: border-box;">
    <div class="glass-card" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <h2 style="margin: 0; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
        peerset.DB
      </h2>
      <a href="https://github.com/worldpeaceenginelabs/CLOUD-ATLAS.peerset.DB" class="glass" style="padding: 8px; display: flex; align-items: center; text-decoration: none; transition: all 0.3s ease;">
        <img height="32" width="32" src="github.jpg" alt="GitHub Repository" style="border-radius: 8px;">
      </a>
    </div>
  
    <Ui
      {statReceivedRecords}
      {statSubtreesExchanged}
      {statRecordsSent}
      {statRootHashesSent}
      {statRootHashesReceived}
      {peerTraffic}
      sendRootHashAction={sendRootHash}
      on:resetStats={handleResetStats}
      on:updatePeerTraffic={handleUpdatePeerTraffic}
    />

  </main>