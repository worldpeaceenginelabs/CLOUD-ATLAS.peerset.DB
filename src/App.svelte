<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { joinRoom, selfId } from 'trystero/torrent';
  import { bucketStore, uuidStore, recordStore } from './BucketStore.js';
  import { getAllRecords, saveRecords, deleteRecord } from './db.js';
  import { computeBucketHash } from './secp256k1.js';
  import { TOTAL_BUCKETS, getBucketForDate, isBucketActive } from './bucketUtils.js';
  
  // --- Trystero config ---
  const config = { appId: 'testpeer' };
  const room = joinRoom(config, 'testroom741369');
  
  // --- Actions ---
  let sendBucketList, getBucketList;
  let sendUUIDs, getUUIDs;
  let sendRecords, getRecords;
  
  // --- Idle detection for bucket refresh ---
  const IDLE_TIMEOUT = 5000; // ms
  const lastActivity: Record<string, number> = {};
  
  // --- On mount, setup Trystero and sync workflow ---
  onMount(() => {
    // 0️⃣ Initialize Trystero actions
    [sendBucketList, getBucketList] = room.makeAction('bucketList');
    [sendUUIDs, getUUIDs] = room.makeAction('bucketUUIDs');
    [sendRecords, getRecords] = room.makeAction('fullRecords');
  
    // 1️⃣ Send bucket list on every new peer join (only to that peer)
    room.onPeerJoin(peerId => {
      bucketStore.subscribe(localBuckets => {
        sendBucketList(localBuckets, peerId);
        console.log('Sent initial bucket list to', peerId);
      })();
    });
  
    // 2️⃣ Receive bucket list → send differing hashes
    getBucketList((peerBuckets, peerId) => {
      bucketStore.subscribe(localBuckets => {
        const differing: Record<string, string> = {};
        for (let bucketId in peerBuckets) {
          if (localBuckets[bucketId] !== peerBuckets[bucketId]) differing[bucketId] = localBuckets[bucketId];
        }
        if (Object.keys(differing).length > 0) sendBucketList(differing, peerId);
      })();
    });
  
    // 3️⃣ Receive differing hashes → send UUIDs of local records in those buckets
    getBucketList((differingHashes, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        const uuidsToSend: Record<string, string[]> = {};
        for (let bucketId in differingHashes) {
          if (localUUIDs[bucketId]) uuidsToSend[bucketId] = localUUIDs[bucketId];
        }
        if (Object.keys(uuidsToSend).length > 0) sendUUIDs(uuidsToSend, peerId);
      })();
    });
  
    // 4️⃣ Receive UUIDs → request missing full records
    getUUIDs((peerUUIDs, peerId) => {
      uuidStore.subscribe(localUUIDs => {
        recordStore.subscribe(localRecords => {
          const missingUUIDs: string[] = [];
          for (let bucketId in peerUUIDs) {
            for (let uuid of peerUUIDs[bucketId]) {
              const allLocal = (localUUIDs[bucketId]||[]).concat(Object.keys(localRecords));
              if (!allLocal.includes(uuid)) missingUUIDs.push(uuid);
            }
          }
          if (missingUUIDs.length > 0) sendRecords(missingUUIDs, peerId);
        })();
      })();
    });
  
    // 5️⃣ Receive full records → update stores + IndexedDB + lastActivity
    getRecords(async (records, peerId) => {
      // Update in-memory recordStore
      recordStore.update(localRecords => {
        for (let uuid in records) localRecords[uuid] = records[uuid];
        return localRecords;
      });
  
      // Update UUIDs per bucket
      uuidStore.update(localUUIDs => {
        for (let uuid in records) {
          const bucketId = records[uuid].bucketId;
          if (!localUUIDs[bucketId]) localUUIDs[bucketId] = [];
          if (!localUUIDs[bucketId].includes(uuid)) localUUIDs[bucketId].push(uuid);
        }
        return localUUIDs;
      });
  
      // Persist to IndexedDB
      await saveRecords(records);
  
      // Update last activity timestamp for idle detection
      lastActivity[peerId] = Date.now();
    });
  
    // 6️⃣ Idle peer check → recompute bucket hashes → broadcast if changed
    const checkIdlePeers = () => {
      const now = Date.now();
      for (let peerId in lastActivity) {
        if (now - lastActivity[peerId] > IDLE_TIMEOUT) {
          delete lastActivity[peerId]; // consider synced
  
          let bucketListChanged = false;
  
          // Recompute bucket hashes asynchronously
          (async () => {
            const localBuckets = get(bucketStore) as Record<string, string>;
            const recordsMap = get(recordStore) as Record<string, any>;
            const allRecords = Object.values(recordsMap) as any[];

            const bucketMap: Record<string, string[]> = {};
            allRecords.forEach((r: any) => {
              if (!bucketMap[r.bucketId]) bucketMap[r.bucketId] = [];
              bucketMap[r.bucketId].push(r.uuid);
            });

            const newBucketHashes: Record<string, string> = {};
            for (let i = 1; i <= TOTAL_BUCKETS; i++) {
              const bucketId = `day${i}`;
              newBucketHashes[bucketId] = await computeBucketHash(
                bucketMap[bucketId] || [],
                Object.fromEntries(allRecords.map((r: any) => [r.uuid, r]))
              );
            }

            // Compare and update
            for (const k in newBucketHashes) {
              if (newBucketHashes[k] !== localBuckets[k]) { bucketListChanged = true; break; }
            }
            if (bucketListChanged) {
              bucketStore.set(newBucketHashes as any);
              sendBucketList(newBucketHashes);
            }
          })();
        }
      }
    };
    setInterval(checkIdlePeers, 1000);
  
    // 7️⃣ Prune old records every 5 minutes (older than 90 days)
    const pruneOldRecords = async () => {
      const now = new Date();
      const oldestAllowed = new Date(now.getTime() - 90*24*60*60*1000);
      const allRecords = await getAllRecords();
  
      for (let record of allRecords) {
        const recordDate = new Date(record.createdAt);
        if (recordDate < oldestAllowed) {
          await deleteRecord(record.uuid);
  
          recordStore.update(r => {
            delete r[record.uuid];
            return r;
          });
  
          uuidStore.update(u => {
            const list = u[record.bucketId];
            if (list) u[record.bucketId] = list.filter(id => id !== record.uuid);
            return u;
          });
        }
      }
    };
    setInterval(pruneOldRecords, 5*60*1000); // every 5 minutes
  });
  </script>
  